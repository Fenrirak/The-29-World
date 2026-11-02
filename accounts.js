/* accounts.js — extra everyday + savings accounts on the Bank page.

   Same idea as the credit cards: the teacher builds account PLANS, students
   open the ones they like. All the money rules (opening, approving, moving
   money, interest, fees) live in data-money.js under "Bank accounts"; this
   file only draws screens and calls those functions, then asks bank.js's
   render() to redraw. Card colours and the little card previews are shared
   with creditcard.js (CC_THEMES, ccThemeBg, ccMiniCard...). */

let AC_CLS = null, AC_ME = null, AC_STUDENTS = [];
let AC_FILTER = "all";
let AC_MOVE = { from: "", to: "" };

const acEsc = s => ccEsc(s);
const acMsg = (id, html) => ccMsg(id, html);

/* ---------------- Recommended accounts (teacher one-click add) ----------------
   Rates are a multiple of the class's own savings rate, so they make sense
   whatever interest schedule the class runs. Dollar amounts are fixed. */
const AC_PRESETS = [
  { key: "everyday", kind: "everyday", name: "Everyday Account", theme: "ocean", blurb: "A simple account for day-to-day money. No fees, no fuss.",
    rateMul: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "bills", kind: "everyday", name: "Bills Account", theme: "slate", blurb: "Park money for rent and bills here so it doesn't get spent.",
    rateMul: 0.1, minBalance: 50, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "student", kind: "everyday", name: "Student Account", theme: "emerald", blurb: "Fee-free with a little interest once you have a few dollars in it.",
    rateMul: 0.25, minBalance: 20, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "gold", kind: "everyday", name: "Gold Everyday", theme: "gold", blurb: "Better interest for big balances. Fee is waived once you keep enough in it.",
    rateMul: 0.5, minBalance: 0, fee: 3, feeWaiveAt: 500, withdrawFee: 0, maxBalance: 0, tier: 2 },
  { key: "regular", kind: "savings", name: "Regular Saver", theme: "teal", blurb: "Easy saving. Take your money out whenever you like.",
    rateMul: 1, bonusMul: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 0, tier: -1 },
  { key: "bonus", kind: "savings", name: "Bonus Saver", theme: "violet", blurb: "A small base rate, plus a big bonus if you leave it alone for the whole period.",
    rateMul: 0.5, bonusMul: 1.5, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 0, tier: -1 },
  { key: "notice", kind: "savings", name: "Notice Saver", theme: "midnight", blurb: "The best rate — but you can only take money out once, and it costs a fee.",
    rateMul: 2, bonusMul: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 5, maxWithdrawals: 1, maxBalance: 0, tier: 1 },
  { key: "youth", kind: "savings", name: "Youth Saver", theme: "sunset", blurb: "A boosted rate for beginners, up to a small balance limit.",
    rateMul: 1.5, bonusMul: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 500, tier: -1 },
  { key: "goal", kind: "savings", name: "Goal Saver", theme: "rose", blurb: "Save up for something big. A small fee each time you dip into it keeps you honest.",
    rateMul: 1.25, bonusMul: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 2, maxWithdrawals: 0, maxBalance: 0, tier: -1 },
  { key: "premium", kind: "savings", name: "Premium Saver", theme: "ruby", blurb: "Top interest for serious savers. Needs $200 to start earning; fee waived above $1,000.",
    rateMul: 2.5, bonusMul: 0, minBalance: 200, fee: 2, feeWaiveAt: 1000, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 0, tier: 2 }
];
function acTiers(cls) { return ((cls && cls.lifestyleThresholds) || []).slice().sort((a, b) => Number(a.min) - Number(b.min)); }
function acPresetPlan(cls, pr) {
  const base = Math.max(1, Number(cls.interestRate) || 0);
  const r2 = n => Math.round(n * 100) / 100;
  const th = acTiers(cls);
  const used = new Set((cls.accountPlans || []).filter(p => !p.archived).map(p => p.theme));
  const theme = !used.has(pr.theme) ? pr.theme : acRandomTheme("");
  return {
    name: pr.name, kind: pr.kind, blurb: pr.blurb, theme,
    rate: r2(base * (pr.rateMul || 0)), bonusRate: r2(base * (pr.bonusMul || 0)),
    minBalance: pr.minBalance, fee: pr.fee, feeWaiveAt: pr.feeWaiveAt, withdrawFee: pr.withdrawFee,
    maxWithdrawals: pr.maxWithdrawals || 0, maxBalance: pr.maxBalance,
    minLifestyle: pr.tier >= 0 && th.length ? Number((th[Math.min(pr.tier, th.length - 1)] || {}).min) || 0 : 0
  };
}

