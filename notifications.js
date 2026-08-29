/* ===================== The 29 World — To-do feed (bell icon) =====================
   A single place a student can see everything that needs them to DO
   something — a loan due, a mortgage payment, a decision waiting, a quiz
   standing between them and a module, an offer on something they listed —
   plus how the shares they hold moved today.

   Deliberately NOT a record of what they've already done: pay day,
   interest, purchases and transfers all live in "My recent activity" on
   the dashboard and in the Bank's history. Repeating them here buried the
   handful of items that actually need attention, which is the whole point
   of the bell.

   The important design decision here is that this file adds NO new game
   state and writes NOTHING to Firestore. Every notification is derived,
   live, from data the rest of the app already generates — the class
   transaction log, the student's loans/term deposits, company price
   history, the event logs, listings and quiz results. Adding a new kind of
   notification means writing one more builder below that reads existing
   data; it never means another field to migrate or another write on a hot
   path.

   "Read" state is the one thing that has to be remembered, and it's
   deliberately kept in localStorage (one timestamp per username) rather
   than on the user doc: it's per-device, worthless to anyone else, and
   the alternative is a Firestore write every single time a student opens
   the panel.

   Loaded on every page (after data.js). It injects its own bell button
   into .topbar-actions, so pages don't need any markup for it — and it
   calls fitTopbar() straight after inserting, so the nav re-measures with
   the bell included and the top bar still fits on ONE line.
================================================================================ */

const NOTIF_MAX = 30;
const NOTIF_POLL_MS = 120000; // see the balance widget in data.js for why this is a plain interval

/* ---------------- Read-state (per device, per student) ---------------- */
function notifReadKey(username) { return "t29-notif-read-" + username; }

function notifGetLastRead(username) {
  try {
    const raw = localStorage.getItem(notifReadKey(username));
    return raw ? Number(raw) || 0 : 0;
  } catch (e) {
    return 0;
  }
}
function notifSetLastRead(username, ts) {
  try { localStorage.setItem(notifReadKey(username), String(ts)); } catch (e) { /* private mode — fine */ }
}

/* ---------------- Time helpers ----------------
   Reminder-style notifications ("loan due in 2 days") aren't events that
   happened at an instant — they're true for a whole day. Stamping them
   with the start of the current NZ day means each one counts as unread
   once per day and then goes quiet, instead of either nagging forever or
   never showing up at all. */
function notifTodayStartMs() {
  const { hour, minute } = nzHourMinute();
  const d = new Date();
  return d.getTime() - ((hour * 3600 + minute * 60 + d.getSeconds()) * 1000);
}

function notifRelativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + (mins === 1 ? " min ago" : " mins ago");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return days + " days ago";
}

/* ---------------- The builders ----------------
   Each one takes the already-loaded user + class and returns notifications.
   They're plain functions with no I/O so they're cheap to call and easy to
   reason about; buildNotifications() below just concatenates them. */

function notifLoanItems(me) {
  const today = nzDateKey();
  const dayStart = notifTodayStartMs();
  const out = [];
  (me.loans || []).filter(l => l.status === "active").forEach(l => {
    if (!l.dueDate) return;
    const days = daysBetweenKeys(today, l.dueDate);
    if (days > 3) return; // only start nagging inside the last few days
    let title, tone;
    if (days < 0) { tone = "coral"; title = `Loan overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`; }
    else if (days === 0) { tone = "coral"; title = "Loan due today"; }
    else { tone = "gold"; title = `Loan due in ${days} ${days === 1 ? "day" : "days"}`; }
    out.push({
      id: "loan-" + l.id + "-" + today, ts: dayStart, icon: "handshake", tone,
      title, body: `${fmtMoney(l.owed)} still owing. Interest keeps compounding every Monday until it's paid off.`,
      href: "loan.html", action: true
    });
  });
  return out;
}

function notifMortgageItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.properties || []).forEach(p => {
    if (p.owner !== me.username || !p.mortgage || p.mortgage.weeksLeft <= 0) return;
    if (!isMortgagePaymentOverdue(p, cls)) return;
    out.push({
      id: "mortgage-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "house", tone: "coral",
      title: "Mortgage payment due: " + p.name,
      body: `${fmtMoney(p.mortgage.weeklyPayment || 0)} this week, ${p.mortgage.weeksLeft} ${p.mortgage.weeksLeft === 1 ? "week" : "weeks"} left to run.`,
      href: "property.html", action: true
    });
  });
  return out;
}

