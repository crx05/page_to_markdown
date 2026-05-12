(function initFieldPathUtils(root) {
  const HEADER_ROLE_PATTERNS = [
    {
      role: "name",
      patterns: [
        /^name$/,
        /^field$/,
        /^fields$/,
        /^parameter$/,
        /^parameters$/,
        /^param$/,
        /^property$/,
        /^properties$/,
        /字段/,
        /参数/,
        /属性/,
        /名称/
      ]
    },
    {
      role: "type",
      patterns: [
        /^type$/,
        /^types$/,
        /^schema$/,
        /^data type$/,
        /^datatype$/,
        /^format$/,
        /类型/,
        /数据类型/,
        /格式/
      ]
    },
    {
      role: "required",
      patterns: [
        /^required$/,
        /^mandatory$/,
        /^must$/,
        /^necessity$/,
        /必填/,
        /是否必填/,
        /是否必须/
      ]
    },
    {
      role: "description",
      patterns: [
        /^description$/,
        /^desc$/,
        /^details$/,
        /^detail$/,
        /^comment$/,
        /^notes?$/,
        /^summary$/,
        /描述/,
        /说明/,
        /备注/
      ]
    },
    {
      role: "example",
      patterns: [
        /^example$/,
        /^examples$/,
        /示例/,
        /样例/
      ]
    }
  ];

  const STRONG_DEPTH_SOURCES = new Set(["attr", "style", "dom", "tree"]);

  const api = {
    detectFieldTable,
    normalizeFieldRows,
    normalizeFieldLabel,
    extractLeadingDotDepth,
    looksLikeExplicitPath,
    splitPathSegments,
    joinPathSegments,
    looksLikeArrayType
  };

  root.PageToMarkdownFieldPathUtils = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function detectFieldTable(headerCells, sampleRows = []) {
    const roles = {};

    headerCells.forEach((header, index) => {
      const role = classifyHeaderRole(header);
      if (role && !Number.isInteger(roles[role])) {
        roles[role] = index;
      }
    });

    const extraSignalCount = ["type", "required", "description", "example"]
      .filter((role) => Number.isInteger(roles[role]))
      .length;

    const looksLikeFieldRows = Number.isInteger(roles.name) &&
      sampleRows.some((row) => looksLikeFieldIdentifier(row[roles.name] || ""));

    const isFieldTable = Number.isInteger(roles.name) && (extraSignalCount >= 1 || looksLikeFieldRows);

    return {
      isFieldTable,
      nameIndex: Number.isInteger(roles.name) ? roles.name : -1,
      typeIndex: Number.isInteger(roles.type) ? roles.type : -1,
      requiredIndex: Number.isInteger(roles.required) ? roles.required : -1,
      descriptionIndex: Number.isInteger(roles.description) ? roles.description : -1,
      exampleIndex: Number.isInteger(roles.example) ? roles.example : -1
    };
  }

  function normalizeFieldRows(rows) {
    const normalized = [];
    const stack = [];
    let previousDepth = 0;

    for (const row of rows) {
      const preparedName = normalizeFieldLabel(row?.name || "");
      const rawDepth = Number.isFinite(row?.depth) ? Math.max(0, Math.trunc(row.depth)) : null;
      const explicitDepth = preparedName.explicitDepth;
      let depth = rawDepth ?? explicitDepth ?? 0;

      if (!normalized.length) {
        depth = 0;
      } else {
        depth = Math.min(depth, previousDepth + 1, stack.length);
      }

      const segment = applyArrayMarker(preparedName.label, row);
      const preserveExplicitPath = Boolean(
        depth === 0 &&
        !STRONG_DEPTH_SOURCES.has(row?.depthSource || "") &&
        looksLikeExplicitPath(segment)
      );

      const segments = preserveExplicitPath
        ? applyArrayMarkerToPath(splitPathSegments(segment), row)
        : stack.slice(0, depth).concat(segment);

      stack.length = 0;
      stack.push(...segments);
      previousDepth = preserveExplicitPath ? Math.max(0, segments.length - 1) : depth;

      normalized.push({
        ...row,
        depth,
        path: joinPathSegments(segments),
        segment,
        explicitDepth
      });
    }

    return normalized;
  }

  function normalizeFieldLabel(text) {
    let label = cleanWhitespace(text);
    let explicitDepth = 0;

    label = label
      .replace(/^[\u251c\u2514\u2502\u2500\s]+/, "")
      .replace(/^[\-*•]+\s*/, "")
      .replace(/\(\s*required\s*\)$/i, "")
      .replace(/（\s*必填\s*）$/u, "")
      .replace(/^\*+\s*/, "")
      .replace(/\s*\*+$/, "")
      .replace(/[:：]$/, "");

    const dotMatch = label.match(/^(\.+)\s*/);
    if (dotMatch) {
      explicitDepth = dotMatch[1].length;
      label = label.slice(dotMatch[0].length);
    }

    label = label.replace(/\[\s*\]/g, "[]");

    return {
      label: cleanWhitespace(label),
      explicitDepth
    };
  }

  function extractLeadingDotDepth(text) {
    return normalizeFieldLabel(text).explicitDepth;
  }

  function looksLikeExplicitPath(text) {
    const normalized = cleanWhitespace(text).replace(/\[\s*\]/g, "[]");
    return /^[A-Za-z0-9_\-$]+(?:\[\])?(?:\.[A-Za-z0-9_\-$]+(?:\[\])?)+$/.test(normalized);
  }

  function splitPathSegments(text) {
    return cleanWhitespace(text)
      .replace(/\[\s*\]/g, "[]")
      .split(".")
      .map((segment) => cleanWhitespace(segment))
      .filter(Boolean);
  }

  function joinPathSegments(segments) {
    return segments.filter(Boolean).join(".");
  }

  function looksLikeArrayType(text) {
    const value = cleanWhitespace(text).toLowerCase();
    if (!value) {
      return false;
    }

    return (
      /\barray\b/.test(value) ||
      /\blist\b/.test(value) ||
      /\bslice\b/.test(value) ||
      /\bset\b/.test(value) ||
      /\[\]$/.test(value) ||
      /^\[\s*[^\]]+\s*\]$/.test(value) ||
      /^array\s*</.test(value)
    );
  }

  function classifyHeaderRole(text) {
    const normalized = cleanWhitespace(text).toLowerCase();
    if (!normalized) {
      return "";
    }

    for (const entry of HEADER_ROLE_PATTERNS) {
      if (entry.patterns.some((pattern) => pattern.test(normalized))) {
        return entry.role;
      }
    }

    return "";
  }

  function looksLikeFieldIdentifier(text) {
    const prepared = normalizeFieldLabel(text).label;
    if (!prepared) {
      return false;
    }

    if (/^[A-Za-z0-9_.[\]-]{1,64}$/.test(prepared)) {
      return true;
    }

    return /[\u4e00-\u9fff]/u.test(prepared) && prepared.length <= 24;
  }

  function applyArrayMarker(segment, row) {
    const normalized = cleanWhitespace(segment).replace(/\[\s*\]/g, "[]");
    if (!normalized || normalized.includes("[]")) {
      return normalized;
    }

    const combined = [
      row?.type || "",
      row?.description || "",
      row?.required || ""
    ].join(" ");

    return looksLikeArrayType(combined) ? `${normalized}[]` : normalized;
  }

  function applyArrayMarkerToPath(segments, row) {
    if (!segments.length || !looksLikeArrayType(row?.type || "")) {
      return segments;
    }

    const nextSegments = segments.slice();
    const lastIndex = nextSegments.length - 1;
    if (!nextSegments[lastIndex].includes("[]")) {
      nextSegments[lastIndex] = `${nextSegments[lastIndex]}[]`;
    }
    return nextSegments;
  }

  function cleanWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
})(typeof globalThis === "object" ? globalThis : this);
