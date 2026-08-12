let CURRENT, IS_TEACHER;

const TAX_CATEGORIES = [
  { key: "store", label: "Class store purchases", kind: "expense" },
  { key: "insurance", label: "Insurance premiums", kind: "expense" },
  { key: "property", label: "Property purchases", kind: "expense" },
  { key: "transport", label: "Transport purchases", kind: "expense" },
  { key: "interest", label: "Savings interest (income tax)", kind: "income" },
  { key: "gambling", label: "Gambling winnings (income tax)", kind: "income" }
];

// Wages use progressive brackets rather than one flat rate. Each row taxes
// only the slice of the wage between the previous bracket's cap and its own
// "up to" amount; the last row (upTo left blank) covers everything above it.
let wageBrackets = [];

function renderWageBracketRows() {
  const rows = document.getElementById("wageBracketRows");
  if (!rows) return;
  rows.innerHTML = wageBrackets.map((b, i) => `
    <div class="bracket-row" style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
      <span>From ${fmtBracketFloor(i)} up to and including</span>
      <input type="number" min="0" step="1" placeholder="no limit" value="${b.upTo === null ? "" : b.upTo}"
        style="width:110px" onchange="updateBracket(${i}, 'upTo', this.value)">
      <span>tax</span>
      <input type="number" min="0" max="100" step="0.5" value="${b.rate}"
        style="width:80px" onchange="updateBracket(${i}, 'rate', this.value)">
      <span>%</span>
      <button type="button" class="btn small" onclick="removeBracket(${i})">Remove</button>
    </div>
  `).join("") || `<p>No wage tax brackets yet — wages aren't taxed. Add a bracket below.</p>`;
}

function fmtBracketFloor(index) {
  if (index === 0) return "$0 (inclusive)";
  const prevTop = wageBrackets[index - 1].upTo;
  return prevTop === null || prevTop === "" ? "$0" : "$" + (Number(prevTop) + 1);
}

function updateBracket(i, field, value) {
  if (field === "upTo") {
    wageBrackets[i].upTo = value === "" ? null : Number(value);
  } else {
    wageBrackets[i].rate = Number(value) || 0;
  }
  renderWageBracketRows();
}

function addBracket() {
  // New bracket starts above the current top; if the previous "last" bracket
  // had no cap, give it one now so there's still exactly one open-ended row.
  if (wageBrackets.length && wageBrackets[wageBrackets.length - 1].upTo === null) {
    wageBrackets[wageBrackets.length - 1].upTo = 100;
  }
  wageBrackets.push({ upTo: null, rate: 0 });
  renderWageBracketRows();
}

function removeBracket(i) {
  wageBrackets.splice(i, 1);
  renderWageBracketRows();
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("percent", 26) + " Tax";
  document.getElementById("hRates").innerHTML = icon("percent", 18) + " Tax rates";
  document.getElementById("saveBtn").innerHTML = icon("bank", 15) + " Save tax rates";
  document.getElementById("hWageBrackets").innerHTML = icon("percent", 18) + " Wage tax brackets";
  document.getElementById("hCurrent").innerHTML = icon("percent", 18) + " Current tax rates";
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
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processMortgages(u.classCode), "processMortgages"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const cls = await getClassCached(CURRENT.classCode);
  const rates = cls.taxRates || {};
  wageBrackets = (cls.wageTaxBrackets || []).map(b => ({ upTo: b.upTo, rate: b.rate }));

  if (IS_TEACHER) {
    const grid = document.getElementById("taxGrid");
    grid.innerHTML = TAX_CATEGORIES.map(c => `
      <div>
        <label for="tax-${c.key}">${c.label} ${c.kind === "income" ? "" : ""}</label>
        <input type="number" min="0" max="100" step="0.5" id="tax-${c.key}" value="${rates[c.key] || 0}">
      </div>
    `).join("");
    renderWageBracketRows();
  } else {
    const box = document.getElementById("studentTaxList");
    box.innerHTML = TAX_CATEGORIES.map(c => `
      <div class="auto-row">
        <div class="auto-details">${c.label}</div>
        <strong>${rates[c.key] || 0}%</strong>
      </div>
    `).join("");

    const wageBox = document.getElementById("studentWageBrackets");
    if (!wageBrackets.length) {
      wageBox.innerHTML = `<div class="auto-row"><div class="auto-details">Wages (income tax)</div><strong>0%</strong></div>`;
    } else {
      const sorted = wageBrackets.slice().sort((a, b) => {
        const aTop = a.upTo == null ? Infinity : a.upTo;
        const bTop = b.upTo == null ? Infinity : b.upTo;
        return aTop - bTop;
      });
      wageBox.innerHTML = sorted.map((b, i) => {
        const floor = i === 0 ? 0 : Number(sorted[i - 1].upTo) + 1;
        const rangeLabel = b.upTo == null ? `$${floor} and up` : `$${floor} – $${b.upTo} (inclusive)`;
        return `
        <div class="auto-row">
          <div class="auto-details">Wages: ${rangeLabel}</div>
          <strong>${b.rate}%</strong>
        </div>`;
      }).join("");
    }
  }
}

async function saveRates() {
  const rates = {};
  TAX_CATEGORIES.forEach(c => { rates[c.key] = document.getElementById("tax-" + c.key).value; });
  await saveTaxRates(CURRENT.classCode, rates);
  await saveWageTaxBrackets(CURRENT.classCode, wageBrackets);
  document.getElementById("saveMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
