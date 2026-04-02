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

  ns.getActiveProvider = () => {
    const providers = ns.getLoadedProviders();
    for (const provider of providers) {
      try {
        if (provider?.hasConversation?.()) return provider;
      } catch {
        // Ignore provider detection errors and keep trying.
      }
    }

    return providers[0] || null;
  };
})();
