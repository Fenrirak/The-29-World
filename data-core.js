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

// A username is used as a database document name, so a few characters can't be allowed. Returns a
// friendly message when the username can't be used, or "" when it is fine.
function t29UsernameProblem(username) {
  const u = String(username === undefined || username === null ? "" : username).trim();
  if (!u) return "Enter a username.";
  if (/\s/.test(u)) return "Usernames can't have spaces. Try something like sam.lee";
  if (/[\/\\]/.test(u) || u === "." || u === ".." || /^__.*__$/.test(u)) return "Usernames can't have slashes. Try letters, numbers, dots or dashes, like sam.lee";
  return "";
}

// Name helpers shared by the signup page and the teacher's bulk "Add students" box, so a
// student who joins themselves and one a teacher adds end up with the same kind of name
// and username.
const T29_LETTER_FIXES = { "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };

// "Māia O'Brien" -> "maia" / "obrien": accents and macrons dropped, anything that isn't a
// letter or number removed, so it's always a safe username.
function t29NameSlug(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[øßæœłđðþı]/g, (c) => T29_LETTER_FIXES[c])
    .replace(/[^a-z0-9]/g, "");
}

// Names typed all lower-case or all CAPS get tidied ("aroha smith" -> "Aroha Smith"); a
// name with its own capitals ("Mc Donald", "de Vries") is left alone.
function t29TidyName(name) {
  if (!/\p{L}/u.test(name)) return name;
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// The titles a teacher can pick when they sign up, and how a teacher is shown to students:
// "Ms Smith" when they picked one, "Ms/Mr <name>" for older accounts that never did.
const T29_TEACHER_TITLES = ["Mr", "Ms", "Mrs", "Miss", "Dr"];
function t29DisplayName(u) {
  if (!u) return "";
  if (u.role !== "teacher") return u.name || "";
  return u.title ? u.title + " " + (u.lastName || u.name || "") : "Ms/Mr " + (u.name || "");
}

// "Sam" + "Lee" -> "sam.lee" (the same first.last style the bulk creator uses by default).
function t29SuggestUsername(first, last) {
  const f = t29NameSlug(first), l = t29NameSlug(last);
  const b = (f && l) ? f + "." + l : (f || l);
  return b.slice(0, 24).replace(/\.+$/, "");
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

// A getClass() on a code that doesn't exist yet is DENIED by firestore.rules
// for existing users (the rule reads resource.data on a missing doc), so treat
// any failed lookup as "free" instead of letting it abort class creation.
async function _freshClassCode() {
  let code;
  do { code = genCode(5); } while (await getClass(code).catch(() => null));
  return code;
}

// Unique within a page (a counter, so ids made in the same millisecond - e.g.
// inside a .map() - can never match) and very unlikely to match one made on
// another device (random part). Fixed-width tail, so ids can't run together.
let _uidSeq = 0;
function uid(prefix) {
  _uidSeq = (_uidSeq + 1) % 1296;
  const rnd = Math.floor(Math.random() * 1296);
  return prefix + "_" + Date.now().toString(36) + _uidSeq.toString(36).padStart(2, "0") + rnd.toString(36).padStart(2, "0");
}

function fmtMoney(n) {
  // Student view: the teacher's bank never runs out. Its stand-in balance (T29_SV_CASH) reads "Unlimited".
  if (Number(n) === T29_SV_CASH && t29SvActive()) return "Unlimited ∞";
  const v = Math.round((Number(n) || 0) * 100) / 100; // round first, so -0.004 shows "$0.00", not "-$0.00"
  // Sign goes in front of the "$" ("-$5.00", not "$-5.00").
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // fixed locale, so every device shows 1,234.50
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
// One shared in-flight sync: anything that needs the corrected clock (the bell, the auto sims)
// can await this without each starting its own probe write on the class doc.
let _clockSyncPromise = null;
function syncServerClock(classCode) {
  if (SERVER_CLOCK_SYNCED || !classCode) return Promise.resolve();
  return _clockSyncPromise || (_clockSyncPromise = _syncServerClockImpl(classCode));
}
async function _syncServerClockImpl(classCode) {
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
    // A merge write on an unread document can create a local snapshot with
    // only _clockProbe. Prime it first, so first paint cannot see an empty
    // class. This read coalesces with the page's own in-flight class read.
    await getClass(classCode);
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

async function getUser(username, options) {
  if (!username) return null;
  await T29_AUTH_READY; // firestore.rules requires request.auth != null
  if (options?.fresh) {
    const snap = await usersCol().doc(username).get({ source: "server" });
    return snap.exists ? _cloneDoc(snap.data()) : null;
  }
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

// Display-only identity: pages must not fail after a successful action
// because the teacher's optional display name cannot be read. Older
// published rules deny this read when the teacher opens a different class.
// Never use this partial object for balances, permissions or payments.
async function getClassTeacherDisplay(cls) {
  if (!cls || !cls.teacher) return null;
  const fallback = { username: cls.teacher, name: cls.teacher };
  try {
    const teacher = await getUserCached(cls.teacher);
    return teacher ? { username: cls.teacher, name: teacher.name || cls.teacher } : fallback;
  } catch (e) {
    if (e && e.code === "permission-denied") return fallback;
    throw e;
  }
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
  // rather than one per 30. getUser() already coalesces duplicate
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
window._rcDel = function () {};

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
  // ttlMs is optional: live listeners (t29WatchDoc, below) keep a doc fresh for longer.
  window._rcSet = function (col, id, value, ttlMs) {
    store.set(cacheKey(col, id), { value, expires: Date.now() + (ttlMs || CACHE_TTL_MS) });
  };
  window._rcDel = function (col, id) { store.delete(cacheKey(col, id)); };

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
/* ---------------- Live documents (Firestore listeners) ----------------
   t29WatchDoc("users" | "classes", id, callback) replaces polling. One listener is
   kept per document however many callers want it, and what it hears is also put in
   the read cache above, so getUserCached()/getClassCached() answer from the live
   copy without a Firestore read. Firestore bills one read when a listener starts and
   one for each change after that, so a page left open and idle costs almost nothing.
   The callback gets (data, info): data is a private copy of the document (null if
   it doesn't exist); info.fromCache / info.hasPendingWrites describe the snapshot,
   and info.error is set if the listener died (permissions, sign-out), which is the
   caller's cue to fall back to its old timer. Returns a function that stops listening
   (the listener itself is dropped once its last caller leaves).
   Class docs also change whenever any session syncs its clock (_clockProbe), so the
   callback is skipped for a change that touches only that field. */
const LIVE_TTL_MS = 10 * 60000;
const _liveDocs = new Map();
function t29WatchDoc(col, id, cb) {
  if (!id || (col !== "users" && col !== "classes") || typeof cb !== "function") return function () {};
  installReadCache();
  const key = col + "/" + id;
  let w = _liveDocs.get(key);
  if (!w) {
    w = { subs: new Set(), has: false, data: null, sig: null, unsub: null, keep: null, dead: false };
    _liveDocs.set(key, w);
    const live = w;
    const prime = () => { if (live.has && live.data) window._rcSet(col, id, _cloneDoc(live.data), LIVE_TTL_MS); };
    const tell = (data, info) => live.subs.forEach(fn => {
      try { fn(_cloneDoc(data), info); } catch (e) { console.warn("Live update handler failed:", e); }
    });
    live.keep = setInterval(prime, 4 * 60000); // the cache entry outlives quiet stretches
    T29_AUTH_READY.then(() => {
      if (live.dead) return;
      const ref = (col === "users" ? usersCol() : classesCol()).doc(id);
      live.unsub = ref.onSnapshot({ includeMetadataChanges: true }, snap => {
        let data = snap.exists ? snap.data() : null;
        if (data && col === "classes") data = withNewModuleDefaults(data);
        const sig = JSON.stringify(data, (k, v) => (k === "_clockProbe" ? undefined : v));
        const info = snap.metadata || {};
        const confirmed = !info.fromCache && !info.hasPendingWrites;
        const changed = !live.has || sig !== live.sig || (confirmed && !live.confirmed);
        live.confirmed = confirmed;
        live.info = info;
        live.has = true; live.sig = sig; live.data = data;
        prime();
        if (changed) tell(data, info);
      }, err => {
        // Listener ended: forget it so the next watch starts a fresh one, and let callers fall back.
        clearInterval(live.keep);
        window._rcDel(col, id);
        if (_liveDocs.get(key) === live) _liveDocs.delete(key);
        tell(undefined, { error: err || true });
      });
    }).catch(() => {});
  }
  w.subs.add(cb);
  if (w.has) { // joining late: hand over the current copy straight away
    const cur = w;
    Promise.resolve().then(() => { if (cur.subs.has(cb)) { try { cb(_cloneDoc(cur.data), cur.info || {}); } catch (e) { console.warn("Live update handler failed:", e); } } });
  }
  return function stopWatching() {
    const cur = w;
    if (!cur.subs.delete(cb) || cur.subs.size) return;
    cur.dead = true;
    clearInterval(cur.keep);
    if (cur.unsub) { try { cur.unsub(); } catch (e) { /* already stopped */ } }
    window._rcDel(col, id);
    if (_liveDocs.get(key) === cur) _liveDocs.delete(key);
  };
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
  // A different person signing in: forget the remembered role (it only drives first-paint defaults,
  // e.g. the teacher side menu) until requireLogin() confirms the new one.
  try {
    const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!prev || prev.username !== username) localStorage.removeItem("t29-role");
  } catch (e) { /* ignore */ }
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
  // Student view (see the end of this file): a teacher using the app as a student is handed back as one.
  return t29SvViewOf(u);
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  try { localStorage.removeItem("t29-role"); } catch (e) { /* ignore */ }
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
  if (u && u._studentView) return; // a teacher in student view isn't on the clock
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

/* ---------------- Presence: "last opened" + "online now" (students -> teacher) ----
   The teacher dashboard shows, for each student, whether they're on the site right
   now and when they last opened it, plus an "N/M online" count beside the Students
   header. It's built to cost almost nothing in Firestore reads and writes.

   STORAGE: one small doc per CLASS, presence/{classCode}, holding a map
     p: { <username>: { o: <visit start>, a: <last ping>, off: <signed out> } }
   Every time is a SERVER timestamp, so a wrong device clock can't skew it, and
   firestore.rules pins `a` to the real server time.

   WRITES (student side):
     - one blind merge write (no read, no transaction) of just that student's own
       entry, about once per 2 minutes while they're actually looking at the site.
       Nothing is written while the tab is hidden, or after 5 minutes with no
       click / key / touch / scroll.
     - the site is many separate pages, so the time of the last ping is kept in
       localStorage and shared by every page and tab: moving between pages does NOT
       write again until a ping is actually due.
     - `o` (start of the visit = "last opened the site") is only written when a new
       visit begins (no ping for 5 minutes, or the first load after a logout).
     - logging out writes one final "off" so the teacher sees them leave at once;
       just closing a tab times out instead ("online" = pinged in the last 3 min).

   READS (teacher side): ONE document read covers the whole class, with no
   per-student reads at all (see t29LoadPresence). The dashboard re-reads it about
   once a minute, and only while its tab is visible.

   Best-effort throughout: never throws, never blocks or breaks a page. If a write
   is refused (e.g. the new rules aren't published yet) it stops trying for that
   page view. */
const T29_PRESENCE_BEAT_MS = 2 * 60 * 1000;       // ping this often while active
const T29_PRESENCE_ONLINE_MS = 3 * 60 * 1000;     // pinged within this long ago = online now
const T29_PRESENCE_VISIT_GAP_MS = 5 * 60 * 1000;  // no ping for this long = the next one starts a new visit
const T29_PRESENCE_IDLE_MS = 5 * 60 * 1000;       // no interaction for this long = not "on" the site

let _presenceCtx = null;            // { ref, username, storeKey } once running on this page
let _presenceDead = false;
let T29_PRESENCE_READ_DENIED = false;

function startPresence(u) {
  if (_presenceCtx || !u || u.role !== "student" || u._studentView || !u.username || !u.classCode) return;
  const ctx = _presenceCtx = {
    ref: fdb.collection("presence").doc(u.classCode),
    username: u.username,
    storeKey: "t29_presence_" + u.classCode + "_" + u.username
  };
  const sv = () => firebase.firestore.FieldValue.serverTimestamp();
  let lastInteract = Date.now();
  let memMark = 0;      // fallback when localStorage is unavailable (private mode)
  let busy = false;

  // Device time of the last successful ping, shared by every page/tab. Only ever used
  // to decide WHEN to write; the stored times are server timestamps.
  const readMark = () => {
    let n = 0;
    try { n = Number(localStorage.getItem(ctx.storeKey)) || 0; } catch (e) { /* ignore */ }
    n = Math.max(n, memMark);
    return n > 0 && n <= Date.now() + 60000 ? n : 0; // a mark from the "future" means the clock moved: ignore it
  };

  async function beat() {
    if (_presenceDead || busy || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastInteract > T29_PRESENCE_IDLE_MS) return;
    const mark = readMark();
    if (mark && now - mark < T29_PRESENCE_BEAT_MS - 5000) return; // another page/tab pinged recently
    const newVisit = !mark || now - mark > T29_PRESENCE_VISIT_GAP_MS;
    const entry = newVisit ? { o: sv(), a: sv(), off: false } : { a: sv(), off: false };
    busy = true;
    try {
      await ctx.ref.set({ p: { [ctx.username]: entry } }, { merge: true });
      memMark = Date.now();
      try { localStorage.setItem(ctx.storeKey, String(memMark)); } catch (e) { /* ignore */ }
    } catch (e) {
      // Refused (rules not published yet / not allowed): stop for this page view.
      // Anything else (offline, blip) just waits for the next scheduled ping.
      if (e && e.code === "permission-denied") _presenceDead = true;
    } finally {
      busy = false;
    }
  }

  const touch = () => {
    const now = Date.now();
    const gap = now - lastInteract;
    if (gap < 1000) return;               // one gesture fires a burst of events: ignore the rest
    lastInteract = now;
    if (gap > T29_PRESENCE_IDLE_MS) beat(); // back from idle: show as online straight away
  };
  ["pointerdown", "pointermove", "keydown", "touchstart", "scroll", "wheel"].forEach(ev =>
    window.addEventListener(ev, touch, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { lastInteract = Date.now(); beat(); }
  });

  // The small random delay stops a whole class that opens the site at the same moment
  // from all writing to the one class doc in the same instant.
  setTimeout(beat, Math.random() * 3000);
  setInterval(beat, T29_PRESENCE_BEAT_MS);
}

// Called by logout(): marks the student as offline and forgets the shared "last ping"
// so the NEXT login starts a fresh visit (and its time is written immediately).
async function t29PresenceOnLogout() {
  const c = _presenceCtx;
  if (!c) return;
  _presenceDead = true;
  try { localStorage.removeItem(c.storeKey); } catch (e) { /* ignore */ }
  try {
    await Promise.race([
      c.ref.set({ p: { [c.username]: { a: firebase.firestore.FieldValue.serverTimestamp(), off: true } } }, { merge: true }),
      new Promise(resolve => setTimeout(resolve, 1200))
    ]);
  } catch (e) { /* the 3-minute timeout covers it */ }
}

// Teacher side. ONE document read for the whole class, straight from the server (never
// a stale cached copy). Returns { username: { opened, active, off } } (times in ms), or
// null if it couldn't be loaded. Never throws.
async function t29LoadPresence(classCode) {
  try {
    if (!classCode) return null;
    const snap = await fdb.collection("presence").doc(classCode).get({ source: "server" });
    const p = (snap.exists && snap.data() && snap.data().p) || {};
    const ms = v => (v && typeof v.toMillis === "function") ? v.toMillis() : 0;
    const out = {};
    Object.keys(p).forEach(name => {
      const e = p[name] || {};
      out[name] = { opened: ms(e.o), active: ms(e.a), off: e.off === true };
    });
    T29_PRESENCE_READ_DENIED = false;
    return out;
  } catch (e) {
    if (e && e.code === "permission-denied") T29_PRESENCE_READ_DENIED = true;
    else console.warn("t29LoadPresence failed:", e);
    return null;
  }
}

// "On the site right now": signed in, and pinged within the last few minutes.
function t29IsOnline(entry) {
  if (!entry || entry.off || !entry.active) return false;
  return trustedNow().getTime() - entry.active <= T29_PRESENCE_ONLINE_MS;
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
      ` <strong>${className ? String(className).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) + ": " : ""}Archived class.</strong> You're strolling down memory lane, everything here is view-only.`;
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
  // Remembered so every page can pick the right navigation default before it draws (a teacher viewing as a student doesn't change it).
  if (!u._studentView) { try { localStorage.setItem("t29-role", u.role); } catch (e) { /* ignore */ } }
  T29_SESSION_USERNAME = u.username;
  T29_SESSION_NAME = u.name || null;
  // Teachers may sign up before creating/joining a class. Module pages
  // need an open class; Teacher Home (skipActivity) works without one.
  if (u.role === "teacher" && !u.classCode && !opts.skipActivity) {
    window.location.href = "teacher-home.html";
    return null;
  }
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
  if (u.role === "student" && !u._studentView && !opts.skipTimeLimit && !archivedReadOnly) {
    if (timeLimitStatus(u).reached) {
      window.location.href = "timeup.html";
      return null;
    }
    startTimeTracking(u);
  }
  // Teacher dashboard's "online now" / "last opened" (cheap, best-effort; see Presence above).
  if (u.role === "student" && !archivedReadOnly) startPresence(u);
  // Counts towards the class's 3-month inactivity clock (never blocks the page).
  // Teacher Home passes skipActivity: just browsing the list isn't using a class.
  if (!opts.skipActivity && !archivedReadOnly && !u._studentView) t29TouchClassActivity(u).catch(() => {});
  return u;
}
// BUGFIX: logging out used to only forget the username in localStorage —
// the browser stayed signed in to Firebase as that person, so on a shared
// classroom computer the next person to sit down still had the previous
// account's database access. Now signs out of Firebase too (capped at a
// couple of seconds so a slow connection can't trap anyone on the page).
async function logout() {
  if (t29SvActive()) await t29SvExit({ redirect: false }); // leave student view first, so its changes are cleared
  await t29PresenceOnLogout(); // best-effort, capped at ~1s, needs the login still valid
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
let T29_SESSION_NAME = null; // display name, so a request to the teacher can say who it's from without a read
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
    interestRate: 1, txns: [],
    createdAt: Date.now(), reportArchives: [],
    archived: false, archivedAt: null,
    // Auto-archive: lastActivityAt is bumped whenever anyone (teacher, co-teacher
    // or student) uses the class (see t29TouchClassActivity); a class nobody has
    // touched for 3 months is archived by t29AutoArchiveStaleClasses().
    lastActivityAt: Date.now(), autoArchived: false,
    // Up to 2 other teacher accounts who can run the class with the owner.
    // coTeacherCode is a single-use join code the owner hands to a co-teacher.
    coTeachers: [], coTeacherCode: null,
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
    insurancePlans: [], storeItems: [], properties: [],
    eventDefs: [], eventLog: [], lastEventWeekRun: null,
    vehicles: [], termDepositPlans: [],
    truckLicence: { price: 0, description: "" },
    sellBackRates: { car: 0.8, truck: 0.85, bike: 0.75 },
    propertyBreakFee: 0,
    sideHustles: [],
    lifestyleLock: { threshold: 0, modules: [] },
    dailyTimeLimitMinutes: null, // null/0 = no limit; minutes of active time per student per day
    welcomeGrant: 20, // what each new student starts with — see t29WelcomeGrantOf()
    interestAuto: false, interestFrequency: "weekly", interestDay: "Fri",
    insuranceDay: "Fri",
    gambling: {
      // The casino starts OFF for every new class (and the base template).
      // The teacher switches it on from the Gambling page; while it's off
      // students don't see it in the top bar at all.
      enabled: false, minBet: 1, maxBet: 20,
      // dailyBuyInLimit caps how much a student can move from cash into
      // their gambling account per NZ calendar day (null = no limit).
      // dailyWinLimit locks them out of gambling for the rest of the day
      // once their NET winnings (wins minus losses) reach it, and shows
      // winLimitMessage when that happens.
      dailyBuyInLimit: null, dailyWinLimit: null,
      winLimitMessage: "You've hit your winning limit for today. Nice work! Come back and play again tomorrow.",
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
const T29_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function createTeacherAndClass(name, username, password, className, extra) {
  // Firebase itself already refuses to create an account with a password
  // under 6 characters (see t29AuthErrorMessage's "auth/weak-password"
  // case below) — this check just catches that instantly, client-side,
  // instead of making a round trip to Firebase first just to get told
  // the same thing.
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  { const uProblem = t29UsernameProblem(username); if (uProblem) return { ok: false, error: uProblem }; }

  name = sanitizeUserText(name, 60);
  className = sanitizeUserText(className, 60);
  // A teacher can create a class now, join with a co-teacher code, or
  // leave class setup until later. Existing callers still create a class.
  extra = extra || {};
  const classMode = extra.classMode || "create";
  if (!["create", "join", "later"].includes(classMode)) return { ok: false, error: "Choose how to set up your class." };
  if (classMode === "create" && !className) return { ok: false, error: "Enter a class name." };
  if (classMode === "join" && !t29ParseCoTeacherCode(extra.coTeacherCode)) {
    return { ok: false, error: "Enter the co-teacher code from the class owner, e.g. F7K2M-AB12CD34." };
  }
  const title = T29_TEACHER_TITLES.includes(extra.title) ? extra.title : "";
  const lastName = sanitizeUserText(extra.lastName, 60);
  // Optional recovery email (lets the teacher reset a forgotten password). Blank = none.
  const recoveryEmail = String(extra.email || "").trim().toLowerCase();
  if (recoveryEmail && !T29_EMAIL_RE.test(recoveryEmail)) {
    return { ok: false, error: "That email address doesn't look right. Fix it, or leave it blank. It's optional." };
  }

  // These two checks run before the visitor is signed in, which
  // firestore.rules can refuse. A refused check must not stop the signup
  // dead (it used to throw, and the form just sat there doing nothing) —
  // a taken username is still caught further down, by Firebase Auth
  // ("email-already-in-use") and by the /users create rule.
  const existing = await getUser(username).catch(() => null);
  if (existing) return { ok: false, error: "That username is already taken. Try adding a number to the end." };

  let code = null;
  if (classMode === "create") code = await _freshClassCode();

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
  if (title) { user.title = title; if (lastName) user.lastName = lastName; }
  const cls = code ? defaultClassData(code, className, username) : null;

  try {
    const recoveryHash = recoveryEmail ? await t29RecoveryHash(username, recoveryEmail) : "";
    await fdb.runTransaction(async (t) => {
      t.set(fdb.collection("uidIndex").doc(cred.user.uid), { username });
      t.set(usersCol().doc(username), user);
      if (cls) t.set(classesCol().doc(code), cls);
      // Kept apart from the /users doc (which classmates can read): only this teacher can read it.
      if (recoveryEmail) t.set(fdb.collection("teacherRecovery").doc(username), { email: recoveryEmail });
      if (recoveryHash) t.set(fdb.collection("recoveryCheck").doc(username), { hash: recoveryHash });
    });
  } catch (e) {
    console.warn("Teacher signup failed:", e && (e.code || e.message), e);
    // Don't leave an orphaned Auth account with no matching app data.
    await cred.user.delete().catch(() => {});
    return { ok: false, error: "Something went wrong creating your account. Please try again." };
  }

  setSession(username, 0);
  if (classMode === "join") {
    // The new teacher identity must be committed before the existing
    // co-teacher join rule can check it. A failed/used code leaves a usable
    // account on Teacher Home, never an unwanted empty class.
    try {
      const joined = await t29JoinAsCoTeacher(username, extra.coTeacherCode);
      if (!joined.ok) return { ok: true, code: null, joinError: joined.error };
      const opened = await switchActiveClass(username, joined.classCode);
      if (!opened.ok) return { ok: true, code: null, joinError: opened.error };
      code = joined.classCode;
    } catch (e) {
      return { ok: true, code: null, joinError: "Check your connection and try joining or opening the class again." };
    }
  }
  return { ok: true, code };
}

// Turns a firebase.auth() error into the kind of short, user-facing
// message this app already shows for every other form error.
function t29AuthErrorMessage(e) {
  switch (e && e.code) {
    case "auth/email-already-in-use": return "That username is already taken. Try adding a number to the end.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/invalid-email": return "That username can't be used. Try letters and numbers only.";
    case "auth/network-request-failed": return "Can't connect right now. Check your internet connection and try again.";
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
  // PERF: both queries run at the same time instead of one after the other.
  // The co-teacher query is best effort: if it is ever refused, their own
  // classes must still load.
  const ownQuery = classesCol().where("teacher", "==", username).get();
  const coQuery = classesCol().where("coTeachers", "array-contains", username).get()
    .catch(e => { console.warn("Co-teacher classes unavailable:", e && e.code); return null; });
  const [snap, coSnap] = await Promise.all([ownQuery, coQuery]);
  const list = [];
  const seen = new Set();
  const add = (doc, isOwner) => {
    // PERF: only a few plain fields are read below, so skip the deep copy and
    // module defaults (they cost real time on big class docs). data() is already a fresh object.
    const cls = doc.data();
    if (seen.has(cls.code)) return;
    seen.add(cls.code);
    list.push({
      code: cls.code,
      name: cls.name,
      createdAt: cls.createdAt || null,
      archived: !!cls.archived,
      archivedAt: cls.archivedAt || null,
      autoArchived: !!cls.autoArchived,
      lastActivityAt: cls.lastActivityAt || null,
      studentCount: (cls.students || []).length,
      isOwner,
      ownerUsername: cls.teacher,
      coTeachers: cls.coTeachers || []
    });
  };
  snap.forEach(doc => add(doc, true));
  if (coSnap) coSnap.forEach(doc => add(doc, false));
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

// "Create a brand new class" from Home — identical result to the original
// teacher signup flow's class half, just without creating another account.
async function createClassForTeacher(teacherUsername, className) {
  const teacher = await getUser(teacherUsername);
  if (!teacher || teacher.role !== "teacher") return { ok: false, error: "Teacher account not found." };
  if (!className || !className.trim()) return { ok: false, error: "Enter a class name." };

  const code = await _freshClassCode();
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
  cls.welcomeGrant = t29WelcomeGrantOf(template);
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
  cls.propertyBreakFee = Math.max(0, Number(template.propertyBreakFee) || 0);
  cls.movingCost = Math.max(0, Number(template.movingCost) || 0);
  cls.propertyRentals = _cloneDoc(template.propertyRentals || {});
  cls.storeSortMode = template.storeSortMode || "manual";
  // Credit card / bank account plans + settings and the avatar shop setup are
  // teacher configuration too, so they travel with the template (only when set).
  ["cardPlans", "cardSettings", "accountPlans", "accountSettings", "avatarShop"].forEach(k => {
    if (template[k] !== undefined && template[k] !== null) cls[k] = _cloneDoc(template[k]);
  });
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
    "templateShareToken", "automations", "jobApplications", "eventLog", "bigEventLog",
    "lastActivityAt", "autoArchived", "coTeachers", "coTeacherCode"].forEach(k => { delete t[k]; });
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

  const code = await _freshClassCode();
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
  if (!template) return { ok: false, error: "This link needs refreshing. Ask the teacher who sent it to click Share Template on that class again, then use the link again." };

  const code = await _freshClassCode();
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
  if (!t29CanTeachClass(cls, teacherUsername)) return { ok: false, error: "You don't have permission to open this class." };
  await usersCol().doc(teacherUsername).update({ classCode });
  return { ok: true };
}

// Archiving just pauses a class for students (see requireLogin below and
// archived.html) — nothing is deleted, and it can be reopened, or still
// used as a "new class from template" source, at any time.
async function setClassArchived(classCode, archived) {
  // Reopening also restarts the 3-month inactivity clock — otherwise a class
  // that was auto-archived would be archived again straight away.
  await classesCol().doc(classCode).update({
    archived: !!archived,
    archivedAt: archived ? Date.now() : null,
    autoArchived: false,
    lastActivityAt: Date.now()
  });
  return { ok: true };
}

/* ---------------- Auto-archive after 3 months of inactivity ----------------
   "Activity" = anyone in the class (teacher, co-teacher or student) opening
   any page: requireLogin() calls t29TouchClassActivity(), which stamps
   cls.lastActivityAt (at most once every 6 hours, to keep writes few).
   There's no server in this app, so the check itself runs when a teacher
   opens Teacher Home (see teacher-home.js): any class there whose last
   activity is more than 3 calendar months ago is archived, with a flag so
   it can say it was archived automatically. Reopening it restarts the clock. */
const T29_TOUCH_EVERY_MS = 6 * 60 * 60 * 1000;
function t29InactiveCutoffMs(now) {
  const d = new Date(now || Date.now());
  d.setMonth(d.getMonth() - 3);
  return d.getTime();
}
async function t29TouchClassActivity(u) {
  if (!u || !u.classCode) return;
  const cls = await getClassCached(u.classCode);
  if (!cls || cls.archived) return;
  if (Date.now() - (Number(cls.lastActivityAt) || 0) < T29_TOUCH_EVERY_MS) return;
  await classesCol().doc(u.classCode).update({ lastActivityAt: Date.now() });
}
// Takes the list from getTeacherClasses(); returns it with any stale class now
// marked archived. Classes with no activity stamp yet get one (clock starts now).
async function t29AutoArchiveStaleClasses(classes) {
  const cutoff = t29InactiveCutoffMs();
  // PERF: classes are checked at the same time, not one write after another.
  await Promise.all(classes.map(async c => {
    if (c.archived) return;
    try {
      if (!c.lastActivityAt) {
        await classesCol().doc(c.code).update({ lastActivityAt: Date.now() });
        c.lastActivityAt = Date.now();
      } else if (c.lastActivityAt < cutoff) {
        const now = Date.now();
        await classesCol().doc(c.code).update({ archived: true, archivedAt: now, autoArchived: true });
        c.archived = true; c.archivedAt = now; c.autoArchived = true;
      }
    } catch (e) { console.warn("Auto-archive check failed for", c.code, e && e.code); }
  }));
  return classes;
}

/* ---------------- Co-teachers (up to 2 per class) ----------------
   The owner (cls.teacher) makes a single-use join code; another teacher
   account enters it on Teacher Home and is added to cls.coTeachers. A
   co-teacher can open and run the class like the owner, but can't delete it,
   share it as a template, or change who the co-teachers are. */
const T29_MAX_CO_TEACHERS = 2;
function t29CanTeachClass(cls, username) {
  return !!cls && !!username && (cls.teacher === username || (Array.isArray(cls.coTeachers) && cls.coTeachers.includes(username)));
}
async function t29CreateCoTeacherCode(classCode, ownerUsername) {
  const cls = await getClass(classCode);
  if (!cls || cls.teacher !== ownerUsername) return { ok: false, error: "Only the class owner can invite co-teachers." };
  if ((cls.coTeachers || []).length >= T29_MAX_CO_TEACHERS) return { ok: false, error: "This class already has " + T29_MAX_CO_TEACHERS + " co-teachers." };
  const secret = genCode(8);
  await classesCol().doc(classCode).update({ coTeacherCode: secret });
  return { ok: true, code: classCode + "-" + secret };
}
async function t29CancelCoTeacherCode(classCode, ownerUsername) {
  const cls = await getClass(classCode);
  if (!cls || cls.teacher !== ownerUsername) return { ok: false, error: "Only the class owner can do this." };
  await classesCol().doc(classCode).update({ coTeacherCode: null });
  return { ok: true };
}
// Run by the teacher who wants to join. The class is written to without being
// read first (they aren't a member yet), and firestore.rules checks the code.
function t29ParseCoTeacherCode(input) {
  return String(input || "").trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z0-9]{5})-([A-Z0-9]{8})$/);
}
async function t29JoinAsCoTeacher(teacherUsername, input) {
  const m = t29ParseCoTeacherCode(input);
  if (!m) return { ok: false, error: "That doesn't look like a co-teacher code. It looks like F7K2M-AB12CD34." };
  const [, classCode, secret] = m;
  try {
    await classesCol().doc(classCode).update({
      coTeachers: firebase.firestore.FieldValue.arrayUnion(teacherUsername),
      coTeacherJoin: secret,
      coTeacherCode: null
    });
  } catch (e) {
    if (t29IsConnectionError(e)) throw e;
    return { ok: false, error: "That code didn't work. It may have been used already, cancelled, or the class already has 2 co-teachers. Ask the class owner for a new one." };
  }
  return { ok: true, classCode };
}
async function t29RemoveCoTeacher(classCode, ownerUsername, coUsername) {
  const cls = await getClass(classCode);
  if (!cls || cls.teacher !== ownerUsername) return { ok: false, error: "Only the class owner can remove co-teachers." };
  await classesCol().doc(classCode).update({ coTeachers: (cls.coTeachers || []).filter(n => n !== coUsername) });
  // Best effort: stop their account pointing at this class (they may not have it open).
  await usersCol().doc(coUsername).update({ classCode: "" }).catch(() => {});
  return { ok: true };
}
async function t29LeaveAsCoTeacher(classCode, username) {
  await classesCol().doc(classCode).update({ coTeachers: firebase.firestore.FieldValue.arrayRemove(username) });
  const me = await getUser(username).catch(() => null);
  if (me && me.classCode === classCode) await usersCol().doc(username).update({ classCode: "" }).catch(() => {});
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
    return { ok: false, error: "Something went wrong deleting the class. Some of it may not have been deleted. Please try again." };
  }

  await usersCol().doc(teacherUsername).update({ classCode: backTo });
  return { ok: true };
}

/* ---------------- Student joins a class ---------------- */
// SECURITY FIX: same change as createTeacherAndClass() above — a real
// Firebase Auth account is created first (password never touches
// Firestore), then /uidIndex, /users, and the class-doc update happen
// together in one transaction.
// ---------------- Welcome grant ----------------
// What a brand-new student starts with. A teacher can change it per class
// (Class settings, or the Add students window); classes made before that
// setting existed have no `welcomeGrant` and keep the original $20.
const T29_DEFAULT_WELCOME_GRANT = 20;
const T29_MAX_WELCOME_GRANT = 100000;

function t29WelcomeGrantOf(cls) {
  const raw = cls ? cls.welcomeGrant : undefined;
  if (raw === undefined || raw === null || raw === "") return T29_DEFAULT_WELCOME_GRANT;
  const n = Number(raw);
  return (isFinite(n) && n >= 0 && n <= T29_MAX_WELCOME_GRANT) ? Math.round(n * 100) / 100 : T29_DEFAULT_WELCOME_GRANT;
}

// Only affects students who join AFTER the change — everyone already in the
// class keeps what they have (and "Restart class" resets to the new amount).
async function setClassWelcomeGrant(classCode, amount) {
  const raw = typeof amount === "string" ? amount.replace(/[$,\s]/g, "") : amount;
  const n = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !isFinite(n)) {
    return { ok: false, error: "Enter the amount new students should start with, e.g. 20." };
  }
  if (n < 0) return { ok: false, error: "The welcome grant can't be negative." };
  if (n > T29_MAX_WELCOME_GRANT) return { ok: false, error: "The welcome grant can be at most $" + T29_MAX_WELCOME_GRANT.toLocaleString("en-NZ") + "." };
  const value = Math.round(n * 100) / 100;
  try {
    await classesCol().doc(classCode).update({ welcomeGrant: value });
  } catch (e) {
    console.warn("Saving the welcome grant failed:", e);
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
  return { ok: true, amount: value };
}

// The Firestore half of joining a class as a brand-new student: the /uidIndex
// entry, the /users doc and the roster line (plus the welcome grant) all
// written together in one transaction. Shared by a student signing
// themselves up (createStudentAccount, below) and a teacher adding a whole
// list at once (t29BulkCreateStudents, below), so a new student always
// starts out identical whichever way their account was made.
//
// `db` must be the Firestore connection the NEW student's Auth login is
// signed in on: firestore.rules only lets that brand-new login write these
// three things (see isSignupClassJoin) — fdb for self-signup, or the
// teacher's separate sign-up session (t29OpenSignupSession) for a bulk add.
async function t29JoinClassAsNewStudent(db, cred, name, username, classCode) {
  const classRef = db.collection("classes").doc(classCode);
  await db.runTransaction(async (t) => {
    const clsSnap = await t.get(classRef);
    if (!clsSnap.exists) throw new Error("NO_CLASS");
    const cls = clsSnap.data();
    const welcome = t29WelcomeGrantOf(cls);

    t.set(db.collection("uidIndex").doc(cred.user.uid), { username });

    // firestore.rules (isSaneNewStudentDoc) only accepts exactly these fields on a
    // brand-new student doc — add any new one there too, or signup will be refused.
    const user = {
      username, authUid: cred.user.uid, role: "student", name,
      classCode, joinedAt: Date.now(), balance: welcome, jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null, savings: 0, loans: [],
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
    addClassificationToBucket(user.reportMonth, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: welcome });
    addClassificationToBucket(user.reportLifetime, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: welcome });
    t.set(db.collection("users").doc(username), user);

    cls.students.push(username);
    cls.txns.unshift({ id: uid("t"), type: "welcome", to: username, amount: welcome, note: welcome > 0 ? "Welcome grant" : "Joined the class", date: nowStr(), ts: Date.now() });
    if (cls.txns.length > MAX_STORED_TXNS) cls.txns.length = MAX_STORED_TXNS;
    t.update(classRef, { students: cls.students, txns: cls.txns });
  });
}

async function createStudentAccount(name, username, password, classCode) {
  // See the matching check in createTeacherAndClass above — same reason.
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  { const uProblem = t29UsernameProblem(username); if (uProblem) return { ok: false, error: uProblem }; }

  name = sanitizeUserText(name, 60);

  // See the matching note in createTeacherAndClass above.
  const existing = await getUser(username).catch(() => null);
  if (existing) return { ok: false, error: "That username is already taken. Try adding a number to the end." };

  let cred;
  try {
    cred = await firebase.auth().createUserWithEmailAndPassword(t29AuthEmail(username), password);
  } catch (e) {
    return { ok: false, error: t29AuthErrorMessage(e) };
  }

  try {
    await t29JoinClassAsNewStudent(fdb, cred, name, username, classCode);
  } catch (e) {
    console.warn("Student signup failed:", e && (e.code || e.message), e);
    await cred.user.delete().catch(() => {}); // don't leave an orphaned Auth account
    if (e.message === "NO_CLASS") return { ok: false, error: "That class code doesn't exist." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  setSession(username, 0);
  return { ok: true };
}

/* ---------------- Teacher adds a list of students ---------------- */
// Creates one real student account per entry — {name, username, password} —
// in the teacher's class, exactly as if each student had used "Join a class"
// themselves. Runs one student at a time on a separate sign-up connection
// (see t29OpenSignupSession in firebase-init.js), so the teacher stays
// signed in and nothing here touches their session.
//
// If an entry's username is already taken (usernames are shared across
// every class), a number is added — sam.lee, sam.lee2, sam.lee3... — until
// one is free; the username that was actually used comes back in the result.
// Stops early (leaving the rest untried) on problems that would hit every
// remaining student too: no connection, Firebase rate limit, sign-ups
// switched off, a missing class, or rules refusing the write.
//
// opts: { onProgress(index, total, entry), shouldStop() }
// Returns { results: [{ index, name, username, password, ok, error }], stopReason }
async function t29BulkCreateStudents(classCode, entries, opts) {
  opts = opts || {};
  const results = [];
  let stopReason = null;
  let session;
  try {
    session = window.t29OpenSignupSession();
  } catch (e) {
    console.warn("Couldn't open a sign-up session:", e);
    return { results, stopReason: "Couldn't start creating accounts. Please reload the page and try again." };
  }
  try {
    for (let i = 0; i < entries.length; i++) {
      if (opts.shouldStop && opts.shouldStop()) { stopReason = "Stopped before finishing."; break; }
      if (opts.onProgress) opts.onProgress(i, entries.length, entries[i]);
      let r;
      try {
        r = await _t29BulkCreateOne(session, classCode, entries[i]);
      } catch (e) {
        console.warn("Bulk student signup crashed:", e);
        r = { index: entries[i].index, name: entries[i].name, username: null, password: entries[i].password, ok: false, fatal: true, error: "Something went wrong." };
      }
      results.push(r);
      if (r.fatal) { stopReason = r.error; break; }
    }
  } finally {
    await session.close();
    // The class roster just changed behind the normal connection's back —
    // drop its cached copy so the next read is fresh. (Undefined = a miss.)
    try { window._rcSet("classes", classCode, undefined); } catch (e) { /* cache not started yet */ }
  }
  return { results, stopReason };
}

async function _t29BulkCreateOne(session, classCode, entry) {
  const name = sanitizeUserText(entry.name, 60);
  const res = { index: entry.index, name, username: null, password: entry.password, ok: false, error: null, fatal: false };
  if (!name) { res.error = "No name."; return res; }

  let cred = null;
  for (let attempt = 0; attempt < 30 && !cred; attempt++) {
    const candidate = attempt === 0 ? entry.username : entry.username + (attempt + 1);
    try {
      cred = await session.auth.createUserWithEmailAndPassword(t29AuthEmail(candidate), entry.password);
      res.username = candidate;
    } catch (e) {
      if (e && e.code === "auth/email-already-in-use") continue; // taken — try the next number
      res.error = t29AuthErrorMessage(e);
      const code = e && e.code;
      res.fatal = code === "auth/network-request-failed" || code === "auth/too-many-requests" || code === "auth/operation-not-allowed";
      return res;
    }
  }
  if (!cred) { res.error = "Couldn't find a free username for this name."; return res; }

  try {
    await t29JoinClassAsNewStudent(session.fdb, cred, name, res.username, classCode);
    res.ok = true;
  } catch (e) {
    console.warn("Bulk student signup failed:", e && (e.code || e.message), e);
    await cred.user.delete().catch(() => {}); // don't leave an orphaned Auth account
    if (e && e.message === "NO_CLASS") {
      res.error = "This class no longer exists."; res.fatal = true;
    } else if (e && e.code === "permission-denied") {
      res.error = "Firestore refused the sign-up (permission denied). Check that the latest firestore.rules are published."; res.fatal = true;
    } else if (e && (e.code === "unavailable" || e.code === "failed-precondition")) {
      res.error = "Can't connect right now. Check your internet connection and try again."; res.fatal = true;
    } else {
      res.error = "Something went wrong saving this account.";
    }
    res.username = null;
  }
  try { await session.auth.signOut(); } catch (e) { /* ignore */ }
  return res;
}

/* ---------------- Login lockout ----------------
   5 wrong passwords for one username locks LOGINS for that username for
   30 minutes. Devices that are already signed in are not touched at all:
   a signed-in device keeps its Firebase Auth session, and nothing in
   requireLogin()/getSessionUser() looks at this lock.

   State lives in /loginLocks/{auth email of the username} (see the
   matching rules in firestore.rules, which stop a client making up
   counts or lock times). It is read/written before anyone is signed in,
   which is why it can't live on the /users doc. If the lock can't be
   read or written (offline, rules not deployed yet) login simply carries
   on as before: a broken lock must never be what stops a student
   logging in. */
const T29_LOCK_MAX = 5;
const T29_LOCK_MS = 30 * 60 * 1000;
function t29LockKey(username) {
  const u = String(username || "").trim();
  return u ? t29AuthEmail(u) : "";
}
function _t29TsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return Number(v) || 0;
}
// { locked, msLeft, count, lockedUntil, lastLockAt (ms), exists }
async function t29LoginLockStatus(username) {
  const out = { locked: false, msLeft: 0, count: 0, lockedUntil: 0, lastLockAt: 0, exists: false };
  const key = t29LockKey(username);
  if (!key) return out;
  try {
    const snap = await fdb.collection("loginLocks").doc(key).get({ source: "server" });
    if (!snap.exists) return out;
    const d = snap.data() || {};
    out.exists = true;
    out.lastLockAt = _t29TsMs(d.lastLockAt);
    const updatedAt = _t29TsMs(d.updatedAt);
    const lockedAt = _t29TsMs(d.lockedAt);
    const now = Date.now();
    // Attempts only count while they're fresh (same rule firestore.rules uses).
    out.count = updatedAt && now - updatedAt < T29_LOCK_MS ? (Number(d.count) || 0) : 0;
    if (lockedAt && (Number(d.count) || 0) >= T29_LOCK_MAX) {
      out.lockedUntil = lockedAt + T29_LOCK_MS;
      out.msLeft = out.lockedUntil - now;
      out.locked = out.msLeft > 0;
    }
  } catch (e) { /* fail open */ }
  return out;
}
function t29LockedMessage(msLeft) {
  const m = Math.max(1, Math.ceil((msLeft || T29_LOCK_MS) / 60000));
  return `The password for this account was entered incorrectly ${T29_LOCK_MAX} times, so logging in is locked for another ${m} minute${m === 1 ? "" : "s"}. Devices that are already signed in can keep being used.`;
}
async function t29RecordFailedLogin(username) {
  const key = t29LockKey(username);
  if (!key) return { locked: false, attemptsLeft: T29_LOCK_MAX };
  try {
    const ref = fdb.collection("loginLocks").doc(key);
    const snap = await ref.get({ source: "server" });
    const prev = snap.exists ? snap.data() : null;
    const fresh = prev && _t29TsMs(prev.updatedAt) && Date.now() - _t29TsMs(prev.updatedAt) < T29_LOCK_MS;
    const count = fresh ? (Number(prev.count) || 0) + 1 : 1;
    if (count > T29_LOCK_MAX) return { locked: true, attemptsLeft: 0 };
    const FV = firebase.firestore.FieldValue;
    const locking = count >= T29_LOCK_MAX;
    await ref.set({
      count,
      lockedAt: locking ? FV.serverTimestamp() : null,
      lastLockAt: locking ? FV.serverTimestamp() : (prev && prev.lastLockAt ? prev.lastLockAt : null),
      updatedAt: FV.serverTimestamp()
    });
    return { locked: locking, attemptsLeft: Math.max(0, T29_LOCK_MAX - count) };
  } catch (e) {
    return { locked: false, attemptsLeft: T29_LOCK_MAX, error: true };
  }
}
// After a successful login: forget the wrong attempts so far. lastLockAt
// is kept on purpose: it's what the "your password was tried 5 times"
// notice is built from.
async function t29ClearLoginAttempts(username, status) {
  if (!status || !status.exists || status.count <= 0) return;
  try {
    const FV = firebase.firestore.FieldValue;
    const ref = fdb.collection("loginLocks").doc(t29LockKey(username));
    const snap = await ref.get({ source: "server" });
    const prev = snap.exists ? snap.data() : {};
    await ref.set({ count: 0, lockedAt: null, lastLockAt: prev.lastLockAt || null, updatedAt: FV.serverTimestamp() });
  } catch (e) { /* not important */ }
}
/* ---------------- Browser-wide + per-username lock (client side) ----------------
   When an account hits the wrong-password limit, this browser is also locked
   out of logging in to ANY account for the rest of the 30 minutes, and that
   username's Log in button stays disabled. Stored in localStorage AND a
   cookie, and each re-fills the other, so clearing just one doesn't lift it.
   (Client-side only: clearing all site data / another browser / a private
   window gets around it. The per-account lock in Firestore still applies.) */
const T29_DEVICE_LOCK_KEY = "t29_device_lock";
const T29_USER_LOCKS_KEY = "t29_user_locks";
function _t29ReadCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function t29DeviceLockSet(until) {
  try { localStorage.setItem(T29_DEVICE_LOCK_KEY, String(until)); } catch (e) {}
  try { document.cookie = `${T29_DEVICE_LOCK_KEY}=${until}; expires=${new Date(until).toUTCString()}; path=/; SameSite=Lax`; } catch (e) {}
}
// ms timestamp the browser-wide lock ends, or 0 if not locked.
function t29DeviceLockUntil() {
  let until = 0;
  try { until = Math.max(until, Number(localStorage.getItem(T29_DEVICE_LOCK_KEY)) || 0); } catch (e) {}
  try { until = Math.max(until, Number(_t29ReadCookie(T29_DEVICE_LOCK_KEY)) || 0); } catch (e) {}
  if (until <= Date.now()) return 0;
  t29DeviceLockSet(until); // re-fill whichever copy was cleared
  return until;
}
function _t29UserLocks() {
  try { return JSON.parse(localStorage.getItem(T29_USER_LOCKS_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function t29UserLockSet(username, until) {
  const k = String(username || "").trim().toLowerCase();
  if (!k) return;
  const m = _t29UserLocks();
  const now = Date.now();
  for (const n in m) if (!(m[n] > now)) delete m[n];
  m[k] = until;
  try { localStorage.setItem(T29_USER_LOCKS_KEY, JSON.stringify(m)); } catch (e) {}
}
function t29UserLockUntil(username) {
  const k = String(username || "").trim().toLowerCase();
  const until = k ? Number(_t29UserLocks()[k]) || 0 : 0;
  return until > Date.now() ? until : 0;
}
function t29DeviceLockedMessage(msLeft) {
  const m = Math.max(1, Math.ceil((msLeft || T29_LOCK_MS) / 60000));
  return `A password was entered incorrectly ${T29_LOCK_MAX} times, so this browser can't log in to any 29 World account for another ${m} minute${m === 1 ? "" : "s"}. Devices that are already signed in can keep being used.`;
}
async function login(username, password) {
  // A teacher who set a recovery email (and used "Forgot password") signs in with that email.
  if (String(username).includes("@")) return t29LoginByEmail(String(username).trim().toLowerCase(), password);
  const devUntil = t29DeviceLockUntil();
  if (devUntil) return { ok: false, locked: true, deviceLocked: true, lockedUntil: devUntil, error: t29DeviceLockedMessage(devUntil - Date.now()) };
  const lock = await t29LoginLockStatus(username);
  if (lock.locked) {
    t29UserLockSet(username, lock.lockedUntil);
    return { ok: false, locked: true, lockedUntil: lock.lockedUntil, error: t29LockedMessage(lock.msLeft) };
  }
  const res = await t29LoginCore(username, password);
  if (res.ok) {
    await t29ClearLoginAttempts(username, lock);
    return res;
  }
  if (res.badCredentials) {
    const rec = await t29RecordFailedLogin(username);
    if (rec.locked) {
      const until = Date.now() + T29_LOCK_MS;
      t29UserLockSet(username, until);
      t29DeviceLockSet(until);
      return { ok: false, locked: true, deviceLocked: true, lockedUntil: until, error: t29DeviceLockedMessage(T29_LOCK_MS) };
    }
    if (rec.attemptsLeft > 0 && rec.attemptsLeft <= 2) {
      res.error += ` ${rec.attemptsLeft} attempt${rec.attemptsLeft === 1 ? "" : "s"} left before logging in is locked for 30 minutes.`;
    }
  }
  return res;
}

// Sign-in with an email address instead of a username: the login a teacher ends up
// with after recovering their account. Firebase Auth does the password check (and its
// own too-many-attempts throttling); /uidIndex says which teacher that login belongs to.
async function t29LoginByEmail(email, password) {
  const devUntil = t29DeviceLockUntil();
  if (devUntil) return { ok: false, locked: true, deviceLocked: true, lockedUntil: devUntil, error: t29DeviceLockedMessage(devUntil - Date.now()) };
  const bad = { ok: false, badCredentials: true, error: "Incorrect email or password." };
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (e) {
    if (e.code === "auth/network-request-failed" || e.code === "auth/too-many-requests") return { ok: false, error: t29AuthErrorMessage(e) };
    return bad;
  }
  const authUser = firebase.auth().currentUser;
  const idx = authUser ? await fdb.collection("uidIndex").doc(authUser.uid).get().catch(() => null) : null;
  const username = idx && idx.exists ? idx.data().username : null;
  const u = username ? await getUser(username).catch(() => null) : null;
  if (!u || u.role !== "teacher") {
    await firebase.auth().signOut().catch(() => {});
    return bad;
  }
  setSession(username, u.sessionVersion || 0);
  return { ok: true, user: u };
}

/* ---------------- Teacher account recovery (forgot password) ----------------
   1. t29SendRecoveryLink: emails a one-time sign-in link to the address typed.
      It is sent whatever the address is (nothing here reveals whether a username
      or email is registered); the link does nothing unless the address matches the
      recovery email on that teacher's account.
   2. The teacher opens the link (index.html?...), and t29CompleteRecovery signs in
      with it — which proves they own the email — then takes over the teacher account
      (rules: isRecoveryTakeover in firestore.rules) and sets a new password. The old
      login stops working; from then on they can log in with the email + new password.
   Needs "Email link (passwordless sign-in)" switched on under Firebase console →
   Authentication → Sign-in method → Email/Password. */
const T29_RECOVERY_KEY = "t29-recovery-pending";
// Fingerprint of username+email. Stored in the public recoveryCheck doc so the forgot form can
// verify a pair before sending, without the real email ever being readable.
async function t29RecoveryHash(username, email) {
  const data = new TextEncoder().encode("t29-recovery:" + String(username).trim().toLowerCase() + ":" + String(email).trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function t29SendRecoveryLink(username, email) {
  username = String(username || "").trim();
  email = String(email || "").trim().toLowerCase();
  if (!username || /\s/.test(username)) return { ok: false, error: "Enter your username." };
  if (!T29_EMAIL_RE.test(email)) return { ok: false, error: "Enter the recovery email address you gave when you signed up." };
  // Only send if this username + email pair matches. Silent success otherwise, so nothing reveals which usernames/emails exist.
  try {
    const snap = await fdb.collection("recoveryCheck").doc(username).get();
    const want = snap.exists ? snap.data().hash : "";
    if (!want || want !== await t29RecoveryHash(username, email)) return { ok: true };
  } catch (e) {
    if (t29IsConnectionError(e)) return { ok: false, error: t29AuthErrorMessage({ code: "auth/network-request-failed" }) };
    return { ok: false, error: "Couldn't check that username and email right now. Please try again later." };
  }
  const base = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
  try {
    await firebase.auth().sendSignInLinkToEmail(email, { url: base + "index.html", handleCodeInApp: true });
  } catch (e) {
    if (e.code === "auth/network-request-failed" || e.code === "auth/too-many-requests") return { ok: false, error: t29AuthErrorMessage(e) };
    if (e.code === "auth/operation-not-allowed") return { ok: false, error: "Account recovery isn't switched on yet. Ask whoever runs this site to enable email-link sign-in in Firebase." };
    return { ok: false, error: "Couldn't send the email. Check the address and try again." };
  }
  try { localStorage.setItem(T29_RECOVERY_KEY, JSON.stringify({ username, email })); } catch (e) { /* link can still be finished by retyping these */ }
  return { ok: true };
}
function t29IsRecoveryLink() {
  try { return !!firebase.auth().isSignInWithEmailLink(location.href); } catch (e) { return false; }
}
function t29PendingRecovery() {
  try { return JSON.parse(localStorage.getItem(T29_RECOVERY_KEY) || "null") || {}; } catch (e) { return {}; }
}
async function t29CompleteRecovery(username, email, newPassword) {
  username = String(username || "").trim();
  email = String(email || "").trim().toLowerCase();
  if (!newPassword || newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  let cred;
  try {
    cred = await firebase.auth().signInWithEmailLink(email, location.href);
  } catch (e) {
    if (e.code === "auth/network-request-failed") return { ok: false, error: t29AuthErrorMessage(e) };
    return { ok: false, error: "That link has expired, was already used, or the email doesn't match. Go back and ask for a new link." };
  }
  const uid = cred.user.uid;
  const undo = async () => { await cred.user.delete().catch(() => {}); await firebase.auth().signOut().catch(() => {}); };
  try {
    const idx = await fdb.collection("uidIndex").doc(uid).get().catch(() => null);
    if (idx && idx.exists && idx.data().username !== username) {
      // This email already recovered a different teacher account, and one login can only be one account.
      await firebase.auth().signOut().catch(() => {});
      return { ok: false, error: "This email has already been used to recover a different account." };
    }
    await fdb.runTransaction(async (t) => {
      t.update(usersCol().doc(username), { authUid: uid });
      if (!(idx && idx.exists)) t.set(fdb.collection("uidIndex").doc(uid), { username });
    });
  } catch (e) {
    if (t29IsConnectionError(e)) { await firebase.auth().signOut().catch(() => {}); return { ok: false, error: t29AuthErrorMessage({ code: "auth/network-request-failed" }) }; }
    await undo();
    return { ok: false, error: "That email isn't the recovery email for this username. Check both and try again." };
  }
  try {
    await cred.user.updatePassword(newPassword);
  } catch (e) {
    return { ok: false, error: "Your account is recovered, but the new password couldn't be saved. Use the link again to retry." };
  }
  const u = await getUser(username).catch(() => null);
  if (!u) return { ok: false, error: "Something went wrong. Please try again." };
  try { localStorage.removeItem(T29_RECOVERY_KEY); } catch (e) { /* ignore */ }
  setSession(username, u.sessionVersion || 0);
  return { ok: true, user: u };
}
/* ---------------- Teacher deletes their own account ----------------
   Needs the teacher's password (re-checked first). Permanently deletes every class they own
   (with its students, family links and shared template), their recovery email + fingerprint,
   their /users doc, their /uidIndex entry and finally their Firebase login. Classes they were
   only a co-teacher on are left alone. Returns { ok, error? }. The page should confirm first,
   then send the person back to index.html on success. */
async function t29DeleteTeacherAccount(username, password) {
  const user = firebase.auth().currentUser;
  if (!user || !username) return { ok: false, error: "You need to be logged in to delete your account." };
  if (!password) return { ok: false, error: "Enter your password to confirm." };
  const me = await getUser(username).catch(() => null);
  if (!me || me.role !== "teacher" || me.authUid !== user.uid) return { ok: false, error: "This isn't your teacher account." };
  try {
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
  } catch (e) {
    if (e.code === "auth/network-request-failed") return { ok: false, error: t29AuthErrorMessage(e) };
    return { ok: false, error: "That password isn't right." };
  }
  try {
    const owned = await classesCol().where("teacher", "==", username).get();
    for (const d of owned.docs) {
      const r = await deleteClassPermanently(username, d.id);
      if (!r.ok) return { ok: false, error: r.error };
    }
    // Free the co-teacher slots before removing the account. Otherwise
    // these classes keep a member who no longer exists.
    const shared = await classesCol().where("coTeachers", "array-contains", username).get();
    for (const d of shared.docs) await t29LeaveAsCoTeacher(d.id, username);
    const worksheets = fdb.collection("teacherWorksheets/" + username + "/sheets");
    const worksheetDocs = await worksheets.get();
    for (const d of worksheetDocs.docs) await worksheets.doc(d.id).delete();
    // A failed cleanup must stop here while this identity can still retry;
    // orphaned recovery records must not survive a reusable username.
    await fdb.collection("recoveryCheck").doc(username).delete();
    await fdb.collection("teacherRecovery").doc(username).delete();
    // The mapping and app account must disappear together: a failure of
    // either write must leave the teacher able to log in and retry.
    await fdb.runTransaction(async t => {
      t.delete(usersCol().doc(username));
      t.delete(fdb.collection("uidIndex").doc(user.uid));
    });
  } catch (e) {
    console.warn("Teacher account deletion failed:", e && (e.code || e.message), e);
    return { ok: false, error: "Something went wrong deleting your account. Some of it may not have been deleted. Please try again." };
  }
  let warning = null;
  try { await user.delete(); } catch (e) {
    console.warn("Auth user delete failed:", e);
    warning = "Your app data was deleted, but the sign-in record couldn't be removed. Contact Nathan.liu1211@gmail.com to finish deleting that record.";
  }
  try { await firebase.auth().signOut(); } catch (e) { /* ignore */ }
  try { clearSession(); } catch (e) { /* ignore */ }
  return { ok: true, warning };
}

// Teacher Home: see / change / remove the recovery email after signup.
async function t29GetRecoveryEmail(username) {
  const snap = await fdb.collection("teacherRecovery").doc(username).get().catch(() => null);
  const em = snap && snap.exists ? (snap.data().email || "") : "";
  // Backfill: accounts made before this check get their fingerprint when Teacher Home loads.
  if (em) t29RecoveryHash(username, em).then(h => fdb.collection("recoveryCheck").doc(username).set({ hash: h })).catch(() => {});
  return em;
}
async function t29SetRecoveryEmail(username, email) {
  email = String(email || "").trim().toLowerCase();
  const ref = fdb.collection("teacherRecovery").doc(username);
  const chk = fdb.collection("recoveryCheck").doc(username);
  if (!email) { await ref.delete(); await chk.delete().catch(() => {}); return { ok: true, email: "" }; }
  if (!T29_EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look right." };
  await ref.set({ email });
  await chk.set({ hash: await t29RecoveryHash(username, email) });
  return { ok: true, email };
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
async function t29LoginCore(username, password) {
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
      if (!migrated.ok) return { ok: false, badCredentials: true, error: "Incorrect username or password." };
    } else if (e.code === "auth/network-request-failed" || e.code === "auth/too-many-requests") {
      // Not the password's fault — say what actually went wrong.
      return { ok: false, error: t29AuthErrorMessage(e) };
    } else {
      return { ok: false, badCredentials: true, error: "Incorrect username or password." };
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
    // After a recovery the login is the teacher's real email, not the username-based one.
    const loginEmail = (authUser.email && !/@t29\.local$/i.test(authUser.email)) ? authUser.email : t29AuthEmail(username);
    const cred = firebase.auth.EmailAuthProvider.credential(loginEmail, oldPassword);
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
      <label style="display:block;margin:14px 0 4px;font-size:var(--fs-lg);" for="t29PwCurrent">Current password</label>
      <input type="password" id="t29PwCurrent" autocomplete="current-password" style="width:100%;">
      <label style="display:block;margin:12px 0 4px;font-size:var(--fs-lg);" for="t29PwNew">New password</label>
      <input type="password" id="t29PwNew" autocomplete="new-password" style="width:100%;">
      <label style="display:block;margin:12px 0 4px;font-size:var(--fs-lg);" for="t29PwConfirm">Confirm new password</label>
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
  if (!me) { msg.textContent = "You've been signed out. Please log back in."; return; }

  btn.disabled = true;
  msg.textContent = "Updating...";
  const res = await changePassword(me.username, oldPw, newPw);
  btn.disabled = false;

  if (!res.ok) { msg.textContent = res.error; return; }

  overlay.querySelector("#t29PwCurrent").value = "";
  overlay.querySelector("#t29PwNew").value = "";
  overlay.querySelector("#t29PwConfirm").value = "";
  msg.textContent = "Password updated. You're still signed in here. Any other device you were logged in on will need to sign back in.";
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
  if (!isFinite(delta)) return false; // Infinity would be written into the balance as-is
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

async function logTxn(classCode, txn, opts) {
  // Student view: the class's activity log is shared, so nothing is added to it (sending money, which a teacher does
  // for real, is the exception: T29_SV_ALLOW). Skipping it quietly lets the rest of the action finish, rather than
  // failing after the teacher's own temporary data has already changed.
  if (T29_SV_ALLOW === 0 && t29SvActive()) return;
  const classRef = classesCol().doc(classCode);
  // Built once, outside the transaction, so every retry (Firestore retries
  // on contention) pushes the exact same entry rather than a new id/ts each
  // time, and so recordReportActivity() below has a stable reference to the
  // entry that actually got committed.
  // opts (optional, gambling only): { entry } = an entry already built by buildLedgerEntry() (same shape as below);
  // { reportDone: true } = this entry's rolling report totals were already written inside the money transaction,
  // so the separate recordReportActivity() transaction below is skipped. Omitting opts behaves exactly as before.
  const built = (opts && opts.entry) || Object.assign({ id: uid("t"), date: nowStr(), ts: Date.now() }, txn);
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
  if (opts && opts.reportDone) return; // report totals already committed with the money (see reportFieldsForTxn)
  // Feed this txn into the rolling per-student report totals (see
  // recordReportActivity below) for whichever real student(s) it belongs
  // to. Best-effort and non-blocking of the money movement above, which
  // has already committed by this point regardless of what happens here.
  const affected = new Set([built.to, built.from].filter(Boolean));
  await Promise.all([...affected].map(u => recordReportActivity(u, built)));
}

async function transferMoney(fromUser, toUser, amount, note, opts) {
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
  if (!(amount > 0) || !isFinite(amount)) return { ok: false, error: "Enter an amount greater than zero." };
  // Both writes below would hit the same doc and the second would win, leaving the
  // sender with MORE money instead of the same.
  if (fromUser === toUser) return { ok: false, error: "You can't send money to yourself." };
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
  if (fromIsTeacher && !(opts && opts.silent)) {
    await t29NotifyStudents(from.classCode, { to: toUser, icon: "coin", tone: "mint",
      title: `Your teacher sent you ${fmtMoney(amount)}`, body: note ? `Note: ${note}` : "It was added to your balance.", href: "bank.html" });
  }
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

/* ===================== Teacher change notices =====================
   Whenever the TEACHER changes something that affects a student (a price
   they own, a card's rewards, a manual market run, a job's pay ...), the
   student should be told what changed. Everything else in the bell is
   derived live from existing data, but a teacher's edit leaves no trace
   once it's applied, so these are the one thing that IS written down:
   class.teacherNotices = [{ id, ts, to, icon, tone, title, body, href }]
   newest first, where `to` is "all" or an array of student usernames.
   One small write on the class doc (the teacher may already write it, the
   students only ever read it). The list is capped and expires itself, and
   notifications.js (notifTeacherChangeItems) turns each into a bell row.
   Best-effort: a failure here must never fail the teacher's real action,
   so this never throws. */
const T29_NOTICE_MAX = 120;
const T29_NOTICE_TTL_MS = 14 * 24 * 3600 * 1000;

function t29NoticeClip(s, n) {
  s = String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function t29NotifyStudents(classCode, notices) {
  try {
    if (!classCode) return false;
    const now = trustedNow().getTime();
    const entries = [];
    (Array.isArray(notices) ? notices : [notices]).forEach(n => {
      if (!n || !n.title || !n.to) return;
      let to = n.to;
      if (to !== "all") {
        to = Array.from(new Set((Array.isArray(to) ? to : [to]).filter(u => typeof u === "string" && u)));
        if (!to.length) return;
      }
      entries.push({
        id: uid("n"), ts: now, to, icon: n.icon || "bell", tone: n.tone || "gold",
        title: t29NoticeClip(n.title, 120), body: t29NoticeClip(n.body, 400), href: n.href || ""
      });
    });
    if (!entries.length) return false;
    const classRef = classesCol().doc(classCode);
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) return;
      const cur = Array.isArray(snap.data().teacherNotices) ? snap.data().teacherNotices : [];
      const cutoff = now - T29_NOTICE_TTL_MS;
      const next = entries.concat(cur).filter(n => n && (n.ts || 0) >= cutoff).slice(0, T29_NOTICE_MAX);
      t.update(classRef, { teacherNotices: next });
    });
    return true;
  } catch (e) {
    console.warn("t29NotifyStudents failed:", e);
    return false;
  }
}

// Usernames of the students in a class who match `test(studentDoc)`.
async function t29StudentsWhere(classCode, test) {
  try {
    const all = await getClassStudents(classCode);
    return all.filter(s => s && s.username && s.role !== "teacher" && test(s)).map(s => s.username);
  } catch (e) { return []; }
}

// After the teacher runs pay day / interest by hand: tells each student what
// they were paid, read back from the class transaction log (only entries
// written since `sinceTs`, so nothing is announced twice).
async function t29NotifyRunPayments(classCode, sinceTs, kind) {
  try {
    const cls = await getClass(classCode);
    if (!cls) return;
    const types = kind === "interest" ? ["interest", "cash-interest"] : ["wage"];
    const totals = {};
    (cls.txns || []).forEach(x => {
      if (x && x.to && (x.ts || 0) >= sinceTs && types.includes(x.type)) totals[x.to] = (totals[x.to] || 0) + (Number(x.amount) || 0);
    });
    await t29NotifyStudents(classCode, Object.keys(totals).filter(u => totals[u] > 0).map(u => {
      const amt = Math.round(totals[u] * 100) / 100;
      return kind === "interest"
        ? { to: u, icon: "piggy", tone: "mint", title: `Your teacher paid interest: you earned ${fmtMoney(amt)}`, body: "It was added to your account.", href: "bank.html" }
        : { to: u, icon: "coin", tone: "mint", title: `Your teacher ran pay day: you were paid ${fmtMoney(amt)}`, body: "It was added to your account.", href: "bank.html" };
    }));
  } catch (e) { console.warn("t29NotifyRunPayments failed:", e); }
}

/* ===================== Student requests -> the teacher's bell =====================
   The mirror image of t29NotifyStudents. When a STUDENT asks for something that needs
   the teacher (a job application, a side hustle change, more time on the site, a credit
   card or bank account that needs approval, a Trade Centre listing or a rental waiting for
   approval), or takes that request back, the teacher is told in the same bell, with the
   same read/unread tracking and the same optional device alerts (see notifications.js).

   It lives in its own tiny document on purpose: the class doc is rewritten constantly
   (every bank transaction), so a live listener on it would bill a read each time.
   teacherInbox/{classCode} only changes when a student asks for something, so the
   teacher's bell can listen to it live for about one read per request.

   Shape: n: { <username>: { <kind>: { ts, st: "req"|"cancel", title, body } } }
   ONE slot per student per kind, written with a blind merge (no read, no transaction).
   Asking again replaces that student's previous notice of that kind, and withdrawing a
   request replaces the notice for the request it withdraws, so nothing piles up and the
   document stays small. firestore.rules lets a student write only their OWN slots, with
   the text length-capped; the bell never trusts the text as markup.

   Best-effort: never throws, and never holds up the student's real action for more than
   about 2 seconds (an offline write would otherwise wait for the connection). */
// kind -> what the title says after the student's name. Kind names must match the list in
// firestore.rules and NOTIF_INBOX_KINDS in notifications.js. `cancel: null` = can't be withdrawn.
const T29_TEACHER_NOTICE_KINDS = {
  time:    { req: "asked for more time on the site",                    cancel: null },
  hustle:  { req: "asked to change their side hustle",                  cancel: null },
  job:     { req: "applied for a job",                                  cancel: "withdrew their job application" },
  card:    { req: "applied for a credit card",                          cancel: "withdrew their credit card application" },
  account: { req: "applied for a bank account",                         cancel: "withdrew their bank account application" },
  listing: { req: "listed something in the Trade Centre for approval",  cancel: "cancelled a Trade Centre listing that was waiting for approval" },
  sublet:  { req: "asked to rent out a property to classmates",         cancel: "withdrew a request to rent out a property" },
  tick:    { req: "asked for their job to be ticked off",               cancel: null }
};
let _teacherNoticeDead = false;
let T29_TEACHER_INBOX_DENIED = false;

// status: "req" (they asked) or "cancel" (they took it back). detail: one short line, e.g. the job's name.
async function t29NotifyTeacher(classCode, kind, status, detail) {
  try {
    const me = t29SessionStudent();
    const def = T29_TEACHER_NOTICE_KINDS[kind];
    const st = status === "cancel" ? "cancel" : "req";
    const phrase = def && def[st];
    if (_teacherNoticeDead || !classCode || !me || !phrase) return false;
    const who = t29NoticeClip(T29_SESSION_NAME || me, 40);
    const slot = {
      ts: firebase.firestore.FieldValue.serverTimestamp(), st,
      title: t29NoticeClip(`${who} ${phrase}`, 120), body: t29NoticeClip(detail, 300)
    };
    const write = fdb.collection("teacherInbox").doc(classCode)
      .set({ n: { [me]: { [kind]: slot } } }, { merge: true })
      .then(() => true, e => {
        if (e && e.code === "permission-denied") _teacherNoticeDead = true; // rules not published yet: stop trying
        else console.warn("t29NotifyTeacher failed:", e);
        return false;
      });
    return await Promise.race([write, new Promise(resolve => setTimeout(() => resolve(false), 2000))]);
  } catch (e) {
    console.warn("t29NotifyTeacher failed:", e);
    return false;
  }
}

// Flattens the inbox doc into [{ user, kind, st, ts (ms), title, body }]. Times are server
// timestamps; anything that isn't one of the known kinds is ignored.
function t29ParseTeacherInbox(snap) {
  const out = [];
  const n = (snap && snap.exists && snap.data() && snap.data().n) || {};
  const ms = v => (v && typeof v.toMillis === "function") ? v.toMillis() : 0;
  Object.keys(n).forEach(user => {
    const slots = n[user];
    if (!slots || typeof slots !== "object") return;
    Object.keys(T29_TEACHER_NOTICE_KINDS).forEach(kind => {
      const e = slots[kind];
      const ts = e && typeof e === "object" ? ms(e.ts) : 0;
      if (!ts) return;
      out.push({ user, kind, st: e.st === "cancel" ? "cancel" : "req", ts, title: String(e.title || ""), body: String(e.body || "") });
    });
  });
  return out;
}

// Teacher side, live: ONE read when it starts, then one per new request. cb(items) on every
// change; cb(null, { error }) if the listener ends. Returns a function that stops it.
function t29WatchTeacherInbox(classCode, cb) {
  if (!classCode || typeof cb !== "function") return function () {};
  let unsub = null, dead = false;
  try {
    unsub = fdb.collection("teacherInbox").doc(classCode).onSnapshot(
      snap => { if (!dead) { T29_TEACHER_INBOX_DENIED = false; cb(t29ParseTeacherInbox(snap), {}); } },
      err => {
        if (err && err.code === "permission-denied") T29_TEACHER_INBOX_DENIED = true;
        if (!dead) cb(null, { error: err || true });
      }
    );
  } catch (e) { cb(null, { error: e }); }
  return function () { dead = true; if (unsub) { try { unsub(); } catch (e) { /* already stopped */ } unsub = null; } };
}

// One-off read for the fallback poll. Returns the items, or null if it couldn't be read.
async function t29LoadTeacherInbox(classCode) {
  try {
    if (!classCode) return null;
    return t29ParseTeacherInbox(await fdb.collection("teacherInbox").doc(classCode).get({ source: "server" }));
  } catch (e) {
    if (e && e.code === "permission-denied") T29_TEACHER_INBOX_DENIED = true;
    return null;
  }
}

// Marks a bonus/fine txn as seen so its one-time popup doesn't show again.
// Returns true ONLY for the one caller that actually flipped it from
// unacknowledged to acknowledged — a second device/tab running this at the
// same moment gets false, so a bonus/fine popup is only ever shown once
// across every device the student is logged in on.
async function acknowledgeTxn(classCode, txnId) {
  const classRef = classesCol().doc(classCode);
  let won = false;
  await fdb.runTransaction(async (t) => {
    won = false;
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const txn = (cls.txns || []).find(x => x.id === txnId);
    if (!txn || txn.acknowledged) return;
    txn.acknowledged = true;
    t.update(classRef, { txns: cls.txns });
    won = true;
  });
  return won;
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
  const oldDay = ((await getClass(classCode).catch(() => null)) || {}).payDay;
  await classesCol().doc(classCode).update({ payDay: day });
  if (oldDay !== day) {
    const earners = await t29StudentsWhere(classCode, s => !!s.jobId);
    await t29NotifyStudents(classCode, { to: earners, icon: "coin", tone: "gold",
      title: "Your teacher changed pay day", body: `You are now paid on ${day}${oldDay ? ` (was ${oldDay})` : ""}.`, href: "bank.html" });
  }
}

// Class-wide day mortgage installments fall due on (see payMortgage).
async function setMortgageDay(classCode, day) {
  const newDay = DAY_NAMES.includes(day) ? day : "Fri";
  const oldCls = (await getClass(classCode).catch(() => null)) || {};
  await classesCol().doc(classCode).update({ mortgageDay: newDay });
  if (oldCls.mortgageDay && oldCls.mortgageDay !== newDay) {
    const owners = Array.from(new Set((oldCls.properties || []).filter(p => p.owner && p.mortgage).map(p => p.owner)));
    await t29NotifyStudents(classCode, { to: owners, icon: "house", tone: "gold",
      title: "Your teacher changed mortgage day", body: `Mortgage payments are now due on ${newDay} (was ${oldCls.mortgageDay}).`, href: "property.html" });
  }
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
  const oldCls = (await getClass(classCode).catch(() => null)) || {};
  const wasOn = !!oldCls.mortgageForceDueWeek && oldCls.mortgageForceDueWeek === isoWeekKey();
  await classesCol().doc(classCode).update({ mortgageForceDueWeek: active ? isoWeekKey() : null });
  if (wasOn !== !!active) {
    const owners = Array.from(new Set((oldCls.properties || []).filter(p => p.owner && p.mortgage).map(p => p.owner)));
    await t29NotifyStudents(classCode, { to: owners, icon: "house", tone: active ? "coral" : "gold",
      title: active ? "Your teacher made this week's mortgage payment due now" : "Your teacher put mortgage payments back to normal",
      body: active ? "Pay it on the Property page." : "Mortgage payments are due on the usual day again.", href: "property.html" });
  }
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
async function setJobTaskApproval(classCode, username, approved, opts) {
  const cls = await getClass(classCode);
  const weekKey = payCycleKey(cls && cls.payDay);
  await usersCol().doc(username).update({ jobTaskApproval: { weekKey, approved: !!approved } });
  if (!(opts && opts.silent)) await t29NotifyStudents(classCode, { to: username, icon: "briefcase", tone: approved ? "mint" : "coral",
    title: approved ? "Your teacher ticked off your job task for this week" : "Your teacher un-ticked your job task for this week",
    body: approved ? "Your wage for this pay cycle is approved." : "Your wage for this pay cycle is on hold until the task is done.", href: "jobs.html" });
  return { ok: true };
}
function jobTaskTicked(user, cls) {
  const weekKey = payCycleKey(cls && cls.payDay);
  const approval = user && user.jobTaskApproval;
  return !!(approval && approval.weekKey === weekKey && approval.approved);
}
// A job's wage gate. "Tasks" jobs need the teacher's tick. "Check-in" and
// "Questionnaire" jobs pass once the student has logged enough days this pay
// cycle. A teacher tick always counts too, so it works as an excuse.
function isJobTaskApprovedThisWeek(user, cls) {
  const job = user && user.jobId && cls ? (cls.jobs || []).find(j => j.id === user.jobId) : null;
  // Check-in / questionnaire jobs are paid automatically by days logged (the
  // teacher's tick plays no part); they are payable once at least one day is logged.
  if (job && jobLogType(job) !== "tasks") { const st = jobLogStatus(user, job, cls, true); return st.done > 0 || st.expected === 0; }
  return jobTaskTicked(user, cls);
}

/* ---------------- Job logs: tasks / check-ins / questionnaire ----------------
   Every job has a log type (job.logType, "tasks" when missing) and, for the two
   student-driven types, settings in job.log. Students' completed days are kept
   on their user doc as jobLog.days[dateKey] = { j: jobId, ok, at, tries }. */
const JOB_LOG_TYPES = { tasks: "Tasks", checkin: "Check-ins", quiz: "Questionnaire" };
const JOB_LOG_DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JOB_LOG_DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const JOB_LOG_JS_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function _jlInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}
function jobLogType(job) { return job && JOB_LOG_TYPES[job.logType] ? job.logType : "tasks"; }

// Always returns a complete, safe settings object, whatever is stored.
function jobLogSettings(job) {
  const l = (job && job.log) || {};
  const picked = JOB_LOG_DAY_KEYS.filter(d => Array.isArray(l.days) ? l.days.includes(d) : ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(d));
  const days = picked.length ? picked : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const startMin = _jlInt(l.startMin, 0, 1435, 540);
  const questions = Array.isArray(l.questions) ? l.questions : [];
  return {
    days, startMin, questions,
    freq: l.freq === "weekly" ? "weekly" : l.freq === "interval" ? "interval" : "daily",
    every: _jlInt(l.every, 2, 6, 2),
    startKey: /^\d{4}-\d{2}-\d{2}$/.test(l.startKey || "") ? l.startKey : nzDateKey(),
    winMins: _jlInt(l.winMins, 5, Math.min(240, 1440 - startMin), 15),
    windowOn: jobLogType(job) === "checkin" ? true : !!l.windowOn,
    attempts: _jlInt(l.attempts, 1, 5, 2),
    perDay: _jlInt(l.perDay, 0, questions.length, 0)
  };
}
function jobLogTimeLabel(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}
function jobLogDaysLabel(days) {
  const k = JOB_LOG_DAY_KEYS.filter(d => days.includes(d)).join(",");
  if (k === "Mon,Tue,Wed,Thu,Fri") return "Mon\u2013Fri";
  if (days.length === 7) return "every day";
  return JOB_LOG_DAY_KEYS.filter(d => days.includes(d)).join(", ");
}
function jobLogDateAdd(key, n) {
  const dt = new Date(dateKeyToUTC(key) + n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function jobLogDayOf(key) { return JOB_LOG_JS_DAY[new Date(dateKeyToUTC(key)).getUTCDay()]; }
// Is the log due on this date? "interval" = every Nth school day (a school day is
// one of the job's days) counting from the first school day on/after startKey,
// e.g. every 2nd day to fit a 6-day timetable into a 5-day week.
function jobLogDayActive(s, key) {
  if (!s.days.includes(jobLogDayOf(key))) return false;
  if (s.freq !== "interval") return true;
  if (key < s.startKey) return false;
  let n = 0;
  for (let k = s.startKey; k < key; k = jobLogDateAdd(k, 1)) if (s.days.includes(jobLogDayOf(k))) n++;
  return n % s.every === 0;
}
// The 7 dates (oldest first) a pay day pays for. They end the DAY BEFORE pay day
// so every logged day is settled before wages are worked out. `payout` = true
// always gives the cycle the coming pay day pays; otherwise, on pay day itself,
// this gives the NEXT cycle (which starts today) so students can keep logging.
function jobLogCycleKeys(cls, payout) {
  const pk = payCycleKey(cls && cls.payDay);
  const end = !payout && pk === nzDateKey() ? jobLogDateAdd(pk, 6) : jobLogDateAdd(pk, -1);
  return [6, 5, 4, 3, 2, 1, 0].map(n => jobLogDateAdd(end, -n));
}
// Where "now" sits against the job's window today: off | early | open | closed
function jobLogWindowState(job, d) {
  const s = jobLogSettings(job);
  if (!jobLogDayActive(s, nzDateKey(d))) return { state: "off" };
  if (!s.windowOn) return { state: "open", closesIn: null };
  const hm = nzHourMinute(d), now = hm.hour * 60 + hm.minute, end = s.startMin + s.winMins;
  if (now < s.startMin) return { state: "early", opensIn: s.startMin - now };
  if (now >= end) return { state: "closed" };
  return { state: "open", closesIn: end - now };
}
function jobLogStatus(user, job, cls, payout) {
  const type = jobLogType(job);
  if (type === "tasks") {
    const ticked = jobTaskTicked(user, cls);
    return { type, ticked, met: ticked, done: ticked ? 1 : 0, expected: 1, fraction: ticked ? 1 : 0, weekly: false, days: [], today: null, reachable: true };
  }
  // Pay = wage x done / expected. Daily: expected = days the log runs. Weekly: expected = 1.
  const s = jobLogSettings(job), weekly = s.freq === "weekly";
  const todayKey = nzDateKey();
  const log = (user && user.jobLog && user.jobLog.days) || {};
  const days = jobLogCycleKeys(cls, payout).map(k => {
    const e = log[k] && log[k].j === job.id ? log[k] : null;
    const day = jobLogDayOf(k);
    return { key: k, day, active: jobLogDayActive(s, k), done: !!(e && e.ok), at: e && e.ok ? (e.at || "") : "",
             tries: e ? (e.tries || 0) : 0, today: k === todayKey, past: k < todayKey };
  });
  const expected = weekly ? 1 : days.filter(d => d.active).length; // daily/interval: check-ins due this cycle (can be 0)
  const done = Math.min(expected, days.filter(d => d.active && d.done).length);
  const chances = days.filter(d => d.active && !d.done && !d.past).length;
  return { type, ticked: false, weekly, expected, done, fraction: expected ? done / expected : 1, days, today: days.find(d => d.today) || null,
           met: done >= expected, reachable: done + chances >= expected };
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
      t29Toast("Couldn't load everything on this page. Check your internet connection.", { type: "error", duration: 7000 });
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
let _t29ReadyAt = 0;
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
      ? "You're offline. This page will finish loading once you're back online."
      : "Still loading. This is taking longer than usual. A slow connection can do this.", { type: "info", duration: 7000 });
  }, 8000);
  // Never leave the placeholders up forever, whatever happens.
  setTimeout(t29PageReady, 20000);
}

function t29PageReady() {
  if (_t29PageIsReady) return;
  _t29PageIsReady = true;
  _t29ReadyAt = Date.now();
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
  // Phones: a table wider than the screen scrolls sideways, so it fades out at
  // whichever edge still has more to see (the fade itself is CSS, phones only).
  const markScroller = el => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle("t29-fade-r", max > 2 && el.scrollLeft < max - 2);
    el.classList.toggle("t29-fade-l", max > 2 && el.scrollLeft > 2);
  };
  const sizeWatcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(entries => entries.forEach(e => markScroller(e.target.closest(".table-scroll") || e.target))) : null;
  const markScrollers = () => {
    document.querySelectorAll(".table-scroll").forEach(el => {
      if (!el.dataset.fadeBound) {
        el.dataset.fadeBound = "1";
        el.addEventListener("scroll", () => markScroller(el), { passive: true });
        if (sizeWatcher) { sizeWatcher.observe(el); if (el.firstElementChild) sizeWatcher.observe(el.firstElementChild); }
      }
      markScroller(el);
    });
  };
  let labelQueued = false;
  const queueLabels = () => {
    if (labelQueued) return;
    labelQueued = true;
    requestAnimationFrame(() => { labelQueued = false; labelStackTables(); markScrollers(); });
  };
  const startLabelling = () => {
    labelStackTables();
    markScrollers();
    new MutationObserver(queueLabels).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startLabelling);
  else if (document.body) startLabelling();
}

// When a figure on a dashboard card changes (cash after a purchase, pay arriving),
// it briefly flashes so the change is noticed: green and lifted when it goes up,
// a quiet dip when it goes down. Nothing runs while the page is still loading or
// in the first moments after, so the first real numbers never flash.
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const seen = new WeakMap();
  const num = t => parseFloat(String(t).replace(/[^0-9.\-]/g, ""));
  const flash = (el, cls) => {
    el.classList.remove("t29-up", "t29-down", "t29-changed");
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  };
  const check = el => {
    const now = el.textContent.trim(), before = seen.get(el);
    seen.set(el, now);
    if (before === undefined || before === now || !before || !_t29PageIsReady || Date.now() - _t29ReadyAt < 1500) return;
    const a = num(before), b = num(now);
    flash(el, isNaN(a) || isNaN(b) ? "t29-changed" : b > a ? "t29-up" : "t29-down");
  };
  const watchStats = () => {
    document.querySelectorAll(".stat .value").forEach(el => {
      if (seen.has(el)) return;
      seen.set(el, el.textContent.trim());
      new MutationObserver(() => check(el)).observe(el, { childList: true, characterData: true, subtree: true });
    });
  };
  const startWatching = () => { watchStats(); new MutationObserver(watchStats).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWatching);
  else if (document.body) startWatching();
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

// In-page replacements for the browser's alert(), confirm() and prompt()
// boxes. All three share one queue, so only one shows at a time (like the
// real ones) and a quick double-tap can never stack two of the same box.
// t29Confirm() resolves true/false; t29Prompt() resolves the typed text, or
// null if cancelled — so call sites read like the native versions, with
// `await` in front.
const _t29DialogQueue = [];
function _t29Enqueue(kind, message, opts) {
  return new Promise(resolve => {
    _t29DialogQueue.push({ kind, message: String(message === undefined || message === null ? "" : message), opts: opts || {}, resolve });
    if (_t29DialogQueue.length === 1) _t29ShowNextDialog();
  });
}
function t29Alert(message) { return _t29Enqueue("alert", message); }
// opts: { confirmText, cancelText, danger } — all optional; sensible labels are
// worked out from the question itself ("Remove this…?" -> a red "Remove" button).
function t29Confirm(message, opts) { return _t29Enqueue("confirm", message, opts); }
// opts: { type: "text"|"number", min, max, step, placeholder, confirmText, cancelText, danger }
function t29Prompt(message, defaultValue, opts) {
  return _t29Enqueue("prompt", message, Object.assign({}, opts, { defaultValue: defaultValue === undefined || defaultValue === null ? "" : String(defaultValue) }));
}

const _T29_DANGER_WORDS = /^(remove|delete|clear|delist|revoke|decline|repossess|end|cancel|stop|turn|opt|restart)$/;
const _T29_LABELS = {
  remove: "Remove", delete: "Delete", clear: "Clear", delist: "Delist", revoke: "Revoke", decline: "Decline",
  repossess: "Repossess", end: "End it", cancel: "Yes, cancel it", stop: "Yes, stop", turn: "Turn off", opt: "Opt out",
  retire: "Retire", undo: "Undo", reopen: "Reopen", archive: "Archive", withdraw: "Withdraw", sell: "Sell", buy: "Buy",
  send: "Send", take: "Take", give: "Give", accept: "Accept", move: "Move out", save: "Save", mark: "Yes, mark it"
};
function _t29DialogLabels(message, o) {
  const text = String(message).trim();
  const first = ((text.match(/^[A-Za-z]+/) || [""])[0]).toLowerCase();
  const lastLine = (text.split(/\n+/).filter(Boolean).pop() || "").trim();
  let ok = "";
  let m;
  if ((m = lastLine.match(/(?:^|\. )([A-Z][a-z]+) anyway\?$/))) ok = m[1] + " anyway";
  else if (/(?:^|\. )Continue\?$/.test(lastLine)) ok = "Continue";
  else if (/^Set up this one too\?$/.test(lastLine)) ok = "Set up";
  else ok = _T29_LABELS[first] || "Yes";
  return {
    ok: o.confirmText || ok,
    cancel: o.cancelText || (first === "cancel" ? "Go back" : "Cancel"),
    danger: o.danger !== undefined ? !!o.danger : _T29_DANGER_WORDS.test(first)
  };
}

function _t29ShowNextDialog() {
  const item = _t29DialogQueue[0];
  if (!item) return;
  if (!document.body) { document.addEventListener("DOMContentLoaded", _t29ShowNextDialog, { once: true }); return; }
  const kind = item.kind, o = item.opts;
  const returnFocus = document.activeElement;
  const asking = kind !== "alert";
  const lb = asking ? _t29DialogLabels(item.message, o) : { ok: "OK", cancel: "", danger: false };
  const overlay = document.createElement("div");
  overlay.className = "t29-dialog-overlay";
  overlay.innerHTML = `
    <div class="t29-dialog${asking ? " t29-dialog-ask" : ""}" role="${asking ? "dialog" : "alertdialog"}" aria-modal="true" aria-labelledby="t29DialogMsg">
      <p class="t29-dialog-msg" id="t29DialogMsg"></p>
      ${kind === "prompt" ? `<input class="t29-dialog-input" autocomplete="off" aria-labelledby="t29DialogMsg">` : ""}
      <div class="t29-dialog-actions">
        ${asking ? `<button type="button" class="btn secondary" data-t29="cancel"></button>` : ""}
        <button type="button" class="btn ${lb.danger ? "coral" : "gold"}" data-t29="ok"></button>
      </div>
    </div>`;
  overlay.querySelector(".t29-dialog-msg").textContent = item.message;
  const okBtn = overlay.querySelector('[data-t29="ok"]');
  const cancelBtn = overlay.querySelector('[data-t29="cancel"]');
  const input = overlay.querySelector("input");
  okBtn.textContent = lb.ok;
  if (cancelBtn) cancelBtn.textContent = lb.cancel;
  if (input) {
    input.type = o.type === "number" ? "number" : "text";
    if (o.type === "number") {
      ["min", "max"].forEach(k => { if (o[k] !== undefined) input.setAttribute(k, o[k]); });
      input.setAttribute("step", o.step !== undefined ? o.step : "any");
      input.inputMode = "decimal";
    }
    if (o.placeholder) input.placeholder = o.placeholder;
    input.value = o.defaultValue;
  }
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (e.key === "Tab") {
      const f = Array.from(overlay.querySelectorAll("input, button")), a = document.activeElement;
      const i = f.indexOf(a);
      if (i === -1) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      e.stopPropagation();
      return;
    }
    if (e.key !== "Enter" || e.isComposing) return;
    // Holding Enter down on the button that opened this box must not answer it.
    if (e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target === cancelBtn) return; // Enter on Cancel presses Cancel
    e.preventDefault(); e.stopPropagation(); finish(true);
  };
  function finish(accepted) {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    _t29DialogQueue.shift();
    if (kind === "alert") item.resolve();
    else if (kind === "confirm") item.resolve(!!accepted);
    else item.resolve(accepted ? input.value : null);
    if (_t29DialogQueue.length) _t29ShowNextDialog();
    else if (returnFocus && typeof returnFocus.focus === "function") { try { returnFocus.focus(); } catch (e) { /* ignore */ } }
  }
  okBtn.addEventListener("click", () => finish(true));
  if (cancelBtn) cancelBtn.addEventListener("click", () => finish(false));
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  if (input) { input.focus(); input.select(); } else okBtn.focus();
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
      <p>The 29 World™ couldn't reach its server. Check your Wi-Fi or mobile data, then try again. You're still logged in.</p>
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
      ? "That didn't go through. Try refreshing the page, if it keeps happening, log out and back in."
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
  // An initial cached snapshot can contain only a pending merged clock probe.
  // Keep first paint safe until the complete server document arrives.
  for (const key of ["students", "jobs", "companies", "txns", "automations"]) {
    if (!Array.isArray(cls[key])) cls[key] = [];
  }
  // Classes created before report cards existed have no createdAt — leave
  // it unset (null) rather than backdating to "now", since generateClassReport
  // already falls back sensibly (recent txn history, or a 7-day window)
  // when this is missing.
  if (cls.createdAt === undefined) cls.createdAt = null;
  // Archiving pauses a class for students (see requireLogin/archived.html)
  // without deleting anything, so it can still be reopened later or used
  // as a template for a brand new class.
  if (cls.archived === undefined) cls.archived = false;
  if (cls.welcomeGrant === undefined) cls.welcomeGrant = T29_DEFAULT_WELCOME_GRANT;
  if (cls.archivedAt === undefined) cls.archivedAt = null;
  if (cls.templateShareToken === undefined) cls.templateShareToken = null;
  if (!Array.isArray(cls.coTeachers)) cls.coTeachers = [];
  if (cls.coTeacherCode === undefined) cls.coTeacherCode = null;
  if (cls.autoArchived === undefined) cls.autoArchived = false;
  // lastActivityAt is deliberately left undefined on old classes: the auto-archive
  // check starts their 3-month clock the first time it sees them.
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
    // Optional variable-rate mortgage on the listing (weekly % range, 0–0 =
    // not offered) and the floating rate currently in force — see
    // advanceVariableRates in data-property.js. Listings saved before this
    // existed stay fixed-only.
    if (p.variableRateMin === undefined) p.variableRateMin = 0;
    if (p.variableRateMax === undefined) p.variableRateMax = 0;
    if (p.variableRate === undefined) p.variableRate = 0;
    if (p.variableRateWeek === undefined) p.variableRateWeek = null;
    if (!Array.isArray(p.variableRateHistory)) p.variableRateHistory = [];
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
  cls.insuranceDay = cls.insuranceDay || "Fri";
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
    cls.gambling.winLimitMessage = "You've hit your winning limit for today. Nice work! Come back and play again tomorrow.";
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
  if (!cls.lifestyleConfig.creditCard) cls.lifestyleConfig.creditCard = { enabled: false, perAmount: 0, points: 1 };
  cls.cardPlans = cls.cardPlans || [];
  cls.accountPlans = cls.accountPlans || [];
  cls.accountSettings = cls.accountSettings || { enabled: true, approval: "instant", maxEveryday: 2, maxSavings: 3 };
  cls.cardSettings = cls.cardSettings || { enabled: true, approval: "teacher", statementDay: "Fri" };
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
    // BUGFIX: the auto market/property sims decide "today" via nzDateKey(), which uses the
    // server-corrected clock. This bootstrap ran them BEFORE the clock had synced (market.js and
    // most pages never sync it), so a device with a wrong clock stamped the wrong day into
    // lastMarketDayRun/lastPropertyMarketDayRun — making the real day look "already run".
    await syncServerClock(u.classCode).catch(() => {});
    if (typeof watchReportActivity === "function") watchReportActivity(u);
    if (u._studentView) {
      // Student view never runs the class-wide simulations: they write to the shared class.
      window.T29_RATES_READY = Promise.resolve();
    } else {
      autoMarketDayIfDue(u.classCode).catch(e => console.error("Auto stock market day failed:", e));
      autoPropertyMarketDayIfDue(u.classCode).catch(e => console.error("Auto property market day failed:", e));
      window.T29_RATES_READY = autoVariableRatesIfDue(u.classCode).catch(() => {});
    }
    // Note down net worth for the report trend: every Monday, first thing.
    // A teacher's visit covers the whole class; a student's covers themselves.
    if (u.role === "teacher" && typeof recordClassNetWorthIfDue === "function") recordClassNetWorthIfDue(u.classCode).catch(() => {});
    else if (u.role === "student" && typeof recordMyNetWorthIfDue === "function") recordMyNetWorthIfDue(u.username).catch(() => {});
  }
  applyNavRoleVisibility(u.role);
  if (u.role === "student") {
    mountBalanceWidget(u.username);
    showKiwiSaverNavIfOn(u).catch(() => {});
    showCasinoNavIfOn(u).catch(() => {});
    showModuleNavIfOn(u).catch(() => {});
  } else if (u.role === "teacher") {
    t29SaveModOffBoot(u.username, []); // teachers always see every module
    document.documentElement.classList.remove("mod-hold");
    mountModuleSwitch(u).catch(() => {});
  }
}

// The Casino (gambling.html) menu link (top bar AND side menu share the same
// markup, so one class drives both) is hidden from students (style.css)
// unless their teacher has the casino switched on. It follows the teacher's
// switch live: turn it off and the link disappears from students' menus (even
// on pages they already have open), turn it back on and it returns. There is
// deliberately no "still holds chips" exception any more.
// html.casino-unverified is the "replayed from the last visit, not yet
// confirmed" state set by the top-bar boot script: the link keeps its space
// but stays invisible until this has checked, so a stale "on" never shows.
function casinoOnFor(cls) {
  // Same rule the Gambling page uses (enabled !== false), so a class that has
  // never had the switch set behaves identically in the menu and on the page.
  return !!cls && !(cls.gambling && cls.gambling.enabled === false);
}
async function showCasinoNavIfOn(u) {
  const root = document.documentElement;
  const set = on => {
    const changed = root.classList.contains("casino-on") !== on;
    root.classList.remove("casino-unverified");
    if (changed) {
      root.classList.toggle("casino-on", on);
      if (typeof fitTopbar === "function") fitTopbar();
    }
  };
  if (!u.classCode) { set(false); return; }
  try {
    set(casinoOnFor(await getClassCached(u.classCode)));
  } catch (e) {
    set(false); // can't confirm it's on, so it stays off
    return;
  }
  // Keep in step with the teacher's switch while this page stays open.
  // Snapshots served from the local cache are skipped: they can be stale.
  if (typeof t29WatchDoc === "function") {
    t29WatchDoc("classes", u.classCode, (doc, info) => {
      if (!doc || (info && (info.error || info.fromCache))) return;
      set(casinoOnFor(doc));
    });
  }
}

// The KiwiSaver menu link stays hidden from students (style.css) if
// their teacher has switched KiwiSaver off — unless they already have one.
async function showKiwiSaverNavIfOn(u) {
  if (!u.classCode || typeof kiwiSaverSettings !== "function") return;
  const [cls, me] = await Promise.all([getClassCached(u.classCode), getUserCached(u.username)]);
  if (!cls) return;
  const want = !!(kiwiSaverSettings(cls).enabled || kiwiSaverOf(me));
  if (document.documentElement.classList.contains("ks-on") !== want) {
    document.documentElement.classList.toggle("ks-on", want);
    if (typeof fitTopbar === "function") fitTopbar();
  }
}

/* ---------------- Module on/off (teacher switch at the top of every module page) ----------------
   A teacher can switch any module off for the class. Off means: its link disappears from students'
   top bar and side menu (the same markup drives both, and the phone dropdowns), and a student who
   opens the page anyway sees a short "switched off" notice instead of the page. The state lives on the
   class doc as moduleOff: { bank: true, ... } (a missing key means on). Gambling keeps its own
   existing switch (gambling.enabled) and its own menu rule, so the switch at the top of that page just
   drives the same setting. Teachers always see every module. */
const T29_MODULES = {
  bank: "Bank", budget: "Budget", termdeposit: "Term Deposit", kiwisaver: "KiwiSaver", loan: "Loans",
  market: "Stock Market", store: "Store", marketplace: "Trade Centre", jobs: "Jobs", transport: "Transport",
  property: "Property", insurance: "Insurance", tax: "Tax", bigevents: "Big Events", life: "Life", gambling: "Gambling"
};
function moduleKeyOfPage() {
  const file = (location.pathname.split("/").pop() || "").split("?")[0];
  const key = file.replace(/\.html$/, "");
  return T29_MODULES[key] ? key : null;
}
function moduleIsOff(cls, key) {
  if (!cls || !T29_MODULES[key]) return false;
  if (key === "gambling") return !casinoOnFor(cls);
  return !!(cls.moduleOff && cls.moduleOff[key]);
}
const t29ModOffCacheKey = code => "t29-mod-off:" + code;
// Sets the menu links, the phone dropdown groups and the current page for a student.
function paintModuleOff(offKeys) {
  const root = document.documentElement;
  const off = new Set(offKeys || []);
  let changed = false;
  Object.keys(T29_MODULES).forEach(key => {
    if (key === "gambling") return; // its own menu rule (casino-on) hides it
    const isOff = off.has(key);
    document.querySelectorAll(`.topbar nav a[href="${key}.html"]`).forEach(a => {
      if (a.classList.contains("mod-off") !== isOff) { a.classList.toggle("mod-off", isOff); changed = true; }
    });
    if (root.classList.contains("mod-off-" + key) !== isOff) root.classList.toggle("mod-off-" + key, isOff);
  });
  document.querySelectorAll(".topbar nav .nav-group").forEach(g => {
    const links = [...g.querySelectorAll("a[href]")];
    const allOff = links.length > 0 && links.every(a => a.classList.contains("mod-off"));
    if (g.classList.contains("mod-off-group") !== allOff) { g.classList.toggle("mod-off-group", allOff); changed = true; }
  });
  if (changed && typeof fitTopbar === "function") fitTopbar();
}
// The page itself, when a student lands on a module that is off.
function paintModulePageOff(isOff) {
  // Now known either way: release the blank page held by the modoff-boot script, and keep its
  // "this page is off" marker in step.
  document.documentElement.classList.remove("mod-hold");
  document.documentElement.classList.toggle("mod-off-here", !!isOff);
  const key = moduleKeyOfPage();
  const main = document.querySelector("main");
  if (!key || !main) return;
  let note = document.getElementById("modOffNotice");
  if (isOff) {
    main.classList.add("mod-off-page");
    if (!note) {
      note = document.createElement("div");
      note.id = "modOffNotice";
      note.className = "card";
      note.innerHTML = `<h2>${T29_MODULES[key]} is switched off</h2><p>Your teacher has turned this off for your class for now. It will come back to your menu when they switch it on again.</p>`;
      main.prepend(note);
    }
  } else {
    main.classList.remove("mod-off-page");
    if (note) note.remove();
  }
}
// Remembers which modules are off for this person, so the modoff-boot script (in every page's <head>)
// can hide them before the first paint next time. Without it the links showed for a moment, the top bar
// sized itself for them, then jumped when they were hidden.
function t29SaveModOffBoot(username, keys) {
  try { localStorage.setItem("t29-mod-off-boot", JSON.stringify({ u: username, k: keys })); } catch (e) { /* ignore */ }
}
async function showModuleNavIfOn(u) {
  if (!u.classCode) { document.documentElement.classList.remove("mod-hold"); return; }
  // Student view: nothing is hidden or switched off. Every module stays in the menu and opens; the page
  // shows a popup saying the teacher switched it off (see qgSvLockNotice in quiz-gate.js).
  if (u._studentView) {
    paintModuleOff([]);
    paintModulePageOff(false);
    return;
  }
  // Replay the last known state straight away so a hidden module doesn't flash in the menu.
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(t29ModOffCacheKey(u.classCode)) || "null"); } catch (e) { /* ignore */ }
  if (Array.isArray(cached)) paintModuleOff(cached);
  const apply = cls => {
    const keys = Object.keys(T29_MODULES).filter(k => k !== "gambling" && moduleIsOff(cls, k));
    try { localStorage.setItem(t29ModOffCacheKey(u.classCode), JSON.stringify(keys)); } catch (e) { /* ignore */ }
    t29SaveModOffBoot(u.username, keys);
    paintModuleOff(keys);
    const here = moduleKeyOfPage();
    paintModulePageOff(!!here && here !== "gambling" && keys.includes(here));
  };
  try { apply(await getClassCached(u.classCode)); } catch (e) { document.documentElement.classList.remove("mod-hold"); return; }
  if (typeof t29WatchDoc === "function") {
    t29WatchDoc("classes", u.classCode, (doc, info) => {
      if (!doc || (info && (info.error || info.fromCache))) return;
      apply(doc);
    });
  }
}

// Teacher: switch a module on or off for the class (students are told).
async function setModuleEnabled(classCode, key, enabled) {
  if (!T29_MODULES[key]) return { ok: false, error: "Unknown module." };
  if (key === "gambling") { await setGamblingEnabled(classCode, enabled); return { ok: true }; }
  const classRef = classesCol().doc(classCode);
  let was = true;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const moduleOff = Object.assign({}, cls.moduleOff || {});
    was = !moduleOff[key];
    if (enabled) delete moduleOff[key]; else moduleOff[key] = true;
    t.update(classRef, { moduleOff });
  });
  if (was !== !!enabled && typeof t29NotifyStudents === "function") {
    const name = T29_MODULES[key];
    await t29NotifyStudents(classCode, { to: "all", icon: "sparkle", tone: enabled ? "mint" : "coral",
      title: enabled ? `Your teacher switched ${name} on` : `Your teacher switched ${name} off`,
      body: enabled ? `You can use ${name} again.` : `${name} is hidden until your teacher switches it back on.`, href: key + ".html" });
  }
  return { ok: true };
}
// Teacher: the on/off switch at the top of a module page.
async function mountModuleSwitch(u) {
  const key = moduleKeyOfPage();
  const main = document.querySelector("main");
  if (!key || !main || !u.classCode || document.getElementById("modSwitch")) return;
  const cls = await getClassCached(u.classCode);
  if (!cls) return;
  const name = T29_MODULES[key];
  const box = document.createElement("div");
  box.className = "card mod-switch";
  box.id = "modSwitch";
  box.innerHTML = `<label style="display:flex;align-items:center;gap:10px;margin:0;cursor:pointer;">
      <input type="checkbox" id="modSwitchBox" style="width:20px;height:20px;min-height:auto;flex-shrink:0;">
      <strong>${name} is on for students</strong>
    </label>
    <p class="muted-small" id="modSwitchNote" style="margin:6px 0 0;"></p>`;
  const h1 = main.querySelector("h1");
  if (h1 && h1.parentNode === main) h1.after(box); else main.prepend(box);
  const cb = box.querySelector("#modSwitchBox"), note = box.querySelector("#modSwitchNote");
  const show = on => {
    cb.checked = on;
    note.textContent = on
      ? `Switch this off to hide ${name} from students' top bar and side bar. Teachers always see it.`
      : `${name} is hidden from students' top bar and side bar. Anyone who opens the page sees that it is switched off.`;
  };
  show(!moduleIsOff(cls, key));
  cb.addEventListener("change", async () => {
    const on = cb.checked;
    cb.disabled = true;
    try {
      await setModuleEnabled(u.classCode, key, on);
      show(on);
      const g = document.getElementById("gEnabled");
      if (key === "gambling" && g) g.checked = on;
    } catch (e) {
      show(!on);
      if (typeof t29Toast === "function") t29Toast("Couldn't change that. Please try again.", { type: "error" });
    }
    cb.disabled = false;
  });
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
    : `${icon("coin", 14)} Cash balance`;
}

/* ---------------- Which account's balance to show (floating widget + the Bank page's balance tile) ----------------
   Both read the same per-device choice, and both open the same pop-up, so picking an account in one updates the other.
   Cash is the default; if the chosen account has been closed they fall back to cash, then the first open account. */
const _anwBalKey = u => "t29-bank-balance-view:" + u;
function anwGetBalView(u) { try { return localStorage.getItem(_anwBalKey(u)) || ""; } catch (e) { return ""; } }
function anwSetBalView(u, id) { try { localStorage.setItem(_anwBalKey(u), id); } catch (e) { /* just won't be remembered */ } }
// Every account the student can use right now, tagged with its kind: Cash and Savings (while open) then extra accounts.
// Works on the logical view (see "Main account" in data-money.js): "cash" is always the original Cash account.
// Each choice says whether it is the student's main account (isMain).
function anwOpenAccounts(me, cls) {
  const out = [], main = acctMainId(me), L = acctLogical(me);
  if (!acctDefaultClosed(L, "cash")) out.push({ id: "cash", label: "Cash balance", bal: L.balance || 0, kind: "everyday" });
  if (!acctDefaultClosed(L, "savings")) out.push({ id: "savings", label: "Savings Account", bal: L.savings || 0, kind: "savings" });
  acctActiveOf(L).forEach(a => { const p = acctPlanById(cls, a.planId); out.push({ id: a.id, label: p ? p.name : "Account", bal: a.balance || 0, kind: p ? p.kind : "everyday" }); });
  out.forEach(c => { c.isMain = c.id === main; });
  return out;
}
// The account shown by default is the main account (Cash unless they've picked another).
function anwBalanceChoice(me, cls) {
  const ch = anwOpenAccounts(me, cls), want = anwGetBalView(me.username);
  return { ch, cur: ch.find(c => c.id === want) || ch.find(c => c.isMain) || ch.find(c => c.id === "cash") || ch[0] || null };
}
// A small pop-up on the same look as the site's own dialogs. o: { title, html, okText?, cancelText?, danger?, collect?(box) }.
// Resolves with null (cancelled), the id of a clicked [data-pick] button, or collect()'s result (true if none) on OK.
function anwDialog(o) {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "t29-dialog-overlay";
    overlay.innerHTML = `<div class="t29-dialog t29-dialog-ask ac-dialog" role="dialog" aria-modal="true" aria-labelledby="acDlgTitle">
      <h3 class="ac-dlg-title" id="acDlgTitle"></h3>
      <div class="ac-dlg-body">${o.html || ""}</div>
      <div class="t29-dialog-actions"><button type="button" class="btn secondary" data-ac="cancel"></button>${o.okText ? `<button type="button" class="btn ${o.danger ? "coral" : "gold"}" data-ac="ok"></button>` : ""}</div>
    </div>`;
    overlay.querySelector("#acDlgTitle").textContent = o.title || "";
    const okBtn = overlay.querySelector('[data-ac="ok"]'), cancelBtn = overlay.querySelector('[data-ac="cancel"]');
    cancelBtn.textContent = o.cancelText || (o.okText ? "Cancel" : "Close");
    if (okBtn) okBtn.textContent = o.okText;
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key !== "Tab") return;
      const f = Array.from(overlay.querySelectorAll("button, select, input")), i = f.indexOf(document.activeElement);
      if (i === -1) { e.preventDefault(); f[0].focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      e.stopPropagation();
    };
    function finish(v) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (returnFocus && typeof returnFocus.focus === "function") { try { returnFocus.focus(); } catch (e) { /* ignore */ } }
      resolve(v);
    }
    overlay.addEventListener("click", e => {
      if (e.target === overlay) { finish(null); return; }
      const pk = e.target.closest("[data-pick]");
      if (pk) finish(pk.getAttribute("data-pick"));
    });
    cancelBtn.addEventListener("click", () => finish(null));
    if (okBtn) okBtn.addEventListener("click", () => finish(o.collect ? o.collect(overlay) : true));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    (overlay.querySelector("[data-pick].on") || overlay.querySelector("select") || okBtn || cancelBtn).focus();
  });
}
// The "show the balance of…" pop-up. With no arguments it works out the student and class itself (the floating widget
// does that); the Bank page passes the ones it already has.
async function anwOpenBalancePicker(me, cls) {
  try {
    if (!me) me = await getUserCached(_anwWidgetUsername || (typeof CURRENT !== "undefined" && CURRENT && CURRENT.username));
    if (!me || me.role === "teacher") return;
    if (!cls) cls = await getClassCached(me.classCode);
    const { ch, cur } = anwBalanceChoice(me, cls);
    if (ch.length < 2) return;
    const badge = k => `<span class="badge ${k === "savings" ? "mint" : "navy"}">${k === "savings" ? "Savings" : "Everyday"}</span>`;
    const html = `<p class="ac-dlg-sub">Choose which account's balance is shown.</p>
      <div class="ac-pick-list" role="radiogroup" aria-label="Account to show">${ch.map(c => `<button type="button" role="radio" aria-checked="${c.id === cur.id}" class="ac-pick${c.id === cur.id ? " on" : ""}" data-pick="${escapeHtml(c.id)}">
        <span class="ac-pick-main"><strong>${escapeHtml(c.label)}</strong>${badge(c.kind)}${c.isMain ? ` <span class="badge gold">Main</span>` : ""}</span><span class="ac-pick-bal">${fmtMoney(c.bal)}</span></button>`).join("")}</div>`;
    const pick = await anwDialog({ title: "Show the balance of…", html });
    if (!pick) return;
    anwSetBalView(me.username, pick);
    document.dispatchEvent(new CustomEvent("anw-balance-view")); // the Bank page's tile repaints on this
    anwRefreshBalanceWidget();
  } catch (e) { console.warn("Balance picker failed:", e); }
}
// Paints the floating widget: the chosen account's name and balance (chips on Roulette/Blackjack), and whether it can be tapped.
function anwPaintBalanceWidget(user, cls) {
  const box = document.getElementById("anwBalanceWidget"), valEl = document.getElementById("anwBalanceWidgetValue");
  if (!box || !valEl || !user) return;
  const labelEl = box.querySelector(".anw-bw-label");
  // Student view: money is the teacher's own bank, which never runs out.
  if (t29SvActive() && !_anwShowsChips()) {
    labelEl.innerHTML = _anwWidgetLabelHtml(); valEl.textContent = "Unlimited ∞";
    box.disabled = true; box.classList.add("is-static"); box.title = "";
    box.setAttribute("aria-label", `${labelEl.textContent.trim()} Unlimited.`);
    return;
  }
  let cur = null, n = 0;
  if (!_anwShowsChips()) { try { const r = anwBalanceChoice(user, cls); cur = r.cur; n = r.ch.length; } catch (e) { /* show cash below */ } }
  if (_anwShowsChips()) { labelEl.innerHTML = _anwWidgetLabelHtml(); valEl.textContent = fmtMoney(gamblingAccountToday(user).balance); }
  else if (cur) { labelEl.innerHTML = `${icon("coin", 14)} ${escapeHtml(cur.label)}`; valEl.textContent = fmtMoney(cur.bal); }
  else { labelEl.innerHTML = _anwWidgetLabelHtml(); valEl.textContent = fmtMoney(user.balance); }
  const clickable = n > 1;
  box.disabled = !clickable;
  box.classList.toggle("is-static", !clickable);
  box.title = clickable ? "Choose which account's balance to show" : "";
  box.setAttribute("aria-label", `${labelEl.textContent.trim()} ${valEl.textContent}.${clickable ? " Press to choose which account to show." : ""}`);
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
    anwPaintBalanceWidget(fresh, await getClassCached(fresh.classCode));
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
  // Counts settled writes so a page can tell whether anything changed (see teacher.js init).
  window._t29WriteSeq = (window._t29WriteSeq || 0) + 1;
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
    if (cached) anwPaintBalanceWidget(cached, await getClassCached(cached.classCode));
  } catch (e) {
    // The next cash-moving action (or the next tab switch) will pick it up.
  }
}

async function mountBalanceWidget(username) {
  if (document.getElementById("anwBalanceWidget")) return;
  // A button: tapping it opens the same "which account's balance to show" pop-up as the Bank page's balance tile.
  const box = document.createElement("button");
  box.type = "button";
  box.id = "anwBalanceWidget";
  box.className = "anw-balance-widget is-static";
  box.disabled = true; // until we know there is more than one account to choose from
  box.setAttribute("aria-haspopup", "dialog");
  box.addEventListener("click", () => anwOpenBalancePicker());
  box.innerHTML = `
    <div class="anw-bw-label">${_anwWidgetLabelHtml()}</div>
    <div class="anw-bw-value" id="anwBalanceWidgetValue">—</div>
  `;
  document.body.appendChild(box);
  positionBalanceWidget();
  window.addEventListener("resize", positionBalanceWidget);

  _anwWidgetUsername = username;
  const cached = await getUserCached(username);
  if (cached) anwPaintBalanceWidget(cached, await getClassCached(cached.classCode));
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

/* ===================== School-safe text check =====================
   t29TextCheck(text, opts) -> { ok, text, error? }
   Used for free-text a student types that other people can read (payment
   reasons, declined-offer reasons). It looks through disguises, not just
   plain words: f*ck, sh1t, @ss, f.u.c.k, f u c k, fuuuuck, "sh it", look-alike
   letters from other alphabets, zero-width characters, and so on. Words are
   matched as whole words (plus common endings) so harmless words that merely
   CONTAIN a bad one (class, assess, Scunthorpe, grape) are never blocked.
   Only the generic message below is shown; the offending word is never echoed.
   This runs in the browser, like the rest of the app's rules. */
const T29_FILTER_MSG = "Please keep it school-appropriate. That message has language that isn't allowed here. Reword it and try again.";
const T29_FILTER = (function () {
  // Endings a word may take (fucking, shitty, bitches ...). Strong swears take all of them; the rest only plurals.
  const END_ALL = ["", "s", "es", "ed", "er", "ers", "ing", "ings", "in", "y", "ie", "ies", "z", "head", "face"];
  const END_PLAIN = ["", "s", "es", "z"];
  const SWEAR = "fuck fucc fuk fck fuc fuq fcuk fvck phuck phuk shit sht shyt shite piss bitch biatch wank".split(" ");
  const PLAIN = ("pron ass arse arsehole arsewipe asshole asshat asswipe assface dumbass jackass smartass fatass dick dickhead dickwad cock cocksucker cunt twat prick pussy bollocks " +
    "hell crap crappy dipshit douche douchebag scumbag moron imbecile " +
    "retard retarded tard spaz spastic mong mongoloid sex sexy sexting porno horny boob tit titty titties penis vagina dildo boner jizz cum cumming cumshot " +
    "blowjob handjob rimjob milf pedo paedo anal anus orgasm nudes onlyfans hentai xxx pornhub slut slutty skank thot tranny shemale dyke homo lesbo " +
    "fag fagot faggot nigger nigga niggah niggaz nigguh nigra nigg negro darkie chink gook spic kike kyke yid wop dago honky wetback beaner coon paki raghead towelhead jap midget cripple " +
    "rape raped raping rapist molest molester incest erotic bellend tosser knobhead " +
    "nazi hitler heil kkk wtf stfu gtfo omfg lmfao ffs fml kys cocaine heroin meth lsd mdma").split(" ");
  // Inside-a-word matches: long, distinctive stems that no everyday word contains.
  const STEMS = "fuck shit bitch whore bastard cocksuck asshole asshat asswipe dickhead dickwad masturbat porn pedophil paedophil".split(" ");
  // Can be spotted when split across words ("sh it", "fu ck").
  const PAIRABLE = "fuck shit bitch cunt whore nigger nigga faggot bastard pussy wanker twat slut".split(" ");
  const ALLOW_TOKENS = new Set(["shiitake", "shiitakes", "shiite", "shiites"]);
  const ALLOW_PHRASES = /\bhell'?s? (?:pizza|kitchen)\b|\bdick smiths?\b/g;   // NZ brands that happen to contain a flagged word

  const rx = w => w.replace(/(.)\1*/g, (m, c) => c + (m.length > 1 ? "{" + m.length + ",}" : "+"));   // fuuuck, asss
  const anchored = (w, ends) => new RegExp("^(?:" + rx(w) + ")(?:" + ends.join("|") + ")$");
  const WORDS = SWEAR.map(w => anchored(w, END_ALL)).concat(PLAIN.map(w => anchored(w, END_PLAIN)));
  const INSIDE = STEMS.map(w => new RegExp(rx(w)));
  const PAIRS = PAIRABLE.map(w => anchored(w, END_PLAIN));
  const FORMS = {};   // length -> plain spellings, for masked words like f**k
  SWEAR.forEach(w => END_ALL.forEach(e => { (FORMS[(w + e).length] = FORMS[(w + e).length] || []).push(w + e); }));
  PLAIN.concat(STEMS).forEach(w => END_PLAIN.forEach(e => { (FORMS[(w + e).length] = FORMS[(w + e).length] || []).push(w + e); }));

  const PHRASES = [
    /\b(?:kill|hang|shoot|off|end|neck|hurt|harm|cut) (?:your ?self|ur ?self|yourselves)\b/,
    /\bgo (?:and )?die\b/, /\bdrop dead\b/, /\bdie in a fire\b/,
    /\b(?:hope|wish) (?:you|u|he|she|they) (?:die|dies|get cancer|rot|burn)\b/,
    /\b(?:i|we|ll|will|gonna|going to|wanna|want to|should) (?:kill|murder|stab|shoot|strangle|beat up|bash) (?:you|u|ya|him|her|them|everyone|everybody|someone|somebody)\b/,
    /\b(?:shoot up|blow up|bomb|burn down) (?:the |this |our |my )?(?:school|classroom|teachers?)\b/, /\bschool (?:shooter|shooting)\b/,
    /\b(?:kill|hate|gas|burn|exterminate|death to) (?:all )?(?:the )?(?:jews|blacks|whites|asians|gays|muslims|christians|immigrants|indians|maori|mexicans|chinese)\b/,
    /\b(?:white|aryan) (?:power|pride|supremacy|race)\b/,
    /\b(?:that|this|it|so|you|ur|u) (?:s |re |is |are |r )?gay\b/
  ];
  const GLYPH = {};   // look-alike letters from Cyrillic / Greek and a few Latin extras
  "\u0430:a \u0435:e \u043e:o \u0440:p \u0441:c \u0445:x \u0443:y \u0456:i \u0458:j \u0455:s \u043a:k \u043c:m \u043d:h \u0442:t \u0432:b \u03b1:a \u03b2:b \u03b5:e \u03b9:i \u03bf:o \u03c1:p \u03c5:u \u03bd:v \u03c4:t \u03ba:k \u00df:ss \u00f8:o \u00e6:ae \u0153:oe \u0111:d \u0142:l \u0131:i \u0127:h"
    .split(" ").forEach(p => { GLYPH[p[0]] = p.slice(2); });

  function norm(s) {
    try { s = s.normalize("NFKD"); } catch (e) { /* very old browser: carry on */ }
    s = s.replace(/[\u0300-\u036f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g, "")   // accents, zero-width and invisible characters
      .toLowerCase().replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'");
    return s.replace(/[^\x00-\x7f]/g, ch => GLYPH[ch] !== undefined ? GLYPH[ch] : " ").replace(ALLOW_PHRASES, " ");
  }
  function leet(p, amb) {
    const m = { "0": "o", "1": amb, "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s" };
    return p.replace(/[01345789@$]/g, c => m[c])
      .replace(/([a-z0-9])([!|(<+])(?=[a-z0-9])/g, (x, a, b) => a + (b === "!" || b === "|" ? amb : b === "+" ? "t" : "c"))
      .replace(/[#%^]/g, "*").replace(/([a-z0-9])\?(?=[a-z0-9])/g, "$1*");
  }
  function masked(t) {
    if (t.length < 3 || t.replace(/\*/g, "").length < 1) return false;
    return (FORMS[t.length] || []).some(f => { for (let i = 0; i < t.length; i++) if (t[i] !== "*" && t[i] !== f[i]) return false; return true; });
  }
  function tokenHit(t) {
    if (ALLOW_TOKENS.has(t)) return false;
    if (t.indexOf("*") >= 0) return masked(t);
    return INSIDE.some(r => r.test(t)) || WORDS.some(r => r.test(t));
  }
  function scan(raw, amb) {
    const s = norm(raw);
    if (/(^|[^0-9])1488([^0-9]|$)/.test(s)) return true;
    const toks = [];   // br = may be joined onto the previous token (not across an apostrophe, so he'll / who're stay safe)
    s.split(/\s+/).forEach(chunk => {
      chunk = chunk.replace(/^#(?=[a-z0-9])/, "");
      chunk.split(/'+/).forEach((part, pi) => {
        if (/[a-z@$]/.test(part)) part = leet(part, amb);   // bare numbers (455, 2024) are never turned into letters
        part.split(/[^a-z*]+/).filter(Boolean).forEach((t, k) => toks.push({ t, br: !(pi > 0 && k === 0) }));
      });
    });
    if (toks.some(o => tokenHit(o.t))) return true;
    const L2 = [];   // runs of single letters ("f u c k", "a.s.s") become one word
    for (let i = 0; i < toks.length;) {
      let j = i;
      while (j + 1 < toks.length && toks[j].t.length === 1 && toks[j + 1].t.length === 1 && toks[j + 1].br) j++;
      if (j > i && toks[j].t.length === 1) { L2.push({ t: toks.slice(i, j + 1).map(o => o.t).join(""), br: toks[i].br }); i = j + 1; }
      else { L2.push(toks[i]); i++; }
    }
    if (L2.some(o => o.t.length > 2 && tokenHit(o.t))) return true;
    for (let i = 0; i < L2.length; i++) {   // words split in two or three pieces ("sh it", "f uc k")
      let cat = L2[i].t;
      for (let j = 1; j <= 2 && i + j < L2.length && L2[i + j].br; j++) {
        cat += L2[i + j].t;
        if (cat.length <= 14 && PAIRS.some(r => r.test(cat))) return true;
      }
    }
    const phrase = toks.map(o => o.t).join(" ");
    return PHRASES.some(r => r.test(phrase));
  }
  function flag(raw) {
    const s = String(raw == null ? "" : raw);
    if (s.indexOf("\ud83d\udd95") >= 0) return true;
    return scan(s, "i") || (/[1!|]/.test(s) && scan(s, "l"));
  }
  return { flag };
})();

function t29TextCheck(text, opts) {
  opts = opts || {};
  const clean = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!clean) return { ok: true, text: "" };
  if (opts.maxLen && clean.length > opts.maxLen) return { ok: false, text: clean, error: "Please keep it to " + opts.maxLen + " characters or fewer." };
  let flagged;
  try { flagged = T29_FILTER.flag(clean); }
  catch (e) {
    // A bug in the filter must never take a payment down with it: say so plainly (blank reasons always work) and log it.
    console.error("t29TextCheck: the text filter hit an error", e);
    return { ok: false, text: clean, error: "We couldn't check that message just now. Leave the reason blank, or try again." };
  }
  if (flagged) return { ok: false, text: clean, error: opts.error || T29_FILTER_MSG };
  return { ok: true, text: clean };
}
// Teachers aren't filtered. Only looks the user up if the text was actually flagged, so normal sends cost no extra read.
async function t29NoteGate(username, note) {
  const c = t29TextCheck(note);
  if (c.ok) return null;
  let u = null;
  try { u = await getUserCached(username); } catch (e) { /* treat as a student */ }
  return (u && u.role === "teacher") ? null : { ok: false, error: c.error };
}

/* ===================== Teacher "Student view" =====================
   A teacher can use the app exactly as one of their students would, from the
   "View as student" button on their dashboard.

   HOW IT WORKS
   - It is a per-TAB mode (sessionStorage), so the teacher can keep their own
     dashboard open in another tab. getSessionUser() hands every student page the
     teacher's account with role "student" (see t29SvViewOf), so the real student
     pages, menus and rules apply. Code that reads a user doc straight from
     Firestore still sees the real "teacher" role, which is what keeps money on
     the teacher's own unlimited bank (nothing is deducted, nothing can run out).
   - Nothing done in student view is kept. When it starts, the teacher's own user
     doc is saved (as the _svBackup field on that same doc) and the student-only
     fields a teacher doc doesn't have are filled in. When it ends, every field that
     changed is put back, and the extra ones are removed (t29SvRestore).
   - The real class can't be changed from student view. A write guard on the
     Firestore shim (firebase-init.js) refuses every write except: the teacher's own
     user doc, and money sent through transferMoney (exactly what a teacher does from
     their own Bank page). Buying, selling, applying for jobs, listing, trading shares
     and quizzes are switched off up front with a clear message (T29_SV_BLOCKED_FNS).
   - Background jobs that write class-wide data (market/property days, class
     activity, presence, time limit) are skipped in student view.
   If the tab is closed without exiting, the next time the teacher opens their
   dashboard the leftover changes are cleaned up (t29SvRecoverStale). */
const T29_SV_KEY = "t29-student-view";
const T29_SV_BEAT_KEY = "t29-sv-beat";
// Fields student view never touches, so a teacher's identity can't be changed by it.
const T29_SV_PROTECTED = ["username", "role", "authUid", "classCode", "sessionVersion", "name", "title", "lastName", "_svBackup"];
// While in student view the teacher doc holds this balance, so every page's "can I afford it?" check passes
// (the teacher's own bank is unlimited). fmtMoney shows it as "Unlimited ∞"; the real balance is restored on exit.
const T29_SV_CASH = 1000000;
const T29_SV_MSG = "Switched off in student view, because it would change the real class.";
// Actions that change shared class data (purchases, jobs, listings, shares, quizzes).
// In student view each one just answers "no" with T29_SV_MSG; the page shows it where it
// would show any other error. Anything missed is still refused by the write guard below.
const T29_SV_BLOCKED_FNS = [
  "buyStoreItem", "buyStoreCart", "sellStoreItem", "sellStoreItemBulk",
  "buyProperty", "sellProperty", "rentNpcProperty", "moveOutNpcProperty",
  "createListing", "updateListing", "cancelListing", "buyListing",
  "buyShares", "sellShares",
  "submitQuizAttempt", "applyForJob_data",
  "buyVehicle", "sellVehicle", "buyTruckLicence"
];
// The few of those that report failure by throwing (their page shows e.message) instead of returning { ok: false }.
const T29_SV_THROWING = ["applyForJob_data"];
let T29_SV_ALLOW = 0;          // >0 while a send-money call is running (see t29SvTransfer)
let _svLastGesture = 0, _svLastNotice = 0;

function t29SvState() {
  try {
    const raw = sessionStorage.getItem(T29_SV_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.u && o.c) ? o : null;
  } catch (e) { return null; }
}
function t29SvActive() { return !!t29SvState(); }

// "teacher" or "student" as the app should treat this user right now.
function t29EffRole(user) {
  if (user && user.role === "teacher") {
    const st = t29SvState();
    if (st && st.u === user.username) return "student";
  }
  return user ? user.role : null;
}
// The teacher's account as student pages should see it. A copy: the cached original stays untouched.
function t29SvViewOf(u) {
  const st = t29SvState();
  if (!st || !u || u.role !== "teacher" || u.username !== st.u || u.classCode !== st.c) return u;
  return Object.assign({}, u, { role: "student", _studentView: true });
}

// Fields a real student doc starts with that a teacher doc lacks (see createStudentAccount).
// (balance is set separately, to T29_SV_CASH, when student view starts.)
function t29SvStudentDefaults() {
  return {
    jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null, savings: 0, loans: [],
    dailyLimitMinutes: null, timeSpentTodaySec: 0, timeSpentDate: null,
    timeExemptionStatus: null, timeExemptionDate: null, extraMinutesToday: 0, extraMinutesDate: null,
    reportMonth: Object.assign(emptyReportBucket(), { monthKey: nzMonthKey() }),
    reportLifetime: emptyReportBucket()
  };
}

/* ---------- The write guard (called by the Firestore shim in firebase-init.js) ---------- */
function t29SvWriteGuard(path, op, data) {
  const st = t29SvState();
  if (!st || T29_SV_ALLOW > 0) return;
  if (path === "users/" + st.u) return; // the teacher's own doc: temporary, cleared on exit
  // The server-clock probe every page does (a single hidden field, harmless).
  if (op === "set" && path === "classes/" + st.c && data && Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, "_clockProbe")) return;
  t29SvNotifyBlocked();
  const e = new Error("STUDENT_VIEW_BLOCKED");
  e.code = "t29-student-view-blocked";
  throw e;
}
window.__t29WriteGuard = t29SvWriteGuard;

// Only speaks up when the refusal follows something the teacher just did, so the page's own
// background work never pops a message.
function t29SvNotifyBlocked() {
  const now = Date.now();
  if (now - _svLastGesture > 6000 || now - _svLastNotice < 5000) return;
  _svLastNotice = now;
  try { t29Toast(T29_SV_MSG, { type: "error" }); } catch (e) { /* no toast available */ }
}

// Sending money works exactly as it does for a teacher on their own Bank page.
async function t29SvTransfer(fromUser, toUser, amount, note) {
  T29_SV_ALLOW++;
  try { return await transferMoney(fromUser, toUser, amount, note); }
  finally { T29_SV_ALLOW--; }
}

function t29SvInstallWrappers() {
  T29_SV_BLOCKED_FNS.forEach(name => {
    const f = window[name];
    if (typeof f !== "function" || f._svWrapped) return;
    const throws = T29_SV_THROWING.indexOf(name) !== -1;
    const w = async function () { if (throws) throw new Error(T29_SV_MSG); return { ok: false, error: T29_SV_MSG }; };
    w._svWrapped = true;
    window[name] = w;
  });
  if (typeof window.sendMoneyFrom === "function" && !window.sendMoneyFrom._svWrapped) {
    const w = async function (fromUser, toUser, amount, note) { return t29SvTransfer(fromUser, toUser, amount, note); };
    w._svWrapped = true;
    window.sendMoneyFrom = w;
  }
}

/* ---------- Starting, leaving and cleaning up ---------- */
async function t29SvEnter() {
  const u = await getSessionUser();
  if (!u || u.role !== "teacher" || !u.classCode) return { ok: false, error: "Open one of your classes first." };
  const ref = usersCol().doc(u.username);
  const fail = { ok: false, error: "Couldn't start student view. Check your connection and try again." };
  let fresh;
  try {
    const snap = await ref.get({ source: "server" });
    if (!snap.exists) return fail;
    fresh = snap.data();
    if (fresh._svBackup) { // left over from a student view that was never closed: clear it first so changes can't stack
      await t29SvRestore(u.username);
      const again = await ref.get({ source: "server" });
      fresh = again.data();
    }
  } catch (e) { return fail; }
  const clean = Object.assign({}, fresh);
  delete clean._svBackup;
  const patch = { _svBackup: JSON.stringify({ at: Date.now(), doc: clean }), balance: T29_SV_CASH };
  const defaults = t29SvStudentDefaults();
  Object.keys(defaults).forEach(k => { if (clean[k] === undefined) patch[k] = defaults[k]; });
  try { await ref.update(patch); } catch (e) { console.warn("Student view couldn't start:", e); return fail; }
  try {
    sessionStorage.setItem(T29_SV_KEY, JSON.stringify({ u: u.username, c: u.classCode, t: Date.now() }));
    localStorage.setItem(T29_SV_BEAT_KEY, JSON.stringify({ u: u.username, t: Date.now() }));
    // The menu layout saved from the teacher pages must not flash on the first student page.
    localStorage.removeItem("t29-topbar-fit");
    localStorage.removeItem("t29-mod-off-boot");
  } catch (e) { /* storage blocked: the mode can't start */
    try { await t29SvRestore(u.username); } catch (e2) { /* cleaned up on the next dashboard visit */ }
    return { ok: false, error: "Your browser is blocking the storage student view needs." };
  }
  window.location.href = "student.html";
  return { ok: true };
}

// Puts the teacher's doc back exactly as it was when student view started.
async function t29SvRestore(username) {
  const ref = usersCol().doc(username);
  const snap = await ref.get({ source: "server" });
  if (!snap.exists) return true;
  const now = snap.data();
  if (!now._svBackup) return true;
  let b = null;
  try { b = JSON.parse(now._svBackup); } catch (e) { b = null; }
  const del = firebase.firestore.FieldValue.delete();
  const patch = { _svBackup: del };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isStamp = v => !!v && typeof v === "object" && own(v, "seconds") && own(v, "nanoseconds");
  if (b && b.doc && typeof b.doc === "object") {
    const was = b.doc;
    new Set(Object.keys(now).concat(Object.keys(was))).forEach(k => {
      if (T29_SV_PROTECTED.indexOf(k) !== -1) return;
      const had = own(was, k), has = own(now, k);
      if (had && has) {
        if (JSON.stringify(was[k]) === JSON.stringify(now[k]) || isStamp(was[k])) return;
        patch[k] = was[k];
      } else if (had) { if (!isStamp(was[k])) patch[k] = was[k]; }
      else patch[k] = del;
    });
  }
  await ref.update(patch);
  try { if (window._rcDel) window._rcDel("users", username); } catch (e) { /* cache not installed */ }
  return true;
}

async function t29SvExit(opts) {
  opts = opts || {};
  const st = t29SvState();
  const username = st ? st.u : T29_SESSION_USERNAME;
  t29SvBusy("Leaving student view…");
  let ok = true;
  try { if (username) ok = await t29SvRestore(username); } catch (e) { console.warn("Student view cleanup failed:", e); ok = false; }
  try {
    sessionStorage.removeItem(T29_SV_KEY);
    // A failed clean-up keeps an already-expired heartbeat, so the next dashboard visit retries at once.
    if (ok) localStorage.removeItem(T29_SV_BEAT_KEY);
    else localStorage.setItem(T29_SV_BEAT_KEY, JSON.stringify({ u: username, t: 0 }));
    localStorage.removeItem("t29-topbar-fit");
    localStorage.removeItem("t29-mod-off-boot");
  } catch (e) { /* ignore */ }
  const back = () => { if (opts.redirect !== false) window.location.href = "teacher.html"; };
  if (!ok) {
    try { await t29Alert("Your changes from student view couldn't be cleared just now (no connection?). They'll be cleared the next time you open your dashboard."); } catch (e) { /* ignore */ }
  }
  back();
}

// Called by the teacher pages after requireLogin(): if a student view was abandoned (tab closed,
// browser crashed) clear what it left behind. A live student view in another tab is left alone.
async function t29SvRecoverStale(u) {
  try {
    if (!u || u.role !== "teacher" || !u._svBackup || t29SvActive()) return false;
    let beat = null;
    try { beat = JSON.parse(localStorage.getItem(T29_SV_BEAT_KEY) || "null"); } catch (e) { beat = null; }
    let at = 0;
    try { at = JSON.parse(u._svBackup).at || 0; } catch (e) { at = 0; }
    const mine = !!beat && beat.u === u.username;
    // Same browser: the open student-view tab pings every few seconds. Another device: no ping to go by, so wait a couple of hours.
    const stale = mine ? (Date.now() - (beat.t || 0) > 30000) : (!at || Date.now() - at > 2 * 3600 * 1000);
    if (!stale) return false;
    await t29SvRestore(u.username);
    try { localStorage.removeItem(T29_SV_BEAT_KEY); } catch (e) { /* ignore */ }
    return true;
  } catch (e) { console.warn("Student view clean-up:", e); return false; }
}

/* ---------- On-page bits: the "Exit" pill, heartbeat and wrappers ---------- */
function t29SvBusy(text) {
  if (!document.body || document.getElementById("t29SvBusy")) return;
  const d = document.createElement("div");
  d.id = "t29SvBusy";
  d.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);color:#fff;font:600 16px/1.4 system-ui,sans-serif;";
  d.textContent = text;
  document.body.appendChild(d);
}

function t29SvMountPill() {
  if (!document.body || document.getElementById("t29SvPill")) return;
  if (!document.getElementById("t29SvCss")) {
    const css = document.createElement("style");
    css.id = "t29SvCss";
    css.textContent = `
#t29SvPill{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9500;
  display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);padding:8px 8px 8px 16px;border-radius:999px;
  background:#1e293b;color:#fff;box-shadow:0 6px 24px rgba(15,23,42,.35);font:600 14px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;}
#t29SvPill .t29sv-dot{width:9px;height:9px;border-radius:50%;background:#fbbf24;flex:none;}
#t29SvPill .t29sv-text{display:flex;flex-direction:column;min-width:0;}
#t29SvPill .t29sv-text small{font-weight:500;font-size:12px;opacity:.78;}
#t29SvPill .t29sv-exit{flex:none;border:0;border-radius:999px;padding:8px 16px;background:#fbbf24;color:#1e293b;font:700 14px/1 inherit;font-family:inherit;cursor:pointer;}
#t29SvPill .t29sv-exit:hover{background:#fcd34d;}
#t29SvPill .t29sv-exit:focus-visible{outline:3px solid #fff;outline-offset:2px;}
html.t29-student-view body{padding-bottom:84px;}
@media (max-width:480px){#t29SvPill{gap:8px;padding-left:12px;}#t29SvPill .t29sv-text small{display:none;}}
@media print{#t29SvPill{display:none;}}`;
    document.head.appendChild(css);
  }
  const pill = document.createElement("div");
  pill.id = "t29SvPill";
  pill.setAttribute("role", "region");
  pill.setAttribute("aria-label", "Student view");
  pill.innerHTML = `<span class="t29sv-dot" aria-hidden="true"></span><span class="t29sv-text"><span>Student view</span><small>Anything you do here is temporary</small></span><button type="button" class="t29sv-exit">Exit</button>`;
  pill.querySelector(".t29sv-exit").addEventListener("click", () => { t29SvExit(); });
  document.body.appendChild(pill);
}

function t29SvBoot() {
  const st = t29SvState();
  if (!st) return;
  document.documentElement.classList.add("t29-student-view");
  t29SvMountPill();
  // The page's scripts are loaded deferred, so most of the functions to wrap don't exist yet at this
  // point: try again after the last script has run (DOMContentLoaded) and once the page has loaded.
  // Installing is safe to repeat. A click before it lands is still stopped by the write guard.
  t29SvInstallWrappers();
  document.addEventListener("DOMContentLoaded", t29SvInstallWrappers);
  window.addEventListener("load", t29SvInstallWrappers);
  setTimeout(t29SvInstallWrappers, 400);
  ["pointerdown", "click", "keydown", "submit", "change"].forEach(ev =>
    document.addEventListener(ev, () => { _svLastGesture = Date.now(); }, true));
  const beat = () => { try { localStorage.setItem(T29_SV_BEAT_KEY, JSON.stringify({ u: st.u, t: Date.now() })); } catch (e) { /* ignore */ } };
  beat();
  setInterval(beat, 5000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", t29SvBoot);
else t29SvBoot();
