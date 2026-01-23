const STORAGE_KEY = "chatgpt_md_downloader_settings";

function setStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text;
}

function setStatusError(isError) {
  const el = document.getElementById("status");
  el.classList.toggle("status-error", Boolean(isError));
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall back
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return res?.ok === true;
  } catch {
    return false;
  }
}

async function loadSettings() {
  const res = await chrome.storage.local.get({ [STORAGE_KEY]: { downloadImages: false } });
  return res[STORAGE_KEY];
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

async function main() {
  const downloadImagesEl = document.getElementById("downloadImages");
  const copyMarkdownEl = document.getElementById("copyMarkdown");
  const saveDownloadsEl = document.getElementById("saveDownloads");
  const saveAsEl = document.getElementById("saveAs");

  const settings = await loadSettings();
  downloadImagesEl.checked = Boolean(settings.downloadImages);

  downloadImagesEl.addEventListener("change", async () => {
    await saveSettings({ downloadImages: downloadImagesEl.checked });
  });

  const tabId = await getActiveTabId();
  if (!tabId) {
    setStatus("No active tab.");
    setStatusError(true);
    return;
  }

  const supported = await ping(tabId);
  if (!supported) {
    setStatus("Open a ChatGPT conversation tab.");
    setStatusError(true);
    return;
  }

  setStatus("Ready.");
  setStatusError(false);
  copyMarkdownEl.disabled = false;
  saveDownloadsEl.disabled = false;
  saveAsEl.disabled = false;

  copyMarkdownEl.addEventListener("click", async () => {
    copyMarkdownEl.disabled = true;
    saveDownloadsEl.disabled = true;
    saveAsEl.disabled = true;
    setStatus("Copying…");
    setStatusError(false);

    try {
      const extraction = await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_CONVERSATION",
        options: { downloadImages: false }
      });

      if (!extraction?.ok) {
        setStatus(`Failed: ${extraction?.error ?? "Extraction failed."}`);
        setStatusError(true);
        return;
      }

      const markdown = extraction.markdown ?? "";
      const ok = await copyToClipboard(markdown);
      if (!ok) {
        setStatus("Failed: clipboard write was blocked.");
        setStatusError(true);
        return;
      }

      setStatus("Copied Markdown to clipboard.");
      setStatusError(false);
    } catch (err) {
      setStatus(`Failed: ${String(err?.message ?? err)}`);
      setStatusError(true);
    } finally {
      copyMarkdownEl.disabled = false;
      saveDownloadsEl.disabled = false;
      saveAsEl.disabled = false;
    }
  });

  saveDownloadsEl.addEventListener("click", async () => {
    saveDownloadsEl.disabled = true;
    saveAsEl.disabled = true;
    setStatus("Exporting…");
    const downloadImages = downloadImagesEl.checked;
    const res = await chrome.runtime.sendMessage({
      type: "EXPORT_CONVERSATION",
      saveAs: false,
      downloadImages
    });
    setStatus(res?.ok ? "Downloaded." : `Failed: ${res?.error ?? "unknown error"}`);
  });

  saveAsEl.addEventListener("click", async () => {
    saveDownloadsEl.disabled = true;
    saveAsEl.disabled = true;
    setStatus("Exporting…");
    const downloadImages = downloadImagesEl.checked;
    const res = await chrome.runtime.sendMessage({
      type: "EXPORT_CONVERSATION",
      saveAs: true,
      downloadImages
    });
    setStatus(res?.ok ? "Saved." : `Failed: ${res?.error ?? "unknown error"}`);
  });
}

main().catch((err) => {
  setStatus(`Error: ${String(err?.message ?? err)}`);
});
