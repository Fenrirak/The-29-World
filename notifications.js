/* ===================== The 29 World — To-do feed (bell icon) =====================
   A single place a student can see everything that needs them to DO
   something — a loan due, a mortgage payment, a decision waiting (a big
   event, a job promotion offer), a quiz standing between them and a
   module, an offer on something they listed, a side hustle change stuck
   waiting on the teacher (or denied) — plus how the shares they hold
   moved today.

   Deliberately NOT a record of what they've already done: pay day,
   interest, purchases and transfers all live in "My recent activity" on
   the dashboard and in the Bank's history. Repeating them here buried the
   handful of items that actually need attention, which is the whole point
   of the bell.

   The important design decision here is that this file adds NO new game
   state and writes NOTHING to Firestore (the one exception, below, is read
   here but written by the teacher's pages). Every notification is derived,
   live, from data the rest of the app already generates — the class
   transaction log, the student's loans/term deposits, company price
   history, the event logs, listings and quiz results. Adding a new kind of
   notification means writing one more builder below that reads existing
   data; it never means another field to migrate or another write on a hot
   path.

   "Read" state is the one thing that has to be remembered. It is a single
   watermark timestamp per student, stored in TWO places: localStorage (so
   this device/tab responds instantly and works offline) and
   users/{username}.notifLastRead (so every other device/tab sees it too
   and can't show the same notifications as unread again). The effective
   watermark is always the LARGER of the two, so it can only move forward.
   The Firestore write is skipped when nothing was actually unread, so
   re-opening the panel doesn't cost a write.

   DEVICE ALERTS (opt-in, per device): a student can switch on alerts for
   the device/browser they're using (bell panel, and the settings menu via
   notifDeviceControl()). That choice lives ONLY in localStorage, never on
   the account, so a phone can be on while the school laptop is off. While
   on, new unread items raise an OS notification even if the tab is in the
   background. It needs the site open in a tab or installed app: there is no
   server to push to a closed browser (see the notes by notifDeviceAlertNew).

   Loaded on every page (after the data-*.js files). It injects its own bell button
   into .topbar-actions, so pages don't need any markup for it — and it
   calls fitTopbar() straight after inserting, so the nav re-measures with
   the bell included and the top bar still fits on ONE line.
================================================================================ */

const NOTIF_MAX = 60;
const NOTIF_POLL_MS = 120000; // see the balance widget in the data-*.js files for why this is a plain interval

/* ---------------- Read-state (per device, per student) ---------------- */
function notifReadKey(username) { return "t29-notif-read-" + username; }

// Latest watermark known to be on the user doc (users/{username}.notifLastRead).
let NOTIF_REMOTE_READ = 0;
let NOTIF_REMOTE_WRITE_OK = true; // flips off after a refused/failed write so we don't retry every poll

function notifGetLocalRead(username) {
  try {
    const raw = localStorage.getItem(notifReadKey(username));
    return raw ? Number(raw) || 0 : 0;
  } catch (e) {
    return 0;
  }
}
// Effective watermark = newest of this device's copy and the shared one.
function notifGetLastRead(username) {
  return Math.max(notifGetLocalRead(username), NOTIF_REMOTE_READ);
}
function notifPushRemoteRead(username, ts) {
  if (!NOTIF_REMOTE_WRITE_OK || typeof usersCol !== "function" || ts <= NOTIF_REMOTE_READ) return;
  NOTIF_REMOTE_READ = ts;
  Promise.resolve()
    .then(() => usersCol().doc(username).update({ notifLastRead: ts }))
    .catch(() => { NOTIF_REMOTE_WRITE_OK = false; }); // local copy still holds; best-effort
}
function notifSetLastRead(username, ts) {
  const prev = notifGetLastRead(username);
  if (ts <= prev) return; // watermark only ever moves forward
  try { localStorage.setItem(notifReadKey(username), String(ts)); } catch (e) { /* private mode — fine */ }
  // Only touch Firestore if something was genuinely unread.
  if (NOTIF_ITEMS.some(n => (n.ts || 0) > prev)) notifPushRemoteRead(username, ts);
}

/* ---------------- Time helpers ----------------
   Reminder-style notifications ("loan due in 2 days") aren't events that
   happened at an instant — they're true for a whole day. Stamping them
   with the start of the current NZ day means each one counts as unread
   once per day and then goes quiet, instead of either nagging forever or
   never showing up at all. */
function notifTodayStartMs() {
  // BUGFIX: this used to read hour/minute from the trusted, server-
  // corrected clock (nzHourMinute() defaults to trustedNow()) but then
  // anchor the actual subtraction to a fresh, UNCORRECTED `new Date()` —
  // so on exactly the drifting-device-clock case the data layer's own
  // trustedNow() exists to fix (see the BUGFIX comment above it), this
  // silently produced a "day start" as wrong as that device's clock was,
  // which then fed into every notification's timestamp. Deriving
  // hour/minute/seconds from the SAME trusted instant fixes that.
  const now = trustedNow();
  const { hour, minute } = nzHourMinute(now);
  return now.getTime() - ((hour * 3600 + minute * 60 + now.getSeconds()) * 1000);
}

