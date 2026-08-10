

Skip to content
Using Gmail with screen readers

1 of 12
29 World
Inbox

Nathan Liu <nathan.liu1211@gmail.com>
Attachments
07:20 (3 minutes ago)
to me

 One attachment
  •  Scanned by Gmail
Anti-virus warning – 1 attachment contains a virus or blocked file. Downloading this attachment is disabled.

Mail Delivery Subsystem <mailer-daemon@googlemail.com>
07:20 (2 minutes ago)
to me

For security reasons, Gmail does not allow you to use this type of file as it violates Google policy for executables and archives.



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
// Current hour (0-23) and minute in NZ wall-clock time — used by the side
// hustle check-in window (must check in within 15 min of the chosen hour).
function nzHourMinute(d) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland", hourCycle: "h23", hour: "2-digit", minute: "2-digit"
  });
  const map = {};
  fmt.formatToParts(d || new Date()).forEach(p => { map[p.type] = p.value; });
  return { hour: Number(map.hour), minute: Number(map.minute) };
}
// "12am", "1am", ... "12pm", "1pm", ... "11pm" for hour 0-23.
function hourLabel(h) {
  const period = h < 12 ? "am" : "pm";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return hh + period;
}

/* ---------------- Basic doc fetch helpers ----------------
   Every page fires several independent background jobs together via
   Promise.all (autoPayDayIfDue, processAutomations, processMortgages,
   processTermDeposits, autoInterestIfDue, processInsurancePayments,
   processWeeklyEvents, processWeeklyBigEvents, ...) and most of them start
   by reading the SAME class doc — so on every page load, up to ~8-10
   near-simultaneous getClass() calls were each independently hitting
   Firestore for a document that hadn't changed since the call right next
   to it. The two _inFlight maps below fix that: if a second call for the
   same id comes in while a fetch is already in progress, it shares that
   same network request instead of starting a new one.

   This is safe for callers that mutate the returned object in place
   (several functions in this file do — e.g. `cls.jobs = ...` then write
   it back), because each caller below still gets its OWN independent deep
   copy of the resolved data, never a shared object reference. It also
   can't ever hand back stale data: once the in-flight fetch resolves, the
   entry is removed immediately, so the very next call starts a brand new
   fetch — this only merges requests that were already overlapping in
   time, it never caches across time the way getUserCached/getClassCached
   (below) intentionally do. */
const _inFlightUserFetch = new Map();
const _inFlightClassFetch = new Map();

function _cloneDoc(v) {
  // Every field this app stores is plain JSON-safe data (no Firestore
  // Timestamps/FieldValues are used anywhere in this file), so a JSON
  // round-trip is a safe, complete deep clone.
  return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function _sharedFetch(map, key, fetcher) {
  let p = map.get(key);
  if (!p) {
    p = fetcher();
    map.set(key, p);
    p.finally(() => {
      if (map.get(key) === p) map.delete(key);
    });
  }
  return p;
}

async function getUser(username) {
  if (!username) return null;
  const data = await _sharedFetch(_inFlightUserFetch, username, () =>
    usersCol().doc(username).get().then(snap => snap.exists ? snap.data() : null)
  );
  return _cloneDoc(data);
}
async function getClass(code) {
  if (!code) return null;
  const data = await _sharedFetch(_inFlightClassFetch, code, () =>
    classesCol().doc(code).get().then(snap => snap.exists ? withNewModuleDefaults(snap.data()) : null)
  );
  return _cloneDoc(data);
}
async function getClassStudents(code) {
  const cls = await getClass(code);
  if (!cls || !cls.students || cls.students.length === 0) return [];
  // Was one individual .get() per student (25 students = 25 separate
  // requests, all fired at once). Firestore supports fetching up to 30
  // docs by ID in a single query, so batch into chunks of 30 instead —
  // any normal-sized class now costs 1 request instead of one per student.
  // Falls back to the old one-by-one approach if this Firestore version/
  // build doesn't expose FieldPath (defensive only — it's been standard
  // for years, this just avoids a hard failure if it's ever missing).
  if (!(firebase && firebase.firestore && firebase.firestore.FieldPath)) {
    const users = await Promise.all(cls.students.map(u => getUser(u)));
    return users.filter(Boolean);
  }
  const usernames = cls.students;
  const chunks = [];
  for (let i = 0; i < usernames.length; i += 30) chunks.push(usernames.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map(chunk =>
    usersCol().where(firebase.firestore.FieldPath.documentId(), "in", chunk).get()
  ));
  const byUsername = {};
  snaps.forEach(snap => snap.forEach(doc => { byUsername[doc.id] = doc.data(); }));
  // Keep the same order and "drop missing users" behavior as before.
  return usernames.map(u => byUsername[u]).filter(Boolean);
}

/* ---------------- Lightweight per-page read cache ----------------
   getUserCached()/getClassCached() below let page-level render/init code
   reuse a doc it already fetched a moment ago instead of re-hitting
   Firestore every time (a single render() often reads the same user or
   class doc several times). getUser()/getClass() themselves only got
   request-coalescing above (for the "8 background jobs all ask for the
   same doc at once" case) — they still never cache anything across time,
   so every read-modify-write in this file keeps seeing Firestore's actual
   current state, and multi-user concurrent edits (two students acting on
   the same class doc at once) are handled exactly as before, with no risk
   of acting on stale data.

   To make sure the cache can never show stale data after a write, EVERY
   write in this app goes through one of exactly two choke points:
   fdb.collection("users"/"classes").doc(id).update/set/delete(), or
   fdb.runTransaction(). Both are wrapped just below so that the instant
   any write to a user or class doc resolves — from anywhere in the app —
   that doc's cached read is dropped automatically. */
(function installReadCache() {
  const CACHE_TTL_MS = 2000; // just a safety cap; real invalidation is explicit, below
  const store = new Map();
  const cacheKey = (col, id) => col + "/" + id;

  window._rcGet = function (col, id) {
    const hit = store.get(cacheKey(col, id));
    if (hit && hit.expires > Date.now()) return hit.value;
    if (hit) store.delete(cacheKey(col, id));
    return undefined;
  };
  window._rcSet = function (col, id, value) {
    store.set(cacheKey(col, id), { value, expires: Date.now() + CACHE_TTL_MS });
  };

  // Wrap fdb.collection("users"/"classes") so any direct write — from this
  // file or (via classesColUpdateRate in teacher.js) elsewhere — clears
  // that doc's cached read the moment the write resolves. Guards against
  // double-wrapping in case the SDK reuses the same collection/doc object
  // across calls.
  const origCollection = fdb.collection.bind(fdb);
  fdb.collection = function (name) {
    const colRef = origCollection(name);
    if (name !== "users" && name !== "classes") return colRef;
    if (colRef.__anwWrapped) return colRef;
    colRef.__anwWrapped = true;
    const origDoc = colRef.doc.bind(colRef);
    colRef.doc = function (id) {
      const docRef = origDoc(id);
      if (docRef.__anwWrapped) return docRef;
      docRef.__anwWrapped = true;
      ["update", "set", "delete"].forEach(method => {
        const orig = docRef[method].bind(docRef);
        docRef[method] = function (...args) {
          const result = orig(...args);
          result.then(() => store.delete(cacheKey(name, id)), () => {});
          return result;
        };
      });
      return docRef;
    };
    return colRef;
  };

  // Transactions read/write via t.get()/t.update()/t.set(), which don't go
  // through docRef above — so as a simple, always-correct safety net,
  // clear the ENTIRE cache once any transaction finishes, regardless of
  // which doc(s) it touched. Transactions are already the least frequent,
  // most deliberate writes in the app, so this costs nothing noticeable.
  const origRunTransaction = fdb.runTransaction.bind(fdb);
  fdb.runTransaction = function (updateFn) {
    const result = origRunTransaction(updateFn);
    result.then(() => store.clear(), () => {});
    return result;
  };
})();

// Page load fires off around 7 independent background jobs (auto pay day,
// automations, mortgages, interest, insurance, weekly events, big events)
// all at once via Promise.all, and several of them each start by reading
// the same class doc. A plain cache doesn't help there — they all call in
// before the first read has even come back, so they'd all still miss and
// all still fire their own Firestore request. This "in-flight" map fixes
// that: the first caller for a given doc starts the real fetch and every
// other caller for that same doc, while it's still pending, is handed the
// exact same promise instead of starting a duplicate one.
const _inflightUserFetch = new Map();
const _inflightClassFetch = new Map();

async function getUserCached(username) {
  if (!username) return null;
  const cached = window._rcGet("users", username);
  if (cached !== undefined) return cached;
  if (_inflightUserFetch.has(username)) return _inflightUserFetch.get(username);
  const promise = (async () => {
    try {
      const value = await getUser(username);
      window._rcSet("users", username, value);
      return value;
    } finally {
      _inflightUserFetch.delete(username);
    }
  })();
  _inflightUserFetch.set(username, promise);
  return promise;
}
async function getClassCached(code) {
  if (!code) return null;
  const cached = window._rcGet("classes", code);
  if (cached !== undefined) return cached;
  if (_inflightClassFetch.has(code)) return _inflightClassFetch.get(code);
  const promise = (async () => {
    try {
      const value = await getClass(code);
      window._rcSet("classes", code, value);
      return value;
    } finally {
      _inflightClassFetch.delete(code);
    }
  })();
  _inflightClassFetch.set(code, promise);
  return promise;
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
  // requireLogin() (below) runs at the top of every page, before render()
  // asks for the same current-user doc again — using the cached fetch here
  // means that second ask is a cache hit instead of a second, fully
  // redundant Firestore read of the identical document.
  return await getUserCached(uname);
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
    eventDefs: [], eventLog: [], lastEventWeekRun: null, lastEventDayRun: null,
    vehicles: [], termDepositPlans: [],
    sideHustles: [],
    lifestyleLock: { threshold: 0, modules: [] },
    interestAuto: false, interestFrequency: "weekly", interestDay: "Fri", lastInterestRun: null,
    insuranceDay: "Fri", lastInsuranceWeekRun: null,
    gambling: { enabled: true, minBet: 1, maxBet: 20, dailyBetCap: null, payouts: { straightUp: 35, split: 17, street: 11, corner: 8, sixLine: 5, oddEven: 1 } },
    taxRates: { store: 0, insurance: 0, property: 0, transport: 0, interest: 0, gambling: 0 },
    wageTaxBrackets: [],
    bigEventDefs: [], bigEventLog: [], lastBigEventWeekRun: null,
    lifestyleConfig: {
      property: { enabled: true, weight: 4 },
      store: { enabled: true, weight: 2 },
      insurance: { enabled: true, weight: 2 },
      transport: { enabled: true, weight: 3 },
      loan: { enabled: false, perAmount: 0, points: 0 }
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
        classCode, balance: 20, jobId: null, savings: 0, loans: []
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
    from: teacherUser, to: studentUser, amount: Math.abs(amount), note: note || "",
    announce: true, acknowledged: false
  });
  return { ok: true };
}

// Marks a bonus/fine txn as seen so its one-time popup doesn't show again.
async function acknowledgeTxn(classCode, txnId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const txn = (cls.txns || []).find(x => x.id === txnId);
    if (!txn) return;
    txn.acknowledged = true;
    t.update(classRef, { txns: cls.txns });
  });
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
    (cls.vehicles || []).forEach(v => { v.owners = (v.owners || []).filter(o => o !== studentUser); });
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

// Identifies the current "pay cycle" by the date of its next upcoming (or
// today's, if today IS the pay day) occurrence of the class's pay day.
// This key is the same for the whole week leading up to and including pay
// day itself, so a job-task approval ticked any day that week — including
// on pay day, before pay day actually runs — stays valid when pay day
// checks it. It only flips forward, to next week's pay day, once the
// current pay day has passed, which is what makes the job-task checkbox
// reset the day AFTER pay day rather than moments before pay day runs.
function payCycleKey(payDay) {
  const targetIdx = DAY_NAMES.indexOf(payDay || "Fri");
  const todayIdx = DAY_NAMES.indexOf(nzDayName());
  const diff = (targetIdx - todayIdx + 7) % 7;
  const ms = dateKeyToUTC(nzDateKey()) + diff * 86400000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear(), m = String(dt.getUTCMonth() + 1).padStart(2, "0"), d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Teacher-controlled gate on wages: a student only gets paid on pay day
// if the teacher has ticked "completed this week's job task" for the
// current pay cycle. The box doesn't carry over — it resets automatically
// the moment pay day arrives (Friday by default, or whatever the class's
// pay day is set to), so the teacher has to tick it again each cycle.
async function setJobTaskApproval(classCode, username, approved) {
  const cls = await getClass(classCode);
  const weekKey = payCycleKey(cls && cls.payDay);
  await usersCol().doc(username).update({ jobTaskApproval: { weekKey, approved: !!approved } });
  return { ok: true };
}
function isJobTaskApprovedThisWeek(user, cls) {
  const weekKey = payCycleKey(cls && cls.payDay);
  const approval = user && user.jobTaskApproval;
  return !!(approval && approval.weekKey === weekKey && approval.approved);
}

async function autoPayDayIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.payDay) return 0;
  const todayName = nzDayName();
  const todayKey = nzDateKey();
  if (todayName !== cls.payDay) return 0;
  if (cls.lastPayDayRun === todayKey) return 0; // cheap skip — already fully ran today
  const result = await runPayDayInternal(classCode, todayKey, { force: false });
  return result.newlyPaid;
}

async function payDay(classCode) {
  // Manual "Run Pay Day" button — always actually checks every student,
  // even if today's auto-run already completed. It will still never pay
  // the same student twice for the same day; it only pays students who
  // have a job but haven't been paid yet today (e.g. ones missed by an
  // earlier partial/failed run, or ones assigned a job after auto-run).
  return await runPayDayInternal(classCode, nzDateKey(), { force: true });
}

