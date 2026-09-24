const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "claude-page-fetch.js"),
  "utf8"
);

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const requests = [];
  const posted = [];
  let messageListener = null;
  const window = {
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    postMessage(message) {
      posted.push(message);
    }
  };
  window.window = window;

  const context = vm.createContext({
    URL,
    console,
    location: { href: "https://claude.ai/chat/0dbdd9a5-0fde-4ece-97b2-478b38db0ea8", origin: "https://claude.ai" },
    window,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return response(200, { chat_messages: [] });
    }
  });

  vm.runInContext(source, context);
  assert.equal(typeof messageListener, "function");

  messageListener({
    source: window,
    data: {
      type: "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST",
      requestId: "request-id",
      url: "https://claude.ai/api/organizations/11111111-1111-4111-8111-111111111111/chat_conversations/0dbdd9a5-0fde-4ece-97b2-478b38db0ea8?tree=true&rendering_mode=messages&render_all_tools=true&consistency=strong"
    }
  });
  await flushAsyncWork();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ok, true);
  assert.equal(posted[0].requestId, "request-id");

  messageListener({
    source: window,
    data: {
      type: "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST",
      requestId: "rejected-request",
      url: "https://example.com/api/organizations"
    }
  });
  await flushAsyncWork();

  assert.equal(requests.length, 1);
  assert.equal(posted.at(-1).ok, false);

  console.log("claude-page-fetch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
