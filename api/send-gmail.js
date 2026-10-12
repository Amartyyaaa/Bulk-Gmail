// Vercel Function: sends plain-text mail through the user's own Gmail account
// over SMTP, authenticated with a Google App Password. Used by the public
// /gmail page. Credentials arrive with each request and are never stored.
// The page sends recipients in small chunks so each call stays well inside
// the function time limit and can report progress.

import nodemailer from 'nodemailer';
import { isValidEmail } from '../supabase/functions/_shared/render.js';

const MAX_PER_REQUEST = 10;
const DELAY_MS = 300; // gentle pacing between messages inside one chunk

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Turn an SMTP error into a short message a person can act on. */
function explain(error) {
  if (error?.responseCode === 535 || error?.code === 'EAUTH') {
    return 'Gmail rejected the login. Use a 16-character App Password (not your normal password) with 2-Step Verification turned on.';
  }
  return error?.response || error?.message || 'Unknown error';
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const senderName = String(body.senderName ?? '').trim().replace(/["\r\n]/g, '');
  const gmail = String(body.gmail ?? '').trim();
  const appPassword = String(body.appPassword ?? '').replace(/\s+/g, '');
  const subject = String(body.subject ?? '').trim().replace(/[\r\n]+/g, ' ');
  const text = String(body.text ?? '');
  const recipients = Array.isArray(body.recipients) ? body.recipients.map((r) => String(r).trim()) : [];

  if (!isValidEmail(gmail)) return json({ error: 'Enter a valid Gmail address.' }, 400);
  if (appPassword.length !== 16) return json({ error: 'The App Password must be 16 characters.' }, 400);
  if (!subject) return json({ error: 'Subject is required.' }, 400);
  if (!text.trim()) return json({ error: 'Message body is required.' }, 400);
  if (!recipients.length) return json({ error: 'No recipients.' }, 400);
  if (recipients.length > MAX_PER_REQUEST) {
    return json({ error: `At most ${MAX_PER_REQUEST} recipients per request.` }, 400);
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmail, pass: appPassword },
  });

  try {
    await transporter.verify();
  } catch (error) {
    return json({ error: explain(error) }, 401);
  }

  const from = senderName ? `"${senderName}" <${gmail}>` : gmail;
  const results = [];
  for (const [i, to] of recipients.entries()) {
    if (!isValidEmail(to)) {
      results.push({ email: to, ok: false, error: 'Invalid address' });
      continue;
    }
    try {
      // One message per recipient so nobody sees anyone else's address.
      await transporter.sendMail({ from, to, subject, text });
      results.push({ email: to, ok: true });
    } catch (error) {
      results.push({ email: to, ok: false, error: explain(error) });
    }
    if (i < recipients.length - 1) await sleep(DELAY_MS);
  }
  transporter.close();

  return json({ results });
}
