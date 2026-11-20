// LowData Call – signaling + TURN credential server. Zero dependencies (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const E = process.env, PORT = E.PORT || 3000, MAX_PEERS = 6, GRACE_MS = 10000;
const rooms = new Map();
const users = new Map();

const push = (res, o) => {
  if (!res || res.writableEnded || res.destroyed) return false;
  try { return res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch { return false; }
};

let cf = { t: 0, v: null };
async function getIce() {
  const out = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  let relay = false;
  try {
    if (E.CF_TURN_KEY_ID && E.CF_TURN_API_TOKEN) {
      if (!cf.v || Date.now() - cf.t > 6 * 3600e3) {
        const r = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(E.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + E.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: 86400 })
          }
        );
        if (!r.ok) throw new Error('Cloudflare TURN HTTP ' + r.status);
        const data = await r.json();
        if (!Array.isArray(data.iceServers)) throw new Error('Invalid Cloudflare TURN response');
        cf = { t: Date.now(), v: data.iceServers };
      }
      cf.v.forEach(s => {
        out.push({ ...s, urls: [].concat(s.urls).filter(u => !u.includes(':53')) });
        if (s.username) relay = true;
      });
    } else if (E.TURN_SECRET && E.TURN_URLS) {
      const user = (Math.floor(Date.now() / 1000) + 86400) + ':lowdata';
      out.push({
        urls: E.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean),
        username: user,
        credential: crypto.createHmac('sha1', E.TURN_SECRET).update(user).digest('base64')
      });
      relay = true;
    } else if (E.TURN_URL) {
      out.push({
        urls: E.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
        username: E.TURN_USER,
        credential: E.TURN_PASS
      });
      relay = true;
    }
  } catch (e) { console.error('TURN setup error:', e.message); }
  return { iceServers: out, relay };
}

