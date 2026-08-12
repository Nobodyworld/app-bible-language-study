import {
  deleteTokenRendering,
  getTokenRendering,
  setTokenRendering,
} from "./stores.js?v=pr13-live-qa-20260711e";
import { normalizeTarget } from "./semantic-targets.js?v=pr13-live-qa-20260711e";
import {
  activateOverlay,
  deactivateOverlay,
  isActiveOverlay,
} from "./overlay-coordinator.js?v=pr13-live-qa-20260711e";
import {
  closeContainedDetailTool,
  openContainedDetailTool,
} from "./detail-tool-surface.js";

export const CUSTOM_MEANING_MAX_LENGTH = 180;
let meaningControlSequence = 0;

export function normalizeMeaningValue(value) {
  return String(value || "").trim();
}

function uniqueMeaningEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const value = normalizeMeaningValue(entry?.value);
    if (!value) return false;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    entry.value = value;
    return true;
  });
}

export function buildWordMeaningChoiceModel({
  savedRendering = "",
  exactMappedEnglish = "",
  english = "",
  gloss = "",
  lexiconShortDefinition = "",
  lexiconMeaning = "",
} = {}) {
  const entries = uniqueMeaningEntries([
    { value: savedRendering, source: "saved", current: true },
    { value: exactMappedEnglish, source: "exact_bsb" },
    { value: english, source: "english" },
    { value: gloss, source: "gloss" },
    { value: lexiconShortDefinition || lexiconMeaning, source: "lexicon" },
  ]);
  const current = entries.find((entry) => entry.current) || null;
  return {
    saved: current?.value || "",
    choices: entries,
    quickChoices: entries.filter((entry) => !entry.current),
    other: { value: "other", label: "Other", source: "custom" },
  };
}

export function validateSourceTokenMeaningTarget(target) {
  const normalized = normalizeTarget(target);
  if (normalized?.target_type !== "source_token") return null;
  if (!normalized.target_id || !normalized.reference?.book_id || !normalized.token?.token_index) return null;
  return normalized;
}

function focusTrigger(trigger) {
  window.setTimeout(() => trigger?.focus?.({ preventScroll: true }), 0);
}

function candidateModel(state, target, token, sources) {
  const saved = getTokenRendering(state, target)?.rendering || "";
  return buildWordMeaningChoiceModel({
    savedRendering: saved,
    exactMappedEnglish: sources.exactMappedEnglish,
    english: token?.english,
    gloss: token?.gloss,
    lexiconShortDefinition: sources.lexicon?.short_definition,
    lexiconMeaning: sources.lexicon?.meaning,
  });
}

