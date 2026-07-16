let CURRENT, IS_TEACHER;

function stars(n) {
  n = Number(n) || 0;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

const COVERAGE_LABEL = { jobs: "Jobs / Income", general: "General (bad random events)", property: "Property", transport: "Transport" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("shield", 26) + " Insurance";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an insurance plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("hMine").innerHTML = icon("shield", 18) + " My cover";
  document.getElementById("hPayDay").innerHTML = icon("calendar", 18) + " Premium payment day";
  document.getElementById("saveDayBtn").innerHTML = icon("calendar", 14) + " Save day";
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
  document.getElementById("payDayCard").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("hMine").closest(".card").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processInsurancePayments(u.classCode);
  await processWeeklyEvents(u.classCode);
  await processWeeklyBigEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);
  const plans = cls.insurancePlans || [];

  if (IS_TEACHER) document.getElementById("insuranceDay").value = cls.insuranceDay || "Fri";

  const list = document.getElementById("planList");
  list.innerHTML = "";
  document.getElementById("noPlans").classList.toggle("hidden", plans.length > 0);

  plans.forEach(p => {
    const owned = (me.insurance || []).includes(p.id);
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("shield", 20)}${p.name} ${owned ? '<span class="badge mint">You have this</span>' : ""}</h4>
          <p>${p.description || "No description provided."}</p>
          <p class="muted-small">Covers: ${COVERAGE_LABEL[p.coverage] || "—"}</p>
          <p><strong>${fmtMoney(p.price)}</strong>/week &middot; ${fmtMoney(p.excess)} excess ${p.stars ? `&middot; <span class="ticker-up">${stars(p.stars)}</span>` : ""}</p>
        </div>
        <div>
          ${IS_TEACHER
            ? `<button class="btn small coral" onclick="deletePlan('${p.id}')">${icon("trash", 13)} Remove</button>`
            : owned
              ? `<button class="btn small secondary" onclick="cancelPlan('${p.id}')">Cancel cover</button>`
              : `<button class="btn small gold" onclick="buyPlan('${p.id}')">${icon("shield", 13)} Sign up</button>`}
        </div>
      </div>
      <div id="msg-${p.id}"></div>
    `;
    list.appendChild(div);
  });

  if (!IS_TEACHER) {
    const mine = plans.filter(p => (me.insurance || []).includes(p.id));
    document.getElementById("noMine").classList.toggle("hidden", mine.length > 0);
    const box = document.getElementById("myPlans");
    box.innerHTML = "";
    mine.forEach(p => {
      const row = document.createElement("div");
      row.className = "auto-row";
      row.innerHTML = `<div class="auto-details">${icon("shield", 14)} <strong>${p.name}</strong> &middot; ${fmtMoney(p.price)}/week &middot; ${fmtMoney(p.excess)} excess &middot; premiums charged on ${cls.insuranceDay}s</div>`;
      box.appendChild(row);
    });
  }
}

async function addPlan(e) {
  e.preventDefault();
  const plan = {
    name: document.getElementById("pName").value.trim(),
    price: document.getElementById("pPrice").value,
    excess: document.getElementById("pExcess").value,
    coverage: document.getElementById("pCoverage").value,
    description: document.getElementById("pDesc").value.trim(),
    stars: document.getElementById("pStars").value
  };
  await addInsurancePlan(CURRENT.classCode, plan);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Plan added!</div>`;
  ["pName","pPrice","pExcess","pDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("pStars").value = 0;
  await render();
  return false;
}

async function deletePlan(id) {
  if (confirm("Remove this insurance plan?")) {
    await removeInsurancePlan(CURRENT.classCode, id);
    await render();
  }
}

async function buyPlan(id) {
  const res = await buyInsurance(CURRENT.username, CURRENT.classCode, id);
  document.getElementById("msg-" + id).innerHTML = res.ok
    ? `<div class="success-msg">You're covered! Premiums will be charged weekly.</div>`
    : `<div class="error-msg">${res.error}</div>`;
  await render();
}

async function cancelPlan(id) {
  await cancelInsurance(CURRENT.username, id);
  await render();
}

async function saveInsuranceDay() {
  await classesColUpdateInsuranceDay(CURRENT.classCode, document.getElementById("insuranceDay").value);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
