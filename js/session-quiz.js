'use strict';
// ── Calendar / Sessions ────────────────────────────────────────────────────
function renderCal(){
  const el=document.getElementById('cal-el');if(!el)return;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DNS=['Su','Mo','Tu','We','Th','Fr','Sa'];
  const y=calDate.getFullYear(),m=calDate.getMonth();
  const first=new Date(y,m,1).getDay(),total=new Date(y,m+1,0).getDate();
  const today=new Date();
  const sessDates=new Set(MY_SESS.filter(s=>s.status!=='done').map(s=>s.date));
  let cells=DNS.map(d=>`<div class="cal-dn">${d}</div>`).join('');
  for(let i=0;i<first;i++)cells+=`<div class="cday other"></div>`;
  for(let day=1;day<=total;day++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isTd=today.getFullYear()===y&&today.getMonth()===m&&today.getDate()===day;
    const isSel=selDate===ds,hasEv=sessDates.has(ds);
    const cls=['cday',isTd?'today':'',isSel?'sel':'',hasEv?'has-ev':''].filter(Boolean).join(' ');
    cells+=`<div class="${cls}" onclick="selectDay('${ds}')">${day}</div>`;
  }
  el.innerHTML=`<div class="cal-nav"><div class="cal-nav-btn" onclick="calNav(-1)">◀</div><div class="cal-mon">${MONTHS[m]} ${y}</div><div class="cal-nav-btn" onclick="calNav(1)">▶</div></div><div class="cal-grid">${cells}</div>`;
  renderSessions();
}
function calNav(d){calDate=new Date(calDate.getFullYear(),calDate.getMonth()+d,1);renderCal();}
function selectDay(ds){selDate=selDate===ds?null:ds;renderCal();}

function renderSessions(){
  const el=document.getElementById('sess-list');if(!el)return;
  let list=selDate?MY_SESS.filter(s=>s.date===selDate):MY_SESS;
  list=[...list].sort((a,b)=>{const o={live:0,upcoming:1,done:2};return(o[a.status]||0)-(o[b.status]||0);});
  if(!list.length){el.innerHTML=`<div class="empty"><div>No sessions${selDate?' on this date':''}</div><button class="btn-sm p" style="margin-top:.5rem" onclick="openBookModal()">Book Session</button></div>`;return;}
  el.innerHTML='';
  list.forEach(s=>{
    const pUid=s.peer1===ME.uid?s.peer2:s.peer1;
    const p=ALL_USERS.find(u=>u.uid===pUid)||{uid:pUid,name:'Peer'};
    const dt=new Date(s.date+'T00:00:00');const days=['Su','Mo','Tu','We','Th','Fr','Sa'];
    const sp=s.status==='live'?'<span class="pill r"><span class="blink"></span>Live</span>':s.status==='done'?'<span class="pill g">Done</span>':'<span class="pill a">Upcoming</span>';
    const d=document.createElement('div');d.className='sess-card';
    d.innerHTML=`<div class="s-time-col"><div class="sday">${days[dt.getDay()]}</div><div class="stime">${s.time}</div></div>
      <div class="s-body"><div class="s-name">${p.name}</div><div class="s-subj">${s.subject}</div>${sp}
      ${s.room_code?`<div class="enc-badge" style="margin-top:.35rem"><i class="ph-fill ph-key"></i> ${s.room_code}</div>`:''}
      <div class="s-acts">
        ${s.status==='live'?`<button class="btn-sm p" onclick="startVid('${pUid}','${s.subject}','${s.id}')">Join</button>`:''}
        ${s.status==='upcoming'?`<button class="btn-sm o" onclick="cancelSess('${s.id}')">Cancel</button>`:''}
        ${s.status==='done'&&!s.rated?`<button class="btn-sm a" onclick="openRate('${s.id}')">Rate</button>`:''}
      </div></div>`;
    el.appendChild(d);
  });
}

