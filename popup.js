const STORAGE_KEY = "chatgpt_md_downloader_settings";

function setAppName(text) {
  const el = document.getElementById("appName");
  if (el && text) el.textContent = `${text} → Markdown`;
}

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ping(tabId, { attempts = 8, delayMs = 350 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (res?.ok === true) return res;
      if (res?.providerName) return res;
    } catch {
      // Content script may not be ready yet.
    }

    if (i < attempts - 1) {
      await delay(delayMs);
    }
  }

  return false;
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
  const setButtonsEnabled = (enabled) => {
    copyMarkdownEl.disabled = !enabled;
    saveDownloadsEl.disabled = !enabled;
    saveAsEl.disabled = !enabled;
  };

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

  const pingResult = await ping(tabId);
  if (pingResult?.providerName) {
    setAppName(pingResult.providerName);
  }

  if (!pingResult?.ok) {
    setStatus("Open a loaded ChatGPT or Claude conversation tab.");
    setStatusError(true);
    return;
  }

  setStatus(`Ready for ${pingResult.providerName ?? "conversation export"}.`);
  setStatusError(false);
  setButtonsEnabled(true);

  copyMarkdownEl.addEventListener("click", async () => {
    setButtonsEnabled(false);
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
      setButtonsEnabled(true);
    }
  });

  saveDownloadsEl.addEventListener("click", async () => {
    setButtonsEnabled(false);
    setStatus("Exporting…");
    setStatusError(false);

    try {
      const downloadImages = downloadImagesEl.checked;
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_CONVERSATION",
        saveAs: false,
        downloadImages
      });
      setStatus(res?.ok ? "Downloaded." : `Failed: ${res?.error ?? "unknown error"}`);
      setStatusError(!res?.ok);
    } catch (err) {
      setStatus(`Failed: ${String(err?.message ?? err)}`);
      setStatusError(true);
    } finally {
      setButtonsEnabled(true);
    }
  });

  saveAsEl.addEventListener("click", async () => {
    setButtonsEnabled(false);
    setStatus("Exporting…");
    setStatusError(false);

    try {
      const downloadImages = downloadImagesEl.checked;
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_CONVERSATION",
        saveAs: true,
        downloadImages
      });
      setStatus(res?.ok ? "Saved." : `Failed: ${res?.error ?? "unknown error"}`);
      setStatusError(!res?.ok);
    } catch (err) {
      setStatus(`Failed: ${String(err?.message ?? err)}`);
      setStatusError(true);
    } finally {
      setButtonsEnabled(true);
    }
  });
}

main().catch((err) => {
  setStatus(`Error: ${String(err?.message ?? err)}`);
});
