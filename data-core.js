/* ===================== The 29 World — data layer: core =====================
   The data layer used to be one very large data.js. It is now five files,
   split by topic, which every page loads in this order (all `defer`):

     data-core.js      — this file. Helpers, the server clock, reading and
                         caching docs, login/signup/sessions, the daily time
                         limit, classes and templates, change password,
                         moving money (logTxn/transferMoney), removing a
                         student, class defaults, loading/error messages and
                         the start-up code every page runs.
     data-money.js     — wages, savings, loans, automatic payments, term
                         deposits, interest, net worth/leaderboard, reports,
                         tax, the budgeting tool, savings goals, parent view.
     data-life.js      — jobs, transport, insurance, side hustles, the class
                         store, the Life module, random and big events, the
                         lifestyle rating (and module locks), quizzes.
     data-property.js  — property, mortgages, rentals.
     data-markets.js   — the stock market, the Trade Centre, gambling.

   They are still one program: everything declared in one file can be used
   from any other once the page has loaded. The one rule to keep: code that
   RUNS while a file is loading (not inside a function) may only use things
   from the same file or an earlier one.

   Everything is stored in Firestore (collections "users" and "classes") so
   multiple devices share the same live data. These files depend on
   firebase-init.js (must load before them).

   IMPORTANT: almost every function here is ASYNC and returns a Promise.
   Callers must use `await`.
====================================================================== */

const SESSION_KEY = "anw_session"; // session stays in localStorage — it's fine for this to be per-device
const MAX_STORED_TXNS = 250; // keep class docs from growing forever
// `automations` (student-set-up recurring payments, see addAutomation/
// addSavingsAutomation below) lives on the shared /classes/{code} doc and
// is walked in full by processAutomations() on every page load for every
// student in the class — unlike txns/listings/report archives, it had no
// cap at all. Capped PER STUDENT (not class-wide like MAX_STORED_TXNS/
// MAX_STORED_LISTINGS) since the risk here is one student spamming the
// "add automatic payment" form, not the class's collective usage over
// time; 20 recurring payments is already far more than any real student
// budget needs.
const MAX_AUTOMATIONS_PER_STUDENT = 20;

// Sentinel `toUser` value marking a teacher's automatic payment as "pay
// every current student the same amount" rather than one specific person.
// Stored as a single automation record (not one copy per student), so it
// automatically covers whoever is enrolled on the day it actually runs —
// including students who join after it was set up. Shared with bank.js,
// which is the only other file that needs to know this string (to offer it
// as a "Pay to" option and to label it in the automatic-payments list).
const AUTOPAY_ALL_STUDENTS = "__ALL__";

// Shared HTML-escaping helper. The data-*.js files load before every other The 29
// World script on every page, so this is available globally as soon as
// any page script runs. ALWAYS wrap user-supplied strings (student/teacher
// display names, job titles, event/property/vehicle/store item names,
// notes, etc.) in this before inserting them via innerHTML. Escaping at
// render time (rather than sanitizing at write time) is the deliberate
// choice here: it's the single place that actually prevents the browser
// from parsing user text as markup, it can't be bypassed by a new
// call site that writes data some other way, and it avoids double-encoding
// data that's read back out for editing.
function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For the very common `onclick="doThing('${...}')"` pattern: a raw name
// dropped into that spot is TWO separate injection contexts at once (the
// double-quoted HTML attribute, and the single-quoted JS string literal
// inside it), and escapeHtml() alone doesn't close the JS one — the browser
// HTML-decodes the attribute value (turning our escaped "&#39;" back into
// an actual "'") before handing it to the JS parser, so a name containing
// a quote can still break out of the inline string. Escape the JS layer
// first (so a real quote never reaches the JS parser even after HTML
// decoding), then escape the HTML layer on top of that.
function escapeJsAttr(s) {
  const jsSafe = String(s === undefined || s === null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  return escapeHtml(jsSafe);
}

// Defense-in-depth for the handful of writes that create brand-new
// user-supplied text (a student's name at signup, a teacher's class name,
// a job title). escapeHtml() at render time is the fix that actually
// stops the browser from running this as HTML — this is a second,
// independent layer so that even if some future page forgets to escape a
// name before dropping it into innerHTML, there's nothing dangerous
// sitting in Firestore for it to forget to escape in the first place.
//
// Deliberately just strips the two characters that can open/close an HTML
// tag (`<` and `>`) rather than HTML-entity-encoding them: encoding here
// would store literal "&amp;" etc., which then shows up wrong everywhere
// this name is ever displayed (including this file's own admin views) —
// escaping belongs at render time, not at rest. Also trims and caps
// length so one long paste can't bloat a class doc.
function sanitizeUserText(s, maxLen) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen || 60);
}

// Puts a message in a box and clears it again after about 3 seconds. For
// messages shown straight after a render() (which rebuilds the box), so
// they don't vanish the instant they appear. A newer message put in the
// same box in the meantime is left alone.
function flashMsg(el, html, ms) {
  if (!el) return;
  const token = String(Date.now()) + Math.random();
  el.innerHTML = html;
  el.dataset.flash = token;
  setTimeout(() => { if (el.dataset.flash === token) el.innerHTML = ""; }, ms || 3000);
}

function usersCol() { installReadCache(); return fdb.collection("users"); }
function classesCol() { installReadCache(); return fdb.collection("classes"); }

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
  // Sign goes in front of the "$" ("-$5.00", not "$-5.00").
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Turns a typed-in amount into a whole number of cents' worth of dollars,
// or NaN if it isn't a real number. Callers then check `!(amount > 0)`,
// which also rejects NaN — a plain `amount <= 0` lets NaN straight through
// (every comparison with NaN is false) and it ends up stored as a balance.
function cleanAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function nowStr() {
  return trustedNow().toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" });
}

/* ---------------- Server-trusted clock ----------------
   BUGFIX: every "has this already run today?" check below (pay day,
   automatic payments, interest, term deposits...) used to read the
   VISITING DEVICE's own clock via `new Date()`. That's fine as long as
   every device's clock is right, but a shared classroom Chromebook with a
   dead backup battery (or any device whose date/time is just wrong) can
   report a "today" that doesn't match everyone else's — so on that one
   device, an automatic payment that already ran today looks like it
   hasn't, and it fires again. Repeated across a school day as a device
   sleeps and wakes and its clock drifts, that's what produced the same
   automatic payment going through many times in one real day.

   Firestore's serverTimestamp() sentinel is resolved by Google's servers,
   not the device asking for it, so writing it and reading the resolved
   value back gives one trustworthy instant per page load, independent of
   whatever the local clock says. We measure the gap between that and the
   device's own Date.now() once (syncServerClock, called from each page's
   init() before any day-gated job runs), then apply the same gap to
   every trustedNow() call for the rest of the session, so this doesn't
   need a network round trip per check. If the sync can't complete
   (offline, or the write is rejected), we fall back to the device's own
   clock — exactly today's behaviour — rather than blocking the page. */
let SERVER_CLOCK_OFFSET_MS = 0;
let SERVER_CLOCK_SYNCED = false;
// PERF FIX: this app is many separate pages, so "once per session" used to
// mean once per PAGE LOAD — a write to the shared class doc plus a forced
// server read every time anyone clicked to another page. Besides the two
// round trips, that write bumped the class doc under every other student's
// in-flight transaction (logTxn, buying, selling...), forcing those to
// retry. The measured offset is now kept for this tab for 10 minutes;
// short enough that a device clock jumping (sleep/wake) is caught quickly.
const CLOCK_OFFSET_KEY = "t29_clock_offset";
const CLOCK_OFFSET_TTL_MS = 10 * 60000;
async function syncServerClock(classCode) {
  if (SERVER_CLOCK_SYNCED || !classCode) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(CLOCK_OFFSET_KEY) || "null");
    if (saved && Number.isFinite(saved.offset) && Math.abs(Date.now() - saved.at) < CLOCK_OFFSET_TTL_MS) {
      SERVER_CLOCK_OFFSET_MS = saved.offset;
      SERVER_CLOCK_SYNCED = true;
      return;
    }
  } catch (e) { /* no storage — measure below */ }
  try {
    const ref = classesCol().doc(classCode);
    const sentAt = Date.now();
    await ref.set({ _clockProbe: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const snap = await ref.get({ source: "server" });
    const probe = snap.data() && snap.data()._clockProbe;
    if (probe && typeof probe.toMillis === "function") {
      const receivedAt = Date.now();
      // The server timestamp was resolved somewhere during that round
      // trip — splitting the difference is closer than assuming either
      // endpoint.
      const roundTripMidpoint = sentAt + (receivedAt - sentAt) / 2;
      SERVER_CLOCK_OFFSET_MS = probe.toMillis() - roundTripMidpoint;
      try {
        sessionStorage.setItem(CLOCK_OFFSET_KEY, JSON.stringify({ offset: SERVER_CLOCK_OFFSET_MS, at: Date.now() }));
      } catch (e) { /* storage unavailable — just re-measure next page */ }
    }
  } catch (e) {
    SERVER_CLOCK_OFFSET_MS = 0; // offline, or the write was rejected — fall back to the device clock
  }
  SERVER_CLOCK_SYNCED = true;
}
// The current instant, corrected by the offset measured above. Behaves
// exactly like `new Date()` (i.e. no correction) until syncServerClock()
// has run at least once this session.
function trustedNow() { return new Date(Date.now() + SERVER_CLOCK_OFFSET_MS); }

/* ---------------- New Zealand game-clock helpers ----------------
   Everything that depends on "what day/date is it" (pay day, automations,
   mortgages, interest, term deposits, random events) reads NZ wall-clock
   time, not the visiting device's local time zone — and, since the
   BUGFIX above, the server-corrected clock rather than the device's own
   idea of "now". */
function nzParts(d) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  const map = {};
  fmt.formatToParts(d || trustedNow()).forEach(p => { map[p.type] = p.value; });
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
  fmt.formatToParts(d || trustedNow()).forEach(p => { map[p.type] = p.value; });
  return { hour: Number(map.hour), minute: Number(map.minute) };
}
// The real moment (ms since 1970) that an NZ wall-clock time happens on an
// NZ date, e.g. 8:30am (510 minutes) on "2026-10-12". NZ is UTC+12 in
// winter and UTC+13 in summer, so this starts from +12 and corrects by
// however far the NZ clock actually reads off — done twice in case the
// first guess lands on the other side of a daylight saving change.
function nzTimeToMs(dateKey, minutesOfDay) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  let ms = target - 12 * 3600000;
  for (let i = 0; i < 2; i++) {
    const at = new Date(ms);
    const p = nzParts(at), hm = nzHourMinute(at);
    ms += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hm.hour, hm.minute);
  }
  return ms;
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
   Promise.all (payDayForClassIfDue/payMyWageIfDue, processAutomations,
   processTermDeposits, applyMyInterestIfDue/applyInterestToClassIfDue,
   processInsurancePayments,
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
    // .finally() makes a second promise that fails whenever the fetch
    // does — the caller handles the failure on `p` itself, so this copy
    // must be silenced or it reports a stray "unhandled" error.
    p.finally(() => {
      if (map.get(key) === p) map.delete(key);
    }).catch(() => {});
  }
  return p;
}

async function getUser(username) {
  if (!username) return null;
  await T29_AUTH_READY; // firestore.rules requires request.auth != null
  const data = await _sharedFetch(_inFlightUserFetch, username, () =>
    usersCol().doc(username).get().then(snap => snap.exists ? snap.data() : null)
  );
  return _cloneDoc(data);
}
async function getClass(code) {
  if (!code) return null;
  await T29_AUTH_READY; // firestore.rules requires request.auth != null
  const data = await _sharedFetch(_inFlightClassFetch, code, () =>
    classesCol().doc(code).get().then(snap => snap.exists ? withNewModuleDefaults(snap.data()) : null)
  );
  return _cloneDoc(data);
}
async function getClassStudents(code, precomputedCls) {
  const cls = precomputedCls || await getClass(code);
  if (!cls || !cls.students || cls.students.length === 0) return [];
  // SECURITY FIX: this used to batch student lookups into one
  // `where(documentId(), "in", chunk)` query per 30 students, to save
  // reads. That broke completely under firestore.rules: Firestore will
  // only allow a `list`/query request if it can prove, from the query's
  // OWN filters alone, that every possible matching document satisfies
  // the rule — and our /users `list` rule checks resource.data.classCode,
  // a field that isn't part of a document-ID filter. Firestore refuses to
  // read a candidate document just to check the rule, so it denied the
  // ENTIRE query outright with "Missing or insufficient permissions" —
  // for every teacher and every student, every time, on every page load.
  // Individual getUser() calls below go through the `get` rule instead,
  // which Firestore evaluates per document against that document's real
  // data — no such restriction applies. This costs one read per student
  // rather than one per 30, but a class tops out at 8 students, so the
  // difference is negligible, and getUser() already coalesces duplicate
  // in-flight requests for the same username.
  const users = await Promise.all(cls.students.map(u => getUser(u)));
  // PERF FIX: also hand these fresh copies to the short-lived read cache
  // below (see getUserCached), so code that looks the same students up
  // again a moment later — e.g. the teacher dashboard's lifestyle column
  // calling lifestyleRating() once per student right after this — reuses
  // them instead of reading the whole class a second time. Exactly what
  // getUserCached() itself stores for a fresh read, so nothing can be any
  // staler than before (and any write still clears it straight away).
  users.forEach((u, i) => { if (u) window._rcSet("users", cls.students[i], _cloneDoc(u)); });
  return users.filter(Boolean);
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
// NOTE: this used to be an IIFE that ran immediately at script load and
// touched `fdb` right away. That made the data layer's very first action a hard,
// synchronous dependency on firebase-init.js having *already* finished
// setting `fdb` up at the exact moment this script was parsed — a race
// that every other function in this file avoids by only touching `fdb`
// lazily, once actually called (see usersCol()/classesCol() above). If
// that race lost even occasionally (slow network, script order, etc.) the
// IIFE threw immediately and unguarded, which aborted the rest of this
// file entirely — leaving getUser/getClass/requireLogin/everything below
// it undefined on every page. installReadCache() now only runs lazily,
// on the first real call to usersCol()/classesCol(), by which point fdb is
// guaranteed to exist because those same calls are already using it.
let _readCacheInstalled = false;
window._rcGet = function () { return undefined; };
window._rcSet = function () {};

function installReadCache() {
  if (_readCacheInstalled) return;
  _readCacheInstalled = true;

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
          result.then(() => { store.delete(cacheKey(name, id)); _anwOnWriteSettled(); }, () => {});
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
    result.then(() => { store.clear(); _anwOnWriteSettled(); }, () => {});
    return result;
  };
}

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
  // The result is almost always dropped straight into innerHTML by callers
  // (avatar badges), and it's still built from a couple of characters of
  // raw, attacker-controlled display name (e.g. a name of "<b " would slice
  // down to "<B"), so escape here once rather than trust every call site.
  return escapeHtml(name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase());
}