/* ---------------- Little building blocks ---------------- */
function acInjectCss() {}
function acPlural(n, w) { return ccPlural(n, w); }
function acKindLabel(k) { return k === "savings" ? "Savings" : "Everyday"; }
function acKindBadge(k) { return `<span class="badge ${k === "savings" ? "mint" : "navy"}">${acKindLabel(k)}</span>`; }
function acTierNeed(cls, rating) {
  if (!rating) return "";
  const t = ccTierForRating(cls, rating);
  return t ? `Needs the ${acEsc(t.label)} tier or higher` : `Needs lifestyle rating ${rating}+`;
}
function acFacts(p) {
  const f = (k, v) => `<div class="cc-fact"><span>${k}</span><strong>${v}</strong></div>`;
  const rows = [f("Interest", p.rate > 0 ? `${p.rate}% each payment` : "None")];
  if (p.bonusRate > 0) rows.push(f("No-withdrawal bonus", `+${p.bonusRate}%`));
  if (p.minBalance > 0) rows.push(f("Earns interest from", fmtMoney(p.minBalance)));
  rows.push(f("Account fee", p.fee > 0 ? `${fmtMoney(p.fee)}${p.feeWaiveAt > 0 ? ` <small>(free from ${fmtMoney(p.feeWaiveAt)})</small>` : ""}` : "None"));
  rows.push(f("Withdrawals", `${p.maxWithdrawals > 0 ? `${p.maxWithdrawals} per period` : "Unlimited"}${p.withdrawFee > 0 ? ` · ${fmtMoney(p.withdrawFee)} each` : ""}`));
  if (p.maxBalance > 0) rows.push(f("Balance limit", fmtMoney(p.maxBalance)));
  return `<div class="cc-facts">${rows.join("")}</div>`;
}
function acPerks(p) {
  const out = [];
  if (p.bonusRate > 0) out.push(`<span class="cc-chip mint">${icon("star", 12)}+${p.bonusRate}% bonus if untouched</span>`);
  if (!(p.fee > 0) && !(p.withdrawFee > 0)) out.push(`<span class="cc-chip mint">${icon("check", 12)}No fees</span>`);
  else if (p.fee > 0 && p.feeWaiveAt > 0) out.push(`<span class="cc-chip gold">${icon("coin", 12)}Fee-free from ${fmtMoney(p.feeWaiveAt)}</span>`);
  if (p.maxWithdrawals > 0) out.push(`<span class="cc-chip lilac">${icon("lock", 12)}${acPlural(p.maxWithdrawals, "withdrawal")} per period</span>`);
  if (p.maxBalance > 0) out.push(`<span class="cc-chip plain">Up to ${fmtMoney(p.maxBalance)}</span>`);
  return out.join("");
}
function acRandomTheme(planId) {
  const all = (AC_CLS && AC_CLS.accountPlans) || [];
  const used = new Set(all.filter(p => !p.archived && p.id !== planId).map(p => p.theme));
  let pool = CC_THEMES.filter(t => !used.has(t.id));
  if (!pool.length) pool = CC_THEMES.slice();
  const own = planId ? ((all.find(p => p.id === planId) || {}).theme) : "";
  if (pool.length > 1) pool = pool.filter(t => t.id !== own);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/* ---------------- Entry point (called from bank.js render) ---------------- */
function renderBankAccounts(me, cls, students) {
  AC_CLS = cls; AC_ME = me; AC_STUDENTS = students || [];
  const sCard = document.getElementById("acctCard"), tCard = document.getElementById("acctTeacherCard");
  if (!sCard || !tCard) return;
  acInjectCss();
  sCard.classList.toggle("hidden", IS_TEACHER);
  tCard.classList.toggle("hidden", !IS_TEACHER);
  const stat = document.getElementById("acctStat");
  const mine = IS_TEACHER ? [] : acctActiveOf(me);
  if (stat) {
    stat.classList.toggle("hidden", !mine.length);
    if (mine.length) {
      document.getElementById("iconAcctStat").innerHTML = icon("wallet", 26);
      document.getElementById("acctTotal").textContent = fmtMoney(acctTotalOf(me));
      document.getElementById("acctStatNote").textContent = `Across ${acPlural(mine.length, "extra account")}`;
    }
  }
  if (IS_TEACHER) acRenderTeacher(cls, AC_STUDENTS); else acRenderStudent(me, cls);
}
// How many stat tiles are showing up top (bank.js uses this to pick a 2- or 3-column grid)
function acStatVisible() { const s = document.getElementById("acctStat"); return !!s && !s.classList.contains("hidden"); }

/* ================= Student ================= */
function acRenderStudent(me, cls) {
  const el = document.getElementById("acctCard");
  const st = acctSettings(cls), plans = acctPlansOf(cls);
  const list = acctListOf(me);
  const active = list.filter(a => a.status === "active"), pending = list.filter(a => a.status === "pending");
  const off = !st.enabled;
  const held = new Set(list.map(a => a.planId));
  const countKind = k => list.filter(a => (a.status === "active" || a.status === "pending") && (acctPlanById(cls, a.planId) || {}).kind === k).length;
  const full = { everyday: countKind("everyday") >= st.maxEveryday, savings: countKind("savings") >= st.maxSavings };
  const head = note => `<div class="flex-between cc-head"><h2 id="hAcct">Your accounts</h2>${note ? `<span class="cc-head-note">${note}</span>` : ""}</div>`;

  let html = head(off ? "Not open yet" : st.approval === "teacher" ? "Teacher approval needed" : "Open instantly");
  html += `<p class="cc-intro">Your cash balance and Savings Account above always stay put. Open extra <strong>everyday</strong> and <strong>savings</strong> accounts to organise your money — each one has its own interest, fees and rules. ${interestScheduleLabel(cls)}</p>`;

  // ---- accounts I own ----
  if (active.length) {
    html += `<h3 class="cc-sub">${icon("piggy", 16)} My accounts (${active.length})</h3><div class="ac-own-grid">${active.map(a => acOwnedTile(a, cls)).join("")}</div>`;
    html += acMovePanel(me, cls);
  }
  if (pending.length) {
    html += `<h3 class="cc-sub">${icon("history", 16)} Waiting for approval</h3><div class="ac-pend">${pending.map(a => {
      const p = acctPlanById(cls, a.planId);
      return `<div class="ac-pend-row"><div>${p ? `<strong>${acEsc(p.name)}</strong> ${acKindBadge(p.kind)}` : `<strong>Account</strong>`}<div class="muted-small">Your teacher will approve it soon — nothing else to do.</div></div>
        <button class="btn small secondary" onclick="acCancelApp('${acEsc(a.id)}')">Withdraw</button></div>`;
    }).join("")}</div>`;
  }

  // ---- accounts I could open ----
  const avail = plans.filter(p => !held.has(p.id)).sort((a, b) => (a.kind === b.kind ? b.rate - a.rate : a.kind === "everyday" ? -1 : 1));
  const shown = avail.filter(p => AC_FILTER === "all" || p.kind === AC_FILTER);
  html += `<h3 class="cc-sub">${icon("plus", 16)} Open an account</h3>`;
  if (!plans.length) {
    html += `<div class="cc-off">${icon("lock", 22)}<div><strong>No accounts on offer yet</strong><span>${off ? "Your teacher hasn't switched extra accounts on." : "Your teacher hasn't set any up yet."} Check back soon.</span></div></div>`;
  } else {
    if (off) html += `<div class="cc-off">${icon("lock", 22)}<div><strong>Opening accounts isn't switched on yet</strong><span>Have a look below — your teacher will open applications soon.</span></div></div>`;
    if (!avail.length) html += `<div class="empty-state"><p>You've opened every account on offer. Nice.</p></div>`;
    else {
      const kinds = ["all", "everyday", "savings"];
      html += `<div class="ac-filter" role="tablist" aria-label="Account type">${kinds.map(k => `<button type="button" role="tab" aria-selected="${AC_FILTER === k}" class="${AC_FILTER === k ? "on" : ""}" onclick="acSetFilter('${k}')">${k === "all" ? "All" : acKindLabel(k)}</button>`).join("")}</div>`;
      html += shown.length ? `<div class="cc-plans">${shown.map(p => acPlanTile(me, cls, p, off, full)).join("")}</div>` : `<div class="empty-state"><p>Nothing to show here.</p></div>`;
    }
  }
  html += `<div id="acMsg"></div>`;
  el.innerHTML = html;
  acMoveHint();
}
function acPlanTile(me, cls, p, off, full) {
  const score = lifestyleRatingFromData(cls, me, me.username);
  const locked = score < p.minLifestyle;
  const instant = acctSettings(cls).approval !== "teacher";
  const atMax = full[p.kind];
  let action;
  if (off) action = `<div class="cc-lock">${icon("lock", 14)}<span>Not open yet</span></div>`;
  else if (locked) action = `<div class="cc-lock">${icon("lock", 14)}<span>${acTierNeed(cls, p.minLifestyle)} — yours is ${Math.floor(score * 10) / 10}</span></div>`;
  else if (atMax) action = `<div class="cc-lock">${icon("lock", 14)}<span>You've reached the limit of ${p.kind} accounts</span></div>`;
  else action = `<button class="btn gold" onclick="acOpen('${acEsc(p.id)}')">${instant ? "Open this account" : "Apply for this account"}</button>`;
  return `<div class="cc-plan ac-plan ${locked || off || atMax ? "locked" : ""}">
    <div class="cc-plan-body">
      <div class="ac-tile-head"><strong>${acEsc(p.name)}</strong>${acKindBadge(p.kind)}</div>
      ${p.blurb ? `<p class="ac-blurb">${acEsc(p.blurb)}</p>` : ""}
      ${acFacts(p)}
      <div class="cc-perks">${acPerks(p)}</div>
      ${action}
    </div></div>`;
}
function acOwnedTile(a, cls) {
  const p = acctPlanById(cls, a.planId);
  if (!p) return `<article class="ac-own"><div class="ac-own-body"><strong>Account</strong><p class="muted-small">Your teacher removed this plan. You can still move your ${fmtMoney(a.balance || 0)} out below or close it.</p>
      <div class="ac-own-actions"><button class="btn small secondary" onclick="acClose('${acEsc(a.id)}')">Close &amp; move to cash</button></div></div></article>`;
  const bal = acctRound(a.balance || 0), wd = a.wd || 0, lt = a.lifetime || {};
  const bonus = wd === 0 && p.bonusRate > 0 ? p.bonusRate : 0;
  const rate = (p.rate || 0) + bonus;
  const gross = bal > 0 && bal >= (p.minBalance || 0) && rate > 0 ? acctRound(bal * rate / 100) : 0;
  const waived = p.feeWaiveAt > 0 && bal >= p.feeWaiveAt;
  const feeDue = p.fee > 0 && bal > 0 && !waived ? Math.min(p.fee, bal) : 0;
  const rows = [];
  rows.push(`<div class="ac-line"><span>Next interest</span><strong class="${gross > 0 ? "good" : ""}">${gross > 0 ? "≈ +" + fmtMoney(gross) : "$0.00"}</strong></div>`);
  if (p.minBalance > 0 && bal < p.minBalance) rows.push(`<div class="ac-hint">Add ${fmtMoney(p.minBalance - bal)} more to start earning interest.</div>`);
  if (p.fee > 0) rows.push(`<div class="ac-line"><span>Account fee</span><strong class="${feeDue > 0 ? "bad" : "good"}">${feeDue > 0 ? "−" + fmtMoney(feeDue) : waived ? "Waived" : "$0.00"}</strong></div>`);
  if (p.fee > 0 && p.feeWaiveAt > 0 && !waived) rows.push(`<div class="ac-hint">Keep ${fmtMoney(p.feeWaiveAt)} in here and the fee is waived.</div>`);
  if (p.bonusRate > 0) rows.push(wd === 0
    ? `<div class="ac-badge good">${icon("star", 13)} Bonus on track — +${p.bonusRate}% if you leave it alone</div>`
    : `<div class="ac-badge bad">${icon("history", 13)} Bonus missed this period — you've taken money out</div>`);
  if (p.maxWithdrawals > 0) {
    const used = Math.min(wd, p.maxWithdrawals), pct = Math.round(used / p.maxWithdrawals * 100);
    rows.push(`<div class="ac-meter"><div class="ac-meter-top"><span>Withdrawals this period</span><strong>${used} of ${p.maxWithdrawals}</strong></div><div class="ac-meter-bar"><i class="${pct >= 100 ? "hot" : ""}" style="width:${pct}%"></i></div></div>`);
  }
  if (p.maxBalance > 0) rows.push(`<div class="ac-line"><span>Room left</span><strong>${fmtMoney(Math.max(0, p.maxBalance - bal))}</strong></div>`);
  return `<article class="ac-own">
    <div class="ac-own-body">
      <div class="ac-tile-head"><strong>${acEsc(p.name)}</strong>${acKindBadge(p.kind)}</div>
      <div class="ac-bal"><span>Balance</span><strong>${fmtMoney(bal)}</strong></div>
      <div class="ac-rows">${rows.join("")}</div>
      <div class="ac-life">Earned so far <b>${fmtMoney(lt.interest || 0)}</b> · Fees paid <b>${fmtMoney(lt.fees || 0)}</b></div>
      <div class="ac-own-actions">
        <button class="btn small gold" onclick="acQuick('${acEsc(a.id)}','in')">${icon("plus", 13)} Add money</button>
        <button class="btn small secondary" onclick="acQuick('${acEsc(a.id)}','out')">${icon("download", 13)} Take out</button>
        <button class="btn small ghost" onclick="acClose('${acEsc(a.id)}')" aria-label="Close ${acEsc(p.name)}">Close</button>
      </div>
    </div></article>`;
}

/* ---------------- Moving money ---------------- */
function acAccountChoices(me, cls) {
  const out = [{ id: "cash", label: "Cash balance", bal: me.balance || 0 }, { id: "savings", label: "Savings Account", bal: me.savings || 0 }];
  acctActiveOf(me).forEach(a => { const p = acctPlanById(cls, a.planId); out.push({ id: a.id, label: p ? p.name : "Account", bal: a.balance || 0 }); });
  return out;
}
function acMovePanel(me, cls) {
  const ch = acAccountChoices(me, cls);
  const ids = ch.map(c => c.id);
  if (!ids.includes(AC_MOVE.from)) AC_MOVE.from = "cash";
  if (!ids.includes(AC_MOVE.to) || AC_MOVE.to === AC_MOVE.from) AC_MOVE.to = ids.find(i => i !== AC_MOVE.from && i !== "cash") || ids.find(i => i !== AC_MOVE.from);
  const opts = sel => ch.map(c => `<option value="${acEsc(c.id)}" ${c.id === sel ? "selected" : ""}>${acEsc(c.label)} — ${fmtMoney(c.bal)}</option>`).join("");
  return `<section class="cc-panel ac-move">
    <div class="cc-panel-head"><h3>Move money</h3><span class="muted-small">Between your cash, Savings Account and the accounts above</span></div>
    <form onsubmit="return acMove(event)" class="ac-move-form">
      <div><label for="acFrom">From</label><select id="acFrom" onchange="acMoveChanged()">${opts(AC_MOVE.from)}</select></div>
      <button type="button" class="ac-swap" onclick="acSwap()" aria-label="Swap from and to" title="Swap">Swap</button>
      <div><label for="acTo">To</label><select id="acTo" onchange="acMoveChanged()">${opts(AC_MOVE.to)}</select></div>
      <div><label for="acAmt">Amount</label><div class="cc-num money"><i>$</i><input id="acAmt" type="number" min="0.01" step="0.01" required inputmode="decimal"></div></div>
      <button class="btn gold" type="submit" id="acMoveBtn">Move money</button>
    </form>
    <div class="ac-move-hint" id="acMoveHint" aria-live="polite"></div>
    <div id="acMoveMsg"></div>
  </section>`;
}
function acMoveChanged() {
  const f = document.getElementById("acFrom"), t = document.getElementById("acTo");
  if (!f || !t) return;
  AC_MOVE.from = f.value; AC_MOVE.to = t.value;
  acMoveHint();
}
function acSwap() {
  const f = document.getElementById("acFrom"), t = document.getElementById("acTo");
  if (!f || !t) return;
  const a = f.value; f.value = t.value; t.value = a;
  acMoveChanged();
}
function acQuick(id, dir) {
  AC_MOVE = dir === "in" ? { from: "cash", to: id } : { from: id, to: "cash" };
  const f = document.getElementById("acFrom"), t = document.getElementById("acTo");
  if (f && t) { f.value = AC_MOVE.from; t.value = AC_MOVE.to; }
  acMoveHint();
  const panel = document.querySelector(".ac-move");
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
  const amt = document.getElementById("acAmt"); if (amt) setTimeout(() => amt.focus({ preventScroll: true }), 350);
}
// Explains the rules that apply to the two accounts currently picked
function acMoveHint() {
  const el = document.getElementById("acMoveHint"); if (!el || !AC_ME) return;
  const f = document.getElementById("acFrom"), t = document.getElementById("acTo");
  const notes = [];
  const acct = id => acctActiveOf(AC_ME).find(a => a.id === id);
  if (f && t && f.value === t.value) notes.push("Pick two different accounts.");
  const src = f && acct(f.value), dst = t && acct(t.value);
  const sp = src && acctPlanById(AC_CLS, src.planId), dp = dst && acctPlanById(AC_CLS, dst.planId);
  if (sp) {
    if (sp.maxWithdrawals > 0) notes.push(`${acEsc(sp.name)}: ${Math.min(src.wd || 0, sp.maxWithdrawals)} of ${sp.maxWithdrawals} withdrawals used this period.`);
    if (sp.withdrawFee > 0) notes.push(`${acEsc(sp.name)} charges ${fmtMoney(sp.withdrawFee)} for each withdrawal.`);
    if (sp.bonusRate > 0 && !(src.wd > 0)) notes.push(`Taking money out of ${acEsc(sp.name)} loses this period's +${sp.bonusRate}% bonus.`);
  }
  if (dp && dp.maxBalance > 0) notes.push(`${acEsc(dp.name)} can hold up to ${fmtMoney(dp.maxBalance)} — room for ${fmtMoney(Math.max(0, dp.maxBalance - (dst.balance || 0)))} more.`);
  el.innerHTML = notes.length ? notes.map(n => `<span>${n}</span>`).join("") : "";
}
async function acMove(e) {
  e.preventDefault();
  const from = document.getElementById("acFrom").value, to = document.getElementById("acTo").value, amt = document.getElementById("acAmt").value;
  const btn = document.getElementById("acMoveBtn"); btn.disabled = true;
  const names = {}; acAccountChoices(AC_ME, AC_CLS).forEach(c => { names[c.id] = c.label; });
  const res = await moveBankMoney(CURRENT.username, CURRENT.classCode, from, to, amt);
  btn.disabled = false;
  if (!res.ok) { acMsg("acMoveMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return false; }
  const done = `Moved ${fmtMoney(Number(amt))} from ${names[from]} to ${names[to]}.`;
  await render();
  acMsg("acMoveMsg", `<div class="success-msg">${acEsc(done)}</div>`);
  return false;
}

/* ---------------- Student actions ---------------- */
function acSetFilter(k) { AC_FILTER = k; acRenderStudent(AC_ME, AC_CLS); }
async function acOpen(planId) {
  acMsg("acMsg", "");
  const res = await openBankAccount(CURRENT.username, CURRENT.classCode, planId);
  if (!res.ok) { acMsg("acMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  await render();
  acMsg("acMsg", `<div class="success-msg">${res.status === "active" ? "Your account is open! Move some money in to get started." : "Application sent to your teacher."}</div>`);
}
async function acCancelApp(id) {
  await cancelBankAccountApplication(CURRENT.username, id);
  await render();
}
async function acClose(id) {
  const a = acctListOf(AC_ME).find(x => x.id === id);
  const bal = a ? acctRound(a.balance || 0) : 0;
  const ok = await t29Confirm(bal > 0 ? `Close this account? The ${fmtMoney(bal)} in it will move back to your cash balance.` : "Close this account?");
  if (!ok) return;
  const res = await closeBankAccount(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { acMsg("acMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  await render();
  acMsg("acMsg", `<div class="success-msg">Account closed${res.moved > 0 ? ` — ${fmtMoney(res.moved)} moved back to cash` : ""}.</div>`);
}

/* ================= Teacher ================= */
function acRenderTeacher(cls, students) {
  const el = document.getElementById("acctTeacherCard");
  const st = acctSettings(cls), all = cls.accountPlans || [];
  const live = all.filter(p => !p.archived), archived = all.filter(p => p.archived);
  const rows = []; // every account any student holds
  students.forEach(s => acctListOf(s).forEach(a => rows.push({ s, a, p: acctPlanById(cls, a.planId) })));
  const active = rows.filter(r => r.a.status === "active"), pending = rows.filter(r => r.a.status === "pending");
  const held = acctRound(active.reduce((n, r) => n + (r.a.balance || 0), 0));
  const countFor = id => rows.filter(r => r.a.planId === id).length;
  const mustOpts = (cur, max) => Array.from({ length: max + 1 }, (_, i) => `<option value="${i}" ${i === cur ? "selected" : ""}>${i}</option>`).join("");

  const planRows = live.length ? live.slice().sort((a, b) => (a.kind === b.kind ? b.rate - a.rate : a.kind === "everyday" ? -1 : 1)).map(p => {
    const n = countFor(p.id);
    return `<div class="cc-tplan">
      <div class="cc-tplan-body">
        <div class="cc-tplan-top"><strong>${acEsc(p.name)}</strong><span class="badge navy">${acPlural(n, "holder")}</span></div>
        ${acKindBadge(p.kind)}
        ${p.blurb ? `<p class="ac-blurb">${acEsc(p.blurb)}</p>` : ""}
        ${acFacts(p)}
        <div class="cc-perks">${acPerks(p)}</div>
        <div class="muted-small">${p.minLifestyle ? acTierNeed(cls, p.minLifestyle) : "Open to everyone"}</div>
        <div class="cc-tplan-actions"><button class="btn small" onclick="acEditPlan('${acEsc(p.id)}')">Edit</button>
          <button class="btn small coral" onclick="acRemovePlan('${acEsc(p.id)}')">${n > 0 ? "Retire" : "Delete"}</button></div>
      </div></div>`;
  }).join("") : `<div class="empty-state"><p>No accounts yet. Add a few from the recommended accounts, or build your own below.</p></div>`;

  const liveNames = new Set(live.map(p => p.name.toLowerCase()));
  const reco = AC_PRESETS.map(pr => {
    const p = acPresetPlan(cls, pr), have = liveNames.has(pr.name.toLowerCase());
    const line = [p.rate > 0 ? `${p.rate}% interest` : "No interest", p.bonusRate > 0 ? `+${p.bonusRate}% bonus` : "",
      p.fee > 0 ? `${fmtMoney(p.fee)} fee` : "", p.withdrawFee > 0 ? `${fmtMoney(p.withdrawFee)} per withdrawal` : "", p.maxWithdrawals > 0 ? `${p.maxWithdrawals} withdrawal/period` : "", p.maxBalance > 0 ? `${fmtMoney(p.maxBalance)} cap` : ""].filter(Boolean).join(" · ");
    return `<div class="ac-reco-item ${have ? "have" : ""}">
      <div class="ac-reco-body"><div class="ac-reco-top"><strong>${acEsc(pr.name)}</strong>${acKindBadge(pr.kind)}</div>
        <p>${acEsc(pr.blurb)}</p><div class="muted-small">${acEsc(line)}</div></div>
      <button class="btn small ${have ? "secondary" : "gold"}" ${have ? "disabled" : ""} onclick="acAddPreset('${pr.key}')">${have ? "Added" : "+ Add"}</button>
    </div>`;
  }).join("");
  const remaining = AC_PRESETS.filter(pr => !liveNames.has(pr.name.toLowerCase())).length;
  // Gone once every recommended account has been added; a teacher can also dismiss it (and bring it back).
  const recoPanel = !remaining ? "" : acRecoDismissed()
    ? `<p class="muted-small ac-reco-show"><a href="#" onclick="acDismissReco(false);return false;">Show recommended accounts</a></p>`
    : `<section class="cc-panel ac-reco-panel">
      <div class="cc-panel-head"><h3>${icon("sparkle", 16)} Recommended accounts</h3>
        <span class="ac-reco-actions"><button class="btn small gold" onclick="acAddAllPresets()">+ Add all ${remaining} remaining</button>
        <button class="btn small secondary" onclick="acDismissReco(true)">Dismiss</button></span></div>
      <p class="muted-small ac-reco-note">One click adds a ready-made account to your class. Rates are based on your class savings rate (${cls.interestRate || 0}%), and you can edit anything afterwards.</p>
      <div class="ac-reco">${reco}</div>
    </section>`;

  const pendRows = pending.length ? `<h3 class="cc-sub">${icon("history", 16)} Waiting for approval (${pending.length})</h3>
    <div class="table-scroll cc-tablewrap"><table><thead><tr><th>Student</th><th>Account</th><th>Lifestyle</th><th></th></tr></thead><tbody>${pending.map(({ s, a, p }) => {
      if (!p) return "";
      const sc = lifestyleRatingFromData(cls, s, s.username), ok = sc >= p.minLifestyle;
      return `<tr><td>${acEsc(s.name)}</td><td>${acEsc(p.name)} ${acKindBadge(p.kind)}</td>
        <td><span class="badge ${ok ? "mint" : "coral"}">${Math.floor(sc * 10) / 10} / ${p.minLifestyle} needed</span></td>
        <td class="cc-row-actions"><button class="btn small mint" onclick="acApprove('${acEsc(s.username)}','${acEsc(a.id)}',${ok})">Approve</button>
          <button class="btn small coral" onclick="acDecline('${acEsc(s.username)}','${acEsc(a.id)}')">Decline</button></td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  const useRows = active.length ? `<h3 class="cc-sub">${icon("users", 16)} Accounts in use (${active.length})</h3>
    <div class="table-scroll cc-tablewrap"><table><thead><tr><th>Student</th><th>Account</th><th>Balance</th><th>Interest earned</th><th>Fees paid</th><th>Opened</th></tr></thead><tbody>${active.slice().sort((x, y) => (y.a.balance || 0) - (x.a.balance || 0)).map(({ s, a, p }) => {
      const lt = a.lifetime || {};
      return `<tr><td>${acEsc(s.name)}</td><td>${p ? acEsc(p.name) : "—"}</td><td><strong>${fmtMoney(a.balance || 0)}</strong></td><td>${fmtMoney(lt.interest || 0)}</td><td>${fmtMoney(lt.fees || 0)}</td><td>${a.openedKey ? acEsc(cardDateLabel(a.openedKey)) : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  el.innerHTML = `
    <div class="flex-between cc-head"><h2 id="hAcctT">Bank accounts</h2>
      <label class="cc-switch"><input type="checkbox" id="acsEnabled" ${st.enabled ? "checked" : ""} onchange="acSaveSettings()"><span class="cc-switch-track"></span><span>${st.enabled ? "On for students" : "Off"}</span></label></div>
    <p class="cc-intro">Let students open extra <strong>everyday</strong> and <strong>savings</strong> accounts on top of their cash balance and Savings Account. You decide every rate, fee and limit. ${interestScheduleLabel(cls)} Your class Savings Account rate is ${cls.interestRate || 0}%.</p>
    <div class="cc-tstats">
      <div class="cc-tstat"><span>Accounts open</span><strong>${active.length}</strong></div>
      <div class="cc-tstat ${pending.length ? "alert" : ""}"><span>Waiting for approval</span><strong>${pending.length}</strong></div>
      <div class="cc-tstat"><span>Held in accounts</span><strong>${fmtMoney(held)}</strong></div>
      <div class="cc-tstat"><span>Plans on offer</span><strong>${live.length}</strong></div>
    </div>
    <section class="cc-panel">
      <div class="cc-panel-head"><h3>${icon("settings", 16)} Settings</h3><span class="muted-small">Changes save as soon as you make them</span></div>
      <div class="cc-settings">
        <div class="cc-set"><label for="acsApproval">New accounts</label><p>Who decides when a student opens one.</p>
          <select id="acsApproval" onchange="acSaveSettings()"><option value="instant" ${st.approval !== "teacher" ? "selected" : ""}>Open instantly for eligible students</option><option value="teacher" ${st.approval === "teacher" ? "selected" : ""}>You approve each one</option></select></div>
        <div class="cc-set"><label for="acsEveryday">Extra everyday accounts</label><p>The most a student can hold at once.</p>
          <select id="acsEveryday" onchange="acSaveSettings()">${mustOpts(st.maxEveryday, 10)}</select></div>
        <div class="cc-set"><label for="acsSavings">Extra savings accounts</label><p>The most a student can hold at once.</p>
          <select id="acsSavings" onchange="acSaveSettings()">${mustOpts(st.maxSavings, 10)}</select></div>
      </div>
    </section>
    <div id="acTMsg"></div>
    ${recoPanel}
    <h3 class="cc-sub">Your plans</h3>
    <div class="cc-tplans">${planRows}</div>
    ${archived.length ? `<p class="muted-small cc-archived">Retired: ${archived.map(p => `${acEsc(p.name)} <a href="#" onclick="acRestorePlan('${acEsc(p.id)}');return false;">restore</a>`).join(" · ")}</p>` : ""}
    <div class="cc-form-wrap"><button class="btn gold small" onclick="acEditPlan('')" id="acNewBtn">+ Build your own account</button>
      <form class="cc-form hidden" id="acPlanForm" onsubmit="return acSavePlan(event)"></form></div>
    ${pendRows}${useRows}`;
}

/* ---------------- Plan form ---------------- */
function acFormLive() {
  const g = id => document.getElementById("acp-" + id);
  acPlanPreview();
}
function acKindChanged() {
  const sav = document.getElementById("acp-kind").value === "savings";
  document.querySelectorAll("#acPlanForm .ac-sav-only").forEach(el => el.classList.toggle("hidden", !sav));
  acPlanPreview();
}
// A plain-English example of what the plan does to a real balance
function acPlanPreview() {
  const out = document.getElementById("acp-prev"); if (!out) return;
  const n = id => Number((document.getElementById("acp-" + id) || {}).value) || 0;
  const sav = document.getElementById("acp-kind").value === "savings";
  const rate = n("rate"), bonus = sav ? n("bonus") : 0, minB = n("minbal"), fee = n("fee"), waive = n("waive");
  const ex = [100, 500, 1000].map(bal => {
    const base = bal >= minB ? bal * rate / 100 : 0;
    const f = fee > 0 && !(waive > 0 && bal >= waive) ? Math.min(fee, bal) : 0;
    return `${fmtMoney(bal)} → ${base > 0 ? "+" + fmtMoney(base) : "$0.00"}${f > 0 ? ` − ${fmtMoney(f)} fee` : ""}`;
  });
  out.innerHTML = `<strong>What a student would get each interest payment</strong> (before tax): ${ex.join(" &nbsp;·&nbsp; ")}${bonus > 0 ? `. With no withdrawals that period the rate becomes ${Math.round((rate + bonus) * 100) / 100}%.` : "."}`;
}
function acTierSelectHtml(cls, rating) {
  const th = acTiers(cls), cur = Number(rating) || 0;
  const opts = th.map(x => `<option value="${x.min}" ${Number(x.min) === cur ? "selected" : ""}>${acEsc(x.label)} (rating ${x.min}+)</option>`);
  if (!opts.length || !th.some(x => Number(x.min) === 0)) opts.unshift(`<option value="0" ${cur === 0 ? "selected" : ""}>No minimum</option>`);
  if (cur !== 0 && !th.some(x => Number(x.min) === cur)) opts.push(`<option value="${cur}" selected>Custom — rating ${cur}+</option>`);
  return `<select id="acp-minls">${opts.join("")}</select>`;
}
function acPlanFormHtml(p) {
  const fld = (id, label, val, step, hint, extra) => `<div class="${extra || ""}"><label for="acp-${id}">${label}</label><input id="acp-${id}" type="number" min="0" step="${step || "0.01"}" value="${val}" oninput="acFormLive()">${hint ? `<div class="muted-small">${hint}</div>` : ""}</div>`;
  const sav = p.kind === "savings";
  return `
    <h3>${p.id ? "Edit account" : "New account"}</h3>
    <div class="cc-form-grid">
      <div><label for="acp-name">Account name</label><input id="acp-name" maxlength="40" value="${acEsc(p.name)}" placeholder="e.g. Holiday Saver" required oninput="acFormLive()"></div>
      <div><label for="acp-kind">Type</label><select id="acp-kind" onchange="acKindChanged()"><option value="everyday" ${!sav ? "selected" : ""}>Everyday — for spending &amp; bills</option><option value="savings" ${sav ? "selected" : ""}>Savings — for growing money</option></select></div>
      <div><label for="acp-minls">Minimum lifestyle tier</label>${acTierSelectHtml(AC_CLS, p.minLifestyle)}<div class="muted-small">Students need at least this tier to open it</div></div>
      <div class="wide"><label for="acp-blurb">Short description <span class="muted-small">(optional — shown to students)</span></label><input id="acp-blurb" maxlength="90" value="${acEsc(p.blurb)}" placeholder="e.g. Save for something big — a small fee keeps you honest"></div>
      ${fld("rate", "Interest (% each payment)", p.rate, "0.01", "Paid on the class interest schedule")}
      ${fld("bonus", "No-withdrawal bonus (% extra)", p.bonusRate, "0.01", "Extra interest if nothing was taken out that period", "ac-sav-only " + (sav ? "" : "hidden"))}
      ${fld("minbal", "Balance needed to earn interest ($)", p.minBalance, "1", "0 = earns from the first dollar")}
      ${fld("fee", "Account fee ($)", p.fee, "0.01", "Taken each time interest is paid")}
      ${fld("waive", "Fee waived from balance ($)", p.feeWaiveAt, "1", "0 = fee is never waived")}
      ${fld("wfee", "Fee per withdrawal ($)", p.withdrawFee, "0.01", "Charged on top of what they take out")}
      ${fld("maxwd", "Withdrawals per interest period", p.maxWithdrawals, "1", "0 = unlimited. Resets when interest is paid", "ac-sav-only " + (sav ? "" : "hidden"))}
      ${fld("maxbal", "Balance limit ($)", p.maxBalance, "1", "0 = no limit")}
      <div class="wide muted-small ac-prev" id="acp-prev" aria-live="polite"></div>
    </div>
    <div class="cc-form-actions"><button class="btn gold" type="submit">Save account</button><button class="btn" type="button" onclick="acCancelEdit()">Cancel</button></div>
    <input type="hidden" id="acp-id" value="${acEsc(p.id || "")}">`;
}
function acEditPlan(id) {
  const base = { id: "", name: "", kind: "savings", blurb: "", rate: Math.max(1, Number(AC_CLS.interestRate) || 1), bonusRate: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 0, minLifestyle: 0 };
  const p = id ? ((AC_CLS.accountPlans || []).find(x => x.id === id) || base) : base;
  const f = document.getElementById("acPlanForm");
  f.innerHTML = acPlanFormHtml(p);
  f.classList.remove("hidden");
  acPlanPreview();
  document.getElementById("acNewBtn").classList.add("hidden");
  f.scrollIntoView({ behavior: "smooth", block: "center" });
}
function acCancelEdit() {
  document.getElementById("acPlanForm").classList.add("hidden");
  document.getElementById("acNewBtn").classList.remove("hidden");
}
async function acSavePlan(e) {
  e.preventDefault();
  const g = id => document.getElementById("acp-" + id).value;
  const id = g("id");
  const old = id ? (AC_CLS.accountPlans || []).find(p => p.id === id) : null;
  const sav = g("kind") === "savings";
  const theme = (old && old.theme) || acRandomTheme(id); // colour is no longer shown, but plans keep one
  await saveAccountPlan(CURRENT.classCode, {
    id: id || undefined, name: g("name"), kind: g("kind"), blurb: g("blurb"), theme,
    rate: g("rate"), bonusRate: sav ? g("bonus") : 0, minBalance: g("minbal"), fee: g("fee"), feeWaiveAt: g("waive"),
    withdrawFee: g("wfee"), maxWithdrawals: sav ? g("maxwd") : 0, maxBalance: g("maxbal"), minLifestyle: g("minls"),
    archived: old ? !!old.archived : false
  });
  await render();
  acMsg("acTMsg", `<div class="success-msg">Account saved. Interest and fee changes apply from the next interest payment; withdrawal and balance limits apply straight away.</div>`);
  return false;
}
const acRecoKey = () => "t29-ac-reco-dismissed:" + ((typeof CURRENT !== "undefined" && CURRENT && CURRENT.classCode) || "");
function acRecoDismissed() { try { return localStorage.getItem(acRecoKey()) === "1"; } catch (e) { return false; } }
async function acDismissReco(on) {
  try { if (on) localStorage.setItem(acRecoKey(), "1"); else localStorage.removeItem(acRecoKey()); } catch (e) {}
  await render();
}
async function acAddPreset(key) {
  const pr = AC_PRESETS.find(x => x.key === key); if (!pr) return;
  await saveAccountPlan(CURRENT.classCode, acPresetPlan(AC_CLS, pr));
  await render();
  acMsg("acTMsg", `<div class="success-msg">Added <strong>${acEsc(pr.name)}</strong>. Students have been told. Edit it any time below.</div>`);
}
async function acAddAllPresets() {
  const have = new Set((AC_CLS.accountPlans || []).filter(p => !p.archived).map(p => p.name.toLowerCase()));
  const todo = AC_PRESETS.filter(pr => !have.has(pr.name.toLowerCase()));
  for (const pr of todo) {
    // one at a time so every account gets its own unused colour
    await saveAccountPlan(CURRENT.classCode, acPresetPlan(AC_CLS, pr));
    AC_CLS = await getClass(CURRENT.classCode);
  }
  await render();
  acMsg("acTMsg", `<div class="success-msg">Added ${acPlural(todo.length, "account")}. Edit or remove any of them below.</div>`);
}
async function acRemovePlan(id) {
  const n = AC_STUDENTS.filter(s => acctListOf(s).some(a => a.planId === id && (a.status === "active" || a.status === "pending"))).length;
  const ok = await t29Confirm(n > 0 ? `${acPlural(n, "student")} hold or applied for this account. It will be retired: hidden from new students, but existing accounts keep working. Continue?` : "Delete this account plan?");
  if (!ok) return;
  await removeAccountPlan(CURRENT.classCode, id, n > 0);
  await render();
}
async function acRestorePlan(id) {
  const p = (AC_CLS.accountPlans || []).find(x => x.id === id);
  if (p) await saveAccountPlan(CURRENT.classCode, Object.assign({}, p, { archived: false }));
  await render();
}
async function acSaveSettings() {
  const g = id => document.getElementById(id);
  await saveAccountSettings(CURRENT.classCode, { enabled: g("acsEnabled").checked, approval: g("acsApproval").value, maxEveryday: g("acsEveryday").value, maxSavings: g("acsSavings").value });
  await render();
  acMsg("acTMsg", `<div class="success-msg">Saved.</div>`);
}
async function acApprove(username, accountId, eligible) {
  if (!eligible && !await t29Confirm("This student is below the lifestyle rating for that account. Approve anyway?")) return;
  const res = await approveBankAccount(CURRENT.classCode, username, accountId);
  if (!res.ok) acMsg("acTMsg", `<div class="error-msg">${acEsc(res.error)}</div>`);
  await render();
}
async function acDecline(username, accountId) {
  const res = await declineBankAccount(CURRENT.classCode, username, accountId);
  if (!res.ok) acMsg("acTMsg", `<div class="error-msg">${acEsc(res.error)}</div>`);
  await render();
}
