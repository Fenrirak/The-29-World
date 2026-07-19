let CURRENT, IS_TEACHER;

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("handshake", 26) + " Loans";
  document.getElementById("hSettings").innerHTML = icon("handshake", 18) + " Loan settings";
  document.getElementById("addTierBtn").innerHTML = icon("plus", 15) + " Add loan range";
  document.getElementById("labTierMin").innerHTML = icon("coin", 13) + " Minimum amount";
  document.getElementById("labTierMax").innerHTML = icon("coin", 13) + " Maximum amount";
  document.getElementById("labTierTerm").innerHTML = icon("calendar", 13) + " Term (weeks)";
  document.getElementById("labTierRate").innerHTML = icon("percent", 13) + " Interest rate (% of the loan, charged once)";
  document.getElementById("labMaxLoan").innerHTML = icon("handshake", 13) + " Overall maximum loan amount (0 = no extra cap beyond the ranges above)";
  document.getElementById("saveMaxLoanBtn").innerHTML = icon("plus", 13) + " Save maximum";
  document.getElementById("hTake").innerHTML = icon("handshake", 18) + " Take out a loan";
  document.getElementById("labLoanAmount").innerHTML = icon("coin", 13) + " How much do you want to borrow?";
  document.getElementById("takeLoanBtn").innerHTML = icon("send", 15) + " Borrow";
  document.getElementById("hMyLoan").innerHTML = icon("handshake", 18) + " My loan";
  document.getElementById("hPastLoans").innerHTML = icon("handshake", 18) + " Loan history";
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
  document.getElementById("loanAmount").addEventListener("input", updateLoanPreview);
  await render();
}

