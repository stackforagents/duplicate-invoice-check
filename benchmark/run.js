/* Run every scorable check against the benchmark ledger and write results.json.
   "As documented" models implement the rule a vendor's own help page describes, exactly and no more. They are not
   the vendor's software: they say what that rule would catch on this ledger. Each model's source quote lives in
   models.json next to this file, so the page and the README cite the same thing.
   Run: node benchmark/run.js */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const DupCheck = require("../src/dupcheck.js");
const { score } = require("./score.js");

const dir = __dirname;
const key = JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8"));
const parsed = DupCheck.parseCsv(fs.readFileSync(path.join(dir, "ledger.csv"), "utf8"));
const mapping = DupCheck.detectColumns(parsed.headers);
const invoices = DupCheck.readInvoices(parsed.rows, mapping, {}).invoices;
const models = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf8"));

/* Exact-field rules: a later row is flagged when an earlier row of the same supplier shares every listed field,
   compared as the system would (exact text, after trimming; amounts to the cent; dates to the day). */
function exactFields(fields) {
  return function (rows) {
    const seen = new Map();
    const flagged = [];
    rows.slice().sort((a, b) => (a.dateMs || 0) - (b.dateMs || 0) || a.index - b.index).forEach((inv) => {
      if (inv.amount <= 0) { return; }
      const parts = fields.map((f) => f === "supplier" ? inv.supplier.trim() : f === "reference" ? inv.reference.trim() : f === "amount" ? inv.amount.toFixed(2) : f === "date" ? String(inv.dateMs) : "");
      const k = parts.join("\u0000");
      if (seen.has(k)) { flagged.push(inv.index + 2); } else { seen.set(k, inv.index); }
    });
    return flagged;
  };
}

/* Case-insensitive variant: some systems compare references without regard to case. */
function exactFieldsCaseless(fields) {
  const inner = exactFields(fields);
  return function (rows) {
    return inner(rows.map((inv) => ({ ...inv, supplier: inv.supplier.toLowerCase(), reference: inv.reference.toLowerCase() })));
  };
}

function ours(windowDays) {
  return function (rows) { return DupCheck.findDuplicates(rows, { windowDays }).map((pair) => pair.suspect.index + 2); };
}

const RUNNERS = {
  "none": function () { return []; },
  "exact:reference": exactFields(["reference"]),
  "exact:supplier+reference": exactFields(["supplier", "reference"]),
  "exact:supplier+reference+date": exactFields(["supplier", "reference", "date"]),
  "exact:supplier+reference:caseless": exactFieldsCaseless(["supplier", "reference"]),
  "exact:supplier+reference+amount": exactFields(["supplier", "reference", "amount"]),
  "exact:supplier+reference+amount+date": exactFields(["supplier", "reference", "amount", "date"]),
  "ours:30": ours(30),
  "ours:60": ours(60),
};

const results = { seed: key.seed, rows: key.rows, planted: key.counts, models: [] };
models.forEach((model) => {
  const runner = RUNNERS[model.runner];
  if (!runner) { results.models.push({ ...model, scored: false, reason: `no runner ${model.runner}` }); return; }
  const flagged = runner(invoices);
  results.models.push({ ...model, scored: true, result: score(key, flagged) });
});
fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 1) + "\n");
results.models.forEach((m) => {
  if (!m.scored) { console.log(`${m.id}: not scored (${m.reason})`); return; }
  const r = m.result;
  console.log(`${m.id.padEnd(44)} flagged ${String(r.flagged).padStart(4)}  found ${String(r.found).padStart(3)}/${r.planted}  precision ${r.precision.toFixed(3)}  recall ${r.recall.toFixed(3)}  false alarms ${r.false_alarms}`);
});
