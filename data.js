/* ===================== The 29 World — data layer =====================
   Everything is stored in the browser's localStorage under "anw_db".
   This file has no dependencies and must be loaded before any other
   The 29 World script on every page.
====================================================================== */

const DB_KEY = "anw_db";
const SESSION_KEY = "anw_session";
const MAX_STUDENTS_PER_CLASS = 8;

function emptyDB() {
  return { users: {}, classes: {} };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : emptyDB();
  } catch (e) {
    return emptyDB();
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

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

/* ---------------- Session ---------------- */
function setSession(username) {
  localStorage.setItem(SESSION_KEY, username);
}
function getSessionUser() {
  const uname = localStorage.getItem(SESSION_KEY);
  if (!uname) return null;
  const db = loadDB();
  return db.users[uname] || null;
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
function requireLogin() {
  const u = getSessionUser();
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
function createTeacherAndClass(name, username, password, className) {
  const db = loadDB();
  if (db.users[username]) return { ok: false, error: "That username is already taken." };

  let code;
  do { code = genCode(5); } while (db.classes[code]);

  db.users[username] = {
    username, password, role: "teacher", name,
    classCode: code, balance: 0
  };

  db.classes[code] = {
    code, name: className || "Room " + code, teacher: username,
    students: [], jobs: [], companies: [],
    interestRate: 2, txns: [],
    payDay: "Fri",
    priceRange: { min: 1, max: 5 },
    automations: [],
    jobApplications: []
  };

  saveDB(db);
  return { ok: true, code };
}

/* ---------------- Student joins a class ---------------- */
function createStudentAccount(name, username, password, classCode) {
  const db = loadDB();
  if (db.users[username]) return { ok: false, error: "That username is already taken." };
  const cls = db.classes[classCode];
  if (!cls) return { ok: false, error: "That class code doesn't exist." };
  if (cls.students.length >= MAX_STUDENTS_PER_CLASS) {
    return { ok: false, error: "This class already has 8 students — it's full." };
  }

  db.users[username] = {
    username, password, role: "student", name,
    classCode, balance: 20, jobId: null
  };
  cls.students.push(username);
  cls.txns.unshift({ id: uid("t"), type: "welcome", to: username, amount: 20, note: "Welcome grant", date: nowStr() });

  saveDB(db);
  return { ok: true };
}

/* ---------------- Login ---------------- */
function login(username, password) {
  const db = loadDB();
  const u = db.users[username];
  if (!u || u.password !== password) return { ok: false, error: "Incorrect username or password." };
  setSession(username);
  return { ok: true, user: u };
}

/* ---------------- Class helpers ---------------- */
function getClass(code) {
  const db = loadDB();
  return db.classes[code];
}
function getClassStudents(code) {
  const db = loadDB();
  const cls = db.classes[code];
  if (!cls) return [];
  return cls.students.map(u => db.users[u]).filter(Boolean);
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

/* ---------------- Money movement ---------------- */
function adjustBalance(username, delta) {
  const db = loadDB();
  const u = db.users[username];
  if (!u) return false;
  u.balance = Math.round((u.balance + delta) * 100) / 100;
  saveDB(db);
  return true;
}

function logTxn(classCode, txn) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.txns.unshift(Object.assign({ id: uid("t"), date: nowStr() }, txn));
  saveDB(db);
}

function transferMoney(fromUser, toUser, amount, note) {
  const db = loadDB();
  const from = db.users[fromUser];
  const to = db.users[toUser];
  if (!from || !to) return { ok: false, error: "User not found." };
  if (from.classCode !== to.classCode) return { ok: false, error: "You can only send money within your own class." };
  if (amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  if (from.balance < amount) return { ok: false, error: "You don't have enough money for that." };

  from.balance = Math.round((from.balance - amount) * 100) / 100;
  to.balance = Math.round((to.balance + amount) * 100) / 100;
  saveDB(db);
  logTxn(from.classCode, { type: "transfer", from: fromUser, to: toUser, amount, note: note || "" });
  return { ok: true };
}

function teacherAdjust(teacherUser, studentUser, amount, note, kind) {
  const db = loadDB();
  const student = db.users[studentUser];
  if (!student) return { ok: false, error: "Student not found." };
  student.balance = Math.round((student.balance + amount) * 100) / 100;
  saveDB(db);
  logTxn(student.classCode, {
    type: kind || (amount >= 0 ? "bonus" : "fine"),
    from: teacherUser, to: studentUser, amount: Math.abs(amount), note: note || ""
  });
  return { ok: true };
}

/* ---------------- Jobs ---------------- */
function addJob(classCode, title, wage, description) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.jobs.push({ id: uid("j"), title, wage: Number(wage), description: description || "" });
  saveDB(db);
}
function removeJob(classCode, jobId) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.jobs = cls.jobs.filter(j => j.id !== jobId);
  // unassign anyone with this job
  cls.students.forEach(s => { if (db.users[s].jobId === jobId) db.users[s].jobId = null; });
  cls.jobApplications = (cls.jobApplications || []).filter(a => a.jobId !== jobId);
  saveDB(db);
}
function assignJob(studentUser, jobId) {
  const db = loadDB();
  const u = db.users[studentUser];
  if (!u) return;
  u.jobId = jobId || null;
  saveDB(db);
}

/* ---------------- Job applications ---------------- */
function applyForJob(classCode, studentUser, jobId) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return { ok: false, error: "Class not found." };
  const job = cls.jobs.find(j => j.id === jobId);
  if (!job) return { ok: false, error: "That job no longer exists." };
  cls.jobApplications = cls.jobApplications || [];
  const existing = cls.jobApplications.find(a => a.studentUser === studentUser && a.jobId === jobId && a.status === "pending");
  if (existing) return { ok: false, error: "You've already applied for this job." };
  cls.jobApplications.unshift({
    id: uid("app"), studentUser, jobId, status: "pending", date: nowStr()
  });
  saveDB(db);
  return { ok: true };
}
function approveApplication(classCode, appId) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  const app = (cls.jobApplications || []).find(a => a.id === appId);
  if (!app) return;
  app.status = "approved";
  const student = db.users[app.studentUser];
  if (student) student.jobId = app.jobId;
  saveDB(db);
}
function declineApplication(classCode, appId) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  const app = (cls.jobApplications || []).find(a => a.id === appId);
  if (!app) return;
  app.status = "declined";
  saveDB(db);
}

