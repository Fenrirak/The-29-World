let CURRENT, IS_TEACHER, CLS, MODE = "roulette";

/* ===================== Roulette state/logic ===================== */
let selection = [];
// Remembers the last bet type/selection so it can be re-applied after a
// spin (so the picker doesn't reset every bet). Plain in-memory JS state,
// so it naturally resets to "nothing selected" on page reload/navigation.
let lastBetType = null;
let lastSelection = [];

// European roulette wheel pocket order (clockwise) and colours, used to
// build the spinning-wheel animation shown while a bet is resolving.
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const WHEEL_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function wheelPocketColor(n) {
  if (n === 0) return "#2e9873";
  return WHEEL_RED.has(n) ? "#c9503a" : "#1f2b44";
}
function wheelGradient() {
  const seg = 360 / WHEEL_ORDER.length;
  const stops = WHEEL_ORDER.map((n, i) => `${wheelPocketColor(n)} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`);
  return `conic-gradient(${stops.join(",")})`;
}

// Shows an animated roulette wheel that spins for ~15 seconds and settles
// on `number` (already determined server-side by placeRouletteBet), then
// resolves once the reveal has been shown briefly.
function showRouletteAnimation(number) {
  return new Promise(resolve => {
    const seg = 360 / WHEEL_ORDER.length;
    const idx = WHEEL_ORDER.indexOf(number);
    const pocketAngle = idx * seg + seg / 2;

    // Matches the CSS's `width:min(392px, 88vw)` for .wheel-stage — the
    // number ring's radius is a fixed px offset, so on a shrunk (mobile)
    // wheel it needs scaling down too, or the numbers would sit outside
    // the visible disc instead of around its edge.
    const stageSize = Math.min(392, window.innerWidth * 0.88);
    const scale = stageSize / 392;
    const radius = 165 * scale;

    let numbersHtml = "";
    WHEEL_ORDER.forEach((n, i) => {
      const angle = i * seg + seg / 2;
      numbersHtml += `<div class="wheel-number" style="transform:rotate(${angle}deg) translate(0,${(-radius).toFixed(1)}px) rotate(${-angle}deg);background:${wheelPocketColor(n)};">${n}</div>`;
    });

    const overlay = document.createElement("div");
    overlay.className = "anw-modal-overlay";
    overlay.id = "wheelOverlay";
    overlay.innerHTML = `
      <div class="anw-modal-card" style="text-align:center;max-width:500px;">
        <h2 style="display:flex;align-items:center;justify-content:center;gap:9px;">${icon("dice", 24)} Spinning the wheel...</h2>
        <div class="wheel-stage">
          <div class="wheel-rim">
            <div class="wheel-disc" id="wheelDisc" style="background:${wheelGradient()};">
              ${numbersHtml}
            </div>
          </div>
          <div class="wheel-ball-track" id="wheelBallTrack"><div class="wheel-ball"></div></div>
          <div class="wheel-hub"></div>
        </div>
        <p class="muted-small" id="wheelStatus">No peeking — the ball is rolling...</p>
      </div>
    `;
    document.body.appendChild(overlay);

    const disc = document.getElementById("wheelDisc");
    const ballTrack = document.getElementById("wheelBallTrack");
    // Force a reflow so the browser registers the starting transform
    // before we change it, or the transition won't animate.
    void disc.offsetWidth;

    const wheelSpins = 6;
    const ballSpins = 10;
    // The disc rotates so the winning pocket ends up at angle 0 (under the
    // fixed pointer at the top) — pocketAngle cancels out, so it always
    // lands there regardless of which number won.
    const finalWheelRotation = wheelSpins * 360 - pocketAngle;
    // The ball needs to end up at that SAME screen position (angle 0, the
    // pointer) so it visually drops into the now-topmost winning pocket.
    // It must NOT be offset by pocketAngle, or it lands somewhere else.
    const finalBallRotation = -(ballSpins * 360);

    disc.style.transform = `rotate(${finalWheelRotation}deg)`;
    ballTrack.style.transform = `rotate(${finalBallRotation}deg)`;

    setTimeout(() => {
      const status = document.getElementById("wheelStatus");
      if (status) status.textContent = `Landed on ${number}!`;
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 1300);
    }, 15000);
  });
}

function neededCount(type) {
  return { straightUp: 1, split: 2, street: 3, corner: 4, sixLine: 6, oddEven: 0 }[type];
}

