/* ===================== The 29 World — data layer: markets & games =====================
   The stock market, the Trade Centre (peer-to-peer marketplace), and
   gambling (roulette, the gambling account, blackjack).
   Part of the data layer — see the top of data-core.js for how the five
   data-*.js files fit together.
====================================================================== */

/* ---------------- Stock market ---------------- */
async function openCompany(classCode, name, price, totalShares) {
  const parsedPrice = Number(price);
  const parsedShares = Number(totalShares);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return { ok: false, error: "Enter a valid starting price greater than 0." };
  }
  if (!Number.isFinite(parsedShares) || parsedShares < 1) {
    return { ok: false, error: "Enter a valid whole number of shares (1 or more)." };
  }
  const classRef = classesCol().doc(classCode);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(classRef);
      if (!snap.exists) throw new Error("NO_CLASS");
      const cls = snap.data();
      if (cls.companies.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new Error("DUP");
      const defaultRange = cls.priceRange || { min: 1, max: 5 };
      cls.companies.push({
        id: uid("co"), name, price: parsedPrice,
        totalShares: parsedShares, availableShares: parsedShares,
        history: [parsedPrice], historyDates: [nzDateKey()], holders: {},
        priceRange: { min: defaultRange.min, max: defaultRange.max }
      });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NO_CLASS") return { ok: false, error: "Class not found." };
    if (e.message === "DUP") return { ok: false, error: "A company with that name already exists in your class." };
    console.error("openCompany failed:", e);
    return { ok: false, error: "Something went wrong. Please try again. (" + (e.code || e.message || "unknown") + ")" };
  }
  return { ok: true };
}

async function setCompanyPriceRange(classCode, companyId, min, max) {
  const parsedMin = Number(min), parsedMax = Number(max);
  if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
    return { ok: false, error: "Enter valid numbers for the price range." };
  }
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    co.priceRange = { min: Math.max(0, parsedMin), max: Math.max(0, parsedMax) };
    t.update(classRef, { companies: cls.companies });
  });
  return { ok: true };
}

async function updateCompanyPrice(classCode, companyId, newPrice) {
  // Number("") is 0 and Math.max(0.01, 0) quietly "fixes" that, but
  // Number() of anything non-numeric (a stray "$", a comma, empty-after-
  // trim garbage) is NaN — and Math.max(0.01, NaN) is ALSO NaN, not 0.01,
  // because any comparison against NaN is false. That NaN then gets
  // pushed into co.history and used in every later cost/proceeds
  // calculation for this company (buy, sell, close), silently poisoning
  // them. Reject it here instead of writing it.
  const parsed = Number(newPrice);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "Enter a valid price greater than 0." };
  }
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    co.price = Math.max(0.01, parsed);
    co.history.push(co.price);
    (co.historyDates = co.historyDates || []).push(nzDateKey());
    if (co.history.length > 30) co.history.shift();
    if (co.historyDates.length > 30) co.historyDates.shift();
    t.update(classRef, { companies: cls.companies });
  });
  return { ok: true };
}

async function setPriceRange(classCode, min, max) {
  await classesCol().doc(classCode).update({
    priceRange: { min: Math.max(0, Number(min)), max: Math.max(0, Number(max)) }
  });
}

// Applies one simulated day's random price move to every company on `cls`
// IN PLACE, and returns the per-company results. Shared by the auto-trigger
// and the manual "Simulate a market day" button so both move prices exactly
// the same way.
function applyMarketDayMoves(cls) {
  const results = [];
  const range = cls.priceRange || { min: 1, max: 5 };
  cls.companies.forEach(co => {
    const coRange = co.priceRange || range;
    const pct = coRange.min + Math.random() * (coRange.max - coRange.min);
    // Upward bias: 60% chance of an up day vs 40% down, rather than a
    // straight coin flip.
    const direction = Math.random() < 0.4 ? -1 : 1;
    const newPrice = Math.max(0.01, Math.round(co.price * (1 + (direction * pct) / 100) * 100) / 100);
    co.price = newPrice;
    co.history.push(newPrice);
    (co.historyDates = co.historyDates || []).push(nzDateKey());
    if (co.history.length > 30) co.history.shift();
    if (co.historyDates.length > 30) co.historyDates.shift();
    results.push({ name: co.name, pct: direction * pct });
  });
  return results;
}

// The price a company was trading at on or before a given NZ date key,
// using the parallel history/historyDates arrays built up by
// updateCompanyPrice and applyMarketDayMoves. Walks newest-to-oldest so it
// finds the most recent price that was already in effect at the start of
// that date. Companies opened before this field existed have no dates at
// all, and a company that started trading partway through the week has no
// entry before it — both fall back to the oldest price on record, which is
// the closest honest answer to "what it was worth before we knew about it".
function companyPriceAtDate(co, dateKey) {
  const dates = co.historyDates || [];
  const hist = co.history || [];
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] && dates[i] <= dateKey) return hist[i];
  }
  return hist.length ? hist[0] : co.price;
}

// Runs the market simulation automatically once per NZ calendar day — the
// first page load of the day (from any student or teacher) that hits this
// triggers it. Unlike interest/pay day/property market day, this one
// already works fine from a student's own session as-is: the only things
// this writes are `companies` (an in-place price/history update, which
// firestore.rules already allows any class member to make — it never
// changes how many companies exist) and `lastMarketDayRun` (which was
// never added to the student lockedFields list in the first place,
// unlike its property-market and pay-day counterparts). Nothing here
// credits money into any student's own account, so there's no
// conservation-of-money problem to design around — no per-student stamp
// needed, this one class-wide flag is safe for anyone to claim.
//
// The "claim today" flag and the actual price simulation used to be two
// SEPARATE transactions (claim, then simulate). That let a Firestore
// transaction retry — which happens automatically whenever this doc gets
// written to by something else, e.g. a student buying/selling shares, at
// the same moment two page loads were racing to claim the day — leave a
// stale `claimed = true` from a failed first attempt in place even when a
// later retry correctly detected the day was already claimed by someone
// else and returned without writing anything. That stale flag then went on
// to trigger a second, unwanted simulateMarketDay() call — an occasional,
// contention-dependent extra simulation with no relation to midnight or
// the manual button. Doing the claim AND the price move in one atomic
// transaction (with the results array reset on every attempt, since
// retries re-run this whole function) removes that possibility entirely:
// either this transaction commits once, having both claimed the day and
// moved the prices, or it does neither.
async function autoMarketDayIfDue(classCode) {
  const cls = await getClass(classCode);
  if (!cls || cls.archived) return [];
  const todayKey = nzDateKey();
  if (cls.lastMarketDayRun === todayKey) return [];
  if (!cls.companies || cls.companies.length === 0) {
    await classesCol().doc(classCode).update({ lastMarketDayRun: todayKey }).catch(() => {});
    return [];
  }
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    results = []; // reset every attempt — this callback can be retried
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const liveCls = snap.data();
    if (liveCls.lastMarketDayRun === todayKey) return;
    results = applyMarketDayMoves(liveCls);
    t.update(classRef, { companies: liveCls.companies, lastMarketDayRun: todayKey });
  });
  return results;
}

async function simulateMarketDay(classCode) {
  const classRef = classesCol().doc(classCode);
  let results = [];
  await fdb.runTransaction(async (t) => {
    results = []; // reset every attempt — this callback can be retried
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    results = applyMarketDayMoves(cls);
    t.update(classRef, { companies: cls.companies });
  });
  return results;
}

async function closeCompany(classCode, companyId) {
  const classRef = classesCol().doc(classCode);
  let payouts = [];
  await fdb.runTransaction(async (t) => {
    payouts = []; // reset every attempt — a retried callback would otherwise pay everyone twice
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = snap.data();
    const co = cls.companies.find(c => c.id === companyId);
    if (!co) return;
    Object.keys(co.holders).forEach(uname => {
      const shares = co.holders[uname];
      const payout = Math.round(shares * co.price * 100) / 100;
      const basis = (co.costBasis && co.costBasis[uname]) || null;
      const costBasisSold = basis ? Math.round((basis.totalCost / basis.shares) * shares * 100) / 100 : payout;
      payouts.push({ uname, payout, coName: co.name, companyId: co.id, shares, pricePerShare: co.price, costBasisSold });
    });
    cls.companies = cls.companies.filter(c => c.id !== companyId);
    t.update(classRef, { companies: cls.companies });
  });
  for (const p of payouts) {
    await adjustBalance(p.uname, p.payout);
    await logTxn(classCode, {
      type: "stock-close", to: p.uname, amount: p.payout, note: p.coName + " delisted — shares cashed out",
      companyId: p.companyId, shares: p.shares, pricePerShare: p.pricePerShare,
      costBasisSold: p.costBasisSold, realizedGain: Math.round((p.payout - p.costBasisSold) * 100) / 100
    });
  }
}

async function buyShares(username, classCode, companyId, shares) {
  if (await isModuleLockedForStudent(username, classCode, "market")) {
    return { ok: false, error: "The Stock Market is locked for you right now because of your lifestyle rating." };
  }
  shares = Math.floor(Number(shares));
  if (!(shares > 0)) return { ok: false, error: "Enter a whole number of shares." };
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let cost = 0, coName = "";
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = classSnap.data();
      const co = cls.companies.find(c => c.id === companyId);
      if (!co) throw new Error("NOT_FOUND");
      if (!Number.isFinite(co.price)) throw new Error("BAD_PRICE");
      if (shares > co.availableShares) throw new Error("NO_SHARES");
      cost = Math.round(shares * co.price * 100) / 100;
      if (user.balance < cost) throw new Error("BROKE");

      co.availableShares -= shares;
      co.holders[username] = (co.holders[username] || 0) + shares;
      coName = co.name;

      // All-time gain/loss needs to know what each student actually paid,
      // not just today's price. co.costBasis[username] tracks two related
      // but different things per company:
      //   - shares/totalCost: the average-cost pool for CURRENTLY HELD
      //     shares only. This shrinks when shares are sold (see
      //     sellShares) — it answers "what would it cost to buy back what
      //     I hold right now".
      //   - totalBought: cumulative cost of every buy ever made for this
      //     company, and it NEVER decreases on a sell. It answers "how
      //     much money have I ever put into this company", which is the
      //     denominator a %-return figure needs — using the shrinking pool
      //     instead would make % return swing wildly (or divide by zero)
      //     the moment shares are sold off, which isn't what "all-time %
      //     return" should mean.
      co.costBasis = co.costBasis || {};
      // Normalize whatever's already on file: entries written by an older
      // version of this code (or otherwise missing a field) can have
      // shares/totalCost/totalBought as undefined. Left alone, undefined
      // turns into NaN through arithmetic here (silently wrong numbers,
      // Firestore accepts NaN) or gets copied through as literal undefined
      // in sellShares (Firestore REJECTS undefined and the whole
      // transaction fails). Coerce every field to a finite number now so
      // neither of those can happen again.
      const rawBasis = co.costBasis[username];
      const basis = {
        shares: Number.isFinite(rawBasis && rawBasis.shares) ? rawBasis.shares : 0,
        totalCost: Number.isFinite(rawBasis && rawBasis.totalCost) ? rawBasis.totalCost : 0,
        totalBought: Number.isFinite(rawBasis && rawBasis.totalBought) ? rawBasis.totalBought : 0
      };
      co.costBasis[username] = {
        shares: basis.shares + shares,
        totalCost: Math.round((basis.totalCost + cost) * 100) / 100,
        totalBought: Math.round((basis.totalBought + cost) * 100) / 100
      };

      t.update(userRef, { balance: Math.round((user.balance - cost) * 100) / 100 });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "Not found." };
    if (e.message === "NO_SHARES") return { ok: false, error: "Not enough shares available." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    if (e.message === "BAD_PRICE") return { ok: false, error: "This company's price is invalid — ask your teacher to set a new price before buying." };
    console.error("buyShares failed:", e);
    return { ok: false, error: "Something went wrong. Please try again. (" + (e.code || e.message || "unknown") + ")" };
  }
  await logTxn(classCode, {
    type: "stock-buy", from: username, amount: cost, note: `Bought ${shares} shares of ${coName}`,
    companyId, shares, pricePerShare: Math.round((cost / shares) * 100) / 100
  });
  return { ok: true };
}

