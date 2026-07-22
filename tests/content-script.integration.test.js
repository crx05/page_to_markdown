const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scriptNames = [
  "field-path-utils.js",
  "markdown-converter.js",
  "platform-adapters.js",
  "extraction-core.js",
  "content-script.js"
];
const scripts = scriptNames.map((name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8"));

async function extract(html, url = "https://docs.example.test/api?token=secret#users", setup) {
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const { window } = dom;
  let messageListener = null;
  window.scrollTo = () => {};
  window.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      },
      async sendMessage() {
        return { ok: true };
      }
    }
  };

  scripts.forEach((script) => window.eval(script));
  assert.equal(typeof messageListener, "function");
  const inspectAfterResponse = typeof setup === "function" ? setup(window) : null;

  return new Promise((resolve, reject) => {
    messageListener({ type: "page-to-markdown:run-auto" }, {}, (response) => {
      if (response?.ok) {
        try {
          inspectAfterResponse?.();
          resolve(response.payload);
        } catch (error) {
          reject(error);
        } finally {
          window.close();
        }
      } else {
        window.close();
        reject(new Error(response?.error || "Extraction failed"));
      }
    });
  });
}

test("extracts dotted field paths from a rendered API table without prefix duplication", async () => {
  const payload = await extract(`
    <article class="api-reference">
      <h1>User API</h1>
      <p>Parameters, request body, response schema, examples, authentication and status code documentation.</p>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>aaa</code></td><td>object</td><td>Root object</td></tr>
          <tr aria-level="2"><td><code>aaa.bbb</code><span> nested field</span></td><td>object</td><td>Nested object</td></tr>
          <tr aria-level="3"><td><code>aaa.bbb.ccc</code></td><td>string</td><td>Leaf value</td></tr>
        </tbody>
      </table>
      <pre><code class="language-python">def run():\n    return True</code></pre>
    </article>
  `);

  assert.match(payload.markdown, /\| aaa\.bbb \| object \| Nested object \|/);
  assert.match(payload.markdown, /\| aaa\.bbb\.ccc \| string \| Leaf value \|/);
  assert.doesNotMatch(payload.markdown, /aaa\.aaa\.bbb/);
  assert.match(payload.markdown, /```python\ndef run\(\):\n    return True\n```/);
  assert.equal(payload.url, "https://docs.example.test/api?token=REDACTED");
});

test("carries an array parent marker into later dotted field rows", async () => {
  const payload = await extract(`
    <main class="documentation">
      <h1>List API</h1>
      <p>Request parameters and response schema for GET /api/users/list with JSON examples and status codes.</p>
      <table>
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td>data.items</td><td>array&lt;object&gt;</td><td>Results</td></tr>
        <tr><td>data.items.id</td><td>string</td><td>Identifier</td></tr>
        <tr><td>data.items.profile.name</td><td>string</td><td>User name</td></tr>
      </table>
    </main>
  `);

  assert.match(payload.markdown, /\| data\.items\[\] \| array<object> \| Results \|/);
  assert.match(payload.markdown, /\| data\.items\[\]\.id \| string \| Identifier \|/);
  assert.match(payload.markdown, /\| data\.items\[\]\.profile\.name \| string \| User name \|/);
});

test("extracts Temu field paths from its inline tree-table indentation", async () => {
  const payload = await extract(`
    <main id="documentation-content-container" class="Documentation_content__hash">
      <h1>Temu Product API</h1>
      <p>Request parameters, response schema, authentication, examples and status codes.</p>
      <table class="Documentation_table__hash Documentation_tableTree__hash">
        <thead><tr>
          <th>Properties<a>Collapse</a></th><th>Type</th><th>Required</th><th>Description</th>
        </tr></thead>
        <tbody>
          <tr><td><div style="padding-left: 24px"><code>request</code></div></td><td>OBJECT</td><td>False</td><td>Request wrapper</td></tr>
          <tr><td><div style="padding-left: 40px"><code>language</code></div></td><td>STRING</td><td>False</td><td>Language</td></tr>
          <tr><td><div style="padding-left: 24px"><code>goodsBasic</code></div></td><td>OBJECT</td><td>True</td><td>Basic product information</td></tr>
          <tr><td><div style="padding-left: 40px"><code>externalGoodsId</code></div></td><td>STRING</td><td>True</td><td>External product code</td></tr>
          <tr><td><div style="padding-left: 40px"><code>goodsName</code></div></td><td>STRING</td><td>True</td><td>Product name</td></tr>
          <tr><td><div style="padding-left: 40px"><code>goodsCarouselImage</code></div></td><td>STRING[]</td><td>False</td><td>Product carousel images</td></tr>
        </tbody>
      </table>
    </main>
  `, "https://partner-us.temu.com/documentation?menu_code=test");

  assert.equal(payload.detectedPlatform, "temu");
  assert.match(payload.markdown, /\| request\.language \| STRING \| False \| Language \|/);
  assert.match(payload.markdown, /\| goodsBasic\.externalGoodsId \| STRING \| True \| External product code \|/);
  assert.match(payload.markdown, /\| goodsBasic\.goodsName \| STRING \| True \| Product name \|/);
  assert.match(payload.markdown, /\| goodsBasic\.goodsCarouselImage\[\] \| STRING\[\] \| False \| Product carousel images \|/);
  assert.doesNotMatch(payload.markdown, /\?\./);
});

