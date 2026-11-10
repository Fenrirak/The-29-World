/* accounts.js — extra everyday + savings accounts on the Bank page.

   Same idea as the credit cards: the teacher builds account PLANS, students
   open the ones they like. All the money rules (opening, approving, moving
   money, interest, fees) live in data-money.js under "Bank accounts"; this
   file only draws screens and calls those functions, then asks bank.js's
   render() to redraw. Card colours and the little card previews are shared
   with creditcard.js (CC_THEMES, ccThemeBg, ccMiniCard...). */

let AC_CLS = null, AC_ME = null, AC_STUDENTS = [];
let AC_FILTER = "everyday";
let AC_MOVE = { from: "", to: "" };
let AC_NOTICE = ""; // a one-off message for "My accounts" (e.g. a closed account re-opened because money landed in it)

const acEsc = s => ccEsc(s);
const acMsg = (id, html) => ccMsg(id, html);

/* ---------------- Recommended accounts (teacher one-click add) ----------------
   Personalised to the class. Two things are worked out from the class settings:
   1. RATES are a multiple of the class's own savings rate. That rate is already "per interest payment", so
      the recommended rates follow whatever the teacher chose. (A class on 0% falls back to a typical rate
      for how often interest is paid.)
   2. FEES and WITHDRAWAL LIMITS are per interest payment, so they are scaled to how often interest is paid.
      Their numbers below are written for interest paid every week (feeWk, wdWk) and scaled by
      "days between payments / 7": a $30 weekly fee becomes ~$4.25 when interest is paid daily and $120
      when it's paid every 4 weeks, so the cost over time stays the same. Withdrawal limits scale the same way
      (never below 1). Balances (minimum, fee-waiver, balance cap) and per-withdrawal fees don't depend on
      how often interest is paid, so they stay as they are. */
const AC_PRESETS = [
  { key: "everyday", kind: "everyday", name: "Everyday Account", theme: "ocean", blurb: "A simple account for day-to-day money. No fees, no fuss.",
    rateMul: 0, minBalance: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "bills", kind: "everyday", name: "Bills Account", theme: "slate", blurb: "Park money for rent and bills here so it doesn't get spent.",
    rateMul: 0.1, minBalance: 500, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "student", kind: "everyday", name: "Student Account", theme: "emerald", blurb: "Fee-free with a little interest once you have a bit saved.",
    rateMul: 0.25, minBalance: 200, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "gold", kind: "everyday", name: "Gold Everyday", theme: "gold", blurb: "Better interest for big balances. Fee is waived once you keep enough in it.",
    rateMul: 0.5, minBalance: 0, feeWk: 30, feeWaiveAt: 5000, withdrawFee: 0, maxBalance: 0, tier: 2 },
  { key: "regular", kind: "savings", name: "Regular Saver", theme: "teal", blurb: "Easy saving. Take your money out whenever you like.",
    rateMul: 1, bonusMul: 0, minBalance: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "bonus", kind: "savings", name: "Bonus Saver", theme: "violet",
    blurb: (p, per) => `A small base rate, plus a big bonus if you leave it alone for the whole ${per.span}.`,
    rateMul: 0.5, bonusMul: 1.5, minBalance: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 0, tier: -1 },
  { key: "notice", kind: "savings", name: "Notice Saver", theme: "midnight",
    blurb: (p, per) => `The best rate, but only ${acPlural(p.maxWithdrawals, "withdrawal")} per ${per.span}, and each one costs a fee.`,
    rateMul: 2, bonusMul: 0, minBalance: 0, feeWaiveAt: 0, withdrawFee: 50, wdWk: 1, maxBalance: 0, tier: 1 },
  { key: "youth", kind: "savings", name: "Youth Saver", theme: "sunset", blurb: "A boosted rate for beginners, up to a balance limit.",
    rateMul: 1.5, bonusMul: 0, minBalance: 0, feeWaiveAt: 0, withdrawFee: 0, maxBalance: 5000, tier: -1 },
  { key: "goal", kind: "savings", name: "Goal Saver", theme: "rose", blurb: "Save up for something big. A fee each time you dip into it keeps you honest.",
    rateMul: 1.25, bonusMul: 0, minBalance: 0, feeWaiveAt: 0, withdrawFee: 20, maxBalance: 0, tier: -1 },
  { key: "premium", kind: "savings", name: "Premium Saver", theme: "ruby", blurb: "Top interest for serious savers. Needs $2,000 to start earning; fee waived above $10,000.",
    rateMul: 2.5, bonusMul: 0, minBalance: 2000, feeWk: 20, feeWaiveAt: 10000, withdrawFee: 0, maxBalance: 0, tier: 2 }
];
function acTiers(cls) { return ((cls && cls.lifestyleThresholds) || []).slice().sort((a, b) => Number(a.min) - Number(b.min)); }

// How often this class pays interest, in the words and numbers the screens need.
// "scale" is the length of one payment period compared with a week (1 = weekly).
// If interest is applied by hand there's no schedule, so it's treated as weekly.
const AC_PERIODS = {
  daily:       { days: 1,  every: "every day",     span: "day" },
  weekly:      { days: 7,  every: "every week",    span: "week" },
  fortnightly: { days: 14, every: "every 2 weeks", span: "fortnight" },
  monthly:     { days: 28, every: "every 4 weeks", span: "4 weeks" }
};
function acPeriod(cls) {
  const auto = !!(cls && cls.interestAuto);
  const key = AC_PERIODS[cls && cls.interestFrequency] ? cls.interestFrequency : "weekly";
  if (!auto) return { key: "manual", auto: false, days: 7, scale: 1, every: "whenever you apply interest", span: "interest period" };
  const p = AC_PERIODS[key];
  return { key, auto: true, days: p.days, scale: p.days / 7, every: p.every, span: p.span };
}
// A tidy dollar amount: $4.25, $30, $120, $1,200 — not $4.2857
function acNiceMoney(v) {
  if (!(v > 0)) return 0;
  const step = v < 10 ? 0.25 : v < 100 ? 1 : v < 1000 ? 5 : 10;
  return Math.max(step, Math.round(v / step) * step);
}
// The rate the recommended rates are built on (per interest payment)
function acBaseRate(cls) {
  const r = Number(cls && cls.interestRate) || 0;
  if (r > 0) return { rate: r, fallback: false };
  return { rate: Math.max(0.1, Math.round(acPeriod(cls).scale * 100) / 100), fallback: true };
}
function acPresetPlan(cls, pr) {
  const per = acPeriod(cls), base = acBaseRate(cls).rate;
  const r2 = n => Math.round(n * 100) / 100;
  const rateOf = mul => mul > 0 ? Math.max(0.01, r2(base * mul)) : 0;
  const th = acTiers(cls);
  const used = new Set((cls.accountPlans || []).filter(p => !p.archived).map(p => p.theme));
  const theme = !used.has(pr.theme) ? pr.theme : acRandomTheme("");
  const plan = {
    name: pr.name, kind: pr.kind, theme,
    rate: rateOf(pr.rateMul), bonusRate: rateOf(pr.bonusMul),
    minBalance: pr.minBalance, fee: acNiceMoney((pr.feeWk || 0) * per.scale), feeWaiveAt: pr.feeWaiveAt, withdrawFee: pr.withdrawFee,
    maxWithdrawals: pr.wdWk ? Math.max(1, Math.round(pr.wdWk * per.scale)) : 0, maxBalance: pr.maxBalance,
    minLifestyle: pr.tier >= 0 && th.length ? Number((th[Math.min(pr.tier, th.length - 1)] || {}).min) || 0 : 0
  };
  plan.blurb = typeof pr.blurb === "function" ? pr.blurb(plan, per) : pr.blurb;
  return plan;
}

