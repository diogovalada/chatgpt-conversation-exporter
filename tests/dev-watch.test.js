const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");

(async () => {
  const { runtimeEntries, collectSources, sourceRevision, developmentFiles, writeDevelopmentBuild, validateWorkerDependencies, startWatcher } =
    await import("../scripts/dev-watch.mjs");
  const { installDevReload } = await import("../scripts/dev-reload.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conversation-exporter-development-test-"));
  let watcher;
  const validator = path.resolve(__dirname, "../scripts/validate-extension.mjs");
  const manifest = {
    manifest_version: 3, name: "Fixture", version: "1.0.0", description: "Fixture extension",
    permissions: ["downloads", "storage"], host_permissions: ["https://claude.ai/*"],
    background: { service_worker: "background.js", type: "module" }, action: { default_popup: "popup.html" },
    content_scripts: [{ matches: ["https://claude.ai/*"], js: ["content/example.js"] }]
  };
  async function write(file, text) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), text);
  }
  async function unusedPort() {
    const server = createServer();
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;
    await new Promise((done) => server.close(done));
    return port;
  }
  try {
    await write("manifest.json", JSON.stringify(manifest));
    for (const file of runtimeEntries.filter((file) => file !== "manifest.json" && !["content", "icons", "vendor"].includes(file))) {
      await write(file, file.endsWith(".js") ? "// Fixture\n" : "fixture");
    }
    await write("content/example.js", "const example = 1;\n");
    await write("icons/example.png", "fixture");
    await write("vendor/example.js", "// Fixture\n");
    await write("scripts/dev-reload.mjs", await fs.readFile(path.resolve(__dirname, "../scripts/dev-reload.mjs")));
    await write("README.md", "Not a runtime source");
    const sources = await collectSources(root);
    const originalManifest = sources.get("manifest.json").toString();
    const revision = sourceRevision(sources);
    assert.equal(revision, sourceRevision(new Map([...sources].reverse())));
    const settings = { port: await unusedPort(), token: "a".repeat(64) };
    const development = developmentFiles(sources, settings, revision);
    const devManifest = JSON.parse(development.get("manifest.json"));
    assert.match(devManifest.name, /DEVELOPMENT BUILD$/);
    assert.equal(devManifest.minimum_chrome_version, "120");
    assert.ok(devManifest.permissions.includes("alarms"));
    assert.ok(devManifest.host_permissions.includes("http://127.0.0.1/*"));
    assert.equal(devManifest.background.service_worker, "dev-service-worker.js");
    assert.equal(sources.get("manifest.json").toString(), originalManifest);
    assert.ok(!development.has("scripts/dev-reload.mjs"));
    assert.ok(!development.has("README.md"));
    assert.match(development.get("dev-service-worker.js").toString(), /import "\.\/background.js"/);
    assert.doesNotThrow(() => validateWorkerDependencies(new Map(development).set("background.js", Buffer.from('throw new Error("Do not execute extension code");\n'))));

    const output = path.join(root, "dist", "development");
    await writeDevelopmentBuild(output, development);
    await fs.writeFile(path.join(output, "stale.js"), "stale");
    await writeDevelopmentBuild(output, development);
    await assert.rejects(fs.stat(path.join(output, "stale.js")), { code: "ENOENT" });
    await assert.rejects(writeDevelopmentBuild(output, new Map([["../escape", Buffer.from("bad")]])), /escaped/);
    assert.equal(await fs.readFile(path.join(output, "background.js"), "utf8"), "// Fixture\n");
    const asFile = new Map(development).set("content/layout", Buffer.from("file"));
    await writeDevelopmentBuild(output, asFile);
    const asDirectory = new Map(development).set("content/layout/nested.txt", Buffer.from("nested"));
    await writeDevelopmentBuild(output, asDirectory);
    assert.equal(await fs.readFile(path.join(output, "content/layout/nested.txt"), "utf8"), "nested");
    await writeDevelopmentBuild(output, asFile);
    assert.equal(await fs.readFile(path.join(output, "content/layout"), "utf8"), "file");
    const changedBackground = new Map(asDirectory).set("background.js", Buffer.from("// Changed\n"));
    await assert.rejects(writeDevelopmentBuild(output, changedBackground, {
      async renameDirectory(source, destination) {
        if (destination === output) throw Object.assign(new Error("Simulated publication failure"), { code: "EACCES" });
        await fs.rename(source, destination);
      }
    }), /Simulated publication failure/);
    assert.equal(await fs.readFile(path.join(output, "background.js"), "utf8"), "// Fixture\n");
    assert.equal(await fs.readFile(path.join(output, "content/layout"), "utf8"), "file");
    await writeDevelopmentBuild(output, changedBackground);
    assert.equal(await fs.readFile(path.join(output, "background.js"), "utf8"), "// Changed\n");
    assert.deepEqual((await fs.readdir(path.dirname(output))).sort(), ["development"]);
    assert.equal(spawnSync(process.execPath, [validator, root], { encoding: "utf8" }).status, 0);
    const rejected = spawnSync(process.execPath, [validator, output], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Development.*must not/);

    await write("background.js", 'import { example } from "./vendor/example.js";\n');
    await write("vendor/example.js", 'export { example } from "./nested.js";\n');
    await write("vendor/nested.js", 'export const example = 1;\n// import "./not-a-real-import.js"\n');
    watcher = await startWatcher({ root, port: settings.port, intervalMs: 100000, log() {} });
    const url = `http://127.0.0.1:${settings.port}/status`;
    const auth = { "X-Development-Token": watcher.settings.token };
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: auth })).status, 403);
    assert.equal((await fetch(url, { headers: { ...auth, Origin: "https://evil.example" } })).status, 403);
    const forgedHostStatus = await new Promise((done, reject) => {
      const request = http.get(url, { headers: { ...auth, Host: `evil.example:${settings.port}` } }, (response) => {
        response.resume();
        done(response.statusCode);
      });
      request.on("error", reject);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(`${url}?token=ignored`, { headers: auth })).status, 403);
    const authorized = await fetch(url, { headers: { ...auth, Origin: `chrome-extension://${"a".repeat(32)}` } });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("access-control-allow-origin"), null);
    assert.equal((await authorized.json()).revision, watcher.getRevision());
    const first = watcher.getRevision();
    await write("background.js", 'import { unavailable as example } from "./vendor/example.js";\n');
    await assert.rejects(watcher.rebuild(), /does not provide an export named 'unavailable'/);
    assert.equal(watcher.getRevision(), first);
    assert.equal(await fs.readFile(path.join(output, "background.js"), "utf8"), 'import { example } from "./vendor/example.js";\n');
    assert.equal((await (await fetch(url, { headers: auth })).json()).revision, first);
    await write("background.js", 'import { example } from "./vendor/example.js";\n');
    await write("vendor/example.js", 'export { unavailable as example } from "./nested.js";\n');
    await assert.rejects(watcher.rebuild(), /does not provide an export named 'unavailable'/);
    assert.equal(watcher.getRevision(), first);
    assert.equal(await fs.readFile(path.join(output, "vendor/example.js"), "utf8"), 'export { example } from "./nested.js";\n');
    await write("vendor/example.js", 'export { example } from "./nested.js";\n');
    const reloadSource = await fs.readFile(path.join(root, "scripts/dev-reload.mjs"), "utf8");
    await write("scripts/dev-reload.mjs", 'import "./vendor/missing-dev-dependency.js";\n' + reloadSource);
    await assert.rejects(watcher.rebuild(), /Worker imports a missing source file: vendor\/missing-dev-dependency.js/);
    assert.equal(watcher.getRevision(), first);
    assert.equal(await fs.readFile(path.join(output, "dev-reload.mjs"), "utf8"), reloadSource);
    assert.equal((await (await fetch(url, { headers: auth })).json()).revision, first);
    await write("scripts/dev-reload.mjs", reloadSource);
    await fs.unlink(path.join(root, "vendor/nested.js"));
    await assert.rejects(watcher.rebuild(), /Worker imports a missing source file: vendor\/nested.js/);
    assert.equal(watcher.getRevision(), first);
    assert.match(await fs.readFile(path.join(output, "vendor/nested.js"), "utf8"), /example = 1/);
    assert.equal((await (await fetch(url, { headers: auth })).json()).revision, first);
    await write("vendor/nested.js", 'export const example = 1;\n// import "./not-a-real-import.js"\n');
    await fs.unlink(path.join(root, "content/example.js"));
    await assert.rejects(watcher.rebuild(), /Manifest references a missing source file/);
    assert.equal(watcher.getRevision(), first);
    assert.equal(await fs.readFile(path.join(output, "content/example.js"), "utf8"), "const example = 1;\n");
    assert.equal((await (await fetch(url, { headers: auth })).json()).revision, first);
    await write("content/example.js", "const example = 2;\n");
    await watcher.rebuild();
    assert.notEqual(watcher.getRevision(), first);
    assert.equal(await fs.readFile(path.join(output, "content/example.js"), "utf8"), "const example = 2;\n");
    const validRevision = watcher.getRevision();
    await write("content/example.js", "const = invalid syntax;");
    await assert.rejects(watcher.rebuild(), /Invalid JavaScript/);
    assert.equal(watcher.getRevision(), validRevision);
    assert.equal(await fs.readFile(path.join(output, "content/example.js"), "utf8"), "const example = 2;\n");
    await write("content/example.js", "const example = 3;\n");
    await watcher.rebuild();
    const token = watcher.settings.token;
    await assert.rejects(startWatcher({ root, port: settings.port, log() {} }), { code: "EADDRINUSE" });
    await watcher.close();
    watcher = await startWatcher({ root, intervalMs: 100000, log() {} });
    assert.equal(watcher.settings.port, settings.port);
    assert.equal(watcher.settings.token, token);
    assert.equal(await fs.readFile(path.join(root, "manifest.json"), "utf8"), originalManifest);

    await watcher.close();
    let failPublication = false;
    watcher = await startWatcher({ root, intervalMs: 100000, log() {},
      writeBuild(destination, files) {
        return writeDevelopmentBuild(destination, files, failPublication ? {
          async renameDirectory(source, target) {
            if (target === destination) throw new Error("Simulated publication failure");
            await fs.rename(source, target);
          },
          async restoreDirectory() { throw new Error("Simulated rollback failure"); },
          async cleanupDirectory() { throw new Error("Simulated cleanup failure"); }
        } : {});
      }
    });
    failPublication = true;
    await write("content/example.js", "const example = 4;\n");
    await assert.rejects(watcher.rebuild(), (error) => {
      assert.equal(error.code, "DEVELOPMENT_ROLLBACK_FAILED");
      assert.match(error.cleanupError.message, /Simulated cleanup failure/);
      return true;
    });
    assert.equal(watcher.getRevision(), undefined);
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
    assert.equal((await fetch(url, { headers: auth })).status, 503);
    failPublication = false;
    await watcher.rebuild();
    assert.equal((await fetch(url, { headers: auth })).status, 200);
    assert.equal(await fs.readFile(path.join(output, "content/example.js"), "utf8"), "const example = 4;\n");

    const listeners = {};
    let reloads = 0;
    let alarms = 0;
    let responseRevision = validRevision;
    const chrome = {
      alarms: {
        create(name, options) { assert.equal(options.periodInMinutes, 0.5); alarms++; return Promise.resolve(); },
        onAlarm: { addListener(callback) { listeners.alarm = callback; } }
      },
      runtime: {
        reload() { reloads++; },
        onInstalled: { addListener(callback) { listeners.installed = callback; } },
        onStartup: { addListener(callback) { listeners.startup = callback; } }
      }
    };
    const clientConfig = { statusUrl: url, token, revision: validRevision };
    const client = installDevReload(chrome, clientConfig, async (endpoint, options) => {
      assert.equal(endpoint, url);
      assert.equal(options.headers["X-Development-Token"], token);
      assert.equal(options.redirect, "error");
      return { ok: true, async json() { return { protocol: 1, revision: responseRevision }; } };
    });
    await new Promise(setImmediate);
    await client.check();
    assert.equal(reloads, 0);
    assert.equal(alarms, 1);
    responseRevision = "b".repeat(64);
    listeners.alarm({ name: "unrelated" });
    await new Promise(setImmediate);
    assert.equal(reloads, 0);
    listeners.alarm({ name: "conversation-exporter-development-reload" });
    await new Promise(setImmediate);
    assert.equal(reloads, 1);
    await client.check();
    assert.equal(reloads, 1);
    const offline = installDevReload(chrome, clientConfig, async () => { throw new Error("offline"); });
    await new Promise(setImmediate);
    await offline.check();
    assert.equal(reloads, 1);
    const malformed = installDevReload(chrome, clientConfig, async () => ({ ok: true, async json() { return { revision: "bad" }; } }));
    await new Promise(setImmediate);
    await malformed.check();
    assert.equal(reloads, 1);
    console.log("Development watcher and reload tests passed.");
  } finally {
    if (watcher) await watcher.close();
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith("conversation-exporter-development-test-")) {
      throw new Error("Unsafe test cleanup path.");
    }
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
