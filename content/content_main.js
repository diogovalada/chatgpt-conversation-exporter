(() => {
  const ns = window.ChatExporter;
  const provider = ns.getPrimaryProvider();

  provider?.initSidebarIntegration?.((selection) => {
    void ns.openSidebarPanel(selection).catch((error) => {
      console.error("AI Conversation Exporter could not open the download panel.", error);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      const primaryProvider = ns.getPrimaryProvider();
      const activeProvider = ns.getActiveProvider();
      sendResponse({
        ok: Boolean(activeProvider?.hasConversation?.()),
        providerId: activeProvider?.id ?? primaryProvider?.id ?? null,
        providerName: activeProvider?.name ?? primaryProvider?.name ?? null
      });
      return true;
    }

    if (message?.type === "EXTRACT_CONVERSATION") {
      (async () => {
        try {
          sendResponse(await ns.extractConversation(message.options || {}));
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err || "Extraction failed.") });
        }
      })();
      return true;
    }

    return false;
  });
})();
