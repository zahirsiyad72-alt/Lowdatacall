/* Follow-up UX fixes: notifications and call summaries/history. Loaded after fixes.js. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  // Notifications need an explicit user gesture in modern browsers. Provide a clear
  // opt-in rather than relying on an automatic permission prompt during page load.
  const notificationButton = document.createElement('button');
  notificationButton.id = 'enable-notifications';
  notificationButton.className = 'btn outline';
  notificationButton.type = 'button';
  notificationButton.textContent = 'Enable call notifications';
  notificationButton.style.cssText = 'width:100%;margin:8px 0 0';
  const panel = $('#testout')?.parentElement;
  if (panel && 'Notification' in window && Notification.permission !== 'granted') {
    panel.insertBefore(notificationButton, $('#testout').nextSibling);
    notificationButton.onclick = async () => {
      try {
        const permission = await Notification.requestPermission();
        notificationButton.textContent = permission === 'granted' ? 'Call notifications enabled' : 'Notifications not enabled';
        notificationButton.disabled = permission === 'granted';
      } catch (error) {
        notificationButton.textContent = 'Notifications are unavailable in this browser';
      }
    };
  }

  // Display a system notification for incoming calls when the app is backgrounded.
  // The original handler still presents the in-app accept/decline overlay.
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
      } else {
        try { new Notification(title, options); } catch {}
      }
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'incoming-call' && event.data.room) {
        const overlay = $('#incoming-call');
        if (overlay) overlay.hidden = false;
      }
    });
  }

  // Save measured per-device usage and show the existing end-of-call summary instead
  // of immediately reloading and discarding the statistics.
  const leaveButton = $('#leave');
  if (!leaveButton || typeof accountant === 'undefined' || typeof S === 'undefined') return;
  leaveButton.onclick = () => {
    if (leaveButton.disabled) return;
    leaveButton.disabled = true;
    const bytes = accountant.session;
    const audio = (bytes.audioSent || 0) + (bytes.audioRecv || 0);
    const video = (bytes.videoSent || 0) + (bytes.videoRecv || 0);
    const slides = (bytes.screenSent || 0) + (bytes.screenRecv || 0);
    const transport = (bytes.transportSent || 0) + (bytes.transportRecv || 0);
    const usedMB = Math.max(0, (Number(TU) || 0) + (Number(TD) || 0));
    const seconds = Math.max(0, (performance.now() - (S.t0 || performance.now())) / 1000);
    const baselineMB = seconds * (typeof BASELINE_KBPS === 'number' ? BASELINE_KBPS : 1400) / 8 / 1000;
    const savedMB = Math.max(0, baselineMB - usedMB);
    const savedPct = baselineMB > 0 ? Math.max(0, Math.min(100, Math.round(savedMB / baselineMB * 100))) : 0;
    const record = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      endedAt: new Date().toISOString(), seconds, usedMB, baselineMB, savedMB, savedPct,
      people: (typeof peers !== 'undefined' ? peers.size : 0) + 1,
      categories: {audio: audio / 1e6, video: video / 1e6, slides: slides / 1e6, transport: transport / 1e6}
    };
    try { if (typeof addHistory === 'function') addHistory(record); } catch (error) { console.warn('Could not save call history:', error); }

    const formatMB = value => value >= 1000 ? (value / 1000).toFixed(1) + ' GB' : value.toFixed(1) + ' MB';
    const formatDuration = value => value < 60 ? Math.round(value) + ' sec' : Math.floor(value / 60) + ' min ' + Math.round(value % 60) + ' sec';
    $('#sumSaved').textContent = formatMB(savedMB) + ' saved';
    $('#sumSub').textContent = 'Measured usage: ' + formatMB(usedMB) + ' · estimated HD baseline: ' + formatMB(baselineMB) + ' (' + savedPct + '% less).';
    $('#sumDur').textContent = formatDuration(seconds);
    $('#sumUsed').textContent = formatMB(usedMB);
    $('#sumBase').textContent = formatMB(baselineMB);
    $('#sumPeople').textContent = String(record.people);
    $('#sumCats').textContent = 'Audio ' + formatMB(record.categories.audio) + ' · Video ' + formatMB(record.categories.video) + ' · Slides ' + formatMB(record.categories.slides) + ' · Transport ' + formatMB(record.categories.transport);

    // Notify the other participants before closing this page's connections.
    try {
      const payload = JSON.stringify({room, id: me, token});
      if (!navigator.sendBeacon || !navigator.sendBeacon('/leave', new Blob([payload], {type: 'application/json'}))) {
        fetch('/leave', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload, keepalive: true}).catch(() => {});
      }
    } catch (error) { console.warn('Could not notify room of leave:', error); }
    try { if (es) es.close(); } catch {}
    try { peers.forEach(peer => peer.pc.close()); } catch {}
    try { [mic, cam, scr].forEach(track => track && track.stop()); } catch {}
    try { if (wake) wake.release(); } catch {}
    S.ended = true;
    if (typeof showTab === 'function') showTab('home');
    const summary = $('#sheet-summary');
    if (summary) summary.hidden = false;
  };

  // Fresh state on the next call; history remains in local storage.
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
