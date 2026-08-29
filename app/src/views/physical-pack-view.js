import { PHYSICAL_DATA_MODES, PHYSICAL_PACK_SNAPSHOT_EVENT } from "../physical-pack-contract.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

function packLabel(packId) {
  if (packId === "search-verses") return "Search";
  if (packId === "commentary-verse-index") return "Commentary";
  return packId;
}

function describeStorage(plan) {
  const storage = plan.storage;
  if (!storage?.known) {
    return `Storage estimate unavailable; required raw bytes: ${formatBytes(plan.bytes || 0)}.`;
  }
  return `Storage usage ${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}; approximately ${formatBytes(storage.available)} available; required raw bytes ${formatBytes(plan.bytes || 0)}.`;
}

function focusable(dialog) {
  return [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled])")];
}

function captureReaderSelection() {
  const word = document.querySelector(".reader-context-word");
  const verse = word?.closest(".verse-row, .source-bearing-segment") || document.querySelector(".reader-context-verse");
  return {
    word: word ? {
      strongCode: word.dataset.strongCode || "",
      tokenIndex: word.dataset.tokenIndex || "",
      interlinearKey: word.dataset.interlinearKey || "",
    } : null,
    verse: verse?.dataset.verse || "",
  };
}

function restoreReaderSelection(selection) {
  if (!selection) return;
  if (selection.word) {
    const word = [...document.querySelectorAll(".strong-token")].find((node) =>
      (node.dataset.strongCode || "") === selection.word.strongCode &&
      (node.dataset.tokenIndex || "") === selection.word.tokenIndex &&
      (node.dataset.interlinearKey || "") === selection.word.interlinearKey
    );
    word?.classList.add("reader-context-word");
    word?.closest(".verse-row, .source-bearing-segment")?.classList.add("reader-context-verse");
    return;
  }
  if (selection.verse) {
    document.querySelector(`.verse-row[data-verse="${CSS.escape(selection.verse)}"]`)?.classList.add("reader-context-verse");
  }
}

function createPlanDialog({ title, description, confirmLabel, onConfirm, onClose }) {
  const dialog = document.createElement("div");
  dialog.className = "physical-pack-confirmation";
  dialog.hidden = true;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = document.createElement("h5");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = description;
  const actions = document.createElement("div");
  actions.className = "user-data-actions confirmation-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "mini-button";
  cancel.textContent = "Cancel";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "mini-button primary-action";
  confirm.textContent = confirmLabel;
  actions.append(cancel, confirm);
  dialog.append(heading, text, actions);

  let returnFocus = null;
  let returnScrollTop = null;
  const close = () => {
    dialog.hidden = true;
    document.removeEventListener("keydown", onKeydown, true);
    const target = returnFocus;
    returnFocus = null;
    target?.focus({ preventScroll: true });
    const scroller = target?.closest?.("#detailContent");
    if (scroller && returnScrollTop != null) scroller.scrollTop = returnScrollTop;
    returnScrollTop = null;
    onClose?.();
  };
  const onKeydown = (event) => {
    if (dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusable(dialog);
    const index = controls.indexOf(document.activeElement);
    const next = event.shiftKey
      ? index <= 0 ? controls.length - 1 : index - 1
      : (index + 1) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", async () => {
    const target = returnFocus;
    const scroller = target?.closest?.("#detailContent");
    const scrollTop = returnScrollTop;
    dialog.hidden = true;
    document.removeEventListener("keydown", onKeydown, true);
    returnFocus = null;
    returnScrollTop = null;
    if (scroller && scrollTop != null) scroller.scrollTop = scrollTop;
    await onConfirm(target);
  });
  return {
    node: dialog,
    open(trigger) {
      returnFocus = trigger;
      returnScrollTop = trigger.closest?.("#detailContent")?.scrollTop ?? null;
      dialog.hidden = false;
      document.addEventListener("keydown", onKeydown, true);
      cancel.focus();
    },
  };
}

