/* ===================== The 29 World — Peer-to-peer marketplace =====================
   Students trading with each other at prices they set, next to (not
   instead of) the teacher's fixed-price store. Teacher view is settings +
   moderation; student view is sell / my listings / browse / sold prices.
   Every rule lives in the data-*.js files — this file is presentation only.
================================================================================ */
let CURRENT, IS_TEACHER;
let CLS = null, ME = null;
let NAMES = {};              // username -> display name, fetched once per page load
let FILTER = "all";
let COUNTERING = null;        // offer id the seller is typing a counter-offer into
let OFFERING = null;         // listing id the student is currently typing an offer into
let MKT_EDITING = null;          // listing id the seller is editing
const MKT_RESPONSE_MS = 3 * 24 * 3600 * 1000;   // how long "your offer was declined" stays on the card

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const nameOf = u => NAMES[u] || u;
const ASSET_ICON = { store: "cart", vehicle: "car", property: "house" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("swap", 26) + " Trade Centre";
  document.getElementById("pageIntro").textContent = IS_TEACHER
    ? "Students trading with each other at prices they set: price discovery, negotiation, and everything you decide to allow."
    : "Buy and sell with your classmates at whatever price you can agree on, not the fixed store price.";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentPanel").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  if (!IS_TEACHER) {
    mcLoad(); mcBuildDom();
    document.getElementById("iconListings").innerHTML = icon("tag", 30);
    document.getElementById("iconEarned").innerHTML = icon("bag", 30);
    document.getElementById("iconForSale").innerHTML = icon("swap", 30);
  }

  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(dailyLifeAllowanceForClassIfDue(u.classCode), "dailyLifeAllowanceForClassIfDue")
      : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
  const initialVersion = renderVersion;
  await T29_STARTUP_JOBS;
  await checkBigEventPopup(u.username, u.classCode);

  // Names are only needed for "listed by X" — one roster fetch per page
  // load, not per render, since a roster read costs one Firestore read per
  // student in the class.
  const cls = await getClassCached(u.classCode);
  const roster = await getClassStudents(u.classCode, cls);
  roster.forEach(s => { NAMES[s.username] = s.name; });
  const teacher = await getClassTeacherDisplay(cls);
  if (teacher) NAMES[teacher.username] = teacher.name;

  if (renderVersion === initialVersion) await render();
}

let renderVersion = 0;
async function render(committed = false) {
  const version = ++renderVersion;
  // A listener can still be displaying the state before a just-committed
  // trade. Read both sides of the student's screen at one database revision.
  const [me, cls] = committed
    ? await fdb.runTransaction(async tx => {
        const user = await tx.get(usersCol().doc(CURRENT.username));
        const classroom = await tx.get(classesCol().doc(CURRENT.classCode));
        return [user.data(), classroom.data()];
      })
    : await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  if (version !== renderVersion) return;
  ME = Object.assign({ username: CURRENT.username }, me);
  CLS = withNewModuleDefaults(cls);
  if (IS_TEACHER) renderTeacher();
  else renderStudent();
}

// These actions change only this listing. Apply the transaction result
// immediately, so an older snapshot can't hide a creation or undo a cancellation.
function showCommittedListing(id, listing) {
  renderVersion++;
  const existing = (CLS.listings || []).filter(l => l.id !== id);
  CLS = { ...CLS, listings: listing ? [...existing, listing] : existing };
  renderStudent();
}

function bandText(refPrice) {
  const b = marketplacePriceBounds(CLS, refPrice);
  if (b.max === null) return `Anything from ${fmtMoney(b.min)} up`;
  return `${fmtMoney(b.min)} – ${fmtMoney(b.max)}`;
}

/* ================= Teacher ================= */
function renderTeacher() {
  const mp = CLS.marketplace;
  document.getElementById("mpEnabled").checked = mp.enabled;
  document.getElementById("mpApproval").checked = mp.requireApproval;
  document.getElementById("mpOffers").checked = mp.allowOffers;
  document.getElementById("mpStore").checked = mp.allowStore;
  document.getElementById("mpVehicle").checked = mp.allowVehicle;
  document.getElementById("mpProperty").checked = mp.allowProperty;
  document.getElementById("mpMinPct").value = mp.minPricePct;
  document.getElementById("mpMaxPct").value = mp.maxPricePct;
  document.getElementById("mpMaxListings").value = mp.maxActiveListings;
  document.getElementById("mpFee").value = mp.feePct;

  const pending = (CLS.listings || []).filter(l => l.status === "pending");
  document.getElementById("noApprovals").classList.toggle("hidden", pending.length > 0);
  document.getElementById("approvalCard").classList.toggle("hidden", !mp.requireApproval && pending.length === 0);
  document.getElementById("approvalList").innerHTML = pending.map(l => `
    <div class="mkt-sell-row">
      <div class="grow">
        <div class="mkt-sell-name">${esc(l.name)}${listingQuantity(l) > 1 ? ` <span class="badge navy">×${listingQuantity(l)}</span>` : ""}</div>
        <div class="muted-small">Listed by ${esc(nameOf(l.seller))} at <strong>${fmtMoney(l.price)}</strong>${listingQuantity(l) > 1 ? " each" : ""}. Originally ${fmtMoney(l.refPrice)}${l.description ? ` · "${esc(l.description)}"` : ""}</div>
      </div>
      <button class="btn small mint" onclick="approve('${l.id}', true)">${icon("check", 13)} Approve</button>
      <button class="btn small coral" onclick="approve('${l.id}', false)">Reject</button>
    </div>`).join("");

  const live = (CLS.listings || []).filter(l => l.status === "active");
  document.getElementById("noTeacherLive").classList.toggle("hidden", live.length > 0);
  document.getElementById("teacherLive").innerHTML = live.map(l => listingCardHtml(l, { teacher: true })).join("");
}

async function saveSettings() {
  await saveMarketplaceSettings(CURRENT.classCode, {
    enabled: document.getElementById("mpEnabled").checked,
    requireApproval: document.getElementById("mpApproval").checked,
    allowOffers: document.getElementById("mpOffers").checked,
    allowStore: document.getElementById("mpStore").checked,
    allowVehicle: document.getElementById("mpVehicle").checked,
    allowProperty: document.getElementById("mpProperty").checked,
    minPricePct: document.getElementById("mpMinPct").value,
    maxPricePct: document.getElementById("mpMaxPct").value,
    maxActiveListings: document.getElementById("mpMaxListings").value,
    feePct: document.getElementById("mpFee").value
  });
  document.getElementById("settingsMsg").innerHTML = `<div class="success-msg">Trade Centre settings saved.</div>`;
  await render(true);
}

async function approve(id, yes) {
  const reason = yes ? "" : (await t29Prompt("Tell the student why (optional):", "", { confirmText: "Send", placeholder: "Reason (optional)" }) || "");
  await decideListing(CURRENT.classCode, id, yes, reason);
  await render(true);
}

async function pullListing(id) {
  const reason = await t29Prompt("Why are you taking this listing down? (shown to the student)", "", { confirmText: "Take it down", danger: true, placeholder: "Reason" }) || "Removed by your teacher";
  await teacherRemoveListing(CURRENT.classCode, id, reason);
  await render(true);
}

