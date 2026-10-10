(() => {
  const ns = window.ChatExporter;
  const { normalizeTextTrim, wrapCollapsibleSection } = ns.helpers;

  function getConversationId(url = location.href) {
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== "https://claude.ai") return "";
      return parsed.pathname.match(/^\/chat\/([0-9a-f-]{12,})\/?$/i)?.[1] || "";
    } catch {
      return "";
    }
  }

  async function fetchConversationPayload(url = location.href) {
    const conversationId = getConversationId(url);
    if (!conversationId) throw new Error("Claude conversation ID was not found in the URL.");

    const organizationIds = await ns.claudeApi.getOrganizationIds();

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
        const payload = await ns.claudeApi.fetchJson(conversationUrl.href);
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

  function renderToolUse(block, converter) {
    if (String(block?.name || "").toLowerCase() === "artifacts") {
      const artifact = renderArtifact(block);
      if (artifact) return artifact;
    }
    if (!converter.includeToolActivity) return "";

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

  function renderToolResult(block, converter, media) {
    const content = block?.content;
    const rawItems = Array.isArray(content) ? content : [];
    const displayItems = Array.isArray(block?.display_content?.content) ? block.display_content.content : [];
    const imageKeys = new Set();
    const renderResultImage = (item) => {
      const { url, file } = resolveImageBlock(item, media);
      const keys = [url, getFileUrl(file)].filter(Boolean).map((value) => `url:${value}`);
      for (const id of [item.file_uuid, item.source?.file_uuid, file?.uuid, file?.file_uuid, file?.id]) {
        if (id) keys.push(`id:${id}`);
      }
      if (!keys.length) keys.push(JSON.stringify(item.source || item));
      const duplicate = keys.some((key) => imageKeys.has(key));
      keys.forEach((key) => imageKeys.add(key));
      if (duplicate) return "";
      return renderImageBlock(item, converter, media);
    };
    if (!converter.includeToolActivity) {
      return [...rawItems, ...displayItems]
        .filter((item) => item?.type === "image")
        .map(renderResultImage).filter(Boolean).join("\n\n");
    }
    const result = Array.isArray(content) ? content.map((item) => {
      if (item?.type === "image") return renderResultImage(item);
      const text = typeof item === "string" ? item : item?.text || stringifyValue(item);
      return text ? fenceCode(text, "text") : "";
    }).filter(Boolean).join("\n\n") : extractToolResult(block);
    const displayedImages = displayItems.filter((item) => item?.type === "image")
      .map(renderResultImage).filter(Boolean).join("\n\n");
    const status = block?.is_error ? "Failed" : "Complete";
    const body = [
      result ? `**Output:**\n\n${Array.isArray(content) ? result : fenceCode(result, "text")}` : "",
      displayedImages,
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

  function getFileUrl(file) {
    return normalizeAssetUrl(file?.preview_asset?.url || file?.preview_url || file?.download_url || file?.url);
  }

  function getFileName(file) {
    return normalizeTextTrim(file?.file_name || file?.name) || "Claude file";
  }

  function resolveImageBlock(block, media) {
    const source = block?.source || {};
    const embedded = source.type === "base64" && /^image\/(png|jpeg|gif|webp)$/.test(source.media_type || "") &&
      typeof source.data === "string" ? `data:${source.media_type};base64,${source.data}` : "";
    const blockUrl = normalizeAssetUrl(
      embedded || block?.url || block?.image_url?.url || block?.image_url || source?.url || source?.preview_url
    );
    const fileId = String(block?.file_uuid || source?.file_uuid || "").trim();
    // Chat image blocks can carry only a UUID; their preview is in message.files.
    const file = media.files.find((candidate) => {
      const candidateUrl = getFileUrl(candidate);
      const previewId = candidateUrl ? new URL(candidateUrl).pathname.match(/^\/api\/[^/]+\/files\/([^/]+)\/preview\/?$/)?.[1] : "";
      return (fileId && [candidate?.uuid, candidate?.file_uuid, candidate?.id, previewId].includes(fileId)) ||
        (blockUrl && candidateUrl === blockUrl);
    });
    const url = blockUrl || getFileUrl(file);
    return { url, file };
  }

  function renderImageBlock(block, converter, media) {
    const { url, file } = resolveImageBlock(block, media);
    if (!url) return wrapCollapsibleSection("Claude image (unresolved)", fenceCode(stringifyValue(block), "json"));
    media.imageUrls.add(url);
    if (file) media.renderedFiles.add(file);
    const alt = normalizeTextTrim(block?.alt || block?.name) || (file ? getFileName(file) : "Claude image");
    return converter.convertImage?.({ url, alt }) || `![${alt}](<${url}>)`;
  }

  function renderContentBlock(block, converter, media) {
    const type = String(block?.type || "").toLowerCase();
    if (media.toolActivity && !converter.includeToolActivity &&
        !["image", "tool_use", "tool_result"].includes(type)) return "";
    if (type === "text") return renderTextBlock(block);
    if (type === "thinking") return renderThinkingBlock(block);
    if (type === "tool_use") return renderToolUse(block, converter);
    if (type === "tool_result") return renderToolResult(block, converter, media);
    if (type === "image") return renderImageBlock(block, converter, media);

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

  function renderFiles(converter, media) {
    return media.files.map((file) => {
      if (media.renderedFiles.has(file)) return "";
      const name = getFileName(file);
      const url = getFileUrl(file);
      const kind = String(file?.file_kind || file?.type || "").toLowerCase();
      const looksLikeImage = kind.includes("image") || /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url);

      if (url && looksLikeImage) {
        if (media.imageUrls.has(url)) return "";
        media.imageUrls.add(url);
        return converter.convertImage?.({ url, alt: name }) || `![${name}](<${url}>)`;
      }
      if (url) return `**Attachment:** [${name}](<${url}>)`;
      return `**Attachment:** ${name}`;
    }).filter(Boolean).join("\n\n");
  }

  function renderMessage(message, converter) {
    const media = {
      files: Array.isArray(message?.files) ? message.files : [],
      toolActivity: Boolean(message?.toolActivity),
      renderedFiles: new Set(),
      imageUrls: new Set()
    };
    const content = messageContentBlocks(message);
    const blocks = content
      .map((block) => renderContentBlock(block, converter, media))
      .filter(Boolean);

    if (blocks.length === 0 && content.length === 0 && (!media.toolActivity || converter.includeToolActivity)) {
      const text = String(message?.text || "").trim();
      if (text) blocks.push(text);
    }

    const attachments = renderAttachments(message);
    const files = renderFiles(converter, media);
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
