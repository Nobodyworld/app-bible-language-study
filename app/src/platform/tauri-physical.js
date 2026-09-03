import { PHYSICAL_DATA_MODES } from "../physical-pack-contract.js";
import { createPhysicalPackRegistry } from "../physical-pack-registry.js";
import { createCancellationService, createWebDigestService } from "./physical-services.js";

function bundledOnlyError() {
  const error = new Error("Native physical-pack management is deferred to issue #81; bundled data remains available.");
  error.code = "native_physical_packs_not_supported";
  throw error;
}

function createBundledOnlyByteStore() {
  return Object.freeze({
    async createStore() { bundledOnlyError(); },
    async listStoreIdentities() { return []; },
    async readResponse() { return null; },
    async writeResponse() { bundledOnlyError(); },
    async writeVerifiedBytes() { bundledOnlyError(); },
    async deleteStore() { return false; },
    async storeExists() { return false; },
    async enumerateStoredPaths() { return []; },
  });
}

export function createTauriPhysicalPackServices(options = {}) {
  const profileId = options.profileId === "lab" ? "lab" : "stable";
  const registry = createPhysicalPackRegistry({
    memory: true,
    seed: { metadata: { physical_data_mode: PHYSICAL_DATA_MODES.bundled } },
  });
  return Object.freeze({
    registry,
    bytes: createBundledOnlyByteStore(),
    byteStoreIdentityPrefix: `bibleapp-pack:native-${profileId}:`,
    source: Object.freeze({ async fetch() { bundledOnlyError(); } }),
    digest: createWebDigestService(options.cryptoObject),
    storageEstimate: Object.freeze({
      async estimate() {
        return { usage: null, quota: null, supported: false, reason: "bundled-only-desktop" };
      },
    }),
    cancellation: createCancellationService(),
    baseUrl: options.baseUrl,
    clock: options.clock || Date.now,
    management: Object.freeze({
      supported: false,
      mode: PHYSICAL_DATA_MODES.bundled,
      reason: "native_physical_packs_deferred_issue_81",
    }),
  });
}
