let CURRENT, IS_TEACHER;
let JOBS_CACHE = [];

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("briefcase", 26) + " Jobs";
  document.getElementById("hJobs").innerHTML = icon("briefcase", 18) + " Jobs board";
  document.getElementById("addJobBtn").innerHTML = icon("plus", 15) + " Add job";
  document.getElementById("hApplications").innerHTML = icon("idcard", 18) + " Pending job applications";
  document.getElementById("hMyJob").innerHTML = icon("briefcase", 18) + " My current job";
  document.getElementById("hBoard").innerHTML = icon("idcard", 18) + " Job board";
  document.getElementById("hMyApps").innerHTML = icon("send", 18) + " My applications";
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
  document.getElementById("teacherView").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    autoPayDayIfDue(CURRENT.classCode),
    processAutomations(CURRENT.classCode),
    processMortgages(CURRENT.classCode),
    processTermDeposits(CURRENT.classCode),
    autoInterestIfDue(CURRENT.classCode),
    processInsurancePayments(CURRENT.classCode),
    processWeeklyEvents(CURRENT.classCode),
    processWeeklyBigEvents(CURRENT.classCode)
  ]);
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(CURRENT.username, CURRENT.classCode);
  await checkBigEventPopup(CURRENT.username, CURRENT.classCode);
  await render();
}

async function render() {
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUser(CURRENT.username), getClass(CURRENT.classCode)]);

  if (IS_TEACHER) {
    const students = await getClassStudents(CURRENT.classCode);
    const nameCache = {};
    students.forEach(s => { nameCache[s.username] = s.name; });

    // jobs table
    JOBS_CACHE = cls.jobs;
    const jbody = document.querySelector("#jobsTable tbody");
    jbody.innerHTML = "";
    cls.jobs.forEach(j => {
      const tr = document.createElement("tr");
      tr.id = "jobrow-" + j.id;
      tr.innerHTML = `
        <td id="jobview-${j.id}"><strong>${j.title}</strong>${j.description ? `<div class="muted-small">${j.description}</div>` : ""}</td>
        <td id="jobwage-${j.id}">${fmtMoney(j.wage)}</td>
        <td id="jobactions-${j.id}">
          <button class="btn small secondary" onclick="editJob('${j.id}')">Edit</button>
          <button class="btn small coral" onclick="deleteJob('${j.id}')">Remove</button>
        </td>`;
      jbody.appendChild(tr);
    });

    // pending applications
    const apps = (cls.jobApplications || []).filter(a => a.status === "pending");
    const appBox = document.getElementById("applicationsList");
    document.getElementById("noApplications").classList.toggle("hidden", apps.length > 0);
    appBox.innerHTML = "";
    apps.forEach(a => {
      const studentName = nameCache[a.studentUser] || a.studentUser;
      const job = cls.jobs.find(j => j.id === a.jobId);
      if (!job) return;
      const row = document.createElement("div");
      row.className = "auto-row";
      row.innerHTML = `
        <div class="auto-details"><strong>${studentName}</strong> applied for <strong>${job.title}</strong> (${fmtMoney(job.wage)})</div>
        <div class="row-flex" style="gap:8px;">
          <button class="btn small mint" onclick="approveApp('${a.id}')">Approve</button>
          <button class="btn small coral" onclick="declineApp('${a.id}')">Decline</button>
        </div>
      `;
      appBox.appendChild(row);
    });
    return;
  }

  // current job
  const job = cls.jobs.find(j => j.id === me.jobId);
  document.getElementById("myJobBox").innerHTML = job
    ? `<div class="job-card"><h4>${icon("briefcase", 18)}${job.title}</h4>
        <p>${job.description || "No description provided."}</p>
        <p><strong>${fmtMoney(job.wage)}</strong> per pay day</p></div>`
    : `<p class="muted-small">You don't have a job right now — apply for one below.</p>`;

  // job board
  const listBox = document.getElementById("jobList");
  listBox.innerHTML = "";
  document.getElementById("noJobs").classList.toggle("hidden", cls.jobs.length > 0);
  cls.jobs.forEach(j => {
    const isMine = me.jobId === j.id;
    const existingApp = (cls.jobApplications || []).find(a => a.studentUser === me.username && a.jobId === j.id && a.status === "pending");
    const div = document.createElement("div");
    div.className = "job-card";
    div.innerHTML = `
      <h4>${icon("briefcase", 18)}${j.title} ${isMine ? '<span class="badge mint">Your job</span>' : ""}</h4>
      <p>${j.description || "No description provided."}</p>
      <div class="flex-between">
        <strong>${fmtMoney(j.wage)} per pay day</strong>
        ${isMine ? "" : existingApp
          ? `<span class="status-pending">Application pending</span>`
          : `<button class="btn small gold" onclick="apply('${j.id}')">${icon("send", 13)} Apply</button>`}
      </div>
    `;
    listBox.appendChild(div);
  });

  // my applications
  const myApps = (cls.jobApplications || []).filter(a => a.studentUser === me.username);
  const appsBox = document.getElementById("myAppsList");
  appsBox.innerHTML = "";
  document.getElementById("noApps").classList.toggle("hidden", myApps.length > 0);
  myApps.forEach(a => {
    const j = cls.jobs.find(jj => jj.id === a.jobId);
    const row = document.createElement("div");
    row.className = "auto-row";
    const statusClass = a.status === "approved" ? "status-approved" : a.status === "declined" ? "status-declined" : "status-pending";
    const statusLabel = a.status === "approved" ? "Approved" : a.status === "declined" ? "Declined" : "Pending";
    row.innerHTML = `
      <div class="auto-details">${j ? j.title : "(removed job)"} <div class="muted-small">${a.date}</div></div>
      <span class="${statusClass}">${statusLabel}</span>
    `;
    appsBox.appendChild(row);
  });
}

