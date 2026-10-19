import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as path from "path";

/**
 * Stand-in for `$BROWSER`: Claude Code calls it with the sign-in URL. Instead of
 * opening the default browser, write the URL to a file the extension watches,
 * so the user can open it in whichever browser profile holds the right login.
 */
const BROWSER_SCRIPT = `#!/bin/sh
printf '%s\\n' "$1" > "$CSWAP_LOGIN_URL_FILE"
`;

/** Files used by one login run. */
export interface LoginFiles {
  browserScript: string;
  urlFile: string;
  exitFile: string;
}

/** Create a fresh set of login files under `dir` (stale ones removed). */
export function prepareLoginFiles(dir: string, runId: string): LoginFiles {
  mkdirSync(dir, { recursive: true });
  const browserScript = path.join(dir, "capture-browser.sh");
  writeFileSync(browserScript, BROWSER_SCRIPT);
  chmodSync(browserScript, 0o755);

  const files = {
    browserScript,
    urlFile: path.join(dir, `login-${runId}.url`),
    exitFile: path.join(dir, `login-${runId}.exit`),
  };
  cleanupLoginFiles(files);
  return files;
}

export function cleanupLoginFiles(files: LoginFiles): void {
  rmSync(files.urlFile, { force: true });
  rmSync(files.exitFile, { force: true });
}

/**
 * `sh -c` arguments that run `claude auth login --email <email>` and record its
 * exit code. Values are passed as positional args, never spliced into the script.
 * The shell exits with the login's code, so VS Code keeps a failed run's
 * terminal open for the user to read.
 */
export function loginShellArgs(
  claudePath: string,
  email: string,
  exitFile: string,
): string[] {
  return [
    "-c",
    '"$0" auth login --email "$1"; code=$?; echo $code > "$2"; exit $code',
    claudePath,
    email,
    exitFile,
  ];
}

/** Environment that routes the sign-in URL into `urlFile`. */
export function loginEnv(files: LoginFiles): Record<string, string> {
  return {
    BROWSER: files.browserScript,
    CSWAP_LOGIN_URL_FILE: files.urlFile,
  };
}

/** The captured sign-in URL, once Claude Code has produced it. */
export function readLoginUrl(files: LoginFiles): string | undefined {
  return readTrimmed(files.urlFile);
}

/** The login exit code, once the command has finished. */
export function readExitCode(files: LoginFiles): number | undefined {
  const raw = readTrimmed(files.exitFile);
  if (raw === undefined) {
    return undefined;
  }
  const code = parseInt(raw, 10);
  return Number.isNaN(code) ? undefined : code;
}

function readTrimmed(file: string): string | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  const text = readFileSync(file, "utf8").trim();
  return text || undefined;
}