/* ================= Student ================= */
function renderStudent() {
  const mp = CLS.marketplace;
  mktPayBarRender();
  const banner = document.getElementById("closedBanner");
  if (!mp.enabled) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<p style="margin:0;"><strong>The Trade Centre is closed right now</strong><br>Your teacher has switched off trading between students. You can still buy from the class Store.</p>`;
  } else {
    banner.classList.add("hidden");
  }

  const listings = CLS.listings || [];
  const mine = listings.filter(l => l.seller === ME.username && listingIsOpen(l));
  const others = listings.filter(l => l.status === "active" && l.seller !== ME.username);
  const sold = listings.filter(l => l.status === "sold").sort((a, b) => (b.soldTs || 0) - (a.soldTs || 0));
  const earned = sold.filter(l => l.seller === ME.username)
    .reduce((sum, l) => sum + (l.soldPrice * listingQuantity(l) - (l.fee || 0)), 0);

  document.getElementById("statListings").textContent = String(mine.length);
  document.getElementById("statEarned").textContent = fmtMoney(earned);
  document.getElementById("statForSale").textContent = String(others.length);

  mcClean();
  renderSellList();

  document.getElementById("noMine").classList.toggle("hidden", mine.length > 0);
  document.getElementById("myListings").innerHTML = mine.map(l => listingCardHtml(l, { mine: true })).join("");

  // Filter chips are only worth showing when there's more than one kind of
  // thing on sale.
  const kinds = Array.from(new Set(others.map(l => l.assetType)));
  const bar = document.getElementById("filterBar");
  bar.innerHTML = kinds.length > 1
    ? [["all", "Everything"]].concat(kinds.map(k => [k, MARKETPLACE_ASSET_LABEL[k] + "s"]))
        .map(([k, label]) => `<button class="mkt-filter${FILTER === k ? " active" : ""}" onclick="setFilter('${k}')">${esc(label)}</button>`).join("")
    : "";
  const shown = FILTER === "all" ? others : others.filter(l => l.assetType === FILTER);
  document.getElementById("noBrowse").classList.toggle("hidden", shown.length > 0);
  document.getElementById("browseList").innerHTML = shown.map(l => listingCardHtml(l, {})).join("");
  mktSyncNotifyBox();
  mcRender();

  document.getElementById("noSold").classList.toggle("hidden", sold.length > 0);
  document.getElementById("soldTable").innerHTML = sold.slice(0, 20).map(l => {
    const diff = l.soldPrice - l.refPrice;
    const pct = l.refPrice ? Math.round((diff / l.refPrice) * 100) : 0;
    const q = listingQuantity(l);
    return `<tr>
      <td>${esc(l.name)}${q > 1 ? ` <span class="badge navy">×${q}</span>` : ""}<br><span class="muted-small">${esc(nameOf(l.seller))} → ${esc(nameOf(l.soldTo))}</span></td>
      <td>${fmtMoney(l.refPrice)}${q > 1 ? " each" : ""}</td>
      <td><strong>${fmtMoney(l.soldPrice)}</strong>${q > 1 ? ` each<br><span class="muted-small">${fmtMoney(Math.round(l.soldPrice * q * 100) / 100)} in total</span>` : ""}</td>
      <td class="${diff >= 0 ? "ticker-up" : "ticker-down"}">${diff >= 0 ? "+" : "−"}${fmtMoney(Math.abs(diff))} (${pct >= 0 ? "+" : ""}${pct}%)</td>
    </tr>`;
  }).join("");
}

function setFilter(k) { FILTER = k; renderStudent(); }

function renderSellList() {
  const mp = CLS.marketplace;
  const box = document.getElementById("sellList");
  const empty = document.getElementById("noSellable");
  if (!mp.enabled) { box.innerHTML = ""; empty.classList.add("hidden"); return; }

  const assets = getSellableAssets(CLS, ME);
  const openMine = (CLS.listings || []).filter(l => l.seller === ME.username && listingIsOpen(l)).length;
  const atCap = mp.maxActiveListings > 0 && openMine >= mp.maxActiveListings;

  document.getElementById("sellIntro").textContent =
    `Set your own price, within ${mp.minPricePct}%${mp.maxPricePct > 0 ? `–${mp.maxPricePct}%` : "+"} of what the thing originally cost.` +
    (mp.maxActiveListings > 0 ? ` You can have ${mp.maxActiveListings} listing${mp.maxActiveListings === 1 ? "" : "s"} open at a time (${openMine} used).` : "") +
    (mp.feePct > 0 ? ` A ${mp.feePct}% market fee comes off whatever you sell for.` : "") +
    (mp.requireApproval ? " Your teacher approves each listing before it goes live." : "") +
    (mp.allowStore ? " Got several of the same store item? Put them all up in one listing. Buyers take one at a time." : "");

  empty.classList.toggle("hidden", assets.length > 0);
  box.innerHTML = assets.map(a => {
    const key = a.assetType + "-" + a.assetId;
    if (a.blocked) {
      return `<div class="mkt-sell-row">
        <div class="grow">
          <div class="mkt-sell-name">${esc(a.name)}</div>
          <div class="muted-small">${esc(a.blocked)}</div>
        </div>
      </div>`;
    }
    const b = marketplacePriceBounds(CLS, a.refPrice);
    const several = a.assetType === "store" && a.count > 1;
    // A vehicle or property can't be put up for sale while a big event about that kind of thing is waiting
    // (store items are never held). bigEventLockUi gives the disabled attribute and the reason.
    const beLock = a.assetType === "store" ? { locked: false, attr: "", note: "" } : bigEventLockUi(CLS, ME.username, a.assetType);
    return `<div class="mkt-sell-row">
      <div class="grow">
        <div class="mkt-sell-name">${esc(a.name)}${a.count > 1 ? ` <span class="badge navy">You have ${a.count}</span>` : ""}</div>
        <div class="muted-small">Originally ${fmtMoney(a.refPrice)}${a.note ? ` · ${esc(a.note)}` : ""}</div>
        <div class="mkt-band">Allowed price: ${bandText(a.refPrice)}</div>
      </div>
      <label class="mkt-field"><span>${several ? "Price each" : "Price"}</span>
        <input type="number" id="price-${key}" min="0" step="0.01" value="${b.min > 0 ? b.min : Math.round(a.refPrice * 0.9 * 100) / 100}" aria-label="Your price for ${esc(a.name)}"></label>
      ${several ? `<label class="mkt-field mkt-field-qty"><span>How many</span>
        <input type="number" id="qty-${key}" min="1" max="${a.count}" step="1" value="1" aria-label="How many ${esc(a.name)} to list"></label>` : ""}
      <label class="mkt-field mkt-field-desc"><span>Note (optional)</span>
        <input type="text" id="desc-${key}" placeholder="Say something about it" aria-label="Description"></label>
      <button class="btn small gold" onclick="listIt('${a.assetType}','${esc(a.assetId)}')" ${atCap || beLock.locked ? "disabled" : ""}${beLock.locked ? ` title="${esc(beLock.reason)}"` : ""}>${atCap ? "Listing limit reached" : "List it"}</button>
      ${beLock.note}
    </div>`;
  }).join("");
}

async function listIt(assetType, assetId) {
  const key = assetType + "-" + assetId;
  const qtyEl = document.getElementById("qty-" + key);
  const res = await createListing(CURRENT.username, CURRENT.classCode, {
    assetType, assetId,
    price: document.getElementById("price-" + key).value,
    description: document.getElementById("desc-" + key).value,
    quantity: qtyEl ? qtyEl.value.trim() : 1
  });
  const qty = res.ok ? listingQuantity(res.listing) : 1;
  const what = res.ok && qty > 1 ? `${qty} × ${esc(res.listing.name)}` : "It";
  document.getElementById("sellMsg").innerHTML = res.ok
    ? `<div class="success-msg">Listed${CLS.marketplace.requireApproval ? `: ${qty > 1 ? `${what} are` : "it's"} waiting for your teacher to approve.` : `! ${what} ${qty > 1 ? "are" : "is"} live in the Trade Centre now.`}</div>`
    : `<div class="error-msg">${esc(res.error)}</div>`;
  if (res.ok) showCommittedListing(res.listing.id, res.listing);
}

/* ---------------- One listing card, shared by all three views ---------------- */
function listingCardHtml(l, opts) {
  const mine = !!opts.mine;
  const teacher = !!opts.teacher;
  const openOffers = (l.offers || []).filter(o => o.status === "open" || o.status === "countered");
  const myOffer = openOffers.find(o => o.buyer === (ME && ME.username));
  const diffPct = l.refPrice ? Math.round(((l.price - l.refPrice) / l.refPrice) * 100) : 0;
  const qty = listingQuantity(l);

  let actions = "";
  if (teacher) {
    actions = `<button class="btn small coral" onclick="pullListing('${l.id}')">${icon("trash", 13)} Take down</button>`;
  } else if (mine) {
    actions = `<button class="btn small secondary" onclick="editMine('${l.id}')" aria-expanded="${MKT_EDITING === l.id}">${icon("edit", 13)} Edit</button><button class="btn small secondary" onclick="cancelMine('${l.id}')">${icon("trash", 13)} Cancel listing</button>`;
  } else if (CLS.marketplace.enabled) {
    actions = `<button class="btn small gold" onclick="buyIt('${l.id}')">${qty > 1 ? "Buy 1" : "Buy"} for ${fmtMoney(l.price)}</button><span class="mc-slot" id="mcslot-${l.id}">${mcSlotHtml(l)}</span>`;
    if (CLS.marketplace.allowOffers) {
      actions += (myOffer && myOffer.status === "countered")
        ? `<button class="btn small mint" onclick="acceptCounterUi('${l.id}','${myOffer.id}')">Accept ${fmtMoney(myOffer.counter.amount)}${offerQuantity(myOffer) > 1 ? " each" : ""}</button><button class="btn small secondary" onclick="decline('${l.id}','${myOffer.id}')">Decline counter</button>`
        : myOffer
        ? `<button class="btn small secondary" onclick="withdraw('${l.id}','${myOffer.id}')">Withdraw my ${fmtMoney(myOffer.amount)}${offerQuantity(myOffer) > 1 ? " × " + offerQuantity(myOffer) : ""} offer</button>`
        : `<button class="btn small secondary" onclick="toggleOffer('${l.id}')">${icon("swap", 13)} Make an offer</button>`;
    }
  }

  const offerBounds = marketplacePriceBounds(CLS, l.refPrice);
  const suggestedOffer = Math.min(offerBounds.max ?? Infinity,
    Math.max(0.01, offerBounds.min, Math.round(l.price * 80) / 100));
  const offerForm = (!mine && !teacher && OFFERING === l.id) ? `
    <div class="mkt-offer-list">
      <label for="offer-${l.id}">Your price${qty > 1 ? " for ONE" : ""} (allowed: ${bandText(l.refPrice)})</label>
      <input id="offer-${l.id}" type="number" min="${Math.max(0.01, offerBounds.min)}" ${offerBounds.max == null ? "" : `max="${offerBounds.max}"`} step="0.01" value="${suggestedOffer}" oninput="offerTotal('${l.id}')">
      ${qty > 1 ? `<label for="offerqty-${l.id}" style="margin-top:8px;display:block;">How many at that price (1–${qty})</label>
      <input id="offerqty-${l.id}" type="number" min="1" max="${qty}" step="1" value="1" oninput="offerTotal('${l.id}')">` : ""}
      <div class="muted-small" id="offertotal-${l.id}" style="margin:6px 0;">Total: <strong>${fmtMoney(suggestedOffer)}</strong></div>
      <input id="offernote-${l.id}" type="text" placeholder="Why should they take it? (optional)">
      <div class="row-flex" style="gap:8px;margin-top:10px;">
        <button class="btn small gold" onclick="sendOffer('${l.id}')">Send offer</button>
        <button class="btn small secondary" onclick="toggleOffer(null)">Cancel</button>
      </div>
    </div>` : "";

  const counterBanner = (!mine && !teacher && myOffer && myOffer.status === "countered" && myOffer.counter) ? `
    <div class="mkt-offer-list">
      <p class="muted-small" style="margin:0;"><strong>The seller countered:</strong> <span class="mkt-offer-amt">${fmtMoney(myOffer.counter.amount)}${offerQuantity(myOffer) > 1 ? " each" : ""}</span> (you offered ${fmtMoney(myOffer.amount)})</p>
      ${myOffer.counter.note ? `<span class="mkt-offer-note">"${esc(myOffer.counter.note)}"</span>` : ""}
    </div>` : "";

  // Seller: change price / description / how many are for sale.
  let editForm = "";
  if (mine && MKT_EDITING === l.id) {
    const sa = (ME && CLS) ? getSellableAssets(CLS, ME).find(a => a.assetType === l.assetType && a.assetId === l.assetId) : null;
    const maxQ = qty + (sa ? (sa.count || 0) : 0);
    const enter = `onkeydown="if(event.key==='Enter'){event.preventDefault();saveEdit('${l.id}');}"`;
    editForm = `
    <div class="mkt-offer-list">
      <label for="edprice-${l.id}">Price${qty > 1 ? " for ONE" : ""} (allowed: ${bandText(l.refPrice)})</label>
      <input id="edprice-${l.id}" type="number" min="0" step="0.01" value="${l.price}" ${enter}>
      ${l.assetType === "store" ? `<label for="edqty-${l.id}" style="margin-top:8px;display:block;">How many for sale (1–${maxQ})</label>
      <input id="edqty-${l.id}" type="number" min="1" max="${maxQ}" step="1" value="${qty}" ${enter}>` : ""}
      <label for="eddesc-${l.id}" style="margin-top:8px;display:block;">Description (optional)</label>
      <input id="eddesc-${l.id}" type="text" maxlength="240" value="${esc(l.description || "")}" placeholder="Tell buyers about it" ${enter}>
      ${CLS.marketplace.requireApproval ? `<p class="muted-small" style="margin:6px 0 0;">Changing the price or description sends it back to your teacher for approval.</p>` : ""}
      <div class="row-flex" style="gap:8px;margin-top:10px;">
        <button class="btn small gold" onclick="saveEdit('${l.id}')">Save changes</button>
        <button class="btn small secondary" onclick="editMine(null)">Cancel</button>
      </div>
      <div id="editmsg-${l.id}"></div>
    </div>`;
  }

  // What became of the last offer / counter, for a few days after the other side said no, with their reason if they gave one.
  let responseNote = "";
  if (!teacher && ME) {
    const recent = (o, by) => o.status === "declined" && o.declinedBy === by && o.respondedTs && Date.now() - o.respondedTs < MKT_RESPONSE_MS;
    const why = o => o.declineReason ? `<span class="mkt-offer-note">"${esc(o.declineReason)}"</span>` : "";
    const rows = mine
      ? (l.offers || []).filter(o => recent(o, "buyer")).sort((a, b) => b.respondedTs - a.respondedTs).slice(0, 3)
          .map(o => `<p class="muted-small" style="margin:0 0 4px;"><strong>${esc(nameOf(o.buyer))}</strong> turned down your ${fmtMoney(o.counter ? o.counter.amount : o.amount)} counter-offer.</p>${why(o)}`)
      : (myOffer ? [] : (l.offers || []).filter(o => o.buyer === ME.username && recent(o, "seller")).sort((a, b) => b.respondedTs - a.respondedTs).slice(0, 1)
          .map(o => `<p class="muted-small" style="margin:0 0 4px;"><strong>${esc(nameOf(l.seller))}</strong> ${o.counter ? `took back their ${fmtMoney(o.counter.amount)} counter-offer.` : `declined your ${fmtMoney(o.amount)}${offerQuantity(o) > 1 ? " each" : ""} offer.`}</p>${why(o)}`));
    if (rows.length) responseNote = `<div class="mkt-offer-list">${rows.join("")}</div>`;
  }

  const offerList = (mine && openOffers.length) ? `
    <div class="mkt-offer-list">
      <p class="muted-small" style="margin:0 0 6px;"><strong>${openOffers.length} ${openOffers.length === 1 ? "offer" : "offers"}</strong></p>
      ${openOffers.sort((a, b) => b.amount - a.amount || offerQuantity(b) - offerQuantity(a)).map(o => {
        const oq = offerQuantity(o);
        const tooMany = oq > qty;
        const total = Math.round(o.amount * oq * 100) / 100;
        if (o.status === "countered" && o.counter) return `
        <div class="mkt-offer">
          <span><span class="mkt-offer-amt">${fmtMoney(o.counter.amount)}${oq > 1 ? " each" : ""}</span> <span class="badge navy">Countered</span> <span class="muted-small">to ${esc(nameOf(o.buyer))} (they offered ${fmtMoney(o.amount)}). Waiting for their answer</span></span>
          <span class="row-flex" style="gap:6px;"><button class="btn small secondary" onclick="decline('${l.id}','${o.id}')">Cancel</button></span>
        </div>`;
        const counterForm = COUNTERING === o.id ? `
          <div style="flex-basis:100%;margin-top:6px;">
            <label for="counter-${o.id}">Your counter-price${oq > 1 ? " for ONE" : ""} (allowed: ${bandText(l.refPrice)})</label>
            <input id="counter-${o.id}" type="number" min="0" step="0.01" value="${Math.round((l.price + o.amount) / 2 * 100) / 100}">
            <input id="counternote-${o.id}" type="text" placeholder="Message to the buyer (optional)" style="margin-top:6px;">
            <div class="row-flex" style="gap:6px;margin-top:6px;">
              <button class="btn small gold" onclick="sendCounter('${l.id}','${o.id}')">Send counter-offer</button>
              <button class="btn small secondary" onclick="toggleCounter(null)">Cancel</button>
            </div>
            <div id="countermsg-${o.id}"></div>
          </div>` : "";
        return `
        <div class="mkt-offer">
          <span><span class="mkt-offer-amt">${fmtMoney(o.amount)}${oq > 1 ? " each" : ""}</span>${oq > 1 ? ` <span class="badge navy">×${oq}</span> <span class="muted-small">= ${fmtMoney(total)}</span>` : ""} <span class="muted-small">from ${esc(nameOf(o.buyer))}</span></span>
          <span class="row-flex" style="gap:6px;">
            <button class="btn small mint" onclick="accept('${l.id}','${o.id}')" ${tooMany ? "disabled" : ""}>Accept</button>
            <button class="btn small gold" onclick="toggleCounter('${o.id}')" ${tooMany ? "disabled" : ""}>Counter</button>
            <button class="btn small secondary" onclick="decline('${l.id}','${o.id}')">Decline</button>
          </span>
          ${tooMany ? `<span class="mkt-offer-note">Wants ${oq} but only ${qty} ${qty === 1 ? "is" : "are"} left. Decline it and they can send a new one.</span>` : ""}
          ${o.note ? `<span class="mkt-offer-note">"${esc(o.note)}"</span>` : ""}
          ${counterForm}
        </div>`;
      }).join("")}
    </div>` : "";

  return `
    <div class="mkt-listing${mine ? " mine" : ""}" id="lst-${l.id}">
      <h4>${esc(l.name)}${qty > 1 ? ` <span class="badge navy">×${qty}</span>` : ""}</h4>
      ${l.description ? `<p class="mkt-desc">${esc(l.description)}</p>` : ""}
      <div class="mkt-price">
        <span class="now">${fmtMoney(l.price)}${qty > 1 ? `<span class="mkt-each"> each</span>` : ""}</span>
        <span class="ref">store price ${fmtMoney(l.refPrice)} · <span class="${diffPct > 0 ? "ticker-down" : "ticker-up"}">${diffPct > 0 ? "+" : ""}${diffPct}%</span></span>
      </div>
      <div class="mkt-seller">
        ${mine ? `<span class="mkt-status ${l.status}">${l.status === "pending" ? "Awaiting approval" : "Live"}</span>${qty > 1 ? ` <span class="muted-small">· ${qty} left</span>` : ""}`
               : `${icon("swap", 13)} ${esc(nameOf(l.seller))}`}
        ${!mine && qty > 1 ? `<span class="muted-small">· ${qty} available</span>` : ""}
        ${!mine && openOffers.length ? `<span class="muted-small">· ${openOffers.length} offer${openOffers.length === 1 ? "" : "s"} in</span>` : ""}
        ${teacher ? `<span class="muted-small">· ${esc(nameOf(l.seller))}</span>` : ""}
      </div>
      <div class="mkt-actions">${actions}</div>
      ${editForm}${offerForm}${counterBanner}${responseNote}${offerList}
      <div id="msg-${l.id}"></div>
    </div>`;
}

// Live "Total" line under the offer boxes: price for one x how many.
function offerTotal(id) {
  const box = document.getElementById("offertotal-" + id);
  if (!box) return;
  const p = Number(document.getElementById("offer-" + id).value);
  const qEl = document.getElementById("offerqty-" + id);
  const q = qEl ? Math.floor(Number(qEl.value)) : 1;
  box.innerHTML = p > 0 && q >= 1 ? `Total: <strong>${fmtMoney(Math.round(p * q * 100) / 100)}</strong>${q > 1 ? ` for ${q}` : ""}` : "Total: —";
}
function toggleCounter(offerId) { COUNTERING = (COUNTERING === offerId) ? null : offerId; renderStudent(); }
function toggleOffer(id) { OFFERING = (OFFERING === id) ? null : id; renderStudent(); }

/* ---------------- "Pay with" bar: cash or credit card ----------------
   What's picked here is used for Buy now, and is saved as the student's default
   account — the one accepted offers are taken from. Houses are always cash. */
let MP_PAY = { useCard: false, split: false, cardMax: "", init: false };
function mktHasCard() { return !!(ME && CLS && cardIsActive(ME) && cardPlanById(CLS, ME.creditCard.planId)); }
function mktInjectCss() {
  if (document.getElementById("mktPayCss")) return;
  const st = document.createElement("style");
  st.id = "mktPayCss";
  st.textContent = `
  .mkt-paybar{display:flex;flex-wrap:wrap;align-items:center;gap:14px 18px;padding:14px 16px;margin:0 0 14px;border:1.5px solid var(--line,#dfe3ee);border-radius:16px;background:rgba(127,127,127,.07)}
  .mkt-paybar.hidden{display:none}
  .mkt-pb-seg{display:inline-flex;gap:4px;padding:4px;border-radius:var(--sw-l,23px 3px 23px 3px / 18px 3px 18px 3px);background:rgba(127,127,127,.15)}
  .mkt-pb-seg button{border:0;background:transparent;color:inherit;border-radius:var(--sw-m,17px 2px 17px 2px / 13px 2px 13px 2px);padding:8px 18px;cursor:pointer;font:inherit;font-weight:700;display:flex;flex-direction:column;align-items:center;line-height:1.15;opacity:.7}
  .mkt-pb-seg button small{font-size:.72em;font-weight:600}
  .mkt-pb-seg button.on{background:var(--card);color:var(--ink,#1f2b44);opacity:1;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  .mkt-pb-chips{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .mkt-chip{font-size:.8em;font-weight:700;padding:4px 12px;border-radius:var(--sw-s,12px 1px 12px 1px / 9px 1px 9px 1px);border:1px solid rgba(127,127,127,.35)}
  .mkt-chip.mint{background:rgba(46,184,120,.15);border-color:rgba(46,184,120,.45)}
  .mkt-pb-split{flex:1;min-width:220px}
  .mkt-pb-note{flex-basis:100%;margin:0}`;
  document.head.appendChild(st);
}
function mktPayBarRender() {
  const els = ["mktPayBar", "mcPay"].map(id => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  if (!mktHasCard()) { els.forEach(el => el.classList.add("hidden")); MP_PAY.useCard = false; MP_PAY.split = false; MP_PAY.init = false; mcRender(); return; }
  mktInjectCss();
  if (!MP_PAY.init) {
    let d = ME.mpPayDefault;
    try { d = localStorage.getItem("anw_mpPay_" + CURRENT.username) || d; } catch (e) { /* ignore */ }
    MP_PAY.useCard = d === "card"; MP_PAY.init = true;
  }
  const plan = cardPlanById(CLS, ME.creditCard.planId);
  const avail = cardAvailable(ME.creditCard, plan);
  const useCard = MP_PAY.useCard;
  els.forEach((el, i) => {
  el.classList.remove("hidden");
  el.innerHTML = `
    <strong>Pay with</strong>
    <div class="mkt-pb-seg" role="group" aria-label="Payment method">
      <button type="button" class="${useCard ? "" : "on"}" onclick="mktSetPay(false)">Cash<small>${fmtMoney(ME.balance || 0)}</small></button>
      <button type="button" class="${useCard ? "on" : ""}" onclick="mktSetPay(true)">Credit card<small>${fmtMoney(avail)} available</small></button>
    </div>
    <div class="mkt-pb-chips">${useCard
      ? (plan.cashbackPct > 0 ? `<span class="mkt-chip mint">${plan.cashbackPct}% cashback</span>` : "") + (plan.rewardEvery > 0 && plan.rewardBack > 0 ? `<span class="mkt-chip mint">${fmtMoney(plan.rewardBack)} back per ${fmtMoney(plan.rewardEvery)}</span>` : "") + `<span class="mkt-chip">Billed on your next statement</span>`
      : `<span class="mkt-chip">Switch to card for cashback &amp; rewards</span>`}</div>
    ${useCard ? `<div class="mkt-pb-split">
      <label style="display:flex;align-items:center;gap:8px;font-weight:700;"><input type="checkbox" style="width:20px;height:20px;min-height:auto;" ${MP_PAY.split ? "checked" : ""} onchange="mktSetSplit(this.checked)"> Part card, part cash</label>
      ${MP_PAY.split ? `<div style="margin-top:6px;">Card covers up to $<input type="number" min="0.01" step="0.01" style="width:100px" value="${esc(MP_PAY.cardMax)}" placeholder="all it can" onchange="mktSetCardMax(this.value)"></div>` : ""}
      <div class="muted-small">Splitting works on purchases of ${fmtMoney(cardSettings(CLS).splitMin)} or more, or whenever the card can't cover it all.</div></div>` : ""}
    ${i === 0 ? `<p class="muted-small mkt-pb-note">This is also your default account: when a classmate accepts one of your offers, it comes out of ${useCard ? "your credit card" : "your cash"}. Houses are always paid in cash.</p>` : ""}`;
  });
  mcRender();
}
async function mktSetPay(useCard) {
  MP_PAY.useCard = !!useCard;
  if (!useCard) MP_PAY.split = false;
  if (ME) ME.mpPayDefault = useCard ? "card" : "cash";
  try { localStorage.setItem("anw_mpPay_" + CURRENT.username, useCard ? "card" : "cash"); } catch (e) { /* ignore */ }
  mktPayBarRender();
  try { await setMarketplacePayDefault(CURRENT.username, !!useCard); }
  catch (e) { console.error("Couldn't save default account to the server (accepted offers will use the old one). Check Firestore rules allow mpPayDefault:", e); }
}
function mktSetSplit(on) { MP_PAY.split = !!on; mktPayBarRender(); }
function mktSetCardMax(v) { MP_PAY.cardMax = v === "" ? "" : String(Math.max(0, Number(v) || 0)); }

async function buyIt(id) {
  const l = (CLS.listings || []).find(x => x.id === id);
  if (!l) return;
  const several = listingQuantity(l) > 1;
  const isHouse = l.assetType === "property";
  const card = mktHasCard() && MP_PAY.useCard && !isHouse;
  const how = card ? (MP_PAY.split ? "part on your credit card, the rest in cash" : "on your credit card") : "in cash";
  if (!await t29Confirm(`Buy ${several ? "one " : ""}"${l.name}" from ${nameOf(l.seller)} for ${fmtMoney(l.price)}, paid ${how}?${isHouse && mktHasCard() && MP_PAY.useCard ? " (Houses are always paid in cash.)" : ""}`)) return;
  const pay = card ? { useCard: true, split: MP_PAY.split, cardMax: MP_PAY.cardMax } : {};
  const res = await buyListing(CURRENT.username, CURRENT.classCode, id, pay, l.price);
  await render(true);
  if (res.ok) {
    // The listing's card may be gone once it's sold, so the message goes
    // in the box at the top of the list instead.
    flashMsg(document.getElementById("browseMsg"), `<div class="success-msg">Bought ${esc(l.name)}${card ? " with your credit card" : ""}! It's yours now.${res.left > 0 ? ` ${res.left} more still for sale.` : ""}</div>`);
    return;
  }
  const box = document.getElementById("msg-" + id);
  if (box) box.innerHTML = `<div class="error-msg">${esc(res.error)}</div>`;
  else alert(res.error);
}

async function sendOffer(id) {
  const res = await makeOffer(CURRENT.username, CURRENT.classCode, id,
    document.getElementById("offer-" + id).value,
    document.getElementById("offernote-" + id).value,
    (document.getElementById("offerqty-" + id) || { value: 1 }).value);
  if (res.ok) OFFERING = null;
  await render(true);
  const box = document.getElementById("msg-" + id);
  if (box) box.innerHTML = res.ok ? `<div class="success-msg">Offer sent. The seller will be notified.</div>` : `<div class="error-msg">${esc(res.error)}</div>`;
  else if (!res.ok) alert(res.error);
}

async function withdraw(listingId, offerId) {
  await setOfferStatus(CURRENT.username, CURRENT.classCode, listingId, offerId, "withdrawn");
  await render(true);
}
// Asks for an optional reason before an offer or counter is declined. Returns the reason ("" if they left it blank),
// or null if they backed out. The reason has to be school-appropriate (the same check as payment reasons): if it isn't,
// the box opens again with what they typed so they can reword it.
async function askReason(message, confirmText) {
  let text = "", warn = "";
  for (;;) {
    const v = await t29Prompt((warn ? warn + "\n\n" : "") + message, text, { confirmText, placeholder: "Reason (optional)" });
    if (v === null || v === undefined) return null;
    text = String(v).replace(/\s+/g, " ").trim();
    const c = t29TextCheck(text, { maxLen: 140 });
    if (c.ok) return c.text;
    warn = c.error;
  }
}
async function decline(listingId, offerId) {
  const l = (CLS.listings || []).find(x => x.id === listingId);
  const o = l && (l.offers || []).find(x => x.id === offerId);
  if (!l || !o) return;
  const iAmSeller = l.seller === CURRENT.username;
  const reason = iAmSeller
    ? (o.status === "countered"
        ? await askReason(`Take back your counter-offer to ${nameOf(o.buyer)}? You can add a reason (optional).`, "Take it back")
        : await askReason(`Decline ${nameOf(o.buyer)}'s offer of ${fmtMoney(o.amount)}${offerQuantity(o) > 1 ? " each" : ""}? You can tell them why (optional).`, "Decline offer"))
    : await askReason(`Decline ${nameOf(l.seller)}'s counter-offer of ${fmtMoney(o.counter ? o.counter.amount : 0)}? You can tell them why (optional).`, "Decline counter");
  if (reason === null) return;
  const res = await setOfferStatus(CURRENT.username, CURRENT.classCode, listingId, offerId, "declined", reason);
  await render(true);
  if (!res.ok) alert(res.error);
}
async function accept(listingId, offerId) {
  const l = (CLS.listings || []).find(x => x.id === listingId);
  const o = l && (l.offers || []).find(x => x.id === offerId);
  const oq = o ? offerQuantity(o) : 1;
  const ask = o && oq > 1
    ? `Accept this offer and hand over ${oq} × "${l.name}" at ${fmtMoney(o.amount)} each (${fmtMoney(Math.round(o.amount * oq * 100) / 100)} in total)?`
    : (l && listingQuantity(l) > 1 ? "Accept this offer and hand one of them over?" : "Accept this offer and hand the item over?");
  if (!await t29Confirm(ask)) return;
  const res = await acceptOffer(CURRENT.username, CURRENT.classCode, listingId, offerId);
  await render(true);
  if (!res.ok) alert(res.error);
}
async function sendCounter(listingId, offerId) {
  const res = await counterOffer(CURRENT.username, CURRENT.classCode, listingId, offerId,
    document.getElementById("counter-" + offerId).value, document.getElementById("counternote-" + offerId).value);
  if (res.ok) { COUNTERING = null; await render(true); return; }
  const box = document.getElementById("countermsg-" + offerId);
  if (box) box.innerHTML = `<div class="error-msg">${esc(res.error)}</div>`; else alert(res.error);
}
async function acceptCounterUi(listingId, offerId) {
  const l = (CLS.listings || []).find(x => x.id === listingId);
  const o = l && (l.offers || []).find(x => x.id === offerId);
  if (!o || !o.counter) return;
  const oq = offerQuantity(o);
  const isHouse = l.assetType === "property";
  const card = mktHasCard() && MP_PAY.useCard && !isHouse;
  const how = card ? (MP_PAY.split ? "part on your credit card, the rest in cash" : "on your credit card") : "in cash";
  const total = Math.round(o.counter.amount * oq * 100) / 100;
  if (!await t29Confirm(`Accept ${nameOf(l.seller)}'s counter-offer and buy ${oq > 1 ? oq + " × " : ""}"${l.name}" for ${fmtMoney(o.counter.amount)}${oq > 1 ? " each (" + fmtMoney(total) + " in total)" : ""}, paid ${how}?`)) return;
  const pay = card ? { useCard: true, split: MP_PAY.split, cardMax: MP_PAY.cardMax } : {};
  const res = await acceptCounter(CURRENT.username, CURRENT.classCode, listingId, offerId, pay);
  await render(true);
  if (res.ok) flashMsg(document.getElementById("browseMsg"), `<div class="success-msg">Bought ${esc(l.name)} at the countered price! It's yours now.</div>`);
  else alert(res.error);
}
function editMine(id) {
  MKT_EDITING = (id && MKT_EDITING !== id) ? id : null;
  renderStudent();
  const el = MKT_EDITING && document.getElementById("edprice-" + MKT_EDITING);
  if (el) el.focus();
}
async function saveEdit(id) {
  const val = k => { const el = document.getElementById(k + "-" + id); return el ? el.value : undefined; };
  const res = await updateListing(CURRENT.username, CURRENT.classCode, id, { price: val("edprice"), quantity: val("edqty"), description: val("eddesc") });
  if (!res.ok) {
    const box = document.getElementById("editmsg-" + id);
    if (box) box.innerHTML = `<div class="error-msg">${esc(res.error)}</div>`; else alert(res.error);
    return;
  }
  MKT_EDITING = null;
  await render(true);
  const box = document.getElementById("msg-" + id);
  if (!box) return;
  const note = res.unchanged ? "Nothing was changed."
    : res.reapproval ? "Saved. Your teacher needs to approve the change before it goes live again."
    : res.declined ? `Saved. ${res.declined} offer${res.declined === 1 ? "" : "s"} asking for more than you now have ${res.declined === 1 ? "was" : "were"} declined.`
    : "Saved!";
  flashMsg(box, `<div class="success-msg">${esc(note)}</div>`);
}
async function cancelMine(id) {
  const l = (CLS.listings || []).find(x => x.id === id);
  if (!await t29Confirm(l && listingQuantity(l) > 1 ? `Take this listing down? All ${listingQuantity(l)} still for sale come off the market.` : "Take this listing down?")) return;
  try {
    const res = await cancelListing(CURRENT.username, CURRENT.classCode, id);
    if (!res.ok) { await t29Alert(res.error); return; }
    showCommittedListing(id, null);
  } catch (e) {
    await t29Alert("Couldn’t confirm that the listing was taken down. Refresh to check its status.");
  }
}

document.addEventListener("DOMContentLoaded", init);


/* "Tell me when something new is listed": each new listing from a classmate
   becomes an item in the bell (see notifMarketplaceNewListingItems). */
function mktSyncNotifyBox() {
  const box = document.getElementById("mktNotifyNew");
  if (!box || !ME) return;
  const on = notifMktNewGet(ME.username) > 0;
  box.checked = on;
  const deviceOn = typeof notifDeviceAlertsOn === "function" && notifDeviceAlertsOn();
  document.getElementById("mktNotifyHelp").textContent = !on
    ? " You'll get a message in the bell every time a classmate puts something up."
    : deviceOn ? " On. New listings show in the bell and as a device alert."
    : " On. New listings show in the bell. Turn on device alerts from the bell to get a phone or computer alert as well.";
}
async function mktToggleNotify(on) {
  notifMktNewSet(ME.username, on);
  mktSyncNotifyBox();
  if (typeof notifRefresh === "function") notifRefresh(ME.username, CURRENT.classCode);
}


/* ===================== Student: Trade Centre cart =====================
   Put several classmates' listings in a cart, then pay for them in one checkout
   (same look as the Store's cart; the "Pay with" bar is shared with the Browse card).
   buyListing() buys ONE unit of ONE listing per call, so checkout runs those calls
   one after another: if one fails, the ones before it have already gone through and
   the rest stay in the cart. */
let MC = {}, MC_BUSY = false, MC_DONE = null, MC_MSG = "", MC_NOTE = "", MC_OPEN = false;
const mcEl = id => document.getElementById(id);
const mcKey = () => "anw_mpcart_" + CURRENT.username + "_" + CURRENT.classCode;
function mcLoad() { try { const o = JSON.parse(localStorage.getItem(mcKey()) || "{}"); MC = o && typeof o === "object" ? o : {}; } catch (e) { MC = {}; } }
function mcSave() { try { localStorage.setItem(mcKey(), JSON.stringify(MC)); } catch (e) { /* ignore */ } }
const mcRound = n => Math.round((Number(n) || 0) * 100) / 100;
const mcFind = id => (CLS.listings || []).find(x => x.id === id);
const mcValid = l => !!l && l.status === "active" && l.seller !== ME.username;
const mcLines = () => Object.keys(MC).map(id => ({ l: mcFind(id), qty: MC[id] })).filter(x => mcValid(x.l));
function mcTotals(lines) {
  let total = 0, house = 0, units = 0;
  lines.forEach(({ l, qty }) => { const t = l.price * qty; total += t; units += qty; if (l.assetType === "property") house += t; });
  return { total: mcRound(total), house: mcRound(house), units };
}

// Drop listings that sold, were cancelled or went back to approval; cap quantities to what's left.
function mcClean() {
  if (!CLS || !ME) return;
  let changed = false, dropped = 0;
  Object.keys(MC).forEach(id => {
    const l = mcFind(id);
    let q = Math.floor(Number(MC[id])) || 0;
    q = mcValid(l) ? Math.min(q, listingQuantity(l)) : 0;
    if (q < 1) { delete MC[id]; changed = true; dropped++; }
    else if (q !== MC[id]) { MC[id] = q; changed = true; }
  });
  if (changed) mcSave();
  if (dropped) MC_NOTE = `${dropped} listing${dropped === 1 ? " was" : "s were"} taken out of your cart because ${dropped === 1 ? "it isn't" : "they aren't"} for sale any more.`;
}

// The "Add to cart" part of a listing card (re-drawn on its own, so open offer boxes keep what was typed).
function mcSlotHtml(l) {
  const q = MC[l.id] || 0, max = listingQuantity(l);
  if (!q) return `<button class="btn small secondary" onclick="mcAdd('${l.id}')">${icon("cart", 13)} Add to cart</button>`;
  return `<button class="btn small mint" onclick="mcOpen()">${icon("cart", 13)} In cart ×${q}</button>` +
    (q < max ? `<button class="btn small secondary" onclick="mcAdd('${l.id}')">Add another</button>` : "");
}
function mcSlot(id) { const el = mcEl("mcslot-" + id), l = CLS && mcFind(id); if (el && l) el.innerHTML = mcSlotHtml(l); }

function mcAdd(id) {
  const l = mcFind(id); if (!mcValid(l)) return;
  const have = MC[id] || 0, max = listingQuantity(l);
  if (have >= max) { const b = mcEl("msg-" + id); if (b) b.innerHTML = `<div class="error-msg">You already have all ${max} in your cart.</div>`; return; }
  MC[id] = have + 1; mcSave(); MC_DONE = null; MC_MSG = ""; MC_NOTE = "";
  mcSlot(id); mcRender();
  const fab = mcEl("mcFab"); if (fab) { fab.classList.remove("bump"); void fab.offsetWidth; fab.classList.add("bump"); }
}
function mcSet(id, qty) {
  const l = mcFind(id); if (!mcValid(l)) return;
  qty = Math.min(Math.floor(qty), listingQuantity(l));
  if (qty < 1) delete MC[id]; else MC[id] = qty;
  mcSave(); MC_MSG = ""; MC_NOTE = ""; mcSlot(id); mcRender();
}
const mcStep = (id, d) => mcSet(id, (MC[id] || 0) + d);
const mcRemove = id => mcSet(id, 0);
async function mcClear() {
  if (!mcLines().length || !await t29Confirm("Remove everything from your cart?")) return;
  const ids = Object.keys(MC); MC = {}; mcSave(); MC_MSG = ""; MC_NOTE = ""; ids.forEach(mcSlot); mcRender();
}

async function mcCheckout() {
  if (MC_BUSY || !CLS.marketplace.enabled) return;
  const lines = mcLines(); if (!lines.length) return;
  const t = mcTotals(lines);
  const card = mktHasCard() && MP_PAY.useCard;
  // "Card covers up to $X" is per purchase, so over several purchases it would not mean what the box says.
  if (card && MP_PAY.split && MP_PAY.cardMax !== "" && t.units > 1) {
    MC_MSG = `<div class="error-msg">A card limit on a part-card payment only works for one purchase at a time. Clear the limit box, or pay fully by card or cash.</div>`;
    mcRender(); return;
  }
  const how = card ? (MP_PAY.split ? "part on your credit card, the rest in cash" : "on your credit card") : "in cash";
  const hasHouse = lines.some(x => x.l.assetType === "property");
  if (!await t29Confirm(`Buy ${t.units} item${t.units === 1 ? "" : "s"} from your classmates for ${fmtMoney(t.total)} in total, paid ${how}?${hasHouse && card ? " (Houses are always paid in cash.)" : ""}`)) return;

  MC_BUSY = true; MC_MSG = ""; MC_NOTE = ""; mcRender();
  const done = []; let err = "";
  try {
    for (const { l, qty } of lines.slice().sort((a, b) => b.l.price * b.qty - a.l.price * a.qty)) {
      const pay = card && l.assetType !== "property" ? { useCard: true, split: MP_PAY.split, cardMax: MP_PAY.cardMax } : {};
      let n = 0;
      while (n < qty) {
        const r = await buyListing(CURRENT.username, CURRENT.classCode, l.id, pay, l.price);
        if (!r || !r.ok) { err = `${l.name}: ${(r && r.error) || "The purchase didn't go through."}`; break; }
        n++;
      }
      if (n) { done.push({ name: l.name, qty: n, spent: mcRound(l.price * n) }); MC[l.id] = (MC[l.id] || 0) - n; if (MC[l.id] < 1) delete MC[l.id]; }
      if (err) break;
    }
  } catch (e) { console.error("Trade Centre checkout failed", e); err = "Something went wrong. Please try again."; }
  mcSave();
  const bought = done.reduce((s, x) => s + x.qty, 0);
  if (done.length) MC_DONE = { lines: done, total: mcRound(done.reduce((s, x) => s + x.spent, 0)) };
  if (err) MC_MSG = `<div class="error-msg">${bought ? `Bought ${bought} of ${t.units} items. ` : ""}${esc(err)}</div>`;
  MC_BUSY = false;
  await render(true);
}

/* ---- drawer ---- */
function mcOpen() {
  MC_OPEN = true; mcRender();
  mcEl("mcOverlay").classList.add("open"); mcEl("mcDrawer").classList.add("open");
  document.body.classList.add("mc-lock");
  setTimeout(() => { const c = mcEl("mcClose"); if (c) c.focus({ preventScroll: true }); }, 60);
}
function mcClose() {
  MC_OPEN = false; MC_DONE = null; MC_MSG = ""; MC_NOTE = "";
  mcEl("mcOverlay").classList.remove("open"); mcEl("mcDrawer").classList.remove("open");
  document.body.classList.remove("mc-lock");
  mcRender();
  const f = mcEl("mcFab"); if (f && f.style.display !== "none") f.focus({ preventScroll: true });
}

function mcInjectCss() {
  const st = document.createElement("style");
  st.textContent = `
.mc-slot{display:contents}
.mc-fab{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:2000;display:inline-flex;align-items:center;gap:10px;width:auto;margin:0;padding:12px 18px;border:0;border-radius:var(--sw-l,23px 3px 23px 3px / 18px 3px 18px 3px);background:#e3a72f;color:#1f2b44;font:inherit;font-weight:600;cursor:pointer;box-shadow:var(--shadow-pop);transition:transform .15s}
.mc-fab:hover{transform:translateY(-2px)}
.mc-fab:focus-visible,.mc-x:focus-visible{outline:3px solid rgba(227,167,47,.6);outline-offset:2px}
.mc-fab.bump{animation:mcBump .45s}
@keyframes mcBump{30%{transform:scale(1.12)}60%{transform:scale(.97)}}
.mc-count{min-width:24px;height:24px;padding:0 7px;border-radius:12px;background:#1f2b44;color:#fff;font-size:var(--fs-sm);display:inline-flex;align-items:center;justify-content:center}
.mc-overlay{position:fixed;inset:0;z-index:2001;background:rgba(15,20,32,.5);opacity:0;pointer-events:none;transition:opacity .22s}
.mc-overlay.open{opacity:1;pointer-events:auto}
.mc-drawer{position:fixed;top:0;right:0;bottom:0;z-index:2002;width:min(430px,100vw);display:flex;flex-direction:column;background:#fff;color:#1f2b44;box-shadow:var(--shadow-edge-end);transform:translateX(102%);transition:transform .28s cubic-bezier(.2,.8,.2,1);visibility:hidden}
.mc-drawer.open{transform:none;visibility:visible}
html.dark-mode .mc-drawer{background:#1c2433;color:#eef1f7}
body.mc-lock{overflow:hidden}
.mc-head{display:flex;align-items:center;gap:10px;padding:16px 18px;padding-top:calc(16px + env(safe-area-inset-top,0px));border-bottom:1px solid rgba(128,128,128,.25)}
.mc-head h3{margin:0;flex:1;display:flex;align-items:center;gap:8px;font-size:1.2rem}
.mc-clear{width:auto;margin:0;background:none;border:0;font:inherit;font-size:var(--fs-md);color:inherit;opacity:.65;text-decoration:underline;cursor:pointer}
.mc-clear:hover{opacity:1}
.mc-x{width:36px;height:36px;margin:0;padding:0;border-radius:50%;border:1.5px solid rgba(128,128,128,.4);background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-x:hover{border-color:#e3a72f;background:rgba(227,167,47,.14)}
.mc-body{flex:1;overflow-y:auto;padding:4px 18px 16px;overscroll-behavior:contain}
.mc-note{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:rgba(227,167,47,.18);font-size:var(--fs-md)}
.mc-line{display:grid;grid-template-columns:1fr auto;gap:8px 12px;padding:14px 0;border-bottom:1px solid rgba(128,128,128,.2)}
.mc-name{font-weight:700;line-height:1.25;word-break:break-word}
.mc-unit{display:block;font-size:var(--fs-sm);font-weight:400;opacity:.65;margin-top:2px}
.mc-price{font-weight:800;text-align:right;white-space:nowrap}
.mc-ctl{justify-self:start;display:inline-flex;align-items:center;gap:4px;border:1.5px solid rgba(128,128,128,.35);border-radius:var(--sw-m,17px 2px 17px 2px / 13px 2px 13px 2px);padding:2px}
.mc-step{width:30px;height:30px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.mc-step:hover:not(:disabled){background:rgba(227,167,47,.25)}
.mc-step:disabled{opacity:.3;cursor:default}
.mc-q{min-width:26px;text-align:center;font-weight:700}
.mc-rm{width:auto;margin:0;justify-self:end;align-self:center;background:none;border:0;padding:4px 2px;font:inherit;font-size:var(--fs-md);color:#d8563f;cursor:pointer}
.mc-rm:hover{text-decoration:underline}
.mc-lnote{grid-column:1/-1;font-size:var(--fs-sm);opacity:.7}
.mc-paywrap{margin-top:16px}
.mc-paywrap .mkt-paybar{margin:0}
.mc-empty,.mc-done{text-align:center;padding:48px 10px 20px}
.mc-empty svg{opacity:.35}
.mc-empty h4,.mc-done h4{margin:12px 0 4px;font-size:1.1rem}
.mc-empty p,.mc-done p{margin:0 0 16px;opacity:.7;font-size:var(--fs-lg)}
.mc-check{width:64px;height:64px;margin:0 auto;border-radius:50%;background:#2e9d6a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.8rem;animation:mcPop .4s cubic-bezier(.2,1.4,.4,1)}
@keyframes mcPop{from{transform:scale(.3);opacity:0}}
.mc-dlist{list-style:none;margin:0 0 18px;padding:0;text-align:left;font-size:var(--fs-lg)}
.mc-dlist li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(128,128,128,.18)}
.mc-foot{padding:14px 18px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(128,128,128,.25);background:inherit}
.mc-row{display:flex;justify-content:space-between;gap:10px;font-size:var(--fs-lg);padding:2px 0}
.mc-total{font-size:1.2rem;font-weight:800;padding-top:8px;margin-top:6px;border-top:1px dashed rgba(128,128,128,.4)}
.mc-sub{font-size:var(--fs-sm);opacity:.7;margin:4px 0 10px}
.mc-checkout{width:100%;margin:6px 0 0;min-height:48px;font-size:1rem}
.mc-checkout:disabled{opacity:.5;cursor:not-allowed}
.mc-foot .error-msg{margin:8px 0 0}
@media (max-width:520px){.mc-fab{right:12px}}
@media (prefers-reduced-motion:reduce){.mc-drawer,.mc-overlay,.mc-fab,.mc-check{transition:none;animation:none}}`;
  document.head.appendChild(st);
}

function mcBuildDom() {
  mcInjectCss();
  const fab = document.createElement("button");
  fab.type = "button"; fab.id = "mcFab"; fab.className = "mc-fab"; fab.style.display = "none"; fab.setAttribute("aria-label", "Open cart"); fab.onclick = mcOpen;
  fab.innerHTML = `${icon("cart", 20)}<span>Cart</span><span class="mc-count" id="mcFabCount">0</span><span id="mcFabTotal"></span>`;
  const ov = document.createElement("div"); ov.id = "mcOverlay"; ov.className = "mc-overlay"; ov.onclick = mcClose;
  const dr = document.createElement("aside"); dr.id = "mcDrawer"; dr.className = "mc-drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true"); dr.setAttribute("aria-label", "Your cart");
  dr.innerHTML = `
    <div class="mc-head"><h3>${icon("cart", 20)} Your cart</h3><button type="button" class="mc-clear" id="mcClearBtn" onclick="mcClear()">Clear</button><button type="button" class="mc-x" id="mcClose" aria-label="Close cart" onclick="mcClose()">×</button></div>
    <div class="mc-body"><div id="mcLines"></div><div class="mc-paywrap" id="mcPayWrap"><div class="mkt-paybar hidden" id="mcPay"></div></div></div>
    <div class="mc-foot" id="mcFoot"></div>`;
  document.body.append(fab, ov, dr);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && MC_OPEN) mcClose(); });
}

