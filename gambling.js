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

  // Wrapped so ANY unexpected error (network hiccup, animation glitch,
  // etc.) still leaves the Spin button clickable again, instead of stuck
  // on "Spinning..." forever — the one thing that would look like the
  // page had crashed.
  try {
    const res = await placeRouletteBet(CURRENT.username, CURRENT.classCode, type, amount, selection);
    if (!res.ok) {
      box.innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }

    await showRouletteAnimation(res.spin);

    box.innerHTML = res.win
      ? `<div class="success-msg">Ball landed on ${res.spin}. You WON ${fmtMoney(res.netChange)}!</div>`
      : `<div class="error-msg">Ball landed on ${res.spin}. You lost ${fmtMoney(Math.abs(res.netChange))}.</div>`;
    document.getElementById("betAmount").value = "";
    await render();
  } catch (e) {
    document.getElementById("wheelOverlay")?.remove();
    box.innerHTML = `<div class="error-msg">Something went wrong placing that bet. Please try again.</div>`;
  } finally {
    spinBtn.disabled = false;
    spinBtn.innerHTML = "Spin the wheel";
  }
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
// CURRENT_ROUND holds the true, authoritative round state from the server
// (already fully resolved — bots and dealer are computed in one shot).
// The DISPLAY_* variables are a separate, deliberately "behind" copy used
// purely for the seat-by-seat reveal animation, so the player never sees
// a card, a bot's result, or the dealer's hand before its actual turn in
// table order (1 → 2 → 3 → dealer) comes up.
let CURRENT_ROUND = null;
let DISPLAY_BOTS = {};
let DISPLAY_DEALER = { cards: [], revealed: false, total: null };
let DISPLAY_HUMAN_HANDS = null; // null = "just use CURRENT_ROUND.hands" (live, once it's the human's actual turn)
let ACTIVE_SEAT = null;         // 1, 2, 3, "dealer", or null — drives the highlight + "playing..." caption
let SHOW_RESULTS = false;       // withheld until the dealer's hand has finished animating in
let DEAL_TOKEN = 0;             // bumped on every new deal/resume so a stale animation loop can detect it's obsolete and stop

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
const BJ_CARD_DELAY = 500; // ms between each card appearing
const BJ_SEAT_PAUSE = 400; // ms pause after a seat finishes, before the next seat's turn starts

async function bjDeal() {
  const box = document.getElementById("bjBetMsg");
  const btn = document.getElementById("bjDealBtn");

  // The whole flow (server call + reveal animation) is wrapped so that any
  // unexpected error surfaces as a message and resets the table, rather
  // than leaving the Deal button disabled and the table half-drawn forever.
  // Element lookups now happen inside the try too — previously a null
  // element here would throw before the try block even started, leaving
  // the Deal button stuck disabled with no error shown and no way to
  // recover except a full page reload.
  try {
    const amount = document.getElementById("bjBetAmount").value;
    if (box) box.innerHTML = "";
    if (btn) { btn.disabled = true; btn.textContent = "Dealing..."; }

    const res = await startBlackjackRound(CURRENT.username, CURRENT.classCode, amount);
    if (!res.ok) {
      if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    CURRENT_ROUND = res.round;
    document.getElementById("bjBetForm").classList.add("hidden");
    document.getElementById("bjTableArea").classList.remove("hidden");
    document.getElementById("bjNewRoundBtn").classList.add("hidden");
    document.getElementById("bjRoundMsg").innerHTML = "";

    const token = ++DEAL_TOKEN;
    await bjAnimateInitialDeal(CURRENT_ROUND, token);
    if (token !== DEAL_TOKEN) return; // a resume/new deal happened while we were animating

    // Insurance (when offered) is a table-wide decision made right after the
    // deal, before ANYONE's turn — including seats before the human — so it
    // must be handled before the seat-by-seat turn sequence starts, not
    // folded into it.
    if (CURRENT_ROUND.phase === "insurance") {
      ACTIVE_SEAT = CURRENT_ROUND.humanSeat;
      renderBlackjackRound(bjBuildDisplayRound());
      document.getElementById("bjInsuranceArea").classList.remove("hidden");
      return; // waits for bjDoInsurance()
    }
    await bjRunTurnSequence(CURRENT_ROUND, 1, token);
  } catch (e) {
    document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">Something went wrong dealing that round. If your balance looks off, refresh the page — any escrowed bet is automatically refunded on failure.</div>`;
    await bjResetTable();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "Deal"; }
  }
}

