/* ===================== The 29 World — Peer-to-peer marketplace =====================
   Students trading with each other at prices they set, next to (not
   instead of) the teacher's fixed-price store. Teacher view is settings +
   moderation; student view is sell / my listings / browse / sold prices.
   Every rule lives in data.js — this file is presentation only.
================================================================================ */
let CURRENT, IS_TEACHER;
let CLS = null, ME = null;
let NAMES = {};              // username -> display name, fetched once per page load
let FILTER = "all";
let OFFERING = null;         // listing id the student is currently typing an offer into

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const nameOf = u => NAMES[u] || u;
const ASSET_ICON = { store: "cart", vehicle: "car", property: "house" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("users", 26) + " Marketplace";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentPanel").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  if (!IS_TEACHER) {
    document.getElementById("iconListings").innerHTML = icon("cart", 30);
    document.getElementById("iconEarned").innerHTML = icon("coin", 30);
    document.getElementById("iconForSale").innerHTML = icon("users", 30);
  }

  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue")
  ]);

  // Names are only needed for "listed by X" — one roster fetch per page
  // load, not per render, since a roster read costs one Firestore read per
  // student in the class.
  const cls = await getClassCached(u.classCode);
  const roster = await getClassStudents(u.classCode, cls);
  roster.forEach(s => { NAMES[s.username] = s.name; });
  const teacher = await getUserCached(cls.teacher);
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
  document.getElementById("pageIntro").textContent =
    "Students trading with each other at prices they set — price discovery, negotiation, and everything you decide to allow.";
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
        <div class="mkt-sell-name">${icon(ASSET_ICON[l.assetType] || "cart", 15)} ${esc(l.name)}</div>
        <div class="muted-small">Listed by ${esc(nameOf(l.seller))} at <strong>${fmtMoney(l.price)}</strong> — originally ${fmtMoney(l.refPrice)}${l.description ? ` · "${esc(l.description)}"` : ""}</div>
      </div>
      <button class="btn small mint" onclick="approve('${l.id}', true)">${icon("plus", 13)} Approve</button>
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
  document.getElementById("settingsMsg").innerHTML = `<div class="success-msg">Marketplace settings saved.</div>`;
  await render();
}

async function approve(id, yes) {
  const reason = yes ? "" : (prompt("Tell the student why (optional):") || "");
  await decideListing(CURRENT.classCode, id, yes, reason);
  await render();
}

async function pullListing(id) {
  const reason = prompt("Why are you taking this listing down? (shown to the student)") || "Removed by your teacher";
  await teacherRemoveListing(CURRENT.classCode, id, reason);
  await render();
}

/* ================= Student ================= */
function renderStudent() {
  const mp = CLS.marketplace;
  const banner = document.getElementById("closedBanner");
  if (!mp.enabled) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<p style="margin:0;"><strong>The marketplace is closed right now</strong><br>Your teacher has switched off trading between students. You can still buy from the class Store.</p>`;
  } else {
    banner.classList.add("hidden");
  }

  const listings = CLS.listings || [];
  const mine = listings.filter(l => l.seller === ME.username && listingIsOpen(l));
  const others = listings.filter(l => l.status === "active" && l.seller !== ME.username);
  const sold = listings.filter(l => l.status === "sold").sort((a, b) => (b.soldTs || 0) - (a.soldTs || 0));
  const earned = sold.filter(l => l.seller === ME.username)
    .reduce((sum, l) => sum + (l.soldPrice - (l.fee || 0)), 0);

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
    return `<tr>
      <td>${icon(ASSET_ICON[l.assetType] || "cart", 13)} ${esc(l.name)}<br><span class="muted-small">${esc(nameOf(l.seller))} → ${esc(nameOf(l.soldTo))}</span></td>
      <td>${fmtMoney(l.refPrice)}</td>
      <td><strong>${fmtMoney(l.soldPrice)}</strong></td>
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
    (mp.requireApproval ? " Your teacher approves each listing before it goes live." : "");

  empty.classList.toggle("hidden", assets.length > 0);
  box.innerHTML = assets.map(a => {
    const key = a.assetType + "-" + a.assetId;
    if (a.blocked) {
      return `<div class="mkt-sell-row">
        <div class="grow">
          <div class="mkt-sell-name">${icon(ASSET_ICON[a.assetType], 15)} ${esc(a.name)}</div>
          <div class="muted-small">${esc(a.blocked)}</div>
        </div>
      </div>`;
    }
    const b = marketplacePriceBounds(CLS, a.refPrice);
    return `<div class="mkt-sell-row">
      <div class="grow">
        <div class="mkt-sell-name">${icon(ASSET_ICON[a.assetType], 15)} ${esc(a.name)}${a.count > 1 ? ` <span class="badge navy">×${a.count}</span>` : ""}</div>
        <div class="muted-small">Originally ${fmtMoney(a.refPrice)}${a.note ? ` · ${esc(a.note)}` : ""}</div>
        <div class="mkt-band">Allowed price: ${bandText(a.refPrice)}</div>
      </div>
      <input type="number" id="price-${key}" min="0" step="0.5" value="${b.min > 0 ? b.min : Math.round(a.refPrice * 0.9 * 100) / 100}" style="max-width:120px;" aria-label="Your price for ${esc(a.name)}">
      <input type="text" id="desc-${key}" placeholder="Say something about it (optional)" style="max-width:230px;" aria-label="Description">
      <button class="btn small gold" onclick="listIt('${a.assetType}','${esc(a.assetId)}')" ${atCap ? "disabled" : ""}>${icon("cart", 13)} ${atCap ? "Listing limit reached" : "List it"}</button>
    </div>`;
  }).join("");
}