async function runPayDayInternal(classCode, dateKey, { force = false } = {}) {
  const classRef = classesCol().doc(classCode);

  // Figure out today's progress record. `force` (manual button) always
  // proceeds to check students even if lastPayDayRun already says today
  // is done — the per-student paidUsernames list is what actually
  // prevents double-payment, not the coarse lastPayDayRun flag.
  let progress = null;
  let alreadyRun = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    alreadyRun = cls.lastPayDayRun === dateKey;
    if (alreadyRun && !force) { progress = "SKIP"; return; }
    const existing = cls.payDayProgress;
    progress = (existing && existing.dateKey === dateKey) ? existing : { dateKey, paidUsernames: [] };
    t.update(classRef, { payDayProgress: progress });
  });
  if (progress === "SKIP") return { paidCount: 0, newlyPaid: 0, hasJobs: null, alreadyRun: true, unapprovedCount: 0 };

  const cls = await getClass(classCode);
  if (!cls) return { paidCount: 0, newlyPaid: 0, hasJobs: false, alreadyRun, unapprovedCount: 0 };
  const students = await getClassStudents(classCode);
  const alreadyPaid = new Set(progress.paidUsernames || []);
  let paidCount = alreadyPaid.size;
  let newlyPaid = 0;
  let hasJobs = false;
  let allSucceeded = true;
  let unapprovedCount = 0; // has a job, not yet paid today, just isn't ticked

  for (const student of students) {
    if (!student.jobId) continue;
    const job = cls.jobs.find(j => j.id === student.jobId);
    if (!job) continue;
    hasJobs = true;
    if (alreadyPaid.has(student.username)) continue;
    // Not marked as having done this week's job task yet — skip without
    // touching alreadyPaid/allSucceeded, so as soon as the teacher ticks
    // the box, the next pay day run (auto or the manual button) will
    // catch them up rather than having missed the week for good.
    if (!isJobTaskApprovedThisWeek(student, cls)) { unapprovedCount++; continue; }
    try {
      const { net, taxAmount } = applyWageTax(cls, job.wage);
      await adjustBalance(student.username, net);
      await logTxn(classCode, { type: "wage", to: student.username, amount: net, note: "Pay day: " + job.title + (taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "") });
      alreadyPaid.add(student.username);
      paidCount++;
      newlyPaid++;
      // Persist progress after each successful payment so a crash
      // mid-loop doesn't cause a re-run to pay this student twice.
      await classRef.update({ payDayProgress: { dateKey, paidUsernames: Array.from(alreadyPaid) } });
    } catch (e) {
      // Don't let one student's failure stop the rest of the class
      // from getting paid — but don't mark the day as fully done either,
      // so the next run (auto or manual) will retry just this student.
      allSucceeded = false;
    }
  }

  if (allSucceeded) {
    await classRef.update({ lastPayDayRun: dateKey });
  }
  return { paidCount, newlyPaid, hasJobs, alreadyRun, unapprovedCount };
}

// Plain-English description of when interest is next applied, for
// whichever page shows a student's interest rate/amount. Not wired into
// any page yet — bank.html/bank.js would need to call this and render it.
const INTEREST_FREQ_LABEL = { daily: "every day", weekly: "every week", fortnightly: "every 2 weeks", monthly: "every 4 weeks" };
const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
function interestScheduleLabel(cls) {
  if (!cls || !cls.interestAuto) {
    return "Your teacher applies interest manually — there's no fixed schedule.";
  }
  const freq = cls.interestFrequency || "weekly";
  if (freq === "daily") return "Interest is paid automatically every day.";
  const dayName = DAY_FULL[cls.interestDay || "Fri"] || cls.interestDay;
  return `Interest is paid automatically ${INTEREST_FREQ_LABEL[freq] || "every week"}, on ${dayName}.`;
}

async function applyInterest(classCode) {
  const cls = await getClass(classCode);
  if (!cls) return 0;
  const savingsRate = (cls.interestRate || 0) / 100;
  const cashRate = (cls.cashInterestRate || 0) / 100;
  const students = await getClassStudents(classCode);
  let count = 0;
  for (const student of students) {
    // Savings and cash can now earn (or not earn) interest at different
    // teacher-set rates — money in the Savings Account uses interestRate,
    // the everyday cash balance uses cashInterestRate (0 by default, so
    // existing classes behave exactly as before unless the teacher opts in).
    const savings = student.savings || 0;
    const savingsInterest = Math.round(savings * savingsRate * 100) / 100;
    const cashInterest = Math.round(student.balance * cashRate * 100) / 100;
    let touched = false;
    if (savingsInterest > 0) {
      const { net, taxAmount } = applyTaxToIncome(cls, "interest", savingsInterest);
      await adjustSavings(student.username, net);
      await logTxn(classCode, { type: "interest", to: student.username, amount: net, note: "Savings account interest" + (taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "") });
      touched = true;
    }
    if (cashInterest > 0) {
      const { net, taxAmount } = applyTaxToIncome(cls, "interest", cashInterest);
      await adjustBalance(student.username, net);
      await logTxn(classCode, { type: "cash-interest", to: student.username, amount: net, note: "Cash balance interest" + (taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "") });
      touched = true;
    }
    if (touched) count++;
  }
  return count;
}

async function adjustSavings(username, delta) {
  const userRef = usersCol().doc(username);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    const newSavings = Math.round(((user.savings || 0) + delta) * 100) / 100;
    t.update(userRef, { savings: newSavings });
  });
}

// Moves money from cash balance into the interest-earning Savings Account.
async function depositToSavings(username, amount) {
  amount = Number(amount);
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (amount <= 0) throw new Error("BAD_AMOUNT");
      if (user.balance < amount) throw new Error("BROKE");
      t.update(userRef, {
        balance: Math.round((user.balance - amount) * 100) / 100,
        savings: Math.round(((user.savings || 0) + amount) * 100) / 100
      });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "savings-deposit", from: username, amount, note: "Deposited into Savings Account" });
  return { ok: true };
}

// Moves money back out of the Savings Account into cash balance.
async function withdrawFromSavings(username, amount) {
  amount = Number(amount);
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (amount <= 0) throw new Error("BAD_AMOUNT");
      if ((user.savings || 0) < amount) throw new Error("BROKE");
      t.update(userRef, {
        balance: Math.round((user.balance + amount) * 100) / 100,
        savings: Math.round(((user.savings || 0) - amount) * 100) / 100
      });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have that much in savings." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "savings-withdraw", to: username, amount, note: "Withdrew from Savings Account" });
  return { ok: true };
}

/* ===================== Loans ===================== */
async function addLoanTier(classCode, tier) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.loanTiers.push({
      id: uid("loantier"),
      min: Math.max(0, Number(tier.min) || 0),
      max: Math.max(0, Number(tier.max) || 0),
      termWeeks: Math.max(1, Number(tier.termWeeks) || 1),
      rate: Math.max(0, Number(tier.rate) || 0),
      active: true
    });
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function updateLoanTier(classCode, tierId, tier) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.loanTiers.find(x => x.id === tierId);
    if (!existing) return;
    existing.min = Math.max(0, Number(tier.min) || 0);
    existing.max = Math.max(0, Number(tier.max) || 0);
    existing.termWeeks = Math.max(1, Number(tier.termWeeks) || 1);
    existing.rate = Math.max(0, Number(tier.rate) || 0);
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function removeLoanTier(classCode, tierId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.loanTiers = cls.loanTiers.filter(x => x.id !== tierId);
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function setMaxLoanAmount(classCode, amount) {
  await classesCol().doc(classCode).update({ maxLoanAmount: Math.max(0, Number(amount) || 0) });
}
async function setMaxLoanCount(classCode, count) {
  await classesCol().doc(classCode).update({ maxLoanCount: Math.max(0, Math.floor(Number(count)) || 0) });
}
// Lets a teacher dock lifestyle points for outstanding loan debt: for every
// `perAmount` a student currently owes (active loans only), they lose
// `points` off their computed lifestyle score. Feeds into lifestyleRating().
async function setLoanLifestylePenalty(classCode, { enabled, perAmount, points }) {
  const clean = {
    enabled: !!enabled,
    perAmount: Math.max(0, Number(perAmount) || 0),
    points: Math.max(0, Number(points) || 0)
  };
  await classesCol().doc(classCode).update({ "lifestyleConfig.loan": clean });
  return clean;
}

// Which tier a requested amount falls into — the teacher's price ranges
// should be set up so they don't gap or overlap, but if ranges do overlap
// the first (lowest-set-up) match wins.
function findLoanTier(cls, amount) {
  return (cls.loanTiers || []).find(t => t.active && amount >= t.min && amount <= t.max) || null;
}

async function takeLoan(username, classCode, amount) {
  amount = Number(amount);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let tierSnapshot = null, owed = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      const existingLoans = user.loans || [];
      const activeLoans = existingLoans.filter(l => l.status === "active");
      const tier = findLoanTier(cls, amount);
      if (!tier) throw new Error("NO_TIER");
      if (cls.maxLoanAmount > 0 && amount > cls.maxLoanAmount) throw new Error("OVER_MAX");
      // Cap on how many loans a student can have open (active) at the same
      // time — paid-off loans don't count against it, so a student can
      // reborrow after repaying, separate from the per-loan amount cap.
      if (cls.maxLoanCount > 0 && activeLoans.length >= cls.maxLoanCount) throw new Error("OVER_COUNT");
      const todayKey = nzDateKey();
      const dueDate = dateKeyPlusDays(todayKey, tier.termWeeks * 7);
      // tier.rate is a WEEKLY rate that compounds live, not a lump sum
      // pre-computed for the whole term up front. The first week's
      // interest is charged right here, the moment the loan is taken out;
      // after that, processLoanInterest() charges the same weekly rate
      // again every Monday for as long as the loan stays active, so
      // paying it off early genuinely saves interest.
      owed = Math.round(amount * (1 + (tier.rate / 100)) * 100) / 100;
      const interestAmt = Math.round((owed - amount) * 100) / 100;
      tierSnapshot = { id: tier.id, termWeeks: tier.termWeeks, rate: tier.rate };
      const loan = {
        id: uid("loan"), tierId: tier.id, principal: amount, rate: tier.rate, termWeeks: tier.termWeeks,
        interestAmt, owed, takenDate: todayKey, dueDate,
        // Which ISO week this loan last had interest charged for — set to
        // the taking week so the very next Monday job doesn't double-charge
        // a loan taken earlier that same week (or on the Monday itself).
        lastInterestWeek: isoWeekKey(new Date()), status: "active",
        // Marks this loan as taken out under the weekly-compounding model
        // (added after the original "one interest charge at take-out only"
        // version). Loans taken before that change don't have this flag,
        // and processLoanInterest below only compounds flagged loans — so
        // existing loans keep accruing interest exactly the way they did
        // when the student took them out; only loans taken out from now on
        // compound weekly.
        weeklyCompounding: true
      };
      user.loans = existingLoans.concat([loan]);
      t.update(userRef, { balance: Math.round((user.balance + amount) * 100) / 100, loans: user.loans });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "NO_TIER") return { ok: false, error: "That amount doesn't fall within any of the loan options your teacher has set up." };
    if (e.message === "OVER_MAX") return { ok: false, error: "That's above the maximum loan amount your teacher allows." };
    if (e.message === "OVER_COUNT") return { ok: false, error: "You already have the maximum number of loans open that your teacher allows at once." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, {
    type: "loan-taken", to: username, amount,
    note: `Loan taken — ${fmtMoney(owed)} owed so far (${tierSnapshot.rate}%/week, compounding every Monday until paid off)`
  });
  return { ok: true, owed };
}

async function repayLoan(username, loanId, amount) {
  amount = Number(amount);
  const userRef = usersCol().doc(username);
  let paid = 0, fullyPaid = false;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      const loans = user.loans || [];
      const loan = loans.find(l => l.id === loanId && l.status === "active");
      if (!loan) throw new Error("NOT_FOUND");
      if (user.balance < amount) throw new Error("BROKE");
      paid = Math.min(amount, loan.owed);
      loan.owed = Math.round((loan.owed - paid) * 100) / 100;
      if (loan.owed <= 0) { loan.owed = 0; loan.status = "paid"; fullyPaid = true; }
      t.update(userRef, { balance: Math.round((user.balance - amount) * 100) / 100, loans });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for that." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That loan couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "loan-repayment", from: username, amount: paid, note: fullyPaid ? "Loan fully repaid" : "Loan repayment" });
  return { ok: true, fullyPaid };
}

