/* ===================== The 29 World — data layer: life =====================
   Jobs, transport, insurance, side hustles, the class store, the Life
   module, big events and random events, the lifestyle rating (including
   module locks and the nav-bar helpers that go with them), and quizzes.
   Part of the data layer — see the top of data-core.js for how the five
   data-*.js files fit together.
====================================================================== */

/* ---------------- Jobs ---------------- */
/* Resolves the student's effective tier within a job — falls back to the
   first tier if jobTierId is unset or no longer valid (tier was removed). */
function getStudentTier(job, student) {
  if (!job || !job.tiers || !job.tiers.length) return null;
  if (student && student.jobTierId) {
    const found = job.tiers.find(t => t.id === student.jobTierId);
    if (found) return found;
  }
  return job.tiers[0]; // entry-level fallback
}

async function addJob(classCode, title, tiers, autoPromoteWeeks) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.jobs.push({
      id: uid("j"), title: sanitizeUserText(title, 60),
      tiers: (tiers || []).map(tier => ({
        id: uid("t"), name: sanitizeUserText(tier.name, 60) || "Tier 1",
        wage: Number(tier.wage) || 0, description: sanitizeUserText(tier.description, 200)
      })),
      autoPromoteWeeks: Number(autoPromoteWeeks) || 0
    });
    t.update(classRef, { jobs: cls.jobs });
  });
}
async function updateJob(classCode, jobId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const job = cls.jobs.find(j => j.id === jobId);
    if (!job) return;
    // Same sanitizing as addJob — editing a job is the same write path and
    // shouldn't be a way to sneak back in what creating one blocks.
    job.title = sanitizeUserText(updates.title, 60);
    if (updates.tiers) {
      job.tiers = updates.tiers.map(tier => ({
        id: tier.id || uid("t"), name: sanitizeUserText(tier.name, 60) || "Tier 1",
        wage: Number(tier.wage) || 0, description: sanitizeUserText(tier.description, 200)
      }));
    }
    job.autoPromoteWeeks = Number(updates.autoPromoteWeeks) || 0;
    t.update(classRef, { jobs: cls.jobs });
  });
}
async function removeJob(classCode, jobId) {
  const classRef = classesCol().doc(classCode);
  let affectedStudents = [];
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    cls.jobs = cls.jobs.filter(j => j.id !== jobId);
    cls.jobApplications = (cls.jobApplications || []).filter(a => a.jobId !== jobId);
    t.update(classRef, { jobs: cls.jobs, jobApplications: cls.jobApplications });
    affectedStudents = cls.students;
  });
  // unassign anyone with this job (separate user docs)
  const students = await Promise.all(affectedStudents.map(getUser));
  await Promise.all(students.filter(s => s && s.jobId === jobId).map(s =>
    usersCol().doc(s.username).update({ jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null })
  ));
}
async function assignJob(studentUser, jobId, classCode) {
  let tierId = null;
  if (jobId && classCode) {
    const cls = await getClass(classCode);
    if (cls) {
      const job = (cls.jobs || []).find(j => j.id === jobId);
      if (job && job.tiers && job.tiers.length) tierId = job.tiers[0].id;
    }
  }
  await usersCol().doc(studentUser).update({
    jobId: jobId || null,
    jobTierId: tierId,
    jobTierSince: tierId ? nzDateKey() : null,
    pendingPromotion: null
  });
}

/* ---------------- Job applications ---------------- */
async function approveApplication(classCode, appId) {
  const classRef = classesCol().doc(classCode);
  let studentUser = null, jobId = null, tierId = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const app = (cls.jobApplications || []).find(a => a.id === appId);
    if (!app) return;
    app.status = "approved";
    studentUser = app.studentUser;
    jobId = app.jobId;
    const job = (cls.jobs || []).find(j => j.id === jobId);
    if (job && job.tiers && job.tiers.length) tierId = job.tiers[0].id;
    t.update(classRef, { jobApplications: cls.jobApplications });
  });
  if (studentUser) await usersCol().doc(studentUser).update({
    jobId,
    jobTierId: tierId,
    jobTierSince: tierId ? nzDateKey() : null,
    pendingPromotion: null
  });
}
async function declineApplication(classCode, appId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const app = (cls.jobApplications || []).find(a => a.id === appId);
    if (!app) return;
    app.status = "declined";
    t.update(classRef, { jobApplications: cls.jobApplications });
  });
}


/* ---------------- Job tier management ---------------- */

// Set a student to any specific tier within their current job.
// Promotes (higher index) → queues an OFFER the student must accept before
// it takes effect (see respondToPromotion below) — their tier/wage does not
// change yet. Demotes (lower index) → applied immediately, no consent needed.
async function setStudentJobTier(classCode, username, tierId) {
  const [cls, student] = await Promise.all([getClass(classCode), getUser(username)]);
  if (!cls || !student) return { ok: false, error: "Not found." };
  const job = (cls.jobs || []).find(j => j.id === student.jobId);
  if (!job || !job.tiers || !job.tiers.length) return { ok: false, error: "No job or tiers found." };
  const newTier = job.tiers.find(t => t.id === tierId);
  if (!newTier) return { ok: false, error: "Tier not found." };
  const curIdx = student.jobTierId ? job.tiers.findIndex(t => t.id === student.jobTierId) : 0;
  const effectiveCurIdx = curIdx === -1 ? 0 : curIdx;
  const newIdx = job.tiers.indexOf(newTier);
  // No-op save (teacher re-submitted the tier the student is already on) —
  // skip the write entirely so we don't reset jobTierSince and silently
  // restart their auto-promotion countdown for no reason.
  if (newIdx === effectiveCurIdx) return { ok: true, tier: newTier, isPromotion: false, unchanged: true };
  const isPromotion = newIdx > effectiveCurIdx;
  if (isPromotion) {
    if (student.pendingPromotion) return { ok: false, error: "This student already has a pending promotion offer." };
    await usersCol().doc(username).update({
      pendingPromotion: {
        jobId: job.id, tierId: newTier.id,
        jobTitle: job.title, tierName: newTier.name, wage: newTier.wage, date: nowStr()
      }
    });
    return { ok: true, tier: newTier, isPromotion: true, offered: true };
  }
  await usersCol().doc(username).update({ jobTierId: tierId, jobTierSince: nzDateKey() });
  return { ok: true, tier: newTier, isPromotion: false };
}

// Auto-promotion background job. Runs on every page load alongside the other
// startup jobs. For each job with autoPromoteWeeks > 0, queues a promotion
// OFFER (does not apply it) for eligible students exactly one tier up.
// Skips students who already have an unresolved offer, so it won't pile
// on/overwrite one every time the page reloads while they're deciding.
// Uses per-student transactions for idempotency — safe against concurrent
// tab loads. Fast no-op when no jobs are configured for auto-promotion.
async function processJobPromotions(classCode) {
  // Putting a new offer on a student's doc is teacher-only in
  // firestore.rules (a student can only answer one), so from a student's
  // page every attempt here was refused — skip the reads and round trips.
  if (t29SessionStudent()) return 0;
  const cls = await getClass(classCode);
  if (!cls || cls.archived) return 0;
  const promotableJobs = (cls.jobs || []).filter(
    j => j.autoPromoteWeeks > 0 && j.tiers && j.tiers.length > 1
  );
  if (!promotableJobs.length) return 0;
  const students = await getClassStudents(classCode);
  const today = nzDateKey();
  let count = 0;
  for (const student of students) {
    if (!student.jobId || !student.jobTierSince) continue;
    if (student.pendingPromotion) continue; // already has an unresolved offer
    const job = promotableJobs.find(j => j.id === student.jobId);
    if (!job) continue;
    const curIdx = student.jobTierId ? job.tiers.findIndex(t => t.id === student.jobTierId) : 0;
    const effectiveIdx = curIdx === -1 ? 0 : curIdx;
    if (effectiveIdx >= job.tiers.length - 1) continue;
    const weeksSince = Math.floor(daysBetweenKeys(student.jobTierSince, today) / 7);
    if (weeksSince < Number(job.autoPromoteWeeks)) continue;
    let offered = false;
    try {
      const userRef = usersCol().doc(student.username);
      await fdb.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) return;
        const live = snap.data();
        if (!live.jobId || !live.jobTierSince) return;
        if (live.pendingPromotion) return; // race guard
        const liveIdx = live.jobTierId ? job.tiers.findIndex(ti => ti.id === live.jobTierId) : 0;
        const liveEff = liveIdx === -1 ? 0 : liveIdx;
        if (liveEff >= job.tiers.length - 1) return;
        const liveWeeks = Math.floor(daysBetweenKeys(live.jobTierSince, today) / 7);
        if (liveWeeks < Number(job.autoPromoteWeeks)) return;
        const nextTier = job.tiers[liveEff + 1];
        offered = true;
        t.update(userRef, {
          pendingPromotion: {
            jobId: job.id, tierId: nextTier.id,
            jobTitle: job.title, tierName: nextTier.name,
            wage: nextTier.wage, date: nowStr()
          }
        });
      });
    } catch (e) { offered = false; }
    if (offered) count++;
  }
  return count;
}

// Peek at a student's pending promotion offer. Does NOT clear it — the
// offer stays in place (and keeps showing) until the student explicitly
// accepts or declines via respondToPromotion. Call after startup jobs on
// student-facing pages.
// PERF FIX: this is the last of a chain of four checks that run
// back-to-back at the end of every page's init() — see the comment on
// checkWeeklyEventPopup in events-ui.js. Was an uncached getUser(); this
// student's own doc was almost certainly just fetched (and cached) by
// one of the three checks immediately before this one, so reuse it
// instead of paying for a fifth network round trip in the same chain.
async function checkPromotionNotification(username) {
  const user = await getUserCached(username);
  return (user && user.pendingPromotion) || null;
}

// Student responds to a pending promotion offer, whether it was queued
// automatically or offered manually by the teacher. Accepting applies the
// new tier; declining leaves them exactly where they are. Either way
// jobTierSince resets to today — for an accept that's just the normal start
// of the new tier's clock, and for a decline it pushes the next
// auto-promotion check out a full cycle instead of re-offering the very
// next time a page loads.
async function respondToPromotion(username, accept) {
  const user = await getUser(username);
  if (!user || !user.pendingPromotion) return { ok: false, error: "No pending promotion." };
  const promo = user.pendingPromotion;
  const update = { pendingPromotion: null, jobTierSince: nzDateKey() };
  // Only actually move them if they're still in the job the offer was for —
  // guards against the rare case where they switched jobs while it sat
  // unanswered, which would otherwise apply a stale tier id to a new job.
  if (accept && user.jobId === promo.jobId) {
    update.jobTierId = promo.tierId;
  }
  await usersCol().doc(username).update(update);
  return { ok: true, accepted: !!accept, promo };
}

// Teacher revokes an outstanding promotion offer before the student has
// responded to it. No side effects beyond removing the offer itself.
async function cancelPendingPromotion(username) {
  await usersCol().doc(username).update({ pendingPromotion: null });
  return { ok: true };
}

