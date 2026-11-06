/* ===================== The 29 World — icon set =====================
   Small inline SVG icons, colored via currentColor. Usage: ICONS.coin
====================================================================== */
const ICONS = {
  coin: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-coin" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><text x="12" y="16.5" font-size="11" font-weight="900" text-anchor="middle" fill="#000" font-family="Trebuchet MS, sans-serif">$</text></mask></defs><g mask="url(#m-coin)"><circle cx="12" cy="12" r="9.5" fill="currentColor"/></g></svg>`,
  piggy: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-piggy" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="15" cy="10.2" r="1" fill="#000"/></mask></defs><g mask="url(#m-piggy)"><path d="M4 12c0-3.3 3.1-6 7-6 1 0 1.9.15 2.7.43L15.5 5l2 .3-.6 2.2c1.3 1 2.1 2.5 2.1 4.1v.2l1.8.9c.3.15.3.6-.1.7l-1.9.4c-.3 1.2-1 2.2-2 3v2a1 1 0 0 1-1 1h-1.3a1 1 0 0 1-1-.85l-.1-.6a10 10 0 0 1-2.6 0l-.1.6a1 1 0 0 1-1 .85H8.6a1 1 0 0 1-1-1v-1.8C5.9 15.9 4 14.1 4 12Z" fill="currentColor"/></g><path d="M2.5 12.5c0-.8.6-1.5 1.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  briefcase: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-briefcase" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M3 13h18" stroke="#000" stroke-opacity=".25" stroke-width="1.4"/><rect x="10.5" y="12" width="3" height="2.4" rx=".5" fill="#000"/></mask></defs><g mask="url(#m-briefcase)"><rect x="3" y="8" width="18" height="12" rx="2" fill="currentColor"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="1.8"/></g></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.5 16 10 11l3 3 4.5-6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17.5" cy="7.5" r="1.6" fill="currentColor"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8.5" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="9" r="2.3" fill="currentColor" opacity=".7"/><path d="M2.8 19c.5-3 2.9-5 5.7-5s5.2 2 5.7 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M15 14.5c2.2.3 3.9 2 4.3 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".7"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 9.5 12 4l9 5.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.5" y="10.5" width="15" height="8" rx="1" fill="currentColor" opacity=".18"/><path d="M5.5 19h13M6.5 11v7.5M11 11v7.5M13 11v7.5M17.5 11v7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-send" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M21 3 8.9 13.8" stroke="#000" stroke-opacity=".25" stroke-width="1.3"/></mask></defs><g mask="url(#m-send)"><path d="M21 3 2.5 10.4c-.7.3-.6 1.3.1 1.5l6.3 1.9 2 6.4c.2.7 1.2.8 1.5.1L21 3Z" fill="currentColor"/></g></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" fill="currentColor"/><path d="M8 5H5a1 1 0 0 0-1 1v1c0 2 1.5 3.5 3.5 3.7M16 5h3a1 1 0 0 1 1 1v1c0 2-1.5 3.5-3.5 3.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M12 13v3M9 20h6M9.5 20c0-1.8.8-3 2.5-3s2.5 1.2 2.5 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  building: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-building" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><rect x="6" y="10.5" width="1.6" height="1.6" fill="#000" opacity=".5"/><rect x="9" y="10.5" width="1.6" height="1.6" fill="#000" opacity=".5"/><rect x="6" y="14" width="1.6" height="1.6" fill="#000" opacity=".5"/><rect x="9" y="14" width="1.6" height="1.6" fill="#000" opacity=".5"/><rect x="15" y="6" width="1.4" height="1.4" fill="#000" opacity=".4"/><rect x="17.5" y="6" width="1.4" height="1.4" fill="#000" opacity=".4"/><rect x="15" y="9" width="1.4" height="1.4" fill="#000" opacity=".4"/><rect x="17.5" y="9" width="1.4" height="1.4" fill="#000" opacity=".4"/></mask></defs><g mask="url(#m-building)"><rect x="4" y="8" width="8" height="12" rx="1" fill="currentColor"/><rect x="13" y="3" width="7" height="17" rx="1" fill="currentColor" opacity=".65"/></g></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-plus" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M12 7.5v9M7.5 12h9" stroke="#000" stroke-width="2" stroke-linecap="round"/></mask></defs><g mask="url(#m-plus)"><circle cx="12" cy="12" r="10" fill="currentColor"/></g></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z" fill="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-lock" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="15" r="1.4" fill="#000"/></mask></defs><g mask="url(#m-lock)"><rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.9" fill="none"/></g></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="9" r="4.2" fill="currentColor"/><path d="M11 12.2 19.5 20.7M16.5 17.2l2.2-2.2M13.6 14.3l2.2-2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/><path d="M14 8l4.5 4-4.5 4M18.3 12H9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5c-2.6 0-4.4 2-4.4 4.6v3l-1.4 3h11.6l-1.4-3v-3c0-2.6-1.8-4.6-4.4-4.6Z" fill="currentColor"/><path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 5.7A10.7 10.7 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a15.8 15.8 0 0 1-3.4 4.2M6.6 6.9C4 8.7 2 12 2 12s3.6 6.5 10 6.5c1.3 0 2.5-.2 3.6-.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.7 10a2.8 2.8 0 0 0 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="currentColor" opacity=".16" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="6.5" y="12" width="3" height="3" rx=".5" fill="currentColor"/><rect x="11" y="12" width="3" height="3" rx=".5" fill="currentColor" opacity=".6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 7l1 12.5A2 2 0 0 0 9.5 21h5a2 2 0 0 0 2-1.5L17.5 7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  medal: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-medal" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="14" r="3.6" fill="#000" opacity=".25"/></mask></defs><g mask="url(#m-medal)"><path d="M8 3h8l-2.5 6h-3L8 3Z" fill="currentColor" opacity=".6"/><circle cx="12" cy="14" r="6.5" fill="currentColor"/></g></svg>`,
  repeat: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4.5v4h-4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19.5v-4h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  idcard: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="5" width="19" height="14" rx="2" fill="currentColor" opacity=".14" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="11.2" r="2.1" fill="currentColor"/><path d="M4.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5 19 6v5.5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6l7-2.5Z" fill="currentColor"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18h7.2a2 2 0 0 0 2-1.6L20 8H6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="10" cy="21" r="1.5" fill="currentColor"/><circle cx="17" cy="21" r="1.5" fill="currentColor"/></svg>`,
  house: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 11 12 4l8 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 10.5V19a1 1 0 0 0 1 1H9v-4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V20h2.5a1 1 0 0 0 1-1v-8.5" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-dice" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="8.3" cy="8.3" r="1.3" fill="#000"/><circle cx="15.7" cy="8.3" r="1.3" fill="#000"/><circle cx="8.3" cy="15.7" r="1.3" fill="#000"/><circle cx="15.7" cy="15.7" r="1.3" fill="#000"/><circle cx="12" cy="12" r="1.3" fill="#000"/></mask></defs><g mask="url(#m-dice)"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></g></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-car" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="7.5" cy="19.5" r="2.9" fill="#000"/><circle cx="16.5" cy="19.5" r="2.9" fill="#000"/><path d="M6 11.5h12" stroke="#000" stroke-width="1.3" stroke-opacity=".3"/></mask></defs><g mask="url(#m-car)"><path d="M4 15.5 5.6 10a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4L20 15.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="3" y="15" width="18" height="4.5" rx="1.5" fill="currentColor"/></g><circle cx="7.5" cy="19.5" r="2" fill="currentColor"/><circle cx="16.5" cy="19.5" r="2" fill="currentColor"/></svg>`,
  vault: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-vault" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="4.3" fill="#000" opacity=".3"/><circle cx="12" cy="12" r="1.6" fill="#000"/><rect x="15.5" y="6.2" width="1.6" height="1.6" rx=".3" fill="#000" opacity=".5"/></mask></defs><g mask="url(#m-vault)"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor"/></g></svg>`,
  handshake: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 11.5 6 8l3.3 2.4a1.6 1.6 0 0 1 0 2.6l-.4.3a1.4 1.4 0 0 0 1.9 2l1-.9M22 11.5 18 8l-4.8 3.5a1.6 1.6 0 0 0 0 2.6c.6.45 1.4.45 2 0l1.3-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9.2 13 11 14.6c.55.5 1.4.5 1.9 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><rect x="2" y="10.5" width="4" height="7" rx="1" fill="currentColor"/><rect x="18" y="10.5" width="4" height="7" rx="1" fill="currentColor"/></svg>`,
  loan: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14.6" cy="6.6" r="4.9" stroke="currentColor" stroke-width="1.7"/><path d="M16 5.2c-.3-.5-.8-.8-1.4-.8-.8 0-1.4.4-1.4 1 0 1.5 2.9.7 2.9 2.2 0 .6-.6 1.1-1.5 1.1-.7 0-1.3-.3-1.5-.8M14.6 3.4v1M14.6 8.7v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 15.3h2.6l3.1-1.4c.9-.4 1.9-.4 2.8 0l3.7 1.8c.9.4 1 1.6.2 2.1l-.3.2c-.5.3-1.1.3-1.6 0l-2-1.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="m12.9 18 4.3-2.1c.7-.4 1.5-.4 2.2 0l2.1 1.2-6.3 4.4c-.7.5-1.6.6-2.4.3L5.1 19.7H2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  percent: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 19 19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="7" r="3" fill="currentColor"/><circle cx="17" cy="17" r="3" fill="currentColor"/></svg>`,
  cards: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-cards" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><text x="13.5" y="12.5" font-size="7.5" font-weight="900" text-anchor="middle" fill="#000" font-family="Trebuchet MS, sans-serif">A</text></mask></defs><g mask="url(#m-cards)"><rect x="2.5" y="6" width="12" height="16" rx="1.6" transform="rotate(-8 8.5 14)" fill="currentColor" opacity=".55"/><rect x="7.5" y="4" width="12" height="16" rx="1.6" fill="currentColor"/></g></svg>`,
  kiwi: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-kiwi" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="17.7" cy="9.6" r=".95" fill="#000"/></mask></defs><g mask="url(#m-kiwi)"><ellipse cx="10.5" cy="12.5" rx="7.5" ry="5.8" fill="currentColor"/><circle cx="17" cy="10.2" r="2.7" fill="currentColor"/><path d="M19.2 11.2c1.6.9 2.8 2.4 3.4 4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g><path d="M9 17.8V21h1.8M13 17.8V21h1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" fill="currentColor"/><path d="M19.4 13.6a7.6 7.6 0 0 0 0-3.2l1.9-1.3-1.6-2.8-2.2.7a7.6 7.6 0 0 0-2.8-1.6L14.3 3h-4.6l-.4 2.4a7.6 7.6 0 0 0-2.8 1.6l-2.2-.7-1.6 2.8 1.9 1.3a7.6 7.6 0 0 0 0 3.2l-1.9 1.3 1.6 2.8 2.2-.7c.8.7 1.8 1.3 2.8 1.6l.4 2.4h4.6l.4-2.4a7.6 7.6 0 0 0 2.8-1.6l2.2.7 1.6-2.8-1.9-1.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none" opacity=".85"/></svg>`,
  creditcard: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-creditcard" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><rect x="2.5" y="9" width="19" height="3" fill="#000" opacity=".85"/><rect x="5.5" y="14.5" width="5" height="1.8" rx=".9" fill="#000" opacity=".85"/></mask></defs><g mask="url(#m-creditcard)"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" fill="currentColor"/></g></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" fill="currentColor"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" fill="currentColor" opacity=".7"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" fill="currentColor" opacity=".7"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8" fill="currentColor"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-wallet" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><rect x="14" y="10.5" width="7" height="4.5" rx="1.6" fill="#000" opacity=".9"/></mask></defs><g mask="url(#m-wallet)"><rect x="3" y="6" width="18" height="13" rx="2.5" fill="currentColor"/><path d="M3 9.5V7.5A2.5 2.5 0 0 1 5.5 5H16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g><circle cx="16.6" cy="12.75" r="1" fill="currentColor"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.6-7.6a1 1 0 0 1-.3-.7z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-book" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M9 8h6M9 11.5h6" stroke="#000" stroke-width="1.6" stroke-linecap="round" opacity=".9"/></mask></defs><g mask="url(#m-book)"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z" fill="currentColor"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" stroke="currentColor" stroke-width="1.8" fill="none"/></g></svg>`,
  quiz: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4.5" y="4.5" width="15" height="17" rx="2.8" stroke="currentColor" stroke-width="1.8"/><rect x="8.4" y="2.4" width="7.2" height="4.2" rx="1.5" fill="currentColor"/><path d="m8 11.4 1.5 1.5 2.7-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.2 11.3h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m8 16.9 1.5 1.5 2.7-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.2 16.8h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.5 20c.6-4 3.5-6.2 7.5-6.2s6.9 2.2 7.5 6.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  at: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-at" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><text x="12" y="16.4" font-size="12" font-weight="900" text-anchor="middle" fill="#000" font-family="Trebuchet MS, sans-serif">@</text></mask></defs><g mask="url(#m-at)"><circle cx="12" cy="12" r="9.5" fill="currentColor"/></g></svg>`,
  mortarboard: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4 2.5 9 12 14l9.5-5L12 4Z" fill="currentColor"/><path d="M6.5 11.8v4c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/><path d="M21.5 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" fill="currentColor"/><path d="M19 15.5c.25 1.9 1 2.6 2.8 2.8-1.8.25-2.55 1-2.8 2.8-.25-1.8-1-2.55-2.8-2.8 1.8-.2 2.55-.9 2.8-2.8Z" fill="currentColor" opacity=".7"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 2.5 5 13.5h5.8l-1.3 8L19 10h-6l.5-7.5Z" fill="currentColor"/></svg>`,
  save: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-save" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><rect x="8" y="3.5" width="7" height="4.6" rx=".8" fill="#000" opacity=".9"/><rect x="7" y="12.5" width="10" height="8" rx="1" fill="#000" opacity=".9"/></mask></defs><g mask="url(#m-save)"><path d="M6 3.5h9.8c.4 0 .8.16 1.06.44l2.2 2.2c.28.28.44.66.44 1.06V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" fill="currentColor"/></g><rect x="12.6" y="4.8" width="1.5" height="2" rx=".4" fill="currentColor"/><rect x="9" y="15.2" width="6" height="1.4" rx=".7" fill="currentColor" opacity=".45"/></svg>`,
  hourglass: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5.5" y="2.8" width="13" height="2.6" rx="1.3" fill="currentColor"/><rect x="5.5" y="18.6" width="13" height="2.6" rx="1.3" fill="currentColor"/><path d="M7.8 5.4h8.4c0 2.6-1.5 4.4-4.2 6.6-2.7-2.2-4.2-4-4.2-6.6Z" fill="currentColor" opacity=".35"/><path d="M7.8 18.6h8.4c0-2.6-1.5-4.4-4.2-6.6-2.7 2.2-4.2 4-4.2 6.6Z" fill="currentColor" opacity=".35"/><path d="M9.6 6.8h4.8c-.2 1.3-1 2.2-2.4 3.3-1.4-1.1-2.2-2-2.4-3.3Z" fill="currentColor"/><path d="M8.6 18.6c.5-1.7 1.6-2.7 3.4-3.7 1.8 1 2.9 2 3.4 3.7Z" fill="currentColor"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-edit" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M14.5 6l3.5 3.5" stroke="#000" stroke-width="1.6" stroke-linecap="round" opacity=".85"/></mask></defs><g mask="url(#m-edit)"><path d="M4 20l1-4.5L16.5 4a1.7 1.7 0 0 1 2.4 0l1.1 1.1a1.7 1.7 0 0 1 0 2.4L8.5 19 4 20Z" fill="currentColor"/></g></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-check" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#m-check)"><circle cx="12" cy="12" r="10" fill="currentColor"/></g></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-note" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" stroke="#000" stroke-width="1.6" stroke-linecap="round" opacity=".9"/></mask></defs><g mask="url(#m-note)"><rect x="5" y="3.5" width="14" height="17" rx="2" fill="currentColor"/></g></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-target" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="5.8" fill="#000" opacity=".9"/></mask></defs><g mask="url(#m-target)"><circle cx="12" cy="12" r="9.5" fill="currentColor"/></g><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>`,
  ticket: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-ticket" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M14 7.5v9" stroke="#000" stroke-width="1.4" stroke-dasharray="1.6 2" opacity=".85"/></mask></defs><g mask="url(#m-ticket)"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" fill="currentColor"/></g></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m-history" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M12 7v5.2l3.4 2" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#m-history)"><circle cx="12" cy="12" r="9.5" fill="currentColor"/></g></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
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

let _iconUid = 0;
// Masks need document-unique ids, so each rendered copy gets its own suffix.
function svgFor(name) {
  if (!Object.prototype.hasOwnProperty.call(ICONS, name)) return "";
  const uid = ++_iconUid;
  return ICONS[name].replace(/(id="|url\(#)(m-[\w-]+)/g, (_, p, id) => p + id + "-" + uid);
}

function icon(name, size) {
  const s = size || 20;
  return `<span class="icon" style="width:${s}px;height:${s}px;display:inline-flex;">${svgFor(name)}</span>`;
}

// Fills every element with a data-icon attribute (used for nav bars, brand
// marks etc). Safe to call even if some pages don't have any such elements.
function paintIconSlots() {
  document.querySelectorAll("[data-icon]").forEach(el => {
    el.innerHTML = icon(el.getAttribute("data-icon"), el.getAttribute("data-icon-size") || 16);
  });
  const brand = document.getElementById("brandCoin");
  if (brand) brand.innerHTML = icon("coin", 24);
  fitTopbar();
}

/* ===================== Dynamic topbar fitting =====================
   Measures the topbar's real available width against what the nav
   actually needs at full size, then sets --navscale so it always fits on
   one line — instead of relying on fixed breakpoints. In portrait, CSS
   takes over instead (icon-only nav, allowed to wrap), so this leaves
   --navscale alone there. Runs on load, resize, and orientation change.
====================================================================== */
function fitTopbar() {
  _fitTopbarCore();
  guardTopbarOverflow();
  saveTopbarFit();
}

// Round DOWN to 3dp: toFixed() can round UP, which is enough to push the last
// button a fraction of a pixel past the edge.
function _ns(v) { return (Math.floor(v * 1000) / 1000).toFixed(3); }

// How many px the bar's content runs past its right edge (<= 0 means it fits).
function _topbarOverflow(tb) {
  const cs = getComputedStyle(tb);
  const limit = tb.getBoundingClientRect().left + tb.clientWidth - (parseFloat(cs.paddingRight) || 0);
  const actions = tb.querySelector(".topbar-actions") || tb.querySelector(".btn-logout");
  const aRight = actions ? actions.getBoundingClientRect().right : 0;
  return Math.max(tb.scrollWidth - tb.clientWidth, aRight - limit);
}

/* Last line of defence. The fit above predicts widths from a measurement at
   full size; if anything makes that prediction short (an unusual font or
   text-zoom, a link added later, a very narrow window) this checks what was
   ACTUALLY laid out and escalates until it fits: icon-only, then smaller
   (never below 0.6 so icons stay tappable), then wrapping onto a second row
   like portrait does. So the bar can never run off the screen. */
function guardTopbarOverflow() {
  const tb = document.querySelector(".topbar");
  const nav = tb ? tb.querySelector("nav") : null;
  if (!nav) return;
  tb.classList.remove("nav-wrap");
  if (document.documentElement.classList.contains("sidebar-nav")) return;
  if (window.matchMedia("(orientation: portrait)").matches) return;
  let over = _topbarOverflow(tb);
  if (over <= 1) return;
  if (!nav.classList.contains("force-icons")) {
    nav.classList.add("force-icons");
    over = _topbarOverflow(tb);
  }
  let sc = parseFloat(tb.style.getPropertyValue("--navscale")) || 1;
  for (let i = 0; i < 4 && over > 1 && sc > 0.6; i++) {
    const natural = nav.scrollWidth || 1;
    const next = Math.max(0.6, sc * Math.max(0.5, (natural - over - 1) / natural));
    sc = Math.min(sc, next);
    tb.style.setProperty("--navscale", _ns(sc));
    over = _topbarOverflow(tb);
  }
  if (over > 1) tb.classList.add("nav-wrap");
}

/* Remembers the last fit (scale, tight/icon-only mode, which role-based
   links and the bell are showing) per window width and signed-in user. A tiny
   inline script after the top bar on every page (topbar-boot) replays it
   BEFORE first paint, so the bar opens at its final size instead of starting
   at full size and re-shrinking each time something async arrives (icons,
   bell, teacher/KiwiSaver/casino links). */
const TOPBAR_FIT_KEY = "t29-topbar-fit";
function saveTopbarFit() {
  try {
    const topbar = document.querySelector(".topbar");
    const nav = topbar ? topbar.querySelector("nav") : null;
    const root = document.documentElement;
    if (!nav || root.classList.contains("sidebar-nav")) return;
    const sess = JSON.parse(localStorage.getItem("anw_session") || "null");
    const u = sess && sess.username;
    if (!u) return;
    const k = window.innerWidth + (window.matchMedia("(orientation: portrait)").matches ? "p" : "l");
    let c = JSON.parse(localStorage.getItem(TOPBAR_FIT_KEY) || "null");
    if (!c || c.u !== u || !c.f) c = { u: u, f: {} };
    const sc = parseFloat(topbar.style.getPropertyValue("--navscale"));
    delete c.f[k];
    c.f[k] = {
      s: isFinite(sc) ? sc : 0,
      t: nav.classList.contains("nav-tight") ? 1 : 0,
      i: nav.classList.contains("force-icons") ? 1 : 0,
      w: topbar.classList.contains("nav-wrap") ? 1 : 0,
      b: document.getElementById("notifBell") ? 1 : 0,
      c: ["role-teacher", "ks-on", "casino-on"].filter(x => root.classList.contains(x))
    };
    const keys = Object.keys(c.f);
    while (keys.length > 6) delete c.f[keys.shift()];
    localStorage.setItem(TOPBAR_FIT_KEY, JSON.stringify(c));
  } catch (e) { /* storage unavailable: just no pre-paint replay */ }
}

function _fitTopbarCore() {
  const topbar = document.querySelector(".topbar");
  const nav = topbar ? topbar.querySelector("nav") : null;
  if (!topbar || !nav) return;

  // Sidebar navigation (see sidebar-nav.js/.css) lays the nav out
  // vertically with its own sizing — the horizontal width-fit logic
  // below doesn't apply and would just fight it.
  if (document.documentElement.classList.contains("sidebar-nav")) {
    topbar.style.removeProperty("--navscale");
    nav.classList.remove("force-icons", "nav-tight");
    return;
  }

  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  if (isPortrait) {
    // Portrait handles itself via CSS (icon-only + wrapping); don't fight it.
    topbar.style.removeProperty("--navscale");
    nav.classList.remove("force-icons", "nav-tight");
    return;
  }

  // Reset to full size and drop any icon-only fallback so we measure the
  // nav's true "natural" width before deciding how much to shrink it.
  topbar.style.setProperty("--navscale", "1");
  nav.classList.remove("force-icons", "nav-tight");
  // Force a reflow so the measurements below reflect the reset state.
  void topbar.offsetWidth;

  const brand = topbar.querySelector(".brand");
  // .topbar-actions wraps the settings icon + logout button together, so
  // both are measured (and scaled) as a single trailing block — falls back
  // to just the logout button on any page that hasn't been updated with
  // the wrapper yet.
  const actionsEl = topbar.querySelector(".topbar-actions") || topbar.querySelector(".btn-logout");
  const topbarStyle = getComputedStyle(topbar);
  const paddingL = parseFloat(topbarStyle.paddingLeft) || 0;
  const paddingR = parseFloat(topbarStyle.paddingRight) || 0;
  const topbarGap = parseFloat(topbarStyle.columnGap || topbarStyle.gap) || 0;

  const brandW = brand ? brand.getBoundingClientRect().width : 0;
  const actionsW = actionsEl ? actionsEl.getBoundingClientRect().width : 0;
  // Two gaps: between brand<->nav and nav<->actions block.
  const available = topbar.clientWidth - paddingL - paddingR - brandW - actionsW - (topbarGap * 2);
  const needed = nav.scrollWidth;

  let scale = needed > 0 ? available / needed : 1;
  if (!isFinite(scale) || scale > 1) scale = 1;

  const MIN_TEXT_SCALE = 0.55; // below this, text stops being legible
  // Before giving up on labels entirely, try trimming the CHROME instead of
  // the text: "nav-tight" cuts each link's padding and the gaps between
  // links right down while leaving the font at a legible size. With ~16
  // items in the bar that alone is worth roughly two links' worth of
  // width, which is the difference between a labelled nav and an
  // icon-only one on a normal laptop screen.
  if (scale < MIN_TEXT_SCALE) {
    nav.classList.add("nav-tight");
    void nav.offsetWidth;
    const neededTight = nav.scrollWidth;
    const tightScale = neededTight > 0 ? available / neededTight : 1;
    if (isFinite(tightScale) && tightScale >= MIN_TEXT_SCALE) {
      topbar.style.setProperty("--navscale", _ns(Math.min(1, tightScale)));
      return;
    }
  }
  if (scale < MIN_TEXT_SCALE) {
    // Labels can't fit even tightened up at the smallest legible size —
    // drop to icon-only, then re-measure and scale that instead.
    nav.classList.add("force-icons");
    void nav.offsetWidth;
    const neededIcons = nav.scrollWidth;
    scale = neededIcons > 0 ? available / neededIcons : 1;
    if (!isFinite(scale) || scale > 1) scale = 1;
    if (scale < 0.6) scale = 0.6; // hard floor so icons stay tappable
  }

  topbar.style.setProperty("--navscale", _ns(scale));
}

function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

window.addEventListener("resize", debounce(fitTopbar, 100));
window.addEventListener("orientationchange", () => setTimeout(fitTopbar, 50));
window.addEventListener("load", fitTopbar);

// Re-check whenever the bar, its links or its buttons change size, not just on
// window resize: a scrollbar appearing, a link added or relabelled, the bell
// arriving. Callbacks run before paint, so there is no visible lag, and it
// only refits on a width change or real overflow, so it can't loop.
if ("ResizeObserver" in window) {
  let _lastFitW = 0;
  const startTopbarWatch = () => {
    const tb = document.querySelector(".topbar");
    if (!tb) return;
    _lastFitW = tb.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = tb.clientWidth;
      if (w !== _lastFitW) { _lastFitW = w; fitTopbar(); }
      else if (_topbarOverflow(tb) > 1) fitTopbar();
    });
    ro.observe(tb);
    const nav = tb.querySelector("nav");
    if (nav) ro.observe(nav);
    const actions = tb.querySelector(".topbar-actions");
    if (actions) ro.observe(actions);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startTopbarWatch);
  else startTopbarWatch();
}

// Safety net: if the bell was reserved from the last visit but never shows
// up (notifications unavailable for this user), release the reserved space.
window.addEventListener("load", () => setTimeout(() => {
  const root = document.documentElement;
  if (root.classList.contains("nav-bell-pre") && !document.getElementById("notifBell")) {
    root.classList.remove("nav-bell-pre");
    fitTopbar();
  }
}, 6000));

/* ===================== Phone top bar: grouped dropdowns =====================
   On phones using the top bar (side menu switched off), the 15+ icons are
   replaced by a few group buttons — Money, Buy & sell, Life... — each
   opening a dropdown of its pages. The real links are wrapped in a
   .nav-group so everything that looks them up (module locks, labels)
   still finds them. Everywhere else the wrapper uses display:contents and
   its button is hidden, so the normal top bar and side menu look and
   behave exactly as before (see "Phone top bar dropdowns" in style.css).
============================================================================ */
const T29_NAV_GROUPS = [
  { label: "Money", hrefs: ["bank.html", "budget.html", "termdeposit.html", "kiwisaver.html", "loan.html", "market.html"] },
  { label: "Buy & sell", hrefs: ["store.html", "marketplace.html"] },
  { label: "Life", hrefs: ["jobs.html", "transport.html", "property.html", "insurance.html", "tax.html", "bigevents.html", "life.html"] },
  { label: "Games", hrefs: ["gambling.html"] },
  { label: "Teacher", hrefs: ["quizzes.html", "reports.html"] }
];

function closeNavGroups(except) {
  document.querySelectorAll(".topbar .nav-group.open").forEach(g => {
    if (g === except) return;
    g.classList.remove("open");
    const b = g.querySelector(".nav-group-btn");
    if (b) b.setAttribute("aria-expanded", "false");
  });
}

function buildNavGroups() {
  const topbar = document.querySelector(".topbar");
  const nav = topbar ? topbar.querySelector("nav") : null;
  if (!nav || nav.querySelector(".nav-group")) return;
  const fileOf = a => (a.getAttribute("href") || "").split("/").pop().split("?")[0];

  T29_NAV_GROUPS.forEach(group => {
    const links = [...nav.querySelectorAll(":scope > a[href]")].filter(a => group.hrefs.includes(fileOf(a)));
    if (!links.length) return;
    const wrap = document.createElement("div");
    wrap.className = "nav-group";
    wrap.setAttribute("data-nav-group", group.label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-group-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span>${group.label}</span><span class="nav-group-caret" aria-hidden="true"></span>`;
    const menu = document.createElement("div");
    menu.className = "nav-group-menu";
    nav.insertBefore(wrap, links[0]);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    links.forEach(a => menu.appendChild(a));
    if (links.some(a => a.classList.contains("active"))) wrap.classList.add("has-active");

    btn.addEventListener("click", e => {
      e.stopPropagation();
      const opening = !wrap.classList.contains("open");
      closeNavGroups(wrap);
      if (opening) {
        // The menu is position:fixed (so the top bar's overflow can't clip
        // it), so place it just under the bar each time it opens.
        menu.style.top = Math.round(topbar.getBoundingClientRect().bottom + 4) + "px";
      }
      wrap.classList.toggle("open", opening);
      btn.setAttribute("aria-expanded", String(opening));
    });
  });

  document.addEventListener("click", e => {
    if (!e.target.closest || !e.target.closest(".nav-group")) closeNavGroups();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeNavGroups(); });
  // Phones fire resize/scroll just from the address bar sliding, so keep
  // an open menu pinned under the bar rather than closing it.
  const repin = () => {
    const open = nav.querySelector(".nav-group.open .nav-group-menu");
    if (open) open.style.top = Math.round(topbar.getBoundingClientRect().bottom + 4) + "px";
  };
  window.addEventListener("resize", repin);
  window.addEventListener("scroll", repin, { passive: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildNavGroups);
else buildNavGroups();
