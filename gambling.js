/* ===================== The 29 World — Gambling (Roulette) ===================== */

let CURRENT, CLASS_CODE, IS_TEACHER;
let CURRENT_SELECTION = [];

// European wheel pocket order, clockwise starting at 0.
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const SEG = 360 / WHEEL_ORDER.length;

function pocketColor(n) {
  if (n === 0) return "#3fbf8f";
  return RED_NUMBERS.has(n) ? "#e8735f" : "#20232b";
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("dice", 26) + " Gambling — Roulette";
  document.getElementById("hSettings").innerHTML = icon("dice", 18) + " Roulette settings";
  document.getElementById("saveSettingsBtn").innerHTML = icon("bank", 14) + " Save settings";
  document.getElementById("hBet").innerHTML = icon("dice", 18) + " Place a bet";
  document.getElementById("spinBtn").innerHTML = icon("dice", 15) + " Spin the wheel";
  document.getElementById("hRecent").innerHTML = icon("chart", 18) + " My recent bets";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  CLASS_CODE = u.classCode;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  await autoPayDayIfDue(CLASS_CODE);
  await processAutomations(CLASS_CODE);
  await processMortgages(CLASS_CODE);
  await processTermDeposits(CLASS_CODE);
  await autoInterestIfDue(CLASS_CODE);
  await processInsurancePayments(CLASS_CODE);
  await processWeeklyEvents(CLASS_CODE);
  await processWeeklyBigEvents(CLASS_CODE);
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
  await checkBigEventPopup(CURRENT.username, CLASS_CODE);
  if (!IS_TEACHER) renderPicker();
  await render();
}

async function render() {
  const cls = await getClass(CLASS_CODE);
  const g = cls.gambling;

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
    document.getElementById("betLimits").textContent =
      `Bets must be between ${fmtMoney(g.minBet)} and ${fmtMoney(g.maxBet)}.`;

    const mine = cls.txns.filter(t => t.type === "gambling" && t.from === CURRENT.username).slice(0, 15);
    const box = document.getElementById("recentBets");
    document.getElementById("noBets").classList.toggle("hidden", mine.length > 0);
    box.innerHTML = mine.map(t => {
      const won = t.note.includes("WON");
      return `
        <div class="auto-row">
          <div class="auto-details">${icon("dice", 14)} ${t.note}</div>
          <div class="${won ? 'ticker-up' : 'ticker-down'}" style="font-weight:900;">${won ? "+" : "-"}${fmtMoney(t.amount)}</div>
        </div>
      `;
    }).join("");
  }
}

