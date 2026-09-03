function canonicalPackagedDataPath(input) {
  const raw = String(input || "");
  if (!raw || raw.includes("\\") || raw.includes("\0") || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/)/.test(raw)) {
    throw new TypeError("Desktop packaged data paths must be relative application assets.");
  }
  const withoutQuery = raw.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  const parts = withoutQuery.split("/");
  if (parts[0] !== "data" || parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("Desktop packaged data paths must stay within the bundled data directory.");
  }
  const query = raw.includes("?") ? `?${raw.split("?")[1].split("#")[0]}` : "";
  return `./${parts.join("/")}${query}`;
}

export class TauriDataAdapter {
  constructor(options = {}) {
    if (!options.bridge?.invoke) throw new TypeError("A validated Tauri command bridge is required.");
    this.bridge = options.bridge;
    this.baseUrl = new URL(options.baseUrl || "./");
  }

  async fetchResponse(input, options = {}) {
    const relative = canonicalPackagedDataPath(input);
    const url = new URL(relative, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(new URL("./data/", this.baseUrl).pathname)) {
      throw new TypeError("Desktop packaged data resolution rejected a non-bundled URL.");
    }
    const relativePath = url.pathname.replace(/^\/+/, "");
    const result = await this.bridge.invoke("read_packaged_data", { relativePath });
    if (result?.status !== "ok" || typeof result.text !== "string") throw new Error("Packaged data load failed with an invalid native response.");
    return Object.freeze({
      ok: true,
      status: 200,
      url: url.href,
      headers: new Headers({ "content-type": result.mediaType || "application/json; charset=utf-8" }),
      async json() { return JSON.parse(result.text); },
      async text() { return result.text; },
    });
  }

  async fetchJson(input, options = {}) {
    const response = await this.fetchResponse(input, options);
    if (!response?.ok) throw new Error(`Packaged data load failed with HTTP ${response?.status || 0}.`);
    return response.json();
  }
}

export function createTauriDataAdapter(options = {}) {
  return new TauriDataAdapter(options);
}
