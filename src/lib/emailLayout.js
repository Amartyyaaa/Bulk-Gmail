// Turns the visual editor's plain HTML into email-safe HTML (inline styles,
// table wrapper) and back again. Email clients ignore <style> blocks, so every
// element gets its styles inline.

import { PLAIN_MARKER } from '@shared/render.js';

export const VISUAL_MARKER = '<!--mailroom:visual-->';

/**
 * 'plain' sends the text as a normal-looking personal email (better odds of
 * Gmail's Primary tab); 'designed' wraps it in a branded card layout.
 */
export const EMAIL_STYLES = [
  { value: 'plain', label: 'Personal (plain)' },
  { value: 'designed', label: 'Designed' },
];

export function emailStyleOf(html) {
  return String(html ?? '').includes(PLAIN_MARKER) ? 'plain' : 'designed';
}

const BODY_START = '<!--mr-body-->';
const BODY_END = '<!--/mr-body-->';

const ACCENT = '#4f46e5';

const TAG_STYLES = {
  p: 'margin:0 0 16px;font-size:16px;line-height:24px;',
  h1: 'margin:0 0 16px;font-size:26px;line-height:34px;font-weight:bold;color:#111827;',
  h2: 'margin:24px 0 12px;font-size:20px;line-height:28px;font-weight:bold;color:#111827;',
  h3: 'margin:20px 0 8px;font-size:17px;line-height:24px;font-weight:bold;color:#111827;',
  ul: 'margin:0 0 16px;padding-left:24px;',
  ol: 'margin:0 0 16px;padding-left:24px;',
  li: 'margin:0 0 6px;font-size:16px;line-height:24px;',
  blockquote: 'margin:0 0 16px;padding:8px 16px;border-left:4px solid #e5e7eb;color:#4b5563;',
  a: `color:${ACCENT};text-decoration:underline;`,
  img: 'max-width:100%;height:auto;display:block;border:0;margin:0 auto 16px;',
  hr: 'border:0;border-top:1px solid #e5e7eb;margin:24px 0;',
};

// Personal style: close to what a mail client produces when you type an email.
const PLAIN_TAG_STYLES = {
  p: 'margin:0 0 12px;',
  h1: 'margin:0 0 12px;font-size:20px;line-height:28px;font-weight:bold;',
  h2: 'margin:16px 0 8px;font-size:17px;line-height:24px;font-weight:bold;',
  h3: 'margin:12px 0 6px;font-size:15px;line-height:22px;font-weight:bold;',
  ul: 'margin:0 0 12px;padding-left:24px;',
  ol: 'margin:0 0 12px;padding-left:24px;',
  li: 'margin:0 0 4px;',
  blockquote: 'margin:0 0 12px;padding-left:12px;border-left:3px solid #cccccc;color:#555555;',
  a: 'color:#1155cc;',
  img: 'max-width:100%;height:auto;border:0;',
  hr: 'border:0;border-top:1px solid #dddddd;margin:16px 0;',
};

const BUTTON_STYLE =
  `display:inline-block;padding:12px 24px;background:${ACCENT};color:#ffffff;` +
  'text-decoration:none;font-weight:bold;border-radius:6px;';

export const BUTTON_CLASS = 'mr-button';

export const STARTER_VISUAL = [
  '<h1>Hi {{first_name|there}},</h1>',
  '<p>Here’s what’s new this month. Replace this text with your message.</p>',
  '<p>Keep paragraphs short and put one clear call to action front and centre.</p>',
  `<p style="text-align: center"><a class="${BUTTON_CLASS}" href="https://example.com">Read more</a></p>`,
  '<p>Thanks,<br>The {{company_name}} team</p>',
].join('');

export function isVisualHtml(html) {
  return String(html ?? '').includes(VISUAL_MARKER);
}

/** The editor content stored inside a visual email, or null if it isn't one. */
export function extractVisualBody(html) {
  const s = String(html ?? '');
  const start = s.indexOf(BODY_START);
  const end = s.indexOf(BODY_END);
  if (!isVisualHtml(s) || start === -1 || end < start) return null;
  return s.slice(start + BODY_START.length, end);
}

/** Wrap editor HTML into the full, inline-styled email document. */
export function buildVisualEmail(bodyHtml, { style = 'designed' } = {}) {
  const plain = style === 'plain';
  const doc = new DOMParser().parseFromString(`<div id="root">${bodyHtml ?? ''}</div>`, 'text/html');
  const root = doc.getElementById('root');

  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    // In personal style a "button" is just a normal link.
    const isButton = !plain && tag === 'a' && el.classList.contains(BUTTON_CLASS);
    const base = isButton ? BUTTON_STYLE : (plain ? PLAIN_TAG_STYLES : TAG_STYLES)[tag];
    if (base) {
      // Keep editor-set styles (alignment, colour) after the defaults so they win.
      el.setAttribute('style', base + (el.getAttribute('style') ?? ''));
    }
    if (tag === 'a') el.setAttribute('target', '_blank');
    // An empty paragraph is a deliberate blank line; give it height in email clients.
    if (tag === 'p' && !el.textContent.trim() && !el.querySelector('img, br')) el.innerHTML = '&nbsp;';
  });

  if (plain) {
    return (
      VISUAL_MARKER +
      PLAIN_MARKER +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#222222;">' +
      BODY_START +
      root.innerHTML +
      BODY_END +
      '</div>'
    );
  }

  return (
    VISUAL_MARKER +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;">' +
    '<tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:600px;background:#ffffff;border-radius:8px;">' +
    '<tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1f2937;">' +
    BODY_START +
    root.innerHTML +
    BODY_END +
    '</td></tr></table></td></tr></table>'
  );
}
