/* A crisis reprices the classroom catalogues in a single class transaction.
   The preview uses the same calculation as the commit, including cent rounding. */
const CRISIS_MARKETS = [
  { key: "market", field: "companies", label: "Simulated shares", icon: "chart", direction: -1 },
  { key: "property", field: "properties", label: "Property", icon: "house", direction: -1 },
  { key: "store", field: "storeItems", label: "Store goods", icon: "cart", direction: 1 },
  { key: "transport", field: "vehicles", label: "Vehicles", icon: "car", direction: 1 }
];

function crisisDefinition(draft) {
  const name = String(draft.name || "").trim();
  const severity = Number(draft.severity);
  const sectors = CRISIS_MARKETS.map(m => m.key).filter(k => draft.sectors?.includes(k));
  if (!name || name.length > 80) throw new Error("Enter a crisis name of up to 80 characters.");
  if (!Number.isInteger(severity) || severity < 1 || severity > 100) throw new Error("Choose an average price movement from 1% to 100%.");
  if (!sectors.length) throw new Error("Choose at least one market.");
  return { name, severity, sectors };
}

function crisisPrice(price, pct) {
  const cents = Math.round(Number(price) * (1 + pct / 100) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("A catalogue price is outside the supported range.");
  return Math.max(1, cents) / 100;
}

function crisisWeight(seed, market, listing) {
  // A stable draw for this listing keeps the preview and every transaction retry in agreement.
  let hash = 2166136261;
  for (const char of JSON.stringify([seed, market, listing])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  return 0.5 + ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

function roundCrisisPrices(rows, target) {
  const groups = new Map();
  let remaining = target;
  for (const row of rows) {
    const key = JSON.stringify([row.market.key, row.listing]);
    const group = groups.get(key) || {rows: [], step: 0};
    group.rows.push(row);
    group.step += 1 / row.before; // Percentage points of movement represented by one cent.
    groups.set(key, group);
    remaining -= Math.abs((row.after / row.before - 1) * 100);
  }
  // Apply coarse cent adjustments first, then use listings with finer steps for the remainder.
  for (const group of [...groups.values()].sort((a, b) => b.step - a.step)) {
    const direction = group.rows[0].market.direction;
    const higher = group.rows.reduce((limit, row) =>
      Math.min(limit, direction < 0 ? Math.round(row.after * 100) - 1 : Number.MAX_SAFE_INTEGER - Math.round(row.after * 100)), Infinity);
    const lower = group.rows.reduce((limit, row) =>
      Math.min(limit, Math.max(0, Math.floor(direction * (row.after - row.before) * 100 + 1e-7))), Infinity);
    const cents = Math.max(-lower, Math.min(higher, Math.round(remaining / group.step)));
    if (!cents) continue;
    for (const row of group.rows) row.after = (Math.round(row.after * 100) + direction * cents) / 100;
    remaining -= cents * group.step;
  }
}

function crisisPlan(cls, draft) {
  const rows = [];
  const seed = draft.seed || draft.id || draft.name;
  for (const market of CRISIS_MARKETS) {
    if (!draft.sectors.includes(market.key) || moduleIsOff(cls, market.key)) continue;
    const items = (cls[market.field] || []).filter(item => !item.realSymbol && !item.archived && Number(item.price) > 0);
    for (const item of items) {
      const listing = market.key === "property" ? groupIdOf(item) : item.id;
      const before = Number(item.price);
      const limit = market.direction < 0 ? Math.max(0, 100 * (1 - 0.01 / before)) : Infinity;
      rows.push({ market, item, listing, before, weight: crisisWeight(seed, market.key, listing), limit });
    }
  }
  const target = draft.severity * rows.length;
  const capacity = rows.reduce((sum, row) => sum + row.limit, 0);
  // Scale after applying the one-cent floor so capped losses don't reduce the other listings' share of the shock.
  let low = 0, high = 200 * rows.length;
  for (let i = 0; i < 45; i++) {
    const scale = (low + high) / 2;
    const total = rows.reduce((sum, row) => sum + Math.min(row.limit, scale * row.weight), 0);
    if (total < target) low = scale;
    else high = scale;
  }
  const scale = (low + high) / 2;
  for (const row of rows) row.after = crisisPrice(row.before, row.market.direction * Math.min(row.limit, scale * row.weight));
  roundCrisisPrices(rows, Math.min(target, capacity));
  let total = 0;
  const summary = [];
  for (const market of CRISIS_MARKETS) {
    const group = rows.filter(r => r.market === market);
    if (!group.length) continue;
    let sum = 0;
    for (const r of group) {
      const actual = (r.after / r.before - 1) * 100;
      if (market.key === "transport" && Number(r.item.weeklyExpense) > 0) {
        r.expenseAfter = crisisPrice(r.item.weeklyExpense, actual);
      }
      sum += actual;
      total += Math.abs(actual);
    }
    summary.push({ key: market.key, count: group.length, changePct: Math.round(10 * sum / group.length) / 10 });
  }
  const signature = JSON.stringify([cls.createdAt || 0, cls.crisisLog?.[0]?.id, rows.map(r =>
    [r.market.key, r.item.id, r.item.name, r.before, r.after, Number(r.item.weeklyExpense) || 0, r.expenseAfter])]);
  return { rows, summary, signature, average: rows.length ? total / rows.length : 0, capped: capacity < target,
    changed: rows.some(r => r.after !== r.before || (r.expenseAfter != null && r.expenseAfter !== r.item.weeklyExpense)) };
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
      if (i >= 0 && sameCrisisDefinition(defs[i], saved)) return cls;
      if (expected ? i < 0 || !sameCrisisDefinition(defs[i], expected) : i >= 0) throw new Error("This saved crisis changed. Select it again before saving.");
      if (i < 0) defs.push(saved);
      else defs[i] = saved;
      tx.update(ref, { crisisDefs: defs });
      return { ...cls, crisisDefs: defs };
    }
    if (action !== "run") throw new Error("Unknown crisis action.");
    const log = cls.crisisLog || [];
    if (log.some(e => e.id === requestId)) return cls;
    if (moduleIsOff(cls, "bigevents")) throw new Error("Enable the Events module before running a crisis.");
    const plan = crisisPlan(cls, { ...draft, ...definition });
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
    patch.crisisLog = [{ id: requestId, name: definition.name, severity: definition.severity, average: plan.average, ts, day, markets: plan.summary }, ...log].slice(0, 100);
    tx.update(ref, patch);
    return { ...cls, ...patch };
  });
}

