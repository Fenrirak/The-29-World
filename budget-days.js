/* Personal day planner. The board is a projection of the bank schedule; only the budget is written. */
const budEl = id => document.getElementById(id);
const budClone = v => JSON.parse(JSON.stringify(v));
function budSetDaysOpen(open) {
  budEl("budDaysBody").hidden = !open;
  budEl("budDisclosure").setAttribute("aria-expanded", String(open));
}
function budToggleDays() {
  if (BUD_EDIT) return;
  const open = budEl("budDaysBody").hidden;
  budSetDaysOpen(open);
  try { localStorage.setItem("t29_bud_days_open", open ? "1" : "0"); } catch (_) {}
}
function budRenderEditArea(v) {
  const bar = budEl("budEditBar"), e = BUD_EDIT;
  budEl("budEditStart").hidden = !!e;
  budEl("budDisclosure").disabled = !!e;
  if (!e) {
    const has = !!BUD_ME?.budget?.edits;
    const text = v.editSource === "week" ? "Personal plan for this week." : v.editSource === "rule" ? "Your weekly plan repeats." : "Your automatic plan for this week.";
    bar.innerHTML = '<div class="days-read-note"><span>' + text + '</span>' +
      (has ? '<button class="days-link" onclick="budResetAsk(true)">Reset to automatic</button>' : '') + '</div>' +
      (BUD_RESET_OPEN ? '<div class="days-reset"><strong>Restore the automatic plan?</strong><p>Choose which weeks to reset.</p><button class="btn small" onclick="budReset(\'week\')">This week only</button> <button class="btn small" onclick="budReset(\'future\')">This and future weeks</button> <button class="days-link" onclick="budResetAsk(false)">Never mind</button></div>' : '') + BUD_FLASH;
    return;
  }
  bar.innerHTML = '<div class="days-tools"><div><div class="days-eyebrow">Weekly planner</div><h3>Arrange your days</h3><p>Drag the dotted handle to move a card. Select the card to edit its amount, category or position.</p></div>' +
    '<div class="days-session"><button class="btn small secondary" id="budCancel">Cancel edits</button><button class="btn small gold" id="budDone">Done editing</button></div>' +
    '<div class="days-save-row"><span id="budSaveStatus" class="days-save" role="status"></span><button class="days-link" id="budRetry" hidden>Retry</button>' +
    '<label class="days-scope">Apply to <select id="budScope"><option value="week">This week only</option><option value="future">This and future weeks</option></select></label></div></div>';
  budEl("budScope").value = e.scope;
  budEl("budScope").onchange = ev => { e.scope = ev.target.value; budChanged(); };
  budEl("budDone").onclick = () => budFinish(false);
  budEl("budCancel").onclick = () => budFinish(true);
  budEl("budRetry").onclick = () => e.conflict ? budReopenLatest() : e.cancelFailed ? budFinish(true) : budFlush(e);
  budBoardPaint(); budStatus(e);
}
function budEditStart() {
  if (BUD_EDIT || !BUDGET_VIEW) return;
  const v = BUDGET_VIEW, saved = budgetEditsFor(BUD_ME.budget, v.weekStartKey) || {};
  const original = budClone(budgetEditSnapshot(BUD_ME.budget, v.weekStartKey));
  BUD_EDIT = { week: v.weekStartKey, today: v.todayKey, base: v.baseItems, scope: "week", original, expected: original,
    draft: budClone({ removed: v.removedKeys, added: v.customAdded, changes: saved.changes || [], order: saved.order || [] }),
    rev: 0, saved: 0, state: "ready", message: "", timer: null, flight: null, fieldError: "", locked: false };
  BUD_FLASH = ""; BUD_RESET_OPEN = false;
  budSetDaysOpen(true); budRenderEditArea(v);
  budEl("budDone").focus({ preventScroll: true });
}
function budStatus(e) {
  const msg = e.message || ({ready: "Changes save automatically", pending: "Waiting to autosave…", saving: "Saving changes…", saved: "All changes saved", restoring: "Restoring your original plan…"})[e.state];
  for (const id of ["budSaveStatus", "budDialogStatus"]) {
    const el = budEl(id);
    const field = id === "budDialogStatus" && e.fieldError;
    el.textContent = field || msg;
    el.dataset.state = field ? "error" : e.state;
  }
  budEl("budRetry").hidden = e.state !== "error" || (!e.conflict && !e.cancelFailed && e.rev === e.saved);
  budEl("budRetry").textContent = e.conflict ? "Reopen latest plan" : "Retry";
  budEl("budDone").disabled = e.locked || e.conflict;
  budEl("budCancel").disabled = e.locked;
  budEl("budScope").disabled = e.locked || e.conflict;
}
function budChanged() {
  const e = BUD_EDIT;
  if (e.locked || e.conflict) return;
  e.rev++; e.state = "pending"; e.message = ""; e.cancelFailed = false;
  clearTimeout(e.timer); e.timer = setTimeout(() => budFlush(e), 425);
  budStatus(e);
}
async function budFlush(e) {
  clearTimeout(e.timer);
  if (e.flight) return e.flight;
  if (e.saved === e.rev || e.cancelling || e.conflict) return e.saved === e.rev;
  e.flight = (async () => {
    while (!e.cancelling && e.saved !== e.rev) {
      const rev = e.rev, scope = e.scope, draft = budClone(e.draft);
      const checked = budgetValidateEdits({...BUDGET_VIEW, baseItems: e.base, weekStartKey: e.week}, BUD_ME, draft, scope);
      e.state = "saving"; e.message = ""; budStatus(e);
      let res;
      try {
        res = checked.errors.length ? {ok:false, errors:checked.errors} : await saveBudgetEdits(CURRENT.username, scope, draft, e.week, e);
      } catch (_) { res = {ok:false, errors:["Couldn't save. Check your connection and retry."]}; }
      if (!res.ok) {
        e.conflict = !!res.conflict;
        if (!e.conflict && e.rev !== rev) continue;
        e.state = "error"; e.message = "Not saved. " + res.errors.join(" "); budStatus(e); return false;
      }
      e.saved = rev; e.expected = budgetEditSnapshot(res.budget, e.week); e.wrote = true;
      budShowCommit(res);
    }
    e.state = "saved"; e.message = ""; budStatus(e); return true;
  })();
  try { return await e.flight; } finally { e.flight = null; }
}
async function budFinish(cancel) {
  const e = BUD_EDIT;
  if (!e || e.locked) return;
  e.locked = true; e.cancelling = cancel; clearTimeout(e.timer); budStatus(e);
  if (e.flight) await e.flight;
  let latest;
  if (cancel && e.wrote && !e.conflict) {
    e.state = "restoring"; e.message = ""; budStatus(e);
    latest = await saveBudgetEdits(CURRENT.username, "cancel", {}, e.week, e);
    if (!latest.ok) { e.locked = e.cancelling = false; e.cancelFailed = true; e.conflict = !!latest.conflict; e.state = "error"; e.message = "Couldn’t cancel. " + latest.errors.join(" "); budStatus(e); return; }
  } else if (!cancel && !(await budFlush(e))) { e.locked = false; budStatus(e); return; }
  if (e.conflict) { budReopenLatest(); return; }
  BUD_EDIT = null;
  BUD_FLASH = '<p class="days-feedback" role="status">' + (cancel ? "Edits cancelled. Your original plan is back." : "Your plan is up to date.") + '</p>';
  if (latest) budShowCommit(latest); else renderBudgetStudent(BUD_ME, budgetClass);
  budEl("budEditStart").focus({preventScroll:true});
}
function budReopenLatest() { BUD_EDIT = null; location.reload(); }
function budRows() {
  const e = BUD_EDIT;
  return budgetBoardItems(e.base, e.draft, e.week, e.today);
}
function budLane(i) {
  return i.dayKey ? Math.round(daysBetweenKeys(BUD_EDIT.week, i.dayKey)) : i.status === "daily" ? -2 : -1;
}
function budLaneLabel(day) {
  return day === -2 ? "Every day" : day === -1 ? "Extra money so far" : budgetDayWord(dateKeyPlusDays(BUD_EDIT.week, day));
}
function budBoardPaint() {
  const e = BUD_EDIT, rows = budRows(), board = budEl("budDays");
  const lanes = [0,1,2,3,4,5,6,...[-2,-1].filter(d => rows.some(i => budLane(i) === d))];
  board.innerHTML = lanes.map(d => {
    const items = rows.filter(i => budLane(i) === d), key = d < 0 ? "" : dateKeyPlusDays(e.week,d);
    const cards = items.map(i => {
      const cat = budgetCategory(i);
      return '<button type="button" class="days-card" data-key="' + budEsc(budgetBoardKey(i)) + '" data-cat="' + cat + '">' +
        '<span class="days-grip" aria-hidden="true">⠿</span><span class="days-card-copy"><strong>' + budEsc(i.label) + '</strong><span class="days-cat" data-cat="' + cat + '">' + BUD_CATEGORIES[cat] + '</span></span><b>' + fmtMoney(i.amount) + '</b></button>';
    }).join("");
    return '<section class="days-lane' + (key === e.today ? ' is-today' : '') + '" data-day="' + d + '"><div class="days-lane-head"><h4>' + (key ? budDateLabel(key) : budLaneLabel(d)) + '</h4>' +
      (key === e.today ? '<span class="bud-today">Today</span>' : '') + (d < 0 ? '' : '<button class="days-plus" type="button" data-add="' + d + '" aria-label="Add item to ' + budLaneLabel(d) + '">+</button>') + '</div>' +
      cards + (items.length ? '' : '<button class="days-empty" type="button" data-add="' + d + '">Drop here or add an item</button>') + '</section>';
  }).join("");
  const gone = e.base.filter(i => e.draft.removed.includes(i.key) && i.status !== "done");
  if (gone.length) board.insertAdjacentHTML("beforeend", '<div class="days-removed"><strong>Removed from plan</strong>' + gone.map(i =>
    '<button class="days-link" data-restore="' + budEsc(i.key) + '">Restore ' + budEsc(i.label) + '</button>').join('') + '</div>');
  board.onclick = ev => {
    if (!BUD_EDIT || e.locked || e.conflict || performance.now() < (e.ignoreClick || 0)) return;
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.restore) { e.draft.removed = e.draft.removed.filter(k => k !== b.dataset.restore); budBoardPaint(); budChanged(); }
    else if (b.dataset.key || b.dataset.add != null) budOpenItem(b.dataset.key, Number(b.dataset.add));
  };
  board.onpointerdown = budDragStart;
}
function budPatch(key, patch) {
  const list = BUD_EDIT.draft.changes;
  let p = list.find(p => p.key === key);
  if (!p) list.push(p = {key});
  Object.assign(p,patch);
}
function budMove(key, day, before) {
  const e = BUD_EDIT, rows = budRows(), i = rows.find(i => budgetBoardKey(i) === key);
  if (!i || (day < 0 && day !== budLane(i)) || key === before) return false;
  const siblings = rows.filter(x => budLane(x) === day).map(budgetBoardKey);
  const old = siblings.indexOf(key);
  if (old >= 0 && (siblings[old+1] || "") === before) return false;
  if (budLane(i) !== day) {
    if (i.custom) e.draft.added.find(c => c.id === i.customId).day = day;
    else budPatch(key,{day});
  }
  const order = rows.map(budgetBoardKey).filter(k => k !== key);
  const last = siblings.filter(k => k !== key).at(-1);
  order.splice(before ? order.indexOf(before) : last ? order.indexOf(last)+1 : order.length,0,key);
  e.draft.order = order;
  return true;
}
function budDragStart(ev) {
  const card = ev.target.closest(".days-card"), e = BUD_EDIT;
  if (!card || !e || e.locked || e.conflict || !ev.isPrimary || ev.button !== 0 || (ev.pointerType === "touch" && !ev.target.closest(".days-grip"))) return;
  const key = card.dataset.key, from = Number(card.closest(".days-lane").dataset.day), sx = ev.clientX, sy = ev.clientY;
  let active = false, x = sx, y = sy, lane, before, line, frame, ghost;
  const clean = () => { lane?.classList.remove("drop-target"); line?.classList.remove("drop-before"); lane = line = null; };
  function target() {
    clean();
    lane = document.elementFromPoint(x,y)?.closest(".days-lane");
    if (!lane || (+lane.dataset.day < 0 && +lane.dataset.day !== from)) { lane = null; return; }
    lane.classList.add("drop-target");
    line = [...lane.querySelectorAll(".days-card")].find(b => b !== card && y < b.getBoundingClientRect().top + b.offsetHeight/2);
    before = line?.dataset.key || ""; line?.classList.add("drop-before");
  }
  function scroll() {
    const dy = y < 75 ? -12 : y > innerHeight-75 ? 12 : 0;
    if (dy) { window.scrollBy(0,dy); target(); }
    frame = requestAnimationFrame(scroll);
  }
  function move(v) {
    if (v.pointerId !== ev.pointerId) return;
    x = v.clientX; y = v.clientY;
    if (!active && Math.hypot(x-sx,y-sy) < 6) return;
    if (!active) {
      active = true; card.setPointerCapture(ev.pointerId);
      ghost = card.cloneNode(true); ghost.removeAttribute("data-key"); ghost.setAttribute("aria-hidden","true"); ghost.tabIndex = -1;
      ghost.classList.add("days-drag-preview"); ghost.style.width = Math.min(card.offsetWidth,230) + "px";
      document.body.appendChild(ghost); card.classList.add("is-dragging"); scroll();
    }
    ghost.style.left = Math.max(4,Math.min(innerWidth-ghost.offsetWidth-6,x+14)) + "px";
    ghost.style.top = Math.max(4,Math.min(innerHeight-ghost.offsetHeight-6,y+14)) + "px";
    target();
  }
  function end(v) {
    if (v.pointerId !== ev.pointerId) return;
    document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",end); document.removeEventListener("pointercancel",end);
    cancelAnimationFrame(frame); ghost?.remove(); card.classList.remove("is-dragging");
    if (active && BUD_EDIT === e) {
      e.ignoreClick = performance.now()+350;
      if (lane && v.type === "pointerup" && budMove(key,+lane.dataset.day,before)) { budBoardPaint(); budChanged(); }
    }
    clean();
  }
  document.addEventListener("pointermove",move); document.addEventListener("pointerup",end); document.addEventListener("pointercancel",end);
}
function budOpenItem(key, day) {
  const e = BUD_EDIT, dlg = budEl("budItemDialog"), form = budEl("budItemForm");
  const rows = budRows(), initial = rows.find(i => budgetBoardKey(i) === key), fresh = !initial;
  if (fresh && e.draft.added.length >= BUDGET_MAX_CUSTOM) {
    e.state = "error"; e.message = "You can add up to " + BUDGET_MAX_CUSTOM + " personal items. Remove one to add another."; budStatus(e); return;
  }
  const personal = fresh || initial.custom, cat = initial ? budgetCategory(initial) : "need";
  const name = budEl("budItemName"), amount = budEl("budItemAmount"), days = budEl("budItemDay"), pos = budEl("budPosition");
  const originalLane = initial ? budLane(initial) : day;
  let id = initial?.customId || "c" + crypto.randomUUID(), present = !fresh, itemKey = key || "custom-" + id;
  e.fieldError = "";
  budEl("budDialogTitle").textContent = fresh ? "Add an item" : "Edit item";
  budEl("budDialogHint").textContent = personal ? "Changes save automatically. Personal items count on the day you choose." : "Changes save automatically to your plan. Your bank transaction stays the same.";
  name.readOnly = !personal; name.value = initial?.label || ""; amount.value = initial?.amount ?? "";
  amount.min = personal ? "0.01" : "0";
  const categories = ["need","want","savings","income"];
  const baseCategory = initial && budgetCategory(e.base.find(i => budgetBoardKey(i) === key) || initial);
  if (["move","unsave"].includes(baseCategory)) categories.push(baseCategory);
  budEl("budTypes").innerHTML = categories.map(c => '<label data-cat="' + c + '"><input type="radio" name="budCat" value="' + c + '"' + (c === cat ? ' checked' : '') + '><span>' + BUD_CATEGORIES[c] + '</span></label>').join("");
  const laneOpts = [0,1,2,3,4,5,6];
  if (originalLane < 0) laneOpts.unshift(originalLane);
  days.innerHTML = laneOpts.map(d => '<option value="' + d + '">' + budLaneLabel(d) + '</option>').join("");
  days.value = originalLane;
  function positions(auto) {
    const siblings = budRows().filter(i => budLane(i) === +days.value);
    const n = siblings.findIndex(i => budgetBoardKey(i) === itemKey);
    pos.innerHTML = siblings.filter(i => budgetBoardKey(i) !== itemKey).map(i => '<option value="' + budEsc(budgetBoardKey(i)) + '">Before ' + budEsc(i.label) + '</option>').join("") + '<option value="">Last in day</option>';
    pos.value = auto && n >= 0 && siblings[n+1] ? budgetBoardKey(siblings[n+1]) : "";
  }
  positions(true);
  const remove = budEl("budRemoveItem");
  remove.hidden = fresh || (!personal && ["settled","done"].includes(initial.status));
  function sync(ev) {
    if (e.locked || e.conflict) return false;
    if (ev?.target === days) positions(false);
    const label = name.value.trim(), value = amount.valueAsNumber, category = form.elements.budCat.value;
    if (!label || !amount.validity.valid) {
      e.fieldError = !label ? "Enter an item name to autosave." : "Enter $" + amount.min + " to $1,000,000, with up to two decimal places.";
      budStatus(e); return false;
    }
    e.fieldError = "";
    const existing = budRows().find(i => budgetBoardKey(i) === itemKey);
    let dirty = false;
    if (!present) {
      e.draft.added.push({id,label,amount:value,dir:budgetCategoryDir(category),category,day:+days.value});
      present = dirty = true; remove.hidden = false;
    } else if ((personal && label !== existing.label) || value !== existing.amount || category !== budgetCategory(existing)) {
      if (personal) Object.assign(e.draft.added.find(c => c.id === id), {label,amount:value,dir:budgetCategoryDir(category),category});
      else {
        const patch = {};
        if (value !== existing.amount) patch.amount = value;
        if (category !== budgetCategory(existing)) patch.category = category;
        budPatch(itemKey, patch);
      }
      dirty = true;
    }
    const moved = budMove(itemKey,+days.value,pos.value);
    if (dirty || moved) { budBoardPaint(); budChanged(); } else budStatus(e);
    return true;
  }
  function close() {
    dlg.close(); form.oninput = form.onsubmit = dlg.oncancel = null; e.fieldError = "";
    const b = [...budEl("budDays").querySelectorAll("button")].find(b => b.dataset.key === itemKey) ||
      budEl("budDays").querySelector('[data-add="' + Math.max(0,originalLane) + '"]');
    b?.focus({preventScroll:true});
  }
  budEl("budDialogClose").onclick = close;
  dlg.oncancel = ev => { ev.preventDefault(); close(); };
  remove.onclick = () => {
    if (personal) e.draft.added = e.draft.added.filter(c => c.id !== id);
    else e.draft.removed.push(initial.key);
    e.draft.order = e.draft.order.filter(k => k !== itemKey);
    budBoardPaint(); budChanged(); close();
  };
  form.oninput = sync;
  form.onsubmit = ev => { ev.preventDefault(); if (sync()) { close(); budFlush(e); } };
  budStatus(e); dlg.showModal(); (fresh ? name : amount).focus();
}
window.addEventListener("beforeunload", ev => {
  if (BUD_EDIT && (BUD_EDIT.rev !== BUD_EDIT.saved || BUD_EDIT.flight)) { ev.preventDefault(); ev.returnValue = ""; }
});
