const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "shared.js"),
  "utf8"
);

const ChatExporter = {};
const insertedItems = [];
const documentStub = {
  createTreeWalker(root) {
    let consumed = false;
    return {
      currentNode: null,
      nextNode() {
        if (consumed || !root.textNode) return false;
        consumed = true;
        this.currentNode = root.textNode;
        return true;
      }
    };
  }
};
vm.runInNewContext(source, {
  window: { ChatExporter },
  document: documentStub,
  Node: { ELEMENT_NODE: 1 },
  NodeFilter: { SHOW_TEXT: 4 }
});

let cloneCount = 0;
const parentMenu = {};
const submenu = {
  nodeType: 1,
  dataset: {},
  querySelectorAll() {
    return [newProjectItem, projectItem, parentRenameItem];
  }
};

function makeItem(textContent, owner) {
  return {
    textContent,
    closest() {
      return owner;
    },
    cloneNode() {
      cloneCount += 1;
      return {};
    }
  };
}

const newProjectItem = makeItem("New project", submenu);
const projectItem = makeItem("Transformation", submenu);
const parentRenameItem = makeItem("Rename", parentMenu);

ChatExporter.menuUtils.injectDownloadIntoMenu({
  menuEl: submenu,
  getSelection: () => ({ url: "https://chatgpt.com/c/test" }),
  isLikelyConversationMenu: () => false,
  onDownloadClick() {}
});

assert.equal(cloneCount, 0);
assert.notEqual(submenu.dataset.chatExporterInjected, "1");

const headerMenu = {
  nodeType: 1,
  dataset: {},
  querySelectorAll() {
    return [viewFilesItem, archiveItem, deleteItem];
  }
};

function makeDownloadClone() {
  return {
    dataset: {},
    textNode: { nodeValue: "View files in chat" },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    hasAttribute() {
      return false;
    },
    setAttribute() {}
  };
}

const viewFilesItem = {
  textContent: "View files in chat",
  closest() {
    return headerMenu;
  },
  cloneNode() {
    cloneCount += 1;
    return makeDownloadClone();
  },
  insertAdjacentElement(_position, item) {
    insertedItems.push(item);
  }
};
const archiveItem = makeItem("Archive", headerMenu);
const deleteItem = makeItem("Delete", headerMenu);

ChatExporter.menuUtils.injectDownloadIntoMenu({
  menuEl: headerMenu,
  getSelection: () => ({ url: "https://chatgpt.com/c/test" }),
  isLikelyConversationMenu: (items) => {
    const labels = items.map((item) => item.textContent.toLowerCase());
    return labels.includes("archive") && labels.includes("delete");
  },
  onDownloadClick() {}
});

assert.equal(cloneCount, 1);
assert.equal(insertedItems.length, 1);
assert.equal(insertedItems[0].textNode.nodeValue, "Download");
assert.equal(headerMenu.dataset.chatExporterInjected, "1");
console.log("menu injection tests passed");
