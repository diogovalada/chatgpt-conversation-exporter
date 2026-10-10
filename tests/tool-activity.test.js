const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createClaudeContext = require("./helpers/claude-context.js");

const runtime = createClaudeContext({ location: { href: "https://claude.ai/chat/12345678-1234-1234-1234-123456789012", origin: "https://claude.ai" } });
for (const file of ["content/markdown-converter.js", "content/providers/claude-data.js", "content/providers/chatgpt-data.js"]) runtime.load(file);
const text = (text) => ({ type: "text", text });
const image = { type: "image", url: "https://example.org/generated.png" };
const artifact = { type: "tool_use", name: "artifacts", input: { title: "Diagram", type: "text/markdown", content: "# Artifact body" } };
const messages = [
  { content: [text("User code: `tool_use`\n\n```sh\necho keep-user-code\n```\n\n$x^2$")], attachments: [{ file_name: "quote.txt", extracted_content: "Quoted context" }] },
  { text: "duplicate-tool-result", content: [
    { type: "thinking", thinking: "Reasoning stays separate from tool activity." },
    { type: "tool_use", name: "Bash", input: { command: "omit-tool-command" } },
    { type: "tool_result", content: [text("omit-tool-output"), image] },
    artifact,
    text("Final answer.\n\n```js\nkeepAssistantCode();\n```")
  ] }
];

function claude(includeToolActivity, downloadImages = false) {
  const images = [];
  const converter = runtime.ns.createMarkdownConverter({ includeToolActivity, downloadImages, imageFolder: "assets", imageCollector: images });
  return { markdown: runtime.ns.claudeData.renderTurnDescriptor({ messages }, converter), images };
}
const light = claude(undefined, true);
assert.doesNotMatch(light.markdown, /omit-tool-command|omit-tool-output|Claude Activity|Claude Tool Result/);
for (const snippet of ["keep-user-code", "$x^2$", "Quoted context", "Reasoning", "Artifact body", "Final answer", "keepAssistantCode"])
  assert.ok(light.markdown.includes(snippet), snippet);
assert.equal(light.images.length, 1);
assert.match(light.markdown, /assets\/image-001/);
const linked = claude(false);
assert.match(linked.markdown, /https:\/\/example.org\/generated.png/);
assert.equal(linked.images.length, 0);
const full = claude(true, true);
assert.match(full.markdown, /omit-tool-command/);
assert.match(full.markdown, /omit-tool-output/);
assert.match(full.markdown, /Claude Tool Result/);
assert.doesNotMatch(full.markdown, /<details open/);
assert.equal(full.images.length, 1);
assert.equal(runtime.ns.claudeData.renderTurnDescriptor({ messages: [{
  text: "must-not-reintroduce-tool-output", content: [{ type: "tool_result", content: "omit-this" }]
}] }, { includeToolActivity: false }), "");

const gptMessages = [
  { author: { role: "user" }, content: { content_type: "text", parts: ["Keep prompt and $y^2$."] } },
  { author: { role: "assistant" }, recipient: "python", content: { content_type: "code", text: "omitPythonCall()", language: "python" } },
  { author: { role: "tool" }, content: { content_type: "execution_output", parts: ["omitPythonResult",
    { type: "text", text: "omitToolLink", url: "https://example.org/not-an-image" },
    { content_type: "image_asset_pointer", asset_pointer: "https://example.org/result.png" }] } },
  { author: { role: "assistant" }, content: { content_type: "reasoning_recap", parts: ["Keep reasoning."] } },
  { author: { role: "assistant" }, recipient: "all", content: { content_type: "text", parts: ["Final answer with `code`."] }, metadata: { attachments: [{ name: "notes.pdf" }] } },
  { author: { role: "assistant" }, content: { content_type: "code", text: "keepCodeExample()", language: "js" } }
];
function gpt(includeToolActivity) {
  const converter = runtime.ns.createMarkdownConverter({ includeToolActivity, downloadImages: false, imageCollector: [] });
  return runtime.ns.chatGptData.renderTurnDescriptor({ messages: gptMessages }, converter);
}
assert.doesNotMatch(gpt(false), /omitPythonCall|omitPythonResult|not-an-image|\*\*Result/);
for (const snippet of ["Keep prompt", "$y^2$", "result.png", "Keep reasoning", "Final answer", "notes.pdf", "```js\nkeepCodeExample()"])
  assert.ok(gpt(false).includes(snippet), snippet);
assert.match(gpt(true), /omitPythonCall/);
assert.match(gpt(true), /omitPythonResult/);

// Check provider DOM paths without stripping or reparsing the generated Markdown.
function loadDomProvider(provider) {
  const ns = {
    helpers: { compareDomOrder: (a, b) => a.order - b.order, normalizeTextTrim: (v) => String(v || "").trim(),
      wrapCollapsibleSection: (s, b) => `<details><summary>${s}</summary>${b}</details>`, dedupeNodes: (a) => [...new Set(a)] },
    registerProvider() {}, isLikelyContentImage: () => true
  };
  const source = fs.readFileSync(path.join(__dirname, "../content/providers", `${provider}.js`), "utf8")
    .replace("  ns.registerProvider(provider);", "  ns.createAssistantTurn = createAssistantTurn;\n  ns.registerProvider(provider);");
  vm.runInNewContext(source, { window: { ChatExporter: ns } });
  return ns;
}
const plain = { order: 3, textContent: "Ordinary answer and ```js keepCode(); ```" };
const header = { tagName: "SPAN", order: 1, getAttribute: () => "text-token-text-secondary",
  closest: () => null, querySelector: () => ({ textContent: "Analyzed with Python" }) };
const toolPre = { order: 2, textContent: "DOM tool code", closest: () => null, querySelector: () => ({}) };
const body = { tagName: "DIV", getAttribute: () => "overflow-hidden", closest: () => null,
  contains: (el) => el === toolPre, querySelector: () => toolPre,
  querySelectorAll: (s) => s === "pre" ? [toolPre] : [] };
const gptNs = loadDomProvider("chatgpt");
const container = { children: [header, body], querySelector: () => null,
  querySelectorAll: (s) => s === "pre" ? [toolPre] : [], getAttribute: () => null };
const msg = { getAttribute: (name) => name === "data-message-id" ? "message-fixture" : null, querySelector: () => plain };
const turn = gptNs.createAssistantTurn(container, [msg]);
const converter = { includeToolActivity: false, convertElement: (el) => el.textContent };
assert.equal(turn.toMarkdown(converter), plain.textContent);
assert.match(turn.toMarkdown({ ...converter, includeToolActivity: true }), /DOM tool code/);

const statusButton = { className: "group/status", textContent: "DOM execution", getAttribute: () => "false" };
const panel = { order: 1, matches: () => true, querySelector: () => statusButton,
  querySelectorAll: (s) => s === "button" ? [statusButton] : [] };
const nestedTool = { order: 2, textContent: "Nested DOM tool output", closest: () => panel };
const claudeContainer = { matches: () => false, querySelectorAll: (s) => s === ".standard-markdown" ? [plain, nestedTool]
  : s.startsWith("div.min-w-0") ? [panel] : [] };
const claudeNs = loadDomProvider("claude");
const claudeTurn = claudeNs.createAssistantTurn(claudeContainer);
assert.equal(claudeTurn.toMarkdown(converter), plain.textContent);
assert.match(claudeTurn.toMarkdown({ ...converter, includeToolActivity: true }), /DOM execution/);
assert.match(claudeTurn.toMarkdown({ ...converter, includeToolActivity: true }), /Nested DOM tool output/);

console.log("tool activity filtering tests passed");
