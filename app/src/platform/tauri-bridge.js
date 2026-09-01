export class TauriBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TauriBridgeError";
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new TauriBridgeError(code, message);
}

export function inspectGlobalTauri(windowObject = globalThis.window) {
  const present = Boolean(windowObject && Object.prototype.hasOwnProperty.call(windowObject, "__TAURI__"));
  if (!present) return Object.freeze({ present: false, bridge: null });

  const candidate = windowObject.__TAURI__;
  if (!candidate || typeof candidate !== "object") {
    throw bridgeError("malformed_tauri_bridge", "The desktop bridge is present but is not an object.");
  }
  if (typeof candidate.core?.invoke !== "function") {
    throw bridgeError("malformed_tauri_bridge", "The desktop bridge does not provide the required command interface.");
  }
  if (typeof candidate.window?.getCurrentWindow !== "function") {
    throw bridgeError("malformed_tauri_bridge", "The desktop bridge does not provide the required window interface.");
  }
  const currentWindow = candidate.window.getCurrentWindow();
  if (!currentWindow || typeof currentWindow.onCloseRequested !== "function" || typeof currentWindow.destroy !== "function") {
    throw bridgeError("malformed_tauri_bridge", "The desktop bridge window interface is incomplete.");
  }

  const bridge = Object.freeze({
    invoke(command, args = {}) {
      return candidate.core.invoke(command, args);
    },
    onCloseRequested(listener) {
      return currentWindow.onCloseRequested(listener);
    },
    destroyCurrentWindow() {
      return currentWindow.destroy();
    },
  });
  return Object.freeze({ present: true, bridge });
}
