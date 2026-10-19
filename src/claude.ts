import { execFile } from "child_process";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { expandHome } from "./cswap";
import {
  cleanupLoginFiles,
  loginEnv,
  loginShellArgs,
  prepareLoginFiles,
  readExitCode,
  readLoginUrl,
} from "./loginShell";
import { LoginOutcome } from "./relogin";

/**
 * Locate the Claude Code CLI: the `cswap.claudePath` setting, then common
 * install locations, then bare `claude` on PATH.
 */
export function resolveClaudePath(): string {
  const configured = vscode.workspace
    .getConfiguration("cswap")
    .get<string>("claudePath")
    ?.trim();
  if (configured) {
    return expandHome(configured);
  }

  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return "claude";
}

/** Email of the live Claude Code login (`claude auth status`), if logged in. */
export function authStatusEmail(): Promise<string | undefined> {
  const bin = resolveClaudePath();
  return new Promise((resolve) => {
    // Exits 1 when logged out, but still prints the JSON status.
    execFile(bin, ["auth", "status", "--json"], { timeout: 30_000 }, (_err, stdout) => {
      try {
        const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
        resolve(status.loggedIn && status.email ? status.email : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Run `claude auth login --email <email>` in a visible terminal and wait for it.
 *
 * The browser is never opened automatically: the sign-in URL is captured via
 * `$BROWSER` and handed to `onUrl`. The terminal stays usable for Claude Code's
 * "paste code" fallback. Closing the terminal or cancelling `token` cancels.
 */
export function runLoginInTerminal(
  email: string,
  storageDir: string,
  onUrl: (url: string) => void,
  token: vscode.CancellationToken,
): Promise<LoginOutcome> {
  const files = prepareLoginFiles(storageDir, String(Date.now()));
  const terminal = vscode.window.createTerminal({
    name: `CSwap Login: ${email}`,
    shellPath: "/bin/sh",
    shellArgs: loginShellArgs(resolveClaudePath(), email, files.exitFile),
    env: loginEnv(files),
    iconPath: new vscode.ThemeIcon("key"),
  });
  terminal.show();

  return new Promise((resolve) => {
    let urlSeen = false;
    let settled = false;

    const finish = (outcome: LoginOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(poll);
      closeSub.dispose();
      cancelSub.dispose();
      cleanupLoginFiles(files);
      resolve(outcome);
    };

    const check = (): boolean => {
      if (!urlSeen) {
        const url = readLoginUrl(files);
        if (url) {
          urlSeen = true;
          onUrl(url);
        }
      }
      const exitCode = readExitCode(files);
      if (exitCode === undefined) {
        return false;
      }
      finish(exitCode === 0 ? { kind: "done" } : { kind: "failed", exitCode });
      return true;
    };

    const poll = setInterval(check, 400);

    const closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal && !check()) {
        finish({ kind: "cancelled" });
      }
    });

    const cancelSub = token.onCancellationRequested(() => {
      if (!check()) {
        finish({ kind: "cancelled" });
        terminal.dispose();
      }
    });
  });
}
