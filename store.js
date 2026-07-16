let CURRENT, IS_TEACHER;
let ITEMS_CACHE = [];

function starsHtml(n) {
  n = Number(n) || 0;
  return n > 0 ? `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : "";
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("cart", 26) + " Class Store";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an item";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add item";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
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
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processWeeklyEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);
  const items = cls.storeItems || [];

  const list = document.getElementById("itemList");
  list.innerHTML = "";
  document.getElementById("noItems").classList.toggle("hidden", items.length > 0);

  const ownedCounts = {};
  (me.storeItems || []).forEach(id => { ownedCounts[id] = (ownedCounts[id] || 0) + 1; });

  items.forEach(it => {
    const outOfStock = it.stock !== null && it.stock <= 0;
    const owned = ownedCounts[it.id] || 0;
    const div = document.createElement("div");
    div.className = "card company-card";
    div.id = "item-" + it.id;
    div.innerHTML = `
      <div class="flex-between" id="view-${it.id}">
        <div>
          <h4>${icon("cart", 20)}${it.name} ${owned ? `<span class="badge mint">Owned ×${owned}</span>` : ""}</h4>
          <p>${it.description || "No description provided."}</p>
          ${it.effect ? `<p class="muted-small">Does: ${it.effect}</p>` : ""}
          <p><strong>${fmtMoney(it.price)}</strong> ${starsHtml(it.stars)}</p>
          <p class="muted-small">${it.stock === null ? "Unlimited stock" : `${it.stock} left in stock`}</p>
        </div>
        <div>
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editItem('${it.id}')">${icon("plus", 13)} Edit</button>
               <button class="btn small coral" onclick="deleteItem('${it.id}')">${icon("trash", 13)} Remove</button>`
            : `<button class="btn small gold" ${outOfStock ? "disabled" : ""} onclick="buyItem('${it.id}')">${icon("cart", 13)} ${outOfStock ? "Out of stock" : "Buy"}</button>`}
        </div>
      </div>
      <div id="edit-${it.id}" class="hidden"></div>
      <div id="msg-${it.id}"></div>
    `;
    list.appendChild(div);
  });
  ITEMS_CACHE = items;
}

async function addItem(e) {
  e.preventDefault();
  const item = {
    name: document.getElementById("iName").value.trim(),
    price: document.getElementById("iPrice").value,
    stock: document.getElementById("iStock").value,
    effect: document.getElementById("iEffect").value.trim(),
    description: document.getElementById("iDesc").value.trim(),
    stars: document.getElementById("iStars").value
  };
  await addStoreItem(CURRENT.classCode, item);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Item added!</div>`;
  ["iName","iPrice","iStock","iEffect","iDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("iStars").value = 0;
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
        <input id="e-stock-${id}" type="number" min="0" step="1" value="${it.stock === null ? "" : it.stock}">
      </div>
    </div>
    <label>What it does</label>
    <input id="e-effect-${id}" value="${(it.effect || "").replace(/"/g, "&quot;")}">
    <label>Description</label>
    <input id="e-desc-${id}" value="${(it.description || "").replace(/"/g, "&quot;")}">
    <label>Lifestyle stars (0-5)</label>
    <input id="e-stars-${id}" type="number" min="0" max="5" step="1" value="${it.stars || 0}">
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
    stars: document.getElementById("e-stars-" + id).value
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

async function buyItem(id) {
  const res = await buyStoreItem(CURRENT.username, CURRENT.classCode, id);
  document.getElementById("msg-" + id).innerHTML = res.ok
    ? `<div class="success-msg">Purchased!</div>`
    : `<div class="error-msg">${res.error}</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
