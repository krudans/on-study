/* ===== 데이터 계층 (Firestore) =====
   앱 상태 전체를 단일 문서 state/app 에 저장(학생 ~20명 규모에 적합).
   로그인 권한 검증에 쓰는 admins 는 별도 컬렉션.
   ★ 입력/저장과 실시간 동기화가 충돌해 '수정이 안 되거나 입력 중 튕기는' 문제를
     막기 위해: (1) 시트(입력창)가 열려 있으면 원격 반영을 미룸 (2) 내가 방금 저장한
     직후엔 원격 에코가 덮어쓰지 못하게 함 (3) 실제로 바뀐 경우에만 저장. */

function stateDoc(){ return fbDb.collection('state').doc('app'); }

let _saveTimer=null;
let _applyingRemote=false;   // 원격 반영 중엔 저장 안 함(루프 방지)
let _lastLocalWrite=0;       // 마지막으로 내가 저장한 시각
let _lastJSON='';            // 마지막으로 저장/반영한 상태(중복 저장 방지)

function currentJSON(){ try{ return JSON.stringify(snapshot()); }catch(e){ return ''; } }
function sheetOpen(){ const s=document.getElementById('scrim'); return !!(s && s.classList.contains('show')); }

function writeNow(){
  if(typeof _sessionDead!=='undefined' && _sessionDead) return;
  const j=currentJSON(); if(!j) return;
  _lastJSON=j; _lastLocalWrite=Date.now();
  try{
    stateDoc().set(JSON.parse(j))
      .then(()=>{ _lastLocalWrite=Date.now(); })
      .catch(e=>console.warn('저장 실패', e));
  }catch(e){ console.warn('스냅샷 실패', e); }
}

/* 저장 요청 (변경 후 0.4초 디바운스) */
function saveData(){
  if(_applyingRemote) return;
  _lastLocalWrite=Date.now();   // 저장 요청 순간부터 원격 에코 무시(디바운스 틈 방지)
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(writeNow, 400);
}

/* 로그인 후 최초 로드 */
async function loadData(){
  try{
    const doc = await stateDoc().get();
    if(doc.exists) applyState(doc.data());
  }catch(e){ console.warn('로드 실패', e); }
  _lastJSON=currentJSON();
  await loadAdmins();
}

/* 관리자 명단 로드 (로그인 권한) */
async function loadAdmins(){
  try{
    const snap = await fbDb.collection('admins').get();
    admins = snap.docs.map(d=>({ email:d.id, name:d.data().name||d.id,
      phone:d.data().phone||'', owner:!!d.data().owner }));
  }catch(e){ console.warn('관리자 로드 실패', e); admins=[]; }
}
function addAdminDoc(email, data){
  fbDb.collection('admins').doc(email).set(data).catch(e=>console.warn('관리자 추가 실패', e));
}
function removeAdminDoc(email){
  fbDb.collection('admins').doc(email).delete().catch(e=>console.warn('관리자 삭제 실패', e));
}

/* 다른 기기 변경을 실시간 반영 */
let _subscribed=false;
function subscribeState(){
  if(_subscribed) return; _subscribed=true;
  stateDoc().onSnapshot(snap=>{
    if(!snap.exists) return;
    if(snap.metadata.hasPendingWrites) return;         // 내 저장의 낙관적 반영은 무시
    if(sheetOpen()) return;                            // 입력 중이면 화면 재렌더/덮어쓰기 금지
    if(Date.now()-_lastLocalWrite < 3000) return;      // 방금 내가 저장한 직후엔 에코 무시(덮어쓰기 방지)
    _applyingRemote=true;
    applyState(snap.data());
    _applyingRemote=false;
    _lastJSON=currentJSON();                            // 원격 반영 후 기준 갱신
    const app=document.getElementById('app');
    if(app && app.style.display!=='none' && typeof refreshCurrentView==='function'){
      refreshCurrentView();
    }
  }, e=>console.warn('실시간 동기화 실패', e));
}

/* 자동 저장 안전망: 실제로 내용이 바뀐 경우에만 저장 (출결 등 saveData 미호출 변경 대비).
   시트가 열려 있을 땐 건드리지 않음. */
setInterval(()=>{
  if(!currentUser || _applyingRemote || sheetOpen()) return;
  const j=currentJSON();
  if(j && j!==_lastJSON) writeNow();
}, 2500);

