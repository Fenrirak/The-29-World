/* ================================================================================
   Savings goals card — shared by the student dashboard (student.html) and the
   Bank page (bank.html). Each page only needs an empty
   <div class="card" id="goalsCard"></div> where the card should go; this file
   fills it in and handles every button on it. The goal data itself (adding,
   removing, progress) lives in "Savings goals" in data-money.js.

   Load order: after the data-*.js files, before the page's own script. The
   page's own script must define `CURRENT` (the signed-in user) and `render()`
   (redraws the page) — both student.js and bank.js already do — and call
   renderGoals(me) from its render().
================================================================================ */

// Fills in the card's fixed parts once. Runs as soon as this file loads
// (defer scripts run after the page is parsed), so the card never shows up
// empty while the page's data is still loading.
function buildGoalsCard() {
  const card = document.getElementById("goalsCard");
  if (!card || document.getElementById("goalList")) return;
  // On the Bank page the Savings account is right there on the same page;
  // everywhere else, link to it.
  const savingsRef = document.getElementById("savingsCard")
    ? "your Savings account (above)"
    : `your <a href="bank.html">Savings account</a>`;
  card.innerHTML = `
    <div class="flex-between">
      <h2 id="hGoals">${icon("trophy", 18)} My savings goals</h2>
      <button class="btn small gold" type="button" id="addGoalBtn" onclick="toggleGoalForm(true)">Add a goal</button>
    </div>
    <p class="muted-small" style="margin-top:0;">Money in ${savingsRef} counts towards your goals — your top goal fills up first.</p>
    <div id="goalList"></div>
    <p class="muted-small hidden" id="noGoals">No goals yet. What are you saving up for? A new bike, a phone, a house deposit…</p>
    <form id="goalForm" class="hidden" onsubmit="return submitGoal(event)">
      <div class="grid grid-2">
        <div>
          <label for="goalName">What are you saving for?</label>
          <input id="goalName" maxlength="40" placeholder="e.g. New bike" required>
        </div>
        <div>
          <label for="goalTarget">How much does it cost?</label>
          <input id="goalTarget" type="number" min="0.01" step="0.01" placeholder="e.g. 120" required>
        </div>
      </div>
      <button class="btn" type="submit" id="goalSaveBtn">Save goal</button>
      <button class="btn secondary small" type="button" onclick="toggleGoalForm(false)">Cancel</button>
      <div id="goalMsg"></div>
    </form>
  `;
}
buildGoalsCard();

// Progress comes straight from the Savings balance on the user doc the
// page's render() already read — no extra reads.
function renderGoals(me) {
  buildGoalsCard();
  const list = document.getElementById("goalList");
  if (!list) return;
  const goals = savingsGoalProgress(me);
  document.getElementById("noGoals").classList.toggle("hidden", goals.length > 0);
  document.getElementById("addGoalBtn").classList.toggle("hidden", goals.length >= MAX_SAVINGS_GOALS);
  list.innerHTML = goals.map((g, i) => `
    <div class="goal-row${g.reached ? " reached" : ""}">
      <div class="goal-head">
        <strong class="goal-name">${escapeHtml(g.name)}</strong>
        ${g.reached ? `<span class="badge mint">${icon("star", 12)} Reached!</span>` : ""}
        <span class="goal-amounts">${fmtMoney(g.saved)} of ${fmtMoney(g.target)}</span>
      </div>
      <div class="rpt-bar-track goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${g.pct}" aria-label="${escapeHtml(g.name)}: ${g.pct}% saved">
        <div class="rpt-bar-fill ${g.reached ? "mint" : "gold"}" style="width:${g.pct}%"></div>
      </div>
      <div class="goal-foot">
        <span class="muted-small">${g.reached
          ? "You've saved enough! Withdraw it from Savings to buy it, or keep it growing."
          : `${fmtMoney(g.target - g.saved)} to go`}</span>
        <span class="goal-actions">
          ${i > 0 ? `<button type="button" class="link-btn" onclick="moveGoalUpClick('${escapeJsAttr(g.id)}')">Move up</button>` : ""}
          <button type="button" class="link-btn" onclick="removeGoalClick('${escapeJsAttr(g.id)}', '${escapeJsAttr(g.name)}')">Remove</button>
        </span>
      </div>
    </div>
  `).join("");
  celebrateNewlyReachedGoals(me.username, goals);
}

// A little "well done" the first time each goal is reached (remembered per
// device, and shared by both pages, so it isn't repeated on every refresh).
function celebrateNewlyReachedGoals(username, goals) {
  const key = "t29_goals_reached_" + username;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { seen = []; }
  const reachedIds = goals.filter(g => g.reached).map(g => g.id);
  goals.filter(g => g.reached && !seen.includes(g.id)).forEach(g => {
    t29Toast(`🎉 Goal reached: ${g.name}! You've saved ${fmtMoney(g.target)}.`, { type: "success", duration: 6000 });
  });
  try { localStorage.setItem(key, JSON.stringify(reachedIds)); } catch (e) { /* ignore */ }
}

function toggleGoalForm(show) {
  document.getElementById("goalForm").classList.toggle("hidden", !show);
  document.getElementById("goalMsg").innerHTML = "";
  if (show) document.getElementById("goalName").focus();
}

async function submitGoal(e) {
  e.preventDefault();
  const btn = document.getElementById("goalSaveBtn");
  const msg = document.getElementById("goalMsg");
  btn.disabled = true;
  msg.innerHTML = `<p class="muted-small">Saving…</p>`;
  const res = await addSavingsGoal(CURRENT.username, document.getElementById("goalName").value, document.getElementById("goalTarget").value);
  btn.disabled = false;
  if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return false; }
  document.getElementById("goalForm").reset();
  toggleGoalForm(false);
  await render();
  return false;
}

async function removeGoalClick(goalId, name) {
  if (!confirm(`Remove your goal "${name}"? Your savings stay exactly where they are.`)) return;
  const res = await removeSavingsGoal(CURRENT.username, goalId);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

async function moveGoalUpClick(goalId) {
  const res = await moveSavingsGoalUp(CURRENT.username, goalId);
  if (!res.ok) { alert(res.error); return; }
  await render();
}
