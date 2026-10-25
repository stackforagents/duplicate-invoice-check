/* The benchmark ledger: one synthetic year of a purchase ledger with planted duplicates and planted traps.
   Deterministic from a seed, so anyone can regenerate the same file. Writes ledger.csv and key.json.
   Run: node benchmark/generate.js [--seed 23] [--out benchmark] */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const seed = parseInt(args[args.indexOf("--seed") + 1] || "23", 10);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : __dirname;

/* mulberry32: small, deterministic */
function rng(seedValue) {
  let a = seedValue >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(seed);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const money = (lo, hi) => Math.round((lo + random() * (hi - lo)) * 100) / 100;

const YEAR = 2025;
const DAY = 24 * 60 * 60 * 1000;
const start = Date.UTC(YEAR, 0, 1);
function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dayOf(ms) { return new Date(ms).getUTCDay(); }
function dateIn(monthIndex) { return Date.UTC(YEAR, monthIndex, between(1, 28)); }

/* Forty suppliers, three billing habits: ad hoc, fixed monthly fee, fixed weekly charge. Names are invented. */
const CATEGORIES = ["Dairy", "Fresh produce", "Packaging", "Haulage", "Dry goods", "Cleaning", "Frozen foods", "Chilled foods",
  "Drinks", "Bakery", "Energy", "Pallet", "Waste", "Meat", "Fish", "Catering equipment", "Uniform", "Pest control", "Insurance", "Software"];
const SUFFIX = ["Ltd", "Limited", "Supplies", "& Sons", "Group", "Trading", "Services", "Co"];
const suppliers = [];
for (let i = 0; i < 40; i += 1) {
  const cat = CATEGORIES[i % CATEGORIES.length];
  const letter = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? "2" : "");
  const name = `${cat} supplier ${letter} ${pick(SUFFIX)}`.replace(/ Co$/, " Co.");
  const habit = i % 10 === 3 ? "monthly" : i % 10 === 7 ? "weekly" : "adhoc";
  const prefix = cat.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) + letter.replace("2", "");
  suppliers.push({ name, habit, prefix, next: between(1000, 90000), monthlyFee: money(120, 1800), weeklyCharge: money(300, 1200) });
}
function nextNumber(supplier) {
  supplier.next += between(1, 9);
  const sep = pick(["-", "-", "-", "/", ""]);
  return `${supplier.prefix}${sep}${supplier.next}`;
}

/* rows: { supplier, number, date (ms), amount, kind, group } ; kind "" for ordinary rows */
const rows = [];
const key = { duplicates: [], traps: [] };
function add(row) { rows.push(row); return row; }

/* 1. The ordinary year. */
suppliers.forEach((s) => {
  if (s.habit === "monthly") {
    for (let m = 0; m < 12; m += 1) {
      add({ supplier: s.name, number: nextNumber(s), date: Date.UTC(YEAR, m, between(1, 5)), amount: s.monthlyFee, kind: "trap:monthly-fee", group: `${s.prefix}-monthly` });
    }
  } else if (s.habit === "weekly") {
    for (let d = start + 4 * DAY; d < Date.UTC(YEAR + 1, 0, 1); d += 7 * DAY) {
      add({ supplier: s.name, number: nextNumber(s), date: d, amount: s.weeklyCharge, kind: "trap:weekly-charge", group: `${s.prefix}-weekly` });
    }
  } else {
    const count = between(20, 60);
    for (let n = 0; n < count; n += 1) {
      add({ supplier: s.name, number: nextNumber(s), date: dateIn(between(0, 11)), amount: money(45, 6500), kind: "", group: "" });
    }
  }
});
const adhoc = suppliers.filter((s) => s.habit === "adhoc");
const ordinary = () => rows.filter((r) => r.kind === "" && r.amount > 0);

