let CURRENT, IS_TEACHER, EDITING_ID = null, EDITING_NPC_ID = null;
let MORTGAGE_SETTINGS_CLS = null; // last-loaded class doc, used to preview the force-due toggle before saving

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

// Shown next to every action that actually moves a student into a new
// home (choosing to live in an owned property, claiming a classmate's
// sublet, or renting an NPC listing) so the cost is visible right where
// they're about to trigger it, not just buried in the confirm() prompt or
// the teacher's settings panel. cls.movingCost is a single class-wide
// value, so this reads the same wherever it's shown.
function movingCostNote(cls) {
  const cost = Number(cls && cls.movingCost) || 0;
  return `<p class="muted-small">${icon("send", 12)} Moving cost: <strong>${cost > 0 ? fmtMoney(cost) : "Free"}</strong> &middot; you can only move house once a day.</p>`;
}

// Shows a student browsing a listing what owning it (and, on top of that,
// living in it) would do to their lifestyle rating — the owning bonus
// applies as soon as it's bought, the living bonus is extra on top if they
// then choose to live in it rather than rent it out. Note: for a listing
// with several units, every unit shares the same comfort and living-bonus
// values, so this preview is the same regardless of which unit gets bought.
function lifestylePreviewLine(cls, p) {
  const preview = propertyLifestylePreview(cls, p);
  if (!preview) return "";
  return `<p class="muted-small">Owning this: +${preview.ownPoints} lifestyle points. Living in it instead of renting it out: +${preview.livingBonusPoints} more on top (${preview.livingBonusStars} bonus star${preview.livingBonusStars === 1 ? "" : "s"} &times; ${preview.weight} pts/star).</p>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("house", 26) + " Property";
  document.getElementById("hMortgageSettings").innerHTML = icon("house", 18) + " Mortgage settings";
  document.getElementById("hMortgageDay").innerHTML = icon("calendar", 15) + " Weekly due day";
  document.getElementById("labMortgageDay").innerHTML = "Due day";
  document.getElementById("saveMortgageDayBtn").innerHTML = icon("calendar", 14) + " Save mortgage day";
  document.getElementById("hMortgageForceDue").innerHTML = icon("send", 15) + " Manual override";
  document.getElementById("saveMortgageForceDueBtn").innerHTML = icon("send", 14) + " Save";
  document.getElementById("hRentalSettings").innerHTML = icon("users", 18) + " Renting to classmates";
  document.getElementById("saveRentalSettingsBtn").innerHTML = icon("send", 14) + " Save settings";
  document.getElementById("hAddNpc").innerHTML = icon("building", 18) + " Add an NPC property";
  document.getElementById("addNpcBtn").innerHTML = icon("plus", 15) + " Add NPC property";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
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
  document.getElementById("mortgagePanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("rentalsPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("npcPanel").classList.toggle("hidden", !IS_TEACHER);
  paintChrome();
  // These 7 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 7 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processDailyLifeAllowance(u.classCode), "processDailyLifeAllowance"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processPropertyRent(u.classCode), "processPropertyRent"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
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
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

// Groups the flat list of per-unit property records into listings (all
// units sharing a groupId — see data.js). Properties saved before this
// feature existed have no groupId, so they fall back to being their own
// group of 1, exactly as before.
function groupProperties(props) {
  const order = [];
  const byGroup = new Map();
  props.forEach(p => {
    const gid = p.groupId || p.id;
    if (!byGroup.has(gid)) { byGroup.set(gid, []); order.push(gid); }
    byGroup.get(gid).push(p);
  });
  return order.map(gid => byGroup.get(gid));
}

async function render() {
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  const props = cls.properties || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  if (IS_TEACHER) {
    populateMortgageSettings(cls);
    populateRentalSettings(cls);
    renderPendingSublets(cls, nameOf);
    renderNpcListings(cls, nameOf);
  } else {
    renderMyRentedHome(cls, me, nameOf);
    renderAvailableSublets(cls, me, nameOf);
    renderAvailableNpcRentals(cls, me, nameOf);
  }

  const list = document.getElementById("propList");
  list.innerHTML = "";
  document.getElementById("noProps").classList.toggle("hidden", props.length > 0);

  const groups = groupProperties(props);
  // Students see their own home(s) first — everything else keeps its
  // original (teacher-set) order after that. Array.sort is stable, so this
  // only ever moves "owned by me" groups up, never reshuffles the rest.
  // Teachers never own a unit, so this is a no-op for the teacher view.
  if (!IS_TEACHER) {
    groups.sort((a, b) => {
      const aMine = a.some(u => u.owner === me.username) ? 0 : 1;
      const bMine = b.some(u => u.owner === me.username) ? 0 : 1;
      return aMine - bMine;
    });
  }

  groups.forEach(units => {
    const p = units[0]; // shared listing fields (name/price/comfort/etc) come from any unit
    const gid = p.groupId || p.id;
    const owned = units.filter(u => u.owner);
    const available = units.filter(u => !u.owner);
    const myUnit = units.find(u => u.owner === me.username);

    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("house", 20)}${p.name} ${myUnit ? '<span class="badge mint">Your home</span>' : ""}</h4>
          <p>${p.description || "No description provided."}</p>
          <p>${comfortStars(p.comfort)} comfort</p>
          ${lifestylePreviewLine(cls, p)}
          <p>${priceWithLifeDiscount(me, "property", p.price)} ${p.mortgageWeeks > 0 ? `&middot; mortgage available over ${p.mortgageWeeks} weeks, due ${DAY_FULL[cls.mortgageDay || "Fri"]}s${p.mortgageInterestRate > 0 ? ` (+${p.mortgageInterestRate}%/week interest)` : ""}` : "&middot; cash purchase only"}
            ${p.rentPerWeek > 0 ? `&middot; rentable for ${fmtMoney(p.rentPerWeek)}/week` : ""}</p>
          <p class="muted-small">${units.length > 1 ? `${available.length} of ${units.length} available` : (available.length > 0 ? "Available" : `Owned by ${nameOf(owned[0].owner)}`)}</p>
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `<button class="btn small secondary" onclick="editProp('${p.id}')">${icon("plus", 13)} Edit</button><button class="btn small coral" onclick="deleteProp('${p.id}')">${icon("trash", 13)} Remove</button>`
            : (!myUnit && available.length > 0
                ? `<button class="btn small gold" onclick="buyOutright('${gid}')">Buy cash</button>
                   ${p.mortgageWeeks > 0 ? `<button class="btn small secondary" onclick="buyFinanced('${gid}')">Finance (10% deposit)</button>` : ""}`
                : "")}
        </div>
      </div>
      <div id="msg-${gid}"></div>
      ${owned.filter(u => IS_TEACHER || u.owner === me.username)
             .map(u => ownedUnitBlock(u, u.owner === me.username, cls, nameOf)).join("")}
    `;
    list.appendChild(div);
  });
}

