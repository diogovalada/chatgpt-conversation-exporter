const STORAGE_KEY = "chatgpt_md_downloader_settings";

function setStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text;
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
    return;
  }

  const supported = await ping(tabId);
  if (!supported) {
    setStatus("Open a ChatGPT conversation tab.");
    return;
  }

  setStatus("Ready.");
  saveDownloadsEl.disabled = false;
  saveAsEl.disabled = false;

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

