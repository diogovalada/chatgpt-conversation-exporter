(() => {
  const ns = window.ChatExporter;
  const { isElement, isText, normalizeText } = ns.helpers;

  function isBlockTag(tagName) {
    return (
      tagName === "P" ||
      tagName === "DIV" ||
      tagName === "SECTION" ||
      tagName === "ARTICLE" ||
      tagName === "UL" ||
      tagName === "OL" ||
      tagName === "LI" ||
      tagName === "PRE" ||
      tagName === "TABLE" ||
      tagName === "HR" ||
      /^H[1-6]$/.test(tagName)
    );
  }

  function escapeInlineCode(text) {
    const t = String(text ?? "");
    if (!t.includes("`")) return `\`${t}\``;
    const fence = "``";
    return `${fence}${t.replaceAll("``", "` `")}${fence}`;
  }

  function cleanCellText(text) {
    return normalizeText(text).replace(/\|/g, "\\|").trim();
  }

  function extractLanguageFromCodeEl(codeEl) {
    if (!codeEl) return "";
    const cls = codeEl.className || "";
    const match = cls.match(/\blanguage-([a-zA-Z0-9_+-]+)\b/);
    if (match) return match[1];
    return codeEl.getAttribute("data-language") || "";
  }

  function isLikelyContentImage(imgEl) {
    if (!imgEl) return false;

    const alt = (imgEl.getAttribute("alt") || "").trim();
    const cls = imgEl.className || "";
    const width = Number(imgEl.getAttribute("width") || 0);
    const height = Number(imgEl.getAttribute("height") || 0);
    const src = imgEl.getAttribute("src") || "";

    if (!src) return false;
    if (cls.includes("icon")) return false;
    if (width > 0 && width <= 64 && height > 0 && height <= 64) return false;
    if (/^data:/i.test(src)) return false;

    if (alt.toLowerCase().includes("uploaded image")) return true;
    if (src.includes("/backend-api/estuary/content")) return true;
    if (src.includes("images.openai.com")) return true;
    if (src.includes("assets-proxy.anthropic.com")) return true;

    return true;
  }

  function makeImageFilename(index) {
    const n = String(index).padStart(3, "0");
    return `image-${n}`;
  }

  function createMarkdownConverter({ downloadImages, imageFolder, imageCollector }) {
    const linkDest = (raw) => `<${encodeURI(String(raw ?? ""))}>`;

    function extractLatexFromKatex(el) {
      const ann = el.querySelector?.('annotation[encoding="application/x-tex"]');
      const tex = (ann?.textContent ?? "").trim();
      return tex || "";
    }

    function convertChildren(el, ctx) {
      let out = "";
      for (const child of Array.from(el.childNodes)) {
        out += convertNode(child, ctx);
      }
      return out;
    }

    function convertTable(tableEl) {
      const rows = Array.from(tableEl.querySelectorAll("tr"));
      if (rows.length === 0) return "";

      const getCells = (row) =>
        Array.from(row.children)
          .filter((c) => c.tagName === "TD" || c.tagName === "TH")
          .map((c) => cleanCellText(c.textContent || ""));

      let headerCells = [];
      let bodyRows = [];

      const firstCells = getCells(rows[0]);
      const firstRowHasTH = Array.from(rows[0].children).some((c) => c.tagName === "TH");

      if (firstRowHasTH) {
        headerCells = firstCells;
        bodyRows = rows.slice(1).map(getCells);
      } else {
        headerCells = firstCells.map((_, idx) => `Column ${idx + 1}`);
        bodyRows = rows.map(getCells);
      }

      const colCount = Math.max(
        headerCells.length,
        ...bodyRows.map((r) => r.length),
        1
      );

      const padRow = (cells) => {
        const padded = cells.slice(0, colCount);
        while (padded.length < colCount) padded.push("");
        return padded;
      };

      const header = padRow(headerCells);
      const sep = new Array(colCount).fill("---");
      const body = bodyRows.map(padRow);

      const line = (cells) => `| ${cells.join(" | ")} |`;
      const lines = [line(header), line(sep), ...body.map(line)];
      return `${lines.join("\n")}\n\n`;
    }

    function convertList(listEl, ctx) {
      const isOrdered = listEl.tagName === "OL";
      const items = Array.from(listEl.children).filter((c) => c.tagName === "LI");
      let out = "";

      for (let i = 0; i < items.length; i += 1) {
        const prefix = isOrdered ? `${i + 1}. ` : "- ";
        const itemText = convertChildren(items[i], { ...ctx, listDepth: (ctx.listDepth || 0) + 1 }).trim();
        const indent = "  ".repeat(ctx.listDepth || 0);
        const lines = itemText.split("\n");
        if (lines.length === 0) continue;

        out += `${indent}${prefix}${lines[0]}\n`;
        for (const lineText of lines.slice(1)) {
          out += `${indent}   ${lineText}\n`;
        }
      }

      return `${out}\n`;
    }

    function convertBlockquote(el, ctx) {
      const inner = convertChildren(el, ctx).trim();
      const lines = inner.split("\n").map((line) => `> ${line}`.trimEnd());
      return `${lines.join("\n")}\n\n`;
    }

    function convertNode(node, ctx) {
      if (isText(node)) {
        const text = node.nodeValue ?? "";
        if (!text) return "";
        if (ctx.inPre) return text;
        return text.replace(/\s+/g, " ");
      }

      if (!isElement(node)) return "";

      const el = node;
      const tag = el.tagName;

      if (el.classList?.contains("katex-display")) {
        const tex = extractLatexFromKatex(el);
        if (tex) return `\n$$\n${tex}\n$$\n\n`;
      }

      if (el.classList?.contains("katex")) {
        const tex = extractLatexFromKatex(el);
        if (tex) return `$${tex}$`;
      }

      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "ANNOTATION") return "";
      if (tag === "BUTTON" || tag === "SVG" || tag === "USE" || tag === "LABEL") return "";

      if (tag === "BR") return "\n";
      if (tag === "HR") return "\n---\n\n";

      if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const text = convertChildren(el, { ...ctx, inInline: true }).trim();
        return `\n${"#".repeat(level)} ${text}\n\n`;
      }

      if (tag === "P") {
        const text = convertChildren(el, { ...ctx, inInline: true }).trim();
        return text ? `${text}\n\n` : "";
      }

      if (tag === "STRONG" || tag === "B") {
        const inner = convertChildren(el, { ...ctx, inInline: true });
        return `**${inner}**`;
      }

      if (tag === "EM" || tag === "I") {
        const inner = convertChildren(el, { ...ctx, inInline: true });
        return `*${inner}*`;
      }

      if (tag === "CODE") {
        if (ctx.inPre) return el.textContent ?? "";
        return escapeInlineCode((el.textContent ?? "").trim());
      }

      if (tag === "PRE") {
        const codeEl = el.querySelector("code");
        const language = extractLanguageFromCodeEl(codeEl) || "";
        const raw = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
        const fence = "```";
        return `\n${fence}${language}\n${raw}\n${fence}\n\n`;
      }

      if (tag === "A") {
        const href = el.getAttribute("href") || "";
        const text = convertChildren(el, { ...ctx, inInline: true }).trim() || href;
        if (!href) return text;
        return `[${text}](${linkDest(href)})`;
      }

      if (tag === "IMG") {
        if (!isLikelyContentImage(el)) return "";

        const alt = (el.getAttribute("alt") || "").trim();
        const url = el.currentSrc || el.src || el.getAttribute("src") || "";
        if (!url) return "";

        if (downloadImages) {
          const idx = imageCollector.length + 1;
          const name = makeImageFilename(idx);
          imageCollector.push({ url, name, alt });
          return `![${alt}](${linkDest(`${imageFolder}/${name}`)})`;
        }

        return `![${alt}](${linkDest(url)})`;
      }

      if (tag === "UL" || tag === "OL") {
        return convertList(el, ctx);
      }

      if (tag === "LI") {
        return convertChildren(el, ctx);
      }

      if (tag === "TABLE") {
        return convertTable(el);
      }

      if (tag === "BLOCKQUOTE") {
        return convertBlockquote(el, ctx);
      }

      const out = convertChildren(el, ctx);
      if (isBlockTag(tag) && out.trim()) return `${out}\n\n`;
      return out;
    }

    return {
      convertElement: (el) => convertNode(el, { inInline: false, inPre: false, listDepth: 0 })
    };
  }

  ns.createMarkdownConverter = createMarkdownConverter;
  ns.isLikelyContentImage = isLikelyContentImage;
})();
