/* ===================== The 29 World — data layer =====================
   Everything is now stored in Firestore (collections "users" and
   "classes") so multiple devices share the same live data.
   This file depends on firebase-init.js (must load before it) and has
   no other dependencies. Load it before any other The 29 World script.

   IMPORTANT: almost every function here is now ASYNC and returns a
   Promise. Callers must use `await`.
====================================================================== */

const SESSION_KEY = "anw_session"; // session stays in localStorage — it's fine for this to be per-device
const MAX_STUDENTS_PER_CLASS = 8;
const MAX_STORED_TXNS = 200; // keep class docs from growing forever

function usersCol() { return fdb.collection("users"); }
function classesCol() { return fdb.collection("classes"); }

function genCode(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowStr() {
  return new Date().toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" });
}

/* ---------------- New Zealand game-clock helpers ----------------
   Everything that depends on "what day/date is it" (pay day, automations,
   mortgages, interest, term deposits, random events) reads NZ wall-clock
   time, not the visiting device's local time zone. */
function nzParts(d) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  const map = {};
  fmt.formatToParts(d || new Date()).forEach(p => { map[p.type] = p.value; });
  return map; // { weekday: "Mon", year: "2026", month: "07", day: "15" }
}
function nzDayName(d) { return nzParts(d).weekday; } // "Mon".."Sun" — matches DAY_NAMES values
function nzDateKey(d) { const p = nzParts(d); return `${p.year}-${p.month}-${p.day}`; }
function dateKeyToUTC(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetweenKeys(earlierKey, laterKey) {
  return Math.round((dateKeyToUTC(laterKey) - dateKeyToUTC(earlierKey)) / 86400000);
}

/* ---------------- Basic doc fetch helpers ---------------- */
async function getUser(username) {
  if (!username) return null;
  const snap = await usersCol().doc(username).get();
  return snap.exists ? snap.data() : null;
}
async function getClass(code) {
  if (!code) return null;
  const snap = await classesCol().doc(code).get();
  return snap.exists ? withNewModuleDefaults(snap.data()) : null;
}
async function getClassStudents(code) {
  const cls = await getClass(code);
  if (!cls) return [];
  const users = await Promise.all(cls.students.map(u => getUser(u)));
  return users.filter(Boolean);
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

/* ---------------- Session ---------------- */
// Session (which username is logged in on THIS device) stays in
// localStorage on purpose — there's no reason to sync who's logged in
// on a given browser across devices.
function setSession(username) {
  localStorage.setItem(SESSION_KEY, username);
}
async function getSessionUser() {
  const uname = localStorage.getItem(SESSION_KEY);
  if (!uname) return null;
  return await getUser(uname);
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
async function requireLogin() {
  const u = await getSessionUser();
  if (!u) {
    window.location.href = "index.html";
  }
  return u;
}
function logout() {
  clearSession();
  window.location.href = "index.html";
}

/* ---------------- Teacher account + class creation ---------------- */
async function createTeacherAndClass(name, username, password, className) {
  const existing = await getUser(username);
  if (existing) return { ok: false, error: "That username is already taken." };

  let code;
  do { code = genCode(5); } while ((await getClass(code)));

  const user = {
    username, password, role: "teacher", name,
    classCode: code, balance: 0
  };

  const cls = {
    code, name: className || "Room " + code, teacher: username,
    students: [], jobs: [], companies: [],
    interestRate: 2, txns: [],
    payDay: "Fri",
    priceRange: { min: 1, max: 5 },
    automations: [],
    jobApplications: [],
    lastPayDayRun: null,
    insurancePlans: [], storeItems: [], properties: [],
    eventDefs: [], eventLog: [], lastEventWeekRun: null,
    vehicles: [], termDepositPlans: [],
    interestAuto: false, interestFrequency: "weekly", interestDay: "Fri", lastInterestRun: null,
    insuranceDay: "Fri", lastInsuranceWeekRun: null,
    gambling: { enabled: true, minBet: 1, maxBet: 20, payouts: { straightUp: 35, split: 17, street: 11, corner: 8, sixLine: 5, oddEven: 1 } },
    taxRates: { store: 0, insurance: 0, property: 0, transport: 0, wage: 0, interest: 0, gambling: 0 },
    bigEventDefs: [], bigEventLog: [], lastBigEventWeekRun: null,
    lifestyleConfig: {
      property: { enabled: true, weight: 4 },
      store: { enabled: true, weight: 2 },
      insurance: { enabled: true, weight: 2 },
      transport: { enabled: true, weight: 3 }
    }
  };

  await usersCol().doc(username).set(user);
  await classesCol().doc(code).set(cls);
  return { ok: true, code };
}

/* ---------------- Student joins a class ---------------- */
async function createStudentAccount(name, username, password, classCode) {
  const existing = await getUser(username);
  if (existing) return { ok: false, error: "That username is already taken." };
  const classRef = classesCol().doc(classCode);

  try {
    await fdb.runTransaction(async (t) => {
      const clsSnap = await t.get(classRef);
      if (!clsSnap.exists) throw new Error("NO_CLASS");
      const cls = clsSnap.data();
      if (cls.students.length >= MAX_STUDENTS_PER_CLASS) throw new Error("FULL");

      const user = {
        username, password, role: "student", name,
        classCode, balance: 20, jobId: null
      };
      t.set(usersCol().doc(username), user);

      cls.students.push(username);
      cls.txns.unshift({ id: uid("t"), type: "welcome", to: username, amount: 20, note: "Welcome grant", date: nowStr(), ts: Date.now() });
      if (cls.txns.length > MAX_STORED_TXNS) cls.txns.length = MAX_STORED_TXNS;
      t.update(classRef, { students: cls.students, txns: cls.txns });
    });
  } catch (e) {
    if (e.message === "NO_CLASS") return { ok: false, error: "That class code doesn't exist." };
    if (e.message === "FULL") return { ok: false, error: "This class already has 8 students — it's full." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true };
}

/* ---------------- Login ---------------- */
async function login(username, password) {
  const u = await getUser(username);
  if (!u || u.password !== password) return { ok: false, error: "Incorrect username or password." };
  setSession(username);
  return { ok: true, user: u };
}

/* ---------------- Money movement ---------------- */
async function adjustBalance(username, delta) {
  const ref = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error("NO_USER");
      const data = snap.data();
      if (data.role === "teacher" && delta < 0) return; // teachers have unlimited funds
      const bal = Math.round((data.balance + delta) * 100) / 100;
      t.update(ref, { balance: bal });
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function logTxn(classCode, txn) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.txns.unshift(Object.assign({ id: uid("t"), date: nowStr(), ts: Date.now() }, txn));
    if (cls.txns.length > MAX_STORED_TXNS) cls.txns.length = MAX_STORED_TXNS;
    t.update(classRef, { txns: cls.txns });
  });
}

async function transferMoney(fromUser, toUser, amount, note) {
  const fromRef = usersCol().doc(fromUser);
  const toRef = usersCol().doc(toUser);
  const from = await getUser(fromUser);
  const to = await getUser(toUser);
  if (!from || !to) return { ok: false, error: "User not found." };
  if (from.classCode !== to.classCode) return { ok: false, error: "You can only send money within your own class." };
  if (amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const fromIsTeacher = from.role === "teacher";

  try {
    await fdb.runTransaction(async (t) => {
      const fromSnap = await t.get(fromRef);
      const toSnap = await t.get(toRef);
      const fromData = fromSnap.data();
      const toData = toSnap.data();
      if (!fromIsTeacher && fromData.balance < amount) throw new Error("BROKE");
      if (!fromIsTeacher) t.update(fromRef, { balance: Math.round((fromData.balance - amount) * 100) / 100 });
      t.update(toRef, { balance: Math.round((toData.balance + amount) * 100) / 100 });
    });
  } catch (e) {
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(from.classCode, { type: "transfer", from: fromUser, to: toUser, amount, note: note || "" });
  return { ok: true };
}

async function teacherAdjust(teacherUser, studentUser, amount, note, kind) {
  const student = await getUser(studentUser);
  if (!student) return { ok: false, error: "Student not found." };
  await adjustBalance(studentUser, amount);
  await logTxn(student.classCode, {
    type: kind || (amount >= 0 ? "bonus" : "fine"),
    from: teacherUser, to: studentUser, amount: Math.abs(amount), note: note || ""
  });
  return { ok: true };
}

/* ---------------- Jobs ---------------- */
async function addJob(classCode, title, wage, description) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.jobs.push({ id: uid("j"), title, wage: Number(wage), description: description || "" });
    t.update(classRef, { jobs: cls.jobs });
  });
}
async function updateJob(classCode, jobId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const job = cls.jobs.find(j => j.id === jobId);
    if (!job) return;
    job.title = updates.title;
    job.wage = Number(updates.wage);
    job.description = updates.description || "";
    t.update(classRef, { jobs: cls.jobs });
  });
}
async function removeJob(classCode, jobId) {
  const classRef = classesCol().doc(classCode);
  let affectedStudents = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.jobs = cls.jobs.filter(j => j.id !== jobId);
    cls.jobApplications = (cls.jobApplications || []).filter(a => a.jobId !== jobId);
    t.update(classRef, { jobs: cls.jobs, jobApplications: cls.jobApplications });
    affectedStudents = cls.students;
  });
  // unassign anyone with this job (separate user docs)
  const students = await Promise.all(affectedStudents.map(getUser));
  await Promise.all(students.filter(s => s && s.jobId === jobId).map(s =>
    usersCol().doc(s.username).update({ jobId: null })
  ));
}
async function assignJob(studentUser, jobId) {
  await usersCol().doc(studentUser).update({ jobId: jobId || null });
}

