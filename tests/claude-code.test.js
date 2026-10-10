const assert = require("node:assert/strict");
const createClaudeContext = require("./helpers/claude-context.js");

const id = "session_Test123";
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const location = { href: `https://claude.ai/code/${id}`, origin: "https://claude.ai" };
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } };
const text = (text) => ({ type: "text", text });
function event(n, type, content, extra = {}) {
  return {
    event_id: `ev-${n}`, sequence_num: n,
    payload: { type, uuid: `msg-${n}`, message: { id: `api-${n}`, content }, ...extra }
  };
}

function setup({ pages, session = { session: { id, title: "Code test" } }, failPage, organizations = [org], denyFirst = false } = {}) {
  const requests = [];
  let page = 0;
  const runtime = createClaudeContext({
    location: { ...location },
    document: {
      title: "Wrong document title",
      querySelectorAll() { throw new Error("Code API export must not inspect or scroll the DOM."); },
      querySelector() { throw new Error("Code API export must not inspect or scroll the DOM."); }
    },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      requests.push({ url: parsed, options });
      let payload;
      let status = 200;
      if (parsed.pathname === "/api/organizations") payload = organizations.map((uuid) => ({ uuid }));
      else if (denyFirst && options.headers["x-organization-uuid"] === org) status = 404;
      else if (parsed.pathname.endsWith("/events")) {
        if (page === failPage) status = 503;
        payload = typeof pages === "function" ? pages(page++) : pages[page++];
      } else payload = session;
      return { ok: status === 200, status, json: async () => payload };
    }
  });
  for (const file of [
    "content/provider-registry.js", "content/markdown-converter.js", "content/extraction.js",
    "content/providers/claude-data.js", "content/providers/claude.js",
    "content/providers/claude-code-data.js", "content/providers/claude-code.js"
  ]) runtime.load(file);
  return { ...runtime, requests };
}