export function createWordMeaningControl({
  state,
  target,
  token = {},
  exactMappedEnglish = "",
  loadExactMappedEnglish = null,
  loadLexicon = null,
  label = "source token",
  onChange = null,
  presentation = "popover",
} = {}) {
  const sourceTarget = validateSourceTokenMeaningTarget(target);
  if (!state || !sourceTarget) return null;
  const contained = presentation === "detail-pane";

  const root = document.createElement("div");
  root.className = "word-meaning-control";
  root.dataset.targetId = sourceTarget.target_id;
  root.dataset.detailRestore = "word-meaning";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "word-meaning-trigger";
  trigger.textContent = "Meaning";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Choose a personal meaning for ${label}`);
  trigger.dataset.wordMeaningTargetId = sourceTarget.target_id;

  const badgeHost = document.createElement("span");
  badgeHost.className = "word-meaning-badge-host";

  const menu = document.createElement("div");
  const menuId = `word-meaning-${++meaningControlSequence}-${sourceTarget.target_id.replace(/[^a-z0-9_-]+/gi, "-")}`;
  menu.className = contained ? "word-meaning-contained" : "word-meaning-menu";
  if (contained) {
    trigger.setAttribute("aria-controls", "detailToolSurface");
  } else {
    menu.id = menuId;
    menu.hidden = true;
    menu.tabIndex = -1;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", `Personal meaning for ${label}`);
    trigger.setAttribute("aria-controls", menuId);
  }

  root.append(trigger, badgeHost);
  if (!contained) root.append(menu);

  const sources = {
    exactMappedEnglish: normalizeMeaningValue(exactMappedEnglish),
    lexicon: null,
  };
  let open = false;
  let editingCustom = false;
  let loadingExact = false;
  let loadingLexicon = false;
  let pendingChoiceFocus = null;
  const overlayOwner = {
    document,
    isConnected: () => root.isConnected && open,
    close: (options) => close(options),
  };

  const removeGlobalListeners = () => {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    window.removeEventListener("resize", positionMenu);
    window.removeEventListener("scroll", positionMenu, true);
  };

  const close = ({ restoreFocus = false, fromSurface = false, reason = "meaning-close" } = {}) => {
    if (contained && open && !fromSurface) {
      closeContainedDetailTool({ restoreFocus, reason });
      return;
    }
    deactivateOverlay(overlayOwner);
    if (!open) return;
    open = false;
    editingCustom = false;
    pendingChoiceFocus = null;
    if (!contained) menu.hidden = true;
    menu.replaceChildren();
    menu.style.removeProperty("left");
    menu.style.removeProperty("top");
    menu.style.removeProperty("width");
    trigger.setAttribute("aria-expanded", "false");
    removeGlobalListeners();
    if (!contained && restoreFocus) focusTrigger(trigger);
  };

  const notify = (record, action) => {
    onChange?.({ record, action, target: sourceTarget });
  };

  const refreshBadge = () => {
    const saved = getTokenRendering(state, sourceTarget)?.rendering || "";
    badgeHost.replaceChildren();
    if (!saved) return;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "word-meaning-badge";
    badge.textContent = saved;
    badge.title = `Edit personal meaning: ${saved}`;
    badge.setAttribute("aria-label", `Edit personal meaning ${saved} for ${label}`);
    badge.dataset.wordMeaningTargetId = sourceTarget.target_id;
    if (contained) {
      badge.setAttribute("aria-haspopup", "dialog");
      badge.setAttribute("aria-expanded", "false");
      badge.setAttribute("aria-controls", "detailToolSurface");
    }
    badge.addEventListener("click", () => openPicker(badge));
    badgeHost.append(badge);
  };

  const save = (value) => {
    const record = setTokenRendering(state, sourceTarget, value);
    if (record) notify(record, "saved");
    refreshBadge();
    return record;
  };

  const remove = () => {
    if (!deleteTokenRendering(state, sourceTarget)) return false;
    notify(null, "removed");
    refreshBadge();
    return true;
  };

  const showCustomEditor = () => {
    editingCustom = true;
    menu.replaceChildren();
    const title = document.createElement("h5");
    title.textContent = "Custom meaning";
    const hint = document.createElement("p");
    hint.className = "word-meaning-hint";
    hint.textContent = `Use up to ${CUSTOM_MEANING_MAX_LENGTH} characters. Nothing is saved until you choose Save.`;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "word-meaning-custom-input";
    input.maxLength = CUSTOM_MEANING_MAX_LENGTH;
    input.value = getTokenRendering(state, sourceTarget)?.rendering || "";
    input.setAttribute("aria-label", `Custom personal meaning for ${label}`);
    const status = document.createElement("p");
    status.className = "word-meaning-validation";
    status.hidden = true;
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "word-meaning-editor-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "mini-button word-meaning-save";
    saveButton.textContent = "Save";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "mini-button word-meaning-cancel";
    cancelButton.textContent = "Cancel";
    const submit = () => {
      const value = normalizeMeaningValue(input.value);
      if (!value) {
        status.hidden = false;
        status.textContent = "Enter a meaning before saving.";
        input.focus();
        return;
      }
      save(value);
      close({ restoreFocus: true });
    };
    saveButton.addEventListener("click", submit);
    cancelButton.addEventListener("click", () => close({ restoreFocus: true }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    actions.append(saveButton, cancelButton);
    menu.append(title, hint, input, status, actions);
    positionMenu();
    window.setTimeout(() => {
      if (open && input.isConnected) input.focus();
    }, 0);
  };

  const renderPicker = () => {
    if (!open || editingCustom) return;
    if (menu.contains(document.activeElement)) {
      const focusedControl = document.activeElement;
      pendingChoiceFocus = {
        kind: focusedControl?.classList?.contains("word-meaning-remove")
          ? "remove"
          : focusedControl?.classList?.contains("word-meaning-other")
            ? "other"
            : "option",
        source: focusedControl?.dataset?.source || "",
        value: focusedControl?.textContent || "",
      };
    }
    const model = candidateModel(state, sourceTarget, token, sources);
    menu.replaceChildren();
    const title = document.createElement("h5");
    title.textContent = "Personal meaning";
    const intro = document.createElement("p");
    intro.className = "word-meaning-hint";
    intro.textContent = "Choose a suggested meaning or add your own.";
    const choices = document.createElement("div");
    choices.className = "word-meaning-choices";
    if (!model.quickChoices.length) {
      const empty = document.createElement("p");
      empty.className = "word-meaning-empty";
      empty.textContent = "No suggested meanings are available for this token.";
      choices.append(empty);
    }
    model.quickChoices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "word-meaning-option";
      button.textContent = choice.value;
      button.dataset.source = choice.source;
      button.addEventListener("click", () => {
        save(choice.value);
        close({ restoreFocus: true });
      });
      choices.append(button);
    });
    const other = document.createElement("button");
    other.type = "button";
    other.className = "word-meaning-option word-meaning-other";
    other.textContent = model.other.label;
    other.addEventListener("click", showCustomEditor);
    choices.append(other);
    menu.append(title, intro, choices);
    if (model.saved) {
      const saved = document.createElement("div");
      saved.className = "word-meaning-saved-actions";
      const labelNode = document.createElement("span");
      labelNode.textContent = `Saved: ${model.saved}`;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "link-button compact-link word-meaning-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        if (remove()) close({ restoreFocus: true });
      });
      saved.append(labelNode, removeButton);
      menu.append(saved);
    }
    positionMenu();
    if (pendingChoiceFocus) {
      const focusIdentity = pendingChoiceFocus;
      const options = [...menu.querySelectorAll(".word-meaning-option")];
      const replacement = focusIdentity.kind === "remove"
        ? menu.querySelector(".word-meaning-remove")
        : focusIdentity.kind === "other"
          ? options.find((option) => option.classList.contains("word-meaning-other"))
          : options.find((option) => (
            option.dataset.source === focusIdentity.source && option.textContent === focusIdentity.value
          )) || options.find((option) => option.textContent === focusIdentity.value);
      if (replacement) {
        window.setTimeout(() => {
          if (!open || !replacement.isConnected) return;
          replacement.focus({ preventScroll: true });
          if (document.activeElement === replacement && pendingChoiceFocus === focusIdentity) {
            pendingChoiceFocus = null;
          }
        }, 0);
      }
    }
  };

  function onOutsidePointerDown(event) {
    if (!isActiveOverlay(overlayOwner)) return;
    if (!root.contains(event.target)) close();
  }

  function positionMenu() {
    if (contained) return;
    if (!root.isConnected) {
      close();
      return;
    }
    if (!open || menu.hidden) return;
    const gutter = 12;
    const width = Math.min(340, Math.max(0, window.innerWidth - gutter * 2));
    const triggerBounds = trigger.getBoundingClientRect();
    menu.style.width = `${width}px`;
    const height = menu.getBoundingClientRect().height;
    const maxLeft = Math.max(gutter, window.innerWidth - width - gutter);
    const left = Math.min(Math.max(gutter, triggerBounds.right - width), maxLeft);
    let top = triggerBounds.bottom + 6;
    if (top + height > window.innerHeight - gutter) {
      top = Math.max(gutter, triggerBounds.top - height - 6);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  const loadCandidates = () => {
    if (typeof loadExactMappedEnglish === "function" && !loadingExact && !sources.exactMappedEnglish) {
      loadingExact = true;
      Promise.resolve(loadExactMappedEnglish())
        .then((value) => {
          sources.exactMappedEnglish = normalizeMeaningValue(value);
          if (open) renderPicker();
        })
        .catch(() => {})
        .finally(() => {
          loadingExact = false;
        });
    }
    if (typeof loadLexicon === "function" && !loadingLexicon && !sources.lexicon) {
      loadingLexicon = true;
      Promise.resolve(loadLexicon())
        .then((entry) => {
          sources.lexicon = entry && typeof entry === "object" ? entry : null;
          if (open) renderPicker();
        })
        .catch(() => {})
        .finally(() => {
          loadingLexicon = false;
        });
    }
  };

  const openPicker = (opener = trigger) => {
    if (open) {
      close({ restoreFocus: contained, reason: "meaning-toggle" });
      return;
    }
    open = true;
    editingCustom = false;
    trigger.setAttribute("aria-expanded", "true");
    if (!contained) menu.hidden = false;
    renderPicker();
    if (contained) {
      const focusRegion = root.closest("#detailContext") ? "context" : "content";
      const opened = openContainedDetailTool({
        kind: "meaning",
        title: "Meaning",
        targetId: sourceTarget.target_id,
        content: menu,
        trigger: opener,
        initialFocus: ".word-meaning-option, .word-meaning-remove, .word-meaning-custom-input",
        resolveTrigger: () => {
          const matches = [...document.querySelectorAll("button[data-word-meaning-target-id]")]
            .filter((node) => node.dataset.wordMeaningTargetId === sourceTarget.target_id && node.isConnected);
          return matches.find((node) => Boolean(node.closest("#detailContext")) === (focusRegion === "context")) || matches[0] || null;
        },
        focusFallback: () => document.querySelector("#clearDetail"),
        onClose: () => close({ fromSurface: true }),
      });
      if (!opened) {
        close({ fromSurface: true });
        return;
      }
    } else {
      activateOverlay(overlayOwner);
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
      window.addEventListener("resize", positionMenu);
      window.addEventListener("scroll", positionMenu, true);
    }
    loadCandidates();
  };

  trigger.addEventListener("click", () => openPicker(trigger));
  root.addEventListener("detail:restore", () => {
    close();
    refreshBadge();
  });
  refreshBadge();
  return root;
}
