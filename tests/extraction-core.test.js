const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fieldPathUtils = require("../field-path-utils.js");
const {
  scoreCandidateMetrics,
  classifyConfidence,
  sanitizeSourceUrl,
  readFieldNameValue,
  findExplicitFieldNameElement
} = require("../extraction-core.js");

function metrics(overrides = {}) {
  return {
    textLength: 2000,
    paragraphCount: 4,
    headingCount: 3,
    preCount: 2,
    codeCount: 4,
    tableCount: 1,
    linkCount: 2,
    listCount: 1,
    buttonCount: 0,
    linkDensity: 0.05,
    methodCount: 3,
    pathCount: 3,
    keywordCount: 5,
    navKeywordCount: 0,
    codeLikeBlockCount: 2,
    markerPenalty: 0,
    adapterMatched: false,
    ...overrides
  };
}

test("API-dense content outranks navigation-heavy content", () => {
  const apiScore = scoreCandidateMetrics(metrics());
  const navigationScore = scoreCandidateMetrics(metrics({
    methodCount: 0,
    pathCount: 0,
    keywordCount: 0,
    preCount: 0,
    tableCount: 0,
    linkCount: 60,
    linkDensity: 0.8,
    navKeywordCount: 4,
    markerPenalty: 900
  }));
  assert.ok(apiScore > navigationScore);
});

test("adapter roots receive a bounded preference", () => {
  const generic = scoreCandidateMetrics(metrics());
  const adapter = scoreCandidateMetrics(metrics({ adapterMatched: true }));
  assert.equal(adapter - generic, 700);
});

test("confidence accounts for adapter matches and score gaps", () => {
  assert.equal(classifyConfidence({ score: 400, runnerUpScore: 390, adapterMatched: true }), "high");
  assert.equal(classifyConfidence({ score: 800, runnerUpScore: 600, adapterMatched: false }), "high");
  assert.equal(classifyConfidence({ score: 400, runnerUpScore: 390, adapterMatched: false }), "medium");
  assert.equal(classifyConfidence({ score: 100, runnerUpScore: 90, adapterMatched: false }), "low");
});

test("source URL removes fragments and redacts sensitive query values", () => {
  assert.equal(
    sanitizeSourceUrl("https://docs.example.test/api?token=secret&lang=zh#operation"),
    "https://docs.example.test/api?token=REDACTED&lang=zh"
  );
});

test("finds a dotted path inside a field cell with surrounding text", () => {
  const dom = new JSDOM("<table><tr><td id='field'>Field <code>aaa.bbb.ccc</code><span>string</span></td></tr></table>");
  const cell = dom.window.document.getElementById("field");
  const element = findExplicitFieldNameElement(cell, fieldPathUtils);
  assert.equal(element.tagName, "CODE");
  assert.equal(readFieldNameValue(element), "aaa.bbb.ccc");
});

test("prefers an explicit data-field-path attribute over presentation text", () => {
  const dom = new JSDOM("<table><tr><td id='field'><span data-field-path='response.data.user.id'>id</span></td></tr></table>");
  const cell = dom.window.document.getElementById("field");
  const element = findExplicitFieldNameElement(cell, fieldPathUtils);
  assert.equal(readFieldNameValue(element), "response.data.user.id");
});
