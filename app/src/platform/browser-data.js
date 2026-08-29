export class BrowserDataError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "BrowserDataError";
    this.code = code;
    this.detail = detail;
  }
}

export class BrowserDataAdapter {
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl;
  }
  async fetchResponse(path, options = {}) {
    if (!this.fetchImpl) throw new BrowserDataError("unsupported", "Static asset fetching is unavailable.", { path });
    try {
      return await this.fetchImpl(path, options);
    } catch (error) {
      throw new BrowserDataError("load_failed", `Could not load ${path}.`, { path, cause: error?.message || String(error) });
    }
  }
  async fetchJson(path, options = {}) {
    const response = await this.fetchResponse(path, options);
    if (!response?.ok) throw new BrowserDataError("http_error", `Could not load ${path}.`, { path, status: response?.status || 0 });
    try {
      return await response.json();
    } catch (error) {
      throw new BrowserDataError("corrupt", `Could not parse ${path}.`, { path, cause: error?.message || String(error) });
    }
  }
}

export function createBrowserDataAdapter(options = {}) {
  const browserWindow = options.windowObject || globalThis.window || null;
  const fetchImpl = options.fetchImpl || browserWindow?.fetch?.bind(browserWindow) || null;
  return new BrowserDataAdapter(fetchImpl);
}
