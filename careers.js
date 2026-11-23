const CAREER_CV_FIELDS = {
  summary: "Personal statement", skills: "Skills", experience: "Experience", education: "Education and training"
};

const careerEl = id => document.getElementById(id);
const careerProfileRef = username => fdb.collection("careerProfiles").doc(username);
let careerProfile, careerLoad;

function readCareerCv() {
  const fields = new FormData(careerEl("careerCv"));
  return Object.fromEntries(Object.keys(CAREER_CV_FIELDS).map(key => [key, fields.get(key).trim()]));
}

function setCareerCv(cv) {
  for (const key of Object.keys(CAREER_CV_FIELDS)) careerEl("careerCv").elements.namedItem(key).value = cv?.[key] || "";
}

// The saved CV (the one sent with job applications), or null until the student has saved one.
function careerSavedCv() {
  const cv = careerProfile && careerProfile.cv;
  if (!cv) return null;
  const clean = Object.fromEntries(Object.keys(CAREER_CV_FIELDS).map(key => [key, String(cv[key] || "").trim()]));
  return Object.values(clean).some(Boolean) ? clean : null;
}

// A CV as read-only HTML, for the apply dialog and for teachers reviewing an application.
function careerCvHtml(cv) {
  const parts = Object.entries(CAREER_CV_FIELDS).filter(([key]) => cv && cv[key]).map(([key, title]) =>
    '<div class="cv-label">' + escapeHtml(title) + '</div><p class="cv-text">' + escapeHtml(cv[key]) + '</p>');
  return parts.length ? parts.join("") : '<p class="muted-small">No CV was attached.</p>';
}

function paintCareerCvStatus() {
  const el = careerEl("careerCvStatus");
  if (!el || !careerProfile) return;
  el.innerHTML = careerSavedCv()
    ? '<span class="badge mint">Saved. Sent with your applications</span>'
    : '<span class="badge gold">Not saved yet</span>';
}

// jobs.js listens so the Apply buttons switch on as soon as the CV has loaded or been saved.
function careerCvChanged() {
  paintCareerCvStatus();
  if (typeof onCareerCvChange === "function") onCareerCvChange();
}

function renderCareers(me, cls) {
  if (!me) return;
  if (careerProfile) { paintCareerCvStatus(); return; }
  if (careerLoad) return;
  if (me._studentView || t29SvActive()) {
    careerProfile = {};
    careerEl("careerCvMsg").textContent = "CV saving is available from a student account.";
    careerCvChanged();
    return;
  }
  for (const field of careerEl("careerCv").querySelectorAll("textarea")) field.readOnly = true;
  careerEl("careerCvMsg").textContent = "Loading your CV…";
  careerLoad = careerProfileRef(me.username).get().then(snap => {
    careerProfile = snap.exists ? snap.data() : {};
    setCareerCv(careerProfile.cv);
    for (const field of careerEl("careerCv").querySelectorAll("textarea")) field.readOnly = false;
    careerEl("careerCvMsg").textContent = "";
    careerEl("careerCv").querySelector('button[type="submit"]').disabled = false;
    careerCvChanged();
  }).catch(() => {
    careerEl("careerCvMsg").textContent = "Couldn't load your CV. Reload this page to try again.";
  }).finally(() => { careerLoad = null; });
}

async function saveCareerCv(event) {
  event.preventDefault();
  const button = event.submitter || careerEl("careerCv").querySelector('button[type="submit"]');
  if (!careerProfile || button.disabled || t29SvActive()) return;
  const cv = readCareerCv();
  const message = careerEl("careerCvMsg");
  if (!Object.values(cv).some(Boolean)) {
    message.textContent = "Fill in at least one section before saving your CV.";
    return;
  }
  button.disabled = true;
  try {
    await careerProfileRef(CURRENT.username).set({cv}, {merge: true});
    careerProfile.cv = cv;
    message.textContent = "CV saved. You can now apply for jobs below, and it will be sent with each application.";
    careerCvChanged();
  } catch {
    message.textContent = "Couldn't save your CV. Try again.";
  } finally { button.disabled = false; }
}

function downloadCareerCv() {
  const cv = readCareerCv();
  const sections = Object.entries(CAREER_CV_FIELDS).filter(([key]) => cv[key]);
  if (!sections.length) {
    careerEl("careerCvMsg").textContent = "Fill in at least one section to download your CV.";
    return;
  }
  const text = t29DisplayName(CURRENT) + "\n\n" + sections.map(([key, title]) => title + "\n" + cv[key]).join("\n\n") + "\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"}));
  link.download = "My CV.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
