let CURRENT, ALL_CLASSES = [], NC_MODE = "new";

function fmtDate(ts) {
  if (!ts) return "Unknown date";
  return new Date(ts).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}

function showMsg(text, ok) {
  document.getElementById("msg").innerHTML = text
    ? `<div class="${ok ? "success-msg" : "error-msg"}">${text}</div>` : "";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  if (u.role !== "teacher") { window.location.href = "student.html"; return; }
  CURRENT = u;
  document.getElementById("whoami").textContent = "Ms/Mr " + u.name;
  paintIconSlots();
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
  await render();
}

async function render() {
  ALL_CLASSES = await getTeacherClasses(CURRENT.username);
  const grid = document.getElementById("classGrid");
  const noClasses = document.getElementById("noClasses");
  noClasses.classList.toggle("hidden", ALL_CLASSES.length > 0);
  grid.innerHTML = "";

  ALL_CLASSES.forEach(cls => {
    const card = document.createElement("div");
    card.className = "class-card" + (cls.archived ? " archived" : "");
    card.innerHTML = `
      <div class="flex-between" style="align-items:flex-start;">
        <h3>${icon("building", 18)} ${escapeHtml(cls.name)}</h3>
        ${cls.archived ? `<span class="badge coral">${icon("lock", 12)} Archived</span>` : ""}
      </div>
      <div class="class-card-meta">
        <span>${icon("users", 14)} ${cls.studentCount} student${cls.studentCount === 1 ? "" : "s"}</span>
        <span>${icon("calendar", 14)} Created ${fmtDate(cls.createdAt)}</span>
        <span>${icon("key", 14)} Class code: ${cls.code}</span>
      </div>
      <div class="class-card-actions">
        <button class="btn small gold" type="button" data-open="${cls.code}">${icon("send", 12)} Open</button>
        <button class="btn small secondary" type="button" data-archive="${cls.code}">${cls.archived ? icon("repeat", 12) + " Reopen" : icon("lock", 12) + " Archive"}</button>
        <button class="btn small coral" type="button" data-delete="${cls.code}">${icon("trash", 12)} Delete</button>
      </div>
    `;
    card.querySelector("h3").addEventListener("click", () => openClass(cls.code));
    card.addEventListener("click", () => openClass(cls.code));
    card.querySelector("[data-open]").addEventListener("click", (e) => { e.stopPropagation(); openClass(cls.code); });
    card.querySelector("[data-archive]").addEventListener("click", (e) => { e.stopPropagation(); toggleArchive(cls.code, cls.archived, cls.name); });
    card.querySelector("[data-delete]").addEventListener("click", (e) => { e.stopPropagation(); deleteClassClick(cls.code, cls.name); });
    grid.appendChild(card);
  });

  const newCard = document.createElement("div");
  newCard.className = "new-class-card";
  newCard.innerHTML = `
    <div>${icon("plus", 26)}</div>
    <button class="btn small gold" type="button" onclick="openNewClassModal('new')">Create a brand new class</button>
    <button class="btn small secondary" type="button" onclick="openNewClassModal('template')">New class from a template</button>
  `;
  grid.appendChild(newCard);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function openClass(code) {
  showMsg("");
  const res = await switchActiveClass(CURRENT.username, code);
  if (!res.ok) { showMsg(res.error, false); return; }
  window.location.href = "teacher.html";
}

async function toggleArchive(code, currentlyArchived, name) {
  const question = currentlyArchived
    ? `Reopen "${name}"? Students will be able to use it again right away.`
    : `Archive "${name}"? Students won't be able to do anything in this class until it's reopened — they'll be able to view it read-only if you let them, but nothing will be lost. You can reopen it any time.`;
  if (!confirm(question)) return;
  await setClassArchived(code, !currentlyArchived);
  await render();
}

async function deleteClassClick(code, name) {
  const typed = prompt(
    `This will PERMANENTLY delete "${name}" — every student account in it, all balances, and all activity history. This cannot be undone.\n\nIf you just want to pause the class instead, use Archive.\n\nType the class name exactly to confirm deletion:`
  );
  if (typed === null) return;
  if (typed.trim() !== name) {
    alert("That didn't match the class name, so nothing was deleted.");
    return;
  }
  const res = await deleteClassPermanently(CURRENT.username, code);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

function openNewClassModal(mode) {
  NC_MODE = mode;
  showMsg("");
  document.getElementById("ncMsg").innerHTML = "";
  document.getElementById("ncName").value = "";
  const templateWrap = document.getElementById("ncTemplateWrap");
  const templateSelect = document.getElementById("ncTemplate");
  if (mode === "template") {
    if (ALL_CLASSES.length === 0) {
      alert("You don't have any classes yet to copy settings from — create a brand new class first.");
      return;
    }
    document.getElementById("newClassModalTitle").textContent = "New class from a template";
    templateWrap.classList.remove("hidden");
    templateSelect.innerHTML = ALL_CLASSES.map(c => `<option value="${c.code}">${escapeHtml(c.name)}</option>`).join("");
  } else {
    document.getElementById("newClassModalTitle").textContent = "Create a brand new class";
    templateWrap.classList.add("hidden");
  }
  document.getElementById("newClassModal").classList.remove("hidden");
  document.getElementById("ncName").focus();
}

function closeNewClassModal() {
  document.getElementById("newClassModal").classList.add("hidden");
}

async function submitNewClass(e) {
  e.preventDefault();
  const btn = document.getElementById("ncSubmitBtn");
  const name = document.getElementById("ncName").value.trim();
  btn.disabled = true;
  try {
    const res = NC_MODE === "template"
      ? await createClassFromTemplate(CURRENT.username, name, document.getElementById("ncTemplate").value)
      : await createClassForTeacher(CURRENT.username, name);
    if (!res.ok) {
      document.getElementById("ncMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      btn.disabled = false;
      return false;
    }
    window.location.href = "teacher.html?welcome=1";
  } catch (err) {
    document.getElementById("ncMsg").innerHTML = `<div class="error-msg">Something went wrong. Please try again.</div>`;
    btn.disabled = false;
  }
  return false;
}

document.addEventListener("DOMContentLoaded", init);
