const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const { marked } = require("marked");
const { stripFrontMatter, renderSanitizedMarkdown } = require("../preview-renderer.js");

function render(markdown) {
  const window = new JSDOM("").window;
  const purifier = createDOMPurify(window);
  return renderSanitizedMarkdown(markdown, marked, purifier);
}

test("does not render YAML front matter as document content", () => {
  const markdown = "---\ntitle: Example\nsource: https://example.test\n---\n# Heading";
  assert.equal(stripFrontMatter(markdown), "# Heading");
  assert.match(render(markdown), /<h1>Heading<\/h1>/);
  assert.doesNotMatch(render(markdown), /title: Example/);
});

test("removes scripts, event attributes, and dangerous links", () => {
  const html = render("<script>alert(1)</script><img src=x onerror=alert(1)> [bad](javascript:alert(1))");
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  // marked 会将 javascript: 链接渲染为纯文本，不会创建 <a href="javascript:"> 标签
  // 所以我们检查是否存在可点击的恶意链接
  assert.doesNotMatch(html, /<a[^>]*href=["']javascript:/i);
});

test("removes interactive raw HTML while preserving safe Markdown", () => {
  const html = render("# Safe\n\n<form><input value='secret'><button>Send</button></form>\n\n**bold**");
  assert.match(html, /<h1>Safe<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(html, /<(?:form|input|button)/i);
});
