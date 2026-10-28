/* ===================== The 29 World — Avatars =====================
   Students are shown as their initials by default. Clicking their own
   round avatar opens the editor, where they can build a character out of
   body type, skin, hair, eyes, eyebrows, mouth, outfits, hats, glasses, extras, pets,
   backgrounds, effects and costumes. Everything is drawn as inline SVG
   (no image files).

   Teachers choose, per class, how items are paid for: 29 World money,
   free, or Comets (a separate currency only teachers can hand out) — plus
   per-item prices, and hiding items they don't want in their class.

   Stored on the student's /users doc:
     avatar: { on: bool, look: {... gender: "boy"|"girl"|"neutral" ...},
               owned: ["hair:curly", ...] }
     comets: number            (only a teacher can raise it)
     cometLog: [{ at, amount, note }]   (last 20, written by the teacher)
   and on the class doc:
     avatarShop: { currency: "free"|"money"|"comets",
                   tiers: { money:{1..4}, comets:{1..4} },
                   prices: { money:{ "hat:crown": 30 }, comets:{} },
                   hidden: ["hat:crown"] }

   Epic (tier 3) and Legendary (tier 4) items get animated sheens, sparkles and glows.
   renderSvg(look, { size, label, animate }): they only move when animate is true, or when
   size >= 100 and animate isn't false; small badges and shop tiles stay still. Pure CSS
   keyframes inside the SVG, switched off by prefers-reduced-motion.

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
      defs: "", css: "", hat: false, anim: false, _h: null, _b: null,
      id: n => "av" + (++UID) + n,
      // d may be one path, or a list of paths / raw clip children (e.g. "<ellipse .../>") that are unioned
      clip(d, inner) { const i = c.id("k"); c.defs += `<clipPath id="${i}">${[].concat(d).map(p => p.charAt(0) === "<" ? p : `<path d="${p}"/>`).join("")}</clipPath>`; return `<g clip-path="url(#${i})">${inner}</g>`; },
      mask(m, inner) { const i = c.id("m"); c.defs += `<mask id="${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">${m}</mask>`; return `<g mask="url(#${i})">${inner}</g>`; },
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
    { id: "red", name: "Cherry red", v: "#d62839", r: 1 },
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

  /* ------------------------------ hair --------------------------------- */
  const CAP = "M29 47 C26 22 38 14 50 14 C62 14 74 22 71 47 C70 38 66 31 58 29 C52 34 40 32 34 36 C31 39 30 43 29 47Z";
  const shine = (ctx, d) => ctx.clip(d, `<path d="M33 28 C39 18 58 15.5 67 24" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  const hairLines = (x, shape, d, paths, opacity = .3) => x.clip(shape, `<path d="${paths}" fill="none" stroke="${d}" stroke-width=".65" opacity="${opacity}" stroke-linecap="round"/>`);
  const curlHair = (c,d,x) => {const p="M29 43 C23 37 25 28 30 25 C28 16 39 12 44 15 C49 9 59 11 62 16 C73 13 79 24 73 30 C79 35 75 41 71 44 L66 34 Q50 28 34 35Z";let detail="";for(let row=0;row<4;row++)for(let i=0;i<7;i++){const xx=25+i*7+(row%2)*3, yy=15+row*7;detail+=`M${xx} ${yy} q-2 -3 -4 0 q-1 3 2 3 q3 0 2 -2 `;}return {front:`<path d="${p}" fill="${c}"/>${hairLines(x,p,d,detail,.5)}${x.clip(p,`<path d="M31 20 Q45 10 62 17" stroke="#fff" stroke-opacity=".12" stroke-width="2" fill="none"/>`)}`};};
  /* ---- flowing locks: a ribbon of hair that follows a wavy centre line ---- */
  const r1 = v => +v.toFixed(1);
  const hexOr = (c, p, alt) => /^#/.test(c) ? shade(c, p) : alt;
  // smooth open curve through points (Catmull-Rom as cubic Beziers); returns the segments after the first point
  const smoothC = pts => { let s = ""; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i - 1] || pts[i], b = pts[i], e = pts[i + 1], f = pts[i + 2] || e; s += `C${r1(b[0] + (e[0] - a[0]) / 6)} ${r1(b[1] + (e[1] - a[1]) / 6)} ${r1(e[0] - (f[0] - b[0]) / 6)} ${r1(e[1] - (f[1] - b[1]) / 6)} ${r1(e[0])} ${r1(e[1])}`; } return s; };
  // o: x, y0, y1, dx (drift), amp/fr/ph (wave), w (10 widths top to tip), tip (tip lean)
  const lockD = o => {
    const N = o.w.length - 1, L = [], R = [], M = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = o.y0 + (o.y1 - o.y0) * t, cx = o.x + o.dx * t + o.amp * Math.sin(6.2832 * o.fr * t + o.ph) * Math.min(1, t * 2.5), h = o.w[i] / 2;
      L.push([cx - h, y]); R.push([cx + h, y]); M.push([cx, y, h]);
    }
    const tip = [M[N][0] + o.tip, o.y1 + 3];
    const d = `M${r1(L[0][0])} ${r1(L[0][1])}${smoothC(L)}Q${r1(tip[0])} ${r1(tip[1])} ${r1(R[N][0])} ${r1(R[N][1])}${smoothC(R.slice().reverse())}Z`;
    const ln = [-.24, .2].map(k => { const P = M.slice(1, N).map(m => [m[0] + k * m[2] * 2, m[1]]); return `M${r1(P[0][0])} ${r1(P[0][1])}${smoothC(P)}`; }).join(" ");
    return { d, ln };
  };
  const lockPaint = (x, o, c, d, op) => { const l = lockD(o); return `<path d="${l.d}" fill="${c}"/>${x.clip(l.d, `<path d="${l.ln}" fill="none" stroke="${d}" stroke-width=".7" stroke-linecap="round" opacity="${op || .4}"/>`)}`; };
  // A gust of wind: the hair leans, flutters back and settles, then rests for a while. Transform-only CSS
  // (pivoting at the head), still when not animated, and switched off for prefers-reduced-motion.
  const swish = (x, inner, a, dur, delay, py) => {
    if (!x.anim) return inner;
    const n = x.id("w"), f = k => `skewX(${r1(a * k)}deg)`;
    x.css += `@keyframes ${n}{0%,46%{transform:${f(0)}}54%{transform:${f(1)}}61%{transform:${f(.52)}}68%{transform:${f(.86)}}76%{transform:${f(-.3)}}85%{transform:${f(.1)}}93%,100%{transform:${f(0)}}}.${n}{animation:${n} ${dur}s ease-in-out ${delay}s infinite}`;
    return `<g transform="translate(50 ${py})"><g class="${n} t29sw"><g transform="translate(-50 -${py})">${inner}</g></g></g>`;
  };
  const HAIR = {
    bald: () => ({}),
    buzz: c => ({ front: `<path d="M30 40 C29 24 40 19 50 19 C60 19 71 24 70 40 C66 31 58 27 50 27 C42 27 34 31 30 40Z" fill="${c}"/>` }),
    short: (c,d,x) => ({front:`<path d="${CAP}" fill="${c}"/>${shine(x,CAP)}${hairLines(x,CAP,d,"M36 30 Q39 25 44 24 M47 26 Q52 23 57 24 M60 27 Q64 28 66 31",.2)}`}),
    long: (c, d, x) => { if (x.hat) return { back: `<path d="M31 30 C21 48 23 84 36 94 L64 94 C77 84 79 48 69 30Z" fill="${c}"/>`, front: lockPaint(x, { x: 31, y0: 29, y1: 82, dx: -4.6, amp: .6, fr: 1, ph: 0, w: [2.5, 6.5, 8.5, 8.5, 8, 7.5, 7, 6.2, 5, 3.6], tip: 0 }, c, d, .3) + lockPaint(x, { x: 69, y0: 29, y1: 82, dx: 4.6, amp: .6, fr: 1, ph: 3.14, w: [2.5, 6.5, 8.5, 8.5, 8, 7.5, 7, 6.2, 5, 3.6], tip: 0 }, c, d, .3) }; return { back: `<path d="M26 46 C21 72 26 90 36 94 L64 94 C74 90 79 72 74 46Z" fill="${c}"/>`, front: `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}` }; },
    bob: (c, d, x) => { const p = "M28 47 C26 22 38 14 50 14 C62 14 74 22 72 47 C70 37 62 32 50 32 C38 32 30 37 28 47Z"; if (x.hat) return { back: `<path d="M31 30 C21 46 23 68 36 75 L64 75 C77 68 79 46 69 30Z" fill="${c}"/>`, front: lockPaint(x, { x: 31, y0: 29, y1: 66, dx: -3.6, amp: .5, fr: 1, ph: 0, w: [2.5, 7, 9.5, 9.5, 9.5, 9, 8.4, 7.4, 6, 4.4], tip: 0 }, c, d, .3) + lockPaint(x, { x: 69, y0: 29, y1: 66, dx: 3.6, amp: .5, fr: 1, ph: 3.14, w: [2.5, 7, 9.5, 9.5, 9.5, 9, 8.4, 7.4, 6, 4.4], tip: 0 }, c, d, .3) }; return { back: `<path d="M25 44 C21 62 25 73 36 75 L64 75 C75 73 79 62 75 44Z" fill="${c}"/>`, front: `<path d="${p}" fill="${c}"/>${shine(x, p)}` }; },
    ponytail: (c, d, x) => ({
      back: `<path d="M68 27 C80 24 91 36 88 53 C86 63 80 70 77 77 C75 67 78 59 76 51 C74 45 70 42 67 40Z" fill="${c}"/>`,
      front: (x.hat ? "" : `<path d="${CAP}" fill="${c}"/>${shine(x, CAP)}`) + `<ellipse cx="70.4" cy="32" rx="2.6" ry="3.4" fill="#ff5d8f" transform="rotate(-14 70.4 32)"/>`
    }),
    swoop: (c,d,x) => { const p="M29 46 C24 25 34 13 51 13 C67 12 76 24 71 45 L67 34 C57 31 45 43 34 36Z"; return {front:`<path d="${p}" fill="${c}"/>${hairLines(x,p,d,"M32 31 C44 35 55 18 67 24 M34 27 C45 29 52 16 62 18 M37 35 Q51 36 64 28",.48)}${shine(x,p)}`}; },
    wavy: (c, d, x) => {
      // long, wavy hair that drapes over the shoulders and swishes now and then (no gloss)
      const hat = !!x.hat, top = hat ? 29 : 34, py = hat ? 33 : 36, sh = hexOr(c, -.12, c);
      const back = `<path d="M31 ${top} C21 ${top + 16} 19 56 22 66 C24 74 20 80 25 87 C30 93 38 91 42 87 L58 87 C62 91 70 93 75 87 C80 80 76 74 78 66 C81 56 79 ${top + 16} 69 ${top}Z" fill="${sh}"/>`;
      const W = [2.6, 7, 9, 9, 8.4, 7.6, 6.6, 5.6, 4.4, 3];
      const Ld = { x: 31, y0: top, y1: 90, dx: -5.6, amp: 2.6, fr: 1.5, ph: 0, w: W, tip: -1.2 };
      const Rd = { x: 69, y0: top, y1: 90, dx: 5.6, amp: 2.6, fr: 1.5, ph: 3.9, w: W, tip: 1.2 };
      const locks = swish(x, lockPaint(x, Ld, c, d, .42), 6.4, 10, -3, py) + swish(x, lockPaint(x, Rd, c, d, .42), 7.4, 10, -2.94, py);
      return { back: swish(x, back, 3.4, 10, -2.88, py), front: locks + (hat ? "" : `<path d="${CAP}" fill="${c}"/>${hairLines(x, CAP, d, "M36 30 Q39 25 44 24 M47 26 Q52 23 57 24 M60 27 Q64 28 66 31", .2)}`) };
    },
    braids: (c,d,x) => { const hat=!!x.hat, p="M29 46 C26 24 37 15 50 15 C63 15 74 24 71 46 L66 34 Q56 29 50 26 Q44 29 34 34Z";let tails="";[30,70].forEach((xx,j)=>{let seg="";for(let i=hat?-2:0;i<8;i++){const y=48+i*4.5, w=3.4-i*.18;seg+=`<path d="M${xx} ${y-2} Q${xx-w*1.8} ${y} ${xx} ${y+3} Q${xx+w*1.8} ${y} ${xx} ${y-2}Z" fill="${i%2?c:shade(c,-.07)}" stroke="${d}" stroke-width=".45"/>`;}tails+=seg+`<rect x="${xx-2.4}" y="82" width="4.8" height="2.3" rx="1" fill="#526ca8"/><path d="M${xx-1.6} 84 L${xx-2} 88 Q${xx} 90 ${xx+2} 88 L${xx+1.6} 84Z" fill="${c}"/>`;});return {front:(hat?"":`<path d="${p}" fill="${c}"/>${hairLines(x,p,d,"M50 16 V26 M47 18 Q37 22 32 32 M53 18 Q63 22 68 32 M46 23 Q39 27 34 35 M54 23 Q61 27 66 35",.5)}`)+tails};},
    curly: (c,d,x)=>curlHair(c,d,x),
    spiky: c => ({ front: `<path d="M28 44 L25 21 L36 28 L37 9 L46 24 L52 5 L58 24 L66 9 L66 28 L75 21 L72 44 C68 34 60 30 50 30 C40 30 32 34 28 44Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>` }),
    mohawk: (c, d) => ({ front: `<path d="M30.4 40 C29.4 27 40 22 50 22 C60 22 70.6 27 69.6 40 C66 33 58 29 50 29 C42 29 34 33 30.4 40Z" fill="${d}" opacity=".55"/><path d="M40.6 32 C38 22 39.4 13 43 7.4 C45 11.4 46.6 12.6 50 3 C53.4 12.6 55 11.4 57 7.4 C60.6 13 62 22 59.4 32 C54 28.6 46 28.6 40.6 32Z" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>` }),
    sidepart: (c, d, x) => { const p = "M29 47 C24 24 37 11.5 51 12 C68 12.5 75.5 26 71 47 C69.5 39 66.5 33 60.5 30 C55 28 49 31 43 29 C37 28.5 31 37 29 47Z"; return { front: `<path d="${p}" fill="${c}"/>${x.clip(p, `<path d="M43.5 29 C41 22 40.5 17 41.5 12.5" stroke="#fff" stroke-opacity=".38" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M42.5 29 C40.5 22 40 17 41 12.5" stroke="${d}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".8"/><path d="M44 15.5 C55 13.5 67 19 70.5 31 M44.5 21 C54 19 63 24 67.5 34 M45.5 26 C52 24.5 58 27 61 33" stroke="${d}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".4"/><path d="M48 14.5 C56 13 64 15.5 68.5 21" stroke="#fff" stroke-opacity=".24" stroke-width="2.4" fill="none" stroke-linecap="round"/>`)}` }; },
    slickback: (c, d, x) => { const p = "M29.5 46 C25 22 38 13.5 50 13.5 C62 13.5 75 22 70.5 46 C69.5 38 67 32 62.5 28.5 C58.5 26 55 26 50 29.5 C45 26 41.5 26 37.5 28.5 C33 32 30.5 38 29.5 46Z"; return { front: `<path d="${p}" fill="${c}"/>${x.clip(p, `<path d="M36 28 C33.5 22 35 17.5 40 14.5 M42 27 C40 21 41.5 17 46 14 M50 29 C50 22 50 17.5 50 13.5 M58 27 C60 21 58.5 17 54 14 M64 28 C66.5 22 65 17.5 60 14.5" stroke="${d}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".55"/><path d="M35 21 C41 14.5 59 14.5 65 21" stroke="#fff" stroke-opacity=".28" stroke-width="2.2" fill="none" stroke-linecap="round"/>`)}` }; },
    pompadour: (c, d, x) => {
      // a swept-up quiff: tapered sides, a soft hairline and tonal strands (no gloss, so dark hair never reads as a helmet)
      const p = "M30 39 C27.5 32 28 26 31.5 22 C30 13 39 6.5 52 6.5 C64 6.5 73.5 12 71 22 C73 27 72.5 33 70 39 C68.6 35.6 67.4 32.6 65 30.6 C62 28.4 58.5 28.6 55 30 C52 33 46 34.6 41.5 31.4 C37.5 30 34.6 33.6 33 37 C32 38.6 31 39 30 39Z";
      const lt = hexOr(c, .3, "#fff");
      return { front: `<path d="${p}" fill="${c}"/>${x.clip(p, `<path d="M26 46 V28 Q31.5 28 34.5 37 L35 46Z M74 46 V28 Q68.5 28 65.5 37 L65 46Z" fill="${d}" opacity=".55"/><path d="M33 30 C33 17 44 9 58 10.5 C66 11.5 70 15 70.5 20" fill="none" stroke="${d}" stroke-width="1.3" stroke-linecap="round" opacity=".55"/><path d="M38 30 C38 21 46 14 56 14.5 M44 31 C43 24 49 18 59 18.5 M52 30.5 C52 25 57 21 64 21.5" fill="none" stroke="${lt}" stroke-width=".8" stroke-linecap="round" opacity=".5"/><path d="M40 27 C37 21 38 14 43 10.5 M33 27 C31 22 32 17 35 14 M62 28.4 C66 25 68.5 21 69.5 17" fill="none" stroke="${d}" stroke-width=".7" stroke-linecap="round" opacity=".5"/>`)}` };
    },
    undercut: (c, d, x) => {
      // swept-back top with shaved sides: stubble hugs the skull and fades out towards the ears
      const top = "M33.5 37 C30.5 25 35 13.5 50 11.5 C65 10.5 71 20 68.5 37 C65.5 30 59 28 54.5 29.5 C49 31.5 42 29.6 37.5 32.4 C35.6 33.8 34.4 35.4 33.5 37Z";
      const sides = "M29.2 47 C26.2 25 36 17.5 50 17.5 C64 17.5 73.8 25 70.8 47 C69.6 41 68 37.5 65.5 34.5 C62 29 56 28 50 28 C44 28 38 29 34.5 34.5 C32 37.5 30.4 41 29.2 47Z";
      const g = x.id("g");
      x.defs += `<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="47"><stop offset="0" stop-color="${d}"/><stop offset=".6" stop-color="${d}"/><stop offset="1" stop-color="${d}" stop-opacity=".1"/></linearGradient>`;
      let dots = "";
      [[30.8, 41], [32.6, 38.4], [31.4, 35.4], [33.8, 33], [30.2, 44.2], [32.2, 42.2], [34.2, 36.6], [33, 30.8], [35.6, 33.8], [31.6, 31.2], [29.8, 38], [34.8, 31]].forEach(([px, py]) => { dots += `<circle cx="${px}" cy="${py}" r=".38"/><circle cx="${100 - px}" cy="${py}" r=".38"/>`; });
      const lines = "M39 31 C40 23 44 15.5 50 11.5 M45.5 30 C46 22 50 15.5 57 12 M52.5 29 C54 22 58.5 17 64 14.5 M58 28.5 C61 23.5 64 20.5 66.5 19.5";
      return {
        front: `<path d="${sides}" fill="url(#${g})"/>`
          + x.clip(sides, `<path d="${top}" transform="translate(0 1.3)" fill="#000" opacity=".16"/><g fill="${d}" opacity=".55">${dots}</g>`)
          + `<path d="${top}" fill="${c}"/>${hairLines(x, top, d, lines, .45)}${x.clip(top, `<path d="M36 24 C41 13 56 10.5 65 16" stroke="#fff" stroke-opacity=".22" stroke-width="2.2" fill="none" stroke-linecap="round"/>`)}`
      };
    },
    manbun: (c, d, x) => { const p = "M29.5 47 C26.5 24 38 16 50 16 C62 16 73.5 24 70.5 47 C69.5 39 66 32 59 29.5 C53 28 47 29.5 41 29 C36 30 31 38 29.5 47Z"; return { front: `<circle cx="50" cy="9.5" r="8.5" fill="${c}"/><path d="M44 5 C47 9 47 12 45 15 M50 2.5 C52 7 52 11 50 15.5 M56 5 C53 9 53 12 55 15" stroke="${d}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".5"/><path d="${p}" fill="${c}"/>${shine(x, p)}<ellipse cx="50" cy="16.6" rx="7.2" ry="2.1" fill="${d}"/>` }; },
  };
  const HAIR_LIST = [["bald", "Bald", 0], ["buzz", "Buzz cut", 0], ["short", "Short", 0], ["long", "Long", 0], ["bob", "Bob", 1], ["ponytail", "Ponytail", 3], ["swoop", "Side swoop", 2], ["sidepart", "Side part", 1], ["slickback", "Slick back", 1], ["wavy", "Wavy long", 4], ["braids", "Braids", 2], ["curly", "Curly", 2], ["spiky", "Spiky", 3], ["pompadour", "Pompadour", 2], ["undercut", "Undercut", 2], ["manbun", "Man bun", 2], ["mohawk", "Mohawk", 4]];

  /* ------------------------------ eyes --------------------------------- */
  const EYE_Y = 45;
  const both = fn => [41, 59].map((x, i) => fn(x, i)).join("");
  const EYES = {
    dots: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="2.8" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .9}" r=".8" fill="#fff"/>`),
    round: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="4.6" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .3}" r="2.5" fill="${INK}"/><circle cx="${x + .9}" cy="${EYE_Y - .6}" r=".8" fill="#fff"/>`),
    happy: () => both(x => `<path d="M${x - 4.2} ${EYE_Y + 1.6} Q${x} ${EYE_Y - 5} ${x + 4.2} ${EYE_Y + 1.6}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`),
    sleepy: () => both(x => `<path d="M${x - 4} ${EYE_Y} Q${x} ${EYE_Y + 3.8} ${x + 4} ${EYE_Y}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`),
    sparkle: () => both(x => `<circle cx="${x}" cy="${EYE_Y}" r="5.2" fill="#fff" stroke="${INK}" stroke-width=".8"/><circle cx="${x}" cy="${EYE_Y + .4}" r="3.4" fill="#3b2f66"/><circle cx="${x}" cy="${EYE_Y + .4}" r="1.9" fill="${INK}"/><circle cx="${x + 1.4}" cy="${EYE_Y - 1.2}" r="1.1" fill="#fff"/><circle cx="${x - 1.2}" cy="${EYE_Y + 1.6}" r=".6" fill="#fff"/>`),
    wink: sk => `<circle cx="41" cy="${EYE_Y}" r="3" fill="${INK}"/><circle cx="42" cy="${EYE_Y - 1}" r="1" fill="#fff"/><circle cx="40.2" cy="${EYE_Y + 1.1}" r=".5" fill="#fff" opacity=".8"/>`
      // closed eye: a bold "<" wink
      + `<path d="M62.4 ${EYE_Y - 3.4} L56.4 ${EYE_Y} L62.4 ${EYE_Y + 3.4}" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    // half-open, just-woken eyes: only the lower part of the eye shows under a heavy lid
    sleepywake: sk => both(x => {
      const cy = EYE_Y + 1.2, y0 = cy - 1, w = 2.83;
      return `<path d="M${x - w} ${y0} A3 3 0 1 0 ${x + w} ${y0}Z" fill="${INK}"/>`
        + `<circle cx="${x + .9}" cy="${cy + 1}" r=".75" fill="#fff"/>`
        + `<path d="M${x - 3.9} ${y0} H${x + 3.9}" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`
        + `<path d="M${x - 3.2} ${y0 - 2.1} Q${x} ${y0 - 3.1} ${x + 3.2} ${y0 - 2.1}" stroke="${shade(sk, -.25)}" stroke-width=".8" fill="none" stroke-linecap="round"/>`
        + `<path d="M${x - 2.6} ${y0 + 5.2} Q${x} ${y0 + 6.4} ${x + 2.6} ${y0 + 5.2}" stroke="${shade(sk, -.2)}" stroke-width=".7" fill="none" stroke-linecap="round"/>`;
    }),
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
  const EYE_LIST = [["dots", "Dots", 0], ["round", "Round", 0], ["happy", "Happy", 0], ["sleepy", "Sleepy", 0], ["sleepywake", "Sleepy-wake", 1], ["sparkle", "Sparkly", 1], ["wink", "Wink", 2],
    ["lashes", "Lashes", 1], ["cool", "Cool", 1], ["dizzy", "Dizzy", 2], ["stars", "Star eyes", 3], ["hearts", "Heart eyes", 3], ["dollar", "Money eyes", 3]];

  /* ------------------------------ mouths -------------------------------- */
  const MOUTH = {
    smile: () => `<path d="M43.5 55 Q50 62 56.5 55" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    grin: () => `<path d="M42 54 Q50 56 58 54 Q56 62 50 62 Q44 62 42 54Z" fill="#fffaf3" stroke="${INK}" stroke-width="1.25" stroke-linejoin="round"/><path d="M44 58 Q50 60 56 58" fill="none" stroke="#b7a8a4" stroke-width=".5"/>`,
    neutral: () => `<path d="M45 57 H55" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
    open: () => `<path d="M43.5 54 Q50 68 56.5 54Z" fill="#6e2233" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M46.4 61.2 Q50 57.8 53.6 61.2 Q50 64.4 46.4 61.2Z" fill="#ff7b8e"/>`,
    smirk: () => `<path d="M45 57.4 Q51 59.6 57.4 53.8" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    tongue: () => `<path d="M43 54.5 Q50 58 57 54.5 Q56 61 50 61 Q44 61 43 54.5Z" fill="#592735" stroke="${INK}" stroke-width="1.2"/><path d="M48 58.5 Q51 57.6 54 58.5 V61.7 C54 66.3 48 66.3 48 61.7Z" fill="#f47e98" stroke="#ae4563" stroke-width=".65"/><path d="M51 59.4 V62.5" stroke="#c75675" stroke-width=".55" stroke-linecap="round"/>`,
    surprised: () => `<ellipse cx="50" cy="58" rx="3.2" ry="4" fill="#5a1f30" stroke="${INK}" stroke-width="1.4"/>`,
    kiss: () => heart(50, 57.6, 3.1, "#e8505b"),
    braces: () => MOUTH.grin()+`<path d="M44 56.7 Q50 58.8 56 56.7" stroke="#73849a" stroke-width=".65" fill="none"/>`+[45.2,48.4,51.6,54.8].map(xx=>`<rect x="${xx-.6}" y="${57.1-Math.abs(xx-50)*.12}" width="1.2" height="1.5" rx=".25" fill="#c5d6e9" stroke="#65788d" stroke-width=".3"/>`).join(""),
  };
  const MOUTH_LIST = [["smile", "Smile", 0], ["grin", "Big grin", 0], ["neutral", "Neutral", 0], ["open", "Open smile", 0], ["smirk", "Smirk", 3], ["tongue", "Tongue out", 4], ["surprised", "Surprised", 1], ["braces", "Braces", 2], ["kiss", "Kiss", 2]];

  /* ------------------------------ face extras --------------------------- */
  const FACE = {
    none: () => "",
    freckles: () => ["35,52", "38.5,54.4", "41.5,51.6", "58.5,51.6", "61.5,54.4", "65,52"].map(s => { const [x, y] = s.split(","); return `<circle cx="${x}" cy="${y}" r=".95" fill="#a8613a" opacity=".85"/>`; }).join(""),
    blush: () => `<ellipse cx="37" cy="53" rx="4.4" ry="2.7" fill="#ff7b9c" opacity=".5"/><ellipse cx="63" cy="53" rx="4.4" ry="2.7" fill="#ff7b9c" opacity=".5"/>`,
    mustache: h=>`<path d="M50 53 Q46 49.8 43 53 Q41 55 39.5 53 Q40 58 45 56 Q48 56 50 54.5 Q52 56 55 56 Q60 58 60.5 53 Q59 55 57 53 Q54 49.8 50 53Z" fill="${h}"/><path d="M44 53.4 Q46 52 48 53.5 M52 53.5 Q54 52 56 53.4" stroke="${shade(h,.2)}" stroke-width=".4" fill="none"/>`,
    goatee: h=>`<path d="M45 61 Q50 63 55 61 Q55 66 50 67 Q45 66 45 61Z" fill="${h}"/><path d="M47 62.5 L48 65 M50 63 V66 M53 62.5 L52 65" stroke="${shade(h,.2)}" stroke-width=".4" opacity=".6"/>`,
    beard: h => `<path fill-rule="evenodd" d="M30.8 49 C31 58 36 70 50 70 C64 70 69 58 69.2 49 C66 53.4 62.5 54 58.5 53.2 C55.4 52 52.8 52.4 50 53.2 C47.2 52.4 44.6 52 41.5 53.2 C37.5 54 34 53.4 30.8 49Z M42 55.2 Q50 51.8 58 55.2 Q57.6 63.6 50 64.2 Q42.4 63.6 42 55.2Z" fill="${h}"/>`,
    stripes: (h,x,col)=>x.head(`<path d="M31 50 L39 52 M31 54.5 L38.5 56 M69 50 L61 52 M69 54.5 L61.5 56" stroke="${col || '#3a8dff'}" stroke-width="2.5" stroke-linecap="round"/>`),
    paintstars: () => star5(36.6, 53, 3.6, "#ff5d8f") + star5(63.4, 53, 3.6, "#3a8dff"),
    glitter: () => ["35,50,1.2", "38,55,.9", "63,50,1.2", "61,55,.9", "50,37,1", "46,38.4,.8"].map(s => { const [x, y, r] = s.split(","); return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff6a8" stroke="#f5b82e" stroke-width=".4"/>`; }).join(""),
    scar: () => `<path d="M35.4 48.6 L40 58.4" stroke="#c4523f" stroke-width="1.5" stroke-linecap="round"/><path d="M35.2 52.3 l3.3 -1.5 M36.6 55.3 l3.3 -1.5 M37.6 57.6 l3 -1.4" stroke="#8f3322" stroke-width=".9" stroke-linecap="round"/>`,
    mask: (h,x)=>x.head(`<path d="M29 51 Q50 47 71 51 L66 62 Q50 70 34 62Z" fill="#438fd0" stroke="#28659b" stroke-width=".8"/><path d="M36 54 Q50 57 64 54 M36 58 Q50 61 64 58 M39 62 Q50 64 61 62" fill="none" stroke="#8cc7ee" stroke-width=".65"/><path d="M30 52 L26 47 M70 52 L74 47" stroke="#d7e9f7" stroke-width="1.3"/>`),
  };
  const FACE_LIST = [["none", "Nothing", 0], ["freckles", "Freckles", 1], ["blush", "Blush", 1], ["mustache", "Moustache", 1], ["goatee", "Goatee", 1], ["mask", "Face mask", 1], ["beard", "Beard", 2], ["stripes", "Warpaint", 4], ["glitter", "Glitter", 2], ["scar", "Scar", 3], ["paintstars", "Star paint", 3]];

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
  const HAT_COVER = new Set(["cap", "capback", "beanie", "bucket", "beret", "grad", "chef", "cowboy", "santa", "sombrero", "propeller"]);
  // long styles whose hair still hangs out from under a hat
  const HAT_HAIR = new Set(["long", "wavy", "bob", "ponytail", "braids"]);
  // restrained stitching added to the fabric hats
  const hatStitch = (id, x) => x.clip(id==='grad'?'M50 8 L84 20 L50 32 L16 20Z':'M31 20 Q50 12 69 20 L69 30 Q50 35 31 30Z',`<path d="M34 27 Q50 31 66 27" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width=".55" stroke-dasharray="1.2 1.1"/>`);
  const HATS = {
    none: () => "",
    cap: (x) => { const crown = "M29.5 34 C27 7 73 7 70.5 34 Q50 29.5 29.5 34Z"; return `<path d="${crown}" fill="#e5484d"/>${x.clip(crown, `<path d="M50 14 V32 M39.4 16 Q37 24 36.4 32 M60.6 16 Q63 24 63.6 32" stroke="#b02a2f" stroke-width="1" fill="none" opacity=".55"/>`)}<circle cx="50" cy="14.6" r="2" fill="#b02a2f"/><path d="M26.5 33.4 Q50 26.8 73.5 33.4 Q50 38.8 26.5 33.4Z" fill="#b02a2f"/>` + hatStitch('cap', x); },
    capback: (x) => {
      // Baseball cap worn backwards: from the front you see the back of the cap — the snapback strap across the forehead.
      const crown = "M29.2 34.4 C26.6 7 73.4 7 70.8 34.4 Q50 39 29.2 34.4Z", blue = "#2f6fe0", dk = "#1f4fb0", hi = "#6a9ff2";
      const yAt = px => { const t = (px - 40.6) / 18.8; return 31.4 + 2.6 * 4 * t * (1 - t); };
      const holes = [.15, .325, .5, .675, .85].map(t => { const px = 40.6 + t * 18.8; return `<circle cx="${px.toFixed(1)}" cy="${(yAt(px) + 2.1).toFixed(1)}" r=".7" fill="#7d8597"/>`; }).join("");
      return `<path d="${crown}" fill="${blue}"/>`
        + x.clip(crown, `<path d="M50 11 V36 M38.6 13.6 Q35 24 34.2 36 M61.4 13.6 Q65 24 65.8 36" stroke="${dk}" stroke-width=".8" fill="none" opacity=".75"/><path d="M33 22 C36 13 45 9.6 55 10.4" stroke="${hi}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/><path d="M26 31.2 Q50 36.4 74 31.2 V40 H26Z" fill="${dk}"/><circle cx="33.6" cy="21.4" r=".9" fill="${dk}"/><circle cx="66.4" cy="21.4" r=".9" fill="${dk}"/>`)
        + `<circle cx="50" cy="10.6" r="2.1" fill="${dk}"/><circle cx="49.5" cy="10.1" r=".7" fill="${hi}"/>`
        + `<path d="M40.6 31.6 Q50 34.2 59.4 31.6 L59.4 35.4 Q50 38 40.6 35.4Z" fill="#e8ecf4" stroke="#aab2c4" stroke-width=".5" stroke-linejoin="round"/>${holes}`
        + `<rect x="38.6" y="31.4" width="2.4" height="4.2" rx="1" fill="#cfd6e4" stroke="#aab2c4" stroke-width=".4"/><rect x="59" y="31.4" width="2.4" height="4.2" rx="1" fill="#cfd6e4" stroke="#aab2c4" stroke-width=".4"/>` + hatStitch('capback', x);
    },
    beanie: x=>{const p="M28 33 C26 7 74 7 72 33Z";return `<path d="${p}" fill="#233857"/>${x.clip(p,`<path d="M34 15 Q31 23 32 32 M41 12 L39 32 M49 11 V32 M57 12 L59 32 M65 15 Q69 23 68 32" fill="none" stroke="#3d5275" stroke-width=".7"/>`)}<rect x="27" y="29" width="46" height="9" rx="3.5" fill="#192b46"/><path d="M32 31 V36 M37 31 V36 M42 31 V36 M47 31 V36 M52 31 V36 M57 31 V36 M62 31 V36 M67 31 V36" stroke="#344a6b" stroke-width=".65"/><rect x="57" y="31" width="6" height="4" rx=".8" fill="#d9e1ed"/>`;},
    bucket: x=>{const p="M31 30 L34 14 Q50 10 66 14 L69 30Z";return `<path d="${p}" fill="#8bbba1"/>${x.clip(p,`<path d="M32 24 Q50 28 68 24" stroke="#507e68" stroke-width="3" fill="none"/><path d="M36 15 Q50 12 64 15 M33 28 Q50 32 67 28" stroke="#d2e8da" stroke-width=".6" fill="none"/>`)}<path d="M31 28 Q50 33 69 28 L78 36 Q50 44 22 36Z" fill="#719e85" stroke="#507e68" stroke-width=".7"/><path d="M27 35 Q50 41 73 35" fill="none" stroke="#c4ddcd" stroke-width=".65"/>`;},
    beret: (x) => `<path d="M27 33.4 C23 17 38 8 56 9 C72 10 80 20 72 31 C60 35 40 36 27 33.4Z" fill="#e5484d"/><path d="M33 31.6 Q50 35.4 70.6 30.6" stroke="#b02a2f" stroke-width="1.2" fill="none" opacity=".6" stroke-linecap="round"/><rect x="54" y="4.8" width="3.4" height="5" rx="1.7" fill="#b02a2f"/>` + hatStitch('beret', x),
    grad: (x) => `<path d="M34 24 L34 32.6 Q50 38.4 66 32.6 L66 24Z" fill="#2a2630"/><path d="M50 8 L84 20 L50 32 L16 20Z" fill="#33333d" stroke="#1d1d24" stroke-width="1" stroke-linejoin="round"/><path d="M50 19.6 Q66 23.2 78.4 21.4" stroke="#f5c542" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M78.4 21.4 V29.6" stroke="#f5c542" stroke-width="1.3" stroke-linecap="round"/><path d="M76.6 29.4 h3.6 l.7 4.6 h-5z" fill="#f5c542"/><circle cx="50" cy="19.8" r="2.1" fill="#f5c542"/>` + hatStitch('grad', x),
    chef: (x) => { const band = "M33 21 H67 V34 H33Z"; return `<circle cx="38" cy="16" r="9" fill="#fff"/><circle cx="62" cy="16" r="9" fill="#fff"/><circle cx="50" cy="10" r="10" fill="#fff"/><path d="M33 21 H67 V34 H33Z" fill="#fff" stroke="#d8dce6" stroke-width="1.2" stroke-linejoin="round"/>${x.clip(band, `<path d="M41 22 V33 M50 22 V33 M59 22 V33" stroke="#d8dce6" stroke-width="1"/>`)}<path d="M33 30 H67" stroke="#d8dce6" stroke-width="1.2"/>` + hatStitch('chef', x); },
    cowboy: (x) => { const crown = "M33 28 C32 12 38 8 50 9 C62 8 68 12 67 28Z"; return `<path d="M13 30 C24 37 34 31 36 28.4 L64 28.4 C66 31 76 37 87 30 C85 22 74 24 69 26 L31 26 C26 24 15 22 13 30Z" fill="#a8743a"/><path d="${crown}" fill="#c08848"/>${x.clip(crown, `<path d="M30 24.6 H70" stroke="#6b4a22" stroke-width="3.2"/>`)}<path d="M42 12 Q50 17 58 12" stroke="#a8743a" stroke-width="1.6" fill="none" stroke-linecap="round"/>` + hatStitch('cowboy', x); },
    party: (x) => { const cone = "M50 6 L35.5 33 Q50 37 64.5 33Z"; return `<path d="${cone}" fill="#ff5d8f"/>${x.clip(cone, `<path d="M30 17 L70 17 M30 24.4 L70 24.4" stroke="#ffd23f" stroke-width="3"/><circle cx="46.6" cy="29.6" r="1.3" fill="#3a8dff"/><circle cx="53.6" cy="29.8" r="1.3" fill="#3ecf8e"/><circle cx="51" cy="12.4" r="1.1" fill="#3a8dff"/>`)}<circle cx="50" cy="6.4" r="3.6" fill="#ffd23f"/>` + hatStitch('party', x); },
    flowers: () => `<path d="M30 34 Q50 22 70 34" stroke="#3ea66a" stroke-width="2" fill="none" stroke-linecap="round"/>` + ["32,32.6,#ff7eb6", "39,28,#ffd23f", "46,25.6,#ff7eb6", "54,25.6,#8b5cf6", "61,28,#ff7eb6", "68,32.6,#ffd23f"].map(s => { const [x, y, f] = s.split(","); return `<g fill="${f}"><circle cx="${x}" cy="${+y - 2.4}" r="2.6"/><circle cx="${+x + 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${+y + 2.4}" r="2.6"/><circle cx="${+x - 2.4}" cy="${y}" r="2.6"/><circle cx="${x}" cy="${y}" r="1.6" fill="#fff6a8"/></g>`; }).join(""),
    halo: () => `<ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#f5c542" stroke-width="3.4"/><ellipse cx="50" cy="9" rx="17" ry="4.6" fill="none" stroke="#fff6a8" stroke-width="1" opacity=".8"/>`,
    devil: () => `<path d="M31 27 C25.6 19 27.6 8.6 34 4.4 C33.6 12.4 37.6 18.6 42 22.4Z M69 27 C74.4 19 72.4 8.6 66 4.4 C66.4 12.4 62.4 18.6 58 22.4Z" fill="#e5484d" stroke="#a82327" stroke-width="1" stroke-linejoin="round"/>`,
    sombrero: (x) => { const crown = "M36 28 C36 7 64 7 64 28Z"; return `<ellipse cx="50" cy="27.6" rx="38" ry="7.6" fill="#e8b04c"/><ellipse cx="50" cy="27.6" rx="34.4" ry="6.3" fill="none" stroke="#e5484d" stroke-width="1.1" stroke-dasharray="2 2.4"/><path d="${crown}" fill="#f5c76b"/>${x.clip(crown, `<path d="M30 23.6 H70" stroke="#e5484d" stroke-width="3.2"/>`)}` + hatStitch('sombrero', x); },
    propeller: (x) => { const crown = "M29 34 C28 14 72 14 71 34Z"; return `<path d="${crown}" fill="#3a8dff"/>${x.clip(crown, `<path d="M29 31 Q50 36 71 31 V35 H29Z" fill="#e5484d"/>`)}<path d="M50 16.6 V9" stroke="#8a93a6" stroke-width="2" stroke-linecap="round"/><ellipse cx="41" cy="7.4" rx="9.4" ry="2.8" fill="#ffd23f" stroke="#c9961a" stroke-width=".8" transform="rotate(-10 41 7.4)"/><ellipse cx="59" cy="7.4" rx="9.4" ry="2.8" fill="#ffd23f" stroke="#c9961a" stroke-width=".8" transform="rotate(10 59 7.4)"/><circle cx="50" cy="8" r="2.2" fill="#e5484d"/>` + hatStitch('propeller', x); },
    santa: (x) => `<path d="M27.5 33 C26 14 40 5 58 6 C70 7 79 14 83 26 C77 20.6 71.6 21.6 70.6 28.6 L72.4 33Z" fill="#e5484d"/><rect x="26" y="28.6" width="48" height="8" rx="4" fill="#fff"/><circle cx="82" cy="27" r="5.2" fill="#fff"/>` + hatStitch('santa', x),
    crown: () => `<path d="M30 30 L28 10 L40 20 L50 6 L60 20 L72 10 L70 30Z" fill="#f5c542" stroke="#c9961a" stroke-width="1.6" stroke-linejoin="round"/><rect x="30" y="25.6" width="40" height="5.6" fill="#e0a82a"/><circle cx="50" cy="28.4" r="2.2" fill="#e5484d"/><circle cx="39" cy="28.4" r="1.8" fill="#3a8dff"/><circle cx="61" cy="28.4" r="1.8" fill="#3ecf8e"/><circle cx="28" cy="10" r="2.2" fill="#fff"/><circle cx="50" cy="6" r="2.2" fill="#fff"/><circle cx="72" cy="10" r="2.2" fill="#fff"/>`
  };
  const HAT_LIST = [["none", "None", 0], ["cap", "Red cap", 1], ["capback", "Backwards cap", 1], ["beanie", "Beanie", 1], ["bucket", "Bucket hat", 1], ["beret", "Beret", 1], ["grad", "Graduation cap", 4], ["chef", "Chef hat", 2], ["cowboy", "Cowboy hat", 2], ["party", "Party hat", 2], ["flowers", "Flower crown", 2], ["santa", "Santa hat", 3], ["devil", "Devil horns", 3], ["sombrero", "Sombrero", 2], ["propeller", "Propeller cap", 3], ["halo", "Halo", 3], ["crown", "Golden crown", 4]];

  /* ------------------------------ extras -------------------------------- */
  // a faint highlight stroke added over the neckline extras
  const extraGlint = (x, d) => x.body(`<path d="${d}" stroke="#fff" stroke-opacity=".38" stroke-width=".55" fill="none" stroke-linecap="round"/>`);
  const EXTRA = {
    none: () => ({}),
    headphones: () => ({ front: `<path d="M28.5 46 C26.5 21 36 17.5 50 17.5 C64 17.5 73.5 21 71.5 46" stroke="#33333d" stroke-width="4.2" fill="none" stroke-linecap="round"/><rect x="24.5" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/><rect x="66.5" y="40" width="9" height="16" rx="4.5" fill="#ff5d8f" stroke="#33333d" stroke-width="2"/>` + `<path d="M27 44 V51 M70 44 V51" stroke="#ffb1cf" stroke-width="1" stroke-linecap="round"/><path d="M33 27 Q50 13 67 27" fill="none" stroke="#606478" stroke-width=".8"/>` }),
    earrings: () => ({ front: `<circle cx="29.8" cy="53.4" r="2" fill="none" stroke="#f5c542" stroke-width="1.3"/><circle cx="70.2" cy="53.4" r="2" fill="none" stroke="#f5c542" stroke-width="1.3"/>` + `<circle cx="29.2" cy="52.3" r=".5" fill="#fff5c2"/><circle cx="69.6" cy="52.3" r=".5" fill="#fff5c2"/>` }),
    flowerear: () => ({ front: `<g transform="translate(29.6 40.4)"><path d="M0 0 L-6.4 3 Q-4 -1 0 0Z M0 0 L-2.4 6.6 Q1.4 4 0 0Z" fill="#3ea66a"/><g fill="#ff5d8f"><circle cy="-3.6" r="3.2"/><circle cx="3.6" r="3.2"/><circle cy="3.6" r="3.2"/><circle cx="-3.6" r="3.2"/></g><circle r="2.2" fill="#ffd23f"/></g>` + `<circle cx="29" cy="39.8" r=".65" fill="#fff5bc"/>` }),
    bowtie: (x) => ({ over: `<path d="M50 80.4 C45.4 74.8 39.2 75.2 39.2 80.4 C39.2 85.6 45.4 86 50 80.4Z M50 80.4 C54.6 74.8 60.8 75.2 60.8 80.4 C60.8 85.6 54.6 86 50 80.4Z" fill="#e5484d" stroke="#a82327" stroke-width="1" stroke-linejoin="round"/><rect x="47.4" y="77.6" width="5.2" height="5.6" rx="2" fill="#c43a40" stroke="#a82327" stroke-width=".8"/>` + extraGlint(x, 'M42 79 L46 80 M54 80 L58 79') }),
    scarf: (x) => {
      const wrap = "M41.4 67.4 Q50 74 58.6 67.4 L62 72 C67.5 74 70.5 77 71 81.4 Q50 93 29 81.4 C29.5 77 32.5 74 38 72Z";
      const tail = "M56.6 82 L66.4 80.4 L68.4 98.2 L58 99.6Z";
      return { over: `<path d="${wrap}" fill="#e5484d"/>${x.clip(wrap, `<path d="M36 70 L33 90 M43 73 L41 92 M50 74 L50 94 M57 73 L59 92 M64 70 L67 90" stroke="#fff" stroke-width="2.6" opacity=".85"/>`)}<path d="${tail}" fill="#c43a40"/>${x.clip(tail, `<path d="M55 88 H70 M55 93.6 H70" stroke="#fff" stroke-width="2.4" opacity=".85"/>`)}` + extraGlint(x, 'M36 77 Q47 83 59 77') };
    },
    pearls: (x) => ({ over: [0, 1, 2, 3, 4, 5, 6].map(i => { const t = i / 6, px = 41.6 + t * 16.8, py = 76.4 + Math.sin(t * Math.PI) * 8; return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.1" fill="#fbf7ee" stroke="#cfc7b4" stroke-width=".6"/>`; }).join("") + extraGlint(x, 'M42 77 L43 77 M49 82 L50 82 M57 77 L58 77') }),
    lanyard: (x) => ({ over: x.body(`<path d="M40.4 75.4 L50 87.6 L59.6 75.4" stroke="#3a8dff" stroke-width="2.8" fill="none" stroke-linejoin="round"/>`) + `<rect x="48.4" y="86" width="3.2" height="3" rx=".8" fill="#9aa3b5"/><rect x="43" y="88.4" width="14" height="10.2" rx="2" fill="#fff" stroke="#8a93a6" stroke-width="1"/><rect x="45" y="90.6" width="4.4" height="4.4" fill="#f1c27d"/><path d="M51 91.4 h4 M51 94.4 h4" stroke="#8a93a6" stroke-width="1" stroke-linecap="round"/>` + extraGlint(x, 'M45 97 H55') }),
    medal: (x) => ({ over: x.body(`<path d="M40.4 75.4 L47 87 M59.6 75.4 L53 87" stroke="#e5484d" stroke-width="4"/>`) + `<circle cx="50" cy="91.4" r="6.4" fill="#f5c542" stroke="#c9961a" stroke-width="1.4"/>${star5(50, 91.4, 4, "#c9961a")}` + extraGlint(x, 'M46 88 Q50 85 54 88') }),
    backpack: (x) => {
      // Backpack: the top of the bag peeks over both shoulders, padded straps run down the chest, and a sternum strap links them.
      const bag = "#3b4358", bagHi = "#505a77", bagDk = "#2b3142", trim = "#ff8a3d";
      const strap = m => { const p = [[33.6, 76.2], [40, 77.4], [34.8, 101], [27.2, 101]]; return p.map((q, i) => `${i ? "L" : "M"}${m ? 100 - q[0] : q[0]} ${q[1]}`).join(" ") + "Z"; };
      const centre = m => `M${m ? 100 - 36.8 : 36.8} 77 C${m ? 100 - 35 : 35} 86 ${m ? 100 - 32.4 : 32.4} 93 ${m ? 100 - 31 : 31} 101`;
      const one = m => `<path d="${strap(m)}" fill="${bag}" stroke="${bagDk}" stroke-width=".7" stroke-linejoin="round"/><path d="${centre(m)}" stroke="${bagHi}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="${centre(m)}" stroke="${trim}" stroke-width=".4" fill="none" stroke-dasharray="1.2 1"/>`;
      return {
        back: `<path d="M19 100 V82 Q19 65.6 34 65.6 H66 Q81 65.6 81 82 V100Z" fill="${bag}"/><path d="M19.6 80 Q19.6 66.6 34 66.2 H46" stroke="${bagHi}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M22.4 74 Q23.4 68.4 34 68.4 H66 Q76.6 68.4 77.6 74" stroke="${trim}" stroke-width=".7" fill="none"/>`,
        over: x.body(one(false) + one(true)
          + `<path d="M35.4 90.2 H64.6" stroke="${bagDk}" stroke-width="2" stroke-linecap="round"/><path d="M35.4 90.2 H64.6" stroke="${bagHi}" stroke-width=".5" stroke-dasharray="1 1"/>`
          + `<rect x="47.2" y="88.2" width="5.6" height="4" rx=".9" fill="${trim}" stroke="#c4631b" stroke-width=".4"/><rect x="48.5" y="89.3" width="3" height="1.8" rx=".4" fill="${bagDk}"/>`) + extraGlint(x, 'M29 96 L34 96 M66 96 L71 96')
      };
    },
    eyepatch: (x) => ({ front: x.head(`<path d="M24 35 L54 42.6 M64 47.6 L76 50.6" stroke="#1d1d24" stroke-width="1.5" stroke-linecap="round"/>`) + `<ellipse cx="59" cy="45.6" rx="6.6" ry="5.6" fill="#1d1d24"/>` + `<path d="M55 43 Q59 40 63 43" stroke="#505563" stroke-width=".7" fill="none"/>` })
  };
  const EXTRA_LIST = [["none", "None", 0], ["headphones", "Headphones", 1], ["earrings", "Gold earrings", 1], ["flowerear", "Flower behind ear", 1], ["bowtie", "Bow tie", 1], ["lanyard", "School lanyard", 1], ["backpack", "Backpack straps", 1],
    ["pearls", "Pearl necklace", 2], ["scarf", "Striped scarf", 2], ["eyepatch", "Eyepatch", 2], ["medal", "Gold medal", 3]];

  /* ------------------------------ tops ---------------------------------- */
  const topShape = (f, extra, x) => `<path d="${BODY}" fill="${f}"/>${extra ? x.body(extra) : ""}`;
  const TOPS = {
    tee: (c, d, l, x) => ({ body: topShape(c, "", x), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="${d}" stroke-width="3"/>` }),
    hoodie: (c, d, l, x) => ({
      back: `<path d="M28 65 C24.6 74 28 82.4 38 84 L62 84 C72 82.4 75.4 74 72 65 C66 69.6 34 69.6 28 65Z" fill="${d}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/><path d="M32 68 C40 72 60 72 68 68 L69.5 77.4 C60 82 40 82 30.5 77.4Z" fill="${shade(d, -.22)}"/>`,
      body: topShape(c, "", x),
      over: `<path d="M32.4 76.6 Q50 95.4 67.6 76.6" fill="none" stroke="${d}" stroke-width="6.4" stroke-linecap="round"/><path d="M32.8 75.6 Q50 93.4 67.2 75.6" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/><path d="M36 78 Q50 91 64 78" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1.2" stroke-linecap="round"/>` +
        `<path d="M44.4 88.6 v7.4 M55.6 88.6 v7.4" stroke="${l}" stroke-width="1.8" stroke-linecap="round"/><rect x="43.4" y="95" width="2" height="3" rx="1" fill="${d}"/><rect x="54.6" y="95" width="2" height="3" rx="1" fill="${d}"/>` +
        x.body(`<path d="M28 100 V94.4 Q50 88.6 72 94.4 V100Z" fill="${d}" opacity=".3"/><path d="M28 94.4 Q50 88.6 72 94.4" fill="none" stroke="${d}" stroke-width="1.2" opacity=".6"/>`)
    }),
    polo: (c, d) => ({ body: topShape(c, "", { body: s => s }), over: `<path d="M38.5 76.4 L45 86.4 L50 80 L55 86.4 L61.5 76.4 L56 73.6 L50 79 L44 73.6Z" fill="${d}" stroke="${d}" stroke-width=".6" stroke-linejoin="round"/><path d="M50 80 V94" stroke="${d}" stroke-width="1.6"/><circle cx="50" cy="86" r="1" fill="#fff"/><circle cx="50" cy="91" r="1" fill="#fff"/>` }),
    overalls: (c, d, l, x) => ({ body: topShape("#f1f1f6", "", x), over: `<path d="M30 100 V90 L36 90 L38.2 76.4 L44.2 75.8 L40.4 92 H59.6 L55.8 75.8 L61.8 76.4 L64 90 L70 90 V100Z" fill="${c}"/><rect x="42" y="90" width="16" height="10" fill="${d}" opacity=".45"/><circle cx="41.2" cy="79" r="1.6" fill="#f5c542"/><circle cx="58.8" cy="79" r="1.6" fill="#f5c542"/>` }),
    flannel: (c, d, l, x) => ({ body: topShape(c, [79, 87, 95].map(y => `<rect x="10" y="${y}" width="80" height="3.6" fill="${d}" opacity=".6"/>`).join("") + [24, 36, 48, 60, 72].map(xx => `<rect x="${xx}" y="74" width="3.6" height="28" fill="${d}" opacity=".6"/>`).join(""), x), over: `<path d="M38.5 76.4 L45 86.4 L50 80 L55 86.4 L61.5 76.4 L56 73.6 L50 79 L44 73.6Z" fill="${d}"/><path d="M50 80 V100" stroke="${d}" stroke-width="1.4"/>` }),
    jersey: (c, d, l, x) => ({ body: topShape(c, `<path d="M12 100 C12 90 18 84 24 81 L24 100Z M88 100 C88 90 82 84 76 81 L76 100Z" fill="${d}"/>`, x), over: `<path d="M38 76.2 Q50 88 62 76.2" fill="none" stroke="#fff" stroke-width="3"/><text x="50" y="98" font-size="14" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial Black,Arial,sans-serif">29</text>` }),
    varsity: (c, d, l, x) => ({ body: topShape("#f1f1f6", `<path d="M12 100 C12 88 20 82 26 80 L24 100Z M88 100 C88 88 80 82 74 80 L76 100Z" fill="${c}"/>`, x), over: `<path d="M50 84 V100" stroke="${d}" stroke-width="1.4"/>` + x.body(`<path d="M38 75 Q50 86 62 75" fill="none" stroke="${c}" stroke-width="3.6"/>`) + `<circle cx="36" cy="92" r="4.4" fill="${c}"/><text x="36" y="94.4" font-size="6" font-weight="900" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">W</text>` }),
    suit: (c, d, l, x) => ({ body: topShape("#2b3350", "", x), over: `<path d="M40 76.2 L50 97 L60 76.2Z" fill="#fff"/><path d="M48.4 79.8 L51.6 79.8 L51 83 L49 83Z M49 83 L47.6 94 L50 97.6 L52.4 94 L51 83Z" fill="#e5484d"/><path d="M37.4 76.6 L40.6 76 L50 97 L48 99.6 L36 80Z M62.6 76.6 L59.4 76 L50 97 L52 99.6 L64 80Z" fill="#3a4470"/>` }),
    lab: (c, d, l, x) => ({ body: topShape("#f4f6fb", `<path d="M12 100 C12 84 28 75 50 75 C72 75 88 84 88 100Z" fill="none" stroke="#dfe3ee" stroke-width="1.4"/>`, x), over: `<path d="M40 76.2 L50 97 L60 76.2Z" fill="#6fb6ff"/><path d="M37.6 76.6 L40.6 76 L49.6 94.6 L44.4 97.4Z M62.4 76.6 L59.4 76 L50.4 94.6 L55.6 97.4Z" fill="#fff" stroke="#dfe3ee" stroke-width="1" stroke-linejoin="round"/><rect x="62" y="88" width="8" height="8" rx="1.4" fill="#fff" stroke="#dfe3ee"/><path d="M64.4 88 v-2.8 M67.4 88 v-3.8" stroke="#3a8dff" stroke-width="1.4" stroke-linecap="round"/>` }),
    puffer: (c, d, l, x) => {
      // Quilted down jacket. Everything that makes up the jacket is drawn as solid colour
      // (gradients between shades of the jacket colour), so it reads as opaque padded
      // fabric on any colour. Only the soft round-the-body shading is translucent.
      const hi = shade(c, .17), lo = shade(c, -.15), deep = shade(c, -.32), crease = shade(c, -.44), sheen = shade(c, .22);
      const stop = (o, col) => `<stop offset="${o}" stop-color="${col}"/>`;
      const gB = x.id("pb"), gT = x.id("pt"), gL = x.id("pl"), gS = x.id("ps"), gC = x.id("pc");
      x.defs += `<linearGradient id="${gB}" x1="0" y1="0" x2="0" y2="1">${stop(0, lo)}${stop(.2, c)}${stop(.5, hi)}${stop(.8, c)}${stop(1, lo)}</linearGradient>`
        + `<linearGradient id="${gT}" gradientUnits="userSpaceOnUse" x1="0" y1="66" x2="0" y2="75.5">${stop(0, c)}${stop(.4, hi)}${stop(1, lo)}</linearGradient>`
        + `<linearGradient id="${gL}" gradientUnits="userSpaceOnUse" x1="0" y1="73" x2="0" y2="82.5">${stop(0, lo)}${stop(.4, hi)}${stop(.75, c)}${stop(1, deep)}</linearGradient>`
        + `<linearGradient id="${gS}" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="88" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".3"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>`
        + `<linearGradient id="${gC}" gradientUnits="userSpaceOnUse" x1="30" y1="0" x2="70" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".36"/><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient>`;

      // Baffles: rows between seams, each curving down through the middle like a rounded chest.
      const edges = [68, 84, 90.5, 97, 104], B = 7;
      const bow = y => `M4 ${y} Q50 ${y + B} 96 ${y}`;
      const yAt = (y, px) => { const t = (px - 4) / 92; return y + B * 2 * t * (1 - t); };
      const baffle = (a, b) => `<path d="M4 ${a} Q50 ${a + B} 96 ${a} L96 ${b} Q50 ${b + B} 4 ${b}Z" fill="url(#${gB})"/>`;
      const rows = edges.slice(0, -1).map((a, i) => baffle(a, edges[i + 1])).join("");
      const streak = (a, b) => { const m = (a + b) / 2, pts = [24, 28, 32, 36, 40].map(px => `${px} ${yAt(m, px).toFixed(1)}`); return `<path d="M${pts.join(" L")}" stroke="${sheen}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`; };
      const streaks = [1, 2, 3].map(i => streak(edges[i], edges[i + 1])).join("");
      const seamLines = edges.slice(1, 4).map(y => `<path d="${bow(y + 1.2)}" stroke="${hi}" stroke-width=".7" fill="none"/><path d="${bow(y)}" stroke="${crease}" stroke-width="1.1" fill="none"/>`).join("");
      const sideSeams = `<path d="M25.6 79 Q23.8 90 25 101 M74.4 79 Q76.2 90 75 101" stroke="${deep}" stroke-width=".8" fill="none" stroke-dasharray="1.6 1.1"/>`;

      // Padded funnel collar: top roll + lower band, shaded round like a tube.
      const collar = "M30 74 C29.5 68.5 35 66 40.5 67.6 Q46 70 50 71 Q54 70 59.5 67.6 C65 66 70.5 68.5 70 74 L70 77.5 Q50 86 30 77.5Z";
      const seam = "M24 71.6 Q50 78.6 76 71.6";
      const collarArt = x.clip(collar,
        `<path d="M24 58 L76 58 L76 71.6 Q50 78.6 24 71.6Z" fill="url(#${gT})"/>`
        + `<path d="${seam} L76 92 L24 92Z" fill="url(#${gL})"/>`
        + `<path d="M31 69.2 Q50 75.6 69 69.2" stroke="${sheen}" stroke-width="1.3" stroke-linecap="round" fill="none"/>`
        + `<rect x="24" y="58" width="52" height="34" fill="url(#${gC})"/>`
        + `<path d="${seam}" stroke="${hi}" stroke-width=".7" transform="translate(0 1.2)" fill="none"/><path d="${seam}" stroke="${crease}" stroke-width="1.1" fill="none"/>`);

      return {
        // dark inside of the collar, seen between the jaw and the collar's front edge
        back: `<path d="M31 72 C31.5 64 40 62 50 62 C60 62 68.5 64 69 72 L69 80 L31 80Z" fill="${shade(c, -.38)}"/>`,
        body: `<path d="${BODY}" fill="${c}"/>` + x.body(rows + `<rect x="8" y="64" width="84" height="40" fill="url(#${gS})"/>` + seamLines + streaks + sideSeams),
        over: `<path d="M30 77.5 Q50 86 70 77.5 L70 79.4 Q50 88.2 30 79.4Z" fill="${deep}"/>`
          + collarArt
          + `<path d="${collar}" fill="none" stroke="${crease}" stroke-width=".9" stroke-linejoin="round"/>`
          + `<path d="M49.1 70.8 H50.9 V100 H49.1Z" fill="${crease}"/><path d="M50 71.4 V100" stroke="#eef0f5" stroke-width=".9" stroke-dasharray=".7 .7" fill="none"/>`
          + `<rect x="48.8" y="70.4" width="2.4" height="2.8" rx=".9" fill="#dde1ea" stroke="#7d8597" stroke-width=".4"/><rect x="49.4" y="73" width="1.2" height="4.6" rx=".5" fill="#c4c9d6" stroke="#7d8597" stroke-width=".3"/>`
      };
    },
    raincoat: (c,d,l,x)=>({back:`<path d="M28 77 Q24 62 39 66 Q50 72 61 66 Q76 62 72 77 L65 84 H35Z" fill="${d}"/><path d="M33 73 Q50 63 67 73 L62 79 H38Z" fill="${shade(c,-.4)}"/>`,body:topShape(c,`<path d="M24 83 Q50 92 76 83" stroke="${d}" stroke-width=".9" fill="none"/><path d="M26 93 L39 91 L40 96 L27 98Z M61 91 L74 93 L73 98 L60 96Z" fill="${d}"/><path d="M27 93 L39 91 M61 91 L73 93" stroke="${l}" stroke-width=".6"/><path d="M22 88 L28 85 M72 85 L78 88" stroke="#dbe6ee" stroke-width="2"/><path d="M48 80 H52 V101 H48Z" fill="${d}"/><path d="M50 82 V100" stroke="#c8d3de" stroke-width=".65" stroke-dasharray=".7 .7"/>`,x),over:`<path d="M36 73 L49 79 L44 86 L32 77Z M64 73 L51 79 L56 86 L68 77Z" fill="${shade(c,.1)}" stroke="${d}" stroke-width=".8"/><rect x="49" y="80" width="2" height="3" rx=".6" fill="#dbe6ee"/>`}),
    blazer: (c, d, l, x) => {
      // Tailored blazer: notch lapels, white shirt with collar and a tonal tie, breast pocket with pocket square.
      const hi = shade(c, .12), lo = shade(c, -.12), deep = shade(c, -.3), crease = shade(c, -.44), tie = shade(c, -.5), tieHi = shade(c, -.2);
      const gS = x.id("bs");
      x.defs += `<linearGradient id="${gS}" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="88" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".3"/><stop offset=".26" stop-color="#000" stop-opacity="0"/><stop offset=".74" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>`;
      const LAP = [[39.6, 75.2], [35.9, 77.4], [38.6, 80.2], [35.4, 83.8], [47.2, 99.4], [50, 97.4]];
      const pts = (a, m) => a.map(p => `${m ? 100 - p[0] : p[0]} ${p[1]}`).join(" L");
      const lapel = (m, f) => `<path d="M${pts(LAP, m)}Z" fill="${f}" stroke="${crease}" stroke-width=".6" stroke-linejoin="round"/>`;
      const wing = m => { const w = [[42.2, 73.8], [49.6, 78.6], [44.6, 84], [38.4, 76.6]]; return `<path d="M${pts(w, m)}Z" fill="#f8f9fc" stroke="#cdd3e2" stroke-width=".5" stroke-linejoin="round"/>`; };
      const blade = "M48.4 81 H51.6 L53.4 92.6 L50 97 L46.6 92.6Z";
      return {
        back: `<path d="M34.6 71.4 C41 68 59 68 65.4 71.4 L67.4 78 L32.6 78Z" fill="${deep}"/>`,
        body: `<path d="${BODY}" fill="${c}"/>` + x.body(`<ellipse cx="29" cy="79.6" rx="11" ry="3" fill="${hi}" transform="rotate(-18 29 79.6)"/><rect x="8" y="64" width="84" height="40" fill="url(#${gS})"/>`
          + `<path d="M27 80 Q24.6 90 26 101 M73 80 Q75.4 90 74 101" stroke="${crease}" stroke-width=".7" fill="none" opacity=".8"/>`
          + `<path d="M60.2 88.8 L70.2 87.6" stroke="${crease}" stroke-width="1.1" stroke-linecap="round"/><path d="M62 88.2 L62.8 85.4 L64.6 86.8 L66.2 84.9 L67.2 88Z" fill="#f8f9fc" stroke="#cdd3e2" stroke-width=".4" stroke-linejoin="round"/>`),
        over: `<path d="M39.4 75 L50 98.4 L60.6 75Z" fill="#f8f9fc"/><path d="M40.6 76.4 L50 96.6 L59.4 76.4" fill="none" stroke="#dfe3ee" stroke-width="1.6"/>`
          + wing(false) + wing(true)
          + `<path d="M47.4 77.2 H52.6 L51.8 81.4 H48.2Z" fill="${tie}"/><path d="${blade}" fill="${tie}"/>`
          + x.clip(blade, `<path d="M44 85.6 L56 81.6 M44 90.2 L56 86.2 M44 94.8 L56 90.8" stroke="${tieHi}" stroke-width="1.5"/>`)
          + lapel(false, hi) + lapel(true, lo)
      };
    },
    rugby: (c, d, l, x) => ({ body: topShape("#26262e", `<path d="M8 94 H92 M8 98.4 H92" stroke="#fff" stroke-width="1.6" opacity=".7"/>`, x), over: `<path d="M38.5 76.4 L50 86 L61.5 76.4 L56 72.6 L50 78 L44 72.6Z" fill="#fff" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/><path d="M50 86 V94" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` }),
    kiwi: (c, d, l, x) => ({ body: topShape("#2f9a5d", "", x), over: `<path d="M39 76 Q50 88 61 76" fill="none" stroke="#1f7240" stroke-width="3"/><ellipse cx="46" cy="93.4" rx="8.6" ry="6" fill="#7a5a3a"/><circle cx="55.4" cy="88.4" r="3.6" fill="#7a5a3a"/><path d="M58 89.4 Q63.6 90.6 67 94.4" stroke="#d9b87c" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="55.8" cy="87.6" r="1.1" fill="#fff"/><circle cx="56" cy="87.7" r=".5" fill="#222"/><path d="M43 99 v-2.6 M49 99 v-2.6" stroke="#d9b87c" stroke-width="1.3" stroke-linecap="round"/>` }),
    disco: (c, d, l, x) => {
      const g = x.id("ds"), gl = x.id("dl"), pt = x.id("dp");
      x.defs += `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3f5ff"/><stop offset=".5" stop-color="#c5cde6"/><stop offset="1" stop-color="#8d97ba"/></linearGradient>`
        + `<linearGradient id="${gl}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5cf0"/><stop offset=".5" stop-color="#5a32b8"/><stop offset="1" stop-color="#34196f"/></linearGradient>`
        // a tile of staggered mirror sequins in four soft tints, each with a tiny glint
        + `<pattern id="${pt}" patternUnits="userSpaceOnUse" width="7.6" height="7" patternTransform="translate(9 75.6)">`
        + [[0, 0, "#ffffff"], [3.8, 0, "#dfe8ff"], [1.9, 3.5, "#ffe3f5"], [5.7, 3.5, "#dcf6ff"]].map(t => `<rect x="${t[0] + .2}" y="${t[1] + .2}" width="3.2" height="3.1" rx=".55" fill="${t[2]}" stroke="#8691b6" stroke-width=".25"/><path d="M${t[0] + .8} ${t[1] + 1.4} q.3 -.8 1.1 -.9" stroke="#fff" stroke-width=".4" stroke-linecap="round" fill="none"/>`).join("")
        + `</pattern>`;
      const body = `<rect width="100" height="100" fill="url(#${pt})"/><path d="M0 86 L100 70 V77 L0 94Z" fill="#fff" opacity=".14"/><path d="M12 100 C12 83 28 75 50 75 C72 75 88 83 88 100" fill="none" stroke="#6f7aa0" stroke-width="1.6" opacity=".35"/>`;
      const lapelL = "M40 75.8 L29.4 78.2 L35.4 90 L50 98.4Z", lapelR = "M60 75.8 L70.6 78.2 L64.6 90 L50 98.4Z";
      return {
        body: topShape(`url(#${g})`, body, x),
        over: `<path d="M40 75.8 L60 75.8 L50 98.4Z" fill="#17141f"/>`
          + `<path d="M43.2 77 Q50 91.6 56.8 77" fill="none" stroke="#f5c542" stroke-width=".75" stroke-linecap="round"/><circle cx="50" cy="90.2" r="1.15" fill="#f5c542" stroke="#c9961a" stroke-width=".3"/>`
          + `<path d="${lapelL}" fill="url(#${gl})"/><path d="${lapelR}" fill="url(#${gl})"/>`
          + `<path d="M40 75.8 L29.4 78.2 L35.4 90 L50 98.4 M60 75.8 L70.6 78.2 L64.6 90 L50 98.4" fill="none" stroke="#f1f3ff" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round"/>`
          + `<path d="M38.4 77.4 L31.8 79 M61.6 77.4 L68.2 79" stroke="#b9a0ff" stroke-width=".7" stroke-linecap="round" opacity=".8"/>` + x.body(`<path d="M25 84 Q23 91 25 100 M75 84 Q77 91 75 100" stroke="#69749c" stroke-width=".7" fill="none"/><path d="M30 94 L39 92 M61 92 L70 94" stroke="#f4f2ff" stroke-width="1.1"/>`)
      };
    }
  };
  const TOP_LIST = [["tee", "T-shirt", 0], ["hoodie", "Hoodie", 2], ["polo", "Polo", 1], ["overalls", "Overalls", 1], ["flannel", "Flannel shirt", 1], ["jersey", "29 Shirt", 2], ["varsity", "Varsity jacket", 2], ["suit", "Suit & tie", 2], ["lab", "Lab coat", 2], ["puffer", "Puffer jacket", 3], ["raincoat", "Raincoat", 2], ["blazer", "Blazer", 3], ["rugby", "Rugby top", 1], ["kiwi", "Kiwi tee", 2], ["disco", "Disco jacket", 4]];

  /* ------------------------------ backgrounds --------------------------- */
  const stars = (pts, col) => pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="${col || "#fff"}"/>`).join("");
  // City Dusk skyline: three layers of towers (far haze, mid, near silhouettes) with rooftop details and lit windows.
  const CITY = (() => {
    const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const layers = [
      { col: "#7b64b2", op: .85, b: [[-2, 9, 56], [6, 8, 46], [13, 7, 52], [19, 9, 40], [27, 8, 50], [34, 10, 36], [43, 8, 48], [50, 9, 42], [58, 8, 54], [65, 9, 38], [73, 8, 50], [80, 9, 44], [88, 8, 52], [95, 9, 46]] },
      { col: "#46388b", win: .3, b: [[0, 11, 52], [10, 8, 44], [17, 10, 56], [26, 9, 47], [34, 9, 58], [43, 12, 52], [56, 9, 50], [64, 11, 43], [74, 9, 55], [82, 10, 46], [91, 10, 53]] },
      { col: "#1e1a45", win: .42, b: [[-1, 12, 64], [11, 9, 58], [19, 7, 66], [27, 8, 60], [35, 10, 68], [45, 12, 70], [57, 10, 66], [67, 8, 61], [75, 9, 66], [83, 8, 57], [90, 11, 63]] }
    ];
    let svg = ""; const lit = []; let n = 0;
    layers.forEach((L, li) => {
      let warm = "", cool = "";
      L.b.forEach(([bx, w, top], bi) => {
        svg += `<rect x="${bx}" y="${top}" width="${w}" height="${100 - top}" fill="${L.col}"${L.op ? ` opacity="${L.op}"` : ""}/>`;
        const h = hash(li * 40 + bi), mx = bx + w / 2;
        if (li === 0 && h > .45) svg += `<path d="M${mx - 1.4} ${top} L${mx} ${top - 5} L${mx + 1.4} ${top}Z" fill="${L.col}" opacity=".85"/>`;
        if (li >= 1 && h > .55) { svg += `<rect x="${mx - .25}" y="${top - 5}" width=".5" height="5" fill="${L.col}"/>`; if (li === 2) svg += `<circle cx="${mx}" cy="${top - 5}" r=".6" fill="#ff5a5a"/>`; }
        if (li >= 1 && h < .3) svg += `<rect x="${bx + 1}" y="${top - 2.2}" width="${Math.min(3.2, w - 2)}" height="2.2" fill="${L.col}"/><rect x="${bx + 1.4}" y="${top - 3}" width=".5" height=".9" fill="${L.col}"/>`;
        if (L.win) for (let yy = top + 2.4; yy < 92; yy += 3.4) for (let xx = bx + 1.4; xx + 1.3 <= bx + w - .7; xx += 2.5) {
          n++; if (xx > 28 && xx < 72 && yy < 74) continue;
          if (hash(n) < L.win) {
            const cl = hash(n + 99) < .18;
            if (cl) cool += `M${xx.toFixed(1)} ${yy.toFixed(1)}h1.2v1.6h-1.2z`; else warm += `M${xx.toFixed(1)} ${yy.toFixed(1)}h1.2v1.6h-1.2z`;
            if (li >= 1 && !cl && (xx < 27 || xx > 73) && yy > 54 && yy < 84) lit.push([+(xx + .6).toFixed(1), +(yy + .8).toFixed(1)]);
          }
        }
      });
      if (warm) svg += `<path d="${warm}" fill="#ffd98a" opacity=".92"/>`;
      if (cool) svg += `<path d="${cool}" fill="#9fd6ff" opacity=".9"/>`;
    });
    return { svg, lit };
  })();
  // Auckland at blue hour, after a harbour-side photo: the Sky Tower over the lit CBD, the brick Viaduct apartments with
  // their lamps, a marina of white yachts, gold light streaking across the water and the black mooring piles.
  // Drawn in photo pixels (1777 x 1333) and fitted into the avatar circle by one transform; windows are merged into a
  // few paths per layer to keep it light. Built once - AKL(ids) only fills in the gradient ids.
  const AKL = (() => {
    const hs = n => { const v = Math.sin(n * 91.7 + 17.3) * 43758.5453; return v - Math.floor(v); };
    const R = Math.round;
    let seed = 0, warm = "", cool = "";
    const lit = (x, y, w, h, cw, ch, p, cp, fw) => {
      for (let yy = y + ch * .4; yy + ch * .6 < y + h; yy += ch) for (let xx = x + cw * .3; xx + cw * .7 < x + w; xx += cw) {
        seed++; if (hs(seed) >= p) continue;
        const ww = R(cw * (fw || .46)), d = `M${R(xx)} ${R(yy)}h${ww}v${R(ch * .52)}h${-ww}z`;
        if (hs(seed + 700) < cp) cool += d; else warm += d;
      }
    };
    const blk = (x, y, w, h, col, cw, ch, p, cp, side, fw) => {
      if (cw) lit(x, y, w, h, cw, ch, p, cp || 0, fw);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`
        + (side ? `<rect x="${R(x + w * (1 - side[0]))}" y="${y}" width="${R(w * side[0])}" height="${h}" fill="${side[1]}"/>` : "");
    };
    const flush = (wc, cc, gl) => {
      const g = (d, col) => gl ? `<path d="${d}" fill="${col}" stroke="${col}" stroke-width="${gl}" stroke-linejoin="round" opacity=".26"/>` : "";
      wc = wc || "#ffd48c"; cc = cc || "#c4e2ff";
      const s = (warm ? g(warm, wc) + `<path d="${warm}" fill="${wc}" opacity=".93"/>` : "") + (cool ? g(cool, cc) + `<path d="${cool}" fill="${cc}" opacity=".85"/>` : "");
      warm = cool = ""; return s;
    };
    const rows = (x0, x1, y0, y1, st) => { let d = ""; for (let y = y0; y <= y1; y += st) d += `M${x0} ${y}H${x1}`; return d; };
    const vl = (x0, st, n, y0, y1) => { let d = ""; for (let i = 0; i < n; i++) d += `M${x0 + i * st} ${y0}V${y1}`; return d; };
    const dots = (x0, st, n, y, w, h, p, s0) => { let d = ""; for (let i = 0; i < n; i++) if (hs(s0 + i) < p) d += `M${x0 + i * st} ${y}h${w}v${h}h${-w}z`; return d; };
    const slots = (() => { let a = "", b = ""; for (let y = 574; y < 834; y += 30) { a += `M1135 ${y}v22`; b += `M1124.5 ${y + 10}v16`; } return [a, b]; })();

    // far haze towers
    const far = [[556, 866, 72, 92], [604, 836, 92, 122], [1452, 790, 92, 140], [1556, 806, 104, 124], [1664, 846, 113, 90]]
      .map(b => blk(b[0], b[1], b[2], b[3], "#a39dc1", 16, 22, .12, .3)).join("") + flush();
    // CBD back row: tall glass tower with the blue crown, red-capped tower, long grey block, pink-brown tower
    let back = `<path d="M0 556Q6 520 30 512Q64 502 96 526V966H0Z" fill="#8a7985"/><rect x="72" y="524" width="24" height="442" fill="#76667a"/><rect x="62" y="516" width="34" height="34" fill="#4f9aa6" opacity=".8"/>`;
    lit(0, 560, 96, 406, 15, 19, .52, .1);
    back += `<ellipse cx="34" cy="506" rx="26" ry="9" fill="#5b8fd0"/><ellipse cx="34" cy="503" rx="19" ry="5" fill="#b2d6ff"/><path d="M34 497V468" stroke="#d3cbdc" stroke-width="3"/>`
      + blk(96, 712, 28, 254, "#66596c", 14, 20, .55, .1)
      + blk(120, 642, 100, 324, "#8f94b6", 17, 21, .45, .45, [.3, "#7a7fa2"]) + `<rect x="120" y="642" width="100" height="13" fill="#8e4546"/>`
      + blk(144, 809, 368, 160, "#675a62", 17, 22, .36, .08) + `<rect x="300" y="782" width="160" height="30" fill="#6a5d68"/><path d="${rows(144, 512, 830, 940, 22)}" stroke="#7d6e7a" stroke-width="3" opacity=".65"/>`
      + blk(306, 834, 100, 112, "#c9bac1", 14, 19, .28, .3) + `<path d="M326 836V946M346 836V946M366 836V946M386 836V946" stroke="#9a8d9a" stroke-width="3" opacity=".6"/>`
      + blk(506, 871, 66, 80, "#cdbdc2", 14, 19, .2, .3) + `<rect x="506" y="896" width="66" height="14" fill="#d65a50"/>`
      + blk(686, 718, 164, 240, "#a47e6b", 15, 21, .58, .06, [.24, "#8b665a"])
      + `<path d="M700 764V744Q724 724 748 744V764Z" fill="#8196bf"/><path d="M704 748Q724 732 744 748" stroke="#d9e6ff" stroke-width="3" fill="none"/><rect x="790" y="724" width="38" height="14" fill="#eceef6"/>`
      + blk(865, 746, 105, 160, "#6b5b66", 14, 20, .52, .08, [.3, "#5a4c58"]);
    back += flush("#ffd48c", "#c4e2ff", 5);
    // CBD middle row, either side of the tower
    let mid = blk(925, 798, 120, 118, "#7a6a74", 15, 20, .45, .08)
      + blk(1045, 788, 74, 130, "#a39096", 14, 20, .34, .3)
      + blk(1160, 735, 102, 185, "#565770", 15, 20, .5, .25, [.42, "#6b6a82"]) + `<rect x="1178" y="722" width="38" height="15" fill="#5c5d76"/>`
      + blk(1250, 815, 212, 104, "#9a98ab", 18, 21, .28, .2) + `<rect x="1250" y="811" width="212" height="6" fill="#cfcddd"/>`
      + blk(1460, 824, 62, 94, "#cbbfc6", 16, 21, .25, .2)
      + blk(1520, 816, 80, 102, "#9b6f66", 16, 21, .4, .06, [.3, "#845c55"])
      + blk(1600, 884, 177, 40, "#7a768c") + `<path d="M1636 894L1738 880L1777 898V908H1636Z" fill="#e8e8f2"/>`;
    mid += flush("#ffd48c", "#c4e2ff", 5);

    // THE SKY TOWER: red/white antenna, silver barrel, wide viewing deck, black glass band, floodlit concrete shaft
    const tower = `<circle cx="1138" cy="470" r="120" fill="url(#@hl)"/>`
      + `<rect x="1137.5" y="72" width="3" height="22" fill="#e8e2ec"/><circle cx="1139" cy="70" r="12" fill="#ff5a4a" opacity=".2"/><circle cx="1139" cy="70" r="4" fill="#ff4d4d"/>`
      + `<path d="M1137.5 92H1140.5L1143.5 112H1134.5Z" fill="#f1ecf4"/><rect x="1134.5" y="112" width="9" height="108" fill="#efe7ee"/><path d="M1137 112V220M1141 112V220" stroke="#c9c0d0" stroke-width="1" opacity=".7"/>`
      + `<path d="M1134.5 128H1143.5" stroke="#d94a4a" stroke-width="5"/><path d="M1134.5 176H1143.5M1134.5 194H1143.5" stroke="#d94a4a" stroke-width="7"/>`
      + `<rect x="1133.5" y="220" width="11" height="105" fill="#5a5668"/><path d="M1137 220V325M1141 220V325" stroke="#8f8aa3" stroke-width="1.4"/><path d="${rows(1133.5, 1144.5, 228, 318, 10)}" stroke="#7d7890" stroke-width="1" opacity=".6"/>`
      + `<rect x="1134" y="325" width="10" height="6" fill="#d6d1e0"/>`
      + `<path d="M1134 326Q1135 352 1110 363H1168Q1143 352 1144 326Z" fill="#b9aabf"/><path d="M1139 326H1144Q1143 352 1168 363H1139Z" fill="#d9c6cd"/>`
      + `<ellipse cx="1139" cy="364" rx="31" ry="5" fill="#e6d8d2"/><rect x="1110" y="364" width="58" height="14" fill="#3a3340"/><path d="${dots(1115, 9, 6, 368, 4, 5, .85, 40)}" fill="#f2b46a"/>`
      + `<path d="M1114 378H1164L1166 424H1112Z" fill="#a99bb0"/><path d="M1139 378H1164L1166 424H1139Z" fill="#cfb3c1"/><path d="${vl(1124, 10, 4, 380, 423)}M1113 398H1165M1112 411H1166" stroke="#6f6c86" stroke-width="1.6" opacity=".75" fill="none"/>`
      + `<path d="M1106 424H1170L1190 436H1086Z" fill="#41394b"/>`
      + `<path d="M1078 435Q1138 429 1198 435L1196 440Q1138 435 1080 440Z" fill="#d8c9b8"/>`
      + `<path d="M1080 438H1196L1190 447H1086Z" fill="#e9dccb"/><path d="M1086 447H1190" stroke="#4a4050" stroke-width="2"/>`
      + `<path d="M1092 447H1185L1183 462H1094Z" fill="#241c1c"/><path d="${dots(1098, 11, 8, 452, 6, 6, .85, 60)}" fill="#f2b46a"/>`
      + `<path d="M1092 460H1186L1176 468H1102Z" fill="#d9c7ad"/>`
      + `<path d="M1103 466H1175L1173 477H1105Z" fill="#4a3b31"/><path d="${dots(1109, 10, 6, 469, 5, 5, .85, 80)}" fill="#f2b46a"/>`
      + `<rect x="1107" y="477" width="65" height="10" fill="#8d746f"/><path d="${vl(1113, 9, 7, 477, 487)}" stroke="#cfb3a8" stroke-width="2"/>`
      + `<rect x="1108" y="487" width="62" height="7" fill="#9b8f9f"/><rect x="1109" y="494" width="60" height="26" fill="#1d1c2b"/><rect x="1160" y="494" width="9" height="26" fill="#4a4250"/>`
      + `<path d="M1109 520H1169L1167 562H1111Z" fill="url(#@pg)"/><path d="M1110 529H1168M1110 541H1168" stroke="#4b4560" stroke-width="1.6" opacity=".6"/>`
      + `<path d="M1113 560H1165L1158 640V840H1122V640Z" fill="url(#@sg)"/><path d="M1113 560H1165L1158 640V840H1122V640Z" fill="url(#@vg)"/>`
      + `<path d="${slots[0]}" stroke="#2b2124" stroke-width="4"/><path d="${slots[1]}" stroke="#4a3b34" stroke-width="3" opacity=".9"/>`;

    // front row: the block at the tower's foot, the brick Viaduct apartments with lamps, the lower buildings and offices
    let front = blk(1048, 826, 192, 92, "#c4bfcb", 18, 20, .3, .2) + `<rect x="1048" y="822" width="192" height="6" fill="#e6e0ea"/>`;
    front += flush("#ffd48c", "#c4e2ff", 5);
    const lampX = [842, 999, 1148, 1295, 1432, 1569, 1700];
    front += blk(780, 915, 326, 158, "#3b2a2b", 34, 30, .56, 0, null, .62) + blk(1106, 915, 46, 158, "#54494f") + blk(1152, 915, 625, 158, "#3d2926", 34, 30, .56, 0, null, .62)
      + `<rect x="780" y="913" width="997" height="9" fill="#6a5654"/>` + flush("#ffb25e", "#ffb25e", 9)
      + `<path d="${rows(780, 1777, 950, 1040, 30)}" stroke="#6e534d" stroke-width="4" opacity=".8"/>`
      + `<rect x="780" y="1068" width="997" height="10" fill="#dfc7bb"/>`
      + `<path d="${lampX.map(x => `M${x} 968V1070`).join("")}" stroke="#2a2128" stroke-width="4"/>`
      + lampX.map(x => `<circle cx="${x}" cy="1020" r="30" fill="url(#@lg)"/><rect x="${x - 6}" y="1004" width="12" height="30" rx="6" fill="#fff4d8"/>`).join("");
    front += `<rect x="0" y="1050" width="780" height="26" fill="#2b2733"/>`
      + blk(0, 956, 132, 122, "#7c7a92", 16, 22, .62, .1, null, .55) + `<rect x="0" y="948" width="132" height="10" fill="#b9b6c8"/>`
      + blk(135, 946, 392, 108, "#463f54", 20, 22, .8, .22, null, .6) + `<rect x="135" y="939" width="392" height="9" fill="#d2cbd6"/>`;
    front += flush("#ffd890", "#6fd6c8", 6)
      + `<g fill="#26332f"><ellipse cx="548" cy="1042" rx="36" ry="30"/><ellipse cx="614" cy="1036" rx="30" ry="28"/><ellipse cx="682" cy="1048" rx="34" ry="28"/><ellipse cx="758" cy="1040" rx="36" ry="30"/></g>`
      + [[546, 1014], [662, 1030], [486, 1010]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="26" fill="url(#@lg)"/><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="#fff0c4"/>`).join("");

    // water, the golden light streaks, ripples
    const st = (cx, y1, y2, w) => `M${R(cx - w / 2)} ${y1}H${R(cx + w / 2)}L${R(cx + w * .3)} ${y2}H${R(cx - w * .3)}Z`;
    const streaks = [[283, 1146, 1300, 24], [333, 1146, 1282, 16], [532, 1150, 1296, 34], [566, 1150, 1230, 14], [686, 1160, 1252, 18], [850, 1150, 1312, 36], [1006, 1140, 1330, 40], [1062, 1146, 1240, 14], [1440, 1146, 1262, 24], [1580, 1146, 1240, 18], [60, 1150, 1250, 12], [236, 1146, 1210, 12]];
    let sd = "", hd = "", rp = "";
    streaks.forEach(([x, y1, y2, w]) => {
      sd += st(x, y1, y2, w * .8) + st(x - w, y1 + 8, R(y1 + (y2 - y1) * .55), w * .3) + st(x + w * .95, y1 + 8, R(y1 + (y2 - y1) * .42), w * .25); hd += st(x, y1, R(y2 + 14), w * 1.7);
      [.32, .62].forEach(f => { const yy = R(y1 + (y2 - y1) * f); rp += `M${R(x - w * .9)} ${yy}h${R(w * 1.8)}`; });
    });
    const water = `<rect x="0" y="1074" width="1777" height="330" fill="url(#@sea)"/><path d="${hd}" fill="url(#@rf)" opacity=".3"/><path d="${sd}" fill="url(#@rf)"/><path d="${rp}" stroke="#25405f" stroke-width="3" opacity=".45"/>`
      + `<path d="M20 1250h150M240 1310h200M600 1280h180M900 1300h220M1250 1250h200M1500 1300h200M120 1170h120M1100 1190h160" stroke="#9fc4ee" stroke-width="3" opacity=".2" stroke-linecap="round"/>`;

    // marina: crane and tug, the tall ship, white yachts, masts, pontoons
    const yacht = (x, y, w, h, cab, gl) => {
      const hy = R(y + h * .44), X = k => R(x + w * k), Y = k => R(y + h * k);
      return `<path d="M${x} ${hy}H${x + w}L${X(.95)} ${y + h}H${X(.05)}Z" fill="#e6e3f0"/>`
        + `<path d="M${X(.03)} ${Y(.82)}H${X(.97)}L${X(.95)} ${y + h}H${X(.05)}Z" fill="#aeb2d2"/>`
        + `<path d="M${X(.17)} ${hy}L${X(.27)} ${Y(.12)}H${X(.74)}L${X(.84)} ${hy}Z" fill="${cab || "#f3f1f9"}"/>`
        + `<path d="M${X(.26)} ${Y(.22)}H${X(.72)}L${X(.78)} ${Y(.38)}H${X(.2)}Z" fill="${gl || "#39466a"}"/>`;
    };
    const marina = `<path d="M703 1094L630 938" stroke="#33384a" stroke-width="9" stroke-linecap="round"/><path d="M714 1092L650 962M690 1020L722 1010" stroke="#33384a" stroke-width="4"/>`
      + `<path d="M700 1128H846L836 1160H714Z" fill="#102d5f"/><rect x="740" y="1098" width="72" height="32" fill="#1b9a8f"/><rect x="760" y="1138" width="50" height="8" fill="#dfe6f4"/>`
      + `<path d="M0 1130H160M556 1130H992" stroke="#262a45" stroke-width="12"/>`
      + `<path d="M200 1112H425L408 1142H222Z" fill="#e6dfe0"/><path d="M200 1112H425V1120H203Z" fill="#9a6b45"/><rect x="262" y="1092" width="120" height="22" fill="#b07f55"/>`
      + `<path d="M259 898V1112M340 898V1112" stroke="#8f5a3c" stroke-width="7"/><path d="M236 960H284M312 960H370" stroke="#8f5a3c" stroke-width="4"/><path d="M259 900L205 1112M259 900L330 1112M340 900L425 1112" stroke="#6b4a40" stroke-width="2" opacity=".7"/>`
      + yacht(-8, 1068, 198, 72, "#f4f2fa")
      + yacht(790, 1076, 90, 62) + yacht(868, 1068, 102, 68) + yacht(984, 1060, 112, 74)
      + yacht(1088, 1052, 134, 80, "#b4c0e0", "#2e3b5e") + yacht(1206, 1074, 72, 56)
      + yacht(1388, 1062, 150, 68, "#6d83c4", "#2a3a68") + yacht(1536, 1084, 92, 48)
      + yacht(1618, 1054, 106, 64) + yacht(1712, 1060, 72, 54)
      + `<path d="M603 890V1128M1010 984V1110M1298 1004V1080" stroke="#3f3a52" stroke-width="4"/>`;

    // foreground: mooring piles with pale caps, the tidal-steps sign, and the big white yacht in the corner
    const bol = (x, y, w) => `<path d="M${x} 1345V${y + 16}Q${x} ${y - 6} ${x + w / 2} ${y - 6}Q${x + w} ${y - 6} ${x + w} ${y + 16}V1345Z" fill="#061224"/><path d="M${x + 1} ${y + 15}Q${x + 1} ${y - 4} ${x + w / 2} ${y - 4}Q${x + w - 1} ${y - 4} ${x + w - 1} ${y + 15}Z" fill="#c9cce6"/><rect x="${x}" y="${y + 15}" width="${w}" height="4" fill="#0b1a30"/><rect x="${x + 3}" y="${y + 22}" width="3" height="200" fill="#22324e" opacity=".8"/>`;
    const fore = `<path d="M1190 1236Q1196 1218 1300 1208L1777 1170V1345H1330Q1232 1300 1190 1236Z" fill="#e6e4f1"/><path d="M1340 1190L1480 1168L1777 1122V1160L1352 1214Z" fill="#232a44"/><path d="M1286 1196Q1330 1176 1440 1168V1214L1296 1226Z" fill="#f4f3fa"/>`
      + bol(372, 1130, 28) + bol(472, 1124, 28) + bol(1128, 1134, 38) + bol(1250, 1100, 26) + bol(1278, 1106, 22)
      + `<rect x="1130" y="1166" width="34" height="62" fill="#f1f1f6"/><rect x="1130" y="1166" width="34" height="9" fill="#c0392b"/><path d="M1138 1184H1156M1138 1194H1156M1138 1204H1150" stroke="#222" stroke-width="3"/><path d="M1147 1210V1222M1141 1216L1147 1223L1153 1216" stroke="#222" stroke-width="3" fill="none"/>`;

    const body = `<circle cx="540" cy="205" r="4" fill="#f1eaff" opacity=".7"/>` + far + back + mid + tower + front + water + marina + fore;
    return g => `<g transform="translate(.6 7.4) scale(.07)">${body.replace(/@(\w+)/g, (m, k) => g[k])}</g>`;
  })();
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
    castleday: (ctx) => {
      const g = ctx.id("cd"); ctx.defs += `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb8ff"/><stop offset="1" stop-color="#dff2ff"/></linearGradient>`;
      const teeth = (x0, x1, y, w, gap, h, col) => { let s = ""; for (let x = x0; x + w <= x1 + .01; x += w + gap) s += `<rect x="${x.toFixed(1)}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`; return s; };
      const win = (x, y) => `<path d="M${x} ${y + 3.6} V${y + 1.2} Q${x + 1.1} ${y - .6} ${x + 2.2} ${y + 1.2} V${y + 3.6}Z" fill="#4a4570"/>`;
      return `<rect width="100" height="100" fill="url(#${g})"/>` +
        `<circle cx="20" cy="20" r="11" fill="#fff6c2" opacity=".35"/><circle cx="20" cy="20" r="6.4" fill="#ffe27a"/>` +
        `<g fill="#fff"><ellipse cx="60" cy="14" rx="9" ry="3.4" opacity=".95"/><ellipse cx="66" cy="11.6" rx="6" ry="3.4" opacity=".95"/><ellipse cx="86" cy="26" rx="7" ry="2.6" opacity=".9"/><ellipse cx="90" cy="24" rx="4.4" ry="2.6" opacity=".9"/><ellipse cx="10" cy="44" rx="6" ry="2.2" opacity=".8"/></g>` +
        `<path d="M0 66 L14 54 L28 63 L44 49 L58 63 L72 52 L86 62 L100 52 V100 H0Z" fill="#a7b9e0" opacity=".65"/>` +
        `<path d="M44 80 Q70 62 100 66 V100 H44Z" fill="#6cbf6a"/>` +
        `<rect x="64" y="58" width="36" height="12" fill="#d9d3e8"/>` + teeth(64, 100, 55.4, 3, 2.6, 2.7, "#d9d3e8") +
        `<rect x="73" y="35" width="11" height="33" fill="#e6e1f1"/><rect x="73" y="35" width="3.6" height="33" fill="#cfc8e2"/><rect x="71.6" y="32" width="13.8" height="3.4" fill="#e6e1f1"/>` + teeth(71.6, 85.4, 29.6, 3.2, 1.9, 2.5, "#e6e1f1") +
        `<rect x="86" y="42" width="8" height="26" fill="#dcd6ec"/><path d="M84.6 42.4 L90 29 L95.4 42.4Z" fill="#d9534f"/><path d="M90 29 V22.4" stroke="#8a7f9c" stroke-width=".9"/><path d="M90 22.4 L85 24 L90 25.6Z" fill="#e5484d"/>` +
        win(77, 41) + win(77, 51) + win(89, 48) + `<path d="M66.4 70 V64.6 Q69 61.8 71.6 64.6 V70Z" fill="#6a5f86"/>` +
        `<path d="M0 74 Q20 64 42 77 V100 H0Z" fill="#59ad5c"/>` +
        `<path d="M8.5 76 L12.4 64 L16.3 76Z M6.4 81 L12.4 68 L18.4 81Z M21 79 L24 70 L27 79Z" fill="#2f8a4a"/><path d="M12.4 81 V84 M24 79 V82" stroke="#6b4a2a" stroke-width="1.6"/>`;
    },
    beach: () => `<rect width="100" height="100" fill="#bfe6ff"/><circle cx="80" cy="20" r="10" fill="#ffd23f"/><rect y="58" width="100" height="18" fill="#3fb6e8"/><path d="M0 74 Q12 68 25 74 T50 74 T75 74 T100 74 V80 H0Z" fill="#fff" opacity=".5"/><rect y="78" width="100" height="22" fill="#f4d9a0"/>`,
    disco: (ctx) => { const i = ctx.id("dc"); ctx.defs += `<radialGradient id="${i}" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#ff8ad8"/><stop offset="1" stop-color="#5b2fc9"/></radialGradient>`; let d = ""; for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 14 + (k % 4) * 11; d += `<circle cx="${50 + Math.cos(a) * r}" cy="${50 + Math.sin(a) * r}" r="${2 + k % 3}" fill="${["#fff", "#ffe14d", "#4dffea", "#ff7aa8"][k % 4]}" opacity=".7"/>`; } return `<rect width="100" height="100" fill="url(#${i})"/>${d}`; },
    lava: (ctx) => { const i = ctx.id("lv"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b0d0d"/><stop offset=".6" stop-color="#d9381e"/><stop offset="1" stop-color="#ffb02e"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/>${stars([[18, 72, 3], [80, 78, 4], [60, 90, 2.6], [30, 90, 2], [90, 60, 2]], "#ffd36a")}`; },
    snow: () => `<rect width="100" height="100" fill="#dceeff"/><path d="M0 82 Q25 70 50 80 T100 76 V100 H0Z" fill="#fff"/>${stars([[14, 16, 1.6], [30, 30, 1.2], [60, 12, 1.6], [84, 24, 1.3], [70, 44, 1], [10, 50, 1.2], [92, 56, 1.5]])}`,
    checker: () => `<rect width="100" height="100" fill="#fff"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(r => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(c => (r + c) % 2 === 0).map(c => `<rect x="${c * 10}" y="${r * 10}" width="10" height="10" fill="#ff8fb3"/>`).join("")).join("")}`,
    city: (ctx) => { const i = ctx.id("ct"), gl = ctx.id("cg"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2468"/><stop offset=".42" stop-color="#6a4a9e"/><stop offset=".72" stop-color="#ff9a8b"/><stop offset="1" stop-color="#ffd3a4"/></linearGradient><radialGradient id="${gl}"><stop offset="0" stop-color="#ffd7a0" stop-opacity=".75"/><stop offset="1" stop-color="#ffb08a" stop-opacity="0"/></radialGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/>${stars([[20, 12, .7], [46, 7, .6], [78, 14, .7], [10, 30, .55], [90, 36, .6]], "#fff6e0")}<ellipse cx="50" cy="66" rx="58" ry="24" fill="url(#${gl})"/>${CITY.svg}`; },
    candy: () => `<rect width="100" height="100" fill="#fff"/>${[-20, 0, 20, 40, 60, 80, 100].map((x, i) => `<path d="M${x} 0 L${x + 14} 0 L${x - 26} 100 L${x - 40} 100Z" fill="${i % 2 ? "#ff7aa8" : "#7ad7ff"}"/>`).join("")}`,
    auckland: (ctx) => {
      // Blue-hour Auckland: Sky Tower over the lit CBD, Viaduct apartments, marina and gold harbour reflections (see AKL).
      const g = { sk: ctx.id("ak"), sea: ctx.id("as"), rf: ctx.id("ar"), hl: ctx.id("ah"), lg: ctx.id("al"), pg: ctx.id("ap"), sg: ctx.id("aq"), vg: ctx.id("av") };
      ctx.defs += `<linearGradient id="${g.sk}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#667db4"/><stop offset=".08" stop-color="#6b81b7"/><stop offset=".28" stop-color="#8293c6"/><stop offset=".49" stop-color="#979fc9"/><stop offset=".62" stop-color="#aeafcd"/><stop offset=".72" stop-color="#bdb9d0"/><stop offset="1" stop-color="#bdb9d0"/></linearGradient>`
        + `<linearGradient id="${g.sea}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22364f"/><stop offset=".2" stop-color="#35567a"/><stop offset=".4" stop-color="#4b6d98"/><stop offset=".6" stop-color="#455f88"/><stop offset="1" stop-color="#2f4565"/></linearGradient>`
        + `<linearGradient id="${g.rf}" gradientUnits="userSpaceOnUse" x1="0" y1="1120" x2="0" y2="1340"><stop offset="0" stop-color="#fff0b4" stop-opacity=".95"/><stop offset=".35" stop-color="#f7c872" stop-opacity=".7"/><stop offset="1" stop-color="#e0a050" stop-opacity=".1"/></linearGradient>`
        + `<radialGradient id="${g.hl}"><stop offset="0" stop-color="#ffe9b8" stop-opacity=".2"/><stop offset=".5" stop-color="#ffd9a0" stop-opacity=".06"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>`
        + `<radialGradient id="${g.lg}"><stop offset="0" stop-color="#fff3cf" stop-opacity=".8"/><stop offset=".4" stop-color="#ffe2a0" stop-opacity=".3"/><stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/></radialGradient>`
        + `<linearGradient id="${g.pg}" gradientUnits="userSpaceOnUse" x1="1110" y1="0" x2="1168" y2="0"><stop offset="0" stop-color="#4d5069"/><stop offset=".35" stop-color="#7f7488"/><stop offset=".62" stop-color="#b7a0a9"/><stop offset=".85" stop-color="#f1cbc6"/><stop offset="1" stop-color="#e3bebc"/></linearGradient>`
        + `<linearGradient id="${g.sg}" gradientUnits="userSpaceOnUse" x1="1122" y1="0" x2="1158" y2="0"><stop offset="0" stop-color="#b8a08c"/><stop offset=".3" stop-color="#d4bca6"/><stop offset=".5" stop-color="#e4c7ab"/><stop offset=".75" stop-color="#f4d9bd"/><stop offset="1" stop-color="#f8e6d0"/></linearGradient>`
        + `<linearGradient id="${g.vg}" gradientUnits="userSpaceOnUse" x1="0" y1="560" x2="0" y2="840"><stop offset="0" stop-color="#5a4a48" stop-opacity=".25"/><stop offset=".28" stop-color="#5a4a48" stop-opacity=".08"/><stop offset=".42" stop-color="#fff4e0" stop-opacity="0"/><stop offset="1" stop-color="#fff4e0" stop-opacity=".62"/></linearGradient>`;
      return `<rect width="100" height="100" fill="url(#${g.sk})"/>` + AKL(g);
    },
    synth: (ctx) => { const i = ctx.id("sy"); ctx.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f5c"/><stop offset=".6" stop-color="#ff3d9a"/><stop offset="1" stop-color="#ffd23f"/></linearGradient>`; return `<rect width="100" height="100" fill="url(#${i})"/><circle cx="50" cy="56" r="22" fill="#ffd23f" opacity=".9"/><rect y="62" width="100" height="40" fill="#1a0a3c"/>${[0, 1, 2, 3, 4, 5, 6].map(k => `<path d="M${50 + (k - 3) * 6} 62 L${50 + (k - 3) * 26} 100" stroke="#ff3d9a" stroke-width=".8"/>`).join("")}${[68, 76, 86, 98].map(y => `<path d="M0 ${y} H100" stroke="#ff3d9a" stroke-width=".8"/>`).join("")}`; }
  };
  const BG_LIST = [["sky", "Sky blue", 0], ["mint", "Mint", 0], ["blush", "Blush", 0], ["lemon", "Lemon", 0], ["candy", "Candy stripes", 1], ["checker", "Pink checks", 1], ["snow", "Snowy", 1], ["forest", "Forest", 1], ["beach", "Beach day", 1], ["ocean", "Deep sea", 2], ["sunset", "Sunset", 2], ["night", "Starry night", 2], ["city", "City dusk", 3], ["auckland", "Auckland & Sky Tower", 4], ["castleday", "Castle by day", 3], ["castle", "Castle at dusk", 3], ["lava", "Lava", 3], ["disco", "Disco", 3], ["galaxy", "Galaxy", 4], ["synth", "Synthwave", 4]];

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
    flames: () => {
      const tongue = (cx, w, h, lean) => `M${cx - w} 101 C${cx - w} ${101 - h * .38} ${cx - w * .25 + lean * .3} ${101 - h * .6} ${cx + lean} ${101 - h} C${cx + w * .05 + lean * .5} ${101 - h * .55} ${cx + w} ${101 - h * .34} ${cx + w} 101Z`;
      const row = (list, fill, op) => list.map(t => `<path d="${tongue(t[0], t[1], t[2], t[3])}" fill="${fill}"${op ? ` opacity="${op}"` : ""}/>`).join("");
      return row([[6, 9, 24, 3], [22, 10, 32, -4], [38, 10, 26, 4], [54, 11, 36, -3], [70, 10, 28, 4], [86, 11, 34, -4], [98, 8, 22, -2]], "#e5361b") +
        row([[14, 9, 22, -3], [30, 9, 26, 3], [46, 10, 30, -3], [62, 10, 25, 4], [78, 9, 28, -3], [92, 8, 20, 3]], "#ff7a1a") +
        row([[6, 6, 14, 2], [22, 7, 21, -3], [38, 7, 16, 3], [54, 8, 24, -2], [70, 7, 17, 3], [86, 8, 22, -3]], "#ffb62e") +
        row([[22, 3.6, 11, -2], [54, 4, 13, -1], [86, 4, 12, -2], [38, 3.4, 8, 2], [70, 3.4, 9, 2]], "#fff1a8") +
        `<circle cx="14" cy="64" r="1.1" fill="#ffb62e"/><circle cx="31" cy="58" r=".9" fill="#ff7a1a"/><circle cx="47" cy="63" r="1" fill="#ffd54a"/><circle cx="66" cy="57" r="1.1" fill="#ffb62e"/><circle cx="84" cy="62" r=".9" fill="#ff7a1a"/><circle cx="93" cy="55" r=".8" fill="#ffd54a"/>`;
    },
    glow: (ctx) => { const i = ctx.id("gl"); ctx.defs += `<radialGradient id="${i}" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#ffe27a" stop-opacity="0"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".85"/></radialGradient>`; return `<circle cx="50" cy="50" r="50" fill="url(#${i})"/>`; }
  };
  const FX_LIST = [["none", "None", 0], ["sparkles", "Sparkles", 1], ["hearts", "Floating hearts", 1], ["bubbles", "Bubbles", 1], ["snowfall", "Snowfall", 1], ["notes", "Music notes", 2], ["confetti", "Confetti", 2],
    ["lightning", "Lightning", 3], ["glow", "Golden glow", 3], ["flames", "Flames", 4]];

  /* ------------------------------ costumes ------------------------------ */
  const NINJA_WRAP = "M50 19 C63 19 74.4 28 74.4 44 C74.4 56 68 64 60 68 L67 78 Q50 91 33 78 L40 68 C32 64 25.6 56 25.6 44 C25.6 28 37 19 50 19Z";
  const NINJA_WINDOW = "M31 43.2 Q31 37.6 37 37.6 H63 Q69 37.6 69 43.2 V47 Q69 51.4 63 51.4 H37 Q31 51.4 31 47Z";
  // Adventurer Mage: shared geometry keeps cloth and rarity effects aligned.
  const MAGE_HOOD = "M24 71 C17 59 19 37 29 23 C35 14 42 8.5 49 8.5 C57 8.5 64 14 69 20 L78 28 Q80 32 74 32 L71 31 C80 47 81 61 76 71 Q63 79 50 77 Q37 79 24 71Z";
  const MAGE_OPENING = "M50 25.5 C39 25.5 30 32.5 28.5 43 C27 55 34 65 42 68 Q50 72 58 68 C66 65 73 55 71.5 43 C70 32.5 61 25.5 50 25.5Z";
  const MAGE_RING = MAGE_HOOD + " " + MAGE_OPENING;
  const COSTUMES = {
    ninja: (x) => ({
      hide: { hair: 1, hat: 1, top: 1 }, eyesOnTop: 1,
      body: topShape("#2f2f3a", `<path d="M8 90.4 H92" stroke="#e5484d" stroke-width="4.6"/><path d="M50 79 V100" stroke="#23232b" stroke-width="1.4"/>`, x),
      front: `<path fill-rule="evenodd" d="${NINJA_WRAP} ${NINJA_WINDOW}" fill="#23232b"/>` +
        x.clip(NINJA_WRAP, `<path d="M20 31.6 Q50 24 80 31.6 L80 37.2 Q50 29.6 20 37.2Z" fill="#e5484d"/>`) +
        `<path d="M71 31.4 C76.6 29.6 82.4 31.6 84.6 37 C81 35.2 78 35.6 75.6 37.4 C78.6 40.2 79.8 43.8 79.4 47.4 C76.6 43.8 74.4 41.6 71 40.2Z" fill="#e5484d"/>`
    }),
    wizard: (x) => {
      // Flat, compact SVG clothing, not a raster illustration. All torso details
      // share BODY clipping; the open hood never paints over the face.
      const cloth = "#39315f", deep = "#211d38", light = "#51447c";
      const gold = "#d5ad62", goldHi = "#f0d69a", leather = "#79533c";
      const capeL = "M38 74 Q27 76 17 86 L13 100 H35 L47 81Z";
      const capeR = "M62 74 Q73 76 83 86 L87 100 H65 L53 81Z";
      const ring = `<path d="${MAGE_RING}" fill="${cloth}" fill-rule="evenodd" stroke="${deep}" stroke-width=".9" stroke-linejoin="round"/>`;
      const hood = ring + x.clip(`<path d="${MAGE_RING}" clip-rule="evenodd"/>`,
        `<path d="M49 8.5 Q32 30 26 55 Q23 66 27 74 L16 75 V4Z" fill="${light}"/>`
        + `<path d="M51 8.5 Q65 24 69 37 Q78 56 72 74 L85 74 V5Z" fill="${deep}" opacity=".42"/>`
        + `<path d="M49 10 Q43 16 40 25 M69 21 L76 28 L71 28 M24 55 Q23 65 28 70 M76 54 Q78 65 73 70" fill="none" stroke="${light}" stroke-width=".8" stroke-linecap="round"/>`)
        + `<path d="${MAGE_OPENING}" fill="none" stroke="${gold}" stroke-width="1.25"/>`
        + `<path d="M31 35 Q37 27.5 47 26.5 M29 48 Q29 58 35 63" fill="none" stroke="${goldHi}" stroke-width=".45" stroke-linecap="round"/>`
        + `<path d="M50 11 L53.3 16.5 L50 22 L46.7 16.5Z" fill="${gold}" stroke="${deep}" stroke-width=".6"/>`
        + `<path d="M50 12.8 L52 16.5 L50 20.2 L48 16.5Z" fill="#a58adf"/><path d="M50 12.8 V20.2 L48 16.5Z" fill="#d4baff"/>`;
      const cape = x.body(`<path d="${capeL}" fill="${cloth}"/><path d="${capeR}" fill="${cloth}"/>`
        + `<path d="M36 78 Q26 83 22 100 M64 78 Q74 83 78 100" fill="none" stroke="${light}" stroke-width="2"/>`
        + `<path d="M18 87 L34 83 L43 78 M82 87 L66 83 L57 78 M34 85 L29 100 M66 85 L71 100" fill="none" stroke="${gold}" stroke-width="1.15" stroke-linejoin="round"/>`
        + `<path d="M25 93 L27 90 L29 93 L27 96Z M71 93 L73 90 L75 93 L73 96Z" fill="${gold}" opacity=".75"/>`);
      const gear = x.body(
        `<path d="M62 78 L67 80 L44 102 L37 102Z" fill="${leather}" stroke="#493326" stroke-width=".7"/>`
        + `<path d="M63 80 L41 101" fill="none" stroke="#b68a5a" stroke-width=".5"/>`
        + `<g transform="translate(53 90) rotate(-46)"><rect x="-3.1" y="-3.6" width="6.2" height="7.2" rx=".8" fill="${gold}" stroke="#785d32" stroke-width=".5"/><rect x="-1.9" y="-2.3" width="3.8" height="4.6" rx=".3" fill="${leather}"/><path d="M-2.2 0 H2.4" stroke="${goldHi}" stroke-width=".65"/></g>`
        + `<path d="M32 94 H45 V100 H32Z" fill="#60412f" stroke="#392b24" stroke-width=".65"/><path d="M31.5 94 Q38.5 91.8 45.5 94 L44 97 H33Z" fill="#906747" stroke="#493326" stroke-width=".6"/><rect x="37.4" y="94.5" width="2.2" height="3.2" rx=".5" fill="${gold}"/>`
        + `<path d="M62 90 V93 M67 90 V93" stroke="#493326" stroke-width="1.3"/><path d="M62 92 H67 V94 L68 95 V99 Q64.5 101 61 99 V95 L62 94Z" fill="#b8a3e5" stroke="#3a2d56" stroke-width=".65"/><path d="M61.7 96 Q64.5 95.2 67.3 96 V98.7 Q64.5 100 61.7 98.7Z" fill="#8061c1"/><rect x="62" y="91.4" width="5" height="1.5" rx=".35" fill="#b58a57"/><path d="M62.6 94.7 V97.8" stroke="#e7dcff" stroke-width=".6" stroke-linecap="round"/>`);
      return {
        hide: { hair: 1, hat: 1, top: 1 },
        back: `<path d="${MAGE_HOOD}" fill="${deep}"/>`,
        body: topShape("#2b293c", `<path d="M43 77 L50 83 L57 77 V100 H43Z" fill="#343044"/><path d="M50 84 V100 M39 88 L36 100 M61 88 L64 100" stroke="#1e1c2c" stroke-width=".8" fill="none"/>`, x),
        over: cape + gear,
        front: hood
          + `<path d="M29 68 Q39 71 50 74 Q61 71 71 68 L73 74 Q64 81 50 82 Q36 81 27 74Z" fill="${light}" stroke="${deep}" stroke-width=".8" stroke-linejoin="round"/>`
          + `<path d="M30 73 Q39 78 47 78 M53 78 Q61 78 70 73" stroke="${gold}" stroke-width="1" fill="none" stroke-linecap="round"/>`
          + `<path d="M33 71 Q40 75 46 75 M54 75 Q60 75 67 71" stroke="#756397" stroke-width=".7" fill="none"/>`
          + `<circle cx="50" cy="77.5" r="4.1" fill="${gold}" stroke="#765b32" stroke-width=".7"/><circle cx="50" cy="77.5" r="2.8" fill="#7250ad" stroke="${deep}" stroke-width=".5"/><path d="M50 75.2 L51.7 77.5 L50 79.8 L48.3 77.5Z" fill="#b99ae8"/><path d="M50 75.2 L48.3 77.5 L50 78Z" fill="#e4d2ff"/>`
      };
    },
    shark: (x) => ({
      hide: { hair: 1, hat: 1, top: 1 },
      body: topShape("#5f81a8", `<path d="M34 100 Q34 88 50 85.6 Q66 88 66 100Z" fill="#eaf2fa"/>`, x),
      front: `<path d="M38 18 Q43 -1 64 14.4Z" fill="#587aa0"/><path fill-rule="evenodd" d="M19 45 a31 33 0 1 0 62 0 a31 33 0 1 0 -62 0Z M31 44.6 a19 20.6 0 1 0 38 0 a19 20.6 0 1 0 -38 0Z" fill="#6d8fb5"/>` +
        [[38, 28.8], [44, 25.2], [50, 24], [56, 25.2], [62, 28.8]].map(p => `<path d="M${p[0] - 2.6} ${p[1] - 1} L${p[0] + 2.6} ${p[1] - 1} L${p[0]} ${p[1] + 4.8}Z" fill="#fff" stroke="#c9d6e6" stroke-width=".8" stroke-linejoin="round"/>`).join("") +
        `<circle cx="36" cy="19" r="2.8" fill="#fff"/><circle cx="64" cy="19" r="2.8" fill="#fff"/><circle cx="36.3" cy="19.2" r="1.3" fill="${INK}"/><circle cx="63.7" cy="19.2" r="1.3" fill="${INK}"/><path d="M24 40 Q21 51 29 61 M76 40 Q79 51 71 61" fill="none" stroke="#496e96" stroke-width="1.2"/><path d="M24 43 l4 1 M24 48 l4 1 M76 43 l-4 1 M76 48 l-4 1" stroke="#3e5f83" stroke-width=".8"/><path d="M34 67 Q50 79 66 67" stroke="#a6bfd6" stroke-width="1.4" fill="none"/>`,
      over: `<path d="M42 81 L42 91 M58 81 L58 91" stroke="#dce8f2" stroke-width="1" stroke-linecap="round"/><path d="M38 97 Q50 91 62 97" stroke="#496e96" stroke-width=".8" fill="none"/>`
    }),
    ghost: () => ({
      hide: { hair: 1, hat: 1, top: 1, face: 1, head: 1, extra: 1 }, body: "",
      front: `<g transform="translate(9 13) scale(.82)"><path d="M14 100 C10 50 18 10 50 8 C82 10 90 50 86 100 L78 92 L70 100 L62 92 L54 100 L46 92 L38 100 L30 92 L22 100Z" fill="#fafbff" stroke="#d6dbea" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="38" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="62" cy="42" rx="5" ry="7.4" fill="#1d1d24"/><ellipse cx="50" cy="58" rx="4" ry="5.4" fill="#1d1d24"/><ellipse cx="29" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/><ellipse cx="71" cy="54" rx="4" ry="2.4" fill="#ffb4c8" opacity=".7"/></g>`
    })
  };
  const COSTUME_LIST = [["none", "No costume", 0], ["ghost", "Friendly ghost", 3], ["ninja", "Ninja", 3], ["shark", "Shark hoodie", 3], ["wizard", "Mage", 4]];

  /* ------------------------------ eyebrows ------------------------------ */
  // "natural" is the original pair of simple strokes (so existing avatars don't change). The
  // rest are tapered brow shapes: [outerX, outerY, ctrlX, ctrlY, innerX, innerY, thickness],
  // written for the left brow and mirrored for the right; thickness follows the body type.
  const browShape = (b, col, k) => {
    const [x0, y0, cx, cy, x1, y1, t] = b, h = t * k;
    return `<path d="M${x0} ${y0} Q${cx} ${(cy - h).toFixed(2)} ${x1} ${y1} Q${cx} ${(cy + h).toFixed(2)} ${x0} ${y0}Z" fill="${col}" stroke="${col}" stroke-width=".7" stroke-linejoin="round" opacity=".92"/>`;
  };
  const mirrorBrow = b => [100 - b[0], b[1], 100 - b[2], b[3], 100 - b[4], b[5], b[6]];
  // Tapered brow silhouettes, rather than inflated lens-shaped blobs.
  const polishedBrow=(b,col,k)=>{const [a,y,cx,cy,z,v,t]=b,w=Math.min(2.6,t*.53*k);return `<path d="M${a} ${y} Q${cx} ${cy-w} ${z} ${v} L${z} ${v+w*.7} Q${cx} ${cy+w*.25} ${a} ${y+.45}Z" fill="${col}"/>`;};
  const browDefs={thick:[35.2,39.3,40.5,37,45.7,38.3,3.8],thin:[36,39,41,36.4,45.5,38,1.2],arched:[35.8,40,40,34.6,45.6,38,2.3],flat:[35.5,38.7,40.5,38.1,45.7,38.5,2.5],raised:[36,36.7,41,33.4,45.6,35.6,2.1],worried:[35.8,40.3,40.5,37.5,45.6,35.7,2.3],angry:[35.5,36.4,40.6,37.6,45.7,40,3]};
  const polishedPair = b => (col, gd) => polishedBrow(b, col, gd.brow / 1.7) + polishedBrow(mirrorBrow(b), col, gd.brow / 1.7);
  const BROWS = {
    natural: (col,gd)=>polishedBrow([35.8,39,40,36.8,45.5,38,2],col,gd.brow/1.7)+polishedBrow([64.2,39,60,36.8,54.5,38,2],col,gd.brow/1.7),
    thick: polishedPair(browDefs.thick),
    thin: polishedPair(browDefs.thin),
    arched: polishedPair(browDefs.arched),
    flat: polishedPair(browDefs.flat),
    raised: polishedPair(browDefs.raised),
    worried: polishedPair(browDefs.worried),
    angry: polishedPair(browDefs.angry),
    skeptical: (col,gd)=>polishedBrow([35.8,39.7,41,38.5,45.7,39.6,2.6],col,gd.brow/1.7)+polishedBrow([64.2,36.8,59,33.1,54.4,35.8,2.3],col,gd.brow/1.7)
  };

  const BROW_LIST = [["natural", "Natural", 0], ["thick", "Thick", 0], ["thin", "Thin", 0], ["arched", "Arched", 1], ["flat", "Flat", 1], ["raised", "Raised", 1], ["worried", "Worried", 1], ["angry", "Angry", 2], ["skeptical", "One raised", 2]];

  /* ------------------------------ pets ---------------------------------- */
  // Pets perch on a shoulder and look at their person. Each is drawn around a perch point at (0,0), feet on y=0:
  // the kiwi, rabbit and cat stand on the right shoulder facing left; the tui and kea on the left shoulder facing right.
  // A = animation hooks: A.body wraps the body (breathing), A.head wraps the head around its neck pivot
  // (tilt), A.lid adds a blink overlay (pass any extra eyes as a 6th argument). They are plain pass-throughs unless the pet is animating.
  const PA0 = { body: s => s, head: s => s, lid: () => "" };
  const prn = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const pStops = st => st.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] == null ? "" : ` stop-opacity="${s[2]}"`}/>`).join("");
  const pLin = (id, x1, y1, x2, y2, st) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${pStops(st)}</linearGradient>`;
  const pRad = (id, cx, cy, r, st) => `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${pStops(st)}</radialGradient>`;
  const pSt = (d, c, w, o) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"${o == null ? "" : ` opacity="${o}"`}/>`;
  const pFill = (d, f, o) => `<path d="${d}" fill="${f}"${o == null ? "" : ` opacity="${o}"`}/>`;
  // a tapered toe from (x0,y0) at angle deg for len, width w0 -> w1, with a rounded tip
  const pToe = (x0, y0, deg, len, w0, w1) => {
    const a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, x1 = x0 + dx * len, y1 = y0 + dy * len, f = v => v.toFixed(2);
    return `M${f(x0 + nx * w0 / 2)} ${f(y0 + ny * w0 / 2)} L${f(x1 + nx * w1 / 2)} ${f(y1 + ny * w1 / 2)} A${f(w1 / 2)} ${f(w1 / 2)} 0 0 0 ${f(x1 - nx * w1 / 2)} ${f(y1 - ny * w1 / 2)} L${f(x0 - nx * w0 / 2)} ${f(y0 - ny * w0 / 2)}Z`;
  };
  // rows of small overlapping scale arcs (feather texture)
  const pScales = (x0, x1, y0, rows, dx, dy) => { let d = ""; for (let r = 0; r < rows; r++) for (let xx = x0 + (r % 2) * dx / 2; xx < x1; xx += dx) d += `M${xx.toFixed(2)} ${(y0 + r * dy).toFixed(2)} q${(dx / 2).toFixed(2)} ${(dy * .8).toFixed(2)} ${dx.toFixed(2)} 0 `; return d; };
  // rows of rounded feather tips (U-shaped scallops); alternate rows are offset by half a step. o = { j: jitter, sd: seed,
  // keep(x, y, dx, d): false to leave an arc out (e.g. outside the shape it is clipped to), skip: share of arcs to drop }
  const pScal = (x0, x1, y0, rows, dx, dy, dp, o) => {
    o = o || {};
    let d = "", n = o.sd || 0;
    for (let r = 0; r < rows; r++) for (let xx = x0 + (r % 2) * dx / 2; xx < x1; xx += dx) {
      n++;
      const jx = (prn(n) - .5) * (o.j || 0), jy = (prn(n + 40) - .5) * (o.j || 0), p = dp * (.85 + prn(n + 80) * .3), px = xx + jx, py = y0 + r * dy + jy;
      if ((o.skip && prn(n + 120) < o.skip) || (o.keep && !o.keep(px, py, dx, p))) continue;
      d += `M${px.toFixed(1)} ${py.toFixed(1)}c0 ${(p * 1.33).toFixed(1)} ${dx} ${(p * 1.33).toFixed(1)} ${dx} 0`;
    }
    return d;
  };
  // point-in-polygon test, used to keep scallops inside the part of the body they decorate
  const inPoly = (x, y, P) => { let o = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) o = !o; return o; };

  // short fur flicks that follow the curve of a form: arcs about the ellipse E = [cx, cy, rx, ry], flowing toward the rump
  const pFur = (E, x0, x1, y0, y1, dx, dy, seed, kmin, kmax, len, keep) => {
    const f = ["", "", ""];
    for (let gy = y0, r = 0, n = seed; gy < y1; gy += dy, r++) for (let gx = x0 + (r % 2) * dx / 2; gx < x1; gx += dx) {
      n++;
      const px = gx + (prn(n) - .5) * dx * .8, py = gy + (prn(n + 50) - .5) * dy * .8, u = (px - E[0]) / E[2], v = (py - E[1]) / E[3], k = Math.hypot(u, v);
      if (k > kmax || k < kmin || prn(n + 9) < .45 || (keep && !keep(px, py))) continue;
      const a = Math.atan2(v, u), bold = prn(n + 3) < .16, s = (len * (.7 + prn(n + 17) * .6) + (bold ? len * .3 : 0)) * (v > 0 ? -1 : 1), q = t => [E[0] + E[2] * k * Math.cos(t), E[1] + E[3] * k * Math.sin(t)], p0 = q(a), p1 = q(a + s);
      f[bold ? 2 : prn(n + 5) < .5 ? 0 : 1] += `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${(E[2] * k).toFixed(1)} ${(E[3] * k).toFixed(1)} 0 0 ${s > 0 ? 1 : 0} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} `;
    }
    return f;
  };

  /* ---- Kiwi: round russet-brown body, small head, long slender bill, strong scaly legs ---- */
  const kiwiArt = (x, A) => {
    const gb = x.id("kb"), gs = x.id("ks"), gk = x.id("kk"), gf = x.id("kf"), go = x.id("ko");
    x.defs += pLin(gb, -9, -18.5, 10, -4.5, [[0, "#cf6046"], [.5, "#a74130"], [1, "#681f14"]])
      + pRad(gs, -3, -15, 9, [[0, "#f39a74", .5], [1, "#f39a74", 0]])
      + pRad(gf, -10, -7.6, 3.6, [[0, "#ea8261", .6], [1, "#ea8261", 0]])
      + pLin(go, -7.8, 0, -10.4, 0, [[0, "#3a0f08", .42], [1, "#3a0f08", 0]])
      + pLin(gk, -10.4, -6.2, -13.1, -.6, [[0, "#d98471"], [1, "#94443a"]]);
    // the head sits behind the body: the chest fur overlaps the back of the head
    const body = "M-6.9 -5.7 C-7.6 -7 -7.9 -9 -7.8 -10.6 C-7.4 -13 -5.8 -15.2 -3.6 -16.7 C-.4 -18.4 4.6 -18.9 8.2 -17.4 C11.2 -16.2 12.2 -12.8 11.6 -9.8 C11 -7.2 8.4 -5.4 4.8 -4.9 C1 -4.4 -3.4 -4.6 -6.9 -5.7Z";
    const head = "M-7.4 -10.6 C-9.2 -10.8 -11 -9.8 -11.7 -8 C-12.1 -6.6 -11.6 -5.4 -10.5 -4.9 C-9.2 -4.4 -7.8 -4.8 -7 -5.9 L-6.6 -8Z";
    const beak = "M-9.7 -6.1 Q-10.8 -3 -13.2 -.4 Q-11.3 -3.6 -11.7 -6.8Z";
    // fur: a light scatter of fine strands that follow the curve of the back (front to rump) and along the belly
    const E = [1.1, -11.3, 10.8, 7], f = ["", "", ""];
    for (let gy = -17.6, r = 0, n = 3; gy < -5.2; gy += .95, r++) for (let gx = -9.6 + (r % 2) * .6; gx < 12; gx += 1.3) {
      n++;
      const px = gx + (prn(n) - .5) * 1.1, py = gy + (prn(n + 50) - .5) * .8, u = (px - E[0]) / E[2], v = (py - E[1]) / E[3], k = Math.hypot(u, v);
      if (k > .95 || k < .25 || prn(n + 9) < .5) continue;
      const a = Math.atan2(v, u), bold = prn(n + 3) < .16, s = (.2 + prn(n + 17) * .14 + (bold ? .08 : 0)) * (v > 0 ? -1 : 1), q = t => [E[0] + E[2] * k * Math.cos(t), E[1] + E[3] * k * Math.sin(t)], p0 = q(a), p1 = q(a + s);
      f[bold ? 2 : prn(n + 5) < .5 ? 0 : 1] += `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${(E[2] * k).toFixed(1)} ${(E[3] * k).toFixed(1)} 0 0 ${s > 0 ? 1 : 0} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} `;
    }
    const leg = (lx, c1, c2, c3) => {
      const sh = `M${lx + .7} -5.6 C${lx + .5} -3.8 ${lx - .1} -2.2 ${lx - .5} -.9`, ay = -.85, ax = lx - .5, T = [[196, 3.1], [168, 3.4], [146, 2.7]];
      const ts = T.map(t => pToe(ax, ay, t[0], t[1], 1, .62)).join(""), cl = T.map(t => { const r = t[0] * Math.PI / 180, tx = ax + Math.cos(r) * (t[1] + .1), ty = ay + Math.sin(r) * (t[1] + .1); return `M${tx.toFixed(2)} ${ty.toFixed(2)} l${(Math.cos(r) * .38).toFixed(2)} ${(Math.sin(r) * .38 + .06).toFixed(2)}`; }).join(" ");
      return pSt(sh, c1, 1.9) + pSt(sh, c2, 1.5) + pSt(`M${lx + .2} -5 C${lx} -3.6 ${lx - .4} -2.4 ${lx - .7} -1.5`, c3, .34, .75)
        + pFill(ts, c1) + pSt(cl, "#2e0e09", .3) + `<circle cx="${ax}" cy="${ay}" r=".85" fill="${c2}"/>`;
    };
    const bodyArt = leg(-1.4, "#451610", "#65231a", "#a04a3c") + leg(4.6, "#5e1f17", "#8a382c", "#c0624e")
      + `<g transform="translate(0 .6)">` + pFill(body, `url(#${gb})`)
      + x.clip(body, pFill("M-9.6 -18 H12 V-4 H-9.6Z", `url(#${gs})`)
        + pFill("M-6.5 -5.6 C-2 -4.4 6 -4.7 10.4 -8.4 C9.6 -6.2 7.2 -4.6 3.6 -4.2 C-.8 -3.8 -4.6 -4.4 -6.5 -5.6Z", "#3a0f08", .35)
        + pSt(f[0], "#3a0e07", .13, .3) + pSt(f[1], "#f4b090", .13, .3) + pSt(f[2], "#3a0e07", .22, .26)
        + pSt("M-6.6 -14.6 C-3.6 -17.6 3.4 -18.6 8 -16.8", "#f4a98a", .5, .4))
      + pSt("M-7.9 -10 q-.55 .25 -.95 .9 M-7.9 -8.6 q-.55 .2 -1 .8 M-7.7 -7.2 q-.5 .2 -.9 .7", "#a84432", .24, .7) + `</g>`;
    const headArt = `<g transform="translate(0 .6)">` + pFill(head, `url(#${gb})`)
      + x.clip(head, pFill(head, `url(#${gf})`) + pFill("M-13 -12 H-6 V-3 H-13Z", `url(#${go})`))
      + pFill(beak, `url(#${gk})`) + pSt("M-9.9 -6.2 Q-11 -3.2 -13 -.7", "#f0b5a3", .22, .8)
      + `<circle cx="-9.6" cy="-7.9" r=".95" fill="#e2765a" opacity=".3"/><circle cx="-9.6" cy="-7.9" r=".55" fill="#150807"/><circle cx="-9.44" cy="-8.12" r=".18" fill="#fff"/>`
      + A.lid(-9.6, -7.9, .95, "#b85640", "#3a0f08") + `</g>`;
    return `<ellipse cx="0" cy=".3" rx="7.6" ry="1.1" fill="#000" opacity=".13"/>`
      + A.head(headArt, -6.6, -7.8, "0%,100%{transform:rotate(0deg)}24%{transform:rotate(-2.2deg)}44%{transform:rotate(3.6deg)}54%{transform:rotate(-.6deg)}74%{transform:rotate(2deg)}") + A.body(bodyArt);
  };

  /* ---- Tui: glossy blue-green black body, white throat tuft, lacy neck collar, curved dark bill ---- */
  const tuiArt = (x, A) => {
    const gb = x.id("tb"), gc = x.id("tc"), gv = x.id("tv"), gd = x.id("td"), gy = x.id("ty"), gm = x.id("tm"), gw = x.id("tw"), gt = x.id("tt"), gp = x.id("tp"), gk = x.id("tk"), gl = x.id("tl");
    x.defs += pLin(gb, 0, -18.5, 1.5, -3, [[0, "#3d7868"], [.3, "#22504f"], [.6, "#0d2535"], [1, "#04070b"]])
      + pRad(gc, 2.9, -12.2, 4.3, [[0, "#8fd2b0", .55], [.6, "#4a9680", .24], [1, "#4a9680", 0]])
      + pRad(gv, -2.4, -12, 4, [[0, "#4f93d6", .3], [1, "#4f93d6", 0]])
      + pRad(gd, 2.6, -21.2, 3.6, [[0, "#0d3236", .85], [.7, "#12403f", .5], [1, "#12403f", 0]])
      + pRad(gy, 1.8, -23, 2.6, [[0, "#7fc4c0", .55], [1, "#7fc4c0", 0]])
      + pRad(gm, 5.3, -20.4, 3.7, [[0, "#02060a", 1], [.6, "#03090c", .92], [1, "#06120f", 0]])
      + pLin(gw, 2.6, 0, -2.2, 0, [[0, "#081c2e", 0], [.55, "#071626", .8], [1, "#050c1a", .96]])
      + pLin(gt, -1, -5.4, -4.4, 2, [[0, "#162030"], [1, "#05070b"]])
      + pRad(gp, -.5, -.6, 2.5, [[0, "#ffffff"], [.6, "#f2f5fb"], [1, "#bcc7da"]])
      + pLin(gk, 5.8, -21.9, 11.5, -20.7, [[0, "#171b1e"], [.3, "#2c3338"], [.75, "#262c31"], [1, "#14171a"]])
      + pRad(gl, .6, -17.9, 2.6, [[0, "#d6e1ea", .85], [.55, "#d6e1ea", .65], [1, "#d6e1ea", 0]]);
    const body = "M1 -17.8 C-1.4 -17.2 -3.6 -15 -4 -12 C-4.3 -9.4 -3.8 -7 -2.6 -5.2 C-1.6 -3.6 .4 -2.9 2.2 -3.3 C4.4 -3.8 5.8 -6.2 6 -9.4 C6.2 -12.6 5.4 -15.2 4 -17.2Z";
    const head = "M5.7 -21.9 C5.4 -23.6 3.9 -24.6 2.3 -24.1 C.7 -23.6 -.2 -22.1 .1 -20.6 C-.5 -19.4 -1.2 -18.3 -1.2 -16.1 L5.2 -16.1 C5.2 -17.5 5.1 -18.5 4.9 -19.3 C5.6 -19.9 5.9 -20.8 5.7 -21.9Z";
    const wing = "M-1 -13.8 C1 -13.4 2.2 -11.4 2 -8.4 C1.8 -6 .6 -4.2 -1.4 -3.4 L-3.6 -2.5 C-4.3 -4.8 -4.2 -9.4 -3.5 -11.8 C-3 -13 -2.1 -13.8 -1 -13.8Z";
    const tail = "M-2.7 -5.4 C-3.6 -3.4 -4.2 -1.2 -4.3 1.4 C-3.7 2 -2.9 2.2 -2.3 2 C-1.8 .4 -1.1 -1.8 -.6 -3.8Z";
    const beak = "M5.5 -21.9 C7.1 -22.9 9.6 -22.6 11.5 -20.7 C9.6 -21.7 7.7 -21.3 5.8 -20.5Z";
    const puff = "M-1.5 .9 C-2.1 -.2 -1.6 -1.5 -.3 -1.9 C.8 -2.3 1.9 -1.9 2.5 -1.3 C2.2 -.6 2.3 .5 1.6 1.2 C.9 1.9 -.7 2.1 -1.5 .9Z";
        // glossy feather lines flowing down the chest
    const flow = "M3.4 -15.2 C4.9 -13 5.4 -10.2 4.8 -7.4 M2.2 -15.6 C3.8 -13.2 4.3 -10 3.7 -6.6 M1 -15.8 C2.4 -13.2 2.8 -9.8 2.3 -5.8 M-.2 -15.6 C1 -13 1.3 -9.6 .9 -5.2 M-1.4 -14.8 C-.4 -12.4 -.3 -9.2 -.6 -4.8";
    const leg = lx => {
      const ts = [[6, 2.4], [28, 2], [174, 1.1]].map(t => pToe(lx + .1, -.75, t[0], t[1], .66, .38)).join("");
      return pFill(`M${lx - .5} -3.8 L${lx + .5} -3.8 L${lx + .45} -.75 L${lx - .3} -.75Z`, "#34353f") + pSt(`M${lx - .2} -3.6 L${lx - .1} -1`, "#7b7d92", .2, .7)
        + pFill(ts, "#34353f") + pSt(`M${lx + 2.5} -.4 l.28 .12 M${lx + 2.1} .3 l.25 .15 M${lx - 1} -.6 l-.28 .08`, "#14141a", .26);
    };
    const bodyArt = pFill(tail, `url(#${gt})`) + pSt("M-2.3 -4.6 C-3.1 -2.6 -3.6 -.8 -3.8 .9", "#35557a", .26, .4)
      + leg(-.2) + leg(2.8)
      + pFill(body, `url(#${gb})`)
      + x.clip(body, pFill("M-6 -19 H8 V-2H-6Z", `url(#${gc})`) + pFill("M-6 -19 H8 V-2H-6Z", `url(#${gv})`) + pSt(flow, "#9de0c4", .14, .16))
      + pFill(wing, `url(#${gw})`)
      + x.clip(body, pFill("M-6 -19 H8 V-2H-6Z", `url(#${gv})`))
      + x.clip(wing, pSt("M-.6 -7.4 L-3.4 -2.8 M-1.6 -8.8 L-4.2 -4.6 M.4 -6 L-2.2 -2.6", "#03060c", .24, .45))
      + x.clip(body, pSt("M-3.4 -12.6 C-4 -11.2 -4.2 -9.8 -4 -8.4", "#7fc0e8", .24, .3));
    const headArt = `<g transform="rotate(-8 2.6 -16.8)">` + pFill(head, `url(#${gb})`)
      + x.clip(head, pFill(head, `url(#${gd})`) + pFill(head, `url(#${gy})`) + pFill(head, `url(#${gm})`)
        + pFill("M6.2 -22.5 C4.8 -22.8 3.2 -22.2 2.6 -21.1 C3.6 -21.5 4.8 -21.5 6.2 -21.1Z", "#05090b", .85)
        + pSt("M1.3 -22.8 C2.4 -23.5 4.2 -23.4 5.2 -22.6", "#a7e0d6", .5, .5))
      + x.clip(head, pSt(pScales(-1.6, 3.4, -19.7, 8, .7, .5), `url(#${gl})`, .1))
      + `<g transform="translate(5.3 -16.7) rotate(-22) scale(.8)">${pFill(puff, `url(#${gp})`)}${pFill("M-1.5 .9 C-.7 2.1 .9 1.9 1.6 1.2 C.6 1.5 -.7 1.3 -1.5 .9Z", "#aab6cc", .4)}${pSt("M-1.2 .3 q.5 1 1.5 1 M-.7 -.7 q.8 .6 1.6 .4 M.1 -1.4 q1 .1 1.5 .9", "#b5c0d4", .13, 1)}${pSt("M2.2 -1.4 l.55 -.45 M1.9 -1.7 l.3 -.6 M2.4 -.8 l.55 -.1", "#e3e9f3", .17, 1)}</g>`
      + pFill(beak, `url(#${gk})`) + x.clip(beak, `<ellipse cx="6.7" cy="-22.1" rx="1.3" ry=".42" fill="#e3a53a" opacity=".88" transform="rotate(-20 6.7 -22.1)"/>`) + pSt("M6.2 -22 C7.6 -22.8 9.6 -22.5 11.1 -21.1", "#7e8a92", .16, .75)
      + `<circle cx="3.7" cy="-21.3" r=".95" fill="#5b1b2c"/><circle cx="3.7" cy="-21.3" r=".5" fill="#08040a"/><circle cx="3.4" cy="-21.65" r=".26" fill="#fff" opacity=".95"/>`
      + A.lid(3.7, -21.3, 1.05, "#102323", "#04090b") + `</g>`;
    // a slight forward lean (toward the person) about the feet; the contact shadow stays flat
    return `<ellipse cx="0" cy=".3" rx="6.4" ry="1" fill="#000" opacity=".13"/><g transform="rotate(4 1.3 0)">` + A.body(bodyArt) + A.head(headArt, 2.6, -16.8, "0%,100%{transform:rotate(-1.8deg)}38%{transform:rotate(2.4deg)}70%{transform:rotate(-.6deg)}") + `</g>`;
  };
  /* ---- Kea: olive-green alpine parrot, dark-edged scalloped feathers, hooked grey bill, orange flash under the wing ---- */
  const keaArt = (x, A) => {
    const gc = x.id("ec"), gh = x.id("eh"), gm = x.id("em"), gw = x.id("ew"), gs = x.id("es"), gt = x.id("et"), gk = x.id("ek"), gp = x.id("ep"), gf = x.id("ef"), gv = x.id("ev"), go = x.id("eo"), gx = x.id("ex"), mk = x.id("ey");
    x.defs += pLin(gc, 0, -14, 0, -1.5, [[0, "#7f6d38"], [.5, "#887839"], [1, "#9b9142"]])
      + pLin(gh, 0, -17.6, 0, -11, [[0, "#67502e"], [.5, "#79642f"], [1, "#837239"]])
      + pRad(gm, 10.9, -15.2, 2.6, [[0, "#26180b", .72], [.6, "#2e1f0e", .38], [1, "#2e1f0e", 0]])
      + pLin(gw, 4.5, -14, -5, -4.8, [[0, "#808a3d"], [.5, "#6d7e38"], [1, "#4f7b4d"]])
      + pRad(gs, 1.5, -11.6, 6.2, [[0, "#d6d56a", .34], [1, "#d6d56a", 0]])
      + pLin(gt, -5, -7.5, -11.5, -2.5, [[0, "#41392f"], [1, "#171310"]])
      + pLin(gk, 12.2, -16.2, 14.3, -12, [[0, "#858c93"], [.25, "#494f55"], [.65, "#272a2e"], [1, "#16181b"]])
      + pRad(gp, 12.5, -15.4, .8, [[0, "#b9bcbf"], [1, "#7f8387"]])
      + pRad(gf, 8.6, -12.4, 3.2, [[0, "#e6cc70", .4], [1, "#e6cc70", 0]])
      + pLin(gv, 0, -8, -3, -4.6, [[0, "#4a9a78", 0], [1, "#4a9a78", .6]])
      + pLin(go, 0, -4.6, 0, -1.6, [[0, "#3a2a10", 0], [1, "#3a2a10", .34]])
      + pLin(gx, 0, -9.4, 0, -6.4, [[0, "#fff"], [1, "#000"]])
      + `<mask id="${mk}" maskUnits="userSpaceOnUse" x="-20" y="-25" width="40" height="30"><rect x="-20" y="-25" width="40" height="30" fill="url(#${gx})"/></mask>`;
    const tail = "M-5.2 -8.1 C-7.6 -7.6 -9.8 -6.4 -11.5 -4.8 C-11.9 -4.2 -11.6 -3.3 -11.1 -2.4 C-8.8 -2.9 -6 -3.7 -3.4 -4.6Z";
    const body = "M4.6 -15.2 C2.6 -15 .2 -14 -1.6 -12.9 C-4 -11.2 -6.5 -9 -8.2 -7 C-9 -6.2 -8.6 -5.2 -7.8 -4.6 L-4.4 -3.7 C-3 -2.4 -.4 -1.5 2 -1.5 C4.2 -1.8 6 -4.2 7.3 -6.6 C8.5 -8.7 9.4 -10.4 10.4 -11.8 L10.8 -14.4Z";
    const wing = "M4.5 -14.7 C2.2 -14.5 -.3 -13.3 -2 -12.2 C-4.4 -10.6 -6.9 -8.4 -9.2 -6.2 C-10.2 -5.4 -10.3 -4.7 -9.5 -4.6 C-7.6 -4.8 -4.8 -5.1 -2.4 -5.1 C-.4 -5.1 1.8 -5.2 3.8 -5.3 C4.2 -6.4 4.9 -7.6 5.6 -8.8 C6.3 -10.4 5.9 -12.4 4.9 -14Z";
    const cov = "M4.5 -14.7 C2.2 -14.5 -.3 -13.3 -2 -12.2 C-4.4 -10.6 -6.9 -8.4 -9.2 -6.2 L-9.2 -4 L5.6 -4 C6.3 -8 5.9 -12.4 4.9 -14Z";
    const head = "M4.6 -15.2 C5.9 -15.55 7.3 -17.2 9.2 -17.3 C10.7 -17.1 11.7 -16.7 12.3 -16.1 L12.2 -13.7 C11.5 -12.8 10.7 -12 10 -11.2 c0 .9 -1.37 .9 -1.37 0 c0 .9 -1.37 .9 -1.37 0 c0 .9 -1.37 .9 -1.37 0 C5.5 -11.5 5 -13.2 4.6 -15.2Z";
    const edge = "M10 -11.2 c0 .9 -1.37 .9 -1.37 0 c0 .9 -1.37 .9 -1.37 0 c0 .9 -1.37 .9 -1.37 0";
    const upper = "M12 -16.2 C12.9 -15.9 13.7 -15.2 14.1 -14.3 C14.5 -13.5 14.5 -12.6 14.25 -12 C14.1 -11.7 14 -11.55 13.9 -11.5 C13.7 -12.1 13.8 -12.8 13.45 -13.4 C13.05 -13.9 12.6 -14.1 12 -14.1Z";
    const lower = "M12 -14.15 C12.8 -14.2 13.4 -14 13.7 -13.6 C13.75 -13.3 13.5 -13.1 13 -13.05 C12.6 -13.05 12.2 -13.25 12 -13.6Z";
    const cere = "M12 -15.95 C12.4 -16.05 12.85 -15.8 12.95 -15.45 C12.95 -15.05 12.7 -14.9 12.3 -14.95 C11.95 -15.05 11.85 -15.5 12 -15.95Z";
    const BODYP = [[-8.7, -7], [-9, -5], [-7.8, -4.6], [-4.4, -3.7], [-3, -2.5], [-.4, -1.5], [2, -1.4], [4.2, -1.8], [6, -4.2], [7.3, -6.6], [9.4, -10.4], [10.4, -11.8], [10.8, -14.4], [4.6, -15.2], [-1.6, -12.9]];
    const COVP = [[4.6, -14.8], [-2, -12.3], [-9.3, -6.3], [-9.3, -6], [5.8, -6]];
    const inBody = (px, py, dx, d) => [[px, py], [px + dx, py], [px + dx / 2, py + d]].some(q => inPoly(q[0], q[1], BODYP));
    const inCov = (px, py, dx, d) => [[px, py], [px + dx, py], [px + dx / 2, py + d]].some(q => { const r = 52 * Math.PI / 180, u = q[0] + 1, v = q[1] + 9; return inPoly(-1 + u * Math.cos(r) - v * Math.sin(r), -9 + u * Math.sin(r) + v * Math.cos(r), COVP); });
    const bar = "M2.6 -7.6 C3.3 -7.4 3.9 -6.9 3.9 -6 C3.9 -5.6 3.7 -5.4 3.4 -5.45 C2.9 -5.7 2.4 -6.4 2.3 -7Z";
    const leg = (ax, c1, c2, c3) => {
      const ay = -1.05, sh = `M${ax - .8} -3 C${ax - .7} -2.3 ${ax - .3} -1.6 ${ax} ${ay}`, T = [[10, 2.9], [27, 2.2], [-8, 2.5], [166, 1.2]];
      const ts = T.map(t => pToe(ax, ay, t[0], t[1], .88, .52)).join(""), cl = T.map(t => { const r = t[0] * Math.PI / 180, tx = ax + Math.cos(r) * (t[1] + .02), ty = ay + Math.sin(r) * (t[1] + .02); return `M${tx.toFixed(2)} ${ty.toFixed(2)} q${(Math.cos(r) * .2).toFixed(2)} ${(Math.sin(r) * .2 + .24).toFixed(2)} ${(Math.cos(r) * .32).toFixed(2)} ${(Math.sin(r) * .32 + .42).toFixed(2)}`; }).join(" ");
      return pSt(sh, c1, 1.3) + pSt(sh, c2, 1) + pSt(`M${ax - .45} -2.7 C${ax - .45} -2.2 ${ax - .2} -1.7 ${ax + .1} -1.3`, c3, .26, .8) + pFill(ts, c2) + pSt(cl, "#1d1f22", .28) + `<circle cx="${ax}" cy="${ay}" r=".55" fill="${c2}"/>` + pSt(`M${ax + .9} ${ay + .2} l.3 .1 M${ax + 1.6} ${ay + .35} l.28 .1`, "#4a4e52", .16, .6);
    };
    const bodyArt = pFill(tail, `url(#${gt})`) + pSt("M-4.6 -6.9 C-7 -6.2 -9.2 -5.1 -11.2 -3.6 M-4.2 -5.4 C-6.4 -4.9 -8.6 -4.1 -10.9 -3", "#050403", .2, .5) + pSt("M-6 -3.9 C-8 -3.5 -9.8 -3 -11.1 -2.5", "#2f7a72", .3, .6)
      + leg(-.8, "#33373b", "#6a6f73", "#9da3a7") + leg(4, "#3b3f43", "#7a7f83", "#aab0b4")
      + pFill(body, `url(#${gc})`)
      + x.clip(body, pFill(body, `url(#${gf})`) + pFill(body, `url(#${go})`) + pSt(pScal(-9.18, 12, -11.2, 12, 1.37, .85, .62, { j: .2, sd: 7, keep: inBody }), "#3f2e16", .14, .38) + pSt(pScal(-9.08, 12, -11, 12, 1.37, .85, .4, { j: .2, sd: 70, keep: inBody, skip: .5 }), "#e8d27a", .1, .3))
      + pFill(wing, `url(#${gw})`)
      + x.clip(wing, pFill(wing, `url(#${gs})`) + pFill(wing, `url(#${gv})`)
        + `<g mask="url(#${mk})">` + x.clip(cov, `<g transform="rotate(52 -1 -9)">` + pSt(pScal(-12, 10, -16, 14, 1.8, 1.1, .8, { j: .2, sd: 90, keep: inCov }), "#3b2a12", .16, .54) + pSt(pScal(-11.9, 10, -15.75, 14, 1.8, 1.1, .55, { j: .2, sd: 90, keep: inCov, skip: .4 }), "#c4c65a", .1, .3) + `</g>`) + `</g>`
        + pSt("M3.6 -14 C1.4 -13.8 -.6 -12.8 -2.2 -11.8", "#e3e48e", .26, .24) + pSt("M2.9 -6.4 L-8 -5.1 M2.4 -7.2 L-8.4 -5.9 M1.7 -7.9 L-8.5 -6.6 M-1.6 -7.6 L-8.2 -6.3", "#2f4630", .14, .42))
      + pFill(bar, "#55392e") + pSt("M3.8 -6.8 C3.8 -6.2 3.6 -5.8 3.4 -5.55", "#3f8a78", .18, .8)
      + x.clip(body, pSt("M-5 -10.4 C-4.2 -11.2 -3.5 -11.8 -2.7 -12.3", "#e6602a", .8) + pSt("M-4.8 -10.8 C-4.1 -11.5 -3.4 -12 -2.8 -12.5", "#f59a45", .2, .85));
    const headArt = pFill(head, `url(#${gh})`)
      + x.clip(head, pFill(head, `url(#${gf})`) + pFill(head, `url(#${gm})`)
        + pSt("M9.4 -15.9 C9.9 -16.5 11 -16.7 12 -16.2", "#2c1d0e", .36, .5)
        + pSt("M5.8 -15 C6.5 -16 7.6 -16.7 9 -16.9 M6.4 -13.9 C7.6 -14.6 8.6 -14.9 9.6 -14.8 M7.8 -12.6 C8.8 -13.1 9.8 -13.3 10.8 -12.9", "#3a2813", .14, .46)
        + pSt("M5.9 -13.5 C6.9 -14 7.9 -14.2 8.8 -13.9 M8.2 -11.8 C9.2 -12.2 10.1 -12.2 11 -11.8 M7.2 -16 C8 -16.5 9 -16.6 9.8 -16.4", "#e0c872", .12, .42))
      + x.clip(body, pSt(edge, "#3f2e16", .16, .5))
      + pFill(lower, "#34373b") + pSt("M12.2 -14 C12.8 -14 13.3 -13.85 13.55 -13.65", "#b3b9bf", .2, .8)
      + pFill(upper, `url(#${gk})`) + pSt("M12.5 -15.9 C13.3 -15.5 13.9 -14.9 14.15 -14", "#b3b9bf", .18, .5)
      + pFill(cere, `url(#${gp})`) + `<circle cx="12.55" cy="-15.35" r=".15" fill="#2a2a2c"/>`
      + `<circle cx="10.9" cy="-15.3" r=".6" fill="#8a7a62"/><circle cx="10.9" cy="-15.3" r=".44" fill="#3b2818"/><circle cx="10.9" cy="-15.3" r=".31" fill="#0c0907"/><circle cx="10.75" cy="-15.45" r=".12" fill="#fff"/>`
      + A.lid(10.9, -15.3, .6, "#58452a", "#2a1c0c");
    return `<ellipse cx="1.4" cy=".3" rx="6.6" ry="1" fill="#000" opacity=".13"/>` + A.body(bodyArt)
      + A.head(headArt, 8.4, -12.8, "0%,100%{transform:rotate(0deg)}30%{transform:rotate(-2.4deg)}52%{transform:rotate(2.8deg)}78%{transform:rotate(-.8deg)}");
  };

  /* ---- Rabbit: ginger sitting rabbit, tall ears with pink insides, cream eye-ring, chin and paws ---- */
  const rabbitArt = (x, A) => {
    const gb = x.id("rb"), gl = x.id("rl"), gd = x.id("rd"), gh = x.id("rh"), ge = x.id("re"), gi = x.id("ri"), gp = x.id("rp"), gr = x.id("rr"), gm = x.id("rm"), gc = x.id("rc");
    x.defs += pLin(gb, 1, -15.5, -1, -1.5, [[0, "#d49860"], [.5, "#c68048"], [1, "#b06c3a"]])
      + pRad(gl, -3.6, -8.4, 4.8, [[0, "#f2c892", .42], [1, "#f2c892", 0]])
      + pRad(gd, 5.4, -4.4, 5.4, [[0, "#7a4626", .45], [1, "#7a4626", 0]])
      + pRad(gh, -5.2, -13.6, 4.2, [[0, "#e8b680", .42], [1, "#e8b680", 0]])
      + pRad(ge, -3.9, -15, 1.15, [[0, "#f7e9d2"], [.7, "#eed8bc"], [1, "#d6b48a"]])
      + pLin(gi, 0, -20.4, 0, -15.8, [[0, "#e4cdd3"], [1, "#c7a1ab"]])
      + pLin(gp, 0, -4.4, 0, 0, [[0, "#c4875a", 0], [.25, "#c68a58"], [.6, "#d9a878"], [1, "#efd6b0"]])
      + pLin(gr, 0, -22, 0, -16, [[0, "#98603a"], [.35, "#c08455"], [1, "#cf9663"]])
      + pRad(gm, -6.4, -11.8, 2.6, [[0, "#f6e6cc", .9], [1, "#f6e6cc", 0]])
      + pRad(gc, -5.4, -12.9, 1.5, [[0, "#9a5c32", .3], [1, "#9a5c32", 0]]);
    const torso = "M-6.8 -10.6 C-7.3 -8.9 -7.2 -7 -6.5 -5.4 C-5.9 -4.2 -5.3 -3.3 -5 -2.6 L-3.4 -1.9 L1.4 -1.5 C3.2 -1.7 4.8 -2.5 5.3 -3.6 C5.9 -5.2 5.9 -7.3 5.6 -8.6 C5.3 -10.4 4.6 -12 3.6 -13.2 C2.6 -14.4 1.4 -15 .3 -15.3 L-.5 -15.7 L-3 -11.5Z";
    const legF = "M-4.9 -4.4 C-5 -3.3 -5 -2.3 -4.9 -1.5 C-5 -.8 -4.8 -.2 -4.2 -.08 C-3.6 0 -3 -.2 -2.6 -.8 C-2.3 -1.4 -2.3 -2.3 -2.3 -3.3 L-2.4 -4.3Z";
    const legN = "M-2.4 -4.3 C-2.5 -3.2 -2.4 -2.1 -2.3 -1.3 C-2.35 -.6 -2.1 0 -1.4 .08 C-.7 .15 -.1 -.1 .1 -.7 C.3 -1.4 .3 -2.4 .2 -3.4 L.1 -4.2Z";
    const hind = "M.2 -1.8 C1.2 -2.7 2.8 -2.9 3.9 -2.3 C4.5 -1.9 4.4 -.95 3.6 -.8 L.9 -.55 C.3 -.6 0 -1.3 .2 -1.8Z";
    const head = "M-7.9 -12.6 C-7.95 -13.7 -7.45 -14.9 -6.5 -15.9 C-5.6 -16.8 -4.3 -17.3 -3 -17.25 C-1.8 -17.15 -.8 -16.4 -.3 -15.3 C0 -14 -.6 -12.4 -1.8 -11.3 C-3.2 -10.3 -5.3 -10.2 -6.6 -10.8 C-7.4 -11.2 -7.85 -11.8 -7.9 -12.6Z";
    const earL = "M-5.9 -16.6 C-6.9 -18.6 -7.6 -20.4 -7.95 -21.4 C-8.1 -21.9 -7.6 -22.2 -7.2 -21.9 C-6 -21.1 -4.5 -19.3 -3.5 -17.9 C-3.1 -17.5 -2.7 -17.25 -2.2 -17.1 L-3.6 -16Z";
    const earLi = "M-5.2 -17.6 C-6 -18.8 -6.6 -20 -7.1 -21 C-6.1 -20.3 -4.9 -19.2 -3.9 -18Z";
    const earR = "M-2.3 -16 C-2.2 -17.9 -2 -19.5 -1.4 -20.3 C-1 -20.85 -.2 -21 .4 -20.7 C1 -20.35 1.15 -19.3 1.05 -18.1 C.95 -17.2 .6 -16.2 .2 -15.5 L-.6 -15.2Z";
    const earRi = "M-1.8 -16.4 C-1.8 -17.9 -1.6 -19.2 -1.1 -19.8 C-.7 -20.2 -.1 -20.2 .3 -19.9 C.7 -19.5 .75 -18.7 .65 -17.7 C.55 -17 .2 -16.5 -.35 -16Z";
    const muzzle = "M-7.95 -12.8 C-7.9 -11.9 -7.5 -11.1 -6.7 -10.75 C-5.6 -10.3 -4.2 -10.4 -3.2 -10.8 C-4.2 -11.2 -5.4 -11.5 -6.2 -12.2 C-6.7 -12.7 -7.3 -13 -7.95 -12.8Z";
    const fb = pFur([1.2, -7.4, 6.4, 6.6], -7, 6.2, -14.6, -2, 1.25, 1, 11, .3, .96, .2);
    const fh = pFur([-4.3, -13.9, 3.9, 3.6], -8, -.2, -17, -10.4, 1.05, .85, 140, .3, .96, .2, (px, py) => Math.hypot((px + 3.9) / 1.6, (py + 15) / 1.45) > 1);
    const bodyArt = pFill(hind, "#efd6b0") + pSt("M1.2 -2 C2.2 -2.5 3.2 -2.5 3.9 -2.2", "#fff6e6", .14, .5)
      + pFill(torso, `url(#${gb})`)
      + x.clip(torso, pFill(torso, `url(#${gl})`) + pFill(torso, `url(#${gd})`)
        + pSt(fb[0], "#7c4a29", .12, .3) + pSt(fb[1], "#f0c48e", .12, .3) + pSt(fb[2], "#7c4a29", .18, .24)
        + pSt("M1.8 -9.6 C.4 -8.2 -.2 -6 .3 -3.8", "#7c4a29", .2, .26) + pSt("M-6.6 -9 C-6.7 -7.8 -6.3 -6.5 -5.7 -5.4", "#f4d3a4", .22, .16))
      + pFill(legF, `url(#${gp})`) + pFill(legN, `url(#${gp})`) + pSt("M-2.6 -3.6 C-2.7 -2.6 -2.5 -1.7 -2.5 -.9", "#7c4a29", .16, .26)
      + pSt("M-4.3 -.45 v.38 M-3.7 -.5 v.42 M-1.7 -.5 v.45 M-1.1 -.55 v.5 M-.5 -.5 v.42", "#a9784f", .11, .6);
    const headArt = pFill(earL, `url(#${gr})`) + pFill(earLi, "#bd9a96", .9) + pSt("M-5 -17.7 C-5.9 -18.8 -6.5 -19.9 -7 -20.9", "#e9d3d3", .14, .5)
      + pFill(earR, `url(#${gr})`) + pFill(earRi, `url(#${gi})`)
      + pSt("M-1.8 -16.6 C-1.8 -18 -1.6 -19.3 -1.1 -19.85", "#a47a5c", .14, .5) + pSt("M-1.35 -17.3 C-1.35 -18.2 -1.2 -18.9 -.95 -19.4", "#f7ebee", .16, .4)
      + pFill(head, `url(#${gb})`)
      + x.clip(head, pFill(head, `url(#${gh})`) + pFill(head, `url(#${gm})`) + pFill(muzzle, "#f1dcc0", .72) + pFill(head, `url(#${gc})`)
        + pSt(fh[0], "#7c4a29", .12, .3) + pSt(fh[1], "#f2c690", .12, .3) + pSt(fh[2], "#7c4a29", .18, .24))
      + `<ellipse cx="-3.9" cy="-15" rx="1.05" ry=".94" fill="url(#${ge})"/><ellipse cx="-3.9" cy="-15" rx=".5" ry=".58" fill="#15110f"/><circle cx="-4.06" cy="-15.2" r=".13" fill="#fff"/><circle cx="-3.72" cy="-14.78" r=".06" fill="#fff" opacity=".55"/>`
      + `<path d="M-8 -12.9 C-7.7 -13.15 -7.3 -13 -7.2 -12.7 C-7.2 -12.3 -7.6 -12.1 -7.9 -12.2 C-8.1 -12.4 -8.1 -12.7 -8 -12.9Z" fill="#c4867a"/>` + pSt("M-7.7 -12.1 C-7.6 -11.7 -7.3 -11.5 -6.8 -11.5", "#8d5b44", .14, .7)
      + A.lid(-3.9, -15, .64, "#e2c4a0", "#6b4426");
    return `<ellipse cx=".4" cy=".3" rx="6.4" ry=".95" fill="#000" opacity=".13"/>` + A.body(bodyArt)
      + A.head(headArt, -3, -11.2, "0%,100%{transform:rotate(0deg)}28%{transform:rotate(-2deg)}52%{transform:rotate(2.6deg)}76%{transform:rotate(-.8deg)}");
  };

  /* ---- Cat: grey tabby with a white bib and socks, amber eyes, pink nose, tail curled up behind ---- */
  const catArt = (x, A) => {
    const gb = x.id("cb"), gh = x.id("ch"), gd = x.id("cd"), gi = x.id("ci"), gj = x.id("cj"), gw = x.id("cw"), gp = x.id("cp"), gt = x.id("ct"), gz = x.id("cz");
    x.defs += pLin(gb, -4, -12.5, 5, -1, [[0, "#adb5bf"], [.5, "#8f97a3"], [1, "#6d7581"]])
      + pLin(gh, -5, -18.3, -1, -11, [[0, "#a9b1bb"], [1, "#8d95a1"]])
      + pRad(gd, 6, -3, 4.8, [[0, "#3c424d", .42], [1, "#3c424d", 0]])
      + pRad(gi, -5.4, -14.9, 1.1, [[0, "#f9dc66"], [.6, "#efb92f"], [1, "#d08f18"]])
      + pRad(gj, -2.3, -14.9, 1.2, [[0, "#f9dc66"], [.6, "#efb92f"], [1, "#d08f18"]])
      + pLin(gw, 0, -11.2, 0, 0, [[0, "#ffffff"], [.6, "#f3f4f7"], [1, "#dde1e8"]])
      + pRad(gz, 2.4, -9.2, 4.2, [[0, "#d6dce4", .34], [1, "#d6dce4", 0]])
      + pLin(gp, 0, -22, 0, -17, [[0, "#9aa2ad"], [1, "#adb5bf"]])
      + pLin(gt, 5, -3, 7, -12.6, [[0, "#868e9a"], [1, "#a3abb6"]]);
    const tail = "M5.4 -2.2 C7.9 -2.8 9.3 -5 9.1 -8 C8.9 -10.6 7.5 -12.2 5.9 -12.6 C5.5 -12.7 5.3 -12.2 5.7 -11.9 C6.9 -11.1 7.7 -9.7 7.8 -8 C7.9 -6 6.9 -4.6 5.3 -4.1Z";
    const body = "M-5.4 -11.8 C-6.6 -10 -6.8 -7.6 -6 -5.4 C-5.7 -4.2 -5.4 -2.4 -5.3 -.6 C-5.3 -.2 -5 0 -4.6 0 L3.6 0 C5.2 -.4 6.4 -2.2 6.2 -4.6 C6 -7 5 -9.6 3.4 -11.2 C2.2 -12.4 .6 -12.6 -1 -12.2 L-3 -11.6Z";
    const head = "M-7.2 -14.4 C-7.3 -16.2 -6.2 -17.8 -4.4 -18.1 C-3.4 -18.3 -2.4 -18.3 -1.4 -18.1 C.2 -17.7 1 -16.3 1 -14.8 C1.1 -13.3 .5 -12.1 -.4 -11.6 C-1.6 -11.1 -2.8 -11 -3.9 -11.1 C-5.2 -11.2 -6.5 -11.9 -7 -12.9 C-7.2 -13.4 -7.2 -13.9 -7.2 -14.4Z";
    const earF = "M-6.6 -15.8 C-7.3 -17.4 -7.2 -19.9 -6.5 -21.7 C-6.4 -22 -6.1 -22 -5.9 -21.8 C-5 -21 -4.2 -19.9 -3.7 -18.3 L-4 -15.6Z";
    const earN = "M-3.1 -17.2 C-2.6 -19.7 -1.6 -21 -.6 -21.9 C-.4 -22.1 -.1 -22 0 -21.7 C.7 -20.3 1.05 -18.9 .85 -17.4 L-.4 -15.6Z";
    const bib = "M-5.5 -11.2 C-4.4 -10.4 -2.4 -10.4 -1.4 -11.2 C-1.3 -9.2 -1.4 -7.4 -1.8 -6 C-1.4 -4.4 -1.1 -2.6 -1 -1.2 C-1 -.4 -1.3 0 -2.1 0 L-4.9 0 C-5.6 0 -5.9 -.4 -5.9 -1.2 C-5.9 -2.6 -5.9 -4.4 -6.1 -5.8 C-6.3 -7.6 -6 -9.6 -5.5 -11.2Z";
    const muzzle = "M-5.9 -12.6 C-5.8 -13.4 -5 -13.7 -4 -13.5 C-3 -13.7 -2.2 -13.4 -2.1 -12.6 C-2.1 -11.8 -2.9 -11.3 -4 -11.3 C-5.1 -11.3 -5.9 -11.8 -5.9 -12.6Z";
    const fb = pFur([.5, -6.4, 6.6, 6.4], -6, 6.6, -12.4, -.5, 1.3, 1.05, 31, .35, .96, .18);
    const bodyArt = pFill(tail, `url(#${gt})`) + pSt("M8.1 -9.8 C8.7 -9.6 9.2 -9.1 9.3 -8.5 M7.9 -7.3 C8.5 -7 9 -6.6 9.2 -6 M7.1 -4.9 C7.7 -4.8 8.3 -4.4 8.6 -3.9 M6.2 -11.1 C6.7 -11 7.2 -10.6 7.5 -10.1", "#4a505b", .36, .6) + pSt("M5.7 -12.2 C5.4 -12.4 5.4 -12.7 5.8 -12.6", "#3a3f49", .5, .8)
      + pFill(body, `url(#${gb})`)
      + x.clip(body, pFill(body, `url(#${gz})`) + pFill(body, `url(#${gd})`) + pFill(bib, `url(#${gw})`)
        + pSt("M2.2 -11.6 C3.6 -10.4 4.1 -8.8 3.9 -7.2 M3.3 -11.2 C4.8 -9.8 5.3 -8 5.1 -6.2 M4.3 -9.8 C5.4 -8.6 5.8 -7 5.6 -5.2 M1 -11.9 C1.8 -11.2 2.2 -10.3 2.3 -9.2", "#4a505b", .2, .36) + pSt("M1 -12.1 C3 -11.7 4.9 -9.9 5.7 -7.5 C6.1 -6.2 6.2 -5.1 6.1 -4", "#4a505b", .45, .3)
        + pSt("M0 -8.4 C-1 -6.4 -.8 -3.6 .8 -1.8", "#4a505b", .24, .4) + pSt("M-3.5 -5.4 C-3.4 -4 -3.4 -2.4 -3.5 -.8", "#b4bcc8", .18, .7) + pSt("M-6.05 -9 C-6.25 -7.4 -6.05 -4.6 -5.95 -1.4", "#aeb6c2", .3, .55)

        + pSt(fb[0], "#4a505b", .12, .3) + pSt(fb[1], "#c8cfd8", .12, .34))

      + pFill("M.5 -1.1 C1.3 -1.6 2.9 -1.6 3.5 -1.1 C3.8 -.5 3.4 0 2.7 0 L1 0 C.4 0 .2 -.6 .5 -1.1Z", "#f6f4f1") + pSt("M1.4 -.9 v.7 M1.9 -.95 v.75 M2.4 -.9 v.7", "#b9bfc9", .1, .7)
      + pSt("M-4.7 -.9 v.7 M-4.2 -.9 v.7 M-2.6 -.9 v.7 M-2.1 -.9 v.7", "#b9bfc9", .1, .7);
    const headArt = pFill(earF, `url(#${gp})`) + pFill("M-6.4 -17.8 C-6.6 -19 -6.4 -20.2 -6.1 -20.8 C-5.5 -20.2 -4.9 -19.3 -4.6 -18.3Z", "#e9a1ab")
      + pFill(earN, `url(#${gp})`) + pFill("M-2.3 -18 C-1.9 -19.1 -1.4 -20 -.7 -20.8 C-.3 -19.9 0 -18.8 0 -17.6Z", "#e9a1ab")
      + pFill(head, `url(#${gh})`)
      + x.clip(head, pFill(muzzle, "#f6f4f1")
        + pSt("M-4.2 -18 v1.6 M-3.5 -18.1 v1.9 M-2.8 -18 v1.6", "#4a505b", .28, .6)
        + pSt("M-1.3 -14.5 C-.4 -14.9 .4 -14.8 1 -14.5 M-1.3 -13.6 C-.4 -13.5 .4 -13.3 1 -13", "#4a505b", .26, .55) + pSt("M-5.8 -17.1 C-4.8 -17.9 -3.2 -18.1 -2 -17.8", "#fff", .3, .26))
      + `<ellipse cx="-5.4" cy="-14.7" rx=".85" ry="1" fill="url(#${gi})"/><ellipse cx="-2.3" cy="-14.7" rx="1" ry="1.1" fill="url(#${gj})"/>`
      + `<ellipse cx="-5.4" cy="-14.7" rx=".26" ry=".8" fill="#15110f"/><ellipse cx="-2.3" cy="-14.7" rx=".3" ry=".9" fill="#15110f"/><circle cx="-5.65" cy="-15.1" r=".2" fill="#fff"/><circle cx="-2.6" cy="-15.15" r=".24" fill="#fff"/>`
      + `<path d="M-4.7 -13.5 C-4.2 -13.7 -3.8 -13.7 -3.3 -13.5 C-3.5 -13 -3.9 -12.7 -4 -12.6 C-4.1 -12.7 -4.5 -13 -4.7 -13.5Z" fill="#e58a98"/>`
      + pSt("M-4 -12.6 C-4 -12.1 -4.4 -11.8 -4.9 -11.9 M-4 -12.6 C-4 -12.1 -3.6 -11.8 -3.1 -11.9", "#5a4a50", .13, .8)
      + pSt("M-5.6 -12.7 L-8.6 -13.3 M-5.6 -12.4 L-8.8 -12.2 M-5.6 -12.1 L-8.4 -11.2 M-2.4 -12.7 L1 -13.3 M-2.4 -12.4 L1.2 -12.2 M-2.4 -12.1 L.8 -11.3", "#f4f6f9", .08, .8)
      + A.lid(-5.4, -14.7, 1.05, "#8f97a3", "#2b2f36", [[-2.3, -14.7, 1.15, "#8f97a3", "#2b2f36"]]);
    return `<ellipse cx=".6" cy=".3" rx="7.4" ry="1" fill="#000" opacity=".13"/>` + A.body(bodyArt)
      + A.head(headArt, -3.2, -11.6, "0%,100%{transform:rotate(0deg)}28%{transform:rotate(-2.2deg)}52%{transform:rotate(2.8deg)}76%{transform:rotate(-.8deg)}");
  };

  const petWrap = (gd, art, left) => `<g transform="translate(${(left ? 24.2 - (gd.sx - 1) * 27 : 77.8 + (gd.sx - 1) * 27).toFixed(1)} 83) scale(1.1)">${art}</g>`;
  const PETS = { none: () => "", kiwi: (gd, x, A) => petWrap(gd, kiwiArt(x, A || PA0)), tui: (gd, x, A) => petWrap(gd, tuiArt(x, A || PA0), 1),
    kea: (gd, x, A) => petWrap(gd, keaArt(x, A || PA0), 1), rabbit: (gd, x, A) => petWrap(gd, rabbitArt(x, A || PA0)), cat: (gd, x, A) => petWrap(gd, catArt(x, A || PA0)) };
  const PET_LIST = [["none", "None", 0], ["kiwi", "Kiwi", 3], ["tui", "Tui", 4], ["kea", "Kea", 3], ["rabbit", "Rabbit", 2], ["cat", "Cat", 2]];

  /* ------------------------------ catalog ------------------------------- */
  const CATS = [
    { id: "gender", label: "Body", list: GENDER_LIST },
    { id: "costume", label: "Costumes", list: COSTUME_LIST },
    { id: "hair", label: "Hair", list: HAIR_LIST },
    { id: "hairColor", label: "Hair colour", list: HAIRC.map(h => [h.id, h.name, h.r]) },
    { id: "skin", label: "Skin", list: SKINS.map(s => [s.id, s.name, 0]) },
    { id: "eyes", label: "Eyes", list: EYE_LIST },
    { id: "brows", label: "Eyebrows", list: BROW_LIST },
    { id: "mouth", label: "Mouth", list: MOUTH_LIST },
    { id: "face", label: "Face", list: FACE_LIST },
    { id: "top", label: "Outfits", list: TOP_LIST },
    { id: "topColor", label: "Outfit colour", list: TOPC.map(t => [t.id, t.name, 0]) },
    { id: "hat", label: "Hats", list: HAT_LIST },
    { id: "glasses", label: "Glasses", list: GLASS_LIST },
    { id: "extra", label: "Extras", list: EXTRA_LIST },
    { id: "pet", label: "Pets", list: PET_LIST },
    { id: "bg", label: "Backgrounds", list: BG_LIST },
    { id: "fx", label: "Effects", list: FX_LIST }
  ];
  const DEFAULT_LOOK = { gender: "neutral", skin: "s3", hair: "short", hairColor: "dkbrown", eyes: "dots", brows: "natural", mouth: "smile", face: "none", top: "tee", topColor: "sky", glasses: "none", hat: "none", extra: "none", pet: "none", bg: "sky", fx: "none", costume: "none" };
  const NONE_IDS = { face: "none", glasses: "none", hat: "none", extra: "none", pet: "none", fx: "none", costume: "none" };

  /* ------------------------------ renderer ------------------------------ */
  function cleanLook(l) {
    const out = Object.assign({}, DEFAULT_LOOK);
    if (l && typeof l === "object" && l.hair === "afro") l = Object.assign({}, l, { hair: "curly" });   // the Afro was retired
    if (l && typeof l === "object") CATS.forEach(c => {
      const v = l[c.id];
      if (typeof v === "string" && c.list.some(it => it[0] === v)) out[c.id] = v;
    });
    out.warpaintColor = l && /^#[0-9a-f]{6}$/i.test(l.warpaintColor || "") ? l.warpaintColor.toLowerCase() : "#3a8dff";
    return out;
  }
  /* ------------------- Epic & Legendary motion ------------------------
     Only items of tier 3 (Epic) and tier 4 (Legendary) get anything here;
     tiers 0-2 render exactly as before (no extra markup, no extra ids).
     Every Epic / Legendary item has a motion of its own that suits what it is
     (horns flick, a tassel swings, a tie sways, a shark fin cuts through the water...).
     There are no generic rarity sparkles or sheens. Legendary items may add a soft
     glow where light belongs to the item (halo, crown, visor...).
     Nothing is rationed: while an avatar animates, every equipped item moves. What is
     prioritised is WHEN: Legendary before Epic, then face / hat / hair and so on; each layer
     gets its own evenly spread starting phase (see dlk), so the motions take turns instead
     of all firing together, and every one of them is always running.
     Rules: pure CSS keyframes inside the SVG (no JS), transform + opacity only, and
     prefers-reduced-motion switches the animation off (leaving a tidy still).
     Avatars rendered small (under 100px) or with animate:false stay still. */
    const tierOf = (cat, id) => { const c = CATS.find(k => k.id === cat), it = c && c.list.find(i => i[0] === id); return it ? it[2] : 0; };
  const n2 = v => +v.toFixed(2);
  // keyframes: rest pose until a%, the poses are then spread evenly up to b%, back at rest from b% to the end of the cycle
  const burst = (rest, poses, a, b) => `0%,${a}%{${rest}}` + poses.map((v, i) => `${n2(a + (b - a) * (i + 1) / (poses.length + 1))}%{${v}}`).join("") + `${b}%,100%{${rest}}`;
  const rotP = a => `transform:rotate(${a}deg)`;
  // animate svg around the pivot (x, y): the inner node carries the CSS animation, the two translates make (x, y) its origin
  const pv = (h, tok, x, y, svg, kf, dur, o) => `<g transform="translate(${x} ${y})">${h.mv(tok, `<g transform="translate(${-x} ${-y})">${svg}</g>`, kf, dur, o)}</g>`;
  // soft round glow (centre colour fading out)
  const rgrad = (ctx, c, o) => { const i = ctx.id("rg"); ctx.defs += `<radialGradient id="${i}"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset=".55" stop-color="${c}" stop-opacity="${n2(o * .35)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`; return i; };
  // crisp 4-point sparkle, unit radius: tinted star + white core + faint round halo
  const SPK = "M0 -1 C.07 -.24 .24 -.07 1 0 C.24 .07 .07 .24 0 1 C-.07 .24 -.24 .07 -1 0 C-.24 -.07 -.07 -.24 0 -1Z";
  const spkArt = col => `<circle r="1.3" fill="${col}" opacity=".08"/><path d="${SPK}" fill="${col}" stroke="${shade(col, -.3)}" stroke-width=".09" stroke-linejoin="round"/><path d="${SPK}" fill="#fff" transform="scale(.55)"/><circle r=".14" fill="#fff"/>`;
  const spkAt = p => `<g transform="translate(${p[0]} ${p[1]}) scale(${n2(p[2] * 1.25)})">${spkArt(p[3] || "#fff")}</g>`;
  function fxState(ctx, anim, layers, rc) {
    const p = ctx.id("f");
    const st = { built: {}, layers: {}, css: "", n: 0, kf: 0, seed: 0 };
    layers.forEach(l => { st.layers[l.key] = l; });
    // priority decides the order of the phases: Legendary before Epic, then the face and hat before the rest
    const PRI = ["face", "mouth", "eyes", "hat", "hair", "hairc", "glasses", "costume", "top", "extra", "fx", "pet", "bg"], phase = {}, used = {};
    layers.slice().sort((a, b) => b.tier - a.tier || PRI.indexOf(a.key) - PRI.indexOf(b.key)).forEach((l, i) => { phase[l.key] = (i * .6180339) % 1; });
    const legN = layers.filter(l => l.tier >= 4 && l.key !== "bg" && l.key !== "pet").length, gk = 1 / (1 + .5 * Math.max(0, legN - 1));
    const take = () => { if (anim) st.n++; return anim; };
    const kfn = body => { const n = p + "k" + (++st.kf); st.css += `@keyframes ${n}{${body}}`; return n; };
    const dl = dur => n2(-((++st.seed * 0.6180339) % 1) * dur);   // scenery: simple golden-ratio steps
    // an item's nodes start at their layer's phase (plus a fixed step per extra node): the layers take turns
    const dlk = (k, dur) => { const j = used[k] = (used[k] || 0) + 1; return n2(-(((phase[k] || 0) + j * .2918) % 1) * dur); };
    const at = (kf, dur, ease, delay) => ` class="${p}a" style="animation:${kf} ${n2(dur)}s ${ease} ${delay}s infinite"`;

    // a generic moving/pulsing element; its still version is shown when the avatar does not animate
    const mv = (k, tok, svg, kf, dur, o) => {
      o = o || {};
      const base = (o.base ? ` transform="${o.base}"` : "") + (o.op != null ? ` opacity="${o.op}"` : "");
      if (take()) return `<g${base}${at(kfn(kf), dur, o.ease || "ease-in-out", o.delay != null ? o.delay : dlk(k, dur))}>${svg}</g>`;
      return o.still === false ? "" : `<g${base}>${svg}</g>`;
    };
    const glow = (k, gs, gkf, gdur) => {
      const body = gs.map(g => {
        const id = ctx.id("gl");
        ctx.defs += `<radialGradient id="${id}"><stop offset="0" stop-color="${g.c}" stop-opacity="${n2(g.o * gk)}"/><stop offset=".55" stop-color="${g.c}" stop-opacity="${n2(g.o * gk * .4)}"/><stop offset="1" stop-color="${g.c}" stop-opacity="0"/></radialGradient>`;
        return `<ellipse cx="${g.x}" cy="${g.y}" rx="${g.rx}" ry="${g.ry}" fill="url(#${id})"/>`;
      }).join("");
      return mv(k, "glow", body, gkf || "0%,100%{opacity:.5}50%{opacity:1}", gdur || 4.6);
    };
    // one walker = ONE animated node that twinkles up in each of its spots in turn
    const walker = (g, o) => {
      const m = g.length, slot = 100 / m, vis = slot * (o.vis || .62), rise = o.rise != null ? o.rise : (o.drift ? 3.2 : 0);
      const tf = (x, y, s, r) => `transform:translate(${n2(x)}px,${n2(y)}px) scale(${n2(s)}) rotate(${r}deg)`;
      let body = "";
      g.forEach((q, i) => {
        const t0 = i * slot;
        body += `${n2(t0)}%{${tf(q[0], q[1] + rise / 2, .2, -16)};opacity:0}${n2(t0 + vis * .42)}%{${tf(q[0], q[1], q[2] * 1.25, 0)};opacity:1}${n2(t0 + vis)}%{${tf(q[0], q[1] - rise / 2, .2, 16)};opacity:0}`;
      });
      body += `100%{${tf(g[0][0], g[0][1] + rise / 2, .2, -16)};opacity:0}`;
      const dur = m * 2.3 + 1;
      return `<g transform="translate(${g[0][0]} ${g[0][1]}) scale(${n2(g[0][2] * 1.25)})"${at(kfn(body), dur, "ease-in-out", dl(dur))}>${spkArt(g[0][3] || "#fff")}</g>`;
    };
    const sparks = (pts, n, o) => {
      o = o || {};
      if (!n) return pts.slice(0, o.still || 3).map(spkAt).join("");
      const groups = Array.from({ length: n }, () => []);
      pts.forEach((q, i) => groups[i % n].push(q));
      return groups.filter(g => g.length).map(g => walker(g, o)).join("");
    };

    st.get = k => {
      if (st.built[k]) return st.built[k];
      const out = st.built[k] = { pre: "", post: "", spec: null }, l = st.layers[k];
      if (!l || k === "pet") return out;
      const spec = out.spec = RSPEC[k][l.id](rc), leg = l.tier >= 4;
      if (spec.amb) {       // backgrounds: ambient motion only
        spec.amb.forEach(a => {
          if (a.t === "walk") out.post += sparks(a.pts, take() ? 1 : 0, a.o);
          else { const el = mv(k, "amb", typeof a.svg === "function" ? a.svg(ctx) : a.svg, a.kf, a.dur, a.o); out.post += el && a.wrap ? a.wrap(el) : el; }
        });
        return out;
      }
      const g = (leg || spec.glow3) && spec.glow ? glow(k, [].concat(spec.glow), spec.glowKf, spec.glowDur) : "";
      if (spec.glowPost) out.post += g; else out.pre += g;
      if (spec.extra) out.post += spec.extra({ mv: (tk, s2, kf, d, o) => mv(k, tk, s2, kf, d, o), dl: d => dlk(k, d), on: anim });
      return out;
    };
    const petA = st.layers.pet ? {
      body: b => mv("pet", "breathe", b, "0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,1.04)}", 3.9),
      head: (b, px, py, kf) => `<g transform="translate(${px} ${py})">${mv("pet", "tilt", `<g transform="translate(${-px} ${-py})">${b}</g>`, kf, 6.4)}</g>`,
      lid: (cx, cy, r, f, l, more) => mv("pet", "blink", [[cx, cy, r, f, l]].concat(more || []).map(e => `<circle cx="${e[0]}" cy="${e[1]}" r="${n2(e[2])}" fill="${e[3]}"/><path d="M${n2(e[0] - e[2] * .75)} ${e[1]} q${n2(e[2] * .75)} ${n2(e[2] * .5)} ${n2(e[2] * 1.5)} 0" fill="none" stroke="${e[4]}" stroke-width=".35" stroke-linecap="round"/>`).join(""), "0%,88%{opacity:0}90%,93%{opacity:1}95.5%,100%{opacity:0}", 5.4, { op: 0, still: false })
    } : PA0;
    // public API used by renderSvg
    return {
      petA,
      bg(svg) { const o = st.layers.bg && st.get("bg"); return o && o.spec && o.spec.strip ? svg.replace(o.spec.strip, "") : svg; },
      pre: k => st.layers[k] ? st.get(k).pre : "",
      post: k => st.layers[k] ? st.get(k).post : "",
      wrap(k, svg, part) { if (!st.layers[k]) return svg; const o = st.get(k); return o.spec && o.spec.wrap ? o.spec.wrap({ mv: (tk, s2, kf, d, op) => mv(k, tk, s2, kf, d, op), dl: d => dlk(k, d), on: anim }, svg, part) : svg; },
      pet: svg => svg,
      css() { return st.n ? `<style>${st.css}@media (prefers-reduced-motion:reduce){.${p}a{animation:none!important}}</style>` : ""; },
      count() { return st.n; }
    };
  }
  const NOFX = { pre: () => "", post: () => "", wrap: (k, s) => s, pet: s => s, bg: s => s, petA: PA0, css: () => "", count: () => 0 };

  /* What each Epic / Legendary item looks like. clip = the item's own outline(s) (path "d" strings
     or raw clip children), box = its bounding box (sets the sweep), sp = sparkle spots [x, y, size, colour]. */
  const CITY_OK = CITY.lit.filter(p => Math.hypot(p[0] - 50, p[1] - 50) < 42), CITY_PTS = [CITY_OK[1], CITY_OK[Math.floor(CITY_OK.length / 2)], CITY_OK[CITY_OK.length - 2]].filter(Boolean);
  const RSPEC = {
    hat: {
      // the horns flick one after the other, each pivoting at its base
      devil: () => ({ wrap: (h, svg) => {
        const m = svg.match(/^<path d="([^"]*?Z) (M[^"]*)"([^>]*)\/>$/); if (!m) return svg;
        const d0 = h.dl(5.4), horn = (d, x, s, dly) => pv(h, "flick", x, 26, `<path d="${d}"${m[3]}/>`, burst("transform:rotate(0deg)", [11, -3, 7, -2].map(a => rotP(a * s)), 48, 74), 5.4, { delay: dly });
        return horn(m[1], 36, -1, d0) + horn(m[2], 64, 1, d0 + .38);
      } }),
      propeller: () => ({
        // edge-on spin: the two blades squash towards the hub and back again, in a short whirr every few seconds
        wrap: (h, svg) => svg.replace(/(<ellipse cx="41" cy="7\.4"[^>]*\/><ellipse cx="59" cy="7\.4"[^>]*\/>)/, (m, bl) => `<g transform="translate(50 7.4)">${h.mv("spin", `<g transform="translate(-50 -7.4)">${bl}</g>`, "0%,56%{transform:scale(1,1)}60%{transform:scale(.1,1)}64%{transform:scale(1,1)}68%{transform:scale(.1,1)}72%{transform:scale(1,1)}76%{transform:scale(.12,1)}80%{transform:scale(1,1)}84%{transform:scale(.4,1)}88%,100%{transform:scale(1,1)}", 4.6)}</g>`) }),
      // the halo floats: it drifts up and down, tilting a little as it goes
      halo: () => ({ glow3: true, glow: { x: 50, y: 9, rx: 26, ry: 11, c: "#ffd23f", o: .5 },
        wrap: (h, svg) => pv(h, "float", 50, 9, svg, "0%,100%{transform:translateY(0px) rotate(0deg)}28%{transform:translateY(-1.8px) rotate(-1.8deg)}64%{transform:translateY(.7px) rotate(1.6deg)}", 4.6) }),
      // the crown settles on the head with a little bounce, then its jewels throb in their own colours
      crown: rc => ({ glow: { x: 50, y: 19, rx: 31, ry: 19, c: "#ffd23f", o: .5 }, wrap: (h, svg) => {
        const d0 = h.dl(6.6), gems = h.on ? [[50, 28.4, "#ff5d6c"], [39, 28.4, "#5aa8ff"], [61, 28.4, "#3ecf8e"]].map(g => `<circle cx="${g[0]}" cy="${g[1]}" r="4.8" fill="url(#${rgrad(rc.ctx, g[2], .95)})"/>`).join("") : "";
        return pv(h, "bounce", 50, 31, svg + h.mv("jewels", gems, "0%,62%{opacity:0}68%{opacity:1}74%{opacity:.3}81%{opacity:.95}95%,100%{opacity:0}", 6.6, { op: 0, still: false, delay: d0 }), burst("transform:translateY(0px) scale(1,1)", ["transform:translateY(-2px) scale(.99,1.03)", "transform:translateY(.8px) scale(1.02,.97)", "transform:translateY(-.4px) scale(1,1.01)"], 36, 60), 6.6, { delay: d0 });
      } }),
      // graduation toss: the cap hops and tilts, and the tassel swings on like a pendulum
      grad: () => ({ wrap: (h, svg) => {
        const t = svg.match(/<path d="M78\.4 21\.4 V29\.6"[^>]*\/><path d="M76\.6 29\.4[^>]*\/>/); if (!t) return svg;
        const d0 = h.dl(7.4);
        return pv(h, "toss", 50, 28, svg.replace(t[0], () => pv(h, "tassel", 78.4, 21.4, t[0], burst("transform:rotate(0deg)", [16, -17, 11, -7, 3].map(rotP), 44, 92), 7.4, { delay: d0 + .3 })), burst("transform:translateY(0px) rotate(0deg)", ["transform:translateY(-3.4px) rotate(-5deg)", "transform:translateY(-4.4px) rotate(3deg)", "transform:translateY(.7px) rotate(-1deg)"], 40, 66), 7.4, { delay: d0 });
      } }),
      // the pom-pom swings on the end of the hat and settles
      santa: () => ({ wrap: (h, svg) => svg.replace(/<circle cx="82" cy="27" r="5\.2" fill="#fff"\/>/, m => pv(h, "swing", 75, 22, m, burst("transform:rotate(0deg)", [13, -10, 7, -4, 1.5].map(rotP), 36, 88), 4.2)) })
    },
    glasses: {
      // the wearer lifts the monocle to peer closer, then lets it drop back
      monocle: () => ({ wrap: (h, svg) => pv(h, "peer", 59, 45, svg, burst("transform:translate(0px,0px) scale(1,1)", ["transform:translate(.7px,-1.9px) scale(1.08,1.08)", "transform:translate(.4px,-1.3px) scale(1.05,1.05)", "transform:translate(0px,.5px) scale(.98,.98)"], 46, 70), 6) }),
      // mechanical focus: the lenses click out, then in, then settle
      goggles: () => ({ wrap: (h, svg) => pv(h, "focus", 50, 45, svg, "0%,44%{transform:scale(1,1)}47%,55%{transform:scale(1.07,1.07)}58%,64%{transform:scale(.97,.97)}67%,100%{transform:scale(1,1)}", 5.8) }),
      // a scanner beam sweeps across the visor and back
      visor: rc => ({ glow: { x: 50, y: 45.5, rx: 30, ry: 11, c: "#19e3d4", o: .5 }, extra: h => {
        const c = rc.ctx, gid = c.id("vs"), m = h.mv("scan", `<rect x="20" y="34" width="10" height="22" fill="url(#${gid})"/><rect x="24.4" y="36" width="1.3" height="17" rx=".6" fill="#fff" opacity=".9"/>`, "0%,6%{transform:translateX(0px)}44%,56%{transform:translateX(50px)}94%,100%{transform:translateX(0px)}", 5.2, { still: false });
        if (!m) return "";
        c.defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#eaffff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
        return c.clip(["M31 41 Q50 36 69 41 L68 50 Q50 54 32 50Z"], m);
      } })
    },
    extra: {
      // the medal swings on its ribbon
      medal: () => ({ wrap: (h, svg) => {
        const i = svg.indexOf('<circle cx="50" cy="91.4"'); if (i < 0) return svg;
        return svg.slice(0, i) + pv(h, "swing", 50, 85.4, svg.slice(i), burst("transform:rotate(0deg)", [15, -12, 8, -4, 1.5].map(rotP), 36, 88), 5.2);
      } })
    },
    top: {
      // mirror-ball light: soft coloured spots drift across the sequins
      disco: rc => ({ glow: { x: 50, y: 93, rx: 54, ry: 26, c: "#ff7be0", o: .5 }, extra: h => {
        const c = rc.ctx, P = 26, pid = c.id("dp2"), m = h.mv("spots", `<rect x="${12 - P}" y="${75 - P}" width="${76 + P}" height="${25 + P}" fill="url(#${pid})" opacity=".62"/>`, `0%{transform:translate(0px,0px)}100%{transform:translate(${P}px,${P}px)}`, 9, { ease: "linear", still: false });
        if (!m) return "";
        const spot = col => { const i = c.id("dg"); c.defs += `<radialGradient id="${i}"><stop offset="0" stop-color="${col}" stop-opacity=".9"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`; return i; };
        const g1 = spot("#ff7be0"), g2 = spot("#5ec8ff"), g3 = spot("#ffe66b");
        c.defs += `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${P}" height="${P}"><circle cx="6" cy="7" r="5.6" fill="url(#${g1})"/><circle cx="19" cy="14" r="4.8" fill="url(#${g2})"/><circle cx="8" cy="21" r="4.2" fill="url(#${g3})"/></pattern>`;
        return c.clip([BODY], m);
      } }),
      // One soft movement. The shoulders and side panels swell outward and relax; as the jacket settles the quilting
      // compresses a touch (the cushioned feel); the collar follows the shoulders only slightly; the zip and
      // centre seam stay anchored, so the jacket never looks stretched. All three parts share one clock.
      puffer: () => { const D = 6.8; let d0 = null; return { wrap: (h, svg, part) => {
        if (part === "back") return svg;
        if (d0 == null) d0 = h.dl(D);
        if (part === "body") {
          const m = svg.match(/^(<path d="[^"]*" fill="[^"]*"\/>)(<g clip-path="[^"]*">)([\s\S]*)(<\/g>)$/); if (!m) return svg;
          const quilt = pv(h, "quilt", 50, 68, m[3], "0%,44%{transform:scale(1,1)}60%{transform:scale(1.006,.972)}84%,100%{transform:scale(1,1)}", D, { delay: d0 });
          return pv(h, "swell", 50, 100, m[1] + m[2] + quilt + m[4], "0%,26%{transform:scale(1,1)}44%{transform:scale(1.024,1.01)}76%,100%{transform:scale(1,1)}", D, { delay: d0 });
        }
        const i = svg.indexOf('<path d="M49.1 70.8'); if (i < 0) return svg;   // everything from the zip on stays put
        return pv(h, "collar", 50, 76, svg.slice(0, i), "0%,26%{transform:translateY(0px) scale(1,1)}44%{transform:translateY(-.35px) scale(1.01,1)}76%,100%{transform:translateY(0px) scale(1,1)}", D, { delay: d0 }) + svg.slice(i);
      } }; },
      // the tie swings from its knot
      blazer: () => ({ wrap: (h, svg, part) => {
        if (part !== "over") return svg;
        const m = svg.match(/<path d="M48\.4 81 H51\.6[^>]*\/><g clip-path="[^"]*"><path d="M44 85\.6[^>]*\/><\/g>/); if (!m) return svg;
        return svg.replace(m[0], () => pv(h, "sway", 50, 79.5, m[0], burst("transform:rotate(0deg)", [10, -9, 6, -3, 1].map(rotP), 44, 86), 5.8));
      } })
    },
    eyes: (() => {
      // each eye turns on its own centre; both eyes share one fixed delay so they move together
      const pair = (split, kf, dur) => (h, svg) => { const i = split(svg); return [[41, svg.slice(0, i)], [59, svg.slice(i)]].map(p => `<g transform="translate(${p[0]} 45)">${h.mv("spin", `<g transform="translate(${-p[0]} -45)">${p[1]}</g>`, kf, dur, { delay: -1.6 })}</g>`).join(""); };
      const second = svg => svg.indexOf("<path", 4);
      return {
        stars: () => ({ wrap: pair(second, "0%,60%{transform:rotate(0deg)}74%,100%{transform:rotate(360deg)}", 5.4) }),
        hearts: () => ({ wrap: pair(second, "0%,62%{transform:rotate(0deg) translate(0px,0px)}64.5%{transform:rotate(-13deg) translate(-.7px,0px)}67%{transform:rotate(13deg) translate(.7px,0px)}69.5%{transform:rotate(-12deg) translate(-.7px,0px)}72%{transform:rotate(10deg) translate(.5px,0px)}74.5%{transform:rotate(-6deg) translate(-.3px,0px)}77%,100%{transform:rotate(0deg) translate(0px,0px)}", 4.8) }),
        dollar: () => ({ wrap: pair(svg => svg.indexOf('<circle cx="59"'), "0%,58%{transform:scale(1,1)}64%{transform:scale(.08,1)}70%{transform:scale(1,1)}76%{transform:scale(.08,1)}82%{transform:scale(1,1)}88%,100%{transform:scale(1,1)}", 5.2) })
      };
    })(),
    mouth: {
      // a smug curl: the smirk stretches and lifts at one corner
      smirk: () => ({ wrap: (h, svg) => pv(h, "curl", 45, 57.4, svg, burst("transform:rotate(0deg) scale(1,1)", ["transform:rotate(-9deg) scale(1.13,1.12)", "transform:rotate(-6deg) scale(1.08,1.07)"], 40, 66), 5.6) }),
      // a playful pant: the tongue wags from side to side and bobs
      tongue: () => ({ wrap: (h, svg) => {
        const i = svg.indexOf('<path d="M48 58.5'); if (i < 0) return svg;
        return svg.slice(0, i) + pv(h, "wag", 51, 58.4, svg.slice(i), burst("transform:rotate(0deg) scale(1,1)", [-10, 9, -8, 7, -4].map((a, j) => `transform:rotate(${a}deg) scale(1,${j % 2 ? 1.04 : 1.1})`), 30, 80), 4.4);
      } })
    },
    face: {
      // each painted star pops and spins a fifth of a turn (a star looks the same afterwards), one after the other
      paintstars: () => ({ wrap: (h, svg) => {
        const i = svg.indexOf("<path", 4); if (i < 0) return svg;
        const d0 = h.dl(4.8), kf = "0%,40%{transform:rotate(0deg) scale(1,1)}49%{transform:rotate(36deg) scale(1.34,1.34)}58%,100%{transform:rotate(72deg) scale(1,1)}";
        return pv(h, "pop", 36.6, 53, svg.slice(0, i), kf, 4.8, { delay: d0 }) + pv(h, "pop", 63.4, 53, svg.slice(i), kf, 4.8, { delay: d0 + 2.4 });
      } }),
      // the old scar tingles: a soft flush throbs along it
      scar: () => ({ wrap: (h, svg) => {
        const m = svg.match(/<path d="M35\.4 48\.6[^>]*\/>/); if (!m || !h.on) return svg;
        return svg + h.mv("tingle", m[0].replace("#c4523f", "#ffc9b8").replace('stroke-width="1.5"', 'stroke-width="2.6"'), "0%,100%{opacity:0}30%{opacity:.85}52%{opacity:0}", 4.8, { op: 0, still: false });
      } }),
      // warpaint pulses like a heartbeat before battle
      stripes: rc => ({ wrap: (h, svg) => {
        if (!h.on) return svg;
        const c = shade(rc.look.warpaintColor || "#3a8dff", .55);
        return svg + h.mv("pulse", svg.replace(/stroke="[^"]*"/, 'stroke="' + c + '"').replace(/stroke-width="[^"]*"/, 'stroke-width="3.6"'), "0%,100%{opacity:0}8%{opacity:.9}15%{opacity:.25}23%{opacity:.8}40%,60%{opacity:0}", 3.8, { op: 0, still: false });
      } })
    },
    hair: {
      // the crest ripples and rises, like a rooster's comb in a gust
      mohawk: () => ({ wrap: (h, svg, part) => {
        if (part === "back") return svg;
        const i = svg.indexOf("<path", 4); if (i < 0) return svg;
        return svg.slice(0, i) + pv(h, "ripple", 50, 31, svg.slice(i), burst("transform:rotate(0deg) scale(1,1)", [[7, 1.06], [-6, 1.03], [4, 1.05], [-2, 1]].map(p => `transform:rotate(${p[0]}deg) scale(1,${p[1]})`), 40, 82), 5);
      } }),
      // the spikes bristle: they stand up taller in two quick flurries
      spiky: () => ({ wrap: (h, svg, part) => part === "back" ? svg : pv(h, "bristle", 50, 42, svg, burst("transform:scale(1,1)", ["transform:scale(1.025,1.09)", "transform:scale(.99,1.03)", "transform:scale(1.02,1.07)"], 44, 74), 4.8) }),
      // the ponytail swings from its tie, side to side, and settles
      ponytail: () => ({ wrap: (h, svg, part) => part === "back" ? pv(h, "swing", 68, 31, svg, burst("transform:rotate(0deg)", [8, -7, 5, -3, 1].map(rotP), 40, 88), 4.4) : svg }),
      // long wavy hair already swishes in the wind by itself (see HAIR.wavy)
      wavy: () => ({})
    },
    hairc: {
      // the rainbow flows through the hair: bright colour bands drift along it
      rainbow: rc => ({ glow: { x: 50, y: 30, rx: 38, ry: 26, c: "#c3a2ff", o: .45 }, extra: h => {
        const c = rc.ctx, gid = c.id("rf"), L = 60, ang = 24 * Math.PI / 180, px = n2(L * Math.cos(ang)), py = n2(L * Math.sin(ang)), tx = n2(L * L / px);
        const m = h.mv("flow", `<rect x="${n2(16 - tx - 2)}" y="0" width="${n2(70 + tx + 4)}" height="64" fill="url(#${gid})" opacity=".5"/>`, `0%{transform:translateX(0px)}100%{transform:translateX(${tx}px)}`, 9, { ease: "linear", still: false });
        if (!m) return "";
        c.defs += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${px}" y2="${py}" spreadMethod="repeat">` + ["#ff5d5d", "#ffa23f", "#ffd23f", "#3ecf8e", "#3a8dff", "#b05cff", "#ff5d5d"].map((col, i) => `<stop offset="${n2(i / 6)}" stop-color="${col}"/>`).join("") + `</linearGradient>`;
        return c.mask(HAIR[rc.look.hair]("#fff", "#fff", c).front || "", m);
      } })
    },
    costume: {
      // the ghost floats and sways, then pops up with a "boo!"
      ghost: () => ({ wrap: (h, svg, part) => part === "over" ? svg : pv(h, "float", 50, 100, svg, "0%,100%{transform:translateY(0px) rotate(0deg) scale(1,1)}16%{transform:translateY(-1.7px) rotate(-1.4deg) scale(1,1)}32%{transform:translateY(-.2px) rotate(.6deg) scale(1,1)}48%{transform:translateY(-1.9px) rotate(1.4deg) scale(1,1)}62%{transform:translateY(-.4px) rotate(0deg) scale(1,1)}67%{transform:translateY(.6px) rotate(0deg) scale(1.01,.97)}73%{transform:translateY(-2.6px) rotate(0deg) scale(1.05,1.07)}84%{transform:translateY(-.6px) rotate(0deg) scale(1,1.01)}", 5.4) }),
      // the red headband tails flutter in the wind
      ninja: () => ({ wrap: (h, svg, part) => {
        if (part === "over") return svg;
        const i = svg.indexOf('<path d="M71 31.4'); if (i < 0) return svg;
        return svg.slice(0, i) + pv(h, "flutter", 71.5, 36, svg.slice(i), burst("transform:rotate(0deg) scale(1,1)", [[11, 1.06], [-7, .94], [9, 1.05], [-4, .97], [2, 1]].map(p => `transform:rotate(${p[0]}deg) scale(${p[1]},1)`), 22, 84), 3.6);
      } }),
      // the dorsal fin cuts through the water, and the hood's teeth chomp
      shark: () => ({ wrap: (h, svg, part) => {
        if (part === "over") return svg;
        const fin = svg.match(/^<path d="M38 18 Q43 -1 64 14\.4Z"[^>]*\/>/), tre = /<path d="M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L[\d.]+ [\d.]+Z" fill="#fff" stroke="#c9d6e6"[^>]*\/>/g;
        let out = svg;
        if (fin) out = out.replace(fin[0], () => pv(h, "fin", 51, 17, fin[0], burst("transform:translateX(0px) rotate(0deg)", [[1.6, 5], [-1.2, -4], [.6, 2]].map(p => `transform:translateX(${p[0]}px) rotate(${p[1]}deg)`), 34, 76), 4.8));
        const teeth = h.on ? out.match(tre) : null;
        if (teeth && teeth.length) {
          let placed = false;
          out = out.replace(tre, () => { if (placed) return ""; placed = true; return "@@T@@"; });
          out = out.replace("@@T@@", () => pv(h, "chomp", 50, 24, teeth.join(""), burst("transform:translateY(0px) scale(1,1)", ["transform:translateY(1.7px) scale(1,1.3)", "transform:translateY(0px) scale(1,1)", "transform:translateY(1.4px) scale(1,1.24)"], 52, 72), 4.8));
        }
        return out;
      } }),
      // The cape billows on a soft magic wind while the potion at the belt sloshes gently: the surface of the
      // liquid tilts one way, then the other. The belt and bottle stay attached to the mage; only the cape moves.
      wizard: rc => ({ wrap: (h, svg, part) => {
        if (part !== "over") return svg;
        const i = svg.indexOf("<g clip-path", 5); if (i < 0) return svg;      // cape first, then the gear
        let gear = svg.slice(i);
        if (h.on) gear = gear.replace(/<path d="M61\.7 96 Q64\.5 95\.2 67\.3 96 V98\.7 Q64\.5 100 61\.7 98\.7Z" fill="#8061c1"\/>/, () => rc.ctx.clip(["M61.7 94.6 H67.3 V98.7 Q64.5 100 61.7 98.7Z"],
          pv(h, "potion", 64.5, 97.3, `<path d="M59 96.4 Q64.5 95.4 70 96.4 V103 H59Z" fill="#8061c1"/><path d="M59 96.4 Q64.5 95.4 70 96.4" fill="none" stroke="#a98ff0" stroke-width=".5"/>`, "0%,100%{transform:rotate(0deg) translateY(0px)}28%{transform:rotate(-13deg) translateY(-.22px)}60%{transform:rotate(11deg) translateY(.18px)}82%{transform:rotate(-5deg) translateY(0px)}", 4.8)));
        return pv(h, "cape", 50, 76, svg.slice(0, i), "0%,100%{transform:skewX(0deg) scale(1,1)}24%{transform:skewX(-4.2deg) scale(1.025,1)}52%{transform:skewX(3.4deg) scale(.992,1)}78%{transform:skewX(-1.6deg) scale(1.012,1)}", 6.4) + gear;
      } })
    },
    fx: {
      lightning: rc => ({
        // a quick double flash: the bolts whiten and a soft halo blooms round them
        extra: h => { const c = rc.ctx, i = c.id("lf"); c.defs += `<radialGradient id="${i}"><stop offset="0" stop-color="#fff27a" stop-opacity=".7"/><stop offset="1" stop-color="#ffe14d" stop-opacity="0"/></radialGradient>`;
          return h.mv("flash", `<ellipse cx="14" cy="28" rx="17" ry="25" fill="url(#${i})"/><ellipse cx="86" cy="68" rx="15" ry="23" fill="url(#${i})"/><path d="M14 10 L6 30 L13 30 L9 46 L22 24 L14 24 L20 10Z M86 52 L79 70 L85 70 L82 84 L93 64 L87 64 L92 52Z" fill="#fff"/>`, "0%,62%{opacity:0}64%{opacity:.95}67%{opacity:.2}70%{opacity:.9}76%{opacity:.25}82%,100%{opacity:0}", 3.4, { ease: "linear", op: 0, still: false }); } }),
      glow: () => ({
        // the ring warbles: it swells and settles unevenly while its brightness drifts out of step
        wrap: (h, svg) => h.mv("fade", `<g transform="translate(50 50)">${h.mv("warble", `<g transform="translate(-50 -50)">${svg}</g>`, "0%,100%{transform:scale(1,1)}22%{transform:scale(1.045,1.03)}47%{transform:scale(.975,.985)}71%{transform:scale(1.03,1.05)}", 5.2)}</g>`, "0%,100%{opacity:1}35%{opacity:.7}68%{opacity:.88}", 3.7) }),
      flames: () => ({
        glow: { x: 50, y: 98, rx: 62, ry: 32, c: "#ff8a1a", o: .5 }, glowKf: "0%,100%{opacity:.75}18%{opacity:1}41%{opacity:.8}67%{opacity:1}84%{opacity:.82}", glowDur: 2.3,
        // embers: small glowing motes drift up from the fire, thinning out as they rise
        extra: h => [[22, 74, 13, -3.4, 3.6], [52, 70, 15, 2.6, 4.4], [76, 73, 13, -2.2, 3.9], [88, 76, 11, 3, 4.8]].map(e =>
          h.mv("ember", `<g transform="translate(${e[0]} ${e[1]})"><circle r="2.1" fill="#ff8a1a" opacity=".28"/><circle r="1.05" fill="#ffc94a"/><circle r=".5" fill="#fff4b8"/></g>`,
            `0%{transform:translate(0px,0px) scale(.7);opacity:0}14%{opacity:1}100%{transform:translate(${e[3]}px,${-e[2]}px) scale(.25);opacity:0}`, e[4], { ease: "ease-out", op: 0, still: false })).join(""),
        // crackle: the outer, middle and inner tongues each flicker on their own quick, uneven beat, rooted at the base
        wrap: (h, svg) => {
          const pick = cols => (svg.match(new RegExp(`<path d="[^"]*" fill="#(?:${cols})"/>`, "g")) || []).join("");
          const rest = svg.replace(/<path d="[^"]*" fill="#(?:e5361b|ff7a1a|ffb62e|fff1a8)"\/>/g, "");
          const grp = (inner, kf, d) => `<g transform="translate(50 101)">${h.mv("crackle", `<g transform="translate(-50 -101)">${inner}</g>`, kf, d)}</g>`;
          return grp(pick("e5361b"), "0%,100%{transform:scale(1,1) rotate(0deg)}17%{transform:scale(1.012,1.055) rotate(.6deg)}33%{transform:scale(.992,.965) rotate(-.5deg)}56%{transform:scale(1.014,1.07) rotate(.4deg)}78%{transform:scale(1,.985) rotate(-.6deg)}", 1.7)
            + grp(pick("ff7a1a|ffb62e"), "0%,100%{transform:scale(1,1) rotate(0deg)}21%{transform:scale(.99,1.075) rotate(-.7deg)}38%{transform:scale(1.012,.96) rotate(.6deg)}62%{transform:scale(1,1.06) rotate(-.4deg)}81%{transform:scale(1.01,.98) rotate(.7deg)}", 1.25)
            + grp(pick("fff1a8"), "0%,100%{transform:scale(1,1)}14%{transform:scale(1.03,1.1)}29%{transform:scale(.97,.92)}46%{transform:scale(1.02,1.12)}63%{transform:scale(.98,.94)}82%{transform:scale(1.03,1.08)}", .95) + rest;
        }
      })
    },
    bg: (() => {
      const cloud = y => ({ t: "mv", svg: `<g fill="#fff" opacity=".6"><ellipse cx="0" cy="2" rx="9" ry="3"/><ellipse cx="-3.6" cy="-.4" rx="4.4" ry="3.2"/><ellipse cx="2" cy="-1.4" rx="5" ry="3.6"/></g>`, kf: `0%{transform:translate(-14px,${y}px);opacity:0}8%{opacity:1}92%{opacity:1}100%{transform:translate(114px,${y}px);opacity:0}`, dur: 52, o: { ease: "linear", still: false } });
      const walk = (pts, c, r, still) => ({ t: "walk", pts: pts.map(q => [q[0], q[1], q[2] || r, q[3] || c]), o: { still: still || 2 } });
      const beams = () => `<g>${[0, 1, 2, 3, 4, 5].map(i => `<path d="M0 0 L90 -14 L90 14Z" fill="${["#fff", "#ffe14d", "#4dffea"][i % 3]}" opacity=".13" transform="rotate(${i * 60})"/>`).join("")}</g>`;
      const discoDots = []; [2, 10, 13, 9].forEach(k => { const a = k * 2.4, r = 14 + (k % 4) * 11; discoDots.push([n2(50 + Math.cos(a) * r), n2(50 + Math.sin(a) * r)]); });
      return {
        night: () => ({ amb: [walk([[72, 12], [88, 28], [8, 52]], "#fff8dc", 2.5), walk([[30, 8], [20, 36], [60, 6]], "#e9efff", 2.1)] }),
        city: () => ({ amb: [walk([[23, 16], [78, 16], [46, 8]], "#fff", 2, 1), walk(CITY_PTS, "#ffe27a", 1.7)] }),
        auckland: () => ({ amb: [walk([[81, 78.6], [80.3, 38.2], [12, 71], [89, 66]], "#ffe9b0", 1.3, 1), { t: "mv", svg: '<circle cx="80.3" cy="12.6" r="2.4" fill="#ff4d4d"/>', kf: "0%,100%{opacity:.1}50%{opacity:.85}", dur: 2.4, o: { still: false } }] }),
        castleday: () => ({ amb: [cloud(9), walk([[26, 15.5, 2.2, "#fff8c8"], [28, 26, 1.8], [17.5, 27, 1.6, "#fff3b0"]], "#fff", 2, 2)] }),
        castle: () => ({ amb: [walk([[56, 8], [10, 38, 1.7], [16.5, 19, 1.6]], "#fff6dd", 2), walk([[78.1, 43], [78.1, 53], [90.1, 50]], "#ffd98a", 1.7)] }),
        lava: rc => { const bub = a => a.map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="${q[2]}" fill="#ffd36a"/>`).join(""), a = rc.anim;
          return { strip: a ? /<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="#ffd36a"\/>/g : null, amb: [
            { t: "mv", svg: bub([[18, 72, 3], [30, 90, 2]]), kf: "0%,100%{transform:translate(0px,0px)}25%{transform:translate(2.6px,-4.2px)}50%{transform:translate(-1.4px,-8px)}75%{transform:translate(-3px,-3.2px)}", dur: 7.5, o: { still: a } },
            { t: "mv", svg: bub([[80, 78, 4], [60, 90, 2.6]]), kf: "0%,100%{transform:translate(0px,0px)}30%{transform:translate(-3px,-5px)}60%{transform:translate(2px,-9px)}80%{transform:translate(3px,-3px)}", dur: 9.2, o: { still: a } },
            { t: "mv", svg: bub([[90, 60, 2]]), kf: "0%,100%{transform:translate(0px,0px)}35%{transform:translate(-2.4px,-3.6px)}70%{transform:translate(2px,-6.5px)}", dur: 6.4, o: { still: a } }] }; },
        disco: () => ({ amb: [{ t: "mv", svg: beams(), kf: "0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}", dur: 30, o: { ease: "linear" }, wrap: e => `<g transform="translate(50 50)">${e}</g>` }, walk(discoDots, "#fff", 2.2, 2)] }),
        galaxy: () => ({ amb: [walk([[70, 14], [10, 60, 2.2], [17, 23, 2.2], [91, 60, 2]], "#fff", 2.4), walk([[30, 12], [86, 40], [72, 11]], "#e6dcff", 2), { t: "mv", svg: c => { const i = c.id("ss"); c.defs += `<linearGradient id="${i}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="-26" y2="-11.4"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#bfa8ff" stop-opacity="0"/></linearGradient>`; return `<path d="M0 0 L-26 -11.4 L-25.4 -9.3 Z" fill="url(#${i})"/><circle r="1.2" fill="#fff"/>`; }, kf: "0%{transform:translate(8px,16px);opacity:0}3%{opacity:1}13%{transform:translate(50px,38px);opacity:0}100%{transform:translate(50px,38px);opacity:0}", dur: 11, o: { ease: "ease-out", still: false } }] }),
        synth: () => ({ amb: [{ t: "mv", svg: c => { const i = c.id("sc"); c.defs += `<linearGradient id="${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7ac8" stop-opacity="0"/><stop offset=".5" stop-color="#ffb3e0" stop-opacity=".9"/><stop offset="1" stop-color="#ff7ac8" stop-opacity="0"/></linearGradient>`; return `<rect x="0" y="-2" width="100" height="4" fill="url(#${i})"/>`; }, kf: "0%{transform:translateY(62px);opacity:0}12%{opacity:1}78%{opacity:1}100%{transform:translateY(98px);opacity:0}", dur: 5.4, o: { ease: "ease-in", still: false } }, walk([[20, 19], [79, 15], [22, 33], [80, 32]], "#fff", 2.1), walk([[10, 50, 1.8], [92, 48, 1.8, "#ffe9b8"], [26, 22, 1.6, "#ffd1ee"]], "#fff", 1.8)] })
      };
    })()
  };

  function renderSvg(look, opts) {
    opts = opts || {};
    look = cleanLook(look);
    const ctx = makeCtx();
    const size = opts.size || 100;
    // animate: true/false wins; otherwise only the big editor-size preview (100px+) moves
    const anim = opts.animate === undefined ? size >= 100 : !!opts.animate;
    const gd = GENDERS[look.gender] || GENDERS.neutral;
    const T = s => gd.sx === 1 || !s ? s : `<g transform="translate(50 0) scale(${gd.sx} 1) translate(-50 0)">${s}</g>`;
    const co = COSTUMES[look.costume] ? COSTUMES[look.costume](ctx) : null;
    const hide = Object.assign({}, (co && co.hide) || {});
    const hatOn = !hide.hat && HAT_COVER.has(look.hat);
    ctx.hat = hatOn && HAT_HAIR.has(look.hair); ctx.anim = anim;
    if (hatOn && !ctx.hat) hide.hair = 1;   // long styles stay: only the hair that comes out from under the hat shows
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

    // Epic / Legendary layers actually drawn for this look (none for tiers 0-2)
    const FXL = [];
    const L = (key, cat, ok) => { if (!ok) return; const id = look[cat], t = tierOf(cat, id); if (t >= 3 && (key === "pet" || (RSPEC[key] && RSPEC[key][id]))) FXL.push({ key, tier: t, id }); };
    L("costume", "costume", !!co);
    L("top", "top", !(co && co.body !== undefined) && !hide.top && !!TOPS[look.top]);
    L("hat", "hat", !hide.hat && !!HATS[look.hat]);
    L("glasses", "glasses", !!GLASS[look.glasses] && (!hide.face || !!(co && co.eyesOnTop)));
    L("hair", "hair", !hide.hair && !!HAIR[look.hair]);
    L("hairc", "hairColor", !hide.hair && !!HAIR[look.hair] && look.hair !== "bald");
    L("extra", "extra", !hide.extra && !!EXTRA[look.extra]);
    L("eyes", "eyes", !hide.face);
    L("mouth", "mouth", !hide.face && look.face !== "mask");
    L("face", "face", !hide.face && !!FACE[look.face] && look.face !== "mask");
    L("pet", "pet", !!PETS[look.pet]);
    L("fx", "fx", true);
    L("bg", "bg", true);
    const E = FXL.length ? fxState(ctx, anim, FXL, { ctx, gd, look, anim }) : NOFX;

    let s = E.bg((BG[look.bg] || BG.sky)(ctx));
    s += E.post("bg");
    if (co && co.back) s += co.back;
    const hair = !hide.hair && HAIR[look.hair] ? HAIR[look.hair](hcol, hairDark, ctx) : {};
    s += E.pre("hair") + E.pre("hairc");
    if (hair.back) s += E.wrap("hair", hair.back, "back");
    const ex = !hide.extra && EXTRA[look.extra] ? EXTRA[look.extra](ctx) : {};
    if (ex.back) s += ex.back;

    // body / outfit (scaled by body type), neck, then the outfit's collar and details
    let top = { body: "", over: "" };
    if (co && co.body !== undefined) top = { body: co.body, over: co.over || "" };
    else if (!hide.top && TOPS[look.top]) top = TOPS[look.top](tc, td, tl, ctx);
    s += E.pre("costume") + E.pre("top");
    s += T(E.wrap("top", top.back || "", "back") + E.wrap("top", top.body || "", "body"));
    const nw = gd.neck;
    if (!hide.head) s += `<path d="M${50 - nw / 2} 60 h${nw} v17 q${-nw / 2} 8 ${-nw} 0z" fill="${sk2}"/>`;
    s += T(top.over && E.wrap(co && co.body !== undefined ? "costume" : "top", top.over, "over")) + T(E.post("top"));
    if (!hide.head) {
      const e1 = gd.ear, e2 = 100 - gd.ear;
      s += `<ellipse cx="${e1}" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="${e2}" cy="46" rx="3.6" ry="5" fill="${skin}"/><ellipse cx="${e1 + .4}" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/><ellipse cx="${e2 - .4}" cy="46.6" rx="1.6" ry="2.6" fill="${sk2}" opacity=".6"/>`;
      s += `<ellipse cx="50" cy="${gd.cy}" rx="${gd.rx}" ry="${gd.ry}" fill="${skin}"/>`;
    }
    const brows = () => (BROWS[look.brows] || BROWS.natural)(browCol, gd);
    const eyesAndBrows = () => E.wrap("eyes", (EYES[look.eyes] || EYES.dots)(skin)) + brows() + E.post("eyes");
    if (!hide.face) {
      if (FACE[look.face] && look.face !== "mask") s += E.wrap("face", FACE[look.face](hairDark, ctx, look.warpaintColor)) + E.post("face");
      if (!co || !co.eyesOnTop) s += eyesAndBrows();
      s += `<ellipse cx="50" cy="50.4" rx="${gd.nx}" ry="${gd.ny}" fill="${sk2}"/>`;
      if (look.face === "mask") s += FACE.mask(hairDark, ctx);
      else s += E.wrap("mouth", (MOUTH[look.mouth] || MOUTH.smile)(ctx)) + E.post("mouth");
    }
    if (hair.front) { const hfr = E.wrap("hair", hair.front, "front"); s += ((!hide.hat && HAT_COVER.has(look.hat)) || (co && co.clipHair)) ? ctx.clip("M0 31 H100 V100 H0Z", hfr) : hfr; }
    { const hf = E.post("hair") + E.post("hairc"); if (hf) s += ((!hide.hat && HAT_COVER.has(look.hat)) || (co && co.clipHair)) ? ctx.clip("M0 31 H100 V100 H0Z", hf) : hf; }
    if (!hide.hat && HATS[look.hat]) s += E.pre("hat") + E.wrap("hat", HATS[look.hat](ctx)) + E.post("hat");
    if (!hide.face && GLASS[look.glasses] && !(co && co.eyesOnTop)) s += E.pre("glasses") + E.wrap("glasses", GLASS[look.glasses](ctx)) + E.post("glasses");
    s += E.pre("extra");
    if (ex.over) s += E.wrap("extra", ex.over);
    if (ex.front) s += ex.front;
    s += E.post("extra");
    if (co && co.front) s += E.wrap("costume", co.front);
    s += E.post("costume");
    if (PETS[look.pet]) s += E.pet(PETS[look.pet](gd, ctx, E.petA));
    if (co && co.eyesOnTop) { s += eyesAndBrows(); if (GLASS[look.glasses]) s += E.pre("glasses") + E.wrap("glasses", GLASS[look.glasses](ctx)) + E.post("glasses"); }
    s += E.pre("fx") + E.wrap("fx", (FX[look.fx] || FX.none)(ctx)) + E.post("fx");

    const cid = ctx.id("cp");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${opts.label ? String(opts.label).replace(/[<>&"]/g, "") : "Avatar"}"><defs><clipPath id="${cid}"><circle cx="50" cy="50" r="50"/></clipPath>${ctx.defs}${E.css()}${ctx.css ? `<style>${ctx.css}@media (prefers-reduced-motion:reduce){.t29sw{animation:none!important}}</style>` : ""}</defs><g clip-path="url(#${cid})">${s}</g></svg>`;
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
    if (av && av.on && av.look) {
      if (un) SEEN[un] = { name: name, look: av.look };
      return `<span class="student-avatar av-img"${attr}${style} title="${esc(name)}" role="button" tabindex="0" aria-label="View ${esc(name || "this")} avatar larger">${renderSvg(av.look, { size: sz || 38, label: name })}</span>`;
    }
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
.student-avatar.av-img{flex:none;aspect-ratio:1/1;}
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
.av-prev{width:200px;height:200px;min-width:200px;min-height:200px;flex:none;aspect-ratio:1/1;border-radius:50%;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.2);line-height:0;}
.av-prev svg{display:block;width:100%;height:100%;}
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
.av-tile .av-t-img{width:68px;height:68px;flex:none;aspect-ratio:1/1;border-radius:50%;overflow:hidden;line-height:0;}
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
html.dark-mode .av-tile .av-t-price.own{color:#5be3a5;}
html.dark-mode .av-self-btn .av-pen{border-color:#1a2036;}
.av-img[data-av-user]{cursor:zoom-in;transition:transform .15s ease,box-shadow .15s ease;}
.av-img[data-av-user]:hover{transform:scale(1.08);}
.av-img[data-av-user]:focus-visible{outline:3px solid var(--gold,#f5b82e);outline-offset:2px;}
.av-lb{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(15,20,40,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:avLbFade .18s ease-out both;overscroll-behavior:contain;}
.av-lb.av-lb-out{animation:avLbFadeOut .17s ease-in both;}
.av-lb.av-lb-out .av-lb-card{animation:avLbPopOut .17s ease-in both;}
.av-lb-card{position:relative;width:min(400px,100%);max-height:calc(100vh - 28px);max-height:calc(100dvh - 28px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1f2b44);border-radius:24px;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:avLbPop .32s cubic-bezier(.2,1.25,.4,1) both;}
.av-lb-hero{position:relative;display:flex;align-items:center;justify-content:center;padding:34px 20px 30px;background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.16),rgba(255,255,255,0) 62%),linear-gradient(160deg,var(--navy-500,#4a5a85),var(--navy-900,#1f2b44));}
.av-lb-av{width:min(270px,64vw,38vh);aspect-ratio:1/1;border-radius:50%;overflow:hidden;line-height:0;flex:none;background:#fff;box-shadow:0 0 0 6px rgba(255,255,255,.92),0 14px 36px rgba(0,0,0,.4);}
.av-lb-av svg{display:block;width:100%;height:100%;}
.av-lb-t2 .av-lb-av{box-shadow:0 0 0 6px #3a8dff,0 0 30px 4px rgba(58,141,255,.45),0 14px 36px rgba(0,0,0,.4);}
.av-lb-t3 .av-lb-av{box-shadow:0 0 0 6px #a45cff,0 0 38px 8px rgba(164,92,255,.55),0 14px 36px rgba(0,0,0,.4);}
.av-lb-t4 .av-lb-av{box-shadow:0 0 0 6px #ffb020,0 0 46px 12px rgba(255,176,32,.6),0 14px 36px rgba(0,0,0,.4);}
.av-lb-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:1.5rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s;}
.av-lb-x:hover{background:rgba(255,255,255,.32);transform:scale(1.08);}
.av-lb-x:focus-visible{outline:3px solid var(--gold,#f5b82e);outline-offset:2px;}
.av-lb-info{padding:18px 22px 24px;text-align:center;}
.av-lb-name{margin:0 0 8px;font-size:1.5rem;line-height:1.2;word-break:break-word;}
.av-lb-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-weight:800;font-size:.82rem;color:#fff;background:#9aa3b5;}
.av-lb-p2{background:#3a8dff}.av-lb-p3{background:#a45cff}.av-lb-p4{background:linear-gradient(135deg,#ffb020,#ff8a1f);color:#3b2600;}
.av-lb-sub{font-size:.9rem;opacity:.7;}
.av-lb-sec{margin:18px 0 8px;font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.6;}
.av-lb-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;}
.av-lb-chip{display:inline-flex;align-items:center;gap:6px;background:#f1f4fb;border:1.5px solid var(--line,#e3e7f0);border-radius:999px;padding:4px 10px;font-weight:700;font-size:.82rem;line-height:1.2;}
.av-lb-chip small{opacity:.55;font-weight:600;font-size:.72rem;}
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
html.dark-mode .av-lb-card{box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.08);}`;
    st.textContent += `
/* Avatar editor: keep labels inside pills, even in a short or narrow modal. */
.av-tabs{flex:0 0 auto;align-items:center;min-height:52px;overflow-x:auto;overflow-y:hidden;padding:4px 2px 10px;max-width:100%;scroll-padding-inline:4px;}
.av-tabs .av-tab{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:38px;height:auto;max-width:none;padding:8px 14px;line-height:1.25;white-space:nowrap;overflow-wrap:normal;word-break:normal;box-sizing:border-box;margin:0;}
.av-right{min-height:0;min-width:0;}
.av-hint{flex:0 0 auto;line-height:1.45;overflow-wrap:anywhere;}
.av-grid{min-height:0;align-content:start;grid-template-columns:repeat(auto-fill,minmax(min(92px,100%),1fr));}
.av-tile{min-width:0;}
.av-tile .av-t-name,.av-tile .av-t-price{max-width:100%;overflow-wrap:anywhere;line-height:1.3;}
.av-lb-chip,.av-chip{max-width:100%;height:auto;min-height:28px;white-space:normal;overflow-wrap:anywhere;}
.av-lb-chip>span{min-width:0;}
.av-paint-box{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;flex:none;padding:10px 12px;margin:0 0 10px;border:1px solid var(--line,#e3e7f0);border-radius:12px;}
.av-paint-box[hidden]{display:none;}
.av-paint-title{font-weight:600;font-size:.85rem;flex:none;}
.av-swatches{display:flex;flex-wrap:wrap;gap:8px;flex:none;}
.av-sw{width:30px;height:30px;min-height:30px;padding:0;border-radius:50%;background:var(--sw);border:2px solid #fff;box-shadow:0 0 0 1px rgba(30,40,80,.28);cursor:pointer;transition:transform .12s;}
.av-sw:hover:not(:disabled){transform:scale(1.1);}
.av-sw:focus-visible{outline:2px solid var(--brand,#3a6cf0);outline-offset:3px;}
.av-sw.on{box-shadow:0 0 0 2.5px var(--brand,#3a6cf0);transform:scale(1.08);}
.av-sw:disabled{opacity:.55;cursor:default;}
.av-paint-box .av-paint-note{flex:1 1 180px;min-width:0;font-size:.78rem;line-height:1.4;color:var(--muted,#6b7390);}
@media(max-width:700px){.av-right{flex:0 0 auto;}.av-grid{max-height:48vh;}.av-tabs{min-height:52px;}}
`;
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

  /* ---------------- enlarged avatar view (click anyone else's avatar) ---------------- */
  const SEEN = {};   // username -> { name, look } for every avatar badge drawn on this page
  let LB = null;
  function lbItems(look) {
    const out = [];
    CATS.forEach(c => {
      const it = c.list.find(i => i[0] === look[c.id]);
      if (it && it[2] > 0) out.push({ cat: c.label, name: it[1], r: it[2] });
    });
    return out.sort((a, b) => b.r - a.r);
  }
  // Overall rarity = average rarity of every equipped item, rounded up (0 Starter .. 4 Legendary).
  // Only non-starter items are averaged; starter items and empty ("none") slots are ignored. No non-starter items = Starter.
  function lbAvg(look) {
    let sum = 0, n = 0;
    CATS.forEach(c => {
      if (look[c.id] === C.NONE_IDS[c.id]) return;
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
    let info = SEEN[un];
    if (!info) {
      try {
        const u = await getUserCached(un);
        if (u && u.avatar && u.avatar.on && u.avatar.look) info = SEEN[un] = { name: u.name || "", look: u.avatar.look };
      } catch (e) { /* ignore */ }
    }
    if (!info || LB || document.getElementById("avLb")) return;
    css();
    const look = cleanLook(info.look), name = info.name || "Student";
    const items = lbItems(look), ra = lbAvg(look), top = ra.tier, MAX = 12;
    const chips = items.slice(0, MAX).map(i => `<span class="av-lb-chip"><i class="av-lb-dot av-r${i.r}"></i><span>${esc(i.name)}</span><small>${esc(i.cat)}</small></span>`).join("")
      + (items.length > MAX ? `<span class="av-lb-chip av-lb-more">+${items.length - MAX} more</span>` : "");
    const ov = document.createElement("div");
    ov.id = "avLb"; ov.className = "av-lb";
    ov.innerHTML = `<div class="av-lb-card" role="dialog" aria-modal="true" aria-label="${esc(name)}'s avatar">
      <div class="av-lb-hero av-lb-t${top}">
        <button class="av-lb-x" type="button" aria-label="Close">\u00d7</button>
        <div class="av-lb-av">${renderSvg(look, { size: 300, animate: true, label: name + "'s avatar" })}</div>
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
      openAvatarView(un, el);
    }, true);
    document.addEventListener("keydown", e => {
      if (LB || (e.key !== "Enter" && e.key !== " ")) return;
      const el = e.target;
      if (el && el.matches && el.matches(".student-avatar.av-img[data-av-user][role=button]")) { e.preventDefault(); el.click(); }
    });
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
    document.querySelectorAll("#avTabs .av-tab").forEach(b => b.classList.toggle("on", b.dataset.cat === E.cat));
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
    $("avSum").innerHTML = cart.length ? `Buying ${cart.length} new item${cart.length === 1 ? "" : "s"}: <b>${fmtPrice(E.shop, total)}</b>${total > bal ? ` <span style="color:#b8402c">(not enough)</span>` : ""}` : "Nothing to buy.";
    $("avSave").textContent = cart.length ? "Buy & save" : "Save";
  }
  async function saveEditor(close) {
    const E = ED; if (!E || E.busy) return;
    E.busy = true;
    const savedLook = cleanLook(E.look);
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
        await logTxn(ME.classCode, { type: "store-buy", from: ME.username, amount: paid, note: "Avatar items: " + names.join(", ") }).catch(() => {});
      }
      E.look = savedLook;
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
        b.innerHTML = badge({ username: u.username, name: u.name, avatar: me && me.avatar }, { size: 56 }).replace('class="student-avatar', 'class="av-big student-avatar').replace(/ role="button" tabindex="0" aria-label="[^"]*"/, "") + `<span class="av-pen">\u270e</span>`;
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
