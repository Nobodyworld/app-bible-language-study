// Download/copy serialization only. Store snapshots and recovery backups remain
// full-fidelity; the version-3 importer restores these known empty defaults.
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const emptyObject = (value) => object(value) && Object.keys(value).length === 0;
const emptyArray = (value) => Array.isArray(value) && value.length === 0;
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));

export function compactUserDataBackup(payload) {
  const backup = JSON.parse(JSON.stringify(payload));
  if (backup?.kind !== "bibleapp:user-data" || backup.version !== 3 || !object(backup.stores)) return backup;
  const { stores } = backup;
  for (const name of ["tags", "workspace"]) {
    if (object(stores[name]) && emptyArray(stores[name].job_events)) delete stores[name].job_events;
  }
  if (object(stores.tags?.tags)) {
    for (const tag of Object.values(stores.tags.tags)) {
      if (object(tag) && tag.on_apply_job_type === null) delete tag.on_apply_job_type;
    }
  }
  const polls = stores.polls;
  if (onlyKeys(polls, ["version", "responses", "events", "aggregates"])
    && polls.version === 1 && emptyObject(polls.responses)
    && emptyArray(polls.events) && emptyObject(polls.aggregates)) delete stores.polls;

  const packages = stores.packages;
  const arrayKeys = ["installed_feature_pack_ids", "installed_package_ids", "disabled_feature_pack_ids", "disabled_capability_ids", "operations"];
  if (onlyKeys(packages, ["version", ...arrayKeys, "physical_data_mode", "updated_at"])
    && packages.version === 1 && packages.physical_data_mode === "bundled_static_data"
    && packages.updated_at === null && arrayKeys.every((key) => emptyArray(packages[key]))) delete stores.packages;
  return backup;
}
