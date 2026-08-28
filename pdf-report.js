/* ===================== The 29 World — Report card PDF export =====================
   Writes a real .pdf file straight from the browser, with no library and
   no network call. "Print" already existed and relies on the browser's
   print dialog (and whatever the student picks in it); this gives a
   one-click file that always looks the same and always lands in Downloads.

   How it works: a PDF is just a text-ish container of numbered objects
   followed by a cross-reference table of their byte offsets. We only need
   a tiny subset of it —
     - the 14 "standard" fonts (Helvetica / Helvetica-Bold), which every
       reader has built in, so nothing has to be embedded
     - one content stream per page, made of text-showing (Tj) and
       filled-rectangle (re f) operators
   Everything is built as a string of single-byte characters so a byte
   offset is just a character index, which is what makes the xref table
   straightforward to get right.

   Because the standard fonts are used with /WinAnsiEncoding, any character
   outside Latin-1 (★, ✓, curly quotes) has to be folded down to something
   that exists — see pdfAscii(). Anything unmapped becomes "?" rather than
   silently corrupting the file.
================================================================================ */

const PDF_PAGE_W = 595.28;   // A4 in points
const PDF_PAGE_H = 841.89;
const PDF_MARGIN = 46;
const PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2;

const PDF_COLORS = {
  navy: [0.122, 0.169, 0.267],
  ink: [0.102, 0.133, 0.2],
  muted: [0.412, 0.451, 0.537],
  line: [0.886, 0.906, 0.941],
  gold: [0.788, 0.604, 0.180],
  mint: [0.180, 0.596, 0.451],
  coral: [0.831, 0.314, 0.227],
  white: [1, 1, 1]
};

/* Helvetica advance widths (per 1000 units) for the characters that turn up
   in money and percentages. Those are the only strings that get
   right-aligned, so they're the only ones that need exact measurement;
   everything else uses the average below, which is only ever used to
   decide where to wrap. */
