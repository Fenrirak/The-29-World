let CURRENT, IS_TEACHER;
let ITEMS_CACHE = [];
let MANUAL_ITEMS = [];          // live items in the teacher's saved (custom) order
let SORT_MODE = "manual";
let DRAGGING = false;
let SAVE_CHAIN = Promise.resolve(); // serialises saves so quick taps can't race
let SORT_STATUS = "";

const SORT_MODES = [
  { id: "manual", label: "Custom order" },
  { id: "name-asc", label: "A → Z" },
  { id: "name-desc", label: "Z → A" },
  { id: "price-asc", label: "Price: low → high" },
  { id: "price-desc", label: "Price: high → low" },
  { id: "stars-desc", label: "Most stars" },
  { id: "stock-asc", label: "Low stock first" },
  { id: "sold-desc", label: "Best sellers" }
];
const GRIP_SVG = '<svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.6"/><circle cx="10" cy="3" r="1.6"/><circle cx="4" cy="9" r="1.6"/><circle cx="10" cy="9" r="1.6"/><circle cx="4" cy="15" r="1.6"/><circle cx="10" cy="15" r="1.6"/></svg>';
const UP_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l4-4 4 4"/></svg>';
const DOWN_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5l4 4 4-4"/></svg>';
const SORT_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V4M3 7l3-3 3 3M14 4v12M11 13l3 3 3-3"/></svg>';

// Pure sort (stable: ties keep the custom order). Never mutates `items`.
function sortStoreItems(items, mode) {
  const arr = items.slice();
  if (!mode || mode === "manual") return arr;
  const idx = new Map(arr.map((it, i) => [it.id, i]));
  const nameCmp = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true });
  // limited stock (soonest to run out) -> unlimited -> sold out
  const stockRank = it => (it.stock === null || it.stock === undefined) ? 1 : (it.stock <= 0 ? 2 : 0);
  const cmps = {
    "name-asc": nameCmp,
    "name-desc": (a, b) => nameCmp(b, a),
    "price-asc": (a, b) => (Number(a.price) || 0) - (Number(b.price) || 0),
    "price-desc": (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0),
    "stars-desc": (a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0),
    "stock-asc": (a, b) => (stockRank(a) - stockRank(b)) || ((a.stock || 0) - (b.stock || 0)),
    "sold-desc": (a, b) => (Number(b.sold) || 0) - (Number(a.sold) || 0)
  };
  const cmp = cmps[mode];
  if (!cmp) return arr;
  return arr.sort((a, b) => cmp(a, b) || (idx.get(a.id) - idx.get(b.id)));
}
let ME_CACHE = null;