// Charges another week of compounding interest on every still-active loan,
// first thing every Monday — same "first thing on day X" idea as
// autoInterestIfDue, but on a fixed Monday schedule rather than a
// teacher-configurable day, since loan interest isn't tied to the bank's
// interest settings. A loan's very first week of interest is charged the
// moment it's taken out (see takeLoan) — this only ever adds the 2nd, 3rd,
// ... week's interest on top of that. Tracks the ISO week each loan was
// last charged for (lastInterestWeek) so: (a) re-running this on the same
// Monday (e.g. the teacher reloading the page) never double-charges, and
// (b) a loan gets skipped for good the moment it's fully repaid — a loan
// paid off is status "paid" and simply never matches the active filter
// again, so it stops accruing interest for good, whatever day that happens.
async function processLoanInterest(classCode) {
  if (nzDayName() !== "Mon") return 0;
  const weekKey = isoWeekKey(new Date());
  const students = await getClassStudents(classCode);
  let count = 0;
  for (const student of students) {
    const loans = student.loans || [];
    // Only loans taken out under the weekly-compounding model (see takeLoan)
    // are eligible — loans taken before that change never got the
    // weeklyCompounding flag, so they're skipped here and keep the flat,
    // one-time-interest behavior they were taken out under.
    const due = loans.filter(l => l.status === "active" && l.weeklyCompounding && l.lastInterestWeek !== weekKey);
    if (due.length === 0) continue;
    const userRef = usersCol().doc(student.username);
    let charged = [];
    try {
      await fdb.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) return;
        const user = snap.data();
        const liveLoans = user.loans || [];
        liveLoans.forEach(l => {
          if (l.status !== "active" || !l.weeklyCompounding || l.lastInterestWeek === weekKey) return;
          const before = l.owed;
          l.owed = Math.round(l.owed * (1 + (l.rate / 100)) * 100) / 100;
          l.lastInterestWeek = weekKey;
          const interest = Math.round((l.owed - before) * 100) / 100;
          if (interest > 0) charged.push({ interest, owedAfter: l.owed });
        });
        t.update(userRef, { loans: liveLoans });
      });
    } catch (e) { continue; }
    for (const c of charged) {
      await logTxn(classCode, {
        type: "loan-interest", to: student.username, amount: c.interest,
        note: `Weekly loan interest — now owe ${fmtMoney(c.owedAfter)}`
      });
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
  if (await isModuleLockedForStudent(username, classCode, "market")) {
    return { ok: false, error: "The Stock Market is locked for you right now because of your lifestyle rating." };
  }
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
  if (await isModuleLockedForStudent(username, classCode, "market")) {
    return { ok: false, error: "The Stock Market is locked for you right now because of your lifestyle rating." };
  }
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

// A recurring transfer between a student's own cash balance and their
// Savings Account — same idea as a regular automatic payment, but both
// sides belong to the same person, so it's stored distinctly (type:
// "savings-transfer") and handled on a single user doc rather than two.
async function addSavingsAutomation(classCode, studentUser, dayOfWeek, frequency, amount, direction, note) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (direction !== "toSavings" && direction !== "toCash") return { ok: false, error: "Invalid direction." };
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      cls.automations.push({
        id: uid("auto"), studentUser, dayOfWeek, frequency, type: "savings-transfer", direction,
        amount: Number(amount), toUser: studentUser, note: (note || "").trim(), lastRun: null, active: true
      });
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    return { ok: false, error: "Class not found." };
  }
  return { ok: true };
}
async function editAutomation(classCode, id, studentUser, dayOfWeek, frequency, amount, toUser, note) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      const idx = cls.automations.findIndex(a => a.id === id && a.studentUser === studentUser);
      if (idx === -1) throw new Error("NOT_FOUND");
      const existing = cls.automations[idx];
      cls.automations[idx] = {
        ...existing, dayOfWeek, frequency, amount: Number(amount), toUser, note: (note || "").trim()
      };
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    return { ok: false, error: e.message === "NOT_FOUND" ? "Automatic payment not found." : "Class not found." };
  }
  return { ok: true };
}
async function editSavingsAutomation(classCode, id, studentUser, dayOfWeek, frequency, amount, direction, note) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (direction !== "toSavings" && direction !== "toCash") return { ok: false, error: "Invalid direction." };
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      const idx = cls.automations.findIndex(a => a.id === id && a.studentUser === studentUser);
      if (idx === -1) throw new Error("NOT_FOUND");
      const existing = cls.automations[idx];
      cls.automations[idx] = {
        ...existing, dayOfWeek, frequency, amount: Number(amount), direction, note: (note || "").trim()
      };
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    return { ok: false, error: e.message === "NOT_FOUND" ? "Automatic transfer not found." : "Class not found." };
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

    if (a.type === "savings-transfer") {
      // Self-to-self: only one user doc involved, so this is handled
      // separately from the peer-to-peer path below (which reads/writes
      // two different docs).
      let didRun = false;
      try {
        await fdb.runTransaction(async (t) => {
          const userRef = usersCol().doc(a.studentUser);
          const classSnap = await t.get(classRef);
          const userSnap = await t.get(userRef);
          if (!classSnap.exists || !userSnap.exists) return;
          const user = userSnap.data();
          const liveCls = classSnap.data();
          const liveAuto = (liveCls.automations || []).find(x => x.id === a.id);
          if (!liveAuto || liveAuto.lastRun === todayKey) return;

          const savings = user.savings || 0;
          const fromCash = a.direction === "toSavings";
          const available = fromCash ? user.balance : savings;
          if (available < a.amount) return; // skip silently if they can't afford it this time

          const newBalance = fromCash ? user.balance - a.amount : user.balance + a.amount;
          const newSavings = fromCash ? savings + a.amount : savings - a.amount;
          t.update(userRef, { balance: Math.round(newBalance * 100) / 100, savings: Math.round(newSavings * 100) / 100 });
          liveAuto.lastRun = todayKey;
          t.update(classRef, { automations: liveCls.automations });
          didRun = true;
        });
      } catch (e) { /* ignore, try next */ }

      if (didRun) {
        await logTxn(classCode, {
          type: a.direction === "toSavings" ? "savings-deposit" : "savings-withdraw",
          [a.direction === "toSavings" ? "from" : "to"]: a.studentUser,
          amount: a.amount,
          note: (a.note ? a.note + " — " : "") + "Automatic transfer"
        });
        ran++;
      }
      continue;
    }

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
      description: v.description || "", owners: []
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
async function updateVehicle(classCode, vehId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const veh = cls.vehicles.find(v => v.id === vehId);
    if (!veh) return;
    veh.name = updates.name;
    veh.price = Number(updates.price);
    veh.comfort = Math.max(1, Math.min(5, Number(updates.comfort) || 1));
    veh.description = updates.description || "";
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
      veh.owners = veh.owners || [];
      if (veh.owners.includes(username)) throw new Error("ALREADY_OWN");
      const { total: taxedPrice, taxAmount: tax } = applyTaxToExpense(cls, "transport", veh.price);
      taxAmount = tax;
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < taxedPrice) throw new Error("BROKE");
      veh.owners.push(username);
      vehName = veh.name;
      cashPaid = taxedPrice;
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - taxedPrice) * 100) / 100 });
      t.update(classRef, { vehicles: cls.vehicles });
    });
  } catch (e) {
    if (e.message === "ALREADY_OWN") return { ok: false, error: "You already own this vehicle." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "vehicle-buy", from: username, amount: cashPaid, note: `Bought: ${vehName}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true };
}
async function sellVehicle(classCode, vehId, username, rate) {
  const classRef = classesCol().doc(classCode);
  let owner = null, payout = 0, vehName = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const veh = cls.vehicles.find(v => v.id === vehId);
    if (!veh) return;
    veh.owners = veh.owners || [];
    if (!veh.owners.includes(username)) return;
    owner = username;
    vehName = veh.name;
    payout = Math.round(veh.price * (rate !== undefined ? rate : 0.9) * 100) / 100;
    veh.owners = veh.owners.filter(o => o !== username);
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
async function editTermDepositPlan(classCode, planId, plan) {
  const classRef = classesCol().doc(classCode);
  let updatedPlan = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.termDepositPlans.find(p => p.id === planId);
    if (!existing) return;
    existing.name = plan.name;
    existing.minAmount = Number(plan.minAmount) || 0;
    existing.days = Math.max(1, Number(plan.days) || 1);
    existing.rate = Number(plan.rate) || 0;
    existing.earlyFeePct = Math.max(0, Number(plan.earlyFeePct) || 0);
    updatedPlan = existing;
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
  if (!updatedPlan) return;
  // Existing deposits store a snapshot of the plan at open time (name, rate,
  // earlyFeePct, days) so that a plan being removed/changed doesn't corrupt
  // the deposit. Since the teacher explicitly wants edits to apply to
  // ongoing deposits, that snapshot is refreshed on every student who has a
  // deposit under this plan. matureDate is left untouched — it was already
  // computed from the original day count, and changing it retroactively
  // would be surprising, so `days` is only updated for display purposes.
  const students = await getClassStudents(classCode);
  await Promise.all(students.map(async (s) => {
    const deposits = s.termDeposits || [];
    if (!deposits.some(d => d.planId === planId)) return;
    const userRef = usersCol().doc(s.username);
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      const liveDeposits = user.termDeposits || [];
      let changed = false;
      liveDeposits.forEach(d => {
        if (d.planId === planId) {
          d.plan = { id: updatedPlan.id, name: updatedPlan.name, days: updatedPlan.days, rate: updatedPlan.rate, earlyFeePct: updatedPlan.earlyFeePct };
          changed = true;
        }
      });
      if (changed) t.update(userRef, { termDeposits: liveDeposits });
    });
  }));
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
        startDate: todayKey, matureDate: matureKey,
        // Marks this deposit as opened under the weekly-compounding payout
        // model (rate compounded over days/7 weeks). Deposits opened before
        // that change don't have this flag, and processTermDeposits below
        // falls back to the original flat, non-compounding payout formula
        // for them — so a deposit already sitting in someone's account
        // still matures for exactly the amount it was opened expecting.
        weeklyCompounding: true
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
          // Deposits opened under the weekly-compounding model (flagged at
          // open time — see openTermDeposit) use d.plan.rate as a WEEKLY
          // rate that compounds over the deposit's term (days/7 weeks,
          // which may be fractional) — matches how loan interest works
          // now, and lets a 90-day plan pay noticeably more than a 30-day
          // plan at the same weekly rate. Deposits opened before that
          // change never got the flag, so they fall back to the original
          // flat payout they were promised: rate applied once, not
          // compounded per week.
          let payout;
          if (d.weeklyCompounding) {
            const weeks = d.plan.days / 7;
            payout = Math.round(d.amount * Math.pow(1 + (d.plan.rate / 100), weeks) * 100) / 100;
          } else {
            payout = Math.round(d.amount * (1 + (d.plan.rate / 100)) * 100) / 100;
          }
          const interest = Math.round((payout - d.amount) * 100) / 100;
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
    cashInterestRate: Number(settings.cashRate) || 0,
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

async function classLeaderboard(classCode, viewerUsername) {
  const cls = await getClass(classCode);
  if (!cls) return [];
  const students = await getClassStudents(classCode);
  // Everything needed (share prices, store item prices) is already sitting
  // in `cls`, and each student's own holdings/items came back with them —
  // so this is computed entirely in memory instead of the old approach,
  // which had portfolioValue() and storeItemsValue() each re-fetch the
  // whole class (and, for storeItemsValue, the user too) from the network
  // separately for every single student. That was ~4 extra network
  // round-trips per student just to build the leaderboard.
  const rows = students.map(s => {
    let invested = 0;
    cls.companies.forEach(co => { invested += (co.holders[s.username] || 0) * co.price; });
    invested = Math.round(invested * 100) / 100;

    let storeValue = 0;
    (s.storeItems || []).forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item && item.countsNetWorth !== false) storeValue += item.price;
    });
    storeValue = Math.round(storeValue * 100) / 100;

    // Property and vehicles aren't listed on the student doc — ownership
    // lives on the class doc's properties/vehicles arrays (p.owner /
    // v.owners) — so find what this student owns by scanning those.
    let propertyValue = 0, mortgageOwed = 0;
    (cls.properties || []).forEach(p => {
      if (p.owner !== s.username) return;
      propertyValue += p.price;
      if (p.mortgage) mortgageOwed += (p.mortgage.weeklyPayment || 0) * (p.mortgage.weeksLeft || 0);
    });
    propertyValue = Math.round(propertyValue * 100) / 100;
    mortgageOwed = Math.round(mortgageOwed * 100) / 100;

    let vehicleValue = 0;
    (cls.vehicles || []).forEach(v => { if ((v.owners || []).includes(s.username)) vehicleValue += v.price; });
    vehicleValue = Math.round(vehicleValue * 100) / 100;

    const savings = s.savings || 0;
    const owed = (s.loans || []).filter(l => l.status === "active").reduce((sum, l) => sum + l.owed, 0) + mortgageOwed;
    const termDeposits = (s.termDeposits || []).reduce((sum, d) => sum + d.amount, 0);
    return {
      username: s.username, name: s.name,
      balance: s.balance, invested, storeValue, propertyValue, vehicleValue, savings, owed, termDeposits,
      net: Math.round((s.balance + invested + storeValue + propertyValue + vehicleValue + savings + termDeposits - owed) * 100) / 100
    };
  });
  // Loan/mortgage debt ("owed") is shown for every student on the
  // leaderboard, not just the viewer's own row — classmates can see each
  // other's debt, same as every other breakdown figure here.
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

async function resetClass(classCode) {
  const students = await getClassStudents(classCode);
  await Promise.all(students.map(s => usersCol().doc(s.username).update({
    balance: 0, jobId: null, insurance: [], storeItems: [], termDeposits: [], savings: 0, loans: []
  })));
  const cls = await getClass(classCode);
  const properties = (cls.properties || []).map(p => ({ ...p, owner: null, mortgage: null }));
  const vehicles = (cls.vehicles || []).map(v => ({ ...v, owners: [] }));
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
      dailyBetCap: (settings.dailyBetCap === "" || settings.dailyBetCap === undefined || settings.dailyBetCap === null) ? null : Math.max(0, Number(settings.dailyBetCap) || 0),
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
  // Same fix as startBlackjackRound: fetch the class/user docs once and
  // reuse them for the lock check instead of letting isModuleLockedForStudent
  // fetch them again independently.
  betAmount = Number(betAmount);
  const [clsRaw, user] = await Promise.all([getClass(classCode), getUser(username)]);
  const cls = withNewModuleDefaults(clsRaw);
  if (!cls) return { ok: false, error: "Class not found." };
  if (isModuleLockedForStudentFromData(cls, user, username, "gambling")) {
    return { ok: false, error: "Gambling is locked for you right now because of your lifestyle rating." };
  }
  const g = cls.gambling;
  if (!g.enabled) return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
  if (!(betAmount > 0)) return { ok: false, error: "Enter a bet amount greater than zero." };
  if (betAmount < g.minBet || betAmount > g.maxBet) return { ok: false, error: `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.` };

  if (g.dailyBetCap) {
    const todayKey = nzDateKey();
    const betToday = (cls.txns || [])
      .filter(t => t.type === "gambling" && t.from === username && nzDateKey(new Date(t.ts || 0)) === todayKey)
      // t.bet is the actual stake placed; fall back to t.amount for older
      // txns logged before this field existed (imprecise on wins, since
      // amount was the net winnings there, but better than nothing).
      .reduce((sum, t) => sum + (t.bet !== undefined ? t.bet : t.amount), 0);
    if (betToday + betAmount > g.dailyBetCap) {
      const remaining = Math.max(0, g.dailyBetCap - betToday);
      return { ok: false, error: `Daily betting limit reached — you can bet up to ${fmtMoney(g.dailyBetCap)} per day, and you've already bet ${fmtMoney(betToday)} today (${fmtMoney(remaining)} left).` };
    }
  }

  let valid = false, count = 0;
  if (betType === "straightUp") { valid = selection.length === 1 && selection[0] >= 0 && selection[0] <= 36; count = 1; }
  else if (betType === "split") { valid = selection.length === 2 && isValidSplit(selection[0], selection[1]); count = 2; }
  else if (betType === "street") { valid = isValidStreet(selection); count = 3; }
  else if (betType === "corner") { valid = isValidCorner(selection); count = 4; }
  else if (betType === "sixLine") { valid = isValidSixLine(selection); count = 6; }
  else if (betType === "oddEven") { valid = selection[0] === "odd" || selection[0] === "even"; }
  else return { ok: false, error: "Unknown bet type." };
  if (!valid) return { ok: false, error: "That's not a valid bet for this type." };

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
    type: "gambling", from: username, amount: Math.abs(netChange), bet: betAmount,
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

