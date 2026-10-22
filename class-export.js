/* ===================== The 29 World — Full class export (teacher only) =====================
   Writes a complete, human-readable snapshot of ONE class to a .pdf or .md file:
   class settings, every price/wage/rate, market history, every student's full account,
   net worth + lifestyle rating (calculated with the app's own functions), and the whole
   transaction log.

   HOW "EVERYTHING" IS GUARANTEED: the class doc and every student doc are walked
   generically (walk() below) so any field — including ones added in future — is written
   out automatically. A few hand-written sections sit in front of that for values that
   are CALCULATED rather than stored (net worth, ratings, share holdings, up/down odds).

   Left out on purpose (login/security data, not class data): authUid, sessionVersion,
   password, and anything with "token" in its name (parent-view link + template share
   link — exporting those would hand out access). Inline data: images are noted, not
   dumped. The file says so in its footer.

   Reuses pdfDoc()/pdfSave()/pdfTextWidth() from pdf-report.js (no library, no network).
   Both outputs are built from ONE list of lines, so the PDF and MD always match.
=============================================================================================== */

const T29X_SKIP = /token|authuid|sessionversion|password|secret/i;
const T29X_NOT_MONEY = /(minutes|seconds|sec$|days|weeks|count|qty|quantity|stock|sold|weight|stars|comfort|points|level|index|order|version|shares|number|listings|lease|hour|time)/i;
const T29X_MONEY = /(price|balance|amount|wage|cost|fee|rent|payment|savings|owed|principal|deposit|bet|worth|value|premium|income|spent|saved|borrowed|payout|refund|fine|offer|total|bonus|winnings|profit|loss|gain|chips|upto|allowance|salary|earned|stake|winlimit|buyin|history|^net$|^cap$)/i;
const T29X_PCT = /(pct|percent|rate$)/i;

/* Keep in sync with applyMarketDayMoves (data-markets.js) and
   applyPropertyMarketDayMoves (data-property.js): both draw "down" when
   Math.random() < 0.4, otherwise "up". */
const T29X_CHANCE_DOWN = 40, T29X_CHANCE_UP = 60;

function t29xIdIndex(cls, students) {
  const m = new Map();
  (cls.students || []).forEach(u => m.set(u, u));
  students.forEach(s => m.set(s.username, `${s.name} (${s.username})`));
  Object.keys(cls).forEach(k => {
    const a = cls[k];
    if (!Array.isArray(a)) return;
    a.forEach(it => {
      if (!it || typeof it !== "object" || typeof it.id !== "string") return;
      const nm = it.name || it.title || it.label;
      if (nm) m.set(it.id, String(nm));
      (it.tiers || []).forEach(t => { if (t && t.id) m.set(t.id, (nm ? nm + " - " : "") + (t.name || t.id)); });
    });
  });
  return m;
}

function t29xTs(v) {
  return new Date(v).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" });
}

function t29xCtx(ids) {
  const label = k => ids.has(k) ? ids.get(k) : String(k).replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()).trim();
  function num(v, key, path) {
    if (v > 1e11 && v < 4e12) return t29xTs(v);
    const k = String(key), p = String(path);
    if (/sellBackRates/i.test(p)) return Math.round(v * 10000) / 100 + "%";
    const plain = Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
    if (T29X_NOT_MONEY.test(k)) return plain;
    if (/priceRange|taxRates/i.test(p) || (T29X_PCT.test(k) && !/upto/i.test(k))) return plain + "%";
    if (T29X_MONEY.test(k)) return fmtMoney(v);
    return plain;
  }
  function prim(v, key, path) {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "number") return Number.isFinite(v) ? num(v, key, path) : String(v);
    const s = String(v);
    if (s.startsWith("data:")) return `(embedded file/image data, ${s.length} characters, not written out)`;
    return (key !== "id" && ids.has(s)) ? ids.get(s) : s.replace(/\s*\n\s*/g, " / ");
  }
  const isPrim = v => v === null || v === undefined || typeof v !== "object";
  const flat = o => Object.keys(o).every(k => T29X_SKIP.test(k) || isPrim(o[k]) || (Array.isArray(o[k]) && o[k].every(isPrim)));
  function inline(o, path) {
    return Object.keys(o).filter(k => !T29X_SKIP.test(k)).map(k => {
      const v = o[k];
      const val = Array.isArray(v) ? v.map(x => prim(x, k, path + "." + k)).join(", ") : prim(v, k, path + "." + k);
      return `${label(k)}: ${val}`;
    }).join(" | ");
  }
  function title(o) { const t = o.name || o.title || o.label; return t ? String(t) : ""; }
  // Emits {i: indent, t: text} lines for any value.
  function walk(val, key, path, ind, out, parentKey) {
    const fk = ids.has(key) && parentKey ? parentKey : key;   // {username: 5} formats as its parent's field
    if (T29X_SKIP.test(String(key))) return;
    const lab = label(key);
    if (isPrim(val)) { out.push({ i: ind, t: `${lab}: ${prim(val, fk, path)}` }); return; }
    if (Array.isArray(val)) {
      if (!val.length) { out.push({ i: ind, t: `${lab}: (none)` }); return; }
      if (val.every(isPrim)) { out.push({ i: ind, t: `${lab}: ${val.map(x => prim(x, fk, path)).join(", ")}` }); return; }
      out.push({ i: ind, t: `${lab} (${val.length}):` });
      val.forEach(it => {
        if (isPrim(it)) { out.push({ i: ind + 1, t: "- " + prim(it, fk, path) }); return; }
        if (Array.isArray(it)) { out.push({ i: ind + 1, t: "- " + it.map(x => isPrim(x) ? prim(x, fk, path) : JSON.stringify(x)).join(", ") }); return; }
        if (flat(it)) { const tt = title(it); out.push({ i: ind + 1, t: "- " + (tt ? tt + " - " : "") + inline(it, path + "." + key) }); return; }
        out.push({ i: ind + 1, t: "- " + (title(it) || "Item") });
        Object.keys(it).forEach(k => walk(it[k], k, path + "." + key, ind + 2, out, key));
      });
      return;
    }
    const keys = Object.keys(val).filter(k => !T29X_SKIP.test(k));
    if (!keys.length) { out.push({ i: ind, t: `${lab}: (none)` }); return; }
    if (flat(val) && keys.length <= 6) { out.push({ i: ind, t: `${lab}: ${inline(val, path + "." + key)}` }); return; }
    out.push({ i: ind, t: `${lab}:` });
    keys.forEach(k => walk(val[k], k, path + "." + key, ind + 1, out, key));
  }
  return { label, walk, prim };
}

