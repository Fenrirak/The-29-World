/* ===================== The 29 World — add students in bulk =====================
   Teacher page only (loaded by teacher.html after data-core.js and teacher.js).

   The teacher pastes one student per line (first name, then last name). This
   file turns each line into a username + a random 6-letter password, shows a
   preview, then hands the list to t29BulkCreateStudents() in data-core.js,
   which makes the real accounts. Afterwards it gives the teacher ways to pass
   the logins on: copy, CSV, printable slips, and a ready-to-send email message.

   Passwords are generated here, in the teacher's browser, and are NEVER saved
   anywhere (Firebase stores only a hash). The results window is the one and
   only time they can be seen, so closing it with an un-copied list asks first.
================================================================================ */
(function () {
  "use strict";

  const MAX_PER_RUN = 50;
  const TEMPLATE_KEY = "t29-bulk-email-template";
  const DEFAULT_TEMPLATE = {
    subject: "Your login for The 29 World",
    body: [
      "Hi {first},",
      "",
      "You can log in to The 29 World with this link:",
      "{link}",
      "",
      "Your login details are:",
      "Username: {username}",
      "Password: {password}",
      "",
      "Once you're in, you can change your password from the settings menu.",
      "",
      "Thanks,",
      "{teacher}"
    ].join("\n")
  };

  // Passwords are letters only, upper AND lower case. "I" (capital i) and "l"
  // (lowercase L) are left out because they look identical in most fonts — on
  // a printed slip or a phone screen a student couldn't tell which was meant.
  const PW_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const PW_LENGTH = 6;

  const S = {
    grant: 20,       // welcome grant used for the accounts made in this window
    classGrant: 20,  // what the class setting currently is
    created: [],     // every account made since the window was opened: { name, username, password }
    saved: false,    // has the teacher copied / downloaded / printed the list?
    busy: false,     // accounts are being created right now
    stop: false,     // teacher pressed "Stop"
    className: ""
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  let previewTimer = null;

  /* ---------------- Random passwords ---------------- */

  // Uniformly random number in [0, n) — rejects the few values that would make
  // some letters slightly more likely than others (modulo bias).
  function randomIndex(n) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }

  function randomPassword() {
    for (;;) {
      let pw = "";
      for (let i = 0; i < PW_LENGTH; i++) pw += PW_LETTERS[randomIndex(PW_LETTERS.length)];
      // A "combo of upper and lower": re-roll the (rare) all-one-case result.
      if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) return pw;
    }
  }

  // `count` different passwords — no two students in a batch ever share one.
  function uniquePasswords(count) {
    if (!window.crypto || !crypto.getRandomValues) throw new Error("NO_CRYPTO");
    const seen = new Set();
    while (seen.size < count) seen.add(randomPassword());
    return Array.from(seen);
  }

  /* ---------------- Reading the names box ---------------- */

  const LETTER_FIXES = { "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };

  // "Māia O'Brien" -> "maia" / "obrien": accents and macrons dropped, anything
  // that isn't a letter or number removed, so it's always a safe username.
  function slug(s) {
    return String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[øßæœłđðþı]/g, (c) => LETTER_FIXES[c])
      .replace(/[^a-z0-9]/g, "");
  }

  // Names typed all lower-case or all CAPS get tidied ("aroha smith" -> "Aroha
  // Smith"); a name with its own capitals ("Mc Donald", "de Vries") is left alone.
  function tidyCase(name) {
    if (!/\p{L}/u.test(name)) return name;
    if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
    return name.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }

  // One line of the box -> { raw, name, words, problem } (or null for a blank line).
  // Understands "First Last", "Last, First", and lines copied from a numbered
  // or bulleted list or a spreadsheet row.
  function parseLine(raw) {
    let t = String(raw).replace(/[<>]/g, "").trim();
    t = t.replace(/^(?:[-*•–]|\d+[.)])\s+/, "");
    if (t.includes(",")) {
      const parts = t.split(",").map((p) => p.trim());
      t = (parts.length === 2 && parts[0] && parts[1]) ? parts[1] + " " + parts[0] : parts.join(" ");
    }
    t = t.replace(/[\t;]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return null;
    const name = sanitizeUserText(tidyCase(t), 60);
    const words = name.split(" ");
    return { raw: String(raw).trim(), name, words, username: null, inClass: false,
             problem: words.length < 2 ? "Needs a first and last name" : null };
  }

  function baseUsername(words, style) {
    const first = slug(words[0]);
    const last = slug(words[words.length - 1]);
    let b;
    if (style === "joined") b = first + last;
    else if (style === "initial") b = (first && last) ? first + "." + last[0] : (first || last);
    else b = (first && last) ? first + "." + last : (first || last);
    return (b || "student").slice(0, 24).replace(/\.+$/, "") || "student";
  }

  // Reads the box into rows, with each row's username already worked out.
  // Usernames are shared by every class on the site, so a name that's taken
  // gets a number added (sam.lee, sam.lee2...). Clashes inside this list and
  // with this class's current students are settled here so the preview shows
  // the real thing; a clash with another class is settled when the account is made.
  function readRows() {
    const style = $("bulkStyle").value;
    const roster = (typeof LAST_STUDENTS !== "undefined" && Array.isArray(LAST_STUDENTS)) ? LAST_STUDENTS : [];
    const used = new Set(roster.map((s) => String(s.username || "").toLowerCase()));
    const rosterNames = new Set(roster.map((s) => String(s.name || "").trim().toLowerCase()));
    const rows = [];
    $("bulkNames").value.split(/\r?\n/).forEach((line) => {
      const r = parseLine(line);
      if (r) rows.push(r);
    });
    rows.forEach((r) => {
      r.inClass = rosterNames.has(r.name.toLowerCase());
      if (r.problem) return;
      const base = baseUsername(r.words, style);
      let candidate = base, n = 1;
      while (used.has(candidate)) { n++; candidate = base + n; }
      used.add(candidate);
      r.username = candidate;
    });
    return rows;
  }

  /* ---------------- Screens ---------------- */

  function setPhase(phase) {
    $("bulkStepInput").classList.toggle("hidden", phase !== "input");
    $("bulkStepRunning").classList.toggle("hidden", phase !== "running");
    $("bulkStepResults").classList.toggle("hidden", phase !== "results");
    $("bulkCloseBtn").disabled = phase === "running";
    $("bulkTitle").textContent = phase === "results" ? "Student logins" : "Add students";
    $("bulkSubtitle").textContent = phase === "results"
      ? "Share these with your students before you close this window."
      : "Create a whole class of accounts at once.";
    if (phase === "input") {
      $("bulkViewLoginsBtn").classList.toggle("hidden", S.created.length === 0);
      $("bulkViewLoginsBtn").textContent = "Back to the " + S.created.length + " login" + (S.created.length === 1 ? "" : "s");
      renderPreview();
    }
  }

  // The welcome grant box: { ok, value } or { ok:false, error }.
  function readGrant() {
    const raw = $("bulkGrant").value.trim();
    const n = Number(raw);
    if (raw === "" || !isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "Enter a welcome grant between $0 and $100,000." };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function renderPreview() {
    const rows = readRows();
    const box = $("bulkPreview");
    const btn = $("bulkCreateBtn");
    $("bulkInputMsg").innerHTML = "";
    const grant = readGrant();
    $("bulkCounter").textContent = rows.length + " student" + (rows.length === 1 ? "" : "s");
    if (!rows.length) {
      box.innerHTML = `<div class="bulk-empty">${icon("users", 22)}<div><strong>Your class list will appear here.</strong><br>Type or paste names above and you&rsquo;ll see each username before anything is created.</div></div>`;
      if (!grant.ok) $("bulkInputMsg").innerHTML = `<div class="error-msg">${esc(grant.error)}</div>`;
      btn.disabled = true;
      btn.innerHTML = icon("plus", 15) + " Create accounts";
      return;
    }
    const problems = rows.filter((r) => r.problem).length;
    const tooMany = rows.length > MAX_PER_RUN;
    const ok = rows.length - problems;
    box.innerHTML = `
      <div class="bulk-count"><strong>${rows.length}</strong> student${rows.length === 1 ? "" : "s"}${problems ? ` &middot; <span class="bulk-bad">${problems} need${problems === 1 ? "s" : ""} fixing</span>` : ""}</div>
      <div class="bulk-mini-scroll">
        <table class="bulk-mini">
          <thead><tr><th>#</th><th>Name</th><th>Username</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr class="${r.problem ? "bad" : ""}">
              <td>${i + 1}</td>
              <td>${esc(r.name)}</td>
              <td>${r.problem
                ? `<span class="badge coral">${esc(r.problem)}</span>`
                : `<code>${esc(r.username)}</code>${r.inClass ? ` <span class="badge gold" title="A student with this name is already in the class">Already in class?</span>` : ""}`}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    if (!grant.ok) {
      $("bulkInputMsg").innerHTML = `<div class="error-msg">${esc(grant.error)}</div>`;
    } else if (tooMany) {
      $("bulkInputMsg").innerHTML = `<div class="error-msg">That's more than ${MAX_PER_RUN} at once. Add the first ${MAX_PER_RUN} now, then the rest.</div>`;
    } else if (problems) {
      $("bulkInputMsg").innerHTML = `<div class="error-msg">Fix the highlighted lines (or delete them) to continue.</div>`;
    }
    btn.disabled = tooMany || problems > 0 || ok === 0 || !grant.ok;
    btn.innerHTML = icon("plus", 15) + " Create " + ok + " account" + (ok === 1 ? "" : "s");
  }

  function updateRun(i, total, entry) {
    $("bulkRunText").textContent = "Creating account " + (i + 1) + " of " + total + "…";
    $("bulkRunNow").textContent = entry ? entry.name : "";
    $("bulkRunBar").style.width = Math.round((i / total) * 100) + "%";
  }

  /* ---------------- Creating the accounts ---------------- */

  async function createClick() {
    if (S.busy) return;
    const rows = readRows();
    if (!rows.length || rows.some((r) => r.problem) || rows.length > MAX_PER_RUN) { renderPreview(); return; }

    let passwords;
    try {
      passwords = uniquePasswords(rows.length);
    } catch (e) {
      $("bulkInputMsg").innerHTML = `<div class="error-msg">This browser can't make secure random passwords. Try a current version of Chrome, Safari, Edge or Firefox.</div>`;
      return;
    }
    const grant = readGrant();
    if (!grant.ok) { renderPreview(); return; }
    if (grant.value !== S.classGrant) {
      // Save it on the class first — each new student's starting balance is
      // read from the class when their account is made.
      $("bulkCreateBtn").disabled = true;
      const saved = await setClassWelcomeGrant(CLASS_CODE, grant.value);
      if (!saved.ok) {
        $("bulkInputMsg").innerHTML = `<div class="error-msg">${esc(saved.error)}</div>`;
        $("bulkCreateBtn").disabled = false;
        return;
      }
      S.classGrant = saved.amount;
      if (typeof render === "function") Promise.resolve(render()).catch(() => {});
    }
    S.grant = S.classGrant;
    const entries = rows.map((r, i) => ({ index: i, name: r.name, username: r.username, password: passwords[i] }));

    S.busy = true;
    S.stop = false;
    $("bulkStopBtn").disabled = false;
    $("bulkStopBtn").textContent = "Stop after this student";
    setPhase("running");
    updateRun(0, entries.length, entries[0]);

    let out;
    try {
      out = await t29BulkCreateStudents(CLASS_CODE, entries, {
        onProgress: updateRun,
        shouldStop: () => S.stop
      });
    } catch (e) {
      console.warn("Bulk add failed:", e);
      out = { results: [], stopReason: "Something went wrong. Please try again." };
    }
    S.busy = false;
    finish(rows, entries, out);
  }

  function finish(rows, entries, out) {
    const made = out.results.filter((r) => r.ok);
    const failed = out.results.filter((r) => !r.ok);
    const untried = entries.length - out.results.length;

    made.forEach((r) => S.created.push({ name: r.name, username: r.username, password: r.password }));
    if (made.length) {
      S.saved = false;
      window.onbeforeunload = (e) => {
        if (!(S.created.length && !S.saved)) return undefined;
        e.preventDefault();
        e.returnValue = "";
        return "";
      };
      // The roster just changed — refresh the page behind this window.
      if (typeof render === "function") Promise.resolve(render()).catch(() => {});
    }

    // Whatever wasn't created stays in the box, ready to try again.
    const madeIdx = new Set(made.map((r) => r.index));
    $("bulkNames").value = rows.filter((r, i) => !madeIdx.has(i)).map((r) => r.raw).join("\n");

    const problems = [];
    failed.forEach((r) => problems.push(`<li><strong>${esc(r.name)}</strong> — ${esc(r.error || "couldn't be created")}</li>`));

    if (!made.length) {
      // Nothing worked this time: stay on the list so they can fix it and retry.
      setPhase("input");
      $("bulkInputMsg").innerHTML = `<div class="error-msg">No accounts were created.${out.stopReason ? " " + esc(out.stopReason) : ""}${problems.length ? `<ul class="bulk-fail-list">${problems.join("")}</ul>` : ""}</div>`;
      return;
    }

    let note = "";
    if (problems.length || untried > 0) {
      note = `<div class="error-msg">
        ${problems.length ? `<div>${problems.length} account${problems.length === 1 ? "" : "s"} couldn't be created:</div><ul class="bulk-fail-list">${problems.join("")}</ul>` : ""}
        ${untried > 0 ? `<div>${untried} more ${untried === 1 ? "wasn't" : "weren't"} tried${out.stopReason ? ": " + esc(out.stopReason) : "."}</div>` : ""}
        <div>They're still in your list — use <strong>Add more students</strong> to try them again.</div>
      </div>`;
    }
    $("bulkFailures").innerHTML = note;
    renderResults();
    setPhase("results");
    t29Toast(made.length + " account" + (made.length === 1 ? "" : "s") + " created");
  }

  /* ---------------- Sharing the logins ---------------- */

  function loginLink() { return new URL("index.html?role=student", window.location.href).href; }

  // Short form for the printed slips: no "https://", no page name.
  function shortLink() {
    const u = new URL("./", window.location.href);
    return (u.host + u.pathname).replace(/\/$/, "");
  }

  function loadTemplate() {
    let t = null;
    try { t = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "null"); } catch (e) { /* ignore */ }
    return {
      subject: (t && typeof t.subject === "string") ? t.subject : DEFAULT_TEMPLATE.subject,
      body: (t && typeof t.body === "string") ? t.body : DEFAULT_TEMPLATE.body
    };
  }

  function currentTemplate() {
    return { subject: $("bulkEmailSubject").value, body: $("bulkEmailBody").value };
  }

  function fillTemplate(text, st) {
    const values = {
      first: st.name.split(" ")[0],
      name: st.name,
      username: st.username,
      password: st.password,
      link: loginLink(),
      class: S.className,
      teacher: (typeof CURRENT !== "undefined" && CURRENT && CURRENT.name) ? CURRENT.name : ""
    };
    return text.replace(/\{(first|name|username|password|link|class|teacher)\}/g, (m, k) => values[k]);
  }

  function messageFor(st) {
    const t = currentTemplate();
    return { subject: fillTemplate(t.subject, st), body: fillTemplate(t.body, st) };
  }

  function templateChanged() {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(currentTemplate())); } catch (e) { /* storage blocked — fine */ }
    renderEmailPreview();
  }

  function resetTemplate() {
    $("bulkEmailSubject").value = DEFAULT_TEMPLATE.subject;
    $("bulkEmailBody").value = DEFAULT_TEMPLATE.body;
    templateChanged();
  }

  function renderEmailPreview() {
    const st = S.created[0];
    $("bulkEmailPreview").textContent = st
      ? "Subject: " + messageFor(st).subject + "\n\n" + messageFor(st).body
      : "";
  }

  function markSaved() {
    S.saved = true;
    window.onbeforeunload = null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* fall through to the older way */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function copyAndTell(text, what) {
    const ok = await copyText(text);
    if (ok) { markSaved(); t29Toast(what + " copied"); }
    else t29Toast("Couldn't copy — try the Download button instead.");
  }

  function mailtoFor(st) {
    const m = messageFor(st);
    return "mailto:?subject=" + encodeURIComponent(m.subject) + "&body=" + encodeURIComponent(m.body.replace(/\n/g, "\r\n"));
  }

  function csvCell(v) {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop a spreadsheet treating a name as a formula
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function downloadCsv() {
    if (!S.created.length) return;
    const lines = [["Name", "Username", "Password", "Login link"]]
      .concat(S.created.map((st) => [st.name, st.username, st.password, loginLink()]))
      .map((row) => row.map(csvCell).join(","));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    const fileName = (S.className || "class").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "class";
    a.href = URL.createObjectURL(blob);
    a.download = fileName + "-student-logins.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    markSaved();
  }

  function copyList() {
    const text = S.created.map((st) => [st.name, st.username, st.password].join("\t")).join("\n");
    copyAndTell("Name\tUsername\tPassword\n" + text, "List");
  }

  function copyAllMessages() {
    const text = S.created.map((st) => {
      const m = messageFor(st);
      return "To: " + st.name + "\nSubject: " + m.subject + "\n\n" + m.body;
    }).join("\n\n------------------------------\n\n");
    copyAndTell(text, "All " + S.created.length + " messages");
  }

  function printSlips() {
    if (!S.created.length) return;
    const old = $("bulkPrintSheet");
    if (old) old.remove();
    const sheet = document.createElement("div");
    sheet.id = "bulkPrintSheet";
    sheet.innerHTML = S.created.map((st) => `
      <div class="bulk-slip">
        <div class="bulk-slip-brand">The 29 World</div>
        <div class="bulk-slip-class">${esc(S.className)}</div>
        <div class="bulk-slip-name">${esc(st.name)}</div>
        <div class="bulk-slip-row"><span>Go to</span><strong>${esc(shortLink())}</strong></div>
        <div class="bulk-slip-row"><span>Username</span><strong>${esc(st.username)}</strong></div>
        <div class="bulk-slip-row"><span>Password</span><strong>${esc(st.password)}</strong></div>
        <div class="bulk-slip-hint">Choose “I’m a Student”, then log in.</div>
      </div>`).join("");
    document.body.appendChild(sheet);
    document.body.classList.add("printing-bulk");
    const cleanup = () => {
      document.body.classList.remove("printing-bulk");
      const s = $("bulkPrintSheet");
      if (s) s.remove();
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    markSaved();
    setTimeout(() => window.print(), 50);
    setTimeout(cleanup, 120000); // safety net for browsers that never fire afterprint
  }

  function renderResults() {
    const n = S.created.length;
    $("bulkStats").innerHTML = `
      <div class="bulk-stat good"><span>Accounts created</span><strong>${n}</strong></div>
      <div class="bulk-stat"><span>Welcome grant each</span><strong>${esc(fmtMoney(S.grant))}</strong></div>
      <div class="bulk-stat"><span>Class</span><strong class="bulk-stat-text">${esc(S.className)}</strong></div>`;
    const tbody = $("bulkResultTable").querySelector("tbody");
    tbody.innerHTML = S.created.map((st, i) => `
      <tr>
        <td>${esc(st.name)}</td>
        <td data-label="Username"><code class="bulk-copy" tabindex="0" role="button" data-copy="${esc(st.username)}" title="Tap to copy">${esc(st.username)}</code></td>
        <td data-label="Password"><code class="bulk-copy bulk-pw" tabindex="0" role="button" data-copy="${esc(st.password)}" title="Tap to copy">${esc(st.password)}</code></td>
        <td data-label="Message">
          <button type="button" class="btn small secondary" data-act="copy" data-i="${i}">Copy message</button>
          <button type="button" class="btn small secondary" data-act="mail" data-i="${i}">Email</button>
        </td>
      </tr>`).join("");
    renderEmailPreview();
  }

  async function rowAction(e) {
    const c = e.target.closest("[data-copy]");
    if (c) {
      if (await copyText(c.dataset.copy)) { markSaved(); t29Toast("Copied " + c.dataset.copy); }
      return;
    }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const st = S.created[Number(b.dataset.i)];
    if (!st) return;
    if (b.dataset.act === "copy") {
      const m = messageFor(st);
      copyAndTell("Subject: " + m.subject + "\n\n" + m.body, "Message for " + st.name.split(" ")[0]);
    } else {
      markSaved();
      window.location.href = mailtoFor(st);
    }
  }

  /* ---------------- Open / close ---------------- */

  async function openBulkAdd() {
    const cls = await getClassCached(CLASS_CODE);
    if (!cls) return;
    if (cls.archived) { t29Toast("This class is archived — reopen it to add students."); return; }
    S.className = cls.name;
    S.classGrant = t29WelcomeGrantOf(cls);
    S.grant = S.classGrant;
    $("bulkClassName").textContent = cls.name;
    $("bulkGrant").value = S.classGrant;
    const t = loadTemplate();
    $("bulkEmailSubject").value = t.subject;
    $("bulkEmailBody").value = t.body;
    $("bulkFailures").innerHTML = "";
    setPhase("input");
    $("bulkAddModal").classList.remove("hidden");
  }

  async function closeBulkAdd() {
    if (S.busy) { t29Toast("Still creating accounts — please wait."); return; }
    if (S.created.length && !S.saved) {
      const go = await t29Confirm(
        "These passwords are only shown here — they can't be looked up again later, and you haven't copied, downloaded or printed them yet.\n\nClose anyway?",
        { confirmText: "Close anyway", cancelText: "Go back", danger: true }
      );
      if (!go) return;
    }
    $("bulkAddModal").classList.add("hidden");
    // Forget everything — the passwords don't stay in the page.
    S.created = [];
    S.saved = false;
    $("bulkNames").value = "";
    $("bulkResultTable").querySelector("tbody").innerHTML = "";
    $("bulkEmailPreview").textContent = "";
    $("bulkFailures").innerHTML = "";
    window.onbeforeunload = null;
  }

  function addMore() {
    $("bulkInputMsg").innerHTML = "";
    setPhase("input");
    const ta = $("bulkNames");
    ta.focus({ preventScroll: true });
  }

  function stopClick() {
    S.stop = true;
    $("bulkStopBtn").disabled = true;
    $("bulkStopBtn").textContent = "Stopping…";
  }

  function init() {
    const open = $("addStudentsBtn");
    if (open) open.innerHTML = icon("plus", 14) + " Add students";
    if (!$("bulkAddModal")) return;
    const ic = $("bulkIcon");
    if (ic) ic.innerHTML = icon("users", 22);
    $("bulkNames").addEventListener("input", schedulePreview);
    $("bulkGrant").addEventListener("input", schedulePreview);
    $("bulkResultTable").addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-copy]")) { e.preventDefault(); e.target.click(); }
    });
    $("bulkStyle").addEventListener("change", renderPreview);
    $("bulkEmailSubject").addEventListener("input", templateChanged);
    $("bulkEmailBody").addEventListener("input", templateChanged);
    $("bulkResultTable").addEventListener("click", rowAction);
    $("bulkViewLoginsBtn").addEventListener("click", () => { renderResults(); setPhase("results"); });
  }

  window.openBulkAdd = openBulkAdd;
  window.closeBulkAdd = closeBulkAdd;
  window.bulkCreateClick = createClick;
  window.bulkStopClick = stopClick;
  window.bulkAddMore = addMore;
  window.bulkCopyList = copyList;
  window.bulkCopyAllMessages = copyAllMessages;
  window.bulkDownloadCsv = downloadCsv;
  window.bulkPrintSlips = printSlips;
  window.bulkResetTemplate = resetTemplate;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
