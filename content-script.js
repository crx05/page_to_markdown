(() => {
  if (globalThis.__pageToMarkdownContentScriptInstalled) {
    return;
  }

  globalThis.__pageToMarkdownContentScriptInstalled = true;

  const manualSelectionState = {
    active: false,
    cleanup: null
  };

  const API_KEYWORDS = [
    "endpoint",
    "parameters",
    "request body",
    "response body",
    "response",
    "request",
    "schema",
    "example",
    "examples",
    "status code",
    "authentication",
    "headers",
    "query params",
    "path params",
    "payload",
    "curl",
    "json"
  ];

  const NAV_KEYWORDS = [
    "navigation",
    "sidebar",
    "sidenav",
    "table of contents",
    "contents",
    "menu",
    "breadcrumb",
    "skip to main",
    "on this page",
    "filter",
    "search",
    "collapse all",
    "expand all"
  ];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "page-to-markdown:run-auto") {
      void handleAutoRequest().then(
        (payload) => sendResponse({ ok: true, payload }),
        (error) => sendResponse({ ok: false, error: toMessage(error) })
      );
      return true;
    }

    if (message?.type === "page-to-markdown:start-manual") {
      try {
        startManualSelection();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: toMessage(error) });
      }
      return false;
    }

    return false;
  });

  async function handleAutoRequest() {
    const payload = extractApiDocument();
    return payload;
  }

  function startManualSelection() {
    if (manualSelectionState.active) {
      throw new Error("Manual selection is already active on this page.");
    }

    manualSelectionState.active = true;
    manualSelectionState.cleanup = createManualSelectionSession();
  }

  function createManualSelectionSession() {
    const overlayRoot = document.createElement("div");
    overlayRoot.id = "page-to-markdown-selector-root";
    overlayRoot.innerHTML = `
      <style>
        #page-to-markdown-selector-root {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        }
        .ptm-highlight {
          position: fixed;
          border: 2px solid rgba(16, 110, 82, 0.95);
          background: rgba(16, 110, 82, 0.12);
          box-shadow: 0 0 0 9999px rgba(20, 24, 18, 0.08);
          border-radius: 12px;
          pointer-events: none;
          transition: transform 80ms ease, width 80ms ease, height 80ms ease, top 80ms ease, left 80ms ease;
        }
        .ptm-instructions,
        .ptm-toolbar,
        .ptm-toast {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: auto;
          border-radius: 999px;
          padding: 10px 16px;
          color: #fff9ef;
          background: rgba(27, 36, 32, 0.96);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22);
          font-size: 13px;
          line-height: 1.35;
        }
        .ptm-instructions {
          top: 18px;
        }
        .ptm-toolbar {
          bottom: 18px;
          display: none;
          align-items: center;
          gap: 10px;
          border-radius: 18px;
          padding: 12px 14px;
          max-width: min(92vw, 760px);
        }
        .ptm-toolbar.is-visible {
          display: flex;
        }
        .ptm-selection-label {
          flex: 1;
          min-width: 0;
          color: #d8eee5;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ptm-toolbar button {
          border: 0;
          border-radius: 999px;
          padding: 10px 14px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }
        .ptm-confirm {
          background: #48c68c;
          color: #0d271c;
        }
        .ptm-reselect {
          background: rgba(255, 255, 255, 0.16);
          color: #fff9ef;
        }
        .ptm-cancel {
          background: rgba(255, 255, 255, 0.08);
          color: #d7cdc2;
        }
        .ptm-toast {
          top: 68px;
          opacity: 0;
          transition: opacity 120ms ease;
          pointer-events: none;
        }
        .ptm-toast.is-visible {
          opacity: 1;
        }
        .ptm-toast[data-tone="success"] {
          background: rgba(20, 92, 57, 0.97);
        }
        .ptm-toast[data-tone="error"] {
          background: rgba(130, 35, 22, 0.97);
        }
      </style>
      <div class="ptm-highlight"></div>
      <div class="ptm-instructions">Move over the page, click the API content area, then confirm. Press Esc to cancel.</div>
      <div class="ptm-toast"></div>
      <div class="ptm-toolbar">
        <span class="ptm-selection-label">No selection yet</span>
        <button class="ptm-confirm" type="button">Confirm</button>
        <button class="ptm-reselect" type="button">Reselect</button>
        <button class="ptm-cancel" type="button">Cancel</button>
      </div>
    `;

    document.documentElement.appendChild(overlayRoot);

    const highlightBox = overlayRoot.querySelector(".ptm-highlight");
    const toolbar = overlayRoot.querySelector(".ptm-toolbar");
    const selectionLabel = overlayRoot.querySelector(".ptm-selection-label");
    const confirmButton = overlayRoot.querySelector(".ptm-confirm");
    const reselectButton = overlayRoot.querySelector(".ptm-reselect");
    const cancelButton = overlayRoot.querySelector(".ptm-cancel");
    const toast = overlayRoot.querySelector(".ptm-toast");

    let hoverCandidate = null;
    let selectedNode = null;
    let lockedSelection = false;
    let toastTimer = 0;

    document.addEventListener("mousemove", handlePointerMove, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    confirmButton.addEventListener("click", handleConfirmClick);
    reselectButton.addEventListener("click", handleReselectClick);
    cancelButton.addEventListener("click", handleCancelClick);

    updateHighlight(findInitialCandidate());

    return cleanup;

    function handlePointerMove(event) {
      if (lockedSelection) {
        return;
      }

      const candidate = findSelectableCandidate(event.target);
      updateHighlight(candidate);
    }

    function handleDocumentClick(event) {
      if (overlayRoot.contains(event.target)) {
        return;
      }

      if (lockedSelection) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const candidate = findSelectableCandidate(event.target);
      if (!candidate) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      lockedSelection = true;
      selectedNode = candidate;
      updateHighlight(candidate);
      toolbar.classList.add("is-visible");
      selectionLabel.textContent = describeNode(candidate);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      cleanup();
    }

    async function handleConfirmClick(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!selectedNode) {
        showToast("Select the API content area first.", "error");
        return;
      }

      if (looksLikeNavigation(selectedNode)) {
        showToast("That selection looks like navigation. Choose the documentation content pane instead.", "error");
        return;
      }

      confirmButton.disabled = true;
      reselectButton.disabled = true;
      cancelButton.disabled = true;
      showToast("Generating Markdown from the selected content...", "default");

      try {
        const payload = extractApiDocument({ selectedRoot: selectedNode, forceManual: true });

        const response = await chrome.runtime.sendMessage({
          type: "page-to-markdown:manual-complete",
          payload
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Unable to open the preview for the selected content.");
        }

        cleanup();
      } catch (error) {
        confirmButton.disabled = false;
        reselectButton.disabled = false;
        cancelButton.disabled = false;
        showToast(toMessage(error), "error");
      }
    }

    function handleReselectClick(event) {
      event.preventDefault();
      event.stopPropagation();
      lockedSelection = false;
      selectedNode = null;
      toolbar.classList.remove("is-visible");
      confirmButton.disabled = false;
      reselectButton.disabled = false;
      cancelButton.disabled = false;
      updateHighlight(hoverCandidate || findInitialCandidate());
    }

    function handleCancelClick(event) {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    }

    function cleanup() {
      if (!manualSelectionState.active) {
        return;
      }

      document.removeEventListener("mousemove", handlePointerMove, true);
      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);

      confirmButton.removeEventListener("click", handleConfirmClick);
      reselectButton.removeEventListener("click", handleReselectClick);
      cancelButton.removeEventListener("click", handleCancelClick);

      overlayRoot.remove();
      manualSelectionState.active = false;
      manualSelectionState.cleanup = null;

      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }
    }

    function updateHighlight(candidate) {
      hoverCandidate = candidate;

      if (!candidate) {
        highlightBox.style.display = "none";
        return;
      }

      const rect = candidate.getBoundingClientRect();
      highlightBox.style.display = "block";
      highlightBox.style.top = `${rect.top}px`;
      highlightBox.style.left = `${rect.left}px`;
      highlightBox.style.width = `${rect.width}px`;
      highlightBox.style.height = `${rect.height}px`;
    }

    function showToast(message, tone) {
      toast.textContent = message;
      toast.dataset.tone = tone;
      toast.classList.add("is-visible");

      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }

      toastTimer = window.setTimeout(() => {
        toast.classList.remove("is-visible");
      }, 1800);
    }
  }

  function extractApiDocument(options = {}) {
    const detectedPlatform = detectPlatform(document);
    const selectedRoot = options.selectedRoot || pickContentRoot(document, detectedPlatform);
    if (!selectedRoot) {
      throw new Error("Unable to locate API documentation content on this page.");
    }

    const clonedRoot = selectedRoot.cloneNode(true);
    pruneNode(clonedRoot, detectedPlatform);

    const title = pickDocumentTitle(selectedRoot);
    const markdown = convertNodeToMarkdown(clonedRoot).trim();

    if (!markdown || markdown.length < 40) {
      throw new Error("The selected content did not contain enough API documentation to export.");
    }

    const extractionMode = options.forceManual
      ? "manual-selection"
      : detectedPlatform === "unknown"
        ? "auto-generic"
        : "auto-platform";

    return {
      title,
      url: window.location.href,
      markdown: prependFrontMatter(title, window.location.href, markdown, extractionMode, detectedPlatform),
      filename: `${sanitizeFilename(title || "api-documentation")}.md`,
      capturedAt: new Date().toISOString(),
      extractionMode,
      detectedPlatform
    };
  }

  function detectPlatform(doc) {
    if (doc.querySelector(".swagger-ui")) {
      return "swagger-ui";
    }

    if (
      doc.querySelector("redoc") ||
      doc.querySelector("#redoc-container") ||
      (doc.querySelector("[class*='menu-content']") && doc.querySelector("[class*='api-content']"))
    ) {
      return "redoc";
    }

    return "unknown";
  }

  function pickContentRoot(doc, detectedPlatform) {
    const candidates = [];

    for (const selector of getPlatformSelectors(detectedPlatform)) {
      candidates.push(...doc.querySelectorAll(selector));
    }

    const genericSelectors = [
      "article",
      "main",
      "[role='main']",
      ".content",
      ".documentation",
      ".docs-content",
      ".doc-content",
      ".markdown-body",
      ".reference",
      ".api-reference",
      ".main-content",
      ".post-content",
      ".article-content",
      ".entry-content"
    ];

    for (const selector of genericSelectors) {
      candidates.push(...doc.querySelectorAll(selector));
    }

    candidates.push(...doc.querySelectorAll("section, article, main, div"));

    let bestNode = null;
    let bestScore = -Infinity;

    for (const node of candidates) {
      const score = scoreNode(node, detectedPlatform);
      if (score > bestScore) {
        bestNode = node;
        bestScore = score;
      }
    }

    const bodyScore = scoreNode(doc.body, detectedPlatform);
    if (!bestNode || bodyScore > bestScore) {
      bestNode = doc.body;
    }

    return bestNode;
  }

  function getPlatformSelectors(detectedPlatform) {
    if (detectedPlatform === "swagger-ui") {
      return [
        ".swagger-ui .swagger-container",
        ".swagger-ui .wrapper",
        ".swagger-ui"
      ];
    }

    if (detectedPlatform === "redoc") {
      return [
        "[class*='api-content']",
        "#redoc-container main",
        "redoc main",
        "redoc"
      ];
    }

    return [];
  }

  function pruneNode(root, detectedPlatform) {
    const baseSelectors = [
      "script",
      "style",
      "noscript",
      "template",
      "iframe",
      "canvas",
      "svg",
      "form",
      "button",
      "input",
      "select",
      "textarea",
      "nav",
      "aside",
      "footer",
      "[aria-hidden='true']",
      "[role='navigation']",
      "[role='search']",
      ".advertisement",
      ".ads",
      ".ad",
      ".sidebar",
      ".breadcrumbs",
      ".share",
      ".social",
      ".newsletter",
      ".table-of-contents",
      ".toc",
      ".menu",
      ".sidenav",
      ".navigation",
      ".search",
      ".search-box",
      ".search-panel",
      ".theme-switcher",
      ".version-switcher"
    ];

    const platformSelectors = detectedPlatform === "swagger-ui"
      ? [".topbar", ".swagger-ui .scheme-container .download-url-wrapper"]
      : detectedPlatform === "redoc"
        ? ["[class*='menu-content']", "[class*='search-box']", "[class*='side-menu']"]
        : [];

    for (const node of root.querySelectorAll([...baseSelectors, ...platformSelectors].join(","))) {
      node.remove();
    }

    for (const element of root.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name.startsWith("on")) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  function scoreNode(node, detectedPlatform) {
    if (!(node instanceof Element)) {
      return -Infinity;
    }

    const text = cleanWhitespace(node.textContent || "");
    if (text.length < 120) {
      return -Infinity;
    }

    const marker = `${node.className || ""} ${node.id || ""} ${node.getAttribute("role") || ""}`.toLowerCase();
    const paragraphCount = node.querySelectorAll("p").length;
    const headingCount = node.querySelectorAll("h1, h2, h3, h4").length;
    const preCount = node.querySelectorAll("pre").length;
    const codeCount = node.querySelectorAll("code").length;
    const tableCount = node.querySelectorAll("table").length;
    const linkCount = node.querySelectorAll("a").length;
    const listCount = node.querySelectorAll("ul, ol").length;
    const buttonCount = node.querySelectorAll("button").length;
    const linkTextLength = [...node.querySelectorAll("a")]
      .reduce((sum, anchor) => sum + cleanWhitespace(anchor.textContent || "").length, 0);
    const linkDensity = text.length ? linkTextLength / text.length : 0;
    const methodCount = countMatches(text, /\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g);
    const pathCount = countMatches(text, /\/[a-z0-9._{}:-]+(?:\/[a-z0-9._{}:-]+)+/gi);
    const keywordCount = countKeywordHits(text, API_KEYWORDS);
    const navKeywordCount = countKeywordHits(`${marker} ${text.slice(0, 600)}`, NAV_KEYWORDS);
    const codeLikeBlockCount = [...node.querySelectorAll("pre, code")]
      .filter((element) => /[{}\[\]":]/.test(element.textContent || ""))
      .length;

    let score =
      text.length * 0.55 +
      paragraphCount * 80 +
      headingCount * 130 +
      preCount * 180 +
      codeCount * 36 +
      tableCount * 160 +
      methodCount * 120 +
      pathCount * 100 +
      keywordCount * 70 +
      codeLikeBlockCount * 110;

    score -= linkDensity * 1500;
    score -= linkCount * 6;
    score -= listCount * 10;
    score -= buttonCount * 35;
    score -= navKeywordCount * 220;
    score -= markerPenalty(marker);

    if (detectedPlatform === "swagger-ui" && node.matches(".swagger-ui, .swagger-ui .swagger-container, .swagger-ui .wrapper")) {
      score += 900;
    }

    if (detectedPlatform === "redoc" && node.matches("[class*='api-content'], redoc")) {
      score += 950;
    }

    return score;
  }

  function markerPenalty(marker) {
    const penaltyTerms = [
      "comment",
      "footer",
      "header",
      "menu",
      "nav",
      "sidebar",
      "share",
      "social",
      "related",
      "promo",
      "banner",
      "breadcrumb",
      "toc",
      "search",
      "filter"
    ];

    return penaltyTerms.some((term) => marker.includes(term)) ? 900 : 0;
  }

  function countMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  function countKeywordHits(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0);
  }

  function pickDocumentTitle(selectedRoot) {
    const pageTitle = cleanWhitespace(document.title || "");
    const localHeading = cleanWhitespace(
      selectedRoot.querySelector("h1, h2")?.textContent ||
      document.querySelector("main h1, article h1, h1")?.textContent ||
      pageTitle ||
      "API Documentation"
    );

    return localHeading || pageTitle || "API Documentation";
  }

  function prependFrontMatter(title, url, markdown, extractionMode, detectedPlatform) {
    const normalizedTitle = cleanWhitespace(title).toLowerCase();
    const firstLine = markdown.split("\n").find((line) => line.trim().length > 0) || "";
    const startsWithTitleHeading = firstLine.replace(/^#+\s+/, "").trim().toLowerCase() === normalizedTitle;

    const lines = [
      "---",
      `title: ${escapeYamlString(title)}`,
      `source: ${escapeYamlString(url)}`,
      `captured_at: ${new Date().toISOString()}`,
      `extraction_mode: ${escapeYamlString(extractionMode)}`,
      `detected_platform: ${escapeYamlString(detectedPlatform)}`,
      "---",
      ""
    ];

    if (!startsWithTitleHeading) {
      lines.push(`# ${title}`, "");
    }

    return `${lines.join("\n")}\n${markdown}`.trim();
  }

  function convertNodeToMarkdown(node) {
    const context = {
      listDepth: 0
    };

    return normalizeSpacing(renderNode(node, context));
  }

  function renderNode(node, context) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();

    if (tagName === "pre") {
      const codeElement = node.querySelector("code");
      const language = extractCodeLanguage(codeElement || node);
      const codeText = (codeElement?.textContent || node.textContent || "").replace(/\n+$/, "");
      if (!codeText.trim()) {
        return "";
      }

      return `\n\n\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
    }

    if (tagName === "code") {
      if (node.closest("pre")) {
        return "";
      }

      const text = cleanWhitespace(node.textContent || "");
      return text ? `\`${text.replace(/`/g, "\\`")}\`` : "";
    }

    if (tagName === "br") {
      return "  \n";
    }

    if (tagName === "hr") {
      return "\n\n---\n\n";
    }

    const children = [...node.childNodes].map((child) => renderNode(child, context)).join("");
    const text = children.trim();

    switch (tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `\n\n${"#".repeat(Number(tagName[1]))} ${text}\n\n`;
      case "p":
        return text ? `\n\n${text}\n\n` : "";
      case "blockquote":
        return toBlockquote(text);
      case "strong":
      case "b":
        return text ? `**${text}**` : "";
      case "em":
      case "i":
        return text ? `*${text}*` : "";
      case "a":
        return formatLink(node, text);
      case "img":
        return formatImage(node);
      case "ul":
        return renderList(node, false, context);
      case "ol":
        return renderList(node, true, context);
      case "li":
        return text;
      case "table":
        return renderTable(node);
      case "thead":
      case "tbody":
      case "tfoot":
      case "tr":
      case "th":
      case "td":
      case "figure":
      case "section":
      case "article":
      case "main":
      case "div":
      case "span":
        return children;
      default:
        return children;
    }
  }

  function renderList(listNode, ordered, context) {
    const items = [...listNode.children].filter((child) => child.tagName?.toLowerCase() === "li");
    if (!items.length) {
      return "";
    }

    context.listDepth += 1;
    const indent = "  ".repeat(Math.max(0, context.listDepth - 1));
    const rendered = items.map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const itemText = normalizeListItem(renderChildren(item, context));
      return `${indent}${marker}${itemText}`;
    }).join("\n");
    context.listDepth -= 1;

    return `\n${rendered}\n\n`;
  }

  function renderChildren(node, context) {
    return [...node.childNodes].map((child) => renderNode(child, context)).join("");
  }

  function normalizeListItem(text) {
    const normalized = normalizeSpacing(text).trim();
    const lines = normalized.split("\n");
    return lines.map((line, index) => index === 0 ? line : `  ${line}`).join("\n");
  }

  function renderTable(tableNode) {
    const rows = [...tableNode.querySelectorAll("tr")]
      .map((row) => [...row.children].map((cell) => cleanWhitespace(cell.textContent || "")))
      .filter((row) => row.length > 0);

    if (!rows.length) {
      return "";
    }

    const headerRow = rows[0];
    const separator = headerRow.map(() => "---");
    const bodyRows = rows.slice(1);
    const markdownRows = [
      `| ${headerRow.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...bodyRows.map((row) => `| ${row.join(" | ")} |`)
    ];

    return `\n\n${markdownRows.join("\n")}\n\n`;
  }

  function toBlockquote(text) {
    if (!text) {
      return "";
    }

    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      return "";
    }

    return `\n\n${lines.map((line) => `> ${line}`).join("\n")}\n\n`;
  }

  function formatLink(node, text) {
    const href = node.href || node.getAttribute("href");
    if (!href) {
      return text;
    }

    const label = text || href;
    return `[${label}](${href})`;
  }

  function formatImage(node) {
    const src = node.currentSrc || node.src || node.getAttribute("src");
    if (!src) {
      return "";
    }

    const alt = escapeMarkdownText(node.getAttribute("alt") || "");
    return `![${alt}](${src})`;
  }

  function normalizeSpacing(text) {
    return text
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function cleanWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function escapeMarkdownText(text) {
    return text
      .replace(/\s+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_{}[\]])/g, "\\$1");
  }

  function escapeYamlString(text) {
    return JSON.stringify(text || "");
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "api-documentation";
  }

  function extractCodeLanguage(node) {
    const className = node.className || "";
    const match = className.match(/language-([a-z0-9+#-]+)/i) || className.match(/lang(?:uage)?-([a-z0-9+#-]+)/i);
    return match ? match[1] : "";
  }

  function findInitialCandidate() {
    const platform = detectPlatform(document);
    return pickContentRoot(document, platform) || document.querySelector("main") || document.body;
  }

  function findSelectableCandidate(target) {
    let element = target instanceof Element ? target : target?.parentElement;
    const chain = [];
    let depth = 0;

    while (element && element !== document.body && depth < 10) {
      if (isSelectableContainer(element)) {
        chain.push({
          node: element,
          score: scoreNode(element, detectPlatform(document)) + Math.max(0, 120 - depth * 12)
        });
      }

      element = element.parentElement;
      depth += 1;
    }

    if (!chain.length) {
      return null;
    }

    const preferred = chain.find((candidate) => candidate.score > 220);
    return (preferred || chain.sort((left, right) => right.score - left.score)[0]).node;
  }

  function isSelectableContainer(element) {
    const tagName = element.tagName.toLowerCase();
    if (!["article", "main", "section", "div", "fieldset"].includes(tagName)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 260 || rect.height < 120) {
      return false;
    }

    const marker = `${element.className || ""} ${element.id || ""}`.toLowerCase();
    if (markerPenalty(marker) >= 900) {
      return false;
    }

    return cleanWhitespace(element.textContent || "").length > 120;
  }

  function looksLikeNavigation(element) {
    const text = cleanWhitespace(element.textContent || "");
    const marker = `${element.className || ""} ${element.id || ""}`.toLowerCase();
    const linkCount = element.querySelectorAll("a").length;
    const linkTextLength = [...element.querySelectorAll("a")]
      .reduce((sum, anchor) => sum + cleanWhitespace(anchor.textContent || "").length, 0);
    const linkDensity = text.length ? linkTextLength / text.length : 0;
    const navSignals = countKeywordHits(`${marker} ${text.slice(0, 400)}`, NAV_KEYWORDS);
    const apiSignals = countKeywordHits(text, API_KEYWORDS) + countMatches(text, /\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g);

    return linkDensity > 0.55 || (navSignals >= 2 && apiSignals === 0) || (linkCount > 20 && apiSignals < 2);
  }

  function describeNode(node) {
    const parts = [node.tagName.toLowerCase()];
    if (node.id) {
      parts.push(`#${node.id}`);
    }

    const className = cleanWhitespace(node.className || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((name) => `.${name}`);

    return `Selected ${parts.join("")}${className.join("")}`;
  }

  function toMessage(error) {
    return error instanceof Error ? error.message : String(error || "Unknown error");
  }
})();
