window.T29CreateAvatarTools = function (core) {
  "use strict";
  const { esc, COMET, shopOf, badge } = window.T29Avatar;
  const { CATS, DEFAULT_LOOK, RARITY, renderSvg, cleanLook } = core;
  function priceOf(shop, cat, id, r) {
    if (!r || shop.currency === "free") return 0;
    const k = cat + ":" + id, o = shop.prices[shop.currency][k];
    return o !== undefined ? o : shop.tiers[shop.currency][r];
  }
  function itemsOf(cat) { return CATS.find(c => c.id === cat).list; }
  const rOf = (cat, id) => { const it = itemsOf(cat).find(i => i[0] === id); return it ? it[2] : 0; };
  const nameOf = (cat, id) => { const it = itemsOf(cat).find(i => i[0] === id); return it ? it[1] : id; };
  const R_DESC = ["", "Everyday favourites", "Cool upgrades", "Real show-stoppers", "The rarest of all"];
  function rarityGuide(shop, who) {
    const counts = [0, 0, 0, 0, 0];
    CATS.forEach(c => c.list.forEach(it => { counts[it[2]]++; }));
    const rows = [1, 2, 3, 4].map(r => {
      const price = shop.currency === "free" ? "Free" : fmtPrice(shop, shop.tiers[shop.currency][r]);
      return `<div class="av-rg"><i class="av-r av-r${r} av-rg-dot"></i><span class="av-rg-name"><b>${RARITY[r]}</b><small>${R_DESC[r]} \u00b7 ${counts[r]} items</small></span><span class="av-rg-price">${price}</span></div>`;
    }).join("");
    return `<div class="av-rguide"><div class="av-rg-title">Rarity guide</div>${rows}<div class="av-rg-note">${who === "teacher" ? "The coloured dot on each item shows its rarity. Starter items have no dot and are always free." : "Look for the coloured dot on each item. Starter items have no dot and are always free."}</div></div>`;
  }
  const fmtPrice = (shop, n) => shop.currency === "comets" ? `${COMET}${n}` : (typeof fmtMoney === "function" ? fmtMoney(n) : "$" + n.toFixed(2));

  function css() {
    if (document.getElementById("t29AvToolsCss")) return;
    const st = document.createElement("style");
    st.id = "t29AvToolsCss";
    st.textContent = `
.av-ov{position:fixed;inset:0;z-index:400;background:rgba(15,20,40,.55);display:flex;align-items:center;justify-content:center;padding:12px;}
.av-card{background:var(--card,#fff);color:var(--ink,#1f2b44);border-radius:18px;width:min(940px,100%);max-height:calc(100vh - 24px);display:flex;flex-direction:column;box-shadow:var(--shadow-modal);overflow:hidden;}
.av-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1.5px solid var(--line,#e3e7f0);}
.av-head h3{margin:0;font-size:1.2rem;}
.av-x{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:none;cursor:pointer;color:inherit;--g-size:22px;}
.av-x:hover{background:rgba(128,128,128,.16);}
.av-body{display:flex;gap:18px;padding:16px 18px;overflow:auto;flex:1;min-height:0;}
.av-left{flex:0 0 220px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;}
.av-prev{width:200px;height:200px;min-width:200px;min-height:200px;flex:none;aspect-ratio:1/1;border-radius:50%;overflow:hidden;box-shadow:var(--shadow-box);line-height:0;}
.av-prev svg{display:block;width:100%;height:100%;}
.av-prev.av-initials{display:flex;align-items:center;justify-content:center;font-size:4rem;font-weight:900;color:#fff;line-height:1;background:linear-gradient(135deg,var(--navy-500,#4a5a85),var(--navy-900,#1f2b44));}
.av-chip{display:inline-flex;align-items:center;gap:4px;background:#f1f4fb;border:1.5px solid var(--line,#e3e7f0);border-radius:var(--sw-s,12px 1px 12px 1px / 9px 1px 9px 1px);padding:3px 10px;font-weight:800;font-size:var(--fs-md);}
.av-right{flex:1;min-width:0;display:flex;flex-direction:column;}
.av-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin;}
.av-tab{flex-shrink:0;border:1.5px solid var(--line,#e3e7f0);background:var(--card,#fff);color:inherit;border-radius:var(--sw-m,17px 2px 17px 2px / 13px 2px 13px 2px);padding:6px 12px;font:inherit;font-weight:800;font-size:var(--fs-md);cursor:pointer;}
.av-tab.on{background:var(--navy-900,#1f2b44);color:#fff;border-color:var(--navy-900,#1f2b44);}
.av-hint{font-size:var(--fs-sm);color:var(--muted,#6b7390);margin:2px 0 8px;}
.av-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;overflow:auto;padding:4px 2px 8px;}
.av-tile{position:relative;border:2px solid var(--line,#e3e7f0);background:var(--card,#fff);color:inherit;border-radius:14px;padding:6px 4px 6px;cursor:pointer;font:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;}
.av-tile:hover{border-color:var(--navy-500,#4a5a85);}
.av-tile.on{border-color:var(--gold,#f5b82e);box-shadow:0 0 0 2px var(--gold,#f5b82e) inset;}
.av-tile .av-t-img{width:68px;height:68px;flex:none;aspect-ratio:1/1;border-radius:50%;overflow:hidden;line-height:0;}
.av-tile .av-t-img svg{width:100%;height:100%;}
.av-tile .av-t-name{font-size:var(--fs-xs);font-weight:800;text-align:center;line-height:1.15;}
.av-tile .av-t-price{font-size:var(--fs-xs);font-weight:800;color:var(--muted,#6b7390);}
.av-tile .av-t-price.own{color:#1f8a5b;}
.av-tile .av-r{position:absolute;top:4px;left:4px;width:11px;height:11px;border-radius:50%;border:1.5px solid #fff;box-sizing:border-box;}
.av-rguide{width:100%;text-align:left;border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 10px;font-size:var(--fs-sm);}
.av-rg-title{font-weight:900;margin-bottom:4px;}
.av-rg{display:flex;align-items:center;gap:8px;padding:3px 0;}
.av-rg-dot{position:static !important;display:inline-block;width:12px !important;height:12px !important;border-radius:50%;flex-shrink:0;border:0 !important;}
.av-rg-name{flex:1;min-width:0;line-height:1.15;}
.av-rg-name b{display:block;}
.av-rg-name small{display:block;color:var(--muted,#6b7390);font-size:var(--fs-xs);}
.av-rg-price{font-weight:800;white-space:nowrap;}
.av-rg-note{color:var(--muted,#6b7390);font-size:var(--fs-xs);margin-top:4px;}
.av-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-top:1.5px solid var(--line,#e3e7f0);}
.av-foot .av-sum{flex:1;min-width:180px;font-weight:700;font-size:var(--fs-md);}
.av-foot .av-msg{width:100%;font-weight:700;color:#b8402c;}
.av-bad{color:#b8402c;}
.av-t-wrap details{border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 12px;margin:8px 0;}
.av-t-wrap summary{cursor:pointer;font-weight:800;}
.av-t-wrap table{width:100%;border-collapse:collapse;margin-top:8px;}
.av-t-wrap td{padding:4px 6px;border-top:1px solid var(--line,#e3e7f0);vertical-align:middle;font-size:var(--fs-md);}
.av-t-wrap .av-mini{width:40px;height:40px;flex:none;aspect-ratio:1/1;border-radius:50%;overflow:hidden;line-height:0;}
.av-t-wrap input[type=number]{width:84px;}
.av-t-cur{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;}
.av-t-cur label{display:flex;align-items:center;gap:6px;border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 12px;cursor:pointer;font-weight:800;}
.av-t-tiers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:8px 0;}
@media (max-width:700px){.av-body{flex-direction:column;}.av-left{flex:none;flex-direction:row;flex-wrap:wrap;justify-content:center;}.av-prev{width:120px;height:120px;min-width:120px;min-height:120px;}.av-prev.av-initials{font-size:2.4rem;}.av-t-tiers{grid-template-columns:repeat(2,minmax(0,1fr));}}
.av-t-wrap input[type="radio"],.av-t-wrap input[type="checkbox"],.av-left input[type="checkbox"]{width:18px;height:18px;min-height:auto;padding:0;margin:0;flex-shrink:0;accent-color:var(--navy-900);outline-offset:2px;}
.av-t-cur label{background:var(--card,#fff);color:inherit;line-height:1.2;transition:border-color .15s,box-shadow .15s;}
.av-t-cur label:hover{border-color:var(--navy-500,#4a5a85);}
.av-t-cur label:has(input:checked){border-color:var(--navy-900,#1f2b44);box-shadow:0 0 0 1.5px var(--navy-900,#1f2b44) inset;}
.av-t-cur .av-comet{width:18px;height:18px;margin:0;flex-shrink:0;}
.av-t-wrap label{margin:0;}
html.dark-mode .av-t-wrap input[type="radio"],html.dark-mode .av-t-wrap input[type="checkbox"],html.dark-mode .av-left input[type="checkbox"]{accent-color:var(--gold);}
html.dark-mode .av-t-cur label:has(input:checked){border-color:var(--gold);box-shadow:0 0 0 1.5px var(--gold) inset;}
html.dark-mode .av-chip{background:#222b46;}
html.dark-mode .av-foot .av-msg,html.dark-mode .av-bad{color:#ff9d87;}
html.dark-mode .av-tile .av-t-price.own{color:#5be3a5;}
/* Avatar editor: keep labels inside pills, even in a short or narrow modal. */
.av-tabs{flex:0 0 auto;align-items:center;min-height:52px;overflow-x:auto;overflow-y:hidden;padding:4px 2px 10px;max-width:100%;scroll-padding-inline:4px;}
.av-tabs .av-tab{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:38px;height:auto;max-width:none;padding:8px 14px;line-height:1.25;white-space:nowrap;overflow-wrap:normal;word-break:normal;box-sizing:border-box;margin:0;}
.av-right{min-height:0;min-width:0;}
.av-hint{flex:0 0 auto;line-height:1.45;overflow-wrap:anywhere;}
.av-grid{min-height:0;align-content:start;grid-template-columns:repeat(auto-fill,minmax(min(92px,100%),1fr));}
.av-tile{min-width:0;}
.av-tile .av-t-name,.av-tile .av-t-price{max-width:100%;overflow-wrap:anywhere;line-height:1.3;}
.av-chip{max-width:100%;height:auto;min-height:28px;white-space:normal;overflow-wrap:anywhere;}
.av-paint-box{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;flex:none;padding:10px 12px;margin:0 0 10px;border:1px solid var(--line,#e3e7f0);border-radius:12px;}
.av-paint-box[hidden]{display:none;}
.av-paint-title{font-weight:600;font-size:var(--fs-md);flex:none;}
.av-swatches{display:flex;flex-wrap:wrap;gap:8px;flex:none;}
.av-sw{width:30px;height:30px;min-height:30px;padding:0;border-radius:50%;background:var(--sw);border:2px solid #fff;box-shadow:0 0 0 1px rgba(30,40,80,.28);cursor:pointer;transition:transform .12s;}
.av-sw:hover:not(:disabled){transform:scale(1.1);}
.av-sw:focus-visible{outline:2px solid var(--brand,#3a6cf0);outline-offset:3px;}
.av-sw.on{box-shadow:0 0 0 2.5px var(--brand,#3a6cf0);transform:scale(1.08);}
.av-sw:disabled{opacity:.55;cursor:default;}
.av-paint-box .av-paint-note{flex:1 1 180px;min-width:0;font-size:var(--fs-sm);line-height:1.4;color:var(--muted,#6b7390);}
@media(max-width:700px){.av-right{flex:0 0 auto;}.av-grid{max-height:48vh;}.av-tabs{min-height:52px;}}
`;
    document.head.appendChild(st);
  }
  /* ---------------- editor ---------------- */
  let ED = null;
  async function openEditor(user) {
    if (document.getElementById("avOv")) return;
    css();
    const [me, cls] = await Promise.all([getUser(user.username), getClass(user.classCode)]);
    if (!me) return;
    const av = me.avatar || {};
    ED = {
      me, shop: shopOf(cls), owned: new Set(av.owned || []), look: cleanLook(av.look || DEFAULT_LOOK),
      on: !!av.on, cat: "gender", busy: false,
      purchasedPaint: cleanLook({ warpaintColor: av.warpaintColor || (av.look && av.look.warpaintColor) }).warpaintColor
    };
    const ov = document.createElement("div");
    ov.id = "avOv"; ov.className = "av-ov";
    ov.innerHTML = `<div class="av-card" role="dialog" aria-modal="true" aria-label="Avatar editor">
      <div class="av-head"><h3>Your avatar</h3><button class="av-x" type="button" id="avClose" aria-label="Close">\u00d7</button></div>
      <div class="av-body">
        <div class="av-left"><div class="av-prev" id="avPrev"></div>
          <div id="avWallet" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;"></div>
          <label class="muted-small" style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="avInitials"> Show my initials instead</label>
          <div id="avGuide" style="width:100%;"></div>
          <div id="avLog" class="muted-small"></div></div>
        <div class="av-right"><div class="av-tabs" id="avTabs" role="tablist" aria-label="Avatar categories"></div><div class="av-hint" id="avHint"></div><div class="av-grid" id="avGrid" role="tabpanel"></div></div>
      </div>
      <div class="av-foot"><div class="av-sum" id="avSum"></div><button class="btn secondary" type="button" id="avCancel">Cancel</button><button class="btn gold" type="button" id="avSave">Save</button><div class="av-msg" id="avMsg" aria-live="polite"></div></div>
    </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); ED = null; document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
    ov.querySelector("#avClose").onclick = close;
    ov.querySelector("#avCancel").onclick = close;
    ov.querySelector("#avSave").onclick = () => saveEditor(close, user);
    const chk = ov.querySelector("#avInitials");
    chk.checked = !ED.on;
    chk.onchange = () => { ED.on = !chk.checked; paintEditor(); };
    ov.querySelector("#avTabs").innerHTML = CATS.map(c => `<button type="button" class="av-tab" role="tab" id="av-tab-${c.id}" aria-controls="avGrid" data-cat="${c.id}">${c.label}</button>`).join("");
    ov.querySelector("#avTabs").onclick = e => { const b = e.target.closest("[data-cat]"); if (b) { ED.cat = b.dataset.cat; paintEditor(); } };
    ov.querySelector("#avGrid").onclick = e => {
      const b = e.target.closest("[data-id]"); if (!b) return;
      if (ED.busy) return;
      ED.look[ED.cat] = b.dataset.id; ED.on = true; chk.checked = false; paintEditor();
    };
    const paintBox = document.createElement("div");
    paintBox.id = "avPaintBox"; paintBox.className = "av-paint-box";
    ov.querySelector("#avHint").after(paintBox);
    paintBox.addEventListener("click", e => {
      const b = e.target.closest("[data-paint]");
      if (!b || !ED || ED.busy || !/^#[0-9a-f]{6}$/i.test(b.dataset.paint)) return;
      ED.look.warpaintColor = b.dataset.paint.toLowerCase(); paintEditor();
      const nb = paintBox.querySelector('[aria-pressed="true"]'); if (nb) nb.focus({ preventScroll: true });
    });
    const log = (me.cometLog || []).slice(0, 3).map(l => `<div>${COMET}${l.amount > 0 ? "+" : ""}${esc(l.amount)} ${esc(l.note || "")}</div>`).join("");
    ov.querySelector("#avLog").innerHTML = ED.shop.currency === "comets" && log ? `<b>Recent Comets</b>${log}` : "";
    paintEditor();
  }
  function visible(cat) {
    return itemsOf(cat).filter(it => {
      const key = cat + ":" + it[0];
      return it[2] === 0 || !ED.shop.hidden.includes(key) || ED.owned.has(key) || ED.look[cat] === it[0];
    }).map((it, i) => ({ it, i, p: it[2] === 0 || ED.owned.has(cat + ":" + it[0]) ? (it[2] === 0 ? -1 : 0) : priceOf(ED.shop, cat, it[0], it[2]) }))
      .sort((a, b) => a.p - b.p || a.it[2] - b.it[2] || a.i - b.i).map(x => x.it);
  }
  function cartOf(look, owned, shop, purchasedPaint) {
    const items = [];
    CATS.forEach(c => {
      const id = look[c.id], r = rOf(c.id, id), key = c.id + ":" + id;
      if (r > 0 && (!owned.has(key) || (key === "face:stripes" && look.warpaintColor !== (purchasedPaint || "#3a8dff")))) items.push({ cat: c.id, id, key, price: priceOf(shop, c.id, id, r) });
    });
    return items;
  }
  // readable on every skin tone: no oranges, tans or browns that would blend into skin
  const PAINTS = [["#3a8dff", "Blue"], ["#c52053", "Crimson"], ["#299e60", "Green"], ["#12a8b8", "Teal"], ["#8b5cf6", "Purple"], ["#ec4899", "Pink"], ["#7bc418", "Lime"], ["#24409a", "Navy"]];
  function paintEditor() {
    const E = ED; if (!E) return;
    const $ = id => document.getElementById(id);
    E.look = cleanLook(E.look);
    const prev = $("avPrev");
    if (E.on) { prev.className = "av-prev"; prev.innerHTML = renderSvg(E.look, { size: 200 }); }
    else { prev.className = "av-prev av-initials"; prev.textContent = (typeof initials === "function" ? initials(E.me.name) : "?").replace(/&amp;/g, "&"); }
    document.querySelectorAll("#avTabs .av-tab").forEach(b => {
      const selected = b.dataset.cat === E.cat;
      b.classList.toggle("on", selected);
      b.setAttribute("aria-selected", String(selected));
    });
    $("avGrid").setAttribute("aria-labelledby", "av-tab-" + E.cat);
    const cat = E.cat, list = visible(cat);
    const paintBox = $("avPaintBox");
    if (paintBox) {
      paintBox.hidden = !(cat === "face" && E.look.face === "stripes");
      const changing = E.owned.has("face:stripes") && E.look.warpaintColor !== E.purchasedPaint;
      const cur = E.look.warpaintColor, sw = PAINTS.some(p => p[0] === cur) ? PAINTS : PAINTS.concat([[cur, "Your colour"]]);
      paintBox.innerHTML = `<span class="av-paint-title" id="avPaintLbl">Warpaint colour</span><div class="av-swatches" role="group" aria-labelledby="avPaintLbl">${sw.map(p => `<button type="button" class="av-sw${p[0] === cur ? " on" : ""}" data-paint="${p[0]}" style="--sw:${p[0]}" title="${p[1]}" aria-label="${p[1]}" aria-pressed="${p[0] === cur}" ${E.busy ? "disabled" : ""}></button>`).join("")}</div><span class="av-paint-note">${changing ? "New colour: buy Warpaint again to save it." : E.owned.has("face:stripes") ? "Your purchased colour is locked. Choosing another colour requires buying Warpaint again." : "Choose your colour before buying. Colour changes require another purchase."}</span>`;
    }
    $("avGrid").innerHTML = list.map(it => {
      const id = it[0], r = it[2], key = cat + ":" + id, price = priceOf(E.shop, cat, id, r);
      const own = r === 0 || (E.owned.has(key) && !(key === "face:stripes" && E.look.warpaintColor !== E.purchasedPaint)), on = E.look[cat] === id;
      const look = Object.assign({}, E.look, { [cat]: id });
      const chip = own ? `<span class="av-t-price own">${r === 0 ? "Free" : "Owned"}</span>` : price === 0 ? `<span class="av-t-price own">Free</span>` : `<span class="av-t-price">${fmtPrice(E.shop, price)}</span>`;
      return `<button type="button" class="av-tile${on ? " on" : ""}" data-id="${esc(id)}" aria-pressed="${on}" title="${esc(it[1])} (${RARITY[r]})">${r ? `<i class="av-r av-r${r}"></i>` : ""}<span class="av-t-img">${renderSvg(look, { size: 68 })}</span><span class="av-t-name">${esc(it[1])}</span>${chip}</button>`;
    }).join("");
    const hide = E.look.costume !== "none" && ["hair", "hairColor", "top", "topColor", "hat"].includes(cat);
    $("avGuide").innerHTML = rarityGuide(E.shop, "student");
    $("avHint").textContent = cat === "gender" ? "Pick the body type for your avatar. It makes small changes to face shape and features. Your teacher can also change it." : hide ? "Your costume is covering this, so changes here won't show until you take the costume off." : E.shop.currency === "free" ? "Everything is free in this class. Have fun!" : "";
    const cart = cartOf(E.look, E.owned, E.shop, E.purchasedPaint).filter(i => i.price > 0);
    const total = cart.reduce((a, i) => a + i.price, 0);
    const bal = E.shop.currency === "comets" ? (Number(E.me.comets) || 0) : (Number(E.me.balance) || 0);
    $("avWallet").innerHTML = E.shop.currency === "comets" ? `<span class="av-chip">${COMET}${bal} Comets</span>` : E.shop.currency === "money" ? `<span class="av-chip">${fmtPrice(E.shop, bal)} cash</span>` : "";
    $("avSum").innerHTML = cart.length ? `Buying ${cart.length} new item${cart.length === 1 ? "" : "s"}: <b>${fmtPrice(E.shop, total)}</b>${total > bal ? ` <span class="av-bad">(not enough)</span>` : ""}` : "Nothing to buy.";
    $("avSave").textContent = cart.length ? "Buy & save" : "Save";
  }
  async function saveEditor(close, user) {
    const E = ED; if (!E || E.busy) return;
    E.busy = true;
    const savedLook = cleanLook(E.look);
    const msg = document.getElementById("avMsg"), btn = document.getElementById("avSave");
    btn.disabled = true; msg.textContent = "";
    try {
      const cls = await getClass(user.classCode), shop = shopOf(cls);
      const ref = usersCol().doc(user.username);
      let paid = 0, names = [];
      await fdb.runTransaction(async t => {
        const snap = await t.get(ref);
        const u = snap.data(), a = u.avatar || {};
        const owned = new Set(a.owned || []);
        const cart = cartOf(savedLook, owned, shop, cleanLook({warpaintColor: a.warpaintColor || (a.look && a.look.warpaintColor)}).warpaintColor);
        const total = Math.round(cart.reduce((s, i) => s + i.price, 0) * 100) / 100;
        const upd = {};
        if (total > 0) {
          if (shop.currency === "comets") {
            if ((Number(u.comets) || 0) < total) throw new Error("BROKE");
            upd.comets = (Number(u.comets) || 0) - total;
          } else {
            if ((Number(u.balance) || 0) < total) throw new Error("BROKE");
            upd.balance = Math.round(((Number(u.balance) || 0) - total) * 100) / 100;
          }
        }
        cart.forEach(i => owned.add(i.key));
        // Preserve the purchased paint colour even while another face item is equipped.
        const previousPaint = cleanLook({warpaintColor: a.warpaintColor || (a.look && a.look.warpaintColor)}).warpaintColor;
        const purchasedPaint = savedLook.face === "stripes" ? savedLook.warpaintColor : previousPaint;
        savedLook.warpaintColor = purchasedPaint;
        upd.avatar = { on: E.on, look: savedLook, owned: Array.from(owned), warpaintColor: purchasedPaint };
        paid = total; names = cart.filter(i => i.price > 0).map(i => nameOf(i.cat, i.id));
        t.update(ref, upd);
      });
      if (paid > 0 && shop.currency === "money" && typeof logTxn === "function") {
        await logTxn(user.classCode, { type: "store-buy", from: user.username, amount: paid, note: "Avatar items: " + names.join(", ") }).catch(() => {});
      }
      E.look = savedLook;
      close();
      document.querySelectorAll(`[data-av-user="${CSS.escape(user.username)}"]`).forEach(el => {
        const tmp = document.createElement("div");
        tmp.innerHTML = badge({ username: user.username, name: E.me.name, avatar: E.on ? { on: true, look: E.look } : null }, { size: el.classList.contains("av-big") ? 56 : undefined });
        const nb = tmp.firstChild; if (!nb) return;
        const isEditButton = el.classList.contains("av-big");
        el.className = nb.className + (isEditButton ? " av-big" : "");
        el.innerHTML = nb.innerHTML;
        for (const attr of ["title", "role", "tabindex", "aria-label"]) {
          if (nb.hasAttribute(attr) && (!isEditButton || attr === "title")) el.setAttribute(attr, nb.getAttribute(attr));
          else el.removeAttribute(attr);
        }
      });
      if (typeof window.render === "function") { try { window.render(); } catch (e) { /* ignore */ } }
    } catch (e) {
      msg.textContent = e && e.message === "BROKE" ? `You don't have enough ${E.shop.currency === "comets" ? "Comets" : "money"} for these items.` : "Something went wrong. Please try again.";
      E.busy = false; btn.disabled = false;
    }
  }

  /* ---------------- teacher panel ---------------- */
  async function mountTeacher(u) {
    const host = document.getElementById("avatarShopTeacher");
    if (!host) return;
    css();
    const cls = await getClass(u.classCode);
    const students = (await getClassStudents(u.classCode, cls)).filter(s => s.role === "student");
    const S = shopOf(cls);
    const cur = () => host.querySelector("input[name=avCur]:checked").value;
    const groups = CATS.filter(c => !["skin", "topColor", "gender"].includes(c.id));
    host.innerHTML = `<div class="av-t-wrap">
      <p class="muted-small">Students edit their avatar by clicking their round avatar on their dashboard. Pick how items are paid for. Comets are a separate currency that only you can give, and they can only be spent here.</p>
      <div id="avTGuide" style="margin:8px 0;"></div>
      <div class="av-t-cur">
        <label><input type="radio" name="avCur" value="free"> Free</label>
        <label><input type="radio" name="avCur" value="money"> 29 World money</label>
        <label><input type="radio" name="avCur" value="comets"> ${COMET} Comets</label>
      </div>
      <div id="avTierBox"></div>
      <details><summary>Item prices and hiding items</summary>
        <p class="muted-small">Leave a price blank to use the tier price. Starter items are always free. Tick "Hide" to remove an item from your class's shop.</p>
        <div id="avItemBox"></div></details>
      <button class="btn gold" type="button" id="avTSave">Save avatar shop</button> <span id="avTMsg" aria-live="polite"></span>
      <h3 style="margin-top:18px;">Give Comets</h3>
      <div class="grid grid-2">
        <div><label for="avGStu">Student</label><select id="avGStu"><option value="__all">Whole class</option>${students.map(s => `<option value="${esc(s.username)}">${esc(s.name)}</option>`).join("")}</select></div>
        <div><label for="avGAmt">Comets (negative takes away)</label><input id="avGAmt" type="number" step="1" placeholder="e.g. 5"></div>
      </div>
      <label for="avGNote">Reason</label><input id="avGNote" maxlength="80" placeholder="e.g. Great teamwork">
      <button class="btn" type="button" id="avGGive" style="margin-top:8px;">Give Comets</button> <span id="avGMsg" aria-live="polite"></span>
      <div class="muted-small" id="avGBal" style="margin-top:8px;"></div>
    </div>`;
    host.querySelector(`input[value=${S.currency}]`).checked = true;
    const draft = { tiers: JSON.parse(JSON.stringify(S.tiers)), prices: JSON.parse(JSON.stringify(S.prices)), hidden: S.hidden.slice() };
    function paintTiers() {
      const c = cur(), box = host.querySelector("#avTierBox");
      host.querySelector("#avTGuide").innerHTML = rarityGuide({ currency: c, tiers: draft.tiers }, "teacher");
      if (c === "free") { box.innerHTML = `<p class="muted-small">Everything is free. Students can wear anything.</p>`; return; }
      box.innerHTML = `<div class="muted-small">Default price for each tier (${c === "comets" ? "in Comets" : "in 29 World dollars"}):</div><div class="av-t-tiers">${[1, 2, 3, 4].map(r => `<div><label>${RARITY[r]}</label><input type="number" min="0" step="${c === "comets" ? 1 : .5}" data-tier="${r}" value="${draft.tiers[c][r]}"></div>`).join("")}</div>`;
      box.querySelectorAll("[data-tier]").forEach(i => i.oninput = () => { draft.tiers[c][i.dataset.tier] = Math.max(0, Number(i.value) || 0); host.querySelector("#avTGuide").innerHTML = rarityGuide({ currency: c, tiers: draft.tiers }, "teacher"); });
    }
    function paintItems() {
      const c = cur(), box = host.querySelector("#avItemBox");
      box.innerHTML = groups.map(g => `<details><summary>${g.label}</summary><table>${g.list.filter(it => it[2] > 0).slice().sort((a, b) => a[2] - b[2]).map(it => {
        const key = g.id + ":" + it[0], ov = draft.prices[c === "free" ? "money" : c][key];
        return `<tr><td><div class="av-mini">${renderSvg(Object.assign({}, DEFAULT_LOOK, { [g.id]: it[0] }), { size: 40 })}</div></td><td>${esc(it[1])}<div class="muted-small">${RARITY[it[2]]}</div></td>
          <td><input type="number" min="0" step="any" data-price="${esc(key)}" placeholder="${c === "free" ? "-" : draft.tiers[c][it[2]]}" value="${ov !== undefined ? ov : ""}" ${c === "free" ? "disabled" : ""} aria-label="Price of ${esc(it[1])}"></td>
          <td><label><input type="checkbox" data-hide="${esc(key)}" ${draft.hidden.includes(key) ? "checked" : ""}> Hide</label></td></tr>`;
      }).join("")}</table></details>`).join("");
      box.querySelectorAll("[data-price]").forEach(i => i.oninput = () => {
        const p = draft.prices[cur()];
        if (i.value === "") delete p[i.dataset.price]; else p[i.dataset.price] = Math.max(0, Number(i.value) || 0);
      });
      box.querySelectorAll("[data-hide]").forEach(i => i.onchange = () => {
        const k = i.dataset.hide, at = draft.hidden.indexOf(k);
        if (i.checked && at < 0) draft.hidden.push(k); else if (!i.checked && at >= 0) draft.hidden.splice(at, 1);
      });
    }
    host.querySelectorAll("input[name=avCur]").forEach(r => r.onchange = () => { paintTiers(); paintItems(); });
    paintTiers(); paintItems();
    host.querySelector("#avTSave").onclick = async () => {
      const m = host.querySelector("#avTMsg");
      try {
        await classesCol().doc(u.classCode).update({ avatarShop: { currency: cur(), tiers: draft.tiers, prices: draft.prices, hidden: draft.hidden } });
        m.innerHTML = "Saved."; m.style.color = "#1f8a5b";
      } catch (e) { m.textContent = "Couldn't save. Please try again."; m.style.color = "#b8402c"; }
    };
    const bal = () => { host.querySelector("#avGBal").innerHTML = students.length ? "Comets held: " + students.map(s => `${esc(s.name)} ${COMET}${Number(s.comets) || 0}`).join(" \u00b7 ") : ""; };
    bal();
    host.querySelector("#avGGive").onclick = async () => {
      const m = host.querySelector("#avGMsg"), who = host.querySelector("#avGStu").value;
      const amt = Math.round(Number(host.querySelector("#avGAmt").value) || 0), note = host.querySelector("#avGNote").value.trim();
      if (!amt) { m.textContent = "Enter a number of Comets."; m.style.color = "#b8402c"; return; }
      const targets = who === "__all" ? students : students.filter(s => s.username === who);
      try {
        for (const s of targets) {
          const ref = usersCol().doc(s.username);
          await fdb.runTransaction(async t => {
            const snap = await t.get(ref), d = snap.data();
            const nc = Math.max(0, (Number(d.comets) || 0) + amt);
            t.update(ref, { comets: nc, cometLog: [{ at: Date.now(), amount: amt, note, by: u.name }].concat(d.cometLog || []).slice(0, 20) });
            s.comets = nc;
          });
        }
        m.textContent = `Done: ${amt > 0 ? "gave" : "took"} ${Math.abs(amt)} Comets ${who === "__all" ? "to the whole class" : "to " + targets[0].name}.`; m.style.color = "#1f8a5b";
        bal();
      } catch (e) { m.textContent = "Something went wrong. Please try again."; m.style.color = "#b8402c"; }
    };
  }

  return { openEditor, mountTeacher };
};