/* ---------------- Job applications ---------------- */
async function applyForJob(classCode, studentUser, jobId) {
  const classRef = classesCol().doc(classCode);
  try {
    let result = { ok: true };
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      const job = cls.jobs.find(j => j.id === jobId);
      if (!job) throw new Error("NO_JOB");
      cls.jobApplications = cls.jobApplications || [];
      const existing = cls.jobApplications.find(a => a.studentUser === studentUser && a.jobId === jobId && a.status === "pending");
      if (existing) throw new Error("ALREADY");
      cls.jobApplications.unshift({ id: uid("app"), studentUser, jobId, status: "pending", date: nowStr() });
      t.update(classRef, { jobApplications: cls.jobApplications });
    });
    return result;
  } catch (e) {
    if (e.message === "NO_CLASS") return { ok: false, error: "Class not found." };
    if (e.message === "NO_JOB") return { ok: false, error: "That job no longer exists." };
    if (e.message === "ALREADY") return { ok: false, error: "You've already applied for this job." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
async function approveApplication(classCode, appId) {
  const classRef = classesCol().doc(classCode);
  let studentUser = null, jobId = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const app = (cls.jobApplications || []).find(a => a.id === appId);
    if (!app) return;
    app.status = "approved";
    studentUser = app.studentUser;
    jobId = app.jobId;
    t.update(classRef, { jobApplications: cls.jobApplications });
  });
  if (studentUser) await usersCol().doc(studentUser).update({ jobId });
}
async function declineApplication(classCode, appId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const app = (cls.jobApplications || []).find(a => a.id === appId);
    if (!app) return;
    app.status = "declined";
    t.update(classRef, { jobApplications: cls.jobApplications });
  });
}

/* ---------------- Remove a student ---------------- */
async function removeStudent(classCode, studentUser) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.companies.forEach(co => {
      if (co.holders[studentUser]) {
        co.availableShares += co.holders[studentUser];
        delete co.holders[studentUser];
      }
    });
    cls.students = cls.students.filter(s => s !== studentUser);
    cls.automations = (cls.automations || []).filter(a => a.studentUser !== studentUser);
    cls.jobApplications = (cls.jobApplications || []).filter(a => a.studentUser !== studentUser);
    (cls.properties || []).forEach(p => { if (p.owner === studentUser) { p.owner = null; p.mortgage = null; } });
    (cls.vehicles || []).forEach(v => { if (v.owner === studentUser) v.owner = null; });
    t.update(classRef, {
      companies: cls.companies, students: cls.students,
      automations: cls.automations, jobApplications: cls.jobApplications,
      properties: cls.properties || [], vehicles: cls.vehicles || []
    });
  });
  await usersCol().doc(studentUser).delete();
  return true;
}

async function setPayDay(classCode, day) {
  await classesCol().doc(classCode).update({ payDay: day });
}

async function autoPayDayIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.payDay) return 0;
  const todayName = nzDayName();
  const todayKey = nzDateKey();
  if (todayName !== cls.payDay) return 0;
  if (cls.lastPayDayRun === todayKey) return 0;
  return await runPayDayInternal(classCode, todayKey);
}

async function payDay(classCode) {
  return await runPayDayInternal(classCode, nzDateKey());
}

async function runPayDayInternal(classCode, dateKey) {
  const classRef = classesCol().doc(classCode);
  let toPay = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    if (cls.lastPayDayRun === dateKey) return; // guard against double-run race
    cls.students.forEach(sUser => {}); // students fetched outside; just mark class as run
    t.update(classRef, { lastPayDayRun: dateKey });
  });

  const cls = await getClass(classCode);
  if (!cls) return 0;
  const students = await getClassStudents(classCode);
  let paidCount = 0;
  const txns = [];
  for (const student of students) {
    if (student.jobId) {
      const job = cls.jobs.find(j => j.id === student.jobId);
      if (job) {
        const { net, taxAmount } = applyTaxToIncome(cls, "wage", job.wage);
        await adjustBalance(student.username, net);
        txns.push({ type: "wage", to: student.username, amount: net, note: "Pay day: " + job.title + (taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "") });
        paidCount++;
      }
    }
  }
  for (const t of txns) await logTxn(classCode, t);
  return paidCount;
}

async function applyInterest(classCode) {
  const cls = await getClass(classCode);
  if (!cls) return 0;
  const rate = (cls.interestRate || 0) / 100;
  const students = await getClassStudents(classCode);
  let count = 0;
  for (const student of students) {
    const interest = Math.round(student.balance * rate * 100) / 100;
    if (interest > 0) {
      const { net, taxAmount } = applyTaxToIncome(cls, "interest", interest);
      await adjustBalance(student.username, net);
      await logTxn(classCode, { type: "interest", to: student.username, amount: net, note: "Savings interest" + (taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "") });
      count++;
    }
  }
  return count;
}

/* ---------------- Stock market ---------------- */
async function openCompany(classCode, name, price, totalShares) {
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      if (cls.companies.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new Error("DUP");
      const defaultRange = cls.priceRange || { min: 1, max: 5 };
      cls.companies.push({
        id: uid("co"), name, price: Number(price),
        totalShares: Number(totalShares), availableShares: Number(totalShares),
        history: [Number(price)], holders: {},
        priceRange: { min: defaultRange.min, max: defaultRange.max }
      });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NO_CLASS") return { ok: false, error: "Class not found." };
    if (e.message === "DUP") return { ok: false, error: "A company with that name already exists in your class." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true };
}

async function setCompanyPriceRange(classCode, companyId, min, max) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    co.priceRange = { min: Math.max(0, Number(min)), max: Math.max(0, Number(max)) };
    t.update(classRef, { companies: cls.companies });
  });
}

async function updateCompanyPrice(classCode, companyId, newPrice) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    co.price = Math.max(0.01, Number(newPrice));
    co.history.push(co.price);
    if (co.history.length > 30) co.history.shift();
    t.update(classRef, { companies: cls.companies });
  });
}

async function setPriceRange(classCode, min, max) {
  await classesCol().doc(classCode).update({
    priceRange: { min: Math.max(0, Number(min)), max: Math.max(0, Number(max)) }
  });
}

// Runs the market simulation automatically once per NZ calendar day — the
// first page load of the day (from any student or teacher) that hits this
// triggers it, same pattern as autoPayDayIfDue / autoInterestIfDue.
async function autoMarketDayIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls) return [];
  const todayKey = nzDateKey();
  if (cls.lastMarketDayRun === todayKey) return [];
  if (!cls.companies || cls.companies.length === 0) {
    await classesCol().doc(classCode).update({ lastMarketDayRun: todayKey }).catch(() => {});
    return [];
  }
  const classRef = classesCol().doc(classCode);
  let claimed = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = snap.data();
    if (liveCls.lastMarketDayRun === todayKey) return;
    t.update(classRef, { lastMarketDayRun: todayKey });
    claimed = true;
  });
  if (!claimed) return [];
  return await simulateMarketDay(classCode);
}

