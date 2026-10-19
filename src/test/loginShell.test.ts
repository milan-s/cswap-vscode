import * as assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  LoginFiles,
  cleanupLoginFiles,
  loginEnv,
  loginShellArgs,
  prepareLoginFiles,
  readExitCode,
  readLoginUrl,
} from "../loginShell";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "cswap-login-test-"));
}

/** A fake `claude` that records argv, opens `$BROWSER` with a URL, then exits. */
function fakeClaude(dir: string, exitCode: number): string {
  const bin = path.join(dir, "claude");
  writeFileSync(
    bin,
    `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/argv"
"$BROWSER" "https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fcallback&login_hint=x"
exit ${exitCode}
`,
    { mode: 0o755 },
  );
  return bin;
}

function runLogin(bin: string, email: string, files: LoginFiles): number | null {
  const r = spawnSync("/bin/sh", loginShellArgs(bin, email, files.exitFile), {
    env: { ...process.env, ...loginEnv(files) },
  });
  return r.status;
}

test("captures the sign-in URL and a zero exit code", () => {
  const dir = tmpDir();
  const files = prepareLoginFiles(path.join(dir, "login"), "1");
  const status = runLogin(fakeClaude(dir, 0), "me@example.com", files);

  assert.equal(status, 0);
  assert.equal(readExitCode(files), 0);
  assert.equal(
    readLoginUrl(files),
    "https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fcallback&login_hint=x",
  );
  assert.deepEqual(readFileSync(path.join(dir, "argv"), "utf8").trim().split("\n"), [
    "auth",
    "login",
    "--email",
    "me@example.com",
  ]);
});

test("propagates a failing exit code (keeps the terminal open in VS Code)", () => {
  const dir = tmpDir();
  const files = prepareLoginFiles(path.join(dir, "login"), "1");
  const status = runLogin(fakeClaude(dir, 3), "me@example.com", files);
  assert.equal(status, 3);
  assert.equal(readExitCode(files), 3);
});

test("hostile email is passed verbatim, never executed", () => {
  const dir = tmpDir();
  const files = prepareLoginFiles(path.join(dir, "login"), "1");
  const marker = path.join(dir, "pwned");
  const email = `a"; touch ${marker}; echo "$(touch ${marker})@x.com`;
  runLogin(fakeClaude(dir, 0), email, files);

  assert.equal(existsSync(marker), false);
  const argv = readFileSync(path.join(dir, "argv"), "utf8").trim().split("\n");
  assert.equal(argv[3], email);
});

test("paths with spaces work", () => {
  const dir = path.join(tmpDir(), "with space");
  const files = prepareLoginFiles(path.join(dir, "login dir"), "1"); // also creates `dir`
  assert.equal(runLogin(fakeClaude(dir, 0), "me@example.com", files), 0);
  assert.ok(readLoginUrl(files));
});

test("nothing is read before the command finishes", () => {
  const dir = tmpDir();
  const files = prepareLoginFiles(path.join(dir, "login"), "1");
  assert.equal(readLoginUrl(files), undefined);
  assert.equal(readExitCode(files), undefined);
  writeFileSync(files.exitFile, ""); // shell truncated but not yet written
  assert.equal(readExitCode(files), undefined);
});

test("prepare removes stale files and makes the browser script executable", () => {
  const dir = path.join(tmpDir(), "login");
  const first = prepareLoginFiles(dir, "same");
  writeFileSync(first.urlFile, "https://stale");
  writeFileSync(first.exitFile, "0");

  const files = prepareLoginFiles(dir, "same");
  assert.equal(readLoginUrl(files), undefined);
  assert.equal(readExitCode(files), undefined);
  assert.ok(statSync(files.browserScript).mode & 0o100);

  writeFileSync(files.urlFile, "u");
  cleanupLoginFiles(files);
  assert.equal(existsSync(files.urlFile), false);
});

// Opt-in: drives the real Claude Code CLI against a throwaway config dir, so the
// user's real login is never touched. Only checks the URL hand-off, then kills it.
test(
  "real claude: sign-in URL is captured instead of opening a browser",
  { skip: process.env.CSWAP_TEST_REAL_CLAUDE ? false : "set CSWAP_TEST_REAL_CLAUDE=1" },
  async () => {
    const claude = path.join(os.homedir(), ".local", "bin", "claude");
    const dir = tmpDir();
    const files = prepareLoginFiles(path.join(dir, "login"), "1");
    const child = spawn("/bin/sh", loginShellArgs(claude, "probe@example.com", files.exitFile), {
      env: { ...process.env, ...loginEnv(files), CLAUDE_CONFIG_DIR: path.join(dir, "cfg") },
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    try {
      let url: string | undefined;
      for (let i = 0; i < 60 && !url; i++) {
        await new Promise((r) => setTimeout(r, 250));
        url = readLoginUrl(files);
      }
      assert.ok(url, "no URL captured within 15s");
      const u = new URL(url);
      assert.equal(u.searchParams.get("login_hint"), "probe@example.com");
      assert.match(u.searchParams.get("redirect_uri") ?? "", /^http:\/\/localhost:\d+\/callback$/);
    } finally {
      process.kill(-child.pid!, "SIGTERM");
    }
  },
);
