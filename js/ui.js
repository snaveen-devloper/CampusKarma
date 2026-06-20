'use strict';
// ── syncUI ─────────────────────────────────────────────────────────────────
function syncUI(){
  if(!ME)return;
  const first=ME.name.split(' ')[0];
  setAv('sb-av',ME.uid,ME.name,28,.58);
  document.getElementById('sb-uname').textContent=first;
  document.getElementById('sb-ukp').textContent=ME.kp+' KP';
  const h=new Date().getHours();
  document.getElementById('home-greet').textContent=(h<12?'Good morning':h<17?'Good afternoon':'Good evening')+', '+first;
  document.getElementById('h-kp').textContent=ME.kp;
  document.getElementById('h-sess').textContent=ME.sess_count||0;
  document.getElementById('h-badges').textContent=MY_BADGES.filter(b=>b.earned).length;
  document.getElementById('streak-n').textContent=ME.streak||0;
  renderStreakDays();renderXpBar();
  document.getElementById('w-bal').textContent=ME.kp;
  document.getElementById('store-bal').textContent=ME.kp+' KP available';
  const pending=MY_REQS.filter(r=>r.to_uid===ME.uid&&r.status==='pending').length;
  const nb=document.getElementById('nb-req');
  nb.style.display=pending?'':'none';nb.textContent=pending;
  document.getElementById('pr-name').textContent=ME.name;
  document.getElementById('pr-cls').textContent=ME.cls+' · '+ME.school;
  document.getElementById('pr-kp').textContent=ME.kp+' Karma Points';
  setAv('pr-av',ME.uid,ME.name,54,.9);
  // Teaching score badge
  const ts=ME.teaching_score||0;
  const tsBadge=document.getElementById('pr-teaching-badge');
  if(tsBadge){tsBadge.style.display=ts>0?'flex':'none';tsBadge.querySelector('.ts-val').textContent=ts.toFixed(1);}
  renderHome();renderBadges();renderWallet();renderStore();renderProfile();renderQuests();
}

function setAv(id,uid,name,size,fs){
  const el=document.getElementById(id);if(!el)return;
  el.style.cssText=avStyle(uid,name,size,fs);el.textContent=initials(name);
}

function renderXpBar(){
  const lv=getLevel();
  const nextLv=LEVELS[Math.min(lv.level,LEVELS.length-1)];
  const xp=ME.xp||0;
  const pct=lv.level>=5?100:Math.min(100,Math.round((xp-lv.minXp)/(nextLv.minXp-lv.minXp)*100));
  document.getElementById('xp-bar-card').innerHTML=`
    <div class="xp-top"><div class="xp-level"><div class="level-badge" style="background:${lv.color}20;color:${lv.color};border:1.5px solid ${lv.color}40">${lv.name}</div><div class="xp-name">${ME.name.split(' ')[0]}</div></div><div class="xp-pts">${xp} XP · Lvl ${lv.level}</div></div>
    <div class="xp-bar"><div class="xp-fill" style="width:${pct}%;background:${lv.color}"></div></div>
    <div style="display:flex;justify-content:space-between;margin-top:.35rem;font-size:.67rem;color:var(--t3)"><span>${xp} XP</span><span>${lv.level<5?nextLv.minXp+' XP to '+nextLv.name:'Max Level!'}</span></div>`;
}

function renderStreakDays(){
  const el=document.getElementById('streak-days');
  const s=Math.min(ME.streak||0,7);
  el.innerHTML=[...Array(7)].map((_,i)=>`<div class="sd" style="background:${i<s?'var(--am)':'var(--bd)'}"></div>`).join('');
}

function goTab(id,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  document.getElementById('tab-'+id).classList.add('on');
  el.classList.add('on');
  if(id==='discover')renderDiscover();
  if(id==='requests')renderRequests();
  if(id==='sessions'){renderCal();renderSessions();}
  if(id==='chat')renderChat();
  if(id==='notes')fetchNotes();
  if(id==='ai')renderAIInsights();
}