async function sellShares(username, classCode, companyId, shares) {
  if (await isModuleLockedForStudent(username, classCode, "market")) {
    return { ok: false, error: "The Stock Market is locked for you right now because of your lifestyle rating." };
  }
  shares = Math.floor(Number(shares));
  if (!(shares > 0)) return { ok: false, error: "Enter a whole number of shares." };
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let proceeds = 0, coName = "", costBasisSold = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = classSnap.data();
      const co = cls.companies.find(c => c.id === companyId);
      if (!co) throw new Error("NOT_FOUND");
      if (!Number.isFinite(co.price)) throw new Error("BAD_PRICE");
      const owned = co.holders[username] || 0;
      if (shares > owned) throw new Error("TOO_MANY");

      proceeds = Math.round(shares * co.price * 100) / 100;
      co.availableShares += shares;
      co.holders[username] = owned - shares;
      if (co.holders[username] === 0) delete co.holders[username];
      coName = co.name;

      // Pull this sale's shares out of the average-cost pool: the cost
      // that "leaves" is shares-sold × the average price paid across
      // every buy so far, exactly mirroring how the shares themselves are
      // pooled (not tracked buy-lot by buy-lot) in co.holders.
      // realizedGain is what actually separates "made money" from "lost
      // money" on this sale, and gets stamped onto the stock-sell txn
      // below so both the live cost basis AND the transaction-log
      // fallback agree with it.
      //
      // Note: even when a student sells every share they hold (shares
      // drops to 0), the costBasis entry is kept rather than deleted —
      // totalBought (cumulative money ever invested in this company) has
      // to survive a full sell-out, or a company someone fully exited
      // would lose its all-time %-return history the moment they sold.
      co.costBasis = co.costBasis || {};
      // Same normalization as buyShares (see the comment there): coerce
      // whatever's on file to finite numbers before using it. This matters
      // even more here, because unlike buyShares this function copies
      // totalBought straight through with no arithmetic on it — if it were
      // left as undefined, Firestore would reject the whole write with
      // "Unsupported field value: undefined", which is exactly what was
      // locking students out of selling.
      const rawBasis = co.costBasis[username];
      const basis = {
        shares: Number.isFinite(rawBasis && rawBasis.shares) ? rawBasis.shares : owned,
        totalCost: Number.isFinite(rawBasis && rawBasis.totalCost) ? rawBasis.totalCost : proceeds,
        totalBought: Number.isFinite(rawBasis && rawBasis.totalBought) ? rawBasis.totalBought : proceeds
      };
      const avgCost = basis.shares > 0 ? basis.totalCost / basis.shares : co.price;
      const costOfSold = Math.round(avgCost * shares * 100) / 100;
      costBasisSold = costOfSold;
      const remainingShares = Math.max(0, basis.shares - shares);
      co.costBasis[username] = {
        shares: remainingShares,
        totalCost: Math.max(0, Math.round((basis.totalCost - costOfSold) * 100) / 100),
        totalBought: basis.totalBought // cumulative — a sale never reduces this
      };

      t.update(userRef, { balance: Math.round((user.balance + proceeds) * 100) / 100 });
      t.update(classRef, { companies: cls.companies });
    });
  } catch (e) {
    if (e.message === "NOT_FOUND") return { ok: false, error: "Not found." };
    if (e.message === "TOO_MANY") return { ok: false, error: "You don't own that many shares." };
    if (e.message === "BAD_PRICE") return { ok: false, error: "This company's price is invalid — ask your teacher to set a new price before selling." };
    console.error("sellShares failed:", e);
    return { ok: false, error: "Something went wrong. Please try again. (" + (e.code || e.message || "unknown") + ")" };
  }
  await logTxn(classCode, {
    type: "stock-sell", to: username, amount: proceeds, note: `Sold ${shares} shares of ${coName}`,
    companyId, shares, pricePerShare: Math.round((proceeds / shares) * 100) / 100,
    costBasisSold, realizedGain: Math.round((proceeds - costBasisSold) * 100) / 100
  });
  return { ok: true };
}

/* ===================== Peer-to-peer marketplace =====================
   Students listing things they already own — store items, vehicles,
   properties — to each other at a price THEY set, instead of everything
   flowing through the teacher's fixed-price store. The teacher keeps the
   guardrails (see cls.marketplace in withNewModuleDefaults): which asset
   types can be traded, a price band as a percentage of the original
   listed price, how many listings each student can have open at once,
   whether listings need approving first, whether haggling via offers is
   allowed, and an optional class fee skimmed off each sale.

   Ownership is NOT duplicated anywhere for this — a sale simply moves the
   asset exactly the way the existing store/transport/property code does
   (user.storeItems entries, vehicle.owners, property.owner), so lifestyle
   ratings, net worth and every existing page pick the change up with no
   extra bookkeeping.

     cls.listings = [{
       id, seller, assetType: "store"|"vehicle"|"property", assetId,
       name, description, price, refPrice,
       quantity,   // copies still for sale — store items only, otherwise 1
       status: "pending"|"active"|"sold"|"cancelled"|"rejected",
       createdKey, ts, soldTo, soldTs, soldPrice, fee, rejectReason,
       parentId,   // on a sale split off a listing of several copies
       offers: [{ id, buyer, amount, note, status, ts }]
     }]

   A store item a student owns several of can go up as one listing of
   several copies, each at the listed price. Buyers take one copy at a
   time: each sale is recorded as its own "sold" entry (parentId pointing
   back at the listing) and the listing stays up with one fewer, until the
   last copy goes — so the sold-prices history, earnings and reports see
   every sale exactly as they would a single-copy listing.
====================================================================== */
const MARKETPLACE_ASSET_LABEL = { store: "Store item", vehicle: "Vehicle", property: "Property" };
const MAX_STORED_LISTINGS = 120;

async function saveMarketplaceSettings(classCode, settings) {
  const clean = {
    enabled: !!settings.enabled,
    requireApproval: !!settings.requireApproval,
    allowOffers: !!settings.allowOffers,
    allowStore: !!settings.allowStore,
    allowVehicle: !!settings.allowVehicle,
    allowProperty: !!settings.allowProperty,
    minPricePct: Math.max(0, Math.round(Number(settings.minPricePct) || 0)),
    maxPricePct: Math.max(0, Math.round(Number(settings.maxPricePct) || 0)),
    maxActiveListings: Math.max(0, Math.round(Number(settings.maxActiveListings) || 0)),
    feePct: Math.max(0, Math.min(100, Math.round((Number(settings.feePct) || 0) * 10) / 10))
  };
  // A max below the min is always a typo, and would silently make every
  // price invalid — swap them rather than saving something unusable.
  if (clean.maxPricePct > 0 && clean.maxPricePct < clean.minPricePct) {
    const tmp = clean.minPricePct; clean.minPricePct = clean.maxPricePct; clean.maxPricePct = tmp;
  }
  await classesCol().doc(classCode).update({ marketplace: clean });
  return clean;
}

function listingIsOpen(l) { return l.status === "active" || l.status === "pending"; }
// How many copies a listing still has for sale (listings from before
// quantities existed are one copy).
function listingQuantity(l) { return Math.max(1, Math.floor(Number(l && l.quantity) || 1)); }