function termLabel(weeks) {
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

async function render() {
  const cls = await getClass(CURRENT.classCode);
  const tiers = cls.loanTiers || [];

  if (IS_TEACHER) {
    const list = document.getElementById("tierList");
    list.innerHTML = "";
    document.getElementById("noTiers").classList.toggle("hidden", tiers.length > 0);
    tiers.forEach(t => {
      const div = document.createElement("div");
      div.className = "card company-card";
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("handshake", 20)}${fmtMoney(t.min)} — ${fmtMoney(t.max)}</h4>
            <p>${termLabel(t.termWeeks)} term &middot; <strong>${t.rate}%</strong> interest (charged once, on the whole loan)</p>
          </div>
          <div>
            <button class="btn small secondary" onclick="editTier('${t.id}')">${icon("idcard", 13)} Edit</button>
            <button class="btn small coral" onclick="removeTier('${t.id}')">${icon("trash", 13)} Remove</button>
          </div>
        </div>
      `;
      list.appendChild(div);
    });
    document.getElementById("maxLoanInput").value = cls.maxLoanAmount || "";
  }

  if (!IS_TEACHER) {
    const me = await getUser(CURRENT.username);
    const optBox = document.getElementById("loanOptionsList");
    optBox.innerHTML = "";
    document.getElementById("noTiersStudent").classList.toggle("hidden", tiers.length > 0);
    if (tiers.length > 0) {
      const rows = tiers.slice().sort((a, b) => a.min - b.min).map(t =>
        `<div class="auto-row"><div class="auto-details">${fmtMoney(t.min)} – ${fmtMoney(t.max)}<div class="muted-small">${termLabel(t.termWeeks)} &middot; ${t.rate}% interest</div></div></div>`
      ).join("");
      optBox.innerHTML = rows;
    }

    const loans = me.loans || [];
    const activeLoan = loans.find(l => l.status === "active");
    document.getElementById("noLoan").classList.toggle("hidden", !!activeLoan);
    const box = document.getElementById("myLoanBox");
    box.innerHTML = "";
    document.getElementById("loanAmount").closest("form").querySelector("button").disabled = !!activeLoan;
    if (activeLoan) {
      const todayKey = nzDateKeyLocal();
      const overdue = activeLoan.dueDate < todayKey;
      box.innerHTML = `
        <div class="auto-row">
          <div class="auto-details">
            <strong>${fmtMoney(activeLoan.principal)}</strong> borrowed &middot; ${activeLoan.rate}% over ${termLabel(activeLoan.termWeeks)}
            <div class="muted-small">Due ${activeLoan.dueDate}${overdue ? " — overdue" : ""}</div>
          </div>
          <div class="${overdue ? 'status-declined' : 'status-pending'}">${fmtMoney(activeLoan.owed)} owed</div>
        </div>
        <form onsubmit="return repayLoanForm(event, '${activeLoan.id}')" style="margin-top:12px;">
          <label>Repay amount (up to ${fmtMoney(activeLoan.owed)})</label>
          <input id="repayAmount" type="number" min="0.01" max="${activeLoan.owed}" step="0.01" required>
          <button class="btn gold" type="submit">Make a repayment</button>
        </form>
        <div id="repayMsg"></div>
      `;
    }

    const past = loans.filter(l => l.status === "paid").slice().reverse();
    document.getElementById("pastLoansCard").classList.toggle("hidden", past.length === 0);
    const pastBox = document.getElementById("pastLoansList");
    pastBox.innerHTML = "";
    past.forEach(l => {
      const row = document.createElement("div");
      row.className = "auto-row";
      row.innerHTML = `<div class="auto-details"><strong>${fmtMoney(l.principal)}</strong> borrowed &middot; ${l.rate}% over ${termLabel(l.termWeeks)}<div class="muted-small">Taken ${l.takenDate}</div></div><span class="status-approved">Paid off</span>`;
      pastBox.appendChild(row);
    });

    updateLoanPreview();
  }
}

// Same NZ-calendar date key format used server-side, computed client-side
// just for the "is this overdue" comparison in the UI.
function nzDateKeyLocal() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" });
  return fmt.format(new Date());
}

async function updateLoanPreview() {
  const cls = await getClass(CURRENT.classCode);
  const amount = Number(document.getElementById("loanAmount").value);
  const preview = document.getElementById("loanPreview");
  if (!amount || amount <= 0) { preview.textContent = ""; return; }
  const tier = findLoanTier(cls, amount);
  if (!tier) { preview.innerHTML = `<span class="ticker-down">That amount doesn't fall within any available loan range.</span>`; return; }
  const interest = Math.round(amount * (tier.rate / 100) * 100) / 100;
  const owed = Math.round((amount + interest) * 100) / 100;
  preview.innerHTML = `You'd owe <strong>${fmtMoney(owed)}</strong> total (${fmtMoney(interest)} interest), due back in ${termLabel(tier.termWeeks)}.`;
}

async function addTier(e) {
  e.preventDefault();
  const tier = {
    min: document.getElementById("tierMin").value,
    max: document.getElementById("tierMax").value,
    termWeeks: document.getElementById("tierTerm").value,
    rate: document.getElementById("tierRate").value
  };
  if (Number(tier.min) >= Number(tier.max)) {
    document.getElementById("tierMsg").innerHTML = `<div class="error-msg">The maximum amount needs to be more than the minimum.</div>`;
    return false;
  }
  const editingId = document.getElementById("addTierBtn").dataset.editingId;
  if (editingId) {
    await updateLoanTier(CURRENT.classCode, editingId, tier);
    delete document.getElementById("addTierBtn").dataset.editingId;
    document.getElementById("addTierBtn").innerHTML = icon("plus", 15) + " Add loan range";
  } else {
    await addLoanTier(CURRENT.classCode, tier);
  }
  ["tierMin", "tierMax", "tierTerm", "tierRate"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("tierMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
  return false;
}

async function editTier(id) {
  const cls = await getClass(CURRENT.classCode);
  const tier = (cls.loanTiers || []).find(t => t.id === id);
  if (!tier) return;
  document.getElementById("tierMin").value = tier.min;
  document.getElementById("tierMax").value = tier.max;
  document.getElementById("tierTerm").value = tier.termWeeks;
  document.getElementById("tierRate").value = tier.rate;
  document.getElementById("addTierBtn").dataset.editingId = id;
  document.getElementById("addTierBtn").innerHTML = icon("plus", 15) + " Save changes";
  document.getElementById("addTierBtn").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function removeTier(id) {
  if (confirm("Remove this loan range?")) {
    await removeLoanTier(CURRENT.classCode, id);
    await render();
  }
}

async function saveMaxLoan() {
  const amount = document.getElementById("maxLoanInput").value || 0;
  await setMaxLoanAmount(CURRENT.classCode, amount);
  document.getElementById("maxLoanMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function takeLoanForm(e) {
  e.preventDefault();
  const amount = document.getElementById("loanAmount").value;
  const res = await takeLoan(CURRENT.username, CURRENT.classCode, amount);
  const box = document.getElementById("takeLoanMsg");
  box.innerHTML = res.ok ? `<div class="success-msg">Loan approved — ${fmtMoney(res.owed)} to pay back.</div>` : `<div class="error-msg">${res.error}</div>`;
  if (res.ok) document.getElementById("loanAmount").value = "";
  await render();
  return false;
}

async function repayLoanForm(e, loanId) {
  e.preventDefault();
  const amount = document.getElementById("repayAmount").value;
  const res = await repayLoan(CURRENT.username, loanId, amount);
  if (!res.ok) {
    document.getElementById("repayMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
    return false;
  }
  await render();
  return false;
}

document.addEventListener("DOMContentLoaded", init);