/* ===================== Transport ===================== */
const VEHICLE_TYPES = ["car", "truck", "bike"];
function normalizeVehicleType(t) {
  return VEHICLE_TYPES.includes(t) ? t : "car";
}
async function addVehicle(classCode, v) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.vehicles.push({
      id: uid("veh"), name: v.name, price: Number(v.price),
      comfort: Math.max(1, Math.min(5, Number(v.comfort) || 1)),
      description: v.description || "", owners: [],
      type: normalizeVehicleType(v.type),
      // Only meaningful for trucks — how much an owner earns each time they
      // check in to "drive" it (see checkinTruckDrive). Stored regardless
      // of type so switching a vehicle's type later doesn't lose the value.
      drivePayout: Math.max(0, Number(v.drivePayout) || 0),
      // Weekly running cost (see payTransportExpenses) and how much this
      // vehicle knocks off the class-wide public transport fee for its
      // owner, as a percentage of that fee (see transportWeeklyAmount) —
      // both teacher-set per vehicle.
      weeklyExpense: Math.max(0, Number(v.weeklyExpense) || 0),
      publicTransportOffsetPct: Math.max(0, Math.min(100, Number(v.publicTransportOffsetPct) || 0)),
      stockLimit: (v.stockLimit === "" || v.stockLimit === undefined || v.stockLimit === null) ? null : Math.max(0, Math.floor(Number(v.stockLimit)))
    });
    t.update(classRef, { vehicles: cls.vehicles });
  });
}
async function removeVehicle(classCode, vehId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.vehicles = cls.vehicles.filter(v => v.id !== vehId);
    t.update(classRef, { vehicles: cls.vehicles });
  });
}
async function updateVehicle(classCode, vehId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const veh = cls.vehicles.find(v => v.id === vehId);
    if (!veh) return;
    veh.name = updates.name;
    veh.price = Number(updates.price);
    veh.comfort = Math.max(1, Math.min(5, Number(updates.comfort) || 1));
    veh.description = updates.description || "";
    veh.type = normalizeVehicleType(updates.type);
    veh.drivePayout = Math.max(0, Number(updates.drivePayout) || 0);
    veh.weeklyExpense = Math.max(0, Number(updates.weeklyExpense) || 0);
    veh.publicTransportOffsetPct = Math.max(0, Math.min(100, Number(updates.publicTransportOffsetPct) || 0));
    veh.stockLimit = (updates.stockLimit === "" || updates.stockLimit === undefined || updates.stockLimit === null) ? null : Math.max(0, Math.floor(Number(updates.stockLimit)));
    t.update(classRef, { vehicles: cls.vehicles });
  });
}
async function buyVehicle(username, classCode, vehId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let vehName = "", cashPaid = 0, taxAmount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const veh = cls.vehicles.find(v => v.id === vehId);
      if (!veh) throw new Error("NOT_FOUND");
      veh.owners = veh.owners || [];
      if (veh.owners.includes(username)) throw new Error("ALREADY_OWN");
      if (veh.stockLimit !== null && veh.stockLimit !== undefined && veh.owners.length >= veh.stockLimit) throw new Error("SOLD_OUT");
      const isTeacher = user.role === "teacher";
      if (normalizeVehicleType(veh.type) === "truck") {
        if (!isTeacher && !user.truckLicence) throw new Error("NO_LICENCE");
        // Max one truck per student — check every vehicle in the class,
        // not just this listing, since a student could otherwise own a
        // truck from one listing and try to buy a different truck too.
        const alreadyOwnsTruck = !isTeacher && cls.vehicles.some(v2 =>
          normalizeVehicleType(v2.type) === "truck" && (v2.owners || []).includes(username));
        if (alreadyOwnsTruck) throw new Error("TRUCK_LIMIT");
      }
      const discountedVehPrice = applyLifeDiscount(user, "transport", veh.price);
      const { total: taxedPrice, taxAmount: tax } = applyTaxToExpense(cls, "transport", discountedVehPrice);
      taxAmount = tax;
      if (!isTeacher && user.balance < taxedPrice) throw new Error("BROKE");
      veh.owners.push(username);
      vehName = veh.name;
      cashPaid = taxedPrice;
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - taxedPrice) * 100) / 100 });
      t.update(classRef, { vehicles: cls.vehicles });
    });
  } catch (e) {
    if (e.message === "ALREADY_OWN") return { ok: false, error: "You already own this vehicle." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    if (e.message === "SOLD_OUT") return { ok: false, error: "This vehicle is sold out." };
    if (e.message === "NO_LICENCE") return { ok: false, error: "You need a truck licence before buying this vehicle." };
    if (e.message === "TRUCK_LIMIT") return { ok: false, error: "You can only own one truck at a time." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "vehicle-buy", from: username, amount: cashPaid, note: `Bought: ${vehName}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true };
}
async function sellVehicle(classCode, vehId, username, rate) {
  const classRef = classesCol().doc(classCode);
  let owner = null, payout = 0, vehName = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const veh = cls.vehicles.find(v => v.id === vehId);
    if (!veh) return;
    veh.owners = veh.owners || [];
    if (!veh.owners.includes(username)) return;
    owner = username;
    vehName = veh.name;
    // An explicit rate (e.g. the teacher's flat 90% forced-repossession
    // rate) always wins. Otherwise — a student selling their own vehicle —
    // fall back to the teacher-configured per-category sell-back rate.
    const effectiveRate = rate !== undefined ? rate : (cls.sellBackRates[normalizeVehicleType(veh.type)] !== undefined ? cls.sellBackRates[normalizeVehicleType(veh.type)] : 0.85);
    payout = Math.round(veh.price * effectiveRate * 100) / 100;
    veh.owners = veh.owners.filter(o => o !== username);
    t.update(classRef, { vehicles: cls.vehicles });
  });
  if (owner) {
    await adjustBalance(owner, payout);
    await logTxn(classCode, { type: "vehicle-sell", to: owner, amount: payout, note: `Sold back: ${vehName}` });
  }
  return true;
}

// Teacher-set price/description for the class-wide truck licence. Students
// must hold this licence (see buyTruckLicence) before they're allowed to
// buy any vehicle of type "truck" — see the NO_LICENCE check in buyVehicle.
async function setTruckLicenceConfig(classCode, price, description) {
  const clean = { price: Math.max(0, Number(price) || 0), description: description || "" };
  await classesCol().doc(classCode).update({ truckLicence: clean });
  return clean;
}
async function buyTruckLicence(username, classCode) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let price = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      if (user.truckLicence) throw new Error("ALREADY");
      price = cls.truckLicence.price || 0;
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < price) throw new Error("BROKE");
      const update = { truckLicence: true };
      if (!isTeacher) update.balance = Math.round((user.balance - price) * 100) / 100;
      t.update(userRef, update);
    });
  } catch (e) {
    if (e.message === "ALREADY") return { ok: false, error: "You already have a truck licence." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "truck-licence-buy", from: username, amount: price, note: "Bought truck licence" });
  return { ok: true };
}
// Teacher control to revoke a student's truck licence (e.g. from the
// profile panel) — no refund, mirrors the manual nature of repossession.
async function revokeTruckLicence(username) {
  await usersCol().doc(username).update({ truckLicence: false });
  return true;
}

// Teacher-set percentage (per vehicle category) a student gets back when
// selling their own vehicle via sellMine — see the fallback in sellVehicle
// above. Forced repossessions (forceSell/profileRemoveVehicle) always pass
// their own explicit rate and are unaffected by this.
async function setSellBackRates(classCode, rates) {
  const clean = {};
  VEHICLE_TYPES.forEach(type => {
    let pct = Number(rates[type]);
    if (isNaN(pct)) pct = 85;
    pct = Math.max(0, Math.min(100, pct));
    clean[type] = Math.round(pct) / 100;
  });
  await classesCol().doc(classCode).update({ sellBackRates: clean });
  return clean;
}

// Owning a truck works like a side hustle a student already qualifies for:
// no fixed check-in hour, no teacher approval — the truck they own can be
// "driven" once per calendar day (NZ time) for the flat amount the teacher
// set on that specific truck (veh.drivePayout). Tracked per-vehicle on the
// user doc (truckCheckins: { [vehId]: dateKey }) even though a student can
// only own one truck at a time (see TRUCK_LIMIT in buyVehicle) — keeps this
// resilient if that cap is ever relaxed, and survives selling one truck and
// buying a different one without carrying over a stale check-in.
async function checkinTruckDrive(username, classCode, vehId) {
  if (await isModuleLockedForStudent(username, classCode, "transport")) {
    return { ok: false, error: "Transport is locked for you right now because of your lifestyle rating." };
  }
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let amount = 0, vehName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("GONE");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const veh = cls.vehicles.find(v => v.id === vehId);
      if (!veh) throw new Error("NOT_FOUND");
      if (normalizeVehicleType(veh.type) !== "truck") throw new Error("NOT_TRUCK");
      if (!(veh.owners || []).includes(username)) throw new Error("NOT_OWNER");

      const todayKey = nzDateKey();
      const checkins = user.truckCheckins || {};
      if (checkins[vehId] === todayKey) throw new Error("ALREADY");

      amount = Number(veh.drivePayout) || 0;
      vehName = veh.name;
      const newBal = Math.round((user.balance + amount) * 100) / 100;
      t.update(userRef, {
        balance: newBal,
        [`truckCheckins.${vehId}`]: todayKey
      });
    });
  } catch (e) {
    if (e.message === "NOT_FOUND" || e.message === "NOT_OWNER") return { ok: false, error: "You don't own that truck." };
    if (e.message === "NOT_TRUCK") return { ok: false, error: "That vehicle isn't a truck." };
    if (e.message === "ALREADY") return { ok: false, error: "You've already driven this truck today." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "truck-drive", to: username, amount, note: `Drove truck — ${vehName}` });
  return { ok: true, amount };
}

/* ===================== Weekly transport expenses =====================
   Every student owes a weekly transport cost even if they own nothing —
   the class-wide public transport fee (setPublicTransportFee) — payable
   once a week via payTransportExpenses. Owning a vehicle adds that
   vehicle's own weeklyExpense on top, but also knocks a percentage of its
   own publicTransportOffsetPct off the public transport fee (floored at
   $0), modelling "owning a car means you don't need the bus as much". A
   student can own several vehicles, but — matching the existing
   "comfort doesn't stack" rule for lifestyle scoring — only their
   comfiest owned vehicle's weeklyExpense/publicTransportOffsetPct count.

   On top of that flat fee, a teacher can also set a different public
   transport fee for students currently holding a specific Life-module
   life event (see setPublicTransportFeeOverrides/currentLifeTransportFee
   below) — e.g. "Moved to the city" could carry its own, higher fee than
   the class default. Still entirely teacher-set, just per life event
   instead of one single number. A student with no matching life event
   (or in a class that's never touched this) just pays the flat fee,
   exactly as before this existed. */

// Teacher-set flat weekly public transport fee every student owes by
// default (see transportWeeklyAmount) — used whenever a student holds no
// life event with its own fee override (see setPublicTransportFeeOverrides).
async function setPublicTransportFee(classCode, amount, description) {
  const clean = { amount: Math.max(0, Number(amount) || 0), description: (description || "").trim() };
  await classesCol().doc(classCode).update({ publicTransportFee: clean });
  return clean;
}
// Teacher control for per-life-event public transport fees: `overrides` is
// a { [lifeItemTemplateId]: amount } map, normally built from every life
// item template currently in cls.lifeItems (see saveLifeFeeOverrides in
// transport.js). Like setSellBackRates, the whole map is replaced in one
// write rather than merged — the caller always sends back every row it
// rendered, so a template dropped from the form (e.g. because its life
// item was deleted) is correctly dropped here too. A blank/invalid entry
// for a given id simply omits it, clearing that life event back to the
// flat fee above.
async function setPublicTransportFeeOverrides(classCode, overrides) {
  const clean = {};
  Object.keys(overrides || {}).forEach(id => {
    const raw = overrides[id];
    const n = Number(raw);
    if (raw !== "" && raw !== null && raw !== undefined && isFinite(n) && n >= 0) {
      clean[id] = Math.round(n * 100) / 100;
    }
  });
  await classesCol().doc(classCode).update({ publicTransportFeeOverrides: clean });
  return clean;
}
// Which of a student's currently-held life events (if any) carries a
// teacher-set override for the public transport fee. Matched by
// templateId — the id of the *template* the life item was granted from
// (see grantLifeItem) — so it keeps applying even if the teacher later
// tweaks the template's name or other benefits. A student's life keeps
// moving forward, so when more than one held life event has an override,
// the most recently granted one wins rather than combining — this models
// a student's *current* circumstances, not every life event they've ever
// been granted. Returns null (meaning: fall back to the flat
// cls.publicTransportFee) if nothing they hold has an override configured,
// including for a user with no lifeItems at all (e.g. a teacher).
function currentLifeTransportFee(cls, user) {
  const overrides = cls.publicTransportFeeOverrides || {};
  const eligible = ((user && user.lifeItems) || [])
    .filter(it => it.templateId && overrides[it.templateId] !== undefined)
    .sort((a, b) => (b.grantedAt || "").localeCompare(a.grantedAt || ""));
  if (!eligible.length) return null;
  const chosen = eligible[0];
  return { amount: Math.max(0, Number(overrides[chosen.templateId]) || 0), name: chosen.name };
}
// Class-wide day transport expenses are payable on (like payDay/mortgageDay).
async function setTransportDay(classCode, day) {
  await classesCol().doc(classCode).update({ transportDay: DAY_NAMES.includes(day) ? day : "Fri" });
}

// A student's comfiest owned vehicle — the only one whose weeklyExpense
// and publicTransportOffsetPct count if they own more than one (see header
// comment above). Returns null if they own nothing.
function comfiestOwnedVehicle(vehicles, username) {
  return (vehicles || []).filter(v => (v.owners || []).includes(username))
    .reduce((best, v) => (!best || (Number(v.comfort) || 0) > (Number(best.comfort) || 0)) ? v : best, null);
}

// The full breakdown of what a student owes this week — used both to
// display the amount ahead of time (transport.js) and to actually charge
// it (payTransportExpenses below), so the number shown is never different
// from the number they get charged. Takes the student's full user doc
// (not just their username) since a life-event fee override (see
// currentLifeTransportFee) needs to read their lifeItems.
function transportWeeklyAmount(cls, user) {
  const username = user.username;
  const vehicle = comfiestOwnedVehicle(cls.vehicles, username);
  const vehicleExpense = vehicle ? Math.max(0, Number(vehicle.weeklyExpense) || 0) : 0;
  const lifeFee = currentLifeTransportFee(cls, user);
  const publicFeeBase = lifeFee ? lifeFee.amount : Math.max(0, Number((cls.publicTransportFee || {}).amount) || 0);
  const publicFeeOffsetPct = vehicle ? Math.max(0, Math.min(100, Number(vehicle.publicTransportOffsetPct) || 0)) : 0;
  const publicFeeOffset = Math.round(publicFeeBase * (publicFeeOffsetPct / 100) * 100) / 100;
  const publicFeeDue = Math.max(0, Math.round((publicFeeBase - publicFeeOffset) * 100) / 100);
  const total = Math.round((vehicleExpense + publicFeeDue) * 100) / 100;
  return { vehicle, vehicleExpense, publicFeeBase, publicFeeOffsetPct, publicFeeOffset, publicFeeDue, total, lifeFeeName: lifeFee ? lifeFee.name : null };
}

// Which ISO week the most recently-passed transport due day falls in —
// same logic as lastMortgageDueWeekKey, just keyed off cls.transportDay.
function lastTransportDueWeekKey(cls) {
  const isoIdx = day => (DAY_NAMES.indexOf(day) + 6) % 7;
  const dueIdx = isoIdx(cls.transportDay || "Fri");
  const todayIdx = isoIdx(nzDayName());
  let daysSinceDue = todayIdx - dueIdx;
  if (daysSinceDue <= 0) daysSinceDue += 7;
  const lastDueDateKey = dateKeyPlusDays(nzDateKey(), -daysSinceDue);
  return isoWeekKey(new Date(dateKeyToUTC(lastDueDateKey)));
}

// The ISO week key of this student's currently-unpaid transport cycle, or
// null if there isn't one — mirrors overdueMortgageWeekKey. There's no
// "first week is free" exemption here (unlike a mortgage's purchase week):
// the public transport fee applies to every student from the moment the
// teacher sets one, whether or not they own a vehicle.
function overdueTransportWeekKey(user, cls) {
  const weekKey = isoWeekKey(new Date());
  if ((user.transportLastWeekPaid || null) === weekKey) return null; // already paid this week
  const lastDueWeekKey = lastTransportDueWeekKey(cls);
  if (lastDueWeekKey === weekKey) return weekKey; // this week's due day already passed
  if ((user.transportLastWeekPaid || null) === lastDueWeekKey) return null; // that earlier cycle was paid
  return lastDueWeekKey; // an earlier due day passed without payment and hasn't been caught up since
}
// Whether a student currently has a missed weekly transport payment. Used
// to show a red "payment overdue" warning on the teacher's student profile
// popup, alongside a button to waive it (see resolveTransportOverdue).
// Purely a read of already-loaded data — doesn't touch the database.
function isTransportPaymentOverdue(user, cls) {
  return overdueTransportWeekKey(user, cls) !== null;
}

// Student-initiated weekly payment — only works on the class's transportDay
// (teacher-set), once per ISO week. An unaffordable payment is simply
// refused (BROKE); nothing is part-paid and nothing accumulates as debt,
// since only the student can trigger a charge in the first place. If a due
// day is missed entirely, the week is just skipped over (see
// overdueTransportWeekKey) and flagged for the teacher, rather than being
// charged retroactively — the teacher can only waive it, never force-collect
// it, matching how mortgage overdue works.
async function payTransportExpenses(username, classCode) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let breakdown = null;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const weekKey = isoWeekKey(new Date());
      if ((cls.transportDay || "Fri") !== nzDayName()) throw new Error("WRONG_DAY");
      if ((user.transportLastWeekPaid || null) === weekKey) throw new Error("ALREADY_PAID");
      breakdown = transportWeeklyAmount(cls, Object.assign({ username }, user));
      const amt = breakdown.total;
      if (amt > 0 && user.balance < amt) throw new Error("BROKE");
      const update = { transportLastWeekPaid: weekKey };
      if (amt > 0) update.balance = Math.round((user.balance - amt) * 100) / 100;
      t.update(userRef, update);
    });
  } catch (e) {
    if (e.message === "WRONG_DAY") return { ok: false, error: "Transport expenses can only be paid on their due day." };
    if (e.message === "ALREADY_PAID") return { ok: false, error: "You've already paid this week." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for this week's transport expenses." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (breakdown.total > 0) {
    const parts = [];
    if (breakdown.vehicleExpense > 0) parts.push(`${fmtMoney(breakdown.vehicleExpense)} vehicle upkeep`);
    if (breakdown.publicFeeDue > 0) parts.push(`${fmtMoney(breakdown.publicFeeDue)} public transport`);
    await logTxn(classCode, { type: "transport-expense", from: username, amount: breakdown.total, note: `Weekly transport expenses (${parts.join(" + ") || "none"})` });
  }
  return { ok: true, amount: breakdown.total, breakdown };
}

// Teacher-only: clear a student's currently-missed transport payment
// without taking any money from them — mirrors resolveMortgageOverdue.
// Refuses if there's nothing actually overdue, so it can't be used to
// pre-pay ahead of schedule.
async function resolveTransportOverdue(classCode, username) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let resolved = false;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const overdueWeekKey = overdueTransportWeekKey(user, cls);
      if (!overdueWeekKey) throw new Error("NOT_OVERDUE");
      resolved = true;
      t.update(userRef, { transportLastWeekPaid: overdueWeekKey });
    });
  } catch (e) {
    if (e.message === "NOT_OVERDUE") return { ok: false, error: "This student doesn't have an overdue transport payment." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: resolved };
}

/* ===================== Insurance ===================== */
// What can happen in a property or transport event. Every event made after
// this existed says which one it is ("incident"), and each insurance type
// below only covers the ones its description says. Events from before this
// have no incident and work exactly as they always did. `label` is what the
// teacher picks from, `you` is how it's put to the student.
const INSURANCE_INCIDENTS = {
  transport: [
    { key: "third-party", label: "Someone else's property was damaged", short: "damage to someone else's property", you: "You damaged someone else's property" },
    { key: "fire", label: "Fire", short: "fire", you: "Fire" },
    { key: "theft", label: "Theft", short: "theft", you: "Theft" },
    { key: "accident", label: "Accident (damage to their own vehicle)", short: "accidents", you: "Accident (damage to your own vehicle)" },
    { key: "vandalism", label: "Vandalism", short: "vandalism", you: "Vandalism" },
    { key: "storm", label: "Storm or flood", short: "storms and floods", you: "Storm or flood" }
  ],
  property: [
    { key: "contents", label: "Contents only (the things inside the home)", short: "contents only", you: "The things inside your home were damaged" },
    { key: "house", label: "The house only", short: "the house itself", you: "Your house was damaged" },
    { key: "both", label: "The house and its contents", short: "the house and contents", you: "Your house and everything in it were damaged" }
  ]
};
const ALL_TRANSPORT_INCIDENTS = INSURANCE_INCIDENTS.transport.map(i => i.key);

// The kinds of property and transport insurance a plan can be. Each plan of
// that coverage is one of these types, and an event (big or weekly) can
// list which types cover it and how much each one pays out — see
// insuranceClaimOptions below. Jobs and General plans have no types.
//   covers   — the incidents this type can be claimed for
//   vehicles — "cars": cars and bikes only; "trucks": trucks only
//   writeOff — Indemnity: when the house itself is damaged it pays the
//              house's full market price and the insurer takes the house
const INSURANCE_TYPES = {
  transport: [
    { key: "comprehensive", label: "Comprehensive Insurance", covers: ALL_TRANSPORT_INCIDENTS, vehicles: "cars",
      coversText: "Covers accidents, fire, theft, vandalism, storms, floods and damage to other people's property. Cars and bikes only." },
    { key: "third-party", label: "Third-Party Only", covers: ["third-party"], vehicles: "cars",
      coversText: "Covers damage you cause to other people's property only. Cars and bikes only." },
    { key: "tpft", label: "Third-Party, Fire, and Theft", covers: ["third-party", "fire", "theft"], vehicles: "cars",
      coversText: "Covers damage to other people's property, plus fire and theft. Cars and bikes only." },
    { key: "truck", label: "Truck Insurance", covers: ALL_TRANSPORT_INCIDENTS, vehicles: "trucks",
      coversText: "Covers anything that happens to your truck. Trucks only." }
  ],
  property: [
    { key: "contents", label: "Contents Insurance", covers: ["contents", "both"],
      coversText: "Covers the things inside your home, not the house itself." },
    { key: "indemnity", label: "Indemnity Cover (Present Value)", covers: ["contents", "house", "both"], writeOff: true,
      coversText: "Covers your contents (a set amount) and your house (its full market price, then the insurer takes the house)." },
    { key: "sum-insured", label: "Sum Insured Cover", covers: ["contents", "house", "both"],
      coversText: "Covers your contents and your house with a set amount. You keep your house." }
  ]
};

function insuranceTypeInfo(coverage, type) {
  return (INSURANCE_TYPES[coverage] || []).find(x => x.key === type) || null;
}

function insuranceTypeLabel(coverage, type) {
  const t = insuranceTypeInfo(coverage, type);
  return t ? t.label : "";
}

function insuranceTypeCoversText(coverage, type) {
  const t = insuranceTypeInfo(coverage, type);
  return t ? t.coversText : "";
}

function insuranceIncidentInfo(coverage, incident) {
  return (INSURANCE_INCIDENTS[coverage] || []).find(x => x.key === incident) || null;
}

// An event's incident, kept only when it's a real one for that coverage.
function cleanIncident(coverage, incident) {
  return insuranceIncidentInfo(coverage, incident) ? incident : null;
}

// Does this type cover this kind of event? Events with no incident (made
// before incidents existed) are covered by every type, same as before.
function typeCoversIncident(coverage, type, incident) {
  if (!incident) return true;
  const t = insuranceTypeInfo(coverage, type);
  return !!t && t.covers.includes(incident);
}

// Truck Insurance only covers trucks; the other transport types only cover
// cars and bikes. Unknown vehicle (or no type) = no restriction.
function typeFitsVehicle(coverage, type, vehicleType) {
  const t = insuranceTypeInfo(coverage, type);
  if (!t || !t.vehicles || !vehicleType) return true;
  return t.vehicles === "trucks" ? vehicleType === "truck" : vehicleType !== "truck";
}

// Indemnity pays the house's market price (and the insurer takes the
// house) when the house itself was damaged.
function isHouseWriteOff(coverage, type, incident) {
  const t = insuranceTypeInfo(coverage, type);
  return !!(t && t.writeOff && (incident === "house" || incident === "both"));
}

// A plan's type, kept only when it's a real type for that plan's coverage.
function cleanInsuranceType(coverage, type) {
  return insuranceTypeLabel(coverage, type) ? type : null;
}

// Property and transport plans belong to an insurance company (e.g. "AA Car
// Insurance") that students open to pick a plan from. Each plan carries its
// company's id and name (companyId / company) - a company is simply every
// plan sharing a companyId, so there's no separate list to keep in sync.
// Each company is either property or transport, never both. Plans made
// before companies existed (and all Jobs / General plans) have no company
// and show on their own, exactly as before.
function insurancePlanName(p) {
  if (!p) return "";
  return p.company ? `${p.company} — ${p.name}` : p.name;
}

// [{ id, name, coverage, plans: [...] }], in the order first seen.
function insuranceCompaniesOf(cls) {
  const map = new Map();
  (cls.insurancePlans || []).forEach(p => {
    if (!p.companyId || !INSURANCE_TYPES[p.coverage]) return;
    if (!map.has(p.companyId)) map.set(p.companyId, { id: p.companyId, name: p.company || "Insurance company", coverage: p.coverage, plans: [] });
    map.get(p.companyId).plans.push(p);
  });
  return [...map.values()];
}

// The company a property/transport plan is saved under: an existing
// company of the same coverage (by id), or a brand-new one when companyId
// is "new" and a name is given. Any other plan never has one.
function planCompanyFields(cls, coverage, companyId, companyName) {
  if (!INSURANCE_TYPES[coverage]) return { companyId: null, company: null };
  const existing = insuranceCompaniesOf(cls).find(c => c.id === companyId && c.coverage === coverage);
  if (existing) return { companyId: existing.id, company: existing.name };
  const name = String(companyName || "").trim().slice(0, 60);
  if (companyId === "new" && name) return { companyId: uid("insco"), company: name };
  return { companyId: null, company: null };
}

// A plan's own name. Company plans can leave it blank, which names it after
// its type (e.g. "Comprehensive Insurance").
function cleanPlanName(name, coverage, insType) {
  return String(name || "").trim() || insuranceTypeLabel(coverage, insType) || "Insurance plan";
}

// An event's list of covered types for saving: only real types for that
// coverage that cover what happened, each listed once, with a payout that's
// never negative. Indemnity on a house-only event needs no amount (it pays
// the house's market price), so that's stored as 0.
function cleanInsuranceCover(coverage, cover, incident) {
  const seen = new Set();
  return (Array.isArray(cover) ? cover : [])
    .filter(c => {
      if (!c || !insuranceTypeLabel(coverage, c.type) || seen.has(c.type)) return false;
      if (!typeCoversIncident(coverage, c.type, incident)) return false;
      seen.add(c.type);
      return true;
    })
    .map(c => ({
      type: c.type,
      payout: isHouseWriteOff(coverage, c.type, incident) && incident === "house"
        ? 0 : Math.max(0, Math.round((Number(c.payout) || 0) * 100) / 100)
    }));
}

// Plain-text summary of an event's covered types, e.g.
// "Comprehensive Insurance pays $1,000.00 · Third-Party Only pays $200.00".
function insuranceCoverSummary(coverage, cover, incident) {
  return (cover || []).map(c => {
    const label = insuranceTypeLabel(coverage, c.type);
    if (isHouseWriteOff(coverage, c.type, incident)) {
      return incident === "both"
        ? `${label} pays the house's market price + ${fmtMoney(c.payout)} for contents (the insurer takes the house)`
        : `${label} pays the house's market price (the insurer takes the house)`;
    }
    return `${label} pays ${fmtMoney(c.payout)}`;
  }).join(" · ");
}