async function simulateMarketDay(classCode) {
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const range = cls.priceRange || { min: 1, max: 5 };
    cls.companies.forEach(co => {
      const coRange = co.priceRange || range;
      const pct = coRange.min + Math.random() * (coRange.max - coRange.min);
      const direction = Math.random() < 0.5 ? -1 : 1;
      const newPrice = Math.max(0.01, Math.round(co.price * (1 + (direction * pct) / 100) * 100) / 100);
      co.price = newPrice;
      co.history.push(newPrice);
      if (co.history.length > 30) co.history.shift();
      results.push({ name: co.name, pct: direction * pct });
    });
    t.update(classRef, { companies: cls.companies });
  });
  return results;
}

async function closeCompany(classCode, companyId) {
  const classRef = classesCol().doc(classCode);
  let payouts = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    Object.keys(co.holders).forEach(uname => {
      const shares = co.holders[uname];
      const payout = Math.round(shares * co.price * 100) / 100;
      payouts.push({ uname, payout, coName: co.name });
    });
    cls.companies = cls.companies.filter(c => c.id !== companyId);
    t.update(classRef, { companies: cls.companies });
  });
  for (const p of payouts) {
    await adjustBalance(p.uname, p.payout);
    await logTxn(classCode, { type: "stock-close", to: p.uname, amount: p.payout, note: p.coName + " delisted — shares cashed out" });
  }
}

async function buyShares(username, classCode, companyId, shares) {
  shares = Math.floor(Number(shares));
  if (shares <= 0) return { ok: false, error: "Enter a whole number of shares." };
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let cost = 0, coName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = classSnap.data();
      const co = cls.companies.find(c => c.id === companyId);
      if (!co) throw new Error("NOT_FOUND");
      if (shares > co.availableShares) throw new Error("NO_SHARES");
      cost = Math.round(shares * co.price * 100) / 100;
      if (user.balance < cost) throw new Error("BROKE");

      co.availableShares -= shares;
      co.holders[username] = (co.holders[username] || 0) + shares;
      coName = co.name;

      t.update(userRef, { balance: Math.round((user.balance - cost) * 100) / 100 });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "Not found." };
    if (e.message === "NO_SHARES") return { ok: false, error: "Not enough shares available." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "stock-buy", from: username, amount: cost, note: `Bought ${shares} shares of ${coName}` });
  return { ok: true };
}

async function sellShares(username, classCode, companyId, shares) {
  shares = Math.floor(Number(shares));
  if (shares <= 0) return { ok: false, error: "Enter a whole number of shares." };
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let proceeds = 0, coName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = classSnap.data();
      const co = cls.companies.find(c => c.id === companyId);
      if (!co) throw new Error("NOT_FOUND");
      const owned = co.holders[username] || 0;
      if (shares > owned) throw new Error("TOO_MANY");

      proceeds = Math.round(shares * co.price * 100) / 100;
      co.availableShares += shares;
      co.holders[username] = owned - shares;
      if (co.holders[username] === 0) delete co.holders[username];
      coName = co.name;

      t.update(userRef, { balance: Math.round((user.balance + proceeds) * 100) / 100 });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "Not found." };
    if (e.message === "TOO_MANY") return { ok: false, error: "You don't own that many shares." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "stock-sell", to: username, amount: proceeds, note: `Sold ${shares} shares of ${coName}` });
  return { ok: true };
}

/* ---------------- Automatic payments ---------------- */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQ_DAYS = { weekly: 7, fortnightly: 14, monthly: 28 };

async function addAutomation(classCode, studentUser, dayOfWeek, frequency, amount, toUser, note) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      cls.automations.push({
        id: uid("auto"), studentUser, dayOfWeek, frequency,
        amount: Number(amount), toUser, note: (note || "").trim(), lastRun: null, active: true
      });
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    return { ok: false, error: "Class not found." };
  }
  return { ok: true };
}
async function removeAutomation(classCode, id) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.automations = (cls.automations || []).filter(a => a.id !== id);
    t.update(classRef, { automations: cls.automations });
  });
}
async function getStudentAutomations(classCode, studentUser) {
  const cls = await getClass(classCode);
  if (!cls) return [];
  return (cls.automations || []).filter(a => a.studentUser === studentUser);
}

// Runs on dashboard load: fires any automation whose day-of-week matches
// today and whose frequency interval has elapsed since it last ran.
async function processAutomations(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.automations || cls.automations.length === 0) return 0;

  const todayName = nzDayName();
  const todayKey = nzDateKey();
  let ran = 0;

  for (const a of cls.automations) {
    if (!a.active) continue;
    if (a.dayOfWeek !== todayName) continue;
    if (a.lastRun === todayKey) continue;
    if (a.lastRun) {
      const daysSince = daysBetweenKeys(a.lastRun, todayKey);
      const need = FREQ_DAYS[a.frequency] || 7;
      if (daysSince < need) continue;
    }

    const classRef = classesCol().doc(classCode);
    let didRun = false;
    try {
      await fdb.runTransaction(async (t) => {
        const fromRef = usersCol().doc(a.studentUser);
        const toRef = usersCol().doc(a.toUser);
        const classSnap = await t.get(classRef);
        const fromSnap = await t.get(fromRef);
        const toSnap = await t.get(toRef);
        if (!classSnap.exists || !fromSnap.exists || !toSnap.exists) return;
        const from = fromSnap.data(), to = toSnap.data();
        if (from.balance < a.amount) return; // skip silently if they can't afford it

        const liveCls = classSnap.data();
        const liveAuto = (liveCls.automations || []).find(x => x.id === a.id);
        if (!liveAuto || liveAuto.lastRun === todayKey) return; // already ran (race guard)

        t.update(fromRef, { balance: Math.round((from.balance - a.amount) * 100) / 100 });
        t.update(toRef, { balance: Math.round((to.balance + a.amount) * 100) / 100 });
        liveAuto.lastRun = todayKey;
        t.update(classRef, { automations: liveCls.automations });
        didRun = true;
      });
    } catch (e) { /* ignore, try next */ }

    if (didRun) {
      await logTxn(classCode, { type: "automation", from: a.studentUser, to: a.toUser, amount: a.amount, note: a.note ? a.note : "Automatic payment" });
      ran++;
    }
  }
  return ran;
}

