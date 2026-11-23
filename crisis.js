/* A crisis reprices the classroom catalogues in a single class transaction.
   The preview uses the same calculation as the commit, including cent rounding. */
const CRISIS_MARKETS = [
  { key: "market", field: "companies", label: "Simulated shares", icon: "chart", weight: -1.3 },
  { key: "property", field: "properties", label: "Property", icon: "house", weight: -0.9 },
  { key: "store", field: "storeItems", label: "Store goods", icon: "cart", weight: 1.1 },
  { key: "transport", field: "vehicles", label: "Vehicles", icon: "car", weight: 0.8 }
];

function crisisDefinition(draft) {
  const name = String(draft.name || "").trim();
  const severity = Number(draft.severity);
  const sectors = CRISIS_MARKETS.map(m => m.key).filter(k => draft.sectors?.includes(k));
  if (!name || name.length > 80) throw new Error("Enter a crisis name of up to 80 characters.");
  if (!Number.isInteger(severity) || severity < 1 || severity > 50) throw new Error("Choose a severity from 1% to 50%.");
  if (!sectors.length) throw new Error("Choose at least one market.");
  return { name, severity, sectors };
}

function crisisPrice(price, pct) {
  const cents = Math.round(Number(price) * (1 + pct / 100) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("A catalogue price is outside the supported range.");
  return Math.max(1, cents) / 100;
}

function crisisPlan(cls, draft) {
  const rows = [];
  for (const market of CRISIS_MARKETS) {
    if (!draft.sectors.includes(market.key) || moduleIsOff(cls, market.key)) continue;
    const items = (cls[market.field] || []).filter(item => !item.realSymbol && !item.archived && Number(item.price) > 0);
    // All units of the same housing listing receive the same percentage.
    const keyOf = item => market.key === "property" ? groupIdOf(item) : item.id;
    const keys = [...new Set(items.map(keyOf))].sort();
    const weights = new Map(keys.map((key, i) => [key, market.weight * (keys.length === 1 ? 1 : 0.9 + 0.2 * i / (keys.length - 1))]));
    for (const item of items) rows.push({ market, item, weight: weights.get(keyOf(item)), before: Number(item.price) });
  }
  const mean = rows.length ? rows.reduce((sum, r) => sum + Math.abs(r.weight), 0) / rows.length : 1;
  const summary = [];
  for (const market of CRISIS_MARKETS) {
    const group = rows.filter(r => r.market === market);
    if (!group.length) continue;
    let sum = 0;
    for (const r of group) {
      const pct = draft.severity * r.weight / mean;
      r.after = crisisPrice(r.before, pct);
      if (market.key === "transport" && Number(r.item.weeklyExpense) > 0) {
        r.expenseAfter = crisisPrice(r.item.weeklyExpense, pct);
      }
      sum += (r.after / r.before - 1) * 100;
    }
    summary.push({ key: market.key, count: group.length, changePct: Math.round(10 * sum / group.length) / 10 });
  }
  const signature = JSON.stringify([cls.createdAt || 0, cls.crisisLog?.[0]?.id, rows.map(r =>
    [r.market.key, r.item.id, r.item.name, r.before, r.after, Number(r.item.weeklyExpense) || 0, r.expenseAfter])]);
  return { rows, summary, signature, changed: rows.some(r => r.after !== r.before || (r.expenseAfter != null && r.expenseAfter !== r.item.weeklyExpense)) };
}

function crisisHistoryPoint(item, values, dates, row, day) {
  const history = item[values]?.length ? item[values] : [row.before];
  const knownDates = (item[dates] || []).slice(-history.length);
  item[dates] = [...Array(history.length - knownDates.length).fill(""), ...knownDates, day].slice(-30);
  item[values] = [...history, row.after].slice(-30);
}

async function commitCrisis(classCode, teacher, action, draft, requestId, expected) {
  const definition = crisisDefinition(draft);
  const ref = classesCol().doc(classCode);
  const ts = trustedNow().getTime(), day = nzDateKey(new Date(ts));
  return fdb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const cls = snap.exists && withNewModuleDefaults(snap.data());
    if (!t29CanTeachClass(cls, teacher) || cls.archived) throw new Error("Open an active class you teach.");
    if (action === "save") {
      const defs = classCrisisEvents(cls).slice();
      const id = draft.id || requestId;
      const i = defs.findIndex(d => d.id === id);
      const saved = { id, ...definition };
      if (i >= 0 && sameCrisisDefinition(defs[i], saved)) return;
      if (expected ? i < 0 || !sameCrisisDefinition(defs[i], expected) : i >= 0) throw new Error("This saved crisis changed. Select it again before saving.");
      if (i < 0) defs.push(saved);
      else defs[i] = saved;
      tx.update(ref, { crisisDefs: defs });
      return;
    }
    if (action !== "run") throw new Error("Unknown crisis action.");
    const log = cls.crisisLog || [];
    if (log.some(e => e.id === requestId)) return;
    if (moduleIsOff(cls, "bigevents")) throw new Error("Enable the Events module before running a crisis.");
    const plan = crisisPlan(cls, definition);
    if (!plan.changed || expected !== plan.signature) throw new Error("Market prices or availability changed. Review the refreshed preview before running.");
    const patch = {};
    for (const row of plan.rows) {
      const { market, item, before, after } = row;
      if (before !== after) {
        if (market.key === "market") {
          crisisHistoryPoint(item, "history", "historyDates", row, day);
          t29AgeSplitMarkers(item);
        } else if (market.key === "property") {
          crisisHistoryPoint(item, "priceHistory", "priceHistoryDates", row, day);
        } else if (item.preCrisisPrice == null) item.preCrisisPrice = before;
        item.price = after;
      }
      if (row.expenseAfter != null && row.expenseAfter !== item.weeklyExpense) {
        if (item.preCrisisExpense == null) item.preCrisisExpense = item.weeklyExpense;
        item.weeklyExpense = row.expenseAfter;
      }
      patch[market.field] = cls[market.field];
    }
    patch.crisisLog = [{ id: requestId, name: definition.name, severity: definition.severity, ts, day, markets: plan.summary }, ...log].slice(0, 100);
    tx.update(ref, patch);
  });
}

