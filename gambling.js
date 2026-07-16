let CURRENT, IS_TEACHER, CLS;
let selection = [];

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

    let numbersHtml = "";
    WHEEL_ORDER.forEach((n, i) => {
      const angle = i * seg + seg / 2;
      numbersHtml += `<div class="wheel-number" style="transform:rotate(${angle}deg) translate(0,-165px) rotate(${-angle}deg);background:${wheelPocketColor(n)};">${n}</div>`;
    });

    const overlay = document.createElement("div");
    overlay.className = "anw-modal-overlay";
    overlay.id = "wheelOverlay";
    overlay.innerHTML = `
      <div class="anw-modal-card" style="text-align:center;max-width:500px;">
        <h2 style="display:flex;align-items:center;justify-content:center;gap:9px;">${icon("dice", 24)} Spinning the wheel...</h2>
        <div class="wheel-stage">
          <div class="wheel-pointer"></div>
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

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("dice", 26) + " Gambling — Roulette";
  document.getElementById("hSettings").innerHTML = icon("dice", 18) + " Roulette settings";
  document.getElementById("saveSettingsBtn").innerHTML = icon("bank", 14) + " Save settings";
  document.getElementById("hBet").innerHTML = icon("dice", 18) + " Place a bet";
  document.getElementById("hRecent").innerHTML = icon("bank", 18) + " My recent bets";
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
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processInsurancePayments(u.classCode);
  await processWeeklyEvents(u.classCode);
  await processWeeklyBigEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  CLS = await getClass(CURRENT.classCode);
  const g = CLS.gambling;

  if (IS_TEACHER) {
    document.getElementById("gMin").value = g.minBet;
    document.getElementById("gMax").value = g.maxBet;
    document.getElementById("pStraight").value = g.payouts.straightUp;
    document.getElementById("pSplit").value = g.payouts.split;
    document.getElementById("pStreet").value = g.payouts.street;
    document.getElementById("pCorner").value = g.payouts.corner;
    document.getElementById("pSixLine").value = g.payouts.sixLine;
    document.getElementById("pOddEven").value = g.payouts.oddEven;
  } else {
    document.getElementById("betLimits").textContent = `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.`;
    renderPicker();
    await renderRecent();
  }
}

function neededCount(type) {
  return { straightUp: 1, split: 2, street: 3, corner: 4, sixLine: 6, oddEven: 0 }[type];
}

function renderPicker() {
  selection = [];
  const type = document.getElementById("betType").value;
  const area = document.getElementById("pickerArea");

  if (type === "oddEven") {
    area.innerHTML = `
      <div class="row-flex" style="gap:10px;">
        <button class="btn secondary" onclick="pickOddEven('odd')" id="pickOdd">Odd</button>
        <button class="btn secondary" onclick="pickOddEven('even')" id="pickEven">Even</button>
      </div>
    `;
    return;
  }

  const need = neededCount(type);
  area.innerHTML = `
    <p class="muted-small">Pick ${need} number${need === 1 ? "" : "s"}${type === "straightUp" ? " (0-36)" : " (1-36 — invalid combos will be rejected)"}. Selected: <span id="pickCount">0</span>/${need}</p>
    <div id="numberGrid" class="number-grid"></div>
  `;
  const grid = document.getElementById("numberGrid");
  const nums = type === "straightUp" ? [0, ...Array.from({ length: 36 }, (_, i) => i + 1)] : Array.from({ length: 36 }, (_, i) => i + 1);
  nums.forEach(n => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "number-cell" + (n === 0 ? " zero" : (n % 2 === 0 ? " even-cell" : " odd-cell"));
    btn.textContent = n;
    btn.onclick = () => toggleNumber(n, need);
    btn.id = "num-" + n;
    grid.appendChild(btn);
  });
}

function pickOddEven(which) {
  selection = [which];
  document.getElementById("pickOdd").classList.toggle("gold", which === "odd");
  document.getElementById("pickEven").classList.toggle("gold", which === "even");
}

function toggleNumber(n, need) {
  const idx = selection.indexOf(n);
  if (idx >= 0) {
    selection.splice(idx, 1);
  } else {
    if (selection.length >= need) selection.shift(); // drop oldest pick once full
    selection.push(n);
  }
  document.querySelectorAll(".number-cell").forEach(el => el.classList.remove("selected"));
  selection.forEach(n2 => {
    const el = document.getElementById("num-" + n2);
    if (el) el.classList.add("selected");
  });
  const countEl = document.getElementById("pickCount");
  if (countEl) countEl.textContent = selection.length;
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
  await renderRecent();
}

async function renderRecent() {
  const cls = await getClass(CURRENT.classCode);
  const mine = cls.txns.filter(t => t.type === "gambling" && t.from === CURRENT.username).slice(0, 15);
  const box = document.getElementById("recentBets");
  document.getElementById("noBets").classList.toggle("hidden", mine.length > 0);
  box.innerHTML = "";
  mine.forEach(t => {
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `<div class="auto-details">${icon("dice", 14)} ${t.note} <div class="muted-small">${t.date}</div></div>`;
    box.appendChild(row);
  });
}

async function saveSettings() {
  await saveGamblingSettings(CURRENT.classCode, {
    minBet: document.getElementById("gMin").value,
    maxBet: document.getElementById("gMax").value,
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

document.addEventListener("DOMContentLoaded", init);