/* ===================== Transport ===================== */
async function addVehicle(classCode, v) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.vehicles.push({
      id: uid("veh"), name: v.name, price: Number(v.price),
      comfort: Math.max(1, Math.min(5, Number(v.comfort) || 1)),
      description: v.description || "", owner: null
    });
    t.update(classRef, { vehicles: cls.vehicles });
  });
}
async function removeVehicle(classCode, vehId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.vehicles = cls.vehicles.filter(v => v.id !== vehId);
    t.update(classRef, { vehicles: cls.vehicles });
  });
}
async function buyVehicle(username, classCode, vehId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let vehName = "", cashPaid = 0, taxAmount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const veh = cls.vehicles.find(v => v.id === vehId);
      if (!veh) throw new Error("NOT_FOUND");
      if (veh.owner) throw new Error("TAKEN");
      const { total: taxedPrice, taxAmount: tax } = applyTaxToExpense(cls, "transport", veh.price);
      taxAmount = tax;
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < taxedPrice) throw new Error("BROKE");
      veh.owner = username;
      vehName = veh.name;
      cashPaid = taxedPrice;
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - taxedPrice) * 100) / 100 });
      t.update(classRef, { vehicles: cls.vehicles });
    });
  } catch (e) {
    if (e.message === "TAKEN") return { ok: false, error: "Someone already bought that vehicle." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "vehicle-buy", from: username, amount: cashPaid, note: `Bought: ${vehName}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true };
}
async function sellVehicle(classCode, vehId) {
  const classRef = classesCol().doc(classCode);
  let owner = null, payout = 0, vehName = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const veh = cls.vehicles.find(v => v.id === vehId);
    if (!veh || !veh.owner) return;
    owner = veh.owner;
    vehName = veh.name;
    payout = Math.round(veh.price * 0.9 * 100) / 100;
    veh.owner = null;
    t.update(classRef, { vehicles: cls.vehicles });
  });
  if (owner) {
    await adjustBalance(owner, payout);
    await logTxn(classCode, { type: "vehicle-sell", to: owner, amount: payout, note: `Sold back: ${vehName}` });
  }
  return true;
}

/* ===================== Term deposits ===================== */
function dateKeyPlusDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
}
async function addTermDepositPlan(classCode, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.termDepositPlans.push({
      id: uid("td"), name: plan.name, minAmount: Number(plan.minAmount) || 0,
      days: Math.max(1, Number(plan.days) || 1), rate: Number(plan.rate) || 0,
      earlyFeePct: Math.max(0, Number(plan.earlyFeePct) || 0), active: true
    });
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
}
async function removeTermDepositPlan(classCode, planId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.termDepositPlans = cls.termDepositPlans.filter(p => p.id !== planId);
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
}
async function openTermDeposit(username, classCode, planId, amount) {
  amount = Number(amount);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let planSnapshot = null;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const plan = cls.termDepositPlans.find(p => p.id === planId && p.active);
      if (!plan) throw new Error("NOT_FOUND");
      if (amount < plan.minAmount) throw new Error("MIN");
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < amount) throw new Error("BROKE");
      const todayKey = nzDateKey();
      const matureKey = dateKeyPlusDays(todayKey, plan.days);
      planSnapshot = { id: plan.id, name: plan.name, days: plan.days, rate: plan.rate, earlyFeePct: plan.earlyFeePct };
      user.termDeposits = user.termDeposits || [];
      user.termDeposits.push({
        id: uid("tdo"), planId: plan.id, plan: planSnapshot, amount,
        startDate: todayKey, matureDate: matureKey
      });
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - amount) * 100) / 100, termDeposits: user.termDeposits });
      else t.update(userRef, { termDeposits: user.termDeposits });
    });
  } catch (e) {
    if (e.message === "MIN") return { ok: false, error: "That's below the minimum amount for this plan." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "term-deposit-open", from: username, amount, note: `Opened term deposit: ${planSnapshot.name}` });
  return { ok: true };
}
async function withdrawTermDepositEarly(username, depositId) {
  const userRef = usersCol().doc(username);
  let payout = 0, name = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      user.termDeposits = user.termDeposits || [];
      const dep = user.termDeposits.find(d => d.id === depositId);
      if (!dep) throw new Error("NOT_FOUND");
      name = dep.plan.name;
      const fee = Math.round(dep.amount * (dep.plan.earlyFeePct / 100) * 100) / 100;
      payout = Math.round((dep.amount - fee) * 100) / 100;
      user.termDeposits = user.termDeposits.filter(d => d.id !== depositId);
      t.update(userRef, { balance: Math.round((user.balance + payout) * 100) / 100, termDeposits: user.termDeposits });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const classUser = await getUser(username);
  if (classUser) await logTxn(classUser.classCode, { type: "term-deposit-early", to: username, amount: payout, note: `Withdrew early from: ${name}` });
  return { ok: true };
}
async function processTermDeposits(classCode) {
  const students = await getClassStudents(classCode);
  const todayKey = nzDateKey();
  let matured = 0;
  for (const student of students) {
    const deposits = student.termDeposits || [];
    const due = deposits.filter(d => d.matureDate <= todayKey);
    if (due.length === 0) continue;
    const userRef = usersCol().doc(student.username);
    let notes = [];
    try {
      await fdb.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) return;
        const user = snap.data();
        const liveDeposits = user.termDeposits || [];
        const liveDue = liveDeposits.filter(d => d.matureDate <= todayKey);
        if (liveDue.length === 0) return;
        let bal = user.balance;
        liveDue.forEach(d => {
          const interest = Math.round(d.amount * (d.plan.rate / 100) * 100) / 100;
          const payout = d.amount + interest;
          bal += payout;
          notes.push({ note: `${d.plan.name} matured: ${fmtMoney(d.amount)} + ${fmtMoney(interest)} interest`, amount: payout });
        });
        const remaining = liveDeposits.filter(d => d.matureDate > todayKey);
        t.update(userRef, { balance: Math.round(bal * 100) / 100, termDeposits: remaining });
      });
    } catch (e) { continue; }
    for (const n of notes) {
      await logTxn(classCode, { type: "term-deposit-mature", to: student.username, amount: n.amount, note: n.note });
    }
    if (notes.length) matured += notes.length;
  }
  return matured;
}

/* ===================== Auto interest ===================== */
async function saveInterestSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    interestRate: Number(settings.rate) || 0,
    interestAuto: !!settings.auto,
    interestFrequency: settings.frequency || "weekly",
    interestDay: settings.day || "Fri"
  });
}
async function autoInterestIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.interestAuto) return 0;
  const todayKey = nzDateKey();
  if (cls.lastInterestRun === todayKey) return 0;
  if (cls.interestFrequency !== "daily") {
    if (nzDayName() !== (cls.interestDay || "Fri")) return 0;
    if (cls.lastInterestRun) {
      const need = FREQ_DAYS[cls.interestFrequency] || 7;
      if (daysBetweenKeys(cls.lastInterestRun, todayKey) < need) return 0;
    }
  }
  const classRef = classesCol().doc(classCode);
  let claimed = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = snap.data();
    if (liveCls.lastInterestRun === todayKey) return;
    t.update(classRef, { lastInterestRun: todayKey });
    claimed = true;
  });
  if (!claimed) return 0;
  return await applyInterest(classCode);
}

/* ---------------- Leaderboard ---------------- */
// Every transaction from the last `days` days (default 10.5 = 1.5 weeks).
// Txns logged before the ts field existed have no timestamp to check, so
// they're included rather than silently hidden.
function getRecentTxns(cls, days) {
  const cutoff = Date.now() - (days || 10.5) * 86400000;
  return (cls.txns || []).filter(t => t.ts === undefined || t.ts >= cutoff);
}

async function classLeaderboard(classCode) {
  const students = await getClassStudents(classCode);
  const rows = await Promise.all(students.map(async s => {
    const invested = await portfolioValue(s.username, classCode);
    const storeValue = await storeItemsValue(s.username, classCode);
    return {
      username: s.username, name: s.name,
      balance: s.balance, invested, storeValue,
      net: Math.round((s.balance + invested + storeValue) * 100) / 100
    };
  }));
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

async function resetClass(classCode) {
  const students = await getClassStudents(classCode);
  await Promise.all(students.map(s => usersCol().doc(s.username).update({
    balance: 0, jobId: null, insurance: [], storeItems: [], termDeposits: []
  })));
  const cls = await getClass(classCode);
  const properties = (cls.properties || []).map(p => ({ ...p, owner: null, mortgage: null }));
  const vehicles = (cls.vehicles || []).map(v => ({ ...v, owner: null }));
  await classesCol().doc(classCode).update({
    companies: [], txns: [], automations: [], jobApplications: [],
    properties, vehicles, eventLog: []
  });
  return true;
}

async function portfolioValue(username, classCode) {
  const cls = await getClass(classCode);
  if (!cls) return 0;
  let total = 0;
  cls.companies.forEach(co => {
    const shares = co.holders[username] || 0;
    total += shares * co.price;
  });
  return Math.round(total * 100) / 100;
}

// Value of everything a student has bought from the class store, counted
// toward net worth. Looks up each owned item's current listed price by id,
// so this works retroactively for purchases made before this feature
// existed — no need to backfill any data.
async function storeItemsValue(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return 0;
  let total = 0;
  (user.storeItems || []).forEach(itemId => {
    const item = cls.storeItems.find(i => i.id === itemId);
    if (item && item.countsNetWorth !== false) total += item.price;
  });
  return Math.round(total * 100) / 100;
}

/* ===================== Gambling (Roulette) ===================== */
async function saveGamblingSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    gambling: {
      enabled: settings.enabled !== false,
      minBet: Math.max(0, Number(settings.minBet) || 0),
      maxBet: Math.max(0, Number(settings.maxBet) || 0),
      payouts: {
        straightUp: Number(settings.straightUp) || 0,
        split: Number(settings.split) || 0,
        street: Number(settings.street) || 0,
        corner: Number(settings.corner) || 0,
        sixLine: Number(settings.sixLine) || 0,
        oddEven: Number(settings.oddEven) || 0
      }
    }
  });
}

function rouletteRowCol(n) { return { row: Math.ceil(n / 3), col: ((n - 1) % 3) + 1 }; }
function isValidSplit(a, b) {
  if (a < 1 || a > 36 || b < 1 || b > 36 || a === b) return false;
  const p1 = rouletteRowCol(a), p2 = rouletteRowCol(b);
  if (p1.row === p2.row && Math.abs(p1.col - p2.col) === 1) return true;
  if (p1.col === p2.col && Math.abs(p1.row - p2.row) === 1) return true;
  return false;
}
function isValidStreet(nums) {
  if (nums.length !== 3) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted[0] < 1 || sorted[0] % 3 !== 1) return false;
  return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[0] + 2;
}
function isValidCorner(nums) {
  if (nums.length !== 4) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted[0];
  if (n % 3 === 0) return false; // can't start a corner in the right column
  if (n > 33) return false;
  const expected = [n, n + 1, n + 3, n + 4];
  return JSON.stringify(sorted) === JSON.stringify(expected);
}
function isValidSixLine(nums) {
  if (nums.length !== 6) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted[0];
  if (n % 3 !== 1 || n > 31) return false;
  const expected = [n, n + 1, n + 2, n + 3, n + 4, n + 5];
  return JSON.stringify(sorted) === JSON.stringify(expected);
}
function rouletteIsOdd(n) { return n > 0 && n % 2 === 1; }

// selection: array of numbers (0-36) chosen by the student, meaning
// depends on betType. Returns { ok, error } or resolves via balance update.
async function placeRouletteBet(username, classCode, betType, betAmount, selection) {
  betAmount = Number(betAmount);
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return { ok: false, error: "Class not found." };
  const g = cls.gambling;
  if (!g.enabled) return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
  if (!(betAmount > 0)) return { ok: false, error: "Enter a bet amount greater than zero." };
  if (betAmount < g.minBet || betAmount > g.maxBet) return { ok: false, error: `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.` };

  let valid = false, count = 0;
  if (betType === "straightUp") { valid = selection.length === 1 && selection[0] >= 0 && selection[0] <= 36; count = 1; }
  else if (betType === "split") { valid = selection.length === 2 && isValidSplit(selection[0], selection[1]); count = 2; }
  else if (betType === "street") { valid = isValidStreet(selection); count = 3; }
  else if (betType === "corner") { valid = isValidCorner(selection); count = 4; }
  else if (betType === "sixLine") { valid = isValidSixLine(selection); count = 6; }
  else if (betType === "oddEven") { valid = selection[0] === "odd" || selection[0] === "even"; }
  else return { ok: false, error: "Unknown bet type." };
  if (!valid) return { ok: false, error: "That's not a valid bet for this type." };

  const user = await getUser(username);
  if (!user) return { ok: false, error: "User not found." };
  const isTeacher = user.role === "teacher";
  if (!isTeacher && user.balance < betAmount) return { ok: false, error: "You don't have enough money for that bet." };

  const spin = Math.floor(Math.random() * 37); // 0-36
  let win = false;
  if (betType === "straightUp") win = selection[0] === spin;
  else if (betType === "oddEven") win = spin !== 0 && ((selection[0] === "odd") === rouletteIsOdd(spin));
  else win = selection.includes(spin);

  const multiplier = g.payouts[betType] || 0;
  const { net: taxedWinnings, taxAmount } = win ? applyTaxToIncome(cls, "gambling", betAmount * multiplier) : { net: 0, taxAmount: 0 };
  // Bet amount is deducted; on a win, the taxed winnings are credited back (winnings only, stake already "spent").
  const netChange = win ? taxedWinnings : -betAmount;

  if (!isTeacher) await adjustBalance(username, netChange);

  await logTxn(classCode, {
    type: "gambling", from: username, amount: Math.abs(netChange),
    note: `Roulette (${betTypeLabel(betType)}): ${win ? "WON" : "lost"} — ball landed on ${spin}` + (win && taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "")
  });

  return { ok: true, spin, win, netChange };
}
function betTypeLabel(t) {
  return { straightUp: "Straight up", split: "Split", street: "Street", corner: "Corner", sixLine: "Six line", oddEven: "Odd/Even" }[t] || t;
}
async function setGamblingEnabled(classCode, enabled) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.gambling.enabled = !!enabled;
    t.update(classRef, { gambling: cls.gambling });
  });
}

/* ===================== Big events ===================== */
const BIG_EVENT_MODULES = ["income", "property", "transport"];
const MODULE_TO_COVERAGE = { income: "jobs", property: "property", transport: "transport" };

async function addBigEventDef(classCode, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.bigEventDefs.push({
      id: uid("big"), name: ev.name,
      module: BIG_EVENT_MODULES.includes(ev.module) ? ev.module : "income",
      cost: Math.max(0, Number(ev.cost) || 0), description: ev.description || "", active: true
    });
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
async function removeBigEventDef(classCode, defId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.bigEventDefs = cls.bigEventDefs.filter(e => e.id !== defId);
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
// Once per NZ calendar week, each student has a 1-in-4 chance of being hit
// with one random active big event, left "pending" until they respond.
async function processWeeklyBigEvents(classCode) {
  const classRef = classesCol().doc(classCode);
  const weekKey = isoWeekKey(new Date());
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls || cls.lastBigEventWeekRun === weekKey) return 0;
  const activeDefs = (cls.bigEventDefs || []).filter(e => e.active);
  if (activeDefs.length === 0) {
    await classRef.update({ lastBigEventWeekRun: weekKey }).catch(() => {});
    return 0;
  }

  let claimedRun = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    if (liveCls.lastBigEventWeekRun === weekKey) return;
    t.update(classRef, { lastBigEventWeekRun: weekKey });
    claimedRun = true;
  });
  if (!claimedRun) return 0;

  const students = await getClassStudents(classCode);
  const newEntries = [];
  for (const student of students) {
    if (Math.random() >= 0.25) continue; // 25% chance per student per week
    // Only consider events for modules where the student actually has
    // something at stake (a job, a property, or a vehicle) — no point
    // hitting someone with a "lost your job" event if they have no job.
    const eligibleDefs = activeDefs.filter(d => {
      if (d.module === "income") return !!student.jobId;
      if (d.module === "property") return cls.properties.some(p => p.owner === student.username);
      if (d.module === "transport") return cls.vehicles.some(v => v.owner === student.username);
      return true;
    });
    if (eligibleDefs.length === 0) continue;
    const def = eligibleDefs[Math.floor(Math.random() * eligibleDefs.length)];
    newEntries.push({
      id: uid("bigevlog"), studentUser: student.username, defId: def.id, week: weekKey, date: nowStr(),
      name: def.name, module: def.module, cost: def.cost, description: def.description || "", status: "pending"
    });
  }
  if (newEntries.length === 0) return 0;

  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    liveCls.bigEventLog = (liveCls.bigEventLog || []).concat(newEntries);
    if (liveCls.bigEventLog.length > 300) liveCls.bigEventLog = liveCls.bigEventLog.slice(-300);
    t.update(classRef, { bigEventLog: liveCls.bigEventLog });
  });
  return newEntries.length;
}

// choice: 'forfeit' | 'pay' | 'claim'
async function resolveBigEvent(username, classCode, logId, choice) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let outcomeNote = "", amount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.bigEventLog || []).find(e => e.id === logId && e.studentUser === username && e.status === "pending");
      if (!entry) throw new Error("NOT_FOUND");
      const isTeacher = user.role === "teacher";

      if (choice === "forfeit") {
        entry.status = "lost";
        outcomeNote = `Didn't pay for "${entry.name}" — lost the associated ${entry.module}`;
        if (entry.module === "income") {
          t.update(userRef, { jobId: null });
        } else if (entry.module === "property") {
          const prop = cls.properties.find(p => p.owner === username);
          if (prop) { prop.owner = null; prop.mortgage = null; }
          t.update(classRef, { properties: cls.properties, bigEventLog: cls.bigEventLog });
        } else if (entry.module === "transport") {
          const veh = cls.vehicles.find(v => v.owner === username);
          if (veh) veh.owner = null;
          t.update(classRef, { vehicles: cls.vehicles, bigEventLog: cls.bigEventLog });
        }
        if (entry.module === "income") t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else if (choice === "pay") {
        if (!isTeacher && user.balance < entry.cost) throw new Error("BROKE");
        entry.status = "paid";
        amount = entry.cost;
        outcomeNote = `Paid ${fmtMoney(entry.cost)} for "${entry.name}"`;
        if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - entry.cost) * 100) / 100 });
        t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else if (choice === "claim") {
        const coverage = MODULE_TO_COVERAGE[entry.module];
        const plan = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).find(p => p && p.coverage === coverage);
        if (!plan) throw new Error("NO_PLAN");
        const excess = Math.max(0, plan.excess);
        if (!isTeacher && user.balance < excess) throw new Error("BROKE_EXCESS");
        entry.status = "claimed";
        amount = excess;
        outcomeNote = `Claimed insurance (${plan.name}) for "${entry.name}" — paid ${fmtMoney(excess)} excess`;
        if (!isTeacher && excess > 0) t.update(userRef, { balance: Math.round((user.balance - excess) * 100) / 100 });
        t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else {
        throw new Error("BAD_CHOICE");
      }
    });
  } catch (e) {
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money to pay that." };
    if (e.message === "BROKE_EXCESS") return { ok: false, error: "You don't have enough money to pay the excess." };
    if (e.message === "NO_PLAN") return { ok: false, error: "You don't have a matching insurance plan for this." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That event is no longer pending." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "big-event", from: username, amount, note: outcomeNote });
  return { ok: true };
}

/* ===================== Tax ===================== */
async function classesColUpdateInsuranceDay(classCode, day) {
  await classesCol().doc(classCode).update({ insuranceDay: day });
}

async function saveTaxRates(classCode, rates) {
  const clean = {};
  Object.keys(rates).forEach(k => { clean[k] = Math.max(0, Number(rates[k]) || 0); });
  await classesCol().doc(classCode).update({ taxRates: clean });
}
// For purchases: student pays base cost + tax on top.
function applyTaxToExpense(cls, category, baseAmount) {
  const rate = (cls.taxRates && cls.taxRates[category]) || 0;
  const taxAmount = Math.round(baseAmount * (rate / 100) * 100) / 100;
  return { total: Math.round((baseAmount + taxAmount) * 100) / 100, taxAmount, rate };
}
// For income: student receives base amount minus tax.
function applyTaxToIncome(cls, category, baseAmount) {
  const rate = (cls.taxRates && cls.taxRates[category]) || 0;
  const taxAmount = Math.round(baseAmount * (rate / 100) * 100) / 100;
  return { net: Math.round((baseAmount - taxAmount) * 100) / 100, taxAmount, rate };
}

/* ===================== Class defaults for new modules ===================== */
function withNewModuleDefaults(cls) {
  if (!cls) return cls;
  cls.insurancePlans = cls.insurancePlans || [];
  cls.storeItems = cls.storeItems || [];
  cls.properties = cls.properties || [];
  cls.eventDefs = cls.eventDefs || [];
  cls.eventLog = cls.eventLog || [];
  cls.lastEventWeekRun = cls.lastEventWeekRun || null;
  cls.termDepositPlans = cls.termDepositPlans || [];
  cls.vehicles = cls.vehicles || [];
  cls.interestAuto = cls.interestAuto || false;
  cls.interestFrequency = cls.interestFrequency || "weekly";
  cls.interestDay = cls.interestDay || "Fri";
  cls.lastInterestRun = cls.lastInterestRun || null;
  cls.insuranceDay = cls.insuranceDay || "Fri";
  cls.lastInsuranceWeekRun = cls.lastInsuranceWeekRun || null;
  cls.gambling = cls.gambling || {
    minBet: 1, maxBet: 20,
    payouts: { straightUp: 35, split: 17, street: 11, corner: 8, sixLine: 5, oddEven: 1 }
  };
  if (cls.gambling.enabled === undefined) cls.gambling.enabled = true;
  cls.taxRates = cls.taxRates || { store: 0, insurance: 0, property: 0, transport: 0, wage: 0, interest: 0, gambling: 0 };
  cls.bigEventDefs = cls.bigEventDefs || [];
  cls.bigEventLog = cls.bigEventLog || [];
  cls.lastBigEventWeekRun = cls.lastBigEventWeekRun || null;
  cls.lifestyleConfig = cls.lifestyleConfig || {
    property: { enabled: true, weight: 4 },
    store: { enabled: true, weight: 2 },
    insurance: { enabled: true, weight: 2 },
    transport: { enabled: true, weight: 3 }
  };
  if (!cls.lifestyleConfig.transport) cls.lifestyleConfig.transport = { enabled: true, weight: 3 };
  cls.lifestyleThresholds = cls.lifestyleThresholds && cls.lifestyleThresholds.length ? cls.lifestyleThresholds : [
    { min: 0, max: 10, label: "Poor" },
    { min: 10, max: 20, label: "Modest" },
    { min: 20, max: 40, label: "Comfortable" },
    { min: 40, max: 70, label: "Good" },
    { min: 70, max: 100, label: "Luxurious" }
  ];
  return cls;
}

function isoWeekKey(d) {
  const p = nzParts(d);
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return date.getUTCFullYear() + "-W" + week;
}

/* ===================== Insurance ===================== */
async function addInsurancePlan(classCode, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.insurancePlans.push({
      id: uid("ins"), name: plan.name, price: Number(plan.price),
      excess: Number(plan.excess), coverage: plan.coverage || "general",
      description: plan.description || "", stars: Math.max(0, Math.min(5, Number(plan.stars) || 0)),
      active: true
    });
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
async function removeInsurancePlan(classCode, planId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.insurancePlans = cls.insurancePlans.filter(p => p.id !== planId);
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
async function buyInsurance(username, classCode, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let planName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const plan = cls.insurancePlans.find(p => p.id === planId && p.active);
      if (!plan) throw new Error("NOT_FOUND");
      user.insurance = user.insurance || [];
      if (user.insurance.includes(planId)) throw new Error("ALREADY");
      planName = plan.name;
      user.insurance.push(planId);
      t.update(userRef, { insurance: user.insurance });
    });
  } catch (e) {
    if (e.message === "ALREADY") return { ok: false, error: "You already have this plan." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "insurance-buy", from: username, amount: 0, note: `Signed up for insurance: ${planName} — premiums are charged weekly` });
  return { ok: true };
}
async function cancelInsurance(username, planId) {
  const userRef = usersCol().doc(username);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    user.insurance = (user.insurance || []).filter(id => id !== planId);
    t.update(userRef, { insurance: user.insurance });
  });
}

