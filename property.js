let CURRENT, IS_TEACHER, EDITING_ID = null;

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("house", 26) + " Property";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
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
  // These 7 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 7 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  // Note: mortgage payments are NOT auto-deducted here (see payMortgage in
  // data.js) — students pay their own weekly installment on the due day.
  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processPropertyRent(u.classCode), "processPropertyRent"),
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

// Groups the flat list of per-unit property records into listings (all
// units sharing a groupId — see data.js). Properties saved before this
// feature existed have no groupId, so they fall back to being their own
// group of 1, exactly as before.
function groupProperties(props) {
  const order = [];
  const byGroup = new Map();
  props.forEach(p => {
    const gid = p.groupId || p.id;
    if (!byGroup.has(gid)) { byGroup.set(gid, []); order.push(gid); }
    byGroup.get(gid).push(p);
  });
  return order.map(gid => byGroup.get(gid));
}

async function render() {
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  const props = cls.properties || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  const list = document.getElementById("propList");
  list.innerHTML = "";
  document.getElementById("noProps").classList.toggle("hidden", props.length > 0);

  const groups = groupProperties(props);
  // Students see their own home(s) first — everything else keeps its
  // original (teacher-set) order after that. Array.sort is stable, so this
  // only ever moves "owned by me" groups up, never reshuffles the rest.
  // Teachers never own a unit, so this is a no-op for the teacher view.
  if (!IS_TEACHER) {
    groups.sort((a, b) => {
      const aMine = a.some(u => u.owner === me.username) ? 0 : 1;
      const bMine = b.some(u => u.owner === me.username) ? 0 : 1;
      return aMine - bMine;
    });
  }

  groups.forEach(units => {
    const p = units[0]; // shared listing fields (name/price/comfort/etc) come from any unit
    const gid = p.groupId || p.id;
    const owned = units.filter(u => u.owner);
    const available = units.filter(u => !u.owner);
    const myUnit = units.find(u => u.owner === me.username);

    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("house", 20)}${p.name} ${myUnit ? '<span class="badge mint">Your home</span>' : ""}</h4>
          <p>${p.description || "No description provided."}</p>
          <p>${comfortStars(p.comfort)} comfort</p>
          <p><strong>${fmtMoney(p.price)}</strong> ${p.mortgageWeeks > 0 ? `&middot; mortgage available over ${p.mortgageWeeks} weeks, due ${DAY_FULL[cls.mortgageDay || "Fri"]}s${p.mortgageInterestRate > 0 ? ` (+${p.mortgageInterestRate}%/week interest)` : ""}` : "&middot; cash purchase only"}
            ${p.rentPerWeek > 0 ? `&middot; rentable for ${fmtMoney(p.rentPerWeek)}/week` : ""}</p>
          <p class="muted-small">${units.length > 1 ? `${available.length} of ${units.length} available` : (available.length > 0 ? "Available" : `Owned by ${nameOf(owned[0].owner)}`)}</p>
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editProp('${p.id}')">${icon("plus", 13)} Edit</button><button class="btn small coral" onclick="deleteProp('${p.id}')">${icon("trash", 13)} Remove</button>`
            : (!myUnit && available.length > 0
                ? `<button class="btn small gold" onclick="buyOutright('${gid}')">Buy cash</button>
                   ${p.mortgageWeeks > 0 ? `<button class="btn small secondary" onclick="buyFinanced('${gid}')">Finance (10% deposit)</button>` : ""}`
                : "")}
        </div>
      </div>
      <div id="msg-${gid}"></div>
      ${owned.map(u => ownedUnitBlock(u, u.owner === me.username, cls, nameOf)).join("")}
    `;
    list.appendChild(div);
  });
}

// Renders one owned unit's status/actions within a listing card — mortgage
// info, default warning, occupancy choice, and (teacher-only / owner-only)
// sell-back controls. Each owned unit still tracks its own mortgage and
// occupancy independently even when several students own units from the
// same listing.
function ownedUnitBlock(p, isMine, cls, nameOf) {
  const who = isMine ? "You" : nameOf(p.owner);
  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p class="muted-small"><strong>${who}</strong> ${p.mortgage ? `— mortgage: ${fmtMoney(p.mortgage.weeklyPayment)}/week${p.mortgage.interestRate > 0 ? ` + ${p.mortgage.interestRate}% interest` : ""}, ${p.mortgage.weeksLeft} week${p.mortgage.weeksLeft === 1 ? "" : "s"} left, due ${DAY_FULL[cls.mortgageDay || "Fri"]}` : ""}</p>
      ${isMine && p.mortgageDefault ? `<p style="color:#b42318;"><strong>${icon("house", 13)} Your mortgage term ended on ${p.mortgageDefault.endedDate} without being fully paid off — you still owe ${fmtMoney(p.mortgageDefault.amountOwed)}.</strong></p>` : ""}
      ${isMine && p.mortgage ? mortgagePayBlock(p, cls) : ""}
      ${occupancyBlock(p, isMine)}
      <div class="row-flex" style="gap:8px;margin-top:6px;">
        ${IS_TEACHER ? `<button class="btn small secondary" onclick="forceSell('${p.id}')">Sell back (${who})</button>` : (isMine ? `<button class="btn small secondary" onclick="sellMine('${p.id}')">Sell back</button>` : "")}
      </div>
    </div>`;
}

