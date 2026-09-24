(() => {
  const ns = window.ChatExporter;
  const { normalizeTextTrim, wrapCollapsibleSection } = ns.helpers;

  const PAGE_FETCH_REQUEST = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST";
  const PAGE_FETCH_RESPONSE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_RESPONSE";

  function getConversationId(url = location.href) {
    try {
      const pathname = new URL(url, location.href).pathname;
      return pathname.match(/\/chat\/([0-9a-f-]{12,})/i)?.[1] || "";
    } catch {
      return "";
    }
  }

  async function fetchJsonDirect(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      const error = new Error(`Claude data request failed (${response.status}).`);
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
        reject(new Error("Claude data request timed out."));
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
            response.error || `Claude data request failed (${response.status || 0}).`
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

  function getOrganizations(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.organizations)) return payload.organizations;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  async function fetchConversationPayload(url = location.href) {
    const conversationId = getConversationId(url);
    if (!conversationId) throw new Error("Claude conversation ID was not found in the URL.");

    const organizationsUrl = new URL("/api/organizations", location.origin);
    const organizations = getOrganizations(await fetchJsonFromPage(organizationsUrl.href));
    const organizationIds = organizations
      .map((organization) => String(organization?.uuid || organization?.id || "").trim())
      .filter(Boolean);

    if (organizationIds.length === 0) {
      throw new Error("Claude did not return an organization for the current session.");
    }

    let lastError = null;
    for (const organizationId of organizationIds) {
      const conversationUrl = new URL(
        `/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations/${encodeURIComponent(conversationId)}`,
        location.origin
      );
      conversationUrl.searchParams.set("tree", "true");
      conversationUrl.searchParams.set("rendering_mode", "messages");
      conversationUrl.searchParams.set("render_all_tools", "true");
      conversationUrl.searchParams.set("consistency", "strong");

      try {
        const payload = await fetchJsonFromPage(conversationUrl.href);
        if (!Array.isArray(payload?.chat_messages)) {
          throw new Error("Claude returned an invalid conversation payload.");
        }
        return payload;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Claude conversation data was unavailable.");
  }

  function getMessageId(message) {
    return String(message?.uuid || message?.id || "").trim();
  }

  function getParentMessageId(message) {
    return String(message?.parent_message_uuid || message?.parent_uuid || "").trim();
  }

  function isRootParent(messageId) {
    return !messageId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(messageId);
  }

  function getMessagesInApiOrder(payload) {
    return (Array.isArray(payload?.chat_messages) ? payload.chat_messages : [])
      .map((message, arrayIndex) => ({ message, arrayIndex }))
      .sort((a, b) => {
        const aIndex = Number(a.message?.index);
        const bIndex = Number(b.message?.index);
        if (Number.isFinite(aIndex) && Number.isFinite(bIndex) && aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        return a.arrayIndex - b.arrayIndex;
      })
      .map((entry) => entry.message);
  }

  function getActiveBranch(payload) {
    const ordered = getMessagesInApiOrder(payload);
    const byId = new Map(ordered.map((message) => [getMessageId(message), message]).filter(([id]) => id));
    const leafId = String(payload?.current_leaf_message_uuid || "").trim();
    if (!leafId || !byId.has(leafId)) return ordered;

    const branch = [];
    const seen = new Set();
    let messageId = leafId;

    while (messageId && !seen.has(messageId)) {
      seen.add(messageId);
      const message = byId.get(messageId);
      if (!message) return ordered;
      branch.push(message);

      const parentId = getParentMessageId(message);
      if (isRootParent(parentId)) return branch.reverse();
      if (!byId.has(parentId)) return ordered;
      messageId = parentId;
    }

    return ordered;
  }

  function messageContentBlocks(message) {
    return Array.isArray(message?.content) ? message.content : [];
  }

  function isToolResultOnlyMessage(message) {
    const blocks = messageContentBlocks(message);
    return blocks.length > 0 && blocks.every((block) => String(block?.type || "") === "tool_result");
  }

  function makeDescriptorId(role, messages, index) {
    const ids = messages.map(getMessageId).filter(Boolean);
    return ids.length > 0 ? `${role}:${ids.join("|")}` : `${role}:api:${index}`;
  }

  function buildTurnDescriptors(payload) {
    const messages = getActiveBranch(payload);
    const turns = [];
    let currentAssistant = null;

    for (const message of messages) {
      const sender = String(message?.sender || "").toLowerCase();

      if (sender === "human" && isToolResultOnlyMessage(message) && currentAssistant) {
        currentAssistant.messages.push(message);
        continue;
      }

      if (sender === "human") {
        currentAssistant = null;
        const descriptor = { role: "user", messages: [message] };
        descriptor.id = makeDescriptorId("user", descriptor.messages, turns.length);
        turns.push(descriptor);
        continue;
      }

      if (sender !== "assistant") continue;

      if (!currentAssistant) {
        currentAssistant = { role: "assistant", messages: [] };
        turns.push(currentAssistant);
      }
      currentAssistant.messages.push(message);
    }

    return turns.map((turn, index) => ({
      ...turn,
      messageIds: turn.messages.map(getMessageId).filter(Boolean),
      id: makeDescriptorId(turn.role, turn.messages, index)
    }));
  }

  function fenceCode(text, language = "") {
    const raw = String(text ?? "").replace(/\n$/, "");
    let fence = "```";
    while (raw.includes(fence)) fence += "`";
    return `${fence}${String(language || "").trim()}\n${raw}\n${fence}`;
  }

  function stringifyValue(value) {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function renderCitations(block) {
    const citations = Array.isArray(block?.citations) ? block.citations : [];
    const seen = new Set();
    const links = [];

    for (const citation of citations) {
      const url = String(citation?.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = normalizeTextTrim(citation?.title) || url;
      links.push(`[${title}](<${url}>)`);
    }

    return links.join("\n");
  }

  function renderTextBlock(block) {
    const text = String(block?.text || "").trim();
    const citations = renderCitations(block);
    return [text, citations].filter(Boolean).join("\n\n");
  }

  function renderThinkingBlock(block) {
    const thinking = String(block?.thinking || block?.text || "").trim();
    return thinking ? wrapCollapsibleSection("Reasoning", thinking) : "";
  }

  function renderArtifact(block) {
    const input = block?.input && typeof block.input === "object" ? block.input : {};
    const title = normalizeTextTrim(input.title) || "Claude Artifact";
    const content = String(input.content || input.source || "").trim();
    if (!content) return "";

    const mimeType = String(input.type || "").toLowerCase();
    const language = normalizeTextTrim(input.language) ||
      (mimeType.includes("html") ? "html" : mimeType.includes("svg") ? "svg" : "");
    const body = mimeType.includes("markdown") ? content : fenceCode(content, language);
    return wrapCollapsibleSection(`Claude Artifact: ${title}`, body);
  }

  function renderToolUse(block) {
    if (String(block?.name || "").toLowerCase() === "artifacts") {
      const artifact = renderArtifact(block);
      if (artifact) return artifact;
    }

    const toolName = [block?.integration_name, block?.name]
      .map(normalizeTextTrim)
      .filter(Boolean)
      .join("/") || "Tool";
    const input = stringifyValue(block?.input).trim();
    const body = input ? `**Input:**\n\n${fenceCode(input, typeof block?.input === "string" ? "text" : "json")}` : "";
    return wrapCollapsibleSection(`Claude Activity: ${toolName}`, body);
  }

  function extractToolResult(block) {
    const candidates = [block?.text, block?.content, block?.display_content?.content];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      if (Array.isArray(candidate)) {
        const rendered = candidate
          .map((item) => typeof item === "string" ? item : item?.text || stringifyValue(item))
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .join("\n\n");
        if (rendered) return rendered;
      }
      if (candidate && typeof candidate === "object") {
        const rendered = stringifyValue(candidate).trim();
        if (rendered) return rendered;
      }
    }
    return "";
  }

  function renderToolResult(block) {
    const result = extractToolResult(block);
    const status = block?.is_error ? "Failed" : "Complete";
    const body = [
      result ? `**Output:**\n\n${fenceCode(result, "text")}` : "",
      `**Status:** ${status}`
    ].filter(Boolean).join("\n\n");
    return wrapCollapsibleSection("Claude Tool Result", body);
  }

  function normalizeAssetUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    try {
      return new URL(url, location.origin).href;
    } catch {
      return "";
    }
  }

  function renderImageBlock(block, converter) {
    const source = block?.source || {};
    const url = normalizeAssetUrl(
      block?.url || block?.image_url?.url || block?.image_url || source?.url || source?.preview_url
    );
    if (!url) return "";
    const alt = normalizeTextTrim(block?.alt || block?.name) || "Claude image";
    return converter.convertImage?.({ url, alt }) || `![${alt}](<${url}>)`;
  }

  function renderContentBlock(block, converter) {
    const type = String(block?.type || "").toLowerCase();
    if (type === "text") return renderTextBlock(block);
    if (type === "thinking") return renderThinkingBlock(block);
    if (type === "tool_use") return renderToolUse(block);
    if (type === "tool_result") return renderToolResult(block);
    if (type === "image") return renderImageBlock(block, converter);

    const text = String(block?.text || "").trim();
    if (text) return text;
    if (!type) return "";
    return wrapCollapsibleSection(`Claude ${type}`, fenceCode(stringifyValue(block), "json"));
  }

  function renderAttachments(message) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    return attachments.map((attachment) => {
      const name = normalizeTextTrim(attachment?.file_name || attachment?.name) || "Attachment";
      const extractedContent = String(attachment?.extracted_content || "").trim();
      if (!extractedContent) return `**Attachment:** ${name}`;
      return wrapCollapsibleSection(`Attachment: ${name}`, extractedContent);
    }).join("\n\n");
  }

  function renderFiles(message, converter) {
    const files = Array.isArray(message?.files) ? message.files : [];
    return files.map((file) => {
      const name = normalizeTextTrim(file?.file_name || file?.name) || "Claude file";
      const url = normalizeAssetUrl(
        file?.preview_asset?.url || file?.preview_url || file?.download_url || file?.url
      );
      const kind = String(file?.file_kind || file?.type || "").toLowerCase();
      const looksLikeImage = kind.includes("image") || /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url);

      if (url && looksLikeImage) {
        return converter.convertImage?.({ url, alt: name }) || `![${name}](<${url}>)`;
      }
      if (url) return `**Attachment:** [${name}](<${url}>)`;
      return `**Attachment:** ${name}`;
    }).join("\n\n");
  }

  function renderMessage(message, converter) {
    const blocks = messageContentBlocks(message)
      .map((block) => renderContentBlock(block, converter))
      .filter(Boolean);

    if (blocks.length === 0) {
      const text = String(message?.text || "").trim();
      if (text) blocks.push(text);
    }

    const attachments = renderAttachments(message);
    const files = renderFiles(message, converter);
    return [...blocks, attachments, files].filter(Boolean).join("\n\n").trim();
  }

  function renderTurnDescriptor(descriptor, converter) {
    return descriptor.messages
      .map((message) => renderMessage(message, converter))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  ns.claudeData = {
    buildTurnDescriptors,
    fetchConversationPayload,
    getActiveBranch,
    getConversationId,
    renderTurnDescriptor
  };
})();
