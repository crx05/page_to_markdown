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

  const fieldPathUtils = globalThis.PageToMarkdownFieldPathUtils || null;
  const markdownConverter = globalThis.PageToMarkdownConverter || null;
  const platformAdapterRegistry = globalThis.PageToMarkdownPlatformAdapters || null;
  const extractionCore = globalThis.PageToMarkdownExtractionCore || null;
  const STRUCTURED_FIELD_ROW_SELECTORS = [
    ".property-row",
    "[class*='property-row']",
    "[class*='field-row']",
    "[class*='schema-row']",
    "[class*='param-row']",
    "[data-property-name]",
    "[data-field-name]"
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
    const overlay = overlayRoot.attachShadow({ mode: "open" });
    overlay.innerHTML = `
      <style>
        :host {
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

    const highlightBox = overlay.querySelector(".ptm-highlight");
    const toolbar = overlay.querySelector(".ptm-toolbar");
    const selectionLabel = overlay.querySelector(".ptm-selection-label");
    const confirmButton = overlay.querySelector(".ptm-confirm");
    const reselectButton = overlay.querySelector(".ptm-reselect");
    const cancelButton = overlay.querySelector(".ptm-cancel");
    const toast = overlay.querySelector(".ptm-toast");

    let hoverCandidate = null;
    let selectedNode = null;
    let lockedSelection = false;
    let toastTimer = 0;
    let pointerFrame = 0;
    let pendingPointerTarget = null;
    const manualPlatform = detectPlatform(document);

    document.addEventListener("mousemove", handlePointerMove, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    confirmButton.addEventListener("click", handleConfirmClick);
    reselectButton.addEventListener("click", handleReselectClick);
    cancelButton.addEventListener("click", handleCancelClick);

    updateHighlight(findInitialCandidate(manualPlatform));

    return cleanup;

    function handlePointerMove(event) {
      if (lockedSelection) {
        return;
      }

      pendingPointerTarget = event.target;
      if (pointerFrame) {
        return;
      }

      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0;
        const candidate = findSelectableCandidate(pendingPointerTarget, manualPlatform);
        pendingPointerTarget = null;
        updateHighlight(candidate);
      });
    }

    function handleDocumentClick(event) {
      if (event.composedPath().includes(overlayRoot)) {
        return;
      }

      if (lockedSelection) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const candidate = findSelectableCandidate(event.target, manualPlatform);
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
        const payload = await extractApiDocument({ selectedRoot: selectedNode, forceManual: true });

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
      updateHighlight(hoverCandidate || findInitialCandidate(manualPlatform));
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

      if (pointerFrame) {
        window.cancelAnimationFrame(pointerFrame);
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

  async function extractApiDocument(options = {}) {
    const detectedPlatform = detectPlatform(document);
    const expansion = await expandDocumentationSafely(
      getPlatformAdapter(detectedPlatform),
      options.selectedRoot || document
    );

    try {
      const selection = options.selectedRoot
        ? {
            node: options.selectedRoot,
            confidence: "high",
            rootReason: `manual:${describeNode(options.selectedRoot)}`,
            warnings: []
          }
        : selectContentRoot(document, detectedPlatform);
      const selectedRoot = selection.node;
      if (!selectedRoot) {
        throw new Error("Unable to locate API documentation content on this page.");
      }

      const clonedRoot = selectedRoot.cloneNode(true);
      preprocessStructuredContent(selectedRoot, clonedRoot, detectedPlatform);
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
      const warnings = [...selection.warnings, ...expansion.warnings];

      return {
        title,
        url: sanitizeSourceUrl(window.location.href),
        markdown: prependFrontMatter(title, sanitizeSourceUrl(window.location.href), markdown, extractionMode, detectedPlatform),
        filename: `${sanitizeFilename(title || "api-documentation")}.md`,
        capturedAt: new Date().toISOString(),
        extractionMode,
        detectedPlatform,
        adapterId: detectedPlatform,
        confidence: selection.confidence,
        rootReason: selection.rootReason,
        warnings,
        expandedCount: expansion.expandedCount
      };
    } finally {
      await expansion.restore();
    }
  }

  function detectPlatform(doc) {
    return platformAdapterRegistry?.detect(doc)?.id || "unknown";
  }

  function pickContentRoot(doc, detectedPlatform) {
    return selectContentRoot(doc, detectedPlatform).node;
  }

  function selectContentRoot(doc, detectedPlatform) {
    const candidates = new Set();

    for (const selector of getPlatformSelectors(detectedPlatform)) {
      for (const node of doc.querySelectorAll(selector)) {
        candidates.add(node);
      }
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
      for (const node of doc.querySelectorAll(selector)) {
        candidates.add(node);
      }
    }

    for (const node of doc.querySelectorAll("[class*='api-content'], [class*='doc-content'], [class*='documentation'], [id*='api-content'], [id*='documentation']")) {
      candidates.add(node);
    }

    const ranked = [...candidates]
      .map((node) => ({ node, score: scoreNode(node, detectedPlatform) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score);

    if (!ranked.length) {
      const bodyScore = scoreNode(doc.body, detectedPlatform);
      return {
        node: doc.body,
        confidence: "low",
        rootReason: `fallback:body:${Math.round(bodyScore)}`,
        warnings: ["Automatic extraction could not find a focused documentation root; the page body was used."]
      };
    }

    let best = ranked[0];
    const focusedChild = ranked.find((entry) =>
      entry !== best &&
      best.node.contains(entry.node) &&
      entry.score >= best.score * 0.82
    );
    if (focusedChild) {
      best = focusedChild;
    }

    const runnerUp = ranked.find((entry) => entry.node !== best.node);
    const adapterMatched = getPlatformSelectors(detectedPlatform).some((selector) => best.node.matches?.(selector));
    const confidence = extractionCore?.classifyConfidence({
      score: best.score,
      runnerUpScore: runnerUp?.score,
      adapterMatched
    }) || (adapterMatched ? "high" : "medium");
    const warnings = confidence === "low"
      ? ["The automatically selected documentation root has low confidence. Review the result or use manual selection."]
      : [];

    return {
      node: best.node,
      confidence,
      rootReason: `score:${Math.round(best.score)}:${describeNode(best.node)}`,
      warnings
    };
  }

  function getPlatformSelectors(detectedPlatform) {
    return getPlatformAdapter(detectedPlatform).rootSelectors || [];
  }

  function getPlatformAdapter(detectedPlatform) {
    return platformAdapterRegistry?.getById(detectedPlatform) || {
      id: "unknown",
      label: "Generic",
      rootSelectors: [],
      noiseSelectors: [],
      structuredBlockSelectors: [],
      expandSelectors: [],
      resolveFieldDepth: null,
      isExpansionControl: null,
      isExpanded: null
    };
  }

  async function expandDocumentationSafely(adapter, scope) {
    const warnings = [];
    const openedControls = [];
    const openedSet = new Set();
    const scrollPosition = { x: window.scrollX, y: window.scrollY };
    const startedAt = Date.now();
    const maxControls = 200;
    const maxDurationMs = 5000;
    const maxPasses = 20;

    if (!adapter.expandSelectors?.length) {
      return createExpansionResult();
    }

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (Date.now() - startedAt >= maxDurationMs || openedControls.length >= maxControls) {
        break;
      }

      const controls = collectExpansionControls(scope, adapter.expandSelectors)
        .filter((control) => !openedSet.has(control) && isSafeExpansionControl(control, adapter));
      if (!controls.length) {
        break;
      }

      for (const control of controls) {
        if (openedControls.length >= maxControls || Date.now() - startedAt >= maxDurationMs) {
          break;
        }

        openedSet.add(control);
        try {
          control.click();
          openedControls.push(control);
        } catch {
          // Detached or framework-owned controls are ignored.
        }
      }

      const remainingMs = Math.max(0, maxDurationMs - (Date.now() - startedAt));
      if (remainingMs > 0) {
        await waitForDomToSettle(scope, Math.min(300, remainingMs), remainingMs);
      }
    }

    if (openedControls.length >= maxControls) {
      warnings.push(`Expansion stopped after ${maxControls} documentation controls.`);
    }
    if (Date.now() - startedAt >= maxDurationMs) {
      warnings.push("Expansion reached the 5 second limit; currently loaded content was exported.");
    }

    return createExpansionResult();

    function createExpansionResult() {
      return {
        expandedCount: openedControls.length,
        warnings,
        async restore() {
          for (const control of openedControls.slice().reverse()) {
            if (!control.isConnected || !isCurrentlyExpanded(control, adapter)) {
              continue;
            }
            try {
              control.click();
            } catch {
              // Best-effort restoration must not fail an export.
            }
          }
          try {
            window.scrollTo(scrollPosition.x, scrollPosition.y);
          } catch {
            // Some embedded documents do not expose a scrollable window.
          }
        }
      };
    }
  }

  function collectExpansionControls(scope, selectors) {
    const controls = new Set();
    for (const selector of selectors) {
      if (scope instanceof Element && scope.matches(selector)) {
        controls.add(scope);
      }
      for (const node of scope.querySelectorAll?.(selector) || []) {
        controls.add(node);
      }
    }
    return [...controls];
  }

  function isSafeExpansionControl(control, adapter) {
    if (!(control instanceof Element) || control.closest("form")) {
      return false;
    }

    const marker = `${control.className || ""} ${control.id || ""} ${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`.toLowerCase();
    if (/(try\s*it\s*out|execute|send(?:\s+request)?|submit|login|sign\s*in|download|authorize|logout|make\s+request)/i.test(marker)) {
      return false;
    }

    const tagName = control.tagName.toLowerCase();
    const actsLikeButton = tagName === "button" || tagName === "summary" || control.getAttribute("role") === "button" || control.classList.contains("opblock-summary");
    const adapterApproved = callAdapterBoolean(adapter?.isExpansionControl, control) === true;
    return (actsLikeButton || adapterApproved) && !isCurrentlyExpanded(control, adapter);
  }

  function isCurrentlyExpanded(control, adapter) {
    const adapterState = callAdapterBoolean(adapter?.isExpanded, control);
    if (typeof adapterState === "boolean") {
      return adapterState;
    }

    const ariaExpanded = control.getAttribute("aria-expanded");
    if (ariaExpanded) {
      return ariaExpanded === "true";
    }
    const opblock = control.closest(".opblock");
    if (opblock) {
      return opblock.classList.contains("is-open");
    }
    return false;
  }

  function callAdapterBoolean(callback, control) {
    if (typeof callback !== "function") {
      return null;
    }

    try {
      const result = callback(control);
      return typeof result === "boolean" ? result : null;
    } catch {
      return null;
    }
  }

  function waitForDomToSettle(scope, quietMs, timeoutMs) {
    return new Promise((resolve) => {
      const observedRoot = scope instanceof Document ? scope.documentElement : scope;
      if (!observedRoot || typeof MutationObserver !== "function") {
        window.setTimeout(resolve, Math.min(quietMs, timeoutMs));
        return;
      }

      let quietTimer = 0;
      let timeoutTimer = 0;
      const observer = new MutationObserver(scheduleQuietFinish);

      function finish() {
        observer.disconnect();
        window.clearTimeout(quietTimer);
        window.clearTimeout(timeoutTimer);
        resolve();
      }

      function scheduleQuietFinish() {
        window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(finish, quietMs);
      }

      observer.observe(observedRoot, { childList: true, subtree: true, attributes: true });
      scheduleQuietFinish();
      timeoutTimer = window.setTimeout(finish, timeoutMs);
    });
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

    const platformSelectors = getPlatformAdapter(detectedPlatform).noiseSelectors || [];

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

    const adapter = getPlatformAdapter(detectedPlatform);
    const adapterMatched = adapter.rootSelectors.some((selector) => node.matches(selector));

    return extractionCore?.scoreCandidateMetrics({
      textLength: text.length,
      paragraphCount,
      headingCount,
      preCount,
      codeCount,
      tableCount,
      linkCount,
      listCount,
      buttonCount,
      linkDensity,
      methodCount,
      pathCount,
      keywordCount,
      navKeywordCount,
      codeLikeBlockCount,
      markerPenalty: markerPenalty(marker),
      adapterMatched
    }) ?? text.length;
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
    if (markdownConverter?.convertNodeToMarkdown) {
      return markdownConverter.convertNodeToMarkdown(node);
    }

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

  function preprocessStructuredContent(originalRoot, clonedRoot, detectedPlatform) {
    if (!fieldPathUtils) {
      return;
    }

    const adapter = getPlatformAdapter(detectedPlatform);
    annotateStructuredTables(originalRoot, clonedRoot, adapter);
    replaceStructuredFieldBlocks(originalRoot, clonedRoot, detectedPlatform);
  }

  function annotateStructuredTables(originalRoot, clonedRoot, adapter) {
    const originalTables = [...originalRoot.querySelectorAll("table")];
    const clonedTables = [...clonedRoot.querySelectorAll("table")];
    const tableCount = Math.min(originalTables.length, clonedTables.length);

    for (let index = 0; index < tableCount; index += 1) {
      const analysis = analyzeFieldTable(originalTables[index], adapter);
      if (!analysis) {
        continue;
      }

      applyFieldTableMetadata(clonedTables[index], analysis);
    }
  }

  function analyzeFieldTable(tableNode, adapter) {
    const rowNodes = getTableRows(tableNode);
    if (rowNodes.length < 2) {
      return null;
    }

    const headerTexts = getTableCells(rowNodes[0]).map((cell) => cleanWhitespace(cell.textContent || ""));
    if (!headerTexts.length) {
      return null;
    }

    const sampleRows = rowNodes
      .slice(1, 6)
      .map((rowNode) => getTableCells(rowNode).map((cell) => cleanWhitespace(cell.textContent || "")));

    const columns = fieldPathUtils.detectFieldTable(headerTexts, sampleRows);
    if (!columns.isFieldTable || columns.nameIndex < 0) {
      return null;
    }

    const rawRows = rowNodes
      .slice(1)
      .map((rowNode, rowOffset) => buildFieldTableRowRecord(rowNode, rowOffset + 1, columns, adapter))
      .filter(Boolean);

    if (!rawRows.length) {
      return null;
    }

    const indentProfile = createIndentProfile(rawRows.map((row) => row.rawIndentPx));
    const normalizedRows = fieldPathUtils.normalizeFieldRows(
      rawRows.map((row) => {
        const styleDepth = resolveStyleDepth(row.rawIndentPx, indentProfile);
        const depth = Number.isFinite(row.depth) ? row.depth : styleDepth;
        const depthSource = row.depthSource === "none" && styleDepth > 0 ? "style" : row.depthSource;

        return {
          name: row.name,
          type: row.type,
          required: row.required,
          description: row.description,
          depth,
          depthSource
        };
      })
    );

    const hasStructuredSignal = normalizedRows.some((row, index) => {
      const originalName = fieldPathUtils.normalizeFieldLabel(rawRows[index].name).label;
      return row.path !== originalName || row.path.includes(".") || row.path.includes("[]");
    });

    if (!hasStructuredSignal) {
      return null;
    }

    return {
      columns,
      rows: normalizedRows.map((row, index) => ({
        ...row,
        rowOffset: rawRows[index].rowOffset
      }))
    };
  }

  function buildFieldTableRowRecord(rowNode, rowOffset, columns, adapter) {
    const cells = getTableCells(rowNode);
    const nameCell = cells[columns.nameIndex];
    if (!nameCell) {
      return null;
    }

    const nameAnchor = findFieldNameTextElement(nameCell);
    const name = readFieldNameValue(nameAnchor || nameCell);
    if (!name) {
      return null;
    }

    const depthInfo = inspectStructuredDepth(rowNode, nameAnchor || nameCell, nameCell, adapter);

    return {
      rowOffset,
      name,
      type: readTableCellText(cells, columns.typeIndex),
      required: readTableCellText(cells, columns.requiredIndex),
      description: readTableCellText(cells, columns.descriptionIndex),
      depth: depthInfo.depth,
      depthSource: depthInfo.source,
      rawIndentPx: depthInfo.rawIndentPx
    };
  }

  function findFieldNameTextElement(nameCell) {
    const explicitFromCore = extractionCore?.findExplicitFieldNameElement(nameCell, fieldPathUtils);
    if (explicitFromCore) {
      return explicitFromCore;
    }

    const preferredSelectors = [
      "[data-field-path]",
      "[data-path]",
      "[data-property-name]",
      "[data-field-name]",
      "[class*='field-path']",
      "[class*='field-name']",
      "[class*='param-name']",
      "[class*='property-name']",
      "code"
    ];
    const candidates = [nameCell, ...nameCell.querySelectorAll(preferredSelectors.join(","))];
    const explicitPathElement = candidates.find((candidate) => {
      const value = readFieldNameValue(candidate);
      return fieldPathUtils.looksLikeExplicitPath(fieldPathUtils.normalizeFieldLabel(value).label);
    });
    return explicitPathElement || findMostIndentedTextElement(nameCell);
  }

  function readFieldNameValue(element) {
    return extractionCore?.readFieldNameValue(element) || cleanWhitespace(
      element?.getAttribute?.("data-field-path") ||
      element?.getAttribute?.("data-path") ||
      element?.getAttribute?.("data-property-name") ||
      element?.getAttribute?.("data-field-name") ||
      element?.textContent ||
      ""
    );
  }

  function applyFieldTableMetadata(tableNode, analysis) {
    tableNode.dataset.ptmFieldTable = "true";
    tableNode.dataset.ptmFieldNameIndex = String(analysis.columns.nameIndex);

    const rowNodes = getTableRows(tableNode);
    for (const row of analysis.rows) {
      const targetRow = rowNodes[row.rowOffset];
      if (targetRow) {
        targetRow.dataset.ptmFieldPath = row.path;
      }
    }
  }

  function replaceStructuredFieldBlocks(originalRoot, clonedRoot, detectedPlatform) {
    // 移除平台白名单限制，允许所有平台尝试通用schema检测
    const adapter = getPlatformAdapter(detectedPlatform);
    const originalBlocks = findStructuredFieldBlocks(originalRoot, detectedPlatform);
    if (!originalBlocks.length) {
      return;
    }

    const clonedBlocks = findStructuredFieldBlocks(clonedRoot, detectedPlatform);
    const blockCount = Math.min(originalBlocks.length, clonedBlocks.length);

    for (let index = 0; index < blockCount; index += 1) {
      const rows = extractStructuredFieldRows(originalBlocks[index], adapter);
      if (rows.length < 2) {
        continue;
      }

      const syntheticTable = buildStructuredFieldTable(clonedRoot.ownerDocument || document, rows);
      clonedBlocks[index].replaceWith(syntheticTable);
    }
  }

  function findStructuredFieldBlocks(rootNode, detectedPlatform) {
    const selectors = getPlatformAdapter(detectedPlatform).structuredBlockSelectors;

    if (!selectors.length) {
      return [];
    }

    const candidates = [...rootNode.querySelectorAll(selectors.join(","))]
      .filter((element) =>
        element.tagName.toLowerCase() !== 'table' &&  // 排除表格元素，避免与 annotateStructuredTables 重复处理
        isStructuredFieldBlockCandidate(element)
      );

    return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
  }

  function isStructuredFieldBlockCandidate(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const marker = `${element.className || ""} ${element.id || ""}`.toLowerCase();
    if (!/(schema|model|property|field|param)/.test(marker)) {
      return false;
    }

    const rows = getStructuredFieldRowCandidates(element);
    return rows.length >= 2;
  }

  function extractStructuredFieldRows(blockNode, adapter) {
    const rowNodes = getStructuredFieldRowCandidates(blockNode);
    if (rowNodes.length < 2) {
      return [];
    }

    const blockRect = blockNode.getBoundingClientRect();
    const rawRows = rowNodes.map((rowNode) => buildStructuredFieldRowRecord(rowNode, blockRect, adapter)).filter(Boolean);
    if (rawRows.length < 2) {
      return [];
    }

    const indentProfile = createIndentProfile(rawRows.map((row) => row.rawIndentPx));
    return fieldPathUtils.normalizeFieldRows(
      rawRows.map((row) => {
        const styleDepth = resolveStyleDepth(row.rawIndentPx, indentProfile);
        const depth = Number.isFinite(row.depth) ? row.depth : styleDepth;
        const depthSource = row.depthSource === "none" && styleDepth > 0 ? "style" : row.depthSource;

        return {
          name: row.name,
          type: row.type,
          required: row.required,
          description: row.description,
          depth,
          depthSource
        };
      })
    );
  }

  function buildStructuredFieldRowRecord(rowNode, blockRect, adapter) {
    const nestedRows = getNestedStructuredFieldRows(rowNode);
    const nameElement = findStructuredFieldNameElement(rowNode, nestedRows);
    const name = readFieldNameValue(nameElement);
    if (!name) {
      return null;
    }

    const depthInfo = inspectStructuredDepth(rowNode, nameElement, blockRect, adapter);
    const typeElement = findStructuredFieldTypeElement(rowNode, nameElement, nestedRows);
    const required = detectRequiredLabel(rowNode, nestedRows);
    const description = extractStructuredDescription(rowNode, {
      name,
      type: cleanWhitespace(typeElement?.textContent || ""),
      required
    }, nestedRows);

    return {
      name,
      type: cleanWhitespace(typeElement?.textContent || ""),
      required,
      description,
      depth: depthInfo.depth,
      depthSource: depthInfo.source,
      rawIndentPx: depthInfo.rawIndentPx
    };
  }

  function getStructuredFieldRowCandidates(blockNode) {
    return [...blockNode.querySelectorAll(STRUCTURED_FIELD_ROW_SELECTORS.join(","))]
      .filter((element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const nameElement = findStructuredFieldNameElement(element, getNestedStructuredFieldRows(element));
        if (!nameElement) {
          return false;
        }

        return readFieldNameValue(nameElement).length > 0;
      });
  }

  function getNestedStructuredFieldRows(rowNode) {
    return [...rowNode.querySelectorAll(STRUCTURED_FIELD_ROW_SELECTORS.join(","))]
      .filter((element) => element !== rowNode);
  }

  function findStructuredFieldNameElement(rowNode, nestedRows = []) {
    const selectors = [
      "[data-field-path]",
      "[data-path]",
      ".prop-name",
      "[class*='prop-name']",
      ".property-name",
      "[class*='property-name']",
      "[data-property-name]",
      "[data-field-name]",
      "[class*='field-name']",
      "[class*='param-name']",
      "code"
    ];

    return findFirstTextfulElement(rowNode, selectors, null, nestedRows);
  }

  function findStructuredFieldTypeElement(rowNode, nameElement, nestedRows = []) {
    const selectors = [
      ".prop-type",
      "[class*='prop-type']",
      ".property-type",
      "[class*='property-type']",
      "[class*='field-type']",
      "[class*='param-type']"
    ];

    return findFirstTextfulElement(rowNode, selectors, nameElement, nestedRows);
  }

  function detectRequiredLabel(rowNode, nestedRows = []) {
    const indicator = findFirstTextfulElement(rowNode, [
      "[class*='required']",
      "[aria-label*='required' i]",
      "[title*='required' i]"
    ], null, nestedRows);

    if (indicator) {
      return "required";
    }

    if (nestedRows.length) {
      return "";
    }

    const text = cleanWhitespace(rowNode.textContent || "");
    return /\brequired\b/i.test(text) || /必填/u.test(text) ? "required" : "";
  }

  function extractStructuredDescription(rowNode, parts, nestedRows = []) {
    const descriptionElement = findFirstTextfulElement(rowNode, [
      "[class*='description']",
      "[class*='desc']",
      ".markdown p",
      "p"
    ], null, nestedRows);

    if (descriptionElement) {
      return cleanWhitespace(descriptionElement.textContent || "");
    }

    if (nestedRows.length) {
      return "";
    }

    let remainder = cleanWhitespace(rowNode.textContent || "");
    for (const value of [parts.name, parts.type, parts.required]) {
      if (value) {
        remainder = remainder.replace(value, "");
      }
    }

    return cleanWhitespace(remainder);
  }

  function findFirstTextfulElement(rootNode, selectors, excludedNode = null, excludedRoots = []) {
    for (const selector of selectors) {
      const candidates = rootNode.matches?.(selector)
        ? [rootNode, ...rootNode.querySelectorAll(selector)]
        : [...rootNode.querySelectorAll(selector)];

      for (const candidate of candidates) {
        if (!(candidate instanceof Element) || candidate === excludedNode || excludedNode?.contains(candidate)) {
          continue;
        }

        if (excludedRoots.some((excludedRoot) => excludedRoot === candidate || excludedRoot.contains(candidate))) {
          continue;
        }

        if (cleanWhitespace(candidate.textContent || "")) {
          return candidate;
        }
      }
    }

    return null;
  }

  function buildStructuredFieldTable(documentRef, rows) {
    const columns = [{ key: "path", label: "Field" }];

    if (rows.some((row) => row.type)) {
      columns.push({ key: "type", label: "Type" });
    }

    if (rows.some((row) => row.required)) {
      columns.push({ key: "required", label: "Required" });
    }

    if (rows.some((row) => row.description)) {
      columns.push({ key: "description", label: "Description" });
    }

    const table = documentRef.createElement("table");
    const thead = documentRef.createElement("thead");
    const headerRow = documentRef.createElement("tr");

    for (const column of columns) {
      const cell = documentRef.createElement("th");
      cell.textContent = column.label;
      headerRow.appendChild(cell);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = documentRef.createElement("tbody");
    for (const row of rows) {
      const bodyRow = documentRef.createElement("tr");
      for (const column of columns) {
        const cell = documentRef.createElement("td");
        cell.textContent = column.key === "path" ? row.path : (row[column.key] || "");
        bodyRow.appendChild(cell);
      }
      tbody.appendChild(bodyRow);
    }

    table.appendChild(tbody);
    return table;
  }

  function getTableRows(tableNode) {
    const rows = [];

    if (tableNode.tHead) {
      rows.push(...tableNode.tHead.rows);
    }

    for (const body of [...tableNode.tBodies]) {
      rows.push(...body.rows);
    }

    for (const child of [...tableNode.children]) {
      if (child.tagName?.toLowerCase() === "tr") {
        rows.push(child);
      }
    }

    if (tableNode.tFoot) {
      rows.push(...tableNode.tFoot.rows);
    }

    return rows;
  }

  function getTableCells(rowNode) {
    return [...rowNode.children].filter((child) => /^(th|td)$/i.test(child.tagName || ""));
  }

  function readTableCellText(cells, index) {
    if (!Number.isInteger(index) || index < 0 || !cells[index]) {
      return "";
    }

    return cleanWhitespace(cells[index].textContent || "");
  }

  function findMostIndentedTextElement(rootNode) {
    const candidates = [rootNode, ...rootNode.querySelectorAll("*")];
    let bestNode = rootNode;
    let bestIndent = measureRelativeIndentPx(rootNode, rootNode);

    for (const candidate of candidates) {
      if (!(candidate instanceof Element) || !cleanWhitespace(candidate.textContent || "")) {
        continue;
      }

      const indent = measureRelativeIndentPx(rootNode, candidate);
      if (indent > bestIndent) {
        bestIndent = indent;
        bestNode = candidate;
      }
    }

    return bestNode;
  }

  function inspectStructuredDepth(rowNode, subjectNode, base, adapter) {
    const rawIndentPx = base instanceof DOMRect
      ? measureRectRelativeIndentPx(base, subjectNode)
      : measureRelativeIndentPx(base, subjectNode);

    const platformDepth = resolveAdapterFieldDepth(adapter, {
      rowNode,
      subjectNode,
      nameCell: base instanceof Element ? base : subjectNode?.closest?.("td") || null
    });
    if (platformDepth) {
      return {
        depth: platformDepth.depth,
        source: platformDepth.source || "dom",
        rawIndentPx
      };
    }

    const attributeDepth = findDepthAttributeValue(rowNode, subjectNode);
    if (Number.isFinite(attributeDepth)) {
      return {
        depth: attributeDepth,
        source: "attr",
        rawIndentPx
      };
    }

    const textDepth = fieldPathUtils.extractLeadingDotDepth(subjectNode?.textContent || "");
    if (textDepth > 0) {
      return {
        depth: textDepth,
        source: "text",
        rawIndentPx
      };
    }

    return {
      depth: null,
      source: "none",
      rawIndentPx
    };
  }

  function resolveAdapterFieldDepth(adapter, context) {
    if (typeof adapter?.resolveFieldDepth !== "function") {
      return null;
    }

    try {
      const result = adapter.resolveFieldDepth(context);
      if (!Number.isFinite(result?.depth)) {
        return null;
      }

      return {
        depth: Math.max(0, Math.trunc(result.depth)),
        source: result.source || "dom"
      };
    } catch {
      return null;
    }
  }

  function findDepthAttributeValue(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof Element)) {
        continue;
      }

      const queue = [node, ...node.querySelectorAll("[aria-level], [data-depth], [data-level], [data-indent]")];
      for (const candidate of queue) {
        const ariaLevel = parseInteger(candidate.getAttribute("aria-level"));
        if (Number.isFinite(ariaLevel)) {
          return Math.max(0, ariaLevel - 1);
        }

        for (const attributeName of ["data-depth", "data-level", "data-indent"]) {
          const value = parseInteger(candidate.getAttribute(attributeName));
          if (Number.isFinite(value)) {
            return Math.max(0, value);
          }
        }
      }
    }

    return null;
  }

  function createIndentProfile(rawIndents) {
    const finiteIndents = rawIndents.filter((value) => Number.isFinite(value));
    if (!finiteIndents.length) {
      return { baseline: 0, unit: 16 };
    }

    const baseline = Math.min(...finiteIndents);

    // 收集所有可能的步进值（降低阈值到 3px）
    const positiveSteps = finiteIndents
      .map((value) => Math.max(0, value - baseline))
      .filter((value) => value >= 3)  // 降低阈值 6px → 3px
      .sort((left, right) => left - right);

    // 计算最小公约数作为单位
    let unit = positiveSteps[0] || 12;  // 默认值 16px → 12px

    // 如果有多个步进值，尝试找到最大公约数
    if (positiveSteps.length > 1) {
      const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
      unit = positiveSteps.reduce((acc, val) => gcd(acc, val));

      // 如果 gcd 太小（< 3px），使用最小步进值
      if (unit < 3) {
        unit = positiveSteps[0];
      }
    }

    return {
      baseline,
      unit
    };
  }

  function resolveStyleDepth(rawIndentPx, indentProfile) {
    if (!Number.isFinite(rawIndentPx)) {
      return 0;
    }

    const normalizedIndent = Math.max(0, rawIndentPx - indentProfile.baseline);
    if (normalizedIndent < 3) {
      return 0;
    }

    return Math.max(0, Math.round(normalizedIndent / indentProfile.unit));
  }

  function measureRelativeIndentPx(baseNode, targetNode) {
    if (!(baseNode instanceof Element) || !(targetNode instanceof Element)) {
      return 0;
    }

    const baseRect = baseNode.getBoundingClientRect();
    return measureRectRelativeIndentPx(baseRect, targetNode);
  }

  function measureRectRelativeIndentPx(baseRect, targetNode) {
    if (!(targetNode instanceof Element)) {
      return 0;
    }

    const targetRect = targetNode.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(targetNode);
    const styleIndent = parsePx(computedStyle.marginLeft) +
      parsePx(computedStyle.paddingLeft) +
      Math.max(0, parsePx(computedStyle.textIndent));

    return Math.max(0, targetRect.left - baseRect.left, styleIndent);
  }

  function parsePx(value) {
    const parsed = Number.parseFloat(value || "0");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseInteger(value) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function renderTable(tableNode) {
    const fieldNameIndex = Number.parseInt(tableNode.dataset.ptmFieldNameIndex || "-1", 10);
    const rows = getTableRows(tableNode)
      .map((row) => getTableCells(row).map((cell, cellIndex) => {
        const fieldPath = row.dataset.ptmFieldPath;
        const rawText = fieldPath && cellIndex === fieldNameIndex
          ? fieldPath
          : cleanWhitespace(cell.textContent || "");

        return escapeMarkdownTableCell(rawText);
      }))
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

  function escapeMarkdownTableCell(text) {
    return cleanWhitespace(text).replace(/\|/g, "\\|");
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

  function findInitialCandidate(platform = detectPlatform(document)) {
    return pickContentRoot(document, platform) || document.querySelector("main") || document.body;
  }

  function findSelectableCandidate(target, platform = detectPlatform(document)) {
    let element = target instanceof Element ? target : target?.parentElement;
    const chain = [];
    let depth = 0;

    while (element && element !== document.body && depth < 10) {
      if (isSelectableContainer(element)) {
        chain.push({
          node: element,
          score: scoreNode(element, platform) + Math.max(0, 120 - depth * 12)
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

  function sanitizeSourceUrl(rawUrl) {
    return extractionCore?.sanitizeSourceUrl(rawUrl) || rawUrl;
  }
})();
