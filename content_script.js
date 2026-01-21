function sanitizeFilenamePart(input) {
  const trimmed = String(input ?? "").trim();
  const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  const noBadChars = noControl.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return noBadChars || "ChatGPT Conversation";
}

const STORAGE_KEY = "chatgpt_md_downloader_settings";

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
  const n = String(index).padStart(3, "0");
  // Intentionally omit extension; background determines correct extension when packaging.
  return `image-${n}`;
}

function createMarkdownConverter({ downloadImages, imageFolder, imageCollector }) {
  const linkDest = (raw) => `<${encodeURI(String(raw ?? ""))}>`;

  function extractLatexFromKatex(el) {
    const ann = el.querySelector?.('annotation[encoding="application/x-tex"]');
    const tex = (ann?.textContent ?? "").trim();
    return tex || "";
  }

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

    // ChatGPT renders math via KaTeX. Prefer extracting the original LaTeX
    // (annotation[encoding="application/x-tex"]) instead of textContent, which
    // often concatenates multiple representations (MathML + rendered HTML).
    if (el.classList?.contains("katex-display")) {
      const tex = extractLatexFromKatex(el);
      if (tex) return `\n$$\n${tex}\n$$\n\n`;
    }

    if (el.classList?.contains("katex")) {
      const tex = extractLatexFromKatex(el);
      if (tex) return `$${tex}$`;
    }

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
      return `[${text}](${linkDest(href)})`;
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
        return `![${alt}](${linkDest(`${imageFolder}/${name}`)})`;
      }

      return `![${alt}](${linkDest(url)})`;
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

function extractConversation({ downloadImages, titleOverride }) {
  const title = String(titleOverride || document.title || "ChatGPT Conversation");
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
        key: img.name,
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
    const res = extractConversation({
      downloadImages: Boolean(options.downloadImages),
      titleOverride: options.titleOverride
    });
    sendResponse(res);
    return;
  }
});

// Sidebar integration: inject "Download" into the conversation 3-dots menu (under "Share").
let lastSidebarSelection = null;

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function isConversationHref(href) {
  try {
    const u = new URL(href, location.origin);
    return /\/c\/[0-9a-f-]{12,}/i.test(u.pathname);
  } catch {
    return false;
  }
}

function getSidebarSelectionFromEventTarget(target) {
  const el = target?.nodeType === Node.ELEMENT_NODE ? target : null;
  if (!el) return null;

  // Heuristic: find a nearby anchor that points to a conversation.
  const a =
    el.closest('a[href*="/c/"]') ||
    el.closest("button")?.closest("a") ||
    el.closest("li")?.querySelector?.('a[href*="/c/"]') ||
    null;

  const href = a?.getAttribute?.("href") || a?.href || "";
  if (!href || !isConversationHref(href)) return null;

  const url = new URL(href, location.origin).toString();
  const title =
    normalizeText(a?.getAttribute?.("title")) ||
    normalizeText(a?.textContent) ||
    "ChatGPT Conversation";

  return { url, title };
}

function ensureSidebarPanelStyles() {
  if (document.getElementById("cgpt-md-dl-style")) return;
  const style = document.createElement("style");
  style.id = "cgpt-md-dl-style";
  style.textContent = `
    .cgpt-md-dl-backdrop{
      position:fixed; inset:0; background:rgba(0,0,0,.35);
      z-index:2147483646;
    }
    .cgpt-md-dl-panel{
      position:fixed;
      inset:auto 16px 16px 16px;
      max-width:520px;
      margin-left:auto;
      background:rgba(20,20,20,.96);
      color:#fff;
      border:1px solid rgba(255,255,255,.12);
      border-radius:12px;
      padding:12px;
      z-index:2147483647;
      font:13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      box-shadow:0 10px 30px rgba(0,0,0,.4);
    }
    .cgpt-md-dl-row{display:flex; align-items:center; justify-content:space-between; gap:10px;}
    .cgpt-md-dl-title{font-weight:600;}
    .cgpt-md-dl-muted{color:rgba(255,255,255,.7); font-size:12px; margin-top:6px;}
    .cgpt-md-dl-actions{display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;}
    .cgpt-md-dl-btn{
      border:1px solid rgba(255,255,255,.14);
      background:rgba(255,255,255,.10);
      color:#fff;
      padding:8px 10px;
      border-radius:10px;
      cursor:pointer;
      user-select:none;
    }
    .cgpt-md-dl-btn-primary{background:#2563eb; border-color:#2563eb;}
    .cgpt-md-dl-btn:disabled{opacity:.6; cursor:not-allowed;}
    .cgpt-md-dl-x{
      background:transparent; border:none; color:rgba(255,255,255,.75);
      cursor:pointer; padding:4px 6px; border-radius:8px;
    }
    .cgpt-md-dl-x:hover{background:rgba(255,255,255,.08); color:#fff;}
    .cgpt-md-dl-checkbox{display:flex; align-items:center; gap:8px; margin-top:10px; user-select:none;}
    .cgpt-md-dl-status{margin-top:10px; font-size:12px; color:rgba(255,255,255,.75);}
    .cgpt-md-dl-status-error{color:#fca5a5;}
    .cgpt-md-dl-status-ok{color:#86efac;}
  `;
  document.documentElement.appendChild(style);
}