function renderPicker() {
  const type = document.getElementById("betType").value;
  // Re-apply the previous bet's selection only if the bet type is the same
  // as last time — otherwise start fresh (old picks wouldn't make sense
  // under a different bet type).
  selection = (type === lastBetType) ? [...lastSelection] : [];
  const area = document.getElementById("pickerArea");

  if (type === "oddEven") {
    area.innerHTML = `
      <div class="row-flex" style="gap:10px;">
        <button class="btn secondary" onclick="pickOddEven('odd')" id="pickOdd">Odd</button>
        <button class="btn secondary" onclick="pickOddEven('even')" id="pickEven">Even</button>
      </div>
    `;
    if (selection[0] === "odd" || selection[0] === "even") {
      document.getElementById(selection[0] === "odd" ? "pickOdd" : "pickEven").classList.add("gold");
    }
    return;
  }

  const need = neededCount(type);
  const layoutNote = type === "straightUp"
    ? "Tap 0, or any number 1-36."
    : "Numbers are laid out in a horizontal table, just like a real roulette table — pick cells that are actually next to each other (above/below in the same column, or left/right) for a valid bet.";
  area.innerHTML = `
    <p class="muted-small">Pick ${need} number${need === 1 ? "" : "s"}. ${layoutNote} Selected: <span id="pickCount">0</span>/${need}</p>
    <div class="number-table-wrap">
      ${type === "straightUp" ? `<button type="button" class="number-zero" id="num-0">0</button>` : ""}
      <div id="numberGrid" class="number-grid"></div>
    </div>
  `;
  if (type === "straightUp") {
    document.getElementById("num-0").onclick = () => toggleNumber(0, need);
  }
  const grid = document.getElementById("numberGrid");
  for (let n = 1; n <= 36; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "number-cell" + (n % 2 === 0 ? " even-cell" : " odd-cell");
    btn.textContent = n;
    btn.onclick = () => toggleNumber(n, need);
    btn.id = "num-" + n;
    grid.appendChild(btn);
  }

  // Re-mark any restored selection in the freshly-built grid.
  selection.forEach(n2 => {
    const el = document.getElementById("num-" + n2);
    if (el) el.classList.add("selected");
  });
  const countEl = document.getElementById("pickCount");
  if (countEl) countEl.textContent = selection.length;
  lastBetType = type;
  lastSelection = [...selection];
}

function pickOddEven(which) {
  selection = [which];
  document.getElementById("pickOdd").classList.toggle("gold", which === "odd");
  document.getElementById("pickEven").classList.toggle("gold", which === "even");
  lastBetType = "oddEven";
  lastSelection = [...selection];
}

function toggleNumber(n, need) {
  const idx = selection.indexOf(n);
  if (idx >= 0) {
    selection.splice(idx, 1);
  } else {
    if (selection.length >= need) selection.shift(); // drop oldest pick once full
    selection.push(n);
  }
  document.querySelectorAll(".number-cell, .number-zero").forEach(el => el.classList.remove("selected"));
  selection.forEach(n2 => {
    const el = document.getElementById("num-" + n2);
    if (el) el.classList.add("selected");
  });
  const countEl = document.getElementById("pickCount");
  if (countEl) countEl.textContent = selection.length;
  lastBetType = document.getElementById("betType").value;
  lastSelection = [...selection];
}

async function spin() {
  const type = document.getElementById("betType").value;
  const amount = document.getElementById("betAmount").value;
  const box = document.getElementById("betMsg");
  const spinBtn = document.getElementById("spinBtn");
  box.innerHTML = "";
  spinBtn.disabled = true;
  spinBtn.textContent = "Spinning...";

  const res = await placeRouletteBet(CURRENT.username, CURRENT.classCode, type, amount, selection);
  if (!res.ok) {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    spinBtn.disabled = false;
    spinBtn.innerHTML = "Spin the wheel";
    return;
  }

  await showRouletteAnimation(res.spin);

  box.innerHTML = res.win
    ? `<div class="success-msg">Ball landed on ${res.spin}. You WON ${fmtMoney(res.netChange)}!</div>`
    : `<div class="error-msg">Ball landed on ${res.spin}. You lost ${fmtMoney(Math.abs(res.netChange))}.</div>`;
  document.getElementById("betAmount").value = "";
  spinBtn.disabled = false;
  spinBtn.innerHTML = "Spin the wheel";
  await render();
}

