let CURRENT, IS_TEACHER;

const MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport" };
const STATUS_LABEL = { pending: "Awaiting response", paid: "Paid", lost: "Lost the asset", claimed: "Claimed on insurance", received: "Received" };
const STATUS_CLASS = { pending: "status-pending", paid: "status-approved", lost: "status-declined", claimed: "status-approved", received: "status-approved" };

function updateCostLabel() {
  const kind = document.getElementById("beKind").value;
  document.getElementById("labCost").textContent = kind === "good" ? "Amount paid to the student" : "Cost to fix / avoid";
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("star", 26) + " Big Events";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a big event";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("runBigEventsBtn").innerHTML = icon("repeat", 14) + " Run this week's big events now";
  document.getElementById("hHistory").innerHTML = icon("star", 18) + " My big event history";
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
  if (IS_TEACHER) updateCostLabel();
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("defListCard").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("historyCard").classList.toggle("hidden", IS_TEACHER);
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
  const cls = await getClass(CURRENT.classCode);

  if (IS_TEACHER) {
    const defs = cls.bigEventDefs || [];
    const list = document.getElementById("defList");
    list.innerHTML = "";
    document.getElementById("noDefs").classList.toggle("hidden", defs.length > 0);
    defs.forEach(d => {
      const div = document.createElement("div");
      div.className = "card company-card";
      const isGood = d.kind === "good";
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("star", 20)}${d.name} <span class="badge navy">${MODULE_LABEL[d.module]}</span> <span class="badge ${isGood ? "gold" : "coral"}">${isGood ? "Good" : "Bad"}</span></h4>
            <p>${d.description || "No description provided."}</p>
            <p><strong>${isGood ? "+" : ""}${fmtMoney(d.cost)}</strong> ${isGood ? "paid to the student" : "to pay or claim's excess"}</p>
          </div>
          <button class="btn small coral" onclick="deleteEvent('${d.id}')">${icon("trash", 13)} Remove</button>
        </div>
      `;
      list.appendChild(div);
    });
  }

  if (!IS_TEACHER) {
    const me = await getUser(CURRENT.username);
    const mine = (cls.bigEventLog || []).filter(e => e.studentUser === me.username).slice().reverse();
    document.getElementById("noHistory").classList.toggle("hidden", mine.length > 0);
    const box = document.getElementById("historyList");
    box.innerHTML = "";
    mine.forEach(e => {
      const row = document.createElement("div");
      row.className = "auto-row";
      const isGood = e.kind === "good";
      row.innerHTML = `
        <div class="auto-details"><strong>${e.name}</strong> (${MODULE_LABEL[e.module]}) — <span class="${isGood ? "ticker-up" : ""}">${isGood ? "+" : ""}${fmtMoney(e.cost)}</span>
          <div class="muted-small">${e.date}</div>
        </div>
        <span class="${STATUS_CLASS[e.status]}">${STATUS_LABEL[e.status]}</span>
      `;
      box.appendChild(row);
    });
  }
}

async function addEvent(e) {
  e.preventDefault();
  const ev = {
    name: document.getElementById("beName").value.trim(),
    module: document.getElementById("beModule").value,
    kind: document.getElementById("beKind").value,
    cost: document.getElementById("beCost").value,
    description: document.getElementById("beDesc").value.trim()
  };
  await addBigEventDef(CURRENT.classCode, ev);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Big event added!</div>`;
  ["beName","beCost","beDesc"].forEach(id => document.getElementById(id).value = "");
  await render();
  return false;
}

async function deleteEvent(id) {
  if (confirm("Remove this big event? It won't be handed out anymore.")) {
    await removeBigEventDef(CURRENT.classCode, id);
    await render();
  }
}

async function runBigEventsNow() {
  const btn = document.getElementById("runBigEventsBtn");
  if (btn.disabled) return; // already running — ignore extra clicks
  btn.disabled = true;
  try {
    const count = await forceWeeklyBigEvents(CURRENT.classCode);
    document.getElementById("runBigEventsMsg").innerHTML = count > 0
      ? `<div class="success-msg">Done — ${count} student(s) got a big event just now.</div>`
      : `<div class="error-msg">No eligible students right now — for "bad" events, make sure at least one active event has students with a matching job/property/vehicle. "Good" events are open to everyone. (Anyone who already has a big event queued for this week is skipped.)</div>`;
    await render();
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
