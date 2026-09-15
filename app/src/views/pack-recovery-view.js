import { PHYSICAL_DATA_MODES } from "../physical-pack-contract.js";

// Stable is not a pack-management console. Preserve an escape from an existing
// managed mode without exposing new installations or deleting the stored copies.
export function renderPackRecovery(ctx) {
  const mode = ctx.state.physicalDataMode || ctx.state.packageStore?.physical_data_mode;
  if (mode !== PHYSICAL_DATA_MODES.managed) return null;
  const manager = ctx.state.physicalPackManager;
  const section = document.createElement("section");
  section.className = "diagnostic-section pack-recovery";
  const heading = document.createElement("h4");
  heading.textContent = "Reading data";
  const explanation = document.createElement("p");
  explanation.textContent = "This profile uses separately saved study files. You can return to the data included with the app without deleting your notes or those files.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = "Use included data";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  button.disabled = typeof manager?.setMode !== "function";
  if (button.disabled) status.textContent = "The saved-file service is unavailable. Download a study backup before retrying.";
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "Switching reading data…";
    try {
      await manager.setMode(PHYSICAL_DATA_MODES.bundled);
      if (manager.snapshot().mode !== PHYSICAL_DATA_MODES.bundled) throw new Error("Mode change not confirmed");
      status.textContent = "Using included study data. Your notes and separately saved files were kept.";
      button.textContent = "Included data in use";
    } catch {
      status.textContent = "Could not switch reading data. No saved files were deleted. Try again.";
      button.disabled = false;
    }
  });
  section.append(heading, explanation, button, status);
  return section;
}