// Renders one owned unit's status/actions within a listing card — mortgage
// info, default warning, occupancy choice, and (teacher-only / owner-only)
// sell-back controls. Each owned unit still tracks its own mortgage and
// occupancy independently even when several students own units from the
// same listing.
function ownedUnitBlock(p, isMine, cls, nameOf) {
  const who = isMine ? "You" : nameOf(p.owner);
  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p class="muted-small"><strong>${who}</strong> ${p.mortgage ? `— mortgage: ${fmtMoney(p.mortgage.weeklyPayment)}/week base${p.mortgage.interestRate > 0 ? ` + ${p.mortgage.interestRate}% interest on the balance still owed (shrinks each week)` : ""}, ${p.mortgage.weeksLeft} week${p.mortgage.weeksLeft === 1 ? "" : "s"} left, due ${DAY_FULL[cls.mortgageDay || "Fri"]}` : ""}</p>
      ${isMine && p.mortgage ? mortgagePayBlock(p, cls) : ""}
      ${occupancyBlock(p, isMine, cls, nameOf)}
      <div class="row-flex" style="gap:8px;margin-top:6px;">
        ${IS_TEACHER ? `<button class="btn small secondary" onclick="forceSell('${p.id}')">Sell back (${who})</button>` : (isMine ? `<button class="btn small secondary" onclick="sellMine('${p.id}')">Sell back</button>` : "")}
      </div>
    </div>`;
}

// Renders the "living in it / rented out / rented to a classmate" status +
// choice for an owned property. Only the owner sees the choice controls —
// everyone else (only ever the teacher — students never see another
// student's owned-unit card, see the `owned.filter` in render() above) just
// sees a summary of what's currently going on with it.
function occupancyBlock(p, isMine, cls, nameOf) {
  const pr = (cls && cls.propertyRentals) || {};
  const canSublet = pr.enabled && p.rentPerWeek > 0;
  const preview = propertyLifestylePreview(cls, p);
  const livingBonusPts = preview ? preview.livingBonusPoints : 0;

  if (!isMine) {
    if (p.occupancy === "living") return `<p class="muted-small">${icon("house", 13)} Owner is living here.</p>`;
    if (p.occupancy === "rented") return `<p class="muted-small">This property is currently rented out.</p>`;
    if (p.occupancy === "sublet" && p.sublet) return subletStatusForTeacher(p, nameOf);
    return "";
  }

  if (p.occupancy === "living") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("house", 14)} You're living here</strong> — your lifestyle rating gets a +${livingBonusPts} bonus (property category) while you live in it. You're not collecting rent.</p>
        <div class="row-flex" style="gap:8px;flex-wrap:wrap;">
          ${p.rentPerWeek > 0 ? `<button class="btn small secondary" onclick="chooseOccupancy('${p.id}','rented')">Rent it out instead</button>` : ""}
          ${canSublet ? `<button class="btn small secondary" onclick="showSubletForm('${p.id}')">Rent it to a classmate instead</button>` : ""}
        </div>
        ${!p.rentPerWeek ? `<p class="muted-small">Your teacher hasn't set a rent amount for this property, so it can't be rented out yet.</p>` : ""}
        <div id="subletForm-${p.id}"></div>
      </div>`;
  }
  if (p.occupancy === "rented") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("coin", 14)} Rented out</strong> — you're earning ${fmtMoney(p.rentPerWeek)}/week, paid every ${DAY_FULL[p.rentDay || "Fri"]}. You're not getting the living-in-it lifestyle bonus.</p>
        ${movingCostNote(cls)}
        <div class="row-flex" style="gap:8px;flex-wrap:wrap;">
          <button class="btn small secondary" onclick="chooseOccupancy('${p.id}','living')">Move in instead</button>
          ${canSublet ? `<button class="btn small secondary" onclick="showSubletForm('${p.id}')">Rent it to a classmate instead</button>` : ""}
        </div>
        <div id="subletForm-${p.id}"></div>
      </div>`;
  }
  if (p.occupancy === "sublet" && p.sublet) {
    return subletStatusForOwner(p, cls, nameOf);
  }
  // Owned but no choice made yet — explain the consequences of all
  // available options up front before the student picks one.
  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p><strong>Live in it, rent it out, or rent it to a classmate?</strong></p>
      <p class="muted-small">Live in it: no rent income, but +${livingBonusPts} to your lifestyle rating (property category) while you live there.<br>
      Rent it out: ${p.rentPerWeek > 0 ? `${fmtMoney(p.rentPerWeek)}/week, paid every ${DAY_FULL[p.rentDay || "Fri"]}` : "your teacher hasn't set a rent amount yet"} — but no lifestyle bonus, only the property's base comfort rating counts.<br>
      ${canSublet ? `Rent it to a classmate: you set the price and a minimum lease length yourself, and get real weekly rent paid by whoever moves in — also no living-in-it lifestyle bonus for you.<br>` : ""}
      You can change your mind at any time.</p>
      ${movingCostNote(cls)}
      <div class="row-flex" style="gap:8px;flex-wrap:wrap;">
        <button class="btn small gold" onclick="chooseOccupancy('${p.id}','living')">Live in it</button>
        ${p.rentPerWeek > 0 ? `<button class="btn small secondary" onclick="chooseOccupancy('${p.id}','rented')">Rent it out</button>` : ""}
        ${canSublet ? `<button class="btn small secondary" onclick="showSubletForm('${p.id}')">Rent to a classmate</button>` : ""}
      </div>
      <div id="subletForm-${p.id}"></div>
    </div>`;
}

