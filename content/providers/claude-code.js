(() => {
  const ns = window.ChatExporter;
  const data = ns.claudeCodeData;
  let prepared = null;

  ns.registerProvider({
    id: "claude-code",
    name: "Claude Code",
    matchesUrl: (url) => Boolean(data.getSessionId(url)),
    hasConversation: (options = {}) => Boolean(data.getSessionId(options.conversationUrl || location.href)),
    async prepareForExtraction(options = {}) {
      prepared = null;
      const url = options.conversationUrl || location.href;
      try {
        const { session, events } = await data.fetchSession(url);
        const descriptors = data.buildTurnDescriptors(events);
        if (!descriptors.length) throw new Error("No messages were returned for this Claude Code session.");
        prepared = { id: data.getSessionId(url), title: session.title, descriptors };
      } catch (error) {
        throw new Error(`Could not export Claude Code history. ${error.message || error} No partial file was saved.`);
      }
    },
    getTitle(options = {}) {
      return prepared?.id === data.getSessionId(options.conversationUrl || location.href)
        ? prepared.title || "Claude Code Session" : "Claude Code Session";
    },
    getTurns(options = {}) {
      if (prepared?.id !== data.getSessionId(options.conversationUrl || location.href)) return [];
      return prepared.descriptors.map((descriptor) => ({
        id: descriptor.id,
        role: descriptor.role,
        toMarkdown: (converter) => data.renderTurnDescriptor(descriptor, converter)
      }));
    }
  });
})();
