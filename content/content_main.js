(() => {
  const ns = window.ChatExporter;
  const provider = ns.getPrimaryProvider();

  provider?.initSidebarIntegration?.((selection) => ns.openSidebarPanel(selection));

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
      sendResponse(ns.extractConversation(message.options || {}));
      return true;
    }

    return false;
  });
})();
