const CAREER_CV_FIELDS = {
  summary: "Personal statement", skills: "Skills", experience: "Experience", education: "Education and training"
};

const CAREER_QUESTIONS = [
  ["A listing asks for teamwork. What belongs in your CV?", "An example of working in a group", "A list of your favourite subjects", "Describe what you did and how it helped the group."],
  ["What should you check before comparing two job offers?", "How often the pay is quoted", "Which employer has the shorter name", "Compare both offers over the same period, such as hourly pay or annual salary."],
  ["How should you prepare for a job interview?", "Practise describing something you achieved", "Memorise a speech for every question", "A specific example lets you show a skill and answer follow-up questions."],
  ["A job ad says a skill is desirable. What does that usually mean?", "It would help, but you can still apply", "It is always a compulsory qualification", "Desirable skills can strengthen an application. Essential criteria are the stated requirements."],
  ["When you switch jobs, what happens to your existing student loan?", "You still owe the outstanding balance", "The old employer pays it off", "Study debt belongs to the borrower. Changing jobs does not erase it."],
  ["What is take-home pay?", "The money you receive after deductions", "The amount before any deductions", "Gross pay is the starting amount. Net pay is what reaches you."],
  ["Before agreeing to training, what cost should you compare?", "The total cost, including equipment and fees", "Only the first payment", "Compare the full cost and what the training could help you do."],
  ["What makes a helpful referee?", "Someone who can describe your work and has agreed to be contacted", "Anyone with a job title you recognise", "Ask permission first and choose someone who can give a specific example."],
  ["How could you learn what a job is like before applying?", "Ask someone in the role about a typical day", "Assume the title explains all the tasks", "Ask about everyday responsibilities, hours and training."],
  ["What should you do when you receive a job offer?", "Read the hours, pay and conditions before accepting", "Accept immediately and check the details later", "Reading the conditions gives you time to ask about anything unclear."],
  ["Which is an example of a transferable skill?", "Explaining instructions clearly", "Knowing one workplace's door code", "Transferable skills are useful in different roles and workplaces."],
  ["What should your cover letter explain?", "Why your skills and experience fit this role", "Every job in your preferred industry", "Use the job ad to choose examples relevant to this application."],
  ["Which path can combine training with paid work?", "An apprenticeship", "Only full-time classroom study", "Apprentices usually learn a trade on the job while working towards a qualification."],
  ["You lack one listed skill. What is a good next step?", "Find a way to practise and show what you learn", "Claim you already have it", "An honest example of learning shows initiative and gives you something to discuss."]
];

const CAREER_COURSES = [
  { id: "workplace", name: "Workplace communication", fee: 25, detail: "Practise giving instructions, listening and handling feedback.",
    lesson: "When you hand over a task, explain what needs doing, when it is due and what a successful result looks like. Ask the other person to explain the next step in their own words.",
    practice: "Write a three-sentence handover for a classmate taking over a library shift. Include a question that checks whether your instructions were clear." },
  { id: "digital", name: "Digital skills", fee: 60, detail: "Learn to organise files, use spreadsheets and explain data.",
    lesson: "A spreadsheet can compare options using the same units. Label your columns, record where the numbers came from and show your calculation so a colleague can check it.",
    practice: "Make a table comparing two courses. Include fees, materials and total cost. Write one sentence explaining which costs less and by how much." },
  { id: "trade", name: "Trades foundation", fee: 100, detail: "Explore workshop safety, measurements and planning a small job.",
    lesson: "A materials list starts with a plan. Note the unit beside every measurement, check the cut list against the drawing, and ask a supervisor about hazards before starting.",
    practice: "Sketch a rectangular shelf on paper. Label its width and depth, list the measurements someone would need, and note one safety question to ask before making it." }
];
const CAREER_LOAN_WEEKS = 4;
const careerEl = id => document.getElementById(id);
const careerProfileRef = username => fdb.collection("careerProfiles").doc(username);
let careerProfile, careerLoad, careerCheckBusy = false, careerLoanBusy = false;

function readCareerCv() {
  const fields = new FormData(careerEl("careerCv"));
  return Object.fromEntries(Object.keys(CAREER_CV_FIELDS).map(key => [key, fields.get(key).trim()]));
}

function setCareerCv(cv) {
  for (const key of Object.keys(CAREER_CV_FIELDS)) careerEl("careerCv").elements.namedItem(key).value = cv?.[key] || "";
}