// Which of the student's things an event hits: one of their vehicles for a
// transport event, one of their properties for a property event. Picked at
// random when the event is handed out and saved on it (assetId, assetName,
// assetType), so claims and losing the asset apply to that exact thing.
// Returns null when the student has nothing the event could hit.
//   allowRenters — a weekly contents-only (or older, no-incident) property
//                  event can also go to a student who rents their home;
//                  there's no house of theirs to record.
function pickEventAsset(cls, username, coverage, incident, allowRenters) {
  const pick = list => list[Math.floor(Math.random() * list.length)];
  if (coverage === "transport") {
    const mine = (cls.vehicles || []).filter(v => (v.owners || []).includes(username));
    if (!mine.length) return null;
    const v = pick(mine);
    return { assetId: v.id, assetName: v.name || "", assetType: normalizeVehicleType(v.type) };
  }
  if (coverage === "property") {
    const owned = (cls.properties || []).filter(p => p.owner === username);
    if (owned.length) {
      const p = pick(owned);
      return { assetId: p.id, assetName: p.name || "", assetType: "property" };
    }
    const houseHit = incident === "house" || incident === "both";
    const rents = (cls.properties || []).some(p => p.sublet && p.sublet.tenant === username)
      || (cls.npcProperties || []).some(p => p.tenant === username);
    return allowRenters && !houseHit && rents ? { assetId: null, assetName: "", assetType: "rented-home" } : null;
  }
  return {};
}

// The vehicle/property an event hit, looked up as it is right now (null if
// the student no longer owns it). Events from before this was recorded use
// the student's first one — the same one losing the asset always took.
function eventAssetNow(cls, username, coverage, entry) {
  const e = entry || {};
  if (coverage === "transport") {
    const mine = (cls.vehicles || []).filter(v => (v.owners || []).includes(username));
    const vehicle = e.assetId ? (mine.find(v => v.id === e.assetId) || null) : (mine[0] || null);
    return { vehicle, vehicleType: vehicle ? normalizeVehicleType(vehicle.type) : (e.assetType || null) };
  }
  if (coverage === "property") {
    const mine = (cls.properties || []).filter(p => p.owner === username);
    const property = e.assetId ? (mine.find(p => p.id === e.assetId) || null)
      : (e.assetType === "rented-home" ? null : (mine[0] || null));
    return { property };
  }
  return {};
}

// Hands a property back to the market, clearing the same fields selling it
// does (see sellProperty) — including any classmate renting it, since
// there's no owner left for them to rent from.
function releasePropertyFields(prop) {
  prop.owner = null;
  prop.mortgage = null;
  prop.occupancy = null;
  prop.rentLastWeekPaid = null;
  prop.purchasePrice = null;
  prop.sublet = null;
}

// What an Indemnity write-off of this property works out to — the same
// way selling it does: its market price, minus any mortgage still owed
// and the break fee for ending that mortgage early.
function propertyWriteOffAmounts(cls, prop) {
  let mortgagePayoff = 0, breakFee = 0;
  if (prop.mortgage) {
    mortgagePayoff = typeof mortgageWeekAmount === "function"
      ? mortgageWeekAmount(prop.mortgage).balanceBefore
      : (Number(prop.mortgage.principalRemaining) || 0);
    breakFee = Math.max(0, Number(cls.propertyBreakFee) || 0);
  }
  return {
    market: Math.max(0, Math.round((Number(prop.price) || 0) * 100) / 100),
    mortgagePayoff: Math.round((Number(mortgagePayoff) || 0) * 100) / 100,
    breakFee
  };
}

// Every plan the student holds that can be claimed against an event, with
// what the claim works out to — cheapest for the student first.
//   coverage — which plans count: "general", "jobs", "property" or "transport"
//   cover    — the event's [{ type, payout }] list. Empty (every event made
//              before types existed, or one with no types ticked) means any
//              plan of that coverage counts and covers the whole cost,
//              exactly how claims always worked.
//   cost     — the event's loss, as a positive amount
//   entry    — the event itself (optional): its incident decides which types
//              cover it, and the vehicle/property it hit decides whether
//              Truck Insurance or the car types apply and what an Indemnity
//              write-off is worth (see eventAssetNow).
// Each option has:
//   studentPays — big events: what the student pays to claim (the plan's
//                 excess plus whatever the payout doesn't cover)
//   payout      — weekly events (already charged): what the insurer pays
//                 back (the covered amount minus the excess, never below 0)
// An Indemnity claim on house damage is a write-off instead (writeOff:
// true): the insurer pays the house's full market price (plus the set
// amount for contents if they were damaged too), any mortgage still owed
// and its break fee come out of that first, then the excess — and the
// house goes to the insurer. `net` is what the student ends up with (it
// can be negative, same as selling a house with a big mortgage); for a
// write-off both studentPays and payout reflect it.
function insuranceClaimOptions(cls, user, coverage, cover, cost, entry) {
  const r2 = n => Math.round(n * 100) / 100;
  const loss = Math.max(0, Number(cost) || 0);
  const typed = Array.isArray(cover) && cover.length > 0;
  const incident = entry && entry.incident ? entry.incident : null;
  const username = (entry && entry.studentUser) || user.username;
  const asset = eventAssetNow(cls, username, coverage, entry);
  return (user.insurance || [])
    .map(id => (cls.insurancePlans || []).find(p => p.id === id))
    .filter(p => p && p.coverage === coverage)
    .map(plan => {
      const row = typed ? cover.find(c => c.type === plan.insType) : null;
      if (typed && !row) return null;
      if (plan.insType && !typeCoversIncident(coverage, plan.insType, incident)) return null;
      if (coverage === "transport" && plan.insType && !typeFitsVehicle(coverage, plan.insType, asset.vehicleType)) return null;
      const excess = Math.max(0, Number(plan.excess) || 0);
      if (typed && isHouseWriteOff(coverage, plan.insType, incident)) {
        const property = asset.property;
        if (!property) return null; // no house of theirs to write off (sold it, or they rent)
        const w = propertyWriteOffAmounts(cls, property);
        const contents = incident === "both" ? Math.max(0, Number(row.payout) || 0) : 0;
        const net = r2(w.market + contents - w.mortgagePayoff - w.breakFee - excess);
        return { plan, writeOff: true, property, houseValue: w.market, contents, mortgagePayoff: w.mortgagePayoff,
          breakFee: w.breakFee, excess, net, covered: loss, uncovered: 0, studentPays: r2(-net), payout: net };
      }
      let covered = loss;
      if (typed) covered = Math.min(loss, Math.max(0, Number(row.payout) || 0));
      const uncovered = r2(loss - covered);
      return { plan, covered: r2(covered), excess, uncovered, studentPays: r2(excess + uncovered), payout: r2(Math.max(0, covered - excess)) };
    })
    .filter(Boolean)
    .sort((a, b) => a.studentPays - b.studentPays);
}

// Plain-text breakdown of a write-off option, e.g. "The insurer pays
// $300,000.00 for 12 Smith St, minus $250,000.00 mortgage and $50.00
// excess: you get $49,950.00 and the house goes to the insurer."
function writeOffText(o) {
  const name = (o.property && o.property.name) || "your house";
  const minus = [];
  if (o.mortgagePayoff > 0) minus.push(`${fmtMoney(o.mortgagePayoff)} left on the mortgage`);
  if (o.breakFee > 0) minus.push(`${fmtMoney(o.breakFee)} mortgage break fee`);
  if (o.excess > 0) minus.push(`${fmtMoney(o.excess)} excess`);
  return `The insurer pays ${fmtMoney(o.houseValue)} (today's market price) for ${name}`
    + (o.contents > 0 ? ` + ${fmtMoney(o.contents)} for contents` : "")
    + (minus.length ? `, minus ${minus.length > 1 ? minus.slice(0, -1).join(", ") + " and " + minus[minus.length - 1] : minus[0]}` : "")
    + (o.net >= 0 ? `: you get ${fmtMoney(o.net)}` : `: you still owe ${fmtMoney(-o.net)}`)
    + ` and ${name} goes to the insurer.`;
}

async function addInsurancePlan(classCode, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const coverage = plan.coverage || "general";
    const insType = cleanInsuranceType(coverage, plan.insType);
    cls.insurancePlans.push({
      id: uid("ins"), name: cleanPlanName(plan.name, coverage, insType), price: Number(plan.price),
      excess: Number(plan.excess), coverage,
      insType,
      ...planCompanyFields(cls, coverage, plan.companyId, plan.companyName),
      description: plan.description || "", stars: Math.max(0, Math.min(5, Number(plan.stars) || 0)),
      signupFee: Math.max(0, Number(plan.signupFee) || 0),
      active: true
    });
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
async function removeInsurancePlan(classCode, planId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.insurancePlans = cls.insurancePlans.filter(p => p.id !== planId);
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
async function editInsurancePlan(classCode, planId, plan) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const idx = cls.insurancePlans.findIndex(p => p.id === planId);
    if (idx === -1) return;
    const existing = cls.insurancePlans[idx];
    const coverage = plan.coverage || "general";
    const insType = cleanInsuranceType(coverage, plan.insType);
    cls.insurancePlans[idx] = {
      ...existing,
      name: cleanPlanName(plan.name, coverage, insType), price: Number(plan.price),
      excess: Number(plan.excess), coverage,
      insType,
      ...planCompanyFields(cls, coverage, plan.companyId, plan.companyName),
      description: plan.description || "", stars: Math.max(0, Math.min(5, Number(plan.stars) || 0)),
      signupFee: Math.max(0, Number(plan.signupFee) || 0)
    };
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
// Renames a company - every plan under it carries the name, so all of
// them are updated together.
async function renameInsuranceCompany(classCode, companyId, name) {
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) return;
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.insurancePlans.forEach(p => { if (p.companyId === companyId) p.company = clean; });
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}
// Removes a company and every plan under it (same as removing each plan).
async function removeInsuranceCompany(classCode, companyId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.insurancePlans = cls.insurancePlans.filter(p => p.companyId !== companyId);
    t.update(classRef, { insurancePlans: cls.insurancePlans });
  });
}

/* ===================== Side hustles =====================
   Teacher defines a list of side hustle "jobs", each with a payout amount
   per possible check-in hour (0-23, NZ time). A student picks one hustle
   and one hour of the day as their standing check-in time, then must
   check in every day within 15 minutes after that hour to get paid. */
async function addSideHustle(classCode, hustle) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.sideHustles.push({
      id: uid("sh"), name: hustle.name, description: hustle.description || "",
      payouts: hustle.payouts || {}
    });
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}
async function editSideHustle(classCode, hustleId, hustle) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const idx = cls.sideHustles.findIndex(h => h.id === hustleId);
    if (idx === -1) return;
    cls.sideHustles[idx] = {
      ...cls.sideHustles[idx],
      name: hustle.name, description: hustle.description || "", payouts: hustle.payouts || {}
    };
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}
async function removeSideHustle(classCode, hustleId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.sideHustles = cls.sideHustles.filter(h => h.id !== hustleId);
    t.update(classRef, { sideHustles: cls.sideHustles });
  });
}

// Student picks (or changes) which hustle + hour they're committing to.
// First-ever pick applies immediately. After that, changes require the
// teacher's approval (this just stops someone quietly retiming their
// check-in to whenever they happen to be checking in).
async function requestSideHustleChange(username, classCode, hustleId, hour) {
  if (await isModuleLockedForStudent(username, classCode, "sidehustle")) {
    return { ok: false, error: "Side hustles are locked for you right now. Check the message on your dashboard for what will unlock them." };
  }
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  const hustle = (cls.sideHustles || []).find(h => h.id === hustleId);
  if (!hustle) return { ok: false, error: "That side hustle isn't available." };
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: "Pick a valid check-in time." };

  const user = await getUser(username);
  if (!user) return { ok: false, error: "User not found." };

  if (!user.sideHustle || !user.sideHustle.hustleId) {
    // Nothing set yet — no approval needed for the first pick.
    const res = await setStudentSideHustle(username, classCode, hustleId, h);
    return res;
  }

  if (user.sideHustle.hustleId === hustleId && user.sideHustle.checkinHour === h) {
    return { ok: false, error: "That's already your current side hustle." };
  }

  await usersCol().doc(username).update({
    sideHustleRequest: { hustleId, checkinHour: h, status: "pending", requestedAt: nowStr() },
    sideHustleDenialNote: null
  });
  return { ok: true, pending: true };
}

// Internal — actually applies a hustle/hour to a student. Used for the
// first-ever pick and by the teacher when approving a change request.
async function setStudentSideHustle(username, classCode, hustleId, hour) {
  const cls = await getClass(classCode);
  if (!cls) return { ok: false, error: "Class not found." };
  const hustle = (cls.sideHustles || []).find(h => h.id === hustleId);
  if (!hustle) return { ok: false, error: "That side hustle isn't available." };
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: "Pick a valid check-in time." };

  const user = await getUser(username);
  if (!user) return { ok: false, error: "User not found." };
  const prev = user.sideHustle || {};
  const sameCommitment = prev.hustleId === hustleId && prev.checkinHour === h;
  await usersCol().doc(username).update({
    sideHustle: {
      hustleId, checkinHour: h,
      lastCheckin: sameCommitment ? (prev.lastCheckin || null) : null,
      streak: sameCommitment ? (prev.streak || 0) : 0
    }
  });
  return { ok: true };
}

