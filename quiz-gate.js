/* ===================== The 29 World — Quiz gate popup =====================
   When a teacher attaches a financial-literacy quiz to a module and turns
   the gate on, the student doesn't go looking for a Quizzes page — the
   quiz comes to THEM, as a popup, the moment they try to open the module
   it guards. Pass it and the module opens straight away.

   Loaded on every page (after data-life.js). applyNavModuleLocks() in data-life.js
   calls t29OpenQuizGate() for any nav link locked by a quiz; nothing else
   has to know this file exists. All the grading lives in the data-*.js files
   (submitQuizAttempt) — this is only the popup around it.
========================================================================== */

let QG_QUIZ = null;      // the quiz currently open in the popup
let QG_CONTEXT = null;   // { moduleKey, href, alsoLifestyleLocked }
let QG_SUBMITTING = false;

function qgEsc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function qgModuleLabel(key) {
  const m = LIFESTYLE_LOCKABLE_MODULES.find(x => x.key === key);
  return m ? m.label : key;
}

// The quiz standing between this student and `moduleKey`: the first active
// one attached to that module they haven't passed yet.
function qgFindQuiz(cls, user, moduleKey) {
  return (cls.quizzes || []).find(q => {
    if (!q.active || q.moduleKey !== moduleKey) return false;
    const r = quizResultFor(user, q.id);
    return !r || !r.passed;
  }) || null;
}

function qgCloseGate() {
  const el = document.getElementById("t29QuizGate");
  if (el) el.remove();
  QG_QUIZ = null;
  QG_CONTEXT = null;
  QG_SUBMITTING = false;
}

function qgOverlayHtml(inner) {
  return `<div class="anw-modal-card qg-card">${inner}</div>`;
}

async function t29OpenQuizGate(moduleKey, opts) {
  opts = opts || {};
  if (document.getElementById("t29QuizGate")) return; // already open
  const session = await getSessionUser();
  if (!session || session.role !== "student") return;
  const cls = withNewModuleDefaults(await getClassCached(session.classCode));
  const me = Object.assign({ username: session.username }, await getUserCached(session.username));
  const quiz = qgFindQuiz(cls, me, moduleKey);

  if (!quiz) {
    // Gate is on for this module but there's no quiz they can sit (the
    // teacher paused or deleted it) — don't leave them staring at nothing.
    alert(MODULE_LOCK_MESSAGE.quiz);
    return;
  }

  QG_QUIZ = quiz;
  QG_CONTEXT = { moduleKey, href: opts.href || "", alsoLifestyleLocked: !!opts.alsoLifestyleLocked };

  const overlay = document.createElement("div");
  overlay.id = "t29QuizGate";
  overlay.className = "anw-modal-overlay";
  overlay.innerHTML = qgOverlayHtml(`
    <div class="qg-head">
      <div>
        <p class="qg-kicker">${icon("lock", 12)} ${qgEsc(qgModuleLabel(moduleKey))} is locked</p>
        <h3 class="qg-title">${qgEsc(quiz.title)}</h3>
        ${quiz.description ? `<p class="qg-desc">${qgEsc(quiz.description)}</p>` : ""}
      </div>
      <button class="btn small secondary" type="button" onclick="qgCloseGate()">Close</button>
    </div>
    <p class="qg-meta">${quiz.questions.length} ${quiz.questions.length === 1 ? "question" : "questions"} · you need ${quiz.passMark}% to unlock ${qgEsc(qgModuleLabel(moduleKey))}${quiz.reward > 0 ? ` · ${fmtMoney(quiz.reward)} bonus the first time you pass` : ""}</p>
    <div id="qgResult"></div>
    <div id="qgBody">${qgQuestionsHtml(quiz)}</div>
    <div id="qgMsg"></div>
    <div class="qg-actions">
      <button class="btn gold" type="button" id="qgSubmit" onclick="qgSubmit()">Submit answers</button>
      <button class="btn secondary" type="button" id="qgRetry" style="display:none;" onclick="qgRetry()">Try again</button>
      <button class="btn mint" type="button" id="qgContinue" style="display:none;" onclick="qgContinue()">Continue</button>
    </div>
  `);
  overlay.addEventListener("click", e => { if (e.target === overlay) qgCloseGate(); });
  document.body.appendChild(overlay);
}