/* ===================== Gambling (Blackjack) =====================
   Rules implemented strictly from Christchurch Casino's public
   "Blackjack — How to Play" guide (4 decks, 3:2 blackjack, doubling on
   any 2-card total that does NOT include an Ace, splitting same-value
   cards up to twice — max 3 hands — split Aces get exactly one card
   each and can't make a "blackjack", insurance at 2:1 when the dealer
   shows an Ace, original-bet-only protection against a dealer
   blackjack after doubling/splitting). Two settings not stated in the
   PDF were confirmed with the teacher building this: the dealer stands
   on every 17 (hard or soft), and the bots play full basic strategy. */
async function saveBlackjackSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    blackjack: {
      enabled: settings.enabled !== false,
      minBet: Math.max(0, Number(settings.minBet) || 0),
      maxBet: Math.max(0, Number(settings.maxBet) || 0)
    }
  });
}

const BJ_SUITS = ["S", "H", "D", "C"];
const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const BJ_NUM_DECKS = 4;
const BJ_BOT_NAMES = ["Ana", "Miro", "Kahu", "Priya", "Leo", "Sione"];

// Rejection-sampled random ints from crypto.getRandomValues (falls back to
// Math.random if unavailable) — avoids the modulo bias a plain
// `Math.random() * n | 0` would have, so the shuffle below is unbiased.
function bjRandomInt(maxExclusive) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const maxUint32 = 0xFFFFFFFF;
    const limit = maxUint32 - (maxUint32 % maxExclusive);
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}
// Fisher-Yates shuffle — every permutation equally likely, so the shoe is a
// fair shuffle of the 4 decks.
function bjShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = bjRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function bjBuildShoe() {
  const shoe = [];
  for (let d = 0; d < BJ_NUM_DECKS; d++) {
    BJ_SUITS.forEach(s => BJ_RANKS.forEach(r => shoe.push({ r, s })));
  }
  return bjShuffle(shoe);
}
// Draws (removes) the top card of the shoe — once drawn it is gone from
// the shoe for the rest of the round, exactly like cards leaving a real
// shoe until it's reshuffled for the next round.
function bjDraw(shoe) {
  if (!shoe.length) throw new Error("SHOE_EMPTY");
  return shoe.pop();
}
function bjCardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}
function bjHandValue(cards) {
  let total = 0, aces = 0;
  cards.forEach(c => { total += bjCardValue(c.r); if (c.r === "A") aces++; });
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function bjIsBust(cards) { return bjHandValue(cards).total > 21; }
// "Blackjack" = a natural 21 on the first two cards. A 21 reached via a
// split Ace (one card only, per the rules) never counts as blackjack.
function bjIsNaturalBlackjack(cards) { return cards.length === 2 && bjHandValue(cards).total === 21; }
function bjCardLabel(c) { return c.r + c.s; }

/* ---- Basic strategy for the two bot players (cosmetic, no real money) ---- */
function bjBotDecision(cards, dealerUpRank, canDouble, canSplit) {
  const dealerVal = bjCardValue(dealerUpRank) === 11 ? 11 : bjCardValue(dealerUpRank);
  const { total, soft } = bjHandValue(cards);

  if (canSplit && cards.length === 2 && bjCardValue(cards[0].r) === bjCardValue(cards[1].r)) {
    const v = bjCardValue(cards[0].r);
    if (cards[0].r === "A" || v === 8) return "split";
    if (v === 9) return ([2, 3, 4, 5, 6, 8, 9].includes(dealerVal)) ? "split" : "stand";
    if (v === 7) return (dealerVal <= 7) ? "split" : "hit";
    if (v === 6) return (dealerVal >= 2 && dealerVal <= 6) ? "split" : "hit";
    if (v === 4) return (dealerVal === 5 || dealerVal === 6) ? "split" : "hit";
    if (v === 2 || v === 3) return (dealerVal >= 2 && dealerVal <= 7) ? "split" : "hit";
    // v === 5 or v === 10: never split, fall through to hard-total logic below
  }

  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) {
      if (canDouble && dealerVal >= 3 && dealerVal <= 6) return "double";
      return (dealerVal >= 9) ? "hit" : "stand";
    }
    if (total === 17) return (canDouble && dealerVal >= 3 && dealerVal <= 6) ? "double" : "hit";
    if (total === 15 || total === 16) return (canDouble && dealerVal >= 4 && dealerVal <= 6) ? "double" : "hit";
    if (total === 13 || total === 14) return (canDouble && dealerVal >= 5 && dealerVal <= 6) ? "double" : "hit";
    return "hit";
  }

  if (total <= 8) return "hit";
  if (total === 9) return (canDouble && dealerVal >= 3 && dealerVal <= 6) ? "double" : "hit";
  if (total === 10) return (canDouble && dealerVal >= 2 && dealerVal <= 9) ? "double" : "hit";
  if (total === 11) return (canDouble && dealerVal <= 10) ? "double" : "hit";
  if (total === 12) return (dealerVal >= 4 && dealerVal <= 6) ? "stand" : "hit";
  if (total >= 13 && total <= 16) return (dealerVal >= 2 && dealerVal <= 6) ? "stand" : "hit";
  return "stand";
}

// Plays out one bot's hand(s) to completion at deal time — bots never
// touch real money, so they can be resolved immediately without pausing
// the round, then just get replayed/animated on the client in table order.
function bjPlayBot(shoe, initialCards, dealerUpRank) {
  let hands = [{ cards: initialCards, doubled: false, isSplitAces: false }];
  let splits = 0;
  let i = 0;
  while (i < hands.length) {
    const h = hands[i];
    for (;;) {
      const canDouble = h.cards.length === 2 && !h.doubled && !h.isSplitAces && !h.cards.some(c => c.r === "A");
      const canSplit = h.cards.length === 2 && splits < 2 && !h.isSplitAces && bjCardValue(h.cards[0].r) === bjCardValue(h.cards[1].r);
      const decision = bjPlayBot_isFirstBust(h) ? "stand" : bjBotDecision(h.cards, dealerUpRank, canDouble, canSplit);
      if (decision === "split" && canSplit) {
        const isAces = h.cards[0].r === "A";
        const otherCard = h.cards.pop();
        h.cards.push(bjDraw(shoe));
        const newHand = { cards: [otherCard, bjDraw(shoe)], doubled: false, isSplitAces: isAces };
        if (isAces) { h.isSplitAces = true; }
        hands.splice(i + 1, 0, newHand);
        splits++;
        if (isAces) break; // split aces: exactly one card each, forced stand
        continue;
      }
      if (decision === "double" && canDouble) {
        h.doubled = true;
        h.cards.push(bjDraw(shoe));
        break;
      }
      if (decision === "hit") {
        h.cards.push(bjDraw(shoe));
        if (bjIsBust(h.cards) || bjHandValue(h.cards).total === 21) break;
        continue;
      }
      break; // stand
    }
    i++;
  }
  return hands.map(h => ({ cards: h.cards, total: bjHandValue(h.cards).total, bust: bjIsBust(h.cards), doubled: h.doubled }));
}
function bjPlayBot_isFirstBust(h) { return bjIsBust(h.cards); }

function bjSeatOrder() { return [1, 2, 3]; }

// Deals a fresh round: builds+shuffles a brand-new 4-deck shoe (a real
// table also reshuffles between rounds), seats the human in a random seat
// (1, 2 or 3) with the other two seats filled by bots, deals in strict
// table order (seat1, seat2, seat3, dealer-up, seat1, seat2, seat3,
// dealer-hole), then instantly resolves the two bot hands since they
// never depend on the human's choices. The human's bet is escrowed
// immediately, same as chips leaving your hand onto the table.
async function startBlackjackRound(username, classCode, betAmount) {
  // Previously this fetched the class doc up to 3x and the user doc 2x for
  // a single Deal click: once each inside isModuleLockedForStudent() (via
  // getLockedModulesForStudent() -> lifestyleRating()), and again right
  // here. Fetching both docs once, up front, and reusing them for the lock
  // check removes those duplicate reads — same checks, same order, same
  // error messages, just no redundant round-trips.
  betAmount = Number(betAmount);
  const [clsRaw, user] = await Promise.all([getClass(classCode), getUser(username)]);
  const cls = withNewModuleDefaults(clsRaw);
  if (!cls) return { ok: false, error: "Class not found." };
  if (isModuleLockedForStudentFromData(cls, user, username, "gambling")) {
    return { ok: false, error: "Gambling is locked for you right now because of your lifestyle rating." };
  }
  if (!cls.gambling.enabled) return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
  const bj = cls.blackjack;
  if (!bj.enabled) return { ok: false, error: "Your teacher has temporarily turned off Blackjack for this class." };
  if (!(betAmount > 0)) return { ok: false, error: "Enter a bet amount greater than zero." };
  if (betAmount < bj.minBet || betAmount > bj.maxBet) return { ok: false, error: `Bets must be between ${fmtMoney(bj.minBet)} and ${fmtMoney(bj.maxBet)}.` };

  if (cls.gambling.dailyBetCap) {
    const todayKey = nzDateKey();
    const betToday = (cls.txns || [])
      .filter(t => t.type === "gambling" && t.from === username && nzDateKey(new Date(t.ts || 0)) === todayKey)
      .reduce((sum, t) => sum + (t.bet !== undefined ? t.bet : t.amount), 0);
    if (betToday + betAmount > cls.gambling.dailyBetCap) {
      const remaining = Math.max(0, cls.gambling.dailyBetCap - betToday);
      return { ok: false, error: `Daily betting limit reached — you can bet up to ${fmtMoney(cls.gambling.dailyBetCap)} per day, and you've already bet ${fmtMoney(betToday)} today (${fmtMoney(remaining)} left).` };
    }
  }

  if (!user) return { ok: false, error: "User not found." };
  if (user.blackjackRound) return { ok: false, error: "You already have a Blackjack round in progress." };
  if (user.role !== "teacher" && user.balance < betAmount) return { ok: false, error: "You don't have enough money for that bet." };

  // Build and deal the whole round in memory FIRST, before any money moves.
  // Shuffling/dealing/bot-play never touch the network and can't fail for a
  // real user (bjDraw only throws if the 208-card shoe is ever exhausted,
  // which basic strategy play can't do) — but if something unexpected does
  // go wrong here, better to bail out now than escrow a bet for a round
  // that was never actually built.
  let round;
  try {
    const shoe = bjBuildShoe();
    // A flat 1-in-3 random pick is unbiased over the long run, but it can
    // still "streak" onto the same one or two seats for a while and never
    // land on the third — which is exactly what got reported (seat 2
    // never coming up). To make every seat visibly show up on a regular
    // basis, exclude whichever seat the student sat in last round (when
    // known) from this round's draw, so the same seat can never repeat
    // back-to-back.
    const avoidSeat = user.lastBjSeat;
    const seatChoices = [1, 2, 3].filter(s => s !== avoidSeat);
    const humanSeat = seatChoices[bjRandomInt(seatChoices.length)];
    const botSeats = [1, 2, 3].filter(s => s !== humanSeat);
    const botNames = bjShuffle(BJ_BOT_NAMES).slice(0, 2);
    const seatCards = { 1: [], 2: [], 3: [] };

    [1, 2, 3].forEach(s => seatCards[s].push(bjDraw(shoe)));
    const dealerUp = bjDraw(shoe);
    [1, 2, 3].forEach(s => seatCards[s].push(bjDraw(shoe)));
    const dealerHole = bjDraw(shoe);

    const bots = {};
    botSeats.forEach((s, idx) => {
      bots[s] = { name: botNames[idx], hands: bjPlayBot(shoe, seatCards[s], dealerUp.r) };
    });

    const humanCards = seatCards[humanSeat];
    const insuranceOffered = dealerUp.r === "A";

    round = {
      shoe, betAmount, humanSeat, botSeats, bots,
      dealer: { up: dealerUp, hole: dealerHole, cards: [], revealed: false },
      insurance: { offered: insuranceOffered, resolved: !insuranceOffered, taken: false, amount: 0 },
      hands: [{ cards: humanCards, bet: betAmount, doubled: false, isSplitAces: false, status: "playing" }],
      activeHandIndex: 0, splitCount: 0,
      phase: insuranceOffered ? "insurance" : "playing",
      createdAt: Date.now()
    };
    // A natural human blackjack auto-stands that hand — nothing left to
    // decide on it (only insurance, if offered, is still open).
    if (bjIsNaturalBlackjack(humanCards)) round.hands[0].status = "blackjack";
  } catch (e) {
    return { ok: false, error: "Something went wrong dealing that round. Please try again." };
  }

  // Best-effort — remembering the seat is only used to keep future seat
  // draws fair, it's not part of the actual round/money, so a failure
  // here shouldn't stop the round from being dealt.
  try {
    await usersCol().doc(username).update({ lastBjSeat: humanSeat });
  } catch (e) { /* not critical */ }

  await adjustBalance(username, -betAmount);

  // From here on the bet is escrowed, so any failure must refund it rather
  // than leave the student down money with no round to show for it.
  try {
    if (round.hands[0].status === "blackjack" && !round.insurance.offered) {
      return await bjAdvance(username, classCode, round);
    }
    await usersCol().doc(username).update({ blackjackRound: round });
    return { ok: true, round: bjClientView(round) };
  } catch (e) {
    await adjustBalance(username, betAmount);
    return { ok: false, error: "Something went wrong starting that round — your bet has been refunded. Please try again." };
  }
}

