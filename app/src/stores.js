import { DEFAULT_TAGS, STORAGE_KEYS } from "./config.js?v=pr13-live-qa-20260711e";
import {
  createBrowserUserStorageAdapter,
  createMemoryUserStorageAdapter,
  USER_STORE_NAMES,
} from "./platform/browser-user-storage.js";
import {
  createSourceTokenTarget,
  createVerseTarget,
  createTagAssertion,
  deriveTagTargetIndex,
  deriveVerseTagsFromAssertions,
  legacyTagId,
  normalizeTagAssertionCollection,
  referenceKeyFromTarget,
  tagAssertionId,
  tagDefinitionId,
  normalizeTarget,
} from "./semantic-targets.js?v=pr13-live-qa-20260711e";
import { aggregatePollResponses, normalizePollResponse } from "./semantic-polls.js";
import { createDefaultPackageStore, normalizePackageStore } from "./package-state.js";

const USER_DATA_EXPORT_KIND = "bibleapp:user-data";
const USER_DATA_EXPORT_VERSION = 3;
const LEGACY_APP_PREFIX = `${["open", "bible"].join("")}-clean-app`;
const LEGACY_USER_DATA_EXPORT_KINDS = new Set([`${LEGACY_APP_PREFIX}:user-data`]);
const JOB_STATES = new Set(["planned", "queued", "running", "completed", "failed", "cancelled", "simulation_only"]);
const LEGACY_JOB_STATUS_TO_STATE = {
  pending: "queued",
  reviewed: "planned",
  processed: "simulation_only",
};
let userStorageAdapter = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function nextRevision(current) {
  return Number(current?.revision || 0) + 1;
}

function appendConflict(store, conflict) {
  store.conflicts = [...(Array.isArray(store.conflicts) ? store.conflicts : []), conflict].slice(-100);
  return conflict;
}

function resolveUserStorageAdapter() {
  if (userStorageAdapter) return userStorageAdapter;
  userStorageAdapter = globalThis.window
    ? createBrowserUserStorageAdapter({ profileId: "stable", windowObject: globalThis.window })
    : createMemoryUserStorageAdapter();
  return userStorageAdapter;
}

export function configureUserStorageAdapter(adapter) {
  if (!adapter || typeof adapter.initialize !== "function" || typeof adapter.save !== "function") {
    throw new Error("A user-storage adapter with initialize() and save() is required.");
  }
  userStorageAdapter = adapter;
  return userStorageAdapter;
}

function loadStorage(key, fallback) {
  const storeName = storeNameForStorageKey(key);
  return storeName ? resolveUserStorageAdapter().readCurrent(storeName, fallback) : clone(fallback);
}

function loadStorageWithLegacy(key, _legacyKey, fallback) {
  return loadStorage(key, fallback);
}

function saveStorage(key, value) {
  const storeName = storeNameForStorageKey(key);
  if (storeName) resolveUserStorageAdapter().save(storeName, value);
}

function storeNameForStorageKey(key) {
  if (key === STORAGE_KEYS.tags) return USER_STORE_NAMES.tags;
  if (key === STORAGE_KEYS.workspace) return USER_STORE_NAMES.workspace;
  if (key === STORAGE_KEYS.assertions) return USER_STORE_NAMES.assertions;
  if (key === STORAGE_KEYS.polls) return USER_STORE_NAMES.polls;
  if (key === STORAGE_KEYS.packages) return USER_STORE_NAMES.packages;
  if (key === STORAGE_KEYS.importBackups) return USER_STORE_NAMES.importBackups;
  return null;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#4f6f91";
}

function normalizeIcon(value) {
  const icon = String(value || "").trim();
  return icon ? icon.slice(0, 3) : "*";
}

function createDefaultTagStore() {
  return {
    version: 4,
    tags: Object.fromEntries(DEFAULT_TAGS.map((tag) => [tag.id, normalizeTagDefinition(tag)])),
    verse_tags: {},
    tag_assertions: {},
    tag_target_index: {},
    quarantined_records: [],
    conflicts: [],
    job_events: [],
  };
}

function createDefaultWorkspaceStore() {
  return {
    version: 3,
    verse_drafts: {},
    token_renderings: {},
    red_letter_ranges: {},
    conflicts: [],
    job_events: [],
  };
}

function createDefaultAssertionStore() {
  return {
    version: 1,
    assertions: {},
    events: [],
    quarantined_records: [],
  };
}

function createDefaultPollStore() {
  return {
    version: 1,
    responses: {},
    events: [],
    aggregates: {},
  };
}

function createDefaultLocalPackageStore() {
  return createDefaultPackageStore();
}

function normalizeTagDefinition(tag = {}) {
  const id = String(tag.id || "").trim();
  const label = String(tag.label || id || "Tag").trim();
  return {
    ...tag,
    id,
    tag_definition_id: tag.tag_definition_id || tagDefinitionId(id),
    schema_version: Number(tag.schema_version || 1),
    namespace: tag.namespace || (tag.custom ? "user" : "system"),
    label,
    description: String(tag.description || "").trim(),
    category: tag.category || "reader_classification",
    allowed_target_types: Array.isArray(tag.allowed_target_types)
      ? tag.allowed_target_types
      : ["verse", "verse_range", "text_span", "source_token", "source_token_span"],
    display_behavior: tag.display_behavior || "custom_manual",
    on_apply_job_type: tag.on_apply_job_type || null,
    status: tag.status || "active",
    retired_at: tag.retired_at || null,
    replacement_id: tag.replacement_id || null,
    revision: Number(tag.revision || 1),
  };
}

function normalizeJobEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event && typeof event === "object" && event.id && (event.type || event.job_type))
    .map((event) => {
      const state = JOB_STATES.has(event.state)
        ? event.state
        : JOB_STATES.has(event.status) ? event.status : LEGACY_JOB_STATUS_TO_STATE[event.status] || "queued";
      return {
        ...event,
        schema_version: Number(event.schema_version || 1),
        job_type: event.job_type || event.type,
        type: event.type || event.job_type,
        state,
        status: state,
        updated_at: event.updated_at || event.processed_at || event.reviewed_at || event.created_at || nowIso(),
      };
    });
}

export function normalizeTagStore(value = {}) {
  const fallback = createDefaultTagStore();
  const store = { ...fallback, ...(value || {}) };
  store.tags = {
    ...Object.fromEntries(Object.entries(store.tags || {}).map(([id, tag]) => [id, normalizeTagDefinition(tag)])),
    ...fallback.tags,
  };
  store.verse_tags = store.verse_tags && typeof store.verse_tags === "object" ? store.verse_tags : {};
  const normalizedAssertions = normalizeTagAssertionCollection(store.verse_tags, store.tag_assertions);
  store.tag_assertions = normalizedAssertions.assertions;
  store.verse_tags = deriveVerseTagsFromAssertions(store.tag_assertions);
  store.tag_target_index = deriveTagTargetIndex(store.tag_assertions);
  store.quarantined_records = [
    ...(Array.isArray(store.quarantined_records) ? store.quarantined_records : []),
    ...normalizedAssertions.quarantined.map((item) => ({ ...item, quarantined_at: nowIso() })),
  ].slice(-200);
  store.conflicts = Array.isArray(store.conflicts) ? store.conflicts.slice(-100) : [];
  store.job_events = normalizeJobEvents(store.job_events);
  store.version = fallback.version;
  // Historical job metadata is passive backup data; no processors are available.
  return store;
}

function normalizeWorkspaceStore(value = {}) {
  const fallback = createDefaultWorkspaceStore();
  const store = { ...fallback, ...(value || {}) };
  store.verse_drafts = store.verse_drafts && typeof store.verse_drafts === "object" ? store.verse_drafts : {};
  store.token_renderings = normalizeTokenRenderingCollection(store.token_renderings);
  store.red_letter_ranges =
    store.red_letter_ranges && typeof store.red_letter_ranges === "object" ? store.red_letter_ranges : {};
  store.conflicts = Array.isArray(store.conflicts) ? store.conflicts.slice(-100) : [];
  store.job_events = normalizeJobEvents(store.job_events);
  store.version = fallback.version;
  // Historical job metadata is passive backup data; no processors are available.
  return store;
}

function positiveTokenIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index > 0 ? index : null;
}

