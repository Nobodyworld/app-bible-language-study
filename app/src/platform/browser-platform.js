import { CAPABILITY_REGISTRY } from "../capabilities.js";
import { resolveBrowserFeatureProfile, resolveTestFeatureProfile } from "../feature-profiles.js";
import { createPhysicalPackRegistry } from "../physical-pack-registry.js";
import { assertPlatformContract } from "./platform-contract.js";
import { createBrowserDataAdapter } from "./browser-data.js";
import { createBrowserFileService } from "./browser-files.js";
import { createBrowserUserStorageAdapter } from "./browser-user-storage.js";
import {
  createCacheStoragePhysicalByteStore,
  createCancellationService,
  createFetchSourceService,
  createStorageEstimateService,
  createWebDigestService,
} from "./physical-services.js";
import { storageIdentitiesForProfile } from "./storage-identities.js";

export function createBrowserPlatform(options = {}) {
  const browserWindow = options.windowObject || globalThis.window;
  const browserDocument = options.documentObject || browserWindow.document;
  const currentUrl = options.currentUrl || browserWindow.location.href;
  const parsedCurrentUrl = new URL(currentUrl);
  const fixedDisabledTestProfile =
    ["127.0.0.1", "localhost"].includes(parsedCurrentUrl.hostname) &&
    browserWindow.__BIBLEAPP_TEST_DISABLED_OPTIONAL_PROFILE__ === true;
  const profile = options.profile || (fixedDisabledTestProfile
    ? resolveTestFeatureProfile("stable", ["search", "commentary", "cross-references", "outlines"])
    : resolveBrowserFeatureProfile(currentUrl));
  const identities = storageIdentitiesForProfile(profile.id);
  const baseUrl = new URL(options.baseUrl || "./", browserDocument.baseURI);
  const userStorage = options.userStorage || createBrowserUserStorageAdapter({
    profileId: profile.id,
    windowObject: browserWindow,
    identities,
  });
  const data = options.data || createBrowserDataAdapter({ windowObject: browserWindow });
  const bytes = options.physicalByteStore || createCacheStoragePhysicalByteStore(browserWindow.caches, {
    ResponseImpl: browserWindow.Response,
  });
  const notifications = Object.freeze({
    identity: identities.notificationChannel,
    listen: (listener) => userStorage.listen(listener),
    publish: (storeName) => userStorage.publish(storeName),
  });
  const environment = Object.freeze({
    platformKind: "browser",
    applicationId: "bibleapp",
    applicationVersion: options.applicationVersion || "1.0.0",
    profileId: profile.id,
    baseUrl: baseUrl.href,
    currentUrl,
    supportedCapabilities: Object.freeze(CAPABILITY_REGISTRY.map((item) => item.capability_id)),
    persistentDataPath: null,
    logsPath: null,
    temporaryPath: null,
    distributionPath: null,
  });
  return assertPlatformContract(Object.freeze({
    kind: "browser",
    profile,
    environment,
    userStorage,
    files: options.files || createBrowserFileService({ windowObject: browserWindow }),
    data,
    notifications,
    physicalPacks: Object.freeze({
      registry: options.physicalRegistry || createPhysicalPackRegistry({
        indexedDb: browserWindow.indexedDB,
        dbName: identities.physicalRegistryDatabase,
      }),
      bytes,
      byteStoreIdentityPrefix: identities.physicalBytePrefix,
      source: options.physicalSource || createFetchSourceService(browserWindow.fetch?.bind(browserWindow)),
      digest: options.digest || createWebDigestService(browserWindow.crypto),
      storageEstimate: options.storageEstimate || createStorageEstimateService(browserWindow.navigator?.storage),
      cancellation: options.cancellation || createCancellationService(),
      baseUrl: baseUrl.href,
      clock: options.clock || Date.now,
    }),
  }));
}
