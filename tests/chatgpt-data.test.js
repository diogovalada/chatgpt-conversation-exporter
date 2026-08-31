const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "chatgpt-data.js"),
  "utf8"
);

const ChatExporter = {
  helpers: {
    wrapCollapsibleSection(summary, body) {
      return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`;
    }
  }
};

vm.runInNewContext(source, {
  window: { ChatExporter },
  location: {
    href: "https://chatgpt.com/c/conversation-id",
    origin: "https://chatgpt.com"
  },
  URL,
  encodeURIComponent,
  fetch: async () => {
    throw new Error("Unexpected fetch in parser test.");
  }
});

const payload = {
  title: "Canonical title",
  current_node: "assistant-2-final",
  mapping: {
    root: { id: "root", parent: null, message: null },
    system: {
      id: "system",
      parent: "root",
      message: { id: "system-message", author: { role: "system" }, content: { content_type: "text", parts: ["hidden"] } }
    },
    user1: {
      id: "user1",
      parent: "system",
      message: {
        id: "user-message-1",
        author: { role: "user" },
        content: {
          content_type: "multimodal_text",
          parts: [
            "Question with $x^2$.",
            { content_type: "image_asset_pointer", asset_pointer: "file-service://image-1", alt_text: "Input" }
          ]
        },
        metadata: { turn_id: "turn-user-1", attachments: [{ name: "notes.pdf" }] }
      }
    },
    assistant1a: {
      id: "assistant1a",
      parent: "user1",
      message: {
        id: "assistant-message-1a",
        author: { role: "assistant" },
        content: { content_type: "reasoning_recap", parts: ["Checked the equation."] },
        metadata: { turn_id: "turn-assistant-1" }
      }
    },
    tool1: {
      id: "tool1",
      parent: "assistant1a",
      message: {
        id: "tool-message-1",
        author: { role: "tool" },
        content: { content_type: "execution_output", text: "4" },
        metadata: { turn_id: "turn-assistant-1" }
      }
    },
    assistant1b: {
      id: "assistant1b",
      parent: "tool1",
      message: {
        id: "assistant-message-1b",
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["Final answer: **4**."] },
        metadata: { turn_id: "turn-assistant-1" }
      }
    },
    abandonedBranch: {
      id: "abandonedBranch",
      parent: "user1",
      message: {
        id: "abandoned-message",
        author: { role: "assistant" },
        content: { content_type: "text", parts: ["Do not export this branch."] }
      }
    },
    user2: {
      id: "user2",
      parent: "assistant1b",
      message: {
        id: "user-message-2",
        author: { role: "user" },
        content: { content_type: "text", parts: ["Show code."] },
        metadata: { turn_id: "turn-user-2" }
      }
    },
    "assistant-2-final": {
      id: "assistant-2-final",
      parent: "user2",
      message: {
        id: "assistant-message-2",
        author: { role: "assistant" },
        content: { content_type: "code", language: "js", text: "console.log(4);" },
        metadata: { turn_id: "turn-assistant-2" }
      }
    }
  }
};

const turns = ChatExporter.chatGptData.buildTurnDescriptors(payload);
assert.equal(ChatExporter.chatGptData.isActiveBranchComplete(payload), true);
assert.equal(turns.length, 4);
assert.deepEqual(Array.from(turns, (turn) => turn.role), ["user", "assistant", "user", "assistant"]);
assert.deepEqual(Array.from(turns[1].messageIds), ["assistant-message-1a", "assistant-message-1b"]);
assert.equal(turns[1].messages.length, 3);
assert.ok(!turns.some((turn) => turn.messageIds.includes("abandoned-message")));

const converter = {
  convertImage({ url, alt }) {
    return `![${alt}](<${url}>)`;
  }
};

const userMarkdown = ChatExporter.chatGptData.renderTurnDescriptor(turns[0], converter);
assert.match(userMarkdown, /Question with \$x\^2\$\./);
assert.match(userMarkdown, /backend-api\/estuary\/content\?id=image-1/);
assert.match(userMarkdown, /\*\*Attachment:\*\* notes\.pdf/);

const assistantMarkdown = ChatExporter.chatGptData.renderTurnDescriptor(turns[1], converter);
assert.match(assistantMarkdown, /<summary>Reasoning<\/summary>/);
assert.match(assistantMarkdown, /\*\*Result:\*\*[\s\S]*```text[\s\S]*4/);
assert.match(assistantMarkdown, /Final answer: \*\*4\*\*\./);

const codeMarkdown = ChatExporter.chatGptData.renderTurnDescriptor(turns[3], converter);
assert.equal(codeMarkdown, "```js\nconsole.log(4);\n```");

assert.equal(
  ChatExporter.chatGptData.getConversationId("https://chatgpt.com/g/project/c/abc-123?messageId=x"),
  "abc-123"
);

const partialPayload = {
  ...payload,
  mapping: { ...payload.mapping }
};
delete partialPayload.mapping.system;
assert.equal(ChatExporter.chatGptData.isActiveBranchComplete(partialPayload), false);

console.log("chatgpt-data tests passed");
