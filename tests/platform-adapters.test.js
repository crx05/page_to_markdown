const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { detect, getById } = require("../platform-adapters.js");

const cases = [
  ["temu", "<main></main>", "https://partner-us.temu.com/documentation"],
  ["tiktok-shop", "<main></main>", "https://partner.tiktokshop.com/docv2/page/test"],
  ["swagger-ui", "<div class='swagger-ui'></div>"],
  ["redoc", "<redoc></redoc>"],
  ["apifox", "<div class='apifox-app'></div>"],
  ["yapi", "<div class='yapi-container'></div>"],
  ["postman", "<main class='postman-docs'></main>"]
];

for (const [expected, html, url] of cases) {
  test(`detects ${expected}`, () => {
    const document = new JSDOM(html, { url: url || "https://docs.example.test" }).window.document;
    assert.equal(detect(document).id, expected);
  });
}

test("falls back to the generic adapter", () => {
  const document = new JSDOM("<article>Generic documentation</article>").window.document;
  assert.equal(detect(document).id, "unknown");
});

test("each supported adapter exposes a complete contract", () => {
  for (const [id] of cases) {
    const adapter = getById(id);
    assert.equal(adapter.id, id);
    assert.ok(adapter.label);
    assert.ok(adapter.rootSelectors.length > 0);
    assert.ok(adapter.structuredBlockSelectors.length > 0);
    assert.ok(adapter.expandSelectors.length > 0);
  }
});

test("resolves Temu tree levels from the field wrapper padding", () => {
  const dom = new JSDOM(`
    <table class="Documentation_tableTree__hash">
      <tbody>
        <tr id="root"><td><div style="padding-left: 24px"><code>goodsBasic</code></div></td></tr>
        <tr id="child"><td><div style="padding-left: 40px"><code>goodsName</code></div></td></tr>
        <tr id="grandchild"><td><div style="padding-left: 56px"><code>value</code></div></td></tr>
      </tbody>
    </table>
  `, { url: "https://partner-us.temu.com/documentation" });
  const { document } = dom.window;
  const adapter = getById("temu");

  assert.equal(adapter.resolveFieldDepth({
    rowNode: document.querySelector("#root"),
    nameCell: document.querySelector("#root td"),
    subjectNode: document.querySelector("#root code")
  }).depth, 0);
  assert.equal(adapter.resolveFieldDepth({
    rowNode: document.querySelector("#child"),
    nameCell: document.querySelector("#child td"),
    subjectNode: document.querySelector("#child code")
  }).depth, 1);
  assert.equal(adapter.resolveFieldDepth({
    rowNode: document.querySelector("#grandchild"),
    nameCell: document.querySelector("#grandchild td"),
    subjectNode: document.querySelector("#grandchild code")
  }).depth, 2);

  dom.window.close();
});

test("falls back to Temu tree-line offsets when the wrapper padding is absent", () => {
  const dom = new JSDOM(`
    <table class="Documentation_tableTree__hash">
      <tbody><tr><td>
        <div class="Documentation_ancestorLine__hash" style="left: 22px"></div>
        <div class="Documentation_horizontalLine__hash" style="left: 54px"></div>
        <code>leaf</code>
      </td></tr></tbody>
    </table>
  `);
  const { document } = dom.window;
  const rowNode = document.querySelector("tr");
  const nameCell = document.querySelector("td");

  assert.equal(getById("temu").resolveFieldDepth({
    rowNode,
    nameCell,
    subjectNode: document.querySelector("code")
  }).depth, 2);

  dom.window.close();
});

test("resolves TikTok Shop depth by counting field-cell dash nodes", () => {
  const dom = new JSDOM(`
    <table><tbody>
      <tr class="style-module__table-body-tr--hash"><td>
        <div class="style-module__table-body-td-dash--one"></div>
        <div class="style-module__table-body-td-dash--two"></div>
        <div class="style-module__table-body-td-start-dash--ignored"></div>
        <div class="style-module__table-body-td-cell--hash"><code>id</code></div>
      </td></tr>
    </tbody></table>
  `);
  const { document } = dom.window;
  const rowNode = document.querySelector("tr");

  assert.equal(getById("tiktok-shop").resolveFieldDepth({
    rowNode,
    nameCell: document.querySelector("td"),
    subjectNode: document.querySelector("code")
  }).depth, 2);

  dom.window.close();
});

test("tracks platform-specific expansion state", () => {
  const temuDom = new JSDOM(`
    <table class="Documentation_tableTree__hash"><thead><tr><th><a>Collapse</a></th></tr></thead></table>
  `);
  const temuControl = temuDom.window.document.querySelector("a");
  assert.equal(getById("temu").isExpansionControl(temuControl), true);
  assert.equal(getById("temu").isExpanded(temuControl), true);
  temuDom.window.close();

  const tiktokDom = new JSDOM(`
    <table><tbody>
      <tr class="style-module__table-body-tr--root"><td>
        <span class="style-module__table-body-td-svg-outer--root"></span>
        <div class="style-module__table-body-td-cell--root">data</div>
      </td></tr>
      <tr class="style-module__table-body-tr--child"><td>
        <div class="style-module__table-body-td-dash--one"></div>
        <div class="style-module__table-body-td-cell--child">package_id</div>
      </td></tr>
    </tbody></table>
  `);
  const tiktokControl = tiktokDom.window.document.querySelector("span");
  assert.equal(getById("tiktok-shop").isExpansionControl(tiktokControl), true);
  assert.equal(getById("tiktok-shop").isExpanded(tiktokControl), true);
  tiktokDom.window.close();
});
