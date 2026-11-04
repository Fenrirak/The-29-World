// This page is intentionally the one place that calls requireLogin with
// { skipTimeLimit: true } — it needs to load even though the student IS
// currently over their limit, and it must never itself start the time
// tracker (sitting on the lockout screen shouldn't burn any of tomorrow's
// allowance). It re-checks the limit status itself, purely to decide
// whether to bounce the student back in (e.g. the day rolled over while
// this tab was left open) — again using only the doc it already fetched,
// no extra read.
let CURRENT;

async function init() {
  const u = await requireLogin({ skipTimeLimit: true });
  if (!u) return;
  if (u.role !== "student") { window.location.href = "teacher-home.html"; return; }
  CURRENT = u;

  paintIconSlots();
  document.getElementById("clockIcon").innerHTML = icon("history", 40);
  document.getElementById("whoami").textContent = u.name;

  if (!timeLimitStatus(u).reached) {
    // Limit no longer applies (teacher removed it, or a new day started) —
    // send them straight back in instead of leaving them stuck here.
    window.location.href = "student.html";
    return;
  }

  renderExemptionBox(u);
  t29PageReady();

  // In case the student just leaves this tab open, notice when the teacher lifts the limit or
  // answers a pending request. Both arrive as a change to this student's own document, so a live
  // listener picks them up at once and costs nothing while nothing changes (it used to re-read
  // the document every 15 seconds). The day rolling over is a clock event, not a data change, so
  // that is re-checked against the document we already hold, once a minute, with no read at all.
  let latest = u;
  const recheck = () => {
    if (!timeLimitStatus(latest).reached) { window.location.href = "student.html"; return; }
  };
  setInterval(recheck, 60000);
  let fallbackTimer = null;
  const startFallbackPoll = () => {
    if (fallbackTimer) return;
    fallbackTimer = setInterval(async () => {
      const fresh = await getUserCached(CURRENT.username);
      if (!fresh) return;
      latest = fresh;
      if (!timeLimitStatus(fresh).reached) { window.location.href = "student.html"; return; }
      renderExemptionBox(fresh);
    }, 15000);
  };
  t29WatchDoc("users", CURRENT.username, (fresh, info) => {
    if (info && info.error) { startFallbackPoll(); return; } // listener unavailable: the old 15s check
    if (!fresh) return;
    latest = fresh;
    if (!timeLimitStatus(fresh).reached) { window.location.href = "student.html"; return; }
    renderExemptionBox(fresh);
  });
}

function renderExemptionBox(u) {
  const limitMin = u.dailyLimitMinutes;
  document.getElementById("explainText").textContent =
    `Your teacher has set a daily limit of ${limitMin} minute${limitMin === 1 ? "" : "s"} on The 29 World, and you've used it all up for today.`;
  document.getElementById("resetNote").textContent = "Your time resets at midnight — come back tomorrow.";

  const box = document.getElementById("exemptionBox");
  const state = timeExemptionState(u);
  if (state === "pending") {
    box.innerHTML = `<p class="muted-small">${icon("send", 13)} Your request for more time has been sent — waiting on your teacher.</p>`;
  } else if (state === "declined") {
    box.innerHTML = `<p class="muted-small">Your teacher declined your request for more time today. You can ask again tomorrow.</p>`;
  } else {
    box.innerHTML = `
      <p class="muted-small">Need a bit more time today? You can ask your teacher.</p>
      <button class="btn small gold" onclick="sendExemptionRequest()" id="exemptionBtn">${icon("send", 13)} Request more time</button>
      <div id="exemptionMsg"></div>
    `;
  }
}

async function sendExemptionRequest() {
  const btn = document.getElementById("exemptionBtn");
  if (btn) btn.disabled = true;
  const res = await requestTimeExemption(CURRENT.username);
  if (!res.ok) {
    const msg = document.getElementById("exemptionMsg");
    if (msg) msg.innerHTML = `<div class="error-msg">${res.error}</div>`;
    if (btn) btn.disabled = false;
    return;
  }
  const fresh = await getUserCached(CURRENT.username);
  if (fresh) renderExemptionBox(fresh);
}

document.addEventListener("DOMContentLoaded", init);

