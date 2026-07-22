const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectFieldTable,
  normalizeFieldRows,
  looksLikeExplicitPath
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

test("detectFieldTable ignores an expand action appended to the Properties header", () => {
  const result = detectFieldTable(
    ["PropertiesExpand", "Type", "Required", "Description"],
    [["goodsBasic", "OBJECT", "True", "Basic product information"]]
  );

  assert.equal(result.isFieldTable, true);
  assert.equal(result.nameIndex, 0);
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

  // 修复后：强信号源允许深度跳跃，用 ? 填充缺失的父级
  assert.deepEqual(
    rows.map((row) => ({ depth: row.depth, path: row.path })),
    [
      { depth: 0, path: "data" },
      { depth: 3, path: "data.?.?.name" },  // depth=3，缺失2个父级
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

// ========== 新增测试用例：改进1 - 特殊字符路径识别 ==========

// 注意：移除了空格测试，因为严格模式下不允许路径段中包含空格
// 这样可以避免误判普通字段名为显式路径

test("looksLikeExplicitPath accepts paths with Chinese characters", () => {
  assert.equal(looksLikeExplicitPath("用户.姓名"), true);
  assert.equal(looksLikeExplicitPath("数据.用户.年龄"), true);
});

test("looksLikeExplicitPath accepts paths with Japanese characters", () => {
  assert.equal(looksLikeExplicitPath("ユーザー.名前"), true);
  assert.equal(looksLikeExplicitPath("データ.ユーザー.年齢"), true);
});

test("looksLikeExplicitPath accepts paths with array indices", () => {
  assert.equal(looksLikeExplicitPath("items[0].id"), true);
  assert.equal(looksLikeExplicitPath("data.list[5].name"), true);
});

test("looksLikeExplicitPath accepts paths with multiple array markers", () => {
  assert.equal(looksLikeExplicitPath("data.items[].tags[]"), true);
  assert.equal(looksLikeExplicitPath("matrix[][].value"), true);
});

test("looksLikeExplicitPath rejects paths without dots", () => {
  assert.equal(looksLikeExplicitPath("singlefield"), false);
  assert.equal(looksLikeExplicitPath("user_name"), false);
});

test("normalizeFieldRows preserves explicit paths with special characters", () => {
  const rows = normalizeFieldRows([
    { name: "用户.姓名", type: "string", depthSource: "none" },
    { name: "user info.first name", type: "string", depthSource: "none" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["用户.姓名", "user info.first name"]
  );
});

// ========== 新增测试用例：改进3 - 混合模式支持 ==========

test("normalizeFieldRows handles mixed explicit and relative paths", () => {
  const rows = normalizeFieldRows([
    { name: "data.user", type: "object", depth: 0, depthSource: "none" },
    { name: "name", type: "string", depth: 2, depthSource: "style" },
    { name: "age", type: "integer", depth: 2, depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data.user", "data.user.name", "data.user.age"]
  );
});

test("normalizeFieldRows handles mixed mode with nested relative paths", () => {
  const rows = normalizeFieldRows([
    { name: "response.data", type: "object", depth: 0, depthSource: "none" },
    { name: "user", type: "object", depth: 2, depthSource: "style" },
    { name: "name", type: "string", depth: 3, depthSource: "style" },
    { name: "age", type: "integer", depth: 3, depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["response.data", "response.data.user", "response.data.user.name", "response.data.user.age"]
  );
});

test("normalizeFieldRows handles multiple explicit paths with relative children", () => {
  const rows = normalizeFieldRows([
    { name: "data.items[]", type: "array", depth: 0, depthSource: "none" },
    { name: "id", type: "string", depth: 2, depthSource: "style" },
    { name: "meta", type: "object", depth: 2, depthSource: "style" },
    { name: "created", type: "string", depth: 3, depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data.items[]", "data.items[].id", "data.items[].meta", "data.items[].meta.created"]
  );
});

// ========== 新增测试用例：改进4 - 深度跳跃放宽 ==========

test("normalizeFieldRows allows depth jumps with strong signals (attr)", () => {
  const rows = normalizeFieldRows([
    { name: "root", depth: 0, type: "object", depthSource: "attr" },
    { name: "deeply", depth: 3, type: "string", depthSource: "attr" }
  ]);

  // 修复后：强信号源信任深度值，用 ? 填充缺失的父级
  assert.equal(rows[1].path, "root.?.?.deeply");
  assert.equal(rows[1].depth, 3);
});

test("normalizeFieldRows allows depth jumps with strong signals (style)", () => {
  const rows = normalizeFieldRows([
    { name: "data", depth: 0, type: "object", depthSource: "style" },
    { name: "nested", depth: 2, type: "string", depthSource: "style" }
  ]);

  // 修复后：强信号源信任深度值，用 ? 填充缺失的父级
  assert.equal(rows[1].path, "data.?.nested");
  assert.equal(rows[1].depth, 2);
});

test("normalizeFieldRows limits depth jumps with weak signals (none)", () => {
  const rows = normalizeFieldRows([
    { name: "root", depth: 0, type: "object", depthSource: "none" },
    { name: "attempt", depth: 3, type: "string", depthSource: "none" }
  ]);

  assert.equal(rows[1].path, "root.?.?.attempt");
  assert.equal(rows[1].depth, 3); // 允许跳跃最多 +3，深度保持为 3
});

test("normalizeFieldRows respects explicit depth from leading dots", () => {
  const rows = normalizeFieldRows([
    { name: "root", type: "object", depthSource: "none" },
    { name: "...deeply", type: "string", depthSource: "none" }
  ]);

  // explicitDepth=3 表示绝对深度为3，缺失2个中间父级
  assert.equal(rows[1].path, "root.?.?.deeply");
  assert.equal(rows[1].depth, 3);
});

test("normalizeFieldRows handles proper depth progression with strong signals", () => {
  const rows = normalizeFieldRows([
    { name: "level0", depth: 0, type: "object", depthSource: "attr" },
    { name: "level1", depth: 1, type: "object", depthSource: "attr" },
    { name: "level2", depth: 2, type: "object", depthSource: "attr" },
    { name: "level3", depth: 3, type: "string", depthSource: "attr" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["level0", "level0.level1", "level0.level1.level2", "level0.level1.level2.level3"]
  );
});

// ========== 边界情况测试 ==========

test("normalizeFieldRows handles empty input", () => {
  const rows = normalizeFieldRows([]);
  assert.deepEqual(rows, []);
});

test("normalizeFieldRows handles single field", () => {
  const rows = normalizeFieldRows([
    { name: "field", type: "string", depthSource: "none" }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "field");
  assert.equal(rows[0].depth, 0);
});

test("normalizeFieldRows handles field with empty name", () => {
  const rows = normalizeFieldRows([
    { name: "", type: "string", depthSource: "none" }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "");
});

test("normalizeFieldRows handles depth reset to 0", () => {
  const rows = normalizeFieldRows([
    { name: "first", depth: 0, type: "object", depthSource: "style" },
    { name: "child", depth: 1, type: "string", depthSource: "style" },
    { name: "second", depth: 0, type: "object", depthSource: "style" },
    { name: "child2", depth: 1, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["first", "first.child", "second", "second.child2"]
  );
});


// ========== 新增测试用例：树形字符识别 ==========

test("normalizeFieldRows extracts depth from tree box characters (├)", () => {
  const rows = normalizeFieldRows([
    { name: "data", type: "object", depthSource: "none" },
    { name: "├─ user", type: "object", depthSource: "none" },
    { name: "├─ ├─ name", type: "string", depthSource: "none" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.name"]
  );
});

test("normalizeFieldRows extracts depth from tree box characters (└)", () => {
  const rows = normalizeFieldRows([
    { name: "Properties", type: "", depthSource: "text" },
    { name: "├─ code", type: "int", depthSource: "text" },
    { name: "└─ data", type: "object", depthSource: "text" },
    { name: "   └─ package_id", type: "string", depthSource: "text" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["Properties", "Properties.code", "Properties.data", "Properties.data.package_id"]
  );
});

test("normalizeFieldRows handles complex nested tree structure", () => {
  const rows = normalizeFieldRows([
    { name: "data", type: "object", depthSource: "text" },
    { name: "└─ orders", type: "[]object", depthSource: "text" },
    { name: "   ├─ id", type: "string", depthSource: "text" },
    { name: "   └─ skus", type: "[]object", depthSource: "text" },
    { name: "      ├─ id", type: "string", depthSource: "text" },
    { name: "      └─ name", type: "string", depthSource: "text" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    [
      "data",
      "data.orders[]",
      "data.orders[].id",
      "data.orders[].skus[]",
      "data.orders[].skus[].id",
      "data.orders[].skus[].name"
    ]
  );
});

test("normalizeFieldRows extracts depth from dash-based tree structure", () => {
  const rows = normalizeFieldRows([
    { name: "request", type: "OBJECT", depthSource: "text" },
    { name: "-- language", type: "STRING", depthSource: "text" },
    { name: "goodsBasic", type: "OBJECT", depthSource: "text" },
    { name: "---- externalGoodsId", type: "STRING", depthSource: "text" },
    { name: "---- goodsName", type: "STRING", depthSource: "text" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    [
      "request",
      "request.language",
      "goodsBasic",
      "goodsBasic.externalGoodsId",
      "goodsBasic.goodsName"
    ]
  );
});

test("normalizeFieldRows prioritizes tree depth over leading dots", () => {
  const rows = normalizeFieldRows([
    { name: "data", type: "object", depthSource: "none" },
    { name: "├─ .user", type: "object", depthSource: "none" },  // 树形字符 + 前导点
    { name: "├─ ├─ ..name", type: "string", depthSource: "none" }  // 2个树形字符 + 2个前导点
  ]);

  // 应该取最大值：max(2个树形字符的深度2, 2个前导点的深度2) = 2
  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.name"]
  );
});

test("normalizeFieldRows handles mixed tree characters and visual indent", () => {
  const rows = normalizeFieldRows([
    { name: "data", depth: 0, type: "object", depthSource: "style" },
    { name: "├─ user", depth: 1, type: "object", depthSource: "style" },  // 树形字符 + 视觉缩进
    { name: "   name", depth: 2, type: "string", depthSource: "style" }  // 只有视觉缩进
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.name"]
  );
});

test("normalizeFieldRows handles bullet points as tree markers", () => {
  const rows = normalizeFieldRows([
    { name: "data", type: "object", depthSource: "text" },
    { name: "- user", type: "object", depthSource: "text" },
    { name: "-- id", type: "string", depthSource: "text" },
    { name: "-- name", type: "string", depthSource: "text" }
  ]);

  assert.deepEqual(
    rows.map((row) => row.path),
    ["data", "data.user", "data.user.id", "data.user.name"]
  );
});

test("normalizeFieldRows treats dotted names as absolute paths even with style depth", () => {
  const rows = normalizeFieldRows([
    { name: "data", depth: 0, type: "object", depthSource: "style" },
    { name: "data.user", depth: 1, type: "object", depthSource: "style" },
    { name: "data.user.profile.name", depth: 3, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["data", "data.user", "data.user.profile.name"]);
});

test("normalizeFieldRows treats dotted names as absolute paths with attribute depth", () => {
  const rows = normalizeFieldRows([
    { name: "response", depth: 0, type: "object", depthSource: "attr" },
    { name: "response.data.items.id", depth: 4, type: "string", depthSource: "attr" },
    { name: "response.meta.page", depth: 2, type: "integer", depthSource: "attr" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["response", "response.data.items.id", "response.meta.page"]);
});

test("normalizeFieldRows does not duplicate an existing dotted prefix", () => {
  const rows = normalizeFieldRows([
    { name: "aaa", depth: 0, type: "object", depthSource: "style" },
    { name: "aaa.bbb", depth: 1, type: "object", depthSource: "style" },
    { name: "aaa.bbb.ccc", depth: 2, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["aaa", "aaa.bbb", "aaa.bbb.ccc"]);
});

test("normalizeFieldRows carries known array markers into later dotted paths", () => {
  const rows = normalizeFieldRows([
    { name: "data.items", depth: 0, type: "array<object>", depthSource: "none" },
    { name: "data.items.id", depth: 2, type: "string", depthSource: "style" },
    { name: "data.items.profile.name", depth: 3, type: "string", depthSource: "attr" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["data.items[]", "data.items[].id", "data.items[].profile.name"]);
});

test("normalizeFieldRows preserves explicit array indices in dotted paths", () => {
  const rows = normalizeFieldRows([
    { name: "items", depth: 0, type: "array", depthSource: "style" },
    { name: "items[0].children[].id", depth: 3, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["items[]", "items[0].children[].id"]);
});

test("normalizeFieldRows supports Unicode dotted paths with visual depth", () => {
  const rows = normalizeFieldRows([
    { name: "数据.用户", depth: 1, type: "object", depthSource: "style" },
    { name: "数据.用户.地址.城市", depth: 3, type: "string", depthSource: "style" }
  ]);

  assert.deepEqual(rows.map((row) => row.path), ["数据.用户", "数据.用户.地址.城市"]);
});
