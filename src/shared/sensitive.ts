// Spotting text that should not sit in plain view (links with tokens, API keys, passwords)
// and masking its middle. Self-check: `node scripts/check-sensitive.ts`.

// Well-known secret prefixes: OpenAI/Stripe, GitHub, Slack, AWS, Google, JWT.
const SECRET_PREFIX = /^(sk-|sk_|pk_|rk_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abpr]-|AKIA|ASIA|AIza|eyJ)/;
const SECRET_PARAM = /token|key|secret|sig|signature|auth|code|pass|session|jwt/i;
const MASK = "*****";

/** A long run of letters and digits mixed together, the shape of a key or a token. */
function looksRandom(part: string): boolean {
  return part.length >= 16 && /[A-Za-z]/.test(part) && /\d/.test(part);
}

/** One word that mixes at least three of: lower case, upper case, digits, symbols. */
function looksLikePassword(word: string): boolean {
  if (word.length < 8 || word.length > 64) {
    return false;
  }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((kind) => kind.test(word));
  return kinds.length >= 3;
}

export function looksSensitive(text: string): boolean {
  const value = text.trim();
  // Sentences and multi-line notes are ordinary text.
  if (value.length < 8 || /\s/.test(value)) {
    return false;
  }
  if (SECRET_PREFIX.test(value)) {
    return true;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      for (const [name, param] of url.searchParams) {
        if ((SECRET_PARAM.test(name) && param.length > 0) || looksRandom(param)) {
          return true;
        }
      }
      return url.pathname.split("/").some(looksRandom) || looksRandom(url.hash.slice(1));
    } catch {
      return false;
    }
  }
  return looksRandom(value) || looksLikePassword(value);
}

/** Keeps a little of each end so the user can still tell items apart: "https:/*****vCaD/". */
export function mask(text: string): string {
  const value = text.trim();
  if (value.length <= 2) {
    return MASK;
  }
  const keep = Math.min(8, Math.max(1, Math.floor(value.length * 0.2)));
  return `${value.slice(0, keep)}${MASK}${value.slice(value.length - keep)}`;
}
