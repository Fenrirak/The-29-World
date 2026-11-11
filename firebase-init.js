/* ===================== The 29 World — Firebase init =====================
   Loaded as an ES module (type="module" in the HTML), BEFORE icons.js,
   settings-menu.js, the data-*.js files, and everything else, on every page.

   MIGRATION NOTE (compat -> modular SDK): this file used to load Firebase
   via the three "compat" CDN bundles (firebase-app-compat.js etc.), which
   expose the old namespaced `firebase.foo()` API and are built ON TOP of
   the modular SDK — meaning a page paid for both the modular engine AND
   the compat wrapper around it. This file now imports the modular SDK
   directly (smaller download, less to parse on a phone), and builds a
   small compat-SHAPED shim below so that the data-*.js files and every other file in
   this app — which were all written against the old `fdb.collection(x)
   .doc(y).get()` / `firebase.auth()` style — keep working completely
   unchanged. Nothing outside this file needed to change for this switch.

   The shim only covers the exact surface this app actually calls (traced
   through every *.js file): collection/query get and live snapshots, document
   get/set/update/delete, single-filter `.where()`, runTransaction, batch, FieldValue.serverTimestamp/
   increment/delete, and the handful of Auth methods used by login/signup/
   the legacy-migration bridge/change-password. If a future page starts
   using some other Firestore/Auth method, it needs a matching addition
   here — it will otherwise fail with "X is not a function", which is an
   easy, loud failure to spot (not a silent behavior change).
========================================================================= */
import { initializeApp, deleteApp }
  from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getFirestore, doc, collection, query, where,
  getDoc, getDocFromServer, getDocs, getDocsFromServer, onSnapshot,
  setDoc, updateDoc, deleteDoc, runTransaction, writeBatch,
  serverTimestamp, increment, deleteField, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signOut, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, deleteUser,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVr1PKkvy9fZ7P3hiQ-QImEe7sjfAhqFw",
  authDomain: "world-e0c82.firebaseapp.com",
  projectId: "world-e0c82",
  storageBucket: "world-e0c82.firebasestorage.app",
  messagingSenderId: "1015987500279",
  appId: "1:1015987500279:web:7aa31bd26deffa7c344ff2",
  measurementId: "G-CZNQMEK1P7"
};

const _app = initializeApp(firebaseConfig);

/* ---------------- App Check (OFF until you paste a key) ----------------
   App Check makes Firebase refuse requests that don't come from THIS
   website (scripts, curl, copies of the site on other domains). Leave the
   key below empty and nothing at all changes: no extra download, no
   behaviour change. To turn it on: Firebase console > App Check > register
   the web app with reCAPTCHA v3, paste the SITE key here, deploy, watch
   the App Check metrics for a few days, THEN switch on enforcement for
   Cloud Firestore. It cannot stop a student using the console on the real
   site (that visitor passes the check) -- see the rate limit that goes
   inside Cloud Functions for that. */
