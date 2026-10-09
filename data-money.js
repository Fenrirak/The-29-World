/* ===================== The 29 World — data layer: money =====================
   Wages and allowances, savings, loans, automatic payments, term deposits,
   interest, net worth / leaderboard, reports, tax, the budgeting tool,
   savings goals and the parent view.
   Part of the data layer — see the top of data-core.js for how the five
   data-*.js files fit together.
====================================================================== */

// ===================== Wages & life-item allowances — two entry points =====================
// Same fix, same reasoning as interest (see the big comment above
// applyMyInterestIfDue/applyInterestToClassIfDue in this file): wages and
// life-item allowances are also brand-new money with no matching debit
// anywhere, so a student's session can only ever safely credit THEIR OWN
// account, never a classmate's. The old design tracked "who's been paid"
// in ONE shared object per job (payDayProgress/lifeDailyProgress) on the
// class doc — locked to teacher writes for exactly the "free money
// replay" reason explained on lockedFields in firestore.rules — so a
// student's page load calling autoPayDayIfDue/processDailyLifeAllowance
// always failed silently (caught, logged, page kept loading) and only a
// teacher's visit ever actually paid anyone.
//
// Fix: track "was I paid" PER STUDENT, on their own /users doc
// (lastWagePaid / lastLifeAllowanceWeeklyPaid / lastLifeAllowanceDailyPaid
// — plain self-writable date-key stamps, same idea as interest's
// lastInterestApplied). Every path that pays money funnels through the
// small _pay...() helpers below, each of which credits + stamps in ONE
// transaction on that one student's own doc — Firestore serializes
// concurrent transactions on the same document, so whichever path gets
// to a given student first "wins" and every other path's fresh re-check
// sees the stamp and backs off. This holds regardless of how many
// tabs/devices/paths hit the same student at once, exactly like interest.
//
//   1. payMyWageIfDue(username) / payMyDailyLifeAllowanceIfDue(username)
//      — called from student.js and from bank.js when the CURRENT
//      visitor is a student. Pays ONLY that one student's own wage/
//      allowance, if their own schedule says it's due. A student in a
//      class with no teacher currently online still gets paid exactly
//      on schedule, on their own next visit.
//
//   2. payDayForClassIfDue(classCode) / dailyLifeAllowanceForClassIfDue
//      (classCode) — called from teacher.js and from bank.js when the
//      CURRENT visitor is a teacher (the direct replacements for the old
//      class-wide autoPayDayIfDue/processDailyLifeAllowance). A
//      teacher's session CAN write every student's doc, so these keep
//      doing what the old auto-runs did — walk the whole roster and pay
//      everyone who's due — but the "who's due" and "don't double-pay"
//      checks are now per student, so anyone already paid via their own
//      visit is correctly skipped, and only the ones who haven't opened
//      anything yet get topped up. A teacher's visit is still a full
//      safety-net sweep of the class; it just no longer re-pays people
//      who don't need it.
//
// payDay(classCode) — the manual "Run Pay Day" button — shares the exact
// same per-student stamp, just with the schedule/day check bypassed
// (force): it can never double-pay someone the automatic path (or that
// student's own visit) already paid today, for the same reason the
// manual "Apply Interest" button can't.

// Pure: what would this student's wage payment be right now, if they're
// eligible? Returns null if they have no job, an unrecognized job, or
// haven't had this week's job task ticked as approved yet.
function computeWageCredit(cls, student) {
  if (!student.jobId) return null;
  const job = (cls.jobs || []).find(j => j.id === student.jobId);
  if (!job) return null;
  if (!isJobTaskApprovedThisWeek(student, cls)) return null;
  return wageCreditEstimate(cls, student);
}
// What this student's wage comes to after tax and life-event benefits,
// whether or not this week's job task has been approved yet — the budget
// uses it to show what pay day will bring. Assumes they have a job.
function wageCreditEstimate(cls, student) {
  const job = (cls.jobs || []).find(j => j.id === student.jobId) || {};
  const tier = getStudentTier(job, student);
  const wage = tier ? tier.wage : 0;
  let { net, taxAmount } = applyWageTax(cls, wage);
  // Life items can boost/cut take-home wage (incomePercent) and knock a
  // percentage off the tax bill just withheld (taxCutPercent) — applied
  // here, after the normal bracket tax, so they layer on top instead of
  // interacting with the bracket math itself.
  const life = getLifeBenefitTotals(student);
  if (life.incomePercent) net = Math.round(net * (1 + life.incomePercent / 100) * 100) / 100;
  if (life.taxCutPercent && taxAmount > 0) {
    const refund = Math.round(taxAmount * (life.taxCutPercent / 100) * 100) / 100;
    net = Math.round((net + refund) * 100) / 100;
    taxAmount = Math.round((taxAmount - refund) * 100) / 100;
  }
  const tierLabel = tier ? tier.name : job.title;
  return { net, taxAmount, tierLabel };
}

// PERF FIX: quick checks on the student doc the caller ALREADY read, used
// to skip opening a transaction that could only end in "nothing to do".
// Each transaction costs two round trips to the database (read, then
// commit) and the class-wide sweeps below run them one student at a
// time — so a class of 25 where nobody has, say, a daily allowance spent
// ~50 round trips (several seconds) on EVERY teacher page load doing
// nothing at all, because "nothing to pay" is deliberately left
// unstamped and so was re-checked forever.
//
// These mirror the "return without writing" checks inside the matching
// transactions exactly, so a skipped student gets the same outcome as
// before. The transactions themselves still re-check everything against
// fresh data before paying anyone, so these can never cause a double
// payment; at worst a change made in the last split second (say, a job
// assigned while this page was loading) is picked up on the next page
// load instead of this one — exactly how the "already paid today" skips
// next to them already behave.
function _hasRecognisedJob(cls, student) {
  return !!(student.jobId && (cls.jobs || []).some(j => j.id === student.jobId));
}
function _wageMightBePayable(cls, student) {
  return _hasRecognisedJob(cls, student) && isJobTaskApprovedThisWeek(student, cls);
}
function _interestMightBePayable(cls, student) {
  const credit = computeInterestCredit(cls, student);
  return credit.savingsNet > 0 || credit.cashNet > 0;
}

// Credits ONE student's wage in a single transaction on their own doc.
// Returns { credited: {net, taxAmount, tierLabel} } if paid,
// { skippedUnapproved: true } if they have a job but this week's task
// isn't ticked yet, or null (nothing to do / already paid today / no
// job / error). `force` skips the day-of-week check (manual button); it
// never skips the "already paid today" check.
async function _payStudentWage(classCode, username, dateKey, { force = false, cls: precomputedCls } = {}) {
  const userRef = usersCol().doc(username);
  let result = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      if (user.role !== "student") return;
      if (user.lastWagePaid === dateKey) return; // ALREADY paid today — the actual double-pay guard
      const cls = precomputedCls || await getClass(classCode);
      if (!cls || cls.archived) return;
      if (!force && nzDayName() !== cls.payDay) return;
      if (!user.jobId) return; // no job at all — leave unstamped, nothing to skip-guard against
      const job = (cls.jobs || []).find(j => j.id === user.jobId);
      if (!job) return;
      if (!isJobTaskApprovedThisWeek(user, cls)) {
        // Has a job, just isn't ticked yet — leave unstamped (same as the
        // old design) so ticking it later THIS SAME cycle still catches
        // them on the next run, rather than being locked out for the week.
        result = { skippedUnapproved: true };
        return;
      }
      const credit = computeWageCredit(cls, user);
      if (!credit) return;
      const newBalance = Math.round(((user.balance || 0) + credit.net) * 100) / 100;
      t.update(userRef, { balance: newBalance, lastWagePaid: dateKey });
      result = { credited: credit };
    });
  } catch (e) {
    return null;
  }
  if (result && result.credited) {
    await logTxn(classCode, { type: "wage", to: username, amount: result.credited.net, note: "Pay day: " + result.credited.tierLabel + (result.credited.taxAmount > 0 ? ` (${fmtMoney(result.credited.taxAmount)} tax withheld)` : "") });
  }
  return result;
}

// Credits ONE student's WEEKLY life-item allowance (paid alongside wages,
// on the class's pay day) in a single transaction on their own doc.
async function _payStudentWeeklyLifeAllowance(classCode, username, dateKey, { cls: precomputedCls } = {}) {
  const userRef = usersCol().doc(username);
  let credited = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      if (user.role !== "student") return;
      if (user.lastLifeAllowanceWeeklyPaid === dateKey) return;
      const amount = getLifeAllowanceByFrequency(user, "weekly");
      if (!amount) return; // nothing to pay — leave unstamped so a same-day life-item change can still be caught
      const newBalance = Math.round(((user.balance || 0) + amount) * 100) / 100;
      t.update(userRef, { balance: newBalance, lastLifeAllowanceWeeklyPaid: dateKey });
      credited = amount;
    });
  } catch (e) {
    return null;
  }
  if (credited) {
    await logTxn(classCode, { type: "life-allowance", to: username, amount: credited, note: "Life event allowance (weekly)" });
  }
  return credited;
}

// Credits ONE student's DAILY life-item allowance (its own schedule,
// every calendar day, independent of pay day) in a single transaction.
async function _payStudentDailyLifeAllowance(classCode, username, dateKey) {
  const userRef = usersCol().doc(username);
  let credited = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      if (user.role !== "student") return;
      if (user.lastLifeAllowanceDailyPaid === dateKey) return;
      const amount = getLifeAllowanceByFrequency(user, "daily");
      if (!amount) return;
      const newBalance = Math.round(((user.balance || 0) + amount) * 100) / 100;
      t.update(userRef, { balance: newBalance, lastLifeAllowanceDailyPaid: dateKey });
      credited = amount;
    });
  } catch (e) {
    return null;
  }
  if (credited) {
    await logTxn(classCode, { type: "life-allowance", to: username, amount: credited, note: "Life event allowance (daily)" });
  }
  return credited;
}

// Self-apply entry point — student.js, and bank.js for a student. Pays
// wages + weekly life allowance into ONLY the current student's own
// account, if their own schedule says it's due today.
async function payMyWageIfDue(username) {
  const todayKey = nzDateKey();
  const user = await getUser(username);
  if (!user || user.role !== "student") return 0;
  const cls = await getClass(user.classCode);
  if (!cls || !cls.payDay || cls.archived) return 0;
  if (nzDayName() !== cls.payDay) return 0;
  let count = 0;
  if (user.lastWagePaid !== todayKey && _wageMightBePayable(cls, user)) {
    const r = await _payStudentWage(user.classCode, username, todayKey, { cls });
    if (r && r.credited) count++;
  }
  if (user.lastLifeAllowanceWeeklyPaid !== todayKey && getLifeAllowanceByFrequency(user, "weekly")) {
    const credited = await _payStudentWeeklyLifeAllowance(user.classCode, username, todayKey, { cls });
    if (credited) count++;
  }
  return count;
}

// Self-apply entry point for the DAILY life-item allowance — runs every
// calendar day regardless of the class's pay day.
async function payMyDailyLifeAllowanceIfDue(username) {
  const todayKey = nzDateKey();
  const user = await getUser(username);
  if (!user || user.role !== "student") return 0;
  if (user.lastLifeAllowanceDailyPaid === todayKey) return 0;
  if (!getLifeAllowanceByFrequency(user, "daily")) return 0; // no daily allowance — see _wageMightBePayable
  const credited = await _payStudentDailyLifeAllowance(user.classCode, username, todayKey);
  return credited ? 1 : 0;
}

// Teacher-triggered entry point (auto, on page load) — replaces the old
// class-wide autoPayDayIfDue. Sweeps every student, paying whoever's due
// and hasn't already been paid today (by their own visit or an earlier
// pass of this same sweep).
async function payDayForClassIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.payDay || cls.archived) return 0;
  if (nzDayName() !== cls.payDay) return 0;
  const result = await _runPayDayForClass(classCode, nzDateKey(), { force: false, cls });
  return result.newlyPaid;
}

// Manual "Run Pay Day" button (teacher.js) — always actually checks
// every student, even if today's auto-run (or students' own visits)
// already covered some of them. It will still never pay the same
// student twice for the same day; it only pays students who have a job
// but haven't been paid yet today (e.g. ones missed by an earlier
// partial/failed run, or ones assigned a job/approved after auto-run).
async function payDay(classCode) {
  return await _runPayDayForClass(classCode, nzDateKey(), { force: true });
}

async function _runPayDayForClass(classCode, dateKey, { force = false, cls: precomputedCls } = {}) {
  const cls = precomputedCls || await getClass(classCode);
  if (!cls) return { paidCount: 0, newlyPaid: 0, hasJobs: false, unapprovedCount: 0 };
  const students = await getClassStudents(classCode, cls);
  let hasJobs = false;
  let paidCount = 0;
  let newlyPaid = 0;
  let unapprovedCount = 0;
  for (const student of students) {
    if (student.jobId && (cls.jobs || []).find(j => j.id === student.jobId)) hasJobs = true;
    if (student.lastWagePaid === dateKey) { paidCount++; continue; } // already covered — cheap in-memory skip before opening a transaction
    if (!_wageMightBePayable(cls, student)) {
      // Same answer _payStudentWage's transaction would give, without the
      // two round trips: no job means nothing to pay, and a job whose task
      // isn't ticked yet is reported as unapproved.
      if (_hasRecognisedJob(cls, student) && !cls.archived) unapprovedCount++;
      continue;
    }
    const r = await _payStudentWage(classCode, student.username, dateKey, { force, cls });
    if (r && r.credited) { newlyPaid++; paidCount++; }
    else if (r && r.skippedUnapproved) { unapprovedCount++; }
  }
  // Life-item recurring allowances: independent of having a job, so this
  // runs for every student, not just the ones the loop above touched.
  for (const student of students) {
    if (student.lastLifeAllowanceWeeklyPaid === dateKey) continue;
    if (!getLifeAllowanceByFrequency(student, "weekly")) continue; // no weekly allowance — nothing to pay
    await _payStudentWeeklyLifeAllowance(classCode, student.username, dateKey, { cls });
  }
  return { paidCount, newlyPaid, hasJobs, unapprovedCount };
}

// Teacher-triggered entry point (auto, on page load) for the DAILY
// life-item allowance — replaces the old class-wide
// processDailyLifeAllowance. Runs every calendar day, completely
// independent of the class's weekly Pay Day.
async function dailyLifeAllowanceForClassIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || cls.archived) return 0;
  const todayKey = nzDateKey();
  const students = await getClassStudents(classCode, cls);
  let newlyPaid = 0;
  for (const student of students) {
    if (student.lastLifeAllowanceDailyPaid === todayKey) continue; // cheap in-memory skip
    if (!getLifeAllowanceByFrequency(student, "daily")) continue; // no daily allowance — nothing to pay
    const credited = await _payStudentDailyLifeAllowance(classCode, student.username, todayKey);
    if (credited) newlyPaid++;
  }
  return newlyPaid;
}

// Plain-English description of when interest is next applied, for
// whichever page shows a student's interest rate/amount. Used in bank.js.
const INTEREST_FREQ_LABEL = { daily: "every day", weekly: "every week", fortnightly: "every 2 weeks", monthly: "every 4 weeks" };
const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
function interestScheduleLabel(cls) {
  if (!cls || !cls.interestAuto) {
    return "Your teacher applies interest manually — there's no fixed schedule.";
  }
  const freq = cls.interestFrequency || "weekly";
  if (freq === "daily") return "Interest is paid automatically every day.";
  const dayName = DAY_FULL[cls.interestDay || "Fri"] || cls.interestDay;
  return `Interest is paid automatically ${INTEREST_FREQ_LABEL[freq] || "every week"}, on ${dayName}.`;
}

// Pure calculation shared by every path that pays interest (self-apply,
// the teacher-triggered auto batch, and the teacher's manual "Apply
// Interest" button) — see the three callers below. Keeping the math in
// ONE place means all three can never quietly disagree on how much
// interest a given balance/savings figure is worth.
function computeInterestCredit(cls, student) {
  const savingsRate = (cls.interestRate || 0) / 100;
  const cashRate = (cls.cashInterestRate || 0) / 100;
  const savingsInterestGross = Math.round((student.savings || 0) * savingsRate * 100) / 100;
  const cashInterestGross = Math.round((student.balance || 0) * cashRate * 100) / 100;
  const savingsTax = savingsInterestGross > 0 ? applyTaxToIncome(cls, "interest", savingsInterestGross) : { net: 0, taxAmount: 0 };
  const cashTax = cashInterestGross > 0 ? applyTaxToIncome(cls, "interest", cashInterestGross) : { net: 0, taxAmount: 0 };
  return {
    savingsNet: savingsTax.net, savingsTaxAmount: savingsTax.taxAmount,
    cashNet: cashTax.net, cashTaxAmount: cashTax.taxAmount,
    newSavings: Math.round(((student.savings || 0) + savingsTax.net) * 100) / 100,
    newBalance: Math.round(((student.balance || 0) + cashTax.net) * 100) / 100
  };
}

// Credits ONE student's interest, in a single transaction on THEIR OWN
// /users doc (balance + savings + the lastInterestApplied stamp all move
// together), then logs it. Returns the credited amounts, or null if
// someone else's transaction already stamped `dateKey` on this student
// first (the actual thing that prevents a double payment — see the
// callers below for why this can race in more than one way). `force`
// skips the schedule/day check (used by the teacher's manual button);
// it never skips the "already paid today" check — that one is not
// optional, or a teacher clicking the button twice would double-pay.
async function _creditStudentInterest(classCode, username, dateKey, { force = false, cls: precomputedCls } = {}) {
  const userRef = usersCol().doc(username);
  let credited = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      if (user.role !== "student") return; // interest is a student-only concept
      if (user.lastInterestApplied === dateKey) return; // ALREADY paid today — this is the actual double-pay guard
      const cls = precomputedCls || await getClass(classCode);
      if (!cls) return;
      if (!force && !isInterestDueForUser(cls, user, dateKey)) return;
      const credit = computeInterestCredit(cls, user);
      if (credit.savingsNet <= 0 && credit.cashNet <= 0) return; // nothing to pay — leave unstamped so a same-day rate change can still catch them
      t.update(userRef, { savings: credit.newSavings, balance: credit.newBalance, lastInterestApplied: dateKey });
      credited = credit;
    });
  } catch (e) {
    return null;
  }
  if (!credited) return null;
  if (credited.savingsNet > 0) {
    await logTxn(classCode, { type: "interest", to: username, amount: credited.savingsNet, note: "Savings account interest" + (credited.savingsTaxAmount > 0 ? ` (${fmtMoney(credited.savingsTaxAmount)} tax withheld)` : "") });
  }
  if (credited.cashNet > 0) {
    await logTxn(classCode, { type: "cash-interest", to: username, amount: credited.cashNet, note: "Cash balance interest" + (credited.cashTaxAmount > 0 ? ` (${fmtMoney(credited.cashTaxAmount)} tax withheld)` : "") });
  }
  return credited;
}