function starsHtml(n) {
  n = Number(n) || 0;
  return n > 0 ? `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : "";
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("cart", 26) + " Class Store";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an item";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add item";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  paintChrome();
  // Same fix as the other pages: run the independent background jobs
  // together instead of one sequential network round-trip each.
  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(dailyLifeAllowanceForClassIfDue(u.classCode), "dailyLifeAllowanceForClassIfDue")
      : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  if (DRAGGING) return; // don't rebuild the list under a card being dragged
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  ME_CACHE = me;
  MANUAL_ITEMS = (cls.storeItems || []).filter(i => !i.archived);
  SORT_MODE = SORT_MODES.some(m => m.id === cls.storeSortMode) ? cls.storeSortMode : "manual";
  const items = sortStoreItems(MANUAL_ITEMS, SORT_MODE);

  const list = document.getElementById("itemList");
  list.innerHTML = "";
  document.getElementById("noItems").classList.toggle("hidden", items.length > 0);

  const ownedCounts = {};
  (me.storeItems || []).forEach(id => { ownedCounts[id] = (ownedCounts[id] || 0) + 1; });

  items.forEach(it => {
    const outOfStock = it.stock !== null && it.stock <= 0;
    const maxQty = it.stock !== null ? it.stock : null;
    const owned = ownedCounts[it.id] || 0;
    const div = document.createElement("div");
    div.className = "card company-card store-card";
    div.id = "item-" + it.id;
    div.innerHTML = `
      <div class="flex-between" id="view-${it.id}">
        <div class="store-left">
          ${IS_TEACHER ? `<div class="reorder-ctl">
            <span class="rank-badge" title="Position in the store"></span>
            <button type="button" class="rc-btn rc-up" aria-label="Move ${escapeHtml(it.name)} up" title="Move up" onclick="moveItem('${it.id}', -1)">${UP_SVG}</button>
            <button type="button" class="rc-grip" aria-label="Drag to reorder ${escapeHtml(it.name)}" title="Drag to reorder" onpointerdown="startDrag(event, '${it.id}', this)" oncontextmenu="return false" onkeydown="gripKey(event, '${it.id}')">${GRIP_SVG}</button>
            <button type="button" class="rc-btn rc-down" aria-label="Move ${escapeHtml(it.name)} down" title="Move down" onclick="moveItem('${it.id}', 1)">${DOWN_SVG}</button>
          </div>` : ""}
          <div class="store-info">
          <h4>${icon("cart", 20)}${escapeHtml(it.name)} ${owned ? `<span class="badge mint">Owned ×${owned}</span>` : ""}</h4>
          <p>${escapeHtml(it.description) || "No description provided."}</p>
          ${it.effect ? `<p class="muted-small">Does: ${it.effect}</p>` : ""}
          <p>${priceWithLifeDiscount(me, "store", it.price)} ${starsHtml(it.stars)}</p>
          <p class="muted-small">${it.stock === null ? "Unlimited stock" : `${it.stock} left in stock`}${IS_TEACHER ? ` · ${it.sold || 0} sold` : ""}</p>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editItem('${it.id}')">${icon("plus", 13)} Edit</button>
               <button class="btn small coral" onclick="deleteItem('${it.id}')">${icon("trash", 13)} Remove</button>`
            : outOfStock
              ? `<button class="btn small gold" disabled>${icon("cart", 13)} Out of stock</button>`
              : `<div class="qty-buy-block">
                   <div class="qty-stepper">
                     <button type="button" class="qty-btn" aria-label="Decrease quantity" onclick="qtyStep('${it.id}', -1)">−</button>
                     <input id="qty-${it.id}" class="qty-input" type="number" inputmode="numeric" min="1"
                       ${maxQty !== null ? `max="${maxQty}"` : ""} step="1" value="1"
                       onfocus="this.select()" onclick="this.select()"
                       oninput="qtyLiveInput('${it.id}')" onblur="qtyNormalize('${it.id}')"
                       onkeydown="if(event.key==='Enter'){qtyNormalize('${it.id}');event.preventDefault();}">
                     <button type="button" class="qty-btn" aria-label="Increase quantity" onclick="qtyStep('${it.id}', 1)">+</button>
                   </div>
                   <button class="btn small gold qty-buy-btn" id="buyBtn-${it.id}" onclick="buyItem('${it.id}')">${icon("cart", 13)} <span id="buyLabel-${it.id}">Buy</span></button>
                 </div>`}
          ${(!IS_TEACHER && owned) ? `<button class="btn small secondary" onclick="sellItem('${it.id}')">${icon("trash", 13)} Sell back (80%)</button>` : ""}
        </div>
      </div>
      <div id="edit-${it.id}" class="hidden"></div>
      <div id="msg-${it.id}"></div>
    `;
    list.appendChild(div);
  });
  ITEMS_CACHE = items;
  list.classList.toggle("auto-sorted", SORT_MODE !== "manual");
  refreshRanks();
  paintSortBar(items.length);
  if (!IS_TEACHER) items.forEach(it => { if (!(it.stock !== null && it.stock <= 0)) updateBuyLabel(it.id); });
}

function qtyStep(id, delta) {
  const input = document.getElementById("qty-" + id);
  if (!input) return;
  const max = input.getAttribute("max");
  let v = (parseInt(input.value, 10) || 1) + delta;
  if (v < 1) v = 1;
  if (max !== null && max !== "" && v > Number(max)) v = Number(max);
  input.value = v;
  updateBuyLabel(id);
}

