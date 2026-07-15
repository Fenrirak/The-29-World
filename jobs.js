let CURRENT, IS_TEACHER;

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("briefcase", 26) + " Jobs";
  document.getElementById("hTeacherNotice").innerHTML = icon("idcard", 18) + " Manage jobs from your Dashboard";
  document.getElementById("goDashBtn").innerHTML = icon("bank", 15) + " Go to Dashboard";
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
  document.getElementById("teacherNotice").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  await autoPayDayIfDue(CURRENT.classCode);
  await processAutomations(CURRENT.classCode);
  await processMortgages(CURRENT.classCode);
  await processWeeklyEvents(CURRENT.classCode);
  if (!IS_TEACHER) await render();
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);

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

document.addEventListener("DOMContentLoaded", init);
