let CURRENT, IS_TEACHER, CLASS_CODE;
let JOBS_CACHE = [];

/* ── Avatar helpers (also in teacher.js / student.js — duplicated here
      since jobs.html loads only data.js + jobs.js) ────────────────── */
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
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
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
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href       = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  paintChrome();

  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(autoPayDayIfDue(CLASS_CODE), "autoPayDayIfDue"),
    safeBgJob(processAutomations(CLASS_CODE), "processAutomations"),
    safeBgJob(processTermDeposits(CLASS_CODE), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(CLASS_CODE), "autoInterestIfDue"),
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
  renderJobsGrid(cls, students);
  renderApplications(cls, students);
}

/* ── Jobs grid ─────────────────────────────────────────────────────── */
function renderJobsGrid(cls, students) {
  const grid = document.getElementById("jobsGrid");
  grid.innerHTML = "";

  if (!cls.jobs || cls.jobs.length === 0) {
    grid.innerHTML = `<p class="muted-small" style="grid-column:1/-1;">No jobs yet — create one below.</p>`;
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
        <h3 class="job-family-title">${icon("briefcase", 16)} ${j.title}</h3>
        <div class="job-family-auto muted-small">${autoLabel}</div>
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
          `<span class="student-avatar ${avatarClass(s.username)}" title="${s.name}">${initials(s.name)}</span>`
        ).join("");
        return `
          <div class="tier-rung${here.length ? " has-students" : ""}">
            <div class="tier-rung-badge">${i + 1}</div>
            <div class="tier-rung-body">
              <div class="tier-rung-title">${t.name}</div>
              <div class="tier-rung-wage">${fmtMoney(t.wage)}<span class="muted-small">/pay day</span></div>
              ${t.description ? `<div class="tier-rung-desc muted-small">${t.description}</div>` : ""}
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
      <span class="tier-form-badge">${i + 1}</span>
      <span class="tier-form-label">Tier ${i + 1}</span>
      <button type="button" class="btn small coral tier-form-remove"
        onclick="removeTierRow('${prefix}', ${i})"
        ${i === 0 && (prefix === "add" ? ADD_TIERS : EDIT_TIERS).length === 1 ? "disabled title='Need at least one tier'" : ""}
      >Remove</button>
    </div>
    <div class="tier-form-fields">
      <div>
        <label>Tier name</label>
        <input type="text" class="tier-name-input" placeholder="e.g. Junior Librarian" value="${t.name || ""}"
          oninput="updateTierField('${prefix}', ${i}, 'name', this.value)">
      </div>
      <div>
        <label>Wage per pay day ($)</label>
        <input type="number" class="tier-wage-input" min="0" step="1" placeholder="0" value="${t.wage || ""}"
          oninput="updateTierField('${prefix}', ${i}, 'wage', this.value)">
      </div>
      <div class="tier-desc-wrap">
        <label>Description (optional)</label>
        <input type="text" class="tier-desc-input" placeholder="What does this tier do?" value="${t.description || ""}"
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

  const btn = document.getElementById("addJobBtn");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    await addJob(CLASS_CODE, title, validTiers, weeks);
    document.getElementById("addJobTitle").value     = "";
    document.getElementById("addJobAutoWeeks").value = "0";
    initAddForm();
    document.getElementById("addJobSuccess").classList.remove("hidden");
    setTimeout(() => document.getElementById("addJobSuccess").classList.add("hidden"), 3000);
    await render();
  } catch (e) {
    alert("Couldn't add job — " + e.message);
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

  const btn = document.getElementById("saveEditBtn");
  btn.disabled    = true;
  btn.textContent = "Saving…";
  try {
    await updateJob(CLASS_CODE, EDIT_JOB_ID, { title, tiers: validTiers, autoPromoteWeeks: weeks });
    showEditMsg("Saved!", "success");
    setTimeout(closeEditModal, 900);
    await render();
  } catch (e) {
    showEditMsg("Couldn't save — " + e.message, "error");
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
  if (!confirm(`Remove the job "${j.title}"? Students currently in this role will be unassigned.`)) return;
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
        <strong>${s ? s.name : a.studentUser}</strong> applied for <strong>${j ? j.title : "Unknown job"}</strong>
        ${j && j.tiers && j.tiers.length ? `<div class="muted-small">Starting at: ${j.tiers[0].name} — ${fmtMoney(j.tiers[0].wage)}/pay day</div>` : ""}
        <div class="muted-small">${a.coverLetter ? `"${a.coverLetter}"` : "No cover letter."}</div>
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
  renderJobBoard(me, cls);
  renderMyApplications(me, cls);
}

/* ── My current job ────────────────────────────────────────────────── */
function renderMyJob(me, cls) {
  const box = document.getElementById("myJobBox");
  const job = me.jobId ? (cls.jobs || []).find(j => j.id === me.jobId) : null;
  const tier = job ? getStudentTier(job, me) : null;

  if (!job || !tier) {
    box.innerHTML = `
      <div class="my-job-empty">
        ${icon("briefcase", 28)}
        <p>You don't have a job yet. Apply for one below!</p>
      </div>`;
    return;
  }

  const tiers    = job.tiers || [];
  const tierIdx  = tiers.indexOf(tier);
  const isTop    = tierIdx === tiers.length - 1;
  const pctDone  = tiers.length > 1 ? Math.round((tierIdx / (tiers.length - 1)) * 100) : 100;

  box.innerHTML = `
    <div class="my-job-card">
      <div class="my-job-header">
        <div>
          <div class="my-job-family">${job.title}</div>
          <h2 class="my-job-tier-name">${tier.name}</h2>
        </div>
        <div class="my-job-wage">${fmtMoney(tier.wage)}<span class="my-job-wage-label">/pay day</span></div>
      </div>
      ${tier.description ? `<p class="my-job-desc">${tier.description}</p>` : ""}

      ${tiers.length > 1 ? `
        <div class="tier-progress-wrap">
          <div class="tier-progress-bar-bg">
            <div class="tier-progress-bar-fill" style="width:${pctDone}%"></div>
          </div>
          <div class="tier-progress-steps">
            ${tiers.map((t, i) => `
              <div class="tier-progress-step ${i < tierIdx ? "past" : i === tierIdx ? "current" : ""}">
                <div class="tier-progress-dot"></div>
                <div class="tier-progress-label">${t.name}</div>
              </div>
            `).join("")}
          </div>
        </div>
        ${!isTop && job.autoPromoteWeeks > 0
          ? `<p class="muted-small tier-auto-note">${icon("repeat", 12)} Auto-promotes every ${job.autoPromoteWeeks} week${job.autoPromoteWeeks === 1 ? "" : "s"} — next tier: <strong>${tiers[tierIdx + 1].name}</strong> (${fmtMoney(tiers[tierIdx + 1].wage)}/pay day)</p>`
          : isTop ? `<p class="muted-small tier-auto-note">🏆 Top tier — you've reached the highest level!</p>` : ""}
      ` : ""}
    </div>
  `;
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
          <h3 class="job-board-title">${j.title}</h3>
          ${isMine ? `<span class="badge mint">Your job</span>` : ""}
        </div>
      </div>
      <div class="job-board-tiers">
        ${tiers.map((t, i) => `
          <div class="job-board-tier-row ${isMine && myTier && t.id === myTier.id ? "active" : ""}">
            <span class="job-board-tier-num">${i + 1}</span>
            <div class="job-board-tier-info">
              <strong>${t.name}</strong>
              ${t.description ? `<span class="muted-small"> — ${t.description}</span>` : ""}
            </div>
            <span class="job-board-tier-wage">${fmtMoney(t.wage)}</span>
            ${isMine && myTier && t.id === myTier.id ? `<span class="badge gold" style="flex-shrink:0;">You</span>` : ""}
          </div>
        `).join("")}
      </div>
      ${j.autoPromoteWeeks > 0 ? `<p class="muted-small" style="margin:10px 0 0;">${icon("repeat", 11)} Auto-promotes every ${j.autoPromoteWeeks} week${j.autoPromoteWeeks === 1 ? "" : "s"}</p>` : ""}
      <div class="job-board-footer">
        ${isMine
          ? `<span class="muted-small">You work here — starting pay: ${fmtMoney(tiers[0] ? tiers[0].wage : 0)}/pay day</span>`
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
    document.getElementById("applyModalMsg").textContent = e.message || "Couldn't submit — try again.";
    document.getElementById("applyModalMsg").className   = "error-msg";
  } finally {
    btn.disabled = false;
  }
}

/* We alias because the function name `applyForJob` is used for the
   UI trigger; the data layer call has the same spirit but a different name. */
async function applyForJob_data(classCode, jobId, studentUser, letter) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) throw new Error("Class not found.");
    const cls = snap.data();
    const job = (cls.jobs || []).find(j => j.id === jobId);
    if (!job) throw new Error("That job no longer exists.");
    const existing = (cls.jobApplications || []).find(
      a => a.jobId === jobId && a.studentUser === studentUser && a.status === "pending"
    );
    if (existing) throw new Error("You already have a pending application for this job.");
    const apps = cls.jobApplications || [];
    apps.push({ id: uid("a"), jobId, studentUser, coverLetter: letter, status: "pending", date: nowStr() });
    t.update(classRef, { jobApplications: apps });
  });
}

