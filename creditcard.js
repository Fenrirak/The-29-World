/* creditcard.js — the credit card screens on the Bank page, plus the "pay
   with card" bar on the Store page.

   All the money rules (statements, interest, fees, cashback, vouchers,
   paying, applying) live in data-money.js under "Credit cards". This file
   only draws things and calls those functions, then asks bank.js's
   render() to redraw. Look for the cardXxx() helpers there. */

let CC_CLS = null, CC_ME = null, CC_STUDENTS = [];
let CC_STORE_PAY = { useCard: false, voucherId: "", split: false, cardMax: "" };
let CC_EDITING = null; // plan id being edited in the teacher form ("" = new)

function ccEsc(s) { return escapeHtml(s === undefined || s === null ? "" : String(s)); }
function ccTier(cls, planId) {
  const plans = (cls.cardPlans || []).slice().sort((a, b) => a.limit - b.limit);
  const i = plans.findIndex(p => p.id === planId);
  return (i < 0 ? 0 : i) % 5;
}
// Plans still store the tier's starting rating in `minLifestyle` (that is what
// the server-side check compares against); these helpers show/pick it by tier name.
function ccTierForRating(cls, rating) {
  return ((cls && cls.lifestyleThresholds) || []).find(t => Number(t.min) === Number(rating)) || null;
}
function ccTierNeedText(cls, rating) {
  const tier = ccTierForRating(cls, rating);
  return tier ? `the <strong>${ccEsc(tier.label)}</strong> lifestyle tier (rating ${rating}+)` : `a lifestyle rating of <strong>${rating}</strong>`;
}
function ccTierSelectHtml(cls, rating) {
  const th = (cls && cls.lifestyleThresholds) || [];
  const cur = Number(rating) || 0;
  const opts = th.map(x => `<option value="${x.min}" ${Number(x.min) === cur ? "selected" : ""}>${ccEsc(x.label)} (rating ${x.min}+)</option>`);
  if (!th.some(x => Number(x.min) === cur)) opts.unshift(`<option value="${cur}" selected>${cur > 0 ? "Custom — rating " + cur + "+" : "No minimum"}</option>`);
  return `<select id="ccp-minls">${opts.join("")}</select>`;
}
function ccPlural(n, w) { return `${n} ${w}${n === 1 ? "" : "s"}`; }

