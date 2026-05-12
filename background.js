const STORAGE_KEY = "currentExport";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "page-to-markdown:auto-request") {
    void handleAutoRequest(message.tabId).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: toMessage(error) })
    );
    return true;
  }

  if (message?.type === "page-to-markdown:manual-request") {
    void handleManualRequest(message.tabId).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: toMessage(error) })
    );
    return true;
  }

  if (message?.type === "page-to-markdown:manual-complete") {
    void persistExport(message.payload).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: toMessage(error) })
    );
    return true;
  }

  return false;
});

async function handleAutoRequest(tabId) {
  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "page-to-markdown:run-auto"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The page did not return an exportable API document.");
  }

  await persistExport(response.payload);
}

async function handleManualRequest(tabId) {
  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "page-to-markdown:start-manual"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to start manual selection mode.");
  }
}

async function persistExport(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The page returned an invalid export payload.");
  }

  if (!payload.markdown || !payload.markdown.trim()) {
    throw new Error("The extracted Markdown content is empty.");
  }

  await chrome.storage.session.set({
    [STORAGE_KEY]: payload
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL("preview.html")
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["field-path-utils.js", "content-script.js"]
    });
  } catch (error) {
    throw new Error(`Unable to access this page: ${toMessage(error)}`);
  }
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