// Opens the quiz for a module from anywhere (e.g. a notification), and
// goes to that module's page once it's passed.
async function t29OpenQuizForModule(moduleKey) {
  const session = await getSessionUser();
  if (!session || session.role !== "student") return;
  const link = document.querySelector(`nav a[data-module="${moduleKey}"]`);
  const reasons = await getModuleLockReasons(session.username, session.classCode);
  if (reasons[moduleKey] !== "quiz" && reasons[moduleKey] !== "both") {
    // Already passed (the notification was from before) — just go there.
    if (link) window.location.href = link.getAttribute("href");
    return;
  }
  t29OpenQuizGate(moduleKey, { href: link ? link.getAttribute("href") : "", alsoLifestyleLocked: reasons[moduleKey] === "both" });
}

function qgQuestionsHtml(quiz) {
  return quiz.questions.map((q, i) => `
    <div class="quiz-question" id="qg-q-${q.id}">
      <p class="qtext">${i + 1}. ${qgEsc(q.text)}</p>
      ${q.options.map((opt, j) => `
        <label class="quiz-option" id="qg-opt-${q.id}-${j}">
          <input type="radio" name="qg-ans-${q.id}" value="${j}" onchange="qgMarkChosen('${q.id}', ${j})">
          <span>${qgEsc(opt)}</span>
        </label>`).join("")}
    </div>`).join("");
}

function qgMarkChosen(qid, idx) {
  const q = QG_QUIZ && QG_QUIZ.questions.find(x => x.id === qid);
  if (!q) return;
  q.options.forEach((_, j) => {
    const el = document.getElementById(`qg-opt-${qid}-${j}`);
    if (el) el.classList.toggle("chosen", j === idx);
  });
}