async function apply(jobId) {
  const res = await applyForJob(CURRENT.classCode, CURRENT.username, jobId);
  if (!res.ok) alert(res.error);
  await render();
}

async function addJobForm(e) {
  e.preventDefault();
  const title = document.getElementById("jobTitle").value.trim();
  const wage = document.getElementById("jobWage").value;
  const description = document.getElementById("jobDesc").value.trim();
  await addJob(CURRENT.classCode, title, wage, description);
  document.getElementById("jobTitle").value = "";
  document.getElementById("jobWage").value = "";
  document.getElementById("jobDesc").value = "";
  await render();
  return false;
}

function editJob(id) {
  const j = JOBS_CACHE.find(jj => jj.id === id);
  if (!j) return;
  const tr = document.getElementById("jobrow-" + id);
  tr.innerHTML = `
    <td colspan="3">
      <div class="grid grid-3">
        <div><label>Title</label><input id="ej-title-${id}" value="${j.title.replace(/"/g, "&quot;")}"></div>
        <div><label>Weekly wage</label><input id="ej-wage-${id}" type="number" min="0" step="0.5" value="${j.wage}"></div>
        <div><label>Description</label><input id="ej-desc-${id}" value="${(j.description || "").replace(/"/g, "&quot;")}"></div>
      </div>
      <div class="row-flex" style="gap:8px;margin-top:10px;">
        <button class="btn small gold" onclick="saveJobEdit('${id}')">Save changes</button>
        <button class="btn small secondary" onclick="render()">Cancel</button>
      </div>
    </td>
  `;
}

async function saveJobEdit(id) {
  const title = document.getElementById("ej-title-" + id).value.trim();
  const wage = document.getElementById("ej-wage-" + id).value;
  const description = document.getElementById("ej-desc-" + id).value.trim();
  if (!title || wage === "") { alert("Please fill in a title and wage."); return; }
  await updateJob(CURRENT.classCode, id, { title, wage, description });
  await render();
}

async function deleteJob(id) {
  await removeJob(CURRENT.classCode, id);
  await render();
}

async function approveApp(appId) {
  await approveApplication(CURRENT.classCode, appId);
  await render();
}
async function declineApp(appId) {
  await declineApplication(CURRENT.classCode, appId);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
