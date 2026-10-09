/* ===================== The 29 World — data layer: property =====================
   Buying and selling property, mortgages, daily price movement, renting a
   property out to a classmate, and school-owned (NPC) rentals.
   Part of the data layer — see the top of data-core.js for how the five
   data-*.js files fit together.
====================================================================== */

/* ===================== Property =====================
   A "listing" a teacher creates in the UI can represent more than one
   identical house available for sale (e.g. "Cosy Cottage x5"). Under the
   hood each purchasable unit is still its own separate entry in
   cls.properties (own id, own owner/mortgage/occupancy state — nothing
   downstream like buyProperty/sellProperty/payMortgage/
   processPropertyRent needs to change), but all units from the same
   listing share a `groupId` so the UI can show them as one card with an
   "X of N available" count instead of N duplicate cards. Properties saved
   before this feature existed have no groupId — they're treated as their
   own group of 1 (see groupIdOf below), so nothing breaks for them. */
function groupIdOf(prop) { return prop.groupId || prop.id; }

async function addProperty(classCode, prop) {
  const classRef = classesCol().doc(classCode);
  const qty = Math.max(1, Math.floor(Number(prop.quantity)) || 1);
  const groupId = uid("propgrp");
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    for (let i = 0; i < qty; i++) {
      cls.properties.push({
        id: uid("prop"), groupId, name: prop.name, price: Number(prop.price),
        comfort: Math.max(1, Math.min(5, Number(prop.comfort) || 1)),
        mortgageWeeks: Number(prop.mortgageWeeks) || 0,
        // Weekly interest rate charged on the outstanding mortgage
        // principal (percent per week, e.g. 2 = 2%/week). Defaults to 0 —
        // an interest-free installment plan — unless the teacher sets one.
        mortgageInterestRate: Math.max(0, Number(prop.mortgageInterestRate) || 0),
        description: prop.description || "", owner: null,
        // Weekly rent an owner can earn if they choose to rent this property
        // out instead of living in it, and which NZ weekday that rent is
        // paid on (see processPropertyRent). occupancy tracks the owner's
        // current choice — "living" | "rented" | null (not yet chosen).
        rentPerWeek: Math.max(0, Number(prop.rentPerWeek) || 0),
        rentDay: DAY_NAMES.includes(prop.rentDay) ? prop.rentDay : "Fri",
        // Bonus lifestyle stars this property is worth to its owner while
        // they live in it (on top of its own comfort rating) — see
        // propertyLivingBonusPoints.
        livingBonusStars: Math.max(0, Number(prop.livingBonusStars) || 0),
        occupancy: null, rentLastWeekPaid: null,
        // Daily-fluctuating price support, mirroring the stock market's
        // co.history/historyDates/priceRange (see applyPropertyMarketDayMoves
        // below). priceRange is per-listing and null by default, meaning
        // "use the class-wide cls.propertyPriceRange" — set via
        // setListingPriceRange to override just this listing.
        priceHistory: [Number(prop.price)], priceHistoryDates: [nzDateKey()],
        priceRange: null, purchasePrice: null
      });
    }
    t.update(classRef, { properties: cls.properties });
  });
}
// propId here is the id of ANY unit in the listing — removes every unit
// that shares its groupId (i.e. removes the whole listing, all units).
// Owners of removed units are not refunded automatically (same as before).
async function removeProperty(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.properties.find(p => p.id === propId);
    if (!target) return;
    const gid = groupIdOf(target);
    cls.properties = cls.properties.filter(p => groupIdOf(p) !== gid);
    t.update(classRef, { properties: cls.properties });
  });
}
// propId is the id of ANY unit in the listing. Shared fields (name,
// price, comfort, mortgage terms, description, rent) are applied to every
// unit in the group, whether it's currently owned or not — this doesn't
// touch anyone's owner/mortgage/occupancy state. `updates.quantity` grows
// or shrinks the number of units: growing adds fresh available units;
// shrinking only ever removes currently-UNOWNED units (never repossesses
// someone's home) — if there aren't enough unowned units to shrink down
// to the requested count, it removes as many as it safely can and stops.
async function updateProperty(classCode, propId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.properties.find(p => p.id === propId);
    if (!target) return;
    const gid = groupIdOf(target);
    const units = cls.properties.filter(p => groupIdOf(p) === gid);
    // A manual price edit here is a deliberate teacher override, same as
    // clicking "Update" on a company's price in the Stock Market — it
    // should show up in the price history/sparkline too, not just silently
    // change the number. Every unit in the listing shares one price, so
    // this only needs deciding once, against whatever the (shared) price
    // was before this edit.
    const oldPrice = Number(target.price);
    const newPrice = Number(updates.price);
    const priceChanged = Number.isFinite(newPrice) && newPrice > 0 && newPrice !== oldPrice;
    const editDateKey = nzDateKey();
    units.forEach(prop => {
      prop.groupId = gid;
      prop.name = updates.name;
      prop.price = Number(updates.price);
      prop.comfort = Math.max(1, Math.min(5, Number(updates.comfort) || 1));
      prop.mortgageWeeks = Number(updates.mortgageWeeks) || 0;
      prop.mortgageInterestRate = Math.max(0, Number(updates.mortgageInterestRate) || 0);
      prop.description = updates.description || "";
      prop.rentPerWeek = Math.max(0, Number(updates.rentPerWeek) || 0);
      prop.rentDay = DAY_NAMES.includes(updates.rentDay) ? updates.rentDay : "Fri";
      prop.livingBonusStars = Math.max(0, Number(updates.livingBonusStars) || 0);
      if (priceChanged) {
        (prop.priceHistory = prop.priceHistory || [oldPrice]).push(newPrice);
        (prop.priceHistoryDates = prop.priceHistoryDates || []).push(editDateKey);
        if (prop.priceHistory.length > 30) prop.priceHistory.shift();
        if (prop.priceHistoryDates.length > 30) prop.priceHistoryDates.shift();
      }
    });
    const desiredQty = Math.max(1, Math.floor(Number(updates.quantity)) || 1);
    const currentQty = units.length;
    if (desiredQty > currentQty) {
      const template = units[0];
      for (let i = 0; i < desiredQty - currentQty; i++) {
        cls.properties.push({
          id: uid("prop"), groupId: gid, name: template.name, price: template.price,
          comfort: template.comfort, mortgageWeeks: template.mortgageWeeks,
          mortgageInterestRate: template.mortgageInterestRate || 0,
          description: template.description, owner: null,
          rentPerWeek: template.rentPerWeek, rentDay: template.rentDay,
          livingBonusStars: template.livingBonusStars || 0,
          occupancy: null, rentLastWeekPaid: null,
          priceHistory: (template.priceHistory || [template.price]).slice(),
          priceHistoryDates: (template.priceHistoryDates || [editDateKey]).slice(),
          priceRange: template.priceRange || null, purchasePrice: null
        });
      }
    } else if (desiredQty < currentQty) {
      let toRemove = currentQty - desiredQty;
      const removeIds = new Set();
      for (const p of units) {
        if (toRemove <= 0) break;
        if (!p.owner) { removeIds.add(p.id); toRemove--; }
      }
      if (removeIds.size > 0) {
        cls.properties = cls.properties.filter(p => !removeIds.has(p.id));
      }
    }
    t.update(classRef, { properties: cls.properties });
  });
}

/* ---------------- Property: daily price movement ----------------
   Mirrors the Stock Market's cls.priceRange / co.priceRange /
   applyMarketDayMoves / autoMarketDayIfDue / simulateMarketDay pattern
   (see "Stock market" section above) so property prices drift by a random
   teacher-set percentage every simulated day, exactly like share prices
   do. The main difference is that a property "listing" is several
   identical units (see groupIdOf) sharing one price, so a day's move is
   rolled ONCE per listing and then applied to every unit in that group,
   never once per unit — otherwise two units of the same listing could
   silently end up at different prices. NPC properties have no price field
   (they're rent-only, "the school" is the landlord) and are untouched. */

// Class-wide default daily move range (percent), used by any listing that
// doesn't have its own priceRange override. Fire-and-forget, matching
// setPriceRange's style for the stock market.
async function setPropertyPriceRange(classCode, min, max) {
  await classesCol().doc(classCode).update({
    propertyPriceRange: { min: Math.max(0, Number(min)), max: Math.max(0, Number(max)) }
  });
}

// Quick teacher override for a listing's price alone — same idea as the
// Stock Market's updateCompanyPrice "Set new price" control, without
// having to reopen the full Edit form and resubmit every other field.
// propId can be any unit's id within the listing; the new price applies to
// every unit in the group and is recorded in history exactly like a
// simulated market day or a full edit-form price change (see
// updateProperty). Does NOT touch purchasePrice — an owner's "since you
// bought it" gain/loss should react to this the same way it reacts to any
// other price move, not be reset by it.
async function setPropertyPrice(classCode, propId, newPrice) {
  const parsed = Number(newPrice);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "Enter a valid price greater than 0." };
  }
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.properties.find(p => p.id === propId);
    if (!target) return;
    const gid = groupIdOf(target);
    const oldPrice = target.price;
    const newP = Math.max(0.01, Math.round(parsed * 100) / 100);
    const dateKey = nzDateKey();
    cls.properties.filter(p => groupIdOf(p) === gid).forEach(p => {
      if (!Array.isArray(p.priceHistory) || p.priceHistory.length === 0) p.priceHistory = [oldPrice];
      if (!Array.isArray(p.priceHistoryDates)) p.priceHistoryDates = [];
      p.price = newP;
      p.priceHistory.push(newP);
      p.priceHistoryDates.push(dateKey);
      if (p.priceHistory.length > 30) p.priceHistory.shift();
      if (p.priceHistoryDates.length > 30) p.priceHistoryDates.shift();
    });
    t.update(classRef, { properties: cls.properties });
  });
  return { ok: true };
}

