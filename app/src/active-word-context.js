const ACTIVE_WORD_CONTEXT_KEY = "activeWord";

function normalizedContext(context) {
  if (!context?.token) return null;
  const { invoker: _invoker, ...storedOptions } = context.options || {};
  return {
    token: context.token,
    options: {
      ...storedOptions,
      forceHistory: false,
    },
  };
}

export function setActiveWordContext(ctx, context) {
  if (!ctx) return null;
  const next = normalizedContext(context);
  const studyContext = ctx.studyContext && typeof ctx.studyContext === "object" ? ctx.studyContext : {};
  if (next) {
    studyContext[ACTIVE_WORD_CONTEXT_KEY] = next;
  } else {
    delete studyContext[ACTIVE_WORD_CONTEXT_KEY];
  }
  ctx.studyContext = studyContext;
  return next;
}

export function getActiveWordContext(ctx, verse = null) {
  const context = ctx?.studyContext?.[ACTIVE_WORD_CONTEXT_KEY] || null;
  if (!context?.token) return null;
  const contextVerse = context.options?.verseContext?.verse;
  if (verse != null && contextVerse != null && String(contextVerse) !== String(verse)) return null;
  return context;
}

export function clearActiveWordContext(ctx) {
  if (!ctx?.studyContext || typeof ctx.studyContext !== "object") return;
  delete ctx.studyContext[ACTIVE_WORD_CONTEXT_KEY];
}
