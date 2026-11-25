// The sample payday uses classroom dollars and runs entirely on this page.
const $ = id => document.getElementById(id);
const range = $("savings");
const total = Number(range.max);

function updatePayday() {
  const saved = range.valueAsNumber, left = total - saved;
  $("savings-amount").textContent = $("ledger-savings").textContent = "$" + saved;
  $("spending").value = "$" + left;
  range.setAttribute("aria-valuetext", saved + " classroom dollars");
  range.style.setProperty("--fill", (saved / total * 100) + "%");
  $("bar").style.gridTemplateColumns = `45fr 5fr ${saved}fr ${left}fr`;
}

range.addEventListener("input", updatePayday);
window.addEventListener("pageshow", updatePayday);
updatePayday();
$("savings-control").hidden = false;

const previewLink = $("preview-play");
const previewVideo = $("preview-video");
const previewError = $("preview-error");

previewLink.addEventListener("click", event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  previewError.hidden = true;
  previewVideo.poster = previewLink.querySelector("img").src;
  previewVideo.src = previewLink.href;
  previewVideo.hidden = false;
  previewLink.hidden = true;
  previewVideo.focus({ preventScroll: true });
  previewVideo.play().catch(() => {});
});

previewVideo.addEventListener("error", () => {
  previewLink.hidden = false;
  previewVideo.hidden = true;
  previewError.hidden = false;
  previewLink.focus({ preventScroll: true });
});

function replayPrint(box, { replayDelay = 0, ready = Promise.resolve(), canPrint = () => true } = {}) {
  const revealThreshold = 0.15;
  let inView = false;
  let rearmTimer;

  function rearm() {
    box.classList.remove("print-go");
    box.classList.toggle("print-wait", canPrint());
  }

  const watcher = new IntersectionObserver(entries => {
    for (const entry of entries) {
      inView = entry.isIntersecting && entry.intersectionRatio >= revealThreshold;
      if (!entry.isIntersecting) {
        if (replayDelay) rearmTimer = setTimeout(rearm, replayDelay);
        else rearm();
        continue;
      }

      clearTimeout(rearmTimer);
      if (inView && box.classList.contains("print-wait")) {
        ready.then(() => {
          if (inView && canPrint()) box.classList.replace("print-wait", "print-go");
        });
      }
    }
  }, { threshold: [0, revealThreshold] });

  // Reveal immediately when a control receives focus during the intro.
  box.addEventListener("focusin", () => box.classList.remove("print-wait", "print-go"));
  rearm();
  watcher.observe(box);
}

if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  replayPrint($("payday").closest(".slip-wrap"));

  const poster = previewLink.querySelector("img");
  const posterReady = poster.complete ? Promise.resolve() : new Promise(done => {
    poster.addEventListener("load", done, { once: true });
    poster.addEventListener("error", done, { once: true });
    setTimeout(done, 2000);
  });
  replayPrint(previewLink.closest(".preview-media"), {
    replayDelay: 1200,
    ready: posterReady,
    canPrint: () => !previewLink.hidden
  });
}

// Contact: copy the address (works even when the device has no email app for mailto: links).
const addr = "Nathan.liu1211@gmail.com";
const copyBtn = $("copyEmailBtn"), copyMsg = $("copyEmailMsg");

function say(text) {
  copyMsg.textContent = text;
  setTimeout(() => { if (copyMsg.textContent === text) copyMsg.textContent = ""; }, 3500);
}

function legacyCopy() {
  const ta = document.createElement("textarea");
  ta.value = addr; ta.readOnly = true; ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) { /* fall through */ }
  ta.remove();
  return ok;
}

copyBtn.addEventListener("click", () => {
  const done = ok => say(ok ? "Email address copied." : "Couldn’t copy it. The address is " + addr + ".");
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(addr).then(() => done(true), () => done(legacyCopy()));
  else done(legacyCopy());
});
