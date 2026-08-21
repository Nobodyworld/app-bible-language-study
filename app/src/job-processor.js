import { JOB_TYPES } from "./config.js?v=pr13-live-qa-20260711e";
import { fetchWordMapBook } from "./data-service.js?v=pr13-live-qa-20260711e";
import { parseReferenceKey, referenceKeyFromTarget, targetId } from "./semantic-targets.js?v=pr13-live-qa-20260711e";

const PROCESSOR_VERSIONS = {
  [JOB_TYPES.tagIndexRefresh]: "tag-index-refresh-v1",
  [JOB_TYPES.inquiryAnalysis]: "inquiry-analysis-v1",
  [JOB_TYPES.translationEditAnalysis]: "translation-edit-analysis-v1",
  [JOB_TYPES.personalGlossaryBuild]: "personal-glossary-build-v1",
  [JOB_TYPES.wordMapRefresh]: "word-map-refresh-v1",
};

function nowIso() {
  return new Date().toISOString();
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function wordMapRowsForReference(wordMapBook, reference) {
  return wordMapBook?.chapters?.[String(reference.chapter)]?.[String(reference.verse)] || [];
}

function normalizeWordMapSpan(row) {
  return {
    strong_token_index: row?.[0] ?? null,
    source_token_index: row?.[1] ?? null,
    start_offset: row?.[2] ?? null,
    end_offset: row?.[3] ?? null,
    strong_code: row?.[4] || null,
    language: row?.[5] || null,
  };
}

function resolveReference(payload = {}) {
  const referenceKey = payload.reference_key || payload.target?.reference_key;
  if (referenceKey) {
    const parsed = parseReferenceKey(referenceKey);
    return {
      reference_key: referenceKey,
      book_id: parsed.book_id,
      chapter: numericOrNull(parsed.chapter),
      verse: numericOrNull(parsed.verse),
    };
  }

  const ref = payload.target?.reference || payload.reference || {};
  if (!ref.book_id || !ref.chapter || !(ref.verse_start || ref.verse)) return null;
  const verse = ref.verse_start || ref.verse;
  return {
    reference_key: `${ref.book_id}:${ref.chapter}:${verse}`,
    book_id: ref.book_id,
    chapter: numericOrNull(ref.chapter),
    verse: numericOrNull(verse),
  };
}

function tokenRenderingRows(workspaceStore, referenceKey) {
  return Object.entries(workspaceStore?.token_renderings?.[referenceKey] || {})
    .map(([tokenIndex, rendering]) => ({
      token_index: numericOrNull(tokenIndex),
      strong_code: rendering?.strong_code || null,
      original: rendering?.original || "",
      rendering: rendering?.rendering || "",
      updated_at: rendering?.updated_at || null,
    }))
    .sort((a, b) => (a.token_index || 0) - (b.token_index || 0));
}

function resultEnvelope(job, fields) {
  const timestamp = fields.completed_at || nowIso();
  const jobType = job?.type || job?.job_type;
  const processor = PROCESSOR_VERSIONS[jobType] || `${jobType || "unknown"}-v1`;
  return {
    processor,
    processor_version: processor,
    runner: processor,
    job_type: jobType,
    input_target: fields.input_target || job?.payload?.target || null,
    input_revision_id: fields.input_revision_id || job?.payload?.input_revision_id || null,
    status: fields.status || "completed",
    result_status: fields.result_status || "current",
    started_at: fields.started_at || timestamp,
    completed_at: timestamp,
    processed_at: timestamp,
    findings: Array.isArray(fields.findings) ? fields.findings : [],
    confidence: Number.isFinite(fields.confidence) ? fields.confidence : null,
    ...fields,
  };
}

function referenceRevisionId(state, referenceKey) {
  const draft = state.workspaceStore?.verse_drafts?.[referenceKey];
  if (!draft) return null;
  return `translation-draft:${referenceKey}:r${Number(draft.revision || 0)}`;
}

export async function analyzeTagIndexRefreshJob(job, state) {
  const tagId = job?.payload?.tag_id || null;
  const activeAssertions = Object.values(state.tagStore?.tag_assertions || {}).filter((assertion) => {
    if (!assertion?.active) return false;
    if (tagId && assertion.tag_id !== tagId) return false;
    return true;
  });
  const byReference = {};
  activeAssertions.forEach((assertion) => {
    const key = assertion.reference_key || referenceKeyFromTarget(assertion.target) || assertion.target_id || "unknown";
    byReference[key] = byReference[key] || [];
    byReference[key].push(assertion.id);
  });

  return resultEnvelope(job, {
    input_target: tagId ? { target_type: "tag_definition", tag_id: tagId } : null,
    result_status: "derived_index_current",
    findings: [
      {
        finding_type: "derived_tag_index",
        tag_id: tagId,
        active_assertion_count: activeAssertions.length,
        reference_count: Object.keys(byReference).length,
        disposable_projection: true,
        mutates_assertions: false,
      },
    ],
    confidence: 1,
    derived_index: {
      tag_id: tagId,
      references: Object.fromEntries(
        Object.entries(byReference)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([referenceKey, assertionIds]) => [referenceKey, assertionIds.sort()]),
      ),
    },
  });
}

