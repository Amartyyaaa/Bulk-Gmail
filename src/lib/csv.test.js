import { describe, expect, it } from 'vitest';
import { normalizeRows, parseTags } from './csv.js';

describe('normalizeRows', () => {
  it('maps headers, splits names, validates and dedupes', () => {
    const rows = [
      { Name: 'Ada Lovelace', Email: 'ADA@example.com ', Tags: 'vip; newsletter' },
      { Name: 'Ada L', Email: 'ada@example.com', Tags: 'beta' },
      { Name: 'Nope', Email: 'not-an-email', Tags: '' },
      { Name: '', Email: '', Tags: '' },
    ];
    const out = normalizeRows(rows, ['Name', 'Email', 'Tags']);
    expect(out.contacts).toEqual([
      { email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', tags: ['vip', 'newsletter', 'beta'], opt_in: undefined },
    ]);
    expect(out.duplicates).toBe(1);
    expect(out.invalid).toEqual([{ line: 4, email: 'not-an-email' }]);
  });

  it('prefers explicit first/last columns and parses opt_in', () => {
    const out = normalizeRows([{ first_name: 'Grace', last_name: 'Hopper', email: 'g@x.io', opt_in: 'yes' }], ['first_name', 'last_name', 'email', 'opt_in']);
    expect(out.contacts[0]).toMatchObject({ first_name: 'Grace', last_name: 'Hopper', opt_in: true });
  });

  it('errors without an email column', () => {
    expect(normalizeRows([], ['name']).error).toMatch(/email/);
  });
});

it('parseTags lowercases and dedupes', () => {
  expect(parseTags('A, b|a ; C')).toEqual(['a', 'b', 'c']);
});
