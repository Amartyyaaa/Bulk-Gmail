// Browser-side DNS lookups over DNS-over-HTTPS (Cloudflare supports CORS),
// used by Settings to check SPF / DKIM / DMARC on the sending domain.

async function lookup(name, type) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const data = await res.json();
  return (data.Answer || [])
    .filter((a) => (type === 'TXT' ? a.type === 16 : a.type === 5))
    .map((a) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

// Both Resend and SES deliver through Amazon's infrastructure, so the SPF
// include on the return-path (MAIL FROM) domain is the same for either.
const expectedInclude = 'amazonses.com';

export async function checkDomain(domain, { dkimSelector }) {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const [txt, dmarc, dkimTxt, dkimCname] = await Promise.all([
    lookup(d, 'TXT'),
    lookup(`_dmarc.${d}`, 'TXT'),
    dkimSelector ? lookup(`${dkimSelector}._domainkey.${d}`, 'TXT') : Promise.resolve([]),
    dkimSelector ? lookup(`${dkimSelector}._domainkey.${d}`, 'CNAME') : Promise.resolve([]),
  ]);

  const spf = txt.filter((r) => r.toLowerCase().startsWith('v=spf1'));
  const dmarcRecord = dmarc.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
  const policy = dmarcRecord?.match(/;\s*p=([a-z]+)/i)?.[1]?.toLowerCase();

  return {
    domain: d,
    spf: {
      status: spf.length === 1 ? 'pass' : spf.length > 1 ? 'fail' : 'missing',
      records: spf,
      note:
        spf.length > 1
          ? 'Multiple SPF records found — merge them into one; receivers treat duplicates as a permanent error.'
          : spf.length === 1 && !spf[0].includes(expectedInclude)
            ? `SPF exists on the root domain. Your provider's SPF include (e.g. "include:${expectedInclude}") belongs on the MAIL FROM / return-path subdomain it gives you — check the provider dashboard.`
            : null,
    },
    dkim: {
      status: dkimTxt.some((r) => /p=/.test(r)) || dkimCname.length ? 'pass' : 'missing',
      records: [...dkimTxt, ...dkimCname],
      note: dkimSelector ? `Looked up ${dkimSelector}._domainkey.${d}` : 'Set your DKIM selector to check this record.',
    },
    dmarc: {
      status: dmarcRecord ? (policy === 'none' ? 'warn' : 'pass') : 'missing',
      records: dmarcRecord ? [dmarcRecord] : [],
      note: policy === 'none' ? 'p=none only monitors. Move to p=quarantine once reports look clean.' : null,
    },
  };
}
