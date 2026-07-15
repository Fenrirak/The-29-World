let CURRENT, IS_TEACHER;

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
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("cart", 20)}${it.name} ${owned ? `<span class="badge mint">Owned ×${owned}</span>` : ""}</h4>
          <p>${it.description || "No description provided."}</p>
          ${it.effect ? `<p class="muted-small">Does: ${it.effect}</p>` : ""}
          <p><strong>${fmtMoney(it.price)}</strong> ${starsHtml(it.stars)}</p>
          <p class="muted-small">${it.stock === null ? "Unlimited stock" : `${it.stock} left in stock`}</p>
        </div>
        <div>
          ${IS_TEACHER
            ? `<button class="btn small coral" onclick="deleteItem('${it.id}')">${icon("trash", 13)} Remove</button>`
            : `<button class="btn small gold" ${outOfStock ? "disabled" : ""} onclick="buyItem('${it.id}')">${icon("cart", 13)} ${outOfStock ? "Out of stock" : "Buy"}</button>`}
        </div>
      </div>
      <div id="msg-${it.id}"></div>
    `;
    list.appendChild(div);
  });
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
