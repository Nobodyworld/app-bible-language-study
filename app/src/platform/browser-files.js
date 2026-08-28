export class BrowserFileService {
  constructor(options = {}) {
    this.document = options.documentObject || null;
    this.window = options.windowObject || null;
    this.navigator = options.navigatorObject || null;
    this.BlobImpl = options.BlobImpl || null;
    this.URLImpl = options.URLImpl || null;
  }

  async saveTextFile({ text, suggestedName, mimeType = "text/plain" } = {}) {
    try {
      if (!this.document || !this.BlobImpl || !this.URLImpl?.createObjectURL) throw new Error("Browser download APIs are unavailable.");
      const blob = new this.BlobImpl([String(text ?? "")], { type: mimeType });
      const url = this.URLImpl.createObjectURL(blob);
      const link = this.document.createElement("a");
      link.href = url;
      link.download = suggestedName || "download.txt";
      link.click();
      this.URLImpl.revokeObjectURL(url);
      return { status: "saved", name: link.download };
    } catch (error) {
      return { status: "error", code: "save_failed", message: error?.message || "Could not save the file." };
    }
  }

  async readTextFile(file) {
    if (!file) return { status: "cancelled" };
    try {
      return { status: "opened", name: file.name || "backup.json", text: await file.text() };
    } catch (error) {
      return { status: "error", code: "read_failed", message: error?.message || "Could not read the selected file." };
    }
  }

  async openTextFile({ accept = "text/plain", input = null } = {}) {
    if (input?.files) return this.readTextFile(input.files[0] || null);
    if (!this.document) return { status: "error", code: "open_unsupported", message: "Browser file selection is unavailable." };
    const picker = this.document.createElement("input");
    picker.type = "file";
    picker.accept = accept;
    picker.hidden = true;
    this.document.body?.append(picker);
    return new Promise((resolve) => {
      let settled = false;
      const finish = async (result) => {
        if (settled) return;
        settled = true;
        picker.remove();
        resolve(result);
      };
      picker.addEventListener("change", async () => finish(await this.readTextFile(picker.files?.[0] || null)), { once: true });
      picker.addEventListener("cancel", () => finish({ status: "cancelled" }), { once: true });
      picker.click();
    });
  }

  async copyText(text) {
    try {
      if (!this.navigator?.clipboard?.writeText) return { status: "fallback_required" };
      await this.navigator.clipboard.writeText(String(text ?? ""));
      return { status: "copied" };
    } catch (error) {
      return { status: "fallback_required", code: "clipboard_failed", message: error?.message || "Clipboard access failed." };
    }
  }
}

export function createBrowserFileService(options = {}) {
  const browserWindow = options.windowObject || globalThis.window || null;
  return new BrowserFileService({
    ...options,
    documentObject: options.documentObject || browserWindow?.document || null,
    windowObject: browserWindow,
    navigatorObject: options.navigatorObject || browserWindow?.navigator || null,
    BlobImpl: options.BlobImpl || browserWindow?.Blob || globalThis.Blob || null,
    URLImpl: options.URLImpl || browserWindow?.URL || globalThis.URL || null,
  });
}
