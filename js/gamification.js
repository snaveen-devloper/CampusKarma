'use strict';
// ── Store ─────────────────────────────────────────────────────────────────
function renderStore(){
  const el=document.getElementById('store-grid');if(!el)return;
  const items=[
    {id:'boost',name:'Visibility Boost',desc:'Top of Discover for 24h',kp:100,color:'var(--em)',icon:'⚡'},
    {id:'shield',name:'Streak Shield',desc:'Protect streak for 1 day',kp:150,color:'var(--bl)',icon:'🛡'},
    {id:'xp2x',name:'XP Double',desc:'2× XP for 24 hours',kp:200,color:'var(--am)',icon:'📈'},
    {id:'priority',name:'Priority Match',desc:'Requests seen first',kp:250,color:'var(--cy)',icon:'🎯'},
  ];
  el.innerHTML=items.map(item=>{
    const owned=MY_BOOSTS[item.id];
    return`<div class="store-card${owned?' boosted':''}">
      <div class="sc-ic" style="background:${item.color}18;font-size:1.4rem;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:var(--r2)">${item.icon}</div>
      <div class="sc-name">${item.name}</div><div class="sc-desc">${item.desc}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="sc-price">${item.kp} KP</div>
        ${owned?`<span class="pill g">Active</span>`:`<button class="btn-sm p" onclick="buyItem('${item.id}','${item.name}',${item.kp})">${ME&&ME.kp>=item.kp?'Buy':'Need '+item.kp+' KP'}</button>`}
      </div></div>`;
  }).join('');
}

async function buyItem(id,name,kp){
  if(ME.kp<kp){toast('Not enough Karma Points','er');return;}
  try{
    await apiFetch('/store/buy',{method:'POST',body:{item_id:id,item_name:name,kp}});
    ME.kp-=kp;MY_BOOSTS[id]=true;syncUI();renderStore();toast(name+' activated!','ok');
  }catch(e){toast(e.message,'er');}
}

async function buyInstant(){
  try{
    await apiFetch('/store/instant-kp',{method:'POST'});
    ME.kp+=100;syncUI();renderWallet();toast('+100 Karma Points added!','ok');
  }catch(e){toast(e.message,'er');}
}

// ── Wallet ─────────────────────────────────────────────────────────────────
function renderWallet(){
  document.getElementById('w-bal').textContent=ME.kp;
  const el=document.getElementById('tx-list');if(!el)return;
  if(!MY_TXNS.length){el.innerHTML='<div class="empty"><div>No transactions yet</div></div>';return;}
  el.innerHTML=MY_TXNS.slice(0,20).map(t=>`
    <div class="tx-row">
      <div class="tx-ic" style="background:${t.type==='earn'?'var(--emb)':'var(--rdb)'};color:${t.type==='earn'?'var(--em)':'var(--rd)'}">💰</div>
      <div class="tx-info"><div class="tx-d">${t.description}</div><div class="tx-m">${t.sub||''} · ${t.date||'Today'}</div></div>
      <div class="tx-a ${t.type==='earn'?'plus':'minus'}">${t.amount>0?'+':''}${t.amount} KP</div>
    </div>`).join('');
}

// ── Profile ────────────────────────────────────────────────────────────────
function renderProfile(){
  const sp=document.getElementById('pr-subj');
  const active=(ME.subjects||[]).filter(s=>s.teach||s.learn);
  sp.innerHTML=active.length?active.map(s=>[s.teach?`<span class="sp sp-t">${s.name}</span>`:'',s.learn?`<span class="sp sp-l">${s.name}</span>`:''].join('')).join(''):`<span style="color:var(--t3);font-size:.8rem">No interests set. <button class="btn-sm o" onclick="openEditInterests()">Add now</button></span>`;
  const lv=getLevel();
  document.getElementById('pr-stats').innerHTML=[
    ['Sessions',ME.sess_count||0,lv.color],['Karma',ME.kp,'var(--am)'],
    ['Streak',(ME.streak||0)+'d','var(--am)'],['Level',lv.name,lv.color],
  ].map(([l,v,c])=>`<div class="sg-cell"><div class="sg-v" style="color:${c}">${v}</div><div class="sg-l">${l}</div></div>`).join('');
  renderBadges();
}

function renderBadges(){
  const el=document.getElementById('pr-badges');if(!el)return;
  el.innerHTML=MY_BADGES.map(b=>`<div class="badge-c${b.earned?' earned':' locked'}">
    <div class="badge-ic" style="background:${b.earned?'var(--amb)':'var(--s3)'};color:${b.earned?'var(--am)':'var(--t3)'}">🏅</div>
    <div class="badge-n">${b.name||b.n}</div><div class="badge-d">${b.desc}</div></div>`).join('');
}

