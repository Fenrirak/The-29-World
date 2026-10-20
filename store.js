let CURRENT, IS_TEACHER;
let ITEMS_CACHE = [];
let CLS_CACHE = null;           // the class doc — needed to price card discounts/vouchers
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
  if (!IS_TEACHER) { cartLoad(); cartBuildDom(); }
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
    safeBgJob(processCreditCards(u.classCode), "processCreditCards"),
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
  CLS_CACHE = cls;
  ccStoreBarRender(me, cls); // "Pay with: Cash / Credit card" bar (creditcard.js)
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
          <h4>${icon("cart", 20)}${escapeHtml(it.name)} ${owned ? `<span class="badge mint">Owned ×${owned}</span>` : ""} ${IS_TEACHER ? "" : `<span class="badge gold ${CART[it.id] ? "" : "hidden"}" id="inCart-${it.id}">In cart ×${CART[it.id] || 0}</span>`}</h4>
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
                   <button class="btn small gold qty-buy-btn" id="buyBtn-${it.id}" onclick="addToCart('${it.id}')">${icon("cart", 13)} <span id="buyLabel-${it.id}">Add to cart</span></button>
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
  if (!IS_TEACHER) {
    cartClean();
    items.forEach(it => { if (!(it.stock !== null && it.stock <= 0)) { updateBuyLabel(it.id); updateCartBadge(it.id); } });
    renderCart();
  }
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
  // Same pricing function the checkout uses, so the button always matches the charge.
  // The card discount needs the whole bill on the card, so a split is priced like cash (same as the checkout).
  const pr = cardStorePricing(ME_CACHE, CLS_CACHE, it.price, qty, CC_STORE_PAY.useCard && !CC_STORE_PAY.split, CC_STORE_PAY.voucherId, nzDateKey());
  const how = CC_STORE_PAY.useCard && cardIsActive(ME_CACHE) ? (CC_STORE_PAY.split ? " (card + cash)" : " on card") : "";
  label.textContent = (qty > 1 ? `Add ×${qty}` : "Add to cart") + ` — ${fmtMoney(pr.total)}${how}`;
}
function updateAllBuyLabels() { ITEMS_CACHE.forEach(it => updateBuyLabel(it.id)); renderCart(); }

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

/* ===================== Student: shopping cart ===================== */
// Students add items to a cart, then pay for everything in one checkout.
// Checkout calls buyStoreCart() (data-money.js) when it exists, so the whole cart is ONE transaction.
// Until that function exists it falls back to buying line by line (see checkoutCart).
let CART = {}, CART_BUSY = false, CART_DONE = null, CART_MSG = "", CART_OPEN = false;
const cartApi = () => typeof buyStoreCart === "function";
const cartKey = () => "anw_cart_" + CURRENT.username + "_" + CURRENT.classCode;
function cartLoad() { try { const o = JSON.parse(localStorage.getItem(cartKey()) || "{}"); CART = o && typeof o === "object" ? o : {}; } catch (e) { CART = {}; } }
function cartSave() { try { localStorage.setItem(cartKey(), JSON.stringify(CART)); } catch (e) { /* ignore */ } }
const cartCount = () => Object.values(CART).reduce((a, b) => a + b, 0);
const cartLines = () => ITEMS_CACHE.filter(it => CART[it.id] > 0).map(it => ({ it, qty: CART[it.id] }));
const cartStockMax = it => (it.stock === null || it.stock === undefined) ? Infinity : Math.max(0, it.stock);

// Drop sold-out / removed items and cap quantities to the stock that's left.
function cartClean() {
  let changed = false;
  Object.keys(CART).forEach(id => {
    const it = ITEMS_CACHE.find(i => i.id === id);
    let q = Math.floor(Number(CART[id])) || 0;
    if (it) q = Math.min(q, cartStockMax(it));
    if (!it || q < 1) { delete CART[id]; changed = true; }
    else if (q !== CART[id]) { CART[id] = q; changed = true; }
  });
  if (changed) cartSave();
}

