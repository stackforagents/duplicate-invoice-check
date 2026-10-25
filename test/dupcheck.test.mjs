// The duplicate-invoice rules, checked against the sample hold list (20 synthetic rows) plus the two rows the
// sample page refers to but does not show: the earlier waste invoice WC-1150 and the credit note CN-2210.
// Run: node --test tests/dupcheck.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DupCheck = require("../src/dupcheck.js");

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const SAMPLE_CSV = readFileSync(fileURLToPath(new URL("../sample/sample-purchase-ledger.csv", import.meta.url)), "utf8");

function run(csv, options) {
  const parsed = DupCheck.parseCsv(csv);
  const mapping = DupCheck.detectColumns(parsed.headers);
  return DupCheck.check(parsed.rows, mapping, options);
}

test("the sample hold list holds rows 10, 12, 15 and 19 and nothing else", () => {
  const result = run(SAMPLE_CSV, { windowDays: 30 });
  const held = result.pairs.map((pair) => pair.suspect.index + 1).sort((a, b) => a - b);
  assert.deepEqual(held, [10, 12, 15, 19]);
  assert.equal(result.summary.rowsChecked, 22);
  assert.equal(result.summary.suspected, 4);
  assert.equal(result.summary.value, 7860.35);
});

test("each held row carries the rule the sample page gives for it", () => {
  const result = run(SAMPLE_CSV, { windowDays: 30 });
  const byRow = Object.fromEntries(result.pairs.map((pair) => [pair.suspect.index + 1, pair]));
  assert.equal(byRow[19].rule, "A");
  assert.match(byRow[19].reason, /same invoice number as DG-10482/);
  assert.equal(byRow[12].rule, "B");
  assert.match(byRow[12].reason, /PK-7714, 2 days apart/);
  assert.equal(byRow[10].rule, "B");
  assert.match(byRow[10].reason, /WC-1150, 28 days apart/);
  assert.equal(byRow[15].rule, "D");
  assert.match(byRow[15].reason, /Credit note CN-2210/);
});

test("the date window decides whether the monthly fee is held", () => {
  const tight = run(SAMPLE_CSV, { windowDays: 14 });
  assert.deepEqual(tight.pairs.map((pair) => pair.suspect.index + 1).sort((a, b) => a - b), [12, 15, 19]);
});

test("column detection reads common export headers", () => {
  assert.deepEqual(DupCheck.detectColumns(["Supplier", "Invoice Number", "Invoice Date", "Total"]),
    { supplier: 0, reference: 1, date: 2, amount: 3 });
  assert.deepEqual(DupCheck.detectColumns(["Contact Name", "Reference", "Date", "Gross", "Net"]),
    { supplier: 0, reference: 1, date: 2, amount: 3 });
  assert.deepEqual(DupCheck.detectColumns(["Vendor", "Document Number", "Posting Date", "Amount"]),
    { supplier: 0, reference: 1, date: 2, amount: 3 });
  assert.deepEqual(DupCheck.detectColumns(["Name", "Memo", "Qty"]), { supplier: 0, reference: -1, date: -1, amount: -1 });
});

test("amounts in both thousands styles, brackets and currency signs read the same", () => {
  assert.equal(DupCheck.parseAmount("1,234.56"), 1234.56);
  assert.equal(DupCheck.parseAmount("1.234,56"), 1234.56);
  assert.equal(DupCheck.parseAmount("£395.00"), 395);
  assert.equal(DupCheck.parseAmount("(395.00)"), -395);
  assert.equal(DupCheck.parseAmount("395,00"), 395);
  assert.equal(DupCheck.parseAmount("EUR 2.368,80"), 2368.8);
  assert.equal(DupCheck.parseAmount(""), null);
  assert.equal(DupCheck.parseAmount("n/a"), null);
});

test("dates in ISO, day-first, month-first and Excel serial form read the same day", () => {
  const day = Date.UTC(2026, 9, 7);
  assert.equal(DupCheck.parseDate("2026-10-07"), day);
  assert.equal(DupCheck.parseDate("07/10/2026"), day);
  assert.equal(DupCheck.parseDate("10/07/2026", false), day);
  assert.equal(DupCheck.parseDate("25/10/2026"), Date.UTC(2026, 9, 25));
  assert.equal(DupCheck.parseDate(new Date(2026, 9, 7)), day);
  assert.equal(DupCheck.parseDate(46302), Date.UTC(2026, 9, 7));
  assert.equal(DupCheck.parseDate("not a date"), null);
});

