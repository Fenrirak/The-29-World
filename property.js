let CURRENT, IS_TEACHER;

function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("house", 26) + " Property";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Add a property";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add property";
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
  paintChrome();
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processWeeklyEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);
  const props = cls.properties || [];
  const students = await getClassStudents(me.classCode);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;

  const list = document.getElementById("propList");
  list.innerHTML = "";
  document.getElementById("noProps").classList.toggle("hidden", props.length > 0);

  props.forEach(p => {
    const isMine = p.owner === me.username;
    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("house", 20)}${p.name} ${isMine ? '<span class="badge mint">Your home</span>' : ""}</h4>
          <p>${p.description || "No description provided."}</p>
          <p>${comfortStars(p.comfort)} comfort</p>
          <p><strong>${fmtMoney(p.price)}</strong> ${p.mortgageWeeks > 0 ? `&middot; mortgage available over ${p.mortgageWeeks} weeks` : "&middot; cash purchase only"}</p>
          <p class="muted-small">${p.owner ? `Owned by ${nameOf(p.owner)}` : "Available"}
            ${p.owner && p.mortgage ? ` — mortgage: ${fmtMoney(p.mortgage.weeklyPayment)}/week, ${p.mortgage.weeksLeft} weeks left` : ""}</p>
        </div>
        <div class="row-flex" style="gap:8px;">
          ${IS_TEACHER
            ? `${p.owner ? `<button class="btn small secondary" onclick="forceSell('${p.id}')">Sell back</button>` : ""}<button class="btn small coral" onclick="deleteProp('${p.id}')">${icon("trash", 13)} Remove</button>`
            : p.owner
              ? (isMine ? `<button class="btn small secondary" onclick="sellMine('${p.id}')">Sell back</button>` : "")
              : `<button class="btn small gold" onclick="buyOutright('${p.id}')">Buy cash</button>
                 ${p.mortgageWeeks > 0 ? `<button class="btn small secondary" onclick="buyFinanced('${p.id}')">Finance (10% deposit)</button>` : ""}`}
        </div>
      </div>
      <div id="msg-${p.id}"></div>
    `;
    list.appendChild(div);
  });
}

async function addProp(e) {
  e.preventDefault();
  const prop = {
    name: document.getElementById("hName").value.trim(),
    price: document.getElementById("hPrice").value,
    comfort: document.getElementById("hComfort").value,
    mortgageWeeks: document.getElementById("hMortgage").value,
    description: document.getElementById("hDesc").value.trim()
  };
  await addProperty(CURRENT.classCode, prop);
  document.getElementById("addMsg").innerHTML = `<div class="success-msg">Property added!</div>`;
  ["hName","hPrice","hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hMortgage").value = 0;
  await render();
  return false;
}

async function deleteProp(id) {
  if (confirm("Remove this property? Any owner will not be refunded automatically.")) {
    await removeProperty(CURRENT.classCode, id);
    await render();
  }
}
async function forceSell(id) {
  if (confirm("Sell this property back to the class (owner gets 90% of price)?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
async function sellMine(id) {
  if (confirm("Sell your property back for 90% of its price?")) {
    await sellProperty(CURRENT.classCode, id);
    await render();
  }
}
async function buyOutright(id) {
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, false);
  document.getElementById("msg-" + id).innerHTML = res.ok ? `<div class="success-msg">Congratulations, it's yours!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}
async function buyFinanced(id) {
  const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, true);
  document.getElementById("msg-" + id).innerHTML = res.ok ? `<div class="success-msg">Financed! Weekly payments will come out automatically.</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
