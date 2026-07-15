/* ===================== The 29 World — Firebase init =====================
   Loaded AFTER the firebase-app-compat.js and firebase-firestore-compat.js
   CDN scripts, and BEFORE data.js, on every page.
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