// ---- pricing: always the same function the checkout uses ----
const cartUsesCardPrice = () => CC_STORE_PAY.useCard && !CC_STORE_PAY.split;
const cartPrice = (price, qty, voucherId) => cardStorePricing(ME_CACHE, CLS_CACHE, price, qty, cartUsesCardPrice(), voucherId || "", nzDateKey()).total;
const cartPayOpts = () => ({ useCard: CC_STORE_PAY.useCard, voucherId: CC_STORE_PAY.voucherId, split: CC_STORE_PAY.useCard && CC_STORE_PAY.split, cardMax: CC_STORE_PAY.cardMax === "" ? null : Number(CC_STORE_PAY.cardMax) });
// Dearest line first: in line-by-line mode the voucher goes on that one.
const cartOrdered = lines => lines.slice().sort((a, b) => cartPrice(b.it.price, b.qty, "") - cartPrice(a.it.price, a.qty, ""));
function cartTotals(lines) {
  const vid = CC_STORE_PAY.voucherId;
  const sub = cardRound(lines.reduce((s, l) => s + cartPrice(l.it.price, l.qty, ""), 0));
  let total = 0;
  if (lines.length && cartApi()) total = cartPrice(lines.reduce((s, l) => s + Number(l.it.price) * l.qty, 0), 1, vid);
  else if (lines.length) { const o = cartOrdered(lines); total = cardRound(o.reduce((s, l, i) => s + cartPrice(l.it.price, l.qty, i === 0 ? vid : ""), 0)); }
  return { sub, total, saved: Math.max(0, cardRound(sub - total)) };
}

// ---- cart actions ----
function addToCart(id) {
  const it = ITEMS_CACHE.find(i => i.id === id); if (!it) return;
  const input = $id("qty-" + id), msg = $id("msg-" + id);
  const want = Math.max(1, parseInt(input && input.value, 10) || 1);
  const have = CART[id] || 0, max = cartStockMax(it), room = max - have;
  if (room < 1) { if (msg) msg.innerHTML = `<div class="error-msg">You already have all ${max} in your cart.</div>`; return; }
  const add = Math.min(want, room);
  CART[id] = have + add; cartSave(); CART_DONE = null; CART_MSG = "";
  if (input) input.value = 1;
  updateBuyLabel(id); updateCartBadge(id); renderCart();
  const fab = $id("cartFab"); if (fab) { fab.classList.remove("bump"); void fab.offsetWidth; fab.classList.add("bump"); }
  if (msg) flashMsg(msg, `<div class="success-msg">Added${add > 1 ? ` ×${add}` : ""} to your cart${add < want ? ` (only ${max} in stock)` : ""}.</div>`);
}
function updateCartBadge(id) {
  const b = $id("inCart-" + id); if (!b) return;
  const q = CART[id] || 0;
  b.classList.toggle("hidden", !q); b.textContent = `In cart ×${q}`;
}
function cartSet(id, qty) {
  const it = ITEMS_CACHE.find(i => i.id === id); if (!it) return;
  qty = Math.min(Math.floor(qty), cartStockMax(it));
  if (qty < 1) delete CART[id]; else CART[id] = qty;
  cartSave(); CART_MSG = ""; updateCartBadge(id); renderCart();
}
const cartStep = (id, d) => cartSet(id, (CART[id] || 0) + d);
const cartRemove = id => cartSet(id, 0);
function cartClear() { if (!cartCount() || !confirm("Remove everything from your cart?")) return; Object.keys(CART).forEach(id => { delete CART[id]; updateCartBadge(id); }); cartSave(); CART_MSG = ""; renderCart(); }

