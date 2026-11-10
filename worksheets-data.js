/* ===================== The 29 World — Worksheets: content & layout =====================
   EVERYTHING that is placeholder lives in THIS file, so it can be swapped for the real
   thing without touching worksheets.js / worksheets.css / worksheets.html.

   1. WS_LAYOUT    – the default look of every worksheet (paper, font, name line, footer…).
   2. WS_MODULES   – which modules get worksheets. Set `enabled:false` to hide one, flip it
                     back to true to bring it back. Add `group` / `accent` / `blurb` freely.
   3. WS_DEFAULTS  – real content per module. Anything listed here REPLACES the auto-made
                     placeholder for that module. Leave a module out and it keeps the placeholder.
   4. wsBuildPlaceholder() – the generic placeholder worksheet used until real content exists.

   Teachers' edits are saved separately (per teacher, in their browser) and only for the
   worksheets they actually touch. A worksheet nobody has edited always shows whatever is
   written here, so updating this file updates every untouched worksheet automatically.

   Block types a worksheet can contain:
     { type:"heading",  text }
     { type:"text",     text }
     { type:"question", text, lines (0-12 answer lines), marks, answer (teacher key) }
     { type:"choice",   text, options:[...2-8], correct (index, -1 = none), marks }
     { type:"table",    cols:[...1-6], rows:[[...], ...] }
     { type:"pagebreak" }
============================================================================================ */

const WS_LAYOUT = {
  paper: "a4",                          // "a3" | "a4" | "a5"  (a5 prints 2-up on landscape A4)
  font: "sans",                         // "sans" | "serif"
  size: "m",                            // "s" | "m" | "l"
  nameLine: true,                       // Name / Class / Date line under the title
  nameFields: ["Name", "Class", "Date"],
  marks: false,                         // show marks next to questions + a total
  footer: "The 29 World™ · Free to copy for classroom use"
};

const WS_GROUPS = ["Money", "Life"];    // order of the headings in the module list

const WS_MODULES = [
  { key: "bank",        name: "Bank",         group: "Money", accent: "#3f6fd6", enabled: true,
    blurb: "Everyday accounts, deposits and withdrawals.",              topic: "how a bank account works" },
  { key: "budget",      name: "Budgeting",    group: "Money", accent: "#2e9873", enabled: true,
    blurb: "Planning income against spending.",                         topic: "planning a weekly or monthly budget" },
  { key: "termdeposit", name: "Term Deposit", group: "Money", accent: "#7a6dd0", enabled: true,
    blurb: "Locking money away to earn more interest.",                topic: "term deposits and fixed interest" },
  { key: "kiwisaver",   name: "KiwiSaver",    group: "Money", accent: "#3a8f5c", enabled: true,
    blurb: "Saving for the long term.",                                topic: "saving for retirement with KiwiSaver" },
  { key: "loan",        name: "Loans",        group: "Money", accent: "#d4624d", enabled: true,
    blurb: "Borrowing, repayments and interest.",                      topic: "borrowing money and paying it back" },
  { key: "market",      name: "Stock Market", group: "Money", accent: "#2f7fb5", enabled: true,
    blurb: "Buying and selling shares.",                               topic: "investing in shares and risk" },

  { key: "jobs",        name: "Jobs",         group: "Life",  accent: "#b8892a", enabled: true,
    blurb: "Work, wages and careers.",                                 topic: "jobs, wages and careers" },
  { key: "transport",   name: "Transport",    group: "Life",  accent: "#c26a3a", enabled: true,
    blurb: "The cost of getting around.",                              topic: "the costs of getting around" },
  { key: "property",    name: "Property",     group: "Life",  accent: "#8a5fb0", enabled: true,
    blurb: "Renting, buying and housing costs.",                       topic: "renting, buying and housing costs" },
  { key: "insurance",   name: "Insurance",    group: "Life",  accent: "#2d7f86", enabled: true,
    blurb: "Protecting against the unexpected.",                       topic: "how insurance protects you from risk" },
  { key: "tax",         name: "Tax",          group: "Life",  accent: "#5a657b", enabled: true,
    blurb: "Where your pay goes before you see it.",                   topic: "income tax and paying your share" },
  { key: "bigevents",   name: "Big Events",   group: "Life",  accent: "#cc5a7a", enabled: true,
    blurb: "Handling life's curveballs.",                              topic: "coping financially with unexpected events" },

  // Not relevant for worksheets right now. Flip `enabled` to true to switch one on.
  { key: "store",       name: "Store",        group: "Life",  accent: "#5a657b", enabled: false },
  { key: "marketplace", name: "Trade Centre", group: "Life",  accent: "#5a657b", enabled: false },
  { key: "life",        name: "Life",         group: "Life",  accent: "#5a657b", enabled: false },
  { key: "gambling",    name: "Gambling",     group: "Life",  accent: "#5a657b", enabled: false }
];

/* Real content goes here, one entry per module key, each an ARRAY of worksheets:
     WS_DEFAULTS.bank = [ { id: "bank-1", title: "…", subtitle: "…", blocks: [ … ] }, … ];
   `id` must be unique and should never change once teachers are using it.
   Optional per-worksheet `settings` override WS_LAYOUT (e.g. settings: { marks: true }). */
const WS_DEFAULTS = {};

