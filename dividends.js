/* Classroom cash dividends. The market page and the nightly job use the same settlement transaction. */
function dividendDate(key, days) {
  return new Date(Date.parse(key + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

function dividendRate(cents) {
  return "$" + (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function dividendCutoff(key) {
  const utc = Date.parse(key + "T00:00:00Z");
  const hour = Number(new Intl.DateTimeFormat("en-NZ", {timeZone:"Pacific/Auckland", hour:"2-digit", hourCycle:"h23"}).format(utc - 12 * 3600000));
  return utc - (hour === 1 ? 13 : 12) * 3600000;
}

function validDividendDate(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Date.parse(key)) && dividendDate(key, 0) === key;
}

function dividendTerms(rate, ex, pay, interval, today, company) {
  const cents = Math.round(Number(rate) * 100);
  if (!(cents > 0) || cents / 100 !== Number(rate) || !Number.isSafeInteger(cents * company.totalShares))
    throw new Error("Enter a positive amount per share in whole cents.");
  if (!validDividendDate(ex) || ex <= today) throw new Error("Choose an ex-dividend date after today (NZ time).");
  if (!validDividendDate(pay) || pay < ex) throw new Error("Payment must be on or after the ex-dividend date.");
  if (![0, 28, 91].includes(interval) || (interval && pay >= dividendDate(ex, interval)))
    throw new Error("Payment must fall before the next dividend period.");
  return { cents, ex, pay, interval, cutoff: dividendCutoff(ex) };
}

async function saveDividendPlan(code, id, terms, expectedEx) {
  const ref = classesCol().doc(code);
  await fdb.runTransaction(async t => {
    const cls = (await t.get(ref)).data();
    const co = cls?.companies.find(item => item.id === id);
    if (!co || cls.archived) throw new Error("This listing is no longer active.");
    const plans = cls.dividendPlans || {};
    const plan = plans[id];
    if ((plan?.ex || "") !== expectedEx) throw new Error("The dividend schedule changed. Reopen it to review the current dates.");
    if (terms) {
      if (plan) throw new Error("This company already has a declared dividend.");
      plans[id] = { ...dividendTerms(terms.rate, terms.ex, terms.pay, terms.interval, nzDateKey(), co), name: co.name };
    } else if (plan && nzDateKey() < plan.ex) {
      delete plans[id];
    } else if (plan) {
      plan.interval = 0; // The recorded payment is still owed.
    }
    t.update(ref, { dividendPlans: plans, dividendsActive: Object.keys(plans).length > 0 });
  });
}

async function settleDividend(db, classRef, userRef, id, today, now, reportUpdate) {
  return db.runTransaction(async t => {
    const classSnap = await t.get(classRef);
    const cls = classSnap.data();
    const plan = cls?.dividendPlans?.[id];
    const co = cls?.companies?.find(item => item.id === id);
    if (!plan || cls.archived || today < plan.ex) return;
    const registers = cls.dividendRegisters || {};
    if (!registers[id]) {
      if (!co) throw new Error("Missing dividend register for delisted company.");
      registers[id] = { ...co.holders };
    } else if (today < plan.pay) return;
    if (today < plan.pay) {
      t.update(classRef, { dividendRegisters: registers });
      return;
    }
    const holders = registers[id];
    const students = [...new Set(cls.students || [])].filter(u => typeof u === "string" && !u.includes("/") && Number.isSafeInteger(holders[u]) && holders[u] > 0);
    const refs = students.map(userRef);
    const snaps = await Promise.all(refs.map(ref => t.get(ref)));
    const entries = [];
    students.forEach((username, i) => {
      const user = snaps[i].data();
      if (!user || user.classCode !== classSnap.id || user.role !== "student") return;
      const shares = holders[username], cents = Math.round(shares * plan.cents);
      if (cents === 0) return; // A split can produce a sub-cent dividend.
      const balance = Math.round(user.balance * 100) + cents;
      if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isSafeInteger(balance)) throw new Error("Invalid dividend balance.");
      const entry = { id: "div-" + id + "-" + plan.ex + "-" + username, type: "stock-dividend", companyId: id,
        to: username, amount: cents / 100, shares, pricePerShare: plan.cents / 100, ts: now.getTime(),
        date: now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" }),
        note: (plan.name || co.name) + " dividend · " + shares + " × " + dividendRate(plan.cents) };
      entries.push(entry);
      t.update(refs[i], { balance: balance / 100, ...reportUpdate?.(user, username, entry, cls.txns || []) });
    });
    if (co) co.lastDividend = { pay: plan.pay, cents: plan.cents };
    delete registers[id];
    if (plan.interval) {
      // Announce the next future cutoff. Never infer ownership for missed periods.
      const periods = Math.floor((Date.parse(today) - Date.parse(plan.ex)) / (86400000 * plan.interval)) + 1;
      plan.ex = dividendDate(plan.ex, periods * plan.interval);
      plan.pay = dividendDate(plan.pay, periods * plan.interval);
      plan.cutoff = dividendCutoff(plan.ex);
      plan.cents = plan.nextCents ?? plan.cents;
      delete plan.nextCents;
    } else delete cls.dividendPlans[id];
    t.update(classRef, { companies: cls.companies, dividendPlans: cls.dividendPlans, dividendRegisters: registers,
      dividendsActive: Object.keys(cls.dividendPlans).length > 0, txns: entries.concat(cls.txns || []).slice(0, 250) });
  });
}

if (typeof module !== "undefined") module.exports = { settleDividend, dividendTerms };
