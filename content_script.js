function sanitizeFilenamePart(input) {
  const trimmed = String(input ?? "").trim();
  const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  const noBadChars = noControl.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return noBadChars || "ChatGPT Conversation";
}

function isElement(node) {
  return node?.nodeType === Node.ELEMENT_NODE;
}

function isText(node) {
  return node?.nodeType === Node.TEXT_NODE;
}

function isBlockTag(tagName) {
  return (
    tagName === "P" ||
    tagName === "DIV" ||
    tagName === "SECTION" ||
    tagName === "ARTICLE" ||
    tagName === "UL" ||
    tagName === "OL" ||
    tagName === "LI" ||
    tagName === "PRE" ||
    tagName === "TABLE" ||
    tagName === "HR" ||
    /^H[1-6]$/.test(tagName)
  );
}

function escapeInlineCode(text) {
  const t = String(text ?? "");
  if (!t.includes("`")) return `\`${t}\``;
  const fence = "``";
  return `${fence}${t.replaceAll("``", "` `")}${fence}`;
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ");
}

function cleanCellText(text) {
  return normalizeText(text).replace(/\|/g, "\\|").trim();
}

function extractLanguageFromCodeEl(codeEl) {
  if (!codeEl) return "";
  const cls = codeEl.className || "";
  const m = cls.match(/\blanguage-([a-zA-Z0-9_+-]+)\b/);
  return m ? m[1] : "";
}

function isLikelyContentImage(imgEl) {
  if (!imgEl) return false;
  const alt = (imgEl.getAttribute("alt") || "").trim();
  const cls = imgEl.className || "";
  const width = Number(imgEl.getAttribute("width") || 0);
  const height = Number(imgEl.getAttribute("height") || 0);
  const src = imgEl.getAttribute("src") || "";

  if (!src) return false;
  if (cls.includes("icon")) return false;
  if (width > 0 && width <= 64 && height > 0 && height <= 64) return false;
  if (/^data:/.test(src)) return false;

  // Prefer images that look like user uploads or image generation outputs.
  if (alt.toLowerCase().includes("uploaded image")) return true;
  if (src.includes("/backend-api/estuary/content")) return true;
  if (src.includes("images.openai.com")) return true;

  // Otherwise, keep only if it appears inside a conversation turn.
  return true;
}

function makeImageFilename(index, url) {
  const ext = (() => {
    try {
      const u = new URL(url);
      const pathname = u.pathname || "";
      const match = pathname.match(/\.([a-zA-Z0-9]{1,5})$/);
      if (!match) return null;
      return match[1].toLowerCase();
    } catch {
      return null;
    }
  })();

  const safeExt = ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ext : "png";
  const n = String(index).padStart(3, "0");
  return `image-${n}.${safeExt}`;
}

