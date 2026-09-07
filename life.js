let CURRENT, IS_TEACHER, EDITING_ID = null;

const LIFE_FORM_IDS = ["liName", "liDesc", "liCash", "liAllowance", "liIncome", "liDiscStore", "liDiscTransport", "liDiscProperty", "liDiscInsurance", "liLifestyle", "liTaxCut"];

// Turns a benefits object into the small row of badges shown next to a
// life item, wherever it's rendered (teacher's list, a student's own
// cards). Only benefits that are actually non-zero are shown.
function lifeBenefitChips(b) {
  b = b || {};
  const chips = [];
  const num = k => Number(b[k]) || 0;
  if (num("cashOnce")) chips.push(`<span class="badge gold">${icon("coin", 12)}${num("cashOnce") >= 0 ? "+" : ""}${fmtMoney(b.cashOnce)} one-time</span>`);
  if (num("allowance")) chips.push(`<span class="badge mint">${icon("coin", 12)}+${fmtMoney(b.allowance)} every pay day</span>`);
  if (num("incomePercent")) chips.push(`<span class="badge ${num("incomePercent") >= 0 ? "mint" : "coral"}">${icon("briefcase", 12)}${num("incomePercent") >= 0 ? "+" : ""}${b.incomePercent}% job income</span>`);
  if (num("discountStore")) chips.push(`<span class="badge lilac">${icon("cart", 12)}${b.discountStore}% off Store</span>`);
  if (num("discountTransport")) chips.push(`<span class="badge lilac">${icon("car", 12)}${b.discountTransport}% off Transport</span>`);
  if (num("discountProperty")) chips.push(`<span class="badge lilac">${icon("house", 12)}${b.discountProperty}% off Property</span>`);
  if (num("discountInsurance")) chips.push(`<span class="badge lilac">${icon("shield", 12)}${b.discountInsurance}% off Insurance</span>`);
  if (num("lifestylePoints")) chips.push(`<span class="badge ${num("lifestylePoints") >= 0 ? "navy" : "coral"}">${icon("star", 12)}${num("lifestylePoints") >= 0 ? "+" : ""}${b.lifestylePoints} lifestyle pts</span>`);
  if (num("taxCutPercent")) chips.push(`<span class="badge navy">${icon("percent", 12)}${b.taxCutPercent}% off tax bill</span>`);
  return chips.length ? chips.join(" ") : `<span class="muted-small">No active benefits set</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("trophy", 26) + " Life";
  document.getElementById("hAdd").innerHTML = icon("plus", 18) + " Create a life item";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add life item";
  document.getElementById("hDefs").innerHTML = icon("trophy", 18) + " Life items";
  document.getElementById("hGranted").innerHTML = icon("users", 18) + " Who has what";
  document.getElementById("hMyLife").innerHTML = icon("trophy", 18) + " My life";
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
  document.getElementById("defListCard").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("grantedCard").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("myLifeCard").classList.toggle("hidden", IS_TEACHER);
  paintChrome();

  // Same set of independent, self-contained background jobs every other
  // page kicks off on load (see bigevents.js) — a student landing here
  // first still gets paid/charged/matured on schedule, including the new
  // life-item recurring allowance, which rides along inside pay day.
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const cls = await getClassCached(CURRENT.classCode);
  const items = cls.lifeItems || [];

  if (IS_TEACHER) {
    const students = await getClassStudents(CURRENT.classCode, cls);

    const list = document.getElementById("defList");
    list.innerHTML = "";
    document.getElementById("noDefs").classList.toggle("hidden", items.length > 0);
    items.forEach(item => {
      const div = document.createElement("div");
      div.className = "card company-card";
      div.innerHTML = `
        <div class="flex-between">
          <div>
            <h4>${icon("trophy", 16)} ${item.name}</h4>
            <p>${item.description || "No description provided."}</p>
            <div style="margin-top:6px;">${lifeBenefitChips(item.benefits)}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn small secondary" type="button" onclick="startEditLifeItem('${item.id}')">${icon("idcard", 13)} Edit</button>
            <button class="btn small coral" type="button" onclick="deleteLifeItem('${item.id}')">${icon("trash", 13)} Remove</button>
          </div>
        </div>
        <div class="flex-row" style="align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <select id="give-${item.id}" style="max-width:220px;"></select>
          <button class="btn small gold" type="button" onclick="giveLifeItem('${item.id}')">${icon("plus", 13)} Give to student</button>
        </div>
        <div id="giveMsg-${item.id}"></div>
      `;
      list.appendChild(div);
      const sel = div.querySelector(`#give-${item.id}`);
      sel.innerHTML = students.map(s => `<option value="${s.username}">${s.name}</option>`).join("");
    });

    const grantedBox = document.getElementById("grantedList");
    grantedBox.innerHTML = "";
    const withItems = students.filter(s => (s.lifeItems || []).length > 0);
    document.getElementById("noGranted").classList.toggle("hidden", withItems.length > 0);
    withItems.forEach(s => {
      const row = document.createElement("div");
      row.className = "auto-row";
      const chips = (s.lifeItems || []).map(it => `
        <span class="badge navy" style="margin-right:6px;margin-bottom:4px;display:inline-flex;align-items:center;gap:4px;">
          ${icon("trophy", 12)} ${it.name}
          <button type="button" onclick="revokeLifeItemFor('${s.username}','${it.id}')" title="Revoke" style="border:none;background:none;cursor:pointer;color:inherit;font-weight:800;padding:0 0 0 2px;line-height:1;">&times;</button>
        </span>
      `).join("");
      row.innerHTML = `<div class="auto-details"><strong>${s.name}</strong><div style="margin-top:4px;">${chips}</div></div>`;
      grantedBox.appendChild(row);
    });
  } else {
    const me = await getUserCached(CURRENT.username);
    const mine = me.lifeItems || [];
    document.getElementById("noMine").classList.toggle("hidden", mine.length > 0);
    const box = document.getElementById("myLifeList");
    box.innerHTML = "";
    mine.slice().reverse().forEach(it => {
      const div = document.createElement("div");
      div.className = "card company-card";
      div.innerHTML = `
        <h4>${icon("trophy", 16)} ${it.name}</h4>
        <p>${it.description || ""}</p>
        <div>${lifeBenefitChips(it.benefits)}</div>
        <p class="muted-small" style="margin-top:8px;">Given ${it.grantedAt || ""}</p>
      `;
      box.appendChild(div);
    });
  }
}

