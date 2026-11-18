/* Runtime fixes for the MVP client. Loaded after the original page script. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  // The original startCall references a removed #join element before doing any work.
  // Keep a harmless compatibility node so joining is not aborted by a null dereference.
  if (!$('#join')) {
    const join = document.createElement('span');
    join.id = 'join'; join.hidden = true;
    document.body.appendChild(join);
  }

  // Reuse the app's WebRTC flow, but set the shared room before signaling. This is
  // essential for direct calls, where the room differs from the home-page room.
  if (typeof startCall === 'function') {
    const originalStartCall = startCall;
    let starting = false;
    startCall = async function (targetRoom) {
      const nextRoom = String(targetRoom || room || '').replace(/[^\w-]/g, '').slice(0, 40);
      if (!nextRoom || starting || (typeof es !== 'undefined' && es && es.readyState !== EventSource.CLOSED)) return;
      starting = true;
      room = nextRoom;
      if (typeof currentCallRoom !== 'undefined') currentCallRoom = nextRoom;
      if (location.hash.slice(1) !== nextRoom) history.replaceState(null, '', location.pathname + location.search + '#' + nextRoom);
      if ($('#room')) $('#room').textContent = nextRoom;
      if ($('#room2')) $('#room2').textContent = nextRoom;
      try { await originalStartCall(nextRoom); }
      catch (error) {
        console.error('Unable to start call:', error);
        const diagnostic = $('#diag');
        if (diagnostic) diagnostic.textContent = 'Could not start the call: ' + (error.message || 'please try again.');
        if (typeof es !== 'undefined' && es) { es.close(); es = null; }
        if (typeof showTab === 'function') showTab('home');
      } finally { starting = false; }
    };
  }

  // Invite panel and its actions were present in the markup but had no handlers.
  const inviteSheet = $('#sheet-invite');
  function openInvite() {
    const currentRoom = (typeof room !== 'undefined' && room) || location.hash.slice(1);
    const link = new URL(location.pathname, location.origin);
    link.hash = currentRoom;
    $('#link').value = link.href;
    inviteSheet.hidden = false;
  }
  ['#invite', '#e-invite'].forEach(selector => { const button = $(selector); if (button) button.onclick = openInvite; });
  const copyButton = $('#cpy');
  if (copyButton) copyButton.onclick = async () => {
    const input = $('#link');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(input.value);
      else { input.focus(); input.select(); if (!document.execCommand('copy')) throw new Error('Copy is not available'); }
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1600);
    } catch { input.focus(); input.select(); copyButton.textContent = 'Select and copy the link'; }
  };
  const nativeShare = $('#nat');
  if (nativeShare) {
    nativeShare.hidden = !navigator.share;
    nativeShare.onclick = async () => { try { await navigator.share({title: 'Join my LowData Call', url: $('#link').value}); } catch (e) { if (e.name !== 'AbortError') console.warn(e); } };
  }
  const whatsApp = $('#wa');
  if (whatsApp) whatsApp.onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent('Join my LowData Call: ' + $('#link').value), '_blank', 'noopener,noreferrer');
  const email = $('#em');
  if (email) email.onclick = () => { location.href = 'mailto:?subject=' + encodeURIComponent('Join my LowData Call') + '&body=' + encodeURIComponent('Join my call: ' + $('#link').value); };

  // Route the direct-call room through the same shared global state as WebRTC signaling.
  if (typeof callFriend === 'function') {
    callFriend = async function (friendId) {
      if (!/^[a-f0-9]{8}$/.test(friendId)) return alert('That contact ID is invalid.');
      const targetRoom = 'call-' + friendId;
      try {
        const response = await fetch('/ring', {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({to: friendId, from: myId, room: targetRoom, name: 'LowData Call'})
        });
        if (!response.ok) return alert('User is offline or unavailable.');
        await startCall(targetRoom);
      } catch (error) { alert('Could not place the call. Check your connection and try again.'); }
    };
  }
  const incomingAccept = $('#btn-accept');
  if (incomingAccept) {
    incomingAccept.addEventListener('click', () => {
      const overlay = $('#incoming-call');
      if (overlay) overlay.hidden = true;
      const targetRoom = typeof currentCallRoom !== 'undefined' ? currentCallRoom : location.hash.slice(1);
      if (targetRoom) startCall(targetRoom);
    });
  }

  // Start the HTML media elements from the user gesture, and make the speaker control
  // reliably toggle remote audio. Browser/device audio routing remains OS-controlled.
  let speakerOn = true;
  function applySpeakerState() {
    document.querySelectorAll('#grid video').forEach(video => {
      const isLocal = video.closest('.tile')?.dataset.k === 'me';
      video.muted = isLocal || !speakerOn;
      if (!isLocal && speakerOn && video.srcObject) video.play().catch(() => {});
    });
    const control = $('#speaker');
    if (control) {
      control.classList.toggle('on', speakerOn);
      control.classList.toggle('off', !speakerOn);
      control.setAttribute('aria-pressed', String(speakerOn));
      control.title = speakerOn ? 'Mute call audio' : 'Enable call audio';
      const label = control.querySelector('span'); if (label) label.textContent = speakerOn ? 'Speaker on' : 'Speaker off';
    }
  }
  const speaker = $('#speaker');
  if (speaker) speaker.onclick = () => { speakerOn = !speakerOn; applySpeakerState(); };
  const grid = $('#grid');
  if (grid) new MutationObserver(applySpeakerState).observe(grid, {childList: true, subtree: true});

  // Make leaving immediate and dependable even if the original inline handler has
  // partially failed. sendBeacon works while the page is navigating away.
  const leave = $('#leave');
  if (leave) leave.onclick = () => {
    leave.disabled = true;
    try {
      const payload = JSON.stringify({room, id: me, token});
      if (!navigator.sendBeacon || !navigator.sendBeacon('/leave', new Blob([payload], {type: 'application/json'}))) {
        fetch('/leave', {method: 'POST', headers: {'content-type': 'application/json'}, body: payload, keepalive: true}).catch(() => {});
      }
    } catch (error) { console.warn('Could not send leave signal:', error); }
    try { if (typeof es !== 'undefined' && es) es.close(); } catch {}
    try { if (typeof peers !== 'undefined') peers.forEach(peer => peer.pc.close()); } catch {}
    try { [mic, cam, scr].forEach(track => track && track.stop()); } catch {}
    try { if (typeof wake !== 'undefined' && wake) wake.release(); } catch {}
    location.reload();
  };

  // Avoid a crash on browsers without the Notification API.
  if (typeof Notification === 'undefined') window.Notification = {permission: 'denied'};
})();
