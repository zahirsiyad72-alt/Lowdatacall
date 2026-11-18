/* Follow-up UX fixes: notifications, readable mobile video, and dependable call exit. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  const responsiveStyle = document.createElement('style');
  responsiveStyle.id = 'lowdata-responsive-style';
  responsiveStyle.textContent = `
    button { touch-action: manipulation; }
    #bar .ctl { min-width: 0; min-height: 48px; }
    #leave { min-height: 48px; font-weight: 700; }
    @media (max-width: 700px) {
      html, body { width: 100%; height: 100%; min-height: 100%; overflow: hidden; }
      body { height: 100vh; height: 100dvh; }
      header { flex: 0 0 auto; gap: 8px; padding-left: 10px; padding-right: 10px; }
      #roominfo { gap: 4px; }
      #roominfo .btn { padding: 8px; }
      #app { position: relative; flex: 1 1 auto; min-height: 0; padding: 0 0 env(safe-area-inset-bottom); overflow: hidden; }
      #grid { flex: 1 1 auto; min-height: 0; width: 100%; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 4px; padding: 4px; overflow: hidden; align-content: stretch; }
      #grid.focus { grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); grid-template-rows: minmax(0, 1fr) 68px; }
      #grid.focus .tile { height: 64px; min-height: 0; }
      #grid.focus .tile.pin { grid-column: 1 / -1; grid-row: 1; height: 100%; min-height: 0; }
      #grid.focus .tile:not(.pin) video { object-fit: cover; }
      #grid.focus .tile.pin video, #grid:not(.focus) .tile video { object-fit: contain; }
      #grid .empty { padding: 14px 10px; }
      #diag { position: relative; z-index: 4; max-height: 48px; overflow: auto; background: var(--bg); }
      #dbar { flex: 0 0 auto; min-height: 40px; margin-bottom: 4px; }
      #bar { position: fixed; z-index: 45; left: 8px; right: 8px; bottom: max(8px, env(safe-area-inset-bottom)); display: flex; justify-content: flex-end; align-items: flex-end; gap: 8px; padding: 8px; border: 0; background: transparent; pointer-events: none; }
      #bar > * { pointer-events: auto; }
      #bar .ctl:not(#leave):not(#controls-toggle) { display: none; }
      #bar.controls-open { left: 8px; right: 8px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 8px; border: 1px solid var(--bd); border-radius: 14px; background: var(--card); box-shadow: 0 4px 18px #0003; }
      #bar.controls-open .ctl:not(#leave):not(#controls-toggle) { display: flex; }
      #bar .ctl { min-height: 48px; padding: 6px 2px; font-size: 11px; }
      #bar #share { display: none !important; }
      #controls-toggle { min-width: 56px; min-height: 52px; border: 1px solid var(--bd); border-radius: 12px; background: var(--card); color: var(--fg); font-weight: 700; box-shadow: 0 3px 12px #0003; }
      #leave { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); z-index: 60; width: 58px; height: 58px; min-height: 58px; padding: 4px; border: 2px solid #fff; border-radius: 50%; display: flex !important; flex-direction: column; gap: 0; box-shadow: 0 3px 14px #0005; }
      #bar.controls-open #leave { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); }
      #incoming-call { z-index: 100; }
      .sheet { z-index: 70; }
      #home-view, #contacts-view, #usage-view { padding-bottom: 88px; }
    }
    @media (min-width: 701px) {
      #bar { grid-template-columns: repeat(8, minmax(64px, 1fr)); }
      #bar #share { display: flex; }
    }
  `;
  document.head.appendChild(responsiveStyle);

  // On phones, keep only Leave and a menu toggle visible. The menu exposes every
  // other supported control without shrinking the call video into a tiny tile.
  const controlBar = $('#bar');
  if (controlBar && !$('#controls-toggle')) {
    const toggle = document.createElement('button');
    toggle.id = 'controls-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Controls';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Show call controls');
    controlBar.appendChild(toggle);
    toggle.addEventListener('click', () => {
      const open = controlBar.classList.toggle('controls-open');
      toggle.textContent = open ? 'Close' : 'Controls';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Hide call controls' : 'Show call controls');
    });
    controlBar.querySelectorAll('.ctl:not(#leave)').forEach(button => button.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 700px)').matches) {
        controlBar.classList.remove('controls-open');
        toggle.textContent = 'Controls';
        toggle.setAttribute('aria-expanded', 'false');
      }
    }));
  }

  // Provide a user-initiated notification permission request.
  const panel = $('#testout')?.parentElement;
  if (panel && 'Notification' in window && Notification.permission !== 'granted' && !$('#enable-notifications')) {
    const notificationButton = document.createElement('button');
    notificationButton.id = 'enable-notifications';
    notificationButton.className = 'btn outline';
    notificationButton.type = 'button';
    notificationButton.textContent = 'Enable call notifications';
    notificationButton.style.cssText = 'width:100%;margin:8px 0 0';
    panel.insertBefore(notificationButton, $('#testout').nextSibling);
    notificationButton.onclick = async () => {
      try {
        const permission = await Notification.requestPermission();
        notificationButton.textContent = permission === 'granted' ? 'Call notifications enabled' : 'Notifications not enabled';
        notificationButton.disabled = permission === 'granted';
      } catch { notificationButton.textContent = 'Notifications are unavailable in this browser'; }
    };
  }

  if (typeof globalEs !== 'undefined' && globalEs && 'Notification' in window) {
    globalEs.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type !== 'incoming-call' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      const title = 'Incoming LowData Call';
      const options = {body: (message.name || 'Someone') + ' is calling you', icon: '/icon-192.png', tag: 'lowdata-call', data: {room: message.room}};
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => registration.showNotification(title, options)).catch(() => {
          try { new Notification(title, options); } catch {}
        });
      } else { try { new Notification(title, options); } catch {} }
    });
  }

  const leaveButton = $('#leave');
  if (!leaveButton) return;
  leaveButton.type = 'button';
  leaveButton.disabled = false;
  leaveButton.removeAttribute('aria-busy');
  leaveButton.style.pointerEvents = 'auto';
  leaveButton.style.touchAction = 'manipulation';
  let leaveInProgress = false;

  const formatMB = value => value >= 1000 ? (value / 1000).toFixed(1) + ' GB' : value.toFixed(1) + ' MB';
  const finishCall = () => {
    if (leaveInProgress) return;
    leaveInProgress = true;
    leaveButton.disabled = true;
    leaveButton.setAttribute('aria-busy', 'true');

    try {
      if (typeof accountant !== 'undefined' && typeof S !== 'undefined') {
        const totals = accountant.session || {};
        const usedMB = Math.max(0, (Number(typeof TU !== 'undefined' ? TU : 0) || 0) + (Number(typeof TD !== 'undefined' ? TD : 0) || 0));
        const seconds = Math.max(0, (performance.now() - (S.t0 || performance.now())) / 1000);
        const baselineMB = seconds * (typeof BASELINE_KBPS === 'number' ? BASELINE_KBPS : 1400) / 8 / 1000;
        const savedMB = Math.max(0, baselineMB - usedMB);
        const savedPct = baselineMB ? Math.max(0, Math.min(100, Math.round(savedMB / baselineMB * 100))) : 0;
        const duration = seconds < 60 ? Math.round(seconds) + ' sec' : Math.floor(seconds / 60) + ' min ' + Math.round(seconds % 60) + ' sec';
        const categories = {
          audio: ((totals.audioSent || 0) + (totals.audioRecv || 0)) / 1e6,
          video: ((totals.videoSent || 0) + (totals.videoRecv || 0)) / 1e6,
          slides: ((totals.screenSent || 0) + (totals.screenRecv || 0)) / 1e6,
          transport: ((totals.transportSent || 0) + (totals.transportRecv || 0)) / 1e6
        };
        const record = {id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), endedAt: new Date().toISOString(), seconds, usedMB, baselineMB, savedMB, savedPct, people: (typeof peers !== 'undefined' ? peers.size : 0) + 1, categories};
        if (typeof addHistory === 'function') addHistory(record);
        if ($('#sumSaved')) $('#sumSaved').textContent = formatMB(savedMB) + ' saved';
        if ($('#sumSub')) $('#sumSub').textContent = 'Measured usage: ' + formatMB(usedMB) + ' · estimated HD baseline: ' + formatMB(baselineMB) + ' (' + savedPct + '% less).';
        if ($('#sumDur')) $('#sumDur').textContent = duration;
        if ($('#sumUsed')) $('#sumUsed').textContent = formatMB(usedMB);
        if ($('#sumBase')) $('#sumBase').textContent = formatMB(baselineMB);
        if ($('#sumPeople')) $('#sumPeople').textContent = String(record.people);
        if ($('#sumCats')) $('#sumCats').textContent = 'Audio ' + formatMB(categories.audio) + ' · Video ' + formatMB(categories.video) + ' · Slides ' + formatMB(categories.slides) + ' · Transport ' + formatMB(categories.transport);
      }
    } catch (error) { console.warn('Could not save call summary:', error); }

    // Use the room's beacon before teardown. Local cleanup is independent of
    // network/server state so a failed call can always be exited on mobile.
    try {
      const payload = JSON.stringify({room, id: me, token});
      if (!navigator.sendBeacon || !navigator.sendBeacon('/leave', new Blob([payload], {type: 'application/json'}))) {
        fetch('/leave', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload, keepalive: true}).catch(() => {});
      }
    } catch (error) { console.warn('Could not notify room of leave:', error); }
    try { if (typeof es !== 'undefined' && es) es.close(); } catch {}
    try { if (typeof peers !== 'undefined') peers.forEach(peer => peer.pc.close()); } catch {}
    try { if (typeof mic !== 'undefined' && mic) mic.stop(); } catch {}
    try { if (typeof cam !== 'undefined' && cam) cam.stop(); } catch {}
    try { if (typeof scr !== 'undefined' && scr) scr.stop(); } catch {}
    try { if (typeof wake !== 'undefined' && wake) wake.release(); } catch {}
    try { if (typeof S !== 'undefined') S.ended = true; } catch {}

    try { if (typeof showTab === 'function') showTab('home'); } catch {}
    const summary = $('#sheet-summary');
    if (summary) summary.hidden = false;
    leaveButton.disabled = false;
    leaveButton.removeAttribute('aria-busy');
    leaveInProgress = false;
    if (controlBar) controlBar.classList.remove('controls-open');
    const toggle = $('#controls-toggle');
    if (toggle) { toggle.textContent = 'Controls'; toggle.setAttribute('aria-expanded', 'false'); }
  };

  // Bind direct pointer/touch as well as click so mobile WebViews that drop a
  // synthesized click still run cleanup. Suppress the subsequent duplicate click.
  let lastPointerLeave = 0;
  const directLeave = event => {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    lastPointerLeave = Date.now();
    finishCall();
  };
  leaveButton.addEventListener('pointerup', directLeave, {passive: false});
  leaveButton.addEventListener('touchend', directLeave, {passive: false});
  leaveButton.addEventListener('click', event => {
    if (Date.now() - lastPointerLeave < 800) { event.preventDefault(); event.stopPropagation(); return; }
    directLeave(event);
  });

  const backHome = $('#sumNew');
  if (backHome) backHome.onclick = () => {
    const summary = $('#sheet-summary'); if (summary) summary.hidden = true;
    location.href = location.pathname + location.search;
  };
  const showUsage = $('#sumUsage');
  if (showUsage) showUsage.onclick = () => {
    const summary = $('#sheet-summary'); if (summary) summary.hidden = true;
    if (typeof showTab === 'function') showTab('usage');
  };
})();
