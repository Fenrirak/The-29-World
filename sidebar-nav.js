/* ===================== The 29 World — Sidebar navigation =====================
   Lets students swap the top bar for a left sidebar: a permanent rail on
   computer/tablet screens, a slide-in drawer (opened via a hamburger
   button) on phones. Purely additive — the existing .topbar / nav /
   .topbar-actions markup is reused as-is and simply laid out differently
   by sidebar-nav.css whenever the `sidebar-nav` class is present on
   <html>. This file only:
     - persists the on/off choice to localStorage ('t29-sidebar-nav')
     - injects the hamburger button + mobile backdrop once, and wires
       the mobile drawer open/close behaviour
     - exposes sbIsOn()/sbSetOn() for the Settings switch built in
       settings-menu.js (guarded there via window.T29_HAS_SIDEBAR, set
       inline on every page that loads this file, teacher dashboard
       included)
   - this file is only loaded when the feature is already on (see the
     loader in <head>) or the moment someone flips its switch in
     Settings — never unconditionally
================================================================================ */

var SB_STORAGE_KEY = "t29-sidebar-nav";
var SB_DESKTOP_QUERY = "(min-width: 901px)";

function sbIsOn() {
  try {
    return localStorage.getItem(SB_STORAGE_KEY) === "1";
  } catch (e) {
    return document.documentElement.classList.contains("sidebar-nav");
  }
}

function sbIsDesktop() {
  return window.matchMedia(SB_DESKTOP_QUERY).matches;
}

let sbHamburgerEl = null;
let sbBackdropEl = null;
let sbDrawerOpen = false;

function sbBuildScaffold() {
  if (sbHamburgerEl) return;
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  sbHamburgerEl = document.createElement("button");
  sbHamburgerEl.type = "button";
  sbHamburgerEl.className = "sb-hamburger";
  sbHamburgerEl.setAttribute("aria-label", "Open menu");
  sbHamburgerEl.setAttribute("aria-expanded", "false");
  sbHamburgerEl.innerHTML = `<span class="sb-hamburger-bar"></span>`;
  sbHamburgerEl.addEventListener("click", () => sbSetDrawerOpen(!sbDrawerOpen));
  topbar.insertBefore(sbHamburgerEl, topbar.firstChild);

  sbBackdropEl = document.createElement("div");
  sbBackdropEl.className = "sb-backdrop";
  sbBackdropEl.setAttribute("aria-hidden", "true");
  sbBackdropEl.addEventListener("click", () => sbSetDrawerOpen(false));
  document.body.appendChild(sbBackdropEl);
}

// Keeps the closed mobile drawer out of the tab order (see the matching
// `pointer-events:none` rule in sidebar-nav.css). Desktop's permanent
// rail is always interactive, regardless of this state.
function sbSetDrawerOpen(open) {
  sbDrawerOpen = open;
  document.documentElement.classList.toggle("sidebar-open", open);
  if (sbHamburgerEl) sbHamburgerEl.setAttribute("aria-expanded", String(open));

  // Only the sidebar's own mobile drawer needs the topbar's nav/actions
  // taken out of the tab order while closed. When sidebar-nav mode isn't
  // on at all, this must be a no-op — otherwise every phone-width page
  // load (sbInit() always calls sbApply(sbIsOn()), even when that's
  // false) would mark the *normal* topbar nav inert and make it
  // completely unusable regardless of whether the feature is enabled.
  const sidebarModeOn = document.documentElement.classList.contains("sidebar-nav");
  const nav = document.querySelector(".topbar nav");
  const actions = document.querySelector(".topbar-actions");
  [nav, actions].forEach(el => {
    if (!el) return;
    if (!sidebarModeOn || sbIsDesktop() || open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  });
}

function sbApply(on) {
  document.documentElement.classList.toggle("sidebar-nav", on);
  if (on) {
    sbBuildScaffold();
    sbSetDrawerOpen(false);
  } else {
    sbSetDrawerOpen(false);
  }
  if (typeof positionBalanceWidget === "function") positionBalanceWidget();
}

function sbSetOn(on) {
  try {
    localStorage.setItem(SB_STORAGE_KEY, on ? "1" : "0");
  } catch (e) {
    /* localStorage unavailable (private mode etc) — layout still toggles for this load */
  }
  sbApply(on);
  const cb = document.getElementById("t29SidebarNavToggle");
  if (cb && cb.checked !== on) cb.checked = on;
}

// Tiny local debounce so this file has no dependency on load order
// relative to icons.js (which defines its own copy for the same reason).
function sbDebounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function sbInit() {
  sbApply(sbIsOn());

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && sbDrawerOpen) sbSetDrawerOpen(false);
  });

  // If a resize crosses back up into the permanent-rail width while the
  // mobile drawer happens to be open, close it — the rail takes over and
  // an "open" drawer state underneath it would just be stale.
  window.addEventListener("resize", sbDebounce(() => {
    if (sbDrawerOpen && sbIsDesktop()) sbSetDrawerOpen(false);
  }, 120));

  // Keep in sync if the setting is changed in another tab.
  window.addEventListener("storage", e => {
    if (e.key === SB_STORAGE_KEY) sbApply(e.newValue === "1");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", sbInit);
} else {
  sbInit();
}