async function cancelSess(id){
  await apiFetch('/sessions/'+id,{method:'PATCH',body:{status:'cancelled'}});
  MY_SESS=MY_SESS.filter(s=>s.id!==id);renderCal();toast('Session cancelled','ok');
}

// ── Book Modal ─────────────────────────────────────────────────────────────
function openBookModal(peerId){
  const conn=getConnected();
  if(!conn.length){toast('Connect with a peer first','er');return;}
  const sel=document.getElementById('bk-peer');
  sel.innerHTML=conn.map(uid=>{const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'Peer'};return`<option value="${uid}"${uid===peerId?' selected':''}>${p.name}</option>`;}).join('');
  updateBkSubj();
  document.getElementById('bk-date').value=selDate||toDateStr(new Date());
  document.getElementById('bk-time').value='16:00';
  document.getElementById('modal-book').classList.add('on');
}
function updateBkSubj(){const uid=document.getElementById('bk-peer').value;const p=ALL_USERS.find(u=>u.uid===uid);const subjNames=SUBJECTS.map(s=>typeof s==='string'?s:s.n);const all=[...new Set([...(p?.subjects||[]).map(s=>s.name),...subjNames])];document.getElementById('bk-subj').innerHTML=all.map(s=>`<option>${s}</option>`).join('');}

async function confirmBook(){
  const pid=document.getElementById('bk-peer').value;
  const subj=document.getElementById('bk-subj').value;
  const date=document.getElementById('bk-date').value;
  const time=document.getElementById('bk-time').value;
  const role=document.getElementById('bk-role').value;
  if(!date||!time){toast('Please select date and time','er');return;}
  const fmt12=t=>{const[h,m]=t.split(':');const ap=+h>=12?'PM':'AM';return`${+h%12||12}:${m} ${ap}`;};
  try{
    const {id,room}=await apiFetch('/sessions',{method:'POST',body:{peer:pid,subject:subj,date,time:fmt12(time),role}});
    const newSess={id,peer1:ME.uid,peer2:pid,subject:subj,date,time:fmt12(time),role1:role,status:'upcoming',room_code:room,rated:0,booked_at:Date.now()};
    MY_SESS.unshift(newSess);if(role==='learn')ME.kp-=50;
    advanceQuest('sessions_booked',1);syncUI();renderCal();closeOvl('modal-book');
    toast('Session booked! Room: '+room,'ok');
  }catch(e){toast(e.message,'er');}
}

// ── Request Modal ──────────────────────────────────────────────────────────
function openReqModal(peerId){
  reqPeerId=peerId;
  const p=ALL_USERS.find(u=>u.uid===peerId);if(!p)return;
  document.getElementById('req-peer-info').innerHTML=`<div style="display:flex;align-items:center;gap:.85rem;padding:.85rem;background:var(--s2);border:1px solid var(--bd);border-radius:var(--r2)"><div class="av" style="${avStyle(p.uid,p.name,40,.72)}">${initials(p.name)}</div><div><div style="font-size:.88rem;font-weight:700">${p.name}</div><div style="font-size:.72rem;color:var(--t2)">${p.cls} · ${p.school}</div></div></div>`;
  const allS=[...new Set([...myTeach(),...(p.subjects||[]).filter(s=>s.learn).map(s=>s.name)])];
  const subjNames=SUBJECTS.map(s=>typeof s==='string'?s:s.n);
  document.getElementById('req-subj').innerHTML=(allS.length?allS:subjNames).map(s=>`<option>${s}</option>`).join('');
  document.getElementById('req-note').value='';
  document.getElementById('modal-req').classList.add('on');
}

async function confirmReq(){
  const pid=reqPeerId;
  const subj=document.getElementById('req-subj').value;
  const note=document.getElementById('req-note').value.trim();
  try{
    const {request}=await apiFetch('/requests',{method:'POST',body:{to_uid:pid,subject:subj,note}});
    MY_REQS.push(request);ME.xp=(ME.xp||0)+10;
    advanceQuest('requests_sent',1);syncUI();renderDiscover();closeOvl('modal-req');
    toast('Request sent!','ok');
  }catch(e){toast(e.message,'er');}
}