async function checkoutCart() {
  if (CART_BUSY) return;
  const lines = cartLines(); if (!lines.length) return;
  CART_BUSY = true; CART_MSG = ""; renderCart();
  const opts = cartPayOpts(), snap = cartTotals(lines), done = [];
  let err = "";
  try {
    if (cartApi()) {
      // One transaction for the whole cart (all-or-nothing, one voucher, one receipt).
      const res = await buyStoreCart(CURRENT.username, CURRENT.classCode, lines.map(l => ({ id: l.it.id, qty: l.qty })), opts);
      if (res && res.ok) done.push(...lines); else err = (res && res.error) || "The purchase didn't go through.";
    } else if (opts.split && opts.cardMax !== null) {
      err = "A card limit on a part-card payment needs the single-transaction checkout. Clear the limit box, or pay fully by card or cash.";
    } else {
      // Fallback until buyStoreCart() exists: one purchase per line, voucher on the dearest line only.
      let vid = opts.voucherId;
      for (const l of cartOrdered(lines)) {
        const r = await buyStoreItem(CURRENT.username, CURRENT.classCode, l.it.id, l.qty, Object.assign({}, opts, { voucherId: vid }));
        if (!r.ok) { err = `${l.it.name}: ${r.error}`; break; }
        done.push(l); vid = "";
      }
    }
  } catch (e) { console.error("Checkout failed", e); err = "Something went wrong. Please try again."; }
  done.forEach(l => delete CART[l.it.id]); cartSave();
  if (done.length) CART_DONE = { lines: done.map(l => ({ name: l.it.name, qty: l.qty })), total: err ? null : snap.total };
  if (err) CART_MSG = `<div class="error-msg">${done.length ? `Bought ${done.length} of ${lines.length} items. ` : ""}${escapeHtml(err)}</div>`;
  CART_BUSY = false;
  await render();
  renderCart();
}

// ---- drawer ----
function cartOpen() {
  CART_OPEN = true; renderCart();
  $id("cartOverlay").classList.add("open"); $id("cartDrawer").classList.add("open");
  document.body.classList.add("cart-lock");
  setTimeout(() => { const c = $id("cartClose"); if (c) c.focus({ preventScroll: true }); }, 60);
}
function cartCloseDrawer() {
  CART_OPEN = false; CART_DONE = null; CART_MSG = "";
  $id("cartOverlay").classList.remove("open"); $id("cartDrawer").classList.remove("open");
  document.body.classList.remove("cart-lock");
  renderCart();
  const f = $id("cartFab"); if (f) f.focus({ preventScroll: true });
}
function cartContinue() { cartCloseDrawer(); }

