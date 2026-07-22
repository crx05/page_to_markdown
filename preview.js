const elements = {
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  modeBadge: document.getElementById("modeBadge"),
  platformBadge: document.getElementById("platformBadge"),
  confidenceBadge: document.getElementById("confidenceBadge"),
  warningPanel: document.getElementById("warningPanel"),
  filenameInput: document.getElementById("filenameInput"),
  downloadButton: document.getElementById("downloadButton"),
  copyButton: document.getElementById("copyButton"),
  reextractButton: document.getElementById("reextractButton"),
  actionStatus: document.getElementById("actionStatus"),
  markdownEditor: document.getElementById("markdownEditor"),
  renderedPreview: document.getElementById("renderedPreview"),
  statsText: document.getElementById("statsText"),
  capturedText: document.getElementById("capturedText"),
  saveStatus: document.getElementById("saveStatus"),
  workspace: document.getElementById("workspace"),
  editTab: document.getElementById("editTab"),
  previewTab: document.getElementById("previewTab")
};

let currentExport = null;
let exportId = null;
let renderTimer = 0;
let saveTimer = 0;
let saveSequence = 0;

document.addEventListener("DOMContentLoaded", () => void initializePreview());
elements.markdownEditor.addEventListener("input", handleEditorInput);
elements.filenameInput.addEventListener("input", scheduleSave);
elements.downloadButton.addEventListener("click", () => void downloadMarkdown());
elements.copyButton.addEventListener("click", () => void copyMarkdown());
elements.reextractButton.addEventListener("click", () => void reextractSource());
elements.editTab.addEventListener("click", () => setViewMode("edit"));
elements.previewTab.addEventListener("click", () => setViewMode("preview"));

async function initializePreview() {
  try {
    const requestedId = new URLSearchParams(location.search).get("id");
    const response = await chrome.runtime.sendMessage({
      type: "page-to-markdown:get-export",
      exportId: requestedId
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load the captured Markdown.");
    }
    if (!response.record) {
      showEmptyState();
      return;
    }

    exportId = response.exportId;
    currentExport = response.record;
    if (!requestedId && exportId) {
      history.replaceState(null, "", `${location.pathname}?id=${encodeURIComponent(exportId)}`);
    }
    applyExport(currentExport);
  } catch (error) {
    showEmptyState(toMessage(error));
  }
}

function applyExport(record) {
  elements.pageTitle.textContent = record.title || "API Documentation";
  elements.pageUrl.textContent = record.url || "Source URL unavailable";
  if (/^https?:/i.test(record.url || "")) {
    elements.pageUrl.href = record.url;
  } else {
    elements.pageUrl.removeAttribute("href");
  }
  elements.modeBadge.textContent = formatExtractionMode(record.extractionMode);
  elements.platformBadge.textContent = formatPlatform(record.detectedPlatform);
  elements.confidenceBadge.textContent = `${capitalize(record.confidence || "unknown")} confidence`;
  elements.confidenceBadge.dataset.confidence = record.confidence || "unknown";
  elements.filenameInput.value = record.filename || "page.md";
  elements.markdownEditor.value = record.markdown || "";
  elements.capturedText.textContent = `Captured ${formatTimestamp(record.capturedAt)}`;
  elements.reextractButton.disabled = !Number.isInteger(record.sourceTabId);
  renderWarnings(record.warnings || [], record.expandedCount || 0);
  updateStats(record.markdown || "");
  renderMarkdown(record.markdown || "");
  setSaveStatus("Saved", "success");
}

function handleEditorInput() {
  const markdown = elements.markdownEditor.value;
  updateStats(markdown);
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderMarkdown(markdown), 150);
  scheduleSave();
}

function renderMarkdown(markdown) {
  try {
    const safeHtml = globalThis.PageToMarkdownPreviewRenderer.renderSanitizedMarkdown(
      markdown,
      globalThis.marked,
      globalThis.DOMPurify
    );
    elements.renderedPreview.innerHTML = safeHtml;
    for (const link of elements.renderedPreview.querySelectorAll("a[href]")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
    }
    for (const image of elements.renderedPreview.querySelectorAll("img")) {
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
    }
  } catch (error) {
    elements.renderedPreview.textContent = `Preview error: ${toMessage(error)}`;
  }
}

function scheduleSave() {
  if (!currentExport || !exportId) {
    return;
  }
  setSaveStatus("Unsaved changes", "default");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveChanges(), 300);
}

