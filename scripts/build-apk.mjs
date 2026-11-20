// Builds the signed release APK and stamps it with the git hash and the build time.
//
//   npm run android:apk              build, then copy to dist-apk/
//   npm run android:apk -- --dry-run print what would happen, build nothing
//
// The same stamp goes into the app (Settings → Build) and into the file name, so an installed
// build can always be matched to a commit.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInfo } from "./build-info.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const outputDir = join(root, "dist-apk");
const releaseDir = join(root, "src-tauri/gen/android/app/build/outputs/apk/universal/release");

function fail(message) {
  console.error(`build-apk: ${message}`);
  process.exit(1);
}

function two(value) {
  return String(value).padStart(2, "0");
}

// The builder's own clock, so the file name matches what they see on their screen.
function fileStamp(date) {
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

function run(command, args, env) {
  // npm is npm.cmd on Windows, which only starts through a shell (given as one string, as Node asks).
  const viaShell = process.platform === "win32" && command === "npm";
  const result = viaShell
    ? spawnSync([command, ...args].join(" "), { cwd: root, env, stdio: "inherit", shell: true })
    : spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`\`${[command, ...args].join(" ")}\` failed${result.status ? ` (exit ${result.status})` : ""}`);
  }
}

const info = buildInfo();
const stamp = `${info.version} · ${info.hash} · ${info.time}`;
const fileName = `fast-share-${info.version}-${info.hash}-${fileStamp(new Date(info.time))}.apk`;
const target = join(outputDir, fileName);

console.log(`Building Fast Share ${stamp}`);
if (info.hash.endsWith("-dirty")) {
  console.log("Note: the working tree has uncommitted changes (the hash ends in -dirty).");
}
console.log(`Output: ${target}`);

// The one environment every step shares, so vite embeds exactly what the file name says.
const env = {
  ...process.env,
  FAST_SHARE_GIT_HASH: info.hash,
  FAST_SHARE_BUILD_TIME: info.time,
};
// `cargo` often is not on PATH in a fresh terminal on Windows.
const cargoBin = join(process.env.USERPROFILE || process.env.HOME || "", ".cargo", "bin");
if (existsSync(cargoBin) && !(env.PATH || env.Path || "").split(delimiter).includes(cargoBin)) {
  env.PATH = `${cargoBin}${delimiter}${env.PATH || env.Path || ""}`;
}

if (!existsSync(join(root, "src-tauri/gen/android"))) {
  fail("no generated Android project yet. Run `npm run tauri android init` once, then try again.");
}
if (!existsSync(join(root, "node_modules"))) {
  fail("node modules are missing. Run `npm install` first.");
}
if (spawnSync("cargo", ["--version"], { env, stdio: "ignore" }).status !== 0) {
  fail("`cargo` was not found. Install Rust (https://rustup.rs) or add %USERPROFILE%\\.cargo\\bin to PATH.");
}

if (dryRun) {
  console.log("Dry run: nothing was built. Steps would be:");
  console.log("  1. copy the native Android sources into the generated project");
  console.log("  2. attach release signing");
  console.log("  3. tauri android build --apk --target aarch64");
  console.log(`  4. copy the signed APK to dist-apk/${fileName}`);
  process.exit(0);
}

run(process.execPath, [join(root, "scripts/setup-android-native.mjs")], env);
run(process.execPath, [join(root, "scripts/setup-android-signing.mjs")], env);
run("npm", ["run", "tauri", "--", "android", "build", "--apk", "--target", "aarch64"], env);

const apk = join(releaseDir, "app-universal-release.apk");
if (!existsSync(apk)) {
  const unsigned = existsSync(join(releaseDir, "app-universal-release-unsigned.apk"));
  fail(
    unsigned
      ? "only an unsigned APK came out, which a phone will not install. Check the signing setup in README."
      : `no APK at ${apk}.`,
  );
}

mkdirSync(outputDir, { recursive: true });
copyFileSync(apk, target);
const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
console.log("");
console.log(`APK:    ${target}`);
console.log(`Size:   ${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA256: ${sha256}`);
console.log(`Stamp:  ${stamp}`);
