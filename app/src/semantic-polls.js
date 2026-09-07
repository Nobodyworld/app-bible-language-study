const DEFAULT_ACTOR = { actor_type: "user", actor_id: "user:local" };

// Passive version-3 backup compatibility. Never consult a seed catalog or
// generate a new response/event while reading historical opinions.
export function normalizePollResponse(response) {
  if (!response?.id || !response.proposition_id || !response.response) return null;
  const timestamp = response.updated_at || response.created_at || new Date().toISOString();
  return {
    ...response,
    schema_version: Number(response.schema_version || 1),
    proposition_version: Number(response.proposition_version || 1),
    actor: response.actor || DEFAULT_ACTOR,
    confidence: Number.isFinite(response.confidence) ? response.confidence : 1,
    status: response.status || "active",
    visibility: response.visibility || "private",
    viewed_aggregate_before_response: Boolean(response.viewed_aggregate_before_response),
    created_at: response.created_at || timestamp,
    updated_at: timestamp,
    supersedes: response.supersedes || null,
  };
}

export function aggregatePollResponses(responses = {}) {
  // A disposable local projection of retained records, not community statistics.
  const aggregates = {};
  Object.values(responses || {}).forEach((response) => {
    const normalized = normalizePollResponse(response);
    if (!normalized) return;
    if (normalized.status === "deleted") return;
    const aggregateId = `${normalized.proposition_id}@v${normalized.proposition_version}`;
    const aggregate = aggregates[aggregateId] || {
      proposition_id: normalized.proposition_id,
      proposition_version: normalized.proposition_version,
      sample_size: 0,
      responses: {},
      visibility: "local_private",
      collection_scope: "current_user_export",
    };
    aggregate.sample_size += 1;
    // Historical answers are arbitrary strings, including object-property names.
    const count = Object.hasOwn(aggregate.responses, normalized.response) ? aggregate.responses[normalized.response] : 0;
    aggregate.responses = { ...aggregate.responses, [normalized.response]: count + 1 };
    aggregates[aggregateId] = aggregate;
  });
  return aggregates;
}
