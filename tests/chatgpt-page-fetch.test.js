const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "providers", "chatgpt-page-fetch.js"),
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
    location: { href: "https://chatgpt.com/c/conversation-id", origin: "https://chatgpt.com" },
    window,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/api/auth/session")) {
        return response(200, { accessToken: "live-token" });
      }
      return response(200, { mapping: {}, current_node: "message-id" });
    }
  });

  vm.runInContext(source, context);
  assert.equal(typeof messageListener, "function");

  messageListener({
    source: window,
    data: {
      type: "CHAT_EXPORTER_PAGE_FETCH_REQUEST",
      requestId: "request-id",
      url: "https://chatgpt.com/backend-api/conversation/conversation-id"
    }
  });
  await flushAsyncWork();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://chatgpt.com/api/auth/session");
  assert.equal(requests[1].url, "https://chatgpt.com/backend-api/conversation/conversation-id");
  assert.equal(requests[1].options.headers.authorization, "Bearer live-token");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ok, true);
  assert.equal(posted[0].requestId, "request-id");

  console.log("chatgpt-page-fetch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