function cartInjectCss() {
  const st = document.createElement("style");
  st.textContent = `
.cart-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:2000;display:inline-flex;align-items:center;gap:10px;width:auto;margin:0;padding:12px 18px;border:0;border-radius:999px;background:#e3a72f;color:#1f2b44;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(31,43,68,.35);transition:transform .15s,box-shadow .15s}
.cart-fab:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(31,43,68,.4)}
.cart-fab:focus-visible,.cart-x:focus-visible{outline:3px solid rgba(227,167,47,.6);outline-offset:2px}
.cart-fab.bump{animation:cartBump .45s}
@keyframes cartBump{30%{transform:scale(1.12)}60%{transform:scale(.97)}}
.cf-count{min-width:24px;height:24px;padding:0 7px;border-radius:12px;background:#1f2b44;color:#fff;font-size:.8rem;display:inline-flex;align-items:center;justify-content:center}
.cart-overlay{position:fixed;inset:0;z-index:2001;background:rgba(15,20,32,.5);opacity:0;pointer-events:none;transition:opacity .22s}
.cart-overlay.open{opacity:1;pointer-events:auto}
.cart-drawer{position:fixed;top:0;right:0;bottom:0;z-index:2002;width:min(430px,100vw);display:flex;flex-direction:column;background:#fff;color:#1f2b44;box-shadow:-12px 0 40px rgba(0,0,0,.28);transform:translateX(102%);transition:transform .28s cubic-bezier(.2,.8,.2,1);visibility:hidden}
.cart-drawer.open{transform:none;visibility:visible}
html.dark-mode .cart-drawer{background:#1c2433;color:#eef1f7}
body.cart-lock{overflow:hidden}
.cart-head{display:flex;align-items:center;gap:10px;padding:16px 18px;padding-top:calc(16px + env(safe-area-inset-top,0px));border-bottom:1px solid rgba(128,128,128,.25)}
.cart-head h3{margin:0;flex:1;display:flex;align-items:center;gap:8px;font-size:1.15rem}
.cart-clear{width:auto;margin:0;background:none;border:0;font:inherit;font-size:.82rem;color:inherit;opacity:.65;text-decoration:underline;cursor:pointer}
.cart-clear:hover{opacity:1}
.cart-x{width:36px;height:36px;margin:0;padding:0;border-radius:50%;border:1.5px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:1.3rem;line-height:1;cursor:pointer}
.cart-x:hover{border-color:#e3a72f;background:rgba(227,167,47,.14)}
.cart-body{flex:1;overflow-y:auto;padding:4px 18px 16px;overscroll-behavior:contain}
.cart-line{display:grid;grid-template-columns:1fr auto;gap:8px 12px;padding:14px 0;border-bottom:1px solid rgba(128,128,128,.2)}
.cl-name{font-weight:700;line-height:1.25;word-break:break-word}
.cl-unit{display:block;font-size:.8rem;font-weight:400;opacity:.65;margin-top:2px}
.cl-price{font-weight:800;text-align:right;white-space:nowrap}
.cl-ctl{display:inline-flex;align-items:center;gap:4px;border:1.5px solid rgba(128,128,128,.35);border-radius:999px;padding:2px}
.cl-step{width:30px;height:30px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;font-size:1.1rem;font-weight:700;cursor:pointer}
.cl-step:hover:not(:disabled){background:rgba(227,167,47,.25)}
.cl-step:disabled{opacity:.3;cursor:default}
.cl-q{min-width:26px;text-align:center;font-weight:700}
.cl-rm{width:auto;margin:0;justify-self:end;align-self:center;background:none;border:0;padding:4px 2px;font:inherit;font-size:.82rem;color:#d8563f;cursor:pointer}
.cl-rm:hover{text-decoration:underline}
.cl-note{grid-column:1/-1;font-size:.78rem;opacity:.7}
.cart-pay{margin-top:16px}
.cart-pay .cc-paybar{margin:0}
.cart-empty,.cart-done{text-align:center;padding:48px 10px 20px}
.cart-empty svg{opacity:.35}
.cart-empty h4,.cart-done h4{margin:12px 0 4px;font-size:1.1rem}
.cart-empty p,.cart-done p{margin:0 0 16px;opacity:.7;font-size:.92rem}
.cd-check{width:64px;height:64px;margin:0 auto;border-radius:50%;background:#2e9d6a;color:#fff;font-size:2rem;font-weight:800;display:flex;align-items:center;justify-content:center;animation:cartPop .4s cubic-bezier(.2,1.4,.4,1)}
@keyframes cartPop{from{transform:scale(.3);opacity:0}}
.cd-list{list-style:none;margin:0 0 18px;padding:0;text-align:left;font-size:.92rem}
.cd-list li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(128,128,128,.18)}
.cart-foot{padding:14px 18px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(128,128,128,.25);background:inherit}
.cs-row{display:flex;justify-content:space-between;gap:10px;font-size:.92rem;padding:2px 0}
.cs-row.save{color:#2e9d6a;font-weight:600}
.cs-total{font-size:1.2rem;font-weight:800;padding-top:8px;margin-top:6px;border-top:1px dashed rgba(128,128,128,.4)}
.cs-sub{font-size:.8rem;opacity:.7;margin:4px 0 10px}
.cs-earn{font-size:.82rem;color:#2e9d6a;font-weight:600;margin:0 0 8px}
.cart-checkout{width:100%;margin:6px 0 0;min-height:48px;font-size:1.02rem}
.cart-checkout:disabled{opacity:.5;cursor:not-allowed}
.cart-foot .error-msg,.cart-foot .success-msg{margin:8px 0 0}
@media (max-width:520px){.cart-fab{right:12px}}
@media (prefers-reduced-motion:reduce){.cart-drawer,.cart-overlay,.cart-fab,.cd-check{transition:none;animation:none}}`;
  document.head.appendChild(st);
}

