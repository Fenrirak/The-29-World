/* ===================== The 29 World — first-time walkthrough =====================
   A short guided tour of the student dashboard (student.html) and the
   teacher dashboard (teacher.html): each step highlights one part of the
   page and explains it in a sentence or two.

   When it shows:
     - straight away for a brand-new account (signup sends them here with
       ?welcome=1);
     - otherwise, the first time someone opens that page after this feature
       arrived, as a small "Want a quick tour?" offer they can dismiss —
       existing users already know their way around, so it never just
       takes over the screen for them;
     - any time from Settings → "Show me around" (settings-menu.js adds
       that row on pages that load this file).
   "Seen it" is remembered per account, per device, in localStorage —
   nothing is written to the database.

   Steps whose element isn't on the page (or isn't visible right now, e.g.
   the menu hidden in the phone drawer) fall back to the next selector in
   their list, or to a plain centred card — so a tour never breaks just
   because a page looks a little different.
================================================================================ */

const T29_TOURS = {
  student: [
    { title: "Welcome to The 29 World! 👋",
      text: "This is your own pretend-money world. You'll earn money, save it, spend it and invest it — and see how good you are with money. Here's a quick tour." },
    { target: ["#balance"], card: true, title: "Your cash",
      text: "The money you can spend right now. It also stays in the corner of every page so you always know what you've got." },
    { target: ["#jobLabel"], card: true, title: "Your job",
      text: "Your teacher gives you a job. Do your job task and you get paid your wage every pay day." },
    { target: ["#leaderboardList"], card: true, title: "Net worth ranking",
      text: "Net worth is everything you own minus anything you owe. This shows how you compare with your classmates." },
    { target: ["#goalsCard"], title: "Savings goals",
      text: "Pick something to save up for. Money you move into your Savings account (on the Bank page) fills up your goals. You can see them on the Bank page too." },
    { target: [".topbar nav", ".sb-hamburger"], title: "The menu",
      text: "Bank, Stock Market, Store, Jobs, Property and more. Some might be locked until you pass a quiz or raise your lifestyle rating — tap one to find out." },
    { target: ["#notifBell", ".sb-hamburger"], title: "Notifications",
      text: "The bell lets you know when bills are due, how your shares did, and anything that needs you. On a phone it's inside the menu — a red dot on the menu button means something new." },
    { target: ["#reportCardBtn"], title: "Your report card",
      text: "See where your money went this month — and share it with your family if you like." },
    { target: ["#settingsBtn", ".sb-hamburger"], title: "Settings",
      text: "Dark mode, change your password, and this tour again any time you want it. On a phone, Settings is at the bottom of the menu." },
    { title: "You're all set!",
      text: "A good first step: visit the Bank and put some money into Savings to start on a goal. Have fun!" }
  ],
  teacher: [
    { title: "Welcome to your class dashboard! 👋",
      text: "This is where you run your class's economy. Here's a quick tour of the main parts — it takes about a minute." },
    { target: ["#classCode"], closest: "p", title: "Your class code",
      text: "Give this code to your students. They choose \"I'm a Student\" → \"Join a class\" on the login page and type it in." },
    { target: ["#statStudents"], closest: ".grid", title: "Your class at a glance",
      text: "How many students have joined, how much the class has saved, and how many companies are on the stock market." },
    { target: ["#hStudents"], card: true, title: "Students",
      text: "Everyone who's joined. Give each student a job here, tick off their job task each week, and open a student to see their full profile." },
    { target: ["#payDayBtn"], title: "Pay day",
      text: "Wages are paid automatically on your class's pay day, to students whose job task you've ticked. This button runs it now." },
    { target: ["#hAdjust"], card: true, title: "Quick transactions",
      text: "Give a bonus or a fine to one student, with a reason they'll see." },
    { target: ["#hSettings"], card: true, title: "Class settings",
      text: "Interest rates, pay day, whether gambling is allowed, and a daily time limit for students." },
    { target: [".topbar nav", ".sb-hamburger"], title: "Modules",
      text: "Each module — Jobs, Bank, Store, Property, Insurance and more — has its own page where you set it up. Start with Jobs, so students can earn." },
    { target: ['.topbar nav a[href="reports.html"]', ".sb-hamburger"], title: "Reports",
      text: "Report cards for every student, CSV and PDF export, and family links so parents can see how their child is doing." },
    { target: ["#settingsBtn", ".sb-hamburger"], title: "Settings",
      text: "Dark mode, change your password, and this tour again any time. On a phone, Settings is at the bottom of the menu." },
    { title: "You're ready to go!",
      text: "Suggested first steps: add a few jobs, set your pay day, then share your class code with your students." }
  ]
};

let T29_TOUR = null; // { id, steps, index, username } while a tour is open