// Manual "Apply Interest" button (teacher.js) — pays every student who
// hasn't already been paid TODAY, regardless of the interestAuto
// schedule (it's a deliberate override, same spirit as payDay()'s manual
// "force" button). It can never double-pay someone the automatic
// schedule (or that student's own visit) already paid today — see
// _creditStudentInterest's lastInterestApplied check above, which this
// shares with every other path that pays interest.
async function applyInterest(classCode) {
  const cls = await getClass(classCode);
  if (!cls) return 0;
  const todayKey = nzDateKey();
  const students = await getClassStudents(classCode, cls);
  let count = 0;
  for (const student of students) {
    const credited = await _creditStudentInterest(classCode, student.username, todayKey, { force: true, cls });
    if (credited) count++;
  }
  return count;
}

async function adjustSavings(username, delta) {
  const userRef = usersCol().doc(username);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    const newSavings = Math.round(((user.savings || 0) + delta) * 100) / 100;
    t.update(userRef, { savings: newSavings });
  });
}

// Moves money from cash balance into the interest-earning Savings Account.
async function depositToSavings(username, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      if (user.balance < amount) throw new Error("BROKE");
      t.update(userRef, {
        balance: Math.round((user.balance - amount) * 100) / 100,
        savings: Math.round(((user.savings || 0) + amount) * 100) / 100
      });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "savings-deposit", from: username, amount, note: "Deposited into Savings Account" });
  return { ok: true };
}

// Moves money back out of the Savings Account into cash balance.
async function withdrawFromSavings(username, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      if ((user.savings || 0) < amount) throw new Error("BROKE");
      t.update(userRef, {
        balance: Math.round((user.balance + amount) * 100) / 100,
        savings: Math.round(((user.savings || 0) - amount) * 100) / 100
      });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have that much in savings." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "savings-withdraw", to: username, amount, note: "Withdrew from Savings Account" });
  return { ok: true };
}

/* ===================== Loans ===================== */
async function addLoanTier(classCode, tier) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.loanTiers.push({
      id: uid("loantier"),
      min: Math.max(0, Number(tier.min) || 0),
      max: Math.max(0, Number(tier.max) || 0),
      termWeeks: Math.max(1, Number(tier.termWeeks) || 1),
      rate: Math.max(0, Number(tier.rate) || 0),
      active: true
    });
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function updateLoanTier(classCode, tierId, tier) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.loanTiers.find(x => x.id === tierId);
    if (!existing) return;
    existing.min = Math.max(0, Number(tier.min) || 0);
    existing.max = Math.max(0, Number(tier.max) || 0);
    existing.termWeeks = Math.max(1, Number(tier.termWeeks) || 1);
    existing.rate = Math.max(0, Number(tier.rate) || 0);
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function removeLoanTier(classCode, tierId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.loanTiers = cls.loanTiers.filter(x => x.id !== tierId);
    t.update(classRef, { loanTiers: cls.loanTiers });
  });
}
async function setMaxLoanAmount(classCode, amount) {
  await classesCol().doc(classCode).update({ maxLoanAmount: Math.max(0, Number(amount) || 0) });
}
async function setMaxLoanCount(classCode, count) {
  await classesCol().doc(classCode).update({ maxLoanCount: Math.max(0, Math.floor(Number(count)) || 0) });
}
// Lets a teacher dock lifestyle points for outstanding loan debt: for every
// `perAmount` a student currently owes (active loans only), they lose
// `points` off their computed lifestyle score. Feeds into lifestyleRating().
async function setLoanLifestylePenalty(classCode, { enabled, perAmount, points }) {
  const clean = {
    enabled: !!enabled,
    perAmount: Math.max(0, Number(perAmount) || 0),
    points: Math.max(0, Number(points) || 0)
  };
  await classesCol().doc(classCode).update({ "lifestyleConfig.loan": clean });
  return clean;
}

// Which tier a requested amount falls into — the teacher's price ranges
// should be set up so they don't gap or overlap, but if ranges do overlap
// the first (lowest-set-up) match wins.
function findLoanTier(cls, amount) {
  return (cls.loanTiers || []).find(t => t.active && amount >= t.min && amount <= t.max) || null;
}

async function takeLoan(username, classCode, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let tierSnapshot = null, owed = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      const existingLoans = user.loans || [];
      const activeLoans = existingLoans.filter(l => l.status === "active");
      const tier = findLoanTier(cls, amount);
      if (!tier) throw new Error("NO_TIER");
      // "Overall maximum loan amount" is a TOTAL cap across every active
      // loan a student is carrying at once, not just a per-loan cap — a
      // student with two loans already open could otherwise stack them
      // past this limit even though neither individual loan exceeds it
      // on its own. Compare against principal (what they actually
      // borrowed), not owed (which includes interest), so the cap tracks
      // how much a student has chosen to take out rather than fluctuating
      // with interest accrual.
      const totalPrincipalAfter = activeLoans.reduce((sum, l) => sum + l.principal, 0) + amount;
      if (cls.maxLoanAmount > 0 && totalPrincipalAfter > cls.maxLoanAmount) throw new Error("OVER_MAX");
      // Cap on how many loans a student can have open (active) at the same
      // time — paid-off loans don't count against it, so a student can
      // reborrow after repaying, separate from the per-loan amount cap.
      if (cls.maxLoanCount > 0 && activeLoans.length >= cls.maxLoanCount) throw new Error("OVER_COUNT");
      const todayKey = nzDateKey();
      const dueDate = dateKeyPlusDays(todayKey, tier.termWeeks * 7);
      // tier.rate is a WEEKLY rate that compounds live, not a lump sum
      // pre-computed for the whole term up front. The first week's
      // interest is charged right here, the moment the loan is taken out;
      // after that, processLoanInterest() charges the same weekly rate
      // again every Monday for as long as the loan stays active, so
      // paying it off early genuinely saves interest.
      owed = Math.round(amount * (1 + (tier.rate / 100)) * 100) / 100;
      const interestAmt = Math.round((owed - amount) * 100) / 100;
      tierSnapshot = { id: tier.id, termWeeks: tier.termWeeks, rate: tier.rate };
      const loan = {
        id: uid("loan"), tierId: tier.id, principal: amount, rate: tier.rate, termWeeks: tier.termWeeks,
        interestAmt, owed, takenDate: todayKey, dueDate,
        // Which ISO week this loan last had interest charged for — set to
        // the taking week so the very next Monday job doesn't double-charge
        // a loan taken earlier that same week (or on the Monday itself).
        lastInterestWeek: isoWeekKey(new Date()), status: "active",
        // Marks this loan as taken out under the weekly-compounding model
        // (added after the original "one interest charge at take-out only"
        // version). Loans taken before that change don't have this flag,
        // and processLoanInterest below only compounds flagged loans — so
        // existing loans keep accruing interest exactly the way they did
        // when the student took them out; only loans taken out from now on
        // compound weekly.
        weeklyCompounding: true
      };
      user.loans = existingLoans.concat([loan]);
      t.update(userRef, { balance: Math.round((user.balance + amount) * 100) / 100, loans: user.loans });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "NO_TIER") return { ok: false, error: "That amount doesn't fall within any of the loan options your teacher has set up." };
    if (e.message === "OVER_MAX") return { ok: false, error: "That would put your total borrowing above the maximum loan amount your teacher allows." };
    if (e.message === "OVER_COUNT") return { ok: false, error: "You already have the maximum number of loans open that your teacher allows at once." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, {
    type: "loan-taken", to: username, amount,
    note: `Loan taken — ${fmtMoney(owed)} owed so far (${tierSnapshot.rate}%/week, compounding every Monday until paid off)`
  });
  return { ok: true, owed };
}

async function repayLoan(username, loanId, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  let paid = 0, fullyPaid = false;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      const loans = user.loans || [];
      const loan = loans.find(l => l.id === loanId && l.status === "active");
      if (!loan) throw new Error("NOT_FOUND");
      if (user.balance < amount) throw new Error("BROKE");
      if (amount > loan.owed) throw new Error("TOO_MUCH");
      paid = Math.min(amount, loan.owed);
      loan.owed = Math.round((loan.owed - paid) * 100) / 100;
      // paidDate lets report cards judge on-time vs late repayment against
      // dueDate — loans repaid before this field existed simply have no
      // paidDate, and report cards show those as "unknown" rather than
      // guessing.
      if (loan.owed <= 0) { loan.owed = 0; loan.status = "paid"; loan.paidDate = nzDateKey(); fullyPaid = true; }
      t.update(userRef, { balance: Math.round((user.balance - amount) * 100) / 100, loans });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for that." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That loan couldn't be found." };
    if (e.message === "TOO_MUCH") return { ok: false, error: "That's more than you owe on this loan. Enter an amount up to what's left." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const user = await getUser(username);
  if (user) await logTxn(user.classCode, { type: "loan-repayment", from: username, amount: paid, note: fullyPaid ? "Loan fully repaid" : "Loan repayment" });
  return { ok: true, fullyPaid };
}

// Charges another week of compounding interest on every still-active loan,
// first thing every Monday — same "first thing on day X" idea as
// applyMyInterestIfDue/applyInterestToClassIfDue, but on a fixed Monday schedule rather than a
// teacher-configurable day, since loan interest isn't tied to the bank's
// interest settings. A loan's very first week of interest is charged the
// moment it's taken out (see takeLoan) — this only ever adds the 2nd, 3rd,
// ... week's interest on top of that. Tracks the ISO week each loan was
// last charged for (lastInterestWeek) so: (a) re-running this on the same
// Monday (e.g. the teacher reloading the page) never double-charges, and
// (b) a loan gets skipped for good the moment it's fully repaid — a loan
// paid off is status "paid" and simply never matches the active filter
// again, so it stops accruing interest for good, whatever day that happens.
async function processLoanInterest(classCode) {
  if (nzDayName() !== "Mon") return 0;
  const cls = await getClass(classCode);
  if (!cls || cls.archived) return 0;
  const weekKey = isoWeekKey(new Date());
  // A student's account can only charge its own loans (see
  // t29SessionStudent) — don't spend a refused transaction per classmate.
  const selfOnly = t29SessionStudent();
  const students = selfOnly ? [await getUser(selfOnly)].filter(Boolean) : await getClassStudents(classCode);
  let count = 0;
  for (const student of students) {
    const loans = student.loans || [];
    // Only loans taken out under the weekly-compounding model (see takeLoan)
    // are eligible — loans taken before that change never got the
    // weeklyCompounding flag, so they're skipped here and keep the flat,
    // one-time-interest behavior they were taken out under.
    const due = loans.filter(l => l.status === "active" && l.weeklyCompounding && l.lastInterestWeek !== weekKey);
    if (due.length === 0) continue;
    const userRef = usersCol().doc(student.username);
    let charged = [];
    try {
      await fdb.runTransaction(async (t) => {
        charged = []; // reset every attempt — a retried callback would otherwise log the interest twice
        const snap = await t.get(userRef);
        if (!snap.exists) return;
        const user = snap.data();
        const liveLoans = user.loans || [];
        liveLoans.forEach(l => {
          if (l.status !== "active" || !l.weeklyCompounding || l.lastInterestWeek === weekKey) return;
          const before = l.owed;
          l.owed = Math.round(l.owed * (1 + (l.rate / 100)) * 100) / 100;
          l.lastInterestWeek = weekKey;
          const interest = Math.round((l.owed - before) * 100) / 100;
          if (interest > 0) charged.push({ interest, owedAfter: l.owed });
        });
        t.update(userRef, { loans: liveLoans });
      });
    } catch (e) { continue; }
    for (const c of charged) {
      await logTxn(classCode, {
        type: "loan-interest", to: student.username, amount: c.interest,
        note: `Weekly loan interest — now owe ${fmtMoney(c.owedAfter)}`
      });
      count++;
    }
  }
  return count;
}

/* ---------------- Automatic payments ---------------- */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQ_DAYS = { weekly: 7, fortnightly: 14, monthly: 28 };

async function addAutomation(classCode, studentUser, dayOfWeek, frequency, amount, toUser, note, confirmed = false) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (toUser === AUTOPAY_ALL_STUDENTS) {
    const owner = await getUser(studentUser);
    if (!owner || owner.role !== "teacher") return { ok: false, error: "Only teachers can set up a payment to all students." };
  }
  const classRef = classesCol().doc(classCode);
  let confirmInfo = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      if (cls.automations.filter(a => a.studentUser === studentUser).length >= MAX_AUTOMATIONS_PER_STUDENT) {
        throw new Error("TOO_MANY");
      }
      const noteTrimmed = (note || "").trim();
      // Guards against the classic double-submit bug: a student double-taps
      // "Create automatic payment" (slow connection, no visual feedback yet)
      // and ends up with two — or more — otherwise-identical automations.
      // Each one is a perfectly valid, independently-guarded recurring
      // payment on its own, so the same-day-once guard in processAutomations
      // never catches this: it just looks like the same auto-pay firing
      // more than once in a day, when really several near-identical
      // automations each fired exactly once. Reject an exact duplicate
      // (same payer, payee, day, amount AND reference note) outright rather
      // than silently creating another copy — nobody means to create this
      // one on purpose.
      //
      // BUGFIX: this used to also require `frequency` to match before
      // counting as a duplicate, on BOTH this hard-block check and the soft
      // "are you sure" one below. That meant two automations that look
      // completely identical to a student on the Bank page (same payer,
      // payee, amount, day and reference note) got ZERO warning if they
      // merely differed in "how often" — because unlike the reference note
      // (see comment below), frequency was never meant to be a legitimate
      // way to distinguish one recurring payment from another. In practice
      // that let someone end up with, say, "$35 to Nathan, Iron Shield
      // Insurance Payment, every Tuesday" created three separate times with
      // three different frequencies and no warning at all — each is due
      // for the first time on whatever Tuesday it was created, so all three
      // fire on the SAME day, which looks exactly like one automatic
      // payment charging several times in a row. Frequency is dropped from
      // both checks below so this is now caught like any other duplicate.
      const exactDup = cls.automations.find(a =>
        a.studentUser === studentUser && a.toUser === toUser && a.active &&
        a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount) &&
        (a.note || "") === noteTrimmed
      );
      if (exactDup) throw new Error("DUPLICATE");
      // Same amount/recipient/day but a *different* reference note is a
      // legitimate, deliberate case — e.g. "$5 to Alex, chores" and "$5 to
      // Alex, lunch money" both landing on Fridays — so unlike the
      // exact-duplicate case above it isn't rejected outright. But it's
      // also exactly what someone creates by accident if they've simply
      // forgotten they already have one of these running, so it still gets
      // a confirmation step rather than sailing through silently. Skipped
      // once the caller has confirmed and resubmitted.
      if (!confirmed) {
        const softDup = cls.automations.find(a =>
          a.studentUser === studentUser && a.toUser === toUser && a.active &&
          a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount)
        );
        if (softDup) { confirmInfo = { note: softDup.note || "" }; throw new Error("CONFIRM"); }
      }
      cls.automations.push({
        id: uid("auto"), studentUser, dayOfWeek, frequency,
        amount: Number(amount), toUser, note: noteTrimmed, lastRun: null, active: true
      });
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    if (e.message === "TOO_MANY") return { ok: false, error: `You can only have up to ${MAX_AUTOMATIONS_PER_STUDENT} automatic payments set up at once.` };
    if (e.message === "DUPLICATE") return { ok: false, error: "You already have an identical automatic payment set up (same amount, recipient, day and reference message)." };
    if (e.message === "CONFIRM") return { ok: false, needsConfirm: true, existingNote: confirmInfo.note, error: "You already have an automatic payment set up with the same amount, recipient and day." };
    return { ok: false, error: "Class not found." };
  }
  return { ok: true };
}

