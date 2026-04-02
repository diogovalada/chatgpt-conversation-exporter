(() => {
  const ns = window.ChatExporter;
  const { compareDomOrder, normalizeTextTrim } = ns.helpers;

  const provider = {
    id: "chatgpt",
    name: "ChatGPT",

    hasConversation() {
      return getConversationTurnContainers().length > 0;
    },

    getTitle() {
      return document.title || "ChatGPT Conversation";
    },

    getTurns() {
      const root = findConversationRoot();
      const containers = getConversationTurnContainers(root);
      if (containers.length === 0) return [];

      const turns = [];
      for (const article of containers) {
        turns.push(...buildTurnsForContainer(article));
      }
      return turns;
    },

    initSidebarIntegration(onDownloadClick) {
      if (document.documentElement.dataset.chatExporterChatgptSidebarInit === "1") return;
      document.documentElement.dataset.chatExporterChatgptSidebarInit = "1";

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

  function findConversationRoot() {
    return (
      document.querySelector("#thread") ||
      document.querySelector("main #thread") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body
    );
  }

  function getConversationTurnContainers(root = findConversationRoot()) {
    const selectors = [
      'article[data-testid^="conversation-turn-"]',
      "article[data-turn]",
      "[data-turn]"
    ];

    for (const selector of selectors) {
      const turns = Array.from(root.querySelectorAll(selector)).filter((el) =>
        Boolean(el.querySelector("[data-message-author-role]"))
      );
      if (turns.length > 0) return turns;
    }

    const messageEls = Array.from(root.querySelectorAll("[data-message-author-role]"));
    if (messageEls.length === 0) return [];

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

  function buildTurnsForContainer(article) {
    const turnRole = article.getAttribute("data-turn") || "";
    const messageEls = Array.from(article.querySelectorAll("[data-message-author-role]"));
    if (messageEls.length === 0) return [];

    if (turnRole === "user") {
      const userMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "user");
      return userMsgs.length > 0 ? [createUserTurn(userMsgs)] : [];
    }

    if (turnRole === "assistant") {
      const assistantMsgs = messageEls.filter((m) => m.getAttribute("data-message-author-role") === "assistant");
      return assistantMsgs.length > 0 ? [createAssistantTurn(article, assistantMsgs)] : [];
    }

    return messageEls.map((msgEl) => createFallbackTurn(msgEl));
  }

  function createUserTurn(userMsgs) {
    return {
      role: "user",
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

  function createAssistantTurn(article, assistantMsgs) {
    return {
      role: "assistant",
      toMarkdown(converter) {
        const blocks = [];
        const hasMessageAncestor = (el) => Boolean(el.closest("[data-message-author-role]"));

        for (const msgEl of assistantMsgs) {
          const markdownRoot = msgEl.querySelector(".markdown") || msgEl;
          blocks.push({ type: "assistant_message", el: markdownRoot });
        }

        for (const preEl of Array.from(article.querySelectorAll("pre"))) {
          if (hasMessageAncestor(preEl)) continue;

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

  function createFallbackTurn(msgEl) {
    const role = msgEl.getAttribute("data-message-author-role") || "unknown";

    return {
      role,
      toMarkdown(converter) {
        return converter.convertElement(msgEl).trim();
      }
    };
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

    const anchor =
      el.closest('a[href*="/c/"]') ||
      el.closest("button")?.closest("a") ||
      el.closest("li")?.querySelector?.('a[href*="/c/"]') ||
      null;

    const href = anchor?.getAttribute?.("href") || anchor?.href || "";
    if (!href || !isConversationHref(href)) return null;

    const url = new URL(href, location.origin).toString();
    const title =
      normalizeTextTrim(anchor?.getAttribute?.("title")) ||
      normalizeTextTrim(anchor?.textContent) ||
      "ChatGPT Conversation";

    return { providerName: provider.name, title, url };
  }

  function isLikelyConversationMenu(menuItems) {
    const isLikelyChatMenu =
      menuItems.some((el) => normalizeTextTrim(el.textContent).toLowerCase().includes("rename")) ||
      menuItems.some((el) => normalizeTextTrim(el.textContent).toLowerCase().includes("delete"));

    return isLikelyChatMenu;
  }

  ns.registerProvider(provider);
})();