/* ---------------- Session ---------------- */
// Session (which username is logged in on THIS device) stays in
// localStorage on purpose — there's no reason to sync who's logged in
// on a given browser across devices.
//
// Each user doc carries a `sessionVersion` counter (starts at 0). The
// session stored on a device remembers which version it was created
// under. changePassword() bumps the counter in the same write as the
// password change, so every OTHER device's stored session (still
// pointing at the old version) stops matching the user doc's current
// version the next time that device checks — which requireLogin() does
// on every page load — and gets logged out automatically. The device
// that actually changed the password re-stamps its own session with the
// new version immediately, so it stays logged in.
function setSession(username, sessionVersion) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username, sv: sessionVersion || 0 }));
}
function _parseSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.username) return parsed;
  } catch (e) {
    // Falls through — pre-existing sessions (saved before this feature
    // shipped) stored the bare username string instead of JSON.
  }
  return { username: raw, sv: 0 };
}
async function getSessionUser() {
  const sess = _parseSession();
  if (!sess) return null;
  // requireLogin() (below) runs at the top of every page, before render()
  // asks for the same current-user doc again — using the cached fetch here
  // means that second ask is a cache hit instead of a second, fully
  // redundant Firestore read of the identical document.
  let u;
  try {
    u = await getUserCached(sess.username);
  } catch (e) {
    // No internet (or Firebase unreachable) says nothing about whether this
    // person is still logged in — keep their session, and let
    // requireLogin() show a "can't connect" screen with a retry button
    // instead of throwing them back to the login page.
    if (t29IsConnectionError(e)) {
      _t29SessionConnectionFailed = true;
      return null;
    }
    // BUGFIX: a browser that was logged in before the Firebase-Auth
    // security fix shipped still has this old localStorage flag, but no
    // real signed-in Firebase Auth session behind it anymore — so this
    // read gets denied by firestore.rules. Previously that denial was
    // uncaught here, which crashed the entire page instead of just
    // sending them back to log in again. Any other unexpected read
    // failure gets the same graceful treatment, rather than a blank page.
    clearSession();
    return null;
  }
  if (!u) { clearSession(); return null; }
  if ((u.sessionVersion || 0) !== (sess.sv || 0)) {
    // Password was changed (here or elsewhere) since this device's
    // session was created — treat this device as logged out too.
    clearSession();
    return null;
  }
  return u;
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ---------------- Daily time limit (teacher-settable, per student) ----
   Design goal: enforcing/tracking this must not add any extra Firestore
   READS beyond what every page already does. It works entirely off of
   two fields already present on the user doc that requireLogin() fetches
   on every single page load anyway:
     dailyLimitMinutes — denormalized copy of the class setting (kept in
       sync by setStudentTimeLimit() below, and copied onto new students
       in createStudentAccount). 0/null = no limit.
     timeSpentTodaySec / timeSpentDate — how much active time this
       student has used today, and which day (NZ date key, same "what day
       is it" convention as pay day / interest / mortgages elsewhere in
       this file — see nzDateKey()) that count is for.

   WRITES are the only cost, and they're kept cheap on purpose:
     - Nothing is written at all for classes that don't set a limit.
     - While a student is on the site, elapsed active seconds (tab must be
       visible AND focused — a background or unfocused tab doesn't count,
       since the ask was specifically time spent directly on the site)
       accumulate in a plain JS variable. Only every ~10s of *active* time
       does that get flushed to Firestore, as a single
       FieldValue.increment() — a blind write, not a read-modify-write.
       10s (not something larger like 30s) is deliberate: this app is a
       multi-page site (Bank/Jobs/Market/etc are all separate page loads,
       not one SPA), so a student bouncing between pages every few seconds
       would otherwise lose most of their active time to never-flushed
       seconds from short-lived pages.
     - The tab being hidden, or the page unloading, forces an extra flush
       so a closed tab doesn't lose more than a few seconds of credit —
       though browsers don't guarantee an in-flight write started during
       unload actually completes, so this is best-effort, not a guarantee.

   Known limitation: the day boundary and "how much time has been used"
   are both computed from data the client controls (the device clock feeds
   nzDateKey(), and the student's own browser is what reports elapsed
   seconds). Like the rest of this app's client-only architecture, this is
   a soft, honor-system limit suitable for a classroom setting — a student
   who deliberately changes their device's clock could reset or dodge it.
   It is not a substitute for a server-enforced control. */

// Pure, synchronous — only ever looks at fields already on hand from the
// user doc requireLogin() just fetched. No I/O. Uses nzDateKey() (not the
// device's local date) so every student's daily reset lines up with the
// same "day" the rest of the app already uses for pay day/interest/etc,
// regardless of which timezone a given device happens to be set to.
function timeLimitStatus(u) {
  const limitMin = u && u.dailyLimitMinutes;
  if (!limitMin || limitMin <= 0) return { limited: false };
  const today = nzDateKey();
  const spentSec = (u.timeSpentDate === today) ? (u.timeSpentTodaySec || 0) : 0;
  // Bonus minutes a teacher has granted for today only (see
  // requestTimeExemption/decideTimeExemption) — stacks on top of the
  // normal daily limit, and evaporates the moment the date rolls over,
  // same as the limit and spent-time counters themselves.
  const extraMin = (u.extraMinutesDate === today && u.extraMinutesToday > 0) ? u.extraMinutesToday : 0;
  const limitSec = (limitMin + extraMin) * 60;
  return { limited: true, limitSec, spentSec, reached: spentSec >= limitSec, extraMin };
}

// Pure, synchronous read of a student's current time-exemption request
// state — "none" (never asked, or a prior request was already resolved),
// "pending" (waiting on the teacher), or "declined" (teacher said no,
// blocked from asking again until tomorrow). Scoped to timeExemptionDate
// so — like the time-limit fields above — it resets on its own once the
// NZ date rolls over, no cleanup job required.
function timeExemptionState(u) {
  if (!u || u.timeExemptionDate !== nzDateKey()) return "none";
  return u.timeExemptionStatus || "none";
}

let _timeTrackingStarted = false;
function startTimeTracking(u) {
  if (_timeTrackingStarted) return; // one tracker per page load, guaranteed
  const status = timeLimitStatus(u);
  if (!status.limited) return; // no limit set for this class — do nothing, zero cost
  _timeTrackingStarted = true;

  const username = u.username;
  const dateAtLoad = nzDateKey();
  let flushedIsFirst = u.timeSpentDate !== dateAtLoad; // crossed the day boundary since this was last recorded — first flush must overwrite, not increment
  let sessionAccumSec = 0; // active seconds counted this page view, not yet flushed
  let unflushedSec = 0; // active seconds counted since the last flush
  const FLUSH_EVERY_SEC = 10;

  // Flushes are chained through a single promise so overlapping triggers
  // (the tick timer, visibilitychange, pagehide, and the final lockout
  // flush can all fire close together) always run one at a time instead
  // of racing — otherwise two flushes could both see the stale-day flag
  // still set and both send an overwrite, with the second stomping the
  // first's already-applied delta.
  let flushChain = Promise.resolve();
  function flush(finalBeforeLock) {
    flushChain = flushChain.then(() => doFlush(finalBeforeLock));
    return flushChain;
  }
  async function doFlush(finalBeforeLock) {
    if (unflushedSec <= 0 && !finalBeforeLock) return;
    const delta = unflushedSec;
    unflushedSec = 0;
    try {
      if (flushedIsFirst) {
        // Day rolled over since this was last written — overwrite rather
        // than increment onto a stale prior-day value. Only cleared once
        // the write actually succeeds, so a failed attempt correctly
        // retries as an overwrite next time instead of silently falling
        // back to incrementing onto the still-stale count.
        await usersCol().doc(username).update({ timeSpentTodaySec: delta, timeSpentDate: dateAtLoad });
        flushedIsFirst = false;
      } else if (delta > 0) {
        await usersCol().doc(username).update({
          timeSpentTodaySec: firebase.firestore.FieldValue.increment(delta),
          timeSpentDate: dateAtLoad
        });
      }
    } catch (e) {
      // Best-effort — a missed flush just means a few seconds of slack;
      // never let this break the page.
      unflushedSec += delta;
    }
  }

  function lockOut() {
    clearInterval(tickTimer);
    flush(true).finally(() => { window.location.href = "timeup.html"; });
  }

  const tickTimer = setInterval(() => {
    // Require the tab to be both visible AND the focused window — an
    // open-but-backgrounded tab (student alt-tabbed to something else)
    // shouldn't count as "time spent directly on the website".
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    sessionAccumSec++;
    unflushedSec++;
    if (status.spentSec + sessionAccumSec >= status.limitSec) { lockOut(); return; }
    if (unflushedSec >= FLUSH_EVERY_SEC) flush(false);
  }, 1000);

  // Best-effort extra flushes so closing/backgrounding the tab doesn't
  // waste more than a few unflushed seconds of a student's daily budget.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(false); });
  window.addEventListener("pagehide", () => flush(false));
  window.addEventListener("blur", () => flush(false));
}

/* ---------------- Archived-class "memory lane" (students only) ----------
   An archived class blocks students from doing anything, but the teacher
   can still choose to let them browse it read-only ("stroll down memory
   lane" on archived.html). That choice is remembered per class, per
   browser tab, in sessionStorage — not on the user doc — since it's just
   "did this student click through today's memory-lane prompt", not real
   class state. See requireLogin() below for where this is enforced. */
function _memoryLaneKey(classCode) { return "t29_memlane_" + classCode; }
function isMemoryLaneActive(classCode) {
  try { return sessionStorage.getItem(_memoryLaneKey(classCode)) === "1"; } catch (e) { return false; }
}
function enterMemoryLane(classCode) {
  try { sessionStorage.setItem(_memoryLaneKey(classCode), "1"); } catch (e) { /* ignore */ }
}
function _clearMemoryLane(classCode) {
  try { sessionStorage.removeItem(_memoryLaneKey(classCode)); } catch (e) { /* ignore */ }
}

// Generically locks down every page a "memory lane" student visits,
// without each of the ~15 module pages needing its own disabled-state
// logic: disables every button/input/select/textarea inside <main> (the
// topbar's nav links and logout/settings stay usable so they can still
// browse around) and keeps re-disabling anything a page's own render()
// adds afterwards, since most pages build their content after this runs.
function applyArchivedReadOnlyLock(className) {
  if (typeof document === "undefined") return;
  const lockField = () => {
    document.querySelectorAll("main button, main input, main select, main textarea").forEach(el => {
      if (el.dataset.archivedExempt !== undefined) return;
      el.disabled = true;
    });
  };
  if (document.getElementById("t29ArchivedBanner")) { lockField(); return; }
  const run = () => {
    const banner = document.createElement("div");
    banner.id = "t29ArchivedBanner";
    banner.className = "t29-archived-banner";
    banner.innerHTML = (typeof icon === "function" ? icon("lock", 14) : "") +
      ` <strong>${className ? String(className).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) + " — " : ""}Archived class.</strong> You're strolling down memory lane — everything here is view-only.`;
    document.body.prepend(banner);
    document.body.classList.add("t29-archived-readonly");
    lockField();
    new MutationObserver(lockField).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) run(); else document.addEventListener("DOMContentLoaded", run);
}

async function requireLogin(opts) {
  opts = opts || {};
  t29StartPageLoading();
  const u = await getSessionUser();
  if (!u) {
    if (_t29SessionConnectionFailed) { t29ShowConnectionProblem(); return null; }
    window.location.href = "index.html";
    return null;
  }
  T29_SESSION_ROLE = u.role;
  T29_SESSION_USERNAME = u.username;
  // Tracked locally rather than as a property on u — u is the shared
  // object cached by getUserCached()/getSessionUser() (same reference
  // returned on every cache hit for ~2s), so writing to it here would
  // leak this page-only flag into that cache for any other code that
  // reads the same cached user in that window.
  let archivedReadOnly = false;
  // BUGFIX: getSessionUser() already catches its own read of the user's
  // OWN doc and gracefully logs out/redirects on failure — but that read
  // can succeed (e.g. via the legacy-account bypass in firestore.rules)
  // while the requester's underlying Firebase Auth identity is still
  // stale or only partially migrated (see the T29_AUTH_READY fix in
  // firebase-init.js). Everything below this point needs a fully-working
  // identity (myUsername()/myUserDoc() in firestore.rules), so wrap it
  // the same way: any permission failure here means "not really logged
  // in", not a page crash.
  try {
    if (u.role === "student" && !opts.allowArchived) {
      const cls = await getClassCached(u.classCode);
      if (cls && cls.archived) {
        if (isMemoryLaneActive(u.classCode)) {
          archivedReadOnly = true;
          applyArchivedReadOnlyLock(cls.name);
        } else {
          window.location.href = "archived.html";
          return null;
        }
      } else if (cls) {
        _clearMemoryLane(u.classCode);
      }
    }
  } catch (e) {
    if (t29IsConnectionError(e)) { t29ShowConnectionProblem(); return null; }
    clearSession();
    window.location.href = "index.html";
    return null;
  }
  if (u.role === "student" && !opts.skipTimeLimit && !archivedReadOnly) {
    if (timeLimitStatus(u).reached) {
      window.location.href = "timeup.html";
      return null;
    }
    startTimeTracking(u);
  }
  return u;
}
// BUGFIX: logging out used to only forget the username in localStorage —
// the browser stayed signed in to Firebase as that person, so on a shared
// classroom computer the next person to sit down still had the previous
// account's database access. Now signs out of Firebase too (capped at a
// couple of seconds so a slow connection can't trap anyone on the page).
async function logout() {
  clearSession();
  try {
    await Promise.race([
      firebase.auth().signOut(),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
  } catch (e) { /* still leave the page below */ }
  window.location.href = "index.html";
}

// Who is signed in on THIS page — set by requireLogin(). Lets the shared
// background jobs below skip work a student's account isn't allowed to do
// (writing classmates' docs, claiming teacher-only "already ran" markers).
// Every such attempt was refused by firestore.rules anyway, but each
// refusal still cost a full network round trip on every page load.
let T29_SESSION_ROLE = null;
let T29_SESSION_USERNAME = null;
// The signed-in student's username, or null for a teacher / unknown.
function t29SessionStudent() {
  return T29_SESSION_ROLE === "student" ? T29_SESSION_USERNAME : null;
}

/* ---------------- Teacher account + class creation ---------------- */
// The full set of fields a brand new class starts with — shared by the
// original "new teacher" signup flow, "create a brand new class" on the
// teacher's Home page, and (as a starting point before its config gets
// overwritten by the template) "new class from a template".
function defaultClassData(code, className, teacherUsername) {
  return {
    code, name: className || "Room " + code, teacher: teacherUsername,
    students: [], jobs: [], companies: [],
    interestRate: 2, txns: [],
    createdAt: Date.now(), reportArchives: [],
    archived: false, archivedAt: null,
    templateShareToken: null,
    payDay: "Fri",
    mortgageDay: "Fri",
    mortgageForceDueWeek: null,
    transportDay: "Fri",
    publicTransportFee: { amount: 0, description: "" },
    priceRange: { min: 1, max: 5 },
    propertyPriceRange: { min: 0.5, max: 2 },
    lastPropertyMarketDayRun: null,
    automations: [],
    jobApplications: [],
    lastPayDayRun: null, // legacy/unused — pay day due-ness is now tracked per student (see lastWagePaid, near payMyWageIfDue)
    insurancePlans: [], storeItems: [], properties: [],
    eventDefs: [], eventLog: [], lastEventWeekRun: null, lastEventDayRun: null,
    vehicles: [], termDepositPlans: [],
    truckLicence: { price: 0, description: "" },
    sellBackRates: { car: 0.85, truck: 0.85, bike: 0.85 },
    propertyBreakFee: 0,
    sideHustles: [],
    lifestyleLock: { threshold: 0, modules: [] },
    dailyTimeLimitMinutes: null, // null/0 = no limit; minutes of active time per student per day
    interestAuto: false, interestFrequency: "weekly", interestDay: "Fri",
    lastInterestRun: null, // legacy/unused — interest due-ness is now tracked per student (see lastInterestApplied, near applyMyInterestIfDue)
    insuranceDay: "Fri", lastInsuranceWeekRun: null,
    gambling: {
      enabled: true, minBet: 1, maxBet: 20,
      // dailyBuyInLimit caps how much a student can move from cash into
      // their gambling account per NZ calendar day (null = no limit).
      // dailyWinLimit locks them out of gambling for the rest of the day
      // once their NET winnings (wins minus losses) reach it, and shows
      // winLimitMessage when that happens.
      dailyBuyInLimit: null, dailyWinLimit: null,
      winLimitMessage: "You've hit your winning limit for today \u2014 nice work! Come back and play again tomorrow.",
      payouts: { straightUp: 35, split: 17, street: 11, corner: 8, sixLine: 5, oddEven: 1 }
    },
    taxRates: { property: 0, transport: 0, interest: 0, gambling: 0 },
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
}

// SECURITY FIX: signup now creates a real Firebase Auth account (which
// handles password storage/hashing itself — nothing password-related is
// ever written to Firestore anymore) instead of storing the password as
// a plain Firestore field. See firebase-init.js for t29AuthEmail() and
// firestore.rules for how /uidIndex maps the resulting Auth uid back to
// this app's own username.
async function createTeacherAndClass(name, username, password, className) {
  // Firebase itself already refuses to create an account with a password
  // under 6 characters (see t29AuthErrorMessage's "auth/weak-password"
  // case below) — this check just catches that instantly, client-side,
  // instead of making a round trip to Firebase first just to get told
  // the same thing.
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  name = sanitizeUserText(name, 60);
  className = sanitizeUserText(className, 60);

  // These two checks run before the visitor is signed in, which
  // firestore.rules can refuse. A refused check must not stop the signup
  // dead (it used to throw, and the form just sat there doing nothing) —
  // a taken username is still caught further down, by Firebase Auth
  // ("email-already-in-use") and by the /users create rule.
  const existing = await getUser(username).catch(() => null);
  if (existing) return { ok: false, error: "That username is already taken." };

  let code;
  do { code = genCode(5); } while ((await getClass(code).catch(() => null)));

  let cred;
  try {
    cred = await firebase.auth().createUserWithEmailAndPassword(t29AuthEmail(username), password);
  } catch (e) {
    return { ok: false, error: t29AuthErrorMessage(e) };
  }

  const user = {
    username, authUid: cred.user.uid, role: "teacher", name,
    classCode: code, balance: 0, sessionVersion: 0
  };
  const cls = defaultClassData(code, className, username);

  try {
    await fdb.runTransaction(async (t) => {
      t.set(fdb.collection("uidIndex").doc(cred.user.uid), { username });
      t.set(usersCol().doc(username), user);
      t.set(classesCol().doc(code), cls);
    });
  } catch (e) {
    console.warn("Teacher signup failed:", e && (e.code || e.message), e);
    // Don't leave an orphaned Auth account with no matching app data.
    await cred.user.delete().catch(() => {});
    return { ok: false, error: "Something went wrong creating your account. Please try again." };
  }

  setSession(username, 0);
  return { ok: true, code };
}

// Turns a firebase.auth() error into the kind of short, user-facing
// message this app already shows for every other form error.
function t29AuthErrorMessage(e) {
  switch (e && e.code) {
    case "auth/email-already-in-use": return "That username is already taken.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/invalid-email": return "That username can't be used — try letters and numbers only.";
    case "auth/network-request-failed": return "Can't connect right now — check your internet connection and try again.";
    case "auth/too-many-requests": return "Too many attempts in a row. Wait a minute, then try again.";
    case "auth/operation-not-allowed": return "New accounts are switched off right now. Ask your teacher (or check Firebase → Authentication → Sign-in method: Email/Password).";
    default: return "Something went wrong. Please try again.";
  }
}

/* ---------------- Teacher Home: multi-class management ----------------
   A teacher account can own several classes (one Firestore "classes" doc
   each, all with teacher === the teacher's username). The user doc's own
   classCode field is kept as-is everywhere else in this app to mean "the
   class this teacher currently has open" — every existing page reads
   CLASS_CODE from it unchanged. Opening a class from Home, or creating a
   new one, just points that field at a different class doc. */

// Summary cards for the Home page — deliberately doesn't fetch each
// class's students individually (getClassStudents would be one extra
// batch of reads per class); cls.students is already the full roster
// array on the class doc itself, so its length is enough for a count.
async function getTeacherClasses(username) {
  if (!username) return [];
  await T29_AUTH_READY; // firestore.rules requires request.auth != null
  const snap = await classesCol().where("teacher", "==", username).get();
  const list = [];
  snap.forEach(doc => {
    const cls = withNewModuleDefaults(_cloneDoc(doc.data()));
    list.push({
      code: cls.code,
      name: cls.name,
      createdAt: cls.createdAt || null,
      archived: !!cls.archived,
      archivedAt: cls.archivedAt || null,
      studentCount: (cls.students || []).length
    });
  });
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

// "Create a brand new class" from Home — identical result to the original
// teacher signup flow's class half, just without creating another account.
async function createClassForTeacher(teacherUsername, className) {
  const teacher = await getUser(teacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  let code;
  do { code = genCode(5); } while ((await getClass(code)));
  const cls = defaultClassData(code, className.trim(), teacherUsername);

  await classesCol().doc(code).set(cls);
  await usersCol().doc(teacherUsername).update({ classCode: code });
  return { ok: true, code };
}

// "New class from an existing template" — starts from the same clean
// slate as a brand new class, then overlays every setting that describes
// how the class is configured (jobs, properties, side hustles, random
// events, tax/interest settings, and so on). Anything student-specific —
// the roster, balances, activity log, job applications, automations, and
// any event/report history — always starts empty, exactly like a normal
// new class. A handful of fields (store stock sold, property ownership,
// vehicle owners, company share holders/price history) describe *live*
// state rather than configuration, so those are reset to their starting
// values instead of copied as-is.
// Builds the class-doc data for "new class from a template", shared by
// same-account templating (createClassFromTemplate), cross-account
// sharing (importSharedTemplate) and "Restart class" (resetClass) — the
// copy/reset rules are identical in each, only who ends up owning the
// result differs.
//   opts.keepPrices — leave property and share prices where they are now
//                     (Restart class) instead of going back to the oldest
//                     recorded price (a new class).
function _classDataFromTemplate(code, className, teacherUsername, template, opts) {
  const keepPrices = !!(opts && opts.keepPrices);
  const cls = defaultClassData(code, className, teacherUsername);

  cls.jobs = _cloneDoc(template.jobs || []);
  cls.insurancePlans = _cloneDoc(template.insurancePlans || []);
  cls.storeItems = (template.storeItems || []).map(it => {
    const item = _cloneDoc(it);
    item.stock = (item.stockTotal === null || item.stockTotal === undefined) ? null : item.stockTotal;
    item.sold = 0;
    return item;
  });
  cls.properties = (template.properties || []).map(p => {
    const prop = _cloneDoc(p);
    // Nobody owns, lives in, rents or owes anything on it yet — the same
    // fields selling a house clears (see sellProperty).
    prop.owner = null; prop.occupancy = null; prop.rentLastWeekPaid = null;
    prop.purchasePrice = null; prop.mortgage = null; prop.sublet = null;
    // Reset to the listing's original starting price rather than wherever
    // its daily drift had wandered to in the template class — same idea as
    // the company reset just below, and the same reason: a fresh class
    // shouldn't inherit another class's accumulated price history.
    const startPrice = keepPrices ? prop.price
      : (prop.priceHistory && prop.priceHistory.length) ? prop.priceHistory[0] : prop.price;
    prop.price = startPrice;
    prop.priceHistory = [startPrice];
    prop.priceHistoryDates = [nzDateKey()];
    return prop;
  });
  // School rentals: the listings are setup, the tenants aren't.
  cls.npcProperties = (template.npcProperties || []).map(u => {
    const unit = _cloneDoc(u);
    unit.tenant = null; unit.leaseStartTs = null; unit.leaseStartWeekKey = null;
    unit.rentLastWeekPaid = null; unit.rentLastPaidDate = null;
    return unit;
  });
  cls.vehicles = (template.vehicles || []).map(v => {
    const veh = _cloneDoc(v);
    veh.owners = [];
    return veh;
  });
  cls.companies = (template.companies || []).map(co => {
    const c = _cloneDoc(co);
    const startPrice = keepPrices ? c.price : (c.history && c.history.length) ? c.history[0] : c.price;
    c.price = startPrice;
    c.availableShares = c.totalShares;
    c.holders = {};
    c.costBasis = {};
    c.history = [startPrice];
    c.historyDates = [nzDateKey()];
    return c;
  });
  cls.sideHustles = _cloneDoc(template.sideHustles || []);
  cls.lifeItems = _cloneDoc(template.lifeItems || []);
  cls.eventDefs = _cloneDoc(template.eventDefs || []);
  cls.bigEventDefs = _cloneDoc(template.bigEventDefs || []);
  cls.loanTiers = _cloneDoc(template.loanTiers || []);
  cls.maxLoanAmount = template.maxLoanAmount || 0;
  cls.maxLoanCount = template.maxLoanCount || 0;
  cls.termDepositPlans = _cloneDoc(template.termDepositPlans || []);
  cls.quizzes = _cloneDoc(template.quizzes || []);
  cls.quizGate = _cloneDoc(template.quizGate || cls.quizGate);
  cls.lifestyleConfig = _cloneDoc(template.lifestyleConfig || cls.lifestyleConfig);
  cls.lifestyleLock = _cloneDoc(template.lifestyleLock || cls.lifestyleLock);
  if (template.lifestyleThresholds) cls.lifestyleThresholds = _cloneDoc(template.lifestyleThresholds);
  cls.gambling = _cloneDoc(template.gambling || cls.gambling);
  cls.blackjack = _cloneDoc(template.blackjack || cls.blackjack);
  cls.marketplace = _cloneDoc(template.marketplace || cls.marketplace);
  cls.taxRates = _cloneDoc(template.taxRates || cls.taxRates);
  cls.wageTaxBrackets = _cloneDoc(template.wageTaxBrackets || []);
  cls.priceRange = _cloneDoc(template.priceRange || cls.priceRange);
  cls.propertyPriceRange = _cloneDoc(template.propertyPriceRange || cls.propertyPriceRange);
  cls.sellBackRates = _cloneDoc(template.sellBackRates || cls.sellBackRates);
  cls.truckLicence = _cloneDoc(template.truckLicence || cls.truckLicence);
  cls.dailyTimeLimitMinutes = template.dailyTimeLimitMinutes || null;
  // template.interestRate is a genuine 0-or-more rate — a teacher setting
  // 0% is a real, meaningful choice, so this can't use `|| cls.interestRate`
  // like the other fields above (that would silently turn an intentional
  // 0% back into the default). Only fall back when the template genuinely
  // doesn't have the field at all (e.g. an older template predating it).
  cls.interestRate = (template.interestRate === undefined || template.interestRate === null) ? cls.interestRate : template.interestRate;
  cls.cashInterestRate = template.cashInterestRate || 0;
  cls.interestAuto = !!template.interestAuto;
  cls.interestFrequency = template.interestFrequency || "weekly";
  cls.interestDay = template.interestDay || "Fri";
  cls.payDay = template.payDay || "Fri";
  cls.mortgageDay = template.mortgageDay || "Fri";
  cls.insuranceDay = template.insuranceDay || "Fri";
  // Transport and renting settings. Fee overrides are keyed by life-event
  // id, and the life events above keep their ids, so they still match.
  cls.transportDay = template.transportDay || "Fri";
  cls.publicTransportFee = _cloneDoc(template.publicTransportFee || cls.publicTransportFee);
  cls.publicTransportFeeOverrides = _cloneDoc(template.publicTransportFeeOverrides || {});
  cls.propertyBreakFee = Number(template.propertyBreakFee) || 0;
  cls.movingCost = Number(template.movingCost) || 0;
  cls.propertyRentals = _cloneDoc(template.propertyRentals || {});
  cls.storeSortMode = template.storeSortMode || "manual";
  // KiwiSaver settings carry over; a retired class's copy starts un-retired.
  if (template.kiwiSaver) cls.kiwiSaver = Object.assign(_cloneDoc(template.kiwiSaver), { retired: false, retiredAt: null });

  return cls;
}

// The setup part of a class (everything _classDataFromTemplate copies),
// saved inside a share link so another teacher can import it without
// needing permission to read the class itself. No people, money or
// history goes in it — only what a brand-new class would start with.
function _templateSnapshot(cls) {
  const t = _classDataFromTemplate("", cls.name || "", cls.teacher || "", withNewModuleDefaults(_cloneDoc(cls)));
  ["code", "name", "teacher", "students", "txns", "createdAt", "reportArchives", "archived", "archivedAt",
    "templateShareToken", "automations", "jobApplications", "eventLog", "bigEventLog"].forEach(k => { delete t[k]; });
  return _cloneDoc(t);
}

async function createClassFromTemplate(teacherUsername, className, templateCode) {
  const teacher = await getUser(teacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  const template = await getClass(templateCode);
  if (!template || template.teacher !== teacherUsername) {
    return { ok: false, error: "That template class couldn't be found." };
  }

  let code;
  do { code = genCode(5); } while ((await getClass(code)));
  const cls = _classDataFromTemplate(code, className.trim(), teacherUsername, template);

  await classesCol().doc(code).set(cls);
  await usersCol().doc(teacherUsername).update({ classCode: code });
  return { ok: true, code };
}

/* ---------------- Sharing a class as a template with another teacher ----
   A separate "templateShares" collection maps a random, unguessable
   token to the source class — deliberately not the class's own join
   code, so a share link can be copied/posted/revoked without touching
   (or exposing) the code students use to log in, and a teacher can kill
   a share link at any time without affecting the class itself. */
function templateSharesCol() { return fdb.collection("templateShares"); }

function genShareToken() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(22);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// "Share Template" button — mints a link the first time, then keeps the
// same link so repeat clicks don't invalidate one a teacher already
// handed out. The link carries a copy of the class's setup (see
// _templateSnapshot): the teacher importing it isn't allowed to read
// someone else's class, so it can't be fetched from the class itself.
// Each click refreshes that copy with the class's setup as it is now.
async function getOrCreateTemplateShare(classCode, teacherUsername) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.teacher !== teacherUsername) return { ok: false, error: "You don't have permission to share this class." };
  const teacher = await getUser(teacherUsername);

  const token = cls.templateShareToken || genShareToken();
  if (cls.templateShareToken) {
    // Share records can't be edited (firestore.rules), only replaced, so
    // the old copy is removed and a fresh one saved under the same token.
    const existing = await templateSharesCol().doc(token).get();
    if (existing.exists) await templateSharesCol().doc(token).delete();
  }
  await templateSharesCol().doc(token).set({
    token, classCode, teacher: teacherUsername, createdAt: Date.now(),
    className: cls.name || "", teacherName: (teacher && teacher.name) || "",
    template: _templateSnapshot(cls)
  });
  if (cls.templateShareToken !== token) await classesCol().doc(classCode).update({ templateShareToken: token });
  return { ok: true, token };
}

// Invalidates a class's current share link. Sharing again afterwards
// mints a brand new one.
async function revokeTemplateShare(classCode, teacherUsername) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.teacher !== teacherUsername) return { ok: false, error: "You don't have permission to manage sharing for this class." };
  if (cls.templateShareToken) {
    await templateSharesCol().doc(cls.templateShareToken).delete();
    await classesCol().doc(classCode).update({ templateShareToken: null });
  }
  return { ok: true };
}

// What import-template.html shows before the receiving teacher commits —
// deliberately requires no permission on the source class, since the
// whole point of a share link is letting a different teacher use it.
// needsRefresh: the link was made before links carried the class's setup
// (and the class belongs to someone else, so it can't be read directly) —
// the teacher who shared it has to click Share Template again.
async function getTemplateShareInfo(token) {
  if (!token) return null;
  await T29_AUTH_READY; // firestore.rules requires request.auth != null
  const snap = await templateSharesCol().doc(token).get();
  if (!snap.exists) return null;
  const share = snap.data();
  if (share.template) {
    return { token, className: share.className || "a class", teacherName: share.teacherName || "another teacher", needsRefresh: false };
  }
  const [cls, teacher] = await Promise.all([
    getClass(share.classCode).catch(() => undefined),
    getUser(share.teacher).catch(() => null)
  ]);
  if (cls === null) return null; // source class was deleted after sharing
  if (!cls) return { token, className: "a class", teacherName: "the teacher who sent it", needsRefresh: true };
  return { token, className: cls.name, teacherName: teacher ? teacher.name : "another teacher", needsRefresh: false };
}

// Creates a brand new class in the IMPORTING teacher's account from a
// share link — same copy/reset rules as createClassFromTemplate, just
// sourced from a share token instead of one of their own classes.
async function importSharedTemplate(importingTeacherUsername, token, className) {
  const teacher = await getUser(importingTeacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  const shareSnap = await templateSharesCol().doc(token).get();
  if (!shareSnap.exists) return { ok: false, error: "This share link is invalid or has been revoked." };
  const share = shareSnap.data();
  // Older links don't carry the setup — those only work for the teacher
  // who made them (nobody else may read their class).
  const template = share.template || await getClass(share.classCode).catch(() => undefined);
  if (template === null) return { ok: false, error: "The shared class no longer exists." };
  if (!template) return { ok: false, error: "This link needs refreshing — ask the teacher who sent it to click Share Template on that class again, then use the link again." };

  let code;
  do { code = genCode(5); } while ((await getClass(code)));
  const cls = _classDataFromTemplate(code, className.trim(), importingTeacherUsername, template);

  await classesCol().doc(code).set(cls);
  await usersCol().doc(importingTeacherUsername).update({ classCode: code });
  return { ok: true, code };
}

// Points the teacher's "currently open" class at a different one of their
// own classes (used when clicking a class card on Home).
async function switchActiveClass(teacherUsername, classCode) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.teacher !== teacherUsername) return { ok: false, error: "You don't have permission to open this class." };
  await usersCol().doc(teacherUsername).update({ classCode });
  return { ok: true };
}

// Archiving just pauses a class for students (see requireLogin below and
// archived.html) — nothing is deleted, and it can be reopened, or still
// used as a "new class from template" source, at any time.
async function setClassArchived(classCode, archived) {
  await classesCol().doc(classCode).update({
    archived: !!archived,
    archivedAt: archived ? Date.now() : null
  });
  return { ok: true };
}

// Permanently deletes a class AND every student account in it. This is
// the one truly irreversible class action — the teacher.js UI backs it
// with a "type the class name to confirm" prompt, same pattern already
// used for "Restart class".
async function deleteClassPermanently(teacherUsername, classCode) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.teacher !== teacherUsername) return { ok: false, error: "You don't have permission to delete this class." };

  // firestore.rules only lets a teacher delete student accounts (and
  // family links) in the class they currently have OPEN, so open this
  // class first, then go back to whichever class was open before.
  const teacher = await getUser(teacherUsername);
  const previousOpen = teacher ? (teacher.classCode || null) : null;
  const backTo = previousOpen && previousOpen !== classCode ? previousOpen : null;
  if (previousOpen !== classCode) await usersCol().doc(teacherUsername).update({ classCode });

  try {
    // Family links first, while the student docs that name them still exist.
    await Promise.all((cls.students || []).map(u => _deleteParentViewFor(u)));
    // Individual doc deletes (not a batch) so each one still goes through
    // the wrapped docRef.delete() in installReadCache(), which is what
    // keeps the read cache correct — a raw WriteBatch would bypass that.
    await Promise.all((cls.students || []).map(u => usersCol().doc(u).delete()));
    if (cls.templateShareToken) {
      await templateSharesCol().doc(cls.templateShareToken).delete();
    }
    await classesCol().doc(classCode).delete();
  } catch (e) {
    console.warn("deleteClassPermanently failed:", e);
    if (previousOpen !== classCode) await usersCol().doc(teacherUsername).update({ classCode: previousOpen }).catch(() => {});
    return { ok: false, error: "Something went wrong deleting the class — some of it may not have been deleted. Please try again." };
  }

  await usersCol().doc(teacherUsername).update({ classCode: backTo });
  return { ok: true };
}