function cartBuildDom() {
  cartInjectCss();
  const fab = document.createElement("button");
  fab.type = "button"; fab.id = "cartFab"; fab.className = "cart-fab"; fab.setAttribute("aria-label", "Open cart"); fab.onclick = cartOpen;
  fab.innerHTML = `${icon("cart", 20)}<span>Cart</span><span class="cf-count" id="cartFabCount">0</span><span id="cartFabTotal"></span>`;
  const ov = document.createElement("div"); ov.id = "cartOverlay"; ov.className = "cart-overlay"; ov.onclick = cartCloseDrawer;
  const dr = document.createElement("aside"); dr.id = "cartDrawer"; dr.className = "cart-drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true"); dr.setAttribute("aria-label", "Your cart");
  dr.innerHTML = `
    <div class="cart-head"><h3>${icon("cart", 20)} Your cart</h3><button type="button" class="cart-clear" id="cartClearBtn" onclick="cartClear()">Clear</button><button type="button" class="cart-x" id="cartClose" aria-label="Close cart" onclick="cartCloseDrawer()">×</button></div>
    <div class="cart-body"><div id="cartLines"></div><div class="cart-pay" id="cartPay"></div></div>
    <div class="cart-foot" id="cartFoot"></div>`;
  document.body.append(fab, ov, dr);
  const pay = $id("storePayBar"); if (pay) $id("cartPay").appendChild(pay); // "Pay with" now lives in the cart
  document.addEventListener("keydown", e => { if (e.key === "Escape" && CART_OPEN) cartCloseDrawer(); });
}