const T29_APPCHECK_SITE_KEY = "";
let _appCheckMod = null;
async function _t29EnableAppCheck(app) {
  if (!T29_APPCHECK_SITE_KEY) return;
  try {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    _appCheckMod = await import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app-check.js");
    _appCheckMod.initializeAppCheck(app, {
      provider: new _appCheckMod.ReCaptchaV3Provider(T29_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) {
    // Never let App Check stop the site from loading.
    console.warn("App Check could not start:", e);
  }
}
const _appCheckReady = _t29EnableAppCheck(_app);
const _db = getFirestore(_app);
const _auth = getAuth(_app);

/* ---------------- Compat-shaped Firestore shim ----------------
   Every function below wraps a real modular call but hands back (or
   accepts) objects shaped like the OLD compat API, so calling code
   doesn't need to know anything changed:
     - doc snapshots expose `.exists` as a boolean PROPERTY (compat),
       not a method call like modular's `snap.exists()` — this is the
       single most common compat/modular gotcha, and every read in this
       app (152 call sites) uses the compat property form.
     - doc refs expose `.get()/.set()/.update()/.delete()` directly,
       matching every call site in the data-*.js files.
   Doc refs returned by this shim carry the REAL modular DocumentReference
   internally (as `_ref`) so runTransaction()/batch() below can unwrap it
   and hand the genuine modular ref to the real transaction/batch — those
   only work with real refs, not shim objects. */

/* ---------------- Write guard (used by "student view") ----------------
   While a teacher is previewing the app as a student, data-core.js installs
   window.__t29WriteGuard. Every write that goes through this shim (single
   writes, transaction writes and batch writes) is shown to it first with the
   document path, the kind of write, and the data. It throws to refuse the write.
   With nothing installed (every normal session) this does nothing at all. */
function _t29GuardCheck(ref, op, data) {
  const g = window.__t29WriteGuard;
  if (typeof g === "function") g(ref && ref.path, op, data);
}
// Promise-returning writes must REJECT (not throw synchronously), so
// `ref.set(...).catch(...)` keeps working for callers that use that form.
function _t29Guarded(ref, op, data, run) {
  try { _t29GuardCheck(ref, op, data); } catch (e) { return Promise.reject(e); }
  return run();
}

function _wrapSnap(snap) {
  const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
  // metadata lets live listeners tell a local, not-yet-saved change from a confirmed one.
  const md = snap.metadata || {};
  return { id: snap.id, exists, data: () => (exists ? snap.data() : undefined),
           metadata: { fromCache: !!md.fromCache, hasPendingWrites: !!md.hasPendingWrites } };
}

function _wrapQuerySnap(snap) {
  const docs = snap.docs.map(_wrapSnap);
  return { docs, empty: docs.length === 0, size: docs.length,
    forEach(cb) { docs.forEach(cb); },
    metadata: { fromCache: !!snap.metadata?.fromCache, hasPendingWrites: !!snap.metadata?.hasPendingWrites } };
}

function _wrapQueryRef(ref) {
  return {
    async get(opts) { return _wrapQuerySnap(await (opts && opts.source === "server" ? getDocsFromServer(ref) : getDocs(ref))); },
    onSnapshot(next, error) {
      return onSnapshot(ref, { includeMetadataChanges: true },
        snap => next(_wrapQuerySnap(snap)), err => { if (error) error(err); });
    }
  };
}

function _wrapDocRef(realRef, db) {
  return {
    _ref: realRef,
    async get(opts) {
      const snap = (opts && opts.source === "server")
        ? await getDocFromServer(realRef)
        : await getDoc(realRef);
      return _wrapSnap(snap);
    },
    // Live listener on this one document. Returns the function that stops it.
    // Billed one read when it starts and one per change after that, instead of one per poll.
    onSnapshot(optionsOrNext, nextOrError, onError) {
      const hasOptions = typeof optionsOrNext !== "function";
      const options = hasOptions ? optionsOrNext : {};
      const next = hasOptions ? nextOrError : optionsOrNext;
      const error = hasOptions ? onError : nextOrError;
      return onSnapshot(realRef, options, snap => next(_wrapSnap(snap)), err => { if (error) error(err); });
    },
    set(data, options) {
      return _t29Guarded(realRef, "set", data, () => _t29DirectWrite(db, realRef, "set", data, options));
    },
    update(data) { return _t29Guarded(realRef, "update", data, () => _t29DirectWrite(db, realRef, "update", data)); },
    delete() { return _t29Guarded(realRef, "delete", null, () => _t29DirectWrite(db, realRef, "delete")); }
  };
}

function _wrapCollectionRef(name, db = _db) {
  const realCol = collection(db, name);
  return {
    ..._wrapQueryRef(realCol),
    doc(id) { return _wrapDocRef(doc(realCol, id), db); },
    // Class ownership/co-teacher queries use one filter; no chaining is needed.
    where(field, op, value) {
      const q = query(realCol, where(field, op, value));
      return _wrapQueryRef(q);
    }
  };
}

// Built by a function (rather than one fixed object) so a second, separate
// Firestore connection can get the exact same compat-shaped API — see
// t29OpenSignupSession() below.
// Every Firebase connection (including bulk signup) uses this boundary.
// Class writes and their projection commit together. Deferred transaction writes
// let us finish all reads first, as required by the modular SDK.
const _t29SummaryFields = ["code", "name", "teacher", "coTeachers", "createdAt",
  "lastActivityAt", "archived", "archivedAt", "autoArchived", "students"];
function _t29ClassWrite(op) {
  return /^classes\/[^/]+$/.test(op.ref.path) && (op.method === "delete"
    || (op.method === "set" && !op.options?.merge && !op.options?.mergeFields)
    || Object.keys(op.data || {}).some(k => _t29SummaryFields.includes(k.split(".")[0])));
}
function _t29SummarySource(data) {
  const out = {};
  for (const k of _t29SummaryFields) if (Object.hasOwn(data || {}, k)) {
    out[k] = Array.isArray(data[k]) ? data[k].slice() : data[k];
  }
  return out;
}
function _t29Summary(code, cls) {
  return { code, name: cls.name ?? "", teacher: cls.teacher ?? "",
    coTeachers: cls.coTeachers || [], createdAt: cls.createdAt ?? null,
    lastActivityAt: cls.lastActivityAt ?? null, archived: !!cls.archived,
    archivedAt: cls.archivedAt ?? null, autoArchived: !!cls.autoArchived,
    studentCount: (cls.students || []).length };
}
window.t29DeriveClassSummary = _t29Summary;
// The native SDK captures values when set/update is called. Preserve that
// contract while deferring writes; later callback mutations must not change
// queued payloads. Keep SDK Timestamp/FieldValue/DocumentReference instances.
function _t29SnapshotWriteValue(value) {
  if (Array.isArray(value)) return value.map(_t29SnapshotWriteValue);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === null || Object.prototype.hasOwnProperty.call(proto, "isPrototypeOf")) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, _t29SnapshotWriteValue(v)]));
    }
  }
  return value;
}
function _t29Queue(ops, ref, method, data, options) {
  _t29GuardCheck(ref, method, data);
  const captured = _t29SnapshotWriteValue(data);
  ops.push({ ref, method, data: captured, options, summaryData: _t29SummarySource(captured) });
}
function _t29ApplyWrite(writer, op) {
  if (op.method === "delete") writer.delete(op.ref);
  else if (op.method === "set" && op.options) writer.set(op.ref, op.data, op.options);
  else writer[op.method](op.ref, op.data);
}
async function _t29Flush(db, writer, ops, reads) {
  const states = new Map();
  for (const op of ops.filter(_t29ClassWrite)) {
    const code = op.ref.id || op.ref.path.split("/")[1];
    if (op.method === "delete") { states.set(code, { deleted: true }); continue; }
    const replacing = op.method === "set" && !op.options?.merge && !op.options?.mergeFields;
    let state = states.get(code);
    if (!state || state.deleted) {
      let base = reads ? reads.get(op.ref.path) : undefined;
      // Full replacement needs no read (new teacher signup cannot read its
      // class yet). Blind batch changes invalidate instead of guessing.
      if (!replacing && base === undefined && reads) {
        const snap = await writer.get(op.ref);
        base = snap.exists() ? _t29SummarySource(snap.data()) : {};
        reads.set(op.ref.path, base);
      }
      state = { data: base || {}, invalid: !replacing && base === undefined };
    }
    if (replacing) state = { data: {}, invalid: false };
    const patch = op.summaryData;
    // Transforms (notably a blind co-teacher join/leave) cannot be derived
    // without a readable preimage. Delete + generation advance is atomic:
    // every dashboard must remigrate before it can trust summaries again.
    if (op.options?.mergeFields || Object.keys(op.data || {}).some(k => k.includes(".") && _t29SummaryFields.includes(k.split(".")[0]))
      || Object.values(patch).some(v => v && typeof v === "object" && !Array.isArray(v))) state.invalid = true;
    Object.assign(state.data, patch);
    states.set(code, state);
  }
  for (const op of ops) _t29ApplyWrite(writer, op);
  let invalidated = null;
  for (const [code, state] of states) {
    const ref = doc(db, "classSummaries", code);
    if (state.deleted || state.invalid) writer.delete(ref);
    else writer.set(ref, { ..._t29Summary(code, state.data), updatedAt: serverTimestamp() });
    if (state.invalid) invalidated = code;
  }
  if (invalidated) writer.set(doc(db, "classSummaryState", "global"), { generation: increment(1), classCode: invalidated }, { merge: true });
}
async function _t29DirectWrite(db, ref, method, data, options) {
  const op = { ref, method, data, options, summaryData: _t29SummarySource(data) };
  try {
    if (!_t29ClassWrite(op)) {
      if (method === "delete") return await deleteDoc(ref);
      if (method === "update") return await updateDoc(ref, data);
      return await (options ? setDoc(ref, data, options) : setDoc(ref, data));
    }
    // Co-teacher join is deliberately blind: the joining teacher has no
    // permission to read this class before committing the invitation.
    if (method === "update" && Object.hasOwn(data, "coTeacherJoin")) {
      const batch = writeBatch(db);
      await _t29Flush(db, batch, [op], null);
      return await batch.commit();
    }
    if (method === "delete" || (method === "set" && !options?.merge && !options?.mergeFields)) {
      const batch = writeBatch(db);
      await _t29Flush(db, batch, [op], null);
      return await batch.commit();
    }
    return await runTransaction(db, tx => _t29Flush(db, tx, [op], new Map()));
  } catch (e) { console.warn("Class/summary write failed:", ref.path, e); throw e; }
}
function _makeFdb(db) { return {
  collection(name) { return _wrapCollectionRef(name, db); },
  async runTransaction(updateFn) {
    try {
      return await runTransaction(db, async transaction => {
        const ops = [], reads = new Map();
        const t = {
          async get(ref) {
            const snap = await transaction.get(ref._ref);
            if (/^classes\/[^/]+$/.test(ref._ref.path)) reads.set(ref._ref.path, _t29SummarySource(snap.exists() ? snap.data() : {}));
            return _wrapSnap(snap);
          },
          set(ref, data, options) { _t29Queue(ops, ref._ref, "set", data, options); return t; },
          update(ref, data) { _t29Queue(ops, ref._ref, "update", data); return t; },
          delete(ref) { _t29Queue(ops, ref._ref, "delete"); return t; }
        };
        const result = await updateFn(t);
        await _t29Flush(db, transaction, ops, reads);
        return result;
      });
    } catch (e) { console.warn("Transaction (including class summaries) failed:", e); throw e; }
  },
  batch() {
    const ops = [];
    const batch = {
      set(ref, data, options) { _t29Queue(ops, ref._ref, "set", data, options); return batch; },
      update(ref, data) { _t29Queue(ops, ref._ref, "update", data); return batch; },
      delete(ref) { _t29Queue(ops, ref._ref, "delete"); return batch; },
      async commit() {
        try {
          const writer = writeBatch(db);
          await _t29Flush(db, writer, ops, null);
          await writer.commit();
          // Batch writes bypass installReadCache's document/transaction hooks.
          for (const op of ops) {
            const [col, id] = op.ref.path.split("/");
            if (col === "users" || col === "classes") window._rcDel?.(col, id);
          }
          if (ops.some(op => /^(users|classes)\//.test(op.ref.path))) window._anwOnWriteSettled?.();
        } catch (e) { console.warn("Batch (including class summaries) failed:", e); throw e; }
      }
    };
    return batch;
  }
}; }
const fdb = _makeFdb(_db);

/* ---------------- Compat-shaped Auth shim ----------------
   Wraps the handful of Auth methods data-core.js actually calls (login/signup/
   legacy-migration bridge/change-password). A wrapped "user" object below
   adds back the instance methods compat users had (.delete()/
   .reauthenticateWithCredential()/.updatePassword()) as thin calls to the
   modular top-level functions of the same name — modular moved these off
   the User object itself, onto standalone functions. */

function _wrapUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email || null,
    isAnonymous: u.isAnonymous,
    delete() { return deleteUser(u); },
    reauthenticateWithCredential(cred) { return reauthenticateWithCredential(u, cred); },
    updatePassword(newPw) { return updatePassword(u, newPw); }
  };
}

