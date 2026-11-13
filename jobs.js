let CURRENT, IS_TEACHER, CLASS_CODE;
let EDITING_SIDE_HUSTLE_ID = null;
let JOBS_CACHE = [];
let ADD_LOG = null, EDIT_LOG = null; // log-type settings held by the create / edit forms
let LOG_CTX = null;                  // student's latest { me, cls }, repainted as the check-in window moves
let QUIZ = null;                     // the open daily-questions dialog

/* ── Avatar helpers (also in teacher.js / student.js — duplicated here
      since jobs.html loads only the data-*.js files + jobs.js) ────────────────── */
const AVATAR_COLORS = ["c1", "c2", "c3", "c4", "c5"];
function avatarClass(u) {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

/* ── Edit-modal state ───────────────────────────────────────────────── */
let EDIT_JOB_ID = null;
let EDIT_TIERS  = []; // { id, name, wage, description } — id="" means new

function paintChrome() {
  paintIconSlots();
}

/* ══════════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════════ */
async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT    = u;
  CLASS_CODE = u.classCode;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href       = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  paintChrome();

  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(CLASS_CODE), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(CURRENT.username), "payMyWageIfDue"),
    safeBgJob(processAutomations(CLASS_CODE), "processAutomations"),
    safeBgJob(processTermDeposits(CLASS_CODE), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(CLASS_CODE), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(CURRENT.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(CLASS_CODE), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(CLASS_CODE), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(CLASS_CODE), "processWeeklyBigEvents"),
    safeBgJob(processJobPromotions(CLASS_CODE), "processJobPromotions")
  ]);

  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
  await checkBigEventPopup(CURRENT.username, CLASS_CODE);

  if (!IS_TEACHER) {
    // Show promotion popup if one is waiting
    try {
      const promo = await checkPromotionNotification(CURRENT.username);
      if (promo) showPromotionPopup(promo);
    } catch (e) {}
  }

  await render();
}

