import { expect, it } from 'vitest';
import { parseRecipients } from './recipients.js';

it('parses lines, commas and "Name <email>", dedupes and flags invalid', () => {
  const out = parseRecipients('a@x.io\nB@X.io, c@y.org; Ann <ann@z.com>\n\nnot-an-email\na@x.io\n');
  expect(out.valid).toEqual(['a@x.io', 'b@x.io', 'c@y.org', 'ann@z.com']);
  expect(out.invalid).toEqual(['not-an-email']);
  expect(out.duplicates).toBe(1);
});
