const entries: string[] = [];
let latest = "";

export function note(message: string): void {
  latest = message;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entries.unshift(`${time}  ${message}`);
  if (entries.length > 12) {
    entries.pop();
  }
}

export function logText(): string {
  return entries.join("\n");
}

export function latestNote(): string {
  return latest;
}

export function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Something went wrong.";
}
