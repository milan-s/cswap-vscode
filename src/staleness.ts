/**
 * Explain stale usage data: why cswap is serving an old reading and when it
 * will try again.
 *
 * `cswap list` only marks stale usage with a trailing "· 1h ago"; the reason
 * (e.g. a 429 from Anthropic's usage endpoint) and the retry time live in
 * cswap's own cache file, which we read (never write) for the explanation.
 *
 * Kept free of `vscode` imports so it can be unit-tested.
 */
import { readFileSync } from "fs";
import * as os from "os";
import * as path from "path";

export interface Stale {
  /** Age as cswap printed it, e.g. "1h". */
  age: string;
  /** Short human reason, e.g. "rate-limited by Anthropic". */
  reason: string;
  /** Epoch ms of the next fetch attempt, if known and in the future. */
  retryAt?: number;
}

/** One account row of cswap's `cache/usage.json` (schemaVersion 2). */
export interface CacheRow {
  email?: string;
  lastError?: string | null;
  /** Epoch seconds. */
  backoffUntil?: number | null;
  /** Epoch seconds. */
  nextPollAt?: number | null;
}

const AGE_SUFFIX = /\s+·\s+(\d+[smhd]) ago$/;

/**
 * Split cswap's " · 1h ago" stale marker off a usage line. "last seen …"
 * lines (dead-token accounts) keep theirs — there the age is the message.
 */
export function splitAge(line: string): { line: string; age?: string } {
  if (line.startsWith("last seen")) {
    return { line };
  }
  const m = line.match(AGE_SUFFIX);
  return m ? { line: line.slice(0, m.index).trimEnd(), age: m[1] } : { line };
}

/** cswap's cache dir: XDG data dir on Linux, ~/.claude-swap-backup elsewhere. */
export function cacheFilePath(): string {
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    const base =
      xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
    return path.join(base, "claude-swap", "cache", "usage.json");
  }
  return path.join(os.homedir(), ".claude-swap-backup", "cache", "usage.json");
}

/** Parse the cache file into rows keyed by `${slot}|${email}`. */
export function parseUsageCache(text: string): Map<string, CacheRow> {
  const rows = new Map<string, CacheRow>();
  const accounts = (JSON.parse(text) as { accounts?: Record<string, CacheRow> }).accounts;
  for (const [slot, row] of Object.entries(accounts ?? {})) {
    if (row && typeof row.email === "string") {
      rows.set(cacheKey(Number(slot), row.email), row);
    }
  }
  return rows;
}

export function cacheKey(slot: number, email: string): string {
  return `${slot}|${email.toLowerCase()}`;
}

/** Best-effort read of cswap's cache; empty when missing or unreadable. */
export function readUsageCache(file = cacheFilePath()): Map<string, CacheRow> {
  try {
    return parseUsageCache(readFileSync(file, "utf8"));
  } catch {
    return new Map();
  }
}

/** Build the stale explanation for an account whose usage is `age` old. */
export function describeStale(age: string, row: CacheRow | undefined, nowMs: number): Stale {
  let reason = "waiting for next refresh";
  if (row?.lastError === "http-429") {
    reason = "rate-limited by Anthropic";
  } else if (row?.lastError) {
    reason = `last fetch failed (${row.lastError})`;
  }
  const retryAt = [row?.backoffUntil, row?.nextPollAt]
    .filter((s): s is number => typeof s === "number")
    .map((s) => s * 1000)
    .find((ms) => ms > nowMs);
  return { age, reason, retryAt };
}

/** "stale 1h · rate-limited by Anthropic, retry 13:18" */
export function formatStale(s: Stale, nowMs: number): string {
  const retry = s.retryAt ? `, retry ${formatTime(s.retryAt, nowMs)}` : "";
  return `stale ${s.age} · ${s.reason}${retry}`;
}

/** "13:18" today, "Oct 21 13:18" on another day — same format as cswap's own lines. */
export function formatTime(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date(nowMs).toDateString()) {
    return time;
  }
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