// Applies the human's insurance decision, then checks the dealer's hole
// card: a dealer blackjack ends the round immediately (insurance pays 2:1;
// only the ORIGINAL bet is at risk on the main hand — any split/double
// wagers a player had already placed would be refunded, though at this
// stage in a round none have been placed yet since insurance is offered
// before any other action).
async function blackjackInsurance(username, classCode, takeInsurance) {
  const user = await getUser(username);
  if (!user || !user.blackjackRound) return { ok: false, error: "No Blackjack round in progress." };
  const round = user.blackjackRound;
  if (round.phase !== "insurance") return { ok: false, error: "Insurance isn't available right now." };

  let insAmount = 0;
  if (takeInsurance) {
    insAmount = Math.round((round.betAmount / 2) * 100) / 100;
    if (user.balance < insAmount) return { ok: false, error: "You don't have enough money for insurance." };
    await adjustBalance(username, -insAmount);
    round.insurance.taken = true;
    round.insurance.amount = insAmount;
  }

  // Everything below only rearranges already-known cards and saves state —
  // nothing here should realistically throw — but if it ever does, refund
  // any insurance stake just taken instead of leaving the round stuck with
  // money gone and nothing saved.
  try {
    round.insurance.resolved = true;

    round.dealer.revealed = true;
    round.dealer.cards = [round.dealer.up, round.dealer.hole];
    const dealerBJ = bjIsNaturalBlackjack(round.dealer.cards);

    if (dealerBJ) {
      if (round.insurance.taken) await adjustBalance(username, round.insurance.amount * 3); // stake back + 2:1
      if (round.hands[0].status === "blackjack") round.hands[0].status = "push";
      else round.hands[0].status = "lost-to-dealer-blackjack";
      round.phase = "dealer";
      return await bjSettle(username, classCode, round);
    }

    round.dealer.revealed = false; // hide it again until the human's play is done
    if (round.hands[0].status === "blackjack") {
      round.phase = "dealer";
      return await bjSettle(username, classCode, round);
    }
    round.phase = "playing";
    await usersCol().doc(username).update({ blackjackRound: round });
    return { ok: true, round: bjClientView(round) };
  } catch (e) {
    if (insAmount > 0) await adjustBalance(username, insAmount);
    return { ok: false, error: "Something went wrong resolving insurance — any insurance stake has been refunded. Please try again." };
  }
}

function bjActiveHand(round) { return round.hands[round.activeHandIndex]; }

// Moves on to the next hand still marked "playing" (relevant after a
// split), or into the dealer's turn once every human hand is resolved.
async function bjAdvance(username, classCode, round) {
  let next = round.hands.findIndex(h => h.status === "playing");
  if (next === -1) {
    round.phase = "dealer";
    return await bjSettle(username, classCode, round);
  }
  round.activeHandIndex = next;
  await usersCol().doc(username).update({ blackjackRound: round });
  return { ok: true, round: bjClientView(round) };
}

async function blackjackAction(username, classCode, action) {
  const user = await getUser(username);
  if (!user || !user.blackjackRound) return { ok: false, error: "No Blackjack round in progress." };
  const round = user.blackjackRound;
  if (round.phase !== "playing") return { ok: false, error: "It's not your turn to act." };
  const hand = bjActiveHand(round);
  if (!hand || hand.status !== "playing") return { ok: false, error: "That hand is already finished." };

  try {
    if (action === "hit") {
      hand.cards.push(bjDraw(round.shoe));
      if (bjIsBust(hand.cards)) hand.status = "bust";
      else if (bjHandValue(hand.cards).total === 21) hand.status = "stand";
      return await bjAdvance(username, classCode, round);
    }

    if (action === "stand") {
      hand.status = "stand";
      return await bjAdvance(username, classCode, round);
    }

    if (action === "double") {
      const eligible = hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces && !hand.cards.some(c => c.r === "A");
      if (!eligible) return { ok: false, error: "You can only double on your first two cards, and not if either card is an Ace." };
      if (user.balance < hand.bet) return { ok: false, error: "You don't have enough money to double down." };
      await adjustBalance(username, -hand.bet);
      try {
        hand.doubled = true;
        hand.bet *= 2;
        hand.cards.push(bjDraw(round.shoe));
        hand.status = bjIsBust(hand.cards) ? "bust" : "stand";
        return await bjAdvance(username, classCode, round);
      } catch (e) {
        await adjustBalance(username, hand.bet / 2); // undo the doubled stake just taken
        return { ok: false, error: "Something went wrong doubling down — your extra stake has been refunded. Please try again." };
      }
    }

    if (action === "split") {
      const eligible = hand.cards.length === 2 && !hand.isSplitAces && round.splitCount < 2 &&
        bjCardValue(hand.cards[0].r) === bjCardValue(hand.cards[1].r);
      if (!eligible) return { ok: false, error: "That hand can't be split." };
      if (user.balance < hand.bet) return { ok: false, error: "You don't have enough money to split." };
      const splitStake = hand.bet;
      await adjustBalance(username, -splitStake);
      try {
        const isAces = hand.cards[0].r === "A";
        const otherCard = hand.cards.pop();
        hand.cards.push(bjDraw(round.shoe));
        const newHand = { cards: [otherCard, bjDraw(round.shoe)], bet: hand.bet, doubled: false, isSplitAces: isAces, status: "playing" };
        if (isAces) {
          hand.isSplitAces = true;
          hand.status = "stand"; // split Aces: exactly one card each, forced stand
          newHand.status = "stand";
        }
        round.hands.splice(round.activeHandIndex + 1, 0, newHand);
        round.splitCount++;
        return await bjAdvance(username, classCode, round);
      } catch (e) {
        await adjustBalance(username, splitStake); // undo the split stake just taken
        return { ok: false, error: "Something went wrong splitting that hand — your stake has been refunded. Please try again." };
      }
    }

    return { ok: false, error: "Unknown action." };
  } catch (e) {
    return { ok: false, error: "Something went wrong with that action. Please try again." };
  }
}

// Dealer plays out (stands on all 17s, hard or soft), then every human
// hand is settled against it and the round is closed out with a single
// transaction log entry.
async function bjSettle(username, classCode, round) {
  const cls = withNewModuleDefaults(await getClass(classCode));

  if (!round.dealer.revealed) {
    round.dealer.revealed = true;
    round.dealer.cards = [round.dealer.up, round.dealer.hole];
  }
  if (round.hands.some(h => h.status !== "bust" && h.status !== "push" && h.status !== "lost-to-dealer-blackjack")) {
    while (bjHandValue(round.dealer.cards).total < 17) {
      round.dealer.cards.push(bjDraw(round.shoe));
    }
  }
  const dealerVal = bjHandValue(round.dealer.cards).total;
  const dealerBust = dealerVal > 21;
  const dealerBJ = bjIsNaturalBlackjack(round.dealer.cards);

  let totalCredit = 0, totalStaked = 0, taxTotal = 0;
  const results = [];
  for (const h of round.hands) {
    totalStaked += h.bet;
    if (h.status === "push") { totalCredit += h.bet; results.push({ hand: h, outcome: "push" }); continue; }
    if (h.status === "lost-to-dealer-blackjack" || h.status === "bust") { results.push({ hand: h, outcome: "lost" }); continue; }

    const playerVal = bjHandValue(h.cards).total;
    const playerBJ = bjIsNaturalBlackjack(h.cards) && !h.isSplitAces;
    let outcome;
    if (playerBJ && !dealerBJ) outcome = "blackjack";
    else if (dealerBust || playerVal > dealerVal) outcome = "won";
    else if (playerVal === dealerVal) outcome = "push";
    else outcome = "lost";

    if (outcome === "push") { totalCredit += h.bet; }
    else if (outcome === "won" || outcome === "blackjack") {
      const profitBase = outcome === "blackjack" ? h.bet * 1.5 : h.bet;
      const { net, taxAmount } = applyTaxToIncome(cls, "gambling", profitBase);
      totalCredit += h.bet + net;
      taxTotal += taxAmount;
    }
    results.push({ hand: h, outcome });
  }

  if (totalCredit > 0) await adjustBalance(username, totalCredit);

  const insuranceNote = round.insurance.taken
    ? (round.insurance.amount > 0 && dealerBJ ? ` Insurance won ${fmtMoney(round.insurance.amount * 2)}.` : ` Insurance lost ${fmtMoney(round.insurance.amount)}.`)
    : "";
  const netChange = Math.round((totalCredit - totalStaked - round.insurance.amount) * 100) / 100;
  const netForTxn = Math.round((netChange) * 100) / 100;
  const dealerDesc = `dealer had ${dealerVal}${dealerBust ? " (bust)" : dealerBJ ? " (blackjack)" : ""}`;

  // Say exactly what the player's hand(s) got, not just the outcome —
  // one clause per hand so a split round reads clearly too.
  const outcomeWord = { won: "won", blackjack: "blackjack, won", push: "pushed", lost: "lost", "lost-to-dealer-blackjack": "lost" };
  let handsDesc;
  if (round.hands.length === 1) {
    const only = results[0];
    handsDesc = `you had ${bjHandValue(only.hand.cards).total}${only.hand.status === "bust" ? " (bust)" : ""} — ${outcomeWord[only.outcome]}`;
  } else {
    handsDesc = results.map((r, i) => `hand ${i + 1}: ${bjHandValue(r.hand.cards).total}${r.hand.status === "bust" ? " (bust)" : ""} (${outcomeWord[r.outcome]})`).join(", ");
  }

  await logTxn(classCode, {
    // `bet` here is what the daily bet cap (placeRouletteBet/
    // startBlackjackRound) sums up to see how much a student has bet
    // today — it should only reflect what they actually chose to risk by
    // starting the round, not money added afterwards by doubling down or
    // splitting (each of which increases totalStaked without the student
    // placing a new, separate bet), and not the side insurance bet
    // either. round.betAmount is exactly that original stake.
    type: "gambling", from: username, amount: Math.abs(netForTxn), bet: round.betAmount,
    note: `Blackjack: ${handsDesc}; ${dealerDesc} — ${netForTxn >= 0 ? "WON" : "lost"} ${fmtMoney(Math.abs(netForTxn))} overall.${insuranceNote}${taxTotal > 0 ? ` (${fmtMoney(taxTotal)} tax withheld)` : ""}`
  });

  const finalRound = Object.assign({}, round, { phase: "done", results: results.map(r => r.outcome), netChange: netForTxn });
  await usersCol().doc(username).update({ blackjackRound: null });
  return { ok: true, round: bjClientView(finalRound), netChange: netForTxn };
}

// Strips the shoe (never sent to the client) and hides the dealer's hole
// card until it's actually revealed.
function bjClientView(round) {
  const dealerCards = round.dealer.revealed ? round.dealer.cards : [round.dealer.up];
  return {
    phase: round.phase,
    humanSeat: round.humanSeat,
    botSeats: round.botSeats,
    bots: round.bots,
    dealer: { cards: dealerCards, revealed: round.dealer.revealed, total: round.dealer.revealed ? bjHandValue(round.dealer.cards).total : null },
    insurance: round.insurance,
    hands: round.hands.map(h => ({ cards: h.cards, bet: h.bet, doubled: h.doubled, isSplitAces: h.isSplitAces, status: h.status, total: bjHandValue(h.cards).total })),
    activeHandIndex: round.activeHandIndex,
    results: round.results || null,
    netChange: round.netChange !== undefined ? round.netChange : null
  };
}