// A recurring transfer between a student's own cash balance and their
// Savings Account — same idea as a regular automatic payment, but both
// sides belong to the same person, so it's stored distinctly (type:
// "savings-transfer") and handled on a single user doc rather than two.
async function addSavingsAutomation(classCode, studentUser, dayOfWeek, frequency, amount, direction, note, confirmed = false) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (direction !== "toSavings" && direction !== "toCash") return { ok: false, error: "Invalid direction." };
  const classRef = classesCol().doc(classCode);
  let confirmInfo = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      if (cls.automations.filter(a => a.studentUser === studentUser).length >= MAX_AUTOMATIONS_PER_STUDENT) {
        throw new Error("TOO_MANY");
      }
      const noteTrimmed = (note || "").trim();
      // BUGFIX: this used to hard-block on direction+day+amount ALONE —
      // `frequency` was already dropped (same reasoning as
      // addAutomation() above), but `note` was never part of the check at
      // all, on either side. That's the mirror image of the peer-payment
      // bug: instead of letting silent near-duplicates through, it made it
      // impossible to ever have two genuinely different savings transfers
      // that happen to share a direction/day/amount — e.g. "$20 to
      // savings, book fund" and "$20 to savings, trip fund", both
      // Mondays — even though the note field exists precisely to tell
      // those apart (see _autoDedupeKey and the matching comment on
      // addAutomation()'s softDup below). Split into the same two-tier
      // check peer payments use: identical down to the note is blocked
      // outright, same amount/direction/day but a different note asks for
      // confirmation instead of refusing outright or sailing through
      // silently.
      const exactDup = cls.automations.find(a =>
        a.studentUser === studentUser && a.type === "savings-transfer" && a.active &&
        a.direction === direction && a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount) &&
        (a.note || "") === noteTrimmed
      );
      if (exactDup) throw new Error("DUPLICATE");
      if (!confirmed) {
        const softDup = cls.automations.find(a =>
          a.studentUser === studentUser && a.type === "savings-transfer" && a.active &&
          a.direction === direction && a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount)
        );
        if (softDup) { confirmInfo = { note: softDup.note || "" }; throw new Error("CONFIRM"); }
      }
      cls.automations.push({
        id: uid("auto"), studentUser, dayOfWeek, frequency, type: "savings-transfer", direction,
        amount: Number(amount), toUser: studentUser, note: noteTrimmed, lastRun: null, active: true
      });
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    if (e.message === "TOO_MANY") return { ok: false, error: `You can only have up to ${MAX_AUTOMATIONS_PER_STUDENT} automatic payments set up at once.` };
    if (e.message === "DUPLICATE") return { ok: false, error: "You already have an identical automatic transfer set up (same amount, direction, day and note)." };
    if (e.message === "CONFIRM") return { ok: false, needsConfirm: true, existingNote: confirmInfo.note, error: "You already have an automatic transfer set up with the same amount, direction and day." };
    return { ok: false, error: "Class not found." };
  }
  return { ok: true };
}
async function editAutomation(classCode, id, studentUser, dayOfWeek, frequency, amount, toUser, note, confirmed = false) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (toUser === AUTOPAY_ALL_STUDENTS) {
    const owner = await getUser(studentUser);
    if (!owner || owner.role !== "teacher") return { ok: false, error: "Only teachers can set up a payment to all students." };
  }
  const classRef = classesCol().doc(classCode);
  let confirmInfo = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      const idx = cls.automations.findIndex(a => a.id === id && a.studentUser === studentUser);
      if (idx === -1) throw new Error("NOT_FOUND");
      const existing = cls.automations[idx];
      const noteTrimmed = (note || "").trim();
      // Same de-dup guard as addAutomation() (including the BUGFIX there
      // dropping `frequency` from the comparison): without this, editing
      // one automation to match another already-active one (same amount,
      // recipient, day AND reference note — frequency doesn't count as a
      // distinguishing feature) silently produces two truly identical
      // payments firing on the same day — indistinguishable from the same
      // automation firing twice.
      const exactDup = cls.automations.find(a =>
        a.id !== id && a.studentUser === studentUser && a.toUser === toUser && a.active &&
        a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount) &&
        (a.note || "") === noteTrimmed
      );
      if (exactDup) throw new Error("DUPLICATE");
      // Same amount/recipient/day but a different reference note is
      // allowed (see addAutomation()) but still asks for confirmation
      // first, in case the edit was really meant to update the existing
      // one rather than create a second lookalike.
      if (!confirmed) {
        const softDup = cls.automations.find(a =>
          a.id !== id && a.studentUser === studentUser && a.toUser === toUser && a.active &&
          a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount)
        );
        if (softDup) { confirmInfo = { note: softDup.note || "" }; throw new Error("CONFIRM"); }
      }
      cls.automations[idx] = {
        ...existing, dayOfWeek, frequency, amount: Number(amount), toUser, note: noteTrimmed
      };
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    if (e.message === "DUPLICATE") return { ok: false, error: "You already have an identical automatic payment set up (same amount, recipient, day and reference message)." };
    if (e.message === "CONFIRM") return { ok: false, needsConfirm: true, existingNote: confirmInfo.note, error: "You already have an automatic payment set up with the same amount, recipient and day." };
    return { ok: false, error: e.message === "NOT_FOUND" ? "Automatic payment not found." : "Class not found." };
  }
  return { ok: true };
}
async function editSavingsAutomation(classCode, id, studentUser, dayOfWeek, frequency, amount, direction, note, confirmed = false) {
  if (!(Number(amount) > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  if (direction !== "toSavings" && direction !== "toCash") return { ok: false, error: "Invalid direction." };
  const classRef = classesCol().doc(classCode);
  let confirmInfo = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      cls.automations = cls.automations || [];
      const idx = cls.automations.findIndex(a => a.id === id && a.studentUser === studentUser);
      if (idx === -1) throw new Error("NOT_FOUND");
      const existing = cls.automations[idx];
      const noteTrimmed = (note || "").trim();
      // Same de-dup guard as addSavingsAutomation() (including the BUGFIX
      // there splitting this into an exact-match hard block plus a
      // same-amount/direction/day-but-different-note soft confirm, the
      // same way addAutomation()/editAutomation() already work): without
      // this, editing one transfer to exactly match another already-active
      // one silently produces two identical transfers firing on the same
      // day — indistinguishable from the same one firing twice.
      const exactDup = cls.automations.find(a =>
        a.id !== id && a.studentUser === studentUser && a.type === "savings-transfer" && a.active &&
        a.direction === direction && a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount) &&
        (a.note || "") === noteTrimmed
      );
      if (exactDup) throw new Error("DUPLICATE");
      if (!confirmed) {
        const softDup = cls.automations.find(a =>
          a.id !== id && a.studentUser === studentUser && a.type === "savings-transfer" && a.active &&
          a.direction === direction && a.dayOfWeek === dayOfWeek && Number(a.amount) === Number(amount)
        );
        if (softDup) { confirmInfo = { note: softDup.note || "" }; throw new Error("CONFIRM"); }
      }
      cls.automations[idx] = {
        ...existing, dayOfWeek, frequency, amount: Number(amount), direction, note: noteTrimmed
      };
      t.update(classRef, { automations: cls.automations });
    });
  } catch (e) {
    if (e.message === "DUPLICATE") return { ok: false, error: "You already have an identical automatic transfer set up (same amount, direction, day and note)." };
    if (e.message === "CONFIRM") return { ok: false, needsConfirm: true, existingNote: confirmInfo.note, error: "You already have an automatic transfer set up with the same amount, direction and day." };
    return { ok: false, error: e.message === "NOT_FOUND" ? "Automatic transfer not found." : "Class not found." };
  }
  return { ok: true };
}
async function removeAutomation(classCode, id) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.automations = (cls.automations || []).filter(a => a.id !== id);
    t.update(classRef, { automations: cls.automations });
  });
}
async function getStudentAutomations(classCode, studentUser) {
  const cls = await getClass(classCode);
  if (!cls) return [];
  return (cls.automations || []).filter(a => a.studentUser === studentUser);
}

// Key used to detect "exact duplicate" automations — same fields as the
// double-submit guards in addAutomation/addSavingsAutomation/editAutomation/
// editSavingsAutomation above, INCLUDING the reference note. Any automations
// sharing a key are really one recurring payment that got accidentally
// created more than once (double-tap on a slow connection, or a device with
// a drifted clock, before those guards existed) — each copy is independently
// valid and fires on its own schedule, which is what shows up as "the same
// auto-pay running several times a day".
//
// The note is part of the key deliberately: a student can have two active
// automations that share everything else (same amount, recipient and day)
// but carry different reference notes — e.g. "$5 to Alex, chores" and "$5
// to Alex, lunch money", both on Fridays. Those are two genuinely different
// payments that both happen to be due at once, not duplicates of each
// other, so they must NOT be folded together here or treated as "already
// covered" by one another below — each needs to actually fire.
//
// BUGFIX: `frequency` used to be part of this key too, which is what let
// two (or three) automations that a student would see as completely
// identical on the Bank page — same payer, payee, amount, day and note —
// count as separate payments just because "how often" was set differently.
// The first time each was due, none of them showed up as a duplicate here
// (or in the create/edit-time checks — see addAutomation()), so all of
// them fired in full on the same day: exactly the "one automatic payment
// charging several times in a row" symptom. Frequency is dropped from the
// key so any such automations already sitting in a class's data are
// recognised as the same recurring payment from here on — only one of them
// pays out per day, and dedupeAutomations() below will fold the rest away.
function _autoDedupeKey(a) {
  return a.type === "savings-transfer"
    ? ["sav", a.studentUser, a.direction, a.dayOfWeek, Number(a.amount), a.note || ""].join("|")
    : ["pay", a.studentUser, a.toUser, a.dayOfWeek, Number(a.amount), a.note || ""].join("|");
}
// Self-healing cleanup for automations created before the double-submit
// guards existed: merges each group of exact duplicates down to a single
// copy. Keeps whichever copy last ran most recently (falling back to the
// first one created if none have run yet) so merging never makes a
// payment due again sooner than it already was. Only opens a transaction
// when a duplicate is actually found — the common case (no duplicates)
// costs nothing beyond the read already done by the caller.
async function dedupeAutomations(classCode, automations) {
  const groups = new Map();
  for (const a of automations) {
    if (!a.active) continue;
    const key = _autoDedupeKey(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  if (![...groups.values()].some(g => g.length > 1)) return false; // nothing to merge

  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) return;
      const cls = snap.data();
      const list = cls.automations || [];
      const liveGroups = new Map();
      for (const a of list) {
        if (!a.active) continue;
        const key = _autoDedupeKey(a);
        if (!liveGroups.has(key)) liveGroups.set(key, []);
        liveGroups.get(key).push(a);
      }
      const toRemove = new Set();
      for (const group of liveGroups.values()) {
        if (group.length < 2) continue;
        let keep = group[0];
        for (const a of group) if ((a.lastRun || "") > (keep.lastRun || "")) keep = a;
        for (const a of group) if (a !== keep) toRemove.add(a.id);
      }
      if (toRemove.size === 0) return;
      t.update(classRef, { automations: list.filter(a => !toRemove.has(a.id)) });
    });
  } catch (e) { return false; } // best-effort; will retry on the next load
  return true;
}

// Runs on dashboard load: fires any automation whose day-of-week matches
// today and whose frequency interval has elapsed since it last ran.
//
// BUGFIX: the "have I already paid out today?" check used to live ONLY on
// each automation's own `id` (`liveAuto.lastRun === todayKey`). That's a
// correct guard against the SAME automation firing twice, but it does
// nothing for leftover duplicate automations — several separate entries
// with the same payer/payee/day/amount/note (see _autoDedupeKey — note
// `frequency` is deliberately NOT part of this), created by an old
// double-submit before addAutomation()'s DUPLICATE guard existed. Each
// duplicate is independently valid and independently "hasn't run today",
// so the id-based check let every single one of them pay out once, which
// from the student's side looks exactly like "the same automatic payment
// running several times a day" (see screenshot: one "Weekly Expenses"
// automation charging $110 more than a dozen times in under an hour).
//
// dedupeAutomations() above is supposed to merge those duplicates away
// before this loop ever runs — but it's a best-effort cleanup: its own
// transaction can lose a contention retry or hit a transient failure, and
// because it decides whether to even attempt the merge from whatever
// snapshot of `cls.automations` this call happened to see, it can also
// simply miss duplicates that exist live but weren't in that snapshot. In
// either case the loop below used to fall straight back to firing every
// surviving duplicate by id, once each.
//
// Fix: track which PAYMENTS (not which automation ids) have already paid
// out today, keyed by _autoDedupeKey — the same "what is this payment,
// really" signature dedupeAutomations uses to spot duplicates in the
// first place. `firedKeysToday` covers duplicates encountered earlier in
// this same loop; the `alreadyCoveredLive` check inside each transaction
// covers duplicates paid out by a different page load (another tab, a
// second device) since this function started. Either way, once ANY copy
// of a given recurring payment has paid out today, every other copy just
// gets its own lastRun stamped to match — no money moves twice — and sits
// there ready for dedupeAutomations() to fold away for good next time.
// ---- Autopay engine helpers (see processAutomations below) ----
//
// ROOT-CAUSE FIX (the "auto-payments run several times a day" bug):
// processAutomations() used to record the outcome of each payment in
// variables (`didRun`, `paidTo`, `coveredByDuplicate`) that were assigned
// INSIDE the fdb.runTransaction() callback and read AFTER it, and then
// wrote the transaction-log entry in a completely separate transaction.
// Firestore re-runs a transaction callback whenever it loses a contention
// race, and those variables were never reset between attempts. Every page
// of the app runs this job on load, so when a class opens the app together
// many clients race on the same class doc: a client whose FIRST attempt
// reached `didRun = true` but got aborted would retry, find that another
// client had already paid today, return early — yet still see
// `didRun === true` and go on to log (and add to the student's report
// totals) a payment that never happened. Same for `paidTo`, which also
// accumulated duplicate usernames across retries. That is exactly
// "one automatic payment showing up several times in a day".
//
// Fix: (1) the callback now RETURNS what it did, so only the attempt that
// actually committed counts; (2) the log entry is written in the SAME
// transaction as the money movement, so payment + log + lastRun are one
// atomic unit; (3) every entry has a deterministic id
// (auto-<automationId>-<date>[-<student>]) and is checked for inside the
// transaction, so a given automation can never pay the same day twice
// even if `lastRun` were ever overwritten; (4) the transaction re-validates
// the LIVE automation (active, day, frequency elapsed, same payment)
// instead of trusting the copy read before it started.
function _autoIsDue(a, todayName, todayKey) {
  if (!a || !a.active) return false;
  if (a.dayOfWeek !== todayName) return false;
  if (a.lastRun === todayKey) return false;
  if (a.lastRun) {
    const daysSince = daysBetweenKeys(a.lastRun, todayKey);
    const need = FREQ_DAYS[a.frequency] || 7;
    if (daysSince < need) return false;
  }
  return true;
}
function _autoTxnId(a, todayKey, suffix) {
  return "auto-" + a.id + "-" + todayKey + (suffix ? "-" + suffix : "");
}
// Appends already-built log entries to a class doc's `txns` (newest first,
// capped) — same shape logTxn() produces, but done inside the caller's
// own transaction.
function _autoAppendTxns(liveCls, entries) {
  const merged = entries.concat(liveCls.txns || []);
  if (merged.length > MAX_STORED_TXNS) merged.length = MAX_STORED_TXNS;
  liveCls.txns = merged;
}
// The post-commit half of logTxn(): feed each committed entry into the
// rolling per-student report totals. Called exactly once per entry, only
// for entries that really committed.
async function _autoReportCommitted(entries) {
  await Promise.all(entries.map(e =>
    Promise.all([...new Set([e.to, e.from].filter(Boolean))].map(u => recordReportActivity(u, e)))));
}

async function processAutomations(classCode) {
  // Most pages call this without having synced the server clock first
  // (only Bank/Student/Teacher/Property did) — so the "what day is it /
  // has this run today" decision was made from the device's own clock on
  // every other page. No-op once already synced this session.
  try { await syncServerClock(classCode); } catch (e) { /* falls back to device clock */ }

  let cls = await getClass(classCode);
  if (!cls || !cls.automations || cls.automations.length === 0 || cls.archived) return 0;

  // Heal any leftover duplicate automations before processing so a class
  // with old double-submitted entries doesn't keep firing them forever.
  if (await dedupeAutomations(classCode, cls.automations)) {
    cls = await getClass(classCode);
    if (!cls || !cls.automations || cls.automations.length === 0 || cls.archived) return 0;
  }

  const todayName = nzDayName();
  const todayKey = nzDateKey();
  let ran = 0;
  const firedKeysToday = new Set();
  const classRef = classesCol().doc(classCode);

  // From a student's page, only payments this student is part of can ever
  // commit (firestore.rules refuses writes to unrelated classmates' docs,
  // and a teacher's pay-everyone run writes the whole roster) — skip the
  // rest instead of paying a refused transaction for each one.
  const selfOnly = t29SessionStudent();
  for (const a of cls.automations) {
    if (!a.active) continue;
    if (selfOnly && (a.toUser === AUTOPAY_ALL_STUDENTS || (a.studentUser !== selfOnly && a.toUser !== selfOnly))) continue;
    if (a.dayOfWeek !== todayName) continue;
    if (a.lastRun === todayKey) { firedKeysToday.add(_autoDedupeKey(a)); continue; }
    if (!_autoIsDue(a, todayName, todayKey)) continue;
    const dedupeKey = _autoDedupeKey(a);
    if (firedKeysToday.has(dedupeKey)) continue; // a duplicate already paid this out today

    // Shared by all three branches, run at the top of each transaction
    // AFTER its reads. Returns a result to bail out with, or null to go on.
    const guard = (liveCls) => {
      const liveAuto = (liveCls.automations || []).find(x => x.id === a.id);
      // Gone, paused, edited to a different payment/day, or already ran.
      if (!liveAuto || !_autoIsDue(liveAuto, todayName, todayKey) || _autoDedupeKey(liveAuto) !== dedupeKey)
        return { status: "skip" };
      // Another copy of this exact payment already paid today, or this
      // exact ledger entry already exists: stamp and stop, move no money.
      const covered = (liveCls.automations || []).some(x =>
        x.id !== a.id && x.lastRun === todayKey && _autoDedupeKey(x) === dedupeKey);
      const logged = (liveCls.txns || []).some(x => x.id === _autoTxnId(a, todayKey) ||
        (typeof x.id === "string" && x.id.indexOf(_autoTxnId(a, todayKey) + "-") === 0));
      if (covered || logged) {
        liveAuto.lastRun = todayKey;
        return { status: "covered", liveAuto };
      }
      return { status: "go", liveAuto };
    };

    let outcome = { status: "skip" };
    try {
      if (a.type === "savings-transfer") {
        // Self-to-self: only one user doc involved.
        outcome = await fdb.runTransaction(async (t) => {
          const userRef = usersCol().doc(a.studentUser);
          const classSnap = await t.get(classRef);
          const userSnap = await t.get(userRef);
          if (!classSnap.exists || !userSnap.exists) return { status: "skip" };
          const user = userSnap.data();
          const liveCls = classSnap.data();
          const g = guard(liveCls);
          if (g.status === "skip") return g;
          if (g.status === "covered") { t.update(classRef, { automations: liveCls.automations }); return g; }
          const amt = Number(g.liveAuto.amount);
          const savings = user.savings || 0;
          const fromCash = g.liveAuto.direction === "toSavings";
          const available = fromCash ? user.balance : savings;
          if (available < amt) return { status: "skip" }; // can't afford it this time
          const newBalance = fromCash ? user.balance - amt : user.balance + amt;
          const newSavings = fromCash ? savings + amt : savings - amt;
          t.update(userRef, { balance: Math.round(newBalance * 100) / 100, savings: Math.round(newSavings * 100) / 100 });
          g.liveAuto.lastRun = todayKey;
          const entry = Object.assign({ id: _autoTxnId(a, todayKey), date: nowStr(), ts: Date.now() }, {
            type: fromCash ? "savings-deposit" : "savings-withdraw",
            [fromCash ? "from" : "to"]: a.studentUser,
            amount: amt,
            note: (g.liveAuto.note ? g.liveAuto.note + " — " : "") + "Automatic transfer"
          });
          _autoAppendTxns(liveCls, [entry]);
          t.update(classRef, { automations: liveCls.automations, txns: liveCls.txns });
          return { status: "ran", entries: [entry] };
        });
      } else if (a.toUser === AUTOPAY_ALL_STUDENTS) {
        // Teacher "pay all students": one record fans out to every student
        // currently in the class (roster read fresh, in-transaction).
        outcome = await fdb.runTransaction(async (t) => {
          const classSnap = await t.get(classRef);
          if (!classSnap.exists) return { status: "skip" };
          const liveCls = classSnap.data();
          const g = guard(liveCls);
          if (g.status === "skip") return g;
          if (g.status === "covered") { t.update(classRef, { automations: liveCls.automations }); return g; }
          const amt = Number(g.liveAuto.amount);
          const usernames = Array.from(new Set(liveCls.students || [])); // no repeated names
          const studentRefs = usernames.map(u => usersCol().doc(u));
          const studentSnaps = await Promise.all(studentRefs.map(r => t.get(r)));
          const entries = [];
          studentSnaps.forEach((snap, i) => {
            if (!snap.exists) return; // stale username, e.g. a removed student
            const student = snap.data();
            t.update(studentRefs[i], { balance: Math.round((student.balance + amt) * 100) / 100 });
            entries.push(Object.assign({ id: _autoTxnId(a, todayKey, usernames[i]), date: nowStr(), ts: Date.now() }, {
              type: "automation", from: a.studentUser, to: usernames[i], amount: amt,
              note: g.liveAuto.note ? g.liveAuto.note : "Automatic payment"
            }));
          });
          g.liveAuto.lastRun = todayKey;
          _autoAppendTxns(liveCls, entries);
          t.update(classRef, { automations: liveCls.automations, txns: liveCls.txns });
          return { status: "ran", entries };
        });
      } else {
        // Student/teacher -> one other account.
        outcome = await fdb.runTransaction(async (t) => {
          const fromRef = usersCol().doc(a.studentUser);
          const toRef = usersCol().doc(a.toUser);
          const classSnap = await t.get(classRef);
          const fromSnap = await t.get(fromRef);
          const toSnap = await t.get(toRef);
          if (!classSnap.exists || !fromSnap.exists || !toSnap.exists) return { status: "skip" };
          const from = fromSnap.data(), to = toSnap.data();
          const liveCls = classSnap.data();
          const g = guard(liveCls);
          if (g.status === "skip") return g;
          if (g.status === "covered") { t.update(classRef, { automations: liveCls.automations }); return g; }
          const amt = Number(g.liveAuto.amount);
          // Teachers have unlimited funds (same rule as transferMoney()).
          const fromIsTeacher = from.role === "teacher";
          if (!fromIsTeacher && from.balance < amt) return { status: "skip" }; // can't afford it
          if (!fromIsTeacher) t.update(fromRef, { balance: Math.round((from.balance - amt) * 100) / 100 });
          t.update(toRef, { balance: Math.round((to.balance + amt) * 100) / 100 });
          g.liveAuto.lastRun = todayKey;
          const entry = Object.assign({ id: _autoTxnId(a, todayKey), date: nowStr(), ts: Date.now() }, {
            type: "automation", from: a.studentUser, to: a.toUser, amount: amt,
            note: g.liveAuto.note ? g.liveAuto.note : "Automatic payment"
          });
          _autoAppendTxns(liveCls, [entry]);
          t.update(classRef, { automations: liveCls.automations, txns: liveCls.txns });
          return { status: "ran", entries: [entry] };
        });
      }
    } catch (e) { outcome = { status: "skip" }; /* failed to commit — nothing ran; try again next load */ }

    if (outcome && (outcome.status === "ran" || outcome.status === "covered")) firedKeysToday.add(dedupeKey);
    if (outcome && outcome.status === "ran") {
      ran++;
      await _autoReportCommitted(outcome.entries);
    }
  }
  return ran;
}