export async function analyzeInquiryJob(job) {
  const target = job?.payload?.target || null;
  const canonicalTargetId = targetId(target);
  if (!canonicalTargetId) {
    throw new Error("inquiry-analysis requires a complete supported target.");
  }
  const referenceKey = referenceKeyFromTarget(target);
  const sourceToken = target.target_type === "source_token" ? target.token : null;
  const sourceTokenSpan = target.target_type === "source_token_span" ? target.token_span : null;
  const selectedText = target.target_type === "text_span" ? target.anchor?.text_snapshot || "" : "";
  const missingInputs = [];
  if (!referenceKey && !["book", "chapter"].includes(target.target_type)) {
    missingInputs.push("verse_reference");
  }
  if (target.target_type === "source_token" && !sourceToken?.strong_code) {
    missingInputs.push("strong_code");
  }

  return resultEnvelope(job, {
    input_target: target,
    input_revision_id: job?.payload?.input_revision_id || null,
    result_status: missingInputs.length ? "needs_review" : "foundation_complete",
    inquiry_profile: {
      type: "unknown",
      question_text: String(job?.payload?.question_text || ""),
      requires_user_clarification: !String(job?.payload?.question_text || "").trim(),
    },
    source_language_summary: sourceToken
      ? {
          token_index: sourceToken.token_index,
          strong_code: sourceToken.strong_code,
          language: sourceToken.language,
          original: sourceToken.original,
        }
      : sourceTokenSpan
        ? {
            token_start: sourceTokenSpan.token_start,
            token_end: sourceTokenSpan.token_end,
            strong_codes: sourceTokenSpan.strong_codes,
            language: sourceTokenSpan.language,
            source_snapshots: sourceTokenSpan.source_snapshots,
          }
        : null,
    english_rendering_summary: selectedText ? { selected_text: selectedText } : null,
    findings: missingInputs.map((input) => ({
      finding_type: "inquiry_input_missing",
      input,
      severity: "warning",
      confidence: 1,
    })),
    confidence: missingInputs.length ? 0.5 : 0.75,
    missing_inputs: missingInputs,
    graph_patch: {
      schema_version: 1,
      nodes: [
        {
          id: canonicalTargetId,
          type: target.target_type,
          target,
        },
        {
          id: `inquiry:${job.payload.assertion_id}`,
          type: "inquiry",
          assertion_id: job.payload.assertion_id,
        },
      ],
      edges: [
        {
          id: `edge:inquiry:${job.payload.assertion_id}:asks_about`,
          type: "asks_about",
          from: `inquiry:${job.payload.assertion_id}`,
          to: canonicalTargetId,
        },
      ],
    },
  });
}

