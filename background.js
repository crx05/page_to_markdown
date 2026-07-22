importScripts("export-storage-core.js");

const LEGACY_STORAGE_KEY = "currentExport";
const EXPORT_INDEX_KEY = "exportIndex";
const MAX_EXPORT_COUNT = 10;
const MAX_STORAGE_BYTES = 8 * 1024 * 1024;
const storageCore = globalThis.PageToMarkdownExportStorageCore;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = routeMessage(message, sender);
  if (!task) {
    return false;
  }

  void task.then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: toMessage(error) })
  );
  return true;
});

function routeMessage(message, sender) {
  switch (message?.type) {
    case "page-to-markdown:auto-request":
      return handleAutoRequest(message.tabId);
    case "page-to-markdown:manual-request":
      return handleManualRequest(message.tabId);
    case "page-to-markdown:manual-complete":
      return handleManualComplete(message.payload, sender);
    case "page-to-markdown:get-export":
      return getExportForPreview(message.exportId);
    case "page-to-markdown:update-export":
      return updateExport(message.exportId, message.changes);
    case "page-to-markdown:reextract-export":
      return reextractExport(message.exportId);
    default:
      return null;
  }
}

async function handleAutoRequest(tabId) {
  validateTabId(tabId);
  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "page-to-markdown:run-auto"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The page did not return an exportable API document.");
  }

  return persistAndOpenExport(response.payload, tabId);
}

async function handleManualRequest(tabId) {
  validateTabId(tabId);
  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "page-to-markdown:start-manual"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to start manual selection mode.");
  }

  return {};
}

async function handleManualComplete(payload, sender) {
  if (!sender?.tab?.id) {
    throw new Error("Manual exports must originate from a captured web page.");
  }
  return persistAndOpenExport(payload, sender.tab.id);
}

