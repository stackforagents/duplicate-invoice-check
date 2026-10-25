/* Duplicate-invoice check: the rules, in plain code, with no network and no state.
   Works in a browser (window.DupCheck) and in Node (module.exports). Every function returns new values and
   changes nothing it was given. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); } else { root.DupCheck = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_WINDOW_DAYS = 30;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var LEGAL_SUFFIXES = /\b(ltd|limited|llc|inc|incorporated|plc|gmbh|ag|bv|b\.v|nv|n\.v|sa|s\.a|srl|sarl|sl|s\.l|pty|co|company|corp|corporation|the)\b/g;

  /* Column synonyms, best first. Matching is on the lower-cased header with punctuation removed. */
  var SYNONYMS = {
    supplier: ["supplier name", "vendor name", "supplier", "vendor", "contact name", "payee", "creditor", "account name",
               "contact", "name", "entity name", "company"],
    reference: ["invoice number", "invoice no", "invoice num", "invoice ref", "invoice", "bill number", "bill no", "document number",
                "document no", "doc number", "doc no", "reference number", "reference", "ref no", "ref", "number", "tran id", "transaction id"],
    date: ["invoice date", "document date", "bill date", "transaction date", "tran date", "posting date", "date"],
    amount: ["gross amount", "gross", "invoice total", "total amount", "total", "amount due", "amount", "net amount", "net", "value"]
  };

  function cleanHeader(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* Pick one column per field. Exact synonym wins; then a header that starts with the synonym; then one that contains it. */
  function detectColumns(headers) {
    var cleaned = headers.map(cleanHeader);
    var taken = {};
    var mapping = { supplier: -1, reference: -1, date: -1, amount: -1 };
    ["supplier", "reference", "date", "amount"].forEach(function (field) {
      var list = SYNONYMS[field];
      var found = -1;
      [function (h, s) { return h === s; }, function (h, s) { return h.indexOf(s + " ") === 0; }, function (h, s) { return h.indexOf(s) >= 0; }]
        .some(function (test) {
          return list.some(function (synonym) {
            var i = cleaned.findIndex(function (h, idx) { return !taken[idx] && h && test(h, synonym); });
            if (i >= 0) { found = i; return true; }
            return false;
          });
        });
      if (found >= 0) { mapping[field] = found; taken[found] = true; }
    });
    return mapping;
  }

  /* CSV with quotes, embedded line breaks, and a comma, semicolon or tab delimiter picked from the first line. */
  function detectDelimiter(firstLine) {
    var candidates = [",", ";", "\t", "|"];
    var best = ",", bestCount = -1;
    candidates.forEach(function (d) {
      var n = firstLine.split(d).length - 1;
      if (n > bestCount) { best = d; bestCount = n; }
    });
    return best;
  }

  function parseCsv(text) {
    var source = String(text == null ? "" : text).replace(/^﻿/, "");
    var firstLine = source.split(/\r?\n/, 1)[0] || "";
    var delimiter = detectDelimiter(firstLine);
    var rows = [], row = [], cell = "", inQuotes = false, i = 0;
    while (i < source.length) {
      var ch = source[i];
      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        cell += ch; i += 1; continue;
      }
      if (ch === '"') { inQuotes = true; i += 1; continue; }
      if (ch === delimiter) { row.push(cell); cell = ""; i += 1; continue; }
      if (ch === "\r") { i += 1; continue; }
      if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; continue; }
      cell += ch; i += 1;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    var nonEmpty = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
    if (!nonEmpty.length) { return { headers: [], rows: [] }; }
    return { headers: nonEmpty[0].map(function (h) { return String(h).trim(); }), rows: nonEmpty.slice(1) };
  }

  /* "1.234,56", "1,234.56", "(395.00)", "£395", "-395" all become a number; anything else becomes null. */
  function parseAmount(value) {
    if (typeof value === "number") { return isFinite(value) ? round2(value) : null; }
    var text = String(value == null ? "" : value).trim();
    if (!text) { return null; }
    var negative = /^\(.*\)$/.test(text) || /^-/.test(text) || /-$/.test(text) || /\bCR\b/i.test(text);
    var digits = text.replace(/[^0-9.,]/g, "");
    if (!digits) { return null; }
    var lastComma = digits.lastIndexOf(","), lastDot = digits.lastIndexOf(".");
    var normalised;
    if (lastComma >= 0 && lastDot >= 0) {
      normalised = lastComma > lastDot ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, "");
    } else if (lastComma >= 0) {
      var afterComma = digits.length - lastComma - 1;
      var commaCount = digits.split(",").length - 1;
      normalised = (afterComma === 2 && commaCount === 1) || afterComma === 1 ? digits.replace(",", ".") : digits.replace(/,/g, "");
    } else {
      var dotCount = digits.split(".").length - 1;
      normalised = dotCount > 1 ? digits.replace(/\./g, "") : digits;
    }
    var number = parseFloat(normalised);
    if (!isFinite(number)) { return null; }
    return round2(negative ? -Math.abs(number) : number);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ISO dates, day-first and month-first with / . -, Excel serial numbers, and Date objects. Returns a UTC midnight ms or null. */
  function parseDate(value, dayFirst) {
    if (value instanceof Date) { return isNaN(value.getTime()) ? null : Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()); }
    if (typeof value === "number" && value > 20000 && value < 80000) { return Math.round((value - 25569) * DAY_MS); }
    var text = String(value == null ? "" : value).trim();
    if (!text) { return null; }
    var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) { return utc(+iso[1], +iso[2], +iso[3]); }
    var parts = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (parts) {
      var a = +parts[1], b = +parts[2], y = +parts[3];
      if (y < 100) { y += 2000; }
      var day = a, month = b;
      if (a > 12 && b <= 12) { day = a; month = b; }
      else if (b > 12 && a <= 12) { day = b; month = a; }
      else if (dayFirst === false) { day = b; month = a; }
      return utc(y, month, day);
    }
    var named = Date.parse(text);
    if (!isNaN(named)) { var d = new Date(named); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    return null;
  }

  function utc(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) { return null; }
    var ms = Date.UTC(y, m - 1, d);
    return isNaN(ms) ? null : ms;
  }

  /* "DG 10482", "dg-10482" and "DG-010482" all become "DG10482": case, separators and leading zeros in digit runs go. */
  function normaliseReference(value) {
    return String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]+/g, "").replace(/(^|[A-Z])0+(\d)/g, "$1$2");
  }

  /* "Packaging Supplier C Ltd." and "PACKAGING SUPPLIER C" become the same key. */
  function normaliseSupplier(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/\./g, "").replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ").replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  }

  /* One invoice per row, read through the mapping. Rows with no amount are kept out and counted as skipped. */
  function readInvoices(rows, mapping, options) {
    var dayFirst = !(options && options.dayFirst === false);
    var invoices = [], skipped = 0;
    rows.forEach(function (cells, index) {
      var amount = mapping.amount >= 0 ? parseAmount(cells[mapping.amount]) : null;
      if (amount === null) { skipped += 1; return; }
      invoices.push({
        index: index,
        supplier: mapping.supplier >= 0 ? String(cells[mapping.supplier] == null ? "" : cells[mapping.supplier]).trim() : "",
        reference: mapping.reference >= 0 ? String(cells[mapping.reference] == null ? "" : cells[mapping.reference]).trim() : "",
        dateMs: mapping.date >= 0 ? parseDate(cells[mapping.date], dayFirst) : null,
        amount: amount,
        supplierKey: mapping.supplier >= 0 ? normaliseSupplier(cells[mapping.supplier]) : "",
        referenceKey: mapping.reference >= 0 ? normaliseReference(cells[mapping.reference]) : ""
      });
    });
    return { invoices: invoices, skipped: skipped };
  }

  function daysBetween(a, b) {
    if (a === null || b === null) { return null; }
    return Math.abs(a - b) / DAY_MS;
  }

  function earlierFirst(a, b) {
    if (a.dateMs !== null && b.dateMs !== null && a.dateMs !== b.dateMs) { return a.dateMs < b.dateMs ? [a, b] : [b, a]; }
    return a.index < b.index ? [a, b] : [b, a];
  }

  /* The four checks. Each suspected row is reported once, with the first rule that caught it.
     A: same supplier and same invoice number (the number may hide behind spaces, dashes, case or leading zeros).
     B: same supplier and same amount within the date window, with a different number.
     C: same invoice number and same amount with the supplier spelled differently.
     D: a credit note for the same supplier and amount already cancelled this invoice. */
  function findDuplicates(invoices, options) {
    var windowDays = options && options.windowDays != null ? options.windowDays : DEFAULT_WINDOW_DAYS;
    var flagged = {}, cancelled = {}, creditOf = {}, pairs = [];
    var positives = invoices.filter(function (inv) { return inv.amount > 0; });
    var credits = invoices.filter(function (inv) { return inv.amount < 0; });

    function flag(suspect, original, rule, reason) {
      if (flagged[suspect.index]) { return; }
      flagged[suspect.index] = true;
      pairs.push({ rule: rule, reason: reason, suspect: suspect, original: original, amount: suspect.amount });
    }

    /* D first: each credit note cancels the earliest same-supplier, same-amount invoice dated on or before it
       (by row order when dates are missing). The replacement, issued later, stays clear. */
    var used = {};
    credits.forEach(function (credit) {
      if (!credit.supplierKey) { return; }
      var candidates = positives.filter(function (inv) {
        return !used[inv.index] && inv.supplierKey === credit.supplierKey && inv.amount.toFixed(2) === Math.abs(credit.amount).toFixed(2)
          && (credit.dateMs === null || inv.dateMs === null ? inv.index < credit.index : inv.dateMs <= credit.dateMs);
      });
      if (!candidates.length) { return; }
      candidates.sort(function (a, b) { return (a.dateMs || 0) - (b.dateMs || 0) || a.index - b.index; });
      var invoice = candidates[0];
      used[invoice.index] = true;
      cancelled[invoice.index] = true;
      creditOf[invoice.index] = credit;
      /* If the same number turns up again later, that later copy is the duplicate (rule A says so, naming the
         credit note). The cancelled original is flagged on its own only when it has no later copy. */
      var sentAgain = positives.some(function (other) {
        return other !== invoice && other.supplierKey === invoice.supplierKey && invoice.referenceKey && other.referenceKey === invoice.referenceKey
          && (other.dateMs === null || invoice.dateMs === null ? other.index > invoice.index : other.dateMs > invoice.dateMs);
      });
      if (sentAgain) { return; }
      flag(invoice, credit, "D", "Credit note " + (credit.reference || "(no number)") + " for the same supplier and the same amount already cancelled this invoice. Paying it pays for the same goods twice.");
    });

    var byKey = groupBy(positives, function (inv) { return inv.supplierKey && inv.referenceKey ? inv.supplierKey + "\u0000" + inv.referenceKey : null; });
    eachGroup(byKey, function (group) {
      for (var i = 1; i < group.length; i += 1) {
        var ordered = earlierFirst(group[0], group[i]);
        var amountNote = ordered[0].amount === ordered[1].amount ? "" : " The amount differs, so one of the two may be a correction.";
        var creditNote = creditOf[ordered[0].index] ? " Credit note " + (creditOf[ordered[0].index].reference || "(no number)") + " already cancelled the first one." : "";
        flag(ordered[1], ordered[0], "A", "Same supplier and the same invoice number as " + ordered[0].reference + "." + creditNote + amountNote);
      }
    });

    var bySupplierAmount = groupBy(positives, function (inv) { return inv.supplierKey ? inv.supplierKey + "\u0000" + inv.amount.toFixed(2) : null; });
    eachGroup(bySupplierAmount, function (group) {
      var series = recurringCadence(group);
      for (var i = 0; i < group.length; i += 1) {
        for (var j = i + 1; j < group.length; j += 1) {
          var a = group[i], b = group[j];
          if (a.referenceKey && a.referenceKey === b.referenceKey) { continue; }
          var gap = daysBetween(a.dateMs, b.dateMs);
          if (gap !== null && gap > windowDays) { continue; }
          /* A fixed weekly or monthly charge is a series, not a resend: inside a series only two charges in the
             same period are suspect. */
          if (series !== null && (gap === null || gap >= series / 2)) { continue; }
          var ordered = earlierFirst(a, b);
          if (cancelled[ordered[0].index]) { continue; }
          var when = gap === null ? "with no usable date" : gap === 0 ? "on the same day" : Math.round(gap) + " days apart";
          var note = series !== null ? " This supplier bills this amount every " + series + " days; two in one period is one too many." : " Only the invoice number is new.";
          flag(ordered[1], ordered[0], "B", "Same supplier and the same amount as " + (ordered[0].reference || "an earlier row") + ", " + when + "." + note);
        }
      }
    });

    var byRefAmount = groupBy(positives, function (inv) { return inv.referenceKey ? inv.referenceKey + "\u0000" + inv.amount.toFixed(2) : null; });
    eachGroup(byRefAmount, function (group) {
      for (var i = 0; i < group.length; i += 1) {
        for (var j = i + 1; j < group.length; j += 1) {
          var a = group[i], b = group[j];
          if (a.supplierKey === b.supplierKey) { continue; }
          var ordered = earlierFirst(a, b);
          flag(ordered[1], ordered[0], "C", "Same invoice number and the same amount as a row under \"" + ordered[0].supplier + "\". The supplier is spelled differently.");
        }
      }
    });

    pairs.sort(function (x, y) { return y.amount - x.amount || x.suspect.index - y.suspect.index; });
    return pairs;
  }


  /* Three or more same-amount rows from one supplier at a steady gap (weekly, fortnightly, monthly, quarterly) are a
     fixed charge. Returns the cadence in days, or null. */
  function recurringCadence(group) {
    var dated = group.filter(function (inv) { return inv.dateMs !== null; }).sort(function (a, b) { return a.dateMs - b.dateMs; });
    if (dated.length < 4) { return null; }
    var gaps = [];
    for (var i = 1; i < dated.length; i += 1) { gaps.push((dated[i].dateMs - dated[i - 1].dateMs) / DAY_MS); }
    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var cadences = [7, 14, 28, 30, 31, 91];
    var cadence = null;
    cadences.forEach(function (c) { if (cadence === null && Math.abs(median - c) <= Math.max(2, c * 0.15)) { cadence = c; } });
    if (cadence === null) { return null; }
    var steady = gaps.filter(function (g) { return Math.abs(g - cadence) <= Math.max(2, cadence * 0.25) || g < cadence / 2; }).length;
    return steady >= Math.ceil(gaps.length * 0.7) ? cadence : null;
  }

  function groupBy(list, keyOf) {
    var groups = {};
    list.forEach(function (item) {
      var key = keyOf(item);
      if (key === null || key === "") { return; }
      (groups[key] = groups[key] || []).push(item);
    });
    return groups;
  }

  function eachGroup(groups, fn) {
    Object.keys(groups).forEach(function (key) { if (groups[key].length > 1) { fn(groups[key]); } });
  }

  function summarise(invoices, pairs, skipped) {
    var byRule = { A: 0, B: 0, C: 0, D: 0 };
    var value = 0;
    pairs.forEach(function (pair) { byRule[pair.rule] += 1; value += pair.amount; });
    return { rowsChecked: invoices.length, skipped: skipped || 0, suspected: pairs.length, value: round2(value), byRule: byRule };
  }

  function csvCell(value) {
    var text = String(value == null ? "" : value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function isoDate(ms) {
    if (ms === null || ms === undefined) { return ""; }
    return new Date(ms).toISOString().slice(0, 10);
  }

  /* The hold list as CSV: one line per suspected row, next to the row it matches. */
  function toCsv(pairs) {
    var lines = ["row,supplier,invoice_number,date,amount,rule,matches_row,matches_invoice_number,reason"];
    pairs.forEach(function (pair) {
      lines.push([pair.suspect.index + 2, pair.suspect.supplier, pair.suspect.reference, isoDate(pair.suspect.dateMs),
        pair.suspect.amount.toFixed(2), pair.rule, pair.original.index + 2, pair.original.reference, pair.reason].map(csvCell).join(","));
    });
    return lines.join("\n") + "\n";
  }

  /* Everything at once: parsed rows and a mapping in, the summary and the pairs out. */
  function check(rows, mapping, options) {
    var read = readInvoices(rows, mapping, options);
    var pairs = findDuplicates(read.invoices, options);
    return { summary: summarise(read.invoices, pairs, read.skipped), pairs: pairs, invoices: read.invoices };
  }

  return {
    DEFAULT_WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
    detectColumns: detectColumns,
    parseCsv: parseCsv,
    parseAmount: parseAmount,
    parseDate: parseDate,
    normaliseReference: normaliseReference,
    normaliseSupplier: normaliseSupplier,
    readInvoices: readInvoices,
    findDuplicates: findDuplicates,
    summarise: summarise,
    toCsv: toCsv,
    check: check
  };
});
