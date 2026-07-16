let CURRENT, IS_TEACHER;

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("vault", 26) + " Term Deposit";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a term deposit plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("hMine").innerHTML = icon("vault", 18) + " My term deposits";
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
  const plans = (cls.termDepositPlans || []).filter(p => p.active);

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
            ? `<button class="btn small coral" onclick="deletePlan('${p.id}')">${icon("trash", 13)} Remove</button>`
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
