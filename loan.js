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
  document.getElementById("labMaxLoanCount").innerHTML = icon("handshake", 13) + " Maximum number of loans a student can have open at once (0 = no limit)";
  document.getElementById("saveMaxLoanBtn").innerHTML = icon("plus", 13) + " Save maximums";
  document.getElementById("hLoanLifestyle").innerHTML = icon("star", 18) + " Lifestyle rating penalty";
  document.getElementById("labLoanLifestyleEnabled").textContent = "Dock lifestyle points for outstanding loans";
  document.getElementById("labLoanLifestylePoints").innerHTML = icon("star", 13) + " Lifestyle points lost";
  document.getElementById("labLoanLifestylePerAmount").innerHTML = icon("coin", 13) + " Per this much owed";
  document.getElementById("saveLoanLifestyleBtn").innerHTML = icon("plus", 13) + " Save penalty";
  document.getElementById("hTake").innerHTML = icon("handshake", 18) + " Take out a loan";
  document.getElementById("labLoanAmount").innerHTML = icon("coin", 13) + " How much do you want to borrow?";
  document.getElementById("takeLoanBtn").innerHTML = icon("send", 15) + " Borrow";
  document.getElementById("hMyLoan").innerHTML = icon("handshake", 18) + " My loans";
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
  const cls = withNewModuleDefaults(await getClassCached(CURRENT.classCode));
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
    document.getElementById("maxLoanCountInput").value = cls.maxLoanCount || "";
    const lc = cls.lifestyleConfig.loan;
    document.getElementById("loanLifestyleEnabled").checked = !!(lc && lc.enabled);
    document.getElementById("loanLifestylePoints").value = lc && lc.points ? lc.points : "";
    document.getElementById("loanLifestylePerAmount").value = lc && lc.perAmount ? lc.perAmount : "";
  }

  if (!IS_TEACHER) {
    const me = await getUserCached(CURRENT.username);
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
    const activeLoans = loans.filter(l => l.status === "active");
    const atCountLimit = cls.maxLoanCount > 0 && activeLoans.length >= cls.maxLoanCount;
    document.getElementById("noLoan").classList.toggle("hidden", activeLoans.length > 0 || atCountLimit);
    document.getElementById("loanLimitReached").classList.toggle("hidden", !atCountLimit);
    if (atCountLimit) {
      document.getElementById("loanLimitReached").textContent =
        `You have ${cls.maxLoanCount} loan${cls.maxLoanCount === 1 ? "" : "s"} open — that's the max your teacher allows at once. Pay one off to borrow again.`;
    }

    const lc = cls.lifestyleConfig.loan;
    const noteEl = document.getElementById("loanLifestyleNote");
    if (lc && lc.enabled && lc.perAmount > 0 && lc.points > 0) {
      const currentOwed = activeLoans.reduce((sum, l) => sum + l.owed, 0);
      const pointsLost = Math.floor(currentOwed / lc.perAmount) * lc.points;
      noteEl.classList.remove("hidden");
      noteEl.innerHTML = pointsLost > 0
        ? `${icon("star", 13)} Owing ${fmtMoney(currentOwed)} is currently costing you <strong>${pointsLost} lifestyle point${pointsLost === 1 ? "" : "s"}</strong> (${lc.points} point${lc.points === 1 ? "" : "s"} lost per ${fmtMoney(lc.perAmount)} owed).`
        : `${icon("star", 13)} Loans here cost lifestyle points once you owe ${fmtMoney(lc.perAmount)} or more (${lc.points} point${lc.points === 1 ? "" : "s"} per ${fmtMoney(lc.perAmount)} owed).`;
    } else {
      noteEl.classList.add("hidden");
    }

    const box = document.getElementById("myLoanBox");
    box.innerHTML = "";
    document.getElementById("loanAmount").closest("form").querySelector("button").disabled = atCountLimit;
    const todayKey = nzDateKeyLocal();
    activeLoans.forEach(loan => {
      const overdue = loan.dueDate < todayKey;
      const row = document.createElement("div");
      row.className = "card company-card";
      row.style.marginBottom = "12px";
      row.innerHTML = `
        <div class="auto-row">
          <div class="auto-details">
            <strong>${fmtMoney(loan.principal)}</strong> borrowed &middot; ${loan.rate}% over ${termLabel(loan.termWeeks)}
            <div class="muted-small">Due ${loan.dueDate}${overdue ? " — overdue" : ""}</div>
          </div>
          <div class="${overdue ? 'status-declined' : 'status-pending'}">${fmtMoney(loan.owed)} owed</div>
        </div>
        <form onsubmit="return repayLoanForm(event, '${loan.id}')" style="margin-top:12px;">
          <label for="repayAmount-${loan.id}">Repay amount (up to ${fmtMoney(loan.owed)})</label>
          <input id="repayAmount-${loan.id}" type="number" min="0.01" max="${loan.owed}" step="0.01" required>
          <button class="btn gold" type="submit">Make a repayment</button>
        </form>
        <div id="repayMsg-${loan.id}"></div>
      `;
      box.appendChild(row);
    });

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
  const cls = withNewModuleDefaults(await getClassCached(CURRENT.classCode));
  const amount = Number(document.getElementById("loanAmount").value);
  const preview = document.getElementById("loanPreview");
  if (!amount || amount <= 0) { preview.textContent = ""; return; }
  const tier = findLoanTier(cls, amount);
  if (!tier) { preview.innerHTML = `<span class="ticker-down">That amount doesn't fall within any available loan range.</span>`; return; }
  const interest = Math.round(amount * (tier.rate / 100) * 100) / 100;
  const owed = Math.round((amount + interest) * 100) / 100;
  let text = `You'd owe <strong>${fmtMoney(owed)}</strong> total (${fmtMoney(interest)} interest), due back in ${termLabel(tier.termWeeks)}.`;
  const lc = cls.lifestyleConfig.loan;
  if (lc && lc.enabled && lc.perAmount > 0 && lc.points > 0) {
    const me = await getUserCached(CURRENT.username);
    const currentOwed = (me.loans || []).filter(l => l.status === "active").reduce((sum, l) => sum + l.owed, 0);
    const pointsAfter = Math.floor((currentOwed + owed) / lc.perAmount) * lc.points;
    if (pointsAfter > 0) {
      text += `<div class="muted-small">This would put you at ${fmtMoney(currentOwed + owed)} owed in total — costing you ${pointsAfter} lifestyle point${pointsAfter === 1 ? "" : "s"}.</div>`;
    }
  }
  preview.innerHTML = text;
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
  const cls = await getClassCached(CURRENT.classCode);
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
  const count = document.getElementById("maxLoanCountInput").value || 0;
  await Promise.all([
    setMaxLoanAmount(CURRENT.classCode, amount),
    setMaxLoanCount(CURRENT.classCode, count)
  ]);
  document.getElementById("maxLoanMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function saveLoanLifestylePenalty() {
  const enabled = document.getElementById("loanLifestyleEnabled").checked;
  const points = document.getElementById("loanLifestylePoints").value || 0;
  const perAmount = document.getElementById("loanLifestylePerAmount").value || 0;
  if (enabled && (!(Number(points) > 0) || !(Number(perAmount) > 0))) {
    document.getElementById("loanLifestyleMsg").innerHTML = `<div class="error-msg">Enter both a points value and an amount greater than zero to turn this on.</div>`;
    return;
  }
  await setLoanLifestylePenalty(CURRENT.classCode, { enabled, points, perAmount });
  document.getElementById("loanLifestyleMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
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
  const amount = document.getElementById(`repayAmount-${loanId}`).value;
  const res = await repayLoan(CURRENT.username, loanId, amount);
  if (!res.ok) {
    document.getElementById(`repayMsg-${loanId}`).innerHTML = `<div class="error-msg">${res.error}</div>`;
    return false;
  }
  await render();
  return false;
}

document.addEventListener("DOMContentLoaded", init);
