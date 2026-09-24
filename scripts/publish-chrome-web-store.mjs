import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://chromewebstore.googleapis.com/v2";
const UPLOAD_ROOT = "https://chromewebstore.googleapis.com/upload/v2";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 120;

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createServiceAccountAssertion(credentials) {
  if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
    throw new Error("CWS_SERVICE_ACCOUNT_JSON is not a valid service-account key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const claims = encodeJson({
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  });
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const privateKey = String(credentials.private_key).replace(/\\n/g, "\n");
  const signature = signer.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function parseResponse(response, operation) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawResponse: text };
    }
  }

  if (!response.ok) {
    const detail = body?.error?.message || body?.rawResponse || JSON.stringify(body);
    throw new Error(`${operation} failed (${response.status}): ${detail}`);
  }
  return body;
}

async function getAccessToken(credentials) {
  const assertion = createServiceAccountAssertion(credentials);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const result = await parseResponse(response, "Service-account authentication");
  if (!result.access_token) throw new Error("Authentication response did not include an access token.");
  return result.access_token;
}

async function apiRequest(url, accessToken, options = {}) {
  const { operation = "Chrome Web Store request", ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...fetchOptions.headers
    }
  });
  return parseResponse(response, operation);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForUpload({ itemName, accessToken, initialState }) {
  let state = initialState;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (state === "SUCCEEDED") return;
    if (state === "FAILED" || state === "NOT_FOUND") {
      throw new Error(`Chrome Web Store package upload ended in state ${state}.`);
    }
    if (state !== "UPLOAD_IN_PROGRESS") {
      throw new Error(`Unexpected Chrome Web Store upload state: ${state || "missing"}.`);
    }

    await delay(POLL_INTERVAL_MS);
    const status = await apiRequest(`${API_ROOT}/${itemName}:fetchStatus`, accessToken, {
      operation: "Upload status check"
    });
    state = status.lastAsyncUploadState || "UPLOAD_IN_PROGRESS";
    console.log(`Upload state: ${state || "pending"}`);
  }
  throw new Error("Timed out while waiting for Chrome Web Store package processing.");
}

async function publishChromeWebStore(packageArgument = process.argv[2]) {
  if (!packageArgument) throw new Error("Usage: node publish-chrome-web-store.mjs <extension.zip>");
  const packagePath = resolve(packageArgument);
  const publisherId = requireEnvironment("CWS_PUBLISHER_ID");
  const extensionId = requireEnvironment("CWS_EXTENSION_ID");
  const credentials = JSON.parse(requireEnvironment("CWS_SERVICE_ACCOUNT_JSON"));
  const packageBytes = await readFile(packagePath);
  const accessToken = await getAccessToken(credentials);
  const itemName = `publishers/${publisherId}/items/${extensionId}`;

  console.log(`Uploading ${packagePath} to Chrome Web Store item ${extensionId}.`);
  const upload = await apiRequest(`${UPLOAD_ROOT}/${itemName}:upload`, accessToken, {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: packageBytes,
    operation: "Package upload"
  });
  console.log(`Upload state: ${upload.uploadState || "missing"}`);
  await waitForUpload({ itemName, accessToken, initialState: upload.uploadState });

  const publish = await apiRequest(`${API_ROOT}/${itemName}:publish`, accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publishType: "DEFAULT_PUBLISH",
      blockOnWarnings: true
    }),
    operation: "Publish submission"
  });
  console.log(`Chrome Web Store submission state: ${publish.state || "submitted"}`);
}

export { createServiceAccountAssertion, publishChromeWebStore, waitForUpload };

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  publishChromeWebStore().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