function notifTermDepositItems(me) {
  const today = nzDateKey();
  const dayStart = notifTodayStartMs();
  return (me.termDeposits || []).map(d => {
    const days = daysBetweenKeys(today, d.matureDate);
    if (days < 0 || days > 2) return null;
    return {
      id: "td-" + d.id + "-" + today, ts: dayStart, icon: "vault", tone: "lilac",
      title: days === 0 ? "Term deposit matures today" : `Term deposit matures in ${days} ${days === 1 ? "day" : "days"}`,
      body: `${d.plan.name} — ${fmtMoney(d.amount)} locked in at ${d.plan.rate}%.`,
      href: "termdeposit.html"
    };
  }).filter(Boolean);
}

function notifMarketItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  const moves = (cls.companies || []).map(co => {
    const h = co.history || [];
    if (h.length < 2) return null;
    const prev = h[h.length - 2], now = h[h.length - 1];
    if (!prev) return null;
    const pct = ((now - prev) / prev) * 100;
    return { co, pct, shares: (co.holders || {})[me.username] || 0 };
  }).filter(Boolean);

  const mine = moves.filter(m => m.shares > 0 && Math.abs(m.pct) >= 1);
  mine.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  mine.slice(0, 4).forEach(m => {
    const up = m.pct > 0;
    out.push({
      id: "mkt-" + m.co.id + "-" + nzDateKey(), ts: dayStart, icon: "chart", tone: up ? "mint" : "coral",
      title: `${m.co.name} share price ${up ? "rose" : "fell"} ${Math.abs(m.pct).toFixed(1)}%`,
      body: `Now ${fmtMoney(m.co.price)} a share. You hold ${m.shares} ${m.shares === 1 ? "share" : "shares"} — ${fmtMoney(m.shares * m.co.price)}.`,
      href: "market.html"
    });
  });

  // Hold nothing? Still worth knowing what the market did today — that's
  // often exactly the nudge that gets a student to look at it.
  if (mine.length === 0 && moves.length) {
    const top = moves.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
    if (Math.abs(top.pct) >= 2) {
      const up = top.pct > 0;
      out.push({
        id: "mkt-top-" + top.co.id + "-" + nzDateKey(), ts: dayStart, icon: "chart", tone: up ? "mint" : "coral",
        title: `${top.co.name} ${up ? "rose" : "fell"} ${Math.abs(top.pct).toFixed(1)}% today`,
        body: `Today's biggest mover on the class market. Now ${fmtMoney(top.co.price)} a share.`,
        href: "market.html"
      });
    }
  }
  return out;
}

function notifEventItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.eventLog || []).forEach(e => {
    if (e.studentUser !== me.username) return;
    if (e.type === "choice" && e.status === "pending") {
      out.push({
        id: "ev-" + e.id, ts: dayStart, icon: "dice", tone: "lilac",
        title: "A decision is waiting for you",
        body: `${e.name} — open your account page to choose what you do.`,
        href: "student.html", action: true
      });
    } else if (e.severity === "bad" && e.status === "resolved" && !e.claimed) {
      out.push({
        id: "evclaim-" + e.id, ts: dayStart, icon: "shield", tone: "gold",
        title: "You might be able to claim insurance",
        body: `${e.name} cost you ${fmtMoney(Math.abs(e.amount || 0))}. General cover could pay some of that back.`,
        href: "insurance.html", action: true
      });
    }
  });
  (cls.bigEventLog || []).forEach(e => {
    if (e.studentUser !== me.username || e.status !== "pending") return;
    out.push({
      id: "bigev-" + e.id, ts: dayStart, icon: "star", tone: "coral",
      title: "Big event needs a decision",
      body: `${e.name} — ${fmtMoney(e.cost)}. Pay it, claim on insurance, or lose the asset.`,
      href: "bigevents.html", action: true
    });
  });
  return out;
}

function notifSideHustleItems(me, cls) {
  const sh = me.sideHustle;
  if (!sh || !sh.hustleId) return [];
  const hustle = (cls.sideHustles || []).find(h => h.id === sh.hustleId);
  if (!hustle) return [];
  const today = nzDateKey();
  if (sh.lastCheckin === today) return [];
  const { hour, minute } = nzHourMinute();
  if (hour !== sh.checkinHour || minute > 15) return [];
  return [{
    id: "sh-" + today, ts: notifTodayStartMs(), icon: "briefcase", tone: "mint",
    title: "Side hustle check-in is open right now",
    body: `${hustle.name} — you have until ${hourLabel(sh.checkinHour)}:15 to check in and get paid ${fmtMoney(Number(hustle.payouts[sh.checkinHour]) || 0)}.`,
    href: "student.html", action: true
  }];
}