export async function analyzeTranslationEditJob(job, state) {
  const reference = resolveReference(job?.payload);
  if (!reference?.reference_key) {
    throw new Error("translation-edit-analysis requires a verse reference target.");
  }
  const draft = state.workspaceStore?.verse_drafts?.[reference.reference_key] || null;
  const renderings = tokenRenderingRows(state.workspaceStore, reference.reference_key);
  const redLetterRanges = state.workspaceStore?.red_letter_ranges?.[reference.reference_key] || [];
  const draftText = String(draft?.draft_text || "");
  const findings = [];

  if (!draftText.trim()) {
    findings.push({
      finding_type: "source_token_lost",
      severity: "warning",
      message: "No draft text is present for the affected verse.",
      affected_token_indexes: renderings.map((item) => item.token_index).filter((value) => value !== null),
      confidence: 0.7,
    });
  }
  renderings
    .filter((item) => !String(item.rendering || "").trim())
    .forEach((item) => {
      findings.push({
        finding_type: "ambiguous_alignment",
        severity: "warning",
        token_index: item.token_index,
        strong_code: item.strong_code,
        message: "A source token has no preferred rendering.",
        confidence: 0.65,
      });
    });
  renderings
    .filter((item) => item.strong_code && job?.payload?.strong_code && item.strong_code !== job.payload.strong_code)
    .forEach((item) => {
      findings.push({
        finding_type: "strongs_correspondence_changed",
        severity: "info",
        token_index: item.token_index,
        previous_strong_code: job.payload.strong_code,
        current_strong_code: item.strong_code,
        confidence: 0.75,
      });
    });
  redLetterRanges
    .filter((range) => Number(range.end) > draftText.length)
    .forEach((range) => {
      findings.push({
        finding_type: "speech_range_mismatch",
        severity: "warning",
        range,
        draft_text_length: draftText.length,
        confidence: 0.85,
      });
    });
  if (job?.payload?.manual_alignment_id && draft?.updated_at) {
    findings.push({
      finding_type: "manual_alignment_invalidated",
      severity: "info",
      manual_alignment_id: job.payload.manual_alignment_id,
      draft_revision: Number(draft.revision || 0),
      confidence: 0.8,
    });
  }

  return resultEnvelope(job, {
    input_target: { target_type: "verse", reference },
    input_revision_id: referenceRevisionId(state, reference.reference_key),
    result_status: findings.some((item) => item.severity === "warning") ? "needs_review" : "current",
    findings,
    confidence: findings.length ? Math.min(...findings.map((item) => item.confidence || 1)) : 1,
    reference,
    workspace_inputs: {
      has_draft: Boolean(draftText.trim()),
      draft_revision: Number(draft?.revision || 0),
      token_rendering_count: renderings.length,
      red_letter_range_count: redLetterRanges.length,
    },
  });
}

export async function analyzePersonalGlossaryJob(job, state) {
  const reference = resolveReference(job?.payload);
  const referenceKey = reference?.reference_key || job?.payload?.reference_key || null;
  const renderings = referenceKey ? tokenRenderingRows(state.workspaceStore, referenceKey) : [];
  const strongCode = job?.payload?.strong_code || null;
  const relevantRenderings = strongCode ? renderings.filter((item) => item.strong_code === strongCode) : renderings;
  const entries = relevantRenderings.map((item) => {
    const observed = String(item.rendering || "").trim();
    return {
      strong_code: item.strong_code,
      source_token_index: item.token_index,
      original: item.original,
      lexicon_gloss: null,
      observed_draft_rendering: observed || null,
      user_preferred_rendering: observed || null,
      generated_candidate: observed || item.original || null,
      accepted_entry: false,
    };
  });

  return resultEnvelope(job, {
    input_target: strongCode
      ? { target_type: "source_token_glossary", strong_code: strongCode, reference_key: referenceKey }
      : { target_type: "personal_glossary", reference_key: referenceKey },
    input_revision_id: referenceKey ? referenceRevisionId(state, referenceKey) : null,
    result_status: entries.length ? "candidate_generated" : "no_candidates",
    findings: entries.map((entry) => ({
      finding_type: "personal_glossary_candidate",
      strong_code: entry.strong_code,
      generated_candidate: entry.generated_candidate,
      accepted_entry: false,
      confidence: entry.generated_candidate ? 0.7 : 0.4,
    })),
    confidence: entries.length ? 0.7 : 0.4,
    glossary_candidates: entries,
  });
}

