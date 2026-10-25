#!/usr/bin/env node
/* Command line: node bin/dupcheck.js ledger.csv [--window 30] [--month-first] [--csv hold-list.csv]
   Reads a CSV export, prints the summary and the suspected rows, optionally writes the hold list. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const DupCheck = require(path.join(__dirname, "..", "src", "dupcheck.js"));

function usage(code) {
  process.stderr.write("usage: dupcheck <ledger.csv> [--window DAYS] [--month-first] [--csv OUT.csv]\n");
  process.exit(code);
}

const args = process.argv.slice(2);
if (!args.length || args.includes("--help") || args.includes("-h")) { usage(args.length ? 0 : 1); }
const file = args[0];
const options = { windowDays: DupCheck.DEFAULT_WINDOW_DAYS, dayFirst: true };
let out = "";
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === "--window") { options.windowDays = parseInt(args[++i], 10); }
  else if (args[i] === "--month-first") { options.dayFirst = false; }
  else if (args[i] === "--csv") { out = args[++i]; }
  else { usage(1); }
}
if (!Number.isFinite(options.windowDays) || options.windowDays < 0) { usage(1); }

const parsed = DupCheck.parseCsv(fs.readFileSync(file, "utf8"));
const mapping = DupCheck.detectColumns(parsed.headers);
if (mapping.amount < 0 || (mapping.supplier < 0 && mapping.reference < 0)) {
  process.stderr.write("could not find the amount column and a supplier or invoice number column in: " + parsed.headers.join(", ") + "\n");
  process.exit(2);
}
const result = DupCheck.check(parsed.rows, mapping, options);
const s = result.summary;
process.stdout.write(`rows checked: ${s.rowsChecked}  skipped (no amount): ${s.skipped}  suspected: ${s.suspected}  value: ${s.value.toFixed(2)}\n`);
process.stdout.write(`by rule: A same number ${s.byRule.A}, B same amount within ${options.windowDays} days ${s.byRule.B}, C supplier spelled differently ${s.byRule.C}, D credit note ${s.byRule.D}\n`);
for (const pair of result.pairs) {
  process.stdout.write(`row ${pair.suspect.index + 2}  ${pair.suspect.supplier}  ${pair.suspect.reference}  ${pair.amount.toFixed(2)}  [${pair.rule}] ${pair.reason}\n`);
}
if (out) { fs.writeFileSync(out, DupCheck.toCsv(result.pairs)); process.stdout.write(`hold list written to ${out}\n`); }
process.exit(result.pairs.length ? 1 : 0);
