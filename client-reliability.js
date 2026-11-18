/* Active WebRTC reliability fixes, loaded after the main inline application script. */
(() => {
  'use strict';

  // Use automatic ICE selection on every fresh peer. A previous failed call must
  // never leave the app globally pinned to relay-only transport.
  try {
    if (typeof S !== 'undefined') {
      Object.defineProperty(S, 'forceRelay', {configurable: false, enumerable: true, get: () => false, set: () => {}});
    }
  } catch (error) { console.warn('ICE policy remains on browser default:', error); }

  // Both clients currently receive a welcome event at nearly the same time. Without
  // a tie-breaker they each create an offer (offer glare), which is unreliable on
  // mobile Safari and can leave the call stuck in signaling state. The lexically
  // smaller random user ID is the sole offerer for each peer pair.
  if (typeof call === 'function') {
    const originalCall = call;
    call = async function (peerId) {
      if (typeof me === 'string' && me.localeCompare(peerId) > 0) return;
      return originalCall(peerId);
    };
  }

  // Trickle ICE can deliver a candidate before remote SDP finishes installing.
  // Queue early candidates separately for each connection and apply them in order.
  if (window.RTCPeerConnection && !RTCPeerConnection.prototype.__lowdataCandidateQueue) {
    const proto = RTCPeerConnection.prototype;
    const addCandidate = proto.addIceCandidate;
    const setRemoteDescription = proto.setRemoteDescription;
    const queues = new WeakMap();
    proto.addIceCandidate = function (candidate, ...rest) {
      if (!this.remoteDescription) {
        const queue = queues.get(this) || [];
        queue.push([candidate, rest]);
        queues.set(this, queue);
        return Promise.resolve();
      }
      return addCandidate.call(this, candidate, ...rest);
    };
    proto.setRemoteDescription = async function (description) {
      const result = await setRemoteDescription.call(this, description);
      const queue = queues.get(this) || [];
      queues.delete(this);
      for (const [candidate, rest] of queue) {
        try { await addCandidate.call(this, candidate, ...rest); }
        catch (error) { console.debug('Ignoring invalid/stale ICE candidate:', error); }
      }
      return result;
    };
    Object.defineProperty(proto, '__lowdataCandidateQueue', {value: true});
  }
})();
