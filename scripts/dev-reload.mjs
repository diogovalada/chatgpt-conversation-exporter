export function installDevReload(chrome, config, fetchStatus = globalThis.fetch) {
  const alarmName = "conversation-exporter-development-reload";
  let checking = false;
  let reloading = false;

  async function check() {
    if (checking || reloading) return;
    checking = true;
    try {
      const response = await fetchStatus(config.statusUrl, {
        headers: { "X-Development-Token": config.token },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return;
      const status = await response.json();
      if (status.protocol !== 1 || !/^[a-f0-9]{64}$/.test(status.revision)) return;
      if (status.revision !== config.revision) {
        reloading = true;
        chrome.runtime.reload();
      }
    } catch {
      // A stopped local watcher is normal; the next alarm will try again.
    } finally {
      checking = false;
    }
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) void check();
  });
  chrome.runtime.onInstalled.addListener(() => void check());
  chrome.runtime.onStartup.addListener(() => void check());
  // Alarms wake suspended MV3 workers; timers alone would stop checking.
  void chrome.alarms.create(alarmName, { periodInMinutes: 0.5 }).catch(() => {});
  void check();
  return { check };
}