// The inline "list it for rent" form — price + minimum lease length, both
// bounded by the teacher's settings. Shown on demand (showSubletForm)
// rather than always, so the plain living/rented choice isn't crowded out
// for classes that never turn this feature on.
function showSubletForm(id) {
  const box = document.getElementById(`subletForm-${id}`);
  if (!box) return;
  if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = "0"; return; }
  box.dataset.open = "1";
  box.innerHTML = `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <div class="grid grid-2">
        <div>
          <label for="subletPrice-${id}">Weekly rent to charge</label>
          <input id="subletPrice-${id}" type="number" min="0" step="0.01">
        </div>
        <div>
          <label for="subletWeeks-${id}">Minimum lease length (weeks)</label>
          <input id="subletWeeks-${id}" type="number" min="1" step="1" value="1">
        </div>
      </div>
      <p class="muted-small" id="subletHint-${id}"></p>
      <button class="btn small gold" onclick="createSubletClick('${id}')">${icon("send", 13)} List it</button>
      <div id="subletFormMsg-${id}"></div>
    </div>`;
}
async function createSubletClick(id) {
  const price = document.getElementById(`subletPrice-${id}`).value;
  const weeks = document.getElementById(`subletWeeks-${id}`).value;
  const res = await createSublet(CURRENT.username, CURRENT.classCode, id, price, weeks);
  const box = document.getElementById(`subletFormMsg-${id}`);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}

// What the OWNER sees for their own property once it's set to "sublet" —
// covers all three sublet states: still pending teacher approval, actively
// searching for a tenant, or already occupied.
function subletStatusForOwner(p, cls, nameOf) {
  const s = p.sublet;
  if (s.status === "pending") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("send", 14)} Waiting for teacher approval</strong> — listed at ${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum lease. It'll be visible to classmates once approved.</p>
        <button class="btn small secondary" onclick="cancelSubletClick('${p.id}')">Withdraw listing</button>
      </div>`;
  }
  if (s.status === "rejected") {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("house", 14)} Listing declined by your teacher</strong>${s.rejectReason ? `: ${s.rejectReason}` : "."}</p>
        <button class="btn small secondary" onclick="cancelSubletClick('${p.id}')">Remove listing</button>
      </div>`;
  }
  if (!s.tenant) {
    return `
      <div class="card" style="margin-top:8px;padding:10px 12px;">
        <p><strong>${icon("users", 14)} Listed for rent to classmates</strong> — ${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum lease. No one's moved in yet.</p>
        <button class="btn small secondary" onclick="cancelSubletClick('${p.id}')">Withdraw listing</button>
      </div>`;
  }
  const canEnd = leaseMinWeeksElapsed(s);
  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p><strong>${icon("coin", 14)} Rented to ${nameOf(s.tenant)}</strong> — ${fmtMoney(s.price)}/week, paid every ${DAY_FULL[p.rentDay || "Fri"]}. Minimum ${s.minWeeks}-week lease${canEnd ? " (met — you can end it any time now)" : " (still running)"}.</p>
      ${canEnd ? `<button class="btn small secondary" onclick="cancelSubletClick('${p.id}')">End lease</button>` : ""}
    </div>`;
}

// What the TEACHER sees for a student's property once it's set to
// "sublet" — same information as subletStatusForOwner, but read-only
// (the teacher's own override lives in the "End rental" button below, via
// teacherEndSubletClick, not here).
function subletStatusForTeacher(p, nameOf) {
  const s = p.sublet;
  if (s.status === "pending") return `<p class="muted-small">Waiting for your approval to rent to classmates — ${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum. See "Pending rental requests" above.</p>`;
  if (s.status === "rejected") return `<p class="muted-small">Rental listing declined${s.rejectReason ? `: ${s.rejectReason}` : "."}</p>`;
  if (!s.tenant) return `<p class="muted-small">Listed for rent to classmates — ${fmtMoney(s.price)}/week, no tenant yet. <button class="btn small coral" onclick="teacherEndSubletClick('${p.id}')">End listing</button></p>`;
  return `<p class="muted-small">Rented to ${nameOf(s.tenant)} at ${fmtMoney(s.price)}/week. <button class="btn small coral" onclick="teacherEndSubletClick('${p.id}')">End rental</button></p>`;
}

async function cancelSubletClick(id) {
  const res = await cancelSublet(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}
async function teacherEndSubletClick(id) {
  if (!confirm("End this classmate rental? If someone's living there, they'll be kicked out immediately.")) return;
  const res = await teacherEndSublet(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

/* ---------------- Teacher: rental settings & moderation ---------------- */
function populateRentalSettings(cls) {
  const pr = cls.propertyRentals || {};
  document.getElementById("rentalEnabled").checked = !!pr.enabled;
  document.getElementById("rentalRequireApproval").checked = !!pr.requireApproval;
  document.getElementById("rentalMinPricePct").value = pr.minPricePct != null ? pr.minPricePct : 25;
  document.getElementById("rentalMaxPricePct").value = pr.maxPricePct != null ? pr.maxPricePct : 200;
  document.getElementById("rentalMaxLeaseWeeks").value = pr.maxLeaseWeeks != null ? pr.maxLeaseWeeks : 8;
}
async function saveRentalSettingsClick() {
  const settings = {
    enabled: document.getElementById("rentalEnabled").checked,
    requireApproval: document.getElementById("rentalRequireApproval").checked,
    minPricePct: document.getElementById("rentalMinPricePct").value,
    maxPricePct: document.getElementById("rentalMaxPricePct").value,
    maxLeaseWeeks: document.getElementById("rentalMaxLeaseWeeks").value
  };
  await saveSubletSettings(CURRENT.classCode, settings);
  document.getElementById("rentalSettingsMsg").innerHTML = `<div class="success-msg">Settings saved.</div>`;
  await render();
}
function renderPendingSublets(cls, nameOf) {
  const box = document.getElementById("pendingSublets");
  if (!box) return;
  const pending = (cls.properties || []).filter(p => p.sublet && p.sublet.status === "pending");
  if (!pending.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h3 style="margin-top:22px;">${icon("send", 15)} Pending rental requests</h3>` + pending.map(p => `
    <div class="auto-row">
      <div class="auto-details">
        <strong>${p.name}</strong> — ${nameOf(p.owner)} wants to rent it out at ${fmtMoney(p.sublet.price)}/week, ${p.sublet.minWeeks}-week minimum lease.
      </div>
      <div class="row-flex" style="gap:8px;">
        <button class="btn small mint" onclick="approveSubletClick('${p.id}')">Approve</button>
        <button class="btn small coral" onclick="rejectSubletClick('${p.id}')">Reject</button>
      </div>
    </div>
  `).join("");
}
async function approveSubletClick(id) {
  await decideSublet(CURRENT.classCode, id, true);
  await render();
}
async function rejectSubletClick(id) {
  const reason = prompt("Optional reason to show the student (leave blank for none):", "");
  if (reason === null) return;
  await decideSublet(CURRENT.classCode, id, false, reason);
  await render();
}