function mcRender() {
  if (IS_TEACHER || !ME || !CLS || !mcEl("mcDrawer")) return;
  const lines = mcLines(), t = mcTotals(lines), n = t.units, open = !!CLS.marketplace.enabled;
  const card = mktHasCard() && MP_PAY.useCard, split = card && MP_PAY.split;
  const fab = mcEl("mcFab"), body = mcEl("mcLines"), foot = mcEl("mcFoot"), wrap = mcEl("mcPayWrap");
  fab.style.display = (n || MC_OPEN) ? "" : "none";
  mcEl("mcFabCount").textContent = n;
  mcEl("mcFabTotal").textContent = n ? fmtMoney(t.total) : "";
  fab.setAttribute("aria-label", `Open cart, ${n} item${n === 1 ? "" : "s"}`);
  mcEl("mcClearBtn").style.display = n ? "" : "none";
  const note = MC_NOTE ? `<p class="mc-note">${esc(MC_NOTE)}</p>` : "";

  if (MC_DONE && !n) {
    wrap.style.display = "none";
    body.innerHTML = `<div class="mc-done"><div class="mc-check" aria-hidden="true">✓</div><h4>${MC_MSG ? "Part of your order went through" : "Purchase complete"}</h4>
      <p>${fmtMoney(MC_DONE.total)} spent with your classmates.</p>
      <ul class="mc-dlist">${MC_DONE.lines.map(l => `<li><span>${esc(l.name)}</span><strong>×${l.qty}</strong></li>`).join("")}</ul></div>`;
    foot.innerHTML = `${MC_MSG}<button type="button" class="btn gold mc-checkout" onclick="mcClose()">Continue shopping</button>`;
    return;
  }
  wrap.style.display = n ? "" : "none";
  if (!n) {
    body.innerHTML = `${note}<div class="mc-empty">${icon("cart", 48)}<h4>Your cart is empty</h4><p>Add listings from your classmates and pay for them all at once.</p></div>`;
    foot.innerHTML = `${MC_MSG}<button type="button" class="btn secondary mc-checkout" onclick="mcClose()">Keep browsing</button>`;
    return;
  }
  body.innerHTML = note + lines.map(({ l, qty: q }) => {
    const max = listingQuantity(l);
    return `<div class="mc-line">
      <div class="mc-name">${esc(l.name)}<span class="mc-unit">${fmtMoney(l.price)}${max > 1 ? " each" : ""} · from ${esc(nameOf(l.seller))}</span></div>
      <div class="mc-price">${fmtMoney(mcRound(l.price * q))}</div>
      ${max > 1 ? `<div class="mc-ctl" role="group" aria-label="Quantity of ${esc(l.name)}">
        <button type="button" class="mc-step" aria-label="Decrease quantity" ${q <= 1 ? "disabled" : ""} onclick="mcStep('${l.id}', -1)">−</button>
        <span class="mc-q">${q}</span>
        <button type="button" class="mc-step" aria-label="Increase quantity" ${q >= max ? "disabled" : ""} onclick="mcStep('${l.id}', 1)">+</button>
      </div>` : "<span></span>"}
      <button type="button" class="mc-rm" onclick="mcRemove('${l.id}')">Remove</button>
      ${max > 1 && q >= max ? `<div class="mc-lnote">That's all ${max} they have.</div>` : ""}
      ${card && l.assetType === "property" ? `<div class="mc-lnote">Houses are always paid in cash.</div>` : ""}
    </div>`;
  }).join("");

  // Can they afford it? Houses always come out of cash; everything else follows the "Pay with" choice.
  const cash = arrangedCashAvailable(ME, CLS), plan = card ? cardPlanById(CLS, ME.creditCard.planId) : null;
  const cardAvail = plan ? cardAvailable(ME.creditCard, plan) : 0;
  const other = mcRound(t.total - t.house);
  const needCash = mcRound(!card ? t.total : split ? t.house + Math.max(0, other - cardAvail) : t.house);
  const needCard = card && !split ? other : 0;
  const shortCash = mcRound(needCash - cash), shortCard = mcRound(needCard - cardAvail);
  const cashLabel = arrangedOverdraftLimit(ME) ? "cash and arranged overdraft" : "cash";
  const how = !card ? `Paying with ${cashLabel} · ${fmtMoney(cash)} available` : split ? `Paying part card, part ${cashLabel}` : `Paying by credit card · ${fmtMoney(cardAvail)} available`;
  let warn = "";
  if (!open) warn = "The Trade Centre is closed right now, so you can't check out.";
  else if (shortCard > 0.004) warn = `Your card can only cover ${fmtMoney(cardAvail)}. Turn on "Part card, part cash" or remove something.`;
  else if (shortCash > 0.004) warn = card ? `You're ${fmtMoney(shortCash)} short on cash (houses${split ? " and anything the card can't cover" : ""} are paid in cash). Remove something to check out.`
    : `You're ${fmtMoney(shortCash)} short. Remove something to check out.`;
  foot.innerHTML = `
    <div class="mc-row"><span>${n} item${n === 1 ? "" : "s"}</span><span>${fmtMoney(t.total)}</span></div>
    <div class="mc-row mc-total"><span>Total</span><span>${fmtMoney(t.total)}</span></div>
    <div class="mc-sub">${how}${n > 1 ? ". Items are bought one after another: if one can't be bought, the ones before it still go through and the rest stay in your cart." : ""}</div>
    ${warn ? `<div class="error-msg">${esc(warn)}</div>` : ""}${MC_MSG}
    <button type="button" class="btn gold mc-checkout" onclick="mcCheckout()" ${warn || MC_BUSY ? "disabled" : ""}>${MC_BUSY ? "Processing…" : `Check out · ${fmtMoney(t.total)}`}</button>`;
}