/* ===================== Term deposits ===================== */
function dateKeyPlusDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
}
async function addTermDepositPlan(classCode, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.termDepositPlans.push({
      id: uid("td"), name: plan.name, minAmount: Number(plan.minAmount) || 0,
      days: Math.max(1, Number(plan.days) || 1), rate: Number(plan.rate) || 0,
      earlyFeePct: Math.max(0, Number(plan.earlyFeePct) || 0), active: true
    });
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
}
async function editTermDepositPlan(classCode, planId, plan) {
  const classRef = classesCol().doc(classCode);
  let updatedPlan = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.termDepositPlans.find(p => p.id === planId);
    if (!existing) return;
    existing.name = plan.name;
    existing.minAmount = Number(plan.minAmount) || 0;
    existing.days = Math.max(1, Number(plan.days) || 1);
    existing.rate = Number(plan.rate) || 0;
    existing.earlyFeePct = Math.max(0, Number(plan.earlyFeePct) || 0);
    updatedPlan = existing;
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
  if (!updatedPlan) return;
  // Existing deposits store a snapshot of the plan at open time (name, rate,
  // earlyFeePct, days) so that a plan being removed/changed doesn't corrupt
  // the deposit. Since the teacher explicitly wants edits to apply to
  // ongoing deposits, that snapshot is refreshed on every student who has a
  // deposit under this plan. matureDate is left untouched — it was already
  // computed from the original day count, and changing it retroactively
  // would be surprising, so `days` is only updated for display purposes.
  const students = await getClassStudents(classCode);
  await Promise.all(students.map(async (s) => {
    const deposits = s.termDeposits || [];
    if (!deposits.some(d => d.planId === planId)) return;
    const userRef = usersCol().doc(s.username);
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return;
      const user = snap.data();
      const liveDeposits = user.termDeposits || [];
      let changed = false;
      liveDeposits.forEach(d => {
        if (d.planId === planId) {
          d.plan = { id: updatedPlan.id, name: updatedPlan.name, days: updatedPlan.days, rate: updatedPlan.rate, earlyFeePct: updatedPlan.earlyFeePct };
          changed = true;
        }
      });
      if (changed) t.update(userRef, { termDeposits: liveDeposits });
    });
  }));
}
async function removeTermDepositPlan(classCode, planId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.termDepositPlans = cls.termDepositPlans.filter(p => p.id !== planId);
    t.update(classRef, { termDepositPlans: cls.termDepositPlans });
  });
}
async function openTermDeposit(username, classCode, planId, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let planSnapshot = null;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const plan = cls.termDepositPlans.find(p => p.id === planId && p.active);
      if (!plan) throw new Error("NOT_FOUND");
      if (!(amount > 0) || amount < plan.minAmount) throw new Error("MIN");
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < amount) throw new Error("BROKE");
      const todayKey = nzDateKey();
      const matureKey = dateKeyPlusDays(todayKey, plan.days);
      planSnapshot = { id: plan.id, name: plan.name, days: plan.days, rate: plan.rate, earlyFeePct: plan.earlyFeePct };
      user.termDeposits = user.termDeposits || [];
      user.termDeposits.push({
        id: uid("tdo"), planId: plan.id, plan: planSnapshot, amount,
        startDate: todayKey, matureDate: matureKey,
        // Marks this deposit as opened under the weekly-compounding payout
        // model (rate compounded over days/7 weeks). Deposits opened before
        // that change don't have this flag, and processTermDeposits below
        // falls back to the original flat, non-compounding payout formula
        // for them — so a deposit already sitting in someone's account
        // still matures for exactly the amount it was opened expecting.
        weeklyCompounding: true
      });
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - amount) * 100) / 100, termDeposits: user.termDeposits });
      else t.update(userRef, { termDeposits: user.termDeposits });
    });
  } catch (e) {
    if (e.message === "MIN") return { ok: false, error: "That's below the minimum amount for this plan." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "term-deposit-open", from: username, amount, note: `Opened term deposit: ${planSnapshot.name}` });
  return { ok: true };
}
async function withdrawTermDepositEarly(username, depositId) {
  const userRef = usersCol().doc(username);
  let payout = 0, name = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      user.termDeposits = user.termDeposits || [];
      const dep = user.termDeposits.find(d => d.id === depositId);
      if (!dep) throw new Error("NOT_FOUND");
      name = dep.plan.name;
      const fee = Math.round(dep.amount * (dep.plan.earlyFeePct / 100) * 100) / 100;
      payout = Math.round((dep.amount - fee) * 100) / 100;
      user.termDeposits = user.termDeposits.filter(d => d.id !== depositId);
      t.update(userRef, { balance: Math.round((user.balance + payout) * 100) / 100, termDeposits: user.termDeposits });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const classUser = await getUser(username);
  if (classUser) await logTxn(classUser.classCode, { type: "term-deposit-early", to: username, amount: payout, note: `Withdrew early from: ${name}` });
  return { ok: true };
}
async function processTermDeposits(classCode) {
  // This job runs on EVERY page load, on every page in the app (it's one
  // of the 8 background jobs in each page's init()) — but a student's
  // term deposits only ever mature once, on one specific day. Without a
  // guard, every single page load did a full batched read of every
  // student in the class (getClassStudents = 1 Firestore read PER
  // STUDENT) just to check maturity dates, even on the ~29 days out of 30
  // nothing was due. processWeeklyEvents/processWeeklyBigEvents right
  // below already use a "claim today/this week via transaction" guard for
  // exactly this reason — this brings processTermDeposits in line with
  // them: skip the student read entirely once today's already been
  // checked, and use a transaction to claim the day so two tabs loading
  // at once can't both think they're first and double-process.
  //
  // The claim step is wrapped in try/catch: this function is called from
  // a Promise.all() with 7 other jobs on every single page, with nothing
  // upstream catching a rejection — so if this write ever fails for any
  // reason (permission rule, transient network issue, etc.), it must not
  // throw, or it takes the ENTIRE page load down with it. On failure it
  // falls back to the original always-check behavior for that one load
  // rather than skipping the check, so a deposit maturing never silently
  // stops working even if the optimization itself can't run.
  const todayKey = nzDateKey();
  // BUGFIX: a student's account can only pay out its OWN deposits (writing
  // a classmate's balance is refused by firestore.rules), but the day-claim
  // below is class-wide — so whichever student opened the site first each
  // day claimed the whole class, paid out only themselves, and every other
  // student's matured deposit sat unpaid until a later day's first visitor
  // happened to be them (or the teacher). A student now just checks their
  // own deposits, every load (one doc they've already read), and leaves
  // the class-wide claim and sweep to a teacher's session.
  const selfOnly = t29SessionStudent();
  if (selfOnly) {
    const cls = await getClassCached(classCode);
    if (!cls || cls.archived) return 0;
    const me = await getUserCached(selfOnly);
    if (!me || !(me.termDeposits || []).some(d => d.matureDate <= todayKey)) return 0;
    return _matureTermDepositsFor(classCode, [me], todayKey);
  }
  let claimed = false;
  try {
    const classRef = classesCol().doc(classCode);
    const cls = await getClassCached(classCode);
    if (!cls || cls.archived) return 0;
    if (cls.lastTermDepositCheckDay === todayKey) return 0;
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) return;
      const liveCls = snap.data();
      if (liveCls.lastTermDepositCheckDay === todayKey) return;
      t.update(classRef, { lastTermDepositCheckDay: todayKey });
      claimed = true;
    });
    if (!claimed) return 0;
  } catch (e) {
    console.warn("processTermDeposits: day-guard failed, falling back to a full check", e);
  }

  return _matureTermDepositsFor(classCode, await getClassStudents(classCode), todayKey);
}

async function _matureTermDepositsFor(classCode, students, todayKey) {
  let matured = 0;
  for (const student of students) {
    const deposits = student.termDeposits || [];
    const due = deposits.filter(d => d.matureDate <= todayKey);
    if (due.length === 0) continue;
    const userRef = usersCol().doc(student.username);
    let notes = [];
    try {
      await fdb.runTransaction(async (t) => {
        notes = []; // reset every attempt — a retried callback would otherwise log each payout twice
        const snap = await t.get(userRef);
        if (!snap.exists) return;
        const user = snap.data();
        const liveDeposits = user.termDeposits || [];
        const liveDue = liveDeposits.filter(d => d.matureDate <= todayKey);
        if (liveDue.length === 0) return;
        let bal = user.balance;
        liveDue.forEach(d => {
          // Deposits opened under the weekly-compounding model (flagged at
          // open time — see openTermDeposit) use d.plan.rate as a WEEKLY
          // rate that compounds over the deposit's term (days/7 weeks,
          // which may be fractional) — matches how loan interest works
          // now, and lets a 90-day plan pay noticeably more than a 30-day
          // plan at the same weekly rate. Deposits opened before that
          // change never got the flag, so they fall back to the original
          // flat payout they were promised: rate applied once, not
          // compounded per week.
          let payout;
          if (d.weeklyCompounding) {
            const weeks = d.plan.days / 7;
            payout = Math.round(d.amount * Math.pow(1 + (d.plan.rate / 100), weeks) * 100) / 100;
          } else {
            payout = Math.round(d.amount * (1 + (d.plan.rate / 100)) * 100) / 100;
          }
          const interest = Math.round((payout - d.amount) * 100) / 100;
          bal += payout;
          notes.push({ note: `${d.plan.name} matured: ${fmtMoney(d.amount)} + ${fmtMoney(interest)} interest`, amount: payout });
        });
        const remaining = liveDeposits.filter(d => d.matureDate > todayKey);
        t.update(userRef, { balance: Math.round(bal * 100) / 100, termDeposits: remaining });
      });
    } catch (e) { continue; }
    for (const n of notes) {
      await logTxn(classCode, { type: "term-deposit-mature", to: student.username, amount: n.amount, note: n.note });
    }
    if (notes.length) matured += notes.length;
  }
  return matured;
}

/* ===================== Auto interest ===================== */
async function saveInterestSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    interestRate: Number(settings.rate) || 0,
    cashInterestRate: Number(settings.cashRate) || 0,
    interestAuto: !!settings.auto,
    interestFrequency: settings.frequency || "weekly",
    interestDay: settings.day || "Fri"
  });
}
// Is it THIS student's turn for interest, going by the class's schedule
// and THEIR OWN lastInterestApplied stamp (not a single class-wide
// flag — see the big comment above applyMyInterestIfDue/
// applyInterestToClassIfDue below for why it has to work this way).
// Same day/frequency logic the old class-wide autoInterestIfDue used,
// just evaluated per student instead of once for the whole class.
function isInterestDueForUser(cls, user, todayKey) {
  if (!cls || !cls.interestAuto || cls.archived) return false;
  if (!user || user.role !== "student") return false;
  if (user.lastInterestApplied === todayKey) return false;
  if (cls.interestFrequency !== "daily") {
    if (nzDayName() !== (cls.interestDay || "Fri")) return false;
    if (user.lastInterestApplied) {
      const need = FREQ_DAYS[cls.interestFrequency] || 7;
      if (daysBetweenKeys(user.lastInterestApplied, todayKey) < need) return false;
    }
  }
  return true;
}

// ===================== Automatic interest — two entry points =====================
// BACKGROUND: interest used to be gated by ONE flag on the shared class
// doc (lastInterestRun) — whoever's page happened to claim it for the
// day paid the WHOLE class in one go. That doesn't work from a student's
// own session: firestore.rules only lets a TEACHER write more than one
// student's /users doc in a single run (see the big comment above
// isAllowedStudentClassUpdate() in firestore.rules) — crediting interest
// into 20 OTHER accounts isn't something a student's login can ever be
// safely trusted to do, because unlike a peer-to-peer transfer, interest
// isn't conservation-of-money: there's no matching debit anywhere a rule
// could check the credited amount against. So under the old design, a
// student's tab opening always failed the class-doc write silently
// (caught, logged, page kept loading) and only a teacher's visit ever
// actually paid anyone.
//
// Fix: track "was I paid today" PER STUDENT, on their own /users doc
// (lastInterestApplied — a plain self-writable field, exactly like the
// `loans[].lastInterestWeek` stamp processLoanInterest above already
// uses for the same reason). That makes two independent entry points
// both safe AND unable to double-pay anyone, because they both funnel
// through _creditStudentInterest(), which does the credit + the stamp
// as ONE transaction on that one student's own doc — Firestore
// serializes concurrent transactions on the same document, so whichever
// of the two paths below gets there first for a given student "wins",
// and the other's transaction re-reads, sees lastInterestApplied already
// set to today, and does nothing. This holds regardless of how many
// tabs/devices/paths hit the same student at once.
//
//   1. applyMyInterestIfDue(username) — called from student.js and from
//      bank.js when the CURRENT visitor is a student. Pays interest into
//      ONLY that one student's own account, if their own schedule says
//      it's due. This is what makes interest arrive for a student who
//      never happens to share a class with a teacher who's currently
//      online — they get paid on their OWN next visit, whatever day that
//      turns out to be, rather than being stuck waiting for a teacher.
//
//   2. applyInterestToClassIfDue(classCode) — called from teacher.js and
//      from bank.js when the CURRENT visitor is a teacher (this is the
//      direct replacement for the old class-wide autoInterestIfDue). A
//      teacher's session CAN write every student's doc, so this keeps
//      doing what the old auto-run did — walk the whole roster and pay
//      everyone who's due — but the "who's due" and "don't double-pay"
//      checks are now per student, so it correctly SKIPS anyone who
//      already got paid via their own visit (path 1) earlier that day,
//      and only tops up the ones who haven't opened anything yet. This
//      is exactly "runs like right now for students who haven't opened
//      yet" — a teacher's visit is still a full safety-net sweep of the
//      class, it just no longer re-pays people who don't need it.
//
// A class with no teacher visiting for days still pays every student
// exactly on schedule, one by one, as they show up. A class where the
// teacher visits daily behaves exactly like before. Nobody is ever paid
// twice for the same day, from any combination of the two paths.

async function applyMyInterestIfDue(username) {
  const todayKey = nzDateKey();
  const user = await getUser(username);
  if (!user || user.role !== "student") return 0;
  const cls = await getClass(user.classCode);
  // Cheap pre-check against the (slightly-stale-is-fine) plain reads
  // above, so a page load that isn't due today never even opens a
  // transaction. The REAL guard — the one that actually prevents a
  // double payment — is the fresh re-check inside _creditStudentInterest.
  if (!isInterestDueForUser(cls, user, todayKey)) return 0;
  if (!_interestMightBePayable(cls, user)) return 0;
  const credited = await _creditStudentInterest(user.classCode, username, todayKey, { cls });
  return credited ? 1 : 0;
}

async function applyInterestToClassIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || !cls.interestAuto || cls.archived) return 0;
  const todayKey = nzDateKey();
  const students = await getClassStudents(classCode, cls);
  let count = 0;
  for (const student of students) {
    // Cheap in-memory skip before opening a transaction, same reasoning
    // as applyMyInterestIfDue above — students who already got paid
    // today (whether by their own visit or an earlier pass of this same
    // loop) are the common case, and this check is free.
    if (!isInterestDueForUser(cls, student, todayKey)) continue;
    if (!_interestMightBePayable(cls, student)) continue; // e.g. nothing in savings — nothing to pay
    const credited = await _creditStudentInterest(classCode, student.username, todayKey, { cls });
    if (credited) count++;
  }
  return count;
}

/* ---------------- Leaderboard ---------------- */
// Every transaction from the last `days` days (default 10.5 = 1.5 weeks).
// Txns logged before the ts field existed have no timestamp to check, so
// they're included rather than silently hidden.
function getRecentTxns(cls, days) {
  const cutoff = Date.now() - (days || 10.5) * 86400000;
  return (cls.txns || []).filter(t => t.ts === undefined || t.ts >= cutoff);
}

async function classLeaderboard(classCode, viewerUsername, precomputedStudents) {
  const cls = await getClassCached(classCode);
  if (!cls) return [];
  const students = precomputedStudents || await getClassStudents(classCode, cls);
  // Everything needed (share prices, store item prices) is already sitting
  // in `cls`, and each student's own holdings/items came back with them —
  // so this is computed entirely in memory instead of the old approach,
  // which had portfolioValue() and storeItemsValue() each re-fetch the
  // whole class (and, for storeItemsValue, the user too) from the network
  // separately for every single student. That was ~4 extra network
  // round-trips per student just to build the leaderboard.
  const rows = students.map(s => {
    let invested = 0;
    cls.companies.forEach(co => { invested += (co.holders[s.username] || 0) * co.price; });
    invested = Math.round(invested * 100) / 100;

    let storeValue = 0;
    (s.storeItems || []).forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item && item.countsNetWorth !== false) storeValue += item.price;
    });
    storeValue = Math.round(storeValue * 100) / 100;

    // Property and vehicles aren't listed on the student doc — ownership
    // lives on the class doc's properties/vehicles arrays (p.owner /
    // v.owners) — so find what this student owns by scanning those.
    let propertyValue = 0, mortgageOwed = 0;
    (cls.properties || []).forEach(p => {
      if (p.owner !== s.username) return;
      propertyValue += p.price;
      if (p.mortgage) mortgageOwed += (p.mortgage.weeklyPayment || 0) * (p.mortgage.weeksLeft || 0);
    });
    propertyValue = Math.round(propertyValue * 100) / 100;
    mortgageOwed = Math.round(mortgageOwed * 100) / 100;

    let vehicleValue = 0;
    (cls.vehicles || []).forEach(v => { if ((v.owners || []).includes(s.username)) vehicleValue += v.price; });
    vehicleValue = Math.round(vehicleValue * 100) / 100;

    const savings = s.savings || 0;
    const owed = (s.loans || []).filter(l => l.status === "active").reduce((sum, l) => sum + l.owed, 0) + mortgageOwed;
    const termDeposits = (s.termDeposits || []).reduce((sum, d) => sum + d.amount, 0);
    // Gambling account balance counts toward net worth like any other
    // place a student can hold value, but it isn't a line in the
    // breakdown shown on the leaderboard/report — it's folded silently
    // into `net` via gamblingBalance below.
    const gamblingBalance = gamblingAccountToday(s).balance;
    return {
      username: s.username, name: s.name,
      balance: s.balance, invested, storeValue, propertyValue, vehicleValue, savings, owed, termDeposits,
      net: Math.round((s.balance + invested + storeValue + propertyValue + vehicleValue + savings + termDeposits + gamblingBalance - owed) * 100) / 100
    };
  });
  // Loan/mortgage debt ("owed") is shown for every student on the
  // leaderboard, not just the viewer's own row — classmates can see each
  // other's debt, same as every other breakdown figure here.
  rows.sort((a, b) => b.net - a.net);
  return rows;
}

