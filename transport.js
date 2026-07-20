let CURRENT, IS_TEACHER;

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("car", 26) + " Transport";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a vehicle";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add vehicle";
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
  const [me, cls] = await Promise.all([getUser(CURRENT.username), getClass(CURRENT.classCode)]);
  const vehicles = cls.vehicles || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  const list = document.getElementById("vehicleList");
  list.innerHTML = "";
  document.getElementById("noVehicles").classList.toggle("hidden", vehicles.length > 0);

  vehicles.forEach(v => {
    const isMine = v.owner === me.username;
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("car", 20)}${v.name} ${isMine ? '<span class="badge mint">Yours</span>' : ""}</h4>
          <p>${v.description || "No description provided."}</p>
          <p>${comfortStars(v.comfort)} comfort</p>
          <p><strong>${fmtMoney(v.price)}</strong> &middot; cash purchase only</p>
          <p class="muted-small">${v.owner ? `Owned by ${nameOf(v.owner)}` : "Available"}</p>
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `${v.owner ? `<button class="btn small secondary" onclick="forceSell('${v.id}')">Sell back</button>` : ""}<button class="btn small coral" onclick="deleteVeh('${v.id}')">${icon("trash", 13)} Remove</button>`
            : v.owner
              ? (isMine ? `<button class="btn small secondary" onclick="sellMine('${v.id}')">Sell back</button>` : "")
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
  await addVehicle(CURRENT.classCode, veh);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Vehicle added!</div>`;
  ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  await render();
  return false;
}

async function deleteVeh(id) {
  if (confirm("Remove this vehicle? Any owner will not be refunded automatically.")) {
    await removeVehicle(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id) {
  if (confirm("Sell this vehicle back to the class (owner gets 90% of price)?")) {
    await sellVehicle(CURRENT.classCode, id);
    await render();
  }
}
async function sellMine(id) {
  if (confirm("Sell your vehicle back for 90% of its price?")) {
    await sellVehicle(CURRENT.classCode, id);
    await render();
  }
}
async function buyVeh(id) {
  const res = await buyVehicle(CURRENT.username, CURRENT.classCode, id);
  document.getElementById("msg-" + id).innerHTML = res.ok ? `<div class="success-msg">Congratulations, it's yours!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