// ── Video Call ─────────────────────────────────────────────────────────────
let videoQuestions=[];let currentQuizQ=null;let quizAnsweredCount=0;let quizCorrectCount=0;
let recognition=null;let fullSessionTranscript="";let isMicMuted=false;

async function startVid(peerId,subject,sessId){
  const p=ALL_USERS.find(u=>u.uid===peerId)||{uid:peerId,name:'Peer'};
  activeVid={peerId,subject,sessId};sessionStartTime=Date.now();
  videoQuestions=[];quizAnsweredCount=0;quizCorrectCount=0;
  document.getElementById('vid-pname').textContent=p.name;
  document.getElementById('vid-subj').textContent=subject;
  const mav=document.getElementById('vid-main-av');mav.style.cssText=avStyle(p.uid,p.name,80,1.4);mav.textContent=initials(p.name);
  const sav=document.getElementById('vid-self-av');sav.style.cssText=avStyle(ME.uid,ME.name,36,.65);sav.textContent=initials(ME.name);
  document.getElementById('scr-vid').classList.add('on');
  document.getElementById('vid-timer').textContent='00:00';
  let sec=0;vidInterval=setInterval(()=>{sec++;document.getElementById('vid-timer').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');},1000);
  pomoSecs=25*60;pomoRunning=false;document.getElementById('pomo-timer').textContent='25:00';
  // Update session status to live
  if(sessId) await apiFetch('/sessions/'+sessId,{method:'PATCH',body:{status:'live'}});
  // Load pre-generated questions for teacher
  if(sessId){
    try{const r=await apiFetch('/quiz/generate',{method:'POST',body:{session_id:sessId,subject}});videoQuestions=r.questions||[];}catch{}
  }
  renderTeacherQuizPanel();
  startWebSpeechSTT(peerId);
}

function startWebSpeechSTT(peerId) {
  if (!('webkitSpeechRecognition' in window)) return;
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US'; // We could make this dynamic for multilingual

  recognition.onresult = (event) => {
    if (isMicMuted) return;
    let interimTrans = '';
    let finalTrans = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) finalTrans += event.results[i][0].transcript;
      else interimTrans += event.results[i][0].transcript;
    }
    
    if (finalTrans) {
      fullSessionTranscript += finalTrans + " ";
      wsSend({type:'live_transcript', to:peerId, text:finalTrans, isFinal:true});
      showSubtitles('You: ' + finalTrans);
    } else if (interimTrans) {
      wsSend({type:'live_transcript', to:peerId, text:interimTrans, isFinal:false});
      showSubtitles('You: ' + interimTrans);
    }
  };
  
  recognition.onend = () => { 
    if (activeVid && !isMicMuted) {
      console.log("Restarting STT for stability...");
      try { recognition.start(); } catch(e){}
    }
  };
  
  try { recognition.start(); } catch(e){
    console.warn("STT Start failed, retrying in 2s...");
    setTimeout(() => { if(activeVid && !isMicMuted) startWebSpeechSTT(peerId); }, 2000);
  }
}

function showSubtitles(text) {
  const subBox = document.getElementById('vid-subtitles');
  if (!subBox) return;
  subBox.textContent = text;
  subBox.style.opacity = '1';
  clearTimeout(window._subTm);
  window._subTm = setTimeout(() => subBox.style.opacity = '0', 4000);
}

function onIncomingTranscript(msg) {
  if (!activeVid) return;
  const p = ALL_USERS.find(u => u.uid === msg.from);
  const name = p ? p.name.split(' ')[0] : 'Peer';
  showSubtitles(name + ': ' + msg.text);
  if (msg.isFinal) {
    fullSessionTranscript += `${name}: ${msg.text}\n`;
  }
}

