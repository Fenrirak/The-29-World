// This page is intentionally the one place that calls requireLogin with
// { skipTimeLimit: true } — it needs to load even though the student IS
// currently over their limit, and it must never itself start the time
// tracker (sitting on the lockout screen shouldn't burn any of tomorrow's
// allowance). It re-checks the limit status itself, purely to decide
// whether to bounce the student back in (e.g. the day rolled over while
// this tab was left open) — again using only the doc it already fetched,
// no extra read.
async function init() {
  const u = await requireLogin({ skipTimeLimit: true });
  if (!u) return;
  if (u.role !== "student") { window.location.href = "teacher.html"; return; }

  paintIconSlots();
  document.getElementById("clockIcon").innerHTML = icon("calendar", 40);
  document.getElementById("whoami").textContent = u.name;

  if (!timeLimitStatus(u).reached) {
    // Limit no longer applies (teacher removed it, or a new day started) —
    // send them straight back in instead of leaving them stuck here.
    window.location.href = "student.html";
    return;
  }

  const limitMin = u.dailyLimitMinutes;
  document.getElementById("explainText").textContent =
    `Your teacher has set a daily limit of ${limitMin} minute${limitMin === 1 ? "" : "s"} on The 29 World, and you've used it all up for today.`;
  document.getElementById("resetNote").textContent = "Your time resets at midnight — come back tomorrow.";

  // In case the student just leaves this tab open, notice when the day
  // rolls over (or the teacher lifts the limit) without needing a manual
  // refresh. getUserCached still costs a read, so this is deliberately
  // infrequent — once a minute is plenty for something that only changes
  // once a day.
  setInterval(async () => {
    const fresh = await getUserCached(u.username);
    if (fresh && !timeLimitStatus(fresh).reached) window.location.href = "student.html";
  }, 60000);
}

document.addEventListener("DOMContentLoaded", init);
