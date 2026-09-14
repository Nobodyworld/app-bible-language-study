import {
  createUserDataExport,
  getUserDataSummary,
  importUserData,
  setPackageStore,
} from "../stores.js?v=pr13-live-qa-20260711e";
import { setDetail } from "../dom.js?v=pr13-live-qa-20260711e";
import { resolveCapabilities } from "../capabilities.js";
import { DETAIL_VIEW_IDS } from "../ui-contracts.js";
import { setCapabilityDisabled } from "../package-state.js";
import { compactUserDataBackup } from "../portable-backup.js";
import { renderPhysicalPackManager } from "./physical-pack-view.js";
import { renderPackRecovery } from "./pack-recovery-view.js";

function renderSummaryGrid(rows) {
  const grid = document.createElement("div");
  grid.className = "user-data-summary";
  rows.forEach(([label, value, action]) => {
    const item = document.createElement(action ? "button" : "div");
    item.className = `user-data-summary-item${action ? " summary-link" : ""}`;
    if (action) {
      item.type = "button";
      item.setAttribute("aria-label", `${label}: ${value}. Open Study Marks.`);
      item.addEventListener("click", action);
    }
    const number = document.createElement("strong");
    number.textContent = String(value);
    const text = document.createElement("span");
    text.textContent = label;
    item.append(number, text);
    grid.append(item);
  });
  return grid;
}

function renderStudyDataSummary(summary, showStudyMarks, platformKind = "browser") {
  const section = document.createElement("section");
  section.className = "my-data-section study-data-section";
  const title = document.createElement("h4");
  title.textContent = "Saved study";
  const intro = document.createElement("p");
  intro.className = "study-data-intro";
  intro.textContent = platformKind === "tauri-windows"
    ? "Your study data is saved on this device. Keep a backup to protect it."
    : "Your study data is saved in this browser. Keep a backup before clearing browser data.";
  const rows = [
    ["Study Marks", summary.tag_assertions, showStudyMarks],
    ["Word interpretations", summary.token_renderings],
    ["Custom labels", summary.custom_tags],
  ].filter(([, count]) => count > 0);
  section.append(title, intro);
  if (rows.length) section.append(renderSummaryGrid(rows));
  else {
    const empty = document.createElement("p");
    empty.textContent = "No saved study items yet.";
    section.append(empty);
  }
  return section;
}

function renderTechnicalSummary(summary, isLab = false) {
  const section = document.createElement("section");
  section.className = "diagnostic-section";
  const title = document.createElement("h4");
  title.textContent = isLab ? "Storage and data records" : "Saved-data recovery";
  const health = document.createElement("p");
  health.className = "storage-health-status";
  health.textContent = isLab
    ? `Storage authority: ${summary.user_store_authority || summary.user_store_backend}; migration: ${summary.user_store_migration}${summary.user_store_failure ? `; fallback reason: ${summary.user_store_failure}` : ""}.`
    : summary.user_store_failure
      ? "A storage problem was reported. Download a backup before making changes."
      : "Keep a downloaded backup before clearing browser or app storage.";
  const rows = isLab ? [
    ["Package ops", summary.package_operations],
    ["Installed packs", summary.installed_feature_packs],
    ["Assertion events", summary.assertion_events],
    ["Quarantined assertions", summary.quarantined_assertion_records],
    ["Import backups", summary.import_backups],
    ["User store", summary.user_store_backend],
    ["Authority", summary.user_store_authority],
    ["Migration", summary.user_store_migration],
  ] : [
    ["Records needing review", summary.quarantined_assertion_records],
    ["Recovery copies", summary.import_backups],
  ].filter(([, count]) => count > 0);
  section.append(title, health);
  if (rows.length) section.append(renderSummaryGrid(rows));
  if (summary.verse_drafts > 0) {
    const legacy = document.createElement("p");
    legacy.textContent = "Older saved drafts are preserved in your backup.";
    section.append(legacy);
  }
  return section;
}

