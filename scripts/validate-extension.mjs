import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const manifestPath = resolve(root, "manifest.json");
const errors = [];

function addError(message) {
  errors.push(message);
}

function assertFile(relativePath, source) {
  if (!relativePath || typeof relativePath !== "string") {
    addError(`${source} does not reference a file.`);
    return;
  }

  try {
    if (!statSync(resolve(root, relativePath)).isFile()) {
      addError(`${source} must reference a file: ${relativePath}`);
    }
  } catch {
    addError(`${source} references a missing file: ${relativePath}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`Unable to read ${manifestPath}: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  addError("manifest_version must be 3.");
}

if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(String(manifest.version || ""))) {
  addError("version must contain one to four dot-separated integer components.");
}

if (!manifest.name || String(manifest.name).length > 75) {
  addError("name must contain between 1 and 75 characters.");
}

if (!manifest.description || String(manifest.description).length > 132) {
  addError("description must contain between 1 and 132 characters.");
}

const referencedFiles = new Map();
const reference = (file, source) => {
  if (!file) return;
  if (!referencedFiles.has(file)) referencedFiles.set(file, source);
};

reference(manifest.background?.service_worker, "background.service_worker");
reference(manifest.action?.default_popup, "action.default_popup");
reference(manifest.options_page, "options_page");
reference(manifest.devtools_page, "devtools_page");

for (const [size, file] of Object.entries(manifest.icons || {})) {
  reference(file, `icons.${size}`);
}

for (const [size, file] of Object.entries(manifest.action?.default_icon || {})) {
  reference(file, `action.default_icon.${size}`);
}

for (const [index, script] of (manifest.content_scripts || []).entries()) {
  for (const [fileIndex, file] of (script.js || []).entries()) {
    reference(file, `content_scripts.${index}.js.${fileIndex}`);
  }
  for (const [fileIndex, file] of (script.css || []).entries()) {
    reference(file, `content_scripts.${index}.css.${fileIndex}`);
  }
}

for (const [index, page] of (manifest.sandbox?.pages || []).entries()) {
  reference(page, `sandbox.pages.${index}`);
}

for (const [file, source] of referencedFiles) {
  assertFile(file, source);
}

if (errors.length > 0) {
  console.error("Extension validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Validated ${manifest.name} v${manifest.version}: ${referencedFiles.size} referenced files are present.`
);
