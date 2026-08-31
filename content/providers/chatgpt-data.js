(() => {
  const ns = window.ChatExporter;

  function getConversationId(url = location.href) {
    try {
      const pathname = new URL(url, location.href).pathname;
      return pathname.match(/\/c\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  const PAGE_SIZE = 10;

  const PAGE_FETCH_REQUEST = "CHAT_EXPORTER_PAGE_FETCH_REQUEST";
  const PAGE_FETCH_RESPONSE = "CHAT_EXPORTER_PAGE_FETCH_RESPONSE";

  async function fetchJsonDirect(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      const error = new Error(`ChatGPT conversation data request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  function makeRequestId() {
    const randomId = globalThis.crypto?.randomUUID?.();
    return randomId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function fetchJsonFromPage(url) {
    if (typeof window.addEventListener !== "function" || typeof window.postMessage !== "function") {
      return fetchJsonDirect(url);
    }

    return new Promise((resolve, reject) => {
      const requestId = makeRequestId();
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("ChatGPT conversation data request timed out."));
      }, 30_000);

      function cleanup() {
        clearTimeout(timeoutId);
        window.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        const response = event.data;
        if (
          event.source !== window ||
          response?.type !== PAGE_FETCH_RESPONSE ||
          response.requestId !== requestId
        ) {
          return;
        }

        cleanup();
        if (!response.ok) {
          const error = new Error(
            response.error || `ChatGPT conversation data request failed (${response.status || 0}).`
          );
          error.status = response.status || 0;
          reject(error);
          return;
        }
        resolve(response.payload);
      }

      window.addEventListener("message", onMessage);
      window.postMessage({
        type: PAGE_FETCH_REQUEST,
        requestId,
        url: String(url)
      }, location.origin);
    });
  }

  async function fetchJson(url) {
    return fetchJsonFromPage(url);
  }

  function getPreviousPageCursor(payload) {
    return payload?.page_info?.has_previous_page
      ? String(payload.page_info.start_cursor || "").trim()
      : "";
  }

  function buildLinearConversationPayload(initialPayload, pages, conversationId) {
    const messages = [];
    const seenMessageIds = new Set();

    for (const page of pages) {
      for (const message of page || []) {
        const messageId = String(message?.id || "").trim();
        if (!messageId || seenMessageIds.has(messageId)) continue;
        seenMessageIds.add(messageId);
        messages.push(message);
      }
    }

    const rootId = `paginated-root:${conversationId}`;
    const mapping = {
      [rootId]: { id: rootId, parent: null, children: [] }
    };
    let parentId = rootId;

    for (const message of messages) {
      mapping[message.id] = {
        id: message.id,
        parent: parentId,
        children: [],
        message
      };
      mapping[parentId].children.push(message.id);
      parentId = message.id;
    }

    const requestedCurrentNode = String(initialPayload?.current_node || "").trim();
    const currentNode = mapping[requestedCurrentNode] ? requestedCurrentNode : parentId;
    const { messages: _messages, page_info: _pageInfo, ...conversation } = initialPayload || {};

    return {
      ...conversation,
      current_node: currentNode,
      mapping,
      moderation_results: initialPayload?.moderation_results || [],
      __chatExporterPagination: {
        messageCount: messages.length,
        pageCount: pages.length
      }
    };
  }

  async function fetchPaginatedConversationPayload(conversationId) {
    const initialUrl = new URL(
      `/backend-api/conversations/${encodeURIComponent(conversationId)}`,
      location.origin
    );
    initialUrl.searchParams.set("include_has_versions", "true");
    initialUrl.searchParams.set("num_turns", String(PAGE_SIZE));

    const initialPayload = await fetchJson(initialUrl.href);
    if (!Array.isArray(initialPayload?.messages)) {
      throw new Error("ChatGPT returned an invalid paginated conversation payload.");
    }

    const pagesNewestToOldest = [initialPayload.messages];
    const seenCursors = new Set();
    let cursor = getPreviousPageCursor(initialPayload);

    while (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("ChatGPT conversation pagination cursor did not advance.");
      }
      seenCursors.add(cursor);

      const pageUrl = new URL(
        `/backend-api/conversations/${encodeURIComponent(conversationId)}/messages`,
        location.origin
      );
      pageUrl.searchParams.set("before", cursor);
      pageUrl.searchParams.set("include_has_versions", "true");
      pageUrl.searchParams.set("num_turns", String(PAGE_SIZE));

      const page = await fetchJson(pageUrl.href);
      if (!Array.isArray(page?.messages)) {
        throw new Error("ChatGPT returned an invalid conversation history page.");
      }

      pagesNewestToOldest.push(page.messages);
      cursor = getPreviousPageCursor(page);
    }

    const payload = buildLinearConversationPayload(
      initialPayload,
      pagesNewestToOldest.reverse(),
      conversationId
    );
    payload.__chatExporterCoverageComplete = true;
    payload.__chatExporterSourceKind = "paginated";
    return payload;
  }

  async function fetchLegacyConversationPayload(conversationId, includeFullConversation = false) {
    const url = new URL(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      location.origin
    );
    if (includeFullConversation) {
      url.searchParams.set("include_full_conversation", "true");
    }

    const payload = await fetchJson(url.href);
    if (!payload?.mapping || typeof payload.mapping !== "object") {
      throw new Error("ChatGPT returned an invalid conversation payload.");
    }
    if (!isActiveBranchComplete(payload)) {
      throw new Error("ChatGPT returned only a partial canonical branch.");
    }
    payload.__chatExporterCoverageComplete = false;
    payload.__chatExporterSourceKind = includeFullConversation ? "legacy-full" : "legacy";
    return payload;
  }

  async function fetchConversationCandidates(conversationId) {
    let paginationError = null;
    let legacyFullError = null;

    try {
      return [await fetchPaginatedConversationPayload(conversationId)];
    } catch (error) {
      paginationError = error;
    }

    try {
      return [await fetchLegacyConversationPayload(conversationId, true)];
    } catch (error) {
      legacyFullError = error;
    }

    try {
      return [await fetchLegacyConversationPayload(conversationId, false)];
    } catch (legacyError) {
      throw paginationError || legacyFullError || legacyError;
    }
  }

  function getBranchMessages(payload, leafId = payload?.current_node) {
    const mapping = payload?.mapping || {};
    const messages = [];
    const seen = new Set();
    let nodeId = String(leafId || "").trim();

    while (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (!node) break;
      if (node.message) messages.push(node.message);
      nodeId = node.parent || "";
    }

    return messages.reverse();
  }

  async function stitchContinuationHistory(payload, conversationId, visitedConversationIds) {
    const continuation = payload?.context_truncation_continuation;
    if (!continuation) return payload;

    const sourceConversationId = String(continuation.source_conversation_id || "").trim();
    if (!sourceConversationId) {
      throw new Error("ChatGPT continuation history did not identify its source conversation.");
    }
    if (visitedConversationIds.has(sourceConversationId)) {
      throw new Error("ChatGPT continuation history contains a conversation loop.");
    }

    const nextVisited = new Set(visitedConversationIds);
    nextVisited.add(sourceConversationId);
    const sourcePayload = await fetchBestConversationPayload(
      sourceConversationId,
      nextVisited
    );

    const boundaryMessageId = String(continuation.boundary_message_id || "").trim();
    const sourceMessages = getBranchMessages(
      sourcePayload,
      boundaryMessageId && sourcePayload.mapping?.[boundaryMessageId]
        ? boundaryMessageId
        : sourcePayload.current_node
    );

    const continuationMessages = getBranchMessages(payload);
    const visibleFromMessageId = String(continuation.visible_from_message_id || "").trim();
    const visibleIndex = visibleFromMessageId
      ? continuationMessages.findIndex((message) => message?.id === visibleFromMessageId)
      : 0;

    if (visibleFromMessageId && visibleIndex < 0) {
      throw new Error("ChatGPT continuation history did not contain its visible boundary message.");
    }

    const visibleMessages = continuationMessages.slice(Math.max(0, visibleIndex));
    const stitched = buildLinearConversationPayload(
      payload,
      [[...sourceMessages, ...visibleMessages]],
      conversationId
    );
    stitched.__chatExporterContinuation = {
      sourceConversationId,
      boundaryMessageId,
      visibleFromMessageId,
      sourceMessageCount: sourceMessages.length,
      visibleMessageCount: visibleMessages.length
    };
    stitched.__chatExporterCoverageComplete = Boolean(
      payload.__chatExporterCoverageComplete &&
      sourcePayload.__chatExporterCoverageComplete
    );
    stitched.__chatExporterSourceKind = "stitched";
    return stitched;
  }

  function getConversationCoverageScore(payload) {
    const turns = buildTurnDescriptors(payload);
    const messageCount = turns.reduce(
      (count, turn) => count + (turn.messages?.length || 0),
      0
    );
    const completenessBonus = payload?.__chatExporterCoverageComplete ? 1 : 0;
    return turns.length * 100_000 + messageCount * 10 + completenessBonus;
  }

  async function fetchBestConversationPayload(conversationId, visitedConversationIds) {
    const candidates = await fetchConversationCandidates(conversationId);
    const resolvedCandidates = [];
    const errors = [];

    for (const candidate of candidates) {
      try {
        resolvedCandidates.push(
          await stitchContinuationHistory(candidate, conversationId, visitedConversationIds)
        );
      } catch (error) {
        errors.push(error);
      }
    }

    if (resolvedCandidates.length === 0) {
      throw errors[0] || new Error("ChatGPT conversation data was unavailable.");
    }

    return resolvedCandidates.reduce((best, candidate) =>
      getConversationCoverageScore(candidate) > getConversationCoverageScore(best)
        ? candidate
        : best
    );
  }

  async function fetchConversationPayload(url = location.href) {
    const conversationId = getConversationId(url);
    if (!conversationId) throw new Error("ChatGPT conversation ID was not found in the URL.");

    return fetchBestConversationPayload(conversationId, new Set([conversationId]));
  }

  function isActiveBranchComplete(payload) {
    const mapping = payload?.mapping || {};
    const seen = new Set();
    let nodeId = payload?.current_node || "";

    if (!nodeId) return false;

    while (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (!node) return false;
      if (!node.parent) return true;
      nodeId = node.parent;
    }

    return false;
  }

  function getActiveBranch(payload) {
    const mapping = payload?.mapping || {};
    const branch = [];
    const seen = new Set();
    let nodeId = payload?.current_node || "";

    while (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (!node) break;
      branch.push(node);
      nodeId = node.parent || "";
    }

    if (branch.length > 0) return branch.reverse();

    return Object.values(mapping)
      .filter((node) => node?.message)
      .sort((a, b) => Number(a.message?.create_time || 0) - Number(b.message?.create_time || 0));
  }

  function getMessageRole(message) {
    return String(message?.author?.role || "").toLowerCase();
  }

  function getMessageId(message) {
    return String(message?.id || "").trim();
  }

  function getTurnKey(message) {
    const metadata = message?.metadata || {};
    return String(
      metadata.turn_id ||
      metadata.turnId ||
      metadata.response_id ||
      metadata.responseId ||
      ""
    ).trim();
  }

  function makeDescriptorId(role, messageIds, turnKey, index) {
    const stableIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (stableIds.length > 0) return `${role}:${stableIds.join("|")}`;
    if (turnKey) return `${role}:turn:${turnKey}`;
    return `${role}:api:${index}`;
  }

  function buildTurnDescriptors(payload) {
    const branch = getActiveBranch(payload);
    const turns = [];
    let currentAssistant = null;

    for (const node of branch) {
      const message = node?.message;
      if (!message) continue;
      if (message.metadata?.is_visually_hidden_from_conversation === true) continue;

      const role = getMessageRole(message);
      if (role === "user") {
        currentAssistant = null;
        const messageId = getMessageId(message);
        const turnKey = getTurnKey(message) || messageId;
        const descriptor = {
          role: "user",
          turnKey,
          messageIds: messageId ? [messageId] : [],
          messages: [message]
        };
        descriptor.id = makeDescriptorId("user", descriptor.messageIds, turnKey, turns.length);
        turns.push(descriptor);
        continue;
      }

      if (role !== "assistant" && role !== "tool") continue;

      const turnKey = getTurnKey(message);
      const startsNewTurn = !currentAssistant;

      if (startsNewTurn) {
        currentAssistant = {
          role: "assistant",
          turnKey,
          messageIds: [],
          messages: []
        };
        turns.push(currentAssistant);
      } else if (!currentAssistant.turnKey && turnKey) {
        currentAssistant.turnKey = turnKey;
      }

      currentAssistant.messages.push(message);
      if (role === "assistant") {
        const messageId = getMessageId(message);
        if (messageId) currentAssistant.messageIds.push(messageId);
      }
    }

    return turns.map((turn, index) => ({
      ...turn,
      messageIds: Array.from(new Set(turn.messageIds)),
      id: makeDescriptorId(turn.role, turn.messageIds, turn.turnKey, index)
    }));
  }

  function fenceCode(text, language = "") {
    const raw = String(text ?? "").replace(/\n$/, "");
    let fence = "```";
    while (raw.includes(fence)) fence += "`";
    return `${fence}${String(language || "").trim()}\n${raw}\n${fence}`;
  }

  function assetPointerToUrl(pointer) {
    const value = String(pointer || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value;

    const fileId = value.match(/^file-service:\/\/(.+)$/i)?.[1];
    if (fileId) {
      return `${location.origin}/backend-api/estuary/content?id=${encodeURIComponent(fileId)}`;
    }

    return "";
  }

  function renderImagePart(part, converter) {
    const pointer =
      part?.asset_pointer ||
      part?.assetPointer ||
      part?.image_url?.url ||
      part?.image_url ||
      part?.url ||
      "";
    const url = assetPointerToUrl(pointer);
    if (!url) return "";

    const alt = String(part?.alt_text || part?.alt || "ChatGPT image").trim();
    return converter.convertImage?.({ url, alt }) || `![${alt}](<${url}>)`;
  }

  function renderContentPart(part, converter) {
    if (typeof part === "string") return part.trim();
    if (!part || typeof part !== "object") return "";

    const type = String(part.content_type || part.type || "").toLowerCase();
    if (type.includes("image") || part.asset_pointer || part.assetPointer || part.image_url) {
      return renderImagePart(part, converter);
    }

    const text = [part.text, part.content, part.output, part.result, part.transcript]
      .find((value) => typeof value === "string");
    if (text) return text.trim();

    const name = String(part.name || part.filename || "").trim();
    if (name) return `**Attachment:** ${name}`;
    return "";
  }

  function renderAttachments(message) {
    const attachments = Array.isArray(message?.metadata?.attachments)
      ? message.metadata.attachments
      : [];
    const names = attachments
      .map((attachment) => String(attachment?.name || attachment?.filename || "").trim())
      .filter(Boolean);

    return Array.from(new Set(names)).map((name) => `**Attachment:** ${name}`).join("\n\n");
  }

  function renderMessage(message, converter) {
    const content = message?.content || {};
    const type = String(content.content_type || "").toLowerCase();
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const renderedParts = parts.map((part) => renderContentPart(part, converter)).filter(Boolean);

    let body = renderedParts.join("\n\n");
    if (!body) {
      const directText = [content.text, content.content, content.output, content.result]
        .find((value) => typeof value === "string");
      body = String(directText || "").trim();
    }

    if (type === "code" && body) {
      body = fenceCode(body, content.language || content.lang || "");
    } else if ((type.includes("execution_output") || type === "computer_output") && body) {
      body = `**Result:**\n\n${fenceCode(body, "text")}`;
    } else if ((type.includes("thought") || type.includes("reasoning")) && body) {
      body = ns.helpers.wrapCollapsibleSection("Reasoning", body);
    }

    const attachments = renderAttachments(message);
    return [body, attachments].filter(Boolean).join("\n\n").trim();
  }

  function renderTurnDescriptor(descriptor, converter) {
    return descriptor.messages
      .map((message) => renderMessage(message, converter))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  ns.chatGptData = {
    buildTurnDescriptors,
    fetchConversationPayload,
    getConversationId,
    isActiveBranchComplete,
    renderTurnDescriptor
  };
})();
