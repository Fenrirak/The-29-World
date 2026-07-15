let CURRENT;

function badgeType(type) {
  const map = {
    welcome: ["navy", "star", "Welcome"],
    wage: ["mint", "briefcase", "Wage"],
    interest: ["gold", "piggy", "Interest"],
    bonus: ["mint", "star", "Bonus"],
    fine: ["coral", "coin", "Fine"],
    transfer: ["navy", "send", "Transfer"],
    automation: ["navy", "repeat", "Auto-pay"],
    "stock-buy": ["gold", "chart", "Stock buy"],
    "stock-sell": ["gold", "chart", "Stock sell"],
    "stock-close": ["gold", "building", "Delisted"]
  };
  const [cls, ic, label] = map[type] || ["navy", "coin", type];
  return `<span class="badge ${cls}">${icon(ic, 12)}${label}</span>`;
}
const AVATAR_COLORS = ["c1", "c2", "c3", "c4", "c5"];
function avatarClass(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("iconBalance").innerHTML = icon("piggy", 30);
  document.getElementById("iconPortfolio").innerHTML = icon("chart", 30);
  document.getElementById("iconJob").innerHTML = icon("briefcase", 30);
  document.getElementById("hLeaderboard").innerHTML = icon("medal", 18) + " Net worth ranking";
  document.getElementById("hBank").innerHTML = icon("bank", 18) + " Bank account";
  document.getElementById("hClassmates").innerHTML = icon("users", 18) + " My classmates";
  document.getElementById("hMarket").innerHTML = icon("chart", 18) + " Market snapshot";
  document.getElementById("hActivity").innerHTML = icon("bank", 18) + " My recent activity";
  document.getElementById("bankLink").innerHTML = icon("piggy", 14) + " Go to Bank";
  document.getElementById("marketLink").innerHTML = icon("chart", 14) + " Go to Stock Market";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

function init() {
  const u = requireLogin();
  if (!u) return;
  if (u.role !== "student") { window.location.href = "teacher.html"; return; }
  CURRENT = u;
  document.getElementById("whoami").textContent = u.name;
  paintChrome();
  // Fire any wages or automatic payments that have come due since last visit
  autoPayDayIfDue(u.classCode);
  processAutomations(u.classCode);
  render();
}

function render() {
  const db = loadDB();
  const me = db.users[CURRENT.username];
  const cls = db.classes[me.classCode];

  document.getElementById("greeting").textContent = "Hi, " + me.name + "!";
  document.getElementById("balance").textContent = fmtMoney(me.balance);
  document.getElementById("portfolio").textContent = fmtMoney(portfolioValue(me.username, me.classCode));

  const job = cls.jobs.find(j => j.id === me.jobId);
  document.getElementById("jobLabel").textContent = job ? `${job.title} — ${fmtMoney(job.wage)}/payday` : "No job assigned";

  // net worth leaderboard
  const board = classLeaderboard(me.classCode);
  const medalClass = i => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  const lbBox = document.getElementById("leaderboardList");
  lbBox.innerHTML = "";
  board.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "leaderboard-row" + (row.username === me.username ? " me" : "");
    div.innerHTML = `
      <span class="rank-pill ${medalClass(i)}">${i + 1}</span>
      <span class="student-avatar ${avatarClass(row.username)}">${initials(row.name)}</span>
      <div style="flex:1;">
        <div class="leaderboard-name">${row.name}${row.username === me.username ? " (you)" : ""}</div>
        <div class="leaderboard-sub">${fmtMoney(row.balance)} cash + ${fmtMoney(row.invested)} invested</div>
      </div>
      <div class="leaderboard-net">${fmtMoney(row.net)}</div>
    `;
    lbBox.appendChild(div);
  });

  // classmates
  const classmates = getClassStudents(me.classCode).filter(s => s.username !== me.username);
  const ctbl = document.getElementById("classmateTable");
  ctbl.innerHTML = "";
  classmates.forEach(s => {
    const j = cls.jobs.find(jj => jj.id === s.jobId);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span>${s.name}</td><td>${j ? j.title : "—"}</td>`;
    ctbl.appendChild(tr);
  });

  // market snapshot
  const mbody = document.getElementById("marketSnapshot");
  mbody.innerHTML = "";
  document.getElementById("noCompanies").classList.toggle("hidden", cls.companies.length > 0);
  cls.companies.forEach(co => {
    const mine = co.holders[me.username] || 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${co.name}</td><td>${fmtMoney(co.price)}</td><td>${mine}</td>`;
    mbody.appendChild(tr);
  });

  // my transactions
  const my = cls.txns.filter(t => t.to === me.username || t.from === me.username).slice(0, 25);
  const tbody = document.getElementById("txnTable");
  tbody.innerHTML = "";
  const nameOf = u => (db.users[u] ? db.users[u].name : u);
  my.forEach(t => {
    let detail = t.note || "";
    let amt = t.amount;
    let sign = "";
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) { detail = "To " + nameOf(t.to) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "-"; }
      else { detail = "From " + nameOf(t.from) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "+"; }
    } else if (t.type === "stock-buy") { sign = "-"; }
    else if (["stock-sell", "stock-close", "wage", "interest", "bonus", "welcome"].includes(t.type)) { sign = "+"; }
    else if (t.type === "fine") { sign = "-"; }

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${detail}</td>
      <td class="${sign === '-' ? 'ticker-down' : 'ticker-up'}">${sign}${fmtMoney(amt)}</td>`;
    tbody.appendChild(tr);
  });
}

document.addEventListener("DOMContentLoaded", init);
