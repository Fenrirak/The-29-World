/* ===================== The 29 World — Financial-literacy quizzes =====================
   Two pages in one, same as store.js/property.js do it: the teacher gets a
   quiz builder + class results, the student gets a list of quizzes and the
   flow for actually sitting one.

   All the rules live in data.js (addQuiz / updateQuiz / submitQuizAttempt /
   getQuizLockedModulesFromData) — this file is only ever presentation and
   form-wrangling.
================================================================================ */
let CURRENT, IS_TEACHER;
let CLS = null;
let ME = null;
let STUDENTS = [];
let EDITING_QUIZ_ID = null;   // set while the teacher is editing an existing quiz
let BUILDER_ROWS = [];        // [{ id, text, options: [str], answer: idx, explain }]
let TAKING = null;            // the quiz the student currently has open

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function moduleLabel(key) {
  if (!key) return "Practice only";
  const m = LIFESTYLE_LOCKABLE_MODULES.find(x => x.key === key);
  return m ? m.label : key;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("key", 26) + " Quizzes";
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
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentPanel").classList.toggle("hidden", IS_TEACHER);
  paintChrome();

  if (IS_TEACHER) {
    document.getElementById("pageIntro").textContent =
      "Write short quizzes on how money works, and (optionally) make passing one the key that unlocks a module.";
    buildModuleSelect();
    addQuestionRow();
    addQuestionRow();
  }

  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue")
  ]);
  await render();
}

async function render() {
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  ME = Object.assign({ username: CURRENT.username }, me);
  CLS = withNewModuleDefaults(cls);
  if (IS_TEACHER) await renderTeacher();
  else renderStudent();
}

/* ================= Teacher ================= */
function buildModuleSelect() {
  const sel = document.getElementById("qModule");
  sel.innerHTML = `<option value="">Nothing — practice only</option>` +
    LIFESTYLE_LOCKABLE_MODULES.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join("");
}

