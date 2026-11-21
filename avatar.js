/* Avatar badges, enlarged view and on-demand loading for the artwork and shop. */
(function () {
  "use strict";
  const DT = { money: { 1: 5, 2: 15, 3: 40, 4: 100 }, comets: { 1: 1, 2: 3, 3: 8, 4: 20 } };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const COMET = `<svg class="av-comet" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.73 4.79 L5 8.6 L15.67 2.41Z" fill="#8fb8ff" opacity=".85"/><path d="M21.73 8.84 L13 21.6 L19.47 7.56Z" fill="#8fb8ff" opacity=".85"/><path d="M20.26 7.41 L2 22.4 L16.54 3.79Z" fill="#6fa4ff"/><path d="M19.26 6.44 L5 19.6 L17.54 4.76Z" fill="#cfe0ff"/><circle cx="18.4" cy="5.6" r="4.6" fill="#fff2a8" opacity=".5"/><circle cx="18.4" cy="5.6" r="3" fill="#ffc93c"/><circle cx="18.4" cy="5.6" r="1.5" fill="#fff"/></svg>`;
  let ME = null;

  /* ---------------- class settings ---------------- */
  function shopOf(cls) {
    const s = (cls && cls.avatarShop) || {};
    const num = (o, k, d) => (o && Number.isFinite(Number(o[k])) && Number(o[k]) >= 0 ? Number(o[k]) : d);
    const tiers = {}, prices = {};
    ["money", "comets"].forEach(cur => {
      tiers[cur] = {}; prices[cur] = {};
      [1, 2, 3, 4].forEach(r => { tiers[cur][r] = num(s.tiers && s.tiers[cur], r, DT[cur][r]); });
      const p = (s.prices && s.prices[cur]) || {};
      Object.keys(p).forEach(k => { if (Number.isFinite(Number(p[k])) && Number(p[k]) >= 0) prices[cur][k] = Number(p[k]); });
    });
    return { currency: ["free", "money", "comets"].includes(s.currency) ? s.currency : "free", tiers, prices, hidden: Array.isArray(s.hidden) ? s.hidden : [] };
  }

  // Share requests across all badges and allow a later click to retry a failed download.
  const pendingScripts = new Map();
  function loadScript(src) {
    if (!pendingScripts.has(src)) {
      pendingScripts.set(src, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          pendingScripts.delete(src);
          reject(new Error("Could not load " + src));
        };
        document.head.appendChild(script);
      }));
    }
    return pendingScripts.get(src);
  }

  async function loadRenderer() {
    if (!window.T29AvatarCore) await loadScript("avatar-renderer.js?v=f19b02eb");
    return window.T29AvatarCore;
  }

  let tools;
  async function loadTools() {
    if (tools) return tools;
    const [core] = await Promise.all([loadRenderer(), loadScript("avatar-tools.js?v=b696e3e2")]);
    tools ??= window.T29CreateAvatarTools(core);
    return tools;
  }

  function badge(user, opts = {}) {
    const un = (user && user.username) || "", name = (user && user.name) || "";
    const sz = opts.size, style = sz ? ` style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .34)}px;"` : "";
    const attr = ` data-av-user="${esc(un)}"`;
    const col = typeof avatarClass === "function" && un ? avatarClass(un) : "c1";
    const letters = typeof initials === "function" ? initials(name) : "?";
    const av = user && user.avatar;
    if (av && av.on && av.look) {
      if (un) SEEN.set(un, { name, look: av.look });
      const core = window.T29AvatarCore;
      const image = core ? core.renderSvg(av.look, { size: sz || 38, label: name })
        : `<t29-avatar-art data-look="${esc(JSON.stringify(av.look))}" data-size="${sz || 38}">${letters}</t29-avatar-art>`;
      return `<span class="student-avatar av-img ${core ? "av-rendered" : col}"${attr}${style} title="${esc(name)}" role="button" tabindex="0" aria-label="View ${esc(name || "this")} avatar larger">${image}</span>`;
    }
    SEEN.delete(un);
    return `<span class="student-avatar ${col}"${attr}${style}>${letters}</span>`;
  }

  customElements.define("t29-avatar-art", class extends HTMLElement {
    async connectedCallback() {
      try {
        const core = await loadRenderer();
        if (!this.isConnected) return;
        const badge = this.parentElement;
        const svg = core.renderSvg(JSON.parse(this.dataset.look), {
          size: Number(this.dataset.size), label: badge.title
        });
        badge.classList.add("av-rendered");
        this.outerHTML = svg;
      } catch (e) { /* Keep initials visible if the artwork cannot load. */ }
    }
  });

  function css() {
    if (document.getElementById("t29AvCss")) return;
    const st = document.createElement("style");
    st.id = "t29AvCss";
    st.textContent = `
html .student-avatar.av-rendered{background:none !important;padding:0;overflow:hidden;box-shadow:var(--shadow-btn);}
.student-avatar.av-img{flex:none;aspect-ratio:1/1;}
.student-avatar.av-img svg{display:block;width:100%;height:100%;}
.av-comet{width:1.05em;height:1.05em;vertical-align:-.18em;margin-right:2px;}
.av-self-btn{position:relative;border:0;background:none;padding:0;cursor:pointer;border-radius:50%;flex-shrink:0;margin-right:12px;line-height:0;}
.av-self-btn .student-avatar{margin:0;}
.av-self-btn:hover{transform:scale(1.05);}
.av-self-btn .av-pen{position:absolute;right:-3px;bottom:-3px;width:22px;height:22px;border-radius:50%;background:var(--gold,#f5b82e);color:#1f2b44;display:flex;align-items:center;justify-content:center;line-height:0;border:2px solid #fff;}
.av-self-btn .av-pen svg{display:block;flex:none;}
.av-r1{background:#9aa3b5}.av-r2{background:#3a8dff}.av-r3{background:#a45cff}.av-r4{background:#ffb020;box-shadow:0 0 6px #ffb020}
.av-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:450;background:#1f2b44;color:#fff;border-radius:14px;padding:12px 16px;font-weight:700;box-shadow:var(--shadow-pop);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);}
.av-toast button{border:0;border-radius:10px;padding:6px 10px;font-weight:800;cursor:pointer;background:#f5b82e;color:#1f2b44;}
.av-toast .av-toast-x{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;margin:-4px -6px -4px -4px;padding:0;border-radius:50%;background:none;color:#fff;--g-size:20px;}
.av-toast .av-toast-x:hover{background:rgba(255,255,255,.16);}
html.dark-mode .av-self-btn .av-pen{border-color:#1a2036;}
.av-img[data-av-user]{cursor:zoom-in;transition:transform .15s ease,box-shadow .15s ease;}
.av-img[data-av-user]:hover{transform:scale(1.08);}
.av-img[data-av-user]:focus-visible{outline:3px solid var(--gold,#f5b82e);outline-offset:2px;}
.av-lb{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(15,20,40,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:avLbFade .18s ease-out both;overscroll-behavior:contain;}
.av-lb.av-lb-out{animation:avLbFadeOut .17s ease-in both;}
.av-lb.av-lb-out .av-lb-card{animation:avLbPopOut .17s ease-in both;}
.av-lb-card{position:relative;width:min(400px,100%);max-height:calc(100vh - 28px);max-height:calc(100dvh - 28px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1f2b44);border-radius:24px;box-shadow:var(--shadow-modal);animation:avLbPop .32s cubic-bezier(.2,1.25,.4,1) both;}
.av-lb-hero{position:relative;display:flex;align-items:center;justify-content:center;padding:34px 20px 30px;background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.16),rgba(255,255,255,0) 62%),linear-gradient(160deg,var(--navy-500,#4a5a85),var(--navy-900,#1f2b44));}
.av-lb-av{width:min(270px,64vw,38vh);aspect-ratio:1/1;border-radius:50%;overflow:hidden;line-height:0;flex:none;background:#fff;box-shadow:0 0 0 6px rgba(255,255,255,.92),0 14px 36px rgba(0,0,0,.4);}
.av-lb-av svg{display:block;width:100%;height:100%;}
.av-lb-t2 .av-lb-av{box-shadow:0 0 0 6px #3a8dff,0 0 30px 4px rgba(58,141,255,.45),0 14px 36px rgba(0,0,0,.4);}
.av-lb-t3 .av-lb-av{box-shadow:0 0 0 6px #a45cff,0 0 38px 8px rgba(164,92,255,.55),0 14px 36px rgba(0,0,0,.4);}
.av-lb-t4 .av-lb-av{box-shadow:0 0 0 6px #ffb020,0 0 46px 12px rgba(255,176,32,.6),0 14px 36px rgba(0,0,0,.4);}
.av-lb-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s;}
.av-lb-x:hover{background:rgba(255,255,255,.32);transform:scale(1.08);}
.av-lb-x:focus-visible{outline:3px solid var(--gold,#f5b82e);outline-offset:2px;}
.av-lb-info{padding:18px 22px 24px;text-align:center;}
.av-lb-name{margin:0 0 8px;font-size:1.5rem;line-height:1.2;word-break:break-word;}
.av-lb-pill{display:inline-block;padding:3px 12px;border-radius:var(--sw-s,12px 1px 12px 1px / 9px 1px 9px 1px);font-weight:600;font-size:var(--fs-sm);color:#fff;background:#9aa3b5;}
.av-lb-p2{background:#3a8dff}.av-lb-p3{background:#a45cff}.av-lb-p4{background:linear-gradient(135deg,#ffb020,#ff8a1f);color:#3b2600;}
.av-lb-sub{font-size:var(--fs-md);opacity:.7;}
.av-lb-sec{margin:18px 0 8px;font-size:var(--fs-xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.6;}
.av-lb-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;}
.av-lb-chip{display:inline-flex;align-items:center;gap:6px;background:#f1f4fb;border:1.5px solid var(--line,#e3e7f0);border-radius:var(--sw-s,12px 1px 12px 1px / 9px 1px 9px 1px);padding:4px 10px;font-weight:700;font-size:var(--fs-sm);line-height:1.2;}
.av-lb-chip small{opacity:.55;font-weight:600;font-size:var(--fs-xs);}
.av-lb-more{opacity:.75;}
.av-lb-dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block;}
@keyframes avLbFade{from{opacity:0}to{opacity:1}}
@keyframes avLbFadeOut{from{opacity:1}to{opacity:0}}
@keyframes avLbPop{from{opacity:0;transform:translateY(14px) scale(.9)}to{opacity:1;transform:none}}
@keyframes avLbPopOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px) scale(.95)}}
@media (prefers-reduced-motion:reduce){.av-lb,.av-lb-card{animation:none !important}.av-img[data-av-user]{transition:none}.av-img[data-av-user]:hover{transform:none}}
.leaderboard-row .student-avatar{width:48px !important;height:48px !important;min-width:48px;font-size:16px !important;}
.leaderboard-row .av-img[data-av-user]{cursor:zoom-in !important;}
html.dark-mode .av-lb-chip{background:#222b46;}
html.dark-mode .av-lb-card{box-shadow:var(--shadow-modal),0 0 0 1px rgba(255,255,255,.08);}
.av-lb-chip{max-width:100%;height:auto;min-height:28px;white-space:normal;overflow-wrap:anywhere;}
.av-lb-chip>span{min-width:0;}
`;
    document.head.appendChild(st);
  }
  function toast(html, btnText, onBtn, persistent = false) {
    css();
    const old = document.getElementById("avToast"); if (old) old.remove();
    const t = document.createElement("div"); t.id = "avToast"; t.className = "av-toast"; t.setAttribute("role", "status");
    t.innerHTML = `<span>${html}</span>${btnText ? `<button type="button">${btnText}</button>` : ""}<button type="button" class="av-toast-x" aria-label="Close">\u00d7</button>`;
    const bs = t.querySelectorAll("button");
    if (btnText) bs[0].onclick = () => { t.remove(); onBtn(); };
    bs[bs.length - 1].onclick = () => t.remove();
    document.body.appendChild(t);
    if (!persistent) setTimeout(() => t.remove(), 12000);
    return t;
  }

  /* ---------------- enlarged avatar view (click anyone else's avatar) ---------------- */
  const SEEN = new Map();   // username -> { name, look } for every avatar badge drawn on this page
  let LB = null;
  function lbItems(look, CATS) {
    const out = [];
    CATS.forEach(c => {
      const it = c.list.find(i => i[0] === look[c.id]);
      if (it && it[2] > 0) out.push({ cat: c.label, name: it[1], r: it[2] });
    });
    return out.sort((a, b) => b.r - a.r);
  }
  // Overall rarity = average rarity of every equipped item, rounded up (0 Starter .. 4 Legendary).
  // Only non-starter items are averaged; starter items and empty ("none") slots are ignored. No non-starter items = Starter.
  function lbAvg(look, { CATS, NONE_IDS }) {
    let sum = 0, n = 0;
    CATS.forEach(c => {
      if (look[c.id] === NONE_IDS[c.id]) return;
      const it = c.list.find(i => i[0] === look[c.id]);
      if (!it) return;
      const r = Number(it[2]) || 0;
      if (r > 0) { sum += r; n++; }   // starter items (rarity 0) are ignored
    });
    const avg = n ? sum / n : 0;
    return { avg, n, sum, tier: Math.min(4, Math.ceil(avg - 1e-9)) };
  }
  function closeAvatarView(instant) {
    if (!LB) return;
    const L = LB; LB = null;
    document.removeEventListener("keydown", L.onKey, true);
    const done = () => {
      L.ov.remove();
      document.body.style.overflow = L.prevOverflow;
      if (L.opener && document.contains(L.opener)) { try { L.opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };
    if (instant || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return done();
    L.ov.classList.add("av-lb-out");
    setTimeout(done, 170);
  }
  async function openAvatarView(un, opener) {
    if (LB || document.getElementById("avLb")) return;
    let info = SEEN.get(un);
    if (!info) {
      try {
        const u = await getUserCached(un);
        if (u && u.avatar && u.avatar.on && u.avatar.look) {
          info = { name: u.name || "", look: u.avatar.look };
          SEEN.set(un, info);
        }
      } catch (e) { /* ignore */ }
    }
    if (!info) return;
    const core = await loadRenderer();
    const { cleanLook, renderSvg, CATS, RARITY } = core;
    if (LB || document.getElementById("avLb")) return;
    css();
    const look = cleanLook(info.look), name = info.name || "Student";
    const items = lbItems(look, CATS), ra = lbAvg(look, core), top = ra.tier, MAX = 12;
    const chips = items.slice(0, MAX).map(i => `<span class="av-lb-chip"><i class="av-lb-dot av-r${i.r}"></i><span>${esc(i.name)}</span><small>${esc(i.cat)}</small></span>`).join("")
      + (items.length > MAX ? `<span class="av-lb-chip av-lb-more">+${items.length - MAX} more</span>` : "");
    const ov = document.createElement("div");
    ov.id = "avLb"; ov.className = "av-lb";
    ov.innerHTML = `<div class="av-lb-card" role="dialog" aria-modal="true" aria-label="${esc(name)}'s avatar">
      <div class="av-lb-hero av-lb-t${top}">
        <button class="av-lb-x" type="button" aria-label="Close">\u00d7</button>
        <div class="av-lb-av"${look.fx === "glow" ? ' style="background:#ffd23f"' : ""}>${renderSvg(look, { size: 300, animate: true, label: name + "'s avatar" })}</div>
      </div>
      <div class="av-lb-info">
        <h3 class="av-lb-name">${esc(name)}</h3>
        ${top ? `<span class="av-lb-pill av-lb-p${top}" title="Average rarity ${ra.avg.toFixed(2)} across ${ra.n} non-starter item${ra.n === 1 ? "" : "s"}, rounded up">${RARITY[top]} look</span>` : `<span class="av-lb-sub">Rocking the starter look</span>`}
        ${items.length ? `<div class="av-lb-sec">Wearing</div><div class="av-lb-chips">${chips}</div>` : ""}
      </div>
    </div>`;
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const x = ov.querySelector(".av-lb-x");
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeAvatarView(); }
      else if (e.key === "Tab") { e.preventDefault(); x.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    LB = { ov, opener, onKey, prevOverflow };
    x.onclick = () => closeAvatarView();
    ov.addEventListener("click", e => { if (e.target === ov) closeAvatarView(); });
    x.focus({ preventScroll: true });
  }
  function initAvatarView() {
    // capture phase: beats row/card click handlers (e.g. the teacher's student rows) for avatars that aren't your own
    document.addEventListener("click", e => {
      if (LB) return;
      const el = e.target.closest && e.target.closest(".student-avatar.av-img[data-av-user]");
      if (!el) return;
      const un = el.dataset.avUser;
      // your own avatar opens the editor everywhere except the leaderboard, where it gets the same popup as everyone else
      if (!un || (ME && ME.role === "student" && un === ME.username && !el.closest(".leaderboard-row"))) return;
      e.preventDefault(); e.stopPropagation();
      openAvatarView(un, el).catch(() => toast("Couldn't load the avatar. Please try again."));
    }, true);
    document.addEventListener("keydown", e => {
      if (LB || (e.key !== "Enter" && e.key !== " ")) return;
      const el = e.target;
      if (el && el.matches && el.matches(".student-avatar.av-img[data-av-user][role=button]")) { e.preventDefault(); el.click(); }
    });
  }


  let openingEditor = false;
  async function openEditor() {
    if (!ME || ME.role !== "student" || openingEditor || document.getElementById("avOv")) return;
    openingEditor = true;
    const loading = toast("Loading avatar editor…", null, null, true);
    try {
      const tools = await loadTools();
      await tools.openEditor(ME);
    } catch (e) {
      toast("Couldn’t open the avatar editor. Please try again.");
    } finally {
      loading.remove();
      openingEditor = false;
    }
  }

  function initTeacherShop(user) {
    const button = document.getElementById("avatarShopOpen");
    if (!button) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Loading avatar shop…";
      try {
        const tools = await loadTools();
        await tools.mountTeacher(user);
        button.remove();
      } catch (e) {
        document.getElementById("avatarShopTeacher").textContent = "Couldn’t load the avatar shop. Please try again.";
        button.textContent = "Retry avatar shop";
        button.disabled = false;
      }
    });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    let u = null;
    try { u = await getSessionUser(); } catch (e) { return; }
    if (!u) return;
    ME = { username: u.username, role: u.role, classCode: u.classCode };
    css();
    initAvatarView();
    const sty = document.createElement("style");
    sty.textContent = `.student-avatar[data-av-user="${String(u.username).replace(/["\\]/g, "")}"]{cursor:${u.role === "student" ? "pointer" : "default"};}`;
    document.head.appendChild(sty);
    if (u.role === "student") {
      document.addEventListener("click", e => {
        const el = e.target.closest("[data-av-user]");
        if (el && el.dataset.avUser === ME.username) openEditor();
      });
      const row = document.querySelector(".greeting-row");
      if (row && !row.querySelector(".av-self-btn")) {
        const me = await getUserCached(u.username).catch(() => null);
        const b = document.createElement("button");
        b.type = "button"; b.className = "av-self-btn"; b.title = "Edit my avatar"; b.setAttribute("aria-label", "Edit my avatar");
        b.innerHTML = badge({ username: u.username, name: u.name, avatar: me && me.avatar }, { size: 56 }).replace('class="student-avatar', 'class="av-big student-avatar').replace(/ role="button" tabindex="0" aria-label="[^"]*"/, "") + `<span class="av-pen"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M9 17.5V6.2A1.7 1.7 0 0 1 10.7 4.5h2.6A1.7 1.7 0 0 1 15 6.2v11.3l-3 3.6z" fill="currentColor" transform="rotate(45 12 12)"/></svg></span>`;
        b.onclick = e => { e.stopPropagation(); openEditor(); };
        row.insertBefore(b, row.firstChild);
      }
      try {
        const me = await getUserCached(u.username), c = Number(me && me.comets) || 0, key = "t29-comets-seen-" + u.username;
        const seen = localStorage.getItem(key);
        if (seen !== null && c > Number(seen)) toast(`${COMET} You received <b>${c - Number(seen)}</b> Comet${c - Number(seen) === 1 ? "" : "s"}! Use them to customise your avatar.`, "Open editor", openEditor);
        localStorage.setItem(key, String(c));
      } catch (e) { /* ignore */ }
    } else if (u.role === "teacher") {
      initTeacherShop(u);
    }
  }

  async function setGender(username, g) {
    if (!["neutral", "boy", "girl"].includes(g)) return { ok: false, error: "Unknown body type." };
    try {
      await usersCol().doc(username).update({ "avatar.look.gender": g });
      return { ok: true };
    } catch (e) { return { ok: false, error: "Couldn't save the body type. Please try again." }; }
  }

  window.avatarBadge = badge;
  window.T29Avatar = { badge, openEditor, shopOf, setGender, esc, COMET };
  document.addEventListener("DOMContentLoaded", () => { boot().catch(() => {}); });
})();

