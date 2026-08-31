(() => {
  const ns = (window.ChatExporter = window.ChatExporter || {});
  if (ns.helpers) return;

  function sanitizeFilenamePart(input) {
    const trimmed = String(input ?? "").trim();
    const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
    const noBadChars = noControl.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
    return noBadChars || "AI Conversation";
  }

  function normalizeText(text) {
    return String(text ?? "").replace(/\s+/g, " ");
  }

  function normalizeTextTrim(text) {
    return normalizeText(text).trim();
  }

  function titleCaseRole(role) {
    const normalized = normalizeTextTrim(role);
    if (!normalized) return "Conversation";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function isElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE;
  }

  function isText(node) {
    return node?.nodeType === Node.TEXT_NODE;
  }

  function hasClassToken(el, token) {
    return Boolean(el?.classList?.contains(token));
  }

  function findDescendantsByClassToken(root, token) {
    if (!root) return [];

    const nodes = [];
    if (hasClassToken(root, token)) nodes.push(root);

    for (const el of Array.from(root.querySelectorAll("[class]"))) {
      if (hasClassToken(el, token)) nodes.push(el);
    }

    return nodes;
  }

  function compareDomOrder(a, b) {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function sortNodesByDomOrder(nodes) {
    return [...nodes].filter(Boolean).sort(compareDomOrder);
  }

  function dedupeNodes(nodes) {
    const out = [];
    const seen = new Set();

    for (const node of sortNodesByDomOrder(nodes)) {
      if (seen.has(node)) continue;
      seen.add(node);
      out.push(node);
    }

    return out;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function wrapCollapsibleSection(summary, body) {
    const safeSummary = escapeHtml(summary);
    const trimmedBody = String(body ?? "").trim();

    if (!safeSummary) {
      return trimmedBody;
    }

    if (!trimmedBody) {
      return `<details>\n<summary>${safeSummary}</summary>\n</details>`;
    }

    return `<details>\n<summary>${safeSummary}</summary>\n\n${trimmedBody}\n</details>`;
  }

  function maybeCloseRadixMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function replaceMenuIconWithDownload(downloadItem) {
    const svg = downloadItem.querySelector("svg");
    if (!svg) return;

    const width = svg.getAttribute("width") || "20";
    const height = svg.getAttribute("height") || "20";
    const cls = svg.getAttribute("class") || "";

    const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    newSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    newSvg.setAttribute("width", width);
    newSvg.setAttribute("height", height);
    newSvg.setAttribute("viewBox", "0 0 20 20");
    newSvg.setAttribute("fill", "none");
    newSvg.setAttribute("aria-hidden", "true");
    if (cls) newSvg.setAttribute("class", cls);

    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path1.setAttribute("d", "M10 3v8");
    path1.setAttribute("stroke", "currentColor");
    path1.setAttribute("stroke-width", "1.8");
    path1.setAttribute("stroke-linecap", "round");
    path1.setAttribute("stroke-linejoin", "round");

    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path2.setAttribute("d", "M6.5 8.8L10 11.9l3.5-3.1");
    path2.setAttribute("stroke", "currentColor");
    path2.setAttribute("stroke-width", "1.8");
    path2.setAttribute("stroke-linecap", "round");
    path2.setAttribute("stroke-linejoin", "round");

    const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path3.setAttribute("d", "M4.5 14.5h11");
    path3.setAttribute("stroke", "currentColor");
    path3.setAttribute("stroke-width", "1.8");
    path3.setAttribute("stroke-linecap", "round");
    path3.setAttribute("stroke-linejoin", "round");

    newSvg.appendChild(path1);
    newSvg.appendChild(path2);
    newSvg.appendChild(path3);
    svg.replaceWith(newSvg);
  }

  function injectDownloadIntoMenu({ menuEl, getSelection, isLikelyConversationMenu, onDownloadClick }) {
    if (!menuEl || menuEl.nodeType !== Node.ELEMENT_NODE) return;
    if (menuEl.dataset.chatExporterInjected === "1") return;

    const selection = getSelection?.();
    if (!selection?.url) return;

    const menuItems = Array.from(
      menuEl.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')
    ).filter((item) => item.closest?.('[role="menu"]') === menuEl);
    if (menuItems.length === 0) return;

    if (isLikelyConversationMenu && !isLikelyConversationMenu(menuItems)) return;

    const templateItem =
      menuItems.find((el) => normalizeTextTrim(el.textContent).toLowerCase() === "share") ||
      menuItems.find((el) => normalizeTextTrim(el.textContent).toLowerCase().startsWith("share")) ||
      menuItems[0];

    if (!templateItem) return;

    const downloadItem = templateItem.cloneNode(true);
    downloadItem.dataset.chatExporterItem = "1";

    const setHighlighted = (on) => {
      if (on) {
        for (const highlighted of menuEl.querySelectorAll("[data-highlighted]")) {
          highlighted.removeAttribute("data-highlighted");
        }
        downloadItem.setAttribute("data-highlighted", "");
      } else {
        downloadItem.removeAttribute("data-highlighted");
      }
    };

    downloadItem.addEventListener("pointerenter", () => setHighlighted(true), true);
    downloadItem.addEventListener("pointermove", () => setHighlighted(true), true);
    downloadItem.addEventListener("pointerleave", () => setHighlighted(false), true);

    replaceMenuIconWithDownload(downloadItem);

    const walker = document.createTreeWalker(downloadItem, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    let replaced = false;
    for (const textNode of texts) {
      if (normalizeTextTrim(textNode.nodeValue).toLowerCase().includes("share")) {
        textNode.nodeValue = textNode.nodeValue.replace(/share/i, "Download");
        replaced = true;
      }
    }
    if (!replaced) {
      const primaryTextNode = texts.find((textNode) => normalizeTextTrim(textNode.nodeValue));
      if (primaryTextNode) {
        primaryTextNode.nodeValue = "Download";
      } else {
        downloadItem.textContent = "Download";
      }
    }

    if (downloadItem.hasAttribute("aria-label")) {
      downloadItem.setAttribute("aria-label", "Download");
    }

    downloadItem.addEventListener(
      "click",
      (event) => {
        const latestSelection = getSelection?.();
        if (!latestSelection?.url) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        maybeCloseRadixMenu();
        onDownloadClick({ ...latestSelection });
      },
      true
    );

    templateItem.insertAdjacentElement("afterend", downloadItem);
    menuEl.dataset.chatExporterInjected = "1";
  }

  ns.STORAGE_KEY = ns.STORAGE_KEY || "chatgpt_md_downloader_settings";
  ns.helpers = {
    compareDomOrder,
    dedupeNodes,
    findDescendantsByClassToken,
    hasClassToken,
    isElement,
    isText,
    normalizeText,
    normalizeTextTrim,
    escapeHtml,
    sanitizeFilenamePart,
    sortNodesByDomOrder,
    titleCaseRole,
    wrapCollapsibleSection
  };
  ns.menuUtils = {
    injectDownloadIntoMenu,
    maybeCloseRadixMenu,
    replaceMenuIconWithDownload
  };
})();
