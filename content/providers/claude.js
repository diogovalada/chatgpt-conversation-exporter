(() => {
  const ns = window.ChatExporter;
  const {
    compareDomOrder,
    dedupeNodes,
    findDescendantsByClassToken,
    isElement,
    normalizeTextTrim,
    wrapCollapsibleSection
  } = ns.helpers;

  const extractionState = {
    conversationId: "",
    canonicalTurns: null,
    fallbackContainers: null,
    title: "",
    apiError: ""
  };

  const provider = {
    id: "claude",
    name: "Claude",

    hasConversation(options = {}) {
      const conversationId = ns.claudeData.getConversationId(options.conversationUrl || location.href);
      const preparedForCurrentConversation = extractionState.conversationId === conversationId;
      return Boolean(
        (preparedForCurrentConversation && extractionState.canonicalTurns?.length) ||
        (preparedForCurrentConversation && extractionState.fallbackContainers?.length) ||
        getConversationTurnContainers().length
      );
    },

    getTitle(options = {}) {
      const conversationId = ns.claudeData.getConversationId(options.conversationUrl || location.href);
      const preparedForCurrentConversation = extractionState.conversationId === conversationId;
      return (preparedForCurrentConversation && extractionState.title) || document.title || "Claude Conversation";
    },

    async prepareForExtraction(options = {}) {
      await prepareClaudeExtraction(options);
    },

    getTurns(options = {}) {
      const conversationId = ns.claudeData.getConversationId(options.conversationUrl || location.href);
      const preparedForCurrentConversation = extractionState.conversationId === conversationId;

      if (preparedForCurrentConversation && extractionState.canonicalTurns?.length) {
        return extractionState.canonicalTurns;
      }

      const turnContainers = preparedForCurrentConversation && extractionState.fallbackContainers?.length
        ? extractionState.fallbackContainers
        : getConversationTurnContainers();
      const turns = [];

      for (const turnEl of turnContainers) {
        if (hasUserTurn(turnEl)) {
          turns.push(createUserTurn(turnEl));
          continue;
        }

        if (hasAssistantTurn(turnEl)) {
          turns.push(createAssistantTurn(turnEl));
        }
      }

      return turns;
    },

    initSidebarIntegration(onDownloadClick) {
      if (document.documentElement.dataset.chatExporterClaudeSidebarInit === "1") return;
      document.documentElement.dataset.chatExporterClaudeSidebarInit = "1";

      let lastSidebarSelection = null;

      document.addEventListener(
        "click",
        (event) => {
          const selection = getSidebarSelectionFromEventTarget(event.target);
          if (selection) lastSidebarSelection = selection;
        },
        true
      );

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes || [])) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node;

            if (el.getAttribute?.("role") === "menu") {
              ns.menuUtils.injectDownloadIntoMenu({
                menuEl: el,
                getSelection: () => lastSidebarSelection,
                isLikelyConversationMenu,
                onDownloadClick
              });
            }

            for (const menu of Array.from(el.querySelectorAll?.('[role="menu"]') || [])) {
              ns.menuUtils.injectDownloadIntoMenu({
                menuEl: menu,
                getSelection: () => lastSidebarSelection,
                isLikelyConversationMenu,
                onDownloadClick
              });
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    }
  };

  async function prepareClaudeExtraction(options = {}) {
    const conversationUrl = options.conversationUrl || location.href;
    const conversationId = ns.claudeData.getConversationId(conversationUrl);
    extractionState.conversationId = conversationId;
    extractionState.canonicalTurns = null;
    extractionState.fallbackContainers = null;
    extractionState.title = "";
    extractionState.apiError = "";

    if (!conversationId) return;

    const payloadResult = await ns.claudeData.fetchConversationPayload(conversationUrl)
      .then((payload) => ({ payload, error: null }))
      .catch((error) => ({ payload: null, error }));
    const payload = payloadResult.payload;
    extractionState.title = normalizeTextTrim(payload?.name);
    extractionState.apiError = String(payloadResult.error?.message || payloadResult.error || "");

    const descriptors = payload ? ns.claudeData.buildTurnDescriptors(payload) : [];
    if (descriptors.length > 0) {
      extractionState.canonicalTurns = descriptors.map(createCanonicalTurn);
      return;
    }

    const targetsCurrentDocument = conversationId === ns.claudeData.getConversationId(location.href);
    if (!targetsCurrentDocument) {
      throw new Error(extractionState.apiError || "Claude conversation data was unavailable.");
    }

    let domError = null;
    try {
      extractionState.fallbackContainers = await collectClaudeTurnContainers();
    } catch (error) {
      domError = error;
    }

    if (extractionState.fallbackContainers?.length) return;

    const domMessage = String(domError?.message || domError || "Claude DOM collection failed.");
    const apiMessage = extractionState.apiError || "Claude canonical data was unavailable.";
    throw new Error(`${domMessage} ${apiMessage}`.trim());
  }

  function createCanonicalTurn(descriptor) {
    return {
      id: descriptor.id,
      role: descriptor.role,
      sourceMessageIds: descriptor.messageIds || [],
      toMarkdown(converter) {
        return ns.claudeData.renderTurnDescriptor(descriptor, converter);
      }
    };
  }

  function findClaudeMessageFeed(root = document) {
    return root.querySelector?.('[role="feed"][aria-label="Chat messages"]') ||
      root.querySelector?.('[role="feed"]') ||
      null;
  }

  function getClaudeMessagePosition(article) {
    const label = String(article?.getAttribute?.("aria-label") || "");
    const numbers = label.match(/\d+/g) || [];
    if (numbers.length < 2) return null;

    const index = Number(numbers[0]);
    const total = Number(numbers[1]);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < index) {
      return null;
    }
    return { index, total };
  }

  function getClaudeMessageArticles(root = document) {
    const feed = root.matches?.('[role="feed"]') ? root : findClaudeMessageFeed(root);
    if (!feed) return [];
    return Array.from(feed.querySelectorAll("article")).filter((article) => getClaudeMessagePosition(article));
  }

  function findLoadEarlierMessagesButton() {
    const feed = findClaudeMessageFeed();
    if (!feed) return null;

    return Array.from(feed.querySelectorAll("button")).find((button) => {
      const label = normalizeTextTrim(button.getAttribute("aria-label") || button.textContent).toLowerCase();
      return label === "load earlier messages" || label.includes("load earlier messages");
    }) || null;
  }

  function findClaudeConversationScroller() {
    let current = findClaudeMessageFeed() || getClaudeMessageArticles()[0] || null;

    while (current) {
      const style = typeof getComputedStyle === "function" ? getComputedStyle(current) : null;
      if (
        current.scrollHeight > current.clientHeight + 100 &&
        (!style || /(auto|scroll)/.test(style.overflowY))
      ) {
        return current;
      }
      current = current.parentElement;
    }

    const scrollingElement = document.scrollingElement;
    return scrollingElement?.scrollHeight > scrollingElement?.clientHeight + 100
      ? scrollingElement
      : null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function settleClaudeDom(ms = 120) {
    await Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      wait(250)
    ]);
    await wait(ms);
  }

  function createClaudeSnapshotStore() {
    const records = new Map();
    let expectedCount = 0;

    function capture() {
      for (const article of getClaudeMessageArticles()) {
        const position = getClaudeMessagePosition(article);
        if (!position) continue;
        expectedCount = Math.max(expectedCount, position.total);
        records.set(position.index, article.cloneNode(true));
      }
    }

    function hasCompleteCoverage() {
      if (expectedCount < 1) return false;
      for (let index = 1; index <= expectedCount; index += 1) {
        if (!records.has(index)) return false;
      }
      return true;
    }

    function getOrderedContainers() {
      if (!hasCompleteCoverage()) {
        const missing = [];
        for (let index = 1; index <= expectedCount; index += 1) {
          if (!records.has(index)) missing.push(index);
        }
        throw new Error(
          `Claude did not render message indexes: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", ..." : ""}.`
        );
      }

      return Array.from({ length: expectedCount }, (_, offset) => records.get(offset + 1)).filter(Boolean);
    }

    return { capture, getOrderedContainers, hasCompleteCoverage };
  }

  function getCurrentFirstMessageIndex() {
    const indexes = getClaudeMessageArticles()
      .map((article) => getClaudeMessagePosition(article)?.index || 0)
      .filter(Boolean);
    return indexes.length > 0 ? Math.min(...indexes) : 0;
  }

  async function loadEarlierClaudeMessages(snapshots) {
    snapshots.capture();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const button = findLoadEarlierMessagesButton();
      if (!button) return;

      const previousFirstIndex = getCurrentFirstMessageIndex();
      button.click();
      let advanced = false;

      for (let poll = 0; poll < 40; poll += 1) {
        await settleClaudeDom(100);
        snapshots.capture();

        const firstIndex = getCurrentFirstMessageIndex();
        if (!button.isConnected || !findLoadEarlierMessagesButton() || (firstIndex && firstIndex < previousFirstIndex)) {
          advanced = true;
          break;
        }
      }

      if (!advanced) {
        throw new Error("Claude's earlier-message loader did not advance.");
      }
    }

    throw new Error("Claude's earlier-message loader did not finish.");
  }

  async function sweepClaudeConversation(scroller, snapshots) {
    for (const stepRatio of [0.65, 0.3]) {
      const step = Math.max(180, Math.floor(scroller.clientHeight * stepRatio));
      let position = 0;

      for (let attempt = 0; attempt < 4000; attempt += 1) {
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(position, maxScrollTop);
        await settleClaudeDom(90);
        snapshots.capture();

        if (snapshots.hasCompleteCoverage()) return snapshots.getOrderedContainers();
        if (position >= maxScrollTop) break;
        position = Math.min(position + step, maxScrollTop);
      }
    }

    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    await settleClaudeDom(120);
    snapshots.capture();
    return snapshots.getOrderedContainers();
  }

  async function collectClaudeTurnContainers() {
    const initialArticles = getClaudeMessageArticles();
    if (initialArticles.length === 0) {
      return getConversationTurnContainers().map((container) => container.cloneNode(true));
    }

    const initialScroller = findClaudeConversationScroller();
    const bottomOffset = initialScroller
      ? Math.max(0, initialScroller.scrollHeight - initialScroller.clientHeight - initialScroller.scrollTop)
      : 0;
    const snapshots = createClaudeSnapshotStore();

    try {
      snapshots.capture();
      await loadEarlierClaudeMessages(snapshots);
      if (snapshots.hasCompleteCoverage()) return snapshots.getOrderedContainers();

      const scroller = findClaudeConversationScroller();
      if (!scroller) {
        return snapshots.getOrderedContainers();
      }
      return await sweepClaudeConversation(scroller, snapshots);
    } finally {
      const restoreScroller = findClaudeConversationScroller() || initialScroller;
      if (restoreScroller) {
        restoreScroller.scrollTop = Math.max(
          0,
          restoreScroller.scrollHeight - restoreScroller.clientHeight - bottomOffset
        );
        await settleClaudeDom(0);
      }
    }
  }

  function countUserMessages(root) {
    return findClaudeUserMessageElements(root).length;
  }

  function findClaudeUserMessageElements(root) {
    const explicit = findDescendantsByClassToken(root, "!font-user-message");
    if (explicit.length > 0) return explicit;

    return Array.from(root.querySelectorAll("div.font-large")).filter(
      (el) =>
        !el.closest('[data-chat-input-container="true"]') &&
        Boolean(el.closest(".items-end")) &&
        !el.querySelector(".standard-markdown")
    );
  }

  function findConversationColumn() {
    const candidates = Array.from(document.querySelectorAll("div.max-w-3xl.mx-auto.w-full")).filter(
      (el) => !el.closest('[data-chat-input-container="true"]')
    );

    let best = null;
    let bestTurnCount = 0;
    let bestScore = 0;

    for (const candidate of candidates) {
      const directTurnCount = Array.from(candidate.children)
        .filter(isElement)
        .filter((child) =>
          countUserMessages(child) > 0 || hasAssistantTurn(child)
        )
        .length;
      const score =
        countUserMessages(candidate) +
        candidate.querySelectorAll(".standard-markdown").length * 2 +
        getClaudeStatusPanels(candidate).length;

      if (directTurnCount > bestTurnCount || (directTurnCount === bestTurnCount && score > bestScore)) {
        best = candidate;
        bestTurnCount = directTurnCount;
        bestScore = score;
      }
    }

    return bestTurnCount > 0 || bestScore > 0 ? best : null;
  }

  function getSemanticMessageRole(turnEl) {
    if (!getClaudeMessagePosition(turnEl)) return "";
    const heading = normalizeTextTrim(turnEl.querySelector("h2")?.textContent).toLowerCase();
    if (heading.startsWith("you said:") || heading.includes("you said:")) return "user";
    if (heading.startsWith("claude responded:") || heading.includes("claude responded:")) return "assistant";
    if (turnEl.querySelector(".standard-markdown")) return "assistant";
    if (countUserMessages(turnEl) > 0) return "user";
    return "";
  }

  function hasUserTurn(turnEl) {
    return getSemanticMessageRole(turnEl) === "user" || countUserMessages(turnEl) > 0;
  }

  function hasAssistantTurn(turnEl) {
    return getSemanticMessageRole(turnEl) === "assistant" ||
      Boolean(turnEl.querySelector(".standard-markdown")) ||
      getClaudeStatusPanels(turnEl).length > 0;
  }

  function findFallbackUserTurnWrapper(userEl) {
    return userEl.closest(".mb-1.mt-6.group") || userEl.closest(".mb-1") || userEl.parentElement;
  }

  function findFallbackAssistantTurnWrapper(assistantEl) {
    return assistantEl.closest(".group.relative.pb-3") || assistantEl.closest(".group") || assistantEl.parentElement;
  }

  function getConversationTurnContainers() {
    const semanticArticles = getClaudeMessageArticles();
    if (semanticArticles.length > 0) return semanticArticles;

    const root = findConversationColumn();
    if (!root) return [];

    const directTurns = Array.from(root.children)
      .filter(isElement)
      .filter((el) => hasUserTurn(el) || hasAssistantTurn(el));

    if (directTurns.length > 0) return directTurns;

    const fallbackTurns = [
      ...findClaudeUserMessageElements(root).map(findFallbackUserTurnWrapper),
      ...Array.from(root.querySelectorAll(".standard-markdown")).map(findFallbackAssistantTurnWrapper)
    ];

    return dedupeNodes(fallbackTurns.filter((el) => el && (hasUserTurn(el) || hasAssistantTurn(el))));
  }

  function cloneSemanticMessageContent(turnEl) {
    const clone = turnEl.cloneNode(true);
    for (const el of Array.from(clone.querySelectorAll(
      "h2,button,[role=status],[role=toolbar],time,.sr-only,.cdk-visually-hidden"
    ))) {
      el.remove();
    }
    return clone;
  }

  function createUserTurn(turnEl) {
    return {
      role: "user",
      toMarkdown(converter) {
        const userEls = findClaudeUserMessageElements(turnEl);
        if (userEls.length === 0 && getSemanticMessageRole(turnEl) === "user") {
          return converter.convertElement(cloneSemanticMessageContent(turnEl)).trim();
        }

        let md = "";

        for (const userEl of userEls) {
          const text = (userEl.textContent ?? "").trim();
          if (text) md += `${text}\n\n`;
        }

        const seenImageUrls = new Set();
        for (const img of Array.from(turnEl.querySelectorAll("img")).filter(ns.isLikelyContentImage)) {
          const url = img.currentSrc || img.src || img.getAttribute("src") || "";
          if (!url || seenImageUrls.has(url)) continue;
          seenImageUrls.add(url);

          const imageMarkdown = converter.convertElement(img).trim();
          if (imageMarkdown) md += `${imageMarkdown}\n\n`;
        }

        return md.trim();
      }
    };
  }

  function createAssistantTurn(turnEl) {
    return {
      role: "assistant",
      toMarkdown(converter) {
        const items = [
          ...Array.from(turnEl.querySelectorAll(".standard-markdown")).map((el) => ({ type: "dom", el })),
          ...Array.from(turnEl.querySelectorAll("pre"))
            .filter((preEl) => !preEl.closest(".standard-markdown") && !findClaudeStatusPanel(preEl))
            .map((el) => ({ type: "dom", el })),
          ...Array.from(turnEl.querySelectorAll("img"))
            .filter((imgEl) => !imgEl.closest(".standard-markdown") && !findClaudeStatusPanel(imgEl) && ns.isLikelyContentImage(imgEl))
            .map((el) => ({ type: "dom", el })),
          ...getClaudeStatusPanels(turnEl).map((el) => ({ type: "execution", el }))
        ];

        if (items.length === 0 && getSemanticMessageRole(turnEl) === "assistant") {
          return converter.convertElement(cloneSemanticMessageContent(turnEl)).trim();
        }

        items.sort((a, b) => compareDomOrder(a.el, b.el));

        let md = "";
        const seen = new Set();
        for (const item of items) {
          if (!item?.el || seen.has(item.el)) continue;
          seen.add(item.el);

          const chunk =
            item.type === "execution"
              ? renderClaudeExecutionPanel(item.el)
              : converter.convertElement(item.el).trim();

          if (chunk) md += `${chunk}\n\n`;
        }

        return md.trim();
      }
    };
  }

  function isConversationHref(href) {
    try {
      const url = new URL(href, location.origin);
      return /\/chat\/[0-9a-f-]{12,}/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function getSidebarSelectionFromEventTarget(target) {
    const el = target?.nodeType === Node.ELEMENT_NODE ? target : null;
    if (!el) return null;

    const anchor =
      el.closest('a[href*="/chat/"]') ||
      el.closest("button")?.closest("a") ||
      el.closest("li,div")?.querySelector?.('a[href*="/chat/"]') ||
      null;

    const href = anchor?.getAttribute?.("href") || anchor?.href || "";
    if (!href || !isConversationHref(href)) return null;

    const url = new URL(href, location.origin).toString();
    const title =
      normalizeTextTrim(anchor?.getAttribute?.("title")) ||
      normalizeTextTrim(anchor?.textContent) ||
      "Claude Conversation";

    return { providerName: provider.name, title, url };
  }

  function hasStatusButton(root) {
    return Array.from(root.querySelectorAll("button")).some((button) =>
      String(button.className || "").includes("group/status")
    );
  }

  function isClaudeStatusPanel(el) {
    return Boolean(el?.matches?.("div.min-w-0.pl-2.py-1\\.5")) && hasStatusButton(el);
  }

  function findClaudeStatusPanel(el) {
    const panel = el?.closest?.("div.min-w-0.pl-2.py-1\\.5");
    return isClaudeStatusPanel(panel) ? panel : null;
  }

  function getClaudeStatusPanels(root) {
    const selector = "div.min-w-0.pl-2.py-1\\.5";
    const candidates = [];

    if (root.matches?.(selector)) {
      candidates.push(root);
    }

    candidates.push(...Array.from(root.querySelectorAll(selector)));

    return dedupeNodes(candidates.filter(isClaudeStatusPanel));
  }

  function getExecutionPanelTitle(panelEl) {
    const titleEl =
      panelEl.querySelector("button span.truncate") ||
      panelEl.querySelector("button");
    return normalizeTextTrim(titleEl?.textContent || "");
  }

  function getExecutionPanelStatus(panelEl) {
    const candidates = Array.from(panelEl.querySelectorAll("div,span,p"))
      .map((el) => normalizeTextTrim(el.textContent))
      .filter(Boolean);

    return candidates.find((text) =>
      text === "Done" ||
      text === "Running" ||
      text === "Failed" ||
      text === "Complete"
    ) || "";
  }

  function isExecutionPanelExpanded(panelEl) {
    const button = Array.from(panelEl.querySelectorAll("button")).find((el) =>
      String(el.className || "").includes("group/status")
    );
    return button?.getAttribute("aria-expanded") === "true";
  }

  function getCodeFenceLanguage(cardEl, codeEl, label) {
    const className = codeEl?.getAttribute("class") || "";
    const match = className.match(/\blanguage-([a-zA-Z0-9_+-]+)\b/);
    if (match) return match[1];

    const normalizedLabel = normalizeTextTrim(label).toLowerCase();
    if (normalizedLabel && normalizedLabel !== "output") return normalizedLabel;
    return "";
  }

  function renderClaudeExecutionPanel(panelEl) {
    const title = getExecutionPanelTitle(panelEl);
    const cards = Array.from(panelEl.querySelectorAll(".code-block__code"))
      .map((codeEl) => codeEl.closest(".flex.flex-col.gap-3.p-3"))
      .filter(Boolean);
    const status = getExecutionPanelStatus(panelEl);
    const expanded = isExecutionPanelExpanded(panelEl);

    const summary = `${cards.length > 0 ? "Code Execution" : "Claude Activity"}${title ? `: ${title}` : ""}`;
    let body = "";

    if (cards.length === 0) {
      if (!expanded) {
        body += "> Collapsed in the saved Claude snapshot. The inner code/output content was not present in the HTML.\n\n";
      }
      if (status) {
        body += `**Status:** ${status}\n\n`;
      }
      return wrapCollapsibleSection(summary, body);
    }

    for (const card of dedupeNodes(cards)) {
      const label = normalizeTextTrim(card.querySelector("p")?.textContent || "");
      const codeEl = card.querySelector("code");
      const raw = (codeEl?.textContent ?? card.querySelector(".code-block__code")?.textContent ?? "").replace(/\n$/, "");
      if (!raw.trim()) continue;

      if (label.toLowerCase() === "output") {
        body += `**Output:**\n\n\`\`\`text\n${raw}\n\`\`\`\n\n`;
        continue;
      }

      const language = getCodeFenceLanguage(card, codeEl, label);
      if (label && label.toLowerCase() !== language.toLowerCase()) {
        body += `**${label}:**\n\n`;
      }
      body += `\`\`\`${language}\n${raw}\n\`\`\`\n\n`;
    }

    if (status) {
      body += `**Status:** ${status}\n\n`;
    }

    return wrapCollapsibleSection(summary, body);
  }

  function isLikelyConversationMenu(menuItems) {
    const texts = menuItems.map((el) => normalizeTextTrim(el.textContent).toLowerCase());
    return texts.some((text) =>
      text.includes("rename") ||
      text.includes("delete") ||
      text.includes("remove") ||
      text.includes("archive")
    );
  }

  ns.registerProvider(provider);
})();