async function renderRecentRoulette() {
  const cls = await getClassCached(CURRENT.classCode);
  const mine = cls.txns.filter(t => t.type === "gambling" && t.from === CURRENT.username && !t.note.startsWith("Blackjack")).slice(0, 15);
  const box = document.getElementById("recentBets");
  document.getElementById("noBets").classList.toggle("hidden", mine.length > 0);
  box.innerHTML = "";
  mine.forEach(t => {
    const won = t.note.includes("WON");
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details">${icon("dice", 14)} ${t.note} <div class="muted-small">${t.date}</div></div>
      <div class="${won ? 'ticker-up' : 'ticker-down'}" style="font-weight:900;">${won ? "+" : "-"}${fmtMoney(t.amount)}</div>
    `;
    box.appendChild(row);
  });
}

async function saveRouletteSettings() {
  await saveGamblingSettings(CURRENT.classCode, {
    enabled: document.getElementById("gEnabled").checked,
    minBet: document.getElementById("gMin").value,
    maxBet: document.getElementById("gMax").value,
    dailyBetCap: document.getElementById("gDailyCap").value,
    straightUp: document.getElementById("pStraight").value,
    split: document.getElementById("pSplit").value,
    street: document.getElementById("pStreet").value,
    corner: document.getElementById("pCorner").value,
    sixLine: document.getElementById("pSixLine").value,
    oddEven: document.getElementById("pOddEven").value
  });
  document.getElementById("settingsMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

/* ===================== Blackjack state/logic ===================== */
let CURRENT_ROUND = null; // client-side mirror of the server round view

async function bjDeal() {
  const amount = document.getElementById("bjBetAmount").value;
  const box = document.getElementById("bjBetMsg");
  const btn = document.getElementById("bjDealBtn");
  box.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "Dealing...";

  const res = await startBlackjackRound(CURRENT.username, CURRENT.classCode, amount);
  btn.disabled = false;
  btn.innerHTML = "Deal";
  if (!res.ok) {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  CURRENT_ROUND = res.round;
  document.getElementById("bjBetForm").classList.add("hidden");
  document.getElementById("bjTableArea").classList.remove("hidden");
  document.getElementById("bjNewRoundBtn").classList.add("hidden");
  document.getElementById("bjRoundMsg").innerHTML = "";
  renderBlackjackRound();
}

async function bjDoInsurance(take) {
  const res = await blackjackInsurance(CURRENT.username, CURRENT.classCode, take);
  if (!res.ok) { alert(res.error); return; }
  CURRENT_ROUND = res.round;
  renderBlackjackRound();
  if (CURRENT_ROUND.phase === "done") await bjAfterRoundEnds(res.netChange);
}

async function bjDoAction(action) {
  ["bjHitBtn", "bjStandBtn", "bjDoubleBtn", "bjSplitBtn"].forEach(id => document.getElementById(id).disabled = true);
  const res = await blackjackAction(CURRENT.username, CURRENT.classCode, action);
  ["bjHitBtn", "bjStandBtn", "bjDoubleBtn", "bjSplitBtn"].forEach(id => document.getElementById(id).disabled = false);
  if (!res.ok) {
    document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
    return;
  }
  CURRENT_ROUND = res.round;
  renderBlackjackRound();
  if (CURRENT_ROUND.phase === "done") await bjAfterRoundEnds(res.netChange);
}

// Deliberately does NOT hide the table or reset the bet form — the player
// should still see the finished hands until they choose "New round".
async function bjAfterRoundEnds(netChange) {
  document.getElementById("bjNewRoundBtn").classList.remove("hidden");
  document.getElementById("bjRoundMsg").innerHTML = netChange >= 0
    ? `<div class="success-msg">You WON ${fmtMoney(netChange)} this round!</div>`
    : `<div class="error-msg">You lost ${fmtMoney(Math.abs(netChange))} this round.</div>`;
  CLS = await getClassCached(CURRENT.classCode);
  await renderRecentBlackjack();
}

async function bjResetTable() {
  CURRENT_ROUND = null;
  document.getElementById("bjBetAmount").value = "";
  document.getElementById("bjBetForm").classList.remove("hidden");
  document.getElementById("bjTableArea").classList.add("hidden");
  document.getElementById("bjNewRoundBtn").classList.add("hidden");
  await render();
}

function bjSuitSymbol(s) { return { S: "♠", H: "♥", D: "♦", C: "♣" }[s] || s; }
function bjCardHtml(card, faceDown) {
  if (faceDown) return `<div class="bj-card face-down"></div>`;
  const red = card.s === "H" || card.s === "D";
  return `<div class="bj-card ${red ? "red" : "black"}">${card.r}${bjSuitSymbol(card.s)}</div>`;
}
function bjHandHtml(cards, faceDownCount) {
  return cards.map((c, i) => bjCardHtml(c, faceDownCount && i >= cards.length - faceDownCount)).join("");
}
function bjOutcomeLabel(o) {
  return { won: "Won", blackjack: "Blackjack!", push: "Push", lost: "Lost", "lost-to-dealer-blackjack": "Lost" }[o] || "";
}
function bjOutcomeClass(o) {
  if (o === "won" || o === "blackjack") return "won";
  if (o === "push") return "push";
  return "lost";
}
// Small client-side mirror of data.js's bjCardValue, just for deciding
// which action buttons to show — the server independently re-validates
// every action, so this is only ever a UI convenience.
function bjCardValueClient(rank) {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}

function renderBlackjackRound() {
  const r = CURRENT_ROUND;

  // Dealer
  const dealerHidden = !r.dealer.revealed;
  document.getElementById("bjDealerHand").innerHTML = dealerHidden
    ? bjCardHtml(r.dealer.cards[0], false) + bjCardHtml(null, true)
    : bjHandHtml(r.dealer.cards, 0);
  document.getElementById("bjDealerTotal").textContent = r.dealer.revealed ? `Total: ${r.dealer.total}` : "";

  // Seats 1, 2, 3 in table order
  const seatsRow = document.getElementById("bjSeatsRow");
  seatsRow.innerHTML = "";
  for (let seat = 1; seat <= 3; seat++) {
    const isHuman = seat === r.humanSeat;
    const div = document.createElement("div");
    div.className = "bj-seat" + (isHuman ? " is-human" : "");
    if (isHuman && r.phase === "playing" && r.activeHandIndex !== undefined) div.classList.add("is-active");

    if (isHuman) {
      let html = `<div class="bj-seat-name">${icon("users", 14)} You (seat ${seat})</div>`;
      r.hands.forEach((h, i) => {
        const active = r.phase === "playing" && i === r.activeHandIndex;
        html += `<div class="bj-hand-group" style="${active ? 'outline:2px dashed #ffd778;border-radius:8px;padding:4px;' : ''}">
          <div class="bj-hand">${bjHandHtml(h.cards, 0)}</div>
          <div class="bj-total">${fmtMoney(h.bet)} — Total: ${h.total}${h.doubled ? " (doubled)" : ""}</div>
          ${h.status !== "playing" && r.results ? `<span class="bj-outcome ${bjOutcomeClass(r.results[i])}">${bjOutcomeLabel(r.results[i])}</span>` : ""}
        </div>`;
      });
      div.innerHTML = html;
    } else {
      const bot = r.bots[seat];
      let html = `<div class="bj-seat-name">${icon("users", 14)} ${bot.name}</div>`;
      bot.hands.forEach(h => {
        html += `<div class="bj-hand-group">
          <div class="bj-hand">${bjHandHtml(h.cards, 0)}</div>
          <div class="bj-total">Total: ${h.total}${h.bust ? " (bust)" : ""}${h.doubled ? " (doubled)" : ""}</div>
        </div>`;
      });
      div.innerHTML = html;
    }
    seatsRow.appendChild(div);
  }

  document.getElementById("bjInsuranceArea").classList.toggle("hidden", r.phase !== "insurance");
  document.getElementById("bjActionArea").classList.toggle("hidden", r.phase !== "playing");

  if (r.phase === "playing") {
    const hand = r.hands[r.activeHandIndex];
    const canDouble = hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces && !hand.cards.some(c => c.r === "A");
    const canSplit = hand.cards.length === 2 && !hand.isSplitAces && bjCardValueClient(hand.cards[0].r) === bjCardValueClient(hand.cards[1].r);
    document.getElementById("bjDoubleBtn").classList.toggle("hidden", !canDouble);
    document.getElementById("bjSplitBtn").classList.toggle("hidden", !canSplit);
  }
}

async function renderRecentBlackjack() {
  const cls = await getClassCached(CURRENT.classCode);
  const mine = cls.txns.filter(t => t.type === "gambling" && t.from === CURRENT.username && t.note.startsWith("Blackjack")).slice(0, 15);
  const box = document.getElementById("bjRecentBets");
  document.getElementById("bjNoBets").classList.toggle("hidden", mine.length > 0);
  box.innerHTML = "";
  mine.forEach(t => {
    const won = t.note.includes("WON");
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details">${icon("cards", 14)} ${t.note} <div class="muted-small">${t.date}</div></div>
      <div class="${won ? 'ticker-up' : 'ticker-down'}" style="font-weight:900;">${won ? "+" : "-"}${fmtMoney(t.amount)}</div>
    `;
    box.appendChild(row);
  });
}

