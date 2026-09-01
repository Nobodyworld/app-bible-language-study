import { createBrowserPlatform } from "./browser-platform.js";
import { inspectGlobalTauri, TauriBridgeError } from "./tauri-bridge.js";
import { createTauriPlatform } from "./tauri-platform.js";

export class ApplicationPlatformStartupError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApplicationPlatformStartupError";
    this.code = code;
  }
}

export async function resolveApplicationPlatform(options = {}) {
  const windowObject = options.windowObject || globalThis.window;
  let inspection;
  try {
    inspection = inspectGlobalTauri(windowObject);
  } catch (error) {
    if (error instanceof TauriBridgeError) {
      throw new ApplicationPlatformStartupError(error.code, error.message, error);
    }
    throw error;
  }
  if (!inspection.present) {
    return createBrowserPlatform({
      ...options,
      windowObject,
    });
  }
  try {
    return await createTauriPlatform({
      ...options,
      windowObject,
      bridge: inspection.bridge,
    });
  } catch (error) {
    throw new ApplicationPlatformStartupError(
      error?.code || "desktop_platform_startup_failed",
      error?.message || "The Windows desktop platform could not start.",
      error,
    );
  }
}

export function renderPlatformStartupFailure(documentObject, error) {
  if (!documentObject?.body) return;
  const main = documentObject.createElement("main");
  main.className = "platform-startup-error";
  main.setAttribute("role", "alert");
  const heading = documentObject.createElement("h1");
  heading.textContent = "Bible App Reader could not start";
  const message = documentObject.createElement("p");
  message.textContent = "The Windows desktop connection is unavailable or incomplete. Your study data was not changed.";
  const diagnostic = documentObject.createElement("p");
  diagnostic.className = "platform-startup-error-code";
  diagnostic.textContent = `Diagnostic: ${error?.code || "platform_startup_failed"}`;
  main.append(heading, message, diagnostic);
  documentObject.body.replaceChildren(main);
}
