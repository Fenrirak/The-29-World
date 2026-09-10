/* ===================== The 29 World — Firebase init =====================
   Loaded AFTER the firebase-app-compat.js, firebase-firestore-compat.js,
   AND firebase-auth-compat.js CDN scripts, and BEFORE data.js, on every
   page.
========================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyAVr1PKkvy9fZ7P3hiQ-QImEe7sjfAhqFw",
  authDomain: "world-e0c82.firebaseapp.com",
  projectId: "world-e0c82",
  storageBucket: "world-e0c82.firebasestorage.app",
  messagingSenderId: "1015987500279",
  appId: "1:1015987500279:web:7aa31bd26deffa7c344ff2",
  measurementId: "G-CZNQMEK1P7"
};

firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();

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
const T29_AUTH_READY = new Promise(resolve => {
  const unsub = firebase.auth().onAuthStateChanged(async (user) => {
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
      await firebase.auth().signOut().catch(() => {});
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
function t29AuthEmail(username) {
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
}
