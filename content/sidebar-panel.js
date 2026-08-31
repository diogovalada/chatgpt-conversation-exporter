(() => {
  const ns = window.ChatExporter;

  function ensureSidebarPanelStyles() {
    if (document.getElementById("chat-exporter-style")) return;

    const style = document.createElement("style");
    style.id = "chat-exporter-style";
    style.textContent = `
      .chat-exporter-backdrop{
        position:fixed; inset:0; background:rgba(0,0,0,.35);
        z-index:2147483646;
      }
      .chat-exporter-panel{
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
      .chat-exporter-row{display:flex; align-items:center; justify-content:space-between; gap:10px;}
      .chat-exporter-title{font-weight:600;}
      .chat-exporter-muted{color:rgba(255,255,255,.7); font-size:12px; margin-top:6px;}
      .chat-exporter-btn-full{width:100%; margin-top:12px;}
      .chat-exporter-actions{display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;}
      .chat-exporter-btn{
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.10);
        color:#fff;
        padding:8px 10px;
        border-radius:10px;
        cursor:pointer;
        user-select:none;
      }
      .chat-exporter-btn-primary{background:#2563eb; border-color:#2563eb;}
      .chat-exporter-btn:disabled{opacity:.6; cursor:not-allowed;}
      .chat-exporter-x{
        background:transparent; border:none; color:rgba(255,255,255,.75);
        cursor:pointer; padding:4px 6px; border-radius:8px;
      }
      .chat-exporter-x:hover{background:rgba(255,255,255,.08); color:#fff;}
      .chat-exporter-checkbox{display:flex; align-items:center; gap:8px; margin-top:10px; user-select:none;}
      .chat-exporter-status{margin-top:10px; font-size:12px; color:rgba(255,255,255,.75);}
      .chat-exporter-status-error{color:#fca5a5;}
      .chat-exporter-status-ok{color:#86efac;}
    `;
    document.documentElement.appendChild(style);
  }

  async function loadSettings() {
    const res = await chrome.storage.local.get({ [ns.STORAGE_KEY]: { downloadImages: false } });
    return res[ns.STORAGE_KEY];
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ [ns.STORAGE_KEY]: settings });
  }

  function isExtensionContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function closeSidebarPanel() {
    document.getElementById("chat-exporter-backdrop")?.remove();
    document.getElementById("chat-exporter-panel")?.remove();
  }

  function setPanelStatus(text, kind) {
    const el = document.getElementById("chat-exporter-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("chat-exporter-status-error", kind === "error");
    el.classList.toggle("chat-exporter-status-ok", kind === "ok");
  }

  function showRefreshRequiredPanel(selection) {
    closeSidebarPanel();

    const backdrop = document.createElement("div");
    backdrop.id = "chat-exporter-backdrop";
    backdrop.className = "chat-exporter-backdrop";
    backdrop.addEventListener("click", () => closeSidebarPanel());
    document.body.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.id = "chat-exporter-panel";
    panel.className = "chat-exporter-panel";
    panel.innerHTML = `
      <div class="chat-exporter-row">
        <div class="chat-exporter-title">Extension reloaded</div>
        <button class="chat-exporter-x" type="button" aria-label="Close">✕</button>
      </div>
      <div class="chat-exporter-muted">
        Refresh this ChatGPT page before downloading ${String(selection?.title || "the conversation")}.
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".chat-exporter-x")?.addEventListener("click", () => closeSidebarPanel());
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back when clipboard API is unavailable or blocked.
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

  async function openSidebarPanel(selection) {
    ensureSidebarPanelStyles();
    closeSidebarPanel();

    let settings;
    try {
      settings = await loadSettings();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showRefreshRequiredPanel(selection);
        return;
      }
      throw error;
    }
    const providerName = String(selection?.providerName || "conversation");
    const selectedTitle = String(selection?.title || "Conversation");

    const backdrop = document.createElement("div");
    backdrop.id = "chat-exporter-backdrop";
    backdrop.className = "chat-exporter-backdrop";
    backdrop.addEventListener("click", () => closeSidebarPanel());
    document.body.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.id = "chat-exporter-panel";
    panel.className = "chat-exporter-panel";
    panel.innerHTML = `
      <div class="chat-exporter-row">
        <div class="chat-exporter-title">Download ${providerName} conversation</div>
        <button class="chat-exporter-x" type="button" aria-label="Close">✕</button>
      </div>
      <div class="chat-exporter-muted"><strong>Selected:</strong> <span id="chat-exporter-selected"></span></div>
      <label class="chat-exporter-checkbox">
        <input type="checkbox" id="chat-exporter-images" />
        Download images (bundles as .zip)
      </label>
      <button class="chat-exporter-btn chat-exporter-btn-primary chat-exporter-btn-full" id="chat-exporter-copy">Copy Markdown</button>
      <div class="chat-exporter-actions">
        <button class="chat-exporter-btn chat-exporter-btn-primary" id="chat-exporter-save">Save to Downloads</button>
        <button class="chat-exporter-btn" id="chat-exporter-saveas">Save As…</button>
      </div>
      <div class="chat-exporter-status" id="chat-exporter-status"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector(".chat-exporter-x")?.addEventListener("click", () => closeSidebarPanel());
    panel.querySelector("#chat-exporter-selected").textContent = selectedTitle;

    const cb = panel.querySelector("#chat-exporter-images");
    cb.checked = Boolean(settings.downloadImages);
    cb.addEventListener("change", async () => {
      try {
        await saveSettings({ downloadImages: cb.checked });
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          setPanelStatus("Extension reloaded. Refresh this ChatGPT page.", "error");
          return;
        }
        setPanelStatus(`Failed: ${String(error?.message || error)}`, "error");
      }
    });

    const copyBtn = panel.querySelector("#chat-exporter-copy");
    const saveBtn = panel.querySelector("#chat-exporter-save");
    const saveAsBtn = panel.querySelector("#chat-exporter-saveas");

    const withDisabled = async (fn) => {
      copyBtn.disabled = true;
      saveBtn.disabled = true;
      saveAsBtn.disabled = true;
      try {
        return await fn();
      } finally {
        copyBtn.disabled = false;
        saveBtn.disabled = false;
        saveAsBtn.disabled = false;
      }
    };

    copyBtn.addEventListener("click", async () => {
      await withDisabled(async () => {
        setPanelStatus("Copying…");

        try {
          const res = await chrome.runtime.sendMessage({
            type: "GET_MARKDOWN_BY_URL",
            url: selection.url,
            title: selection.title
          });

          if (!res?.ok) {
            setPanelStatus(`Failed: ${res?.error ?? "unknown error"}`, "error");
            return;
          }

          const ok = await copyTextToClipboard(res.markdown ?? "");
          if (!ok) {
            setPanelStatus("Failed: clipboard write was blocked.", "error");
            return;
          }

          setPanelStatus("Copied Markdown to clipboard.", "ok");
        } catch (err) {
          setPanelStatus(`Failed: ${String(err?.message ?? err)}`, "error");
        }
      });
    });

    const run = async (saveAs) => {
      await withDisabled(async () => {
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
        }
      });
    };

    saveBtn.addEventListener("click", () => run(false));
    saveAsBtn.addEventListener("click", () => run(true));
  }

  ns.closeSidebarPanel = closeSidebarPanel;
  ns.openSidebarPanel = openSidebarPanel;
})();