function createMarkdownConverter({ downloadImages, imageFolder, imageCollector }) {
  function convertChildren(el, ctx) {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      out += convertNode(child, ctx);
    }
    return out;
  }

  function convertTable(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll("tr"));
    if (rows.length === 0) return "";

    const getCells = (row) =>
      Array.from(row.children)
        .filter((c) => c.tagName === "TD" || c.tagName === "TH")
        .map((c) => cleanCellText(c.textContent || ""));

    let headerCells = [];
    let bodyRows = [];

    const firstCells = getCells(rows[0]);
    const firstRowHasTH = Array.from(rows[0].children).some((c) => c.tagName === "TH");

    if (firstRowHasTH) {
      headerCells = firstCells;
      bodyRows = rows.slice(1).map(getCells);
    } else {
      headerCells = firstCells.map((_, idx) => `Column ${idx + 1}`);
      bodyRows = rows.map(getCells);
    }

    const colCount = Math.max(
      headerCells.length,
      ...bodyRows.map((r) => r.length),
      1
    );

    const padRow = (cells) => {
      const padded = cells.slice(0, colCount);
      while (padded.length < colCount) padded.push("");
      return padded;
    };

    const header = padRow(headerCells);
    const sep = new Array(colCount).fill("---");
    const body = bodyRows.map(padRow);

    const line = (cells) => `| ${cells.join(" | ")} |`;
    const lines = [line(header), line(sep), ...body.map(line)];
    return `${lines.join("\n")}\n\n`;
  }

  function convertList(listEl, ctx) {
    const isOrdered = listEl.tagName === "OL";
    const items = Array.from(listEl.children).filter((c) => c.tagName === "LI");
    let out = "";
    for (let i = 0; i < items.length; i++) {
      const prefix = isOrdered ? `${i + 1}. ` : `- `;
      const itemText = convertChildren(items[i], { ...ctx, listDepth: (ctx.listDepth || 0) + 1 }).trim();
      const indent = "  ".repeat(ctx.listDepth || 0);
      const lines = itemText.split("\n");
      if (lines.length === 0) continue;
      out += `${indent}${prefix}${lines[0]}\n`;
      for (const lineText of lines.slice(1)) {
        out += `${indent}   ${lineText}\n`;
      }
    }
    return `${out}\n`;
  }

  function convertBlockquote(el, ctx) {
    const inner = convertChildren(el, ctx).trim();
    const lines = inner.split("\n").map((l) => `> ${l}`.trimEnd());
    return `${lines.join("\n")}\n\n`;
  }

  function convertNode(node, ctx) {
    if (isText(node)) {
      const text = node.nodeValue ?? "";
      if (!text) return "";
      if (ctx.inPre) return text;
      return text.replace(/\s+/g, " ");
    }

    if (!isElement(node)) return "";

    const el = node;
    const tag = el.tagName;

    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return "";
    if (tag === "BUTTON" || tag === "SVG" || tag === "USE" || tag === "LABEL") return "";

    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n---\n\n";

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = convertChildren(el, { ...ctx, inInline: true }).trim();
      return `\n${"#".repeat(level)} ${text}\n\n`;
    }

    if (tag === "P") {
      const text = convertChildren(el, { ...ctx, inInline: true }).trim();
      return text ? `${text}\n\n` : "";
    }

    if (tag === "STRONG" || tag === "B") {
      const inner = convertChildren(el, { ...ctx, inInline: true });
      return `**${inner}**`;
    }

    if (tag === "EM" || tag === "I") {
      const inner = convertChildren(el, { ...ctx, inInline: true });
      return `*${inner}*`;
    }

    if (tag === "CODE") {
      if (ctx.inPre) return el.textContent ?? "";
      return escapeInlineCode((el.textContent ?? "").trim());
    }

    if (tag === "PRE") {
      const codeEl = el.querySelector("code");
      const language = extractLanguageFromCodeEl(codeEl) || "";
      const raw = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
      const fence = "```";
      return `\n${fence}${language}\n${raw}\n${fence}\n\n`;
    }

    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      const text = convertChildren(el, { ...ctx, inInline: true }).trim() || href;
      if (!href) return text;
      return `[${text}](${href})`;
    }

    if (tag === "IMG") {
      if (!isLikelyContentImage(el)) return "";
      const alt = (el.getAttribute("alt") || "").trim();
      const url = el.src || el.getAttribute("src") || "";
      if (!url) return "";

      if (downloadImages) {
        const idx = imageCollector.length + 1;
        const name = makeImageFilename(idx, url);
        imageCollector.push({ url, name, alt });
        return `![${alt}](${imageFolder}/${name})`;
      }

      return `![${alt}](${url})`;
    }

    if (tag === "UL" || tag === "OL") {
      return convertList(el, ctx);
    }

    if (tag === "LI") {
      // Handled by parent list to keep numbering/bullets.
      return convertChildren(el, ctx);
    }

    if (tag === "TABLE") {
      return convertTable(el);
    }

    if (tag === "BLOCKQUOTE") {
      return convertBlockquote(el, ctx);
    }

    // Default: inline-ish span/div passthrough.
    const out = convertChildren(el, ctx);

    // If it's a block tag, make sure we separate blocks.
    if (isBlockTag(tag) && out.trim()) return `${out}\n\n`;
    return out;
  }

  return {
    convertElement: (el) => convertNode(el, { inInline: false, inPre: false, listDepth: 0 })
  };
}

