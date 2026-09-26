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
  document.getElementById("hTransportSettings").innerHTML = icon("repeat", 18) + " Weekly transport expenses";
  document.getElementById("hTransportExpenses").innerHTML = icon("repeat", 18) + " Weekly transport expenses";
  document.getElementById("hLifeFeeOverrides").innerHTML = icon("trophy", 18) + " Public transport fee by life event";
  document.getElementById("labStock").textContent = "Stock limit (leave blank for unlimited)";
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
  document.getElementById("transportSettingsPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("lifeFeeOverridesPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("transportExpensesPanel").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("myVehiclesPanel").classList.toggle("hidden", IS_TEACHER);
  if (IS_TEACHER) onTypeChange();
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
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
    const ptf = cls.publicTransportFee || { amount: 0, description: "" };
    document.getElementById("ptfAmount").value = ptf.amount || "";
    document.getElementById("ptfDesc").value = ptf.description || "";
    document.getElementById("transportDaySelect").value = cls.transportDay || "Fri";

    // One row per life event template currently defined in the Life
    // module, pre-filled with its current fee override (blank = none, so
    // that life event just uses the flat fee above). Rebuilt fresh every
    // render so a life event added/renamed/removed elsewhere shows up
    // here without needing its own separate sync logic.
    const lifeItemsForFees = cls.lifeItems || [];
    const feeOverrides = cls.publicTransportFeeOverrides || {};
    document.getElementById("noLifeItemsForFees").classList.toggle("hidden", lifeItemsForFees.length > 0);
    document.getElementById("lifeFeeSaveBtn").classList.toggle("hidden", lifeItemsForFees.length === 0);
    document.getElementById("lifeFeeOverridesBody").innerHTML = lifeItemsForFees.map(it => `
      <div class="auto-row">
        <div class="auto-details">${escapeHtml(it.name)}</div>
        <input id="lifeFee-${it.id}" type="number" min="0" step="0.01" placeholder="Flat fee" style="max-width:140px;"
          value="${feeOverrides[it.id] !== undefined ? feeOverrides[it.id] : ""}">
      </div>
    `).join("");
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
             <button class="btn small gold" id="buyLicenceBtn" onclick="buyLicence()">Buy licence</button></div><div id="licenceMsg"></div>`;
    }
    renderTransportExpenses(me, cls);
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
            <h4>${icon("car", 20)}${escapeHtml(v.name)} <span class="muted-small">(${vehicleTypeLabel(v.type)})</span></h4>
            <p>${escapeHtml(v.description) || "No description provided."}</p>
            <p>${comfortStars(v.comfort)} comfort</p>
            <p><strong>${fmtMoney(v.price)}</strong> paid</p>
            ${isTruck ? `<p class="muted-small">Driving pays ${fmtMoney(v.drivePayout || 0)}/day &middot; ${drivenToday ? "already driven today" : "not driven today yet"}</p>` : ""}
            ${(v.weeklyExpense > 0 || v.publicTransportOffsetPct > 0) ? `<p class="muted-small">${v.weeklyExpense > 0 ? `${fmtMoney(v.weeklyExpense)}/week upkeep` : ""}${v.weeklyExpense > 0 && v.publicTransportOffsetPct > 0 ? " &middot; " : ""}${v.publicTransportOffsetPct > 0 ? `knocks ${v.publicTransportOffsetPct}% off your public transport fee` : ""}</p>` : ""}
          </div>
          <div class="row-flex" style="gap:8px;">
            ${isTruck ? `<button class="btn small gold" id="driveBtn-${v.id}" ${drivenToday ? "disabled" : ""} onclick="driveTruck('${v.id}')">${drivenToday ? "Driven today" : "Drive today"}</button>` : ""}
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

  const ownsAnyTruck = !IS_TEACHER && vehicles.some(v => v.type === "truck" && (v.owners || []).includes(me.username));

  vehicles.forEach(v => {
    const owners = v.owners || [];
    const isMine = owners.includes(me.username);
    const hasLimit = v.stockLimit !== null && v.stockLimit !== undefined;
    const remaining = hasLimit ? Math.max(0, v.stockLimit - owners.length) : null;
    const soldOut = hasLimit && remaining <= 0;
    const needsLicence = v.type === "truck" && !IS_TEACHER && !me.truckLicence;
    const truckLimitReached = v.type === "truck" && !IS_TEACHER && !isMine && ownsAnyTruck;
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
          <h4>${icon("car", 20)}${escapeHtml(v.name)} <span class="muted-small">(${vehicleTypeLabel(v.type)})</span> ${isMine ? '<span class="badge mint">Yours</span>' : ""}</h4>
          <p>${escapeHtml(v.description) || "No description provided."}</p>
          <p>${comfortStars(v.comfort)} comfort</p>
          <p>${priceWithLifeDiscount(me, "transport", v.price)} &middot; cash purchase only, ${stockLabel.toLowerCase()}</p>
          <p class="muted-small">${ownedLabel}</p>
          ${(v.weeklyExpense > 0 || v.publicTransportOffsetPct > 0) ? `<p class="muted-small">${v.weeklyExpense > 0 ? `${fmtMoney(v.weeklyExpense)}/week upkeep` : ""}${v.weeklyExpense > 0 && v.publicTransportOffsetPct > 0 ? " &middot; " : ""}${v.publicTransportOffsetPct > 0 ? `knocks ${v.publicTransportOffsetPct}% off public transport` : ""}</p>` : ""}
          ${needsLicence ? `<p class="muted-small">Requires a truck licence — see above.</p>` : ""}
          ${truckLimitReached ? `<p class="muted-small">You can only own one truck at a time.</p>` : ""}
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
                  : truckLimitReached
                    ? `<button class="btn small gold" disabled>One truck max</button>`
                    : `<button class="btn small gold" id="buyVehBtn-${v.id}" onclick="buyVeh('${v.id}')">Buy</button>`}
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
    weeklyExpense: document.getElementById("hWeeklyExpense").value,
    publicTransportOffsetPct: document.getElementById("hPublicOffset").value,
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
    document.getElementById("hWeeklyExpense").value = 0;
    document.getElementById("hPublicOffset").value = 0;
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
  document.getElementById("hWeeklyExpense").value = veh.weeklyExpense || 0;
  document.getElementById("hPublicOffset").value = veh.publicTransportOffsetPct || 0;
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
  document.getElementById("hWeeklyExpense").value = 0;
  document.getElementById("hPublicOffset").value = 0;
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
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("buyLicenceBtn");
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await buyTruckLicence(CURRENT.username, CURRENT.classCode);
    const msgEl = document.getElementById("licenceMsg");
    if (!res.ok) {
      if (msgEl) msgEl.innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
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
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("buyVehBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
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
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Guards autoSettleZeroTransport below against firing twice while its
// await is in flight (e.g. two renders back-to-back before the first
// write lands) — same shape as the disabled-button double-tap guards
// used elsewhere in this file, just for a call render() triggers itself
// rather than a click.
let TRANSPORT_AUTO_SETTLING = false;
// A student with $0 net transport expense (fee fully offset by a vehicle,
// or no fee set) still needs transportLastWeekPaid marked so they don't
// show as overdue next render — but there's nothing to actually charge,
// so this settles it the same way payTransportExpenses always has,
// without making the student click a "Pay now — $0.00" button first.
async function autoSettleZeroTransport() {
  if (TRANSPORT_AUTO_SETTLING) return;
  TRANSPORT_AUTO_SETTLING = true;
  try {
    await payTransportExpenses(CURRENT.username, CURRENT.classCode);
  } finally {
    TRANSPORT_AUTO_SETTLING = false;
  }
  await render();
}

function renderTransportExpenses(me, cls) {
  const amt = transportWeeklyAmount(cls, me);
  const dueDay = cls.transportDay || "Fri";
  const weekKey = isoWeekKey(new Date());
  const paidThisWeek = me.transportLastWeekPaid === weekKey;
  const overdue = isTransportPaymentOverdue(me, cls);
  const isDueToday = nzDayName() === dueDay;

  let statusBadge, actionHtml;
  if (paidThisWeek) {
    statusBadge = `<span class="badge mint">${icon("car", 12)}Paid this week</span>`;
    actionHtml = `<p class="muted-small">All sorted — next payment due ${DAY_FULL[dueDay]}.</p>`;
  } else if (amt.total === 0 && isDueToday) {
    // Nothing owed this cycle — settle it in the background (see
    // autoSettleZeroTransport) instead of asking for a click on a $0 charge.
    autoSettleZeroTransport();
    statusBadge = `<span class="badge mint">${icon("car", 12)}Paid this week</span>`;
    actionHtml = `<p class="muted-small">Nothing owed this week — next check ${DAY_FULL[dueDay]}.</p>`;
  } else if (overdue) {
    statusBadge = `<span class="badge coral">${icon("car", 12)}Overdue</span>`;
    actionHtml = isDueToday
      ? `<button class="btn gold" id="payTransportBtn" onclick="payTransport()">Pay now — ${fmtMoney(amt.total)}</button>`
      : `<p class="muted-small">A past payment was missed — check with your teacher. You can pay again on ${DAY_FULL[dueDay]}.</p>`;
  } else if (isDueToday) {
    statusBadge = `<span class="badge gold">${icon("car", 12)}Due today</span>`;
    actionHtml = `<button class="btn gold" id="payTransportBtn" onclick="payTransport()">Pay now — ${fmtMoney(amt.total)}</button>`;
  } else {
    statusBadge = `<span class="badge navy">${icon("car", 12)}Not due yet</span>`;
    actionHtml = `<p class="muted-small">Next payment due ${DAY_FULL[dueDay]}.</p>`;
  }

  const lines = [];
  if (amt.vehicle && amt.vehicleExpense > 0) {
    lines.push(`<p>${escapeHtml(amt.vehicle.name)} upkeep &middot; <strong>${fmtMoney(amt.vehicleExpense)}</strong></p>`);
  }
  lines.push(`<p>Public transport fee${amt.lifeFeeName ? ` <span class="muted-small">(${escapeHtml(amt.lifeFeeName)} rate)</span>` : ""}${amt.publicFeeOffset > 0 ? ` <span class="muted-small">(${fmtMoney(amt.publicFeeBase)} − ${fmtMoney(amt.publicFeeOffset)} vehicle discount)</span>` : ""} &middot; <strong>${fmtMoney(amt.publicFeeDue)}</strong></p>`);

  document.getElementById("transportExpensesBody").innerHTML = `
    <div class="flex-between" style="align-items:flex-start;">
      <div>${lines.join("")}</div>
      <div style="text-align:right;">
        <div style="font-size:1.4em;font-weight:700;">${fmtMoney(amt.total)}</div>
        ${statusBadge}
      </div>
    </div>
    <div style="margin-top:10px;">${actionHtml}</div>
    <div id="transportPayMsg"></div>
  `;
}

async function payTransport() {
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("payTransportBtn");
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await payTransportExpenses(CURRENT.username, CURRENT.classCode);
    const msgEl = document.getElementById("transportPayMsg");
    if (!res.ok) {
      if (msgEl) msgEl.innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    await render();
    // render() rebuilds transportExpensesBody (and wipes transportPayMsg in the
    // process), so the success message is set *after* render, same pattern as
    // buyVeh's msg-<id> handling above.
    const newMsgEl = document.getElementById("transportPayMsg");
    if (newMsgEl) {
      newMsgEl.innerHTML = `<div class="success-msg">Paid ${fmtMoney(res.amount)} for this week's transport.</div>`;
      setTimeout(() => { newMsgEl.innerHTML = ""; }, 3000);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveTransportSettings() {
  const amount = document.getElementById("ptfAmount").value;
  const desc = document.getElementById("ptfDesc").value.trim();
  const day = document.getElementById("transportDaySelect").value;
  await setPublicTransportFee(CURRENT.classCode, amount, desc);
  await setTransportDay(CURRENT.classCode, day);
  document.getElementById("ptfMsg").innerHTML = `<div class="success-msg">Transport settings saved!</div>`;
  await render();
}

async function saveLifeFeeOverrides() {
  const cls = await getClassCached(CURRENT.classCode);
  const existing = cls.publicTransportFeeOverrides || {};
  const overrides = {};
  // Only life items that currently exist get carried into the new map (so
  // one removed elsewhere is correctly dropped), but if a life item's row
  // isn't actually in the DOM right now for some reason, fall back to its
  // existing saved value instead of wiping it — the save button should
  // never erase an override it never showed the teacher.
  (cls.lifeItems || []).forEach(it => {
    const el = document.getElementById(`lifeFee-${it.id}`);
    overrides[it.id] = el ? el.value : existing[it.id];
  });
  await setPublicTransportFeeOverrides(CURRENT.classCode, overrides);
  document.getElementById("lifeFeeMsg").innerHTML = `<div class="success-msg">Life event fees saved!</div>`;
  await render();
}

async function driveTruck(vehId) {
  // Same double-tap guard as buy() in market.js — the disabled-after-
  // driven-today state baked into the button's markup only covers days
  // after the first successful drive; it doesn't stop a fast double-tap
  // on the very click that's currently in flight.
  const btn = document.getElementById("driveBtn-" + vehId);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
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
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