function notifRelativeTime(ts) {
  if (!ts) return "";
  const diff = trustedNow().getTime() - ts;
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

// The credit card statement: from the day it closes until it's paid in full.
// `action: true` puts it above the informational stock moves.
function notifCardItems(me, cls) {
  if (!cardIsActive(me) || !me.creditCard.stmt) return [];
  const s = me.creditCard.stmt, owe = cardStmtRemaining(me.creditCard);
  if (owe <= 0) return [];
  const today = nzDateKey();
  const days = daysBetweenKeys(today, s.dueKey);
  const pen = cls && cls.lifestyleConfig && cls.lifestyleConfig.creditCard;
  const penNote = pen && pen.enabled && pen.perAmount > 0 && pen.points > 0 ? " Until it's paid it costs you lifestyle points." : "";
  let title, tone, body, id, ts;
  if (days < 0) {
    tone = "coral"; id = `card-stmt-${s.closeKey}-late`; ts = notifTodayStartMs();
    title = `Credit card overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;
    body = `${fmtMoney(owe)} is still unpaid, so interest will be added at your next statement.${penNote}`;
  } else {
    tone = days <= 2 ? "coral" : "gold"; id = `card-stmt-${s.closeKey}`; ts = s.closeTs || notifTodayStartMs();
    title = days === 0 ? "Credit card payment due today" : `Credit card statement closed: ${fmtMoney(s.amount)}`;
    body = `Pay ${fmtMoney(owe)} by ${cardDateLabel(s.dueKey)} (${days} ${days === 1 ? "day" : "days"} left) to avoid interest.${penNote}`;
  }
  return [{ id, ts, icon: "cards", tone, title, body, href: "bank.html#cardCard", action: true }];
}

function notifMortgageItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.properties || []).forEach(p => {
    if (p.owner !== me.username || !p.mortgage || p.mortgage.weeksLeft <= 0) return;
    if (!isMortgagePaymentOverdue(p, cls)) return;
    // It can only be paid on the mortgage day (or a week the teacher made
    // it due) — after that it's a missed payment to know about, not
    // something they can still do.
    const payable = (cls.mortgageDay || "Fri") === nzDayName() || cls.mortgageForceDueWeek === isoWeekKey();
    out.push(payable ? {
      id: "mortgage-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "house", tone: "coral",
      title: "Mortgage payment due today: " + p.name,
      body: `${fmtMoney(mortgageWeekAmount(p.mortgage).total)} this week, ${p.mortgage.weeksLeft} ${p.mortgage.weeksLeft === 1 ? "week" : "weeks"} left to run.`,
      href: "property.html", action: true
    } : {
      id: "mortgage-missed-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "house", tone: "coral",
      title: "Missed mortgage payment: " + p.name,
      body: `It could only be paid on ${DAY_FULL[cls.mortgageDay || "Fri"]}. Your teacher can see it was missed.`,
      href: "property.html"
    });
  });
  return out;
}

// Covers both sides of a classmate rental: a tenant with rent due/overdue,
// and an owner whose listing is pending approval or was just declined —
// same idea (and same three states) as notifMarketplaceItems below, just
// for a lease instead of a one-off sale.
function notifPropertyRentalItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.properties || []).forEach(p => {
    if (p.sublet && p.sublet.tenant === me.username) {
      if (isSubletRentOverdue(p, cls)) {
        // Rent can only be paid on its day (see payTenantRent).
        const payable = (p.rentDay || "Fri") === nzDayName();
        out.push(payable ? {
          id: "rent-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "house", tone: "coral",
          title: "Rent due today: " + p.name,
          body: `${fmtMoney(p.sublet.price)} this week, renting from a classmate.`,
          href: "property.html", action: true
        } : {
          id: "rent-missed-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "house", tone: "coral",
          title: "Missed rent: " + p.name,
          body: `It could only be paid on ${DAY_FULL[p.rentDay || "Fri"]}.`,
          href: "property.html"
        });
      }
    }
    if (p.sublet && p.owner === me.username) {
      if (p.sublet.status === "pending") {
        out.push({
          id: "sublet-pending-" + p.id, ts: p.sublet.createdTs || dayStart, quiet: true, icon: "house", tone: "navy",
          title: `${p.name} is waiting for teacher approval`,
          body: `Listed at ${fmtMoney(p.sublet.price)}/week. It's visible to classmates once your teacher approves it.`,
          href: "property.html"
        });
      }
      if (p.sublet.status === "rejected" && trustedNow().getTime() - (p.sublet.createdTs || 0) < 3 * 86400000) {
        out.push({
          id: "sublet-rejected-" + p.id, ts: p.sublet.createdTs || dayStart, icon: "house", tone: "coral",
          title: `Your rental listing for ${p.name} was declined`,
          body: p.sublet.rejectReason || "Your teacher didn't approve this listing.",
          href: "property.html"
        });
      }
    }
  });
  return out;
}