// Renders the "living in it / rented out" status + choice for an owned
// property. Only the owner sees the choice buttons — everyone else just
// sees whether the property is currently occupied or rented out.
function occupancyBlock(p, isMine) {
  if (!isMine) {
    if (p.occupancy === "living") return `<p class="muted-small">${icon("house", 13)} Owner is living here.</p>`;
    if (p.occupancy === "rented") return `<p class="muted-small">This property is currently rented out.</p>`;
    return "";
  }
  if (p.occupancy === "living") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("house", 14)} You're living here</strong> — your lifestyle rating gets a +5 bonus (property category) while you live in it. You're not collecting rent.</p>
        ${p.rentPerWeek > 0 ? `<button class="btn small secondary" onclick="chooseOccupancy('${p.id}','rented')">Rent it out instead</button>` : `<p class="muted-small">Your teacher hasn't set a rent amount for this property, so it can't be rented out yet.</p>`}
      </div>`;
  }
  if (p.occupancy === "rented") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("coin", 14)} Rented out</strong> — you're earning ${fmtMoney(p.rentPerWeek)}/week, paid every ${DAY_FULL[p.rentDay || "Fri"]}. You're not getting the living-in-it lifestyle bonus.</p>
        <button class="btn small secondary" onclick="chooseOccupancy('${p.id}','living')">Move in instead</button>
      </div>`;
  }
  // Owned but no choice made yet — explain the consequences of both
  // options up front before the student picks either one.
  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p><strong>Live in it, or rent it out?</strong></p>
      <p class="muted-small">Live in it: no rent income, but +5 to your lifestyle rating (property category) while you live there.<br>
      Rent it out: ${p.rentPerWeek > 0 ? `${fmtMoney(p.rentPerWeek)}/week, paid every ${DAY_FULL[p.rentDay || "Fri"]}` : "your teacher hasn't set a rent amount yet"} — but no lifestyle bonus, only the property's base comfort rating counts.<br>
      You can change your mind at any time.</p>
      <div class="row-flex" style="gap:8px;">
        <button class="btn small gold" onclick="chooseOccupancy('${p.id}','living')">Live in it</button>
        ${p.rentPerWeek > 0 ? `<button class="btn small secondary" onclick="chooseOccupancy('${p.id}','rented')">Rent it out</button>` : ""}
      </div>
    </div>`;
}

// Shows this week's mortgage-payment status for the owner, and — only on
// the exact due day, for the exact due week — a button to pay it manually
// instead of waiting for the automatic weekly job. There's never an amount
// to type in: the weekly installment (+ interest) is fixed by the mortgage
// itself, same figure the automatic job would charge.
function mortgagePayBlock(p, cls) {
  const mortgageDayName = DAY_FULL[cls.mortgageDay || "Fri"];
  const weekKey = isoWeekKey(new Date());
  const purchaseWeek = p.mortgage.purchaseWeekKey === weekKey;
  const alreadyPaid = p.mortgage.lastWeekPaid === weekKey;
  const isDueToday = (cls.mortgageDay || "Fri") === nzDayName();

  let status, canPay = false;
  if (purchaseWeek) {
    status = `Your first payment isn't due yet — the week you bought is free.`;
  } else if (alreadyPaid) {
    status = `${icon("house", 13)} This week's payment is already sorted.`;
  } else if (!isDueToday) {
    status = `Mortgage payments are due every ${mortgageDayName} — come back then to pay this week's installment yourself.`;
  } else {
    status = `This week's payment is due today.`;
    canPay = true;
  }

  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p class="muted-small">${status}</p>
      ${canPay ? `<button class="btn small gold" onclick="payMortgageClick('${p.id}')">${icon("send", 13)} Pay this week's mortgage</button>` : ""}
      <div id="mortgageMsg-${p.id}"></div>
    </div>`;
}

async function payMortgageClick(id) {
  const res = await payMortgage(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) {
    const box = document.getElementById(`mortgageMsg-${id}`);
    if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  await render();
}

async function chooseOccupancy(id, choice) {
  const msg = choice === "living"
    ? "Live in this property?\n\nYou'll get a +5 bonus to your lifestyle rating (property category) while you live here, but you won't receive any rent. You can switch to renting it out again at any time."
    : "Rent this property out?\n\nYou'll receive weekly rent instead of living here, but you will NOT get the +5 lifestyle bonus for living in it — only the property's base comfort rating will count toward your lifestyle rating. You can move back in at any time.";
  if (!confirm(msg)) return;
  const res = await setPropertyOccupancy(CURRENT.username, CURRENT.classCode, id, choice);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

async function addProp(e) {
  e.preventDefault();
  const prop = {
    name: document.getElementById("hName").value.trim(),
    price: document.getElementById("hPrice").value,
    comfort: document.getElementById("hComfort").value,
    quantity: document.getElementById("hQuantity").value,
    mortgageWeeks: document.getElementById("hMortgage").value,
    mortgageInterestRate: document.getElementById("hMortgageRate").value,
    description: document.getElementById("hDesc").value.trim(),
    rentPerWeek: document.getElementById("hRent").value,
    rentDay: document.getElementById("hRentDay").value
  };
  if (EDITING_ID) {
    await updateProperty(CURRENT.classCode, EDITING_ID, prop);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Property updated!</div>`;
    cancelEditProp();
  } else {
    await addProperty(CURRENT.classCode, prop);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Property added!</div>`;
    ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("hComfort").value = 3;
    document.getElementById("hQuantity").value = 1;
    document.getElementById("hMortgage").value = 0;
    document.getElementById("hMortgageRate").value = 0;
    document.getElementById("hRent").value = 0;
    document.getElementById("hRentDay").value = "Fri";
  }
  await render();
  return false;
}

// id is any unit's id within the listing — edits apply to the whole
// group (see updateProperty in data.js). Quantity shown is how many
// units currently exist in that group.
async function editProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const props = cls.properties || [];
  const prop = props.find(p => p.id === id);
  if (!prop) return;
  const gid = prop.groupId || prop.id;
  const groupSize = props.filter(p => (p.groupId || p.id) === gid).length;
  EDITING_ID = id;
  document.getElementById("hName").value = prop.name;
  document.getElementById("hPrice").value = prop.price;
  document.getElementById("hComfort").value = prop.comfort;
  document.getElementById("hQuantity").value = groupSize;
  document.getElementById("hMortgage").value = prop.mortgageWeeks || 0;
  document.getElementById("hMortgageRate").value = prop.mortgageInterestRate || 0;
  document.getElementById("hDesc").value = prop.description || "";
  document.getElementById("hRent").value = prop.rentPerWeek || 0;
  document.getElementById("hRentDay").value = prop.rentDay || "Fri";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditProp() {
  EDITING_ID = null;
  ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hQuantity").value = 1;
  document.getElementById("hMortgage").value = 0;
  document.getElementById("hMortgageRate").value = 0;
  document.getElementById("hRent").value = 0;
  document.getElementById("hRentDay").value = "Fri";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function deleteProp(id) {
  if (confirm("Remove this property listing (all units of it)? Any owners will not be refunded automatically.")) {
    await removeProperty(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id) {
  if (confirm("Sell this property back to the class (owner gets 90% of price)?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
async function sellMine(id) {
  if (confirm("Sell your property back for 90% of its price?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
// gid is a listing's groupId — picks whichever unit in that listing is
// still unowned (fresh read, to keep the race window with another buyer
// as small as possible) and buys that specific unit.
async function pickAvailableUnitId(gid) {
  const cls = await getClassCached(CURRENT.classCode);
  const unit = (cls.properties || []).find(p => (p.groupId || p.id) === gid && !p.owner);
  return unit ? unit.id : null;
}
async function buyOutright(gid) {
  const id = await pickAvailableUnitId(gid);
  if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, false);
  document.getElementById("msg-" + gid).innerHTML = res.ok ? `<div class="success-msg">Congratulations, it's yours!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}
async function buyFinanced(gid) {
  const id = await pickAvailableUnitId(gid);
  if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, true);
  document.getElementById("msg-" + gid).innerHTML = res.ok ? `<div class="success-msg">Financed! Weekly payments will come out automatically.</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