/* ---------------- Student joins a class ---------------- */
// SECURITY FIX: same change as createTeacherAndClass() above — a real
// Firebase Auth account is created first (password never touches
// Firestore), then /uidIndex, /users, and the class-doc update happen
// together in one transaction.
async function createStudentAccount(name, username, password, classCode) {
  // See the matching check in createTeacherAndClass above — same reason.
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  name = sanitizeUserText(name, 60);

  // See the matching note in createTeacherAndClass above.
  const existing = await getUser(username).catch(() => null);
  if (existing) return { ok: false, error: "That username is already taken." };
  const classRef = classesCol().doc(classCode);

  let cred;
  try {
    cred = await firebase.auth().createUserWithEmailAndPassword(t29AuthEmail(username), password);
  } catch (e) {
    return { ok: false, error: t29AuthErrorMessage(e) };
  }

  try {
    await fdb.runTransaction(async (t) => {
      const clsSnap = await t.get(classRef);
      if (!clsSnap.exists) throw new Error("NO_CLASS");
      const cls = clsSnap.data();

      t.set(fdb.collection("uidIndex").doc(cred.user.uid), { username });

      const user = {
        username, authUid: cred.user.uid, role: "student", name,
        classCode, balance: 20, jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null, savings: 0, loans: [],
        sessionVersion: 0,
        // Denormalized copy of the class's daily time limit (see
        // setStudentTimeLimit below). Kept on the user doc itself so
        // requireLogin() can check/enforce it using the user doc it
        // already reads on every page — no extra class-doc read needed.
        dailyLimitMinutes: cls.dailyTimeLimitMinutes || null,
        timeSpentTodaySec: 0,
        timeSpentDate: null,
        // Time-limit exemption requests (see requestTimeExemption below).
        // status is null/"pending"/"declined", scoped to timeExemptionDate
        // (an NZ date key) so it naturally resets each day without a
        // migration job — see timeExemptionState(). extraMinutesToday/
        // -Date is the bonus time a teacher has granted for today only,
        // added on top of dailyLimitMinutes by timeLimitStatus().
        timeExemptionStatus: null,
        timeExemptionDate: null,
        extraMinutesToday: 0,
        extraMinutesDate: null,
        // Rolling report totals (see recordReportActivity below) — seeded
        // here with the welcome grant itself, since it's logged inline
        // below rather than through logTxn's usual recordReportActivity hook.
        reportMonth: Object.assign(emptyReportBucket(), { monthKey: nzMonthKey() }),
        reportLifetime: emptyReportBucket()
      };
      addClassificationToBucket(user.reportMonth, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: 20 });
      addClassificationToBucket(user.reportLifetime, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: 20 });
      t.set(usersCol().doc(username), user);

      cls.students.push(username);
      cls.txns.unshift({ id: uid("t"), type: "welcome", to: username, amount: 20, note: "Welcome grant", date: nowStr(), ts: Date.now() });
      if (cls.txns.length > MAX_STORED_TXNS) cls.txns.length = MAX_STORED_TXNS;
      t.update(classRef, { students: cls.students, txns: cls.txns });
    });
  } catch (e) {
    console.warn("Student signup failed:", e && (e.code || e.message), e);
    await cred.user.delete().catch(() => {}); // don't leave an orphaned Auth account
    if (e.message === "NO_CLASS") return { ok: false, error: "That class code doesn't exist." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  setSession(username, 0);
  return { ok: true };
}

/* ---------------- Login ----------------
   SECURITY FIX: password verification is now done entirely by Firebase
   Auth (signInWithEmailAndPassword) instead of comparing a plaintext
   Firestore field. Accounts created before this fix ("legacy" accounts —
   no authUid on their /users doc yet) are migrated automatically, once,
   the first time they successfully log in: this function falls back to
   checking their still-present legacy `password` field, and if it
   matches, creates their real Firebase Auth account right then using the
   password they just typed, links it via /uidIndex, and deletes the
   legacy plaintext field so it's gone for good.

   The password check itself happens inside firestore.rules (see
   t29TryMigrateLegacyLogin below) — the browser never reads the old
   password, so nobody else can either. Until a legacy account logs in
   once, its old password is still on its /users doc, which classmates
   and the teacher can read like any other classmate's doc. */
async function login(username, password) {
  try {
    await firebase.auth().signInWithEmailAndPassword(t29AuthEmail(username), password);
  } catch (e) {
    // BUGFIX: newer Firebase projects have "email enumeration protection"
    // on by default, which reports a nonexistent account as
    // auth/invalid-credential (identical to a wrong password) rather than
    // auth/user-not-found — checking only for the latter meant every
    // not-yet-migrated account failed here and never reached the
    // migration attempt below. Trying the migration on either code is
    // safe: t29TryMigrateLegacyLogin() only succeeds for an account that
    // both matches the legacy plaintext password AND has no authUid yet,
    // so an already-migrated account with a genuinely wrong password
    // still correctly falls through to "Incorrect username or password."
    if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
      const migrated = await t29TryMigrateLegacyLogin(username, password);
      if (!migrated.ok) return { ok: false, error: "Incorrect username or password." };
    } else if (e.code === "auth/network-request-failed" || e.code === "auth/too-many-requests") {
      // Not the password's fault — say what actually went wrong.
      return { ok: false, error: t29AuthErrorMessage(e) };
    } else {
      return { ok: false, error: "Incorrect username or password." };
    }
  }

  // BUGFIX: the sign-in email is lowercased (t29AuthEmail) but usernames
  // aren't, so "Jason" vs "jason" (e.g. a phone auto-capitalising the first
  // letter) signed in fine and then found no account. /uidIndex holds the
  // exact username this login belongs to, so use that when it's there.
  const signedInUser = firebase.auth().currentUser;
  if (signedInUser) {
    const idx = await fdb.collection("uidIndex").doc(signedInUser.uid).get().catch(() => null);
    const realName = idx && idx.exists ? idx.data().username : null;
    if (typeof realName === "string" && realName && realName.toLowerCase() === username.toLowerCase()) {
      username = realName;
    }
  }

  let u = await getUser(username).catch(() => null);
  if (!u) {
    // A legacy migration that got its /uidIndex entry written but never
    // finished stamping the /users doc can't read its own doc yet — finish
    // it now (refused for anyone it doesn't belong to) and try once more.
    const authUser = firebase.auth().currentUser;
    if (authUser && await _t29FinishLegacyClaim(username, authUser.uid)) {
      u = await getUser(username).catch(() => null);
    }
  }
  if (!u) {
    await firebase.auth().signOut().catch(() => {});
    return { ok: false, error: "Incorrect username or password." };
  }
  setSession(username, u.sessionVersion || 0);
  return { ok: true, user: u };
}