function readLifeFormBenefits() {
  return {
    cashOnce: document.getElementById("liCash").value,
    allowance: document.getElementById("liAllowance").value,
    incomePercent: document.getElementById("liIncome").value,
    discountStore: document.getElementById("liDiscStore").value,
    discountTransport: document.getElementById("liDiscTransport").value,
    discountProperty: document.getElementById("liDiscProperty").value,
    discountInsurance: document.getElementById("liDiscInsurance").value,
    lifestylePoints: document.getElementById("liLifestyle").value,
    taxCutPercent: document.getElementById("liTaxCut").value
  };
}

async function saveLifeItemForm(e) {
  e.preventDefault();
  const item = {
    name: document.getElementById("liName").value.trim(),
    description: document.getElementById("liDesc").value.trim(),
    benefits: readLifeFormBenefits()
  };
  if (!item.name) return false;
  if (EDITING_ID) {
    await updateLifeItem(CURRENT.classCode, EDITING_ID, item);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Life item updated!</div>`;
  } else {
    await addLifeItem(CURRENT.classCode, item);
    document.getElementById("addMsg").innerHTML = `<div class="success-msg">Life item added!</div>`;
  }
  resetLifeForm();
  await render();
  return false;
}

function resetLifeForm() {
  EDITING_ID = null;
  LIFE_FORM_IDS.forEach(id => document.getElementById(id).value = "");
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add life item";
  const cancelBtn = document.getElementById("cancelEditBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditLifeItem(id) {
  getClassCached(CURRENT.classCode).then(cls => {
    const d = (cls.lifeItems || []).find(x => x.id === id);
    if (!d) return;
    EDITING_ID = id;
    document.getElementById("liName").value = d.name || "";
    document.getElementById("liDesc").value = d.description || "";
    const b = d.benefits || {};
    document.getElementById("liCash").value = b.cashOnce || "";
    document.getElementById("liAllowance").value = b.allowance || "";
    document.getElementById("liIncome").value = b.incomePercent || "";
    document.getElementById("liDiscStore").value = b.discountStore || "";
    document.getElementById("liDiscTransport").value = b.discountTransport || "";
    document.getElementById("liDiscProperty").value = b.discountProperty || "";
    document.getElementById("liDiscInsurance").value = b.discountInsurance || "";
    document.getElementById("liLifestyle").value = b.lifestylePoints || "";
    document.getElementById("liTaxCut").value = b.taxCutPercent || "";
    document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Save changes";
    if (!document.getElementById("cancelEditBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetLifeForm;
      document.getElementById("addBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function deleteLifeItem(id) {
  if (confirm("Remove this life item? Students who already have it keep their benefits — this only stops it being given out again.")) {
    if (id === EDITING_ID) resetLifeForm();
    await removeLifeItem(CURRENT.classCode, id);
    await render();
  }
}

async function giveLifeItem(templateId) {
  const sel = document.getElementById(`give-${templateId}`);
  const box = document.getElementById(`giveMsg-${templateId}`);
  if (!sel || !sel.value) return;
  const res = await grantLifeItem(CURRENT.classCode, sel.value, templateId, CURRENT.username);
  box.innerHTML = res.ok ? `<div class="success-msg">Given!</div>` : `<div class="error-msg">${res.error}</div>`;
  await render();
}

async function revokeLifeItemFor(username, grantId) {
  if (!confirm("Remove this life item from this student? Their benefits from it will stop immediately.")) return;
  await revokeLifeItem(CURRENT.classCode, username, grantId);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
