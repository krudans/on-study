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
