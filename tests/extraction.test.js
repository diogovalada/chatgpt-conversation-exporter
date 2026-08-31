const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "extraction.js"),
  "utf8"
);

let prepared = false;
const requestedUrl = "https://chatgpt.com/g/project/c/remote-conversation";
const provider = {
  id: "test",
  name: "Test Provider",
  async prepareForExtraction(options) {
    assert.equal(options.conversationUrl, requestedUrl);
    await Promise.resolve();
    prepared = true;
  },
  hasConversation(options) {
    assert.equal(options.conversationUrl, requestedUrl);
    return prepared;
  },
  getTitle(options) {
    assert.equal(options.conversationUrl, requestedUrl);
    assert.equal(prepared, true);
    return "Prepared title";
  },
  getTurns(options) {
    assert.equal(options.conversationUrl, requestedUrl);
    assert.equal(prepared, true);
    return [{ role: "assistant", toMarkdown: () => "Complete reply" }];
  }
};

const ChatExporter = {
  helpers: {
    sanitizeFilenamePart(value) {
      return String(value).trim();
    },
    titleCaseRole(value) {
      return String(value);
    }
  },
  getActiveProvider() {
    return provider;
  },
  createMarkdownConverter() {
    return {};
  }
};

vm.runInNewContext(source, {
  window: { ChatExporter },
  document: { title: "Unprepared document title" }
});

(async () => {
  const result = await ChatExporter.extractConversation({
    conversationUrl: requestedUrl,
    downloadImages: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.title, "Prepared title");
  assert.equal(result.filename, "Prepared title.md");
  assert.match(result.markdown, /^# Prepared title\n\n## Assistant\n\nComplete reply\n$/);
  console.log("extraction tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