// Teacher approves a pending change request — applies it and clears the request.
async function approveSideHustleChange(username, classCode) {
  const user = await getUser(username);
  if (!user || !user.sideHustleRequest || user.sideHustleRequest.status !== "pending") {
    return { ok: false, error: "No pending request." };
  }
  const req = user.sideHustleRequest;
  const res = await setStudentSideHustle(username, classCode, req.hustleId, req.checkinHour);
  if (!res.ok) return res;
  await usersCol().doc(username).update({ sideHustleRequest: null });
  return { ok: true };
}

// Teacher denies a pending change request — leaves the student's current
// hustle/hour untouched, but leaves a note explaining why.
async function denySideHustleChange(username, reason) {
  await usersCol().doc(username).update({
    sideHustleRequest: null,
    sideHustleDenialNote: (reason || "").trim() || "Your teacher denied this change."
  });
  return { ok: true };
}

// Pays out if the student is inside their 15-minute check-in window and
// hasn't already checked in today (NZ calendar day).
async function checkinSideHustle(username, classCode) {
  if (await isModuleLockedForStudent(username, classCode, "sidehustle")) {
    return { ok: false, error: "Side hustles are locked for you right now. Check the message on your dashboard for what will unlock them." };
  }
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let amount = 0, hustleName = "", streak = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("GONE");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const sh = user.sideHustle;
      if (!sh || !sh.hustleId) throw new Error("NO_HUSTLE");
      const hustle = cls.sideHustles.find(h => h.id === sh.hustleId);
      if (!hustle) throw new Error("NO_HUSTLE");

      const { hour, minute } = nzHourMinute();
      if (hour !== sh.checkinHour || minute > 15) throw new Error("WRONG_TIME");

      const todayKey = nzDateKey();
      if (sh.lastCheckin === todayKey) throw new Error("ALREADY");

      amount = Number(hustle.payouts[sh.checkinHour]) || 0;
      const life = getLifeBenefitTotals(user);
      if (life.incomePercent) amount = Math.round(amount * (1 + life.incomePercent / 100) * 100) / 100;
      hustleName = hustle.name;
      streak = (sh.streak || 0) + 1;
      const newBal = Math.round((user.balance + amount) * 100) / 100;
      t.update(userRef, {
        balance: newBal,
        "sideHustle.lastCheckin": todayKey,
        "sideHustle.streak": streak
      });
    });
  } catch (e) {
    if (e.message === "NO_HUSTLE") return { ok: false, error: "Pick a side hustle and check-in time first." };
    if (e.message === "WRONG_TIME") return { ok: false, error: "You can only check in within 15 minutes after your chosen time." };
    if (e.message === "ALREADY") return { ok: false, error: "You've already checked in today." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "side-hustle", to: username, amount, note: `Side hustle check-in — ${hustleName}` });
  return { ok: true, amount, streak };
}

async function buyInsurance(username, classCode, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let planName = "";
  let fee = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const plan = cls.insurancePlans.find(p => p.id === planId && p.active);
      if (!plan) throw new Error("NOT_FOUND");
      user.insurance = user.insurance || [];
      if (user.insurance.includes(planId)) throw new Error("ALREADY");
      planName = insurancePlanName(plan);
      fee = Math.max(0, Number(plan.signupFee) || 0);
      fee = applyLifeDiscount(user, "insurance", fee);
      const isTeacher = user.role === "teacher";
      if (!isTeacher && fee > 0 && user.balance < fee) throw new Error("BROKE");
      user.insurance.push(planId);
      const update = { insurance: user.insurance };
      if (!isTeacher && fee > 0) update.balance = Math.round((user.balance - fee) * 100) / 100;
      t.update(userRef, update);
    });
  } catch (e) {
    if (e.message === "ALREADY") return { ok: false, error: "You already have this plan." };
    if (e.message === "BROKE") return { ok: false, error: `You don't have enough money to pay the ${fmtMoney(fee)} sign-up fee.` };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (fee > 0) {
    await logTxn(classCode, { type: "insurance-signup-fee", from: username, amount: fee, note: `Sign-up fee for insurance: ${planName}` });
  }
  await logTxn(classCode, { type: "insurance-buy", from: username, amount: 0, note: `Signed up for insurance: ${planName} — premiums due weekly` });
  return { ok: true };
}
async function cancelInsurance(username, planId) {
  const userRef = usersCol().doc(username);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    user.insurance = (user.insurance || []).filter(id => id !== planId);
    t.update(userRef, { insurance: user.insurance });
  });
}

/* ===================== Class store ===================== */
async function addStoreItem(classCode, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    // stockTotal is the "bank" figure the teacher sets; stock is what's
    // actually left to buy right now; sold tracks units bought so far so
    // that a later change to stockTotal (see updateStoreItem) can be
    // applied as "bank total minus what's already gone out the door"
    // instead of blindly overwriting the remaining count.
    const stockTotal = item.stock === "" || item.stock === undefined ? null : Number(item.stock);
    cls.storeItems.push({
      id: uid("item"), name: item.name, price: Number(item.price),
      description: item.description || "", effect: item.effect || "",
      stock: stockTotal, stockTotal, sold: 0,
      stars: Math.max(0, Math.min(5, Number(item.stars) || 0)),
      countsNetWorth: item.countsNetWorth !== false,
      archived: false
    });
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
async function updateStoreItem(classCode, itemId, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.storeItems.find(i => i.id === itemId);
    if (!existing) return;
    existing.name = item.name;
    existing.price = Number(item.price);
    existing.description = item.description || "";
    existing.effect = item.effect || "";
    const newStockTotal = item.stock === "" || item.stock === undefined ? null : Number(item.stock);
    const sold = existing.sold || 0;
    existing.stockTotal = newStockTotal;
    // Re-derive what's left from the new bank total minus units already
    // sold (e.g. bank set to 5, 2 already sold -> 3 left), rather than
    // setting remaining stock straight to the entered number. Floored at
    // 0 in case the teacher lowers the bank below what's already sold.
    existing.stock = newStockTotal === null ? null : Math.max(0, newStockTotal - sold);
    existing.stars = Math.max(0, Math.min(5, Number(item.stars) || 0));
    existing.countsNetWorth = item.countsNetWorth !== false;
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
// Removing an item from the store no longer deletes its record outright —
// it's archived instead (hidden from the buyable list) so that students who
// already own one can still sell it back for a refund, and it still counts
// toward lifestyle rating / net worth as before.
async function removeStoreItem(classCode, itemId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const item = cls.storeItems.find(i => i.id === itemId);
    if (!item) return;
    item.archived = true;
    t.update(classRef, { storeItems: cls.storeItems });
  });
}
// Saves the teacher's chosen display order. The array order of
// cls.storeItems IS the order students see. Archived items keep their
// slots; only the live items are rearranged into `orderedIds` order (any
// live item not listed, e.g. added a moment ago, is kept at the end).
// Optionally saves the sort mode in the same transaction.
async function reorderStoreItems(classCode, orderedIds, sortMode) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const byId = new Map(cls.storeItems.map(i => [i.id, i]));
    const seen = new Set();
    const ordered = [];
    (orderedIds || []).forEach(id => {
      const it = byId.get(id);
      if (it && !it.archived && !seen.has(id)) { seen.add(id); ordered.push(it); }
    });
    cls.storeItems.forEach(it => { if (!it.archived && !seen.has(it.id)) ordered.push(it); });
    let k = 0;
    cls.storeItems = cls.storeItems.map(it => it.archived ? it : ordered[k++]);
    const upd = { storeItems: cls.storeItems };
    if (sortMode) upd.storeSortMode = sortMode;
    t.update(classRef, upd);
  });
}
async function setStoreSortMode(classCode, mode) {
  const allowed = ["manual", "name-asc", "name-desc", "price-asc", "price-desc", "stars-desc", "stock-asc", "sold-desc"];
  if (!allowed.includes(mode)) throw new Error("Unknown sort mode");
  await classesCol().doc(classCode).update({ storeSortMode: mode });
}
async function buyStoreItem(username, classCode, itemId, qty) {
  qty = Math.floor(Number(qty)) || 1;
  if (qty < 1) qty = 1;
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "", taxAmount = 0, cashPaid = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item || item.archived) throw new Error("NOT_FOUND");
      if (item.stock !== null && item.stock < qty) throw new Error("OUT");
      const discountedPrice = applyLifeDiscount(user, "store", item.price);
      const { total, taxAmount: tax } = applyTaxToExpense(cls, "store", discountedPrice * qty);
      taxAmount = tax;
      cashPaid = total;
      const isTeacher = user.role === "teacher";
      if (!isTeacher && user.balance < total) throw new Error("BROKE");
      itemName = item.name;
      if (item.stock !== null) item.stock -= qty;
      item.sold = (item.sold || 0) + qty;
      user.storeItems = user.storeItems || [];
      for (let i = 0; i < qty; i++) user.storeItems.push(itemId);
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance - total) * 100) / 100, storeItems: user.storeItems });
      else t.update(userRef, { storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "OUT") return { ok: false, error: "Not enough stock left for that quantity." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-buy", from: username, amount: cashPaid, note: `Bought from store: ${itemName}${qty > 1 ? ` ×${qty}` : ""}` + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true, qty };
}

// Sell back one unit of an owned store item for 80% of its base price.
// Removes it from the student's owned items (which also reduces their
// lifestyle rating automatically, since that's computed live from
// user.storeItems) and restocks it if the item has limited stock.
// Teacher-only: gift a store item to a student for free, ignoring price
// and stock entirely (even if the item shows 0 left). Doesn't touch the
// item's stock/sold counters, since this is a manual override outside
// the normal buy/sell accounting.
async function giveFreeStoreItem(classCode, username, itemId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item) throw new Error("NOT_FOUND");
      itemName = item.name;
      user.storeItems = user.storeItems || [];
      user.storeItems.push(itemId);
      t.update(userRef, { storeItems: user.storeItems });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-gift", to: username, amount: 0, note: `Given for free by teacher: ${itemName}` });
  return { ok: true };
}

async function sellStoreItem(username, classCode, itemId, rate) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "", payout = 0, effectiveRate = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item) throw new Error("NOT_FOUND");
      user.storeItems = user.storeItems || [];
      const idx = user.storeItems.indexOf(itemId);
      if (idx === -1) throw new Error("NOT_OWNED");
      user.storeItems.splice(idx, 1);
      itemName = item.name;
      effectiveRate = rate !== undefined ? rate : 0.8;
      payout = Math.round(item.price * effectiveRate * 100) / 100;
      if (item.stock !== null) item.stock += 1;
      item.sold = Math.max(0, (item.sold || 0) - 1);
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + payout) * 100) / 100, storeItems: user.storeItems });
      else t.update(userRef, { storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "NOT_OWNED") return { ok: false, error: "You don't own that item." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-sell", to: username, amount: payout, note: `Sold back to store: ${itemName} (${Math.round(effectiveRate * 100)}% refund)` });
  return { ok: true, payout };
}

// Same as sellStoreItem, but removes `qty` units of the same item in one
// transaction and logs a single combined activity entry instead of one
// per unit. Used by the teacher's bulk-remove control on a student's
// profile. Silently caps qty at how many the student actually owns.
async function sellStoreItemBulk(username, classCode, itemId, qty, rate) {
  qty = Math.max(1, Math.floor(Number(qty)) || 1);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let itemName = "", totalPayout = 0, effectiveRate = 0, removedCount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const item = cls.storeItems.find(i => i.id === itemId);
      if (!item) throw new Error("NOT_FOUND");
      user.storeItems = user.storeItems || [];
      const ownedCount = user.storeItems.filter(id => id === itemId).length;
      if (ownedCount === 0) throw new Error("NOT_OWNED");
      removedCount = Math.min(qty, ownedCount);
      itemName = item.name;
      effectiveRate = rate !== undefined ? rate : 0.8;
      const perUnitPayout = Math.round(item.price * effectiveRate * 100) / 100;
      for (let i = 0; i < removedCount; i++) {
        const idx = user.storeItems.indexOf(itemId);
        user.storeItems.splice(idx, 1);
        if (item.stock !== null) item.stock += 1;
        item.sold = Math.max(0, (item.sold || 0) - 1);
      }
      totalPayout = Math.round(perUnitPayout * removedCount * 100) / 100;
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + totalPayout) * 100) / 100, storeItems: user.storeItems });
      else t.update(userRef, { storeItems: user.storeItems });
      t.update(classRef, { storeItems: cls.storeItems });
    });
  } catch (e) {
    if (e.message === "NOT_OWNED") return { ok: false, error: "You don't own that item." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "store-sell", to: username, amount: totalPayout, note: `Sold back to store: ${itemName} ×${removedCount} (${Math.round(effectiveRate * 100)}% refund)` });
  return { ok: true, payout: totalPayout, removed: removedCount };
}

/* ===================== Life module =====================
   Teacher-defined "life event" templates (cls.lifeItems), each bundling
   any mix of benefits. Granting one to a student (grantLifeItem) copies a
   snapshot of the template's benefits onto user.lifeItems — a student can
   hold any number of these at once and their effects stack (see
   getLifeBenefitTotals, used everywhere a benefit actually applies). */
// Each life item template also carries its own allowance frequency —
// "weekly" (default: paid alongside the class's normal Pay Day, see
// _payStudentWeeklyLifeAllowance) or "daily" (paid once per calendar day
// regardless of Pay Day, see _payStudentDailyLifeAllowance). Only the
// allowance benefit cares about this; every other benefit (income %,
// discounts, lifestyle points, tax cut) applies continuously either way.
function normalizeLifeFrequency(f) {
  return f === "daily" ? "daily" : "weekly";
}
function sanitizeLifeBenefits(b) {
  b = b || {};
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  return {
    cashOnce: num(b.cashOnce),                                  // one-time, paid the moment it's granted
    allowance: Math.max(0, num(b.allowance)),                   // recurring $, paid alongside every pay day
    incomePercent: num(b.incomePercent),                        // % added to job wages + side hustle pay (can be negative)
    discountStore: Math.max(0, Math.min(95, num(b.discountStore))),
    discountTransport: Math.max(0, Math.min(95, num(b.discountTransport))),
    discountProperty: Math.max(0, Math.min(95, num(b.discountProperty))),
    discountInsurance: Math.max(0, Math.min(95, num(b.discountInsurance))),
    lifestylePoints: num(b.lifestylePoints),                    // flat add to lifestyle rating (can be negative)
    taxCutPercent: Math.max(0, Math.min(95, num(b.taxCutPercent))) // % knocked off the student's wage tax bill
  };
}
// Sums every benefit across all of a student's currently-held life items.
// Percentage fields are clamped after summing so stacking several
// generous items can't push a discount to/past 100% or flip income
// negative in a runaway way. Safe to call with a bare user doc (or one
// with no lifeItems at all) from anywhere in this file.
function getLifeBenefitTotals(user) {
  const items = (user && user.lifeItems) || [];
  const totals = { allowance: 0, incomePercent: 0, discountStore: 0, discountTransport: 0, discountProperty: 0, discountInsurance: 0, lifestylePoints: 0, taxCutPercent: 0 };
  items.forEach(it => {
    const b = it.benefits || {};
    Object.keys(totals).forEach(k => { totals[k] += Number(b[k]) || 0; });
  });
  ["discountStore", "discountTransport", "discountProperty", "discountInsurance", "taxCutPercent"].forEach(k => {
    totals[k] = Math.min(95, Math.max(0, totals[k]));
  });
  totals.incomePercent = Math.max(-95, totals.incomePercent);
  return totals;
}
// Sums just the allowance from a student's life items that match one
// frequency ("weekly" or "daily"), so the two payout jobs (weekly, inside
// Pay Day; daily, _payStudentDailyLifeAllowance) each only pay their own
// slice and never double up on the other's items.
function getLifeAllowanceByFrequency(user, frequency) {
  const items = (user && user.lifeItems) || [];
  let total = 0;
  items.forEach(it => {
    if (normalizeLifeFrequency(it.frequency) !== frequency) return;
    total += Number((it.benefits || {}).allowance) || 0;
  });
  return Math.round(total * 100) / 100;
}
// Applies a student's stacked discount for one category ("store",
// "transport", "property", "insurance") to a base price.
function applyLifeDiscount(user, category, baseAmount) {
  const totals = getLifeBenefitTotals(user);
  const key = "discount" + category.charAt(0).toUpperCase() + category.slice(1);
  const pct = totals[key] || 0;
  if (!pct || !(baseAmount > 0)) return Math.round((baseAmount || 0) * 100) / 100;
  return Math.round(baseAmount * (1 - pct / 100) * 100) / 100;
}
// Builds the price markup shown on browse cards in Store/Transport/
// Property/Insurance: a plain price normally, or — when the signed-in
// student's stacked Life family-event benefits knock a % off this
// category — the original price crossed out next to the discounted one,
// with a small badge naming the cut. Safe to call with a teacher doc (or
// any user with no lifeItems): falls back to a plain price since
// getLifeBenefitTotals then returns all zeros.
function priceWithLifeDiscount(user, category, baseAmount) {
  const base = Math.round((Number(baseAmount) || 0) * 100) / 100;
  const totals = getLifeBenefitTotals(user);
  const key = "discount" + category.charAt(0).toUpperCase() + category.slice(1);
  const pct = totals[key] || 0;
  if (!pct || !(base > 0)) {
    return `<strong>${fmtMoney(base)}</strong>`;
  }
  const discounted = applyLifeDiscount(user, category, base);
  return `<span class="life-discount-price" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <s class="muted-small" style="opacity:.7;">${fmtMoney(base)}</s>
      <strong class="ticker-up" style="font-size:1.05em;">${fmtMoney(discounted)}</strong>
      <span class="badge lilac">${icon("trophy", 11)}${pct}% off</span>
    </span>`;
}
async function addLifeItem(classCode, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.lifeItems.push({
      id: uid("life"),
      name: (item.name || "").trim() || "Untitled life event",
      description: (item.description || "").trim(),
      benefits: sanitizeLifeBenefits(item.benefits),
      frequency: normalizeLifeFrequency(item.frequency)
    });
    t.update(classRef, { lifeItems: cls.lifeItems });
  });
}
async function updateLifeItem(classCode, itemId, item) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.lifeItems.find(i => i.id === itemId);
    if (!existing) return;
    existing.name = (item.name || "").trim() || "Untitled life event";
    existing.description = (item.description || "").trim();
    existing.benefits = sanitizeLifeBenefits(item.benefits);
    existing.frequency = normalizeLifeFrequency(item.frequency);
    t.update(classRef, { lifeItems: cls.lifeItems });
  });
}
// Removing a template only stops it being handed out again — students who
// already have it keep their snapshot of its benefits untouched.
async function removeLifeItem(classCode, itemId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.lifeItems = cls.lifeItems.filter(i => i.id !== itemId);
    t.update(classRef, { lifeItems: cls.lifeItems });
  });
}
// Grants a snapshot of a life item template to a student. Any one-time
// cash benefit is paid immediately; everything else (allowance, income %,
// discounts, lifestyle points, tax cut) takes effect passively wherever
// getLifeBenefitTotals()/applyLifeDiscount() are consulted. Students can
// hold more than one at once — nothing here dedupes against what they
// already have, so giving the same template twice stacks it twice.
async function grantLifeItem(classCode, username, templateId, teacherUsername) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let tmpl = null, cashOnce = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      tmpl = cls.lifeItems.find(i => i.id === templateId);
      if (!tmpl) throw new Error("NOT_FOUND");
      user.lifeItems = user.lifeItems || [];
      const benefits = sanitizeLifeBenefits(tmpl.benefits);
      cashOnce = benefits.cashOnce;
      user.lifeItems.push({
        id: uid("life"), templateId: tmpl.id, name: tmpl.name,
        description: tmpl.description, benefits,
        frequency: normalizeLifeFrequency(tmpl.frequency),
        grantedAt: nzDateKey(), grantedBy: teacherUsername || null
      });
      const isTeacher = user.role === "teacher";
      const update = { lifeItems: user.lifeItems };
      if (!isTeacher && cashOnce) update.balance = Math.round((user.balance + cashOnce) * 100) / 100;
      t.update(userRef, update);
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "That life item no longer exists." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "life-grant", to: username, amount: cashOnce, note: `Life event: ${tmpl.name}` });
  return { ok: true };
}
async function revokeLifeItem(classCode, username, grantId) {
  const userRef = usersCol().doc(username);
  let itemName = "";
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    const items = user.lifeItems || [];
    const found = items.find(i => i.id === grantId);
    if (found) itemName = found.name;
    t.update(userRef, { lifeItems: items.filter(i => i.id !== grantId) });
  });
  if (itemName) {
    await logTxn(classCode, { type: "life-revoke", from: username, amount: 0, note: `Life event removed: ${itemName}` });
  }
  return { ok: true };
}