/* ===================== Class store ===================== */
async function addStoreItem(classCode, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.storeItems.push({
      id: uid("item"), name: item.name, price: Number(item.price),
      description: item.description || "", effect: item.effect || "",
      stock: item.stock === "" || item.stock === undefined ? null : Number(item.stock),
      stars: Math.max(0, Math.min(5, Number(item.stars) || 0)),
      countsNetWorth: item.countsNetWorth !== false,
      archived: false
    });
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
async function updateStoreItem(classCode, itemId, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.storeItems.find(i => i.id === itemId);
    if (!existing) return;
    existing.name = item.name;
    existing.price = Number(item.price);
    existing.description = item.description || "";
    existing.effect = item.effect || "";
    existing.stock = item.stock === "" || item.stock === undefined ? null : Number(item.stock);
    existing.stars = Math.max(0, Math.min(5, Number(item.stars) || 0));
    existing.countsNetWorth = item.countsNetWorth !== false;
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
// Removing an item from the store no longer deletes its record outright —
// it's archived instead (hidden from the buyable list) so that students who
// already own one can still sell it back for a refund, and it still counts
// toward lifestyle rating / net worth as before.
async function removeStoreItem(classCode, itemId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const item = cls.storeItems.find(i => i.id === itemId);
    if (!item) return;
    item.archived = true;
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
async function buyStoreItem(username, classCode, itemId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "", taxAmount = 0, cashPaid = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item || item.archived) throw new Error("NOT_FOUND");
      if (item.stock !== null && item.stock <= 0) throw new Error("OUT");
      const { total, taxAmount: tax } = applyTaxToExpense(cls, "store", item.price);
      taxAmount = tax;
      cashPaid = total;
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < total) throw new Error("BROKE");
      itemName = item.name;
      if (item.stock !== null) item.stock -= 1;
      user.storeItems = user.storeItems || [];
      user.storeItems.push(itemId);
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - total) * 100) / 100, storeItems: user.storeItems });
      else t.update(userRef, { storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "OUT") return { ok: false, error: "That item is out of stock." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-buy", from: username, amount: cashPaid, note: `Bought from store: ${itemName}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true };
}

// Sell back one unit of an owned store item for 80% of its base price.
// Removes it from the student's owned items (which also reduces their
// lifestyle rating automatically, since that's computed live from
// user.storeItems) and restocks it if the item has limited stock.
async function sellStoreItem(username, classCode, itemId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "", payout = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item) throw new Error("NOT_FOUND");
      user.storeItems = user.storeItems || [];
      const idx = user.storeItems.indexOf(itemId);
      if (idx === -1) throw new Error("NOT_OWNED");
      user.storeItems.splice(idx, 1);
      itemName = item.name;
      payout = Math.round(item.price * 0.8 * 100) / 100;
      if (item.stock !== null) item.stock += 1;
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + payout) * 100) / 100, storeItems: user.storeItems });
      else t.update(userRef, { storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "NOT_OWNED") return { ok: false, error: "You don't own that item." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-sell", to: username, amount: payout, note: `Sold back to store: ${itemName} (80% refund)` });
  return { ok: true, payout };
}

/* ===================== Property ===================== */
async function addProperty(classCode, prop) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.properties.push({
      id: uid("prop"), name: prop.name, price: Number(prop.price),
      comfort: Math.max(1, Math.min(5, Number(prop.comfort) || 1)),
      mortgageWeeks: Number(prop.mortgageWeeks) || 0,
      description: prop.description || "", owner: null
    });
    t.update(classRef, { properties: cls.properties });
  });
}
async function removeProperty(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.properties = cls.properties.filter(p => p.id !== propId);
    t.update(classRef, { properties: cls.properties });
  });
}
async function buyProperty(username, classCode, propId, financed) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let deposit = 0, weekly = 0, propName = "", cashPaid = 0, taxAmount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop) throw new Error("NOT_FOUND");
      if (prop.owner) throw new Error("TAKEN");
      propName = prop.name;
      const { total: taxedPrice, taxAmount: tax } = applyTaxToExpense(cls, "property", prop.price);
      taxAmount = tax;
      const isTeacher = user.role === "teacher";
      if (financed && prop.mortgageWeeks > 0) {
        deposit = Math.round(taxedPrice * 0.1 * 100) / 100;
        weekly = Math.round(((taxedPrice - deposit) / prop.mortgageWeeks) * 100) / 100;
        if (!isTeacher && user.balance < deposit) throw new Error("BROKE");
        prop.owner = username;
        prop.mortgage = { weeksLeft: prop.mortgageWeeks, weeklyPayment: weekly };
        if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - deposit) * 100) / 100 });
      } else {
        if (!isTeacher && user.balance < taxedPrice) throw new Error("BROKE");
        prop.owner = username;
        prop.mortgage = null;
        cashPaid = taxedPrice;
        if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - taxedPrice) * 100) / 100 });
      }
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "TAKEN") return { ok: false, error: "Someone already bought that property." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-buy", from: username, amount: financed ? deposit : cashPaid, note: (financed ? `Bought (mortgaged): ${propName} — ${fmtMoney(deposit)} deposit` : `Bought outright: ${propName}`) + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true };
}
async function sellProperty(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let owner = null, payout = 0, propName = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const prop = cls.properties.find(p => p.id === propId);
    if (!prop || !prop.owner) return;
    owner = prop.owner;
    propName = prop.name;
    payout = Math.round(prop.price * 0.9 * 100) / 100;
    prop.owner = null;
    prop.mortgage = null;
    t.update(classRef, { properties: cls.properties });
  });
  if (owner) {
    await adjustBalance(owner, payout);
    await logTxn(classCode, { type: "property-sell", to: owner, amount: payout, note: `Sold back: ${propName}` });
  }
  return true;
}
async function processMortgages(classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return 0;
  const weekKey = isoWeekKey(new Date());
  let ran = 0;
  for (const prop of cls.properties) {
    if (!prop.owner || !prop.mortgage || prop.mortgage.weeksLeft <= 0) continue;
    if (prop.mortgage.lastWeekPaid === weekKey) continue;
    const classRef = classesCol().doc(classCode);
    const userRef = usersCol().doc(prop.owner);
    let didRun = false, amt = 0, remainingAfter = 0;
    try {
      await fdb.runTransaction(async (t) => {
        const classSnap = await t.get(classRef);
        const userSnap = await t.get(userRef);
        if (!classSnap.exists || !userSnap.exists) return;
        const liveCls = withNewModuleDefaults(classSnap.data());
        const liveProp = liveCls.properties.find(p => p.id === prop.id);
        if (!liveProp || !liveProp.mortgage || liveProp.mortgage.lastWeekPaid === weekKey || liveProp.mortgage.weeksLeft <= 0) return;
        const user = userSnap.data();
        if (user.balance < liveProp.mortgage.weeklyPayment) return;
        amt = liveProp.mortgage.weeklyPayment;
        t.update(userRef, { balance: Math.round((user.balance - amt) * 100) / 100 });
        liveProp.mortgage.weeksLeft -= 1;
        liveProp.mortgage.lastWeekPaid = weekKey;
        remainingAfter = liveProp.mortgage.weeksLeft;
        if (remainingAfter <= 0) liveProp.mortgage = null;
        t.update(classRef, { properties: liveCls.properties });
        didRun = true;
      });
    } catch (e) { /* ignore, try next */ }
    if (didRun) {
      await logTxn(classCode, { type: "mortgage", from: prop.owner, amount: amt, note: `Mortgage payment: ${prop.name}` + (remainingAfter <= 0 ? " — paid off!" : "") });
      ran++;
    }
  }
  return ran;
}