function sameCrisisDefinition(a, b) {
  return a.name === b.name && a.severity === b.severity && JSON.stringify(a.sectors) === JSON.stringify(b.sectors);
}

let crisisClass, crisisOriginal = null, crisisPending = null;
const crisisEl = id => document.getElementById(id);
const crisisPercent = pct => (pct > 0 ? "+" : "") + pct + "%";

function crisisMessage(text, error = false) {
  const el = crisisEl("crisisMessage");
  el.className = text ? (error ? "error-msg" : "success-msg") : "";
  el.textContent = text;
}

function readCrisisForm() {
  return {
    id: crisisOriginal?.id, name: crisisEl("crisisName").value.trim(),
    severity: Number(crisisEl("crisisSeverity").value),
    sectors: [...crisisEl("crisisSectors").querySelectorAll("input:checked")].map(el => el.value)
  };
}

function chooseCrisis(cancel = false) {
  const picker = crisisEl("crisisPreset");
  if (cancel) picker.value = "";
  crisisOriginal = classCrisisEvents(crisisClass).find(d => d.id === picker.value) || null;
  crisisEl("crisisName").value = crisisOriginal?.name || "";
  crisisEl("crisisSeverity").value = crisisOriginal?.severity || 10;
  crisisEl("crisisSectors").querySelectorAll("input").forEach(el => {
    el.checked = crisisOriginal ? crisisOriginal.sectors.includes(el.value) : true;
  });
  crisisPending = null;
  crisisMessage(cancel ? "Draft cleared." : "");
  previewCrisis();
}

function previewCrisis() {
  const draft = readCrisisForm();
  crisisEl("crisisPct").textContent = draft.severity + "%";
  const preview = crisisEl("crisisPreview"), run = crisisEl("crisisRun");
  try {
    const plan = crisisPlan(crisisClass, draft);
    preview.innerHTML = plan.summary.map(s => {
      const row = plan.rows.find(r => r.market.key === s.key);
      return `<div class="crisis-market"><div><strong>${icon(row.market.icon,16)} ${row.market.label}</strong>
        <span class="muted-small">${s.count} listing${s.count === 1 ? "" : "s"} · ${escapeHtml(row.item.name || "Example")} ${fmtMoney(row.before)} → ${fmtMoney(row.after)}</span>
        ${row.expenseAfter != null ? `<span class="muted-small">Weekly running cost ${fmtMoney(row.item.weeklyExpense)} → ${fmtMoney(row.expenseAfter)}</span>` : ""}</div>
        <b>${crisisPercent(s.changePct)}</b></div>`;
    }).join("") || "<p>Select an enabled market with priced listings to preview a crisis.</p>";
    run.disabled = !plan.changed || moduleIsOff(crisisClass, "bigevents");
    const skipped = CRISIS_MARKETS.filter(m => draft.sectors.includes(m.key) && !plan.summary.some(s => s.key === m.key));
    if (plan.rows.length && skipped.length) preview.insertAdjacentHTML("beforeend", `<p class="muted-small">Skipped (disabled or no eligible prices): ${skipped.map(m => m.label).join(", ")}.</p>`);
    if (plan.rows.length && !plan.changed) preview.insertAdjacentHTML("beforeend", "<p>Rounding leaves these prices unchanged.</p>");
    if (moduleIsOff(crisisClass, "bigevents")) preview.insertAdjacentHTML("beforeend", "<p>Enable Events to run this crisis.</p>");
  } catch (err) {
    preview.textContent = err.message;
    run.disabled = true;
  }
}