/* ---------------- Remove a student ---------------- */
function removeStudent(classCode, studentUser) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return false;

  // cash out any shares they hold so class totals stay consistent
  cls.companies.forEach(co => {
    if (co.holders[studentUser]) {
      co.availableShares += co.holders[studentUser];
      delete co.holders[studentUser];
    }
  });

  cls.students = cls.students.filter(s => s !== studentUser);
  cls.automations = (cls.automations || []).filter(a => a.studentUser !== studentUser);
  cls.jobApplications = (cls.jobApplications || []).filter(a => a.studentUser !== studentUser);
  delete db.users[studentUser];
  saveDB(db);
  return true;
}
function setPayDay(classCode, day) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.payDay = day;
  saveDB(db);
}
function autoPayDayIfDue(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls || !cls.payDay) return 0;
  const today = new Date();
  const todayName = DAY_NAMES[today.getDay()];
  const todayKey = today.toISOString().slice(0, 10);
  if (todayName !== cls.payDay) return 0;
  if (cls.lastPayDayRun === todayKey) return 0;

  let paidCount = 0;
  cls.students.forEach(sUser => {
    const student = db.users[sUser];
    if (student.jobId) {
      const job = cls.jobs.find(j => j.id === student.jobId);
      if (job) {
        student.balance = Math.round((student.balance + job.wage) * 100) / 100;
        cls.txns.unshift({ id: uid("t"), type: "wage", to: sUser, amount: job.wage, note: "Pay day: " + job.title, date: nowStr() });
        paidCount++;
      }
    }
  });
  cls.lastPayDayRun = todayKey;
  saveDB(db);
  return paidCount;
}