// One-time bridge for accounts created before this fix. See the comment
// on login() above.
//
// SECURITY FIX: this used to sign in anonymously and READ the account's
// old plaintext password to compare it here in the browser — which meant
// firestore.rules had to let any visitor read any not-yet-migrated
// account's password just by knowing the username. Now the browser never
// reads it: the typed password goes along as `legacyProof` on this uid's
// own /uidIndex entry, and firestore.rules itself compares it with the
// stored one (see the /uidIndex create rule and isLegacyClaim()). A wrong
// password is simply refused, and the Auth account made for the attempt
// is deleted again.
//
// Still two separate writes, for the reason the old code gave: the /users
// half is checked against /uidIndex, and rules only ever see committed
// data, not another write staged in the same transaction.
async function t29TryMigrateLegacyLogin(username, password) {
  let cred;
  try {
    cred = await firebase.auth().createUserWithEmailAndPassword(t29AuthEmail(username), password);
  } catch (e) {
    return { ok: false };
  }
  try {
    await fdb.collection("uidIndex").doc(cred.user.uid).set({ username, legacyProof: password });
  } catch (e) {
    // Wrong password (or not a legacy account) — undo the Auth account.
    await cred.user.delete().catch(() => {});
    await firebase.auth().signOut().catch(() => {});
    return { ok: false };
  }
  // The mapping is now permanent (it can't be deleted), so from here on a
  // failure is only "not finished yet" — login() retries this on the next
  // sign-in via _t29FinishLegacyClaim rather than deleting anything.
  await _t29FinishLegacyClaim(username, cred.user.uid);
  return { ok: true };
}