async function renderTeacher() {
  document.getElementById("gateToggle").checked = !!(CLS.quizGate && CLS.quizGate.enabled);

  const quizzes = CLS.quizzes || [];
  const list = document.getElementById("teacherQuizList");
  document.getElementById("noTeacherQuizzes").classList.toggle("hidden", quizzes.length > 0);
  list.innerHTML = quizzes.map(q => `
    <div class="quiz-card${q.moduleKey ? " locking" : ""}">
      <div class="flex-between">
        <div style="flex:1;min-width:220px;">
          <h3>${icon("key", 18)}${esc(q.title)}</h3>
          ${q.description ? `<p class="muted-small" style="margin:0 0 6px;">${esc(q.description)}</p>` : ""}
          <div class="quiz-meta">
            <span class="quiz-pill${q.moduleKey ? " coral" : ""}">${icon("lock", 12)}Unlocks: ${esc(moduleLabel(q.moduleKey))}</span>
            <span class="quiz-pill">${icon("percent", 12)}Pass mark ${q.passMark}%</span>
            <span class="quiz-pill">${icon("cards", 12)}${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"}</span>
            ${q.reward > 0 ? `<span class="quiz-pill gold">${icon("coin", 12)}${fmtMoney(q.reward)} bonus</span>` : ""}
            <span class="quiz-pill${q.active ? " mint" : ""}">${q.active ? "Active" : "Paused"}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          <button class="btn small secondary" onclick="startEditQuiz('${q.id}')">${icon("plus", 13)} Edit</button>
          <button class="btn small secondary" onclick="toggleQuizActive('${q.id}', ${!q.active})">${q.active ? "Pause" : "Activate"}</button>
          <button class="btn small coral" onclick="deleteQuiz('${q.id}')">${icon("trash", 13)} Remove</button>
        </div>
      </div>
    </div>
  `).join("");

  // Results table — one row per student, one column per quiz.
  STUDENTS = await getClassStudents(CURRENT.classCode, CLS);
  const wrap = document.getElementById("resultsWrap");
  const show = quizzes.length > 0 && STUDENTS.length > 0;
  document.getElementById("noResults").classList.toggle("hidden", show);
  if (!show) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Student</th>${quizzes.map(q => `<th>${esc(q.title)}</th>`).join("")}</tr></thead>
      <tbody>
        ${STUDENTS.map(s => `<tr>
          <td><strong>${esc(s.name)}</strong></td>
          ${quizzes.map(q => {
            const r = quizResultFor(s, q.id);
            if (!r) return `<td class="muted-small">Not tried</td>`;
            const tone = r.passed ? "ticker-up" : "ticker-down";
            return `<td>
              <span class="${tone}">${r.passed ? "Passed" : "Not yet"} · ${r.bestPct}%</span>
              <span class="muted-small"> (${r.attempts} ${r.attempts === 1 ? "try" : "tries"})</span><br>
              <button class="btn small secondary" style="margin-top:5px;" onclick="resetResult('${esc(s.username)}','${q.id}')">Reset</button>
            </td>`;
          }).join("")}
        </tr>`).join("")}
      </tbody>
    </table>`;
}

async function saveGate() {
  const on = document.getElementById("gateToggle").checked;
  await setQuizGateEnabled(CURRENT.classCode, on);
  document.getElementById("gateMsg").innerHTML =
    `<div class="success-msg">${on ? "Quiz gates are on — modules stay locked until their quiz is passed." : "Quiz gates are off — quizzes are practice only."}</div>`;
  await render();
}

/* ---------------- Question builder ---------------- */
function addQuestionRow(prefill) {
  BUILDER_ROWS.push(prefill || { id: null, text: "", options: ["", "", "", ""], answer: 0, explain: "" });
  paintBuilder();
}

function removeQuestionRow(idx) {
  BUILDER_ROWS.splice(idx, 1);
  if (!BUILDER_ROWS.length) BUILDER_ROWS.push({ id: null, text: "", options: ["", "", "", ""], answer: 0, explain: "" });
  paintBuilder();
}

// Pulls whatever is currently typed into the DOM back into BUILDER_ROWS,
// so repainting (adding/removing a row) never loses work in progress.
function syncBuilderFromDom() {
  BUILDER_ROWS.forEach((row, i) => {
    const textEl = document.getElementById(`qb-text-${i}`);
    if (!textEl) return;
    row.text = textEl.value;
    row.explain = document.getElementById(`qb-explain-${i}`).value;
    row.options = row.options.map((_, j) => {
      const el = document.getElementById(`qb-opt-${i}-${j}`);
      return el ? el.value : "";
    });
    const checked = document.querySelector(`input[name="qb-ans-${i}"]:checked`);
    row.answer = checked ? Number(checked.value) : 0;
  });
}

function addOptionTo(idx) {
  syncBuilderFromDom();
  if (BUILDER_ROWS[idx].options.length < 6) BUILDER_ROWS[idx].options.push("");
  paintBuilder();
}
function removeOptionFrom(idx, optIdx) {
  syncBuilderFromDom();
  const row = BUILDER_ROWS[idx];
  if (row.options.length <= 2) return;
  row.options.splice(optIdx, 1);
  if (row.answer >= row.options.length) row.answer = 0;
  paintBuilder();
}
function addQuestionRowSynced() {
  syncBuilderFromDom();
  addQuestionRow();
}
function removeQuestionRowSynced(idx) {
  syncBuilderFromDom();
  removeQuestionRow(idx);
}

function paintBuilder() {
  const box = document.getElementById("questionBuilder");
  box.innerHTML = BUILDER_ROWS.map((row, i) => `
    <div class="qb-question">
      <div class="qb-head">
        <span class="qb-num">Question ${i + 1}</span>
        <button class="btn small coral" type="button" onclick="removeQuestionRowSynced(${i})">${icon("trash", 13)} Remove</button>
      </div>
      <input id="qb-text-${i}" value="${esc(row.text)}" placeholder="e.g. You put $100 in at 10% a year. What's it worth after 2 years?">
      <p class="qb-hint">Tick the correct answer on the left.</p>
      ${row.options.map((opt, j) => `
        <div class="qb-opt-row">
          <input type="radio" name="qb-ans-${i}" value="${j}" ${row.answer === j ? "checked" : ""} aria-label="Mark option ${j + 1} correct">
          <input type="text" id="qb-opt-${i}-${j}" value="${esc(opt)}" placeholder="Answer option ${j + 1}">
          <button class="btn small secondary qb-del" type="button" onclick="removeOptionFrom(${i}, ${j})" ${row.options.length <= 2 ? "disabled" : ""}>×</button>
        </div>`).join("")}
      <button class="btn small secondary" type="button" onclick="addOptionTo(${i})" ${row.options.length >= 6 ? "disabled" : ""}>Add another option</button>
      <label for="qb-explain-${i}" style="margin-top:12px;">Explanation shown after answering (optional)</label>
      <input id="qb-explain-${i}" value="${esc(row.explain)}" placeholder="e.g. $110 after year one, then 10% of $110 — interest earns interest.">
    </div>
  `).join("");
  // The "Add question" button in the markup calls the un-synced version, so
  // point it at the syncing one now that the builder exists.
  const addBtn = document.getElementById("addQBtn");
  if (addBtn) addBtn.setAttribute("onclick", "addQuestionRowSynced()");
}

function collectQuizFromForm() {
  syncBuilderFromDom();
  return {
    title: document.getElementById("qTitle").value.trim(),
    description: document.getElementById("qDesc").value.trim(),
    moduleKey: document.getElementById("qModule").value,
    passMark: document.getElementById("qPass").value,
    reward: document.getElementById("qReward").value,
    active: true,
    questions: BUILDER_ROWS.map(r => ({ id: r.id, text: r.text, options: r.options, answer: r.answer, explain: r.explain }))
  };
}

async function saveQuiz() {
  const quiz = collectQuizFromForm();
  const msg = document.getElementById("builderMsg");
  if (!quiz.title) { msg.innerHTML = `<div class="error-msg">Give the quiz a title first.</div>`; return; }
  const res = EDITING_QUIZ_ID
    ? await updateQuiz(CURRENT.classCode, EDITING_QUIZ_ID, quiz)
    : await addQuiz(CURRENT.classCode, quiz);
  if (!res.ok) { msg.innerHTML = `<div class="error-msg">${esc(res.error)}</div>`; return; }
  msg.innerHTML = `<div class="success-msg">${EDITING_QUIZ_ID ? "Quiz updated." : "Quiz added."}</div>`;
  cancelEdit();
  await render();
}

function startEditQuiz(id) {
  const q = (CLS.quizzes || []).find(x => x.id === id);
  if (!q) return;
  EDITING_QUIZ_ID = id;
  document.getElementById("qTitle").value = q.title;
  document.getElementById("qDesc").value = q.description || "";
  document.getElementById("qModule").value = q.moduleKey || "";
  document.getElementById("qPass").value = q.passMark;
  document.getElementById("qReward").value = q.reward || 0;
  BUILDER_ROWS = q.questions.map(qq => ({
    id: qq.id, text: qq.text, options: qq.options.slice(), answer: qq.answer, explain: qq.explain || ""
  }));
  paintBuilder();
  document.getElementById("hBuilder").innerHTML = icon("plus", 18) + " Edit quiz";
  document.getElementById("saveQuizBtn").innerHTML = "Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("hBuilder").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEdit() {
  EDITING_QUIZ_ID = null;
  ["qTitle", "qDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("qModule").value = "";
  document.getElementById("qPass").value = 70;
  document.getElementById("qReward").value = 0;
  BUILDER_ROWS = [];
  addQuestionRow();
  addQuestionRow();
  document.getElementById("hBuilder").innerHTML = icon("plus", 18) + " Add a quiz";
  document.getElementById("saveQuizBtn").innerHTML = "Save quiz";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function toggleQuizActive(id, active) {
  await setQuizActive(CURRENT.classCode, id, active);
  await render();
}

async function deleteQuiz(id) {
  if (!confirm("Remove this quiz? Students' results for it are left alone, but it won't lock anything any more.")) return;
  await removeQuiz(CURRENT.classCode, id);
  await render();
}

async function resetResult(username, quizId) {
  if (!confirm("Clear this student's result so they sit the quiz again?")) return;
  await resetQuizResult(username, quizId);
  await render();
}

// A worked example so a teacher can see the shape of a good quiz without
// having to invent one on the spot — it's loaded into the form, not saved,
// so it can be edited freely (or the title changed) before saving.
function loadStarterQuiz() {
  EDITING_QUIZ_ID = null;
  document.getElementById("qTitle").value = "How compound interest works";
  document.getElementById("qDesc").value = "Why money left alone grows faster and faster.";
  document.getElementById("qModule").value = "termdeposit";
  document.getElementById("qPass").value = 70;
  document.getElementById("qReward").value = 0;
  BUILDER_ROWS = [
    {
      id: null,
      text: "You put $100 into an account paying 10% interest a year. What is it worth after 2 years?",
      options: ["$110", "$120", "$121", "$200"],
      answer: 2,
      explain: "Year one adds $10 (10% of $100). Year two adds 10% of $110, which is $11 — so $121. The interest itself earns interest."
    },
    {
      id: null,
      text: "Two people both save $1,000 at the same rate. One starts 5 years earlier. Who ends up with more?",
      options: ["The one who started earlier", "The one who started later", "They end up the same", "It depends on their job"],
      answer: 0,
      explain: "Time is the ingredient compound interest needs most — starting earlier beats saving harder later."
    },
    {
      id: null,
      text: "Compound interest works against you when...",
      options: ["You are saving money", "You owe money on a loan", "Prices go up", "You get paid weekly"],
      answer: 1,
      explain: "The same maths runs in reverse on debt: unpaid interest joins the balance and starts earning interest too."
    }
  ];
  paintBuilder();
  document.getElementById("builderMsg").innerHTML =
    `<div class="success-msg">Starter quiz loaded into the form — edit anything you like, then press Save quiz.</div>`;
}

/* ================= Student ================= */
function renderStudent() {
  const quizzes = (CLS.quizzes || []).filter(q => q.active);
  const gateOn = !!(CLS.quizGate && CLS.quizGate.enabled);
  const banner = document.getElementById("gateBanner");
  const stillLocked = getQuizLockedModulesFromData(CLS, ME);

  document.getElementById("pageIntro").textContent = gateOn
    ? "Pass the quiz attached to a module and that module unlocks. You can retake one as many times as you need."
    : "Short quizzes on how money actually works. Nothing is locked behind them right now — they're here to practise on.";

  if (gateOn && stillLocked.length) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<p style="margin:0;"><strong>${stillLocked.length} ${stillLocked.length === 1 ? "module is" : "modules are"} still locked</strong><br>
      Pass the matching quiz below to unlock: ${stillLocked.map(k => esc(moduleLabel(k))).join(", ")}.</p>`;
  } else if (gateOn && quizzes.length) {
    banner.classList.remove("hidden");
    banner.style.borderColor = "var(--mint)";
    banner.innerHTML = `<p style="margin:0;"><strong>All unlocked</strong><br>You've passed every quiz your teacher set. Nothing is locked behind a quiz for you.</p>`;
  } else {
    banner.classList.add("hidden");
  }

  document.getElementById("noQuizzes").classList.toggle("hidden", quizzes.length > 0);
  const list = document.getElementById("quizList");
  list.innerHTML = quizzes.map(q => {
    const r = quizResultFor(ME, q.id);
    const passed = !!(r && r.passed);
    const locks = gateOn && q.moduleKey && !passed;
    return `
      <div class="quiz-card${passed ? " passed" : locks ? " locking" : ""}">
        <div class="flex-between">
          <div style="flex:1;min-width:220px;">
            <h3>${icon(passed ? "medal" : "key", 18)}${esc(q.title)}</h3>
            ${q.description ? `<p class="muted-small" style="margin:0 0 6px;">${esc(q.description)}</p>` : ""}
            <div class="quiz-meta">
              ${passed
                ? `<span class="quiz-pill mint">${icon("star", 12)}Passed — best ${r.bestPct}%</span>`
                : locks
                  ? `<span class="quiz-pill coral">${icon("lock", 12)}Locks ${esc(moduleLabel(q.moduleKey))}</span>`
                  : q.moduleKey
                    ? `<span class="quiz-pill">${icon("key", 12)}Linked to ${esc(moduleLabel(q.moduleKey))}</span>`
                    : `<span class="quiz-pill">${icon("cards", 12)}Practice</span>`}
              <span class="quiz-pill">${icon("percent", 12)}Pass at ${q.passMark}%</span>
              <span class="quiz-pill">${icon("cards", 12)}${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"}</span>
              ${q.reward > 0 && !(r && r.rewarded) ? `<span class="quiz-pill gold">${icon("coin", 12)}${fmtMoney(q.reward)} for passing</span>` : ""}
              ${r && !passed ? `<span class="quiz-pill coral">Last try ${r.lastPct}%</span>` : ""}
            </div>
          </div>
          <div>
            <button class="btn ${passed ? "secondary" : "gold"} small" onclick="openQuiz('${q.id}')">
              ${icon(passed ? "repeat" : "key", 13)} ${passed ? "Retake" : r ? "Try again" : "Start quiz"}
            </button>
          </div>
        </div>
      </div>`;
  }).join("");
}

