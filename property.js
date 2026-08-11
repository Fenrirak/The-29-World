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
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    autoPayDayIfDue(u.classCode),
    processAutomations(u.classCode),
    processMortgages(u.classCode),
    processPropertyRent(u.classCode),
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
  const props = cls.properties || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  const list = document.getElementById("propList");
  list.innerHTML = "";
  document.getElementById("noProps").classList.toggle("hidden", props.length > 0);

  props.forEach(p => {
    const isMine = p.owner === me.username;
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("house", 20)}${p.name} ${isMine ? '<span class="badge mint">Your home</span>' : ""}</h4>
          <p>${p.description || "No description provided."}</p>
          <p>${comfortStars(p.comfort)} comfort</p>
          <p><strong>${fmtMoney(p.price)}</strong> ${p.mortgageWeeks > 0 ? `&middot; mortgage available over ${p.mortgageWeeks} weeks` : "&middot; cash purchase only"}
            ${p.rentPerWeek > 0 ? `&middot; rentable for ${fmtMoney(p.rentPerWeek)}/week` : ""}</p>
          <p class="muted-small">${p.owner ? `Owned by ${nameOf(p.owner)}` : "Available"}
            ${p.owner && p.mortgage ? ` — mortgage: ${fmtMoney(p.mortgage.weeklyPayment)}/week, ${p.mortgage.weeksLeft} weeks left` : ""}</p>
          ${p.owner ? occupancyBlock(p, isMine) : ""}
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editProp('${p.id}')">${icon("plus", 13)} Edit</button>${p.owner ? `<button class="btn small secondary" onclick="forceSell('${p.id}')">Sell back</button>` : ""}<button class="btn small coral" onclick="deleteProp('${p.id}')">${icon("trash", 13)} Remove</button>`
            : p.owner
              ? (isMine ? `<button class="btn small secondary" onclick="sellMine('${p.id}')">Sell back</button>` : "")
              : `<button class="btn small gold" onclick="buyOutright('${p.id}')">Buy cash</button>
                 ${p.mortgageWeeks > 0 ? `<button class="btn small secondary" onclick="buyFinanced('${p.id}')">Finance (10% deposit)</button>` : ""}`}
        </div>
      </div>
      <div id="msg-${p.id}"></div>
    `;
    list.appendChild(div);
  });
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
    mortgageWeeks: document.getElementById("hMortgage").value,
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
    document.getElementById("hMortgage").value = 0;
    document.getElementById("hRent").value = 0;
    document.getElementById("hRentDay").value = "Fri";
  }
  await render();
  return false;
}

async function editProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const prop = (cls.properties || []).find(p => p.id === id);
  if (!prop) return;
  EDITING_ID = id;
  document.getElementById("hName").value = prop.name;
  document.getElementById("hPrice").value = prop.price;
  document.getElementById("hComfort").value = prop.comfort;
  document.getElementById("hMortgage").value = prop.mortgageWeeks || 0;
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
  document.getElementById("hMortgage").value = 0;
  document.getElementById("hRent").value = 0;
  document.getElementById("hRentDay").value = "Fri";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function deleteProp(id) {
  if (confirm("Remove this property? Any owner will not be refunded automatically.")) {
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
async function buyOutright(id) {
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, false);
  document.getElementById("msg-" + id).innerHTML = res.ok ? `<div class="success-msg">Congratulations, it's yours!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}
async function buyFinanced(id) {
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, true);
  document.getElementById("msg-" + id).innerHTML = res.ok ? `<div class="success-msg">Financed! Weekly payments will come out automatically.</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
