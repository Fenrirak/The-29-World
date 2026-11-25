const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

async function request(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
    if (res.ok) return res;
    if (attempt === 2 || (res.status !== 429 && res.status < 500)) {
      throw new Error(new URL(url).hostname + " returned " + res.status);
    }
    const wait = Number(res.headers.get("retry-after")) || 5;
    await delay(Math.min(60, Math.max(2, wait)) * 1000);
  }
}

function newestBar(bars, dateField, cutoff) {
  const recent = bars.filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b[dateField]?.slice(0, 10)) &&
    b[dateField].slice(0, 10) <= cutoff);
  recent.sort((a, b) => b[dateField].localeCompare(a[dateField]));
  if (!recent.length) throw new Error("No completed trading session");
  return recent[0];
}

async function nasdaqQuote(s, cutoff) {
  if (!process.env.STOCKMARKET_API_KEY) throw new Error("Missing free Stock Market API key");
  const base = "https://stockmarketapi.ai/api/v1/companies/" + s.symbol;
  const headers = { "X-API-Key": process.env.STOCKMARKET_API_KEY };
  const [company, series] = await Promise.all(["?exchange=NASDAQ", "/prices?exchange=NASDAQ&range=1W&interval=1d"]
    .map(async suffix => (await request(base + suffix, { headers })).json()));
  if (company.ticker !== s.symbol || company.exchange?.toUpperCase() !== "NASDAQ" || series.ticker !== s.symbol ||
      series.currency !== "USD" || !company.name?.toLowerCase().includes(s.name.toLowerCase())) {
    throw new Error("Nasdaq listing or currency mismatch");
  }
  const bar = newestBar(series.bars, "t", cutoff);
  return {symbol: s.symbol, price: bar.close_split_adjusted, date: bar.t.slice(0, 10),
    totalShares: company.shares_outstanding, sharesDate: (company.profile_updated_at || company.updated_at || "").slice(0, 10)};
}

async function etfQuote(fund, cutoff) {
  let price, date, units, sharesDate;
  if (fund.vanguardId) {
    const base = "https://advisors.vanguard.com/investments/products/api/funds/" + fund.vanguardId + "/";
    const [profile, closing, supply] = await Promise.all(["profile", "pricing/closing", "pricing/outstanding-shares"]
      .map(async path => (await request(base + path)).json()));
    if (profile.iovTicker !== fund.symbol + ".IV") throw new Error("Vanguard fund mismatch");
    price = closing.marketPrice?.price;
    date = closing.marketPrice?.effectiveDate;
    units = supply.outstandingShares;
    sharesDate = supply.effectiveDate;
  } else {
    const q = await (await request("https://service.smartshares.co.nz/stock?stock=" + fund.symbol)).json();
    if (q.stock !== fund.symbol) throw new Error("Smart fund mismatch");
    price = q.price;
    date = sharesDate = q.date;
    units = q.issuedShares;
  }
  if (date > cutoff || sharesDate > cutoff) throw new Error("ETF data is newer than the completed session");
  // The class trades whole units. Preserve Vanguard's fractional reported total for the preview.
  return {symbol:fund.symbol, price, date, totalShares:Math.floor(units), reportedUnits:units,
    sharesDate, source:fund.issuer};
}

// Nasdaq ANT began trading on 19 November. Several feeds still map the bare
// ticker to Antimony Resources. Keep an issuer-verified starting quote until
// this feed has both the correct company identity and a completed session.
const anthropicOpeningQuote = {
  symbol: "ANT", price: 88.91, date: "2026-11-20",
  totalShares: 13366642276, sharesDate: "2026-11-20", source: "Anthropic Investor Relations"
};
// Price: https://investor.anthropic.com/stock-quote/stock-quote/default.aspx
// Total common shares after full exercise: SEC final 424B4, and issuer IPO closing confirmation.
// https://www.sec.gov/Archives/edgar/data/2130357/000162828026074944/anthropicpbc-424b4.htm
// https://www.anthropic.com/news/ipo-close

async function anthropicIssuerClose(prior, cutoff) {
  const url = "https://investor.anthropic.com/stock-quote/stock-quote/default.aspx";
  const html = await (await request(url)).text();
  const plain = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>|&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const trade = plain.match(/Last trade\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}\s*[AP]M/i);
  const price = plain.match(/\bPrice\s*\$\s*([\d,]+\.\d+)\s+Volume/i);
  if (!trade || !price) throw new Error("Issuer closing quote unavailable");
  const date = trade[3] + "-" + trade[1].padStart(2,"0") + "-" + trade[2].padStart(2,"0");
  if (date > cutoff) throw new Error("Issuer closing session is incomplete");
  return {...prior, price:Number(price[1].replaceAll(",","")), date, source:"Anthropic Investor Relations"};
}

