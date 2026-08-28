let CURRENT, IS_TEACHER, EDITING_ID = null;

const MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport", general: "General" };
const STATUS_LABEL = { pending: "Awaiting response", paid: "Paid", lost: "Lost the asset", claimed: "Claimed on insurance", received: "Received" };
const STATUS_CLASS = { pending: "status-pending", paid: "status-approved", lost: "status-declined", claimed: "status-approved", received: "status-approved" };

function updateCostLabel() {
  const kind = document.getElementById("beKind").value;
  document.getElementById("labCost").textContent = kind === "good" ? "Amount paid to the student" : "Cost to fix / avoid";
  // Losing the asset is only ever a possibility for "bad" events — good
  // events are windfalls with nothing to forfeit.
  document.getElementById("takesAssetRow").classList.toggle("hidden", kind === "good");
  document.getElementById("takesAssetHint").classList.toggle("hidden", kind === "good");
  // "General" (not tied to any job/property/vehicle) only makes sense for
  // good events — a bad event needs a real asset to threaten or insure.
  const generalOpt = document.getElementById("beModuleGeneral");
  const moduleSelect = document.getElementById("beModule");
  generalOpt.classList.toggle("hidden", kind !== "good");
  generalOpt.disabled = kind !== "good";
  if (kind !== "good" && moduleSelect.value === "general") moduleSelect.value = "income";
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
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
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
  // These popups read the results of the jobs above (e.g. a weekly event
  // that just got generated), so they still need to run afterwards — but
  // they stay sequential since each checks "is another popup already
  // showing" before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const cls = await getClassCached(CURRENT.classCode);

  if (IS_TEACHER) {
    const defs = cls.bigEventDefs || [];
    const list = document.getElementById("defList");
    list.innerHTML = "";
    document.getElementById("noDefs").classList.toggle("hidden", defs.length > 0);
    defs.forEach(d => {
      const div = document.createElement("div");
      div.className = "card company-card";
      const isGood = d.kind === "good";
      const isGeneral = d.module === "general";
      const takesAsset = d.takesAsset !== false;
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("star", 20)}${d.name} <span class="badge navy">${MODULE_LABEL[d.module]}</span> <span class="badge ${isGood ? "gold" : "coral"}">${isGood ? "Good" : "Bad"}</span></h4>
            <p>${d.description || "No description provided."}</p>
            <p><strong>${isGood ? "+" : ""}${fmtMoney(d.cost)}</strong> ${isGood ? "paid to the student" : "to pay or claim's excess"}</p>
            ${!isGood ? `<p class="muted-small">${takesAsset ? "Not paying costs the student the related job/property/vehicle." : "Cost only — the student can't lose the asset over this."}</p>` : ""}
            ${isGood && isGeneral ? `<p class="muted-small">Open to everyone — not tied to any job, property, or vehicle.</p>` : ""}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn small secondary" onclick="startEditEvent('${d.id}')">${icon("idcard", 13)} Edit</button>
            <button class="btn small coral" onclick="deleteEvent('${d.id}')">${icon("trash", 13)} Remove</button>
          </div>
        </div>
      `;
      list.appendChild(div);
    });
  }

  if (!IS_TEACHER) {
    const me = await getUserCached(CURRENT.username);
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
    description: document.getElementById("beDesc").value.trim(),
    takesAsset: document.getElementById("beTakesAsset").checked
  };
  if (EDITING_ID) {
    await updateBigEventDef(CURRENT.classCode, EDITING_ID, ev);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Big event updated!</div>`;
  } else {
    await addBigEventDef(CURRENT.classCode, ev);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Big event added!</div>`;
  }
  resetEventForm();
  await render();
  return false;
}

function resetEventForm() {
  EDITING_ID = null;
  ["beName","beCost","beDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("beTakesAsset").checked = true;
  document.getElementById("beKind").value = "bad";
  document.getElementById("beModule").value = "income";
  updateCostLabel();
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add event";
  const cancelBtn = document.getElementById("cancelEditBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditEvent(id) {
  getClassCached(CURRENT.classCode).then(cls => {
    const d = (cls.bigEventDefs || []).find(x => x.id === id);
    if (!d) return;
    EDITING_ID = id;
    document.getElementById("beName").value = d.name;
    document.getElementById("beModule").value = d.module;
    document.getElementById("beKind").value = d.kind || "bad";
    document.getElementById("beCost").value = d.cost;
    document.getElementById("beDesc").value = d.description || "";
    document.getElementById("beTakesAsset").checked = d.takesAsset !== false;
    updateCostLabel();
    document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
    if (!document.getElementById("cancelEditBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetEventForm;
      document.getElementById("addBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function deleteEvent(id) {
  if (confirm("Remove this big event? It won't be handed out anymore.")) {
    if (id === EDITING_ID) resetEventForm();
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