async function bjDoInsurance(take) {
  const insuranceBtns = document.querySelectorAll("#bjInsuranceArea button");
  insuranceBtns.forEach(b => b.disabled = true);
  try {
    const res = await blackjackInsurance(CURRENT.username, CURRENT.classCode, take);
    if (!res.ok) {
      document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    CURRENT_ROUND = res.round;
    document.getElementById("bjInsuranceArea").classList.add("hidden");
    const token = DEAL_TOKEN;

    const dealerHadBlackjack = CURRENT_ROUND.hands[0].status === "push" || CURRENT_ROUND.hands[0].status === "lost-to-dealer-blackjack";
    if (CURRENT_ROUND.phase === "done" && dealerHadBlackjack) {
      // The dealer had Blackjack — real casino rules end the round for the
      // WHOLE table right here, before seat 1 (or anyone) gets a turn. So
      // skip the turn sequence entirely and just reveal the dealer's hand.
      ACTIVE_SEAT = "dealer";
      await bjAnimateDealerTurn(CURRENT_ROUND, token);
      if (token !== DEAL_TOKEN) return;
      ACTIVE_SEAT = null;
      await bjFinalizeRound(CURRENT_ROUND);
      return;
    }

    // Otherwise table play proceeds normally, starting at seat 1 — this also
    // correctly covers the player having their own Blackjack (and the
    // dealer not): that seat is simply skipped with nothing to decide,
    // while every other seat still gets a normal turn.
    await bjRunTurnSequence(CURRENT_ROUND, 1, token);
  } catch (e) {
    document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">Something went wrong resolving insurance. Please refresh the page.</div>`;
  } finally {
    insuranceBtns.forEach(b => b.disabled = false);
  }
}

const BJ_ACTION_BTN_IDS = ["bjHitBtn", "bjStandBtn", "bjDoubleBtn", "bjSplitBtn"];

// Small helper used throughout the Blackjack UI: a null-safe batch
// enable/disable that never throws even if an id is momentarily missing
// from the DOM (e.g. a render happening mid-click). Previously several
// spots here did document.getElementById(id).disabled = ... directly,
// OUTSIDE any try/catch — if that lookup ever came back null the whole
// click handler threw immediately, before it even reached its own
// try/finally, so the buttons it had just set to disabled=true were
// never re-enabled. That's the "occasionally clicking does nothing" bug:
// one bad click silently left the action buttons permanently disabled
// for the rest of the round.
function bjSetButtonsDisabled(ids, disabled) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

async function bjDoAction(action) {
  // Wrapped so a failed hit/stand/double/split always leaves the action
  // buttons clickable again instead of stuck disabled — previously any
  // unexpected error here (e.g. a rejected request) left the table
  // permanently unresponsive until a full page reload.
  try {
    bjSetButtonsDisabled(BJ_ACTION_BTN_IDS, true);
    const res = await blackjackAction(CURRENT.username, CURRENT.classCode, action);
    const token = DEAL_TOKEN;
    if (!res.ok) {
      document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    CURRENT_ROUND = res.round;
    if (CURRENT_ROUND.phase === "playing") {
      // Still your turn (e.g. another card, or a fresh split hand to play).
      renderBlackjackRound(bjBuildDisplayRound());
      bjUpdateActionButtons();
    } else {
      document.getElementById("bjActionArea")?.classList.add("hidden");
      await bjRunRemainingSeats(CURRENT_ROUND, CURRENT_ROUND.humanSeat + 1, token);
    }
  } catch (e) {
    document.getElementById("bjRoundMsg").innerHTML = `<div class="error-msg">Something went wrong with that action. Please refresh the page — any stake taken for it is automatically refunded on failure.</div>`;
  } finally {
    bjSetButtonsDisabled(BJ_ACTION_BTN_IDS, false);
  }
}

// Plays the seat-by-seat reveal animation for every seat AFTER the human
// (their outcomes are already decided server-side — this just shows them
// in the right order), then the dealer, then finally reveals the results.
async function bjRunRemainingSeats(round, fromSeat, token) {
  await bjRunTurnSequence(round, fromSeat, token);
}

// Deliberately does NOT hide the table or reset the bet form — the player
// should still see the finished hands until they choose "New round".
async function bjFinalizeRound(round) {
  SHOW_RESULTS = true;
  renderBlackjackRound(bjBuildDisplayRound());
  document.getElementById("bjNewRoundBtn").classList.remove("hidden");
  document.getElementById("bjRoundMsg").innerHTML = round.netChange >= 0
    ? `<div class="success-msg">You WON ${fmtMoney(round.netChange)} this round!</div>`
    : `<div class="error-msg">You lost ${fmtMoney(Math.abs(round.netChange))} this round.</div>`;
  CLS = await getClassCached(CURRENT.classCode);
  await renderRecentBlackjack();
}

async function bjResetTable() {
  DEAL_TOKEN++; // invalidate any in-flight animation loop
  CURRENT_ROUND = null;
  document.getElementById("bjBetAmount").value = "";
  document.getElementById("bjBetForm").classList.remove("hidden");
  document.getElementById("bjTableArea").classList.add("hidden");
  document.getElementById("bjNewRoundBtn").classList.add("hidden");
  try {
    await render();
  } catch (e) {
    // The table itself is already reset above even if the follow-up
    // refresh fails — worst case the student just sees slightly stale
    // balances/limits until their next action or page load.
  }
}

// Tracks which "card slots" (dealer-0, human-1-2, seat3-b0-1, etc.) have
// already been drawn once, so a card only ever plays its fade-in the
// first time it appears — every later re-render of the same hand (which
// happens a lot: once per sleep() step during the reveal, plus whenever
// the player clicks an action) renders that card statically instead of
// restarting its animation. Reset at the start of a fresh deal; see
// bjAnimateInitialDeal and bjShowRoundStatic.
let _bjAnimatedCardKeys = new Set();
// Set true only while replaying an already-finished round with no
// animation at all (resuming after a page refresh) — every card in that
// round should appear instantly, none of them "new".
let _bjSuppressCardAnim = false;

function bjSuitSymbol(s) { return { S: "♠", H: "♥", D: "♦", C: "♣" }[s] || s; }
function bjCardHtml(card, faceDown, key) {
  const isNew = !!key && !_bjSuppressCardAnim && !_bjAnimatedCardKeys.has(key);
  if (key) _bjAnimatedCardKeys.add(key);
  const animClass = isNew ? " bj-card-in" : "";
  if (faceDown) return `<div class="bj-card face-down${animClass}"></div>`;
  const red = card.s === "H" || card.s === "D";
  return `<div class="bj-card ${red ? "red" : "black"}${animClass}">${card.r}${bjSuitSymbol(card.s)}</div>`;
}
function bjHandHtml(cards, faceDownCount, keyPrefix) {
  return cards.map((c, i) => bjCardHtml(c, faceDownCount && i >= cards.length - faceDownCount, keyPrefix ? `${keyPrefix}-${i}` : null)).join("");
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

/* ---- Deal / turn animation ---- */

// Deals the very first two cards to everyone in real table order — seat 1,
// seat 2, seat 3, dealer's up-card, then seat 1, 2, 3 again, then the
// dealer's hidden hole card — one card at a time with a short pause, so
// it visually reads exactly like a real dealer working around the table.
async function bjAnimateInitialDeal(round, token) {
  _bjAnimatedCardKeys = new Set(); // fresh deal — every card slot is new again
  DISPLAY_BOTS = {};
  DISPLAY_DEALER = { cards: [], revealed: false, total: null };
  DISPLAY_HUMAN_HANDS = [{ cards: [], bet: round.hands[0].bet, doubled: false, isSplitAces: false, status: "playing", total: 0 }];
  ACTIVE_SEAT = null;
  SHOW_RESULTS = false;
  [1, 2, 3].forEach(seat => {
    if (seat !== round.humanSeat) DISPLAY_BOTS[seat] = { name: round.bots[seat].name, hands: [{ cards: [], total: null, bust: false, doubled: false }] };
  });

  const seatCardOf = (seat, idx) => (seat === round.humanSeat ? round.hands[0].cards[idx] : round.bots[seat].hands[0].cards[idx]);
  const steps = [
    { seat: 1, idx: 0 }, { seat: 2, idx: 0 }, { seat: 3, idx: 0 }, { seat: "dealer", idx: 0 },
    { seat: 1, idx: 1 }, { seat: 2, idx: 1 }, { seat: 3, idx: 1 }, { seat: "dealer", idx: 1, hidden: true }
  ];

  renderBlackjackRound(bjBuildDisplayRound());
  for (const step of steps) {
    if (token !== DEAL_TOKEN) return;
    await sleep(BJ_CARD_DELAY);
    if (token !== DEAL_TOKEN) return;
    if (step.seat === "dealer") {
      DISPLAY_DEALER.cards.push(round.dealer.cards[step.idx] || round.dealer.up);
    } else if (step.seat === round.humanSeat) {
      DISPLAY_HUMAN_HANDS[0].cards.push(seatCardOf(step.seat, step.idx));
    } else {
      DISPLAY_BOTS[step.seat].hands[0].cards.push(seatCardOf(step.seat, step.idx));
    }
    renderBlackjackRound(bjBuildDisplayRound());
  }
}

// Walks seats fromSeat..3 in order. A bot seat auto-plays its (already
// server-decided) turn with a card-by-card reveal; the human seat pauses
// here for real input (hit/stand/double/split — insurance, when offered,
// is always resolved before this function is first called) — the loop is
// resumed later, from humanSeat+1, once the server confirms the human's
// hands are all finished. Once every seat is done, the dealer's turn
// animates and the round is finalized.
async function bjRunTurnSequence(round, fromSeat, token) {
  for (let seat = fromSeat; seat <= 3; seat++) {
    if (token !== DEAL_TOKEN) return;
    // Slight pause before every seat's turn starts — including right
    // after the human's own turn resolves, which previously had no gap
    // at all (bjRunRemainingSeats used to jump straight into the next
    // seat's card reveal the instant the human's action came back).
    await sleep(BJ_SEAT_PAUSE);
    if (token !== DEAL_TOKEN) return;
    if (seat === round.humanSeat) {
      DISPLAY_HUMAN_HANDS = null; // switch to live CURRENT_ROUND.hands from here on
      ACTIVE_SEAT = seat;

      if (round.phase === "playing" && round.hands.some(h => h.status === "playing")) {
        renderBlackjackRound(bjBuildDisplayRound());
        document.getElementById("bjActionArea").classList.remove("hidden");
        bjUpdateActionButtons();
        return; // waits for bjDoAction()
      }
      // Nothing to decide (e.g. an instant natural blackjack with no
      // insurance offered) — show it briefly, then move straight on.
      renderBlackjackRound(bjBuildDisplayRound());
      await sleep(BJ_SEAT_PAUSE);
      continue;
    }
    await bjAnimateBotTurn(round, seat, token);
    if (token !== DEAL_TOKEN) return;
  }
  ACTIVE_SEAT = "dealer";
  await sleep(BJ_SEAT_PAUSE); // same slight pause before the dealer's turn
  if (token !== DEAL_TOKEN) return;
  await bjAnimateDealerTurn(round, token);
  if (token !== DEAL_TOKEN) return;
  ACTIVE_SEAT = null;
  await bjFinalizeRound(round);
}

// Reveals one bot's final (already-decided) hand(s) card by card — the
// initial two cards are already showing from the deal animation, so this
// only adds anything drawn after that (hits, doubles, or extra hands from
// a split).
async function bjAnimateBotTurn(round, seat, token) {
  ACTIVE_SEAT = seat;
  const finalBot = round.bots[seat];
  if (!DISPLAY_BOTS[seat]) DISPLAY_BOTS[seat] = { name: finalBot.name, hands: [{ cards: [], total: null, bust: false, doubled: false }] };
  renderBlackjackRound(bjBuildDisplayRound());

  const steps = [];
  finalBot.hands.forEach((h, hi) => {
    const startIdx = hi === 0 ? (DISPLAY_BOTS[seat].hands[0].cards.length || 0) : 0;
    for (let ci = startIdx; ci < h.cards.length; ci++) steps.push({ hi, ci });
  });

  for (const step of steps) {
    if (token !== DEAL_TOKEN) return;
    await sleep(BJ_CARD_DELAY);
    if (token !== DEAL_TOKEN) return;
    while (DISPLAY_BOTS[seat].hands.length <= step.hi) DISPLAY_BOTS[seat].hands.push({ cards: [], total: null, bust: false, doubled: false });
    DISPLAY_BOTS[seat].hands[step.hi].cards.push(finalBot.hands[step.hi].cards[step.ci]);
    renderBlackjackRound(bjBuildDisplayRound());
  }
  DISPLAY_BOTS[seat] = finalBot; // finalize with real totals/bust/doubled flags
  renderBlackjackRound(bjBuildDisplayRound());
  await sleep(BJ_SEAT_PAUSE);
}

// Reveals the dealer's hole card, then hits (one card at a time) until
// the dealer's final total from the server is reached.
async function bjAnimateDealerTurn(round, token) {
  if (token !== DEAL_TOKEN) return;
  DISPLAY_DEALER = { cards: [round.dealer.cards[0], round.dealer.cards[1]], revealed: true, total: null };
  renderBlackjackRound(bjBuildDisplayRound());
  await sleep(BJ_CARD_DELAY);
  for (let i = 2; i < round.dealer.cards.length; i++) {
    if (token !== DEAL_TOKEN) return;
    DISPLAY_DEALER.cards.push(round.dealer.cards[i]);
    renderBlackjackRound(bjBuildDisplayRound());
    await sleep(BJ_CARD_DELAY);
  }
  DISPLAY_DEALER = round.dealer; // finalize (adds the real total)
  renderBlackjackRound(bjBuildDisplayRound());
  await sleep(BJ_SEAT_PAUSE);
}

// Shows an already-in-progress round with no reveal animation — used only
// when resuming after a page refresh, where replaying the whole deal
// would be a confusing surprise rather than a genuine new deal.
function bjShowRoundStatic(round) {
  DEAL_TOKEN++; // make sure no stale animation loop can interfere
  DISPLAY_BOTS = round.bots;
  DISPLAY_DEALER = round.dealer;
  DISPLAY_HUMAN_HANDS = null;
  ACTIVE_SEAT = (round.phase === "playing" || round.phase === "insurance") ? round.humanSeat : null;
  SHOW_RESULTS = round.phase === "done";
  _bjSuppressCardAnim = true; // resuming after a refresh — every card appears instantly, none of them "new"
  renderBlackjackRound(bjBuildDisplayRound());
  _bjSuppressCardAnim = false;
  if (round.phase === "insurance") document.getElementById("bjInsuranceArea").classList.remove("hidden");
  if (round.phase === "playing") { document.getElementById("bjActionArea").classList.remove("hidden"); bjUpdateActionButtons(); }
  if (round.phase === "done") {
    document.getElementById("bjNewRoundBtn").classList.remove("hidden");
    document.getElementById("bjRoundMsg").innerHTML = round.netChange >= 0
      ? `<div class="success-msg">You WON ${fmtMoney(round.netChange)} this round!</div>`
      : `<div class="error-msg">You lost ${fmtMoney(Math.abs(round.netChange))} this round.</div>`;
  }
}

function bjUpdateActionButtons() {
  const r = CURRENT_ROUND;
  if (r.phase !== "playing") return;
  const hand = r.hands[r.activeHandIndex];
  const canDouble = hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces && !hand.cards.some(c => c.r === "A");
  const canSplit = hand.cards.length === 2 && !hand.isSplitAces && bjCardValueClient(hand.cards[0].r) === bjCardValueClient(hand.cards[1].r);
  document.getElementById("bjDoubleBtn").classList.toggle("hidden", !canDouble);
  document.getElementById("bjSplitBtn").classList.toggle("hidden", !canSplit);
}

// Builds the object actually handed to renderBlackjackRound() — mixes the
// server's true CURRENT_ROUND (for things that are never animated, like
// the bet amount and insurance state) with the DISPLAY_* "reveal so far"
// state for the parts being animated in.
function bjBuildDisplayRound() {
  return {
    phase: CURRENT_ROUND.phase,
    humanSeat: CURRENT_ROUND.humanSeat,
    botSeats: CURRENT_ROUND.botSeats,
    bots: DISPLAY_BOTS,
    dealer: DISPLAY_DEALER,
    insurance: CURRENT_ROUND.insurance,
    hands: DISPLAY_HUMAN_HANDS || CURRENT_ROUND.hands,
    activeHandIndex: CURRENT_ROUND.activeHandIndex,
    results: SHOW_RESULTS ? CURRENT_ROUND.results : null,
    activeSeat: ACTIVE_SEAT
  };
}

function renderBlackjackRound(r) {
  // Dealer
  const dealerHidden = !r.dealer.revealed;
  const dealerHandEl = document.getElementById("bjDealerHand");
  if (dealerHandEl) {
    dealerHandEl.innerHTML = r.dealer.cards.length
      ? (dealerHidden
          ? bjCardHtml(r.dealer.cards[0], false, "dealer-0") + (r.dealer.cards.length > 1 || CURRENT_ROUND.dealer.revealed === false ? bjCardHtml(null, true, "dealer-hole") : "")
          : bjHandHtml(r.dealer.cards, 0, "dealer"))
      : "";
  }
  const dealerTotalEl = document.getElementById("bjDealerTotal");
  if (dealerTotalEl) dealerTotalEl.textContent = r.dealer.revealed && r.dealer.total !== null ? `Total: ${r.dealer.total}` : "";

  // Seats 1, 2, 3 in table order
  const seatsRow = document.getElementById("bjSeatsRow");
  if (seatsRow) {
    seatsRow.innerHTML = "";
    for (let seat = 1; seat <= 3; seat++) {
      const isHuman = seat === r.humanSeat;
      const div = document.createElement("div");
      div.className = "bj-seat" + (isHuman ? " is-human" : "");
      if (r.activeSeat === seat) div.classList.add("is-active");

      const playingCaption = (r.activeSeat === seat && !isHuman) ? `<div class="bj-playing-tag">Playing...</div>` : "";

      if (isHuman) {
        let html = `<div class="bj-seat-name">${icon("users", 14)} You (seat ${seat})</div>`;
        (r.hands || []).forEach((h, i) => {
          const active = r.phase === "playing" && r.activeSeat === seat && i === r.activeHandIndex;
          html += `<div class="bj-hand-group" style="${active ? 'outline:2px dashed #ffd778;border-radius:8px;padding:4px;' : ''}">
            <div class="bj-hand">${bjHandHtml(h.cards, 0, `human-${i}`)}</div>
            ${h.cards.length ? `<div class="bj-total">${fmtMoney(h.bet)} — Total: ${h.total}${h.doubled ? " (doubled)" : ""}</div>` : ""}
            ${h.status !== "playing" && r.results ? `<span class="bj-outcome ${bjOutcomeClass(r.results[i])}">${bjOutcomeLabel(r.results[i])}</span>` : ""}
          </div>`;
        });
        div.innerHTML = html;
      } else {
        const bot = r.bots[seat];
        let html = `<div class="bj-seat-name">${icon("users", 14)} ${bot.name}</div>${playingCaption}`;
        bot.hands.forEach((h, hi) => {
          html += `<div class="bj-hand-group">
            <div class="bj-hand">${bjHandHtml(h.cards, 0, `seat${seat}-b${hi}`)}</div>
            ${h.cards.length && h.total !== null ? `<div class="bj-total">Total: ${h.total}${h.bust ? " (bust)" : ""}${h.doubled ? " (doubled)" : ""}</div>` : ""}
          </div>`;
        });
        div.innerHTML = html;
      }
      seatsRow.appendChild(div);
    }
  }

  if (r.phase !== "insurance") document.getElementById("bjInsuranceArea")?.classList.add("hidden");
  if (r.phase !== "playing" || r.activeSeat !== r.humanSeat) document.getElementById("bjActionArea")?.classList.add("hidden");
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

// Blackjack needs real horizontal space for the dealer row + 3 seats
// side-by-side, so it's landscape-only on narrow/mobile screens. Rather
// than listening for orientationchange/resize in JS to toggle this, the
// prompt is injected once here and left entirely to a CSS media query
// (see blackjack.css) — the browser re-evaluates that instantly on
// rotation, so there's no listener to maintain and no risk of it getting
// out of sync with the actual screen orientation.
function mountBjRotatePrompt() {
  const container = document.getElementById("bjStudentView");
  if (!container || document.getElementById("bjRotatePrompt")) return;
  const prompt = document.createElement("div");
  prompt.id = "bjRotatePrompt";
  prompt.className = "bj-rotate-prompt";
  prompt.innerHTML = `
    <div class="bj-rotate-icon"></div>
    <h3>Rotate your device</h3>
    <p class="muted-small">Blackjack needs a landscape screen so the whole table fits. Turn your phone or tablet sideways to keep playing.</p>
  `;
  container.insertBefore(prompt, container.firstChild);
}

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
  mountBjRotatePrompt();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processMortgages(u.classCode), "processMortgages"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
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
    // re-shows it (statically, no reveal animation) instead of losing it.
    const resumed = await getBlackjackRound(CURRENT.username);
    if (resumed) {
      document.getElementById("bjBetForm").classList.add("hidden");
      document.getElementById("bjTableArea").classList.remove("hidden");
      CURRENT_ROUND = resumed;
      bjShowRoundStatic(resumed);
    } else {
      document.getElementById("bjBetForm").classList.remove("hidden");
      document.getElementById("bjTableArea").classList.add("hidden");
    }
    await renderRecentBlackjack();
  }
}

document.addEventListener("DOMContentLoaded", init);
