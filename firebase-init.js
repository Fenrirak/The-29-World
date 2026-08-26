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

// firestore.rules now requires request.auth != null on every read/write.
// This app still does its own username/password check against Firestore
// documents (see login() in data.js) — anonymous sign-in doesn't replace
// that, it only satisfies the security-rules gate so a request has SOME
// auth token attached. getUser()/getClass() in data.js (the two functions
// every read/write path in this app goes through first) await this
// before their first Firestore call, so a slow sign-in never races a
// query out with a permission-denied error.
const T29_AUTH_READY = firebase.auth().signInAnonymously()
  .catch(err => console.error("T29: anonymous sign-in failed —", err));