/* ===================== Random events ===================== */
async function addEventDef(classCode, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const isChoice = ev.type === "choice";
    cls.eventDefs.push({
      id: uid("ev"), name: ev.name, amount: Number(ev.amount) || 0,
      description: ev.description || "", repeatable: !!ev.repeatable,
      severity: ev.severity === "bad" ? "bad" : "neutral", active: true,
      type: isChoice ? "choice" : "fixed",
      options: isChoice ? (ev.options || []).map(o => ({ id: uid("opt"), label: o.label || "", amount: Number(o.amount) || 0, outcome: o.outcome || "" })) : []
    });
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
async function removeEventDef(classCode, evId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.eventDefs = cls.eventDefs.filter(e => e.id !== evId);
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
async function processWeeklyEvents(classCode) {
  const classRef = classesCol().doc(classCode);
  const weekKey = isoWeekKey(new Date());
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls || cls.lastEventWeekRun === weekKey) return 0;
  if (!cls.eventDefs || cls.eventDefs.filter(e => e.active).length === 0) {
    await classRef.update({ lastEventWeekRun: weekKey }).catch(() => {});
    return 0;
  }

  let claimed = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    if (liveCls.lastEventWeekRun === weekKey) return;
    t.update(classRef, { lastEventWeekRun: weekKey });
    claimed = true;
  });
  if (!claimed) return 0;

  const students = await getClassStudents(classCode);
  const activeDefs = cls.eventDefs.filter(e => e.active);
  const eventLog = cls.eventLog || [];
  const newLogEntries = [];
  const balanceDeltas = {};
  const txns = [];

  // Spread each student's 2-4 events out across the rest of the week
  // (NZ time) rather than dumping them all on the student at once — each
  // event gets its own random reveal moment, and the popup UI only shows
  // an event once its revealAt time has passed.
  const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayIdx = DAY_ORDER.indexOf(nzDayName(new Date()));
  const daysLeft = Math.max(6 - (todayIdx < 0 ? 0 : todayIdx), 1); // at least 1 day of spread, even on Sunday
  const spreadMs = daysLeft * 86400000;

  for (const student of students) {
    const already = new Set(eventLog.filter(l => l.studentUser === student.username).map(l => l.eventId));
    const pool = activeDefs.filter(e => e.repeatable || !already.has(e.id));
    if (pool.length === 0) continue;
    const count = Math.min(pool.length, 2 + Math.floor(Math.random() * 3));
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    for (const ev of shuffled) {
      const revealAt = Date.now() + Math.floor(Math.random() * spreadMs);
      if (ev.type === "choice") {
        // Multiple-choice events don't apply a balance change yet — the
        // student must pick one of the options first (see resolveChoiceEvent).
        newLogEntries.push({
          id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), week: weekKey, revealAt,
          name: ev.name, amount: null, description: ev.description || "", severity: ev.severity || "neutral",
          claimed: false, type: "choice", options: ev.options || [], status: "pending"
        });
      } else {
        balanceDeltas[student.username] = (balanceDeltas[student.username] || 0) + ev.amount;
        newLogEntries.push({
          id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), week: weekKey, revealAt,
          name: ev.name, amount: ev.amount, description: ev.description || "", severity: ev.severity || "neutral",
          claimed: false, type: "fixed", status: "resolved"
        });
        txns.push({ type: "event", to: student.username, amount: ev.amount, note: ev.name + (ev.description ? " — " + ev.description : "") });
      }
    }
  }

  for (const [username, delta] of Object.entries(balanceDeltas)) {
    await adjustBalance(username, delta);
  }
  for (const t of txns) await logTxn(classCode, t);

  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    liveCls.eventLog = (liveCls.eventLog || []).concat(newLogEntries);
    if (liveCls.eventLog.length > 500) liveCls.eventLog = liveCls.eventLog.slice(-500);
    t.update(classRef, { eventLog: liveCls.eventLog });
  });

  return newLogEntries.length;
}

