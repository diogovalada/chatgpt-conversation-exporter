(() => {
  if (window.__chatExporterPageFetchInstalled) return;
  window.__chatExporterPageFetchInstalled = true;

  const REQUEST_TYPE = "CHAT_EXPORTER_PAGE_FETCH_REQUEST";
  const RESPONSE_TYPE = "CHAT_EXPORTER_PAGE_FETCH_RESPONSE";
  const ALLOWED_PATH = /^\/backend-api\/conversations?\/[A-Za-z0-9-]+(?:\/messages)?$/;
  const ALLOWED_QUERY_KEYS = new Set([
    "before",
    "include_full_conversation",
    "include_has_versions",
    "num_turns"
  ]);
  let accessTokenPromise = null;

  async function getAccessToken({ refresh = false } = {}) {
    if (refresh) accessTokenPromise = null;
    if (!accessTokenPromise) {
      accessTokenPromise = fetch(new URL("/api/auth/session", location.origin).href, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" }
      }).then(async (result) => {
        if (!result.ok) {
          throw new Error(`ChatGPT session request failed (${result.status}).`);
        }

        const session = await result.json();
        const token = String(session?.accessToken || session?.access_token || "").trim();
        if (!token) throw new Error("ChatGPT session did not include an access token.");
        return token;
      }).catch((error) => {
        accessTokenPromise = null;
        throw error;
      });
    }

    return accessTokenPromise;
  }

  async function fetchConversation(url) {
    let accessToken = await getAccessToken();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`
        }
      });

      if (attempt === 0 && result.status === 401) {
        accessToken = await getAccessToken({ refresh: true });
        continue;
      }

      return result;
    }

    throw new Error("ChatGPT conversation request failed.");
  }

  function validateUrl(rawUrl) {
    const url = new URL(String(rawUrl || ""), location.href);
    if (url.origin !== location.origin || !ALLOWED_PATH.test(url.pathname)) {
      throw new Error("ChatGPT conversation request URL was rejected.");
    }
    for (const key of url.searchParams.keys()) {
      if (!ALLOWED_QUERY_KEYS.has(key)) {
        throw new Error("ChatGPT conversation request query was rejected.");
      }
    }
    return url;
  }

  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || request?.type !== REQUEST_TYPE || !request.requestId) return;

    const response = {
      type: RESPONSE_TYPE,
      requestId: String(request.requestId)
    };

    try {
      const url = validateUrl(request.url);
      const result = await fetchConversation(url);
      const payload = await result.json().catch(() => null);
      window.postMessage({
        ...response,
        ok: result.ok,
        status: result.status,
        payload,
        error: result.ok ? "" : `ChatGPT conversation data request failed (${result.status}).`
      }, location.origin);
    } catch (error) {
      window.postMessage({
        ...response,
        ok: false,
        status: 0,
        payload: null,
        error: String(error?.message || error || "ChatGPT conversation request failed.")
      }, location.origin);
    }
  });
})();