/* ---------- build the full list of lines ---------- */
async function t29xBuild(classCode) {
  if (typeof CURRENT === "undefined" || !CURRENT || CURRENT.role !== "teacher") throw new Error("Only the teacher can export a class.");
  if (CURRENT.classCode !== classCode) throw new Error("This export is only for the class you currently have open.");
  const cls = await getClass(classCode);
  if (!cls) throw new Error("Class not found.");
  const students = await getClassStudents(classCode, cls);
  const ids = t29xIdIndex(cls, students);
  const X = t29xCtx(ids);
  const L = [];   // { h: 1|2|3, t } or { i, t }
  const H = (h, t, pb) => L.push({ h, t, pb });
  const P = (t, i) => L.push({ i: i || 0, t });
  const W = (v, k, i, path) => X.walk(v, k, path || k, i || 0, L);
  const money = n => fmtMoney(n);
  const teacher = await getUser(cls.teacher).catch(() => null);

  H(1, "Class overview");
  P(`Class name: ${cls.name}`); P(`Class code: ${cls.code}`);
  P(`Teacher: ${teacher ? teacher.name + " (" + cls.teacher + ")" : cls.teacher}`);
  P(`Created: ${cls.createdAt ? t29xTs(cls.createdAt) : "unknown"}`);
  P(`Archived: ${cls.archived ? "Yes" : "No"}`);
  P(`Students: ${students.length}`);
  P(`Exported: ${t29xTs(Date.now())}`);

  /* net worth + rating (calculated, not stored) */
  const board = await classLeaderboard(classCode, null, students);
  H(1, "Net worth ranking and lifestyle ratings");
  const rated = {};
  for (const s of students) {
    let br = null, band = null, err = null;
    try { br = await lifestyleRatingBreakdown(s.username, classCode); } catch (e) { err = e.message || String(e); }
    try { band = await lifestyleBandForStudent(s.username, classCode, board); } catch (e) { err = (err ? err + "; " : "") + (e.message || String(e)); }
    rated[s.username] = { br, band, err };
  }
  board.forEach((r, n) => {
    const g = rated[r.username];
    H(3, `#${n + 1}  ${r.name} (${r.username})  -  net worth ${money(r.net)}`);
    P(`Cash: ${money(r.balance)} | Savings: ${money(r.savings)} | Term deposits: ${money(r.termDeposits)} | KiwiSaver: ${money(r.kiwiSaver)}`, 1);
    P(`Shares: ${money(r.invested)} | Store items: ${money(r.storeValue)} | Property: ${money(r.propertyValue)} | Vehicles: ${money(r.vehicleValue)} | Owed (loans, mortgages, card): ${money(r.owed)}`, 1);
    const stu = students.find(s => s.username === r.username);
    try { P(`Gambling account: ${money(gamblingAccountToday(stu).balance)}`, 1); } catch (e) { P("Gambling account: could not be calculated (" + e.message + ")", 1); }
    if (g.br) {
      P(`Lifestyle rating: ${g.br.total}${g.br.overridden ? " (teacher override)" : ""}`, 1);
      (g.br.items || []).forEach(it => P(`- ${it.label}${it.detail ? " (" + it.detail + ")" : ""}: ${it.points > 0 ? "+" : ""}${it.points}`, 2));
    } else P("Lifestyle rating: could not be calculated" + (g.err ? " (" + g.err + ")" : ""), 1);
    if (g.band) W(g.band, "Lifestyle band", 1);
  });

  /* wages */
  H(1, "Wages");
  students.forEach(s => {
    const job = (cls.jobs || []).find(j => j.id === s.jobId);
    const tier = job && (job.tiers || []).find(t => t.id === s.jobTierId);
    P(`${s.name} (${s.username}): ${job ? job.title + (tier ? " - " + tier.name + ", wage " + money(tier.wage) : " (tier not found)") : "no job"}${cls.payDay ? " | paid on " + cls.payDay : ""}`);
  });

  /* markets */
  H(1, "Markets: prices, history and the chance of going up or down");
  P(`Shares: every simulated market day each company independently has a ${T29X_CHANCE_UP}% chance of moving UP and a ${T29X_CHANCE_DOWN}% chance of moving DOWN. The size of the move is random between the company's own % range (or the class default ${cls.priceRange ? cls.priceRange.min + "% to " + cls.priceRange.max + "%" : "1% to 5%"}).`);
  P(`Property: the same ${T29X_CHANCE_UP}% up / ${T29X_CHANCE_DOWN}% down rule, with a move between the listing's own % range (or the class default ${cls.propertyPriceRange ? cls.propertyPriceRange.min + "% to " + cls.propertyPriceRange.max + "%" : "0.5% to 2%"}).`);
  H(2, "Companies (shares)");
  (cls.companies || []).forEach(co => {
    const hist = co.history || [], dates = co.historyDates || [];
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const chg = prev ? ((co.price - prev) / prev * 100) : null;
    const r = co.priceRange || cls.priceRange || {};
    H(3, `${co.name} - ${money(co.price)}`);
    P(`Last move: ${chg === null ? "no previous price" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%"} | Daily move range: ${r.min}% to ${r.max}% (${co.priceRange ? "this company's own" : "class default"}) | Chance up ${T29X_CHANCE_UP}% / down ${T29X_CHANCE_DOWN}%`, 1);
    P("Price history, oldest to newest: " + (hist.length ? hist.map((p, n) => `${dates[n] ? dates[n] + " " : ""}${money(p)}`).join(", ") : "none"), 1);
    const holders = Object.entries(co.holders || {}).filter(([, n]) => n > 0);
    P("Shareholders: " + (holders.length ? holders.map(([u, n]) => `${ids.get(u) || u} x${n} = ${money(n * co.price)}`).join(", ") : "none"), 1);
  });
  H(2, "Properties");
  (cls.properties || []).forEach(p => {
    const hist = p.priceHistory || [], dates = p.priceHistoryDates || [];
    const r = p.priceRange || cls.propertyPriceRange || {};
    H(3, `${p.name} - ${money(p.price)}`);
    P(`Owner: ${p.owner ? (ids.get(p.owner) || p.owner) : "nobody (for sale)"} | Comfort rating: ${p.comfort || 0} stars | Weekly rent: ${money(p.rentPerWeek || 0)} | Daily move range ${r.min}% to ${r.max}% (${p.priceRange ? "own" : "class default"}) | Chance up ${T29X_CHANCE_UP}% / down ${T29X_CHANCE_DOWN}%`, 1);
    P("Price history, oldest to newest: " + (hist.length ? hist.map((x, n) => `${dates[n] ? dates[n] + " " : ""}${money(x)}`).join(", ") : "none"), 1);
  });

  /* every student, in full */
  H(1, "Students (complete accounts)");
  students.forEach(s => {
    H(2, `${s.name} (${s.username})`, true);
    H(3, "Held in the class (calculated from class data)");
    const sh = (cls.companies || []).filter(c => (c.holders || {})[s.username] > 0);
    P("Shares: " + (sh.length ? sh.map(c => `${c.name} x${c.holders[s.username]} @ ${money(c.price)} = ${money(c.holders[s.username] * c.price)}`).join(", ") : "none"), 1);
    const pr = (cls.properties || []).filter(p => p.owner === s.username);
    P("Properties owned: " + (pr.length ? pr.map(p => `${p.name} (${money(p.price)}, ${p.comfort || 0} stars)`).join(", ") : "none"), 1);
    const ve = (cls.vehicles || []).filter(v => (v.owners || []).includes(s.username));
    P("Vehicles owned: " + (ve.length ? ve.map(v => `${v.name} (${money(v.price)})`).join(", ") : "none"), 1);
    const kk = (() => { try { return kiwiSaverOf(s); } catch (e) { return null; } })();
    if (kk) W(kk, "KiwiSaver", 1);
    H(3, "Account record (every stored field)");
    Object.keys(s).forEach(k => W(s[k], k, 1, "student." + k));
  });

  /* class settings + content: everything stored on the class doc */
  H(1, "Class data and settings (every stored field)");
  Object.keys(cls).filter(k => k !== "txns").forEach(k => { H(2, X.label(k)); W(cls[k], k, 0, k); });

  H(1, "Transaction log (newest first)");
  P(`${(cls.txns || []).length} transactions recorded.`);
  W(cls.txns || [], "Transactions", 0, "txns");

  H(1, "About this export");
  P("Left out on purpose (login and sharing security data): authUid, sessionVersion, password, and every field with \"token\" in its name (parent-view and template-share links). Embedded image/file data is noted but not written out. Units (%, $) are inferred from field names; where a field's meaning is unclear the raw number is shown.");
  return { cls, L };
}