const PDF_W = { "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, "$": 556, ".": 278, ",": 278, "-": 333, " ": 278, "%": 889, "/": 278 };
const PDF_AVG_W = 512;

function pdfTextWidth(str, size) {
  let total = 0;
  for (const ch of String(str)) total += (PDF_W[ch] !== undefined ? PDF_W[ch] : PDF_AVG_W);
  return (total / 1000) * size;
}

// Folds the app's typography down to Latin-1, then escapes the three
// characters that are special inside a PDF string literal.
function pdfAscii(str) {
  const map = {
    "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
    "…": "...", "★": "*", "☆": "*", "×": "x", "−": "-",
    "→": "->", "›": ">", " ": " ", "•": "-"
  };
  let out = "";
  for (const ch of String(str === undefined || str === null ? "" : str)) {
    const mapped = map[ch] !== undefined ? map[ch] : ch;
    for (const c of mapped) {
      const code = c.charCodeAt(0);
      out += code <= 255 ? c : "?";
    }
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/* ---------------- The document builder ----------------
   Keeps a cursor (this.y) running down the page and starts a new page
   whenever a piece of content wouldn't fit, so callers never have to think
   about pagination. */
function pdfDoc() {
  return {
    pages: [],
    stream: "",
    y: 0,

    _startPage() {
      if (this.stream) this.pages.push(this.stream);
      this.stream = "";
      this.y = PDF_PAGE_H - PDF_MARGIN;
    },
    // Reserve vertical space; breaks to a new page if it won't fit.
    need(h) {
      if (!this.stream && !this.pages.length) this._startPage();
      if (this.y - h < PDF_MARGIN + 26) { this._startPage(); return true; }
      return false;
    },
    color(c) { return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`; },

    rect(x, y, w, h, c) {
      this.stream += `q ${this.color(c)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q\n`;
    },
    text(str, x, y, size, opts) {
      opts = opts || {};
      const font = opts.bold ? "/F2" : "/F1";
      const c = opts.color || PDF_COLORS.ink;
      let tx = x;
      if (opts.align === "right") tx = x - pdfTextWidth(str, size);
      this.stream += `BT ${this.color(c)} rg ${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfAscii(str)}) Tj ET\n`;
    },

    /* ---- higher-level pieces ---- */
    heading(str) {
      this.need(46);
      this.y -= 24;
      this.rect(PDF_MARGIN, this.y + 15, PDF_CONTENT_W, 1, PDF_COLORS.line);
      this.y -= 2;
      this.text(str, PDF_MARGIN, this.y, 12.5, { bold: true, color: PDF_COLORS.navy });
      this.y -= 16;
    },
    para(str, opts) {
      opts = opts || {};
      const size = opts.size || 9.5;
      this.need(size + 6);
      this.y -= size + 2;
      this.text(str, PDF_MARGIN, this.y, size, { color: opts.color || PDF_COLORS.muted });
      this.y -= 3;
    },
    // A label/value row with the value hard right — used for every table
    // in the report, which keeps the whole document on one grid.
    row(label, value, opts) {
      opts = opts || {};
      this.need(19);
      this.y -= 14;
      this.text(label, PDF_MARGIN + (opts.indent || 0), this.y, 10, { bold: !!opts.bold, color: opts.color || PDF_COLORS.ink });
      if (value !== undefined && value !== null && value !== "") {
        this.text(value, PDF_PAGE_W - PDF_MARGIN, this.y, 10, { bold: !!opts.bold, align: "right", color: opts.color || PDF_COLORS.ink });
      }
      this.y -= 4;
      if (opts.rule) this.rect(PDF_MARGIN, this.y + 2, PDF_CONTENT_W, 0.6, PDF_COLORS.line);
    },
    // Horizontal bar with its label and amount, mirroring .rpt-bar-row.
    bar(label, amount, max, colorName) {
      this.need(24);
      this.y -= 15;
      const labelW = 150, amountW = 74;
      const trackX = PDF_MARGIN + labelW + 8;
      const trackW = PDF_CONTENT_W - labelW - amountW - 16;
      this.text(label, PDF_MARGIN, this.y, 9.5, { color: PDF_COLORS.ink });
      this.rect(trackX, this.y - 2, trackW, 8, PDF_COLORS.line);
      const pct = max > 0 ? Math.max(0.01, amount / max) : 0;
      this.rect(trackX, this.y - 2, trackW * pct, 8, PDF_COLORS[colorName] || PDF_COLORS.gold);
      this.text(fmtMoney(amount), PDF_PAGE_W - PDF_MARGIN, this.y, 9.5, { align: "right", bold: true });
      this.y -= 5;
    },
    // Four summary tiles across the top, same figures as the on-screen chips.
    chips(items) {
      this.need(62);
      this.y -= 54;
      const gap = 10;
      const w = (PDF_CONTENT_W - gap * (items.length - 1)) / items.length;
      items.forEach((it, i) => {
        const x = PDF_MARGIN + i * (w + gap);
        this.rect(x, this.y, w, 50, [0.965, 0.973, 0.988]);
        this.rect(x, this.y, w, 2.5, PDF_COLORS[it.color] || PDF_COLORS.navy);
        this.text(it.label.toUpperCase(), x + 9, this.y + 34, 6.8, { bold: true, color: PDF_COLORS.muted });
        this.text(it.value, x + 9, this.y + 17, 13, { bold: true, color: PDF_COLORS.navy });
        if (it.sub) this.text(it.sub, x + 9, this.y + 7, 7.2, { color: PDF_COLORS.muted });
      });
      this.y -= 6;
    },
    titleBlock(title, subtitle, meta) {
      this._startPage();
      this.rect(0, PDF_PAGE_H - 92, PDF_PAGE_W, 92, PDF_COLORS.navy);
      this.text("The 29 World", PDF_MARGIN, PDF_PAGE_H - 36, 11, { bold: true, color: PDF_COLORS.gold });
      this.text(title, PDF_MARGIN, PDF_PAGE_H - 60, 19, { bold: true, color: PDF_COLORS.white });
      if (subtitle) this.text(subtitle, PDF_MARGIN, PDF_PAGE_H - 78, 9.5, { color: [0.78, 0.82, 0.89] });
      if (meta) this.text(meta, PDF_PAGE_W - PDF_MARGIN, PDF_PAGE_H - 36, 8.5, { align: "right", color: [0.78, 0.82, 0.89] });
      this.y = PDF_PAGE_H - 112;
    },

    /* ---- serialise ---- */
    build() {
      if (this.stream) { this.pages.push(this.stream); this.stream = ""; }
      if (!this.pages.length) this.pages.push("");

      const objects = [];
      const pageCount = this.pages.length;
      // 1 catalog, 2 pages, 3/4 fonts, then (page, content) per page.
      const firstPageObj = 5;
      const kids = [];
      for (let i = 0; i < pageCount; i++) kids.push(`${firstPageObj + i * 2} 0 R`);

      objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
      objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
      objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
      objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

      this.pages.forEach((content, i) => {
        const pageObj = firstPageObj + i * 2;
        const contentObj = pageObj + 1;
        // Page number, added here so it lands on every page including ones
        // created mid-section by an automatic break.
        const numbered = content +
          `BT ${this.color(PDF_COLORS.muted)} rg /F1 8 Tf ${(PDF_PAGE_W / 2 - 20).toFixed(2)} ${(PDF_MARGIN - 12).toFixed(2)} Td (Page ${i + 1} of ${pageCount}) Tj ET\n`;
        objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_W} ${PDF_PAGE_H}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
        objects[contentObj] = `<< /Length ${numbered.length} >>\nstream\n${numbered}endstream`;
      });

      let out = "%PDF-1.4\n";
      const offsets = [];
      for (let i = 1; i < objects.length; i++) {
        offsets[i] = out.length;
        out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
      }
      const xrefAt = out.length;
      out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for (let i = 1; i < objects.length; i++) {
        out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
      }
      out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
      return out;
    }
  };
}

function pdfSave(doc, filename) {
  const str = doc.build();
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function pdfSafeName(str) {
  return String(str || "report").replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 60) || "report";
}

/* ---------------- Report layouts ---------------- */
function pdfBarsSection(doc, title, entries, colorName, total) {
  doc.heading(`${title}  ${fmtMoney(total)}`);
  const list = entries || [];
  if (!list.length) { doc.para("Nothing recorded for this period."); return; }
  const max = Math.max(...list.map(e => e.amount));
  list.forEach(e => doc.bar(e.category, e.amount, max, colorName));
}

function pdfStudentReport(doc, s, report) {
  doc.chips([
    { label: "Net worth", value: fmtMoney(s.netWorth), color: "navy" },
    { label: "Savings rate", value: s.savingsRate === null ? "-" : s.savingsRate + "%", color: "mint" },
    { label: "Income this period", value: fmtMoney(s.incomeTotal), color: "gold" },
    { label: "Biggest expense", value: s.topExpenseCategory ? s.topExpenseCategory.category : "-",
      sub: s.topExpenseCategory ? fmtMoney(s.topExpenseCategory.amount) : "", color: "coral" }
  ]);

  doc.heading("Net worth breakdown");
  doc.row("Cash balance", fmtMoney(s.balance), { rule: true });
  doc.row("Savings account", fmtMoney(s.savings), { rule: true });
  doc.row("Term deposits", fmtMoney(s.termDeposits), { rule: true });
  doc.row("Stock portfolio", fmtMoney(s.invested), { rule: true });
  doc.row("Property", fmtMoney(s.propertyValue), { rule: true });
  doc.row("Vehicles", fmtMoney(s.vehicleValue), { rule: true });
  doc.row("Store items", fmtMoney(s.storeValue), { rule: true });
  doc.row("Owed (loans + mortgage)", "-" + fmtMoney(s.owed), { rule: true, color: PDF_COLORS.coral });
  doc.row("Net worth", fmtMoney(s.netWorth), { bold: true });

  pdfBarsSection(doc, "Income this period", s.income, "gold", s.incomeTotal);
  pdfBarsSection(doc, "Saved & invested this period", s.saved, "mint", s.savedTotal);
  if (s.borrowedTotal) {
    doc.para(`Also borrowed ${fmtMoney(s.borrowedTotal)} in new loans this period (not counted as income).`);
  }
  pdfBarsSection(doc, "Spent this period", s.spent, "coral", s.spentTotal);

  doc.heading("Loan history");
  if (!s.loans || !s.loans.length) {
    doc.para("No loans taken.");
  } else {
    doc.row("Taken / amount / rate / term", "Status", { bold: true, rule: true, color: PDF_COLORS.muted });
    s.loans.forEach(l => {
      const left = `${l.takenDate || "-"}   ${fmtMoney(l.principal)}   ${l.rate}%/wk   ${l.termWeeks} wk   due ${l.dueDate || "-"}`;
      const status = l.status === "active"
        ? `Active - ${fmtMoney(l.owed)} owed`
        : (l.onTime === null ? "Paid off" : l.onTime ? "Paid off on time" : "Paid off late");
      doc.row(left, status, { rule: true });
    });
  }
}

function downloadStudentReportPDF(s, report, who) {
  const doc = pdfDoc();
  doc.titleBlock(
    (who && who.name) || s.name || "Report card",
    `Report card - covers ${fmtRange(report.periodStart, report.periodEnd)}`,
    "Generated " + nowStr()
  );
  pdfStudentReport(doc, s, report);
  pdfSave(doc, `report-card-${pdfSafeName(s.name)}.pdf`);
}

function downloadClassReportPDF(report, className) {
  const doc = pdfDoc();
  doc.titleBlock(
    className || "Class report",
    `Class report card - covers ${fmtRange(report.periodStart, report.periodEnd)}`,
    "Generated " + nowStr()
  );

  const students = (report.students || []).slice().sort((a, b) => b.netWorth - a.netWorth);
  if (!students.length) {
    doc.heading("Students");
    doc.para("No students in this class yet.");
    pdfSave(doc, `class-report-${pdfSafeName(className)}.pdf`);
    return;
  }

  const totalNet = students.reduce((t, s) => t + s.netWorth, 0);
  const rated = students.filter(s => s.savingsRate !== null);
  doc.chips([
    { label: "Students", value: String(students.length), color: "navy" },
    { label: "Total net worth", value: fmtMoney(totalNet), color: "gold" },
    { label: "Average net worth", value: fmtMoney(Math.round((totalNet / students.length) * 100) / 100), color: "mint" },
    { label: "Average savings rate",
      value: rated.length ? Math.round(rated.reduce((t, s) => t + s.savingsRate, 0) / rated.length) + "%" : "-",
      color: "coral" }
  ]);

  doc.heading("Class summary");
  doc.row("Student", "Net worth", { bold: true, rule: true, color: PDF_COLORS.muted });
  students.forEach(s => {
    const detail = `${s.name}   (savings rate ${s.savingsRate === null ? "-" : s.savingsRate + "%"}` +
      `${s.topExpenseCategory ? ", top spend " + s.topExpenseCategory.category : ""})`;
    doc.row(detail, fmtMoney(s.netWorth), { rule: true });
  });

  // One full page per student after the summary, so the class PDF is a
  // complete set of report cards rather than just a league table.
  students.forEach(s => {
    doc._startPage();
    doc.text(s.name, PDF_MARGIN, PDF_PAGE_H - PDF_MARGIN - 6, 16, { bold: true, color: PDF_COLORS.navy });
    doc.y = PDF_PAGE_H - PDF_MARGIN - 26;
    pdfStudentReport(doc, s, report);
  });

  pdfSave(doc, `class-report-${pdfSafeName(className)}.pdf`);
}