/* ---------------- Student: my rented home & browsing rentals ---------------- */
// Shared status-line builder for a tenant's own rented home — works for
// both a classmate sublet and an NPC unit, since both carry the same
// leaseStartWeekKey/rentLastWeekPaid shape, just at different paths on the
// caller's object (prop.sublet.* vs unit.* directly), so callers pass the
// individual fields in rather than the whole record.
function tenantRentStatusLine(leaseStartWeekKey, rentLastWeekPaid, rentDay, price, overdue) {
  const weekKey = isoWeekKey(new Date());
  const moveInWeek = leaseStartWeekKey === weekKey;
  const alreadyPaid = rentLastWeekPaid === weekKey;
  const isDueToday = (rentDay || "Fri") === nzDayName();
  if (moveInWeek) return { status: `Your first payment isn't due yet — the week you moved in is free. It'll be ${fmtMoney(price)}, due ${DAY_FULL[rentDay || "Fri"]}.`, canPay: false };
  if (alreadyPaid) return { status: `This week's rent of ${fmtMoney(price)} is already sorted.`, canPay: false };
  if (!isDueToday) return { status: `Rent is due every ${DAY_FULL[rentDay || "Fri"]}. This week's will be ${fmtMoney(price)} — come back then to pay it yourself.`, canPay: false };
  return { status: `${overdue ? "This week's rent is overdue. " : "Rent is due today. "}<strong>${fmtMoney(price)}</strong>.`, canPay: true };
}

