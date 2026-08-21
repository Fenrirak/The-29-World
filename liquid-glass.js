/* ===================== The 29 World — Liquid Glass toggle =====================
   Applies (or removes) Apple-style Liquid Glass styling site-wide.

   How it works:
   - The chosen state is saved to localStorage under 't29-liquid-glass'
     ('1' = on, anything else = off).
   - A tiny inline <script> at the very top of <head> on every page reads
     that value and, if it's on, adds the `liquid-glass` class to <html>
     AND loads this file (+ liquid-glass.css) — all before the page paints,
     so there's no flash of the wrong style. If it's off, none of that
     happens: this file isn't downloaded at all until/unless someone turns
     the feature on.
   - The Settings popover itself (gear icon, the switch that calls
     lgSetOn()) lives in settings-menu.js, not here — that file is small
     and always loaded, since it's what lets someone turn this on in the
     first place. It calls lgSetOn() once this file has finished loading.
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
  } else {
    lgTeardownNavIndicator();
  }
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

function lgInit() {
  lgSetOn(lgIsOn());

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