async function saveBlackjackSettingsUI() {
  await saveBlackjackSettings(CURRENT.classCode, {
    enabled: document.getElementById("bjEnabled").checked,
    minBet: document.getElementById("bjMin").value,
    maxBet: document.getElementById("bjMax").value
  });
  document.getElementById("bjSettingsMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

/* ===================== Shared: mode switch, chrome, init, render ===================== */

function switchMode(mode) {
  MODE = mode;
  document.getElementById("modeBtnRoulette").classList.toggle("active", mode === "roulette");
  document.getElementById("modeBtnBlackjack").classList.toggle("active", mode === "blackjack");
  document.getElementById("rouletteSection").classList.toggle("hidden", mode !== "roulette");
  document.getElementById("blackjackSection").classList.toggle("hidden", mode !== "blackjack");
  document.getElementById("teacherRouletteSettings").classList.toggle("hidden", mode !== "roulette");
  document.getElementById("teacherBlackjackSettings").classList.toggle("hidden", mode !== "blackjack");
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("dice", 26) + " Gambling";
  document.getElementById("hSettings").innerHTML = icon("dice", 18) + " Roulette settings";
  document.getElementById("saveSettingsBtn").innerHTML = icon("bank", 14) + " Save settings";
  document.getElementById("labEnabled").textContent = "Allow students to gamble";
  document.getElementById("hDisabled").innerHTML = icon("dice", 20) + " Gambling is paused";
  document.getElementById("hBet").innerHTML = icon("dice", 18) + " Place a bet";
  document.getElementById("hRecent").innerHTML = icon("bank", 18) + " My recent bets";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);

  document.getElementById("bjHSettings").innerHTML = icon("cards", 18) + " Blackjack settings";
  document.getElementById("bjSaveSettingsBtn").innerHTML = icon("bank", 14) + " Save settings";
  document.getElementById("bjLabEnabled").textContent = "Allow students to play Blackjack";
  document.getElementById("bjHDisabled").innerHTML = icon("cards", 20) + " Blackjack is paused";
  document.getElementById("bjHTable").innerHTML = icon("cards", 18) + " Blackjack table";
  document.getElementById("bjHRecent").innerHTML = icon("bank", 18) + " My recent bets";
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
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    autoPayDayIfDue(u.classCode),
    processAutomations(u.classCode),
    processMortgages(u.classCode),
    processTermDeposits(u.classCode),
    autoInterestIfDue(u.classCode),
    processInsurancePayments(u.classCode),
    processWeeklyEvents(u.classCode),
    processWeeklyBigEvents(u.classCode)
  ]);
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
  switchMode("roulette");
}

