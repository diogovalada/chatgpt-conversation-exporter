(() => {
  const STORAGE_KEY = "chatgpt_md_downloader_settings";
  const defaults = Object.freeze({ downloadImages: false, includeToolActivity: false });
  const fieldKeys = Object.fromEntries(Object.keys(defaults).map((field) => [field, `${STORAGE_KEY}.${field}`]));

  function normalize(value) {
    const settings = value && typeof value === "object" ? value : {};
    return {
      ...settings,
      downloadImages: Boolean(settings.downloadImages),
      includeToolActivity: Boolean(settings.includeToolActivity)
    };
  }

  async function load(storage) {
    const result = await storage.get({ [STORAGE_KEY]: defaults,
      ...Object.fromEntries(Object.values(fieldKeys).map((key) => [key, null])) });
    const settings = normalize(result[STORAGE_KEY]);
    for (const [field, key] of Object.entries(fieldKeys)) {
      if (typeof result[key] === "boolean") settings[field] = result[key];
    }
    return settings;
  }

  async function save(storage, changes) {
    // Separate keys avoid cross-dialog read/modify/write races; legacy choices remain readable.
    const values = {};
    for (const [field, key] of Object.entries(fieldKeys)) {
      if (Object.hasOwn(changes, field)) values[key] = Boolean(changes[field]);
    }
    await storage.set(values);
    return load(storage);
  }

  function watch(storage, onChanged, update, onError = () => {}) {
    const refresh = () => load(storage).then(update).catch(onError);
    const listener = (changes, area) => {
      if (area === "local" && [STORAGE_KEY, ...Object.values(fieldKeys)].some((key) => Object.hasOwn(changes, key))) {
        return refresh();
      }
    };
    onChanged.addListener(listener);
    refresh();
    return () => onChanged.removeListener(listener);
  }

  globalThis.ChatExporterSettings = { STORAGE_KEY, defaults, load, save, watch };
})();
