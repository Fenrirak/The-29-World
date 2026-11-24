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