function notifQuizItems(me, cls) {
  if (!cls.quizGate || !cls.quizGate.enabled) return [];
  const dayStart = notifTodayStartMs();
  const labelOf = key => (LIFESTYLE_LOCKABLE_MODULES.find(m => m.key === key) || {}).label || key;
  return (cls.quizzes || []).filter(q => {
    if (!q.active || !q.moduleKey) return false;
    const r = quizResultFor(me, q.id);
    return !r || !r.passed;
  }).slice(0, 5).map(q => ({
    id: "quiz-" + q.id + "-" + nzDateKey(), ts: dayStart, icon: "idcard", tone: "gold",
    title: `Quiz to pass: ${q.title}`,
    body: `Passing this unlocks ${labelOf(q.moduleKey)}. You need ${q.passMark}% or better.`,
    href: "quizzes.html", action: true
  }));
}

function notifMarketplaceItems(me, cls) {
  if (!cls.marketplace || !cls.marketplace.enabled) return [];
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.listings || []).forEach(l => {
    if (l.seller === me.username && l.status === "active") {
      const open = (l.offers || []).filter(o => o.status === "open");
      if (open.length) {
        const best = open.reduce((a, b) => (b.amount > a.amount ? b : a));
        out.push({
          id: "offers-" + l.id + "-" + open.length + "-" + Math.round(best.amount * 100),
          ts: Math.max(dayStart, best.ts || 0), icon: "handshake", tone: "gold",
          title: `${open.length} ${open.length === 1 ? "offer" : "offers"} on ${l.name}`,
          body: `Best offer so far is ${fmtMoney(best.amount)} against your ${fmtMoney(l.price)} asking price.`,
          href: "marketplace.html", action: true
        });
      }
    }
    if (l.seller === me.username && l.status === "pending") {
      out.push({
        id: "pending-" + l.id, ts: l.ts || dayStart, icon: "cart", tone: "navy",
        title: `${l.name} is waiting for teacher approval`,
        body: `Listed at ${fmtMoney(l.price)}. It goes live once your teacher approves it.`,
        href: "marketplace.html"
      });
    }
    if (l.seller === me.username && l.status === "rejected" && Date.now() - (l.ts || 0) < 3 * 86400000) {
      out.push({
        id: "rejected-" + l.id, ts: l.ts || dayStart, icon: "cart", tone: "coral",
        title: `Your listing for ${l.name} was taken down`,
        body: l.rejectReason || "Your teacher removed this listing.",
        href: "marketplace.html"
      });
    }
  });
  return out;
}

/* Builds the whole feed. `action: true` items — the things that actually
   need the student to do something — always sort above the informational
   market moves, and within each group it's newest first. */
function buildNotifications(me, cls) {
  const items = [].concat(
    notifLoanItems(me),
    notifMortgageItems(me, cls),
    notifTermDepositItems(me),
    notifMarketItems(me, cls),
    notifEventItems(me, cls),
    notifSideHustleItems(me, cls),
    notifQuizItems(me, cls),
    notifMarketplaceItems(me, cls)
  );
  items.sort((a, b) => {
    if (!!b.action !== !!a.action) return a.action ? -1 : 1;
    return (b.ts || 0) - (a.ts || 0);
  });
  return items.slice(0, NOTIF_MAX);
}

/* ================= UI ================= */
let NOTIF_USER = null;
let NOTIF_ITEMS = [];
let NOTIF_POLL_TIMER = null;

function notifIconFor(name, size) {
  return typeof icon === "function" ? icon(name, size || 16) : "";
}

// The bell lives inside .topbar-actions (next to Settings and Log out) so
// fitTopbar() measures it as part of the trailing block and shrinks the
// nav to match — that's what keeps the top bar on a single line.
function notifBuildBell() {
  if (document.getElementById("notifBell")) return document.getElementById("notifBell");
  const actions = document.querySelector(".topbar-actions");
  if (!actions) return null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "notifBell";
  btn.className = "btn-icon-topbar notif-bell";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", "Notifications");
  btn.title = "Notifications";
  btn.innerHTML = `<span class="icon-slot">${notifIconFor("bell", 18)}</span><span class="notif-dot hidden" id="notifDot">0</span>`;
  actions.insertBefore(btn, actions.firstChild);

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const panel = document.getElementById("notifPanel");
    if (panel && !panel.classList.contains("hidden")) notifClose();
    else notifOpen();
  });

  // The nav was measured before the bell existed — re-run the fit so the
  // row still comes out to exactly one line with it included.
  if (typeof fitTopbar === "function") fitTopbar();
  return btn;
}

