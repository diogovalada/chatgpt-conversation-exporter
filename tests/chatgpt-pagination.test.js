const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "chatgpt-data.js"),
  "utf8"
);

function message(id, role, text) {
  return {
    id,
    author: { role },
    content: { content_type: "text", parts: [text] },
    metadata: { turn_id: `turn-${id}` }
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function linearPayload(conversationId, messages, extra = {}) {
  const rootId = `root-${conversationId}`;
  const mapping = {
    [rootId]: { id: rootId, parent: null, children: [] }
  };
  let parentId = rootId;

  for (const item of messages) {
    mapping[item.id] = { id: item.id, parent: parentId, children: [], message: item };
    mapping[parentId].children.push(item.id);
    parentId = item.id;
  }

  return {
    conversation_id: conversationId,
    current_node: parentId,
    mapping,
    ...extra
  };
}

function loadParser(fetch) {
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
    fetch
  });

  return ChatExporter.chatGptData;
}

async function testLoadsEveryHistoryPage() {
  const requests = [];
  const parser = loadParser(async (url) => {
    requests.push(url);
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/messages")) {
      assert.equal(parsed.searchParams.get("before"), "older-page");
      return response({
        messages: [
          message("user-1", "user", "Opening prompt"),
          message("assistant-1", "assistant", "Opening answer"),
          message("user-2", "user", "Second prompt")
        ],
        page_info: { has_previous_page: false, start_cursor: null }
      });
    }

    return response({
      title: "Complete conversation",
      current_node: "assistant-2",
      messages: [
        message("user-2", "user", "Second prompt"),
        message("assistant-2", "assistant", "Second answer")
      ],
      page_info: { has_previous_page: true, start_cursor: "older-page" }
    });
  });

  const payload = await parser.fetchConversationPayload();
  const turns = parser.buildTurnDescriptors(payload);

  assert.equal(requests.length, 2);
  assert.equal(payload.__chatExporterPagination.pageCount, 2);
  assert.equal(payload.__chatExporterPagination.messageCount, 4);
  assert.equal(payload.__chatExporterCoverageComplete, true);
  assert.equal(parser.isActiveBranchComplete(payload), true);
  assert.deepEqual(Array.from(turns, (turn) => turn.role), [
    "user",
    "assistant",
    "user",
    "assistant"
  ]);
  assert.equal(turns[0].messages[0].content.parts[0], "Opening prompt");
  assert.equal(turns[3].messages[0].content.parts[0], "Second answer");
}

async function testRejectsCursorLoops() {
  let requestCount = 0;
  const parser = loadParser(async (url) => {
    requestCount += 1;
    const parsed = new URL(url);

    if (parsed.pathname.includes("/conversation/")) {
      return response({ mapping: {}, current_node: "missing" });
    }

    return response({
      current_node: "assistant-2",
      messages: [message("assistant-2", "assistant", "Second answer")],
      page_info: { has_previous_page: true, start_cursor: "same-cursor" }
    });
  });

  await assert.rejects(
    parser.fetchConversationPayload(),
    /pagination cursor did not advance/i
  );
  assert.equal(requestCount, 4);
}

async function testStitchesContextContinuation() {
  const requests = [];
  const sourceMessages = [
    message("user-1", "user", "True opening prompt"),
    message("assistant-1", "assistant", "First answer"),
    message("user-2", "user", "Second prompt"),
    message("assistant-2", "assistant", "Second answer"),
    message("user-3", "user", "Third prompt"),
    message("assistant-3", "assistant", "Boundary answer")
  ];
  const continuationMessages = [
    message("user-4", "user", "Visible continuation prompt"),
    message("assistant-4", "assistant", "Continuation answer")
  ];

  const parser = loadParser(async (url) => {
    requests.push(url);
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/source-id")) {
      return response(linearPayload("source-id", sourceMessages));
    }

    return response(linearPayload("conversation-id", continuationMessages, {
      context_truncation_continuation: {
        source_conversation_id: "source-id",
        boundary_message_id: "assistant-3",
        visible_from_message_id: "user-4"
      }
    }));
  });

  const payload = await parser.fetchConversationPayload();
  const turns = parser.buildTurnDescriptors(payload);

  assert.equal(requests.length, 4);
  assert.equal(payload.__chatExporterContinuation.sourceConversationId, "source-id");
  assert.equal(payload.__chatExporterCoverageComplete, false);
  assert.deepEqual(Array.from(turns, (turn) => turn.role), [
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant"
  ]);
  assert.equal(turns[0].messages[0].content.parts[0], "True opening prompt");
  assert.equal(turns.at(-1).messages[0].content.parts[0], "Continuation answer");
}

async function testUsesPaginatedConversationWithoutLegacyRequest() {
  const requests = [];
  const completeMessages = [
    message("user-1", "user", "True opening prompt"),
    message("assistant-1", "assistant", "Opening answer"),
    message("user-2", "user", "Middle prompt"),
    message("assistant-2", "assistant", "Middle answer"),
    message("user-3", "user", "Late prompt"),
    message("assistant-3", "assistant", "Late answer")
  ];

  const parser = loadParser(async (url) => {
    requests.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/backend-api/conversations/conversation-id");

    return response({
      title: "Complete conversation",
      current_node: "assistant-3",
      messages: completeMessages,
      page_info: { has_previous_page: false, start_cursor: null }
    });
  });

  const payload = await parser.fetchConversationPayload();
  const turns = parser.buildTurnDescriptors(payload);

  assert.equal(turns.length, 6);
  assert.equal(requests.length, 1);
  assert.equal(payload.__chatExporterCoverageComplete, true);
  assert.equal(turns[0].messages[0].content.parts[0], "True opening prompt");
  assert.equal(turns.at(-1).messages[0].content.parts[0], "Late answer");
}

(async () => {
  await testLoadsEveryHistoryPage();
  await testRejectsCursorLoops();
  await testStitchesContextContinuation();
  await testUsesPaginatedConversationWithoutLegacyRequest();
  console.log("chatgpt-pagination tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