// The parts of a student's account that aren't about the class's game —
// who they are, their login, their daily time limit and their family link
// — and so survive "Restart class". Everything else on the account is
// wiped back to how a brand-new student starts (see createStudentAccount).
const RESTART_KEEP_USER_FIELDS = [
  "username", "authUid", "role", "name", "classCode", "sessionVersion", "password",
  "dailyLimitMinutes", "timeSpentTodaySec", "timeSpentDate",
  "timeExemptionStatus", "timeExemptionDate", "timeExemptionRequestedAt",
  "extraMinutesToday", "extraMinutesDate", "parentViewToken"
];
const NEW_STUDENT_WELCOME = 20; // same welcome grant as createStudentAccount

// "Restart class": the class goes back to how a brand-new class with these
// same settings would start. Every setting stays (jobs, store, properties,
// companies, events, tax, quizzes...) and so does every student, but
// everything they did or own is wiped — the same reset a new class made
// from this one as a template gets (see _classDataFromTemplate), except
// prices stay where they are now. Each student goes back to a new
// student's starting point: the welcome grant and nothing else.
// Returns { ok, failed } — failed names students whose account couldn't
// be reset (running Restart again finishes them off).
async function resetClass(classCode, teacherUsername) {
  // Save a permanent report-card snapshot of exactly what's about to be
  // wiped — txns get cleared below and balances reset, so without this a
  // reset would silently erase the only record of the term that just
  // finished. Best-effort: a failed archive (e.g. offline) never blocks
  // the reset itself, since teachers may still need to restart the class.
  try { await archiveClassReport(classCode, teacherUsername); } catch (e) { /* proceed with reset regardless */ }
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, failed: [] };
  const students = await getClassStudents(classCode, cls);

  const fresh = _classDataFromTemplate(classCode, cls.name, cls.teacher, cls, { keepPrices: true });
  // The class's own identity, roster and saved report cards stay, and so
  // do today's market-day stamps (otherwise prices would move twice today).
  ["code", "name", "teacher", "students", "archived", "archivedAt", "templateShareToken", "reportArchives",
    "lastPropertyMarketDayRun"].forEach(k => { delete fresh[k]; });
  fresh.listings = [];
  fresh.lastTermDepositCheckDay = null;
  // A fresh createdAt marks where the new term's report-card period
  // should start counting from, same as when the class was first made.
  fresh.createdAt = Date.now();
  fresh.txns = students.map(s => ({
    id: uid("t"), type: "welcome", to: s.username, amount: NEW_STUDENT_WELCOME,
    note: "Welcome grant (class restarted)", date: nowStr(), ts: Date.now()
  }));
  await classesCol().doc(classCode).update(fresh);

  const failed = [];
  await Promise.all(students.map(async s => {
    try {
      const reportMonth = Object.assign(emptyReportBucket(), { monthKey: nzMonthKey() });
      const reportLifetime = emptyReportBucket();
      addClassificationToBucket(reportMonth, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: NEW_STUDENT_WELCOME });
      addClassificationToBucket(reportLifetime, { bucket: "income", category: REPORT_INCOME_TYPES.welcome, amount: NEW_STUDENT_WELCOME });
      const update = {
        balance: NEW_STUDENT_WELCOME, savings: 0, loans: [],
        jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null,
        reportMonth, reportLifetime
      };
      // Everything else they had (insurance, store items, deposits, side
      // hustle, gambling chips, life events, quiz results, savings goals...)
      // is removed outright — a new student simply doesn't have it yet.
      Object.keys(s).forEach(k => {
        if (!(k in update) && !RESTART_KEEP_USER_FIELDS.includes(k)) update[k] = firebase.firestore.FieldValue.delete();
      });
      await usersCol().doc(s.username).update(update);
    } catch (e) {
      console.warn("resetClass: couldn't reset " + s.username, e);
      failed.push(s.name || s.username);
    }
  }));
  return { ok: true, failed };
}

async function portfolioValue(username, classCode) {
  const cls = await getClassCached(classCode);
  if (!cls) return 0;
  let total = 0;
  cls.companies.forEach(co => {
    const shares = co.holders[username] || 0;
    total += shares * co.price;
  });
  return Math.round(total * 100) / 100;
}

// One-time backfill for accounts that already held shares before the
// all-time cost-basis feature existed — the reason most rows show
// "$0.00*" today: those buys never got recorded because there was
// nowhere to record them yet.
//
// This recovers whatever stock-buy history is STILL sitting in cls.txns
// and uses it to seed co.costBasis for those students. It is safe to run
// more than once (and safe to run while the class is live):
//   - It NEVER overwrites a costBasis entry that already exists — any
//     company a student has bought or sold since this feature shipped
//     already has real, exact tracking, which always wins.
//   - It only fills gaps for companies still held (0 shares = nothing to
//     seed).
//
// What this can and can't do — same shared-log limitation as always:
//   - CAN recover any stock-buy that's still in the (capped, class-wide)
//     transaction log for that student/company — reconstructs shares and
//     cost directly from it, no estimation involved.
//   - CANNOT recover a buy that has already scrolled off that shared,
//     200-entry log before this backfill ever ran. Those shares stay
//     exactly as honestly "unknown" as they were before — this narrows
//     how much of the roster is affected, it does not remove the
//     underlying limitation described in stockAllTimeGain() above.
//   - If the recovered buy total for a company is LESS than the shares
//     currently held (meaning some purchase history has already aged
//     out), only the recovered portion is seeded and stockAllTimeGain's
//     existing "partial tracking" detection marks that row incomplete
//     (*) exactly as it already does for any other partial case.
async function backfillCostBasisFromTxns(classCode) {
  const classRef = classesCol().doc(classCode);
  let filled = 0, alreadyTracked = 0;
  await fdb.runTransaction(async (t) => {
    filled = 0; alreadyTracked = 0; // reset every attempt — this callback can be retried
    const classSnap = await t.get(classRef);
    if (!classSnap.exists) throw new Error("NOT_FOUND");
    const cls = classSnap.data();
    const txns = cls.txns || [];

    // companyId -> username -> { shares, totalCost } from every
    // still-present stock-buy txn.
    const recovered = {};
    txns.forEach(tx => {
      if (tx.type !== "stock-buy" || !tx.companyId || !tx.from) return;
      if (!(tx.shares > 0) || !(tx.pricePerShare > 0)) return;
      recovered[tx.companyId] = recovered[tx.companyId] || {};
      const bucket = recovered[tx.companyId][tx.from] || { shares: 0, totalCost: 0 };
      bucket.shares += tx.shares;
      bucket.totalCost = Math.round((bucket.totalCost + tx.shares * tx.pricePerShare) * 100) / 100;
      recovered[tx.companyId][tx.from] = bucket;
    });

    cls.companies.forEach(co => {
      co.costBasis = co.costBasis || {};
      const byUser = recovered[co.id] || {};
      Object.keys(byUser).forEach(username => {
        if (co.costBasis[username]) { alreadyTracked++; return; } // real tracking always wins
        const owned = co.holders[username] || 0;
        if (owned <= 0) return; // nothing currently held — nothing to seed

        const r = byUser[username];
        // Can't attribute more recovered shares than are currently held
        // (the gap, if any, is exactly the part that already rolled off
        // the log — leave it as unknown rather than guess at it).
        const shares = Math.min(r.shares, owned);
        const totalCost = Math.round((r.totalCost * (shares / r.shares)) * 100) / 100;
        co.costBasis[username] = { shares, totalCost, totalBought: totalCost };
        filled++;
      });
    });

    t.update(classRef, { companies: cls.companies });
  });
  return { ok: true, filled, alreadyTracked };
}

// All-time stock gain/loss, broken out per company plus a portfolio-wide
// total: unrealized (current holdings vs what they cost) plus realized
// (profit/loss already locked in from past sells/delistings).
//
// Two sources feed this, because co.costBasis only started being written
// the day this feature shipped:
//   - UNREALIZED comes straight from co.costBasis, which every buyShares/
//     sellShares call keeps exact from now on (weighted-average cost,
//     same approach a real brokerage statement uses since individual
//     share lots aren't tracked separately).
//   - REALIZED comes from walking cls.txns for this student's stock-sell
//     and stock-close entries, which already carry a realizedGain field.
//     cls.txns is a SHARED, class-wide log capped at MAX_STORED_TXNS (200)
//     total, not 200 per student — so on an active class this rolls over
//     within days/weeks, and a sale from a while back can already be gone.
//
// PERCENT is total gain ÷ totalBought (cumulative money ever put into that
// company, tracked separately in co.costBasis and never reduced by a
// sale — see buyShares/sellShares). That's "return on everything ever
// invested here", not an annualized/time-weighted return; if the student
// never has a tracked buy for a company (only ever held pre-feature
// shares), pct is null rather than a fabricated number.
//
// `complete` (both per-company and overall) is false whenever the figure
// might be missing something no longer retrievable — legacy pre-feature
// shares with no recorded cost, or a transaction log full enough that
// older sales may have scrolled out — so the UI can say "at least"
// instead of implying a total that silently excludes lost history.
async function stockAllTimeGain(username, classCode) {
  const cls = await getClassCached(classCode);
  if (!cls) return { unrealized: 0, realized: 0, total: 0, complete: true, perCompany: {} };

  const txns = cls.txns || [];
  const logMayBeTruncated = txns.length >= MAX_STORED_TXNS;
  const perCompany = {}; // companyId -> { unrealized, realized, total, totalBought, pct, complete }

  let unrealized = 0;
  let anyUntracked = false;
  cls.companies.forEach(co => {
    const shares = co.holders[username] || 0;
    const basis = (co.costBasis && co.costBasis[username]) || null;

    // A holding with shares but no costBasis entry (or fewer tracked
    // shares than actually held) means some or all of those shares predate
    // this feature — bought before costBasis existed, so there's no
    // honest cost recorded for them. Only the tracked portion is valued
    // against its real cost; the untracked remainder is left out of
    // unrealized entirely (not guessed at) rather than pairing a partial
    // cost basis against the FULL share count and overstating the gain.
    let coUntracked = false;
    let coUnrealized = 0;
    if (shares > 0) {
      if (!basis || basis.shares <= 0) {
        coUntracked = true;
      } else {
        if (basis.shares < shares) coUntracked = true;
        const trackedShares = Math.min(basis.shares, shares);
        coUnrealized = trackedShares * co.price - basis.totalCost;
      }
    }
    unrealized += coUnrealized;
    if (coUntracked) anyUntracked = true;

    perCompany[co.id] = {
      unrealized: Math.round(coUnrealized * 100) / 100,
      realized: 0, // filled in from txns below
      totalBought: basis ? basis.totalBought : 0,
      _untracked: coUntracked, // stripped before returning
      // A sale reduces basis.totalCost proportionally but never reduces
      // totalBought, so totalCost < totalBought means a sale happened for
      // this company. Only then could an aged-out log entry hide realized
      // gain — a company never sold can't be affected by log truncation.
      _hasSold: !!basis && basis.totalBought - basis.totalCost > 0.01
    };
  });

  let realized = 0;
  txns.forEach(t => {
    if (t.realizedGain === undefined) return;
    const isMine = (t.type === "stock-sell" || t.type === "stock-close") && t.to === username;
    if (!isMine) return;
    realized += t.realizedGain;
    if (t.companyId && perCompany[t.companyId]) {
      perCompany[t.companyId].realized = Math.round((perCompany[t.companyId].realized + t.realizedGain) * 100) / 100;
    }
  });

  Object.keys(perCompany).forEach(id => {
    const b = perCompany[id];
    b.total = Math.round((b.unrealized + b.realized) * 100) / 100;
    b.pct = b.totalBought > 0 ? Math.round((b.total / b.totalBought) * 1000) / 10 : null;
    b.complete = !b._untracked && !(logMayBeTruncated && b._hasSold);
    delete b._untracked;
    delete b._hasSold;
  });
  const allComplete = Object.keys(perCompany).every(id => perCompany[id].complete);

  return {
    unrealized: Math.round(unrealized * 100) / 100,
    realized: Math.round(realized * 100) / 100,
    total: Math.round((unrealized + realized) * 100) / 100,
    complete: allComplete,
    perCompany
  };
}


// Value of everything a student has bought from the class store, counted
// toward net worth. Looks up each owned item's current listed price by id,
// so this works retroactively for purchases made before this feature
// existed — no need to backfill any data.
async function storeItemsValue(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return 0;
  let total = 0;
  (user.storeItems || []).forEach(itemId => {
    const item = cls.storeItems.find(i => i.id === itemId);
    if (item && item.countsNetWorth !== false) total += item.price;
  });
  return Math.round(total * 100) / 100;
}

/* ===================== Reports ===================== */
// Keeps the class doc from growing forever — same pattern as
// MAX_STORED_TXNS. ~2 years of weekly report cards before the oldest
// archive rolls off.
const MAX_REPORT_ARCHIVES = 104;

// Maps a transaction to a report-card bucket + human category label.
// Independent from bank.js's own statement rendering (which needs a
// literal +/- sign for every txn, including ones this treats as
// "neutral") — report cards care about WHERE money went (spent vs saved/
// invested vs earned), not just whether a number went up or down.
//
//   income   — money the student actually earned/received this period
//   saved    — money proactively set aside/invested (savings, stocks,
//              term deposits) — the numerator of "savings rate" below
//   spent    — money that left the student on consumption, debt service,
//              or losses — ranked to find the "biggest expense category"
//   borrowed — loan principal received; tracked separately since it's
//              debt, not income, and shouldn't inflate a savings rate
//   (returning null leaves a txn out of every bucket — e.g. a $0
//   store-gift, or a student's own savings-withdraw, which just moves
//   their own money and is neither earned nor spent)
const REPORT_INCOME_TYPES = {
  wage: "Wages", interest: "Interest earned", "cash-interest": "Interest earned",
  bonus: "Bonuses", "side-hustle": "Side hustle", "truck-drive": "Side hustle",
  "property-rent": "Rent received", "property-rent-receive": "Rent received", "insurance-claim": "Insurance claims",
  "stock-sell": "Asset sales", "stock-close": "Asset sales", "property-sell": "Asset sales",
  "vehicle-sell": "Asset sales", "store-sell": "Asset sales", "p2p-sell": "Asset sales",
  "quiz-reward": "Bonuses",
  "term-deposit-mature": "Term deposit returns", "term-deposit-early": "Term deposit returns",
  "life-allowance": "Life allowance",
  welcome: "Welcome bonus"
};
const REPORT_SAVED_TYPES = {
  "savings-deposit": "Savings account", "stock-buy": "Stocks", "term-deposit-open": "Term deposits"
};
const REPORT_SPENT_TYPES = {
  "store-buy": "Store purchases", "p2p-buy": "Bought from classmates",
  "vehicle-buy": "Transport", "truck-licence-buy": "Transport",
  // The recurring weekly transport charge (vehicle upkeep + public
  // transport fee, see payTransportExpenses) — same "Transport" category
  // as the one-off purchases above, since from the student's point of
  // view it's all money going out on getting around.
  "transport-expense": "Transport",
  "property-buy": "Housing", "mortgage": "Housing", "property-rent-pay": "Housing", "insurance-buy": "Insurance",
  "insurance-signup-fee": "Insurance", "loan-repayment": "Loan repayments",
  "loan-interest": "Loan interest", fine: "Fines"
};

function classifyTxnForReport(t, username) {
  const amt = Math.round(Math.abs(Number(t.amount) || 0) * 100) / 100;
  if (!amt) return null; // $0 txns (store-gift, unclaimed insurance signup, etc.)
  // A sale (or an insurance write-off) that left the student owing — the
  // mortgage still to pay off was more than the house fetched — is money
  // out, not income.
  if (t.type === "property-sell" && Number(t.amount) < 0) return { bucket: "spent", category: "Housing", amount: amt };

  if (REPORT_INCOME_TYPES[t.type]) return { bucket: "income", category: REPORT_INCOME_TYPES[t.type], amount: amt };
  if (REPORT_SAVED_TYPES[t.type]) return { bucket: "saved", category: REPORT_SAVED_TYPES[t.type], amount: amt };
  if (REPORT_SPENT_TYPES[t.type]) return { bucket: "spent", category: REPORT_SPENT_TYPES[t.type], amount: amt };
  if (t.type === "loan-taken") return { bucket: "borrowed", category: "Loans taken", amount: amt };

  // Gambling always logs `from: username` regardless of outcome (see
  // placeRouletteBet/bjSettle) — win/loss only lives in the note text.
  if (t.type === "gambling") {
    const won = (t.note || "").includes("WON");
    return won ? { bucket: "income", category: "Gambling winnings", amount: amt }
               : { bucket: "spent", category: "Gambling losses", amount: amt };
  }
  // A one-off life-event payment always logs `to: student`, but the
  // teacher can set a NEGATIVE one-off amount (a life event that costs
  // money rather than pays out — see sanitizeLifeBenefits/grantLifeItem),
  // so the sign of `amount` is what says which way it went, exactly like
  // small weekly events just below.
  if (t.type === "life-grant") {
    return t.amount < 0 ? { bucket: "spent", category: "Life events", amount: amt }
                        : { bucket: "income", category: "Life events", amount: amt };
  }
  // Small weekly events always log `to: student`, with the sign of
  // `amount` (not to/from) telling a windfall from a loss.
  if (t.type === "event") {
    return t.amount < 0 ? { bucket: "spent", category: "Random events", amount: amt }
                         : { bucket: "income", category: "Random events", amount: amt };
  }
  // Big events, unlike small ones, DO use to/from to mean windfall vs
  // cost (see processWeeklyBigEvents / resolveBigEvent).
  if (t.type === "big-event") {
    if (t.to === username) return { bucket: "income", category: "Random events", amount: amt };
    if (t.from === username) return { bucket: "spent", category: "Random events", amount: amt };
    return null;
  }
  if (t.type === "transfer" || t.type === "automation") {
    if (t.to === username) return { bucket: "income", category: "Received from classmates", amount: amt };
    if (t.from === username) return { bucket: "spent", category: "Sent to classmates", amount: amt };
    return null;
  }
  // savings-withdraw, gambling-buyin/-cashout and property-occupancy all
  // just move the student's own money between their own pockets, and
  // store-gift/life-revoke are always $0 — none of them is earned, saved
  // or spent, so they stay out of every bucket, same as any future or
  // unknown type.
  return null;
}

