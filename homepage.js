const tabList = document.querySelector(".home-tabs");
const tabs = [...tabList.querySelectorAll('[role="tab"]')];

function selectTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
  }
}

function tabFromUrl() {
  return tabs.find(tab => "#" + tab.getAttribute("aria-controls") === location.hash) || tabs[0];
}

function openTab(tab) {
  if (tab.getAttribute("aria-selected") === "true") return;
  selectTab(tab);
  history.pushState(null, "", "#" + tab.getAttribute("aria-controls"));
}

for (const tab of tabs) tab.addEventListener("click", () => openTab(tab));
tabList.addEventListener("keydown", event => {
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  let next;
  switch (event.key) {
    case "ArrowRight": next = (index + 1) % tabs.length; break;
    case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
    case "Home": next = 0; break;
    case "End": next = tabs.length - 1; break;
    default: return;
  }
  event.preventDefault();
  tabs[next].focus();
  openTab(tabs[next]);
});

selectTab(tabFromUrl());
window.addEventListener("hashchange", () => selectTab(tabFromUrl()));
window.addEventListener("pageshow", () => selectTab(tabFromUrl()));

// The sample payday uses classroom dollars and runs entirely on this page.
const savings = document.getElementById("savings");
const savingsAmount = document.getElementById("savings-amount");
const ledgerSavings = document.getElementById("ledger-savings");
const spending = document.getElementById("spending");

function updatePayday() {
  const saved = savings.valueAsNumber;
  savingsAmount.textContent = ledgerSavings.textContent = "$" + saved;
  savings.setAttribute("aria-valuetext", saved + " classroom dollars");
  spending.value = "$" + (Number(savings.max) - saved);
}

savings.addEventListener("input", updatePayday);
window.addEventListener("pageshow", updatePayday);
updatePayday();
document.getElementById("savings-control").hidden = false;