/* ---------------- Little building blocks ---------------- */
function acInjectCss() {
  if (document.getElementById("acExtraCss")) return;
  const st = document.createElement("style"); st.id = "acExtraCss";
  st.textContent = `.ac-tune{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 14px}
.ac-tune a{margin-left:auto;font-size:.85rem;font-weight:700;white-space:nowrap}
.ac-reco-line{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:2px}
.ac-reco-line b{font-weight:700}
.bs-stats{grid-template-columns:repeat(3,minmax(0,1fr))}
.bs-stats .cc-tstat strong{font-size:1.45rem;overflow-wrap:anywhere}
@media(max-width:560px){.bs-stats{grid-template-columns:minmax(0,1fr)}}
.bs-set2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:640px){.bs-set2{grid-template-columns:minmax(0,1fr)}}
#savingsSettingsCard .cc-panel + .cc-panel{margin-top:14px}
.bs-hint{min-height:1.25em;margin-top:2px}
.bs-off{opacity:.5;transition:opacity .15s}
.bs-tune{display:flex;gap:8px;align-items:flex-start;margin:14px 0 0}
.bs-save{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:16px}
.ac-have-wrap{display:flex;flex-direction:column;gap:8px;margin-top:auto}
.ac-have{display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);font-weight:700;color:var(--cc-mint-ink);background:var(--cc-mint-bg);border:1px solid var(--cc-mint-line);border-radius:var(--r-3);padding:8px 12px}
.ac-have.pend{color:var(--cc-gold-ink);background:var(--cc-gold-bg);border-color:var(--cc-gold-line)}
.ac-plan.ac-held{border-color:var(--cc-mint-line)}`;
  document.head.appendChild(st);
}
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
  const per = acPeriod(AC_CLS);
  const rows = [f("Interest", p.rate > 0 ? `${p.rate}% <small>per ${per.span}</small>` : "None")];
  if (p.bonusRate > 0) rows.push(f("No-withdrawal bonus", `+${p.bonusRate}%`));
  if (p.minBalance > 0) rows.push(f("Earns interest from", fmtMoney(p.minBalance)));
  rows.push(f("Account fee", p.fee > 0 ? `${fmtMoney(p.fee)} <small>per ${per.span}${p.feeWaiveAt > 0 ? ` · free from ${fmtMoney(p.feeWaiveAt)}` : ""}</small>` : "None"));
  rows.push(f("Withdrawals", `${p.maxWithdrawals > 0 ? `${p.maxWithdrawals} per ${per.span}` : "Unlimited"}${p.withdrawFee > 0 ? ` · ${fmtMoney(p.withdrawFee)} each` : ""}`));
  if (p.maxBalance > 0) rows.push(f("Balance limit", fmtMoney(p.maxBalance)));
  return `<div class="cc-facts">${rows.join("")}</div>`;
}
function acPerks(p) {
  const out = [];
  if (p.bonusRate > 0) out.push(`<span class="cc-chip mint">${icon("star", 12)}+${p.bonusRate}% bonus if untouched</span>`);
  if (!(p.fee > 0) && !(p.withdrawFee > 0)) out.push(`<span class="cc-chip mint">${icon("check", 12)}No fees</span>`);
  else if (p.fee > 0 && p.feeWaiveAt > 0) out.push(`<span class="cc-chip gold">${icon("coin", 12)}Fee-free from ${fmtMoney(p.feeWaiveAt)}</span>`);
  if (p.maxWithdrawals > 0) out.push(`<span class="cc-chip lilac">${icon("lock", 12)}${acPlural(p.maxWithdrawals, "withdrawal")} per ${acPeriod(AC_CLS).span}</span>`);
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
  me = acctLogical(me); // the account screens work on the logical view: "Cash" = the original Cash account (see data-money.js)
  AC_CLS = cls; AC_ME = me; AC_STUDENTS = students || [];
  const sCard = document.getElementById("acctCard"), tCard = document.getElementById("acctTeacherCard"), oCard = document.getElementById("acctOpenCard");
  if (!sCard || !tCard) return;
  acInjectCss();
  sCard.classList.toggle("hidden", IS_TEACHER);
  if (oCard) oCard.classList.toggle("hidden", IS_TEACHER);
  tCard.classList.toggle("hidden", !IS_TEACHER);
  acPaintTiles(me, cls);
  acPaintBalanceWidget(me, cls);
  if (IS_TEACHER) acRenderTeacher(cls, AC_STUDENTS);
  else { acRenderStudent(me, cls); acRenderOpen(me, cls); }
}

