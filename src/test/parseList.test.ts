import * as assert from "node:assert/strict";
import { test } from "node:test";

// cswap.ts imports `vscode` (for settings); parseList itself doesn't need it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  return request === "vscode" ? {} : realLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseList } = require("../cswap") as typeof import("../cswap");

// Lines rendered by cswap 0.27.2's own _usage_entry_lines (ANSI included).
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";
const LIST = [
  "Accounts:",
  "  1: dead@example.com [Dead Org]",
  `     ${DIM}re-login needed — refresh token dead; log in with Claude Code, then run: cswap add${OFF}`,
  `     ${DIM}└${OFF} \x1b[38;5;250mlast seen 53% used · 12m ago${OFF}`,
  "",
  "  2: live@example.com [Live Org] (active)",
  "     ├ 5h:   4%   resets 14:09         in 4h 27m",
  "     └ 7d:   2%   resets Oct 21 20:59  in 2d 11h · 9m ago",
  "",
  "  3: slow@example.com [Slow Org]",
  `     ${DIM}token expired — refresh deferred this pass; retries automatically${OFF}`,
  "",
  "Running instances:",
  "  ● CLI   ~/x  (1 session)",
].join("\n");

test("parseList flags only the dead-token account", () => {
  const accounts = parseList(LIST);
  assert.deepEqual(
    accounts.map((a) => [a.number, a.email, a.active, a.needsRelogin]),
    [
      [1, "dead@example.com", false, true],
      [2, "live@example.com", true, false],
      [3, "slow@example.com", false, false],
    ],
  );
  assert.equal(accounts[0].usage[1], "last seen 53% used · 12m ago");
});