// Per-listing override (or, passed null/blank, clears back to "use the
// class-wide default"). propId can be any unit's id within the listing —
// applies to every unit in the group, same convention as updateProperty.
async function setListingPriceRange(classCode, propId, min, max) {
  const hasMin = min !== null && min !== "" && min !== undefined;
  const hasMax = max !== null && max !== "" && max !== undefined;
  if (hasMin !== hasMax) {
    return { ok: false, error: "Set both a minimum and a maximum, or leave both blank to use the class default." };
  }
  const parsedMin = hasMin ? Number(min) : null;
  const parsedMax = hasMax ? Number(max) : null;
  if (hasMin && (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax))) {
    return { ok: false, error: "Enter valid numbers for the price range." };
  }
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.properties.find(p => p.id === propId);
    if (!target) return;
    const gid = groupIdOf(target);
    const range = hasMin ? { min: Math.max(0, parsedMin), max: Math.max(0, parsedMax) } : null;
    cls.properties.filter(p => groupIdOf(p) === gid).forEach(p => { p.priceRange = range; });
    t.update(classRef, { properties: cls.properties });
  });
  return { ok: true };
}

// Applies one simulated day's random price move to every for-sale property
// LISTING on `cls` IN PLACE (all units in a listing move together — see
// the header comment above), and returns one result per listing. Shared by
// the auto-trigger and the manual "Simulate a property day" button, same
// division of labour as applyMarketDayMoves/simulateMarketDay.
function applyPropertyMarketDayMoves(cls) {
  const results = [];
  const range = cls.propertyPriceRange || { min: 0.5, max: 2 };
  const dateKey = nzDateKey();
  const groups = new Map();
  (cls.properties || []).forEach(p => {
    const gid = groupIdOf(p);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(p);
  });
  groups.forEach(units => {
    const first = units[0];
    const oldPrice = first.price;
    const listingRange = first.priceRange || range;
    const pct = listingRange.min + Math.random() * (listingRange.max - listingRange.min);
    // Upward bias: 60% chance of an up day vs 40% down (same as shares).
    const direction = Math.random() < 0.4 ? -1 : 1;
    const newPrice = Math.max(0.01, Math.round(oldPrice * (1 + (direction * pct) / 100) * 100) / 100);
    units.forEach(u => {
      if (!Array.isArray(u.priceHistory) || u.priceHistory.length === 0) u.priceHistory = [oldPrice];
      if (!Array.isArray(u.priceHistoryDates)) u.priceHistoryDates = [];
      u.price = newPrice;
      u.priceHistory.push(newPrice);
      u.priceHistoryDates.push(dateKey);
      if (u.priceHistory.length > 30) u.priceHistory.shift();
      if (u.priceHistoryDates.length > 30) u.priceHistoryDates.shift();
    });
    results.push({ name: first.name, pct: direction * pct });
  });
  return results;
}

// Runs the property price simulation automatically once per NZ calendar
// day, the same "first page load of the day wins" pattern as
// autoMarketDayIfDue — see the big comment on that function for why the
// "claim today" flag and the actual price move have to be one atomic
// transaction rather than two.
async function autoPropertyMarketDayIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || cls.archived) return [];
  const todayKey = nzDateKey();
  if (cls.lastPropertyMarketDayRun === todayKey) return [];
  if (!cls.properties || cls.properties.length === 0) {
    await classesCol().doc(classCode).update({ lastPropertyMarketDayRun: todayKey }).catch(() => {});
    return [];
  }
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    results = []; // reset every attempt — this callback can be retried
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = withNewModuleDefaults(snap.data());
    if (liveCls.lastPropertyMarketDayRun === todayKey) return;
    results = applyPropertyMarketDayMoves(liveCls);
    t.update(classRef, { properties: liveCls.properties, lastPropertyMarketDayRun: todayKey });
  });
  return results;
}

async function simulatePropertyMarketDay(classCode) {
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    results = []; // reset every attempt — this callback can be retried
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    results = applyPropertyMarketDayMoves(cls);
    t.update(classRef, { properties: cls.properties });
  });
  return results;
}

