import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  LoginOutcome,
  ReloginAccount,
  ReloginOps,
  needsRelogin,
  relogin,
} from "../relogin";

const A: ReloginAccount = { number: 1, email: "active@example.com" };
const N: ReloginAccount = { number: 2, email: "target@example.com" };

interface FakeConfig {
  snapshotError?: string;
  continueWithoutSnapshot?: boolean;
  login?: LoginOutcome;
  /** Live email after login; a function lets a test throw. */
  loggedIn?: string | undefined | (() => string | undefined);
  captureError?: string;
  switchError?: string;
}

/** Fake ops that record every call in order. */
function fakeOps(cfg: FakeConfig = {}): { ops: ReloginOps; calls: string[] } {
  const calls: string[] = [];
  const ops: ReloginOps = {
    async snapshotActive() {
      calls.push("snapshot");
      if (cfg.snapshotError) {
        throw new Error(cfg.snapshotError);
      }
    },
    async confirmContinueWithoutSnapshot(message) {
      calls.push(`confirm:${message}`);
      return cfg.continueWithoutSnapshot ?? false;
    },
    async login(email) {
      calls.push(`login:${email}`);
      return cfg.login ?? { kind: "done" };
    },
    async loggedInEmail() {
      calls.push("status");
      const v = "loggedIn" in cfg ? cfg.loggedIn : N.email;
      return typeof v === "function" ? v() : v;
    },
    async captureLogin() {
      calls.push("capture");
      if (cfg.captureError) {
        throw new Error(cfg.captureError);
      }
    },
    async switchTo(n) {
      calls.push(`switch:${n}`);
      if (cfg.switchError) {
        throw new Error(cfg.switchError);
      }
    },
  };
  return { ops, calls };
}

test("inactive target: snapshot, login, verify, save, switch back", async () => {
  const { ops, calls } = fakeOps();
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "ok", activeChanged: false, restoreError: undefined });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`, "status", "capture", "switch:1"]);
});

test("active target: no switch back, active login changed", async () => {
  const { ops, calls } = fakeOps();
  const r = await relogin(N, N, ops);
  assert.deepEqual(r, { kind: "ok", activeChanged: true });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`, "status", "capture"]);
});

test("restore: false stays on the target", async () => {
  const { ops, calls } = fakeOps();
  const r = await relogin(N, A, ops, { restore: false });
  assert.deepEqual(r, { kind: "ok", activeChanged: true });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`, "status", "capture"]);
});

test("no active account: skip snapshot and switch back", async () => {
  const { ops, calls } = fakeOps();
  const r = await relogin(N, undefined, ops);
  assert.deepEqual(r, { kind: "ok", activeChanged: true });
  assert.deepEqual(calls, [`login:${N.email}`, "status", "capture"]);
});

test("email comparison ignores case and whitespace", async () => {
  const { ops, calls } = fakeOps({ loggedIn: "  Target@Example.COM " });
  const r = await relogin(N, A, ops);
  assert.equal(r.kind, "ok");
  assert.ok(calls.includes("capture"));
});

test("cancelled login touches nothing after the snapshot", async () => {
  const { ops, calls } = fakeOps({ login: { kind: "cancelled" } });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "cancelled" });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`]);
});

test("failed login reports the exit code and saves nothing", async () => {
  const { ops, calls } = fakeOps({ login: { kind: "failed", exitCode: 7 } });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "loginFailed", exitCode: 7 });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`]);
});

test("wrong account: not saved, original restored", async () => {
  const { ops, calls } = fakeOps({ loggedIn: "someone-else@example.com" });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, {
    kind: "wrongAccount",
    got: "someone-else@example.com",
    restoreError: undefined,
  });
  assert.deepEqual(calls, ["snapshot", `login:${N.email}`, "status", "switch:1"]);
});

test("wrong account while target was active: restores the target slot", async () => {
  const { ops, calls } = fakeOps({ loggedIn: "someone-else@example.com" });
  const r = await relogin(N, N, ops);
  assert.equal(r.kind, "wrongAccount");
  assert.deepEqual(calls.slice(-1), ["switch:2"]);
  assert.ok(!calls.includes("capture"));
});

test("wrong account with restore: false still restores the original", async () => {
  const { ops, calls } = fakeOps({ loggedIn: "someone-else@example.com" });
  const r = await relogin(N, A, ops, { restore: false });
  assert.equal(r.kind, "wrongAccount");
  assert.deepEqual(calls.slice(-1), ["switch:1"]);
});

test("wrong account with no active account: nothing to restore", async () => {
  const { ops, calls } = fakeOps({ loggedIn: "someone-else@example.com" });
  const r = await relogin(N, undefined, ops);
  assert.deepEqual(r, { kind: "wrongAccount", got: "someone-else@example.com", restoreError: undefined });
  assert.ok(!calls.some((c) => c.startsWith("switch")));
});

test("logged out after login counts as wrong account", async () => {
  const { ops, calls } = fakeOps({ loggedIn: undefined });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "wrongAccount", got: undefined, restoreError: undefined });
  assert.ok(!calls.includes("capture"));
});

test("auth status throwing counts as wrong account", async () => {
  const { ops, calls } = fakeOps({
    loggedIn: () => {
      throw new Error("boom");
    },
  });
  const r = await relogin(N, A, ops);
  assert.equal(r.kind, "wrongAccount");
  assert.ok(!calls.includes("capture"));
});

test("wrong account and restore fails: both reported", async () => {
  const { ops } = fakeOps({ loggedIn: "x@example.com", switchError: "locked" });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "wrongAccount", got: "x@example.com", restoreError: "locked" });
});

test("snapshot failure + user declines: aborted before login", async () => {
  const { ops, calls } = fakeOps({ snapshotError: "keychain locked" });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "aborted", reason: "keychain locked" });
  assert.deepEqual(calls, ["snapshot", "confirm:keychain locked"]);
});

test("snapshot failure + user continues: flow completes", async () => {
  const { ops, calls } = fakeOps({ snapshotError: "keychain locked", continueWithoutSnapshot: true });
  const r = await relogin(N, A, ops);
  assert.equal(r.kind, "ok");
  assert.deepEqual(calls, [
    "snapshot",
    "confirm:keychain locked",
    `login:${N.email}`,
    "status",
    "capture",
    "switch:1",
  ]);
});

test("save failure: reported, original restored", async () => {
  const { ops, calls } = fakeOps({ captureError: "cswap add failed" });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "saveFailed", message: "cswap add failed", restoreError: undefined });
  assert.deepEqual(calls.slice(-2), ["capture", "switch:1"]);
});

test("save failure on the active target: no switch", async () => {
  const { ops, calls } = fakeOps({ captureError: "nope" });
  const r = await relogin(N, N, ops);
  assert.equal(r.kind, "saveFailed");
  assert.ok(!calls.some((c) => c.startsWith("switch")));
});

test("switch-back failure: ok, but the target stays active", async () => {
  const { ops } = fakeOps({ switchError: "busy" });
  const r = await relogin(N, A, ops);
  assert.deepEqual(r, { kind: "ok", activeChanged: true, restoreError: "busy" });
});

test("needsRelogin matches cswap's dead-token note only", () => {
  assert.equal(
    needsRelogin([
      "re-login needed — refresh token dead; log in with Claude Code, then run: cswap add",
      "last seen 53% used · 12m ago",
    ]),
    true,
  );
  assert.equal(
    needsRelogin(["token expired — refresh deferred this pass; retries automatically"]),
    false,
  );
  assert.equal(needsRelogin(["5h:   4%   resets 14:09         in 4h 27m"]), false);
  assert.equal(needsRelogin([]), false);
});