// A student can only ever have ONE current home (see currentHomeOf), so
// this checks the classmate-sublet case first and falls back to the NPC
// case — never both at once.
function renderMyRentedHome(cls, me, nameOf) {
  const box = document.getElementById("myRentedHome");
  if (!box) return;
  const prop = (cls.properties || []).find(p => p.sublet && p.sublet.tenant === me.username);
  if (prop) { renderMyClassmateRentedHome(box, prop, cls, nameOf); return; }
  const unit = (cls.npcProperties || []).find(p => p.tenant === me.username);
  if (unit) { renderMyNpcRentedHome(box, unit); return; }
  box.innerHTML = "";
}
function renderMyClassmateRentedHome(box, prop, cls, nameOf) {
  const s = prop.sublet;
  const overdue = isSubletRentOverdue(prop, cls);
  const { status, canPay } = tenantRentStatusLine(s.leaseStartWeekKey, s.rentLastWeekPaid, prop.rentDay, s.price, overdue);
  const canMoveOut = leaseMinWeeksElapsed(s);
  box.innerHTML = `
    <div class="card">
      <h2>${icon("house", 18)} Your rented home</h2>
      <p><strong>${prop.name}</strong> — renting from ${nameOf(prop.owner)} at ${fmtMoney(s.price)}/week.</p>
      <p class="muted-small">${status}</p>
      ${canPay ? `<button class="btn small gold" onclick="payTenantRentClick('${prop.id}')">${icon("send", 13)} Pay this week's rent — ${fmtMoney(s.price)}</button>` : ""}
      <div id="tenantRentMsg-${prop.id}"></div>
      <p class="muted-small" style="margin-top:10px;">${canMoveOut ? "You've met the minimum lease length, so you can move out at any time." : `You agreed to a minimum ${s.minWeeks}-week lease, so you can't move out just yet.`}</p>
      ${canMoveOut ? `<button class="btn small secondary" onclick="tenantMoveOutClick('${prop.id}')">Move out</button>` : ""}
    </div>`;
}
async function payTenantRentClick(id) {
  const res = await payTenantRent(CURRENT.username, CURRENT.classCode, id);
  const box = document.getElementById(`tenantRentMsg-${id}`);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}
async function tenantMoveOutClick(id) {
  if (!confirm("Move out of this rental? You'll stop paying rent, but you'll also lose the lifestyle bonus for living here.")) return;
  const res = await tenantMoveOut(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

function renderAvailableSublets(cls, me, nameOf) {
  const box = document.getElementById("availableSublets");
  if (!box) return;
  const pr = cls.propertyRentals || {};
  if (!pr.enabled) { box.innerHTML = ""; return; }
  const listings = (cls.properties || []).filter(p =>
    p.sublet && p.sublet.status === "active" && !p.sublet.tenant && p.owner !== me.username
  );
  if (!listings.length) { box.innerHTML = ""; return; }
  const alreadyHoused = !!currentHomeOf(cls, me.username);
  box.innerHTML = `
    <div class="card">
      <h2>${icon("users", 18)} Rent from a classmate</h2>
      ${movingCostNote(cls)}
      ${alreadyHoused ? `<p class="muted-small">You're already living somewhere — move out first if you'd rather rent one of these instead.</p>` : ""}
      ${listings.map(p => `
        <div class="auto-row">
          <div class="auto-details">
            <strong>${p.name}</strong> — ${comfortStars(p.comfort)}<br>
            <span class="muted-small">${fmtMoney(p.sublet.price)}/week from ${nameOf(p.owner)}, ${p.sublet.minWeeks}-week minimum lease</span>
          </div>
          <button class="btn small gold" ${alreadyHoused ? "disabled" : ""} onclick="claimSubletClick('${p.id}')">Move in</button>
        </div>
      `).join("")}
      <div id="claimSubletMsg"></div>
    </div>`;
}
async function claimSubletClick(id) {
  const res = await claimSublet(CURRENT.username, CURRENT.classCode, id);
  const box = document.getElementById("claimSubletMsg");
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}

/* ---------------- Student: NPC (school) rentals ---------------- */
function renderMyNpcRentedHome(box, unit) {
  const overdue = isNpcRentOverdue(unit);
  const { status, canPay } = tenantRentStatusLine(unit.leaseStartWeekKey, unit.rentLastWeekPaid, unit.rentDay, unit.rentPerWeek, overdue);
  const canMoveOut = leaseMinWeeksElapsed(unit);
  box.innerHTML = `
    <div class="card">
      <h2>${icon("building", 18)} Your rented home</h2>
      <p><strong>${unit.name}</strong> <span class="badge lilac">${icon("building", 12)}School rental</span><br>
      renting from the school at ${fmtMoney(unit.rentPerWeek)}/week.</p>
      ${unit.description ? `<p class="muted-small">${unit.description}</p>` : ""}
      <p class="muted-small">${status}</p>
      ${canPay ? `<button class="btn small gold" onclick="payNpcRentClick('${unit.id}')">${icon("send", 13)} Pay this week's rent — ${fmtMoney(unit.rentPerWeek)}</button>` : ""}
      <div id="npcRentMsg-${unit.id}"></div>
      <p class="muted-small" style="margin-top:10px;">${canMoveOut ? "You've met the minimum lease length, so you can move out at any time." : `You agreed to a minimum ${unit.minWeeks}-week lease, so you can't move out just yet.`}</p>
      ${canMoveOut ? `<button class="btn small secondary" onclick="npcMoveOutClick('${unit.id}')">Move out</button>` : ""}
    </div>`;
}
async function payNpcRentClick(id) {
  const res = await payNpcRent(CURRENT.username, CURRENT.classCode, id);
  const box = document.getElementById(`npcRentMsg-${id}`);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}
async function npcMoveOutClick(id) {
  if (!confirm("Move out of this rental? You'll stop paying rent, but you'll also lose the lifestyle bonus for living here.")) return;
  const res = await moveOutNpcProperty(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

// Groups NPC units into listings the same way groupProperties does for
// purchasable properties, so a listing with several units shows as one
// card with "X of Y available" rather than one row per unit.
function renderAvailableNpcRentals(cls, me, nameOf) {
  const box = document.getElementById("availableNpcRentals");
  if (!box) return;
  const units = cls.npcProperties || [];
  if (!units.length) { box.innerHTML = ""; return; }
  const groups = groupProperties(units); // groupProperties is generic — works on any id/groupId array
  const alreadyHoused = !!currentHomeOf(cls, me.username);
  const cardsHtml = groups.map(g => {
    const gid = g[0].groupId || g[0].id;
    const p = g[0];
    const available = g.filter(u => !u.tenant);
    if (!available.length) return "";
    return `
      <div class="auto-row">
        <div class="auto-details">
          <strong>${p.name}</strong> <span class="badge lilac">${icon("building", 12)}School rental</span><br>
          ${p.description ? `<span class="muted-small">${p.description}</span><br>` : ""}
          <span class="muted-small">${fmtMoney(p.rentPerWeek)}/week from the school, ${p.minWeeks}-week minimum lease${p.lifestylePoints > 0 ? `, +${p.lifestylePoints} lifestyle points while you live there` : ""}
          &middot; ${g.length > 1 ? `${available.length} of ${g.length} available` : "Available"}</span>
        </div>
        <button class="btn small gold" ${alreadyHoused ? "disabled" : ""} onclick="rentNpcClick('${gid}')">Move in</button>
      </div>`;
  }).join("");
  if (!cardsHtml.trim()) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="card">
      <h2>${icon("building", 18)} Rent from the school</h2>
      ${movingCostNote(cls)}
      ${alreadyHoused ? `<p class="muted-small">You're already living somewhere — move out first if you'd rather rent one of these instead.</p>` : ""}
      ${cardsHtml}
      <div id="rentNpcMsg"></div>
    </div>`;
}
async function pickAvailableNpcUnitId(gid) {
  const cls = await getClassCached(CURRENT.classCode);
  const unit = (cls.npcProperties || []).find(p => (p.groupId || p.id) === gid && !p.tenant);
  return unit ? unit.id : null;
}
async function rentNpcClick(gid) {
  const id = await pickAvailableNpcUnitId(gid);
  const box = document.getElementById("rentNpcMsg");
  if (!id) { if (box) box.innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await rentNpcProperty(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}

// Shows this week's mortgage-payment status for the owner, and — only on
// the exact due day, for the exact due week — a button to pay it. There's
// never an amount to type in, but the actual dollar figure (principal +
// interest on whatever's still owed) is worked out and shown up front, so
// a student is never surprised by what the button is about to charge —
// it's the same number payMortgage() itself will use.
function mortgagePayBlock(p, cls) {
  const mortgageDayName = DAY_FULL[cls.mortgageDay || "Fri"];
  const weekKey = isoWeekKey(new Date());
  const purchaseWeek = p.mortgage.purchaseWeekKey === weekKey;
  const alreadyPaid = p.mortgage.lastWeekPaid === weekKey;
  // Payable either on the class's normal mortgage day, or — for this ISO
  // week only — if the teacher has manually marked mortgages as due (see
  // setMortgageDueOverride).
  const forcedDue = cls.mortgageForceDueWeek === weekKey;
  const isDueToday = (cls.mortgageDay || "Fri") === nzDayName() || forcedDue;
  const amt = mortgageWeekAmount(p.mortgage);
  const breakdown = amt.interest > 0
    ? `${fmtMoney(amt.principal)} + ${fmtMoney(amt.interest)} interest on the ${fmtMoney(amt.balanceBefore)} still owed`
    : `${fmtMoney(amt.principal)}, no interest owing`;

  let status, canPay = false;
  if (purchaseWeek) {
    status = `Your first payment isn't due yet — the week you bought is free. It'll be ${fmtMoney(amt.total)} (${breakdown}).`;
  } else if (alreadyPaid) {
    status = `${icon("house", 13)} This week's payment of ${fmtMoney(amt.total)} is already sorted.`;
  } else if (!isDueToday) {
    status = `Mortgage payments are due every ${mortgageDayName}. This week's would be ${fmtMoney(amt.total)} (${breakdown}) — come back then to pay it yourself.`;
  } else {
    const dueLine = forcedDue && (cls.mortgageDay || "Fri") !== nzDayName()
      ? `Your teacher has marked this week's mortgage payment as due now.`
      : `This week's payment is due today.`;
    status = `${dueLine} <strong>${fmtMoney(amt.total)}</strong> — ${breakdown}.`;
    canPay = true;
  }

  return `
    <div class="card" style="margin-top:8px;padding:10px 12px;">
      <p class="muted-small">${status}</p>
      ${canPay ? `<button class="btn small gold" onclick="payMortgageClick('${p.id}')">${icon("send", 13)} Pay this week's mortgage — ${fmtMoney(amt.total)}</button>` : ""}
      <div id="mortgageMsg-${p.id}"></div>
    </div>`;
}

async function payMortgageClick(id) {
  const res = await payMortgage(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) {
    const box = document.getElementById(`mortgageMsg-${id}`);
    if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  await render();
}

// Builds the status badge row for the teacher-only mortgage settings card.
// previewForceDue, when passed, lets the toggle show what would change
// before it's actually saved (see previewMortgageForceDue).
function mortgageStatusBadges(cls, previewForceDue) {
  const day = cls.mortgageDay || "Fri";
  const weekKey = isoWeekKey(new Date());
  const storedForceDue = cls.mortgageForceDueWeek === weekKey;
  const forceDue = previewForceDue === undefined ? storedForceDue : previewForceDue;
  const dueToday = day === nzDayName();

  let badges = `<span class="badge navy">${icon("calendar", 12)}Due every ${DAY_FULL[day]}</span>`;
  if (dueToday) badges += `<span class="badge mint">${icon("house", 12)}Due today</span>`;
  if (forceDue && !dueToday) badges += `<span class="badge gold">${icon("send", 12)}This week: due now (override)</span>`;
  if (forceDue !== storedForceDue) badges += `<span class="badge lilac">Unsaved change — click Save below</span>`;
  return badges;
}

function populateMortgageSettings(cls) {
  MORTGAGE_SETTINGS_CLS = cls;
  document.getElementById("mortgageDaySelect").value = cls.mortgageDay || "Fri";
  document.getElementById("mortgageForceDue").checked = cls.mortgageForceDueWeek === isoWeekKey(new Date());
  document.getElementById("mortgageStatusRow").innerHTML = mortgageStatusBadges(cls);
  document.getElementById("movingCostInput").value = cls.movingCost || 0;
}

async function saveMovingCostClick() {
  const val = document.getElementById("movingCostInput").value;
  await setMovingCost(CURRENT.classCode, val);
  document.getElementById("movingCostMsg").innerHTML = `<div class="success-msg">Moving cost saved. Students are charged this the moment they move into a new home (buying and choosing to live in it, or moving in as a classmate's tenant) — capped at one move per student per day.</div>`;
  await render();
}

// Live-updates the status badges as soon as the teacher flips the toggle,
// before they've actually clicked Save — makes it obvious the change is
// only local until confirmed.
function previewMortgageForceDue() {
  if (!MORTGAGE_SETTINGS_CLS) return;
  const checked = document.getElementById("mortgageForceDue").checked;
  document.getElementById("mortgageStatusRow").innerHTML = mortgageStatusBadges(MORTGAGE_SETTINGS_CLS, checked);
}

async function saveMortgageDayClick() {
  await setMortgageDay(CURRENT.classCode, document.getElementById("mortgageDaySelect").value);
  document.getElementById("mortgageDayMsg").innerHTML = `<div class="success-msg">Mortgage day saved. Students can pay their weekly mortgage installment themselves on this day.</div>`;
  await render();
}

async function saveMortgageForceDue() {
  const active = document.getElementById("mortgageForceDue").checked;
  await setMortgageDueOverride(CURRENT.classCode, active);
  document.getElementById("mortgageForceDueMsg").innerHTML = `<div class="success-msg">${active ? "This week's mortgage payments are now marked as due — students can pay below." : "Manual override turned off."}</div>`;
  await render();
}

async function chooseOccupancy(id, choice) {
  const cls = await getClassCached(CURRENT.classCode);
  const prop = (cls.properties || []).find(p => p.id === id);
  const preview = propertyLifestylePreview(cls, prop);
  const bonus = preview ? preview.livingBonusPoints : 0;
  const movingCost = cls.movingCost || 0;
  const movingNote = choice === "living" && prop && prop.occupancy !== "living"
    ? `\n\nMoving in ${movingCost > 0 ? `costs ${fmtMoney(movingCost)} and ` : ""}counts as your one house-move for today, and you can't already be living somewhere else.`
    : "";
  const msg = choice === "living"
    ? `Live in this property?\n\nYou'll get a +${bonus} bonus to your lifestyle rating (property category) while you live here, but you won't receive any rent. You can switch to renting it out again at any time, for free.${movingNote}`
    : `Rent this property out?\n\nYou'll receive weekly rent instead of living here, but you will NOT get the +${bonus} lifestyle bonus for living in it — only the property's base comfort rating will count toward your lifestyle rating. You can move back in at any time.`;
  if (!confirm(msg)) return;
  const res = await setPropertyOccupancy(CURRENT.username, CURRENT.classCode, id, choice);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

async function addProp(e) {
  e.preventDefault();
  const prop = {
    name: document.getElementById("hName").value.trim(),
    price: document.getElementById("hPrice").value,
    comfort: document.getElementById("hComfort").value,
    quantity: document.getElementById("hQuantity").value,
    livingBonusStars: document.getElementById("hLivingBonus").value,
    mortgageWeeks: document.getElementById("hMortgage").value,
    mortgageInterestRate: document.getElementById("hMortgageRate").value,
    description: document.getElementById("hDesc").value.trim(),
    rentPerWeek: document.getElementById("hRent").value,
    rentDay: document.getElementById("hRentDay").value
  };
  if (EDITING_ID) {
    await updateProperty(CURRENT.classCode, EDITING_ID, prop);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Property updated!</div>`;
    cancelEditProp();
  } else {
    await addProperty(CURRENT.classCode, prop);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Property added!</div>`;
    ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("hComfort").value = 3;
    document.getElementById("hQuantity").value = 1;
    document.getElementById("hLivingBonus").value = 1;
    document.getElementById("hMortgage").value = 0;
    document.getElementById("hMortgageRate").value = 0;
    document.getElementById("hRent").value = 0;
    document.getElementById("hRentDay").value = "Fri";
  }
  await render();
  return false;
}

// id is any unit's id within the listing — edits apply to the whole
// group (see updateProperty in data.js). Quantity shown is how many
// units currently exist in that group.
async function editProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const props = cls.properties || [];
  const prop = props.find(p => p.id === id);
  if (!prop) return;
  const gid = prop.groupId || prop.id;
  const groupSize = props.filter(p => (p.groupId || p.id) === gid).length;
  EDITING_ID = id;
  document.getElementById("hName").value = prop.name;
  document.getElementById("hPrice").value = prop.price;
  document.getElementById("hComfort").value = prop.comfort;
  document.getElementById("hQuantity").value = groupSize;
  document.getElementById("hLivingBonus").value = prop.livingBonusStars !== undefined ? prop.livingBonusStars : 1;
  document.getElementById("hMortgage").value = prop.mortgageWeeks || 0;
  document.getElementById("hMortgageRate").value = prop.mortgageInterestRate || 0;
  document.getElementById("hDesc").value = prop.description || "";
  document.getElementById("hRent").value = prop.rentPerWeek || 0;
  document.getElementById("hRentDay").value = prop.rentDay || "Fri";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditProp() {
  EDITING_ID = null;
  ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hQuantity").value = 1;
  document.getElementById("hLivingBonus").value = 1;
  document.getElementById("hMortgage").value = 0;
  document.getElementById("hMortgageRate").value = 0;
  document.getElementById("hRent").value = 0;
  document.getElementById("hRentDay").value = "Fri";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

async function deleteProp(id) {
  if (confirm("Remove this property listing (all units of it)? Any owners will not be refunded automatically.")) {
    await removeProperty(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id) {
  if (confirm("Sell this property back to the class (owner gets 90% of price)?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
async function sellMine(id) {
  if (confirm("Sell your property back for 90% of its price?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
// gid is a listing's groupId — picks whichever unit in that listing is
// still unowned (fresh read, to keep the race window with another buyer
// as small as possible) and buys that specific unit.
async function pickAvailableUnitId(gid) {
  const cls = await getClassCached(CURRENT.classCode);
  const unit = (cls.properties || []).find(p => (p.groupId || p.id) === gid && !p.owner);
  return unit ? unit.id : null;
}
async function buyOutright(gid) {
  const id = await pickAvailableUnitId(gid);
  if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, false);
  document.getElementById("msg-" + gid).innerHTML = res.ok ? `<div class="success-msg">Congratulations, it's yours!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}
async function buyFinanced(gid) {
  const id = await pickAvailableUnitId(gid);
  if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, true);
  document.getElementById("msg-" + gid).innerHTML = res.ok ? `<div class="success-msg">Financed! Weekly payments will come out automatically.</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

/* ---------------- Teacher: NPC (school) property listings ---------------- */
function renderNpcListings(cls, nameOf) {
  const list = document.getElementById("npcPropList");
  const units = cls.npcProperties || [];
  document.getElementById("noNpcProps").classList.toggle("hidden", units.length > 0);
  if (!units.length) { list.innerHTML = ""; return; }
  const groups = groupProperties(units);
  list.innerHTML = groups.map(g => {
    const p = g[0];
    const gid = p.groupId || p.id;
    const tenanted = g.filter(u => u.tenant);
    const vacant = g.filter(u => !u.tenant);
    return `
      <div class="card company-card">
        <div class="flex-between">
          <div>
            <h4>${icon("building", 20)}${p.name} <span class="badge lilac">School rental</span></h4>
            <p>${p.description || "No description provided."}</p>
            <p>${fmtMoney(p.rentPerWeek)}/week &middot; ${p.minWeeks}-week minimum lease &middot; due ${DAY_FULL[p.rentDay || "Fri"]}s${p.lifestylePoints > 0 ? ` &middot; +${p.lifestylePoints} lifestyle points while renting` : ""}</p>
            <p class="muted-small">${g.length > 1 ? `${vacant.length} of ${g.length} available` : (vacant.length > 0 ? "Available" : "Tenanted")}</p>
          </div>
          <div class="row-flex" style="gap:8px;">
            <button class="btn small secondary" onclick="editNpcProp('${p.id}')">${icon("plus", 13)} Edit</button>
            <button class="btn small coral" onclick="deleteNpcProp('${p.id}')">${icon("trash", 13)} Remove</button>
          </div>
        </div>
        <div id="npcMsg-${gid}"></div>
        ${tenanted.map(u => npcTenantBlock(u, nameOf)).join("")}
      </div>`;
  }).join("");
}
// Renders one tenanted unit's status within a listing card — who's
// renting it, whether this week's rent is overdue, and the teacher's
// override controls (waive the overdue payment, or end the tenancy
// outright). Mirrors subletStatusForTeacher's role for classmate rentals.
function npcTenantBlock(u, nameOf) {
  const overdue = isNpcRentOverdue(u);
  return `
    <div class="auto-row">
      <div class="auto-details">
        <strong>${nameOf(u.tenant)}</strong> is renting this
        ${overdue ? `<span class="badge coral">${icon("bell", 12)}Rent overdue</span>` : ""}
      </div>
      <div class="row-flex" style="gap:8px;">
        ${overdue ? `<button class="btn small secondary" onclick="resolveNpcOverdueClick('${u.id}')">Mark as resolved</button>` : ""}
        <button class="btn small coral" onclick="teacherEndNpcTenancyClick('${u.id}')">End tenancy</button>
      </div>
    </div>`;
}
async function resolveNpcOverdueClick(id) {
  const res = await resolveNpcRentOverdue(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}
async function teacherEndNpcTenancyClick(id) {
  if (!confirm("End this student's tenancy right now? They'll be moved out immediately, regardless of their minimum lease.")) return;
  const res = await teacherEndNpcTenancy(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

function resetNpcForm() {
  ["npcName", "npcDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("npcQuantity").value = 1;
  document.getElementById("npcRent").value = "";
  document.getElementById("npcRentDay").value = "Fri";
  document.getElementById("npcMinWeeks").value = 1;
  document.getElementById("npcLifestylePoints").value = 0;
}
async function addNpcProp(e) {
  e.preventDefault();
  const listing = {
    name: document.getElementById("npcName").value.trim(),
    description: document.getElementById("npcDesc").value.trim(),
    quantity: document.getElementById("npcQuantity").value,
    rentPerWeek: document.getElementById("npcRent").value,
    rentDay: document.getElementById("npcRentDay").value,
    minWeeks: document.getElementById("npcMinWeeks").value,
    lifestylePoints: document.getElementById("npcLifestylePoints").value
  };
  if (EDITING_NPC_ID) {
    await updateNpcProperty(CURRENT.classCode, EDITING_NPC_ID, listing);
    document.getElementById("addNpcMsg").innerHTML = `<div class="success-msg">NPC property updated!</div>`;
    cancelEditNpcProp();
  } else {
    await addNpcProperty(CURRENT.classCode, listing);
    document.getElementById("addNpcMsg").innerHTML = `<div class="success-msg">NPC property added!</div>`;
    resetNpcForm();
  }
  await render();
  return false;
}
// id is any unit's id within the listing — edits apply to the whole
// group (see updateNpcProperty in data.js). Quantity shown is how many
// units currently exist in that group.
async function editNpcProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const units = cls.npcProperties || [];
  const p = units.find(u => u.id === id);
  if (!p) return;
  const gid = p.groupId || p.id;
  const groupSize = units.filter(u => (u.groupId || u.id) === gid).length;
  EDITING_NPC_ID = id;
  document.getElementById("npcName").value = p.name;
  document.getElementById("npcDesc").value = p.description || "";
  document.getElementById("npcQuantity").value = groupSize;
  document.getElementById("npcRent").value = p.rentPerWeek;
  document.getElementById("npcRentDay").value = p.rentDay || "Fri";
  document.getElementById("npcMinWeeks").value = p.minWeeks || 1;
  document.getElementById("npcLifestylePoints").value = p.lifestylePoints || 0;
  document.getElementById("hAddNpc").innerHTML = icon("building", 18) + " Edit NPC property";
  document.getElementById("addNpcBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("cancelEditNpcBtn").classList.remove("hidden");
  document.getElementById("addNpcMsg").innerHTML = "";
  document.getElementById("npcPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function cancelEditNpcProp() {
  EDITING_NPC_ID = null;
  resetNpcForm();
  document.getElementById("hAddNpc").innerHTML = icon("building", 18) + " Add an NPC property";
  document.getElementById("addNpcBtn").innerHTML = icon("plus", 15) + " Add NPC property";
  document.getElementById("cancelEditNpcBtn").classList.add("hidden");
}
async function deleteNpcProp(id) {
  if (confirm("Remove this NPC property listing (all units of it)? Any current tenants will be moved out immediately.")) {
    await removeNpcProperty(CURRENT.classCode, id);
    await render();
  }
}

document.addEventListener("DOMContentLoaded", init);