function notifBuildPanel() {
  let panel = document.getElementById("notifPanel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "notifPanel";
  panel.className = "notif-panel hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notifications");
  panel.innerHTML = `
    <div class="notif-head">
      <div class="notif-head-title">${notifIconFor("bell", 15)}<span>Notifications</span></div>
      <button type="button" class="notif-markread" id="notifMarkRead">Mark all read</button>
    </div>
    <div class="notif-list" id="notifList"></div>
    <div class="notif-foot"><a href="student.html">See my full account history ›</a></div>
  `;
  document.body.appendChild(panel);
  panel.addEventListener("click", e => e.stopPropagation());
  panel.querySelector("#notifMarkRead").addEventListener("click", () => {
    notifSetLastRead(NOTIF_USER, Date.now());
    notifPaint();
  });
  return panel;
}

/* Places the panel relative to the bell, which lives in .topbar-actions —
   and .topbar-actions is in a very different place depending on the
   layout the student has chosen:
     - normal top bar : actions sit top-right, so drop the panel below and
                        right-align it to the button (the default)
     - sidebar, wide   : actions sit at the BOTTOM of a fixed left rail, so
                        "below and to the left" would put the panel
                        half-off-screen and underneath the rail itself.
                        Open to the RIGHT of the rail instead.
     - sidebar, phone  : actions are pinned to the bottom of the slide-in
                         drawer, so stack the panel directly above them.
   Everything is clamped into the viewport at the end regardless, so no
   route through this can leave the panel hanging off an edge. */
function notifPositionPanel(panel, btn) {
  const rect = btn.getBoundingClientRect();
  const margin = 10;
  panel.style.visibility = "hidden";
  panel.classList.remove("hidden");
  const pr = panel.getBoundingClientRect();

  const sidebar = document.documentElement.classList.contains("sidebar-nav");
  const wideRail = sidebar && window.matchMedia("(min-width: 901px)").matches;
  panel.style.maxHeight = ""; // cleared so a resize out of drawer mode isn't stuck with its cap

  let left, top;
  if (wideRail) {
    const rail = document.querySelector(".topbar");
    const railRight = rail ? rail.getBoundingClientRect().right : rect.right;
    left = railRight + 8;
    top = rect.top; // line the panel up with the bell rather than under it
  } else if (sidebar) {
    // Phone drawer: the actions bar is pinned to the bottom of the drawer,
    // so the panel gets the space above it — and is capped to that space
    // so a long list scrolls internally instead of growing back down over
    // the very buttons it is supposed to sit on top of.
    const actions = document.querySelector(".topbar-actions");
    const actionsTop = actions ? actions.getBoundingClientRect().top : window.innerHeight;
    panel.style.maxHeight = Math.max(160, actionsTop - (margin * 2) - 8) + "px";
    left = margin;
    top = actionsTop - panel.getBoundingClientRect().height - 8;
  } else {
    left = rect.right - pr.width;
    top = rect.bottom + 8;
  }

  left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - pr.height - margin));
  panel.style.left = left + "px";
  panel.style.top = top + "px";
  panel.style.visibility = "";
}

function notifOpen() {
  const btn = document.getElementById("notifBell");
  if (!btn) return;
  const panel = notifBuildPanel();
  notifRenderList();
  notifPositionPanel(panel, btn);
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("active");
  // Opening the panel is what marks things read — but the badge only
  // clears once the list has actually been rendered, so nothing can be
  // marked read without having been shown.
  notifSetLastRead(NOTIF_USER, Date.now());
  notifUpdateBadge();
}

function notifClose() {
  const panel = document.getElementById("notifPanel");
  const btn = document.getElementById("notifBell");
  if (panel) panel.classList.add("hidden");
  if (btn) { btn.setAttribute("aria-expanded", "false"); btn.classList.remove("active"); }
}

function notifUnreadCount() {
  const lastRead = notifGetLastRead(NOTIF_USER);
  return NOTIF_ITEMS.filter(n => (n.ts || 0) > lastRead).length;
}