const authShim = {
  onAuthStateChanged(cb) {
    return onAuthStateChanged(_auth, (u) => cb(_wrapUser(u)));
  },
  signOut() { return signOut(_auth); },
  async signInAnonymously() {
    const r = await signInAnonymously(_auth);
    return { user: _wrapUser(r.user) };
  },
  async createUserWithEmailAndPassword(email, password) {
    const r = await createUserWithEmailAndPassword(_auth, email, password);
    return { user: _wrapUser(r.user) };
  },
  // Teacher account recovery (see t29SendRecoveryLink / t29CompleteRecovery in data-core.js).
  sendSignInLinkToEmail(email, settings) { return sendSignInLinkToEmail(_auth, email, settings); },
  isSignInWithEmailLink(link) { return isSignInWithEmailLink(_auth, link); },
  async signInWithEmailLink(email, link) {
    const r = await signInWithEmailLink(_auth, email, link);
    return { user: _wrapUser(r.user) };
  },
  async signInWithEmailAndPassword(email, password) {
    const r = await signInWithEmailAndPassword(_auth, email, password);
    return { user: _wrapUser(r.user) };
  },
  get currentUser() { return _wrapUser(_auth.currentUser); }
};

// firebase.auth() is called as a function AND used as a namespace
// (firebase.auth.EmailAuthProvider.credential(...) — no parens on
// `auth`), so the callable itself needs EmailAuthProvider attached as a
// property, same as firebase.firestore.FieldValue below.
function authFn() { return authShim; }
authFn.EmailAuthProvider = EmailAuthProvider;

