(function initExportStorageCore(root) {
  const api = {
    exportKey,
    isValidExportId,
    estimateBytes,
    pruneExportIndex
  };

  root.PageToMarkdownExportStorageCore = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  function exportKey(exportId) {
    return `export:${exportId}`;
  }

  function isValidExportId(exportId) {
    return typeof exportId === "string" && /^[0-9a-f-]{16,64}$/i.test(exportId);
  }

  function estimateBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function pruneExportIndex(index, currentId, maxCount, maxBytes) {
    const kept = [...index].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const removedIds = [];
    let totalBytes = kept.reduce((sum, entry) => sum + (Number(entry.sizeBytes) || 0), 0);

    while (kept.length > maxCount || totalBytes > maxBytes) {
      const removableIndex = kept.map((entry) => entry.id).lastIndexOf(currentId) === kept.length - 1
        ? kept.length - 2
        : kept.length - 1;
      if (removableIndex < 0) {
        throw new Error("There is not enough session storage for this export.");
      }
      const [removed] = kept.splice(removableIndex, 1);
      totalBytes -= Number(removed.sizeBytes) || 0;
      removedIds.push(removed.id);
    }

    return { kept, removedIds, totalBytes };
  }
})(typeof globalThis === "object" ? globalThis : this);
