# Interpretation poll retirement (#82)

Interpretation polls are passive backup compatibility data in Stable and Lab.
There is no response creation/edit/delete API, event generator, poll control,
diagnostic count, or packaged draft prompt. This boundary does not implement
claims, beliefs, consensus, or aggregate interpretation analytics.

## Reference inventory

| Area | Retained or retired authority |
| --- | --- |
| `app/src/semantic-polls.js` | Retains `normalizePollResponse` and `aggregatePollResponses`, consumed by `normalizePollStore`. Retires `pollResponseId` and `createPollResponse`; their only creation consumer was the store/test scaffold. |
| `app/src/stores.js` | Retains passive load/normalize, version-3 export/import and recovery. Retires `setPollResponse`, `deletePollResponse`, `appendPollEvent`, and summary counts. Poll history merge no longer uses the generic 200-event cap. |
| `app/src/views/user-data-view.js` | Removes Poll responses/Poll events rows. Backup, recovery, packs, capabilities and other diagnostics remain. No other ordinary view called a poll mutation API. |
| `app/src/feature-registry.js`, `tests/feature-registry.mjs`, `tests/feature-profiles.mjs` | Retain the `interpretation-polls` compatibility-only descriptor, namespace and both profiles' passive participation. No owned UI or cleanup authority. |
| `app/src/config.js`, `app/src/platform/storage-identities.js`, `src-tauri/src/storage.rs` | Unchanged browser keys, profile identities, and native `polls` store ID. No automatic store clearing or migration. |
| `app/schemas/poll-response.schema.json` | Retains the complete historical response contract and extension support; sparse legacy readers remain compatible. |
| `app/data/semantic/manifest.json` | Removes the retired file/count. Tag definitions and relations remain production data. |
| Former `app/data/semantic/interpretation-propositions.json` | Exact three draft seeds moved to `tests/fixtures/legacy-polls/interpretation-propositions.json`; `tests/fixtures/legacy-polls.mjs` supplies historical test records only. |
| `app/tools/refresh-package-inventory.mjs`, `app/data/package-manifest.json` | Describe semantic tag definitions/relations and recompute file counts, bytes and hashes. Pack IDs, capabilities and other data membership are unchanged. |
| `app/data/distribution-manifest.json`, `app/data/physical-pack-scenarios.json`, `app/data/physical-pack-fixtures/` | Reconcile dependent package-identity hashes and measured totals. Fixture payloads and pack behavior remain unchanged. |
| `app/tools/build-physical-pack-fixtures.mjs`, `app/tools/build-physical-packs.mjs` | Regenerate deterministic fixture identity/catalog digests and scenario measurements from the current package inventory; their check modes verify the results. |
| `app/tools/prepare-desktop-frontend.mjs`, `tests/desktop-staging.mjs` | Existing tracked-runtime allowlist excludes `tests/`; staging regression rejects retired seeds and fixtures in installed resources. |
| `app/scripts/semantic-test.mjs` | Validates current semantic data; removes active prompt expectations. Canonical semantic target types remain. |
| `app/scripts/poll-response-test.mjs` | Replaces creation/update/deletion tests with passive compatibility, schema, retirement, long-history, conflict, extension, sparse-record and recovery tests. |
| `app/scripts/recovery-scenarios-test.mjs` | Inspects the passive empty store directly instead of a retired summary count. Existing recovery cases remain. |
| `app/scripts/feature-profile-interaction-test.mjs`, `app/tools/run-desktop-e2e.mjs` | Rendered retirement and historical backup/relaunch checks alongside existing study and Local Jobs regressions. |
| `app/scripts/study-workspace-interaction-test.mjs` | Retains the unchanged browser poll key in isolated storage setup. |
| `package.json`, `tests/TEST_INVENTORY.md` | Existing aggregate commands retain the compatibility test and document its revised scope. |
| `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/UI_CONTRACT.md` | Describe passive compatibility and absence of poll presentation. Public product documentation advertises no poll feature. |
| `app/src/semantic-graph.js` and canonical scripture, lexical, cross-reference, search and commentary data | Retain semantic `interpretation_proposition` target support and source text. Word matches in reference data are not poll-product dependencies. |

## Preservation policy

Historical responses keep IDs, proposition IDs/versions and retained targets,
actors, opinions, timestamps, tombstone/deletion metadata, supersession data,
events and supported extension fields. Unknown proposition IDs and answers do
not require a seed-catalog lookup. Sparse legacy defaults are unchanged.

Merge retains all distinct response/event IDs and uses the existing incoming
record for duplicate IDs, regardless of timestamps. Events are ordered by
creation time without a length cap; store extensions use a shallow incoming-wins
merge. Replace saves the prior complete version-3 export for recovery. Startup
does not rewrite an existing poll store, and study actions generate no polls.

Aggregate caches are still disposable: readers rebuild counts per
proposition/version from nondeleted responses, marked local-private and scoped
to the current user export. They are not historical opinions or community data.

Malformed top-level backup/store shapes are rejected before mutation or a
replacement snapshot. The existing passive filters ignore responses missing
identity/proposition/answer and events missing identity/response/type. Other
quarantine and malformed native-storage recovery rules remain unchanged.

The maintained domain, browser and isolated desktop tests cover this boundary;
installer/uninstaller and firewall acceptance are outside this slice.

After an inventory change, align the distribution manifest's package hash, run
`node app/tools/build-physical-pack-fixtures.mjs` and
`node app/tools/build-physical-packs.mjs --write-scenarios`. Validate with the
corresponding `--check` and `--check-scenarios` modes as well as
`npm run inventory:check`.
