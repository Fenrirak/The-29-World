/* ===================== The 29 World — Keyboard shortcuts =====================
   One small file, loaded (deferred) on every signed-in page, that adds the
   keyboard conveniences people expect on a computer. Everything here is
   additive — nothing changes for touch use, and every shortcut stands down
   while someone is typing in a box or a pop-up is waiting for an answer.

     / or ?       show the shortcut list (also in the Settings menu)
     Shift        tap it, then start typing a module name: a small box appears
                  and predicts the rest of the word as you type. Enter opens
                  the predicted module (Bank, Store, Jobs ...). Up/Down switch
                  between other matches, Esc cancels.
     N            open / close notifications
     S            open / close settings
     D            switch dark / light mode
     Esc          close the top-most pop-up
     Enter        in an amount/field that isn't inside a <form>, press the
                  button that goes with it (Ctrl/Cmd + Enter does the same
                  from a multi-line box, e.g. the job application letter)
     page keys    Store: C = cart.  Blackjack: H hit, S stand, D double,
                  P split, Enter = new round. During a hand S and D belong
                  to blackjack; the rest of the time they are settings / dark mode.

   Also here: Tab-key "skip to content" link, Enter/Space on role="button"
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

  // ---------- "tap Shift, then type a module name" ----------
  function stripSp(s) { return String(s).replace(/\s+/g, "").toLowerCase(); }
  function linkLabel(a) {
    var l = a.querySelector(".nav-label");
    return ((l ? l.textContent : a.textContent) || "").replace(/\s+/g, " ").trim();
  }
  function moduleItems() {
    var out = [], seen = {}, cur = pageFile();
    var links = document.querySelectorAll(".topbar a[href]");
    for (var i = 0; i < links.length; i++) {
      var f = fileOf(links[i]);
      if (MODULE_FILES.indexOf(f) < 0 || seen[f]) continue;
      seen[f] = 1;
      out.push({ file: f, label: linkLabel(links[i]), link: links[i], here: f === cur });
    }
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
  function findMatches(items, typed) {
    var q = stripSp(typed);
    if (!q) return [];
    return items.filter(function (it) { return stripSp(it.label).indexOf(q) === 0; });
  }
  // The part of the name the person hasn't typed yet (the grey prediction).
  function restOf(label, typed) {
    var n = stripSp(typed).length, seen = 0, i = 0;
    for (; i < label.length && seen < n; i++) if (!/\s/.test(label[i])) seen++;
    var rest = label.slice(i);
    return /\s$/.test(typed) ? rest.replace(/^\s/, "") : rest;
  }

  var finderEl = null, finderReturnFocus = null;
  function closeFinder(noRestore) {
    if (!finderEl) return;
    var el = finderEl, back = finderReturnFocus;
    finderEl = null; finderReturnFocus = null;
    el.remove();
    if (!noRestore && back && document.contains(back) && typeof back.focus === "function") {
      try { back.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    }
  }
  function openFinder() {
    if (finderEl) return;
    var items = moduleItems();
    if (!items.length) return;
    finderReturnFocus = document.activeElement;
    finderEl = document.createElement("div");
    finderEl.className = "t29-finder";
    finderEl.setAttribute("role", "dialog");
    finderEl.setAttribute("aria-label", "Jump to a module");
    finderEl.innerHTML =
      '<label class="t29-finder-title" for="t29FinderInput">Go to&hellip;</label>' +
      '<div class="t29-finder-field"><span class="t29-finder-ghost" aria-hidden="true"><span class="t29-finder-typed"></span><span class="t29-finder-rest"></span></span>' +
      '<input id="t29FinderInput" class="t29-finder-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-autocomplete="inline" aria-describedby="t29FinderNote"></div>' +
      '<div id="t29FinderNote" class="t29-finder-note" role="status" aria-live="polite"></div>';
    document.body.appendChild(finderEl);

    var input = finderEl.querySelector("input"), typedEl = finderEl.querySelector(".t29-finder-typed"),
        restEl = finderEl.querySelector(".t29-finder-rest"), note = finderEl.querySelector(".t29-finder-note");
    var matches = [], pick = 0;
    var sample = null;
    for (var i = 0; i < items.length; i++) if (!items[i].here) { sample = items[i]; break; }

    function update() {
      matches = findMatches(items, input.value);
      if (pick >= matches.length) pick = 0;
      var m = matches[pick], txt;
      typedEl.textContent = input.value;
      restEl.textContent = m ? restOf(m.label, input.value) : "";
      if (!input.value.trim()) {
        txt = sample ? "Type the start of a name, e.g. \u201C" + shortestPrefix(sample, items).toLowerCase() + "\u201D for " + sample.label : "";
      } else if (!m) {
        txt = "No module starts with \u201C" + input.value.trim() + "\u201D";
      } else {
        txt = (m.here ? "You\u2019re already on " + m.label : "Enter opens " + m.label) +
          (matches.length > 1 ? " \u00B7 \u2191\u2193 for the other " + (matches.length - 1) : "");
      }
      note.textContent = txt;
    }
    function go() {
      var m = matches[pick];
      if (!m) return;
      var link = m.link, here = m.here;
      closeFinder();
      if (!here) link.click();
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
    if (!solo || finderEl || helpEl) return;
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
      } },
    { file: "gambling.html", key: "h", label: "Blackjack: hit", btn: "bjHitBtn" },
    { file: "gambling.html", key: "s", label: "Blackjack: stand", btn: "bjStandBtn" },
    { file: "gambling.html", key: "d", label: "Blackjack: double down", btn: "bjDoubleBtn" },
    { file: "gambling.html", key: "p", label: "Blackjack: split", btn: "bjSplitBtn" }
  ];
  function pageKeys() { var f = pageFile(); return PAGE_KEYS.filter(function (p) { return p.file === f; }); }

  function buildHelp() {
    var general = [
      row(kbd("/") + ' <span class="t29-keys-or">or</span> ' + kbd("?"), "Show this list"),
      row(kbd("Shift"), "Tap it to jump to a module (see right)"),
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
    var go = items.filter(function (it) { return !it.here; }).map(function (it) { return row(kbd(shortestPrefix(it, items)), it.label); });
    var goIntro = go.length ? '<p class="t29-keys-intro">Tap ' + kbd("Shift") + ", type the first letters, then press " + kbd("Enter") + ".</p>" : "";
    var bjNote = pageFile() === "gambling.html"
      ? '<p class="t29-keys-intro">During a blackjack hand, S and D play the hand. At any other time they open settings and switch dark / light mode.</p>' : "";
    return '<div class="t29-dialog t29-keys-card" role="dialog" aria-modal="true" aria-labelledby="t29KeysTitle">' +
      '<div class="t29-keys-head"><h2 id="t29KeysTitle">Keyboard shortcuts</h2>' +
      '<button type="button" class="t29-keys-close" aria-label="Close">&times;</button></div>' +
      '<div class="t29-keys-cols"><div>' + section("General", general) + section("Typing", forms) + section("This page", page) + bjNote +
      "</div><div>" + (go.length ? section("Jump to a module", go).replace("</h3>", "</h3>" + goIntro) : "") + "</div></div>" +
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

  function onKey(e) {
    if (!e.key || e.isComposing) return;

    // Shift on its own is the "jump to a module" key — any other key cancels the tap.
    if (e.key === "Shift") { if (!e.repeat) { shiftSolo = !(e.ctrlKey || e.metaKey || e.altKey); shiftAt = Date.now(); } return; }
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

    // Page keys first: during a blackjack hand S and D belong to the game.
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
  function addSkipLink() {
    var main = document.querySelector("main");
    if (!main || byId("t29SkipLink")) return;
    if (!main.id) main.id = "t29Main";
    main.setAttribute("tabindex", "-1");
    var a = document.createElement("a");
    a.id = "t29SkipLink";
    a.className = "t29-skip";
    a.href = "#" + main.id;
    a.textContent = "Skip to main content";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      main.focus({ preventScroll: true });
      if (typeof t29Jump === "function") t29Jump(main.id);
      else main.scrollIntoView();
    });
    document.body.insertBefore(a, document.body.firstChild);
  }

  function hintNavLinks() {
    if (!FINE_POINTER) return;
    var items = moduleItems();
    items.forEach(function (it) {
      if (it.here || it.link.title) return;
      it.link.title = it.label + " \u2014 tap Shift, then type \u201C" + shortestPrefix(it, items) + "\u201D";
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
    addSkipLink();
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