function renderCart() {
  if (IS_TEACHER || !ME_CACHE || !CLS_CACHE || !$id("cartDrawer")) return;
  const lines = cartLines(), n = cartCount(), t = cartTotals(lines);
  $id("cartFabCount").textContent = n;
  $id("cartFabTotal").textContent = n ? fmtMoney(t.total) : "";
  $id("cartFab").setAttribute("aria-label", `Open cart, ${n} item${n === 1 ? "" : "s"}`);
  $id("cartClearBtn").classList.toggle("hidden", !n);
  const body = $id("cartLines"), foot = $id("cartFoot"), pay = $id("cartPay");

  if (CART_DONE && !n) {
    pay.classList.add("hidden");
    body.innerHTML = `<div class="cart-done"><div class="cd-check" aria-hidden="true">✓</div><h4>${CART_MSG ? "Part of your order went through" : "Purchase complete"}</h4>
      <p>${CART_DONE.total !== null ? `${fmtMoney(CART_DONE.total)} paid in one checkout.` : "These items are now yours."}</p>
      <ul class="cd-list">${CART_DONE.lines.map(l => `<li><span>${escapeHtml(l.name)}</span><strong>×${l.qty}</strong></li>`).join("")}</ul></div>`;
    foot.innerHTML = `${CART_MSG}<button type="button" class="btn gold cart-checkout" onclick="cartContinue()">Continue shopping</button>`;
    return;
  }
  pay.classList.remove("hidden");
  if (!n) {
    pay.classList.add("hidden");
    body.innerHTML = `<div class="cart-empty">${icon("cart", 48)}<h4>Your cart is empty</h4><p>Add items from the store and check out them all at once.</p></div>`;
    foot.innerHTML = `${CART_MSG}<button type="button" class="btn secondary cart-checkout" onclick="cartContinue()">Browse the store</button>`;
    return;
  }
  body.innerHTML = lines.map(l => {
    const it = l.it, max = cartStockMax(it), unit = cartPrice(it.price, 1, "");
    return `<div class="cart-line">
      <div class="cl-name">${escapeHtml(it.name)}<span class="cl-unit">${fmtMoney(unit)} each</span></div>
      <div class="cl-price">${fmtMoney(cartPrice(it.price, l.qty, ""))}</div>
      <div class="cl-ctl" role="group" aria-label="Quantity of ${escapeHtml(it.name)}">
        <button type="button" class="cl-step" aria-label="Decrease quantity" ${l.qty <= 1 ? "disabled" : ""} onclick="cartStep('${it.id}', -1)">−</button>
        <span class="cl-q">${l.qty}</span>
        <button type="button" class="cl-step" aria-label="Increase quantity" ${l.qty >= max ? "disabled" : ""} onclick="cartStep('${it.id}', 1)">+</button>
      </div>
      <button type="button" class="cl-rm" onclick="cartRemove('${it.id}')">Remove</button>
      ${l.qty >= max && max !== Infinity ? `<div class="cl-note">That's all ${max} we have in stock.</div>` : ""}
    </div>`;
  }).join("");

  // ---- footer: totals, can-I-afford-it check, checkout ----
  const card = cardIsActive(ME_CACHE) && CC_STORE_PAY.useCard, split = card && CC_STORE_PAY.split;
  const cash = Number(ME_CACHE.balance) || 0, plan = card ? cardPlanById(CLS_CACHE, ME_CACHE.creditCard.planId) : null;
  const cardAvail = plan ? cardAvailable(ME_CACHE.creditCard, plan) : 0;
  const cap = !card ? cash : split ? cardAvail + cash : cardAvail;
  const short = cardRound(t.total - cap), blocked = short > 0.004;
  const how = !card ? `Paying with cash · ${fmtMoney(cash)} available` : split ? "Paying part card, part cash" : `Paying by credit card · ${fmtMoney(cardAvail)} available`;
  let warn = "";
  if (blocked) warn = !card ? `You're ${fmtMoney(short)} short on cash. Remove something to check out.`
    : split ? `You're ${fmtMoney(short)} over your card and cash combined.` : `Your card can only cover ${fmtMoney(cardAvail)}. Turn on "Part card, part cash" or remove something.`;
  let earn = "";
  if (cartApi() && card && !split && plan && plan.rewardEvery > 0 && plan.rewardBack > 0) {
    const steps = Math.floor(t.total / plan.rewardEvery + 1e-9);
    earn = steps > 0 ? `You'll earn ${fmtMoney(steps * Math.min(plan.rewardBack, plan.rewardEvery))} back on this purchase.`
      : `Spend ${fmtMoney(cardRound(plan.rewardEvery - t.total))} more in this one purchase to earn ${fmtMoney(plan.rewardBack)} back.`;
  }
  foot.innerHTML = `
    <div class="cs-row"><span>${n} item${n === 1 ? "" : "s"}</span><span>${fmtMoney(t.sub)}</span></div>
    ${t.saved > 0.004 ? `<div class="cs-row save"><span>Voucher</span><span>−${fmtMoney(t.saved)}</span></div>` : ""}
    <div class="cs-row cs-total"><span>Total</span><span>${fmtMoney(t.total)}</span></div>
    <div class="cs-sub">${how}</div>
    ${earn ? `<div class="cs-earn">${earn}</div>` : ""}
    ${warn ? `<div class="error-msg">${warn}</div>` : ""}${CART_MSG}
    <button type="button" class="btn gold cart-checkout" onclick="checkoutCart()" ${blocked || CART_BUSY ? "disabled" : ""}>${CART_BUSY ? "Processing…" : `Check out · ${fmtMoney(t.total)}`}</button>`;
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
