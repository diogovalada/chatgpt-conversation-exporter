const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

// Exercise the real isolated-world client and MAIN-world fetch bridge together.
module.exports = function createClaudeContext({ fetch, ChatExporter = {}, location, document = {} }) {
  const listeners = new Set();
  const window = {
    ChatExporter,
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    postMessage(data) {
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({ source: window, origin: location.origin, data });
      });
    }
  };
  const context = vm.createContext({
    window, location, document, fetch, URL, console, setTimeout, clearTimeout,
    crypto: { randomUUID }
  });
  function load(relativePath) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8"), context, {
      filename: relativePath
    });
  }
  load("content/shared.js");
  load("content/providers/claude-api.js");
  load("content/providers/claude-page-fetch.js");
  return { context, load, ns: window.ChatExporter, listeners };
};