function payDay(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return 0;
  let paidCount = 0;
  cls.students.forEach(sUser => {
    const student = db.users[sUser];
    if (student.jobId) {
      const job = cls.jobs.find(j => j.id === student.jobId);
      if (job) {
        student.balance = Math.round((student.balance + job.wage) * 100) / 100;
        cls.txns.unshift({ id: uid("t"), type: "wage", to: sUser, amount: job.wage, note: "Pay day: " + job.title, date: nowStr() });
        paidCount++;
      }
    }
  });
  cls.lastPayDayRun = new Date().toISOString().slice(0, 10);
  saveDB(db);
  return paidCount;
}

function applyInterest(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return 0;
  const rate = (cls.interestRate || 0) / 100;
  let count = 0;
  cls.students.forEach(sUser => {
    const student = db.users[sUser];
    const interest = Math.round(student.balance * rate * 100) / 100;
    if (interest > 0) {
      student.balance = Math.round((student.balance + interest) * 100) / 100;
      cls.txns.unshift({ id: uid("t"), type: "interest", to: sUser, amount: interest, note: "Savings interest", date: nowStr() });
      count++;
    }
  });
  saveDB(db);
  return count;
}

/* ---------------- Stock market ---------------- */
function openCompany(classCode, name, price, totalShares) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.companies.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "A company with that name already exists in your class." };
  }
  cls.companies.push({
    id: uid("co"),
    name,
    price: Number(price),
    totalShares: Number(totalShares),
    availableShares: Number(totalShares),
    history: [Number(price)],
    holders: {} // username -> shares
  });
  saveDB(db);
  return { ok: true };
}

function updateCompanyPrice(classCode, companyId, newPrice) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  const co = cls.companies.find(c => c.id === companyId);
  if (!co) return;
  co.price = Math.max(0.01, Number(newPrice));
  co.history.push(co.price);
  if (co.history.length > 30) co.history.shift();
  saveDB(db);
}

function setPriceRange(classCode, min, max) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.priceRange = { min: Math.max(0, Number(min)), max: Math.max(0, Number(max)) };
  saveDB(db);
}

function simulateMarketDay(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return [];
  const range = cls.priceRange || { min: 1, max: 5 };
  const results = [];
  cls.companies.forEach(co => {
    const pct = range.min + Math.random() * (range.max - range.min);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const newPrice = Math.max(0.01, Math.round(co.price * (1 + (direction * pct) / 100) * 100) / 100);
    co.price = newPrice;
    co.history.push(newPrice);
    if (co.history.length > 30) co.history.shift();
    results.push({ name: co.name, pct: direction * pct });
  });
  saveDB(db);
  return results;
}

function closeCompany(classCode, companyId) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  const co = cls.companies.find(c => c.id === companyId);
  if (!co) return;
  Object.keys(co.holders).forEach(uname => {
    const shares = co.holders[uname];
    const payout = Math.round(shares * co.price * 100) / 100;
    if (db.users[uname]) {
      db.users[uname].balance = Math.round((db.users[uname].balance + payout) * 100) / 100;
      cls.txns.unshift({ id: uid("t"), type: "stock-close", to: uname, amount: payout, note: co.name + " delisted — shares cashed out", date: nowStr() });
    }
  });
  cls.companies = cls.companies.filter(c => c.id !== companyId);
  saveDB(db);
}

function buyShares(username, classCode, companyId, shares) {
  const db = loadDB();
  const cls = db.classes[classCode];
  const user = db.users[username];
  const co = cls && cls.companies.find(c => c.id === companyId);
  if (!cls || !user || !co) return { ok: false, error: "Not found." };
  shares = Math.floor(Number(shares));
  if (shares <= 0) return { ok: false, error: "Enter a whole number of shares." };
  if (shares > co.availableShares) return { ok: false, error: "Not enough shares available." };
  const cost = Math.round(shares * co.price * 100) / 100;
  if (user.balance < cost) return { ok: false, error: "You don't have enough money for that." };

  user.balance = Math.round((user.balance - cost) * 100) / 100;
  co.availableShares -= shares;
  co.holders[username] = (co.holders[username] || 0) + shares;
  cls.txns.unshift({ id: uid("t"), type: "stock-buy", from: username, amount: cost, note: `Bought ${shares} shares of ${co.name}`, date: nowStr() });
  saveDB(db);
  return { ok: true };
}

