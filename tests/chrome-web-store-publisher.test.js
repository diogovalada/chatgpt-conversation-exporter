const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function run() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, "../scripts/publish-chrome-web-store.mjs")
  ).href;
  const { publishChromeWebStore } = await import(moduleUrl);
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const packagePath = path.join(os.tmpdir(), `ai-conversation-exporter-${process.pid}.zip`);
  fs.writeFileSync(packagePath, Buffer.from("test package"));

  const originalFetch = global.fetch;
  const originalEnvironment = {
    CWS_EXTENSION_ID: process.env.CWS_EXTENSION_ID,
    CWS_PUBLISHER_ID: process.env.CWS_PUBLISHER_ID,
    CWS_SERVICE_ACCOUNT_JSON: process.env.CWS_SERVICE_ACCOUNT_JSON
  };
  process.env.CWS_EXTENSION_ID = "extension-id";
  process.env.CWS_PUBLISHER_ID = "publisher-id";
  process.env.CWS_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    client_email: "publisher@example.invalid",
    private_key: privateKey
  });

  try {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        const tokenRequest = new URLSearchParams(options.body);
        const assertion = tokenRequest.get("assertion");
        assert.equal(
          tokenRequest.get("grant_type"),
          "urn:ietf:params:oauth:grant-type:jwt-bearer"
        );
        assert.equal(assertion.split(".").length, 3);
        const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url"));
        assert.equal(claims.iss, "publisher@example.invalid");
        assert.equal(claims.scope, "https://www.googleapis.com/auth/chromewebstore");
        return Response.json({ access_token: "test-token" });
      }

      assert.equal(options.headers.authorization, "Bearer test-token");
      if (String(url).includes("/upload/v2/")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["content-type"], "application/zip");
        assert.equal(Buffer.from(options.body).toString(), "test package");
        return Response.json({ uploadState: "SUCCEEDED" });
      }

      assert.match(String(url), /:publish$/);
      assert.deepEqual(JSON.parse(options.body), {
        publishType: "DEFAULT_PUBLISH",
        blockOnWarnings: true
      });
      return Response.json({ state: "PENDING_REVIEW" });
    };

    await publishChromeWebStore(packagePath);
    assert.equal(requests.length, 3);

    let requestCount = 0;
    global.fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json({ access_token: "test-token" });
      return Response.json({ uploadState: "FAILED" });
    };
    await assert.rejects(
      publishChromeWebStore(packagePath),
      /package upload ended in state FAILED/i
    );
    assert.equal(requestCount, 2);
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.unlinkSync(packagePath);
  }
}

run()
  .then(() => console.log("Chrome Web Store publisher tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
