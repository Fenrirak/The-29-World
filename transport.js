let CURRENT, IS_TEACHER, EDITING_ID = null;

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("car", 26) + " Transport";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add vehicle";
  document.getElementById("hMyVehicles").innerHTML = icon("car", 18) + " My vehicles";
  document.getElementById("hBrowse").innerHTML = icon("car", 18) + " Available vehicles";
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
  document.getElementById("myVehiclesPanel").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    autoPayDayIfDue(u.classCode),
    processAutomations(u.classCode),
    processMortgages(u.classCode),
    processTermDeposits(u.classCode),
    autoInterestIfDue(u.classCode),
    processInsurancePayments(u.classCode),
    processWeeklyEvents(u.classCode),
    processWeeklyBigEvents(u.classCode)
  ]);
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  const vehicles = cls.vehicles || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  if (!IS_TEACHER) {
    const mine = vehicles.filter(v => (v.owners || []).includes(me.username));
    const myList = document.getElementById("myVehiclesList");
    myList.innerHTML = "";
    document.getElementById("noMyVehicles").classList.toggle("hidden", mine.length > 0);
    mine.forEach(v => {
      const div = document.createElement("div");
      div.className = "card company-card";
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("car", 20)}${v.name}</h4>
            <p>${v.description || "No description provided."}</p>
            <p>${comfortStars(v.comfort)} comfort</p>
            <p><strong>${fmtMoney(v.price)}</strong> paid</p>
          </div>
          <div class="row-flex" style="gap:8px;">
            <button class="btn small secondary" onclick="sellMine('${v.id}')">Sell back</button>
          </div>
        </div>
      `;
      myList.appendChild(div);
    });
  }

  const list = document.getElementById("vehicleList");
  list.innerHTML = "";
  document.getElementById("noVehicles").classList.toggle("hidden", vehicles.length > 0);

  vehicles.forEach(v => {
    const owners = v.owners || [];
    const isMine = owners.includes(me.username);
    const ownedLabel = owners.length === 0 ? "Available"
      : `Owned by ${owners.length} student${owners.length === 1 ? "" : "s"}`;
    const ownerRows = IS_TEACHER && owners.length > 0
      ? `<div class="owner-list">${owners.map(o => `
          <div class="auto-row">
            <div class="auto-details">${nameOf(o)}</div>
            <button class="btn small secondary" onclick="forceSell('${v.id}','${o}')">Sell back</button>
          </div>`).join("")}</div>`
      : "";
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("car", 20)}${v.name} ${isMine ? '<span class="badge mint">Yours</span>' : ""}</h4>
          <p>${v.description || "No description provided."}</p>
          <p>${comfortStars(v.comfort)} comfort</p>
          <p><strong>${fmtMoney(v.price)}</strong> &middot; cash purchase only, unlimited stock</p>
          <p class="muted-small">${ownedLabel}</p>
          ${ownerRows}
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editVeh('${v.id}')">${icon("plus", 13)} Edit</button><button class="btn small coral" onclick="deleteVeh('${v.id}')">${icon("trash", 13)} Remove</button>`
            : isMine
              ? `<button class="btn small secondary" onclick="sellMine('${v.id}')">Sell back</button>`
              : `<button class="btn small gold" onclick="buyVeh('${v.id}')">Buy</button>`}
        </div>
      </div>
      <div id="msg-${v.id}"></div>
    `;
    list.appendChild(div);
  });
}

async function addProp(e) {
  e.preventDefault();
  const veh = {
    name: document.getElementById("hName").value.trim(),
    price: document.getElementById("hPrice").value,
    comfort: document.getElementById("hComfort").value,
    description: document.getElementById("hDesc").value.trim()
  };
  if (EDITING_ID) {
    await updateVehicle(CURRENT.classCode, EDITING_ID, veh);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Vehicle updated!</div>`;
    cancelEditVeh();
  } else {
    await addVehicle(CURRENT.classCode, veh);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Vehicle added!</div>`;
    ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("hComfort").value = 3;
  }
  await render();
  return false;
}

async function editVeh(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const veh = (cls.vehicles || []).find(v => v.id === id);
  if (!veh) return;
  EDITING_ID = id;
  document.getElementById("hName").value = veh.name;
  document.getElementById("hPrice").value = veh.price;
  document.getElementById("hComfort").value = veh.comfort;
  document.getElementById("hDesc").value = veh.description || "";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditVeh() {
  EDITING_ID = null;
  ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add vehicle";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function deleteVeh(id) {
  if (confirm("Remove this vehicle? Any owners will not be refunded automatically.")) {
    await removeVehicle(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id, username) {
  if (confirm("Sell this student's vehicle back to the class (they get 90% of price)?")) {
    await sellVehicle(CURRENT.classCode, id, username, 0.9);
    await render();
  }
}
async function sellMine(id) {
  if (confirm("Sell your vehicle back for 85% of its price?")) {
    await sellVehicle(CURRENT.classCode, id, CURRENT.username, 0.85);
    await render();
  }
}
async function buyVeh(id) {
  const res = await buyVehicle(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) {
    document.getElementById("msg-" + id).innerHTML = `<div class="error-msg">${res.error}</div>`;
    await render();
    return;
  }
  await render();
  // render() rebuilds the vehicle list (and wipes msg-<id> in the process),
  // so the success message is set *after* render and given its own timer
  // rather than being written pre-render, where it'd disappear instantly.
  const msgEl = document.getElementById("msg-" + id);
  if (msgEl) {
    msgEl.innerHTML = `<div class="success-msg">Congratulations, it's yours!</div>`;
    setTimeout(() => { msgEl.innerHTML = ""; }, 3000);
  }
}

document.addEventListener("DOMContentLoaded", init);