// Keeps the class doc from growing forever — same idea as MAX_STORED_TXNS.
// Only ever trims FINISHED listings, oldest first, so nothing still for
// sale can be dropped out from under anyone.
function _trimStoredListings(cls) {
  if (cls.listings.length <= MAX_STORED_LISTINGS) return;
  const closed = cls.listings.filter(l => !listingIsOpen(l)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const dropIds = new Set(closed.slice(0, cls.listings.length - MAX_STORED_LISTINGS).map(l => l.id));
  cls.listings = cls.listings.filter(l => !dropIds.has(l.id));
}

// After a sale leaves a seller with fewer copies of a store item, makes
// sure their open listings of it don't offer more copies than they still
// own: the oldest listings keep theirs first, and one left with none is
// taken down.
function _trimStoreListingsToOwned(cls, seller, assetId) {
  let owned = (seller.storeItems || []).filter(id => id === assetId).length;
  cls.listings
    .filter(l => l.seller === seller.username && l.assetType === "store" && l.assetId === assetId && listingIsOpen(l))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach(l => {
      const qty = listingQuantity(l);
      const keep = Math.min(qty, owned);
      owned -= keep;
      if (keep <= 0) {
        l.status = "cancelled";
        (l.offers || []).forEach(o => { if (o.status === "open") o.status = "declined"; });
      } else if (keep < qty) {
        l.quantity = keep;
      }
    });
}

// The allowed price window for an asset, given the teacher's percentage
// band. A max of 0 means "no upper limit".
function marketplacePriceBounds(cls, refPrice) {
  const mp = cls.marketplace || {};
  const min = Math.round(refPrice * (mp.minPricePct || 0)) / 100;
  const max = mp.maxPricePct > 0 ? Math.round(refPrice * mp.maxPricePct) / 100 : null;
  return { min: Math.round(min * 100) / 100, max: max === null ? null : Math.round(max * 100) / 100 };
}

// Everything this student currently owns that they're allowed to list,
// with copies they've already got up for sale subtracted out. Store items
// are fungible (you can own three of the same thing), so those come back
// with a `count` rather than one entry per copy.
function getSellableAssets(cls, user) {
  const mp = cls.marketplace || {};
  const username = user.username;
  const open = (cls.listings || []).filter(l => l.seller === username && listingIsOpen(l));
  const out = [];

  if (mp.allowStore) {
    const ownedCounts = {};
    (user.storeItems || []).forEach(id => { ownedCounts[id] = (ownedCounts[id] || 0) + 1; });
    Object.keys(ownedCounts).forEach(itemId => {
      const item = (cls.storeItems || []).find(i => i.id === itemId);
      if (!item) return;
      const listedCount = open.filter(l => l.assetType === "store" && l.assetId === itemId)
        .reduce((n, l) => n + listingQuantity(l), 0);
      const available = ownedCounts[itemId] - listedCount;
      if (available > 0) {
        out.push({
          assetType: "store", assetId: itemId, name: item.name, refPrice: item.price,
          count: available, note: item.stars ? `${item.stars}★ lifestyle` : ""
        });
      }
    });
  }

  if (mp.allowVehicle) {
    (cls.vehicles || []).forEach(v => {
      if (!(v.owners || []).includes(username)) return;
      if (open.some(l => l.assetType === "vehicle" && l.assetId === v.id)) return;
      out.push({
        assetType: "vehicle", assetId: v.id, name: v.name, refPrice: v.price, count: 1,
        note: normalizeVehicleType(v.type) + (v.comfort ? ` · ${v.comfort}★` : "")
      });
    });
  }

  if (mp.allowProperty) {
    (cls.properties || []).forEach(p => {
      if (p.owner !== username) return;
      if (open.some(l => l.assetType === "property" && l.assetId === p.id)) return;
      // A property still being paid off can't change hands — the mortgage
      // is an agreement with the bank, not something a classmate inherits.
      if (p.mortgage && p.mortgage.weeksLeft > 0) {
        out.push({
          assetType: "property", assetId: p.id, name: p.name, refPrice: p.price, count: 1,
          blocked: "Still on a mortgage — pay it off before you can sell it on."
        });
        return;
      }
      // Same idea for a property currently listed for rent to classmates
      // (or already leased to one) — the new owner shouldn't inherit
      // someone else's tenant or listing sight unseen.
      if (p.sublet) {
        out.push({
          assetType: "property", assetId: p.id, name: p.name, refPrice: p.price, count: 1,
          blocked: "Currently listed for rent to classmates — cancel that first."
        });
        return;
      }
      out.push({
        assetType: "property", assetId: p.id, name: p.name, refPrice: p.price, count: 1,
        note: p.comfort ? `${p.comfort}★ comfort` : ""
      });
    });
  }
  return out;
}

// Confirms — inside a live transaction — that the seller really still owns
// the thing they listed. Ownership can change between listing and sale
// (sold back to the store, repossessed by the teacher), so this is
// re-checked at the moment money moves, never trusted from the listing.
function _marketplaceStillOwns(cls, user, listing) {
  if (listing.assetType === "store") return (user.storeItems || []).includes(listing.assetId);
  if (listing.assetType === "vehicle") {
    const v = (cls.vehicles || []).find(x => x.id === listing.assetId);
    return !!v && (v.owners || []).includes(user.username);
  }
  if (listing.assetType === "property") {
    const p = (cls.properties || []).find(x => x.id === listing.assetId);
    return !!p && p.owner === user.username && !(p.mortgage && p.mortgage.weeksLeft > 0) && !p.sublet;
  }
  return false;
}

// quantity: how many copies to put up in this one listing — store items
// only (a vehicle or property is always one).
async function createListing(username, classCode, { assetType, assetId, price, description, quantity }) {
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let created = null, availableCount = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const classSnap = await t.get(classRef);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = Object.assign({ username }, userSnap.data());
      const cls = withNewModuleDefaults(classSnap.data());
      const mp = cls.marketplace;
      if (!mp.enabled) throw new Error("OFF");
      if (assetType === "store" && !mp.allowStore) throw new Error("TYPE_OFF");
      if (assetType === "vehicle" && !mp.allowVehicle) throw new Error("TYPE_OFF");
      if (assetType === "property" && !mp.allowProperty) throw new Error("TYPE_OFF");

      const sellable = getSellableAssets(cls, user)
        .find(a => a.assetType === assetType && a.assetId === assetId && !a.blocked);
      if (!sellable) throw new Error("NOT_OWNED");
      const qtyRaw = quantity === undefined || quantity === null || quantity === "" ? 1 : Number(quantity);
      if (!Number.isInteger(qtyRaw) || qtyRaw < 1) throw new Error("BAD_QTY");
      if (assetType !== "store" && qtyRaw !== 1) throw new Error("BAD_QTY");
      if (qtyRaw > (sellable.count || 1)) { availableCount = sellable.count || 1; throw new Error("TOO_FEW"); }
      if (assetType !== "store" && pendingBigEventFor(cls, username, assetType, assetId)) throw new Error("BIG_EVENT");

      const openMine = (cls.listings || []).filter(l => l.seller === username && listingIsOpen(l));
      if (mp.maxActiveListings > 0 && openMine.length >= mp.maxActiveListings) throw new Error("TOO_MANY");

      const amount = Math.round(Number(price) * 100) / 100;
      if (!(amount > 0)) throw new Error("BAD_PRICE");
      const bounds = marketplacePriceBounds(cls, sellable.refPrice);
      if (amount < bounds.min) throw new Error("UNDER_MIN");
      if (bounds.max !== null && amount > bounds.max) throw new Error("OVER_MAX");

      created = {
        id: uid("lst"), seller: username, assetType, assetId,
        name: sellable.name, refPrice: sellable.refPrice,
        description: String(description || "").trim().slice(0, 240),
        price: amount, quantity: qtyRaw,
        status: mp.requireApproval ? "pending" : "active",
        createdKey: nzDateKey(), ts: Date.now(),
        soldTo: null, soldTs: null, soldPrice: null, fee: 0, offers: []
      };
      cls.listings.push(created);
      _trimStoredListings(cls);
      t.update(classRef, { listings: cls.listings });
    });
  } catch (e) {
    if (e.message === "OFF") return { ok: false, error: "The Trade Centre is switched off for your class right now." };
    if (e.message === "TYPE_OFF") return { ok: false, error: "Your teacher doesn't allow that kind of thing to be traded." };
    if (e.message === "NOT_OWNED") return { ok: false, error: "You don't own that (or it's already listed)." };
    if (e.message === "BAD_QTY") return { ok: false, error: "Enter how many you want to sell — a whole number, 1 or more." };
    if (e.message === "TOO_FEW") return { ok: false, error: `You only have ${availableCount} of those that aren't already listed.` };
    if (e.message === "BIG_EVENT") return { ok: false, error: BIG_EVENT_BLOCK_MESSAGE };
    if (e.message === "TOO_MANY") return { ok: false, error: "You already have the maximum number of listings up at once." };
    if (e.message === "BAD_PRICE") return { ok: false, error: "Enter a price greater than zero." };
    if (e.message === "UNDER_MIN") return { ok: false, error: "That price is below the minimum your teacher allows for this item." };
    if (e.message === "OVER_MAX") return { ok: false, error: "That price is above the maximum your teacher allows for this item." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true, listing: created };
}

async function cancelListing(username, classCode, listingId) {
  const classRef = classesCol().doc(classCode);
  let error = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const l = cls.listings.find(x => x.id === listingId);
    if (!l) { error = "That listing couldn't be found."; return; }
    if (l.seller !== username) { error = "That isn't your listing."; return; }
    if (!listingIsOpen(l)) { error = "That listing is already closed."; return; }
    l.status = "cancelled";
    (l.offers || []).forEach(o => { if (o.status === "open") o.status = "declined"; });
    t.update(classRef, { listings: cls.listings });
  });
  return error ? { ok: false, error } : { ok: true };
}

// Teacher moderation, for classes running with requireApproval on.
async function decideListing(classCode, listingId, approve, reason) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const l = cls.listings.find(x => x.id === listingId);
    if (!l || l.status !== "pending") return;
    l.status = approve ? "active" : "rejected";
    if (!approve) l.rejectReason = String(reason || "").slice(0, 160);
    t.update(classRef, { listings: cls.listings });
  });
  return { ok: true };
}

// Teacher override: pull a live listing down (a silly price, something
// that shouldn't be traded) without it counting as a sale.
async function teacherRemoveListing(classCode, listingId, reason) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const l = cls.listings.find(x => x.id === listingId);
    if (!l || !listingIsOpen(l)) return;
    l.status = "rejected";
    l.rejectReason = String(reason || "Removed by your teacher").slice(0, 160);
    (l.offers || []).forEach(o => { if (o.status === "open") o.status = "declined"; });
    t.update(classRef, { listings: cls.listings });
  });
  return { ok: true };
}

/* The single place a peer-to-peer sale actually happens. Both "Buy now"
   (at the listed price) and "Accept offer" (at the haggled price) route
   through here, so the money movement, the ownership transfer and the
   guards can never drift apart between the two paths. */
