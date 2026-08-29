import { STORAGE_KEYS } from "../config.js";

export const USER_STORE_NAMES = Object.freeze({
  tags: "tags",
  workspace: "workspace",
  assertions: "assertions",
  polls: "polls",
  packages: "packages",
  importBackups: "importBackups",
});

export const STABLE_STORAGE_IDENTITIES = Object.freeze({
  userDatabase: "bibleapp",
  userDatabaseVersion: 2,
  userObjectStore: "user_stores",
  localStorageKeys: Object.freeze({ ...STORAGE_KEYS }),
  legacyLocalStorageKeys: Object.freeze({ tags: "openbible-clean-app:verse-tags:v1" }),
  notificationChannel: "bibleapp:user-data",
  physicalRegistryDatabase: "bibleapp-physical-packs",
  physicalBytePrefix: "bibleapp-pack:",
});

export const LAB_STORAGE_IDENTITIES = Object.freeze({
  userDatabase: "bibleapp-lab",
  userDatabaseVersion: 2,
  userObjectStore: "user_stores",
  localStorageKeys: Object.freeze({
    tags: "bibleapp:lab:verse-tags:v1",
    workspace: "bibleapp:lab:translation-workspace:v1",
    assertions: "bibleapp:lab:assertions:v1",
    polls: "bibleapp:lab:polls:v1",
    packages: "bibleapp:lab:packages:v1",
    importBackups: "bibleapp:lab:import-backups:v1",
  }),
  legacyLocalStorageKeys: Object.freeze({}),
  notificationChannel: "bibleapp:lab:user-data",
  physicalRegistryDatabase: "bibleapp-physical-packs-lab",
  physicalBytePrefix: "bibleapp-pack:lab:",
});

export function storageIdentitiesForProfile(profileId) {
  return profileId === "lab" ? LAB_STORAGE_IDENTITIES : STABLE_STORAGE_IDENTITIES;
}
