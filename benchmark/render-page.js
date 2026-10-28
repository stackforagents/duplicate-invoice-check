/* Writes the benchmark page for the site from results.json and models.json, so the numbers on the page are
   always the numbers the scorer produced. Run: node benchmark/render-page.js [out.md] */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const results = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
const out = process.argv[2] || path.join(dir, "duplicate-invoice-benchmark.md");

const KIND_LABEL = {
  "resend-new-number": "Sent again with a new number, within 20 days",
  "number-variant": "Same number with a space, dash, case or leading zero changed",
  "supplier-variant": "Same number and amount, supplier spelled differently",
  "credit-cancelled-resent": "Cancelled by a credit note, replaced, then the original sent again",
  "resend-outside-30-days": "Sent again with a new number, 35 to 70 days later",
  "same-number-amount-corrected": "Same number, the amount changed a little",
  "entered-twice-same-day": "The same invoice entered twice on the same day",
};
const TRAP_LABEL = {
  "monthly-fee": "a fixed monthly fee",
  "weekly-charge": "a fixed weekly charge",
  "credit-note": "a credit note",
  "replacement": "the replacement invoice after a credit note",
  "same-amount-new-order": "a new order for the same amount, days apart",
  "other-supplier-same-amount": "another supplier, same amount, same day",
};
const pct = (n) => `${Math.round(n * 100)}%`;
const scored = results.models.filter((m) => m.scored);
const ours30 = scored.find((m) => m.id === "ours-30");
const ours60 = scored.find((m) => m.id === "ours-60");
const documented = scored.filter((m) => m.kind === "documented");
const planted = ours30.result.planted;
const kinds = Object.keys(ours30.result.by_kind);
const trapKinds = Object.keys(results.planted.traps_by_kind);
const trapsTotal = Object.values(results.planted.traps_by_kind).reduce((a, b) => a + b, 0);