/* ---------- renderers ---------- */
function t29xMarkdown(cls, L) {
  const out = [`# ${cls.name} - full class export`, ""];
  L.forEach(l => {
    if (l.h) { out.push("", "#".repeat(l.h + 1) + " " + l.t, ""); return; }
    out.push("  ".repeat(l.i || 0) + (l.t.startsWith("- ") ? l.t : "- " + l.t));
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function t29xPdfClean(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, "");
}

function t29xPdf(cls, L) {
  const doc = pdfDoc();
  doc.titleBlock(t29xPdfClean(cls.name) + " - full class export", "Complete snapshot of the class", "Generated " + nowStr());
  let firstH1 = true;
  L.forEach(l => {
    if (l.h) {
      const txt = t29xPdfClean(l.t);
      if (l.h === 1) {
        if (!firstH1) doc.need(150);
        firstH1 = false;
        doc.need(40); doc.y -= 22;
        doc.text(txt, PDF_MARGIN, doc.y, 15, { bold: true, color: PDF_COLORS.navy });
        doc.y -= 6; doc.rect(PDF_MARGIN, doc.y, PDF_CONTENT_W, 1, PDF_COLORS.gold); doc.y -= 4;
      } else {
        if (l.pb) doc._startPage();
        doc.need(l.h === 2 ? 34 : 26); doc.y -= (l.h === 2 ? 20 : 14);
        doc.text(txt, PDF_MARGIN, doc.y, l.h === 2 ? 12 : 10, { bold: true, color: l.h === 2 ? PDF_COLORS.navy : PDF_COLORS.ink });
        doc.y -= 3;
      }
      return;
    }
    const size = 8.5, x = PDF_MARGIN + (l.i || 0) * 12, maxW = PDF_CONTENT_W - (l.i || 0) * 12 - 10;
    const lines = [];
    let cur = "";
    t29xPdfClean(l.t).split(/\s+/).forEach(w => {
      while (pdfTextWidth(w, size) > maxW) {            // very long unbroken word (ids, urls)
        const cut = Math.max(8, Math.floor(w.length * maxW / pdfTextWidth(w, size)) - 1);
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, cut)); w = w.slice(cut);
      }
      const next = cur ? cur + " " + w : w;
      if (cur && pdfTextWidth(next, size) > maxW) { lines.push(cur); cur = w; } else cur = next;
    });
    if (cur) lines.push(cur);
    lines.forEach((ln, n) => {
      doc.need(size + 4); doc.y -= size + 2;
      doc.text(ln, x + (n ? 10 : 0), doc.y, size, { color: PDF_COLORS.ink });
    });
    doc.y -= 1.5;
  });
  return doc;
}

function t29xDownloadText(text, filename) {
  const blob = new Blob(["\ufeff", text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportClassClick(format) {
  const msg = document.getElementById("exportClassMsg");
  const btns = document.querySelectorAll(".export-class-btn");
  btns.forEach(b => b.disabled = true);
  flashMsg(msg, "Building the export... this can take a few seconds for a big class.", 60000);
  try {
    const { cls, L } = await t29xBuild(CLASS_CODE);
    const base = `${pdfSafeName(cls.name)}-full-export-${nzDateKey()}`;
    if (format === "pdf") pdfSave(t29xPdf(cls, L), base + ".pdf");
    else t29xDownloadText(t29xMarkdown(cls, L), base + ".md");
    flashMsg(msg, `<span class="ok">Downloaded ${base}.${format === "pdf" ? "pdf" : "md"} (${L.length.toLocaleString()} lines).</span>`, 8000);
  } catch (e) {
    console.error(e);
    flashMsg(msg, `<span class="err">Export failed: ${escapeHtml(e.message || String(e))}</span>`, 12000);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}