(async () => {
  const first = event(1, "user", [text("First prompt\n\nwith paragraphs"), image]);
  const call = event(2, "assistant", [text("Running a check."), {
    type: "tool_use", id: "tool-1", name: "Bash", input: { command: "printf '```'" }
  }]);
  const output = event(3, "user", [{ type: "tool_result", tool_use_id: "tool-1", content: [text("command output"), image] }]);
  const last = event(4, "assistant", [text("Final answer: $x^2$.\n\n```js\nconst a = 1;\n```")]);
  const runtime = setup({
    organizations: [org, otherOrg], denyFirst: true,
    session: { response_shape: { id, title: "Code test" } },
    pages: [
      { data: [first, call], next_cursor: "cursor+/one?" },
      { data: [call, output], next_cursor: "cursor two" },
      { data: [last], next_cursor: null }
    ]
  });
  assert.equal(runtime.ns.getActiveProvider().id, "claude-code");
  assert.equal(runtime.ns.getActiveProvider().hasConversation(), true);
  const result = await runtime.ns.extractConversation({ downloadImages: true, includeToolActivity: true });
  assert.equal(result.providerId, "claude-code");
  assert.equal(result.filename, "Code test.md");
  assert.equal((result.markdown.match(/^## User$/gm) || []).length, 1);
  assert.equal((result.markdown.match(/^## Assistant$/gm) || []).length, 1);
  for (const snippet of ["First prompt", "Running a check", "command output", "Final answer", "$x^2$", "const a = 1;"]) {
    assert.ok(result.markdown.includes(snippet), snippet);
  }
  assert.equal((result.markdown.match(/Running a check/g) || []).length, 1);
  assert.match(result.markdown, /<details>\n<summary>Claude Activity: Bash<\/summary>/);
  assert.doesNotMatch(result.markdown, /<details open/);
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].url, "data:image/png;base64,aGVsbG8=");
  assert.match(result.markdown, /Code%20test-assets\/image-001/);
  const pageRequests = runtime.requests.filter((r) => r.url.pathname.endsWith("/events"));
  assert.equal(pageRequests.length, 3);
  assert.equal(pageRequests[1].url.searchParams.get("cursor"), "cursor+/one?");
  for (const { url, options } of pageRequests) {
    assert.equal(url.searchParams.get("sort_order"), "asc");
    assert.equal(options.credentials, "include");
    assert.equal(options.headers["x-organization-uuid"], otherOrg);
    assert.equal(options.headers["anthropic-client-feature"], "ccr");
  }
  assert.equal(runtime.listeners.size, 1, "all request listeners were cleaned up");

  // SPA route changes must switch providers, without reusing the prior session's turns.
  const normalUrl = "https://claude.ai/chat/12345678-1234-1234-1234-123456789012";
  assert.equal(runtime.ns.getActiveProvider({ conversationUrl: normalUrl }).id, "claude");
  assert.equal(runtime.ns.getActiveProvider().getTurns({ conversationUrl: "https://claude.ai/code/session_Other" }).length, 0);
  for (const url of ["https://example.org/code/session_Test123", "https://claude.ai/code", "https://claude.ai/code/session_Test123/extra", normalUrl]) {
    assert.equal(runtime.ns.claudeCodeData.getSessionId(url), "");
  }
  runtime.context.location.href = normalUrl;
  assert.equal(runtime.ns.getActiveProvider().id, "claude");
  runtime.context.location.href = location.href;
  assert.equal(runtime.ns.getActiveProvider().id, "claude-code");

  // Chronology, message echoes, subagents, errors and context compaction markers.
  const rich = setup({ pages: [{ data: [last, first, call, output], next_cursor: null }] });
  const ordered = await rich.ns.claudeCodeData.fetchSession();
  assert.deepEqual(Array.from(ordered.events, (e) => e.sequence_num), [1, 2, 3, 4]);
  const extra = [
    { event_id: "echo", payload: first.payload },
    event(5, "assistant", [text("Subagent details")], { parent_tool_use_id: "tool-1" }),
    { event_id: "compact", payload: { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto" } } },
    event(6, "user", "Earlier work summarized", { isCompactSummary: true }),
    { event_id: "error", payload: { type: "result", is_error: true, errors: ["Tool failed"] } },
    { event_id: "init", payload: { type: "system", subtype: "init", cwd: "/do-not-export-init" } },
    { event_id: "result", payload: { type: "result", result: "Final answer duplicate" } },
    { event_id: "tool-summary", payload: { type: "tool_use_summary", summary: "Private tool summary" } },
    { event_id: "task-started", payload: { type: "system", subtype: "task_started", description: "Private task description" } },
    { event_id: "task-progress", payload: { type: "system", subtype: "task_progress", description: "Private task progress" } },
    { event_id: "task-notification", payload: { type: "system", subtype: "task_notification", summary: "Private subagent summary" } }
  ];
  const descriptors = rich.ns.claudeCodeData.buildTurnDescriptors([...ordered.events, ...extra]);
  assert.deepEqual(Array.from(descriptors, (d) => d.role), ["user", "assistant"]);
  const markdown = descriptors.map((d) => rich.ns.claudeCodeData.renderTurnDescriptor(d, { includeToolActivity: true })).join("\n");
  assert.match(markdown, /Subagent response/);
  assert.match(markdown, /Context summary/);
  assert.match(markdown, /compact_boundary/);
  assert.match(markdown, /Tool failed/);
  assert.doesNotMatch(markdown, /do-not-export-init|Final answer duplicate/);
  for (const detail of ["Private tool summary", "Private task description", "Private task progress", "Private subagent summary"]) {
    assert.ok(markdown.includes(detail), detail);
  }

  const withoutTools = descriptors.map((d) => rich.ns.claudeCodeData.renderTurnDescriptor(d, { includeToolActivity: false })).join("\n");
  assert.doesNotMatch(withoutTools, /Subagent response|Subagent details|command output|Claude Activity/);
  assert.match(withoutTools, /First prompt|Final answer/);
  assert.match(withoutTools, /Context summary/);
  assert.match(withoutTools, /Tool failed/);
  assert.doesNotMatch(withoutTools, /Private tool summary|Private task description|Private task progress|Private subagent summary/);

  const light = setup({ pages: [{ data: [first, call, output, last] }] });
  const defaultResult = await light.ns.extractConversation({ downloadImages: true });
  assert.doesNotMatch(defaultResult.markdown, /Claude Activity|Claude Tool Result|command output|printf/);
  assert.match(defaultResult.markdown, /Running a check/);
  assert.match(defaultResult.markdown, /const a = 1/);
  assert.equal(defaultResult.images.length, 2, "tool-produced images remain available without the transcript");

  const stream = { event_id: "stream", payload: { type: "stream_event", event: { type: "message_start", message: { id: "api-4" } } } };
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([stream, last]), /no final message stop/);
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([first, stream]), /no final message/);

  const partial = (name, type, extra = {}) => ({ event_id: `stream-${name}`, payload: {
    type: "stream_event", event: { type, ...extra }
  } });
  const startText = partial("text-start", "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  const textDelta = partial("text-delta", "content_block_delta", { index: 0, delta: { type: "text_delta", text: last.payload.message.content[0].text } });
  const stopText = partial("text-stop", "content_block_stop", { index: 0 });
  const toolBlock = { type: "tool_use", id: "stream-tool", name: "Bash", input: { command: "echo multi-block" } };
  const startTool = partial("tool-start", "content_block_start", { index: 1, content_block: { ...toolBlock, input: {} } });
  const stopTool = partial("tool-stop", "content_block_stop", { index: 1 });
  const stopMessage = partial("message-stop", "message_stop");
  const completedTool = event(20, "assistant", [toolBlock], { message: { id: "api-4", content: [toolBlock] } });
  const textComplete = [stream, startText, textDelta, last, stopText];
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([...textComplete, startTool]), /no final message stop/);
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([...textComplete, startTool, stopMessage]), /still open/);
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([...textComplete, startTool, stopTool, stopMessage]), /no completed assistant message/);
  const bothComplete = [...textComplete, startTool, completedTool, stopTool, stopMessage];
  assert.doesNotThrow(() => rich.ns.claudeCodeData.buildTurnDescriptors(bothComplete));
  const acrossPages = [first, ...bothComplete].map((e, i) => ({ ...e, sequence_num: i + 1 }));
  const multiBlock = setup({ pages: [
    { data: acrossPages.slice(0, 6), next_cursor: "blocks" }, { data: acrossPages.slice(6) }
  ] });
  const multiResult = await multiBlock.ns.extractConversation({ includeToolActivity: true });
  assert.match(multiResult.markdown, /Final answer/);
  assert.match(multiResult.markdown, /echo multi-block/);
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([first, { event_id: "conflict", payload: { ...first.payload, message: { content: "changed" } } }]), /conflicting copies/);
  assert.throws(() => rich.ns.claudeCodeData.buildTurnDescriptors([event(1, "assistant", null)]), /content shape/);

  async function fails(config, pattern) {
    const r = setup(config);
    await assert.rejects(r.ns.extractConversation(), pattern);
    assert.equal(r.ns.getActiveProvider().getTurns().length, 0);
    assert.equal(r.listeners.size, 1);
  }
  await fails({ pages: [{ data: [first], next_cursor: "next" }, { data: [last] }], failPage: 1 }, /503.*No partial file/);
  await fails({ pages: () => ({ data: [first], next_cursor: "same" }) }, /pagination did not advance/);
  await fails({ pages: [{ data: [first], has_more: true }] }, /cursor was missing/);
  await fails({ pages: [{ data: [], next_cursor: "next" }] }, /pagination did not advance/);
  await fails({ pages: [{ data: [first], next_cursor: 123 }] }, /cursor was invalid/);
  await fails({ pages: [{ unexpected: [] }] }, /events page was invalid/);
  await fails({ pages: [{ data: [{ payload: first.payload }] }] }, /identity or payload/);
  await fails({ pages: [{ data: [first, { ...last, sequence_num: 1 }] }] }, /ordering could not be verified/);
  await fails({ pages: [{ data: [] }] }, /No messages/);
  await fails({ session: { session: { id: "session_Wrong" } } }, /unexpected session/);
  await fails({ pages: (n) => ({ data: [event(n + 1, "user", "prompt")], next_cursor: `cursor-${n}` }) }, /safety limit/);

  // A long, entirely off-screen history is exported from all pages.
  const many = Array.from({ length: 74 }, (_, i) => event(i + 1, i % 2 ? "assistant" : "user", `Message ${i + 1}`));
  const long = setup({ pages: [
    { data: many.slice(0, 30), next_cursor: "30" },
    { data: many.slice(30, 60), next_cursor: "60" },
    { data: many.slice(60) }
  ] });
  const complete = await long.ns.extractConversation();
  assert.equal((complete.markdown.match(/^## User$/gm) || []).length, 37);
  assert.equal((complete.markdown.match(/^## Assistant$/gm) || []).length, 37);
  assert.match(complete.markdown, /Message 1\n/);
  assert.match(complete.markdown, /Message 74\n/);
  console.log("claude-code integration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
