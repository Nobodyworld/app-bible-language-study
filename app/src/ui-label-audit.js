// Deterministic helpers for tests and browser-agent spot checks; not an app UI.
const normalized = (value) => String(value || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export function duplicateScopedLabels(items) {
  const seen = new Set();
  const duplicates = [];
  for (const { scope, label } of items) {
    const name = normalized(label);
    if (!name) continue;
    const key = `${scope}\n${name}`;
    if (seen.has(key)) duplicates.push({ scope, label: name });
    seen.add(key);
  }
  return duplicates;
}

export function auditStudyControls(root = document) {
  const ids = new Set();
  const duplicateIds = [];
  for (const node of root.querySelectorAll("[id]")) {
    if (!node.id) continue;
    if (ids.has(node.id)) duplicateIds.push(node.id);
    ids.add(node.id);
  }
  const visible = (node) => node.getClientRects().length > 0
    && getComputedStyle(node).visibility !== "hidden" && !node.closest("[hidden], [inert]");
  const labels = [];
  const emptyNames = [];
  [...root.querySelectorAll(".panel-context-group")].forEach((group, index) => {
    if (!visible(group)) return;
    const scope = `${index}:${group.dataset.panelScope}`;
    const caption = group.querySelector(".panel-context-scope-label");
    if (caption && visible(caption)) labels.push({ scope, label: caption.textContent });
    for (const button of group.querySelectorAll(".verse-context-tab, .word-meaning-trigger, .study-marks-trigger")) {
      if (!visible(button)) continue;
      const label = button.textContent.trim() || button.getAttribute("aria-label") || "";
      if (!normalized(label)) emptyNames.push({ scope, action: button.dataset.panelAction || button.className });
      else labels.push({ scope, label });
    }
  });
  return { duplicateIds, duplicateLabels: duplicateScopedLabels(labels), emptyNames };
}
