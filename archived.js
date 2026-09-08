// This page is the one place students land when their class is archived
// and they haven't chosen memory lane yet — it must load even though the
// class is archived, so it calls requireLogin with { allowArchived: true }
// (same pattern as timeup.js's { skipTimeLimit: true }).
let CURRENT, CLASS;

async function init() {
  const u = await requireLogin({ allowArchived: true, skipTimeLimit: true });
  if (!u) return;
  if (u.role !== "student") { window.location.href = "teacher-home.html"; return; }
  CURRENT = u;

  paintIconSlots();
  document.getElementById("lockIcon").innerHTML = icon("lock", 40);
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
  document.getElementById("whoami").textContent = u.name;

  CLASS = await getClassCached(u.classCode);
  if (!CLASS || !CLASS.archived) {
    // Reopened (or somehow not archived) while this tab was open — no
    // reason to keep the student stuck here.
    window.location.href = "student.html";
    return;
  }
  document.getElementById("pageTitle").textContent = `"${CLASS.name}" has been archived`;

  // Already chose memory lane earlier this session — skip straight in.
  if (isMemoryLaneActive(u.classCode)) {
    window.location.href = "student.html";
  }
}

function strollDownMemoryLane() {
  enterMemoryLane(CURRENT.classCode);
  window.location.href = "student.html";
}

document.addEventListener("DOMContentLoaded", init);
