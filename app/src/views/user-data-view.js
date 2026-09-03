import {
  completeJob,
  createUserDataExport,
  getUserDataSummary,
  importUserData,
  requestTagIndexRefresh,
  setPackageStore,
  updateJobStatus,
} from "../stores.js?v=pr13-live-qa-20260711e";
import { setDetail } from "../dom.js?v=pr13-live-qa-20260711e";
import { resolveCapabilities } from "../capabilities.js";
import { DETAIL_VIEW_IDS } from "../ui-contracts.js";
import { canRunJob, runJob } from "../job-processor.js?v=pr13-live-qa-20260711e";
import { setCapabilityDisabled } from "../package-state.js";
import { renderJobsDiagnostics } from "./jobs-view.js?v=pr13-live-qa-20260711e";
import { renderPhysicalPackManager } from "./physical-pack-view.js";

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
  title.textContent = "My study data";
  const intro = document.createElement("p");
  intro.className = "study-data-intro";
  intro.textContent = platformKind === "tauri-windows"
    ? "This data is stored by the installed app, not in an online account. Save backups you care about so you can recover them later."
    : "This data is stored in this browser, not in an online account. Download backups you care about so you can recover them later.";
  section.append(
    title,
    intro,
    renderSummaryGrid([
      ["Custom labels", summary.custom_tags],
      ["Tagged verses", summary.tagged_verses],
      ["Study Mark assertions", summary.tag_assertions],
      ["Active Study Marks", summary.assertions, showStudyMarks],
      ["Personal meanings", summary.token_renderings],
      ["Preserved legacy verse drafts", summary.verse_drafts],
    ]),
  );
  return section;
}

function renderTechnicalSummary(summary) {
  const section = document.createElement("section");
  section.className = "diagnostic-section";
  const title = document.createElement("h4");
  title.textContent = "Storage and data records";
  const health = document.createElement("p");
  health.className = "storage-health-status";
  health.textContent = `Storage authority: ${summary.user_store_authority || summary.user_store_backend}; migration: ${summary.user_store_migration}${summary.user_store_failure ? `; fallback reason: ${summary.user_store_failure}` : ""}.`;
  section.append(
    title,
    health,
    renderSummaryGrid([
      ["Tag jobs", summary.tag_jobs],
      ["Workspace jobs", summary.workspace_jobs],
      ["Package ops", summary.package_operations],
      ["Installed packs", summary.installed_feature_packs],
      ["Assertion events", summary.assertion_events],
      ["Quarantined assertions", summary.quarantined_assertion_records],
      ["Poll responses", summary.poll_responses],
      ["Poll events", summary.poll_events],
      ["Import backups", summary.import_backups],
      ["User store", summary.user_store_backend],
      ["Authority", summary.user_store_authority],
      ["Migration", summary.user_store_migration],
    ]),
  );
  return section;
}

