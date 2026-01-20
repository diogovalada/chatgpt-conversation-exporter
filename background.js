import { strToU8, zipSync } from "./vendor/fflate.browser.esm.js";

function sanitizeFilenamePart(input) {
  const trimmed = String(input ?? "").trim();
  const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  const noBadChars = noControl.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return noBadChars || "ChatGPT Conversation";
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
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const ct = res.headers.get("content-type") || "";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { buf, contentType: ct };
}

function linkDest(raw) {
  return `<${encodeURI(String(raw ?? ""))}>`;
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
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: zipName,
      saveAs: Boolean(saveAs)
    });
  } finally {
    // Give Chrome a moment to start the download before releasing.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
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

    const title = extraction.title ?? "ChatGPT Conversation";
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
