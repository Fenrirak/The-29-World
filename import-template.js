// This page has its own, non-standard login handling (rather than the
// usual requireLogin()) because a share link needs to survive a round
// trip through the login/signup form on index.html — see getSafeReturnTo()
// there. requireLogin()'s normal "not logged in" redirect just goes to a
// bare index.html with no memory of where the visitor was headed.
let CURRENT, TOKEN, SHARE;

function showState(name) {
  ["stateError", "stateWrongRole", "stateReady"].forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== name);
  });
}

async function init() {
  paintIconSlots();
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
  document.getElementById("errorIcon").innerHTML = icon("lock", 34);
  document.getElementById("wrongRoleIcon").innerHTML = icon("idcard", 34);
  document.getElementById("readyIcon").innerHTML = icon("handshake", 34);

  TOKEN = new URLSearchParams(window.location.search).get("token");
  if (!TOKEN) {
    showState("stateError");
    document.getElementById("errorMsg").textContent = "This link is missing its code — check you copied the whole thing.";
    return;
  }

  const u = await getSessionUser();
  if (!u) {
    // Send the visitor to log in (or sign up), then straight back here —
    // see getSafeReturnTo()/doLogin() in index.html.
    const returnTo = encodeURIComponent("import-template.html" + window.location.search);
    window.location.href = "index.html?returnTo=" + returnTo;
    return;
  }
  CURRENT = u;
  document.getElementById("whoami").textContent = u.name;

  if (u.role !== "teacher") {
    showState("stateWrongRole");
    return;
  }

  const info = await getTemplateShareInfo(TOKEN);
  if (!info) {
    showState("stateError");
    document.getElementById("errorMsg").textContent = "This share link is invalid or has been revoked — ask for a fresh one.";
    return;
  }
  SHARE = info;
  showState("stateReady");
  document.getElementById("shareIntro").textContent =
    `${info.teacherName} shared "${info.className}" with you as a template.`;
  document.getElementById("newClassName").value = info.className;
  document.getElementById("newClassName").focus();
}

async function submitImport(e) {
  e.preventDefault();
  const btn = document.getElementById("importSubmitBtn");
  const name = document.getElementById("newClassName").value.trim();
  btn.disabled = true;
  document.getElementById("importMsg").innerHTML = "";
  try {
    const res = await importSharedTemplate(CURRENT.username, TOKEN, name);
    if (!res.ok) {
      document.getElementById("importMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      btn.disabled = false;
      return false;
    }
    window.location.href = "teacher.html";
  } catch (err) {
    document.getElementById("importMsg").innerHTML = `<div class="error-msg">Something went wrong. Please try again.</div>`;
    btn.disabled = false;
  }
  return false;
}

document.addEventListener("DOMContentLoaded", init);