// Wipes the marking and starts the same quiz over, without closing the
// popup or making the student find their way back to it.
function qgRetry() {
  if (!QG_QUIZ) return;
  document.getElementById("qgResult").innerHTML = "";
  document.getElementById("qgMsg").innerHTML = "";
  document.getElementById("qgBody").innerHTML = qgQuestionsHtml(QG_QUIZ);
  document.getElementById("qgSubmit").style.display = "";
  document.getElementById("qgRetry").style.display = "none";
  document.getElementById("qgBody").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Passed: go where they were trying to go in the first place. If the
// module is ALSO lifestyle-locked, passing the quiz doesn't open it, so
// say that plainly instead of navigating them into a locked page.
function qgContinue() {
  const ctx = QG_CONTEXT;
  qgCloseGate();
  if (!ctx) return;
  if (ctx.alsoLifestyleLocked) {
    alert("Quiz passed. This module is still locked by your lifestyle rating, though — ask your teacher what's needed to raise it.");
    return;
  }
  if (ctx.href) window.location.href = ctx.href;
  else window.location.reload();
}

async function qgSubmit() {
  if (!QG_QUIZ || QG_SUBMITTING) return;
  const session = await getSessionUser();
  if (!session) return;

  const answers = {};
  let unanswered = 0;
  QG_QUIZ.questions.forEach(q => {
    const checked = document.querySelector(`input[name="qg-ans-${q.id}"]:checked`);
    if (checked) answers[q.id] = Number(checked.value);
    else unanswered++;
  });
  if (unanswered > 0 && !confirm(`${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still blank — they'll be marked wrong. Submit anyway?`)) return;

  QG_SUBMITTING = true;
  const btn = document.getElementById("qgSubmit");
  btn.disabled = true;
  const res = await submitQuizAttempt(session.username, session.classCode, QG_QUIZ.id, answers);
  QG_SUBMITTING = false;
  btn.disabled = false;
  if (!res.ok) {
    document.getElementById("qgMsg").innerHTML = `<div class="error-msg">${qgEsc(res.error)}</div>`;
    return;
  }

  const moduleName = qgModuleLabel(QG_CONTEXT.moduleKey);
  document.getElementById("qgResult").innerHTML = `
    <div class="quiz-score ${res.passed ? "pass" : "fail"}">
      <span class="big">${res.pct}%</span>
      <span class="txt">
        ${res.correct} out of ${res.total} correct — ${res.passed ? `${qgEsc(moduleName)} is unlocked!` : `you need ${res.passMark}% to unlock ${qgEsc(moduleName)}.`}<br>
        ${res.passed
          ? (res.reward > 0 ? `${fmtMoney(res.reward)} bonus paid into your account.` : "Have a look at the explanations below if you like, then carry on.")
          : "Read the explanations below — then have another go, as many times as you need."}
      </span>
    </div>`;

  // Mark the paper in place: colour every option and drop the teacher's
  // explanation under each question. This is the part that does the
  // actual teaching, so it shows whether they passed or not.
  res.review.forEach(r => {
    r.options.forEach((_, j) => {
      const el = document.getElementById(`qg-opt-${r.id}-${j}`);
      if (!el) return;
      el.classList.remove("chosen");
      if (j === r.answer) el.classList.add("right");
      else if (j === r.chosen) el.classList.add("wrong");
      const input = el.querySelector("input");
      if (input) input.disabled = true;
    });
    const box = document.getElementById(`qg-q-${r.id}`);
    if (box && r.explain && !box.querySelector(".quiz-explain")) {
      const p = document.createElement("p");
      p.className = "quiz-explain";
      p.innerHTML = `<strong>${r.correct ? "Correct." : "Not quite."}</strong> ${qgEsc(r.explain)}`;
      box.appendChild(p);
    }
  });

  document.getElementById("qgSubmit").style.display = "none";
  document.getElementById("qgRetry").style.display = res.passed ? "none" : "";
  document.getElementById("qgContinue").style.display = res.passed ? "" : "none";
  document.getElementById("qgResult").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------------- Locked module pages ----------------
   applyNavModuleLocks only stops the menu link. A locked page can still be
   reached another way — a button on the dashboard, a notification, or
   typing its address — so each module page checks for itself as well and
   covers the page while it's locked (with the quiz on top, when a quiz is
   what locks it). Stock Market and Gambling already lock their own page
   with a banner, so they're left to that. */
const QG_PAGES_WITH_OWN_LOCK = ["market", "gambling"];

// Which module this page is, from its own menu link (every module page's
// menu has a link to itself with a data-module key).
function qgCurrentModuleKey() {
  const here = (window.location.pathname.split("/").pop() || "").toLowerCase();
  if (!here) return null;
  const link = [...document.querySelectorAll("nav a[data-module]")]
    .find(a => ((a.getAttribute("href") || "").split("/").pop() || "").toLowerCase() === here);
  return link ? link.getAttribute("data-module") : null;
}

async function qgGuardModulePage() {
  const moduleKey = qgCurrentModuleKey();
  if (!moduleKey || QG_PAGES_WITH_OWN_LOCK.includes(moduleKey)) return;
  const session = await getSessionUser();
  if (!session || session.role !== "student" || !session.classCode) return;
  const raw = await getClassCached(session.classCode);
  if (!raw) return;
  const cls = withNewModuleDefaults(raw);
  if (!_classHasAnyModuleLock(cls)) return;
  const me = Object.assign({ username: session.username }, await getUserCached(session.username));
  const reason = getModuleLockReasonsFromData(cls, me, session.username)[moduleKey];
  if (reason) qgShowPageLock(moduleKey, reason);
}

function qgShowPageLock(moduleKey, reason) {
  if (document.getElementById("t29PageLock")) return;
  const canQuiz = reason === "quiz" || reason === "both";
  const quizOpts = `{ alsoLifestyleLocked: ${reason === "both"} }`;
  const overlay = document.createElement("div");
  overlay.id = "t29PageLock";
  overlay.className = "anw-modal-overlay";
  overlay.innerHTML = qgOverlayHtml(`
    <p class="qg-kicker">${icon("lock", 12)} ${qgEsc(qgModuleLabel(moduleKey))} is locked</p>
    <p>${qgEsc(MODULE_LOCK_MESSAGE[reason] || MODULE_LOCK_MESSAGE.lifestyle)}</p>
    <div class="qg-actions">
      ${canQuiz ? `<button class="btn gold" type="button" onclick="t29OpenQuizGate('${moduleKey}', ${quizOpts})">Take the quiz</button>` : ""}
      <a class="btn secondary" href="student.html">Back to my account</a>
    </div>`);
  document.body.appendChild(overlay);
  // Passing reloads the page (no href given — see qgContinue), which runs
  // this check again and finds it unlocked.
  if (canQuiz) t29OpenQuizGate(moduleKey, { alsoLifestyleLocked: reason === "both" });
}

document.addEventListener("DOMContentLoaded", () => {
  qgGuardModulePage().catch(e => console.warn("Module page lock check failed:", e));
});
