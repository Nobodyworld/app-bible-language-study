import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLS_ROOT = path.join(REPO_ROOT, ".desktop-tools");
const TAURI_DRIVER_VERSION = "2.0.6";

function executable(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function powerShellExecutable() {
  return "pwsh.exe";
}

async function exists(candidate) {
  return fs.stat(candidate).then((stat) => stat.isFile(), () => false);
}

function semanticVersionSort(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

async function installedWebViewVersion() {
  const candidates = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
  ].filter(Boolean).map((root) => path.join(root, "Microsoft", "EdgeWebView", "Application"));
  const versions = [];
  for (const root of candidates) {
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name)) versions.push(entry.name);
    }
  }
  versions.sort(semanticVersionSort);
  if (!versions.length) throw new Error("Microsoft Edge WebView2 Evergreen Runtime was not found.");
  return versions[0];
}

async function installTauriDriver() {
  const root = path.join(TOOLS_ROOT, "tauri-driver");
  const binary = path.join(root, "bin", executable("tauri-driver"));
  if (!await exists(binary)) {
    await new Promise((resolve, reject) => {
      const child = spawn("cargo", ["install", "tauri-driver", "--version", TAURI_DRIVER_VERSION, "--locked", "--root", root], {
        cwd: REPO_ROOT,
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`cargo install tauri-driver exited ${code}.`)));
    });
  }
  const { stdout, stderr } = await execFileAsync(binary, ["--help"], { windowsHide: true });
  if (!`${stdout}${stderr}`.includes("--native-driver")) throw new Error("The project-local tauri-driver contract is not supported.");
  return { binary, version: TAURI_DRIVER_VERSION };
}

async function verifyMicrosoftSignature(driver) {
  if (process.platform !== "win32") return;
  const script = "$driver = [Environment]::GetEnvironmentVariable('BIBLEAPP_EDGE_DRIVER_PATH'); $signature = Get-AuthenticodeSignature -LiteralPath $driver; [pscustomobject]@{ Status = [string]$signature.Status; Subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(powerShellExecutable(), ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, BIBLEAPP_EDGE_DRIVER_PATH: driver },
    windowsHide: true,
  });
  const signature = JSON.parse(stdout.trim());
  if (signature.Status !== "Valid" || !/Microsoft Corporation/i.test(signature.Subject)) {
    throw new Error("The downloaded Edge WebDriver does not have a valid Microsoft signature.");
  }
}

async function installEdgeDriver(version) {
  const root = path.join(TOOLS_ROOT, "edgedriver", version);
  const binary = path.join(root, executable("msedgedriver"));
  const downloadRoot = path.join(TOOLS_ROOT, "downloads");
  const archive = path.join(downloadRoot, `edgedriver-win64-${version}.zip`);
  if (!await exists(binary)) {
    await fs.mkdir(downloadRoot, { recursive: true });
    const response = await fetch(`https://msedgedriver.microsoft.com/${encodeURIComponent(version)}/edgedriver_win64.zip`);
    if (!response.ok) throw new Error(`Microsoft Edge WebDriver download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(archive, bytes, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      await fs.writeFile(archive, bytes);
    });
    await fs.mkdir(root, { recursive: true });
    const script = "$archive = [Environment]::GetEnvironmentVariable('BIBLEAPP_EDGE_DRIVER_ARCHIVE'); $destination = [Environment]::GetEnvironmentVariable('BIBLEAPP_EDGE_DRIVER_DESTINATION'); Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force";
    await execFileAsync(powerShellExecutable(), ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, BIBLEAPP_EDGE_DRIVER_ARCHIVE: archive, BIBLEAPP_EDGE_DRIVER_DESTINATION: root },
      windowsHide: true,
    });
  }
  await verifyMicrosoftSignature(binary);
  const { stdout } = await execFileAsync(binary, ["--version"], { windowsHide: true });
  if (!stdout.includes(version)) throw new Error(`Edge WebDriver ${stdout.trim()} does not match WebView2 ${version}.`);
  const bytes = await fs.readFile(binary);
  return { binary, version, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function ensureDesktopWebDriverTooling() {
  if (process.platform !== "win32" || os.arch() !== "x64") throw new Error("Desktop WebDriver testing requires Windows x64.");
  await fs.mkdir(TOOLS_ROOT, { recursive: true });
  const webviewVersion = await installedWebViewVersion();
  const [tauriDriver, edgeDriver] = await Promise.all([
    installTauriDriver(),
    installEdgeDriver(webviewVersion),
  ]);
  return { toolsRoot: TOOLS_ROOT, webviewVersion, tauriDriver, edgeDriver };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await ensureDesktopWebDriverTooling(), null, 2));
}