/* ===================== Big events ===================== */
const BIG_EVENT_MODULES = ["income", "property", "transport", "general"];
// "General" isn't tied to any module — it's only valid on "good" events
// (a pure windfall with nothing at stake), since "bad" events need a real
// job/property/vehicle to attach the loss/insurance-claim to.
const BIG_EVENT_ASSET_MODULES = ["income", "property", "transport"];
const MODULE_TO_COVERAGE = { income: "jobs", property: "property", transport: "transport" };

// "general" is only a legal module for "good" events — a "bad" event
// always needs a real asset to threaten/insure, so it silently falls back
// to "income" if someone tries to save a bad event as general (shouldn't
// happen via the UI, but keep the data model honest either way).
function resolveBigEventModule(module, kind) {
  const isGood = kind === "good";
  const allowed = isGood ? BIG_EVENT_MODULES : BIG_EVENT_ASSET_MODULES;
  if (allowed.includes(module)) return module;
  return isGood ? "general" : "income";
}

async function addBigEventDef(classCode, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const kind = ev.kind === "good" ? "good" : "bad";
    const module = resolveBigEventModule(ev.module, kind);
    cls.bigEventDefs.push({
      id: uid("big"), name: ev.name,
      module,
      kind,
      // What happened (fire, theft, house damage...) — decides which
      // insurance types can cover it. Only for bad property/transport events.
      incident: kind === "bad" ? cleanIncident(MODULE_TO_COVERAGE[module], ev.incident) : null,
      // Which property/transport insurance types cover this event and how
      // much each pays out (see insuranceClaimOptions). Empty = any plan of
      // the matching coverage covers the whole cost, same as before.
      insuranceCover: kind === "bad" ? cleanInsuranceCover(MODULE_TO_COVERAGE[module],
        ev.insuranceCover, cleanIncident(MODULE_TO_COVERAGE[module], ev.incident)) : [],
      cost: Math.max(0, Number(ev.cost) || 0), description: ev.description || "", active: true,
      // Whether NOT paying this event costs the student the related
      // job/property/vehicle. Defaults true so existing "bad" events keep
      // behaving exactly as before. When false, the event is still tied to
      // the module (for eligibility + insurance matching) but the student
      // never loses the asset over it — they just owe the amount, covered
      // by insurance if they have a matching plan. Meaningless (and
      // ignored) for "general" events since there's no asset either way.
      takesAsset: ev.takesAsset === false ? false : true
    });
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
async function removeBigEventDef(classCode, defId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.bigEventDefs = cls.bigEventDefs.filter(e => e.id !== defId);
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
async function updateBigEventDef(classCode, defId, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.bigEventDefs.find(e => e.id === defId);
    if (!existing) return;
    const kind = ev.kind === "good" ? "good" : "bad";
    existing.name = ev.name;
    existing.kind = kind;
    existing.module = resolveBigEventModule(ev.module, kind);
    existing.incident = kind === "bad" ? cleanIncident(MODULE_TO_COVERAGE[existing.module], ev.incident) : null;
    existing.insuranceCover = kind === "bad" ? cleanInsuranceCover(MODULE_TO_COVERAGE[existing.module], ev.insuranceCover, existing.incident) : [];
    existing.cost = Math.max(0, Number(ev.cost) || 0);
    existing.description = ev.description || "";
    existing.takesAsset = ev.takesAsset === false ? false : true;
    t.update(classRef, { bigEventDefs: cls.bigEventDefs });
  });
}
// Once per NZ calendar week, each student has a 1-in-4 chance of being hit
// with one random active big event, left "pending" until they respond.
// Bypasses the once-per-week guard and generates this week's big events
// right now — same idea as forceWeeklyEvents. Also skips the normal 25%
// per-student chance, so every eligible student gets one on a manual run
// instead of being left out by the dice roll.
async function forceWeeklyBigEvents(classCode) {
  await classesCol().doc(classCode).update({ lastBigEventWeekRun: null });
  return await processWeeklyBigEvents(classCode, { forceAll: true });
}

async function processWeeklyBigEvents(classCode, opts) {
  const forceAll = !!(opts && opts.forceAll);
  // Same as processWeeklyEvents: lastBigEventWeekRun is teacher-only, so
  // a student's page can't claim the week — skip the refused round trip.
  if (!forceAll && t29SessionStudent()) return 0;
  const classRef = classesCol().doc(classCode);
  const weekKey = isoWeekKey(new Date());
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls || cls.lastBigEventWeekRun === weekKey) return 0;
  if (cls.archived && !forceAll) return 0;
  const activeDefs = (cls.bigEventDefs || []).filter(e => e.active);
  if (activeDefs.length === 0) {
    await classRef.update({ lastBigEventWeekRun: weekKey }).catch(() => {});
    return 0;
  }

  let claimedRun = false;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    if (liveCls.lastBigEventWeekRun === weekKey) return;
    t.update(classRef, { lastBigEventWeekRun: weekKey });
    claimedRun = true;
  });
  if (!claimedRun) return 0;

  const students = await getClassStudents(classCode);
  const newEntries = [];
  // Same guard as processWeeklyEvents: never give a student a second big
  // event for a week they already have one queued for, even on a forced
  // run — otherwise clicking "Run this week's big events now" more than
  // once (double-click, slow-connection retry, etc.) stacks duplicates.
  const alreadyThisWeek = new Set((cls.bigEventLog || []).filter(e => e.week === weekKey).map(e => e.studentUser));
  for (const student of students) {
    if (alreadyThisWeek.has(student.username)) continue;
    if (!forceAll && Math.random() >= 0.25) continue; // 25% chance per student per week (unless a manual run forces it)
    // Only consider events for modules where the student actually has
    // something at stake (a job, a property, or a vehicle) — no point
    // hitting someone with a "lost your job" event if they have no job.
    const eligibleDefs = activeDefs.filter(d => {
      // Good events are windfalls that don't require owning anything —
      // everyone's eligible for a bonus/refund/etc regardless of module.
      if (d.kind === "good") return true;
      if (d.module === "income") return !!student.jobId;
      if (d.module === "property") return cls.properties.some(p => p.owner === student.username);
      if (d.module === "transport") return cls.vehicles.some(v => (v.owners || []).includes(student.username));
      return true;
    });
    if (eligibleDefs.length === 0) continue;
    const def = eligibleDefs[Math.floor(Math.random() * eligibleDefs.length)];
    // Which of their properties/vehicles this hits (see pickEventAsset).
    const coverage = def.kind !== "good" ? MODULE_TO_COVERAGE[def.module] : null;
    const asset = coverage === "property" || coverage === "transport"
      ? pickEventAsset(cls, student.username, coverage, def.incident, false) : null;
    newEntries.push({
      ...(asset || {}),
      incident: def.incident || null,
      id: uid("bigevlog"), studentUser: student.username, defId: def.id, week: weekKey, date: nowStr(),
      name: def.name, module: def.module, kind: def.kind || "bad", cost: def.cost, description: def.description || "",
      // Locked in at generation time so editing the def later never changes
      // how an already-issued event resolves.
      takesAsset: def.takesAsset === false ? false : true,
      insuranceCover: def.insuranceCover || [],
      // Good events need no choice from the student — they're paid out
      // immediately and just get an acknowledgment popup. Bad events stay
      // "pending" until the student picks pay / forfeit / claim (or just
      // pay / claim, if this event doesn't put the asset at risk).
      status: def.kind === "good" ? "received" : "pending"
    });
  }
  if (newEntries.length === 0) return 0;

  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    liveCls.bigEventLog = (liveCls.bigEventLog || []).concat(newEntries);
    if (liveCls.bigEventLog.length > 300) liveCls.bigEventLog = liveCls.bigEventLog.slice(-300);
    t.update(classRef, { bigEventLog: liveCls.bigEventLog });
  });

  // Pay out any good (windfall) events right away — no choice needed.
  const goodEntries = newEntries.filter(e => e.kind === "good");
  for (const e of goodEntries) {
    await adjustBalance(e.studentUser, e.cost);
    await logTxn(classCode, { type: "big-event", to: e.studentUser, amount: e.cost, note: `Big event windfall: "${e.name}"` + (e.description ? " — " + e.description : "") });
  }

  return newEntries.length;
}

// choice: 'forfeit' | 'pay' | 'claim'
// paySource (only used when choice === 'pay'): 'cash' | 'savings' — lets a
// student cover a big event out of their Savings Account instead of their
// everyday cash balance. Defaults to 'cash' so any existing caller that
// doesn't pass this keeps behaving exactly as before.
// planId (only used when choice === 'claim'): which of the student's plans
// to claim on — optional, see the claim branch below.
async function resolveBigEvent(username, classCode, logId, choice, paySource, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let outcomeNote = "", amount = 0, writeOffNet = null;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.bigEventLog || []).find(e => e.id === logId && e.studentUser === username && e.status === "pending");
      if (!entry) throw new Error("NOT_FOUND");
      const isTeacher = user.role === "teacher";

      if (choice === "forfeit") {
        // Defensive server-side check — the UI already hides this option
        // when the event doesn't put the asset at risk, but never trust
        // the client alone.
        if (entry.takesAsset === false) throw new Error("NO_FORFEIT");
        entry.status = "lost";
        outcomeNote = `Didn't pay for "${entry.name}" — lost the associated ${entry.module}`;
        if (entry.module === "income") {
          t.update(userRef, { jobId: null, jobTierId: null, jobTierSince: null, pendingPromotion: null });
        } else if (entry.module === "property") {
          // The property this event hit (older events: their first one).
          const prop = eventAssetNow(cls, username, "property", entry).property;
          if (prop) releasePropertyFields(prop);
          t.update(classRef, { properties: cls.properties, bigEventLog: cls.bigEventLog });
        } else if (entry.module === "transport") {
          const veh = eventAssetNow(cls, username, "transport", entry).vehicle;
          if (veh) veh.owners = veh.owners.filter(o => o !== username);
          t.update(classRef, { vehicles: cls.vehicles, bigEventLog: cls.bigEventLog });
        }
        if (entry.module === "income") t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else if (choice === "pay") {
        const source = paySource === "savings" ? "savings" : "cash";
        const cash = user.balance || 0;
        const savings = user.savings || 0;
        const available = source === "savings" ? savings : cash;
        // Cash is allowed to go negative here, same as fines and choice
        // events elsewhere in the app — savings is the one balance that's
        // never allowed to go negative, so that check stays. Hard-blocking
        // the cash option too used to leave students with takesAsset:false
        // events, no savings, and no matching insurance stuck in a modal
        // with every button disabled and no way out.
        if (!isTeacher && source === "savings" && available < entry.cost) throw new Error("BROKE_SAVINGS");
        entry.status = "paid";
        amount = entry.cost;
        outcomeNote = `Paid ${fmtMoney(entry.cost)} for "${entry.name}"` + (source === "savings" ? " (from savings)" : "");
        if (!isTeacher) {
          if (source === "savings") {
            t.update(userRef, { savings: Math.round((savings - entry.cost) * 100) / 100 });
          } else {
            t.update(userRef, { balance: Math.round((cash - entry.cost) * 100) / 100 });
          }
        }
        t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else if (choice === "claim") {
        // The student pays the plan's excess plus whatever that plan's
        // type doesn't pay out for this event (nothing extra for events
        // with no insurance types set — those cover the whole cost).
        // planId picks which of the student's matching plans to claim on;
        // without one, the cheapest for the student is used.
        const coverage = MODULE_TO_COVERAGE[entry.module];
        const options = coverage ? insuranceClaimOptions(cls, user, coverage, entry.insuranceCover, entry.cost, entry) : [];
        // Without a planId, never pick a write-off for the student — that
        // gives their house away, so it must always be chosen on purpose.
        const option = planId ? options.find(o => o.plan.id === planId) : options.find(o => !o.writeOff);
        if (!option) throw new Error("NO_PLAN");
        const cash = user.balance || 0;
        if (option.writeOff) {
          // Indemnity on house damage: the insurer pays the market price
          // and takes the house (see insuranceClaimOptions).
          if (!isTeacher && option.net < 0 && cash < -option.net) throw new Error("BROKE_EXCESS");
          releasePropertyFields(option.property);
          entry.status = "claimed";
          entry.writtenOff = true;
          writeOffNet = option.net;
          outcomeNote = `Claimed insurance (${insurancePlanName(option.plan)}) for "${entry.name}" — ${writeOffText(option)}`;
          if (!isTeacher && option.net !== 0) t.update(userRef, { balance: Math.round((cash + option.net) * 100) / 100 });
          t.update(classRef, { properties: cls.properties, bigEventLog: cls.bigEventLog });
          return;
        }
        const toPay = option.studentPays;
        if (!isTeacher && cash < toPay) throw new Error("BROKE_EXCESS");
        entry.status = "claimed";
        amount = toPay;
        outcomeNote = `Claimed insurance (${insurancePlanName(option.plan)}) for "${entry.name}" — paid ${fmtMoney(option.excess)} excess`
          + (option.uncovered > 0 ? ` + ${fmtMoney(option.uncovered)} not covered` : "");
        if (!isTeacher && toPay > 0) t.update(userRef, { balance: Math.round((cash - toPay) * 100) / 100 });
        t.update(classRef, { bigEventLog: cls.bigEventLog });
      } else {
        throw new Error("BAD_CHOICE");
      }
    });
  } catch (e) {
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash to pay that." };
    if (e.message === "BROKE_SAVINGS") return { ok: false, error: "You don't have enough in savings to pay that." };
    if (e.message === "BROKE_EXCESS") return { ok: false, error: "You don't have enough cash to pay for this claim." };
    if (e.message === "NO_PLAN") return { ok: false, error: "You don't have an insurance plan that covers this." };
    if (e.message === "NO_FORFEIT") return { ok: false, error: "This event doesn't allow losing the asset — you need to pay or claim insurance." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That event is no longer pending." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (writeOffNet !== null) {
    // Money came IN from the insurer (or, with a big mortgage, went out —
    // logged the same way a sale that went negative is).
    await logTxn(classCode, writeOffNet >= 0
      ? { type: "insurance-claim", to: username, amount: writeOffNet, note: outcomeNote }
      : { type: "property-sell", to: username, amount: writeOffNet, note: outcomeNote });
    return { ok: true };
  }
  await logTxn(classCode, { type: "big-event", from: username, amount, note: outcomeNote });
  return { ok: true };
}