async function render() {
  CLS = await getClassCached(CURRENT.classCode);
  const g = CLS.gambling;
  const bj = CLS.blackjack;

  if (IS_TEACHER) {
    document.getElementById("gEnabled").checked = g.enabled !== false;
    document.getElementById("gMin").value = g.minBet;
    document.getElementById("gMax").value = g.maxBet;
    document.getElementById("gDailyCap").value = g.dailyBetCap === null || g.dailyBetCap === undefined ? "" : g.dailyBetCap;
    document.getElementById("pStraight").value = g.payouts.straightUp;
    document.getElementById("pSplit").value = g.payouts.split;
    document.getElementById("pStreet").value = g.payouts.street;
    document.getElementById("pCorner").value = g.payouts.corner;
    document.getElementById("pSixLine").value = g.payouts.sixLine;
    document.getElementById("pOddEven").value = g.payouts.oddEven;

    document.getElementById("bjEnabled").checked = bj.enabled !== false;
    document.getElementById("bjMin").value = bj.minBet;
    document.getElementById("bjMax").value = bj.maxBet;
    return;
  }

  const lockedModules = await getLockedModulesForStudent(CURRENT.username, CURRENT.classCode);
  applyNavModuleLocks(lockedModules);
  const lockedBanner = document.getElementById("gamblingLockedBanner");
  if (lockedModules.includes("gambling")) {
    lockedBanner.classList.remove("hidden");
    lockedBanner.innerHTML = `<p style="margin:0;"><strong>Gambling is locked</strong><br>Your lifestyle rating is too low right now to place bets. Ask your teacher what's needed to unlock it.</p>`;
    document.getElementById("studentView").classList.add("hidden");
    return;
  }
  lockedBanner.classList.add("hidden");
  document.getElementById("studentView").classList.remove("hidden");

  /* ---- Roulette tab ---- */
  const rouletteEnabled = g.enabled !== false;
  document.getElementById("disabledBanner").classList.toggle("hidden", rouletteEnabled);
  document.getElementById("rouletteStudentView").classList.toggle("hidden", !rouletteEnabled);
  if (rouletteEnabled) {
    document.getElementById("betLimits").textContent = `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.`;
    const capEl = document.getElementById("dailyCapStatus");
    if (g.dailyBetCap) {
      const todayKey = nzDateKey();
      const betToday = CLS.txns
        .filter(t => t.type === "gambling" && t.from === CURRENT.username && nzDateKey(new Date(t.ts || 0)) === todayKey)
        .reduce((sum, t) => sum + (t.bet !== undefined ? t.bet : t.amount), 0);
      const remaining = Math.max(0, g.dailyBetCap - betToday);
      capEl.textContent = `Daily limit (shared with Blackjack): ${fmtMoney(g.dailyBetCap)} — you've bet ${fmtMoney(betToday)} today, ${fmtMoney(remaining)} left.`;
    } else {
      capEl.textContent = "";
    }
    renderPicker();
    await renderRecentRoulette();
  }

  /* ---- Blackjack tab ---- */
  const blackjackEnabled = g.enabled !== false && bj.enabled !== false;
  document.getElementById("bjDisabledBanner").classList.toggle("hidden", blackjackEnabled);
  document.getElementById("bjDisabledText").textContent = (g.enabled === false)
    ? "Your teacher has temporarily turned off the Gambling module. Check back later!"
    : "Your teacher has temporarily turned off Blackjack for this class. Check back later!";
  document.getElementById("bjStudentView").classList.toggle("hidden", !blackjackEnabled);
  if (blackjackEnabled) {
    document.getElementById("bjBetLimits").textContent = `Bets must be between ${fmtMoney(bj.minBet)} and ${fmtMoney(bj.maxBet)}.`;
    const bjCapEl = document.getElementById("bjDailyCapStatus");
    if (g.dailyBetCap) {
      const todayKey = nzDateKey();
      const betToday = CLS.txns
        .filter(t => t.type === "gambling" && t.from === CURRENT.username && nzDateKey(new Date(t.ts || 0)) === todayKey)
        .reduce((sum, t) => sum + (t.bet !== undefined ? t.bet : t.amount), 0);
      const remaining = Math.max(0, g.dailyBetCap - betToday);
      bjCapEl.textContent = `Daily limit (shared with Roulette): ${fmtMoney(g.dailyBetCap)} — you've bet ${fmtMoney(betToday)} today, ${fmtMoney(remaining)} left.`;
    } else {
      bjCapEl.textContent = "";
    }

    // Resume an in-progress Blackjack round if the page was refreshed
    // mid-hand — the bet is already escrowed server-side, so this just
    // re-shows it instead of losing it.
    const resumed = await getBlackjackRound(CURRENT.username);
    if (resumed) {
      document.getElementById("bjBetForm").classList.add("hidden");
      document.getElementById("bjTableArea").classList.remove("hidden");
      CURRENT_ROUND = resumed;
      renderBlackjackRound();
    } else {
      document.getElementById("bjBetForm").classList.remove("hidden");
      document.getElementById("bjTableArea").classList.add("hidden");
    }
    await renderRecentBlackjack();
  }
}

document.addEventListener("DOMContentLoaded", init);