async function _settleListing(classCode, listingId, buyerUsername, agreedPrice) {
  const classRef = classesCol().doc(classCode);
  let receipt = null;

  // The seller's username lives on the listing, which we can only read
  // inside the transaction — but a transaction's reads must all happen
  // before its writes, and we can't build a doc ref for someone we
  // haven't read yet. So: read the class doc once first, purely to learn
  // who the seller is, then do the real, fully-guarded work in the
  // transaction below with all three refs already in hand. Nothing from
  // this peek is trusted for the actual sale — it's all re-read and
  // re-checked against live data inside the transaction.
  const peek = withNewModuleDefaults(await getClass(classCode));
  if (!peek) return { ok: false, error: "Class not found." };
  const peekListing = (peek.listings || []).find(l => l.id === listingId);
  if (!peekListing) return { ok: false, error: "That listing couldn't be found." };
  if (peekListing.seller === buyerUsername) return { ok: false, error: "You can't buy your own listing." };

  const buyerRef = usersCol().doc(buyerUsername);
  const sellerRef = usersCol().doc(peekListing.seller);

  try {
    await fdb.runTransaction(async (t) => {
      const classSnap = await t.get(classRef);
      const buyerSnap = await t.get(buyerRef);
      const sellerSnap = await t.get(sellerRef);
      if (!classSnap.exists || !buyerSnap.exists || !sellerSnap.exists) throw new Error("NOT_FOUND");
      const cls = withNewModuleDefaults(classSnap.data());
      const buyer = Object.assign({ username: buyerUsername }, buyerSnap.data());
      const seller = Object.assign({ username: peekListing.seller }, sellerSnap.data());
      const mp = cls.marketplace;
      if (!mp.enabled) throw new Error("OFF");

      const listing = cls.listings.find(l => l.id === listingId);
      if (!listing) throw new Error("NOT_FOUND");
      if (listing.status !== "active") throw new Error("CLOSED");
      if (listing.seller !== seller.username) throw new Error("NOT_FOUND");
      if (listing.seller === buyerUsername) throw new Error("OWN_LISTING");
      if (!_marketplaceStillOwns(cls, seller, listing)) throw new Error("GONE");
      // The seller has a big event waiting that puts this very thing at
      // risk — it can't change hands until they've answered it.
      if (listing.assetType !== "store" && pendingBigEventFor(cls, seller.username, listing.assetType, listing.assetId)) throw new Error("SELLER_BIG_EVENT");

      const price = Math.round(Number(agreedPrice) * 100) / 100;
      if (!(price > 0)) throw new Error("BAD_PRICE");
      const buyerIsTeacher = buyer.role === "teacher";
      if (!buyerIsTeacher && buyer.balance < price) throw new Error("BROKE");

      // Asset-type-specific transfer + eligibility. Anything the normal
      // teacher-run store would refuse a buyer (no truck licence, already
      // owns this vehicle) is refused here too — a peer sale is a
      // different price, not a loophole around the class's own rules.
      if (listing.assetType === "store") {
        seller.storeItems = seller.storeItems || [];
        const idx = seller.storeItems.indexOf(listing.assetId);
        if (idx === -1) throw new Error("GONE");
        seller.storeItems.splice(idx, 1);
        buyer.storeItems = (buyer.storeItems || []).concat([listing.assetId]);
      } else if (listing.assetType === "vehicle") {
        const veh = cls.vehicles.find(v => v.id === listing.assetId);
        if (!veh) throw new Error("GONE");
        if ((veh.owners || []).includes(buyerUsername)) throw new Error("ALREADY_OWN");
        if (normalizeVehicleType(veh.type) === "truck") {
          if (!buyerIsTeacher && !buyer.truckLicence) throw new Error("NO_LICENCE");
          const alreadyOwnsTruck = !buyerIsTeacher && cls.vehicles.some(v2 =>
            v2.id !== veh.id && normalizeVehicleType(v2.type) === "truck" && (v2.owners || []).includes(buyerUsername));
          if (alreadyOwnsTruck) throw new Error("TRUCK_LIMIT");
        }
        veh.owners = (veh.owners || []).filter(o => o !== seller.username).concat([buyerUsername]);
      } else if (listing.assetType === "property") {
        const prop = cls.properties.find(p => p.id === listing.assetId);
        if (!prop || prop.owner !== seller.username) throw new Error("GONE");
        if (prop.mortgage && prop.mortgage.weeksLeft > 0) throw new Error("GONE");
        if (prop.sublet) throw new Error("GONE");
        prop.owner = buyerUsername;
        prop.mortgage = null;
        // A new owner makes their own live-in-it / rent-it-out call.
        prop.occupancy = null;
        prop.rentLastWeekPaid = null;
        // The buyer's "since you bought it" baseline (see
        // propertyGainSinceBought in property.js) is what THEY actually
        // paid the classmate, not whatever the previous owner originally
        // paid — a peer sale is a fresh cost basis, same as buying fresh
        // from the class in buyProperty.
        prop.purchasePrice = price;
      } else {
        throw new Error("NOT_FOUND");
      }

      const fee = Math.round(price * ((mp.feePct || 0) / 100) * 100) / 100;
      const proceeds = Math.round((price - fee) * 100) / 100;

      // One copy of a listing of several: the sale gets its own "sold"
      // record and the listing stays up with one fewer. The last (or only)
      // copy closes the listing itself, as it always has.
      const qty = listingQuantity(listing);
      let sale = listing;
      if (qty > 1) {
        sale = Object.assign({}, listing, { id: uid("lst"), quantity: 1, offers: [], parentId: listing.id });
        listing.quantity = qty - 1;
        cls.listings.push(sale);
        // The buyer's own offer on it (if any) is done with.
        (listing.offers || []).forEach(o => { if (o.status === "open" && o.buyer === buyerUsername) o.status = "withdrawn"; });
      } else {
        (listing.offers || []).forEach(o => { if (o.status === "open") o.status = "declined"; });
      }
      sale.status = "sold";
      sale.soldTo = buyerUsername;
      sale.soldTs = Date.now();
      sale.soldPrice = price;
      sale.fee = fee;
      if (listing.assetType === "store") {
        // Never more copies up for sale than the seller still has.
        _trimStoreListingsToOwned(cls, seller, listing.assetId);
      } else {
        // Any OTHER open listing of this vehicle/property by this seller is
        // now stale — they no longer own it — so close those too rather
        // than leaving a phantom listing that would only fail at checkout.
        cls.listings.forEach(other => {
          if (other.id === listing.id || !listingIsOpen(other)) return;
          if (other.seller !== seller.username) return;
          if (other.assetType !== listing.assetType || other.assetId !== listing.assetId) return;
          other.status = "cancelled";
        });
      }
      _trimStoredListings(cls);

      const buyerUpdate = {};
      if (!buyerIsTeacher) buyerUpdate.balance = Math.round((buyer.balance - price) * 100) / 100;
      if (listing.assetType === "store") buyerUpdate.storeItems = buyer.storeItems;
      t.update(buyerRef, buyerUpdate);

      const sellerUpdate = { balance: Math.round((seller.balance + proceeds) * 100) / 100 };
      if (listing.assetType === "store") sellerUpdate.storeItems = seller.storeItems;
      t.update(sellerRef, sellerUpdate);

      t.update(classRef, {
        listings: cls.listings,
        vehicles: cls.vehicles,
        properties: cls.properties
      });

      receipt = { price, fee, proceeds, name: listing.name, seller: seller.username, assetType: listing.assetType,
        left: listing.status === "active" ? listingQuantity(listing) : 0 };
    });
  } catch (e) {
    if (e.message === "OFF") return { ok: false, error: "The Trade Centre is switched off for your class right now." };
    if (e.message === "CLOSED") return { ok: false, error: "Someone got there first — that listing is no longer for sale." };
    if (e.message === "GONE") return { ok: false, error: "The seller doesn't own that any more, so the listing has expired." };
    if (e.message === "SELLER_BIG_EVENT") return { ok: false, error: buyerUsername === t29SessionStudent() ? "The seller can't sell this right now — try again later." : BIG_EVENT_BLOCK_MESSAGE };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough money for that." };
    if (e.message === "OWN_LISTING") return { ok: false, error: "You can't buy your own listing." };
    if (e.message === "ALREADY_OWN") return { ok: false, error: "You already own that vehicle." };
    if (e.message === "NO_LICENCE") return { ok: false, error: "You need a truck licence before you can own that vehicle." };
    if (e.message === "TRUCK_LIMIT") return { ok: false, error: "You can only own one truck at a time." };
    if (e.message === "BAD_PRICE") return { ok: false, error: "That price isn't valid." };
    if (e.message === "NOT_FOUND") return { ok: false, error: "That listing couldn't be found." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const label = MARKETPLACE_ASSET_LABEL[receipt.assetType] || "Item";
  await logTxn(classCode, {
    type: "p2p-buy", from: buyerUsername, to: receipt.seller, amount: receipt.price,
    note: `Bought from a classmate: ${receipt.name} (${label})`
  });
  await logTxn(classCode, {
    type: "p2p-sell", to: receipt.seller, from: buyerUsername, amount: receipt.proceeds,
    note: `Sold to a classmate: ${receipt.name}` + (receipt.fee > 0 ? ` (${fmtMoney(receipt.fee)} market fee deducted)` : "")
  });
  return Object.assign({ ok: true }, receipt);
}

async function buyListing(username, classCode, listingId) {
  const cls = withNewModuleDefaults(await getClassCached(classCode));
  const listing = (cls.listings || []).find(l => l.id === listingId);
  if (!listing) return { ok: false, error: "That listing couldn't be found." };
  return await _settleListing(classCode, listingId, username, listing.price);
}

async function makeOffer(username, classCode, listingId, amount, note) {
  const classRef = classesCol().doc(classCode);
  let error = null, made = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    if (!cls.marketplace.enabled) { error = "The Trade Centre is switched off for your class right now."; return; }
    if (!cls.marketplace.allowOffers) { error = "Your teacher has turned offers off — listings are buy-at-the-asking-price only."; return; }
    const l = cls.listings.find(x => x.id === listingId);
    if (!l || l.status !== "active") { error = "That listing is no longer for sale."; return; }
    if (l.seller === username) { error = "You can't make an offer on your own listing."; return; }
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) { error = "Enter an offer greater than zero."; return; }
    const bounds = marketplacePriceBounds(cls, l.refPrice);
    if (value < bounds.min) { error = `Offers can't go below ${fmtMoney(bounds.min)} for this item.`; return; }
    if (bounds.max !== null && value > bounds.max) { error = `Offers can't go above ${fmtMoney(bounds.max)} for this item.`; return; }
    l.offers = l.offers || [];
    // One live offer each — a new one replaces your old one, so a listing
    // can't be buried under a dozen offers from the same student.
    l.offers.forEach(o => { if (o.buyer === username && o.status === "open") o.status = "withdrawn"; });
    made = { id: uid("off"), buyer: username, amount: value, note: String(note || "").trim().slice(0, 160), status: "open", ts: Date.now() };
    l.offers.push(made);
    if (l.offers.length > 40) l.offers = l.offers.slice(-40);
    t.update(classRef, { listings: cls.listings });
  });
  return error ? { ok: false, error } : { ok: true, offer: made };
}

async function setOfferStatus(username, classCode, listingId, offerId, status) {
  const classRef = classesCol().doc(classCode);
  let error = null;
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    const l = cls.listings.find(x => x.id === listingId);
    if (!l) { error = "That listing couldn't be found."; return; }
    const o = (l.offers || []).find(x => x.id === offerId);
    if (!o || o.status !== "open") { error = "That offer is no longer open."; return; }
    // A buyer may withdraw their own offer; only the seller may decline one.
    if (status === "withdrawn" && o.buyer !== username) { error = "That isn't your offer."; return; }
    if (status === "declined" && l.seller !== username) { error = "That isn't your listing."; return; }
    o.status = status;
    t.update(classRef, { listings: cls.listings });
  });
  return error ? { ok: false, error } : { ok: true };
}

async function acceptOffer(username, classCode, listingId, offerId) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const l = (cls.listings || []).find(x => x.id === listingId);
  if (!l) return { ok: false, error: "That listing couldn't be found." };
  if (l.seller !== username) return { ok: false, error: "That isn't your listing." };
  if (l.status !== "active") return { ok: false, error: "That listing is no longer for sale." };
  const o = (l.offers || []).find(x => x.id === offerId);
  if (!o || o.status !== "open") return { ok: false, error: "That offer is no longer open." };
  // The sale itself re-validates everything (funds, ownership, the lot).
  // Marking the offer "accepted" only means anything once the sale has
  // actually gone through, so that write happens after it, never before.
  const res = await _settleListing(classCode, listingId, o.buyer, o.amount);
  if (!res.ok) return res;
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const live = withNewModuleDefaults(snap.data());
    const ll = live.listings.find(x => x.id === listingId);
    if (!ll) return;
    const oo = (ll.offers || []).find(x => x.id === offerId);
    if (oo) oo.status = "accepted";
    t.update(classRef, { listings: live.listings });
  });
  return res;
}

/* ===================== Gambling (Roulette) ===================== */
async function saveGamblingSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    gambling: {
      enabled: settings.enabled !== false,
      minBet: Math.max(0, Number(settings.minBet) || 0),
      maxBet: Math.max(0, Number(settings.maxBet) || 0),
      dailyBuyInLimit: (settings.dailyBuyInLimit === "" || settings.dailyBuyInLimit === undefined || settings.dailyBuyInLimit === null) ? null : Math.max(0, Number(settings.dailyBuyInLimit) || 0),
      dailyWinLimit: (settings.dailyWinLimit === "" || settings.dailyWinLimit === undefined || settings.dailyWinLimit === null) ? null : Math.max(0, Number(settings.dailyWinLimit) || 0),
      winLimitMessage: (settings.winLimitMessage || "").trim() || "You've hit your winning limit for today \u2014 nice work! Come back and play again tomorrow.",
      payouts: {
        straightUp: Number(settings.straightUp) || 0,
        split: Number(settings.split) || 0,
        street: Number(settings.street) || 0,
        corner: Number(settings.corner) || 0,
        sixLine: Number(settings.sixLine) || 0,
        oddEven: Number(settings.oddEven) || 0
      }
    }
  });
}

function rouletteRowCol(n) { return { row: Math.ceil(n / 3), col: ((n - 1) % 3) + 1 }; }
function isValidSplit(a, b) {
  if (a < 1 || a > 36 || b < 1 || b > 36 || a === b) return false;
  const p1 = rouletteRowCol(a), p2 = rouletteRowCol(b);
  if (p1.row === p2.row && Math.abs(p1.col - p2.col) === 1) return true;
  if (p1.col === p2.col && Math.abs(p1.row - p2.row) === 1) return true;
  return false;
}
function isValidStreet(nums) {
  if (nums.length !== 3) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted[0] < 1 || sorted[0] % 3 !== 1) return false;
  return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[0] + 2;
}
function isValidCorner(nums) {
  if (nums.length !== 4) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted[0];
  if (n % 3 === 0) return false; // can't start a corner in the right column
  if (n > 33) return false;
  const expected = [n, n + 1, n + 3, n + 4];
  return JSON.stringify(sorted) === JSON.stringify(expected);
}
function isValidSixLine(nums) {
  if (nums.length !== 6) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted[0];
  if (n % 3 !== 1 || n > 31) return false;
  const expected = [n, n + 1, n + 2, n + 3, n + 4, n + 5];
  return JSON.stringify(sorted) === JSON.stringify(expected);
}
function rouletteIsOdd(n) { return n > 0 && n % 2 === 1; }

/* ===================== Gambling account (buy-in / cash-out) =====================
   Students no longer stake cash straight from their balance. Instead they
   Buy In from cash into a separate per-student "gambling account", play
   Roulette/Blackjack against THAT balance (shared between both games),
   and can Cash Out back to cash whenever they like. Two teacher-set daily
   limits apply:
     - dailyBuyInLimit: most that can be moved from cash into the account
       per NZ calendar day. Once reached, the student can still play with
       whatever's already in the account, but can't top it up again until
       the next day.
     - dailyWinLimit: once the student's NET winnings for the day (wins
       minus losses, tracked as `netToday`) reach this, they're locked out
       of buying in AND placing further bets for the rest of the day, and
       shown the teacher's winLimitMessage.
   Money left in the account at day's end is left exactly where it is —
   only boughtInToday/netToday/winLimitHit reset when a new NZ day starts;
   the chip balance itself carries over untouched. */

