// One-off: moves every legacy plaintext password into Firebase Auth (hashed) and deletes the field.
// Setup:  npm i firebase-admin   |  download a service-account key (Firebase console > Project settings > Service accounts)
// Dry run (default):  GOOGLE_APPLICATION_CREDENTIALS=key.json node migrate-legacy-passwords.js
// Real run:           GOOGLE_APPLICATION_CREDENTIALS=key.json node migrate-legacy-passwords.js --apply
// Delete the key file afterwards. Take a Firestore export/backup first.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "world-e0c82" });
const db = admin.firestore(), APPLY = process.argv.includes("--apply");

function t29AuthEmail(username) { // copied from firebase-init.js
  const raw = String(username).trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (safe === raw) return raw + "@t29.local";
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return (safe || "user") + "-" + hash.toString(36) + "@t29.local";
}

(async () => {
  const snap = await db.collection("users").get();
  const r = { migrated: 0, cleaned: 0, tooShort: [], failed: [] };
  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.password !== "string") continue;
    const username = doc.id;
    try {
      if (d.authUid) { // already has an Auth account: just drop the stale plaintext
        if (APPLY) await doc.ref.update({ password: admin.firestore.FieldValue.delete() });
        r.cleaned++; continue;
      }
      if (d.password.length < 6) { r.tooShort.push(username); continue; } // Firebase minimum; needs a teacher reset
      if (APPLY) {
        const email = t29AuthEmail(username);
        let uid;
        try { uid = (await admin.auth().createUser({ email, password: d.password })).uid; }
        catch (e) { if (e.code !== "auth/email-already-exists") throw e; uid = (await admin.auth().getUserByEmail(email)).uid; }
        await db.collection("uidIndex").doc(uid).set({ username });
        await doc.ref.update({ authUid: uid, password: admin.firestore.FieldValue.delete() });
      }
      r.migrated++;
    } catch (e) { r.failed.push(username + ": " + e.message); }
  }
  console.log(APPLY ? "APPLIED" : "DRY RUN", JSON.stringify(r, null, 2));
  console.log("Too-short passwords keep their plaintext until reset: either have a teacher reset them, or delete the field manually.");
})();