// opts.useKiwiSaver: put the student's KiwiSaver towards it (first home
// only — see kiwiSaverFirstHomeInfo in data-money.js). It pays as much of
// the deposit (or the whole price, buying outright) as it can, and their
// cash pays the rest.
async function buyProperty(username, classCode, propId, financed, depositAmount, opts) {
  const useKiwiSaver = !!(opts && opts.useKiwiSaver);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let deposit = 0, weekly = 0, propName = "", cashPaid = 0, taxAmount = 0, mortgaged = false, fromKiwi = 0;
  try {
    await fdb.runTransaction(async (t) => {
      deposit = 0; cashPaid = 0; mortgaged = false; fromKiwi = 0; // reset every attempt — this callback can be retried
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop) throw new Error("NOT_FOUND");
      if (prop.owner) throw new Error("TAKEN");
      propName = prop.name;
      const discountedPropPrice = applyLifeDiscount(user, "property", prop.price);
      const { total: taxedPrice, taxAmount: tax } = applyTaxToExpense(cls, "property", discountedPropPrice);
      taxAmount = tax;
      const isTeacher = user.role === "teacher";
      // How much KiwiSaver can put in, and the student's KiwiSaver after it
      // has (written below, in this same transaction, only if it's used).
      let kiwiAvailable = 0, ksAfter = null;
      if (useKiwiSaver && !isTeacher) {
        const info = kiwiSaverFirstHomeInfo(cls, user, username);
        if (!info.eligible) throw new Error("NO_KIWI");
        ksAfter = ksCatchUp(cls, kiwiSaverOf(user));
        kiwiAvailable = Math.min(info.available, ksAfter.balance);
      }
      const takeFromKiwi = (amount) => {
        fromKiwi = Math.round(Math.min(kiwiAvailable, amount) * 100) / 100;
        if (!(fromKiwi > 0)) return {};
        ksAfter.balance = Math.round((ksAfter.balance - fromKiwi) * 100) / 100;
        ksAfter.withdrawn = Math.round((ksAfter.withdrawn + fromKiwi) * 100) / 100;
        ksAfter.firstHomeUsed = true;
        return { kiwiSaver: ksAfter };
      };
      // Snapshot what was actually paid (post-discount, post-tax, and the
      // same whether bought outright or financed — a mortgage just spreads
      // this same total out) as the baseline students see their "since you
      // bought it" gain/loss against later, once the price keeps drifting
      // day to day. See propertyGainSinceBought in property.js.
      prop.purchasePrice = Math.round(taxedPrice * 100) / 100;
      if (financed && prop.mortgageWeeks > 0) {
        // Deposit is now student-chosen in dollars, not a fixed 10% — but
        // 10% of the taxed price is still the floor, and the full price is
        // the ceiling (can't "deposit" more than the property costs).
        // Clamped here, not just in the UI, so a missing/bad/too-low value
        // from the client can never produce a mortgage under the minimum.
        const minDeposit = Math.round(taxedPrice * 0.1 * 100) / 100;
        let depositAmt = Number(depositAmount);
        if (!Number.isFinite(depositAmt)) depositAmt = minDeposit;
        depositAmt = Math.min(taxedPrice, Math.max(minDeposit, depositAmt));
        deposit = Math.round(depositAmt * 100) / 100;
        weekly = Math.round(((taxedPrice - deposit) / prop.mortgageWeeks) * 100) / 100;
        const kiwiUpdate = takeFromKiwi(deposit);
        if (!isTeacher && user.balance < deposit - fromKiwi) throw new Error("BROKE");
        prop.owner = username;
        // purchaseWeekKey marks the ISO week the mortgage was taken out —
        // payMortgage blocks payment during the mortgage's own purchase
        // week. interestRate is snapshotted from the listing at purchase
        // time (so a later change to the listing's rate doesn't
        // retroactively alter an existing mortgage) and is charged each
        // week on principalRemaining — the financed amount still
        // outstanding, which only ever goes down by the (interest-free)
        // weeklyPayment installment, same schedule as weeksLeft.
        prop.mortgage = {
          weeksLeft: prop.mortgageWeeks, weeklyPayment: weekly,
          purchaseWeekKey: isoWeekKey(new Date()), lastWeekPaid: null,
          interestRate: prop.mortgageInterestRate || 0,
          principalRemaining: Math.round((taxedPrice - deposit) * 100) / 100
        };
        prop.occupancy = null; prop.rentLastWeekPaid = null;
        prop.sublet = null; // a new owner never inherits someone else's tenant or rental listing
        mortgaged = true;
        if (!isTeacher) t.update(userRef, Object.assign({ balance: Math.round((user.balance - (deposit - fromKiwi)) * 100) / 100 }, kiwiUpdate));
      } else {
        const kiwiUpdate = takeFromKiwi(taxedPrice);
        if (!isTeacher && user.balance < taxedPrice - fromKiwi) throw new Error("BROKE");
        prop.owner = username;
        prop.mortgage = null;
        prop.occupancy = null; prop.rentLastWeekPaid = null;
        prop.sublet = null; // a new owner never inherits someone else's tenant or rental listing
        cashPaid = Math.round((taxedPrice - fromKiwi) * 100) / 100;
        if (!isTeacher) t.update(userRef, Object.assign({ balance: Math.round((user.balance - cashPaid) * 100) / 100 }, kiwiUpdate));
      }
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "TAKEN") return { ok: false, error: "Someone already bought that property." };
    if (e.message === "BROKE") return { ok: false, error: useKiwiSaver ? "You don't have enough money for that, even with your KiwiSaver." : "You don't have enough money for that." };
    if (e.message === "NO_KIWI") return { ok: false, error: "You can't use your KiwiSaver for this property." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  // `mortgaged`, not `financed`: asking for a mortgage on a listing that
  // doesn't offer one buys it outright, and is logged as that. The amount
  // is the CASH that left their account; KiwiSaver's part is in the note.
  const kiwiNote = fromKiwi > 0 ? ` (${fmtMoney(fromKiwi)} from KiwiSaver)` : "";
  await logTxn(classCode, { type: "property-buy", from: username, amount: mortgaged ? Math.round((deposit - fromKiwi) * 100) / 100 : cashPaid, note: (mortgaged ? `Bought (mortgaged): ${propName} — ${fmtMoney(deposit)} deposit${kiwiNote}` : `Bought outright: ${propName}${kiwiNote}`) + (taxAmount > 0 ? ` (incl. ${fmtMoney(taxAmount)} tax)` : "") });
  return { ok: true, fromKiwi };
}
// Sells a property back to the class. The owner is paid whatever the
// property's current market price is (prop.price — already reflects daily
// price drift from applyPropertyMarketDayMoves, teacher edits, etc., so
// it's the exact same number shown on the listing right now; there's no
// separate sell-back discount). If the property still has an active
// mortgage, whatever's left to pay off (see mortgageWeekAmount's
// balanceBefore) is deducted from that payout, and on top of that so is
// the teacher-set break fee (see setPropertyBreakFee) — neither is ever
// charged on a sale with no mortgage in progress. The payout can go
// negative if the debts being cleared exceed the market price; that's
// simply taken out of the owner's balance rather than blocked, so a
// student can always get out from under a mortgage they can no longer
// afford. Returns the full breakdown so property.js's confirmation popup
// (see openSellModal) can show a student or teacher exactly what a sale
// will do *before* it's confirmed — the popup previews these same numbers
// itself, but this is the one place that actually charges anyone.
async function sellProperty(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let owner = null, propName = "", marketPrice = 0, mortgagePayoff = 0, breakFee = 0, payout = 0, blocked = false;
  await fdb.runTransaction(async (t) => {
    owner = null; blocked = false;
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const prop = cls.properties.find(p => p.id === propId);
    if (!prop || !prop.owner) return;
    // A teacher repossessing it is never blocked — only the student
    // selling their own while a big event has it at risk.
    if (t29SessionStudent() === prop.owner && pendingBigEventFor(cls, prop.owner, "property", prop.id)) { blocked = true; return; }
    owner = prop.owner;
    propName = prop.name;
    marketPrice = prop.price;
    if (prop.mortgage) {
      mortgagePayoff = mortgageWeekAmount(prop.mortgage).balanceBefore;
      breakFee = Math.max(0, Number(cls.propertyBreakFee) || 0);
    }
    payout = Math.round((marketPrice - mortgagePayoff - breakFee) * 100) / 100;
    prop.owner = null;
    prop.mortgage = null;
    prop.occupancy = null;
    prop.rentLastWeekPaid = null;
    prop.purchasePrice = null;
    // Repossession/sell-back also ends any classmate rental in progress —
    // there's no owner left for the tenant to be renting from.
    prop.sublet = null;
    t.update(classRef, { properties: cls.properties });
  });
  if (blocked) return { ok: false, error: BIG_EVENT_BLOCK_MESSAGE };
  if (!owner) return { ok: false };
  await adjustBalance(owner, payout);
  const breakdown = mortgagePayoff > 0
    ? ` (market price ${fmtMoney(marketPrice)} minus ${fmtMoney(mortgagePayoff)} mortgage payoff${breakFee > 0 ? ` and ${fmtMoney(breakFee)} break fee` : ""})`
    : "";
  await logTxn(classCode, { type: "property-sell", to: owner, amount: payout, note: `Sold back: ${propName}${breakdown}` });
  return { ok: true, marketPrice, mortgagePayoff, breakFee, payout };
}
// The one and only way a mortgage installment is ever paid: the student
// pays this week's installment themselves. Nothing in this app ever
// deducts a mortgage payment automatically. There's never an amount to
// type in — the weekly installment (+ interest on the remaining
// principal) is fixed by the mortgage itself, so students can't pay extra,
// pay early against a future week, or pay a custom amount here.
// Guards on the normal weekly payment:
//   - it only works on the class's mortgageDay (teacher-set), or for this
//     ISO week only if the teacher has marked payments due now (see
//     setMortgageDueOverride); and
//   - it's blocked during the ISO week the property was purchased (that
//     week is always free), and to once per ISO week thereafter via
//     mortgage.lastWeekPaid.
// An unaffordable payment is simply refused (BROKE) — nothing is part-paid
// and nothing accumulates as debt, since the student is the only one who
// can ever trigger a charge in the first place.
// The actual amount a mortgage's next payment will be — principal +
// interest-on-remaining-balance — worked out the same way whether it's
// being displayed ahead of time (property.js) or actually charged
// (payMortgage below), so the number shown to a student is never different
// from the number they get charged.
function mortgageWeekAmount(mortgage) {
  const principalBefore = mortgage.principalRemaining != null
    ? mortgage.principalRemaining
    : mortgage.weeklyPayment * mortgage.weeksLeft; // pre-existing mortgages without the field
  const interest = Math.round(principalBefore * ((mortgage.interestRate || 0) / 100) * 100) / 100;
  const principal = Math.round(mortgage.weeklyPayment * 100) / 100;
  return { balanceBefore: Math.round(principalBefore * 100) / 100, interest, principal, total: Math.round((principal + interest) * 100) / 100 };
}

async function payMortgage(username, classCode, propId) {
  const classRef = classesCol().doc(classCode);
  const userRef = usersCol().doc(username);
  let amt = 0, remainingAfter = 0, propName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const classSnap = await t.get(classRef);
      const userSnap = await t.get(userRef);
      if (!classSnap.exists || !userSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(classSnap.data());
      const user = userSnap.data();
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || prop.owner !== username || !prop.mortgage || prop.mortgage.weeksLeft <= 0) throw new Error("NOT_FOUND");
      const weekKey = isoWeekKey(new Date());
      // Payable either on the class's normal mortgage day, or — for this
      // ISO week only — if the teacher has manually forced it due (see
      // setMortgageDueOverride).
      const forcedDue = cls.mortgageForceDueWeek === weekKey;
      propName = prop.name;

      if ((cls.mortgageDay || "Fri") !== nzDayName() && !forcedDue) throw new Error("WRONG_DAY");
      if (prop.mortgage.purchaseWeekKey === weekKey) throw new Error("PURCHASE_WEEK");
      if (prop.mortgage.lastWeekPaid === weekKey) throw new Error("ALREADY_PAID");
      // Interest is charged on the principal still remaining.
      const weekAmt = mortgageWeekAmount(prop.mortgage);
      amt = weekAmt.total;
      if (user.balance < amt) throw new Error("BROKE");
      t.update(userRef, { balance: Math.round((user.balance - amt) * 100) / 100 });
      prop.mortgage.principalRemaining = Math.max(0, Math.round((weekAmt.balanceBefore - prop.mortgage.weeklyPayment) * 100) / 100);
      prop.mortgage.weeksLeft -= 1;
      prop.mortgage.lastWeekPaid = weekKey;
      remainingAfter = prop.mortgage.weeksLeft;
      if (remainingAfter <= 0) prop.mortgage = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "WRONG_DAY") return { ok: false, error: "You can only pay your mortgage on its due day." };
    if (e.message === "PURCHASE_WEEK") return { ok: false, error: "Your first payment isn't due yet — the week you bought is free." };
    if (e.message === "ALREADY_PAID") return { ok: false, error: "This week's payment has already gone through." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for this week's payment." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That mortgage couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "mortgage", from: username, amount: amt, note: `Mortgage payment: ${propName}` + (remainingAfter <= 0 ? " — paid off!" : "") });
  return { ok: true, amount: amt, fullyPaid: remainingAfter <= 0 };
}

// Turns an isoWeekKey() string ("2026-W9") into a plain number that sorts
// the same way chronologically (2026-W9 < 2026-W10), which a plain string
// comparison gets wrong ("2026-W9" > "2026-W10" lexically).
function weekKeyOrder(key) {
  const [y, w] = key.split("-W").map(Number);
  return y * 100 + w;
}

// Which ISO week the most recently-passed mortgage due day falls in —
// today's week if today IS the due day (see overdueMortgageWeekKey for why
// that one doesn't count as "passed" yet), otherwise the due day one cycle
// before that. Independent of any one property, since the due day is a
// class-wide setting (see setMortgageDay).
function lastMortgageDueWeekKey(cls) {
  // ISO weekday ordinal, Monday = 0 ... Sunday = 6 — matches the Mon-Sun
  // weeks isoWeekKey groups payments into, unlike DAY_NAMES' Sun-first order.
  const isoIdx = day => (DAY_NAMES.indexOf(day) + 6) % 7;
  const dueIdx = isoIdx(cls.mortgageDay || "Fri");
  const todayIdx = isoIdx(nzDayName());
  let daysSinceDue = todayIdx - dueIdx;
  if (daysSinceDue <= 0) daysSinceDue += 7;
  const lastDueDateKey = dateKeyPlusDays(nzDateKey(), -daysSinceDue);
  return isoWeekKey(new Date(dateKeyToUTC(lastDueDateKey)));
}

// The ISO week key of this mortgage's currently-unpaid cycle, or null if
// there isn't one right now. Backs both isMortgagePaymentOverdue (the red
// banner) and resolveMortgageOverdue (its "mark as resolved" button) so
// the two always agree on exactly which cycle is missing — resolving has
// to clear the specific week that's actually overdue, not just "this
// week", or waiving an old missed payment before this week's own due day
// arrives would also silently mark the upcoming one as paid (see
// resolveMortgageOverdue). Doesn't count how many weeks running it's been
// missed, just which cycle (if any) is currently unpaid.
// Deliberately looks back to the most recently-passed due day rather than
// only checking "this ISO week": a mortgage due on Friday that's missed
// stays flagged as overdue through the weekend AND the following week
// (Mon-Thu) right up until the next due day passes — not just for the two
// days before the ISO week rolls over, which used to hide a still-missed
// payment from the teacher for most of the week.
function overdueMortgageWeekKey(prop, cls) {
  if (!prop || !prop.mortgage || prop.mortgage.weeksLeft <= 0) return null;
  const mortgage = prop.mortgage;
  const weekKey = isoWeekKey(new Date());
  if (mortgage.purchaseWeekKey === weekKey) return null; // first week is always free
  if (mortgage.lastWeekPaid === weekKey) return null; // already paid this week
  // A teacher-forced due week (see setMortgageDueOverride) counts as
  // overdue-until-paid immediately, same as the normal due day passing.
  if (cls.mortgageForceDueWeek === weekKey) return weekKey;
  const lastDueWeekKey = lastMortgageDueWeekKey(cls);
  if (lastDueWeekKey === weekKey) return weekKey; // this week's due day already passed, and neither check above cleared it
  if (mortgage.lastWeekPaid === lastDueWeekKey) return null; // that earlier cycle was paid
  // Guard against looking back further than the mortgage has existed — if
  // the last due day falls before the property was even bought, there was
  // no payment owed for it.
  // BUGFIX: was `<`. The purchase week itself is free (see above), so a due
  // day falling IN the purchase week isn't owed either — with `<`, a new
  // buyer was flagged overdue (and reminded daily) Mon-Thu of the following
  // week, when they couldn't even pay yet (payMortgage only allows the due day).
  if (weekKeyOrder(lastDueWeekKey) <= weekKeyOrder(mortgage.purchaseWeekKey)) return null;
  return lastDueWeekKey; // an earlier due day passed without payment and hasn't been caught up since
}

// Whether this property's mortgage currently has a missed weekly payment.
// Used to show a red "payment overdue" warning on the teacher's student
// profile popup, alongside a button to waive it (see
// resolveMortgageOverdue). Purely a read of already-loaded data — doesn't
// touch the database or move any money.
function isMortgagePaymentOverdue(prop, cls) {
  return overdueMortgageWeekKey(prop, cls) !== null;
}

// Teacher-only: clear a mortgage's currently-missed payment without taking
// any money from the student — same bookkeeping as an ordinary payment
// (see payMortgage) — principal drops by this week's instalment, weeksLeft
// ticks down one, and the mortgage finishes off entirely if that was the
// last payment — except the student's balance is never touched. Called
// from the "Mortgage payment overdue" banner on the teacher's student
// profile popup (see isMortgagePaymentOverdue), e.g. to waive a payment
// the class missed while away, or a mistake the teacher doesn't want to
// chase the student for. Refuses if the mortgage isn't actually overdue,
// so it can't be used to skip ahead on a payment that's still on schedule.
// Marks the specific overdue cycle as paid (see overdueMortgageWeekKey)
// rather than just "this week" — waiving an old missed payment mid-week,
// before this week's own due day has even arrived, must not also mark
// that still-upcoming payment as settled.
async function resolveMortgageOverdue(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", ownerUsername = "", remainingAfter = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const classSnap = await t.get(classRef);
      if (!classSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(classSnap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.mortgage || prop.mortgage.weeksLeft <= 0) throw new Error("NOT_FOUND");
      const overdueWeekKey = overdueMortgageWeekKey(prop, cls);
      if (!overdueWeekKey) throw new Error("NOT_OVERDUE");
      propName = prop.name;
      ownerUsername = prop.owner;
      const weekAmt = mortgageWeekAmount(prop.mortgage);
      prop.mortgage.principalRemaining = Math.max(0, Math.round((weekAmt.balanceBefore - prop.mortgage.weeklyPayment) * 100) / 100);
      prop.mortgage.weeksLeft -= 1;
      prop.mortgage.lastWeekPaid = overdueWeekKey;
      remainingAfter = prop.mortgage.weeksLeft;
      if (remainingAfter <= 0) prop.mortgage = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "NOT_OVERDUE") return { ok: false, error: "This mortgage isn't currently overdue." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That mortgage couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "mortgage", from: ownerUsername, note: `Mortgage payment marked as resolved by teacher, no charge: ${propName}` + (remainingAfter <= 0 ? " — paid off!" : "") });
  return { ok: true, fullyPaid: remainingAfter <= 0 };
}

// Student picks (or changes, any time) whether they live in their property
// or rent it out. Living in it earns a flat lifestyle bonus (see
// lifestyleRatingFromData); renting it out earns weekly rent instead, paid
// automatically on the property's rentDay (see processPropertyRent), but
// gives no lifestyle bonus on top of the property's base comfort score.
// Switching choice takes effect immediately and resets the rent-paid
// tracker so a mid-week switch can't double- or skip-pay that week's rent.
// Teacher-only: end a student's rental arrangement on the spot — stops any
// further rent payments and clears their occupancy choice back to
// "undecided", so next time they visit Property they're prompted to pick
// living-in-it or renting-out again (same prompt as a brand new purchase).
// Unlike setPropertyOccupancy this doesn't check who owns the property —
// it's a teacher override, not a student self-service action.
async function teacherEndRental(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", owner = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.owner) throw new Error("NOT_FOUND");
      propName = prop.name;
      owner = prop.owner;
      prop.occupancy = null;
      prop.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", to: owner, note: `Teacher ended the rental / kicked out tenants: ${propName}` });
  return { ok: true };
}

async function setPropertyOccupancy(username, classCode, propId, occupancy) {
  if (occupancy !== "living" && occupancy !== "rented") {
    return { ok: false, error: "Invalid choice." };
  }
  const classRef = classesCol().doc(classCode);
  const userRef = usersCol().doc(username);
  let propName = "", moveCost = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      const userSnap = await t.get(userRef);
      if (!snap.exists || !userSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const user = userSnap.data();
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop) throw new Error("NOT_FOUND");
      if (prop.owner !== username) throw new Error("NOT_OWNER");
      propName = prop.name;
      // Choosing to live here is only an actual "move" if they weren't
      // already living here (re-confirming the same choice is a no-op, and
      // costs nothing). Choosing "rented" is never a move-in — it's the
      // owner opting out of living somewhere, never opting into it — so it
      // never touches the one-home guard, the daily cooldown, or the cost.
      if (occupancy === "living" && prop.occupancy !== "living") {
        moveCost = chargeMoveOrThrow(t, userRef, username, user, cls, propId);
      }
      prop.occupancy = occupancy;
      prop.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "NOT_OWNER") return { ok: false, error: "You don't own that property." };
    if (e.message === "ALREADY_HOUSED") return { ok: false, error: "You're already living somewhere else — move out of that first." };
    if (e.message === "MOVED_TODAY") return { ok: false, error: "You've already moved house today — try again tomorrow." };
    if (e.message === "BROKE_MOVE") return { ok: false, error: "You can't afford the moving cost right now." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, {
    type: "property-occupancy", from: username,
    amount: occupancy === "living" ? moveCost : 0,
    note: occupancy === "living"
      ? `Moved into: ${propName}` + (moveCost > 0 ? ` (paid ${fmtMoney(moveCost)} moving cost)` : "")
      : `Started renting out: ${propName}`
  });
  return { ok: true };
}

