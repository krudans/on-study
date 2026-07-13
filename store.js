/* ===== 데이터 계층 (Firestore) =====
   앱 상태 전체를 단일 문서 state/app 에 저장(학생 ~20명 규모에 적합).
   로그인 권한 검증에 쓰는 admins 는 별도 컬렉션. */

function stateDoc(){ return fbDb.collection('state').doc('app'); }

let _saveTimer=null;
let _applyingRemote=false;

function saveData(){
  if(_applyingRemote) return;
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(()=>{
    try{
      stateDoc().set(JSON.parse(JSON.stringify(snapshot())))
        .catch(e=>console.warn('저장 실패', e));
    }catch(e){ console.warn('스냅샷 실패', e); }
  }, 600);
}

async function loadData(){
  try{
    const doc = await stateDoc().get();
    if(doc.exists) applyState(doc.data());
  }catch(e){ console.warn('로드 실패', e); }
  await loadAdmins();
}

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

let _subscribed=false;
function subscribeState(){
  if(_subscribed) return; _subscribed=true;
  stateDoc().onSnapshot(snap=>{
    if(!snap.exists) return;
    if(snap.metadata.hasPendingWrites) return;
    _applyingRemote=true;
    applyState(snap.data());
    _applyingRemote=false;
    const app=document.getElementById('app');
    if(app && app.style.display!=='none' && typeof refreshCurrentView==='function'){
      refreshCurrentView();
    }
  }, e=>console.warn('실시간 동기화 실패', e));
}

setInterval(()=>{ if(currentUser) saveData(); }, 2500);
window.addEventListener('beforeunload', ()=>{
  try{ if(currentUser) stateDoc().set(JSON.parse(JSON.stringify(snapshot()))); }catch(e){}
});
