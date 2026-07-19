/* ===================== The 29 World — icon set =====================
   Small inline SVG icons, colored via currentColor. Usage: ICONS.coin
====================================================================== */
const ICONS = {
  coin: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" fill="currentColor"/><text x="12" y="16.5" font-size="11" font-weight="900" text-anchor="middle" fill="#1f2b44" font-family="Trebuchet MS, sans-serif">$</text></svg>`,
  piggy: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12c0-3.3 3.1-6 7-6 1 0 1.9.15 2.7.43L15.5 5l2 .3-.6 2.2c1.3 1 2.1 2.5 2.1 4.1v.2l1.8.9c.3.15.3.6-.1.7l-1.9.4c-.3 1.2-1 2.2-2 3v2a1 1 0 0 1-1 1h-1.3a1 1 0 0 1-1-.85l-.1-.6a10 10 0 0 1-2.6 0l-.1.6a1 1 0 0 1-1 .85H8.6a1 1 0 0 1-1-1v-1.8C5.9 15.9 4 14.1 4 12Z" fill="currentColor"/><circle cx="15" cy="10.2" r="1" fill="#1f2b44"/><path d="M2.5 12.5c0-.8.6-1.5 1.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  briefcase: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="8" width="18" height="12" rx="2" fill="currentColor"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="8" width="18" height="12" rx="2" stroke="#1f2b44" stroke-opacity="0" fill="none"/><path d="M3 13h18" stroke="#1f2b44" stroke-opacity=".25" stroke-width="1.4"/><rect x="10.5" y="12" width="3" height="2.4" rx=".5" fill="#1f2b44"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.5 16 10 11l3 3 4.5-6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17.5" cy="7.5" r="1.6" fill="currentColor"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8.5" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="9" r="2.3" fill="currentColor" opacity=".7"/><path d="M2.8 19c.5-3 2.9-5 5.7-5s5.2 2 5.7 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M15 14.5c2.2.3 3.9 2 4.3 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".7"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 9.5 12 4l9 5.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.5" y="10.5" width="15" height="8" rx="1" fill="currentColor" opacity=".18"/><path d="M5.5 19h13M6.5 11v7.5M11 11v7.5M13 11v7.5M17.5 11v7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 3 2.5 10.4c-.7.3-.6 1.3.1 1.5l6.3 1.9 2 6.4c.2.7 1.2.8 1.5.1L21 3Z" fill="currentColor"/><path d="M21 3 8.9 13.8" stroke="#1f2b44" stroke-opacity=".25" stroke-width="1.3"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" fill="currentColor"/><path d="M8 5H5a1 1 0 0 0-1 1v1c0 2 1.5 3.5 3.5 3.7M16 5h3a1 1 0 0 1 1 1v1c0 2-1.5 3.5-3.5 3.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M12 13v3M9 20h6M9.5 20c0-1.8.8-3 2.5-3s2.5 1.2 2.5 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  building: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="8" height="12" rx="1" fill="currentColor"/><rect x="13" y="3" width="7" height="17" rx="1" fill="currentColor" opacity=".65"/><rect x="6" y="10.5" width="1.6" height="1.6" fill="#1f2b44" opacity=".5"/><rect x="9" y="10.5" width="1.6" height="1.6" fill="#1f2b44" opacity=".5"/><rect x="6" y="14" width="1.6" height="1.6" fill="#1f2b44" opacity=".5"/><rect x="9" y="14" width="1.6" height="1.6" fill="#1f2b44" opacity=".5"/><rect x="15" y="6" width="1.4" height="1.4" fill="#1f2b44" opacity=".4"/><rect x="17.5" y="6" width="1.4" height="1.4" fill="#1f2b44" opacity=".4"/><rect x="15" y="9" width="1.4" height="1.4" fill="#1f2b44" opacity=".4"/><rect x="17.5" y="9" width="1.4" height="1.4" fill="#1f2b44" opacity=".4"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7.5v9M7.5 12h9" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z" fill="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.9" fill="none"/><circle cx="12" cy="15" r="1.4" fill="#fff"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="9" r="4.2" fill="currentColor"/><path d="M11 12.2 19.5 20.7M16.5 17.2l2.2-2.2M13.6 14.3l2.2-2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/><path d="M14 8l4.5 4-4.5 4M18.3 12H9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5c-2.6 0-4.4 2-4.4 4.6v3l-1.4 3h11.6l-1.4-3v-3c0-2.6-1.8-4.6-4.4-4.6Z" fill="currentColor"/><path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 5.7A10.7 10.7 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a15.8 15.8 0 0 1-3.4 4.2M6.6 6.9C4 8.7 2 12 2 12s3.6 6.5 10 6.5c1.3 0 2.5-.2 3.6-.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.7 10a2.8 2.8 0 0 0 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="6.5" y="12" width="3" height="3" rx=".5" fill="currentColor"/><rect x="11" y="12" width="3" height="3" rx=".5" fill="currentColor" opacity=".6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 7l1 12.5A2 2 0 0 0 9.5 21h5a2 2 0 0 0 2-1.5L17.5 7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  medal: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3h8l-2.5 6h-3L8 3Z" fill="currentColor" opacity=".6"/><circle cx="12" cy="14" r="6.5" fill="currentColor"/><circle cx="12" cy="14" r="3.6" fill="#1f2b44" opacity=".25"/></svg>`,
  repeat: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4.5v4h-4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19.5v-4h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  idcard: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="5" width="19" height="14" rx="2" fill="currentColor" opacity=".14" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="11.2" r="2.1" fill="currentColor"/><path d="M4.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5 19 6v5.5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6l7-2.5Z" fill="currentColor"/><path d="M9 12.3l2 2 4-4.3" stroke="#1f2b44" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".7"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18h7.2a2 2 0 0 0 2-1.6L20 8H6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="10" cy="21" r="1.5" fill="currentColor"/><circle cx="17" cy="21" r="1.5" fill="currentColor"/></svg>`,
  house: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 11 12 4l8 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 10.5V19a1 1 0 0 0 1 1H9v-4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V20h2.5a1 1 0 0 0 1-1v-8.5" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/><circle cx="8.3" cy="8.3" r="1.3" fill="#1f2b44"/><circle cx="15.7" cy="8.3" r="1.3" fill="#1f2b44"/><circle cx="8.3" cy="15.7" r="1.3" fill="#1f2b44"/><circle cx="15.7" cy="15.7" r="1.3" fill="#1f2b44"/><circle cx="12" cy="12" r="1.3" fill="#1f2b44"/></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15.5 5.6 10a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4L20 15.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="3" y="15" width="18" height="4.5" rx="1.5" fill="currentColor"/><circle cx="7.5" cy="19.5" r="1.6" fill="#1f2b44"/><circle cx="16.5" cy="19.5" r="1.6" fill="#1f2b44"/><path d="M6 11.5h12" stroke="#1f2b44" stroke-width="1.3" stroke-opacity=".3"/></svg>`,
  vault: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor"/><circle cx="12" cy="12" r="4.3" fill="#1f2b44" opacity=".3"/><circle cx="12" cy="12" r="1.6" fill="#1f2b44"/><rect x="15.5" y="6.2" width="1.6" height="1.6" rx=".3" fill="#1f2b44" opacity=".5"/></svg>`,
  handshake: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 11.5 6 8l3.3 2.4a1.6 1.6 0 0 1 0 2.6l-.4.3a1.4 1.4 0 0 0 1.9 2l1-.9M22 11.5 18 8l-4.8 3.5a1.6 1.6 0 0 0 0 2.6c.6.45 1.4.45 2 0l1.3-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9.2 13 11 14.6c.55.5 1.4.5 1.9 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><rect x="2" y="10.5" width="4" height="7" rx="1" fill="currentColor"/><rect x="18" y="10.5" width="4" height="7" rx="1" fill="currentColor"/></svg>`,
  percent: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 19 19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="7" r="3" fill="currentColor"/><circle cx="17" cy="17" r="3" fill="currentColor"/></svg>`
};

// Wraps every password field on the page with a show/hide eye button.
// Safe to call on any page — does nothing if there are no password inputs.
function enablePasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.pwWired) return;
    input.dataset.pwWired = "1";

    const wrap = document.createElement("div");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.setAttribute("aria-label", "Show password");
    btn.innerHTML = icon("eye", 18);
    wrap.appendChild(btn);

    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = icon(showing ? "eye" : "eyeOff", 18);
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
}

function icon(name, size) {
  const s = size || 20;
  return `<span class="icon" style="width:${s}px;height:${s}px;display:inline-flex;">${ICONS[name] || ""}</span>`;
}

// Fills every element with a data-icon attribute (used for nav bars, brand
// marks etc). Safe to call even if some pages don't have any such elements.
function paintIconSlots() {
  document.querySelectorAll("[data-icon]").forEach(el => {
    el.innerHTML = icon(el.getAttribute("data-icon"), el.getAttribute("data-icon-size") || 16);
  });
  const brand = document.getElementById("brandCoin");
  if (brand) brand.innerHTML = icon("coin", 24);
}