// Second half of the migration: stamp the account with its new Auth uid
// and drop the old plaintext password (allowed by isLegacyClaim() in
// firestore.rules). Safe to call when it's already done — it just fails.
async function _t29FinishLegacyClaim(username, uid) {
  try {
    await usersCol().doc(username).update({
      authUid: uid,
      password: firebase.firestore.FieldValue.delete()
    });
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- Change password ----------------
   Bumps sessionVersion in the same write as the password change, which
   is what signs every other logged-in device out (see the Session
   section above for how that check works). Requires the current
   password so a student walking away from an unlocked device can't have
   their password silently swapped out from under them. */
async function changePassword(username, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  if (newPassword === oldPassword) {
    return { ok: false, error: "New password must be different from your current password." };
  }

  // SECURITY FIX: reauthenticate + change the password through Firebase
  // Auth itself, rather than comparing/overwriting a plaintext Firestore
  // field. sessionVersion (the "sign out other devices" counter) still
  // lives on the Firestore user doc, so it's bumped separately below.
  const authUser = firebase.auth().currentUser;
  if (!authUser) return { ok: false, error: "You need to be logged in." };
  try {
    const cred = firebase.auth.EmailAuthProvider.credential(t29AuthEmail(username), oldPassword);
    await authUser.reauthenticateWithCredential(cred);
    await authUser.updatePassword(newPassword);
  } catch (e) {
    if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" || e.code === "auth/invalid-login-credentials") {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (e.code === "auth/weak-password") {
      return { ok: false, error: "New password must be at least 6 characters." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const ref = usersCol().doc(username);
  let newVersion;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error("NO_USER");
      newVersion = (snap.data().sessionVersion || 0) + 1;
      t.update(ref, { sessionVersion: newVersion });
    });
  } catch (e) {
    return { ok: false, error: "Password changed, but something went wrong finishing up. Please try again." };
  }
  // Re-stamp THIS device's own session with the new version immediately,
  // so the device that just changed the password stays logged in — only
  // every other device gets signed out.
  setSession(username, newVersion);
  return { ok: true };
}

/* ---------------- Change-password modal (global, every page) ----------------
   Built on demand with plain DOM injection — the same pattern
   settings-menu.js uses for its own settings popover — so there's no
   per-page HTML to add or keep in sync. Opened from the "Change password"
   row inside that popover (see smBuildPopover() in settings-menu.js).
   Reuses the .anw-modal-overlay / .anw-modal-card classes already defined
   in style.css for the random-event popup, so it matches the rest of the
   app without new CSS. */
function _pwBuildModal() {
  const existing = document.getElementById("t29PasswordModal");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "t29PasswordModal";
  overlay.className = "anw-modal-overlay hidden";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closePasswordModal(); });

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <div class="flex-between">
        <h2 style="margin:0 0 2px;">Change password</h2>
        <button class="btn small secondary" type="button" id="t29PwCloseBtn">Close</button>
      </div>
      <label style="display:block;margin:14px 0 4px;font-size:.9rem;" for="t29PwCurrent">Current password</label>
      <input type="password" id="t29PwCurrent" autocomplete="current-password" style="width:100%;">
      <label style="display:block;margin:12px 0 4px;font-size:.9rem;" for="t29PwNew">New password</label>
      <input type="password" id="t29PwNew" autocomplete="new-password" style="width:100%;">
      <label style="display:block;margin:12px 0 4px;font-size:.9rem;" for="t29PwConfirm">Confirm new password</label>
      <input type="password" id="t29PwConfirm" autocomplete="new-password" style="width:100%;">
      <p class="muted-small" id="t29PwMsg" style="min-height:1.2em;margin-top:10px;"></p>
      <button class="btn gold" type="button" id="t29PwSubmitBtn">Update password</button>
      <p class="muted-small" style="margin-top:10px;">Changing your password will sign you out on any other device you're currently logged in on.</p>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector("#t29PwCloseBtn").addEventListener("click", closePasswordModal);
  overlay.querySelector("#t29PwSubmitBtn").addEventListener("click", submitPasswordChange);
  overlay.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitPasswordChange(); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closePasswordModal();
  });
  return overlay;
}

function openPasswordModal() {
  const overlay = _pwBuildModal();
  overlay.querySelector("#t29PwCurrent").value = "";
  overlay.querySelector("#t29PwNew").value = "";
  overlay.querySelector("#t29PwConfirm").value = "";
  overlay.querySelector("#t29PwMsg").textContent = "";
  overlay.classList.remove("hidden");
  overlay.querySelector("#t29PwCurrent").focus();
}
function closePasswordModal() {
  const overlay = document.getElementById("t29PasswordModal");
  if (overlay) overlay.classList.add("hidden");
}
async function submitPasswordChange() {
  const overlay = document.getElementById("t29PasswordModal");
  if (!overlay) return;
  const oldPw = overlay.querySelector("#t29PwCurrent").value;
  const newPw = overlay.querySelector("#t29PwNew").value;
  const confirmPw = overlay.querySelector("#t29PwConfirm").value;
  const msg = overlay.querySelector("#t29PwMsg");
  const btn = overlay.querySelector("#t29PwSubmitBtn");

  if (!oldPw || !newPw || !confirmPw) { msg.textContent = "Please fill in all three fields."; return; }
  if (newPw !== confirmPw) { msg.textContent = "New passwords don't match."; return; }

  const me = await getSessionUser();
  if (!me) { msg.textContent = "You've been signed out — please log back in."; return; }

  btn.disabled = true;
  msg.textContent = "Updating...";
  const res = await changePassword(me.username, oldPw, newPw);
  btn.disabled = false;

  if (!res.ok) { msg.textContent = res.error; return; }

  overlay.querySelector("#t29PwCurrent").value = "";
  overlay.querySelector("#t29PwNew").value = "";
  overlay.querySelector("#t29PwConfirm").value = "";
  msg.textContent = "Password updated — you're still signed in here. Any other device you were logged in on will need to sign back in.";
}

/* ---------------- Money movement ---------------- */
async function adjustBalance(username, delta) {
  // BUGFIX (defensive): every current caller already passes a genuine
  // number, so this was never live — but `data.balance + delta` silently
  // turns into string CONCATENATION instead of addition if a future
  // caller ever passes something like "5" instead of 5. Coercing here
  // means this function is safe regardless of what a caller hands it,
  // instead of relying on every caller to remember to do it themselves.
  delta = Number(delta) || 0;
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
  // Built once, outside the transaction, so every retry (Firestore retries
  // on contention) pushes the exact same entry rather than a new id/ts each
  // time, and so recordReportActivity() below has a stable reference to the
  // entry that actually got committed.
  const built = Object.assign({ id: uid("t"), date: nowStr(), ts: Date.now() }, txn);
  const committed = await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return false;
    const cls = snap.data();
    cls.txns.unshift(built);
    if (cls.txns.length > MAX_STORED_TXNS) cls.txns.length = MAX_STORED_TXNS;
    t.update(classRef, { txns: cls.txns });
    return true;
  });
  if (!committed) return; // class didn't exist — nothing was logged, so nothing to report either
  // Feed this txn into the rolling per-student report totals (see
  // recordReportActivity below) for whichever real student(s) it belongs
  // to. Best-effort and non-blocking of the money movement above, which
  // has already committed by this point regardless of what happens here.
  const affected = new Set([built.to, built.from].filter(Boolean));
  await Promise.all([...affected].map(u => recordReportActivity(u, built)));
}

