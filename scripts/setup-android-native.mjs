import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `tauri android init` regenerates src-tauri/gen/android, so our native code lives in android/
// and is copied over it (manifest, Kotlin, resources). Safe to run any number of times.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "android/app/src/main");
const target = join(root, "src-tauri/gen/android/app/src/main");

if (!existsSync(target)) {
  console.error("No generated Android project yet. Run `npm run tauri android init`, then run this script again.");
  process.exit(1);
}

cpSync(source, target, { recursive: true, force: true });
console.log("Copied Fast Share Android sources into the generated project.");
