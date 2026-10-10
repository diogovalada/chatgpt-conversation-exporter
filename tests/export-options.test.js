const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const key = "chatgpt_md_downloader_settings";
const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const clone = (v) => JSON.parse(JSON.stringify(v));

function element() {
  const listeners = new Map();
  const children = new Map();
  return {
    id: "", checked: false, disabled: false, textContent: "", classList: { toggle() {} },
    set innerHTML(html) {
      for (const match of html.matchAll(/<[a-z]+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const el = element();
        el.id = match[2];
        el.disabled = /\bdisabled\b/.test(match[1]);
        children.set(el.id, el);
      }
      children.set(".chat-exporter-x", element());
    },
    querySelector(selector) { return children.get(selector.replace(/^#/, "")); },
    appendChild(el) { children.set(el.id, el); },
    remove() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    async trigger(type) { assert.ok(listeners.has(type), `missing ${type} listener`); await listeners.get(type)(); }
  };
}

function setup(saved, shared) {
  const backing = shared || { values: saved === undefined ? {} : { [key]: clone(saved) }, listeners: new Set() };
  const state = { messages: [], tabMessages: [], clipboard: "" };
  Object.defineProperty(state, "saved", { get() {
    const settings = { ...(backing.values[key] || {}) };
    for (const field of ["downloadImages", "includeToolActivity"]) {
      if (typeof backing.values[`${key}.${field}`] === "boolean") settings[field] = backing.values[`${key}.${field}`];
    }
    return settings;
  } });
  const body = element();
  body.innerHTML = source("popup.html");
  const root = element();
  const chrome = {
    storage: { local: {
      async get(defaults) { return clone({ ...defaults, ...backing.values }); },
      async set(values) {
        const changes = {};
        for (const [name, value] of Object.entries(values)) {
          changes[name] = { oldValue: backing.values[name], newValue: value };
          backing.values[name] = clone(value);
        }
        await Promise.all([...backing.listeners].map((listener) => listener(changes, "local")));
      }
    }, onChanged: { addListener(fn) { backing.listeners.add(fn); }, removeListener(fn) { backing.listeners.delete(fn); } } },
    tabs: {
      async query() { return [{ id: 1 }]; },
      async sendMessage(id, message) {
        state.tabMessages.push(clone(message));
        return message.type === "PING" ? { ok: true, providerName: "Claude" } : { ok: true, markdown: "text" };
      }
    },
    runtime: { async sendMessage(message) { state.messages.push(clone(message)); return { ok: true, markdown: "text", bundled: "md" }; } }
  };
  const document = {
    body, documentElement: root, createElement: element,
    getElementById(id) {
      return body.querySelector(`#${id}`) || root.querySelector(`#${id}`) ||
        body.querySelector("#chat-exporter-panel")?.querySelector(`#${id}`);
    }
  };
  const window = { ChatExporter: {} };
  const context = vm.createContext({ window, document, chrome,
    navigator: { clipboard: { async writeText(text) { state.clipboard = text; } } }, setTimeout });
  const load = (file) => vm.runInContext(source(file), context);
  load("export-settings.js");
  return { state, context, load, document, chrome, backing, ns: window.ChatExporter };
}

(async () => {
  const fresh = setup();
  assert.deepEqual(clone(await fresh.context.ChatExporterSettings.load(fresh.chrome.storage.local)), {
    downloadImages: false, includeToolActivity: false
  });
  const old = setup({ downloadImages: true, futureSetting: "preserve" });
  const upgraded = await old.context.ChatExporterSettings.load(old.chrome.storage.local);
  assert.equal(upgraded.downloadImages, true);
  assert.equal(upgraded.includeToolActivity, false);
  await old.context.ChatExporterSettings.save(old.chrome.storage.local, { includeToolActivity: true });
  assert.deepEqual(old.state.saved, { downloadImages: true, futureSetting: "preserve", includeToolActivity: true });

  fresh.load("popup.js");
  await new Promise(setImmediate);
  const images = fresh.document.getElementById("downloadImages");
  const tools = fresh.document.getElementById("includeToolActivity");
  assert.equal(images.checked, false);
  assert.equal(tools.checked, false);
  tools.checked = true;
  await tools.trigger("change");
  images.checked = true;
  await images.trigger("change");
  assert.deepEqual(fresh.state.saved, { downloadImages: true, includeToolActivity: true });
  await fresh.document.getElementById("copyMarkdown").trigger("click");
  assert.deepEqual(fresh.state.tabMessages.at(-1).options, { downloadImages: false, includeToolActivity: true });
  for (const id of ["saveDownloads", "saveAs"]) {
    await fresh.document.getElementById(id).trigger("click");
    assert.equal(fresh.state.messages.at(-1).includeToolActivity, true);
    assert.equal(fresh.state.messages.at(-1).downloadImages, true);
    assert.equal(fresh.state.messages.at(-1).saveAs, id === "saveAs");
  }

  // Opening the menu dialog restores the same preferences and every action forwards them.
  fresh.load("content/sidebar-panel.js");
  const selection = { providerName: "Claude", title: "Fixture", url: "https://claude.ai/chat/12345678-1234-1234-1234-123456789012" };
  await fresh.ns.openSidebarPanel(selection);
  const menuImages = fresh.document.getElementById("chat-exporter-images");
  const menuTools = fresh.document.getElementById("chat-exporter-tools");
  assert.equal(menuImages.checked, true);
  assert.equal(menuTools.checked, true);
  await fresh.document.getElementById("chat-exporter-copy").trigger("click");
  assert.equal(fresh.state.messages.at(-1).includeToolActivity, true);
  menuTools.checked = false;
  await menuTools.trigger("change");
  assert.equal(fresh.state.saved.downloadImages, true);
  for (const id of ["chat-exporter-save", "chat-exporter-saveas"]) {
    await fresh.document.getElementById(id).trigger("click");
    assert.equal(fresh.state.messages.at(-1).includeToolActivity, false);
    assert.equal(fresh.state.messages.at(-1).downloadImages, true);
    assert.equal(fresh.state.messages.at(-1).saveAs, id === "chat-exporter-saveas");
    assert.equal(fresh.document.getElementById("chat-exporter-status").textContent, "Downloaded (.md).");
  }
  const reopened = setup(fresh.state.saved);
  reopened.load("popup.js");
  await new Promise(setImmediate);
  assert.equal(reopened.document.getElementById("downloadImages").checked, true);
  assert.equal(reopened.document.getElementById("includeToolActivity").checked, false);
  const firstMenu = setup();
  firstMenu.load("content/sidebar-panel.js");
  await firstMenu.ns.openSidebarPanel(selection);
  assert.equal(firstMenu.document.getElementById("chat-exporter-images").checked, false);
  assert.equal(firstMenu.document.getElementById("chat-exporter-tools").checked, false);

  // Separate extension contexts can stay open and change different preferences.
  const popup = setup();
  const menu = setup(undefined, popup.backing);
  popup.load("popup.js");
  menu.load("content/sidebar-panel.js");
  await menu.ns.openSidebarPanel(selection);
  await new Promise(setImmediate);
  const popupTools = popup.document.getElementById("includeToolActivity");
  popupTools.checked = true;
  await popupTools.trigger("change");
  assert.equal(menu.document.getElementById("chat-exporter-tools").checked, true);
  const dialogImages = menu.document.getElementById("chat-exporter-images");
  dialogImages.checked = true;
  await dialogImages.trigger("change");
  assert.equal(popup.document.getElementById("downloadImages").checked, true);
  assert.deepEqual(popup.state.saved, { includeToolActivity: true, downloadImages: true });
  // Simultaneous writes also preserve both flags without read/modify/write races.
  await Promise.all([
    popup.context.ChatExporterSettings.save(popup.chrome.storage.local, { includeToolActivity: false }),
    menu.context.ChatExporterSettings.save(menu.chrome.storage.local, { downloadImages: false })
  ]);
  assert.deepEqual(popup.state.saved, { includeToolActivity: false, downloadImages: false });
  menu.ns.closeSidebarPanel();
  assert.equal(popup.backing.listeners.size, 1, "closing the menu removes its storage listener");
  console.log("export options and settings tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
