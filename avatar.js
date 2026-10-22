/* ===================== The 29 World — Avatars =====================
   Students are shown as their initials by default. Clicking their own
   round avatar opens the editor, where they can build a character out of
   skin, hair, eyes, mouth, outfits, hats, glasses, extras, backgrounds,
   effects and costumes. Everything is drawn as inline SVG (no image files).

   Teachers choose, per class, how items are paid for: 29 World money,
   free, or Comets (a separate currency only teachers can hand out) — plus
   per-item prices, and hiding items they don't want in their class.

   Stored on the student's /users doc:
     avatar: { on: bool, look: {...}, owned: ["hair:afro", ...] }
     comets: number            (only a teacher can raise it)
     cometLog: [{ at, amount, note }]   (last 20, written by the teacher)
   and on the class doc:
     avatarShop: { currency: "free"|"money"|"comets",
                   tiers: { money:{1..4}, comets:{1..4} },
                   prices: { money:{ "hat:crown": 30 }, comets:{} },
                   hidden: ["hat:crown"] }
   =================================================================== */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;

  /* ------------------------------ helpers ------------------------------ */
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function shade(hex, p) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = p < 0 ? 0 : 255, k = Math.abs(p);
    r = Math.round((t - r) * k + r); g = Math.round((t - g) * k + g); b = Math.round((t - b) * k + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  const INK = "#2a2630";
  let UID = 0;

  /* ------------------------------ palettes ----------------------------- */
  const SKINS = [
    { id: "s1", name: "Porcelain", v: "#fde3cf" }, { id: "s2", name: "Light", v: "#f8d0b0" },
    { id: "s3", name: "Fair", v: "#f1c27d" }, { id: "s4", name: "Tan", v: "#e0a370" },
    { id: "s5", name: "Brown", v: "#c68642" }, { id: "s6", name: "Deep", v: "#a66a3f" },
    { id: "s7", name: "Rich", v: "#8d5524" }, { id: "s8", name: "Ebony", v: "#5c3a21" }
  ];
  const HAIRC = [
    { id: "black", name: "Black", v: "#2b2118", r: 0 }, { id: "dkbrown", name: "Dark brown", v: "#4a2f1b", r: 0 },
    { id: "brown", name: "Brown", v: "#7a4a2a", r: 0 }, { id: "blonde", name: "Blonde", v: "#e2b857", r: 0 },
    { id: "ginger", name: "Ginger", v: "#c4552b", r: 0 }, { id: "grey", name: "Silver grey", v: "#b9bcc4", r: 0 },
    { id: "white", name: "Snow white", v: "#f1f1f4", r: 1 }, { id: "red", name: "Cherry red", v: "#d62839", r: 1 },
    { id: "pink", name: "Bubblegum pink", v: "#ff7eb6", r: 2 }, { id: "blue", name: "Electric blue", v: "#3a8dff", r: 2 },
    { id: "purple", name: "Royal purple", v: "#8f5cff", r: 2 }, { id: "green", name: "Lime green", v: "#3ecf8e", r: 2 },
    { id: "teal", name: "Teal", v: "#14b8c4", r: 2 }, { id: "rainbow", name: "Rainbow", v: "rainbow", r: 4 }
  ];
  const TOPC = [
    { id: "sky", name: "Sky", v: "#4aa3ff" }, { id: "navy", name: "Navy", v: "#2a3a63" }, { id: "red", name: "Red", v: "#e5484d" },
    { id: "coral", name: "Coral", v: "#ff7a59" }, { id: "gold", name: "Gold", v: "#f5b82e" }, { id: "mint", name: "Mint", v: "#3ecf8e" },
    { id: "green", name: "Forest", v: "#2e9e5b" }, { id: "purple", name: "Purple", v: "#8b5cf6" }, { id: "pink", name: "Pink", v: "#ff7eb6" },
    { id: "white", name: "White", v: "#f1f1f6" }, { id: "black", name: "Black", v: "#2f2f38" }, { id: "teal", name: "Teal", v: "#22b8cf" }
  ];
  const RARITY = ["Starter", "Common", "Rare", "Epic", "Legendary"];

  /* ------------------------------ hair --------------------------------- */
  const CAP = "M29 47 C26 22 38 14 50 14 C62 14 74 22 71 47 C70 38 66 31 58 29 C52 34 40 32 34 36 C31 39 30 43 29 47Z";
  const HAIR = {
    bald: () => ({}),
    buzz: c => ({ front: `<path d="M30 40 C29 24 40 19 50 19 C60 19 71 24 70 40 C66 31 58 27 50 27 C42 27 34 31 30 40Z" fill="${c}"/>` }),
    short: c => ({ front: `<path d="${CAP}" fill="${c}"/>` }),
    quiff: c => ({ front: `<path d="M29 47 C24 24 38 9 56 11 C72 13 76 30 71 47 C69 36 62 29 52 28 C42 28 33 34 29 47Z" fill="${c}"/>` }),
    long: c => ({ back: `<path d="M26 46 C21 72 26 90 36 94 L64 94 C74 90 79 72 74 46Z" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/>` }),
    bob: c => ({ back: `<path d="M25 44 C21 62 25 73 36 75 L64 75 C75 73 79 62 75 44Z" fill="${c}"/>`, front: `<path d="M28 47 C26 22 38 14 50 14 C62 14 74 22 72 47 C70 37 62 32 50 32 C38 32 30 37 28 47Z" fill="${c}"/>` }),
    ponytail: c => ({ front: `<path d="${CAP}" fill="${c}"/><path d="M69 30 C91 25 93 57 80 74 C82 57 78 47 70 43Z" fill="${c}"/><circle cx="70" cy="33" r="3" fill="#ff5d8f"/>` }),
    bun: c => ({ front: `<path d="${CAP}" fill="${c}"/><circle cx="50" cy="10" r="9" fill="${c}"/><path d="M41 17 Q50 22 59 17" stroke="#ff5d8f" stroke-width="2.4" fill="none"/>` }),
    afro: c => ({ back: `<circle cx="50" cy="32" r="31" fill="${c}"/>`, front: `<path d="M30 42 C31 29 40 25 50 25 C60 25 69 29 70 42 C64 33 58 31 50 31 C42 31 36 33 30 42Z" fill="${c}"/>` }),
    pigtails: c => ({ back: `<circle cx="22" cy="60" r="10" fill="${c}"/><circle cx="78" cy="60" r="10" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/><rect x="26" y="49" width="6" height="4" rx="2" fill="#ff5d8f"/><rect x="68" y="49" width="6" height="4" rx="2" fill="#ff5d8f"/>` }),
    mohawk: c => ({ front: `<path d="M30 36 C32 27 42 25 50 25 C58 25 68 27 70 36 C62 30 38 30 30 36Z" fill="${c}"/><path d="M42 27 L43 9 L47 19 L50 4 L53 19 L57 9 L58 27Z" fill="${c}"/>` }),
    curly: c => ({ front: ["34,26,9", "44,19,9.5", "56,19,9.5", "66,26,9", "29,38,7", "71,38,7", "50,23,9"].map(s => { const [x, y, r] = s.split(","); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`; }).join("") }),
    spiky: c => ({ front: `<path d="M28 44 L25 21 L36 28 L37 9 L46 24 L52 5 L58 24 L66 9 L66 28 L75 21 L72 44 C68 34 60 30 50 30 C40 30 32 34 28 44Z" fill="${c}"/>` }),
    wavy: c => ({ back: `<path d="M26 46 C17 60 30 70 24 84 C31 93 40 89 43 94 L57 94 C60 89 69 93 76 84 C70 70 83 60 74 46Z" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/>` }),
    braids: c => ({ back: `<path d="M30 52 C25 66 35 72 28 88 M70 52 C75 66 65 72 72 88" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="28" cy="89" r="3" fill="#ff5d8f"/><circle cx="72" cy="89" r="3" fill="#ff5d8f"/>`, front: `<path d="${CAP}" fill="${c}"/>` }),
    swoop: c => ({ front: `<path d="M28 47 C23 22 40 11 55 13 C71 15 75 30 72 47 C68 35 60 31 52 34 C44 37 36 43 40 57 C32 54 30 51 28 47Z" fill="${c}"/>` })
  };
  const HAIR_LIST = [["bald", "Bald", 0], ["buzz", "Buzz cut", 0], ["short", "Short", 0], ["long", "Long", 0],
    ["quiff", "Quiff", 1], ["bob", "Bob", 1], ["ponytail", "Ponytail", 1], ["bun", "Top bun", 1], ["pigtails", "Pigtails", 1],
    ["swoop", "Side swoop", 1], ["wavy", "Wavy long", 2], ["braids", "Braids", 2], ["curly", "Curly", 2],
    ["afro", "Afro", 2], ["spiky", "Spiky", 2], ["mohawk", "Mohawk", 3]];

  /* ------------------------------ eyes --------------------------------- */
  const star5 = (x, y, r, f, st) => { let p = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; p += (i ? "L" : "M") + (x + Math.cos(a) * rr).toFixed(1) + " " + (y + Math.sin(a) * rr).toFixed(1); } return `<path d="${p}Z" fill="${f}"${st ? ` stroke="${st}" stroke-width=".9" stroke-linejoin="round"` : ""}/>`; };
  const heart = (x, y, s, f) => `<path d="M${x} ${y + s * 0.9} C${x - s * 1.6} ${y - s * 0.1} ${x - s * 0.7} ${y - s * 1.2} ${x} ${y - s * 0.35} C${x + s * 0.7} ${y - s * 1.2} ${x + s * 1.6} ${y - s * 0.1} ${x} ${y + s * 0.9}Z" fill="${f}"/>`;
  const EYE_Y = 45;
  const both = fn => [41, 59].map((x, i) => fn(x, i)).join("");
  const EYES = {
    dots: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="2.8" fill="${INK}"/>`),
    round: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="4.6" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .3}" r="2.5" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .6}" r=".8" fill="#fff"/>`),
    happy: () => both(x => `<path d="M${x - 4.2} ${EYE_Y + 1.6} Q${x} ${EYE_Y - 5} ${x + 4.2} ${EYE_Y + 1.6}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`),
    sleepy: () => both(x => `<path d="M${x - 4} ${EYE_Y} Q${x} ${EYE_Y + 3.6} ${x + 4} ${EYE_Y}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M${x + 3.4} ${EYE_Y + 1.2} l1.8 1.4" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`),
    sparkle: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="5.2" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .4}" r="3.4" fill="#3b2f66"/><circle cx="${x}" cy="${EYE_Y + .4}" r="1.9" fill="${INK}"/><circle cx="${x + 1.4}" cy="${EYE_Y - 1.2}" r="1.1" fill="#fff"/><circle cx="${x - 1.2}" cy="${EYE_Y + 1.6}" r=".6" fill="#fff"/>`),
    anime: () => both(x => `<ellipse cx="${x}" cy="${EYE_Y}" rx="3.5" ry="5.2" fill="${INK}"/><ellipse cx="${x}" cy="${EYE_Y + 1.6}" rx="2.2" ry="2.4" fill="#5b8def"/><circle cx="${x + 1.2}" cy="${EYE_Y - 1.8}" r="1.3" fill="#fff"/><path d="M${x - 4.2} ${EYE_Y - 4} Q${x} ${EYE_Y - 6.6} ${x + 4.2} ${EYE_Y - 4}" stroke="${INK}" stroke-width="1.4" fill="none"/>`),
    wink: () => `<circle cx="41" cy="${EYE_Y}" r="2.8" fill="${INK}"/><path d="M55 ${EYE_Y + 1.6} Q59 ${EYE_Y - 5} 63 ${EYE_Y + 1.6}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    cool: sk => both(x => `<ellipse cx="${x}" cy="${EYE_Y + .6}" rx="4.4" ry="3.6" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x + 1}" cy="${EYE_Y + 1.6}" r="2" fill="${INK}"/><path d="M${x - 5} ${EYE_Y - 1.4} Q${x} ${EYE_Y - 3.4} ${x + 5} ${EYE_Y - 1.4} L${x + 5} ${EYE_Y - 4.6} L${x - 5} ${EYE_Y - 4.6}Z" fill="${shade(sk, -.18)}" stroke="${INK}" stroke-width=".9"/>`),
    lashes: () => both((x, i) => `<circle cx="${x}" cy="${EYE_Y}" r="3" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .9}" r=".9" fill="#fff"/><path d="M${x + (i ? 2.6 : -2.6)} ${EYE_Y - 2.4} l${i ? 2.6 : -2.6} -2.2 M${x + (i ? 3.1 : -3.1)} ${EYE_Y - .6} l${i ? 3 : -3} -1" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`),
    stars: () => both(x => star5(x, EYE_Y, 5.6, "#ffc93c", "#b8860b") + `<circle cx="${x}" cy="${EYE_Y}" r="1.2" fill="#fff"/>`),
    hearts: () => both(x => heart(x, EYE_Y - .6, 3.6, "#ee3f66")),
    dizzy: () => both(x => `<path d="M${x - 3.4} ${EYE_Y - 3.4} l6.8 6.8 M${x + 3.4} ${EYE_Y - 3.4} l-6.8 6.8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`),
    dollar: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="5" fill="#3ecf8e" stroke="#1f8a5b" stroke-width="1"/><text x="${x}" y="${EYE_Y + 3.3}" font-size="9" font-weight="900" text-anchor="middle" fill="#0e4d33" font-family="Arial,sans-serif">$</text>`)
  };
  const EYE_LIST = [["dots", "Dots", 0], ["round", "Round", 0], ["happy", "Happy", 0], ["sleepy", "Sleepy", 0], ["sparkle", "Sparkly", 1], ["wink", "Wink", 1],
    ["lashes", "Lashes", 1], ["cool", "Cool", 1], ["anime", "Anime", 2], ["dizzy", "Dizzy", 2], ["stars", "Star eyes", 3], ["hearts", "Heart eyes", 3], ["dollar", "Money eyes", 3]];

  /* ------------------------------ mouths -------------------------------- */
  const MOUTH = {
    smile: () => `<path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    grin: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44 57.4 H56" stroke="${INK}" stroke-width=".8"/>`,
    neutral: () => `<path d="M45 57 H55" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    open: () => `<path d="M43.5 54 Q50 68 56.5 54Z" fill="#6e2233" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M46.4 61.2 Q50 57.8 53.6 61.2 Q50 64.4 46.4 61.2Z" fill="#ff7b8e"/>`,
    smirk: () => `<path d="M45 57.4 Q51 59.6 57.4 53.8" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    tongue: () => `<path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M47 58.6 Q47.4 65.4 51.4 64.6 Q54 62 53 58Z" fill="#ff6f91" stroke="${INK}" stroke-width="1"/>`,
    surprised: () => `<ellipse cx="50" cy="58" rx="3.2" ry="4" fill="#5a1f30" stroke="${INK}" stroke-width="1.4"/>`,
    cat: () => `<path d="M43 55 Q46.5 60 50 55 Q53.5 60 57 55" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    kiss: () => heart(50, 57.6, 3.1, "#e8505b"),
    fangs: () => `<path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M45.6 56.6 l1.6 4.4 l1.6 -3.4Z M54.4 56.6 l-1.6 4.4 l-1.6 -3.4Z" fill="#fff" stroke="${INK}" stroke-width=".7"/>`,
    gold: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44.2 55 Q50 59.6 55.8 55 L55 57 Q50 60.6 45 57Z" fill="#f5c542"/>`,
    braces: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44.4 55.4 Q50 60 55.6 55.4" stroke="#9aa3b5" stroke-width="1.5" fill="none"/><path d="M47 55.8 v2.2 M50 56.6 v2.4 M53 55.8 v2.2" stroke="#9aa3b5" stroke-width="1"/>`
  };
  const MOUTH_LIST = [["smile", "Smile", 0], ["grin", "Big grin", 0], ["neutral", "Neutral", 0], ["open", "Open smile", 0], ["smirk", "Smirk", 1], ["tongue", "Tongue out", 1],
    ["surprised", "Surprised", 1], ["cat", "Cat smile", 1], ["braces", "Braces", 2], ["kiss", "Kiss", 2], ["fangs", "Vampire", 3], ["gold", "Gold teeth", 3]];

  /* ------------------------------ face extras --------------------------- */
  const FACE = {
    none: () => "",
    freckles: () => ["35,52", "38.5,54.4", "41.5,51.6", "58.5,51.6", "61.5,54.4", "65,52"].map(s => { const [x, y] = s.split(","); return `<circle cx="${x}" cy="${y}" r=".95" fill="#a8613a" opacity=".85"/>`; }).join(""),
    blush: () => `<ellipse cx="36" cy="53" rx="4.6" ry="2.8" fill="#ff7b9c" opacity=".5"/><ellipse cx="64" cy="53" rx="4.6" ry="2.8" fill="#ff7b9c" opacity=".5"/>`,
    mustache: h => `<path d="M42 54 C44 50 48 51 50 53 C52 51 56 50 58 54 C55 53.4 52.5 54.6 50 56 C47.5 54.6 45 53.4 42 54Z" fill="${h}"/>`,
    goatee: h => `<path d="M44 61 C46 58 54 58 56 61 C56 66 53 69 50 69 C47 69 44 66 44 61Z" fill="${h}"/>`,
    beard: h => `<path d="M30 50 C29 72 71 72 70 50 C67 58 62 57 58 55 C54 58 46 58 42 55 C38 57 33 58 30 50Z" fill="${h}"/>`,
    whiskers: () => `<path d="M26 52 L38 54 M26 57 L38 56.6 M74 52 L62 54 M74 57 L62 56.6" stroke="${INK}" stroke-width="1" stroke-linecap="round" opacity=".7"/>`,
    stripes: () => `<path d="M30 49 l8 2 M30 54 l8 1.4 M70 49 l-8 2 M70 54 l-8 1.4" stroke="#3a8dff" stroke-width="2.4" stroke-linecap="round"/>`,
    paintstars: () => star5(36, 53, 3.6, "#ff5d8f") + star5(64, 53, 3.6, "#3a8dff"),
    glitter: () => ["35,50,1.2", "38,55,.9", "63,50,1.2", "61,55,.9", "50,37,1", "46,38.4,.8"].map(s => { const [x, y, r] = s.split(","); return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff6a8" stroke="#f5b82e" stroke-width=".4"/>`; }).join(""),
    scar: () => `<path d="M60 36 l-5 9" stroke="#c4523f" stroke-width="1.4" stroke-linecap="round"/><path d="M57.6 38.4 l4 1.4 M56.2 41.6 l4 1.4" stroke="#c4523f" stroke-width=".8"/>`,
    mask: () => `<path d="M31 50 C36 54 44 57 50 57 C56 57 64 54 69 50 L69 60 C64 66 56 67 50 67 C44 67 36 66 31 60Z" fill="#cfe9ff" stroke="#8fb8d8" stroke-width="1"/><path d="M31 53 L26 50 M69 53 L74 50" stroke="#8fb8d8" stroke-width="1.2"/>`
  };
  const FACE_LIST = [["none", "Nothing", 0], ["freckles", "Freckles", 1], ["blush", "Blush", 1], ["whiskers", "Whiskers", 1], ["mustache", "Moustache", 1], ["goatee", "Goatee", 1],
    ["beard", "Beard", 2], ["stripes", "Warpaint", 2], ["glitter", "Glitter", 2], ["scar", "Scar", 2], ["paintstars", "Star paint", 3], ["mask", "Face mask", 1]];

  /* ------------------------------ glasses ------------------------------- */
  const GLASS = {
    none: () => "",
    round: () => `<circle cx="41" cy="45" r="7" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="1.8"/><circle cx="59" cy="45" r="7" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="1.8"/><path d="M48 44.6 Q50 43 52 44.6 M34 44 L29 42 M66 44 L71 42" stroke="${INK}" stroke-width="1.6" fill="none"/>`,
    square: () => `<rect x="33" y="39" width="15" height="11" rx="2.6" fill="#fff" fill-opacity=".18" stroke="#1d3b8f" stroke-width="2"/><rect x="52" y="39" width="15" height="11" rx="2.6" fill="#fff" fill-opacity=".18" stroke="#1d3b8f" stroke-width="2"/><path d="M48 43 H52 M33 42 L29 41 M67 42 L71 41" stroke="#1d3b8f" stroke-width="1.8"/>`,
    shades: () => `<path d="M32 40 H48 V47 Q48 52 42 52 H38 Q32 52 32 47Z M52 40 H68 V47 Q68 52 62 52 H58 Q52 52 52 47Z" fill="#1b1b22"/><path d="M48 41.4 H52 M32 41 L28 40 M68 41 L72 40" stroke="#1b1b22" stroke-width="2"/><path d="M35 42.4 l4 0 M55 42.4 l4 0" stroke="#fff" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>`,
    heart: () => heart(40.5, 44.6, 6.2, "#ff5d8f") + heart(59.5, 44.6, 6.2, "#ff5d8f") + `<path d="M47 43 H53" stroke="#c42d62" stroke-width="1.6"/>`,
    star: () => star5(40.5, 45, 8.6, "#ffcf3f", "#8a6a0a") + star5(59.5, 45, 8.6, "#ffcf3f", "#8a6a0a") + `<path d="M47 44 H53" stroke="#c9961a" stroke-width="1.6"/>`,
    threed: () => `<rect x="32" y="39" width="16" height="11" rx="1.8" fill="#ff4d4d" fill-opacity=".8" stroke="#fff" stroke-width="2.4"/><rect x="52" y="39" width="16" height="11" rx="1.8" fill="#2fb7ff" fill-opacity=".8" stroke="#fff" stroke-width="2.4"/><path d="M48 43 H52" stroke="#fff" stroke-width="2.4"/>`,
    monocle: () => `<circle cx="59" cy="45" r="7.4" fill="#fff" fill-opacity=".2" stroke="#c9961a" stroke-width="1.8"/><path d="M66 49 Q72 60 68 80" stroke="#c9961a" stroke-width="1" fill="none"/>`,
    goggles: () => `<path d="M26 43 H74" stroke="#5a4636" stroke-width="5"/><circle cx="41" cy="45" r="8.6" fill="#ffb347" fill-opacity=".55" stroke="#8a5a2b" stroke-width="3"/><circle cx="59" cy="45" r="8.6" fill="#ffb347" fill-opacity=".55" stroke="#8a5a2b" stroke-width="3"/><path d="M36 41 q3 -2 6 0" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" fill="none"/>`,
    visor: () => `<path d="M29 41 Q50 36 71 41 L69 50 Q50 54 31 50Z" fill="#19e3d4" fill-opacity=".72" stroke="#0d8f87" stroke-width="1.6"/><path d="M34 43 L42 42" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`
  };
  const GLASS_LIST = [["none", "None", 0], ["round", "Round specs", 1], ["square", "Square specs", 1], ["shades", "Sunglasses", 2], ["heart", "Heart shades", 2], ["star", "Star shades", 2],
    ["threed", "3D glasses", 2], ["monocle", "Monocle", 3], ["goggles", "Goggles", 3], ["visor", "Cyber visor", 4]];

  /* ------------------------------ hats ---------------------------------- */
  const HATS = {
    none: () => "",
    cap: () => `<path d="M29 35 C28 12 72 12 71 35Z" fill="#e5484d"/><path d="M29 35 Q50 30 71 35" stroke="#b02a2f" stroke-width="2" fill="none"/><path d="M60 33 Q86 29 83 38 Q70 36 60 37Z" fill="#b02a2f"/><circle cx="50" cy="15.4" r="2" fill="#b02a2f"/>`,
    beanie: () => `<path d="M28 36 C26 8 74 8 72 36Z" fill="#8b5cf6"/><rect x="27" y="29" width="46" height="9" rx="4.5" fill="#6b3fd6"/><path d="M33 30 v7 M41 30 v7 M49 30 v7 M57 30 v7 M65 30 v7" stroke="#8b5cf6" stroke-width="1.2" opacity=".7"/><circle cx="50" cy="8.6" r="6" fill="#f1f1f6"/>`,
    tophat: () => `<ellipse cx="50" cy="27" rx="27" ry="5" fill="#1d1d24"/><path d="M34 27 L35 3 Q50 -1 65 3 L66 27Z" fill="#26262e"/><rect x="34.4" y="19.6" width="31.2" height="6" fill="#e5484d"/><ellipse cx="50" cy="3.4" rx="15" ry="2.6" fill="#33333d"/>`,
    cowboy: () => `<path d="M14 30 C24 36 34 30 36 28 L64 28 C66 30 76 36 86 30 C84 22 74 24 70 26 L30 26 C26 24 16 22 14 30Z" fill="#a8743a"/><path d="M33 28 C32 12 38 8 50 9 C62 8 68 12 67 28Z" fill="#c08848"/><path d="M33 24 H67" stroke="#6b4a22" stroke-width="3"/><path d="M42 12 Q50 17 58 12" stroke="#a8743a" stroke-width="1.6" fill="none"/>`,
    party: () => `<path d="M50 -4 L34 30 L66 30Z" fill="#ff5d8f"/><path d="M42.6 14 L57.4 14 M38.8 22 L61.2 22" stroke="#ffd23f" stroke-width="3"/><circle cx="50" cy="-3" r="4.4" fill="#ffd23f"/><circle cx="46" cy="9" r="1.3" fill="#3a8dff"/><circle cx="54" cy="17" r="1.3" fill="#3ecf8e"/>`,
    crown: () => `<path d="M30 30 L28 10 L40 20 L50 6 L60 20 L72 10 L70 30Z" fill="#f5c542" stroke="#c9961a" stroke-width="1.6" stroke-linejoin="round"/><rect x="30" y="26" width="40" height="6" fill="#e0a82a"/><circle cx="50" cy="29" r="2.2" fill="#e5484d"/><circle cx="39" cy="29" r="1.8" fill="#3a8dff"/><circle cx="61" cy="29" r="1.8" fill="#3ecf8e"/><circle cx="28" cy="10" r="2.2" fill="#fff"/><circle cx="50" cy="6" r="2.2" fill="#fff"/><circle cx="72" cy="10" r="2.2" fill="#fff"/>`,
    beret: () => `<path d="M26 28 C22 12 52 6 74 16 C80 22 72 30 62 30 C50 32 34 32 26 28Z" fill="#e5484d"/><circle cx="60" cy="9.6" r="2.4" fill="#b02a2f"/>`,
    headband: () => `<path d="M28 33 Q50 22 72 33" stroke="#ff5d8f" stroke-width="5" fill="none" stroke-linecap="round"/>${star5(50, 26.6, 5, "#ffd23f")}`,
    bucket: () => `<path d="M29 32 L33 12 Q50 6 67 12 L71 32Z" fill="#7ac7a0"/><path d="M20 35 Q50 24 80 35 Q50 40 20 35Z" fill="#5fae86"/><path d="M31 25 H69" stroke="#fff" stroke-width="2.4"/>`,
    chef: () => `<circle cx="38" cy="16" r="9" fill="#fff"/><circle cx="62" cy="16" r="9" fill="#fff"/><circle cx="50" cy="10" r="10" fill="#fff"/><rect x="33" y="19" width="34" height="14" rx="2" fill="#fff" stroke="#d8dce6" stroke-width="1.2"/><path d="M33 29 H67" stroke="#d8dce6" stroke-width="1.2"/>`,
    santa: () => `<path d="M27 33 C26 10 50 2 74 6 C80 8 82 16 78 26 C76 18 70 16 70 22 L72 34Z" fill="#e5484d"/><rect x="26" y="29" width="48" height="8" rx="4" fill="#fff"/><circle cx="79" cy="26" r="5.4" fill="#fff"/>`,
    flowers: () => ["31,33,#ff7eb6", "38,28.5,#ffd23f", "46,26,#ff7eb6", "54,26,#8b5cf6", "62,28.5,#ff7eb6", "69,33,#ffd23f"].map(s => { const [x, y, f] = s.split(","); return `<g fill="${f}"><circle cx="${x}" cy="${+y - 2.4}" r="2.6"/><circle cx="${+x + 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${+y + 2.4}" r="2.6"/><circle cx="${+x - 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff6a8"/></g>`; }).join("") + `<path d="M30 34 Q50 22 70 34" stroke="#3ea66a" stroke-width="2" fill="none"/>`,
    halo: () => `<ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#f5c542" stroke-width="3.4"/><ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#fff6a8" stroke-width="1" opacity=".8"/>`,
    devil: () => `<path d="M31 26 C26 18 28 8 34 4 C34 12 38 18 42 22Z M69 26 C74 18 72 8 66 4 C66 12 62 18 58 22Z" fill="#e5484d" stroke="#a82327" stroke-width="1"/>`,
    catears: () => `<path d="M29 28 L30 8 L45 19Z M71 28 L70 8 L55 19Z" fill="#2f2f38"/><path d="M33 23 L33.6 13 L41 19Z M67 23 L66.4 13 L59 19Z" fill="#ff9db7"/>`,
    bunny: () => `<ellipse cx="38" cy="2" rx="6" ry="17" fill="#f1f1f6" stroke="#d3d7e2" stroke-width="1"/><ellipse cx="62" cy="2" rx="6" ry="17" fill="#f1f1f6" stroke="#d3d7e2" stroke-width="1"/><ellipse cx="38" cy="3" rx="2.8" ry="11" fill="#ffb4c8"/><ellipse cx="62" cy="3" rx="2.8" ry="11" fill="#ffb4c8"/>`,
    propeller: () => `<path d="M29 34 C28 14 72 14 71 34Z" fill="#3a8dff"/><path d="M50 14 V6" stroke="#8a93a6" stroke-width="2"/><path d="M50 6 C38 0 30 4 36 8Z M50 6 C62 12 70 8 64 4Z" fill="#ffd23f" stroke="#c9961a" stroke-width=".8"/><circle cx="50" cy="6" r="2" fill="#e5484d"/><path d="M29 33 Q50 28 71 33" stroke="#e5484d" stroke-width="3" fill="none"/>`,
    hardhat: () => `<path d="M28 33 C26 10 74 10 72 33Z" fill="#ffc21f"/><rect x="24" y="30" width="52" height="6" rx="3" fill="#e8a600"/><path d="M50 12 V30 M42 14 V30 M58 14 V30" stroke="#e8a600" stroke-width="2"/>`,
    grad: () => `<path d="M34 24 L34 33 Q50 40 66 33 L66 24Z" fill="#2a2630"/><path d="M50 8 L84 20 L50 32 L16 20Z" fill="#33333d" stroke="#1d1d24" stroke-width="1"/><path d="M78 22 V36" stroke="#f5c542" stroke-width="1.6"/><circle cx="78" cy="37" r="2.4" fill="#f5c542"/><path d="M50 20 L78 22" stroke="#f5c542" stroke-width="1.2"/>`,
    sombrero: () => `<ellipse cx="50" cy="29" rx="38" ry="8" fill="#e8b04c"/><path d="M36 28 C36 8 64 8 64 28Z" fill="#f5c76b"/><path d="M37 24 H63" stroke="#e5484d" stroke-width="3"/><path d="M14 30 Q50 38 86 30" stroke="#e5484d" stroke-width="1.6" fill="none" stroke-dasharray="2 3"/>`
  };
  const HAT_LIST = [["none", "None", 0], ["cap", "Red cap", 1], ["beanie", "Beanie", 1], ["bucket", "Bucket hat", 1], ["headband", "Star headband", 1], ["beret", "Beret", 1], ["hardhat", "Hard hat", 2],
    ["grad", "Graduation cap", 2], ["chef", "Chef hat", 2], ["cowboy", "Cowboy hat", 2], ["party", "Party hat", 2], ["flowers", "Flower crown", 2], ["santa", "Santa hat", 2], ["catears", "Cat ears", 2],
    ["devil", "Devil horns", 3], ["tophat", "Top hat", 3], ["sombrero", "Sombrero", 3], ["bunny", "Bunny ears", 3], ["propeller", "Propeller cap", 3], ["halo", "Halo", 3], ["crown", "Golden crown", 4]];

  /* ------------------------------ extras -------------------------------- */
  const EXTRA = {
    none: () => ({}),
    headphones: () => ({ back: `<path d="M27 46 C24 10 76 10 73 46" stroke="#33333d" stroke-width="4.4" fill="none"/>`, front: `<rect x="22" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/><rect x="69" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/>` }),
    earrings: () => ({ front: `<circle cx="29.6" cy="53.4" r="2.2" fill="#f5c542" stroke="#c9961a" stroke-width=".8"/><circle cx="70.4" cy="53.4" r="2.2" fill="#f5c542" stroke="#c9961a" stroke-width=".8"/>` }),
    flowerear: () => ({ front: `<g transform="translate(31 42)"><g fill="#ff5d8f"><circle cy="-4" r="3.6"/><circle cx="4" r="3.6"/><circle cy="4" r="3.6"/><circle cx="-4" r="3.6"/></g><circle r="2.4" fill="#ffd23f"/></g>` }),
    bowtie: () => ({ over: `<path d="M50 79 L38 72 L38 86Z M50 79 L62 72 L62 86Z" fill="#e5484d" stroke="#a82327" stroke-width="1"/><circle cx="50" cy="79" r="3.2" fill="#c43a40"/>` }),
    scarf: () => ({ over: `<path d="M34 70 Q50 82 66 70 L68 80 Q50 92 32 80Z" fill="#e5484d"/><path d="M40 72 v14 M48 75 v14 M56 75 v14 M62 72 v12" stroke="#fff" stroke-width="2.6" opacity=".85"/><path d="M60 80 L68 98 L58 100 L54 84Z" fill="#c43a40"/><path d="M62 88 l5 -1 M61 92 l5 -1" stroke="#fff" stroke-width="2" opacity=".85"/>` }),
    pearls: () => ({ over: [0, 1, 2, 3, 4, 5, 6].map(i => { const t = i / 6, x = 36 + t * 28, y = 71 + Math.sin(t * Math.PI) * 10; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="#fbf7ee" stroke="#cfc7b4" stroke-width=".6"/>`; }).join("") }),
    chain: () => ({ over: `<path d="M35 70 Q50 92 65 70" stroke="#f5c542" stroke-width="3" fill="none" stroke-dasharray="3.4 1.2"/><circle cx="50" cy="86" r="5.4" fill="#f5c542" stroke="#c9961a" stroke-width="1"/><text x="50" y="88.6" font-size="6.2" font-weight="900" text-anchor="middle" fill="#8a5a0a" font-family="Arial,sans-serif">29</text>` }),
    bandana: () => ({ over: `<path d="M33 70 Q50 80 67 70 L50 92Z" fill="#e5484d"/><circle cx="46" cy="76" r="1" fill="#fff"/><circle cx="54" cy="76" r="1" fill="#fff"/><circle cx="50" cy="82" r="1" fill="#fff"/>` }),
    lanyard: () => ({ over: `<path d="M38 72 L50 98 L62 72" stroke="#3a8dff" stroke-width="3" fill="none"/><rect x="43" y="90" width="14" height="10" rx="2" fill="#fff" stroke="#8a93a6" stroke-width="1"/><rect x="45" y="92" width="4.4" height="4.4" fill="#f1c27d"/><path d="M51 93 h4 M51 96 h4" stroke="#8a93a6" stroke-width="1"/>` }),
    medal: () => ({ over: `<path d="M39 72 L46 90 M61 72 L54 90" stroke="#e5484d" stroke-width="4"/><circle cx="50" cy="93" r="7" fill="#f5c542" stroke="#c9961a" stroke-width="1.4"/>${star5(50, 93, 4.4, "#c9961a")}` }),
    eyepatch: () => ({ front: `<path d="M28 36 L72 54" stroke="#1d1d24" stroke-width="1.4"/><ellipse cx="59" cy="45.6" rx="6.6" ry="5.6" fill="#1d1d24"/>` }),
    rosy: () => ({ front: `<path d="M33 41 q2 -3 5 -1 M62 40 q3 -2 5 1" stroke="${INK}" stroke-width="1.2" fill="none"/>` })
  };
  const EXTRA_LIST = [["none", "None", 0], ["headphones", "Headphones", 1], ["earrings", "Gold earrings", 1], ["flowerear", "Flower behind ear", 1], ["bowtie", "Bow tie", 1], ["lanyard", "School lanyard", 1],
    ["bandana", "Bandana", 1], ["pearls", "Pearl necklace", 2], ["scarf", "Striped scarf", 2], ["eyepatch", "Eyepatch", 2], ["medal", "Gold medal", 3], ["chain", "\u201829\u2019 chain", 4]];

  /* ------------------------------ tops ---------------------------------- */
  const BODY = "M12 100 C12 83 28 75 50 75 C72 75 88 83 88 100Z";
  const topShape = (f, extra) => `<path d="${BODY}" fill="${f}"/>${extra || ""}`;
  const TOPS = {
    tee: (c, d) => ({ body: topShape(c), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="${d}" stroke-width="3"/>` }),
    hoodie: (c, d, l) => ({ back: `<path d="M24 66 C22 78 30 82 38 80 L62 80 C70 82 78 78 76 66 C70 72 30 72 24 66Z" fill="${d}"/>`, body: topShape(c, `<path d="M50 88 V100" stroke="${d}" stroke-width="0"/>`), over: `<path d="M36 78 Q50 92 64 78" fill="none" stroke="${d}" stroke-width="3"/><path d="M44 88 v8 M56 88 v8" stroke="${l}" stroke-width="2" stroke-linecap="round"/><path d="M30 100 V92 Q50 86 70 92 V100Z" fill="${d}" opacity=".35"/>` }),
    stripes: (c, d, l) => ({ body: topShape(c, [80, 86, 92, 98].map(y => `<rect x="10" y="${y}" width="80" height="3.4" fill="#fff" opacity=".85"/>`).join("")), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="${d}" stroke-width="3"/>` }),
    polo: (c, d) => ({ body: topShape(c), over: `<path d="M38 75 L45 86 L50 80 L55 86 L62 75 L56 73 L50 79 L44 73Z" fill="${d}"/><path d="M50 80 V94" stroke="${d}" stroke-width="1.6"/><circle cx="50" cy="86" r="1" fill="#fff"/><circle cx="50" cy="91" r="1" fill="#fff"/>` }),
    tank: (c, d) => ({ body: `<path d="M12 100 C12 86 26 79 38 77 L40 84 Q50 92 60 84 L62 77 C74 79 88 86 88 100Z" fill="${c}"/><path d="M12 100 C12 88 22 82 30 80 L36 84 C26 88 22 94 22 100Z M88 100 C88 88 78 82 70 80 L64 84 C74 88 78 94 78 100Z" fill="var(--skin)"/>`, over: "" }),
    turtle: (c, d) => ({ body: topShape(c), over: `<path d="M38 64 Q50 70 62 64 L63 78 Q50 84 37 78Z" fill="${d}"/><path d="M40 69 Q50 74 60 69 M39.6 73 Q50 78 60.4 73" stroke="${c}" stroke-width="1" fill="none" opacity=".7"/>` }),
    jersey: (c, d) => ({ body: topShape(c, `<path d="M12 100 C12 90 18 84 24 81 L24 100Z M88 100 C88 90 82 84 76 81 L76 100Z" fill="${d}"/>`), over: `<path d="M38 75 Q50 88 62 75" fill="none" stroke="#fff" stroke-width="3"/><text x="50" y="98" font-size="14" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial Black,Arial,sans-serif">29</text>` }),
    varsity: (c, d) => ({ body: topShape("#f1f1f6", `<path d="M12 100 C12 88 20 82 26 80 L24 100Z M88 100 C88 88 80 82 74 80 L76 100Z" fill="${c}"/>`), over: `<path d="M39 75 L50 100 L61 75 Q50 86 39 75Z" fill="${d}" opacity=".18"/><path d="M50 84 V100" stroke="${d}" stroke-width="1.4"/><path d="M38 75 Q50 86 62 75" fill="none" stroke="${c}" stroke-width="3.4"/><circle cx="36" cy="92" r="4.4" fill="${c}"/><text x="36" y="94.4" font-size="6" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">W</text>` }),
    suit: () => ({ body: topShape("#2b3350"), over: `<path d="M39 75 L50 98 L61 75Z" fill="#fff"/><path d="M50 80 L46 84 L50 97 L54 84Z" fill="#e5484d"/><path d="M38 75 L50 100 L28 100Z M62 75 L50 100 L72 100Z" fill="#232a44"/><path d="M38 75 L47 88 L40 91Z M62 75 L53 88 L60 91Z" fill="#3a4470"/>` }),
    lab: () => ({ body: topShape("#f4f6fb", `<path d="M12 100 C12 84 28 75 50 75 C72 75 88 84 88 100Z" fill="none" stroke="#dfe3ee" stroke-width="1"/>`), over: `<path d="M39 75 L50 100 L61 75Z" fill="#6fb6ff"/><path d="M38 75 L48 94 L40 96Z M62 75 L52 94 L60 96Z" fill="#fff" stroke="#dfe3ee" stroke-width="1"/><rect x="62" y="88" width="8" height="8" rx="1.4" fill="#fff" stroke="#dfe3ee"/><path d="M64 88 v-3 M67 88 v-4" stroke="#3a8dff" stroke-width="1.4"/>` }),
    overalls: (c, d) => ({ body: topShape("#f1f1f6"), over: `<path d="M30 100 V90 L36 90 L38 76 L44 76 L40 92 H60 L56 76 L62 76 L64 90 L70 90 V100Z" fill="${c}"/><rect x="42" y="90" width="16" height="10" fill="${d}" opacity=".45"/><circle cx="41" cy="78" r="1.6" fill="#f5c542"/><circle cx="59" cy="78" r="1.6" fill="#f5c542"/>` }),
    hawaiian: () => ({ body: topShape("#2ec4b6", [[22, 90, "#ff6b8a"], [38, 96, "#ffd23f"], [58, 90, "#ff6b8a"], [74, 96, "#ffd23f"], [48, 86, "#fff"], [30, 82, "#ffd23f"], [70, 82, "#ff6b8a"]].map(a => `<g transform="translate(${a[0]} ${a[1]})" fill="${a[2]}"><circle cy="-3" r="2.4"/><circle cx="3" r="2.4"/><circle cy="3" r="2.4"/><circle cx="-3" r="2.4"/></g>`).join("")), over: `<path d="M38 75 L45 88 L50 80 L55 88 L62 75 L56 73 L50 79 L44 73Z" fill="#1d9488"/>` }),
    puffer: (c, d) => ({ body: topShape(c, [82, 89, 96].map(y => `<path d="M12 ${y} Q50 ${y - 5} 88 ${y}" stroke="${d}" stroke-width="1.6" fill="none"/>`).join("")), over: `<path d="M36 76 Q50 84 64 76 L64 82 Q50 90 36 82Z" fill="${d}"/><path d="M50 84 V100" stroke="${d}" stroke-width="1.6"/>` }),
    rugby: () => ({ body: topShape("#26262e", `<path d="M12 100 C12 90 18 84 24 81 L24 100Z" fill="#26262e"/>`), over: `<path d="M38 75 L50 86 L62 75 L56 72 L50 78 L44 72Z" fill="#fff"/><path d="M12 94 H88 M12 98 H88" stroke="#fff" stroke-width="1.6" opacity=".7"/><path d="M50 86 V94" stroke="#fff" stroke-width="1.6"/>` }),
    flannel: (c, d) => ({ body: topShape(c, [79, 87, 95].map(y => `<rect x="10" y="${y}" width="80" height="3.6" fill="${d}" opacity=".6"/>`).join("") + [24, 36, 48, 60, 72].map(x => `<rect x="${x}" y="74" width="3.6" height="28" fill="${d}" opacity=".6"/>`).join("")), over: `<path d="M38 75 L45 86 L50 80 L55 86 L62 75 L56 73 L50 79 L44 73Z" fill="${d}"/><path d="M50 80 V100" stroke="${d}" stroke-width="1.4"/>` }),
    kiwi: () => ({ body: topShape("#2f9a5d"), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="#1f7240" stroke-width="3"/><ellipse cx="50" cy="94" rx="8.4" ry="6" fill="#7a5a3a"/><path d="M56 90 L66 87" stroke="#c9a46a" stroke-width="1.4" stroke-linecap="round"/><circle cx="55.6" cy="91.4" r="1.4" fill="#f1f1f6"/><circle cx="55.9" cy="91.5" r=".6" fill="#222"/><path d="M46 99 v-3 M52 99 v-3" stroke="#c9a46a" stroke-width="1.2"/>` }),
    tiedye: (c, d, l, ctx) => { const id = ctx.id("td"); ctx.defs += `<radialGradient id="${id}" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#ffe14d"/><stop offset=".3" stop-color="#ff6b8a"/><stop offset=".6" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2fb7ff"/></radialGradient>`; return { body: topShape(`url(#${id})`), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="#6b3fd6" stroke-width="3"/>` }; },
    disco: (c, d, l, ctx) => { const id = ctx.id("ds"); ctx.defs += `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d9e6"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#aeb4c8"/></linearGradient>`; const dots = []; for (let y = 80; y < 100; y += 5) for (let x = 18 + ((y / 5) % 2) * 3; x < 84; x += 6) dots.push(`<rect x="${x}" y="${y}" width="3.6" height="3.6" fill="#fff" opacity=".9" stroke="#9aa3b5" stroke-width=".3"/>`); return { body: topShape(`url(#${id})`, dots.join("")), over: `<path d="M38 75 L50 100 L62 75Z" fill="#2a2630" opacity=".25"/><path d="M38 75 L50 88 L62 75" fill="none" stroke="#fff" stroke-width="2.4"/>` }; }
  };
  const TOP_LIST = [["tee", "T-shirt", 0], ["hoodie", "Hoodie", 0], ["stripes", "Stripy tee", 1], ["polo", "Polo", 1], ["tank", "Tank top", 1], ["turtle", "Turtleneck", 1], ["overalls", "Overalls", 1],
    ["flannel", "Flannel shirt", 1], ["jersey", "Team jersey \u201829\u2019", 2], ["varsity", "Varsity jacket", 2], ["suit", "Suit & tie", 2], ["lab", "Lab coat", 2], ["hawaiian", "Hawaiian shirt", 2],
    ["puffer", "Puffer jacket", 2], ["rugby", "Rugby top", 2], ["kiwi", "Kiwi tee", 2], ["tiedye", "Tie-dye tee", 3], ["disco", "Disco jacket", 4]];

  /* ------------------------------ backgrounds --------------------------- */
  const stars = (pts, col) => pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="${col || "#fff"}"/>`).join("");
  const BG = {
    sky: () => `<rect width="100" height="100" fill="#cfe8ff"/>`,
    mint: () => `<rect width="100" height="100" fill="#d4f5e4"/>`,
    blush: () => `<rect width="100" height="100" fill="#ffdce6"/>`,
    lemon: () => `<rect width="100" height="100" fill="#fff0b8"/>`,
    sunset: (ctx) => { const i = ctx.id("sn"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a4fd8"/><stop offset=".5" stop-color="#ff6b8a"/><stop offset="1" stop-color="#ffb347"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/><circle cx="50" cy="74" r="20" fill="#ffe27a" opacity=".85"/>`; },
    ocean: (ctx) => { const i = ctx.id("oc"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#1b6fd1"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/><path d="M0 70 Q12 64 25 70 T50 70 T75 70 T100 70 V100 H0Z" fill="#fff" opacity=".28"/><path d="M0 82 Q12 76 25 82 T50 82 T75 82 T100 82 V100 H0Z" fill="#fff" opacity=".2"/>`; },
    night: () => `<rect width="100" height="100" fill="#141a3d"/>${stars([[12, 14, 1.2], [30, 8, .8], [72, 12, 1.2], [88, 28, .9], [20, 36, .7], [92, 8, .8], [8, 52, 1], [60, 6, .7]])}<circle cx="82" cy="18" r="7" fill="#f6f1c9"/><circle cx="85" cy="16" r="6" fill="#141a3d"/>`,
    galaxy: (ctx) => { const i = ctx.id("gx"); ctx.defs += `<radialGradient id="${i}" cx=".3" cy=".3" r="1"><stop offset="0" stop-color="#7b3fe4"/><stop offset=".6" stop-color="#2a1a6b"/><stop offset="1" stop-color="#0c0828"/></radialGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/>${stars([[14, 20, 1], [26, 8, .8], [70, 14, 1.1], [86, 40, .8], [10, 60, .9], [90, 82, 1], [40, 92, .8], [60, 88, .7], [78, 6, .7]])}<circle cx="84" cy="22" r="8" fill="#ff9a62"/><ellipse cx="84" cy="22" rx="13" ry="3.2" fill="none" stroke="#ffd9b8" stroke-width="1.4" transform="rotate(-20 84 22)"/>`; },
    forest: () => `<rect width="100" height="100" fill="#cdeccf"/><path d="M0 100 V60 L10 40 L20 60 L28 36 L38 62 L48 44 L58 64 L68 38 L78 62 L88 42 L100 60 V100Z" fill="#4aa86b"/><path d="M0 100 V76 L8 60 L16 76 L26 58 L36 78 L46 62 L56 80 L66 60 L76 80 L86 62 L100 78 V100Z" fill="#2e8450"/>`,
    beach: () => `<rect width="100" height="100" fill="#bfe6ff"/><circle cx="80" cy="20" r="10" fill="#ffd23f"/><rect y="58" width="100" height="18" fill="#3fb6e8"/><path d="M0 74 Q12 68 25 74 T50 74 T75 74 T100 74 V80 H0Z" fill="#fff" opacity=".5"/><rect y="78" width="100" height="22" fill="#f4d9a0"/>`,
    rainbow: () => `<rect width="100" height="100" fill="#e9f5ff"/>${["#ff5d5d", "#ffa94d", "#ffe066", "#69db7c", "#4dabf7", "#9775fa"].map((c, i) => `<circle cx="50" cy="104" r="${92 - i * 8}" fill="none" stroke="${c}" stroke-width="8"/>`).join("")}`,
    disco: (ctx) => { const i = ctx.id("dc"); ctx.defs += `<radialGradient id="${i}" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#ff8ad8"/><stop offset="1" stop-color="#5b2fc9"/></radialGradient>`; let d = ""; for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 14 + (k % 4) * 11; d += `<circle cx="${50 + Math.cos(a) * r}" cy="${50 + Math.sin(a) * r}" r="${2 + k % 3}" fill="${["#fff", "#ffe14d", "#4dffea", "#ff7aa8"][k % 4]}" opacity=".7"/>`; } return `<rect width="100" height="100" fill="url(#${i})"/>${d}`; },
    lava: (ctx) => { const i = ctx.id("lv"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b0d0d"/><stop offset=".6" stop-color="#d9381e"/><stop offset="1" stop-color="#ffb02e"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/>${stars([[18, 72, 3], [80, 78, 4], [60, 90, 2.6], [30, 90, 2], [90, 60, 2]], "#ffd36a")}`; },
    snow: () => `<rect width="100" height="100" fill="#dceeff"/><path d="M0 82 Q25 70 50 80 T100 76 V100 H0Z" fill="#fff"/>${stars([[14, 16, 1.6], [30, 30, 1.2], [60, 12, 1.6], [84, 24, 1.3], [70, 44, 1], [10, 50, 1.2], [92, 56, 1.5]])}`,
    checker: () => `<rect width="100" height="100" fill="#fff"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(r => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(c => (r + c) % 2 === 0).map(c => `<rect x="${c * 10}" y="${r * 10}" width="10" height="10" fill="#ff8fb3"/>`).join("")).join("")}`,
    city: (ctx) => { const i = ctx.id("ct"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2f7a"/><stop offset="1" stop-color="#ff9a8b"/></linearGradient>`; const b = [[4, 58, 12, 42], [18, 48, 10, 52], [30, 62, 12, 38], [44, 40, 12, 60], [58, 56, 10, 44], [70, 46, 12, 54], [84, 60, 12, 40]].map(a => `<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" fill="#1d1a3f"/>`).join(""); return `<rect width="100" height="100" fill="url(#${i})"/>${b}${stars([[24, 56, .8], [48, 50, .8], [74, 54, .8], [36, 70, .8], [62, 68, .8]], "#ffe27a")}`; },
    candy: () => `<rect width="100" height="100" fill="#fff"/>${[-20, 0, 20, 40, 60, 80, 100].map((x, i) => `<path d="M${x} 0 L${x + 14} 0 L${x - 26} 100 L${x - 40} 100Z" fill="${i % 2 ? "#ff7aa8" : "#7ad7ff"}"/>`).join("")}`,
    synth: (ctx) => { const i = ctx.id("sy"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f5c"/><stop offset=".6" stop-color="#ff3d9a"/><stop offset="1" stop-color="#ffd23f"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/><circle cx="50" cy="56" r="22" fill="#ffd23f" opacity=".9"/><rect y="62" width="100" height="40" fill="#1a0a3c"/>${[0, 1, 2, 3, 4, 5, 6].map(k => `<path d="M${50 + (k - 3) * 6} 62 L${50 + (k - 3) * 26} 100" stroke="#ff3d9a" stroke-width=".8"/>`).join("")}${[68, 76, 86, 98].map(y => `<path d="M0 ${y} H100" stroke="#ff3d9a" stroke-width=".8"/>`).join("")}`; }
  };
  const BG_LIST = [["sky", "Sky blue", 0], ["mint", "Mint", 0], ["blush", "Blush", 0], ["lemon", "Lemon", 0], ["candy", "Candy stripes", 1], ["checker", "Pink checks", 1], ["snow", "Snowy", 1],
    ["forest", "Forest", 1], ["beach", "Beach day", 2], ["ocean", "Deep sea", 2], ["sunset", "Sunset", 2], ["rainbow", "Rainbow", 2], ["night", "Starry night", 3], ["city", "City dusk", 3],
    ["lava", "Lava", 3], ["disco", "Disco", 3], ["galaxy", "Galaxy", 4], ["synth", "Synthwave", 4]];

  /* ------------------------------ effects ------------------------------- */
  const FX = {
    none: () => "",
    sparkles: () => [[16, 22, 5], [84, 30, 4], [22, 74, 3.6], [82, 70, 5], [50, 6, 3.4]].map(p => `<path d="M${p[0]} ${p[1] - p[2]} Q${p[0]} ${p[1]} ${p[0] + p[2]} ${p[1]} Q${p[0]} ${p[1]} ${p[0]} ${p[1] + p[2]} Q${p[0]} ${p[1]} ${p[0] - p[2]} ${p[1]} Q${p[0]} ${p[1]} ${p[0]} ${p[1] - p[2]}Z" fill="#fff" stroke="#f5c542" stroke-width=".8"/>`).join(""),
    hearts: () => [[16, 26, 2.6], [84, 22, 3.2], [10, 62, 2], [90, 58, 2.4], [24, 10, 1.8]].map(p => heart(p[0], p[1], p[2], "#ff5d8f")).join(""),
    snowfall: () => stars([[14, 14, 1.8], [30, 6, 1.2], [70, 10, 1.8], [88, 22, 1.4], [10, 40, 1.4], [92, 50, 1.8], [20, 68, 1.4], [80, 80, 1.6], [50, 94, 1.2]]),
    notes: () => [[16, 24], [82, 18], [88, 60], [12, 66]].map(p => `<g fill="#6b3fd6"><circle cx="${p[0]}" cy="${p[1] + 6}" r="2.4"/><rect x="${p[0] + 1.6}" y="${p[1] - 4}" width="1.4" height="10"/><path d="M${p[0] + 3} ${p[1] - 4} q4 1 4 5 q-2 -2 -4 -2Z"/></g>`).join(""),
    bubbles: () => [[14, 20, 5], [84, 14, 3.6], [90, 58, 5.4], [10, 70, 3.4], [28, 90, 2.6]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="1"/><circle cx="${p[0] - p[2] * .3}" cy="${p[1] - p[2] * .3}" r="${p[2] * .22}" fill="#fff"/>`).join(""),
    confetti: () => [[12, 16, "#ff5d8f", 20], [28, 8, "#ffd23f", -30], [74, 10, "#3a8dff", 40], [88, 26, "#3ecf8e", -10], [8, 48, "#8b5cf6", 60], [92, 62, "#ff5d8f", 10], [20, 80, "#ffd23f", -40], [82, 86, "#3a8dff", 30], [50, 4, "#3ecf8e", 15]].map(p => `<rect x="${p[0]}" y="${p[1]}" width="5" height="2.4" fill="${p[2]}" transform="rotate(${p[3]} ${p[0]} ${p[1]})"/>`).join(""),
    lightning: () => `<path d="M14 10 L6 30 L13 30 L9 46 L22 24 L14 24 L20 10Z" fill="#ffe14d" stroke="#e0a800" stroke-width="1"/><path d="M86 52 L79 70 L85 70 L82 84 L93 64 L87 64 L92 52Z" fill="#ffe14d" stroke="#e0a800" stroke-width="1"/>`,
    flames: () => `<path d="M0 100 L0 86 Q6 76 10 86 Q14 70 20 84 Q26 64 32 84 Q38 72 42 86 Q50 66 58 86 Q62 72 68 84 Q74 64 80 84 Q86 70 90 86 Q96 76 100 86 L100 100Z" fill="#ff7a1a" opacity=".92"/><path d="M0 100 L0 92 Q8 84 14 92 Q22 80 30 92 Q38 82 46 92 Q54 80 62 92 Q70 82 78 92 Q86 80 94 92 L100 92 L100 100Z" fill="#ffd23f"/>`,
    orbit: () => `<ellipse cx="50" cy="50" rx="46" ry="14" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.2" transform="rotate(-24 50 50)"/>${star5(12, 66, 4, "#ffd23f")}${star5(90, 34, 3.4, "#fff")}`,
    glow: (ctx) => { const i = ctx.id("gl"); ctx.defs += `<radialGradient id="${i}" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#ffe27a" stop-opacity="0"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".85"/></radialGradient>`; return `<circle cx="50" cy="50" r="50" fill="url(#${i})"/>`; }
  };
  const FX_LIST = [["none", "None", 0], ["sparkles", "Sparkles", 1], ["hearts", "Floating hearts", 1], ["bubbles", "Bubbles", 1], ["snowfall", "Snowfall", 1], ["notes", "Music notes", 2], ["confetti", "Confetti", 2],
    ["lightning", "Lightning", 3], ["orbit", "Orbit", 3], ["glow", "Golden glow", 3], ["flames", "Flames", 4]];

  /* ------------------------------ costumes ------------------------------ */
  const hood = (f, extra) => `<path fill-rule="evenodd" d="M19 42 a31 34 0 1 0 62 0 a31 34 0 1 0 -62 0Z M30.5 45 a19.5 21.5 0 1 0 39 0 a19.5 21.5 0 1 0 -39 0Z" fill="${f}"/>${extra || ""}`;
  const onesie = (f, extra) => `<path d="${BODY}" fill="${f}"/>${extra || ""}<path d="M38 76 Q50 90 62 76 L66 80 Q50 98 34 80Z" fill="${shade(f, -.2)}"/>`;
  const COSTUMES = {
    dino: () => ({ hide: { hair: 1, hat: 1, top: 1 }, back: `<path d="M44 12 L50 -2 L56 12Z M60 16 L68 4 L70 20Z M30 16 L32 4 L40 14Z" fill="#2f8f4e"/>`, body: onesie("#4cc070", `<path d="M36 92 Q50 84 64 92 V100 H36Z" fill="#c9f2a8"/>${[[24, 90], [76, 94], [30, 98]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.2" fill="#2f8f4e"/>`).join("")}`), front: hood("#4cc070", `<path d="M42 11 L50 0 L58 11Z" fill="#2f8f4e"/><circle cx="38" cy="14" r="5.6" fill="#fff"/><circle cx="62" cy="14" r="5.6" fill="#fff"/><circle cx="39" cy="14.4" r="2.6" fill="${INK}"/><circle cx="61" cy="14.4" r="2.6" fill="${INK}"/><circle cx="26" cy="26" r="2" fill="#2f8f4e"/><circle cx="74" cy="26" r="2" fill="#2f8f4e"/>`) }),
    astro: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: topShape("#f4f6fb", `<rect x="40" y="86" width="20" height="10" rx="2" fill="#2b3350"/><circle cx="46" cy="91" r="1.8" fill="#4dffea"/><circle cx="54" cy="91" r="1.8" fill="#ff5d8f"/><rect x="18" y="86" width="10" height="5" fill="#e5484d"/><rect x="72" y="86" width="10" height="5" fill="#3a8dff"/>`), over: `<rect x="26" y="74" width="48" height="6" rx="3" fill="#c9d0e0"/>`, front: `<circle cx="50" cy="44" r="31" fill="#bfe6ff" fill-opacity=".3"/><path fill-rule="evenodd" d="M16 44 a34 34 0 1 0 68 0 a34 34 0 1 0 -68 0Z M20.5 44 a29.5 29.5 0 1 0 59 0 a29.5 29.5 0 1 0 -59 0Z" fill="#f4f6fb" stroke="#c9d0e0" stroke-width="1"/><path d="M30 28 Q38 20 50 19" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".85"/><rect x="47" y="2" width="6" height="8" rx="2" fill="#c9d0e0"/><circle cx="50" cy="2" r="3" fill="#e5484d"/>` }),
    unicorn: () => ({ hide: { hair: 1, hat: 1, top: 1 }, back: `<path d="M22 30 C10 40 12 62 20 72 C22 60 24 48 30 40Z" fill="#ff8fd0"/><path d="M26 24 C14 30 12 44 16 54 C20 44 24 36 32 30Z" fill="#8bd8ff"/>`, body: onesie("#fdf4ff"), front: hood("#fdf4ff", `<path d="M44 14 L50 -8 L56 14Z" fill="#ffd23f" stroke="#e0a800" stroke-width="1"/><path d="M45.4 9 L54.6 6 M46.6 4 L53.4 1.4" stroke="#e0a800" stroke-width="1.2"/><path d="M26 22 L22 6 L36 14Z M74 22 L78 6 L64 14Z" fill="#fdf4ff" stroke="#e9d6f2" stroke-width="1"/><path d="M26 19 L24.6 10 L32 14Z M74 19 L75.4 10 L68 14Z" fill="#ffb4d6"/><path d="M30 18 Q36 10 44 14 M70 18 Q64 10 56 14" stroke="#ff8fd0" stroke-width="3" fill="none" stroke-linecap="round"/>`) }),
    robot: () => ({ hide: { hair: 1, hat: 1, top: 1, face: 1 }, body: topShape("#aab3c5", `<rect x="34" y="82" width="32" height="18" rx="3" fill="#7e889d"/><circle cx="42" cy="91" r="3" fill="#4dffea"/><circle cx="52" cy="91" r="3" fill="#ffd23f"/><rect x="58" y="88" width="5" height="6" fill="#e5484d"/>`), front: `<rect x="48" y="2" width="4" height="10" fill="#7e889d"/><circle cx="50" cy="3" r="4" fill="#e5484d"/><rect x="25" y="14" width="50" height="50" rx="9" fill="#c4cbdb" stroke="#7e889d" stroke-width="2"/><rect x="31" y="26" width="38" height="16" rx="5" fill="#1d2233"/><circle cx="41" cy="34" r="4.6" fill="#4dffea"/><circle cx="59" cy="34" r="4.6" fill="#4dffea"/><circle cx="42.4" cy="32.6" r="1.4" fill="#fff"/><circle cx="60.4" cy="32.6" r="1.4" fill="#fff"/><rect x="36" y="50" width="28" height="8" rx="2" fill="#1d2233"/><path d="M42 50 v8 M48 50 v8 M54 50 v8 M60 50 v8" stroke="#7e889d" stroke-width="1.2"/><circle cx="29" cy="18" r="2" fill="#7e889d"/><circle cx="71" cy="18" r="2" fill="#7e889d"/><rect x="19" y="32" width="6" height="14" rx="2" fill="#7e889d"/><rect x="75" y="32" width="6" height="14" rx="2" fill="#7e889d"/>` }),
    pirate: () => ({ hide: { hat: 1, top: 1 }, body: topShape("#f1f1f6", [80, 88, 96].map(y => `<rect x="10" y="${y}" width="80" height="4" fill="#26262e"/>`).join("")), over: `<path d="M38 75 Q50 86 62 75" fill="none" stroke="#26262e" stroke-width="2.6"/>`, front: `<path d="M16 28 C22 18 36 4 50 4 C64 4 78 18 84 28 C74 30 66 24 50 24 C34 24 26 30 16 28Z" fill="#26262e"/><path d="M20 26 Q50 16 80 26" stroke="#f5c542" stroke-width="2.2" fill="none"/><circle cx="50" cy="15" r="4" fill="#f1f1f6"/><path d="M46.4 19 L53.6 19 M47.6 11.4 L52.4 18.6" stroke="#26262e" stroke-width="1.2"/><circle cx="48.6" cy="14.6" r="1" fill="#26262e"/><circle cx="51.4" cy="14.6" r="1" fill="#26262e"/><path d="M28 36 L72 54" stroke="#1d1d24" stroke-width="1.4"/><ellipse cx="59" cy="45.6" rx="6.6" ry="5.6" fill="#1d1d24"/><circle cx="30" cy="54" r="2.4" fill="none" stroke="#f5c542" stroke-width="1.6"/>` }),
    ninja: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: topShape("#26262e", `<path d="M12 100 C12 92 16 87 22 84 L26 100Z" fill="#1d1d24"/><path d="M30 90 H70" stroke="#e5484d" stroke-width="4"/>`), front: `<path fill-rule="evenodd" d="M17 44 a33 36 0 1 0 66 0 a33 36 0 1 0 -66 0Z M31 38 Q50 34 69 38 L69 50 Q50 54 31 50Z" fill="#26262e"/><path d="M17 36 Q50 26 83 36 L83 42 Q50 32 17 42Z" fill="#e5484d"/><path d="M80 38 L94 32 L90 40 L96 44 L82 44Z" fill="#e5484d"/><path d="M36 42 L45 41 M64 42 L55 41" stroke="${INK}" stroke-width="0"/>`, eyesOnTop: 1 }),
    wizard: () => ({ hide: { hat: 1, top: 1 }, body: topShape("#3b4fd6", [[26, 90], [70, 94], [50, 98], [38, 82]].map(p => star5(p[0], p[1], 3, "#ffd23f")).join("")), over: `<path d="M34 70 Q50 84 66 70 L66 80 Q50 94 34 80Z" fill="#2a3aa8"/>`, front: `<path d="M32 62 C30 76 40 96 50 100 C60 96 70 76 68 62 C64 70 56 66 50 70 C44 66 36 70 32 62Z" fill="#e9ecf4"/><path d="M14 32 Q50 20 86 32 Q50 40 14 32Z" fill="#3b4fd6"/><path d="M28 30 C30 12 44 2 70 -8 C62 4 62 14 72 30Z" fill="#3b4fd6"/><path d="M28 30 Q50 25 72 30" stroke="#ffd23f" stroke-width="2.4" fill="none"/>${star5(52, 16, 3.6, "#ffd23f")}${star5(42, 24, 2.2, "#fff")}` }),
    alien: () => ({ hide: { hair: 1, hat: 1, top: 1, face: 1 }, skin: "#8fe388", back: `<path d="M36 22 Q30 6 24 4 M64 22 Q70 6 76 4" stroke="#6cc267" stroke-width="2.4" fill="none"/><circle cx="24" cy="4" r="3.4" fill="#ffd23f"/><circle cx="76" cy="4" r="3.4" fill="#ffd23f"/>`, body: topShape("#c4cbdb", `<path d="M40 76 L50 92 L60 76" fill="none" stroke="#7e889d" stroke-width="2"/><circle cx="50" cy="92" r="3" fill="#4dffea"/>`), front: `<path d="M30 40 C32 36 40 38 44 46 C42 52 34 52 30 40Z M70 40 C68 36 60 38 56 46 C58 52 66 52 70 40Z" fill="#12151f"/><circle cx="36" cy="42" r="1.4" fill="#fff"/><circle cx="64" cy="42" r="1.4" fill="#fff"/><path d="M46 57 Q50 59 54 57" stroke="#3c8a3e" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="48.6" cy="50" r=".8" fill="#3c8a3e"/><circle cx="51.4" cy="50" r=".8" fill="#3c8a3e"/>` }),
    banana: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: onesie("#ffd93d", `${[[24, 92], [74, 90], [32, 98], [66, 98]].map(p => `<ellipse cx="${p[0]}" cy="${p[1]}" rx="2" ry="1.4" fill="#8a5a1a"/>`).join("")}`), front: `<path d="M30 30 C22 14 30 4 38 2 C34 12 38 22 44 28Z" fill="#ffd93d" stroke="#e0b21c" stroke-width="1"/><path d="M70 30 C78 14 70 4 62 2 C66 12 62 22 56 28Z" fill="#ffd93d" stroke="#e0b21c" stroke-width="1"/><path d="M42 24 C42 8 50 0 50 -4 C50 0 58 8 58 24 C54 18 46 18 42 24Z" fill="#ffd93d" stroke="#e0b21c" stroke-width="1"/><rect x="47" y="-8" width="6" height="8" rx="2" fill="#8a6a1a"/><path d="M25 42 C22 30 26 24 30 24 L32 40Z M75 42 C78 30 74 24 70 24 L68 40Z" fill="#ffd93d" stroke="#e0b21c" stroke-width="1"/>` }),
    cat: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: onesie("#8c93a8", `<path d="M36 92 Q50 84 64 92 V100 H36Z" fill="#dfe3ee"/>`), front: hood("#8c93a8", `<path d="M22 26 L20 4 L38 16Z M78 26 L80 4 L62 16Z" fill="#8c93a8"/><path d="M25 21 L24 10 L33 16Z M75 21 L76 10 L67 16Z" fill="#ffb4c8"/><path d="M38 14 L38 22 M44 12 L44 20 M56 12 L56 20 M62 14 L62 22" stroke="#6a7188" stroke-width="2.4" stroke-linecap="round"/>`) + `<path d="M47 52 L53 52 L50 55Z" fill="#ff8fa8"/>` }),
    shark: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: onesie("#6d8fb5", `<path d="M34 90 Q50 82 66 90 V100 H34Z" fill="#eaf2fa"/>`), front: hood("#6d8fb5", `<path d="M40 10 L52 -10 L62 12Z" fill="#587aa0"/><path d="M33 56 L38 64 L42 58 L47 66 L52 59 L57 66 L61 58 L66 64 L69 54" fill="none"/><path d="M31 54 L35.6 62 L40 56Z M40 58 L44 66 L48 60Z M52 60 L56 66 L60 58Z M60 58 L64.4 64 L69 54Z" fill="#fff" stroke="#c9d6e6" stroke-width=".8"/><circle cx="30" cy="22" r="2.6" fill="#fff"/><circle cx="70" cy="22" r="2.6" fill="#fff"/><circle cx="30.4" cy="22" r="1.2" fill="${INK}"/><circle cx="69.6" cy="22" r="1.2" fill="${INK}"/>`) }),
    hero: () => ({ hide: { top: 1 }, back: `<path d="M20 70 Q4 84 8 100 L92 100 Q96 84 80 70 L50 80Z" fill="#e5484d"/>`, body: topShape("#2f5bd6", `<path d="M12 100 C12 90 16 86 20 83 L24 100Z M88 100 C88 90 84 86 80 83 L76 100Z" fill="#244bb8"/><path d="M12 96 H88" stroke="#ffd23f" stroke-width="3"/>`), over: `<path d="M38 75 Q50 85 62 75" fill="none" stroke="#e5484d" stroke-width="3"/><path d="M42 82 H58 L50 96Z" fill="#ffd23f" stroke="#c9961a" stroke-width="1"/>${star5(50, 87, 3, "#e5484d")}`, front: `<path d="M28 38 Q39 34 50 40 Q61 34 72 38 L72 50 Q60 54 52 47 Q50 46 48 47 Q40 54 28 50Z" fill="#e5484d"/><path d="M33 43 Q38 41 44 44 M67 43 Q62 41 56 44" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M33 43 Q38 41 44 44 M67 43 Q62 41 56 44" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>`, eyesOnTop: 1 }),
    frog: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: onesie("#58c26b", `<path d="M36 92 Q50 84 64 92 V100 H36Z" fill="#d9f6a5"/>`), front: hood("#58c26b", `<circle cx="34" cy="12" r="9.4" fill="#58c26b"/><circle cx="66" cy="12" r="9.4" fill="#58c26b"/><circle cx="34" cy="12" r="6.6" fill="#fff"/><circle cx="66" cy="12" r="6.6" fill="#fff"/><circle cx="35" cy="12.6" r="3.2" fill="${INK}"/><circle cx="65" cy="12.6" r="3.2" fill="${INK}"/><circle cx="26" cy="36" r="2.2" fill="#3a9a4c"/><circle cx="74" cy="34" r="2.6" fill="#3a9a4c"/><circle cx="24" cy="46" r="1.8" fill="#3a9a4c"/>`) }),
    ghost: () => ({ hide: { hair: 1, hat: 1, top: 1, face: 1, head: 1 }, body: "", front: `<path d="M14 100 C10 50 18 10 50 8 C82 10 90 50 86 100 L78 92 L70 100 L62 92 L54 100 L46 92 L38 100 L30 92 L22 100Z" fill="#fafbff" stroke="#d6dbea" stroke-width="1.6"/><ellipse cx="38" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="62" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="50" cy="58" rx="4" ry="5.4" fill="#1d1d24"/><ellipse cx="29" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/><ellipse cx="71" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/>` }),
    bear: () => ({ hide: { hair: 1, hat: 1, top: 1 }, body: onesie("#a8743a", `<path d="M36 92 Q50 84 64 92 V100 H36Z" fill="#e8c99a"/>`), front: hood("#a8743a", `<circle cx="27" cy="16" r="9" fill="#a8743a"/><circle cx="73" cy="16" r="9" fill="#a8743a"/><circle cx="27" cy="16" r="4.8" fill="#e8c99a"/><circle cx="73" cy="16" r="4.8" fill="#e8c99a"/>`) + `<ellipse cx="50" cy="56" rx="7.4" ry="5.4" fill="#e8c99a" opacity=".92"/><ellipse cx="50" cy="53.4" rx="3" ry="2" fill="#5a3a16"/>` })
  };
  const COSTUME_LIST = [["none", "No costume", 0], ["bear", "Teddy bear", 2], ["cat", "Cat onesie", 2], ["frog", "Frog hood", 2], ["ghost", "Friendly ghost", 3], ["pirate", "Pirate", 3], ["ninja", "Ninja", 3],
    ["dino", "Dino onesie", 3], ["banana", "Banana", 3], ["shark", "Shark hoodie", 3], ["hero", "Superhero", 3], ["wizard", "Wizard", 4], ["astro", "Astronaut", 4], ["robot", "Robot", 4],
    ["alien", "Alien", 4], ["unicorn", "Unicorn", 4]];

  /* ------------------------------ catalog ------------------------------- */
  const CATS = [
    { id: "costume", label: "Costumes", list: COSTUME_LIST },
    { id: "hair", label: "Hair", list: HAIR_LIST },
    { id: "hairColor", label: "Hair colour", list: HAIRC.map(h => [h.id, h.name, h.r]) },
    { id: "skin", label: "Skin", list: SKINS.map(s => [s.id, s.name, 0]) },
    { id: "eyes", label: "Eyes", list: EYE_LIST },
    { id: "mouth", label: "Mouth", list: MOUTH_LIST },
    { id: "face", label: "Face", list: FACE_LIST },
    { id: "top", label: "Outfits", list: TOP_LIST },
    { id: "topColor", label: "Outfit colour", list: TOPC.map(t => [t.id, t.name, 0]) },
    { id: "hat", label: "Hats", list: HAT_LIST },
    { id: "glasses", label: "Glasses", list: GLASS_LIST },
    { id: "extra", label: "Extras", list: EXTRA_LIST },
    { id: "bg", label: "Backgrounds", list: BG_LIST },
    { id: "fx", label: "Effects", list: FX_LIST }
  ];
  const DEFAULT_LOOK = { skin: "s3", hair: "short", hairColor: "dkbrown", eyes: "dots", mouth: "smile", face: "none", top: "tee", topColor: "sky", glasses: "none", hat: "none", extra: "none", bg: "sky", fx: "none", costume: "none" };
  const NONE_IDS = { face: "none", glasses: "none", hat: "none", extra: "none", fx: "none", costume: "none" };

  /* ------------------------------ renderer ------------------------------ */
  function cleanLook(l) {
    const out = Object.assign({}, DEFAULT_LOOK);
    if (l && typeof l === "object") CATS.forEach(c => {
      const v = l[c.id];
      if (typeof v === "string" && c.list.some(it => it[0] === v)) out[c.id] = v;
    });
    return out;
  }
  function renderSvg(look, opts) {
    opts = opts || {};
    look = cleanLook(look);
    const ctx = { defs: "", id: n => "av" + (++UID) + n };
    const size = opts.size || 100;
    const co = COSTUMES[look.costume] ? COSTUMES[look.costume]() : null;
    const hide = (co && co.hide) || {};
    const skin = (co && co.skin) || (SKINS.find(s => s.id === look.skin) || SKINS[2]).v;
    const sk2 = shade(skin, -.14);
    const hc = HAIRC.find(h => h.id === look.hairColor) || HAIRC[1];
    let hcol = hc.v;
    if (hcol === "rainbow") {
      const gid = ctx.id("rb");
      ctx.defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5d5d"/><stop offset=".25" stop-color="#ffd23f"/><stop offset=".5" stop-color="#3ecf8e"/><stop offset=".75" stop-color="#3a8dff"/><stop offset="1" stop-color="#b05cff"/></linearGradient>`;
      hcol = `url(#${gid})`;
    }
    const tc = (TOPC.find(t => t.id === look.topColor) || TOPC[0]).v;
    const td = shade(tc, -.22), tl = shade(tc, .35);
    const hairDark = hc.v === "rainbow" ? "#6a3fd6" : shade(hc.v, -.15);

    let s = "";
    s += (BG[look.bg] || BG.sky)(ctx);
    if (co && co.back) s += co.back;
    const hair = !hide.hair && HAIR[look.hair] ? HAIR[look.hair](hcol) : {};
    if (hair.back) s += hair.back;
    const ex = EXTRA[look.extra] ? EXTRA[look.extra]() : {};
    if (ex.back) s += ex.back;

    // body / outfit
    let top = { body: "", over: "" };
    if (co && co.body !== undefined) top = { body: co.body, over: co.over || "" };
    else if (!hide.top && TOPS[look.top]) top = TOPS[look.top](tc, td, tl, ctx);
    if (top.back) s += top.back;
    if (top.body) s += top.body.replace(/var\(--skin\)/g, skin);
    if (!hide.head) s += `<path d="M42 60 h16 v17 q-8 8 -16 0z" fill="${sk2}"/>`;
    if (top.over) s += top.over;
    if (!hide.head) {
      s += `<ellipse cx="30" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="70" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="30.4" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/><ellipse cx="69.6" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/>`;
      s += `<ellipse cx="50" cy="44" rx="20" ry="22" fill="${skin}"/>`;
    }
    if (!hide.face) {
      if (FACE[look.face]) s += FACE[look.face](hairDark === "#6a3fd6" ? "#6a3fd6" : hairDark);
      s += (EYES[look.eyes] || EYES.dots)(skin);
      s += `<path d="M36 38.6 Q41 36 45.4 38" stroke="${shade(hc.v === "rainbow" ? "#7a4a2a" : hc.v, -.3)}" stroke-width="1.7" fill="none" stroke-linecap="round" opacity=".85"/><path d="M54.6 38 Q59 36 64 38.6" stroke="${shade(hc.v === "rainbow" ? "#7a4a2a" : hc.v, -.3)}" stroke-width="1.7" fill="none" stroke-linecap="round" opacity=".85"/>`;
      s += `<ellipse cx="50" cy="50.4" rx="1.5" ry="1" fill="${sk2}"/>`;
      if (look.face !== "mask") s += (MOUTH[look.mouth] || MOUTH.smile)();
      if (look.face === "mask") s += FACE.mask();
    }
    if (hair.front) s += hair.front;
    if (!hide.hat && HATS[look.hat]) s += HATS[look.hat]();
    if (!hide.face && GLASS[look.glasses]) s += GLASS[look.glasses]();
    if (ex.over) s += ex.over;
    if (ex.front) s += ex.front;
    if (co && co.front) s += co.front;
    if (co && co.eyesOnTop) s += (EYES[look.eyes] || EYES.dots)(skin);
    s += (FX[look.fx] || FX.none)(ctx);

    const cid = ctx.id("cp");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${opts.label ? String(opts.label).replace(/[<>&"]/g, "") : "Avatar"}"><defs><clipPath id="${cid}"><circle cx="50" cy="50" r="50"/></clipPath>${ctx.defs}</defs><g clip-path="url(#${cid})">${s}</g></svg>`;
  }

  G.T29AvatarCore = { CATS, DEFAULT_LOOK, NONE_IDS, RARITY, HAIRC, TOPC, SKINS, cleanLook, renderSvg };
})();

/* =========================== Part 2: shop, editor, teacher tools =========================== */
(function () {
  "use strict";
  const C = window.T29AvatarCore;
  const { CATS, DEFAULT_LOOK, RARITY, renderSvg, cleanLook } = C;
  const DT = { money: { 1: 5, 2: 15, 3: 40, 4: 100 }, comets: { 1: 1, 2: 3, 3: 8, 4: 20 } };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const COMET = `<svg class="av-comet" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 22 L12 12" stroke="#8fb8ff" stroke-width="3" stroke-linecap="round"/><path d="M5 17 L10 12" stroke="#c9dcff" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="8" r="6" fill="#ffc93c" stroke="#d99a00" stroke-width="1.4"/><circle cx="14" cy="6.4" r="1.6" fill="#fff6c8"/></svg>`;
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
  function priceOf(shop, cat, id, r) {
    if (!r || shop.currency === "free") return 0;
    const k = cat + ":" + id, o = shop.prices[shop.currency][k];
    return o !== undefined ? o : shop.tiers[shop.currency][r];
  }
  function itemsOf(cat) { return CATS.find(c => c.id === cat).list; }
  const rOf = (cat, id) => { const it = itemsOf(cat).find(i => i[0] === id); return it ? it[2] : 0; };
  const nameOf = (cat, id) => { const it = itemsOf(cat).find(i => i[0] === id); return it ? it[1] : id; };
  const fmtPrice = (shop, n) => shop.currency === "comets" ? `${COMET}${n}` : (typeof fmtMoney === "function" ? fmtMoney(n) : "$" + n.toFixed(2));

  /* ---------------- badge (used all over the site) ---------------- */
  function badge(user, opts) {
    opts = opts || {};
    const un = (user && user.username) || "", name = (user && user.name) || "";
    const sz = opts.size, style = sz ? ` style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .34)}px;"` : "";
    const attr = ` data-av-user="${esc(un)}"`;
    const av = user && user.avatar;
    if (av && av.on && av.look) return `<span class="student-avatar av-img"${attr}${style} title="${esc(name)}">${renderSvg(av.look, { size: sz || 38, label: name })}</span>`;
    const col = typeof avatarClass === "function" && un ? avatarClass(un) : "c1";
    return `<span class="student-avatar ${col}"${attr}${style}>${typeof initials === "function" ? initials(name) : "?"}</span>`;
  }

  /* ---------------- styles ---------------- */
  function css() {
    if (document.getElementById("t29AvCss")) return;
    const st = document.createElement("style");
    st.id = "t29AvCss";
    st.textContent = `
html .student-avatar.av-img{background:none !important;padding:0;overflow:hidden;box-shadow:var(--shadow-sm);}
.student-avatar.av-img svg{display:block;width:100%;height:100%;}
.av-comet{width:1.05em;height:1.05em;vertical-align:-.18em;margin-right:2px;}
.av-self-btn{position:relative;border:0;background:none;padding:0;cursor:pointer;border-radius:50%;flex-shrink:0;margin-right:12px;line-height:0;}
.av-self-btn .student-avatar{margin:0;}
.av-self-btn:hover{transform:scale(1.05);}
.av-self-btn .av-pen{position:absolute;right:-3px;bottom:-3px;width:22px;height:22px;border-radius:50%;background:var(--gold,#f5b82e);color:#1f2b44;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;border:2px solid #fff;font-weight:900;}
.av-ov{position:fixed;inset:0;z-index:400;background:rgba(15,20,40,.55);display:flex;align-items:center;justify-content:center;padding:12px;}
.av-card{background:var(--card,#fff);color:var(--ink,#1f2b44);border-radius:18px;width:min(940px,100%);max-height:calc(100vh - 24px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;}
.av-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1.5px solid var(--line,#e3e7f0);}
.av-head h3{margin:0;font-size:1.2rem;}
.av-x{border:0;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:inherit;padding:2px 8px;}
.av-body{display:flex;gap:18px;padding:16px 18px;overflow:auto;flex:1;min-height:0;}
.av-left{flex:0 0 220px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;}
.av-prev{width:200px;height:200px;border-radius:50%;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.2);line-height:0;}
.av-prev svg{width:100%;height:100%;}
.av-prev.av-initials{display:flex;align-items:center;justify-content:center;font-size:4rem;font-weight:900;color:#fff;line-height:1;background:linear-gradient(135deg,var(--navy-500,#4a5a85),var(--navy-900,#1f2b44));}
.av-chip{display:inline-flex;align-items:center;gap:4px;background:#f1f4fb;border:1.5px solid var(--line,#e3e7f0);border-radius:999px;padding:3px 10px;font-weight:800;font-size:.85rem;}
.av-right{flex:1;min-width:0;display:flex;flex-direction:column;}
.av-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin;}
.av-tab{flex-shrink:0;border:1.5px solid var(--line,#e3e7f0);background:var(--card,#fff);color:inherit;border-radius:999px;padding:6px 12px;font:inherit;font-weight:800;font-size:.85rem;cursor:pointer;}
.av-tab.on{background:var(--navy-900,#1f2b44);color:#fff;border-color:var(--navy-900,#1f2b44);}
.av-hint{font-size:.82rem;color:var(--muted,#6b7390);margin:2px 0 8px;}
.av-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;overflow:auto;padding:4px 2px 8px;}
.av-tile{position:relative;border:2px solid var(--line,#e3e7f0);background:var(--card,#fff);color:inherit;border-radius:14px;padding:6px 4px 6px;cursor:pointer;font:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;}
.av-tile:hover{border-color:var(--navy-500,#4a5a85);}
.av-tile.on{border-color:var(--gold,#f5b82e);box-shadow:0 0 0 2px var(--gold,#f5b82e) inset;}
.av-tile .av-t-img{width:68px;height:68px;border-radius:50%;overflow:hidden;line-height:0;}
.av-tile .av-t-img svg{width:100%;height:100%;}
.av-tile .av-t-name{font-size:.74rem;font-weight:800;text-align:center;line-height:1.15;}
.av-tile .av-t-price{font-size:.72rem;font-weight:800;color:var(--muted,#6b7390);}
.av-tile .av-t-price.own{color:#1f8a5b;}
.av-tile .av-r{position:absolute;top:4px;left:4px;width:9px;height:9px;border-radius:50%;}
.av-r1{background:#9aa3b5}.av-r2{background:#3a8dff}.av-r3{background:#a45cff}.av-r4{background:#ffb020;box-shadow:0 0 6px #ffb020}
.av-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;border-top:1.5px solid var(--line,#e3e7f0);}
.av-foot .av-sum{flex:1;min-width:180px;font-weight:700;font-size:.9rem;}
.av-foot .av-msg{width:100%;font-weight:700;color:#b8402c;}
.av-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:450;background:#1f2b44;color:#fff;border-radius:14px;padding:12px 16px;font-weight:700;box-shadow:0 8px 28px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);}
.av-toast button{border:0;border-radius:10px;padding:6px 10px;font-weight:800;cursor:pointer;background:#f5b82e;color:#1f2b44;}
.av-t-wrap details{border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 12px;margin:8px 0;}
.av-t-wrap summary{cursor:pointer;font-weight:800;}
.av-t-wrap table{width:100%;border-collapse:collapse;margin-top:8px;}
.av-t-wrap td{padding:4px 6px;border-top:1px solid var(--line,#e3e7f0);vertical-align:middle;font-size:.88rem;}
.av-t-wrap .av-mini{width:40px;height:40px;border-radius:50%;overflow:hidden;line-height:0;}
.av-t-wrap input[type=number]{width:84px;}
.av-t-cur{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;}
.av-t-cur label{display:flex;align-items:center;gap:6px;border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 12px;cursor:pointer;font-weight:800;}
.av-t-tiers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:8px 0;}
@media (max-width:700px){.av-body{flex-direction:column;}.av-left{flex:none;flex-direction:row;flex-wrap:wrap;justify-content:center;}.av-prev{width:120px;height:120px;}.av-prev.av-initials{font-size:2.4rem;}.av-t-tiers{grid-template-columns:repeat(2,minmax(0,1fr));}}
html.dark-mode .av-chip{background:#222b46;}
html.dark-mode .av-tile .av-t-price.own{color:#5be3a5;}
html.dark-mode .av-self-btn .av-pen{border-color:#1a2036;}`;
    document.head.appendChild(st);
  }
  function toast(html, btnText, onBtn) {
    css();
    const old = document.getElementById("avToast"); if (old) old.remove();
    const t = document.createElement("div"); t.id = "avToast"; t.className = "av-toast";
    t.innerHTML = `<span>${html}</span>${btnText ? `<button type="button">${btnText}</button>` : ""}<button type="button" aria-label="Close" style="background:none;color:#fff;font-size:1.2rem;padding:0 4px;">\u00d7</button>`;
    const bs = t.querySelectorAll("button");
    if (btnText) bs[0].onclick = () => { t.remove(); onBtn(); };
    bs[bs.length - 1].onclick = () => t.remove();
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 12000);
  }

  /* ---------------- editor ---------------- */
  let ED = null;
  async function openEditor() {
    if (!ME || ME.role !== "student" || document.getElementById("avOv")) return;
    css();
    const [me, cls] = await Promise.all([getUser(ME.username), getClass(ME.classCode)]);
    if (!me) return;
    const av = me.avatar || {};
    ED = {
      me, shop: shopOf(cls), owned: new Set(av.owned || []), look: cleanLook(av.look || DEFAULT_LOOK),
      on: !!av.on, cat: "costume", busy: false
    };
    const ov = document.createElement("div");
    ov.id = "avOv"; ov.className = "av-ov";
    ov.innerHTML = `<div class="av-card" role="dialog" aria-modal="true" aria-label="Avatar editor">
      <div class="av-head"><h3>Your avatar</h3><button class="av-x" type="button" id="avClose" aria-label="Close">\u00d7</button></div>
      <div class="av-body">
        <div class="av-left"><div class="av-prev" id="avPrev"></div>
          <div id="avWallet" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;"></div>
          <label class="muted-small" style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="avInitials"> Show my initials instead</label>
          <div id="avLog" class="muted-small"></div></div>
        <div class="av-right"><div class="av-tabs" id="avTabs" role="tablist"></div><div class="av-hint" id="avHint"></div><div class="av-grid" id="avGrid"></div></div>
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
    ov.querySelector("#avSave").onclick = () => saveEditor(close);
    const chk = ov.querySelector("#avInitials");
    chk.checked = !ED.on;
    chk.onchange = () => { ED.on = !chk.checked; paintEditor(); };
    ov.querySelector("#avTabs").innerHTML = CATS.map(c => `<button type="button" class="av-tab" role="tab" data-cat="${c.id}">${c.label}</button>`).join("");
    ov.querySelector("#avTabs").onclick = e => { const b = e.target.closest("[data-cat]"); if (b) { ED.cat = b.dataset.cat; paintEditor(); } };
    ov.querySelector("#avGrid").onclick = e => {
      const b = e.target.closest("[data-id]"); if (!b) return;
      ED.look[ED.cat] = b.dataset.id; ED.on = true; chk.checked = false; paintEditor();
    };
    const log = (me.cometLog || []).slice(0, 3).map(l => `<div>${COMET}${l.amount > 0 ? "+" : ""}${esc(l.amount)} ${esc(l.note || "")}</div>`).join("");
    ov.querySelector("#avLog").innerHTML = ED.shop.currency === "comets" && log ? `<b>Recent Comets</b>${log}` : "";
    paintEditor();
  }
  function visible(cat) {
    return itemsOf(cat).filter(it => {
      const key = cat + ":" + it[0];
      return it[2] === 0 || !ED.shop.hidden.includes(key) || ED.owned.has(key) || ED.look[cat] === it[0];
    });
  }
  function cartOf(look, owned, shop) {
    const items = [];
    CATS.forEach(c => {
      const id = look[c.id], r = rOf(c.id, id), key = c.id + ":" + id;
      if (r > 0 && !owned.has(key)) items.push({ cat: c.id, id, key, price: priceOf(shop, c.id, id, r) });
    });
    return items;
  }
  function paintEditor() {
    const E = ED; if (!E) return;
    const $ = id => document.getElementById(id);
    E.look = cleanLook(E.look);
    const prev = $("avPrev");
    if (E.on) { prev.className = "av-prev"; prev.innerHTML = renderSvg(E.look, { size: 200 }); }
    else { prev.className = "av-prev av-initials"; prev.textContent = (typeof initials === "function" ? initials(E.me.name) : "?").replace(/&amp;/g, "&"); }
    document.querySelectorAll("#avTabs .av-tab").forEach(b => b.classList.toggle("on", b.dataset.cat === E.cat));
    const cat = E.cat, list = visible(cat);
    $("avGrid").innerHTML = list.map(it => {
      const id = it[0], r = it[2], key = cat + ":" + id, price = priceOf(E.shop, cat, id, r);
      const own = r === 0 || E.owned.has(key), on = E.look[cat] === id;
      const look = Object.assign({}, E.look, { [cat]: id });
      const chip = own ? `<span class="av-t-price own">${r === 0 ? "Free" : "Owned"}</span>` : price === 0 ? `<span class="av-t-price own">Free</span>` : `<span class="av-t-price">${fmtPrice(E.shop, price)}</span>`;
      return `<button type="button" class="av-tile${on ? " on" : ""}" data-id="${esc(id)}" aria-pressed="${on}" title="${esc(it[1])} (${RARITY[r]})">${r ? `<i class="av-r av-r${r}"></i>` : ""}<span class="av-t-img">${renderSvg(look, { size: 68 })}</span><span class="av-t-name">${esc(it[1])}</span>${chip}</button>`;
    }).join("");
    const hide = E.look.costume !== "none" && ["hair", "hairColor", "top", "topColor", "hat"].includes(cat);
    $("avHint").textContent = hide ? "Your costume is covering this, so changes here won't show until you take the costume off." : E.shop.currency === "free" ? "Everything is free in this class. Have fun!" : "";
    const cart = cartOf(E.look, E.owned, E.shop).filter(i => i.price > 0);
    const total = cart.reduce((a, i) => a + i.price, 0);
    const bal = E.shop.currency === "comets" ? (Number(E.me.comets) || 0) : (Number(E.me.balance) || 0);
    $("avWallet").innerHTML = E.shop.currency === "comets" ? `<span class="av-chip">${COMET}${bal} Comets</span>` : E.shop.currency === "money" ? `<span class="av-chip">${fmtPrice(E.shop, bal)} cash</span>` : "";
    $("avSum").innerHTML = cart.length ? `Buying ${cart.length} new item${cart.length === 1 ? "" : "s"}: <b>${fmtPrice(E.shop, total)}</b>${total > bal ? ` <span style="color:#b8402c">(not enough)</span>` : ""}` : "Nothing to buy.";
    $("avSave").textContent = cart.length ? "Buy & save" : "Save";
  }
  async function saveEditor(close) {
    const E = ED; if (!E || E.busy) return;
    E.busy = true;
    const msg = document.getElementById("avMsg"), btn = document.getElementById("avSave");
    btn.disabled = true; msg.textContent = "";
    try {
      const cls = await getClass(ME.classCode), shop = shopOf(cls);
      const ref = usersCol().doc(ME.username);
      let paid = 0, names = [];
      await fdb.runTransaction(async t => {
        const snap = await t.get(ref);
        const u = snap.data(), a = u.avatar || {};
        const owned = new Set(a.owned || []);
        const cart = cartOf(E.look, owned, shop);
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
        upd.avatar = { on: E.on, look: E.look, owned: Array.from(owned) };
        paid = total; names = cart.filter(i => i.price > 0).map(i => nameOf(i.cat, i.id));
        t.update(ref, upd);
      });
      if (paid > 0 && shop.currency === "money" && typeof logTxn === "function") {
        await logTxn(ME.classCode, { type: "store-buy", from: ME.username, amount: paid, note: "Avatar items: " + names.join(", ") }).catch(() => {});
      }
      close();
      document.querySelectorAll(`[data-av-user="${CSS.escape(ME.username)}"]`).forEach(el => {
        const tmp = document.createElement("div");
        tmp.innerHTML = badge({ username: ME.username, name: E.me.name, avatar: E.on ? { on: true, look: E.look } : null }, { size: el.classList.contains("av-big") ? 56 : undefined });
        const nb = tmp.firstChild; if (el.parentNode && nb) { el.className = nb.className + (el.classList.contains("av-big") ? " av-big" : ""); el.innerHTML = nb.innerHTML; }
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
    const groups = CATS.filter(c => !["skin", "topColor"].includes(c.id));
    host.innerHTML = `<div class="av-t-wrap">
      <p class="muted-small">Students edit their avatar by clicking their round avatar on their dashboard. Pick how items are paid for. Comets are a separate currency that only you can give, and they can only be spent here.</p>
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
      <h3 style="margin-top:18px;">${COMET} Give Comets</h3>
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
      if (c === "free") { box.innerHTML = `<p class="muted-small">Everything is free. Students can wear anything.</p>`; return; }
      box.innerHTML = `<div class="muted-small">Default price for each tier (${c === "comets" ? "in Comets" : "in 29 World dollars"}):</div><div class="av-t-tiers">${[1, 2, 3, 4].map(r => `<div><label>${RARITY[r]}</label><input type="number" min="0" step="${c === "comets" ? 1 : .5}" data-tier="${r}" value="${draft.tiers[c][r]}"></div>`).join("")}</div>`;
      box.querySelectorAll("[data-tier]").forEach(i => i.oninput = () => { draft.tiers[c][i.dataset.tier] = Math.max(0, Number(i.value) || 0); });
    }
    function paintItems() {
      const c = cur(), box = host.querySelector("#avItemBox");
      box.innerHTML = groups.map(g => `<details><summary>${g.label}</summary><table>${g.list.filter(it => it[2] > 0).map(it => {
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

  /* ---------------- boot ---------------- */
  async function boot() {
    let u = null;
    try { u = await getSessionUser(); } catch (e) { return; }
    if (!u) return;
    ME = { username: u.username, role: u.role, classCode: u.classCode };
    css();
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
        b.innerHTML = badge({ username: u.username, name: u.name, avatar: me && me.avatar }, { size: 56 }).replace('class="student-avatar', 'class="av-big student-avatar') + `<span class="av-pen">\u270e</span>`;
        b.onclick = e => { e.stopPropagation(); openEditor(); };
        row.insertBefore(b, row.firstChild);
        row.style.justifyContent = row.style.justifyContent || "";
      }
      try {
        const me = await getUserCached(u.username), c = Number(me && me.comets) || 0, key = "t29-comets-seen-" + u.username;
        const seen = localStorage.getItem(key);
        if (seen !== null && c > Number(seen)) toast(`${COMET} You received <b>${c - Number(seen)}</b> Comet${c - Number(seen) === 1 ? "" : "s"}! Use them to customise your avatar.`, "Open editor", openEditor);
        localStorage.setItem(key, String(c));
      } catch (e) { /* ignore */ }
    } else if (u.role === "teacher") {
      mountTeacher(u).catch(() => {});
    }
  }

  window.avatarBadge = badge;
  window.T29Avatar = { badge, openEditor, renderSvg, shopOf };
  document.addEventListener("DOMContentLoaded", () => { boot().catch(() => {}); });
})();