/* ---------------- Top tiles: one per account, same look as the cash balance tile ---------------- */
function acRateText(cls, rate) {
  const per = acPeriod(cls);
  return rate > 0 ? `${rate}% interest${per.auto ? " " + per.every : ""}` : "No interest";
}
// Everyday accounts always come first, then savings (the class's Cash balance / Savings Account lead their own group), then any whose plan was removed.
// `extras` = the student's open extra accounts. Used by the top tiles and by "My accounts" so both always agree.
function acSortedAccounts(me, cls, extras) {
  const items = [];
  if (!acctDefaultClosed(me, "cash")) items.push({ kind: "everyday", def: "cash" });
  if (!acctDefaultClosed(me, "savings")) items.push({ kind: "savings", def: "savings" });
  extras.forEach(a => { const p = acctPlanById(cls, a.planId); items.push({ kind: p ? p.kind : "other", a, p }); });
  const rank = { everyday: 0, savings: 1, other: 2 };
  return items.map((it, i) => [it, i]).sort((x, y) => rank[x[0].kind] - rank[y[0].kind] || x[1] - y[1]).map(x => x[0]);
}
function acTilesHtml(me, cls) {
  const tile = (variant, ic, name, bal, note) => `<div class="stat ${variant} bk-acct-tile"><span class="icon">${icon(ic, 30)}</span>
    <div class="label">${acEsc(name)}</div><div class="value">${typeof bal === "string" ? bal : fmtMoney(bal)}</div><div class="muted-small">${note}</div></div>`;
  return acSortedAccounts(me, cls, acctActiveOf(me)).map(it => {
    if (it.def === "cash") return tile("gold", "coin", "Cash balance", t29SvActive() ? "Unlimited ∞" : acctRound(me.balance || 0), `Everyday · ${acRateText(cls, Number(cls.cashInterestRate) || 0)}`);
    if (it.def === "savings") return tile("mint", "piggy", "Savings Account", me.savings || 0, `Savings · ${acRateText(cls, Number(cls.interestRate) || 0)}`);
    if (!it.p) return tile("sky", "bank", "Account", it.a.balance || 0, "Plan removed by your teacher");
    const sav = it.p.kind === "savings";
    return tile(sav ? "mint" : "sky", sav ? "piggy" : "bank", it.p.name, it.a.balance || 0, `${acKindLabel(it.p.kind)} · ${acRateText(cls, it.p.rate || 0)}`);
  }).join("");
}
function acPaintTiles(me, cls) {
  const grid = document.getElementById("topStats"); if (!grid) return;
  grid.querySelectorAll(".bk-acct-tile").forEach(n => n.remove());
  if (IS_TEACHER) return;
  const anchor = document.getElementById("cardStat") || grid.lastElementChild;
  if (anchor) anchor.insertAdjacentHTML("beforebegin", acTilesHtml(me, cls));
}

