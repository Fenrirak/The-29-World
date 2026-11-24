/* 29 World™ — status page.
   Checks, from this device, whether each part of the site can be reached, and shows the results.
   Every check is a HEAD request with no cookies and no account or class data, and nothing is stored.
   The service worker (notif-sw.js) only handles GET requests, so HEAD checks always go to the network
   and a result is never a saved copy. */
(() => {
  "use strict";

  /* The page's questions quote the first two figures (3 and 10 seconds). Change them together. */
  const SLOW_MS = 3000;       // answered, but only after this long = "Slow"
  const TIMEOUT_MS = 10000;   // no answer by then = "Can't reach"
  const REFRESH_MS = 60000;   // automatic re-check while the page is open and visible
  const HISTORY_MAX = 20;     // checks kept for the small trend bars (this visit only)

  /* One entry per row in status.html (matched by data-service). A service is "Working" only when every
     address in it answers. The other addresses are the ones the site's sign-in, saving and security
     check use (see firebase-init.js). They are opaque no-cors checks: any answer counts as reachable. */
  const SERVICES = [
    { id: "website", hosts: [{ label: location.host || "this website", url: "index.html", same: true }] },
    { id: "signin", hosts: [
      { label: "identitytoolkit.googleapis.com", url: "https://identitytoolkit.googleapis.com/" },
      { label: "securetoken.googleapis.com", url: "https://securetoken.googleapis.com/" }] },
    { id: "data", hosts: [{ label: "firestore.googleapis.com", url: "https://firestore.googleapis.com/" }] },
    { id: "security", hosts: [
      { label: "content-firebaseappcheck.googleapis.com", url: "https://content-firebaseappcheck.googleapis.com/" },
      { label: "www.google.com", url: "https://www.google.com/recaptcha/api.js" }] },
    { id: "files", hosts: [{ label: "www.gstatic.com", url: "https://www.gstatic.com/firebasejs/" }] }
  ];

  const $ = id => document.getElementById(id);
  const summary = $("statusSummary");
  if (!summary) return;
  const summaryIcon = $("statusSummaryIcon");
  const headline = $("statusHeadline");
  const sub = $("statusSub");
  const actions = $("statusActions");
  const refreshBtn = $("statusRefresh");
  const refreshLabel = $("statusRefreshLabel");
  const checkedEl = $("statusChecked");

  /* Icons in the same style as icons.js: 24px grid, round caps, drawn in currentColor. */
  const STROKE = 'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
  const svg = body => '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' + body + "</svg>";
  const ICON = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" ' + STROKE + "/>"),
    clock: svg('<circle cx="12" cy="12" r="8.5" ' + STROKE + '/><path d="M12 7.5V12l3 2" ' + STROKE + "/>"),
    cross: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ' + STROKE + "/>"),
    dash: svg('<path d="M6 12h12" ' + STROKE + "/>")
  };

  /* Row badges reuse the site's .badge colours. */
  const BADGE = {
    checking: { tone: "navy", icon: "clock", label: "Checking…" },
    ok: { tone: "mint", icon: "check", label: "Working" },
    slow: { tone: "gold", icon: "clock", label: "Slow" },
    down: { tone: "coral", icon: "cross", label: "Can’t reach" },
    offline: { tone: "navy", icon: "dash", label: "Not checked" }
  };
  const SUMMARY_ICON = {
    checking: '<span class="status-spinner"></span>',
    ok: ICON.check, slow: ICON.clock, issue: ICON.cross, down: ICON.cross, offline: ICON.dash
  };

  const services = SERVICES.map(s => {
    const li = document.querySelector('[data-service="' + s.id + '"]');
    if (!li) return null;
    const nameEl = li.querySelector(".status-name");
    return Object.assign({}, s, {
      li,
      name: nameEl ? nameEl.textContent.trim() : s.id,
      badge: li.querySelector("[data-badge]"),
      ms: li.querySelector("[data-ms]"),
      detail: li.querySelector("[data-detail]"),
      trend: li.querySelector("[data-trend]"),
      bars: li.querySelector("[data-bars]"),
      trendText: li.querySelector("[data-trend-text]"),
      history: []
    });
  }).filter(Boolean);
  if (!services.length) return;

  const fmtMs = ms => (ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s");
  const quoted = list => {
    const names = list.map(s => "“" + s.name + "”");
    if (window.Intl && Intl.ListFormat) return new Intl.ListFormat("en-NZ", { style: "long", type: "conjunction" }).format(names);
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  };

  /* ---- One address ---- */
  async function probe(host) {
    const start = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(host.url, {
        method: "HEAD",
        mode: host.same ? "same-origin" : "no-cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: ctl.signal
      });
      const ms = Math.round(performance.now() - start);
      if (host.same && !res.ok) return { host, ok: false, ms, reason: "http", status: res.status };
      return { host, ok: true, ms };
    } catch (err) {
      return { host, ok: false, ms: Math.round(performance.now() - start), reason: ctl.signal.aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- One service (all of its addresses at once) ---- */
  async function checkService(svc) {
    const out = await Promise.all(svc.hosts.map(probe));
    const failed = out.filter(o => !o.ok);
    return { svc, ok: failed.length === 0, ms: Math.max.apply(null, out.map(o => o.ms)), failed };
  }
  const stateOf = r => (!r.ok ? "down" : r.ms >= SLOW_MS ? "slow" : "ok");

  function describeFailure(r) {
    const http = r.failed.find(f => f.reason === "http");
    if (http) return "The website answered with an error (" + http.status + ").";
    const who = r.failed.map(f => f.host.label).join(", ");
    return r.failed.some(f => f.reason === "timeout")
      ? "No answer within " + TIMEOUT_MS / 1000 + " seconds from " + who + "."
      : "Couldn’t connect to " + who + ".";
  }

  /* ---- Drawing ---- */
  function setBadge(svc, key) {
    const b = BADGE[key];
    svc.li.dataset.state = key;
    svc.badge.className = "badge " + b.tone;
    svc.badge.innerHTML = '<span class="icon" aria-hidden="true">' + ICON[b.icon] + "</span><span>" + b.label + "</span>";
  }

  function renderTrend(svc) {
    const h = svc.history;
    if (h.length < 2) { svc.trend.hidden = true; return; }
    svc.bars.textContent = "";
    const count = { ok: 0, slow: 0, down: 0 };
    h.forEach(s => {
      const bar = document.createElement("span");
      bar.className = "status-bar";
      bar.dataset.s = s;
      svc.bars.appendChild(bar);
      count[s]++;
    });
    const parts = [];
    if (count.ok) parts.push(count.ok + " working");
    if (count.slow) parts.push(count.slow + " slow");
    if (count.down) parts.push(count.down + " can’t reach");
    svc.bars.setAttribute("aria-label", "Last " + h.length + " checks on this device: " + parts.join(", "));
    svc.trendText.textContent = "Last " + h.length + " checks";
    svc.trend.hidden = false;
  }

  function setSummary(state, head, text) {
    if (summary.dataset.state !== state) {
      summary.dataset.state = state;
      summaryIcon.innerHTML = SUMMARY_ICON[state];
    }
    if (headline.textContent !== head) headline.textContent = head;
    if (sub.textContent !== text) sub.textContent = text;
  }

  function summarise(states) {
    const down = services.filter(s => states[s.id] === "down");
    const slow = services.filter(s => states[s.id] === "slow");
    if (down.length === services.length) {
      return ["down", "No services can be reached",
        "Check your internet connection. If other websites work, 29 World™ may be having problems, so try again in a few minutes."];
    }
    if (down.length) {
      return ["issue", down.length === 1 ? "One service can’t be reached" : "Some services can’t be reached",
        quoted(down) + " can’t be reached from this device. See what to try below."];
    }
    if (slow.length) {
      return ["slow", slow.length === 1 ? "One service is slow" : "Some services are slow",
        quoted(slow) + (slow.length === 1 ? " is" : " are") + " answering slowly, so pages may be slow to load or save."];
    }
    return ["ok", "Everything is working", "Every service answered quickly from this device."];
  }

  function showOffline() {
    services.forEach(svc => {
      setBadge(svc, "offline");
      svc.ms.textContent = "";
      svc.detail.hidden = true;
    });
    setSummary("offline", "This device is offline",
      "Reconnect to Wi-Fi or mobile data. Checks start again when you’re back online.");
    checkedEl.textContent = "Not checked while offline.";
  }

  /* ---- Running the checks ---- */
  let running = false;
  let lastRun = 0;
  let firstDone = false;

  function setBusy(busy) {
    refreshBtn.setAttribute("aria-disabled", busy ? "true" : "false");
    refreshBtn.setAttribute("aria-busy", busy ? "true" : "false");
    refreshLabel.textContent = busy ? "Checking…" : "Check again";
  }

  async function run() {
    if (running) return;
    running = true;
    setBusy(true);
    if (!firstDone) summary.setAttribute("aria-busy", "true");
    try {
      if (navigator.onLine === false) { showOffline(); return; }
      const results = await Promise.all(services.map(checkService));
      /* If the connection dropped while checking, don't blame the services. */
      if (navigator.onLine === false) { showOffline(); return; }
      const states = {};
      results.forEach(r => {
        const key = stateOf(r);
        const svc = r.svc;
        states[svc.id] = key;
        setBadge(svc, key);
        svc.ms.textContent = key === "down" ? "–" : fmtMs(r.ms);
        svc.detail.hidden = key !== "down";
        if (key === "down") svc.detail.textContent = describeFailure(r);
        svc.history.push(key);
        if (svc.history.length > HISTORY_MAX) svc.history.shift();
        renderTrend(svc);
      });
      const s = summarise(states);
      setSummary(s[0], s[1], s[2]);
      lastRun = Date.now();
      firstDone = true;
      checkedEl.textContent = "Last checked at " +
        new Date(lastRun).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) + ".";
    } catch (err) {
      setSummary("offline", "The checks couldn’t run", "Reload this page and try again.");
    } finally {
      running = false;
      setBusy(false);
      summary.removeAttribute("aria-busy");
    }
  }

  refreshBtn.addEventListener("click", run);
  window.addEventListener("online", run);
  window.addEventListener("offline", () => { if (!running) showOffline(); });
  window.addEventListener("pageshow", e => { if (e.persisted) run(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastRun >= REFRESH_MS) run();
  });
  setInterval(() => { if (!document.hidden) run(); }, REFRESH_MS);

  actions.hidden = false;
  run();

  /* ---- Addresses for school IT: copy the list (works without clipboard permission too) ---- */
  const copyBox = $("statusCopy");
  const copyBtn = $("copyHostsBtn");
  const copyMsg = $("copyHostsMsg");
  const hostEls = document.querySelectorAll("#statusHosts code");
  if (copyBox && copyBtn && copyMsg && hostEls.length) {
    const text = Array.from(hostEls, el => el.textContent.trim()).join("\n");
    const say = t => {
      copyMsg.textContent = t;
      setTimeout(() => { if (copyMsg.textContent === t) copyMsg.textContent = ""; }, 3500);
    };
    const legacy = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { /* fall through */ }
      document.body.removeChild(ta);
      return ok;
    };
    const done = ok => say(ok ? "Addresses copied." : "Couldn’t copy them. Select the list and copy it by hand.");
    copyBtn.addEventListener("click", () => {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => done(true), () => done(legacy()));
      } else {
        done(legacy());
      }
    });
    copyBox.hidden = false;
  }
})();
