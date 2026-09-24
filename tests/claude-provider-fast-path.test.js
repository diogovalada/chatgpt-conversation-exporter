const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "claude.js"),
  "utf8"
);

const conversationId = "0dbdd9a5-0fde-4ece-97b2-478b38db0ea8";
let registeredProvider = null;
let payloadFetchCount = 0;

const ChatExporter = {
  helpers: {
    compareDomOrder() {
      return 0;
    },
    dedupeNodes(nodes) {
      return nodes;
    },
    findDescendantsByClassToken() {
      return [];
    },
    isElement() {
      return true;
    },
    normalizeTextTrim(value) {
      return String(value || "").trim();
    },
    wrapCollapsibleSection(_summary, body) {
      return body;
    }
  },
  claudeData: {
    getConversationId() {
      return conversationId;
    },
    async fetchConversationPayload() {
      payloadFetchCount += 1;
      return {
        name: "Complete Claude conversation",
        chat_messages: [{ uuid: "user-1" }, { uuid: "assistant-1" }]
      };
    },
    buildTurnDescriptors() {
      return [
        { id: "user:user-1", role: "user", messageIds: ["user-1"], messages: [] },
        { id: "assistant:assistant-1", role: "assistant", messageIds: ["assistant-1"], messages: [] }
      ];
    },
    renderTurnDescriptor(descriptor) {
      return descriptor.role;
    }
  },
  registerProvider(provider) {
    registeredProvider = provider;
  }
};

vm.runInNewContext(source, {
  window: { ChatExporter },
  document: {
    title: "Document title",
    querySelector() {
      throw new Error("The API fast path must not inspect the DOM.");
    },
    querySelectorAll() {
      throw new Error("The API fast path must not inspect the DOM.");
    }
  },
  location: {
    href: `https://claude.ai/chat/${conversationId}`,
    origin: "https://claude.ai"
  },
  URL,
  Set,
  Map
});

(async () => {
  assert.ok(registeredProvider);
  await registeredProvider.prepareForExtraction({
    conversationUrl: `https://claude.ai/chat/${conversationId}`
  });

  assert.equal(payloadFetchCount, 1);
  assert.equal(registeredProvider.hasConversation(), true);
  assert.equal(registeredProvider.getTitle(), "Complete Claude conversation");
  assert.deepEqual(
    Array.from(registeredProvider.getTurns(), (turn) => turn.role),
    ["user", "assistant"]
  );
  console.log("claude provider fast-path tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
