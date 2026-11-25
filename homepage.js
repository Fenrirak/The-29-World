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