function sellShares(username, classCode, companyId, shares) {
  const db = loadDB();
  const cls = db.classes[classCode];
  const user = db.users[username];
  const co = cls && cls.companies.find(c => c.id === companyId);
  if (!cls || !user || !co) return { ok: false, error: "Not found." };
  shares = Math.floor(Number(shares));
  const owned = co.holders[username] || 0;
  if (shares <= 0) return { ok: false, error: "Enter a whole number of shares." };
  if (shares > owned) return { ok: false, error: "You don't own that many shares." };

  const proceeds = Math.round(shares * co.price * 100) / 100;
  user.balance = Math.round((user.balance + proceeds) * 100) / 100;
  co.availableShares += shares;
  co.holders[username] = owned - shares;
  if (co.holders[username] === 0) delete co.holders[username];
  cls.txns.unshift({ id: uid("t"), type: "stock-sell", to: username, amount: proceeds, note: `Sold ${shares} shares of ${co.name}`, date: nowStr() });
  saveDB(db);
  return { ok: true };
}

/* ---------------- Automatic payments ---------------- */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQ_DAYS = { weekly: 7, fortnightly: 14, monthly: 28 };

function addAutomation(classCode, studentUser, dayOfWeek, frequency, amount, toUser) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return { ok: false, error: "Class not found." };
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  cls.automations = cls.automations || [];
  cls.automations.push({
    id: uid("auto"), studentUser, dayOfWeek, frequency,
    amount: Number(amount), toUser, lastRun: null, active: true
  });
  saveDB(db);
  return { ok: true };
}
function removeAutomation(classCode, id) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return;
  cls.automations = (cls.automations || []).filter(a => a.id !== id);
  saveDB(db);
}
function getStudentAutomations(classCode, studentUser) {
  const cls = getClass(classCode);
  if (!cls) return [];
  return (cls.automations || []).filter(a => a.studentUser === studentUser);
}

// Runs on dashboard load: fires any automation whose day-of-week matches
// today and whose frequency interval has elapsed since it last ran.
function processAutomations(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls || !cls.automations || cls.automations.length === 0) return 0;

  const today = new Date();
  const todayName = DAY_NAMES[today.getDay()];
  const todayKey = today.toISOString().slice(0, 10);
  let ran = 0;

  cls.automations.forEach(a => {
    if (!a.active) return;
    if (a.dayOfWeek !== todayName) return;
    if (a.lastRun === todayKey) return; // already ran today
    if (a.lastRun) {
      const daysSince = Math.round((today - new Date(a.lastRun)) / 86400000);
      const need = FREQ_DAYS[a.frequency] || 7;
      if (daysSince < need) return;
    }
    const from = db.users[a.studentUser];
    const to = db.users[a.toUser];
    if (!from || !to) return;
    if (from.balance < a.amount) return; // skip silently if they can't afford it
    from.balance = Math.round((from.balance - a.amount) * 100) / 100;
    to.balance = Math.round((to.balance + a.amount) * 100) / 100;
    a.lastRun = todayKey;
    cls.txns.unshift({
      id: uid("t"), type: "automation", from: a.studentUser, to: a.toUser,
      amount: a.amount, note: "Automatic payment", date: nowStr()
    });
    ran++;
  });

  if (ran > 0) saveDB(db);
  return ran;
}

/* ---------------- Leaderboard ---------------- */
function classLeaderboard(classCode) {
  const students = getClassStudents(classCode);
  const rows = students.map(s => {
    const invested = portfolioValue(s.username, classCode);
    return {
      username: s.username, name: s.name,
      balance: s.balance, invested,
      net: Math.round((s.balance + invested) * 100) / 100
    };
  });
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

function resetClass(classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return false;

  cls.students.forEach(uname => {
    const s = db.users[uname];
    if (!s) return;
    s.balance = 0;
    s.jobId = null;
  });

  cls.companies = [];
  cls.txns = [];
  cls.automations = [];
  cls.jobApplications = [];

  saveDB(db);
}

function portfolioValue(username, classCode) {
  const db = loadDB();
  const cls = db.classes[classCode];
  if (!cls) return 0;
  let total = 0;
  cls.companies.forEach(co => {
    const shares = co.holders[username] || 0;
    total += shares * co.price;
  });
  return Math.round(total * 100) / 100;
}