async function saveChanges() {
  const markdown = elements.markdownEditor.value;
  if (!markdown.trim()) {
    setSaveStatus("Empty content is not saved", "error");
    return;
  }
  const sequence = ++saveSequence;
  setSaveStatus("Saving…", "default");
  const response = await chrome.runtime.sendMessage({
    type: "page-to-markdown:update-export",
    exportId,
    changes: { markdown, filename: elements.filenameInput.value }
  });
  if (sequence !== saveSequence) {
    return;
  }
  if (!response?.ok) {
    setSaveStatus(response?.error || "Save failed", "error");
    return;
  }
  currentExport.markdown = markdown;
  currentExport.filename = elements.filenameInput.value;
  setSaveStatus("Saved", "success");
}

async function reextractSource() {
  if (!exportId) {
    return;
  }
  setActionsBusy(true);
  setActionStatus("Re-extracting the original source tab…", "default");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "page-to-markdown:reextract-export",
      exportId
    });
    if (!response?.ok || !response.record) {
      throw new Error(response?.error || "Re-extraction failed.");
    }
    currentExport = response.record;
    applyExport(currentExport);
    setActionStatus("Source tab extracted again.", "success");
  } catch (error) {
    setActionStatus(toMessage(error), "error");
  } finally {
    setActionsBusy(false);
  }
}

async function copyMarkdown() {
  const markdown = elements.markdownEditor.value;
  if (!markdown.trim()) {
    setActionStatus("Markdown content is empty.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(markdown);
    setActionStatus("Markdown copied to the clipboard.", "success");
  } catch (error) {
    setActionStatus(toMessage(error), "error");
  }
}

async function downloadMarkdown() {
  const markdown = elements.markdownEditor.value;
  if (!markdown.trim()) {
    setActionStatus("Markdown content is empty.", "error");
    return;
  }
  const filename = ensureMarkdownExtension(sanitizeFilename(elements.filenameInput.value || "page.md"));
  const blobUrl = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  elements.downloadButton.disabled = true;
  try {
    await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
    setActionStatus(`Downloaded as ${filename}`, "success");
  } catch (error) {
    setActionStatus(toMessage(error), "error");
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    elements.downloadButton.disabled = false;
  }
}

function renderWarnings(warnings, expandedCount) {
  const messages = [...warnings];
  if (expandedCount > 0) {
    messages.unshift(`Expanded ${expandedCount} documentation section${expandedCount === 1 ? "" : "s"} before capture.`);
  }
  elements.warningPanel.hidden = messages.length === 0;
  elements.warningPanel.replaceChildren();
  if (!messages.length) {
    return;
  }
  const list = document.createElement("ul");
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.appendChild(item);
  }
  elements.warningPanel.appendChild(list);
}

function setViewMode(mode) {
  elements.workspace.dataset.view = mode;
  const editing = mode === "edit";
  elements.editTab.classList.toggle("is-active", editing);
  elements.previewTab.classList.toggle("is-active", !editing);
  elements.editTab.setAttribute("aria-selected", String(editing));
  elements.previewTab.setAttribute("aria-selected", String(!editing));
}

function showEmptyState(message = "Open the extension from a web page and convert it first.") {
  currentExport = null;
  elements.pageTitle.textContent = "No captured page found";
  elements.pageUrl.textContent = message;
  elements.pageUrl.removeAttribute("href");
  elements.markdownEditor.value = "";
  elements.markdownEditor.disabled = true;
  elements.filenameInput.disabled = true;
  elements.downloadButton.disabled = true;
  elements.copyButton.disabled = true;
  elements.reextractButton.disabled = true;
  elements.renderedPreview.textContent = message;
  updateStats("");
}

function setActionsBusy(busy) {
  elements.reextractButton.disabled = busy || !Number.isInteger(currentExport?.sourceTabId);
  elements.copyButton.disabled = busy;
  elements.downloadButton.disabled = busy;
}

function updateStats(markdown) {
  elements.statsText.textContent = `${markdown.length} chars · ${markdown ? markdown.split("\n").length : 0} lines`;
}

function setActionStatus(message, tone) {
  elements.actionStatus.textContent = message;
  elements.actionStatus.dataset.tone = tone;
}

function setSaveStatus(message, tone) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.dataset.tone = tone;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "at an unknown time" : date.toLocaleString();
}

function formatExtractionMode(mode) {
  return ({ "auto-platform": "Auto: Platform", "auto-generic": "Auto: Generic", "manual-selection": "Manual Selection" })[mode] || "Unknown Mode";
}

function formatPlatform(platform) {
  return ({ "swagger-ui": "Swagger UI", redoc: "Redoc", apifox: "Apifox", yapi: "YApi", postman: "Postman Docs", unknown: "Generic" })[platform] || platform || "Generic";
}

function sanitizeFilename(name) {
  return String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "page.md";
}

function ensureMarkdownExtension(filename) {
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unknown";
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
