const { REAL_STOCKS } = require("../real-stocks.js");
const { request } = require("./providers.cjs");

const nzCalendar = "https://www.nzx.com/markets/NZSX/dividends";
const historyURL = s => s.exchange === "NZX" ? nzCalendar : s.vanguardId
  ? "https://investor.vanguard.com/investment-products/etfs/profile/" + s.symbol.toLowerCase()
  : "https://www.nasdaq.com/market-activity/stocks/" + s.symbol.toLowerCase() + "/dividend-history";

function usDate(text) {
  const parts = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(text);
  return parts && [parts[3], parts[1], parts[2]].join("-");
}

function nzDate(text) {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})\b/.exec(text);
  const month = m && "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").indexOf(m[2]) + 1;
  return month > 0 && [m[3], String(month).padStart(2,"0"), m[1].padStart(2,"0")].join("-");
}

function event(s, ex, pay, cents, currency) {
  if (![ex,pay].every(d => typeof d === "string" && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d)
      || pay < ex || !(cents > 0) || !Number.isFinite(cents) || !["AUD","NZD","USD"].includes(currency))
    throw new Error("Invalid cash declaration for " + s.symbol);
  return {ex, pay, cents, currency, source:historyURL(s), zone:s.exchange === "NZX" ? "Pacific/Auckland" : "America/New_York"};
}

function nzEvents(html) {
  const result = new Map(REAL_STOCKS.filter(s => s.exchange === "NZX").map(s => [s.symbol, []]));
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>m[1])
    .find(t => /Imputation/i.test(t) && /Payable/i.test(t) && /Currency/i.test(t));
  if (!table) throw new Error("NZX dividend calendar unavailable");
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
    const s = REAL_STOCKS.find(s => s.symbol === cells[0] && s.exchange === "NZX");
    if (!s) continue;
    const amount = /^(\d+(?:\.\d+)?)c$/.exec(cells[6]);
    result.get(s.symbol).push(event(s, nzDate(cells[2]), nzDate(cells[4]), amount && Number(amount[1]), cells[5]));
  }
  return result;
}

function usEvents(s, body) {
  if (s.vanguardId) {
    const html = body.replace(/&#34;|&quot;/g,'"');
    const match = /"incomeCapitalGains"\s*:\s*(\[[^\]]*\])/.exec(html);
    if (!match) throw new Error("Vanguard distribution history unavailable");
    return JSON.parse(match[1]).filter(r => r.type === "Dividend").map(r =>
      event(s, usDate(r.reInvestDate), usDate(r.payableDate), Number(r.share.replace(/^\$/,"")) * 100, "USD"));
  }
  const json = JSON.parse(body);
  const rows = json.data?.dividends?.rows;
  if (json.status?.rCode !== 200) throw new Error("Nasdaq dividend feed unavailable");
  if (!rows && /never provided a dividend/i.test(json.message || "")) return [];
  if (!Array.isArray(rows)) throw new Error("Nasdaq dividend history unavailable");
  return rows.filter(r => /^(cash|special cash|special)$/i.test(r.type) && usDate(r.exOrEffDate) && usDate(r.paymentDate)).map(r =>
    event(s, usDate(r.exOrEffDate), usDate(r.paymentDate), Number(r.amount.replace(/^\$/,"")) * 100, r.currency));
}

async function fetchIssuerEvents() {
  const events = new Map(), errors = [];
  async function load(label, fn) {
    try { for (const [symbol, rows] of await fn()) events.set(symbol, rows); }
    catch (err) { errors.push(label + ": " + err.message); }
  }
  await Promise.all([
    load("NZX", async () => nzEvents(await (await request(nzCalendar)).text())),
    ...REAL_STOCKS.filter(s=>s.exchange !== "NZX").map(s => load(s.symbol, async () => {
      const url = s.vanguardId ? historyURL(s) : "https://api.nasdaq.com/api/quote/" + s.symbol + "/dividends?assetclass=stocks";
      return [[s.symbol, usEvents(s, await (await request(url, {headers:{"User-Agent":"Mozilla/5.0", Accept:"*/*"}})).text())]];
    }))
  ]);
  return {events, errors};
}

module.exports = { fetchIssuerEvents, nzEvents, usEvents, historyURL };