function firestoreFn() { return fdb; }
firestoreFn.FieldValue = { serverTimestamp, increment, delete: deleteField, arrayUnion, arrayRemove };

// Every other file in this app (the data-*.js files and beyond) is a plain classic
// <script>, not a module, so it can only see these via window — a
// module's own top-level consts are NOT automatically global the way a
// classic script's are.
window.fdb = fdb;
window.firebase = { auth: authFn, firestore: firestoreFn };

// A second, throw-away Firebase connection used ONLY while a teacher adds a
// list of students at once (see t29BulkCreateStudents in data-core.js).
//
// Why it exists: createUserWithEmailAndPassword() signs the new account in
// on whatever connection created it. Doing that on the normal connection
// would sign the teacher out and sign them in as the first student they
// made. firestore.rules also only lets a brand-new login write its OWN
// /uidIndex entry, /users doc and roster line (see isSignupClassJoin), so
// each student's records have to be written while signed in as that
// student. A separate, named app gives us a separate login to do that on,
// leaving the teacher's own session completely untouched.
//
// The login is kept in memory only (never saved in the browser), is signed
// out after every student, and the whole connection is deleted by close().
let _signupSessionSeq = 0;
window.t29OpenSignupSession = function t29OpenSignupSession() {
  const app2 = initializeApp(firebaseConfig, "t29-signup-" + Date.now() + "-" + (++_signupSessionSeq));
  const auth2 = initializeAuth(app2, { persistence: inMemoryPersistence });
  // Same App Check as the main connection (no-op while the key is empty),
  // so adding students in bulk keeps working once enforcement is on.
  if (_appCheckMod) {
    try {
      _appCheckMod.initializeAppCheck(app2, {
        provider: new _appCheckMod.ReCaptchaV3Provider(T29_APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: false
      });
    } catch (e) { console.warn("App Check (signup session):", e); }
  }
  const db2 = getFirestore(app2);
  return {
    fdb: _makeFdb(db2),
    auth: {
      async createUserWithEmailAndPassword(email, password) {
        const r = await createUserWithEmailAndPassword(auth2, email, password);
        return { user: _wrapUser(r.user) };
      },
      signOut() { return signOut(auth2); }
    },
    async close() {
      try { await signOut(auth2); } catch (e) { /* nothing signed in */ }
      try { await deleteApp(app2); } catch (e) { /* already gone */ }
    }
  };
};

// ---------------- Auth ----------------
// SECURITY FIX: this app used to sign every visitor in anonymously and
// rely only on Firestore rules checking "is SOME auth token present" —
// which made every document readable/writable by any visitor, logged in
// or not. Real per-account identity now comes from Firebase Auth's
// email/password provider (see t29AuthEmail()/login()/createTeacherAndClass()/
// createStudentAccount() in data-core.js), and firestore.rules checks the
// SPECIFIC signed-in user against the document's owner, not just "is
// someone signed in".
//
// There is deliberately no more unconditional signInAnonymously() call
// here. T29_AUTH_READY now just waits for Firebase to restore whatever
// session already exists (a real logged-in user, or nobody) before the
// rest of the app makes its first Firestore call — it does NOT create a
// new session itself. A page that needs someone to actually be logged in
// still goes through requireLogin() in data-core.js, same as before.
window.T29_AUTH_READY = _appCheckReady.then(() => new Promise(resolve => {
  const unsub = authShim.onAuthStateChanged(async (user) => {
    unsub();
    // BUGFIX: before this security fix shipped, EVERY visitor was signed
    // into Firebase Auth anonymously, and firestore.rules only checked
    // "is someone signed in" — so an anonymous session was enough to read
    // and write anything. Firebase Auth persists that anonymous session
    // in the browser itself, so a browser that visited before this fix
    // can still restore that old anonymous session here, even though
    // this file no longer creates new ones ("There is deliberately no
    // more unconditional signInAnonymously() call here", above).
    //
    // firestore.rules now keys almost everything off request.auth.uid
    // matching a real /uidIndex entry (myUsername()/myUserDoc()) — an
    // anonymous uid never has one. That means signedIn() reports true (a
    // token IS present), so a legacy, not-yet-migrated account can still
    // read its OWN /users doc (the explicit legacy bypass in
    // firestore.rules covers that one case) and so requireLogin()
    // succeeds and the page starts to load — but every other read that
    // needs myUsername()/myUserDoc() (the class doc, classmates, jobs,
    // anything) throws, which Firestore reports to the client as
    // "Missing or insufficient permissions". That's what was showing up
    // on student.html/teacher.html: the page gets partway in on a stale
    // anonymous session, then fails everywhere else.
    //
    // Signing out a restored anonymous session here, before anything else
    // in the app runs, forces that visitor through a real login() instead
    // — which is exactly what runs the one-time legacy migration (see
    // t29TryMigrateLegacyLogin() in data-core.js) and leaves them with a real,
    // fully-working per-account identity instead of a half-working one.
    // This never interferes with that migration's own brief, self-managed
    // signInAnonymously() call — that one signs itself back out again
    // before this promise is even created on the next page load.
    if (user && user.isAnonymous) {
      await authShim.signOut().catch(() => {});
    }
    resolve();
  });
}));

// Every account is stored in Firebase Auth under a synthetic email built
// from its app-level username, since this app never collects real email
// addresses. Centralised here so login/signup/migration all construct it
// identically.
//
// BUGFIX: usernames only ever went through Firebase's own email-format
// check starting with the password-encryption security fix — the
// post-fix signup flow (createTeacherAndClass()/createStudentAccount() in
// the data-*.js files) calls createUserWithEmailAndPassword() immediately, which
// rejects an invalid email like "nathan liu@t29.local" (a space isn't
// legal in an email address) right at signup. Before that fix, signup
// just wrote a plain Firestore doc with no such check, so a legacy
// account could end up with any string as its "username" — including one
// with spaces or other characters that don't survive into a valid email.
// On login, that invalid email made Firebase's identitytoolkit API
// reject the request outright (e.g. "auth/invalid-email"), which isn't
// one of the codes login() in data-core.js treats as "try the legacy
// migration fallback" — so a legacy account with a space in its username
// was permanently stuck on "Incorrect username or password", regardless
// of password.
//
// Sanitizing here fixes it for every caller (login, signup, the
// migration bridge, change-password) since they all funnel through this
// one function. The `safe === raw` fast path deliberately returns the
// EXACT SAME email as before for every username that was already
// email-safe — i.e. every account that has ever successfully completed
// createUserWithEmailAndPassword() up to now, since only an email-safe
// username could have gotten that far. That means this change can only
// ever change the email for an account that could NOT already be
// migrated (a genuinely invalid email would have failed at creation
// time), so it never breaks an existing working login.
//
// For the (only-ever-legacy) usernames that do need sanitizing, a short
// hash of the ORIGINAL raw username is appended so that two different
// raw usernames which only differ by punctuation/whitespace (e.g.
// "Nathan Liu" vs "Nathan-Liu") can't collide onto the same sanitized
// email — collisions would otherwise let one such account block another
// from ever migrating.
window.t29AuthEmail = function t29AuthEmail(username) {
  const raw = String(username).trim().toLowerCase();
  const safe = raw
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (safe === raw) return raw + "@t29.local";

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return (safe || "user") + "-" + hash.toString(36) + "@t29.local";
};
