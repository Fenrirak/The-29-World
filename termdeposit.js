let CURRENT, IS_TEACHER, PLANS = [];

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("vault", 26) + " Term Deposit";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a term deposit plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("hMine").innerHTML = icon("vault", 18) + " My term deposits";
  document.getElementById("hEdit").innerHTML = icon("vault", 18) + " Edit term deposit plan";
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
  document.getElementById("mineCard").classList.toggle("hidden", IS_TEACHER);
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
  const plans = (cls.termDepositPlans || []).filter(p => p.active);
  PLANS = plans;

  const list = document.getElementById("planList");
  list.innerHTML = "";
  document.getElementById("noPlans").classList.toggle("hidden", plans.length > 0);

  plans.forEach(p => {
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("vault", 20)}${p.name}</h4>
          <p class="muted-small">Minimum ${fmtMoney(p.minAmount)} &middot; ${p.days} days &middot; ${p.rate}% interest at maturity &middot; ${p.earlyFeePct}% fee if broken early</p>
        </div>
        <div>
          ${IS_TEACHER
            ? `<div class="row-flex" style="gap:8px;">
                 <button class="btn small" onclick="openEditPlan('${p.id}')">${icon("vault", 13)} Edit</button>
                 <button class="btn small coral" onclick="deletePlan('${p.id}')">${icon("trash", 13)} Remove</button>
               </div>`
            : `<div class="row-flex" style="gap:8px;">
                 <input type="number" min="${p.minAmount}" step="0.01" id="amt-${p.id}" placeholder="Amount" style="max-width:140px;">
                 <button class="btn small gold" onclick="openDeposit('${p.id}')">${icon("vault", 13)} Deposit</button>
               </div>`}
        </div>
      </div>
      <div id="msg-${p.id}"></div>
    `;
    list.appendChild(div);
  });

  if (!IS_TEACHER) {
    const deposits = me.termDeposits || [];
    document.getElementById("noMine").classList.toggle("hidden", deposits.length > 0);
    const box = document.getElementById("myDeposits");
    box.innerHTML = "";
    deposits.forEach(d => {
      const row = document.createElement("div");
      row.className = "auto-row";
      row.innerHTML = `
        <div class="auto-details">${icon("vault", 14)} <strong>${fmtMoney(d.amount)}</strong> in ${d.plan.name}
          <div class="muted-small">Matures ${d.matureDate} &middot; ${d.plan.earlyFeePct}% fee if withdrawn early</div>
        </div>
        <button class="btn small coral" onclick="withdrawEarly('${d.id}')">Withdraw early</button>
      `;
      box.appendChild(row);
    });
  }
}

async function addPlan(e) {
  e.preventDefault();
  const plan = {
    name: document.getElementById("tName").value.trim(),
    minAmount: document.getElementById("tMin").value,
    days: document.getElementById("tDays").value,
    rate: document.getElementById("tRate").value,
    earlyFeePct: document.getElementById("tFee").value
  };
  await addTermDepositPlan(CURRENT.classCode, plan);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Plan added!</div>`;
  ["tName","tMin","tDays","tRate","tFee"].forEach(id => document.getElementById(id).value = "");
  await render();
  return false;
}

function openEditPlan(id) {
  const p = PLANS.find(pl => pl.id === id);
  if (!p) return;
  document.getElementById("eId").value = p.id;
  document.getElementById("eName").value = p.name;
  document.getElementById("eMin").value = p.minAmount;
  document.getElementById("eDays").value = p.days;
  document.getElementById("eRate").value = p.rate;
  document.getElementById("eFee").value = p.earlyFeePct;
  document.getElementById("editMsg").innerHTML = "";
  document.getElementById("editPlanCard").classList.remove("hidden");
  document.getElementById("editPlanCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditPlan() {
  document.getElementById("editPlanCard").classList.add("hidden");
}

async function saveEditPlan(e) {
  e.preventDefault();
  const id = document.getElementById("eId").value;
  const plan = {
    name: document.getElementById("eName").value.trim(),
    minAmount: document.getElementById("eMin").value,
    days: document.getElementById("eDays").value,
    rate: document.getElementById("eRate").value,
    earlyFeePct: document.getElementById("eFee").value
  };
  await editTermDepositPlan(CURRENT.classCode, id, plan);
  document.getElementById("editMsg").innerHTML = `<div class="success-msg">Plan updated!</div>`;
  document.getElementById("editPlanCard").classList.add("hidden");
  await render();
  return false;
}

async function deletePlan(id) {
  if (confirm("Remove this term deposit plan? Existing deposits under it are unaffected.")) {
    await removeTermDepositPlan(CURRENT.classCode, id);
    await render();
  }
}

async function openDeposit(id) {
  const amt = document.getElementById("amt-" + id).value;
  const res = await openTermDeposit(CURRENT.username, CURRENT.classCode, id, amt);
  document.getElementById("msg-" + id).innerHTML = res.ok
    ? `<div class="success-msg">Locked in!</div>`
    : `<div class="error-msg">${res.error}</div>`;
  await render();
}

async function withdrawEarly(depositId) {
  if (confirm("Withdraw early? You'll pay the early withdrawal fee and forfeit interest.")) {
    await withdrawTermDepositEarly(CURRENT.username, depositId);
    await render();
  }
}

document.addEventListener("DOMContentLoaded", init);
