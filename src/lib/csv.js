import Papa from 'papaparse';
import { isValidEmail } from '@shared/render.js';

const HEADER_ALIASES = {
  email: ['email', 'email address', 'e-mail', 'mail'],
  name: ['name', 'full name', 'fullname'],
  first_name: ['first_name', 'first name', 'firstname', 'given name'],
  last_name: ['last_name', 'last name', 'lastname', 'surname', 'family name'],
  tags: ['tags', 'tag', 'labels', 'segments'],
  opt_in: ['opt_in', 'opt-in', 'optin', 'subscribed', 'consent'],
};

function canonical(header) {
  const h = header.trim().toLowerCase();
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(h)) return key;
  }
  return null;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function parseTags(value) {
  return [...new Set(
    String(value || '')
      .split(/[;,|]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function parseBool(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return /^(1|true|yes|y|opted[ -]?in|subscribed)$/i.test(String(value).trim());
}

/**
 * Normalise parsed CSV rows into contacts, validating email format and
 * de-duplicating by email (case-insensitive; first occurrence wins, tags merge).
 */
export function normalizeRows(rows, fields) {
  const map = Object.fromEntries(fields.map((f) => [f, canonical(f)]));
  if (!Object.values(map).includes('email')) {
    return { error: 'No "email" column found. Expected columns: name, email, tags.' };
  }

  const valid = new Map();
  const invalid = [];
  let duplicates = 0;

  rows.forEach((raw, index) => {
    const row = {};
    for (const [field, key] of Object.entries(map)) if (key) row[key] = raw[field];

    const email = String(row.email || '').trim().toLowerCase();
    if (!email && Object.values(raw).every((v) => !String(v ?? '').trim())) return; // blank line
    if (!isValidEmail(email)) {
      invalid.push({ line: index + 2, email: row.email || '(empty)' });
      return;
    }

    const names = row.first_name || row.last_name
      ? { first_name: (row.first_name || '').trim(), last_name: (row.last_name || '').trim() }
      : splitName(row.name);
    const contact = { email, ...names, tags: parseTags(row.tags), opt_in: parseBool(row.opt_in) };

    if (valid.has(email)) {
      duplicates++;
      const existing = valid.get(email);
      existing.tags = [...new Set([...existing.tags, ...contact.tags])];
      return;
    }
    valid.set(email, contact);
  });

  return { contacts: [...valid.values()], invalid, duplicates };
}

export function parseContactsCsv(file) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => resolve(normalizeRows(result.data, result.meta.fields || [])),
      error: (err) => resolve({ error: err.message }),
    });
  });
}

export const SAMPLE_CSV = 'name,email,tags\nAda Lovelace,ada@example.com,customers;newsletter\nGrace Hopper,grace@example.com,newsletter\n';
