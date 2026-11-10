// Cloudflare Worker cho Dòng Tiền: nhận đăng ký push từ app và gửi thông báo mỗi ngày lúc 19:00 giờ Việt Nam.
// Cron (UTC): 0 12 * * *   |   KV binding: SUBS   |   Secret: VAPID_PRIVATE_JWK   |   Text: VAPID_PUBLIC
// Tuỳ chọn: ALLOW_ORIGIN (mặc định https://styrukilled3.github.io), VAPID_SUBJECT, TEST_TOKEN (để thử gửi ngay qua /test?t=...)
// Gửi push không kèm nội dung (không cần mã hoá payload), nội dung thông báo do service worker của app đặt.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com'];

function validEndpoint(ep) {
  try {
    const u = new URL(ep);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}
const keyOf = async (ep) => 'sub:' + b64u(await crypto.subtle.digest('SHA-256', enc.encode(ep)));

async function vapidAuth(endpoint, env) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://styrukilled3.github.io/',
  })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendAll(env) {
  let sent = 0, dropped = 0, failed = 0, cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (!raw) continue;
      const sub = JSON.parse(raw);
      try {
        const r = await fetch(sub.endpoint, {
          method: 'POST',
          headers: { Authorization: await vapidAuth(sub.endpoint, env), TTL: '3600', Urgency: 'normal' },
        });
        if (r.status === 404 || r.status === 410) { await env.SUBS.delete(k.name); dropped++; }
        else if (r.ok) sent++;
        else failed++;
      } catch { failed++; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { sent, dropped, failed };
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOW_ORIGIN || 'https://styrukilled3.github.io';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);

    if (url.pathname === '/test' && env.TEST_TOKEN && url.searchParams.get('t') === env.TEST_TOKEN) {
      return json(await sendAll(env));
    }
    if (req.method === 'POST' && (url.pathname === '/subscribe' || url.pathname === '/unsubscribe')) {
      if (req.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
      let body;
      try { body = await req.json(); } catch { return json({ error: 'json' }, 400); }
      if (!body || !validEndpoint(body.endpoint)) return json({ error: 'endpoint' }, 400);
      if (url.pathname === '/subscribe') await env.SUBS.put(await keyOf(body.endpoint), JSON.stringify({ endpoint: body.endpoint }));
      else await env.SUBS.delete(await keyOf(body.endpoint));
      return json({ ok: true });
    }
    return new Response('Dòng Tiền push worker', { headers: cors });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendAll(env));
  },
};
