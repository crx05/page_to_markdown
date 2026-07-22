(function initMarkdownConverter(root) {
  const api = {
    convertNodeToMarkdown,
    inferCodeLanguage
  };

  root.PageToMarkdownConverter = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function convertNodeToMarkdown(node) {
    return normalizeMarkdownSpacing(renderNode(node, { listDepth: 0 }));
  }

  function renderNode(node, context) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return escapeMarkdownText(node.textContent || "");
    }

    if (node.nodeType !== 1) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();

    if (tagName === "pre") {
      return renderCodeBlock(node);
    }

    if (tagName === "code") {
      return node.closest?.("pre") ? "" : renderInlineCode(node.textContent || "");
    }

    if (tagName === "br") {
      return "  \n";
    }

    if (tagName === "hr") {
      return "\n\n---\n\n";
    }

    if (tagName === "img") {
      return formatImage(node);
    }

    if (tagName === "ul" || tagName === "ol") {
      return renderList(node, tagName === "ol", context);
    }

    if (tagName === "table") {
      return renderTable(node);
    }

    const children = renderChildren(node, context);
    const text = children.trim();

    switch (tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return text ? `\n\n${"#".repeat(Number(tagName[1]))} ${text}\n\n` : "";
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
      case "del":
      case "s":
      case "strike":
        return text ? `~~${text}~~` : "";
      case "a":
        return formatLink(node, text);
      case "details":
        return text ? `\n\n${text}\n\n` : "";
      case "summary":
        return text ? `\n\n**${text}**\n\n` : "";
      default:
        return children;
    }
  }

  function renderCodeBlock(node) {
    const codeElement = node.querySelector?.("code");
    const rawText = codeElement?.textContent ?? node.textContent ?? "";
    const codeText = String(rawText).replace(/\r\n?/g, "\n");

    if (!codeText.trim()) {
      return "";
    }

    const language = inferCodeLanguage(codeElement || node, codeText);
    const longestRun = longestBacktickRun(codeText);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const closingPrefix = codeText.endsWith("\n") ? "" : "\n";

    return `\n\n${fence}${language}\n${codeText}${closingPrefix}${fence}\n\n`;
  }

  function renderInlineCode(value) {
    const text = String(value || "").replace(/\s*\n\s*/g, " ");
    if (!text) {
      return "";
    }

    const fence = "`".repeat(Math.max(1, longestBacktickRun(text) + 1));
    const needsPadding = /^`|`$|^\s|\s$/.test(text);
    return needsPadding ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
  }

  function longestBacktickRun(text) {
    const runs = String(text || "").match(/`+/g) || [];
    return runs.reduce((longest, run) => Math.max(longest, run.length), 0);
  }

  function inferCodeLanguage(node, codeText = "") {
    const className = typeof node?.className === "string" ? node.className : "";
    const classMatch = className.match(/language-([a-z0-9+#-]+)/i) ||
      className.match(/lang(?:uage)?-([a-z0-9+#-]+)/i);
    if (classMatch) {
      return classMatch[1].toLowerCase();
    }

    const text = String(codeText || "").trim();
    if (!text) {
      return "";
    }

    if (/^<\?php\b/i.test(text)) {
      return "php";
    }

    if (/^curl\s+(?:-[A-Za-z]|https?:\/\/)/i.test(text)) {
      return "bash";
    }

    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        JSON.parse(text);
        return "json";
      } catch {
        // Continue with conservative language checks.
      }
    }

    if (/^(?:from\s+\S+\s+import\s+|import\s+\S+|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(text)) {
      return "python";
    }

    return "";
  }

  function renderList(listNode, ordered, context) {
    const items = [...listNode.children].filter((child) => child.tagName?.toLowerCase() === "li");
    if (!items.length) {
      return "";
    }

    const depth = context.listDepth;
    const indent = "  ".repeat(depth);
    const childContext = { ...context, listDepth: depth + 1 };
    const lines = [];

    items.forEach((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const parts = [];
      const nestedLists = [];

      for (const child of item.childNodes) {
        const childTag = child.tagName?.toLowerCase();
        if (childTag === "ul" || childTag === "ol") {
          nestedLists.push(renderNode(child, childContext).replace(/^\n+|\n+$/g, ""));
        } else {
          parts.push(renderNode(child, childContext));
        }
      }

      const itemText = normalizeListItem(parts.join(""));
      lines.push(`${indent}${marker}${itemText}`.trimEnd());
      for (const nested of nestedLists) {
        if (nested) {
          lines.push(nested);
        }
      }
    });

    return `\n${lines.join("\n")}\n\n`;
  }

  function normalizeListItem(text) {
    return String(text || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function renderTable(tableNode) {
    const fieldNameIndex = Number.parseInt(tableNode.dataset?.ptmFieldNameIndex || "-1", 10);
    const rowNodes = getTableRows(tableNode);
    const rows = rowNodes.map((row) => getTableCells(row).map((cell, cellIndex) => {
      const fieldPath = row.dataset?.ptmFieldPath;
      const rawText = fieldPath && cellIndex === fieldNameIndex
        ? fieldPath
        : cleanWhitespace(cell.textContent || "");
      return escapeMarkdownTableCell(rawText);
    })).filter((row) => row.length > 0);

    if (!rows.length) {
      return "";
    }

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => row.concat(Array(columnCount - row.length).fill("")));
    const header = normalizedRows[0];
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  }

  function getTableRows(tableNode) {
    const rows = [];
    if (tableNode.tHead) {
      rows.push(...tableNode.tHead.rows);
    }
    for (const body of [...(tableNode.tBodies || [])]) {
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

  function renderChildren(node, context) {
    return [...node.childNodes].map((child) => renderNode(child, context)).join("");
  }

  function toBlockquote(text) {
    const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.length ? `\n\n${lines.map((line) => `> ${line}`).join("\n")}\n\n` : "";
  }

  function formatLink(node, text) {
    const href = node.href || node.getAttribute?.("href");
    if (!href) {
      return text;
    }
    const destination = /[\s()]/.test(href) ? `<${href.replace(/>/g, "%3E")}>` : href;
    return `[${text || escapeMarkdownText(href)}](${destination})`;
  }

  function formatImage(node) {
    const src = node.currentSrc || node.src || node.getAttribute?.("src");
    if (!src) {
      return "";
    }
    const destination = /[\s()]/.test(src) ? `<${src.replace(/>/g, "%3E")}>` : src;
    return `![${escapeMarkdownText(node.getAttribute?.("alt") || "")}](${destination})`;
  }

  function escapeMarkdownTableCell(text) {
    return cleanWhitespace(text).replace(/\|/g, "\\|");
  }

  function escapeMarkdownText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_{}[\]])/g, "\\$1");
  }

  function cleanWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeMarkdownSpacing(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const normalized = [];
    let fenceCharacter = "";
    let fenceLength = 0;
    let blankCount = 0;

    for (const originalLine of lines) {
      const fenceMatch = originalLine.match(/^\s*(`{3,}|~{3,})/);
      if (fenceCharacter) {
        normalized.push(originalLine);
        if (fenceMatch && fenceMatch[1][0] === fenceCharacter && fenceMatch[1].length >= fenceLength) {
          fenceCharacter = "";
          fenceLength = 0;
          blankCount = 0;
        }
        continue;
      }

      if (fenceMatch) {
        fenceCharacter = fenceMatch[1][0];
        fenceLength = fenceMatch[1].length;
        normalized.push(originalLine.trimEnd());
        blankCount = 0;
        continue;
      }

      const keepsHardBreak = /[^ ]  $/.test(originalLine);
      const line = keepsHardBreak ? `${originalLine.trimEnd()}  ` : originalLine.trimEnd();
      if (!line.trim()) {
        blankCount += 1;
        if (blankCount <= 1) {
          normalized.push("");
        }
      } else {
        blankCount = 0;
        normalized.push(line);
      }
    }

    while (normalized[0] === "") {
      normalized.shift();
    }
    while (normalized[normalized.length - 1] === "") {
      normalized.pop();
    }
    return normalized.join("\n");
  }
})(typeof globalThis === "object" ? globalThis : this);