test("recursively expands and restores TikTok Shop tree rows before building paths", async () => {
  let restoredRowCount = -1;
  const payload = await extract(`
    <main id="scrollIntersectionContainer">
      <h1>Get Package Detail</h1>
      <p>Response body schema, request parameters, examples, authentication and status codes.</p>
      <table class="style-module__markdown-table--hash">
        <thead><tr><th>Properties</th><th>Type</th><th>Description</th></tr></thead>
        <tbody id="dynamic-tree-body">
          <tr id="row-data" class="style-module__table-body-tr--root"><td>
            <div class="style-module__table-body-td-start-dash--root"></div>
            <div class="style-module__table-body-td-cell--root">
              <span class="style-module__table-body-td-svg-outer--root" data-node-control="data"></span>
              <code>data</code>
            </div>
          </td><td>object</td><td>Specific return information</td></tr>
        </tbody>
      </table>
    </main>
  `, "https://partner.tiktokshop.com/docv2/page/get-package-detail-202309", (window) => {
    const tbody = window.document.querySelector("#dynamic-tree-body");

    function dashes(depth) {
      return Array.from({ length: depth }, (_, index) =>
        `<div class="style-module__table-body-td-dash--${index}"></div>`
      ).join("");
    }

    function row(id, name, type, description, depth, expandable = false) {
      const control = expandable
        ? `<span class="style-module__table-body-td-svg-outer--${id}" data-node-control="${id}"></span>`
        : "";
      return `<tr id="row-${id}" class="style-module__table-body-tr--${id}"><td>
        ${dashes(depth)}
        <div class="style-module__table-body-td-cell--${id}">${control}<code>${name}</code></div>
      </td><td>${type}</td><td>${description}</td></tr>`;
    }

    tbody.addEventListener("click", (event) => {
      const control = event.target.closest?.("[data-node-control]");
      if (!control) {
        return;
      }

      const node = control.dataset.nodeControl;
      if (node === "data") {
        if (tbody.querySelector("#row-package")) {
          [...tbody.querySelectorAll("tr:not(#row-data)")].forEach((element) => element.remove());
        } else {
          tbody.querySelector("#row-data").insertAdjacentHTML("afterend", [
            row("package", "package_id", "string", "TikTok Shop package ID", 1),
            row("orders", "orders", "[]object", "Order list", 1, true)
          ].join(""));
        }
        return;
      }

      if (node === "orders") {
        if (tbody.querySelector("#row-order-id")) {
          for (const id of ["row-order-id", "row-skus", "row-sku-id", "row-sku-name"]) {
            tbody.querySelector(`#${id}`)?.remove();
          }
        } else {
          tbody.querySelector("#row-orders").insertAdjacentHTML("afterend", [
            row("order-id", "id", "string", "TikTok Shop order ID", 2),
            row("skus", "skus", "[]object", "SKU information", 2, true)
          ].join(""));
        }
        return;
      }

      if (tbody.querySelector("#row-sku-id")) {
        tbody.querySelector("#row-sku-id")?.remove();
        tbody.querySelector("#row-sku-name")?.remove();
      } else {
        tbody.querySelector("#row-skus").insertAdjacentHTML("afterend", [
          row("sku-id", "id", "string", "SKU ID", 3),
          row("sku-name", "name", "string", "SKU name", 3)
        ].join(""));
      }
    });

    return () => {
      restoredRowCount = tbody.rows.length;
    };
  });

  assert.equal(payload.detectedPlatform, "tiktok-shop");
  assert.equal(payload.expandedCount, 3);
  assert.equal(restoredRowCount, 1);
  assert.match(payload.markdown, /\| data\.package_id \| string \| TikTok Shop package ID \|/);
  assert.match(payload.markdown, /\| data\.orders\[\] \| \[\]object \| Order list \|/);
  assert.match(payload.markdown, /\| data\.orders\[\]\.id \| string \| TikTok Shop order ID \|/);
  assert.match(payload.markdown, /\| data\.orders\[\]\.skus\[\] \| \[\]object \| SKU information \|/);
  assert.match(payload.markdown, /\| data\.orders\[\]\.skus\[\]\.id \| string \| SKU ID \|/);
  assert.doesNotMatch(payload.markdown, /\?\./);
});