/* ══════════════════════════════════════════════════════════════════════
   RENDER ROUTER
══════════════════════════════════════════════════════════════════════ */
async function render() {
  const cls      = withNewModuleDefaults(await getClassCached(CLASS_CODE));
  const students = IS_TEACHER ? await getClassStudents(CLASS_CODE, cls) : [];
  JOBS_CACHE     = cls.jobs || [];

  document.getElementById("teacherView").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden",  IS_TEACHER);

  if (IS_TEACHER) {
    renderTeacherView(cls, students);
  } else {
    const me = await getUserCached(CURRENT.username);
    renderStudentView(me, cls);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   TEACHER VIEW
══════════════════════════════════════════════════════════════════════ */
function renderTeacherView(cls, students) {
  renderPayDay(cls);
  renderSideHustles(cls, students);
  renderJobsGrid(cls, students);
  renderLogTracker(cls, students);
  renderApplications(cls, students);
}

/* ── Pay day (teacher setting) ─────────────────────────────────────── */
function renderPayDay(cls) {
  const sel = document.getElementById("payDaySelect");
  if (sel && document.activeElement !== sel) sel.value = cls.payDay || "Fri";
}

async function savePayDay() {
  const btn = document.getElementById("savePayDayBtn");
  const msg = document.getElementById("payDayMsg");
  if (btn.disabled) return;
  btn.disabled = true;
  msg.innerHTML = "";
  try {
    const day = document.getElementById("payDaySelect").value;
    await setPayDay(CLASS_CODE, day);
    await render();
    flashMsg(msg, `<div class="success-msg">Saved. Wages are now due every ${escapeHtml(DAY_FULL[day] || day)}, and are paid automatically when that day comes around.</div>`, 6000);
  } catch (e) {
    msg.innerHTML = `<div class="error-msg">Couldn't save the pay day. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* ── Side hustles (teacher) ────────────────────────────────────────── */
function renderSideHustles(cls, students) {
  const reqBox = document.getElementById("sideHustleRequests");
  const pending = students.filter(s => s.sideHustleRequest && s.sideHustleRequest.status === "pending");
  document.getElementById("noSideHustleRequests").classList.toggle("hidden", pending.length > 0);
  reqBox.innerHTML = "";
  pending.forEach(s => {
    const req = s.sideHustleRequest;
    const hustles = cls.sideHustles || [];
    const from = hustles.find(h => h.id === (s.sideHustle || {}).hustleId);
    const to = hustles.find(h => h.id === req.hustleId);
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details"><strong>${escapeHtml(s.name)}</strong>
        wants to switch ${from ? `from ${escapeHtml(from.name)} (${hourLabel((s.sideHustle || {}).checkinHour)})` : "(no current hustle)"}
        to <strong>${to ? escapeHtml(to.name) : "—"}</strong> at ${hourLabel(req.checkinHour)}
      </div>
      <button class="btn small" onclick="approveSideHustleRequest('${escapeJsAttr(s.username)}')">Approve</button>
      <button class="btn small coral" onclick="denySideHustleRequest('${escapeJsAttr(s.username)}')">Deny</button>
    `;
    reqBox.appendChild(row);
  });

  const shBox = document.getElementById("sideHustleList");
  const hustles = cls.sideHustles || [];
  document.getElementById("noSideHustlesTeacher").classList.toggle("hidden", hustles.length > 0);
  shBox.innerHTML = "";
  hustles.forEach(h => {
    const row = document.createElement("div");
    row.className = "auto-row";
    const payoutSummary = Object.keys(h.payouts || {})
      .map(Number).sort((a, b) => a - b)
      .map(hr => `${hourLabel(hr)}: ${fmtMoney(h.payouts[hr])}`).join(", ") || "No payouts set";
    row.innerHTML = `
      <div class="auto-details">${icon("briefcase", 14)} <strong>${escapeHtml(h.name)}</strong>
        <div class="muted-small">${payoutSummary}</div>
        ${Number(h.streakBonus) > 0 ? `<div style="margin-top:6px;"><span class="badge gold">${icon("bolt", 12)} +${fmtMoney(h.streakBonus)} per day streak bonus</span></div>` : ""}
        ${h.description ? `<div class="muted-small">${escapeHtml(h.description)}</div>` : ""}
      </div>
      <button class="btn small secondary" onclick="startEditSideHustle('${h.id}')">${icon("edit", 13)} Edit</button>
      <button class="btn small coral" onclick="removeSideHustleClick('${h.id}')">${icon("trash", 13)} Remove</button>
    `;
    shBox.appendChild(row);
  });
}

// Teachers naturally type amounts like "$10" or "1,000" in a money app —
// plain Number() chokes on those and silently falls back to 0, which is
// why a whole multi-choice event could end up worth +$0 across the board.
// This strips currency symbols/commas/whitespace first so those work.
function parseMoneyInput(str) {
  if (str === undefined || str === null) return NaN;
  const cleaned = String(str).replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return NaN;
  return Number(cleaned);
}

// "1am" / "12pm" -> 0-23, or null if unrecognized.
function parseHourLabel(str) {
  const m = String(str || "").trim().toLowerCase().match(/^(\d{1,2})\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (h < 1 || h > 12) return null;
  if (m[2] === "am") h = (h === 12) ? 0 : h;
  else h = (h === 12) ? 12 : h + 12;
  return h;
}


async function approveSideHustleRequest(username) {
  const res = await approveSideHustleChange(username, CLASS_CODE);
  if (!res.ok) alert(res.error || "Couldn't approve that request.");
  await render();
}

async function denySideHustleRequest(username) {
  const reason = await t29Prompt("Optional reason to show the student (leave blank to skip):", "", { confirmText: "Send", placeholder: "Reason (optional)" }) || "";
  await denySideHustleChange(username, reason);
  await render();
}

async function addSideHustleForm(e) {
  e.preventDefault();
  const name = document.getElementById("shName").value.trim();
  const description = document.getElementById("shDesc").value.trim();
  const lines = document.getElementById("shPayoutsArea").value.split("\n").map(l => l.trim()).filter(Boolean);
  const payouts = {};
  for (const line of lines) {
    const [hourPart, amtPart] = line.split("|");
    const hour = parseHourLabel(hourPart);
    if (hour === null) {
      alert(`Couldn't read the hour "${(hourPart || "").trim()}". Use a plain hour like "1am" or "3pm".`);
      return false;
    }
    const amount = parseMoneyInput(amtPart);
    if (Number.isNaN(amount)) {
      alert(`Couldn't read the amount for "${(hourPart || "").trim()}". Enter a plain number like 20 (no currency symbols needed).`);
      return false;
    }
    payouts[hour] = amount;
  }
  if (Object.keys(payouts).length === 0) {
    alert('Add at least one payout, as "hour | amount" (e.g. "1am | 20").');
    return false;
  }

  const bonusRaw = document.getElementById("shStreakBonus").value.trim();
  let streakBonus = 0;
  if (bonusRaw !== "") {
    streakBonus = parseMoneyInput(bonusRaw);
    if (Number.isNaN(streakBonus) || streakBonus < 0) {
      alert("Couldn't read the streak bonus. Enter a plain amount like 2 (or leave it blank for no streak bonus).");
      return false;
    }
  }

  if (EDITING_SIDE_HUSTLE_ID) {
    await editSideHustle(CLASS_CODE, EDITING_SIDE_HUSTLE_ID, { name, description, payouts, streakBonus });
  } else {
    await addSideHustle(CLASS_CODE, { name, description, payouts, streakBonus });
  }
  resetSideHustleForm();
  await render();
  return false;
}

function resetSideHustleForm() {
  EDITING_SIDE_HUSTLE_ID = null;
  document.getElementById("shName").value = "";
  document.getElementById("shDesc").value = "";
  document.getElementById("shPayoutsArea").value = "";
  document.getElementById("shStreakBonus").value = "";
  document.getElementById("addSideHustleBtn").innerHTML = icon("plus", 15) + " Add side hustle";
  document.getElementById("hustleFoldTitle").textContent = "Add a side hustle";
  document.getElementById("hustleFold").open = false;
  const cancelBtn = document.getElementById("cancelEditSideHustleBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditSideHustle(id) {
  getClassCached(CLASS_CODE).then(cls => {
    const h = (cls.sideHustles || []).find(x => x.id === id);
    if (!h) return;
    EDITING_SIDE_HUSTLE_ID = id;
    document.getElementById("shName").value = h.name;
    document.getElementById("shDesc").value = h.description || "";
    document.getElementById("shPayoutsArea").value = Object.keys(h.payouts || {})
      .map(Number).sort((a, b) => a - b)
      .map(hr => `${hourLabel(hr)} | ${h.payouts[hr]}`).join("\n");
    document.getElementById("shStreakBonus").value = Number(h.streakBonus) > 0 ? h.streakBonus : "";
    document.getElementById("addSideHustleBtn").innerHTML = icon("save", 15) + " Save changes";
    document.getElementById("hustleFoldTitle").textContent = "Edit side hustle";
    document.getElementById("hustleFold").open = true;
    if (!document.getElementById("cancelEditSideHustleBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditSideHustleBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetSideHustleForm;
      document.getElementById("addSideHustleBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addSideHustleBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function removeSideHustleClick(id) {
  if (await t29Confirm("Remove this side hustle? Students currently using it will lose their check-in until they pick a new one.")) {
    if (id === EDITING_SIDE_HUSTLE_ID) resetSideHustleForm();
    await removeSideHustle(CLASS_CODE, id);
    await render();
  }
}

/* ── Jobs grid ─────────────────────────────────────────────────────── */
function renderJobsGrid(cls, students) {
  const grid = document.getElementById("jobsGrid");
  grid.innerHTML = "";

  if (!cls.jobs || cls.jobs.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>No jobs yet. Students need a job to get paid.</p><button type="button" class="btn small secondary" onclick="document.getElementById('addJobCard').open = true; t29Jump('addJobCard')">Create a job</button></div>`;
    return;
  }

  cls.jobs.forEach(j => {
    const jobStudents = students.filter(s => s.jobId === j.id);
    grid.appendChild(buildJobCard(j, jobStudents));
  });
}

function buildJobCard(j, jobStudents) {
  const tiers = j.tiers || [];
  const autoLabel = j.autoPromoteWeeks > 0
    ? `Auto-promotes every <strong>${j.autoPromoteWeeks}</strong> week${j.autoPromoteWeeks === 1 ? "" : "s"}`
    : `Auto-promote: <span class="muted-small">off</span>`;

  const card = document.createElement("div");
  card.className = "job-family-card";
  card.innerHTML = `
    <div class="job-family-header">
      <div>
        <h3 class="job-family-title">${icon("briefcase", 16)} ${escapeHtml(j.title)}</h3>
        <div class="job-family-auto muted-small">${autoLabel}</div>
        <div class="job-family-log"><span class="badge navy">${JOB_LOG_TYPES[jobLogType(j)]}</span><span class="muted-small">${escapeHtml(jobLogSummary(j))}</span></div>
      </div>
      <div class="job-family-actions">
        <button class="btn small secondary" onclick="openEditModal('${j.id}')">Edit</button>
        <button class="btn small coral"     onclick="deleteJobClick('${j.id}')">Remove</button>
      </div>
    </div>
    <div class="tier-ladder">
      ${tiers.map((t, i) => {
        const here = jobStudents.filter(s => {
          const st = getStudentTier(j, s);
          return st && st.id === t.id;
        });
        const avatars = here.map(s =>
          avatarBadge(s)
        ).join("");
        return `
          <div class="tier-rung${here.length ? " has-students" : ""}">
            <div class="tier-rung-badge">${i + 1}</div>
            <div class="tier-rung-body">
              <div class="tier-rung-title">${escapeHtml(t.name)}</div>
              <div class="tier-rung-wage">${fmtMoney(t.wage)}<span class="muted-small">/pay day</span></div>
              ${t.description ? `<div class="tier-rung-desc muted-small">${escapeHtml(t.description)}</div>` : ""}
            </div>
            ${here.length ? `<div class="tier-rung-students">${avatars}<span class="tier-rung-count">${here.length}</span></div>` : ""}
          </div>
          ${i < tiers.length - 1 ? `<div class="tier-connector"></div>` : ""}
        `;
      }).join("")}
    </div>
    ${jobStudents.length === 0 ? `<p class="muted-small" style="margin:8px 0 0;">No students assigned yet.</p>` : ""}
  `;
  return card;
}

/* ── Add-job form ──────────────────────────────────────────────────── */
// We track the tiers for the "add" form in a module-level array
let ADD_TIERS = [{ id: "", name: "", wage: "", description: "" }];

function initAddForm() {
  ADD_TIERS = [{ id: "", name: "", wage: "", description: "" }];
  renderAddTiers();
  ADD_LOG = newLogState(null);
  renderLogBox("add");
}

function renderAddTiers() {
  const container = document.getElementById("addTiersList");
  if (!container) return;
  container.innerHTML = "";
  ADD_TIERS.forEach((t, i) => {
    container.appendChild(buildTierRow(t, i, "add"));
  });
}

function buildTierRow(t, i, prefix) {
  const div = document.createElement("div");
  div.className = "tier-form-row";
  div.dataset.idx = i;
  div.innerHTML = `
    <div class="tier-form-row-header">
      <span class="tier-form-label">Tier ${i + 1}</span>
      <button type="button" class="btn small coral tier-form-remove"
        onclick="removeTierRow('${prefix}', ${i})"
        ${i === 0 && (prefix === "add" ? ADD_TIERS : EDIT_TIERS).length === 1 ? "disabled title='Need at least one tier'" : ""}
      >Remove</button>
    </div>
    <div class="tier-form-fields">
      <div>
        <label>Tier name</label>
        <input type="text" class="tier-name-input" placeholder="e.g. Junior Librarian" value="${escapeHtml(t.name || "")}"
          oninput="updateTierField('${prefix}', ${i}, 'name', this.value)">
      </div>
      <div>
        <label>Wage per pay day ($)</label>
        <input type="number" class="tier-wage-input" min="0" step="1" placeholder="0" value="${t.wage || ""}"
          oninput="updateTierField('${prefix}', ${i}, 'wage', this.value)">
      </div>
      <div class="tier-desc-wrap">
        <label>Description (optional)</label>
        <input type="text" class="tier-desc-input" placeholder="What does this tier do?" value="${escapeHtml(t.description || "")}"
          oninput="updateTierField('${prefix}', ${i}, 'description', this.value)">
      </div>
    </div>
  `;
  return div;
}

function updateTierField(prefix, i, field, value) {
  const arr = prefix === "add" ? ADD_TIERS : EDIT_TIERS;
  if (arr[i]) arr[i][field] = value;
}

function removeTierRow(prefix, i) {
  const arr = prefix === "add" ? ADD_TIERS : EDIT_TIERS;
  if (arr.length <= 1) return;
  arr.splice(i, 1);
  prefix === "add" ? renderAddTiers() : renderEditTiers();
}

function addTierRowBtn(prefix) {
  const arr = prefix === "add" ? ADD_TIERS : EDIT_TIERS;
  arr.push({ id: "", name: "", wage: "", description: "" });
  prefix === "add" ? renderAddTiers() : renderEditTiers();
}

async function submitAddJob() {
  const title = (document.getElementById("addJobTitle").value || "").trim();
  const weeks = parseInt(document.getElementById("addJobAutoWeeks").value) || 0;
  if (!title) { alert("Please enter a job name."); return; }

  // Sync any in-progress typing by reading directly from DOM
  const rows = document.querySelectorAll("#addTiersList .tier-form-row");
  rows.forEach((row, i) => {
    if (!ADD_TIERS[i]) return;
    ADD_TIERS[i].name        = row.querySelector(".tier-name-input").value.trim();
    ADD_TIERS[i].wage        = row.querySelector(".tier-wage-input").value;
    ADD_TIERS[i].description = row.querySelector(".tier-desc-input").value.trim();
  });

  const validTiers = ADD_TIERS.filter(t => t.name.trim());
  if (validTiers.length === 0) { alert("Please name at least one tier."); return; }
  let logData;
  try { logData = readLogForm("add"); } catch (e) { alert(e.message); return; }

  const btn = document.getElementById("addJobBtn");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    await addJob(CLASS_CODE, title, validTiers, weeks, logData.logType, logData.log);
    document.getElementById("addJobTitle").value     = "";
    document.getElementById("addJobAutoWeeks").value = "0";
    initAddForm();
    document.getElementById("addJobSuccess").classList.remove("hidden");
    setTimeout(() => document.getElementById("addJobSuccess").classList.add("hidden"), 3000);
    await render();
  } catch (e) {
    alert("Couldn't add job: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon("plus", 15) + " Add job";
  }
}

/* ── Edit modal ────────────────────────────────────────────────────── */
function openEditModal(jobId) {
  const j = JOBS_CACHE.find(jj => jj.id === jobId);
  if (!j) return;
  EDIT_JOB_ID = jobId;
  EDIT_TIERS  = (j.tiers || []).map(t => ({ id: t.id, name: t.name, wage: t.wage, description: t.description || "" }));

  document.getElementById("editJobTitle").value     = j.title;
  document.getElementById("editJobAutoWeeks").value = j.autoPromoteWeeks || 0;
  renderEditTiers();
  EDIT_LOG = newLogState(j);
  renderLogBox("edit");
  document.getElementById("editModal").classList.remove("hidden");
  document.getElementById("editModalMsg").textContent = "";
}

function closeEditModal() {
  document.getElementById("editModal").classList.add("hidden");
  EDIT_JOB_ID = null;
  EDIT_TIERS  = [];
}

function renderEditTiers() {
  const container = document.getElementById("editTiersList");
  if (!container) return;
  container.innerHTML = "";
  EDIT_TIERS.forEach((t, i) => {
    container.appendChild(buildTierRow(t, i, "edit"));
  });
}

async function saveEditJob() {
  if (!EDIT_JOB_ID) return;
  const title = (document.getElementById("editJobTitle").value || "").trim();
  const weeks = parseInt(document.getElementById("editJobAutoWeeks").value) || 0;
  if (!title) { showEditMsg("Please enter a job name.", "error"); return; }

  // Sync from DOM
  const rows = document.querySelectorAll("#editTiersList .tier-form-row");
  rows.forEach((row, i) => {
    if (!EDIT_TIERS[i]) return;
    EDIT_TIERS[i].name        = row.querySelector(".tier-name-input").value.trim();
    EDIT_TIERS[i].wage        = row.querySelector(".tier-wage-input").value;
    EDIT_TIERS[i].description = row.querySelector(".tier-desc-input").value.trim();
  });

  const validTiers = EDIT_TIERS.filter(t => t.name.trim()).map(t => ({
    // Preserve existing IDs; generate stable IDs for new tiers client-side
    id: t.id || ("t_" + Date.now().toString(36) + Math.floor(Math.random() * 9999).toString(36)),
    name: t.name,
    wage: Number(t.wage) || 0,
    description: t.description || ""
  }));
  if (validTiers.length === 0) { showEditMsg("Need at least one named tier.", "error"); return; }
  let logData;
  try { logData = readLogForm("edit"); } catch (e) { showEditMsg(e.message, "error"); return; }

  const btn = document.getElementById("saveEditBtn");
  btn.disabled    = true;
  btn.textContent = "Saving…";
  try {
    await updateJob(CLASS_CODE, EDIT_JOB_ID, { title, tiers: validTiers, autoPromoteWeeks: weeks, logType: logData.logType, log: logData.log });
    showEditMsg("Saved!", "success");
    setTimeout(closeEditModal, 900);
    await render();
  } catch (e) {
    showEditMsg("Couldn't save: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save changes";
  }
}

function showEditMsg(msg, type) {
  const el = document.getElementById("editModalMsg");
  el.textContent = msg;
  el.className   = type === "error" ? "error-msg" : "success-msg";
}

/* ── Delete job ─────────────────────────────────────────────────────── */
async function deleteJobClick(jobId) {
  const j = JOBS_CACHE.find(jj => jj.id === jobId);
  if (!j) return;
  if (!await t29Confirm(`Remove the job "${j.title}"? Students currently in this role will be unassigned.`)) return;
  await removeJob(CLASS_CODE, jobId);
  await render();
}

/* ── Applications (teacher) ────────────────────────────────────────── */
function renderApplications(cls, students) {
  const pending = (cls.jobApplications || []).filter(a => a.status === "pending");
  const box     = document.getElementById("applicationsBox");
  document.getElementById("applicationsBadge").textContent = pending.length || "";
  document.getElementById("applicationsBadge").classList.toggle("hidden", !pending.length);

  if (!pending.length) {
    box.innerHTML = `<p class="muted-small">No pending applications.</p>`;
    return;
  }

  box.innerHTML = "";
  pending.forEach(a => {
    const j   = (cls.jobs || []).find(jj => jj.id === a.jobId);
    const s   = students.find(ss => ss.username === a.studentUser);
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details">
        <strong>${s ? escapeHtml(s.name) : escapeHtml(a.studentUser)}</strong> applied for <strong>${j ? escapeHtml(j.title) : "Unknown job"}</strong>
        ${j && j.tiers && j.tiers.length ? `<div class="muted-small">Starting at: ${escapeHtml(j.tiers[0].name)}: ${fmtMoney(j.tiers[0].wage)}/pay day</div>` : ""}
        <div class="muted-small">${a.coverLetter ? `"${escapeHtml(a.coverLetter)}"` : "No cover letter."}</div>
      </div>
      <div class="row-flex" style="gap:8px;">
        <button class="btn small mint"  onclick="approveApp('${a.id}')">Approve</button>
        <button class="btn small coral" onclick="declineApp('${a.id}')">Decline</button>
      </div>
    `;
    box.appendChild(row);
  });
}

async function approveApp(appId) {
  await approveApplication(CLASS_CODE, appId);
  await render();
}

async function declineApp(appId) {
  await declineApplication(CLASS_CODE, appId);
  await render();
}

/* ══════════════════════════════════════════════════════════════════════
   STUDENT VIEW
══════════════════════════════════════════════════════════════════════ */
async function renderStudentView(me, cls) {
  renderMyJob(me, cls);
  renderJobLog(me, cls);
  renderWageTax(cls);
  renderPayslips(me, cls);
  renderJobBoard(me, cls);
  renderMyApplications(me, cls);
}

/* ── Tax on my pay (the wage tax bands; hidden when no pay is taxed) ─────── */
function renderWageTax(cls) {
  const card = document.getElementById("wageTaxCard"), box = document.getElementById("wageTaxBox");
  if (!card || !box) return;
  const bands = t29WageTaxBands(cls);
  card.classList.toggle("hidden", !bands.length);
  if (!bands.length) { box.innerHTML = ""; return; }
  const h = document.getElementById("hWageTax"); if (h) h.innerHTML = "Tax on my pay";
  // Whole dollars stay compact ("$1,000"); anything with cents is shown as "$12.50".
  const m = n => Number.isInteger(Number(n)) ? "$" + Number(n).toLocaleString("en-NZ") : fmtMoney(n);
  box.innerHTML = bands.map((b, i) => {
    const range = i === 0 ? (b.upTo == null ? "All of your pay" : `Up to ${m(b.upTo)}`)
      : b.upTo == null ? `Over ${m(b.from)}`
      : `Over ${m(b.from)}, up to ${m(b.upTo)}`;
    return `<div class="auto-row"><div class="auto-details">${range}</div><strong>${b.rate > 0 ? t29TaxPct(b.rate) : "Tax-free"}</strong></div>`;
  }).join("");
}

/* ── My current job ────────────────────────────────────────────────── */
function renderMyJob(me, cls) {
  const box = document.getElementById("myJobBox");
  const job = me.jobId ? (cls.jobs || []).find(j => j.id === me.jobId) : null;
  const tier = job ? getStudentTier(job, me) : null;

  if (!job || !tier) {
    box.innerHTML = `
      <div class="empty-state">
        <p>You don't have a job yet, so nothing comes in on pay day.</p>
        <button type="button" class="btn small secondary" onclick="t29Jump('jobBoardGrid')">See the job board</button>
      </div>`;
    return;
  }

  const tiers    = job.tiers || [];
  const tierIdx  = tiers.indexOf(tier);
  const isTop    = tierIdx === tiers.length - 1;
  // Dots sit at column centres ((i+0.5)/n), so the fill must end there to touch the current dot.
  // On the top tier the bar fills the whole way.
  const pctDone  = isTop ? 100 : ((tierIdx + 0.5) / tiers.length) * 100;

  box.innerHTML = `
    <div class="my-job-card">
      <div class="my-job-header">
        <div>
          <div class="my-job-family">${escapeHtml(job.title)}</div>
          <h2 class="my-job-tier-name">${escapeHtml(tier.name)}</h2>
        </div>
        <div class="my-job-wage">${fmtMoney(tier.wage)}<span class="my-job-wage-label">/pay day</span></div>
      </div>
      ${tier.description ? `<p class="my-job-desc">${escapeHtml(tier.description)}</p>` : ""}

      ${tiers.length > 1 ? `
        <div class="tier-progress-wrap">
          <div class="tier-progress-bar-bg">
            <div class="tier-progress-bar-fill" style="width:${pctDone}%"></div>
          </div>
          <div class="tier-progress-steps">
            ${tiers.map((t, i) => `
              <div class="tier-progress-step ${i < tierIdx ? "past" : i === tierIdx ? "current" : ""}">
                <div class="tier-progress-dot"></div>
                <div class="tier-progress-label">${escapeHtml(t.name)}</div>
              </div>
            `).join("")}
          </div>
        </div>
        ${!isTop && job.autoPromoteWeeks > 0
          ? `<p class="muted-small tier-auto-note">${icon("repeat", 12)} Auto-promotes every ${job.autoPromoteWeeks} week${job.autoPromoteWeeks === 1 ? "" : "s"}. Next tier: <strong>${escapeHtml(tiers[tierIdx + 1].name)}</strong> (${fmtMoney(tiers[tierIdx + 1].wage)}/pay day)</p>`
          : isTop ? `<p class="muted-small tier-auto-note">🏆 Top tier. You've reached the highest level!</p>` : ""}
      ` : ""}
    </div>
  `;
}

/* ── Payslips ───────────────────────────────────────────────────────
   Each pay day saves a payslip with exactly what was paid (see
   buildPayslip in data-money.js), so these are records, not estimates —
   a later change to the wage or tax brackets doesn't change an old one. */
function payslipDateLabel(dateKey) {
  const date = new Date(dateKeyToUTC(dateKey) + 12 * 3600000);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const psPct = n => (Math.round(Number(n) * 100) / 100).toString() + "%";
function payslipHtml(p, latest = false) {
  const line = (label, amount, cls = "") => `<div class="ps-line ${cls}"><span>${label}</span><span>${amount}</span></div>`;
  const signed = n => (n < 0 ? "−" : "+") + fmtMoney(Math.abs(n));
  const k = p.kiwi;
  const bands = (p.taxBands || []).filter(b => b.amount > 0);
  const bandLines = bands.map((b, i) => line(
    b.rate > 0 ? `${psPct(b.rate)} on the ${i === 0 ? "first" : "next"} ${fmtMoney(b.amount)}` : `Tax-free ${i === 0 ? "first" : "next"} ${fmtMoney(b.amount)}`,
    fmtMoney(b.tax), "sub")).join("");
  const adjustments = [
    p.taxRefund > 0 ? line("Tax cut (life event)", signed(p.taxRefund), "ps-credit") : "",
    p.boost ? line(p.boost > 0 ? "Pay boost (life event)" : "Pay cut (life event)", signed(p.boost), p.boost > 0 ? "ps-credit" : "ps-debit") : ""
  ].join("");
  const kiwiBox = k && !k.paused ? `
    <section class="ps-savings" aria-label="KiwiSaver contributions">
      <div class="ps-panel-head"><h3>KiwiSaver savings</h3></div>
      <p class="ps-help">This money goes into your KiwiSaver, not your cash balance. Separate from take-home pay.</p>
      ${line("Your contribution", fmtMoney(k.you))}
      ${line(`Employer contribution (${psPct(k.employerRate)})`, fmtMoney(k.employerGross))}
      ${line(`Employer contribution tax (ESCT, ${psPct(k.esctRate)})`, "−" + fmtMoney(k.esct), "sub")}
      ${line("Government contribution", fmtMoney(k.govt))}
      ${line("Total added to KiwiSaver", fmtMoney(Math.round((k.you + k.employerNet + k.govt) * 100) / 100), "total")}
    </section>` : "";
  return `<article class="payslip ps-redesign" aria-label="Payslip for ${escapeHtml(payslipDateLabel(p.dateKey))}">
    <header class="ps-head">
      <div><div class="ps-kicker">${latest ? "Latest payslip" : "Payslip"}</div>
        <div class="ps-job">${escapeHtml(p.tier || p.job || "Pay record")}</div>
        ${p.job && p.tier && p.job !== p.tier ? `<div class="ps-help ps-role">${escapeHtml(p.job)}</div>` : ""}
      </div>
      <div class="ps-date"><span>Pay date</span><strong>${escapeHtml(payslipDateLabel(p.dateKey))}</strong></div>
    </header>
    <section class="ps-breakdown" style="padding-top:20px" aria-label="Pay breakdown">
      <h3>How your pay adds up</h3>
      <div class="ps-section">Earnings</div>
      ${p.attendance && p.attendance.expected > 0 ? line(`Wage ${fmtMoney(p.fullWage)} × ${p.attendance.done}/${p.attendance.expected} days logged`, "", "sub") : ""}
      ${line("Pay before tax", fmtMoney(p.gross))}
      <div class="ps-section">Deductions</div>
      ${line("Income tax (PAYE)", p.tax > 0 ? "−" + fmtMoney(p.tax) : fmtMoney(0), p.tax > 0 ? "ps-debit" : "")}
      ${bands.length && p.tax > 0 ? `<details class="ps-tax-details"><summary>View tax breakdown</summary><div>${bandLines}</div></details>` : ""}
      ${k && !k.paused ? line(`Your KiwiSaver contribution (${psPct(k.rate)})`, "−" + fmtMoney(k.you), "ps-debit") : ""}
      ${k && k.paused ? line("KiwiSaver", "Paused", "ps-paused") : ""}
      ${adjustments ? `<div class="ps-section">Life-event adjustments</div>${adjustments}` : ""}
      ${line("Take-home pay", fmtMoney(p.net), "total")}
    </section>${kiwiBox}
  </article>`;
}
function renderPayslips(me, cls) {
  const box = document.getElementById("payslipBox");
  if (!box) return;
  const slips = Array.isArray(me.payslips) ? me.payslips : [];
  let next = "";
  const job = me.jobId ? (cls.jobs || []).find(j => j.id === me.jobId) : null;
  if (job && cls.payDay) {
    const lt = jobLogType(job), att = wageAttendance(cls, me);
    const est = wageCreditEstimate(cls, me, att);
    const approved = isJobTaskApprovedThisWeek(me, cls);
    const payNote = lt === "tasks" ? (approved ? "This week's job task is approved." : "Your teacher still needs to approve this week's job task.")
      : att.expected === 0 ? "No check-in is due this pay cycle, so you'd be paid in full."
      : `Paid automatically: your wage (${fmtMoney(est.fullWage)}) × days logged ÷ days possible. You've logged ${att.done} of ${att.expected} so far, so ${att.done}/${att.expected} of your wage.`;
    const paidToday = me.lastWagePaid === nzDateKey();
    if ((est.gross > 0 || att) && !paidToday) {
      next = `<aside class="ps-upcoming" aria-label="Next pay estimate">
        <div class="ps-upcoming-main"><div><span class="ps-kicker">Next pay estimate</span><strong>${escapeHtml(DAY_FULL[cls.payDay] || cls.payDay)}</strong></div>
        <div class="ps-upcoming-amount"><strong>${fmtMoney(est.net)}</strong><span>estimated take-home</span></div></div>
        <p>${fmtMoney(est.gross)} before tax. ${payNote}</p>
      </aside>`;
    }
  }
  if (!slips.length) {
    box.innerHTML = next + `<div class="ps-empty"><strong>No payslips yet</strong><p>${job ? "Your first payslip will appear after pay day. It will show your earnings, deductions and take-home pay." : "Once you have a job, your payslips will appear here after each pay day."}</p></div>`;
    return;
  }
  const [latest, ...older] = slips;
  box.innerHTML = next + payslipHtml(latest, true) + (older.length ? `
    <section class="ps-older" aria-label="Earlier payslips">
      <div class="ps-history-heading"><h3>Earlier payslips</h3><span>${older.length} ${older.length === 1 ? "payslip" : "payslips"}</span></div>
      <p class="ps-help">Select a payslip to see its breakdown.</p>
      ${older.map(p => `<details class="ps-older-item"><summary>
        <span class="ps-history-info"><strong>${escapeHtml(payslipDateLabel(p.dateKey))}</strong><span>${escapeHtml(p.tier || p.job || "Pay record")}</span></span>
        <span class="ps-history-money"><strong>${fmtMoney(p.net)}</strong><span>take-home</span></span><span class="ps-chevron" aria-hidden="true"></span>
        </summary>${payslipHtml(p)}</details>`).join("")}
    </section>` : "");
}

/* ── Job board ──────────────────────────────────────────────────────── */
function renderJobBoard(me, cls) {
  const grid = document.getElementById("jobBoardGrid");
  grid.innerHTML = "";
  const jobs = (cls.jobs || []).filter(j => j.tiers && j.tiers.length);
  document.getElementById("noJobs").classList.toggle("hidden", jobs.length > 0);

  jobs.forEach(j => {
    const isMine    = me.jobId === j.id;
    const myTier    = isMine ? getStudentTier(j, me) : null;
    const myApp     = (cls.jobApplications || []).find(a => a.jobId === j.id && a.studentUser === me.username && a.status === "pending");
    const tiers     = j.tiers || [];

    const card = document.createElement("div");
    card.className = "job-board-card" + (isMine ? " is-mine" : "");
    card.innerHTML = `
      <div class="job-board-header">
        <div>
          <h3 class="job-board-title">${escapeHtml(j.title)}</h3>
          ${isMine ? `<span class="badge mint">Your job</span>` : ""}
        </div>
      </div>
      <div class="job-board-tiers">
        ${tiers.map((t, i) => `
          <div class="job-board-tier-row ${isMine && myTier && t.id === myTier.id ? "active" : ""}">
            <span class="job-board-tier-num">${i + 1}</span>
            <div class="job-board-tier-info">
              <strong>${escapeHtml(t.name)}</strong>
              ${t.description ? `<span class="muted-small">: ${escapeHtml(t.description)}</span>` : ""}
            </div>
            <span class="job-board-tier-wage">${fmtMoney(t.wage)}</span>
            ${isMine && myTier && t.id === myTier.id ? `<span class="badge gold" style="flex-shrink:0;">You</span>` : ""}
          </div>
        `).join("")}
      </div>
      ${j.autoPromoteWeeks > 0 ? `<p class="muted-small" style="margin:10px 0 0;">${icon("repeat", 11)} Auto-promotes every ${j.autoPromoteWeeks} week${j.autoPromoteWeeks === 1 ? "" : "s"}</p>` : ""}
      <p class="muted-small" style="margin:10px 0 0;">${escapeHtml(jobLogSummary(j))}</p>
      <div class="job-board-footer">
        ${isMine
          ? `<span class="muted-small">You work here. Starting pay: ${fmtMoney(tiers[0] ? tiers[0].wage : 0)}/pay day</span>`
          : myApp
            ? `<span class="status-pending">Application pending</span>`
            : me.jobId
              ? `<span class="muted-small">Switch to this job?</span> <button class="btn small secondary" onclick="applyForJob('${j.id}')">Apply</button>`
              : `<button class="btn small gold" onclick="applyForJob('${j.id}')">${icon("send", 13)} Apply</button>`
        }
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ── Apply dialog ───────────────────────────────────────────────────── */
let APPLYING_JOB_ID = null;
function applyForJob(jobId) {
  APPLYING_JOB_ID = jobId;
  const j = JOBS_CACHE.find(jj => jj.id === jobId);
  document.getElementById("applyJobName").textContent = j ? j.title : "";
  document.getElementById("applyStartingTier").textContent = j && j.tiers && j.tiers[0]
    ? `Starting tier: ${j.tiers[0].name} (${fmtMoney(j.tiers[0].wage)}/pay day)`
    : "";
  document.getElementById("applyLetter").value = "";
  document.getElementById("applyModal").classList.remove("hidden");
  document.getElementById("applyModalMsg").textContent = "";
}
function closeApplyModal() {
  document.getElementById("applyModal").classList.add("hidden");
  APPLYING_JOB_ID = null;
}
async function submitApplication() {
  if (!APPLYING_JOB_ID) return;
  const letter = document.getElementById("applyLetter").value.trim();
  const btn    = document.getElementById("submitApplyBtn");
  btn.disabled = true;
  try {
    await applyForJob_data(CLASS_CODE, APPLYING_JOB_ID, CURRENT.username, letter);
    document.getElementById("applyModalMsg").textContent = "Application sent!";
    document.getElementById("applyModalMsg").className   = "success-msg";
    setTimeout(closeApplyModal, 1200);
    await render();
  } catch (e) {
    document.getElementById("applyModalMsg").textContent = e.message || "Couldn't submit. Try again.";
    document.getElementById("applyModalMsg").className   = "error-msg";
  } finally {
    btn.disabled = false;
  }
}

/* We alias because the function name `applyForJob` is used for the
   UI trigger; the data layer call has the same spirit but a different name. */
async function applyForJob_data(classCode, jobId, studentUser, letter) {
  const classRef = classesCol().doc(classCode);
  let jobTitle = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) throw new Error("Class not found.");
    const cls = snap.data();
    const job = (cls.jobs || []).find(j => j.id === jobId);
    if (!job) throw new Error("That job no longer exists.");
    jobTitle = job.title || "";
    const existing = (cls.jobApplications || []).find(
      a => a.jobId === jobId && a.studentUser === studentUser && a.status === "pending"
    );
    if (existing) throw new Error("You already have a pending application for this job.");
    const apps = cls.jobApplications || [];
    apps.push({ id: uid("a"), jobId, studentUser, coverLetter: letter, status: "pending", date: nowStr() });
    t.update(classRef, { jobApplications: apps });
  });
  // Tell the teacher (best-effort; the application itself is already saved).
  await t29NotifyTeacher(classCode, "job", "req", jobTitle);
}

/* ── My applications (student) ─────────────────────────────────────── */
function renderMyApplications(me, cls) {
  const myApps = (cls.jobApplications || []).filter(a => a.studentUser === me.username);
  const box    = document.getElementById("myApplicationsBox");
  if (!myApps.length) { box.innerHTML = `<p class="muted-small">${me.jobId ? "No applications." : "You haven't applied for any jobs yet. Pick one on the job board above."}</p>`; return; }
  box.innerHTML = "";
  [...myApps].reverse().forEach(a => {
    const j   = (cls.jobs || []).find(jj => jj.id === a.jobId);
    const row = document.createElement("div");
    row.className = "auto-row";
    const statusBadge =
      a.status === "pending"  ? `<span class="status-pending">Pending</span>`  :
      a.status === "approved" ? `<span class="status-approved">Approved</span>` :
                                `<span class="status-declined">Declined</span>`;
    row.innerHTML = `
      <div class="auto-details">
        <strong>${j ? escapeHtml(j.title) : "Unknown job"}</strong>
        ${j && j.tiers && j.tiers[0] ? `<div class="muted-small">Entry tier: ${escapeHtml(j.tiers[0].name)}</div>` : ""}
        ${a.coverLetter ? `<div class="muted-small">"${escapeHtml(a.coverLetter)}"</div>` : ""}
        <div class="muted-small">${a.date || ""}</div>
      </div>
      ${statusBadge}
    `;
    box.appendChild(row);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   PROMOTION POPUP  (shown to students on page load)
══════════════════════════════════════════════════════════════════════ */
function showPromotionPopup(promo) {
  const existing = document.getElementById("t29LevelupOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "t29LevelupOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(14,27,55,0.78);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="levelup-card-card">
      <div class="levelup-card-stars">✦ ✦ ✦</div>
      <div class="levelup-card-emoji">🎉</div>
      <h2 class="levelup-card-title">You've been offered a promotion!</h2>
      <p class="levelup-card-sub">Move up to</p>
      <div class="levelup-card-tier">
        <div class="levelup-card-tier-name">${promo.tierName}</div>
        <div class="levelup-card-tier-meta">${promo.jobTitle} &middot; ${fmtMoney(promo.wage)}/pay day</div>
      </div>
      <div class="levelup-card-actions">
        <button class="btn secondary" onclick="respondPromotionPopup(false)">Not right now</button>
        <button class="btn gold" onclick="respondPromotionPopup(true)">🎉 Accept</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function respondPromotionPopup(accept) {
  const overlay = document.getElementById("t29LevelupOverlay");
  if (overlay) overlay.querySelectorAll("button").forEach(b => b.disabled = true);
  try {
    await respondToPromotion(CURRENT.username, accept);
  } catch (e) {}
  if (overlay) overlay.remove();
  await render();
}

/* ══════════════════════════════════════════════════════════════════════
   JOB LOGS: teacher settings, pay-cycle tracker, student check-in / questionnaire
══════════════════════════════════════════════════════════════════════ */
const LOG_TYPE_INFO = [
  { key: "tasks",   name: "Tasks",         desc: "You tick off each student's job task once per pay cycle." },
  { key: "checkin", name: "Check-ins",     desc: "Students check in during a time window you set." },
  { key: "quiz",    name: "Questionnaire", desc: "Students answer your questions correctly once a day." }
];
const jlPlural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function jlDur(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m} min`; }
function jobLogDateLabel(key) { return new Date(dateKeyToUTC(key)).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
function jlNextDay(s) { let k = nzDateKey(); for (let i = 0; i < 21; i++) { k = jobLogDateAdd(k, 1); if (jobLogDayActive(s, k)) return k; } return null; }
function mins2time(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
function time2mins(v) { const m = /^(\d{1,2}):(\d{2})/.exec(v || ""); return m ? Math.min(1435, (+m[1]) * 60 + (+m[2])) : null; }

function jobLogSummary(job) {
  const type = jobLogType(job), s = jobLogSettings(job);
  if (type === "tasks") return "The teacher ticks off the job task each pay cycle.";
  const win = s.windowOn ? `${jobLogTimeLabel(s.startMin)} to ${jobLogTimeLabel(s.startMin + s.winMins)}` : "";
  const weekly = s.freq === "weekly", every = s.freq === "interval", dl = jobLogDaysLabel(s.days);
  const need = weekly ? "Paid in full once done that week." : every ? "Paid automatically for the check-ins done (e.g. 1 of 2 due = half the wage)." : `Paid automatically for the days logged (3 of ${s.days.length} days = 3/${s.days.length} of the wage).`;
  const when = weekly ? `once a week, on any of ${dl}` : every ? `every ${s.every} school days (${dl}), starting ${jobLogDateLabel(s.startKey)}` : dl;
  if (type === "checkin") return `Check in ${when}${win ? `, ${win}` : ""}. ${need}`;
  const n = s.questions.length, asked = s.perDay > 0 && s.perDay < n ? s.perDay : n;
  return `${jlPlural(asked, "question")} each time${n > asked ? ` from a pool of ${n}` : ""}, ${when}${win ? `, ${win}` : ""}. ${need}`;
}

/* The week at a glance: one small box per day of the pay cycle. */
function jlDotsHtml(st) {
  return `<div class="jl-dots" role="list" aria-label="This pay cycle">${st.days.map(d => {
    const cl = [d.done ? "done" : "", !d.active && !d.done ? "off" : "", d.active && d.past && !d.done ? "missed" : "", d.today ? "today" : ""].filter(Boolean).join(" ");
    const lab = JOB_LOG_DAY_FULL[d.day] + (d.done ? ", done" : !d.active ? ", no log" : d.past ? ", missed" : d.today ? ", today" : "");
    return `<span class="jl-dot ${cl}" role="listitem" title="${lab}" aria-label="${lab}">${d.day.slice(0, 2)}</span>`;
  }).join("")}</div>`;
}

/* ── Teacher: log settings inside the create / edit forms ──────────── */
function logState(prefix) { return prefix === "add" ? ADD_LOG : EDIT_LOG; }
function newLogState(job) {
  const s = jobLogSettings(job || {});
  return {
    type: jobLogType(job), days: s.days.slice(), freq: s.freq, every: s.every, startKey: s.startKey, startMin: s.startMin, winMins: s.winMins,
    windowOn: s.windowOn, attempts: s.attempts, perDay: s.perDay,
    questions: s.questions.map(q => q.type === "text"
      ? { id: q.id, type: "text", prompt: q.prompt, options: ["", ""], correct: 0, answersText: (q.answers || []).join("\n") }
      : { id: q.id, type: "choice", prompt: q.prompt, options: q.options.slice(), correct: q.correct, answersText: "" })
  };
}
function blankQuestion() { return { id: "", type: "choice", prompt: "", options: ["", "", ""], correct: 0, answersText: "" }; }

function renderLogBox(prefix) {
  const el = document.getElementById(prefix === "add" ? "addLogBox" : "editLogBox"), st = logState(prefix);
  if (!el || !st) return;
  const p = `'${prefix}'`;
  const types = LOG_TYPE_INFO.map(t => `<button type="button" class="jl-type${st.type === t.key ? " on" : ""}" role="radio" aria-checked="${st.type === t.key}" onclick="setLogType(${p},'${t.key}')"><strong>${t.name}</strong><span>${t.desc}</span></button>`).join("");
  const body = st.type === "tasks"
    ? `<p class="muted-small" style="margin:12px 0 0;">Each pay cycle you tick off the student's job task, on your Dashboard or in the pay cycle list on this page. Students have nothing to log.</p>`
    : logSettingsHtml(prefix, st);
  el.innerHTML = `<div class="jl-box"><div class="jl-title">How students log their work</div><div class="jl-types" role="radiogroup" aria-label="Log type">${types}</div>${body}</div>`;
}

function logSettingsHtml(prefix, st) {
  const p = `'${prefix}'`, isQuiz = st.type === "quiz", weekly = st.freq === "weekly", every = st.freq === "interval";
  const chip1 = (on, label, f) => `<button type="button" class="jl-chip${on ? " on" : ""}" aria-pressed="${on}" onclick="setLogFreq(${p},'${f}')">${label}</button>`;
  const chips = JOB_LOG_DAY_KEYS.map(d => `<button type="button" class="jl-chip${st.days.includes(d) ? " on" : ""}" aria-pressed="${st.days.includes(d)}" title="${JOB_LOG_DAY_FULL[d]}" onclick="toggleLogDay(${p},'${d}')">${d}</button>`).join("");
  const num = (label, field, min, max, val, hint) => `<div><label>${label}</label><input type="number" min="${min}" max="${max}" step="1" value="${val}" oninput="setLogNum(${p},'${field}',this.value)">${hint ? `<span class="muted-small">${hint}</span>` : ""}</div>`;
  const windowFields = (!isQuiz || st.windowOn) ? `<div class="jl-grid">
      <div><label>${isQuiz ? "Opens at" : "Check-in opens at"}</label><input type="time" value="${mins2time(st.startMin)}" oninput="setLogTime(${p},this.value)"></div>
      ${num("Open for (minutes)", "winMins", 5, 240, st.winMins, "")}
    </div>` : "";
  return `<div class="jl-grid">
      <div class="jl-span"><label>${weekly ? "Days students can log on (they pick one)" : every ? "School days (only these count)" : "Days it runs"}</label><div class="jl-chips">${chips}</div></div>
      <div class="jl-span"><label>How often</label><div class="jl-chips">${chip1(!weekly, "Every day it runs", "daily")}${chip1(every, "Every few school days", "interval")}${chip1(weekly, "Once a week", "weekly")}</div>
        <span class="muted-small">${weekly ? "Students log once per pay cycle, on any one of the days above, and are paid in full for it." : every ? "Students log on every 2nd (or 3rd…) school day from the start date, so a 6-day timetable fits a 5-day week. Pay is automatic: check-ins done ÷ check-ins due that week." : "Pay is automatic on pay day: wage × days logged ÷ days it runs (e.g. 3 of 5 days = 3/5 of the wage). No teacher tick needed."}</span></div>
      ${every ? `<div><label>Log every (school days)</label><input type="number" min="2" max="6" step="1" value="${st.every}" oninput="setLogNum(${p},'every',this.value)"><span class="muted-small">2 = every second school day.</span></div>
      <div><label>Starting on</label><input type="date" value="${st.startKey}" onchange="setLogStart(${p},this.value)"><span class="muted-small">Day 1 is the first school day on or after this date.</span></div>` : ""}
      ${isQuiz ? num("Attempts per day", "attempts", 1, 5, st.attempts, "Tries a student gets to answer everything right.") : ""}
      ${isQuiz ? num("Questions asked per day", "perDay", 0, 30, st.perDay, "0 asks every question. Otherwise each student gets a random set from your pool.") : ""}
    </div>
    ${isQuiz ? `<label class="jl-check"><input type="checkbox" ${st.windowOn ? "checked" : ""} onchange="setLogWindowOn(${p},this.checked)"> Only allow the questionnaire within a time window</label>` : ""}
    ${windowFields}
    ${isQuiz ? questionsHtml(prefix, st) : `<p class="muted-small" style="margin:12px 0 0;">Students check in on the Jobs page. A check-in only counts inside the window, in New Zealand time.</p>`}`;
}

function questionsHtml(prefix, st) {
  const p = `'${prefix}'`;
  const rows = st.questions.map((q, i) => {
    const detail = q.type === "choice" ? `
      <label>Answer choices. Select the correct one.</label>
      ${q.options.map((o, oi) => `<div class="jl-opt"><input type="radio" name="jlq-${prefix}-${i}" ${q.correct === oi ? "checked" : ""} aria-label="Correct answer" onchange="setQuestionCorrect(${p},${i},${oi})"><input type="text" maxlength="100" value="${escapeHtml(o)}" placeholder="Choice ${oi + 1}" oninput="setQuestionOption(${p},${i},${oi},this.value)">${q.options.length > 2 ? `<button type="button" class="btn small secondary" onclick="removeQuestionOption(${p},${i},${oi})">Remove</button>` : ""}</div>`).join("")}
      ${q.options.length < 6 ? `<button type="button" class="btn small secondary" onclick="addQuestionOption(${p},${i})">Add choice</button>` : ""}`
      : `<label>Accepted answers, one per line</label>
      <textarea rows="3" placeholder="e.g. Wellington" oninput="setQuestionField(${p},${i},'answersText',this.value)">${escapeHtml(q.answersText)}</textarea>
      <p class="muted-small" style="margin:6px 0 0;">Capital letters, punctuation and extra spaces are ignored. List any other spellings you would accept.</p>`;
    return `<div class="tier-form-row">
      <div class="tier-form-row-header"><span class="tier-form-label">Question ${i + 1}</span>
        <select class="jl-qtype" aria-label="Question type" onchange="setQuestionType(${p},${i},this.value)"><option value="choice"${q.type === "choice" ? " selected" : ""}>Multiple choice</option><option value="text"${q.type === "text" ? " selected" : ""}>Short answer</option></select>
        <button type="button" class="btn small coral" onclick="removeQuestion(${p},${i})">Remove</button></div>
      <label style="margin-top:0;">Question</label>
      <input type="text" maxlength="200" value="${escapeHtml(q.prompt)}" placeholder="e.g. What is the capital of New Zealand?" oninput="setQuestionField(${p},${i},'prompt',this.value)">
      ${detail}</div>`;
  }).join("");
  return `<div class="jl-title" style="margin-top:22px;">Questions</div>${rows}
    <button type="button" class="btn small secondary" onclick="addQuestion(${p})">Add question</button>`;
}

function setLogType(prefix, type) { const st = logState(prefix); st.type = type; if (type === "quiz" && !st.questions.length) st.questions.push(blankQuestion()); renderLogBox(prefix); }
function setLogFreq(prefix, f) { logState(prefix).freq = ["weekly", "interval"].includes(f) ? f : "daily"; renderLogBox(prefix); }
function setLogStart(prefix, v) { if (/^\d{4}-\d{2}-\d{2}$/.test(v || "")) logState(prefix).startKey = v; }
function toggleLogDay(prefix, d) {
  const st = logState(prefix), has = st.days.includes(d);
  if (has && st.days.length === 1) return;
  st.days = JOB_LOG_DAY_KEYS.filter(x => x === d ? !has : st.days.includes(x));
  renderLogBox(prefix);
}
function setLogNum(prefix, field, v) { logState(prefix)[field] = v; }
function setLogTime(prefix, v) { const m = time2mins(v); if (m !== null) logState(prefix).startMin = m; }
function setLogWindowOn(prefix, on) { logState(prefix).windowOn = !!on; renderLogBox(prefix); }
function addQuestion(prefix) { logState(prefix).questions.push(blankQuestion()); renderLogBox(prefix); }
function removeQuestion(prefix, i) { logState(prefix).questions.splice(i, 1); renderLogBox(prefix); }
function setQuestionField(prefix, i, f, v) { logState(prefix).questions[i][f] = v; }
function setQuestionType(prefix, i, v) { logState(prefix).questions[i].type = v; renderLogBox(prefix); }
function setQuestionOption(prefix, i, oi, v) { logState(prefix).questions[i].options[oi] = v; }
function setQuestionCorrect(prefix, i, oi) { logState(prefix).questions[i].correct = oi; }
function addQuestionOption(prefix, i) { logState(prefix).questions[i].options.push(""); renderLogBox(prefix); }
function removeQuestionOption(prefix, i, oi) {
  const q = logState(prefix).questions[i];
  q.options.splice(oi, 1);
  if (q.correct === oi) q.correct = 0; else if (q.correct > oi) q.correct--;
  renderLogBox(prefix);
}

// Checks the form and returns what addJob / updateJob expect. Throws a readable message if something's missing.
function readLogForm(prefix) {
  const st = logState(prefix);
  if (!st || st.type === "tasks") return { logType: "tasks", log: null };
  const days = JOB_LOG_DAY_KEYS.filter(d => st.days.includes(d));
  const log = { days, freq: ["weekly", "interval"].includes(st.freq) ? st.freq : "daily", every: _jlInt(st.every, 2, 6, 2), startKey: /^\d{4}-\d{2}-\d{2}$/.test(st.startKey || "") ? st.startKey : nzDateKey(), startMin: _jlInt(st.startMin, 0, 1435, 540),
                winMins: _jlInt(st.winMins, 5, 240, 15), windowOn: st.type === "checkin" ? true : !!st.windowOn };
  if (st.type === "quiz") {
    if (!st.questions.length) throw new Error("Add at least one question.");
    log.questions = st.questions.map((q, i) => {
      const n = i + 1, prompt = q.prompt.trim();
      if (!prompt) throw new Error(`Question ${n} needs some text.`);
      if (q.type === "text") {
        const answers = q.answersText.split("\n").map(a => a.trim()).filter(Boolean);
        if (!answers.length) throw new Error(`Question ${n} needs at least one accepted answer.`);
        return { id: q.id || uid("q"), type: "text", prompt, answers };
      }
      const options = q.options.map(o => o.trim());
      if (options.filter(Boolean).length < 2) throw new Error(`Question ${n} needs at least two answer choices.`);
      if (!options[q.correct]) throw new Error(`Question ${n}: select which choice is correct.`);
      return { id: q.id || uid("q"), type: "choice", prompt, options, correct: q.correct };
    });
    log.attempts = _jlInt(st.attempts, 1, 5, 2);
    log.perDay = _jlInt(st.perDay, 0, log.questions.length, 0);
  }
  return { logType: st.type, log };
}

/* ── Teacher: who has met their requirement this pay cycle ─────────── */
function renderLogTracker(cls, students) {
  const box = document.getElementById("logTrackerBox"), hint = document.getElementById("logTrackerHint");
  if (!box) return;
  const keys = jobLogCycleKeys(cls), jobs = cls.jobs || [];
  if (hint) hint.textContent = `${jobLogDateLabel(keys[0])} to ${jobLogDateLabel(keys[6])}. Pay day is ${JOB_LOG_DAY_FULL[cls.payDay || "Fri"] || "set above"}.`;
  const rows = students.filter(s => s.role !== "teacher" && jobs.some(j => j.id === s.jobId))
    .sort((a, b) => jobs.findIndex(j => j.id === a.jobId) - jobs.findIndex(j => j.id === b.jobId) || String(a.name || a.username).localeCompare(String(b.name || b.username)));
  box.innerHTML = rows.length ? rows.map(s => trackerRowHtml(s, jobs.find(j => j.id === s.jobId), cls)).join("")
    : `<p class="muted-small">No students have a job yet.</p>`;
}
function trackerRowHtml(s, job, cls) {
  const type = jobLogType(job), st = jobLogStatus(s, job, cls), u = escapeJsAttr(s.username);
  let line, badge = "", action = "", dots = "";
  if (type === "tasks") {
    line = st.ticked ? "Job task ticked off" : "Job task not ticked off yet";
    badge = st.ticked ? `<span class="badge mint">Done</span>` : "";
    action = `<button class="btn small ${st.ticked ? "secondary" : "mint"}" onclick="setTaskTick('${u}', ${!st.ticked})">${st.ticked ? "Undo" : "Tick off"}</button>`;
  } else {
    const t = st.today, unit = type === "checkin" ? "check-ins" : "days passed";
    const todayTxt = !t || !t.active ? "no log today"
      : t.done ? (type === "checkin" ? `checked in ${t.at}` : "passed today")
      : type === "checkin" ? "not checked in yet today"
      : t.tries ? `not passed today (${jlPlural(t.tries, "attempt")})` : "not attempted yet today";
    line = `${st.done} of ${st.expected} ${unit} (${Math.round(st.fraction * 100)}% of wage), ${todayTxt}`;
    dots = jlDotsHtml(st);
    badge = st.met ? `<span class="badge mint">Full pay</span>` : !st.reachable ? `<span class="badge coral">${st.done ? "Part pay" : "Missed"}</span>` : "";
  }
  return `<div class="auto-row">
    <div class="auto-details"><strong>${escapeHtml(s.name || s.username)}</strong> <span class="muted-small">${escapeHtml(job.title)}</span>
      <div class="muted-small">${escapeHtml(line)}</div></div>
    <div class="jl-track-right">${dots}${badge}${action}</div></div>`;
}
async function setTaskTick(username, on) { await setJobTaskApproval(CLASS_CODE, username, on); await render(); }

/* ── Student: check-in / questionnaire card ────────────────────────── */
function renderJobLog(me, cls) { LOG_CTX = { me, cls }; paintJobLog(); }
function paintJobLog() {
  const card = document.getElementById("jobLogCard"), box = document.getElementById("jobLogBox");
  if (!card || !box || !LOG_CTX) return;
  const { me, cls } = LOG_CTX;
  const job = me.jobId ? (cls.jobs || []).find(j => j.id === me.jobId) : null;
  card.classList.toggle("hidden", !job);
  if (!job) return;
  const type = jobLogType(job), st = jobLogStatus(me, job, cls), s = jobLogSettings(job);
  const payDayName = JOB_LOG_DAY_FULL[cls.payDay || "Fri"] || "pay day";
  document.getElementById("hJobLog").textContent = type === "checkin" ? "Daily check-in" : type === "quiz" ? "Daily questions" : "Job log";
  if (type === "tasks") {
    box.innerHTML = `<p class="muted-small" style="margin:0 0 12px;">Your teacher ticks off your job task once each pay cycle. Your wage is paid on ${payDayName} once it has been ticked off.</p>
      <span class="badge ${st.ticked ? "mint" : "navy"}">${st.ticked ? "Ticked off for this pay cycle" : "Not ticked off yet"}</span>`;
    if (!st.ticked) {
      const left = jobTickRequestsLeft(me);
      box.innerHTML += `<div class="jl-now" style="margin-top:12px;"><div class="jl-now-text"><strong>Finished your task?</strong><span class="muted-small">${left ? `Ask your teacher to tick it off. ${jlPlural(left, "request")} left today (max 3 a day).` : "You've used all 3 requests for today. Try again tomorrow."}</span></div>
        <button class="btn gold" type="button" ${left ? "" : "disabled"} onclick="doRequestTick(this)">Request tick-off</button></div>`;
    }
    return;
  }
  const w = jobLogWindowState(job), t = st.today, weekly = s.freq === "weekly";
  const whenTxt = weekly ? `once a week, on any of ${jobLogDaysLabel(s.days)}` : s.freq === "interval" ? `every ${s.every} school days from ${jobLogDateLabel(s.startKey)}` : jobLogDaysLabel(s.days);
  const winTxt = s.windowOn ? ` between ${jobLogTimeLabel(s.startMin)} and ${jobLogTimeLabel(s.startMin + s.winMins)}` : "";
  const intro = type === "checkin" ? `Check in${winTxt}, ${whenTxt}.`
    : `Answer ${s.perDay > 0 && s.perDay < s.questions.length ? jlPlural(s.perDay, "question") : "all the questions"} correctly${winTxt}, ${whenTxt}.`;
  const triesLeft = Math.max(0, s.attempts - (t ? t.tries : 0));
  let head, sub = "", btn = "";
  if (t && t.done) { head = type === "checkin" ? "You've checked in today" : "Today's questions are done"; sub = t.at ? `Counted at ${t.at}.` : "Counted for today."; }
  else if (weekly && st.done > 0) { head = "You're done for this week"; sub = "Your weekly log is counted."; }
  else if (w.state === "off") { head = "Nothing to do today"; { const nk = s.freq === "interval" ? jlNextDay(s) : null; sub = nk ? `Your next check-in is ${jobLogDateLabel(nk)}.` : `The log runs ${jobLogDaysLabel(s.days)}.`; } }
  else if (w.state === "early") { head = `Opens at ${jobLogTimeLabel(s.startMin)}`; sub = `In ${jlDur(w.opensIn)}.`; }
  else if (w.state === "closed") { head = "Today's window has closed"; sub = type === "checkin" ? "You missed today's check-in." : "Today wasn't completed in time."; }
  else if (type === "checkin") { head = "Check-in is open"; sub = w.closesIn != null ? `Closes in ${jlDur(w.closesIn)}.` : ""; btn = `<button class="btn gold" type="button" onclick="doLogCheckin(this)">Check in now</button>`; }
  else if (!s.questions.length) { head = "No questions yet"; sub = "Your teacher hasn't added any questions."; }
  else if (!triesLeft) { head = "No attempts left today"; sub = "Come back tomorrow for a fresh set."; }
  else { head = "Today's questions are ready"; sub = `${jlPlural(triesLeft, "attempt")} left${w.closesIn != null ? `, closes in ${jlDur(w.closesIn)}` : ""}.`; btn = `<button class="btn gold" type="button" onclick="openLogQuiz()">${t && t.tries ? "Try again" : "Start questions"}</button>`; }
  const unit = type === "checkin" ? "check-ins" : "days", pct = Math.round(st.fraction * 100);
  const req = !weekly && st.expected === 0 ? `No check-in is due this pay cycle, so you'll be paid in full on ${payDayName}.`
    : weekly
    ? (st.done ? `Your weekly log is done, so you'll be paid in full on ${payDayName}.` : `Log once this pay cycle to be paid on ${payDayName}. No log means no pay.` + (st.reachable ? "" : " There are no log days left this cycle."))
    : `${st.done} of ${st.expected} ${unit} logged this pay cycle. You're paid automatically on ${payDayName}: your wage × days logged ÷ ${st.expected} (${st.done}/${st.expected} = ${pct}% so far). Days you miss aren't paid. No teacher tick needed.`;
  box.innerHTML = `<p class="muted-small" style="margin:0;">${escapeHtml(intro)}</p>
    <div class="jl-now"><div class="jl-now-text"><strong>${escapeHtml(head)}</strong>${sub ? `<span class="muted-small">${escapeHtml(sub)}</span>` : ""}</div>${btn}</div>
    ${jlDotsHtml(st)}<p class="muted-small jl-req">${escapeHtml(req)}</p>`;
}

async function doRequestTick(btn) {
  if (btn) btn.disabled = true;
  const msg = document.getElementById("jobLogMsg");
  const res = await requestJobTick(CURRENT.username, CLASS_CODE);
  if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; await render(); return; }
  await render();
  flashMsg(msg, `<div class="success-msg">Request sent. Your teacher has been notified.</div>`, 6000);
}

async function doLogCheckin(btn) {
  if (btn) btn.disabled = true;
  const msg = document.getElementById("jobLogMsg");
  const res = await jobLogCheckin(CURRENT.username, CLASS_CODE);
  if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; await render(); return; }
  await render();
  flashMsg(msg, `<div class="success-msg">You're checked in at ${escapeHtml(res.at)}.</div>`, 6000);
}

/* Questionnaire dialog */
function openLogQuiz() {
  if (!LOG_CTX) return;
  const { me, cls } = LOG_CTX, job = (cls.jobs || []).find(j => j.id === me.jobId);
  if (!job) return;
  const view = jobQuizView(job, CURRENT.username, nzDateKey());
  if (!view.length) return;
  const st = jobLogStatus(me, job, cls), s = jobLogSettings(job);
  QUIZ = { view, answers: {}, wrong: [], msg: "", done: false, busy: false, triesLeft: Math.max(0, s.attempts - (st.today ? st.today.tries : 0)) };
  document.getElementById("logQuizModal").classList.remove("hidden");
  renderLogQuiz();
}
function closeLogQuiz() { document.getElementById("logQuizModal").classList.add("hidden"); QUIZ = null; }
function setQuizAnswer(id, val, el) {
  if (!QUIZ) return;
  QUIZ.answers[id] = val;
  if (el && el.type === "radio") el.closest(".quiz-question").querySelectorAll(".quiz-option").forEach(o => o.classList.toggle("chosen", o.querySelector("input").checked));
}
function renderLogQuiz() {
  const body = document.getElementById("logQuizBody");
  if (!body || !QUIZ) return;
  const q = QUIZ;
  const qs = q.view.map((item, n) => {
    const bad = q.wrong.includes(item.id), id = escapeJsAttr(item.id), cur = q.answers[item.id];
    const input = item.type === "text"
      ? `<input type="text" maxlength="120" autocomplete="off" placeholder="Type your answer" value="${escapeHtml(cur || "")}" ${q.done ? "disabled" : ""} oninput="setQuizAnswer('${id}', this.value, this)">`
      : item.options.map(o => { const on = cur !== undefined && String(cur) === String(o.i);
          return `<label class="quiz-option${on ? " chosen" : ""}"><input type="radio" name="lq-${escapeHtml(item.id)}" ${on ? "checked" : ""} ${q.done ? "disabled" : ""} onchange="setQuizAnswer('${id}', ${o.i}, this)"><span>${escapeHtml(o.text)}</span></label>`; }).join("");
    return `<div class="quiz-question${bad ? " jl-wrong" : ""}"><p class="qtext">${n + 1}. ${escapeHtml(item.prompt)}</p>${input}${bad ? `<p class="jl-q-note">Not quite. Have another look.</p>` : ""}</div>`;
  }).join("");
  body.innerHTML = `${q.done ? "" : `<p class="muted-small" style="margin:0 0 14px;">Answer every question correctly to count today. ${jlPlural(q.triesLeft, "attempt")} left.</p>`}${qs}${q.msg}
    <div style="margin-top:14px;">${q.done ? `<button class="btn" type="button" onclick="closeLogQuiz()">Close</button>` : `<button class="btn gold" type="button" onclick="submitLogQuiz()"${q.busy ? " disabled" : ""}>Submit answers</button>`}</div>`;
}
async function submitLogQuiz() {
  const q = QUIZ;
  if (!q || q.busy) return;
  if (q.view.some(item => { const a = q.answers[item.id]; return a === undefined || String(a).trim() === ""; })) {
    q.msg = `<div class="error-msg">Answer every question before you submit.</div>`; renderLogQuiz(); return;
  }
  q.busy = true; q.msg = ""; renderLogQuiz();
  const res = await jobQuizSubmit(CURRENT.username, CLASS_CODE, q.answers);
  q.busy = false;
  if (!res.ok) { q.msg = `<div class="error-msg">${escapeHtml(res.error)}</div>`; renderLogQuiz(); return; }
  q.wrong = res.wrong; q.triesLeft = res.triesLeft;
  if (res.passed) { q.done = true; q.msg = `<div class="success-msg">All ${res.total} correct. Today's log is counted.</div>`; }
  else {
    res.wrong.forEach(id => { delete q.answers[id]; });
    const got = `${res.total - res.wrong.length} of ${res.total} correct.`;
    if (res.triesLeft > 0) q.msg = `<div class="error-msg">${got} Fix the marked ${res.wrong.length === 1 ? "question" : "questions"} and submit again. ${jlPlural(res.triesLeft, "attempt")} left.</div>`;
    else { q.done = true; q.msg = `<div class="error-msg">${got} You're out of attempts for today. Try again tomorrow.</div>`; }
  }
  renderLogQuiz();
  await render();
}
// The check-in window moves with the clock, so keep the card current without a reload.
setInterval(() => { if (!document.hidden && LOG_CTX) paintJobLog(); }, 20000);

document.addEventListener("DOMContentLoaded", init);
