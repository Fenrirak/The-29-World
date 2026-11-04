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
  try {
    await _init();
  } catch (err) {
    console.error("import page failed to load", err);
    showState("stateError");
    document.getElementById("errorMsg").textContent = "Couldn't load this link. Check your connection and try again.";
  }
}

async function _init() {
  paintIconSlots();
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
  if (info.needsRefresh) {
    showState("stateError");
    document.getElementById("errorMsg").textContent = "This link was made with an older version of The 29 World. Ask the teacher who sent it to click Share Template on that class again — then this same link will work.";
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
  const msgBox = document.getElementById("importMsg");
  msgBox.innerHTML = "";
  const showErr = text => {
    const d = document.createElement("div");
    d.className = "error-msg";
    d.textContent = text;
    msgBox.appendChild(d);
  };
  if (!name) { showErr("Enter a class name."); return false; }
  btn.disabled = true;
  try {
    const res = await importSharedTemplate(CURRENT.username, TOKEN, name);
    if (!res.ok) {
      showErr(res.error);
      btn.disabled = false;
      return false;
    }
    sessionStorage.setItem("t29-class-opened", "1");
    window.location.href = "teacher.html";
  } catch (err) {
    console.error("import failed", err.code, err.message, err);
    showErr(err && err.code === "permission-denied"
      ? "You don't have permission to create this class. Please log out, log back in, and try again."
      : "Something went wrong. Please try again.");
    btn.disabled = false;
  }
  return false;
}

document.addEventListener("DOMContentLoaded", init);
