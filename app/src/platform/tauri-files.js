import { createBrowserFileService } from "./browser-files.js";

function safeSuggestedName(value) {
  const base = String(value || "bibleapp-user-data.json").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  const bounded = (base || "bibleapp-user-data.json").slice(0, 120);
  return bounded.toLowerCase().endsWith(".json") ? bounded : `${bounded}.json`;
}

export class TauriFileService {
  constructor(options = {}) {
    if (!options.bridge?.invoke) throw new TypeError("A validated Tauri command bridge is required.");
    this.bridge = options.bridge;
    this.nativeDialogs = true;
    this.clipboard = createBrowserFileService({ windowObject: options.windowObject });
  }

  async saveTextFile({ text, suggestedName } = {}) {
    try {
      return await this.bridge.invoke("save_backup", {
        text: String(text ?? ""),
        suggestedName: safeSuggestedName(suggestedName),
      });
    } catch (error) {
      return { status: "error", code: error?.code || "save_failed", message: error?.message || "Could not save the backup." };
    }
  }

  async openTextFile() {
    try {
      return await this.bridge.invoke("open_backup");
    } catch (error) {
      return { status: "error", code: error?.code || "open_failed", message: error?.message || "Could not open the backup." };
    }
  }

  async readTextFile() {
    return { status: "error", code: "path_read_prohibited", message: "Desktop files must be selected through the native Open dialog." };
  }

  copyText(text) {
    return this.clipboard.copyText(text);
  }
}

export function createTauriFileService(options = {}) {
  return new TauriFileService(options);
}
