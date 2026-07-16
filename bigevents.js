let CURRENT, IS_TEACHER;

const MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport" };
const STATUS_LABEL = { pending: "Awaiting response", paid: "Paid", lost: "Lost the asset", claimed: "Claimed on insurance" };
const STATUS_CLASS = { pending: "status-pending", paid: "status-approved", lost: "status-declined", claimed: "status-approved" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("star", 26) + " Big Events";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a big event";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add event";
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
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("star", 20)}${d.name} <span class="badge navy">${MODULE_LABEL[d.module]}</span></h4>
            <p>${d.description || "No description provided."}</p>
            <p><strong>${fmtMoney(d.cost)}</strong> to pay or claim's excess</p>
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
      row.innerHTML = `
        <div class="auto-details"><strong>${e.name}</strong> (${MODULE_LABEL[e.module]}) — ${fmtMoney(e.cost)}
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

document.addEventListener("DOMContentLoaded", init);