const lines = [];
lines.push("---");
lines.push("title: Duplicate-invoice detection benchmark");
lines.push(`summary: One synthetic year of a purchase ledger with ${planted} planted duplicates of six kinds and ${trapsTotal} planted traps. The scores of our free check and of the duplicate rules accounting systems document, with the ledger, the answer key and the scorer open for anyone to rerun.`);
lines.push("updated: 2026-10-28");
lines.push("---");
const docRecalls = documented.map((m) => m.result.recall);
const hardKinds = ["resend-new-number", "number-variant", "supplier-variant"].filter((k) => documented.every((m) => m.result.by_kind[k].found === 0)).map((k) => KIND_LABEL[k].toLowerCase());
lines.push(`**The short answer.** On this ledger, the duplicate rules the accounting systems document find between ${pct(Math.min(...docRecalls))} and ${pct(Math.max(...docRecalls))} of the planted duplicates, and none of them finds these kinds: ${hardKinds.join("; ")}. Our free check finds ${pct(ours30.result.recall)} with its default 30-day window and ${pct(ours60.result.recall)} with a 60-day window, at ${pct(ours30.result.precision)} to ${pct(ours60.result.precision)} precision. Its only false alarms are new orders for the same amount a few days apart, which a person clears from the hold list. The ledger, the key and the scorer are public, so anyone, including the vendors named below, can rerun it and send a result.`);
lines.push("");
lines.push("## The scores");
lines.push("");
lines.push("| Check | What it compares | Found | Precision | Recall | False alarms |");
lines.push("|---|---|---|---|---|---|");
scored.forEach((m) => {
  const r = m.result;
  lines.push(`| ${m.label} | ${m.compares} | ${r.found} of ${r.planted} | ${r.precision.toFixed(2)} | ${r.recall.toFixed(2)} | ${r.false_alarms} |`);
});
lines.push("");
lines.push("Precision: of the rows a check flagged, the share that were planted duplicates. Recall: of the planted duplicates, the share it found. A false alarm is a flagged row that is not a planted duplicate.");
lines.push("");
lines.push("## By kind of duplicate");
lines.push("");
lines.push(`| Kind (${planted / kinds.length} planted each) | ${scored.map((m) => m.short).join(" | ")} |`);
lines.push(`|---|${scored.map(() => "---").join("|")}|`);
kinds.forEach((k) => {
  lines.push(`| ${KIND_LABEL[k] || k} | ${scored.map((m) => `${m.result.by_kind[k].found}`).join(" | ")} |`);
});
lines.push("");
lines.push("## What the ledger holds");
lines.push("");
lines.push(`- **${results.rows} rows**, one synthetic year, 40 invented suppliers with three billing habits: ad hoc invoices, a fixed monthly fee, a fixed weekly charge. Every name and amount is made up.`);
lines.push(`- **${planted} planted duplicates**, ${planted / kinds.length} of each of the six kinds in the table above.`);
lines.push(`- **${trapsTotal} planted traps** that look like duplicates and are not: ${trapKinds.map((k) => `${TRAP_LABEL[k] || k} (${results.planted.traps_by_kind[k]})`).join(", ")}. A check that flags them makes work for a person.`);
lines.push("- Four columns, as most exports have them: supplier, invoice number, invoice date, total. Credit notes are negative totals.");
lines.push("- The file is regenerated from a seed, so the committed ledger and key are reproducible to the byte.");
lines.push("");
lines.push("## How the vendor rules were scored");
lines.push("");
lines.push("We did not run the vendors' software. Each \"as documented\" row runs the rule the vendor's own help page describes, exactly and no more, on this ledger. If a page says the check compares the supplier and the bill number, the row flags a later bill whose supplier and number match an earlier one to the letter. The quotes:");
lines.push("");
documented.forEach((m) => {
  if (m.quote) { lines.push(`- **${m.label}.** ${m.quote_intro || "Their help page says:"} "${m.quote}" ([source](${m.url}))${m.note ? " " + m.note : ""}`); }
});
const unscored = results.models.filter((m) => !m.scored);
if (unscored.length) {
  lines.push("");
  lines.push("Not scored, because no public page states what their check compares: " + unscored.map((m) => m.label).join(", ") + ". Several say their check uses more than exact matches, which is exactly what this ledger tests. Any of them can run the ledger and send the result; it goes on this page as sent.");
}
lines.push("");
lines.push("## Run it yourself");
lines.push("");
lines.push("Everything is in the open repository, under an MIT licence: the generator, the ledger, the key, the scorer and our check.");
lines.push("");
lines.push("- Score your own tool: flag rows in the ledger, write the row numbers to a file, run the scorer against the key.");
lines.push("- Score ours: run the check on the ledger with the command-line tool and score the output.");
lines.push("- Send a result: email the run file and the name of the tool. We publish it on this page, as sent, with the date it arrived.");
lines.push("");
lines.push("Repository: [github.com/stackforagents/duplicate-invoice-check](https://github.com/stackforagents/duplicate-invoice-check). The free check that scored above runs in your browser on your own export: [duplicate invoice check](/duplicate-invoice-check).");
lines.push("");
lines.push("## What this benchmark does not say");
lines.push("");
lines.push("- It scores rules on one synthetic ledger. A real ledger has its own habits, and the right date window is a choice.");
lines.push("- It says nothing about how a vendor's software behaves beyond the rule its help page documents. Vendors often do more than they document; that is why the ledger is public.");
lines.push("- A check with no false alarms at all is usually too loose. The hold list exists so a person decides.");
lines.push("");
lines.push("The Proof runs the same checks on your real ledger, with the duplicates already paid, the rule that let them through and a hold list every week: [arm price], 5 working days, in shadow mode. The [sample day-5 output](/sample-duplicate-hold-list) shows what you get.");
lines.push("");
lines.push("Send us the job in the form below and a plan with a fixed price comes back within 24 hours.");
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
