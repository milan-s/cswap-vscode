import { execFile } from "child_process";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { needsRelogin } from "./relogin";
import { CacheRow, Stale, cacheKey, describeStale, readUsageCache, splitAge } from "./staleness";

/** A single managed Claude account, parsed from `cswap --list`. */
export interface Account {
  /** 1-based slot number used by cswap (`--switch-to N`). */
  number: number;
  email: string;
  /** Organization / display tag shown in brackets. */
  org: string;
  active: boolean;
  /** Human-readable usage lines (e.g. "$$: 21% $51.42 / $250.00"). */
  usage: string[];
  /** cswap reports the stored refresh token as dead; only a browser re-login fixes it. */
  needsRelogin: boolean;
  /** Set when cswap is serving an old usage reading (its "· 1h ago" marker). */
  stale?: Stale;
}

export class CswapError extends Error {
  constructor(message: string, readonly stderr?: string) {
    super(message);
    this.name = "CswapError";
  }
}

const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/**
 * Locate the cswap executable. Order of precedence:
 *   1. The `cswap.path` setting, if set.
 *   2. Common install locations (~/.local/bin/cswap, /usr/local/bin/cswap).
 *   3. Bare `cswap`, relying on PATH.
 */
export function resolveCswapPath(): string {
  const configured = vscode.workspace
    .getConfiguration("cswap")
    .get<string>("path")
    ?.trim();
  if (configured) {
    return expandHome(configured);
  }

  const candidates = [
    path.join(os.homedir(), ".local", "bin", "cswap"),
    "/usr/local/bin/cswap",
    "/opt/homebrew/bin/cswap",
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return "cswap";
}

export function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Run cswap with the given args, returning stdout. Optionally pipes `stdin`. */
function run(args: string[], stdin?: string): Promise<string> {
  const bin = resolveCswapPath();
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            reject(
              new CswapError(
                `cswap executable not found at "${bin}". Install it or set the "cswap.path" setting.`,
              ),
            );
            return;
          }
          reject(new CswapError(stripAnsi(stderr || err.message), stderr));
          return;
        }
        resolve(stdout);
      },
    );
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/**
 * Parse the text output of `cswap --list`.
 *
 * Example block:
 *   Accounts:
 *     1: milan.srba@adastragrp.com [ADASTRA s.r.o.] (active)
 *        └ $$:  21%   $51.42 / $250.00
 *     2: other@gmail.com [Org]
 *        ├ 5h:   5%   resets 15:00         in 3h 53m
 *        └ 7d:   1%   resets Jun 10 21:00  in 4d 9h
 *   Running instances:
 *     ...
 */
export function parseList(
  raw: string,
  cache: Map<string, CacheRow> = new Map(),
  nowMs: number = Date.now(),
): Account[] {
  const text = stripAnsi(raw);
  const accounts: Account[] = [];
  const ages = new Map<Account, string>();
  let current: Account | undefined;

  const headerRe = /^\s*(\d+):\s+(.+?)\s+\[(.*?)\]\s*(\(active\))?\s*$/;

  for (const line of text.split(/\r?\n/)) {
    // Stop collecting once we reach the "Running instances:" section.
    if (/^Running instances:/.test(line.trim())) {
      break;
    }

    const m = line.match(headerRe);
    if (m) {
      current = {
        number: parseInt(m[1], 10),
        email: m[2].trim(),
        org: m[3].trim(),
        active: Boolean(m[4]),
        usage: [],
        needsRelogin: false,
      };
      accounts.push(current);
      continue;
    }

    // Usage / detail lines belong to the most recent account.
    if (current) {
      const trimmed = line.trim();
      if (!trimmed || /^Accounts:/.test(trimmed)) {
        continue;
      }
      // Strip leading tree connectors (├ └ •) and surrounding whitespace.
      const cleaned = trimmed.replace(/^[├└•]\s*/, "").trim();
      if (cleaned) {
        // The stale marker moves off the line into `stale`, explained below.
        const { line: usage, age } = splitAge(cleaned);
        current.usage.push(usage);
        if (age) {
          ages.set(current, age);
        }
      }
    }
  }

  for (const a of accounts) {
    a.needsRelogin = needsRelogin(a.usage);
    const age = ages.get(a);
    if (age) {
      a.stale = describeStale(age, cache.get(cacheKey(a.number, a.email)), nowMs);
    }
  }
  return accounts;
}

/** List all managed accounts. Returns [] if none are managed yet. */
export async function listAccounts(): Promise<Account[]> {
  const out = await run(["--list"]);
  return parseList(out, readUsageCache());
}

/** Switch to a specific account by number or email. Returns cswap's stdout. */
export async function switchTo(identifier: string | number): Promise<string> {
  return run(["--switch-to", String(identifier)]);
}

/** Remove an account by number or email. Auto-confirms the y/N prompt via stdin. */
export async function removeAccount(identifier: string | number): Promise<string> {
  return run(["--remove-account", String(identifier)], "y\n");
}

/**
 * Add the currently logged-in Claude account to the managed set.
 * Non-interactive when no slot is given (cswap auto-assigns the next slot,
 * or refreshes credentials in place if the account already exists).
 */
export async function addCurrentAccount(): Promise<string> {
  return run(["--add-account"]);
}

/**
 * Register a raw OAuth setup-token as a new account.
 * The token is passed over stdin (never as an argv, so it stays out of `ps`).
 */
export async function addToken(token: string, email?: string): Promise<string> {
  const args = ["--add-token", "-"];
  if (email) {
    args.push("--email", email);
  }
  return run(args, token.trim() + "\n");
}