function normalizeRenderingText(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function sourceTokenTargetForRendering(record = {}, options = {}) {
  const referenceKey = String(options.reference_key || record.reference_key || "").trim();
  const tokenIndex = positiveTokenIndex(options.token_index ?? record.token_index);
  const fallbackTranslation = options.translation_id || record.translation_id || record.target?.translation_id || "bsb";
  const supplied = normalizeTarget(options.target || record.target);
  if (
    supplied?.target_type === "source_token" &&
    (!referenceKey || referenceKeyFromTarget(supplied) === referenceKey) &&
    (!tokenIndex || Number(supplied.token?.token_index) === tokenIndex)
  ) {
    return supplied;
  }
  if (!referenceKey || !tokenIndex) return null;
  return createSourceTokenTarget(
    referenceKey,
    {
      token_index: tokenIndex,
      original: record.original || supplied?.token?.original || "",
      strong_code: record.strong_code || supplied?.token?.strong_code || "",
      language: record.language || supplied?.token?.language || "",
    },
    fallbackTranslation,
  );
}

export function normalizeTokenRendering(record, options = {}) {
  if (!record || typeof record !== "object") return null;
  const rendering = normalizeRenderingText(record.rendering);
  if (!rendering) return null;
  const target = sourceTokenTargetForRendering(record, options);
  const referenceKey = String(options.reference_key || record.reference_key || referenceKeyFromTarget(target) || "").trim();
  const tokenIndex = positiveTokenIndex(options.token_index ?? record.token_index ?? target?.token?.token_index);
  if (!target || !referenceKey || !tokenIndex) return null;
  const original = normalizeRenderingText(record.original || target.token?.original || "");
  const strongCode = normalizeRenderingText(record.strong_code || target.token?.strong_code || "").toUpperCase();
  return {
    ...record,
    target,
    target_id: target.target_id,
    translation_id: target.translation_id,
    reference_key: referenceKey,
    token_index: tokenIndex,
    rendering,
    original,
    strong_code: strongCode || null,
    updated_at: record.updated_at || nowIso(),
  };
}

function normalizeTokenRenderingCollection(value) {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  Object.entries(value).forEach(([referenceKey, entries]) => {
    if (!entries || typeof entries !== "object") return;
    const verseRenderings = {};
    Object.entries(entries).forEach(([tokenIndex, record]) => {
      const rendering = normalizeTokenRendering(record, {
        reference_key: referenceKey,
        token_index: tokenIndex,
      });
      if (rendering) verseRenderings[rendering.token_index] = rendering;
    });
    if (Object.keys(verseRenderings).length) normalized[referenceKey] = verseRenderings;
  });
  return normalized;
}

export function normalizeAssertionStore(value = {}, seedAssertions = {}) {
  const fallback = createDefaultAssertionStore();
  const store = { ...fallback, ...(value || {}) };
  const quarantinedRecords = [];
  const normalizedTagAssertions = normalizeTagAssertionCollection(
    {},
    { ...(seedAssertions || {}), ...(store.assertions || {}) },
  );
  const tagAssertions = normalizedTagAssertions.assertions;
  const tagQuarantinedRecords = new Set(normalizedTagAssertions.quarantined.map((item) => item.record));
  const genericAssertions = {};
  Object.values(store.assertions || {}).forEach((assertion) => {
    if (!assertion?.id || !assertion.assertion_type) {
      if (!tagQuarantinedRecords.has(assertion)) {
        quarantinedRecords.push({
          reason: "invalid_assertion_record",
          record: assertion,
          quarantined_at: nowIso(),
        });
      }
      return;
    }
    if (assertion.assertion_type === "tag_application") return;
    const timestamp = assertion.updated_at || assertion.created_at || nowIso();
    genericAssertions[assertion.id] = {
      ...assertion,
      schema_version: Number(assertion.schema_version || 1),
      actor: assertion.actor || { actor_type: "user", actor_id: "user:local" },
      confidence: Number.isFinite(assertion.confidence) ? assertion.confidence : 1,
      visibility: assertion.visibility || "private",
      review_status: assertion.review_status || (assertion.active === false ? "superseded" : "accepted"),
      active: assertion.active !== false,
      created_at: assertion.created_at || timestamp,
      updated_at: timestamp,
      supersedes: assertion.supersedes || null,
    };
  });
  store.assertions = { ...tagAssertions, ...genericAssertions };
  store.events = Array.isArray(store.events)
    ? store.events.filter((event) => event?.id && event.assertion_id && event.event_type)
    : [];
  store.quarantined_records = [
    ...(Array.isArray(store.quarantined_records) ? store.quarantined_records : []),
    ...normalizedTagAssertions.quarantined.map((item) => ({ ...item, quarantined_at: nowIso() })),
    ...quarantinedRecords,
  ].slice(-200);
  store.version = fallback.version;
  return store;
}

export function normalizePollStore(value = {}) {
  const fallback = createDefaultPollStore();
  const store = { ...fallback, ...(value || {}) };
  const responses = {};
  Object.values(store.responses || {}).forEach((response) => {
    const normalized = normalizePollResponse(response);
    if (normalized) responses[normalized.id] = normalized;
  });
  store.responses = responses;
  store.events = Array.isArray(store.events)
    ? store.events.filter((event) => event?.id && event.response_id && event.event_type)
    : [];
  store.aggregates = aggregatePollResponses(store.responses);
  store.version = fallback.version;
  return store;
}

export function normalizeLocalPackageStore(value = {}) {
  return normalizePackageStore(value || createDefaultLocalPackageStore());
}

function appendAssertionEvent(state, assertion, eventType) {
  if (!state.assertionStore || !assertion?.id) return;
  state.assertionStore.events.push({
    id: `event:assertion:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    schema_version: 1,
    event_type: eventType,
    assertion_id: assertion.id,
    assertion_type: assertion.assertion_type,
    target: assertion.target,
    actor: assertion.actor,
    created_at: nowIso(),
  });
  state.assertionStore.events = state.assertionStore.events.slice(-500);
}

export function upsertAssertion(state, assertion, eventType = "assertion_upserted") {
  ensureStores(state);
  state.assertionStore.assertions[assertion.id] = assertion;
  appendAssertionEvent(state, assertion, eventType);
  saveStorage(STORAGE_KEYS.assertions, state.assertionStore);
  return assertion;
}

export async function initStores(state, adapter = null) {
  const storage = adapter ? configureUserStorageAdapter(adapter) : resolveUserStorageAdapter();
  const initialized = await storage.initialize([
    { name: USER_STORE_NAMES.tags, fallback: createDefaultTagStore() },
    { name: USER_STORE_NAMES.workspace, fallback: createDefaultWorkspaceStore() },
    { name: USER_STORE_NAMES.assertions, fallback: createDefaultAssertionStore() },
    { name: USER_STORE_NAMES.polls, fallback: createDefaultPollStore() },
    { name: USER_STORE_NAMES.packages, fallback: createDefaultLocalPackageStore() },
    { name: USER_STORE_NAMES.importBackups, fallback: createDefaultImportBackupStore(), requiredForAuthority: false },
  ]);
  const values = initialized.values;
  state.tagStore = normalizeTagStore(values.tags);
  state.workspaceStore = normalizeWorkspaceStore(values.workspace);
  state.assertionStore = normalizeAssertionStore(values.assertions, state.tagStore.tag_assertions);
  state.pollStore = normalizePollStore(values.polls);
  state.packageStore = normalizeLocalPackageStore(values.packages);
  state.userStoreBackend = initialized.backend;
  state.userStoreAuthority = initialized.authority;
  state.userStoreMigration = initialized.migration;
  state.userStoreFailure = initialized.failure;
  state.userStorageProfile = initialized.profileId;
}

function createDefaultImportBackupStore() {
  return {
    version: 1,
    backups: [],
  };
}

function normalizeImportBackupStore(value = {}) {
  const fallback = createDefaultImportBackupStore();
  return {
    ...fallback,
    ...(value || {}),
    version: fallback.version,
    backups: Array.isArray(value.backups) ? value.backups.filter((backup) => backup?.id && backup.exported_user_data).slice(-5) : [],
  };
}

function loadImportBackupStore() {
  return normalizeImportBackupStore(loadStorage(STORAGE_KEYS.importBackups, createDefaultImportBackupStore()));
}

function saveImportBackupStore(store) {
  saveStorage(STORAGE_KEYS.importBackups, normalizeImportBackupStore(store));
}

export function createUserDataBackup(state, reason = "manual") {
  ensureStores(state);
  const store = loadImportBackupStore();
  const backup = {
    id: `backup:user-data:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    schema_version: 1,
    reason,
    created_at: nowIso(),
    exported_user_data: createUserDataExport(state),
  };
  store.backups = [...(store.backups || []), backup].slice(-5);
  saveImportBackupStore(store);
  state.lastUserDataBackup = {
    id: backup.id,
    reason: backup.reason,
    created_at: backup.created_at,
  };
  return backup;
}

export function listenForUserDataChanges(state, onChange = null) {
  const unsubscribe = resolveUserStorageAdapter().listen((change) => {
    state.lastExternalUserDataChange = change;
    if (onChange) onChange(change);
  });
  if (!unsubscribe) {
    state.userDataBroadcast = "unavailable";
    return null;
  }
  state.userDataBroadcast = "active";
  return unsubscribe;
}

export function ensureStores(state) {
  if (!state.tagStore) {
    state.tagStore = normalizeTagStore(loadStorageWithLegacy(STORAGE_KEYS.tags, null, createDefaultTagStore()));
  }
  if (!state.workspaceStore) {
    state.workspaceStore = normalizeWorkspaceStore(loadStorage(STORAGE_KEYS.workspace, createDefaultWorkspaceStore()));
  }
  if (!state.assertionStore) {
    state.assertionStore = normalizeAssertionStore(
      loadStorage(STORAGE_KEYS.assertions, createDefaultAssertionStore()),
      state.tagStore?.tag_assertions || {},
    );
  }
  if (!state.pollStore) {
    state.pollStore = normalizePollStore(loadStorage(STORAGE_KEYS.polls, createDefaultPollStore()));
  }
  if (!state.packageStore) {
    state.packageStore = normalizeLocalPackageStore(loadStorage(STORAGE_KEYS.packages, createDefaultLocalPackageStore()));
  }
  const storageStatus = resolveUserStorageAdapter().status();
  state.userStoreBackend = state.userStoreBackend || storageStatus.backend;
  state.userStoreMigration = state.userStoreMigration || storageStatus.migration || "sync-fallback";
  state.userStoreAuthority = storageStatus.authority;
  state.userStoreFailure = storageStatus.failure;
  state.userStorageProfile = storageStatus.profileId;
}

export function setPackageStore(state, packageStore) {
  ensureStores(state);
  state.packageStore = normalizeLocalPackageStore(packageStore);
  saveStorage(STORAGE_KEYS.packages, state.packageStore);
  return state.packageStore;
}

export function createCustomTag(state, fields) {
  ensureStores(state);
  const label = String(fields?.label || "").trim();
  if (!label) return null;

  const base = slugify(label) || "tag";
  let id = `custom_${base}`;
  if (state.tagStore.tags[id]) {
    id = `${id}_${Date.now().toString(36)}`;
  }

  const tag = {
    id,
    tag_definition_id: tagDefinitionId(id),
    schema_version: 1,
    namespace: "user",
    label,
    description: String(fields?.description || "").trim(),
    category: "reader_classification",
    allowed_target_types: ["book", "chapter", "verse", "verse_range", "text_span", "source_token", "source_token_span"],
    display_behavior: "custom_manual",
    on_apply_job_type: null,
    status: "active",
    color: normalizeColor(fields?.color),
    icon: normalizeIcon(fields?.icon),
    custom: true,
    created_at: nowIso(),
    revision: 1,
  };

  state.tagStore.tags[id] = tag;
  saveStorage(STORAGE_KEYS.tags, state.tagStore);
  return tag;
}

export function updateCustomTag(state, tagId, fields, options = {}) {
  ensureStores(state);
  const current = state.tagStore.tags[tagId];
  if (!current?.custom) return null;
  if (
    Number.isInteger(options.expected_revision) &&
    Number(current.revision || 1) !== Number(options.expected_revision)
  ) {
    const conflict = appendConflict(state.tagStore, {
      id: `conflict:tag:${tagId}:${Date.now()}`,
      conflict_type: "tag_definition_revision_mismatch",
      tag_id: tagDefinitionId(tagId),
      expected_revision: options.expected_revision,
      actual_revision: Number(current.revision || 1),
      created_at: nowIso(),
    });
    saveStorage(STORAGE_KEYS.tags, state.tagStore);
    return { conflict };
  }

  const label = String(fields?.label || "").trim();
  if (!label) return null;

  const tag = {
    ...current,
    label,
    description: String(fields?.description || "").trim(),
    tag_definition_id: current.tag_definition_id || tagDefinitionId(tagId),
    schema_version: Number(current.schema_version || 1),
    namespace: current.namespace || "user",
    category: current.category || "reader_classification",
    allowed_target_types:
      current.allowed_target_types ||
      ["book", "chapter", "verse", "verse_range", "text_span", "source_token", "source_token_span"],
    display_behavior: current.display_behavior || "custom_manual",
    on_apply_job_type: current.on_apply_job_type || null,
    status: current.status || "active",
    color: normalizeColor(fields?.color),
    icon: normalizeIcon(fields?.icon),
    revision: nextRevision(current),
    updated_at: nowIso(),
  };

  state.tagStore.tags[tagId] = tag;
  saveStorage(STORAGE_KEYS.tags, state.tagStore);
  return tag;
}

export function deleteCustomTag(state, tagId) {
  ensureStores(state);
  const current = state.tagStore.tags[tagId];
  if (!current?.custom) return false;

  const retiredAt = nowIso();
  state.tagStore.tags[tagId] = normalizeTagDefinition({
    ...current,
    status: "retired",
    retired_at: current.retired_at || retiredAt,
    replacement_id: current.replacement_id || null,
    updated_at: retiredAt,
  });
  Object.values(state.tagStore.tag_assertions || {}).forEach((assertion) => {
    if (assertion.legacy_tag_id !== tagId && assertion.tag_id !== tagDefinitionId(tagId)) return;
    assertion.active = false;
    assertion.review_status = "superseded";
    assertion.updated_at = nowIso();
    upsertAssertion(state, assertion, "tag_assertion_superseded");
  });
  state.tagStore.tag_target_index = deriveTagTargetIndex(state.tagStore.tag_assertions);
  Object.entries(state.tagStore.verse_tags || {}).forEach(([key, tagIds]) => {
    const next = tagIds.filter((id) => id !== tagId);
    if (next.length) state.tagStore.verse_tags[key] = next;
    else delete state.tagStore.verse_tags[key];
  });

  saveStorage(STORAGE_KEYS.tags, state.tagStore);
  return true;
}

function mergeVerseTags(current, incoming) {
  const merged = { ...(current || {}) };
  Object.entries(incoming || {}).forEach(([key, tagIds]) => {
    if (!Array.isArray(tagIds)) return;
    merged[key] = [...new Set([...(merged[key] || []), ...tagIds])].sort();
  });
  return merged;
}

function mergeTagAssertions(current, incoming) {
  return { ...(current || {}), ...(incoming || {}) };
}

function mergeHistoryEvents(current, incoming, limit = 200) {
  const byId = new Map();
  [...(current || []), ...(incoming || [])].forEach((event) => {
    if (!event?.id) return;
    byId.set(event.id, event);
  });
  return [...byId.values()]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(limit === null ? 0 : -limit);
}

function mergeTokenRenderings(current, incoming) {
  const merged = { ...(current || {}) };
  Object.entries(incoming || {}).forEach(([key, renderings]) => {
    merged[key] = { ...(merged[key] || {}), ...(renderings || {}) };
  });
  return merged;
}

function mergePackageStores(current, incoming) {
  return normalizeLocalPackageStore({
    ...current,
    installed_feature_pack_ids: [
      ...new Set([...(current?.installed_feature_pack_ids || []), ...(incoming?.installed_feature_pack_ids || [])]),
    ],
    installed_package_ids: [
      ...new Set([...(current?.installed_package_ids || []), ...(incoming?.installed_package_ids || [])]),
    ],
    operations: mergeHistoryEvents(current?.operations || [], incoming?.operations || []),
    updated_at: incoming?.updated_at || current?.updated_at || null,
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidBackupStructure(detail) {
  return new Error(`Backup structure is invalid: ${detail} No local data was changed.`);
}

function extractUserDataStores(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Import data must be a JSON object.");
  }
  if (payload.kind !== USER_DATA_EXPORT_KIND && !LEGACY_USER_DATA_EXPORT_KINDS.has(payload.kind)) {
    throw new Error("Import data is not a Bible App user-data export.");
  }
  const version = Number(payload.version || 0);
  if (!Number.isInteger(version) || version < 1 || version > USER_DATA_EXPORT_VERSION) {
    throw new Error(`This backup version is not compatible with this Bible App (supported through version ${USER_DATA_EXPORT_VERSION}).`);
  }
  if (!isPlainObject(payload.stores)) {
    throw invalidBackupStructure("stores must be an object.");
  }
  const stores = payload.stores;
  ["tags", "workspace", "assertions", "polls", "packages"].forEach((section) => {
    if (Object.prototype.hasOwnProperty.call(stores, section) && !isPlainObject(stores[section])) {
      throw invalidBackupStructure(`${section} must be an object when supplied.`);
    }
  });
  // Reject malformed histories before recovery snapshots or any store writes.
  for (const section of ["tags", "workspace"]) {
    const events = stores[section]?.job_events;
    if (events !== undefined && (!Array.isArray(events) || events.some((event) =>
      !isPlainObject(event) || typeof event.id !== "string" || !event.id ||
      !(typeof event.type === "string" && event.type || typeof event.job_type === "string" && event.job_type)
    ))) throw invalidBackupStructure(section + ".job_events must contain valid legacy job records.");
  }
  return {
    tagStore: normalizeTagStore(stores.tags || {}),
    workspaceStore: normalizeWorkspaceStore(stores.workspace || {}),
    assertionStore: normalizeAssertionStore(stores.assertions || {}, stores.tags?.tag_assertions || {}),
    pollStore: normalizePollStore(stores.polls || {}),
    packageStore: normalizeLocalPackageStore(stores.packages || {}),
  };
}

export function createUserDataExport(state) {
  ensureStores(state);
  return {
    kind: USER_DATA_EXPORT_KIND,
    version: USER_DATA_EXPORT_VERSION,
    exported_at: nowIso(),
    stores: {
      tags: clone(state.tagStore),
      workspace: clone(state.workspaceStore),
      assertions: clone(state.assertionStore),
      polls: clone(state.pollStore),
      packages: clone(state.packageStore),
    },
  };
}

export function getUserDataSummary(state) {
  ensureStores(state);
  const customTags = Object.values(state.tagStore.tags || {}).filter((tag) => tag.custom && tag.status !== "retired").length;
  const taggedVerses = Object.keys(state.tagStore.verse_tags || {}).length;
  const tagAssertions = Object.values(state.tagStore.tag_assertions || {}).filter(
    (assertion) => assertion.assertion_type === "tag_application" && assertion.active,
  ).length;
  const assertions = Object.values(state.assertionStore.assertions || {}).filter((assertion) => assertion.active !== false).length;
  const assertionEvents = (state.assertionStore.events || []).length;
  const quarantinedAssertionRecords = (state.assertionStore.quarantined_records || []).length;
  const installedFeaturePacks = (state.packageStore.installed_feature_pack_ids || []).length;
  const packageOperations = (state.packageStore.operations || []).length;
  const importBackups = loadImportBackupStore().backups.length;
  const verseDrafts = Object.keys(state.workspaceStore.verse_drafts || {}).length;
  const tokenRenderingVerses = Object.keys(state.workspaceStore.token_renderings || {}).length;
  const tokenRenderings = Object.values(state.workspaceStore.token_renderings || {}).reduce(
    (total, renderings) => total + Object.keys(renderings || {}).length,
    0,
  );
  return {
    custom_tags: customTags,
    tagged_verses: taggedVerses,
    tag_assertions: tagAssertions,
    assertions,
    assertion_events: assertionEvents,
    quarantined_assertion_records: quarantinedAssertionRecords,
    installed_feature_packs: installedFeaturePacks,
    package_operations: packageOperations,
    import_backups: importBackups,
    last_import_backup: state.lastUserDataBackup || null,
    verse_drafts: verseDrafts,
    token_rendering_verses: tokenRenderingVerses,
    token_renderings: tokenRenderings,
    user_store_backend: state.userStoreBackend || "localStorage",
    user_store_authority: state.userStoreAuthority || resolveUserStorageAdapter().status().authority,
    user_store_migration: state.userStoreMigration || "unknown",
    user_store_failure: state.userStoreFailure || resolveUserStorageAdapter().status().failure,
  };
}

export function importUserData(state, payload, mode = "merge") {
  const incoming = extractUserDataStores(payload);
  if (mode !== "merge" && mode !== "replace") {
    throw new Error("Import mode must be merge or replace.");
  }
  ensureStores(state);

  if (mode === "replace") {
    createUserDataBackup(state, "before-replace-import");
    state.tagStore = incoming.tagStore;
    state.workspaceStore = incoming.workspaceStore;
    state.assertionStore = incoming.assertionStore;
    state.pollStore = incoming.pollStore;
    state.packageStore = incoming.packageStore;
  } else {
    state.tagStore = normalizeTagStore({
      ...state.tagStore,
      tags: { ...(state.tagStore.tags || {}), ...(incoming.tagStore.tags || {}) },
      verse_tags: mergeVerseTags(state.tagStore.verse_tags, incoming.tagStore.verse_tags),
      tag_assertions: mergeTagAssertions(state.tagStore.tag_assertions, incoming.tagStore.tag_assertions),
      job_events: mergeHistoryEvents(state.tagStore.job_events, incoming.tagStore.job_events, null),
    });
    state.workspaceStore = normalizeWorkspaceStore({
      ...state.workspaceStore,
      verse_drafts: { ...(state.workspaceStore.verse_drafts || {}), ...(incoming.workspaceStore.verse_drafts || {}) },
      token_renderings: mergeTokenRenderings(
        state.workspaceStore.token_renderings,
        incoming.workspaceStore.token_renderings,
      ),
      red_letter_ranges: {
        ...(state.workspaceStore.red_letter_ranges || {}),
        ...(incoming.workspaceStore.red_letter_ranges || {}),
      },
      job_events: mergeHistoryEvents(state.workspaceStore.job_events, incoming.workspaceStore.job_events, null),
    });
    state.assertionStore = normalizeAssertionStore({
      ...state.assertionStore,
      assertions: mergeTagAssertions(state.assertionStore.assertions, incoming.assertionStore.assertions),
      events: mergeHistoryEvents(state.assertionStore.events, incoming.assertionStore.events),
    });
    state.pollStore = normalizePollStore({
      ...state.pollStore,
      ...incoming.pollStore,
      responses: mergeTagAssertions(state.pollStore.responses, incoming.pollStore.responses),
      // Retired histories have no active writer; retain every distinct event.
      events: mergeHistoryEvents(state.pollStore.events, incoming.pollStore.events, null),
    });
    state.packageStore = mergePackageStores(state.packageStore, incoming.packageStore);
  }

  saveStorage(STORAGE_KEYS.tags, state.tagStore);
  saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
  saveStorage(STORAGE_KEYS.assertions, state.assertionStore);
  saveStorage(STORAGE_KEYS.polls, state.pollStore);
  saveStorage(STORAGE_KEYS.packages, state.packageStore);
  return getUserDataSummary(state);
}

export function getVerseTags(state, key) {
  ensureStores(state);
  return state.tagStore.verse_tags[key] || [];
}

function resolveRuntimeTag(state, tagId) {
  const canonicalId = tagDefinitionId(tagId);
  const legacyId = legacyTagId(canonicalId);
  return (
    state.tagStore.tags[legacyId] ||
    state.tagStore.tags[tagId] ||
    Object.values(state.tagStore.tags).find((tag) => tag.tag_definition_id === canonicalId) ||
    null
  );
}

export function getTagTargets(state, tagId) {
  ensureStores(state);
  return state.tagStore.tag_target_index[tagDefinitionId(tagId)] || [];
}

export function getTargetTags(state, targetInput) {
  ensureStores(state);
  const target = normalizeTarget(targetInput);
  if (!target) return [];
  return Object.values(state.tagStore.tag_assertions || {})
    .filter(
      (assertion) =>
        assertion.active &&
        assertion.assertion_type === "tag_application" &&
        assertion.target_id === target.target_id,
    )
    .map((assertion) => legacyTagId(assertion.tag_id))
    .sort();
}

export function getTaggedTargetsForReference(state, key, options = {}) {
  ensureStores(state);
  const targetTypes = Array.isArray(options.targetTypes) ? new Set(options.targetTypes) : null;
  const translationId = String(options.translationId || "").trim().toLowerCase();
  const grouped = new Map();
  Object.values(state.tagStore.tag_assertions || {}).forEach((assertion) => {
    if (!assertion?.active || assertion.assertion_type !== "tag_application") return;
    const target = normalizeTarget(assertion.target);
    if (!target || referenceKeyFromTarget(target) !== key) return;
    if (targetTypes && !targetTypes.has(target.target_type)) return;
    if (translationId && target.translation_id !== translationId) return;
    const current = grouped.get(target.target_id) || { target, tag_ids: [] };
    current.tag_ids.push(legacyTagId(assertion.tag_id));
    current.tag_ids = [...new Set(current.tag_ids)].sort();
    grouped.set(target.target_id, current);
  });
  return [...grouped.values()].sort((a, b) => a.target.target_id.localeCompare(b.target.target_id));
}

export function setTagAssertion(state, targetInput, tagId, enabled, options = {}) {
  ensureStores(state);
  const target = normalizeTarget(targetInput);
  if (!target) throw new Error("A complete supported tag target is required.");
  const tag = resolveRuntimeTag(state, tagId);
  if (!tag || tag.status === "retired") throw new Error(`Unknown or retired tag: ${tagId}`);
  if (!tag.allowed_target_types.includes(target.target_type)) {
    throw new Error(`${tag.label} cannot be applied to ${target.target_type} targets.`);
  }

  const canonicalTagId = tag.tag_definition_id || tagDefinitionId(tag.id);
  const assertionId = tagAssertionId(target, canonicalTagId);
  const existing = state.tagStore.tag_assertions[assertionId] || null;
  const note = typeof options.note === "string" ? options.note : existing?.note || "";
  if (existing && existing.active === Boolean(enabled) && existing.note === note) return existing;
  if (!existing && !enabled) return null;

  const timestamp = nowIso();
  const assertion = {
    ...(existing ||
      createTagAssertion(target, canonicalTagId, {
        active: enabled,
        timestamp,
        actor: options.actor,
        confidence: options.confidence,
        visibility: options.visibility,
      })),
    active: Boolean(enabled),
    review_status: enabled ? "accepted" : "superseded",
    revision: Number(existing?.revision || 0) + 1,
    note,
    updated_at: timestamp,
  };
  state.tagStore.tag_assertions[assertionId] = assertion;
  state.tagStore.verse_tags = deriveVerseTagsFromAssertions(state.tagStore.tag_assertions);
  state.tagStore.tag_target_index = deriveTagTargetIndex(state.tagStore.tag_assertions);
  upsertAssertion(
    state,
    assertion,
    enabled ? "tag_assertion_applied" : "tag_assertion_superseded",
  );
  saveStorage(STORAGE_KEYS.tags, state.tagStore);

  return assertion;
}

export function setVerseTag(state, key, tagId, enabled, options = {}) {
  const translation = options.translation_id || state.translationId || state.translation_id || "bsb";
  const target = createVerseTarget(key, translation);
  return setTagAssertion(state, target, tagId, enabled, options);
}

export function getWorkspaceVerse(state, key) {
  ensureStores(state);
  return state.workspaceStore.verse_drafts[key] || null;
}

export function getTokenRenderings(state, key) {
  ensureStores(state);
  return state.workspaceStore.token_renderings[key] || {};
}

function resolveTokenRenderingTarget(state, targetOrKey, token = null) {
  if (typeof targetOrKey === "string") {
    return createSourceTokenTarget(
      targetOrKey,
      token || {},
      state?.translationId || state?.translation_id || "bsb",
    );
  }
  const target = normalizeTarget(targetOrKey);
  return target?.target_type === "source_token" ? target : null;
}

function tokenRenderingLocation(state, targetOrKey, token = null) {
  const target = resolveTokenRenderingTarget(state, targetOrKey, token);
  const referenceKey = referenceKeyFromTarget(target);
  const tokenIndex = positiveTokenIndex(target?.token?.token_index);
  if (!target || !referenceKey || !tokenIndex) return null;
  return { target, referenceKey, tokenIndex };
}

export function getTokenRendering(state, targetOrKey, token = null) {
  ensureStores(state);
  const location = tokenRenderingLocation(state, targetOrKey, token);
  if (!location) return null;
  const current = state.workspaceStore.token_renderings[location.referenceKey]?.[location.tokenIndex] || null;
  return current
    ? normalizeTokenRendering(current, {
        target: location.target,
        reference_key: location.referenceKey,
        token_index: location.tokenIndex,
      })
    : null;
}

export function getRedLetterRanges(state, key) {
  ensureStores(state);
  return state.workspaceStore.red_letter_ranges[key] || [];
}

export function addRedLetterRange(state, key, range) {
  ensureStores(state);
  const start = Number(range?.start);
  const end = Number(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const ranges = state.workspaceStore.red_letter_ranges[key] || [];
  ranges.push({
    start,
    end,
    text: String(range?.text || ""),
    source: "user",
    updated_at: nowIso(),
  });
  state.workspaceStore.red_letter_ranges[key] = ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((item, index, all) => index === 0 || item.start !== all[index - 1].start || item.end !== all[index - 1].end);
  saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
  return true;
}

export function setVerseDraft(state, key, draftText, options = {}) {
  ensureStores(state);
  const current = state.workspaceStore.verse_drafts[key] || null;
  if (
    Number.isInteger(options.expected_revision) &&
    Number(current?.revision || 0) !== Number(options.expected_revision)
  ) {
    const conflict = appendConflict(state.workspaceStore, {
      id: `conflict:verse-draft:${key.replaceAll(":", ".")}:${Date.now()}`,
      conflict_type: "translation_draft_revision_mismatch",
      reference_key: key,
      expected_revision: options.expected_revision,
      actual_revision: Number(current?.revision || 0),
      current_draft_text: current?.draft_text || "",
      attempted_draft_text: draftText,
      created_at: nowIso(),
    });
    saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
    return { conflict };
  }
  state.workspaceStore.verse_drafts[key] = {
    draft_text: draftText,
    revision: nextRevision(current),
    updated_at: nowIso(),
  };
  saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
  return state.workspaceStore.verse_drafts[key];
}

export function setTokenRendering(state, targetOrKey, tokenOrRendering, legacyRendering) {
  ensureStores(state);
  const legacyCall = typeof targetOrKey === "string";
  const token = legacyCall ? tokenOrRendering : null;
  const rendering = legacyCall ? legacyRendering : tokenOrRendering;
  const location = tokenRenderingLocation(state, targetOrKey, token);
  if (!location) return null;
  const text = normalizeRenderingText(rendering);
  if (!text) {
    deleteTokenRendering(state, location.target);
    return null;
  }
  const existing = state.workspaceStore.token_renderings[location.referenceKey]?.[location.tokenIndex] || null;
  const next = normalizeTokenRendering(
    {
      ...existing,
      rendering: text,
      original: location.target.token?.original || existing?.original || "",
      strong_code: location.target.token?.strong_code || existing?.strong_code || "",
      target: location.target,
      updated_at: nowIso(),
    },
    {
      reference_key: location.referenceKey,
      token_index: location.tokenIndex,
      translation_id: location.target.translation_id,
    },
  );
  if (!next) return null;
  state.workspaceStore.token_renderings[location.referenceKey] = {
    ...(state.workspaceStore.token_renderings[location.referenceKey] || {}),
    [location.tokenIndex]: next,
  };
  saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
  return next;
}

export function deleteTokenRendering(state, targetOrKey, token = null) {
  ensureStores(state);
  const location = tokenRenderingLocation(state, targetOrKey, token);
  if (!location) return false;
  const renderings = state.workspaceStore.token_renderings[location.referenceKey];
  const existing = renderings?.[location.tokenIndex];
  if (!existing) return false;
  delete renderings[location.tokenIndex];
  if (!Object.keys(renderings).length) delete state.workspaceStore.token_renderings[location.referenceKey];
  saveStorage(STORAGE_KEYS.workspace, state.workspaceStore);
  return true;
}