// Builds one student's report-card data. Net worth fields are a live
// snapshot (a point in time). Income/saved/spent fields cover THIS NZ
// CALENDAR MONTH, read from the rolling totals recordReportActivity() keeps
// on the student's own doc (see above) rather than scanning cls.txns —
// that log is shared class-wide and capped, so it can't be trusted to
// still hold a full month's activity. If the stored bucket is from an
// earlier month (or doesn't exist yet, e.g. a student who joined before
// this feature shipped), it's treated as empty rather than shown stale —
// it starts filling in from their next transaction.
function buildStudentReportData(student, cls) {
  const username = student.username;
  const monthKey = nzMonthKey();
  const storedMonth = (student.reportMonth && student.reportMonth.monthKey === monthKey)
    ? student.reportMonth : emptyReportBucket();
  const storedLifetime = student.reportLifetime || emptyReportBucket();
  // The rolling totals only count forward from when they shipped, so any
  // activity from before that (or a recordReportActivity that failed) is
  // missing from them. cls.txns still holds whatever recent history wasn't
  // capped off, so rebuild buckets from it too and take the larger figure
  // per category — both are undercounts of the truth, so the max never
  // double-counts, and it's a pure read (nothing is written back).
  const scanMonth = emptyReportBucket(), scanLifetime = emptyReportBucket();
  (cls.txns || []).forEach(t => {
    if (!txnBelongsTo(t, username)) return;
    const c = classifyTxnForReport(t, username);
    if (!c) return;
    addClassificationToBucket(scanLifetime, c);
    if (t.ts && nzMonthKey(new Date(t.ts)) === monthKey) addClassificationToBucket(scanMonth, c);
  });
  const month = mergeReportBuckets(storedMonth, scanMonth);
  const lifetime = mergeReportBuckets(storedLifetime, scanLifetime);

  const income = month.income, saved = month.saved, spent = month.spent;
  const incomeTotal = month.incomeTotal, savedTotal = month.savedTotal,
        spentTotal = month.spentTotal, borrowedTotal = month.borrowedTotal;
  const topExpense = Object.entries(spent).sort((a, b) => b[1] - a[1])[0] || null;

  // Loan history lives permanently on the student doc (never capped like
  // txns), so this is always complete regardless of the txn window above.
  const loans = (student.loans || []).map(l => ({
    id: l.id, principal: l.principal, rate: l.rate, termWeeks: l.termWeeks,
    takenDate: l.takenDate, dueDate: l.dueDate, status: l.status, owed: l.owed,
    paidDate: l.paidDate || null,
    onTime: l.status === "paid" ? (l.paidDate ? l.paidDate <= l.dueDate : null) : null
  }));

  // Current net worth snapshot — same breakdown as classLeaderboard().
  let invested = 0;
  (cls.companies || []).forEach(co => { invested += (co.holders[username] || 0) * co.price; });
  let storeValue = 0;
  (student.storeItems || []).forEach(itemId => {
    const item = (cls.storeItems || []).find(i => i.id === itemId);
    if (item && item.countsNetWorth !== false) storeValue += item.price;
  });
  let propertyValue = 0, mortgageOwed = 0;
  (cls.properties || []).forEach(p => {
    if (p.owner !== username) return;
    propertyValue += p.price;
    if (p.mortgage) mortgageOwed += (p.mortgage.weeklyPayment || 0) * (p.mortgage.weeksLeft || 0);
  });
  let vehicleValue = 0;
  (cls.vehicles || []).forEach(v => { if ((v.owners || []).includes(username)) vehicleValue += v.price; });
  const savings = student.savings || 0;
  const termDeposits = (student.termDeposits || []).reduce((s, d) => s + d.amount, 0);
  const activeLoanOwed = loans.filter(l => l.status === "active").reduce((s, l) => s + l.owed, 0);
  const owed = Math.round((activeLoanOwed + mortgageOwed) * 100) / 100;
  // Gambling account balance counts toward net worth (same as
  // classLeaderboard()) but isn't broken out as its own field below.
  const gamblingBalance = gamblingAccountToday(student).balance;
  const netWorth = Math.round((student.balance + invested + storeValue + propertyValue + vehicleValue + savings + termDeposits + gamblingBalance - owed) * 100) / 100;

  return {
    username, name: student.name,
    netWorth, balance: Math.round(student.balance * 100) / 100, savings: Math.round(savings * 100) / 100,
    invested: Math.round(invested * 100) / 100, storeValue: Math.round(storeValue * 100) / 100,
    propertyValue: Math.round(propertyValue * 100) / 100, vehicleValue: Math.round(vehicleValue * 100) / 100,
    termDeposits: Math.round(termDeposits * 100) / 100, owed,
    incomeTotal: Math.round(incomeTotal * 100) / 100,
    savedTotal: Math.round(savedTotal * 100) / 100,
    spentTotal: Math.round(spentTotal * 100) / 100,
    borrowedTotal: Math.round(borrowedTotal * 100) / 100,
    // Percent of income that got saved/invested rather than spent, to 1dp.
    // Null (not 0) when there was no income at all this period, so the UI
    // can show "—" instead of a misleading 0%.
    savingsRate: incomeTotal > 0 ? Math.round((savedTotal / incomeTotal) * 1000) / 10 : null,
    income, saved, spent,
    topExpenseCategory: topExpense ? { category: topExpense[0], amount: topExpense[1] } : null,
    loans,
    // Entire history — never reset, see recordReportActivity above.
    lifetimeIncome: lifetime.income, lifetimeSaved: lifetime.saved, lifetimeSpent: lifetime.spent,
    lifetimeIncomeTotal: lifetime.incomeTotal, lifetimeSavedTotal: lifetime.savedTotal,
    lifetimeSpentTotal: lifetime.spentTotal, lifetimeBorrowedTotal: lifetime.borrowedTotal
  };
}

// Computes a live, unsaved report for the whole class covering the current
// NZ calendar month so far. Safe to call as often as you like — this never
// writes anything, so viewing it doesn't cost a class its "next" period.
async function generateClassReport(classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return null;
  const students = await getClassStudents(classCode, cls);
  const periodStart = dateKeyToUTC(nzMonthKey() + "-01");
  return {
    classCode, className: cls.name, periodStart, periodEnd: Date.now(),
    students: students.map(s => buildStudentReportData(s, cls))
  };
}

// Permanently saves the current live report as an archive entry, so it
// survives future activity rolling old txns off the class doc (and
// survives resetClass(), which calls this automatically before wiping
// anything). Can also be triggered manually from the Reports page at any
// time — e.g. "save this week's report cards" without resetting the class.
async function archiveClassReport(classCode, generatedBy) {
  const report = await generateClassReport(classCode);
  if (!report) return null;
  const entry = {
    id: uid("report"), date: nowStr(), ts: Date.now(),
    generatedBy: generatedBy || null,
    periodStart: report.periodStart, periodEnd: report.periodEnd,
    students: report.students
  };
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = snap.data();
    const archives = (liveCls.reportArchives || []).concat([entry]);
    if (archives.length > MAX_REPORT_ARCHIVES) archives.splice(0, archives.length - MAX_REPORT_ARCHIVES);
    t.update(classRef, { reportArchives: archives });
  });
  return entry;
}

async function getReportArchives(classCode) {
  const cls = await getClassCached(classCode);
  return (cls && cls.reportArchives) || [];
}

async function deleteReportArchive(classCode, archiveId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.reportArchives = (cls.reportArchives || []).filter(a => a.id !== archiveId);
    t.update(classRef, { reportArchives: cls.reportArchives });
  });
  return true;
}

/* ---------------- Rolling per-student report totals ----------------
   "This month" and "entire history" can't be built by re-scanning
   cls.txns the way the old "since the last save" report was: that log is
   ONE SHARED list for the whole class, capped at MAX_STORED_TXNS — a busy
   class can push transactions off that cap well within a single month, at
   which point they'd silently vanish from a month-scoped report, and a
   lifetime total would be wrong from day one.

   Instead, every transaction ALSO updates two small totals kept on the
   STUDENT'S OWN doc (not the shared, capped class doc), the instant it
   happens — see recordReportActivity, called from logTxn:
     - reportMonth    — this NZ calendar month only. Lazily reset to zero
                         the first time an txn lands after the month has
                         turned over (same "compare a stored date key,
                         reset if stale" pattern already used for
                         timeExemptionDate/extraMinutesDate elsewhere in
                         this file) — nothing proactively resets it at
                         midnight, and nothing ever auto-saves it.
     - reportLifetime — every month since the student joined, or since
                         the class was last restarted (resetClass starts
                         everyone again like a new student — the term
                         that's ending is saved as a report card first).
   Both reuse the exact same categorisation as classifyTxnForReport/
   txnBelongsTo above, so a txn is counted here if and only if the old
   scan would have counted it too. This is purely additive: cls.txns,
   generateClassReport's net-worth/loan fields, and the whole archive
   feature are unchanged.

   Caveat this can't get around: it only counts forward from the moment
   it ships. A class with existing history won't have it retroactively
   added to "lifetime" — there was nowhere recording it before now. */
function emptyReportBucket() {
  return { income: {}, saved: {}, spent: {}, incomeTotal: 0, savedTotal: 0, spentTotal: 0, borrowedTotal: 0 };
}

// Per-category max of two buckets, with totals recomputed from the merged
// categories (see buildStudentReportData for why max rather than sum).
function mergeReportBuckets(a, b) {
  const out = emptyReportBucket();
  ["income", "saved", "spent"].forEach(k => {
    const keys = new Set([...Object.keys(a[k] || {}), ...Object.keys(b[k] || {})]);
    keys.forEach(cat => { out[k][cat] = Math.max((a[k] || {})[cat] || 0, (b[k] || {})[cat] || 0); });
    const sum = Object.values(out[k]).reduce((s, v) => s + v, 0);
    out[k + "Total"] = Math.round(Math.max(sum, a[k + "Total"] || 0, b[k + "Total"] || 0) * 100) / 100;
  });
  out.borrowedTotal = Math.max(a.borrowedTotal || 0, b.borrowedTotal || 0);
  return out;
}

function addClassificationToBucket(bucket, c) {
  if (c.bucket === "borrowed") {
    bucket.borrowedTotal = Math.round(((bucket.borrowedTotal || 0) + c.amount) * 100) / 100;
    return;
  }
  const map = bucket[c.bucket]; // "income" | "saved" | "spent"
  map[c.category] = Math.round(((map[c.category] || 0) + c.amount) * 100) / 100;
  const totalKey = c.bucket + "Total";
  bucket[totalKey] = Math.round(((bucket[totalKey] || 0) + c.amount) * 100) / 100;
}

// "YYYY-MM" in NZ wall-clock time — the reset key for reportMonth, same
// convention as nzDateKey()'s "YYYY-MM-DD" just above.
function nzMonthKey(d) { const p = nzParts(d); return `${p.year}-${p.month}`; }

// Applies one txn's effect (if any) to a single student's rolling report
// totals. Safe to call for any (txn, username) pair, including ones the
// txn has nothing to do with — txnBelongsTo/classifyTxnForReport make it a
// no-op unless this leg of the txn actually belongs to this student.
// Wrapped in try/catch and never thrown back to the caller: a reporting
// hiccup here must never surface as a failure of the money action that
// already committed in logTxn before this runs.
async function recordReportActivity(username, txn) {
  if (!username || !txnBelongsTo(txn, username)) return;
  const c = classifyTxnForReport(txn, username);
  if (!c) return;
  const userRef = usersCol().doc(username);
  const monthKey = nzMonthKey();
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) return; // e.g. student removed mid-flight — nothing to update
      const u = snap.data();
      const month = (u.reportMonth && u.reportMonth.monthKey === monthKey)
        ? u.reportMonth
        : Object.assign(emptyReportBucket(), { monthKey });
      const lifetime = u.reportLifetime || emptyReportBucket();
      addClassificationToBucket(month, c);
      addClassificationToBucket(lifetime, c);
      t.update(userRef, { reportMonth: month, reportLifetime: lifetime });
    });
  } catch (e) {
    console.warn("recordReportActivity failed (rolling report totals only — money already moved):", e);
  }
}

/* ===================== Tax ===================== */
async function classesColUpdateInsuranceDay(classCode, day) {
  await classesCol().doc(classCode).update({ insuranceDay: day });
}

async function saveTaxRates(classCode, rates) {
  const clean = {};
  Object.keys(rates).forEach(k => { clean[k] = Math.max(0, Number(rates[k]) || 0); });
  await classesCol().doc(classCode).update({ taxRates: clean });
}
// For purchases: student pays base cost + tax on top.
function applyTaxToExpense(cls, category, baseAmount) {
  const rate = (cls.taxRates && cls.taxRates[category]) || 0;
  const taxAmount = Math.round(baseAmount * (rate / 100) * 100) / 100;
  return { total: Math.round((baseAmount + taxAmount) * 100) / 100, taxAmount, rate };
}
// For income: student receives base amount minus tax.
function applyTaxToIncome(cls, category, baseAmount) {
  const rate = (cls.taxRates && cls.taxRates[category]) || 0;
  const taxAmount = Math.round(baseAmount * (rate / 100) * 100) / 100;
  return { net: Math.round((baseAmount - taxAmount) * 100) / 100, taxAmount, rate };
}
// Wages use marginal tax brackets instead of a single flat rate, same idea
// as real-life progressive income tax: each bracket's rate only applies to
// the slice of the wage that falls within that bracket, not the whole wage.
// Brackets are stored sorted ascending as { upTo, rate }, where upTo is the
// top of that bracket (null/undefined = no upper limit, i.e. the top bracket).
function applyWageTax(cls, wage) {
  const brackets = (cls.wageTaxBrackets || []).slice().sort((a, b) => {
    const aTop = a.upTo == null ? Infinity : a.upTo;
    const bTop = b.upTo == null ? Infinity : b.upTo;
    return aTop - bTop;
  });
  if (!brackets.length || wage <= 0) {
    return { net: Math.round(wage * 100) / 100, taxAmount: 0, rate: 0 };
  }
  let taxAmount = 0;
  let bandFloor = 0;
  for (const b of brackets) {
    const bandTop = b.upTo == null ? Infinity : Number(b.upTo);
    const bandAmount = Math.max(0, Math.min(wage, bandTop) - bandFloor);
    taxAmount += bandAmount * ((Number(b.rate) || 0) / 100);
    bandFloor = bandTop;
    if (wage <= bandTop) break;
  }
  taxAmount = Math.round(taxAmount * 100) / 100;
  const effectiveRate = wage > 0 ? Math.round((taxAmount / wage) * 10000) / 100 : 0;
  return { net: Math.round((wage - taxAmount) * 100) / 100, taxAmount, rate: effectiveRate };
}
async function saveWageTaxBrackets(classCode, brackets) {
  const clean = (brackets || [])
    .map(b => ({
      upTo: (b.upTo === null || b.upTo === "" || b.upTo === undefined) ? null : Math.max(0, Number(b.upTo) || 0),
      rate: Math.max(0, Number(b.rate) || 0)
    }))
    .sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo));
  await classesCol().doc(classCode).update({ wageTaxBrackets: clean });
}

/* ===================== Budgeting tool =====================
   Every other module in this app is a decision made in the moment: take
   the loan, buy the car, put the money in savings. The budget asks a
   student to look at a whole week (Monday to Sunday) at once and decide in
   advance where their money is going.

   The app already knows almost everything about a student's week, so the
   budget works it out for them rather than asking them to type it in:

     1. Money coming in — wages (after tax and any life-event boost),
        life-event allowances, rent from their tenants, automatic payments
        to them — each on the day it arrives (budgetWeekItems).
     2. Bills — mortgage, rent, transport, loans falling due, their own
        automatic payments — each on its due day, and whether it's been
        paid yet.
     3. What actually happened this week, read from cls.txns: extra money
        in (side hustle, bonuses, sales...), spending, surprise costs, and
        what they put away (budgetWeekActuals).

   The one thing the student decides is how much to save each week
   (user.budget.saveAmount, kept until they change it). Whatever's left
   after bills and saving is their spending money for the week. The page
   then shows how the week is going against that, a day-by-day list, and
   how much they can safely spend right now without a bill bouncing.

   Nothing here moves money or blocks anything — overspending your own
   plan is allowed; being shown that you did is the lesson. Everything
   except saveBudget()/clearBudget() is pure over data the page has already
   loaded, so showing the budget costs no extra reads.
========================================================================= */