// A student renting a teacher-listed (NPC) property with this week's rent
// due/overdue — same trigger (isNpcRentOverdue fires from the due day
// onward, until paid) and same "button where the rented house is" pattern
// as notifPropertyRentalItems above, just for a school rental instead of a
// classmate's. There's no pending/rejected state to cover here, since a
// teacher's own listing needs no approval from anyone.
function notifNpcRentalItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.npcProperties || []).forEach(p => {
    if (p.tenant !== me.username) return;
    if (!isNpcRentOverdue(p)) return;
    // Rent can only be paid on its day (see payNpcRent).
    const payable = (p.rentDay || "Fri") === nzDayName();
    out.push(payable ? {
      id: "npc-rent-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "building", tone: "coral",
      title: "Rent due today: " + p.name,
      body: `${fmtMoney(p.rentPerWeek)} this week, renting from the school.`,
      href: "property.html", action: true
    } : {
      id: "npc-rent-missed-" + p.id + "-" + nzDateKey(), ts: dayStart, icon: "building", tone: "coral",
      title: "Missed rent: " + p.name,
      body: `It could only be paid on ${DAY_FULL[p.rentDay || "Fri"]}.`,
      href: "property.html"
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
  // Every company they hold that moved gets its own row — not just the
  // biggest few. Sorted by size of move so the ones most worth a look
  // still land first if the "Show more" cutoff or the panel scroll splits
  // them across a click.
  mine.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  mine.forEach(m => {
    const up = m.pct > 0;
    out.push({
      id: "mkt-" + m.co.id + "-" + nzDateKey(), ts: dayStart, quiet: true, icon: "chart", tone: up ? "mint" : "coral",
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
        id: "mkt-top-" + top.co.id + "-" + nzDateKey(), ts: dayStart, quiet: true, icon: "chart", tone: up ? "mint" : "coral",
        title: `${top.co.name} ${up ? "rose" : "fell"} ${Math.abs(top.pct).toFixed(1)}% today`,
        body: `Today's biggest mover on the class market. Now ${fmtMoney(top.co.price)} a share.`,
        href: "market.html"
      });
    }
  }
  return out;
}

// This week's transport expenses can only be paid on the class's transport
// day (see payTransportExpenses), so on that day, until it's paid, it's a
// job for today.
function notifTransportItems(me, cls) {
  if ((cls.transportDay || "Fri") !== nzDayName()) return [];
  if ((me.transportLastWeekPaid || null) === isoWeekKey()) return [];
  const amount = transportWeeklyAmount(cls, me).total;
  if (!(amount > 0)) return [];
  return [{
    id: "transport-" + nzDateKey(), ts: notifTodayStartMs(), icon: "car", tone: "coral",
    title: "Transport payment due today",
    body: `${fmtMoney(amount)} for this week. It can only be paid today.`,
    href: "transport.html", action: true
  }];
}

// Only surfaces the (separate, rarer) big-events feature — notifications
// for the regular weekly random events (decision pending / insurance
// claim available) have been removed intentionally.
function notifEventItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  (cls.bigEventLog || []).forEach(e => {
    if (e.studentUser !== me.username || e.status !== "pending") return;
    out.push({
      id: "bigev-" + e.id, ts: dayStart, icon: "star", tone: "coral",
      title: "Big event needs a decision",
      body: `${e.name} — ${fmtMoney(e.cost)}. ${e.takesAsset === false ? "Pay it or claim on insurance." : "Pay it, claim on insurance, or lose the asset."}`,
      href: "bigevents.html", action: true
    });
  });
  return out;
}

// A job promotion (auto-triggered after enough weeks in a tier, or
// offered manually by the teacher) sits on the user doc as an unresolved
// offer until the student explicitly accepts or declines it — see
// respondToPromotion in data-life.js. That's exactly a "decision waiting on
// you", the same category as a big event, but it had no builder here at
// all: the only place it previously surfaced was a one-off popup on page
// load (checkPromotionNotification), which is easy to miss or click past
// without noticing, and never comes back once dismissed.
function notifPromotionItems(me) {
  const promo = me.pendingPromotion;
  if (!promo) return [];
  return [{
    id: "promo-" + promo.jobId + "-" + promo.tierId, ts: notifTodayStartMs(), icon: "briefcase", tone: "gold",
    title: `Promotion offer: ${promo.tierName}`,
    body: `${promo.jobTitle} — accept to move up to ${fmtMoney(promo.wage)} a week.`,
    href: "student.html", action: true
  }];
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
    // e.g. "until 4:15pm" (hourLabel gives "4pm", so the minutes go in the middle)
    body: `${hustle.name} — you have until ${(sh.checkinHour % 12) || 12}:15${sh.checkinHour < 12 ? "am" : "pm"} to check in and get paid ${fmtMoney(Number(hustle.payouts[sh.checkinHour]) || 0)}.`,
    href: "student.html", action: true
  }];
}

// A student who already has a side hustle running needs the teacher's
// sign-off to switch to a different one or a different check-in hour
// (requestSideHustleChange in data-life.js) — the exact same "pending, then
// approved or denied" shape as a marketplace listing or a classmate
// sublet above, just for the hustle itself. Denial carries a note
// (sideHustleDenialNote) that otherwise just sits on the user doc with
// nothing pointing the student at it.
function notifSideHustleRequestItems(me, cls) {
  const dayStart = notifTodayStartMs();
  const out = [];
  const req = me.sideHustleRequest;
  if (req && req.status === "pending") {
    const hustle = (cls.sideHustles || []).find(h => h.id === req.hustleId);
    out.push({
      id: "sh-request-" + req.hustleId + "-" + req.checkinHour, ts: dayStart, quiet: true, icon: "briefcase", tone: "navy",
      title: "Side hustle change waiting for approval",
      body: `Switching to ${hustle ? hustle.name : "a new hustle"}, checking in at ${hourLabel(req.checkinHour)}. It applies once your teacher approves it.`,
      href: "student.html"
    });
  }
  // No timestamp is stored on the denial itself (the data-*.js files only clear it
  // when the student submits a fresh request), so — like the loan/mortgage
  // reminders above — this is stamped with today's start and keeps showing
  // once per day for as long as it sits unaddressed, rather than vanishing
  // after a fixed window the way a resolved listing rejection does.
  if (me.sideHustleDenialNote) {
    out.push({
      id: "sh-denied-" + nzDateKey(), ts: dayStart, icon: "briefcase", tone: "coral",
      title: "Your side hustle change was denied",
      body: me.sideHustleDenialNote,
      href: "student.html"
    });
  }
  return out;
}

