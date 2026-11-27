/* IMPORTANT notices shown to signed-in users:
   1) the Privacy Policy / Terms of Use changed (agreementVersion in policy-config.js) -> must agree again;
   2) data or hosting is moving to another country (T29_HOSTING.pendingMove) -> must acknowledge.
   Agreement is remembered per user, per device, in localStorage.
   Developers can test on localhost with ?t29preview=policy or ?t29preview=hosting (nothing is saved). */
(function () {
  "use strict";
  var P = window.T29_POLICY, H = window.T29_HOSTING;
  if (!P || !H) return;

  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var preview = local ? new URLSearchParams(location.search).get("t29preview") : null;
  if (!preview && /(\/|\/(login|privacy|terms|index|parent|status|offline|404|timeup|help)\.html)$/.test(location.pathname)) return;

  var user = null;
  try {
    var raw = localStorage.getItem("anw_session");
    if (raw) { try { user = (JSON.parse(raw) || {}).username || null; } catch (e) { user = raw; } }
  } catch (e) { /* ignore */ }
  if (!user && !preview) return;
  user = String(user || "preview").toLowerCase();

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var move = H.pendingMove;
  if (preview === "hosting" && !move) {
    move = { id: "preview", announced: "2026-01-01", effective: "2099-01-01", what: "the database that stores your account and class data", from: "its current location", to: "a new country" };
  }
  var queue = [];
  var agreementVersion = P.agreementVersion || P.version;
  if (preview === "policy" || (!preview && get("t29-policy-ack:" + user) !== agreementVersion)) queue.push("policy");
  if (preview === "hosting" || (!preview && move && get("t29-hosting-ack:" + user) !== move.id)) queue.push("hosting");
  if (preview === "policy") queue = ["policy"];
  if (preview === "hosting") queue = ["hosting"];
  if (!queue.length) return;

  var CSS = ".t29n-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,20,35,.74)}" +
    ".t29n-dialog{box-sizing:border-box;width:min(560px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1a2233);border-radius:var(--r-6,16px);border-top:8px solid #b3261e;box-shadow:0 24px 60px rgba(0,0,0,.45);padding:22px 24px 20px}" +
    ".t29n-dialog:focus,.t29n-title:focus{outline:none}" +
    ".t29n-badge{display:inline-block;background:#b3261e;color:#fff;font-weight:800;letter-spacing:.06em;font-size:1rem;padding:4px 12px;border-radius:var(--r-2,8px)}" +
    ".t29n-title{margin:12px 0 4px;font-size:1.35rem;line-height:1.25}" +
    ".t29n-meta{margin:0 0 12px;color:var(--muted,#5a657b);font-size:.9rem}" +
    ".t29n-dialog p{margin:0 0 12px;line-height:1.5}.t29n-dialog ul{margin:6px 0 14px;padding-left:20px;line-height:1.5}.t29n-dialog li{margin:4px 0}" +
    ".t29n-links{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 14px}.t29n-links a{color:inherit;font-weight:700;text-decoration:underline}" +
    ".t29n-agree{display:flex;gap:10px;align-items:flex-start;padding:12px;border:2px solid var(--line,#e2e7f0);border-radius:var(--r-4,12px);margin:0 0 14px;cursor:pointer;font-weight:600;line-height:1.4}" +
    ".t29n-agree input{width:22px;height:22px;min-height:auto;flex-shrink:0;margin:0;accent-color:#b3261e}" +
    ".t29n-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}" +
    ".t29n-dialog .btn[disabled]{opacity:.5;cursor:not-allowed}";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(href, text) {
    var a = el("a", null, text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a;
  }
  function niceDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
  }
  function logOut() {
    var done = function () { location.href = "login.html"; };
    try {
      if (typeof logout === "function") { Promise.resolve(logout()).then(done, done); return; }
      Promise.resolve(window.firebase.auth().signOut()).then(done, done);
    } catch (e) { done(); }
  }

  function show(kind, next) {
    var prevFocus = document.activeElement;
    var overlay = el("div", "t29n-overlay");
    var dlg = el("div", "t29n-dialog");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.tabIndex = -1;
    var titleId = "t29n-title-" + kind;
    dlg.setAttribute("aria-labelledby", titleId);
    dlg.appendChild(el("span", "t29n-badge", "IMPORTANT"));
    var title = el("h2", "t29n-title"); title.id = titleId; title.tabIndex = -1;
    dlg.appendChild(title);
    var actions = el("div", "t29n-actions");
    var okBtn = el("button", "btn gold"); okBtn.type = "button";
    var finish = function () { document.body.style.overflow = prevOverflow; overlay.remove(); if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } } next(); };

    if (kind === "policy") {
      title.textContent = "We've updated our Privacy Policy and Terms of Use";
      dlg.appendChild(el("p", "t29n-meta", "Version " + P.version + ", " + P.updatedLabel));
      dlg.appendChild(el("p", null, "Here is what changed:"));
      var ul = el("ul"); (P.changes || []).forEach(function (c) { ul.appendChild(el("li", null, c)); }); dlg.appendChild(ul);
      var links = el("div", "t29n-links"); links.appendChild(link("privacy.html", "Read the Privacy Policy")); links.appendChild(link("terms.html", "Read the Terms of Use")); dlg.appendChild(links);
      var lab = el("label", "t29n-agree"); var cb = el("input"); cb.type = "checkbox"; cb.id = "t29n-agree";
      lab.appendChild(cb); lab.appendChild(el("span", null, "I have read and agree to the updated Privacy Policy and Terms of Use.")); dlg.appendChild(lab);
      dlg.appendChild(el("p", "t29n-meta", "Students: if you're not sure, ask your teacher before you agree."));
      okBtn.textContent = "Agree and continue"; okBtn.disabled = true;
      cb.addEventListener("change", function () { okBtn.disabled = !cb.checked; });
      okBtn.addEventListener("click", function () { if (!cb.checked) return; if (!preview) window.t29RecordPolicyAck(user); finish(); });
      var out = el("button", "btn secondary", "Log out"); out.type = "button"; out.addEventListener("click", logOut);
      actions.appendChild(out);
    } else {
      var future = Date.parse(move.effective) > Date.now();
      title.textContent = future ? "Your data is moving to " + move.to : "Your data has moved to " + move.to;
      dlg.appendChild(el("p", "t29n-meta", "Notice given " + niceDate(move.announced)));
      dlg.appendChild(el("p", null, (future ? "On " + niceDate(move.effective) + " we will move " : "On " + niceDate(move.effective) + " we moved ") + move.what + " from " + move.from + " to " + move.to + "."));
      var ul2 = el("ul");
      if (move.note) ul2.appendChild(el("li", null, move.note));
      if (future) ul2.appendChild(el("li", null, "If you don't want your information moved, contact us before " + niceDate(move.effective) + " and ask for it to be deleted (Privacy Policy, Section 6). Students can ask their teacher."));
      if (ul2.children.length) dlg.appendChild(ul2);
      var l2 = el("div", "t29n-links"); l2.appendChild(link("privacy.html", "Read the Privacy Policy")); dlg.appendChild(l2);
      okBtn.textContent = "I understand";
      okBtn.addEventListener("click", function () { if (!preview) set("t29-hosting-ack:" + user, move.id); finish(); });
    }
    actions.appendChild(okBtn); dlg.appendChild(actions);
    overlay.appendChild(dlg);

    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    // Keep page shortcuts from firing while the notice is open, and keep Tab inside it. There is no Escape: it needs an answer.
    dlg.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") { e.stopPropagation(); return; }
      var f = Array.prototype.filter.call(dlg.querySelectorAll("a[href],button,input"), function (n) { return !n.disabled; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dlg || document.activeElement === title)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    title.focus();
  }

  function run() {
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
    (function step() { var k = queue.shift(); if (k) show(k, step); })();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
