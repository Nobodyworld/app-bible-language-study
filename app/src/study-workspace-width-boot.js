(function applyStoredStudyWorkspaceWidth() {
  const allowed = new Set(["compact", "standard", "expanded"]);
  let mode = "standard";
  try {
    const stored = window.localStorage.getItem("bibleapp:study-workspace-width:v1");
    if (allowed.has(stored)) mode = stored;
  } catch {
    // The default remains usable when browser storage is unavailable.
  }
  document.documentElement.setAttribute("data-study-workspace-width", mode);
})();