function notifQuizItems(me, cls) {
  if (!cls.quizGate || !cls.quizGate.enabled) return [];
  const dayStart = notifTodayStartMs();
  const labelOf = key => (LIFESTYLE_LOCKABLE_MODULES.find(m => m.key === key) || {}).label || key;
  return (cls.quizzes || []).filter(q => {
    if (!q.active || !q.moduleKey) return false;
    if (!LIFESTYLE_LOCKABLE_MODULES.some(m => m.key === q.moduleKey)) return false;
    const r = quizResultFor(me, q.id);
    return !r || !r.passed;
  }).slice(0, 5).map(q => ({
    id: "quiz-" + q.id + "-" + nzDateKey(), ts: dayStart, icon: "idcard", tone: "gold",
    title: `Quiz to pass: ${q.title}`,
    body: `Passing this unlocks ${labelOf(q.moduleKey)}. You need ${q.passMark}% or better.`,
    // Students can't open the Quizzes page (it sends them home), so this
    // opens the quiz popup right here instead (see quiz-gate.js).
    onClick: `t29OpenQuizForModule('${q.moduleKey}')`, action: true
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
        id: "pending-" + l.id, ts: l.ts || dayStart, quiet: true, icon: "cart", tone: "navy",
        title: `${l.name}${listingQuantity(l) > 1 ? " ×" + listingQuantity(l) : ""} ${listingQuantity(l) > 1 ? "are" : "is"} waiting for teacher approval`,
        body: `Listed at ${fmtMoney(l.price)}. It goes live once your teacher approves it.`,
        href: "marketplace.html"
      });
    }
    if (l.seller === me.username && l.status === "rejected" && trustedNow().getTime() - (l.ts || 0) < 3 * 86400000) {
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
// Things the TEACHER changed that touch this student (a price they own, a
// card's rewards, a manual market run ...). Unlike every other builder these
// are read from class.teacherNotices, which the teacher's pages write via
// t29NotifyStudents() (data-core.js) — a teacher's edit leaves no other trace.
const NOTIF_TEACHER_TTL_MS = 7 * 24 * 3600 * 1000;
function notifTeacherChangeItems(me, cls) {
  const list = cls && Array.isArray(cls.teacherNotices) ? cls.teacherNotices : [];
  const cutoff = trustedNow().getTime() - NOTIF_TEACHER_TTL_MS;
  const out = [];
  list.forEach(n => {
    if (!n || !n.id || !n.title || (n.ts || 0) < cutoff) return;
    const mine = n.to === "all" || (Array.isArray(n.to) && n.to.indexOf(me.username) !== -1);
    if (!mine) return;
    out.push({
      id: "tch-" + n.id, ts: n.ts, icon: n.icon || "bell", tone: n.tone || "gold",
      title: n.title, body: n.body || "", href: n.href || ""
    });
  });
  return out;
}

function buildNotifications(me, cls) {
  const items = [].concat(
    notifLoanItems(me),
    notifCardItems(me, cls),
    notifMortgageItems(me, cls),
    notifPropertyRentalItems(me, cls),
    notifNpcRentalItems(me, cls),
    notifTransportItems(me, cls),
    notifTermDepositItems(me),
    notifMarketItems(me, cls),
    notifEventItems(me, cls),
    notifPromotionItems(me),
    notifSideHustleItems(me, cls),
    notifSideHustleRequestItems(me, cls),
    notifQuizItems(me, cls),
    notifMarketplaceItems(me, cls),
    notifTeacherChangeItems(me, cls)
  );
  // Order: needs-action first, then unread-over-read, then newest first.
  // The unread tiebreaker matters because several builders (term deposits,
  // marketplace listings) carry timestamps that don't reset day to day —
  // without this, an already-read informational item can keep outranking
  // something the student genuinely hasn't seen yet.
  const lastRead = notifGetLastRead(NOTIF_USER);
  items.sort((a, b) => {
    if (!!b.action !== !!a.action) return a.action ? -1 : 1;
    const aUnread = (a.ts || 0) > lastRead, bUnread = (b.ts || 0) > lastRead;
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    return (b.ts || 0) - (a.ts || 0);
  });
  return items.slice(0, NOTIF_MAX);
}

/* ===================== Urgent: wrong-password lockout notice =====================
   When someone enters the wrong password for this account 5 times, logging
   in is locked for 30 minutes (see "Login lockout" in data-core.js). The
   account's owner is told here, as an URGENT bell item (students) and a
   red banner at the top of the page (students and teachers), with a
   shortcut to change their password.

   Like everything else in this file, nothing is written for this: it's
   derived from /loginLocks/{email}.lastLockAt, which only the lock itself
   can set. "Dismissed" is remembered per device in localStorage (by the
   lock's timestamp) so a NEW lock always shows again. An active lock can't
   be dismissed out of the bell. */
const NOTIF_LOCK_SHOW_MS = 3 * 24 * 3600 * 1000;
let NOTIF_LOCK_CURRENT = null; // { username, ts }

function notifLockSeenKey(u) { return "t29-lock-seen-" + u; }
function notifLockIsSeen(u, ts) {
  try { return Number(localStorage.getItem(notifLockSeenKey(u)) || 0) >= ts; } catch (e) { return false; }
}
function notifLockMarkSeen(u, ts) {
  try { localStorage.setItem(notifLockSeenKey(u), String(ts)); } catch (e) { /* ignore */ }
}
async function notifLockNotice(username) {
  if (typeof t29LoginLockStatus !== "function") return null;
  const st = await t29LoginLockStatus(username);
  if (!st.lastLockAt) return null;
  const recent = Date.now() - st.lastLockAt < NOTIF_LOCK_SHOW_MS;
  if (!st.locked && (!recent || notifLockIsSeen(username, st.lastLockAt))) return null;
  return st;
}
function notifLockTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function notifLockText(st) {
  return st.locked
    ? `Someone entered the wrong password for your account 5 times, so logging in is locked until ${notifLockTime(st.lockedUntil)}. Please change your password now.`
    : `Someone entered the wrong password for your account 5 times (${notifRelativeTime(st.lastLockAt)}), so logging in was locked for 30 minutes. If that wasn't you, change your password.`;
}
function notifLockItem(username, st) {
  NOTIF_LOCK_CURRENT = { username, ts: st.lastLockAt };
  return {
    id: "lock-" + st.lastLockAt, ts: st.lastLockAt, icon: "lock", tone: "coral",
    title: "Urgent: password tried incorrectly 5 times", body: notifLockText(st),
    onClick: "notifLockChangePassword()", action: true, urgent: true
  };
}
function notifLockChangePassword() {
  if (NOTIF_LOCK_CURRENT) notifLockMarkSeen(NOTIF_LOCK_CURRENT.username, NOTIF_LOCK_CURRENT.ts);
  const b = document.getElementById("t29LockBanner");
  if (b) b.remove();
  if (typeof openPasswordModal === "function") openPasswordModal();
}
function notifLockDismissBanner() {
  if (NOTIF_LOCK_CURRENT) notifLockMarkSeen(NOTIF_LOCK_CURRENT.username, NOTIF_LOCK_CURRENT.ts);
  const b = document.getElementById("t29LockBanner");
  if (b) b.remove();
}
function notifInjectLockCss() {
  if (document.getElementById("t29LockCss")) return;
  const st = document.createElement("style");
  st.id = "t29LockCss";
  st.textContent = `
.t29-lock-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fdecea;border:2px solid #c0392b;color:#7a1f14;border-radius:14px;padding:12px 16px;margin:0 0 16px;font-weight:600;line-height:1.45;}
.t29-lock-banner .t29-lock-msg{flex:1 1 260px;min-width:0;}
.t29-lock-banner .t29-lock-actions{display:flex;gap:8px;flex-wrap:wrap;}
.notif-row.urgent{background:#fdecea;border-left:4px solid #c0392b;}
.notif-row.urgent .notif-title{color:#9b1c10;}
.notif-row.urgent .notif-time{color:#b8402c;font-weight:800;letter-spacing:.03em;}
html.dark-mode .t29-lock-banner{background:#3a1c19;border-color:#e0705f;color:#ffd9d3;}
html.dark-mode .notif-row.urgent{background:#3a1c19;border-left-color:#e0705f;}
html.dark-mode .notif-row.urgent .notif-title{color:#ffd9d3;}
html.dark-mode .notif-row.urgent .notif-time{color:#ff9d8e;}`;
  document.head.appendChild(st);
}
function notifShowLockBanner(username, st) {
  if (notifLockIsSeen(username, st.lastLockAt)) return;
  notifInjectLockCss();
  NOTIF_LOCK_CURRENT = { username, ts: st.lastLockAt };
  let b = document.getElementById("t29LockBanner");
  if (!b) {
    const host = document.querySelector("main") || document.body;
    b = document.createElement("div");
    b.id = "t29LockBanner";
    b.className = "t29-lock-banner";
    b.setAttribute("role", "alert");
    host.insertBefore(b, host.firstChild);
  }
  b.innerHTML = `<span class="t29-lock-msg"><strong>Urgent:</strong> ${escapeHtml(notifLockText(st))}</span>
    <span class="t29-lock-actions"><button type="button" class="btn small gold" onclick="notifLockChangePassword()">Change password</button>
    <button type="button" class="btn small secondary" onclick="notifLockDismissBanner()">Dismiss</button></span>`;
}
// Teachers have no bell, so they just get the banner.
async function notifLockBootTeacher(u) {
  const st = await notifLockNotice(u.username);
  if (st) notifShowLockBanner(u.username, st);
}

/* ===================== Device alerts (per device, opt-in) =====================
   The on/off choice is a localStorage flag keyed by username, so two
   students sharing a school computer never inherit each other's choice, and
   nothing about it goes near Firestore. "On" also needs the browser's own
   permission, which is per browser and which a page can't revoke.

   LIMIT (by design of this app, which has no server code): alerts are raised
   by this page's own poll, so they work while the site is open in a tab or
   the installed app, including a background tab, but not after the browser
   is fully closed. True closed-browser push needs a server (Firebase Cloud
   Messaging or Web Push plus a Cloud Function), which this app doesn't use.
   iOS/iPadOS (16.4+) only allows notifications for a site ADDED TO THE HOME
   SCREEN (needs manifest.webmanifest, display: standalone). In an ordinary
   Safari or Chrome tab `Notification` does not exist, so the control just
   tells the student how to install it. Without a server, iOS also freezes
   a backgrounded app, so alerts only fire while it is still running.

   Which items alert: unread (newer than the shared read watermark, so
   anything read on another device stays quiet), not alerted on this device
   before, not `quiet` (share moves and "waiting for approval" statuses), and
   only while the page isn't in front of the student (the bell covers that). */
function notifPrefKey(u) { return "t29-notif-device-" + u; }
function notifAlertedKey(u) { return "t29-notif-alerted-" + u; }
function notifGetDevicePref(u) { try { return localStorage.getItem(notifPrefKey(u)) === "1"; } catch (e) { return false; } }
function notifSetDevicePref(u, on) {
  try { if (on) localStorage.setItem(notifPrefKey(u), "1"); else localStorage.removeItem(notifPrefKey(u)); } catch (e) { /* private mode */ }
}
function notifPushSupported() {
  return typeof Notification !== "undefined" && window.isSecureContext !== false;
}
function notifIsIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function notifIsStandalone() {
  try { return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; }
}

// Gives iOS the manifest it needs to treat Add to Home Screen as a web app.
// Better still: put <link rel="manifest" href="manifest.webmanifest"> in each page's <head>.
function notifEnsureManifest() {
  if (document.querySelector('link[rel="manifest"]')) return;
  const l = document.createElement("link");
  l.rel = "manifest"; l.href = "manifest.webmanifest";
  document.head.appendChild(l);
}

function notifDeviceAlertsOn() {
  return !!NOTIF_USER && notifPushSupported() && Notification.permission === "granted" && notifGetDevicePref(NOTIF_USER);
}

function notifAlertedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(notifAlertedKey(NOTIF_USER)) || "[]")); } catch (e) { return new Set(); }
}
function notifSaveAlerted(set) {
  try { localStorage.setItem(notifAlertedKey(NOTIF_USER), JSON.stringify(Array.from(set).slice(-200))); } catch (e) { /* fine */ }
}