async function loadSettings() {
  const res = await chrome.storage.local.get({ [STORAGE_KEY]: { downloadImages: false } });
  return res[STORAGE_KEY];
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function closeSidebarPanel() {
  document.getElementById("cgpt-md-dl-backdrop")?.remove();
  document.getElementById("cgpt-md-dl-panel")?.remove();
}

function setPanelStatus(text, kind) {
  const el = document.getElementById("cgpt-md-dl-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("cgpt-md-dl-status-error", kind === "error");
  el.classList.toggle("cgpt-md-dl-status-ok", kind === "ok");
}

async function openSidebarPanel(selection) {
  ensureSidebarPanelStyles();
  closeSidebarPanel();

  const settings = await loadSettings();
  const downloadImages = Boolean(settings.downloadImages);

  const backdrop = document.createElement("div");
  backdrop.id = "cgpt-md-dl-backdrop";
  backdrop.className = "cgpt-md-dl-backdrop";
  backdrop.addEventListener("click", () => closeSidebarPanel());
  document.body.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.id = "cgpt-md-dl-panel";
  panel.className = "cgpt-md-dl-panel";

  panel.innerHTML = `
    <div class="cgpt-md-dl-row">
      <div class="cgpt-md-dl-title">Download conversation</div>
      <button class="cgpt-md-dl-x" type="button" aria-label="Close">✕</button>
    </div>
    <div class="cgpt-md-dl-muted"><strong>Selected:</strong> <span id="cgpt-md-dl-selected"></span></div>
    <label class="cgpt-md-dl-checkbox">
      <input type="checkbox" id="cgpt-md-dl-images" />
      Download images (bundles as .zip)
    </label>
    <div class="cgpt-md-dl-actions">
      <button class="cgpt-md-dl-btn cgpt-md-dl-btn-primary" id="cgpt-md-dl-save">Save to Downloads</button>
      <button class="cgpt-md-dl-btn" id="cgpt-md-dl-saveas">Save As…</button>
    </div>
    <div class="cgpt-md-dl-status" id="cgpt-md-dl-status"></div>
  `;

  document.body.appendChild(panel);

  panel.querySelector(".cgpt-md-dl-x")?.addEventListener("click", () => closeSidebarPanel());
  panel.querySelector("#cgpt-md-dl-selected").textContent = selection.title;

  const cb = panel.querySelector("#cgpt-md-dl-images");
  cb.checked = downloadImages;
  cb.addEventListener("change", async () => {
    await saveSettings({ downloadImages: cb.checked });
  });

  const saveBtn = panel.querySelector("#cgpt-md-dl-save");
  const saveAsBtn = panel.querySelector("#cgpt-md-dl-saveas");

  const run = async (saveAs) => {
    saveBtn.disabled = true;
    saveAsBtn.disabled = true;
    setPanelStatus("Exporting…");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_CONVERSATION_BY_URL",
        url: selection.url,
        title: selection.title,
        saveAs,
        downloadImages: cb.checked
      });
      if (res?.ok) {
        setPanelStatus(cb.checked ? "Downloaded (.zip)." : "Downloaded (.md).", "ok");
      } else {
        setPanelStatus(`Failed: ${res?.error ?? "unknown error"}`, "error");
      }
    } catch (err) {
      setPanelStatus(`Failed: ${String(err?.message ?? err)}`, "error");
    } finally {
      saveBtn.disabled = false;
      saveAsBtn.disabled = false;
    }
  };

  saveBtn.addEventListener("click", () => run(false));
  saveAsBtn.addEventListener("click", () => run(true));
}