// Monday of the current NZ week, as a date key. isoWeekKey() groups
// payments into Mon-Sun weeks, so the budget week starts on the same
// Monday as the mortgage/rent/transport cycles it's built from.
function budgetWeekStartKey(d) {
  const isoIdx = (DAY_NAMES.indexOf(nzDayName(d)) + 6) % 7; // Mon = 0 ... Sun = 6
  return dateKeyPlusDays(nzDateKey(d), -isoIdx);
}
// "Mon".."Sun" -> 0..6 (Monday first), or -1.
function budgetDayIndex(dayName) {
  const i = DAY_NAMES.indexOf(dayName);
  return i < 0 ? -1 : (i + 6) % 7;
}
function budgetRound(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// "Monday".."Sunday" for a date key.
function budgetDayWord(dayKey) { return DAY_FULL[DAY_NAMES[new Date(dateKeyToUTC(dayKey)).getUTCDay()]] || ""; }

// When an automatic payment goes out this week, mirroring _autoIsDue: its
// date key and whether it already has, or null if it doesn't go out this
// week (a fortnightly one in its off week, say).
function budgetAutoThisWeek(a, weekStartKey) {
  const weekEndKey = dateKeyPlusDays(weekStartKey, 6);
  if (a.lastRun && a.lastRun >= weekStartKey && a.lastRun <= weekEndKey) return { dayKey: a.lastRun, done: true };
  if (!a.active) return null;
  const idx = budgetDayIndex(a.dayOfWeek);
  if (idx < 0) return null;
  const dayKey = dateKeyPlusDays(weekStartKey, idx);
  if (a.lastRun && daysBetweenKeys(a.lastRun, dayKey) < (FREQ_DAYS[a.frequency] || 7)) return null;
  return { dayKey, done: false };
}

// Where something on a given day stands right now.
//   done     — already paid / already arrived
//   today    — due today, not yet
//   upcoming — later this week
//   missed   — its day has passed and it never happened. Mortgages, rent
//              and transport can only be paid on their day, so a missed one
//              won't cost anything now (the teacher sees it as overdue) —
//              it's left out of the week's totals.
//   overdue  — a loan past its due date: still owed, payable any time
//   free     — a move-in/purchase week, when nothing is owed
function budgetStatus(dayKey, todayKey, done) {
  if (done) return "done";
  if (dayKey < todayKey) return "missed";
  return dayKey === todayKey ? "today" : "upcoming";
}
const BUDGET_COUNTED = ["done", "today", "upcoming", "overdue", "daily"];

/* ---------------- The week's schedule ----------------
   Everything that regularly comes in or goes out this week, each as
   { key, dir: "in"|"out"|"save", label, icon, amount, dayKey (null = every
   day), status, note, where }. Built from the same functions that actually
   pay or charge each thing, so the amounts here are what really happens. */
function budgetWeekItems(cls, user, username) {
  const items = [];
  const weekKey = isoWeekKey(new Date());
  const weekStartKey = budgetWeekStartKey();
  const weekEndKey = dateKeyPlusDays(weekStartKey, 6);
  const todayKey = nzDateKey();
  const inWeek = k => !!k && k >= weekStartKey && k <= weekEndKey;
  const dayOf = dayName => {
    const idx = budgetDayIndex(dayName || "Fri");
    return dateKeyPlusDays(weekStartKey, idx < 0 ? 4 : idx);
  };
  const dayWord = budgetDayWord;
  const me = Object.assign({}, user, { username });

  /* ---- Money coming in ---- */
  const job = user.jobId ? (cls.jobs || []).find(j => j.id === user.jobId) : null;
  if (job && cls.payDay) {
    const credit = wageCreditEstimate(cls, user);
    const dayKey = dayOf(cls.payDay);
    const status = budgetStatus(dayKey, todayKey, inWeek(user.lastWagePaid));
    const approved = isJobTaskApprovedThisWeek(user, cls);
    if (credit.net > 0) {
      items.push({
        key: "wage", dir: "in", icon: "briefcase", label: "Wages — " + credit.tierLabel, amount: credit.net, dayKey, status,
        note: status === "done" ? "Paid"
          : status === "missed" ? "Not paid this week — your job task wasn't approved by pay day"
          : (approved ? "Pay day" : "Pay day — only once your teacher approves this week's job task")
            + (credit.taxAmount > 0 ? ` (${fmtMoney(credit.taxAmount)} tax already taken off)` : "")
      });
    }
  }
  const weeklyAllowance = getLifeAllowanceByFrequency(user, "weekly");
  if (weeklyAllowance > 0 && cls.payDay) {
    const dayKey = dayOf(cls.payDay);
    const status = budgetStatus(dayKey, todayKey, inWeek(user.lastLifeAllowanceWeeklyPaid));
    items.push({ key: "allowance-weekly", dir: "in", icon: "trophy", label: "Life event allowance", amount: weeklyAllowance, dayKey, status,
      note: status === "done" ? "Paid" : status === "missed" ? "Not paid this week" : "Paid on pay day" });
  }
  const dailyAllowance = getLifeAllowanceByFrequency(user, "daily");
  if (dailyAllowance > 0) {
    items.push({ key: "allowance-daily", dir: "in", icon: "trophy", label: "Life event allowance", amount: budgetRound(dailyAllowance * 7), dayKey: null, status: "daily",
      perDay: dailyAllowance, note: `${fmtMoney(dailyAllowance)} a day` });
  }
  (cls.properties || []).forEach(p => {
    if (p.owner !== username) return;
    if (p.occupancy === "rented" && p.rentPerWeek > 0) {
      const dayKey = dayOf(p.rentDay);
      const status = budgetStatus(dayKey, todayKey, p.rentLastWeekPaid === weekKey);
      items.push({ key: "rent-in-" + p.id, dir: "in", icon: "house", label: "Rent from " + p.name, amount: budgetRound(p.rentPerWeek), dayKey, status,
        note: status === "done" ? "Paid" : status === "missed" ? "Not paid this week" : "Paid to you automatically" });
    }
    if (p.sublet && p.sublet.tenant && p.sublet.price > 0) {
      const dayKey = dayOf(p.rentDay);
      const free = p.sublet.leaseStartWeekKey === weekKey;
      const status = free ? "free" : budgetStatus(dayKey, todayKey, p.sublet.rentLastWeekPaid === weekKey);
      items.push({ key: "sublet-in-" + p.id, dir: "in", icon: "house", label: "Rent from your tenant — " + p.name, amount: budgetRound(p.sublet.price), dayKey, status,
        note: free ? "Their first week is free" : status === "done" ? "Paid" : status === "missed" ? "Your tenant didn't pay this week" : "Your tenant pays this on " + dayWord(dayKey) });
    }
  });
  (cls.automations || []).forEach(a => {
    if (!a.active && !a.lastRun) return;
    if (a.type === "savings-transfer" || a.studentUser === username) return;
    const fromTeacher = a.studentUser === cls.teacher;
    if (a.toUser !== username && !(a.toUser === AUTOPAY_ALL_STUDENTS && fromTeacher)) return;
    const when = budgetAutoThisWeek(a, weekStartKey);
    if (!when || !(Number(a.amount) > 0)) return;
    const status = budgetStatus(when.dayKey, todayKey, when.done);
    items.push({ key: "auto-in-" + a.id, dir: "in", icon: "repeat", label: a.note || "Automatic payment", amount: budgetRound(a.amount), dayKey: when.dayKey, status,
      note: (fromTeacher ? "From your teacher" : "From a classmate (if they have the money)") + (status === "missed" ? " — didn't arrive this week" : "") });
  });

  /* ---- Bills ---- */
  (cls.properties || []).forEach(p => {
    if (p.owner !== username || !p.mortgage || !(p.mortgage.weeksLeft > 0)) return;
    const forced = cls.mortgageForceDueWeek === weekKey;
    const done = p.mortgage.lastWeekPaid === weekKey;
    const free = p.mortgage.purchaseWeekKey === weekKey;
    const dayKey = forced && !done ? todayKey : dayOf(cls.mortgageDay);
    const status = free ? "free" : budgetStatus(dayKey, todayKey, done);
    items.push({ key: "mortgage-" + p.id, dir: "out", icon: "house", label: "Mortgage — " + p.name, amount: mortgageWeekAmount(p.mortgage).total, dayKey, status,
      where: "Property",
      note: free ? "The week you bought it is free" : status === "done" ? "Paid"
        : status === "missed" ? "Missed — it can only be paid on its day"
        : (forced ? "Your teacher has made it due now" : "You pay it on the Property page") });
  });
  const tenancies = [];
  (cls.properties || []).forEach(p => {
    if (p.sublet && p.sublet.tenant === username) tenancies.push({ id: p.id, name: p.name, amount: p.sublet.price, rentDay: p.rentDay, start: p.sublet.leaseStartWeekKey, paid: p.sublet.rentLastWeekPaid });
  });
  (cls.npcProperties || []).forEach(u => {
    if (u.tenant === username) tenancies.push({ id: u.id, name: u.name, amount: u.rentPerWeek, rentDay: u.rentDay, start: u.leaseStartWeekKey, paid: u.rentLastWeekPaid });
  });
  tenancies.forEach(r => {
    if (!(r.amount > 0)) return;
    const dayKey = dayOf(r.rentDay);
    const free = r.start === weekKey;
    const status = free ? "free" : budgetStatus(dayKey, todayKey, r.paid === weekKey);
    items.push({ key: "rent-" + r.id, dir: "out", icon: "house", label: "Rent — " + r.name, amount: budgetRound(r.amount), dayKey, status, where: "Property",
      note: free ? "The week you moved in is free" : status === "done" ? "Paid"
        : status === "missed" ? "Missed — rent can only be paid on its day" : "You pay it on the Property page" });
  });
  const transport = transportWeeklyAmount(cls, me);
  if (transport.total > 0) {
    const dayKey = dayOf(cls.transportDay);
    const status = budgetStatus(dayKey, todayKey, user.transportLastWeekPaid === weekKey);
    items.push({ key: "transport", dir: "out", icon: "car", label: "Transport", amount: transport.total, dayKey, status, where: "Transport",
      note: status === "done" ? "Paid" : status === "missed" ? "Missed — it can only be paid on its day" : "You pay it on the Transport page" });
  }
  (user.loans || []).forEach(l => {
    if (l.status !== "active" || !l.dueDate || l.dueDate > weekEndKey || !(l.owed > 0)) return;
    const overdue = l.dueDate < todayKey;
    items.push({ key: "loan-" + l.id, dir: "out", icon: "handshake", label: "Loan to repay", amount: budgetRound(l.owed),
      dayKey: overdue ? todayKey : l.dueDate, status: overdue ? "overdue" : budgetStatus(l.dueDate, todayKey, false), where: "Loans",
      note: overdue ? "Overdue — repay it on the Loans page" : "Due " + (l.dueDate === todayKey ? "today" : dayWord(l.dueDate)) + " — repay it on the Loans page" });
  });
  (cls.automations || []).forEach(a => {
    if (a.studentUser !== username || a.type === "savings-transfer") return;
    const when = budgetAutoThisWeek(a, weekStartKey);
    if (!when || !(Number(a.amount) > 0)) return;
    const status = budgetStatus(when.dayKey, todayKey, when.done);
    items.push({ key: "auto-" + a.id, dir: "out", icon: "repeat", label: a.note || "Automatic payment", amount: budgetRound(a.amount), dayKey: when.dayKey, status,
      note: status === "done" ? "Paid" : status === "missed" ? "Didn't go out — not enough cash on the day"
        : "Goes out by itself" + (a.toUser === cls.teacher ? ", to your teacher" : "") });
  });

  /* ---- Automatic saving (not bills: it's their own money, moved) ---- */
  (cls.automations || []).forEach(a => {
    if (a.studentUser !== username || a.type !== "savings-transfer") return;
    const when = budgetAutoThisWeek(a, weekStartKey);
    if (!when || !(Number(a.amount) > 0)) return;
    const status = budgetStatus(when.dayKey, todayKey, when.done);
    const toSavings = a.direction === "toSavings";
    items.push({ key: "save-" + a.id, dir: toSavings ? "save" : "unsave", icon: "piggy",
      label: toSavings ? "Automatic transfer to savings" : "Automatic transfer from savings", amount: budgetRound(a.amount), dayKey: when.dayKey, status,
      note: status === "done" ? "Done" : status === "missed" ? "Didn't happen — not enough money on the day" : "Happens by itself" });
  });

  return { items, weekKey, weekStartKey, weekEndKey, todayKey };
}

/* ---------------- What actually happened this week ----------------
   This week's transactions, sorted into what the plan cares about:
     extra     — money in that isn't part of the schedule above (side
                 hustle, bonuses, selling things, refunds, winnings...)
     purchases — spending the student chose (store, trades, vehicles,
                 property deposits, sending money, gambling buy-ins...)
     surprises — costs they didn't choose (fines, random events, big events)
     saved     — put into savings, term deposits or shares, minus anything
                 taken back out (so moving money in and out again isn't
                 "saving")
   Scheduled things (wages, rent, bills, automatic payments) are left out
   here — their status in the schedule already says whether they happened. */
const BUDGET_EXTRA_LABELS = {
  "side-hustle": "Side hustle", "truck-drive": "Truck driving", bonus: "Bonuses", "quiz-reward": "Quiz rewards",
  "insurance-claim": "Insurance claims", "cash-interest": "Interest", welcome: "Welcome grant",
  "store-sell": "Things you sold", "vehicle-sell": "Things you sold", "p2p-sell": "Things you sold", "property-sell": "Things you sold",
  transfer: "Money from others", event: "Random events", "big-event": "Big events", "life-grant": "Life events"
};
function budgetWeekActuals(cls, username, weekStartKey) {
  const extra = {}, purchases = {}, surprises = {};
  let saved = 0, gambleIn = 0, gambleOut = 0, count = 0;
  const add = (map, label, amt) => { map[label] = budgetRound((map[label] || 0) + amt); };
  (cls.txns || []).forEach(t => {
    if (!txnBelongsTo(t, username)) return;
    // Compare NZ date keys: the week rolls over at NZ midnight.
    if (t.ts === undefined || nzDateKey(new Date(t.ts)) < weekStartKey) return;
    const amt = budgetRound(Math.abs(Number(t.amount) || 0));
    if (!amt) return;
    const neg = Number(t.amount) < 0;
    const out = t.from === username;
    count++;
    switch (t.type) {
      case "side-hustle": case "truck-drive": case "bonus": case "quiz-reward": case "insurance-claim":
      case "cash-interest": case "welcome": case "store-sell": case "vehicle-sell": case "p2p-sell":
        add(extra, BUDGET_EXTRA_LABELS[t.type], amt); break;
      case "property-sell":
        // A sale that left them owing (big mortgage) is money out.
        if (neg) add(purchases, "Housing", amt); else add(extra, BUDGET_EXTRA_LABELS[t.type], amt);
        break;
      case "transfer":
        if (out) add(purchases, "Money you sent", amt); else if (t.to === username) add(extra, BUDGET_EXTRA_LABELS.transfer, amt);
        break;
      case "event": case "life-grant":
        if (neg) add(surprises, BUDGET_EXTRA_LABELS[t.type], amt); else add(extra, BUDGET_EXTRA_LABELS[t.type], amt);
        break;
      case "big-event":
        if (out) add(surprises, "Big events", amt); else if (t.to === username) add(extra, "Big events", amt);
        break;
      case "fine": add(surprises, "Fines", amt); break;
      case "store-buy": add(purchases, "Store", amt); break;
      case "p2p-buy": add(purchases, "Trade Centre", amt); break;
      case "vehicle-buy": case "truck-licence-buy": add(purchases, "Transport", amt); break;
      case "property-buy": add(purchases, "Housing", amt); break;
      case "property-occupancy": if (out) add(purchases, "Moving house", amt); break;
      case "insurance-signup-fee": add(purchases, "Insurance sign-up", amt); break;
      // Bets happen inside the gambling account — what counts for cash is
      // what went in and what came back out.
      case "gambling-buyin": gambleIn += amt; break;
      case "gambling-cashout": gambleOut += amt; break;
      case "savings-deposit": case "term-deposit-open": case "stock-buy": saved += amt; break;
      case "savings-withdraw": case "term-deposit-early": case "stock-sell": case "stock-close": saved -= amt; break;
      default: count--; // scheduled (wages, rent, bills...) or not money at all
    }
  });
  const gambleNet = budgetRound(gambleIn - gambleOut);
  if (gambleNet > 0) add(purchases, "Gambling", gambleNet);
  else if (gambleNet < 0) add(extra, "Gambling", -gambleNet);
  const sum = map => budgetRound(Object.values(map).reduce((s, v) => s + v, 0));
  const list = map => Object.entries(map).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  return {
    extra: list(extra), extraTotal: sum(extra),
    purchases: list(purchases), purchasesTotal: sum(purchases),
    surprises: list(surprises), surprisesTotal: sum(surprises),
    saved: budgetRound(saved), count
  };
}

/* ---------------- The saved plan ----------------
   Just how much the student means to save each week. It keeps applying
   every week until they change it. Plans saved by the old three-box
   version of this tool carry over using their Savings box. */
function normalizeBudgetPlan(raw) {
  if (!raw) return { hasPlan: false, saveAmount: 0, updatedAt: null };
  let save = Number(raw.saveAmount);
  if (!Number.isFinite(save) && raw.allocations) save = Number(raw.allocations.savings);
  if (!Number.isFinite(save) || save < 0) return { hasPlan: false, saveAmount: 0, updatedAt: null };
  return { hasPlan: true, saveAmount: budgetRound(save), updatedAt: raw.updatedAt || null };
}

const MAX_BUDGET_SAVE = 1000000;
async function saveBudget(username, saveAmount) {
  const raw = String(saveAmount === undefined || saveAmount === null ? "" : saveAmount).trim();
  const save = budgetRound(raw);
  if (raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) return { ok: false, error: "Enter how much you'll save each week — 0 or more." };
  if (save > MAX_BUDGET_SAVE) return { ok: false, error: `That's more than ${fmtMoney(MAX_BUDGET_SAVE)} — try a smaller amount.` };
  await usersCol().doc(username).update({
    budget: { saveAmount: save, weekKey: isoWeekKey(new Date()), updatedAt: Date.now() }
  });
  return { ok: true };
}

async function clearBudget(username) {
  await usersCol().doc(username).update({ budget: null });
  return { ok: true };
}

/* ---------------- Everything the page needs, in one pass ---------------- */
function buildBudgetView(cls, user, username) {
  const sched = budgetWeekItems(cls, user, username);
  const { items, weekStartKey, todayKey } = sched;
  const actual = budgetWeekActuals(cls, username, weekStartKey);
  const plan = normalizeBudgetPlan(user.budget);
  const counted = i => BUDGET_COUNTED.includes(i.status);
  const sum = list => budgetRound(list.reduce((s, i) => s + i.amount, 0));

  const inItems = items.filter(i => i.dir === "in");
  const outItems = items.filter(i => i.dir === "out");
  const scheduledIn = sum(inItems.filter(counted));
  const inTotal = budgetRound(scheduledIn + actual.extraTotal);
  const billsTotal = sum(outItems.filter(counted));
  const billsPaid = sum(outItems.filter(i => i.status === "done"));
  const billsLeft = budgetRound(billsTotal - billsPaid);
  const left = budgetRound(inTotal - billsTotal);
  const autoSave = sum(items.filter(i => i.dir === "save" && counted(i)));

  const saveTarget = plan.saveAmount;
  const spendAllowed = budgetRound(Math.max(0, left - saveTarget));
  const spent = budgetRound(actual.purchasesTotal + actual.surprisesTotal);
  const spendLeft = budgetRound(spendAllowed - spent);

  /* ---- Cash, day by day, for the rest of the week ----
     Starting from the cash they have now, add each day's money still to
     come in and take off each day's bills still to pay (money in first —
     wages are paid as soon as anyone opens the site on pay day, before a
     student can pay anything). Leaves out spending, which is up to them.
     The lowest point is how much they could spend right now and still pay
     every bill on its day. If it dips below $0, their Savings account can
     make up the gap — they just have to move the money into cash first,
     since bills only come out of cash. */
  const cash = budgetRound(user.balance);
  // Savings that can cover a gap — less anything an automatic transfer
  // already moves back into cash this week (that's counted as money in).
  const savings = budgetRound(Math.max(0, Number(user.savings) || 0));
  const unsaving = sum(items.filter(i => i.dir === "unsave" && ["today", "upcoming", "overdue"].includes(i.status)));
  const savingsSpare = budgetRound(Math.max(0, savings - unsaving));
  const todayIdx = budgetDayIndex(nzDayName());
  let running = cash, lowest = cash, lowestDay = null, firstShort = null;
  for (let d = todayIdx; d < 7; d++) {
    const dayKey = dateKeyPlusDays(weekStartKey, d);
    let dayIn = 0, dayBills = 0, daySave = 0;
    items.forEach(i => {
      if (i.status === "daily") {
        if (dayKey > todayKey || user.lastLifeAllowanceDailyPaid !== todayKey) dayIn += i.perDay;
        return;
      }
      if (i.dayKey !== dayKey || !["today", "upcoming", "overdue"].includes(i.status)) return;
      if (i.dir === "in" || i.dir === "unsave") dayIn += i.amount;
      else if (i.dir === "save") daySave += i.amount;
      else dayBills += i.amount;
    });
    const before = budgetRound(running + dayIn);
    if (!firstShort && dayBills > before + 0.005) firstShort = { dayKey, need: budgetRound(dayBills), have: before };
    running = budgetRound(before - dayBills);
    // An automatic transfer to savings only happens if there's the cash for it.
    if (daySave > 0 && running >= daySave) running = budgetRound(running - daySave);
    if (running < lowest) { lowest = running; lowestDay = dayKey; }
  }
  // Not enough cash for a bill: how much has to come out of savings, and
  // whether savings can cover all of it.
  let shortfall = null;
  if (firstShort) {
    const gap = budgetRound(-lowest);
    const uncovered = budgetRound(Math.max(0, gap - savingsSpare));
    shortfall = Object.assign(firstShort, {
      gap, fromSavings: budgetRound(Math.min(gap, savingsSpare)), uncovered, covered: uncovered <= 0.005
    });
  }
  // Cash they could spend now and still pay every bill, using savings to
  // top up later if needed. Never more than the cash they actually have.
  const safeCash = budgetRound(Math.max(0, Math.min(cash, lowest + savingsSpare)));
  // With a plan, never more than the spending money it leaves.
  const safeNow = plan.hasPlan ? budgetRound(Math.max(0, Math.min(safeCash, spendLeft))) : safeCash;
  const safeReason = plan.hasPlan && spendLeft < safeCash ? "plan"
    : lowestDay ? "bills" : "cash";
  // Of the bills still to come, how much savings would have to cover if
  // they spent the whole safe amount now.
  const safeFromSavings = budgetRound(Math.max(0, safeNow - lowest));

  /* ---- The one-line verdict ---- */
  const dayWord = budgetDayWord;
  let verdict;
  if (shortfall) {
    const when = shortfall.dayKey === todayKey ? "today" : "on " + dayWord(shortfall.dayKey);
    const start = `${when === "today" ? "Today" : "On " + dayWord(shortfall.dayKey)} you'll need ${fmtMoney(shortfall.need)} for bills, but you'll only have about ${fmtMoney(Math.max(0, shortfall.have))} in cash.`;
    verdict = shortfall.covered
      ? { tone: "warn", icon: "piggy", text: `${start} Move ${fmtMoney(shortfall.gap)} from your savings into cash ${when === "today" ? "now" : "before then"} to cover this week's bills (you have ${fmtMoney(savings)} saved).` }
      : { tone: "bad", icon: "shield", text: `Heads up: ${start} ${savingsSpare > 0 ? `Even with the ${fmtMoney(savingsSpare)} in your savings, you'll be` : "You have nothing in savings to cover it, so you'll be"} ${fmtMoney(shortfall.uncovered)} short this week. Spend as little as you can, and look for ways to earn extra.` };
  } else if (billsTotal > inTotal + 0.005) {
    verdict = { tone: "bad", icon: "shield", text: `This week's bills (${fmtMoney(billsTotal)}) are more than the money coming in (${fmtMoney(inTotal)}). The other ${fmtMoney(budgetRound(billsTotal - inTotal))} has to come from cash you already have or your savings.` };
  } else if (plan.hasPlan && spendLeft < -0.005) {
    verdict = { tone: "bad", icon: "cart", text: `You've spent ${fmtMoney(-spendLeft)} more than your plan's spending money this week.` };
  } else if (!plan.hasPlan) {
    verdict = inTotal <= 0 && billsTotal <= 0
      ? { tone: "warn", icon: "calendar", text: "Nothing is coming in or going out this week yet. A job or a side hustle gets money coming in — then come back and plan it." }
      : { tone: "warn", icon: "calendar", text: `You have ${fmtMoney(Math.max(0, left))} left after this week's bills. Choose how much of it to save below.` };
  } else {
    verdict = { tone: "good", icon: "trophy", text: billsTotal > 0
      ? "You're on track: your bills are covered and you're inside your plan."
      : "You're on track: no bills this week, and you're inside your plan." };
  }

  /* ---- A few short tips (only the ones that matter right now) ---- */
  const notes = [];
  // Insurance premiums aren't taken automatically — students are meant to
  // pay them with an automatic payment to their teacher (see
  // processInsurancePayments). Not having done so is the most common way a
  // budget here quietly goes wrong.
  let premiums = 0;
  (user.insurance || []).forEach(id => {
    const p = (cls.insurancePlans || []).find(x => x.id === id);
    if (p && p.price > 0) premiums += Number(p.price) || 0;
  });
  premiums = budgetRound(premiums);
  if (premiums > 0) {
    let toTeacher = 0;
    (cls.automations || []).forEach(a => {
      if (a.active && a.studentUser === username && a.type !== "savings-transfer" && a.toUser === cls.teacher) {
        toTeacher += Number(a.amount) * (7 / (FREQ_DAYS[a.frequency] || 7));
      }
    });
    toTeacher = budgetRound(toTeacher);
    if (toTeacher + 0.005 < premiums) {
      notes.push({ tone: "bad", icon: "shield", text: toTeacher <= 0
        ? `Your insurance costs ${fmtMoney(premiums)} a week, and nothing is set up to pay it. Set up an automatic payment to your teacher below.`
        : `Your insurance costs ${fmtMoney(premiums)} a week, but your automatic payments to your teacher only cover ${fmtMoney(toTeacher)} of it.` });
    }
  }
  const missed = outItems.filter(i => i.status === "missed");
  if (missed.length) {
    notes.push({ tone: "warn", icon: "calendar", text: `You missed ${missed.map(i => i.label).join(", ")} this week. It can't be paid late, and your teacher can see it's overdue.` });
  }
  let loanGrowth = 0;
  (user.loans || []).forEach(l => {
    if (l.status === "active" && l.weeklyCompounding) loanGrowth += (l.owed || 0) * ((l.rate || 0) / 100);
  });
  loanGrowth = budgetRound(loanGrowth);
  if (loanGrowth > 0) {
    notes.push({ tone: "warn", icon: "handshake", text: `Your loans grow by about ${fmtMoney(loanGrowth)} in interest every Monday until you pay them off.` });
  }
  const maturing = (user.termDeposits || []).filter(d => d.matureDate >= todayKey && d.matureDate <= sched.weekEndKey);
  if (maturing.length) {
    const total = budgetRound(maturing.reduce((s, d) => s + d.amount, 0));
    notes.push({ tone: "good", icon: "piggy", text: `Your term deposit${maturing.length > 1 ? "s" : ""} (${fmtMoney(total)} plus interest) pay${maturing.length > 1 ? "" : "s"} back into your cash this week — that's your savings coming back, so think before you spend it.` });
  }

  return {
    ...sched, actual, plan,
    inItems, outItems, scheduledIn, inTotal, billsTotal, billsPaid, billsLeft, left,
    saveTarget, autoSave, spendAllowed, spent, spendLeft,
    cash, savings, savingsSpare, safeNow, safeCash, safeReason, safeFromSavings, lowestDay, shortfall, verdict, notes
  };
}

// Teacher's at-a-glance view: one line per student. Takes the roster the
// page has already loaded, so it costs nothing extra to show.
function classBudgetOverviewFromData(cls, students) {
  return students.map(s => {
    const v = buildBudgetView(cls, s, s.username);
    let status;
    if (v.shortfall && !v.shortfall.covered) status = "bounce";
    else if (v.shortfall) status = "move";
    else if (v.billsTotal > v.inTotal + 0.005) status = "short";
    else if (v.plan.hasPlan && v.spendLeft < -0.005) status = "over";
    else if (!v.plan.hasPlan) status = "none";
    else status = "ok";
    return {
      username: s.username, name: s.name || s.username,
      inTotal: v.inTotal, billsTotal: v.billsTotal, left: v.left,
      planned: v.plan.hasPlan, saveTarget: v.saveTarget, saved: v.actual.saved,
      spent: v.spent, spendAllowed: v.spendAllowed, status
    };
  }).sort((a, b) => BUDGET_STATUS_ORDER[a.status] - BUDGET_STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}
// Who the teacher should look at first.
const BUDGET_STATUS_ORDER = { bounce: 0, move: 1, short: 2, over: 3, none: 4, ok: 5 };

// Whether a transaction belongs in a particular student's own activity
// feed. Most types have exactly one participant on each side, so matching
// "from" or "to" against them is enough. Peer-to-peer marketplace trades
// are the one exception: a single trade logs TWO records — a p2p-buy leg
// for the buyer and a p2p-sell leg for the seller — and both legs carry
// the same buyer/seller pair (so each note can still name the other
// person). Filtering on "from or to" alone means each side would also
// pick up the OTHER side's leg of their own trade — a buyer would see a
// phantom "Sold to a classmate" entry for the thing they just bought, and
// the seller would see a phantom "Bought from a classmate" for the thing
// they just sold. Each leg only belongs to the one participant it's
// actually about.
function txnBelongsTo(t, username) {
  if (t.type === "p2p-buy") return t.from === username;
  if (t.type === "p2p-sell") return t.to === username;
  // BUGFIX: payClassmateRent() logs this as a PAIR of txns (like p2p-buy/
  // p2p-sell above) — "property-rent-pay" and "property-rent-receive" —
  // but both entries carry BOTH `to` (owner) and `from` (tenant), since
  // that's what the note text on each side needs. Without this guard the
  // generic to/from check below matched both students on both txns, so
  // classifyTxnForReport (which doesn't re-check direction for these
  // types) gave the tenant a phantom "Rent received" income entry and the
  // owner a phantom "Housing" expense entry, on top of their real one —
  // corrupting reportMonth/reportLifetime for both students on every
  // classmate rent payment.
  if (t.type === "property-rent-pay") return t.from === username;
  if (t.type === "property-rent-receive") return t.to === username;
  return t.to === username || t.from === username;
}

/* ===================== Savings goals =====================
   A student can set up to MAX_SAVINGS_GOALS things they're saving for
   ("New bike — $120"). Goals live on the student's own doc as
   `savingsGoals` (a short array, in the student's own priority order) —
   nothing about them moves any money. Progress is simply the student's
   Savings account balance, poured into the goals top-down: the first goal
   fills first, then whatever's left over starts on the second, and so on.
   That keeps one savings balance from being "counted" towards several
   goals at once, and gives the student a reason to put money into
   Savings rather than leaving it as cash. */
const MAX_SAVINGS_GOALS = 5;
const MAX_SAVINGS_GOAL_AMOUNT = 1000000;

// Pure — no reads. Returns the goals with how much of the Savings balance
// is going towards each one.
function savingsGoalProgress(user) {
  let left = Math.max(0, Number(user && user.savings) || 0);
  return ((user && user.savingsGoals) || []).map(g => {
    const target = Number(g.target) || 0;
    const saved = Math.round(Math.min(left, target) * 100) / 100;
    left = Math.max(0, Math.round((left - saved) * 100) / 100);
    return {
      id: g.id, name: g.name, target, saved,
      pct: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0,
      reached: target > 0 && saved >= target
    };
  });
}

// Read-modify-write of the student's own goal list in one transaction, so
// two quick clicks can't clobber each other. `change` gets a copy of the
// current list and returns the new one (or throws an Error whose message
// is shown to the student).
async function _updateSavingsGoals(username, change) {
  const ref = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error("Account not found.");
      const goals = change(_cloneDoc(snap.data().savingsGoals || []));
      t.update(ref, { savingsGoals: goals });
    });
    return { ok: true };
  } catch (e) {
    if (e && !e.code && e.message) return { ok: false, error: e.message };
    console.error("Saving savings goals failed:", e);
    return { ok: false, error: t29IsConnectionError(e)
      ? "Couldn't save — check your internet connection and try again."
      : "Couldn't save your goal. Please try again." };
  }
}