// Pays weekly rent to any student who owns a property and has chosen to
// rent it out, once per NZ calendar week on that property's own rentDay —
// same "once per ISO week, tracked per-item" pattern as payMortgage,
// just paying the owner instead of charging them.
async function processPropertyRent(classCode) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  if (!cls || cls.archived) return 0;
  const todayName = nzDayName();
  const weekKey = isoWeekKey(new Date());
  const todayKey = nzDateKey();
  let ran = 0;
  for (const prop of cls.properties) {
    if (!prop.owner || prop.occupancy !== "rented") continue;
    if (!(prop.rentPerWeek > 0)) continue;
    if ((prop.rentDay || "Fri") !== todayName) continue;
    if (prop.rentLastWeekPaid === weekKey) continue;
    // Belt-and-suspenders against a same-day double payout: rentLastWeekPaid
    // gets reset to null whenever occupancy changes (see
    // setPropertyOccupancy), so a student moving houses more than once on
    // rent day could otherwise make this loop think that week's rent still
    // needs paying even though it already went out earlier today.
    // rentLastPaidDate is never reset by a move, so it still remembers.
    if (prop.rentLastPaidDate === todayKey) continue;
    const classRef = classesCol().doc(classCode);
    const ownerRef = usersCol().doc(prop.owner);
    let didRun = false, amt = 0, owner = "";
    try {
      // Owner credit + the "paid" stamp now happen in ONE transaction (same
      // atomic pattern as payTenantRent) — a bare adjustBalance() call
      // afterwards can silently no-op on contention while the week still
      // gets marked paid and logged as a success, which is exactly the
      // "rent paid but never arrived" bug this replaces.
      await fdb.runTransaction(async (t) => {
        const classSnap = await t.get(classRef);
        const ownerSnap = await t.get(ownerRef); // all reads before any writes
        if (!classSnap.exists || !ownerSnap.exists) return;
        const liveCls = withNewModuleDefaults(classSnap.data());
        const liveProp = liveCls.properties.find(p => p.id === prop.id);
        if (!liveProp || !liveProp.owner || liveProp.occupancy !== "rented") return;
        if (liveProp.rentLastWeekPaid === weekKey) return;
        if (liveProp.rentLastPaidDate === todayKey) return;
        const ownerData = ownerSnap.data();
        amt = liveProp.rentPerWeek;
        owner = liveProp.owner;
        liveProp.rentLastWeekPaid = weekKey;
        liveProp.rentLastPaidDate = todayKey;
        t.update(classRef, { properties: liveCls.properties });
        if (ownerData.role !== "teacher") {
          t.update(ownerRef, { balance: Math.round((ownerData.balance + amt) * 100) / 100 });
        }
        didRun = true;
      });
    } catch (e) { /* ignore, try next */ }
    if (didRun) {
      await logTxn(classCode, { type: "property-rent", to: owner, amount: amt, note: `Weekly rent received: ${prop.name}` });
      ran++;
    }
  }
  return ran;
}

