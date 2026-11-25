const { fetchIssuerEvents } = require("./issuer-feeds.cjs");
const { REAL_STOCKS } = require("../real-stocks.js");
const { dividendCutoff } = require("../dividends.js");

function combineEvents(rows) {
  const grouped = new Map();
  for (const e of rows) {
    const key = e.ex + "/" + e.pay;
    const prior = grouped.get(key);
    if (prior && prior.currency !== e.currency) throw new Error("Mixed currencies on a single payment date");
    grouped.set(key, {...e, key, cents:(prior?.cents || 0) + e.cents});
  }
  const events = [...grouped.values()];
  const counts = new Map();
  for (const e of events) counts.set(e.ex,(counts.get(e.ex) || 0) + 1);
  // A revised payable date for an ordinary dividend is the same entitlement.
  for (const e of events) if (counts.get(e.ex) === 1) e.key = e.ex;
  return events.sort((a,b)=>a.ex.localeCompare(b.ex) || a.pay.localeCompare(b.pay));
}

async function syncClass(db, ref, feeds, now) {
  await db.runTransaction(async tx => {
    const cls = (await tx.get(ref)).data();
    if (!cls || cls.archived) return;
    const book = cls.issuerBook || {}, plans = cls.dividendPlans || {}, registers = cls.dividendRegisters || {};
    const before = JSON.stringify([book,plans,registers]);
    const companies = cls.companies || [];
    for (const co of companies) {
      if (REAL_STOCKS.some(s=>s.symbol === co.realSymbol) && !book[co.id])
        book[co.id] = {symbol:co.realSymbol, since:now.getTime(), name:co.name};
    }
    for (const [id, item] of Object.entries(book)) {
      const co = companies.find(c=>c.id === id && c.realSymbol === item.symbol);
      if (!co && !item.ended) { delete book[id]; continue; }
      let plan = plans[id];
      if (plan && !plan.issuer) {
        if (now.getTime() >= plan.cutoff) { plan.interval = 0; continue; }
        delete plans[id]; plan = null;
      }
      const incoming = feeds.get(item.symbol);
      if (!incoming) continue; // A failed source cannot cancel a declaration.
      if (item.ended && now.getTime() - item.ended > 365 * 86400000 && !plan) {
        delete book[id]; continue;
      }
      const rows = combineEvents(incoming);
      const latest = rows.filter(e=>dividendCutoff(e.ex,e.zone) <= now.getTime()).at(-1);
      const upcoming = rows.find(e=>dividendCutoff(e.ex,e.zone) > now.getTime());
      item.checked = now.toLocaleDateString("sv-SE",{timeZone:"Pacific/Auckland"});
      item.latest = latest || item.latest || null;
      item.upcoming = upcoming || null;
      const candidates = rows.filter(e=>{
        const cutoff = dividendCutoff(e.ex,e.zone);
        return cutoff >= item.since && (!item.ended || cutoff <= item.ended) && !item.paid?.includes(e.key);
      });
      // A published correction replaces the terms before payment. Preserve an
      // already recorded entitlement if the exchange removes its calendar row.
      if (plan && now.getTime() < plan.cutoff && !candidates.some(e=>e.key === plan.key)) {
        delete plans[id]; plan = null;
      }
      const next = plan ? candidates.find(e=>e.key === plan.key) : candidates[0];
      if (next) {
        const cutoff = dividendCutoff(next.ex,next.zone);
        plans[id] = {...next, cutoff, name:item.name, issuer:true, interval:0};
        if (now.getTime() >= cutoff && !registers[id]) {
          const history = ref.collection("issuerPositions").doc(id).collection("trades");
          const trades = await tx.get(history.where("at",">=",new Date(cutoff)).orderBy("at").limit(1));
          registers[id] = trades.empty ? {...co?.holders} : trades.docs[0].data().holders;
        }
      }
    }
    if (before !== JSON.stringify([book,plans,registers]))
      tx.update(ref,{issuerBook:book, issuerTracked:Object.keys(book).length > 0, dividendPlans:plans,
        dividendRegisters:registers, dividendsActive:Object.keys(plans).length > 0});
  });
}

async function syncIssuers(db, now = new Date()) {
  const {events,errors} = await fetchIssuerEvents();
  const catalog = {};
  for (const [symbol, rows] of events) {
    catalog[symbol] = {checked:now.toLocaleDateString("sv-SE",{timeZone:"Pacific/Auckland"}),
      events:combineEvents(rows).slice(-5)};
  }
  if (Object.keys(catalog).length) await db.collection("marketQuotes").doc("issuerDividends").set(catalog,{merge:true});
  const seen = new Set();
  for (const field of ["realStocksEnabled","issuerTracked"]) {
    for await (const snap of db.collection("classes").where(field,"==",true).select().stream()) {
      if (seen.has(snap.id)) continue;
      seen.add(snap.id);
      try { await syncClass(db,snap.ref,events,now); }
      catch (err) { errors.push(snap.id + ": " + err.message); }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}
if (require.main === module) {
  const {Firestore} = require("@google-cloud/firestore");
  syncIssuers(new Firestore({projectId:process.env.GOOGLE_CLOUD_PROJECT})).catch(err=>{
    console.error(err.message); process.exitCode=1;
  });
}
module.exports = { syncClass, combineEvents };
