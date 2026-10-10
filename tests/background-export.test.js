const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createClaudeContext = require("./helpers/claude-context.js");

(async () => {
  const vendor = fs.readFileSync(path.join(__dirname, "../vendor/fflate.browser.esm.js"), "utf8");
  const { zipSync, strToU8, unzipSync, strFromU8 } = await import(`data:text/javascript;base64,${Buffer.from(vendor).toString("base64")}`);
  const runtime = createClaudeContext({ location: { href: "https://claude.ai/chat/12345678-1234-1234-1234-123456789012", origin: "https://claude.ai" } });
  runtime.load("content/markdown-converter.js");
  runtime.load("content/providers/claude-data.js");
  runtime.load("content/extraction.js");
  const descriptor = { messages: [{ content: [
    { type: "text", text: "Ordinary reply with `code`." },
    { type: "tool_use", name: "Bash", input: { command: "tool-command" } },
    { type: "tool_result", content: [
      { type: "text", text: "tool-output" },
      { type: "image", url: "https://example.org/image.png" }
    ] }
  ] }] };
  runtime.ns.getActiveProvider = () => ({ id: "fixture", name: "Fixture", hasConversation: () => true,
    getTitle: () => "Export fixture", getTurns: () => [{ role: "assistant",
      toMarkdown: (converter) => runtime.ns.claudeData.renderTurnDescriptor(descriptor, converter) }] });

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=", "base64");
  const downloads = [];
  const extracted = [];
  const created = [];
  const removed = [];
  let handler;
  const context = vm.createContext({
    URL: class extends URL { static createObjectURL = undefined; },
    Uint8Array, zipSync, strToU8, setTimeout, console,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => Uint8Array.from(png).buffer }),
    chrome: {
      downloads: { async download(options) { downloads.push(options); } },
      tabs: {
        async query() { return [{ id: 1 }]; },
        async get() { return { url: "https://chatgpt.com/g/project/project" }; },
        async create(options) { created.push(options); return { id: 2 }; },
        async remove(id) { removed.push(id); },
        async sendMessage(id, message) {
          if (message.type === "PING") return { ok: true };
          extracted.push({ id, options: message.options });
          return runtime.ns.extractConversation(message.options);
        }
      },
      runtime: { onMessage: { addListener(fn) { handler = fn; } } }
    }
  });
  const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8").replace(/^import[^;]+;\s*/, "");
  vm.runInContext(background, context);
  const send = (message) => new Promise((resolve) => handler(message, { tab: { id: 1 } }, resolve));
  const chatUrl = "https://chatgpt.com/g/project/c/12345678-1234-1234-1234-123456789012";
  const claudeUrl = "https://claude.ai/chat/12345678-1234-1234-1234-123456789012";
  function verify(markdown, includeToolActivity) {
    assert.match(markdown, /Ordinary reply with `code`/);
    if (includeToolActivity) assert.match(markdown, /tool-command[\s\S]*tool-output/);
    else assert.doesNotMatch(markdown, /tool-command|tool-output|Claude Activity|Claude Tool Result/);
  }
  for (const includeToolActivity of [false, true]) {
    for (const message of [
      { type: "GET_MARKDOWN" },
      { type: "GET_MARKDOWN_BY_URL", url: chatUrl },
      { type: "GET_MARKDOWN_BY_URL", url: claudeUrl }
    ]) {
      const result = await send({ ...message, includeToolActivity });
      assert.equal(result.ok, true, result.error);
      assert.equal(extracted.at(-1).options.includeToolActivity, includeToolActivity);
      assert.equal(extracted.at(-1).options.downloadImages, false);
      verify(result.markdown, includeToolActivity);
    }
    for (const downloadImages of [false, true]) {
      for (const message of [
        { type: "EXPORT_CONVERSATION", saveAs: false },
        { type: "EXPORT_CONVERSATION_BY_URL", url: chatUrl, saveAs: true },
        { type: "EXPORT_CONVERSATION_BY_URL", url: claudeUrl, saveAs: true }
      ]) {
        const result = await send({ ...message, title: "Export fixture", downloadImages, includeToolActivity });
        assert.equal(result.ok, true, result.error);
        assert.equal(extracted.at(-1).options.includeToolActivity, includeToolActivity);
        const download = downloads.at(-1);
        assert.equal(download.saveAs, message.saveAs);
        if (downloadImages) {
          assert.equal(result.bundled, "zip");
          assert.match(download.filename, /\.zip$/);
          const entries = unzipSync(Buffer.from(download.url.split(",")[1], "base64"));
          const asset = "Export fixture-assets/image-001.png";
          assert.deepEqual(Object.keys(entries).sort(), [asset, "Export fixture.md"].sort());
          assert.deepEqual(Buffer.from(entries[asset]), png);
          const markdown = strFromU8(entries["Export fixture.md"]);
          verify(markdown, includeToolActivity);
          assert.match(markdown, /Export%20fixture-assets\/image-001\.png/);
        } else {
          assert.equal(result.bundled, "md");
          assert.match(download.filename, /\.md$/);
          const markdown = decodeURIComponent(download.url.split(",")[1]);
          verify(markdown, includeToolActivity);
          assert.match(markdown, /https:\/\/example.org\/image.png/);
        }
      }
    }
  }
  assert.equal(created.length, removed.length, "temporary Claude tabs are always closed");
  assert.ok(created.every((tab) => tab.active === false));
  console.log("background export routes and ZIP tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