async function transferMoney(fromUser, toUser, amount, note) {
  // BUGFIX (defensive, same as adjustBalance above): coerce here rather
  // than trusting the caller, so `fromData.balance - amount` can never
  // silently become string concatenation.
  amount = Math.round((Number(amount) || 0) * 100) / 100;
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
  // BUGFIX (defensive, same as adjustBalance/transferMoney above).
  amount = Math.round((Number(amount) || 0) * 100) / 100;
  const student = await getUser(studentUser);
  if (!student) return { ok: false, error: "Student not found." };
  // Nothing is logged (or announced to the student) unless the money
  // actually moved.
  if (!(await adjustBalance(studentUser, amount))) return { ok: false, error: "Something went wrong. Please try again." };
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

/* ---------------- Remove a student ---------------- */
async function removeStudent(classCode, studentUser) {
  const classRef = classesCol().doc(classCode);
  const userRef = usersCol().doc(studentUser);
  // A family link (see "Parent view" in data-money.js) must stop working
  // once the student is gone. Best-effort, and done first, while the
  // student doc that names the link still exists.
  await _deleteParentViewFor(studentUser);
  // Both the class-doc cleanup and the user-doc deletion happen in ONE
  // transaction now (they used to be two separate calls — see BUGFIX
  // note below), so a departing student is either fully removed or the
  // whole removal is rolled back; there's no window where the class doc
  // has already been cleaned up but the /users doc is still sitting
  // around orphaned (or vice versa).
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.companies.forEach(co => {
      if (co.holders[studentUser]) {
        co.availableShares += co.holders[studentUser];
        delete co.holders[studentUser];
      }
      if (co.costBasis && co.costBasis[studentUser]) delete co.costBasis[studentUser];
    });
    cls.students = cls.students.filter(s => s !== studentUser);
    cls.automations = (cls.automations || []).filter(a => a.studentUser !== studentUser);
    cls.jobApplications = (cls.jobApplications || []).filter(a => a.studentUser !== studentUser);
    (cls.properties || []).forEach(p => {
      // Their own homes go back on the market — including ending any
      // classmate's tenancy in them, since there's no owner left to rent
      // from (same fields selling a house clears, see sellProperty).
      if (p.owner === studentUser) {
        p.owner = null; p.mortgage = null; p.occupancy = null; p.rentLastWeekPaid = null;
        p.purchasePrice = null; p.sublet = null;
      // A classmate's home they were renting is free again — same as the
      // tenant moving out (see tenantMoveOut).
      } else if (p.sublet && p.sublet.tenant === studentUser) {
        p.occupancy = null; p.sublet = null; p.rentLastWeekPaid = null;
      }
    });
    // A school rental they were renting is free again (see teacherEndNpcTenancy).
    (cls.npcProperties || []).forEach(u => {
      if (u.tenant !== studentUser) return;
      u.tenant = null; u.leaseStartTs = null; u.leaseStartWeekKey = null;
      u.rentLastWeekPaid = null; u.rentLastPaidDate = null;
    });
    (cls.vehicles || []).forEach(v => { v.owners = (v.owners || []).filter(o => o !== studentUser); });
    // BUGFIX: a departing student's still-open Trade Centre listings used
    // to be left behind entirely untouched. The purchase path already
    // rejects buying from a student no longer in the class, so this was
    // never exploitable — but the listing stayed visible in the
    // marketplace (under the student's bare username, since the name
    // lookup that powers the display comes from the roster this same
    // function just removed them from) until a teacher noticed and
    // cleared it manually. Pull down any of their still-open ("active" or
    // "pending") listings here, same as teacherRemoveListing() does when a
    // teacher pulls one down directly, including declining any open offers
    // on it.
    cls.listings = (cls.listings || []).map(l => {
      if (l.seller !== studentUser || !listingIsOpen(l)) return l;
      return {
        ...l, status: "rejected", rejectReason: "Seller left the class",
        offers: (l.offers || []).map(o => o.status === "open" ? { ...o, status: "declined" } : o)
      };
    }).map(l => {
      // Offers they made on classmates' listings can't be accepted any
      // more (there's nobody to pay), so they're withdrawn.
      if (!(l.offers || []).some(o => o.buyer === studentUser && o.status === "open")) return l;
      return { ...l, offers: l.offers.map(o => o.buyer === studentUser && o.status === "open" ? { ...o, status: "withdrawn" } : o) };
    });
    const update = {
      companies: cls.companies, students: cls.students,
      automations: cls.automations, jobApplications: cls.jobApplications,
      properties: cls.properties || [], vehicles: cls.vehicles || [],
      listings: cls.listings
    };
    if (cls.npcProperties) update.npcProperties = cls.npcProperties;
    t.update(classRef, update);
    // BUGFIX: this used to be a separate `await usersCol().doc(studentUser)
    // .delete()` call made AFTER this transaction committed. If the app
    // (or the network) died in between, the class doc would already show
    // the student as removed everywhere while their /users doc — balance,
    // history, everything — was still sitting in Firestore forever,
    // unreachable from any UI and never cleaned up. Deleting it inside
    // this same transaction means it can no longer happen independently
    // of the rest of the removal.
    t.delete(userRef);
  });
  return true;
}

async function setPayDay(classCode, day) {
  await classesCol().doc(classCode).update({ payDay: day });
}

// Class-wide day mortgage installments fall due on (see payMortgage).
async function setMortgageDay(classCode, day) {
  await classesCol().doc(classCode).update({ mortgageDay: DAY_NAMES.includes(day) ? day : "Fri" });
}

// Teacher-only manual override: makes this week's mortgage installment
// payable right now, regardless of the class's normal mortgageDay — e.g.
// if the teacher missed the usual day or wants to run a payment on the
// spot. `active` true stamps the current ISO week onto the class so
// payMortgage (and the student-facing "pay this week's mortgage" button)
// treat today as a due day for the rest of this week; `active` false
// clears it early if the teacher changes their mind. It never charges
// anyone itself — students still have to click "pay" themselves, same as
// the normal due day (see payMortgage's comment for why mortgages are
// manual-only).
async function setMortgageDueOverride(classCode, active) {
  await classesCol().doc(classCode).update({ mortgageForceDueWeek: active ? isoWeekKey(new Date()) : null });
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

/* ---------------- Safe background-job wrapper ----------------
   Every page runs the 8 jobs below via Promise.all() on load. Promise.all
   rejects the moment ANY one of them rejects — and until now nothing
   caught that, so a single job failing (a transient network hiccup, a
   permission error, anything) took the entire page down with it: the
   whole init() function stops right there and render() never runs, which
   looks like the page just hanging. Wrapping each job in this before it
   goes into Promise.all() means one job failing can only skip that one
   job — every other job still runs, and the page still loads normally. */
/* Draws the page with whatever data is already available, BEFORE the
   caller waits on the day's background jobs. Every page's init() now does
   `await t29FirstPaint(render)` the moment its jobs are started rather
   than after they finish — so a phone shows a usable page in one round
   trip instead of sitting blank until the slowest job (pay day, which
   writes once per student) has been through the whole class.

   Wrapped in its own catch for the same reason safeBgJob is: a first
   paint that throws (e.g. an element a later job was meant to populate)
   must never stop init() from going on to run the jobs and re-render. */
async function t29FirstPaint(renderFn) {
  try {
    await renderFn();
  } catch (e) {
    console.warn("First paint failed (page will re-render after background jobs):", e);
    if (t29IsConnectionError(e)) {
      t29Toast("Couldn't load everything on this page — check your internet connection.", { type: "error", duration: 7000 });
    }
  }
  t29PageReady();
}

function safeBgJob(promise, label) {
  return promise.catch(e => {
    console.error(`Background job "${label}" failed (page will still load):`, e);
    return 0;
  });
}

/* ---------------- Loading & error messages ----------------
   Everything the visitor SEES while a page is loading or when something
   goes wrong, in one place:
     - a thin loading bar along the top, and shimmering placeholders over
       the big stat numbers, from requireLogin() until the page's first
       paint (t29FirstPaint above) — so "$0.00" is never shown as if it
       were a real balance while the real one is still on its way. A page
       that doesn't use t29FirstPaint calls t29PageReady() itself.
     - a "still loading" note if that takes more than a few seconds.
     - an "offline" banner whenever the device loses its connection.
     - a "can't connect" screen with a Try again button if the page can't
       even fetch who's logged in (instead of logging them out, which is
       what any failed read used to do).
     - a short message in the corner when an action fails to save because
       of the connection or the database, rather than failing silently.
     - alert() boxes drawn inside the page instead of the browser's own
       ("localhost says...") box. Same words, same buttons — nothing that
       calls alert() needed to change.
   All of these only ever ADD to the page; none of them changes what a
   page does with its data. */
let _t29SessionConnectionFailed = false;
let _t29LoadingStarted = false;
let _t29PageIsReady = false;
let _t29SlowLoadTimer = null;

// True for "couldn't reach Firebase" failures (offline, Wi-Fi dropped,
// server unreachable) as opposed to "Firebase said no".
function t29IsConnectionError(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!e) return false;
  const code = String(e.code || "");
  if (code === "unavailable" || code === "deadline-exceeded" || code === "auth/network-request-failed") return true;
  return /client is offline|network ?error|failed to fetch|network-request-failed|load failed/i.test(String(e.message || e));
}

function t29StartPageLoading() {
  if (_t29LoadingStarted || _t29PageIsReady || typeof document === "undefined" || !document.body) return;
  _t29LoadingStarted = true;
  document.documentElement.classList.add("t29-loading");
  const bar = document.createElement("div");
  bar.id = "t29LoadBar";
  bar.className = "t29-loadbar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Loading");
  document.body.appendChild(bar);
  _t29SlowLoadTimer = setTimeout(() => {
    if (_t29PageIsReady) return;
    t29Toast(navigator.onLine === false
      ? "You're offline — this page will finish loading once you're back online."
      : "Still loading — this is taking longer than usual. A slow connection can do this.", { type: "info", duration: 7000 });
  }, 8000);
  // Never leave the placeholders up forever, whatever happens.
  setTimeout(t29PageReady, 20000);
}

function t29PageReady() {
  if (_t29PageIsReady) return;
  _t29PageIsReady = true;
  clearTimeout(_t29SlowLoadTimer);
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("t29-loading");
  const bar = document.getElementById("t29LoadBar");
  if (bar) {
    bar.classList.add("done");
    setTimeout(() => bar.remove(), 450);
  }
}

// Buttons all over the site switch themselves off for a moment after a
// click (so a double-tap can't do something twice) and back on when the
// work is saved. Switched-off buttons are greyed out (style.css), so mark a
// just-clicked one .t29-busy while that's happening — it keeps its normal
// look instead of flashing grey. Only buttons that really can't be used
// right now go grey.
if (typeof document !== "undefined" && document.addEventListener && typeof MutationObserver !== "undefined") {
  document.addEventListener("click", e => {
    const btn = e.target && e.target.closest ? e.target.closest(".btn") : null;
    if (!btn || btn.disabled || btn.classList.contains("t29-busy")) return;
    btn.classList.add("t29-busy");
    let wasOff = false;
    const obs = new MutationObserver(() => {
      if (btn.disabled) wasOff = true;
      else if (wasOff) done();
    });
    function done() { obs.disconnect(); btn.classList.remove("t29-busy"); }
    obs.observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    // Not switched off straight after the click: nothing to hide.
    setTimeout(() => { if (!btn.disabled) done(); }, 1500);
    // Still off long after: it's genuinely unavailable now, so grey it.
    setTimeout(done, 20000);
  }, true);
}

// Small message in the bottom corner. type: "info" | "success" | "error".
// The same message isn't stacked twice while it's still showing.
// On a phone, tables marked .stack-table show each row as a small card
// with every value labelled (see "Tables on phones" in style.css). The
// labels come from the table's own column headings, copied onto each cell
// as data-label whenever rows are drawn. Only adds an attribute, never
// nodes, so it can't set itself off again.
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const labelStackTables = () => {
    document.querySelectorAll("table.stack-table").forEach(table => {
      const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
      if (!heads.length) return;
      table.querySelectorAll("tbody tr").forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (td.tagName === "TD" && !td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || "");
        });
      });
    });
  };
  let labelQueued = false;
  const queueLabels = () => {
    if (labelQueued) return;
    labelQueued = true;
    requestAnimationFrame(() => { labelQueued = false; labelStackTables(); });
  };
  const startLabelling = () => {
    labelStackTables();
    new MutationObserver(queueLabels).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startLabelling);
  else if (document.body) startLabelling();
}

// Scrolls smoothly to an element (the next step on an "empty" message),
// leaving room for the top bar when it stays on screen.
function t29Jump(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const bar = document.querySelector(".topbar");
  const barH = bar && getComputedStyle(bar).position !== "static" ? bar.getBoundingClientRect().height : 0;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - barH - 12), behavior: "smooth" });
}

function t29Toast(message, opts) {
  opts = opts || {};
  if (typeof document === "undefined" || !document.body) return;
  let wrap = document.getElementById("t29Toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "t29Toasts";
    wrap.className = "t29-toasts";
    wrap.setAttribute("aria-live", "polite");
    document.body.appendChild(wrap);
  }
  const text = String(message === undefined || message === null ? "" : message);
  if ([...wrap.children].some(el => el.dataset.msg === text)) return;
  const el = document.createElement("div");
  el.className = "t29-toast " + (opts.type || "info");
  el.dataset.msg = text;
  el.setAttribute("role", opts.type === "error" ? "alert" : "status");
  el.innerHTML = `<span class="t29-toast-msg"></span><button type="button" class="t29-toast-close" aria-label="Dismiss">&times;</button>`;
  el.querySelector(".t29-toast-msg").textContent = text;
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector(".t29-toast-close").addEventListener("click", remove);
  wrap.appendChild(el);
  setTimeout(remove, opts.duration || 5000);
}

// In-page replacement for the browser's alert() box. Messages queue up
// and show one at a time, like real alerts would.
const _t29AlertQueue = [];
function t29Alert(message) {
  return new Promise(resolve => {
    _t29AlertQueue.push({ message: String(message === undefined || message === null ? "" : message), resolve });
    if (_t29AlertQueue.length === 1) _t29ShowNextAlert();
  });
}
function _t29ShowNextAlert() {
  const item = _t29AlertQueue[0];
  if (!item) return;
  if (!document.body) { document.addEventListener("DOMContentLoaded", _t29ShowNextAlert, { once: true }); return; }
  const returnFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "t29-dialog-overlay";
  overlay.innerHTML = `
    <div class="t29-dialog" role="alertdialog" aria-modal="true" aria-describedby="t29DialogMsg">
      <p class="t29-dialog-msg" id="t29DialogMsg"></p>
      <div class="t29-dialog-actions"><button type="button" class="btn gold">OK</button></div>
    </div>`;
  overlay.querySelector(".t29-dialog-msg").textContent = item.message;
  const okBtn = overlay.querySelector("button");
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    _t29AlertQueue.shift();
    item.resolve();
    if (_t29AlertQueue.length) _t29ShowNextAlert();
    else if (returnFocus && typeof returnFocus.focus === "function") { try { returnFocus.focus(); } catch (e) { /* ignore */ } }
  };
  const onKey = (e) => {
    if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  okBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  okBtn.focus();
}
if (typeof window !== "undefined") window.alert = function (message) { t29Alert(message); };

// Shown instead of the page when it can't even find out who's logged in
// because there's no connection. Reloads by itself once the device is
// back online.
function t29ShowConnectionProblem() {
  t29PageReady();
  if (document.getElementById("t29ConnProblem")) return;
  const box = document.createElement("div");
  box.id = "t29ConnProblem";
  box.className = "t29-conn-problem";
  box.innerHTML = `
    <div class="t29-conn-card" role="alert">
      <h2>Can't connect right now</h2>
      <p>The 29 World couldn't reach its server. Check your Wi-Fi or mobile data, then try again. You're still logged in.</p>
      <button type="button" class="btn gold">Try again</button>
    </div>`;
  box.querySelector("button").addEventListener("click", () => window.location.reload());
  document.body.appendChild(box);
  window.addEventListener("online", () => window.location.reload(), { once: true });
}