// Pure, non-writing "what does today look like" view of a user's gambling
// account — used both for display and as the read-side of every
// transaction below. If the stored account is from an earlier day, the
// daily counters reset for this computed view; the actual write only
// takes effect once one of the functions below saves it back.
function gamblingAccountToday(user) {
  const today = nzDateKey();
  const acc = (user && user.gamblingAccount) || null;
  const balance = acc ? Math.round((acc.balance || 0) * 100) / 100 : 0;
  if (!acc || acc.dayKey !== today) {
    return { dayKey: today, balance, boughtInToday: 0, netToday: 0, winLimitHit: false };
  }
  return { dayKey: acc.dayKey, balance, boughtInToday: acc.boughtInToday || 0, netToday: acc.netToday || 0, winLimitHit: !!acc.winLimitHit };
}

// Read-only view combining the student's account with the class's current
// gambling settings, for rendering the shared account card.
async function getGamblingAccountView(username, classCode) {
  const [user, cls] = await Promise.all([getUserCached(username), getClassCached(classCode)]);
  if (!user || !cls) return null;
  const acc = gamblingAccountToday(user);
  const g = cls.gambling;
  return {
    balance: acc.balance,
    boughtInToday: acc.boughtInToday,
    netToday: acc.netToday,
    winLimitHit: acc.winLimitHit,
    gamblingEnabled: g.enabled !== false,
    dailyBuyInLimit: g.dailyBuyInLimit,
    remainingBuyIn: g.dailyBuyInLimit ? Math.max(0, Math.round((g.dailyBuyInLimit - acc.boughtInToday) * 100) / 100) : null,
    dailyWinLimit: g.dailyWinLimit,
    winLimitMessage: g.winLimitMessage
  };
}

// Moves cash into the gambling account, re-checking the buy-in cap and
// cash balance fresh inside the transaction so concurrent requests can't
// blow past either.
async function buyIntoGamblingAccount(username, classCode, amount) {
  amount = cleanAmount(amount);
  const userRef = usersCol().doc(username);
  const classRef = classesCol().doc(classCode);
  let newBalance = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const [userSnap, classSnap] = await Promise.all([t.get(userRef), t.get(classRef)]);
      if (!userSnap.exists || !classSnap.exists) throw new Error("NOT_FOUND");
      const user = userSnap.data();
      const cls = withNewModuleDefaults(classSnap.data());
      if (!(amount > 0)) throw new Error("BAD_AMOUNT");
      if (!cls.gambling.enabled) throw new Error("DISABLED");
      if (user.balance < amount) throw new Error("BROKE");
      const acc = gamblingAccountToday(user);
      if (acc.winLimitHit) throw new Error("WIN_LIMIT");
      const cap = cls.gambling.dailyBuyInLimit;
      if (cap && Math.round((acc.boughtInToday + amount) * 100) / 100 > cap) throw new Error("OVER_CAP");
      acc.balance = Math.round((acc.balance + amount) * 100) / 100;
      acc.boughtInToday = Math.round((acc.boughtInToday + amount) * 100) / 100;
      newBalance = acc.balance;
      t.update(userRef, { balance: Math.round((user.balance - amount) * 100) / 100, gamblingAccount: acc });
    });
  } catch (e) {
    if (e.message === "BAD_AMOUNT") return { ok: false, error: "Enter an amount greater than zero." };
    if (e.message === "BROKE") return { ok: false, error: "You don't have enough cash for that." };
    if (e.message === "DISABLED") return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
    if (e.message === "WIN_LIMIT") return { ok: false, error: "You've hit today's winning limit and can't buy back in until tomorrow." };
    if (e.message === "OVER_CAP") return { ok: false, error: "That's over today's buy-in limit." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "gambling-buyin", from: username, amount, note: `Bought in to Gambling: ${fmtMoney(amount)}` });
  return { ok: true, balance: newBalance };
}

// Moves the gambling account balance back to cash. With no amount (or an
// amount >= the balance), cashes out everything, same as before. With a
// smaller positive amount, only that much moves over and the rest stays
// in the gambling account. Doesn't touch boughtInToday/netToday/winLimitHit
// — cashing out just moves chips back, it isn't a reset of the day's tracking.
async function cashOutGamblingAccount(username, classCode, amount) {
  const requestedAll = amount === undefined || amount === null || amount === "";
  if (!requestedAll) {
    amount = cleanAmount(amount);
    if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than zero." };
  }
  const userRef = usersCol().doc(username);
  let cashedOut = 0;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const user = snap.data();
      const acc = gamblingAccountToday(user);
      if (!(acc.balance > 0)) throw new Error("EMPTY");
      // Cashing out more than what's there just cashes out everything,
      // same as leaving the amount blank.
      cashedOut = requestedAll ? acc.balance : Math.min(amount, acc.balance);
      const newBalance = Math.round((user.balance + cashedOut) * 100) / 100;
      acc.balance = Math.round((acc.balance - cashedOut) * 100) / 100;
      t.update(userRef, { balance: newBalance, gamblingAccount: acc });
    });
  } catch (e) {
    if (e.message === "EMPTY") return { ok: false, error: "There's nothing in your gambling account to cash out." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await logTxn(classCode, { type: "gambling-cashout", to: username, amount: cashedOut, note: `Cashed out from Gambling: ${fmtMoney(cashedOut)}` });
  return { ok: true, amount: cashedOut };
}

// Applies a stake/payout delta to the gambling account balance (used for
// every bet, escrow, and settlement — Roulette and Blackjack alike).
// `delta` doubles as the net-profit delta too: since escrow debits and
// their matching later credits always sum to the round's true profit or
// loss, just folding every single movement into netToday keeps it correct
// without having to special-case "which calls count as a settlement".
// Teachers are exempt entirely (parallels adjustBalance's "teachers have
// unlimited funds" — see above), so this silently no-ops for them.
async function adjustGamblingAccount(username, delta, dailyWinLimit) {
  const ref = usersCol().doc(username);
  let winLimitHit = false;
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error("NO_USER");
      const user = snap.data();
      if (user.role === "teacher") return;
      const acc = gamblingAccountToday(user);
      const newBalance = Math.round((acc.balance + delta) * 100) / 100;
      // Re-validate the balance fresh, inside the transaction — same fix
      // as buyIntoGamblingAccount. Every caller already does a snapshot
      // check before calling this, but that check is a stale read taken
      // outside any transaction, so two concurrent debits (double-click,
      // two tabs) can both pass it and both land here. Rejecting a debit
      // that would push the account negative closes that race instead of
      // silently letting the balance go negative.
      if (newBalance < 0) throw new Error("INSUFFICIENT");
      acc.balance = newBalance;
      acc.netToday = Math.round((acc.netToday + delta) * 100) / 100;
      if (dailyWinLimit && acc.netToday >= dailyWinLimit) acc.winLimitHit = true;
      winLimitHit = acc.winLimitHit;
      t.update(ref, { gamblingAccount: acc });
    });
    return { ok: true, winLimitHit };
  } catch (e) {
    return { ok: false, winLimitHit: false, insufficientFunds: e.message === "INSUFFICIENT" };
  }
}

// selection: array of numbers (0-36) chosen by the student, meaning
// depends on betType. Returns { ok, error } or resolves via a gambling
// account update (see adjustGamblingAccount above).
async function placeRouletteBet(username, classCode, betType, betAmount, selection) {
  // Same fix as startBlackjackRound: fetch the class/user docs once and
  // reuse them for the lock check instead of letting isModuleLockedForStudent
  // fetch them again independently. Reads the class doc through the cache
  // (getClassCached), not getClass: cls here only feeds settings the
  // teacher configures (enabled/min/max/payouts), which don't change as a
  // side effect of a bet, so the ~2s-stale read this file's own cache
  // already considers safe for settings is safe here too — and it saves a
  // full network round-trip on every single spin, by far the highest-
  // frequency click in the app. Nothing downstream trusts this copy for
  // money: adjustGamblingAccount below re-checks the real balance fresh,
  // inside its own transaction, regardless of what this read shows.
  betAmount = Number(betAmount);
  const [clsRaw, user] = await Promise.all([getClassCached(classCode), getUser(username)]);
  const cls = withNewModuleDefaults(clsRaw);
  if (!cls) return { ok: false, error: "Class not found." };
  if (isModuleLockedForStudentFromData(cls, user, username, "gambling")) {
    return { ok: false, error: "Gambling is locked for you right now because of your lifestyle rating." };
  }
  const g = cls.gambling;
  if (!g.enabled) return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
  if (!(betAmount > 0)) return { ok: false, error: "Enter a bet amount greater than zero." };
  if (betAmount < g.minBet || betAmount > g.maxBet) return { ok: false, error: `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.` };

  let valid = false, count = 0;
  if (betType === "straightUp") { valid = selection.length === 1 && selection[0] >= 0 && selection[0] <= 36; count = 1; }
  else if (betType === "split") { valid = selection.length === 2 && isValidSplit(selection[0], selection[1]); count = 2; }
  else if (betType === "street") { valid = isValidStreet(selection); count = 3; }
  else if (betType === "corner") { valid = isValidCorner(selection); count = 4; }
  else if (betType === "sixLine") { valid = isValidSixLine(selection); count = 6; }
  else if (betType === "oddEven") { valid = selection[0] === "odd" || selection[0] === "even"; }
  else return { ok: false, error: "Unknown bet type." };
  if (!valid) return { ok: false, error: "That's not a valid bet for this type." };

  if (!user) return { ok: false, error: "User not found." };
  const isTeacher = user.role === "teacher";
  if (!isTeacher) {
    const acc = gamblingAccountToday(user);
    if (acc.winLimitHit) return { ok: false, error: g.winLimitMessage || "You've hit today's winning limit and can't gamble again until tomorrow." };
    if (acc.balance < betAmount) return { ok: false, error: "You don't have enough in your gambling account for that bet — buy in first." };
  }

  const spin = Math.floor(Math.random() * 37); // 0-36
  let win = false;
  if (betType === "straightUp") win = selection[0] === spin;
  else if (betType === "oddEven") win = spin !== 0 && ((selection[0] === "odd") === rouletteIsOdd(spin));
  else win = selection.includes(spin);

  const multiplier = g.payouts[betType] || 0;
  const { net: taxedWinnings, taxAmount } = win ? applyTaxToIncome(cls, "gambling", betAmount * multiplier) : { net: 0, taxAmount: 0 };
  // Bet amount is deducted; on a win, the taxed winnings are credited back (winnings only, stake already "spent").
  const netChange = win ? taxedWinnings : -betAmount;

  // Apply the balance change first and check it actually went through
  // before logging/settling anything. adjustGamblingAccount re-validates
  // the balance atomically, so if a concurrent bet already spent the
  // funds this check (not the stale one above) is what actually catches
  // it — bail out here rather than logging a spin that was never paid
  // for.
  let hitWinLimit = false;
  if (!isTeacher) {
    const r = await adjustGamblingAccount(username, netChange, g.dailyWinLimit);
    if (!r.ok) {
      return { ok: false, error: "Your gambling balance changed before this bet could be settled — please try again." };
    }
    hitWinLimit = r.winLimitHit;
  }
  await logTxn(classCode, {
    type: "gambling", from: username, amount: Math.abs(netChange), bet: betAmount,
    note: `Roulette (${betTypeLabel(betType)}): ${win ? "WON" : "lost"} — ball landed on ${spin}` + (win && taxAmount > 0 ? ` (${fmtMoney(taxAmount)} tax withheld)` : "")
  });

  return { ok: true, spin, win, netChange, hitWinLimit, winLimitMessage: hitWinLimit ? g.winLimitMessage : null };
}
function betTypeLabel(t) {
  return { straightUp: "Straight up", split: "Split", street: "Street", corner: "Corner", sixLine: "Six line", oddEven: "Odd/Even" }[t] || t;
}
async function setGamblingEnabled(classCode, enabled) {
  const classRef = classesCol().doc(classCode);
  await fdb.runTransaction(async (t) => {
    const snap = await t.get(classRef);
    if (!snap.exists) return;
    const cls = withNewModuleDefaults(snap.data());
    cls.gambling.enabled = !!enabled;
    t.update(classRef, { gambling: cls.gambling });
  });
}