/* ===================== Peer-to-peer property rentals =====================
   A student who owns a property can list it for rent to classmates instead
   of (or as well as, over time — never simultaneously) living in it or
   renting it out passively (see setPropertyOccupancy/processPropertyRent
   above, which are unchanged and still work exactly as before). This is a
   genuine two-sided arrangement: another student moves in, and pays the
   OWNER real weekly rent out of their own balance — nothing is conjured
   from nowhere the way the passive scheme's income is.

     prop.sublet = {
       id, price, minWeeks,
       status: "pending" | "active" | "rejected",
       rejectReason,
       tenant: username | null,
       leaseStartTs, leaseStartWeekKey, rentLastWeekPaid,
       createdTs
     }

   occupancy on the unit itself is set to "sublet" for as long as prop.sublet
   is non-null (whether it's still searching for a tenant or already
   occupied), the same way "living"/"rented" mark the other two choices.
   Settings live at cls.propertyRentals (see withNewModuleDefaults). */

async function saveSubletSettings(classCode, settings) {
  const clean = {
    enabled: !!settings.enabled,
    requireApproval: !!settings.requireApproval,
    minPricePct: Math.max(0, Math.round(Number(settings.minPricePct) || 0)),
    maxPricePct: Math.max(0, Math.round(Number(settings.maxPricePct) || 0)),
    maxLeaseWeeks: Math.max(1, Math.round(Number(settings.maxLeaseWeeks) || 1))
  };
  // A max below the min is always a typo — swap rather than saving
  // something no price could ever satisfy.
  if (clean.maxPricePct > 0 && clean.maxPricePct < clean.minPricePct) {
    const tmp = clean.minPricePct; clean.minPricePct = clean.maxPricePct; clean.maxPricePct = tmp;
  }
  await classesCol().doc(classCode).update({ propertyRentals: clean });
  return clean;
}

// The allowed price window for a sublet listing, as a percentage band
// around the property's own teacher-set rentPerWeek (the same figure the
// passive rent-it-out scheme uses) — mirrors marketplacePriceBounds. A max
// of 0 means "no upper limit".
function subletPriceBounds(cls, refPrice) {
  const pr = cls.propertyRentals || {};
  const min = Math.round(refPrice * (pr.minPricePct || 0)) / 100;
  const max = pr.maxPricePct > 0 ? Math.round(refPrice * pr.maxPricePct) / 100 : null;
  return { min: Math.round(min * 100) / 100, max: max === null ? null : Math.round(max * 100) / 100 };
}

// A student can only ever be "living" in one place at a time — either
// occupying a property they own, or renting one from a classmate — though
// they're free to own a property they DON'T live in (renting it out, either
// passively or to a classmate) while living somewhere else themselves. Used
// to stop a student claiming a second home out from under their first.
function currentHomeOf(cls, username) {
  const owned = cls.properties.find(p => p.owner === username && p.occupancy === "living");
  if (owned) return { type: "own", prop: owned };
  const rented = cls.properties.find(p => p.sublet && p.sublet.tenant === username);
  if (rented) return { type: "tenant", prop: rented };
  const npcRented = (cls.npcProperties || []).find(p => p.tenant === username);
  if (npcRented) return { type: "npc-tenant", prop: npcRented };
  return null;
}

// Teacher-only: sets the flat fee (0 = free) charged to a student the
// instant they move into a new home. See withNewModuleDefaults for the
// default and chargeMoveOrThrow for where it's actually applied.
async function setMovingCost(classCode, cost) {
  const clean = Math.max(0, Math.round((Number(cost) || 0) * 100) / 100);
  await classesCol().doc(classCode).update({ movingCost: clean });
  return clean;
}

// Teacher-only: sets the flat break fee (0 = none) charged on top of the
// remaining mortgage payoff when a student sells back a property that
// still has an active mortgage on it. See withNewModuleDefaults for the
// default and sellProperty for where it's actually applied.
async function setPropertyBreakFee(classCode, fee) {
  const clean = Math.max(0, Math.round((Number(fee) || 0) * 100) / 100);
  await classesCol().doc(classCode).update({ propertyBreakFee: clean });
  return clean;
}

// Shared guard + charge for the moment a student actually moves into a new
// home — buying and choosing to live in a property, moving in as a
// classmate's tenant, or moving in as the tenant of a teacher-listed NPC
// rental (as opposed to just choosing to rent out a property they already
// live in, or vacating with nowhere lined up yet — neither of those is
// "moving into" anywhere, so neither goes through here). Called from
// inside the same Firestore transaction that performs the move, with the
// live `user` and `cls` docs already read. Throws (never returns) on
// failure so callers can just let the transaction's own catch block handle
// the error like any other invariant violation:
//   - ALREADY_HOUSED: the student is currently living somewhere else
//   - MOVED_TODAY: the student already moved house once today
//   - BROKE_MOVE: the student can't afford the moving cost
// On success, queues (via t.update) the balance debit and today's move
// date onto the student's own doc, and returns the amount charged (for
// the caller's transaction log message) — teachers are exempt from both
// the cooldown and the cost, same as they're exempt from other costs.
function chargeMoveOrThrow(t, userRef, username, user, cls, excludePropId) {
  if (user.role === "teacher") return 0;
  const home = currentHomeOf(cls, username);
  // Callers pass the property id being moved into so a no-op re-selection
  // of the home they're already living in isn't treated as a fresh move.
  if (home && !(excludePropId && home.prop.id === excludePropId)) {
    throw new Error("ALREADY_HOUSED");
  }
  if (user.lastMoveDate === nzDateKey()) throw new Error("MOVED_TODAY");
  const cost = Math.max(0, Number(cls.movingCost) || 0);
  if (cost > 0 && (user.balance || 0) < cost) throw new Error("BROKE_MOVE");
  t.update(userRef, {
    lastMoveDate: nzDateKey(),
    balance: Math.round(((user.balance || 0) - cost) * 100) / 100
  });
  return cost;
}

// Whether a tenanted sublet has run long enough to satisfy the minimum
// lease length the owner set when they listed it — before this, neither
// side can end it through normal self-service means (the teacher always
// can, via teacherEndSublet). Measured in real elapsed time from move-in
// rather than calendar weeks, same idea as a real lease term.
function leaseMinWeeksElapsed(sublet) {
  if (!sublet || !sublet.tenant || !sublet.leaseStartTs) return true;
  const elapsedMs = Date.now() - sublet.leaseStartTs;
  return elapsedMs >= (sublet.minWeeks || 0) * 7 * 24 * 60 * 60 * 1000;
}

