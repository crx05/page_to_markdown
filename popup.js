const autoConvertButton = document.getElementById("autoConvertButton");
const manualSelectButton = document.getElementById("manualSelectButton");
const statusMessage = document.getElementById("statusMessage");

autoConvertButton.addEventListener("click", () => {
  void startAutoConversion();
});

manualSelectButton.addEventListener("click", () => {
  void startManualSelection();
});

async function startAutoConversion() {
  setBusy(true);
  setStatus("Extracting API documentation from the active tab...", "default");

  try {
    const tab = await getCurrentTab();
    validateTab(tab);

    const response = await chrome.runtime.sendMessage({
      type: "page-to-markdown:auto-request",
      tabId: tab.id
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Auto extraction failed.");
    }

    setStatus("Preview opened with the extracted API documentation.", "success");
    window.setTimeout(() => window.close(), 450);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected conversion error.";
    setStatus(message, "error");
  } finally {
    setBusy(false);
  }
}

async function startManualSelection() {
  setBusy(true);
  setStatus("Preparing manual selection mode...", "default");

  try {
    const tab = await getCurrentTab();
    validateTab(tab);

    const response = await chrome.runtime.sendMessage({
      type: "page-to-markdown:manual-request",
      tabId: tab.id
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to start manual selection.");
    }

    setStatus("Selection mode is ready. Click the API content area in the page, then confirm.", "success");
    window.setTimeout(() => window.close(), 350);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start manual selection.";
    setStatus(message, "error");
    setBusy(false);
  }
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id || !tab.url) {
    throw new Error("No active tab is available.");
  }

  return tab;
}

function validateTab(tab) {
  if (!/^https?:/i.test(tab.url)) {
    throw new Error("This extension currently supports only http and https pages.");
  }

  const blockedHosts = [
    "chromewebstore.google.com",
    "chrome.google.com"
  ];

  const currentUrl = new URL(tab.url);
  if (blockedHosts.includes(currentUrl.hostname) && currentUrl.pathname.includes("/webstore")) {
    throw new Error("Chrome Web Store pages cannot be captured by extensions.");
  }
}

function setBusy(isBusy) {
  autoConvertButton.disabled = isBusy;
  manualSelectButton.disabled = isBusy;
}

function setStatus(message, tone) {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = tone;
}
