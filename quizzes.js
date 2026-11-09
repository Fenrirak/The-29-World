/* ===================== The 29 World — Financial-literacy quizzes =====================
   Two pages in one, same as store.js/property.js do it: the teacher gets a
   quiz builder + class results, the student gets a list of quizzes and the
   flow for actually sitting one.

   All the rules live in data-life.js (addQuiz / updateQuiz / submitQuizAttempt /
   getQuizLockedModulesFromData) — this file is only ever presentation and
   form-wrangling.
================================================================================ */
let CURRENT, IS_TEACHER;
let CLS = null;
let ME = null;
let STUDENTS = [];
let EDITING_QUIZ_ID = null;   // set while the teacher is editing an existing quiz
let BUILDER_ROWS = [];        // [{ id, text, options: [str], answer: idx, explain }]

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function moduleLabel(key) {
  if (!key) return "Practice only";
  const m = QUIZ_UNLOCKABLE_MODULES.find(x => x.key === key);
  if (!m) return "Practice only";
  return m ? m.label : key;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("quiz", 26) + " Quizzes";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  // Students never browse quizzes as a page any more — a quiz reaches them
  // as a popup on the module it guards (see quiz-gate.js), so anyone
  // landing here without being a teacher goes back to their dashboard.
  if (!IS_TEACHER) { window.location.href = "student.html"; return; }
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  paintChrome();

  if (IS_TEACHER) {
    document.getElementById("pageIntro").textContent =
      "Write short quizzes on how money works, and (optionally) make passing one the key that unlocks a module.";
    buildModuleSelect();
    addQuestionRow();
    addQuestionRow();
  }

  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(dailyLifeAllowanceForClassIfDue(u.classCode), "dailyLifeAllowanceForClassIfDue")
      : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  await render();
}

async function render() {
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  ME = Object.assign({ username: CURRENT.username }, me);
  CLS = withNewModuleDefaults(cls);
  // init() already redirects any non-teacher away before this can ever run
  // (see the comment there) — renderStudent() used to live here for the
  // other branch, but it's been removed as dead code.
  await renderTeacher();
}

/* ================= Teacher ================= */
function buildModuleSelect() {
  const sel = document.getElementById("qModule");
  sel.innerHTML = `<option value="">Nothing. Practice only</option>` +
    QUIZ_UNLOCKABLE_MODULES.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join("");
}