/* 종료 직전 저장 */
window.addEventListener('beforeunload', ()=>{
  try{ if(currentUser){ const j=currentJSON(); if(j && j!==_lastJSON) stateDoc().set(JSON.parse(j)); } }catch(e){}
});

/* ===== 단일 세션 락 (관리자/앱 각각 별도) =====
   한 번에 한 곳만 사용. 다른 세션이 접속 중이면 안내 → 종료 요청 → (불응 시) 강제 종료. */
const LOCK_MODE = (document.body.dataset.mode==='admin') ? 'admin' : 'app';
const LOCK_LABEL = LOCK_MODE==='admin' ? '관리자 페이지' : '앱';
let MY_SID = (function(){ try{ let s=sessionStorage.getItem('onstudy_sid'); if(!s){ s=Math.random().toString(36).slice(2)+Date.now().toString(36); sessionStorage.setItem('onstudy_sid',s);} return s; }catch(e){ return Math.random().toString(36).slice(2)+Date.now().toString(36);} })();
function lockDoc(){ return fbDb.collection('locks').doc(LOCK_MODE); }
let _lockUnsub=null, _iAmHolder=false, _sessionDead=false, _pendingHolder=null;
function _now(){ return Date.now(); }

function _ov(html){
  let el=document.getElementById('sessionOverlay');
  if(!el){ el=document.createElement('div'); el.id='sessionOverlay';
    el.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(24,20,14,.74);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit';
    document.body.appendChild(el); }
  el.innerHTML=`<div style="background:#fff;border-radius:18px;max-width:400px;width:100%;padding:26px 24px;box-shadow:0 14px 48px rgba(0,0,0,.28)">${html}</div>`;
  el.style.display='flex';
}
function _ovHide(){ const el=document.getElementById('sessionOverlay'); if(el) el.style.display='none'; }
const _btnDark='width:100%;padding:13px;border:none;border-radius:11px;background:#242A31;color:#fff;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;margin-bottom:9px';
const _btnRed='width:100%;padding:13px;border:none;border-radius:11px;background:#C0392B;color:#fff;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;margin-bottom:9px';
const _btnGray='width:100%;padding:13px;border:1px solid #E3E1DA;border-radius:11px;background:#F7F6F2;color:#555;font-weight:600;font-size:15px;font-family:inherit;cursor:pointer';
const _ttl='font-size:17px;font-weight:800;color:#242A31;margin-bottom:8px';
const _txt='font-size:14px;color:#555;line-height:1.65;margin-bottom:18px';

/* 로그인 후 auth.js가 initApp 대신 호출 */
async function acquireSession(){
  // 단일 세션 락 비활성화 — 동시 접속 허용
  initApp();
}
async function _acquireSession_LOCKED(){
  let snap; try{ snap=await lockDoc().get(); }catch(e){ initApp(); return; }
  const holder = snap.exists ? (snap.data()||{}).holder : null;
  if(!holder || holder.sessionId===MY_SID){ await _takeLock(); return; }
  _pendingHolder=holder; _showBusy(holder); _subscribeLock();
}
async function _takeLock(){
  if(_iAmHolder) return;
  try{ await lockDoc().set({ holder:{email:currentUser.email,name:currentUser.name,sessionId:MY_SID}, since:_now(), request:null, kick:null }, {merge:false}); }catch(e){}
  _iAmHolder=true; _ovHide(); _subscribeLock(); initApp();
}
function _showBusy(holder){
  const same = holder.email && currentUser && holder.email.toLowerCase()===currentUser.email.toLowerCase();
  const who = holder.name || holder.email || '다른 사용자';
  _ov(`<div style="${_ttl}">${LOCK_LABEL} 접속 중</div>
    <div style="${_txt}">${ same ? '다른 창 또는 기기에서 이미 접속해 있어요.' : `지금 <b>${who}</b>님이 접속 중이에요.` } 데이터 보호를 위해 한 번에 한 곳에서만 사용할 수 있어요.</div>
    <button onclick="sessionRequest()" style="${_btnDark}">저장 후 종료 요청 보내기</button>
    <button onclick="sessionLeave()" style="${_btnGray}">나가기</button>`);
}
async function sessionRequest(){
  try{ await lockDoc().set({ request:{ by:{email:currentUser.email,name:currentUser.name,sessionId:MY_SID}, at:Date.now() } }, {merge:true}); }catch(e){}
  const h=_pendingHolder||{};
  _ov(`<div style="${_ttl}">종료 요청을 보냈어요</div>
    <div style="${_txt}"><b>${h.name||'상대방'}</b>님에게 저장 후 종료를 요청했어요. 상대가 나가면 자동으로 접속됩니다.<br><br>응답이 없으면 <b>강제 종료</b>할 수 있어요. 이 경우 상대가 저장하지 않은 변경은 사라질 수 있어요.</div>
    <button onclick="sessionForce()" style="${_btnRed}">강제 종료하고 접속</button>
    <button onclick="sessionLeave()" style="${_btnGray}">취소</button>`);
}
async function sessionForce(){
  const h=_pendingHolder||{};
  try{ await lockDoc().set({ holder:{email:currentUser.email,name:currentUser.name,sessionId:MY_SID}, since:_now(), request:null, kick:h.sessionId||null }, {merge:false}); }catch(e){}
  _iAmHolder=true; _ovHide(); _subscribeLock(); initApp();
}
async function sessionLeave(){ try{ await lockDoc().set({request:null},{merge:true}); }catch(e){} doLogout(); _ovHide(); }