// A service worker is needed to show alerts on phones. If the site already
// has one we reuse it rather than replace it; otherwise we register ours.
async function notifGetSwReg() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register("notif-sw.js?v=8d0012ee");
    if (!reg.active) await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 4000))]);
    return reg;
  } catch (e) { return null; }
}

async function notifShowDeviceAlert(a) {
  const opts = { body: a.body || "", tag: a.tag, data: { url: a.url || "" } };
  const reg = await notifGetSwReg();
  if (reg && reg.showNotification) {
    try { await reg.showNotification(a.title, opts); return true; } catch (e) { /* fall through */ }
  }
  try {
    const n = new Notification(a.title, opts);
    n.onclick = () => { window.focus(); if (a.url) location.href = a.url; n.close(); };
    return true;
  } catch (e) { return false; }
}

function notifDeviceAlertNew() {
  if (!notifDeviceAlertsOn()) return;
  const lastRead = notifGetLastRead(NOTIF_USER);
  const seen = notifAlertedSet();
  const fresh = NOTIF_ITEMS.filter(n => !n.quiet && (n.ts || 0) > lastRead && !seen.has(n.id));
  if (!fresh.length) return;
  fresh.forEach(n => seen.add(n.id));
  notifSaveAlerted(seen);
  // Looking at the site right now: the bell badge already says it.
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const clip = t => (t || "").length > 140 ? t.slice(0, 137) + "…" : (t || "");
  if (fresh.length > 3) {
    notifShowDeviceAlert({
      title: `${fresh.length} new notifications`,
      body: clip(fresh.slice(0, 2).map(n => n.title).join(" · ") + ` and ${fresh.length - 2} more`),
      tag: "t29-notif-summary"
    });
  } else {
    fresh.forEach(n => notifShowDeviceAlert({
      title: n.title, body: clip(n.body), tag: "t29-" + n.id,
      url: n.href ? new URL(n.href, location.href).href : ""
    }));
  }
}