// ── Home ───────────────────────────────────────────────────────────────────
function renderHome(){
  const el=document.getElementById('home-matches');el.innerHTML='';
  const scored=ALL_USERS.map(u=>({...u,score:matchScore(u)})).sort((a,b)=>b.score-a.score).slice(0,3);
  if(!scored.length){el.innerHTML='<div class="empty"><div class="ei"><i class="ph ph-users"></i></div><div>No users yet. Invite classmates!</div></div>';}
  else scored.forEach(p=>el.appendChild(makePeerCard(p,true)));
  const af=document.getElementById('activity-feed');af.innerHTML='';
  ACTIVITY.slice(0,5).forEach(a=>{
    const d=document.createElement('div');d.className='feed-item';
    d.innerHTML=`<div class="online-dot"></div><div class="fi-msg">${a.msg}</div><div class="fi-time">${new Date(a.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
    af.appendChild(d);
  });
  document.getElementById('online-count').textContent=ALL_USERS.length+' users';
  const lbEl=document.getElementById('home-lb');
  const all=[...ALL_USERS.map(u=>({uid:u.uid,name:u.name,school:u.school,kp:u.kp,isMe:false})),{uid:ME.uid,name:ME.name,school:ME.school,kp:ME.kp,isMe:true}].sort((a,b)=>b.kp-a.kp).slice(0,5);
  const rc=['g1','g2','g3','',''];
  lbEl.innerHTML=all.map((u,i)=>`<div class="lb-row${u.isMe?' me':''}"><div class="lb-rk ${rc[i]||''}">${i+1}</div><div class="av" style="${avStyle(u.uid,u.name,32,.62)}">${initials(u.name)}</div><div class="lb-info"><div class="lb-n">${u.name}${u.isMe?' (You)':''}</div><div class="lb-s">${u.school}</div></div><div class="lb-kp">${u.kp} KP</div></div>`).join('');
}

function renderQuests(){
  const today=toDateStr(new Date());
  if(!MY_QUESTS.date||MY_QUESTS.date!==today){MY_QUESTS=buildFreshQuests();}
  const el=document.getElementById('quests-list');el.innerHTML='';
  QUEST_DEFS.forEach(qd=>{
    const prog=MY_QUESTS.progress[qd.id]||{done:0,claimed:false};
    const pct=Math.min(100,(prog.done/qd.target)*100);
    const done=prog.done>=qd.target;
    const d=document.createElement('div');d.className='quest-card';
    d.innerHTML=`<div class="quest-ic" style="background:${done?'var(--em)':'var(--bl)'}18;color:${done?'var(--em)':'var(--bl)'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></div>
      <div class="quest-mid"><div class="quest-name">${qd.name}</div><div class="quest-desc">${qd.desc}</div>
      <div class="quest-prog"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div style="font-size:.67rem;color:var(--t3);margin-top:.3rem">${prog.done}/${qd.target}</div></div>
      <div class="quest-rt"><div class="quest-xp">+${qd.xp} XP</div><div class="quest-kp">+${qd.kp} KP</div>
      ${done&&!prog.claimed?`<button class="btn-sm p" style="margin-top:.4rem;font-size:.67rem;padding:.25rem .6rem" onclick="claimQuest('${qd.id}')">Claim!</button>`:''}
      ${prog.claimed?`<span style="font-size:.67rem;color:var(--em);margin-top:.4rem">Claimed ✓</span>`:''}</div>`;
    el.appendChild(d);
  });
}

// ── Matching ───────────────────────────────────────────────────────────────
function myTeach(){return(ME.subjects||[]).filter(s=>s.teach).map(s=>s.name);}
function myLearn(){return(ME.subjects||[]).filter(s=>s.learn).map(s=>s.name);}
function matchScore(peer){
  const pt=(peer.subjects||[]).filter(s=>s.teach).map(s=>s.name);
  const pl=(peer.subjects||[]).filter(s=>s.learn).map(s=>s.name);
  const mt=myTeach(),ml=myLearn();
  const a=mt.filter(s=>pl.includes(s)).length,b=ml.filter(s=>pt.includes(s)).length;
  if(a+b===0)return 0;
  // AI Bridges the language gap, so we only care about technical/subject overlap
  return Math.min(99,Math.round(((a+b)/Math.max(mt.length+ml.length+pt.length+pl.length,1))*100*2.2)+30);
}
function loopType(peer){const s=matchScore(peer);return s>=85?{type:'3-Way Loop',cls:'loop-3'}:s>=70?{type:'4-Way Loop',cls:'loop-4'}:{type:'Direct Match',cls:'loop-d'};}
function getConnected(){return MY_REQS.filter(r=>r.status==='accepted'&&(r.from_uid===ME.uid||r.to_uid===ME.uid)).map(r=>r.from_uid===ME.uid?r.to_uid:r.from_uid);}
function isConnected(uid){return getConnected().includes(uid);}
function reqStatusWith(uid){const r=MY_REQS.find(r=>(r.from_uid===ME.uid&&r.to_uid===uid)||(r.to_uid===ME.uid&&r.from_uid===uid));return r?r.status:null;}

function makePeerCard(p,compact=false){
  const score=p.score||matchScore(p);const lt=loopType(p);const st=reqStatusWith(p.uid);const conn=isConnected(p.uid);
  const pt=(p.subjects||[]).filter(s=>s.teach).map(s=>`<span class="pill g">${s.name}</span>`).join('');
  const pl=(p.subjects||[]).filter(s=>s.learn).map(s=>`<span class="pill a">${s.name}</span>`).join('');
  const btnHtml=conn?`<button class="btn-sm b" onclick="openBookModal('${p.uid}')">Schedule</button>`:st==='pending'?`<span class="pill m">Pending</span>`:`<button class="btn-sm p" onclick="openReqModal('${p.uid}')">Connect</button>`;
  const d=document.createElement('div');d.className='peer-card';
  const ts=p.teaching_score||0;const tsHtml=ts>=7?`<div style="font-size:.65rem;color:var(--em);font-weight:700"><i class="ph-fill ph-star"></i> ${ts.toFixed(1)} Teacher</div>`:'';
  d.innerHTML=`<div class="av" style="${avStyle(p.uid,p.name,40,.72)}">${initials(p.name)}</div>
    <div class="peer-mid"><div class="peer-name">${p.name}</div><div class="peer-meta">${p.cls} · ${p.school}</div>${tsHtml}<div class="peer-tags">${pt}${pl}</div>
    <div style="font-size:.65rem;color:var(--am);font-weight:700;margin-top:2px"><i class="ph-fill ph-shield-check"></i> Trust Rank: ${p.rep_score?.toFixed(1) || '1.0'}</div>
    ${p.native_lang && ME.native_lang && p.native_lang !== ME.native_lang ? `<div style="font-size:.62rem;color:var(--cy);margin-top:2px"><i class="ph-fill ph-translate"></i> AI Translation Available</div>` : ''}
    </div>
    <div class="peer-rt"><div class="peer-score${score<70?' med':''}">${score}%</div><div class="peer-loop ${lt.cls}">${lt.type}</div>${btnHtml}</div>`;
  d.onclick=e=>{if(!e.target.classList.contains('btn-sm')&&!e.target.closest('.btn-sm')){viewCount++;advanceQuest('views',1);}};
  return d;
}

// ── Discover ───────────────────────────────────────────────────────────────
function renderDiscover(){
  const fr=document.getElementById('disc-filters');
  if(!fr.children.length){
    ['All','Best Match','Teaching Maths','Teaching Physics','Connected'].forEach((f,i)=>{
      const c=document.createElement('div');c.className='fc'+(i===0?' on':'');c.textContent=f;
      c.onclick=()=>{document.querySelectorAll('#disc-filters .fc').forEach(x=>x.classList.remove('on'));c.classList.add('on');renderDiscover();};
      fr.appendChild(c);
    });
  }
  const q=(document.getElementById('disc-search')?.value||'').toLowerCase();
  const af=document.querySelector('#disc-filters .fc.on')?.textContent||'All';
  const el=document.getElementById('disc-list');el.innerHTML='';
  let list=ALL_USERS.filter(p=>{
    const mq=!q||p.name.toLowerCase().includes(q)||(p.subjects||[]).map(s=>s.name).join(' ').toLowerCase().includes(q);
    const mf=af==='All'||(af==='Best Match'&&matchScore(p)>=60)||
      (af==='Teaching Maths'&&(p.subjects||[]).find(s=>s.name==='Mathematics'&&s.teach))||
      (af==='Teaching Physics'&&(p.subjects||[]).find(s=>s.name==='Physics'&&s.teach))||
      (af==='Connected'&&isConnected(p.uid));
    return mq&&mf;
  }).map(p=>({...p,score:matchScore(p)})).sort((a,b)=>b.score-a.score);
  document.getElementById('disc-count').textContent=list.length+' users';
  if(!list.length){el.innerHTML='<div class="empty"><div>No matching users found.</div></div>';return;}
  list.forEach(p=>el.appendChild(makePeerCard(p)));
}

// ── Requests ───────────────────────────────────────────────────────────────
function switchReqTab(tab,el){reqTab=tab;document.querySelectorAll('.rtab').forEach(t=>t.classList.remove('on'));el.classList.add('on');renderRequests();}

function renderRequests(){
  const el=document.getElementById('req-list');el.innerHTML='';
  if(reqTab==='recv'){
    const list=MY_REQS.filter(r=>r.to_uid===ME.uid&&r.status==='pending');
    if(!list.length){el.innerHTML='<div class="empty"><div>No pending requests</div></div>';return;}
    list.forEach(r=>{
      const p=ALL_USERS.find(u=>u.uid===r.from_uid)||{uid:r.from_uid,name:'User',cls:'—',school:'—',subjects:[]};
      const d=document.createElement('div');d.className='req-card';
      d.innerHTML=`<div class="av" style="${avStyle(p.uid,p.name,40,.72)}">${initials(p.name)}</div>
        <div class="req-body"><div class="req-name">${p.name}</div>
        <div class="req-det">${p.cls} · ${p.school}<br>Subject: <strong>${r.subject}</strong>${r.note?`<br><em style="color:var(--t2)">"${r.note}"</em>`:''}</div>
        <div class="req-acts"><button class="btn-sm p" onclick="acceptReq('${r.id}')">Accept</button><button class="btn-sm d" onclick="declineReq('${r.id}')">Decline</button></div></div>`;
      el.appendChild(d);
    });
  }else if(reqTab==='sent'){
    const list=MY_REQS.filter(r=>r.from_uid===ME.uid);
    if(!list.length){el.innerHTML='<div class="empty"><div>No sent requests</div></div>';return;}
    list.forEach(r=>{
      const p=ALL_USERS.find(u=>u.uid===r.to_uid)||{uid:r.to_uid,name:'User',cls:'—',school:'—',subjects:[]};
      const sp=r.status==='pending'?'<span class="pill a">Pending</span>':r.status==='accepted'?'<span class="pill g">Connected</span>':'<span class="pill r">Declined</span>';
      const d=document.createElement('div');d.className='req-card';
      d.innerHTML=`<div class="av" style="${avStyle(p.uid,p.name,40,.72)}">${initials(p.name)}</div>
        <div class="req-body"><div class="req-name">${p.name}</div><div class="req-det">${p.cls} · ${p.school}<br>Subject: <strong>${r.subject}</strong></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.5rem">${sp}${r.status==='pending'?`<button class="btn-sm d" onclick="cancelReq('${r.id}')">Cancel</button>`:''}</div></div>`;
      el.appendChild(d);
    });
  }else{
    const conn=getConnected();
    if(!conn.length){el.innerHTML='<div class="empty"><div>No connections yet.</div></div>';return;}
    conn.forEach(uid=>{
      const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'User',cls:'—',school:'—',subjects:[]};
      const d=document.createElement('div');d.className='req-card';
      d.innerHTML=`<div class="av" style="${avStyle(p.uid,p.name,40,.72)}">${initials(p.name)}</div>
        <div class="req-body"><div class="req-name">${p.name} <span class="pill g">Connected</span></div><div class="req-det">${p.cls} · ${p.school}</div>
        <div class="req-acts"><button class="btn-sm p" onclick="openBookModal('${uid}')">Schedule Session</button>
        <button class="btn-sm c" onclick="openChatWith('${uid}')">Chat</button></div></div>`;
      el.appendChild(d);
    });
  }
}