function openQuiz(id) {
  const q = (CLS.quizzes || []).find(x => x.id === id && x.active);
  if (!q) return;
  TAKING = q;
  document.getElementById("quizList").classList.add("hidden");
  document.getElementById("noQuizzes").classList.add("hidden");
  document.getElementById("gateBanner").classList.add("hidden");
  const card = document.getElementById("takeCard");
  card.classList.remove("hidden");
  document.getElementById("takeTitle").innerHTML = icon("key", 20) + " " + esc(q.title);
  document.getElementById("takeIntro").textContent =
    `${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"} · you need ${q.passMark}% to pass` +
    (q.moduleKey ? ` · passing unlocks ${moduleLabel(q.moduleKey)}` : "");
  document.getElementById("takeResult").innerHTML = "";
  document.getElementById("takeMsg").innerHTML = "";
  document.getElementById("submitQuizBtn").classList.remove("hidden");
  document.getElementById("takeBody").innerHTML = q.questions.map((qq, i) => `
    <div class="quiz-question" id="qq-${qq.id}">
      <p class="qtext">${i + 1}. ${esc(qq.text)}</p>
      ${qq.options.map((opt, j) => `
        <label class="quiz-option" id="opt-${qq.id}-${j}">
          <input type="radio" name="ans-${qq.id}" value="${j}" onchange="markChosen('${qq.id}', ${j})">
          <span>${esc(opt)}</span>
        </label>`).join("")}
    </div>`).join("");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markChosen(qid, idx) {
  const q = TAKING.questions.find(x => x.id === qid);
  if (!q) return;
  q.options.forEach((_, j) => {
    const el = document.getElementById(`opt-${qid}-${j}`);
    if (el) el.classList.toggle("chosen", j === idx);
  });
}

function closeQuiz() {
  TAKING = null;
  document.getElementById("takeCard").classList.add("hidden");
  document.getElementById("quizList").classList.remove("hidden");
  render();
}

async function submitQuiz() {
  if (!TAKING) return;
  const answers = {};
  let unanswered = 0;
  TAKING.questions.forEach(q => {
    const checked = document.querySelector(`input[name="ans-${q.id}"]:checked`);
    if (checked) answers[q.id] = Number(checked.value);
    else unanswered++;
  });
  if (unanswered > 0 && !confirm(`${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still blank — they'll be marked wrong. Submit anyway?`)) return;

  const btn = document.getElementById("submitQuizBtn");
  btn.disabled = true;
  const res = await submitQuizAttempt(CURRENT.username, CURRENT.classCode, TAKING.id, answers);
  btn.disabled = false;
  if (!res.ok) {
    document.getElementById("takeMsg").innerHTML = `<div class="error-msg">${esc(res.error)}</div>`;
    return;
  }

  document.getElementById("takeResult").innerHTML = `
    <div class="quiz-score ${res.passed ? "pass" : "fail"}">
      <span class="big">${res.pct}%</span>
      <span class="txt">
        ${res.correct} out of ${res.total} correct — ${res.passed ? "you passed!" : `you need ${res.passMark}% to pass.`}<br>
        ${res.passed
          ? (res.reward > 0 ? `${fmtMoney(res.reward)} bonus paid into your account.` : (TAKING.moduleKey ? `${esc(moduleLabel(TAKING.moduleKey))} is unlocked.` : "Nice work."))
          : "Read the explanations below, then have another go."}
      </span>
    </div>`;

  // Mark the paper: colour every option, and surface the explanations.
  res.review.forEach(r => {
    r.options.forEach((_, j) => {
      const el = document.getElementById(`opt-${r.id}-${j}`);
      if (!el) return;
      el.classList.remove("chosen");
      if (j === r.answer) el.classList.add("right");
      else if (j === r.chosen) el.classList.add("wrong");
      const input = el.querySelector("input");
      if (input) input.disabled = true;
    });
    const box = document.getElementById(`qq-${r.id}`);
    if (box && r.explain && !box.querySelector(".quiz-explain")) {
      const p = document.createElement("p");
      p.className = "quiz-explain";
      p.innerHTML = `<strong>${r.correct ? "Correct." : "Not quite."}</strong> ${esc(r.explain)}`;
      box.appendChild(p);
    }
  });

  document.getElementById("submitQuizBtn").classList.add("hidden");
  document.getElementById("takeResult").scrollIntoView({ behavior: "smooth", block: "center" });
  // Refresh the cached user so the list behind the quiz (and the nav locks)
  // reflect the new result the moment the student goes back.
  ME = Object.assign({ username: CURRENT.username }, await getUser(CURRENT.username));
}

document.addEventListener("DOMContentLoaded", init);