async function listIt(assetType, assetId) {
  const key = assetType + "-" + assetId;
  const res = await createListing(CURRENT.username, CURRENT.classCode, {
    assetType, assetId,
    price: document.getElementById("price-" + key).value,
    description: document.getElementById("desc-" + key).value
  });
  document.getElementById("sellMsg").innerHTML = res.ok
    ? `<div class="success-msg">Listed${CLS.marketplace.requireApproval ? " — waiting for your teacher to approve it." : "! It's live in the marketplace now."}</div>`
    : `<div class="error-msg">${esc(res.error)}</div>`;
  await render();
}

/* ---------------- One listing card, shared by all three views ---------------- */
function listingCardHtml(l, opts) {
  const mine = !!opts.mine;
  const teacher = !!opts.teacher;
  const openOffers = (l.offers || []).filter(o => o.status === "open");
  const myOffer = openOffers.find(o => o.buyer === (ME && ME.username));
  const diffPct = l.refPrice ? Math.round(((l.price - l.refPrice) / l.refPrice) * 100) : 0;

  let actions = "";
  if (teacher) {
    actions = `<button class="btn small coral" onclick="pullListing('${l.id}')">${icon("trash", 13)} Take down</button>`;
  } else if (mine) {
    actions = `<button class="btn small secondary" onclick="cancelMine('${l.id}')">${icon("trash", 13)} Cancel listing</button>`;
  } else if (CLS.marketplace.enabled) {
    actions = `<button class="btn small gold" onclick="buyIt('${l.id}')">${icon("cart", 13)} Buy for ${fmtMoney(l.price)}</button>`;
    if (CLS.marketplace.allowOffers) {
      actions += myOffer
        ? `<button class="btn small secondary" onclick="withdraw('${l.id}','${myOffer.id}')">Withdraw my ${fmtMoney(myOffer.amount)} offer</button>`
        : `<button class="btn small secondary" onclick="toggleOffer('${l.id}')">${icon("handshake", 13)} Make an offer</button>`;
    }
  }

  const offerForm = (!mine && !teacher && OFFERING === l.id) ? `
    <div class="mkt-offer-list">
      <label for="offer-${l.id}">Your offer (allowed: ${bandText(l.refPrice)})</label>
      <input id="offer-${l.id}" type="number" min="0" step="0.5" value="${Math.round(l.price * 0.8 * 100) / 100}">
      <input id="offernote-${l.id}" type="text" placeholder="Why should they take it? (optional)">
      <div class="row-flex" style="gap:8px;margin-top:10px;">
        <button class="btn small gold" onclick="sendOffer('${l.id}')">Send offer</button>
        <button class="btn small secondary" onclick="toggleOffer(null)">Cancel</button>
      </div>
    </div>` : "";

  const offerList = (mine && openOffers.length) ? `
    <div class="mkt-offer-list">
      <p class="muted-small" style="margin:0 0 6px;"><strong>${openOffers.length} ${openOffers.length === 1 ? "offer" : "offers"}</strong></p>
      ${openOffers.sort((a, b) => b.amount - a.amount).map(o => `
        <div class="mkt-offer">
          <span><span class="mkt-offer-amt">${fmtMoney(o.amount)}</span> <span class="muted-small">from ${esc(nameOf(o.buyer))}</span></span>
          <span class="row-flex" style="gap:6px;">
            <button class="btn small mint" onclick="accept('${l.id}','${o.id}')">Accept</button>
            <button class="btn small secondary" onclick="decline('${l.id}','${o.id}')">Decline</button>
          </span>
          ${o.note ? `<span class="mkt-offer-note">"${esc(o.note)}"</span>` : ""}
        </div>`).join("")}
    </div>` : "";

  return `
    <div class="mkt-listing${mine ? " mine" : ""}" id="lst-${l.id}">
      <h4>${icon(ASSET_ICON[l.assetType] || "cart", 19)}${esc(l.name)}</h4>
      ${l.description ? `<p class="mkt-desc">${esc(l.description)}</p>` : ""}
      <div class="mkt-price">
        <span class="now">${fmtMoney(l.price)}</span>
        <span class="ref">store price ${fmtMoney(l.refPrice)} · <span class="${diffPct > 0 ? "ticker-down" : "ticker-up"}">${diffPct > 0 ? "+" : ""}${diffPct}%</span></span>
      </div>
      <div class="mkt-seller">
        ${mine ? `<span class="mkt-status ${l.status}">${l.status === "pending" ? "Awaiting approval" : "Live"}</span>`
               : `${icon("users", 13)} ${esc(nameOf(l.seller))}`}
        ${!mine && openOffers.length ? `<span class="muted-small">· ${openOffers.length} offer${openOffers.length === 1 ? "" : "s"} in</span>` : ""}
        ${teacher ? `<span class="muted-small">· ${esc(nameOf(l.seller))}</span>` : ""}
      </div>
      <div class="mkt-actions">${actions}</div>
      ${offerForm}${offerList}
      <div id="msg-${l.id}"></div>
    </div>`;
}