const readBody = (req, res, cb) => {
  let b = '';
  req.on('data', c => {
    b += c;
    if (Buffer.byteLength(b) > 100000) {
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Request too large');
      req.destroy();
    }
  });
  req.on('end', () => {
    if (res.writableEnded || res.destroyed) return;
    try {
      const data = JSON.parse(b || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected JSON object');
      cb(data);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid JSON');
    }
  });
};

const dropPeer = (room, id) => {
  const peers = rooms.get(room), p = peers && peers.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  peers.delete(id);
  peers.forEach(o => push(o.res, { type: 'leave', id }));
  if (!peers.size) rooms.delete(room);
};

const FILES = {
  '/manifest.webmanifest':   'application/manifest+json',
  '/sw.js':                  'text/javascript; charset=utf-8',
  '/fixes.js':               'text/javascript; charset=utf-8',
  '/client-enhancements.js': 'text/javascript; charset=utf-8',
  '/logo.svg':               'image/svg+xml',
  '/icon-192.png':           'image/png',
  '/icon-512.png':           'image/png'
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── Static assets
  if (FILES[u.pathname] && req.method === 'GET') {
    try {
      const data = fs.readFileSync(path.join(__dirname, u.pathname.slice(1)));
      res.writeHead(200, { 'Content-Type': FILES[u.pathname], 'Cache-Control': 'public, max-age=300' });
      return res.end(data);
    } catch { res.writeHead(404); return res.end('Not found'); }
  }

  // ── Main HTML with script injection
  if (u.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    html = html.replace(
      "navigator.serviceWorker.addEventListener('controllerchange',",
      "if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange',"
    );
    html = html.replace(
      '</body>',
      '<script src="/fixes.js"></script><script src="/client-enhancements.js"></script></body>'
    );
    return res.end(html);
  }

  if (u.pathname === '/health' && req.method === 'GET') { res.writeHead(200); return res.end('ok'); }

  if (u.pathname === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(await getIce()));
  }

  // ── Per-user ring registration (SSE)
  if (u.pathname === '/register' && req.method === 'GET') {
    const id = (u.searchParams.get('id') || '').match(/^[a-f0-9]{8}$/)?.[0];
    if (!id) { res.writeHead(400); return res.end(); }
    const previous = users.get(id);
    if (previous && previous.res !== res) {
      try { previous.res.end(); } catch {}
      clearInterval(previous.keepAlive);
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const entry = { res, keepAlive: null };
    users.set(id, entry);
    entry.keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(':\n\n');
    }, 15000);
    req.on('close', () => {
      clearInterval(entry.keepAlive);
      if (users.get(id) === entry) users.delete(id);
    });
    return;
  }

  // ── Ring a specific user
  if (u.pathname === '/ring' && req.method === 'POST') {
    return readBody(req, res, m => {
      const to = typeof m.to === 'string' && /^[a-f0-9]{8}$/.test(m.to) ? m.to : '';
      const from = typeof m.from === 'string' && /^[a-f0-9]{8}$/.test(m.from) ? m.from : '';
      const room = typeof m.room === 'string' ? m.room.replace(/[^\w-]/g, '').slice(0, 40) : '';
      if (!to || !from || !room) { res.writeHead(400); return res.end('Invalid call details'); }
      const target = users.get(to);
      if (target && push(target.res, {
        type: 'incoming-call', from, room,
        name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Someone'
      })) {
        res.writeHead(200); res.end('ok');
      } else {
        res.writeHead(404); res.end('offline');
      }
    });
  }

  // ── Room event stream (SSE)
  if (u.pathname === '/events' && req.method === 'GET') {
    const room = (u.searchParams.get('room') || '').replace(/[^\w-]/g, '').slice(0, 40);
    const id = (u.searchParams.get('id') || '').match(/^[a-f0-9]{8}$/)?.[0];
    const token = (u.searchParams.get('token') || '').slice(0, 64);
    if (!room || !id || token.length < 16) { res.writeHead(400); return res.end(); }
    const peers = rooms.get(room) || new Map();
    const old = peers.get(id);
    if (old && old.token !== token) { res.writeHead(403); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (!old && peers.size >= MAX_PEERS) { push(res, { type: 'full' }); return res.end(); }
    rooms.set(room, peers);
    if (old) { clearTimeout(old.timer); try { old.res.end(); } catch {} }

    const entry = { res, token, timer: null };
    peers.set(id, entry);

    // 1) New peer learns who is already here
    push(res, { type: 'welcome', peers: [...peers.keys()].filter(k => k !== id) });

    // 2) Existing peers learn the new peer joined.
    //    Required so the offer-tie-break works for late joiners:
    //    without this, whoever arrives second can silently skip offering
    //    because the tie-break told them to. The senior peer must be told
    //    to start the offer.
    peers.forEach((peer, pid) => {
      if (pid !== id) push(peer.res, { type: 'peer-joined', id });
    });

    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(':\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      if (peers.get(id) !== entry) return;
      entry.timer = setTimeout(() => dropPeer(room, id), GRACE_MS);
    });
    return;
  }

  // ── SDP/ICE relay between two peers
  if (u.pathname === '/signal' && req.method === 'POST') {
    return readBody(req, res, m => {
      const room  = typeof m.room  === 'string' ? m.room.replace(/[^\w-]/g, '').slice(0, 40) : '';
      const from  = typeof m.from  === 'string' && /^[a-f0-9]{8}$/.test(m.from) ? m.from : '';
      const to    = typeof m.to    === 'string' && /^[a-f0-9]{8}$/.test(m.to)   ? m.to   : '';
      const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
      const data  = m.data;
      if (!room || !from || !to || !data) { res.writeHead(400); return res.end('Invalid signal'); }
      const peers = rooms.get(room);
      if (!peers) { res.writeHead(404); return res.end('No such room'); }
      const sender = peers.get(from);
      if (!sender || sender.token !== token) { res.writeHead(403); return res.end('Bad token'); }
      const target = peers.get(to);
      if (!target) { res.writeHead(404); return res.end('Peer gone'); }
      if (!push(target.res, { type: 'signal', from, data })) {
        res.writeHead(410); return res.end('Peer unreachable');
      }
      res.writeHead(200); res.end('ok');
    });
  }

  // ── Leave
  if (u.pathname === '/leave' && req.method === 'POST') {
    return readBody(req, res, m => {
      const room  = typeof m.room  === 'string' ? m.room.replace(/[^\w-]/g, '').slice(0, 40) : '';
      const id    = typeof m.id    === 'string' && /^[a-f0-9]{8}$/.test(m.id) ? m.id : '';
      const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
      if (!room || !id) { res.writeHead(400); return res.end('Invalid'); }
      const peers = rooms.get(room);
      const entry = peers && peers.get(id);
      if (entry && entry.token === token) {
        clearTimeout(entry.timer);
        dropPeer(room, id);
      }
      res.writeHead(200); res.end('ok');
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}).listen(PORT, () => console.log('LowData Call listening on :' + PORT));
