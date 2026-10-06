/* ===================== The 29 World — Family view (parent.html) =====================
   A read-only report card for a student's family, opened from a link the
   student or their teacher made (see "Parent view" in data-money.js, and
   the Family links buttons on the Reports page).

   Deliberately loads none of the data-*.js files: nobody logs in here, and
   the only thing this page can read is the one /parentViews/{token}
   summary its link points at (see firestore.rules). The few helpers it
   needs are copied below rather than pulling in the whole data layer.
================================================================================ */

function pvEscape(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same format as fmtMoney() in data-core.js.
function pvMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pvIcon(name, size) {
  return typeof icon === "function" ? icon(name, size) : "";
}

function pvTimeAgo(ts) {
  ts = Number(ts);
  if (!ts) return "a while ago";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return "on " + new Date(ts).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
}

function pvBars(map, colorClass, emptyText) {
  const entries = Object.entries(map && typeof map === "object" ? map : {})
    .map(([label, amt]) => [label, Number(amt) || 0]).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="muted-small">${emptyText}</p>`;
  const max = Math.max(...entries.map(e => e[1]));
  return entries.map(([label, amt]) => `
    <div class="rpt-bar-row">
      <div class="rpt-bar-label">${pvEscape(label)}</div>
      <div class="rpt-bar-track"><div class="rpt-bar-fill ${colorClass}" style="width:${max ? Math.round((amt / max) * 100) : 0}%"></div></div>
      <div class="rpt-bar-amount">${pvMoney(amt)}</div>
    </div>`).join("");
}

function pvShowError(title, text) {
  document.getElementById("parentLoading").classList.add("hidden");
  if (title) document.getElementById("parentErrorTitle").textContent = title;
  if (text) document.getElementById("parentErrorText").textContent = text;
  document.getElementById("parentError").classList.remove("hidden");
}

function pvRender(doc) {
  const v = doc.view || {};
  const first = String(v.name || "Your child").trim().split(/\s+/)[0];
  document.title = `${v.name || "Report card"} — Family View — The 29 World`;

  // Everything in the summary was written by a browser, so text is always
  // escaped and numbers are always forced to be numbers before display.
  const goals = Array.isArray(v.goals) ? v.goals : [];
  const loanCount = Math.max(0, Math.floor(Number(v.activeLoanCount) || 0));
  const goalsHtml = goals.length
    ? goals.map(g => {
        const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
        const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((saved / target) * 100))) : 0;
        return `
          <div class="goal-row">
            <div class="goal-head">
              <strong class="goal-name">${pvEscape(g.name)}</strong>
              ${g.reached ? `<span class="badge mint">${pvIcon("star", 12)} Reached!</span>` : ""}
              <span class="goal-amounts">${pvMoney(saved)} of ${pvMoney(target)}</span>
            </div>
            <div class="rpt-bar-track goal-track"><div class="rpt-bar-fill ${g.reached ? "mint" : "gold"}" style="width:${pct}%"></div></div>
          </div>`;
      }).join("")
    : `<p class="muted-small">${pvEscape(first)} hasn't set any savings goals yet.</p>`;

  const owns = [
    ["Cash", v.balance], ["Savings account", v.savings], ["Term deposits", v.termDeposits],
    ["Shares", v.invested], ["Property", v.propertyValue], ["Vehicles", v.vehicleValue], ["Store items", v.storeValue]
  ].filter(([, amt]) => Number(amt));

  document.getElementById("parentReport").innerHTML = `
    <div class="card parent-hero">
      <div class="flex-between" style="align-items:flex-start;">
        <div>
          <h1 style="margin-bottom:4px;">${pvEscape(v.name)}'s report card</h1>
          <p class="muted-small" style="margin:0;">
            ${v.className ? pvEscape(v.className) : ""}${v.teacherName ? ` · Teacher: ${pvEscape(v.teacherName)}` : ""}${v.job ? ` · Job: ${pvEscape(v.job)}` : ""}
          </p>
          <p class="muted-small" style="margin:4px 0 0;">Last updated ${pvTimeAgo(doc.updatedAt)}.</p>
        </div>
        <button class="btn small secondary no-print" style="margin-top:0;" onclick="window.print()">Print</button>
      </div>
      <div class="parent-explainer">
        <strong>What is this?</strong> The 29 World is a classroom money game. Students earn, save, spend and invest
        <em>pretend</em> money to practise real money skills. None of the amounts here are real money.
      </div>
    </div>

    <div class="grid grid-4">
      <div class="stat gold"><span class="icon">${pvIcon("medal", 30)}</span><div class="label">Net worth</div><div class="value">${pvMoney(v.netWorth)}</div></div>
      <div class="stat mint"><span class="icon">${pvIcon("piggy", 30)}</span><div class="label">Savings account</div><div class="value">${pvMoney(v.savings)}</div></div>
      <div class="stat lilac"><span class="icon">${pvIcon("coin", 30)}</span><div class="label">Cash</div><div class="value">${pvMoney(v.balance)}</div></div>
      <div class="stat sky"><span class="icon">${pvIcon("percent", 30)}</span><div class="label">Savings rate</div><div class="value">${Number.isFinite(Number(v.savingsRate)) && v.savingsRate !== null ? Number(v.savingsRate) + "%" : "—"}</div><div class="muted-small" style="color:inherit;opacity:.85;margin-top:2px;">of this month's income</div></div>
    </div>

    <div class="card">
      <h2>${pvIcon("trophy", 18)} Savings goals</h2>
      ${goalsHtml}
    </div>

    <div class="card">
      <h2>${pvIcon("calendar", 18)} ${pvEscape(v.monthLabel || "This month")}</h2>
      <div class="profile-summary">
        <div class="profile-chip"><div class="label">Earned</div><div class="value">${pvMoney(v.incomeTotal)}</div></div>
        <div class="profile-chip"><div class="label">Saved &amp; invested</div><div class="value">${pvMoney(v.savedTotal)}</div></div>
        <div class="profile-chip"><div class="label">Spent</div><div class="value">${pvMoney(v.spentTotal)}</div></div>
      </div>
      <h4>Where the money came from</h4>
      ${pvBars(v.income, "gold", "Nothing earned yet this month.")}
      <h4>Saved &amp; invested</h4>
      ${pvBars(v.saved, "mint", "Nothing set aside yet this month.")}
      <h4>Spent on</h4>
      ${pvBars(v.spent, "coral", "Nothing spent yet this month.")}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>${pvIcon("bank", 18)} What ${pvEscape(first)} has</h2>
        ${owns.length ? `<table><tbody>${owns.map(([label, amt]) => `<tr><td>${label}</td><td>${pvMoney(amt)}</td></tr>`).join("")}
          ${Number(v.owed) ? `<tr><td>Owes (loans and mortgage)</td><td>-${pvMoney(v.owed)}</td></tr>` : ""}
        </tbody></table>` : `<p class="muted-small">Nothing yet.</p>`}
        ${loanCount ? `<p class="muted-small">${loanCount} loan${loanCount === 1 ? "" : "s"} still being paid off.</p>` : ""}
      </div>
      <div class="card">
        <h2>${pvIcon("star", 18)} Since joining</h2>
        <table><tbody>
          <tr><td>Earned in total</td><td>${pvMoney(v.lifetimeIncomeTotal)}</td></tr>
          <tr><td>Saved &amp; invested in total</td><td>${pvMoney(v.lifetimeSavedTotal)}</td></tr>
          <tr><td>Spent in total</td><td>${pvMoney(v.lifetimeSpentTotal)}</td></tr>
        </tbody></table>
      </div>
    </div>

    <div class="card no-print">
      <h2>${pvIcon("users", 18)} Things to talk about</h2>
      <ul class="parent-tips">
        <li>What are you saving up for, and how long will it take to get there?</li>
        <li>What did you spend the most on this month? Was it worth it?</li>
        <li>Have you tried the bank's savings account or the stock market yet? What happened?</li>
      </ul>
    </div>
  `;
  document.getElementById("parentLoading").classList.add("hidden");
  document.getElementById("parentReport").classList.remove("hidden");
}

async function pvInit() {
  const token = new URLSearchParams(window.location.search).get("t") || "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) { pvShowError(); return; }
  if (typeof fdb === "undefined") {
    pvShowError("Can't connect right now", "Check your internet connection, then reload this page.");
    return;
  }
  try {
    const snap = await fdb.collection("parentViews").doc(token).get();
    if (!snap.exists) { pvShowError(); return; }
    pvRender(snap.data());
  } catch (e) {
    console.error(e);
    if (navigator.onLine === false || (e && (e.code === "unavailable" || /offline/i.test(e.message || "")))) {
      pvShowError("Can't connect right now", "Check your internet connection, then reload this page.");
    } else {
      pvShowError();
    }
  }
}

document.addEventListener("DOMContentLoaded", pvInit);