/* ===================== Random events ===================== */
// Which insurance a bad weekly event can be claimed on: "general" (the
// default, and what every event made before this existed uses), or
// "property"/"transport" — those can also list which insurance types
// cover it and what each pays out (see insuranceClaimOptions).
function weeklyEventInsurance(ev) {
  const coverage = ev.severity === "bad" && ["property", "transport"].includes(ev.coverage) ? ev.coverage : "general";
  const incident = cleanIncident(coverage, ev.incident);
  return { coverage, incident, insuranceCover: cleanInsuranceCover(coverage, ev.insuranceCover, incident) };
}

// A bad event tied to property or transport only goes to students who
// have one — a home they own or rent, or a vehicle — so nobody gets a
// "your car broke down" event without a car. Damage to the house itself
// only goes to students who own a house (see pickEventAsset). Everything
// else (all events made before this existed included) can go to anyone,
// same as always.
function weeklyEventFitsStudent(cls, username, ev) {
  if (ev.severity !== "bad") return true;
  if (ev.coverage === "property" || ev.coverage === "transport") {
    return pickEventAsset(cls, username, ev.coverage, cleanIncident(ev.coverage, ev.incident), true) !== null;
  }
  return true;
}

async function addEventDef(classCode, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const isChoice = ev.type === "choice";
    cls.eventDefs.push({
      id: uid("ev"), name: ev.name, amount: Number(ev.amount) || 0,
      description: ev.description || "", repeatable: !!ev.repeatable,
      severity: ev.severity === "bad" ? "bad" : "neutral", active: true,
      ...weeklyEventInsurance(ev),
      type: isChoice ? "choice" : "fixed",
      options: isChoice ? (ev.options || []).map(o => ({ id: uid("opt"), label: o.label || "", amount: Number(o.amount) || 0, outcome: o.outcome || "" })) : []
    });
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
async function removeEventDef(classCode, evId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.eventDefs = cls.eventDefs.filter(e => e.id !== evId);
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
async function updateEventDef(classCode, evId, ev) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const existing = cls.eventDefs.find(e => e.id === evId);
    if (!existing) return;
    const isChoice = ev.type === "choice";
    existing.name = ev.name;
    existing.amount = Number(ev.amount) || 0;
    existing.description = ev.description || "";
    existing.repeatable = !!ev.repeatable;
    existing.severity = ev.severity === "bad" ? "bad" : "neutral";
    Object.assign(existing, weeklyEventInsurance(ev));
    existing.type = isChoice ? "choice" : "fixed";
    existing.options = isChoice ? (ev.options || []).map(o => ({ id: uid("opt"), label: o.label || "", amount: Number(o.amount) || 0, outcome: o.outcome || "" })) : [];
    t.update(classRef, { eventDefs: cls.eventDefs });
  });
}
// Bypasses the once-per-week guard and generates this week's events right
// now — useful if the weekly run already fired earlier (e.g. before any
// event definitions existed, or before a timing fix), so the teacher isn't
// stuck waiting until next Monday for it to try again naturally.
async function forceWeeklyEvents(classCode) {
  // Manual "Run this week's events now" — overrides both the once-a-day
  // auto-run guard and each student's daily/weekly caps below.
  return await processWeeklyEvents(classCode, { ignoreAlreadyHad: true });
}

async function processWeeklyEvents(classCode, opts) {
  const ignoreAlreadyHad = !!(opts && opts.ignoreAlreadyHad); // true only for a manual run
  // lastEventDayRun is teacher-only in firestore.rules, so a student's page
  // could never claim the day — it just paid for a class-doc read and a
  // refused transaction on every load. Events are rolled by the teacher's.
  if (!ignoreAlreadyHad && t29SessionStudent()) return 0;
  const classRef = classesCol().doc(classCode);
  const dayKey = nzDateKey();
  const weekKey = isoWeekKey(new Date());
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls) return 0;
  if (cls.archived && ignoreAlreadyHad === false) return 0;

  // The auto-trigger (page load) only ever runs once per NZ calendar day —  // that's what makes "max 1 event a day" hold without any extra bookkeeping.
  // A manual run skips this guard entirely, which is what lets it override
  // the caps below.
  if (!ignoreAlreadyHad && cls.lastEventDayRun === dayKey) return 0;
  if (!cls.eventDefs || cls.eventDefs.filter(e => e.active).length === 0) {
    if (!ignoreAlreadyHad) await classRef.update({ lastEventDayRun: dayKey }).catch(() => {});
    return 0;
  }

  let claimed = true;
  if (!ignoreAlreadyHad) {
    claimed = false;
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) return;
      const liveCls = withNewModuleDefaults(snap.data());
      if (liveCls.lastEventDayRun === dayKey) return;
      t.update(classRef, { lastEventDayRun: dayKey });
      claimed = true;
    });
    if (!claimed) return 0;
  }

  const students = await getClassStudents(classCode);
  const activeDefs = cls.eventDefs.filter(e => e.active);
  const eventLog = cls.eventLog || [];
  const newLogEntries = [];

  // Each qualifying student gets exactly 1 event per run, revealed within
  // ~20 minutes.
  const FIRST_EVENT_MAX_DELAY_MS = 20 * 60000;      // first ever event: within 20 min

  for (const student of students) {
    const studentEntries = eventLog.filter(l => l.studentUser === student.username);

    if (!ignoreAlreadyHad) {
      // Max 1 event per day...
      const hadToday = studentEntries.some(l => l.day === dayKey);
      if (hadToday) continue;
      // ...and max 3 events per week.
      const weekCount = studentEntries.filter(l => l.week === weekKey).length;
      if (weekCount >= 3) continue;
    }

    const already = new Set(studentEntries.map(l => l.eventId));
    // Whatever event this student was assigned most recently (regardless
    // of week) is excluded from this draw even if it's marked "repeatable"
    // — repeatable just means it can come back around later, not that the
    // same event can land twice in a row. A manual/forced run overrides
    // this too, otherwise a class with only one active event (or a student
    // whose only eligible event was their last one) would silently get
    // nothing at all, even on an explicit "override" run.
    const lastEventId = studentEntries.length ? studentEntries[studentEntries.length - 1].eventId : null;
    const pool = activeDefs.filter(e => (ignoreAlreadyHad || (e.id !== lastEventId && (e.repeatable || !already.has(e.id))))
      && weeklyEventFitsStudent(cls, student.username, e));
    if (pool.length === 0) continue;
    const ev = pool[Math.floor(Math.random() * pool.length)];
    const revealAt = Date.now() + Math.floor(Math.random() * FIRST_EVENT_MAX_DELAY_MS);
    // Locked in now, same as big events, so editing the event later never
    // changes how an already-issued one can be claimed.
    const insurance = weeklyEventInsurance(ev);
    // Which of their properties/vehicles this hits (see pickEventAsset).
    const asset = insurance.coverage !== "general"
      ? pickEventAsset(cls, student.username, insurance.coverage, insurance.incident, true) : null;
    if (ev.type === "choice") {
      // Multiple-choice events don't apply a balance change yet — the
      // student must pick one of the options first (see resolveChoiceEvent).
      newLogEntries.push({
        id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), day: dayKey, week: weekKey, revealAt,
        name: ev.name, amount: null, description: ev.description || "", severity: ev.severity || "neutral",
        claimed: false, type: "choice", options: ev.options || [], status: "pending", ...insurance, ...(asset || {})
      });
    } else {
      // Fixed-amount events used to apply the balance change and log a
      // txn right here, at generation time — long before the student
      // ever saw a popup explaining why. That meant balances could
      // silently jump by several events' worth all at once. Now this
      // just schedules it; the actual balance change + txn only happens
      // in revealFixedEvent(), which is called the moment the popup is
      // about to be shown to the student (see checkWeeklyEventPopup).
      newLogEntries.push({
        id: uid("evlog"), studentUser: student.username, eventId: ev.id, date: nowStr(), day: dayKey, week: weekKey, revealAt,
        name: ev.name, amount: ev.amount, description: ev.description || "", severity: ev.severity || "neutral",
        claimed: false, type: "fixed", status: "scheduled", ...insurance, ...(asset || {})
      });
    }
  }

  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    liveCls.eventLog = (liveCls.eventLog || []).concat(newLogEntries);
    if (liveCls.eventLog.length > 500) liveCls.eventLog = liveCls.eventLog.slice(-500);
    t.update(classRef, { eventLog: liveCls.eventLog });
  });

  return newLogEntries.length;
}

// Applies a scheduled fixed-amount event's balance change and logs its txn
// — called the moment its popup is about to be shown to the student (see
// checkWeeklyEventPopup in events-ui.js), never before. This is what makes
// sure a student's balance can't change "silently" ahead of them actually
// seeing what happened and why. Safe to call more than once (e.g. two tabs
// racing) — the transaction only acts on it while status is still
// "scheduled", so a second call is a no-op.
async function revealFixedEvent(classCode, eventLogId) {
  const classRef = classesCol().doc(classCode);
  let entry = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    const found = (liveCls.eventLog || []).find(l => l.id === eventLogId);
    if (!found || found.type !== "fixed" || found.status !== "scheduled") return;
    found.status = "resolved";
    entry = { ...found };
    t.update(classRef, { eventLog: liveCls.eventLog });
  });
  if (!entry) return null;
  await adjustBalance(entry.studentUser, entry.amount);
  await logTxn(classCode, { type: "event", to: entry.studentUser, amount: entry.amount, note: entry.name + (entry.description ? " — " + entry.description : "") });
  return entry;
}

// The ways a student can claim insurance on a bad weekly event they've
// already been charged for (see insuranceClaimOptions) — best payout
// first. Old log entries have no coverage saved, so they're General.
// Indemnity write-offs (writeOff: true) are in here too; the popups always
// show those separately, since claiming one gives the house away.
function weeklyEventClaimOptions(cls, user, entry) {
  if (!entry || entry.severity !== "bad" || entry.claimed) return [];
  const loss = Math.abs(Math.min(0, Number(entry.amount) || 0));
  return insuranceClaimOptions(cls, user, entry.coverage || "general", entry.insuranceCover, loss, entry)
    .sort((a, b) => b.payout - a.payout);
}

// Claim insurance against a bad weekly event. Pays back what that plan
// covers minus its excess (never below zero), and marks the event as
// claimed so it can't be claimed twice.
async function claimInsuranceForEvent(username, classCode, eventLogId, planId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let payout = 0, planName = "", eventName = "", writeOffNote = "";
  try {
    await fdb.runTransaction(async (t) => {
      writeOffNote = "";
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.eventLog || []).find(e => e.id === eventLogId && e.studentUser === username);
      // "scheduled"/"pending" = not charged yet, so nothing to claim back.
      if (!entry || entry.severity !== "bad" || entry.claimed || entry.status === "scheduled" || entry.status === "pending") throw new Error("NOT_CLAIMABLE");
      const option = weeklyEventClaimOptions(cls, user, entry).find(o => o.plan.id === planId);
      if (!option) throw new Error("NO_PLAN");
      payout = option.payout;
      planName = insurancePlanName(option.plan);
      eventName = entry.name || "";
      const cash = user.balance || 0;
      entry.claimed = true;
      if (option.writeOff) {
        // Indemnity on house damage: the insurer pays the market price and
        // takes the house (see insuranceClaimOptions).
        if (option.net < 0 && cash < -option.net) throw new Error("BROKE");
        releasePropertyFields(option.property);
        entry.writtenOff = true;
        writeOffNote = writeOffText(option);
        t.update(userRef, { balance: Math.round((cash + payout) * 100) / 100 });
        t.update(classRef, { properties: cls.properties, eventLog: cls.eventLog });
        return;
      }
      t.update(userRef, { balance: Math.round((cash + payout) * 100) / 100 });
      t.update(classRef, { eventLog: cls.eventLog });
    });
  } catch (e) {
    if (e.message === "NO_PLAN") return { ok: false, error: "You don't have an insurance plan that covers this." };
    if (e.message === "NOT_CLAIMABLE") return { ok: false, error: "That event can't be claimed." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash to cover what's still owed on the mortgage." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  const note = `Insurance claim (${planName})` + (eventName ? ` for "${eventName}"` : "") + (writeOffNote ? ` — ${writeOffNote}` : "");
  // A write-off with a big mortgage can leave the student owing money —
  // logged the same way a sale that went negative is.
  await logTxn(classCode, payout >= 0
    ? { type: "insurance-claim", to: username, amount: payout, note }
    : { type: "property-sell", to: username, amount: payout, note });
  return { ok: true, payout, writeOff: !!writeOffNote };
}

// Resolves a pending multiple-choice weekly event: applies the balance
// change for the option the student picked, and marks it resolved so it
// won't be asked again and behaves like a normal (already-happened) event.
async function resolveChoiceEvent(username, classCode, logId, optionId) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let amount = 0, note = "", outcome = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const entry = (cls.eventLog || []).find(e => e.id === logId && e.studentUser === username && e.status === "pending");
      if (!entry) throw new Error("NOT_FOUND");
      let option = (entry.options || []).find(o => o.id === optionId);
      if (!option) throw new Error("NOT_FOUND");

      // The entry's options are a snapshot taken when it was assigned —
      // if the teacher has since fixed/edited the event definition (e.g.
      // correcting an amount that had been saved as 0), that snapshot is
      // stale. Prefer the live definition's amount for this option when
      // we can confidently match it up (by id, or failing that by label),
      // so a teacher's fix actually takes effect for events already
      // sitting in a student's queue instead of only future assignments.
      const liveDef = (cls.eventDefs || []).find(d => d.id === entry.eventId);
      if (liveDef && liveDef.options) {
        const liveOption = liveDef.options.find(o => o.id === option.id)
          || liveDef.options.find(o => o.label.trim().toLowerCase() === option.label.trim().toLowerCase());
        if (liveOption) option = liveOption;
      }

      amount = option.amount;
      outcome = option.outcome || "";
      entry.status = "resolved";
      entry.chosenOptionId = optionId;
      entry.amount = amount;
      entry.outcome = outcome;
      note = `${entry.name} — chose "${option.label}"` + (option.outcome ? `: ${option.outcome}` : "");
      const isTeacher = user.role === "teacher";
      if (!isTeacher) t.update(userRef, { balance: Math.round((user.balance + amount) * 100) / 100 });
      t.update(classRef, { eventLog: cls.eventLog });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "event", to: username, amount, note });
  return { ok: true, amount, outcome };
}

// Insurance premiums are NOT auto-deducted. Students are responsible for
// setting up their own recurring payment for premiums via the Bank tab's
// automations feature. This function is intentionally disabled (kept as a
// no-op stub in case anything still calls it) so premiums are never
// silently withdrawn on the insurance day.
async function processInsurancePayments(classCode) {
  return 0;
}

// Everything a single student owns, for the teacher's "view student" panel.
// `properties` holds every unit the student owns (a student can own more
// than one — their lifestyle bonus stacks across all of them, see
// lifestyleRatingFromData); `property` is kept as the first one for any
// old caller that only ever expected a single property.
async function getStudentPossessions(username, classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  if (!cls || !user) return null;
  const properties = cls.properties.filter(p => p.owner === username);
  const property = properties[0] || null;
  // The property (if any) this student is renting FROM A CLASSMATE — a
  // separate thing from `property`/`properties` above, since a student can
  // own places they don't live in while renting somewhere else themselves.
  const rentedHome = cls.properties.find(p => p.sublet && p.sublet.tenant === username) || null;
  // Same idea as rentedHome above, but for a teacher-listed (NPC) rental —
  // a student can only ever be in one of property/rentedHome/rentedNpcHome
  // at once (see currentHomeOf), but they're fetched independently here
  // since a profile view may want to show whichever one applies.
  const rentedNpcHome = (cls.npcProperties || []).find(p => p.tenant === username) || null;
  const vehicles = cls.vehicles.filter(v => (v.owners || []).includes(username));
  const vehicle = vehicles.reduce((best, v) => (!best || v.comfort > best.comfort) ? v : best, null);
  const storeItems = (user.storeItems || []).map(id => cls.storeItems.find(i => i.id === id)).filter(Boolean)
    .map(i => ({ ...i }));
  const insurance = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).filter(Boolean);
  return { property, properties, rentedHome, rentedNpcHome, vehicle, vehicles, storeItems, insurance };
}