// Owner: lists an owned, tenant-free property up for rent to classmates,
// at a price they choose within the teacher's band around the property's
// rentPerWeek, and a minimum lease length (in weeks) they choose up to the
// teacher's cap. Switches the unit's occupancy to "sublet" immediately —
// same as choosing "living" or "rented" — even while it's still pending
// teacher approval, since it's no longer available for the owner to live in
// or passively rent out while they're trying to find a tenant for it.
async function createSublet(username, classCode, propId, price, minWeeks) {
  const classRef = classesCol().doc(classCode);
  let propName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const pr = cls.propertyRentals;
      if (!pr.enabled) throw new Error("OFF");
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop) throw new Error("NOT_FOUND");
      if (prop.owner !== username) throw new Error("NOT_OWNER");
      if (!(prop.rentPerWeek > 0)) throw new Error("NO_REF_PRICE");
      if (prop.sublet && prop.sublet.tenant) throw new Error("HAS_TENANT");
      propName = prop.name;

      const amount = Math.round(Number(price) * 100) / 100;
      if (!(amount > 0)) throw new Error("BAD_PRICE");
      const bounds = subletPriceBounds(cls, prop.rentPerWeek);
      if (amount < bounds.min) throw new Error("UNDER_MIN");
      if (bounds.max !== null && amount > bounds.max) throw new Error("OVER_MAX");

      const weeks = Math.max(1, Math.min(pr.maxLeaseWeeks, Math.round(Number(minWeeks)) || 1));

      prop.occupancy = "sublet";
      prop.rentLastWeekPaid = null;
      prop.sublet = {
        id: uid("sublet"), price: amount, minWeeks: weeks,
        status: pr.requireApproval ? "pending" : "active", rejectReason: "",
        tenant: null, leaseStartTs: null, leaseStartWeekKey: null, rentLastWeekPaid: null,
        createdTs: Date.now()
      };
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "OFF") return { ok: false, error: "Renting to classmates is switched off for your class right now." };
    if (e.message === "NOT_OWNER") return { ok: false, error: "You don't own that property." };
    if (e.message === "NO_REF_PRICE") return { ok: false, error: "Your teacher hasn't set a rent amount for this property yet." };
    if (e.message === "HAS_TENANT") return { ok: false, error: "This property already has a tenant — end that lease first." };
    if (e.message === "BAD_PRICE") return { ok: false, error: "Enter a price greater than zero." };
    if (e.message === "UNDER_MIN") return { ok: false, error: "That price is below the minimum your teacher allows." };
    if (e.message === "OVER_MAX") return { ok: false, error: "That price is above the maximum your teacher allows." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That property couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: username, note: `Listed for rent to classmates: ${propName}` });
  return { ok: true };
}

// Owner: withdraws a sublet listing. If nobody's moved in yet this is
// instant; if a tenant's already living there, it's blocked until the
// minimum lease length has run (the teacher can always override — see
// teacherEndSublet). Either way the unit goes back to "no choice made yet",
// same as teacherEndRental does for the passive scheme.
async function cancelSublet(username, classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", hadTenant = false;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet) throw new Error("NOT_FOUND");
      if (prop.owner !== username) throw new Error("NOT_OWNER");
      propName = prop.name;
      if (prop.sublet.tenant) {
        if (!leaseMinWeeksElapsed(prop.sublet)) throw new Error("LOCKED_IN");
        hadTenant = true;
      }
      prop.occupancy = null;
      prop.sublet = null;
      prop.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "NOT_OWNER") return { ok: false, error: "You don't own that property." };
    if (e.message === "LOCKED_IN") return { ok: false, error: "You agreed to a minimum lease length for this tenant — you can't end it yet." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That listing couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: username, note: hadTenant ? `Ended a classmate's lease: ${propName}` : `Withdrew rental listing: ${propName}` });
  return { ok: true };
}

// A classmate claims an active (approved, still tenant-free) sublet
// listing — instant, like buying an active Trade Centre listing, no
// separate approval from the owner. Blocked if the claimant is already
// living somewhere (see currentHomeOf) — one home at a time.
async function claimSublet(username, classCode, propId) {
  const classRef = classesCol().doc(classCode);
  const userRef = usersCol().doc(username);
  let propName = "", ownerUsername = "", moveCost = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      const userSnap = await t.get(userRef);
      if (!snap.exists || !userSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const user = userSnap.data();
      const pr = cls.propertyRentals;
      if (!pr.enabled) throw new Error("OFF");
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet) throw new Error("NOT_FOUND");
      if (prop.owner === username) throw new Error("OWN_PROPERTY");
      if (prop.sublet.status !== "active") throw new Error("NOT_AVAILABLE");
      if (prop.sublet.tenant) throw new Error("TAKEN");
      // Claiming a sublet is always a move into somewhere new — there's no
      // "re-confirm the place I'm already in" case here (that's tenantMoveOut
      // then a fresh claim), so no excludePropId.
      moveCost = chargeMoveOrThrow(t, userRef, username, user, cls, null);
      propName = prop.name;
      ownerUsername = prop.owner;
      prop.sublet.tenant = username;
      prop.sublet.leaseStartTs = Date.now();
      prop.sublet.leaseStartWeekKey = isoWeekKey(new Date());
      prop.sublet.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "OFF") return { ok: false, error: "Renting to classmates is switched off for your class right now." };
    if (e.message === "OWN_PROPERTY") return { ok: false, error: "You can't rent your own property." };
    if (e.message === "NOT_AVAILABLE") return { ok: false, error: "That listing isn't available right now." };
    if (e.message === "TAKEN") return { ok: false, error: "Someone already moved in." };
    if (e.message === "ALREADY_HOUSED") return { ok: false, error: "You're already living somewhere else — move out of that first." };
    if (e.message === "MOVED_TODAY") return { ok: false, error: "You've already moved house today — try again tomorrow." };
    if (e.message === "BROKE_MOVE") return { ok: false, error: "You can't afford the moving cost right now." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That listing couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", to: username, amount: moveCost, note: `Moved in as a tenant: ${propName} (renting from ${ownerUsername})` + (moveCost > 0 ? ` — paid ${fmtMoney(moveCost)} moving cost` : "") });
  return { ok: true };
}

// Tenant: moves out of their own accord, once the minimum lease length has
// run. Same "back to undecided" reset as cancelSublet/teacherEndSublet.
async function tenantMoveOut(username, classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet || prop.sublet.tenant !== username) throw new Error("NOT_TENANT");
      if (!leaseMinWeeksElapsed(prop.sublet)) throw new Error("LOCKED_IN");
      propName = prop.name;
      prop.occupancy = null;
      prop.sublet = null;
      prop.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "NOT_TENANT") return { ok: false, error: "You're not renting that property." };
    if (e.message === "LOCKED_IN") return { ok: false, error: "You agreed to a minimum lease length — you can't move out yet." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: username, note: `Moved out: ${propName}` });
  return { ok: true };
}

// Teacher moderation, for classes running with propertyRentals.requireApproval on.
async function decideSublet(classCode, propId, approve, reason) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const prop = cls.properties.find(p => p.id === propId);
    if (!prop || !prop.sublet || prop.sublet.status !== "pending") return;
    if (approve) {
      prop.sublet.status = "active";
    } else {
      prop.sublet.status = "rejected";
      prop.sublet.rejectReason = String(reason || "").slice(0, 160);
    }
    t.update(classRef, { properties: cls.properties });
  });
  return { ok: true };
}

// Teacher override: ends a classmate rental arrangement on the spot,
// whatever state it's in (still searching for a tenant, pending approval,
// or occupied) — unlike cancelSublet/tenantMoveOut this ignores the minimum
// lease length and doesn't check who's asking. Kicks any tenant out
// immediately and resets the unit to "no choice made yet", same as
// teacherEndRental does for the passive scheme.
async function teacherEndSublet(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", owner = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet) throw new Error("NOT_FOUND");
      propName = prop.name;
      owner = prop.owner;
      prop.occupancy = null;
      prop.sublet = null;
      prop.rentLastWeekPaid = null;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", to: owner, note: `Teacher ended the classmate rental: ${propName}` });
  return { ok: true };
}

// Generic version of lastMortgageDueWeekKey, parameterised by day name
// since a sublet's due day is the property's own rentDay rather than a
// single class-wide setting. Which ISO week the most recently-passed due
// day falls in — today's week if today IS the due day, otherwise the due
// day one cycle before that.
function lastDueWeekKeyForDay(dayName) {
  const isoIdx = day => (DAY_NAMES.indexOf(day) + 6) % 7;
  const dueIdx = isoIdx(dayName || "Fri");
  const todayIdx = isoIdx(nzDayName());
  let daysSinceDue = todayIdx - dueIdx;
  if (daysSinceDue <= 0) daysSinceDue += 7;
  const lastDueDateKey = dateKeyPlusDays(nzDateKey(), -daysSinceDue);
  return isoWeekKey(new Date(dateKeyToUTC(lastDueDateKey)));
}