function createAction(label, key, handler, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mini-button${options.danger ? " danger-button" : ""}`;
  button.textContent = label;
  button.dataset.focusKey = key;
  button.addEventListener("click", handler);
  return button;
}

export function renderPhysicalPackManager(ctx) {
  const manager = ctx.state.physicalPackManager;
  const section = document.createElement("section");
  section.className = "diagnostic-section physical-pack-manager";
  section.dataset.physicalPackManager = "true";
  const heading = document.createElement("h4");
  heading.textContent = "Physical study packs";
  const intro = document.createElement("p");
  intro.textContent = "Install and verify browser-local Search and Commentary copies. The distribution manifest controls bundled fallback; physical state remains visible independently and pack bytes are not included in portable backups.";
  const content = document.createElement("div");
  const live = document.createElement("p");
  live.className = "physical-pack-live-status";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  section.append(heading, intro, content, live);

  if (!manager) {
    const unavailable = document.createElement("p");
    unavailable.className = "error-state";
    unavailable.textContent = ctx.state.physicalPackInitializationError || "Physical-pack storage is unavailable in this browser.";
    content.append(unavailable);
    return section;
  }

  let busy = false;
  let activeAbort = null;
  let latestSnapshot = manager.snapshot();
  const preservedReaderSelection = captureReaderSelection();

  const run = async (label, action, focusKey = null) => {
    if (busy) return;
    busy = true;
    activeAbort = new AbortController();
    live.className = "physical-pack-live-status";
    live.textContent = `${label}…`;
    render();
    try {
      await action(activeAbort.signal, (progress) => {
        live.textContent = `${packLabel(progress.pack_id)}: ${progress.phase} ${progress.completed} of ${progress.total}.`;
        const progressBar = section.querySelector("progress");
        if (progressBar) {
          progressBar.max = Math.max(1, progress.total);
          progressBar.value = progress.completed;
        }
      });
      live.className = "physical-pack-live-status success";
      live.textContent = `${label} completed.`;
    } catch (error) {
      live.className = "physical-pack-live-status error";
      live.textContent = error?.name === "AbortError" ? `${label} cancelled; the previous active copy was preserved.` : `${label} failed: ${error?.message || "unknown error"}`;
    } finally {
      busy = false;
      activeAbort = null;
      render(focusKey);
      restoreReaderSelection(preservedReaderSelection);
    }
  };

  const openPlan = async (packId, action, trigger) => {
    try {
      const plan = await manager.plan(packId, action);
      if (action === "remove" && plan.blocked_by?.length) {
        live.className = "physical-pack-live-status error";
        live.textContent = `${packLabel(packId)} is required by ${plan.blocked_by.map(packLabel).join(", ")}. Remove dependent packs first.`;
        trigger.focus();
        return;
      }
      const size = plan.bytes == null
        ? "the currently active local copy"
        : `${plan.files} file(s), ${formatBytes(plan.bytes)} raw, approximately ${formatBytes(plan.transfer_bytes)} transferred`;
      const versions = plan.target_version
        ? ` Current version: ${plan.current_version || "not installed"}. Target version: ${plan.target_version}.`
        : "";
      const description = `${packLabel(packId)} ${action} plan: ${size}. Required packs: ${(plan.required_pack_ids || []).join(", ") || "none"}. Dependencies: ${(plan.dependency_order || []).join(" → ") || "none"}.${versions} ${describeStorage(plan)} Opening or cancelling this plan makes no changes.`;
      const dialog = createPlanDialog({
        title: `${action[0].toUpperCase()}${action.slice(1)} ${packLabel(packId)}?`,
        description,
        confirmLabel: `${action[0].toUpperCase()}${action.slice(1)} ${packLabel(packId)}`,
        onClose: () => restoreReaderSelection(preservedReaderSelection),
        onConfirm: () => run(`${packLabel(packId)} ${action}`, (signal, onProgress) => {
          if (action === "install") return manager.install(packId, { signal, onProgress });
          if (action === "update") return manager.update(packId, { signal, onProgress });
          if (action === "repair") return manager.repair(packId, { signal, onProgress });
          if (action === "remove") return manager.remove(packId);
          if (action === "rollback") return manager.rollback(packId);
          return manager.verify(packId);
        }, `${packId}:${action}`),
      });
      content.append(dialog.node);
      dialog.open(trigger);
    } catch (error) {
      live.className = "physical-pack-live-status error";
      live.textContent = `Could not create plan: ${error?.message || "unknown error"}`;
    }
  };

  const render = (restoreFocusKey = null, snapshotOverride = null) => {
    const detailScroller = section.closest("#detailContent");
    const detailScrollTop = detailScroller?.scrollTop ?? null;
    const snapshot = latestSnapshot = snapshotOverride || manager.snapshot();
    const wrap = document.createDocumentFragment();

    const mode = document.createElement("div");
    mode.className = "physical-pack-mode";
    const modeText = document.createElement("p");
    modeText.innerHTML = `<strong>Runtime mode:</strong> ${snapshot.mode === PHYSICAL_DATA_MODES.bundled ? "Complete bundled data" : "Verified managed packs"}`;
    const useBundled = createAction("Use bundled data", "mode:bundled", () => run("Bundled-data mode", () => manager.setMode(PHYSICAL_DATA_MODES.bundled), "mode:bundled"));
    const useManaged = createAction("Use managed packs", "mode:managed", () => run("Managed-pack mode", () => manager.setMode(PHYSICAL_DATA_MODES.managed), "mode:managed"));
    useBundled.disabled = busy || snapshot.mode === PHYSICAL_DATA_MODES.bundled;
    useManaged.disabled = busy || snapshot.mode === PHYSICAL_DATA_MODES.managed;
    mode.append(modeText, useBundled, useManaged);
    wrap.append(mode);

    const catalog = document.createElement("div");
    catalog.className = "physical-pack-catalog-controls";
    const catalogLabel = document.createElement("label");
    catalogLabel.textContent = "Catalog URL";
    const catalogInput = document.createElement("input");
    catalogInput.type = "url";
    const applicationUrl = ctx.platform?.environment?.currentUrl || ctx.platform?.environment?.baseUrl || "http://localhost/";
    catalogInput.value = snapshot.catalog_url || new URL(applicationUrl).searchParams.get("physicalPackCatalog") || "";
    catalogInput.placeholder = "./data/physical-pack-fixtures/catalog-v1.json";
    catalogInput.disabled = busy;
    catalogLabel.append(catalogInput);
    const refresh = createAction("Refresh catalog", "catalog:refresh", () => run("Catalog refresh", (signal) => manager.refreshCatalog(catalogInput.value, { signal }), "catalog:refresh"));
    refresh.disabled = busy || !catalogInput.value;
    catalogInput.addEventListener("input", () => { refresh.disabled = busy || !catalogInput.value; });
    catalog.append(catalogLabel, refresh);
    wrap.append(catalog);

    const progress = document.createElement("progress");
    progress.max = 1;
    progress.value = busy ? 0 : 1;
    progress.hidden = !busy;
    progress.setAttribute("aria-label", "Physical-pack operation progress");
    wrap.append(progress);
    if (busy) {
      const cancel = createAction("Cancel current operation", "operation:cancel", () => activeAbort?.abort());
      wrap.append(cancel);
    }

    const storage = document.createElement("p");
    storage.className = "physical-pack-storage";
    storage.textContent = "Storage estimate is shown in each plan. Cache Storage is independent of portable bibleapp:user-data version 3 backups.";
    wrap.append(storage);

    const records = new Map(snapshot.records.map((record) => [record.pack_id, record]));
    const catalogEntries = new Map((snapshot.catalog?.packs || []).map((pack) => [pack.pack_id, pack]));
    const packIds = [...new Set(["search-verses", "commentary-verse-index", ...catalogEntries.keys(), ...records.keys()])];
    const list = document.createElement("div");
    list.className = "physical-pack-list";
    packIds.forEach((packId) => {
      const record = records.get(packId);
      const available = catalogEntries.get(packId);
      const card = document.createElement("article");
      card.className = "physical-pack-card";
      card.dataset.packId = packId;
      const title = document.createElement("h5");
      title.textContent = packLabel(packId);
      const state = document.createElement("p");
      state.className = "physical-pack-state";
      state.textContent = record
        ? record.state === "startup_verifying"
          ? `State: startup verifying; stored bytes for ${record.pack_version} are being verified before managed use.`
          : record.state === "incompatible"
            ? `State: incompatible; stored ${record.pack_version} is not compatible with this app and is not managed runtime authority.`
          : `State: ${record.state.replaceAll("_", " ")}; active ${record.pack_version}; verified ${record.verified_files}/${record.expected_files} files.`
        : `State: not installed${available ? `; available ${available.pack_version}, ${formatBytes(available.bytes)}` : "; no catalog entry"}.`;
      const runtime = document.createElement("p");
      runtime.className = "physical-pack-runtime-source";
      const verifiedManaged = record && ["active", "update_available", "rollback_available"].includes(record.state) &&
        record.active_cache && record.verified_files === record.expected_files && record.verified_bytes === record.expected_bytes;
      runtime.textContent = snapshot.mode === PHYSICAL_DATA_MODES.managed
        ? verifiedManaged
          ? "Runtime source: verified managed pack."
          : snapshot.distribution?.bundled_fallback
            ? "Runtime source: bundled fallback; physical actions below still reflect the browser-local copy."
            : "Runtime source: unavailable until a verified managed pack is active."
        : "Runtime source: complete bundled data.";
      const actions = document.createElement("div");
      actions.className = "user-data-actions physical-pack-actions";
      const addPlanAction = (label, action, danger = false) => {
        const button = createAction(label, `${packId}:${action}`, (event) => openPlan(packId, action, event.currentTarget), { danger });
        button.disabled = busy || !available && ["install", "update", "repair"].includes(action);
        actions.append(button);
      };
      if (record?.state === "startup_verifying") {
        const verifying = document.createElement("p");
        verifying.className = "physical-pack-verification-status";
        verifying.textContent = "Lifecycle actions are unavailable until stored-byte verification finishes.";
        actions.append(verifying);
      } else {
        if (!record || record.state === "failed") addPlanAction(record ? "Retry install" : "Plan install", "install");
        const compatibleReplacementAvailable = record?.state === "incompatible" && available?.pack_version !== record.pack_version;
        if (record?.state === "update_available" || compatibleReplacementAvailable) addPlanAction("Plan update", "update");
        if (["corrupt", "repair_required"].includes(record?.state)) addPlanAction("Plan repair", "repair");
        if (record?.active_cache) {
          if (record.state !== "incompatible") addPlanAction("Verify", "verify");
          if (record.state !== "incompatible" && record.rollback_cache) addPlanAction("Plan rollback", "rollback");
          addPlanAction("Plan removal", "remove", true);
        }
      }
      card.append(title, state, runtime, actions);
      if (record?.last_failure) {
        const failure = document.createElement("p");
        failure.className = "physical-pack-failure";
        failure.textContent = `Last failure: ${record.last_failure.message}`;
        card.append(failure);
      }
      const provenance = record?.provenance || available && {
        license_note: available.license_note,
        notice_path: available.notice_path,
        source_manifest_path: available.source_manifest_path,
      };
      if (provenance) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Notice and provenance";
        const text = document.createElement("p");
        text.textContent = `${provenance.license_note} Notice: ${provenance.notice_path}. Source manifest: ${provenance.source_manifest_path}.`;
        details.append(summary, text);
        card.append(details);
      }
      list.append(card);
    });
    wrap.append(list);

    const cleanup = createAction(`Clean orphan caches (${snapshot.orphan_caches.length})`, "cleanup", () => run("Orphan-cache cleanup", () => manager.cleanup(), "cleanup"));
    cleanup.disabled = busy || !snapshot.orphan_caches.length;
    wrap.append(cleanup);

    const historyTitle = document.createElement("h5");
    historyTitle.textContent = "Physical-pack history";
    const history = document.createElement("ol");
    history.className = "physical-pack-history";
    snapshot.history.slice(0, 10).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.created_at}: ${entry.action} ${entry.state}${entry.detail?.pack_id ? ` (${entry.detail.pack_id})` : ""}`;
      history.append(item);
    });
    if (!history.childNodes.length) {
      const empty = document.createElement("p");
      empty.textContent = "No physical-pack operations have been recorded in this browser.";
      wrap.append(historyTitle, empty);
    } else {
      wrap.append(historyTitle, history);
    }

    content.replaceChildren(wrap);
    if (restoreFocusKey) content.querySelector(`[data-focus-key="${CSS.escape(restoreFocusKey)}"]`)?.focus({ preventScroll: true });
    if (detailScroller && detailScrollTop != null) detailScroller.scrollTop = detailScrollTop;
    restoreReaderSelection(preservedReaderSelection);
  };

  section.addEventListener(PHYSICAL_PACK_SNAPSHOT_EVENT, (event) => {
    if (!section.isConnected || !event.detail) return;
    const wasVerifying = latestSnapshot.records.some((record) => record.state === "startup_verifying");
    const focusKey = section.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey || null : null;
    latestSnapshot = event.detail;
    render(focusKey, event.detail);
    if (!busy && wasVerifying && !latestSnapshot.records.some((record) => record.state === "startup_verifying")) {
      live.className = "physical-pack-live-status success";
      live.textContent = "Stored-pack startup verification completed.";
    }
  });

  render();
  return section;
}
