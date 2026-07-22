(function initPreviewRenderer(root) {
  const api = {
    stripFrontMatter,
    renderSanitizedMarkdown
  };

  root.PageToMarkdownPreviewRenderer = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function stripFrontMatter(markdown) {
    return String(markdown || "").replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  function renderSanitizedMarkdown(markdown, markedApi, purifier) {
    if (!markedApi?.parse || !purifier?.sanitize) {
      throw new Error("The local Markdown preview libraries could not be loaded.");
    }
    const rendered = markedApi.parse(stripFrontMatter(markdown), { gfm: true, breaks: false });
    return purifier.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button", "iframe", "object", "embed", "style", "script"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      KEEP_CONTENT: true
    });
  }
})(typeof globalThis === "object" ? globalThis : this);