function maybeCloseRadixMenu() {
  // Best-effort: close Radix/portal menus by sending Escape.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function injectDownloadIntoMenu(menuEl) {
  if (!menuEl || menuEl.nodeType !== Node.ELEMENT_NODE) return;
  if (menuEl.dataset.cgptMdDlInjected === "1") return;
  if (!lastSidebarSelection?.url) return;

  const menuItems = Array.from(menuEl.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]'));
  if (menuItems.length === 0) return;

  const shareItem =
    menuItems.find((el) => normalizeText(el.textContent).toLowerCase() === "share") ||
    menuItems.find((el) => normalizeText(el.textContent).toLowerCase().startsWith("share")) ||
    menuItems[0];

  if (!shareItem) return;

  // Avoid injecting in non-conversation menus.
  const isLikelyChatMenu = menuItems.some((el) => normalizeText(el.textContent).toLowerCase().includes("rename")) ||
    menuItems.some((el) => normalizeText(el.textContent).toLowerCase().includes("delete"));
  if (!isLikelyChatMenu) return;

  const downloadItem = shareItem.cloneNode(true);
  downloadItem.dataset.cgptMdDlItem = "1";

  const replaceIconWithDownload = () => {
    const svg = downloadItem.querySelector("svg");
    if (!svg) return;

    // Preserve size/class where possible for consistent styling.
    const width = svg.getAttribute("width") || "20";
    const height = svg.getAttribute("height") || "20";
    const cls = svg.getAttribute("class") || "";

    const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    newSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    newSvg.setAttribute("width", width);
    newSvg.setAttribute("height", height);
    newSvg.setAttribute("viewBox", "0 0 20 20");
    newSvg.setAttribute("fill", "none");
    newSvg.setAttribute("aria-hidden", "true");
    if (cls) newSvg.setAttribute("class", cls);

    // Simple "download" glyph: arrow down into a tray. Stroke uses currentColor.
    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path1.setAttribute("d", "M10 3v8");
    path1.setAttribute("stroke", "currentColor");
    path1.setAttribute("stroke-width", "1.8");
    path1.setAttribute("stroke-linecap", "round");
    path1.setAttribute("stroke-linejoin", "round");

    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path2.setAttribute("d", "M6.5 8.8L10 11.9l3.5-3.1");
    path2.setAttribute("stroke", "currentColor");
    path2.setAttribute("stroke-width", "1.8");
    path2.setAttribute("stroke-linecap", "round");
    path2.setAttribute("stroke-linejoin", "round");

    const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path3.setAttribute("d", "M4.5 14.5h11");
    path3.setAttribute("stroke", "currentColor");
    path3.setAttribute("stroke-width", "1.8");
    path3.setAttribute("stroke-linecap", "round");
    path3.setAttribute("stroke-linejoin", "round");

    newSvg.appendChild(path1);
    newSvg.appendChild(path2);
    newSvg.appendChild(path3);
    svg.replaceWith(newSvg);
  };

  const setHighlighted = (on) => {
    // Radix menus typically style hovered items via the presence of `data-highlighted`.
    // Since cloned nodes don't inherit Radix event handlers, we emulate this attribute
    // for consistent hover styling.
    if (on) {
      for (const el of menuEl.querySelectorAll("[data-highlighted]")) {
        el.removeAttribute("data-highlighted");
      }
      downloadItem.setAttribute("data-highlighted", "");
    } else {
      downloadItem.removeAttribute("data-highlighted");
    }
  };

  downloadItem.addEventListener("pointerenter", () => setHighlighted(true), true);
  downloadItem.addEventListener("pointermove", () => setHighlighted(true), true);
  downloadItem.addEventListener("pointerleave", () => setHighlighted(false), true);

  replaceIconWithDownload();

  // Replace label text.
  const walker = document.createTreeWalker(downloadItem, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (normalizeText(t.nodeValue).toLowerCase().includes("share")) {
      t.nodeValue = t.nodeValue.replace(/share/i, "Download");
    }
  }
  if (!normalizeText(downloadItem.textContent)) {
    downloadItem.textContent = "Download";
  }

  // Fix aria-label if present.
  if (downloadItem.hasAttribute("aria-label")) downloadItem.setAttribute("aria-label", "Download");

  downloadItem.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      maybeCloseRadixMenu();
      openSidebarPanel({ ...lastSidebarSelection });
    },
    true
  );

  shareItem.insertAdjacentElement("afterend", downloadItem);
  menuEl.dataset.cgptMdDlInjected = "1";
}

function startSidebarMenuObserver() {
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes || [])) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        if (el.getAttribute?.("role") === "menu") {
          injectDownloadIntoMenu(el);
        }
        const nestedMenus = el.querySelectorAll?.('[role="menu"]');
        if (nestedMenus?.length) {
          for (const menu of Array.from(nestedMenus)) injectDownloadIntoMenu(menu);
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

function startSidebarSelectionCapture() {
  document.addEventListener(
    "click",
    (e) => {
      const sel = getSidebarSelectionFromEventTarget(e.target);
      if (sel) lastSidebarSelection = sel;
    },
    true
  );
}

startSidebarSelectionCapture();
startSidebarMenuObserver();
