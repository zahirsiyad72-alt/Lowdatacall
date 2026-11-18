/* Follow-up UX fixes: notifications, call summaries, and responsive call controls. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  // Keep the app usable on small phone screens: stack the meeting layout, give
  // controls comfortably large touch targets, and hide screen sharing on mobile.
  const responsiveStyle = document.createElement('style');
  responsiveStyle.id = 'lowdata-responsive-style';
  responsiveStyle.textContent = `
    #bar .ctl { min-width: 0; min-height: 48px; touch-action: manipulation; }
    #leave { min-height: 48px; font-weight: 700; }
    button { touch-action: manipulation; }
    @media (max-width: 700px) {
      body { height: 100vh; height: 100svh; min-height: 100%; }
      header { gap: 8px; padding-left: 10px; padding-right: 10px; }
      #roominfo { gap: 4px; }
      #roominfo .btn { padding: 8px; }
      #app { min-height: 0; padding-bottom: env(safe-area-inset-bottom); }
      #grid { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 6px; }
      #grid.focus { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); }
      #grid.focus .tile { height: 64px; }
      #grid.focus .tile.pin { height: auto; }
      #bar { position: relative; z-index: 5; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
      #bar .ctl { min-height: 52px; padding: 8px 2px; font-size: 11px; }
      #bar #share { display: none !important; }
      #leave { order: 99; }
      #dbar { min-height: 44px; }
      .sheet { z-index: 30; }
      #incoming-call { z-index: 100; }
      .tabs { padding-bottom: max(8px, env(safe-area-inset-bottom)); }
      #home-view, #contacts-view, #usage-view { padding-bottom: max(88px, calc(72px + env(safe-area-inset-bottom))); }
      .grid-2 { gap: 8px; }
      .panel { padding: 12px; }
    }
    @media (min-width: 701px) {
      #bar { grid-template-columns: repeat(8, minmax(64px, 1fr)); }
      #bar #share { display: flex; }
    }
  `;
  document.head.appendChild(responsiveStyle);

  // Notifications require an explicit gesture in modern browsers. Ask on demand.
  const panel = $('#testout')?.parentElement;
  if (panel && 'Notification' in window && Notification.permission !== 'granted') {
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

  // Incoming-call overlay is already shown by the app's EventSource handler. Add
  // a system notification only when the page is in the background and permission
  // has been granted by the user.
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

  // Ensure the Leave action remains responsive, including on mobile and while the
  // connection is in a failed state. Save a local call summary before closing tracks.
  const leaveButton = $('#leave');
  if (!leaveButton) return;
  let leaving = false;
  leaveButton.onclick = event => {
    event?.preventDefault();
    if (leaving) return;
    leaving = true;
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
        const fmt = value => value >= 1000 ? (value / 1000).toFixed(1) + ' GB' : value.toFixed(1) + ' MB';
        const duration = value => value < 60 ? Math.round(value) + ' sec' : Math.floor(value / 60) + ' min ' + Math.round(value % 60) + ' sec';
        const categories = {
          audio: ((totals.audioSent || 0) + (totals.audioRecv || 0)) / 1e6,
          video: ((totals.videoSent || 0) + (totals.videoRecv || 0)) / 1e6,
          slides: ((totals.screenSent || 0) + (totals.screenRecv || 0)) / 1e6,
          transport: ((totals.transportSent || 0) + (totals.transportRecv || 0)) / 1e6
        };
        const record = {
          id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
          endedAt: new Date().toISOString(), seconds, usedMB, baselineMB, savedMB, savedPct,
          people: (typeof peers !== 'undefined' ? peers.size : 0) + 1, categories
        };
        if (typeof addHistory === 'function') addHistory(record);
        if ($('#sumSaved')) $('#sumSaved').textContent = fmt(savedMB) + ' saved';
        if ($('#sumSub')) $('#sumSub').textContent = 'Measured usage: ' + fmt(usedMB) + ' · estimated HD baseline: ' + fmt(baselineMB) + ' (' + savedPct + '% less).';
        if ($('#sumDur')) $('#sumDur').textContent = duration(seconds);
        if ($('#sumUsed')) $('#sumUsed').textContent = fmt(usedMB);
        if ($('#sumBase')) $('#sumBase').textContent = fmt(baselineMB);
        if ($('#sumPeople')) $('#sumPeople').textContent = String(record.people);
        if ($('#sumCats')) $('#sumCats').textContent = 'Audio ' + fmt(categories.audio) + ' · Video ' + fmt(categories.video) + ' · Slides ' + fmt(categories.slides) + ' · Transport ' + fmt(categories.transport);
      }
    } catch (error) { console.warn('Could not save call summary:', error); }

    // Beacon is sent before tearing down the stream, and fallback fetch is kept alive.
    try {
      const payload = JSON.stringify({room, id: me, token});
      if (!navigator.sendBeacon || !navigator.sendBeacon('/leave', new Blob([payload], {type: 'application/json'}))) {
        fetch('/leave', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload, keepalive: true}).catch(() => {});
      }
    } catch (error) { console.warn('Could not notify room of leave:', error); }
    try { if (typeof es !== 'undefined' && es) es.close(); } catch {}
    try { if (typeof peers !== 'undefined') peers.forEach(peer => peer.pc.close()); } catch {}
    try { [mic, cam, scr].forEach(track => track && track.stop()); } catch {}
    try { if (typeof wake !== 'undefined' && wake) wake.release(); } catch {}
    try { if (typeof S !== 'undefined') S.ended = true; } catch {}

    if (typeof showTab === 'function') showTab('home');
    const summary = $('#sheet-summary');
    if (summary) summary.hidden = false;
    leaveButton.disabled = false;
    leaveButton.removeAttribute('aria-busy');
  };

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
