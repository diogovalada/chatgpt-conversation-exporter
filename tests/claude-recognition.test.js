const assert = require("node:assert/strict");
const createClaudeContext = require("./helpers/claude-context.js");

const id = "ebe07842-e94e-49f4-afda-1f1037544b93";
const location = { href: `https://claude.ai/chat/${id}`, origin: "https://claude.ai" };

function loadProvider(runtime) {
  for (const file of [
    "content/provider-registry.js", "content/providers/claude-data.js", "content/providers/claude.js"
  ]) runtime.load(file);
}

function message({ tag = "DIV", role = "article", label, index, total, sender, body }) {
  const attributes = { role, "aria-label": label, "aria-posinset": index, "aria-setsize": total };
  const heading = { textContent: sender === "user" ? "You said: prompt" : "Claude responded: answer" };
  const markdown = { textContent: body };
  return {
    tagName: tag, textContent: body,
    getAttribute(name) { return attributes[name] ?? null; },
    querySelector(selector) {
      if (selector === "h2") return heading;
      if (selector === ".standard-markdown" && sender === "assistant") return markdown;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".standard-markdown" && sender === "assistant") return [markdown];
      return [];
    },
    cloneNode() { return message({ tag, role, label, index, total, sender, body }); }
  };
}

function domRuntime(articles) {
  const feed = {
    parentElement: null,
    querySelectorAll(selector) {
      if (selector === 'article, [role="article"]') {
        return articles.filter((m) => m.tagName === "ARTICLE" || m.getAttribute("role") === "article");
      }
      if (selector === "article") return articles.filter((m) => m.tagName === "ARTICLE");
      return [];
    }
  };
  const runtime = createClaudeContext({
    location: { ...location },
    document: {
      title: "DOM fallback",
      querySelector(selector) { return selector.startsWith('[role="feed"]') ? feed : null; },
      querySelectorAll() { return []; }
    },
    fetch() { throw new Error("The mocked API is unavailable."); }
  });
  runtime.ns.helpers.findDescendantsByClassToken = () => [];
  loadProvider(runtime);
  runtime.ns.claudeData.fetchConversationPayload = async () => { throw new Error("API unavailable"); };
  return runtime;
}

(async () => {
  let contentMessageListener;
  let requests = 0;
  const runtime = createClaudeContext({
    location: { ...location },
    document: {
      title: "Loading...",
      documentElement: { dataset: { chatExporterClaudeSidebarInit: "1" } },
      querySelector() { throw new Error("Recognition/API export must work before messages mount."); },
      querySelectorAll() { throw new Error("Recognition/API export must work before messages mount."); }
    },
    fetch: async (url) => {
      requests += 1;
      return { ok: true, status: 200, json: async () => String(url).endsWith("/api/organizations")
        ? [{ uuid: "11111111-1111-4111-8111-111111111111" }]
        : { name: "Recognized chat", chat_messages: [
          { uuid: "user", sender: "human", content: [{ type: "text", text: "Opening prompt" }] },
          { uuid: "answer", sender: "assistant", content: [{ type: "text", text: "Complete answer" }] }
        ] }
      };
    }
  });
  loadProvider(runtime);
  runtime.load("content/markdown-converter.js");
  runtime.load("content/extraction.js");
  runtime.context.chrome = { runtime: { onMessage: {
    addListener(listener) { contentMessageListener = listener; }
  } } };
  runtime.load("content/content_main.js");
  let ping;
  contentMessageListener({ type: "PING" }, {}, (result) => { ping = result; });
  assert.equal(ping.ok, true);
  assert.equal(ping.providerId, "claude");
  assert.equal(requests, 0, "recognition does not fetch the transcript");
  const extraction = await runtime.ns.extractConversation();
  assert.equal(extraction.ok, true);
  assert.match(extraction.markdown, /Opening prompt/);
  assert.match(extraction.markdown, /Complete answer/);
  assert.equal(requests, 2);
  assert.equal(runtime.ns.claudeData.getConversationId(`${location.href}/?test=1`), id);
  for (const url of [
    "https://claude.ai/new", "https://claude.ai/code/session_Test123",
    `https://example.org/chat/${id}`, `${location.href}/extra`
  ]) assert.equal(runtime.ns.claudeData.getConversationId(url), "");

  // Current Claude renders DIV role=article with independent ARIA positions.
  const modern = domRuntime([
    message({ label: "Message 1", index: "1", total: "2", sender: "user", body: "Modern prompt" }),
    message({ label: "Message 2", index: "2", total: "2", sender: "assistant", body: "Modern answer" })
  ]);
  const provider = modern.ns.getActiveProvider();
  await provider.prepareForExtraction();
  assert.deepEqual(Array.from(provider.getTurns(), (t) => t.role), ["user", "assistant"]);
  assert.deepEqual(Array.from(provider.getTurns(), (t) => t.toMarkdown({ convertElement: (e) => e.textContent })),
    ["Modern prompt", "Modern answer"]);

  // Legacy native articles still work from their Message N of M labels.
  const legacy = domRuntime([
    message({ tag: "ARTICLE", role: null, label: "Message 1 of 2", sender: "user", body: "Old prompt" }),
    message({ tag: "ARTICLE", role: null, label: "Message 2 of 2", sender: "assistant", body: "Old answer" })
  ]);
  await legacy.ns.getActiveProvider().prepareForExtraction();
  assert.equal(legacy.ns.getActiveProvider().getTurns().length, 2);

  // Recognizing the route must not bypass the DOM fallback's completeness check.
  const missing = domRuntime([
    message({ label: "Message 1", index: "1", total: "3", sender: "user", body: "Opening" }),
    message({ label: "Message 3", index: "3", total: "3", sender: "assistant", body: "Tail" })
  ]);
  await assert.rejects(missing.ns.getActiveProvider().prepareForExtraction(), /message indexes: 2/);
  console.log("claude recognition and modern DOM tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
