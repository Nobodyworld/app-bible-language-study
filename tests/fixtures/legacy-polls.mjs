import { readFileSync } from "node:fs";

// Exact retired seed metadata is test-owned and excluded from production staging.
export const historicalPropositions = JSON.parse(readFileSync(
  new URL("./legacy-polls/interpretation-propositions.json", import.meta.url), "utf8",
)).propositions;

export function historicalPollStore() {
  const timestamp = "2025-01-01T00:00:00.000Z";
  const ids = [
    "poll-response:john-1-1-logos-eternal-existence:v1:user.local",
    "poll-response:genesis-1-1-definite-creation-beginning:v1:user.local",
    "poll-response:proverbs-1-7-knowledge-wisdom-foundation:v1:user.local",
  ];
  const records = historicalPropositions.map((proposition, index) => ({
    id: ids[index], schema_version: 1,
    proposition_id: proposition.id, proposition_version: proposition.version,
    proposition_target: structuredClone(proposition.target),
    actor: { actor_type: "user", actor_id: "user:local", extension: { retained: true } },
    response: "agree", status: "active", confidence: 0.8, visibility: "private",
    viewed_aggregate_before_response: false, created_at: timestamp, updated_at: timestamp,
    supersedes: null, extension: { nested: [index, { retained: true }] },
  }));
  records[0] = {
    ...records[0], status: "deleted", deleted_at: timestamp, deletion_policy: "tombstone",
    previous_response: "uncertain", supersedes: records[0].id,
  };
  records.push({
    ...structuredClone(records[1]), id: "poll-response:genesis-1-1-definite-creation-beginning:v2:user.archive",
    proposition_version: 2, response: "uncertain", visibility: "shared",
    viewed_aggregate_before_response: true,
    actor: { actor_type: "user", actor_id: "user:archive", extension: { retained: true } },
  });
  records.push({
    ...structuredClone(records[2]), id: "poll-response:unlisted-proposition:v7:user.archive",
    proposition_id: "proposition:unlisted-proposition", proposition_version: 7,
    response: "qualified_assent", visibility: "public",
    proposition_target: { ...records[2].proposition_target, extension: { retained: true } },
  });
  return {
    version: 1,
    responses: Object.fromEntries(records.map((record) => [record.id, record])),
    events: Array.from({ length: 605 }, (_, index) => {
      const record = records[index % records.length];
      return {
        id: `event:poll-response:historical:${index}`, schema_version: 1,
        event_type: ["poll_response_created", "poll_response_updated", "poll_response_deleted", "historical_extension"][index % 4],
        response_id: record.id, proposition_id: record.proposition_id,
        proposition_version: record.proposition_version, actor: structuredClone(record.actor),
        created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        extension: { historical_response: record.response, retained: [index] },
      };
    }),
    aggregates: { obsolete: { sample_size: 9999 } },
    extension: { historical_store: true },
  };
}
