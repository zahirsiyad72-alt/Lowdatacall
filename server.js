// LowData Call – signaling + TURN credential server. Zero dependencies (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const E = process.env, PORT = E.PORT || 3000, MAX_PEERS = 6, GRACE_MS = 10000;
const rooms = new Map(); 
const users = new Map(); // maps userId -> {res} for direct ringing
const push = (res, o) => res.write('data: ' + JSON.stringify(o) + '\n\n');

let cf = {t: 0, v: null};
async function getIce() {
  const out = [{urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']}]; let relay = false;
  try {
    if (E.CF_TURN_KEY_ID && E.CF_TURN_API_TOKEN) {
      if (!cf.v || Date.now() - cf.t > 6 * 3600e3) {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${E.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: {Authorization: 'Bearer ' + E.CF_TURN_API_TOKEN, 'Content-Type': 'application/json'}, body: JSON.stringify({ttl: 86400})
        });
        if (!r.ok) throw new Error('Cloudflare TURN HTTP ' + r.status);
        cf = {t: Date.now(), v: [].concat((await r.json()).iceServers)};
      }
      cf.v.forEach(s => { out.push({...s, urls: [].concat(s.urls).filter(u => !u.includes(':53'))}); if (s.username) relay = true; });
    } else if (E.TURN_SECRET && E.TURN_URLS) {
      const user = (Math.floor(Date.now() / 1000) + 86400) + ':lowdata';
      out.push({urls: E.TURN_URLS.split(','), username: user, credential: crypto.createHmac('sha1', E.TURN_SECRET).update(user).digest('base64')}); relay = true;
    } else if (E.TURN_URL) {
      out.push({urls: E.TURN_URL.split(','), username: E.TURN_USER, credential: E.TURN_PASS}); relay = true;
    }
  } catch (e) { console.error('TURN setup error:', e.message); }
  return {iceServers: out, relay};
}

const readBody = (req, cb) => { let b = ''; req.on('data', c => { b += c; if (b.length > 100000) req.destroy(); }); req.on('end', () => { try { cb(JSON.parse(b)); } catch {} }); };
const dropPeer = (room, id) => { 
  const peers = rooms.get(room), p = peers && peers.get(id); if (!p) return; 
  clearTimeout(p.timer); peers.delete(id); peers.forEach(o => push(o.res, {type: 'leave', id})); 
  if (!peers.size) rooms.delete(room); 
};
const FILES = {'/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'text/javascript', '/logo.svg': 'image/svg+xml', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png'};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  
  // CORS headers for local dev if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (u.pathname === '/') { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
  if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/config') { res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); return res.end(JSON.stringify(await getIce())); }
  
  // --- User Registration for Direct Calls ---
  if (u.pathname === '/register') {
    const id = (u.searchParams.get('id') || '').match(/^[a-f0-9]{8}$/)?.[0];
    if (!id) { res.writeHead(400); return res.end(); }
    
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    users.set(id, {res});
    const ka = setInterval(() => res.write(':\n\n'), 15000);
    req.on('close', () => { clearInterval(ka); if (users.get(id)?.res === res) users.delete(id); });
    return;
  }

  if (u.pathname === '/ring' && req.method === 'POST') {
    return readBody(req, m => {
      const target = users.get(m.to);
      if (target) {
        push(target.res, {type: 'incoming-call', from: m.from, room: m.room, name: m.name});
        res.writeHead(200); res.end('ok');
      } else {
        res.writeHead(404); res.end('offline');
      }
    });
  }
  
  if (u.pathname === '/events') {
    const room = (u.searchParams.get('room') || '').replace(/[^\w-]/g, '').slice(0, 40);
    const id = (u.searchParams.get('id') || '').match(/^[a-f0-9]{8}$/)?.[0], token = (u.searchParams.get('token') || '').slice(0, 64);
    if (!room || !id || token.length < 16) { res.writeHead(400); return res.end(); }
    const peers = rooms.get(room) || new Map(), old = peers.get(id);
    if (old && old.token !== token) { res.writeHead(403); return res.end(); }
    
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
    if (!old && peers.size >= MAX_PEERS) { push(res, {type: 'full'}); return res.end(); }
    
    rooms.set(room, peers);
    if (old) { clearTimeout(old.timer); try { old.res.end(); } catch {} }
    const entry = {res, token, timer: null}; 
    peers.set(id, entry);
    
    push(res, {type: 'welcome', peers: [...peers.keys()].filter(k => k !== id)});
    const ka = setInterval(() => res.write(':\n\n'), 15000);
    
    req.on('close', () => {
      clearInterval(ka);
      if (peers.get(id) !== entry) return;
      entry.timer = setTimeout(() => peers.get(id) === entry && dropPeer(room, id), GRACE_MS);
    });
    return;
  }
  
  if (u.pathname === '/signal' && req.method === 'POST') { 
    return readBody(req, m => { 
      const peers = rooms.get(m.room), from = peers && peers.get(m.from), to = peers && peers.get(m.to); 
      if (from && from.token === m.token && to) push(to.res, {type: 'signal', from: m.from, data: m.data}); 
    }), req.on('end', () => { res.writeHead(204); res.end(); }); 
  }
  
  if (u.pathname === '/leave' && req.method === 'POST') { 
    return readBody(req, m => { 
      const p = rooms.get(m.room)?.get(m.id); 
      if (p && p.token === m.token) dropPeer(m.room, m.id); 
    }), req.on('end', () => { res.writeHead(204); res.end(); }); 
  }
  
  if (FILES[u.pathname]) { res.writeHead(200, {'Content-Type': FILES[u.pathname], 'Cache-Control': 'no-cache'}); return res.end(fs.readFileSync(path.join(__dirname, u.pathname))); }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, async () => {
  console.log('LowData Call running on http://localhost:' + PORT);
});
