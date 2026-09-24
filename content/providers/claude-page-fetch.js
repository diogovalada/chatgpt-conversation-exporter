(() => {
  if (window.__chatExporterClaudePageFetchInstalled) return;
  window.__chatExporterClaudePageFetchInstalled = true;

  const REQUEST_TYPE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST";
  const RESPONSE_TYPE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_RESPONSE";
  const ORGANIZATIONS_PATH = "/api/organizations";
  const CONVERSATION_PATH = /^\/api\/organizations\/[0-9a-f-]+\/chat_conversations\/[0-9a-f-]+$/i;
  const ALLOWED_QUERY_KEYS = new Set([
    "consistency",
    "render_all_tools",
    "rendering_mode",
    "tree"
  ]);

  function validateUrl(rawUrl) {
    const url = new URL(String(rawUrl || ""), location.href);
    const allowedPath = url.pathname === ORGANIZATIONS_PATH || CONVERSATION_PATH.test(url.pathname);
    if (url.origin !== location.origin || !allowedPath) {
      throw new Error("Claude conversation request URL was rejected.");
    }

    if (url.pathname === ORGANIZATIONS_PATH && url.search) {
      throw new Error("Claude organizations request query was rejected.");
    }

    for (const key of url.searchParams.keys()) {
      if (!ALLOWED_QUERY_KEYS.has(key)) {
        throw new Error("Claude conversation request query was rejected.");
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
      const result = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      const payload = await result.json().catch(() => null);

      window.postMessage({
        ...response,
        ok: result.ok,
        status: result.status,
        payload,
        error: result.ok ? "" : `Claude data request failed (${result.status}).`
      }, location.origin);
    } catch (error) {
      window.postMessage({
        ...response,
        ok: false,
        status: 0,
        payload: null,
        error: String(error?.message || error || "Claude data request failed.")
      }, location.origin);
    }
  });
})();