// The ISO week key of this sublet's currently-unpaid rent cycle, or null if
// there isn't one right now — same "look back to the most recently-passed
// due day" logic as overdueMortgageWeekKey, just keyed to the property's
// own rentDay instead of the class's mortgageDay.
function overdueSubletRentWeekKey(prop, cls) {
  if (!prop || !prop.sublet || !prop.sublet.tenant) return null;
  const sublet = prop.sublet;
  const weekKey = isoWeekKey(new Date());
  // The move-in week is free (payTenantRent refuses it), so a tenant who
  // moved in after this week's due day doesn't owe it — same as school rentals.
  if (sublet.leaseStartWeekKey === weekKey) return null;
  if (sublet.rentLastWeekPaid === weekKey) return null; // already paid this week
  const lastDueWeekKey = lastDueWeekKeyForDay(prop.rentDay || "Fri");
  if (lastDueWeekKey === weekKey) return weekKey;
  if (sublet.rentLastWeekPaid === lastDueWeekKey) return null;
  // `<=` for the same reason as overdueMortgageWeekKey: a due day that fell
  // in the (free) move-in week was never owed.
  if (weekKeyOrder(lastDueWeekKey) <= weekKeyOrder(sublet.leaseStartWeekKey)) return null;
  return lastDueWeekKey;
}

// Whether a tenant currently has a missed weekly rent payment. Used for the
// red "payment overdue" warning, same idea as isMortgagePaymentOverdue.
function isSubletRentOverdue(prop, cls) {
  return overdueSubletRentWeekKey(prop, cls) !== null;
}

// The one and only way a tenant's weekly rent is ever paid: the tenant
// pays it themselves, on the property's own rentDay, same self-service
// pattern as payMortgage — nothing in this app ever deducts it
// automatically, since real money has to move from a specific tenant who
// might not have it. The tenant's debit, the owner's credit, and marking
// the week paid all happen inside ONE Firestore transaction (same
// atomic-transfer pattern as transferMoney above) so the money can never
// leave the tenant without landing on the owner — unlike a bare
// adjustBalance() call afterwards, which swallows its own errors and
// returns false instead of throwing, this can't silently no-op while the
// week still gets marked paid and logged as a success.
async function payTenantRent(username, classCode, propId) {
  const classRef = classesCol().doc(classCode);
  const tenantRef = usersCol().doc(username);
  let amt = 0, propName = "", ownerUsername = "", ownerRef = null;
  try {
    await fdb.runTransaction(async (t) => {
      const classSnap = await t.get(classRef);
      const tenantSnap = await t.get(tenantRef);
      if (!classSnap.exists || !tenantSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(classSnap.data());
      const tenant = tenantSnap.data();
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet || prop.sublet.tenant !== username) throw new Error("NOT_FOUND");
      const weekKey = isoWeekKey(new Date());
      if ((prop.rentDay || "Fri") !== nzDayName()) throw new Error("WRONG_DAY");
      if (prop.sublet.leaseStartWeekKey === weekKey) throw new Error("MOVE_IN_WEEK");
      if (prop.sublet.rentLastWeekPaid === weekKey) throw new Error("ALREADY_PAID");
      amt = prop.sublet.price;
      if (tenant.balance < amt) throw new Error("BROKE");
      ownerUsername = prop.owner;
      propName = prop.name;
      // Read the owner inside the same transaction (Firestore transactions
      // require all reads before any writes) so their credit commits or
      // fails together with the tenant's debit — never one without the
      // other.
      ownerRef = usersCol().doc(ownerUsername);
      const ownerSnap = await t.get(ownerRef);
      if (!ownerSnap.exists) throw new Error("OWNER_NOT_FOUND");
      const owner = ownerSnap.data();
      t.update(tenantRef, { balance: Math.round((tenant.balance - amt) * 100) / 100 });
      if (!(owner.role === "teacher")) {
        // Teachers have unlimited funds and don't track a real balance,
        // same convention adjustBalance uses.
        t.update(ownerRef, { balance: Math.round((owner.balance + amt) * 100) / 100 });
      }
      prop.sublet.rentLastWeekPaid = weekKey;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "WRONG_DAY") return { ok: false, error: "You can only pay rent on its due day." };
    if (e.message === "MOVE_IN_WEEK") return { ok: false, error: "Your first payment isn't due yet — the week you moved in is free." };
    if (e.message === "ALREADY_PAID") return { ok: false, error: "This week's rent has already been paid." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for this week's rent." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    if (e.message === "OWNER_NOT_FOUND") return { ok: false, error: "The property owner's account couldn't be found. Ask your teacher for help." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-rent-pay", from: username, to: ownerUsername, amount: amt, note: `Paid weekly rent: ${propName}` });
  await logTxn(classCode, { type: "property-rent-receive", to: ownerUsername, from: username, amount: amt, note: `Weekly rent received from a classmate: ${propName}` });
  return { ok: true, amount: amt };
}

// Teacher-only: waives a tenant's currently-missed rent payment without
// taking any money from them — same idea as resolveMortgageOverdue. Marks
// the specific overdue cycle as paid rather than just "this week", for the
// same reason resolveMortgageOverdue does.
async function resolveSubletRentOverdue(classCode, propId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", tenantUsername = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const prop = cls.properties.find(p => p.id === propId);
      if (!prop || !prop.sublet || !prop.sublet.tenant) throw new Error("NOT_FOUND");
      const overdueWeekKey = overdueSubletRentWeekKey(prop, cls);
      if (!overdueWeekKey) throw new Error("NOT_OVERDUE");
      propName = prop.name;
      tenantUsername = prop.sublet.tenant;
      prop.sublet.rentLastWeekPaid = overdueWeekKey;
      t.update(classRef, { properties: cls.properties });
    });
  } catch (e) {
    if (e.message === "NOT_OVERDUE") return { ok: false, error: "This rent isn't currently overdue." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: tenantUsername, note: `Weekly rent marked as resolved by teacher, no charge: ${propName}` });
  return { ok: true };
}

/* ===================== NPC (school-owned) property rentals =====================
   A third way for a student to have somewhere to live, alongside owning a
   property outright/on mortgage and renting one from a classmate: the
   teacher lists a rental directly — no student ever owns it, "the school"
   is the landlord. Unlike a classmate sublet, every term is fixed by the
   teacher on the listing itself: rent, minimum lease length, and the
   lifestyle-rating bonus a tenant earns while living there. A student pays
   rent the same self-service way as every other recurring payment in this
   app (mortgage, classmate rent) — on the listing's own due day, from this
   page — and the money is simply removed from circulation (a sink, the
   same way buying a teacher-listed property or a store item is), since
   there's no student on the other end to receive it.

     cls.npcProperties: flat list of units, grouped by groupId exactly like
     cls.properties (see groupProperties in property.js) —
     { id, groupId, name, description, rentPerWeek, rentDay, minWeeks,
       lifestylePoints, tenant, leaseStartTs, leaseStartWeekKey,
       rentLastWeekPaid, rentLastPaidDate } */

async function addNpcProperty(classCode, listing) {
  const classRef = classesCol().doc(classCode);
  const qty = Math.max(1, Math.floor(Number(listing.quantity)) || 1);
  const groupId = uid("npcgrp");
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    for (let i = 0; i < qty; i++) {
      cls.npcProperties.push({
        id: uid("npcprop"), groupId,
        name: listing.name, description: listing.description || "",
        rentPerWeek: Math.max(0, Number(listing.rentPerWeek) || 0),
        rentDay: DAY_NAMES.includes(listing.rentDay) ? listing.rentDay : "Fri",
        minWeeks: Math.max(1, Math.round(Number(listing.minWeeks)) || 1),
        lifestylePoints: Math.max(0, Math.round(Number(listing.lifestylePoints)) || 0),
        tenant: null, leaseStartTs: null, leaseStartWeekKey: null,
        rentLastWeekPaid: null, rentLastPaidDate: null
      });
    }
    t.update(classRef, { npcProperties: cls.npcProperties });
  });
}
// unitId is the id of ANY unit in the listing — shared fields apply to
// every unit in the group, tenanted or not, without touching anyone's
// current tenancy. Quantity grows/shrinks the same way updateProperty does
// — shrinking only ever removes currently-untenanted units.
async function updateNpcProperty(classCode, unitId, updates) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.npcProperties.find(p => p.id === unitId);
    if (!target) return;
    const gid = groupIdOf(target);
    const units = cls.npcProperties.filter(p => groupIdOf(p) === gid);
    units.forEach(u => {
      u.groupId = gid;
      u.name = updates.name;
      u.description = updates.description || "";
      u.rentPerWeek = Math.max(0, Number(updates.rentPerWeek) || 0);
      u.rentDay = DAY_NAMES.includes(updates.rentDay) ? updates.rentDay : "Fri";
      u.minWeeks = Math.max(1, Math.round(Number(updates.minWeeks)) || 1);
      u.lifestylePoints = Math.max(0, Math.round(Number(updates.lifestylePoints)) || 0);
    });
    const desiredQty = Math.max(1, Math.floor(Number(updates.quantity)) || 1);
    const currentQty = units.length;
    if (desiredQty > currentQty) {
      const template = units[0];
      for (let i = 0; i < desiredQty - currentQty; i++) {
        cls.npcProperties.push({
          id: uid("npcprop"), groupId: gid, name: template.name, description: template.description,
          rentPerWeek: template.rentPerWeek, rentDay: template.rentDay, minWeeks: template.minWeeks,
          lifestylePoints: template.lifestylePoints,
          tenant: null, leaseStartTs: null, leaseStartWeekKey: null,
          rentLastWeekPaid: null, rentLastPaidDate: null
        });
      }
    } else if (desiredQty < currentQty) {
      let toRemove = currentQty - desiredQty;
      const removeIds = new Set();
      for (const u of units) {
        if (toRemove <= 0) break;
        if (!u.tenant) { removeIds.add(u.id); toRemove--; }
      }
      if (removeIds.size > 0) {
        cls.npcProperties = cls.npcProperties.filter(p => !removeIds.has(p.id));
      }
    }
    t.update(classRef, { npcProperties: cls.npcProperties });
  });
}
// Removes every unit in the listing (whole group). Any current tenants are
// simply displaced — same permissive, no-refund-owed pattern as
// removeProperty, since nobody paid anything up front for a rental.
async function removeNpcProperty(classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const target = cls.npcProperties.find(p => p.id === unitId);
    if (!target) return;
    const gid = groupIdOf(target);
    cls.npcProperties = cls.npcProperties.filter(p => groupIdOf(p) !== gid);
    t.update(classRef, { npcProperties: cls.npcProperties });
  });
}

