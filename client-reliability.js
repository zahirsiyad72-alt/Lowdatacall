/* ICE and cross-device call reliability safeguards. Loaded after the main client scripts. */
(() => {
  'use strict';

  // Do not turn relay-only mode on globally after one peer fails. A failed direct
  // path should not poison subsequent calls; ICE should keep using all candidates.
  if (typeof S !== 'undefined') {
    try {
      Object.defineProperty(S, 'forceRelay', {
        configurable: false,
        enumerable: true,
        get: () => false,
        set: () => {}
      });
    } catch (error) { console.warn('Could not keep ICE in automatic mode:', error); }
  }

  // Trickle ICE candidates can arrive while setRemoteDescription is still pending.
  // Queue them per peer connection and apply them once the remote SDP is installed.
  if (window.RTCPeerConnection) {
    const proto = RTCPeerConnection.prototype;
    if (!proto.__lowdataCandidateQueue) {
      const originalAddIceCandidate = proto.addIceCandidate;
      const originalSetRemoteDescription = proto.setRemoteDescription;
      const pending = new WeakMap();
      proto.addIceCandidate = function (candidate, ...rest) {
        if (!this.remoteDescription) {
          const queue = pending.get(this) || [];
          queue.push([candidate, rest]);
          pending.set(this, queue);
          return Promise.resolve();
        }
        return originalAddIceCandidate.call(this, candidate, ...rest);
      };
      proto.setRemoteDescription = async function (description) {
        const result = await originalSetRemoteDescription.call(this, description);
        const queue = pending.get(this) || [];
        pending.delete(this);
        for (const [candidate, rest] of queue) {
          try { await originalAddIceCandidate.call(this, candidate, ...rest); }
          catch (error) { console.warn('Ignoring stale ICE candidate:', error); }
        }
        return result;
      };
      Object.defineProperty(proto, '__lowdataCandidateQueue', {value: true});
    }
  }

  // Trigger ICE recovery on network changes without reloading or switching every
  // subsequent peer to relay-only mode. The app's existing restart logic handles
  // the actual offer/answer exchange.
  const connection = navigator.connection;
  if (connection && typeof peers !== 'undefined') {
    connection.addEventListener('change', () => {
      try {
        peers.forEach(peer => {
          if (peer.pc.connectionState === 'connected') return;
          if (typeof restartIce === 'function') restartIce(peer, true);
        });
      } catch (error) { console.warn('ICE network-change recovery failed:', error); }
    });
  }
})();