/* ---------------- Card colour themes (teacher picks one per plan) ---------------- */
const CC_THEMES = [
  { id: "ocean",    name: "Ocean Blue",     c: ["#1f3a6e", "#4a7ae0"] },
  { id: "violet",   name: "Violet",         c: ["#5b3fb0", "#9a86e6"] },
  { id: "midnight", name: "Midnight Black", c: ["#15151c", "#4a4330"] },
  { id: "emerald",  name: "Emerald",        c: ["#1b6b57", "#4fb8b0"] },
  { id: "ruby",     name: "Ruby Red",       c: ["#8f1d2c", "#e0586a"] },
  { id: "sunset",   name: "Sunset Orange",  c: ["#c4511a", "#f2a65a"] },
  { id: "gold",     name: "Royal Gold",     c: ["#8a6414", "#e6c35c"] },
  { id: "rose",     name: "Rose Pink",      c: ["#b03a6f", "#f08fb8"] },
  { id: "forest",   name: "Forest Green",   c: ["#1e4d2b", "#5fa86a"] },
  { id: "teal",     name: "Teal",           c: ["#0f5f6b", "#3fc1c9"] },
  { id: "slate",    name: "Slate Grey",     c: ["#2f3a4a", "#8795a8"] },
  { id: "plum",     name: "Plum",           c: ["#4a1f5e", "#a455c4"] }
];
const CC_STRIPES = "repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0,rgba(255,255,255,.07) 6px,rgba(255,255,255,0) 6px,rgba(255,255,255,0) 14px)";
function ccThemeBg(t) { return `${CC_STRIPES},linear-gradient(135deg,${t.c[0]},${t.c[1]})`; }
function ccThemeStyle(plan) {
  const t = CC_THEMES.find(x => x.id === (plan && plan.theme));
  // !important so it wins over the tier colours in style.css
  return t ? `background:${ccThemeBg(t)} !important;` : "";
}
function ccInjectThemeCss() {
  if (document.getElementById("ccThemeCss")) return;
  const st = document.createElement("style");
  st.id = "ccThemeCss";
  st.textContent = `
.cc-themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px;margin-top:6px}
.cc-theme{appearance:none;background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;color:inherit}
.cc-mini{position:relative;height:82px;border-radius:10px;padding:8px 9px;color:#fff;display:flex;flex-direction:column;justify-content:space-between;
  box-shadow:0 2px 6px rgba(0,0,0,.25);outline:3px solid transparent;outline-offset:2px;transition:transform .12s,outline-color .12s}
.cc-theme:hover .cc-mini,.cc-theme:focus-visible .cc-mini{transform:translateY(-2px)}
.cc-theme.on .cc-mini{outline-color:#f0b429}
.cc-mini-top{display:flex;justify-content:space-between;font-size:7px;letter-spacing:.14em;font-weight:800;opacity:.92}
.cc-mini-chip{width:19px;height:14px;border-radius:3px;background:linear-gradient(135deg,#f3dc95,#c9a24a)}
.cc-mini-bot{display:flex;justify-content:space-between;align-items:flex-end;gap:6px;font-size:8px;font-weight:800;text-transform:uppercase;line-height:1.1}
.cc-mini-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cc-mini-limit{white-space:nowrap}
.cc-mini-tick{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;background:#f0b429;color:#1f2b44;font-size:12px;font-weight:900;
  display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.cc-theme.on .cc-mini-tick{display:flex}
.cc-theme-label{display:block;font-size:12px;font-weight:700;margin-top:7px}
.cc-theme.auto .cc-mini{background:repeating-linear-gradient(45deg,#cfd6e2 0,#cfd6e2 6px,#e9edf4 6px,#e9edf4 12px);color:#1f2b44}
`;
  document.head.appendChild(st);
}
function ccMiniCard(bgStyle, name, limit) {
  return `<span class="cc-mini" style="${bgStyle}"><span class="cc-mini-tick" aria-hidden="true">✓</span>
    <span class="cc-mini-top"><span>THE 29 WORLD</span><span>)))</span></span>
    <span class="cc-mini-chip"></span>
    <span class="cc-mini-bot"><span class="cc-mini-name">${ccEsc(name)}</span><span class="cc-mini-limit">${ccEsc(limit)}</span></span></span>`;
}
function ccThemePickerHtml(p) {
  ccInjectThemeCss();
  const cur = (CC_THEMES.some(t => t.id === p.theme) ? p.theme : "");
  const name = p.name || "Card name", limit = fmtMoney(Number(p.limit) || 0);
  const tile = (id, label, bg, extra) => `<button type="button" role="radio" aria-checked="${cur === id}" class="cc-theme ${extra || ""} ${cur === id ? "on" : ""}" data-theme="${id}" onclick="ccPickTheme('${id}')">${ccMiniCard(bg, name, limit)}<span class="cc-theme-label">${label}</span></button>`;
  return `<div class="wide"><label>Card colour</label>
    <div class="cc-themes" id="ccThemePicker" role="radiogroup" aria-label="Card colour">
      ${tile("", "Automatic", "", "auto")}
      ${CC_THEMES.map(t => tile(t.id, t.name, `background:${ccThemeBg(t)};`)).join("")}
    </div>
    <input type="hidden" id="ccp-theme" value="${cur}">
    <div class="muted-small">Automatic uses the standard colour for the card's position in the range.</div></div>`;
}
function ccPickTheme(id) {
  document.getElementById("ccp-theme").value = id;
  document.querySelectorAll("#ccThemePicker .cc-theme").forEach(b => {
    const on = b.dataset.theme === id;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
}
// Keep the previews showing the plan's real name and limit as the teacher types
function ccThemeLive() {
  const n = document.getElementById("ccp-name"), l = document.getElementById("ccp-limit");
  document.querySelectorAll("#ccThemePicker .cc-mini-name").forEach(el => { el.textContent = (n && n.value.trim()) || "Card name"; });
  document.querySelectorAll("#ccThemePicker .cc-mini-limit").forEach(el => { el.textContent = fmtMoney(Number(l && l.value) || 0); });
}
// Fill the "Automatic" preview with whatever colour the stylesheet really gives this tier
function ccThemeInit(planId) {
  ["ccp-name", "ccp-limit"].forEach(i => { const el = document.getElementById(i); if (el) el.addEventListener("input", ccThemeLive); });
  const auto = document.querySelector("#ccThemePicker .cc-theme.auto .cc-mini");
  if (!auto) return;
  const probe = document.createElement("div");
  probe.className = "cc-visual cc-t" + (planId ? ccTier(CC_CLS, planId) : 0);
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  if (cs.backgroundImage && cs.backgroundImage !== "none") {
    auto.style.background = `${cs.backgroundImage}`;
    auto.style.backgroundColor = cs.backgroundColor;
    auto.style.color = "#fff";
  }
  probe.remove();
}

/* ---------------- Little building blocks ---------------- */
function ccVisual(cls, plan, name, last4, opts) {
  opts = opts || {};
  return `
    <div class="cc-visual cc-t${ccTier(cls, plan.id)} ${opts.small ? "sm" : ""} ${opts.pending ? "is-pending" : ""}" style="${ccThemeStyle(plan)}">
      <div class="cc-v-top">
        <span class="cc-v-brand">THE 29 WORLD</span>
        <span class="cc-v-wave" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 7c2.2 2.8 2.2 7.2 0 10"/><path d="M12 4.5c3.6 4.2 3.6 10.8 0 15"/><path d="M16 2.5c4.8 5.6 4.8 13.4 0 19"/></svg></span>
      </div>
      <div class="cc-v-chip" aria-hidden="true"></div>
      <div class="cc-v-num">${opts.small ? "" : `•••• •••• •••• ${ccEsc(last4 || "0000")}`}</div>
      <div class="cc-v-bottom">
        <div class="cc-v-who"><small>${opts.small ? "CARD" : "CARDHOLDER"}</small><span>${ccEsc(opts.small ? plan.name : name)}</span></div>
        <div class="cc-v-limit"><small>LIMIT</small><span>${fmtMoney(plan.limit)}</span></div>
      </div>
      ${opts.small ? "" : `<div class="cc-v-plan">${ccEsc(plan.name)}</div>`}
    </div>`;
}
function ccPerks(plan) {
  const out = [];
  if (plan.cashbackPct > 0) out.push(`<span class="cc-chip mint">${icon("coin", 12)}${plan.cashbackPct}% cashback</span>`);
  if (plan.storeDiscountPct > 0) out.push(`<span class="cc-chip gold">${icon("cart", 12)}${plan.storeDiscountPct}% off the class store</span>`);
  (plan.vouchers || []).forEach(v => out.push(`<span class="cc-chip lilac">${icon("trophy", 12)}${v.kind === "percent" ? `${v.value}% off voucher` : `${fmtMoney(v.value)} store voucher`}</span>`));
  return out.length ? out.join("") : `<span class="cc-chip plain">No extra perks</span>`;
}
function ccFacts(plan) {
  const f = (k, v) => `<div class="cc-fact"><span>${k}</span><strong>${v}</strong></div>`;
  return `<div class="cc-facts">
    ${f("Interest", plan.rate > 0 ? `${plan.rate}% every 2 weeks` : "None")}
    ${f("Monthly fee", plan.monthlyFee > 0 ? fmtMoney(plan.monthlyFee) : "None")}
    ${f("Interest-free", plan.freeDays > 0 ? `${ccPlural(plan.freeDays, "day")} to pay` : "Pay on statement day")}
    ${f("Minimum payment", `${plan.minPct}%`)}
    ${f("Late fee", plan.lateFee > 0 ? fmtMoney(plan.lateFee) : "None")}
  </div>`;
}
function ccMsg(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html || ""; }

/* ---------------- Entry point (called from bank.js render) ---------------- */
function renderCreditCard(me, cls, students) {
  CC_CLS = cls; CC_ME = me; CC_STUDENTS = students || [];
  const sCard = document.getElementById("cardCard"), tCard = document.getElementById("cardTeacherCard");
  if (!sCard || !tCard) return;
  sCard.classList.toggle("hidden", IS_TEACHER);
  tCard.classList.toggle("hidden", !IS_TEACHER);
  if (IS_TEACHER) ccRenderTeacher(cls, CC_STUDENTS);
  else ccRenderStudent(me, cls);
}

/* ================= Student ================= */
function ccRenderStudent(me, cls) {
  const el = document.getElementById("cardCard");
  const st = cardSettings(cls), plans = cardPlansOf(cls), card = me.creditCard;
  const active = cardIsActive(me);
  // Nothing to show until the teacher turns cards on (unless they still hold one).
  if (!st.enabled && !active) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const head = `<div class="flex-between cc-head"><h2 id="hCard">${icon("cards", 20)} Credit card</h2>
    <span class="cc-head-note">${st.approval === "instant" ? "Instant approval" : "Teacher approval needed"}</span></div>`;
  if (active) { el.innerHTML = head + ccActiveHtml(me, cls) + `<div id="ccMsg"></div>`; return; }
  if (card && card.status === "pending") {
    const plan = cardPlanById(cls, card.planId);
    el.innerHTML = head + (plan ? `<div class="cc-pending">
        <div class="cc-pending-card">${ccVisual(cls, plan, me.name, cardLast4(me.username), { pending: true })}</div>
        <div class="cc-pending-text">
          <span class="badge gold">${icon("calendar", 12)} Waiting for approval</span>
          <h3>Your ${ccEsc(plan.name)} application is with your teacher</h3>
          <p class="muted-small">You'll be able to spend as soon as it's approved. Nothing else to do.</p>
          <button class="btn small" onclick="ccCancel()">Withdraw application</button>
        </div></div>` : `<p class="muted-small">That plan is no longer available.</p><button class="btn small" onclick="ccCancel()">Withdraw application</button>`)
      + `<div id="ccMsg"></div>`;
    return;
  }
  const denied = card && card.status === "denied";
  const score = lifestyleRatingFromData(cls, me, me.username);
  el.innerHTML = head
    + (denied ? `<div class="cc-note bad">${icon("bell", 16)}<span>Your last application wasn't approved. You can pick another card below.</span></div>` : "")
    + (plans.length ? `
      <p class="cc-intro">Spend now, pay later. Pay your whole closing balance by the due date and you'll never pay interest. Pick a card:</p>
      <div class="cc-plans">${plans.slice().sort((a, b) => a.limit - b.limit).map(p => ccPlanTile(me, cls, p, score)).join("")}</div>`
      : `<div class="empty-state"><p>Your teacher hasn't set up any credit cards yet. Check back soon.</p></div>`)
    + `<div id="ccMsg"></div>`;
}
function ccPlanTile(me, cls, p, score) {
  const locked = score < p.minLifestyle;
  return `<div class="cc-plan ${locked ? "locked" : ""}">
    ${ccVisual(cls, p, me.name, "", { small: true })}
    <div class="cc-plan-body">
      ${ccFacts(p)}
      <div class="cc-perks">${ccPerks(p)}</div>
      ${locked
        ? `<div class="cc-lock">${icon("lock", 14)}<span>Needs ${ccTierNeedText(cls, p.minLifestyle)} — yours is ${Math.floor(score * 10) / 10}</span></div>`
        : `<button class="btn gold" onclick="ccApply('${ccEsc(p.id)}')">${cardSettings(cls).approval === "instant" ? "Get this card" : "Apply for this card"}</button>`}
    </div>
  </div>`;
}
function ccActiveHtml(me, cls) {
  const c = me.creditCard, plan = cardPlanById(cls, c.planId);
  if (!plan) return `<p class="muted-small">Your card's plan was removed by your teacher. Pay off the balance of ${fmtMoney(c.balance || 0)} below.</p>`;
  const today = nzDateKey(), s = c.stmt, rem = cardStmtRemaining(c);
  const owing = cardRound(c.balance || 0), avail = cardAvailable(c, plan);
  const unbilled = cardRound(Math.max(0, owing - rem));
  const usedPct = plan.limit > 0 ? Math.min(100, owing / plan.limit * 100) : 0;
  const pen = cls.lifestyleConfig && cls.lifestyleConfig.creditCard;
  const penPts = pen && pen.enabled && pen.perAmount > 0 && pen.points > 0 ? Math.floor(rem / pen.perAmount) * pen.points : 0;

  // ---- the statement banner ----
  let banner;
  if (s && rem > 0.004) {
    const days = daysBetweenKeys(today, s.dueKey), late = days < 0;
    const span = Math.max(1, daysBetweenKeys(s.closeKey, s.dueKey));
    const pct = Math.max(0, Math.min(100, daysBetweenKeys(s.closeKey, today) / span * 100));
    const cls2 = late ? "late" : days <= 2 ? "soon" : "";
    banner = `<div class="cc-stmt ${cls2}">
      <div class="cc-stmt-top">
        <div>
          <div class="cc-stmt-label">${icon("idcard", 14)} Closing balance${late ? " — overdue" : ""}</div>
          <div class="cc-stmt-value">${fmtMoney(rem)}</div>
          ${rem < s.amount - 0.004 ? `<div class="cc-stmt-sub">${fmtMoney(s.amount)} statement · ${fmtMoney(s.paid)} paid so far</div>` : `<div class="cc-stmt-sub">Statement closed ${ccEsc(cardDateLabel(s.closeKey))}</div>`}
        </div>
        <div class="cc-stmt-due"><small>${late ? "Was due" : "Pay by"}</small><strong>${ccEsc(cardDateLabel(s.dueKey))}</strong>
          <span>${late ? `${ccPlural(Math.abs(days), "day")} late` : days === 0 ? "due today" : `${ccPlural(days, "day")} left`}</span></div>
      </div>
      <div class="cc-timeline"><div class="cc-timeline-fill" style="width:${late ? 100 : pct.toFixed(1)}%"></div></div>
      <div class="cc-timeline-labels"><span>Statement closed</span><span>${late ? "Interest applies" : "Interest-free until due date"}</span></div>
      <div class="cc-stmt-hint">${late
        ? `Interest will be added at your next statement${s.minDue > (s.paidOnTime || 0) + 0.004 ? ", and a late fee was added because the minimum wasn't paid on time" : ""}.`
        : `Pay the full ${fmtMoney(rem)} by the due date and you pay <strong>no interest</strong>. Minimum payment: ${fmtMoney(s.minDue)}.`}</div>
      ${penPts > 0 ? `<div class="cc-pen">${icon("bell", 14)}<span>Unpaid, this is costing you <strong>${penPts} lifestyle point${penPts === 1 ? "" : "s"}</strong>.</span></div>` : ""}
    </div>`;
  } else {
    banner = `<div class="cc-stmt ok">
      <div class="cc-stmt-top"><div>
        <div class="cc-stmt-label">${icon("medal", 14)} ${s ? "Statement paid" : "No statement yet"}</div>
        <div class="cc-stmt-value">${fmtMoney(0)}</div>
        <div class="cc-stmt-sub">${s ? `Nothing to pay from ${ccEsc(cardDateLabel(s.closeKey))}` : "Your first statement is on its way"}</div>
      </div><div class="cc-stmt-due"><small>Next statement</small><strong>${ccEsc(cardDateLabel(c.nextCloseKey))}</strong><span>${ccPlural(Math.max(0, daysBetweenKeys(today, c.nextCloseKey)), "day")} to go</span></div></div>
    </div>`;
  }

  // ---- vouchers ----
  const vs = cardUsableVouchers(me, today);
  const vouchers = vs.length ? `<div class="cc-vouchers"><h3>${icon("trophy", 16)} Your vouchers</h3><div class="cc-voucher-row">${vs.map(v => `
      <a class="cc-voucher" href="store.html">
        <div class="cc-voucher-val">${v.kind === "percent" ? `${v.value}%` : fmtMoney(v.left)}</div>
        <div class="cc-voucher-txt"><strong>${v.kind === "percent" ? "off a store purchase" : "store credit"}</strong><span>Use by ${ccEsc(cardDateLabel(v.expiryKey))}</span></div>
      </a>`).join("")}</div></div>` : "";

  // ---- statement breakdown ----
  const lt = c.lifetime || { cashback: 0, interest: 0, fees: 0 };
  const breakdown = s ? `
    <div class="cc-fact"><span>Spent that period</span><strong>${fmtMoney(s.spend || 0)}</strong></div>
    ${s.interest > 0 ? `<div class="cc-fact"><span>Interest charged</span><strong>${fmtMoney(s.interest)}</strong></div>` : ""}
    ${s.fee > 0 ? `<div class="cc-fact"><span>Monthly fee</span><strong>${fmtMoney(s.fee)}</strong></div>` : ""}
    ${s.lateFee > 0 ? `<div class="cc-fact"><span>Late fee</span><strong>${fmtMoney(s.lateFee)}</strong></div>` : ""}
    ${s.cashback > 0 ? `<div class="cc-fact"><span>Cashback earned</span><strong>−${fmtMoney(s.cashback)}</strong></div>` : ""}
    <div class="cc-fact"><span>Closing balance</span><strong>${fmtMoney(s.amount)}</strong></div>` : `<p class="muted-small">No statement has closed yet.</p>`;

  return `
  <div class="cc-active">
    <div class="cc-left">
      ${ccVisual(cls, plan, me.name, cardLast4(me.username))}
      <div class="cc-perks center">${ccPerks(plan)}</div>
      <div class="cc-lifetime">
        <div><span>Cashback earned</span><strong class="good">${fmtMoney(lt.cashback || 0)}</strong></div>
        <div><span>Interest &amp; fees paid</span><strong class="${(lt.interest || 0) + (lt.fees || 0) > 0 ? "bad" : ""}">${fmtMoney((lt.interest || 0) + (lt.fees || 0))}</strong></div>
      </div>
    </div>
    <div class="cc-right">
      ${banner}
      <div class="cc-limit">
        <div class="cc-limit-head"><span>Owing <strong>${fmtMoney(owing)}</strong> of ${fmtMoney(plan.limit)}</span><span class="cc-avail">${fmtMoney(avail)} available</span></div>
        <div class="cc-limit-bar"><div class="cc-limit-fill ${usedPct > 85 ? "hot" : ""}" style="width:${usedPct.toFixed(1)}%"></div></div>
        <div class="cc-limit-sub">${unbilled > 0 ? `${fmtMoney(unbilled)} spent since your last statement · it closes ${ccEsc(cardDateLabel(c.nextCloseKey))}` : `Next statement closes ${ccEsc(cardDateLabel(c.nextCloseKey))}`}</div>
      </div>
      <label class="cc-check cc-check-tile"><input type="checkbox" ${c.eventsOnCard ? "checked" : ""} onchange="ccSetEventsPref(this.checked)"> Put unexpected costs (random events) on this card first</label>
      <div class="muted-small" style="margin-bottom:8px;">Big events ask you how to pay each time. Random events can't ask first, so this is their default (cash covers anything over your limit).</div>
      <div class="cc-pay">
        <label for="ccPayAmt">Make a payment <span class="muted-small">from your cash (${fmtMoney(me.balance)})</span></label>
        <div class="cc-pay-row">
          <div class="cc-pay-input"><span>$</span><input id="ccPayAmt" type="number" min="0.01" step="0.01" placeholder="0.00" ${owing <= 0.004 ? "disabled" : ""}></div>
          <button class="btn mint" onclick="ccPay()" ${owing <= 0.004 ? "disabled" : ""}>Pay</button>
        </div>
        <div class="cc-quick">
          ${rem > 0.004 ? `<button type="button" onclick="ccFill(${rem})">Closing balance · ${fmtMoney(rem)}</button>` : ""}
          ${s && rem > 0.004 && (s.minDue - (s.paid || 0)) > 0.004 ? `<button type="button" onclick="ccFill(${cardRound(s.minDue - (s.paid || 0))})">Minimum · ${fmtMoney(s.minDue - (s.paid || 0))}</button>` : ""}
          ${owing > 0.004 && owing - rem > 0.004 ? `<button type="button" onclick="ccFill(${owing})">Everything · ${fmtMoney(owing)}</button>` : ""}
        </div>
      </div>
    </div>
  </div>
  ${vouchers}
  <details class="cc-more">
    <summary>${icon("settings", 14)} How your card works</summary>
    <div class="cc-more-grid">
      <div><h4>Your plan</h4>${ccFacts(plan)}</div>
      <div><h4>Last statement</h4><div class="cc-facts">${breakdown}</div></div>
    </div>
    <ul class="cc-rules">
      <li>Your statement closes every 2 weeks (on a ${ccEsc(DAY_FULL[cardSettings(cls).statementDay] || "Friday")}). Whatever you owe then becomes the <strong>closing balance</strong>.</li>
      <li>Pay it <strong>in full</strong> by the due date and there's no interest. If you don't, interest is added at the next statement.</li>
      <li>The monthly fee is charged every 4 weeks. Cashback is credited at each statement.</li>
      <li>Use it wherever a real card works: the <a href="store.html">Store</a> (card perks apply there), Transport, insurance sign-up fees, the Trade Centre (not houses), and big or random events. It can't pay loans, savings, shares, gambling, rent or a mortgage.</li>
      <li>On a big purchase (or one your card can't cover) you can split the payment between card and cash.</li>
    </ul>
    ${owing <= 0.004 ? `<button class="btn small ghost-danger" onclick="ccCancel()">Close this card</button>` : ""}
  </details>`;
}

/* ---- Student actions ---- */
function ccFill(n) { const i = document.getElementById("ccPayAmt"); if (i) { i.value = cardRound(n).toFixed(2); i.focus(); } }
async function ccApply(planId) {
  ccMsg("ccMsg", "");
  const res = await applyForCreditCard(CURRENT.username, CURRENT.classCode, planId);
  if (!res.ok) { ccMsg("ccMsg", `<div class="error-msg">${ccEsc(res.error)}</div>`); return; }
  await render();
  ccMsg("ccMsg", `<div class="success-msg">${res.status === "active" ? "Your card is ready! Your first statement date is shown below." : "Application sent to your teacher."}</div>`);
}
async function ccPay() {
  const input = document.getElementById("ccPayAmt");
  const amt = cardRound(input ? input.value : 0);
  ccMsg("ccMsg", "");
  const res = await payCreditCard(CURRENT.username, CURRENT.classCode, amt);
  if (!res.ok) { ccMsg("ccMsg", `<div class="error-msg">${ccEsc(res.error)}</div>`); return; }
  await render();
  ccMsg("ccMsg", `<div class="success-msg">Paid ${fmtMoney(amt)}.${res.clearedStmt ? " Your closing balance is cleared — no interest!" : ""}</div>`);
}
async function ccSetEventsPref(on) {
  await setCardEventsPref(CURRENT.username, on);
  await render();
  ccMsg("ccMsg", `<div class="success-msg">${on ? "Unexpected costs will go on your card first." : "Unexpected costs will come out of your cash."}</div>`);
}
async function ccCancel() {
  const c = CC_ME && CC_ME.creditCard;
  const msg = c && c.status === "pending" ? "Withdraw your card application?" : "Close your credit card? Any unused vouchers will be lost.";
  if (!confirm(msg)) return;
  const res = await cancelCreditCard(CURRENT.username, CURRENT.classCode);
  if (!res.ok) { ccMsg("ccMsg", `<div class="error-msg">${ccEsc(res.error)}</div>`); return; }
  await render();
}

/* ================= Teacher ================= */
function ccRenderTeacher(cls, students) {
  const el = document.getElementById("cardTeacherCard");
  const st = cardSettings(cls), allPlans = cls.cardPlans || [];
  const live = allPlans.filter(p => !p.archived), archived = allPlans.filter(p => p.archived);
  const pen = (cls.lifestyleConfig && cls.lifestyleConfig.creditCard) || { enabled: false, perAmount: 0, points: 1 };
  const holders = students.filter(s => s.creditCard && (s.creditCard.status === "active" || s.creditCard.status === "pending"));
  const pending = students.filter(s => s.creditCard && s.creditCard.status === "pending");
  const active = students.filter(s => cardIsActive(s));
  const today = nzDateKey();
  const dayOpts = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<option value="${d}" ${st.statementDay === d ? "selected" : ""}>${DAY_FULL[d]}</option>`).join("");

  const planRows = live.length ? live.slice().sort((a, b) => a.limit - b.limit).map(p => {
    const n = holders.filter(s => s.creditCard.planId === p.id).length;
    return `<div class="cc-tplan">
      ${ccVisual(cls, p, "", "", { small: true })}
      <div class="cc-tplan-body">
        <div class="cc-tplan-top"><strong>${ccEsc(p.name)}</strong><span class="badge navy">${ccPlural(n, "holder")}</span></div>
        ${ccFacts(p)}
        <div class="cc-perks">${ccPerks(p)}</div>
        <div class="muted-small">${ccTierForRating(cls, p.minLifestyle) ? "Needs the " + ccEsc(ccTierForRating(cls, p.minLifestyle).label) + " tier or higher" : "Needs lifestyle rating " + p.minLifestyle + "+"}</div>
        <div class="cc-tplan-actions"><button class="btn small" onclick="ccEditPlan('${ccEsc(p.id)}')">Edit</button>
          <button class="btn small coral" onclick="ccRemovePlan('${ccEsc(p.id)}')">${n > 0 ? "Retire" : "Delete"}</button></div>
      </div></div>`;
  }).join("") : `<div class="empty-state"><p>No plans yet. Add your first one below — try a basic card with a low limit, then a premium one with better perks.</p></div>`;

  const pendRows = pending.length ? `<h3 class="cc-sub">${icon("calendar", 16)} Waiting for approval (${pending.length})</h3>
    <div class="table-scroll cc-tablewrap"><table><thead><tr><th>Student</th><th>Card</th><th>Lifestyle</th><th></th></tr></thead><tbody>${pending.map(s => {
      const p = cardPlanById(cls, s.creditCard.planId); if (!p) return "";
      const sc = lifestyleRatingFromData(cls, s, s.username), ok = sc >= p.minLifestyle;
      return `<tr><td>${ccEsc(s.name)}</td><td>${ccEsc(p.name)} · ${fmtMoney(p.limit)}</td>
        <td><span class="badge ${ok ? "mint" : "coral"}">${Math.floor(sc * 10) / 10} / ${p.minLifestyle} needed${ccTierForRating(cls, p.minLifestyle) ? " (" + ccEsc(ccTierForRating(cls, p.minLifestyle).label) + ")" : ""}</span></td>
        <td class="cc-row-actions"><button class="btn small mint" onclick="ccApprove('${ccEsc(s.username)}', ${ok})">Approve</button>
          <button class="btn small coral" onclick="ccDecline('${ccEsc(s.username)}')">Decline</button></td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  const cardRows = active.length ? `<h3 class="cc-sub">${icon("users", 16)} Cards in use (${active.length})</h3>
    <div class="table-scroll cc-tablewrap"><table><thead><tr><th>Student</th><th>Card</th><th>Owing</th><th>Unpaid statement</th><th>Due</th><th>Status</th></tr></thead><tbody>${active.map(s => {
      const c = s.creditCard, p = cardPlanById(cls, c.planId), rem = cardStmtRemaining(c);
      let status = `<span class="badge mint">Clear</span>`, due = "—";
      if (c.stmt && rem > 0.004) {
        const d = daysBetweenKeys(today, c.stmt.dueKey); due = ccEsc(cardDateLabel(c.stmt.dueKey));
        status = d < 0 ? `<span class="badge coral">${ccPlural(Math.abs(d), "day")} overdue</span>` : `<span class="badge gold">${d === 0 ? "Due today" : `${ccPlural(d, "day")} left`}</span>`;
      } else if ((c.balance || 0) > 0.004) status = `<span class="badge navy">Spending</span>`;
      return `<tr><td>${ccEsc(s.name)}</td><td>${p ? ccEsc(p.name) : "—"}</td><td>${fmtMoney(c.balance || 0)}</td><td>${rem > 0.004 ? fmtMoney(rem) : "—"}</td><td>${due}</td><td>${status}</td></tr>`;
    }).join("")}</tbody></table></div>` : "";

  const overdueN = active.filter(s => { const c = s.creditCard; return c.stmt && cardStmtRemaining(c) > 0.004 && daysBetweenKeys(today, c.stmt.dueKey) < 0; }).length;
  const penNum = (id, val, ph) => `<input id="${id}" type="number" min="0" step="1" value="${val}" ${ph ? `placeholder="${ph}"` : ""} onchange="ccSaveSettings()">`;

  el.innerHTML = `
    <div class="flex-between cc-head"><h2 id="hCardT">${icon("cards", 20)} Credit cards</h2>
      <label class="cc-switch"><input type="checkbox" id="ccsEnabled" ${st.enabled ? "checked" : ""} onchange="ccSaveSettings()"><span class="cc-switch-track"></span><span>${st.enabled ? "On for students" : "Off"}</span></label></div>
    <p class="cc-intro">Students spend now and pay later, like a real New Zealand card. Statements close every 2 weeks; pay the closing balance by the due date to avoid interest.</p>
    <div class="cc-tstats">
      <div class="cc-tstat"><span>Cards in use</span><strong>${active.length}</strong></div>
      <div class="cc-tstat ${pending.length ? "alert" : ""}"><span>Waiting for approval</span><strong>${pending.length}</strong></div>
      <div class="cc-tstat ${overdueN ? "bad" : ""}"><span>Overdue</span><strong>${overdueN}</strong></div>
      <div class="cc-tstat"><span>Plans on offer</span><strong>${live.length}</strong></div>
    </div>
    <section class="cc-panel">
      <div class="cc-panel-head"><h3>${icon("settings", 16)} Settings</h3><span class="muted-small">Changes save as soon as you make them</span></div>
      <div class="cc-settings">
        <div class="cc-set"><label for="ccsApproval">New cards</label><p>Who decides when a student applies.</p>
          <select id="ccsApproval" onchange="ccSaveSettings()"><option value="teacher" ${st.approval === "teacher" ? "selected" : ""}>You approve each one</option><option value="instant" ${st.approval === "instant" ? "selected" : ""}>Instant for eligible students</option></select></div>
        <div class="cc-set"><label for="ccsDay">Statement closes on</label><p>Statements then close every 2 weeks.</p>
          <select id="ccsDay" onchange="ccSaveSettings()">${dayOpts}</select></div>
        <div class="cc-set"><label for="ccsSplit">Part-payments from</label><p>Smallest purchase a student may split between card and cash. A purchase the card can't cover can always be split.</p>
          <div class="cc-num money"><i>$</i><input id="ccsSplit" type="number" min="0" step="1" value="${st.splitMin}" onchange="ccSaveSettings()"></div></div>
        <div class="cc-set cc-set-pen ${pen.enabled ? "" : "is-off"}">
          <div class="cc-set-text"><label for="ccsPenOn">Lifestyle penalty for unpaid balance</label>
            <p>Counts last statement's unpaid closing balance, starting the day it closes (free days included).</p></div>
          <div class="cc-set-ctl">
            <label class="cc-switch"><input type="checkbox" id="ccsPenOn" ${pen.enabled ? "checked" : ""} onchange="ccSaveSettings()"><span class="cc-switch-track"></span><span>${pen.enabled ? "On" : "Off"}</span></label>
            <div class="cc-sentence"><span>−</span><div class="cc-num">${penNum("ccsPenPts", pen.points || 1)}</div><span>pt per</span><div class="cc-num money"><i>$</i>${penNum("ccsPenAmt", pen.perAmount || "", "50")}</div><span>unpaid</span></div>
          </div>
        </div>
      </div>
    </section>
    <div id="ccTMsg"></div>
    <h3 class="cc-sub">${icon("cards", 16)} Plans</h3>
    <div class="cc-tplans">${planRows}</div>
    ${archived.length ? `<p class="muted-small cc-archived">Retired: ${archived.map(p => `${ccEsc(p.name)} <a href="#" onclick="ccRestorePlan('${ccEsc(p.id)}');return false;">restore</a>`).join(" · ")}</p>` : ""}
    <div class="cc-form-wrap"><button class="btn gold small" onclick="ccEditPlan('')" id="ccNewBtn">+ Add a plan</button>
      <form class="cc-form hidden" id="ccPlanForm" onsubmit="return ccSavePlan(event)"></form></div>
    ${pendRows}${cardRows}`;
}

function ccPlanFormHtml(p) {
  const v = p.vouchers || [];
  const vRow = (i) => {
    const cur = v[i] || { kind: "", value: "" };
    return `<div class="cc-vrow"><select id="ccp-vk${i}"><option value="">No voucher</option>
      <option value="credit" ${cur.kind === "credit" ? "selected" : ""}>$ store credit</option><option value="percent" ${cur.kind === "percent" ? "selected" : ""}>% off a purchase</option></select>
      <input id="ccp-vv${i}" type="number" min="0" step="0.01" value="${cur.value}" placeholder="amount"></div>`;
  };
  const fld = (id, label, val, step, hint) => `<div><label for="ccp-${id}">${label}</label><input id="ccp-${id}" type="number" min="0" step="${step || "0.01"}" value="${val}" required>${hint ? `<div class="muted-small">${hint}</div>` : ""}</div>`;
  return `
    <h3>${p.id ? "Edit plan" : "New plan"}</h3>
    <div class="cc-form-grid">
      <div class="wide"><label for="ccp-name">Plan name</label><input id="ccp-name" maxlength="40" value="${ccEsc(p.name)}" placeholder="e.g. Everyday Classic" required></div>
      ${ccThemePickerHtml(p)}
      ${fld("limit", "Spending limit ($)", p.limit, "1")}
      ${fld("rate", "Interest (% every 2 weeks)", p.rate, "0.01", "On what's owed if the last statement wasn't paid in full")}
      ${fld("fee", "Monthly fee ($)", p.monthlyFee, "0.01", "Charged every 4 weeks")}
      ${fld("free", "Interest-free days to pay", p.freeDays, "1", "0–" + CARD_MAX_FREE_DAYS + " days after the statement closes")}
      <div><label for="ccp-minls">Minimum lifestyle tier</label>${ccTierSelectHtml(CC_CLS, p.minLifestyle)}<div class="muted-small">Students need at least this tier to get the card</div></div>
      ${fld("minpct", "Minimum payment (%)", p.minPct, "0.1", "Smallest repayment due by the due date, as a % of the closing balance")}
      ${fld("late", "Late fee ($)", p.lateFee, "0.01", "If the minimum isn't paid by the due date")}
      ${fld("cash", "Cashback (%)", p.cashbackPct, "0.1", "Of card spending, credited each statement")}
      ${fld("disc", "Class store discount (%)", p.storeDiscountPct, "0.1", "When paying with this card")}
    </div>
    <label>Vouchers <span class="muted-small">issued to the student every statement, valid until the next one</span></label>
    <div class="cc-vouchers-edit">${vRow(0)}${vRow(1)}</div>
    <div class="cc-form-actions"><button class="btn gold" type="submit">Save plan</button><button class="btn" type="button" onclick="ccCancelEdit()">Cancel</button></div>
    <input type="hidden" id="ccp-id" value="${ccEsc(p.id || "")}">`;
}
function ccEditPlan(id) {
  const base = { id: "", name: "", limit: 500, rate: 2, monthlyFee: 0, freeDays: 7, minLifestyle: 0, minPct: 5, lateFee: 5, cashbackPct: 0, storeDiscountPct: 0, vouchers: [] };
  const p = id ? ((CC_CLS.cardPlans || []).find(x => x.id === id) || base) : base;
  const f = document.getElementById("ccPlanForm");
  f.innerHTML = ccPlanFormHtml(p);
  f.classList.remove("hidden");
  ccThemeInit(id);
  document.getElementById("ccNewBtn").classList.add("hidden");
  f.scrollIntoView({ behavior: "smooth", block: "center" });
}
function ccCancelEdit() {
  document.getElementById("ccPlanForm").classList.add("hidden");
  document.getElementById("ccNewBtn").classList.remove("hidden");
}
async function ccSavePlan(e) {
  e.preventDefault();
  const g = id => document.getElementById("ccp-" + id).value;
  const vouchers = [0, 1].map(i => ({ kind: g("vk" + i), value: g("vv" + i) })).filter(v => v.kind && Number(v.value) > 0);
  const id = g("id");
  const old = id ? (CC_CLS.cardPlans || []).find(p => p.id === id) : null;
  const g0name = g("name");
  const theme = CC_THEMES.some(t => t.id === g("theme")) ? g("theme") : "";
  await saveCardPlan(CURRENT.classCode, {
    id: id || undefined, name: g("name"), limit: g("limit"), rate: g("rate"), monthlyFee: g("fee"), freeDays: g("free"),
    minLifestyle: g("minls"), minPct: g("minpct"), lateFee: g("late"), cashbackPct: g("cash"), storeDiscountPct: g("disc"),
    vouchers, theme, archived: old ? !!old.archived : false
  });
  await render();
  const saved = (CC_CLS.cardPlans || []).slice().reverse().find(p => id ? p.id === id : p.name === g0name);
  if (theme && saved && saved.theme !== theme) {
    ccMsg("ccTMsg", `<div class="error-msg">Plan saved, but the card colour wasn't kept — saveCardPlan() in data-money.js needs to store the <code>theme</code> field.</div>`);
    return false;
  }
  ccMsg("ccTMsg", `<div class="success-msg">Plan saved. Changes apply to existing cards at their next statement and in the store straight away.</div>`);
  return false;
}
async function ccRemovePlan(id) {
  const n = CC_STUDENTS.filter(s => s.creditCard && (s.creditCard.status === "active" || s.creditCard.status === "pending") && s.creditCard.planId === id).length;
  const ok = confirm(n > 0 ? `${ccPlural(n, "student")} hold or applied for this card. It will be retired: hidden from new applicants, but existing cards keep working. Continue?` : "Delete this plan?");
  if (!ok) return;
  await removeCardPlan(CURRENT.classCode, id, n > 0);
  await render();
}
async function ccRestorePlan(id) {
  const p = (CC_CLS.cardPlans || []).find(x => x.id === id);
  if (p) await saveCardPlan(CURRENT.classCode, Object.assign({}, p, { archived: false }));
  await render();
}
async function ccSaveSettings() {
  const g = id => document.getElementById(id);
  await saveCardSettings(CURRENT.classCode, { enabled: g("ccsEnabled").checked, approval: g("ccsApproval").value, statementDay: g("ccsDay").value, splitMin: g("ccsSplit").value });
  await setCardLifestylePenalty(CURRENT.classCode, { enabled: g("ccsPenOn").checked, perAmount: g("ccsPenAmt").value, points: g("ccsPenPts").value });
  await render();
  ccMsg("ccTMsg", `<div class="success-msg">Saved.</div>`);
}
async function ccApprove(username, eligible) {
  if (!eligible && !confirm("This student is below the lifestyle rating for that card. Approve anyway?")) return;
  const res = await approveCreditCard(CURRENT.classCode, username);
  if (!res.ok) ccMsg("ccTMsg", `<div class="error-msg">${ccEsc(res.error)}</div>`);
  await render();
}
async function ccDecline(username) {
  const res = await declineCreditCard(CURRENT.classCode, username);
  if (!res.ok) ccMsg("ccTMsg", `<div class="error-msg">${ccEsc(res.error)}</div>`);
  await render();
}

/* ================= Store: "Pay with" bar ================= */
// Called by store.js render(). Fills #storePayBar for a student who holds an
// active card; hidden for everyone else.
function ccStoreBarRender(me, cls) {
  const el = document.getElementById("storePayBar");
  if (!el) return;
  const plan = cardIsActive(me) ? cardPlanById(cls, me.creditCard.planId) : null;
  if (!plan) { el.classList.add("hidden"); CC_STORE_PAY = { useCard: false, voucherId: "", split: false, cardMax: "" }; return; }
  const vs = cardUsableVouchers(me, nzDateKey());
  if (!vs.some(v => v.id === CC_STORE_PAY.voucherId)) CC_STORE_PAY.voucherId = "";
  const useCard = CC_STORE_PAY.useCard;
  const avail = cardAvailable(me.creditCard, plan);
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="cc-pb-title">${icon("cards", 16)}<strong>Pay with</strong></div>
    <div class="cc-pb-seg" role="group" aria-label="Payment method">
      <button type="button" class="${useCard ? "" : "on"}" onclick="ccStoreSetPay(false)">Cash<small>${fmtMoney(me.balance)}</small></button>
      <button type="button" class="${useCard ? "on" : ""}" onclick="ccStoreSetPay(true)">Credit card<small>${fmtMoney(avail)} available</small></button>
    </div>
    <div class="cc-pb-perks">${useCard
      ? (plan.storeDiscountPct > 0 ? `<span class="cc-chip gold">${plan.storeDiscountPct}% card discount applied</span>` : "")
        + (plan.cashbackPct > 0 ? `<span class="cc-chip mint">${plan.cashbackPct}% cashback</span>` : "")
        + `<span class="cc-chip plain">Billed on your next statement</span>`
      : `<span class="cc-chip plain">Switch to card for discount &amp; cashback</span>`}</div>
    ${useCard ? `<div class="cc-pb-split">
      <label class="cc-check"><input type="checkbox" ${CC_STORE_PAY.split ? "checked" : ""} onchange="ccStoreSetSplit(this.checked)"> Part card, part cash</label>
      ${CC_STORE_PAY.split ? `<span>Card covers up to $<input id="ccStoreCardMax" type="number" min="0.01" step="0.01" style="width:90px" value="${ccEsc(CC_STORE_PAY.cardMax)}" placeholder="all it can" onchange="ccStoreSetCardMax(this.value)"></span>` : ""}
      <div class="muted-small">${CC_STORE_PAY.split ? "A split gets cashback on the card part but not the store discount. " : ""}Splitting works on purchases of ${fmtMoney(cardSettings(cls).splitMin)} or more, or whenever the card can't cover it all.</div></div>` : ""}
    ${vs.length ? `<div class="cc-pb-voucher"><label for="ccStoreVoucher">${icon("trophy", 14)} Voucher</label>
      <select id="ccStoreVoucher" onchange="ccStoreSetVoucher(this.value)"><option value="">None</option>${vs.map(v => `<option value="${ccEsc(v.id)}" ${CC_STORE_PAY.voucherId === v.id ? "selected" : ""}>${ccEsc(cardVoucherLabel(v))} · by ${ccEsc(cardDateLabel(v.expiryKey))}</option>`).join("")}</select></div>` : ""}`;
}
function ccStoreSetPay(useCard) { CC_STORE_PAY.useCard = !!useCard; ccStoreRefresh(); }
function ccStoreSetSplit(on) { CC_STORE_PAY.split = !!on; ccStoreRefresh(); }
function ccStoreSetCardMax(v) { CC_STORE_PAY.cardMax = v === "" ? "" : String(Math.max(0, Number(v) || 0)); ccStoreRefresh(); }
function ccStoreSetVoucher(id) { CC_STORE_PAY.voucherId = id || ""; ccStoreRefresh(); }
function ccStoreRefresh() {
  if (typeof ME_CACHE !== "undefined" && ME_CACHE && typeof CLS_CACHE !== "undefined" && CLS_CACHE) ccStoreBarRender(ME_CACHE, CLS_CACHE);
  if (typeof updateAllBuyLabels === "function") updateAllBuyLabels();
}
