export const BUILD = {
  version: __APP_VERSION__,
  hash: __GIT_HASH__,
  /** UTC, ISO 8601. */
  time: __BUILD_TIME__,
};

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** The build time in the viewer's own time zone, e.g. `2026-11-20 16:30`. */
export function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** What Settings shows to tell one build from another: `abc1234 · 2026-11-20 16:30`. */
export function buildLabel(): string {
  return `${BUILD.hash} · ${formatBuildTime(BUILD.time)}`;
}