function renderCrisis(cls) {
  crisisClass = cls;
  const picker = crisisEl("crisisPreset");
  const defs = classCrisisEvents(cls);
  const options = JSON.stringify(defs);
  if (picker.dataset.options !== options) {
    const selection = picker.value;
    picker.replaceChildren(new Option("New crisis", ""));
    defs.forEach(d => picker.add(new Option(d.name + " · " + d.severity + "%", d.id)));
    picker.value = selection;
    picker.dataset.options = options;
  }
  const sectors = crisisEl("crisisSectors");
  if (!sectors.children.length) {
    sectors.innerHTML = CRISIS_MARKETS.map(m => `<label><input type="checkbox" value="${m.key}" checked> ${m.label}</label>`).join("");
    crisisEl("crisisForm").addEventListener("input", () => { crisisPending = null; crisisMessage(""); previewCrisis(); });
  }
  crisisEl("crisisHistory").innerHTML = (cls.crisisLog || []).map(e => `<div class="crisis-record">
    <strong>${escapeHtml(e.name)}</strong><span class="muted-small">${escapeHtml(e.day)} · ${Number(e.severity)}% target</span>
    <div>${escapeHtml(crisisMarketSummary(e))}</div></div>`).join("") || '<p class="muted-small">Completed crises will appear here.</p>';
  previewCrisis();
}

async function submitCrisis(action) {
  const controls = crisisEl("crisisControls");
  if (!IS_TEACHER || controls.disabled || !crisisEl("crisisForm").reportValidity()) return;
  const draft = readCrisisForm(), cls = crisisClass;
  const code = CURRENT.classCode, teacher = CURRENT.username;
  controls.disabled = true;
  let committed = false;
  try {
    const definition = crisisDefinition(draft);
    const run = action === "run";
    const plan = run ? crisisPlan(cls, definition) : null;
    if (run && !plan.changed) throw new Error("Choose a market with prices that will change.");
    const detail = run ? crisisMarketSummary({ markets: plan.summary }) : "The scenario will be available to run later.";
    const question = run ? "Are you sure you want to run" : crisisOriginal ? "Save changes to" : "Save";
    if (!await t29Confirm(`${question} “${draft.name}” for ${cls.name}?\n\n${detail}${run ? "\n\nPrices change immediately across the class." + (plan.rows.some(r => r.expenseAfter !== undefined && r.expenseAfter !== r.item.weeklyExpense) ? " Weekly vehicle running costs also change." : "") : ""}`,
      { confirmText: run ? "Run crisis" : "Save scenario", danger: run })) return;
    // Keep the request ID through an uncertain acknowledgement, so Retry cannot apply a second shock.
    if (crisisPending?.action !== action) crisisPending = { action, id: uid("crisis") };
    const id = crisisPending.id;
    await commitCrisis(code, teacher, action, draft, id, run ? plan.signature : crisisOriginal);
    committed = true;
    const updated = await getClass(code);
    renderCrisis(updated);
    paintTabs(evTabList(updated, {}));
    crisisEl("crisisPreset").value = run ? "" : (draft.id || id);
    chooseCrisis();
    crisisMessage(run ? "Crisis applied. The new prices are live for this class." : "Scenario saved.");
  } catch (err) {
    crisisMessage(committed ? "Saved to the class. Reload this page to see the latest changes." : err.message, !committed);
    if (!committed) {
      try { renderCrisis(await getClass(code)); } catch (_) { /* keep the draft for retry */ }
    }
  } finally { controls.disabled = false; }
}
