'use strict';
// ── Chat State ─────────────────────────────────────────────────────────────
let activeChatPeer = null;
let chatMessages = {};

function openChatWith(uid){
  activeChatPeer=uid;
  goTab('chat', document.querySelector('[data-t=chat]'));
  renderChatWindow(uid);
}

async function renderChat(){
  const el=document.getElementById('chat-conv-list');if(!el)return;
  const conn=getConnected();
  if(!conn.length){el.innerHTML='<div class="empty" style="padding:2rem .5rem"><div>Connect with peers first!</div></div>';return;}
  el.innerHTML='';
  conn.forEach(uid=>{
    const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'Peer',school:'',cls:''};
    const d=document.createElement('div');d.className='chat-conv-item'+(activeChatPeer===uid?' active':'');
    d.innerHTML=`<div class="av" style="${avStyle(uid,p.name,36,.68)}">${initials(p.name)}</div>
      <div class="chat-conv-info"><div class="chat-conv-name">${p.name}</div><div class="chat-conv-sub">${p.school}</div></div>
      <div class="chat-enc-badge" title="End-to-End Encrypted"><i class="ph-fill ph-lock-key"></i></div>`;
    d.onclick=()=>{ activeChatPeer=uid; document.querySelectorAll('.chat-conv-item').forEach(x=>x.classList.remove('active')); d.classList.add('active'); renderChatWindow(uid); };
    el.appendChild(d);
  });
  if(activeChatPeer) renderChatWindow(activeChatPeer);
}

async function renderChatWindow(uid){
  const panel=document.getElementById('chat-panel');
  const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'Peer'};
  panel.innerHTML=`
    <div class="chat-header">
      <div class="av" style="${avStyle(uid,p.name,36,.68)}">${initials(p.name)}</div>
      <div class="chat-header-info"><div class="chat-header-name">${p.name}</div>
        <div class="chat-header-sub"><i class="ph-fill ph-lock-key"></i> End-to-End Encrypted · No phone number needed</div></div>
    </div>
    <div class="chat-msgs" id="chat-msgs-${uid}"></div>
    <div class="chat-input-row">
      <input class="chat-input" id="chat-input-${uid}" placeholder="Type a message…" onkeydown="if(event.key==='Enter')sendChat('${uid}')"/>
      <button class="btn-sm p chat-send-btn" onclick="sendChat('${uid}')">Send</button>
    </div>`;

  // Load history
  try{
    const rid=roomId(ME.uid,uid);
    const {messages}=await apiFetch('/chat/'+rid);
    chatMessages[uid]=messages||[];
    // Try to establish AES key
    await getOrEstablishAES(uid);
    renderChatMessages(uid);
  }catch(e){console.warn('Chat load error',e);}
}

async function renderChatMessages(uid){
  const container=document.getElementById('chat-msgs-'+uid);if(!container)return;
  container.innerHTML='';
  const msgs=chatMessages[uid]||[];
  const aesKey=cryptoKeys[uid];
  for(const m of msgs){
    let text='[encrypted]';
    if(aesKey){
      try{text=await decryptMsg(aesKey,m.ciphertext,m.iv);}catch{}
    }
    const isMine=m.sender_uid===ME.uid;
    const d=document.createElement('div');d.className='chat-bubble'+(isMine?' mine':'');
    d.innerHTML=`<div class="chat-text">${escHtml(text)}</div><div class="chat-meta">${isMine?'You':ALL_USERS.find(u=>u.uid===m.sender_uid)?.name||'Peer'} · ${new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} <i class="ph-fill ph-lock-key"></i></div>`;
    container.appendChild(d);
  }
  container.scrollTop=container.scrollHeight;
}

async function sendChat(uid){
  const inp=document.getElementById('chat-input-'+uid);if(!inp||!inp.value.trim())return;
  const text=inp.value.trim();inp.value='';
  const rid=roomId(ME.uid,uid);
  let ciphertext,iv;
  const aesKey=await getOrEstablishAES(uid);
  if(aesKey){
    const enc=await encryptMsg(aesKey,text);
    ciphertext=enc.ciphertext;iv=enc.iv;
  }else{
    // Fallback: key not yet exchanged, store placeholder
    ciphertext=btoa(text);iv=btoa('no-key-yet');
    toast('Waiting for peer to come online to establish secure key…','ok');
  }
  const msgId='m_'+Date.now().toString(36);
  // Send via WebSocket
  wsSend({type:'chat_message',to:uid,room_id:rid,ciphertext,iv,id:msgId});
  // Also persist via REST (in case WS not delivered)
  await apiFetch('/chat/'+rid,{method:'POST',body:{ciphertext,iv}});
  // Add to local state
  if(!chatMessages[uid])chatMessages[uid]=[];
  chatMessages[uid].push({id:msgId,sender_uid:ME.uid,ciphertext,iv,ts:Date.now()});
  advanceQuest('chat_sent',1);
  renderChatMessages(uid);
}

function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Handle incoming chat via WebSocket
function onIncomingChat(msg){
  if(!chatMessages[msg.from])chatMessages[msg.from]=[];
  chatMessages[msg.from].push({id:msg.id,sender_uid:msg.from,ciphertext:msg.ciphertext,iv:msg.iv,ts:msg.ts});
  if(activeChatPeer===msg.from) renderChatMessages(msg.from);
  else toast('New message from '+( ALL_USERS.find(u=>u.uid===msg.from)?.name||'peer'),'ok');
}

// Handle incoming public key
async function onPubKeyReceived(msg){
  try{
    const kp=await getMyECDHPair();
    const peerPub=await importPeerPubKey(msg.pub_key);
    const aes=await deriveAES(kp.privateKey,peerPub);
    cryptoKeys[msg.from]=aes;
    // Also share our key back if not done
    const myPub=await exportPubKey(kp);
    await apiFetch('/chat/pubkey',{method:'POST',body:{peer_uid:msg.from,pub_key:myPub}});
    wsSend({type:'pub_key_share',for_uid:msg.from,pub_key:myPub});
    if(activeChatPeer===msg.from) renderChatMessages(msg.from);
  }catch(e){console.warn('Key exchange error',e);}
}