// ── Edit Interests ─────────────────────────────────────────────────────────
let editSubjs=[];
function openEditInterests(){
  editSubjs=(ME.subjects||[]).map(s=>({...s}));
  const el=document.getElementById('sei-list');
  el.innerHTML=SUBJECTS.map(subj=>{
    const name=typeof subj==='string'?subj:subj.n;
    let s=editSubjs.find(x=>x.name===name)||{name,teach:false,learn:false};
    if(!editSubjs.find(x=>x.name===name))editSubjs.push(s);
    return`<div class="sei-row" id="sei-${name.replace(/[^a-z]/gi,'_')}">
      <div class="sei-n">${name}</div>
      <div class="sei-tgls">
        <div class="sei-t teach${s.teach?' on':''}" onclick="toggleSei('${name}','teach')">Teach</div>
        <div class="sei-t learn${s.learn?' on':''}" onclick="toggleSei('${name}','learn')">Learn</div>
      </div></div>`;
  }).join('');
  document.getElementById('modal-interests').classList.add('on');
}
function toggleSei(name,type){const s=editSubjs.find(x=>x.name===name);if(s)s[type]=!s[type];const row=document.getElementById('sei-'+name.replace(/[^a-z]/gi,'_'));if(row)row.querySelector('.sei-t.'+type).classList.toggle('on',s[type]);}
async function saveInterests(){ME.subjects=editSubjs.filter(s=>s.teach||s.learn);await saveMe();renderProfile();renderDiscover();closeOvl('modal-interests');toast('Interests updated!','ok');}

// ── Report ─────────────────────────────────────────────────────────────────
function openReport(peerId){
  reportReason=null;document.querySelectorAll('.report-opt').forEach(o=>o.classList.remove('on'));
  const conn=getConnected();const allPeers=[...conn,...ALL_USERS.filter(u=>!conn.includes(u.uid)).map(u=>u.uid)];
  if(!allPeers.length){toast('No users to report','er');return;}
  document.getElementById('report-peer').innerHTML=allPeers.map(uid=>{const p=ALL_USERS.find(u=>u.uid===uid)||{name:'User'};return`<option value="${uid}"${uid===peerId&&peerId!=='self'?' selected':''}>${p.name}</option>`;}).join('');
  document.getElementById('report-detail').value='';
  document.getElementById('modal-report').classList.add('on');
}
function selectReport(el,reason){reportReason=reason;document.querySelectorAll('.report-opt').forEach(o=>o.classList.remove('on'));el.classList.add('on');}
async function submitReport(){
  if(!reportReason){toast('Please select a reason','er');return;}
  const pid=document.getElementById('report-peer').value;
  const detail=document.getElementById('report-detail').value.trim();
  await apiFetch('/store/report',{method:'POST',body:{target_uid:pid,reason:reportReason,detail}});
  closeOvl('modal-report');toast('Report submitted. We review within 24 hours.','ok');
}

// ── AI Insights Tab ────────────────────────────────────────────────────────
async function renderAIInsights(){
  const el=document.getElementById('tab-ai');if(!el)return;
  const scoreEl=document.getElementById('ai-teaching-score');
  const feedEl=document.getElementById('ai-feedback-list');
  if(scoreEl)scoreEl.textContent=(ME.teaching_score||0).toFixed(1)+'/10';
  if(feedEl){feedEl.innerHTML='<div style="font-size:.78rem;color:var(--t3)">Loading...</div>';}
  try{
    const{recent_feedback,teaching_score,rep_score}=await apiFetch('/ai/my-score');
    if(scoreEl)scoreEl.textContent=(teaching_score||0).toFixed(1)+'/10';
    const repEl=document.getElementById('ai-rep-score');if(repEl)repEl.textContent=(rep_score||0).toFixed(1);
    if(!feedEl)return;
    if(!recent_feedback||!recent_feedback.length){feedEl.innerHTML='<div class="empty"><div>Complete sessions to get AI feedback!</div></div>';return;}
    feedEl.innerHTML=recent_feedback.map(f=>{
      let fb={summary:'Good session!',suggestions:[]};
      try{fb=JSON.parse(f.feedback_text);}catch{}
      return`<div class="card cp" style="margin-bottom:.65rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem">
          <span style="font-size:.78rem;font-weight:700;color:var(--em)">Clarity: ${(f.clarity_score||0).toFixed(1)}/10</span>
          <span style="font-size:.78rem;font-weight:700;color:var(--cy)">Engagement: ${(f.engagement_score||0).toFixed(1)}/10</span>
        </div>
        <div style="font-size:.8rem;color:var(--t2);line-height:1.5">${fb.summary||''}</div>
        ${(fb.suggestions||[]).length?`<div style="margin-top:.5rem"><div style="font-size:.7rem;color:var(--t3);font-weight:700;margin-bottom:.3rem">TIPS</div>${fb.suggestions.map(s=>`<div style="font-size:.75rem;color:var(--t2);margin-bottom:.2rem">• ${s}</div>`).join('')}</div>`:''}
      </div>`;
    }).join('');
  }catch(e){if(feedEl)feedEl.innerHTML='<div class="empty"><div>No AI feedback yet.</div></div>';}
}