// Lets the student resume/see their in-progress round (e.g. after a page
// refresh) without losing the already-escrowed bet.
async function getBlackjackRound(username) {
  const user = await getUser(username);
  if (!user || !user.blackjackRound) return null;
  return bjClientView(user.blackjackRound);
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
      kind: ev.kind === "good" ? "good" : "bad",
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
async function updateBigEventDef(classCode, defId, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.bigEventDefs.find(e => e.id === defId);
    if (!existing) return;
    existing.name = ev.name;
    existing.module = BIG_EVENT_MODULES.includes(ev.module) ? ev.module : "income";
    existing.kind = ev.kind === "good" ? "good" : "bad";
    existing.cost = Math.max(0, Number(ev.cost) || 0);
    existing.description = ev.description || "";
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
// Once per NZ calendar week, each student has a 1-in-4 chance of being hit
// with one random active big event, left "pending" until they respond.
// Bypasses the once-per-week guard and generates this week's big events
// right now — same idea as forceWeeklyEvents. Also skips the normal 25%
// per-student chance, so every eligible student gets one on a manual run
// instead of being left out by the dice roll.
async function forceWeeklyBigEvents(classCode) {
  await classesCol().doc(classCode).update({ lastBigEventWeekRun: null });
  return await processWeeklyBigEvents(classCode, { forceAll: true });
}

async function processWeeklyBigEvents(classCode, opts) {
  const forceAll = !!(opts && opts.forceAll);
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
  // Same guard as processWeeklyEvents: never give a student a second big
  // event for a week they already have one queued for, even on a forced
  // run — otherwise clicking "Run this week's big events now" more than
  // once (double-click, slow-connection retry, etc.) stacks duplicates.
  const alreadyThisWeek = new Set((cls.bigEventLog || []).filter(e => e.week === weekKey).map(e => e.studentUser));
  for (const student of students) {
    if (alreadyThisWeek.has(student.username)) continue;
    if (!forceAll && Math.random() >= 0.25) continue; // 25% chance per student per week (unless a manual run forces it)
    // Only consider events for modules where the student actually has
    // something at stake (a job, a property, or a vehicle) — no point
    // hitting someone with a "lost your job" event if they have no job.
    const eligibleDefs = activeDefs.filter(d => {
      // Good events are windfalls that don't require owning anything —
      // everyone's eligible for a bonus/refund/etc regardless of module.
      if (d.kind === "good") return true;
      if (d.module === "income") return !!student.jobId;
      if (d.module === "property") return cls.properties.some(p => p.owner === student.username);
      if (d.module === "transport") return cls.vehicles.some(v => (v.owners || []).includes(student.username));
      return true;
    });
    if (eligibleDefs.length === 0) continue;
    const def = eligibleDefs[Math.floor(Math.random() * eligibleDefs.length)];
    newEntries.push({
      id: uid("bigevlog"), studentUser: student.username, defId: def.id, week: weekKey, date: nowStr(),
      name: def.name, module: def.module, kind: def.kind || "bad", cost: def.cost, description: def.description || "",
      // Good events need no choice from the student — they're paid out
      // immediately and just get an acknowledgment popup. Bad events stay
      // "pending" until the student picks pay / forfeit / claim.
      status: def.kind === "good" ? "received" : "pending"
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

  // Pay out any good (windfall) events right away — no choice needed.
  const goodEntries = newEntries.filter(e => e.kind === "good");
  for (const e of goodEntries) {
    await adjustBalance(e.studentUser, e.cost);
    await logTxn(classCode, { type: "big-event", to: e.studentUser, amount: e.cost, note: `Big event windfall: "${e.name}"` + (e.description ? " — " + e.description : "") });
  }

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
          const veh = cls.vehicles.find(v => (v.owners || []).includes(username));
          if (veh) veh.owners = veh.owners.filter(o => o !== username);
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
// Wages use marginal tax brackets instead of a single flat rate, same idea
// as real-life progressive income tax: each bracket's rate only applies to
// the slice of the wage that falls within that bracket, not the whole wage.
// Brackets are stored sorted ascending as { upTo, rate }, where upTo is the
// top of that bracket (null/undefined = no upper limit, i.e. the top bracket).
function applyWageTax(cls, wage) {
  const brackets = (cls.wageTaxBrackets || []).slice().sort((a, b) => {
    const aTop = a.upTo == null ? Infinity : a.upTo;
    const bTop = b.upTo == null ? Infinity : b.upTo;
    return aTop - bTop;
  });
  if (!brackets.length || wage <= 0) {
    return { net: Math.round(wage * 100) / 100, taxAmount: 0, rate: 0 };
  }
  let taxAmount = 0;
  let bandFloor = 0;
  for (const b of brackets) {
    const bandTop = b.upTo == null ? Infinity : Number(b.upTo);
    const bandAmount = Math.max(0, Math.min(wage, bandTop) - bandFloor);
    taxAmount += bandAmount * ((Number(b.rate) || 0) / 100);
    bandFloor = bandTop;
    if (wage <= bandTop) break;
  }
  taxAmount = Math.round(taxAmount * 100) / 100;
  const effectiveRate = wage > 0 ? Math.round((taxAmount / wage) * 10000) / 100 : 0;
  return { net: Math.round((wage - taxAmount) * 100) / 100, taxAmount, rate: effectiveRate };
}
async function saveWageTaxBrackets(classCode, brackets) {
  const clean = (brackets || [])
    .map(b => ({
      upTo: (b.upTo === null || b.upTo === "" || b.upTo === undefined) ? null : Math.max(0, Number(b.upTo) || 0),
      rate: Math.max(0, Number(b.rate) || 0)
    }))
    .sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo));
  await classesCol().doc(classCode).update({ wageTaxBrackets: clean });
}

/* ===================== Class defaults for new modules ===================== */
function withNewModuleDefaults(cls) {
  if (!cls) return cls;
  cls.insurancePlans = cls.insurancePlans || [];
  cls.storeItems = cls.storeItems || [];
  cls.storeItems.forEach(it => {
    if (it.stockTotal === undefined) it.stockTotal = it.stock === undefined ? null : it.stock;
    if (it.sold === undefined) it.sold = 0;
  });
  cls.properties = cls.properties || [];
  cls.eventDefs = cls.eventDefs || [];
  cls.eventLog = cls.eventLog || [];
  cls.lastEventWeekRun = cls.lastEventWeekRun || null;
  cls.lastEventDayRun = cls.lastEventDayRun || null;
  cls.termDepositPlans = cls.termDepositPlans || [];
  cls.sideHustles = cls.sideHustles || [];
  cls.lifestyleLock = cls.lifestyleLock || { threshold: 0, modules: [] };
  cls.loanTiers = cls.loanTiers || [];
  cls.maxLoanAmount = cls.maxLoanAmount || 0; // 0 = no extra class-wide cap beyond the tiers themselves
  cls.maxLoanCount = cls.maxLoanCount || 0; // 0 = no cap on how many loans a student can have open at once
  cls.vehicles = cls.vehicles || [];
  // Migrate pre-update vehicles, which stored a single `owner` username,
  // into the current `owners` array so vehicles bought before this change
  // still show up as owned instead of looking unowned.
  cls.vehicles.forEach(v => {
    if (v.owners === undefined) {
      v.owners = v.owner ? [v.owner] : [];
    }
  });
  cls.interestAuto = cls.interestAuto || false;
  cls.cashInterestRate = cls.cashInterestRate || 0;
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
  if (cls.gambling.dailyBetCap === undefined) cls.gambling.dailyBetCap = null;
  cls.blackjack = cls.blackjack || { enabled: true, minBet: 1, maxBet: 20 };
  if (cls.blackjack.enabled === undefined) cls.blackjack.enabled = true;
  if (cls.blackjack.minBet === undefined) cls.blackjack.minBet = 1;
  if (cls.blackjack.maxBet === undefined) cls.blackjack.maxBet = 20;
  cls.taxRates = cls.taxRates || { store: 0, insurance: 0, property: 0, transport: 0, interest: 0, gambling: 0 };
  // Migrate old flat wage rate (if present) into a single bracket the first
  // time a class with legacy data is loaded, so existing tax settings aren't
  // silently lost when brackets are introduced.
  if (!cls.wageTaxBrackets || !cls.wageTaxBrackets.length) {
    const legacyWageRate = cls.taxRates.wage;
    cls.wageTaxBrackets = legacyWageRate ? [{ upTo: null, rate: Number(legacyWageRate) || 0 }] : [];
  }
  delete cls.taxRates.wage;
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
  if (!cls.lifestyleConfig.loan) cls.lifestyleConfig.loan = { enabled: false, perAmount: 0, points: 0 };
  cls.lifestyleThresholds = cls.lifestyleThresholds && cls.lifestyleThresholds.length ? cls.lifestyleThresholds : [
    { min: 0, max: 10, label: "Poor", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 10, max: 20, label: "Modest", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 20, max: 40, label: "Comfortable", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 40, max: 70, label: "Good", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 },
    { min: 70, max: 100, label: "Luxurious", minNetWorth: 0, minPropertyComfort: 0, minTransportComfort: 0 }
  ];
  // Older classes may have bands saved before requirements existed — fill
  // in the new fields so downstream code can rely on them always being set.
  cls.lifestyleThresholds.forEach(t => {
    if (t.minNetWorth === undefined) t.minNetWorth = 0;
    if (t.minPropertyComfort === undefined) t.minPropertyComfort = 0;
    if (t.minTransportComfort === undefined) t.minTransportComfort = 0;
  });
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
      signupFee: Math.max(0, Number(plan.signupFee) || 0),
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
async function editInsurancePlan(classCode, planId, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const idx = cls.insurancePlans.findIndex(p => p.id === planId);
    if (idx === -1) return;
    const existing = cls.insurancePlans[idx];
    cls.insurancePlans[idx] = {
      ...existing,
      name: plan.name, price: Number(plan.price),
      excess: Number(plan.excess), coverage: plan.coverage || "general",
      description: plan.description || "", stars: Math.max(0, Math.min(5, Number(plan.stars) || 0)),
      signupFee: Math.max(0, Number(plan.signupFee) || 0)
    };
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
/* ===================== Side hustles =====================
   Teacher defines a list of side hustle "jobs", each with a payout amount
   per possible check-in hour (0-23, NZ time). A student picks one hustle
   and one hour of the day as their standing check-in time, then must
   check in every day within 15 minutes after that hour to get paid. */
async function addSideHustle(classCode, hustle) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.sideHustles.push({
      id: uid("sh"), name: hustle.name, description: hustle.description || "",
      payouts: hustle.payouts || {}
    });
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}
async function editSideHustle(classCode, hustleId, hustle) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const idx = cls.sideHustles.findIndex(h => h.id === hustleId);
    if (idx === -1) return;
    cls.sideHustles[idx] = {
      ...cls.sideHustles[idx],
      name: hustle.name, description: hustle.description || "", payouts: hustle.payouts || {}
    };
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}
async function removeSideHustle(classCode, hustleId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.sideHustles = cls.sideHustles.filter(h => h.id !== hustleId);
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}

// Student picks (or changes) which hustle + hour they're committing to.
// First-ever pick applies immediately. After that, changes require the
// teacher's approval (this just stops someone quietly retiming their
// check-in to whenever they happen to be checking in).
async function requestSideHustleChange(username, classCode, hustleId, hour) {
  if (await isModuleLockedForStudent(username, classCode, "sidehustle")) {
    return { ok: false, error: "Side hustles are locked for you right now because of your lifestyle rating." };
  }
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  const hustle = (cls.sideHustles || []).find(h => h.id === hustleId);
  if (!hustle) return { ok: false, error: "That side hustle isn't available." };
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: "Pick a valid check-in time." };

  const user = await getUser(username);
  if (!user) return { ok: false, error: "User not found." };

  if (!user.sideHustle || !user.sideHustle.hustleId) {
    // Nothing set yet — no approval needed for the first pick.
    const res = await setStudentSideHustle(username, classCode, hustleId, h);
    return res;
  }

  if (user.sideHustle.hustleId === hustleId && user.sideHustle.checkinHour === h) {
    return { ok: false, error: "That's already your current side hustle." };
  }

  await usersCol().doc(username).update({
    sideHustleRequest: { hustleId, checkinHour: h, status: "pending", requestedAt: nowStr() },
    sideHustleDenialNote: null
  });
  return { ok: true, pending: true };
}

// Internal — actually applies a hustle/hour to a student. Used for the
// first-ever pick and by the teacher when approving a change request.
async function setStudentSideHustle(username, classCode, hustleId, hour) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  const hustle = (cls.sideHustles || []).find(h => h.id === hustleId);
  if (!hustle) return { ok: false, error: "That side hustle isn't available." };
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: "Pick a valid check-in time." };

  const user = await getUser(username);
  if (!user) return { ok: false, error: "User not found." };
  const prev = user.sideHustle || {};
  const sameCommitment = prev.hustleId === hustleId && prev.checkinHour === h;
  await usersCol().doc(username).update({
    sideHustle: {
      hustleId, checkinHour: h,
      lastCheckin: sameCommitment ? (prev.lastCheckin || null) : null,
      streak: sameCommitment ? (prev.streak || 0) : 0
    }
  });
  return { ok: true };
}

// Teacher approves a pending change request — applies it and clears the request.
async function approveSideHustleChange(username, classCode) {
  const user = await getUser(username);
  if (!user || !user.sideHustleRequest || user.sideHustleRequest.status !== "pending") {
    return { ok: false, error: "No pending request." };
  }
  const req = user.sideHustleRequest;
  const res = await setStudentSideHustle(username, classCode, req.hustleId, req.checkinHour);
  if (!res.ok) return res;
  await usersCol().doc(username).update({ sideHustleRequest: null });
  return { ok: true };
}

// Teacher denies a pending change request — leaves the student's current
// hustle/hour untouched, but leaves a note explaining why.
async function denySideHustleChange(username, reason) {
  await usersCol().doc(username).update({
    sideHustleRequest: null,
    sideHustleDenialNote: (reason || "").trim() || "Your teacher denied this change."
  });
  return { ok: true };
}

// Pays out if the student is inside their 15-minute check-in window and
// hasn't already checked in today (NZ calendar day).
async function checkinSideHustle(username, classCode) {
  if (await isModuleLockedForStudent(username, classCode, "sidehustle")) {
    return { ok: false, error: "Side hustles are locked for you right now because of your lifestyle rating." };
  }
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let amount = 0, hustleName = "", streak = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("GONE");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const sh = user.sideHustle;
      if (!sh || !sh.hustleId) throw new Error("NO_HUSTLE");
      const hustle = cls.sideHustles.find(h => h.id === sh.hustleId);
      if (!hustle) throw new Error("NO_HUSTLE");

      const { hour, minute } = nzHourMinute();
      if (hour !== sh.checkinHour || minute > 15) throw new Error("WRONG_TIME");

      const todayKey = nzDateKey();
      if (sh.lastCheckin === todayKey) throw new Error("ALREADY");

      amount = Number(hustle.payouts[sh.checkinHour]) || 0;
      hustleName = hustle.name;
      streak = (sh.streak || 0) + 1;
      const newBal = Math.round((user.balance + amount) * 100) / 100;
      t.update(userRef, {
        balance: newBal,
        "sideHustle.lastCheckin": todayKey,
        "sideHustle.streak": streak
      });
    });
  } catch (e) {
    if (e.message === "NO_HUSTLE") return { ok: false, error: "Pick a side hustle and check-in time first." };
    if (e.message === "WRONG_TIME") return { ok: false, error: "You can only check in within 15 minutes after your chosen time." };
    if (e.message === "ALREADY") return { ok: false, error: "You've already checked in today." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "side-hustle", to: username, amount, note: `Side hustle check-in — ${hustleName}` });
  return { ok: true, amount, streak };
}

