import { isValidEmail } from '@shared/render.js';

/**
 * Parse a pasted recipient list: one per line (commas/semicolons also work),
 * optionally "Name <email>". Returns unique valid emails plus what was dropped.
 */
export function parseRecipients(text) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  let duplicates = 0;

  for (const raw of String(text ?? '').split(/[\n,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const email = (token.match(/<([^>]+)>/)?.[1] ?? token).trim().toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(token);
    } else if (seen.has(email)) {
      duplicates++;
    } else {
      seen.add(email);
      valid.push(email);
    }
  }
  return { valid, invalid, duplicates };
}
