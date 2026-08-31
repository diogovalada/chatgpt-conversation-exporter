const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "chatgpt.js"),
  "utf8"
);

const root = {
  querySelectorAll() {
    return [];
  }
};
let registeredProvider = null;
const ChatExporter = {
  helpers: {
    compareDomOrder() {
      return 0;
    },
    normalizeTextTrim(value) {
      return String(value || "").trim();
    },
    wrapCollapsibleSection(_summary, body) {
      return body;
    }
  },
  chatGptData: {
    getConversationId() {
      return "conversation-id";
    },
    async fetchConversationPayload() {
      return {
        title: "Complete conversation",
        current_node: "assistant-1",
        mapping: {},
        __chatExporterCoverageComplete: true
      };
    },
    isActiveBranchComplete() {
      return true;
    },
    buildTurnDescriptors() {
      return [
        {
          id: "user:user-1",
          role: "user",
          turnKey: "turn-user-1",
          messageIds: ["user-1"],
          messages: []
        },
        {
          id: "assistant:assistant-1",
          role: "assistant",
          turnKey: "turn-assistant-1",
          messageIds: ["assistant-1"],
          messages: []
        }
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
    body: root,
    querySelector() {
      return root;
    }
  },
  location: {
    href: "https://chatgpt.com/c/conversation-id",
    origin: "https://chatgpt.com"
  },
  URL,
  Set,
  Map
});

(async () => {
  assert.ok(registeredProvider);
  await registeredProvider.prepareForExtraction({
    conversationUrl: "https://chatgpt.com/c/conversation-id"
  });

  assert.equal(registeredProvider.hasConversation(), true);
  assert.equal(registeredProvider.getTitle(), "Complete conversation");
  assert.deepEqual(
    Array.from(registeredProvider.getTurns(), (turn) => turn.role),
    ["user", "assistant"]
  );
  console.log("chatgpt provider fast-path tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
