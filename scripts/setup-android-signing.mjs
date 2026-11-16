import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gradle = join(root, "src-tauri/gen/android/app/build.gradle.kts");
const manifest = join(root, "src-tauri/gen/android/app/src/main/AndroidManifest.xml");
const mainActivity = join(
  root,
  "src-tauri/gen/android/app/src/main/java/com/alexnguyen03/fastshare/MainActivity.kt",
);
const marker = 'apply(from = file("../../../../scripts/android-signing.gradle"))';

if (!existsSync(gradle)) {
  console.error("No generated Android project yet. Run `npm run tauri android init`, then run this script again.");
  process.exit(1);
}

let changed = false;

const gradleText = readFileSync(gradle, "utf8");
let nextGradle = gradleText;
if (!nextGradle.includes("android-signing.gradle")) {
  nextGradle = `${nextGradle.trimEnd()}\n\n${marker}\n`;
  changed = true;
}
if (/getByName\("release"\)[\s\S]*?enable = true/.test(nextGradle)) {
  nextGradle = nextGradle.replace(
    /(getByName\("release"\)[\s\S]*?)enable = true/,
    "$1enable = false",
  );
  changed = true;
}
if (nextGradle !== gradleText) {
  writeFileSync(gradle, nextGradle);
}

if (existsSync(manifest)) {
  let xml = readFileSync(manifest, "utf8");
  if (!xml.includes("http://schemas.android.com/tools")) {
    xml = xml.replace(
      'xmlns:android="http://schemas.android.com/apk/res/android"',
      'xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"',
    );
    changed = true;
  }
  if (!xml.includes("android.permission.CAMERA")) {
    xml = xml.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      `<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-feature android:name="android.hardware.camera.any" android:required="false" tools:replace="android:required" />`,
    );
    changed = true;
  }
  writeFileSync(manifest, xml);
}

if (existsSync(mainActivity)) {
  let kotlin = readFileSync(mainActivity, "utf8");
  if (!kotlin.includes("Manifest.permission.CAMERA")) {
    const cameraBlock = `    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      needed.add(Manifest.permission.CAMERA)
    }
    if (needed.isNotEmpty()) {`;
    const next = kotlin.replace("    if (needed.isNotEmpty()) {", cameraBlock);
    if (next !== kotlin) {
      writeFileSync(mainActivity, next);
      changed = true;
    }
  }
}

console.log(
  changed
    ? "Attached Android signing, camera permission, and barcode keep rules."
    : "Android sideload config already attached.",
);