// Live-updates the price label as the person types, without forcing
// the field back into range mid-keystroke (that would make it feel
// like you can't type a two-digit number). Out-of-range values are
// only clamped once they finish editing, in qtyNormalize below.
function qtyLiveInput(id) {
  updateBuyLabel(id);
}

function qtyNormalize(id) {
  const input = document.getElementById("qty-" + id);
  if (!input) return;
  const max = input.getAttribute("max");
  let v = parseInt(input.value, 10);
  if (!v || v < 1) v = 1;
  if (max !== null && max !== "" && v > Number(max)) v = Number(max);
  input.value = v;
  updateBuyLabel(id);
}

function updateBuyLabel(id) {
  const input = document.getElementById("qty-" + id);
  const label = document.getElementById("buyLabel-" + id);
  if (!input || !label || !ME_CACHE) return;
  const it = ITEMS_CACHE.find(i => i.id === id);
  if (!it) return;
  const max = input.getAttribute("max");
  let qty = parseInt(input.value, 10);
  if (!qty || qty < 1) qty = 1;
  if (max !== null && max !== "" && qty > Number(max)) qty = Number(max);
  const unitPrice = applyLifeDiscount(ME_CACHE, "store", it.price);
  const total = Math.round(unitPrice * qty * 100) / 100;
  label.textContent = qty > 1 ? `Buy ×${qty} — ${fmtMoney(total)}` : `Buy — ${fmtMoney(total)}`;
}

async function addItem(e) {
  e.preventDefault();
  const item = {
    name: document.getElementById("iName").value.trim(),
    price: document.getElementById("iPrice").value,
    stock: document.getElementById("iStock").value,
    effect: document.getElementById("iEffect").value.trim(),
    description: document.getElementById("iDesc").value.trim(),
    stars: document.getElementById("iStars").value,
    countsNetWorth: document.getElementById("iCountsNetWorth").checked
  };
  await addStoreItem(CURRENT.classCode, item);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Item added!</div>`;
  ["iName","iPrice","iStock","iEffect","iDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("iStars").value = 0;
  document.getElementById("iCountsNetWorth").checked = true;
  await render();
  return false;
}

function editItem(id) {
  const it = ITEMS_CACHE.find(i => i.id === id);
  if (!it) return;
  document.getElementById("view-" + id).classList.add("hidden");
  const box = document.getElementById("edit-" + id);
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="grid grid-3">
      <div>
        <label>Item name</label>
        <input id="e-name-${id}" value="${it.name.replace(/"/g, "&quot;")}">
      </div>
      <div>
        <label>Price</label>
        <input id="e-price-${id}" type="number" min="0" step="0.01" value="${it.price}">
      </div>
      <div>
        <label>Stock (blank = unlimited)</label>
        <input id="e-stock-${id}" type="number" min="0" step="1" value="${it.stockTotal === null || it.stockTotal === undefined ? "" : it.stockTotal}">
      </div>
    </div>
    <label>What it does</label>
    <input id="e-effect-${id}" value="${(it.effect || "").replace(/"/g, "&quot;")}">
    <label>Description</label>
    <input id="e-desc-${id}" value="${(it.description || "").replace(/"/g, "&quot;")}">
    <label>Lifestyle stars (0-5)</label>
    <input id="e-stars-${id}" type="number" min="0" max="5" step="1" value="${it.stars || 0}">
    <label style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" id="e-countsnw-${id}" ${it.countsNetWorth !== false ? "checked" : ""} style="width:20px;height:20px;min-height:auto;flex-shrink:0;">
      Counts towards net worth / leaderboard
    </label>
    <div class="row-flex" style="gap:8px;margin-top:14px;">
      <button class="btn small gold" onclick="saveItemEdit('${id}')">${icon("plus", 13)} Save changes</button>
      <button class="btn small secondary" onclick="cancelItemEdit('${id}')">Cancel</button>
    </div>
  `;
}

function cancelItemEdit(id) {
  document.getElementById("edit-" + id).classList.add("hidden");
  document.getElementById("view-" + id).classList.remove("hidden");
}

