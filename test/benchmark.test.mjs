// The benchmark regenerates from its seed and scores the same way every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { score } = require("../benchmark/score.js");
const DupCheck = require("../src/dupcheck.js");
const root = new URL("..", import.meta.url).pathname;

test("seed 23 regenerates the committed ledger and key", () => {
  const out = mkdtempSync(join(tmpdir(), "bench-"));
  execFileSync("node", [join(root, "benchmark/generate.js"), "--seed", "23", "--out", out]);
  assert.equal(readFileSync(join(out, "ledger.csv"), "utf8"), readFileSync(join(root, "benchmark/ledger.csv"), "utf8"));
  assert.equal(readFileSync(join(out, "key.json"), "utf8"), readFileSync(join(root, "benchmark/key.json"), "utf8"));
});

test("the committed results match a fresh run of our check", () => {
  const key = JSON.parse(readFileSync(join(root, "benchmark/key.json"), "utf8"));
  const parsed = DupCheck.parseCsv(readFileSync(join(root, "benchmark/ledger.csv"), "utf8"));
  const invoices = DupCheck.readInvoices(parsed.rows, DupCheck.detectColumns(parsed.headers), {}).invoices;
  const flagged = DupCheck.findDuplicates(invoices, { windowDays: 30 }).map((p) => p.suspect.index + 2);
  const fresh = score(key, flagged);
  const committed = JSON.parse(readFileSync(join(root, "benchmark/results.json"), "utf8")).models.find((m) => m.id === "ours-30").result;
  assert.deepEqual(fresh, committed);
  assert.equal(fresh.planted, 140);
  assert.equal(fresh.false_alarms_by_trap["weekly-charge"], 0);
  assert.equal(fresh.false_alarms_by_trap["monthly-fee"], 0);
});

test("the scorer counts a flagged trap as a false alarm and a flagged plant as found", () => {
  const key = { duplicates: [{ kind: "k", group: "g", original: { row: 2 }, duplicates: [{ row: 5, amount: 10 }] }], traps: [{ kind: "t", row: { row: 7 } }] };
  const r = score(key, [5, 7, 9]);
  assert.equal(r.found, 1); assert.equal(r.false_alarms, 2); assert.equal(r.false_alarms_by_trap.t, 1); assert.equal(r.false_alarms_by_trap.other, 1);
  assert.equal(r.precision, 0.333); assert.equal(r.recall, 1);
});