function _t29SetOfflineBanner(show) {
  let banner = document.getElementById("t29OfflineBanner");
  if (!show) { if (banner) banner.remove(); return; }
  if (banner) return;
  banner = document.createElement("div");
  banner.id = "t29OfflineBanner";
  banner.className = "t29-offline-banner";
  banner.setAttribute("role", "status");
  banner.textContent = "You're offline. Anything you do won't be saved until you reconnect.";
  document.body.appendChild(banner);
}

// Errors nothing else caught. Connection problems always get a message;
// other database errors only when they come straight after the person
// clicked or typed something (i.e. their action is what failed) — never
// for quiet background work, which already has its own fallbacks.
let _t29LastUserAction = 0;
let _t29LastErrorToast = 0;
let _t29PageLeaving = false;
function _t29ReportUnexpectedError(err) {
  const now = Date.now();
  if (_t29PageLeaving || now - _t29LastErrorToast < 6000) return;
  let msg = null;
  if (t29IsConnectionError(err)) {
    msg = "Couldn't reach the server, so that may not have saved. Check your internet connection and try again.";
  } else if (err && typeof err.code === "string" && now - _t29LastUserAction < 10000) {
    msg = err.code === "permission-denied"
      ? "That didn't go through. Try refreshing the page — if it keeps happening, log out and back in."
      : "Something went wrong and that didn't save. Please try again.";
  }
  if (!msg) return;
  _t29LastErrorToast = now;
  t29Toast(msg, { type: "error", duration: 7000 });
}

if (typeof window !== "undefined") {
  ["pointerdown", "keydown"].forEach(ev =>
    window.addEventListener(ev, () => { _t29LastUserAction = Date.now(); }, { capture: true, passive: true }));
  window.addEventListener("unhandledrejection", e => _t29ReportUnexpectedError(e.reason));
  window.addEventListener("pagehide", () => { _t29PageLeaving = true; });
  window.addEventListener("pageshow", () => { _t29PageLeaving = false; });
  window.addEventListener("offline", () => _t29SetOfflineBanner(true));
  window.addEventListener("online", () => {
    if (!document.getElementById("t29OfflineBanner")) return;
    _t29SetOfflineBanner(false);
    t29Toast("You're back online.", { type: "success", duration: 2500 });
  });
  const _t29CheckOfflineAtStart = () => { if (navigator.onLine === false) _t29SetOfflineBanner(true); };
  if (document.body) _t29CheckOfflineAtStart();
  else document.addEventListener("DOMContentLoaded", _t29CheckOfflineAtStart);
}

