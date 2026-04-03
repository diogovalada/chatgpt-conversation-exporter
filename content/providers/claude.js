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

  const provider = {
    id: "claude",
    name: "Claude",

    hasConversation() {
      return getConversationTurnContainers().length > 0;
    },

    getTitle() {
      return document.title || "Claude Conversation";
    },

    getTurns() {
      const turnContainers = getConversationTurnContainers();
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

  function hasUserTurn(turnEl) {
    return countUserMessages(turnEl) > 0;
  }

  function hasAssistantTurn(turnEl) {
    return Boolean(turnEl.querySelector(".standard-markdown")) || getClaudeStatusPanels(turnEl).length > 0;
  }

  function findFallbackUserTurnWrapper(userEl) {
    return userEl.closest(".mb-1.mt-6.group") || userEl.closest(".mb-1") || userEl.parentElement;
  }

  function findFallbackAssistantTurnWrapper(assistantEl) {
    return assistantEl.closest(".group.relative.pb-3") || assistantEl.closest(".group") || assistantEl.parentElement;
  }

  function getConversationTurnContainers() {
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

  function createUserTurn(turnEl) {
    return {
      role: "user",
      toMarkdown(converter) {
        const userEls = findClaudeUserMessageElements(turnEl);
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
