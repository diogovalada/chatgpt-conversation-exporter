const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "chatgpt.js"),
  "utf8"
);
const testSource = source
  .replace("      filterTurns\n    };", "      filterTurns,\n      activate,\n      state\n    };")
  .replace("  ns.registerProvider(provider);", "  ns.testSelectionController = selectionController;\n  ns.registerProvider(provider);");
assert.notEqual(testSource, source);

function element(tagName, attributes = {}, ownText = "", children = []) {
  const el = {
    tagName,
    attributes,
    children,
    parentElement: null,
    nextElementSibling: null,
    firstElementChild: children[0] || null,
    get textContent() {
      return ownText || this.children.map((child) => child.textContent).join("");
    },
    getAttribute(name) {
      return this.attributes[name] || null;
    },
    matches(selector) {
      return selector === "[data-message-author-role]" && Boolean(this.attributes["data-message-author-role"]);
    },
    querySelectorAll(selector) {
      const descendants = [];
      for (const child of this.children) {
        if (
          (selector === "h4" && child.tagName === "H4") ||
          (selector === ".whitespace-pre-wrap" && child.attributes.class === "whitespace-pre-wrap") ||
          (selector === '[class*="MarkdownRoot"]' && child.attributes.class?.includes("MarkdownRoot"))
        ) descendants.push(child);
        descendants.push(...child.querySelectorAll(selector));
      }
      return descendants;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    cloneNode() {
      return this;
    }
  };
  for (let index = 0; index < children.length; index += 1) {
    children[index].parentElement = el;
    children[index].nextElementSibling = children[index + 1] || null;
  }
  return el;
}

const userText = element("DIV", { class: "whitespace-pre-wrap" }, "Current prompt");
const userBody = element("DIV", {
  "data-chatgpt-search-unit-key": "fallback-turn-0:0:user",
  "data-chatgpt-search-message-ids": "user-id"
}, "", [userText]);
const userContainer = element("DIV", {}, "", [
  element("H4", {}, "You said:"),
  userBody
]);
userContainer.order = 0;

const assistantMarkdown = element("DIV", { class: "MarkdownRoot-example" }, "Visible answer");
const assistantBody = element("DIV", {
  "data-chatgpt-selection-message-id": "assistant-id"
}, "", [assistantMarkdown]);
const assistantContainer = element("DIV", {
  "data-chatgpt-search-unit-key": "fallback-turn-0:2:assistant"
}, "", [
  element("H4", { "data-conversation-role": "assistant" }, "ChatGPT said:"),
  assistantBody
]);
assistantContainer.order = 1;

const root = element("MAIN", {}, "", [userContainer, assistantContainer]);
const locationState = {
  href: "https://chatgpt.com/c/conversation-id",
  origin: "https://chatgpt.com"
};
let registeredProvider = null;
const ChatExporter = {
  helpers: {
    compareDomOrder(a, b) {
      return a.order - b.order;
    },
    normalizeTextTrim(value) {
      return String(value || "").trim();
    },
    wrapCollapsibleSection(_summary, body) {
      return body;
    }
  },
  isLikelyContentImage() {
    return false;
  },
  chatGptData: {
    getConversationId(url) {
      return url.match(/\/c\/([^/]+)/)?.[1] || "";
    },
    async fetchConversationPayload() {
      return { title: "Current conversation", __chatExporterCoverageComplete: true };
    },
    isActiveBranchComplete() {
      return true;
    },
    buildTurnDescriptors() {
      return [
        { id: "user:user-id", role: "user", messageIds: ["user-id"] },
        { id: "assistant:assistant-id", role: "assistant", messageIds: ["assistant-id"] }
      ];
    },
    renderTurnDescriptor(descriptor) {
      return `API ${descriptor.role}`;
    }
  },
  registerProvider(provider) {
    registeredProvider = provider;
  }
};

vm.runInNewContext(testSource, {
  window: { ChatExporter, requestAnimationFrame: () => 1 },
  document: {
    title: "Current conversation",
    body: root,
    querySelector(selector) {
      return selector === "main" ? root : null;
    }
  },
  location: locationState,
  URL,
  Set,
  Map
});

(async () => {
  assert.ok(registeredProvider?.hasConversation());

  const liveTurns = registeredProvider.getTurns();
  assert.deepEqual(Array.from(liveTurns, (turn) => turn.id), [
    "user:user-id",
    "assistant:assistant-id"
  ]);
  assert.equal(liveTurns[0].toMarkdown(), "Current prompt");
  assert.equal(liveTurns[1].toMarkdown({ convertElement: (el) => el.textContent }), "Visible answer");

  await registeredProvider.prepareForExtraction();
  const canonicalTurns = registeredProvider.getTurns();
  assert.deepEqual(Array.from(canonicalTurns, (turn) => turn.role), ["user", "assistant"]);
  assert.equal(canonicalTurns[0].toMarkdown(), "API user");
  assert.equal(canonicalTurns[1].toMarkdown(), "API assistant");
  assert.equal(canonicalTurns[1].checkboxAnchorEl, assistantMarkdown);

  const selection = ChatExporter.testSelectionController;
  selection.activate(false);
  selection.state.selectedIds.add("assistant:assistant-id");
  root.children = [userContainer];
  assert.equal(selection.getStatus("conversation-id").selectedCount, 1);

  const selected = selection.filterTurns([
    { id: "user:user-id", sourceMessageIds: ["user-id"] },
    {
      id: "assistant:analysis-id|assistant-id",
      sourceMessageIds: ["analysis-id", "assistant-id"]
    }
  ], "conversation-id");
  assert.deepEqual(Array.from(selected, (turn) => turn.id), ["assistant:analysis-id|assistant-id"]);
  assert.equal(selection.getStatus("different-conversation-id").active, false);

  locationState.href = "https://chatgpt.com/c/different-conversation-id";
  assert.equal(selection.getStatus("different-conversation-id").active, false);
  assert.equal(selection.state.selectedIds.size, 0);
  console.log("chatgpt modern DOM tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