/* ===================== Lifestyle rating ===================== */
// Lifestyle-score bonus for choosing to live in an owned property instead
// of renting it out (see setPropertyOccupancy). Each property has its own
// teacher-set number of "stars" this bonus is worth (prop.livingBonusStars,
// set on the property itself alongside its comfort rating), converted to
// points using the property category's own points-per-star weight.
function propertyLivingBonusPoints(cfg, prop) {
  const stars = Number(prop && prop.livingBonusStars) || 0;
  const weight = (cfg && cfg.property) ? Number(cfg.property.weight) || 0 : 0;
  return stars * weight;
}
// Lets a listing preview its lifestyle impact before a student buys it:
// the points they'd get just for owning it, plus the extra points on top
// if they choose to live in it. Returns null if the property category is
// switched off entirely, so callers know not to show anything.
function propertyLifestylePreview(cls, prop) {
  const cfg = (cls && cls.lifestyleConfig) || {};
  if (!cfg.property || !cfg.property.enabled || !prop) return null;
  const weight = Number(cfg.property.weight) || 0;
  const livingStars = Number(prop.livingBonusStars) || 0;
  return {
    ownPoints: (Number(prop.comfort) || 0) * weight,
    livingBonusPoints: livingStars * weight,
    livingBonusStars: livingStars,
    weight
  };
}
// Flat lifestyle-score bonus for renting a home from a classmate — same
// "somewhere to live" idea as the per-property living bonus above, but
// deliberately ignores the rented property's own comfort rating (a tenant
// doesn't own the asset, just occupies it) rather than stacking a
// comfort×weight score on top, the way an owner living in their own place
// does.
const TENANT_LIVING_BONUS = 5;

async function saveLifestyleConfig(classCode, config) {
  await classesCol().doc(classCode).update({ lifestyleConfig: config });
}
// thresholds: array of { min, max, label, minNetWorth, minPropertyComfort,
// minTransportComfort }, sorted low to high, describing named bands for the
// uncapped (0+) lifestyle score (e.g. Poor 0-10, Good 10-20). The top band's
// `max` is just where its own editable range stops — any score at or above
// it still qualifies (see lifestyleLabelFor below), so the highest band
// effectively has no ceiling. The min* fields are
// optional extra requirements a student must meet to actually be shown that
// band, even if their score alone would qualify — e.g. a "Luxurious" band
// might require a net worth of at least $500 and a property with a comfort
// rating of at least 4, so a student can't reach it on store items alone.
// A value of 0 means "no requirement" for that field.
async function saveLifestyleThresholds(classCode, thresholds) {
  const clean = thresholds
    .map(t => ({
      min: Math.max(0, Number(t.min) || 0), // uncapped — score can exceed 100
      max: Math.max(0, Number(t.max) || 0), // uncapped — score can exceed 100
      label: (t.label || "").trim() || "Untitled",
      minNetWorth: Math.max(0, Number(t.minNetWorth) || 0),
      // Uncapped — a property's comfort can exceed 5 once a living-in bonus
      // (see propertyLivingBonusPoints/TENANT_LIVING_BONUS) is stacked on
      // top of its base comfort rating, so a band requirement must be able
      // to ask for more than 5 too.
      minPropertyComfort: Math.max(0, Number(t.minPropertyComfort) || 0),
      minTransportComfort: Math.max(0, Math.min(5, Number(t.minTransportComfort) || 0))
    }))
    .sort((a, b) => a.min - b.min);
  await classesCol().doc(classCode).update({ lifestyleThresholds: clean });
}
// Does a student meet a given band's extra requirements? `stats` is
// optional — omit it (or pass nothing) to check score-range membership
// only, which keeps this backward compatible with any existing callers
// that only ever dealt with the score.
function bandRequirementsMet(band, stats) {
  if (!stats) return true;
  if (band.minNetWorth && (stats.netWorth || 0) < band.minNetWorth) return false;
  if (band.minPropertyComfort && (stats.propertyComfort || 0) < band.minPropertyComfort) return false;
  if (band.minTransportComfort && (stats.transportComfort || 0) < band.minTransportComfort) return false;
  return true;
}
// Finds the label for an uncapped (0+) score. If `stats` is passed (netWorth,
// propertyComfort, transportComfort), a band whose extra requirements
// aren't met is skipped in favour of the next band down that the student
// does qualify for, so a high score alone can't skip requirements — see
// lifestyleBandForStudent, which builds `stats` for you.
function lifestyleLabelFor(score, thresholds, stats) {
  if (!thresholds || thresholds.length === 0) return "";
  let targetIndex = thresholds.findIndex(t => score >= t.min && score < t.max);
  if (targetIndex === -1) {
    const last = thresholds[thresholds.length - 1];
    if (score >= last.max) targetIndex = thresholds.length - 1;
  }
  if (targetIndex === -1) return "";
  for (let i = targetIndex; i >= 0; i--) {
    if (bandRequirementsMet(thresholds[i], stats)) return thresholds[i].label;
  }
  return "";
}
// Convenience wrapper: works out a student's lifestyle score AND the extra
// stats (net worth, owned property/vehicle comfort) needed to enforce band
// requirements, then returns the label they actually qualify for.
async function lifestyleBandForStudent(username, classCode, precomputedBoard) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  if (!cls) return "";
  const score = await lifestyleRating(username, classCode);
  // Accept an already-computed leaderboard when the caller has one handy
  // (e.g. render() loops that just built it) instead of recomputing it —
  // classLeaderboard() re-reads every student in the class, so doing that
  // a second time here for a single student's band was wasteful.
  const board = precomputedBoard || await classLeaderboard(classCode);
  const row = board.find(r => r.username === username);
  // Stacked total across every property the student owns, not just one,
  // matching how the property category now contributes to the score itself.
  const ownedProperties = (cls.properties || []).filter(p => p.owner === username);
  const ownedVehicles = (cls.vehicles || []).filter(v => (v.owners || []).includes(username));
  const stats = {
    netWorth: row ? row.net : 0,
    // Base comfort for every owned property, plus its living-in bonus
    // stars when the student is actually living in it (rather than renting
    // it out) — same stacking the score itself uses in
    // lifestyleRatingFromData, so this can legitimately exceed 5 and a
    // band's minPropertyComfort requirement is allowed to ask for that.
    propertyComfort: ownedProperties.reduce((sum, p) => sum + (p.comfort || 0) + (p.occupancy === "living" ? (Number(p.livingBonusStars) || 0) : 0), 0),
    // Best comfort among the vehicles the student owns — transport stars
    // don't stack, matching how transport now contributes to the score
    // itself (see lifestyleRatingFromData).
    transportComfort: ownedVehicles.reduce((best, v) => Math.max(best, v.comfort || 0), 0)
  };
  return lifestyleLabelFor(score, cls.lifestyleThresholds, stats);
}
// Works out what a student still needs — in score points, net worth, owned
// property comfort, and owned transport comfort — to reach the next
// lifestyle band above the one they currently qualify for. Mirrors the same
// score-range + requirements-met walk that lifestyleLabelFor/
// lifestyleBandForStudent use, so "next tier" always lines up with whatever
// band the student is actually shown. Returns null when there's nothing to
// show (no thresholds configured for this class). Returns
// { atTop: true, currentLabel } when the student already qualifies for the
// highest configured band, or { atTop: false, currentLabel, nextLabel,
// pointsNeeded, netWorthNeeded, propertyComfortNeeded, transportComfortNeeded }
// otherwise, where every *Needed field is a >=0 remaining gap (0 = already met).
async function lifestyleTierProgress(username, classCode, precomputedBoard) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  if (!cls) return null;
  const thresholds = cls.lifestyleThresholds || [];
  if (!thresholds.length) return null;

  const score = await lifestyleRating(username, classCode);
  const board = precomputedBoard || await classLeaderboard(classCode);
  const row = board.find(r => r.username === username);
  const ownedProperties = (cls.properties || []).filter(p => p.owner === username);
  const ownedVehicles = (cls.vehicles || []).filter(v => (v.owners || []).includes(username));
  const stats = {
    netWorth: row ? row.net : 0,
    propertyComfort: ownedProperties.reduce((sum, p) => sum + (p.comfort || 0) + (p.occupancy === "living" ? (Number(p.livingBonusStars) || 0) : 0), 0),
    // Best comfort among owned vehicles, not a sum — see the matching note
    // in lifestyleBandForStudent above.
    transportComfort: ownedVehicles.reduce((best, v) => Math.max(best, v.comfort || 0), 0)
  };

  // Same score-range lookup as lifestyleLabelFor.
  let targetIndex = thresholds.findIndex(t => score >= t.min && score < t.max);
  if (targetIndex === -1) {
    const last = thresholds[thresholds.length - 1];
    if (score >= last.max) targetIndex = thresholds.length - 1;
  }

  // Walk down from the score-qualified band to find the one whose extra
  // requirements are actually met — same rule lifestyleLabelFor applies —
  // so "current" here always matches the label shown on the account page.
  let currentIndex = -1;
  for (let i = targetIndex; i >= 0; i--) {
    if (bandRequirementsMet(thresholds[i], stats)) { currentIndex = i; break; }
  }

  const currentLabel = currentIndex >= 0 ? thresholds[currentIndex].label : "";
  const nextIndex = currentIndex + 1;
  if (nextIndex >= thresholds.length) {
    return { atTop: true, currentLabel };
  }

  const next = thresholds[nextIndex];
  return {
    atTop: false,
    currentLabel,
    nextLabel: next.label,
    pointsNeeded: Math.max(0, Math.ceil(next.min) - score),
    netWorthNeeded: Math.max(0, next.minNetWorth - stats.netWorth),
    propertyComfortNeeded: Math.max(0, next.minPropertyComfort - stats.propertyComfort),
    transportComfortNeeded: Math.max(0, next.minTransportComfort - stats.transportComfort)
  };
}
// Pure calculation, no fetching — split out of lifestyleRating() so callers
// that already have `cls`/`user` in hand (e.g. startBlackjackRound, which
// needs both anyway regardless of lock status) can compute a rating without
// triggering their own extra getClass()/getUser() reads. lifestyleRating()
// below is unchanged in behavior for every existing caller.
function lifestyleRatingFromData(cls, user, username) {
  if (!cls || !user) return 0;
  if (user.lifestyleOverride !== undefined && user.lifestyleOverride !== null) {
    // Uncapped — a teacher override can be set to any non-negative score,
    // it just can't go negative.
    return Math.max(0, Math.round(Number(user.lifestyleOverride) || 0));
  }
  const cfg = cls.lifestyleConfig;
  let score = 0;

  if (cfg.property && cfg.property.enabled) {
    // Every owned property contributes its own comfort × weight — stars
    // stack across all properties a student owns (unlike transport below,
    // which only counts a student's single best vehicle).
    const owned = cls.properties.filter(p => p.owner === username);
    owned.forEach(p => {
      score += (p.comfort || 0) * (cfg.property.weight || 0);
      // Living in a property (as opposed to renting it out) earns a
      // teacher-set number of bonus "stars" on top of its base comfort
      // score, for each property the student is living in. Renting one
      // out instead earns weekly rent (see processPropertyRent) but no
      // bonus — that property still only counts for its base comfort.
      if (p.occupancy === "living") score += propertyLivingBonusPoints(cfg, p);
    });
    // Renting a home from a classmate earns the same flat "somewhere to
    // live" bonus an owner gets for living in their own place — but never
    // both at once, since a student can only live in one home at a time
    // (see currentHomeOf), and never scaled by the rented property's
    // comfort rating the way owning one is.
    if (cls.properties.some(p => p.sublet && p.sublet.tenant === username)) {
      score += TENANT_LIVING_BONUS;
    }
    // Renting a school-listed (NPC) property earns whatever flat lifestyle
    // bonus the teacher set directly on that listing, instead of the flat
    // TENANT_LIVING_BONUS a classmate sublet gives — a student can only
    // ever be in one of these three housing states at once (see
    // currentHomeOf), so this never stacks with the two blocks above.
    const npcHome = (cls.npcProperties || []).find(p => p.tenant === username);
    if (npcHome) score += Number(npcHome.lifestylePoints) || 0;
  }
  if (cfg.transport && cfg.transport.enabled) {
    // Transport stars don't stack — only the comfiest vehicle a student
    // owns counts towards their score, the same as if that were the only
    // vehicle they owned. Owning a second or third vehicle adds no points.
    const owned = cls.vehicles.filter(v => (v.owners || []).includes(username));
    const best = owned.reduce((b, v) => (!b || (v.comfort || 0) > (b.comfort || 0)) ? v : b, null);
    if (best) score += (best.comfort || 0) * (cfg.transport.weight || 0);
  }
  if (cfg.store && cfg.store.enabled) {
    const owned = user.storeItems || [];
    owned.forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item) score += (item.stars || 0) * (cfg.store.weight || 0);
    });
  }
  if (cfg.insurance && cfg.insurance.enabled) {
    const owned = user.insurance || [];
    owned.forEach(planId => {
      const plan = cls.insurancePlans.find(p => p.id === planId);
      if (plan) score += (plan.stars || 0) * (cfg.insurance.weight || 0);
    });
  }
  if (cfg.loan && cfg.loan.enabled && cfg.loan.perAmount > 0 && cfg.loan.points > 0) {
    const owedTotal = (user.loans || [])
      .filter(l => l.status === "active")
      .reduce((sum, l) => sum + l.owed, 0);
    score -= Math.floor(owedTotal / cfg.loan.perAmount) * cfg.loan.points;
  }
  score += getLifeBenefitTotals(user).lifestylePoints;
  // A student with nowhere to live — not living in a property they own,
  // not renting from a classmate, not renting a school listing — has their
  // whole lifestyle rating reset to 0, no matter what else they own. Gated
  // on the property category being enabled at all: if a teacher has
  // switched property scoring off entirely, "having a home" isn't part of
  // lifestyle for this class and this rule doesn't apply either.
  if (cfg.property && cfg.property.enabled && !currentHomeOf(cls, username)) {
    return 0;
  }
  // Uncapped — a student's computed score can grow without limit as they
  // accumulate property/transport/store/insurance comfort, it just can't
  // go negative.
  return Math.max(0, Math.round(score));
}
async function lifestyleRating(username, classCode) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  const user = await getUserCached(username);
  return lifestyleRatingFromData(cls, user, username);
}
// Same computation as lifestyleRating(), but returns the itemised list of
// what's adding to (or subtracting from) the score instead of just the
// final number — powers the student-facing "why is my score X" popup.
async function lifestyleRatingBreakdown(username, classCode) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  const user = await getUserCached(username);
  if (!cls || !user) return { items: [], total: 0, overridden: false };
  if (user.lifestyleOverride !== undefined && user.lifestyleOverride !== null) {
    return { items: [], total: Math.max(0, Math.round(Number(user.lifestyleOverride) || 0)), overridden: true };
  }
  const cfg = cls.lifestyleConfig;
  const items = [];
  let score = 0;

  if (cfg.property && cfg.property.enabled) {
    // Every owned property gets its own line (and its own living bonus
    // line, if applicable) — points stack across all properties owned.
    const owned = cls.properties.filter(p => p.owner === username);
    owned.forEach(p => {
      const pts = (p.comfort || 0) * (cfg.property.weight || 0);
      score += pts;
      items.push({ type: "gain", label: p.name || "Property", detail: `${p.comfort || 0} comfort &times; ${cfg.property.weight || 0} pts/star`, points: pts });
      if (p.occupancy === "living") {
        const bonus = propertyLivingBonusPoints(cfg, p);
        score += bonus;
        items.push({ type: "gain", label: `Living in ${p.name || "your property"}`, detail: `${p.livingBonusStars || 0} bonus star${(p.livingBonusStars || 0) === 1 ? "" : "s"} &times; ${cfg.property.weight || 0} pts/star for living in it instead of renting it out`, points: bonus });
      }
    });
    const tenantHome = cls.properties.find(p => p.sublet && p.sublet.tenant === username);
    if (tenantHome) {
      score += TENANT_LIVING_BONUS;
      items.push({ type: "gain", label: "Renting a home from a classmate", detail: `${tenantHome.name} — flat bonus for having somewhere to live (comfort rating not counted, since you don't own it)`, points: TENANT_LIVING_BONUS });
    }
    const npcHome = (cls.npcProperties || []).find(p => p.tenant === username);
    if (npcHome) {
      const pts = Number(npcHome.lifestylePoints) || 0;
      if (pts) {
        score += pts;
        items.push({ type: "gain", label: `Renting ${npcHome.name || "a school listing"}`, detail: "Renting directly from the school — bonus set by your teacher for this listing", points: pts });
      }
    }
  }
  if (cfg.transport && cfg.transport.enabled) {
    // Transport stars don't stack — only the comfiest owned vehicle scores
    // points. Every other owned vehicle still gets its own line so a
    // student can see it, but at 0 points with a note explaining why.
    const owned = cls.vehicles.filter(v => (v.owners || []).includes(username));
    const best = owned.reduce((b, v) => (!b || (v.comfort || 0) > (b.comfort || 0)) ? v : b, null);
    owned.forEach(v => {
      const isBest = !!best && v.id === best.id;
      const pts = isBest ? (v.comfort || 0) * (cfg.transport.weight || 0) : 0;
      if (isBest) score += pts;
      items.push({
        type: "gain",
        label: v.name || "Vehicle",
        detail: isBest
          ? `${v.comfort || 0} comfort &times; ${cfg.transport.weight || 0} pts/star (your comfiest vehicle)`
          : `${v.comfort || 0} comfort — not counted, since only your comfiest vehicle scores points`,
        points: pts
      });
    });
  }
  if (cfg.store && cfg.store.enabled) {
    const owned = user.storeItems || [];
    owned.forEach(itemId => {
      const item = cls.storeItems.find(i => i.id === itemId);
      if (item) {
        const pts = (item.stars || 0) * (cfg.store.weight || 0);
        score += pts;
        items.push({ type: "gain", label: item.name, detail: `${item.stars || 0}★ &times; ${cfg.store.weight || 0} pts/star`, points: pts });
      }
    });
  }
  if (cfg.insurance && cfg.insurance.enabled) {
    const owned = user.insurance || [];
    owned.forEach(planId => {
      const plan = cls.insurancePlans.find(p => p.id === planId);
      if (plan) {
        const pts = (plan.stars || 0) * (cfg.insurance.weight || 0);
        score += pts;
        items.push({ type: "gain", label: insurancePlanName(plan), detail: `${plan.stars || 0}★ &times; ${cfg.insurance.weight || 0} pts/star`, points: pts });
      }
    });
  }
  if (cfg.loan && cfg.loan.enabled && cfg.loan.perAmount > 0 && cfg.loan.points > 0) {
    const owedTotal = (user.loans || [])
      .filter(l => l.status === "active")
      .reduce((sum, l) => sum + l.owed, 0);
    const penalty = Math.floor(owedTotal / cfg.loan.perAmount) * cfg.loan.points;
    if (penalty > 0) {
      score -= penalty;
      items.push({ type: "loss", label: "Outstanding loans", detail: `${fmtMoney(owedTotal)} owed &middot; ${cfg.loan.points} pt${cfg.loan.points === 1 ? "" : "s"} per ${fmtMoney(cfg.loan.perAmount)} owed`, points: penalty });
    }
  }
  (user.lifeItems || []).forEach(it => {
    const pts = Number(it.benefits && it.benefits.lifestylePoints) || 0;
    if (pts) {
      score += pts;
      items.push({ type: pts >= 0 ? "gain" : "loss", label: it.name || "Life event", detail: "Life event bonus", points: Math.abs(pts) });
    }
  });

  // Same "no home = 0" rule as lifestyleRatingFromData — shown here as an
  // explicit line item (rather than just silently returning 0) so a
  // student isn't left wondering why their total doesn't match the gains
  // list above it.
  const rawTotal = Math.max(0, Math.round(score));
  let total = rawTotal;
  if (cfg.property && cfg.property.enabled && !currentHomeOf(cls, username)) {
    if (rawTotal > 0) {
      items.push({ type: "loss", label: "No stable home", detail: "You're not living anywhere right now — not a property you own, a classmate's rental, or a school rental. Everything above is worth 0 until you move in somewhere.", points: rawTotal });
    }
    total = 0;
  }

  return { items, total, overridden: false };
}
// Teacher-set lifestyle score that overrides the computed one entirely —
// the student can't move it by buying/selling anything while it's active.
async function setLifestyleOverride(username, score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number 0 or greater." };
  const clamped = Math.max(0, Math.round(n));
  await usersCol().doc(username).update({ lifestyleOverride: clamped });
  return { ok: true };
}
async function clearLifestyleOverride(username) {
  await usersCol().doc(username).update({ lifestyleOverride: null });
  return { ok: true };
}

