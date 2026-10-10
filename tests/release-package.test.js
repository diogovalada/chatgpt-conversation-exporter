const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const workflow = read(".github/workflows/build.yml");
const archive = workflow.match(/git archive \\\r?\n([\s\S]+?)\r?\n\s*\r?\n/);
assert.ok(archive, "release workflow must define its package inputs");
const inputs = archive[1].split(/\r?\n/)
  .map((line) => line.trim().replace(/\s*\\$/, ""))
  .filter((line) => /^[\w./-]+$/.test(line));
const packaged = (file) => inputs.some((input) => file === input || file.startsWith(`${input}/`));
const references = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
for (const script of manifest.content_scripts) references.push(...script.js, ...(script.css || []));
const popup = read(manifest.action.default_popup);
references.push(...Array.from(popup.matchAll(/(?:src|href)="([^"#]+)"/g), (match) => match[1]));
for (const reference of new Set(references)) {
  assert.ok(packaged(reference), `release ZIP is missing ${reference}`);
}
for (const input of inputs) assert.ok(fs.existsSync(path.join(root, input)), `missing package input: ${input}`);
for (const reference of references.filter((file) => /\.m?js$/.test(file))) {
  const script = read(reference);
  for (const match of script.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
    const imported = path.posix.normalize(path.posix.join(path.posix.dirname(reference), match[1]));
    assert.ok(packaged(imported), `release ZIP is missing imported module ${imported}`);
  }
}
assert.match(workflow, /find background\.js popup\.js export-settings\.js content scripts tests/);
console.log("release package coverage tests passed");
