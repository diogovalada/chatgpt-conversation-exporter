(() => {
  const ns = window.ChatExporter;
  const { wrapCollapsibleSection } = ns.helpers;
  const PAGE_LIMIT = 500;
  const MAX_PAGES = 1000;

  function getSessionId(url = location.href) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== "https://claude.ai") return "";
      return parsed.pathname.match(/^\/code\/(session_[A-Za-z0-9]+)\/?$/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function incomplete(reason) {
    return new Error(`Claude Code export stopped to avoid an incomplete transcript: ${reason}`);
  }

  async function fetchSession(url = location.href) {
    const id = getSessionId(url);
    if (!id) throw new Error("Claude Code session ID was not found in the URL.");
    const path = `/v1/code/sessions/${id}`;
    let session;
    let organizationId;
    let lastError;
    for (const candidate of await ns.claudeApi.getOrganizationIds()) {
      try {
        const response = await ns.claudeApi.fetchJson(new URL(path, location.origin).href, {
          organizationId: candidate
        });
        // Both response envelopes are used by the Claude Code web frontend.
        session = response?.session || response?.response_shape;
        // The web route uses session_, while current metadata uses cse_ for the same suffix.
        if (session?.id !== id && session?.id !== id.replace(/^session_/, "cse_")) {
          throw incomplete("the API returned an unexpected session.");
        }
        organizationId = candidate;
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 403 && error.status !== 404) throw error;
      }
    }
    if (!organizationId) throw lastError || incomplete("session access was unavailable.");

    const events = [];
    const seenEvents = new Map();
    const cursors = new Set();
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const endpoint = new URL(`${path}/events`, location.origin);
      endpoint.searchParams.set("limit", String(PAGE_LIMIT));
      endpoint.searchParams.set("sort_order", "asc");
      if (cursor) endpoint.searchParams.set("cursor", cursor);
      const response = await ns.claudeApi.fetchJson(endpoint.href, { organizationId });
      if (!Array.isArray(response?.data)) throw incomplete("an events page was invalid.");
      for (const event of response.data) {
        if (!event || typeof event.event_id !== "string" || !event.event_id ||
            !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
          throw incomplete("an event was missing its identity or payload.");
        }
        const previous = seenEvents.get(event.event_id);
        if (previous) {
          if (JSON.stringify(previous.payload) !== JSON.stringify(event.payload)) {
            throw incomplete("an event changed while loading history; retry once the session is idle.");
          }
          continue;
        }
        seenEvents.set(event.event_id, event);
        events.push(event);
      }
      const next = response.next_cursor;
      if (next != null && typeof next !== "string") throw incomplete("the next-page cursor was invalid.");
      if (!next) {
        if (response.has_more === true) throw incomplete("the next-page cursor was missing.");
        if (events.some((event) => event.sequence_num != null)) {
          const sequences = new Set();
          for (const event of events) {
            const sequence = Number(event.sequence_num);
            if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequences.has(sequence)) {
              throw incomplete("event ordering could not be verified.");
            }
            sequences.add(sequence);
          }
          events.sort((a, b) => Number(a.sequence_num) - Number(b.sequence_num));
          if (events.some((event, index) => Number(event.sequence_num) !== index + 1)) {
            throw incomplete("the event history was missing its beginning or had a sequence gap.");
          }
        }
        return { session, events };
      }
      if (cursors.has(next) || !response.data.length) throw incomplete("pagination did not advance.");
      cursors.add(next);
      cursor = next;
    }
    throw incomplete("the pagination safety limit was reached.");
  }

  function contentBlocks(content) {
    if (typeof content === "string") return [{ type: "text", text: content }];
    if (Array.isArray(content) && content.every((block) => block && typeof block === "object" && typeof block.type === "string")) {
      return content;
    }
    throw incomplete("a message had an unsupported content shape.");
  }

  function buildTurnDescriptors(events) {
    const turns = [];
    const messages = new Map();
    const streams = new Map();
    const completedBlocks = new Map();
    let activeStream = null;
    let assistant = null;

    function blockKey(block) {
      if (block.type === "text") return JSON.stringify([block.type, block.text || ""]);
      if (block.type === "thinking") return JSON.stringify([block.type, block.thinking || ""]);
      if (block.type === "tool_use") return JSON.stringify([block.type, block.id, block.name]);
      return JSON.stringify(block);
    }

    function recordStream(event) {
      if (event?.type === "message_start") {
        const id = event.message?.id;
        if (typeof id !== "string" || !id || activeStream || streams.has(id)) {
          throw incomplete("streamed message boundaries could not be verified.");
        }
        activeStream = { id, stopped: false, blocks: new Map() };
        streams.set(id, activeStream);
        return;
      }
      if (event?.type === "ping") return;
      if (!activeStream) throw incomplete("a stream event had no message start.");
      if (event.type === "message_stop") {
        activeStream.stopped = true;
        activeStream = null;
        return;
      }
      if (event.type === "message_delta") return;
      if (!Number.isSafeInteger(event.index) || event.index < 0) throw incomplete("a streamed block index was invalid.");
      const blocks = activeStream.blocks;
      if (event.type === "content_block_start") {
        if (blocks.has(event.index) || typeof event.content_block?.type !== "string") {
          throw incomplete("streamed content block boundaries could not be verified.");
        }
        blocks.set(event.index, { content: { ...event.content_block }, stopped: false });
        return;
      }
      const block = blocks.get(event.index);
      if (!block || block.stopped) throw incomplete("a streamed block was missing or already closed.");
      if (event.type === "content_block_stop") {
        block.stopped = true;
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta") block.content.text = (block.content.text || "") + delta.text;
        else if (delta?.type === "thinking_delta") block.content.thinking = (block.content.thinking || "") + delta.thinking;
        // Tool inputs and signatures are preserved from the completed assistant block.
      } else throw incomplete("an unsupported stream event was returned.");
    }

    function appendAssistant(message) {
      if (!assistant) {
        assistant = { role: "assistant", messages: [] };
        turns.push(assistant);
      }
      assistant.messages.push(message);
    }

    for (const event of events) {
      const payload = event.payload;
      const type = payload.type;
      if (type === "stream_event") {
        recordStream(payload.event);
        continue;
      }
      if (type === "assistant" || type === "user") {
        const id = payload.uuid || event.event_id;
        const content = contentBlocks(payload.message?.content);
        const message = { uuid: id, content };
        const fingerprint = JSON.stringify({ type, content, parent: payload.parent_tool_use_id, meta: payload.isMeta });
        if (messages.has(id)) {
          if (messages.get(id) !== fingerprint) throw incomplete("conflicting copies of a message were returned.");
          continue;
        }
        messages.set(id, fingerprint);
        if (type === "assistant" && payload.message?.id && !payload.parent_tool_use_id) {
          const blocks = completedBlocks.get(payload.message.id) || [];
          blocks.push(...content);
          completedBlocks.set(payload.message.id, blocks);
        }

        if (payload.parent_tool_use_id) {
          message.toolActivity = true;
          message.section = `Subagent ${type === "user" ? "input/output" : "response"} (${payload.parent_tool_use_id})`;
          appendAssistant(message);
        } else if (payload.isMeta || payload.isCompactSummary || payload.isSynthetic) {
          message.section = payload.isCompactSummary ? "Context summary" :
            payload.isSynthetic ? "Session notification" : "Session context";
          appendAssistant(message);
        } else if (type === "assistant" || (content.length && content.every((block) => block.type === "tool_result"))) {
          appendAssistant(message);
        } else {
          assistant = null;
          turns.push({ role: "user", messages: [message] });
        }
        continue;
      }

      // These are transport/runtime metadata, not transcript messages.
      const controlError = payload.response?.error || payload.response?.response?.error ||
        payload.response?.response?.mcp_response?.error;
      if (["rate_limit_event", "keep_alive", "control_request",
        "autocompact_state", "prompt_suggestion"].includes(type) ||
          (type === "control_response" && payload.response?.subtype === "success" && !controlError) ||
          (type === "active_goal" && payload.value == null) ||
          (type === "env_manager_log" && !["error", "warn", "warning"].includes(payload.data?.level)) ||
          (type === "system" && ["init", "status", "turn_handoff_available"].includes(payload.subtype))) continue;
      if (type === "result" && !payload.is_error) continue;

      const failedHook = type === "system" && payload.subtype === "hook_response" &&
        (payload.outcome === "error" || (payload.exit_code != null && payload.exit_code !== 0));
      // Keep unfamiliar events visible instead of silently discarding new content types.
      appendAssistant({
        uuid: event.event_id,
        toolActivity: !failedHook && (["tool_use_summary", "tool_progress"].includes(type) || (type === "system" &&
          ["task_started", "task_progress", "task_notification", "task_updated", "background_tasks_changed",
            "permission_check_status", "vcs_state_changed", "hook_started", "hook_response"].includes(payload.subtype))),
        section: `Claude Code ${type || "event"}${payload.subtype ? `: ${payload.subtype}` : ""}`,
        content: [{ type: "code_event", data: payload }]
      });
    }
    for (const stream of streams.values()) {
      if (!stream.stopped) throw incomplete("a streamed response has no final message stop yet; wait for it to finish and retry.");
      const represented = (completedBlocks.get(stream.id) || []).map(blockKey);
      for (const block of stream.blocks.values()) {
        if (!block.stopped) throw incomplete("a streamed content block is still open.");
        if ((block.content.type === "text" && !block.content.text) ||
            (block.content.type === "thinking" && !block.content.thinking)) continue;
        const index = represented.indexOf(blockKey(block.content));
        if (index < 0) throw incomplete("a streamed content block has no completed assistant message.");
        represented.splice(index, 1);
      }
    }
    return turns.map((turn, index) => ({
      ...turn,
      id: `${turn.role}:code:${index}`,
      messageIds: turn.messages.map((message) => message.uuid)
    }));
  }

  function renderTurnDescriptor(descriptor, converter) {
    return descriptor.messages.map((message) => {
      const body = ns.claudeData.renderTurnDescriptor({ messages: [message] }, converter);
      if (!body) return "";
      return message.section ? wrapCollapsibleSection(message.section, body) : body;
    }).filter(Boolean).join("\n\n");
  }

  ns.claudeCodeData = { getSessionId, fetchSession, buildTurnDescriptors, renderTurnDescriptor };
})();
