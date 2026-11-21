// Self-check for src/shared/sensitive.ts. Run: node scripts/check-sensitive.ts (Node 23.6+ runs .ts).
import assert from "node:assert/strict";
import { looksSensitive, mask } from "../src/shared/sensitive.ts";

const sensitive = [
  "sk-proj-4f9a8b7c6d5e4f3a2b1c",
  "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
  "AKIAIOSFODNN7EXAMPLE",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
  "https://example.com/reset?token=abc",
  "https://drive.example.com/s/8fJ2kLm0pQ7rT3vCaD9x",
  "Tr0ub4dor&3x",
  "a8f5f167f44f4964e6c998dee827110c",
];
const plain = [
  "hello",
  "Meeting at 3pm tomorrow, bring the slides",
  "https://github.com/alexnguyen03/fast-share",
  "https://example.com/docs/getting-started?lang=en",
  "password",
  "0912345678",
  "line one\nline two",
];

for (const text of sensitive) {
  assert.equal(looksSensitive(text), true, `should be sensitive: ${text}`);
}
for (const text of plain) {
  assert.equal(looksSensitive(text), false, `should be plain: ${text}`);
}

assert.equal(mask("ab"), "*****");
assert.equal(mask("abc"), "a*****c");
assert.equal(mask("https://drive.example.com/s/8fJ2kLm0pQ7rT3vCaD9x"), "https://*****T3vCaD9x");
assert.ok(!mask("sk-proj-4f9a8b7c6d5e4f3a2b1c").includes("4f9a8b7c6d"));
console.log("sensitive: ok");
