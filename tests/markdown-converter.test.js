const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { convertNodeToMarkdown, inferCodeLanguage } = require("../markdown-converter.js");

function convert(html) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "https://docs.example.test/base/" });
  return convertNodeToMarkdown(dom.window.document.body);
}

test("preserves indentation, tabs, and blank lines inside fenced code", () => {
  const markdown = convert("<pre><code class='language-python'>def hello():\n    value = 1\n\treturn value\n\n\nprint(hello())</code></pre>");
  assert.equal(markdown, "```python\ndef hello():\n    value = 1\n\treturn value\n\n\nprint(hello())\n```");
});

test("normalizes CRLF without changing code indentation", () => {
  const markdown = convert("<pre><code>root:\r\n  child: true\r\n</code></pre>");
  assert.equal(markdown, "```\nroot:\n  child: true\n```");
});

test("uses a longer fence when code contains backticks", () => {
  const markdown = convert("<pre><code>before\n```js\ninside\n```\nafter</code></pre>");
  assert.match(markdown, /^````\n/);
  assert.match(markdown, /\nafter\n````$/);
});

test("preserves br as a Markdown hard break", () => {
  assert.equal(convert("<p>first<br>second</p>"), "first  \nsecond");
});

test("chooses a safe delimiter for inline code containing a backtick", () => {
  assert.equal(convert("<p>Use <code>a`b</code> now.</p>"), "Use ``a`b`` now.");
});

test("infers conservative code languages", () => {
  assert.equal(inferCodeLanguage(null, '{"ok":true}'), "json");
  assert.equal(inferCodeLanguage(null, "curl https://example.test"), "bash");
  assert.equal(inferCodeLanguage(null, "<?php echo 'ok';"), "php");
  assert.equal(inferCodeLanguage(null, "def run():\n    return True"), "python");
  assert.equal(inferCodeLanguage(null, "plain words"), "");
});

test("renders nested lists without double traversal", () => {
  const markdown = convert("<ul><li>Parent<ul><li>Child</li></ul></li></ul>");
  assert.equal(markdown, "- Parent\n  - Child");
});

test("pads uneven table rows and keeps field path metadata", () => {
  const markdown = convert("<table data-ptm-field-name-index='0'><thead><tr><th>Field</th><th>Type</th></tr></thead><tbody><tr data-ptm-field-path='data.id'><td>id</td><td>string</td></tr><tr><td>status</td></tr></tbody></table>");
  assert.equal(markdown, "| Field | Type |\n| --- | --- |\n| data.id | string |\n| status |  |");
});