// Claim General-coverage insurance against a bad weekly event. Pays out the
// loss minus the plan's excess (never below zero), and marks the event as
// claimed so it can't be claimed twice.
async function claimInsuranceForEvent(username, classCode, eventLogId, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let payout = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const plan = cls.insurancePlans.find(p => p.id === planId && p.coverage === "general");
      if (!plan || !(user.insurance || []).includes(planId)) throw new Error("NO_PLAN");
      const entry = (cls.eventLog || []).find(e => e.id === eventLogId && e.studentUser === username);
      if (!entry || entry.severity !== "bad" || entry.claimed) throw new Error("NOT_CLAIMABLE");
      const loss = Math.abs(Math.min(0, entry.amount));
      payout = Math.max(0, Math.round((loss - plan.excess) * 100) / 100);
      entry.claimed = true;
      t.update(userRef, { balance: Math.round((user.balance + payout) * 100) / 100 });
      t.update(classRef, { eventLog: cls.eventLog });
    });
  } catch (e) {
    if (e.message === "NO_PLAN") return { ok: false, error: "You don't have a General insurance plan for this." };
    if (e.message === "NOT_CLAIMABLE") return { ok: false, error: "That event can't be claimed." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "insurance-claim", to: username, amount: payout, note: "Insurance claim (General cover)" });
  return { ok: true, payout };
}

