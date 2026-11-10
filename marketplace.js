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
    document.getElementById("iconListings").innerHTML = icon("tag", 30);
    document.getElementById("iconEarned").innerHTML = icon("coin", 30);
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

  await render();
}

async function render() {
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  ME = Object.assign({ username: CURRENT.username }, me);
  CLS = withNewModuleDefaults(cls);
  if (IS_TEACHER) renderTeacher();
  else renderStudent();
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
  await render();
}

async function approve(id, yes) {
  const reason = yes ? "" : (await t29Prompt("Tell the student why (optional):", "", { confirmText: "Send", placeholder: "Reason (optional)" }) || "");
  await decideListing(CURRENT.classCode, id, yes, reason);
  await render();
}

async function pullListing(id) {
  const reason = await t29Prompt("Why are you taking this listing down? (shown to the student)", "", { confirmText: "Take it down", danger: true, placeholder: "Reason" }) || "Removed by your teacher";
  await teacherRemoveListing(CURRENT.classCode, id, reason);
  await render();
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
      <button class="btn small gold" onclick="listIt('${a.assetType}','${esc(a.assetId)}')" ${atCap ? "disabled" : ""}>${atCap ? "Listing limit reached" : "List it"}</button>
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
  await render();
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
    actions = `<button class="btn small gold" onclick="buyIt('${l.id}')">${qty > 1 ? "Buy 1" : "Buy"} for ${fmtMoney(l.price)}</button>`;
    if (CLS.marketplace.allowOffers) {
      actions += (myOffer && myOffer.status === "countered")
        ? `<button class="btn small mint" onclick="acceptCounterUi('${l.id}','${myOffer.id}')">Accept ${fmtMoney(myOffer.counter.amount)}${offerQuantity(myOffer) > 1 ? " each" : ""}</button><button class="btn small secondary" onclick="decline('${l.id}','${myOffer.id}')">Decline counter</button>`
        : myOffer
        ? `<button class="btn small secondary" onclick="withdraw('${l.id}','${myOffer.id}')">Withdraw my ${fmtMoney(myOffer.amount)}${offerQuantity(myOffer) > 1 ? " × " + offerQuantity(myOffer) : ""} offer</button>`
        : `<button class="btn small secondary" onclick="toggleOffer('${l.id}')">${icon("swap", 13)} Make an offer</button>`;
    }
  }

  const offerForm = (!mine && !teacher && OFFERING === l.id) ? `
    <div class="mkt-offer-list">
      <label for="offer-${l.id}">Your price${qty > 1 ? " for ONE" : ""} (allowed: ${bandText(l.refPrice)})</label>
      <input id="offer-${l.id}" type="number" min="0" step="0.01" value="${Math.round(l.price * 0.8 * 100) / 100}" oninput="offerTotal('${l.id}')">
      ${qty > 1 ? `<label for="offerqty-${l.id}" style="margin-top:8px;display:block;">How many at that price (1–${qty})</label>
      <input id="offerqty-${l.id}" type="number" min="1" max="${qty}" step="1" value="1" oninput="offerTotal('${l.id}')">` : ""}
      <div class="muted-small" id="offertotal-${l.id}" style="margin:6px 0;">Total: <strong>${fmtMoney(Math.round(l.price * 0.8 * 100) / 100)}</strong></div>
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
  .mkt-pb-seg{display:inline-flex;gap:4px;padding:4px;border-radius:14px;background:rgba(127,127,127,.15)}
  .mkt-pb-seg button{border:0;background:transparent;color:inherit;border-radius:10px;padding:8px 18px;cursor:pointer;font:inherit;font-weight:700;display:flex;flex-direction:column;align-items:center;line-height:1.15;opacity:.7}
  .mkt-pb-seg button small{font-size:.72em;font-weight:600}
  .mkt-pb-seg button.on{background:var(--card);color:var(--ink,#1f2b44);opacity:1;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  .mkt-pb-chips{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .mkt-chip{font-size:.8em;font-weight:700;padding:4px 12px;border-radius:999px;border:1px solid rgba(127,127,127,.35)}
  .mkt-chip.mint{background:rgba(46,184,120,.15);border-color:rgba(46,184,120,.45)}
  .mkt-pb-split{flex:1;min-width:220px}
  .mkt-pb-note{flex-basis:100%;margin:0}`;
  document.head.appendChild(st);
}
function mktPayBarRender() {
  const el = document.getElementById("mktPayBar");
  if (!el) return;
  if (!mktHasCard()) { el.classList.add("hidden"); MP_PAY.useCard = false; MP_PAY.split = false; MP_PAY.init = false; return; }
  mktInjectCss();
  if (!MP_PAY.init) {
    let d = ME.mpPayDefault;
    try { d = localStorage.getItem("anw_mpPay_" + CURRENT.username) || d; } catch (e) { /* ignore */ }
    MP_PAY.useCard = d === "card"; MP_PAY.init = true;
  }
  const plan = cardPlanById(CLS, ME.creditCard.planId);
  const avail = cardAvailable(ME.creditCard, plan);
  const useCard = MP_PAY.useCard;
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
      ${MP_PAY.split ? `<div style="margin-top:6px;">Card covers up to $<input id="mktCardMax" type="number" min="0.01" step="0.01" style="width:100px" value="${esc(MP_PAY.cardMax)}" placeholder="all it can" onchange="mktSetCardMax(this.value)"></div>` : ""}
      <div class="muted-small">Splitting works on purchases of ${fmtMoney(cardSettings(CLS).splitMin)} or more, or whenever the card can't cover it all.</div></div>` : ""}
    <p class="muted-small mkt-pb-note">This is also your default account: when a classmate accepts one of your offers, it comes out of ${useCard ? "your credit card" : "your cash"}. Houses are always paid in cash.</p>`;
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
  await render();
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
  await render();
  const box = document.getElementById("msg-" + id);
  if (box) box.innerHTML = res.ok ? `<div class="success-msg">Offer sent. The seller will be notified.</div>` : `<div class="error-msg">${esc(res.error)}</div>`;
  else if (!res.ok) alert(res.error);
}

async function withdraw(listingId, offerId) {
  await setOfferStatus(CURRENT.username, CURRENT.classCode, listingId, offerId, "withdrawn");
  await render();
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
  await render();
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
  await render();
  if (!res.ok) alert(res.error);
}
async function sendCounter(listingId, offerId) {
  const res = await counterOffer(CURRENT.username, CURRENT.classCode, listingId, offerId,
    document.getElementById("counter-" + offerId).value, document.getElementById("counternote-" + offerId).value);
  if (res.ok) { COUNTERING = null; await render(); return; }
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
  await render();
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
  await render();
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
  await cancelListing(CURRENT.username, CURRENT.classCode, id);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
