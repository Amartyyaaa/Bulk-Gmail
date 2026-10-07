// Email rendering shared by the Edge Functions (Deno) and the React preview
// (Vite imports this file directly), so the preview is exactly what gets sent.
// Plain JS with no imports so it runs unchanged in both runtimes.

/** Merge tags the editor offers. `{{tag|fallback}}` supplies a default. */
export const MERGE_TAGS = [
  { tag: 'first_name', label: 'First name' },
  { tag: 'last_name', label: 'Last name' },
  { tag: 'full_name', label: 'Full name' },
  { tag: 'email', label: 'Email' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe URL' },
  { tag: 'company_name', label: 'Company name' },
];

const TAG_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function mergeVars(contact = {}, extra = {}) {
  const first = (contact.first_name || '').trim();
  const last = (contact.last_name || '').trim();
  return {
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(' '),
    email: contact.email || '',
    ...extra,
  };
}

/**
 * Replace merge tags. Values are HTML-escaped when `html` is true, so contact
 * data from a CSV can never inject markup into an email.
 */
export function applyMergeTags(template, vars, { html = true } = {}) {
  return String(template ?? '').replace(TAG_RE, (_m, name, fallback) => {
    const key = name.toLowerCase();
    const raw = vars[key];
    // A function value emits provider markup itself (see resendBroadcastVars).
    if (typeof raw === 'function') return raw(fallback ?? '', html);
    const value = raw === undefined || raw === null || raw === '' ? (fallback ?? '') : String(raw);
    return html ? escapeHtml(value) : value;
  });
}

/**
 * Merge-tag values for a Resend Broadcast: one HTML body goes to the whole
 * segment, and Resend fills in each contact's details with its own
 * triple-brace placeholders. Unsubscribes go through Resend's hosted link.
 */
export const RESEND_UNSUBSCRIBE_URL = '{{{RESEND_UNSUBSCRIBE_URL}}}';

export function resendBroadcastVars(settings = {}) {
  // Resend's placeholder syntax ends at "}}}", so keep fallbacks free of braces.
  const placeholder = (name) => (fallback, html = true) => {
    const clean = String(fallback).replace(/[{}|]/g, '');
    const fb = html ? escapeHtml(clean) : clean;
    return fb ? `{{{${name}|${fb}}}}` : `{{{${name}}}}`;
  };
  return {
    first_name: placeholder('FIRST_NAME'),
    last_name: placeholder('LAST_NAME'),
    full_name: (fallback, html) => `${placeholder('FIRST_NAME')(fallback, html)} {{{LAST_NAME}}}`,
    email: placeholder('EMAIL'),
    unsubscribe_url: () => RESEND_UNSUBSCRIBE_URL,
    company_name: settings.company_name || '',
  };
}

/** Tags used in a template that we don't know how to fill. */
export function unknownMergeTags(template) {
  const known = new Set(MERGE_TAGS.map((t) => t.tag));
  const found = new Set();
  for (const m of String(template ?? '').matchAll(TAG_RE)) {
    if (!known.has(m[1].toLowerCase())) found.add(m[1]);
  }
  return [...found];
}

/** Marks an email written in the plain "personal" style (see src/lib/emailLayout.js). */
export const PLAIN_MARKER = '<!--mailroom:plain-->';

/** Footer for personal-style emails: a quiet line of text, like a normal signature. */
export function plainFooter({ companyName, physicalAddress, unsubscribeUrl }) {
  const who = [companyName, physicalAddress].filter(Boolean).map(escapeHtml).join(', ');
  return (
    '<p style="margin:28px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#888888;">' +
    (who ? `${who}<br>` : '') +
    `Don’t want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Unsubscribe</a>` +
    '</p>'
  );
}

export function complianceFooter({ companyName, physicalAddress, unsubscribeUrl }) {
  const who = [companyName, physicalAddress].filter(Boolean).map(escapeHtml).join(' &middot; ');
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="margin-top:32px;border-top:1px solid #e5e7eb;">' +
    '<tr><td style="padding:16px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;' +
    'line-height:18px;color:#6b7280;text-align:center;">' +
    (who ? `${who}<br>` : '') +
    'You are receiving this email because you opted in to hear from us.<br>' +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
    '</td></tr></table>'
  );
}

function preheaderBlock(text) {
  if (!text) return '';
  return (
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">' +
    escapeHtml(text) +
    '&#847;&zwnj;&nbsp;'.repeat(30) +
    '</div>'
  );
}

/**
 * Build the final email for one recipient: merge tags, preheader, and the
 * mandatory sender-identity + unsubscribe footer (always appended, even if the
 * template already links {{unsubscribe_url}}).
 *
 * `vars` replaces the per-contact values, e.g. with resendBroadcastVars().
 *
 * @param {{ campaign: any, contact: any, settings?: any, unsubscribeUrl: string, vars?: Record<string, any> }} opts
 */
export function renderEmail({ campaign, contact, settings = {}, unsubscribeUrl, vars: varsOverride }) {
  const vars = varsOverride ?? mergeVars(contact, {
    unsubscribe_url: unsubscribeUrl,
    company_name: settings.company_name || '',
  });
  const body = applyMergeTags(campaign.html, vars, { html: true });
  const footerFn = String(campaign.html ?? '').includes(PLAIN_MARKER) ? plainFooter : complianceFooter;
  const footer = footerFn({
    companyName: settings.company_name,
    physicalAddress: settings.physical_address,
    unsubscribeUrl,
  });
  const pre = preheaderBlock(applyMergeTags(campaign.preheader, vars, { html: false }));

  let html;
  if (/<\/body>/i.test(body)) {
    html = body.replace(/<body([^>]*)>/i, (m) => m + pre).replace(/<\/body>/i, `${footer}</body>`);
  } else {
    html =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      `<body style="margin:0;padding:0;">${pre}${body}${footer}</body></html>`;
  }

  return {
    subject: applyMergeTags(campaign.subject, vars, { html: false }),
    html,
    text: htmlToText(html),
  };
}

/** Rough plain-text alternative; a text part improves deliverability. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&#847;|&zwnj;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value ?? '').trim());
}