function _t29TourKey(tourId, username) {
  return "t29_tour_" + tourId + "_" + (username || "anon");
}
function _t29TourSeen(tourId, username) {
  try { return localStorage.getItem(_t29TourKey(tourId, username)) === "done"; } catch (e) { return true; }
}
function _t29TourMarkSeen(tourId, username) {
  try { localStorage.setItem(_t29TourKey(tourId, username), "done"); } catch (e) { /* ignore */ }
}

// Which tour belongs to the page that's open, if any.
function t29TourForThisPage() {
  const page = (window.location.pathname.split("/").pop() || "").toLowerCase();
  if (page === "student.html") return "student";
  if (page === "teacher.html") return "teacher";
  return null;
}

// Called by each page once it has fully loaded.
function t29MaybeStartTour(tourId, user) {
  if (!T29_TOURS[tourId] || !user || document.body.classList.contains("t29-archived-readonly")) return;
  window.T29_TOUR_USER = user.username;
  if (_t29TourSeen(tourId, user.username)) return;
  const isNewAccount = new URLSearchParams(window.location.search).get("welcome") === "1";
  if (isNewAccount) {
    t29StartTour(tourId);
  } else {
    _t29OfferTour(tourId);
  }
}

// The gentle version for existing accounts: a small card in the corner.
function _t29OfferTour(tourId) {
  if (document.getElementById("t29TourOffer")) return;
  const box = document.createElement("div");
  box.id = "t29TourOffer";
  box.className = "t29-tour-offer";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Take a tour");
  box.innerHTML = `
    <div class="t29-tour-offer-text"><strong>New here, or want a refresher?</strong><br>Take a one-minute tour of this page.</div>
    <div class="t29-tour-offer-actions">
      <button type="button" class="btn small gold" data-act="go">Show me around</button>
      <button type="button" class="btn small secondary" data-act="no">No thanks</button>
    </div>`;
  box.addEventListener("click", e => {
    const act = e.target && e.target.getAttribute("data-act");
    if (!act) return;
    box.remove();
    _t29TourMarkSeen(tourId, window.T29_TOUR_USER);
    if (act === "go") t29StartTour(tourId);
  });
  document.body.appendChild(box);
}

function t29StartTour(tourId) {
  tourId = tourId || t29TourForThisPage();
  const steps = T29_TOURS[tourId];
  if (!steps) return;
  t29EndTour(false);
  const offer = document.getElementById("t29TourOffer");
  if (offer) offer.remove();
  if (typeof sbSetDrawerOpen === "function") sbSetDrawerOpen(false);
  T29_TOUR = {
    id: tourId, steps, index: 0,
    username: window.T29_TOUR_USER || (typeof T29_SESSION_USERNAME !== "undefined" ? T29_SESSION_USERNAME : null)
  };

  const layer = document.createElement("div");
  layer.id = "t29Tour";
  layer.className = "t29-tour";
  layer.innerHTML = `
    <div class="t29-tour-shade"></div>
    <div class="t29-tour-spot hidden"></div>
    <div class="t29-tour-card" role="dialog" aria-modal="true" aria-labelledby="t29TourTitle" aria-describedby="t29TourText">
      <div class="t29-tour-count" id="t29TourCount"></div>
      <h3 id="t29TourTitle"></h3>
      <p id="t29TourText"></p>
      <div class="t29-tour-actions">
        <button type="button" class="link-btn" data-act="skip">Skip tour</button>
        <span style="flex:1;"></span>
        <button type="button" class="btn small secondary" data-act="back">Back</button>
        <button type="button" class="btn small gold" data-act="next">Next</button>
      </div>
    </div>`;
  layer.addEventListener("click", e => {
    const act = e.target && e.target.closest("[data-act]") && e.target.closest("[data-act]").getAttribute("data-act");
    if (act === "skip") t29EndTour(true);
    else if (act === "back") _t29TourGo(T29_TOUR.index - 1);
    else if (act === "next") _t29TourGo(T29_TOUR.index + 1);
  });
  document.body.appendChild(layer);
  document.addEventListener("keydown", _t29TourKeys, true);
  window.addEventListener("resize", _t29TourReposition);
  window.addEventListener("scroll", _t29TourReposition, { passive: true });
  _t29TourGo(0);
}

function t29EndTour(markSeen) {
  const layer = document.getElementById("t29Tour");
  if (layer) layer.remove();
  document.removeEventListener("keydown", _t29TourKeys, true);
  window.removeEventListener("resize", _t29TourReposition);
  window.removeEventListener("scroll", _t29TourReposition);
  if (T29_TOUR && markSeen) _t29TourMarkSeen(T29_TOUR.id, T29_TOUR.username);
  T29_TOUR = null;
}

