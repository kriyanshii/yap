export const STYLE_PREFIX =
  "simple scene, no text in the image, no letters, no watermark, no UI, no toolbar, no screenshot of a computer: ";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const SUFFIXES = new Set([
  "s",
  "es",
  "ed",
  "ing",
  "er",
  "ers",
  "ies",
  "ied",
  "ly",
  "y",
  "ning",
]);

function stemHit(token: string, ban: string): boolean {
  if (token === ban) return true;
  if (token.startsWith(ban)) {
    const rest = token.slice(ban.length);
    if (SUFFIXES.has(rest)) return true;
  }
  if (ban.length >= 2) {
    const last = ban[ban.length - 1];
    if (token.startsWith(ban + last)) {
      const rest = token.slice(ban.length + 1);
      if (rest === "ed" || rest === "ing" || rest === "er" || rest === "ers") {
        return true;
      }
    }
  }
  return false;
}

export function hitsBanned(utterance: string, banned: string[]): boolean {
  const lower = utterance.toLowerCase();
  const tokens = tokenize(utterance);
  for (const raw of banned) {
    const ban = raw.toLowerCase().trim();
    if (!ban) continue;
    if (ban.includes(" ")) {
      const pattern = ban
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      if (new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i").test(lower)) {
        return true;
      }
      continue;
    }
    for (const token of tokens) {
      if (stemHit(token, ban)) return true;
    }
  }
  return false;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

export function normalizeGuess(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsMatch(guess: string, clue: string): boolean {
  if (guess === clue) return true;
  if (Math.max(guess.length, clue.length) >= 5 && levenshtein(guess, clue) <= 1) {
    return true;
  }
  return false;
}

export function fuzzyMatch(guess: string, clue: string): boolean {
  const g = normalizeGuess(guess);
  const c = normalizeGuess(clue);
  if (!g || !c) return false;
  if (g === c) return true;
  if (c.length >= 5 && levenshtein(g, c) <= 1) return true;

  const gw = g.split(" ");
  const cw = c.split(" ");
  if (gw.length === cw.length) {
    return gw.every((word, i) => wordsMatch(word, cw[i]));
  }
  return false;
}

export function sillyFilename(clue: string): string {
  const words = normalizeGuess(clue)
    .split(" ")
    .filter((w) => !["of", "on", "in", "with", "and", "to", "for", "from"].includes(w));
  const pick =
    words.length <= 2 ? words : [words[0], words[words.length - 1]];
  const base = pick.join(" ").trim() || "mystery";
  return `${base}.bmp`;
}
