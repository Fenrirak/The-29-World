const {REAL_STOCKS, validRealQuote, applyRealQuote} = require("../real-stocks.js");
const {nasdaqQuote, nzQuote, etfQuote, anthropicOpeningQuote, anthropicIssuerClose} = require("./providers.cjs");

function marketDay(now, zone, closeHour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23"
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = [parts.year, parts.month, parts.day].join("-");
  if (Number(parts.hour) >= closeHour) return day;
  return new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
}

async function refresh(db, now = new Date()) {
  const day = marketDay(now, "Pacific/Auckland", 0);
  const prices = new Map();
  const errors = [];
  for (const s of REAL_STOCKS) {
    let prior;
    try {
      const ref = db.collection("marketQuotes").doc(s.symbol);
      prior = (await ref.get()).data();
      if (!prior && s.symbol === "ANT" && day >= anthropicOpeningQuote.date) {
        prior = anthropicOpeningQuote;
        await ref.set(prior);
      }
      let q;
      const local = s.exchange === "NZX";
      const cutoff = local ? marketDay(now, "Pacific/Auckland", 18) : marketDay(now, "America/New_York", 17);
      if (s.kind === "etf") {
        q = await etfQuote(s, cutoff);
      } else if (local) {
        q = await nzQuote(s, prior, cutoff);
      } else {
        try { q = await nasdaqQuote(s, cutoff); }
        catch (e) {
          if (s.symbol !== "ANT" || !prior) throw e;
          q = await anthropicIssuerClose(prior, cutoff);
        }
      }
      if (!validRealQuote(q) || q.sharesDate > day || (prior && (q.date < prior.date || q.sharesDate < prior.sharesDate))) {
        throw new Error("Incomplete or older market data");
      }
      if (!prior || Object.keys(q).some(k => q[k] !== prior[k])) await ref.set(q);
      prices.set(s.symbol, q);
    } catch (e) {
      if (validRealQuote(prior) && prior.symbol === s.symbol) prices.set(s.symbol, prior);
      errors.push(s.symbol + ": " + e.message);
    }
  }
  const classes = db.collection("classes").where("realStocksEnabled", "==", true).select();
  for await (const snapshot of classes.stream()) {
    try {
      await db.runTransaction(async t => {
        const cls = (await t.get(snapshot.ref)).data();
        if (!cls?.realStocksEnabled || cls.archived) return;
        let changed = false;
        for (const co of cls.companies || []) {
          const q = prices.get(co.realSymbol);
          if (q && applyRealQuote(co, q, day)) changed = true;
        }
        if (changed) t.update(snapshot.ref, {companies: cls.companies});
      });
    } catch (e) { errors.push("Class " + snapshot.id + ": " + e.message); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

if (require.main === module) {
  const {Firestore} = require("@google-cloud/firestore");
  refresh(new Firestore({projectId: process.env.GOOGLE_CLOUD_PROJECT})).catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
module.exports = {marketDay, refresh};
