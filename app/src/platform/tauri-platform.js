import { CAPABILITY_REGISTRY } from "../capabilities.js";
import { resolveFeatureProfile } from "../feature-profiles.js";
import { assertPlatformContract } from "./platform-contract.js";
import { createTauriDataAdapter } from "./tauri-data.js";
import { createTauriFileService } from "./tauri-files.js";
import { createTauriPhysicalPackServices } from "./tauri-physical.js";
import { createTauriRuntimeService } from "./tauri-runtime.js";
import { createTauriUserStorageAdapter } from "./tauri-user-storage.js";

const REQUIRED_ENVIRONMENT_FIELDS = Object.freeze([
  "applicationId",
  "applicationVersion",
  "profileId",
  "persistentDataPath",
  "logsPath",
  "temporaryPath",
  "distributionPath",
]);

function validateEnvironment(value) {
  if (!value || typeof value !== "object") throw new Error("The native environment response is missing.");
  for (const field of REQUIRED_ENVIRONMENT_FIELDS) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`The native environment response is missing ${field}.`);
  }
  return value;
}

export async function createTauriPlatform(options = {}) {
  if (!options.bridge?.invoke) throw new TypeError("A validated Tauri bridge is required.");
  const windowObject = options.windowObject || globalThis.window;
  const documentObject = options.documentObject || windowObject.document;
  const currentUrl = options.currentUrl || windowObject.location.href;
  const nativeEnvironment = validateEnvironment(await options.bridge.invoke("desktop_environment", {}));
  const profile = resolveFeatureProfile(nativeEnvironment.profileId);
  if (profile.id !== nativeEnvironment.profileId || profile.diagnostics.length) {
    throw new Error("The native environment returned an unsupported startup profile.");
  }
  const baseUrl = new URL(options.baseUrl || "./", documentObject.baseURI);
  const userStorage = createTauriUserStorageAdapter({
    bridge: options.bridge,
    profileId: profile.id,
  });
  const files = createTauriFileService({ bridge: options.bridge, windowObject });
  const data = createTauriDataAdapter({
    bridge: options.bridge,
    baseUrl: baseUrl.href,
  });
  const physicalPacks = createTauriPhysicalPackServices({
    profileId: profile.id,
    cryptoObject: windowObject.crypto,
    baseUrl: baseUrl.href,
    clock: options.clock,
  });
  const runtime = createTauriRuntimeService({
    bridge: options.bridge,
    userStorage,
    windowObject,
  });
  const notifications = Object.freeze({
    identity: userStorage.identities.notificationChannel,
    listen: (listener) => userStorage.listen(listener),
    publish: (storeName) => userStorage.publish(storeName),
  });
  const environment = Object.freeze({
    platformKind: "tauri-windows",
    applicationId: nativeEnvironment.applicationId,
    applicationVersion: nativeEnvironment.applicationVersion,
    profileId: nativeEnvironment.profileId,
    baseUrl: baseUrl.href,
    currentUrl,
    supportedCapabilities: Object.freeze(CAPABILITY_REGISTRY.map((item) => item.capability_id)),
    persistentDataPath: nativeEnvironment.persistentDataPath,
    logsPath: nativeEnvironment.logsPath,
    temporaryPath: nativeEnvironment.temporaryPath,
    distributionPath: nativeEnvironment.distributionPath,
  });
  return assertPlatformContract(Object.freeze({
    kind: "tauri-windows",
    profile,
    environment,
    userStorage,
    files,
    data,
    physicalPacks,
    notifications,
    runtime,
  }));
}
