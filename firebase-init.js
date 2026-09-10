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
  const unsub = firebase.auth().onAuthStateChanged(() => {
    unsub();
    resolve();
  });
});

// Every account is stored in Firebase Auth under a synthetic email built
// from its app-level username, since this app never collects real email
// addresses. Centralised here so login/signup/migration all construct it
// identically.
function t29AuthEmail(username) {
  return String(username).trim().toLowerCase() + "@t29.local";
}
