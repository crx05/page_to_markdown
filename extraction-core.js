(function initExtractionCore(root) {
  const api = {
    scoreCandidateMetrics,
    classifyConfidence,
    sanitizeSourceUrl,
    readFieldNameValue,
    findExplicitFieldNameElement
  };

  root.PageToMarkdownExtractionCore = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function scoreCandidateMetrics(metrics) {
    const contentUnits = Math.max(1, metrics.textLength / 1000);
    const apiDensity = (
      metrics.methodCount +
      metrics.pathCount +
      metrics.keywordCount +
      metrics.codeLikeBlockCount
    ) / contentUnits;

    let score =
      Math.min(metrics.textLength, 16000) * 0.035 +
      Math.min(metrics.paragraphCount, 40) * 22 +
      Math.min(metrics.headingCount, 30) * 42 +
      Math.min(metrics.preCount, 30) * 75 +
      Math.min(metrics.codeCount, 80) * 12 +
      Math.min(metrics.tableCount, 20) * 65 +
      Math.min(apiDensity, 40) * 35 +
      Math.min(metrics.methodCount, 30) * 32 +
      Math.min(metrics.pathCount, 30) * 28;

    score -= metrics.linkDensity * 1500;
    score -= Math.min(metrics.linkCount, 100) * 6;
    score -= Math.min(metrics.listCount, 80) * 10;
    score -= Math.min(metrics.buttonCount, 50) * 35;
    score -= Math.min(metrics.navKeywordCount, 10) * 220;
    score -= metrics.markerPenalty;

    if (metrics.adapterMatched) {
      score += 700;
    }
    return score;
  }

  function classifyConfidence({ score, runnerUpScore, adapterMatched }) {
    const gapRatio = Number.isFinite(runnerUpScore) && runnerUpScore > 0 ? score / runnerUpScore : 2;
    if (adapterMatched || (score >= 700 && gapRatio >= 1.2)) {
      return "high";
    }
    return score >= 320 ? "medium" : "low";
  }

  function sanitizeSourceUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      const sensitiveNames = /^(?:token|access_token|api_key|key|signature|sig|auth)$/i;
      for (const name of [...url.searchParams.keys()]) {
        if (sensitiveNames.test(name)) {
          url.searchParams.set(name, "REDACTED");
        }
      }
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  function readFieldNameValue(element) {
    return cleanWhitespace(
      element?.getAttribute?.("data-field-path") ||
      element?.getAttribute?.("data-path") ||
      element?.getAttribute?.("data-property-name") ||
      element?.getAttribute?.("data-field-name") ||
      element?.textContent ||
      ""
    );
  }

  function findExplicitFieldNameElement(nameCell, fieldPathUtils) {
    if (!nameCell || !fieldPathUtils?.looksLikeExplicitPath) {
      return null;
    }
    const selectors = [
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
    const candidates = [nameCell, ...nameCell.querySelectorAll(selectors.join(","))];
    return candidates.find((candidate) => {
      const value = readFieldNameValue(candidate);
      const label = fieldPathUtils.normalizeFieldLabel?.(value)?.label || value;
      return fieldPathUtils.looksLikeExplicitPath(label);
    }) || null;
  }

  function cleanWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
})(typeof globalThis === "object" ? globalThis : this);