function renderCapabilityManager(ctx, refresh) {
  const section = document.createElement("section");
  section.className = "diagnostic-section";
  section.dataset.featureId = "capability-controls";
  const heading = document.createElement("h4");
  heading.textContent = "Diagnostic capability controls";
  const warning = document.createElement("p");
  warning.textContent = "These technical controls are intended for package troubleshooting and testing.";
  section.append(heading, warning);
  const packageManifest = ctx.state.packageManifest || ctx.state.manifest?.package_manifest;
  if (!packageManifest) {
    const empty = document.createElement("p");
    empty.textContent = "Capability metadata is not loaded.";
    section.append(empty);
    return section;
  }
  const list = document.createElement("div");
  list.className = "tag-manager-list";
  const capabilities = resolveCapabilities(packageManifest, ctx.state.packageStore, {
    assumeBundledFullAccess: ctx.state.physicalDataMode !== "managed_cache_packs",
    physicalDataMode: ctx.state.physicalDataMode,
    physicalRecords: ctx.state.physicalPackRecords,
  });
  Object.values(capabilities).forEach((capability) => {
    const row = document.createElement("div");
    row.className = "tag-manager-item";
    row.dataset.capabilityId = capability.capability_id;
    const label = document.createElement("span");
    label.textContent = `${capability.label || capability.capability_id}: ${capability.state}`;
    const action = document.createElement("button");
    action.type = "button";
    action.className = capability.state === "disabled" ? "mini-button" : "mini-button danger-button";
    action.textContent = capability.state === "disabled" ? "Restore" : "Disable";
    action.addEventListener("click", () => {
      const result = setCapabilityDisabled(packageManifest, ctx.state.packageStore, capability.capability_id, capability.state !== "disabled");
      setPackageStore(ctx.state, result.store);
      ctx.renderChapter();
      refresh();
    });
    row.append(label, action);
    list.append(row);
  });
  section.append(list);
  return section;
}