test("references and suppliers normalise the way a person reads them", () => {
  assert.equal(DupCheck.normaliseReference("DG 10482"), DupCheck.normaliseReference("dg-10482"));
  assert.equal(DupCheck.normaliseReference("INV-000123"), DupCheck.normaliseReference("INV123"));
  assert.equal(DupCheck.normaliseSupplier("Packaging Supplier C Ltd."), DupCheck.normaliseSupplier("PACKAGING SUPPLIER C"));
  assert.equal(DupCheck.normaliseSupplier("Smith & Sons B.V."), "smith and sons");
});

test("a differently spelled supplier with the same number and amount is caught by rule C", () => {
  const csv = "Supplier,Invoice,Date,Amount\nAcme Trading,INV-77,2026-10-01,100.00\nACME Trading Group,INV-77,2026-10-03,100.00\n";
  const result = run(csv, {});
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].rule, "C");
});

test("rows without an amount are skipped and counted, never flagged", () => {
  const csv = "Supplier,Invoice,Date,Amount\nA,1,2026-10-01,10.00\nA,2,2026-10-01,\nA,3,2026-10-02,10.00\n";
  const result = run(csv, {});
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.rowsChecked, 2);
  assert.equal(result.pairs.length, 1);
});

test("semicolon exports and quoted line breaks parse", () => {
  const parsed = DupCheck.parseCsv('Supplier;Invoice;Date;Amount\r\n"Big; Co";"A\n1";2026-01-02;"1.000,00"\r\n');
  assert.deepEqual(parsed.headers, ["Supplier", "Invoice", "Date", "Amount"]);
  assert.deepEqual(parsed.rows[0], ["Big; Co", "A\n1", "2026-01-02", "1.000,00"]);
});

test("the hold list CSV has one line per suspected row with its reason", () => {
  const result = run(SAMPLE_CSV, { windowDays: 30 });
  const lines = DupCheck.toCsv(result.pairs).trim().split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "row,supplier,invoice_number,date,amount,rule,matches_row,matches_invoice_number,reason");
  assert.match(lines[1], /^20,Dry goods supplier E,DG 10482,2026-10-09,3912.15,A,6,DG-10482,/);  // spreadsheet rows, header is row 1
});

test("nothing it is given is changed", () => {
  const parsed = DupCheck.parseCsv(SAMPLE_CSV);
  const before = JSON.stringify(parsed);
  DupCheck.check(parsed.rows, DupCheck.detectColumns(parsed.headers), { windowDays: 30 });
  assert.equal(JSON.stringify(parsed), before);
});

test("a steady weekly or monthly charge is a series, not a resend; two in one period is held", () => {
  const weekly = ["Supplier,Invoice,Date,Amount"];
  for (let i = 0; i < 8; i += 1) { weekly.push(`Haulage D,HD-${100 + i},2026-0${i < 4 ? 1 : 2}-${String(3 + (i % 4) * 7).padStart(2, "0")},860.00`); }
  const clean = run(weekly.join("\n") + "\n", { windowDays: 30 });
  assert.equal(clean.pairs.length, 0);
  const doubled = run(weekly.join("\n") + "\nHaulage D,HD-199,2026-01-05,860.00\n", { windowDays: 30 });
  assert.equal(doubled.pairs.length, 1);
  assert.match(doubled.pairs[0].reason, /every 7 days; two in one period/);
});

test("zeros inside a number are not leading zeros", () => {
  assert.notEqual(DupCheck.normaliseReference("BD/25013"), DupCheck.normaliseReference("BD-25103"));
  assert.equal(DupCheck.normaliseReference("BD-025103"), DupCheck.normaliseReference("BD-25103"));
  assert.equal(DupCheck.normaliseReference("INV-000123"), "INV123");
});

test("an invoice cancelled by a credit note and sent again: the later copy is the duplicate, named with the credit note", () => {
  const csv = "Supplier,Invoice,Date,Amount\nChilled H,CH-1,2026-10-01,100.00\nChilled H,CN-9,2026-10-03,-100.00\nChilled H,CH-2,2026-10-04,100.00\nChilled H,CH-1,2026-10-09,100.00\n";
  const result = run(csv, { windowDays: 30 });
  assert.deepEqual(result.pairs.map((p) => [p.suspect.index + 1, p.rule]), [[4, "A"]]);
  assert.match(result.pairs[0].reason, /Credit note CN-9 already cancelled the first one/);
});