async function buyInsurance(username, classCode, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let planName = "";
  let fee = 0;
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
      fee = Math.max(0, Number(plan.signupFee) || 0);
      const isTeacher = user.role === "teacher";
      if (!isTeacher && fee > 0 && user.balance < fee) throw new Error("BROKE");
      planName = plan.name;
      user.insurance.push(planId);
      const update = { insurance: user.insurance };
      if (!isTeacher && fee > 0) update.balance = Math.round((user.balance - fee) * 100) / 100;
      t.update(userRef, update);
    });
  } catch (e) {
    if (e.message === "ALREADY") return { ok: false, error: "You already have this plan." };
    if (e.message === "BROKE") return { ok: false, error: `You don't have enough money to pay the ${fmtMoney(fee)} sign-up fee.` };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (fee > 0) {
    await logTxn(classCode, { type: "insurance-signup-fee", from: username, amount: fee, note: `Sign-up fee for insurance: ${planName}` });
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
    // stockTotal is the "bank" figure the teacher sets; stock is what's
    // actually left to buy right now; sold tracks units bought so far so
    // that a later change to stockTotal (see updateStoreItem) can be
    // applied as "bank total minus what's already gone out the door"
    // instead of blindly overwriting the remaining count.
    const stockTotal = item.stock === "" || item.stock === undefined ? null : Number(item.stock);
    cls.storeItems.push({
      id: uid("item"), name: item.name, price: Number(item.price),
      description: item.description || "", effect: item.effect || "",
      stock: stockTotal, stockTotal, sold: 0,
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
    const newStockTotal = item.stock === "" || item.stock === undefined ? null : Number(item.stock);
    const sold = existing.sold || 0;
    existing.stockTotal = newStockTotal;
    // Re-derive what's left from the new bank total minus units already
    // sold (e.g. bank set to 5, 2 already sold -> 3 left), rather than
    // setting remaining stock straight to the entered number. Floored at
    // 0 in case the teacher lowers the bank below what's already sold.
    existing.stock = newStockTotal === null ? null : Math.max(0, newStockTotal - sold);
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
      item.sold = (item.sold || 0) + 1;
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
// Teacher-only: gift a store item to a student for free, ignoring price
// and stock entirely (even if the item shows 0 left). Doesn't touch the
// item's stock/sold counters, since this is a manual override outside
// the normal buy/sell accounting.
async function giveFreeStoreItem(classCode, username, itemId) {
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
      itemName = item.name;
      user.storeItems = user.storeItems || [];
      user.storeItems.push(itemId);
      t.update(userRef, { storeItems: user.storeItems });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-gift", to: username, amount: 0, note: `Given for free by teacher: ${itemName}` });
  return { ok: true };
}

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
      item.sold = Math.max(0, (item.sold || 0) - 1);
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
async function updateProperty(classCode, propId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const prop = cls.properties.find(p => p.id === propId);
    if (!prop) return;
    prop.name = updates.name;
    prop.price = Number(updates.price);
    prop.comfort = Math.max(1, Math.min(5, Number(updates.comfort) || 1));
    prop.mortgageWeeks = Number(updates.mortgageWeeks) || 0;
    prop.description = updates.description || "";
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
async function updateEventDef(classCode, evId, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.eventDefs.find(e => e.id === evId);
    if (!existing) return;
    const isChoice = ev.type === "choice";
    existing.name = ev.name;
    existing.amount = Number(ev.amount) || 0;
    existing.description = ev.description || "";
    existing.repeatable = !!ev.repeatable;
    existing.severity = ev.severity === "bad" ? "bad" : "neutral";
    existing.type = isChoice ? "choice" : "fixed";
    existing.options = isChoice ? (ev.options || []).map(o => ({ id: uid("opt"), label: o.label || "", amount: Number(o.amount) || 0, outcome: o.outcome || "" })) : [];
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
// Bypasses the once-per-week guard and generates this week's events right
// now — useful if the weekly run already fired earlier (e.g. before any
// event definitions existed, or before a timing fix), so the teacher isn't
// stuck waiting until next Monday for it to try again naturally.
async function forceWeeklyEvents(classCode) {
  // Manual "Run this week's events now" — overrides both the once-a-day
  // auto-run guard and each student's daily/weekly caps below.
  return await processWeeklyEvents(classCode, { ignoreAlreadyHad: true });
}

async function processWeeklyEvents(classCode, opts) {
  const ignoreAlreadyHad = !!(opts && opts.ignoreAlreadyHad); // true only for a manual run
  const classRef = classesCol().doc(classCode);
  const dayKey = nzDateKey();
  const weekKey = isoWeekKey(new Date());
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return 0;

  // The auto-trigger (page load) only ever runs once per NZ calendar day —
  // that's what makes "max 1 event a day" hold without any extra bookkeeping.
  // A manual run skips this guard entirely, which is what lets it override
  // the caps below.
  if (!ignoreAlreadyHad && cls.lastEventDayRun === dayKey) return 0;
  if (!cls.eventDefs || cls.eventDefs.filter(e => e.active).length === 0) {
    if (!ignoreAlreadyHad) await classRef.update({ lastEventDayRun: dayKey }).catch(() => {});
    return 0;
  }

  let claimed = true;
  if (!ignoreAlreadyHad) {
    claimed = false;
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) return;
      const liveCls = withNewModuleDefaults(snap.data());
      if (liveCls.lastEventDayRun === dayKey) return;
      t.update(classRef, { lastEventDayRun: dayKey });
      claimed = true;
    });
    if (!claimed) return 0;
  }

  const students = await getClassStudents(classCode);
  const activeDefs = cls.eventDefs.filter(e => e.active);
  const eventLog = cls.eventLog || [];
  const newLogEntries = [];

  // Each qualifying student gets exactly 1 event per run, revealed within
  // ~20 minutes.
  const FIRST_EVENT_MAX_DELAY_MS = 20 * 60000;      // first ever event: within 20 min

  for (const student of students) {
    const studentEntries = eventLog.filter(l => l.studentUser === student.username);

    if (!ignoreAlreadyHad) {
      // Max 1 event per day...
      const hadToday = studentEntries.some(l => l.day === dayKey);
      if (hadToday) continue;
      // ...and max 3 events per week.
      const weekCount = studentEntries.filter(l => l.week === weekKey).length;
      if (weekCount >= 3) continue;
    }

    const already = new Set(studentEntries.map(l => l.eventId));
    // Whatever event this student was assigned most recently (regardless
    // of week) is excluded from this draw even if it's marked "repeatable"
    // — repeatable just means it can come back around later, not that the
    // same event can land twice in a row. A manual/forced run overrides
    // this too, otherwise a class with only one active event (or a student
    // whose only eligible event was their last one) would silently get
    // nothing at all, even on an explicit "override" run.
    const lastEventId = studentEntries.length ? studentEntries[studentEntries.length - 1].eventId : null;
    const pool = activeDefs.filter(e => ignoreAlreadyHad || (e.id !== lastEventId && (e.repeatable || !already.has(e.id))));
    if (pool.length === 0) continue;
    const ev = pool[Math.floor(Math.random() * pool.length)];
    const revealAt = Date.now() + Math.floor(Math.random() * FIRST_EVENT_MAX_DELAY_MS);
    if (ev.type === "choice") {
      // Multiple-choice events don't apply a balance change yet — the
      // student must pick one of the options first (see resolveChoiceEvent).
      newLogEntries.push({
        id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), day: dayKey, week: weekKey, revealAt,
        name: ev.name, amount: null, description: ev.description || "", severity: ev.severity || "neutral",
        claimed: false, type: "choice", options: ev.options || [], status: "pending"
      });
    } else {
      // Fixed-amount events used to apply the balance change and log a
      // txn right here, at generation time — long before the student
      // ever saw a popup explaining why. That meant balances could
      // silently jump by several events' worth all at once. Now this
      // just schedules it; the actual balance change + txn only happens
      // in revealFixedEvent(), which is called the moment the popup is
      // about to be shown to the student (see checkWeeklyEventPopup).
      newLogEntries.push({
        id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), day: dayKey, week: weekKey, revealAt,
        name: ev.name, amount: ev.amount, description: ev.description || "", severity: ev.severity || "neutral",
        claimed: false, type: "fixed", status: "scheduled"
      });
    }
  }

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

// Applies a scheduled fixed-amount event's balance change and logs its txn
// — called the moment its popup is about to be shown to the student (see
// checkWeeklyEventPopup in events-ui.js), never before. This is what makes
// sure a student's balance can't change "silently" ahead of them actually
// seeing what happened and why. Safe to call more than once (e.g. two tabs
// racing) — the transaction only acts on it while status is still
// "scheduled", so a second call is a no-op.
async function revealFixedEvent(classCode, eventLogId) {
  const classRef = classesCol().doc(classCode);
  let entry = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    const found = (liveCls.eventLog || []).find(l => l.id === eventLogId);
    if (!found || found.type !== "fixed" || found.status !== "scheduled") return;
    found.status = "resolved";
    entry = { ...found };
    t.update(classRef, { eventLog: liveCls.eventLog });
  });
  if (!entry) return null;
  await adjustBalance(entry.studentUser, entry.amount);
  await logTxn(classCode, { type: "event", to: entry.studentUser, amount: entry.amount, note: entry.name + (entry.description ? " — " + entry.description : "") });
  return entry;
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
  let amount = 0, note = "", outcome = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.eventLog || []).find(e => e.id === logId && e.studentUser === username && e.status === "pending");
      if (!entry) throw new Error("NOT_FOUND");
      let option = (entry.options || []).find(o => o.id === optionId);
      if (!option) throw new Error("NOT_FOUND");

      // The entry's options are a snapshot taken when it was assigned —
      // if the teacher has since fixed/edited the event definition (e.g.
      // correcting an amount that had been saved as 0), that snapshot is
      // stale. Prefer the live definition's amount for this option when
      // we can confidently match it up (by id, or failing that by label),
      // so a teacher's fix actually takes effect for events already
      // sitting in a student's queue instead of only future assignments.
      const liveDef = (cls.eventDefs || []).find(d => d.id === entry.eventId);
      if (liveDef && liveDef.options) {
        const liveOption = liveDef.options.find(o => o.id === option.id)
          || liveDef.options.find(o => o.label.trim().toLowerCase() === option.label.trim().toLowerCase());
        if (liveOption) option = liveOption;
      }

      amount = option.amount;
      outcome = option.outcome || "";
      entry.status = "resolved";
      entry.chosenOptionId = optionId;
      entry.amount = amount;
      entry.outcome = outcome;
      note = `${entry.name} — chose "${option.label}"` + (option.outcome ? `: ${option.outcome}` : "");
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + amount) * 100) / 100 });
      t.update(classRef, { eventLog: cls.eventLog });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "event", to: username, amount, note });
  return { ok: true, amount, outcome };
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
  const vehicles = cls.vehicles.filter(v => (v.owners || []).includes(username));
  const vehicle = vehicles.reduce((best, v) => (!best || v.comfort > best.comfort) ? v : best, null);
  const storeItems = (user.storeItems || []).map(id => cls.storeItems.find(i => i.id === id)).filter(Boolean)
    .map(i => ({ ...i }));
  const insurance = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).filter(Boolean);
  return { property, vehicle, vehicles, storeItems, insurance };
}