// Sets (or clears, with minutes <= 0) the class's daily active-time limit.
// The class doc is the source of truth (shown back in the teacher's
// settings form), but the actual enforcement reads a copy denormalized
// onto each STUDENT doc (see timeLimitStatus() above) so requireLogin()
// never has to fetch the class doc just to check the limit. This is the
// one place that copy has to be pushed out to every existing student —
// a deliberately rare, teacher-initiated action, not something that
// happens on every page load. Firestore batches cap out at 500 writes,
// so large classes are chunked into multiple batches.
async function setStudentTimeLimit(classCode, minutes) {
  const limit = Number(minutes) > 0 ? Math.round(Number(minutes)) : null;
  const classRef = classesCol().doc(classCode);
  await classRef.update({ dailyTimeLimitMinutes: limit });

  const cls = await getClass(classCode);
  const students = (cls && cls.students) || [];
  for (let i = 0; i < students.length; i += 500) {
    const batch = fdb.batch();
    students.slice(i, i + 500).forEach(username => {
      // set(..., {merge:true}) rather than update(): a batch's update()
      // calls all fail together if even one target doc doesn't exist
      // (e.g. cls.students briefly out of sync with the users collection),
      // which would silently drop the whole chunk. merge-set can't fail
      // that way, and for every normal, in-sync student it behaves
      // identically to update() — it only ever touches this one field.
      batch.set(usersCol().doc(username), { dailyLimitMinutes: limit }, { merge: true });
    });
    await batch.commit();
  }
}

// Student-invoked, from the timeup.html lockout screen: asks the teacher
// for more time today. Only allowed while the student is actually locked
// out (stops this being called from anywhere else), and only one request
// can be outstanding/refused at a time — see timeExemptionState():
//   - "pending"  — already asked, waiting on the teacher. Can't ask again.
//   - "declined" — teacher already said no today. Can't ask again until
//                  the NZ date rolls over and timeExemptionState() resets
//                  to "none" on its own.
//   - "none"     — either never asked today, or the teacher already
//                  approved an earlier request this same day (approving
//                  clears status back to "none" — see decideTimeExemption
//                  below) — either way, a fresh request is allowed, which
//                  covers "accepted, then hit the new limit again".
async function requestTimeExemption(username) {
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const u = snap.data();
      if (!timeLimitStatus(u).reached) throw new Error("NOT_LOCKED");
      const state = timeExemptionState(u);
      if (state === "pending") throw new Error("ALREADY_PENDING");
      if (state === "declined") throw new Error("DECLINED_TODAY");
      t.update(userRef, { timeExemptionStatus: "pending", timeExemptionDate: nzDateKey(), timeExemptionRequestedAt: nowStr() });
    });
  } catch (e) {
    if (e.message === "ALREADY_PENDING") return { ok: false, error: "You've already sent a request — waiting on your teacher." };
    if (e.message === "DECLINED_TODAY") return { ok: false, error: "Your teacher already declined a request today. Try again tomorrow." };
    if (e.message === "NOT_LOCKED") return { ok: false, error: "You're not currently out of time." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true };
}

// Teacher-invoked: approves or declines a student's pending time
// exemption request.
//   - Approve grants `extraMinutes` (manually typed in by the teacher) on
//     top of today's normal limit, then clears the request back to
//     "none" — so if the student burns through the bonus too, they're
//     free to send another request the moment they're locked out again.
//   - Decline leaves the daily limit untouched and flips the request to
//     "declined", which blocks further requests for the rest of today
//     (see timeExemptionState/requestTimeExemption above).
async function decideTimeExemption(username, approve, extraMinutes) {
  const userRef = usersCol().doc(username);
  try {
    await fdb.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const u = snap.data();
      if (timeExemptionState(u) !== "pending") throw new Error("NOT_PENDING");
      const today = nzDateKey();
      if (approve) {
        const grant = Math.max(0, Math.round(Number(extraMinutes)) || 0);
        const existingExtra = (u.extraMinutesDate === today) ? (u.extraMinutesToday || 0) : 0;
        t.update(userRef, {
          timeExemptionStatus: null, timeExemptionDate: today,
          extraMinutesToday: existingExtra + grant, extraMinutesDate: today
        });
      } else {
        t.update(userRef, { timeExemptionStatus: "declined", timeExemptionDate: today });
      }
    });
  } catch (e) {
    if (e.message === "NOT_PENDING") return { ok: false, error: "That request isn't pending anymore." };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true };
}

/* ===================== Gambling (Blackjack) =====================
   Rules implemented strictly from Christchurch Casino's public
   "Blackjack — How to Play" guide (4 decks, 3:2 blackjack, doubling on
   any 2-card total that does NOT include an Ace, splitting same-value
   cards up to twice — max 3 hands — split Aces get exactly one card
   each and can't make a "blackjack", insurance at 2:1 when the dealer
   shows an Ace, original-bet-only protection against a dealer
   blackjack after doubling/splitting). Two settings not stated in the
   PDF were confirmed with the teacher building this: the dealer stands
   on every 17 (hard or soft), and the bots play full basic strategy. */
async function saveBlackjackSettings(classCode, settings) {
  await classesCol().doc(classCode).update({
    blackjack: {
      enabled: settings.enabled !== false,
      minBet: Math.max(0, Number(settings.minBet) || 0),
      maxBet: Math.max(0, Number(settings.maxBet) || 0)
    }
  });
}

const BJ_SUITS = ["S", "H", "D", "C"];
const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const BJ_NUM_DECKS = 4;
const BJ_BOT_NAMES = ["Ana", "Miro", "Kahu", "Priya", "Leo", "Sione"];

// Rejection-sampled random ints from crypto.getRandomValues (falls back to
// Math.random if unavailable) — avoids the modulo bias a plain
// `Math.random() * n | 0` would have, so the shuffle below is unbiased.
function bjRandomInt(maxExclusive) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const maxUint32 = 0xFFFFFFFF;
    const limit = maxUint32 - (maxUint32 % maxExclusive);
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}
// Fisher-Yates shuffle — every permutation equally likely, so the shoe is a
// fair shuffle of the 4 decks.
function bjShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = bjRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function bjBuildShoe() {
  const shoe = [];
  for (let d = 0; d < BJ_NUM_DECKS; d++) {
    BJ_SUITS.forEach(s => BJ_RANKS.forEach(r => shoe.push({ r, s })));
  }
  return bjShuffle(shoe);
}
// Draws (removes) the top card of the shoe — once drawn it is gone from
// the shoe for the rest of the round, exactly like cards leaving a real
// shoe until it's reshuffled for the next round.
function bjDraw(shoe) {
  if (!shoe.length) throw new Error("SHOE_EMPTY");
  return shoe.pop();
}
function bjCardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}
function bjHandValue(cards) {
  let total = 0, aces = 0;
  cards.forEach(c => { total += bjCardValue(c.r); if (c.r === "A") aces++; });
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function bjIsBust(cards) { return bjHandValue(cards).total > 21; }
// "Blackjack" = a natural 21 on the first two cards. A 21 reached via a
// split Ace (one card only, per the rules) never counts as blackjack.
function bjIsNaturalBlackjack(cards) { return cards.length === 2 && bjHandValue(cards).total === 21; }
function bjCardLabel(c) { return c.r + c.s; }

/* ---- Basic strategy for the two bot players (cosmetic, no real money) ---- */
function bjBotDecision(cards, dealerUpRank, canDouble, canSplit) {
  const dealerVal = bjCardValue(dealerUpRank) === 11 ? 11 : bjCardValue(dealerUpRank);
  const { total, soft } = bjHandValue(cards);

  if (canSplit && cards.length === 2 && bjCardValue(cards[0].r) === bjCardValue(cards[1].r)) {
    const v = bjCardValue(cards[0].r);
    if (cards[0].r === "A" || v === 8) return "split";
    if (v === 9) return ([2, 3, 4, 5, 6, 8, 9].includes(dealerVal)) ? "split" : "stand";
    if (v === 7) return (dealerVal <= 7) ? "split" : "hit";
    if (v === 6) return (dealerVal >= 2 && dealerVal <= 6) ? "split" : "hit";
    if (v === 4) return (dealerVal === 5 || dealerVal === 6) ? "split" : "hit";
    if (v === 2 || v === 3) return (dealerVal >= 2 && dealerVal <= 7) ? "split" : "hit";
    // v === 5 or v === 10: never split, fall through to hard-total logic below
  }

  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) {
      if (canDouble && dealerVal >= 3 && dealerVal <= 6) return "double";
      return (dealerVal >= 9) ? "hit" : "stand";
    }
    if (total === 17) return (canDouble && dealerVal >= 3 && dealerVal <= 6) ? "double" : "hit";
    if (total === 15 || total === 16) return (canDouble && dealerVal >= 4 && dealerVal <= 6) ? "double" : "hit";
    if (total === 13 || total === 14) return (canDouble && dealerVal >= 5 && dealerVal <= 6) ? "double" : "hit";
    return "hit";
  }

  if (total <= 8) return "hit";
  if (total === 9) return (canDouble && dealerVal >= 3 && dealerVal <= 6) ? "double" : "hit";
  if (total === 10) return (canDouble && dealerVal >= 2 && dealerVal <= 9) ? "double" : "hit";
  if (total === 11) return (canDouble && dealerVal <= 10) ? "double" : "hit";
  if (total === 12) return (dealerVal >= 4 && dealerVal <= 6) ? "stand" : "hit";
  if (total >= 13 && total <= 16) return (dealerVal >= 2 && dealerVal <= 6) ? "stand" : "hit";
  return "stand";
}

// Plays out one bot's hand(s) to completion at deal time — bots never
// touch real money, so they can be resolved immediately without pausing
// the round, then just get replayed/animated on the client in table order.
function bjPlayBot(shoe, initialCards, dealerUpRank) {
  let hands = [{ cards: initialCards, doubled: false, isSplitAces: false }];
  let splits = 0;
  let i = 0;
  while (i < hands.length) {
    const h = hands[i];
    for (;;) {
      const canDouble = h.cards.length === 2 && !h.doubled && !h.isSplitAces && !h.cards.some(c => c.r === "A");
      const canSplit = h.cards.length === 2 && splits < 2 && !h.isSplitAces && bjCardValue(h.cards[0].r) === bjCardValue(h.cards[1].r);
      const decision = bjPlayBot_isFirstBust(h) ? "stand" : bjBotDecision(h.cards, dealerUpRank, canDouble, canSplit);
      if (decision === "split" && canSplit) {
        const isAces = h.cards[0].r === "A";
        const otherCard = h.cards.pop();
        h.cards.push(bjDraw(shoe));
        const newHand = { cards: [otherCard, bjDraw(shoe)], doubled: false, isSplitAces: isAces };
        if (isAces) { h.isSplitAces = true; }
        hands.splice(i + 1, 0, newHand);
        splits++;
        if (isAces) break; // split aces: exactly one card each, forced stand
        continue;
      }
      if (decision === "double" && canDouble) {
        h.doubled = true;
        h.cards.push(bjDraw(shoe));
        break;
      }
      if (decision === "hit") {
        h.cards.push(bjDraw(shoe));
        if (bjIsBust(h.cards) || bjHandValue(h.cards).total === 21) break;
        continue;
      }
      break; // stand
    }
    i++;
  }
  return hands.map(h => ({ cards: h.cards, total: bjHandValue(h.cards).total, bust: bjIsBust(h.cards), doubled: h.doubled }));
}
function bjPlayBot_isFirstBust(h) { return bjIsBust(h.cards); }

function bjSeatOrder() { return [1, 2, 3]; }

