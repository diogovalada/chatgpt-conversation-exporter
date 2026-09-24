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
const windowStub = {
  ChatExporter,
  getComputedStyle(element) {
    return {
      display: element.computedDisplay || "block",
      visibility: element.computedVisibility || "visible"
    };
  }
};
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
  window: windowStub,
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
    return [hiddenShareItem, viewFilesItem, archiveItem, deleteItem];
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
const hiddenShareItem = makeItem("Share", headerMenu);
hiddenShareItem.computedDisplay = "none";
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

const nestedMenu = { id: "nested" };
const existingMenu = {
  nodeType: 1,
  matches(selector) {
    return selector === '[role="menu"]';
  },
  closest(selector) {
    return selector === '[role="menu"]' ? this : null;
  },
  querySelectorAll() {
    return [nestedMenu];
  }
};
const discoveredMenus = ChatExporter.menuUtils.findMenusFromNode(existingMenu);
assert.deepEqual(Array.from(discoveredMenus), [existingMenu, nestedMenu]);

console.log("menu injection tests passed");
