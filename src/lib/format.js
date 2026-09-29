const nf = new Intl.NumberFormat();

export const num = (n) => nf.format(Number(n) || 0);

export function pct(part, whole, digits = 1) {
  if (!whole) return '—';
  return `${((Number(part) / Number(whole)) * 100).toFixed(digits)}%`;
}

export function ratio(part, whole) {
  return whole ? Number(part) / Number(whole) : 0;
}

export function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function relative(value) {
  if (!value) return '—';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Value for <input type="datetime-local"> in the user's local time. */
export function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Engagement rates from a campaign_stats row. Opens/clicks are measured
 * against delivered mail (falling back to accepted mail if the ESP hasn't
 * reported deliveries yet); bounces against everything accepted.
 */
export function rates(s = {}) {
  const base = Number(s.delivered) || Number(s.sent) || 0;
  return {
    openRate: ratio(s.opened, base),
    clickRate: ratio(s.clicked, base),
    bounceRate: ratio(s.bounced, s.sent),
    unsubRate: ratio(s.unsubscribed, base),
    deliveryRate: ratio(s.delivered, s.sent),
  };
}

export const fmtRate = (r) => `${(r * 100).toFixed(1)}%`;