function renderCareers(me, cls) {
  if (!me) return;
  renderCareerLoans(me, cls);
  if (careerProfile) { paintCareerCheckIn(); return; }
  if (careerLoad) return;
  if (me._studentView || t29SvActive()) {
    careerProfile = {};
    paintCareerCheckIn();
    careerEl("careerCvMsg").textContent = "CV saving is available from a student account.";
    return;
  }
  for (const field of careerEl("careerCv").querySelectorAll("textarea")) field.readOnly = true;
  careerEl("careerCheckInMsg").textContent = "Loading today's question…";
  careerLoad = careerProfileRef(me.username).get().then(snap => {
    careerProfile = snap.exists ? snap.data() : {};
    setCareerCv(careerProfile.cv);
    for (const field of careerEl("careerCv").querySelectorAll("textarea")) field.readOnly = false;
    careerEl("careerCvMsg").textContent = "";
    careerEl("careerCheckInMsg").textContent = "";
    careerEl("careerCv").querySelector('button[type="submit"]').disabled = false;
    paintCareerCheckIn();
  }).catch(() => {
    careerEl("careerCvMsg").textContent = "Couldn't load your careers profile. Reload this page to try again.";
    careerEl("careerCheckInMsg").textContent = "Couldn't load today's question. Reload this page to try again.";
  }).finally(() => { careerLoad = null; });
}

async function saveCareerCv(event) {
  event.preventDefault();
  const button = event.submitter || careerEl("careerCv").querySelector('button[type="submit"]');
  if (!careerProfile || button.disabled || t29SvActive()) return;
  const cv = readCareerCv();
  const message = careerEl("careerCvMsg");
  button.disabled = true;
  try {
    await careerProfileRef(CURRENT.username).set({cv}, {merge: true});
    careerProfile.cv = cv;
    message.textContent = "CV saved.";
  } catch {
    message.textContent = "Couldn't save your CV. Try again.";
  } finally { button.disabled = false; }
}

function downloadCareerCv() {
  const cv = readCareerCv();
  const sections = Object.entries(CAREER_CV_FIELDS).filter(([key]) => cv[key]);
  if (!sections.length) {
    careerEl("careerCvMsg").textContent = "Fill in at least one section to download your CV.";
    return;
  }
  const text = t29DisplayName(CURRENT) + "\n\n" + sections.map(([key, title]) => title + "\n" + cv[key]).join("\n\n") + "\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"}));
  link.download = "My CV.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function careerQuestion(day) {
  const dayNumber = Math.floor(dateKeyToUTC(day) / 86400000);
  const [prompt, correct, other, feedback] = CAREER_QUESTIONS[dayNumber % CAREER_QUESTIONS.length];
  const correctIndex = (dayNumber + Math.floor(dayNumber / 7)) % 2;
  return {prompt, choices: correctIndex === 0 ? [correct, other] : [other, correct], correctIndex, feedback};
}

function paintCareerCheckIn() {
  const form = careerEl("careerCheckIn");
  if (!careerProfile || !form) return;
  const day = nzDateKey();
  const check = careerProfile.checkIn;
  if (form.dataset.day === day && form.dataset.completed === String(check?.day === day)) return;
  form.dataset.day = day;
  form.dataset.completed = String(check?.day === day);
  const question = careerQuestion(day);
  const count = check?.completed || 0;
  const progress = '<p class="muted-small">' + count + ' check-in' + (count === 1 ? '' : 's') + ' completed</p>';
  form.innerHTML = progress + (check?.day === day
    ? '<p><strong>' + (check.correct ? 'Correct!' : 'Today’s answer') + '</strong> ' + question.feedback + '</p><p class="muted-small">Come back tomorrow for a new question.</p>'
    : '<p><strong>' + escapeHtml(question.prompt) + '</strong></p><select name="answer" aria-label="Choose an answer" required><option value="">Choose an answer</option>'
      + question.choices.map((choice, i) => '<option value="' + i + '">' + escapeHtml(choice) + '</option>').join("")
      + '</select><button class="btn gold" type="submit"' + (t29SvActive() ? ' disabled' : '') + '>Check answer</button>');
}

async function recordCareerCheckIn(username, day, answer) {
  if (day !== nzDateKey() || ![0, 1].includes(answer)) throw new Error("Choose an answer for today’s question.");
  const ref = careerProfileRef(username);
  const question = careerQuestion(day);
  return fdb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prior = snap.exists ? snap.data().checkIn : null;
    if (prior?.day >= day) return prior;
    const checkIn = {day, completed: (prior?.completed || 0) + 1, correct: answer === question.correctIndex};
    tx.set(ref, {checkIn}, {merge: true});
    return checkIn;
  });
}

