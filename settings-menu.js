/* ===================== The 29 World — Settings menu (always loaded) =====================
   Builds and drives the gear-icon "Settings" popover (Liquid Glass switch,
   Sidebar navigation switch, Change password). This file is small and is
   the ONE settings-related file every page with a #settingsBtn loads
   unconditionally — it has to be, since it's what lets someone turn a
   feature on in the first place.

   The actual feature code lives in:
     - liquid-glass.js / liquid-glass.css  (visual theme + nav indicator)
     - sidebar-nav.js  / sidebar-nav.css   (side-panel layout + drawer)

   Those bundles are only fetched when a feature is already on for this
   visitor (via the loader in each page's <head>) or the instant someone
   flips its switch here (see smLoadFeature below) — never "just in case".
   That's what keeps a phone that has never touched either setting from
   downloading either bundle.

   Whether the Sidebar navigation row shows up at all is controlled by
   `window.T29_HAS_SIDEBAR`, set inline in <head> only on pages that offer
   it (mirrors the old `typeof sbIsOn === "function"` guard, but doesn't
   require sidebar-nav.js to already be loaded to make that decision).
================================================================================ */

var LG_STORAGE_KEY = "t29-liquid-glass";
var SB_STORAGE_KEY = "t29-sidebar-nav";

function smReadFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (e) {
    return false;
  }
}

function smHasSidebar() {
  return window.T29_HAS_SIDEBAR === true;
}

const SM_BUNDLES = {
  lg: { css: "liquid-glass.css", js: "liquid-glass.js", setter: "lgSetOn" },
  sb: { css: "sidebar-nav.css", js: "sidebar-nav.js", setter: "sbSetOn" }
};

// Loads a feature's CSS+JS the first time it's needed (idempotent — safe to
// call even if the page's <head> loader already injected it, or if it's
// requested twice in a row before the first request finishes).
function smLoadFeature(name) {
  const bundle = SM_BUNDLES[name];
  return new Promise(resolve => {
    if (typeof window[bundle.setter] === "function") return resolve();

    if (!document.querySelector(`link[href="${bundle.css}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = bundle.css;
      document.head.appendChild(link);
    }

    let script = document.querySelector(`script[src="${bundle.js}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = bundle.js;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
  });
}

function smWireToggle(cb, name, storageKey) {
  if (!cb) return;
  cb.checked = smReadFlag(storageKey);
  cb.addEventListener("change", () => {
    const on = cb.checked;
    smLoadFeature(name).then(() => window[SM_BUNDLES[name].setter](on));
  });
}

function smBuildPopover() {
  if (document.getElementById("t29SettingsPopover")) return document.getElementById("t29SettingsPopover");

  const pop = document.createElement("div");
  pop.id = "t29SettingsPopover";
  pop.className = "settings-popover hidden";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Display settings");

  pop.innerHTML = `
    <div class="settings-popover-heading">${typeof icon === "function" ? icon("settings", 15) : ""}<span>Settings</span></div>
    <div class="settings-popover-row">
      <div class="settings-popover-text">
        <div class="settings-popover-title">Liquid Glass design</div>
        <div class="settings-popover-desc">Apple-style frosted glass look across the whole site. Off keeps the classic look.</div>
      </div>
      <label class="lg-switch">
        <input type="checkbox" id="t29LiquidGlassToggle">
        <span class="lg-switch-track"><span class="lg-switch-thumb"></span></span>
      </label>
    </div>
    ${smHasSidebar() ? `
    <div class="settings-popover-row">
      <div class="settings-popover-text">
        <div class="settings-popover-title">Sidebar navigation</div>
        <div class="settings-popover-desc">Move the menu to a side panel instead of the top bar — a slide-out drawer on phones.</div>
      </div>
      <label class="lg-switch">
        <input type="checkbox" id="t29SidebarNavToggle">
        <span class="lg-switch-track"><span class="lg-switch-thumb"></span></span>
      </label>
    </div>` : ""}
    <div class="settings-popover-row" id="t29ChangePasswordRow" style="cursor:pointer;">
      <div class="settings-popover-text">
        <div class="settings-popover-title">Change password</div>
        <div class="settings-popover-desc">You'll stay signed in here — any other device you're logged in on will need to sign back in.</div>
      </div>
      <span aria-hidden="true" style="color:var(--muted);font-size:1.1rem;">›</span>
    </div>
  `;

  document.body.appendChild(pop);

  smWireToggle(pop.querySelector("#t29LiquidGlassToggle"), "lg", LG_STORAGE_KEY);
  if (smHasSidebar()) smWireToggle(pop.querySelector("#t29SidebarNavToggle"), "sb", SB_STORAGE_KEY);

  // openPasswordModal() lives in data.js (loaded on every page) — the
  // typeof guard is defensive only, in case some future page ever loads
  // this file without data.js.
  const pwRow = pop.querySelector("#t29ChangePasswordRow");
  if (pwRow) {
    if (typeof openPasswordModal === "function") {
      pwRow.addEventListener("click", () => {
        smClosePopover();
        openPasswordModal();
      });
    } else {
      pwRow.style.display = "none";
    }
  }

  return pop;
}

function smPositionPopover(pop, btn) {
  const rect = btn.getBoundingClientRect();
  const margin = 10;
  pop.style.visibility = "hidden";
  pop.classList.remove("hidden");
  const popRect = pop.getBoundingClientRect();

  let left = rect.right - popRect.width;
  left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
  let top = rect.bottom + 8;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - 8);
  }

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = "";
}

function smClosePopover() {
  const pop = document.getElementById("t29SettingsPopover");
  const btn = document.getElementById("settingsBtn");
  if (pop) pop.classList.add("hidden");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function smOpenPopover(btn) {
  const pop = smBuildPopover();
  smPositionPopover(pop, btn);
  btn.setAttribute("aria-expanded", "true");
}

function smInit() {
  const btn = document.getElementById("settingsBtn");
  if (!btn) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const pop = document.getElementById("t29SettingsPopover");
    const isOpen = pop && !pop.classList.contains("hidden");
    if (isOpen) {
      smClosePopover();
    } else {
      smOpenPopover(btn);
    }
  });

  document.addEventListener("click", e => {
    const pop = document.getElementById("t29SettingsPopover");
    if (!pop || pop.classList.contains("hidden")) return;
    if (pop.contains(e.target) || e.target === btn || btn.contains(e.target)) return;
    smClosePopover();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") smClosePopover();
  });

  window.addEventListener("resize", () => {
    const pop = document.getElementById("t29SettingsPopover");
    if (pop && !pop.classList.contains("hidden")) smPositionPopover(pop, btn);
  });

  // Keep in sync if a feature is switched on/off in another tab — loading
  // its bundle first if this tab never has.
  window.addEventListener("storage", e => {
    if (e.key === LG_STORAGE_KEY) {
      const on = e.newValue === "1";
      smLoadFeature("lg").then(() => window.lgSetOn(on));
    } else if (e.key === SB_STORAGE_KEY && smHasSidebar()) {
      const on = e.newValue === "1";
      smLoadFeature("sb").then(() => window.sbSetOn(on));
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", smInit);
} else {
  smInit();
}
