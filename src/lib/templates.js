export const STARTER_TEMPLATE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
        <tr>
          <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1f2937;">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;color:#111827;">Hi {{first_name|there}},</h1>
            <p style="margin:0 0 16px;">Here's what's new this month. Replace this text with your message.</p>
            <p style="margin:0 0 24px;">Keep paragraphs short and put one clear call to action front and centre.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:6px;background:#4f46e5;">
                  <a href="https://example.com" style="display:inline-block;padding:12px 24px;font-weight:bold;color:#ffffff;text-decoration:none;">Read more</a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;">Thanks,<br>The {{company_name}} team</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

export const SAMPLE_CONTACT = { email: 'alex@example.com', first_name: 'Alex', last_name: 'Rivera' };