function _t29TourKeys(e) {
  if (!T29_TOUR) return;
  if (e.key === "Escape") { e.preventDefault(); t29EndTour(true); }
  else if (e.key === "ArrowRight") { e.preventDefault(); _t29TourGo(T29_TOUR.index + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); _t29TourGo(T29_TOUR.index - 1); }
}

// Is this element actually on screen right now (not hidden, not zero-size,
// not parked off-canvas like the closed phone menu)?
function _t29TourVisible(el) {
  if (!el) return false;
  // Anything inside the phone's slide-out menu counts as hidden while the
  // menu is closed — even mid-way through its closing animation.
  const html = document.documentElement;
  if (html.classList.contains("sidebar-nav") && !html.classList.contains("sidebar-open")
      && window.matchMedia("(max-width: 900px)").matches
      && el.closest(".topbar nav, .topbar-actions")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const pageW = document.documentElement.clientWidth;
  if (r.right <= 0 || r.left >= pageW) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

function _t29TourTarget(step) {
  for (const sel of step.target || []) {
    let el = document.querySelector(sel);
    if (el && step.card) el = el.closest(".card, .stat") || el;
    if (el && step.closest) el = el.closest(step.closest) || el;
    if (_t29TourVisible(el)) return el;
  }
  return null;
}

function _t29TourGo(i) {
  if (!T29_TOUR) return;
  if (i < 0) return;
  if (i >= T29_TOUR.steps.length) { t29EndTour(true); return; }
  // Skip a step whose element simply isn't on this page (e.g. no bell for
  // a teacher), unless it's meant to be a centred card anyway.
  const dir = i >= T29_TOUR.index ? 1 : -1;
  while (i >= 0 && i < T29_TOUR.steps.length) {
    const s = T29_TOUR.steps[i];
    if (!s.target || _t29TourTarget(s)) break;
    i += dir;
  }
  if (i < 0) i = 0;
  if (i >= T29_TOUR.steps.length) { t29EndTour(true); return; }
  T29_TOUR.index = i;
  const step = T29_TOUR.steps[i];
  const layer = document.getElementById("t29Tour");
  layer.querySelector("#t29TourCount").textContent = `${i + 1} of ${T29_TOUR.steps.length}`;
  layer.querySelector("#t29TourTitle").textContent = step.title;
  layer.querySelector("#t29TourText").textContent = step.text;
  layer.querySelector('[data-act="back"]').classList.toggle("hidden", i === 0);
  const isLast = i === T29_TOUR.steps.length - 1;
  layer.querySelector('[data-act="next"]').textContent = isLast ? "Done" : (i === 0 ? "Start" : "Next");
  layer.querySelector('[data-act="skip"]').classList.toggle("hidden", isLast);

  const el = _t29TourTarget(step);
  if (el) {
    const r = el.getBoundingClientRect();
    const fullyInView = r.top >= 70 && r.bottom <= window.innerHeight - 20;
    if (!fullyInView && getComputedStyle(el).position !== "fixed" && !el.closest(".topbar")) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }
  _t29TourReposition();
  layer.querySelector('[data-act="next"]').focus({ preventScroll: true });
}

function _t29TourReposition() {
  if (!T29_TOUR) return;
  const layer = document.getElementById("t29Tour");
  if (!layer) return;
  const step = T29_TOUR.steps[T29_TOUR.index];
  const spot = layer.querySelector(".t29-tour-spot");
  const shade = layer.querySelector(".t29-tour-shade");
  const card = layer.querySelector(".t29-tour-card");
  const el = step.target ? _t29TourTarget(step) : null;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, pad = 8, gap = 12;

  if (!el) {
    spot.classList.add("hidden");
    shade.classList.remove("hidden");
    card.classList.add("centered");
    card.style.left = card.style.top = "";
    return;
  }
  const r = el.getBoundingClientRect();
  shade.classList.add("hidden"); // the spotlight's own shadow darkens the rest of the page
  spot.classList.remove("hidden");
  spot.style.left = Math.max(4, r.left - pad) + "px";
  spot.style.top = Math.max(4, r.top - pad) + "px";
  spot.style.width = Math.min(vw - 8, r.width + pad * 2) + "px";
  spot.style.height = Math.min(vh - 8, r.height + pad * 2) + "px";

  card.classList.remove("centered");
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let top = r.bottom + pad + gap;
  if (top + ch > vh - 10) top = r.top - pad - gap - ch;      // no room below: go above
  if (top < 10) top = Math.min(vh - ch - 10, Math.max(10, r.top + 20)); // no room either side: overlap a little
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(10, Math.min(left, vw - cw - 10));
  card.style.left = left + "px";
  card.style.top = top + "px";
}
