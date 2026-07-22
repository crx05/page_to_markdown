const test = require("node:test");
const assert = require("node:assert/strict");
const { exportKey, isValidExportId, estimateBytes, pruneExportIndex } = require("../export-storage-core.js");

test("validates and formats export IDs", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(isValidExportId(id), true);
  assert.equal(exportKey(id), `export:${id}`);
  assert.equal(isValidExportId("../bad"), false);
});

test("estimates UTF-8 payload size", () => {
  assert.equal(estimateBytes({ markdown: "中" }), Buffer.byteLength(JSON.stringify({ markdown: "中" })));
});

test("evicts least recently used exports by count", () => {
  const index = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", updatedAt: "2026-01-03T00:00:00.000Z", sizeBytes: 10 },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", updatedAt: "2026-01-02T00:00:00.000Z", sizeBytes: 10 },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 10 }
  ];
  const result = pruneExportIndex(index, index[0].id, 2, 100);
  assert.deepEqual(result.kept.map((entry) => entry.id), [index[0].id, index[1].id]);
  assert.deepEqual(result.removedIds, [index[2].id]);
});

test("never evicts the export currently being stored", () => {
  const currentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const index = [
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", updatedAt: "2026-01-02T00:00:00.000Z", sizeBytes: 60 },
    { id: currentId, updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 60 }
  ];
  const result = pruneExportIndex(index, currentId, 10, 70);
  assert.deepEqual(result.kept.map((entry) => entry.id), [currentId]);
});