// Deals a fresh round: builds+shuffles a brand-new 4-deck shoe (a real
// table also reshuffles between rounds), seats the human in a random seat
// (1, 2 or 3) with the other two seats filled by bots, deals in strict
// table order (seat1, seat2, seat3, dealer-up, seat1, seat2, seat3,
// dealer-hole), then instantly resolves the two bot hands since they
// never depend on the human's choices. The human's bet is escrowed
// immediately, same as chips leaving your hand onto the table.
async function startBlackjackRound(username, classCode, betAmount) {
  // Previously this fetched the class doc up to 3x and the user doc 2x for
  // a single Deal click: once each inside isModuleLockedForStudent() (via
  // getLockedModulesForStudent() -> lifestyleRating()), and again right
  // here. Fetching both docs once, up front, and reusing them for the lock
  // check removes those duplicate reads — same checks, same order, same
  // error messages, just no redundant round-trips. Reads the class doc
  // through the cache (getClassCached), not getClass: nothing here trusts
  // this copy for money-critical state — it's only ever used for
  // teacher-configured settings (enabled/min/max) that don't change out
  // from under a single Deal click — so a Deal button no longer pays for a
  // guaranteed-fresh fetch of a doc that, on a gambling-heavy class, is
  // also the single busiest document in the whole app.
  betAmount = Number(betAmount);
  const [clsRaw, user] = await Promise.all([getClassCached(classCode), getUser(username)]);
  const cls = withNewModuleDefaults(clsRaw);
  if (!cls) return { ok: false, error: "Class not found." };
  if (isModuleLockedForStudentFromData(cls, user, username, "gambling")) {
    return { ok: false, error: "Gambling is locked for you right now because of your lifestyle rating." };
  }
  if (!cls.gambling.enabled) return { ok: false, error: "Your teacher has temporarily turned off gambling for this class." };
  const bj = cls.blackjack;
  if (!bj.enabled) return { ok: false, error: "Your teacher has temporarily turned off Blackjack for this class." };
  if (!(betAmount > 0)) return { ok: false, error: "Enter a bet amount greater than zero." };
  if (betAmount < bj.minBet || betAmount > bj.maxBet) return { ok: false, error: `Bets must be between ${fmtMoney(bj.minBet)} and ${fmtMoney(bj.maxBet)}.` };

  if (!user) return { ok: false, error: "User not found." };
  if (user.blackjackRound) return { ok: false, error: "You already have a Blackjack round in progress." };
  if (user.role !== "teacher") {
    const acc0 = gamblingAccountToday(user);
    if (acc0.winLimitHit) return { ok: false, error: cls.gambling.winLimitMessage || "You've hit today's winning limit and can't gamble again until tomorrow." };
    if (acc0.balance < betAmount) return { ok: false, error: "You don't have enough in your gambling account for that bet — buy in first." };
  }

  // Build and deal the whole round in memory FIRST, before any money moves.
  // Shuffling/dealing/bot-play never touch the network and can't fail for a
  // real user (bjDraw only throws if the 208-card shoe is ever exhausted,
  // which basic strategy play can't do) — but if something unexpected does
  // go wrong here, better to bail out now than escrow a bet for a round
  // that was never actually built.
  let round;
  try {
    const shoe = bjBuildShoe();
    // A flat 1-in-3 random pick is unbiased over the long run, but it can
    // still "streak" onto the same one or two seats for a while and never
    // land on the third — which is exactly what got reported (seat 2
    // never coming up). To make every seat visibly show up on a regular
    // basis, exclude whichever seat the student sat in last round (when
    // known) from this round's draw, so the same seat can never repeat
    // back-to-back.
    const avoidSeat = user.lastBjSeat;
    const seatChoices = [1, 2, 3].filter(s => s !== avoidSeat);
    const humanSeat = seatChoices[bjRandomInt(seatChoices.length)];
    const botSeats = [1, 2, 3].filter(s => s !== humanSeat);
    const botNames = bjShuffle(BJ_BOT_NAMES).slice(0, 2);
    const seatCards = { 1: [], 2: [], 3: [] };

    [1, 2, 3].forEach(s => seatCards[s].push(bjDraw(shoe)));
    const dealerUp = bjDraw(shoe);
    [1, 2, 3].forEach(s => seatCards[s].push(bjDraw(shoe)));
    const dealerHole = bjDraw(shoe);

    const bots = {};
    botSeats.forEach((s, idx) => {
      bots[s] = { name: botNames[idx], hands: bjPlayBot(shoe, seatCards[s], dealerUp.r) };
    });

    const humanCards = seatCards[humanSeat];
    const insuranceOffered = dealerUp.r === "A";

    round = {
      shoe, betAmount, humanSeat, botSeats, bots,
      dealer: { up: dealerUp, hole: dealerHole, cards: [], revealed: false },
      insurance: { offered: insuranceOffered, resolved: !insuranceOffered, taken: false, amount: 0 },
      hands: [{ cards: humanCards, bet: betAmount, doubled: false, isSplitAces: false, status: "playing" }],
      activeHandIndex: 0, splitCount: 0,
      phase: insuranceOffered ? "insurance" : "playing",
      createdAt: Date.now()
    };
    // A natural human blackjack auto-stands that hand — nothing left to
    // decide on it (only insurance, if offered, is still open).
    if (bjIsNaturalBlackjack(humanCards)) round.hands[0].status = "blackjack";
  } catch (e) {
    return { ok: false, error: "Something went wrong dealing that round. Please try again." };
  }

  // Best-effort — remembering the seat is only used to keep future seat
  // draws fair, it's not part of the actual round/money, so a failure here
  // shouldn't stop the round from being dealt. It's also unrelated to the
  // money movement below, so the two run together instead of one after the
  // other — that was an extra sequential round-trip on every single Deal.
  const [, debitResult] = await Promise.all([
    usersCol().doc(username).update({ lastBjSeat: round.humanSeat }).catch(() => {}),
    adjustGamblingAccount(username, -betAmount, cls.gambling.dailyWinLimit)
  ]);
  // adjustGamblingAccount re-validates the balance atomically and can
  // fail here (e.g. a concurrent bet spent the funds between the stale
  // check above and now) — the round was only ever built in memory, so
  // bail out cleanly rather than dealing a round nothing was staked on.
  if (!debitResult.ok) {
    return { ok: false, error: "Your gambling balance changed before this bet could be placed — please try again." };
  }

  // From here on the bet is escrowed, so any failure must refund it rather
  // than leave the student down money with no round to show for it.
  try {
    if (round.hands[0].status === "blackjack" && !round.insurance.offered) {
      return await bjAdvance(username, classCode, round);
    }
    await usersCol().doc(username).update({ blackjackRound: round });
    return { ok: true, round: bjClientView(round) };
  } catch (e) {
    await adjustGamblingAccount(username, betAmount, cls.gambling.dailyWinLimit);
    return { ok: false, error: "Something went wrong starting that round — your bet has been refunded. Please try again." };
  }
}

// Applies the human's insurance decision, then checks the dealer's hole
// card: a dealer blackjack ends the round immediately (insurance pays 2:1;
// only the ORIGINAL bet is at risk on the main hand — any split/double
// wagers a player had already placed would be refunded, though at this
// stage in a round none have been placed yet since insurance is offered
// before any other action).
async function blackjackInsurance(username, classCode, takeInsurance) {
  const [user, cls] = await Promise.all([getUser(username), getClass(classCode)]);
  if (!user || !user.blackjackRound) return { ok: false, error: "No Blackjack round in progress." };
  const dailyWinLimit = cls && cls.gambling ? cls.gambling.dailyWinLimit : null;
  const isTeacher = user.role === "teacher";
  const round = user.blackjackRound;
  if (round.phase !== "insurance") return { ok: false, error: "Insurance isn't available right now." };

  let insAmount = 0;
  if (takeInsurance) {
    insAmount = Math.round((round.betAmount / 2) * 100) / 100;
    if (!isTeacher && gamblingAccountToday(user).balance < insAmount) return { ok: false, error: "You don't have enough in your gambling account for insurance." };
    const r = await adjustGamblingAccount(username, -insAmount, dailyWinLimit);
    // Same re-validation-can-fail case as everywhere else adjustGamblingAccount
    // is called — the check above is a stale read, this is the real one.
    if (!r.ok) return { ok: false, error: "Your gambling balance changed before insurance could be taken — please try again." };
    round.insurance.taken = true;
    round.insurance.amount = insAmount;
  }

  // Everything below only rearranges already-known cards and saves state —
  // nothing here should realistically throw — but if it ever does, refund
  // any insurance stake just taken instead of leaving the round stuck with
  // money gone and nothing saved.
  try {
    round.insurance.resolved = true;

    round.dealer.revealed = true;
    round.dealer.cards = [round.dealer.up, round.dealer.hole];
    const dealerBJ = bjIsNaturalBlackjack(round.dealer.cards);

    if (dealerBJ) {
      if (round.insurance.taken) await adjustGamblingAccount(username, round.insurance.amount * 3, dailyWinLimit); // stake back + 2:1
      if (round.hands[0].status === "blackjack") round.hands[0].status = "push";
      else round.hands[0].status = "lost-to-dealer-blackjack";
      round.phase = "dealer";
      return await bjSettle(username, classCode, round);
    }

    round.dealer.revealed = false; // hide it again until the human's play is done
    if (round.hands[0].status === "blackjack") {
      round.phase = "dealer";
      return await bjSettle(username, classCode, round);
    }
    round.phase = "playing";
    await usersCol().doc(username).update({ blackjackRound: round });
    return { ok: true, round: bjClientView(round) };
  } catch (e) {
    if (insAmount > 0) await adjustGamblingAccount(username, insAmount, dailyWinLimit);
    return { ok: false, error: "Something went wrong resolving insurance — any insurance stake has been refunded. Please try again." };
  }
}

function bjActiveHand(round) { return round.hands[round.activeHandIndex]; }

// Moves on to the next hand still marked "playing" (relevant after a
// split), or into the dealer's turn once every human hand is resolved.
async function bjAdvance(username, classCode, round) {
  let next = round.hands.findIndex(h => h.status === "playing");
  if (next === -1) {
    round.phase = "dealer";
    return await bjSettle(username, classCode, round);
  }
  round.activeHandIndex = next;
  await usersCol().doc(username).update({ blackjackRound: round });
  return { ok: true, round: bjClientView(round) };
}

