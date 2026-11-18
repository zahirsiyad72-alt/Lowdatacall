/* Contact editing/sharing, mobile control placement, and WebRTC reliability. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  // Show a copyable invite code on the Contacts screen.
  const idCard = $('.my-id-card');
  if (idCard && !$('#copy-my-id')) {
    const actions = document.createElement('div');
    actions.className = 'rowb';
    actions.style.justifyContent = 'center';
    actions.innerHTML = '<button type="button" class="btn primary" id="copy-my-id">Copy my ID</button><button type="button" class="btn" id="share-my-id">Copy invite code</button>';
    idCard.appendChild(actions);
    $('#copy-my-id').onclick = async () => {
      const button = $('#copy-my-id');
      try {
        await navigator.clipboard.writeText(myId);
        button.textContent = 'Copied!';
      } catch {
        const field = document.createElement('textarea'); field.value = myId; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        try { document.execCommand('copy'); button.textContent = 'Copied!'; } catch { button.textContent = 'ID: ' + myId; }
        field.remove();
      }
      setTimeout(() => { button.textContent = 'Copy my ID'; }, 1800);
    };
    $('#share-my-id').onclick = async () => {
      const code = 'LOWDATA:' + myId;
      try { await navigator.clipboard.writeText(code); $('#share-my-id').textContent = 'Invite code copied!'; }
      catch { window.prompt('Copy and send this invite code:', code); }
      setTimeout(() => { $('#share-my-id').textContent = 'Copy invite code'; }, 1800);
    };
  }

  // Accept either a plain 8-character ID or a copied LOWDATA:<id> code. Prompt for
  // a friendly name at add time; name edits are local and never change their ID.
  const addFriend = $('#btn-add-friend');
  if (addFriend) addFriend.onclick = () => {
    const raw = $('#friend-id-input').value.trim();
    const id = raw.replace(/^LOWDATA:/i, '').trim().toLowerCase();
    if (!/^[a-f0-9]{8}$/.test(id)) return alert('Enter an 8-character friend ID or paste a LOWDATA invite code.');
    if (id === myId) return alert('You cannot add yourself.');
    if (friends.some(friend => friend.id === id)) return alert('This friend is already in your contacts.');
    const proposedName = window.prompt('Name this friend:', 'Friend ' + id.slice(0, 4));
    if (proposedName === null) return;
    const name = proposedName.trim().slice(0, 40) || 'Friend ' + id.slice(0, 4);
    friends.push({id, name});
    try { localStorage.setItem('ld_friends', JSON.stringify(friends)); } catch (error) { console.warn('Could not save contact:', error); }
    $('#friend-id-input').value = '';
    renderContacts();
  };

  // Re-render contacts with safe text nodes and edit/copy actions; avoids injecting
  // user-provided names into HTML. IDs remain the stable address for direct calls.
  if (typeof renderContacts === 'function') renderContacts = function () {
    const list = $('#friend-list');
    if (!list) return;
    list.replaceChildren();
    if (!friends.length) {
      const empty = document.createElement('div'); empty.className = 'hist empty';
      const title = document.createElement('b'); title.textContent = 'No contacts yet'; empty.append(title, document.createTextNode('Add a friend by their ID or invite code.'));
      list.appendChild(empty); return;
    }
    friends.forEach((friend, index) => {
      const row = document.createElement('div'); row.className = 'friend';
      const info = document.createElement('div');
      const name = document.createElement('div'); name.className = 'name'; name.textContent = friend.name || ('Friend ' + friend.id.slice(0, 4));
      const id = document.createElement('div'); id.className = 'id'; id.textContent = 'ID: ' + friend.id;
      info.append(name, id);
      const actions = document.createElement('div'); actions.className = 'rowb'; actions.style.margin = '0';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn'; edit.textContent = 'Edit name';
      edit.onclick = () => {
        const next = window.prompt('Edit friend name:', friend.name || '');
        if (next === null) return;
        friends[index] = {...friend, name: next.trim().slice(0, 40) || ('Friend ' + friend.id.slice(0, 4))};
        try { localStorage.setItem('ld_friends', JSON.stringify(friends)); } catch (error) { console.warn('Could not save contact name:', error); }
        renderContacts();
      };
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn'; copy.textContent = 'Copy code';
      copy.onclick = async () => {
        const code = 'LOWDATA:' + friend.id;
        try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied!'; }
        catch { window.prompt('Copy this invite code:', code); }
        setTimeout(() => { copy.textContent = 'Copy code'; }, 1600);
      };
      const callButton = document.createElement('button'); callButton.type = 'button'; callButton.className = 'btn primary'; callButton.textContent = 'Call';
      callButton.onclick = () => window.callFriend(friend.id);
      actions.append(edit, copy, callButton); row.append(info, actions); list.appendChild(row);
    });
  };

  // Mobile call action layout: menu on left, Leave on right and always tappable.
  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = `
    @media (max-width:700px) {
      #bar { position:fixed; z-index:80; left:8px; right:8px; bottom:max(8px,env(safe-area-inset-bottom)); display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px; border:0; background:transparent; }
      #controls-toggle { order:0; position:relative; z-index:81; min-width:82px; height:52px; border:1px solid var(--bd); border-radius:12px; background:var(--card); color:var(--fg); font-weight:700; box-shadow:0 3px 12px #0004; }
      #leave { order:10; position:relative; z-index:82; right:auto; bottom:auto; margin-left:auto; width:82px; height:52px; min-height:52px; border:2px solid #fff; border-radius:12px; display:flex!important; pointer-events:auto; touch-action:manipulation; box-shadow:0 3px 12px #0004; }
      #bar .ctl:not(#leave):not(#controls-toggle) { display:none; }
      #bar.controls-open { left:8px; right:8px; bottom:max(76px,calc(env(safe-area-inset-bottom) + 68px)); height:auto; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; padding:8px; border:1px solid var(--bd); border-radius:14px; background:var(--card); box-shadow:0 4px 18px #0005; }
      #bar.controls-open .ctl:not(#leave):not(#controls-toggle) { display:flex; }
      #bar.controls-open #controls-toggle { position:fixed; left:14px; bottom:max(12px,env(safe-area-inset-bottom)); }
      #bar.controls-open #leave { position:fixed; right:14px; bottom:max(12px,env(safe-area-inset-bottom)); }
      #bar #share { display:none!important; }
      #grid { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); align-content:stretch; overflow:hidden; }
      #grid:not(.focus) .tile { height:100%; min-height:0; aspect-ratio:auto; }
      #grid:not(.focus) .tile video { object-fit:contain; }
      #grid.focus { grid-template-columns:repeat(auto-fill,minmax(68px,1fr)); grid-template-rows:minmax(0,1fr) 76px; }
      #grid.focus .tile.pin { grid-column:1/-1; grid-row:1; height:100%; }
      #grid.focus .tile:not(.pin) { height:72px; }
    }
  `;
  document.head.appendChild(mobileStyle);

  const bar = $('#bar');
  let menu = $('#controls-toggle');
  if (bar && !menu) {
    menu = document.createElement('button'); menu.id = 'controls-toggle'; menu.type = 'button'; menu.textContent = 'Menu';
    menu.setAttribute('aria-expanded', 'false'); bar.insertBefore(menu, bar.firstChild);
  }
  if (bar && menu) {
    menu.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      const open = bar.classList.toggle('controls-open');
      menu.textContent = open ? 'Close' : 'Menu'; menu.setAttribute('aria-expanded', String(open));
    };
    bar.querySelectorAll('.ctl:not(#leave):not(#controls-toggle)').forEach(button => button.addEventListener('click', () => {
      if (matchMedia('(max-width:700px)').matches) { bar.classList.remove('controls-open'); menu.textContent = 'Menu'; menu.setAttribute('aria-expanded', 'false'); }
    }));
  }

  // Ensure the ICE fixes from the dedicated reliability script are active on the
  // deployed app, and resolve offer glare deterministically (one caller per pair).
  try {
    if (typeof S !== 'undefined') Object.defineProperty(S, 'forceRelay', {configurable:false, enumerable:true, get:() => false, set:() => {}});
  } catch {}
  if (typeof call === 'function' && !window.__lowdataOfferTieBreak) {
    const originalCall = call;
    call = function (peerId) {
      if (typeof me === 'string' && typeof peerId === 'string' && me.localeCompare(peerId) > 0) return Promise.resolve();
      return originalCall(peerId);
    };
    window.__lowdataOfferTieBreak = true;
  }
  if (window.RTCPeerConnection && !RTCPeerConnection.prototype.__lowdataEarlyICE) {
    const proto = RTCPeerConnection.prototype, add = proto.addIceCandidate, setRemote = proto.setRemoteDescription, queued = new WeakMap();
    proto.addIceCandidate = function (candidate, ...rest) {
      if (!this.remoteDescription) { const q = queued.get(this) || []; q.push([candidate, rest]); queued.set(this, q); return Promise.resolve(); }
      return add.call(this, candidate, ...rest);
    };
    proto.setRemoteDescription = async function (description) {
      const result = await setRemote.call(this, description), q = queued.get(this) || []; queued.delete(this);
      for (const [candidate, rest] of q) { try { await add.call(this, candidate, ...rest); } catch (error) { console.debug('Ignoring stale ICE candidate:', error); } }
      return result;
    };
    Object.defineProperty(proto, '__lowdataEarlyICE', {value:true});
  }
})();