// Tab title "(3) …" and the installed-app icon badge, only while alerts are on.
let NOTIF_BADGE_SET = false;
function notifSyncTabBadge(n) {
  const on = notifDeviceAlertsOn();
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  const want = on && n > 0 ? `(${n}) ${base}` : base;
  if (document.title !== want) document.title = want;
  try {
    if (on && n > 0 && navigator.setAppBadge) { navigator.setAppBadge(n); NOTIF_BADGE_SET = true; }
    else if (NOTIF_BADGE_SET && navigator.clearAppBadge) { navigator.clearAppBadge(); NOTIF_BADGE_SET = false; }
  } catch (e) { /* badge API is optional */ }
}

// Alerts need the poll to keep running in a background tab.
let NOTIF_CLASS = null;
function notifSyncPolling() {
  if (!NOTIF_USER || !NOTIF_CLASS) return;
  if (document.hidden && !notifDeviceAlertsOn()) notifStopPoll();
  else notifStartPoll(NOTIF_USER, NOTIF_CLASS);
}

async function notifDeviceEnable() {
  if (!notifPushSupported()) return false;
  let perm = Notification.permission;
  if (perm === "default") {
    perm = await new Promise(res => { const p = Notification.requestPermission(res); if (p && p.then) p.then(res); });
  }
  if (perm !== "granted") { notifDeviceRepaintAll(); return false; }
  notifSetDevicePref(NOTIF_USER, true);
  // Don't flood them with everything already sitting in the bell.
  const seen = notifAlertedSet();
  NOTIF_ITEMS.forEach(n => seen.add(n.id));
  notifSaveAlerted(seen);
  notifSyncPolling();
  notifUpdateBadge();
  notifDeviceRepaintAll();
  notifShowDeviceAlert({ title: "Alerts are on for this device", body: "You'll get a ping here when something new needs you.", tag: "t29-test" });
  return true;
}
function notifDeviceDisable() {
  notifSetDevicePref(NOTIF_USER, false);
  notifSyncPolling();
  notifUpdateBadge();
  notifDeviceRepaintAll();
}

/* ---- The on/off control. notifDeviceControl(hostElement) renders it into
   any container (the bell panel uses it; settings-menu.js can call it too)
   and keeps it in sync across every place it's shown. ---- */
