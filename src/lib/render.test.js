import { describe, expect, it } from 'vitest';
import {
  RESEND_UNSUBSCRIBE_URL, applyMergeTags, htmlToText, isValidEmail, renderEmail, resendBroadcastVars, unknownMergeTags,
} from '@shared/render.js';

const settings = { company_name: 'Acme', physical_address: '1 Main St, Springfield' };

describe('merge tags', () => {
  it('fills tags and fallbacks', () => {
    expect(applyMergeTags('Hi {{first_name|there}}!', { first_name: 'Ada' })).toBe('Hi Ada!');
    expect(applyMergeTags('Hi {{ first_name | there }}!', { first_name: '' })).toBe('Hi there!');
  });

  it('escapes contact data in HTML to prevent injection', () => {
    expect(applyMergeTags('<p>{{first_name}}</p>', { first_name: '<script>x</script>' })).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('does not escape in plain-text contexts like the subject', () => {
    expect(applyMergeTags('{{first_name}} & co', { first_name: 'A&B' }, { html: false })).toBe('A&B & co');
  });

  it('reports unknown tags', () => {
    expect(unknownMergeTags('{{first_name}} {{favourite_colour}}')).toEqual(['favourite_colour']);
  });
});

describe('renderEmail', () => {
  const campaign = { subject: 'Hello {{first_name}}', preheader: 'Inside', html: '<p>Hi {{first_name|friend}}</p>' };

  it('always appends the compliance footer with unsubscribe link and address', () => {
    const out = renderEmail({ campaign, contact: { first_name: 'Ada' }, settings, unsubscribeUrl: 'https://x.test/u?t=1&r=2' });
    expect(out.subject).toBe('Hello Ada');
    expect(out.html).toContain('<p>Hi Ada</p>');
    expect(out.html).toContain('href="https://x.test/u?t=1&amp;r=2"');
    expect(out.html).toContain('1 Main St, Springfield');
    expect(out.text).toContain('Unsubscribe (https://x.test/u?t=1&r=2)');
  });

  it('injects footer before </body> for full documents', () => {
    const out = renderEmail({
      campaign: { ...campaign, html: '<html><body><p>x</p></body></html>' },
      contact: {},
      settings,
      unsubscribeUrl: 'u',
    });
    expect(out.html.indexOf('Unsubscribe')).toBeLessThan(out.html.indexOf('</body>'));
    expect(out.html.match(/<body/g)).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('validates emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('bad@')).toBe(false);
    expect(isValidEmail('no spaces@x.com')).toBe(false);
  });

  it('converts html to text', () => {
    expect(htmlToText('<p>One</p><p>Two <a href="https://x.y">link</a></p>')).toBe('One\nTwo link (https://x.y)');
  });
});

describe('Resend Broadcast rendering', () => {
  it('turns merge tags into Resend placeholders and uses Resend’s unsubscribe link', () => {
    const out = renderEmail({
      campaign: { subject: 'Hi {{first_name|friend}}', preheader: '', html: '<p>Hi {{first_name|there}}, {{email}} at {{company_name}}</p><a href="{{unsubscribe_url}}">x</a>' },
      contact: {},
      settings: { company_name: 'Grey & Co', physical_address: 'Patna' },
      unsubscribeUrl: RESEND_UNSUBSCRIBE_URL,
      vars: resendBroadcastVars({ company_name: 'Grey & Co' }),
    });
    expect(out.subject).toBe('Hi {{{FIRST_NAME|friend}}}');
    expect(out.html).toContain('Hi {{{FIRST_NAME|there}}}, {{{EMAIL}}} at Grey &amp; Co');
    expect(out.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(out.html).not.toContain('{{unsubscribe_url}}');
  });

  it('strips braces from fallbacks so they cannot break the placeholder', () => {
    const vars = resendBroadcastVars();
    expect(vars.first_name('a}}}b')).toBe('{{{FIRST_NAME|ab}}}');
    expect(vars.first_name('')).toBe('{{{FIRST_NAME}}}');
  });
});
