/* ===== 데스크탑 관리자 콘솔 전용 (admin.html에서만 로드) =====
   app.js를 그대로 재사용하되, 진입/네비게이션만 관리자용으로 바꿔요.
   같은 Firestore store를 쓰므로 앱과 실시간 동기화됩니다. */

let adminView = 'manage';

function renderAdminView(view){
  adminView = view;
  document.querySelectorAll('.side-item').forEach(b=>b.classList.toggle('on', b.dataset.v===view));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  if(view==='basic' || view==='people'){
    const a=document.getElementById('v-admin'); if(a) a.classList.add('active');
    adminSection = (view==='basic' ? 'basic' : 'people');
    renderAdmin();
  } else {
    const sec=document.getElementById('v-'+view); if(sec) sec.classList.add('active');
    ({manage:renderManage, settle:renderSettle, schedule:renderSchedule,
      report:renderReport, payhist:renderPayhist, send:renderSend, guide:renderGuide,
      classmgmt:renderClassMgmt}[view] || renderManage)();
  }
}
function adminNav(view){ renderAdminView(view); window.scrollTo(0,0); }

/* app.js의 initApp 오버라이드 — 로그인 성공 후 관리자 콘솔로 진입 */
function initApp(){
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='flex';
  if(currentUser){
    const who=document.getElementById('sideWho'); if(who) who.textContent=currentUser.name;
    const mail=document.getElementById('sideMail'); if(mail) mail.textContent=currentUser.email;
  }
  adminNav('manage');
}

/* 다른 기기(앱) 변경이 실시간으로 들어오면 현재 화면 다시 그림 (오버라이드) */
function refreshCurrentView(){ renderAdminView(adminView); }