/* ===================== Class defaults for new modules ===================== */
function withNewModuleDefaults(cls) {
  if (!cls) return cls;
  // Classes created before report cards existed have no createdAt — leave
  // it unset (null) rather than backdating to "now", since generateClassReport
  // already falls back sensibly (recent txn history, or a 7-day window)
  // when this is missing.
  if (cls.createdAt === undefined) cls.createdAt = null;
  // Archiving pauses a class for students (see requireLogin/archived.html)
  // without deleting anything, so it can still be reopened later or used
  // as a template for a brand new class.
  if (cls.archived === undefined) cls.archived = false;
  if (cls.archivedAt === undefined) cls.archivedAt = null;
  if (cls.templateShareToken === undefined) cls.templateShareToken = null;
  cls.reportArchives = cls.reportArchives || [];
  cls.insurancePlans = cls.insurancePlans || [];
  cls.storeItems = cls.storeItems || [];
  if (cls.storeSortMode === undefined) cls.storeSortMode = "manual";
  cls.storeItems.forEach(it => {
    if (it.stockTotal === undefined) it.stockTotal = it.stock === undefined ? null : it.stock;
    if (it.sold === undefined) it.sold = 0;
  });
  cls.properties = cls.properties || [];
  // Migrate properties saved before renting-out was added — give them a
  // (disabled, i.e. $0) rent setup and no occupancy choice made yet,
  // rather than leaving these fields undefined everywhere downstream.
  cls.properties.forEach(p => {
    if (p.rentPerWeek === undefined) p.rentPerWeek = 0;
    if (p.rentDay === undefined) p.rentDay = "Fri";
    if (p.occupancy === undefined) p.occupancy = null;
    if (p.rentLastWeekPaid === undefined) p.rentLastWeekPaid = null;
    // NZ calendar-date (see nzDateKey) rent was last actually credited to
    // the owner, tracked separately from rentLastWeekPaid (an ISO week
    // key). rentLastWeekPaid alone gets reset to null whenever occupancy
    // changes (see setPropertyOccupancy) so a mid-week switch can't
    // double- or skip-pay that week — but that reset also means a student
    // who changes occupancy again on the same day rent was already paid
    // could otherwise trigger a second payout for the same day. This field
    // is never reset by an occupancy change, only ever set the moment rent
    // is actually paid (see processPropertyRent), so it survives moves and
    // reliably blocks a same-day double payout no matter what the student
    // does with their occupancy in between.
    if (p.rentLastPaidDate === undefined) p.rentLastPaidDate = null;
    // Weekly mortgage interest rate on the listing (percent, 0 = none).
    // Existing mortgages already in progress keep accruing interest-free
    // (payMortgage falls back to weeklyPayment*weeksLeft for
    // principalRemaining and 0 for interestRate on those).
    if (p.mortgageInterestRate === undefined) p.mortgageInterestRate = 0;
    // Teacher-set number of bonus "stars" this specific property is worth
    // (on top of its own comfort rating) when its owner chooses to live in
    // it rather than rent it out — see lifestyleRatingFromData. Properties
    // saved before this existed default to 1, matching the old flat +5
    // bonus closely enough for the default weight of 4 pts/star.
    if (p.livingBonusStars === undefined) p.livingBonusStars = 1;
    // Daily-fluctuating price support (see applyPropertyMarketDayMoves) —
    // properties saved before this feature existed get a fresh one-point
    // history starting at their current price, same treatment
    // openCompany/applyMarketDayMoves give a company with no history yet.
    if (!Array.isArray(p.priceHistory) || p.priceHistory.length === 0) p.priceHistory = [p.price];
    if (!Array.isArray(p.priceHistoryDates) || p.priceHistoryDates.length === 0) p.priceHistoryDates = [nzDateKey()];
    if (p.priceRange === undefined) p.priceRange = null;
    // Cost basis for the "since you bought it" gain/loss a student sees on
    // their own home (see propertyGainSinceBought in property.js). Set at
    // purchase time going forward (buyProperty) and cleared on sell-back
    // (sellProperty) — this migration only ever fires ONCE per property,
    // for records saved before purchasePrice existed: an owned property
    // locks in whatever its price happens to be right now (so it starts
    // this new feature at $0 gain/loss rather than comparing against a
    // price it was never actually bought at), and an unowned one simply
    // has no cost basis yet.
    if (p.purchasePrice === undefined) p.purchasePrice = p.owner ? p.price : null;
  });
  // Class-wide default daily % move range for property listings that don't
  // set their own (see applyPropertyMarketDayMoves). Real estate is meant
  // to feel steadier than the stock market, so this defaults to a gentler
  // band than cls.priceRange's stock default of 1-5%.
  if (!cls.propertyPriceRange) cls.propertyPriceRange = { min: 0.5, max: 2 };
  if (cls.lastPropertyMarketDayRun === undefined) cls.lastPropertyMarketDayRun = null;
  // Teacher-listed rentals with no student owner — "the school" is the
  // landlord. A student rents a unit directly from the teacher's listing
  // (rent, minimum lease, and the lifestyle-rating bonus for living there
  // are all set by the teacher on the listing itself, not chosen by the
  // student the way a classmate sublet's price is). Same flat "units
  // grouped by groupId" shape as cls.properties (see addProperty), just
  // without owner/mortgage/comfort fields since nobody ever buys these.
  cls.npcProperties = cls.npcProperties || [];
  cls.npcProperties.forEach(p => {
    if (p.rentDay === undefined) p.rentDay = "Fri";
    if (p.minWeeks === undefined) p.minWeeks = 1;
    // Direct lifestyle-score points a tenant earns while renting this unit
    // — set by the teacher on the listing, unlike an owned property's
    // comfort/living-bonus which are converted via the property category's
    // points-per-star weight. See lifestyleRatingFromData.
    if (p.lifestylePoints === undefined) p.lifestylePoints = 0;
    if (p.tenant === undefined) p.tenant = null;
    if (p.leaseStartTs === undefined) p.leaseStartTs = null;
    if (p.leaseStartWeekKey === undefined) p.leaseStartWeekKey = null;
    if (p.rentLastWeekPaid === undefined) p.rentLastWeekPaid = null;
    if (p.rentLastPaidDate === undefined) p.rentLastPaidDate = null;
  });
  // Class-wide day mortgage installments are due on (like payDay/interestDay).
  cls.mortgageDay = DAY_NAMES.includes(cls.mortgageDay) ? cls.mortgageDay : "Fri";
  // Teacher-set flat fee charged to a student the moment they move into a
  // new home — either moving into a property they own (setPropertyOccupancy
  // with "living") or moving in as a classmate's tenant (claimSublet). 0 by
  // default (free to move). See setMovingCost, chargeMoveOrThrow.
  if (cls.movingCost === undefined) cls.movingCost = 0;
  // Teacher-set flat fee charged on top of paying off whatever's left on a
  // mortgage when a student sells a mortgaged property back to the class.
  // Never charged on a sale where there's no mortgage in progress. 0 by
  // default (no break fee). See setPropertyBreakFee, sellProperty.
  if (cls.propertyBreakFee === undefined) cls.propertyBreakFee = 0;
  // Teacher manual override: an ISO week key (see isoWeekKey) for which the
  // teacher has declared mortgage payments due *right now*, regardless of
  // what day it actually is. Lets a teacher who missed the normal
  // mortgageDay (or wants to demonstrate a payment on the spot) open up
  // payment for the rest of this week without changing the permanent
  // weekly due day. Naturally expires once the ISO week rolls over — see
  // setMortgageDueOverride, payMortgage, and isMortgagePaymentOverdue.
  if (cls.mortgageForceDueWeek === undefined) cls.mortgageForceDueWeek = null;
  // Life module: teacher-defined "life events" (got married, had a kid,
  // promotion, whatever the class wants) that a teacher grants to one or
  // more students. Each template's `benefits` object is snapshotted onto
  // the student's own record at grant time (see grantLifeItem) so a later
  // edit/removal of the template never retroactively changes what an
  // already-granted student is receiving.
  cls.lifeItems = cls.lifeItems || [];
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
  if (cls.dailyTimeLimitMinutes === undefined) cls.dailyTimeLimitMinutes = null;
  cls.vehicles = cls.vehicles || [];
  // Migrate pre-update vehicles, which stored a single `owner` username,
  // into the current `owners` array so vehicles bought before this change
  // still show up as owned instead of looking unowned.
  cls.vehicles.forEach(v => {
    if (v.owners === undefined) {
      v.owners = v.owner ? [v.owner] : [];
    }
    // Vehicles created before subcategories existed default to "car" so
    // they aren't mistaken for trucks (which require a licence).
    if (!VEHICLE_TYPES.includes(v.type)) v.type = "car";
    if (v.drivePayout === undefined || v.drivePayout === null) v.drivePayout = 0;
    // Weekly running cost charged via payTransportExpenses, and what
    // percentage of the class-wide public transport fee owning this
    // vehicle knocks off (see transportWeeklyAmount). Vehicles saved
    // before this existed default to $0/0% — free to own, no public
    // transport discount — rather than silently starting to cost a
    // student money. Vehicles saved back when the discount was a flat
    // dollar amount (publicTransportOffset) are also swept up here since
    // that old field no longer means anything under the percentage model.
    if (v.weeklyExpense === undefined || v.weeklyExpense === null) v.weeklyExpense = 0;
    if (v.publicTransportOffsetPct === undefined || v.publicTransportOffsetPct === null) v.publicTransportOffsetPct = 0;
    delete v.publicTransportOffset;
  });
  // Class-wide weekly transport expenses: a flat public transport fee every
  // student owes (see transportWeeklyAmount), and the day of the week it's
  // payable on (like mortgageDay/payDay). Vehicles saved before this existed
  // default their own weeklyExpense/publicTransportOffsetPct to 0 above, so
  // an existing class starts this feature completely free until the teacher
  // configures it.
  cls.publicTransportFee = cls.publicTransportFee || { amount: 0, description: "" };
  // Optional per-life-event override of the fee just above, keyed by life
  // item *template* id (see currentLifeTransportFee/setPublicTransportFeeOverrides
  // below) — lets a student currently holding a specific life event pay a
  // different public transport fee than the flat class-wide default.
  // Empty object = no overrides configured, so every student just pays the
  // flat fee, exactly like before this existed.
  cls.publicTransportFeeOverrides = cls.publicTransportFeeOverrides || {};
  cls.transportDay = DAY_NAMES.includes(cls.transportDay) ? cls.transportDay : "Fri";
  cls.truckLicence = cls.truckLicence || { price: 0, description: "" };
  cls.sellBackRates = cls.sellBackRates || {};
  VEHICLE_TYPES.forEach(type => {
    if (cls.sellBackRates[type] === undefined) cls.sellBackRates[type] = 0.85;
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
  // Migrate the old shared "dailyBetCap" (a pure spending cap) into the
  // new "dailyBuyInLimit" (a cap on cash moved into the gambling account)
  // the first time a class with legacy data is loaded — same number,
  // same meaning in practice (most a student could put at risk per day).
  if (cls.gambling.dailyBuyInLimit === undefined) {
    cls.gambling.dailyBuyInLimit = (cls.gambling.dailyBetCap !== undefined && cls.gambling.dailyBetCap !== null)
      ? cls.gambling.dailyBetCap : null;
  }
  if (cls.gambling.dailyWinLimit === undefined) cls.gambling.dailyWinLimit = null;
  if (cls.gambling.winLimitMessage === undefined) {
    cls.gambling.winLimitMessage = "You've hit your winning limit for today \u2014 nice work! Come back and play again tomorrow.";
  }
  cls.blackjack = cls.blackjack || { enabled: true, minBet: 1, maxBet: 20 };
  if (cls.blackjack.enabled === undefined) cls.blackjack.enabled = true;
  if (cls.blackjack.minBet === undefined) cls.blackjack.minBet = 1;
  if (cls.blackjack.maxBet === undefined) cls.blackjack.maxBet = 20;
  cls.taxRates = cls.taxRates || { property: 0, transport: 0, interest: 0, gambling: 0 };
  // Migrate old flat wage rate (if present) into a single bracket the first
  // time a class with legacy data is loaded, so existing tax settings aren't
  // silently lost when brackets are introduced.
  if (!cls.wageTaxBrackets || !cls.wageTaxBrackets.length) {
    const legacyWageRate = cls.taxRates.wage;
    cls.wageTaxBrackets = legacyWageRate ? [{ upTo: null, rate: Number(legacyWageRate) || 0 }] : [];
  }
  delete cls.taxRates.wage;
  // Store and insurance tax were removed — older classes may still have a
  // rate saved for them, which nothing uses any more.
  delete cls.taxRates.store;
  delete cls.taxRates.insurance;
  /* ---- Financial-literacy quizzes (see the Quizzes section below) ----
     cls.quizzes holds the teacher's quiz definitions; cls.quizGate.enabled
     is the single master switch that decides whether failing/not having
     taken a quiz actually LOCKS its module, or whether quizzes are just
     optional practice. Off by default so turning the app's existing
     classes on to this feature can never suddenly lock a student out of a
     module they were using yesterday. */
  cls.quizzes = cls.quizzes || [];
  cls.quizGate = cls.quizGate || {};
  if (cls.quizGate.enabled === undefined) cls.quizGate.enabled = false;

  /* ---- Peer-to-peer marketplace (see the Marketplace section below) ----
     Students listing their own store items / vehicles / properties to each
     other at a price they choose, rather than at the teacher's fixed store
     price. Every limit here is teacher-configurable — the defaults are a
     deliberately conservative starting point (a 25-200% price band around
     the original price, 3 listings each, no approval queue, no fee) so a
     class that never opens the settings still gets something sane. */
  cls.marketplace = cls.marketplace || {};
  const _mp = cls.marketplace;
  if (_mp.enabled === undefined) _mp.enabled = true;
  if (_mp.requireApproval === undefined) _mp.requireApproval = false;
  if (_mp.allowOffers === undefined) _mp.allowOffers = true;
  if (_mp.minPricePct === undefined) _mp.minPricePct = 25;
  if (_mp.maxPricePct === undefined) _mp.maxPricePct = 200;
  if (_mp.maxActiveListings === undefined) _mp.maxActiveListings = 3;
  if (_mp.feePct === undefined) _mp.feePct = 0;
  if (_mp.allowStore === undefined) _mp.allowStore = true;
  if (_mp.allowVehicle === undefined) _mp.allowVehicle = true;
  if (_mp.allowProperty === undefined) _mp.allowProperty = false;
  cls.listings = cls.listings || [];

  /* ---- Peer-to-peer property rentals (see the section just below
     processPropertyRent) ----
     Separate from the Trade Centre above: this is a recurring lease, not a
     one-off sale — ownership never changes hands, a classmate just moves in
     and pays the owner weekly rent instead of the owner earning the
     teacher's flat passive rent. Every limit is teacher-configurable, same
     spirit as cls.marketplace — a class that never opens the settings still
     gets a sane, conservative default. */
  cls.propertyRentals = cls.propertyRentals || {};
  const _pr = cls.propertyRentals;
  if (_pr.enabled === undefined) _pr.enabled = true;
  if (_pr.requireApproval === undefined) _pr.requireApproval = false;
  if (_pr.minPricePct === undefined) _pr.minPricePct = 25;
  if (_pr.maxPricePct === undefined) _pr.maxPricePct = 200;
  if (_pr.maxLeaseWeeks === undefined) _pr.maxLeaseWeeks = 8;

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
  // Migrate legacy flat jobs (wage/description at job level) to the tiered
  // structure. Uses a deterministic tier ID (jobId + "_t0") so this migration
  // is stable across repeated reads — the same ID is generated every time,
  // keeping students' existing jobTierId references valid without a write.
  (cls.jobs || []).forEach(j => {
    if (!j.tiers || j.tiers.length === 0) {
      j.tiers = [{
        id: j.id + "_t0",
        name: j.title || "Tier 1",
        wage: Number(j.wage) || 0,
        description: j.description || ""
      }];
    }
    if (j.autoPromoteWeeks === undefined) j.autoPromoteWeeks = 0;
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

/* ===================== Global page bootstrap =====================
   This runs on EVERY page that loads the data-*.js files (i.e. every page in the app),
   regardless of what that page's own init() does. Three jobs:
   1. Make sure the market simulates itself once per NZ calendar day, even
      if nobody happens to visit the Market page that day.
   1b. Same idea for property prices, so they drift daily even if nobody
      visits the Property page that day — see autoPropertyMarketDayIfDue.
   2. Mount a small floating "cash balance" widget in the corner of the
      screen for logged-in students, so they can see their balance no
      matter which module they're in.
================================================================== */
async function anwGlobalBootstrap() {
  const u = await getSessionUser();
  if (!u) return; // not logged in (e.g. on the login page) — nothing to do
  if (u.classCode) {
    autoMarketDayIfDue(u.classCode).catch(() => {});
    autoPropertyMarketDayIfDue(u.classCode).catch(() => {});
  }
  applyNavRoleVisibility(u.role);
  if (u.role === "student") {
    mountBalanceWidget(u.username);
    showKiwiSaverNavIfOn(u).catch(() => {});
  }
}

// The KiwiSaver menu link stays hidden from students (style.css) if
// their teacher has switched KiwiSaver off — unless they already have one.
async function showKiwiSaverNavIfOn(u) {
  if (!u.classCode || typeof kiwiSaverSettings !== "function") return;
  const [cls, me] = await Promise.all([getClassCached(u.classCode), getUserCached(u.username)]);
  if (!cls) return;
  if (kiwiSaverSettings(cls).enabled || kiwiSaverOf(me)) {
    document.documentElement.classList.add("ks-on");
    if (typeof fitTopbar === "function") fitTopbar();
  }
}

/* ---------------- Balance widget: refresh on actual cash movement ----------------
   This has gone through two more "clever" designs before this one (a live
   Firestore listener, then a MutationObserver watching the page for
   popups) that both turned out to cause real breakage — the observer
   approach in particular caused an infinite loop (any DOM change
   repainted the widget, which was itself a DOM change, forever) that
   froze the page entirely. It also went through a plain 20-second poll,
   which was simple and never looped, but polled the raw balance on a
   timer regardless of what was on screen — including mid-animation on
   Roulette (~15s wheel spin) and Blackjack (seat-by-seat reveal), where
   the server write actually lands the instant the bet settles, well
   before the animation finishes. A poll landing in that window let a
   glance at the corner widget spoil "No peeking..." before the reveal did.

   This version drops the timer entirely: the widget only ever refreshes
   in response to an actual write completing (hooked into the same
   docRef.update/set/delete and fdb.runTransaction wrappers above that
   already exist to invalidate the read cache — see _anwOnWriteSettled
   below), not on a schedule. On every page except Roulette/Blackjack
   that means the widget updates the moment a cash-moving action actually
   happens, which is both more accurate and cheaper than a fixed poll. On
   Roulette/Blackjack specifically, _anwOnWriteSettled skips the refresh
   (see _anwShowsChips) and the page itself calls anwRefreshBalanceWidget()
   once the reveal animation has actually finished — see spin() in
   gambling.js and bjFinalizeRound(). */
let _anwWidgetUsername = null;

// Which sub-tab of the Gambling page is active — "account", "roulette", or
// "blackjack". Only gambling.html's switchMode() ever sets this (via
// anwSetGamblingMode below); it stays null on every other page, which
// _anwShowsChips() below treats the same as "account" (i.e. show cash).
// This is deliberately driven by an explicit call from gambling.js rather
// than read off gambling.js's own MODE variable — mountBalanceWidget can
// run before gambling.js's init() has called switchMode("account") for the
// first time, and refreshing off a global that isn't set yet would show
// the wrong balance until the student happened to switch tabs.
let _anwGamblingMode = null;

function _anwIsGamblingPage() {
  return /(^|\/)gambling\.html/i.test(location.pathname);
}

// On the Account tab, cash is what's actually moving (buy-in/cash-out), so
// the widget shows cash there too — only Roulette and Blackjack, where
// chips are what's being bet, show the chip balance instead.
function _anwShowsChips() {
  return _anwIsGamblingPage() && (_anwGamblingMode === "roulette" || _anwGamblingMode === "blackjack");
}

function _anwWidgetLabelHtml() {
  return _anwShowsChips()
    ? `${icon("dice", 14)} Chips balance`
    : `${icon("piggy", 14)} Cash balance`;
}

// The one place that actually repaints the widget's number. Always an
// uncached, fresh read — deliberately, since this only ever runs right
// after a write we already know just happened (or, on Roulette/
// Blackjack, right after the page confirms the reveal animation is done),
// so there's no benefit to reading a possibly-stale cached copy.
async function anwRefreshBalanceWidget() {
  const el = document.getElementById("anwBalanceWidgetValue");
  if (!el || !_anwWidgetUsername) return;
  try {
    const fresh = await getUser(_anwWidgetUsername);
    if (!fresh) return;
    el.textContent = _anwShowsChips() ? fmtMoney(gamblingAccountToday(fresh).balance) : fmtMoney(fresh.balance);
  } catch (e) {
    console.warn("Balance widget refresh failed:", e);
  }
}

// Called from inside installReadCache()'s write wrappers every time a
// users/classes doc write (direct or transactional) settles — i.e. every
// time the app processes cash of any kind, not on a fixed schedule. On
// Roulette/Blackjack this is deliberately a no-op: those writes land
// mid-animation, and it's up to the gambling page itself to call
// anwRefreshBalanceWidget() once the reveal is actually done (see
// spin()/bjFinalizeRound() in gambling.js). Safe to call from any page,
// including ones with no widget mounted (mountBalanceWidget not yet
// called, or a teacher session) — it just no-ops via the username guard
// inside anwRefreshBalanceWidget.
function _anwOnWriteSettled() {
  if (_anwShowsChips()) return;
  anwRefreshBalanceWidget();
}

// Called by gambling.html's switchMode() every time the student switches
// between the Account/Roulette/Blackjack sub-tabs, so the widget's label
// and value flip immediately to match the new mode, rather than showing
// the wrong balance type until the next cash-moving action.
async function anwSetGamblingMode(mode) {
  _anwGamblingMode = mode;
  const box = document.getElementById("anwBalanceWidget");
  if (!box) return;
  const labelEl = box.querySelector(".anw-bw-label");
  if (labelEl) labelEl.innerHTML = _anwWidgetLabelHtml();
  if (!_anwWidgetUsername) return;
  try {
    const cached = await getUserCached(_anwWidgetUsername);
    const el = document.getElementById("anwBalanceWidgetValue");
    if (cached && el) {
      el.textContent = _anwShowsChips() ? fmtMoney(gamblingAccountToday(cached).balance) : fmtMoney(cached.balance);
    }
  } catch (e) {
    // The next cash-moving action (or the next tab switch) will pick it up.
  }
}

async function mountBalanceWidget(username) {
  if (document.getElementById("anwBalanceWidget")) return;
  const box = document.createElement("div");
  box.id = "anwBalanceWidget";
  box.className = "anw-balance-widget";
  box.innerHTML = `
    <div class="anw-bw-label">${_anwWidgetLabelHtml()}</div>
    <div class="anw-bw-value" id="anwBalanceWidgetValue">—</div>
  `;
  document.body.appendChild(box);
  positionBalanceWidget();
  window.addEventListener("resize", positionBalanceWidget);

  const cached = await getUserCached(username);
  if (cached) {
    box.querySelector("#anwBalanceWidgetValue").textContent = _anwShowsChips()
      ? fmtMoney(gamblingAccountToday(cached).balance)
      : fmtMoney(cached.balance);
  }

  _anwWidgetUsername = username;
}

// Sits just under the sticky top nav bar, on the left, rather than being
// hard-pinned to the literal viewport corner — avoids overlapping the
// brand logo, and re-runs on resize since the nav can wrap to two rows on
// narrow screens.
function positionBalanceWidget() {
  const topbar = document.querySelector(".topbar");
  const widget = document.getElementById("anwBalanceWidget");
  if (!topbar || !widget) return;
  // Sidebar navigation on a wide screen turns .topbar into a full-height
  // rail (its own left offset comes from sidebar-nav.css), so the usual
  // "just under the topbar" math doesn't apply — pin it near the top
  // instead of computing from topbar.bottom (which would be ~100vh).
  const sidebarRail = document.documentElement.classList.contains("sidebar-nav") && window.innerWidth > 900;
  if (sidebarRail) { widget.style.top = "20px"; return; }
  if (window.innerWidth <= 640) { widget.style.top = ""; return; } // mobile: CSS pins it to the bottom instead
  widget.style.top = (topbar.getBoundingClientRect().bottom + 10) + "px";
}

document.addEventListener("DOMContentLoaded", anwGlobalBootstrap);
