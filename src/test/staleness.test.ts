import * as assert from "node:assert/strict";
import { test } from "node:test";
import { describeStale, formatStale, formatTime, parseUsageCache, splitAge } from "../staleness";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("node:module");
const realLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  return request === "vscode" ? {} : realLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseList } = require("../cswap") as typeof import("../cswap");

const NOW = Date.parse("2026-10-20T12:07:00");
const sec = (iso: string) => Date.parse(iso) / 1000;

// Shape of cswap 0.27.2's cache/usage.json; slot 3 is an orphan of a removed account.
const CACHE = JSON.stringify({
  schemaVersion: 2,
  accounts: {
    "1": {
      email: "work@example.com",
      lastError: "http-429",
      backoffUntil: sec("2026-10-20T13:18:02"),
      nextPollAt: sec("2026-10-20T11:08:03"),
    },
    "2": { email: "home@example.com", lastError: null, nextPollAt: sec("2026-10-20T12:11:01") },
    "3": { email: "work@example.com", lastError: "invalid_grant", backoffUntil: 1 },
  },
});

const LIST = [
  "Accounts:",
  "  1: work@example.com [Work Org] (active)",
  "     └ $$:  49%   $123.16 / $250.00 · 1h ago",
  "",
  "  2: home@example.com [Home Org]",
  "     ├ 5h:   0%",
  "     └ 7d:   3%   resets Oct 21 20:59  in 1d 8h",
  "",
  "Running instances:",
].join("\n");

test("splitAge strips cswap's stale marker but keeps 'last seen' lines", () => {
  assert.deepEqual(splitAge("$$:  49%   $123.16 / $250.00 · 1h ago"), {
    line: "$$:  49%   $123.16 / $250.00",
    age: "1h",
  });
  assert.deepEqual(splitAge("7d:   3%   resets Oct 21 20:59  in 1d 8h"), {
    line: "7d:   3%   resets Oct 21 20:59  in 1d 8h",
  });
  assert.deepEqual(splitAge("last seen 53% used · 12m ago"), {
    line: "last seen 53% used · 12m ago",
  });
});

test("parseList explains a rate-limited stale reading from the cache", () => {
  const [work, home] = parseList(LIST, parseUsageCache(CACHE), NOW);
  assert.deepEqual(work.usage, ["$$:  49%   $123.16 / $250.00"]);
  assert.equal(work.stale?.age, "1h");
  assert.equal(work.stale?.reason, "rate-limited by Anthropic");
  assert.equal(work.stale?.retryAt, Date.parse("2026-10-20T13:18:02"));
  // A countdown to reset is not staleness.
  assert.equal(home.stale, undefined);
});

test("describeStale falls back when the cache has nothing useful", () => {
  assert.deepEqual(describeStale("2h", undefined, NOW), {
    age: "2h",
    reason: "waiting for next refresh",
    retryAt: undefined,
  });
  const failed = describeStale("2h", { lastError: "timeout", backoffUntil: NOW / 1000 - 60 }, NOW);
  assert.equal(failed.reason, "last fetch failed (timeout)");
  assert.equal(failed.retryAt, undefined, "a past retry time is not shown");
});

test("formatStale reads as one line", () => {
  const s = describeStale("1h", { lastError: "http-429" }, NOW);
  assert.equal(formatStale(s, NOW), "stale 1h · rate-limited by Anthropic");
});

test("formatTime matches cswap's 24h clock, with a date only on other days", () => {
  assert.equal(formatTime(Date.parse("2026-10-20T13:18:02"), NOW), "13:18");
  assert.equal(formatTime(Date.parse("2026-10-21T09:05:00"), NOW), "Oct 21 09:05");
});