function renderTeacherQuizPanel(){
  const panel=document.getElementById('teacher-quiz-panel');if(!panel)return;
  if(!videoQuestions.length){panel.innerHTML='<div style="font-size:.75rem;color:var(--t3)">No questions loaded</div>';return;}
  panel.innerHTML=videoQuestions.map((q,i)=>`
    <div class="quiz-q-item" id="qqitem-${i}">
      <div style="font-size:.75rem;font-weight:600;margin-bottom:.35rem">${q.question}</div>
      <button class="btn-sm p" style="font-size:.68rem" onclick="pushQuizQuestion(${i})">Push to Student</button>
    </div>`).join('');
}

async function pushQuizQuestion(idx){
  if(!activeVid)return;
  currentQuizQ=videoQuestions[idx];
  const {peerId,sessId}=activeVid;
  await apiFetch('/quiz/push',{method:'POST',body:{question_id:currentQuizQ.id}});
  wsSend({type:'quiz_push',to:peerId,session_id:sessId,question_id:currentQuizQ.id,question:currentQuizQ.question,options:JSON.parse(currentQuizQ.options||'[]'),time_limit:30});
  toast('Quiz question pushed to student!','ok');
  document.getElementById('qqitem-'+idx).innerHTML+='<span style="font-size:.67rem;color:var(--em);margin-left:.5rem"><i class="ph ph-check"></i> Sent</span>';
}

// Student receives quiz via WS
function showQuizPopup(msg){
  const popup=document.getElementById('quiz-popup');
  document.getElementById('qp-question').textContent=msg.question;
  const opts=document.getElementById('qp-options');opts.innerHTML='';
  (msg.options||[]).forEach((opt,i)=>{
    const btn=document.createElement('button');btn.className='qp-opt-btn';btn.textContent=opt;
    btn.onclick=()=>submitQuizAnswer(msg.question_id,i,msg.from);
    opts.appendChild(btn);
  });
  // Timer
  let t=msg.time_limit||30;document.getElementById('qp-timer').textContent=t+'s';
  if(window._quizTm)clearInterval(window._quizTm);
  window._quizTm=setInterval(()=>{t--;document.getElementById('qp-timer').textContent=t+'s';if(t<=0){clearInterval(window._quizTm);submitQuizAnswer(msg.question_id,-1,msg.from);}},1000);
  popup.classList.add('on');
}

async function submitQuizAnswer(questionId,answerIdx,teacherUid){
  if(window._quizTm)clearInterval(window._quizTm);
  document.getElementById('quiz-popup').classList.remove('on');
  wsSend({type:'quiz_answer',question_id:questionId,answer_index:answerIdx,teacher_uid:teacherUid});
  // Also REST fallback
  try{const r=await apiFetch('/quiz/answer',{method:'POST',body:{question_id:questionId,answer_index:answerIdx,teacher_uid:teacherUid}});
    quizAnsweredCount++;if(r.is_correct){quizCorrectCount++;ME.xp=(ME.xp||0)+10;toast('Correct! +10 XP 🎉','ok');}else{toast('Incorrect — your teacher will re-explain!','er');}}catch{}
  syncUI();
}

function onStudentAnswered(msg){
  const icon=msg.is_correct?'<i class="ph-fill ph-check-circle"></i>':'<i class="ph-fill ph-x-circle"></i>';
  toast(`Student answered ${icon} — ${msg.is_correct?'+5 KP bonus!':'Re-explain recommended'}`, msg.is_correct?'ok':'er');
  if(msg.is_correct){ME.kp+=5;document.getElementById('sb-ukp').textContent=ME.kp+' KP';}
}

function onQuizResult(msg){
  quizAnsweredCount++;if(msg.is_correct){quizCorrectCount++;ME.xp=(ME.xp||0)+10;}
  toast(msg.is_correct?'Correct! +10 XP 🎉':'Wrong! Teacher will re-explain','er');syncUI();
}

