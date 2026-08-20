let CURRENT, IS_TEACHER, EDITING_ID = null;

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function vehicleTypeLabel(type) {
  return type === "truck" ? "Truck" : type === "bike" ? "Bike/Scooter" : "Car";
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("car", 26) + " Transport";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add vehicle";
  document.getElementById("hMyVehicles").innerHTML = icon("car", 18) + " My vehicles";
  document.getElementById("hBrowse").innerHTML = icon("car", 18) + " Available vehicles";
  document.getElementById("hLicenceSettings").innerHTML = icon("car", 18) + " Truck licence";
  document.getElementById("hLicenceBuy").innerHTML = icon("car", 18) + " Truck licence";
  document.getElementById("hSellBack").innerHTML = icon("car", 18) + " Sell-back rates";
  document.getElementById("labStock").textContent = "Stock limit (leave blank for unlimited)";
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
  document.getElementById("licenceSettingsPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("sellBackPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("myVehiclesPanel").classList.toggle("hidden", IS_TEACHER);
  if (IS_TEACHER) onTypeChange();
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processMortgages(u.classCode), "processMortgages"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
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
  const licence = cls.truckLicence || { price: 0, description: "" };
  const hasTruckVehicle = vehicles.some(v => v.type === "truck");

  if (IS_TEACHER) {
    document.getElementById("lcPrice").value = licence.price || "";
    document.getElementById("lcDesc").value = licence.description || "";
    const rates = cls.sellBackRates || { car: 0.85, truck: 0.85, bike: 0.85 };
    document.getElementById("sbCar").value = Math.round((rates.car !== undefined ? rates.car : 0.85) * 100);
    document.getElementById("sbTruck").value = Math.round((rates.truck !== undefined ? rates.truck : 0.85) * 100);
    document.getElementById("sbBike").value = Math.round((rates.bike !== undefined ? rates.bike : 0.85) * 100);
  } else {
    // Only bother showing the licence card to students if there's actually
    // a truck listed (or they already hold the licence) — otherwise it's
    // just clutter in classes that don't use trucks.
    const showLicence = hasTruckVehicle || me.truckLicence;
    document.getElementById("licencePanel").classList.toggle("hidden", !showLicence);
    if (showLicence) {
      document.getElementById("licenceDesc").textContent = licence.description || "Required before buying a truck.";
      document.getElementById("licenceStatus").innerHTML = me.truckLicence
        ? `<span class="badge mint">Licenced</span>`
        : `<div class="flex-between"><strong>${fmtMoney(licence.price || 0)}</strong>
             <button class="btn small gold" onclick="buyLicence()">Buy licence</button></div><div id="licenceMsg"></div>`;
    }
  }

  if (!IS_TEACHER) {
    const mine = vehicles.filter(v => (v.owners || []).includes(me.username));
    const myList = document.getElementById("myVehiclesList");
    myList.innerHTML = "";
    document.getElementById("noMyVehicles").classList.toggle("hidden", mine.length > 0);
    const todayKey = nzDateKey();
    mine.forEach(v => {
      const isTruck = v.type === "truck";
      const drivenToday = isTruck && me.truckCheckins && me.truckCheckins[v.id] === todayKey;
      const div = document.createElement("div");
      div.className = "card company-card";
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("car", 20)}${v.name} <span class="muted-small">(${vehicleTypeLabel(v.type)})</span></h4>
            <p>${v.description || "No description provided."}</p>
            <p>${comfortStars(v.comfort)} comfort</p>
            <p><strong>${fmtMoney(v.price)}</strong> paid</p>
            ${isTruck ? `<p class="muted-small">Driving pays ${fmtMoney(v.drivePayout || 0)}/day &middot; ${drivenToday ? "already driven today" : "not driven today yet"}</p>` : ""}
          </div>
          <div class="row-flex" style="gap:8px;">
            ${isTruck ? `<button class="btn small gold" ${drivenToday ? "disabled" : ""} onclick="driveTruck('${v.id}')">${drivenToday ? "Driven today" : "Drive today"}</button>` : ""}
            <button class="btn small secondary" onclick="sellMine('${v.id}')">Sell back</button>
          </div>
        </div>
        <div id="drive-msg-${v.id}"></div>
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
    const hasLimit = v.stockLimit !== null && v.stockLimit !== undefined;
    const remaining = hasLimit ? Math.max(0, v.stockLimit - owners.length) : null;
    const soldOut = hasLimit && remaining <= 0;
    const needsLicence = v.type === "truck" && !IS_TEACHER && !me.truckLicence;
    const ownedLabel = owners.length === 0 ? "Available"
      : `Owned by ${owners.length} student${owners.length === 1 ? "" : "s"}`;
    const stockLabel = hasLimit
      ? (soldOut ? `Sold out (0 of ${v.stockLimit} left)` : `${remaining} of ${v.stockLimit} left`)
      : "Unlimited stock";
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
          <h4>${icon("car", 20)}${v.name} <span class="muted-small">(${vehicleTypeLabel(v.type)})</span> ${isMine ? '<span class="badge mint">Yours</span>' : ""}</h4>
          <p>${v.description || "No description provided."}</p>
          <p>${comfortStars(v.comfort)} comfort</p>
          <p><strong>${fmtMoney(v.price)}</strong> &middot; cash purchase only, ${stockLabel.toLowerCase()}</p>
          <p class="muted-small">${ownedLabel}</p>
          ${needsLicence ? `<p class="muted-small">Requires a truck licence — see above.</p>` : ""}
          ${ownerRows}
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editVeh('${v.id}')">${icon("plus", 13)} Edit</button><button class="btn small coral" onclick="deleteVeh('${v.id}')">${icon("trash", 13)} Remove</button>`
            : isMine
              ? `<button class="btn small secondary" onclick="sellMine('${v.id}')">Sell back</button>`
              : soldOut
                ? `<button class="btn small gold" disabled>Sold out</button>`
                : needsLicence
                  ? `<button class="btn small gold" disabled>Licence required</button>`
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
    description: document.getElementById("hDesc").value.trim(),
    type: document.getElementById("hType").value,
    drivePayout: document.getElementById("hPayout").value,
    stockLimit: document.getElementById("hStock").value.trim()
  };
  if (EDITING_ID) {
    await updateVehicle(CURRENT.classCode, EDITING_ID, veh);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Vehicle updated!</div>`;
    cancelEditVeh();
  } else {
    await addVehicle(CURRENT.classCode, veh);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Vehicle added!</div>`;
    ["hName","hPrice","hDesc","hStock"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("hComfort").value = 3;
    document.getElementById("hType").value = "car";
    document.getElementById("hPayout").value = 0;
    onTypeChange();
  }
  await render();
  return false;
}

function onTypeChange() {
  const isTruck = document.getElementById("hType").value === "truck";
  document.getElementById("hPayoutWrap").classList.toggle("hidden", !isTruck);
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
  document.getElementById("hType").value = veh.type || "car";
  document.getElementById("hPayout").value = veh.drivePayout || 0;
  onTypeChange();
  document.getElementById("hStock").value = (veh.stockLimit === null || veh.stockLimit === undefined) ? "" : veh.stockLimit;
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditVeh() {
  EDITING_ID = null;
  ["hName","hPrice","hDesc","hStock"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hType").value = "car";
  document.getElementById("hPayout").value = 0;
  onTypeChange();
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add vehicle";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function saveLicenceConfig() {
  const price = document.getElementById("lcPrice").value;
  const desc = document.getElementById("lcDesc").value.trim();
  await setTruckLicenceConfig(CURRENT.classCode, price, desc);
  document.getElementById("lcMsg").innerHTML = `<div class="success-msg">Licence settings saved!</div>`;
  await render();
}

async function saveSellBackRates() {
  const rates = {
    car: document.getElementById("sbCar").value,
    truck: document.getElementById("sbTruck").value,
    bike: document.getElementById("sbBike").value
  };
  await setSellBackRates(CURRENT.classCode, rates);
  document.getElementById("sbMsg").innerHTML = `<div class="success-msg">Sell-back rates saved!</div>`;
  await render();
}

async function buyLicence() {
  const res = await buyTruckLicence(CURRENT.username, CURRENT.classCode);
  const msgEl = document.getElementById("licenceMsg");
  if (!res.ok) {
    if (msgEl) msgEl.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  await render();
}

// Shared flow for a teacher-initiated removal that might warrant a refund:
// confirms the removal itself, then asks yes/no on a refund, and if yes,
// lets the teacher type the exact percentage. Returns a rate (0-1) to hand
// to the underlying sell function, or null if the teacher backed out.
function confirmRefundRate(removeQuestion, defaultPct) {
  if (!confirm(removeQuestion)) return null;
  const wantsRefund = confirm("Give the student a refund for this?\n\nOK = yes, refund some money\nCancel = no refund");
  if (!wantsRefund) return 0;
  const input = prompt("What percentage of the price should be refunded? (0-100)", String(defaultPct));
  if (input === null) return null;
  let pct = Number(input);
  if (isNaN(pct)) pct = defaultPct;
  pct = Math.max(0, Math.min(100, pct));
  return pct / 100;
}
async function deleteVeh(id) {
  if (confirm("Remove this vehicle? Any owners will not be refunded automatically.")) {
    await removeVehicle(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id, username) {
  const rate = confirmRefundRate("Sell this student's vehicle back to the class?", 90);
  if (rate === null) return;
  await sellVehicle(CURRENT.classCode, id, username, rate);
  await render();
}
async function sellMine(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const veh = (cls.vehicles || []).find(v => v.id === id);
  const rates = cls.sellBackRates || { car: 0.85, truck: 0.85, bike: 0.85 };
  const type = (veh && veh.type) || "car";
  const rate = rates[type] !== undefined ? rates[type] : 0.85;
  const pct = Math.round(rate * 100);
  if (confirm(`Sell your vehicle back for ${pct}% of its price?`)) {
    await sellVehicle(CURRENT.classCode, id, CURRENT.username);
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

async function driveTruck(vehId) {
  const res = await checkinTruckDrive(CURRENT.username, CURRENT.classCode, vehId);
  const msgEl = document.getElementById("drive-msg-" + vehId);
  if (!res.ok) {
    if (msgEl) msgEl.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  await render();
  const newMsgEl = document.getElementById("drive-msg-" + vehId);
  if (newMsgEl) {
    newMsgEl.innerHTML = `<div class="success-msg">Nice driving! You earned ${fmtMoney(res.amount)}.</div>`;
    setTimeout(() => { newMsgEl.innerHTML = ""; }, 3000);
  }
}

document.addEventListener("DOMContentLoaded", init);