/* ===================== Lifestyle rating ===================== */
async function saveLifestyleConfig(classCode, config) {
  await classesCol().doc(classCode).update({ lifestyleConfig: config });
}
// thresholds: array of { min, max, label, minNetWorth, minPropertyComfort,
// minTransportComfort }, sorted low to high, describing named bands for the
// uncapped (0+) lifestyle score (e.g. Poor 0-10, Good 10-20). The top band's
// `max` is just where its own editable range stops — any score at or above
// it still qualifies (see lifestyleLabelFor below), so the highest band
// effectively has no ceiling. The min* fields are
// optional extra requirements a student must meet to actually be shown that
// band, even if their score alone would qualify — e.g. a "Luxurious" band
// might require a net worth of at least $500 and a property with a comfort
// rating of at least 4, so a student can't reach it on store items alone.
// A value of 0 means "no requirement" for that field.
async function saveLifestyleThresholds(classCode, thresholds) {
  const clean = thresholds
    .map(t => ({
      min: Math.max(0, Number(t.min) || 0), // uncapped — score can exceed 100
      max: Math.max(0, Number(t.max) || 0), // uncapped — score can exceed 100
      label: (t.label || "").trim() || "Untitled",
      minNetWorth: Math.max(0, Number(t.minNetWorth) || 0),
      minPropertyComfort: Math.max(0, Math.min(5, Number(t.minPropertyComfort) || 0)),
      minTransportComfort: Math.max(0, Math.min(5, Number(t.minTransportComfort) || 0))
    }))
    .sort((a, b) => a.min - b.min);
  await classesCol().doc(classCode).update({ lifestyleThresholds: clean });
}
// Does a student meet a given band's extra requirements? `stats` is
// optional — omit it (or pass nothing) to check score-range membership
// only, which keeps this backward compatible with any existing callers
// that only ever dealt with the score.
function bandRequirementsMet(band, stats) {
  if (!stats) return true;
  if (band.minNetWorth && (stats.netWorth || 0) < band.minNetWorth) return false;
  if (band.minPropertyComfort && (stats.propertyComfort || 0) < band.minPropertyComfort) return false;
  if (band.minTransportComfort && (stats.transportComfort || 0) < band.minTransportComfort) return false;
  return true;
}
// Finds the label for an uncapped (0+) score. If `stats` is passed (netWorth,
// propertyComfort, transportComfort), a band whose extra requirements
// aren't met is skipped in favour of the next band down that the student
// does qualify for, so a high score alone can't skip requirements — see
// lifestyleBandForStudent, which builds `stats` for you.
function lifestyleLabelFor(score, thresholds, stats) {
  if (!thresholds || thresholds.length === 0) return "";
  let targetIndex = thresholds.findIndex(t => score >= t.min && score < t.max);
  if (targetIndex === -1) {
    const last = thresholds[thresholds.length - 1];
    if (score >= last.max) targetIndex = thresholds.length - 1;
  }
  if (targetIndex === -1) return "";
  for (let i = targetIndex; i >= 0; i--) {
    if (bandRequirementsMet(thresholds[i], stats)) return thresholds[i].label;
  }
  return "";
}
// Convenience wrapper: works out a student's lifestyle score AND the extra
// stats (net worth, owned property/vehicle comfort) needed to enforce band
// requirements, then returns the label they actually qualify for.
async function lifestyleBandForStudent(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return "";
  const score = await lifestyleRating(username, classCode);
  const board = await classLeaderboard(classCode);
  const row = board.find(r => r.username === username);
  const property = (cls.properties || []).find(p => p.owner === username);
  const vehicle = (cls.vehicles || []).filter(v => (v.owners || []).includes(username))
    .reduce((best, v) => (!best || v.comfort > best.comfort) ? v : best, null);
  const stats = {
    netWorth: row ? row.net : 0,
    propertyComfort: property ? (property.comfort || 0) : 0,
    transportComfort: vehicle ? (vehicle.comfort || 0) : 0
  };
  return lifestyleLabelFor(score, cls.lifestyleThresholds, stats);
}
// Pure calculation, no fetching — split out of lifestyleRating() so callers
// that already have `cls`/`user` in hand (e.g. startBlackjackRound, which
// needs both anyway regardless of lock status) can compute a rating without
// triggering their own extra getClass()/getUser() reads. lifestyleRating()
// below is unchanged in behavior for every existing caller.
function lifestyleRatingFromData(cls, user, username) {
  if (!cls || !user) return 0;
  if (user.lifestyleOverride !== undefined && user.lifestyleOverride !== null) {
    // Uncapped — a teacher override can be set to any non-negative score,
    // it just can't go negative.
    return Math.max(0, Math.round(Number(user.lifestyleOverride) || 0));
  }
  const cfg = cls.lifestyleConfig;
  let score = 0;

  if (cfg.property && cfg.property.enabled) {
    const owned = cls.properties.find(p => p.owner === username);
    if (owned) score += owned.comfort * (cfg.property.weight || 0);
  }
  if (cfg.transport && cfg.transport.enabled) {
    const owned = cls.vehicles.filter(v => (v.owners || []).includes(username))
      .reduce((best, v) => (!best || v.comfort > best.comfort) ? v : best, null);
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
  if (cfg.loan && cfg.loan.enabled && cfg.loan.perAmount > 0 && cfg.loan.points > 0) {
    const owedTotal = (user.loans || [])
      .filter(l => l.status === "active")
      .reduce((sum, l) => sum + l.owed, 0);
    score -= Math.floor(owedTotal / cfg.loan.perAmount) * cfg.loan.points;
  }
  // Uncapped — a student's computed score can grow without limit as they
  // accumulate property/transport/store/insurance comfort, it just can't
  // go negative.
  return Math.max(0, Math.round(score));
}
async function lifestyleRating(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  return lifestyleRatingFromData(cls, user, username);
}
// Same computation as lifestyleRating(), but returns the itemised list of
// what's adding to (or subtracting from) the score instead of just the
// final number — powers the student-facing "why is my score X" popup.
async function lifestyleRatingBreakdown(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return { items: [], total: 0, overridden: false };
  if (user.lifestyleOverride !== undefined && user.lifestyleOverride !== null) {
    return { items: [], total: Math.max(0, Math.round(Number(user.lifestyleOverride) || 0)), overridden: true };
  }
  const cfg = cls.lifestyleConfig;
  const items = [];
  let score = 0;

  if (cfg.property && cfg.property.enabled) {
    const owned = cls.properties.find(p => p.owner === username);
    if (owned) {
      const pts = owned.comfort * (cfg.property.weight || 0);
      score += pts;
      items.push({ type: "gain", label: owned.name || "Property", detail: `${owned.comfort} comfort &times; ${cfg.property.weight || 0} pts/star`, points: pts });
    }
  }
  if (cfg.transport && cfg.transport.enabled) {
    const owned = cls.vehicles.filter(v => (v.owners || []).includes(username))
      .reduce((best, v) => (!best || v.comfort > best.comfort) ? v : best, null);
    if (owned) {
      const pts = owned.comfort * (cfg.transport.weight || 0);
      score += pts;
      items.push({ type: "gain", label: owned.name || "Vehicle", detail: `${owned.comfort} comfort &times; ${cfg.transport.weight || 0} pts/star`, points: pts });
    }
  }
  if (cfg.store && cfg.store.enabled) {
    const owned = user.storeItems || [];
    owned.forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item) {
        const pts = (item.stars || 0) * (cfg.store.weight || 0);
        score += pts;
        items.push({ type: "gain", label: item.name, detail: `${item.stars || 0}★ &times; ${cfg.store.weight || 0} pts/star`, points: pts });
      }
    });
  }
  if (cfg.insurance && cfg.insurance.enabled) {
    const owned = user.insurance || [];
    owned.forEach(planId => {
      const plan = cls.insurancePlans.find(p => p.id === planId);
      if (plan) {
        const pts = (plan.stars || 0) * (cfg.insurance.weight || 0);
        score += pts;
        items.push({ type: "gain", label: plan.name, detail: `${plan.stars || 0}★ &times; ${cfg.insurance.weight || 0} pts/star`, points: pts });
      }
    });
  }
  if (cfg.loan && cfg.loan.enabled && cfg.loan.perAmount > 0 && cfg.loan.points > 0) {
    const owedTotal = (user.loans || [])
      .filter(l => l.status === "active")
      .reduce((sum, l) => sum + l.owed, 0);
    const penalty = Math.floor(owedTotal / cfg.loan.perAmount) * cfg.loan.points;
    if (penalty > 0) {
      score -= penalty;
      items.push({ type: "loss", label: "Outstanding loans", detail: `${fmtMoney(owedTotal)} owed &middot; ${cfg.loan.points} pt${cfg.loan.points === 1 ? "" : "s"} per ${fmtMoney(cfg.loan.perAmount)} owed`, points: penalty });
    }
  }

  return { items, total: Math.max(0, Math.round(score)), overridden: false };
}
// Teacher-set lifestyle score that overrides the computed one entirely —
// the student can't move it by buying/selling anything while it's active.
async function setLifestyleOverride(username, score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number 0 or greater." };
  const clamped = Math.max(0, Math.round(n));
  await usersCol().doc(username).update({ lifestyleOverride: clamped });
  return { ok: true };
}
async function clearLifestyleOverride(username) {
  await usersCol().doc(username).update({ lifestyleOverride: null });
  return { ok: true };
}

// Registry of modules that can be locked by lifestyle rating. "key" must
// match what each module's own page passes to isModuleLockedForStudent.
const LIFESTYLE_LOCKABLE_MODULES = [
  { key: "bank", label: "Bank" },
  { key: "termdeposit", label: "Term Deposit" },
  { key: "loan", label: "Loans" },
  { key: "market", label: "Stock Market" },
  { key: "store", label: "Store" },
  { key: "jobs", label: "Jobs" },
  { key: "transport", label: "Transport" },
  { key: "property", label: "Property" },
  { key: "insurance", label: "Insurance" },
  { key: "tax", label: "Tax" },
  { key: "bigevents", label: "Big Events" },
  { key: "gambling", label: "Gambling" },
  { key: "sidehustle", label: "Side hustle" }
];

async function saveLifestyleLock(classCode, threshold, modules) {
  const clean = {
    // Uncapped to match the now-uncapped lifestyle score — a teacher may
    // need a lock threshold above 100 once scores commonly run higher.
    threshold: Math.max(0, Math.round(Number(threshold) || 0)),
    modules: (modules || []).filter(k => LIFESTYLE_LOCKABLE_MODULES.some(m => m.key === k))
  };
  await classesCol().doc(classCode).update({ lifestyleLock: clean });
  return clean;
}

// Which modules are currently locked for this student (empty array if none).
// Pure version of the lock check, for callers that already have `cls` and
// `user` loaded (see lifestyleRatingFromData above for why). Mirrors
// getLockedModulesForStudent()'s logic exactly, just without fetching.
function getLockedModulesForStudentFromData(cls, user, username) {
  const lock = cls.lifestyleLock;
  if (!lock || !lock.modules || lock.modules.length === 0) return [];
  const score = lifestyleRatingFromData(cls, user, username);
  if (score > lock.threshold) return [];
  return lock.modules;
}
function isModuleLockedForStudentFromData(cls, user, username, moduleKey) {
  return getLockedModulesForStudentFromData(cls, user, username).includes(moduleKey);
}
async function getLockedModulesForStudent(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  // Keep the original short-circuit: most classes don't use a lifestyle
  // lock at all, so avoid the extra getUser() read whenever there's
  // nothing configured to check against.
  const lock = cls.lifestyleLock;
  if (!lock || !lock.modules || lock.modules.length === 0) return [];
  const user = await getUser(username);
  return getLockedModulesForStudentFromData(cls, user, username);
}
async function isModuleLockedForStudent(username, classCode, moduleKey) {
  const locked = await getLockedModulesForStudent(username, classCode);
  return locked.includes(moduleKey);
}

// Shared across every page's topbar: greys out nav links to locked
// modules and blocks navigating to them. Pages just need
// nav a[data-module="key"] attributes matching LIFESTYLE_LOCKABLE_MODULES.
function applyNavModuleLocks(lockedModules) {
  document.querySelectorAll("nav a[data-module]").forEach(a => {
    const key = a.dataset.module;
    const isLocked = (lockedModules || []).includes(key);
    a.classList.toggle("nav-locked", isLocked);
    if (isLocked) {
      a.onclick = (e) => {
        e.preventDefault();
        alert("This module is locked because your lifestyle rating is too low right now. Check with your teacher about what's needed to unlock it.");
      };
    } else {
      a.onclick = null;
    }
  });
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

const ANW_BALANCE_POLL_MS = 10000;

/* ---------------- Balance widget poll pause/resume ----------------
   The 10s poll needs to actually stop (not just skip its fetch) while:
     - the tab is hidden/backgrounded (handled automatically below via the
       Page Visibility API — no other file needs to call anything for this)
     - a popup (gambling result, weekly event, etc.) is open on screen
     - the student is on the Blackjack table

   Other pages/modules call these two functions to pause/resume the poll,
   passing a short string identifying WHY (so unrelated pauses can't step
   on each other and accidentally resume the poll too early):

     anwBalancePoll.pause("gambling-popup");   // when a popup opens
     anwBalancePoll.resume("gambling-popup");  // when that popup closes

     anwBalancePoll.pause("blackjack-table");  // when the BJ table mounts
     anwBalancePoll.resume("blackjack-table"); // when the BJ table unmounts

   Multiple reasons can be active at once (e.g. tab hidden AND a popup
   open) — the poll only actually resumes once every reason is cleared.
   Calling pause()/resume() with the same reason twice in a row is safe
   (pause is idempotent, resume on a reason that isn't active is a no-op).
==================================================================== */
const _anwPollPauseReasons = new Set();
let _anwPollTimer = null;
let _anwPollRefreshFn = null;

function _anwPollStart() {
  if (_anwPollTimer || !_anwPollRefreshFn) return; // already running, or not mounted yet
  _anwPollTimer = setInterval(_anwPollRefreshFn, ANW_BALANCE_POLL_MS);
}
function _anwPollStop() {
  if (!_anwPollTimer) return;
  clearInterval(_anwPollTimer);
  _anwPollTimer = null;
}
function _anwPollSync() {
  if (_anwPollPauseReasons.size > 0) _anwPollStop();
  else _anwPollStart();
}

window.anwBalancePoll = {
  pause(reason) {
    if (!reason) return;
    const wasIdle = _anwPollPauseReasons.size === 0;
    _anwPollPauseReasons.add(reason);
    if (wasIdle) _anwPollSync();
  },
  resume(reason) {
    if (!reason) return;
    _anwPollPauseReasons.delete(reason);
    if (_anwPollPauseReasons.size === 0) {
      _anwPollSync();
      if (_anwPollRefreshFn) _anwPollRefreshFn(); // catch up immediately instead of waiting up to 10s
    }
  },
  isPaused() { return _anwPollPauseReasons.size > 0; },
  activeReasons() { return [..._anwPollPauseReasons]; }
};

// Page Visibility API — this is the actual mechanism that stops the timer
// when the tab is backgrounded or the user switches away. Browsers already
// throttle/clamp setInterval in background tabs, but clearInterval here
// makes the "stopped" behavior explicit and verifiable rather than relying
// on browser throttling, which varies (and can still fire, just slower).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.anwBalancePoll.pause("tab-hidden");
  else window.anwBalancePoll.resume("tab-hidden");
});

/* ---------------- Automatic popup / Blackjack-table detection ----------------
   Rather than threading anwBalancePoll.pause()/resume() calls through every
   individual popup-showing function (and the Blackjack table's own
   show/hide code) — easy to miss a spot, or to leave the poll stuck paused
   if some error path closes a popup without going through its normal close
   handler — this watches the actual DOM state directly:

     - ANY element with class "anw-modal-overlay" present on the page =>
       paused. Every popup in this app uses that same class: the weekly
       event popup, the choice-event modal, the bonus/fine adjustment
       popup, both big-event modals (events-ui.js), and the roulette wheel
       spin overlay (gambling.js) — so this one check covers all of them,
       and any new popup added later that follows the same convention,
       without touching those files.
     - #bjTableArea visible (missing the "hidden" class) => paused. This
       is the Blackjack table container in gambling.js; it only exists in
       the DOM on the gambling page.

   A MutationObserver re-checks both after every relevant DOM change, so
   the paused state can never drift out of sync with what's actually on
   screen — if in doubt, it re-derives from the DOM rather than trusting
   a remembered flag. */
function _anwSyncDomPauseState() {
  const popupOpen = !!document.querySelector(".anw-modal-overlay");
  if (popupOpen) window.anwBalancePoll.pause("popup");
  else window.anwBalancePoll.resume("popup");

  const bjTable = document.getElementById("bjTableArea");
  const bjVisible = !!bjTable && !bjTable.classList.contains("hidden");
  if (bjVisible) window.anwBalancePoll.pause("blackjack-table");
  else window.anwBalancePoll.resume("blackjack-table");
}

async function mountBalanceWidget(username) {
  if (document.getElementById("anwBalanceWidget")) return;
  const box = document.createElement("div");
  box.id = "anwBalanceWidget";
  box.className = "anw-balance-widget";
  box.innerHTML = `
    <div class="anw-bw-label">${icon("piggy", 14)} Cash balance</div>
    <div class="anw-bw-value" id="anwBalanceWidgetValue">—</div>
  `;
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
  // Started/stopped via anwBalancePoll so it can be paused for popups,
  // the Blackjack table, and backgrounded tabs (see block above).
  _anwPollRefreshFn = refresh;
  if (document.hidden) _anwPollPauseReasons.add("tab-hidden"); // page loaded already-hidden (rare, but possible)
  _anwPollSync();

  // Watch for popups / the Blackjack table opening or closing anywhere on
  // the page (see _anwSyncDomPauseState above). Scoped to widget mount so
  // teacher pages (no widget) don't pay for a MutationObserver they'd
  // never benefit from.
  _anwSyncDomPauseState(); // pick up anything already on screen (e.g. a forced modal from page load)
  new MutationObserver(_anwSyncDomPauseState).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class"]
  });
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