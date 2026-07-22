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

  function detectMixedMode(rows) {
    let hasExplicitPath = false;
    let hasRelativeDepth = false;

    for (const row of rows) {
      const preparedName = normalizeFieldLabel(row?.name || "");
      if (looksLikeExplicitPath(preparedName.label)) {
        hasExplicitPath = true;
      }
      if (STRONG_DEPTH_SOURCES.has(row?.depthSource)) {
        hasRelativeDepth = true;
      }
      if (hasExplicitPath && hasRelativeDepth) {
        break;
      }
    }

    return { hasExplicitPath, hasRelativeDepth, isMixed: hasExplicitPath && hasRelativeDepth };
  }

  function normalizeFieldRows(rows) {
    const normalized = [];
    const stack = [];
    const knownArrayPaths = new Set();
    let previousDepth = 0;
    let lastNonTreeDepth = 0;  // 最近的无连字符节点的深度
    let previousExplicitDepth = 0;  // 上一个节点的 explicitDepth
    const modeInfo = detectMixedMode(rows);

    for (const row of rows) {
      const preparedName = normalizeFieldLabel(row?.name || "");
      const rawDepth = Number.isFinite(row?.depth) ? Math.max(0, Math.trunc(row.depth)) : null;
      const explicitDepth = preparedName.explicitDepth;
      let depth = rawDepth ?? explicitDepth ?? 0;

      const segment = applyArrayMarker(preparedName.label, row);
      // aaa.bbb 是文档作者明确给出的绝对路径。视觉缩进、aria-level
      // 和 data-depth 只用于单段字段，否则会错误生成 aaa.aaa.bbb。
      const preserveExplicitPath = looksLikeExplicitPath(segment);

      if (preserveExplicitPath) {
        let segments = applyKnownArrayMarkers(splitPathSegments(segment), knownArrayPaths);
        segments = applyArrayMarkerToPath(segments, row);
        rememberArrayPaths(segments, knownArrayPaths);
        stack.length = 0;
        stack.push(...segments);
        previousDepth = Math.max(0, segments.length - 1);

        normalized.push({
          ...row,
          depth: previousDepth,
          path: joinPathSegments(segments),
          segment: segments[segments.length - 1],
          explicitDepth
        });
      } else {
        // 深度钳位逻辑改进
        if (!normalized.length) {
          // 第一行保持原始深度，不强制归零
          // 如果 depth > 0，后续会用占位符填充缺失的父级
        } else if (STRONG_DEPTH_SOURCES.has(row?.depthSource || "")) {
          // 强信号源（attr/style/text）：信任深度值，不钳位
        } else if (explicitDepth > 0) {
          // 判断深度类型
          const depthType = preparedName.depthType;

          if (depthType === 'dot') {
            // 前导点：绝对深度（保持原值，会生成占位符）
            depth = explicitDepth;
          } else if (depthType === 'tree') {
            // 树形字符/连字符：相对深度（基于上下文判断）
            if (previousExplicitDepth > 0 && explicitDepth > previousExplicitDepth) {
              // 连字符数量增加：累积（基于上一个深度+1）
              depth = previousDepth + 1;
            } else if (previousExplicitDepth > 0 && explicitDepth === previousExplicitDepth) {
              // 连字符数量相同：同级（与上一个相同深度）
              depth = previousDepth;
            } else {
              // 连字符数量减少或第一个连字符：基于基准深度
              depth = lastNonTreeDepth + 1;
            }
          } else {
            // 其他情况：使用绝对深度
            depth = explicitDepth;
          }
        } else {
          // 弱信号（none）：改进处理
          const maxAllowedJump = 3;
          const proposedJump = depth - previousDepth;

          if (proposedJump <= maxAllowedJump && proposedJump >= 0) {
            // 合理跳跃：保持原深度
          } else if (proposedJump < 0) {
            // 深度回退：允许（返回上层）
          } else {
            // 跳跃过大且无强信号：尝试推断
            // 检查是否可能是数组子项（看 type 字段）
            const likelyArrayChild = previousDepth > 0 &&
              normalized.length > 0 &&
              looksLikeArrayType(normalized[normalized.length - 1]?.type || "");

            if (likelyArrayChild) {
              // 数组子项：继承父级深度 + 1
              depth = previousDepth + 1;
            } else {
              // 其他情况：钳位到最大跳跃
              depth = previousDepth + maxAllowedJump;
            }
          }
        }

        // 相对深度模式：构建路径
        const parentSegments = stack.slice(0, depth);
        const missingLevels = Math.max(0, depth - parentSegments.length);
        const placeholders = missingLevels > 0 ? Array(missingLevels).fill("?") : [];
        const segments = [...parentSegments, ...placeholders, segment];
        rememberArrayPaths(segments, knownArrayPaths);

        stack.length = 0;
        stack.push(...segments);
        previousDepth = depth;

        // 更新基准深度和前一个 explicitDepth
        if (explicitDepth === 0) {
          lastNonTreeDepth = depth;
        }
        previousExplicitDepth = explicitDepth;

        normalized.push({
          ...row,
          depth,
          path: joinPathSegments(segments),
          segment,
          explicitDepth
        });
      }
    }

    return normalized;
  }

  function normalizeFieldLabel(text) {
    // 先处理原始文本以保留前导空格信息
    const rawText = String(text || "");
    let explicitDepth = 0;
    let treeDepth = 0;

    // 提取树形字符深度（改进版）
    // 先统计前导的空格、树形字符、连字符等
    let offset = 0;
    let spaceCount = 0;
    let boxCount = 0;
    let dashCount = 0;

    for (let i = 0; i < rawText.length; i++) {
      const char = rawText[i];
      if (char === ' ') {
        spaceCount++;
      } else if (char === '├' || char === '└') {
        boxCount++;
      } else if (char === '│' || char === '─' || char === '-') {
        dashCount++;
      } else if (char === '*' || char === '•') {
        dashCount++;  // 把项目符号也算作层级标记
      } else {
        offset = i;
        break;
      }
    }

    // 计算深度：
    // 1. 如果有 ├/└ 字符：使用其数量
    // 2. 如果有连字符：每 2 个连字符算一层相对深度
    //    这样 "--" = 1层, "----" = 2层（相对于最近的无连字符节点）
    // 3. 如果有空格（且没有树形字符）：每 3-4 个空格算一层
    if (boxCount > 0) {
      treeDepth = boxCount;
      // 如果还有前导空格，空格可能表示额外的缩进层级
      if (spaceCount >= 3) {
        treeDepth += Math.floor(spaceCount / 3);
      }
    } else if (dashCount > 0) {
      // 连字符：每个连字符代表一层深度
      // "-" = 1, "--" = 2, "---" = 3, "----" = 4
      treeDepth = dashCount;
    }

    // 移除前导的树形字符并清理空格
    let label = offset > 0 ? rawText.slice(offset) : rawText;
    label = cleanWhitespace(label);

    // 移除其他装饰符
    label = label
      .replace(/(\s*required\s*)$/i, "")
      .replace(/（\s*必填\s*）$/u, "")
      .replace(/^\*+\s*/, "")
      .replace(/\s*\*+$/, "")
      .replace(/[:：]$/, "");

    // 提取前导点深度（原有逻辑）
    const dotMatch = label.match(/^(\.+)\s*/);
    if (dotMatch) {
      explicitDepth = dotMatch[1].length;
      label = label.slice(dotMatch[0].length);
    }

    label = label.replace(/\[\s*\]/g, "[]");

    // 区分深度类型：
    // - 'dot': 前导点（绝对深度）
    // - 'tree': 树形字符/连字符（相对深度）
    // - 'none': 无深度标记
    let depthType = 'none';
    let finalDepth = 0;

    if (explicitDepth > 0 && treeDepth > 0) {
      // 同时存在：取最大值，优先使用前导点类型
      finalDepth = Math.max(explicitDepth, treeDepth);
      depthType = 'dot';
    } else if (explicitDepth > 0) {
      finalDepth = explicitDepth;
      depthType = 'dot';
    } else if (treeDepth > 0) {
      finalDepth = treeDepth;
      depthType = 'tree';
    }

    return {
      label: cleanWhitespace(label),
      explicitDepth: finalDepth,
      depthType
    };
  }

  function extractLeadingDotDepth(text) {
    return normalizeFieldLabel(text).explicitDepth;
  }

  function looksLikeExplicitPath(text) {
    const normalized = cleanWhitespace(text).replace(/\[\s*\]/g, "[]");

    // 至少包含一个点分隔符
    if (!normalized.includes(".")) {
      return false;
    }

    // 更严格的字符集：不允许空格，避免误判普通字段名
    // \w 包含 [A-Za-z0-9_]，一-鿿 是常用中文范围，぀-ヿ 是日文假名
    // 支持：字母数字、下划线、连字符、美元符、Unicode字符（中文、日文）、数组索引
    const strictPattern = /^[\w\-$一-鿿぀-ヿ]+(?:\[\d*\])*(?:\.[\w\-$一-鿿぀-ヿ]+(?:\[\d*\])*)+$/;

    return strictPattern.test(normalized);
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
      /\[\]/.test(value) ||  // 修改：匹配任意位置的 []，包括开头和结尾
      /^\[\s*[^\]]+\s*\]$/.test(value) ||
      /^array\s*</.test(value)
    );
  }

  function classifyHeaderRole(text) {
    const normalized = normalizeHeaderLabel(text);
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

  function normalizeHeaderLabel(text) {
    return cleanWhitespace(text)
      .toLowerCase()
      .replace(/\s*(?:expand|collapse)(?:\s+all)?$/i, "")
      .replace(/(?:\u5c55\u5f00|\u6536\u8d77|\u6298\u53e0)(?:\u5168\u90e8)?$/u, "")
      .trim();
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

  function applyKnownArrayMarkers(segments, knownArrayPaths) {
    const nextSegments = [];
    const plainPrefix = [];

    for (const originalSegment of segments) {
      const segment = cleanWhitespace(originalSegment).replace(/\[\s*\]/g, "[]");
      plainPrefix.push(stripArrayNotation(segment));
      const pathKey = plainPrefix.join(".");
      const alreadyIndexed = /\[\d*\]/.test(segment);
      nextSegments.push(knownArrayPaths.has(pathKey) && !alreadyIndexed ? `${segment}[]` : segment);
    }

    return nextSegments;
  }

  function rememberArrayPaths(segments, knownArrayPaths) {
    const plainPrefix = [];
    for (const segment of segments) {
      plainPrefix.push(stripArrayNotation(segment));
      if (/\[\d*\]/.test(segment)) {
        knownArrayPaths.add(plainPrefix.join("."));
      }
    }
  }

  function stripArrayNotation(segment) {
    return cleanWhitespace(segment).replace(/\[\d*\]/g, "");
  }

  function cleanWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
})(typeof globalThis === "object" ? globalThis : this);
