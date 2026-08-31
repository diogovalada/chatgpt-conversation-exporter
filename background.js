import { strToU8, zipSync } from "./vendor/fflate.browser.esm.js";

function sanitizeFilenamePart(input) {
  const trimmed = String(input ?? "").trim();
  const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  const noBadChars = noControl.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return noBadChars || "AI Conversation";
}

function mdFilenameForTitle(title) {
  const base = sanitizeFilenamePart(title);
  return `${base}.md`;
}

function dataUrlForMarkdown(markdown) {
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function extractFromTab(tabId, options) {
  return chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CONVERSATION", options });
}

function extFromContentType(contentType) {
  const ct = String(contentType ?? "").toLowerCase();
  if (ct.includes("image/jpeg")) return "jpg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/gif")) return "gif";
  if (ct.includes("image/svg+xml")) return "svg";
  return "bin";
}

async function fetchAsUint8(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const ct = res.headers.get("content-type") || "";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { buf, contentType: ct };
}

function linkDest(raw) {
  return `<${encodeURI(String(raw ?? ""))}>`;
}

function uint8ToBase64(uint8) {
  // btoa expects a binary string; build it in chunks to avoid call stack limits.
  if (typeof btoa !== "function") {
    throw new Error("Base64 encoding is not available in this context.");
  }

  const parts = [];
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

async function downloadUint8({ bytes, mimeType, filename, saveAs }) {
  // MV3 service workers may not support URL.createObjectURL; fall back to data: URLs.
  if (typeof URL?.createObjectURL === "function" && typeof URL?.revokeObjectURL === "function") {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: Boolean(saveAs) });
      return;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }

  const base64 = uint8ToBase64(bytes);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({ url, filename, saveAs: Boolean(saveAs) });
}

async function downloadZipBundle({ title, mdFilename, markdown, images, saveAs }) {
  const safeTitle = sanitizeFilenamePart(title);
  const zipName = `${safeTitle}.zip`;

  const imageFolder = `${safeTitle}-assets`;

  let patchedMarkdown = markdown;
  const files = {};
  files[mdFilename] = strToU8(patchedMarkdown);

  for (const img of images) {
    if (!img?.url || !img?.key) continue;

    const { buf, contentType } = await fetchAsUint8(img.url);
    const ext = extFromContentType(contentType);
    const filename = `${imageFolder}/${img.key}.${ext}`;

    // Patch markdown occurrences of the placeholder (no extension).
    patchedMarkdown = patchedMarkdown
      .replaceAll(linkDest(`${imageFolder}/${img.key}`), linkDest(`${imageFolder}/${img.key}.${ext}`))
      .replaceAll(`${imageFolder}/${img.key}`, `${imageFolder}/${img.key}.${ext}`);

    files[filename] = buf;
  }

  // Ensure markdown file in zip is patched after image extensions are known.
  files[mdFilename] = strToU8(patchedMarkdown);

  const zipped = zipSync(files, { level: 6 });
  await downloadUint8({
    bytes: zipped,
    mimeType: "application/zip",
    filename: zipName,
    saveAs: Boolean(saveAs)
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForConversationInTab(tabId, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (ping?.ok) return true;
    } catch {
      // Content script not ready yet.
    }
    await delay(500);
  }
  return false;
}

function isChatGptUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com") &&
      /\/c\/[0-9a-f-]{12,}/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

async function canExtractChatGptFromSourceTab(sourceTabId) {
  if (!sourceTabId) return false;
  try {
    const tab = await chrome.tabs.get(sourceTabId);
    const parsed = new URL(tab?.url || "");
    return parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com";
  } catch {
    return false;
  }
}

async function extractConversationFromUrl({
  url,
  title,
  downloadImages,
  sourceTabId
}) {
  if (isChatGptUrl(url) && await canExtractChatGptFromSourceTab(sourceTabId)) {
    const extraction = await extractFromTab(sourceTabId, {
      conversationUrl: url,
      downloadImages: Boolean(downloadImages),
      titleOverride: title
    });
    if (!extraction?.ok) {
      throw new Error(extraction?.error ?? "ChatGPT canonical extraction failed.");
    }
    return extraction;
  }

  const created = await chrome.tabs.create({ url, active: false });
  const tabId = created?.id;
  if (!tabId) throw new Error("Failed to open background tab.");

  try {
    const ready = await waitForConversationInTab(tabId, 90_000);
    if (!ready) throw new Error("Conversation did not load in time.");

    const extraction = await extractFromTab(tabId, {
      downloadImages: Boolean(downloadImages),
      titleOverride: title
    });

    if (!extraction?.ok) throw new Error(extraction?.error ?? "Extraction failed.");
    return extraction;
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // ignore
    }
  }
}