/* ── My applications (student) ─────────────────────────────────────── */
function renderMyApplications(me, cls) {
  const myApps = (cls.jobApplications || []).filter(a => a.studentUser === me.username);
  const box    = document.getElementById("myApplicationsBox");
  if (!myApps.length) { box.innerHTML = `<p class="muted-small">No applications yet.</p>`; return; }
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
        <strong>${j ? j.title : "Unknown job"}</strong>
        ${j && j.tiers && j.tiers[0] ? `<div class="muted-small">Entry tier: ${j.tiers[0].name}</div>` : ""}
        ${a.coverLetter ? `<div class="muted-small">"${a.coverLetter}"</div>` : ""}
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
  const existing = document.getElementById("t29PromoOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "t29PromoOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(14,27,55,0.78);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);";
  overlay.innerHTML = `
    <div class="promo-popup-card">
      <div class="promo-popup-stars">✦ ✦ ✦</div>
      <div class="promo-popup-emoji">🎉</div>
      <h2 class="promo-popup-title">You've been promoted!</h2>
      <p class="promo-popup-sub">You're now a</p>
      <div class="promo-popup-tier">
        <div class="promo-popup-tier-name">${promo.tierName}</div>
        <div class="promo-popup-tier-meta">${promo.jobTitle} &middot; ${fmtMoney(promo.wage)}/pay day</div>
      </div>
      <button class="btn gold promo-popup-btn" onclick="document.getElementById('t29PromoOverlay').remove()">
        🎊 Let's go!
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

document.addEventListener("DOMContentLoaded", init);
