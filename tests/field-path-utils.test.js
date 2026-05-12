const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectFieldTable,
  normalizeFieldRows
} = require("../field-path-utils.js");

test("detectFieldTable identifies common API field headers", () => {
  const result = detectFieldTable(
    ["Field", "Type", "Required", "Description"],
    [["data", "object", "yes", "payload root"]]
  );

  assert.equal(result.isFieldTable, true);
  assert.equal(result.nameIndex, 0);
  assert.equal(result.typeIndex, 1);
  assert.equal(result.requiredIndex, 2);
  assert.equal(result.descriptionIndex, 3);
});

test("normalizeFieldRows expands nested object paths", () => {
  const rows = normalizeFieldRows([
    { name: "data", depth: 0, type: "object", depthSource: "style" },
    { name: "user", depth: 1, type: "object", depthSource: "style" },
    { name: "name", depth: 2, type: "string", depthSource: "style" },
    { name: "age", depth: 1, type: "integer", depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.name", "data.age"]
  );
});

test("normalizeFieldRows appends array markers and nests children under []", () => {
  const rows = normalizeFieldRows([
    { name: "items", depth: 0, type: "array<object>", depthSource: "style" },
    { name: "id", depth: 1, type: "string", depthSource: "style" },
    { name: "meta", depth: 1, type: "object", depthSource: "style" },
    { name: "createdAt", depth: 2, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["items[]", "items[].id", "items[].meta", "items[].meta.createdAt"]
  );
});

test("normalizeFieldRows preserves explicit full paths without duplicating prefixes", () => {
  const rows = normalizeFieldRows([
    { name: "data.items[].id", type: "string", depthSource: "none" },
    { name: "data.items[].name", type: "string", depthSource: "none" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data.items[].id", "data.items[].name"]
  );
});

test("normalizeFieldRows respects leading dot depth markers", () => {
  const rows = normalizeFieldRows([
    { name: "data", type: "object", depthSource: "none" },
    { name: ".user", type: "object", depthSource: "none" },
    { name: "..id", type: "string", depthSource: "none" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.id"]
  );
});

test("normalizeFieldRows clamps invalid depth jumps", () => {
  const rows = normalizeFieldRows([
    { name: "data", depth: 0, type: "object", depthSource: "style" },
    { name: "name", depth: 3, type: "string", depthSource: "style" },
    { name: "status", depth: 0, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => ({ depth: row.depth, path: row.path })),
    [
      { depth: 0, path: "data" },
      { depth: 1, path: "data.name" },
      { depth: 0, path: "status" }
    ]
  );
});

test("detectFieldTable rejects non-field tables", () => {
  const result = detectFieldTable(
    ["Status Code", "Meaning"],
    [["200", "Success"], ["500", "Failure"]]
  );

  assert.equal(result.isFieldTable, false);
});
