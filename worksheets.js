/* ===================== The 29 World — Worksheets page (teacher only) =====================
   Pick a module, edit its worksheet straight on the page, print it. Content and layout
   defaults come from worksheets-data.js; this file is only the editor.

   Saving: private per-teacher records sync through worksheets-sync.js. Local
   drafts survive offline work; untouched built-ins still use worksheets-data.js.
========================================================================================= */
(function () {
  "use strict";

  const BLOCK_LABEL = { heading: "Heading", text: "Text", question: "Question", choice: "Multiple choice", table: "Table", pagebreak: "Page break" };
  const ADD_ORDER = ["heading", "text", "question", "choice", "table", "pagebreak"];
  const LETTERS = "ABCDEFGH";
  const FONT_LABEL = { sans: "Clean", serif: "Classic" };
  const SIZE_LABEL = { s: "Small", m: "Medium", l: "Large" };
  const PAPER_LABEL = { a3: "A3", a4: "A4", a5: "A5" };

  // Browsers that support it keep pasted/typed text plain; others get the same via handlers below.
  const CE = (() => {
    try { const d = document.createElement("div"); d.contentEditable = "plaintext-only"; return d.contentEditable === "plaintext-only" ? "plaintext-only" : "true"; }
    catch (_) { return "true"; }
  })();

  const S = {
    user: null, data: null, moduleKey: "", sheet: null,
    mode: "edit", showAnswers: false,
    storageOK: true, dirty: false, saveTimer: 0, status: "", statusWarn: false,
    undo: null, snackTimer: 0, defaultIds: new Set(), sync: null, syncInfo: null, heldId: null
  };

  const $ = id => document.getElementById(id);
  const e = s => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ---------------------------------- storage ---------------------------------- */
  function storageKey() { return "t29-worksheets-v1:" + ((S.user && S.user.username) || "teacher"); }

  function normalizeData(d) {
    const out = { v: 1, sheets: Object.create(null), hidden: [], prefs: { module: "", sheet: Object.create(null) } };
    const renamed = Object.create(null);
    if (d && d.sheets && typeof d.sheets === "object") {
      Object.keys(d.sheets).forEach(id => {
        const s = wsNormalizeSheet(d.sheets[id]);
        if (!wsModule(s.moduleKey)) return;
        s.id = /^[a-zA-Z0-9_-]{1,180}$/.test(id) ? id : "c-" + wsUid();
        renamed[id] = s.id;
        out.sheets[s.id] = s;
      });
    }
    if (d && Array.isArray(d.hidden)) out.hidden = d.hidden.filter(x => typeof x === "string");
    if (d && d.prefs && typeof d.prefs === "object") {
      out.prefs.module = typeof d.prefs.module === "string" ? d.prefs.module : "";
      if (d.prefs.sheet && typeof d.prefs.sheet === "object") {
        Object.entries(d.prefs.sheet).forEach(([key, id]) => { out.prefs.sheet[key] = renamed[id] || id; });
      }
    }
    return out;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) { const d = JSON.parse(raw); if (d && d.v === 1) return normalizeData(d); }
    } catch (_) { /* fall through to a fresh start */ }
    return normalizeData({});
  }

  function probeStorage() {
    try { const k = "t29-ws-probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; }
    catch (_) { return false; }
  }

  function saveNow() {
    clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    S.sync.setPrefs(S.data.prefs);
    S.sync.persist();
    S.sync.flush();
  }

  function saveSoon(silent) {
    if (!silent) { S.dirty = true; setStatus("Saving…"); }
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveNow, 450);
  }

  function setStatus(text, warn) {
    S.status = text; S.statusWarn = !!warn;
    const el = $("wsStatus");
    if (el) { el.textContent = text; el.classList.toggle("warn", !!warn); }
  }

  function syncChanged(data, info) {
    S.syncInfo = info;
    S.storageOK = info.localOK;
    S.dirty = info.pending > 0;
    const previous = JSON.stringify(S.sheet);
    const previousNavigation = navigationState();
    const oldId = S.sheet && S.sheet.id;
    const selected = info.redirect && info.redirect.from === oldId ? info.redirect.to : oldId;
    if (info.redirect && S.heldId === info.redirect.from) S.heldId = info.redirect.to;
    // Selection belongs to this device; a snapshot arriving during the
    // preference-save debounce must not put it back on the old module.
    data.prefs = S.data.prefs;
    S.data = data;
    const list = sheetsFor(S.moduleKey);
    S.sheet = list.find(sh => sh.id === selected) || list[0] || null;
    if (S.sheet) S.data.prefs.sheet[S.moduleKey] = S.sheet.id;
    // A save acknowledgement must not replace a button between pointer
    // down and click, or interrupt the editor's focus/caret.
    if (navigationState() !== previousNavigation) { renderRail(); renderModuleBar(); }
    if (JSON.stringify(S.sheet) !== previous) { renderToolbar(); renderPaper(); }
    let text = info.ready ? "Saved to your account" : "Connecting to your account…";
    let warn = false;
    if (info.pending) text = info.saving ? "Saving to your account…" : "Saved on this device · waiting to sync";
    if (!info.online) text = info.localOK ? "Offline · saved on this device" : info.pending ? "Offline · changes not saved" : "Offline · local saving unavailable";
    if (info.error) { text = info.localOK ? "Saved on this device · sync unavailable" : "Changes not saved"; warn = true; }
    if (!info.localOK && info.pending) { text = info.saving ? "Saving to your account…" : "Changes not saved · keep this page open"; warn = true; }
    setStatus(text, warn);
    const retry = document.querySelector('[data-act="sync-retry"]');
    if (retry) retry.classList.toggle("hidden", !info.error);
    const notice = $("wsNotice");
    notice.hidden = !info.error && info.localOK;
    notice.textContent = info.error
      ? (info.localOK ? "Account sync is unavailable. Changes are saved on this device. Use More to export a backup, or retry sync."
        : "Account sync and local saving are unavailable. Keep this page open and export a backup from More.")
      : !info.localOK ? "This browser is blocking local saving. Keep this page open until changes are saved to your account, or export a backup from More." : "";
    if (info.conflict) notify(info.redirect
      ? "Another device changed this worksheet. Both versions were kept; you're editing a separate copy."
      : "Another device changed this worksheet. Its latest version was kept; your removal or reset wasn't applied.");
  }

  function navigationState() {
    return JSON.stringify([S.moduleKey, S.sheet && S.sheet.id,
      wsModuleList().map(m => [m.key, sheetsFor(m.key).map(sh => [sh.id, sh.title]), hiddenCount(m.key)])]);
  }
  function editingField(el) { return el && el.closest && el.closest('#wsPaperHost, [data-set], [data-act="set"]'); }
  function releaseEditHold() {
    if (!editingField(document.activeElement) && S.heldId) {
      const id = S.heldId; S.heldId = null; S.sync.release(id);
    }
  }

  /* ---------------------------------- model ---------------------------------- */
  function sheetsFor(key) {
    const out = [];
    wsDefaultsFor(key).forEach(d => {
      if (S.data.hidden.includes(d.id)) return;
      out.push(S.data.sheets[d.id] || d);
    });
    Object.keys(S.data.sheets)
      .map(id => S.data.sheets[id])
      .filter(s => s.moduleKey === key && !S.defaultIds.has(s.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach(s => out.push(s));
    return out;
  }

  function hiddenCount(key) {
    return wsDefaultsFor(key).filter(d => S.data.hidden.includes(d.id)).length;
  }

  function cfg(sheet) {
    const c = Object.assign({}, WS_LAYOUT, (sheet && sheet.settings) || {});
    if (!PAPER_LABEL[c.paper]) c.paper = "a4";
    if (!FONT_LABEL[c.font]) c.font = "sans";
    if (!SIZE_LABEL[c.size]) c.size = "m";
    return c;
  }

  // The first edit to a built-in worksheet copies it into the teacher's saved edits.
  function touch() {
    if (!S.sheet) return;
    S.sheet.updatedAt = Date.now();
    S.data.sheets[S.sheet.id] = S.sheet;
    S.sync.put(S.sheet);
    saveSoon();
  }

  function isEdited(sheet) { return S.defaultIds.has(sheet.id) && !!S.data.sheets[sheet.id]; }

  function selectModule(key, silent) {
    const mod = wsModule(key);
    if (!mod || !mod.enabled) key = (wsModuleList()[0] || {}).key || "";
    S.moduleKey = key;
    S.undo = null;
    const list = sheetsFor(key);
    const want = S.data.prefs.sheet[key];
    S.sheet = list.find(s => s.id === want) || list[0] || null;
    S.data.prefs.module = key;
    if (S.sheet) S.data.prefs.sheet[key] = S.sheet.id;
    if (!silent) saveSoon(true);
  }

  function selectSheet(id) {
    const s = sheetsFor(S.moduleKey).find(x => x.id === id);
    if (!s) return;
    S.sheet = s;
    S.undo = null;
    S.data.prefs.sheet[S.moduleKey] = s.id;
    saveSoon(true);
  }

  function blockIndex(id) { return S.sheet ? S.sheet.blocks.findIndex(b => b.id === id) : -1; }
  function findBlock(id) { const i = blockIndex(id); return i < 0 ? null : S.sheet.blocks[i]; }
  function totalMarks(sheet) {
    return sheet.blocks.reduce((n, b) => n + ((b.type === "question" || b.type === "choice") ? (b.marks || 0) : 0), 0);
  }

  /* ---------------------------------- rendering ---------------------------------- */
  function render() {
    renderRail();
    renderModuleBar();
    renderToolbar();
    renderPaper();
  }

  function renderRail() {
    const mods = wsModuleList();
    const groups = Array.from(new Set(WS_GROUPS.concat(mods.map(m => m.group))));
    $("wsRail").innerHTML = groups.map(g => {
      const list = mods.filter(m => m.group === g);
      if (!list.length) return "";
      return `<div class="ws-rail-group"><p class="ws-rail-label">${e(g)}</p>` +
        list.map(m => `<button type="button" class="ws-mod${m.key === S.moduleKey ? " active" : ""}" style="--acc:${e(m.accent)}" data-act="mod" data-key="${e(m.key)}" aria-current="${m.key === S.moduleKey}">` +
          `<span class="ws-mod-name">${e(m.name)}</span><span class="ws-count">${sheetsFor(m.key).length}</span></button>`).join("") +
        `</div>`;
    }).join("");
  }

  function renderModuleBar() {
    const mod = wsModule(S.moduleKey);
    if (!mod) { $("wsModuleBar").innerHTML = ""; return; }
    const list = sheetsFor(mod.key);
    const hidden = hiddenCount(mod.key);
    $("wsModuleBar").style.setProperty("--acc", mod.accent);
    $("wsModuleBar").innerHTML =
      `<div class="ws-modhead"><h2>${e(mod.name)}</h2>${mod.blurb ? `<p>${e(mod.blurb)}</p>` : ""}</div>` +
      `<div class="ws-tabs" role="tablist" aria-label="${e(mod.name)} worksheets">` +
      list.map(s => { const on = !!(S.sheet && s.id === S.sheet.id), nm = e(s.title || "Untitled worksheet"); return `<span class="ws-tabbox${on ? " active" : ""}" role="presentation"><button type="button" role="tab" class="ws-tab${on ? " active" : ""}" aria-selected="${on}" data-act="sheet" data-id="${e(s.id)}"><span class="ws-tab-t">${nm}</span></button><button type="button" class="ws-tab-x" data-act="del-tab" data-id="${e(s.id)}" aria-label="${S.defaultIds.has(s.id) ? "Remove" : "Delete"} ${nm}" title="${S.defaultIds.has(s.id) ? "Remove" : "Delete"} worksheet">&times;</button></span>`; }).join("") +
      `<button type="button" class="ws-tab ws-tab-new" data-act="new-sheet">New worksheet</button></div>` +
      (hidden ? `<p class="ws-restore">${hidden} built-in worksheet${hidden === 1 ? " is" : "s are"} removed. <button type="button" data-act="restore">Restore ${hidden === 1 ? "it" : "them"}</button></p>` : "");
  }

  function segHTML(key, labels, current) {
    return `<div class="ws-seg sm" role="group">` + Object.keys(labels).map(v =>
      `<button type="button" class="${v === current ? "on" : ""}" data-act="set" data-k="${key}" data-v="${v}" aria-pressed="${v === current}">${labels[v]}</button>`).join("") + `</div>`;
  }

  // Pinned = the toolbar sticks under the top bar while scrolling. The choice is remembered per device.
  const PIN_KEY = "t29-ws-pinned";
  function readPin() { try { return localStorage.getItem(PIN_KEY) !== "0"; } catch (_) { return true; } }
  function togglePin() {
    S.pinned = !S.pinned;
    try { localStorage.setItem(PIN_KEY, S.pinned ? "1" : "0"); } catch (_) {}
    renderToolbar();
  }

  function renderToolbar() {
    const host = $("wsToolbar");
    if (!S.sheet) { host.innerHTML = ""; host.classList.add("hidden"); return; }
    host.classList.remove("hidden");
    if (S.pinned === undefined) S.pinned = readPin();
    host.classList.toggle("unpinned", !S.pinned);
    const st = cfg(S.sheet);
    const origin = S.defaultIds.has(S.sheet.id) ? (isEdited(S.sheet) ? "Built-in · edited" : "Built-in") : "Custom";
    const canReset = S.defaultIds.has(S.sheet.id) && isEdited(S.sheet);
    host.innerHTML =
      `<div class="ws-tb-left">` +
        `<div class="ws-mode" role="group" aria-label="View">` +
          `<button type="button" class="${S.mode === "edit" ? "on" : ""}" data-act="mode" data-mode="edit" aria-pressed="${S.mode === "edit"}">Edit</button>` +
          `<button type="button" class="${S.mode === "preview" ? "on" : ""}" data-act="mode" data-mode="preview" aria-pressed="${S.mode === "preview"}">Preview</button>` +
        `</div>` +
        (S.mode === "preview" ? `<label class="ws-check"><span class="lg-switch"><input type="checkbox" data-act="toggle-ans" ${S.showAnswers ? "checked" : ""}><span class="lg-switch-track"><span class="lg-switch-thumb"></span></span></span><span>Show answers</span></label>` : "") +
        `<span class="ws-pill">${origin}</span>` +
        `<span class="ws-status${S.statusWarn ? " warn" : ""}" id="wsStatus" role="status" aria-live="polite">${e(S.status)}</span>` +
        `<button type="button" class="ws-pin${S.pinned ? " on" : ""}" data-act="pin" aria-pressed="${S.pinned}" aria-label="Pin toolbar to the top" title="${S.pinned ? "Unpin: let the toolbar scroll away" : "Pin the toolbar to the top"}">${typeof icon === "function" ? icon("pin", 16) : ""}</button>` +
      `</div>` +
      `<div class="ws-tb-right">` +
        `<button type="button" class="btn small secondary${S.syncInfo?.error ? "" : " hidden"}" data-act="sync-retry">Retry sync</button>` +
        `<button type="button" class="btn small secondary" data-act="pop" data-pop="layout" aria-expanded="${S.pop === "layout"}" aria-controls="wsPanel">Layout</button>` +
        `<button type="button" class="btn small secondary" data-act="pop" data-pop="more" aria-expanded="${S.pop === "more"}" aria-controls="wsPanel">More</button>` +
        `<button type="button" class="btn small secondary" data-act="print-key">Print answer key</button>` +
        `<button type="button" class="btn small gold" data-act="print">Print worksheet</button>` +
      `</div>` +
      `<div class="ws-panel" id="wsPanel"${S.pop ? "" : " hidden"}>` +
        `<div class="ws-panel-body" data-panel="layout" role="group" aria-label="Layout options"${S.pop === "layout" ? "" : " hidden"}>` +
          `<div class="ws-pop-col">` +
            `<label class="ws-switch"><input type="checkbox" data-set="nameLine" ${st.nameLine ? "checked" : ""}><span class="ws-track"></span><span>Name, class and date line</span></label>` +
            `<label class="ws-switch"><input type="checkbox" data-set="marks" ${st.marks ? "checked" : ""}><span class="ws-track"></span><span>Show marks</span></label>` +
          `</div>` +
            `<div class="ws-pop-row"><span class="ws-pop-lbl">Font</span>${segHTML("font", FONT_LABEL, st.font)}</div>` +
            `<div class="ws-pop-row"><span class="ws-pop-lbl">Text size</span>${segHTML("size", SIZE_LABEL, st.size)}</div>` +
            `<div class="ws-pop-row"><span class="ws-pop-lbl">Paper</span>${segHTML("paper", PAPER_LABEL, st.paper)}<span class="ws-pop-note" id="wsA5Note" ${st.paper === "a5" ? "" : "hidden"}>Prints two copies side by side on landscape A4. Cut the sheet in half.</span></div>` +
            `<div class="ws-pop-row grow"><label class="ws-pop-lbl" for="wsFooterIn">Footer text</label><input id="wsFooterIn" class="ws-input" type="text" maxlength="160" data-set="footer" value="${e(st.footer)}" placeholder="Leave blank for no footer"></div>` +
        `</div>` +
        `<div class="ws-panel-body ws-menu" data-panel="more" role="menu"${S.pop === "more" ? "" : " hidden"}>` +
            `<button type="button" role="menuitem" data-act="dup-sheet">Duplicate worksheet</button>` +
            `<button type="button" role="menuitem" data-act="reset-sheet" ${canReset ? "" : "disabled"}>Reset to built-in version</button>` +
            `<button type="button" role="menuitem" class="danger" data-act="del-sheet">${S.defaultIds.has(S.sheet.id) ? "Remove worksheet" : "Delete worksheet"}</button>` +
            `<span class="ws-vr" aria-hidden="true"></span>` +
            `<button type="button" role="menuitem" data-act="export">Export backup</button>` +
            `<button type="button" role="menuitem" data-act="import">Import backup…</button>` +
        `</div>` +
      `</div>`;
  }

  /* An editable text run. Plain text only; blank fields show a ghost prompt. */
  function ed(tag, cls, bid, field, value, ph, multi) {
    if (S.mode !== "edit") return `<${tag} class="${cls}">${e(value)}</${tag}>`;
    return `<${tag} class="${cls} ws-ed" contenteditable="${CE}" spellcheck="true" data-bid="${e(bid)}" data-f="${e(field)}" data-ph="${e(ph)}"${multi ? ' data-multi="1"' : ""}>${e(value)}</${tag}>`;
  }

  function marksLabel(n) { return n > 0 ? `${n} mark${n === 1 ? "" : "s"}` : ""; }

  function ctrlHTML(b, i, n) {
    return `<div class="ws-ctrl ws-edit-only"><span class="ws-ctrl-type">${BLOCK_LABEL[b.type]}</span>` +
      `<button type="button" data-act="up" data-bid="${b.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up" title="Move up">↑</button>` +
      `<button type="button" data-act="down" data-bid="${b.id}" ${i === n - 1 ? "disabled" : ""} aria-label="Move down" title="Move down">↓</button>` +
      `<button type="button" data-act="dup" data-bid="${b.id}" title="Duplicate this block">Copy</button>` +
      `<button type="button" class="danger" data-act="del" data-bid="${b.id}" title="Remove this block">Remove</button></div>`;
  }

  function addBarHTML(afterId, forceOpen) {
    return `<div class="ws-add ws-edit-only${forceOpen ? " open" : ""}" data-after="${e(afterId)}">` +
      `<button type="button" class="ws-add-btn" data-act="add-toggle" aria-expanded="${!!forceOpen}"><span>Add block here</span></button>` +
      `<div class="ws-add-menu">` + ADD_ORDER.map(t => `<button type="button" data-act="add" data-type="${t}" data-after="${e(afterId)}">${BLOCK_LABEL[t]}</button>`).join("") + `</div></div>`;
  }

  function marksInput(b, st) {
    if (!st.marks || S.mode !== "edit") return "";
    return `<label class="ws-mk">Marks <input type="number" class="ws-num" min="0" max="99" inputmode="numeric" data-bid="${b.id}" data-f="marks" value="${b.marks || ""}" placeholder="0"></label>`;
  }

  function blockHTML(b, i, n, st, num) {
    const edit = S.mode === "edit";
    let inner = "";
    switch (b.type) {
      case "heading":
        inner = ed("h3", "ws-h", b.id, "text", b.text, "Section heading", false);
        break;
      case "text":
        inner = ed("p", "ws-p", b.id, "text", b.text, "Write instructions or an explanation…", true);
        break;
      case "question": {
        const lines = Array.from({ length: b.lines }, () => '<div class="ws-line"></div>').join("");
        inner =
          `<div class="ws-qrow"><span class="ws-qn">${num}.</span><div class="ws-qbody">${ed("div", "ws-qt", b.id, "text", b.text, "Type your question…", true)}${lines ? `<div class="ws-lines">${lines}</div>` : ""}</div>` +
          `<span class="ws-marks">${st.marks ? marksLabel(b.marks) : ""}</span></div>` +
          (edit ? `<div class="ws-meta ws-edit-only"><span class="ws-step">Answer lines <button type="button" data-act="lines-" data-bid="${b.id}" ${b.lines <= 0 ? "disabled" : ""} aria-label="Fewer lines">−</button><b>${b.lines}</b><button type="button" data-act="lines+" data-bid="${b.id}" ${b.lines >= 12 ? "disabled" : ""} aria-label="More lines">+</button></span>${marksInput(b, st)}</div>` : "") +
          `<div class="ws-answer${b.answer ? "" : " is-empty"}"><span class="ws-answer-lbl">Answer key</span>${ed("div", "ws-answer-t", b.id, "answer", b.answer, "Teacher answer (never printed on the student copy)", true)}</div>`;
        break;
      }
      case "choice": {
        const opts = b.options.map((o, k) =>
          `<li class="ws-opt${b.correct === k ? " is-correct" : ""}">` +
          (edit ? `<button type="button" class="ws-letter" data-act="correct" data-bid="${b.id}" data-i="${k}" aria-pressed="${b.correct === k}" title="Mark as the correct answer">${LETTERS[k]}</button>` : `<span class="ws-letter">${LETTERS[k]}</span>`) +
          ed("span", "ws-ot", b.id, "opt:" + k, o, "Option text", false) +
          (edit && b.options.length > 2 ? `<button type="button" class="ws-x ws-edit-only" data-act="opt-del" data-bid="${b.id}" data-i="${k}" aria-label="Remove option ${LETTERS[k]}" title="Remove option">×</button>` : "") +
          `</li>`).join("");
        inner =
          `<div class="ws-qrow"><span class="ws-qn">${num}.</span><div class="ws-qbody">${ed("div", "ws-qt", b.id, "text", b.text, "Type your question…", true)}<ol class="ws-opts">${opts}</ol></div>` +
          `<span class="ws-marks">${st.marks ? marksLabel(b.marks) : ""}</span></div>` +
          (edit ? `<div class="ws-meta ws-edit-only"><span class="ws-hint">Click a letter to mark the correct answer</span><button type="button" class="ws-mini" data-act="opt-add" data-bid="${b.id}" ${b.options.length >= 8 ? "disabled" : ""}>Add option</button>${marksInput(b, st)}</div>` : "");
        break;
      }
      case "table": {
        const head = b.cols.map((c, k) => `<th>${ed("div", "ws-cell", b.id, "col:" + k, c, "Heading", false)}</th>`).join("");
        const body = b.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td>${ed("div", "ws-cell", b.id, "cell:" + ri + ":" + ci, c, "", false)}</td>`).join("")}</tr>`).join("");
        inner =
          `<div class="ws-tbl-wrap"><table class="ws-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
          (edit ? `<div class="ws-meta ws-edit-only">` +
            `<button type="button" class="ws-mini" data-act="row+" data-bid="${b.id}" ${b.rows.length >= 20 ? "disabled" : ""}>Add row</button>` +
            `<button type="button" class="ws-mini" data-act="row-" data-bid="${b.id}" ${b.rows.length <= 1 ? "disabled" : ""}>Remove row</button>` +
            `<button type="button" class="ws-mini" data-act="col+" data-bid="${b.id}" ${b.cols.length >= 6 ? "disabled" : ""}>Add column</button>` +
            `<button type="button" class="ws-mini" data-act="col-" data-bid="${b.id}" ${b.cols.length <= 1 ? "disabled" : ""}>Remove column</button></div>` : "");
        break;
      }
      case "pagebreak":
        inner = `<div class="ws-pb"><span>Page break: printing continues on a new page</span></div>`;
        break;
    }
    return `<section class="ws-b ws-b-${b.type}" data-block="${b.id}">${edit ? ctrlHTML(b, i, n) : ""}${inner}</section>${edit ? addBarHTML(b.id, false) : ""}`;
  }

  function renderPaper(opts) {
    opts = opts || {};
    const host = $("wsPaperHost");
    const y = window.scrollY;
    const mod = wsModule(S.moduleKey);

    if (!mod || !S.sheet) {
      host.innerHTML =
        `<div class="ws-empty"><h3>No worksheets here yet</h3><p>Start a blank one, or bring back the built-in ones if you removed them.</p>` +
        `<div class="ws-empty-actions"><button type="button" class="btn small gold" data-act="new-sheet">New worksheet</button>` +
        (mod && hiddenCount(mod.key) ? `<button type="button" class="btn small secondary" data-act="restore">Restore built-in</button>` : "") + `</div></div>`;
      return;
    }

    const sh = S.sheet, st = cfg(sh), edit = S.mode === "edit";
    const total = totalMarks(sh);
    let num = 0;
    const blocks = sh.blocks.map((b, i) => {
      if (b.type === "question" || b.type === "choice") num++;
      return blockHTML(b, i, sh.blocks.length, st, num);
    }).join("");

    const nameLine = st.nameLine
      ? `<div class="ws-name">${(Array.isArray(st.nameFields) ? st.nameFields : WS_LAYOUT.nameFields).map(l => `<div class="ws-name-f"><span>${e(l)}</span><i></i></div>`).join("")}</div>` : "";

    host.innerHTML =
      `<article class="ws-paper ${edit ? "is-edit" : "is-preview"}${S.showAnswers ? " show-ans" : ""} fs-${st.size} ff-${st.font} pp-${st.paper}" style="--acc:${e(mod.accent)}">` +
        `<header class="ws-ph"><div class="ws-ph-top"><span class="ws-ph-total" ${st.marks && total ? "" : "hidden"}>${total ? "Total: " + marksLabel(total) : ""}</span></div>` +
          ed("h1", "ws-title", "", "title", sh.title, "Worksheet title", false) +
          ed("p", "ws-sub", "", "subtitle", sh.subtitle, "Instructions for students (optional)", true) +
          nameLine +
        `</header>` +
        (edit ? addBarHTML("__top__", !sh.blocks.length) : "") +
        blocks +
        ((edit || st.footer) ? `<footer class="ws-pf">${ed("div", "ws-pf-t", "", "footer", st.footer, "Footer text (optional)", false)}</footer>` : "") +
      `</article>`;

    // A5 prints two copies side by side on a landscape A4 sheet (cut it in half); A3 and A4 print one page per sheet.
    $("wsPageStyle").textContent = st.paper === "a5" ? "@page{size:A4 landscape;margin:12mm 0}" : `@page{size:${st.paper === "a3" ? "A3" : "A4"};margin:14mm}`;
    window.scrollTo(0, y);

    if (opts.focus) {
      const blk = host.querySelector(`[data-block="${opts.focus}"]`);
      const field = blk && blk.querySelector("[contenteditable][data-f]");
      if (field) { field.focus({ preventScroll: true }); placeCaretEnd(field); }
      if (blk) blk.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (opts.flash) {
      const blk = host.querySelector(`[data-block="${opts.flash}"]`);
      if (blk) { blk.classList.add("ws-flash"); blk.scrollIntoView({ block: "nearest", behavior: "smooth" }); setTimeout(() => blk.classList.remove("ws-flash"), 900); }
    }
    if (opts.refocus) {
      const el = host.querySelector(opts.refocus);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
    if (opts.focusTitle) {
      const t = host.querySelector('[data-f="title"]');
      if (t) { t.focus(); placeCaretEnd(t); }
    }
  }

  /* ---------------------------------- text helpers ---------------------------------- */
  function placeCaretEnd(el) {
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (_) { /* caret placement is a nicety */ }
  }

  function readText(el) {
    let t = (el.innerText || "").replace(/\r/g, "").replace(/\u00a0/g, " ");
    t = t.replace(/\n$/, "");
    if (!el.hasAttribute("data-multi")) t = t.replace(/\s*\n+\s*/g, " ");
    return t.trim() === "" ? "" : t;
  }

  function writeField(bid, f, v) {
    const sh = S.sheet;
    if (!bid) {
      if (f === "footer") sh.settings.footer = v;
      else if (f === "title" || f === "subtitle") sh[f] = v;
      return;
    }
    const b = findBlock(bid);
    if (!b) return;
    if (f.indexOf("opt:") === 0) b.options[+f.slice(4)] = v;
    else if (f.indexOf("col:") === 0) b.cols[+f.slice(4)] = v;
    else if (f.indexOf("cell:") === 0) { const p = f.split(":"); b.rows[+p[1]][+p[2]] = v; }
    else if (f === "text" || f === "answer") b[f] = v;
  }

  function updateMarksUI() {
    const paper = document.querySelector(".ws-paper");
    if (!paper || !S.sheet) return;
    const st = cfg(S.sheet), total = totalMarks(S.sheet);
    const t = paper.querySelector(".ws-ph-total");
    if (t) { t.textContent = total ? "Total: " + marksLabel(total) : ""; t.hidden = !(st.marks && total); }
    S.sheet.blocks.forEach(b => {
      if (b.type !== "question" && b.type !== "choice") return;
      const m = paper.querySelector(`[data-block="${b.id}"] .ws-marks`);
      if (m) m.textContent = st.marks ? marksLabel(b.marks) : "";
    });
  }

  /* ---------------------------------- actions ---------------------------------- */
  function insertBlock(type, afterId) {
    const nb = wsNewBlock(type);
    if (!nb) return;
    const at = afterId === "__top__" ? 0 : blockIndex(afterId) + 1;
    S.sheet.blocks.splice(at < 0 ? S.sheet.blocks.length : at, 0, nb);
    touch();
    renderPaper({ focus: type === "pagebreak" ? "" : nb.id, flash: type === "pagebreak" ? nb.id : "" });
  }

  function moveBlock(id, d) {
    const i = blockIndex(id), j = i + d, a = S.sheet.blocks;
    if (i < 0 || j < 0 || j >= a.length) return;
    const t = a[i]; a[i] = a[j]; a[j] = t;
    touch();
    renderPaper({ flash: id, refocus: `[data-act="${d < 0 ? "up" : "down"}"][data-bid="${id}"]` });
  }

  function dupBlock(id) {
    const i = blockIndex(id); if (i < 0) return;
    const copy = JSON.parse(JSON.stringify(S.sheet.blocks[i]));
    copy.id = wsUid();
    S.sheet.blocks.splice(i + 1, 0, copy);
    touch();
    renderPaper({ flash: copy.id });
  }

  function delBlock(id) {
    const i = blockIndex(id); if (i < 0) return;
    const b = S.sheet.blocks.splice(i, 1)[0];
    S.undo = { sheetId: S.sheet.id, block: b, index: i };
    touch();
    renderPaper();
    snack(BLOCK_LABEL[b.type] + " removed");
  }

  function undoDelete() {
    const u = S.undo;
    hideSnack();
    if (!u || !S.sheet || S.sheet.id !== u.sheetId) return;
    S.sheet.blocks.splice(Math.min(u.index, S.sheet.blocks.length), 0, u.block);
    S.undo = null;
    touch();
    renderPaper({ flash: u.block.id });
  }

  function snack(msg) {
    const el = $("wsSnack");
    el.innerHTML = `<span>${e(msg)}</span><button type="button" data-act="undo">Undo</button>`;
    el.classList.add("show");
    clearTimeout(S.snackTimer);
    S.snackTimer = setTimeout(hideSnack, 7000);
  }
  function hideSnack() { clearTimeout(S.snackTimer); $("wsSnack").classList.remove("show"); }

  function blockEdit(id, act) {
    const b = findBlock(id); if (!b) return;
    const refocus = `[data-act="${act}"][data-bid="${id}"]`;
    if (act === "lines+") b.lines = Math.min(12, b.lines + 1);
    else if (act === "lines-") b.lines = Math.max(0, b.lines - 1);
    else if (act === "opt-add" && b.options.length < 8) b.options.push("");
    else if (act === "row+" && b.rows.length < 20) b.rows.push(b.cols.map(() => ""));
    else if (act === "row-" && b.rows.length > 1) b.rows.pop();
    else if (act === "col+" && b.cols.length < 6) { b.cols.push(""); b.rows.forEach(r => r.push("")); }
    else if (act === "col-" && b.cols.length > 1) { b.cols.pop(); b.rows.forEach(r => r.pop()); }
    else return;
    touch();
    renderPaper({ refocus });
  }

  function setCorrect(id, i) {
    const b = findBlock(id); if (!b) return;
    b.correct = b.correct === i ? -1 : i;
    touch();
    renderPaper({ refocus: `[data-act="correct"][data-bid="${id}"][data-i="${i}"]` });
  }

  function delOption(id, i) {
    const b = findBlock(id); if (!b || b.options.length <= 2) return;
    b.options.splice(i, 1);
    if (b.correct === i) b.correct = -1; else if (b.correct > i) b.correct--;
    touch();
    renderPaper();
  }

  async function ask(msg, okText) {
    if (typeof t29Confirm === "function") return !!(await t29Confirm(msg, { confirmText: okText, danger: true }));
    return window.confirm(msg);
  }

  function newSheet() {
    const sh = wsNewSheet(S.moduleKey);
    S.data.sheets[sh.id] = sh;
    S.sheet = sh; S.mode = "edit"; S.undo = null;
    S.data.prefs.sheet[S.moduleKey] = sh.id;
    S.sync.put(sh);
    saveSoon();
    render();
    renderPaper({ focusTitle: true });
  }

  function dupSheet() {
    const copy = wsNormalizeSheet(JSON.parse(JSON.stringify(S.sheet)), S.moduleKey);
    copy.id = "c-" + wsUid();
    copy.title = (S.sheet.title || "Untitled worksheet") + " (copy)";
    copy.createdAt = copy.updatedAt = Date.now();
    copy.blocks.forEach(b => { b.id = wsUid(); });
    S.data.sheets[copy.id] = copy;
    S.sheet = copy; S.undo = null;
    S.data.prefs.sheet[S.moduleKey] = copy.id;
    S.sync.put(copy);
    saveSoon();
    render();
    t29ToastSafe("Duplicated. You're now editing the copy.");
  }

  async function resetSheet() {
    if (!S.sheet || !S.defaultIds.has(S.sheet.id) || !isEdited(S.sheet)) return;
    const id = S.sheet.id, moduleKey = S.moduleKey;
    if (!await ask("Reset this worksheet to the built-in version? Your changes to it will be lost.", "Reset")) return;
    delete S.data.sheets[id];
    S.sync.mark(id, "default");
    selectModule(moduleKey);
    saveSoon();
    render();
  }

  async function deleteSheet(id) {
    id = id || (S.sheet && S.sheet.id);
    if (!id) return;
    const moduleKey = S.moduleKey, isActive = !!S.sheet && S.sheet.id === id;
    const builtIn = S.defaultIds.has(id);
    if (!await ask(builtIn ? "Remove this built-in worksheet? You can restore it later from this module." : "Delete this worksheet? This can't be undone.", builtIn ? "Remove" : "Delete")) return;
    if (builtIn && !S.data.hidden.includes(id)) S.data.hidden.push(id);
    delete S.data.sheets[id];
    S.sync.mark(id, builtIn ? "hidden" : "deleted");
    if (isActive) { delete S.data.prefs.sheet[moduleKey]; selectModule(moduleKey); }
    saveSoon();
    render();
  }

  function restoreBuiltIns() {
    const ids = wsDefaultsFor(S.moduleKey).map(d => d.id);
    S.data.hidden = S.data.hidden.filter(id => !ids.includes(id));
    ids.forEach(id => { if (!S.data.sheets[id]) S.sync.mark(id, "default"); });
    selectModule(S.moduleKey);
    saveSoon();
    render();
  }

  function exportBackup() {
    saveNow();
    const blob = new Blob([JSON.stringify({ app: "t29-worksheets", exportedAt: new Date().toISOString(), data: S.data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "worksheets-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (_) { parsed = null; }
      if (!parsed || parsed.app !== "t29-worksheets" || !parsed.data) { notify("That file isn't a worksheets backup.", true); return; }
      if (!S.sync.status().loaded || navigator.onLine === false || S.sync.status().error) {
        notify("Connect to your account before importing a backup, so your whole worksheet library can be replaced safely.", true); return;
      }
      if (!await ask("Import this backup? It replaces the worksheets in your account and syncs those changes to your other devices.", "Import")) return;
      S.data = normalizeData(parsed.data);
      S.sync.replace(S.data);
      selectModule(S.data.prefs.module || S.moduleKey, true);
      saveNow();
      render();
      notify("Backup imported.");
    };
    reader.readAsText(file);
  }

  function notify(msg, isErr) {
    if (typeof t29Toast === "function") t29Toast(msg, isErr ? { type: "error" } : {});
    else if (isErr) window.alert(msg);
  }
  function t29ToastSafe(msg) { notify(msg); }

  function doPrint(withKey) {
    const active = document.activeElement;
    if (active && active.blur) active.blur();
    saveNow();
    const paper = document.querySelector(".ws-paper");
    if (!paper) return;
    const mod = wsModule(S.moduleKey);
    const oldTitle = document.title;
    paper.classList.toggle("print-key", !!withKey);
    // A5: lay the page out in the left half of a landscape A4 sheet; the student copy is doubled into the right half too.
    const host = $("wsPaperHost"), a5 = paper.classList.contains("pp-a5");
    let copy = null;
    if (a5) {
      host.classList.add("ws-a5");
      if (!withKey) { copy = paper.cloneNode(true); copy.setAttribute("aria-hidden", "true"); copy.setAttribute("inert", ""); host.appendChild(copy); host.classList.add("ws-2up"); }
    }
    document.title = (mod ? mod.name + " – " : "") + (S.sheet.title || "Worksheet") + (withKey ? " (answer key)" : "");
    let done = false;
    const cleanup = () => {
      if (done) return; done = true;
      paper.classList.remove("print-key");
      host.classList.remove("ws-a5", "ws-2up");
      if (copy) copy.remove();
      document.title = oldTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(cleanup, 60000);   // browsers that never fire afterprint
    window.print();
  }

  // The Layout / More panel docks inside the toolbar (it pushes the worksheet down rather than floating over it).
  function syncPanel() {
    const p = $("wsPanel"); if (!p) return;
    p.hidden = !S.pop;
    p.querySelectorAll("[data-panel]").forEach(el => { el.hidden = el.dataset.panel !== S.pop; });
    document.querySelectorAll("#wsToolbar [data-act='pop']").forEach(b => b.setAttribute("aria-expanded", String(b.dataset.pop === S.pop)));
  }
  // menuOnly: an outside click closes the More menu but leaves Layout open so changes can be watched live.
  function closePops(menuOnly) {
    if (!S.pop || (menuOnly && S.pop !== "more")) return;
    S.pop = null; syncPanel();
  }
  function closeAddMenus(except) {
    document.querySelectorAll(".ws-add.open").forEach(a => { if (a !== except) { a.classList.remove("open"); const b = a.querySelector(".ws-add-btn"); if (b) b.setAttribute("aria-expanded", "false"); } });
  }

  /* ---------------------------------- events ---------------------------------- */
  function onClick(ev) {
    const t = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!ev.target.closest("#wsPanel, [data-act='pop']")) closePops(true);
    if (!ev.target.closest(".ws-add")) closeAddMenus();
    if (!t) return;
    const act = t.dataset.act, bid = t.dataset.bid;

    switch (act) {
      case "mod": selectModule(t.dataset.key); render(); window.scrollTo({ top: 0 }); break;
      case "sheet": selectSheet(t.dataset.id); render(); break;
      case "new-sheet": newSheet(); break;
      case "restore": restoreBuiltIns(); break;
      case "mode": S.mode = t.dataset.mode; renderToolbar(); renderPaper(); break;
      case "toggle-ans": S.showAnswers = t.checked; { const p = document.querySelector(".ws-paper"); if (p) p.classList.toggle("show-ans", S.showAnswers); } break;
      case "pin": togglePin(); break;
      case "print": doPrint(false); break;
      case "print-key": doPrint(true); break;
      case "pop": {
        S.pop = S.pop === t.dataset.pop ? null : t.dataset.pop; syncPanel();
        break;
      }
      case "set": {
        S.sheet.settings[t.dataset.k] = t.dataset.v;
        t.parentElement.querySelectorAll("button").forEach(b => { const on = b === t; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
        if (t.dataset.k === "paper") { const n = $("wsA5Note"); if (n) n.hidden = t.dataset.v !== "a5"; }
        touch(); renderPaper();
        break;
      }
      case "dup-sheet": closePops(); dupSheet(); break;
      case "reset-sheet": closePops(); resetSheet(); break;
      case "del-sheet": closePops(); deleteSheet(); break;
      case "del-tab": deleteSheet(t.dataset.id); break;
      case "export": closePops(); exportBackup(); break;
      case "import": closePops(); $("wsImportFile").click(); break;
      case "sync-retry": S.sync.retry(); break;
      case "up": moveBlock(bid, -1); break;
      case "down": moveBlock(bid, 1); break;
      case "dup": dupBlock(bid); break;
      case "del": delBlock(bid); break;
      case "undo": undoDelete(); break;
      case "add-toggle": {
        const bar = t.closest(".ws-add"), open = !bar.classList.contains("open");
        closeAddMenus(bar); bar.classList.toggle("open", open); t.setAttribute("aria-expanded", String(open));
        break;
      }
      case "add": insertBlock(t.dataset.type, t.dataset.after); break;
      case "correct": setCorrect(bid, +t.dataset.i); break;
      case "opt-del": delOption(bid, +t.dataset.i); break;
      case "lines+": case "lines-": case "opt-add": case "row+": case "row-": case "col+": case "col-": blockEdit(bid, act); break;
    }
    releaseEditHold();
  }

  function onInput(ev) {
    const el = ev.target;
    if (el.matches && el.matches('input[type="text"][data-set="footer"]')) {   // footer box in the Layout panel
      if (!S.sheet) return;
      S.sheet.settings.footer = el.value;
      const f = document.querySelector('.ws-paper [data-f="footer"]');
      if (f) f.textContent = el.value;
      touch();
      return;
    }
    if (!el.closest) return;
    const f = el.closest("[data-f]");
    if (!f || !S.sheet || !f.closest("#wsPaperHost")) return;
    if (f.tagName === "INPUT") {                              // marks
      const b = findBlock(f.dataset.bid); if (!b) return;
      b.marks = wsClamp(f.value, 0, 99, 0);
      touch(); updateMarksUI();
      return;
    }
    if (f.textContent === "" && f.firstChild) f.innerHTML = "";   // lets the ghost prompt come back
    writeField(f.dataset.bid, f.dataset.f, readText(f));
    if (f.dataset.f === "title" && !f.dataset.bid) {
      const tab = document.querySelector(".ws-tab.active .ws-tab-t");
      if (tab) tab.textContent = S.sheet.title || "Untitled worksheet";
    }
    touch();
  }

  function onChange(ev) {
    const el = ev.target;
    if (el.matches && el.matches('input[type="checkbox"][data-set]') && S.sheet) {
      S.sheet.settings[el.dataset.set] = el.checked;
      touch(); renderPaper();
    } else if (el.id === "wsImportFile" && el.files && el.files[0]) {
      importBackup(el.files[0]); el.value = "";
    }
  }

  function onKeydown(ev) {
    if (ev.key === "Escape") { closePops(); closeAddMenus(); return; }
    const el = ev.target.closest ? ev.target.closest("[contenteditable][data-f]") : null;
    if (!el || ev.key !== "Enter" || ev.isComposing) return;
    if (!el.hasAttribute("data-multi")) {                     // single-line fields: Enter = next field
      ev.preventDefault();
      const all = Array.from(document.querySelectorAll("#wsPaperHost [contenteditable][data-f]"));
      const next = all[all.indexOf(el) + 1];
      if (next) { next.focus(); placeCaretEnd(next); }
    } else if (CE !== "plaintext-only") {
      ev.preventDefault();
      document.execCommand("insertText", false, "\n");
    }
  }

  function onPaste(ev) {
    const el = ev.target.closest ? ev.target.closest("[contenteditable][data-f]") : null;
    if (!el) return;
    ev.preventDefault();
    let t = ((ev.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r/g, "");
    if (!el.hasAttribute("data-multi")) t = t.replace(/\s*\n+\s*/g, " ");
    if (!document.execCommand("insertText", false, t)) {
      const sel = window.getSelection();
      if (sel.rangeCount) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false); }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function init() {
    const u = await requireLogin({ skipActivity: true });
    if (!u) return;
    if (u.role !== "teacher") { window.location.href = "student.html"; return; }
    S.user = u;
    $("whoami").textContent = t29DisplayName(u);
    $("navHome").href = u.classCode ? "teacher.html" : "teacher-home.html";
    paintIconSlots();

    wsModuleList().forEach(m => wsDefaultsFor(m.key).forEach(d => S.defaultIds.add(d.id)));
    WS_MODULES.forEach(m => { if (!m.enabled) wsDefaultsFor(m.key).forEach(d => S.defaultIds.add(d.id)); });
    S.storageOK = probeStorage();
    S.data = loadData();
    S.sync = T29WorksheetSync.create({ db: fdb, username: u.username,
      storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: key => localStorage.removeItem(key), key: i => localStorage.key(i), get length() { return localStorage.length; } },
      key: "t29-worksheets-sync-v1:" + u.username + ":" + u.authUid,
      legacy: S.data, defaultIds: S.defaultIds,
      normalizeSheet: raw => { const sh = wsNormalizeSheet(raw); return wsModule(sh.moduleKey) ? sh : null; },
      serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(), onChange: syncChanged });
    S.data = S.sync.view();

    // Sticky bits sit just under the top bar, whatever height it ends up at (it wraps on mid-width screens).
    // With the sidebar on a computer screen the "bar" is a fixed full-height column down the left, so there's nothing to clear.
    const bar = document.querySelector(".topbar");
    const syncTop = () => {
      // Centre of the worksheet area (the side menu shifts it off the screen centre) for the toast; 
      const appEl = $("wsApp");
      if (appEl) { const r = appEl.getBoundingClientRect(); document.documentElement.style.setProperty("--ws-cx", Math.round(r.left + r.width / 2) + "px"); }
      if (!bar) return;
      const isRail = getComputedStyle(bar).position === "fixed" && bar.getBoundingClientRect().width < window.innerWidth * 0.6;
      const top = isRail ? 12 : Math.round(bar.getBoundingClientRect().height + 8);
      document.documentElement.style.setProperty("--ws-top", top + "px");
    };
    syncTop();
    if (bar && window.ResizeObserver) new ResizeObserver(syncTop).observe(bar);
    window.addEventListener("resize", syncTop);
    if (window.ResizeObserver && $("wsApp")) new ResizeObserver(syncTop).observe($("wsApp"));
    // Settings can flip the sidebar on/off without a resize.
    new MutationObserver(syncTop).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    selectModule(S.data.prefs.module, true);
    render();

    const app = $("wsApp");
    app.addEventListener("click", onClick);
    document.addEventListener("click", ev => { if (!app.contains(ev.target)) { closePops(true); closeAddMenus(); } });
    app.addEventListener("input", onInput);
    app.addEventListener("change", onChange);
    app.addEventListener("keydown", onKeydown);
    app.addEventListener("paste", onPaste);
    app.addEventListener("focusin", ev => {
      if (S.sheet && editingField(ev.target)) {
        if (S.heldId && S.heldId !== S.sheet.id) S.sync.release(S.heldId);
        S.heldId = S.sheet.id; S.sync.hold(S.heldId);
      }
    });
    app.addEventListener("focusout", ev => {
      // Let the delegated click act on its existing target before a
      // deferred remote edit can repaint navigation or the paper.
      if (ev.relatedTarget?.closest('[data-act]')) return;
      setTimeout(releaseEditHold, 0);
    });
    app.addEventListener("drop", ev => { if (ev.target.closest && ev.target.closest("[contenteditable]")) ev.preventDefault(); });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") { closePops(); closeAddMenus(); } });
    $("wsSnack").addEventListener("click", onClick);
    $("wsImportFile").addEventListener("change", onChange);
    window.addEventListener("pagehide", () => { saveNow(); S.sync.stop(); });
    window.addEventListener("pageshow", ev => { if (ev.persisted) S.sync.start(); });
    window.addEventListener("online", () => S.sync.retry());
    window.addEventListener("offline", () => S.sync.flush());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && S.dirty) saveNow(); });
    window.addEventListener("beforeprint", () => { if (S.dirty) saveNow(); });
    window.addEventListener("beforeunload", ev => {
      const status = S.sync.status();
      if (status.pending && !status.localOK) { ev.preventDefault(); ev.returnValue = ""; }
    });
    S.sync.start();
    t29PageReady();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