async function submitCareerCheckIn(event) {
  event.preventDefault();
  if (careerCheckBusy || !careerProfile || t29SvActive()) return;
  const form = event.currentTarget, message = careerEl("careerCheckInMsg");
  if (form.dataset.day !== nzDateKey()) {
    paintCareerCheckIn();
    message.textContent = "A new question is ready.";
    return;
  }
  careerCheckBusy = true;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    careerProfile.checkIn = await recordCareerCheckIn(CURRENT.username, form.dataset.day, Number(form.elements.answer.value));
    message.textContent = "";
    paintCareerCheckIn();
  } catch {
    message.textContent = "Couldn't save your answer. Try again.";
  } finally {
    button.disabled = false;
    careerCheckBusy = false;
  }
}

function canUseCareerLoans(me, cls) {
  return !me._studentView && !t29SvActive() && !cls.archived && !moduleIsOff(cls, "loan")
    && !isModuleLockedForStudentFromData(cls, me, me.username, "loan");
}

async function takeCareerLoan(username, classCode, courseId) {
  const course = CAREER_COURSES.find(item => item.id === courseId);
  if (!course) throw new Error("This course is unavailable.");
  const userRef = usersCol().doc(username), classRef = classesCol().doc(classCode);
  const day = nzDateKey();
  return fdb.runTransaction(async tx => {
    const user = (await tx.get(userRef)).data();
    const snapshot = await tx.get(classRef);
    const cls = snapshot.exists && withNewModuleDefaults(snapshot.data());
    if (!user || user.role !== "student" || user.classCode !== classCode || !cls || !canUseCareerLoans(user, cls)) {
      throw new Error("Student loans are unavailable for your account right now.");
    }
    const loans = user.loans || [];
    if (loans.some(loan => loan.courseId === course.id)) return false;
    const active = loans.filter(loan => loan.status === "active");
    if (cls.maxLoanCount > 0 && active.length >= cls.maxLoanCount) throw new Error("You have reached your class’s open loan limit.");
    if (cls.maxLoanAmount > 0 && active.reduce((sum, loan) => sum + loan.principal, course.fee) > cls.maxLoanAmount) {
      throw new Error("This loan would put you over your class’s borrowing limit.");
    }
    tx.update(userRef, {loans: [...loans, {
      id: "study_" + course.id, courseId: course.id, courseName: course.name,
      principal: course.fee, owed: course.fee, rate: 0, interestAmt: 0, termWeeks: CAREER_LOAN_WEEKS,
      takenDate: day, dueDate: dateKeyPlusDays(day, CAREER_LOAN_WEEKS * 7), status: "active"
    }]});
    return true;
  });
}

function renderCareerLoans(me, cls) {
  const loans = (me.loans || []).filter(loan => loan.courseId);
  const owed = loans.reduce((sum, loan) => sum + (loan.status === "active" ? loan.owed : 0), 0);
  const available = canUseCareerLoans(me, cls);
  careerEl("careerLoanBalance").innerHTML = '<p><strong>' + fmtMoney(owed) + ' outstanding</strong>'
    + (available ? ' · <a href="loan.html">View or repay loans</a>' : ' · Student loans are unavailable right now.') + '</p>';
  careerEl("careerCourses").innerHTML = CAREER_COURSES.map(course => {
    const loan = loans.find(item => item.courseId === course.id);
    return `<div class="job-board-card"><h3>${course.name}</h3><p>${course.detail}</p>
      <p class="muted-small">${fmtMoney(course.fee)} · Interest-free · Due in ${CAREER_LOAN_WEEKS} weeks</p>
      ${loan ? `<p class="muted-small">Enrolled · ${loan.status === "paid" ? "Loan repaid" : fmtMoney(loan.owed) + " owed"}</p>
        <details><summary>Open lesson</summary><p>${course.lesson}</p><p><strong>Practice</strong> ${course.practice}</p></details>`
        : `<button class="btn small secondary" type="button" onclick="borrowForCareer('${course.id}')" ${available ? "" : "disabled"}>Enrol with a student loan</button>`}
      </div>`;
  }).join("");
}

async function borrowForCareer(courseId) {
  const course = CAREER_COURSES.find(item => item.id === courseId);
  if (!course || careerLoanBusy) return;
  careerLoanBusy = true;
  const message = careerEl("careerLoanMsg");
  try {
    if (!await t29Confirm(`Borrow ${fmtMoney(course.fee)} for ${course.name}? The loan pays the classroom course fee. Repay it within ${CAREER_LOAN_WEEKS} weeks from Loans.`, {confirmText: "Enrol and borrow"})) return;
    const added = await takeCareerLoan(CURRENT.username, CLASS_CODE, courseId);
    message.textContent = added ? "Enrolled. Your student loan is listed under Loans." : "You are already enrolled in this course.";
    await render();
  } catch (err) {
    message.textContent = err.code ? "Couldn't enrol right now. Try again." : err.message;
  } finally { careerLoanBusy = false; }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) paintCareerCheckIn();
});
