// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BUTTON_CLASS, STARTER_VISUAL, buildVisualEmail, emailStyleOf, extractVisualBody, isVisualHtml } from './emailLayout.js';
import { renderEmail } from '@shared/render.js';

describe('visual email layout', () => {
  it('wraps editor HTML with inline styles and round-trips the body', () => {
    const body = '<h1>Hi {{first_name}}</h1><p style="text-align: center">Hello <a href="https://x.io">link</a></p>';
    const html = buildVisualEmail(body);
    expect(isVisualHtml(html)).toBe(true);
    expect(html).toContain('max-width:600px');
    expect(html).toMatch(/<h1 style="margin:0 0 16px;[^"]*font-size:26px/);
    // editor-set alignment is kept, after the defaults so it wins
    expect(html).toMatch(/<p style="margin:0 0 16px;[^"]*text-align: center"/);
    expect(html).toContain('target="_blank"');
    const back = extractVisualBody(html);
    expect(back).toContain('{{first_name}}');
    expect(back).toContain('https://x.io');
  });

  it('styles button links as buttons', () => {
    const html = buildVisualEmail(`<p><a class="${BUTTON_CLASS}" href="https://x.io">Buy</a></p>`);
    expect(html).toMatch(/<a class="mr-button" href="https:\/\/x.io" style="display:inline-block;[^"]*background:#4f46e5/);
  });

  it('keeps empty paragraphs as visible blank lines', () => {
    expect(buildVisualEmail('<p>a</p><p></p><p>b</p>')).toContain('<p style="margin:0 0 16px;font-size:16px;line-height:24px;">&nbsp;</p>');
  });

  it('is not detected as visual for hand-written HTML', () => {
    expect(isVisualHtml('<p>hi</p>')).toBe(false);
    expect(extractVisualBody('<p>hi</p>')).toBeNull();
  });

  it('renders through the send pipeline with merge tags and footer', () => {
    const out = renderEmail({
      campaign: { subject: 's', preheader: '', html: buildVisualEmail(STARTER_VISUAL) },
      contact: { first_name: 'Ada' },
      settings: { company_name: 'Acme', physical_address: '1 Main St' },
      unsubscribeUrl: 'https://u.test',
    });
    expect(out.html).toContain('Hi Ada,');
    expect(out.html).toContain('The Acme team');
    expect(out.html).toContain('1 Main St');
    expect(out.text).toContain('Read more (https://example.com)');
  });
});

describe('personal (plain) style', () => {
  it('has no designed wrapper, turns buttons into links, and round-trips', () => {
    const body = `<p>Hi {{first_name}},</p><p><a class="${BUTTON_CLASS}" href="https://x.io">See samples</a></p>`;
    const html = buildVisualEmail(body, { style: 'plain' });
    expect(emailStyleOf(html)).toBe('plain');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('background:#f4f4f7');
    expect(html).not.toContain('display:inline-block');
    expect(extractVisualBody(html)).toContain('See samples');
    expect(emailStyleOf(buildVisualEmail(body))).toBe('designed');
  });

  it('uses the quiet text footer when rendered for sending', () => {
    const out = renderEmail({
      campaign: { subject: 's', preheader: '', html: buildVisualEmail('<p>Hi</p>', { style: 'plain' }) },
      contact: {},
      settings: { company_name: 'Grey Graphics', physical_address: 'Patna' },
      unsubscribeUrl: 'https://u.test',
    });
    expect(out.html).not.toContain('<table');
    expect(out.html).toContain('Grey Graphics, Patna');
    expect(out.html).toContain('href="https://u.test"');
  });
});