function sameCrisisDefinition(a, b) {
  return a.name === b.name && a.severity === b.severity && JSON.stringify(a.sectors) === JSON.stringify(b.sectors);
}

let crisisClass, crisisOriginal = null, crisisPending = null, crisisSeed = uid("prices");
const crisisEl = id => document.getElementById(id);
const crisisPercent = pct => (pct > 0 ? "+" : "") + pct + "%";

function crisisMessage(text, error = false) {
  const el = crisisEl("crisisMessage");
  el.className = text ? (error ? "error-msg" : "success-msg") : "";
  el.textContent = text;
}

function readCrisisForm() {
  return {
    id: crisisOriginal?.id, name: crisisEl("crisisName").value.trim(), seed: crisisSeed,
    severity: Number(crisisEl("crisisSeverity").value),
    sectors: [...crisisEl("crisisSectors").querySelectorAll("input:checked")].map(el => el.value)
  };
}

function chooseCrisis(id) {
  crisisOriginal = classCrisisEvents(crisisClass).find(d => d.id === id) || null;
  crisisEl("crisisName").value = crisisOriginal?.name || "";
  crisisEl("crisisSeverity").value = crisisOriginal?.severity || 10;
  crisisEl("crisisSectors").querySelectorAll("input").forEach(el => {
    el.checked = crisisOriginal ? crisisOriginal.sectors.includes(el.value) : true;
  });
  renderSavedCrises();
  rerollCrisis();
}