function extractConversation({ downloadImages }) {
  const title = document.title || "ChatGPT Conversation";
  const safeTitle = sanitizeFilenamePart(title);
  const mdFilename = `${safeTitle}.md`;
  const imageFolder = `${safeTitle}-assets`;

  const root =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;

  const turnArticles = Array.from(root.querySelectorAll('article[data-testid^="conversation-turn-"]'));
  if (turnArticles.length === 0) {
    return { ok: false, error: "No conversation turns found." };
  }

  const imageCollector = [];
  const converter = createMarkdownConverter({
    downloadImages,
    imageFolder,
    imageCollector
  });

  let md = `# ${safeTitle}\n\n`;

  for (const article of turnArticles) {
    const turnRole = article.getAttribute("data-turn") || "";
    const messageEls = Array.from(article.querySelectorAll("[data-message-author-role]"));
    if (messageEls.length === 0) continue;

    const hasMessageAncestor = (el) => Boolean(el.closest("[data-message-author-role]"));

    if (turnRole === "user") {
      const userMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "user");
      if (userMsgs.length === 0) continue;

      md += `## User\n\n`;
      for (const msgEl of userMsgs) {
        const userTextEl = msgEl.querySelector(".whitespace-pre-wrap");
        const text = (userTextEl?.textContent ?? msgEl.textContent ?? "").trim();
        if (text) md += `${text}\n\n`;

        const imgs = Array.from(msgEl.querySelectorAll("img")).filter(isLikelyContentImage);
        for (const img of imgs) {
          const imgMd = converter.convertElement(img).trim();
          if (imgMd) md += `${imgMd}\n\n`;
        }
      }

      continue;
    }

    if (turnRole === "assistant") {
      md += `## Assistant\n\n`;

      // Build best-effort export blocks, including tool runs that may sit outside
      // the assistant message container.
      const blocks = [];

      const assistantMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "assistant");
      for (const msgEl of assistantMsgs) {
        const markdownRoot = msgEl.querySelector(".markdown") || msgEl;
        blocks.push({ type: "assistant_message", el: markdownRoot });
      }

      // Tool/code blocks: pre>code with language-* outside the assistant message container.
      for (const preEl of Array.from(article.querySelectorAll("pre"))) {
        if (hasMessageAncestor(preEl)) continue;
        const codeEl = preEl.querySelector("code");
        if (codeEl) {
          blocks.push({ type: "tool_code", el: preEl });
          continue;
        }

        // Tool output blocks: plain <pre> near a "Result" label.
        const container = preEl.closest("div");
        const looksLikeResult =
          container &&
          Array.from(container.querySelectorAll("div")).some((d) => (d.textContent || "").trim() === "Result");
        if (looksLikeResult) {
          blocks.push({ type: "tool_output", el: preEl });
        }
      }

      // Sort by DOM order.
      blocks.sort((a, b) => {
        if (a.el === b.el) return 0;
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      const seen = new Set();
      for (const block of blocks) {
        if (!block?.el || seen.has(block.el)) continue;
        seen.add(block.el);

        if (block.type === "tool_output") {
          const output = (block.el.textContent ?? "").replace(/\n$/, "");
          if (!output.trim()) continue;
          md += `**Result:**\n\n\`\`\`text\n${output}\n\`\`\`\n\n`;
          continue;
        }

        const chunk = converter.convertElement(block.el).trim();
        if (chunk) md += `${chunk}\n\n`;
      }

      continue;
    }

    // Fallback (unknown turn role): export all message elements in order.
    for (const msgEl of messageEls) {
      const role = msgEl.getAttribute("data-message-author-role") || "unknown";
      md += `## ${role}\n\n${converter.convertElement(msgEl).trim()}\n\n`;
    }
  }

  const images = downloadImages
    ? imageCollector.map((img, idx) => ({
        url: img.url,
        filename: `${imageFolder}/${img.name}`,
        alt: img.alt,
        index: idx + 1
      }))
    : [];

  return { ok: true, title: safeTitle, filename: mdFilename, markdown: md.trim() + "\n", images };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    const ok = Boolean(document.querySelector('article[data-testid^="conversation-turn-"]'));
    sendResponse({ ok });
    return;
  }

  if (message?.type === "EXTRACT_CONVERSATION") {
    const options = message.options || {};
    const res = extractConversation({ downloadImages: Boolean(options.downloadImages) });
    sendResponse(res);
    return;
  }
});
