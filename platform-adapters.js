(function initPlatformAdapters(root) {
  const adapters = [
    createAdapter({
      id: "temu",
      label: "Temu Partner",
      detect(doc) {
        return hostnameMatches(doc, "temu.com") || Boolean(doc.querySelector("[class*='Documentation_tableTree__']"));
      },
      rootSelectors: ["#documentation-content-container", "[class*='Documentation_content__']"],
      noiseSelectors: ["[class*='Documentation_menu__']", "[class*='Documentation_anchorContainer__']", "[class*='Documentation_search__']"],
      structuredBlockSelectors: ["[class*='Documentation_tableTree__']"],
      expandSelectors: ["[class*='Documentation_tableTree__'] thead a"],
      resolveFieldDepth: resolveTemuFieldDepth,
      isExpansionControl: isTemuExpansionControl,
      isExpanded: isTemuExpanded
    }),
    createAdapter({
      id: "tiktok-shop",
      label: "TikTok Shop Partner",
      detect(doc) {
        return hostnameMatches(doc, "tiktokshop.com") || Boolean(doc.querySelector("[class*='table-body-td-dash']"));
      },
      rootSelectors: ["#scrollIntersectionContainer", "#doc_scroll_container", "[class*='markdown-container']"],
      noiseSelectors: ["[class*='side-menu']", "[class*='navigation']", "[class*='anchor-container']"],
      structuredBlockSelectors: ["[class*='table-scroll-container']", "[class*='markdown-table']"],
      expandSelectors: ["[class*='table-body-td-svg-outer']"],
      resolveFieldDepth: resolveTikTokFieldDepth,
      isExpansionControl: isTikTokExpansionControl,
      isExpanded: isTikTokExpanded
    }),
    createAdapter({
      id: "swagger-ui",
      label: "Swagger UI",
      detectSelectors: [".swagger-ui"],
      rootSelectors: [".swagger-ui .swagger-container", ".swagger-ui .wrapper", ".swagger-ui"],
      noiseSelectors: [".topbar", ".scheme-container .download-url-wrapper"],
      structuredBlockSelectors: [".model-box", ".model-container", "[class*='model-box']", "[class*='model-container']", "[class*='schema']"],
      expandSelectors: [".opblock:not(.is-open) .opblock-summary", ".model-box-control[aria-expanded='false']", "button.models-control[aria-expanded='false']"]
    }),
    createAdapter({
      id: "redoc",
      label: "Redoc",
      detect(doc) {
        return Boolean(
          doc.querySelector("redoc, #redoc-container") ||
          (doc.querySelector("[class*='menu-content']") && doc.querySelector("[class*='api-content']"))
        );
      },
      rootSelectors: ["[class*='api-content']", "#redoc-container main", "redoc main", "redoc"],
      noiseSelectors: ["[class*='menu-content']", "[class*='search-box']", "[class*='side-menu']"],
      structuredBlockSelectors: ["[class*='schema']", "[class*='model']"],
      expandSelectors: ["[class*='api-content'] button[aria-expanded='false']", "redoc button[aria-expanded='false']"]
    }),
    createAdapter({
      id: "apifox",
      label: "Apifox",
      detectSelectors: [".apifox-app", "[class*='apifox']"],
      rootSelectors: ["[class*='api-detail']", "[class*='doc-content']", "[class*='main-content']", ".apifox-app main"],
      noiseSelectors: ["[class*='sidebar']", "[class*='catalog']", "[class*='navigation']"],
      structuredBlockSelectors: [".schema-item", "[class*='param']", "[class*='schema']"],
      expandSelectors: ["[class*='api-detail'] [aria-expanded='false']", "[class*='schema'] [aria-expanded='false']"]
    }),
    createAdapter({
      id: "yapi",
      label: "YApi",
      detectSelectors: ["[class*='yapi']", ".yapi-container"],
      rootSelectors: [".yapi-container main", "[class*='interface-content']", "[class*='project-interface']", ".yapi-container"],
      noiseSelectors: ["[class*='sidebar']", "[class*='menu']", "[class*='breadcrumb']"],
      structuredBlockSelectors: [".schema-table", ".param-box", "[class*='param']"],
      expandSelectors: ["[class*='interface'] [aria-expanded='false']", "[class*='schema'] [aria-expanded='false']"]
    }),
    createAdapter({
      id: "postman",
      label: "Postman Docs",
      detectSelectors: ["[class*='postman']", ".postman-docs"],
      rootSelectors: [".postman-docs", "[class*='documentation-content']", "[class*='api-documentation']", "main"],
      noiseSelectors: ["[class*='sidebar']", "[class*='navigation']", "[class*='search']"],
      structuredBlockSelectors: [".schema-body", "[class*='property']", "[class*='schema']"],
      expandSelectors: ["[class*='documentation'] [aria-expanded='false']", "[class*='schema'] [aria-expanded='false']"]
    })
  ];

  const genericAdapter = createAdapter({
    id: "unknown",
    label: "Generic",
    rootSelectors: [],
    noiseSelectors: [],
    structuredBlockSelectors: ["[class*='schema']", "[class*='model']", "[class*='property-list']", "[class*='field-list']", "[class*='param']"],
    expandSelectors: []
  });

  const api = {
    adapters,
    genericAdapter,
    detect,
    getById
  };

  root.PageToMarkdownPlatformAdapters = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function createAdapter(config) {
    return Object.freeze({
      id: config.id,
      label: config.label,
      detect: config.detect || ((doc) => config.detectSelectors?.some((selector) => doc.querySelector(selector))),
      rootSelectors: Object.freeze([...(config.rootSelectors || [])]),
      noiseSelectors: Object.freeze([...(config.noiseSelectors || [])]),
      structuredBlockSelectors: Object.freeze([...(config.structuredBlockSelectors || [])]),
      expandSelectors: Object.freeze([...(config.expandSelectors || [])]),
      resolveFieldDepth: typeof config.resolveFieldDepth === "function" ? config.resolveFieldDepth : null,
      isExpansionControl: typeof config.isExpansionControl === "function" ? config.isExpansionControl : null,
      isExpanded: typeof config.isExpanded === "function" ? config.isExpanded : null
    });
  }

  function resolveTemuFieldDepth(context) {
    const rowNode = context?.rowNode;
    const nameCell = context?.nameCell;
    if (!isElement(rowNode) || !isElement(nameCell) || !rowNode.closest("table[class*='Documentation_tableTree__']")) {
      return null;
    }

    const paddingLeft = findTemuPaddingLeft(nameCell, context?.subjectNode);
    if (Number.isFinite(paddingLeft)) {
      return {
        depth: paddingLeft <= 0 ? 0 : Math.max(0, Math.round((paddingLeft - 24) / 16)),
        source: "dom"
      };
    }

    const lineOffsets = [...nameCell.querySelectorAll(
      "[class*='Documentation_horizontalLine__'], [class*='Documentation_ancestorLine__']"
    )]
      .map((element) => parsePx(element.style?.left))
      .filter(Number.isFinite);

    if (!lineOffsets.length) {
      return null;
    }

    return {
      depth: Math.max(0, Math.round((Math.max(...lineOffsets) - 22) / 16)),
      source: "dom"
    };
  }

  function findTemuPaddingLeft(nameCell, subjectNode) {
    const candidates = new Set();
    let current = isElement(subjectNode) ? subjectNode : null;

    while (current && current !== nameCell) {
      candidates.add(current);
      current = current.parentElement;
    }

    for (const candidate of nameCell.querySelectorAll("[style]")) {
      candidates.add(candidate);
    }

    const values = [...candidates]
      .filter((candidate) => candidate.style?.paddingLeft !== "")
      .map((candidate) => parsePx(candidate.style.paddingLeft))
      .filter(Number.isFinite);

    return values.length ? Math.max(...values) : null;
  }

  function resolveTikTokFieldDepth(context) {
    const rowNode = context?.rowNode;
    const nameCell = context?.nameCell;
    if (
      !isElement(rowNode) ||
      !isElement(nameCell) ||
      !classNameIncludes(rowNode, "table-body-tr") ||
      !nameCell.querySelector("[class*='table-body-td-cell']")
    ) {
      return null;
    }

    return {
      depth: nameCell.querySelectorAll("[class*='table-body-td-dash']").length,
      source: "dom"
    };
  }

  function isTemuExpansionControl(control) {
    if (!isElement(control) || control.tagName.toLowerCase() !== "a" || !control.closest("table[class*='Documentation_tableTree__']")) {
      return false;
    }

    return /^(?:expand(?: all)?|collapse(?: all)?|show all|hide all|\u5c55\u5f00(?:\u5168\u90e8)?|\u6536\u8d77(?:\u5168\u90e8)?|\u6298\u53e0(?:\u5168\u90e8)?)$/i.test(cleanText(control.textContent));
  }

  function isTemuExpanded(control) {
    if (!isTemuExpansionControl(control)) {
      return null;
    }

    return /^(?:collapse(?: all)?|hide all|\u6536\u8d77(?:\u5168\u90e8)?|\u6298\u53e0(?:\u5168\u90e8)?)$/i.test(cleanText(control.textContent));
  }

  function isTikTokExpansionControl(control) {
    return isElement(control) &&
      classNameIncludes(control, "table-body-td-svg-outer") &&
      Boolean(control.closest("tr[class*='table-body-tr']"));
  }

  function isTikTokExpanded(control) {
    if (!isTikTokExpansionControl(control)) {
      return null;
    }

    const rowNode = control.closest("tr[class*='table-body-tr']");
    const nextRow = rowNode?.nextElementSibling;
    if (!isElement(nextRow) || !classNameIncludes(nextRow, "table-body-tr")) {
      return false;
    }

    return countTikTokDepth(nextRow) > countTikTokDepth(rowNode);
  }

  function countTikTokDepth(rowNode) {
    const nameCell = rowNode.querySelector("td:first-child");
    return nameCell?.querySelectorAll("[class*='table-body-td-dash']").length || 0;
  }

  function hostnameMatches(doc, suffix) {
    try {
      const hostname = String(doc?.location?.hostname || "").toLowerCase();
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    } catch {
      return false;
    }
  }

  function classNameIncludes(element, fragment) {
    return String(element?.className || "").includes(fragment);
  }

  function isElement(value) {
    return Boolean(value && value.nodeType === 1 && typeof value.querySelector === "function");
  }

  function parsePx(value) {
    const parsed = Number.parseFloat(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function detect(doc) {
    return adapters.find((adapter) => {
      try {
        return adapter.detect(doc);
      } catch {
        return false;
      }
    }) || genericAdapter;
  }

  function getById(id) {
    return adapters.find((adapter) => adapter.id === id) || genericAdapter;
  }
})(typeof globalThis === "object" ? globalThis : this);
