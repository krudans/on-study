/* ===== 인증 (Firebase Auth · 구글 로그인 + 관리자 검증) ===== */
const googleProvider = new firebase.auth.GoogleAuthProvider();

function doLogin(){
  const err=document.getElementById('loginErr');
  if(err) err.textContent='';
  fbAuth.signInWithPopup(googleProvider).catch(e=>{
    if(e && e.code==='auth/popup-closed-by-user') return;
    if(err) err.textContent='로그인에 실패했어요. 다시 시도해주세요.';
    console.warn('로그인 실패', e);
  });
}
function doLogout(){ fbAuth.signOut(); }

fbAuth.onAuthStateChanged(async (user)=>{
  const err=document.getElementById('loginErr');
  const loginEl=document.getElementById('login');
  const appEl=document.getElementById('app');
  if(!user){
    currentUser=null;
    if(appEl) appEl.style.display='none';
    if(loginEl) loginEl.style.display='flex';
    return;
  }
  const email=(user.email||'').toLowerCase();
  try{
    const doc = await fbDb.collection('admins').doc(email).get();
    if(!doc.exists){
      if(err) err.textContent='등록되지 않은 이메일이에요. 관리자로 등록된 구글 계정으로 로그인해주세요.';
      await fbAuth.signOut();
      return;
    }
    currentUser={ email, name:(doc.data().name||user.displayName||email), owner:!!doc.data().owner };
    await loadData();
    subscribeState();
    initApp();
  }catch(e){
    if(err) err.textContent='접근 확인 중 문제가 생겼어요. 새로고침 후 다시 시도해주세요.';
    console.warn('접근 검증 실패', e);
  }
});