/* 명시적 나가기(✕): 저장 + 락 해제 + 로그아웃 */
function exitApp(){
  const sheet=document.getElementById('sheet');
  if(sheet){
    sheet.innerHTML=`<h3>${LOCK_LABEL} 종료</h3>
      <div class="cap">저장하고 나갑니다. 다른 기기에서 바로 접속할 수 있게 접속자도 해제돼요.</div>
      <div class="sheet-btns"><button class="btn start" onclick="doExitApp()">저장하고 나가기</button>
        <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
    document.getElementById('scrim').classList.add('show');
  } else if(confirm(`${LOCK_LABEL}을 종료할까요? 저장하고 나갑니다.`)){ doExitApp(); }
}
async function doExitApp(){
  try{ writeNow(); }catch(e){}
  try{ await lockDoc().set({holder:null,request:null,kick:null},{merge:false}); }catch(e){}
  _iAmHolder=false;
  try{ if(typeof closeSheet==='function') closeSheet(); }catch(e){}
  doLogout();
}

function _showRequestBanner(by){
  _ov(`<div style="${_ttl}">접속 종료 요청</div>
    <div style="${_txt}"><b>${by.name||'다른 관리자'}</b>님이 접속을 요청했어요. <b>저장하고 나가주세요.</b><br><br>나가지 않으면 상대가 강제 종료할 수 있고, 그 경우 저장하지 않은 변경이 사라질 수 있어요.</div>
    <button onclick="sessionSaveExit()" style="${_btnDark}">저장하고 나가기</button>
    <button onclick="sessionDismissReq()" style="${_btnGray}">계속 사용</button>`);
}
async function sessionSaveExit(){
  try{ writeNow(); }catch(e){}
  try{ await lockDoc().set({holder:null,request:null,kick:null},{merge:false}); }catch(e){}
  _iAmHolder=false; _ovHide(); doLogout();
}
function sessionDismissReq(){ _ovHide(); }

function _onKicked(){
  if(_sessionDead) return; _sessionDead=true; _iAmHolder=false;
  if(_lockUnsub){ try{_lockUnsub();}catch(e){} _lockUnsub=null; }
  _ov(`<div style="${_ttl}">세션이 종료되었어요</div>
    <div style="${_txt}">다른 곳에서 접속해 이 세션은 종료되었어요. 저장되지 않은 변경은 사라졌을 수 있어요.</div>
    <button onclick="location.reload()" style="${_btnDark}">다시 로그인</button>`);
}
function _subscribeLock(){
  if(_lockUnsub) return;
  _lockUnsub = lockDoc().onSnapshot(snap=>{
    if(_sessionDead) return;
    const d = snap.exists ? (snap.data()||{}) : {};
    const holder = d.holder;
    if(_iAmHolder){
      if(!holder || holder.sessionId!==MY_SID){ _onKicked(); return; }
      if(d.request && d.request.by && d.request.by.sessionId!==MY_SID){ _showRequestBanner(d.request.by); }
    } else {
      if(!holder || holder.sessionId===MY_SID){ _takeLock(); }
    }
  }, e=>{});
}
/* 종료 직전 락 해제(최선노력) */
window.addEventListener('beforeunload', ()=>{ try{ if(_iAmHolder && !_sessionDead) lockDoc().set({holder:null,request:null,kick:null},{merge:false}); }catch(e){} });
