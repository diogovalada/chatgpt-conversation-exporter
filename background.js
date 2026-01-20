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

function fileExtFromUrl(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname || "";
    const match = pathname.match(/\.([a-zA-Z0-9]{1,5})$/);
    if (!match) return null;
    return match[1].toLowerCase();
  } catch {
    return null;
  }
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

    const mdUrl = dataUrlForMarkdown(markdown);
    await chrome.downloads.download({
      url: mdUrl,
      filename,
      saveAs: Boolean(message.saveAs)
    });

    if (Array.isArray(extraction.images) && extraction.images.length > 0) {
      // Best-effort: download images into a subfolder next to the .md, when possible.
      // Note: if the user uses Save As… for the .md, these may still land in Downloads.
      for (let i = 0; i < extraction.images.length; i++) {
        const img = extraction.images[i];
        if (!img?.url || !img?.filename) continue;

        await chrome.downloads.download({
          url: img.url,
          filename: img.filename,
          saveAs: false,
          conflictAction: "uniquify"
        });
      }
    }

    sendResponse({ ok: true });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message ?? err) });
  });

  return true;
});

