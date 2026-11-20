// The stamp every build carries: version, git hash, and build time.
// Used by vite.config.ts (embeds it in the app) and scripts/build-apk.mjs (names the APK).
// FAST_SHARE_GIT_HASH and FAST_SHARE_BUILD_TIME override it so both agree on one value.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitHash() {
  const short = git(["rev-parse", "--short=7", "HEAD"]);
  if (!short) {
    return "unknown";
  }
  // Refresh first: on Windows a file whose line endings were only re-saved looks changed until then.
  git(["update-index", "-q", "--refresh"]);
  // diff-index exits 1 when tracked files differ from HEAD. Untracked files do not count.
  const clean = git(["diff-index", "--quiet", "HEAD", "--"]) !== null;
  return clean ? short : `${short}-dirty`;
}

export function buildInfo() {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    version,
    hash: process.env.FAST_SHARE_GIT_HASH || gitHash(),
    time: process.env.FAST_SHARE_BUILD_TIME || new Date().toISOString(),
  };
}