async function saveSettings() {
  await saveGamblingSettings(CLASS_CODE, {
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

/* ---------------- Bet picker ---------------- */
function renderPicker() {
  const type = document.getElementById("betType").value;
  const box = document.getElementById("pickerArea");
  CURRENT_SELECTION = [];

  if (type === "straightUp") {
    box.innerHTML = `
      <label for="pickNum">Number (0-36)</label>
      <input id="pickNum" type="number" min="0" max="36" step="1" style="max-width:140px;">
    `;
  } else if (type === "oddEven") {
    box.innerHTML = `
      <label for="pickOddEven">Choice</label>
      <select id="pickOddEven" style="max-width:160px;">
        <option value="odd">Odd</option>
        <option value="even">Even</option>
      </select>
    `;
  } else {
    const hints = {
      split: "e.g. 5,6 — two numbers next to each other on the table",
      street: "e.g. 7,8,9 — a full row of three",
      corner: "e.g. 8,9,11,12 — a 2×2 block of four",
      sixLine: "e.g. 7,8,9,10,11,12 — two adjacent rows of three"
    };
    box.innerHTML = `
      <label for="pickNums">Numbers (comma separated)</label>
      <input id="pickNums" placeholder="${hints[type]}">
      <p class="muted-small">${hints[type]}</p>
    `;
  }
}

function readSelection() {
  const type = document.getElementById("betType").value;
  if (type === "straightUp") {
    const v = document.getElementById("pickNum").value;
    return [Number(v)];
  }
  if (type === "oddEven") {
    return [document.getElementById("pickOddEven").value];
  }
  const raw = document.getElementById("pickNums").value || "";
  return raw.split(",").map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
}

/* ---------------- Wheel widget ---------------- */
function buildWheelSVG() {
  const cx = 160, cy = 160;
  const outerR = 145, innerR = 100, ballR = 122;
  let pockets = "";
  WHEEL_ORDER.forEach((n, i) => {
    const angle = i * SEG; // 0deg = top, clockwise
    const color = pocketColor(n);
    pockets += `
      <g transform="rotate(${angle} ${cx} ${cy})">
        <path d="M ${cx} ${cy - innerR}
                 L ${cx - Math.sin(SEG * Math.PI / 180) * outerR} ${cy - Math.cos(SEG * Math.PI / 180) * outerR}
                 A ${outerR} ${outerR} 0 0 1 ${cx} ${cy - outerR} Z"
              fill="${color}" stroke="#0e1016" stroke-width="1"
              transform="rotate(${-SEG / 2} ${cx} ${cy})"/>
        <text x="${cx}" y="${cy - (innerR + outerR) / 2 + 4}" text-anchor="middle"
              font-size="10" font-weight="700" fill="#fff">${n}</text>
      </g>
    `;
  });

  return `
    <svg viewBox="0 0 320 320" width="260" height="260" style="display:block;margin:0 auto;">
      <circle cx="${cx}" cy="${cy}" r="${outerR + 6}" fill="#0e1016"/>
      <g id="wheelSpin" style="transform-origin:${cx}px ${cy}px;">
        ${pockets}
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#161a22" stroke="#3a3f4c" stroke-width="2"/>
      </g>
      <g id="ballSpin" style="transform-origin:${cx}px ${cy}px;">
        <circle cx="${cx}" cy="${cy - ballR}" r="7" fill="#fff9e6" stroke="#8a7a3a" stroke-width="1.5"/>
      </g>
      <polygon points="${cx - 7},4 ${cx + 7},4 ${cx},18" fill="#f2c14e" stroke="#0e1016" stroke-width="1"/>
    </svg>
  `;
}

function animateWheel(winningNumber, durationMs) {
  return new Promise(resolve => {
    const idx = WHEEL_ORDER.indexOf(winningNumber);
    const wheelEl = document.getElementById("wheelSpin");
    const ballEl = document.getElementById("ballSpin");

    const wheelSpins = 5;
    const ballSpins = 8;
    const wheelFinal = wheelSpins * 360; // ends back at its starting orientation
    const ballFinal = -(ballSpins * 360 - idx * SEG); // ends aligned with the winning pocket

    wheelEl.style.transition = "none";
    ballEl.style.transition = "none";
    wheelEl.style.transform = "rotate(0deg)";
    ballEl.style.transform = "rotate(0deg)";
    // force reflow so the next transform change animates
    void wheelEl.offsetWidth;

    wheelEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.22,0.68,0.35,1)`;
    ballEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.15,0.85,0.3,1)`;

    requestAnimationFrame(() => {
      wheelEl.style.transform = `rotate(${wheelFinal}deg)`;
      ballEl.style.transform = `rotate(${ballFinal}deg)`;
    });

    setTimeout(resolve, durationMs + 200);
  });
}

function showSpinModal() {
  const overlay = document.createElement("div");
  overlay.id = "anwRouletteModal";
  overlay.className = "anw-modal-overlay";
  overlay.innerHTML = `
    <div class="anw-modal-card" style="text-align:center;">
      <h2 style="display:flex;align-items:center;justify-content:center;gap:9px;">${icon("dice", 22)} Spinning...</h2>
      <div id="wheelHolder">${buildWheelSVG()}</div>
      <p class="muted-small" id="rouletteStatus">Round and round it goes...</p>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

async function spin() {
  const betType = document.getElementById("betType").value;
  const betAmount = document.getElementById("betAmount").value;
  const selection = readSelection();
  const msgBox = document.getElementById("betMsg");
  msgBox.innerHTML = "";

  document.getElementById("spinBtn").disabled = true;

  const res = await placeRouletteBet(CURRENT.username, CLASS_CODE, betType, betAmount, selection);
  if (!res.ok) {
    msgBox.innerHTML = `<div class="error-msg">${res.error}</div>`;
    document.getElementById("spinBtn").disabled = false;
    return;
  }

  const overlay = showSpinModal();
  await animateWheel(res.spin, 15000);

  const statusEl = document.getElementById("rouletteStatus");
  const colorName = res.spin === 0 ? "green" : (RED_NUMBERS.has(res.spin) ? "red" : "black");
  if (statusEl) {
    statusEl.innerHTML = `Ball landed on <strong>${res.spin}</strong> (${colorName})${res.win
      ? ` — <span class="ticker-up">you won ${fmtMoney(res.netChange)}!</span>`
      : ` — <span class="ticker-down">you lost ${fmtMoney(Math.abs(res.netChange))}.</span>`}`;
  }

  await new Promise(r => setTimeout(r, 2200));
  overlay.remove();

  document.getElementById("spinBtn").disabled = false;
  msgBox.innerHTML = res.win
    ? `<div class="success-msg">Ball landed on ${res.spin} — you won ${fmtMoney(res.netChange)}!</div>`
    : `<div class="error-msg">Ball landed on ${res.spin} — you lost ${fmtMoney(Math.abs(res.netChange))}.</div>`;

  await render();
}

document.addEventListener("DOMContentLoaded", init);