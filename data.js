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
  return new Date().toLocaleString();
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
    lifestyleConfig: {
      property: { enabled: true, weight: 4 },
      store: { enabled: true, weight: 2 },
      insurance: { enabled: true, weight: 2 }
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
      cls.txns.unshift({ id: uid("t"), type: "welcome", to: username, amount: 20, note: "Welcome grant", date: nowStr() });
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
      const bal = Math.round((snap.data().balance + delta) * 100) / 100;
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
    cls.txns.unshift(Object.assign({ id: uid("t"), date: nowStr() }, txn));
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

  try {
    await fdb.runTransaction(async (t) => {
      const fromSnap = await t.get(fromRef);
      const toSnap = await t.get(toRef);
      const fromData = fromSnap.data();
      const toData = toSnap.data();
      if (fromData.balance < amount) throw new Error("BROKE");
      t.update(fromRef, { balance: Math.round((fromData.balance - amount) * 100) / 100 });
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
    t.update(classRef, {
      companies: cls.companies, students: cls.students,
      automations: cls.automations, jobApplications: cls.jobApplications
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
  const today = new Date();
  const todayName = DAY_NAMES[today.getDay()];
  const todayKey = today.toISOString().slice(0, 10);
  if (todayName !== cls.payDay) return 0;
  if (cls.lastPayDayRun === todayKey) return 0;
  return await runPayDayInternal(classCode, todayKey);
}

async function payDay(classCode) {
  return await runPayDayInternal(classCode, new Date().toISOString().slice(0, 10));
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
        await adjustBalance(student.username, job.wage);
        txns.push({ type: "wage", to: student.username, amount: job.wage, note: "Pay day: " + job.title });
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
      await adjustBalance(student.username, interest);
      await logTxn(classCode, { type: "interest", to: student.username, amount: interest, note: "Savings interest" });
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
      cls.companies.push({
        id: uid("co"), name, price: Number(price),
        totalShares: Number(totalShares), availableShares: Number(totalShares),
        history: [Number(price)], holders: {}
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

async function simulateMarketDay(classCode) {
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const range = cls.priceRange || { min: 1, max: 5 };
    cls.companies.forEach(co => {
      const pct = range.min + Math.random() * (range.max - range.min);
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

async function addAutomation(classCode, studentUser, dayOfWeek, frequency, amount, toUser) {
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
        amount: Number(amount), toUser, lastRun: null, active: true
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

  const today = new Date();
  const todayName = DAY_NAMES[today.getDay()];
  const todayKey = today.toISOString().slice(0, 10);
  let ran = 0;

  for (const a of cls.automations) {
    if (!a.active) continue;
    if (a.dayOfWeek !== todayName) continue;
    if (a.lastRun === todayKey) continue;
    if (a.lastRun) {
      const daysSince = Math.round((today - new Date(a.lastRun)) / 86400000);
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
      await logTxn(classCode, { type: "automation", from: a.studentUser, to: a.toUser, amount: a.amount, note: "Automatic payment" });
      ran++;
    }
  }
  return ran;
}

/* ---------------- Leaderboard ---------------- */
async function classLeaderboard(classCode) {
  const students = await getClassStudents(classCode);
  const rows = await Promise.all(students.map(async s => {
    const invested = await portfolioValue(s.username, classCode);
    return {
      username: s.username, name: s.name,
      balance: s.balance, invested,
      net: Math.round((s.balance + invested) * 100) / 100
    };
  }));
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

async function resetClass(classCode) {
  const students = await getClassStudents(classCode);
  await Promise.all(students.map(s => usersCol().doc(s.username).update({ balance: 0, jobId: null })));
  await classesCol().doc(classCode).update({
    companies: [], txns: [], automations: [], jobApplications: []
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

/* ===================== Class defaults for new modules ===================== */
function withNewModuleDefaults(cls) {
  if (!cls) return cls;
  cls.insurancePlans = cls.insurancePlans || [];
  cls.storeItems = cls.storeItems || [];
  cls.properties = cls.properties || [];
  cls.eventDefs = cls.eventDefs || [];
  cls.eventLog = cls.eventLog || [];
  cls.lastEventWeekRun = cls.lastEventWeekRun || null;
  cls.lifestyleConfig = cls.lifestyleConfig || {
    property: { enabled: true, weight: 4 },
    store: { enabled: true, weight: 2 },
    insurance: { enabled: true, weight: 2 }
  };
  return cls;
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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
      excess: Number(plan.excess), coverage: plan.coverage || "",
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
      if (user.balance < plan.price) throw new Error("BROKE");
      planName = plan.name;
      user.insurance.push(planId);
      t.update(userRef, { balance: Math.round((user.balance - plan.price) * 100) / 100, insurance: user.insurance });
    });
  } catch (e) {
    if (e.message === "ALREADY") return { ok: false, error: "You already have this plan." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "insurance-buy", from: username, amount: 0, note: `Bought insurance: ${planName}` });
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
      stars: Math.max(0, Math.min(5, Number(item.stars) || 0))
    });
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
async function removeStoreItem(classCode, itemId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.storeItems = cls.storeItems.filter(i => i.id !== itemId);
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
async function buyStoreItem(username, classCode, itemId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item) throw new Error("NOT_FOUND");
      if (item.stock !== null && item.stock <= 0) throw new Error("OUT");
      if (user.balance < item.price) throw new Error("BROKE");
      itemName = item.name;
      if (item.stock !== null) item.stock -= 1;
      user.storeItems = user.storeItems || [];
      user.storeItems.push(itemId);
      t.update(userRef, { balance: Math.round((user.balance - item.price) * 100) / 100, storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "OUT") return { ok: false, error: "That item is out of stock." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-buy", from: username, amount: 0, note: `Bought from store: ${itemName}` });
  return { ok: true };
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
  let deposit = 0, weekly = 0, propName = "", cashPaid = 0;
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
      if (financed && prop.mortgageWeeks > 0) {
        deposit = Math.round(prop.price * 0.1 * 100) / 100;
        weekly = Math.round(((prop.price - deposit) / prop.mortgageWeeks) * 100) / 100;
        if (user.balance < deposit) throw new Error("BROKE");
        prop.owner = username;
        prop.mortgage = { weeksLeft: prop.mortgageWeeks, weeklyPayment: weekly };
        t.update(userRef, { balance: Math.round((user.balance - deposit) * 100) / 100 });
      } else {
        if (user.balance < prop.price) throw new Error("BROKE");
        prop.owner = username;
        prop.mortgage = null;
        cashPaid = prop.price;
        t.update(userRef, { balance: Math.round((user.balance - prop.price) * 100) / 100 });
      }
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "TAKEN") return { ok: false, error: "Someone already bought that property." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-buy", from: username, amount: financed ? deposit : cashPaid, note: financed ? `Bought (mortgaged): ${propName} — ${fmtMoney(deposit)} deposit` : `Bought outright: ${propName}` });
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
    cls.eventDefs.push({
      id: uid("ev"), name: ev.name, amount: Number(ev.amount) || 0,
      description: ev.description || "", repeatable: !!ev.repeatable, active: true
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

  for (const student of students) {
    const already = new Set(eventLog.filter(l => l.studentUser === student.username).map(l => l.eventId));
    const pool = activeDefs.filter(e => e.repeatable || !already.has(e.id));
    if (pool.length === 0) continue;
    const count = Math.min(pool.length, 2 + Math.floor(Math.random() * 3));
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    for (const ev of shuffled) {
      balanceDeltas[student.username] = (balanceDeltas[student.username] || 0) + ev.amount;
      newLogEntries.push({ studentUser: student.username, eventId: ev.id, date: nowStr(), week: weekKey });
      txns.push({ type: "event", to: student.username, amount: ev.amount, note: ev.name + (ev.description ? " — " + ev.description : "") });
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

/* ===================== Lifestyle rating ===================== */
async function saveLifestyleConfig(classCode, config) {
  await classesCol().doc(classCode).update({ lifestyleConfig: config });
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
