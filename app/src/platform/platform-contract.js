const REQUIRED_PLATFORM_SERVICES = Object.freeze([
  "environment",
  "userStorage",
  "files",
  "data",
  "physicalPacks",
  "notifications",
]);

const REQUIRED_METHODS = Object.freeze({
  userStorage: ["initialize", "readCurrent", "save", "status"],
  files: ["saveTextFile", "openTextFile", "readTextFile", "copyText"],
  data: ["fetchResponse", "fetchJson"],
  notifications: ["listen", "publish"],
});

export class PlatformContractError extends Error {
  constructor(diagnostics) {
    super(`Platform contract validation failed:\n${diagnostics.map((item) => `- ${item}`).join("\n")}`);
    this.name = "PlatformContractError";
    this.diagnostics = diagnostics;
  }
}

export function validatePlatformContract(platform) {
  const diagnostics = [];
  if (!platform || typeof platform !== "object") return ["Platform must be an object."];
  if (!platform.kind) diagnostics.push("platform.kind is required.");
  if (!platform.profile?.id) diagnostics.push("platform.profile.id is required.");
  for (const service of REQUIRED_PLATFORM_SERVICES) {
    if (!platform[service]) diagnostics.push(`platform.${service} is required.`);
  }
  for (const [service, methods] of Object.entries(REQUIRED_METHODS)) {
    for (const method of methods) {
      if (typeof platform?.[service]?.[method] !== "function") diagnostics.push(`platform.${service}.${method} must be a function.`);
    }
  }
  const physical = platform.physicalPacks;
  for (const service of ["registry", "bytes", "source", "digest", "storageEstimate", "cancellation"]) {
    if (!physical?.[service]) diagnostics.push(`platform.physicalPacks.${service} is required.`);
  }
  const environment = platform.environment;
  for (const key of ["platformKind", "applicationId", "applicationVersion", "profileId", "baseUrl", "supportedCapabilities", "persistentDataPath", "logsPath", "temporaryPath", "distributionPath"]) {
    if (!Object.prototype.hasOwnProperty.call(environment || {}, key)) diagnostics.push(`platform.environment.${key} is required.`);
  }
  return diagnostics;
}

export function assertPlatformContract(platform) {
  const diagnostics = validatePlatformContract(platform);
  if (diagnostics.length) throw new PlatformContractError(diagnostics);
  return platform;
}