async function saveItemEdit(id) {
  const item = {
    name: document.getElementById("e-name-" + id).value.trim(),
    price: document.getElementById("e-price-" + id).value,
    stock: document.getElementById("e-stock-" + id).value,
    effect: document.getElementById("e-effect-" + id).value.trim(),
    description: document.getElementById("e-desc-" + id).value.trim(),
    stars: document.getElementById("e-stars-" + id).value,
    countsNetWorth: document.getElementById("e-countsnw-" + id).checked
  };
  await updateStoreItem(CURRENT.classCode, id, item);
  await render();
}

async function deleteItem(id) {
  if (confirm("Remove this item from the store?")) {
    await removeStoreItem(CURRENT.classCode, id);
    await render();
  }
}

async function sellItem(id) {
  if (!confirm("Sell this item back to the store for an 80% refund?")) return;
  const res = await sellStoreItem(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { document.getElementById("msg-" + id).innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
  // render() rebuilds the item's card (and its message box), so the
  // message goes in afterwards.
  flashMsg(document.getElementById("msg-" + id), `<div class="success-msg">Sold back for ${fmtMoney(res.payout)}!</div>`);
}

async function buyItem(id) {
  // Same double-tap guard as buy() in market.js — unlike deleteItem/
  // sellItem just above, this has no confirm() dialog to naturally
  // absorb an eager double-click, so without this a slow connection
  // could fire two purchases before the first's result shows up.
  const btn = document.getElementById("buyBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const input = document.getElementById("qty-" + id);
    let qty = 1;
    if (input) {
      qty = parseInt(input.value, 10) || 1;
      if (qty < 1) qty = 1;
      const max = input.getAttribute("max");
      if (max !== null && max !== "" && qty > Number(max)) qty = Number(max);
    }
    const res = await buyStoreItem(CURRENT.username, CURRENT.classCode, id, qty);
    if (!res.ok) { document.getElementById("msg-" + id).innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
    // Same as sellItem: render() rebuilds the message box.
    flashMsg(document.getElementById("msg-" + id), `<div class="success-msg">Purchased${res.qty > 1 ? ` ×${res.qty}` : ""}!</div>`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ===================== Teacher: arranging the store ===================== */
const $id = id => document.getElementById(id);
const domIds = () => [...$id("itemList").children].filter(c => c.id.startsWith("item-")).map(c => c.id.slice(5));

function setSortStatus(state) {
  SORT_STATUS = state;
  const el = $id("sortStatus");
  if (!el) return;
  el.className = "sort-status" + (state === "saved" ? " ok" : state === "error" ? " err" : "");
  el.textContent = state === "saving" ? "Saving…" : state === "saved" ? "Order saved ✓" : state === "error" ? "Couldn't save — reloaded the saved order" : "";
  if (state === "saved") setTimeout(() => { if (SORT_STATUS === "saved") setSortStatus(""); }, 2200);
}

function paintSortBar(count) {
  const bar = $id("sortBar");
  if (!bar) return;
  const show = IS_TEACHER && count > 1;
  bar.classList.toggle("hidden", !show);
  if (!show) return;
  const auto = SORT_MODE !== "manual";
  const label = (SORT_MODES.find(m => m.id === SORT_MODE) || {}).label;
  const chip = m => `<button type="button" class="sort-chip ${m.id === SORT_MODE ? "active" : ""}" role="radio" aria-checked="${m.id === SORT_MODE}" onclick="setSortMode('${m.id}')">${m.label}</button>`;
  bar.innerHTML = `
    <div class="sort-head"><span class="sort-title">${SORT_SVG} Item order</span><span id="sortStatus" class="sort-status"></span></div>
    <div class="sort-row" role="radiogroup" aria-label="How the store is ordered">
      <span class="sort-row-label">Manual</span>${chip(SORT_MODES[0])}
    </div>
    <div class="sort-row" role="radiogroup" aria-label="Automatic sorting">
      <span class="sort-row-label">Auto-sort</span>${SORT_MODES.slice(1).map(chip).join("")}
    </div>
    <p class="muted-small sort-hint">${auto
      ? `Sorted automatically by <b>${label}</b> — new and edited items slot into place by themselves. Want to fine-tune it by hand?`
      : `Drag the <b>⠿</b> handle (or use the ▲ ▼ buttons) to put items in any order. Students see exactly this order, and it saves automatically.`}</p>
    ${auto ? `<button type="button" class="btn small gold sort-keep" onclick="saveAutoAsCustom()">Keep this order as my custom order</button>` : ""}`;
  setSortStatus(SORT_STATUS);
}

function refreshRanks() {
  if (!IS_TEACHER) return;
  const cards = [...$id("itemList").children];
  cards.forEach((c, i) => {
    const r = c.querySelector(".rank-badge");
    if (r) r.textContent = i + 1;
    const up = c.querySelector(".rc-up"), down = c.querySelector(".rc-down");
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === cards.length - 1;
  });
}

// FLIP animation: cards glide to their new spot instead of jumping.
function flipList(mutate, skip) {
  const list = $id("itemList");
  const kids = [...list.children].filter(k => k !== skip);
  const first = new Map(kids.map(k => [k, k.getBoundingClientRect().top]));
  mutate();
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  kids.forEach(k => {
    const dy = first.get(k) - k.getBoundingClientRect().top;
    if (!dy) return;
    k.style.transition = "none";
    k.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      k.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
      k.style.transform = "";
      setTimeout(() => { k.style.transition = ""; }, 320);
    }));
  });
}

function queueSave(fn) {
  setSortStatus("saving");
  SAVE_CHAIN = SAVE_CHAIN.then(fn).then(() => setSortStatus("saved")).catch(err => {
    console.error("Saving store order failed", err);
    setSortStatus("error");
    return render();
  });
}

function commitOrder(ids) {
  MANUAL_ITEMS = ids.map(id => MANUAL_ITEMS.find(i => i.id === id)).filter(Boolean);
  ITEMS_CACHE = MANUAL_ITEMS.slice();
  refreshRanks();
  queueSave(() => reorderStoreItems(CURRENT.classCode, ids, "manual"));
}

function setSortMode(mode) {
  if (!IS_TEACHER || mode === SORT_MODE) return;
  SORT_MODE = mode;
  const items = sortStoreItems(MANUAL_ITEMS, mode);
  const list = $id("itemList");
  flipList(() => items.forEach(it => { const c = $id("item-" + it.id); if (c) list.appendChild(c); }));
  ITEMS_CACHE = items;
  list.classList.toggle("auto-sorted", mode !== "manual");
  refreshRanks();
  paintSortBar(items.length);
  const active = document.querySelector("#sortBar .sort-chip.active");
  if (active) active.focus({ preventScroll: true });
  queueSave(() => setStoreSortMode(CURRENT.classCode, mode));
}

// Turns the current automatic order into the saved custom order.
function saveAutoAsCustom() {
  if (SORT_MODE === "manual") return;
  const ids = ITEMS_CACHE.map(i => i.id);
  SORT_MODE = "manual";
  MANUAL_ITEMS = ITEMS_CACHE.slice();
  $id("itemList").classList.remove("auto-sorted");
  refreshRanks();
  paintSortBar(ids.length);
  queueSave(() => reorderStoreItems(CURRENT.classCode, ids, "manual"));
}

function moveItem(id, dir) {
  if (!IS_TEACHER || SORT_MODE !== "manual") return;
  const list = $id("itemList"), card = $id("item-" + id);
  if (!card) return;
  const sib = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
  if (!sib) return;
  flipList(() => dir < 0 ? list.insertBefore(card, sib) : list.insertBefore(sib, card));
  commitOrder(domIds());
  let btn = card.querySelector(dir < 0 ? ".rc-up" : ".rc-down");
  if (!btn || btn.disabled) btn = card.querySelector(dir < 0 ? ".rc-down" : ".rc-up");
  if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function gripKey(e, id) {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    moveItem(id, e.key === "ArrowUp" ? -1 : 1);
    const g = $id("item-" + id)?.querySelector(".rc-grip");
    if (g) g.focus({ preventScroll: true });
  }
}

// Pointer-based drag (mouse, touch, pen). While dragging, NOTHING is moved
// in the DOM (that would make the browser drop the pointer/touch): the grabbed
// card follows the pointer via transform, the others slide aside via
// transform, and the real reorder happens once, on drop.
function startDrag(e, id, handle) {
  if (!IS_TEACHER || SORT_MODE !== "manual" || DRAGGING) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const list = $id("itemList");
  const cards = [...list.children];
  const card = $id("item-" + id);
  const k = cards.indexOf(card), n = cards.length;
  if (k < 0 || n < 2) return;
  e.preventDefault();
  try { handle.setPointerCapture(e.pointerId); } catch (_) {}

  const startOrder = cards.map(c => c.id.slice(5)).join(",");
  const sy0 = window.scrollY;
  const rects = cards.map(c => c.getBoundingClientRect());
  const tops = rects.map(r => r.top + sy0);   // page coordinates
  const hts = rects.map(r => r.height);
  const gap = k < n - 1 ? tops[k + 1] - (tops[k] + hts[k]) : tops[k] - (tops[k - 1] + hts[k - 1]);
  const shift = hts[k] + Math.max(0, gap);
  const grab = e.clientY + sy0 - tops[k];
  let y = e.clientY, raf = 0, done = false, target = k;

  DRAGGING = true;
  card.classList.add("dragging");
  card.style.transition = "none";
  list.classList.add("is-dragging");
  document.body.classList.add("store-dragging");
  cards.forEach(c => { if (c !== card) c.style.transition = "transform .2s cubic-bezier(.2,.8,.2,1)"; });

  const update = () => {
    const minTop = tops[0], maxTop = tops[n - 1] + hts[n - 1] - hts[k];
    const top = Math.max(minTop, Math.min(maxTop, y + window.scrollY - grab));
    card.style.transform = `translateY(${top - tops[k]}px)`;
    const center = top + hts[k] / 2;
    let tg = 0;
    for (let j = 0; j < n; j++) if (j !== k && tops[j] + hts[j] / 2 < center) tg++;
    if (tg === target) return;
    target = tg;
    for (let j = 0; j < n; j++) {
      if (j === k) continue;
      const m = j < k ? j : j - 1;   // index among the other cards
      const dy = (j < k && m >= target) ? shift : (j > k && m < target) ? -shift : 0;
      cards[j].style.transform = dy ? `translateY(${dy}px)` : "";
    }
  };
  const tick = () => {
    if (done) return;
    const edge = 90;
    let dy = 0;
    if (y < edge) dy = -Math.min(22, Math.ceil((edge - y) / 5));
    else if (y > innerHeight - edge) dy = Math.min(22, Math.ceil((y - (innerHeight - edge)) / 5));
    if (dy) { window.scrollBy(0, dy); update(); }
    raf = requestAnimationFrame(tick);
  };
  const onMove = ev => { y = ev.clientY; update(); };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    ["pointermove", "pointerup", "pointercancel", "lostpointercapture"].forEach(t => handle.removeEventListener(t, t === "pointermove" ? onMove : finish));
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    const others = cards.filter(c => c !== card);
    others.splice(target, 0, card);
    card.classList.remove("dragging");
    card.classList.add("settling");
    // One real reorder; FLIP glides every card from where it is now to its slot.
    flipList(() => {
      cards.forEach(c => { c.style.transition = "none"; c.style.transform = ""; });
      others.forEach(c => list.appendChild(c));
    });
    setTimeout(() => card.classList.remove("settling"), 340);
    list.classList.remove("is-dragging");
    document.body.classList.remove("store-dragging");
    DRAGGING = false;
    const ids = domIds();
    refreshRanks();
    if (ids.join(",") !== startOrder) commitOrder(ids);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  update();
  raf = requestAnimationFrame(tick);
}

document.addEventListener("DOMContentLoaded", init);
