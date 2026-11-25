const { settleDividend } = require("../dividends.js");
const { reportAccountingView } = require("../data-money.js");

async function processDividends(db, now = new Date()) {
  const today = now.toLocaleDateString("sv-SE", {timeZone: "Pacific/Auckland"});
  const active = db.collection("classes").where("dividendsActive", "==", true).select("dividendPlans", "archived");
  const failures = [];
  for await (const snapshot of active.stream()) {
    const cls = snapshot.data();
    if (cls.archived) continue;
    for (const [id, plan] of Object.entries(cls.dividendPlans || {})) {
      if (today < plan.ex) continue;
      try {
        await settleDividend(db, snapshot.ref, u => db.collection("users").doc(u), id, today, now,
          (user, username, entry, ledger) => ({reportAccounting:
            reportAccountingView({...user, username}, [entry, ...ledger], today.slice(0, 7), 250)}));
      } catch (err) { failures.push(snapshot.id + "/" + id + ": " + err.message); }
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

if (require.main === module) {
  const {Firestore} = require("@google-cloud/firestore");
  processDividends(new Firestore({projectId: process.env.GOOGLE_CLOUD_PROJECT})).catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
module.exports = {processDividends};