async function acceptReq(rid){
  await apiFetch('/requests/'+rid,{method:'PATCH',body:{status:'accepted'}});
  const r=MY_REQS.find(x=>x.id===rid);if(r)r.status='accepted';
  ME.kp+=20;ME.xp=(ME.xp||0)+25;MY_TXNS.unshift({icon:'users',description:'Connection accepted',sub:'',amount:'+20',type:'earn',date:'Today'});
  syncUI();renderRequests();toast('Connected! +20 KP','ok');
}
async function declineReq(rid){
  await apiFetch('/requests/'+rid,{method:'PATCH',body:{status:'declined'}});
  const r=MY_REQS.find(x=>x.id===rid);if(r)r.status='declined';
  syncUI();renderRequests();toast('Request declined','ok');
}
async function cancelReq(rid){
  await apiFetch('/requests/'+rid,{method:'PATCH',body:{status:'cancelled'}});
  const r=MY_REQS.find(x=>x.id===rid);if(r)r.status='cancelled';
  syncUI();renderRequests();toast('Request cancelled','ok');
}
async function endorsePeer(uid) {
  try {
    await apiFetch(`/users/${uid}/endorse`, { method: 'POST' });
    toast('Endorsed peer! Trust Rank updated.', 'ok');
    openProfile(uid);
  } catch (e) { toast(e.message, 'er'); }
}