// Resolves a pending multiple-choice weekly event: applies the balance
// change for the option the student picked, and marks it resolved so it
// won't be asked again and behaves like a normal (already-happened) event.
async function resolveChoiceEvent(username, classCode, logId, optionId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let amount = 0, note = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.eventLog || []).find(e => e.id === logId && e.studentUser === username && e.status === "pending");
      if (!entry) throw new Error("NOT_FOUND");
      const option = (entry.options || []).find(o => o.id === optionId);
      if (!option) throw new Error("NOT_FOUND");
      amount = option.amount;
      entry.status = "resolved";
      entry.chosenOptionId = optionId;
      entry.amount = amount;
      entry.outcome = option.outcome || "";
      note = `${entry.name} — chose "${option.label}"` + (option.outcome ? `: ${option.outcome}` : "");
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + amount) * 100) / 100 });
      t.update(classRef, { eventLog: cls.eventLog });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "event", to: username, amount, note });
  return { ok: true, amount };
}

// Charges every student's active insurance premiums once per NZ calendar
// week, on the day the teacher set. Skips silently (keeps cover active) if
// a student can't afford it that week, same behaviour as automations.
async function processInsurancePayments(classCode) {
  const classRef = classesCol().doc(classCode);
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return 0;
  const weekKey = isoWeekKey(new Date());
  if (cls.lastInsuranceWeekRun === weekKey) return 0;
  if (nzDayName() !== (cls.insuranceDay || "Fri")) return 0;

  let claimed = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    if (liveCls.lastInsuranceWeekRun === weekKey) return;
    t.update(classRef, { lastInsuranceWeekRun: weekKey });
    claimed = true;
  });
  if (!claimed) return 0;

  const students = await getClassStudents(classCode);
  let charged = 0;
  for (const student of students) {
    const plans = (student.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).filter(Boolean);
    if (plans.length === 0) continue;
    const baseTotal = plans.reduce((s, p) => s + p.price, 0);
    const { total, taxAmount } = applyTaxToExpense(cls, "insurance", baseTotal);
    if (student.balance < total) continue; // skip silently, keep cover
    await adjustBalance(student.username, -total);
    await logTxn(classCode, {
      type: "insurance-premium", from: student.username, amount: total,
      note: `Weekly premiums: ${plans.map(p => p.name).join(", ")}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "")
    });
    charged++;
  }
  return charged;
}

// Everything a single student owns, for the teacher's "view student" panel.
async function getStudentPossessions(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return null;
  const property = cls.properties.find(p => p.owner === username) || null;
  const vehicle = cls.vehicles.find(v => v.owner === username) || null;
  const storeItems = (user.storeItems || []).map(id => cls.storeItems.find(i => i.id === id)).filter(Boolean)
    .map(i => ({ ...i }));
  const insurance = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).filter(Boolean);
  return { property, vehicle, storeItems, insurance };
}

/* ===================== Lifestyle rating ===================== */
async function saveLifestyleConfig(classCode, config) {
  await classesCol().doc(classCode).update({ lifestyleConfig: config });
}
// thresholds: array of { min, max, label }, sorted low to high, describing
// named bands for the 0-100 lifestyle score (e.g. Poor 0-10, Good 10-20).
async function saveLifestyleThresholds(classCode, thresholds) {
  const clean = thresholds
    .map(t => ({ min: Math.max(0, Number(t.min) || 0), max: Math.max(0, Number(t.max) || 0), label: (t.label || "").trim() || "Untitled" }))
    .sort((a, b) => a.min - b.min);
  await classesCol().doc(classCode).update({ lifestyleThresholds: clean });
}
function lifestyleLabelFor(score, thresholds) {
  if (!thresholds || thresholds.length === 0) return "";
  const band = thresholds.find(t => score >= t.min && score < t.max) ||
               (score >= (thresholds[thresholds.length - 1].max) ? thresholds[thresholds.length - 1] : null);
  return band ? band.label : "";
}
async function lifestyleRating(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return 0;
  const cfg = cls.lifestyleConfig;
  let score = 0;

  if (cfg.property && cfg.property.enabled) {
    const owned = cls.properties.find(p => p.owner === username);
    if (owned) score += owned.comfort * (cfg.property.weight || 0);
  }
  if (cfg.transport && cfg.transport.enabled) {
    const owned = cls.vehicles.find(v => v.owner === username);
    if (owned) score += owned.comfort * (cfg.transport.weight || 0);
  }
  if (cfg.store && cfg.store.enabled) {
    const owned = user.storeItems || [];
    owned.forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item) score += (item.stars || 0) * (cfg.store.weight || 0);
    });
  }
  if (cfg.insurance && cfg.insurance.enabled) {
    const owned = user.insurance || [];
    owned.forEach(planId => {
      const plan = cls.insurancePlans.find(p => p.id === planId);
      if (plan) score += (plan.stars || 0) * (cfg.insurance.weight || 0);
    });
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ===================== Global page bootstrap =====================
   This runs on EVERY page that loads data.js (i.e. every page in the app),
   regardless of what that page's own init() does. Two jobs:
   1. Make sure the market simulates itself once per NZ calendar day, even
      if nobody happens to visit the Market page that day.
   2. Mount a small floating "cash balance" widget in the corner of the
      screen for logged-in students, so they can see their balance no
      matter which module they're in.
================================================================== */
async function anwGlobalBootstrap() {
  const u = await getSessionUser();
  if (!u) return; // not logged in (e.g. on the login page) — nothing to do
  if (u.classCode) {
    autoMarketDayIfDue(u.classCode).catch(() => {});
  }
  if (u.role === "student") {
    mountBalanceWidget(u.username);
  }
}

async function mountBalanceWidget(username) {
  if (document.getElementById("anwBalanceWidget")) return;
  const box = document.createElement("div");
  box.id = "anwBalanceWidget";
  box.className = "anw-balance-widget";
  box.innerHTML = `<span class="icon">${icon("piggy", 18)}</span><span id="anwBalanceWidgetValue">—</span>`;
  document.body.appendChild(box);
  positionBalanceWidget();
  window.addEventListener("resize", positionBalanceWidget);

  const refresh = async () => {
    const el = document.getElementById("anwBalanceWidgetValue");
    if (!el) return;
    const fresh = await getUser(username);
    if (fresh) el.textContent = fmtMoney(fresh.balance);
  };
  await refresh();
  // Poll periodically so the widget stays live even though most module
  // pages have their own separate render() calls that don't know about it.
  setInterval(refresh, 8000);
}

// Sits just under the sticky top nav bar, on the left, rather than being
// hard-pinned to the literal viewport corner — avoids overlapping the
// brand logo, and re-runs on resize since the nav can wrap to two rows on
// narrow screens.
function positionBalanceWidget() {
  const topbar = document.querySelector(".topbar");
  const widget = document.getElementById("anwBalanceWidget");
  if (!topbar || !widget) return;
  if (window.innerWidth <= 640) { widget.style.top = ""; return; } // mobile: CSS pins it to the bottom instead
  widget.style.top = (topbar.getBoundingClientRect().bottom + 10) + "px";
}

document.addEventListener("DOMContentLoaded", anwGlobalBootstrap);
