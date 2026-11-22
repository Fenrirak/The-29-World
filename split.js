/* The 29 World — share splits (screens).
   - The teacher's Split Studio: pick a ratio, see exactly what will change, then split.
   - The students' split announcement, shown once to each student who held shares.
   - The split tag, chart marker and history on each company card of the Stock Market page.
   The money and share maths live in data-markets.js (t29PlanShareSplit / splitCompany): the studio's
   preview and the real split use the very same function, so what the teacher sees is what happens.
   market.js calls into window.T29Split and keeps working if this file didn't load. */
(function () {
  "use strict";

  const DAY = 86400000;
  const RECENT_DAYS = 14;   // a split shows a tag on its company card for this long
  const NEW_DAYS = 2;       // ...and glows for this long
  const SHOW_NEW_STUDENT_DAYS = 3; // a student's very first visit announces splits from the last few days only
  const FORWARD = [[2, 1], [3, 1], [4, 1], [5, 1], [10, 1]];
  const REVERSE = [[1, 2], [1, 3], [1, 5], [1, 10]];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const OPEN_HISTORY = new Set(); // companies whose split history is open (survives the page's live redraws)

  /* ---------------- helpers ---------------- */
  function reduced() { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function esc(s) {
    if (typeof escapeHtml === "function") return escapeHtml(String(s));
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function ico(name, size) { return typeof icon === "function" ? icon(name, size) : ""; }
  function money(n) { return typeof fmtMoney === "function" ? fmtMoney(n) : "$" + (Math.round(Number(n) * 100) / 100).toFixed(2); }
  function plural(n, one, many) { return Number(n) === 1 ? one : many; }
  function label(to, from) { return to + "-for-" + from; }
  function isForward(s) { return Number(s.to) > Number(s.from); }
  function num(n) { return (Number(n) || 0).toLocaleString("en-NZ"); }
  // Prices keep their extra decimals after a split (so nobody's holding changes by a rounding cent): 5.185 stays 5.185.
  function priceText(n) {
    const v = Math.round(Number(n) * 10000) / 10000;
    if (!Number.isFinite(v)) return "$—";
    return "$" + v.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function dateText(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}` : "";
  }
  function gcd(a, b) { while (b) { const r = a % b; a = b; b = r; } return a; }
  function toast(msg) { if (typeof t29Toast === "function") t29Toast(msg, { type: "error" }); else alert(msg); }
  function lastSplit(co) { const a = co && Array.isArray(co.splits) ? co.splits : []; return a.length ? a[a.length - 1] : null; }
  function validSplit(s) { return s && Number(s.to) > 0 && Number(s.from) > 0 && Number(s.to) !== Number(s.from); }

  // Stops the page scrolling behind a dialog, but only where scrollbars float over the page (phones, tablets).
  // With a classic desktop scrollbar, hiding it would shift the whole layout, so the page is left alone there, like the site's other dialogs.
  let lockCount = 0;
  function lockScroll() {
    if (lockCount++ !== 0) return;
    if (window.innerWidth - document.documentElement.clientWidth === 0) document.documentElement.classList.add("t29s-lock");
  }
  function unlockScroll() { if (lockCount > 0 && --lockCount === 0) document.documentElement.classList.remove("t29s-lock"); }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])'),
      el => !el.disabled && el.getClientRects().length > 0);
  }
  // Keeps Tab inside the dialog and lets Escape close it. Listens on the dialog itself, so it never touches
  // the site's own confirm box, which opens on top of the studio.
  function keyHandler(root, onEscape) {
    return function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !root.contains(at) || at === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !root.contains(at))) { e.preventDefault(); first.focus(); }
    };
  }

  /* ---------------- the sliced-share picture ---------------- */
  // A disc cut into n equal slices (a split cuts the pie into more slices; the pie itself stays the same size).
  function pieSvg(n, animate) {
    const shown = Math.min(Math.max(1, Math.floor(Number(n)) || 1), 24), C = 60, R = 54;
    let wedges = "", cuts = "";
    if (shown > 1) {
      for (let i = 0; i < shown; i++) {
        const a0 = (i / shown) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / shown) * 2 * Math.PI - Math.PI / 2;
        const x0 = (C + R * Math.cos(a0)).toFixed(2), y0 = (C + R * Math.sin(a0)).toFixed(2);
        const x1 = (C + R * Math.cos(a1)).toFixed(2), y1 = (C + R * Math.sin(a1)).toFixed(2);
        wedges += `<path class="t29s-w t29s-w${i % 2}" style="--i:${i}" d="M${C} ${C}L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z"/>`;
        cuts += `<line class="t29s-cut" style="--i:${i}" x1="${C}" y1="${C}" x2="${x0}" y2="${y0}"/>`;
      }
    }
    const cls = "t29s-pie" + (animate && shown > 1 ? " t29s-pie-cut" : "");
    return `<svg class="${cls}" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="t29s-disc" cx="${C}" cy="${C}" r="${R}"/>${wedges}${cuts}<circle class="t29s-rim" cx="${C}" cy="${C}" r="${R}"/></svg>`;
  }

  /* ---------------- pieces of the Stock Market page ---------------- */
  // The little tag next to a company's name for two weeks after a split.
  function tagHtml(co) {
    const s = lastSplit(co);
    if (!validSplit(s)) return "";
    const age = Date.now() - (Number(s.ts) || 0);
    if (!(age < RECENT_DAYS * DAY)) return "";
    const fresh = age < NEW_DAYS * DAY, fwd = isForward(s);
    const words = `${label(s.to, s.from)} ${fwd ? "split" : "reverse split"}`;
    const tip = `${words} on ${dateText(s.dateKey)}: ${fwd ? "each share was cut into smaller ones" : "shares were joined together"}`;
    return `<span class="t29s-tag${fresh ? " fresh" : ""}${fwd ? "" : " rev"}" title="${esc(tip)}">${ico("split", 12)}<span>${esc(words)}${fresh ? " &middot; new" : ""}</span></span>`;
  }

  // "Split history (2)" fold-out at the bottom of a company card. ctx: { me, teacher }.
  function historyHtml(co, ctx) {
    const list = (Array.isArray(co.splits) ? co.splits : []).filter(validSplit).slice().reverse();
    if (!list.length) return "";
    const rows = list.map(s => {
      const fwd = isForward(s), mv = s.moves && ctx && ctx.me ? s.moves[ctx.me] : null;
      let extra = "";
      if (mv) extra = `<span class="t29s-hyou">You: ${num(mv[0])} &rarr; ${num(mv[1])} ${plural(mv[1], "share", "shares")}</span>`;
      else if (ctx && ctx.teacher && s.moves) { const n = Object.keys(s.moves).length; extra = `<span class="t29s-hyou">${n} ${plural(n, "holder", "holders")}</span>`; }
      return `<li><span class="t29s-hdate">${esc(dateText(s.dateKey))}</span><span class="t29s-ratio${fwd ? "" : " rev"}">${esc(label(s.to, s.from))}</span><span class="t29s-hprice">${priceText(s.priceBefore)} &rarr; ${priceText(s.priceAfter)}</span>${extra}</li>`;
    }).join("");
    return `<details class="t29s-hist" data-co="${esc(co.id)}"${OPEN_HISTORY.has(co.id) ? " open" : ""}><summary>${ico("split", 14)}<span>Split history</span><span class="t29s-count">${list.length}</span></summary><ul>${rows}</ul></details>`;
  }
  document.addEventListener("toggle", e => {
    const d = e.target;
    if (!d || !d.classList || !d.classList.contains("t29s-hist")) return;
    const id = d.getAttribute("data-co");
    if (!id) return;
    if (d.open) OPEN_HISTORY.add(id); else OPEN_HISTORY.delete(id);
  }, true);

  // Dashed markers drawn over a price chart (w x h) where splits happened. `len` is how many price points the chart has.
  function marksSvg(len, splits, w, h) {
    if (!Array.isArray(splits) || !splits.length || !(len > 0)) return "";
    return splits.filter(validSplit).map(s => {
      const idx = len - 1 - (Number(s.ago) || 0);
      if (!(idx >= 0)) return ""; // scrolled off the 30-point chart
      const x = len > 1 ? (idx / (len - 1)) * w : 0, right = x > w - 48, lab = label(s.to, s.from);
      return `<g class="t29s-mark"><title>${esc(lab)} ${isForward(s) ? "split" : "reverse split"} on ${esc(dateText(s.dateKey))}</title><line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${h}"/><text x="${(x + (right ? -3 : 3)).toFixed(1)}" y="9" text-anchor="${right ? "end" : "start"}">${esc(lab)}</text></g>`;
    }).join("");
  }

  /* ---------------- Split Studio (teacher) ---------------- */
  let studio = null;

  function explainText(p) {
    const every = p.from === 1 ? "Every share" : `Every ${p.from} shares`;
    const turn = p.from === 1 ? "turns" : "turn";
    const target = `${p.to} ${plural(p.to, "share", "shares")}`;
    const was = priceText(p.priceBefore), now = priceText(p.priceAfter);
    return p.forward
      ? `${every} ${turn} into ${target}. Same company, more slices: each share is worth ${now} instead of ${was}, so nobody gets richer or poorer.`
      : `${every} ${turn} into ${target}. Fewer, bigger slices: each share is worth ${now} instead of ${was}, so nobody gets richer or poorer.${p.cashTotal > 0 ? " Any part-share left over is paid out in cash." : ""}`;
  }

  function stageHtml(p) {
    return `<div class="t29s-stage">
      <figure><div class="t29s-pie-wrap">${pieSvg(p.from, false)}</div><figcaption><b>Before</b><span>${p.from} ${plural(p.from, "share", "shares")}</span><span>${priceText(p.priceBefore)} each</span></figcaption></figure>
      <div class="t29s-arrow"><i aria-hidden="true">&rarr;</i><span>${esc(p.label)}</span></div>
      <figure><div class="t29s-pie-wrap">${pieSvg(p.to, true)}</div><figcaption><b>After</b><span>${p.to} ${plural(p.to, "share", "shares")}</span><span>${priceText(p.priceAfter)} each</span></figcaption></figure>
    </div>`;
  }

  function statsHtml(p) {
    const same = Math.abs(p.valueAfter - p.valueBefore) <= 0.011 * Math.max(1, p.holders.length);
    const tile = (name, a, b, cls) => `<div class="t29s-stat${cls ? " " + cls : ""}"><small>${name}</small><div class="v"><em>${a}</em><span aria-hidden="true">&rarr;</span><span>${b}</span></div></div>`;
    return `<div class="t29s-stats">
      ${tile("Share price", priceText(p.priceBefore), priceText(p.priceAfter))}
      ${tile("Shares in the company", num(p.totalBefore), num(p.totalAfter))}
      ${tile("Still for sale", num(p.availBefore), num(p.availAfter))}
      ${same ? `<div class="t29s-stat ok"><small>Students' shares are worth</small><div class="v"><span>${money(p.valueAfter)}</span><span>&check; unchanged</span></div></div>` : tile("Students' shares are worth", money(p.valueBefore), money(p.valueAfter))}
    </div>`;
  }

  function impactHtml(st, p) {
    const rows = p.holders.slice().sort((a, b) => b.before - a.before || a.username.localeCompare(b.username));
    if (!rows.length) return `<p class="t29s-none">Nobody holds shares in ${esc(st.co.name)} yet, so only the price and the share count change.</p>`;
    const show = rows.slice(0, 8), more = rows.length - show.length;
    const body = show.map(r => `<tr><td>${esc(st.names[r.username] || r.username)}</td><td class="n">${num(r.before)} <span class="t29s-arr">&rarr;</span> <b>${num(r.after)}</b></td><td class="n">${money(r.valueAfter)}${r.cash > 0 ? `<span class="t29s-cash" title="A part-share, paid out in cash">${money(r.cash)} cash</span>` : ""}</td></tr>`).join("")
      + (more > 0 ? `<tr><td colspan="3" class="t29s-arr">&hellip;and ${more} more ${plural(more, "student", "students")}</td></tr>` : "");
    return `<div class="t29s-impact"><div class="t29s-scroll"><table><thead><tr><th>Student</th><th class="n">Shares</th><th class="n">Worth</th></tr></thead><tbody>${body}</tbody></table></div><div class="t29s-sum">${rows.length} ${plural(rows.length, "student holds", "students hold")} shares${p.cashTotal > 0 ? ` &middot; ${money(p.cashTotal)} paid out in cash for part-shares` : ""}</div></div>`;
  }

  function chipHtml(co, to, from) {
    const p = t29PlanShareSplit(co, to, from);
    return `<button type="button" class="t29s-chip" data-act="pick" data-to="${to}" data-from="${from}" aria-pressed="false"${p.ok ? "" : " disabled"}><b>${label(to, from)}</b><span>${p.ok ? priceText(p.priceAfter) + " each" : "price too low"}</span></button>`;
  }

  function currentRatio(st) {
    const to = Number(st.to), from = Number(st.from);
    if (!Number.isInteger(to) || !Number.isInteger(from) || to < 1 || from < 1) return null;
    const g = gcd(to, from);
    return { to: to / g, from: from / g };
  }

  function paintChips(st) {
    const cur = currentRatio(st);
    st.root.querySelectorAll(".t29s-chip").forEach(b => {
      b.setAttribute("aria-pressed", cur && cur.to === Number(b.dataset.to) && cur.from === Number(b.dataset.from) ? "true" : "false");
    });
    const f = st.root.querySelector("#t29sFromW"), t = st.root.querySelector("#t29sToW");
    if (f) f.textContent = plural(Number(st.from), "share held,", "shares held,");
    if (t) t.textContent = plural(Number(st.to), "share.", "shares.");
  }

  // The header line and the ratio buttons show prices, so they are redrawn whenever the company's numbers are reloaded.
  function paintStatic(st) {
    const r = st.root, co = st.co;
    r.querySelector("#t29sSub").innerHTML = `${esc(co.name)} &middot; ${priceText(co.price)} a share &middot; ${num(co.totalShares)} shares`;
    r.querySelector("#t29sFwd").innerHTML = FORWARD.map(x => chipHtml(co, x[0], x[1])).join("");
    r.querySelector("#t29sRev").innerHTML = REVERSE.map(x => chipHtml(co, x[0], x[1])).join("");
  }

  function paintPreview(st) {
    const p = st.plan = t29PlanShareSplit(st.co, st.to, st.from);
    const stage = st.root.querySelector("#t29sStage"), stats = st.root.querySelector("#t29sStats"), impact = st.root.querySelector("#t29sImpact"), msg = st.root.querySelector("#t29sMsg");
    const go = st.root.querySelector("#t29sGo");
    msg.innerHTML = "";
    if (p.ok) {
      stage.innerHTML = stageHtml(p) + `<p class="t29s-explain">${esc(explainText(p))}</p>`;
      stats.innerHTML = statsHtml(p);
      impact.innerHTML = impactHtml(st, p);
      go.innerHTML = `${ico("split", 16)} ${p.forward ? "Split" : "Reverse split"} ${esc(p.label)}`;
    } else {
      stage.innerHTML = `<div class="t29s-bad">${esc(p.error)}</div>`;
      stats.innerHTML = "";
      impact.innerHTML = "";
      go.textContent = "Pick a split";
    }
    go.disabled = !p.ok || st.busy;
    paintChips(st);
  }

  async function reload(st) {
    try {
      const cls = await getClass(CLASS_CODE);
      const co = cls && (cls.companies || []).find(c => c.id === st.co.id);
      if (co) { st.co = co; return co; }
    } catch (e) { /* keep what we have */ }
    return null;
  }

  function closeStudio(st, refreshPage) {
    if (!st || st.closed) return;
    st.closed = true;
    st.root.remove();
    unlockScroll();
    studio = null;
    if (st.opener && st.opener.focus && document.contains(st.opener)) { try { st.opener.focus(); } catch (e) { /* page was redrawn */ } }
    if (refreshPage && typeof render === "function") render();
  }

  function showDone(st, info) {
    st.done = true;
    const fwd = info.forward;
    st.root.querySelector(".t29s-head h2").textContent = fwd ? "Split complete" : "Reverse split complete";
    const holders = info.holders || 0;
    st.root.querySelector("#t29sBody").innerHTML = `<div class="t29s-done">
      <svg class="t29s-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg>
      <h3>${esc(st.co.name)} is now ${esc(info.label)}</h3>
      <p>Each share is ${priceText(info.priceAfter)} (it was ${priceText(info.priceBefore)}). The company now has ${num(info.totalAfter)} shares.</p>
      <ul>
        <li>${holders ? `${holders} ${plural(holders, "student", "students")} holding shares ${plural(holders, "was", "were")} updated and told.` : "Nobody held shares yet, so nobody's holding changed."}</li>
        ${info.cashTotal > 0 ? `<li>${money(info.cashTotal)} was paid out in cash for part-shares.</li>` : ""}
        <li>Made a mistake? The opposite split puts everything back.</li>
      </ul>
      <div class="t29s-stage" style="margin-top:8px">
        <figure><div class="t29s-pie-wrap">${pieSvg(info.from, false)}</div><figcaption><b>Before</b><span>${priceText(info.priceBefore)} each</span></figcaption></figure>
        <div class="t29s-arrow"><i aria-hidden="true">&rarr;</i><span>${esc(info.label)}</span></div>
        <figure><div class="t29s-pie-wrap">${pieSvg(info.to, true)}</div><figcaption><b>After</b><span>${priceText(info.priceAfter)} each</span></figcaption></figure>
      </div>
    </div>`;
    st.root.querySelector("#t29sFoot").innerHTML = `<div class="t29s-btns"><button type="button" class="btn gold" id="t29sDone" data-act="done">Done</button></div>`;
    const done = st.root.querySelector("#t29sDone");
    if (done) done.focus();
    if (typeof render === "function") render();
  }

  async function go(st) {
    if (st.busy || st.done || st.asking) return;
    const p = st.plan;
    if (!p || !p.ok) return;
    st.asking = true;
    const ok = await t29Confirm(
      `${p.forward ? "Split" : "Reverse split"} ${st.co.name} ${p.label}?\n\nEvery student's shares change and the price becomes ${priceText(p.priceAfter)}. It's saved straight away and every student is told.${p.cashTotal > 0 ? `\n\nPart-shares are paid out in cash (${money(p.cashTotal)} in all).` : ""}\n\nYou can undo it later with the opposite split.`,
      { confirmText: p.forward ? "Split shares" : "Reverse split", cancelText: "Not yet" });
    st.asking = false;
    if (!ok || st.closed || st.done) return;
    st.busy = true;
    const goBtn = st.root.querySelector("#t29sGo");
    goBtn.disabled = true;
    goBtn.innerHTML = `<span class="t29-spinner"></span> Splitting&hellip;`;
    const lastBefore = (lastSplit(st.co) || {}).id || null;
    let res;
    try { res = await splitCompany(CLASS_CODE, st.co.id, p.to, p.from, p.priceBefore); }
    catch (e) { res = { ok: false, error: "Couldn't reach the server, so the split may not have saved." }; }
    st.busy = false;
    if (st.closed) return;
    if (res && res.ok) { await reload(st); showDone(st, Object.assign({ from: p.from, to: p.to }, res)); return; }
    // The answer can get lost on a bad connection even though the split went through: look before telling the teacher it failed.
    const fresh = await reload(st);
    const now = lastSplit(fresh);
    if (now && now.id !== lastBefore) {
      showDone(st, { forward: isForward(now), label: label(now.to, now.from), from: now.from, to: now.to, priceBefore: now.priceBefore, priceAfter: now.priceAfter, totalAfter: fresh.totalShares, holders: Object.keys(now.moves || {}).length, cashTotal: 0 });
      return;
    }
    paintStatic(st);
    paintPreview(st);
    st.root.querySelector("#t29sMsg").innerHTML = `<div class="t29s-err" role="alert">${esc((res && res.error) || "Something went wrong. Nothing was changed.")}</div>`;
  }

  async function open(coId) {
    if (studio) return;
    if (typeof CLASS_CODE === "undefined" || !CLASS_CODE || typeof getClass !== "function" || typeof t29PlanShareSplit !== "function" || typeof splitCompany !== "function") {
      toast("Share splits aren't ready on this page. Refresh and try again.");
      return;
    }
    const st = studio = { busy: true, names: {}, to: 2, from: 1, opener: document.activeElement, closed: false, done: false };
    let cls = null;
    try { cls = await getClass(CLASS_CODE); } catch (e) { cls = null; }
    const co = cls && (cls.companies || []).find(c => c.id === coId);
    if (!co) { studio = null; toast("Couldn't load that company. Refresh the page and try again."); return; }
    st.co = co;
    st.busy = false;
    // Start on 2-for-1 when it's allowed, otherwise on the first split that is.
    if (!t29PlanShareSplit(co, 2, 1).ok) {
      const first = FORWARD.concat(REVERSE).find(r => t29PlanShareSplit(co, r[0], r[1]).ok);
      if (first) { st.to = first[0]; st.from = first[1]; }
    }
    const root = st.root = document.createElement("div");
    root.className = "t29s-overlay";
    root.innerHTML = `<div class="t29s-studio" role="dialog" aria-modal="true" aria-labelledby="t29sTitle" tabindex="-1">
      <div class="t29s-head">
        <span class="t29s-head-ico">${ico("split", 26)}</span>
        <div class="t29s-head-txt"><h2 id="t29sTitle">Split shares</h2><p id="t29sSub"></p></div>
        <button type="button" class="t29s-x" data-act="close" aria-label="Close">&times;</button>
      </div>
      <div class="t29s-body" id="t29sBody">
        <div class="t29s-cols">
          <div class="t29s-left">
            <h3><span class="t29s-n">1</span> Pick a split</h3>
            <div class="t29s-grp">More shares, cheaper each <small>(a split)</small></div>
            <div class="t29s-chips" id="t29sFwd"></div>
            <div class="t29s-grp">Fewer shares, pricier each <small>(a reverse split)</small></div>
            <div class="t29s-chips" id="t29sRev"></div>
            <div class="t29s-grp">Or make your own</div>
            <div class="t29s-custom">
              <label for="t29sFrom">For every <input id="t29sFrom" type="number" min="1" max="${T29_SPLIT_MAX_FACTOR}" step="1" inputmode="numeric" value="${st.from}"> <span id="t29sFromW"></span></label>
              <label for="t29sTo">holders get <input id="t29sTo" type="number" min="1" max="${T29_SPLIT_MAX_FACTOR}" step="1" inputmode="numeric" value="${st.to}"> <span id="t29sToW"></span></label>
            </div>
          </div>
          <div class="t29s-right">
            <h3><span class="t29s-n">2</span> What will change</h3>
            <div id="t29sStage" aria-live="polite"></div>
            <div id="t29sStats"></div>
            <h3><span class="t29s-n">3</span> Your class</h3>
            <div id="t29sImpact"></div>
          </div>
        </div>
        <div id="t29sMsg" class="t29s-msg" aria-live="polite"></div>
      </div>
      <div class="t29s-foot" id="t29sFoot">
        <p class="t29s-note">A split changes how many shares there are, never what anyone's shares are worth. Charts are adjusted so they don't show a fake drop. Part-shares from a reverse split are paid out in cash.</p>
        <div class="t29s-btns"><button type="button" class="btn secondary" data-act="close">Cancel</button><button type="button" class="btn gold" id="t29sGo" data-act="go" disabled>Pick a split</button></div>
      </div>
    </div>`;
    document.body.appendChild(root);
    lockScroll();
    const dlg = root.querySelector(".t29s-studio");
    root.addEventListener("keydown", keyHandler(dlg, () => { if (!st.busy) closeStudio(st, st.done); }));
    root.addEventListener("mousedown", e => { if (e.target === root && !st.busy) closeStudio(st, st.done); });
    root.addEventListener("click", e => {
      const el = e.target.closest("[data-act]");
      if (!el || !root.contains(el)) return;
      const act = el.getAttribute("data-act");
      if (act === "close") { if (!st.busy) closeStudio(st, st.done); }
      else if (act === "done") closeStudio(st, false);
      else if (act === "pick") {
        st.to = Number(el.dataset.to); st.from = Number(el.dataset.from);
        root.querySelector("#t29sFrom").value = st.from; root.querySelector("#t29sTo").value = st.to;
        paintPreview(st);
      } else if (act === "go") go(st);
    });
    root.addEventListener("input", e => {
      if (e.target.id !== "t29sFrom" && e.target.id !== "t29sTo") return;
      st.from = root.querySelector("#t29sFrom").value === "" ? NaN : Number(root.querySelector("#t29sFrom").value);
      st.to = root.querySelector("#t29sTo").value === "" ? NaN : Number(root.querySelector("#t29sTo").value);
      paintPreview(st);
    });
    paintStatic(st);
    paintPreview(st);
    dlg.focus();
    // Student names arrive a moment later (one read per student); until then the table shows usernames.
    if (typeof getClassStudents === "function") {
      getClassStudents(CLASS_CODE, cls).then(list => {
        (list || []).forEach(u => { if (u && u.username) st.names[u.username] = (typeof t29DisplayName === "function" && t29DisplayName(u)) || u.name || u.username; });
        if (studio === st && !st.done && st.plan && st.plan.ok) st.root.querySelector("#t29sImpact").innerHTML = impactHtml(st, st.plan);
      }).catch(() => { /* usernames are fine */ });
    }
  }

  /* ---------------- The students' split announcement ---------------- */
  let announcing = false;
  const seenMemory = {};
  function seenKey(me) { return "t29-split-seen:" + (me.classCode || "") + ":" + me.username; }
  function readSeen(me) {
    let v = null;
    try { const raw = localStorage.getItem(seenKey(me)); if (raw !== null) v = Number(raw) || 0; } catch (e) { /* storage blocked */ }
    const m = seenMemory[seenKey(me)];
    return m === undefined ? v : (v === null ? m : Math.max(v, m));
  }
  function writeSeen(me, ts) {
    const cur = readSeen(me);
    if (cur !== null && cur >= ts) return;
    seenMemory[seenKey(me)] = ts;
    try { localStorage.setItem(seenKey(me), String(ts)); } catch (e) { /* the in-memory copy still stops repeats */ }
  }
  // Splits this student held shares through that they haven't been shown yet, oldest first.
  function pending(cls, me) {
    const seen = readSeen(me);
    const floor = seen === null ? Date.now() - SHOW_NEW_STUDENT_DAYS * DAY : seen;
    const out = [];
    (cls.companies || []).forEach(co => (Array.isArray(co.splits) ? co.splits : []).forEach(s => {
      const mv = validSplit(s) && s.moves && s.moves[me.username];
      if (mv && Number(s.ts) > floor) out.push({ co, s, mv });
    }));
    return out.sort((a, b) => a.s.ts - b.s.ts);
  }

  function countUp(el, from, to, ms) {
    if (reduced() || from === to) { el.textContent = num(to); return; }
    const t0 = performance.now();
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.min(1, (now - t0) / ms), eased = 1 - Math.pow(1 - k, 3);
      el.textContent = num(Math.round(from + (to - from) * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = num(from);
    setTimeout(() => requestAnimationFrame(step), 650);
  }

  function showAnnouncement(queue, i, me) {
    const item = queue[i], s = item.s, co = item.co, mv = item.mv;
    const fwd = isForward(s), before = Number(mv[0]) || 0, after = Number(mv[1]) || 0, cash = Number(mv[2]) || 0;
    const worth = after * Number(s.priceAfter) + cash;
    const prevFocus = document.activeElement;
    const ov = document.createElement("div");
    ov.className = "t29s-overlay t29s-celebrate";
    const colours = ["#e8b84b", "#3fbf8f", "#5b8def", "#8a7fd6", "#e8735f"];
    const confetti = fwd && !reduced() ? `<div class="t29s-confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, k) => `<i style="--x:${4 + Math.round((k * 92) / 23)};--d:${((k * 37) % 9) / 10 + 0.5}s;--r:${(k * 53) % 360}deg;--c:${colours[k % colours.length]}"></i>`).join("")}</div>` : "";
    const explain = fwd
      ? "Your teacher cut each share into smaller pieces. You have more shares, but each one is worth less, so your total stays the same."
      : "Your teacher joined shares together. You have fewer shares, but each one is worth more, so your total stays the same.";
    const cashLine = cash > 0 ? `<div class="t29s-cel-chip ok">+${money(cash)} cash for a leftover part-share</div>` : "";
    ov.innerHTML = `<div class="t29s-cel${fwd ? "" : " rev"}" role="dialog" aria-modal="true" aria-labelledby="t29sCelTitle" tabindex="-1">
      ${confetti}
      <span class="t29s-cel-tag">${ico("split", 12)} ${fwd ? "Share split" : "Reverse split"}</span>
      <h2 id="t29sCelTitle">${esc(co.name)} ${fwd ? "split" : "combined its shares"} ${esc(label(s.to, s.from))}!</h2>
      <p class="t29s-cel-step">${queue.length > 1 ? `${i + 1} of ${queue.length} &middot; ` : ""}${esc(dateText(s.dateKey))}</p>
      <div class="t29s-pie-wrap">${pieSvg(s.to, true)}</div>
      <div class="t29s-cel-counts">
        <div class="t29s-cel-box"><small>You had</small><b>${num(before)}</b></div>
        <div class="t29s-cel-go" aria-hidden="true">&rarr;</div>
        <div class="t29s-cel-box now"><small>You have</small><b id="t29sCount" aria-live="polite">${num(after)}</b></div>
      </div>
      <div class="t29s-cel-chips">
        <div class="t29s-cel-chip">${priceText(s.priceBefore)} &rarr; ${priceText(s.priceAfter)} a share</div>
        <div class="t29s-cel-chip ok">&check; Still worth ${money(worth)}</div>
        ${cashLine}
      </div>
      <p class="t29s-cel-explain">${esc(after === 0 ? "Your shares were too few to make a whole new share, so you were paid cash for them instead." : explain)}</p>
      <button type="button" class="btn gold" id="t29sGot">${i + 1 < queue.length ? "Next" : fwd ? "Nice!" : "Got it"}</button>
    </div>`;
    document.body.appendChild(ov);
    lockScroll();
    const dlg = ov.querySelector(".t29s-cel"), countEl = ov.querySelector("#t29sCount");
    countUp(countEl, before, after, 900);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      writeSeen(me, Number(s.ts));
      ov.remove();
      unlockScroll();
      if (i + 1 < queue.length) { showAnnouncement(queue, i + 1, me); return; }
      announcing = false;
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (e) { /* redrawn */ } }
    };
    ov.addEventListener("keydown", keyHandler(dlg, close));
    ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
    ov.querySelector("#t29sGot").addEventListener("click", close);
    ov.querySelector("#t29sGot").focus();
  }

  // Called by the Stock Market page after every draw, for students. Shows each unseen split once.
  function celebrate(cls, me) {
    try {
      if (announcing || !cls || !me || !me.username) return;
      const queue = pending(cls, me);
      if (!queue.length) return;
      announcing = true;
      showAnnouncement(queue, 0, me);
    } catch (e) {
      announcing = false;
      console.warn("Split announcement skipped:", e);
    }
  }

  window.T29Split = { open, celebrate, tagHtml, historyHtml, marksSvg, pieSvg };
})();
