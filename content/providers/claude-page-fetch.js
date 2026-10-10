(() => {
  if (window.__chatExporterClaudePageFetchInstalled) return;
  window.__chatExporterClaudePageFetchInstalled = true;

  const REQUEST_TYPE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST";
  const RESPONSE_TYPE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_RESPONSE";
  const ORGANIZATIONS_PATH = "/api/organizations";
  const CONVERSATION_PATH = /^\/api\/organizations\/[0-9a-f-]+\/chat_conversations\/[0-9a-f-]+$/i;
  const CODE_PATH = /^\/v1\/code\/sessions\/session_[A-Za-z0-9]+(\/events)?$/;
  const ALLOWED_QUERY_KEYS = new Set([
    "consistency",
    "render_all_tools",
    "rendering_mode",
    "tree"
  ]);

  function validateUrl(rawUrl) {
    const url = new URL(String(rawUrl || ""), location.href);
    const codePath = CODE_PATH.test(url.pathname);
    const allowedPath = url.pathname === ORGANIZATIONS_PATH || CONVERSATION_PATH.test(url.pathname) || codePath;
    if (url.origin !== location.origin || !allowedPath || url.username || url.password || url.hash) {
      throw new Error("Claude conversation request URL was rejected.");
    }

    if (url.pathname === ORGANIZATIONS_PATH && url.search) {
      throw new Error("Claude organizations request query was rejected.");
    }

    for (const key of url.searchParams.keys()) {
      const codeQuery = url.pathname.endsWith("/events") && ["limit", "sort_order", "cursor"].includes(key);
      if (codePath ? !codeQuery : !ALLOWED_QUERY_KEYS.has(key)) {
        throw new Error("Claude conversation request query was rejected.");
      }
    }
    if (codePath && url.searchParams.has("limit") && !/^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$/.test(url.searchParams.get("limit"))) {
      throw new Error("Claude Code page size was rejected.");
    }
    if (codePath && url.searchParams.has("sort_order") && !["asc", "desc"].includes(url.searchParams.get("sort_order"))) {
      throw new Error("Claude Code sort order was rejected.");
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
      const headers = { accept: "application/json" };
      if (CODE_PATH.test(url.pathname)) {
        if (!/^[0-9a-f-]+$/i.test(String(request.organizationId || ""))) {
          throw new Error("Claude Code organization was rejected.");
        }
        Object.assign(headers, {
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "ccr-byoc-2025-07-29",
          "anthropic-client-feature": "ccr",
          "x-organization-uuid": request.organizationId
        });
      }
      const result = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        headers
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
