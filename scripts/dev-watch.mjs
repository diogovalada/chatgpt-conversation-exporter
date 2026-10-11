import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const runtimeEntries = [
  "manifest.json", "background.js", "popup.html", "popup.css", "popup.js",
  "export-settings.js", "content", "icons", "vendor"
];
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reloadSource = "scripts/dev-reload.mjs";

export async function collectSources(root) {
  const files = new Map();
  async function collect(path) {
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Development source must not be a symlink: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await collect(`${path}/${name}`);
    } else if (stat.isFile()) {
      files.set(path, await readFile(absolute));
    } else {
      throw new Error(`Development source must be a regular file: ${path}`);
    }
  }
  for (const entry of [...runtimeEntries, reloadSource]) await collect(entry);
  return files;
}

export function sourceRevision(files) {
  const hash = createHash("sha256");
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`${path}\0${createHash("sha256").update(bytes).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

export function developmentFiles(sources, settings, revision) {
  const files = new Map(sources);
  const manifest = JSON.parse(sources.get("manifest.json").toString("utf8"));
  const references = [
    manifest.background?.service_worker, manifest.action?.default_popup,
    manifest.options_page, manifest.options_ui?.page, manifest.devtools_page,
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.sandbox?.pages || []),
    ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []).filter((file) => !file.includes("*"))
  ];
  for (const file of references.filter(Boolean)) {
    if (typeof file !== "string" || !sources.has(file)) throw new Error(`Manifest references a missing source file: ${file}`);
  }
  if (!manifest.background?.service_worker || manifest.background.type !== "module") {
    throw new Error("Development reload requires the production module service worker.");
  }
  manifest.name = `${manifest.name.slice(0, 57)} DEVELOPMENT BUILD`;
  if (Number.parseInt(manifest.minimum_chrome_version || "0", 10) < 120) {
    manifest.minimum_chrome_version = "120";
  }
  manifest.permissions = [...new Set([...(manifest.permissions || []), "alarms"])];
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), "http://127.0.0.1/*"])];
  manifest.background = { service_worker: "dev-service-worker.js", type: "module" };
  files.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  files.set("dev-reload.mjs", sources.get(reloadSource));
  files.delete(reloadSource);
  const config = { statusUrl: `http://127.0.0.1:${settings.port}/status`, token: settings.token, revision };
  files.set("dev-service-worker.js", Buffer.from(
    `import ${JSON.stringify(`./${references[0]}`)};\nimport { installDevReload } from "./dev-reload.mjs";\n` +
    `installDevReload(chrome, ${JSON.stringify(config)});\n`
  ));
  return files;
}

function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Development directories must not be symlinks.");
}

export async function writeDevelopmentBuild(output, files, {
  renameDirectory = rename, restoreDirectory = rename, cleanupDirectory
} = {}) {
  output = resolve(output);
  const parent = dirname(output);
  await ensureDirectory(parent);
  const stage = await mkdtemp(join(parent, ".development-stage-"));
  const backup = join(parent, `.development-previous-${randomBytes(12).toString("hex")}`);
  let movedPrevious = false;
  let published = false;
  let primaryError;
  async function cleanup(directory) {
    if (!inside(parent, directory) || !/^\.development-(?:stage|previous)-/.test(relative(parent, directory))) {
      throw new Error("Development cleanup escaped its staging directory.");
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (!inside(directory, absolute)) throw new Error("Development cleanup escaped its directory.");
      if (entry.isDirectory()) {
        await removeContents(absolute);
        await rmdir(absolute);
      } else await unlink(absolute);
    }
    await rmdir(directory);
  }
  async function removeContents(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (!inside(parent, absolute)) throw new Error("Development cleanup escaped its directory.");
      if (entry.isDirectory()) {
        await removeContents(absolute);
        await rmdir(absolute);
      } else await unlink(absolute);
    }
  }
  try {
    for (const [path, bytes] of files) {
      const destination = join(stage, path);
      if (!inside(stage, destination)) throw new Error("Development output escaped its directory.");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx" });
    }
    try {
      const existing = await lstat(output);
      if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("Development output must be a non-symlink directory.");
      await renameDirectory(output, backup);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Publish only complete snapshots; roll back if the second rename fails.
    await renameDirectory(stage, output);
    published = true;
  } catch (error) {
    primaryError = error;
    if (movedPrevious) {
      try { await restoreDirectory(backup, output); movedPrevious = false; }
      catch (restoreError) {
        const failure = new Error(`Development build rollback failed. Previous build retained at ${backup}: ${restoreError.message}`, { cause: error });
        failure.code = "DEVELOPMENT_ROLLBACK_FAILED";
        primaryError = failure;
        throw failure;
      }
    }
    throw error;
  } finally {
    if (!published) {
      try { await (cleanupDirectory || cleanup)(stage); }
      catch (error) {
        if (!primaryError) throw error;
        primaryError.cleanupError = error;
      }
    }
    // A locked obsolete backup must not turn a successful publication into a failure.
    if (published && movedPrevious) await cleanup(backup).catch(() => {});
  }
}