const NOTIF_DEVICE_HOSTS = new Set();
function notifInjectDeviceCss() {
  if (document.getElementById("t29DeviceCss")) return;
  const st = document.createElement("style");
  st.id = "t29DeviceCss";
  // Reuses the settings popover's own row + switch classes (so dark mode and
  // spacing come from style.css); this only adds the bar it sits in inside
  // the bell panel, and the inline "Send a test" link.
  st.textContent = `
.t29-da{flex-shrink:0;padding:11px 16px;border-bottom:1.5px solid var(--line);background:var(--bg);}
.settings-popover-desc button[data-da]{all:unset;cursor:pointer;text-decoration:underline;font-weight:700;color:inherit;}
.settings-popover-desc button[data-da]:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}`;
  document.head.appendChild(st);
}
function notifDeviceControl(host) {
  if (!host) return false;
  notifInjectDeviceCss();
  NOTIF_DEVICE_HOSTS.add(host);
  notifDeviceRender(host);
  return !!NOTIF_USER;
}
function notifDeviceRepaintAll() {
  NOTIF_DEVICE_HOSTS.forEach(h => { if (!h.isConnected) NOTIF_DEVICE_HOSTS.delete(h); else notifDeviceRender(h); });
}
// One markup for both places it appears. data-style="row" (settings menu)
// renders the bare row; otherwise (bell panel) it's wrapped in a bar.
function notifDeviceRender(host) {
  if (!NOTIF_USER) { host.innerHTML = ""; return; } // teachers / not ready yet
  const supported = notifPushSupported();
  const blocked = supported && Notification.permission === "denied";
  const on = notifDeviceAlertsOn();
  let desc;
  if (!supported) {
    desc = notifIsIos()
      ? (notifIsStandalone()
          ? "Alerts need iOS or iPadOS 16.4 or newer. Update your device, then reopen the app."
          : "iPhone and iPad only allow alerts for sites added to the Home Screen. Tap Share, then Add to Home Screen, open The 29 World from its new icon, and switch this on there.")
      : window.isSecureContext === false ? "Alerts need a secure (https) connection."
      : "Not available in this browser. Try Chrome, Edge, Firefox or Safari.";
  } else if (blocked) {
    desc = "Blocked in your browser. Allow notifications for this site in your browser's site settings, then reopen this menu.";
  } else if (on) {
    desc = `Alerts you to new notifications on this device only. Needs the site open in a tab or app. <button type="button" data-da="test">Send a test</button>`;
  } else {
    desc = "Get an alert on this device when you have a new notification. This device only.";
  }
  const row = `<div class="settings-popover-row">
      <div class="settings-popover-text">
        <div class="settings-popover-title">Notification alerts</div>
        <div class="settings-popover-desc">${desc}</div>
      </div>
      <label class="lg-switch">
        <input type="checkbox" aria-label="Notification alerts on this device"${on ? " checked" : ""}${!supported || blocked ? " disabled" : ""}>
        <span class="lg-switch-track"><span class="lg-switch-thumb"></span></span>
      </label>
    </div>`;
  host.innerHTML = host.dataset.style === "row" ? row : `<div class="t29-da">${row}</div>`;
  const cb = host.querySelector("input");
  cb.addEventListener("change", async () => {
    cb.disabled = true; // one tap = one change, even while the permission prompt is up
    if (cb.checked) await notifDeviceEnable(); else notifDeviceDisable();
    notifDeviceRepaintAll();
  });
  const test = host.querySelector('[data-da="test"]');
  if (test) test.addEventListener("click", async e => {
    e.stopPropagation();
    test.textContent = (await notifShowDeviceAlert({ title: "Test alert", body: "If you can see this, alerts work on this device.", tag: "t29-test" })) ? "Sent" : "Couldn't show it";
  });
}

/* ================= UI ================= */
let NOTIF_USER = null;
let NOTIF_ITEMS = [];
let NOTIF_POLL_TIMER = null;

// The panel opens showing the top NOTIF_INITIAL_SHOW rows — since
// buildNotifications() already sorts action-needed and unread items to
// the top, this means a student always sees whatever needs them first,
// with a "Show more" row to reveal the rest instead of everything being
// visible all at once. Raised from 10 now that every held company's move
// gets its own row (see notifMarketItems) instead of just the top 4, so a
// student holding several companies isn't immediately funnelled into an
// extra click just to see all of them. NOTIF_EXPANDED resets on every
// open so it never carries a stale "expanded" state into the next visit.
const NOTIF_INITIAL_SHOW = 15;
let NOTIF_EXPANDED = false;

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
    <div class="notif-device" id="notifDevice"></div>
    <div class="notif-list" id="notifList"></div>
    <div class="notif-foot"><a href="bank.html">See my full account history ›</a></div>
  `;
  document.body.appendChild(panel);
  notifDeviceControl(panel.querySelector("#notifDevice"));
  panel.addEventListener("click", e => e.stopPropagation());
  panel.querySelector("#notifMarkRead").addEventListener("click", () => {
    notifSetLastRead(NOTIF_USER, trustedNow().getTime());
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
  NOTIF_EXPANDED = false;
  notifRenderList();
  notifDeviceRepaintAll(); // the browser permission may have changed since last time
  notifPositionPanel(panel, btn);
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("active");
  // Opening the panel is what marks things read — but the badge only
  // clears once the list has actually been rendered, so nothing can be
  // marked read without having been shown.
  // BUGFIX: was Date.now() — the device's own, possibly-wrong clock. Every
  // item's ts is derived from the trusted clock (see notifTodayStartMs),
  // so stamping "read" from a different, uncorrected clock could leave a
  // slow device's last-read watermark behind the items it was just shown,
  // and they'd reappear as unread the moment the badge repainted.
  notifSetLastRead(NOTIF_USER, trustedNow().getTime());
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
  // Phone menu button (sidebar-nav.js) shows a dot too, since the bell is
  // hidden inside the closed menu there.
  if (typeof sbSyncUnreadDot === "function") sbSyncUnreadDot();
  notifSyncTabBadge(n);
}

function notifRenderList() {
  const list = document.getElementById("notifList");
  if (!list) return;
  const lastRead = notifGetLastRead(NOTIF_USER);
  if (!NOTIF_ITEMS.length) {
    list.innerHTML = `<div class="notif-empty"><p>You're all caught up.</p><p class="muted-small">Anything due, any decision waiting on you, and how your shares moved will show up here.</p></div>`;
    return;
  }
  const showCount = NOTIF_EXPANDED ? NOTIF_ITEMS.length : Math.min(NOTIF_INITIAL_SHOW, NOTIF_ITEMS.length);
  const visible = NOTIF_ITEMS.slice(0, showCount);
  const remaining = NOTIF_ITEMS.length - visible.length;

  const rows = visible.map(n => {
    const unread = (n.ts || 0) > lastRead;
    // A row is a link when it goes somewhere, and a button when it opens
    // something in place (a quiz popup) — never a dead <div> that looks
    // tappable but isn't.
    const clickable = !!(n.href || n.onClick);
    const tag = clickable ? "a" : "div";
    const href = n.href ? ` href="${n.href}"` : (n.onClick ? ` href="#" onclick="notifClose();${n.onClick};return false;"` : "");
    return `<${tag}${href} class="notif-row${unread ? " unread" : ""}${n.action ? " action" : ""}${n.urgent ? " urgent" : ""}">
      <span class="notif-ic ${n.tone}">${notifIconFor(n.icon, 15)}</span>
      <span class="notif-body">
        <span class="notif-title">${escapeHtml(n.title)}</span>
        ${n.body ? `<span class="notif-sub">${escapeHtml(n.body)}</span>` : ""}
        <span class="notif-time">${n.urgent ? "URGENT · " : n.action ? "Needs your attention · " : ""}${notifRelativeTime(n.ts)}</span>
      </span>
    </${tag}>`;
  }).join("");

  const moreRow = remaining > 0
    ? `<button type="button" class="notif-row notif-showmore" id="notifShowMore">Show ${remaining} more</button>`
    : "";

  list.innerHTML = rows + moreRow;

  const moreBtn = document.getElementById("notifShowMore");
  if (moreBtn) {
    moreBtn.addEventListener("click", e => {
      e.stopPropagation();
      NOTIF_EXPANDED = true;
      notifRenderList();
    });
  }
}