async function getMarkdownFromUrl({ url, title, sourceTabId }) {
  const extraction = await extractConversationFromUrl({
    url,
    title,
    downloadImages: false,
    sourceTabId
  });

  const outTitle = extraction.title ?? title ?? "AI Conversation";
  const outFilename = extraction.filename ?? mdFilenameForTitle(outTitle);
  const markdown = extraction.markdown ?? "";
  return { ok: true, title: outTitle, filename: outFilename, markdown };
}

async function exportConversationFromUrl({
  url,
  title,
  saveAs,
  downloadImages,
  sourceTabId
}) {
  const extraction = await extractConversationFromUrl({
    url,
    title,
    downloadImages,
    sourceTabId
  });

  const outTitle = extraction.title ?? title ?? "AI Conversation";
  const outFilename = extraction.filename ?? mdFilenameForTitle(outTitle);
  const markdown = extraction.markdown ?? "";

  const wantsImages =
    Boolean(downloadImages) && Array.isArray(extraction.images) && extraction.images.length > 0;

  if (wantsImages) {
    await downloadZipBundle({
      title: outTitle,
      mdFilename: outFilename,
      markdown,
      images: extraction.images,
      saveAs: Boolean(saveAs)
    });
    return { ok: true, bundled: "zip" };
  }

  const mdUrl = dataUrlForMarkdown(markdown);
  await chrome.downloads.download({ url: mdUrl, filename: outFilename, saveAs: Boolean(saveAs) });
  return { ok: true, bundled: "md" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_MARKDOWN_BY_URL") {
      const url = String(message.url || "");
      if (!url) {
        sendResponse({ ok: false, error: "Missing conversation URL." });
        return;
      }
      const title = String(message.title || "") || "AI Conversation";
      const res = await getMarkdownFromUrl({ url, title, sourceTabId: sender.tab?.id });
      sendResponse(res);
      return;
    }

    if (message?.type === "GET_MARKDOWN") {
      const tabId = await getActiveTabId();
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }

      let extraction;
      try {
        extraction = await extractFromTab(tabId, { downloadImages: false });
      } catch {
        sendResponse({ ok: false, error: "This page is not supported (content script not available)." });
        return;
      }

      if (!extraction?.ok) {
        sendResponse({ ok: false, error: extraction?.error ?? "Extraction failed." });
        return;
      }

      const title = extraction.title ?? "AI Conversation";
      const filename = extraction.filename ?? mdFilenameForTitle(title);
      const markdown = extraction.markdown ?? "";
      sendResponse({ ok: true, title, filename, markdown });
      return;
    }

    if (message?.type === "EXPORT_CONVERSATION_BY_URL") {
      const url = String(message.url || "");
      if (!url) {
        sendResponse({ ok: false, error: "Missing conversation URL." });
        return;
      }
      const title = String(message.title || "") || "AI Conversation";
      const result = await exportConversationFromUrl({
        url,
        title,
        saveAs: Boolean(message.saveAs),
        downloadImages: Boolean(message.downloadImages),
        sourceTabId: sender.tab?.id
      });
      sendResponse(result);
      return;
    }

    if (message?.type !== "EXPORT_CONVERSATION") {
      sendResponse({ ok: false, error: "Unknown message type." });
      return;
    }

    const tabId = await getActiveTabId();
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab." });
      return;
    }

    let extraction;
    try {
      extraction = await extractFromTab(tabId, { downloadImages: Boolean(message.downloadImages) });
    } catch {
      sendResponse({ ok: false, error: "This page is not supported (content script not available)." });
      return;
    }

    if (!extraction?.ok) {
      sendResponse({ ok: false, error: extraction?.error ?? "Extraction failed." });
      return;
    }

    const title = extraction.title ?? "AI Conversation";
    const filename = extraction.filename ?? mdFilenameForTitle(title);
    const markdown = extraction.markdown ?? "";

    const wantsImages = Boolean(message.downloadImages) && Array.isArray(extraction.images) && extraction.images.length > 0;
    if (wantsImages) {
      // Single Save As prompt + consistent output: bundle into a zip.
      await downloadZipBundle({
        title,
        mdFilename: filename,
        markdown,
        images: extraction.images,
        saveAs: Boolean(message.saveAs)
      });
      sendResponse({ ok: true, bundled: "zip" });
      return;
    }

    const mdUrl = dataUrlForMarkdown(markdown);
    await chrome.downloads.download({ url: mdUrl, filename, saveAs: Boolean(message.saveAs) });

    sendResponse({ ok: true });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message ?? err) });
  });

  return true;
});