// NZXplorer publishes a keyless read-only MCP endpoint with a structured data envelope.
async function nzx(tool, args) {
  const response = await request("https://mcp.nzxplorer.co.nz", {
    method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: tool, arguments: args}})
  });
  const envelope = (await response.json()).result?.structuredContent;
  if (envelope?.meta?.availability_status !== "ok" || envelope.tool !== tool) throw new Error("NZXplorer data unavailable");
  if (typeof envelope.data !== "string") return envelope.data;
  const wrapper = '<untrusted_tool_result tool="' + tool + '">';
  const text = envelope.data.trim();
  if (!text.startsWith(wrapper) || !text.endsWith("</untrusted_tool_result>")) throw new Error("Invalid NZXplorer response");
  return JSON.parse(text.slice(wrapper.length, -"</untrusted_tool_result>".length).trim());
}

function issuedShares(text, s) {
  if (s.symbol === "ANZ" || s.symbol === "WBC") {
    // These dual-listed banks file ASX Appendix 2A/3G on NZX. Section 4.1
    // reports the full quoted class; the first page reports only the new issue.
    const quoted = text.match(/4\.1\s+Quoted \+?securities([\s\S]*?)4\.2\s+Unquoted/i);
    const row = quoted?.[1].match(new RegExp("^\\s*" + s.symbol + "\\s*:\\s*ORDINARY FULLY PAID[ \\t]+([\\d,]+)[ \\t]*$", "im"));
    if (row) return Number(row[1].replaceAll(",", ""));
  }
  // Only accept the new total for the allowlisted ordinary-share ISIN. A capital
  // notice can also contain treasury shares, options, or just the size of an issue.
  if (!text.includes(s.isin) || !/ordinary (?:fully paid )?shares/i.test(text)) return null;
  const section = text.match(/Total number of Financial Products of the[\s\S]{0,1600}?(?=In the case of|Specific authority|Section 3|$)/i);
  if (!section) return null;
  const match = section[0].match(/\b(\d{1,3}(?:,\d{3}){2,}|\d{7,})\b/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

async function latestSupply(s, previous, cutoff) {
  const baseline = previous?.sharesDate >= s.sharesDate ? previous : { totalShares: s.issued, sharesDate: s.sharesDate };
  const from = new Date(Date.parse(baseline.sharesDate) + 86400000).toISOString().slice(0, 10);
  if (from > cutoff) return baseline;
  const notices = await nzx("search_announcements", {ticker: s.symbol, type: "SECISSUE", from, to: cutoff, limit: 12});
  for (const row of notices.sort((a,b) => b.announcement_date.localeCompare(a.announcement_date) || Number(b.announcement_id) - Number(a.announcement_id))) {
    if (row.issuers?.ticker !== s.symbol || row.announcement_date < from || row.announcement_date > cutoff) continue;
    for (const url of row.pdf_urls || []) {
      if (!/^https:\/\/api\.nzx\.com\/public\/announcement\/\d+\/attachment\/\d+\/[\w.-]+\.pdf$/i.test(url)) continue;
      const bytes = Buffer.from(await (await request(url, {redirect: "error"})).arrayBuffer());
      const pdf = spawnSync("pdftotext", ["-layout", "-", "-"], {input: bytes, encoding: "utf8", maxBuffer: 8000000, timeout: 15000});
      if (pdf.error) throw pdf.error;
      const totalShares = pdf.status === 0 && issuedShares(pdf.stdout, s);
      if (totalShares) return { totalShares, sharesDate: row.announcement_date };
    }
  }
  return baseline;
}

async function nzQuote(s, previous, cutoff) {
  const data = await nzx("get_stock_prices", {ticker:s.symbol, days:10});
  if (data.ticker !== s.symbol) throw new Error("NZX listing mismatch");
  const bar = newestBar(data.prices, "date", cutoff);
  let supply;
  try {
    supply = await latestSupply(s, previous, cutoff);
  } catch (e) {
    // Disclosure and price feeds can fail independently. Keep the original
    // supply date so that today's verified close can still reach the class.
    console.warn(s.symbol + " share-count check: " + e.message);
    supply = previous || {totalShares:s.issued, sharesDate:s.sharesDate};
  }
  return {symbol:s.symbol, price:bar.close, date:bar.date, totalShares:supply.totalShares, sharesDate:supply.sharesDate};
}

module.exports = { request, nasdaqQuote, nzQuote, etfQuote, newestBar, issuedShares, anthropicOpeningQuote, anthropicIssuerClose };
