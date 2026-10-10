(() => {
  const ns = window.ChatExporter;
  const REQUEST = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_REQUEST";
  const RESPONSE = "CHAT_EXPORTER_CLAUDE_PAGE_FETCH_RESPONSE";

  function fetchJson(url, { organizationId } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Claude data request timed out."));
      }, 30_000);
      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      }
      function onMessage(event) {
        const response = event.data;
        if (event.source !== window || event.origin !== location.origin ||
            response?.type !== RESPONSE || response.requestId !== requestId) return;
        cleanup();
        if (response.ok) resolve(response.payload);
        else {
          const error = new Error(response.error || `Claude data request failed (${response.status || 0}).`);
          error.status = response.status || 0;
          reject(error);
        }
      }
      window.addEventListener("message", onMessage);
      try {
        window.postMessage({ type: REQUEST, requestId, url: String(url), organizationId }, location.origin);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async function getOrganizationIds() {
    const payload = await fetchJson(new URL("/api/organizations", location.origin).href);
    const organizations = Array.isArray(payload) ? payload : payload?.organizations || payload?.data;
    const ids = (Array.isArray(organizations) ? organizations : [])
      .map((org) => String(org?.uuid || org?.id || "").trim())
      .filter((id) => /^[0-9a-f-]+$/i.test(id));
    if (!ids.length) throw new Error("Claude did not return an organization for the current session.");
    return [...new Set(ids)];
  }

  ns.claudeApi = { fetchJson, getOrganizationIds };
})();