// A student moves in as the tenant of a specific (untenanted) unit. Every
// term — rent, minimum lease, lifestyle bonus — is whatever the teacher
// already set on the listing, so there's no price/lease negotiation the
// way createSublet has. Blocked if the student is already living
// somewhere else (currentHomeOf, via chargeMoveOrThrow, now checks NPC
// tenancy too) — one home at a time, same as every other move.
async function rentNpcProperty(username, classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  const userRef = usersCol().doc(username);
  let propName = "", moveCost = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      const userSnap = await t.get(userRef);
      if (!snap.exists || !userSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const user = userSnap.data();
      const unit = cls.npcProperties.find(p => p.id === unitId);
      if (!unit) throw new Error("NOT_FOUND");
      if (unit.tenant) throw new Error("TAKEN");
      moveCost = chargeMoveOrThrow(t, userRef, username, user, cls, null);
      propName = unit.name;
      unit.tenant = username;
      unit.leaseStartTs = Date.now();
      unit.leaseStartWeekKey = isoWeekKey(new Date());
      unit.rentLastWeekPaid = null;
      unit.rentLastPaidDate = null;
      t.update(classRef, { npcProperties: cls.npcProperties });
    });
  } catch (e) {
    if (e.message === "TAKEN") return { ok: false, error: "Someone already moved in." };
    if (e.message === "ALREADY_HOUSED") return { ok: false, error: "You're already living somewhere else — move out of that first." };
    if (e.message === "MOVED_TODAY") return { ok: false, error: "You've already moved house today — try again tomorrow." };
    if (e.message === "BROKE_MOVE") return { ok: false, error: "You can't afford the moving cost right now." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That listing couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", to: username, amount: moveCost, note: `Moved in as a tenant: ${propName} (renting from the school)` + (moveCost > 0 ? ` — paid ${fmtMoney(moveCost)} moving cost` : "") });
  return { ok: true };
}

// Tenant: moves out of their own accord, once the minimum lease length has
// run. leaseMinWeeksElapsed only reads .tenant/.leaseStartTs/.minWeeks, all
// of which live directly on the NPC unit (no nested .sublet), so it works
// unchanged here.
async function moveOutNpcProperty(username, classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  let propName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const unit = cls.npcProperties.find(p => p.id === unitId);
      if (!unit || unit.tenant !== username) throw new Error("NOT_TENANT");
      if (!leaseMinWeeksElapsed(unit)) throw new Error("LOCKED_IN");
      propName = unit.name;
      unit.tenant = null;
      unit.leaseStartTs = null;
      unit.leaseStartWeekKey = null;
      unit.rentLastWeekPaid = null;
      unit.rentLastPaidDate = null;
      t.update(classRef, { npcProperties: cls.npcProperties });
    });
  } catch (e) {
    if (e.message === "NOT_TENANT") return { ok: false, error: "You're not renting that property." };
    if (e.message === "LOCKED_IN") return { ok: false, error: "You agreed to a minimum lease length — you can't move out yet." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: username, note: `Moved out: ${propName} (school rental)` });
  return { ok: true };
}

// Teacher override: ends a tenancy on the spot regardless of minimum lease
// length, freeing the unit up for someone else — the listing itself isn't
// touched, unlike teacherEndSublet (there's no listing to withdraw here,
// since the teacher owns it permanently).
async function teacherEndNpcTenancy(classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", tenantUsername = null;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const unit = cls.npcProperties.find(p => p.id === unitId);
      if (!unit || !unit.tenant) throw new Error("NOT_FOUND");
      propName = unit.name;
      tenantUsername = unit.tenant;
      unit.tenant = null;
      unit.leaseStartTs = null;
      unit.leaseStartWeekKey = null;
      unit.rentLastWeekPaid = null;
      unit.rentLastPaidDate = null;
      t.update(classRef, { npcProperties: cls.npcProperties });
    });
  } catch (e) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", to: tenantUsername, note: `Teacher ended the school rental tenancy: ${propName}` });
  return { ok: true };
}

// The ISO week key of this unit's currently-unpaid rent cycle, or null —
// same "look back to the most recently-passed due day" logic as
// overdueSubletRentWeekKey, just reading the due day straight off the
// unit instead of a nested .sublet object.
function overdueNpcRentWeekKey(unit) {
  if (!unit || !unit.tenant) return null;
  const weekKey = isoWeekKey(new Date());
  if (unit.leaseStartWeekKey === weekKey) return null; // move-in week is free
  if (unit.rentLastWeekPaid === weekKey) return null; // already paid this week
  const lastDueWeekKey = lastDueWeekKeyForDay(unit.rentDay || "Fri");
  if (lastDueWeekKey === weekKey) return weekKey;
  if (unit.rentLastWeekPaid === lastDueWeekKey) return null;
  // `<=`: a due day in the (free) move-in week was never owed — see
  // overdueMortgageWeekKey.
  if (weekKeyOrder(lastDueWeekKey) <= weekKeyOrder(unit.leaseStartWeekKey)) return null;
  return lastDueWeekKey;
}
// Whether a tenant currently has a missed weekly rent payment — powers the
// red "payment overdue" warning and the bell notification that fires on
// (and after) the day rent is due.
function isNpcRentOverdue(unit) {
  return overdueNpcRentWeekKey(unit) !== null;
}

// The one and only way rent on a school rental is ever paid: the tenant
// pays it themselves, on the unit's own rentDay, exactly like payTenantRent
// — except the money simply leaves circulation instead of crediting an
// owner, since the landlord here isn't a student.
async function payNpcRent(username, classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  const tenantRef = usersCol().doc(username);
  let amt = 0, propName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const classSnap = await t.get(classRef);
      const tenantSnap = await t.get(tenantRef);
      if (!classSnap.exists || !tenantSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(classSnap.data());
      const tenant = tenantSnap.data();
      const unit = cls.npcProperties.find(p => p.id === unitId);
      if (!unit || unit.tenant !== username) throw new Error("NOT_FOUND");
      const weekKey = isoWeekKey(new Date());
      if ((unit.rentDay || "Fri") !== nzDayName()) throw new Error("WRONG_DAY");
      if (unit.leaseStartWeekKey === weekKey) throw new Error("MOVE_IN_WEEK");
      if (unit.rentLastWeekPaid === weekKey) throw new Error("ALREADY_PAID");
      amt = unit.rentPerWeek;
      if (tenant.balance < amt) throw new Error("BROKE");
      propName = unit.name;
      t.update(tenantRef, { balance: Math.round((tenant.balance - amt) * 100) / 100 });
      unit.rentLastWeekPaid = weekKey;
      unit.rentLastPaidDate = nzDateKey();
      t.update(classRef, { npcProperties: cls.npcProperties });
    });
  } catch (e) {
    if (e.message === "WRONG_DAY") return { ok: false, error: "You can only pay rent on its due day." };
    if (e.message === "MOVE_IN_WEEK") return { ok: false, error: "Your first payment isn't due yet — the week you moved in is free." };
    if (e.message === "ALREADY_PAID") return { ok: false, error: "This week's rent has already been paid." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for this week's rent." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-rent-pay", from: username, amount: amt, note: `Paid weekly rent: ${propName} (school rental)` });
  return { ok: true, amount: amt };
}

// Teacher-only: waives a tenant's currently-missed rent payment without
// taking any money from them — same idea as resolveSubletRentOverdue.
async function resolveNpcRentOverdue(classCode, unitId) {
  const classRef = classesCol().doc(classCode);
  let propName = "", tenantUsername = "";
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(snap.data());
      const unit = cls.npcProperties.find(p => p.id === unitId);
      if (!unit || !unit.tenant) throw new Error("NOT_FOUND");
      const overdueWeekKey = overdueNpcRentWeekKey(unit);
      if (!overdueWeekKey) throw new Error("NOT_OVERDUE");
      propName = unit.name;
      tenantUsername = unit.tenant;
      unit.rentLastWeekPaid = overdueWeekKey;
      t.update(classRef, { npcProperties: cls.npcProperties });
    });
  } catch (e) {
    if (e.message === "NOT_OVERDUE") return { ok: false, error: "This rent isn't currently overdue." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That rental couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "property-occupancy", from: tenantUsername, note: `Weekly rent marked as resolved by teacher, no charge: ${propName} (school rental)` });
  return { ok: true };
}
