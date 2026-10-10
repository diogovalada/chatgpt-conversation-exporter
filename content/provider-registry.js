(() => {
  const ns = window.ChatExporter;

  ns.providers = ns.providers || [];

  ns.registerProvider = (provider) => {
    if (!provider?.id) return;
    if (ns.providers.some((existing) => existing.id === provider.id)) return;
    ns.providers.push(provider);
  };

  ns.getLoadedProviders = () => ns.providers.slice();

  ns.getPrimaryProvider = () => ns.providers[0] || null;

  ns.getActiveProvider = (options = {}) => {
    const providers = ns.getLoadedProviders();
    const url = options.conversationUrl || location.href;
    for (const provider of providers) {
      if (provider.matchesUrl?.(url)) return provider;
    }
    for (const provider of providers) {
      try {
        if (provider.matchesUrl && !provider.matchesUrl(url)) continue;
        if (provider?.hasConversation?.()) return provider;
      } catch {
        // Ignore provider detection errors and keep trying.
      }
    }

    return providers[0] || null;
  };
})();
