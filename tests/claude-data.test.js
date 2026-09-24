const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "claude-data.js"),
  "utf8"
);

function wrapCollapsibleSection(summary, body) {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

(async () => {
  const requests = [];
  const ChatExporter = {
    helpers: {
      normalizeTextTrim(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      },
      wrapCollapsibleSection
    }
  };

  const payload = {
    uuid: "0dbdd9a5-0fde-4ece-97b2-478b38db0ea8",
    name: "Canonical Claude title",
    current_leaf_message_uuid: "assistant-2",
    chat_messages: [
      {
        uuid: "user-1",
        parent_message_uuid: "00000000-0000-0000-0000-000000000000",
        sender: "human",
        index: 1,
        content: [{
          type: "text",
          text: "Okay, so apparently, okay, there is AppArmor and SE-Linux."
        }],
        attachments: [{ file_name: "notes.txt", extracted_content: "attachment body" }],
        files: [{ file_name: "diagram.png", file_kind: "image", preview_url: "/preview/diagram.png" }]
      },
      {
        uuid: "assistant-1",
        parent_message_uuid: "user-1",
        sender: "assistant",
        index: 2,
        content: [
          { type: "thinking", thinking: "Checked the security model." },
          { type: "text", text: "AppArmor is path-oriented." },
          { type: "tool_use", id: "tool-1", name: "bash_tool", input: { command: "aa-status" } }
        ]
      },
      {
        uuid: "abandoned-assistant",
        parent_message_uuid: "user-1",
        sender: "assistant",
        index: 3,
        content: [{ type: "text", text: "Do not export this abandoned branch." }]
      },
      {
        uuid: "tool-result-1",
        parent_message_uuid: "assistant-1",
        sender: "human",
        index: 4,
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: [{ text: "profiles are loaded" }] }]
      },
      {
        uuid: "user-2",
        parent_message_uuid: "tool-result-1",
        sender: "human",
        index: 5,
        content: [{ type: "text", text: "What about generated executables?" }]
      },
      {
        uuid: "assistant-2",
        parent_message_uuid: "user-2",
        sender: "assistant",
        index: 6,
        content: [{
          type: "tool_use",
          name: "artifacts",
          input: { title: "Example", type: "text/markdown", content: "# Artifact body" }
        }, { type: "text", text: "Use labels in addition to paths." }]
      }
    ]
  };

  const context = vm.createContext({
    URL,
    console,
    encodeURIComponent,
    location: {
      href: "https://claude.ai/chat/0dbdd9a5-0fde-4ece-97b2-478b38db0ea8",
      origin: "https://claude.ai"
    },
    window: { ChatExporter },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/api/organizations")) {
        return response(200, [
          { uuid: "11111111-1111-4111-8111-111111111111" },
          { uuid: "22222222-2222-4222-8222-222222222222" }
        ]);
      }
      if (String(url).includes("/11111111-1111-4111-8111-111111111111/")) {
        return response(404, { error: "not found" });
      }
      return response(200, payload);
    }
  });

  vm.runInContext(source, context);
  const data = ChatExporter.claudeData;
  const turns = data.buildTurnDescriptors(payload);

  assert.equal(turns.length, 4);
  assert.deepEqual(Array.from(turns, (turn) => turn.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(turns[1].messages.length, 2);
  assert.ok(!turns.some((turn) => turn.messageIds.includes("abandoned-assistant")));

  const converter = {
    convertImage({ url, alt }) {
      return `![${alt}](<${url}>)`;
    }
  };
  const firstPrompt = data.renderTurnDescriptor(turns[0], converter);
  assert.match(firstPrompt, /AppArmor and SE-Linux/);
  assert.match(firstPrompt, /<summary>Attachment: notes\.txt<\/summary>/);
  assert.match(firstPrompt, /diagram\.png/);

  const firstAnswer = data.renderTurnDescriptor(turns[1], converter);
  assert.match(firstAnswer, /<summary>Reasoning<\/summary>/);
  assert.match(firstAnswer, /<summary>Claude Activity: bash_tool<\/summary>/);
  assert.match(firstAnswer, /profiles are loaded/);

  const lastAnswer = data.renderTurnDescriptor(turns.at(-1), converter);
  assert.match(lastAnswer, /<summary>Claude Artifact: Example<\/summary>/);
  assert.doesNotMatch(lastAnswer, /abandoned branch/);

  const fetched = await data.fetchConversationPayload();
  assert.equal(fetched.uuid, "0dbdd9a5-0fde-4ece-97b2-478b38db0ea8");
  assert.equal(requests.length, 3);
  assert.match(requests[2].url, /tree=true/);
  assert.match(requests[2].url, /render_all_tools=true/);
  assert.match(requests[2].url, /consistency=strong/);

  console.log("claude-data tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
