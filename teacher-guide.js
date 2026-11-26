const GUIDE_VIDEOS = {
  // Add one recording per module, e.g. bank: "guides/bank.mp4".
  // Events uses the class-settings key "bigevents".
};

export function mountTeacherGuide(key, label) {
  if (document.getElementById("teacherGuide")) return;
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  const guide = document.createElement("aside");
  guide.id = "teacherGuide";
  guide.hidden = true;
  guide.setAttribute("aria-label", label + " tutorial");
  guide.innerHTML = `
    <button class="tg-handle" type="button" aria-expanded="false" aria-controls="tgPanel"
      title="Pull down or click to open the guide">
      <span aria-hidden="true" class="tg-film"></span> Guide
      <span aria-hidden="true" class="tg-flap">Pull</span>
    </button>
    <section id="tgPanel" aria-labelledby="tgTitle" hidden>
      <header class="tg-heading"><h2 id="tgTitle"></h2>
        <button type="button" class="tg-close" aria-label="Close guide">&times;</button>
      </header>
      <div class="tg-stage"></div>
    </section>`;
  const handle = guide.querySelector(".tg-handle");
  const panel = guide.querySelector("#tgPanel");
  const stage = guide.querySelector(".tg-stage");
  const close = guide.querySelector(".tg-close");
  handle.setAttribute("aria-label", "Open " + label + " guide");
  guide.querySelector("#tgTitle").textContent = label + " guide";

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "teacher-guide.css?v=60da471c";
  stylesheet.onload = () => { guide.hidden = false; };
  document.body.append(guide);
  document.head.append(stylesheet);

  // A wrapped top bar may change height after its icons or notification bell load.
  function position() {
    guide.style.setProperty("--tg-bar", topbar.offsetHeight + "px");
  }
  position();
  new ResizeObserver(position).observe(topbar);

  const source = GUIDE_VIDEOS[key];
  let video;
  function prepareStage() {
    if (!source) {
      stage.innerHTML = `<div class="tg-preview">
        <strong>Guide Video Coming Soon</strong>
      </div>`;
      return;
    }
    video = document.createElement("video");
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", label + " tutorial video");
    video.addEventListener("error", () => {
      const message = document.createElement("p");
      message.className = "tg-error";
      message.setAttribute("role", "status");
      message.textContent = "This guide couldn’t load. Close and reopen it to try again.";
      stage.replaceChildren(message);
    }, { once: true });
    const play = document.createElement("button");
    play.type = "button";
    play.className = "tg-play";
    play.setAttribute("aria-label", "Play " + label + " guide");
    play.innerHTML = '<span aria-hidden="true">&#9654;</span> Play guide';
    play.addEventListener("click", () => {
      video.play().catch(() => { /* Native controls also allow a retry. */ });
      video.controls = true;
      play.remove();
      video.focus({ preventScroll: true });
    });
    stage.replaceChildren(video, play);
    video.src = source;
  }

  function openGuide() {
    if (!panel.hidden) return;
    if (!stage.firstChild || video?.error) prepareStage();
    handle.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    close.focus({ preventScroll: true });
    handle.hidden = true;
  }
  function closeGuide() {
    video?.pause();
    handle.hidden = false;
    handle.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    handle.focus({ preventScroll: true });
  }
  close.addEventListener("click", closeGuide);
  guide.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden && !document.fullscreenElement) {
      event.stopPropagation();
      closeGuide();
    }
  });

  let drag;
  let ignoreClick = false;
  function resetDrag() {
    drag = null;
    handle.style.removeProperty("--tg-pull");
  }
  handle.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    ignoreClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > 8 || Math.abs(event.clientX - drag.x) > 8) ignoreClick = true;
    handle.style.setProperty("--tg-pull", Math.min(22, Math.max(0, dy * .45)) + "px");
  });
  handle.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;
    const dx = Math.abs(event.clientX - drag.x);
    if (Math.abs(dy) > 8 || dx > 8) ignoreClick = true;
    resetDrag();
    if (dy >= 32 && dy > dx) openGuide();
  });
  handle.addEventListener("lostpointercapture", resetDrag);
  handle.addEventListener("pointercancel", () => { ignoreClick = true; resetDrag(); });
  handle.addEventListener("click", event => {
    if (!ignoreClick || event.detail === 0) openGuide();
  });
  // A two-finger scroll on the tab also opens it on a laptop trackpad.
  let wheelDistance = 0;
  let lastWheel = 0;
  handle.addEventListener("wheel", event => {
    if (event.ctrlKey || event.deltaY <= 0 || Math.abs(event.deltaX) > event.deltaY) {
      wheelDistance = 0;
      return;
    }
    event.preventDefault();
    if (event.timeStamp - lastWheel > 180) wheelDistance = 0;
    lastWheel = event.timeStamp;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    wheelDistance += event.deltaY * unit;
    if (wheelDistance >= 32) {
      wheelDistance = 0;
      openGuide();
    }
  }, { passive: false });
}
