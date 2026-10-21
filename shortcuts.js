/* ===================== The 29 World — Keyboard shortcuts =====================
   One small file, loaded (deferred) on every signed-in page, that adds the
   keyboard conveniences people expect on a computer. Everything here is
   additive — nothing changes for touch use, and every shortcut stands down
   while someone is typing in a box or a pop-up is waiting for an answer.

     / or ?       show the shortcut list (also in the Settings menu)
     Shift        tap it, then start typing a module name: a small box appears
                  and predicts the rest of the word as you type. Enter opens
                  the predicted module (Bank, Store, Jobs ...). Up/Down switch
                  between other matches, Esc cancels. Matches the start of the
                  name first ("ba" = Bank), then the start of any later word
                  ("deposit" = Term Deposit). A number works too: 1 is the first
                  module in the menu, 2 the second ... The numbers appear on the
                  menu itself while the box is open.
                  - It learns: when a few letters fit several modules, the one
                    you open most comes first ("s" = Store if that's your habit),
                    and Shift then Enter on an empty box goes back to the module
                    you were on before this one.
                  - It forgives typos, as a last resort when nothing else
                    matches ("bnk" = Bank, "kiwsaver" = KiwiSaver). A correctly
                    typed start of a name is never treated as a typo.
                  - It runs actions too: dark, settings, notifications, help.
     Left/Right   go to the previous / next module in the menu, from the one
                  you're on (locked modules are skipped)
     N            open / close notifications
     S            open / close settings
     D            switch dark / light mode
     Esc          close the top-most pop-up
     Enter        in an amount/field that isn't inside a <form>, press the
                  button that goes with it (Ctrl/Cmd + Enter does the same
                  from a multi-line box, e.g. the job application letter)
     page keys    Store: C = cart.  Blackjack: Enter = new round.

   All of the above can be switched off in Settings ("Use keyboard shortcuts").
   Esc, Enter-for-the-matching-button and the accessibility extras below are
   not "shortcuts" and stay on.

   Also here: Enter/Space on role="button"
   elements, focus moving into a pop-up when it opens (and back when it
   closes), and the mouse wheel no longer nudging a focused number box.

   Navigation always goes through the real nav link's click(), so a module a
   teacher has locked still shows its lock message / quiz instead of opening.
================================================================================ */
(function () {
  "use strict";
  if (window.T29Keys) return;

  // Pages that count as "modules" for the Shift finder. Only the ones whose
  // link is in THIS page's nav are offered, so students and teachers each
  // get their own list (and a locked module still shows its lock message).
  var MODULE_FILES = [
    "student.html", "teacher.html", "teacher-home.html", "bank.html", "budget.html",
    "termdeposit.html", "kiwisaver.html", "loan.html", "market.html", "store.html",
    "marketplace.html", "jobs.html", "transport.html", "property.html", "insurance.html",
    "tax.html", "bigevents.html", "life.html", "gambling.html", "quizzes.html", "reports.html"
  ];

  var FINE_POINTER = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  var IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  var MOD = IS_MAC ? "\u2318" : "Ctrl";

  // ---------- on / off (Settings -> "Use keyboard shortcuts") ----------
  var PREF_KEY = "t29-shortcuts-off";
  function readPref() { try { return localStorage.getItem(PREF_KEY) !== "1"; } catch (err) { return true; } }
  var keysOn = readPref();
  function applyPref() { if (!keysOn) { closeFinder(true); hideHelp(); } hintNavLinks(); }
  function setKeysOn(on) {
    keysOn = !!on;
    try { if (keysOn) localStorage.removeItem(PREF_KEY); else localStorage.setItem(PREF_KEY, "1"); } catch (err) { /* ignore */ }
    applyPref();
  }
  window.addEventListener("storage", function (e) { if (e.key === PREF_KEY) { keysOn = readPref(); applyPref(); } });

  // ---------- small helpers ----------
  function pageFile() { return (location.pathname.split("/").pop() || "index.html").toLowerCase(); }
  function fileOf(a) { return (a.getAttribute("href") || "").split("#")[0].split("?")[0].split("/").pop().toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shown(el) { return !!el && !el.classList.contains("hidden") && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function byId(id) { return document.getElementById(id); }

  function isTyping(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !/^(checkbox|radio|button|submit|reset|range|file|color|image)$/i.test(el.type || "text");
    return !!el.isContentEditable;
  }

  function usable(btn) {
    return !!btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true" && shown(btn);
  }

  // Pop-ups that must be answered (or are mid-flow) — letter shortcuts wait.
  function blockingPopupOpen() {
    if (document.querySelector(".t29-dialog-overlay:not(#t29KeysOverlay), .anw-modal-overlay:not(.hidden)")) return true;
    return openModals().length > 0;
  }

  // The page's own "...Modal" panels (jobs, reports, class picker, etc.).
  function openModals() {
    var all = document.querySelectorAll('[id$="Modal"]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      if (m.id.indexOf("t29") === 0 || m.classList.contains("anw-modal-overlay")) continue;
      if (shown(m)) out.push(m);
    }
    return out;
  }

  function closeControlFor(modal) {
    var explicit = modal.querySelector('[data-close], .modal-close, button[aria-label="Close"]');
    if (explicit) return explicit;
    var btns = modal.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (/^\s*(close|cancel|done|dismiss|not now|\u00d7|\u2715)\s*$/i.test(btns[i].textContent || "") && usable(btns[i])) return btns[i];
    }
    return null;
  }

  // ---------- "tap Shift, then type a name" ----------
  // The box finds modules (Bank, Store ...) and a few actions (dark, settings,
  // notifications, help). Matching goes, in order:
  //   0 the whole name   1 the start of the name   2 the start of a later word
  //   3 another name people use (an "alias", e.g. the old "account")
  //   4 a typo, ONLY when nothing in 0-3 matches ("bnk" = Bank)
  // so a correctly typed word is never mistaken for a typo of something else.
  // Inside a tier, modules the person opens most come first.
  function stripSp(s) { return String(s).replace(/\s+/g, "").toLowerCase(); }
  function linkLabel(a) {
    var l = a.querySelector(".nav-label");
    if (l) return (l.textContent || "").replace(/\s+/g, " ").trim();
    var c = a.cloneNode(true), b = c.querySelector(".t29-numbadge");
    if (b) b.remove();
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }
  // Other names for a module, tried only after its real name.
  var ALIASES = { "student.html": ["account", "home"], "budget.html": ["budgeting"] };

  // Menu links this person doesn't get (Tax is teacher-only; KiwiSaver can be switched off).
  function hiddenByRole(f) {
    var root = document.documentElement, teacher = root.classList.contains("role-teacher");
    if (f === pageFile() || teacher) return false;
    if (f === "tax.html") return true;
    if (f === "kiwisaver.html") return !root.classList.contains("ks-on");
    return false;
  }

  // ----- what this person opens most (kept per person on this device) -----
  var USE_KEY = "t29-nav-use";
  function useUser() { try { return (typeof T29_SESSION_USERNAME !== "undefined" && T29_SESSION_USERNAME) || ""; } catch (err) { return ""; } }
  function readUseAll() { try { var a = JSON.parse(localStorage.getItem(USE_KEY) || "{}"); return a && typeof a === "object" ? a : {}; } catch (err) { return {}; } }
  function useOf(all, u) {
    var m = all[u];
    if (!m || typeof m !== "object") m = all[u] = {};
    if (!m.n || typeof m.n !== "object") m.n = {};
    if (!m.t || typeof m.t !== "object") m.t = {};
    return m;
  }
  function myUse() { return useOf(readUseAll(), useUser() || "_"); }
  var visitSaved = false;
  function recordVisit() {
    if (visitSaved) return true;
    var u = useUser(), f = pageFile();
    if (!u) return false;
    visitSaved = true;
    if (MODULE_FILES.indexOf(f) < 0) return true;
    try {
      var nav = window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      var all = readUseAll(), m = useOf(all, u);
      if (m.cur !== f) {                       // a reload of the same page changes nothing
        if (m.cur) m.prev = m.cur;
        m.cur = f;
        if (!(nav && nav.type === "reload")) { m.n[f] = (m.n[f] || 0) + 1; m.t[f] = Date.now(); }
        localStorage.setItem(USE_KEY, JSON.stringify(all));
      }
    } catch (err) { /* storage full / blocked: nothing is learned, nothing breaks */ }
    return true;
  }
  function waitForUserThenRecord(tries) {
    if (recordVisit() || tries <= 0) return;
    setTimeout(function () { waitForUserThenRecord(tries - 1); }, 300);
  }

  function moduleItems() {
    var out = [], seen = {}, cur = pageFile();
    var links = document.querySelectorAll(".topbar nav a[href]"); // the menu only, not the "The 29 World" brand link
    for (var i = 0; i < links.length; i++) {
      var f = fileOf(links[i]);
      if (links[i].classList.contains("brand") || MODULE_FILES.indexOf(f) < 0 || seen[f] || hiddenByRole(f)) continue;
      seen[f] = 1;
      out.push({ kind: "module", file: f, label: linkLabel(links[i]), link: links[i], here: f === cur, num: out.length + 1 });
    }
    return out;
  }
  // Things the box can do, as well as go to.
  var ACTIONS = [
    { id: "dark", label: "Dark mode", words: ["light"], does: "switches dark / light mode",
      ok: function () { return true; }, run: function () { toggleTheme(); } },
    { id: "settings", label: "Settings", words: ["preferences"], does: "opens settings",
      ok: function () { return !!byId("settingsBtn"); }, run: function () { togglePanel("settingsBtn"); } },
    { id: "notifications", label: "Notifications", words: ["alerts"], does: "opens notifications",
      ok: function () { return !!byId("notifBell"); }, run: function () { togglePanel("notifBell"); } },
    { id: "help", label: "Help", words: ["shortcuts", "keys"], does: "shows the shortcut list",
      ok: function () { return true; }, run: function () { showHelp(); } }
  ];
  function finderEntries() {
    var mods = moduleItems(), out = mods.slice();
    ACTIONS.forEach(function (a) {
      if (a.ok()) out.push({ kind: "action", id: a.id, label: a.label, words: a.words, does: a.does, run: a.run, here: false, num: 0 });
    });
    return out;
  }
  // Shortest start of the name that points at just this module ("Ba" = Bank).
  function shortestPrefix(item, items) {
    var s = stripSp(item.label), n = s.length;
    for (var len = 1; len <= s.length; len++) {
      var p = s.slice(0, len), c = 0;
      for (var i = 0; i < items.length; i++) if (stripSp(items[i].label).indexOf(p) === 0) c++;
      if (c === 1) { n = len; break; }
    }
    var seen = 0, cut = 0, lab = item.label;
    for (; cut < lab.length && seen < n; cut++) if (!/\s/.test(lab[cut])) seen++;
    return lab.slice(0, cut);
  }
  function isNumberQuery(typed) { return /^\s*\d+\s*$/.test(typed); }
  // The module used in examples: Bank if it's in this menu, else the first other one.
  function sampleItem(items) {
    var pick = null;
    items.forEach(function (it) { if (it.kind === "module" && !it.here && (!pick || /^bank$/i.test(it.label))) pick = it; });
    return pick;
  }

  // ----- typo matching -----
  var KEY_POS = {};
  ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach(function (row, y) {
    for (var x = 0; x < row.length; x++) KEY_POS[row[x]] = [x + [0, 0.25, 0.75][y], y];
  });
  function nearKeys(a, b) {
    var p = KEY_POS[a], q = KEY_POS[b];
    if (!p || !q) return false;
    var dx = p[0] - q[0], dy = p[1] - q[1];
    return Math.sqrt(dx * dx + dy * dy) <= 1.3;
  }
  // Edit distance where the usual slips are cheap: a neighbouring key (0.55),
  // two letters swapped (0.7), a doubled letter added or dropped (0.6).
  // Everything else (a missing, extra or different letter) costs 1.
  function typoCost(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = []; for (j = 0; j <= n; j++) d[i][j] = 0; }
    for (i = 1; i <= m; i++) d[i][0] = i;
    for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      var sub = a[i - 1] === b[j - 1] ? 0 : (nearKeys(a[i - 1], b[j - 1]) ? 0.55 : 1);
      var del = (i > 1 && a[i - 1] === a[i - 2]) ? 0.6 : 1;   // typed a letter twice
      var ins = (j > 1 && b[j - 1] === b[j - 2]) ? 0.6 : 1;   // forgot one of a double letter
      var v = Math.min(d[i - 1][j - 1] + sub, d[i - 1][j] + del, d[i][j - 1] + ins);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 0.7);
      d[i][j] = v;
    }
    return d[m][n];
  }
  // How many "slips" a typed word of this length may contain: none for one or
  // two letters (too little to go on), about one for short words, more for long ones.
  function typoAllowance(len) { return len < 3 ? 0 : len === 3 ? 1.0 : len === 4 ? 1.05 : len <= 6 ? 1.7 : len <= 9 ? 2.1 : 2.6; }
  // Best cost of q against one target word, treating q as possibly still being typed
  // (so it is compared with the start of the target as well as the whole word).
  function targetCost(q, c) {
    var L = q.length, best = Infinity, tried = {}, lens = [c.length];
    if (L >= 3) lens.push(L, L + 1);
    if (L >= 4) lens.push(L + 2);
    if (L >= 5) lens.push(L - 1);
    for (var i = 0; i < lens.length; i++) {
      var len = lens[i];
      if (len < 2 || len > c.length || tried[len]) continue;
      tried[len] = 1;
      var cost = typoCost(q, c.slice(0, len));
      // Three letters is too little to guess from: held against the start of a longer
      // name it must be only a neighbouring key / swapped letters, never a plain wrong letter.
      if (L === 3 && len === L && c.length > L && cost >= 1) continue;
      if (L === 3 && len === c.length && c.length > 5) continue; // ...and not held against a long whole name
      // Mixing up the first letter is rare, so it counts extra (unless the first two are just swapped).
      if (q[0] !== c[0] && !(q[1] === c[0] && q[0] === c[1])) cost += 0.8;
      if (cost < best) best = cost;
    }
    return best;
  }
  function targetsOf(it) {
    var lab = it.label, out = [{ s: stripSp(lab), pen: 0 }], re = /\s+/g, w;
    lab.split(/\s+/).forEach(function (word, i) { if (i === 0 && lab.indexOf(" ") > 0) out.push({ s: stripSp(word), pen: 0 }); });
    while ((w = re.exec(lab))) out.push({ s: stripSp(lab.slice(w.index + w[0].length)), pen: 0.15 });
    var extra = it.words || ALIASES[it.file] || [];
    extra.forEach(function (x) { out.push({ s: stripSp(x), pen: 0.15 }); });
    return out;
  }
  function typoMatches(items, q, use) {
    var allow = typoAllowance(q.length);
    if (!allow) return [];
    var found = [];
    items.forEach(function (it, idx) {
      var best = Infinity;
      targetsOf(it).forEach(function (t) { var c = targetCost(q, t.s) + t.pen; if (c < best) best = c; });
      if (best <= allow) found.push({ it: it, cost: best, idx: idx });
    });
    if (!found.length) return [];
    var top = Infinity;
    found.forEach(function (f) { if (f.cost < top) top = f.cost; });
    // Keep only real contenders, so a clear typo gets one clear answer.
    found = found.filter(function (f) { return f.cost <= top + 0.5; });
    found.sort(function (a, b) {
      return (a.cost - b.cost) || rankTie(a.it, b.it, use) || (a.idx - b.idx);
    });
    return found.map(function (f) { var m = withAt(f.it, 0); m.tier = 4; return m; });
  }

  // Same-quality matches: the page you're not already on, then the one you open most.
  function rankTie(a, b, use) {
    var ah = a.here ? 1 : 0, bh = b.here ? 1 : 0;
    if (ah !== bh) return ah - bh;
    var an = a.kind === "module" ? (use.n[a.file] || 0) : 0, bn = b.kind === "module" ? (use.n[b.file] || 0) : 0;
    if (an !== bn) return bn - an;
    var at = a.kind === "module" ? (use.t[a.file] || 0) : 0, bt = b.kind === "module" ? (use.t[b.file] || 0) : 0;
    if (at !== bt) return bt - at;
    return (a.kind === b.kind ? 0 : (a.kind === "module" ? -1 : 1));
  }
  function withAt(it, at) {
    var o = {}; for (var k in it) o[k] = it[k];
    o.at = at; o.tier = 1; o.via = "";
    return o;
  }
  function findMatches(items, typed, use) {
    var q = stripSp(typed);
    if (!q) return [];
    if (isNumberQuery(typed)) { // 1 = first module in the menu, 2 = second ...
      var raw = typed.trim();
      return items.filter(function (it) { return it.kind === "module" && String(it.num).indexOf(raw) === 0; })
        .map(function (it) { return withAt(it, 0); })
        .sort(function (a, b) { return (String(a.num) === raw ? 0 : 1) - (String(b.num) === raw ? 0 : 1) || a.num - b.num; });
    }
    var hits = [];
    items.forEach(function (it, idx) {
      var lab = it.label, m = null, whole = stripSp(lab);
      if (whole === q) { m = withAt(it, 0); m.tier = 0; }
      else if (whole.indexOf(q) === 0) { m = withAt(it, 0); m.tier = 1; }
      else {
        var re = /\s+/g, w;
        while ((w = re.exec(lab))) {
          var at = w.index + w[0].length;
          if (stripSp(lab.slice(at)).indexOf(q) === 0) { m = withAt(it, at); m.tier = 2; break; }
        }
        if (!m && q.length >= 3) { // other names need 3+ letters, so one or two letters stay about real names
          var al = it.words || ALIASES[it.file] || [];
          for (var i = 0; i < al.length; i++) {
            if (stripSp(al[i]).indexOf(q) === 0) { m = withAt(it, 0); m.tier = 3; m.via = al[i]; break; }
          }
        }
      }
      if (m) { m.idx = idx; hits.push(m); }
    });
    if (!hits.length) return typoMatches(items, q, use); // last resort
    hits.sort(function (a, b) {
      var ta = a.tier === 0 ? 0 : a.tier, tb = b.tier === 0 ? 0 : b.tier;
      if (ta !== tb) return ta - tb;
      // The whole name typed out always wins; otherwise most-used first.
      return (a.tier === 0 ? 0 : rankTie(a, b, use)) || (a.idx - b.idx);
    });
    return hits;
  }
  // The grey prediction: the rest of the name (or, for a later-word match,
  // the rest of that word followed by the whole name).
  function restOf(m, typed) {
    if (isNumberQuery(typed)) { // "2" -> " (Bank)"
      var more = String(m.num).slice(typed.trim().length) + " (" + m.label + ")";
      return /\s$/.test(typed) ? more.replace(/^\s/, "") : more;
    }
    if (m.tier === 4) return " \u2192 " + m.label;                       // a typo: show where it points
    var label = m.label, n = stripSp(typed).length, seen = 0, i = m.at;
    if (m.tier === 3) { var via = stripSp(m.via).slice(n); return (via ? via : "") + " \u2192 " + label; }
    for (; i < label.length && seen < n; i++) if (!/\s/.test(label[i])) seen++;
    var rest = label.slice(i);
    if (/\s$/.test(typed)) rest = rest.replace(/^\s/, "");
    return m.at ? rest + " \u2192 " + label : rest;
  }

  var finderEl = null, finderReturnFocus = null, badged = [];
  // Numbers on the menu itself while the box is open, so nobody has to open the list to learn them.
  function showBadges(items) {
    items.forEach(function (it) {
      var a = it.link;
      if (it.kind !== "module" || !a || a.querySelector(".t29-numbadge")) return;
      var b = document.createElement("span");
      b.className = "t29-numbadge"; b.setAttribute("aria-hidden", "true"); b.textContent = String(it.num);
      a.classList.add("t29-badged"); a.appendChild(b); badged.push(a);
    });
  }
  function hideBadges() {
    badged.forEach(function (a) {
      var b = a.querySelector(".t29-numbadge"); if (b) b.remove();
      a.classList.remove("t29-badged", "t29-nav-pick");
    });
    badged = [];
  }
  function closeFinder(noRestore) {
    if (!finderEl) return;
    var el = finderEl, back = finderReturnFocus;
    finderEl = null; finderReturnFocus = null;
    hideBadges();
    el.remove();
    if (!noRestore && back && document.contains(back) && typeof back.focus === "function") {
      try { back.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    }
  }
  function openFinder() {
    if (finderEl) return;
    var entries = finderEntries(), items = entries.filter(function (e) { return e.kind === "module"; });
    if (!entries.length) return;
    finderReturnFocus = document.activeElement;
    finderEl = document.createElement("div");
    finderEl.className = "t29-finder";
    finderEl.setAttribute("role", "dialog");
    finderEl.setAttribute("aria-label", "Jump to a module or run an action");
    finderEl.innerHTML =
      '<label class="t29-finder-title" for="t29FinderInput">Go to&hellip;</label>' +
      '<div class="t29-finder-field"><span class="t29-finder-ghost" aria-hidden="true"><span class="t29-finder-typed"></span><span class="t29-finder-rest"></span></span>' +
      '<input id="t29FinderInput" class="t29-finder-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-autocomplete="inline" aria-describedby="t29FinderNote"></div>' +
      '<div id="t29FinderNote" class="t29-finder-note" role="status" aria-live="polite"></div>';
    document.body.appendChild(finderEl);
    showBadges(items);

    var input = finderEl.querySelector("input"), typedEl = finderEl.querySelector(".t29-finder-typed"),
        restEl = finderEl.querySelector(".t29-finder-rest"), note = finderEl.querySelector(".t29-finder-note");
    var matches = [], pick = 0;
    var sample = sampleItem(items);
    var use = myUse();
    // Shift, Enter with nothing typed = back to the module visited before this one.
    var back = null;
    items.forEach(function (it) { if (it.file === use.prev && !it.here) back = it; });

    function mark(m) {
      badged.forEach(function (a) { a.classList.remove("t29-nav-pick"); });
      if (m && m.kind === "module" && m.link) m.link.classList.add("t29-nav-pick");
    }
    function update() {
      matches = findMatches(entries, input.value, use);
      if (pick >= matches.length) pick = 0;
      var m = matches[pick], txt;
      typedEl.textContent = input.value;
      restEl.textContent = m ? restOf(m, input.value) : (!input.value.trim() && back ? "\u21A9 " + back.label : "");
      if (!input.value.trim()) {
        txt = (back ? "Enter goes back to " + back.label + " \u00B7 or type" : "Type") +
          (sample ? " the start of a name or a number, e.g. \u201C" + shortestPrefix(sample, items).toLowerCase() + "\u201D or \u201C" + sample.num + "\u201D" : " a name") +
          " \u00B7 actions: dark, settings, notifications, help";
      } else if (!m) {
        txt = isNumberQuery(input.value) ? "No module is numbered " + input.value.trim() : "Nothing matches \u201C" + input.value.trim() + "\u201D";
      } else {
        var what = m.kind === "action" ? (m.tier === 4 ? "Did you mean " + m.label + "? " : "") + "Enter " + m.does
          : m.here ? "You\u2019re already on " + m.label
          : m.tier === 4 ? "Did you mean " + m.label + "? Enter opens it"
          : "Enter opens " + m.label;
        txt = what + (matches.length > 1 ? " \u00B7 \u2191\u2193 for the other " + (matches.length - 1) : "");
      }
      note.textContent = txt;
      mark(m);
    }
    function go() {
      var m = matches[pick];
      if (!input.value.trim()) m = back; // nothing typed: back to the last module
      if (!m) return;
      var link = m.link, here = m.here, run = m.run, isAction = m.kind === "action";
      closeFinder();
      if (isAction) { if (run) run(); }
      else if (!here && link) link.click();
    }
    input.addEventListener("input", function () { pick = 0; update(); });
    input.addEventListener("keydown", function (e) {
      e.stopPropagation(); // keep the page's own Enter / letter shortcuts out of this box
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); closeFinder(); }
      else if (e.key === "Enter") { e.preventDefault(); go(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && matches.length > 1) {
        e.preventDefault();
        pick = (pick + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        update();
      } else if ((e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && input.selectionStart === input.value.length)) {
        var m = matches[pick];
        if (m && restEl.textContent) { e.preventDefault(); input.value = m.label; update(); }
      }
    });
    input.addEventListener("blur", function () { setTimeout(function () { closeFinder(true); }, 0); });
    update();
    input.focus();
  }

  // A "tap" of Shift = pressed and let go on its own, quickly, with no other key or click in between.
  var shiftSolo = false, shiftAt = 0;
  function onKeyUp(e) {
    if (e.key !== "Shift") return;
    var solo = shiftSolo && Date.now() - shiftAt < 700;
    shiftSolo = false;
    if (!keysOn || !solo || finderEl || helpEl) return;
    if (isTyping(e.target) || blockingPopupOpen()) return;
    openFinder();
  }

  // ---------- help overlay ----------
  var helpEl = null, helpReturnFocus = null;
  function kbd(txt) { return '<kbd class="t29-kbd">' + esc(txt) + "</kbd>"; }
  function row(keys, label) {
    return '<div class="t29-keys-row"><span class="t29-keys-keys">' + keys + '</span><span class="t29-keys-label">' + esc(label) + "</span></div>";
  }
  function section(title, rows) {
    if (!rows.length) return "";
    return '<div class="t29-keys-sec"><h3>' + esc(title) + "</h3>" + rows.join("") + "</div>";
  }

  var PAGE_KEYS = [
    { file: "store.html", key: "c", label: "Open or close the cart",
      ok: function () { return typeof window.cartOpen === "function"; },
      run: function () {
        if (typeof CART_OPEN !== "undefined" && CART_OPEN && typeof window.cartCloseDrawer === "function") window.cartCloseDrawer();
        else window.cartOpen();
      } }
  ];
  function pageKeys() { var f = pageFile(); return PAGE_KEYS.filter(function (p) { return p.file === f; }); }

  function buildHelp() {
    var general = [
      row(kbd("/") + ' <span class="t29-keys-or">or</span> ' + kbd("?"), "Show this list"),
      row(kbd("Shift"), "Tap it, then type a module name or an action (see right)"),
      row(kbd("\u2190") + " " + kbd("\u2192"), "Go to the previous / next module"),
      row(kbd("Esc"), "Close a pop-up, menu or this list"),
      row(kbd("N"), "Open or close notifications"),
      row(kbd("S"), "Open or close settings"),
      row(kbd("D"), "Switch dark / light mode")
    ];
    var forms = [
      row(kbd("Enter"), "Press the button that goes with the box you're typing in")
    ];
    var page = pageKeys().map(function (p) { return row(kbd(p.key.toUpperCase()), p.label); });
    if (pageFile() === "gambling.html") page.push(row(kbd("Enter"), "Blackjack: start a new round"));
    var items = moduleItems();
    var go = items.map(function (it) {
      return row(kbd(String(it.num)) + " " + kbd(shortestPrefix(it, items)), it.label + (it.here ? " \u2014 you\u2019re here" : ""));
    });
    var goIntro = go.length ? '<p class="t29-keys-intro">Tap ' + kbd("Shift") + ", type part of a name or its number, then press " + kbd("Enter") + ".<br>Forgives typos, learns your favourites, and runs actions: " + kbd("dark") + " " + kbd("settings") + " " + kbd("notifications") + " " + kbd("help") + ".<br>" + kbd("Shift") + " then " + kbd("Enter") + " returns to your last module.</p>" : "";
    var offNote = keysOn ? "" : '<p class="t29-keys-intro"><strong>Shortcuts are switched off.</strong> Turn them back on in Settings.</p>';
    return '<div class="t29-dialog t29-keys-card" role="dialog" aria-modal="true" aria-labelledby="t29KeysTitle">' +
      '<div class="t29-keys-head"><h2 id="t29KeysTitle">Keyboard shortcuts</h2>' +
      '<button type="button" class="t29-keys-close" aria-label="Close">&times;</button></div>' + offNote +
      '<div class="t29-keys-cols"><div>' + section("General", general) + section("Typing", forms) + section("This page", page) +
      "</div><div>" + (go.length ? section("Jump to a module", go).replace("</h3>", "</h3>" + goIntro).replace('t29-keys-sec"', 't29-keys-sec t29-keys-mods"') : "") + "</div></div>" +
      '<p class="t29-keys-foot muted-small">Shortcuts pause while you\u2019re typing in a box.</p></div>';
  }
  function showHelp() {
    if (helpEl) return;
    helpReturnFocus = document.activeElement;
    helpEl = document.createElement("div");
    helpEl.id = "t29KeysOverlay";
    helpEl.className = "t29-dialog-overlay";
    helpEl.innerHTML = buildHelp();
    helpEl.addEventListener("click", function (e) { if (e.target === helpEl) hideHelp(); });
    helpEl.querySelector(".t29-keys-close").addEventListener("click", hideHelp);
    document.body.appendChild(helpEl);
    helpEl.querySelector(".t29-keys-close").focus();
  }
  function hideHelp() {
    if (!helpEl) return;
    helpEl.remove(); helpEl = null;
    if (helpReturnFocus && document.contains(helpReturnFocus) && typeof helpReturnFocus.focus === "function") {
      try { helpReturnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    helpReturnFocus = null;
  }

  // ---------- Enter = press the matching button ----------
  var ENTER_TYPES = /^(text|number|password|email|tel|url|search|date|datetime-local|month|time|week)$/i;
  // Fields whose nearest button only adds a row to a builder — Enter there
  // would add an empty tier/question, not save, so it does nothing.
  var NO_ENTER = "#qTitle,#qPass,#qReward,#qDesc,[id^='qb-'],.tier-name-input,.tier-wage-input,.tier-desc-input," +
    ".threshold-row input,.bracket-row input,.qty-input,[data-no-enter]";
  var BAD_BTN_CLASS = /\b(coral|danger|qty-btn|btn-icon-topbar|btn-logout|nav-group-btn|link-btn|rc-btn|rc-grip|notif-[a-z]+)\b/;
  var BAD_BTN_TEXT = /^\s*(cancel|close|remove|delete|back|reset|clear|dismiss|\u00d7|x|\+?\s*add (tier|question|option|row|bracket))\b/i;
  var BOUNDARY = "main, body, form, table, .card, .anw-modal-card, .t29-dialog, [id$='Modal']";

  function candidateOk(b) {
    if (!usable(b) || (b.type && b.type.toLowerCase() === "reset")) return false;
    if (BAD_BTN_CLASS.test(b.className || "")) return false;
    if (BAD_BTN_TEXT.test(b.textContent || "")) return false;
    if (/remove|delete|cancel|close/i.test(b.getAttribute("onclick") || "")) return false;
    return true;
  }

  function enterTarget(el) {
    var named = el.getAttribute("data-enter");
    if (named) { var nb = byId(named); return usable(nb) ? nb : null; }
    if (el.matches(NO_ENTER)) return null;
    var scope = el.parentElement;
    for (var hops = 0; scope && hops < 6; hops++) {
      var btns = scope.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (!(el.compareDocumentPosition(btns[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (candidateOk(btns[i])) return btns[i];
      }
      if (scope.matches(BOUNDARY)) return null;
      scope = scope.parentElement;
    }
    return null;
  }

  function onEnter(e) {
    if (e.key !== "Enter" || e.isComposing || e.repeat || e.defaultPrevented) return false;
    var el = e.target;
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "TEXTAREA") { if (!(e.ctrlKey || e.metaKey)) return false; }
    else if (el.tagName === "INPUT") {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !ENTER_TYPES.test(el.type || "text")) return false;
    } else return false;
    if (el.form) return false; // <form>s already submit natively
    // gambling.js keeps its own Enter map for the bet boxes — leave those to it.
    if (typeof ENTER_KEY_MAP !== "undefined" && ENTER_KEY_MAP && ENTER_KEY_MAP[el.id]) return false;
    var btn = enterTarget(el);
    if (!btn) return false;
    e.preventDefault();
    btn.click();
    return true;
  }

  // ---------- the main key handler ----------
  function togglePanel(id) { var b = byId(id); if (b) b.click(); }

  function toggleTheme() {
    var on = !document.documentElement.classList.contains("dark-mode");
    if (typeof dmSetOn === "function") dmSetOn(on);
    else {
      document.documentElement.classList.toggle("dark-mode", on);
      try { localStorage.setItem("t29-dark-mode", on ? "1" : "0"); } catch (err) { /* ignore */ }
    }
    var cb = byId("t29DarkModeToggle"); if (cb) cb.checked = on;
    if (typeof t29Toast === "function") t29Toast(on ? "Dark mode on" : "Dark mode off", { duration: 1600 });
  }

  // Arrow keys already mean something in sliders, radio buttons, tabs, menus, etc.
  function arrowOwned(el) {
    if (!el || el.nodeType !== 1) return false;
    if (/^(INPUT|SELECT|TEXTAREA|AUDIO|VIDEO)$/.test(el.tagName)) return true;
    return !!el.closest('[role="tab"],[role="tablist"],[role="slider"],[role="radio"],[role="radiogroup"],[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="spinbutton"],[role="tree"],[role="grid"],[role="scrollbar"],[contenteditable="true"]');
  }
  // Left / Right: the previous / next module in the menu, from this page. Returns false if this page isn't in the menu.
  function stepModule(dir) {
    var items = moduleItems(), cur = -1;
    for (var i = 0; i < items.length; i++) if (items[i].here) { cur = i; break; }
    if (cur < 0) return false;
    for (var j = cur + dir; j >= 0 && j < items.length; j += dir) {
      if (items[j].link.classList.contains("nav-locked")) continue; // locked: skip over it
      items[j].link.click();
      return true;
    }
    if (typeof t29Toast === "function") t29Toast(dir < 0 ? "That\u2019s the first module" : "That\u2019s the last module", { duration: 1400 });
    return true;
  }

  function onKey(e) {
    if (!e.key || e.isComposing) return;

    // Shift on its own is the "jump to a module" key — any other key cancels the tap.
    if (e.key === "Shift") { if (!e.repeat) { shiftSolo = keysOn && !(e.ctrlKey || e.metaKey || e.altKey); shiftAt = Date.now(); } return; }
    shiftSolo = false;

    if (e.key === "Escape") {
      if (helpEl) { e.preventDefault(); hideHelp(); return; }
      if (e.defaultPrevented) return;
      var ms = openModals();
      if (ms.length) { var c = closeControlFor(ms[ms.length - 1]); if (c) c.click(); }
      return;
    }

    // Enter / Space on custom "button" elements (div with role="button").
    if ((e.key === "Enter" || e.key === " ") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var t = e.target, role = t && t.getAttribute && t.getAttribute("role");
      if (t && t.hasAttribute && t.hasAttribute("tabindex") && (role === "button" || (role === "link" && e.key === "Enter")) &&
          !/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) {
        e.preventDefault();
        if (!e.repeat) t.click();
        return;
      }
    }

    if (onEnter(e)) return;
    if (!keysOn) return; // shortcuts switched off in Settings

    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.shiftKey && k !== "?" && k !== "/") return;

    if (helpEl) { if (k === "?" || k === "/") { e.preventDefault(); hideHelp(); } return; }

    if (e.repeat) return;

    // Blackjack: Enter starts the next round when nothing else has focus.
    if (k === "Enter" && pageFile() === "gambling.html" && e.target === document.body) {
      var nr = byId("bjNewRoundBtn");
      if (usable(nr) && !blockingPopupOpen()) { e.preventDefault(); nr.click(); }
      return;
    }

    if (k === "?" || k === "/") { e.preventDefault(); showHelp(); return; }
    if (blockingPopupOpen()) return;

    if (k === "ArrowLeft" || k === "ArrowRight") {
      if (arrowOwned(e.target) || document.querySelector(".t29-tour")) return;
      if (stepModule(k === "ArrowLeft" ? -1 : 1)) e.preventDefault();
      return;
    }

    // Keys that only exist on one page (Store: C = cart).
    var pk = pageKeys();
    for (var i = 0; i < pk.length; i++) {
      if (pk[i].key !== k) continue;
      if (pk[i].btn) { var b = byId(pk[i].btn); if (usable(b)) { e.preventDefault(); b.click(); return; } }
      else if (!pk[i].ok || pk[i].ok()) { e.preventDefault(); pk[i].run(); return; }
    }

    if (k === "n") { if (byId("notifBell")) { e.preventDefault(); togglePanel("notifBell"); } return; }
    if (k === "s") { if (byId("settingsBtn")) { e.preventDefault(); togglePanel("settingsBtn"); } return; }
    if (k === "d") { e.preventDefault(); toggleTheme(); return; }
  }

  // ---------- init-time extras ----------
  function hintNavLinks() {
    var items = moduleItems();
    items.forEach(function (it) {
      var a = it.link, mine = a.getAttribute("data-t29-hint") === "1";
      if (!keysOn || !FINE_POINTER || it.here) {
        if (mine) { a.removeAttribute("title"); a.removeAttribute("data-t29-hint"); }
        return;
      }
      if (a.title && !mine) return; // the page set its own tooltip
      a.title = it.label + " \u2014 tap Shift, then type \u201C" + shortestPrefix(it, items) + "\u201D or \u201C" + it.num + "\u201D";
      a.setAttribute("data-t29-hint", "1");
    });
  }

  // Move focus into a page pop-up when it opens; put it back when it closes.
  function watchModals() {
    var mods = document.querySelectorAll('[id$="Modal"]');
    for (var i = 0; i < mods.length; i++) (function (m) {
      if (m.getAttribute("data-t29-watch") || m.id.indexOf("t29") === 0 || m.classList.contains("anw-modal-overlay")) return;
      m.setAttribute("data-t29-watch", "1");
      var wasHidden = m.classList.contains("hidden"), opener = null;
      new MutationObserver(function () {
        var hidden = m.classList.contains("hidden");
        if (hidden === wasHidden) return;
        wasHidden = hidden;
        if (!hidden) {
          var ae = document.activeElement;
          opener = ae && ae !== document.body && !m.contains(ae) ? ae : null;
          if (!m.hasAttribute("role")) { m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); }
          if (FINE_POINTER) {
            var f = m.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select:not([disabled]), textarea:not([disabled])");
            if (f) { try { f.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
          }
        } else if (opener && document.contains(opener)) {
          try { opener.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
          opener = null;
        }
      }).observe(m, { attributes: true, attributeFilter: ["class"] });
    })(mods[i]);
  }

  function init() {
    waitForUserThenRecord(40); // learn which modules this person opens (see recordVisit)
    hintNavLinks();
    watchModals();
    // Nav groups/sidebar can rebuild the nav a moment after load.
    setTimeout(hintNavLinks, 600);
  }

  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousedown", function () { shiftSolo = false; }, true);
  // Scrolling the page while a number box has focus used to nudge its value.
  document.addEventListener("wheel", function (e) {
    var a = document.activeElement;
    if (a && a.tagName === "INPUT" && a.type === "number" && a === e.target) a.blur();
  }, { passive: true });
  window.addEventListener("blur", function () { shiftSolo = false; });

  window.T29Keys = { showHelp: showHelp, hideHelp: hideHelp, openFinder: openFinder };
  window.t29ShowShortcuts = showHelp;
  window.t29HasKeyboard = function () { return FINE_POINTER; };
  window.t29ShortcutsOn = function () { return keysOn; };
  window.t29SetShortcuts = setKeysOn;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