/* ================= Student: my accounts ================= */
function acRenderStudent(me, cls) {
  const el = document.getElementById("acctCard");
  const list = acctListOf(me);
  const active = list.filter(a => a.status === "active"), pending = list.filter(a => a.status === "pending");
  const intTax = t29TaxRate(cls, "interest");
  const cashOpen = !acctDefaultClosed(me, "cash"), savOpen = !acctDefaultClosed(me, "savings");
  const openCount = active.length + (cashOpen ? 1 : 0) + (savOpen ? 1 : 0);
  const canMove = openCount > 1;
  let html = `<div class="flex-between cc-head"><h2 id="hAcct">My accounts</h2><span class="cc-head-note">${acPlural(openCount, "account")}</span></div>`;
  html += `<p class="cc-intro">Each account here has its own interest, fees and rules, and you can move money between them any time. Your <strong>main account</strong> is the one your pay comes into and your purchases and payments come out of. It starts as your Cash balance, but you can make any everyday account your main one. It doesn't earn interest unless your teacher has set a cash rate, so put money to work in the others. ${interestScheduleLabel(cls)}</p>`;
  if (intTax) html += `<div class="tax-note"><span>Interest is taxed at <strong>${t29TaxPct(intTax)}</strong> before it is paid to you.</span></div>`;
  html += `<div class="ac-own-grid">${acSortedAccounts(me, cls, active).map(it => it.def === "cash" ? acCashTile(me, cls, canMove) : it.def === "savings" ? acSavingsTile(me, cls, canMove) : acOwnedTile(it.a, cls, canMove)).join("")}</div>`;
  if (pending.length) {
    html += `<h3 class="cc-sub">${icon("history", 16)} Waiting for approval</h3><div class="ac-pend">${pending.map(a => {
      const p = acctPlanById(cls, a.planId);
      return `<div class="ac-pend-row"><div>${p ? `<strong>${acEsc(p.name)}</strong> ${acKindBadge(p.kind)}` : `<strong>Account</strong>`}<div class="muted-small">Your teacher will approve it soon. Nothing else to do.</div></div>
        <button class="btn small secondary" onclick="acCancelApp('${acEsc(a.id)}')">Withdraw</button></div>`;
    }).join("")}</div>`;
  }
  html += acMovePanel(me, cls);
  html += `<div id="acMsg">${AC_NOTICE}</div>`;
  AC_NOTICE = "";
  el.innerHTML = html;
  acMoveHint();
}
// "Main account" badge, or the button that makes an everyday account the main one (nothing for savings accounts).
function acMainBadge(id) { return acctMainId(AC_ME) === id ? ` <span class="badge gold" title="Your pay comes in here and your payments come out of it">Main account</span>` : ""; }
function acMainBtn(id, eligible) {
  if (!eligible || acctMainId(AC_ME) === id) return "";
  return `<button class="btn small secondary" onclick="acSetMain('${acEsc(id)}')" title="Make this the account your pay comes into and your payments come out of">${icon("star", 13)} Make main</button>`;
}
async function acSetMain(id) {
  acMsg("acMsg", "");
  const names = {}; acAccountChoices(AC_ME, AC_CLS).forEach(c => { names[c.id] = c.label; });
  const name = names[id] || "this account";
  const ok = await t29Confirm(`Make ${name} your main account?\n\nYour pay, refunds and money from classmates will come into ${name}, and your purchases, bills and payments will come out of it. Your money stays exactly where it is, and you can change this any time.`, { confirmText: "Make main" });
  if (!ok) return;
  const res = await setMainAccount(CURRENT.username, id);
  if (!res.ok) { acMsg("acMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  AC_NOTICE = `<div class="success-msg">${acEsc(res.name || name)} is now your main account. Your pay comes in here and your payments come out of it.</div>`;
  await render();
  try { if (typeof anwRefreshBalanceWidget === "function") anwRefreshBalanceWidget(); } catch (e) { /* the corner widget will catch up on the next change */ }
}
// The "Close" button every open account has. `only` = it is the one account they have open, so it can't be closed.
function acCloseBtn(id, name, only) {
  return `<button class="btn small ghost" onclick="acClose('${acEsc(id)}')" aria-label="Close ${acEsc(name)}"${only ? ` title="You need at least one account open"` : ""}>Close</button>`;
}
function acMoveBtns(id, canMove) {
  if (!canMove) return "";
  return `<button class="btn small gold" onclick="acQuick('${acEsc(id)}','in')">${icon("plus", 13)} Add money</button>
        <button class="btn small secondary" onclick="acQuick('${acEsc(id)}','out')">${icon("download", 13)} Take out</button>`;
}
// The class's original Cash balance (the default everyday account), drawn exactly like the extra accounts.
function acCashTile(me, cls, canMove) {
  const bal = acctRound(me.balance || 0), rate = Number(cls.cashInterestRate) || 0, per = acPeriod(cls);
  const gross = bal > 0 && rate > 0 ? acctRound(bal * rate / 100) : 0;
  const net = applyTaxToIncome(cls, "interest", gross).net;
  return `<article class="ac-own k-everyday is-default">
    <div class="ac-own-body">
      <div class="ac-tile-head"><strong>Cash balance</strong>${acKindBadge("everyday")}${acMainBadge("cash")}</div>
      <div class="ac-bal"><span>Balance</span><strong>${t29SvActive() ? "Unlimited ∞" : fmtMoney(bal)}</strong></div>
      <div class="ac-rows">
        <div class="ac-line"><span>Interest rate</span><strong>${rate > 0 ? `${rate}% <small>per ${per.span}</small>` : "None"}</strong></div>
        <div class="ac-line"><span>Next interest (after tax)</span><strong class="${net > 0 ? "good" : ""}">${net > 0 ? "≈ +" + fmtMoney(net) : "$0.00"}</strong></div>
        <div class="ac-line"><span>Withdrawals</span><strong>Unlimited</strong></div>
        <div class="ac-hint">${acctMainId(AC_ME) === "cash" ? "Included for everyone in your class. Your pay comes in here and your purchases come out of it." : "Included for everyone in your class. Your pay and payments use your main account instead."}</div>
      </div>
      <div class="ac-own-actions">
        ${acMoveBtns("cash", canMove)}
        ${acMainBtn("cash", true)}
        ${acCloseBtn("cash", "Cash balance", !canMove)}
      </div>
    </div></article>`;
}
// The class's original Savings Account, drawn exactly like the extra accounts so everything looks like one family.
function acSavingsTile(me, cls, canMove) {
  const bal = acctRound(me.savings || 0), rate = Number(cls.interestRate) || 0, per = acPeriod(cls);
  const gross = bal > 0 && rate > 0 ? acctRound(bal * rate / 100) : 0;
  const net = applyTaxToIncome(cls, "interest", gross).net;
  return `<article class="ac-own k-savings is-default">
    <div class="ac-own-body">
      <div class="ac-tile-head"><strong>Savings Account</strong>${acKindBadge("savings")}</div>
      <div class="ac-bal"><span>Balance</span><strong>${fmtMoney(bal)}</strong></div>
      <div class="ac-rows">
        <div class="ac-line"><span>Interest rate</span><strong>${rate > 0 ? `${rate}% <small>per ${per.span}</small>` : "None"}</strong></div>
        <div class="ac-line"><span>Next interest (after tax)</span><strong class="${net > 0 ? "good" : ""}">${net > 0 ? "≈ +" + fmtMoney(net) : "$0.00"}</strong></div>
        <div class="ac-line"><span>Withdrawals</span><strong>Unlimited</strong></div>
        <div class="ac-hint">Included for everyone in your class.</div>
      </div>
      <div class="ac-own-actions">
        ${acMoveBtns("savings", canMove)}
        ${acCloseBtn("savings", "Savings Account", !canMove)}
      </div>
    </div></article>`;
}
function acOwnedTile(a, cls, canMove) {
  const p = acctPlanById(cls, a.planId);
  if (!p) return `<article class="ac-own"><div class="ac-own-body"><strong>Account</strong><p class="muted-small">Your teacher removed this plan. You can still move your ${fmtMoney(a.balance || 0)} out below or close it.</p>
      <div class="ac-own-actions"><button class="btn small secondary" onclick="acClose('${acEsc(a.id)}')">Close &amp; move the money</button></div></div></article>`;
  const bal = acctRound(a.balance || 0), wd = a.wd || 0, lt = a.lifetime || {};
  const bonus = wd === 0 && p.bonusRate > 0 ? p.bonusRate : 0;
  const rate = (p.rate || 0) + bonus;
  const gross = bal > 0 && bal >= (p.minBalance || 0) && rate > 0 ? acctRound(bal * rate / 100) : 0;
  const net = applyTaxToIncome(cls, "interest", gross).net;
  const waived = p.feeWaiveAt > 0 && bal >= p.feeWaiveAt;
  const feeDue = p.fee > 0 && bal + net > 0 && !waived ? acctRound(Math.min(p.fee, bal + net)) : 0;
  const rows = [];
  rows.push(`<div class="ac-line"><span>Interest rate</span><strong>${p.rate > 0 ? `${p.rate}% <small>per ${acPeriod(cls).span}</small>` : "None"}</strong></div>`);
  rows.push(`<div class="ac-line"><span>Next interest (after tax)</span><strong class="${net > 0 ? "good" : ""}">${net > 0 ? "≈ +" + fmtMoney(net) : "$0.00"}</strong></div>`);
  if (p.minBalance > 0 && bal < p.minBalance) rows.push(`<div class="ac-hint">Add ${fmtMoney(p.minBalance - bal)} more to start earning interest.</div>`);
  if (p.fee > 0) rows.push(`<div class="ac-line"><span>Account fee</span><strong class="${feeDue > 0 ? "bad" : "good"}">${feeDue > 0 ? "−" + fmtMoney(feeDue) : waived ? "Waived" : "$0.00"}</strong></div>`);
  if (p.fee > 0 && p.feeWaiveAt > 0 && !waived) rows.push(`<div class="ac-hint">Keep ${fmtMoney(p.feeWaiveAt)} in here and the fee is waived.</div>`);
  if (p.bonusRate > 0) rows.push(wd === 0
    ? `<div class="ac-badge good">${icon("star", 13)} Bonus on track: +${p.bonusRate}% if you leave it alone</div>`
    : `<div class="ac-badge bad">${icon("history", 13)} Bonus missed this period. You've taken money out</div>`);
  if (p.maxWithdrawals > 0) {
    const used = Math.min(wd, p.maxWithdrawals), pct = Math.round(used / p.maxWithdrawals * 100);
    rows.push(`<div class="ac-meter"><div class="ac-meter-top"><span>Withdrawals this period</span><strong>${used} of ${p.maxWithdrawals}</strong></div><div class="ac-meter-bar"><i class="${pct >= 100 ? "hot" : ""}" style="width:${pct}%"></i></div></div>`);
  }
  if (p.maxBalance > 0) rows.push(`<div class="ac-line"><span>Room left</span><strong>${fmtMoney(Math.max(0, p.maxBalance - bal))}</strong></div>`);
  return `<article class="ac-own k-${p.kind}">
    <div class="ac-own-body">
      <div class="ac-tile-head"><strong>${acEsc(p.name)}</strong>${acKindBadge(p.kind)}${acMainBadge(a.id)}</div>
      <div class="ac-bal"><span>Balance</span><strong>${fmtMoney(bal)}</strong></div>
      <div class="ac-rows">${rows.join("")}</div>
      <div class="ac-life">Earned so far <b>${fmtMoney(lt.interest || 0)}</b> · Fees paid <b>${fmtMoney(lt.fees || 0)}</b></div>
      <div class="ac-own-actions">
        ${acMoveBtns(a.id, canMove)}
        ${acMainBtn(a.id, p.kind === "everyday" && !(p.maxBalance > 0))}
        ${acCloseBtn(a.id, p.name, !canMove)}
      </div>
    </div></article>`;
}

/* ================= Student: open an account (its own section) ================= */
// The two original accounts always stay on the list: open ones are marked "held" (note + greyed button), closed ones can be opened again.
function acDefaultOptions(me) {
  return [
    { id: "cash", kind: "everyday", name: "Cash balance", held: !acctDefaultClosed(me, "cash") },
    { id: "savings", kind: "savings", name: "Savings Account", held: !acctDefaultClosed(me, "savings") }
  ];
}
// Shown in place of the open button on an account the student already has: a small note, and the button greyed out.
function acHaveAction(pending, label) {
  return `<div class="ac-have-wrap"><div class="ac-have${pending ? " pend" : ""}">${icon(pending ? "history" : "check", 14)}<span>${pending ? "Application sent. Waiting for your teacher" : "You have this account"}</span></div>
    <button class="btn gold" disabled>${label}</button></div>`;
}
function acRenderOpen(me, cls) {
  const el = document.getElementById("acctOpenCard"); if (!el) return;
  const st = acctSettings(cls), plans = acctPlansOf(cls), list = acctListOf(me);
  const off = !st.enabled;
  // Accounts the student already has (open, or waiting for approval) stay on the list, marked "You have this account".
  const heldBy = {};
  list.forEach(a => { if (a.status === "active" || a.status === "pending") heldBy[a.planId] = a.status; });
  const countKind = k => list.filter(a => (a.status === "active" || a.status === "pending") && (acctPlanById(cls, a.planId) || {}).kind === k).length;
  const full = { everyday: countKind("everyday") >= st.maxEveryday, savings: countKind("savings") >= st.maxSavings };
  const offered = plans.slice().sort((a, b) => (a.kind === b.kind ? b.rate - a.rate : a.kind === "everyday" ? -1 : 1));
  const defs = acDefaultOptions(me);
  if (AC_FILTER !== "everyday" && AC_FILTER !== "savings") AC_FILTER = "everyday";
  const count = k => offered.filter(p => p.kind === k).length + defs.filter(d => d.kind === k).length;
  const shown = offered.filter(p => p.kind === AC_FILTER), shownDefs = defs.filter(d => d.kind === AC_FILTER);
  const note = off ? "Not open yet" : st.approval === "teacher" ? "Teacher approval needed" : "";
  let html = `<div class="flex-between cc-head"><h2 id="hOpenAcct">Open an account</h2>${note ? `<span class="cc-head-note">${note}</span>` : ""}</div>`;
  html += `<p class="cc-intro">Saving for something, or want somewhere to keep your bill money? Open another account. Each one has its own interest, fees and rules.${defs.some(d => !d.held) ? " An account you've closed waits here, and it's free to open again any time." : ""}</p>`;
  if (!plans.length && defs.every(d => d.held)) {
    html += `<div class="cc-off">${icon("lock", 22)}<div><strong>No accounts on offer yet</strong><span>${off ? "Your teacher hasn't switched extra accounts on." : "Your teacher hasn't set any up yet."} Check back soon.</span></div></div>`;
  } else {
    if (off && plans.length) html += `<div class="cc-off">${icon("lock", 22)}<div><strong>Opening accounts isn't switched on yet</strong><span>Have a look below. Your teacher will open applications soon.</span></div></div>`;
    if (!defs.some(d => !d.held) && !offered.some(p => !heldBy[p.id])) html += `<p class="muted-small">You've opened every account on offer. Nice.</p>`;
    html += `<div class="ac-filter" role="tablist" aria-label="Account type">${["everyday", "savings"].map(k => `<button type="button" role="tab" aria-selected="${AC_FILTER === k}" class="${AC_FILTER === k ? "on" : ""}" onclick="acSetFilter('${k}')">${acKindLabel(k)}<span class="ac-count">${count(k)}</span></button>`).join("")}</div>`;
    html += `<div class="cc-plans">${shownDefs.map(d => acDefaultOpenTile(cls, d)).join("")}${shown.map(p => acPlanTile(me, cls, p, off, full, heldBy[p.id])).join("")}</div>`;
  }
  html += `<div id="acOpenMsg"></div>`;
  el.innerHTML = html;
}
// A closed original account, shown like any other account on offer. Opening it again is free and instant.
function acDefaultOpenTile(cls, d) {
  const per = acPeriod(cls), rate = Number(d.id === "cash" ? cls.cashInterestRate : cls.interestRate) || 0;
  const f = (k, v) => `<div class="cc-fact"><span>${k}</span><strong>${v}</strong></div>`;
  const blurb = d.id === "cash" ? "The account your pay comes into and your purchases come out of."
    : "The class Savings Account, for money you want to set aside.";
  return `<div class="cc-plan ac-plan${d.held ? " ac-held" : ""}">
    <div class="cc-plan-body">
      <div class="ac-tile-head"><strong>${acEsc(d.name)}</strong>${acKindBadge(d.kind)}</div>
      <p class="ac-blurb">${blurb}</p>
      <div class="cc-facts">${f("Interest", rate > 0 ? `${rate}% <small>per ${per.span}</small>` : "None")}${f("Account fee", "None")}${f("Withdrawals", "Unlimited")}</div>
      <div class="cc-perks"><span class="cc-chip mint">${icon("check", 12)}No fees</span></div>
      ${d.held ? acHaveAction(false, "Open this account") : `<button class="btn gold" onclick="acReopen('${d.id}')">Open this account</button>`}
    </div></div>`;
}

function acPlanTile(me, cls, p, off, full, heldStatus) {
  const score = lifestyleRatingFromData(cls, me, me.username);
  const locked = score < p.minLifestyle;
  const instant = acctSettings(cls).approval !== "teacher";
  const atMax = full[p.kind];
  let action;
  if (heldStatus) action = acHaveAction(heldStatus === "pending", instant ? "Open this account" : "Apply for this account");
  else if (off) action = `<div class="cc-lock">${icon("lock", 14)}<span>Not open yet</span></div>`;
  else if (locked) action = `<div class="cc-lock">${icon("lock", 14)}<span>${acTierNeed(cls, p.minLifestyle)}. Yours is ${Math.floor(score * 10) / 10}</span></div>`;
  else if (atMax) action = `<div class="cc-lock">${icon("lock", 14)}<span>You've reached the limit of ${p.kind} accounts</span></div>`;
  else action = `<button class="btn gold" onclick="acOpen('${acEsc(p.id)}')">${instant ? "Open this account" : "Apply for this account"}</button>`;
  return `<div class="cc-plan ac-plan ${heldStatus ? "ac-held" : locked || off || atMax ? "locked" : ""}">
    <div class="cc-plan-body">
      <div class="ac-tile-head"><strong>${acEsc(p.name)}</strong>${acKindBadge(p.kind)}</div>
      ${p.blurb ? `<p class="ac-blurb">${acEsc(p.blurb)}</p>` : ""}
      ${acFacts(p)}
      <div class="cc-perks">${acPerks(p)}</div>
      ${action}
    </div></div>`;
}

/* ---------------- Moving money ---------------- */
// Every account the student can move money in or out of, tagged with its kind (used by the move, transfer, pay-with and
// balance-tile menus). The two original accounts only appear while they are open.
function acChoicesWithKind(me, cls) { return anwOpenAccounts(me, cls); }
// The student's main account (the default "leaving" account): the one flagged main, else Cash; "" if neither is open.
function acMainId(me, cls) {
  const ch = acChoicesWithKind(me, cls);
  return (ch.find(c => c.isMain) || ch.find(c => c.id === "cash") || {}).id || "";
}
function acAccountChoices(me, cls) { return acChoicesWithKind(me, cls).map(c => ({ id: c.id, label: c.label, bal: c.bal })); }
// Rules worth knowing before money leaves an account (withdrawal cap, fee, lost bonus)
function acSourceNotes(me, cls, id) {
  const out = [], src = acctActiveOf(me).find(a => a.id === id), sp = src && acctPlanById(cls, src.planId);
  if (!sp) return out;
  if (sp.maxWithdrawals > 0) out.push(`${acEsc(sp.name)}: ${Math.min(src.wd || 0, sp.maxWithdrawals)} of ${sp.maxWithdrawals} withdrawals used this period.`);
  if (sp.withdrawFee > 0) out.push(`${acEsc(sp.name)} charges ${fmtMoney(sp.withdrawFee)} for each withdrawal.`);
  if (sp.bonusRate > 0 && !(src.wd > 0)) out.push(`Taking money out of ${acEsc(sp.name)} loses this period's +${sp.bonusRate}% bonus.`);
  return out;
}
function acMovePanel(me, cls) {
  const ch = acAccountChoices(me, cls);
  const ids = ch.map(c => c.id);
  if (ch.length < 2) return `<section class="cc-panel ac-move">
    <div class="cc-panel-head"><h3>Move money</h3></div>
    <p class="muted-small">You need two open accounts to move money between them. Open another account below.</p>
    <div id="acMoveMsg"></div>
  </section>`;
  // "From" defaults to the main account; "To" starts blank. A different pick stays while it's still valid.
  if (!ids.includes(AC_MOVE.from)) AC_MOVE.from = acMainId(me, cls);
  if (!ids.includes(AC_MOVE.to) || AC_MOVE.to === AC_MOVE.from) AC_MOVE.to = "";
  const opts = sel => `<option value="" disabled ${sel ? "" : "selected"}>Choose an account…</option>` + ch.map(c => `<option value="${acEsc(c.id)}" ${c.id === sel ? "selected" : ""}>${acEsc(c.label)}: ${fmtMoney(c.bal)}</option>`).join("");
  return `<section class="cc-panel ac-move">
    <div class="cc-panel-head"><h3>Move money</h3><span class="muted-small">Between the accounts above</span></div>
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
  // The clicked account is the known end. Add money: it's the "To", and "From" is the main account (blank if this IS the
  // main account). Take out: it's the "From", and "To" is left blank for the student to choose.
  const main = acMainId(AC_ME, AC_CLS);
  AC_MOVE = dir === "in" ? { from: id === main ? "" : main, to: id } : { from: id, to: "" };
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
  if (f && t && f.value && f.value === t.value) notes.push("Pick two different accounts.");
  const src = f && acct(f.value), dst = t && acct(t.value);
  const sp = src && acctPlanById(AC_CLS, src.planId), dp = dst && acctPlanById(AC_CLS, dst.planId);
  if (sp) {
    if (sp.maxWithdrawals > 0) notes.push(`${acEsc(sp.name)}: ${Math.min(src.wd || 0, sp.maxWithdrawals)} of ${sp.maxWithdrawals} withdrawals used this period.`);
    if (sp.withdrawFee > 0) notes.push(`${acEsc(sp.name)} charges ${fmtMoney(sp.withdrawFee)} for each withdrawal.`);
    if (sp.bonusRate > 0 && !(src.wd > 0)) notes.push(`Taking money out of ${acEsc(sp.name)} loses this period's +${sp.bonusRate}% bonus.`);
  }
  if (dp && dp.maxBalance > 0) notes.push(`${acEsc(dp.name)} can hold up to ${fmtMoney(dp.maxBalance)}. Room for ${fmtMoney(Math.max(0, dp.maxBalance - (dst.balance || 0)))} more.`);
  el.innerHTML = notes.length ? notes.map(n => `<span>${n}</span>`).join("") : "";
}
async function acMove(e) {
  e.preventDefault();
  const from = document.getElementById("acFrom").value, to = document.getElementById("acTo").value, amt = document.getElementById("acAmt").value;
  if (!from || !to) { acMsg("acMoveMsg", `<div class="error-msg">Choose an account for both From and To.</div>`); return false; }
  const btn = document.getElementById("acMoveBtn"); btn.disabled = true;
  const names = {}; acAccountChoices(AC_ME, AC_CLS).forEach(c => { names[c.id] = c.label; });
  const res = await moveBankMoney(CURRENT.username, CURRENT.classCode, from, to, amt);
  btn.disabled = false;
  if (!res.ok) { acMsg("acMoveMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return false; }
  const done = `Moved ${fmtMoney(Number(amt))} from ${names[from]} to ${names[to]}.`;
  AC_MOVE = { from: "", to: "" }; // back to the defaults: main account / nothing chosen
  await render();
  acMsg("acMoveMsg", `<div class="success-msg">${acEsc(done)}</div>`);
  return false;
}

/* ---------------- Student actions ---------------- */
function acSetFilter(k) { AC_FILTER = k; acRenderOpen(AC_ME, AC_CLS); }
async function acOpen(planId) {
  acMsg("acOpenMsg", "");
  const res = await openBankAccount(CURRENT.username, CURRENT.classCode, planId);
  if (!res.ok) { acMsg("acOpenMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  await render();
  acMsg("acOpenMsg", `<div class="success-msg">${res.status === "active" ? "Your account is open! Move some money in to get started." : "Application sent to your teacher."}</div>`);
}
async function acCancelApp(id) {
  await cancelBankAccountApplication(CURRENT.username, id);
  await render();
}
async function acReopen(id) {
  acMsg("acOpenMsg", "");
  const res = await reopenDefaultAccount(CURRENT.username, id);
  if (!res.ok) { acMsg("acOpenMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  await render();
  acMsg("acOpenMsg", `<div class="success-msg">Your ${id === "cash" ? "Cash balance" : "Savings Account"} is open again.${id === "cash" ? " Move some money in to start spending from it." : ""}</div>`);
}
async function acClose(id) {
  acMsg("acMsg", "");
  const ch = acChoicesWithKind(AC_ME, AC_CLS);
  const mine = ch.find(c => c.id === id), others = ch.filter(c => c.id !== id);
  if (!mine) return;
  if (!others.length) { acMsg("acMsg", `<div class="error-msg">You need at least one account open to keep your money in. Open another one first, then close this one.</div>`); return; }
  const bal = acctRound(mine.bal || 0);
  const cashNote = id === "cash" && mine.isMain ? "Your pay comes into your cash balance and your purchases come out of it. While it's closed you'll need to open it again and move money in before you can pay for things, and if money lands in it (like your wages) it opens again by itself."
    : mine.isMain ? "This is your main account, so your pay and payments will go back to your Cash balance (you can pick a new main account any time)." : "";
  let destId = "";
  if (bal > 0) {
    const def = others.find(c => c.isMain) || others.find(c => c.id === "cash") || others.find(c => c.kind !== "savings") || others[0];
    const r = await acDialog({
      title: `Close ${mine.label}?`, okText: "Close account", danger: true,
      html: `<p>The ${fmtMoney(bal)} in it has to move to another account. Where should it go?</p>
        <label for="acCloseDest">Move it to</label>
        <select id="acCloseDest">${others.map(c => `<option value="${acEsc(c.id)}" ${c.id === def.id ? "selected" : ""}>${acEsc(c.label)}: ${fmtMoney(c.bal)}</option>`).join("")}</select>
        ${cashNote ? `<p class="muted-small">${acEsc(cashNote)}</p>` : ""}`,
      collect: box => box.querySelector("#acCloseDest").value
    });
    if (!r) return;
    destId = r;
  } else {
    const ok = await t29Confirm(`Close ${mine.label}? There's nothing in it, so no money needs to move.${cashNote ? "\n\n" + cashNote : ""}`, { confirmText: "Close account", danger: true });
    if (!ok) return;
  }
  const res = await closeBankAccount(CURRENT.username, CURRENT.classCode, id, destId);
  if (!res.ok) { acMsg("acMsg", `<div class="error-msg">${acEsc(res.error)}</div>`); return; }
  await render();
  acMsg("acMsg", `<div class="success-msg">${acEsc(res.srcName || "Account")} closed${res.moved > 0 ? `: ${fmtMoney(res.moved)} moved to ${acEsc(res.destName)}` : ""}. You can open it again from “Open an account” below.</div>`);
}

/* ---------------- Balance tile (teacher only: students get one tile per account instead, see acTilesHtml) ---------------- */
const acGetBalView = anwGetBalView, acSetBalView = anwSetBalView; // shared with the floating widget (data-core.js)
// The account the tile shows: the one they picked if it's still open, otherwise cash, otherwise the first open account.
function acBalanceChoice(me, cls) { return anwBalanceChoice(me, cls); }
function acPaintBalanceWidget(me, cls) {
  const box = document.getElementById("balanceStat"); if (!box) return;
  box.classList.toggle("hidden", !IS_TEACHER);
  if (!IS_TEACHER) return;
  document.getElementById("balanceLabel").textContent = "Cash balance";
  document.getElementById("balance").textContent = "Unlimited ∞";
  document.getElementById("cashRateNote").classList.add("hidden");
  box.disabled = true; box.classList.add("is-static");
}

// The small pop-up lives in data-core.js (anwDialog) so the floating balance widget can use it too.
const acDialog = anwDialog;

/* ================= Teacher ================= */
function acRenderTeacher(cls, students) {
  const el = document.getElementById("acctTeacherCard");
  const st = acctSettings(cls), all = cls.accountPlans || [];
  const live = all.filter(p => !p.archived), archived = all.filter(p => p.archived);
  const rows = []; // every account any student holds
  students.forEach(s => acctListOf(acctLogical(s)).forEach(a => rows.push({ s, a, p: acctPlanById(cls, a.planId) }))); // logical view: each account shows its own money, not the swapped main-account balance
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
  const per = acPeriod(cls), br = acBaseRate(cls);
  const reco = AC_PRESETS.map(pr => {
    const p = acPresetPlan(cls, pr), have = liveNames.has(pr.name.toLowerCase());
    const bit = (v, rest) => `<span><b>${v}</b> ${rest}</span>`;
    const line = [
      p.rate > 0 ? bit(`${p.rate}%`, `interest per ${per.span}`) : `<span>No interest</span>`,
      p.bonusRate > 0 ? bit(`+${p.bonusRate}%`, "bonus") : "",
      p.fee > 0 ? bit(fmtMoney(p.fee), `fee per ${per.span}`) : "",
      p.withdrawFee > 0 ? bit(fmtMoney(p.withdrawFee), "per withdrawal") : "",
      p.maxWithdrawals > 0 ? bit(p.maxWithdrawals, `${p.maxWithdrawals === 1 ? "withdrawal" : "withdrawals"} per ${per.span}`) : "",
      p.maxBalance > 0 ? bit(fmtMoney(p.maxBalance), "cap") : ""
    ].filter(Boolean).join("");
    return `<div class="ac-reco-item ${have ? "have" : ""}">
      <div class="ac-reco-body"><div class="ac-reco-top"><strong>${acEsc(pr.name)}</strong>${acKindBadge(pr.kind)}</div>
        <p>${acEsc(p.blurb)}</p><div class="muted-small ac-reco-line">${line}</div></div>
      <button class="btn small ${have ? "secondary" : "gold"}" ${have ? "disabled" : ""} onclick="acAddPreset('${pr.key}')">${have ? "Added" : "+ Add"}</button>
    </div>`;
  }).join("");
  const tune = `<div class="ac-tune">
    <span class="cc-chip gold">${icon("repeat", 12)}${per.auto ? `Interest paid ${per.every}` : "Interest applied by hand"}</span>
    <span class="cc-chip mint">${icon("percent", 12)}${br.fallback ? `Typical ${br.rate}% base rate (your savings rate is 0%)` : `Built on your ${br.rate}% savings rate`}</span>
    <span class="cc-chip lilac">${icon("coin", 12)}${!per.auto ? "Fees and limits sized for weekly payments" : per.scale === 1 ? "Fees and limits set per weekly payment" : `Fees and limits scaled for ${per.every}`}</span>
    <a href="#" onclick="t29Jump('hSavingsSet');return false;">Change interest settings</a></div>`;
  const remaining = AC_PRESETS.filter(pr => !liveNames.has(pr.name.toLowerCase())).length;
  // Gone once every recommended account has been added; a teacher can also dismiss it (and bring it back).
  const recoPanel = !remaining ? "" : acRecoDismissed()
    ? `<p class="muted-small ac-reco-show"><a href="#" onclick="acDismissReco(false);return false;">Show recommended accounts</a></p>`
    : `<section class="cc-panel ac-reco-panel">
      <div class="cc-panel-head"><h3>${icon("sparkle", 16)} Recommended accounts</h3>
        <span class="ac-reco-actions"><button class="btn small gold" onclick="acAddAllPresets()">+ Add all ${remaining} remaining</button>
        <button class="btn small secondary" onclick="acDismissReco(true)">Dismiss</button></span></div>
      <p class="muted-small ac-reco-note">One click adds a ready-made account, personalised to how your class pays interest. You can edit anything afterwards.</p>
      ${tune}
      <div class="ac-reco">${reco}</div>
    </section>`;

  const pendRows = pending.length ? `<h3 class="cc-sub">${icon("history", 16)} Waiting for approval (${pending.length})</h3>
    <div class="table-scroll cc-tablewrap"><table class="stack-table"><thead><tr><th>Student</th><th>Account</th><th>Lifestyle</th><th></th></tr></thead><tbody>${pending.map(({ s, a, p }) => {
      if (!p) return "";
      const sc = lifestyleRatingFromData(cls, s, s.username), ok = sc >= p.minLifestyle;
      return `<tr><td>${acEsc(s.name)}</td><td>${acEsc(p.name)} ${acKindBadge(p.kind)}</td>
        <td><span class="badge ${ok ? "mint" : "coral"}">${Math.floor(sc * 10) / 10} / ${p.minLifestyle} needed</span></td>
        <td class="cc-row-actions"><button class="btn small mint" onclick="acApprove('${escapeJsAttr(s.username)}','${acEsc(a.id)}',${ok})">Approve</button>
          <button class="btn small coral" onclick="acDecline('${escapeJsAttr(s.username)}','${acEsc(a.id)}')">Decline</button></td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  const useRows = active.length ? `<h3 class="cc-sub">${icon("users", 16)} Accounts in use (${active.length})</h3>
    <div class="table-scroll cc-tablewrap"><table class="stack-table"><thead><tr><th>Student</th><th>Account</th><th>Balance</th><th>Interest earned</th><th>Fees paid</th><th>Opened</th></tr></thead><tbody>${active.slice().sort((x, y) => (y.a.balance || 0) - (x.a.balance || 0)).map(({ s, a, p }) => {
      const lt = a.lifetime || {};
      return `<tr><td>${acEsc(s.name)}</td><td>${p ? acEsc(p.name) : "—"}</td><td><strong>${fmtMoney(a.balance || 0)}</strong></td><td>${fmtMoney(lt.interest || 0)}</td><td>${fmtMoney(lt.fees || 0)}</td><td>${a.openedKey ? acEsc(cardDateLabel(a.openedKey)) : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  el.innerHTML = `
    <div class="flex-between cc-head"><h2 id="hAcctT">Bank accounts</h2>
      <label class="cc-switch"><input type="checkbox" id="acsEnabled" ${st.enabled ? "checked" : ""} onchange="acSaveSettings()"><span class="cc-switch-track"></span><span>${st.enabled ? "On for students" : "Off"}</span></label></div>
    <p class="cc-intro">Let students open extra <strong>everyday</strong> and <strong>savings</strong> accounts on top of their cash balance and Savings Account. You decide every rate, fee and limit. ${interestScheduleLabel(cls)} Your class Savings Account rate is ${cls.interestRate || 0}%. Change it, and how often interest is paid, in <a href="#" onclick="t29Jump('hSavingsSet');return false;">Savings &amp; interest</a> above.</p>
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
  const ex = [1000, 5000, 10000].map(bal => {
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
  if (cur !== 0 && !th.some(x => Number(x.min) === cur)) opts.push(`<option value="${cur}" selected>Custom. Rating ${cur}+</option>`);
  return `<select id="acp-minls">${opts.join("")}</select>`;
}
function acPlanFormHtml(p) {
  const fld = (id, label, val, step, hint, extra) => `<div class="${extra || ""}"><label for="acp-${id}">${label}</label><input id="acp-${id}" type="number" min="0" step="${step || "0.01"}" value="${val}" oninput="acFormLive()">${hint ? `<div class="muted-small">${hint}</div>` : ""}</div>`;
  const sav = p.kind === "savings";
  return `
    <h3>${p.id ? "Edit account" : "New account"}</h3>
    <div class="cc-form-grid">
      <div><label for="acp-name">Account name</label><input id="acp-name" maxlength="40" value="${acEsc(p.name)}" placeholder="e.g. Holiday Saver" required oninput="acFormLive()"></div>
      <div><label for="acp-kind">Type</label><select id="acp-kind" onchange="acKindChanged()"><option value="everyday" ${!sav ? "selected" : ""}>Everyday, for spending &amp; bills</option><option value="savings" ${sav ? "selected" : ""}>Savings, for growing money</option></select></div>
      <div><label for="acp-minls">Minimum lifestyle tier</label>${acTierSelectHtml(AC_CLS, p.minLifestyle)}<div class="muted-small">Students need at least this tier to open it</div></div>
      <div class="wide"><label for="acp-blurb">Short description <span class="muted-small">(optional, shown to students)</span></label><input id="acp-blurb" maxlength="90" value="${acEsc(p.blurb)}" placeholder="e.g. Save for something big, a small fee keeps you honest"></div>
      ${fld("rate", "Interest rate (%)", p.rate, "0.01", `Paid ${acPeriod(AC_CLS).every}`)}
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
  const base = { id: "", name: "", kind: "savings", blurb: "", rate: acBaseRate(AC_CLS).rate, bonusRate: 0, minBalance: 0, fee: 0, feeWaiveAt: 0, withdrawFee: 0, maxWithdrawals: 0, maxBalance: 0, minLifestyle: 0 };
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
