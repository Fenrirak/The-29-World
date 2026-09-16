/* ===================== The 29 World — Firebase init =====================
   Loaded as an ES module (type="module" in the HTML), BEFORE icons.js,
   settings-menu.js, data.js, and everything else, on every page.

   MIGRATION NOTE (compat -> modular SDK): this file used to load Firebase
   via the three "compat" CDN bundles (firebase-app-compat.js etc.), which
   expose the old namespaced `firebase.foo()` API and are built ON TOP of
   the modular SDK — meaning a page paid for both the modular engine AND
   the compat wrapper around it. This file now imports the modular SDK
   directly (smaller download, less to parse on a phone), and builds a
   small compat-SHAPED shim below so that data.js and every other file in
   this app — which were all written against the old `fdb.collection(x)
   .doc(y).get()` / `firebase.auth()` style — keep working completely
   unchanged. Nothing outside this file needed to change for this switch.

   The shim only covers the exact surface this app actually calls (traced
   through every *.js file): collection/doc get/set/update/delete, one
   `.where()` query, runTransaction, batch, FieldValue.serverTimestamp/
   increment/delete, and the handful of Auth methods used by login/signup/
   the legacy-migration bridge/change-password. If a future page starts
   using some other Firestore/Auth method, it needs a matching addition
   here — it will otherwise fail with "X is not a function", which is an
   easy, loud failure to spot (not a silent behavior change).
========================================================================= */
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, collection, query, where,
  getDoc, getDocFromServer, getDocs,
  setDoc, updateDoc, deleteDoc, runTransaction, writeBatch,
  serverTimestamp, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, deleteUser
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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
       matching every call site in data.js.
   Doc refs returned by this shim carry the REAL modular DocumentReference
   internally (as `_ref`) so runTransaction()/batch() below can unwrap it
   and hand the genuine modular ref to the real transaction/batch — those
   only work with real refs, not shim objects. */

function _wrapSnap(snap) {
  const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
  return { exists, data: () => (exists ? snap.data() : undefined) };
}

function _wrapDocRef(realRef) {
  return {
    _ref: realRef,
    async get(opts) {
      const snap = (opts && opts.source === "server")
        ? await getDocFromServer(realRef)
        : await getDoc(realRef);
      return _wrapSnap(snap);
    },
    set(data, options) {
      return options ? setDoc(realRef, data, options) : setDoc(realRef, data);
    },
    update(data) { return updateDoc(realRef, data); },
    delete() { return deleteDoc(realRef); }
  };
}

function _wrapCollectionRef(name) {
  const realCol = collection(_db, name);
  return {
    doc(id) { return _wrapDocRef(doc(realCol, id)); },
    // Only ever used as classesCol().where("teacher","==",username).get()
    // (see getTeacherClasses in data.js) — a single equality filter, so
    // this only needs to support one where() clause, not general chaining.
    where(field, op, value) {
      const q = query(realCol, where(field, op, value));
      return {
        // Only ever consumed via .forEach() (see getTeacherClasses in
        // data.js) — .docs/.empty/.size aren't used anywhere, so this
        // doesn't bother exposing them.
        async get() {
          const snap = await getDocs(q);
          const wrapped = snap.docs.map(_wrapSnap);
          return { forEach(cb) { wrapped.forEach(cb); } };
        }
      };
    }
  };
}

const fdb = {
  collection(name) { return _wrapCollectionRef(name); },
  async runTransaction(updateFn) {
    return runTransaction(_db, async (transaction) => {
      const t = {
        async get(docRefShim) {
          const snap = await transaction.get(docRefShim._ref);
          return _wrapSnap(snap);
        },
        // Every t.set() call site in data.js passes only (ref, data), so
        // this doesn't bother threading through a third options argument.
        set(docRefShim, data) { return transaction.set(docRefShim._ref, data); },
        update(docRefShim, data) { return transaction.update(docRefShim._ref, data); },
        delete(docRefShim) { return transaction.delete(docRefShim._ref); }
      };
      return updateFn(t);
    });
  },
  // Only ever used for the merge-set chunked batches in setStudentTimeLimit
  // (see data.js) — batch.update()/.delete() aren't called anywhere in
  // this app, so this doesn't bother implementing them.
  batch() {
    const b = writeBatch(_db);
    const shimBatch = {
      set(docRefShim, data, options) {
        options ? b.set(docRefShim._ref, data, options) : b.set(docRefShim._ref, data);
        return shimBatch;
      },
      commit() { return b.commit(); }
    };
    return shimBatch;
  }
};

/* ---------------- Compat-shaped Auth shim ----------------
   Wraps the handful of Auth methods data.js actually calls (login/signup/
   legacy-migration bridge/change-password). A wrapped "user" object below
   adds back the instance methods compat users had (.delete()/
   .reauthenticateWithCredential()/.updatePassword()) as thin calls to the
   modular top-level functions of the same name — modular moved these off
   the User object itself, onto standalone functions. */

function _wrapUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
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
firestoreFn.FieldValue = { serverTimestamp, increment, delete: deleteField };

// Every other file in this app (data.js and beyond) is a plain classic
// <script>, not a module, so it can only see these via window — a
// module's own top-level consts are NOT automatically global the way a
// classic script's are.
window.fdb = fdb;
window.firebase = { auth: authFn, firestore: firestoreFn };

// ---------------- Auth ----------------
// SECURITY FIX: this app used to sign every visitor in anonymously and
// rely only on Firestore rules checking "is SOME auth token present" —
// which made every document readable/writable by any visitor, logged in
// or not. Real per-account identity now comes from Firebase Auth's
// email/password provider (see t29AuthEmail()/login()/createTeacherAndClass()/
// createStudentAccount() in data.js), and firestore.rules checks the
// SPECIFIC signed-in user against the document's owner, not just "is
// someone signed in".
//
// There is deliberately no more unconditional signInAnonymously() call
// here. T29_AUTH_READY now just waits for Firebase to restore whatever
// session already exists (a real logged-in user, or nobody) before the
// rest of the app makes its first Firestore call — it does NOT create a
// new session itself. A page that needs someone to actually be logged in
// still goes through requireLogin() in data.js, same as before.
window.T29_AUTH_READY = new Promise(resolve => {
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
    // t29TryMigrateLegacyLogin() in data.js) and leaves them with a real,
    // fully-working per-account identity instead of a half-working one.
    // This never interferes with that migration's own brief, self-managed
    // signInAnonymously() call — that one signs itself back out again
    // before this promise is even created on the next page load.
    if (user && user.isAnonymous) {
      await authShim.signOut().catch(() => {});
    }
    resolve();
  });
});

// Every account is stored in Firebase Auth under a synthetic email built
// from its app-level username, since this app never collects real email
// addresses. Centralised here so login/signup/migration all construct it
// identically.
//
// BUGFIX: usernames only ever went through Firebase's own email-format
// check starting with the password-encryption security fix — the
// post-fix signup flow (createTeacherAndClass()/createStudentAccount() in
// data.js) calls createUserWithEmailAndPassword() immediately, which
// rejects an invalid email like "nathan liu@t29.local" (a space isn't
// legal in an email address) right at signup. Before that fix, signup
// just wrote a plain Firestore doc with no such check, so a legacy
// account could end up with any string as its "username" — including one
// with spaces or other characters that don't survive into a valid email.
// On login, that invalid email made Firebase's identitytoolkit API
// reject the request outright (e.g. "auth/invalid-email"), which isn't
// one of the codes login() in data.js treats as "try the legacy
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
