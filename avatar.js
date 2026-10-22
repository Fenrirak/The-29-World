/* ===================== The 29 World — Avatars =====================
   Students are shown as their initials by default. Clicking their own
   round avatar opens the editor, where they can build a character out of
   body type, skin, hair, eyes, mouth, outfits, hats, glasses, extras,
   backgrounds, effects and costumes. Everything is drawn as inline SVG
   (no image files).

   Teachers choose, per class, how items are paid for: 29 World money,
   free, or Comets (a separate currency only teachers can hand out) — plus
   per-item prices, and hiding items they don't want in their class.

   Stored on the student's /users doc:
     avatar: { on: bool, look: {... gender: "boy"|"girl"|"neutral" ...},
               owned: [\"hair:curly\", ...] }
     comets: number            (only a teacher can raise it)
     cometLog: [{ at, amount, note }]   (last 20, written by the teacher)
   and on the class doc:
     avatarShop: { currency: \"free\"|\"money\"|\"comets\",
                   tiers: { money:{1..4}, comets:{1..4} },
                   prices: { money:{ \"hat:crown\": 30 }, comets:{} },
                   hidden: [\"hat:crown\"] }

   Drawing rules (so nothing ever pokes out):
     - anything with a pattern is clipped to the shape it sits on
     - arms, straps and strings that touch the head are clipped to the head
     - things that rest on the shoulders are clipped to the body
   =================================================================== */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;

  /* ------------------------------ helpers ------------------------------ */
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
  // Per-render drawing context: unique ids, shared <defs>, and clip helpers.
  function makeCtx() {
    const c = {
      defs: "", _h: null, _b: null,
      id: n => "av" + (++UID) + n,
      clip(d, inner) { const i = c.id("k"); c.defs += `<clipPath id="${i}"><path d="${d}"/></clipPath>`; return `<g clip-path="url(#${i})">${inner}</g>`; },
      head(inner) {
        if (!c._h) { c._h = c.id("h"); c.defs += `<clipPath id="${c._h}"><ellipse cx="50" cy="44" rx="20" ry="22"/></clipPath>`; }
        return `<g clip-path="url(#${c._h})">${inner}</g>`;
      },
      body(inner) { return c.clip(BODY, inner); }
    };
    return c;
  }

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
    { id: "rainbow", name: "Rainbow", v: "rainbow", r: 4 }
  ];
  const TOPC = [
    { id: "sky", name: "Sky", v: "#4aa3ff" }, { id: "navy", name: "Navy", v: "#2a3a63" }, { id: "red", name: "Red", v: "#e5484d" },
    { id: "coral", name: "Coral", v: "#ff7a59" }, { id: "gold", name: "Gold", v: "#f5b82e" }, { id: "mint", name: "Mint", v: "#3ecf8e" },
    { id: "green", name: "Forest", v: "#2e9e5b" }, { id: "purple", name: "Purple", v: "#8b5cf6" }, { id: "pink", name: "Pink", v: "#ff7eb6" },
    { id: "white", name: "White", v: "#f1f1f6" }, { id: "black", name: "Black", v: "#2f2f38" }, { id: "teal", name: "Teal", v: "#22b8cf" }
  ];
  const RARITY = ["Starter", "Common", "Rare", "Epic", "Legendary"];

  /* ------------------------------ body ---------------------------------- */
  const BODY = "M12 100 C12 83 28 75 50 75 C72 75 88 83 88 100Z";
  const GENDERS = {
    neutral: { sx: 1, neck: 16, brow: 1.7, arch: 2.4, rx: 20, ry: 22, cy: 44, ear: 30, nx: 1.5, ny: 1 },
    boy: { sx: 1.04, neck: 17.4, brow: 2.0, arch: 1.7, rx: 20.5, ry: 22, cy: 44, ear: 29.6, nx: 1.8, ny: 1.2 },
    girl: { sx: 0.93, neck: 14.6, brow: 1.4, arch: 3.2, rx: 19.3, ry: 22.4, cy: 44.2, ear: 30.8, nx: 1.2, ny: .9 }
  };
  const GENDER_LIST = [["neutral", "Neutral", 0], ["boy", "Boy", 0], ["girl", "Girl", 0]];

  /* ------------------------------ shared shapes ------------------------- */
  const star5 = (x, y, r, f, st) => { let p = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; p += (i ? "L" : "M") + (x + Math.cos(a) * rr).toFixed(1) + " " + (y + Math.sin(a) * rr).toFixed(1); } return `<path d="${p}Z" fill="${f}"${st ? ` stroke="${st}" stroke-width=".9" stroke-linejoin="round"` : ""}/>`; };
  const heart = (x, y, s, f) => `<path d="M${x} ${y + s * 0.9} C${x - s * 1.6} ${y - s * 0.1} ${x - s * 0.7} ${y - s * 1.2} ${x} ${y - s * 0.35} C${x + s * 0.7} ${y - s * 1.2} ${x + s * 1.6} ${y - s * 0.1} ${x} ${y + s * 0.9}Z" fill="${f}"/>`;
  const rrect = (x, y, w, h, r) => `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y}Z`;

  /* ------------------------------ hair --------------------------------- */
  const CAP = "M29 47 C26 22 38 14 50 14 C62 14 74 22 71 47 C70 38 66 31 58 29 C52 34 40 32 34 36 C31 39 30 43 29 47Z";
  const shine = (ctx, d) => ctx.clip(d, `<path d="M33 28 C39 18 58 15.5 67 24" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  const braid = (x0, dir, c, d) => {
    let s = "";
    const ys = [55, 61.4, 67.8, 74.2, 80.6, 87];
    ys.forEach((y, i) => {
      const x = x0 + dir * i * 0.35, r = 3.5 - i * 0.12;
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y}" rx="${r.toFixed(1)}" ry="3.9" fill="${c}"/><path d="M${(x - r + .6).toFixed(1)} ${y - 1.2} Q${x.toFixed(1)} ${y + 2.4} ${(x + r - .6).toFixed(1)} ${y - 1.2}" stroke="${d}" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".7"/>`;
    });
    const xe = x0 + dir * 5 * 0.35;
    return s + `<ellipse cx="${xe.toFixed(1)}" cy="91.4" rx="3" ry="2.1" fill="#ff5d8f"/>`;
  };
  const HAIR = {
    bald: () => ({}),
    buzz: c => ({ front: `<path d="M30 40 C29 24 40 19 50 19 C60 19 71 24 70 40 C66 31 58 27 50 27 C42 27 34 31 30 40Z" fill="${c}"/>` }),
    short: (c, d, x) => ({ front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}` }),
    quiff: (c, d, x) => { const p = "M29 47 C24 24 38 9 56 11 C72 13 76 30 71 47 C69 36 62 29 52 28 C42 28 33 34 29 47Z"; return { front: `<path d="${p}" fill="${c}"/>${x.clip(p, `<path d="M36 22 C42 13 60 11 70 22" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" fill="none" stroke-linecap="round"/>`)}` }; },
    long: (c, d, x) => ({ back: `<path d="M26 46 C21 72 26 90 36 94 L64 94 C74 90 79 72 74 46Z" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}` }),
    bob: (c, d, x) => { const p = "M28 47 C26 22 38 14 50 14 C62 14 74 22 72 47 C70 37 62 32 50 32 C38 32 30 37 28 47Z"; return { back: `<path d="M25 44 C21 62 25 73 36 75 L64 75 C75 73 79 62 75 44Z" fill="${c}"/>`, front: `<path d="${p}" fill="${c}"/>${shine(x, p)}` }; },
    ponytail: (c, d, x) => ({
      back: `<path d="M68 27 C80 24 91 36 88 53 C86 63 80 70 77 77 C75 67 78 59 76 51 C74 45 70 42 67 40Z" fill="${c}"/>`,
      front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}<ellipse cx="70.4" cy="32" rx="2.6" ry="3.4" fill="#ff5d8f" transform="rotate(-14 70.4 32)"/>`
    }),
    swoop: (c, d, x) => { const p = "M28.5 47 C23 22 40 11 55 13 C71 15 75 30 71.5 47 C69 36 62 30 54 31 C46 32 38 33 33 40 C31.5 42.5 30 45 28.5 47Z"; return { front: `<path d="${p}" fill="${c}"/>${x.clip(p, `<path d="M34 24 C42 15 60 14 68 24" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" fill="none" stroke-linecap="round"/>`)}` }; },
    wavy: (c, d, x) => ({ back: `<path d="M26 46 C20 58 28 66 25 77 C24 84 30 88 35 88 L65 88 C70 88 76 84 75 77 C72 66 80 58 74 46Z" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}` }),
    braids: (c, d, x) => ({ front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}${braid(29.6, -1, c, d)}${braid(70.4, 1, c, d)}` }),
    curly: c => ({ front: ["34,26,9", "44,19,9.5", "56,19,9.5", "66,26,9", "29,38,7", "71,38,7", "50,23,9"].map(s => { const [x, y, r] = s.split(","); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`; }).join("") }),
    spiky: c => ({ front: `<path d="M28 44 L25 21 L36 28 L37 9 L46 24 L52 5 L58 24 L66 9 L66 28 L75 21 L72 44 C68 34 60 30 50 30 C40 30 32 34 28 44Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>` }),
    mohawk: (c, d) => ({ front: `<path d="M30.4 40 C29.4 27 40 22 50 22 C60 22 70.6 27 69.6 40 C66 33 58 29 50 29 C42 29 34 33 30.4 40Z" fill="${d}" opacity=".55"/><path d="M40.6 32 C38 22 39.4 13 43 7.4 C45 11.4 46.6 12.6 50 3 C53.4 12.6 55 11.4 57 7.4 C60.6 13 62 22 59.4 32 C54 28.6 46 28.6 40.6 32Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>` })
  };
  const HAIR_LIST = [["bald", "Bald", 0], ["buzz", "Buzz cut", 0], ["short", "Short", 0], ["long", "Long", 0],
    ["quiff", "Quiff", 1], ["bob", "Bob", 1], ["ponytail", "Ponytail", 1], ["swoop", "Side swoop", 1],
    ["wavy", "Wavy long", 2], ["braids", "Braids", 2], ["curly", "Curly", 2], ["spiky", "Spiky", 2], ["mohawk", "Mohawk", 3]];

  /* ------------------------------ eyes --------------------------------- */
  const EYE_Y = 45;
  const both = fn => [41, 59].map((x, i) => fn(x, i)).join("");
  const EYES = {
    dots: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="2.8" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .9}" r=".8" fill="#fff"/>`),
    round: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="4.6" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .3}" r="2.5" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .6}" r=".8" fill="#fff"/>`),
    happy: () => both(x => `<path d="M${x - 4.2} ${EYE_Y + 1.6} Q${x} ${EYE_Y - 5} ${x + 4.2} ${EYE_Y + 1.6}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`),
    sleepy: () => both(x => `<path d="M${x - 4} ${EYE_Y} Q${x} ${EYE_Y + 3.8} ${x + 4} ${EYE_Y}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`),
    sparkle: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="5.2" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .4}" r="3.4" fill="#3b2f66"/><circle cx="${x}" cy="${EYE_Y + .4}" r="1.9" fill="${INK}"/><circle cx="${x + 1.4}" cy="${EYE_Y - 1.2}" r="1.1" fill="#fff"/><circle cx="${x - 1.2}" cy="${EYE_Y + 1.6}" r=".6" fill="#fff"/>`),
    wink: () => `<circle cx="41" cy="${EYE_Y}" r="2.8" fill="${INK}"/><circle cx="41.9" cy="${EYE_Y - .9}" r=".8" fill="#fff"/><path d="M55 ${EYE_Y + 1.6} Q59 ${EYE_Y - 5} 63 ${EYE_Y + 1.6}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    cool: sk => both(x => {
      const y = EYE_Y + .6;
      return `<ellipse cx="${x}" cy="${y}" rx="4.4" ry="3.6" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x + 1}" cy="${y + 1.2}" r="2" fill="${INK}"/><path d="M${x - 4.4} ${y} A4.4 3.6 0 0 1 ${x + 4.4} ${y}Z" fill="${shade(sk, -.2)}"/><path d="M${x - 4.8} ${y} H${x + 4.8}" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>`;
    }),
    lashes: () => both((x, i) => { const s = i ? 1 : -1; return `<circle cx="${x}" cy="${EYE_Y}" r="3" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .9}" r=".9" fill="#fff"/><path d="M${x + s * 2.4} ${EYE_Y - 2} Q${x + s * 4.4} ${EYE_Y - 2.4} ${x + s * 5.2} ${EYE_Y - 4.4} M${x + s * 2.9} ${EYE_Y - .2} Q${x + s * 5} ${EYE_Y - .6} ${x + s * 6} ${EYE_Y - 2}" stroke="${INK}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`; }),
    stars: () => both(x => star5(x, EYE_Y, 5.6, "#ffc93c", "#b8860b") + `<circle cx="${x}" cy="${EYE_Y}" r="1.2" fill="#fff"/>`),
    hearts: () => both(x => heart(x, EYE_Y - .6, 3.6, "#ee3f66")),
    dizzy: () => both(x => `<path d="M${x - 3.4} ${EYE_Y - 3.4} l6.8 6.8 M${x + 3.4} ${EYE_Y - 3.4} l-6.8 6.8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`),
    dollar: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="5" fill="#3ecf8e" stroke="#1f8a5b" stroke-width="1"/><text x="${x}" y="${EYE_Y + 3.2}" font-size="8.6" font-weight="900" text-anchor="middle" fill="#0e4d33" font-family="Arial,sans-serif">$</text>`)
  };
  const EYE_LIST = [["dots", "Dots", 0], ["round", "Round", 0], ["happy", "Happy", 0], ["sleepy", "Sleepy", 0], ["sparkle", "Sparkly", 1], ["wink", "Wink", 1],
    ["lashes", "Lashes", 1], ["cool", "Cool", 1], ["dizzy", "Dizzy", 2], ["stars", "Star eyes", 3], ["hearts", "Heart eyes", 3], ["dollar", "Money eyes", 3]];

  /* ------------------------------ mouths -------------------------------- */
  const MOUTH = {
    smile: () => `<path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    grin: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44.4 57.4 H55.6" stroke="${INK}" stroke-width=".8"/>`,
    neutral: () => `<path d="M45 57 H55" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    open: () => `<path d="M43.5 54 Q50 68 56.5 54Z" fill="#6e2233" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M46.4 61.2 Q50 57.8 53.6 61.2 Q50 64.4 46.4 61.2Z" fill="#ff7b8e"/>`,
    smirk: () => `<path d="M45 57.4 Q51 59.6 57.4 53.8" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    tongue: () => `<path d="M47 58.2 Q47.2 65.6 51.2 65 Q54.2 62.4 53 58.2Z" fill="#ff6f91" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/><path d="M50 59.4 V62.6" stroke="#d94a72" stroke-width=".8" stroke-linecap="round"/><path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    surprised: () => `<ellipse cx="50" cy="58" rx="3.2" ry="4" fill="#5a1f30" stroke="${INK}" stroke-width="1.4"/>`,
    kiss: () => heart(50, 57.6, 3.1, "#e8505b"),
    gold: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44.4 55.2 Q50 59.6 55.6 55.2 L54.8 57.2 Q50 60.4 45.2 57.2Z" fill="#f5c542"/>`,
    braces: () => `<path d="M42.5 53.5 Q50 65 57.5 53.5Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M44.4 55.4 Q50 60 55.6 55.4" stroke="#9aa3b5" stroke-width="1.5" fill="none"/><path d="M47 55.8 v2.2 M50 56.6 v2.4 M53 55.8 v2.2" stroke="#9aa3b5" stroke-width="1"/>`
  };
  const MOUTH_LIST = [["smile", "Smile", 0], ["grin", "Big grin", 0], ["neutral", "Neutral", 0], ["open", "Open smile", 0], ["smirk", "Smirk", 1], ["tongue", "Tongue out", 1],
    ["surprised", "Surprised", 1], ["braces", "Braces", 2], ["kiss", "Kiss", 2], ["gold", "Gold teeth", 3]];

  /* ------------------------------ face extras --------------------------- */
  const FACE = {
    none: () => "",
    freckles: () => ["35,52", "38.5,54.4", "41.5,51.6", "58.5,51.6", "61.5,54.4", "65,52"].map(s => { const [x, y] = s.split(","); return `<circle cx="${x}" cy="${y}" r=".95" fill="#a8613a" opacity=".85"/>`; }).join(""),
    blush: () => `<ellipse cx="37" cy="53" rx="4.4" ry="2.7" fill="#ff7b9c" opacity=".5"/><ellipse cx="63" cy="53" rx="4.4" ry="2.7" fill="#ff7b9c" opacity=".5"/>`,
    mustache: h => `<path d="M42 54.4 C43.6 50.6 47.6 51.2 50 53.2 C52.4 51.2 56.4 50.6 58 54.4 C55.4 53.6 52.6 54.8 50 56.2 C47.4 54.8 44.6 53.6 42 54.4Z" fill="${h}"/>`,
    goatee: h => `<path d="M44.6 60.4 C46.4 58.8 53.6 58.8 55.4 60.4 C56.4 63.8 54.6 67 50 67 C45.4 67 43.6 63.8 44.6 60.4Z" fill="${h}"/>`,
    beard: h => `<path fill-rule="evenodd" d="M30.8 49 C31 58 36 70 50 70 C64 70 69 58 69.2 49 C66 53.4 62.5 54 58.5 53.2 C55.4 52 52.8 52.4 50 53.2 C47.2 52.4 44.6 52 41.5 53.2 C37.5 54 34 53.4 30.8 49Z M42 55.2 Q50 51.8 58 55.2 Q57.6 63.6 50 64.2 Q42.4 63.6 42 55.2Z" fill="${h}"/>`,
    whiskers: (h, x) => x.head(`<path d="M31.6 52 L40 53.6 M31.4 56.2 L39.8 56.2 M68.4 52 L60 53.6 M68.6 56.2 L60.2 56.2" stroke="${INK}" stroke-width=".9" stroke-linecap="round" opacity=".55"/>`),
    stripes: (h, x) => x.head(`<path d="M30 49.6 L38.4 51.8 M30 54.6 L38 56.2 M70 49.6 L61.6 51.8 M70 54.6 L62 56.2" stroke="#3a8dff" stroke-width="2.4" stroke-linecap="round"/>`),
    paintstars: () => star5(36.6, 53, 3.6, "#ff5d8f") + star5(63.4, 53, 3.6, "#3a8dff"),
    glitter: () => ["35,50,1.2", "38,55,.9", "63,50,1.2", "61,55,.9", "50,37,1", "46,38.4,.8"].map(s => { const [x, y, r] = s.split(","); return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff6a8" stroke="#f5b82e" stroke-width=".4"/>`; }).join(""),
    scar: () => `<path d="M35.4 48.6 L40 58.4" stroke="#c4523f" stroke-width="1.5" stroke-linecap="round"/><path d="M35.2 52.3 l3.3 -1.5 M36.6 55.3 l3.3 -1.5 M37.6 57.6 l3 -1.4" stroke="#8f3322" stroke-width=".9" stroke-linecap="round"/>`,
    mask: (h, x) => x.head(`<path d="M28 50 C35 54 43 57 50 57 C57 57 65 54 72 50 V70 H28Z" fill="#cfe9ff" stroke="#8fb8d8" stroke-width="1"/><path d="M36 60 Q50 63.4 64 60 M37.4 64 Q50 67 62.6 64" stroke="#9fc4e0" stroke-width=".9" fill="none" stroke-linecap="round"/>`) + `<path d="M31.2 51.6 L29.2 49.8 M68.8 51.6 L70.8 49.8" stroke="#8fb8d8" stroke-width="1.2" stroke-linecap="round"/>`
  };
  const FACE_LIST = [["none", "Nothing", 0], ["freckles", "Freckles", 1], ["blush", "Blush", 1], ["whiskers", "Whiskers", 1], ["mustache", "Moustache", 1], ["goatee", "Goatee", 1], ["mask", "Face mask", 1],
    ["beard", "Beard", 2], ["stripes", "Warpaint", 2], ["glitter", "Glitter", 2], ["scar", "Scar", 2], ["paintstars", "Star paint", 3]];

  /* ------------------------------ glasses ------------------------------- */
  const shineLens = (x, y) => `<path d="M${x - 3.6} ${y - 2} Q${x - 2.4} ${y - 3.8} ${x - .4} ${y - 4.2}" stroke="#fff" stroke-opacity=".75" stroke-width="1.1" fill="none" stroke-linecap="round"/>`;
  const GLASS = {
    none: () => "",
    round: (x) => x.head(`<path d="M34 43.6 L27 42 M66 43.6 L73 42" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`) + `<circle cx="41" cy="45" r="7" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="1.8"/><circle cx="59" cy="45" r="7" fill="#fff" fill-opacity=".18" stroke="${INK}" stroke-width="1.8"/><path d="M48 44.4 Q50 42.8 52 44.4" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>${shineLens(41, 45)}${shineLens(59, 45)}`,
    square: (x) => x.head(`<path d="M33 42.4 L27 41.4 M67 42.4 L73 41.4" stroke="#1d3b8f" stroke-width="1.7" stroke-linecap="round"/>`) + `<rect x="33" y="39" width="15" height="11" rx="2.6" fill="#fff" fill-opacity=".18" stroke="#1d3b8f" stroke-width="2"/><rect x="52" y="39" width="15" height="11" rx="2.6" fill="#fff" fill-opacity=".18" stroke="#1d3b8f" stroke-width="2"/><path d="M48 43.2 H52" stroke="#1d3b8f" stroke-width="1.8"/><path d="M35.4 42 L38.4 41" stroke="#fff" stroke-opacity=".75" stroke-width="1.1" stroke-linecap="round"/><path d="M54.4 42 L57.4 41" stroke="#fff" stroke-opacity=".75" stroke-width="1.1" stroke-linecap="round"/>`,
    shades: (x) => x.head(`<path d="M32 41 L27 40 M68 41 L73 40" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>`) + `<path d="M32 40 H48 V47 Q48 52 42 52 H38 Q32 52 32 47Z M52 40 H68 V47 Q68 52 62 52 H58 Q52 52 52 47Z" fill="#1b1b22" stroke="#1b1b22" stroke-width="1" stroke-linejoin="round"/><path d="M48 41.4 H52" stroke="#1b1b22" stroke-width="2"/><path d="M35 42.6 H39 M55 42.6 H59" stroke="#fff" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>`,
    heart: () => heart(40.5, 44.6, 6.2, "#ff5d8f") + heart(59.5, 44.6, 6.2, "#ff5d8f") + `<path d="M46.6 42.6 Q50 41 53.4 42.6" stroke="#c42d62" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    star: () => star5(40.5, 45, 8.6, "#ffcf3f", "#8a6a0a") + star5(59.5, 45, 8.6, "#ffcf3f", "#8a6a0a") + `<path d="M47.4 44 H52.6" stroke="#c9961a" stroke-width="1.6" stroke-linecap="round"/>`,
    threed: () => `<rect x="32" y="39" width="16" height="11" rx="1.8" fill="#ff4d4d" fill-opacity=".8" stroke="#fff" stroke-width="2.4"/><rect x="52" y="39" width="16" height="11" rx="1.8" fill="#2fb7ff" fill-opacity=".8" stroke="#fff" stroke-width="2.4"/><path d="M48 43 H52" stroke="#fff" stroke-width="2.4"/>`,
    monocle: () => `<circle cx="59" cy="45" r="7.4" fill="#fff" fill-opacity=".2" stroke="#c9961a" stroke-width="1.8"/>${shineLens(59, 45)}`,
    goggles: (x) => x.head(`<rect x="26" y="41.4" width="10" height="5.4" fill="#5a4636"/><rect x="64" y="41.4" width="10" height="5.4" fill="#5a4636"/>`) + `<rect x="48" y="43.4" width="4" height="3.2" fill="#5a4636"/><circle cx="41" cy="45" r="8.6" fill="#ffb347" fill-opacity=".55" stroke="#8a5a2b" stroke-width="3"/><circle cx="59" cy="45" r="8.6" fill="#ffb347" fill-opacity=".55" stroke="#8a5a2b" stroke-width="3"/><path d="M36 41 q3 -2 6 0" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    visor: () => `<path d="M31 41 Q50 36 69 41 L68 50 Q50 54 32 50Z" fill="#19e3d4" fill-opacity=".72" stroke="#0d8f87" stroke-width="1.6" stroke-linejoin="round"/><path d="M35 43 L42 42" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`
  };
  const GLASS_LIST = [["none", "None", 0], ["round", "Round specs", 1], ["square", "Square specs", 1], ["shades", "Sunglasses", 2], ["heart", "Heart shades", 2], ["star", "Star shades", 2],
    ["threed", "3D glasses", 2], ["monocle", "Monocle", 3], ["goggles", "Goggles", 3], ["visor", "Cyber visor", 4]];

  /* ------------------------------ hats ---------------------------------- */
  // Hats that sit over the hair hide whatever hair would be above them.
  const HAT_COVER = new Set(["cap", "beanie", "bucket", "beret", "hardhat", "grad", "chef", "cowboy", "santa", "sombrero", "tophat", "propeller"]);
  const HATS = {
    none: () => "",
    cap: (x) => { const crown = "M29.5 34 C27 7 73 7 70.5 34 Q50 29.5 29.5 34Z"; return `<path d="${crown}" fill="#e5484d"/>${x.clip(crown, `<path d="M50 14 V32 M39.4 16 Q37 24 36.4 32 M60.6 16 Q63 24 63.6 32" stroke="#b02a2f" stroke-width="1" fill="none" opacity=".55"/>`)}<circle cx="50" cy="14.6" r="2" fill="#b02a2f"/><path d="M26.5 33.4 Q50 26.8 73.5 33.4 Q50 38.8 26.5 33.4Z" fill="#b02a2f"/>`; },
    beanie: () => `<path d="M28.5 35 C25 4 75 4 71.5 35Z" fill="#8b5cf6"/><rect x="27" y="29.5" width="46" height="8" rx="4" fill="#6b3fd6"/><path d="M33 31 v5 M39 31 v5 M45 31 v5 M51 31 v5 M57 31 v5 M63 31 v5 M69 31.4 v4.2" stroke="#8b5cf6" stroke-width="1.2" stroke-linecap="round" opacity=".7"/><circle cx="50" cy="10.4" r="5.6" fill="#f1f1f6"/><circle cx="48.4" cy="8.8" r="1.4" fill="#fff"/>`,
    bucket: (x) => { const crown = "M30 34 L33 11.5 Q50 6 67 11.5 L70 34Z"; return `<path d="${crown}" fill="#7ac7a0"/>${x.clip(crown, `<path d="M20 27.4 H80" stroke="#fff" stroke-width="2.4"/>`)}<path d="M21 33.4 Q50 25 79 33.4 Q50 39.6 21 33.4Z" fill="#5fae86"/>`; },
    headband: () => `<path d="M29.4 34 Q50 21.5 70.6 34" stroke="#ff5d8f" stroke-width="4.6" fill="none" stroke-linecap="round"/>${star5(50, 26.6, 5.4, "#ffd23f", "#c9961a")}`,
    beret: () => `<path d="M27 33.4 C23 17 38 8 56 9 C72 10 80 20 72 31 C60 35 40 36 27 33.4Z" fill="#e5484d"/><path d="M33 31.6 Q50 35.4 70.6 30.6" stroke="#b02a2f" stroke-width="1.2" fill="none" opacity=".6" stroke-linecap="round"/><rect x="54" y="4.8" width="3.4" height="5" rx="1.7" fill="#b02a2f"/>`,
    hardhat: (x) => { const crown = "M28 34 C26 9 74 9 72 34Z"; return `<path d="${crown}" fill="#ffc21f"/>${x.clip(crown, `<path d="M44.4 10 L55.6 10 L56.4 34 L43.6 34Z" fill="#e8a600" opacity=".55"/><path d="M44.4 10 V34 M55.6 10 V34" stroke="#e8a600" stroke-width="1.2"/>`)}<rect x="24" y="30" width="52" height="5.6" rx="2.8" fill="#e8a600"/><circle cx="50" cy="24" r="2.6" fill="#fff6c9" stroke="#e8a600" stroke-width="1"/>`; },
    grad: () => `<path d="M34 24 L34 32.6 Q50 38.4 66 32.6 L66 24Z" fill="#2a2630"/><path d="M50 8 L84 20 L50 32 L16 20Z" fill="#33333d" stroke="#1d1d24" stroke-width="1" stroke-linejoin="round"/><path d="M50 19.6 Q66 23.2 78.4 21.4" stroke="#f5c542" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M78.4 21.4 V29.6" stroke="#f5c542" stroke-width="1.3" stroke-linecap="round"/><path d="M76.6 29.4 h3.6 l.7 4.6 h-5z" fill="#f5c542"/><circle cx="50" cy="19.8" r="2.1" fill="#f5c542"/>`,
    chef: (x) => { const band = "M33 21 H67 V34 H33Z"; return `<circle cx="38" cy="16" r="9" fill="#fff"/><circle cx="62" cy="16" r="9" fill="#fff"/><circle cx="50" cy="10" r="10" fill="#fff"/><path d="M33 21 H67 V34 H33Z" fill="#fff" stroke="#d8dce6" stroke-width="1.2" stroke-linejoin="round"/>${x.clip(band, `<path d="M41 22 V33 M50 22 V33 M59 22 V33" stroke="#d8dce6" stroke-width="1"/>`)}<path d="M33 30 H67" stroke="#d8dce6" stroke-width="1.2"/>`; },
    cowboy: (x) => { const crown = "M33 28 C32 12 38 8 50 9 C62 8 68 12 67 28Z"; return `<path d="M13 30 C24 37 34 31 36 28.4 L64 28.4 C66 31 76 37 87 30 C85 22 74 24 69 26 L31 26 C26 24 15 22 13 30Z" fill="#a8743a"/><path d="${crown}" fill="#c08848"/>${x.clip(crown, `<path d="M30 24.6 H70" stroke="#6b4a22" stroke-width="3.2"/>`)}<path d="M42 12 Q50 17 58 12" stroke="#a8743a" stroke-width="1.6" fill="none" stroke-linecap="round"/>`; },
    party: (x) => { const cone = "M50 6 L35.5 33 Q50 37 64.5 33Z"; return `<path d="${cone}" fill="#ff5d8f"/>${x.clip(cone, `<path d="M30 17 L70 17 M30 24.4 L70 24.4" stroke="#ffd23f" stroke-width="3"/><circle cx="46.6" cy="29.6" r="1.3" fill="#3a8dff"/><circle cx="53.6" cy="29.8" r="1.3" fill="#3ecf8e"/><circle cx="51" cy="12.4" r="1.1" fill="#3a8dff"/>`)}<circle cx="50" cy="6.4" r="3.6" fill="#ffd23f"/>`; },
    flowers: () => `<path d="M30 34 Q50 22 70 34" stroke="#3ea66a" stroke-width="2" fill="none" stroke-linecap="round"/>` + ["32,32.6,#ff7eb6", "39,28,#ffd23f", "46,25.6,#ff7eb6", "54,25.6,#8b5cf6", "61,28,#ff7eb6", "68,32.6,#ffd23f"].map(s => { const [x, y, f] = s.split(","); return `<g fill="${f}"><circle cx="${x}" cy="${+y - 2.4}" r="2.6"/><circle cx="${+x + 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${+y + 2.4}" r="2.6"/><circle cx="${+x - 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff6a8"/></g>`; }).join(""),
    halo: () => `<ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#f5c542" stroke-width="3.4"/><ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#fff6a8" stroke-width="1" opacity=".8"/>`,
    devil: () => `<path d="M31 27 C25.6 19 27.6 8.6 34 4.4 C33.6 12.4 37.6 18.6 42 22.4Z M69 27 C74.4 19 72.4 8.6 66 4.4 C66.4 12.4 62.4 18.6 58 22.4Z" fill="#e5484d" stroke="#a82327" stroke-width="1" stroke-linejoin="round"/>`,
    tophat: (x) => { const crown = "M34 30 L35 8 Q50 4 65 8 L66 30Z"; return `<ellipse cx="50" cy="30" rx="27" ry="5.2" fill="#1d1d24"/><path d="${crown}" fill="#26262e"/>${x.clip(crown, `<path d="M30 22.4 H70 V28.4 H30Z" fill="#e5484d"/>`)}<ellipse cx="50" cy="7.8" rx="15.2" ry="3" fill="#33333d"/>`; },
    sombrero: (x) => { const crown = "M36 28 C36 7 64 7 64 28Z"; return `<ellipse cx="50" cy="27.6" rx="38" ry="7.6" fill="#e8b04c"/><ellipse cx="50" cy="27.6" rx="34.4" ry="6.3" fill="none" stroke="#e5484d" stroke-width="1.1" stroke-dasharray="2 2.4"/><path d="${crown}" fill="#f5c76b"/>${x.clip(crown, `<path d="M30 23.6 H70" stroke="#e5484d" stroke-width="3.2"/>`)}`; },
    propeller: (x) => { const crown = "M29 34 C28 14 72 14 71 34Z"; return `<path d="${crown}" fill="#3a8dff"/>${x.clip(crown, `<path d="M29 31 Q50 36 71 31 V35 H29Z" fill="#e5484d"/>`)}<path d="M50 16.6 V9" stroke="#8a93a6" stroke-width="2" stroke-linecap="round"/><ellipse cx="41" cy="7.4" rx="9.4" ry="2.8" fill="#ffd23f" stroke="#c9961a" stroke-width=".8" transform="rotate(-10 41 7.4)"/><ellipse cx="59" cy="7.4" rx="9.4" ry="2.8" fill="#ffd23f" stroke="#c9961a" stroke-width=".8" transform="rotate(10 59 7.4)"/><circle cx="50" cy="8" r="2.2" fill="#e5484d"/>`; },
    santa: () => `<path d="M27.5 33 C26 14 40 5 58 6 C70 7 79 14 83 26 C77 20.6 71.6 21.6 70.6 28.6 L72.4 33Z" fill="#e5484d"/><rect x="26" y="28.6" width="48" height="8" rx="4" fill="#fff"/><circle cx="82" cy="27" r="5.2" fill="#fff"/>`,
    crown: () => `<path d="M30 30 L28 10 L40 20 L50 6 L60 20 L72 10 L70 30Z" fill="#f5c542" stroke="#c9961a" stroke-width="1.6" stroke-linejoin="round"/><rect x="30" y="25.6" width="40" height="5.6" fill="#e0a82a"/><circle cx="50" cy="28.4" r="2.2" fill="#e5484d"/><circle cx="39" cy="28.4" r="1.8" fill="#3a8dff"/><circle cx="61" cy="28.4" r="1.8" fill="#3ecf8e"/><circle cx="28" cy="10" r="2.2" fill="#fff"/><circle cx="50" cy="6" r="2.2" fill="#fff"/><circle cx="72" cy="10" r="2.2" fill="#fff"/>`
  };
  const HAT_LIST = [["none", "None", 0], ["cap", "Red cap", 1], ["beanie", "Beanie", 1], ["bucket", "Bucket hat", 1], ["headband", "Star headband", 1], ["beret", "Beret", 1], ["hardhat", "Hard hat", 2],
    ["grad", "Graduation cap", 2], ["chef", "Chef hat", 2], ["cowboy", "Cowboy hat", 2], ["party", "Party hat", 2], ["flowers", "Flower crown", 2], ["santa", "Santa hat", 2],
    ["devil", "Devil horns", 3], ["tophat", "Top hat", 3], ["sombrero", "Sombrero", 3], ["propeller", "Propeller cap", 3], ["halo", "Halo", 3], ["crown", "Golden crown", 4]];

  /* ------------------------------ extras -------------------------------- */
  const EXTRA = {
    none: () => ({}),
    headphones: () => ({ front: `<path d="M28.5 46 C26.5 21 36 17.5 50 17.5 C64 17.5 73.5 21 71.5 46" stroke="#33333d" stroke-width="4.2" fill="none" stroke-linecap="round"/><rect x="24.5" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/><rect x="66.5" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/>` }),
    earrings: () => ({ front: `<circle cx="29.8" cy="53.4" r="2" fill="none" stroke="#f5c542" stroke-width="1.3"/><circle cx="70.2" cy="53.4" r="2" fill="none" stroke="#f5c542" stroke-width="1.3"/>` }),
    flowerear: () => ({ front: `<g transform="translate(29.6 40.4)"><path d="M0 0 L-6.4 3 Q-4 -1 0 0Z M0 0 L-2.4 6.6 Q1.4 4 0 0Z" fill="#3ea66a"/><g fill="#ff5d8f"><circle cy="-3.6" r="3.2"/><circle cx="3.6" r="3.2"/><circle cy="3.6" r="3.2"/><circle cx="-3.6" r="3.2"/></g><circle r="2.2" fill="#ffd23f"/></g>` }),
    bowtie: () => ({ over: `<path d="M50 80.4 C45.4 74.8 39.2 75.2 39.2 80.4 C39.2 85.6 45.4 86 50 80.4Z M50 80.4 C54.6 74.8 60.8 75.2 60.8 80.4 C60.8 85.6 54.6 86 50 80.4Z" fill="#e5484d" stroke="#a82327" stroke-width="1" stroke-linejoin="round"/><rect x="47.4" y="77.6" width="5.2" height="5.6" rx="2" fill="#c43a40" stroke="#a82327" stroke-width=".8"/>` }),
    scarf: (x) => {
      const wrap = "M41.4 67.4 Q50 74 58.6 67.4 L62 72 C67.5 74 70.5 77 71 81.4 Q50 93 29 81.4 C29.5 77 32.5 74 38 72Z";
      const tail = "M56.6 82 L66.4 80.4 L68.4 98.2 L58 99.6Z";
      return { over: `<path d="${wrap}" fill="#e5484d"/>${x.clip(wrap, `<path d="M36 70 L33 90 M43 73 L41 92 M50 74 L50 94 M57 73 L59 92 M64 70 L67 90" stroke="#fff" stroke-width="2.6" opacity=".85"/>`)}<path d="${tail}" fill="#c43a40"/>${x.clip(tail, `<path d="M55 88 H70 M55 93.6 H70" stroke="#fff" stroke-width="2.4" opacity=".85"/>`)}` };
    },
    pearls: () => ({ over: [0, 1, 2, 3, 4, 5, 6].map(i => { const t = i / 6, px = 41.6 + t * 16.8, py = 76.4 + Math.sin(t * Math.PI) * 8; return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.1" fill="#fbf7ee" stroke="#cfc7b4" stroke-width=".6"/>`; }).join("") }),
    lanyard: (x) => ({ over: x.body(`<path d="M40.4 75.4 L50 87.6 L59.6 75.4" stroke="#3a8dff" stroke-width="2.8" fill="none" stroke-linejoin="round"/>`) + `<rect x="48.4" y="86" width="3.2" height="3" rx=".8" fill="#9aa3b5"/><rect x="43" y="88.4" width="14" height="10.2" rx="2" fill="#fff" stroke="#8a93a6" stroke-width="1"/><rect x="45" y="90.6" width="4.4" height="4.4" fill="#f1c27d"/><path d="M51 91.4 h4 M51 94.4 h4" stroke="#8a93a6" stroke-width="1" stroke-linecap="round"/>` }),
    medal: (x) => ({ over: x.body(`<path d="M40.4 75.4 L47 87 M59.6 75.4 L53 87" stroke="#e5484d" stroke-width="4"/>`) + `<circle cx="50" cy="91.4" r="6.4" fill="#f5c542" stroke="#c9961a" stroke-width="1.4"/>${star5(50, 91.4, 4, "#c9961a")}` }),
    eyepatch: (x) => ({ front: x.head(`<path d="M24 35 L54 42.6 M64 47.6 L76 50.6" stroke="#1d1d24" stroke-width="1.5" stroke-linecap="round"/>`) + `<ellipse cx="59" cy="45.6" rx="6.6" ry="5.6" fill="#1d1d24"/>` })
  };
  const EXTRA_LIST = [["none", "None", 0], ["headphones", "Headphones", 1], ["earrings", "Gold earrings", 1], ["flowerear", "Flower behind ear", 1], ["bowtie", "Bow tie", 1], ["lanyard", "School lanyard", 1],
    ["pearls", "Pearl necklace", 2], ["scarf", "Striped scarf", 2], ["eyepatch", "Eyepatch", 2], ["medal", "Gold medal", 3]];

  /* ------------------------------ tops ---------------------------------- */
  const topShape = (f, extra, x) => `<path d="${BODY}" fill="${f}"/>${extra ? x.body(extra) : ""}`;
  const TOPS = {
    tee: (c, d, l, x) => ({ body: topShape(c, "", x), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="${d}" stroke-width="3"/>` }),
    hoodie: (c, d, l, x) => ({
      back: `<path d="M30 67 C27 76 32 81 39 80 L61 80 C68 81 73 76 70 67 C64 72 36 72 30 67Z" fill="${d}"/>`,
      body: topShape(c, "", x),
      over: `<path d="M36 78 Q50 92 64 78" fill="none" stroke="${d}" stroke-width="3"/><path d="M44.4 88 v7.4 M55.6 88 v7.4" stroke="${l}" stroke-width="2" stroke-linecap="round"/>` + x.body(`<path d="M30 100 V93 Q50 86.4 70 93 V100Z" fill="${d}" opacity=".35"/>`)
    }),
    polo: (c, d) => ({ body: topShape(c, "", { body: s => s }), over: `<path d="M38.5 76.4 L45 86.4 L50 80 L55 86.4 L61.5 76.4 L56 73.6 L50 79 L44 73.6Z" fill="${d}" stroke="${d}" stroke-width=".6" stroke-linejoin="round"/><path d="M50 80 V94" stroke="${d}" stroke-width="1.6"/><circle cx="50" cy="86" r="1" fill="#fff"/><circle cx="50" cy="91" r="1" fill="#fff"/>` }),
    overalls: (c, d, l, x) => ({ body: topShape("#f1f1f6", "", x), over: `<path d="M30 100 V90 L36 90 L38.2 76.4 L44.2 75.8 L40.4 92 H59.6 L55.8 75.8 L61.8 76.4 L64 90 L70 90 V100Z" fill="${c}"/><rect x="42" y="90" width="16" height="10" fill="${d}" opacity=".45"/><circle cx="41.2" cy="79" r="1.6" fill="#f5c542"/><circle cx="58.8" cy="79" r="1.6" fill="#f5c542"/>` }),
    flannel: (c, d, l, x) => ({ body: topShape(c, [79, 87, 95].map(y => `<rect x="10" y="${y}" width="80" height="3.6" fill="${d}" opacity=".6"/>`).join("") + [24, 36, 48, 60, 72].map(xx => `<rect x="${xx}" y="74" width="3.6" height="28" fill="${d}" opacity=".6"/>`).join(""), x), over: `<path d="M38.5 76.4 L45 86.4 L50 80 L55 86.4 L61.5 76.4 L56 73.6 L50 79 L44 73.6Z" fill="${d}"/><path d="M50 80 V100" stroke="${d}" stroke-width="1.4"/>` }),
    jersey: (c, d, l, x) => ({ body: topShape(c, `<path d="M12 100 C12 90 18 84 24 81 L24 100Z M88 100 C88 90 82 84 76 81 L76 100Z" fill="${d}"/>`, x), over: `<path d="M38 76.2 Q50 88 62 76.2" fill="none" stroke="#fff" stroke-width="3"/><text x="50" y="98" font-size="14" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial Black,Arial,sans-serif">29</text>` }),
    varsity: (c, d, l, x) => ({ body: topShape("#f1f1f6", `<path d="M12 100 C12 88 20 82 26 80 L24 100Z M88 100 C88 88 80 82 74 80 L76 100Z" fill="${c}"/>`, x), over: `<path d="M50 84 V100" stroke="${d}" stroke-width="1.4"/>` + x.body(`<path d="M38 75 Q50 86 62 75" fill="none" stroke="${c}" stroke-width="3.6"/>`) + `<circle cx="36" cy="92" r="4.4" fill="${c}"/><text x="36" y="94.4" font-size="6" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">W</text>` }),
    suit: (c, d, l, x) => ({ body: topShape("#2b3350", "", x), over: `<path d="M40 76.2 L50 97 L60 76.2Z" fill="#fff"/><path d="M48.4 79.8 L51.6 79.8 L51 83 L49 83Z M49 83 L47.6 94 L50 97.6 L52.4 94 L51 83Z" fill="#e5484d"/><path d="M37.4 76.6 L40.6 76 L50 97 L48 99.6 L36 80Z M62.6 76.6 L59.4 76 L50 97 L52 99.6 L64 80Z" fill="#3a4470"/>` }),
    lab: (c, d, l, x) => ({ body: topShape("#f4f6fb", `<path d="M12 100 C12 84 28 75 50 75 C72 75 88 84 88 100Z" fill="none" stroke="#dfe3ee" stroke-width="1.4"/>`, x), over: `<path d="M40 76.2 L50 97 L60 76.2Z" fill="#6fb6ff"/><path d="M37.6 76.6 L40.6 76 L49.6 94.6 L44.4 97.4Z M62.4 76.6 L59.4 76 L50.4 94.6 L55.6 97.4Z" fill="#fff" stroke="#dfe3ee" stroke-width="1" stroke-linejoin="round"/><rect x="62" y="88" width="8" height="8" rx="1.4" fill="#fff" stroke="#dfe3ee"/><path d="M64.4 88 v-2.8 M67.4 88 v-3.8" stroke="#3a8dff" stroke-width="1.4" stroke-linecap="round"/>` }),
    puffer: (c, d, l, x) => ({ body: topShape(c, [82, 89, 96].map(y => `<path d="M8 ${y} Q50 ${y - 5} 92 ${y}" stroke="${d}" stroke-width="1.6" fill="none"/>`).join(""), x), over: `<path d="M36.4 76.2 Q50 84 63.6 76.2 L63.6 82.4 Q50 90 36.4 82.4Z" fill="${d}" stroke="${d}" stroke-width=".6" stroke-linejoin="round"/><path d="M50 84.6 V100" stroke="${d}" stroke-width="1.6"/>` }),
    rugby: (c, d, l, x) => ({ body: topShape("#26262e", `<path d="M8 94 H92 M8 98.4 H92" stroke="#fff" stroke-width="1.6" opacity=".7"/>`, x), over: `<path d="M38.5 76.4 L50 86 L61.5 76.4 L56 72.6 L50 78 L44 72.6Z" fill="#fff" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/><path d="M50 86 V94" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` }),
    kiwi: (c, d, l, x) => ({ body: topShape("#2f9a5d", "", x), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="#1f7240" stroke-width="3"/><ellipse cx="46" cy="93.4" rx="8.6" ry="6" fill="#7a5a3a"/><circle cx="55.4" cy="88.4" r="3.6" fill="#7a5a3a"/><path d="M58 89.4 Q63.6 90.6 67 94.4" stroke="#d9b87c" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="55.8" cy="87.6" r="1.1" fill="#fff"/><circle cx="56" cy="87.7" r=".5" fill="#222"/><path d="M43 99 v-2.6 M49 99 v-2.6" stroke="#d9b87c" stroke-width="1.3" stroke-linecap="round"/>` }),
    tiedye: (c, d, l, x) => { const id = x.id("td"); x.defs += `<radialGradient id="${id}" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#ffe14d"/><stop offset=".3" stop-color="#ff6b8a"/><stop offset=".6" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2fb7ff"/></radialGradient>`; return { body: topShape(`url(#${id})`, "", x), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="#6b3fd6" stroke-width="3"/>` }; },
    disco: (c, d, l, x) => {
      const id = x.id("ds"); x.defs += `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d9e6"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#aeb4c8"/></linearGradient>`;
      const dots = []; for (let y = 80; y < 100; y += 5) for (let xx = 18 + ((y / 5) % 2) * 3; xx < 84; xx += 6) dots.push(`<rect x="${xx}" y="${y}" width="3.6" height="3.6" fill="#fff" opacity=".9" stroke="#9aa3b5" stroke-width=".3"/>`);
      return { body: topShape(`url(#${id})`, dots.join(""), x), over: `<path d="M38 76.2 L50 100 L62 76.2Z" fill="#2a2630" opacity=".25"/><path d="M38.4 76.2 Q50 88.6 61.6 76.2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` };
    }
  };
  const TOP_LIST = [["tee", "T-shirt", 0], ["hoodie", "Hoodie", 0], ["polo", "Polo", 1], ["overalls", "Overalls", 1], ["flannel", "Flannel shirt", 1],
    ["jersey", "Team jersey \u201829\u2019", 2], ["varsity", "Varsity jacket", 2], ["suit", "Suit & tie", 2], ["lab", "Lab coat", 2], ["puffer", "Puffer jacket", 2],
    ["rugby", "Rugby top", 2], ["kiwi", "Kiwi tee", 2], ["tiedye", "Tie-dye tee", 3], ["disco", "Disco jacket", 4]];

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
    castle: (ctx) => {
      const g = ctx.id("cs"); ctx.defs += `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232a5c"/><stop offset=".55" stop-color="#6b5fa8"/><stop offset="1" stop-color="#f4b58a"/></linearGradient>`;
      const teeth = (x0, x1, y, w, gap, h, col) => { let s = ""; for (let x = x0; x + w <= x1 + .01; x += w + gap) s += `<rect x="${x.toFixed(1)}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`; return s; };
      const win = (x, y) => `<path d="M${x} ${y + 3.6} V${y + 1.2} Q${x + 1.1} ${y - .6} ${x + 2.2} ${y + 1.2} V${y + 3.6}Z" fill="#ffd98a"/>`;
      return `<rect width="100" height="100" fill="url(#${g})"/>` +
        stars([[14, 9, .7], [34, 5.5, .6], [56, 8, .7], [77, 6, .6], [10, 38, .55], [88, 17, .5]], "#fff6dd") +
        `<circle cx="20" cy="22" r="10" fill="#fff3c9" opacity=".14"/><circle cx="20" cy="22" r="5.8" fill="#fdf3cf"/><circle cx="18.2" cy="20.4" r="1.2" fill="#e8dcae" opacity=".8"/><circle cx="22" cy="24" r=".8" fill="#e8dcae" opacity=".7"/>` +
        `<path d="M0 64 L13 52 L25 61 L40 46 L55 62 L70 50 L84 60 L100 49 V100 H0Z" fill="#5a559b" opacity=".7"/>` +
        `<path d="M44 80 Q70 62 100 66 V100 H44Z" fill="#2b2f60"/>` +
        `<rect x="64" y="58" width="36" height="12" fill="#33377a"/>` + teeth(64, 100, 55.4, 3, 2.6, 2.7, "#33377a") +
        `<rect x="73" y="35" width="11" height="33" fill="#3b4080"/>` + `<rect x="71.6" y="32" width="13.8" height="3.4" fill="#3b4080"/>` + teeth(71.6, 85.4, 29.6, 3.2, 1.9, 2.5, "#3b4080") +
        `<rect x="86" y="42" width="8" height="26" fill="#363b7a"/><path d="M84.6 42.4 L90 29 L95.4 42.4Z" fill="#6a3a78"/><path d="M90 29 V22.4" stroke="#8a8fc0" stroke-width=".9"/><path d="M90 22.4 L85 24 L90 25.6Z" fill="#e5484d"/>` +
        win(77, 41) + win(77, 51) + win(89, 48) + `<path d="M66.4 70 V64.6 Q69 61.8 71.6 64.6 V70Z" fill="#1d2150"/>` +
        `<path d="M0 72 Q20 62 42 76 V100 H0Z" fill="#262a5a"/>` +
        `<path d="M8.5 74 L12.4 62 L16.3 74Z M6.4 79 L12.4 66 L18.4 79Z M21 77 L24 68 L27 77Z" fill="#1b2050"/><path d="M12.4 79 V82 M24 77 V80" stroke="#1b2050" stroke-width="1.6"/>` +
        `<rect y="68" width="100" height="9" fill="#f6d8c4" opacity=".1"/>`;
    },
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
    ["castle", "Castle at dusk", 3], ["lava", "Lava", 3], ["disco", "Disco", 3], ["galaxy", "Galaxy", 4], ["synth", "Synthwave", 4]];

  /* ------------------------------ effects ------------------------------- */
  const FX = {
    none: () => "",
    sparkles: () => [[16, 22, 5], [84, 30, 4], [22, 74, 3.6], [82, 70, 5], [50, 6, 3.4]].map(p => `<path d="M${p[0]} ${p[1] - p[2]} Q${p[0]} ${p[1]} ${p[0] + p[2]} ${p[1]} Q${p[0]} ${p[1]} ${p[0]} ${p[1] + p[2]} Q${p[0]} ${p[1]} ${p[0] - p[2]} ${p[1]} Q${p[0]} ${p[1]} ${p[0]} ${p[1] - p[2]}Z" fill="#fff" stroke="#f5c542" stroke-width=".8"/>`).join(""),
    hearts: () => [[16, 26, 2.6], [84, 22, 3.2], [10, 62, 2], [90, 58, 2.4], [24, 10, 1.8]].map(p => heart(p[0], p[1], p[2], "#ff5d8f")).join(""),
    snowfall: () => stars([[14, 14, 1.8], [30, 6, 1.2], [70, 10, 1.8], [88, 22, 1.4], [10, 40, 1.4], [92, 50, 1.8], [20, 68, 1.4], [80, 80, 1.6], [50, 94, 1.2]]),
    notes: () => [[16, 24], [82, 18], [88, 60], [12, 66]].map(p => `<g fill="#6b3fd6"><circle cx="${p[0]}" cy="${p[1] + 6}" r="2.4"/><rect x="${p[0] + 1.6}" y="${p[1] - 4}" width="1.4" height="10"/><path d="M${p[0] + 3} ${p[1] - 4} q4 1 4 5 q-2 -2 -4 -2Z"/></g>`).join(""),
    bubbles: () => [[14, 20, 5], [84, 14, 3.6], [90, 58, 5.4], [10, 70, 3.4], [28, 90, 2.6]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="#fff" fill-opacity=".25" stroke="#fff" stroke-width="1"/><circle cx="${p[0] - p[2] * .3}" cy="${p[1] - p[2] * .3}" r="${p[2] * .22}" fill="#fff"/>`).join(""),
    confetti: () => [[12, 16, "#ff5d8f", 20], [28, 8, "#ffd23f", -30], [74, 10, "#3a8dff", 40], [88, 26, "#3ecf8e", -10], [8, 48, "#8b5cf6", 60], [92, 62, "#ff5d8f", 10], [20, 80, "#ffd23f", -40], [82, 86, "#3a8dff", 30], [50, 4, "#3ecf8e", 15]].map(p => `<rect x="${p[0]}" y="${p[1]}" width="5" height="2.4" fill="${p[2]}" transform="rotate(${p[3]} ${p[0]} ${p[1]})"/>`).join(""),
    lightning: () => `<path d="M14 10 L6 30 L13 30 L9 46 L22 24 L14 24 L20 10Z" fill="#ffe14d" stroke="#e0a800" stroke-width="1" stroke-linejoin="round"/><path d="M86 52 L79 70 L85 70 L82 84 L93 64 L87 64 L92 52Z" fill="#ffe14d" stroke="#e0a800" stroke-width="1" stroke-linejoin="round"/>`,
    flames: () => `<path d="M0 100 L0 86 Q6 76 10 86 Q14 70 20 84 Q26 64 32 84 Q38 72 42 86 Q50 66 58 86 Q62 72 68 84 Q74 64 80 84 Q86 70 90 86 Q96 76 100 86 L100 100Z" fill="#ff7a1a" opacity=".92"/><path d="M0 100 L0 92 Q8 84 14 92 Q22 80 30 92 Q38 82 46 92 Q54 80 62 92 Q70 82 78 92 Q86 80 94 92 L100 92 L100 100Z" fill="#ffd23f"/>`,
    glow: (ctx) => { const i = ctx.id("gl"); ctx.defs += `<radialGradient id="${i}" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#ffe27a" stop-opacity="0"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".85"/></radialGradient>`; return `<circle cx="50" cy="50" r="50" fill="url(#${i})"/>`; }
  };
  const FX_LIST = [["none", "None", 0], ["sparkles", "Sparkles", 1], ["hearts", "Floating hearts", 1], ["bubbles", "Bubbles", 1], ["snowfall", "Snowfall", 1], ["notes", "Music notes", 2], ["confetti", "Confetti", 2],
    ["lightning", "Lightning", 3], ["glow", "Golden glow", 3], ["flames", "Flames", 4]];

  /* ------------------------------ costumes ------------------------------ */
  const NINJA_WRAP = "M50 19 C63 19 74.4 28 74.4 44 C74.4 56 68 64 60 68 L67 78 Q50 91 33 78 L40 68 C32 64 25.6 56 25.6 44 C25.6 28 37 19 50 19Z";
  const NINJA_WINDOW = "M31 43.2 Q31 37.6 37 37.6 H63 Q69 37.6 69 43.2 V47 Q69 51.4 63 51.4 H37 Q31 51.4 31 47Z";
  const COSTUMES = {
    ninja: (x) => ({
      hide: { hair: 1, hat: 1, top: 1 }, eyesOnTop: 1,
      body: topShape("#2f2f3a", `<path d="M8 90.4 H92" stroke="#e5484d" stroke-width="4.6"/><path d="M50 79 V100" stroke="#23232b" stroke-width="1.4"/>`, x),
      front: `<path fill-rule="evenodd" d="${NINJA_WRAP} ${NINJA_WINDOW}" fill="#23232b"/>` +
        x.clip(NINJA_WRAP, `<path d="M20 31.6 Q50 24 80 31.6 L80 37.2 Q50 29.6 20 37.2Z" fill="#e5484d"/>`) +
        `<path d="M71 31.4 C76.6 29.6 82.4 31.6 84.6 37 C81 35.2 78 35.6 75.6 37.4 C78.6 40.2 79.8 43.8 79.4 47.4 C76.6 43.8 74.4 41.6 71 40.2Z" fill="#e5484d"/>`
    }),
    wizard: (x) => {
      const crown = "M33 31 C34 20 42 11 55 7 C63 4.4 71 7.4 74 15.6 C70 11.8 64.6 12.4 62.4 18 C60.6 23 63.6 27.6 67.6 31 Q50 36 33 31Z";
      const robe = topShape("#37449a", [[24, 91, 2.6], [71, 93, 2.2], [35, 84, 1.8], [78, 85, 1.6], [59, 97, 1.6]].map(p => star5(p[0], p[1], p[2], "#ffd23f")).join(""), x);
      return {
        hide: { hat: 1, top: 1 }, clipHair: 1, body: robe,
        over: `<path d="M40 76.2 Q50 97 60 76.2Z" fill="#e6e0ff"/><path d="M37.6 76.4 Q50 100 62.4 76.4" fill="none" stroke="#f5c542" stroke-width="2.2" stroke-linecap="round"/>` + x.body(`<path d="M12 99 H88" stroke="#f5c542" stroke-width="2.4"/>`) + `<circle cx="50" cy="90.4" r="2.8" fill="#f5c542" stroke="#c9961a" stroke-width=".8"/><circle cx="50" cy="90.4" r="1.2" fill="#e5484d"/>`,
        front: `<ellipse cx="50" cy="30.6" rx="31" ry="6.2" fill="#2b3680"/><ellipse cx="50" cy="29.6" rx="31" ry="5.6" fill="#35429c"/>` +
          `<path d="${crown}" fill="#3b4fd6"/>` +
          x.clip(crown, `<path d="M30 26.4 Q50 33.6 72 26.4 V32 Q50 38 30 32Z" fill="#f5c542"/><path d="M62 9 Q60 18 66.6 28" stroke="#2b3680" stroke-width="2" fill="none" opacity=".5"/>${star5(47, 17.4, 3.4, "#ffd23f")}${star5(56.4, 13, 2, "#fff")}${star5(42.6, 24, 1.8, "#fff")}`) +
          `<rect x="47.4" y="26.8" width="5.2" height="4.8" rx="1" fill="#fff6c9" stroke="#c9961a" stroke-width="1"/><rect x="49" y="28.2" width="2" height="2" fill="#f5c542"/>`
      };
    },
    shark: (x) => ({
      hide: { hair: 1, hat: 1, top: 1 },
      body: topShape("#5f81a8", `<path d="M34 100 Q34 88 50 85.6 Q66 88 66 100Z" fill="#eaf2fa"/>`, x),
      front: `<path d="M38 18 Q43 -1 64 14.4Z" fill="#587aa0"/><path fill-rule="evenodd" d="M19 45 a31 33 0 1 0 62 0 a31 33 0 1 0 -62 0Z M31 44.6 a19 20.6 0 1 0 38 0 a19 20.6 0 1 0 -38 0Z" fill="#6d8fb5"/>` +
        [[38, 28.8], [44, 25.2], [50, 24], [56, 25.2], [62, 28.8]].map(p => `<path d="M${p[0] - 2.6} ${p[1] - 1} L${p[0] + 2.6} ${p[1] - 1} L${p[0]} ${p[1] + 4.8}Z" fill="#fff" stroke="#c9d6e6" stroke-width=".8" stroke-linejoin="round"/>`).join("") +
        `<circle cx="36" cy="19" r="2.8" fill="#fff"/><circle cx="64" cy="19" r="2.8" fill="#fff"/><circle cx="36.3" cy="19.2" r="1.3" fill="${INK}"/><circle cx="63.7" cy="19.2" r="1.3" fill="${INK}"/>`
    }),
    ghost: () => ({
      hide: { hair: 1, hat: 1, top: 1, face: 1, head: 1, extra: 1 }, body: "",
      front: `<path d="M14 100 C10 50 18 10 50 8 C82 10 90 50 86 100 L78 92 L70 100 L62 92 L54 100 L46 92 L38 100 L30 92 L22 100Z" fill="#fafbff" stroke="#d6dbea" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="38" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="62" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="50" cy="58" rx="4" ry="5.4" fill="#1d1d24"/><ellipse cx="29" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/><ellipse cx="71" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/>`
    })
  };
  const COSTUME_LIST = [["none", "No costume", 0], ["ghost", "Friendly ghost", 3], ["ninja", "Ninja", 3], ["shark", "Shark hoodie", 3], ["wizard", "Mage", 4]];

  /* ------------------------------ catalog ------------------------------- */
  const CATS = [
    { id: "gender", label: "Body", list: GENDER_LIST },
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
  const DEFAULT_LOOK = { gender: "neutral", skin: "s3", hair: "short", hairColor: "dkbrown", eyes: "dots", mouth: "smile", face: "none", top: "tee", topColor: "sky", glasses: "none", hat: "none", extra: "none", bg: "sky", fx: "none", costume: "none" };
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
    const ctx = makeCtx();
    const size = opts.size || 100;
    const gd = GENDERS[look.gender] || GENDERS.neutral;
    const T = s => gd.sx === 1 || !s ? s : `<g transform="translate(50 0) scale(${gd.sx} 1) translate(-50 0)">${s}</g>`;
    const co = COSTUMES[look.costume] ? COSTUMES[look.costume](ctx) : null;
    const hide = (co && co.hide) || {};
    const skin = (SKINS.find(s => s.id === look.skin) || SKINS[2]).v;
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
    const browCol = hc.v === "rainbow" ? "#7a4a2a" : shade(hc.v, -.3);

    let s = (BG[look.bg] || BG.sky)(ctx);
    if (co && co.back) s += co.back;
    const hair = !hide.hair && HAIR[look.hair] ? HAIR[look.hair](hcol, hairDark, ctx) : {};
    if (hair.back) s += hair.back;
    const ex = !hide.extra && EXTRA[look.extra] ? EXTRA[look.extra](ctx) : {};
    if (ex.back) s += ex.back;

    // body / outfit (scaled by body type), neck, then the outfit's collar and details
    let top = { body: "", over: "" };
    if (co && co.body !== undefined) top = { body: co.body, over: co.over || "" };
    else if (!hide.top && TOPS[look.top]) top = TOPS[look.top](tc, td, tl, ctx);
    s += T((top.back || "") + (top.body || ""));
    const nw = gd.neck;
    if (!hide.head) s += `<path d="M${50 - nw / 2} 60 h${nw} v17 q${-nw / 2} 8 ${-nw} 0z" fill="${sk2}"/>`;
    s += T(top.over);
    if (!hide.head) {
      const e1 = gd.ear, e2 = 100 - gd.ear;
      s += `<ellipse cx="${e1}" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="${e2}" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="${e1 + .4}" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/><ellipse cx="${e2 - .4}" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/>`;
      s += `<ellipse cx="50" cy="${gd.cy}" rx="${gd.rx}" ry="${gd.ry}" fill="${skin}"/>`;
    }
    const brows = () => {
      const cy = (38.3 - gd.arch).toFixed(1);
      return `<path d="M36 38.8 Q41 ${cy} 45.4 38" stroke="${browCol}" stroke-width="${gd.brow}" fill="none" stroke-linecap="round" opacity=".9"/><path d="M54.6 38 Q59 ${cy} 64 38.8" stroke="${browCol}" stroke-width="${gd.brow}" fill="none" stroke-linecap="round" opacity=".9"/>`;
    };
    const eyesAndBrows = () => (EYES[look.eyes] || EYES.dots)(skin) + brows();
    if (!hide.face) {
      if (FACE[look.face] && look.face !== "mask") s += FACE[look.face](hairDark, ctx);
      if (!co || !co.eyesOnTop) s += eyesAndBrows();
      s += `<ellipse cx="50" cy="50.4" rx="${gd.nx}" ry="${gd.ny}" fill="${sk2}"/>`;
      if (look.face === "mask") s += FACE.mask(hairDark, ctx);
      else s += (MOUTH[look.mouth] || MOUTH.smile)();
    }
    if (hair.front) s += ((!hide.hat && HAT_COVER.has(look.hat)) || (co && co.clipHair)) ? ctx.clip("M0 31 H100 V100 H0Z", hair.front) : hair.front;
    if (!hide.hat && HATS[look.hat]) s += HATS[look.hat](ctx);
    if (!hide.face && GLASS[look.glasses] && !(co && co.eyesOnTop)) s += GLASS[look.glasses](ctx);
    if (ex.over) s += ex.over;
    if (ex.front) s += ex.front;
    if (co && co.front) s += co.front;
    if (co && co.eyesOnTop) { s += eyesAndBrows(); if (GLASS[look.glasses]) s += GLASS[look.glasses](ctx); }
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
  const COMET = `<svg class="av-comet" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 8.4 C10.4 8.2 5 12.2 1.4 22.6 C7.6 19.4 13 16.6 17.8 12.6Z" fill="#7fb0ff" opacity=".75"/><path d="M15.8 9.4 C11.2 9.8 7 13 3.8 20 C8.4 17.4 12.4 15 16.4 12Z" fill="#a9c9ff" opacity=".85"/><path d="M15.4 10.2 C12 11 8.8 13.4 6.6 17.2 C9.6 15.6 12.4 14 15.6 11.8Z" fill="#e6f0ff"/><circle cx="16.8" cy="8" r="5.2" fill="#ffc93c" stroke="#d99a00" stroke-width="1.2"/><circle cx="15.2" cy="6.4" r="1.9" fill="#fff6c8"/><path d="M6 3 L6.7 4.8 L8.5 5.5 L6.7 6.2 L6 8 L5.3 6.2 L3.5 5.5 L5.3 4.8Z" fill="#ffe27a"/><path d="M20.4 16.6 L20.9 17.8 L22.1 18.3 L20.9 18.8 L20.4 20 L19.9 18.8 L18.7 18.3 L19.9 17.8Z" fill="#cfe0ff"/></svg>`;
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
.av-tile .av-r{position:absolute;top:4px;left:4px;width:11px;height:11px;border-radius:50%;border:1.5px solid #fff;box-sizing:border-box;}
.av-rguide{width:100%;text-align:left;border:1.5px solid var(--line,#e3e7f0);border-radius:12px;padding:8px 10px;font-size:.8rem;}
.av-rg-title{font-weight:900;margin-bottom:4px;}
.av-rg{display:flex;align-items:center;gap:8px;padding:3px 0;}
.av-rg-dot{position:static !important;display:inline-block;width:12px !important;height:12px !important;border-radius:50%;flex-shrink:0;border:0 !important;}
.av-rg-name{flex:1;min-width:0;line-height:1.15;}
.av-rg-name b{display:block;}
.av-rg-name small{display:block;color:var(--muted,#6b7390);font-size:.72rem;}
.av-rg-price{font-weight:800;white-space:nowrap;}
.av-rg-note{color:var(--muted,#6b7390);font-size:.72rem;margin-top:4px;}
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
.av-t-wrap input[type="radio"],.av-t-wrap input[type="checkbox"],.av-left input[type="checkbox"]{width:18px;height:18px;min-height:auto;padding:0;margin:0;flex-shrink:0;accent-color:var(--navy-900);outline-offset:2px;}
.av-t-cur label{background:var(--card,#fff);color:inherit;line-height:1.2;transition:border-color .15s,box-shadow .15s;}
.av-t-cur label:hover{border-color:var(--navy-500,#4a5a85);}
.av-t-cur label:has(input:checked){border-color:var(--navy-900,#1f2b44);box-shadow:0 0 0 1.5px var(--navy-900,#1f2b44) inset;}
.av-t-cur .av-comet{width:18px;height:18px;margin:0;flex-shrink:0;}
.av-t-wrap label{margin:0;}
html.dark-mode .av-t-wrap input[type="radio"],html.dark-mode .av-t-wrap input[type="checkbox"],html.dark-mode .av-left input[type="checkbox"]{accent-color:var(--gold);}
html.dark-mode .av-t-cur label:has(input:checked){border-color:var(--gold);box-shadow:0 0 0 1.5px var(--gold) inset;}
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
      on: !!av.on, cat: "gender", busy: false
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
    }).map((it, i) => ({ it, i, p: it[2] === 0 || ED.owned.has(cat + ":" + it[0]) ? (it[2] === 0 ? -1 : 0) : priceOf(ED.shop, cat, it[0], it[2]) }))
      .sort((a, b) => a.p - b.p || a.it[2] - b.it[2] || a.i - b.i).map(x => x.it);
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
    $("avGuide").innerHTML = rarityGuide(E.shop, "student");
    $("avHint").textContent = cat === "gender" ? "Pick the body type for your avatar. It makes small changes to face shape and features. Your teacher can also change it." : hide ? "Your costume is covering this, so changes here won't show until you take the costume off." : E.shop.currency === "free" ? "Everything is free in this class. Have fun!" : "";
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

  async function setGender(username, g) {
    if (!["neutral", "boy", "girl"].includes(g)) return { ok: false, error: "Unknown body type." };
    try {
      await usersCol().doc(username).update({ "avatar.look.gender": g });
      return { ok: true };
    } catch (e) { return { ok: false, error: "Couldn't save the body type. Please try again." }; }
  }

  window.avatarBadge = badge;
  window.T29Avatar = { badge, openEditor, renderSvg, shopOf, setGender };
  document.addEventListener("DOMContentLoaded", () => { boot().catch(() => {}); });
})();