async function blackjackAction(username, classCode, action) {
  // getClassCached, not getClass: every hit/stand/double/split click ran
  // through here paid for a full fresh class-doc fetch just to read
  // cls.gambling.dailyWinLimit, a teacher-configured number that doesn't
  // change mid-round — by far the single most-clicked action in the app,
  // with no animation to hide a slow mobile round-trip behind. The cache
  // is invalidated instantly on any real write to this doc, so this only
  // ever skips a redundant re-fetch, never serves genuinely stale settings.
  const [user, cls] = await Promise.all([getUser(username), getClassCached(classCode)]);
  if (!user || !user.blackjackRound) return { ok: false, error: "No Blackjack round in progress." };
  const dailyWinLimit = cls && cls.gambling ? cls.gambling.dailyWinLimit : null;
  const isTeacher = user.role === "teacher";
  const round = user.blackjackRound;
  if (round.phase !== "playing") return { ok: false, error: "It's not your turn to act." };
  const hand = bjActiveHand(round);
  if (!hand || hand.status !== "playing") return { ok: false, error: "That hand is already finished." };

  try {
    if (action === "hit") {
      hand.cards.push(bjDraw(round.shoe));
      if (bjIsBust(hand.cards)) hand.status = "bust";
      else if (bjHandValue(hand.cards).total === 21) hand.status = "stand";
      return await bjAdvance(username, classCode, round);
    }

    if (action === "stand") {
      hand.status = "stand";
      return await bjAdvance(username, classCode, round);
    }

    if (action === "double") {
      const eligible = hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces && !hand.cards.some(c => c.r === "A");
      if (!eligible) return { ok: false, error: "You can only double on your first two cards, and not if either card is an Ace." };
      if (!isTeacher && gamblingAccountToday(user).balance < hand.bet) return { ok: false, error: "You don't have enough in your gambling account to double down." };
      const debit = await adjustGamblingAccount(username, -hand.bet, dailyWinLimit);
      if (!debit.ok) return { ok: false, error: "Your gambling balance changed before you could double down — please try again." };
      try {
        hand.doubled = true;
        hand.bet *= 2;
        hand.cards.push(bjDraw(round.shoe));
        hand.status = bjIsBust(hand.cards) ? "bust" : "stand";
        return await bjAdvance(username, classCode, round);
      } catch (e) {
        await adjustGamblingAccount(username, hand.bet / 2, dailyWinLimit); // undo the doubled stake just taken
        return { ok: false, error: "Something went wrong doubling down — your extra stake has been refunded. Please try again." };
      }
    }

    if (action === "split") {
      const eligible = hand.cards.length === 2 && !hand.isSplitAces && round.splitCount < 2 &&
        bjCardValue(hand.cards[0].r) === bjCardValue(hand.cards[1].r);
      if (!eligible) return { ok: false, error: "That hand can't be split." };
      if (!isTeacher && gamblingAccountToday(user).balance < hand.bet) return { ok: false, error: "You don't have enough in your gambling account to split." };
      const splitStake = hand.bet;
      const debit = await adjustGamblingAccount(username, -splitStake, dailyWinLimit);
      if (!debit.ok) return { ok: false, error: "Your gambling balance changed before you could split — please try again." };
      try {
        const isAces = hand.cards[0].r === "A";
        const otherCard = hand.cards.pop();
        hand.cards.push(bjDraw(round.shoe));
        const newHand = { cards: [otherCard, bjDraw(round.shoe)], bet: hand.bet, doubled: false, isSplitAces: isAces, status: "playing" };
        if (isAces) {
          hand.isSplitAces = true;
          hand.status = "stand"; // split Aces: exactly one card each, forced stand
          newHand.status = "stand";
        }
        round.hands.splice(round.activeHandIndex + 1, 0, newHand);
        round.splitCount++;
        return await bjAdvance(username, classCode, round);
      } catch (e) {
        await adjustGamblingAccount(username, splitStake, dailyWinLimit); // undo the split stake just taken
        return { ok: false, error: "Something went wrong splitting that hand — your stake has been refunded. Please try again." };
      }
    }

    return { ok: false, error: "Unknown action." };
  } catch (e) {
    return { ok: false, error: "Something went wrong with that action. Please try again." };
  }
}

// Dealer plays out (stands on all 17s, hard or soft), then every human
// hand is settled against it and the round is closed out with a single
// transaction log entry.
async function bjSettle(username, classCode, round) {
  // getClassCached: cls here only feeds tax rates and the win-limit
  // message/threshold, all teacher-configured and never changed by a
  // settling round — same reasoning as blackjackAction above. This runs
  // once per finished hand, i.e. constantly during active play.
  const cls = withNewModuleDefaults(await getClassCached(classCode));

  if (!round.dealer.revealed) {
    round.dealer.revealed = true;
    round.dealer.cards = [round.dealer.up, round.dealer.hole];
  }
  if (round.hands.some(h => h.status !== "bust" && h.status !== "push" && h.status !== "lost-to-dealer-blackjack")) {
    while (bjHandValue(round.dealer.cards).total < 17) {
      round.dealer.cards.push(bjDraw(round.shoe));
    }
  }
  const dealerVal = bjHandValue(round.dealer.cards).total;
  const dealerBust = dealerVal > 21;
  const dealerBJ = bjIsNaturalBlackjack(round.dealer.cards);

  let totalCredit = 0, totalStaked = 0, taxTotal = 0;
  const results = [];
  for (const h of round.hands) {
    totalStaked += h.bet;
    if (h.status === "push") { totalCredit += h.bet; results.push({ hand: h, outcome: "push" }); continue; }
    if (h.status === "lost-to-dealer-blackjack" || h.status === "bust") { results.push({ hand: h, outcome: "lost" }); continue; }

    const playerVal = bjHandValue(h.cards).total;
    const playerBJ = bjIsNaturalBlackjack(h.cards) && !h.isSplitAces;
    let outcome;
    if (playerBJ && !dealerBJ) outcome = "blackjack";
    // Only a blackjack ties a dealer blackjack — a 21 made with three or
    // more cards still loses to it.
    else if (dealerBJ) outcome = playerBJ ? "push" : "lost";
    else if (dealerBust || playerVal > dealerVal) outcome = "won";
    else if (playerVal === dealerVal) outcome = "push";
    else outcome = "lost";

    if (outcome === "push") { totalCredit += h.bet; }
    else if (outcome === "won" || outcome === "blackjack") {
      const profitBase = outcome === "blackjack" ? h.bet * 1.5 : h.bet;
      const { net, taxAmount } = applyTaxToIncome(cls, "gambling", profitBase);
      totalCredit += h.bet + net;
      taxTotal += taxAmount;
    }
    results.push({ hand: h, outcome });
  }

  // Original-bet-only protection: a dealer blackjack (only seen now when
  // its face-up card was a 10, J, Q or K) never takes more than the
  // student's original bet. Anything extra they put in by doubling or
  // splitting comes back — except on a hand they busted themselves.
  let protectedRefund = 0;
  if (dealerBJ) {
    const lostToDealer = results.filter(r => r.outcome === "lost" && r.hand.status !== "bust" && r.hand.status !== "lost-to-dealer-blackjack")
      .reduce((sum, r) => sum + r.hand.bet, 0);
    protectedRefund = Math.max(0, Math.round((lostToDealer - round.betAmount) * 100) / 100);
    totalCredit += protectedRefund;
  }

  if (totalCredit > 0) await adjustGamblingAccount(username, totalCredit, cls.gambling.dailyWinLimit);

  // BUGFIX: insurance is settled directly against the gambling account
  // back in blackjackInsurance() (stake debited when taken; stake back +
  // 2:1 credited immediately if the dealer turns out to have blackjack) —
  // by the time we get here that money has already moved. The round's
  // headline "won/lost $X overall" figure (netChange, also what gets
  // written to the ledger below) has to fold that result in correctly:
  //   - insurance not taken: no effect.
  //   - insurance taken and LOST (dealer had no blackjack): the stake was
  //     spent and never came back — a real loss of `amount`.
  //   - insurance taken and WON (dealer had blackjack): the stake was
  //     already paid back plus a 2:1 payout, i.e. a real PROFIT of
  //     `amount * 2` — not a loss of `amount`. The old code always
  //     subtracted `amount` here regardless of outcome, understating the
  //     round's result by 3x the insurance stake specifically whenever
  //     insurance won (e.g. reporting "you lost $15" — and logging that
  //     same wrong figure to the transaction ledger — on a round that had
  //     actually broken even).
  const insuranceTaken = round.insurance.taken;
  const insuranceWon = insuranceTaken && dealerBJ;
  const insuranceResult = insuranceTaken ? (insuranceWon ? round.insurance.amount * 2 : -round.insurance.amount) : 0;

  const insuranceNote = insuranceTaken
    ? (insuranceWon ? ` Insurance won ${fmtMoney(round.insurance.amount * 2)}.` : ` Insurance lost ${fmtMoney(round.insurance.amount)}.`)
    : "";
  const netChange = Math.round((totalCredit - totalStaked + insuranceResult) * 100) / 100;
  const netForTxn = Math.round((netChange) * 100) / 100;
  const dealerDesc = `dealer had ${dealerVal}${dealerBust ? " (bust)" : dealerBJ ? " (blackjack)" : ""}`;

  // Say exactly what the player's hand(s) got, not just the outcome —
  // one clause per hand so a split round reads clearly too.
  const outcomeWord = { won: "won", blackjack: "blackjack, won", push: "pushed", lost: "lost", "lost-to-dealer-blackjack": "lost" };
  let handsDesc;
  if (round.hands.length === 1) {
    const only = results[0];
    handsDesc = `you had ${bjHandValue(only.hand.cards).total}${only.hand.status === "bust" ? " (bust)" : ""} — ${outcomeWord[only.outcome]}`;
  } else {
    handsDesc = results.map((r, i) => `hand ${i + 1}: ${bjHandValue(r.hand.cards).total}${r.hand.status === "bust" ? " (bust)" : ""} (${outcomeWord[r.outcome]})`).join(", ");
  }

  // Read back the account's current lock state rather than relying only on
  // this call's own return value — an earlier movement in the SAME round
  // (e.g. an insurance payout before this settle, or one of several split
  // hands) may have already tripped the winning limit even when this
  // particular credit is zero or negative. This read, the ledger write, and
  // clearing the finished round off the user doc don't depend on each
  // other — they used to run one after another, which meant every single
  // finished hand (Stand, a bust, a split resolving) paid for 3 sequential
  // round-trips here on top of everything before it. Firing them together
  // cuts that to the time of whichever one is slowest.
  const [finalUser] = await Promise.all([
    getUser(username),
    logTxn(classCode, {
      // `bet` here is the original stake for the round (round.betAmount) —
      // not the total actually risked, which can be higher once doubling
      // down or splitting adds more on top. Kept for the teacher's ledger;
      // it's no longer summed anywhere for a daily cap (that's now enforced
      // at buy-in time — see startBlackjackRound/buyIntoGamblingAccount).
      type: "gambling", from: username, amount: Math.abs(netForTxn), bet: round.betAmount,
      note: `Blackjack: ${handsDesc}; ${dealerDesc} — ${netForTxn >= 0 ? "WON" : "lost"} ${fmtMoney(Math.abs(netForTxn))} overall.${insuranceNote}${protectedRefund > 0 ? ` ${fmtMoney(protectedRefund)} of doubled/split bets returned (dealer blackjack).` : ""}${taxTotal > 0 ? ` (${fmtMoney(taxTotal)} tax withheld)` : ""}`
    }),
    usersCol().doc(username).update({ blackjackRound: null })
  ]);
  const hitWinLimit = finalUser ? gamblingAccountToday(finalUser).winLimitHit : false;

  const finalRound = Object.assign({}, round, {
    phase: "done", results: results.map(r => r.outcome), netChange: netForTxn,
    hitWinLimit, winLimitMessage: hitWinLimit ? cls.gambling.winLimitMessage : null
  });
  return { ok: true, round: bjClientView(finalRound), netChange: netForTxn, hitWinLimit };
}

// Strips the shoe (never sent to the client) and hides the dealer's hole
// card until it's actually revealed.
function bjClientView(round) {
  const dealerCards = round.dealer.revealed ? round.dealer.cards : [round.dealer.up];
  return {
    phase: round.phase,
    humanSeat: round.humanSeat,
    botSeats: round.botSeats,
    bots: round.bots,
    dealer: { cards: dealerCards, revealed: round.dealer.revealed, total: round.dealer.revealed ? bjHandValue(round.dealer.cards).total : null },
    insurance: round.insurance,
    hands: round.hands.map(h => ({ cards: h.cards, bet: h.bet, doubled: h.doubled, isSplitAces: h.isSplitAces, status: h.status, total: bjHandValue(h.cards).total })),
    activeHandIndex: round.activeHandIndex,
    results: round.results || null,
    netChange: round.netChange !== undefined ? round.netChange : null,
    hitWinLimit: !!round.hitWinLimit,
    winLimitMessage: round.winLimitMessage || null
  };
}

// Lets the student resume/see their in-progress round (e.g. after a page
// refresh) without losing the already-escrowed bet.
async function getBlackjackRound(username) {
  const user = await getUser(username);
  if (!user || !user.blackjackRound) return null;
  return bjClientView(user.blackjackRound);
}
