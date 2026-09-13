import { loadedStyles } from "../../app/tools/stylesheet-ownership.mjs";

// Source-shape contracts inspect the actual cascade. The ownership guard checks
// which file may declare structure, so these tests do not preserve retired paths.
export async function readAppStyles() {
  return (await loadedStyles()).map(sheet => sheet.source).join("\n");
}