async function persistAndOpenExport(payload, sourceTabId) {
  const record = normalizeExportPayload({ ...payload, sourceTabId });
  const exportId = crypto.randomUUID();
  await storeExport(exportId, record);
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL("preview.html")}?id=${encodeURIComponent(exportId)}`
  });
  return { exportId };
}

async function getExportForPreview(requestedId) {
  if (requestedId) {
    const key = exportKey(requestedId);
    const stored = await chrome.storage.session.get(key);
    const record = stored[key];
    if (!record) {
      return { exportId: requestedId, record: null };
    }
    await touchExport(requestedId, record);
    return { exportId: requestedId, record };
  }

  const legacy = await chrome.storage.session.get(LEGACY_STORAGE_KEY);
  if (!legacy[LEGACY_STORAGE_KEY]) {
    return { exportId: null, record: null };
  }

  const record = normalizeExportPayload(legacy[LEGACY_STORAGE_KEY]);
  const exportId = crypto.randomUUID();
  await storeExport(exportId, record);
  await chrome.storage.session.remove(LEGACY_STORAGE_KEY);
  return { exportId, record, migrated: true };
}

async function updateExport(exportId, changes) {
  if (!isValidExportId(exportId)) {
    throw new Error("The preview export ID is invalid.");
  }

  const key = exportKey(exportId);
  const stored = await chrome.storage.session.get(key);
  const current = stored[key];
  if (!current) {
    throw new Error("This export is no longer available in session storage.");
  }

  const next = {
    ...current,
    markdown: typeof changes?.markdown === "string" ? changes.markdown : current.markdown,
    filename: typeof changes?.filename === "string" ? changes.filename : current.filename,
    updatedAt: new Date().toISOString()
  };

  if (!next.markdown.trim()) {
    throw new Error("Markdown content cannot be empty.");
  }

  await storeExport(exportId, next);
  return { exportId, updatedAt: next.updatedAt };
}

async function reextractExport(exportId) {
  if (!isValidExportId(exportId)) {
    throw new Error("The preview export ID is invalid.");
  }
  const key = exportKey(exportId);
  const stored = await chrome.storage.session.get(key);
  const current = stored[key];
  if (!current || !Number.isInteger(current.sourceTabId)) {
    throw new Error("The original source tab is no longer associated with this export.");
  }

  try {
    await chrome.tabs.get(current.sourceTabId);
  } catch {
    throw new Error("The original source tab has been closed.");
  }

  await ensureContentScript(current.sourceTabId);
  const response = await chrome.tabs.sendMessage(current.sourceTabId, {
    type: "page-to-markdown:run-auto"
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Re-extraction failed.");
  }

  const next = normalizeExportPayload({ ...response.payload, sourceTabId: current.sourceTabId });
  await storeExport(exportId, next);
  return { exportId, record: next };
}

async function storeExport(exportId, record) {
  if (!isValidExportId(exportId)) {
    throw new Error("Unable to create a valid export ID.");
  }

  const normalized = normalizeExportPayload(record);
  normalized.updatedAt = record.updatedAt || normalized.capturedAt;
  const sizeBytes = storageCore.estimateBytes(normalized);
  if (sizeBytes > MAX_STORAGE_BYTES) {
    throw new Error("This Markdown export is larger than the 8 MiB session limit. Reduce the selected page area and try again.");
  }

  const stored = await chrome.storage.session.get(EXPORT_INDEX_KEY);
  const previousIndex = Array.isArray(stored[EXPORT_INDEX_KEY]) ? stored[EXPORT_INDEX_KEY] : [];
  const currentEntry = previousIndex.find((entry) => entry.id === exportId);
  const nextEntry = {
    id: exportId,
    createdAt: currentEntry?.createdAt || normalized.capturedAt,
    updatedAt: normalized.updatedAt,
    sizeBytes
  };
  const nextIndex = previousIndex.filter((entry) => entry.id !== exportId);
  nextIndex.push(nextEntry);
  const { kept: prunedIndex, removedIds } = storageCore.pruneExportIndex(
    nextIndex,
    exportId,
    MAX_EXPORT_COUNT,
    MAX_STORAGE_BYTES
  );

  if (removedIds.length) {
    await chrome.storage.session.remove(removedIds.map(exportKey));
  }
  await chrome.storage.session.set({
    [exportKey(exportId)]: normalized,
    [EXPORT_INDEX_KEY]: prunedIndex
  });
}

async function touchExport(exportId, record) {
  const stored = await chrome.storage.session.get(EXPORT_INDEX_KEY);
  const index = Array.isArray(stored[EXPORT_INDEX_KEY]) ? stored[EXPORT_INDEX_KEY] : [];
  const entry = index.find((item) => item.id === exportId);
  if (!entry) {
    return;
  }
  entry.updatedAt = new Date().toISOString();
  index.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  await chrome.storage.session.set({ [EXPORT_INDEX_KEY]: index });
}

function normalizeExportPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The page returned an invalid export payload.");
  }
  if (typeof payload.markdown !== "string" || !payload.markdown.trim()) {
    throw new Error("The extracted Markdown content is empty.");
  }

  return {
    title: stringValue(payload.title, "API Documentation", 500),
    url: stringValue(payload.url, "", 8192),
    markdown: payload.markdown,
    filename: stringValue(payload.filename, "page.md", 240),
    capturedAt: validIsoDate(payload.capturedAt) || new Date().toISOString(),
    extractionMode: stringValue(payload.extractionMode, "unknown", 80),
    detectedPlatform: stringValue(payload.detectedPlatform, "unknown", 80),
    adapterId: stringValue(payload.adapterId, payload.detectedPlatform || "unknown", 80),
    confidence: ["high", "medium", "low"].includes(payload.confidence) ? payload.confidence : "medium",
    rootReason: stringValue(payload.rootReason, "", 1000),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 20).map((warning) => stringValue(warning, "", 1000)).filter(Boolean) : [],
    expandedCount: Number.isFinite(payload.expandedCount) ? Math.max(0, Math.trunc(payload.expandedCount)) : 0,
    sourceTabId: Number.isInteger(payload.sourceTabId) ? payload.sourceTabId : null,
    updatedAt: validIsoDate(payload.updatedAt) || validIsoDate(payload.capturedAt) || new Date().toISOString()
  };
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["field-path-utils.js", "markdown-converter.js", "platform-adapters.js", "extraction-core.js", "content-script.js"]
    });
  } catch (error) {
    throw new Error(`Unable to access this page: ${toMessage(error)}`);
  }
}

function validateTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("The active tab ID is invalid.");
  }
}

function exportKey(exportId) {
  return storageCore.exportKey(exportId);
}

function isValidExportId(exportId) {
  return storageCore.isValidExportId(exportId);
}

function stringValue(value, fallback, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function validIsoDate(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return "";
  }
  return new Date(value).toISOString();
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
