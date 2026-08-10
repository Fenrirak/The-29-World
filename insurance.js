let CURRENT, IS_TEACHER, EDITING_PLAN_ID = null;

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nextPaymentInfo(dayAbbr) {
  const targetIdx = DAY_INDEX[dayAbbr];
  if (targetIdx === undefined) return null;
  const now = new Date();
  const todayIdx = now.getDay();
  const daysUntil = (targetIdx - todayIdx + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  return {
    daysUntil,
    dateStr: next.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
    isToday: daysUntil === 0
  };
}

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
          <p><strong>${fmtMoney(p.price)}</strong>/week &middot; ${fmtMoney(p.excess)} excess ${p.signupFee ? `&middot; ${fmtMoney(p.signupFee)} sign-up fee` : ""} ${p.stars ? `&middot; <span class="ticker-up">${stars(p.stars)}</span>` : ""}</p>
        </div>
        <div>
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick='startEditPlan(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Edit</button>
               <button class="btn small coral" onclick="deletePlan('${p.id}')">${icon("trash", 13)} Remove</button>`
            : owned
              ? `<button class="btn small secondary" onclick="cancelPlan('${p.id}')">Cancel cover</button>`
              : `<button class="btn small gold" onclick="buyPlan('${p.id}', ${Number(p.signupFee) || 0})">${icon("shield", 13)} Sign up</button>`}
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
    const payInfo = nextPaymentInfo(cls.insuranceDay);
    mine.forEach(p => {
      const row = document.createElement("div");
      row.className = "auto-row";
      let payText = `premiums charged on ${cls.insuranceDay}s`;
      if (payInfo) {
        payText = payInfo.isToday
          ? `<span class="badge gold">Payment due today</span>`
          : `Next payment: ${payInfo.dateStr} (in ${payInfo.daysUntil} day${payInfo.daysUntil === 1 ? "" : "s"})`;
      }
      row.innerHTML = `<div class="auto-details">${icon("shield", 14)} <strong>${p.name}</strong> &middot; ${fmtMoney(p.price)}/week &middot; ${fmtMoney(p.excess)} excess &middot; ${payText}</div>`;
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
    stars: document.getElementById("pStars").value,
    signupFee: document.getElementById("pSignupFee").value
  };
  if (EDITING_PLAN_ID) {
    await editInsurancePlan(CURRENT.classCode, EDITING_PLAN_ID, plan);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Plan updated!</div>`;
    cancelEditPlan();
  } else {
    await addInsurancePlan(CURRENT.classCode, plan);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Plan added!</div>`;
    ["pName","pPrice","pExcess","pDesc"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("pStars").value = 0;
    document.getElementById("pSignupFee").value = 0;
  }
  await render();
  return false;
}

function startEditPlan(p) {
  EDITING_PLAN_ID = p.id;
  document.getElementById("pName").value = p.name || "";
  document.getElementById("pPrice").value = p.price || 0;
  document.getElementById("pExcess").value = p.excess || 0;
  document.getElementById("pCoverage").value = p.coverage || "general";
  document.getElementById("pDesc").value = p.description || "";
  document.getElementById("pStars").value = p.stars || 0;
  document.getElementById("pSignupFee").value = p.signupFee || 0;
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit insurance plan";
  document.getElementById("addBtn").innerHTML = "Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth" });
}

function cancelEditPlan() {
  EDITING_PLAN_ID = null;
  ["pName","pPrice","pExcess","pDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("pStars").value = 0;
  document.getElementById("pSignupFee").value = 0;
  document.getElementById("pCoverage").value = "general";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an insurance plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function deletePlan(id) {
  if (confirm("Remove this insurance plan?")) {
    await removeInsurancePlan(CURRENT.classCode, id);
    await render();
  }
}

async function buyPlan(id, fee) {
  if (fee > 0 && !confirm(`This plan has a one-off sign-up fee of ${fmtMoney(fee)}, charged immediately. Continue?`)) return;
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