/* ---------- Placeholder worksheet (used for any module not listed in WS_DEFAULTS) ---------- */
function wsBuildPlaceholder(mod) {
  return {
    id: mod.key + "-starter",
    moduleKey: mod.key,
    title: mod.name + " worksheet",
    subtitle: "Placeholder instructions: replace this with what students should do and how long they have.",
    settings: {},
    blocks: [
      { type: "heading",  text: "Part A: Key terms" },
      { type: "text",     text: "Placeholder introduction about " + (mod.topic || "this module") + ". Replace this paragraph with a short explanation for students." },
      { type: "table",    cols: ["Term", "What it means", "Example"],
        rows: [["Placeholder term 1", "", ""], ["Placeholder term 2", "", ""], ["Placeholder term 3", "", ""]] },
      { type: "heading",  text: "Part B: Questions" },
      { type: "question", text: "Placeholder question one. Replace this with a short-answer question.",
        lines: 3, marks: 2, answer: "Placeholder answer for question one." },
      { type: "question", text: "Placeholder question two. Replace this with a short-answer question.",
        lines: 3, marks: 2, answer: "Placeholder answer for question two." },
      { type: "choice",   text: "Placeholder multiple choice question. Which option is correct?",
        options: ["Placeholder option A", "Placeholder option B", "Placeholder option C", "Placeholder option D"],
        correct: 1, marks: 1 },
      { type: "heading",  text: "Part C: Reflect" },
      { type: "question", text: "Placeholder reflection question. What did you learn, and what would you do differently in the game?",
        lines: 4, marks: 3, answer: "" }
    ]
  };
}

/* ---------- Helpers shared with worksheets.js ---------- */
function wsModuleList() { return WS_MODULES.filter(m => m.enabled); }
function wsModule(key) { return WS_MODULES.find(m => m.key === key) || null; }

function wsUid() { return "b" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }

function wsClamp(n, lo, hi, fallback) {
  n = Math.round(Number(n));
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function wsStr(v) { return typeof v === "string" ? v : (v === null || v === undefined ? "" : String(v)); }
function wsSafeId(v) { return typeof v === "string" && /^[a-zA-Z0-9_-]{1,180}$/.test(v) ? v : ""; }

/* Fills in anything missing so the editor never has to second-guess a worksheet's shape.
   Used for built-in content, saved edits and imported backups alike. */
function wsNormalizeSheet(raw, fallbackModule) {
  const s = raw && typeof raw === "object" ? raw : {};
  const sheet = {
    id: wsSafeId(s.id) || wsUid(),
    moduleKey: wsStr(s.moduleKey) || fallbackModule || "",
    title: wsStr(s.title),
    subtitle: wsStr(s.subtitle),
    settings: Object.assign({}, s.settings && typeof s.settings === "object" ? s.settings : {}),
    createdAt: Number(s.createdAt) || 0,
    updatedAt: Number(s.updatedAt) || 0,
    blocks: []
  };
  const usedIds = new Set();
  (Array.isArray(s.blocks) ? s.blocks : []).forEach((b, i) => {
    if (!b || typeof b !== "object") return;
    let id = wsSafeId(b.id) || (sheet.id + "-b" + i);
    while (usedIds.has(id)) id = wsUid();
    usedIds.add(id);
    switch (b.type) {
      case "heading":
      case "text":
        sheet.blocks.push({ id, type: b.type, text: wsStr(b.text) });
        break;
      case "question":
        sheet.blocks.push({ id, type: "question", text: wsStr(b.text), lines: wsClamp(b.lines, 0, 12, 3),
          marks: wsClamp(b.marks, 0, 99, 0), answer: wsStr(b.answer) });
        break;
      case "choice": {
        let options = (Array.isArray(b.options) ? b.options : []).slice(0, 8).map(wsStr);
        while (options.length < 2) options.push("");
        sheet.blocks.push({ id, type: "choice", text: wsStr(b.text), options,
          correct: wsClamp(b.correct, -1, options.length - 1, -1), marks: wsClamp(b.marks, 0, 99, 0) });
        break;
      }
      case "table": {
        let cols = (Array.isArray(b.cols) ? b.cols : []).slice(0, 6).map(wsStr);
        if (!cols.length) cols = ["", ""];
        let rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20).map(r => {
          const row = (Array.isArray(r) ? r : []).slice(0, cols.length).map(wsStr);
          while (row.length < cols.length) row.push("");
          return row;
        });
        if (!rows.length) rows = [cols.map(() => "")];
        sheet.blocks.push({ id, type: "table", cols, rows });
        break;
      }
      case "pagebreak":
        sheet.blocks.push({ id, type: "pagebreak" });
        break;
    }
  });
  return sheet;
}

/* Fresh copies of a module's built-in worksheets (safe to mutate). */
function wsDefaultsFor(key) {
  const mod = wsModule(key);
  if (!mod) return [];
  const src = Array.isArray(WS_DEFAULTS[key]) && WS_DEFAULTS[key].length
    ? WS_DEFAULTS[key]
    : [wsBuildPlaceholder(mod)];
  return src.map(d => {
    const copy = wsNormalizeSheet(JSON.parse(JSON.stringify(d)), key);
    copy.moduleKey = key;
    return copy;
  });
}

function wsNewBlock(type) {
  const id = wsUid();
  switch (type) {
    case "heading":  return { id, type, text: "" };
    case "text":     return { id, type, text: "" };
    case "question": return { id, type, text: "", lines: 3, marks: 0, answer: "" };
    case "choice":   return { id, type, text: "", options: ["", "", "", ""], correct: -1, marks: 0 };
    case "table":    return { id, type, cols: ["", "", ""], rows: [["", "", ""], ["", "", ""], ["", "", ""]] };
    case "pagebreak":return { id, type };
  }
  return null;
}

function wsNewSheet(moduleKey) {
  const now = Date.now();
  return wsNormalizeSheet({
    id: "c-" + wsUid(),
    moduleKey,
    title: "",
    subtitle: "",
    settings: {},
    createdAt: now,
    updatedAt: now,
    blocks: [wsNewBlock("question")]
  }, moduleKey);
}
