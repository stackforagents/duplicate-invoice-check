# duplicate-invoice-check

Four rules that find suspected duplicate supplier invoices in a purchase ledger export, with the reason for every row. Runs in a browser or on the command line. No network, no state, nothing leaves the machine.

Try it without installing anything: [stackforagents.com/duplicate-invoice-check](https://stackforagents.com/duplicate-invoice-check). Drop a CSV or Excel export; the page runs this code in your browser.

## The four checks

| Rule | What it catches | Example |
|---|---|---|
| A | Same supplier, same invoice number. Spaces, dashes, case and leading zeros are ignored. | `DG 10482` and `DG-10482` |
| B | Same supplier, same amount, within a date window, a different number. | the classic resend, two days apart |
| C | Same number and amount, supplier spelled differently. | `Acme Trading` and `ACME Trading Group` |
| D | A credit note for the same supplier and amount already cancelled the invoice. | paying the original pays twice |

Each suspected row is reported once, with the first rule that caught it, next to the row it matches. Monthly fees for a different month show up under rule B on purpose: a hold list with no false alarms means the check is too loose. A person decides.

## Command line

```sh
node bin/dupcheck.js ledger.csv --window 30 --csv hold-list.csv
```

Columns are found by their headers (supplier or vendor, invoice number or reference, date, total or amount). Amounts in both thousands styles, brackets and currency signs are read; dates in ISO, day-first, month-first and Excel serial form. Add `--month-first` for US exports. Exit code 1 when anything is suspected, 0 when clean, 2 when the columns cannot be found.

## In a page

```html
<script src="src/dupcheck.js"></script>
<script>
  const parsed = DupCheck.parseCsv(csvText);
  const mapping = DupCheck.detectColumns(parsed.headers);
  const result = DupCheck.check(parsed.rows, mapping, { windowDays: 30, dayFirst: true });
  // result.summary = { rowsChecked, skipped, suspected, value, byRule }
  // result.pairs   = [{ rule, reason, suspect, original, amount }, ...]
  const holdList = DupCheck.toCsv(result.pairs);
</script>
```

Every function returns new values and changes nothing it was given.

## Tests

```sh
npm test
```

The tests run the rules against `sample/sample-purchase-ledger.csv`, a synthetic week of a UK wholesaler's purchase ledger: 20 invoices plus the earlier invoice and the credit note two of the rules need. The expected hold list is rows 10, 12, 15 and 19, adding up to 7,860.35.

## Running this in production?

This repository is the check only. Confirming each pair on a full ledger, finding why it slipped through and setting the hold rule so it stops is a fixed-price Proof: from 1,500 euro, 5 working days, you own the code. [stackforagents.com](https://stackforagents.com/duplicate-invoice-check)

## Licence

MIT.

## The benchmark

`benchmark/` holds a public benchmark for duplicate-invoice detection: one synthetic year of a purchase ledger (`ledger.csv`, regenerated from a seed by `generate.js`), the answer key (`key.json`: 120 planted duplicates of six kinds and the planted traps that are not duplicates), a scorer (`score.js`: precision, recall, recall per kind, false alarms per trap kind) and the committed results (`results.json`).

```sh
node benchmark/generate.js --seed 23        # rebuilds ledger.csv and key.json, byte for byte
node benchmark/run.js                       # scores this check and the documented vendor rules, writes results.json
node benchmark/score.js benchmark/key.json my-run.json   # scores any tool: my-run.json = [flagged spreadsheet row numbers]
node benchmark/render-page.js               # writes the page the site shows, from results.json
```

The "as documented" rows run the rule a vendor's own help page describes, exactly and no more. They are not the vendor's software. Vendors and anyone else can run the ledger through their tool and send the run file; results are published as sent. The scores are on [stackforagents.com/duplicate-invoice-benchmark](https://stackforagents.com/duplicate-invoice-benchmark).
