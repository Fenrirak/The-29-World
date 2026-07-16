let CURRENT, IS_TEACHER;

const TAX_CATEGORIES = [
  { key: "store", label: "Class store purchases", kind: "expense" },
  { key: "insurance", label: "Insurance premiums", kind: "expense" },
  { key: "property", label: "Property purchases", kind: "expense" },
  { key: "transport", label: "Transport purchases", kind: "expense" },
  { key: "wage", label: "Wages (income tax)", kind: "income" },
  { key: "interest", label: "Savings interest (income tax)", kind: "income" },
  { key: "gambling", label: "Gambling winnings (income tax)", kind: "income" }
];

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("percent", 26) + " Tax";
  document.getElementById("hRates").innerHTML = icon("percent", 18) + " Tax rates";
  document.getElementById("saveBtn").innerHTML = icon("bank", 15) + " Save tax rates";
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
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processInsurancePayments(u.classCode);
  await processWeeklyEvents(u.classCode);
  await processWeeklyBigEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const cls = await getClass(CURRENT.classCode);
  const rates = cls.taxRates || {};

  if (IS_TEACHER) {
    const grid = document.getElementById("taxGrid");
    grid.innerHTML = TAX_CATEGORIES.map(c => `
      <div>
        <label for="tax-${c.key}">${c.label} ${c.kind === "income" ? "" : ""}</label>
        <input type="number" min="0" max="100" step="0.5" id="tax-${c.key}" value="${rates[c.key] || 0}">
      </div>
    `).join("");
  } else {
    const box = document.getElementById("studentTaxList");
    box.innerHTML = TAX_CATEGORIES.map(c => `
      <div class="auto-row">
        <div class="auto-details">${c.label}</div>
        <strong>${rates[c.key] || 0}%</strong>
      </div>
    `).join("");
  }
}

async function saveRates() {
  const rates = {};
  TAX_CATEGORIES.forEach(c => { rates[c.key] = document.getElementById("tax-" + c.key).value; });
  await saveTaxRates(CURRENT.classCode, rates);
  document.getElementById("saveMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