/* 2. Planted duplicates, twenty of each kind. */
function plant(kind, make) {
  for (let n = 0; n < 20; n += 1) {
    const original = pick(ordinary().filter((r) => r.date < Date.UTC(YEAR, 10, 1)));
    const group = `${kind}-${n + 1}`;
    original.group = original.group || group;
    const planted = make(original, group);
    planted.forEach((row) => { row.kind = `dup:${kind}`; row.group = group; add(row); });
    key.duplicates.push({ kind, group, original: original, duplicates: planted });
  }
}
plant("resend-new-number", (o) => [{ supplier: o.supplier, number: nextNumber(suppliers.find((s) => s.name === o.supplier)), date: o.date + between(1, 20) * DAY, amount: o.amount }]);
plant("number-variant", (o) => {
  const variants = [
    o.number.replace("-", " "), o.number.replace("-", ""), o.number.toLowerCase(), o.number.replace(/(\d+)$/, (d) => "0" + d),
    o.number.replace("-", "/"), o.number.replace(/(\d+)$/, (d) => "00" + d) ];
  var differing = variants.filter((v) => v !== o.number);
  return [{ supplier: o.supplier, number: pick(differing.length ? differing : [o.number + " "]), date: o.date + between(2, 40) * DAY, amount: o.amount }];
});
plant("supplier-variant", (o) => {
  const base = o.supplier.replace(/ (Ltd|Limited|& Sons|Group|Trading|Services|Co\.|Supplies)$/, "");
  const variants = [base.toUpperCase(), `${base} LTD`, `${base} Group`, `${base}`, base.replace(" supplier ", " Supplier ")];
  return [{ supplier: pick(variants.filter((v) => v !== o.supplier)), number: o.number, date: o.date + between(1, 30) * DAY, amount: o.amount }];
});
plant("credit-cancelled-resent", (o) => {
  const s = suppliers.find((x) => x.name === o.supplier);
  const credit = { supplier: o.supplier, number: `CN-${nextNumber(s)}`, date: o.date + between(2, 10) * DAY, amount: -o.amount, kind: "trap:credit-note", group: "" };
  const replacement = { supplier: o.supplier, number: nextNumber(s), date: credit.date + between(1, 7) * DAY, amount: o.amount, kind: "trap:replacement", group: "" };
  add(credit); add(replacement);
  key.traps.push({ kind: "credit-note", row: credit }); key.traps.push({ kind: "replacement", row: replacement });
  return [{ supplier: o.supplier, number: o.number, date: replacement.date + between(3, 30) * DAY, amount: o.amount }];
});
plant("resend-outside-30-days", (o) => [{ supplier: o.supplier, number: nextNumber(suppliers.find((s) => s.name === o.supplier)), date: o.date + between(35, 70) * DAY, amount: o.amount }]);
plant("same-number-amount-corrected", (o) => [{ supplier: o.supplier, number: o.number, date: o.date + between(1, 15) * DAY, amount: Math.round((o.amount + pick([-1, 1]) * money(0.5, 40)) * 100) / 100 }]);
plant("entered-twice-same-day", (o) => [{ supplier: o.supplier, number: o.number, date: o.date, amount: o.amount }]);

/* 3. Planted traps that are NOT duplicates: the monthly and weekly rows above, the credit notes and replacements,
      plus two kinds that look like a resend but are separate charges. */
for (let n = 0; n < 20; n += 1) {
  const o = pick(ordinary());
  const s = suppliers.find((x) => x.name === o.supplier);
  const row = add({ supplier: o.supplier, number: nextNumber(s), date: o.date + between(1, 20) * DAY, amount: o.amount, kind: "trap:same-amount-new-order", group: `trap-same-amount-${n + 1}` });
  key.traps.push({ kind: "same-amount-new-order", row });
}
for (let n = 0; n < 20; n += 1) {
  const o = pick(ordinary());
  const other = pick(adhoc.filter((s) => s.name !== o.supplier));
  const row = add({ supplier: other.name, number: nextNumber(other), date: o.date, amount: o.amount, kind: "trap:other-supplier-same-amount", group: `trap-other-${n + 1}` });
  key.traps.push({ kind: "other-supplier-same-amount", row });
}
rows.filter((r) => r.kind === "trap:monthly-fee" || r.kind === "trap:weekly-charge").forEach((row) => key.traps.push({ kind: row.kind.slice(5), row }));

/* 4. Shuffle, number the rows, write. Row numbers are spreadsheet rows (header is row 1). */
for (let i = rows.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
rows.sort((a, b) => a.date - b.date || a.supplier.localeCompare(b.supplier) || (a.kind.startsWith("dup:") ? 1 : 0) - (b.kind.startsWith("dup:") ? 1 : 0));
rows.forEach((row, i) => { row.row = i + 2; });

function csvCell(v) { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }
const csv = ["Supplier,Invoice Number,Invoice Date,Total"].concat(rows.map((r) => [r.supplier, r.number, iso(r.date), r.amount.toFixed(2)].map(csvCell).join(","))).join("\n") + "\n";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "ledger.csv"), csv);

const slim = (r) => ({ row: r.row, supplier: r.supplier, number: r.number, date: iso(r.date), amount: r.amount });
const keyOut = {
  seed,
  rows: rows.length,
  duplicates: key.duplicates.map((d) => ({ kind: d.kind, group: d.group, original: slim(d.original), duplicates: d.duplicates.map(slim) })),
  traps: key.traps.map((t) => ({ kind: t.kind, row: slim(t.row) })),
  counts: {
    duplicates_by_kind: key.duplicates.reduce((acc, d) => { acc[d.kind] = (acc[d.kind] || 0) + d.duplicates.length; return acc; }, {}),
    traps_by_kind: key.traps.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] || 0) + 1; return acc; }, {}),
  },
};
fs.writeFileSync(path.join(outDir, "key.json"), JSON.stringify(keyOut, null, 1) + "\n");
console.log(`ledger.csv: ${rows.length} rows; planted duplicates: ${keyOut.duplicates.reduce((n, d) => n + d.duplicates.length, 0)}; traps: ${keyOut.traps.length}; seed ${seed}`);
console.log(JSON.stringify(keyOut.counts));