function rerollCrisis() {
  crisisSeed = uid("prices");
  crisisPending = null;
  crisisMessage("");
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
    if (plan.rows.length) {
      const average = Number(plan.average.toFixed(2));
      preview.insertAdjacentHTML("beforeend", `<p><strong>${average}% average movement</strong> across ${plan.rows.length} listing${plan.rows.length === 1 ? "" : "s"} after rounding.</p>`);
      if (plan.capped) preview.insertAdjacentHTML("beforeend", "<p class=\"muted-small\">The $0.01 minimum price limits the average for these markets.</p>");
    }
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

function renderSavedCrises() {
  const box = crisisEl("crisisSaved");
  const defs = classCrisisEvents(crisisClass);
  const signature = JSON.stringify([defs, crisisOriginal?.id]);
  if (box.dataset.options === signature) return;
  box.innerHTML = '<h3>Saved scenarios</h3>';
  for (const def of defs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small secondary";
    button.textContent = def.name + " · " + def.severity + "%";
    button.setAttribute("aria-pressed", String(crisisOriginal?.id === def.id));
    button.addEventListener("click", () => {
      if (!crisisEl("crisisControls").disabled) {
        chooseCrisis(def.id);
        crisisEl("crisisName").focus();
      }
    });
    box.append(button);
  }
  if (!defs.length) box.insertAdjacentHTML("beforeend", '<p class="muted-small">Saved scenarios will appear here.</p>');
  box.dataset.options = signature;
}

function renderCrisis(cls) {
  crisisClass = cls;
  renderSavedCrises();
  const sectors = crisisEl("crisisSectors");
  if (!sectors.children.length) {
    sectors.innerHTML = CRISIS_MARKETS.map(m => `<label><input type="checkbox" value="${m.key}" checked> ${m.label}</label>`).join("");
    crisisEl("crisisForm").addEventListener("input", () => { crisisPending = null; crisisMessage(""); previewCrisis(); });
  }
  crisisEl("crisisHistory").innerHTML = (cls.crisisLog || []).map(e => `<div class="crisis-record">
    <strong>${escapeHtml(e.name)}</strong><span class="muted-small">${escapeHtml(e.day)} · ${Number(e.severity)}% target${Number.isFinite(e.average) ? " · " + Number(e.average.toFixed(2)) + "% average movement" : ""}</span>
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
    const plan = run ? crisisPlan(cls, { ...draft, ...definition }) : null;
    if (run && !plan.changed) throw new Error("Choose a market with prices that will change.");
    const detail = run ? `${Number(plan.average.toFixed(2))}% average movement across all affected listings.\n${crisisMarketSummary({ markets: plan.summary })}`
      : "The scenario will be available to run later.";
    const question = run ? "Are you sure you want to run" : crisisOriginal ? "Save changes to" : "Save";
    if (!await t29Confirm(`${question} “${draft.name}” for ${cls.name}?\n\n${detail}${run ? "\n\nPrices change immediately across the class." + (plan.rows.some(r => r.expenseAfter !== undefined && r.expenseAfter !== r.item.weeklyExpense) ? " Weekly vehicle running costs also change." : "") : ""}`,
      { confirmText: run ? "Run crisis" : "Save scenario", danger: run })) return;
    // Keep the request ID through an uncertain acknowledgement, so Retry cannot apply a second shock.
    if (crisisPending?.action !== action) crisisPending = { action, id: uid("crisis") };
    const id = crisisPending.id;
    const updated = await commitCrisis(code, teacher, action, draft, id, run ? plan.signature : crisisOriginal);
    committed = true;
    renderCrisis(updated);
    paintTabs(evTabList(updated, {}));
    chooseCrisis(run ? null : (draft.id || id));
    crisisMessage(run ? "Crisis applied. The new prices are live for this class." : "Scenario saved.");
  } catch (err) {
    crisisMessage(committed ? "Saved to the class. Reload this page to see the latest changes." : err.message, !committed);
    if (!committed) {
      try { renderCrisis(await getClass(code)); } catch (_) { /* keep the draft for retry */ }
    }
  } finally { controls.disabled = false; }
}
