/* Consolidated LowData client fixes. Replaces the old client-enhancements.js,
   client-reliability.js and client-contacts-call.js. Loaded after fixes.js. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);

  /* ───── 1. Styles (single source of truth) ───── */
  const style = document.createElement('style');
  style.id = 'lowdata-fixes';
  style.textContent = `
    button { touch-action: manipulation; }
    #bar .ctl { min-width: 0; min-height: 48px; }
    #leave { min-height: 48px; font-weight: 700; }
    #controls-toggle { display: none; }
    #leave { pointer-events: auto; touch-action: manipulation; }

    @media (max-width: 700px) {
      html, body { width: 100%; height: 100%; overflow: hidden; }
      body { height: 100dvh; }
      header { flex: 0 0 auto; gap: 8px; padding: 10px; }
      #roominfo { gap: 4px; }
      #roominfo .btn { padding: 8px; }
      #app { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom); }
      #grid {
        flex: 1 1 auto; min-height: 0; width: 100%;
        grid-template-columns: 1fr; grid-template-rows: 1fr;
        gap: 4px; padding: 4px; overflow: hidden;
      }
      #grid:not(.focus) .tile { height: 100%; min-height: 0; aspect-ratio: auto; }
      #grid:not(.focus) .tile video { object-fit: contain; }
      #grid.focus { grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); grid-template-rows: minmax(0,1fr) 68px; }
      #grid.focus .tile.pin { grid-column: 1/-1; grid-row: 1; height: 100%; }
      #grid.focus .tile:not(.pin) { height: 64px; }
      #grid.focus .tile.pin video { object-fit: contain; }
      #grid.focus .tile:not(.pin) video { object-fit: cover; }
      #grid .empty { padding: 14px 10px; }
      #diag { position: relative; z-index: 4; max-height: 48px; overflow: auto; background: var(--bg); }
      #dbar { flex: 0 0 auto; min-height: 40px; margin-bottom: 4px; }

      /* Bottom call bar: only Menu + Leave visible. */
      #bar {
        position: fixed !important;
        inset: auto 0 0 0 !important;
        z-index: 45;
        display: flex !important;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 8px;
        padding-bottom: max(8px, env(safe-area-inset-bottom));
        background: transparent !important;
        border: 0 !important;
        pointer-events: none;
      }
      #bar > * { pointer-events: auto; }
      #bar .ctl:not(#leave):not(#controls-toggle) { display: none; }
      #bar #share { display: none !important; }

      #controls-toggle {
        display: flex !important;
        align-items: center; justify-content: center;
        min-width: 64px; min-height: 52px;
        padding: 6px 12px;
        border: 1px solid var(--bd); border-radius: 12px;
        background: var(--card); color: var(--fg);
        font-weight: 700; box-shadow: 0 3px 12px #0004;
      }
      #leave {
        display: flex !important;
        flex-direction: column; align-items: center; justify-content: center;
        min-width: 64px; min-height: 52px;
        padding: 6px 12px;
        border: 2px solid #fff; border-radius: 12px;
        background: var(--off); color: #fff;
        font-weight: 700; box-shadow: 0 3px 12px #0004;
        margin-left: auto;
      }

      /* Open menu: grid of controls floats above the Menu/Leave row. */
      #bar.controls-open {
        inset: auto 8px max(76px, calc(env(safe-area-inset-bottom) + 68px)) 8px !important;
        display: grid !important;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px; padding: 8px;
        border: 1px solid var(--bd) !important;
        border-radius: 14px;
        background: var(--card) !important;
        box-shadow: 0 4px 18px #0005;
      }
      #bar.controls-open .ctl:not(#leave):not(#controls-toggle) { display: flex; }
      #bar.controls-open #controls-toggle {
        position: fixed; left: 8px; bottom: max(8px, env(safe-area-inset-bottom));
      }
      #bar.controls-open #leave {
        position: fixed; right: 8px; bottom: max(8px, env(safe-area-inset-bottom));
      }

      #incoming-call { z-index: 100; }
      .sheet { z-index: 70; }
      #home-view, #contacts-view, #usage-view { padding-bottom: 88px; }
    }
  `;
  document.head.appendChild(style);

  /* ───── 2. Mobile controls toggle ───── */
  const bar = $('#bar');
  if (bar && !$('#controls-toggle')) {
    const toggle = document.createElement('button');
    toggle.id = 'controls-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Controls';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Show call controls');
    bar.appendChild(toggle);

    toggle.onclick = e => {
      e.preventDefault();
      const open = bar.classList.toggle('controls-open');
      toggle.textContent = open ? 'Close' : 'Controls';
      toggle.setAttribute('aria-expanded', String(open));
    };
    bar.querySelectorAll('.ctl:not(#leave):not(#controls-toggle)').forEach(btn => {
      btn.addEventListener('click', () => {
        if (matchMedia('(max-width:700px)').matches) {
          bar.classList.remove('controls-open');
          toggle.textContent = 'Controls';
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  /* ───── 3. Leave: one dependable handler, no reload ───── */
  const leave = $('#leave');
  let leaving = false;

  function finishCall(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (leaving) return;
    leaving = true;

    try {
      if (typeof accountant !== 'undefined' && typeof S !== 'undefined') {
        const used = (accountant.totalSent() + accountant.totalRecv()) / 1e6;
        const seconds = Math.max(0, (performance.now() - (S.t0 || performance.now())) / 1000);
        const base = seconds * (typeof BASELINE_KBPS === 'number' ? BASELINE_KBPS : 1400) / 8 / 1000;
        const saved = Math.max(0, base - used);
        const pct = base ? Math.round(saved / base * 100) : 0;
        const t = accountant.session || {};
        const record = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          endedAt: new Date().toISOString(),
          seconds, usedMB: used, baselineMB: base, savedMB: saved, savedPct: pct,
          people: (typeof peers !== 'undefined' ? peers.size : 0) + 1,
          categories: {
            audio:     ((t.audioSent || 0)     + (t.audioRecv || 0))     / 1e6,
            video:     ((t.videoSent || 0)     + (t.videoRecv || 0))     / 1e6,
            slides:    ((t.screenSent || 0)    + (t.screenRecv || 0))    / 1e6,
            transport: ((t.transportSent || 0) + (t.transportRecv || 0)) / 1e6
          }
        };
        if (typeof addHistory === 'function') addHistory(record);
        const f = typeof fmtMB === 'function' ? fmtMB : v => v.toFixed(1) + ' MB';
        if ($('#sumSaved')) $('#sumSaved').textContent = f(saved) + ' saved';
        if ($('#sumSub'))   $('#sumSub').textContent = 'Measured: ' + f(used) + ' · HD baseline: ' + f(base) + ' (' + pct + '% less)';
        if ($('#sumDur'))   $('#sumDur').textContent = seconds < 60 ? Math.round(seconds) + ' sec' : Math.floor(seconds / 60) + ' min ' + Math.round(seconds % 60) + ' sec';
        if ($('#sumUsed'))  $('#sumUsed').textContent = f(used);
        if ($('#sumBase'))  $('#sumBase').textContent = f(base);
        if ($('#sumPeople'))$('#sumPeople').textContent = String(record.people);
        if ($('#sumCats'))  $('#sumCats').textContent =
          'Audio ' + f(record.categories.audio) + ' · Video ' + f(record.categories.video) +
          ' · Slides ' + f(record.categories.slides) + ' · Transport ' + f(record.categories.transport);
      }
    } catch (err) { console.warn('summary:', err); }

    try {
      const payload = JSON.stringify({ room, id: me, token });
      if (!navigator.sendBeacon || !navigator.sendBeacon('/leave', new Blob([payload], { type: 'application/json' }))) {
        fetch('/leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
      }
    } catch {}

    try { es && es.close(); } catch {}
    try { peers && peers.forEach(p => p.pc.close()); } catch {}
    try { [mic, cam, scr].forEach(t => t && t.stop()); } catch {}
    try { wake && wake.release(); } catch {}
    try { S && (S.ended = true); } catch {}

    try { showTab('home'); } catch {}
    const s = $('#sheet-summary'); if (s) s.hidden = false;
    if (bar) bar.classList.remove('controls-open');
    const tg = $('#controls-toggle');
    if (tg) { tg.textContent = 'Controls'; tg.setAttribute('aria-expanded', 'false'); }

    setTimeout(() => { leaving = false; }, 800);
  }

  if (leave) {
    leave.onclick = null;                                 // kill old fixes.js reload handler
    leave.addEventListener('pointerup', finishCall, { passive: false });
    leave.addEventListener('touchend', finishCall, { passive: false });
    leave.addEventListener('click', finishCall);
  }
  const sumNew = $('#sumNew');
  if (sumNew) sumNew.onclick = () => { $('#sheet-summary').hidden = true; location.href = location.pathname + location.search; };
  const sumUsage = $('#sumUsage');
  if (sumUsage) sumUsage.onclick = () => { $('#sheet-summary').hidden = true; if (typeof showTab === 'function') showTab('usage'); };

  /* ───── 4. Contacts: safe, editable, copyable ───── */
  const idCard = $('.my-id-card');
  if (idCard && !$('#copy-my-id')) {
    const a = document.createElement('div');
    a.className = 'rowb'; a.style.justifyContent = 'center';
    a.innerHTML =
      '<button type="button" class="btn primary" id="copy-my-id">Copy my ID</button>' +
      '<button type="button" class="btn" id="share-my-id">Copy invite code</button>';
    idCard.appendChild(a);
    $('#copy-my-id').onclick = async () => {
      const b = $('#copy-my-id');
      try { await navigator.clipboard.writeText(myId); b.textContent = 'Copied!'; }
      catch { window.prompt('Your ID:', myId); }
      setTimeout(() => b.textContent = 'Copy my ID', 1800);
    };
    $('#share-my-id').onclick = async () => {
      const code = 'LOWDATA:' + myId, b = $('#share-my-id');
      try { await navigator.clipboard.writeText(code); b.textContent = 'Invite copied!'; }
      catch { window.prompt('Copy this invite code:', code); }
      setTimeout(() => b.textContent = 'Copy invite code', 1800);
    };
  }

  const addFriend = $('#btn-add-friend');
  if (addFriend) addFriend.onclick = () => {
    const raw = ($('#friend-id-input').value || '').trim();
    const id = raw.replace(/^LOWDATA:/i, '').trim().toLowerCase();
    if (!/^[a-f0-9]{8}$/.test(id)) return alert('Enter an 8-character ID or LOWDATA invite code.');
    if (id === myId) return alert('You cannot add yourself.');
    if (friends.some(f => f.id === id)) return alert('Already in your contacts.');
    const name = (window.prompt('Name this friend:', 'Friend ' + id.slice(0, 4)) || '').trim().slice(0, 40) || ('Friend ' + id.slice(0, 4));
    friends.push({ id, name });
    try { localStorage.setItem('ld_friends', JSON.stringify(friends)); } catch {}
    $('#friend-id-input').value = '';
    renderContacts();
  };

  if (typeof renderContacts === 'function') renderContacts = function () {
    const list = $('#friend-list');
    if (!list) return;
    list.replaceChildren();
    if (!friends.length) {
      const e = document.createElement('div'); e.className = 'hist empty';
      const b = document.createElement('b'); b.textContent = 'No contacts yet';
      e.append(b, document.createTextNode(' Add a friend by ID or invite code.'));
      list.appendChild(e); return;
    }
    friends.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'friend';
      const info = document.createElement('div');
      const n = document.createElement('div'); n.className = 'name'; n.textContent = f.name || ('Friend ' + f.id.slice(0, 4));
      const d = document.createElement('div'); d.className = 'id';   d.textContent = 'ID: ' + f.id;
      info.append(n, d);
      const act = document.createElement('div'); act.className = 'rowb'; act.style.margin = '0';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn'; edit.textContent = 'Edit';
      edit.onclick = () => {
        const nn = window.prompt('Edit friend name:', f.name || '');
        if (nn === null) return;
        friends[i] = { ...f, name: nn.trim().slice(0, 40) || ('Friend ' + f.id.slice(0, 4)) };
        try { localStorage.setItem('ld_friends', JSON.stringify(friends)); } catch {}
        renderContacts();
      };
      const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn'; cp.textContent = 'Code';
      cp.onclick = async () => {
        const code = 'LOWDATA:' + f.id;
        try { await navigator.clipboard.writeText(code); cp.textContent = 'Copied!'; }
        catch { window.prompt('Copy this invite code:', code); }
        setTimeout(() => cp.textContent = 'Code', 1600);
      };
      const callBtn = document.createElement('button'); callBtn.type = 'button'; callBtn.className = 'btn primary'; callBtn.textContent = 'Call';
      callBtn.onclick = () => window.callFriend(f.id);
      act.append(edit, cp, callBtn);
      row.append(info, act);
      list.appendChild(row);
    });
  };

  /* ───── 5. Notification permission ───── */
  const to = $('#testout'), panel = to && to.parentElement;
  if (panel && 'Notification' in window && Notification.permission !== 'granted' && !$('#enable-notifications')) {
    const b = document.createElement('button');
    b.id = 'enable-notifications'; b.className = 'btn outline'; b.type = 'button';
    b.textContent = 'Enable call notifications';
    b.style.cssText = 'width:100%;margin:8px 0 0';
    panel.insertBefore(b, to.nextSibling);
    b.onclick = async () => {
      try {
        const p = await Notification.requestPermission();
        b.textContent = p === 'granted' ? 'Call notifications enabled' : 'Notifications not enabled';
        b.disabled = p === 'granted';
      } catch { b.textContent = 'Notifications unavailable'; }
    };
  }

  if (typeof globalEs !== 'undefined' && globalEs && 'Notification' in window) {
    globalEs.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type !== 'incoming-call' || Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible') return;
      const title = 'Incoming LowData Call';
      const opts = { body: (m.name || 'Someone') + ' is calling you', icon: '/icon-192.png', tag: 'lowdata-call' };
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(r => r.showNotification(title, opts))
          .catch(() => { try { new Notification(title, opts); } catch {} });
      } else { try { new Notification(title, opts); } catch {} }
    });
  }

  /* ───── 6. Single ICE queue (dedupes the old double patch) ───── */
  if (window.RTCPeerConnection && !RTCPeerConnection.prototype.__ldIce) {
    const p = RTCPeerConnection.prototype;
    const add = p.addIceCandidate, setR = p.setRemoteDescription, q = new WeakMap();
    p.addIceCandidate = function (c, ...r) {
      if (!this.remoteDescription) {
        const a = q.get(this) || []; a.push([c, r]); q.set(this, a);
        return Promise.resolve();
      }
      return add.call(this, c, ...r);
    };
    p.setRemoteDescription = async function (d) {
      const r = await setR.call(this, d);
      const a = q.get(this) || []; q.delete(this);
      for (const [c, x] of a) {
        try { await add.call(this, c, ...x); } catch (e) { console.debug('stale ICE:', e); }
      }
      return r;
    };
    Object.defineProperty(p, '__ldIce', { value: true });
  }

  /* ───── 7. Offer tie-break (safe now that server sends peer-joined) ───── */
  if (typeof call === 'function' && !window.__ldTie) {
    const o = call;
    call = function (peerId) {
      if (typeof me === 'string' && typeof peerId === 'string' && me > peerId) return Promise.resolve();
      return o.call(this, peerId);
    };
    window.__ldTie = true;
  }

  /* ───── 8. Track-swap race (was in the never-loaded client-media-fixes.js) ───── */
  if (window.RTCRtpSender && !RTCRtpSender.prototype.__ldTrack) {
    const sp = RTCRtpSender.prototype;
    const orig = sp.replaceTrack;
    if (orig) {
      sp.replaceTrack = function (t) {
        const pr = orig.call(this, t);
        this.__ldPending = pr.catch(() => {});
        return pr;
      };
    }
    const pcp = RTCPeerConnection.prototype;
    for (const m of ['createOffer', 'createAnswer']) {
      const f = pcp[m]; if (!f) continue;
      pcp[m] = async function (...a) {
        await Promise.all(this.getSenders().map(s => s.__ldPending).filter(Boolean));
        return f.apply(this, a);
      };
    }
    Object.defineProperty(sp, '__ldTrack', { value: true });
  }
  const unlock = () => document.querySelectorAll('#grid video').forEach(v => {
    v.playsInline = true;
    if (v.srcObject) v.play().catch(() => {});
  });
  document.addEventListener('pointerup', unlock, { passive: true });
  document.addEventListener('touchend', unlock, { passive: true });

  /* ───── 9. TURN warning ───── */
  if (typeof startCall === 'function' && !window.__ldTurn) {
    const o = startCall;
    startCall = async function (...a) {
      const r = await o.apply(this, a);
      if (typeof hasRelay !== 'undefined' && !hasRelay) {
        const d = $('#diag');
        if (d) d.textContent = 'No TURN relay configured. Wi-Fi works, but mobile/mobile calls may fail. Set CF_TURN_KEY_ID and CF_TURN_API_TOKEN on the server.';
      }
      return r;
    };
    window.__ldTurn = true;
  }
})();
