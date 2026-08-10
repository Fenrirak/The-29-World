/* ===================== The 29 World — Liquid Glass toggle =====================
   Adds a "Settings" popover (opened from the gear icon next to Log out) with
   a single switch that turns Apple-style Liquid Glass styling on or off.

   How it works:
   - The chosen state is saved to localStorage under 't29-liquid-glass'
     ('1' = on, anything else = off).
   - A tiny inline <script> at the very top of <head> on every page reads
     that value and adds/removes the `liquid-glass` class on <html> BEFORE
     the page paints, so there's no flash of the wrong style.
   - This file wires up the settings button + switch, and keeps the class
     in sync if the value changes here or in another tab.
   - Every Liquid Glass visual rule lives in liquid-glass.css, scoped under
     `html.liquid-glass`. With the class absent, the site looks exactly the
     way it always has — nothing in this file touches layout or colour
     directly.
================================================================================ */

const LG_STORAGE_KEY = "t29-liquid-glass";

function lgIsOn() {
  try {
    return localStorage.getItem(LG_STORAGE_KEY) === "1";
  } catch (e) {
    return document.documentElement.classList.contains("liquid-glass");
  }
}

function lgSetOn(on) {
  document.documentElement.classList.toggle("liquid-glass", on);
  try {
    localStorage.setItem(LG_STORAGE_KEY, on ? "1" : "0");
  } catch (e) {
    /* localStorage unavailable (private mode etc) — class still toggles for this load */
  }
  document.querySelectorAll(".btn-icon-topbar#settingsBtn").forEach(btn => {
    btn.classList.toggle("active", on);
  });
  const cb = document.getElementById("t29LiquidGlassToggle");
  if (cb && cb.checked !== on) cb.checked = on;

  if (on) {
    lgBuildNavIndicator();
    lgBuildActionsIndicator();
  } else {
    lgTeardownNavIndicator();
    lgTeardownActionsIndicator();
  }
}

function lgBuildPopover() {
  if (document.getElementById("t29SettingsPopover")) return document.getElementById("t29SettingsPopover");

  const pop = document.createElement("div");
  pop.id = "t29SettingsPopover";
  pop.className = "settings-popover hidden";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Display settings");

  pop.innerHTML = `
    <div class="settings-popover-heading">${typeof icon === "function" ? icon("settings", 15) : ""}<span>Display settings</span></div>
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
  `;

  document.body.appendChild(pop);

  const cb = pop.querySelector("#t29LiquidGlassToggle");
  cb.checked = lgIsOn();
  cb.addEventListener("change", () => lgSetOn(cb.checked));

  return pop;
}