function renderCapabilityManager(ctx, refresh) {
  const section = document.createElement("section");
  section.className = "diagnostic-section";
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
    const label = document.createElement("span");
    label.textContent = `${capability.label || capability.capability_id}: ${capability.state}`;
    const action = document.createElement("button");
    action.type = "button";
    action.className = capability.state === "disabled" ? "mini-button" : "mini-button danger-button";
    action.textContent = capability.state === "disabled" ? "Restore" : "Disable";
    action.addEventListener("click", () => {
      const result = setCapabilityDisabled(
        packageManifest,
        ctx.state.packageStore,
        capability.capability_id,
        capability.state !== "disabled",
      );
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
  explanation.textContent =
    "Replacement overwrites current local data. A recovery backup will be created first. Cancel makes no change.";
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
    if (!panel.isConnected) {
      document.removeEventListener("keydown", handleKeydown, true);
      return;
    }
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
  confirm.addEventListener("click", () => {
    close();
    onConfirm();
  });

  return { panel, open };
}

export function createUserDataView(ctx, options = {}) {
  return function showUserData() {
    const files = ctx.platform?.files;
    const profile = ctx.state.featureProfile || ctx.platform?.profile;
    const wrap = document.createElement("div");
    wrap.className = "user-data-panel";
    wrap.dataset.featureProfile = profile?.id || "stable";
    const heading = document.createElement("h3");
    heading.textContent = "My Data";
    wrap.append(heading);

    if (profile?.isLab) {
      const warning = document.createElement("p");
      warning.className = "lab-data-warning";
      warning.setAttribute("role", "status");
      warning.textContent = "Lab data is isolated from Stable. Nothing is copied between profiles unless you explicitly export and import a backup.";
      wrap.append(warning);
    }

    const summarySlot = document.createElement("div");
    const currentExportText = () => JSON.stringify(createUserDataExport(ctx.state), null, 2);
    const refreshSummary = () => {
      summarySlot.replaceChildren(renderStudyDataSummary(
        getUserDataSummary(ctx.state),
        options.showStudyMarks,
        ctx.platform?.kind,
      ));
    };
    refreshSummary();
    wrap.append(summarySlot);

    const backupSection = document.createElement("section");
    backupSection.className = "my-data-section backup-restore-section";
    const backupTitle = document.createElement("h4");
    backupTitle.textContent = "Backup and restore";
    const backupIntro = document.createElement("p");
    backupIntro.textContent = files?.nativeDialogs
      ? "Save a versioned JSON backup, or open one to merge or replace Bible App data."
      : "Download a versioned JSON backup, or merge or replace data from a Bible App backup.";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "mini-button primary-action";
    download.textContent = files?.nativeDialogs ? "Save backup…" : "Download backup";
    download.addEventListener("click", async () => {
      const result = await files?.saveTextFile({
        text: currentExportText(),
        suggestedName: `bibleapp-user-data-${new Date().toISOString().slice(0, 10)}.json`,
        mimeType: "application/json",
      });
      if (result?.status === "error") {
        download.title = result.message;
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
    const refreshExportArea = () => {
      exportArea.value = currentExportText();
    };
    exportDetails.addEventListener("toggle", () => {
      if (exportDetails.open) refreshExportArea();
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini-button";
    copy.textContent = "Copy backup JSON";
    const copyStatus = document.createElement("span");
    copyStatus.className = "inline-status";
    copy.addEventListener("click", async () => {
      refreshExportArea();
      const result = await files?.copyText(exportArea.value);
      if (result?.status === "copied") {
        copyStatus.textContent = "Copied.";
      } else {
        exportArea.focus();
        exportArea.select();
        copyStatus.textContent = "Select and copy the highlighted JSON.";
      }
    });
    exportDetails.append(exportSummary, exportArea, copy, copyStatus);

    const fileLabel = document.createElement(files?.nativeDialogs ? "button" : "label");
    fileLabel.className = files?.nativeDialogs ? "mini-button user-data-file-button" : "user-data-file-label";
    if (files?.nativeDialogs) fileLabel.type = "button";
    const fileLabelText = document.createElement("span");
    fileLabelText.textContent = files?.nativeDialogs ? "Open backup…" : "Choose backup file";
    const fileInput = files?.nativeDialogs ? null : document.createElement("input");
    if (fileInput) {
      fileInput.className = "user-data-file";
      fileInput.type = "file";
      fileInput.accept = "application/json,.json";
    }
    fileLabel.append(fileLabelText, ...(fileInput ? [fileInput] : []));

    const pasteDetails = document.createElement("details");
    pasteDetails.className = "manual-json-panel paste-json-panel";
    const pasteSummary = document.createElement("summary");
    pasteSummary.textContent = "Paste backup JSON";
    const importArea = document.createElement("textarea");
    importArea.className = "user-data-textarea import-textarea";
    importArea.rows = 8;
    importArea.placeholder = "Paste a Bible App user-data export JSON file here.";
    importArea.setAttribute("aria-label", "Backup JSON to import");
    pasteDetails.append(pasteSummary, importArea);

    const status = document.createElement("p");
    status.className = "import-status";
    status.setAttribute("role", "status");
    const runImport = (mode) => {
      try {
        const payload = JSON.parse(importArea.value);
        ctx.platform?.userStorage?.beginRecovery?.();
        const summary = importUserData(ctx.state, payload, mode);
        ctx.renderChapter();
        refreshSummary();
        status.textContent = `Backup ${mode === "merge" ? "merged" : "replaced"}. Custom labels: ${summary.custom_tags}; preserved legacy drafts: ${summary.verse_drafts}.`;
        if (mode === "replace" && summary.last_import_backup?.created_at) {
          status.textContent += ` Recovery backup created ${summary.last_import_backup.created_at}.`;
        }
        status.className = "import-status success";
      } catch (error) {
        ctx.platform?.userStorage?.cancelRecovery?.();
        const message = error instanceof Error ? error.message : "Import failed.";
        status.textContent = error instanceof SyntaxError
          ? "That file is not valid JSON. No local data was changed."
          : message.includes("No local data was changed.")
            ? message
            : `${message} No local data was changed.`;
        status.className = "import-status error";
      }
    };

    const openBackup = async () => {
      const result = await files?.openTextFile({ input: fileInput, accept: "application/json,.json" });
      if (!result || result.status === "cancelled") return;
      if (result.status === "opened") {
        importArea.value = result.text;
        status.textContent = `Loaded ${result.name}. Choose Merge backup or Replace all local data.`;
        status.className = "import-status";
        return;
      }
      status.textContent = `${result.message || "Could not read that backup file."} No local data was changed.`;
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
    backupSection.append(
      backupTitle,
      backupIntro,
      download,
      exportDetails,
      fileLabel,
      pasteDetails,
      importActions,
      confirmation.panel,
      status,
    );
    wrap.append(backupSection);

    const settingsSection = document.createElement("section");
    settingsSection.className = "my-data-section app-settings-section";
    const settingsTitle = document.createElement("h4");
    settingsTitle.textContent = "App settings";
    const settingsText = document.createElement("p");
    settingsText.textContent = "Theme remains available in the global header. Technical feature controls are under Advanced diagnostics.";
    settingsSection.append(settingsTitle, settingsText);
    wrap.append(settingsSection);

    const maintenanceSection = document.createElement("section");
    maintenanceSection.className = "my-data-section maintenance-section";
    const maintenanceTitle = document.createElement("h4");
    maintenanceTitle.textContent = "Local maintenance";
    const maintenanceText = document.createElement("p");
    maintenanceText.textContent =
      "Refresh the browser-local index used by Study Marks if results look stale. This rebuilds a derived view, does not change personal study data, and never leaves this browser.";
    const maintenanceAction = document.createElement("button");
    maintenanceAction.type = "button";
    maintenanceAction.className = "mini-button";
    maintenanceAction.textContent = "Refresh Study Marks index";
    const maintenanceStatus = document.createElement("p");
    maintenanceStatus.className = "maintenance-status";
    maintenanceStatus.setAttribute("role", "status");
    let maintenanceBusy = false;
    maintenanceAction.addEventListener("click", async () => {
      if (maintenanceBusy) return;
      maintenanceBusy = true;
      maintenanceAction.disabled = true;
      maintenanceStatus.className = "maintenance-status";
      maintenanceStatus.textContent = "Refreshing the local Study Marks index…";
      const job = requestTagIndexRefresh(ctx.state);
      if (!job || !canRunJob(job)) {
        maintenanceStatus.textContent = "Study Marks index refresh is unavailable in this app package.";
      } else {
        updateJobStatus(ctx.state, job.store, job.id, "running");
        try {
          const result = await runJob(job, ctx.state);
          completeJob(ctx.state, job.store, job.id, result, "completed");
          const finding = result.findings?.[0];
          maintenanceStatus.textContent = `Study Marks index refreshed for ${finding?.reference_count ?? 0} scripture reference(s). Personal study data was not changed.`;
        } catch (error) {
          completeJob(ctx.state, job.store, job.id, { message: error?.message || "Refresh failed." }, "failed");
          maintenanceStatus.textContent = `Could not refresh the Study Marks index: ${error?.message || "unknown error"}. Personal study data was not changed.`;
          maintenanceStatus.className = "maintenance-status error";
        }
      }
      maintenanceBusy = false;
      maintenanceAction.disabled = false;
      refreshSummary();
      refreshDiagnostics();
    });
    maintenanceSection.append(maintenanceTitle, maintenanceText, maintenanceAction, maintenanceStatus);
    wrap.append(maintenanceSection);

    const diagnostics = document.createElement("details");
    diagnostics.className = "advanced-diagnostics";
    diagnostics.dataset.featureId = "advanced-diagnostics";
    const diagnosticsSummary = document.createElement("summary");
    diagnosticsSummary.textContent = "Advanced diagnostics";
    const diagnosticsIntro = document.createElement("p");
    diagnosticsIntro.textContent = profile?.isLab
      ? "Lab exposes the complete experimental browser storage, physical-pack, capability, and local-job controls against isolated Lab state."
      : "Inspect browser storage, package capabilities, and technical local job controls for compatibility and recovery.";
    if (ctx.platform?.kind === "tauri-windows") {
      diagnosticsIntro.textContent = profile?.isLab
        ? "Lab exposes isolated native user storage and bundled-data diagnostics. Native physical-pack management is deferred to issue #81."
        : "Inspect native user storage, bundled-data capabilities, and technical local job controls for compatibility and recovery.";
    }
    const projectSource = document.createElement("a");
    projectSource.href = "https://github.com/Nobodyworld/app-bible-language-study";
    projectSource.target = "_blank";
    projectSource.rel = "noopener noreferrer";
    projectSource.textContent = "Project source and notices";
    const diagnosticsSlot = document.createElement("div");
    const refreshDiagnostics = () => {
      const summary = getUserDataSummary(ctx.state);
      const jobsTitle = document.createElement("h4");
      jobsTitle.textContent = "Local job console";
      const sections = [renderTechnicalSummary(summary)];
      if (ctx.isFeatureEnabled?.("physical-pack-management") !== false) sections.push(renderPhysicalPackManager(ctx));
      if (ctx.isFeatureEnabled?.("capability-controls") !== false) sections.push(renderCapabilityManager(ctx, refreshDiagnostics));
      if (ctx.isFeatureEnabled?.("local-jobs") !== false) sections.push(jobsTitle, renderJobsDiagnostics(ctx, refreshDiagnostics));
      diagnosticsSlot.replaceChildren(...sections);
    };
    diagnostics.addEventListener("toggle", () => {
      if (diagnostics.open && !diagnosticsSlot.childNodes.length) refreshDiagnostics();
    });
    diagnostics.append(diagnosticsSummary, diagnosticsIntro, projectSource, diagnosticsSlot);
    if (profile?.isLab) {
      diagnostics.open = true;
      refreshDiagnostics();
    }
    wrap.append(diagnostics);

    setDetail("My Data", wrap, { viewId: DETAIL_VIEW_IDS.myData });
  };
}