function createReplaceConfirmation(onConfirm) {
  const panel = document.createElement("div");
  panel.className = "replace-confirmation";
  panel.hidden = true;
  panel.setAttribute("role", "alertdialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "replace-confirmation-title");
  const title = document.createElement("h5");
  title.id = "replace-confirmation-title";
  title.textContent = "Replace all local data?";
  const explanation = document.createElement("p");
  explanation.textContent = "Replacement overwrites current local data. A recovery backup will be created first. Cancel makes no change.";
  const actions = document.createElement("div");
  actions.className = "user-data-actions confirmation-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "mini-button";
  cancel.textContent = "Cancel";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "mini-button danger-button";
  confirm.textContent = "Replace all local data";
  actions.append(cancel, confirm);
  panel.append(title, explanation, actions);
  let returnFocus = null;
  const handleKeydown = (event) => {
    if (!panel.isConnected) { document.removeEventListener("keydown", handleKeydown, true); return; }
    if (panel.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [cancel, confirm];
    const current = controls.indexOf(document.activeElement);
    const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
    event.preventDefault();
    controls[next].focus();
  };
  const close = () => {
    panel.hidden = true;
    document.removeEventListener("keydown", handleKeydown, true);
    const target = returnFocus;
    returnFocus = null;
    target?.focus();
  };
  const open = (trigger) => {
    returnFocus = trigger;
    panel.hidden = false;
    document.addEventListener("keydown", handleKeydown, true);
    cancel.focus();
  };
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", () => { close(); onConfirm(); });
  return { panel, open };
}

export function createUserDataView(ctx, options = {}) {
  return function showUserData() {
    const files = ctx.platform?.files;
    const profile = ctx.state.featureProfile || ctx.platform?.profile;
    const wrap = document.createElement("div");
    wrap.className = "user-data-panel";
    wrap.dataset.featureProfile = profile?.id || "stable";
    // setDetail owns the visible My Data title; do not repeat it in the content.
    if (profile?.isLab) {
      const warning = document.createElement("p");
      warning.className = "lab-data-warning";
      warning.setAttribute("role", "status");
      warning.textContent = "Lab data is isolated from Stable. Nothing is copied between profiles unless you explicitly export and import a backup.";
      wrap.append(warning);
    }
    const summarySlot = document.createElement("div");
    const currentExportText = () => JSON.stringify(compactUserDataBackup(createUserDataExport(ctx.state)), null, 2);
    const refreshSummary = () => summarySlot.replaceChildren(renderStudyDataSummary(getUserDataSummary(ctx.state), options.showStudyMarks, ctx.platform?.kind));
    refreshSummary();
    wrap.append(summarySlot);

    const backupSection = document.createElement("section");
    backupSection.className = "my-data-section backup-restore-section";
    const backupTitle = document.createElement("h4");
    backupTitle.textContent = "Backup and restore";
    const backupIntro = document.createElement("p");
    backupIntro.textContent = "Save a backup of your study data, or choose a saved backup to restore. Merge keeps current items; Replace overwrites local data after confirmation.";
    const status = document.createElement("p");
    status.className = "import-status";
    status.setAttribute("role", "status");
    const download = document.createElement("button");
    download.type = "button";
    download.className = "mini-button primary-action";
    download.textContent = files?.nativeDialogs ? "Save backup…" : "Download backup";
    download.addEventListener("click", async () => {
      try {
        const result = await files?.saveTextFile({ text: currentExportText(), suggestedName: `bibleapp-user-data-${new Date().toISOString().slice(0, 10)}.json`, mimeType: "application/json" });
        if (!result || result.status === "error") {
          status.textContent = "Could not save the backup. Use Advanced backup options to copy it.";
          status.className = "import-status error";
        }
      } catch {
        status.textContent = "Could not save the backup. Use Advanced backup options to copy it.";
        status.className = "import-status error";
      }
    });
    const exportDetails = document.createElement("details");
    exportDetails.className = "manual-json-panel";
    const exportSummary = document.createElement("summary");
    exportSummary.textContent = "Show or copy backup JSON";
    const exportArea = document.createElement("textarea");
    exportArea.className = "user-data-textarea export-textarea";
    exportArea.readOnly = true;
    exportArea.rows = 8;
    exportArea.setAttribute("aria-label", "Backup JSON");
    const refreshExportArea = () => { exportArea.value = currentExportText(); };
    exportDetails.addEventListener("toggle", () => { if (exportDetails.open) refreshExportArea(); });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini-button";
    copy.textContent = "Copy backup JSON";
    const copyStatus = document.createElement("span");
    copyStatus.className = "inline-status";
    copyStatus.setAttribute("role", "status");
    copy.addEventListener("click", async () => {
      refreshExportArea();
      try {
        const result = await files?.copyText(exportArea.value);
        if (result?.status === "copied") { copyStatus.textContent = "Copied."; return; }
      } catch { /* Preserve the manual copy path when clipboard access fails. */ }
      exportArea.focus();
      exportArea.select();
      copyStatus.textContent = "Select and copy the highlighted JSON.";
    });
    exportDetails.append(exportSummary, exportArea, copy, copyStatus);
    const fileLabel = document.createElement(files?.nativeDialogs ? "button" : "label");
    fileLabel.className = files?.nativeDialogs ? "mini-button user-data-file-button" : "user-data-file-label";
    if (files?.nativeDialogs) fileLabel.type = "button";
    const fileLabelText = document.createElement("span");
    fileLabelText.textContent = files?.nativeDialogs ? "Open backup…" : "Choose backup file";
    const fileInput = files?.nativeDialogs ? null : document.createElement("input");
    if (fileInput) { fileInput.className = "user-data-file"; fileInput.type = "file"; fileInput.accept = "application/json,.json"; }
    fileLabel.append(fileLabelText, ...(fileInput ? [fileInput] : []));
    const pasteDetails = document.createElement("details");
    pasteDetails.className = "manual-json-panel paste-json-panel";
    const pasteSummary = document.createElement("summary");
    pasteSummary.textContent = "Paste backup JSON";
    const importArea = document.createElement("textarea");
    importArea.className = "user-data-textarea import-textarea";
    importArea.rows = 8;
    importArea.placeholder = "Paste a Bible App backup here.";
    importArea.setAttribute("aria-label", "Backup JSON to import");
    pasteDetails.append(pasteSummary, importArea);
    const advancedBackup = document.createElement("details");
    advancedBackup.className = "advanced-backup-options";
    const advancedBackupTitle = document.createElement("summary");
    advancedBackupTitle.textContent = "Advanced backup options";
    advancedBackup.append(advancedBackupTitle, exportDetails, pasteDetails);

    const runImport = (mode) => {
      let applied = false;
      try {
        const payload = JSON.parse(importArea.value);
        ctx.platform?.userStorage?.beginRecovery?.();
        const summary = importUserData(ctx.state, payload, mode);
        applied = true;
        ctx.renderChapter();
        refreshSummary();
        status.textContent = mode === "merge" ? "Backup merged with your saved study data." : "Local data replaced. A recovery copy of the previous data was saved.";
        if (mode === "replace" && !summary.last_import_backup?.created_at) status.textContent = "Local data replaced.";
        status.className = "import-status success";
        if (diagnostics.open) refreshDiagnostics();
      } catch (error) {
        if (applied) {
          // A rendering error after import is not a failed or rolled-back import.
          status.textContent = "Backup imported, but the view could not refresh. Reopen My Data before trying again.";
          status.className = "import-status error";
          return;
        }
        ctx.platform?.userStorage?.cancelRecovery?.();
        const message = error instanceof Error ? error.message : "Import failed.";
        status.textContent = error instanceof SyntaxError ? "That file is not valid JSON. No local data was changed." : message.includes("No local data was changed.") ? message : `${message} No local data was changed.`;
        status.className = "import-status error";
      }
    };
    const openBackup = async () => {
      try {
        const result = await files?.openTextFile({ input: fileInput, accept: "application/json,.json" });
        if (result?.status === "cancelled") return;
        if (result?.status === "opened") {
          importArea.value = result.text;
          status.textContent = `Loaded ${result.name}. Choose Merge backup or Replace all local data.`;
          status.className = "import-status";
          return;
        }
      } catch { /* Use the same non-destructive failure state as a read failure. */ }
      status.textContent = "Could not read that backup file. No local data was changed.";
      status.className = "import-status error";
    };
    (fileInput || fileLabel).addEventListener(fileInput ? "change" : "click", openBackup);
    const importActions = document.createElement("div");
    importActions.className = "user-data-actions import-actions";
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "mini-button";
    merge.textContent = "Merge backup";
    merge.addEventListener("click", () => runImport("merge"));
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "mini-button danger-button";
    replace.textContent = "Replace all local data";
    const confirmation = createReplaceConfirmation(() => runImport("replace"));
    replace.addEventListener("click", () => confirmation.open(replace));
    importActions.append(merge, replace);
    backupSection.append(backupTitle, backupIntro, download, fileLabel, importActions, advancedBackup, confirmation.panel, status);
    wrap.append(backupSection);

    const diagnostics = document.createElement("details");
    diagnostics.className = "advanced-diagnostics";
    diagnostics.dataset.featureId = "advanced-diagnostics";
    const diagnosticsSummary = document.createElement("summary");
    diagnosticsSummary.textContent = profile?.isLab ? "Advanced diagnostics" : "Help and recovery";
    const projectSource = document.createElement("a");
    projectSource.href = "https://github.com/Nobodyworld/app-bible-language-study";
    projectSource.target = "_blank";
    projectSource.rel = "noopener noreferrer";
    projectSource.textContent = "Help, project source and notices";
    const diagnosticsSlot = document.createElement("div");
    const refreshDiagnostics = () => {
      const sections = [renderTechnicalSummary(getUserDataSummary(ctx.state), profile?.isLab)];
      if (profile?.isLab) {
        if (ctx.isFeatureEnabled?.("physical-pack-management") !== false) sections.push(renderPhysicalPackManager(ctx));
        if (ctx.isFeatureEnabled?.("capability-controls") !== false) sections.push(renderCapabilityManager(ctx, refreshDiagnostics));
      } else {
        const recovery = renderPackRecovery(ctx);
        if (recovery) sections.push(recovery);
      }
      diagnosticsSlot.replaceChildren(...sections);
    };
    diagnostics.addEventListener("toggle", () => { if (diagnostics.open && !diagnosticsSlot.childNodes.length) refreshDiagnostics(); });
    diagnostics.append(diagnosticsSummary, diagnosticsSlot, projectSource);
    if (profile?.isLab) { diagnostics.open = true; refreshDiagnostics(); }
    wrap.append(diagnostics);
    setDetail("My Data", wrap, { viewId: DETAIL_VIEW_IDS.myData });
  };
}
