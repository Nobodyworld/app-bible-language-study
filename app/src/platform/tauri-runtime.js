const ROUTE_PATTERN = /^#\/(?:home|read\/[a-z0-9_-]+\/[a-z0-9_-]+\/[0-9]+(?:\/[0-9]+)?)$/;
const EXTERNAL_HOST_ALLOWLIST = Object.freeze(["github.com"]);

function isRestorableRoute(value) {
  return typeof value === "string" && value.length <= 256 && ROUTE_PATTERN.test(value);
}

function boundedFlush(storage, timeoutMs = 5000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Native user-data flush timed out.")), timeoutMs);
  });
  return Promise.race([storage.flush(), timeout]).finally(() => clearTimeout(timer));
}

export class TauriRuntimeService {
  constructor(options = {}) {
    this.bridge = options.bridge;
    this.storage = options.userStorage;
    this.windowObject = options.windowObject;
    this.started = false;
    this.closing = false;
    this.unlistenClose = null;
    this.externalHostAllowlist = EXTERNAL_HOST_ALLOWLIST;
  }

  restoreRoute(state) {
    const windowObject = this.windowObject;
    if (!windowObject || windowObject.location.hash) return null;
    const persisted = state?.workspaceStore?.last_reader_route;
    if (!isRestorableRoute(persisted)) return null;
    windowObject.history.replaceState(windowObject.history.state, "", persisted);
    return persisted;
  }

  persistRoute(state, routeHash) {
    if (!state?.workspaceStore || !isRestorableRoute(routeHash)) return false;
    if (state.workspaceStore.last_reader_route === routeHash) return true;
    state.workspaceStore.last_reader_route = routeHash;
    this.storage.save("workspace", state.workspaceStore);
    return true;
  }

  async openExternal(url) {
    return this.bridge.invoke("open_external_url", { url });
  }

  installLinkPolicy(documentObject) {
    documentObject.addEventListener("click", (event) => {
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor) return;
      const raw = String(anchor.getAttribute("href") || "").trim();
      if (raw.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      let parsed;
      try {
        parsed = new URL(raw, this.windowObject.location.href);
      } catch {
        documentObject.documentElement.dataset.externalOpenError = "invalid_url";
        return;
      }
      if (parsed.protocol !== "https:" || !EXTERNAL_HOST_ALLOWLIST.includes(parsed.hostname.toLowerCase())) {
        documentObject.documentElement.dataset.externalOpenError = "external_url_rejected";
        return;
      }
      void this.openExternal(parsed.href).then(
        () => { delete documentObject.documentElement.dataset.externalOpenError; },
        () => { documentObject.documentElement.dataset.externalOpenError = "external_open_failed"; },
      );
    }, true);
  }

  async start({ documentObject }) {
    if (this.started) return;
    this.started = true;
    documentObject.addEventListener("contextmenu", (event) => event.preventDefault());
    this.installLinkPolicy(documentObject);
    this.unlistenClose = await this.bridge.onCloseRequested(async (event) => {
      event.preventDefault();
      if (this.closing) return;
      this.closing = true;
      try {
        await boundedFlush(this.storage);
        await this.bridge.destroyCurrentWindow();
      } catch {
        const exitAnyway = this.windowObject.confirm(
          "Bible App Reader could not finish saving the latest study-data change. Exit anyway?",
        );
        if (exitAnyway) {
          await this.bridge.destroyCurrentWindow();
        } else {
          this.closing = false;
        }
      }
    });
  }
}

export function createTauriRuntimeService(options = {}) {
  return new TauriRuntimeService(options);
}
