/* Shared by the market page and its nightly importer. */
const REAL_STOCKS = [
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["GOOGL", "Alphabet"], ["ANT", "Anthropic"],
  ["FPH", "Fisher & Paykel Healthcare", "NZFAPE0001S2", 588265424],
  ["AIA", "Auckland International Airport", "NZAIAE0002S6", 1704603694],
  ["MCY", "Mercury NZ", "NZMRPE0001S2", 1436932703],
  ["MFT", "Mainfreight", "NZMFTE0001S9", 100698548],
  ["WBC", "Westpac Banking Corporation", "AU000000WBC1", 3420303305],
  ["ANZ", "ANZ Group Holdings", "AU000000ANZ3", 3015919897]
].map(([symbol, name, isin, issued]) => ({
  symbol, name, exchange: isin ? "NZX" : "Nasdaq", currency: isin ? "NZD" : "USD",
  // Securities Issued on each NZX ordinary-share instrument, checked 23 November 2026.
  isin, issued, sharesDate: isin ? "2026-11-23" : null
})).concat([
  {symbol:"NZG", name:"Smart S&P/NZX 50 ETF", exposure:"Tracks 50 of the largest NZX-listed companies.", annualFee:"0.20%"},
  {symbol:"MDZ", name:"Smart NZ Mid Cap ETF", exposure:"Tracks mid-sized New Zealand companies.", annualFee:"0.60%"},
  {symbol:"AUS", name:"Smart Australian Top 200 ETF", exposure:"Tracks 200 large Australian companies.", annualFee:"0.30%"},
  {symbol:"VTI", name:"Vanguard Morningstar Total Stock Market ETF", exposure:"Tracks large, medium and small US companies.", annualFee:"0.03%", vanguardId:"0970"},
  {symbol:"VOO", name:"Vanguard S&P 500 ETF", exposure:"Tracks the large US companies in the S&P 500.", annualFee:"0.03%", vanguardId:"0968"}
].map(fund => ({...fund, kind:"etf", exchange:fund.vanguardId ? "NYSE Arca" : "NZX",
  currency:fund.vanguardId ? "USD" : "NZD", issuer:fund.vanguardId ? "Vanguard" : "Smart"})));

function realDateKeyValid(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validRealQuote(q) {
  return !!q && Number.isFinite(q.price) && q.price > 0 &&
    Number.isSafeInteger(q.totalShares) && q.totalShares > 0 &&
    (q.reportedUnits === undefined || (Number.isFinite(q.reportedUnits) && Math.floor(q.reportedUnits) === q.totalShares)) &&
    realDateKeyValid(q.date) && realDateKeyValid(q.sharesDate);
}

function applyRealQuote(co, q, day) {
  if (!validRealQuote(q) || q.symbol !== co.realSymbol || q.date < co.quoteDate) return false;
  const held = Object.values(co.holders || {}).reduce((sum, n) => sum + n, 0);
  if (q.totalShares < held) throw new Error("Reported supply is below classroom holdings");
  const history = co.history?.length ? co.history : [co.price];
  const dates = (co.historyDates || []).slice(-history.length);
  if (q.date === co.quoteDate && q.price === co.price &&
      q.totalShares === co.totalShares && q.sharesDate === co.sharesDate &&
      (q.source || "") === (co.quoteSource || "") && q.reportedUnits === co.reportedUnits && co.history?.length) return false;
  if (co.quoteDate !== q.date) {
    co.history = [...history, q.price].slice(-30);
    co.historyDates = [...Array(history.length - dates.length).fill(""), ...dates, day].slice(-30);
  } else {
    co.history = [...history.slice(0, -1), q.price];
    co.historyDates = [...Array(history.length - Math.max(dates.length, 1)).fill(""), ...(dates.length ? dates : [day])];
  }
  Object.assign(co, { price: q.price, quoteDate: q.date, sharesDate: q.sharesDate, quoteSource: q.source || "",
    totalShares: q.totalShares, availableShares: q.totalShares - held });
  if (q.reportedUnits !== undefined) co.reportedUnits = q.reportedUnits;
  return true;
}

if (typeof module !== "undefined") module.exports = { REAL_STOCKS, validRealQuote, applyRealQuote };
