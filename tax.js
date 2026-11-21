let CURRENT, IS_TEACHER;

// No store or insurance tax: store prices and insurance premiums are what
// the student pays, tax included — the same way prices are shown in NZ.
const TAX_CATEGORIES = [
  { key: "property", label: "Property purchases", kind: "expense" },
  { key: "transport", label: "Transport purchases", kind: "expense" },
  { key: "interest", label: "Savings interest (income tax)", kind: "income" },
  { key: "gambling", label: "Gambling winnings (income tax)", kind: "income" }
];

// Wages use progressive brackets rather than one flat rate. Each row taxes
// only the slice of the wage between the previous bracket's cap and its own
// "up to" amount; the last row (upTo left blank) covers everything above it.
let wageBrackets = [];
let dirty = false;

function renderWageBracketRows() {
  const rows = document.getElementById("wageBracketRows");
  if (!rows) return;
  rows.innerHTML = wageBrackets.map((b, i) => `
    <div class="bracket-row" style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
      <span class="bracket-floor">${fmtBracketFloor(i)} up to and including</span>
      <input type="number" min="0" step="1" placeholder="no limit" value="${b.upTo === null ? "" : b.upTo}"
        aria-label="Bracket ${i + 1} upper limit" style="width:110px" oninput="updateBracket(${i}, 'upTo', this.value)">
      <span>tax</span>
      <input type="number" min="0" max="100" step="0.5" required value="${b.rate}"
        aria-label="Bracket ${i + 1} tax rate" style="width:80px" oninput="updateBracket(${i}, 'rate', this.value)">
      <span>%</span>
      <button type="button" class="btn small" onclick="removeBracket(${i})">Remove</button>
    </div>
  `).join("") || `<p>No wage tax brackets yet. Wages aren't taxed. Add a bracket below.</p>`;
  rows.insertAdjacentHTML("beforeend", '<p id="bracketHint" class="muted-small"></p>');
  refreshBracketLabels();
}

function refreshBracketLabels() {
  document.querySelectorAll(".bracket-floor").forEach((el, i) => {
    el.textContent = fmtBracketFloor(i) + " up to and including";
  });
  const cap = wageBrackets.at(-1)?.upTo;
  document.getElementById("bracketHint").textContent = cap == null ? "" :
    `Wages above ${fmtMoney(cap)} won't be taxed. Leave the final limit blank to tax the rest.`;
}

function fmtBracketFloor(index) {
  if (index === 0) return "From $0";
  const prevTop = wageBrackets[index - 1].upTo;
  return prevTop === null || prevTop === "" ? "From $0" : "Above " + fmtMoney(Number(prevTop));
}

function updateBracket(i, field, value) {
  dirty = true;
  if (field === "upTo") {
    wageBrackets[i].upTo = value === "" ? null : Number(value);
  } else {
    wageBrackets[i].rate = Number(value) || 0;
  }
  refreshBracketLabels();
}

function addBracket() {
  dirty = true;
  // New bracket starts above the current top; if the previous "last" bracket
  // had no cap, give it one now so there's still exactly one open-ended row.
  if (wageBrackets.length && wageBrackets[wageBrackets.length - 1].upTo === null) {
    // Cap it above every existing cap, so brackets stay in ascending order
    // (a hard-coded 100 would sit below an earlier cap such as 14000).
    const caps = wageBrackets.map(b => b.upTo).filter(v => v !== null && Number.isFinite(Number(v))).map(Number);
    wageBrackets[wageBrackets.length - 1].upTo = (caps.length ? Math.max(...caps) : 0) + 1000;
  }
  wageBrackets.push({ upTo: null, rate: 0 });
  renderWageBracketRows();
}

function removeBracket(i) {
  dirty = true;
  wageBrackets.splice(i, 1);
  renderWageBracketRows();
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("percent", 26) + " Tax";
  document.getElementById("hRates").innerHTML = "Tax rates";
  document.getElementById("saveBtn").innerHTML = "Save tax rates";
  document.getElementById("hWageBrackets").innerHTML = "Wage tax brackets";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  // Students no longer have a Tax page: each rate is shown where it applies
  // (wage tax on Jobs, property / transport tax on those pages, savings
  // interest tax on Bank, winnings tax on Gambling). This page is where the
  // teacher sets the rates.
  if (!IS_TEACHER) { location.replace("student.html"); return; }
  document.getElementById("taxGrid").addEventListener("input", () => { dirty = true; });
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
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
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents"),
    safeBgJob(processJobPromotions(u.classCode), "processJobPromotions")
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
  const cls = await getClassCached(CURRENT.classCode);
  if (dirty) return;
  const rates = cls.taxRates || {};
  wageBrackets = (cls.wageTaxBrackets || []).map(b => ({ upTo: b.upTo, rate: b.rate }));

  {
    const grid = document.getElementById("taxGrid");
    grid.innerHTML = TAX_CATEGORIES.map(c => `
      <div>
        <label for="tax-${c.key}">${c.label} ${c.kind === "income" ? "" : ""}</label>
        <input type="number" min="0" max="100" step="0.5" required id="tax-${c.key}" value="${rates[c.key] || 0}">
      </div>
    `).join("");
    renderWageBracketRows();
  }
}

async function saveRates() {
  const btn = document.getElementById("saveBtn");
  if (btn.disabled) return;
  const status = document.getElementById("saveMsg");
  status.textContent = "";
  const panel = document.getElementById("teacherPanel");
  for (const field of panel.querySelectorAll("input")) {
    if (!field.reportValidity()) return;
  }
  let floor = 0;
  for (const [i, bracket] of wageBrackets.entries()) {
    if (bracket.upTo === null ? i < wageBrackets.length - 1 : bracket.upTo <= floor) {
      status.textContent = "Enter increasing bracket limits. Only the final limit may be blank.";
      panel.querySelectorAll(".bracket-row")[i].querySelector("input").focus();
      return;
    }
    floor = bracket.upTo;
  }
  const rates = {};
  TAX_CATEGORIES.forEach(c => { rates[c.key] = document.getElementById("tax-" + c.key).value; });
  const controls = [...panel.querySelectorAll("input:enabled, button:enabled")];
  controls.forEach(el => { el.disabled = true; });
  try {
    await saveTaxRates(CURRENT.classCode, rates, wageBrackets);
    dirty = false;
    status.innerHTML = '<div class="success-msg">Saved!</div>';
  } catch (err) {
    status.textContent = "Couldn't save the tax settings. Your edits are still here. Try again.";
  } finally {
    controls.forEach(el => { el.disabled = false; });
  }
}

document.addEventListener("DOMContentLoaded", init);