async function openProfile(uid) {
  try {
    const { user } = await apiFetch(`/users/${uid}`);
    renderProfile(user);
    goTab('profile', document.querySelector('[data-t=profile]'));
  } catch (e) { toast('User not found', 'er'); }
}

function renderProfile(u) {
  const isMe = u.uid === ME.uid;
  document.getElementById('pr-name').textContent = u.name + (isMe ? ' (You)' : '');
  document.getElementById('pr-cls').textContent = (u.cls || '—') + ' · ' + (u.school || '—');
  document.getElementById('pr-kp').textContent = (u.kp || 0) + ' Karma Points';
  setAv('pr-av', u.uid, u.name, 54, .9);

  const ts = u.teaching_score || 0;
  const tsBadge = document.getElementById('pr-teaching-badge');
  if (tsBadge) {
    tsBadge.style.display = ts > 0 || u.rep_score > 1 ? 'flex' : 'none';
    tsBadge.innerHTML = `<i class="ph-fill ph-star"></i> Teaching: <span class="ts-val">${ts.toFixed(1)}</span>/10 <span style="margin-left:8px;color:var(--am)"><i class="ph-fill ph-shield-check"></i> Trust Rank: ${u.rep_score?.toFixed(1) || '1.0'}</span>`;
  }

  const subjEl = document.getElementById('pr-subj');
  subjEl.innerHTML = '';
  (u.subjects || []).forEach(s => {
    const chip = document.createElement('span');
    chip.className = 'pill ' + (s.teach ? 'g' : 'a');
    chip.textContent = s.name;
    subjEl.appendChild(chip);
  });

  const statsEl = document.getElementById('pr-stats');
  statsEl.innerHTML = `
    <div class="sg-cell"><div class="sg-v">${u.sess_count || 0}</div><div class="sg-l">Sessions</div></div>
    <div class="sg-cell"><div class="sg-v" style="color:var(--am)">${(u.rep_score || 1).toFixed(1)}</div><div class="sg-l">Trust Score</div></div>
  `;

  // Endorsement button for peers
  if (!isMe && isConnected(u.uid)) {
    const btn = document.createElement('button');
    btn.className = 'btn-p';
    btn.style.marginTop = '1rem';
    btn.innerHTML = '<i class="ph-fill ph-thumbs-up"></i> Endorse for Trust';
    btn.onclick = () => endorsePeer(u.uid);
    subjEl.parentNode.appendChild(btn);

    const rBtn = document.createElement('button');
    rBtn.className = 'btn-sm d';
    rBtn.style.marginTop = '1rem';
    rBtn.style.width = '100%';
    rBtn.innerHTML = '<i class="ph-fill ph-warning"></i> Report Conduct';
    rBtn.onclick = () => openReportModal(u.uid);
    subjEl.parentNode.appendChild(rBtn);
  }
}

async function openReportModal(uid) {
  const reason = prompt("Reason for report (e.g. Harassment, Off-topic, Privacy violation):");
  if (!reason) return;
  const detail = prompt("Details (optional):");
  try {
    await apiFetch('/reports', { method: 'POST', body: { target_uid: uid, reason, detail } });
    toast('Report submitted. Our safety system will review it.', 'ok');
  } catch (e) { toast(e.message, 'er'); }
}