// Registry of modules that can be locked by lifestyle rating. "key" must
// match what each module's own page passes to isModuleLockedForStudent.
const LIFESTYLE_LOCKABLE_MODULES = [
  { key: "bank", label: "Bank" },
  { key: "termdeposit", label: "Term Deposit" },
  { key: "loan", label: "Loans" },
  { key: "market", label: "Stock Market" },
  { key: "store", label: "Store" },
  { key: "jobs", label: "Jobs" },
  { key: "transport", label: "Transport" },
  { key: "property", label: "Property" },
  { key: "insurance", label: "Insurance" },
  { key: "tax", label: "Tax" },
  { key: "bigevents", label: "Big Events" },
  { key: "life", label: "Life" },
  { key: "gambling", label: "Gambling" },
  { key: "marketplace", label: "Trade Centre" },
  { key: "sidehustle", label: "Side hustle" }
];

async function saveLifestyleLock(classCode, threshold, modules) {
  const clean = {
    // Uncapped to match the now-uncapped lifestyle score — a teacher may
    // need a lock threshold above 100 once scores commonly run higher.
    threshold: Math.max(0, Math.round(Number(threshold) || 0)),
    modules: (modules || []).filter(k => LIFESTYLE_LOCKABLE_MODULES.some(m => m.key === k))
  };
  await classesCol().doc(classCode).update({ lifestyleLock: clean });
  return clean;
}

// Which modules are currently locked for this student (empty array if none).
// Pure version of the lock check, for callers that already have `cls` and
// `user` loaded (see lifestyleRatingFromData above for why). Mirrors
// getLockedModulesForStudent()'s logic exactly, just without fetching.
function getLifestyleLockedModulesFromData(cls, user, username) {
  const lock = cls.lifestyleLock;
  if (!lock || !lock.modules || lock.modules.length === 0) return [];
  const score = lifestyleRatingFromData(cls, user, username);
  if (score > lock.threshold) return [];
  return lock.modules;
}

// Modules a student can't get into yet because they haven't PASSED the
// quiz their teacher attached to that module. Only bites while the
// teacher's master quiz-gate switch is on (cls.quizGate.enabled) — with it
// off, quizzes are still there to take, they just don't lock anything.
// See the Quizzes section for the quiz/result shapes.
function getQuizLockedModulesFromData(cls, user) {
  if (!cls.quizGate || !cls.quizGate.enabled) return [];
  if (!user || user.role === "teacher") return [];
  const results = user.quizResults || {};
  const locked = [];
  (cls.quizzes || []).forEach(q => {
    if (!q.active || !q.moduleKey) return;
    if (!LIFESTYLE_LOCKABLE_MODULES.some(m => m.key === q.moduleKey)) return;
    const r = results[q.id];
    if (!r || !r.passed) {
      if (!locked.includes(q.moduleKey)) locked.push(q.moduleKey);
    }
  });
  return locked;
}

// The two lock systems (lifestyle rating, quiz gate) are independent and
// can each lock the same module, so this returns a map of
// moduleKey -> "lifestyle" | "quiz" | "both" rather than a bare list. The
// UI uses it to explain the RIGHT thing to a student — "your rating is too
// low" and "you need to pass a quiz first" need very different next steps.
function getModuleLockReasonsFromData(cls, user, username) {
  const reasons = {};
  getLifestyleLockedModulesFromData(cls, user, username).forEach(k => { reasons[k] = "lifestyle"; });
  getQuizLockedModulesFromData(cls, user).forEach(k => {
    reasons[k] = reasons[k] ? "both" : "quiz";
  });
  return reasons;
}

function getLockedModulesForStudentFromData(cls, user, username) {
  return Object.keys(getModuleLockReasonsFromData(cls, user, username));
}
function isModuleLockedForStudentFromData(cls, user, username, moduleKey) {
  return getLockedModulesForStudentFromData(cls, user, username).includes(moduleKey);
}

// Same short-circuit as before, just widened: skip the extra getUser()
// read only when NEITHER lock system has anything configured to check
// against (which is still the common case for most classes).
function _classHasAnyModuleLock(cls) {
  const lock = cls.lifestyleLock;
  const lifestyleOn = !!(lock && lock.modules && lock.modules.length);
  const quizOn = !!(cls.quizGate && cls.quizGate.enabled && (cls.quizzes || []).some(q => q.active && q.moduleKey));
  return lifestyleOn || quizOn;
}

async function getModuleLockReasons(username, classCode) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  if (!cls || !_classHasAnyModuleLock(cls)) return {};
  const user = await getUserCached(username);
  return getModuleLockReasonsFromData(cls, user, username);
}
async function getLockedModulesForStudent(username, classCode) {
  return Object.keys(await getModuleLockReasons(username, classCode));
}
async function isModuleLockedForStudent(username, classCode, moduleKey) {
  const locked = await getLockedModulesForStudent(username, classCode);
  return locked.includes(moduleKey);
}

// Shared across every page's topbar: greys out nav links to locked
// modules and blocks navigating to them. Pages just need
// nav a[data-module="key"] attributes matching LIFESTYLE_LOCKABLE_MODULES.
const MODULE_LOCK_MESSAGE = {
  lifestyle: "This module is locked because your lifestyle rating is too low right now. Check with your teacher about what's needed to unlock it.",
  quiz: "This module is locked until you pass the quiz your teacher set for it.",
  both: "This module is locked: you need to pass its quiz, and your lifestyle rating is too low right now."
};

/* Nav links that only make sense for a teacher. Students get to their
   report card from a button on their own dashboard, and quizzes come to
   them as a popup the moment they open a module that needs one — so
   neither earns a permanent tab in a nav bar that is already full.
   Removed rather than hidden so fitTopbar() measures the real row. */
const NAV_TEACHER_ONLY = ["reports.html", "quizzes.html"];
function applyNavRoleVisibility(role) {
  if (role === "teacher") {
    // BUGFIX: style.css hides the Quizzes/Reports links until <html> has
    // this class (so a student never sees them flash up while the page is
    // still working out who's logged in) — but nothing ever added it, so
    // teachers never got those two links in the menu at all.
    if (!document.documentElement.classList.contains("role-teacher")) {
      document.documentElement.classList.add("role-teacher");
      if (typeof fitTopbar === "function") fitTopbar();
    }
    return;
  }
  const here = (window.location.pathname.split("/").pop() || "").toLowerCase();
  let removed = false;
  document.querySelectorAll("nav a[href]").forEach(a => {
    const href = (a.getAttribute("href") || "").split("/").pop();
    // Never strip the link to the page the student is actually on — one
    // who followed the report-card button should still see where they are
    // in the nav, even though the tab isn't offered to them.
    if (href.toLowerCase() === here) return;
    if (NAV_TEACHER_ONLY.includes(href)) { a.remove(); removed = true; }
  });
  if (removed && typeof fitTopbar === "function") fitTopbar();
}

// `lockedModules` may be either the plain array this has always taken, or
// the moduleKey -> reason map from getModuleLockReasons(). Accepting both
// keeps every existing caller working unchanged while letting newer ones
// pass the reason through for a more useful message.
function applyNavModuleLocks(lockedModules) {
  const reasons = Array.isArray(lockedModules)
    ? lockedModules.reduce((acc, k) => { acc[k] = "lifestyle"; return acc; }, {})
    : (lockedModules || {});
  document.querySelectorAll("nav a[data-module]").forEach(a => {
    const key = a.dataset.module;
    const reason = reasons[key];
    a.classList.toggle("nav-locked", !!reason);
    if (reason) {
      a.onclick = (e) => {
        e.preventDefault();
        // A quiz lock is the one kind a student can clear on the spot, so
        // open the quiz right here instead of sending them somewhere else
        // (see quiz-gate.js). Anything the quiz can't fix falls through
        // to the plain explanation.
        if ((reason === "quiz" || reason === "both") && typeof t29OpenQuizGate === "function") {
          t29OpenQuizGate(key, { alsoLifestyleLocked: reason === "both", href: a.getAttribute("href") });
          return;
        }
        alert(MODULE_LOCK_MESSAGE[reason] || MODULE_LOCK_MESSAGE.lifestyle);
      };
    } else {
      a.onclick = null;
    }
  });
}

/* ===================== Financial-literacy quizzes =====================
   Short teacher-written quizzes ("how compound interest works", "how
   mortgages work") that a student must PASS before the module they're
   attached to unlocks. This deliberately reuses the module-lock plumbing
   the lifestyle lock already established (see LIFESTYLE_LOCKABLE_MODULES /
   getModuleLockReasonsFromData above) rather than inventing a second one,
   so every page that already greys out a locked nav link keeps working
   with no change.

   Shapes:
     cls.quizGate = { enabled }                 // master on/off switch
     cls.quizzes  = [{
       id, title, description,
       moduleKey,          // "" = practice only, locks nothing
       passMark,           // percent, 0-100
       reward,             // one-off cash bonus the first time it's passed
       active,
       questions: [{ id, text, options: [..], answer: <index>, explain }]
     }]
     user.quizResults = {
       [quizId]: { passed, bestPct, lastPct, attempts, lastDate, rewarded }
     }
   Results live on the USER doc (not the class) for the same reason
   balances do: it's per-student state read on every page load, and keeping
   it off the shared class doc avoids every student's attempt writing to
   the one document the whole class already contends on.
====================================================================== */
const QUIZ_DEFAULT_PASS_MARK = 70;
const QUIZ_MAX_QUESTIONS = 20;

// Accepts the loose shape the teacher UI collects and returns a clean,
// fully-populated quiz object. Questions with no text, or fewer than 2
// options, are dropped rather than saved half-formed.
function normalizeQuiz(q, existing) {
  const questions = (q.questions || []).slice(0, QUIZ_MAX_QUESTIONS).map(raw => {
    const options = (raw.options || []).map(o => String(o || "").trim()).filter(o => o !== "");
    const text = String(raw.text || "").trim();
    if (!text || options.length < 2) return null;
    let answer = Math.floor(Number(raw.answer));
    if (!(answer >= 0 && answer < options.length)) answer = 0;
    return {
      id: raw.id || uid("qq"),
      text, options, answer,
      explain: String(raw.explain || "").trim()
    };
  }).filter(Boolean);

  return {
    id: (existing && existing.id) || q.id || uid("quiz"),
    title: String(q.title || "Untitled quiz").trim(),
    description: String(q.description || "").trim(),
    moduleKey: LIFESTYLE_LOCKABLE_MODULES.some(m => m.key === q.moduleKey) ? q.moduleKey : "",
    passMark: Math.max(0, Math.min(100, Math.round(Number(q.passMark)) || QUIZ_DEFAULT_PASS_MARK)),
    reward: Math.max(0, Math.round((Number(q.reward) || 0) * 100) / 100),
    active: q.active === undefined ? true : !!q.active,
    questions
  };
}

async function setQuizGateEnabled(classCode, enabled) {
  await classesCol().doc(classCode).update({ quizGate: { enabled: !!enabled } });
  return !!enabled;
}

async function addQuiz(classCode, quiz) {
  const clean = normalizeQuiz(quiz);
  if (!clean.questions.length) return { ok: false, error: "Add at least one question with two or more answer options." };
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.quizzes.push(clean);
    t.update(classRef, { quizzes: cls.quizzes });
  });
  return { ok: true, quiz: clean };
}

async function updateQuiz(classCode, quizId, quiz) {
  const classRef = classesCol().doc(classCode);
  let error = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const idx = cls.quizzes.findIndex(q => q.id === quizId);
    if (idx === -1) { error = "That quiz couldn't be found."; return; }
    const clean = normalizeQuiz(quiz, cls.quizzes[idx]);
    if (!clean.questions.length) { error = "Add at least one question with two or more answer options."; return; }
    cls.quizzes[idx] = clean;
    t.update(classRef, { quizzes: cls.quizzes });
  });
  return error ? { ok: false, error } : { ok: true };
}

async function removeQuiz(classCode, quizId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.quizzes = cls.quizzes.filter(q => q.id !== quizId);
    t.update(classRef, { quizzes: cls.quizzes });
  });
  return { ok: true };
}

async function setQuizActive(classCode, quizId, active) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const q = cls.quizzes.find(x => x.id === quizId);
    if (!q) return;
    q.active = !!active;
    t.update(classRef, { quizzes: cls.quizzes });
  });
  return { ok: true };
}

function quizResultFor(user, quizId) {
  return ((user && user.quizResults) || {})[quizId] || null;
}

// Grades one attempt and records it. Returns a per-question review so the
// student immediately sees WHICH ones they got wrong and why — the whole
// point of a literacy quiz is the explanation, not the score.
async function submitQuizAttempt(username, classCode, quizId, answers) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let outcome = null, rewardPaid = 0, quizTitle = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const quiz = cls.quizzes.find(q => q.id === quizId);
      if (!quiz || !quiz.active) throw new Error("NOT_FOUND");
      quizTitle = quiz.title;

      const review = quiz.questions.map(q => {
        const raw = answers ? answers[q.id] : undefined;
        const chosen = (raw === undefined || raw === null || raw === "") ? null : Number(raw);
        return {
          id: q.id, text: q.text, options: q.options,
          chosen, answer: q.answer, correct: chosen === q.answer, explain: q.explain
        };
      });
      const total = review.length;
      const correct = review.filter(r => r.correct).length;
      const pct = total ? Math.round((correct / total) * 100) : 0;
      const passed = pct >= quiz.passMark;

      const results = user.quizResults || {};
      const prev = results[quizId] || { passed: false, bestPct: 0, attempts: 0, rewarded: false };
      const newlyPassed = passed && !prev.passed;
      const payReward = newlyPassed && quiz.reward > 0 && !prev.rewarded && user.role !== "teacher";
      results[quizId] = {
        passed: prev.passed || passed,
        bestPct: Math.max(prev.bestPct || 0, pct),
        lastPct: pct,
        attempts: (prev.attempts || 0) + 1,
        lastDate: nzDateKey(),
        rewarded: prev.rewarded || payReward
      };

      const update = { quizResults: results };
      // The reward is paid once, on the first pass ever — retaking a quiz
      // you've already passed can never farm it again.
      if (payReward) {
        rewardPaid = quiz.reward;
        update.balance = Math.round((user.balance + quiz.reward) * 100) / 100;
      }
      t.update(userRef, update);
      outcome = { ok: true, correct, total, pct, passed, newlyPassed, passMark: quiz.passMark, review };
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "That quiz couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (rewardPaid > 0) {
    await logTxn(classCode, { type: "quiz-reward", to: username, amount: rewardPaid, note: `Passed the quiz: ${quizTitle}` });
  }
  if (outcome) outcome.reward = rewardPaid;
  return outcome || { ok: false, error: "Something went wrong. Please try again." };
}

// Teacher override: wipe one student's result for a quiz so they start
// again from scratch (which locks the module back up if the gate is on).
async function resetQuizResult(username, quizId) {
  const userRef = usersCol().doc(username);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (!snap.exists) return;
    const user = snap.data();
    const results = user.quizResults || {};
    delete results[quizId];
    t.update(userRef, { quizResults: results });
  });
  return { ok: true };
}