function notifUpdateBadge() {
  const dot = document.getElementById("notifDot");
  if (!dot) return;
  const n = notifUnreadCount();
  dot.textContent = n > 9 ? "9+" : String(n);
  dot.classList.toggle("hidden", n === 0);
  const bell = document.getElementById("notifBell");
  if (bell) bell.setAttribute("aria-label", n ? `Notifications (${n} new)` : "Notifications");
}

function notifRenderList() {
  const list = document.getElementById("notifList");
  if (!list) return;
  const lastRead = notifGetLastRead(NOTIF_USER);
  if (!NOTIF_ITEMS.length) {
    list.innerHTML = `<div class="notif-empty">${notifIconFor("bell", 26)}<p>You're all caught up.</p><p class="muted-small">Anything due, any decision waiting on you, and how your shares moved will show up here.</p></div>`;
    return;
  }
  list.innerHTML = NOTIF_ITEMS.map(n => {
    const unread = (n.ts || 0) > lastRead;
    // A row is a link when it goes somewhere, and a button when it opens
    // something in place (a quiz popup) — never a dead <div> that looks
    // tappable but isn't.
    const clickable = !!(n.href || n.onClick);
    const tag = clickable ? "a" : "div";
    const href = n.href ? ` href="${n.href}"` : (n.onClick ? ` href="#" onclick="notifClose();${n.onClick};return false;"` : "");
    return `<${tag}${href} class="notif-row${unread ? " unread" : ""}${n.action ? " action" : ""}">
      <span class="notif-ic ${n.tone}">${notifIconFor(n.icon, 15)}</span>
      <span class="notif-body">
        <span class="notif-title">${n.title}</span>
        ${n.body ? `<span class="notif-sub">${n.body}</span>` : ""}
        <span class="notif-time">${n.action ? "Needs your attention · " : ""}${notifRelativeTime(n.ts)}</span>
      </span>
    </${tag}>`;
  }).join("");
}

function notifPaint() {
  notifUpdateBadge();
  const panel = document.getElementById("notifPanel");
  if (panel && !panel.classList.contains("hidden")) notifRenderList();
}

async function notifRefresh(username, classCode) {
  const [me, cls] = await Promise.all([getUserCached(username), getClassCached(classCode)]);
  if (!me || !cls) return;
  withNewModuleDefaults(cls);
  NOTIF_ITEMS = buildNotifications(Object.assign({ username }, me), cls);
  notifPaint();

  // Every page now gets the module locks applied to its nav, not just the
  // three that happened to call this themselves — this file is the only
  // thing loaded absolutely everywhere that already has `cls` and `me`.
  if (me.role === "student" && typeof applyNavModuleLocks === "function") {
    applyNavModuleLocks(getModuleLockReasonsFromData(cls, Object.assign({ username }, me), username));
  }
}

function notifStartPoll(username, classCode) {
  if (NOTIF_POLL_TIMER) return;
  NOTIF_POLL_TIMER = setInterval(() => {
    notifRefresh(username, classCode).catch(() => {});
  }, NOTIF_POLL_MS);
}
function notifStopPoll() {
  if (!NOTIF_POLL_TIMER) return;
  clearInterval(NOTIF_POLL_TIMER);
  NOTIF_POLL_TIMER = null;
}

async function notifInit() {
  let u = null;
  try { u = await getSessionUser(); } catch (e) { return; }
  // Teachers get their own dashboards for all of this; the feed is a
  // student-facing "what happened to ME" view.
  if (!u || u.role !== "student" || !u.classCode) return;
  NOTIF_USER = u.username;

  if (!notifBuildBell()) return;

  document.addEventListener("click", () => notifClose());
  document.addEventListener("keydown", e => { if (e.key === "Escape") notifClose(); });
  window.addEventListener("resize", () => {
    const panel = document.getElementById("notifPanel");
    const btn = document.getElementById("notifBell");
    if (panel && btn && !panel.classList.contains("hidden")) notifPositionPanel(panel, btn);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) notifStopPoll();
    else { notifRefresh(u.username, u.classCode).catch(() => {}); notifStartPoll(u.username, u.classCode); }
  });

  await notifRefresh(u.username, u.classCode).catch(() => {});
  if (!document.hidden) notifStartPoll(u.username, u.classCode);
}

// The bell is never why someone opened the page, so let the page's own
// first render have the main thread and the connection to itself, then
// build the feed in the first idle moment after. requestIdleCallback
// isn't on every mobile browser, hence the timeout fallback.
function notifBoot() {
  const start = () => notifInit().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 400);
}
document.addEventListener("DOMContentLoaded", notifBoot);