function lgPositionPopover(pop, btn) {
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

function lgClosePopover() {
  const pop = document.getElementById("t29SettingsPopover");
  const btn = document.getElementById("settingsBtn");
  if (pop) pop.classList.add("hidden");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function lgOpenPopover(btn) {
  const pop = lgBuildPopover();
  lgPositionPopover(pop, btn);
  btn.setAttribute("aria-expanded", "true");
}

/* ---------------- Topbar nav sliding indicator ----------------
   One pill that slides between nav links (Dashboard, Jobs, etc.) instead
   of each link independently fading its own background in/out. Built only
   while Liquid Glass is on; torn down when it's switched off so the plain
   topbar goes back to being untouched by this file, as documented above. */

let lgNavIndicator = null;
let lgNavResizeObserver = null;

function lgActiveNavLink(nav) {
  return nav.querySelector("a.active");
}

function lgMoveNavIndicator(link, nav, indicator, opts) {
  opts = opts || {};
  if (!link) {
    indicator.classList.remove("is-visible");
    return;
  }
  const navRect = nav.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const x = linkRect.left - navRect.left;
  const y = linkRect.top - navRect.top;

  if (opts.instant) indicator.style.transition = "none";

  indicator.style.width = `${linkRect.width}px`;
  indicator.style.height = `${linkRect.height}px`;
  indicator.style.transform = `translate(${x}px, ${y}px)`;
  indicator.classList.toggle("is-active-state", !!opts.isActiveState);
  indicator.classList.add("is-visible");

  if (opts.instant) {
    // Force a reflow so this instant jump doesn't get animated, while
    // leaving the transition ready for the very next (real) move.
    indicator.getBoundingClientRect();
    indicator.style.transition = "";
  }
}

function lgSyncNavIndicator(instant) {
  if (!lgNavIndicator) return;
  const nav = lgNavIndicator.parentElement;
  if (!nav) return;
  const hovered = nav.querySelector("a:hover:not(.nav-locked)");
  const active = lgActiveNavLink(nav);
  const target = hovered || active;
  lgMoveNavIndicator(target, nav, lgNavIndicator, {
    instant,
    isActiveState: target === active
  });
}

function lgBuildNavIndicator() {
  const nav = document.querySelector(".topbar nav");
  if (!nav || (lgNavIndicator && nav.contains(lgNavIndicator))) return;

  const indicator = document.createElement("span");
  indicator.className = "lg-nav-indicator";
  indicator.setAttribute("aria-hidden", "true");
  nav.prepend(indicator);
  lgNavIndicator = indicator;

  nav.querySelectorAll("a").forEach(link => {
    if (link.classList.contains("nav-locked")) return;
    link.addEventListener("mouseenter", () => {
      lgMoveNavIndicator(link, nav, indicator, { isActiveState: link.classList.contains("active") });
    });
  });
  nav.addEventListener("mouseleave", () => lgSyncNavIndicator(false));

  lgSyncNavIndicator(true);

  if (window.ResizeObserver) {
    lgNavResizeObserver = new ResizeObserver(() => lgSyncNavIndicator(true));
    lgNavResizeObserver.observe(nav);
  }
  window.addEventListener("resize", () => lgSyncNavIndicator(true));
}

function lgTeardownNavIndicator() {
  if (lgNavResizeObserver) {
    lgNavResizeObserver.disconnect();
    lgNavResizeObserver = null;
  }
  if (lgNavIndicator && lgNavIndicator.parentElement) {
    lgNavIndicator.parentElement.removeChild(lgNavIndicator);
  }
  lgNavIndicator = null;
}

/* ---------------- Topbar action buttons (settings, logout, ...) ----------------
   Same idea as the nav indicator above: instead of each button (.btn-logout,
   .btn-icon-topbar) carrying its own separate glass "bubble", one pill
   lives behind the group and slides/melts from button to button as the
   mouse moves over them, so they read as one connected glass surface.
   Only built if those buttons turn out to share a common parent element —
   if the markup doesn't group them that way, this quietly no-ops and the
   buttons just render with no encasing (no broken layout either way). */

let lgActionsIndicator = null;
let lgActionsParent = null;
let lgActionsResizeObserver = null;
let lgActionsResizeBound = false;

function lgFindActionsGroup() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return null;
  const buttons = Array.from(topbar.querySelectorAll(".btn-logout, .btn-icon-topbar"));
  if (buttons.length < 2) return null;
  const parent = buttons[0].parentElement;
  if (!parent || !buttons.every(b => b.parentElement === parent)) return null;
  return { parent, buttons };
}

function lgMoveActionsIndicator(btn, parent, indicator, opts) {
  opts = opts || {};
  if (!btn) {
    indicator.classList.remove("is-visible");
    return;
  }
  const parentRect = parent.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const x = btnRect.left - parentRect.left;
  const y = btnRect.top - parentRect.top;

  if (opts.instant) indicator.style.transition = "none";

  indicator.style.width = `${btnRect.width}px`;
  indicator.style.height = `${btnRect.height}px`;
  indicator.style.transform = `translate(${x}px, ${y}px)`;
  indicator.classList.toggle("is-active-state", btn.classList.contains("active"));
  indicator.classList.add("is-visible");

  if (opts.instant) {
    // Force a reflow so this instant jump doesn't get animated, while
    // leaving the transition ready for the very next (real) move.
    indicator.getBoundingClientRect();
    indicator.style.transition = "";
  }
}

function lgSyncActionsIndicator(instant) {
  if (!lgActionsIndicator || !lgActionsParent) return;
  const hovered = lgActionsParent.querySelector(".btn-logout:hover, .btn-icon-topbar:hover");
  lgMoveActionsIndicator(hovered, lgActionsParent, lgActionsIndicator, { instant });
}

function lgBuildActionsIndicator() {
  const group = lgFindActionsGroup();
  if (!group) return;
  const { parent, buttons } = group;
  if (lgActionsIndicator && parent.contains(lgActionsIndicator)) return;

  parent.classList.add("lg-actions-track");

  const indicator = document.createElement("span");
  indicator.className = "lg-actions-indicator";
  indicator.setAttribute("aria-hidden", "true");
  parent.prepend(indicator);
  lgActionsIndicator = indicator;
  lgActionsParent = parent;

  buttons.forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      lgMoveActionsIndicator(btn, parent, indicator);
    });
  });
  parent.addEventListener("mouseleave", () => {
    indicator.classList.remove("is-visible");
  });

  if (window.ResizeObserver) {
    lgActionsResizeObserver = new ResizeObserver(() => lgSyncActionsIndicator(true));
    lgActionsResizeObserver.observe(parent);
  }
  if (!lgActionsResizeBound) {
    window.addEventListener("resize", () => lgSyncActionsIndicator(true));
    lgActionsResizeBound = true;
  }
}

function lgTeardownActionsIndicator() {
  if (lgActionsResizeObserver) {
    lgActionsResizeObserver.disconnect();
    lgActionsResizeObserver = null;
  }
  if (lgActionsIndicator && lgActionsIndicator.parentElement) {
    lgActionsIndicator.parentElement.classList.remove("lg-actions-track");
    lgActionsIndicator.parentElement.removeChild(lgActionsIndicator);
  }
  lgActionsIndicator = null;
  lgActionsParent = null;
}

function lgInit() {
  lgSetOn(lgIsOn());

  const btn = document.getElementById("settingsBtn");
  if (!btn) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const pop = document.getElementById("t29SettingsPopover");
    const isOpen = pop && !pop.classList.contains("hidden");
    if (isOpen) {
      lgClosePopover();
    } else {
      lgOpenPopover(btn);
    }
  });

  document.addEventListener("click", e => {
    const pop = document.getElementById("t29SettingsPopover");
    if (!pop || pop.classList.contains("hidden")) return;
    if (pop.contains(e.target) || e.target === btn || btn.contains(e.target)) return;
    lgClosePopover();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") lgClosePopover();
  });

  window.addEventListener("resize", () => {
    const pop = document.getElementById("t29SettingsPopover");
    if (pop && !pop.classList.contains("hidden")) lgPositionPopover(pop, btn);
  });

  // Keep in sync if the setting is changed in another tab.
  window.addEventListener("storage", e => {
    if (e.key === LG_STORAGE_KEY) lgSetOn(e.newValue === "1");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", lgInit);
} else {
  lgInit();
}