export function validateWorkerDependencies(files) {
  const worker = JSON.parse(files.get("manifest.json")).background?.service_worker;
  const linker = `import { SourceTextModule } from "node:vm";
import { readFileSync } from "node:fs";
const { worker, sources } = JSON.parse(readFileSync(0, "utf8"));
const modules = new Map();
function load(path) {
  if (!Object.hasOwn(sources, path)) throw new Error("Worker imports a missing source file: " + path);
  if (!modules.has(path)) modules.set(path, new SourceTextModule(sources[path], { identifier: path }));
  return modules.get(path);
}
try {
  await load(worker).link((specifier, referencingModule) => {
    if (!/^(?:\\.\\.?\\/|\\/)/.test(specifier)) throw new Error("Worker import must be local: " + specifier);
    const url = new URL(specifier, new URL(referencingModule.identifier, "https://development.invalid/"));
    if (url.origin !== "https://development.invalid") throw new Error("Worker import must be local: " + specifier);
    return load(decodeURIComponent(url.pathname.slice(1)));
  });
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
}`;
  // Link the generated graph without evaluating it, including reload code and named exports.
  const linked = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e", linker], {
    input: JSON.stringify({ worker, sources: Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString("utf8")])) }),
    encoding: "utf8"
  });
  if (linked.error || linked.status !== 0) throw new Error(`Invalid worker module graph: ${linked.error?.message || linked.stderr}`);
}

export function statusHandler(settings, getRevision) {
  const tokenHash = createHash("sha256").update(settings.token).digest();
  return (request, response) => {
    const origin = request.headers.origin;
    const token = String(request.headers["x-development-token"] || "");
    const authorized = timingSafeEqual(tokenHash, createHash("sha256").update(token).digest());
    const allowedOrigin = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" || request.url !== "/status" ||
        request.headers.host !== `127.0.0.1:${settings.port}` || !allowedOrigin || !authorized) {
      response.writeHead(403);
      response.end();
      return;
    }
    const revision = getRevision();
    if (!revision) {
      response.writeHead(503);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ protocol: 1, revision }));
  };
}

export async function startWatcher({ root = defaultRoot, port, intervalMs = 1000, log = console.log, writeBuild = writeDevelopmentBuild } = {}) {
  const dist = join(root, "dist");
  const output = join(dist, "development");
  const settingsPath = join(dist, "development-settings.json");
  let previous;
  try {
    if ((await lstat(settingsPath)).isSymbolicLink()) throw new Error("Development settings must not be a symlink.");
    previous = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot read development-settings.json; restore or remove it before starting.");
  }
  const settings = {
    port: port ?? previous?.port ?? 8766,
    token: previous?.token ?? randomBytes(32).toString("hex")
  };
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(settings.token)) throw new Error("Invalid development port or token.");
  let revision;
  let building = false;
  let publishing = false;
  let closed = false;
  let timer;
  const checkedScripts = new Map();
  const server = createServer(statusHandler(settings, () => publishing ? undefined : revision));
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(settings.port, "127.0.0.1", done);
  });
  async function rebuild() {
    if (building || closed) return;
    building = true;
    try {
      const sources = await collectSources(root);
      if (closed) return;
      const nextRevision = sourceRevision(sources);
      if (nextRevision === revision) return;
      const files = developmentFiles(sources, settings, nextRevision);
      validateWorkerDependencies(files);
      for (const [path, bytes] of sources) {
        if (!/\.(?:js|mjs)$/.test(path)) continue;
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (checkedScripts.get(path) === hash) continue;
        const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: bytes, encoding: "utf8" });
        if (check.error || check.status !== 0) throw new Error(`Invalid JavaScript in ${path}: ${check.error?.message || check.stderr}`);
        checkedScripts.set(path, hash);
      }
      publishing = true;
      try {
        await writeBuild(output, files);
      } catch (error) {
        if (error.code === "DEVELOPMENT_ROLLBACK_FAILED") revision = undefined;
        throw error;
      }
      revision = nextRevision;
      log(`Development build ready (${revision.slice(0, 12)}). Chrome checks about every 30 seconds; refresh chat pages manually.`);
    } finally {
      publishing = false;
      building = false;
    }
  }
  async function close() {
    closed = true;
    clearInterval(timer);
    while (building) await delay(20);
    await new Promise((done) => server.close(done));
  }
  try {
    await rebuild();
    await ensureDirectory(dist);
    const settingsTemp = `${settingsPath}.development-tmp`;
    try { await unlink(settingsTemp); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await writeFile(settingsTemp, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(settingsTemp, settingsPath);
    log(`Load unpacked once: ${output}`);
    log(`Watcher bound to 127.0.0.1:${settings.port}. Ctrl+C stops it without removing the development build.`);
    timer = setInterval(() => void rebuild().catch((error) => {
      log(`Development rebuild failed: ${error.message}`);
      if (error.cleanupError) log(`Development staging cleanup also failed: ${error.cleanupError.message}`);
    }), intervalMs);
    return { output, settings, rebuild, close, getRevision: () => revision };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--port")) {
      throw new Error("Usage: node scripts/dev-watch.mjs [--port 8766]");
    }
    const watcher = await startWatcher({ port: args.length ? Number(args[1]) : undefined });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => void watcher.close().then(() => process.exit(0)));
    }
  } catch (error) {
    console.error(`Development watcher: ${error.message}`);
    process.exitCode = 1;
  }
}