function toggleVC(t){
  const b=document.getElementById('vc-'+t);b.classList.toggle('on');b.classList.toggle('off');
  if(t==='mic'){
    isMicMuted = b.classList.contains('off');
    if(isMicMuted && recognition) recognition.stop();
    else if(!isMicMuted && recognition) try{recognition.start();}catch(e){}
  }
  toast(t==='mic'?(b.classList.contains('on')?'Mic on':'Mic muted'):(b.classList.contains('on')?'Camera on':'Camera off'),'ok');
}
function togglePomo(){
  if(pomoRunning){clearInterval(pomoInterval);pomoRunning=false;document.querySelector('.pomo .btn-sm').textContent='Resume';}
  else{pomoRunning=true;document.querySelector('.pomo .btn-sm').textContent='Pause';
    pomoInterval=setInterval(()=>{if(pomoSecs<=0){clearInterval(pomoInterval);pomoRunning=false;toast('Break time! 5 min <i class="ph ph-coffee"></i>','ok');pomoSecs=5*60;return;}
      pomoSecs--;const m2=Math.floor(pomoSecs/60),s2=pomoSecs%60;document.getElementById('pomo-timer').textContent=String(m2).padStart(2,'0')+':'+String(s2).padStart(2,'0');},1000);}
}

async function endVid(){
  clearInterval(vidInterval);clearInterval(pomoInterval);
  document.getElementById('scr-vid').classList.remove('on');
  document.getElementById('vc-mic').className='vc on';
  document.getElementById('vc-cam').className='vc on';
  if(recognition) { recognition.onend = null; recognition.stop(); }
  pomoRunning=false;
  if(!activeVid)return;
  const{peerId,subject,sessId}=activeVid;
  const durMin=Math.round((Date.now()-sessionStartTime)/60000)||25;
  // Complete session
  try{await apiFetch('/sessions/'+(sessId||'none')+'/complete',{method:'POST',body:{name:ME.name}});}catch{}
  // Show session report
  showSessionReport(subject,durMin);
  // Trigger AI analysis with Full Transcript
  if(sessId) try{
    apiFetch('/ai/analyze',{method:'POST',body:{
      session_id:sessId,teacher_uid:ME.uid,student_uid:peerId,subject,
      quiz_correct:quizCorrectCount,quiz_total:quizAnsweredCount,
      session_duration_min:durMin, transcript: fullSessionTranscript
    }}).then(()=>{
      toast('AI Assistant finished learning notes & analysis! Check insights.', 'ok');
    });
  }catch{}
  syncUI();
  setTimeout(()=>{const si=MY_SESS.findIndex(s=>(s.peer1===ME.uid||s.peer2===ME.uid)&&!s.rated);if(si>=0)openRate(MY_SESS[si].id);},1000);
}

function showSessionReport(subject,durMin){
  const pct=quizAnsweredCount>0?Math.round((quizCorrectCount/quizAnsweredCount)*100):0;
  document.getElementById('sr-subject').textContent=subject;
  document.getElementById('sr-duration').textContent=durMin+' min';
  document.getElementById('sr-quiz').textContent=quizCorrectCount+'/'+quizAnsweredCount+' Pulse Checks ('+pct+'% engagement)';
  document.getElementById('sr-xp').textContent='+'+((quizCorrectCount*10)+100)+' XP earned this session';
  document.getElementById('modal-session-report').classList.add('on');
}

// ── Rate Session ───────────────────────────────────────────────────────────
function openRate(sessId){rateIdx=sessId;curStar=0;setStar(0);document.getElementById('rate-txt').value='';document.getElementById('modal-rate').classList.add('on');}
function setStar(n){curStar=n;document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('on',i<n));}
async function submitRate(){
  if(!curStar){toast('Please select a rating','er');return;}
  await apiFetch('/sessions/'+rateIdx,{method:'PATCH',body:{rating:curStar}});
  const s=MY_SESS.find(x=>x.id===rateIdx);if(s){s.rated=1;s.rating=curStar;}
  ME.kp+=15;ME.xp=(ME.xp||0)+20;checkLevelUp();syncUI();
  closeOvl('modal-rate');toast('Rating submitted! +15 KP','ok');
}