export async function analyzeWordMapRefreshJob(job, state, options = {}) {
  const reference = resolveReference(job?.payload);
  if (!reference?.book_id || !reference.chapter || !reference.verse) {
    throw new Error("word-map-refresh requires a verse reference target.");
  }

  const translationId = job?.payload?.translation_id || "bsb";
  const loadWordMapBook = options.loadWordMapBook || fetchWordMapBook;
  const wordMapBook = await loadWordMapBook(translationId, reference.book_id);
  if (!wordMapBook) {
    throw new Error(`No word-map shard found for ${translationId}/${reference.book_id}.`);
  }

  const spans = wordMapRowsForReference(wordMapBook, reference).map(normalizeWordMapSpan);
  const renderings = tokenRenderingRows(state.workspaceStore, reference.reference_key);
  const draft = state.workspaceStore?.verse_drafts?.[reference.reference_key] || null;
  const affectedTokenIndexes = new Set([
    ...renderings.map((item) => item.token_index).filter((value) => value !== null),
    numericOrNull(job?.payload?.token_index),
  ].filter((value) => value !== null));
  const affectedSpans = spans.filter((span) => affectedTokenIndexes.has(Number(span.strong_token_index)));

  return resultEnvelope(job, {
    input_target: { target_type: "verse", reference },
    input_revision_id: referenceRevisionId(state, reference.reference_key),
    result_status: "current",
    findings: affectedSpans.map((span) => ({
      finding_type: "word_map_existing_span_affected",
      strong_token_index: span.strong_token_index,
      source_token_index: span.source_token_index,
      strong_code: span.strong_code,
      confidence: 0.9,
    })),
    confidence: affectedSpans.length ? 0.9 : 1,
    reference,
    translation_id: translationId,
    source: job?.payload?.source || "workspace",
    packaged_word_map: {
      book_id: wordMapBook.book?.id || reference.book_id,
      schema_version: wordMapBook.schema_version || null,
      span_schema: wordMapBook.span_schema || [],
      existing_spans_for_verse: spans.length,
      affected_existing_spans: affectedSpans.length,
    },
    workspace_inputs: {
      has_draft: Boolean(draft?.draft_text),
      draft_text_length: String(draft?.draft_text || "").length,
      token_rendering_count: renderings.length,
      affected_token_indexes: [...affectedTokenIndexes].sort((a, b) => a - b),
    },
    proposed_refresh: {
      mode: "local_user_overlay",
      canonical_data_mutation: false,
      reason:
        "The browser job processor records the user-edit analysis result. Packaged canonical word-map shards remain generated by scripts.",
      token_renderings: renderings,
      affected_spans: affectedSpans,
    },
  });
}

export function canRunJob(job) {
  return Boolean(PROCESSOR_VERSIONS[job?.type || job?.job_type]);
}

export async function runJob(job, state, options = {}) {
  if (!canRunJob(job)) {
    throw new Error(`No runtime processor is registered for ${job?.type || job?.job_type || "unknown job"}.`);
  }
  const type = job?.type || job?.job_type;
  if (type === JOB_TYPES.tagIndexRefresh) return analyzeTagIndexRefreshJob(job, state, options);
  if (type === JOB_TYPES.inquiryAnalysis) return analyzeInquiryJob(job, state, options);
  if (type === JOB_TYPES.translationEditAnalysis) return analyzeTranslationEditJob(job, state, options);
  if (type === JOB_TYPES.personalGlossaryBuild) return analyzePersonalGlossaryJob(job, state, options);
  return analyzeWordMapRefreshJob(job, state, options);
}
