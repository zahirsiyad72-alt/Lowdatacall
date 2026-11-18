/* Restore the classic call toolbar and harden mobile media startup/playback. */
(() => {
  'use strict';
  const style = document.createElement('style');
  style.id = 'lowdata-call-toolbar-media-fix';
  style.textContent = `
    @media (max-width:700px) {
      #bar { position:relative!important; inset:auto!important; z-index:20; flex:0 0 auto; display:grid!important; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; padding:8px; padding-bottom:max(8px,env(safe-area-inset-bottom)); border-top:1px solid var(--bd); background:var(--card); }
      #bar .ctl { display:flex!important; position:relative!important; inset:auto!important; width:auto!important; height:auto!important; min-width:0; min-height:50px; margin:0!important; border-radius:12px; }
      #bar #share { display:none!important; }
      #bar #leave { grid-column:4; grid-row:1; min-height:50px; }
      #controls-toggle { display:none!important; }
      #grid { flex:1 1 auto; min-height:0; overflow:auto; grid-template-columns:minmax(0,1fr)!important; grid-template-rows:minmax(0,1fr) auto!important; align-content:stretch; }
      #grid .tile { min-width:0; }
      #grid.focus .tile.pin { grid-column:1/-1; grid-row:1; min-height:0; height:100%; }
      #grid.focus .tile:not(.pin) { grid-row:2; height:72px; }
      #grid.focus .tile.pin video, #grid:not(.focus) .tile video { object-fit:contain; }
      #app { min-height:0; overflow:hidden; }
    }
  `;
  document.head.appendChild(style);

  // Start pending sender track replacements before SDP generation. The original UI
  // invokes replaceTrack without awaiting it; this race can advertise an empty
  // sender during mobile Safari's slower media startup.
  if (window.RTCPeerConnection && window.RTCRtpSender && !RTCRtpSender.prototype.__lowdataTrackReady) {
    const senderProto = RTCRtpSender.prototype;
    const originalReplaceTrack = senderProto.replaceTrack;
    if (originalReplaceTrack) {
      senderProto.replaceTrack = function (track) {
        const pending = originalReplaceTrack.call(this, track);
        this.__lowdataPendingTrack = pending.catch(() => {});
        return pending;
      };
    }
    const pcProto = RTCPeerConnection.prototype;
    for (const method of ['createOffer', 'createAnswer']) {
      const original = pcProto[method];
      if (!original) continue;
      pcProto[method] = async function (...args) {
        await Promise.all(this.getSenders().map(sender => sender.__lowdataPendingTrack).filter(Boolean));
        return original.apply(this, args);
      };
    }
    Object.defineProperty(senderProto, '__lowdataTrackReady', {value:true});
  }

  // Give users useful ICE diagnostics instead of an indefinite “connecting” label.
  // TURN is necessary for many carrier/mobile-to-mobile NAT combinations; no client
  // code can substitute for a configured, reachable TURN service.
  if (typeof startCall === 'function' && !window.__lowdataTurnWarning) {
    const originalStartCall = startCall;
    startCall = async function (...args) {
      const result = await originalStartCall.apply(this, args);
      if (typeof hasRelay !== 'undefined' && !hasRelay) {
        const diagnostic = document.querySelector('#diag');
        if (diagnostic) diagnostic.textContent = 'No TURN relay is configured. Wi-Fi may connect directly, but mobile/mobile calls can fail. Configure CF_TURN_KEY_ID and CF_TURN_API_TOKEN on the server.';
      }
      return result;
    };
    window.__lowdataTurnWarning = true;
  }

  // Keep the main remote video playable after the user interacts with call controls.
  // playsinline is required by iOS; retry play on user gestures to satisfy autoplay rules.
  const unlockMedia = () => document.querySelectorAll('#grid video').forEach(video => {
    video.playsInline = true;
    if (video.srcObject) video.play().catch(() => {});
  });
  document.addEventListener('pointerup', unlockMedia, {passive:true});
  document.addEventListener('touchend', unlockMedia, {passive:true});
})();