function toggleOffer(id) { OFFERING = (OFFERING === id) ? null : id; renderStudent(); }

async function buyIt(id) {
  const l = (CLS.listings || []).find(x => x.id === id);
  if (!l) return;
  if (!confirm(`Buy "${l.name}" from ${nameOf(l.seller)} for ${fmtMoney(l.price)}?`)) return;
  const res = await buyListing(CURRENT.username, CURRENT.classCode, id);
  await render();
  const box = document.getElementById("msg-" + id);
  if (box) box.innerHTML = res.ok ? `<div class="success-msg">Bought!</div>` : `<div class="error-msg">${esc(res.error)}</div>`;
  else if (!res.ok) alert(res.error);
}

async function sendOffer(id) {
  const res = await makeOffer(CURRENT.username, CURRENT.classCode, id,
    document.getElementById("offer-" + id).value,
    document.getElementById("offernote-" + id).value);
  if (res.ok) OFFERING = null;
  await render();
  const box = document.getElementById("msg-" + id);
  if (box) box.innerHTML = res.ok ? `<div class="success-msg">Offer sent — the seller will see it.</div>` : `<div class="error-msg">${esc(res.error)}</div>`;
  else if (!res.ok) alert(res.error);
}

async function withdraw(listingId, offerId) {
  await setOfferStatus(CURRENT.username, CURRENT.classCode, listingId, offerId, "withdrawn");
  await render();
}
async function decline(listingId, offerId) {
  await setOfferStatus(CURRENT.username, CURRENT.classCode, listingId, offerId, "declined");
  await render();
}
async function accept(listingId, offerId) {
  if (!confirm("Accept this offer and hand the item over?")) return;
  const res = await acceptOffer(CURRENT.username, CURRENT.classCode, listingId, offerId);
  await render();
  if (!res.ok) alert(res.error);
}
async function cancelMine(id) {
  if (!confirm("Take this listing down?")) return;
  await cancelListing(CURRENT.username, CURRENT.classCode, id);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
