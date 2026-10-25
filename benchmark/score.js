/* Score any duplicate check against the benchmark key.
   A run is a list of flagged spreadsheet row numbers (header = row 1). Precision: of the rows flagged, how many are
   planted duplicates. Recall: of the planted duplicates, how many were flagged, overall and per kind. False alarms
   are counted per trap kind, and anything else flagged is "other".
   Node: const { score } = require("./score.js"); score(key, flaggedRows) */
"use strict";

function score(key, flaggedRows) {
  const flagged = new Set(flaggedRows.map(Number));
  const planted = new Map();
  key.duplicates.forEach((d) => d.duplicates.forEach((row) => planted.set(row.row, d.kind)));
  const traps = new Map();
  key.traps.forEach((t) => traps.set(t.row.row, t.kind));

  const byKind = {};
  key.duplicates.forEach((d) => { byKind[d.kind] = byKind[d.kind] || { planted: 0, found: 0 }; });
  let found = 0, valueFound = 0, valuePlanted = 0;
  planted.forEach((kind, row) => {
    byKind[kind].planted += 1;
    const amount = key.duplicates.flatMap((d) => d.duplicates).find((r) => r.row === row).amount;
    valuePlanted += amount;
    if (flagged.has(row)) { found += 1; byKind[kind].found += 1; valueFound += amount; }
  });

  const falseAlarms = { other: 0 };
  key.traps.forEach((t) => { falseAlarms[t.kind] = 0; });
  let falseTotal = 0;
  flagged.forEach((row) => {
    if (planted.has(row)) { return; }
    falseTotal += 1;
    if (traps.has(row)) { falseAlarms[traps.get(row)] += 1; } else { falseAlarms.other += 1; }
  });

  const total = planted.size;
  const precision = flagged.size ? found / flagged.size : 0;
  const recall = total ? found / total : 0;
  Object.keys(byKind).forEach((k) => { byKind[k].recall = byKind[k].planted ? byKind[k].found / byKind[k].planted : 0; });
  return {
    flagged: flagged.size, found, planted: total, false_alarms: falseTotal,
    precision: round3(precision), recall: round3(recall),
    value_planted: round2(valuePlanted), value_found: round2(valueFound), value_recall: round3(valuePlanted ? valueFound / valuePlanted : 0),
    by_kind: byKind, false_alarms_by_trap: falseAlarms,
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { score };

if (require.main === module) {
  const fs = require("node:fs");
  const [keyPath, runPath] = process.argv.slice(2);
  if (!keyPath || !runPath) { process.stderr.write("usage: node benchmark/score.js key.json run.json   (run.json = [row numbers] or {\"flagged\": [...]})\n"); process.exit(1); }
  const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  process.stdout.write(JSON.stringify(score(key, Array.isArray(run) ? run : run.flagged), null, 1) + "\n");
}