async function renderTeacher() {
  paintGateSummary();
  paintReco();

  const quizzes = CLS.quizzes || [];
  const list = document.getElementById("teacherQuizList");
  document.getElementById("noTeacherQuizzes").classList.toggle("hidden", quizzes.length > 0);
  list.innerHTML = quizzes.map(q => `
    <div class="quiz-card${quizModuleKey(q) ? " locking" : ""}">
      <div class="flex-between">
        <div style="flex:1;min-width:220px;">
          <h3>${esc(q.title)}</h3>
          ${q.description ? `<p class="muted-small" style="margin:0 0 6px;">${esc(q.description)}</p>` : ""}
          <div class="quiz-meta">
            <span class="quiz-pill${quizModuleKey(q) && q.active ? " coral" : ""}">${quizModuleKey(q) ? (q.active ? "Locks: " : "Would lock: ") : ""}${esc(moduleLabel(q.moduleKey))}</span>
            ${q.deadline ? `<span class="quiz-pill${quizDeadlineState(q) === "overdue" ? " coral" : ""}">Due ${esc(quizDeadlineLabel(q.deadline))}${quizDeadlineState(q) === "overdue" ? " (overdue)" : ""}</span>` : ""}
            <span class="quiz-pill">Pass mark ${q.passMark}%</span>
            <span class="quiz-pill">${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"}</span>
            ${q.reward > 0 ? `<span class="quiz-pill gold">${fmtMoney(q.reward)} bonus</span>` : ""}
            <span class="quiz-pill${q.active ? " mint" : ""}">${q.active ? "Active" : "Paused"}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          <button class="btn small secondary" onclick="startEditQuiz('${q.id}')">${icon("edit", 13)} Edit</button>
          <button class="btn small secondary" onclick="toggleQuizActive('${q.id}', ${!q.active})">${q.active ? "Pause" : "Activate"}</button>
          <button class="btn small coral" onclick="deleteQuiz('${q.id}')">${icon("trash", 13)} Remove</button>
        </div>
      </div>
    </div>
  `).join("");

  // Results table — one row per student, one column per quiz.
  STUDENTS = await getClassStudents(CURRENT.classCode, CLS);
  paintOverdue();
  const wrap = document.getElementById("resultsWrap");
  const show = quizzes.length > 0 && STUDENTS.length > 0;
  document.getElementById("noResults").classList.toggle("hidden", show);
  if (!show) { wrap.innerHTML = ""; return; }
  const passedOf = s => quizzes.filter(q => (quizResultFor(s, q.id) || {}).passed).length;
  const cell = (s, q) => {
    const r = quizResultFor(s, q.id), od = q.active && quizDeadlineState(q) === "overdue";
    const tries = r ? `${r.attempts} ${r.attempts === 1 ? "try" : "tries"}` : "";
    if (!r) return { cls: od ? "od" : "none", txt: od ? "Overdue" : "—", tip: "Not tried" + (od ? " (overdue)" : ""), has: false };
    return { cls: r.passed ? "pass" : od ? "od" : "fail", txt: r.bestPct + "%", tip: `${r.passed ? "Passed" : "Not passed yet"} · best ${r.bestPct}% · ${tries}`, has: true };
  };
  const reset = (s, q) => `<button class="qr-reset" type="button" onclick="resetResult('${escapeJsAttr(s.username)}','${q.id}')">Reset</button>`;
  const bar = (n) => `<span class="qr-bar" aria-hidden="true"><i style="width:${Math.round(n / quizzes.length * 100)}%"></i></span>`;
  wrap.innerHTML = `
    <div class="qr-desktop table-scroll">
      <table class="qr-table">
        <thead>
          <tr><th class="qr-name">Student</th><th>Passed</th>${quizzes.map(q => `<th title="${esc(q.title)}">${esc(q.title)}</th>`).join("")}</tr>
          <tr class="qr-sum"><td class="qr-name">Class passed</td><td></td>${quizzes.map(q => {
            const n = STUDENTS.filter(s => (quizResultFor(s, q.id) || {}).passed).length;
            return `<td>${n}/${STUDENTS.length}</td>`;
          }).join("")}</tr>
        </thead>
        <tbody>
          ${STUDENTS.map(s => `<tr>
            <td class="qr-name">${esc(s.name)}</td>
            <td><strong>${passedOf(s)}/${quizzes.length}</strong>${bar(passedOf(s))}</td>
            ${quizzes.map(q => { const c = cell(s, q); return `<td title="${esc(c.tip)}"><span class="qr-chip ${c.cls}">${c.txt}</span>${c.has ? reset(s, q) : ""}</td>`; }).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="qr-mobile">
      ${STUDENTS.map(s => `<details class="qr-card">
        <summary><span class="qr-card-name">${esc(s.name)}</span><span class="qr-card-count">${passedOf(s)}/${quizzes.length} passed</span>${bar(passedOf(s))}</summary>
        <ul class="qr-list">${quizzes.map(q => { const c = cell(s, q); return `<li>
          <span class="qr-list-title">${esc(q.title)}<small>${esc(c.tip)}</small></span>
          <span class="qr-list-end"><span class="qr-chip ${c.cls}">${c.txt}</span>${c.has ? reset(s, q) : ""}</span>
        </li>`; }).join("")}</ul>
      </details>`).join("")}
    </div>`;
}

/* ---------------- Unlock gates: summary, bulk switch, overdue ---------------- */
function paintGateSummary() {
  const quizzes = CLS.quizzes || [];
  const locking = quizzes.filter(q => q.active && quizModuleKey(q));
  const paused = quizzes.filter(q => !q.active && quizModuleKey(q));
  const names = locking.map(q => moduleLabel(q.moduleKey)).join(", ");
  document.getElementById("gateSummary").innerHTML = quizzes.length ? `
    <span class="quiz-pill${locking.length ? " coral" : ""}">${locking.length} ${locking.length === 1 ? "module" : "modules"} locked by a quiz</span>
    <span class="quiz-pill">${paused.length} paused</span>
    ${locking.length ? `<span class="muted-small" style="align-self:center;">${esc(names)}</span>` : ""}` : `<span class="muted-small">No quizzes yet.</span>`;
  document.getElementById("activateAllBtn").classList.toggle("hidden", !quizzes.some(q => !q.active));
  document.getElementById("pauseAllBtn").classList.toggle("hidden", !quizzes.some(q => q.active));
}

async function activateAllQuizzes(on) {
  const n = (CLS.quizzes || []).filter(q => q.active !== on && quizModuleKey(q)).length;
  if (on && n && !await t29Confirm(`Activate every quiz? ${n} ${n === 1 ? "module" : "modules"} will lock for students until they pass the quiz attached to it.`)) return;
  await setAllQuizzesActive(CURRENT.classCode, on);
  document.getElementById("gateMsg").innerHTML = `<div class="success-msg">${on ? "All quizzes are active, their modules are locked until passed." : "All quizzes are paused, nothing is locked by a quiz."}</div>`;
  await render();
}

function paintOverdue() {
  const rows = quizOverdueRows(CLS, STUDENTS);
  document.getElementById("overdueWrap").innerHTML = rows.map(r => {
    const n = r.students.length, names = r.students.slice(0, 6).map(s => esc(s.name)).join(", ");
    return `<div class="qz-overdue">
      <p><strong>${icon("hourglass", 14)} ${esc(r.quiz.title)}</strong> was due ${esc(quizDeadlineLabel(r.quiz.deadline))}. ${n} ${n === 1 ? "student hasn't" : "students haven't"} passed: ${names}${n > 6 ? ` and ${n - 6} more` : ""}.</p>
      <button class="btn small coral" type="button" onclick="remindQuiz('${r.quiz.id}')">Remind ${n === 1 ? "them" : "all " + n}</button>
    </div>`;
  }).join("");
}

async function remindQuiz(id) {
  const res = await remindQuizStudents(CURRENT.classCode, id);
  document.getElementById("gateMsg").innerHTML = res.ok
    ? `<div class="success-msg">Reminder sent to ${res.count} ${res.count === 1 ? "student" : "students"}.</div>`
    : `<div class="error-msg">That quiz couldn't be found.</div>`;
}

/* ---------------- Recommended quizzes ----------------
   For a class built from scratch: the same ready-made set the base template ships (one per
   module), scaled for a full year (4 terms), offered like the recommended bank accounts.
   Added ones are ordinary quizzes the teacher can edit, pause or remove. Gone once every one has
   been added; can be dismissed (remembered on this device) and brought back. */
const QZ_RECO_TERMS = 4;
const qzRecoKey = () => "t29-qz-reco-dismissed:" + ((CURRENT && CURRENT.classCode) || "");
function qzRecoDismissed() { try { return localStorage.getItem(qzRecoKey()) === "1"; } catch (e) { return false; } }
function qzDismissReco(on) {
  try { if (on) localStorage.setItem(qzRecoKey(), "1"); else localStorage.removeItem(qzRecoKey()); } catch (e) { /* ignore */ }
  paintReco();
}
function qzRecoRemaining() {
  const have = new Set((CLS.quizzes || []).map(q => String(q.title || "").trim().toLowerCase()));
  return t29BaseTemplateQuizzes(QZ_RECO_TERMS).filter(r => !have.has(r.title.toLowerCase()));
}
function paintReco() {
  const wrap = document.getElementById("recoWrap");
  const left = qzRecoRemaining();
  if (!left.length) { wrap.innerHTML = ""; return; }
  if (qzRecoDismissed()) {
    wrap.innerHTML = `<p class="muted-small"><a href="#" onclick="qzDismissReco(false);return false;">Show recommended quizzes</a></p>`;
    return;
  }
  wrap.innerHTML = `<div class="card qz-reco-panel">
    <div class="qz-reco-head">
      <h2>${icon("sparkle", 18)} Recommended quizzes</h2>
      <span class="qz-reco-actions">
        <button class="btn small gold" type="button" onclick="qzAddAllReco()">+ Add all ${left.length} remaining</button>
        <button class="btn small secondary" type="button" onclick="qzDismissReco(true)">Dismiss</button>
      </span>
    </div>
    <p class="muted-small">A ready-made financial-literacy quiz for each module, sized for a full year. Add one and it locks that module until students pass it, with a cash bonus for passing. You can edit every question afterwards.</p>
    <div class="qz-reco-grid">${left.map(r => `
      <div class="qz-reco-item">
        <div><strong>${esc(r.title)}</strong><span class="muted-small">${esc(r.description)}</span></div>
        <div class="quiz-meta" style="margin:0;">
          <span class="quiz-pill coral">${esc(moduleLabel(r.moduleKey))}</span>
          <span class="quiz-pill">${r.questions.length} questions</span>
          <span class="quiz-pill gold">${fmtMoney(r.reward)} bonus</span>
        </div>
        <button class="btn small gold" type="button" onclick="qzAddReco('${esc(r.recoKey)}')">+ Add</button>
      </div>`).join("")}
    </div></div>`;
}
async function qzAddReco(key) {
  const r = qzRecoRemaining().find(x => x.recoKey === key);
  if (!r) return;
  await addQuizzes(CURRENT.classCode, [Object.assign({}, r, { active: true })]);
  await render();
  document.getElementById("gateMsg").innerHTML = `<div class="success-msg">Added <strong>${esc(r.title)}</strong>: ${esc(moduleLabel(r.moduleKey))} is now locked until students pass it. Edit it any time below.</div>`;
}
async function qzAddAllReco() {
  const left = qzRecoRemaining();
  if (!left.length) return;
  if (!await t29Confirm(`Add ${left.length} quizzes? Each one locks its module until students pass it. (You can pause any of them afterwards.)`)) return;
  await addQuizzes(CURRENT.classCode, left.map(r => Object.assign({}, r, { active: true })));
  await render();
  document.getElementById("gateMsg").innerHTML = `<div class="success-msg">Added ${left.length} quizzes. Edit, pause or remove any of them below.</div>`;
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
    row.answer = checked ? Number(checked.value) : -1;
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
  // Keep the tick on the same option: options below the removed one move
  // up a place. Removing the ticked option itself leaves nothing ticked,
  // so the teacher has to pick again (saveQuiz checks).
  if (optIdx < row.answer) row.answer -= 1;
  else if (optIdx === row.answer) row.answer = -1;
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
          <button class="btn small secondary qb-del" type="button" onclick="removeOptionFrom(${i}, ${j})" aria-label="Remove option" ${row.options.length <= 2 ? "disabled" : ""}>×</button>
        </div>`).join("")}
      <button class="btn small secondary" type="button" onclick="addOptionTo(${i})" ${row.options.length >= 6 ? "disabled" : ""}>Add another option</button>
      <label for="qb-explain-${i}" style="margin-top:12px;">Explanation shown after answering (optional)</label>
      <input id="qb-explain-${i}" value="${esc(row.explain)}" placeholder="e.g. $110 after year one, then 10% of $110. Interest earns interest.">
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
    deadline: document.getElementById("qDeadline").value,
    active: true,
    questions: BUILDER_ROWS.map(r => ({ id: r.id, text: r.text, options: r.options, answer: r.answer, explain: r.explain }))
  };
}

async function saveQuiz() {
  const quiz = collectQuizFromForm();
  const msg = document.getElementById("builderMsg");
  if (!quiz.title) { msg.innerHTML = `<div class="error-msg">Give the quiz a title first.</div>`; return; }
  // Every question that will be saved needs its correct answer ticked, on
  // an option that isn't blank.
  const unticked = quiz.questions.findIndex(q => String(q.text || "").trim()
    && q.options.filter(o => String(o || "").trim()).length >= 2
    && !String(q.options[q.answer] || "").trim());
  if (unticked !== -1) { msg.innerHTML = `<div class="error-msg">Question ${unticked + 1}: tick the correct answer.</div>`; return; }
  const res = EDITING_QUIZ_ID
    ? await updateQuiz(CURRENT.classCode, EDITING_QUIZ_ID, quiz)
    : await addQuiz(CURRENT.classCode, quiz);
  if (!res.ok) { msg.innerHTML = `<div class="error-msg">${esc(res.error)}</div>`; return; }
  msg.innerHTML = `<div class="success-msg">${EDITING_QUIZ_ID ? "Quiz updated." : "Quiz added."}</div>`;
  cancelEdit();
  await render();
}

function openBuilder() {
  const d = document.getElementById("builderCard");
  d.open = true;
  document.getElementById("hBuilder").scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.getElementById("qDeadline").value = q.deadline || "";
  BUILDER_ROWS = q.questions.map(qq => ({
    id: qq.id, text: qq.text, options: qq.options.slice(), answer: qq.answer, explain: qq.explain || ""
  }));
  paintBuilder();
  document.getElementById("hBuilder").innerHTML = icon("edit", 18) + " Edit quiz";
  document.getElementById("saveQuizBtn").innerHTML = "Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  openBuilder();
}

function cancelEdit() {
  EDITING_QUIZ_ID = null;
  ["qTitle", "qDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("qModule").value = "";
  document.getElementById("qPass").value = 70;
  document.getElementById("qReward").value = 0;
  document.getElementById("qDeadline").value = "";
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
  if (!await t29Confirm("Remove this quiz? Students' results for it are left alone, but it won't lock anything any more.")) return;
  await removeQuiz(CURRENT.classCode, id);
  await render();
}

async function resetResult(username, quizId) {
  if (!await t29Confirm("Clear this student's result so they sit the quiz again?")) return;
  await resetQuizResult(username, quizId);
  await render();
}

// A worked example so a teacher can see the shape of a good quiz without
// having to invent one on the spot — it's loaded into the form, not saved,
// so it can be edited freely (or the title changed) before saving.
function loadStarterQuiz() {
  EDITING_QUIZ_ID = null;
  document.getElementById("builderCard").open = true;
  document.getElementById("qTitle").value = "How compound interest works";
  document.getElementById("qDesc").value = "Why money left alone grows faster and faster.";
  document.getElementById("qModule").value = "termdeposit";
  document.getElementById("qPass").value = 70;
  document.getElementById("qReward").value = 0;
  document.getElementById("qDeadline").value = "";
  BUILDER_ROWS = [
    {
      id: null,
      text: "You put $100 into an account paying 10% interest a year. What is it worth after 2 years?",
      options: ["$110", "$120", "$121", "$200"],
      answer: 2,
      explain: "Year one adds $10 (10% of $100). Year two adds 10% of $110, which is $11, so $121. The interest itself earns interest."
    },
    {
      id: null,
      text: "Two people both save $1,000 at the same rate. One starts 5 years earlier. Who ends up with more?",
      options: ["The one who started earlier", "The one who started later", "They end up the same", "It depends on their job"],
      answer: 0,
      explain: "Time is the ingredient compound interest needs most. Starting earlier beats saving harder later."
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
    `<div class="success-msg">Starter quiz loaded into the form. Edit anything you like, then press Save quiz.</div>`;
}

document.addEventListener("DOMContentLoaded", init);