async function addSavingsGoal(username, name, target) {
  const cleanName = sanitizeUserText(name, 40);
  const amount = cleanAmount(target);
  if (!cleanName) return { ok: false, error: "Give your goal a name." };
  if (!(amount > 0)) return { ok: false, error: "Enter how much you need, more than $0." };
  if (amount > MAX_SAVINGS_GOAL_AMOUNT) return { ok: false, error: `That's a bit much — keep it under ${fmtMoney(MAX_SAVINGS_GOAL_AMOUNT)}.` };
  return _updateSavingsGoals(username, goals => {
    if (goals.length >= MAX_SAVINGS_GOALS) throw new Error(`You can have up to ${MAX_SAVINGS_GOALS} goals at a time. Remove one first.`);
    goals.push({ id: uid("goal"), name: cleanName, target: amount, createdAt: Date.now() });
    return goals;
  });
}

async function removeSavingsGoal(username, goalId) {
  return _updateSavingsGoals(username, goals => goals.filter(g => g.id !== goalId));
}

// Moves a goal one place up the list, so it gets filled before the one
// that was above it.
async function moveSavingsGoalUp(username, goalId) {
  return _updateSavingsGoals(username, goals => {
    const i = goals.findIndex(g => g.id === goalId);
    if (i > 0) [goals[i - 1], goals[i]] = [goals[i], goals[i - 1]];
    return goals;
  });
}

/* ===================== Parent view =====================
   A read-only link a student (or their teacher) can give to the student's
   family: parent.html?t=<token> shows that student's report card without
   anyone having to log in.

   Parents don't have accounts, and firestore.rules only lets signed-in
   class members read /users and /classes — so the parent page never reads
   those. Instead, a small ready-made summary is copied into
   /parentViews/{token}, which anyone holding the (long, random,
   unguessable) token can read, and nothing else. The copy is refreshed
   whenever the student or their teacher is using the site (at most every
   couple of hours per device — see PARENT_VIEW_REFRESH_MS), so it's
   "as of" that time, which the parent page says.

   The student's own doc remembers its current token as `parentViewToken`.
   Turning the link off deletes the summary, so the old link stops working
   straight away; making a new one afterwards gives a different link. */
const PARENT_VIEW_REFRESH_MS = 2 * 3600000;

function parentViewsCol() { return fdb.collection("parentViews"); }

function parentViewUrl(token) {
  return new URL("parent.html?t=" + encodeURIComponent(token), window.location.href).href;
}

// The summary a parent sees. Built from exactly the same numbers as the
// report card (buildStudentReportData), plus savings goals and job.
function _buildParentView(student, cls, teacherName) {
  const r = buildStudentReportData(student, cls);
  const job = (cls.jobs || []).find(j => j.id === student.jobId);
  const tier = job ? getStudentTier(job, student) : null;
  const activeLoans = (r.loans || []).filter(l => l.status === "active");
  const p = nzParts();
  const monthLabel = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, 15))
    .toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    name: student.name || student.username,
    className: cls.name || "",
    teacherName: teacherName || "",
    monthLabel,
    job: job ? (tier ? tier.name : job.title) : null,
    netWorth: r.netWorth, balance: r.balance, savings: r.savings,
    termDeposits: r.termDeposits, invested: r.invested,
    propertyValue: r.propertyValue, vehicleValue: r.vehicleValue, storeValue: r.storeValue,
    owed: r.owed,
    incomeTotal: r.incomeTotal, savedTotal: r.savedTotal, spentTotal: r.spentTotal,
    savingsRate: r.savingsRate,
    income: r.income, saved: r.saved, spent: r.spent,
    topExpenseCategory: r.topExpenseCategory,
    lifetimeIncomeTotal: r.lifetimeIncomeTotal, lifetimeSavedTotal: r.lifetimeSavedTotal,
    lifetimeSpentTotal: r.lifetimeSpentTotal,
    activeLoanCount: activeLoans.length,
    goals: savingsGoalProgress(student).map(g => ({ name: g.name, target: g.target, saved: g.saved, reached: g.reached }))
  };
}

async function _writeParentView(token, student, cls) {
  let teacherName = "";
  try {
    const teacher = await getUserCached(cls.teacher);
    teacherName = teacher ? teacher.name : "";
  } catch (e) { /* the teacher's name is optional on the parent page */ }
  await parentViewsCol().doc(token).set({
    username: student.username,
    classCode: student.classCode,
    updatedAt: Date.now(),
    view: _buildParentView(student, cls, teacherName)
  });
  try { localStorage.setItem("t29_pv_refreshed_" + token, String(Date.now())); } catch (e) { /* ignore */ }
}

// Makes a family link for this student (or returns the one they already
// have, freshly updated). Works for the student themselves and for their
// teacher.
async function createParentLink(username) {
  try {
    const student = await getUser(username);
    if (!student || student.role !== "student") return { ok: false, error: "Student not found." };
    const cls = withNewModuleDefaults(await getClass(student.classCode));
    if (!cls) return { ok: false, error: "Class not found." };
    if (student.parentViewToken) {
      await _writeParentView(student.parentViewToken, student, cls);
      return { ok: true, token: student.parentViewToken, url: parentViewUrl(student.parentViewToken) };
    }
    const token = genShareToken();
    await _writeParentView(token, student, cls);
    try {
      await usersCol().doc(username).update({ parentViewToken: token });
    } catch (e) {
      await parentViewsCol().doc(token).delete().catch(() => {});
      throw e;
    }
    return { ok: true, token, url: parentViewUrl(token) };
  } catch (e) {
    console.error("Creating family link failed:", e);
    return { ok: false, error: t29IsConnectionError(e)
      ? "Couldn't make the link — check your internet connection and try again."
      : "Couldn't make the link right now. Please try again in a moment." };
  }
}

// Turns the family link off: the old link stops working at once.
async function turnOffParentLink(username) {
  try {
    const student = await getUser(username);
    if (!student) return { ok: false, error: "Student not found." };
    if (student.parentViewToken) {
      await parentViewsCol().doc(student.parentViewToken).delete();
      await usersCol().doc(username).update({ parentViewToken: null });
    }
    return { ok: true };
  } catch (e) {
    console.error("Turning off family link failed:", e);
    return { ok: false, error: "Couldn't turn the link off. Please try again." };
  }
}

// Background refresh — never throws, never shows anything. `student` and
// `cls` are docs the page has already read. Skips the write if this device
// already refreshed this link recently.
async function refreshParentViewIfStale(student, cls) {
  try {
    const token = student && student.parentViewToken;
    if (!token || !cls) return false;
    let last = 0;
    try { last = Number(localStorage.getItem("t29_pv_refreshed_" + token)) || 0; } catch (e) { /* ignore */ }
    if (Date.now() - last < PARENT_VIEW_REFRESH_MS) return false;
    await _writeParentView(token, student, withNewModuleDefaults(cls));
    return true;
  } catch (e) {
    console.warn("Family link refresh skipped:", e);
    return false;
  }
}

// Teacher's Reports page: refresh every student's family link that's due.
async function refreshParentViewsForClass(classCode) {
  try {
    const cls = await getClassCached(classCode);
    if (!cls) return;
    const students = await getClassStudents(classCode, cls);
    for (const s of students) {
      if (s.parentViewToken) await refreshParentViewIfStale(s, cls);
    }
  } catch (e) {
    console.warn("Family link refresh skipped:", e);
  }
}

// Used when a student or a whole class is deleted, so a family link can't
// outlive the account it shows. Best-effort — never blocks the deletion.
async function _deleteParentViewFor(username) {
  try {
    const student = await getUser(username);
    if (student && student.parentViewToken) await parentViewsCol().doc(student.parentViewToken).delete();
  } catch (e) { /* the link just keeps showing its last summary */ }
}