// ── Gamification ───────────────────────────────────────────────────────────
function checkLevelUp(){
  const oldLv=LEVELS.find(l=>l.level===ME.level)||LEVELS[0];
  const newLv=getLevel();
  if(newLv.level>oldLv.level){ME.level=newLv.level;showLevelUp(newLv);}
  checkBadges();
}
function showLevelUp(lv){
  const el=document.getElementById('levelup');
  document.getElementById('lu-badge').style.cssText=`background:${lv.color}20;color:${lv.color};border:2px solid ${lv.color}40;`;
  document.getElementById('lu-badge').textContent=lv.name;
  document.getElementById('lu-sub').textContent='You reached '+lv.name+'! Keep going!';
  const cf=document.getElementById('confetti-el');cf.innerHTML='';
  const cols=[lv.color,'#f59e0b','#10b981','#6366f1','#ef4444'];
  for(let i=0;i<30;i++){const p=document.createElement('div');p.className='c-piece';p.style.cssText=`left:${Math.random()*100}%;top:${-10+Math.random()*10}px;background:${cols[i%cols.length]};animation-delay:${Math.random()*1.5}s;animation-duration:${1.5+Math.random()}s;transform:rotate(${Math.random()*360}deg)`;cf.appendChild(p);}
  el.style.display='flex';
}
function checkBadges(){
  let changed=false;
  MY_BADGES.forEach(b=>{if(!b.earned&&b.chk(ME)){b.earned=true;changed=true;toast('Badge unlocked: '+b.name+'!','ok');}});
  if(changed){renderBadges();document.getElementById('h-badges').textContent=MY_BADGES.filter(b=>b.earned).length;}
}

// ── Streak ─────────────────────────────────────────────────────────────────
function updateStreak(){
  const today=toDateStr(new Date());
  if(ME.last_active===today)return;
  const yesterday=toDateStr(addDays(new Date(),-1));
  ME.streak=ME.last_active===yesterday?(ME.streak||0)+1:1;
  ME.last_active=today;
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTm=null;
function toast(msg,type='ok'){
  const el=document.getElementById('toast-el');
  document.getElementById('toast-msg').textContent=msg;
  el.className='toast '+(type==='er'?'er':'ok')+' on';
  if(toastTm)clearTimeout(toastTm);
  toastTm=setTimeout(()=>el.classList.remove('on'),3000);
}

// ── Overlay helpers ────────────────────────────────────────────────────────
function closeOvl(id){document.getElementById(id).classList.remove('on');}

// ── WebSocket Handlers ─────────────────────────────────────────────────────
function setupWSHandlers(){
  onWS('chat_message', onIncomingChat);
  onWS('pub_key_received', onPubKeyReceived);
  onWS('quiz_push', showQuizPopup);
  onWS('quiz_result', onQuizResult);
  onWS('student_answered', onStudentAnswered);
  onWS('new_request', ()=>{apiFetch('/requests').then(r=>{MY_REQS=r.requests||[];syncUI();});});
  onWS('session_event', (msg)=>{if(msg.event==='live'){apiFetch('/sessions').then(r=>{MY_SESS=r.sessions||[];renderSessions();});}});
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init(){
  if(TOKEN){
    try{
      const{user}=await apiFetch('/auth/me');
      ME=user;ME.subjects=Array.isArray(ME.subjects)?ME.subjects:[];ME.ratings=Array.isArray(ME.ratings)?ME.ratings:[];
      if(ME.is_new){document.getElementById('scr-splash').classList.remove('on');showOb();}
      else{await loadAndLaunch();document.getElementById('scr-splash').classList.remove('on');}
      return;
    }catch{clearToken();}
  }
  document.getElementById('scr-splash').classList.remove('on');
  document.getElementById('scr-auth').classList.add('on');
}

setTimeout(init,1200);
document.querySelectorAll('.ovl').forEach(o=>o.addEventListener('click',function(e){if(e.target===this)this.classList.remove('on');}));
