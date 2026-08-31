(() => {
  const ns = window.ChatExporter;
  const { sanitizeFilenamePart, titleCaseRole } = ns.helpers;

  function buildImageList({ downloadImages, imageCollector, imageFolder }) {
    if (!downloadImages) return [];

    return imageCollector.map((img, idx) => ({
      url: img.url,
      key: img.name,
      filename: `${imageFolder}/${img.name}`,
      alt: img.alt,
      index: idx + 1
    }));
  }

  async function extractConversation(options = {}) {
    const provider = ns.getActiveProvider();
    if (!provider) {
      return { ok: false, error: "This page is not supported." };
    }

    await provider.prepareForExtraction?.(options);

    if (!provider.hasConversation(options)) {
      return { ok: false, error: "No conversation content found." };
    }

    const rawTitle = String(
      options.titleOverride ||
      provider.getTitle?.(options) ||
      document.title ||
      "AI Conversation"
    );
    const safeTitle = sanitizeFilenamePart(rawTitle);
    const mdFilename = `${safeTitle}.md`;
    const imageFolder = `${safeTitle}-assets`;

    const selectionStatus = provider.getSelectionStatus?.() || null;
    if (selectionStatus?.active && selectionStatus.selectedCount === 0) {
      return { ok: false, error: "No messages are selected." };
    }

    const turns = await provider.getTurns?.(options) || [];
    if (!Array.isArray(turns) || turns.length === 0) {
      return { ok: false, error: "No conversation content found." };
    }

    const imageCollector = [];
    const converter = ns.createMarkdownConverter({
      downloadImages: Boolean(options.downloadImages),
      imageFolder,
      imageCollector
    });

    let md = `# ${safeTitle}\n\n`;

    for (const turn of turns) {
      const role = String(turn?.role || "").toLowerCase();
      const roleLabel =
        role === "user" ? "User" :
        role === "assistant" ? "Assistant" :
        titleCaseRole(turn?.role);

      const chunk = String(turn?.toMarkdown?.(converter) ?? "").trim();
      if (!chunk) continue;

      md += `## ${roleLabel}\n\n${chunk}\n\n`;
    }

    if (md.trim() === `# ${safeTitle}`) {
      return { ok: false, error: "No conversation content found." };
    }

    return {
      ok: true,
      providerId: provider.id,
      providerName: provider.name,
      title: safeTitle,
      filename: mdFilename,
      markdown: md.trim() + "\n",
      images: buildImageList({
        downloadImages: Boolean(options.downloadImages),
        imageCollector,
        imageFolder
      })
    };
  }

  ns.extractConversation = extractConversation;
})();
