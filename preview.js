const STORAGE_KEY = "currentExport";

const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");
const modeBadge = document.getElementById("modeBadge");
const platformBadge = document.getElementById("platformBadge");
const filenameInput = document.getElementById("filenameInput");
const downloadButton = document.getElementById("downloadButton");
const downloadStatus = document.getElementById("downloadStatus");
const markdownEditor = document.getElementById("markdownEditor");
const statsText = document.getElementById("statsText");
const capturedText = document.getElementById("capturedText");

let currentExport = null;

document.addEventListener("DOMContentLoaded", () => {
  void initializePreview();
});

markdownEditor.addEventListener("input", () => {
  updateStats(markdownEditor.value);
  clearStatus();
});

filenameInput.addEventListener("input", () => {
  clearStatus();
});

downloadButton.addEventListener("click", () => {
  void downloadMarkdown();
});

async function initializePreview() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  currentExport = stored[STORAGE_KEY];

  if (!currentExport) {
    pageTitle.textContent = "No captured page found";
    pageUrl.textContent = "Open the extension from a web page and convert it first.";
    pageUrl.removeAttribute("href");
    modeBadge.textContent = "No export";
    platformBadge.textContent = "Unknown";
    markdownEditor.value = "";
    markdownEditor.disabled = true;
    filenameInput.disabled = true;
    downloadButton.disabled = true;
    capturedText.textContent = "No data in session storage";
    updateStats("");
    return;
  }

  pageTitle.textContent = currentExport.title;
  pageUrl.textContent = currentExport.url;
  pageUrl.href = currentExport.url;
  modeBadge.textContent = formatExtractionMode(currentExport.extractionMode);
  platformBadge.textContent = formatPlatform(currentExport.detectedPlatform);
  filenameInput.value = currentExport.filename || "page.md";
  markdownEditor.value = currentExport.markdown || "";
  capturedText.textContent = `Captured at ${formatTimestamp(currentExport.capturedAt)}`;
  updateStats(markdownEditor.value);
}

async function downloadMarkdown() {
  if (!currentExport) {
    setStatus("There is no Markdown content to download.", "error");
    return;
  }

  const markdown = markdownEditor.value;

  if (!markdown.trim()) {
    setStatus("Markdown content is empty.", "error");
    return;
  }

  downloadButton.disabled = true;
  setStatus("Preparing download...", "default");

  const filename = ensureMarkdownExtension(sanitizeFilename(filenameInput.value || currentExport.filename || "page.md"));
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: true
    });

    setStatus(`Downloaded as ${filename}`, "success");
  } catch (error) {
    try {
      const fallbackLink = document.createElement("a");
      fallbackLink.href = blobUrl;
      fallbackLink.download = filename;
      fallbackLink.click();
      setStatus(`Downloaded as ${filename}`, "success");
    } catch {
      const message = error instanceof Error ? error.message : "Download failed.";
      setStatus(message, "error");
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    downloadButton.disabled = false;
  }
}

function updateStats(markdown) {
  const characters = markdown.length;
  const lines = markdown ? markdown.split("\n").length : 0;
  statsText.textContent = `${characters} chars · ${lines} lines`;
}

function setStatus(message, tone) {
  downloadStatus.textContent = message;
  downloadStatus.dataset.tone = tone;
}

function clearStatus() {
  downloadStatus.textContent = "";
  downloadStatus.dataset.tone = "default";
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return "unknown time";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return date.toLocaleString();
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "page.md";
}

function ensureMarkdownExtension(filename) {
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function formatExtractionMode(mode) {
  switch (mode) {
    case "auto-platform":
      return "Auto: Platform";
    case "auto-generic":
      return "Auto: Generic";
    case "manual-selection":
      return "Manual Selection";
    default:
      return "Unknown Mode";
  }
}

function formatPlatform(platform) {
  switch (platform) {
    case "swagger-ui":
      return "Swagger UI";
    case "redoc":
      return "Redoc";
    default:
      return "Platform: Unknown";
  }
}
