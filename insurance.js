let CURRENT, IS_TEACHER, EDITING_PLAN_ID = null;

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nextPaymentInfo(dayAbbr) {
  const targetIdx = DAY_INDEX[dayAbbr];
  if (targetIdx === undefined) return null;
  const now = new Date();
  const todayIdx = now.getDay();
  const daysUntil = (targetIdx - todayIdx + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  return {
    daysUntil,
    dateStr: next.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
    isToday: daysUntil === 0
  };
}

function stars(n) {
  n = Number(n) || 0;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

const COVERAGE_LABEL = { jobs: "Jobs / Income", general: "General (bad random events)", property: "Property", transport: "Transport" };

// Property and transport plans are grouped into insurance companies (see
// insuranceCompaniesOf in data-life.js). These are filled on every render.
let COMPANIES = [];
let PLANS_BY_ID = {};
// Company cards the viewer has opened — kept across re-renders (e.g. after
// signing up) so the card they were looking at doesn't snap shut.
const OPEN_COMPANIES = new Set();
const KIND_INFO = {
  transport: { icon: "car", title: "Car & transport insurance" },
  property: { icon: "house", title: "Home & property insurance" }
};

// Fills the "Type of cover" list for the chosen coverage (property and
// transport only — the list is hidden for the others). `selected` picks a
// type (when editing); without it the current pick is kept if still valid.
function updatePlanTypeSelect(selected) {
  const coverage = document.getElementById("pCoverage").value;
  const types = INSURANCE_TYPES[coverage] || [];
  const sel = document.getElementById("pInsType");
  const keep = selected !== undefined ? selected : sel.value;
  sel.innerHTML = `<option value="" disabled>Choose a type…</option>`
    + types.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("");
  sel.value = types.some(t => t.key === keep) ? keep : "";
  document.getElementById("pInsTypeWrap").classList.toggle("hidden", !types.length);
}

// Shows the company + type pickers for property/transport plans and fills
// the company list with that kind's companies. `companyId`/`insType` pick
// what's selected (when editing); without them the current picks are kept
// when still valid.
function updatePlanFormForCoverage(companyId, insType) {
  const coverage = document.getElementById("pCoverage").value;
  const hasCompanies = !!INSURANCE_TYPES[coverage];
  document.getElementById("pCompanyWrap").classList.toggle("hidden", !hasCompanies);
  updatePlanTypeSelect(insType);
  const sel = document.getElementById("pCompany");
  const keep = companyId !== undefined ? companyId : sel.value;
  const companies = COMPANIES.filter(c => c.coverage === coverage);
  sel.innerHTML = `<option value="" disabled>Choose a company…</option>`
    + companies.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    + `<option value="new">+ New company…</option>`;
  sel.value = (keep === "new" || companies.some(c => c.id === keep)) ? keep : (companies.length ? "" : "new");
  updateCompanyNameField();
  document.getElementById("labName").textContent = hasCompanies ? "Plan name (optional — blank uses the type)" : "Plan name";
  document.getElementById("pName").placeholder = hasCompanies ? "e.g. Premium Cover" : "e.g. Basic Cover";
}

function updateCompanyNameField() {
  const isNew = document.getElementById("pCompany").value === "new";
  document.getElementById("pCompanyNameWrap").classList.toggle("hidden", !isNew);
}

// "Transport — Comprehensive Insurance", or just "Transport" with no type.
function coverageText(p) {
  const typeLabel = insuranceTypeLabel(p.coverage, p.insType);
  return (COVERAGE_LABEL[p.coverage] || "—") + (typeLabel ? ` — ${typeLabel}` : "");
}

// Sign up / cancel for students, edit / remove for the teacher.
function planButtonsHtml(p, me, owned) {
  if (IS_TEACHER) {
    return `<button class="btn small secondary" onclick="startEditPlan('${p.id}')">Edit</button>
      <button class="btn small coral" onclick="deletePlan('${p.id}')">${icon("trash", 13)} Remove</button>`;
  }
  return owned
    ? `<button class="btn small secondary" id="cancelBtn-${p.id}" onclick="cancelPlan('${p.id}')">Cancel cover</button>`
    : `<button class="btn small gold" id="buyBtn-${p.id}" onclick="buyPlan('${p.id}', ${applyLifeDiscount(me, "insurance", Number(p.signupFee) || 0)})">${icon("shield", 13)} Sign up</button>`;
}

function planPriceHtml(p, me) {
  const fee = Number(p.signupFee) || 0;
  return `<strong>${fmtMoney(p.price)}</strong>/week &middot; ${fmtMoney(p.excess)} excess`
    + (fee ? ` &middot; ${priceWithLifeDiscount(me, "insurance", fee)} sign-up fee` : "")
    + (p.stars ? ` &middot; <span class="ticker-up">${stars(p.stars)}</span>` : "");
}

// A Jobs / General plan (or an older property/transport plan that isn't in
// a company yet) — shown on its own card, same as always.
function singlePlanCardHtml(p, me) {
  const owned = (me.insurance || []).includes(p.id);
  const needsCompany = IS_TEACHER && INSURANCE_TYPES[p.coverage];
  return `
    <div class="card company-card">
      <div class="flex-between">
        <div>
          <h4>${icon("shield", 20)}${escapeHtml(p.name)} ${owned ? '<span class="badge mint">You have this</span>' : ""}</h4>
          <p>${escapeHtml(p.description) || "No description provided."}</p>
          <p class="muted-small">Covers: ${escapeHtml(coverageText(p))}
            ${needsCompany ? `<span class="badge coral">Not in a company yet — click Edit to choose one</span>` : ""}</p>
          <p>${planPriceHtml(p, me)}</p>
        </div>
        <div>${planButtonsHtml(p, me, owned)}</div>
      </div>
      <div id="msg-${p.id}"></div>
    </div>`;
}

// One plan inside an opened company card.
function companyPlanRowHtml(p, me, owned) {
  const typeLabel = insuranceTypeLabel(p.coverage, p.insType);
  return `
    <div class="ins-plan-row${owned ? " owned" : ""}">
      <div class="ins-plan-info">
        <div class="ins-plan-name"><strong>${escapeHtml(p.name)}</strong>
          ${typeLabel && typeLabel !== p.name ? `<span class="badge navy">${escapeHtml(typeLabel)}</span>` : ""}
          ${owned ? `<span class="badge mint">You have this</span>` : ""}
          ${IS_TEACHER && !typeLabel ? `<span class="badge coral">Type not set — click Edit</span>` : ""}
        </div>
        ${p.description ? `<div class="muted-small">${escapeHtml(p.description)}</div>` : ""}
        <div class="ins-plan-price">${planPriceHtml(p, me)}</div>
      </div>
      <div class="ins-plan-actions">${planButtonsHtml(p, me, owned)}</div>
      <div class="ins-plan-msg" id="msg-${p.id}"></div>
    </div>`;
}

// A company card: closed it shows the name, how many plans and the
// cheapest price; tapping it opens the list of plans to pick from.
function companyCardHtml(co, me) {
  const mine = new Set(me.insurance || []);
  const plans = co.plans.slice().sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  const ownedCount = plans.filter(p => mine.has(p.id)).length;
  const open = OPEN_COMPANIES.has(co.id);
  const cheapest = plans.length ? Math.min(...plans.map(p => Number(p.price) || 0)) : 0;
  const kind = KIND_INFO[co.coverage];
  return `
    <div class="card ins-co${open ? " open" : ""}" id="co-${co.id}">
      <button type="button" class="ins-co-head" aria-expanded="${open}" aria-controls="coBody-${co.id}" onclick="toggleCompany('${co.id}')">
        <span class="ins-co-icon">${icon(kind.icon, 24)}</span>
        <span class="ins-co-main">
          <span class="ins-co-name">${escapeHtml(co.name)}
            ${ownedCount ? `<span class="badge mint">You have ${ownedCount === 1 ? "1 plan" : ownedCount + " plans"}</span>` : ""}</span>
          <span class="muted-small">${plans.length} plan${plans.length === 1 ? "" : "s"} &middot; from ${fmtMoney(cheapest)}/week</span>
        </span>
        <span class="ins-co-caret" aria-hidden="true">&#9656;</span>
      </button>
      <div class="ins-co-body" id="coBody-${co.id}" ${open ? "" : "hidden"}>
        <p class="muted-small">${IS_TEACHER
          ? "Students open this company to see these plans and pick the one they want."
          : "Pick the plan you want. You can have more than one plan, but each event can only be claimed once, on one plan."}</p>
        ${plans.map(p => companyPlanRowHtml(p, me, mine.has(p.id))).join("")}
        ${IS_TEACHER ? `
        <div class="ins-co-actions">
          <button class="btn small gold" onclick="startAddToCompany('${co.id}')">${icon("plus", 13)} Add a plan</button>
          <button class="btn small secondary" onclick="renameCompany('${co.id}')">Rename company</button>
          <button class="btn small coral" onclick="deleteCompany('${co.id}')">${icon("trash", 13)} Remove company</button>
        </div>` : ""}
      </div>
    </div>`;
}

function toggleCompany(id) {
  const card = document.getElementById("co-" + id);
  if (!card) return;
  const open = !OPEN_COMPANIES.has(id);
  if (open) OPEN_COMPANIES.add(id); else OPEN_COMPANIES.delete(id);
  card.classList.toggle("open", open);
  card.querySelector(".ins-co-head").setAttribute("aria-expanded", String(open));
  card.querySelector(".ins-co-body").hidden = !open;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("shield", 26) + " Insurance";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an insurance plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("hMine").innerHTML = icon("shield", 18) + " My cover";
  document.getElementById("hPayDay").innerHTML = icon("calendar", 18) + " Premium payment day";
  document.getElementById("saveDayBtn").innerHTML = icon("calendar", 14) + " Save day";
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
  document.getElementById("payDayCard").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("hMine").closest(".card").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
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

async function render() {
  // getUser and getClass are independent reads — CURRENT.classCode is
  // already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  const plans = cls.insurancePlans || [];
  COMPANIES = insuranceCompaniesOf(cls);
  PLANS_BY_ID = {};
  plans.forEach(p => { PLANS_BY_ID[p.id] = p; });

  if (IS_TEACHER) {
    document.getElementById("insuranceDay").value = cls.insuranceDay || "Fri";
    updatePlanFormForCoverage(); // refresh the company list, keeping the current picks
  }

  const list = document.getElementById("planList");
  document.getElementById("noPlans").classList.toggle("hidden", plans.length > 0);

  // Companies first (transport, then property, A–Z), then every plan that
  // isn't in a company: Jobs, General and any older property/transport plan.
  let html = "";
  ["transport", "property"].forEach(coverage => {
    const cos = COMPANIES.filter(c => c.coverage === coverage).sort((a, b) => a.name.localeCompare(b.name));
    if (!cos.length) return;
    html += `<h2 class="ins-section-title">${icon(KIND_INFO[coverage].icon, 22)} ${KIND_INFO[coverage].title}</h2>`;
    html += cos.map(co => companyCardHtml(co, me)).join("");
  });
  const singles = plans.filter(p => !(p.companyId && INSURANCE_TYPES[p.coverage]));
  if (singles.length) {
    if (COMPANIES.length) html += `<h2 class="ins-section-title">${icon("shield", 22)} Other insurance</h2>`;
    html += singles.map(p => singlePlanCardHtml(p, me)).join("");
  }
  list.innerHTML = html;

  if (!IS_TEACHER) {
    const mine = plans.filter(p => (me.insurance || []).includes(p.id));
    document.getElementById("noMine").classList.toggle("hidden", mine.length > 0);
    const box = document.getElementById("myPlans");
    box.innerHTML = "";
    const payInfo = nextPaymentInfo(cls.insuranceDay);
    mine.forEach(p => {
      const row = document.createElement("div");
      row.className = "auto-row";
      let payText = `premiums due on ${cls.insuranceDay}s`;
      if (payInfo) {
        payText = payInfo.isToday
          ? `<span class="badge gold">Payment due today</span>`
          : `Next payment: ${payInfo.dateStr} (in ${payInfo.daysUntil} day${payInfo.daysUntil === 1 ? "" : "s"})`;
      }
      const typeLabel = insuranceTypeLabel(p.coverage, p.insType);
      const showType = typeLabel && typeLabel !== p.name;
      row.innerHTML = `<div class="auto-details">${icon("shield", 14)} <strong>${escapeHtml(insurancePlanName(p))}</strong>${showType ? ` (${escapeHtml(typeLabel)})` : ""} &middot; ${fmtMoney(p.price)}/week &middot; ${fmtMoney(p.excess)} excess &middot; ${payText}</div>`;
      box.appendChild(row);
    });
  }
}

// Clears the plan details, leaving "What's covered" and the company as
// they are (so the teacher can add several plans to one company in a row).
function clearPlanDetails() {
  ["pName","pPrice","pExcess","pDesc","pCompanyName"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("pStars").value = 0;
  document.getElementById("pSignupFee").value = 0;
  updatePlanTypeSelect("");
}

async function addPlan(e) {
  e.preventDefault();
  const msg = document.getElementById("addMsg");
  const fail = (text, focusId) => {
    msg.innerHTML = `<div class="error-msg">${text}</div>`;
    if (focusId) document.getElementById(focusId).focus();
    return false;
  };
  const coverage = document.getElementById("pCoverage").value;
  const hasCompanies = !!INSURANCE_TYPES[coverage];
  const plan = {
    name: document.getElementById("pName").value.trim(),
    price: document.getElementById("pPrice").value,
    excess: document.getElementById("pExcess").value,
    coverage,
    insType: document.getElementById("pInsType").value,
    companyId: document.getElementById("pCompany").value,
    companyName: document.getElementById("pCompanyName").value.trim(),
    description: document.getElementById("pDesc").value.trim(),
    stars: document.getElementById("pStars").value,
    signupFee: document.getElementById("pSignupFee").value
  };
  if (hasCompanies) {
    if (!plan.companyId) return fail(`Choose which company sells this plan, or make a new one.`, "pCompany");
    if (plan.companyId === "new") {
      if (!plan.companyName) return fail(`Type the new company's name.`, "pCompanyName");
      // Same name as a company that already exists? Add to that one rather
      // than making a second company with the same name.
      const same = COMPANIES.find(c => c.coverage === coverage && c.name.trim().toLowerCase() === plan.companyName.toLowerCase());
      if (same) plan.companyId = same.id;
    }
    if (!insuranceTypeLabel(coverage, plan.insType)) return fail(`Choose which type of ${coverage} insurance this is.`, "pInsType");
  } else if (!plan.name) {
    return fail("Give this plan a name.", "pName");
  }
  const companyName = plan.companyId === "new" ? plan.companyName : (COMPANIES.find(c => c.id === plan.companyId) || {}).name;
  const wasEditing = !!EDITING_PLAN_ID;
  if (wasEditing) {
    await editInsurancePlan(CURRENT.classCode, EDITING_PLAN_ID, plan);
    cancelEditPlan();
    msg.innerHTML = `<div class="success-msg">Plan updated!</div>`;
  } else {
    await addInsurancePlan(CURRENT.classCode, plan);
    clearPlanDetails();
    msg.innerHTML = `<div class="success-msg">Plan added${hasCompanies && companyName ? ` to ${escapeHtml(companyName)}` : ""}!</div>`;
  }
  await render();
  // Open the company the plan went into, and keep it picked in the form
  // so another plan can be added to it straight away.
  if (hasCompanies && companyName) {
    const co = COMPANIES.filter(c => c.coverage === coverage && c.name === companyName.slice(0, 60)).pop();
    if (co) {
      if (!OPEN_COMPANIES.has(co.id)) toggleCompany(co.id);
      if (!wasEditing) updatePlanFormForCoverage(co.id);
    }
  }
  return false;
}

function startEditPlan(id) {
  const p = PLANS_BY_ID[id];
  if (!p) return;
  EDITING_PLAN_ID = p.id;
  document.getElementById("pCoverage").value = p.coverage || "general";
  updatePlanFormForCoverage(p.companyId || "", p.insType || "");
  // A plan named after its own type shows blank here, so changing the type
  // renames it to match.
  document.getElementById("pName").value = p.name === insuranceTypeLabel(p.coverage, p.insType) ? "" : (p.name || "");
  document.getElementById("pCompanyName").value = "";
  document.getElementById("pPrice").value = p.price || 0;
  document.getElementById("pExcess").value = p.excess || 0;
  document.getElementById("pDesc").value = p.description || "";
  document.getElementById("pStars").value = p.stars || 0;
  document.getElementById("pSignupFee").value = p.signupFee || 0;
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Edit insurance plan";
  document.getElementById("addBtn").innerHTML = "Save changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("addMsg").innerHTML = "";
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth" });
}

function cancelEditPlan() {
  EDITING_PLAN_ID = null;
  clearPlanDetails();
  document.getElementById("pCoverage").value = "general";
  updatePlanFormForCoverage("", "");
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add an insurance plan";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add plan";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

// "Add a plan" on a company card: sets the form up for that company.
function startAddToCompany(id) {
  const co = COMPANIES.find(c => c.id === id);
  if (!co) return;
  cancelEditPlan();
  document.getElementById("pCoverage").value = co.coverage;
  updatePlanFormForCoverage(co.id, "");
  document.getElementById("addMsg").innerHTML = `<div class="muted-small">Adding a plan to ${escapeHtml(co.name)}.</div>`;
  document.getElementById("teacherPanel").scrollIntoView({ behavior: "smooth" });
}

async function renameCompany(id) {
  const co = COMPANIES.find(c => c.id === id);
  if (!co) return;
  const name = prompt("New name for this company:", co.name);
  if (name === null || !name.trim() || name.trim() === co.name) return;
  await renameInsuranceCompany(CURRENT.classCode, id, name);
  await render();
}

async function deleteCompany(id) {
  const co = COMPANIES.find(c => c.id === id);
  if (!co) return;
  const n = co.plans.length;
  if (!confirm(`Remove ${co.name} and its ${n === 1 ? "plan" : n + " plans"}? Students who have one of these plans will lose that cover.`)) return;
  if (EDITING_PLAN_ID && co.plans.some(p => p.id === EDITING_PLAN_ID)) cancelEditPlan();
  await removeInsuranceCompany(CURRENT.classCode, id);
  OPEN_COMPANIES.delete(id);
  await render();
}

async function deletePlan(id) {
  if (confirm("Remove this insurance plan?")) {
    if (id === EDITING_PLAN_ID) cancelEditPlan();
    await removeInsurancePlan(CURRENT.classCode, id);
    await render();
  }
}

async function buyPlan(id, fee) {
  if (fee > 0 && !confirm(`This plan has a one-off sign-up fee of ${fmtMoney(fee)}, charged immediately. Continue?`)) return;
  // A free plan (fee === 0) skips the confirm() above, so — same as
  // buy() in market.js — nothing else blocks a fast double-tap here.
  const btn = document.getElementById("buyBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await buyInsurance(CURRENT.username, CURRENT.classCode, id);
    // render() rebuilds the whole list, so the message goes in afterwards —
    // written before it, it was wiped straight away and never seen.
    await render();
    const box = document.getElementById("msg-" + id);
    if (box) box.innerHTML = res.ok
      ? `<div class="success-msg">You're covered! Premiums are due weekly — remember to set up an automatic payment to your teacher from the Bank tab so your cover doesn't lapse.</div>`
      : `<div class="error-msg">${res.error}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function cancelPlan(id) {
  // Same double-tap guard as buyPlan above — this one has no confirm()
  // at all.
  const btn = document.getElementById("cancelBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    await cancelInsurance(CURRENT.username, id);
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveInsuranceDay() {
  await classesColUpdateInsuranceDay(CURRENT.classCode, document.getElementById("insuranceDay").value);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