function notifPaint() {
  notifUpdateBadge();
  const panel = document.getElementById("notifPanel");
  if (panel && !panel.classList.contains("hidden")) notifRenderList();
}

async function notifRefresh(username, classCode) {
  // A new week's variable mortgage rate must be in place before any payment amount is quoted.
  try { if (window.T29_RATES_READY) await window.T29_RATES_READY; } catch (e) {}
  const [me, cls] = await Promise.all([getUserCached(username), getClassCached(classCode)]);
  if (!me || !cls) return;
  withNewModuleDefaults(cls);
  // Pick up a "mark read" done on another device/tab, and (one-off) push up
  // a watermark that so far only exists in this device's localStorage.
  if (Number(me.notifLastRead) > NOTIF_REMOTE_READ) NOTIF_REMOTE_READ = Number(me.notifLastRead);
  const localRead = notifGetLocalRead(username);
  if (localRead > NOTIF_REMOTE_READ) notifPushRemoteRead(username, localRead);
  NOTIF_ITEMS = buildNotifications(Object.assign({ username }, me), cls);
  try {
    const lock = await notifLockNotice(username);
    if (lock) {
      NOTIF_ITEMS.unshift(notifLockItem(username, lock));
      notifShowLockBanner(username, lock);
    }
  } catch (e) { /* the lock notice is optional */ }
  notifPaint();
  notifDeviceAlertNew();

  // Every page now gets the module locks applied to its nav, not just the
  // three that happened to call this themselves — this file is the only
  // thing loaded absolutely everywhere that already has `cls` and `me`.
  if (me.role === "student" && typeof applyNavModuleLocks === "function") {
    applyNavModuleLocks(getModuleLockReasonsFromData(cls, Object.assign({ username }, me), username));
  }
  // A big event handed out while this page was already open still has to
  // be answered before anything else (see checkBigEventPopup).
  if (me.role === "student" && typeof checkBigEventPopup === "function") {
    checkBigEventPopup(username, classCode, true).catch(() => {});
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
  notifEnsureManifest();
  let u = null;
  try { u = await getSessionUser(); } catch (e) { return; }
  // Teachers get their own dashboards for all of this; the feed is a
  // student-facing "what happened to ME" view.
  if (u && u.role === "teacher") { notifInjectLockCss(); notifLockBootTeacher(u).catch(() => {}); return; }
  if (!u || u.role !== "student" || !u.classCode) return;
  NOTIF_USER = u.username;
  NOTIF_CLASS = u.classCode;
  notifDeviceRepaintAll(); // a settings control may have been drawn before we knew who this was

  if (!notifBuildBell()) return;

  // Another tab on this device marked read: repaint right away.
  window.addEventListener("storage", e => {
    if (e.key === notifReadKey(NOTIF_USER)) notifPaint();
    if (e.key === notifPrefKey(NOTIF_USER)) { notifDeviceRepaintAll(); notifSyncPolling(); notifUpdateBadge(); }
  });
  document.addEventListener("click", () => notifClose());
  document.addEventListener("keydown", e => { if (e.key === "Escape") notifClose(); });
  window.addEventListener("resize", () => {
    const panel = document.getElementById("notifPanel");
    const btn = document.getElementById("notifBell");
    if (panel && btn && !panel.classList.contains("hidden")) notifPositionPanel(panel, btn);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) notifSyncPolling(); // keeps polling only if this device has alerts on
    else { notifRefresh(u.username, u.classCode).catch(() => {}); notifStartPoll(u.username, u.classCode); }
  });

  await notifRefresh(u.username, u.classCode).catch(() => {});
  if (!document.hidden || notifDeviceAlertsOn()) notifStartPoll(u.username, u.classCode);
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
