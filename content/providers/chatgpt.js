(() => {
  const ns = window.ChatExporter;
  const { compareDomOrder, normalizeTextTrim, wrapCollapsibleSection } = ns.helpers;

  const selectionController = createSelectionController();
  const extractionState = {
    conversationId: "",
    canonicalTurns: null,
    fallbackContainers: null,
    fallbackCoverageVerified: false,
    title: "",
    apiError: ""
  };

  const provider = {
    id: "chatgpt",
    name: "ChatGPT",

    hasConversation(options = {}) {
      const targetConversationId = ns.chatGptData.getConversationId(
        options.conversationUrl || location.href
      );
      const preparedForCurrentConversation =
        extractionState.conversationId === targetConversationId;
      return Boolean(
        targetConversationId ||
        (preparedForCurrentConversation && extractionState.canonicalTurns?.length) ||
        (preparedForCurrentConversation && extractionState.fallbackContainers?.length) ||
        getConversationTurnContainers().length
      );
    },

    getTitle(options = {}) {
      const targetConversationId = ns.chatGptData.getConversationId(
        options.conversationUrl || location.href
      );
      const preparedForCurrentConversation =
        extractionState.conversationId === targetConversationId;
      return (preparedForCurrentConversation && extractionState.title) || document.title || "ChatGPT Conversation";
    },

    getSelectionStatus(options = {}) {
      const targetConversationId = ns.chatGptData.getConversationId(
        options.conversationUrl || location.href
      );
      return selectionController.getStatus(targetConversationId);
    },

    async prepareForExtraction(options = {}) {
      await prepareChatGptExtraction(options);
    },

    getTurns(options = {}) {
      const liveTurns = buildChatGptTurns();
      const preparedDomTurns = extractionState.fallbackContainers?.length
        ? extractionState.fallbackContainers.flatMap((container) => buildTurnsForContainer(container))
        : liveTurns;
      let turns = liveTurns;
      const targetConversationId = ns.chatGptData.getConversationId(
        options.conversationUrl || location.href
      );
      const preparedForCurrentConversation =
        extractionState.conversationId === targetConversationId;

      if (preparedForCurrentConversation && extractionState.canonicalTurns?.length) {
        turns = extractionState.fallbackCoverageVerified &&
          preparedDomTurns.length > extractionState.canonicalTurns.length
          ? preparedDomTurns
          : mergeCanonicalAndDomTurns(extractionState.canonicalTurns, preparedDomTurns);
      } else if (preparedForCurrentConversation && extractionState.fallbackContainers?.length) {
        turns = preparedDomTurns;
      }

      return selectionController.filterTurns(turns, targetConversationId);
    },

    initSidebarIntegration(onDownloadClick) {
      selectionController.init();

      if (document.documentElement.dataset.chatExporterChatgptSidebarInit === "1") return;
      document.documentElement.dataset.chatExporterChatgptSidebarInit = "1";

      let lastSidebarSelection = null;

      document.addEventListener(
        "click",
        (event) => {
          const selection = getSidebarSelectionFromEventTarget(event.target);
          if (selection) lastSidebarSelection = selection;

          const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : null;
          if (target?.closest?.('button[aria-label="More"]')) {
            for (const delay of [0, 75, 250]) {
              setTimeout(() => processMenusFromNode(document.body), delay);
            }
          }
        },
        true
      );

      const processMenusFromNode = (node) => {
        for (const menu of ns.menuUtils.findMenusFromNode(node)) {
          ns.menuUtils.injectDownloadIntoMenu({
            menuEl: menu,
            getSelection: () =>
              getSidebarSelectionFromMenu(menu) ||
              getCurrentConversationSelection() ||
              lastSidebarSelection,
            isLikelyConversationMenu,
            onDownloadClick
          });
        }
      };

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            processMenusFromNode(mutation.target);
          }

          for (const node of Array.from(mutation.addedNodes || [])) {
            processMenusFromNode(node);
          }
        }
      });

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["aria-hidden", "data-state", "hidden"],
        childList: true,
        subtree: true
      });
      processMenusFromNode(document.body);
      for (const item of Array.from(document.body.querySelectorAll(
        '[role="menu"],button,a,[role="button"],[data-radix-collection-item],[tabindex]'
      ))) {
        processMenusFromNode(item);
      }
    }
  };

  function findConversationRoot() {
    return (
      document.querySelector("#thread") ||
      document.querySelector("main #thread") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body
    );
  }

  async function prepareChatGptExtraction(options = {}) {
    const conversationUrl = options.conversationUrl || location.href;
    extractionState.conversationId = ns.chatGptData.getConversationId(conversationUrl);
    extractionState.canonicalTurns = null;
    extractionState.fallbackContainers = null;
    extractionState.fallbackCoverageVerified = false;
    extractionState.title = "";
    extractionState.apiError = "";

    const targetsCurrentDocument =
      extractionState.conversationId === ns.chatGptData.getConversationId(location.href);
    if (targetsCurrentDocument) {
      extractionState.fallbackContainers = getConversationTurnContainers()
        .map((container) => container.cloneNode(true));
    } else {
      extractionState.fallbackContainers = [];
    }

    const payloadResult = await ns.chatGptData.fetchConversationPayload(conversationUrl)
      .then((payload) => ({ payload, error: null }))
      .catch((error) => ({ payload: null, error }));
    const payload = payloadResult.payload;
    extractionState.title = normalizeTextTrim(payload?.title);
    extractionState.apiError = String(
      payloadResult.error?.message || payloadResult.error || ""
    );

    const descriptors = payload && ns.chatGptData.isActiveBranchComplete(payload)
      ? ns.chatGptData.buildTurnDescriptors(payload)
      : [];
    if (descriptors.length > 0) {
      extractionState.canonicalTurns = descriptors.map(createCanonicalTurn);
    }

    if (payload?.__chatExporterCoverageComplete && descriptors.length > 0) {
      return;
    }

    if (!targetsCurrentDocument) {
      throw new Error(
        "ChatGPT API coverage could not be verified. Open the conversation and export it directly to use the DOM fallback."
      );
    }

    let domError = null;
    if (document.visibilityState !== "hidden") {
      try {
        extractionState.fallbackContainers = await collectVirtualizedTurnContainers();
        extractionState.fallbackCoverageVerified = true;
      } catch (error) {
        domError = error;
      }
    }

    if (extractionState.fallbackCoverageVerified && extractionState.fallbackContainers?.length) {
      return;
    }

    const domMessage = String(domError?.message || domError || "DOM collection failed.");
    const apiMessage = payload
      ? "ChatGPT API coverage could not be verified."
      : extractionState.apiError || "Canonical data was unavailable.";
    throw new Error(`${domMessage} ${apiMessage}`.trim());
  }

  function createCanonicalTurn(descriptor) {
    return {
      id: descriptor.id,
      role: descriptor.role,
      canonicalTurnId: descriptor.turnKey || "",
      sourceMessageIds: descriptor.messageIds || [],
      anchorEl: null,
      checkboxAnchorEl: null,
      toMarkdown(converter) {
        return ns.chatGptData.renderTurnDescriptor(descriptor, converter);
      }
    };
  }

  function mergeCanonicalAndDomTurns(canonicalTurns, domTurns) {
    const domByTurnId = new Map();
    const domByMessageId = new Map();

    for (const turn of domTurns) {
      if (turn.canonicalTurnId) domByTurnId.set(turn.canonicalTurnId, turn);
      for (const messageId of turn.sourceMessageIds || []) {
        if (messageId) domByMessageId.set(messageId, turn);
      }
    }

    return canonicalTurns.map((canonicalTurn) => {
      let domTurn = canonicalTurn.canonicalTurnId
        ? domByTurnId.get(canonicalTurn.canonicalTurnId)
        : null;

      if (!domTurn) {
        domTurn = (canonicalTurn.sourceMessageIds || [])
          .map((messageId) => domByMessageId.get(messageId))
          .find(Boolean);
      }

      if (!domTurn) return canonicalTurn;
      if (domTurn.sourceKind === "modern") {
        return {
          ...canonicalTurn,
          anchorEl: domTurn.anchorEl,
          checkboxAnchorEl: domTurn.checkboxAnchorEl
        };
      }
      return {
        ...domTurn,
        id: canonicalTurn.id,
        canonicalTurnId: canonicalTurn.canonicalTurnId,
        sourceMessageIds: canonicalTurn.sourceMessageIds
      };
    });
  }

  function findConversationScroller() {
    let current = getConversationTurnContainers()[0] || document.querySelector("#thread");

    while (current) {
      const style = getComputedStyle(current);
      if (current.scrollHeight > current.clientHeight + 100 && /(auto|scroll)/.test(style.overflowY)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function settleVirtualizedDom(ms = 300) {
    await Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      wait(250)
    ]);
    await wait(ms);
  }

  function getTurnIndex(container) {
    const testId = container?.getAttribute?.("data-testid") || "";
    const legacyIndex = Number(testId.match(/^conversation-turn-(\d+)$/)?.[1] || 0);
    if (legacyIndex) return legacyIndex;

    const role = getModernTurnRole(container);
    const body = getModernTurnBody(container);
    const unitKey = String(
      body?.getAttribute?.("data-chatgpt-search-unit-key") ||
      container?.getAttribute?.("data-chatgpt-search-unit-key") ||
      ""
    );
    const groupKey = String(
      container?.closest?.("[data-content-search-turn-key]")?.getAttribute("data-content-search-turn-key") ||
      ""
    );
    const groupIndex = (unitKey || groupKey).match(/^fallback-turn-(\d+)/)?.[1];
    if (!role || groupIndex === undefined) return 0;
    return Number(groupIndex) * 2 + (role === "assistant" ? 2 : 1);
  }

  function getTurnSnapshotKey(container) {
    const turnId = String(container?.getAttribute?.("data-turn-id") || "").trim();
    if (turnId) return `turn:${turnId}`;

    const messageIds = Array.from(container?.querySelectorAll?.("[data-message-id]") || [])
      .map((message) => String(message.getAttribute("data-message-id") || "").trim())
      .filter(Boolean);
    if (messageIds.length > 0) return `messages:${Array.from(new Set(messageIds)).join("|")}`;

    const modernRole = getModernTurnRole(container);
    if (modernRole) {
      const modernIds = getSourceMessageIds([getModernTurnBody(container)]);
      if (modernIds.length > 0) return `messages:${modernRole}:${modernIds.join("|")}`;
    }

    const testId = String(container?.getAttribute?.("data-testid") || "").trim();
    return testId ? `test:${testId}` : "";
  }

  function createTurnSnapshotStore() {
    const records = new Map();
    const finalIndexToKey = new Map();
    let sequence = 0;

    function capture({ final = false } = {}) {
      for (const container of getConversationTurnContainers()) {
        const key = getTurnSnapshotKey(container);
        if (!key) continue;

        const index = getTurnIndex(container);
        const existing = records.get(key);
        const record = existing || { key, firstSeen: sequence++, finalIndex: 0, clone: null };
        record.clone = container.cloneNode(true);

        if (final && index) {
          if (record.finalIndex && record.finalIndex !== index && finalIndexToKey.get(record.finalIndex) === key) {
            finalIndexToKey.delete(record.finalIndex);
          }
          record.finalIndex = index;
          finalIndexToKey.set(index, key);
        }

        records.set(key, record);
      }
    }

    function beginFinalIndexing() {
      finalIndexToKey.clear();
      for (const record of records.values()) record.finalIndex = 0;
    }

    function hasCompleteCoverage(expectedCount) {
      if (!expectedCount) return records.size > 0;
      for (let index = 1; index <= expectedCount; index += 1) {
        if (!finalIndexToKey.has(index)) return false;
      }
      return true;
    }

    function getOrderedContainers(expectedCount) {
      if (expectedCount > 0 && !hasCompleteCoverage(expectedCount)) {
        const missing = [];
        for (let index = 1; index <= expectedCount; index += 1) {
          if (!finalIndexToKey.has(index)) missing.push(index);
        }
        throw new Error(
          `ChatGPT did not render conversation turn indexes: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", ..." : ""}.`
        );
      }

      if (expectedCount > 0) {
        return Array.from({ length: expectedCount }, (_, offset) => {
          const key = finalIndexToKey.get(offset + 1);
          return records.get(key)?.clone || null;
        }).filter(Boolean);
      }

      return Array.from(records.values())
        .sort((a, b) => a.firstSeen - b.firstSeen)
        .map((record) => record.clone)
        .filter(Boolean);
    }

    return { beginFinalIndexing, capture, getOrderedContainers, hasCompleteCoverage };
  }

  async function loadConversationBeginning(scroller, snapshots) {
    let stableAtTop = 0;
    let lastSignature = "";

    snapshots.capture();

    for (let attempt = 0; attempt < 120; attempt += 1) {
      scroller.scrollTop = 0;
      await settleVirtualizedDom(350);
      snapshots.capture();

      const containers = getConversationTurnContainers();
      const indexes = containers.map(getTurnIndex).filter(Boolean);
      const firstIndex = indexes.length ? Math.min(...indexes) : 0;
      const signature = [
        getTurnSnapshotKey(containers[0]) || "",
        Math.round(scroller.scrollHeight),
        Math.max(0, ...indexes)
      ].join(":");

      if (scroller.scrollTop <= 1 && firstIndex === 1 && signature === lastSignature) {
        stableAtTop += 1;
        if (stableAtTop >= 2) return;
      } else {
        stableAtTop = 0;
      }

      lastSignature = signature;
    }

    throw new Error("ChatGPT history did not finish loading at the beginning.");
  }

  async function sweepVirtualizedConversation(scroller, snapshots) {
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    await settleVirtualizedDom(180);
    snapshots.capture();

    const bottomIndexes = getConversationTurnContainers().map(getTurnIndex).filter(Boolean);
    let expectedCount = bottomIndexes.length ? Math.max(...bottomIndexes) : 0;
    snapshots.beginFinalIndexing();

    for (const stepRatio of [0.75, 0.4]) {
      const step = Math.max(240, Math.floor(scroller.clientHeight * stepRatio));
      let position = 0;
      let attempts = 0;

      while (attempts < 4000) {
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(position, maxScrollTop);
        await settleVirtualizedDom(90);
        snapshots.capture({ final: true });

        const renderedIndexes = getConversationTurnContainers().map(getTurnIndex).filter(Boolean);
        expectedCount = Math.max(expectedCount, ...renderedIndexes, 0);

        if (snapshots.hasCompleteCoverage(expectedCount)) break;
        if (position >= maxScrollTop) break;

        position = Math.min(position + step, maxScrollTop);
        attempts += 1;
      }

      if (snapshots.hasCompleteCoverage(expectedCount)) break;
    }

    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    await settleVirtualizedDom(180);
    snapshots.capture({ final: true });

    return snapshots.getOrderedContainers(expectedCount);
  }

  async function collectVirtualizedTurnContainers() {
    const scroller = findConversationScroller();
    if (!scroller) {
      const containers = getConversationTurnContainers();
      const indexes = containers.map(getTurnIndex).filter(Boolean);
      if (indexes.length > 0) {
        const expectedCount = Math.max(...indexes);
        if (new Set(indexes).size !== expectedCount) {
          throw new Error("ChatGPT did not render every conversation turn.");
        }
      }
      return containers.map((container) => container.cloneNode(true));
    }

    const bottomOffset = Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
    const snapshots = createTurnSnapshotStore();
    snapshots.capture();

    try {
      await loadConversationBeginning(scroller, snapshots);
      return await sweepVirtualizedConversation(scroller, snapshots);
    } finally {
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - bottomOffset);
      await settleVirtualizedDom(0);
    }
  }

  function buildChatGptTurns(root = findConversationRoot()) {
    const containers = getConversationTurnContainers(root);
    if (containers.length === 0) return [];

    const turns = [];
    for (const container of containers) {
      turns.push(...buildTurnsForContainer(container));
    }
    return turns;
  }

  function getConversationTurnContainers(root = findConversationRoot()) {
    const selectors = [
      'article[data-testid^="conversation-turn-"]',
      "article[data-turn]",
      "[data-turn]"
    ];

    for (const selector of selectors) {
      const turns = Array.from(root.querySelectorAll(selector)).filter((el) =>
        el.matches("[data-message-author-role]") || Boolean(el.querySelector("[data-message-author-role]"))
      );
      if (turns.length > 0) return turns;
    }

    const messageEls = Array.from(root.querySelectorAll("[data-message-author-role]"));
    if (messageEls.length > 0) {
      const turns = [];
      const seen = new Set();

      for (const msgEl of messageEls) {
        const turnEl = msgEl.closest("article, [data-turn]") || msgEl;
        if (seen.has(turnEl)) continue;
        seen.add(turnEl);
        turns.push(turnEl);
      }

      return turns;
    }

    const modernTurns = new Set();
    for (const heading of root.querySelectorAll("h4")) {
      const container = heading.parentElement;
      if (container && getModernTurnRole(container)) modernTurns.add(container);
    }
    return Array.from(modernTurns).sort(compareDomOrder);
  }

  function getModernTurnBody(containerEl) {
    return containerEl?.querySelector?.("h4")?.nextElementSibling || null;
  }

  function getModernTurnRole(containerEl) {
    const heading = containerEl?.querySelector?.("h4");
    const body = heading?.nextElementSibling;
    if (!heading || !body || heading.parentElement !== containerEl) return "";

    const headingRole = heading.getAttribute("data-conversation-role");
    const unitKey = body.getAttribute("data-chatgpt-search-unit-key") ||
      containerEl.getAttribute("data-chatgpt-search-unit-key") || "";
    if (headingRole === "assistant" || unitKey.endsWith(":assistant")) return "assistant";
    if (unitKey.endsWith(":user")) return "user";

    const label = normalizeTextTrim(heading.textContent);
    if (label === "You said:") return "user";
    if (label === "ChatGPT said:") return "assistant";
    return "";
  }

  function buildTurnsForContainer(containerEl) {
    const turnRole = containerEl.getAttribute("data-turn") || "";
    const messageEls = [
      ...(containerEl.matches("[data-message-author-role]") ? [containerEl] : []),
      ...Array.from(containerEl.querySelectorAll("[data-message-author-role]"))
    ];
    if (messageEls.length === 0) {
      const modernRole = getModernTurnRole(containerEl);
      const body = getModernTurnBody(containerEl);
      return modernRole && body ? [createModernTurn(containerEl, body, modernRole)] : [];
    }

    if (turnRole === "user") {
      const userMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "user");
      return userMsgs.length > 0 ? [createUserTurn(userMsgs, containerEl)] : [];
    }

    if (turnRole === "assistant") {
      const assistantMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "assistant");
      return assistantMsgs.length > 0 ? [createAssistantTurn(containerEl, assistantMsgs)] : [];
    }

    return messageEls.map((msgEl) => createFallbackTurn(msgEl));
  }

  function createModernTurn(containerEl, bodyEl, role) {
    const sourceMessageIds = getSourceMessageIds([bodyEl]);
    return {
      id: makeTurnId(role, containerEl, [bodyEl]),
      role,
      sourceKind: "modern",
      canonicalTurnId: "",
      sourceMessageIds,
      anchorEl: bodyEl,
      checkboxAnchorEl: role === "user"
        ? getUserCheckboxAnchor(containerEl, [bodyEl])
        : getAssistantCheckboxAnchor(containerEl, [bodyEl]),
      toMarkdown(converter) {
        if (role === "assistant") {
          const markdownEl = bodyEl.querySelector('[class*="MarkdownRoot"]') ||
            bodyEl.querySelector(".markdown") || bodyEl.firstElementChild || bodyEl;
          return converter.convertElement(markdownEl).trim();
        }

        const parts = [];
        const textEl = bodyEl.querySelector(".whitespace-pre-wrap");
        const text = (textEl?.textContent || bodyEl.textContent || "").trim();
        if (text) parts.push(text);
        for (const img of Array.from(bodyEl.querySelectorAll("img")).filter(ns.isLikelyContentImage)) {
          const markdown = converter.convertElement(img).trim();
          if (markdown) parts.push(markdown);
        }
        return parts.join("\n\n");
      }
    };
  }

  function createUserTurn(userMsgs, anchorEl) {
    const stableAnchor = anchorEl || userMsgs[0] || null;
    const turnId = makeTurnId("user", stableAnchor, userMsgs);
    const checkboxAnchorEl = getUserCheckboxAnchor(stableAnchor, userMsgs);
    const sourceMessageIds = getSourceMessageIds(userMsgs);

    return {
      id: turnId,
      role: "user",
      canonicalTurnId: stableAnchor?.getAttribute?.("data-turn-id") || "",
      sourceMessageIds,
      anchorEl: stableAnchor,
      checkboxAnchorEl,
      toMarkdown(converter) {
        let md = "";

        for (const msgEl of userMsgs) {
          const userTextEl = msgEl.querySelector(".whitespace-pre-wrap");
          const text = (userTextEl?.textContent ?? msgEl.textContent ?? "").trim();
          if (text) md += `${text}\n\n`;

          const images = Array.from(msgEl.querySelectorAll("img")).filter(ns.isLikelyContentImage);
          for (const img of images) {
            const imageMarkdown = converter.convertElement(img).trim();
            if (imageMarkdown) md += `${imageMarkdown}\n\n`;
          }
        }

        return md.trim();
      }
    };
  }

  function createAssistantTurn(containerEl, assistantMsgs) {
    const stableAnchor = containerEl || assistantMsgs[0] || null;
    const turnId = makeTurnId("assistant", stableAnchor, assistantMsgs);
    const checkboxAnchorEl = getAssistantCheckboxAnchor(stableAnchor, assistantMsgs);
    const sourceMessageIds = getSourceMessageIds(assistantMsgs);

    return {
      id: turnId,
      role: "assistant",
      canonicalTurnId: stableAnchor?.getAttribute?.("data-turn-id") || "",
      sourceMessageIds,
      anchorEl: stableAnchor,
      checkboxAnchorEl,
      toMarkdown(converter) {
        const blocks = [];
        const hasMessageAncestor = (el) => Boolean(el.closest("[data-message-author-role]"));
        const collapsibleSections = getChatGptCollapsibleSections(containerEl);
        const collapsibleBodies = collapsibleSections
          .map((section) => section.bodyEl)
          .filter(Boolean);

        for (const section of collapsibleSections) {
          blocks.push({ type: "collapsible", el: section.headerEl, section });
        }

        for (const msgEl of assistantMsgs) {
          const markdownRoot = msgEl.querySelector(".markdown") || msgEl;
          blocks.push({ type: "assistant_message", el: markdownRoot });
        }

        for (const preEl of Array.from(containerEl.querySelectorAll("pre"))) {
          if (hasMessageAncestor(preEl)) continue;
          if (collapsibleBodies.some((bodyEl) => bodyEl.contains(preEl))) continue;

          const codeEl = preEl.querySelector("code");
          if (codeEl) {
            blocks.push({ type: "tool_code", el: preEl });
            continue;
          }

          const container = preEl.closest("div");
          const looksLikeResult =
            container &&
            Array.from(container.querySelectorAll("div")).some((divEl) => normalizeTextTrim(divEl.textContent) === "Result");

          if (looksLikeResult) {
            blocks.push({ type: "tool_output", el: preEl });
          }
        }

        blocks.sort((a, b) => compareDomOrder(a.el, b.el));

        const seen = new Set();
        let md = "";

        for (const block of blocks) {
          if (!block?.el || seen.has(block.el)) continue;
          seen.add(block.el);

          if (block.type === "collapsible") {
            const chunk = renderChatGptCollapsibleSection(block.section, converter);
            if (chunk) md += `${chunk}\n\n`;
            continue;
          }

          if (block.type === "tool_output") {
            const output = (block.el.textContent ?? "").replace(/\n$/, "");
            if (!output.trim()) continue;
            md += `**Result:**\n\n\`\`\`text\n${output}\n\`\`\`\n\n`;
            continue;
          }

          const chunk = converter.convertElement(block.el).trim();
          if (chunk) md += `${chunk}\n\n`;
        }

        return md.trim();
      }
    };
  }

  function getChatGptCollapsibleSections(containerEl) {
    const root = containerEl.querySelector(".flex.max-w-full.flex-col.grow") || containerEl;
    const children = Array.from(root.children || []);
    const sections = [];

    for (let i = 0; i < children.length; i += 1) {
      const headerEl = children[i];
      const summary = getChatGptCollapsibleSummary(headerEl);
      if (!summary) continue;

      const bodyCandidate = children[i + 1];
      const bodyEl = isChatGptCollapsibleBody(bodyCandidate) ? bodyCandidate : null;
      sections.push({ headerEl, bodyEl, summary });

      if (bodyEl) i += 1;
    }

    return sections;
  }

  function getChatGptCollapsibleSummary(headerEl) {
    if (!headerEl || headerEl.tagName !== "SPAN") return "";
    if ((headerEl.getAttribute("class") || "").includes("text-token-text-secondary") === false) return "";
    if (headerEl.closest("[data-message-author-role]")) return "";

    const button = headerEl.querySelector("button");
    const text = normalizeTextTrim(button?.textContent || headerEl.textContent || "");
    return text;
  }

  function isChatGptCollapsibleBody(el) {
    if (!el || el.tagName !== "DIV") return false;
    if (el.closest("[data-message-author-role]") === el) return false;
    if (!(el.getAttribute("class") || "").includes("overflow-hidden")) return false;
    return Boolean(el.querySelector("pre")) || Boolean(el.querySelector(".markdown"));
  }

  function renderChatGptCollapsibleSection(section, converter) {
    const summary = section?.summary || "Details";
    const bodyEl = section?.bodyEl || null;

    if (!bodyEl) {
      return wrapCollapsibleSection(
        summary,
        "> Collapsed in the saved ChatGPT snapshot. The inner content was not present in the HTML."
      );
    }

    const items = Array.from(bodyEl.querySelectorAll("pre")).map((preEl) => {
      const codeEl = preEl.querySelector("code");
      if (codeEl) return { type: "code", el: preEl };
      return { type: isChatGptResultPre(preEl, bodyEl) ? "output" : "pre", el: preEl };
    });

    items.sort((a, b) => compareDomOrder(a.el, b.el));

    let body = "";
    const seen = new Set();
    for (const item of items) {
      if (!item?.el || seen.has(item.el)) continue;
      seen.add(item.el);

      if (item.type === "output") {
        const output = (item.el.textContent ?? "").replace(/\n$/, "");
        if (!output.trim()) continue;
        body += `**Result:**\n\n\`\`\`text\n${output}\n\`\`\`\n\n`;
        continue;
      }

      const chunk = converter.convertElement(item.el).trim();
      if (chunk) body += `${chunk}\n\n`;
    }

    if (!body.trim()) {
      body = "> Collapsible section was present, but no exportable body content was recoverable from the HTML.";
    }

    return wrapCollapsibleSection(summary, body);
  }

  function isChatGptResultPre(preEl, boundaryEl) {
    let current = preEl?.parentElement || null;

    while (current && current !== boundaryEl) {
      const hasResultLabel = Array.from(current.children || []).some(
        (child) => child.tagName === "DIV" && normalizeTextTrim(child.textContent) === "Result"
      );
      if (hasResultLabel) return true;
      current = current.parentElement;
    }

    return false;
  }

  function createFallbackTurn(msgEl) {
    const role = msgEl.getAttribute("data-message-author-role") || "unknown";

    return {
      id: makeTurnId(role, msgEl, [msgEl]),
      role,
      canonicalTurnId: msgEl.getAttribute("data-turn-id") || "",
      sourceMessageIds: getSourceMessageIds([msgEl]),
      anchorEl: msgEl,
      checkboxAnchorEl: msgEl,
      toMarkdown(converter) {
        return converter.convertElement(msgEl).trim();
      }
    };
  }

  function getSourceMessageIds(messageEls) {
    const ids = [];
    for (const el of messageEls || []) {
      for (const attribute of [
        "data-message-id",
        "data-chatgpt-selection-message-id",
        "data-chatgpt-search-message-ids"
      ]) {
        ids.push(...String(el?.getAttribute?.(attribute) || "").trim().split(/\s+/).filter(Boolean));
      }
    }
    return Array.from(new Set(ids));
  }

  function makeTurnId(role, anchorEl, messageEls) {
    const sourceIds = getSourceMessageIds(messageEls);
    if (sourceIds.length > 0) return `${role}:${sourceIds.join("|")}`;

    const parts = [];

    for (const el of messageEls || []) {
      const key =
        el?.getAttribute?.("data-message-id") ||
        el?.getAttribute?.("data-testid") ||
        "";
      if (key) parts.push(key);
    }

    const uniqueParts = Array.from(new Set(parts));
    if (uniqueParts.length > 0) {
      return `${role}:${uniqueParts.join("|")}`;
    }

    const anchorKey =
      anchorEl?.getAttribute?.("data-message-id") ||
      anchorEl?.getAttribute?.("data-testid") ||
      "";
    if (anchorKey) {
      return `${role}:${anchorKey}`;
    }

    return `${role}:dom:${buildDomPath(anchorEl)}`;
  }

  function buildDomPath(el) {
    if (!el) return "unknown";

    const parts = [];
    let current = el;

    while (current && current !== document.body && parts.length < 8) {
      let index = 0;
      let sibling = current;

      while ((sibling = sibling.previousElementSibling)) {
        index += 1;
      }

      parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
      current = current.parentElement;
    }

    return parts.join(">");
  }

  function createSelectionController() {
    const state = {
      initialized: false,
      active: false,
      conversationId: "",
      menuOpen: false,
      defaultChecked: true,
      knownIds: new Set(),
      selectedIds: new Set(),
      sourceIdsByTurnId: new Map(),
      rafId: 0,
      turnsDirty: true,
      renderedConversationId: "",
      renderedTurns: [],
      checkboxEls: new Map(),
      buttonEl: null,
      menuEl: null,
      layerEl: null,
      styleEl: null,
      observer: null
    };

    function init() {
      if (state.initialized) return;
      state.initialized = true;

      ensureStyles();
      ensureElements();

      document.addEventListener("scroll", scheduleScrollRender, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("input", onInput, true);
      window.addEventListener("resize", scheduleScrollRender);

      state.observer = new MutationObserver(() => scheduleRender());
      state.observer.observe(document.body, {
        attributes: true,
        attributeFilter: [
          "data-message-author-role",
          "data-message-id",
          "data-testid",
          "data-turn",
          "data-turn-id",
          "data-conversation-role",
          "data-chatgpt-search-unit-key",
          "data-chatgpt-search-message-ids",
          "data-chatgpt-selection-message-id"
        ],
        childList: true,
        subtree: true
      });

      scheduleRender();
    }

    function getStatus(targetConversationId) {
      resetForNavigation();
      if (!state.active || (targetConversationId && targetConversationId !== state.conversationId)) {
        return { active: false, selectedCount: 0 };
      }

      syncSelectionWithTurns(buildChatGptTurns());
      return { active: true, selectedCount: state.selectedIds.size };
    }

    function filterTurns(turns, targetConversationId) {
      resetForNavigation();
      if (!state.active || (targetConversationId && targetConversationId !== state.conversationId)) {
        return turns;
      }
      syncSelectionWithTurns(turns);
      const selectedMessageIds = new Set();
      for (const id of state.selectedIds) {
        for (const messageId of state.sourceIdsByTurnId.get(id) || []) {
          selectedMessageIds.add(messageId);
        }
      }
      return turns.filter((turn) =>
        state.selectedIds.has(turn.id) ||
        (turn.sourceMessageIds || []).some((messageId) => selectedMessageIds.has(messageId))
      );
    }

    function ensureStyles() {
      if (state.styleEl) return;

      const styleEl = document.createElement("style");
      styleEl.dataset.chatExporterChatgptSelectionStyle = "1";
      styleEl.textContent = `
        .chat-exporter-select-trigger {
          position: fixed;
          z-index: 2147483644;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 32px;
          padding: 0 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(32, 33, 35, 0.94);
          color: #fff;
          font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(8px);
          cursor: pointer;
        }
        .chat-exporter-select-trigger:hover {
          background: rgba(48, 49, 52, 0.98);
        }
        .chat-exporter-select-trigger[data-active="1"] {
          background: #1d4ed8;
          border-color: rgba(147, 197, 253, 0.95);
        }
        .chat-exporter-select-trigger[data-active="1"]:hover {
          background: #1e40af;
        }
        .chat-exporter-select-menu {
          position: fixed;
          z-index: 2147483645;
          display: flex;
          flex-direction: column;
          min-width: 160px;
          padding: 6px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          background: rgba(24, 24, 27, 0.98);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(10px);
        }
        .chat-exporter-select-menu button {
          appearance: none;
          border: 0;
          background: transparent;
          color: #f8fafc;
          text-align: left;
          padding: 10px 12px;
          border-radius: 10px;
          font: 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        .chat-exporter-select-menu button:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .chat-exporter-selection-layer {
          position: fixed;
          inset: 0;
          z-index: 2147483643;
          pointer-events: none;
        }
        .chat-exporter-turn-checkbox {
          position: fixed;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(17, 24, 39, 0.88);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
          pointer-events: auto;
        }
        .chat-exporter-turn-checkbox input {
          width: 15px;
          height: 15px;
          margin: 0;
          accent-color: #2563eb;
          cursor: pointer;
        }
        .chat-exporter-sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      `;

      document.head.appendChild(styleEl);
      state.styleEl = styleEl;
    }

    function ensureElements() {
      if (!state.buttonEl) {
        const buttonEl = document.createElement("button");
        buttonEl.type = "button";
        buttonEl.className = "chat-exporter-select-trigger";
        buttonEl.textContent = "Select";
        buttonEl.hidden = true;
        buttonEl.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            state.menuOpen = !state.menuOpen;
            scheduleRender();
          },
          true
        );
        document.body.appendChild(buttonEl);
        state.buttonEl = buttonEl;
      }

      if (!state.menuEl) {
        const menuEl = document.createElement("div");
        menuEl.className = "chat-exporter-select-menu";
        menuEl.hidden = true;
        menuEl.innerHTML = `
          <button type="button" data-action="all">Select all</button>
          <button type="button" data-action="none">Select none</button>
          <button type="button" data-action="last-reply">Select last reply</button>
          <button type="button" data-action="cancel">Cancel</button>
        `;
        menuEl.addEventListener(
          "click",
          (event) => {
            const action = event.target?.closest?.("button")?.dataset?.action || "";
            if (!action) return;

            event.preventDefault();
            event.stopPropagation();

            if (action === "all") {
              activate(true);
              return;
            }

            if (action === "none") {
              activate(false);
              return;
            }

            if (action === "last-reply") {
              activateLastReply();
              return;
            }

            if (action === "cancel") {
              if (state.active) {
                deactivate();
              } else {
                closeMenu();
              }
            }
          },
          true
        );
        document.body.appendChild(menuEl);
        state.menuEl = menuEl;
      }

      if (!state.layerEl) {
        const layerEl = document.createElement("div");
        layerEl.className = "chat-exporter-selection-layer";
        layerEl.hidden = true;
        document.body.appendChild(layerEl);
        state.layerEl = layerEl;
      }
    }

    function activate(selectAll) {
      state.active = true;
      state.conversationId = ns.chatGptData.getConversationId(location.href);
      state.defaultChecked = Boolean(selectAll);
      state.knownIds.clear();
      state.selectedIds.clear();
      state.sourceIdsByTurnId.clear();
      syncSelectionWithTurns(buildChatGptTurns());
      closeMenu();
      scheduleRender();
    }

    function activateLastReply() {
      const turns = buildChatGptTurns();
      const lastAssistantTurn = turns
        .slice()
        .reverse()
        .find((turn) => turn?.role === "assistant");

      state.active = true;
      state.conversationId = ns.chatGptData.getConversationId(location.href);
      state.defaultChecked = false;
      state.knownIds.clear();
      state.selectedIds.clear();
      state.sourceIdsByTurnId.clear();
      syncSelectionWithTurns(turns);

      if (lastAssistantTurn?.id) {
        state.selectedIds.add(lastAssistantTurn.id);
      }

      closeMenu();
      scheduleRender();
    }

    function deactivate() {
      state.active = false;
      state.conversationId = "";
      state.defaultChecked = true;
      state.knownIds.clear();
      state.selectedIds.clear();
      state.sourceIdsByTurnId.clear();
      closeMenu();
      scheduleRender();
    }

    function resetForNavigation() {
      if (
        state.active &&
        state.conversationId !== ns.chatGptData.getConversationId(location.href)
      ) deactivate();
    }

    function closeMenu() {
      if (!state.menuOpen) return;
      state.menuOpen = false;
      scheduleRender();
    }

    function syncSelectionWithTurns(turns) {
      if (!state.active) return;

      const currentIds = new Set(
        turns
          .map((turn) => turn?.id)
          .filter(Boolean)
      );

      for (const id of currentIds) {
        if (!state.knownIds.has(id) && state.defaultChecked) {
          state.selectedIds.add(id);
        }
      }

      for (const turn of turns) {
        if (turn?.id) state.sourceIdsByTurnId.set(turn.id, turn.sourceMessageIds || []);
      }
      for (const id of currentIds) state.knownIds.add(id);
    }

    function onPointerDown(event) {
      const target = event.target;
      if (state.menuEl?.contains(target) || state.buttonEl?.contains(target)) return;
      if (!state.menuOpen) return;
      closeMenu();
    }

    function onKeyDown(event) {
      if (event.key !== "Escape" || !state.menuOpen) return;
      closeMenu();
    }

    function onInput(event) {
      const target = event.target;
      if (!target) return;
      if (target.id === "prompt-textarea" || target.getAttribute?.("name") === "prompt-textarea") {
        scheduleRender();
      }
    }

    function scheduleRender() {
      state.turnsDirty = true;
      scheduleScrollRender();
    }

    function scheduleScrollRender() {
      if (state.rafId) return;
      state.rafId = window.requestAnimationFrame(render);
    }

    function getRenderedTurns() {
      const conversationId = ns.chatGptData.getConversationId(location.href);
      if (state.turnsDirty || state.renderedConversationId !== conversationId) {
        state.renderedTurns = buildChatGptTurns();
        state.renderedConversationId = conversationId;
        state.turnsDirty = false;
      }
      return state.renderedTurns;
    }

    function render() {
      state.rafId = 0;
      ensureElements();
      resetForNavigation();

      const turns = getRenderedTurns();
      if (state.active) {
        syncSelectionWithTurns(turns);
      }

      renderButton(turns);
      renderMenu();
      renderCheckboxes(turns);
    }

    function renderButton(turns) {
      const buttonEl = state.buttonEl;
      const anchorEl = findChatGptComposerAnchor();
      const hasConversation = turns.length > 0;

      if (!buttonEl || !anchorEl || !hasConversation) {
        if (buttonEl) buttonEl.hidden = true;
        if (state.menuEl) state.menuEl.hidden = true;
        return;
      }

      const rect = anchorEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        buttonEl.hidden = true;
        if (state.menuEl) state.menuEl.hidden = true;
        return;
      }

      buttonEl.hidden = false;
      buttonEl.dataset.active = state.active ? "1" : "0";
      buttonEl.setAttribute("aria-pressed", state.active ? "true" : "false");

      const buttonRect = buttonEl.getBoundingClientRect();
      const buttonWidth = Math.max(72, Math.round(buttonRect.width || 72));
      const buttonHeight = Math.max(32, Math.round(buttonRect.height || 32));
      const viewportWidth = getViewportWidth();
      const left = clamp(Math.round(rect.right + 16), 12, viewportWidth - buttonWidth - 12);
      const top = clamp(
        Math.round(rect.top + Math.max(0, (rect.height - buttonHeight) / 2)),
        12,
        window.innerHeight - buttonHeight - 12
      );

      buttonEl.style.left = `${left}px`;
      buttonEl.style.top = `${top}px`;
    }

    function renderMenu() {
      const menuEl = state.menuEl;
      const buttonEl = state.buttonEl;
      if (!menuEl || !buttonEl || buttonEl.hidden || !state.menuOpen) {
        if (menuEl) menuEl.hidden = true;
        return;
      }

      menuEl.hidden = false;

      const buttonRect = buttonEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();
      const menuWidth = Math.max(160, Math.round(menuRect.width || 160));
      const menuHeight = Math.max(120, Math.round(menuRect.height || 120));
      const viewportWidth = getViewportWidth();
      const left = clamp(Math.round(buttonRect.left), 12, viewportWidth - menuWidth - 12);

      let top = Math.round(buttonRect.bottom + 8);
      if (top + menuHeight > window.innerHeight - 12) {
        top = Math.round(buttonRect.top - menuHeight - 8);
      }

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${clamp(top, 12, window.innerHeight - menuHeight - 12)}px`;
    }

    function renderCheckboxes(turns) {
      const layerEl = state.layerEl;
      if (!layerEl || !state.active || turns.length === 0) {
        if (layerEl) layerEl.hidden = true;
        clearCheckboxes();
        return;
      }

      layerEl.hidden = false;
      const liveIds = new Set();

      for (const turn of turns) {
        const anchorEl = turn?.checkboxAnchorEl || turn?.anchorEl || null;
        if (!turn?.id || !anchorEl) continue;
        liveIds.add(turn.id);

        let wrapperEl = state.checkboxEls.get(turn.id);
        if (!wrapperEl) {
          wrapperEl = createCheckbox(turn.id, turn.role);
          state.checkboxEls.set(turn.id, wrapperEl);
          layerEl.appendChild(wrapperEl);
        }

        const rect = anchorEl.getBoundingClientRect();
        if (!isCheckboxAnchorVisible(rect)) {
          wrapperEl.hidden = true;
          continue;
        }

        const viewportWidth = getViewportWidth();
        const left = clamp(Math.round(rect.right + 10), 8, viewportWidth - 28);
        const top = clamp(Math.round(rect.top + 12), 8, window.innerHeight - 28);

        const inputEl = wrapperEl.querySelector("input");
        inputEl.checked = state.selectedIds.has(turn.id);
        wrapperEl.style.left = `${left}px`;
        wrapperEl.style.top = `${top}px`;
        wrapperEl.hidden = false;
      }

      for (const [turnId, wrapperEl] of Array.from(state.checkboxEls.entries())) {
        if (liveIds.has(turnId)) continue;
        wrapperEl.remove();
        state.checkboxEls.delete(turnId);
      }
    }

    function clearCheckboxes() {
      for (const wrapperEl of state.checkboxEls.values()) {
        wrapperEl.remove();
      }
      state.checkboxEls.clear();
    }

    function createCheckbox(turnId, role) {
      const wrapperEl = document.createElement("label");
      wrapperEl.className = "chat-exporter-turn-checkbox";
      wrapperEl.hidden = true;
      wrapperEl.addEventListener(
        "pointerdown",
        (event) => {
          event.stopPropagation();
        },
        true
      );
      wrapperEl.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
        },
        true
      );

      const inputEl = document.createElement("input");
      inputEl.type = "checkbox";
      inputEl.setAttribute("aria-label", role === "user" ? "Select user message" : "Select assistant message");
      inputEl.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
        },
        true
      );
      inputEl.addEventListener(
        "change",
        () => {
          if (inputEl.checked) {
            state.selectedIds.add(turnId);
          } else {
            state.selectedIds.delete(turnId);
          }
        },
        true
      );

      const srOnlyEl = document.createElement("span");
      srOnlyEl.className = "chat-exporter-sr-only";
      srOnlyEl.textContent = role === "user" ? "Select user message" : "Select assistant message";

      wrapperEl.appendChild(inputEl);
      wrapperEl.appendChild(srOnlyEl);
      return wrapperEl;
    }

    return {
      init,
      getStatus,
      filterTurns
    };
  }

  function findChatGptComposerAnchor() {
    const promptEl = document.getElementById("prompt-textarea");
    const promptContainer =
      promptEl?.closest?.('[data-composer-surface="true"]') ||
      document.querySelector('[data-composer-surface="true"]');

    if (promptContainer) return promptContainer;

    return (
      document.querySelector('[data-testid="composer-footer-actions"]')?.parentElement ||
      document.querySelector('textarea[name="prompt-textarea"]')?.closest("form, [role='group'], [role='presentation']") ||
      document.querySelector("form")
    );
  }

  function isVisibleRect(rect) {
    return rect.bottom >= 0 && rect.top <= window.innerHeight && rect.width > 0 && rect.height > 0;
  }

  function isCheckboxAnchorVisible(rect) {
    return (
      isVisibleRect(rect) &&
      rect.top >= 0 &&
      rect.top <= window.innerHeight - 8
    );
  }

  function getViewportWidth() {
    return document.documentElement?.clientWidth || window.innerWidth;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getUserCheckboxAnchor(containerEl, userMsgs) {
    for (const msgEl of userMsgs || []) {
      const bubbleEl = msgEl.querySelector(".user-message-bubble-color");
      if (bubbleEl) return bubbleEl;

      const textEl = msgEl.querySelector(".whitespace-pre-wrap");
      if (textEl?.parentElement) return textEl.parentElement;

      const imageEl = Array.from(msgEl.querySelectorAll("img")).find(ns.isLikelyContentImage);
      if (imageEl?.parentElement) return imageEl.parentElement;
    }

    return getConversationColumnAnchor(containerEl) || userMsgs?.[0] || containerEl;
  }

  function getAssistantCheckboxAnchor(containerEl, assistantMsgs) {
    for (const msgEl of assistantMsgs || []) {
      const markdownEl = msgEl.querySelector(".markdown");
      if (markdownEl) return markdownEl;

      const contentEl =
        msgEl.querySelector("pre") ||
        Array.from(msgEl.querySelectorAll("img")).find(ns.isLikelyContentImage) ||
        msgEl.firstElementChild;

      if (contentEl) return contentEl;
    }

    return getConversationColumnAnchor(containerEl) || assistantMsgs?.[0] || containerEl;
  }

  function getConversationColumnAnchor(containerEl) {
    if (!containerEl) return null;

    return (
      containerEl.querySelector(".group\\/turn-messages") ||
      containerEl.querySelector('[class*="group/turn-messages"]') ||
      containerEl.querySelector('[class*="thread-content-max-width"]') ||
      containerEl.querySelector(".text-base > div") ||
      containerEl
    );
  }

  function isConversationHref(href) {
    try {
      const url = new URL(href, location.origin);
      return /\/c\/[0-9a-f-]{12,}/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function getSidebarSelectionFromEventTarget(target) {
    const el = target?.nodeType === Node.ELEMENT_NODE ? target : null;
    if (!el) return null;

    const optionsButton = el.closest('button[aria-label*="conversation options" i]') || el.closest("button");
    const anchor = findConversationAnchorNearElement(el, optionsButton);

    const href = anchor?.getAttribute?.("href") || anchor?.href || "";
    if (!href || !isConversationHref(href)) return null;

    const url = new URL(href, location.origin).toString();
    const title =
      getConversationTitleFromOptionsButton(optionsButton) ||
      normalizeTextTrim(anchor?.getAttribute?.("title")) ||
      getConversationTitleFromAnchor(anchor) ||
      "ChatGPT Conversation";

    return { providerName: provider.name, title, url };
  }

  function getSidebarSelectionFromMenu(menu) {
    const menuLabel = normalizeTextTrim(menu?.getAttribute?.("aria-label"));
    const expandedButtons = Array.from(
      document.querySelectorAll('button[aria-expanded="true"][aria-label*="conversation options" i]')
    );
    const labeledButtons = Array.from(
      document.querySelectorAll('button[aria-label*="conversation options" i]')
    );

    const button =
      (menuLabel && labeledButtons.find((candidate) =>
        normalizeTextTrim(candidate.getAttribute("aria-label")) === menuLabel
      )) ||
      expandedButtons.find((candidate) => getSidebarSelectionFromEventTarget(candidate)) ||
      null;

    return getSidebarSelectionFromEventTarget(button);
  }

  function getCurrentConversationSelection() {
    const conversationId = ns.chatGptData.getConversationId(location.href);
    if (!conversationId) return null;

    const conversationAnchor = Array.from(document.querySelectorAll('a[href*="/c/"]'))
      .find((anchor) =>
        ns.chatGptData.getConversationId(anchor.getAttribute("href") || anchor.href || "") ===
        conversationId
      );
    const projectName = normalizeTextTrim(
      document.querySelector('a[aria-label^="Open "][aria-label$=" project"]')?.textContent
    );
    const documentTitle = normalizeTextTrim(document.title);
    const titleWithoutProject = projectName && documentTitle.startsWith(`${projectName} - `)
      ? documentTitle.slice(projectName.length + 3).trim()
      : documentTitle;
    const title =
      getConversationTitleFromAnchor(conversationAnchor) ||
      titleWithoutProject ||
      "ChatGPT Conversation";

    return {
      providerName: provider.name,
      title,
      url: location.href
    };
  }

  function findConversationAnchorNearElement(el, optionsButton) {
    const directAnchor = el.closest('a[href*="/c/"]') || optionsButton?.closest?.('a[href*="/c/"]');
    if (directAnchor) return directAnchor;

    let current = optionsButton?.parentElement || el.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1) {
      const anchors = Array.from(current.querySelectorAll?.('a[href*="/c/"]') || [])
        .filter((anchor) => isConversationHref(anchor.getAttribute("href") || anchor.href || ""));
      if (anchors.length === 1) return anchors[0];
      if (current.matches?.("main, nav, aside")) break;
      current = current.parentElement;
    }

    return el.closest("li")?.querySelector?.('a[href*="/c/"]') || null;
  }

  function getConversationTitleFromOptionsButton(button) {
    const ariaLabel = normalizeTextTrim(button?.getAttribute?.("aria-label"));
    if (!ariaLabel) return "";

    const match = ariaLabel.match(/^Open conversation options for\s+(.+)$/i);
    return normalizeTextTrim(match?.[1]);
  }

  function getConversationTitleFromAnchor(anchor) {
    const ariaLabel = normalizeTextTrim(anchor?.getAttribute?.("aria-label"));
    if (ariaLabel) {
      const sidebarTitle = ariaLabel
        .replace(/,\s*chat in project\b.*$/i, "")
        .replace(/,\s*unread\s*$/i, "");
      if (sidebarTitle) return normalizeTextTrim(sidebarTitle);
    }

    const semanticTitle = anchor?.querySelector?.(
      'h1, h2, h3, h4, [data-testid*="title" i], [class*="font-semibold"], [class*="font-medium"]'
    );
    const semanticText = normalizeTextTrim(semanticTitle?.textContent);
    if (semanticText) return semanticText;

    return normalizeTextTrim(anchor?.textContent);
  }

  function isLikelyConversationMenu(menuItems) {
    const labels = menuItems.map((el) =>
      normalizeTextTrim(el.textContent).toLowerCase()
    );
    const hasDelete = labels.some((label) => label.includes("delete"));
    const hasRename = labels.some((label) => label.includes("rename"));
    const hasArchive = labels.some((label) => label.includes("archive"));

    return hasDelete && (hasRename || hasArchive);
  }

  ns.registerProvider(provider);
})();
