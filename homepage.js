// This example lives entirely on the public page and never touches a class account.
const savings = document.getElementById("savings");
const savingsAmount = document.getElementById("savings-amount");
const ledgerSavings = document.getElementById("ledger-savings");
const spending = document.getElementById("spending");

function updatePayday() {
  const saved = savings.valueAsNumber;
  savingsAmount.textContent = "$" + saved;
  savings.setAttribute("aria-valuetext", saved + " classroom dollars");
  ledgerSavings.textContent = saved ? "−$" + saved : "$0";
  spending.value = "$" + (Number(savings.max) - saved);
}

savings.addEventListener("input", updatePayday);
window.addEventListener("pageshow", updatePayday);
updatePayday();
document.getElementById("savings-control").hidden = false;
