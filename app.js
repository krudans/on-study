/* ===== 상태 (실제 데이터는 Firestore에서 로드) ===== */
const WD=['일','월','화','수','목','금','토'];
const now=new Date();
const todayIdx=now.getDay();

// 클래스 금액 (설정에서 수정 가능)
let packages={8:100000, 12:200000};

// 학생: 계약 회차(plan) + 요일/시간
const students=[];

// 현재 클래스에서 완료한 횟수 (정산하면 0으로 리셋)
let cycleDone={};

// 완료된 수업 기록 {sid,date,start,end,min}
let sessions=[];
// 정산(결제) 기록 {sid,date,plan,amount}
let payments=[];
// 상담 메모 {sid,date,text}
let notes=[];
// 결석일 sid -> [timestamp] / 보강일 sid -> [{t,time,done}]
let absentLog={};
let makeupLog={};
// 수업 취소(휴강): 정규 수업일을 미리 뺀 날 (학생별 dayKey 배열). 회차 제외 → 종료일 밀림
let skipLog={};
// 지난 차수(팩) 이력. {no,plan,done,settledDate}
let packHistory={};
// 정산 건(청구서): 클래스 완주 시 자동 생성. {id,sid,plan,amount,endDate,paid,paidDate}
let bills=[];
let billSeq=1000;
// 휴일: 원장이 추가 지정한 휴일 / 공휴일이지만 수업일로 지정 (dayKey→true)
let holidaysExtra={};
let workdaysExtra={};
// 학원 기본 정보
let academy={name:'', owner:'', phone:''};
// 알림톡 자동발송 사용 여부 (템플릿 승인·서버 배포 전엔 false = 열어주기)
let autoSend=false;                    // 알림톡 자동 발송
let autoSms=false;                     // 문자 자동 발송(알림톡 실패 시 대체 포함)
let sendKinds={start:true,end:true,absent:true,settle:true,guide:true};  // 항목별 발송 on/off
const sendOn=(kind)=> sendKinds[kind]!==false;
// 발송 문구: 종류별 문자 문구(sms) + 알림톡 템플릿 코드(code). 문자문구를 #{} 형태로 변환해 카카오 심사 신청에 사용.
const OLD_SETTLE_TPL='[{학원명}] {학생명} 학생 {회차}회 수업이 마무리되었습니다. 수업료 {금액}원 안내드립니다.';
const DEFAULT_SETTLE_TPL='안녕하세요. {보호자명}님.\n{완료안내}\n\n· 이번 회차 : {기간} ({회차}회)\n· 수업료 : {금액}원\n\n결제 안내 드립니다.\n감사합니다.\n{학원명} {원장명} 드림';
let msgTemplates={
  start:  { sms:'[{학원명}] {학생명} 학생이 {시각}에 등원했습니다.', code:'' },
  end:    { sms:'[{학원명}] {학생명} 학생이 {시각}에 하원했습니다. 오늘도 수고하셨습니다.', code:'' },
  absent: { sms:'[{학원명}] {학생명} 학생이 오늘 수업에 결석 처리되었습니다.', code:'' },
  settle: { sms:DEFAULT_SETTLE_TPL, code:'' },
  guide:  { sms:'[{학원명}] {학생명} 학생 학습 안내입니다.\n{내용}', code:'' }
};
const MSG_KINDS=[['start','등원'],['end','하원'],['absent','결석'],['settle','정산 요청'],['guide','학습 안내']];
const VAR_EXAMPLE={학원명:'온스터디', 원장명:'김원장', 학생명:'김철수', 보호자명:'김보호', 시각:'16:00',
  회차:'8', 금액:'100,000', 내용:'덧셈 연습 30문제 중 28점',
  시작일:'6.19(금)', 종료일:'7.15(수)', 기간:'6.19(금) ~ 7.15(수)',
  완료안내:'김철수 학생의 이번 회차 수업을 모두 마쳤습니다.'};
function applyVars(text, vars){ return String(text||'').replace(/\{([^}]+)\}/g,(m,k)=> vars[k]!=null?vars[k]:m); }
function toKakaoTemplate(text){ return String(text||'').replace(/\{([^}]+)\}/g,'#{$1}'); }
// 학생의 전체 차수 목록(지난 + 현재)
function allPacks(st){
  const past=packHistory[st.id]||[];
  const cur={no:past.length+1, plan:st.plan, done:doneCountOf(st), current:true};
  return [...past, cur];
}
// 카드에서 현재 보고 있는 차수 index (기본 = 현재 차수)
let packView={};
// 오늘 학습내용(학습일지) {sid,date,mood,text}
let lessons=[];
const MOODS=['집중','보통','산만','피곤','열의'];
function todayLesson(sid){return lessons.find(l=>l.sid===sid && l.date.toDateString()===now.toDateString());}

// 보호자 목록 (신규 모델 guardians[] 우선, 없으면 구 필드에서 구성)
function guardiansOf(s){
  if(Array.isArray(s.guardians)&&s.guardians.length) return s.guardians;
  return [{name:s.guardian||'', phone:s.phone||'', kakao:s.kakao!==false}];
}
/* CSS 캐시로 스타일이 옛 버전이어도 반드시 적용돼야 하는 필수 수정 (JS는 항상 최신 로드) */
(function injectCriticalCSS(){
  try{
    if(document.getElementById('os-critical')) return;
    const st=document.createElement('style'); st.id='os-critical';
    st.textContent=`
      .scrim.show{align-items:flex-end;overflow-y:auto}
      .sheet{max-height:calc(100% - 20px);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
        padding-bottom:calc(26px + env(safe-area-inset-bottom,0px))}
      .sc-grid{grid-template-columns:repeat(7,minmax(0,1fr))}
      .sc-cell{min-width:0;min-height:0;overflow:hidden}
      .cal-grid{grid-template-columns:repeat(7,minmax(0,1fr))}
      .cal-d{min-width:0}
      .cal-d.tod{outline:2px solid #E03131;outline-offset:-2px;font-weight:700}
      .cal-legend i.tod{background:transparent;box-shadow:inset 0 0 0 2px #E03131}
      .sc-wheel::-webkit-scrollbar{display:none}
    `;
    (document.head||document.documentElement).appendChild(st);
  }catch(e){}
})();

/* 수업 시간(길이): 주3회 이상=60분, 주2회 이하=90분 (학생별 변경 가능) */
const DUR_OPTS=[[60,'1시간'],[90,'1시간 30분']];
function defaultDur(days){ return (days&&days.length>=3) ? 60 : 90; }
function durOf(s){ return (s&&+s.dur) ? +s.dur : defaultDur(s?s.days:[]); }
function durLabel(m){ const f=DUR_OPTS.find(o=>o[0]===+m); return f?f[1]:(m+'분'); }
function endTimeOf(t, dur){ if(!t) return ''; const [h,mi]=String(t).split(':').map(Number);
  const d=new Date(2000,0,1,h,mi+(+dur||60));
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

// 요일별 시간 (per-day 있으면 그 값, 없으면 공통 time)
function timeFor(s,dayIdx){
  if(s.dayTimes && s.dayTimes[dayIdx]) return s.dayTimes[dayIdx];
  return s.time||'16:00';
}
// 시작일 이전 날짜인지 (시작일 null이면 항상 false=제한 없음)
// 학생의 수업 시작 기준일 (이번 회차 시작일 우선, 없으면 학원 수업 시작일)
function classStartMs(s){
  if(s.cycleStart) return dayKey(s.cycleStart);
  if(s.startDate) return dayKey(s.startDate);
  return null;
}
function beforeStart(s,ms){ const stt=classStartMs(s); return stt!=null ? dayKey(ms) < stt : false; }

// 기준(ms) 이후 첫 수업일 (기본 요일 스케줄)
function nextClassDay(s, fromMs){
  if(!s.days||!s.days.length) return null;
  const base=new Date(fromMs);
  for(let i=1;i<=60;i++){ const d=new Date(base); d.setDate(d.getDate()+i);
    if(s.days.includes(d.getDay())) return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }
  return null;
}
// 이번 회차 시작일: 수동값 → 직전 정산 다음 수업일 → 학생 시작일
// 날짜를 그날 00:00 ms로
function dayKey(ms){ const d=new Date(ms); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }
// 이번 클래스의 '현재 회차'(오늘까지 진행된 수업 수) — 모든 화면이 이 함수 하나만 사용
/* 회차 = 실제 등원(등하원·완료를 누른 것) 기준. 등원을 안 눌렀으면 회차로 치지 않음.
   cycleDone = 이번 클래스에서 등원한 횟수(학생 등록 시 입력한 '현재 회차'가 시작값). */
function doneCountOf(s){ if(!s) return 0; return Math.max(0, cycleDone[s.id]||0); }
/* 오늘 이 학생이 등원 기록이 있는지 (세션 기록 기준) */
function hasRecordOn(sid, k){ return sessions.some(x=>x.sid===sid && dayKey(x.date)===k); }

// 고정 공휴일 (양력·날짜 고정). 음력 명절(설·추석·석가탄신일)은 원장이 직접 휴일 지정.
const FIXED_HOLIDAYS={'1-1':'신정','3-1':'삼일절','5-5':'어린이날','6-6':'현충일','8-15':'광복절','10-3':'개천절','10-9':'한글날','12-25':'크리스마스'};
function fixedHolidayName(ms){ const d=new Date(ms); return FIXED_HOLIDAYS[(d.getMonth()+1)+'-'+d.getDate()]||null; }
function isDefaultHoliday(k){ const d=new Date(k); const dow=d.getDay(); return dow===0||dow===6||!!fixedHolidayName(k); }
function isHoliday(ms){ const k=dayKey(ms); if(workdaysExtra[k]) return false; if(holidaysExtra[k]) return true; return isDefaultHoliday(k); }
function toggleHoliday(ms){
  const k=dayKey(ms);
  if(isHoliday(k)){ delete holidaysExtra[k]; if(isDefaultHoliday(k)) workdaysExtra[k]=true; }
  else { delete workdaysExtra[k]; holidaysExtra[k]=true; }
  saveData();
}

// 이번 클래스(현재 회차 묶음) 정보: 시작·종료·세션/결석/보강 날짜
// 규칙: 출석(정규수업)+보강 = 회차로 카운트, 결석은 카운트 제외(그만큼 밀림)
function currentClassInfo(s){
  const plan=s.plan||0;
  const info={start:null, end:null, sessions:[], absents:[], makeups:[], skips:[], missed:[], windowDates:new Set()};
  if(!plan || !s.days || !s.days.length) return info;
  const absentSet=new Set((absentLog[s.id]||[]).map(dayKey));
  const makeupSet=new Set((makeupLog[s.id]||[]).map(mk=>dayKey(mk.t)));
  const skipSet=new Set((skipLog[s.id]||[]).map(dayKey));
  const done=Math.min(cycleDone[s.id]||0, plan);
  const todayK=dayKey(now.getTime());
  const isSession=(d)=>{ const k=dayKey(d.getTime());
    if(makeupSet.has(k)) return true;
    if(s.days.includes(d.getDay()) && !absentSet.has(k) && !isHoliday(k) && !skipSet.has(k)) return true;
    return false; };
  // 1) 이번 클래스 시작일: 수동값 우선, 없으면 오늘 기준 완료 회차만큼 뒤로 세기
  let start=null;
  if(s.cycleStart){ start=dayKey(s.cycleStart); }
  else if(done<=0){
    // 첫 수업일 = 오늘 포함 이후 첫 실제 세션(결석·휴일은 건너뜀). 결석 기록은 유지되나 이번 회차엔 미포함
    for(let i=0;i<400;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()+i); if(isSession(dd)){ start=dayKey(dd.getTime()); break; } }
  } else {
    const found=[];
    for(let i=0;i<800 && found.length<done;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()-i); if(isSession(dd)) found.push(dayKey(dd.getTime())); }
    start = found.length ? found[found.length-1] : todayK;
  }
  if(start==null) start=todayK;
  info.start=start;
  const cutoff = seedUntil || 0;   // 이 날짜 이전 수업일은 '확정'으로 인정
  // 2) 시작부터 앞으로 plan개 세션 수집 (결석·휴강은 표시만, 카운트 제외 → 밀림)
  let count=0;
  for(let i=0;i<800 && count<plan;i++){
    const dd=new Date(start); dd.setDate(dd.getDate()+i);
    const k=dayKey(dd.getTime());
    if(s.days.includes(dd.getDay()) && !makeupSet.has(k)){
      if(absentSet.has(k)){ info.absents.push(k); info.windowDates.add(k); continue; }
      if(skipSet.has(k)){ info.skips.push(k); info.windowDates.add(k); continue; }
    }
    if(isSession(dd)){
      // 지난 수업일인데 등원 기록이 없으면(버튼 미입력) 회차로 세지 않고 종료일이 뒤로 밀림
      if(k < todayK && !hasRecordOn(s.id,k)){
        if(k < cutoff){ /* 확정 기준일 이전 = 이미 확정된 과거 수업 */ }
        else { info.missed.push(k); info.windowDates.add(k); continue; }   // 등원 미입력 → 회차 아님(종료일 밀림)
      }
      info.sessions.push(k);
      if(makeupSet.has(k)) info.makeups.push(k);
      info.windowDates.add(k);
      count++; if(count===plan) info.end=k;
    }
  }
  return info;
}
// 이번 회차 시작일: 수동값 → 이번 클래스 계산
function cycleStartOf(s){
  if(s.cycleStart) return s.cycleStart;
  return currentClassInfo(s).start;
}
// 이번 회차 종료일: 수동값 → 이번 클래스 8회째 날(결석 밀림·보강 반영)
function cycleEndOf(s){
  if(s.cycleEnd) return s.cycleEnd;
  return currentClassInfo(s).end;
}
function fmtD(ms){ return ms? new Date(ms).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}) : '—'; }

// 학년 (정렬·표시용)
const GRADES=[['pre','초등 이전'],['g1','초1'],['g2','초2'],['g3','초3'],['g4','초4'],['g5','초5'],['g6','초6'],['post','초등 이후']];
function gradeLabel(v){ const f=GRADES.find(g=>g[0]===v); return f?f[1]:''; }
function gradeOrder(v){ const i=GRADES.findIndex(g=>g[0]===v); return i<0?99:i; }
let manageSort='name';  // name(가나다) | day(요일별) | grade(학년별)
function setManageSort(m){ manageSort=m; renderManage(); }
let mngDayFilter=null;   // 요일별 탭: null=전체, 1~5=월~금
let mngQuery='';         // 학생 관리(관리자) 검색어
let stuQuery='';         // 학생 탭(앱) 검색어
function setStuQuery(v){ stuQuery=v; renderStudentsList(); }
function clearStuQuery(){ stuQuery=''; const el=document.getElementById('stuSearch'); if(el){ el.value=''; el.focus(); } renderStudentsList(); }
function setMngQuery(v){ mngQuery=v; renderManageList(); }
function clearMngQuery(){ mngQuery=''; const el=document.getElementById('mngSearch'); if(el){ el.value=''; el.focus(); } renderManageList(); }
function matchStu(s, q0){
  const inApp = !document.getElementById('v-manage') || document.getElementById('v-manage').style.display==='none';
  const q=((q0!=null?q0:(_activeQuery()))||'').trim().toLowerCase(); if(!q) return true;
  const hay=[s.name, s.school||'', gradeLabel(s.grade||''), s.phone||'',
    ...guardiansOf(s).map(g=>`${g.name||''} ${g.phone||''}`)].join(' ').toLowerCase();
  return hay.includes(q);
}
/* 지금 보고 있는 화면의 검색어 */
function _activeQuery(){
  const st_=document.getElementById('v-students');
  if(st_ && st_.style.display!=='none' && document.getElementById('stuSearch')) return stuQuery;
  return mngQuery;
}
function setMngDay(v){ mngDayFilter=v; renderManage(); }

let live={};         // sid -> 등원 시작 epoch(ms) — 저장/복원 대상
let ticker=null;
let logbook=[];      // 오늘 보낸 알림 {sid,kind,text,time}
const nowHM=()=>new Date().toTimeString().slice(0,5);
function logAdd(sid,kind,text){logbook.unshift({sid,kind,text,time:nowHM(),d:dayKey(Date.now())}); saveData();
  if(document.getElementById('v-home').classList.contains('active'))renderHome();}

/* ===== 유틸 ===== */
const won=(n)=>n.toLocaleString('ko-KR')+'원';
const hm=(d)=>new Date(d).toTimeString().slice(0,5);
const fmtDur=(min)=>{const h=Math.floor(min/60),m=Math.round(min%60);
  return h?(m?`${h}시간 ${m}분`:`${h}시간`):`${m}분`;};
const priceOf=(st)=>packages[st.plan]||0;
const remainOf=(st)=>Math.max(0, st.plan-doneCountOf(st));
const needSettle=(st)=>doneCountOf(st)>=st.plan;
const doneToday=(sid)=>sessions.find(s=>s.sid===sid && s.date.toDateString()===now.toDateString());
function monthCount(sid){return sessions.filter(s=>s.sid===sid &&
  s.date.getMonth()===now.getMonth() && s.date.getFullYear()===now.getFullYear()).length;}
const st=(id)=>students.find(s=>s.id===id);

let tempToday=new Set();   // [폐기 예정] 옛 데이터 이전용
let tempDay=null;
/* 보강 = makeupLog 하나로 관리 (예전 '임시 추가'와 동일한 개념) */
function makeupOn(sid, k){ return (makeupLog[sid]||[]).find(x=>dayKey(x.t)===dayKey(k)) || null; }
function isMakeupDay(s, k){ return !!makeupOn(s.id, k); }
let seedUntil=null;      // 이 날짜 이전의 지난 수업일은 '확정'으로 인정(과거 기록 일괄 확정 시점)
let tempTimes={};        // 오늘만 추가한 학생의 시각·수업시간 {id:{time:'15:00',dur:60}}
/* 오늘 이 학생의 시각 (임시 추가 > 보강 > 요일표) — 단일 소스 */
function todayTimeOf(s, k){
  const kk = k || dayKey(now.getTime());
  const mk=makeupOn(s.id, kk);
  if(mk && mk.time) return mk.time;
  return timeFor(s, new Date(kk).getDay()) || s.time || '';
}
/* 오늘 이 학생의 수업 시간(분) (임시 추가 > 보강 > 학생 설정) */
function todayDurOf(s, k){
  const kk = k || dayKey(now.getTime());
  const mk=makeupOn(s.id, kk);
  if(mk && mk.dur) return +mk.dur;
  return durOf(s);
}
let absentToday=new Set();   // (호환용) markAbsent/clearAbsent에서 갱신
// 오늘 결석 여부 = 영구 기록(absentLog) 기준. 새로고침·다른 기기에서도 일치
function isAbsentToday(sid){ const t=dayKey(now.getTime()); return (absentLog[sid]||[]).some(x=>dayKey(x)===t); }
const isTodayStudent=(x)=> isClassDay(x, dayKey(now.getTime())) && !beforeStart(x, dayKey(now.getTime()));
const todayRoster=()=>students.filter(isTodayStudent).sort((a,b)=>a.time.localeCompare(b.time));

// 학생의 지난 출석일(요일표 기준, 오늘 이전) — 달력 표시용
function pastAttendDates(sid){
  return sessions.filter(s=>s.sid===sid).map(s=>new Date(s.date.getFullYear(),s.date.getMonth(),s.date.getDate()).getTime());
}
// 앞으로 4주간 예정일 (요일표 기준, 오늘 이후)
function upcomingDates(st){
  const out=[]; const base=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(let i=1;i<=28;i++){const d=new Date(base);d.setDate(d.getDate()+i);
    if(st.days.includes(d.getDay())) out.push(d.getTime());}
  return out;
}

/* 홈 화면 기준 날짜 (기본 오늘, ‹ › 로 이동) */
let homeDate=null;
function homeBaseMs(){ return homeDate ? homeDate.getTime() : dayKey(now.getTime()); }
function homeNav(d){ const b=new Date(homeBaseMs()); b.setDate(b.getDate()+d); homeDate=new Date(b.getFullYear(),b.getMonth(),b.getDate()); renderHome(); }
function homeToday(){ homeDate=null; renderHome(); }

/* 출석부 기준 날짜 (기본 오늘, ‹ › 로 이동) */
let attnDate=null;
function attnBaseMs(){ return attnDate ? attnDate.getTime() : dayKey(now.getTime()); }
function attnNav(d){ const b=new Date(attnBaseMs()); b.setDate(b.getDate()+d); attnDate=new Date(b.getFullYear(),b.getMonth(),b.getDate()); renderToday(); }
function attnToday(){ attnDate=null; renderToday(); }

/* ===== 홈 ===== */
function renderHome(){
  normalizeBills();
  const el=document.getElementById('v-home');
  const hMs=homeBaseMs(); const hDate=new Date(hMs);
  const isToday=hDate.toDateString()===now.toDateString();
  const roster = isToday ? todayRoster() : studentsOnDate(hMs);
  const absentN = roster.filter(x=>(absentLog[x.id]||[]).some(t=>dayKey(t)===hMs)).length;
  const total = roster.length - absentN;
  const liveN = isToday ? Object.keys(live).length : 0;
  const doneN = isToday
    ? roster.filter(x=>doneToday(x.id)&&live[x.id]==null).length
    : roster.filter(x=>sessions.some(s=>s.sid===x.id && dayKey(s.date)===hMs)).length;
  const remain = Math.max(0, total-doneN-liveN);
  // 출석체크 버튼용 = 항상 오늘 기준
  const tR=todayRoster(); const tAbs=tR.filter(x=>isAbsentToday(x.id)).length;
  const tTotal=tR.length-tAbs; const tDone=tR.filter(x=>doneToday(x.id)&&live[x.id]==null).length;
  const todayRemain=Math.max(0, tTotal-tDone-Object.keys(live).length);
  const monthDone=students.reduce((a,x)=>a+monthCount(x.id),0);
  const needList=students.filter(needSettle);
  const unpaidBills=bills.filter(b=>!b.paid);
  const openList=Object.keys(live).map(id=>st(+id));

  const pct=total?doneN/total:0, C=2*Math.PI*42, off=C*(1-pct);
  const ringColor=(total&&doneN===total)?'var(--green)':'var(--amber)';
  const ringLabel = isToday ? '완료' : '예정';

  let todos=[];
  openList.forEach(x=>todos.push({ic:'amber',tx:`${x.name} 수업 진행 중 — 끝나면 종료를 눌러주세요`,v:'today'}));
  unpaidBills.forEach(b=>{ const bs=st(b.sid); todos.push({ic:'clay',tx:`${bs?bs.name:'학생'} ${billMonthTxt(b)} 정산 필요 (${won(b.amount)})`,v:'settle'}); });

  const navBtn='width:30px;height:30px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  el.innerHTML=`
    <div class="greet"><div class="hi">안녕하세요, 원장님</div>
      <div class="dt" style="display:flex;align-items:center;gap:9px;margin-top:2px">
        <button onclick="homeNav(-1)" aria-label="전날" style="${navBtn}">‹</button>
        <span style="min-width:150px;text-align:center;font-weight:600">${hDate.getMonth()+1}월 ${hDate.getDate()}일 ${WD[hDate.getDay()]}요일${isToday?' · 오늘':''}</span>
        <button onclick="homeNav(1)" aria-label="다음날" style="${navBtn}">›</button>
        ${isToday?'':`<button onclick="homeToday()" style="border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;padding:0 11px;height:30px;cursor:pointer;font-family:inherit">오늘</button>`}
      </div></div>
    <div class="hero">
      <div class="ring">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="42" fill="none" stroke="#EAE8E1" stroke-width="8"/>
          <circle cx="48" cy="48" r="42" fill="none" stroke="${ringColor}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg>
        <div class="center"><div class="n">${doneN}</div><div class="l">/ ${total} ${ringLabel}</div></div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><span class="k">${isToday?'오늘':'그날'} 총 수업</span><span class="v">${roster.length}명</span></div>
        <div class="hstat"><span class="k">${isToday?'오늘 남은 수업':'예정'}</span><span class="v">${remain}명${liveN?` · <span class="live">${liveN} 진행</span>`:''}</span></div>
        <div class="hstat"><span class="k">정산 필요</span><span class="v ${unpaidBills.length?'warn':''}">${unpaidBills.length}건</span></div>
      </div>
    </div>
    <div class="actions">
      <button class="act primary" onclick="goTab('today')"><div class="t">출석체크</div><div class="d">오늘 ${todayRemain}명 남음</div></button>
      <button class="act" onclick="goTab('settle')"><div class="t">정산</div><div class="d">회차·수업료 정리</div></button>
    </div>
    <div class="actions" style="margin-top:-12px">
      <button class="act" onclick="goTab('counsel')"><div class="t">학부모 상담</div><div class="d">상담 메모·카톡</div></button>
      <button class="act" onclick="goTab('schedule')"><div class="t">전체 일정</div><div class="d">날짜별 수업 예정</div></button>
    </div>
    <div class="block">
      <div class="block-h"><span class="h">챙길 일</span>${todos.length?`<span class="cnt">${todos.length}</span>`:''}</div>
      ${todos.length?`<div class="todo">`+todos.map(t=>`
        <button class="todo-item" onclick="goTab('${t.v}')"><span class="ic ${t.ic}"></span>
          <span class="tx">${t.tx}</span><span class="go">›</span></button>`).join('')+`</div>`
       :`<div class="muted-card">지금은 챙길 일이 없어요.</div>`}
    </div>
    <div class="block">
      <div class="block-h"><span class="h">오늘 보낸 알림</span></div>
      ${logbook.length?`<div class="log">`+logbook.map(l=>{
        const lb={start:'등원',end:'하원',absent:'결석',pay:'납입'}[l.kind]||'알림';
        return `<div class="log-item"><span class="badge ${l.kind}">${lb}</span>
          <span class="tx">${l.text}</span><span class="tm">${l.time}</span></div>`;}).join('')+`</div>`
       :`<div class="muted-card">아직 오늘 보낸 알림이 없어요.</div>`}
    </div>`;
}

/* ===== 출석부 ===== */
function progBar(s){
  const list=allPacks(s);
  let vi=packView[s.id]; if(vi==null||vi>list.length-1)vi=list.length-1;
  const p=list[vi];
  const tabs=list.map((pk,i)=>`<button class="pk-tab ${i===vi?'on':''}" onclick="setPackView(${s.id},${i})">${pk.current?'현재':pk.no+'차'}</button>`).join('');
  let cells='';
  for(let i=0;i<p.plan;i++)cells+=`<i class="${i<p.done?'on':''}"></i>`;
  let status;
  if(p.current) status = needSettle(s)?`<span class="need">정산 필요</span>`:`<b>${p.done}</b>/${p.plan}회 · ${remainOf(s)}회 남음`;
  else status = `<b>${p.done}</b>/${p.plan}회 · 정산 ${p.settledDate.getMonth()+1}.${p.settledDate.getDate()}`;
  return `<div class="prog">
    <div class="pk-tabs">${tabs}</div>
    <div class="pack-box ${p.current?'cur':''}">
      <div class="lbl"><span>${p.no}차 · ${p.plan}회 계약</span><span>${status}</span></div>
      <div class="bar">${cells}</div>
    </div></div>`;
}
function setPackView(id,i){packView[id]=i;renderToday();}
function renderToday(){
  const el=document.getElementById('v-today');
  const aMs=attnBaseMs(); const aDate=new Date(aMs); const dowA=aDate.getDay();
  const isToday = aDate.toDateString()===now.toDateString();
  const list=(isToday ? todayRoster() : studentsOnDate(aMs)).slice()
    .sort((a,b)=>(timeFor(a,dowA)||a.time||'').localeCompare(timeFor(b,dowA)||b.time||''));
  // 날짜 이동
  const navBtn='width:30px;height:30px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  const dateNav=`<div style="display:flex;align-items:center;gap:9px;margin:2px 0 12px">
    <button onclick="attnNav(-1)" aria-label="전날" style="${navBtn}">‹</button>
    <span style="flex:1;text-align:center;font-weight:600;font-size:15px">${aDate.getMonth()+1}월 ${aDate.getDate()}일 ${WD[dowA]}요일${isToday?' · 오늘':''}</span>
    <button onclick="attnNav(1)" aria-label="다음날" style="${navBtn}">›</button>
    ${isToday?'':`<button onclick="attnToday()" style="border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;padding:0 11px;height:30px;cursor:pointer;font-family:inherit">오늘</button>`}
  </div>`;
  // 상단 요약 (그날 기준)
  const isAbsentOn=(sid)=>(absentLog[sid]||[]).some(x=>dayKey(x)===aMs);
  const doneOn=(sid)=>sessions.find(x=>x.sid===sid && dayKey(x.date)===aMs);
  const total=list.length;
  const absentN=list.filter(s=>isToday?isAbsentToday(s.id):isAbsentOn(s.id)).length;
  const attendN=list.filter(s=>isToday ? (live[s.id]!=null||doneToday(s.id)) : !!doneOn(s.id)).length;
  const summary=`<div class="attn-sum">
    <div class="as-item"><div class="as-v num">${total}</div><div class="as-k">${isToday?'오늘 총원':'총원'}</div></div>
    <div class="as-item"><div class="as-v num" style="color:var(--green)">${attendN}</div><div class="as-k">등원</div></div>
    <div class="as-item"><div class="as-v num" style="color:var(--clay)">${absentN}</div><div class="as-k">결석</div></div>
  </div>`;

  const cardOf=(s)=>{
    if(!isToday){
      // 다른 날 = 그날 출결 확인 + 확정 처리
      const done=doneOn(s.id), abs=isAbsentOn(s.id);
      const isPast = aMs < dayKey(now.getTime());
      let stx, sc, btns='';
      if(abs){ stx='결석'; sc='var(--clay)';
        btns=`<button class="btn ghost small" onclick="clearAbsentFrom(${s.id},${aMs})">결석 취소</button>`; }
      else if(done){ stx = done.start ? `하원 완료 · ${hm(done.start)}~${hm(done.end)}` : '수업 완료'; sc='var(--green)';
        btns=`<button class="btn ghost small" onclick="undoOn(${s.id},${aMs})">완료 취소</button>`; }
      else if(isPast){ stx = `미확정 · 예정 ${timeFor(s,dowA)||s.time||''}`; sc='var(--amber)';
        btns=`<button class="btn start small" onclick="openSendConfirm(${s.id},'both',${aMs})">수업함 확정</button>
              <button class="btn absentbtn small" onclick="markAbsentOn(${s.id},${aMs})">결석</button>`; }
      else { stx = `예정 ${timeFor(s,dowA)||s.time||''}`; sc='var(--muted)'; }
      return `<div class="card" style="${abs?'border:1.6px solid var(--clay)':(!done&&isPast?'border:1.6px solid var(--amber)':'')}">
        <div class="card-top"><div class="who">
          <div class="name">${s.name}</div>
          <div class="plan" style="color:${sc}">${stx}</div>
        </div></div>
        ${btns?`<div class="row-btns" style="margin-top:8px">${btns}</div>`:''}
      </div>`;
    }
    const isLive=live[s.id]!=null;
    const isMk=isMakeupDay(s, aMs);   // 보강일 (예전 '오늘만 추가'와 동일)
    const isAbsent=isAbsentToday(s.id);
    const done=doneToday(s.id);
    const shownDay=doneCountOf(s);
    const expanded=cardExpanded.has(s.id);

    // 헤더 상태 텍스트/색
    let statusText, statusColor;
    const tBtn=(txt)=>`<button onclick="event.stopPropagation();openTimeEdit(${s.id})" title="시간 수정" style="background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;border-bottom:1px dashed currentColor">${txt}</button>`;
    if(done){ statusText = done.start ? `하원 완료 · ${tBtn(hm(done.start)+'~'+hm(done.end))}` : `하원 완료 · ${tBtn('시간 입력')}`; statusColor='var(--green)'; }
    else if(isLive){ statusText = `수업 중 · 등원 ${tBtn(hm(live[s.id]))}`; statusColor='var(--amber)'; }
    else if(isAbsent){ statusText = '결석 처리됨'; statusColor='var(--clay)'; }
    else { const tt=todayTimeOf(s,aMs);           // 임시 추가 > 보강 > 요일표 (그룹 헤더와 동일)
      const dd=todayDurOf(s,aMs);
      const rng=tt?`${tt}~${endTimeOf(tt,dd)}`:'';
      statusText = `${isMk?'보강 '+rng:'예정 '+rng} · ${shownDay}/${s.plan}회`; statusColor='var(--muted)'; }

    // 액션 버튼 (등원↔하원 토글 + 결석 + 완료)
    let action;
    if(done){
      action=`<button class="btn ghost" onclick="undoToday(${s.id})">오늘 완료 취소</button>`;
    } else if(isAbsent){
      action=`<button class="btn ghost" onclick="clearAbsent(${s.id})">결석 취소</button>`;
    } else {
      const first = isLive
        ? `<button class="btn stop" onclick="stopSession(${s.id})">하원</button>`
        : `<button class="btn start" onclick="startSession(${s.id})">등원</button>`;
      action=`<div class="attn-btns">
        ${first}
        <button class="btn absentbtn" onclick="markAbsent(${s.id})">결석</button>
        <button class="btn ghost" onclick="openSendConfirm(${s.id},'both')">완료</button>
      </div>`;
    }

    // 전체보기 상세 (자세히 ▾ 펼침 시에만)
    const detail = expanded ? `
      <div class="cal-slot" id="cal-${s.id}"></div>
      ${(()=>{const ls=todayLesson(s.id);
        return ls
        ? `<button class="lesson filled" onclick="openLessonSheet(${s.id})">
             <div class="ls-top"><span class="ls-label">오늘 학습내용</span>
               ${ls.mood?`<span class="ls-mood">${ls.mood}</span>`:''}</div>
             <div class="ls-tx">${ls.text}</div></button>`
        : `<button class="lesson empty" onclick="openLessonSheet(${s.id})">
             <span class="ls-plus">＋</span> 오늘 학습내용 작성</button>`;})()}
      ${progBar(s)}
      <div class="clock ${isLive?'show':''}"><span class="dot"></span>
        <span class="time num" data-clock="${s.id}">00:00:00</span>
        <span class="since">${isLive?'등원 '+new Date(live[s.id]).toTimeString().slice(0,5):''}</span></div>
      <div class="row-btns" style="margin-top:8px">
        <button class="btn ghost small" onclick="toggleCal(${s.id})">달력 보기</button>
        ${(isMk&&isToday)?`<button class="btn ghost small" onclick="askRemoveMakeup(${s.id},${aMs})">보강 빼기</button>`:''}
      </div>
      <div class="resend">
        <button onclick="resend(${s.id},'start')">↩ 등원 알림</button><span class="sep">·</span>
        <button onclick="resend(${s.id},'end')">↩ 하원 알림</button>
      </div>` : '';

    const cardStyle = done ? 'opacity:.55;border-color:var(--line)'
      : isLive ? 'border:1.6px solid var(--amber);box-shadow:0 2px 8px rgba(30,25,15,.07)'
      : (!isAbsent) ? 'border:1.6px solid var(--ink);box-shadow:0 2px 8px rgba(30,25,15,.07)'
      : '';
    const toggleBtn=`<button onclick="toggleCardExpand(${s.id})" style="background:#F1EFE8;border:none;border-radius:20px;padding:5px 12px;font-size:12px;color:#5F5E5A;cursor:pointer;font-family:inherit;white-space:nowrap;font-weight:600">${expanded?'접기 ▲':'자세히 ▾'}</button>`;

    return `<div class="card" style="${cardStyle}">
      <div class="card-top">
        <div class="who">
          <div class="name">${s.name}${isMk?' <span style="font-size:11px;font-weight:700;color:#fff;background:#6B4FBB;border-radius:6px;padding:2px 7px;vertical-align:middle">보강</span>':''}</div>
          <div class="plan" style="color:${statusColor}">${statusText}</div>
        </div>
        ${(isMk&&isToday)?`<button onclick="askRemoveMakeup(${s.id},${aMs})" title="보강 빼기" style="background:#FBEAEA;border:none;border-radius:20px;padding:5px 11px;font-size:12px;color:#A32D2D;cursor:pointer;font-family:inherit;white-space:nowrap;font-weight:600;margin-right:6px">✕ 빼기</button>`:''}
        ${toggleBtn}
      </div>
      ${detail}
      ${action}
    </div>`;
  };
  // 1시간 단위로 묶어 시간대 헤더(주황 알약) + 학생 카드
  const hourOf=(s)=>{ const t=(isToday? todayTimeOf(s,aMs) : (timeFor(s,dowA)||s.time||'')); return t?t.slice(0,2)+':00':'시간 미정'; };
  let cards='', _lastHour=null;
  list.forEach(s=>{
    const hour=hourOf(s);
    if(hour!==_lastHour){
      _lastHour=hour;
      const cnt=list.filter(x=>hourOf(x)===hour).length;
      cards+=`<div style="margin:14px 2px 10px"><span style="display:inline-flex;align-items:center;gap:6px;background:var(--amber);border-radius:20px;padding:6px 14px">
        <span style="font-size:15px;font-weight:600;color:#fff">🕐 ${hour} ~</span>
        <span style="font-size:12px;color:#FAEEDA">${cnt}명</span></span></div>`;
    }
    cards+=cardOf(s);
  });
  const empty=list.length?'':`<div class="empty">이 날은 예정된 학생이 없어요. 아래에서 보강을 넣을 수 있어요.</div>`;
  const cand=students.filter(x=>!list.some(y=>y.id===x.id));      // 그 날 명단에 없는 학생
  const added=students.filter(x=>makeupOn(x.id, aMs));            // 그 날 보강인 학생 (단일 소스)
  const addedBox = added.length ? `<div style="margin-bottom:10px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${isToday?'오늘':fmtMD(aMs)} 보강</div>
      ${added.map(x=>{ const ti=makeupOn(x.id, aMs)||{};
        return `<div style="display:flex;justify-content:space-between;align-items:center;background:#FAEEDA;border-radius:9px;padding:8px 10px;margin-bottom:6px">
          <span style="font-size:13px;color:#633806"><b>${x.name}</b> · ${ti.time||'-'}${ti.time?'~'+endTimeOf(ti.time, ti.dur||durOf(x)):''} · ${durLabel(ti.dur||durOf(x))}</span>
          <button onclick="askRemoveMakeup(${x.id},${aMs})" style="border:none;background:#fff;border-radius:7px;padding:4px 9px;font-size:12px;color:#A32D2D;cursor:pointer;font-family:inherit;font-weight:600">✕ 빼기</button>
        </div>`; }).join('')}
    </div>` : '';
  const addBox=`<div class="add-wrap"><div class="add-title">${isToday?'오늘':fmtMD(aMs)} 보강 추가</div>
    <div class="add-desc">이 날 하루만 오는 학생을 골라 넣어요. 시각·수업 시간을 정합니다. 정규 요일표는 그대로고, <b>회차·예상 종료일에는 반영</b>돼요.</div>
    ${addedBox}
    ${cand.length?`<div class="chips">`+cand.map(x=>`<button class="chip" onclick="addTemp(${x.id},${aMs})">＋ ${x.name}</button>`).join('')+`</div>`
      :`<div class="add-desc" style="margin:0">추가할 수 있는 다른 학생이 없어요.</div>`}</div>`;
  el.innerHTML=dateNav+summary+empty+cards+addBox;   // 어느 날짜든 보강 추가 가능
  updateLiveCount();
}
let openCal=null, calCur=null, payHistOpen=false;
// 출석부 카드: 펼친(전체보기) 학생 id
let cardExpanded=new Set();
function toggleCardExpand(id){ if(cardExpanded.has(id))cardExpanded.delete(id); else cardExpanded.add(id); renderToday(); }
function toggleCal(id){
  const slot=document.getElementById('cal-'+id);
  if(openCal===id){ slot.innerHTML=''; openCal=null; return; }
  if(openCal!=null){const p=document.getElementById('cal-'+openCal); if(p)p.innerHTML='';}
  openCal=id; calCur={y:now.getFullYear(),m:now.getMonth()}; payHistOpen=false;
  slot.innerHTML=buildCalendar(st(id));
}
function calNav(id,delta){ calCur.m+=delta;
  if(calCur.m<0){calCur.m=11;calCur.y--;} if(calCur.m>11){calCur.m=0;calCur.y++;}
  document.getElementById('cal-'+id).innerHTML=buildCalendar(st(id)); }
function togglePayHist(id){ payHistOpen=!payHistOpen;
  document.getElementById('cal-'+id).innerHTML=buildCalendar(st(id)); }

/* 기간이 걸친 달 목록 */
function monthsBetween(startMs, endMs){
  const out=[]; if(!startMs) return out;
  const a=new Date(startMs), b=new Date(endMs||startMs);
  let y=a.getFullYear(), m=a.getMonth();
  for(let i=0;i<12;i++){
    out.push({y,m});
    if(y===b.getFullYear() && m===b.getMonth()) break;
    m++; if(m>11){ m=0; y++; }
  }
  return out;
}
/* 한 달 달력 격자 (색칠 규칙 공용) */
function monthGrid(sid, y, m, sets, opts){
  const o=opts||{};
  const todayT=dayKey(now.getTime());
  const first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate();
  let grid='';
  ['일','월','화','수','목','금','토'].forEach(w=>grid+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++) grid+='<div></div>';
  for(let dd=1;dd<=days;dd++){
    const t=new Date(y,m,dd).getTime();
    let c='cal-d', style='';
    if(sets.skip.has(t)){ style+='background:#EDEDED;color:#B0ADA6;text-decoration:line-through;'; }
    else if(sets.makeup.has(t)){ style+='background:#EAE3F7;color:#6B4FBB;font-weight:700;'; }
    else if(sets.absent.has(t)) c+=' absent';
    else if(sets.session.has(t)) c+=(t<=todayT?' att':' up');
    if(t===todayT) c+=' tod';       // 오늘은 어떤 상태든 빨간 테두리
    const clickable = !o.readonly && document.body.dataset.mode==='admin' && t>=todayT;
    if(clickable) style+='cursor:pointer;';
    grid+=`<div class="${c}" style="${style}" ${clickable?`onclick="calDayClick(${sid},${t})"`:''}>${dd}</div>`;
  }
  return `<div class="cal-nav" style="justify-content:center"><span>${y}년 ${m+1}월</span></div>
    <div class="cal-grid">${grid}</div>`;
}
function buildCalendar(s, cal, prevClick, nextClick){
  cal = cal || calCur;
  const info=currentClassInfo(s);
  const sessionSet=new Set(info.sessions);
  const absentSet=new Set(info.absents);
  const makeupSet=new Set(info.makeups);
  const skipSet=new Set(info.skips);
  const todayT=dayKey(now.getTime());
  const sets={session:sessionSet, absent:absentSet, makeup:makeupSet, skip:skipSet};
  // 이번 회차가 걸친 달을 모두 표시 (예: 7.9~8.6 → 7월 + 8월)
  const ms=monthsBetween(info.start||new Date(cal.y,cal.m,1).getTime(), info.end||info.start);
  const grids = (ms.length?ms:[{y:cal.y,m:cal.m}]).map(x=>monthGrid(s.id, x.y, x.m, sets)).join('<div style="height:10px"></div>');

  // 지난 정산 (직전 1건 + 전체 이력)
  const pays=payments.filter(p=>p.sid===s.id).sort((a,b)=>b.date-a.date);
  let payLine;
  if(pays.length){
    const last=pays[0];
    payLine=`<div class="cf-row"><span class="cf-k">지난 정산</span>
      <span class="cf-v">${last.date.getMonth()+1}.${last.date.getDate()} · ${last.plan}회 ${won(last.amount)}
      ${pays.length>1?`<button class="cf-more" onclick="togglePayHist(${s.id})">전체 ${payHistOpen?'▲':'▾'}</button>`:''}</span></div>`;
    if(payHistOpen && pays.length>1){
      payLine+=`<div class="cf-hist">`+pays.map(p=>`<div>${p.date.getFullYear()}.${p.date.getMonth()+1}.${p.date.getDate()} · ${p.plan}회 ${won(p.amount)}</div>`).join('')+`</div>`;
    }
  } else {
    payLine=`<div class="cf-row"><span class="cf-k">지난 정산</span><span class="cf-v muted">아직 없음</span></div>`;
  }

  // 보강일
  const mks=(makeupLog[s.id]||[]).slice().sort((a,b)=>a.t-b.t);
  // 보강일: 목록 + 각각 빼기 + 등록 버튼 (앱·관리자 공통)
  const mkList = mks.length ? mks.slice().sort((a,b)=>a.t-b.t).map(mk=>{
      const d=new Date(mk.t);
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#EAE3F7;border-radius:8px;padding:6px 9px;margin-top:5px">
        <span style="font-size:12.5px;color:#4A3690"><b>${d.getMonth()+1}.${d.getDate()}(${WD[d.getDay()]})</b>
          ${mk.time?` ${mk.time}~${endTimeOf(mk.time, mk.dur||durOf(s))}`:''} · ${durLabel(mk.dur||durOf(s))}${mk.done?' ✓ 완료':''}</span>
        <button onclick="askRemoveMakeup(${s.id},${mk.t})" style="border:none;background:#fff;border-radius:6px;padding:3px 8px;font-size:11.5px;color:#A32D2D;cursor:pointer;font-family:inherit;font-weight:600">✕ 빼기</button>
      </div>`; }).join('')
    : `<div style="font-size:12.5px;color:var(--muted);margin-top:4px">없음</div>`;
  const mkLine=`<div class="cf-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="cf-k">보강일</span>
        <button class="cf-more" onclick="openMakeupSheet(${s.id})">＋ 보강 등록</button>
      </div>
      ${mkList}
    </div>`;

  // 이번 회차 요약(시작~종료)
  const rangeLine=`<div class="cf-row"><span class="cf-k">이번 회차</span>
    <span class="cf-v">${fmtD(info.start)} ~ ${fmtD(info.end)} · ${doneCountOf(s)}/${s.plan}회</span></div>`;

  return `<div class="cal">
    ${grids}
    <div class="cal-legend"><span><i class="lg att"></i>출석</span><span><i class="lg up"></i>예정</span>
      <span><i class="lg" style="background:#EAE3F7"></i>보강</span><span><i class="lg" style="background:#EDEDED"></i>휴강</span>
      <span><i class="lg ab"></i>결석</span><span><i class="lg tod"></i>오늘</span></div>
    <div class="cal-foot">${rangeLine}${payLine}${mkLine}</div>
  </div>`;
}
function openLessonSheet(id){
  const s=st(id); const ls=todayLesson(id);
  const chips=MOODS.map(m=>`<button type="button" class="mood-chip ${ls&&ls.mood===m?'on':''}" data-m="${m}" onclick="pickMood(this)">${m}</button>`).join('');
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} · 오늘 학습내용</h3>
    <div class="cap">오늘 아이의 수업·태도·주의사항을 간단히 남겨요. 알림장에 쌓여요.</div>
    <div class="mood-row" id="moodRow"><span class="mood-k">태도</span>${chips}</div>
    <textarea id="lessonText" class="note-area" placeholder="예: 분수 나눗셈 완료. 응용문제 어려워함. 다음 시간 지난 프린트 챙겨오기.">${ls?ls.text:''}</textarea>
    <div class="sheet-btns"><button class="btn start" onclick="saveLesson(${id})">저장</button>
      ${ls?`<button class="btn sms" onclick="deleteLesson(${id})">삭제</button>`:`<button class="btn sms" onclick="closeSheet()">취소</button>`}</div>`;
  sheet.dataset.mood = ls&&ls.mood?ls.mood:'';
  document.getElementById('scrim').classList.add('show');
}
function pickMood(btn){
  const sel=btn.dataset.m; const cur=document.getElementById('sheet').dataset.mood;
  document.querySelectorAll('#moodRow .mood-chip').forEach(c=>c.classList.remove('on'));
  if(cur===sel){document.getElementById('sheet').dataset.mood='';}
  else{btn.classList.add('on');document.getElementById('sheet').dataset.mood=sel;}
}
function saveLesson(id){
  const text=document.getElementById('lessonText').value.trim();
  const mood=document.getElementById('sheet').dataset.mood||'';
  if(!text&&!mood){showToast('학습내용을 적거나 태도를 골라주세요');return;}
  const ex=todayLesson(id);
  if(ex){ex.text=text;ex.mood=mood;}
  else lessons.push({sid:id,date:new Date(),mood,text});
  saveData(); closeSheet(); renderToday();
  showToast(`${st(id).name} 오늘 학습내용 저장됨`);
}
function deleteLesson(id){
  const i=lessons.findIndex(l=>l.sid===id && l.date.toDateString()===now.toDateString());
  if(i>=0)lessons.splice(i,1);
  saveData(); closeSheet(); renderToday(); showToast('오늘 학습내용을 삭제했어요');
}

// 열려있는 달력 갱신 (출석부/학생탭/학생관리 어디서든)
function refreshOpenCal(sid){
  if(typeof openCal!=='undefined' && openCal===sid){ const slot=document.getElementById('cal-'+sid); if(slot) slot.innerHTML=buildCalendar(st(sid)); }
  if(typeof stuCal!=='undefined' && stuCal.open===sid) renderStudents();
  if(typeof mngCal!=='undefined' && mngCal.open===sid) renderManage();
  if(typeof schedCal!=='undefined' && schedCal.open===sid) renderSchedule();
}
// 달력에서 오늘 이후 날짜 클릭 → 상태별 동작
function calDayClick(sid, ms){
  const s=st(sid), k=dayKey(ms);
  if(k < dayKey(now.getTime())){ showToast('지난 날짜는 변경할 수 없어요'); return; }
  const isMk = (makeupLog[sid]||[]).some(mk=>dayKey(mk.t)===k);
  const isSkip = (skipLog[sid]||[]).some(t=>dayKey(t)===k);
  const isRegular = s.days.includes(new Date(k).getDay()) && !isHoliday(k);
  const d=new Date(ms), dstr=`${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  const sheet=document.getElementById('sheet');
  if(isMk){
    sheet.innerHTML=`<h3>${s.name} · ${dstr}</h3>
      <div class="cap">이 날은 <b>보강일</b>이에요. 보강을 취소하면 회차에서 빠지고 종료일이 다시 계산돼요.</div>
      <div class="sheet-btns"><button class="btn pay" onclick="cancelMakeup(${sid},${ms})">보강 취소</button>
        <button class="btn sms" onclick="closeSheet()">닫기</button></div>`;
  } else if(isSkip){
    sheet.innerHTML=`<h3>${s.name} · ${dstr}</h3>
      <div class="cap">이 날은 <b>수업 취소(휴강)</b> 상태예요. 다시 수업일로 되돌릴까요?</div>
      <div class="sheet-btns"><button class="btn start" onclick="unskipDay(${sid},${ms})">수업 취소 해제</button>
        <button class="btn sms" onclick="closeSheet()">닫기</button></div>`;
  } else if(isRegular){
    sheet.innerHTML=`<h3>${s.name} · ${dstr}</h3>
      <div class="cap">이 날은 <b>정규 수업일</b>이에요. 이 날 수업을 취소(휴강)할까요? 회차에서 빠지고 종료일이 밀립니다.</div>
      <div class="sheet-btns"><button class="btn pay" onclick="skipDay(${sid},${ms})">이 날 수업 취소</button>
        <button class="btn sms" onclick="closeSheet()">닫기</button></div>`;
  } else {
    sheet.innerHTML=`<h3>${s.name} 보강일 지정</h3>
      <div class="cap">${dstr}을 보강일로 설정할까요?<br>보강은 회차에 포함돼 종료일이 다시 계산돼요.</div>
      <div class="fld"><label>보강 시간</label><input type="time" id="mkTime2" class="note-select" value="${s.time||'16:00'}"></div>
      <div class="sheet-btns"><button class="btn start" onclick="confirmMakeup(${sid},${ms})">예, 보강 지정</button>
        <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  }
  document.getElementById('scrim').classList.add('show');
}
function confirmMakeup(sid, ms){
  const tm=(document.getElementById('mkTime2')||{}).value||'';
  const k=dayKey(ms);
  const arr=(makeupLog[sid]=makeupLog[sid]||[]);
  if(arr.some(mk=>dayKey(mk.t)===k)){ showToast('이미 보강일로 지정된 날이에요'); closeSheet(); return; }
  arr.push({t:k, time:tm, done:false});
  saveData(); closeSheet(); refreshOpenCal(sid);
  const d=new Date(ms);
  showToast(`${st(sid).name} 보강 ${d.getMonth()+1}.${d.getDate()}${tm?' '+tm:''} 지정됨 · 종료일 재계산`);
}
function cancelMakeup(sid, ms){
  const k=dayKey(ms);
  if(makeupLog[sid]) makeupLog[sid]=makeupLog[sid].filter(mk=>dayKey(mk.t)!==k);
  saveData(); closeSheet(); refreshOpenCal(sid);
  showToast(`${st(sid).name} 보강 취소됨 · 종료일 재계산`);
}
function skipDay(sid, ms){
  const k=dayKey(ms);
  const arr=(skipLog[sid]=skipLog[sid]||[]);
  if(!arr.some(t=>dayKey(t)===k)) arr.push(k);
  saveData(); closeSheet(); refreshOpenCal(sid);
  const d=new Date(ms);
  showToast(`${st(sid).name} ${d.getMonth()+1}.${d.getDate()} 수업 취소(휴강) · 종료일 밀림`);
}
function unskipDay(sid, ms){
  const k=dayKey(ms);
  if(skipLog[sid]) skipLog[sid]=skipLog[sid].filter(t=>dayKey(t)!==k);
  saveData(); closeSheet(); refreshOpenCal(sid);
  showToast(`${st(sid).name} 수업 취소 해제 · 다시 수업일`);
}
function openMakeupSheet(id){
  const s=st(id);
  const sheet=document.getElementById('sheet');
  const dcur=durOf(s);
  sheet.innerHTML=`<h3>${s.name} 보강일 지정</h3>
    <div class="cap">보강 날짜·시작 시각과 수업 시간을 정하세요. <b>회차·예상 종료일에 자동 반영</b>되고 달력에 보라색으로 표시돼요.</div>
    <div class="fld"><label>날짜</label><input type="date" id="mkDate" class="note-select" value="${new Date(dayKey(now.getTime())).toISOString().slice(0,10)}"></div>
    <div class="fld"><label>시작 시각</label><input type="time" id="mkTime" class="note-select" value="${timeFor(s, new Date().getDay())||s.time||'16:00'}"></div>
    <div class="fld"><label>수업 시간</label>
      <div class="seg2" id="mkDurRow">
        ${DUR_OPTS.map(([m,label])=>`<button type="button" class="${dcur===m?'on':''}" data-dur="${m}" onclick="pickMkDur(${m})">${label}</button>`).join('')}
      </div></div>
    <div class="sheet-btns"><button class="btn start" onclick="saveMakeup(${id})">추가</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  sheet.dataset.mkDur=String(dcur);
  document.getElementById('scrim').classList.add('show');
}
function pickMkDur(m){
  const sheet=document.getElementById('sheet'); sheet.dataset.mkDur=String(m);
  document.querySelectorAll('#mkDurRow button').forEach(b=>b.classList.toggle('on', +b.dataset.dur===+m));
}
function saveMakeup(id){
  const v=document.getElementById('mkDate').value;
  const tm=document.getElementById('mkTime').value;
  if(!v){showToast('날짜를 골라주세요');return;}
  const d=new Date(v+'T00:00:00');
  const mkDur = +document.getElementById('sheet').dataset.mkDur || durOf(st(id));
  const k=dayKey(d.getTime());
  const mks=(makeupLog[id]=makeupLog[id]||[]);
  const ex=mks.find(x=>dayKey(x.t)===k);
  if(ex){ ex.time=tm||ex.time; ex.dur=mkDur; }        // 같은 날 다시 등록하면 수정
  else mks.push({t:k, time:tm||'', dur:mkDur, done:false});
  saveData(); closeSheet(); refreshCurrentView();      // 목록·달력·회차·종료일 모두 갱신
  showToast(`${st(id).name} 보강 ${d.getMonth()+1}.${d.getDate()}${tm?' '+tm:''} · ${durLabel(mkDur)} 저장됨`);
}
function markAbsent(id){ absentToday.add(id);
  const t=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  (absentLog[id]=absentLog[id]||[]); if(!absentLog[id].includes(t))absentLog[id].push(t);
  saveData(); renderToday();
  const s=st(id); showToast(`${s.name} 결석 처리 (회차 차감 없음)`, ()=>openNotify(id,'absent'), s.kakao?'결석 알림':'문자'); }
function clearAbsent(id){ absentToday.delete(id);
  const t=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  if(absentLog[id])absentLog[id]=absentLog[id].filter(x=>x!==t);
  saveData(); renderToday(); }
/* 지난 날 결석 처리 */
function markAbsentOn(id, dayMs){
  const k=dayKey(dayMs);
  (absentLog[id]=absentLog[id]||[]); if(!absentLog[id].includes(k)) absentLog[id].push(k);
  saveData(); refreshCurrentView();
  showToast(`${st(id).name} ${new Date(k).getMonth()+1}.${new Date(k).getDate()} 결석 처리`);
}
/* 지난 날 완료 취소 */
function undoOn(id, dayMs){
  const k=dayKey(dayMs); const s=st(id);
  const i=sessions.findIndex(x=>x.sid===id && dayKey(x.date)===k);
  if(i>=0){ sessions.splice(i,1); cycleDone[id]=Math.max(0,(cycleDone[id]||0)-1); }
  saveData(); refreshCurrentView();
  showToast(`${s.name} ${new Date(k).getMonth()+1}.${new Date(k).getDate()} 기록을 취소했어요`);
}
function clearAbsentFrom(sid, dayMs){
  const k=dayKey(dayMs);
  if(absentLog[sid]) absentLog[sid]=absentLog[sid].filter(x=>dayKey(x)!==k);
  if(dayKey(now.getTime())===k) absentToday.delete(sid);
  saveData(); renderSchedule();
  showToast(`${st(sid).name} 결석 취소`);
}
/* 오늘만 추가 — 시작 시각·수업 시간을 정해서 넣기 */
function openTempSheet(id, dateMs){
  const s=st(id);
  const k=dayKey(dateMs||now.getTime());
  const dow=new Date(k).getDay();
  const defT = timeFor(s,dow) || s.time || '16:00';     // 그 날 요일 기준 기본 시각
  const defD = durOf(s);
  const sheet=document.getElementById('sheet');
  sheet.dataset.tpDate=String(k);
  sheet.innerHTML=`<h3>${s.name} ${dayKey(now.getTime())===k?'오늘':fmtMD(k)} 보강</h3>
    <div class="cap"><b>${fmtMD(k)}</b> 하루만 오는 수업이에요. <b>시작 시각과 수업 시간</b>을 정해주세요. 정규 요일표는 그대로고, <b>회차·예상 종료일에 반영</b>됩니다.</div>
    <div class="fld"><label>시작 시각</label>
      <input type="time" id="tpTime" class="note-select" value="${defT}"></div>
    <div class="fld"><label>수업 시간</label>
      <div class="seg2" id="tpDurRow">
        ${DUR_OPTS.map(([m,label])=>`<button type="button" class="${defD===m?'on':''}" data-dur="${m}" onclick="pickTpDur(${m})">${label}</button>`).join('')}
      </div></div>
    <div class="sheet-btns">
      <button class="btn start" onclick="saveTemp(${id})">보강 추가</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  sheet.dataset.tpDur=String(defD);
  document.getElementById('scrim').classList.add('show');
}
function pickTpDur(m){
  const sheet=document.getElementById('sheet'); sheet.dataset.tpDur=String(m);
  document.querySelectorAll('#tpDurRow button').forEach(b=>b.classList.toggle('on', +b.dataset.dur===+m));
}
function saveTemp(id){
  const sheet=document.getElementById('sheet');
  const t=(document.getElementById('tpTime')||{}).value||'';
  if(!t){ showToast('시작 시각을 정해주세요'); return; }
  const dur=+sheet.dataset.tpDur || durOf(st(id));
  const k=+sheet.dataset.tpDate || dayKey(now.getTime());     // 보고 있던 날짜
  const mks=(makeupLog[id]=makeupLog[id]||[]);                // 보강 = 단일 소스
  const ex=mks.find(x=>dayKey(x.t)===k);
  if(ex){ ex.time=t; ex.dur=dur; } else mks.push({t:k, time:t, dur, done:false});
  saveData(); closeSheet(); refreshCurrentView();     // 출석부·전체 일정 등 현재 화면 갱신
  showToast(`${st(id).name} ${fmtMD(k)} 보강 ${t}~${endTimeOf(t,dur)} 추가됨`);
}
function addTemp(id, dateMs){ openTempSheet(id, dateMs); }
/* 보강 빼기 — 출결 기록이 있으면 함께 지울지 확인 */
function removeMakeup(id, dayMs){
  const k=dayKey(dayMs);
  if(makeupLog[id]) makeupLog[id]=makeupLog[id].filter(x=>dayKey(x.t)!==k);
  saveData(); refreshCurrentView();
}
function askRemoveMakeup(id, dayMs){
  const s=st(id), k=dayKey(dayMs);
  const hasRec = live[id]!=null || sessions.some(x=>x.sid===id && dayKey(x.date)===k)
    || (absentLog[id]||[]).some(t=>dayKey(t)===k);
  if(!hasRec){ removeMakeup(id,k); showToast(`${s.name} 보강을 뺐어요`); return; }
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 보강 빼기</h3>
    <div class="cap">이 날 <b>출결 기록(등원·하원·결석)</b>이 있어요. 함께 지우고 뺄까요?<br>회차도 원래대로 되돌아갑니다.</div>
    <div class="sheet-btns">
      <button class="btn pay" onclick="doRemoveMakeup(${id},${k},true)">기록까지 지우고 빼기</button>
      <button class="btn ghost" onclick="doRemoveMakeup(${id},${k},false)">기록은 두고 빼기</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function doRemoveMakeup(id, dayMs, wipe){
  const s=st(id), k=dayKey(dayMs);
  if(wipe){
    if(live[id]!=null) delete live[id];
    if(sessions.some(x=>x.sid===id && dayKey(x.date)===k)) undoOn(id,k);
    if((absentLog[id]||[]).some(t=>dayKey(t)===k)) clearAbsentFrom(id,k);
  }
  removeMakeup(id,k); closeSheet();
  showToast(`${s.name} 보강을 뺐어요${wipe?' (기록 삭제)':''}`);
}

/* 완료 처리(1회 차감). start/end 있으면 시각·소요시간 함께 기록 */
/* 수업 분(min) 계산 — 단일 소스. 시각을 바꾸는 곳은 반드시 이 함수만 사용 */
function minsBetween(start, end){ return (start&&end) ? Math.max(1, Math.round((end-start)/60000)) : null; }
/* 세션 기록의 시각을 설정/수정 — 모든 참조값(수업 분)이 함께 갱신됨 */
function setSessionTimes(rec, start, end){
  if(!rec) return rec;
  if(start) rec.start=start;
  if(end) rec.end=end;
  rec.min = minsBetween(rec.start, rec.end);
  return rec;
}
function complete(id, start, end){
  const rec={sid:id, date: start ? new Date(start) : new Date()};   // 지난 날 확정 시 그 날짜로 기록
  if(start&&end) setSessionTimes(rec, start, end);
  sessions.push(rec); cycleDone[id]=(cycleDone[id]||0)+1;
  saveData();
}
function undoToday(id){
  const s=st(id);
  const i=sessions.findIndex(x=>x.sid===id && x.date.toDateString()===now.toDateString());
  if(i>=0){
    sessions.splice(i,1);
    if((cycleDone[id]||0)>0){ cycleDone[id]=Math.max(0,(cycleDone[id]||0)-1); }
    else {
      // 방금 완주로 롤오버됐다면 되돌리기: 오늘 생긴 미납 정산건 + 마지막 이력 제거, 회차 복원
      const bi=bills.findIndex(b=>b.sid===id && !b.paid && dayKey(b.endDate)===dayKey(now.getTime()));
      if(bi>=0){ bills.splice(bi,1); const h=packHistory[id]; if(h&&h.length)h.pop(); cycleDone[id]=Math.max(0,(s.plan||1)-1); }
    }
  }
  saveData(); renderToday();
  showToast(`${s.name} 오늘 완료를 취소했어요 (1회 되돌림)`);
}
function manualComplete(id){
  complete(id); const s=st(id);
  showToast(`${s.name} 완료로 체크됨 · ${doneCountOf(s)}/${s.plan}회 (알림 없음)`);
  rolloverIfComplete(id); renderToday();
}

function startSession(id){ openSendConfirm(id,'start'); }
function stopSession(id){ openSendConfirm(id,'end'); }
function resend(id,kind){ openNotify(id,kind); }
/* 실제 발송: 문자는 sms:로 문자앱이 내용 채워 열림, 카톡은 (특정 대화방 자동입력 불가라)
   메시지를 복사한 뒤 카톡 앱을 열어 붙여넣기. 데스크탑에선 문자앱이 없어 열리지 않을 수 있어요(모바일 앱에서 사용). */
let _notifyCtx=null;
/* 알림톡 서버 발송 (Functions). 실패/미배포면 {ok:false} 반환 → 앱이 열어주기로 폴백 */
async function serverSend(to, kind, text, opt){
  try{
    if(!fbFunctions) return {ok:false, channel:'no-server'};
    const o=opt||{alimtalk:autoSend, sms:autoSms};
    const call=fbFunctions.httpsCallable('sendNotify');
    const r=await call({to, kind, text,
      useAlimtalk: !!o.alimtalk,          // 알림톡 발송 여부
      useSms: !!o.sms,                    // 문자 발송 여부
      fallbackSms: !!(o.alimtalk && o.sms) // 알림톡 실패 시 문자 대체
    });
    return r.data || {ok:false};
  }catch(e){ return {ok:false, channel:'error', message:String(e)}; }
}
/* 자동발송: 보호자 전원에게 알림톡. 하나라도 실패하면 열어주기로 폴백 */
async function autoSendAll(sid, kind, text, gs){
  const s=st(sid);
  const chan = autoSend ? (autoSms?'알림톡':'알림톡') : '문자';
  showToast(`${s.name} ${chan} 발송 중…`);
  let fail=0;
  for(const g of gs){
    const r=await serverSend(g.phone, kind, text, {alimtalk:autoSend, sms:autoSms});
    if(!r||!r.ok) fail++;
  }
  if(fail===0){ showToast(`${s.name} 보호자에게 ${chan} 발송 완료${(autoSend&&autoSms)?' (실패 시 문자 대체)':''}`); return; }
  showToast('자동 발송이 안 돼 메시지 열기로 전환합니다');
  _notifyCtx={gs, text}; openMsgTo(0);
}
function buildNotifyText(s,kind){
  const t=new Date().toTimeString().slice(0,5);
  const vars={학원명:academy.name||'', 학생명:s.name, 시각:t,
    회차:String(s.plan), 금액:won(priceOf(s)).replace(/원$/,''), 내용:''};
  const tpl=(msgTemplates[kind]&&msgTemplates[kind].sms)||'';
  const out=applyVars(tpl, vars).trim();
  if(out) return out;
  // 문구 미설정 시 기본 문구
  const word=kind==='start'?'등원했습니다':kind==='absent'?'결석 처리되었습니다':'하원했습니다';
  return `[On-study] ${s.name} 학생이 ${t}에 ${word}.`;
}
// 외부 앱(sms/카톡) 열기: 페이지를 벗어나지 않도록 링크 클릭 방식
function _openExternal(url){
  try{ const a=document.createElement('a'); a.href=url; a.style.display='none'; a.rel='noopener';
    document.body.appendChild(a); a.click(); setTimeout(()=>{ try{a.remove();}catch(e){} }, 1500); }
  catch(e){ try{ location.href=url; }catch(_){ } }
}
function openMsgTo(i){
  const g=_notifyCtx.gs[i], text=_notifyCtx.text;
  const digits=(g.phone||'').replace(/[^0-9]/g,'');
  if(g.kakao){
    if(navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
    showToast(`${g.name} 카톡: 메시지를 복사했어요 · 카톡에서 붙여넣기 하세요`);
    setTimeout(()=>{ _openExternal('kakaotalk://'); }, 400);
  } else {
    if(!digits){ showToast(`${g.name} 연락처가 없어 문자를 열 수 없어요`); return; }
    const sep = /iphone|ipad|ipod|mac/i.test(navigator.userAgent) ? '&' : '?';
    _openExternal(`sms:${digits}${sep}body=${encodeURIComponent(text)}`);
  }
}
function openNotify(id,kind){
  const s=st(id);
  const word=kind==='start'?'등원':kind==='absent'?'결석':'하원';
  const gs=guardiansOf(s);
  const text=buildNotifyText(s,kind);
  if(!sendOn(kind)){ logAdd(id,kind==='absent'?'absent':kind,`${s.name} ${word} 기록 (알림 꺼짐)`); return; }
  gs.forEach(g=>logAdd(id,kind==='absent'?'absent':kind,`${s.name} ${word} → ${g.name}(${g.kakao?'카톡':'문자'})`));
  if((autoSend||autoSms) && fbFunctions){ autoSendAll(id, kind, text, gs); return; }
  _notifyCtx={gs,text};
  if(gs.length===1){ openMsgTo(0); return; }
  // 보호자 2명 이상 → 각각 열기 선택
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} ${word} 알림</h3>
    <div class="cap">보호자별로 열어요. 카톡은 복사 후 붙여넣기, 문자는 자동으로 작성됩니다.</div>
    <div class="msg">${text}</div>
    ${gs.map((g,i)=>`<button class="btn ${g.kakao?'kakao':'sms'}" style="margin-bottom:8px" onclick="openMsgTo(${i})">${g.name} · ${g.kakao?'카톡 복사 + 열기':'문자 열기'}</button>`).join('')}
    <div class="sheet-btns"><button class="btn ghost" onclick="closeSheet()">닫기</button></div>`;
  document.getElementById('scrim').classList.add('show');
}

function ensureTicker(){ if(ticker)return;
  ticker=setInterval(()=>{for(const id in live){
    document.querySelectorAll(`[data-clock="${id}"]`).forEach(n=>{
      let ms=Date.now()-live[id],s=Math.floor(ms/1000),h=Math.floor(s/3600);s-=h*3600;
      let m=Math.floor(s/60);s-=m*60;
      n.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;});
  }},1000);
}
function updateLiveCount(){const n=Object.keys(live).length;const lc=document.getElementById('liveCount');
  lc.textContent=n?`● ${n}명 수업 중`:'';lc.classList.toggle('on',n>0);}

/* ===== 학생 ===== */
let stuCal={open:null,y:0,m:0}, mngCal={open:null,y:0,m:0}, schedCal={open:null,y:0,m:0};
function toggleSchedCal(id){ if(schedCal.open===id)schedCal.open=null; else {schedCal.open=id;schedCal.y=now.getFullYear();schedCal.m=now.getMonth();} renderSchedule(); }
function schedCalNav(id,delta){ schedCal.m+=delta; if(schedCal.m<0){schedCal.m=11;schedCal.y--;} if(schedCal.m>11){schedCal.m=0;schedCal.y++;} renderSchedule(); }
function toggleStuCal(id){ if(stuCal.open===id)stuCal.open=null; else {stuCal.open=id;stuCal.y=now.getFullYear();stuCal.m=now.getMonth();} renderStudents(); }
function stuCalNav(id,delta){ stuCal.m+=delta; if(stuCal.m<0){stuCal.m=11;stuCal.y--;} if(stuCal.m>11){stuCal.m=0;stuCal.y++;} renderStudents(); }
function toggleMngCal(id){ if(mngCal.open===id)mngCal.open=null; else {mngCal.open=id;mngCal.y=now.getFullYear();mngCal.m=now.getMonth();} renderManage(); }
// 전체 일정 등에서 학생 클릭 → 학생 관리로 이동 + 그 학생 달력 펼침 + 스크롤
function openStudentCalendar(sid){
  mngCal.open=sid; mngCal.y=now.getFullYear(); mngCal.m=now.getMonth();
  manageSort='name';   // 이름순으로(카드 1개만 보이게)
  if(document.body.dataset.mode==='admin' && typeof adminNav==='function') adminNav('manage');
  else goTab('manage');
  setTimeout(()=>{ const el=document.getElementById('mng-'+sid); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }, 80);
}
function mngCalNav(id,delta){ mngCal.m+=delta; if(mngCal.m<0){mngCal.m=11;mngCal.y--;} if(mngCal.m>11){mngCal.m=0;mngCal.y++;} renderManage(); }
function schedText(s){
  if(!s.days||!s.days.length) return '요일 미설정';
  return (s.dayTimes&&Object.keys(s.dayTimes).length)
    ? s.days.slice().sort((a,b)=>a-b).map(d=>`${WD[d]} ${timeFor(s,d)}`).join(' / ')
    : `${s.days.slice().sort((a,b)=>a-b).map(d=>WD[d]).join('·')} · ${s.time||'-'}`;
}
let studentSort='name';
function setStudentSort(m){ studentSort=m; renderStudents(); }
let stuDayFilter=null;
function setStuDay(v){ stuDayFilter=v; renderStudents(); }
function studentCard(s, forDay){
  const ci=currentClassInfo(s);
  const doneN=doneCountOf(s);
  const need=needSettle(s);
  const eduTxt=[s.grade?gradeLabel(s.grade):'', s.school||''].filter(Boolean).join(' · ');
  const dayTime=(forDay!=null)?`⏰ ${WD[forDay]} ${timeFor(s,forDay)}`:'';
  const infoLine = (eduTxt||dayTime) ? `<div class="mg-line">${[eduTxt?'🎓 '+eduTxt:'', dayTime].filter(Boolean).join(' · ')}</div>` : '';
  const schedLine = `<div class="mg-line">📅 정기 수업일 ${schedText(s)} · <b>${durLabel(durOf(s))}</b></div>`;
  const rangeLine = `<div class="mg-line">🔄 이번 클래스 ${ci.start?fmtD(ci.start):'-'} ~ ${ci.end?fmtD(ci.end):'-'} (예상 종료)
    <button class="btn ghost small" style="width:auto;padding:3px 8px;font-size:11px;margin-left:6px;display:inline-block" onclick="askConfirmCurrent(${s.id})">회차 확정</button></div>`;
  const pastHtml = pastClassesHtml(s);
  const calBtn = `<button class="btn ghost small" style="margin-top:10px;width:auto;padding:8px 14px" onclick="toggleStuCal(${s.id})">${stuCal.open===s.id?'달력 닫기 ▲':'달력 보기 ▾'}</button>`;
  const calHtml = stuCal.open===s.id ? buildCalendar(s, stuCal, `stuCalNav(${s.id},-1)`, `stuCalNav(${s.id},1)`) : '';
  return `<div class="row">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${infoLine}${schedLine}${rangeLine}
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="k">이번 클래스</div><div class="v">${doneN}/${s.plan}회</div></div>
      <div class="stat"><div class="k">남은 횟수</div><div class="v">${Math.max(0,s.plan-doneN)}회</div></div>
    </div>
    <span class="flag ${need?'need':'ok'}">${need?'정산 필요':'진행 중'}</span>
    ${pastHtml}
    ${calBtn}${calHtml}
  </div>`;
}
/* 앱 학생 탭 목록 (검색 반영) — 입력창은 다시 그리지 않아 한글 조합이 안 깨짐 */
function studentListHtml(){
  const byName=(a,b)=>a.name.localeCompare(b.name,'ko');
  const pool=students.filter(x=>matchStu(x, stuQuery));
  const grpH=(t,n)=>`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:20px 2px 9px;padding-bottom:5px;border-bottom:1px solid var(--line)">
    <span style="font-size:12.5px;font-weight:700;color:var(--ink)">${t}</span>
    ${n!=null?`<span style="font-size:12px;color:var(--muted)">${n}명</span>`:''}</div>`;
  const count=`전체 <b style="color:var(--ink)">${students.length}명</b>${stuQuery?` · 검색 결과 <b style="color:var(--amber)">${pool.length}명</b>`:''}`;

  let body='';
  if(studentSort==='name'){
    body = pool.slice().sort(byName).map(s=>studentCard(s)).join('');
  } else if(studentSort==='grade'){
    const groups={}; pool.forEach(s=>{ const k=s.grade||'none'; (groups[k]=groups[k]||[]).push(s); });
    const order=[...GRADES.map(g=>g[0]),'none'];
    body = order.filter(k=>groups[k]&&groups[k].length).map(k=>{
      const label = k==='none' ? '학년 미입력' : gradeLabel(k);
      return grpH(label, groups[k].length) + groups[k].sort(byName).map(s=>studentCard(s)).join('');
    }).join('');
  } else {
    const dayOrder=[1,2,3,4,5];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    const cntOf=(d)=>pool.filter(s=>s.days.includes(d)).length;
    const dtab=(v,label,n)=>`<button onclick="setStuDay(${v})" style="padding:8px 12px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${stuDayFilter===v?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}<span style="opacity:.7;font-weight:500"> ${n}</span></button>`;
    const tabBar=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${dtab(null,'전체',pool.length)}${dayOrder.map(d=>dtab(d,WD[d],cntOf(d))).join('')}</div>`;
    const shown=(stuDayFilter==null)?dayOrder:[stuDayFilter];
    const groups=shown.map(d=>{
      const list=pool.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일`, list.length); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=studentCard(s,d); });
      return html;
    }).join('');
    body = tabBar + (groups || '<div class="muted-card">해당 요일에 수업이 없어요.</div>');
  }
  if(!students.length) body='<div class="empty">등록된 학생이 없어요.</div>';
  else if(!pool.length) body='<div class="muted-card">검색 결과가 없어요.</div>';
  return {count, body};
}
function renderStudentsList(){
  const r=studentListHtml();
  const c=document.getElementById('stuCount'); if(c) c.innerHTML=r.count;
  const l=document.getElementById('stuList'); if(l) l.innerHTML=r.body;
  const x=document.getElementById('stuClear'); if(x) x.style.display=stuQuery?'':'none';
}
function renderStudents(){
  const el=document.getElementById('v-students');
  const r=studentListHtml();
  const sortBtn=(m,label)=>`<button onclick="setStudentSort('${m}')" style="flex:1;padding:9px 6px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${studentSort===m?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
  el.innerHTML=`<div style="position:relative;margin-bottom:10px">
      <input id="stuSearch" value="${(stuQuery||'').replace(/"/g,'&quot;')}" placeholder="🔍 이름 · 학교 · 보호자 · 전화번호 검색"
        oninput="setStuQuery(this.value)"
        style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:11px 38px 11px 12px;font-family:inherit;font-size:14px;background:#fff">
      <button id="stuClear" onclick="clearStuQuery()" style="display:${stuQuery?'':'none'};position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:#EDEBE4;border-radius:50%;width:22px;height:22px;cursor:pointer;color:var(--muted);font-size:13px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">${sortBtn('name','전체 (가나다)')}${sortBtn('day','요일별')}${sortBtn('grade','학년별')}</div>
    <div id="stuCount" style="font-size:13px;color:var(--muted);margin:0 2px 12px">${r.count}</div>
    <div id="stuList">${r.body}</div>`;
}

/* ===== 정산 ===== */
/* 그날 수업이 있는 날인가 — 명단용(결석이어도 명단에는 보임)
   보강일이면 무조건 수업, 아니면 요일표 + 휴강·휴일 제외 */
function isClassDay(s, k){
  if(!s || !s.days) return false;
  if((makeupLog[s.id]||[]).some(mk=>dayKey(mk.t)===k)) return true;   // 보강일
  const d=new Date(k);
  if(!s.days.includes(d.getDay())) return false;
  if((skipLog[s.id]||[]).some(t=>dayKey(t)===k)) return false;        // 휴강 제외
  if(isHoliday(k)) return false;                                      // 휴일 제외
  return true;
}
/* 회차로 세는 수업일인가 — 수업 있는 날 중 결석 제외 (회차 계산 단일 규칙) */
function isSessionDay(s, k){
  if(!isClassDay(s,k)) return false;
  if((absentLog[s.id]||[]).some(t=>dayKey(t)===k)) return false;      // 결석 제외
  return true;
}
/* 종료일부터 거꾸로 count회 수업일 수집 (오름차순 반환) */
function sessionDaysBack(s, endMs, count){
  const out=[], base=dayKey(endMs);
  for(let i=0;i<900 && out.length<count;i++){
    const d=new Date(base); d.setDate(d.getDate()-i); const k=dayKey(d.getTime());
    if(isSessionDay(s,k)) out.push(k);
  }
  return out.reverse();
}

/* 지난 회차(클래스) 이력 표시 상태 */
let histAllOpen=new Set(), histRowOpen=new Set(), histCalOpen=new Set();
function toggleHistCal(key){ if(histCalOpen.has(key))histCalOpen.delete(key); else histCalOpen.add(key);
  renderStudents(); if(document.getElementById('v-manage')) renderManage(); }
/* 지난 클래스 달력 — 그 기간이 걸친 달을 모두 표시, 그 회차 날짜를 출석으로 색칠 */
function histCalendar(s, h, list){
  const sets={ session:new Set(list||[]), absent:new Set((absentLog[s.id]||[]).map(dayKey).filter(k=>h.start&&h.end&&k>=h.start&&k<=h.end)),
    makeup:new Set((makeupLog[s.id]||[]).map(mk=>dayKey(mk.t)).filter(k=>h.start&&h.end&&k>=h.start&&k<=h.end)),
    skip:new Set((skipLog[s.id]||[]).map(dayKey).filter(k=>h.start&&h.end&&k>=h.start&&k<=h.end)) };
  const st_=h.start||(list&&list[0]), en=h.end||(list&&list[list.length-1]);
  const ms=monthsBetween(st_, en);
  const grids=ms.map(x=>monthGrid(s.id, x.y, x.m, sets, {readonly:true})).join('<div style="height:10px"></div>');
  return `<div class="cal" style="margin-top:8px">${grids}
    <div class="cal-legend"><span><i class="lg att"></i>수업</span><span><i class="lg" style="background:#EAE3F7"></i>보강</span>
      <span><i class="lg ab"></i>결석</span></div></div>`;
}
function toggleHistAll(sid){ if(histAllOpen.has(sid))histAllOpen.delete(sid); else histAllOpen.add(sid); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
function toggleHistRow(key){ if(histRowOpen.has(key))histRowOpen.delete(key); else histRowOpen.add(key); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
/* 지난 회차 블록 HTML (최근 3개, 나머지는 '전체 보기') */
/* ===== 회차 확정 — 프로그램이 계산한 일정을 원장님이 확인 후 고정 ===== */
/* 지난 클래스: 계산된 회차 날짜를 확정(고정)해서 다시 계산되지 않게 함 */
function askConfirmHist(sid, no){
  const s=st(sid);
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h){ showToast('기록을 찾을 수 없어요'); return; }
  const cnt=h.done||h.plan||0;
  const en=h.end||(h.settledDate?dayKey(new Date(h.settledDate).getTime()):null);
  const list=(Array.isArray(h.sessions)&&h.sessions.length>=cnt)?h.sessions:(en?sessionDaysBack(s,en,cnt):[]);
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} ${no}차 확정</h3>
    <div class="cap">프로그램이 계산한 <b>${cnt}회</b> 일정이에요. 실제와 맞으면 확정하세요.
      확정하면 이 날짜로 <b>고정</b>되고 다시 계산되지 않아요.</div>
    <div style="background:var(--bg);border-radius:10px;padding:10px 12px;max-height:230px;overflow-y:auto">
      ${list.length? list.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
        <span style="color:var(--muted)">${i+1}회차</span><span>${fmtMD(t)}</span></div>`).join('')
        : '<div style="font-size:13px;color:var(--muted)">계산된 날짜가 없어요. 학생 수정에서 시작일을 넣어주세요.</div>'}
    </div>
    <div class="cap" style="margin-top:10px">📅 ${list.length?`${fmtMD(list[0])} ~ ${fmtMD(list[list.length-1])}`:'기간 미상'}</div>
    <div class="sheet-btns" style="margin-top:12px">
      <button class="btn settle" ${list.length?'':'disabled'} onclick="confirmHist(${sid},${no})">맞아요 · 확정</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>
    <button class="btn ghost small" style="width:100%;margin-top:8px" onclick="closeSheet();goTab('manage')">날짜가 달라요 · 학생 수정에서 고치기</button>`;
  document.getElementById('scrim').classList.add('show');
}
function confirmHist(sid, no){
  const s=st(sid);
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h) return;
  const cnt=h.done||h.plan||0;
  const en=h.end||(h.settledDate?dayKey(new Date(h.settledDate).getTime()):null);
  const list=(Array.isArray(h.sessions)&&h.sessions.length>=cnt)?h.sessions:(en?sessionDaysBack(s,en,cnt):[]);
  if(!list.length){ showToast('계산된 날짜가 없어 확정할 수 없어요'); return; }
  h.sessions=list.slice(); h.start=list[0]; h.end=list[list.length-1]; h.confirmed=true;
  saveData(); closeSheet(); refreshCurrentView();
  showToast(`${s.name} ${no}차 확정 (${fmtMD(h.start)} ~ ${fmtMD(h.end)})`);
}
function unconfirmHist(sid, no){
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h) return;
  h.confirmed=false; saveData(); refreshCurrentView();
  showToast('확정을 해제했어요 (다시 계산됨)');
}

/* 이번 클래스: 계산된 지난 수업일을 실제 기록으로 확정 */
function askConfirmCurrent(sid){
  const s=st(sid);
  const info=currentClassInfo(s);
  const todayK=dayKey(now.getTime());
  const past=info.sessions.filter(k=>k<=todayK);
  const need=past.filter(k=>!hasRecordOn(sid,k));       // 아직 기록이 없는 날
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 이번 회차 확정</h3>
    <div class="cap">프로그램이 계산한 <b>오늘까지 ${past.length}회</b>예요. 맞으면 확정하세요.
      확정하면 각 날짜가 <b>수업 기록으로 저장</b>돼서 회차가 흔들리지 않아요.</div>
    <div style="background:var(--bg);border-radius:10px;padding:10px 12px;max-height:230px;overflow-y:auto">
      ${past.length? past.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
        <span style="color:var(--muted)">${i+1}회차</span>
        <span>${fmtMD(t)} ${hasRecordOn(sid,t)?'<b style="color:#2F7A4F">기록됨</b>':'<span style="color:var(--amber)">예상</span>'}</span></div>`).join('')
        : '<div style="font-size:13px;color:var(--muted)">아직 지난 수업이 없어요.</div>'}
    </div>
    <div class="cap" style="margin-top:10px">${need.length?`${need.length}일이 기록으로 저장됩니다 (예정 시각 ${durLabel(durOf(s))} 기준)`:'이미 모두 기록돼 있어요'}</div>
    <div class="sheet-btns" style="margin-top:12px">
      <button class="btn settle" ${past.length?'':'disabled'} onclick="confirmCurrent(${sid})">맞아요 · 확정</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>
    <button class="btn ghost small" style="width:100%;margin-top:8px" onclick="closeSheet();openStudentSheet(${sid})">회차가 달라요 · 현재 회차 고치기</button>`;
  document.getElementById('scrim').classList.add('show');
}
function confirmCurrent(sid){
  const s=st(sid);
  const info=currentClassInfo(s);
  const todayK=dayKey(now.getTime());
  const past=info.sessions.filter(k=>k<=todayK);
  let added=0;
  past.forEach(k=>{
    if(hasRecordOn(sid,k)) return;
    const dow=new Date(k).getDay();
    const mk=(makeupLog[sid]||[]).find(x=>dayKey(x.t)===k);
    const t=(mk&&mk.time)?mk.time:(timeFor(s,dow)||s.time||'16:00');
    const [h,m]=t.split(':').map(Number);
    const d=new Date(k); d.setHours(h,m,0,0);
    const start=d.getTime(), end=start+((mk&&mk.dur?+mk.dur:durOf(s))*60000);
    const rec={sid, date:new Date(start)};
    setSessionTimes(rec, start, end);
    sessions.push(rec); added++;
  });
  cycleDone[sid]=past.length;                 // 확정 = 계산된 회차 그대로
  if(!s.cycleStart && info.start) s.cycleStart=info.start;   // 시작일도 고정
  saveData(); closeSheet(); refreshCurrentView();
  showToast(`${s.name} 이번 회차 확정 · ${past.length}회 (${added}일 기록 추가)`);
}

function pastClassesHtml(s){
  // 1차 → 2차 순(오래된 것부터). 차수 우선, 없으면 종료일 순
  const all=(packHistory[s.id]||[]).slice().sort((a,b)=>((a.no||0)-(b.no||0)) || ((a.end||0)-(b.end||0)));
  if(!all.length) return `<div class="mg-line" style="color:var(--muted)">📚 지난 클래스 : 아직 없어요</div>`;
  const openAll=histAllOpen.has(s.id);
  const show=openAll?all:all.slice(0,3);
  const rows=show.map(h=>{
    const key=s.id+'-'+h.no;
    const cnt=h.done||h.plan||0;
    // 종료일: 저장값 → 정산일 순
    const en = h.end || (h.settledDate? dayKey(new Date(h.settledDate).getTime()) : null);
    // 회차 목록: 저장된 게 온전하면 사용, 아니면 종료일부터 거꾸로 복원(정산 건과 동일 규칙)
    let list = h.confirmed && Array.isArray(h.sessions) ? h.sessions        // 원장님이 확정한 기록 → 그대로 사용
             : (Array.isArray(h.sessions) && h.sessions.length>=cnt) ? h.sessions
             : (en ? sessionDaysBack(s, en, cnt) : []);
    // 시작일: 회차 목록의 첫날. 저장된 start가 종료일보다 뒤면(옛 데이터 오류) 무시
    let st_ = list.length ? list[0] : ((h.start && en && h.start<=en) ? h.start : null);
    const period=(st_&&en)?`${fmtMD(st_)} ~ ${fmtMD(en)}`:(en?`~ ${fmtMD(en)}`:'기간 미상');
    const open=histRowOpen.has(key);
    const calOpen=histCalOpen.has(key);
    const detail=open?`<div style="background:var(--bg);border-radius:9px;padding:9px 11px;margin-top:7px">
      ${list.length?list.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0">
          <span style="color:var(--muted)">${i+1}회차</span><span>${fmtMD(t)}</span></div>`).join('')
        :'<div style="font-size:12.5px;color:var(--muted)">회차별 날짜 기록이 없어요.</div>'}
    </div>`:'';
    const calHtml=calOpen? histCalendar(s, h, list) : '';
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:7px;background:var(--card)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-weight:600;font-size:13.5px">${h.no}차 · ${h.done||h.plan}/${h.plan}회
          ${(h.confirmed || (en && en < dayKey(now.getTime())))?'<span style="font-size:10.5px;font-weight:600;color:#2F7A4F;background:#E7F1EA;border-radius:5px;padding:1px 5px;margin-left:4px">확정</span>':'<span style="font-size:10.5px;font-weight:600;color:#854F0B;background:#FAEEDA;border-radius:5px;padding:1px 5px;margin-left:4px">예상</span>'}</span>
        <span style="font-size:12.5px;color:var(--muted)">${h.amount?won(h.amount):''}</span></div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">📅 ${period}</div>
      <div style="display:flex;gap:6px;margin-top:7px">
        <button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="toggleHistRow('${key}')">${open?'접기 ▲':'회차 보기 ▾'}</button>
        <button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="toggleHistCal('${key}')">${calOpen?'달력 닫기 ▲':'달력 보기 ▾'}</button>
        ${(h.confirmed || (en && en < dayKey(now.getTime())))
          ? `<button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="askConfirmHist(${s.id},${h.no})">날짜 수정</button>`
          : `<button class="btn settle small" style="width:auto;padding:5px 10px;font-size:12px" onclick="askConfirmHist(${s.id},${h.no})">이 기간 확정</button>`}
      </div>
      ${detail}${calHtml}</div>`;
  }).join('');
  const more = all.length>3 ? `<button class="btn ghost small" style="width:auto;padding:6px 12px;font-size:12px" onclick="toggleHistAll(${s.id})">${openAll?'접기 ▲':`전체 보기 (${all.length}개) ▾`}</button>` : '';
  return `<div style="margin-top:10px">
    <div class="mg-line" style="margin-bottom:6px">📚 <b>지난 클래스</b> (${all.length}개)</div>
    ${rows}${more}</div>`;
}

/* 정산 건 '자세히' 펼침 상태 */
let billOpen=new Set();
function toggleBill(id){ if(billOpen.has(id))billOpen.delete(id); else billOpen.add(id); renderSettle(); }
/* 정산 건의 회차 날짜 목록 (없으면 실제 출결 기록에서 복원) */
function billSessions(b){
  if(Array.isArray(b.sessions) && b.sessions.length>=(b.plan||0)) return b.sessions;
  const s=st(b.sid);
  if(s) return sessionDaysBack(s, b.endDate, b.plan||0);   // 달력에서 거꾸로 복원
  const mine = sessions.filter(x=>x.sid===b.sid && dayKey(x.date)<=b.endDate)
    .map(x=>dayKey(x.date)).sort((a,b2)=>a-b2);
  return mine.slice(-(b.plan||0));
}
const fmtMD=(ms)=>{ const d=new Date(ms); return `${d.getMonth()+1}.${d.getDate()}(${WD[d.getDay()]})`; };

/* 정산 화면 기준 월 (기본 이번 달, ‹ › 로 이동) */
let settleYM=null;
function settleBaseYM(){ return settleYM ? {y:settleYM.y, m:settleYM.m} : {y:now.getFullYear(), m:now.getMonth()}; }
function settleNav(d){ const b=settleBaseYM(); let m=b.m+d, y=b.y; if(m<0){m=11;y--;} if(m>11){m=0;y++;} settleYM={y,m}; renderSettle(); }
function settleThisMonth(){ settleYM=null; renderSettle(); }

function renderSettle(){
  normalizeBills();
  const el=document.getElementById('v-settle');
  const B=settleBaseYM(); const vY=B.y, vM=B.m;
  const isThisMonth = (vY===now.getFullYear() && vM===now.getMonth());
  const mL=(vM+1)+'월';

  const unpaid = bills.filter(b=>!b.paid).sort((a,b)=>a.endDate-b.endDate);
  const paidMonth = bills.filter(b=>b.paid && b.paidDate &&
    new Date(b.paidDate).getMonth()===vM && new Date(b.paidDate).getFullYear()===vY)
    .sort((a,b)=>b.paidDate-a.paidDate);
  const monthPaidAmt = paidMonth.reduce((a,b)=>a+b.amount,0);
  const unpaidAmt = unpaid.reduce((a,b)=>a+b.amount,0);

  const billRow=(b)=>{
    const s=st(b.sid); const nm=s?s.name:'(삭제된 학생)';
    const list=billSessions(b);
    const startMs = b.startDate || (list.length?list[0]:null);
    const period = startMs ? `${fmtMD(startMs)} ~ ${fmtMD(b.endDate)}` : `~ ${fmtMD(b.endDate)}`;
    const open = billOpen.has(b.id);
    const detail = open ? `<div style="background:var(--bg);border-radius:10px;padding:10px 12px;margin-top:9px">
        ${list.length ? list.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--ink)">
            <span style="color:var(--muted)">${i+1}회차</span><span>${fmtMD(t)}</span></div>`).join('')
          : '<div style="font-size:13px;color:var(--muted)">회차별 날짜 기록이 없어요.</div>'}
      </div>` : '';
    const head=`<div class="row-top"><span class="name">${nm}</span><span class="amt">${won(b.amount)}</span></div>
      <div class="mg-line">📅 <b>${period}</b> · ${b.plan}회 ${b.paid?`· <span style="color:var(--green);font-weight:600">받음</span>`:`· <span style="color:var(--clay);font-weight:600">아직 못 받음</span>`}</div>
      <div class="row-btns" style="margin-top:8px">
        <button class="btn ghost small" onclick="toggleBill(${b.id})">${open?'접기 ▲':'자세히 ▾'}</button>
      </div>${detail}`;
    if(!b.paid){
      return `<div class="row">${head}
        <div class="row-btns" style="margin-top:10px">
          <button class="btn pay small" onclick="openSettleMsg(${b.sid},${b.id})">납입 요청 메시지</button>
          <button class="btn settle small" onclick="settleBill(${b.id})">받았어요</button>
        </div></div>`;
    }
    return `<div class="row" style="opacity:.75">${head}
        <div class="row-btns" style="margin-top:10px">
          <button class="btn ghost small" onclick="unsettleBill(${b.id})">받음 취소</button>
        </div></div>`;
  };

  // 진행 중 학생 → 곧 끝남(2주 이내) / 수업 중
  const todayK=dayKey(now.getTime());
  const prog = students.slice().map(s=>{
    const endMs=cycleEndOf(s);
    const days = endMs ? Math.round((dayKey(endMs)-todayK)/86400000) : null;
    return {s, endMs, days};
  }).sort((a,b)=> (a.endMs||9e15)-(b.endMs||9e15));
  const soon = prog.filter(p=>p.days!=null && p.days>=0 && p.days<=14);
  const later = prog.filter(p=>!(p.days!=null && p.days>=0 && p.days<=14));

  const progRow=(p, hi)=>{
    const s=p.s;
    const endTxt = p.endMs ? new Date(p.endMs).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}) : '미정';
    const dTxt = p.days==null ? '' : (p.days===0 ? '<b style="color:var(--clay)">오늘 마지막</b>'
      : p.days>0 ? `<b style="color:${hi?'var(--clay)':'var(--ink)'}">${p.days}일 남음</b>` : '');
    return `<div class="row"${hi?' style="border:1.4px solid var(--amber)"':''}>
      <div class="row-top"><span class="name">${s.name}</span><span class="contract">${doneCountOf(s)}/${s.plan}회</span></div>
      <div class="mg-line">🗓 마지막 수업 <b>${endTxt}</b>${dTxt?' · '+dTxt:''} · ${won(priceOf(s))}</div>
      ${hi?`<div class="row-btns" style="margin-top:8px"><button class="btn pay small" onclick="openSettleMsg(${s.id})">미리 납입 안내</button></div>`:''}
    </div>`;
  };

  const navBtn='width:30px;height:30px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  const monthNav=`<div style="display:flex;align-items:center;gap:9px;margin:2px 0 12px">
    <button onclick="settleNav(-1)" aria-label="이전달" style="${navBtn}">‹</button>
    <span style="flex:1;text-align:center;font-weight:600;font-size:15px">${vY}년 ${mL}${isThisMonth?' · 이번 달':''}</span>
    <button onclick="settleNav(1)" aria-label="다음달" style="${navBtn}">›</button>
    ${isThisMonth?'':`<button onclick="settleThisMonth()" style="border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;padding:0 11px;height:30px;cursor:pointer;font-family:inherit">이번 달</button>`}
  </div>`;

  el.innerHTML=monthNav+`
    <div class="sum"><div class="k">${mL}에 받은 돈</div><div class="big num">${won(monthPaidAmt)}</div>
      <div class="split">
        <div><div class="k">아직 못 받은 돈</div><div class="v" style="${unpaidAmt?'color:var(--clay)':''}">${won(unpaidAmt)}</div></div>
        <div><div class="k">미납 건수</div><div class="v" style="${unpaid.length?'color:var(--clay)':''}">${unpaid.length}건</div></div>
      </div></div>

    <div class="block-h"><span class="h">💰 받을 돈 (수업 끝남)</span>${unpaid.length?`<span class="cnt">${unpaid.length}</span>`:''}</div>
    ${unpaid.length ? unpaid.map(billRow).join('') : '<div class="muted-card">받을 돈이 없어요. 클래스를 다 채우면 여기에 자동으로 생겨요.</div>'}

    <div class="block-h" style="margin-top:24px"><span class="h">⏰ 곧 끝나요 (2주 이내)</span>${soon.length?`<span class="cnt">${soon.length}</span>`:''}</div>
    ${soon.length ? soon.map(p=>progRow(p,true)).join('') : '<div class="muted-card">2주 이내에 끝나는 학생이 없어요.</div>'}

    <div class="block-h" style="margin-top:24px"><span class="h">📚 수업 중</span>${later.length?`<span class="cnt">${later.length}</span>`:''}</div>
    ${later.length ? later.map(p=>progRow(p,false)).join('') : '<div class="muted-card">수업 중인 학생이 없어요.</div>'}

    <div class="block-h" style="margin-top:24px"><span class="h">✅ ${mL}에 받은 돈</span>${paidMonth.length?`<span class="cnt">${paidMonth.length}</span>`:''}</div>
    ${paidMonth.length ? paidMonth.map(billRow).join('') : `<div class="muted-card">${mL}에 받은 정산이 없어요.</div>`}`;
}
/* ===== 정산 건(청구서) — 클래스 완주 시 자동 생성, 완료 처리해야 사라짐, 미납 누적 ===== */
function billMonthTxt(b){ const d=new Date(b.endDate); return `${d.getMonth()+1}월분`; }
function createBill(s, endMs, meta){
  const end=endMs||dayKey(now.getTime());
  if(bills.some(b=>b.sid===s.id && b.endDate===end)) return; // 중복 정산건 방지
  const m=meta||{};
  bills.push({id:++billSeq, sid:s.id, plan:s.plan, amount:priceOf(s),
    startDate: m.startDate||null,          // 클래스 시작일
    sessions: m.sessions||null,            // 회차별 날짜 [ms,...]
    endDate:end, paid:false, paidDate:null});
}
// 회차를 다 채우면: 정산 건 생성(미납) + 과거 클래스 보존 + 새 클래스 시작 (코어, 조용)
// 완주한 클래스의 마지막 세션 다음 정규 수업일
function nextSessionAfter(s, ms){
  const base=dayKey(ms);
  for(let i=1;i<=400;i++){ const d=new Date(base); d.setDate(d.getDate()+i); const k=dayKey(d.getTime());
    if(s.days && s.days.includes(d.getDay()) && !isHoliday(k)) return k;
  }
  return base;
}
function doRollover(id){
  const s=st(id); if(!s||!s.plan) return false;
  const info=currentClassInfo(s);
  const byCalendar = doneCountOf(s) >= s.plan;              // 달력 기준 완주
  const byCounter  = (cycleDone[id]||0) >= s.plan;          // 등하원 카운터 기준 완주
  if(!byCalendar && !byCounter) return false;               // 아직 계약 회차 안 참
  // 완주한 클래스의 종료일
  let endMs = byCalendar ? (info.end || cycleEndOf(s)) : null;
  if(!endMs){
    const mine = sessions.filter(x=>x.sid===id).map(x=>dayKey(x.date)).sort((a,b)=>b-a);
    endMs = mine.length ? mine[0] : dayKey(now.getTime());  // 마지막 실제 수업일
  }
  // 완주한 클래스의 회차 날짜 목록
  let sessList = byCalendar ? info.sessions.slice(0, s.plan) : null;
  if(!sessList || sessList.length < s.plan){
    sessList = sessionDaysBack(s, endMs, s.plan);   // 종료일부터 거꾸로 plan회
  }
  if(endMs > dayKey(now.getTime())) endMs = dayKey(now.getTime());   // 종료일은 오늘을 넘지 않음
  createBill(s, endMs, {startDate: sessList[0] || info.start || null, sessions: sessList});  // 이전 클래스 → 정산 필요(미납)
  const hist=packHistory[id]||(packHistory[id]=[]);
  if(hist.some(h=>h.end===endMs)){ cycleDone[id]=0; s.cycleStart=nextSessionAfter(s,endMs); s.cycleEnd=null; return true; }  // 같은 클래스 이력 중복 방지
  hist.push({no:hist.length+1, plan:s.plan, done:s.plan,
    start: sessList[0] || info.start || null, end: endMs,
    sessions: sessList, amount: priceOf(s), settledDate:new Date(endMs)});
  cycleDone[id]=0;
  s.cycleStart = nextSessionAfter(s, endMs);  // 다음 클래스 = 완주 다음 수업일부터
  s.cycleEnd=null;
  return true;
}
/* 지난 클래스 이력·정산건 데이터 정리(옛 오류 보정, 1회성 자동 실행)
   - 미래 종료일 → 오늘로 보정
   - 회차 날짜 미저장 → 달력으로 복원해 영구 저장
   - 시작일 오류(시작>종료) → 회차 목록 첫날로 교정
   - 같은 종료일 이력 중복 제거 + 차수 재부여(오래된 것=1차) */
/* [1회성] 오늘 이전의 지난 수업은 모두 '확정'으로 처리.
   오늘부터는 등원(등하원·완료)을 눌러야 회차로 확정됨. */
function confirmPastOnce(){
  if(seedUntil) return false;                       // 이미 처리했으면 통과
  const todayK=dayKey(now.getTime());
  seedUntil = todayK;                               // 오늘 이전 = 확정 인정
  students.forEach(s=>{
    if(!s.plan || !s.days || !s.days.length) return;
    const info=currentClassInfo(s);                 // 달력상 이번 클래스 수업일
    const past = info.sessions.filter(k=>k<todayK).length;      // 오늘 이전 수업일 = 확정
    const todayRec = hasRecordOn(s.id, todayK) ? 1 : 0;         // 오늘은 등원 눌렀을 때만
    cycleDone[s.id] = past + todayRec;
  });
  saveData();
  return true;
}

function normalizeHistory(){
  let ch=false; const today=dayKey(now.getTime());
  if(confirmPastOnce()) ch=true;                    // 과거 일괄 확정(최초 1회)
  // 오늘 이전에 끝난 지난 클래스는 '확정'으로 간주하고 날짜를 고정(다시 계산되지 않게)
  students.forEach(s=>{
    (packHistory[s.id]||[]).forEach(h=>{
      if(h.confirmed) return;
      const en = h.end || (h.settledDate? dayKey(new Date(h.settledDate).getTime()) : null);
      if(!en || en >= today) return;
      const cnt=h.done||h.plan||0;
      const list=(Array.isArray(h.sessions)&&h.sessions.length>=cnt)?h.sessions:sessionDaysBack(s,en,cnt);
      if(list.length){ h.sessions=list.slice(); h.start=list[0]; h.end=list[list.length-1]; }
      h.confirmed=true; ch=true;
    });
  });
  // [이전 버전 호환] 옛 '오늘만 추가'(tempToday) → 보강(makeupLog)으로 옮기고 폐기
  if(tempToday.size && tempDay){
    [...tempToday].forEach(id=>{
      const s0=st(id); if(!s0) return;
      const mks=(makeupLog[id]=makeupLog[id]||[]);
      if(!mks.some(x=>dayKey(x.t)===tempDay)){
        const ti=(tempTimes&&tempTimes[id])||{};
        mks.push({t:tempDay, time:ti.time||timeFor(s0, new Date(tempDay).getDay())||s0.time||'16:00',
          dur:ti.dur||durOf(s0), done:false});
      }
    });
    tempToday=new Set(); tempTimes={}; tempDay=null; ch=true;
  }
  students.forEach(s=>{
    let hist=(packHistory[s.id]||[]);
    hist.forEach(h=>{
      let en = h.end || (h.settledDate? dayKey(new Date(h.settledDate).getTime()) : null);
      if(en==null) return;
      if(en>today){ en=today; ch=true; }                 // 미래 종료일 보정
      if(h.end!==en){ h.end=en; ch=true; }
      const cnt=h.done||h.plan||0;
      if(!Array.isArray(h.sessions) || h.sessions.length<cnt){
        h.sessions=sessionDaysBack(s,en,cnt); ch=true;   // 회차 날짜 복원·저장
      }
      const st0=h.sessions.length? h.sessions[0] : null;
      if(st0 && h.start!==st0){ h.start=st0; ch=true; }  // 시작일 교정
      if(h.amount==null){ h.amount=priceOf(s); ch=true; }
    });
    const seen={}, out=[];
    hist.slice().sort((a,b)=>(a.end||0)-(b.end||0)).forEach(h=>{
      if(h.end!=null && seen[h.end]){ ch=true; return; } // 중복 제거
      if(h.end!=null) seen[h.end]=1;
      out.push(h);
    });
    out.forEach((h,i)=>{ if(h.no!==i+1){ h.no=i+1; ch=true; } });  // 차수 재부여
    packHistory[s.id]=out;
  });
  bills.forEach(b=>{
    const s2=st(b.sid); if(!s2) return;
    if(b.endDate>today){ b.endDate=today; ch=true; }     // 정산건 미래 종료일 보정
    if(!Array.isArray(b.sessions) || b.sessions.length<b.plan){
      b.sessions=sessionDaysBack(s2,b.endDate,b.plan);
      b.startDate=b.sessions[0]||null; ch=true;
    }
  });
  if(ch) saveData();
  return ch;
}

// 로드 시 완주한 클래스 자동 롤오버 (밀린 것도 순차 처리)
function autoRolloverAll(){
  let changed=normalizeHistory();   // 옛 데이터 오류 정리 먼저
  students.forEach(s=>{ let g=0; while(g++<24 && doRollover(s.id)) changed=true; });
  if(changed){ saveData(); refreshCurrentView && refreshCurrentView(); }
  return changed;
}
function rolloverIfComplete(id){
  const s=st(id);
  if(doRollover(id)){ saveData(); showToast(`${s.name} ${s.plan}회 완주! 정산 건이 생성됐어요 (미납)`); return true; }
  return false;
}
// 이미 회차를 다 채운 학생(수동 입력 등)을 정산 건으로 일괄 변환 (조용)
function normalizeBills(){
  let ch=false;
  const before=bills.length;
  bills = bills.filter(b=>students.some(s=>s.id===b.sid));  // 삭제된 학생 정산 건 제거
  if(bills.length!==before) ch=true;
  students.forEach(s=>{ if(doRollover(s.id)) ch=true; });
  if(ch) saveData();
  return ch;
}
function settleBill(bid){
  const b=bills.find(x=>x.id===bid); if(!b||b.paid) return;
  b.paid=true; b.paidDate=Date.now();
  payments.push({sid:b.sid, date:new Date(b.paidDate), plan:b.plan, amount:b.amount, billId:bid});
  saveData(); renderSettle(); showToast('정산 완료 처리했어요');
}
function unsettleBill(bid){
  const b=bills.find(x=>x.id===bid); if(!b||!b.paid) return;
  b.paid=false; b.paidDate=null;
  const pi=payments.findIndex(p=>p.billId===bid); if(pi>=0) payments.splice(pi,1);
  saveData(); renderSettle(); showToast('정산을 취소했어요 (미납으로 되돌림)');
}

function markSettled(id){
  const s=st(id);
  const hist=packHistory[id]||(packHistory[id]=[]);
  const _endMs=cycleEndOf(s)||dayKey(now.getTime());
  const _list=sessionDaysBack(s,_endMs,doneCountOf(s)||s.plan);
  hist.push({no:hist.length+1, plan:s.plan, done:doneCountOf(s),
    start:_list[0]||cycleStartOf(s)||null, end:_endMs,
    sessions:_list, amount:priceOf(s), settledDate:new Date()});
  payments.push({sid:id,date:new Date(),plan:s.plan,amount:priceOf(s)});
  cycleDone[id]=0;              // 새 클래스 시작
  s.cycleStart=null; s.cycleEnd=null;  // 새 회차는 자동 계산(과거는 packHistory에 보존)
  saveData(); renderSettle();
  showToast(`${s.name} ${s.plan}회 정산 완료 · 새 클래스 시작`);
}
/* 납입 요청 문구 = 결과지·알림폼의 '정산 요청' 문구를 사용(변수 자동 치환) */
function buildSettleText(id, billId){
  const s=st(id);
  const g=(s.guardians&&s.guardians[0])||{};
  const b = billId!=null ? bills.find(x=>x.id===billId) : null;
  let list, startMs, endMs, cnt, done;
  if(b){                                   // 완주해서 생긴 정산 건
    list=billSessions(b); startMs=b.startDate||list[0]||null; endMs=b.endDate; cnt=b.plan; done=b.plan;
  } else {                                 // 진행 중(미리 안내)
    const ci=currentClassInfo(s);
    list=ci.sessions; startMs=ci.start; endMs=ci.end; cnt=s.plan; done=doneCountOf(s);
  }
  const finished = done>=cnt;
  const fD=(ms)=>{ if(!ms) return '-'; const d=new Date(ms); return `${d.getMonth()+1}.${d.getDate()}(${WD[d.getDay()]})`; };
  const amt = b ? b.amount : priceOf(s);
  const vars={
    학원명: academy.name||'', 원장명: academy.owner||'',
    학생명: s.name, 보호자명: g.name||s.guardian||'보호자',
    회차: String(cnt), 금액: won(amt).replace(/원$/,''),
    시작일: fD(startMs), 종료일: fD(endMs), 기간: `${fD(startMs)} ~ ${fD(endMs)}`,
    시각: new Date().toTimeString().slice(0,5), 내용:'',
    완료안내: finished ? `${s.name} 학생의 이번 회차 수업을 모두 마쳤습니다.`
                      : `${s.name} 학생의 이번 회차 수업이 ${fD(endMs)} 완료 예정입니다.`
  };
  const tpl=(msgTemplates.settle&&msgTemplates.settle.sms)||'';
  const out=applyVars(tpl, vars).trim();
  if(out) return out;
  // 문구 미설정 시 기본
  return `안녕하세요. ${vars.보호자명}님.\n${vars.완료안내}\n\n· 이번 회차 : ${vars.기간} (${cnt}회)\n· 수업료 : ${won(amt)}\n\n결제 안내 드립니다.\n감사합니다.`;
}
function openSettleMsg(id, billId){
  const s=st(id);
  const g=(s.guardians&&s.guardians[0])||{};
  const text=buildSettleText(id, billId);
  _msgCtx={id, text};
  const kakao = g.kakao!==false;
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 납입 요청</h3>
    <div class="cap">${kakao?'카카오톡 또는 문자로 보낼 수 있어요.':'이 학부모는 카톡이 없어 문자로 보냅니다.'} 문구는 <b>알림 문구</b> 메뉴에서 바꿀 수 있어요.</div>
    <div class="msg" style="white-space:pre-line">${text.replace(/</g,'&lt;')}</div>
    <div class="sheet-btns">
      ${kakao?`<button class="btn kakao" onclick="sendVia('카카오톡',${id})">카톡으로 보내기</button>`:''}
      <button class="btn sms" onclick="sendVia('문자',${id})">문자로 보내기</button>
    </div>`;
  document.getElementById('scrim').classList.add('show');
}
let _msgCtx=null;
// 채널(카톡/문자) 강제 지정해 보호자에게 메시지 열기
function openMsgWith(sid, text, forceKakao){
  const s=st(sid);
  let gs=guardiansOf(s).map(g=>({...g, kakao: forceKakao}));
  _notifyCtx={gs, text};
  if(gs.length===1){ closeSheet(); openMsgTo(0); return; }
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 보호자에게 열기</h3>
    <div class="cap">보호자별로 열어요. 카톡은 복사 후 붙여넣기, 문자는 자동 작성됩니다.</div>
    <div class="msg">${text.replace(/</g,'&lt;')}</div>
    ${gs.map((g,i)=>`<button class="btn ${forceKakao?'kakao':'sms'}" style="margin-bottom:8px" onclick="openMsgTo(${i})">${g.name} · ${forceKakao?'카톡 복사 + 열기':'문자 열기'}</button>`).join('')}
    <div class="sheet-btns"><button class="btn ghost" onclick="closeSheet()">닫기</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function sendVia(ch,id){
  const s=st(id); const text=(_msgCtx&&_msgCtx.id===id)?_msgCtx.text:'';
  logAdd(id,'pay',`${s.name} 납입 요청 (${ch}) → ${s.guardian}`);
  if((autoSend||autoSms) && fbFunctions && sendOn('settle')){ closeSheet(); autoSendAll(id, 'settle', text, guardiansOf(s)); return; }
  openMsgWith(id, text, ch==='카카오톡');
}
function closeSheet(){document.getElementById('scrim').classList.remove('show');}
document.getElementById('scrim').addEventListener('click',e=>{if(e.target.id==='scrim')closeSheet();});

/* ===== 설정 (관리자) ===== */
const OWNER_EMAIL='mhstory76@gmail.com';
// 로그인 권한을 가진 관리자 명단 — Firestore admins 컬렉션에서 로드
let admins=[];
let adminSection=null;  // null=허브, 'basic'/'people'=하위
function renderAdmin(){
  const el=document.getElementById('v-admin');
  if(adminSection==='basic'){ el.innerHTML=adminBasic(); return; }
  if(adminSection==='people'){ el.innerHTML=adminPeople(); return; }
  // 허브 메뉴
  const menu=[
    {k:'students',t:'학생 관리',d:'학생 추가·수정 · 회차/요일/시간 · 보호자 정보',ready:true},
    {k:'academy',t:'학원 관리',d:'학원명 · 원장명 · 대표전화',ready:true},
    {k:'classmgmt',t:'휴일 관리',d:'휴일 등록 · 토·일·공휴일 기본 휴일',ready:true},
    {k:'send',t:'발송 · 상담',d:'카톡/문자 발송, 상담 기록',ready:true},
    {k:'guide',t:'알림 문구',d:'등원·하원·정산 등 보낼 문구 편집',ready:true},
    {k:'payhist',t:'정산 내역',d:'차수별 결제 이력',ready:true},
    {k:'people',t:'관리자 등록',d:'로그인 권한이 있는 사람 관리',ready:true},
    {k:'basic',t:'수업 기본 설정',d:'클래스 금액 · 마감 알림 시각',ready:true},
    {k:'datacheck',t:'데이터 점검',d:'잘못된 지난 클래스·정산 기록 찾아 정리',ready:true},
  ];
  el.innerHTML=`
    <div class="acct">
      <div class="acct-av">${(currentUser?currentUser.name:'원')[0]}</div>
      <div class="acct-info"><div class="acct-name">${currentUser?currentUser.name:'원장님'}</div>
        <div class="acct-mail">${currentUser?currentUser.email:OWNER_EMAIL}</div></div>
      <button class="acct-out" onclick="logout()">로그아웃</button>
    </div>
    <div class="admin-menu">
      ${menu.map(m=>`<button class="am-item" onclick="${m.k==='students'?`goTab('manage')`:m.k==='classmgmt'?`goTab('classmgmt')`:m.k==='academy'?`goTab('academy')`:m.k==='basic'?`openAdmin('basic')`:m.k==='people'?`openAdmin('people')`:m.k==='send'?`goTab('send')`:m.k==='guide'?`goTab('guide')`:m.k==='payhist'?`goTab('payhist')`:m.k==='datacheck'?`goTab('datacheck')`:`comingSoon('${m.t}')`}">
        <div class="am-tx"><div class="am-t">${m.t}</div><div class="am-d">${m.d}</div></div>
        <div class="am-go">${m.ready?'›':'준비 중'}</div></button>`).join('')}
    </div>`;
}
function adminBasic(){
  return `<button class="back" onclick="openAdmin(null)">‹ 설정</button>
    <h2 class="page-h">수업 기본 설정</h2>
    <div class="set-sec">
      <h3>클래스 금액</h3>
      <div class="cap">회차별 수업료를 정해요. 정산 금액이 여기 값으로 자동 계산됩니다. 필요하면 클래스를 추가할 수 있어요.</div>
      ${Object.keys(packages).map(n=>+n).filter(n=>n>0).sort((a,b)=>a-b).map(n=>`
        <div class="price-row"><label>${n}회</label>
          <div class="price-in"><input type="number" value="${packages[n]}" onchange="setPrice(${n},this.value)"><span>원</span></div>
          ${(n===8||n===12)?'':`<button class="btn ghost small" style="width:auto;margin:0 0 0 8px;padding:9px 12px" onclick="removePackage(${n})">삭제</button>`}
        </div>`).join('')}
      <button class="btn ghost small" style="width:auto;margin-top:8px;padding:10px 16px" onclick="openPackageSheet()">＋ 클래스 추가</button>
    </div>
    <div class="set-sec">
      <h3>메모 마감 알림</h3>
      <div class="cap">이 시각이 지나면 홈에서 '오늘 학습내용 미작성' 학생을 챙겨줘요. (실제 푸시 알림은 앱 출시 때 연결)</div>
      <div class="price-row"><label>마감 시각</label>
        <div class="price-in"><input type="time" value="${closeTime}" onchange="setCloseTime(this.value)" style="text-align:left"></div></div>
    </div>
    <div class="set-sec">
      <h3>데이터</h3>
      <div class="cap">이 기기에 저장돼요. 실제 폰/PC 브라우저나 웹에 올렸을 때 유지됩니다. 아래 버튼은 저장된 내용을 지우고 예시 데이터로 되돌려요.</div>
      <button class="btn ghost" onclick="resetData()">저장된 데이터 초기화</button>
    </div>`;
}
function openAdmin(sec){ adminSection=sec; renderAdmin(); window.scrollTo(0,0); }
function adminPeople(){
  return `<button class="back" onclick="openAdmin(null)">‹ 설정</button>
    <h2 class="page-h">관리자 등록</h2>
    <p class="page-cap">로그인 권한을 가질 사람을 등록해요. 여기 등록된 구글 이메일로만 로그인할 수 있게 됩니다. (실제 인증 차단은 앱 출시 때 연결)</p>
    <button class="btn start" style="margin-bottom:16px" onclick="openAdminSheet()">＋ 관리자 추가</button>
    ${admins.map((a,i)=>`<div class="row">
      <div class="row-top"><span class="name">${a.name}${a.owner?' <span class="owner-tag">기본</span>':''}</span>
        ${a.owner?'':`<button class="btn ghost small" style="width:auto;padding:6px 12px;margin:0" onclick="delAdmin(${i})">삭제</button>`}</div>
      <div class="mg-line">✉ ${a.email}</div>
      <div class="mg-line">📞 ${a.phone||'-'}</div>
    </div>`).join('')}`;
}
function openAdminSheet(){
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>관리자 추가</h3>
    <div class="cap">이 사람의 구글 이메일로 로그인 권한이 생겨요.</div>
    <div class="fld"><label>이름</label><input id="adName" class="note-select" placeholder="이름"></div>
    <div class="fld"><label>구글 이메일</label><input id="adEmail" class="note-select" placeholder="name@gmail.com"></div>
    <div class="fld"><label>핸드폰</label><input id="adPhone" class="note-select" placeholder="010-0000-0000"></div>
    <div class="sheet-btns"><button class="btn start" onclick="saveAdmin()">추가</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function saveAdmin(){
  const name=document.getElementById('adName').value.trim();
  const email=document.getElementById('adEmail').value.trim();
  const phone=document.getElementById('adPhone').value.trim();
  if(!name||!email){showToast('이름과 이메일을 입력해주세요');return;}
  if(!/.+@.+\..+/.test(email)){showToast('이메일 형식을 확인해주세요');return;}
  if(admins.some(a=>a.email.toLowerCase()===email.toLowerCase())){showToast('이미 등록된 이메일이에요');return;}
  const rec={name,email,phone,owner:false};
  admins.push(rec); closeSheet(); renderAdmin(); showToast(`${name} 관리자 추가됨`);
  addAdminDoc(email, {name, phone, owner:false});  // store.js → admins 컬렉션
}
function delAdmin(i){ if(admins[i]&&admins[i].owner)return;
  const email=admins[i].email;
  admins.splice(i,1); renderAdmin(); showToast('관리자를 삭제했어요');
  removeAdminDoc(email);  // store.js → admins 컬렉션
}
function comingSoon(name){ showToast(`${name}은 다음 단계에서 만들어요`); }
function logout(){ adminSection=null; if(typeof signOutNow==='function') signOutNow(); else doLogout(); }  // 저장 후 실제 로그아웃
let closeTime='20:00';
function setCloseTime(v){ closeTime=v; saveData(); }
function resetData(){ location.reload(); }
function setPrice(plan,val){ packages[plan]=parseInt(val||0,10)||0; saveData(); }
function openPackageSheet(){
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>클래스 추가</h3>
    <div class="cap">회차 수와 금액을 넣어요. (예: 10회 · 130,000원)</div>
    <div class="fld"><label>회차</label><input type="number" id="pkN" class="note-select" min="1" placeholder="예: 10"></div>
    <div class="fld"><label>금액 (원)</label><input type="number" id="pkAmt" class="note-select" min="0" placeholder="예: 130000"></div>
    <div class="sheet-btns"><button class="btn start" onclick="addPackage()">추가</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function addPackage(){
  const n=parseInt(document.getElementById('pkN').value||0,10);
  const amt=parseInt(document.getElementById('pkAmt').value||0,10)||0;
  if(!n||n<1){showToast('회차를 입력해주세요');return;}
  if(packages[n]!=null){showToast('이미 있는 회차예요. 금액만 수정하세요');return;}
  packages[n]=amt; saveData(); closeSheet(); openAdmin('basic'); showToast(`${n}회 클래스 추가됨`);
}
function removePackage(n){
  if(n===8||n===12){showToast('기본 클래스(8·12회)는 삭제할 수 없어요');return;}
  delete packages[n]; saveData(); openAdmin('basic'); showToast(`${n}회 클래스 삭제됨`);
}
function setPlan(id,plan){ st(id).plan=plan; }

let nextId=100;
function manageCard(s, forDay){
  const days=s.days.slice().sort((a,b)=>a-b).map(d=>WD[d]).join('·');
  const timeTxt = (s.dayTimes&&Object.keys(s.dayTimes).length)
    ? s.days.slice().sort((a,b)=>a-b).map(d=>`${WD[d]} ${timeFor(s,d)}`).join(' / ')
    : (s.time||'-');
  const gLines = guardiansOf(s).map((g,i)=>`👤 보호자 ${i+1} : ${g.name} · ${g.phone||'-'} · ${g.kakao?'카톡':'문자'}`).join('<br>');
  const startTxt = s.startDate ? new Date(s.startDate).toLocaleDateString('ko-KR') : '미입력';
  const eduTxt = [s.grade?gradeLabel(s.grade):'', s.school||''].filter(Boolean).join(' · ');
  const eduLine = eduTxt ? `<div class="mg-line">🎓 ${eduTxt}</div>` : '';
  const dayTime = (forDay!=null) ? `<div class="mg-line">⏰ ${WD[forDay]} ${timeFor(s,forDay)}~${endTimeOf(timeFor(s,forDay),durOf(s))}</div>` : '';
  return `<div class="row" id="mng-${s.id}">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${eduLine}${dayTime}
    <div class="mg-line">🗓 ${days}요일 · ${timeTxt} · <b>${durLabel(durOf(s))}</b></div>
    <div class="mg-line">🏫 학원 수업 시작일 : ${startTxt}</div>
    <div class="mg-line">🔄 이번 회차 : ${fmtD(cycleStartOf(s))} ~ ${fmtD(cycleEndOf(s))} · 현재 ${doneCountOf(s)}/${s.plan}회차
      <button class="btn ghost small" style="width:auto;padding:3px 8px;font-size:11px;margin-left:6px;display:inline-block" onclick="askConfirmCurrent(${s.id})">회차 확정</button></div>
    <div class="mg-line">${gLines}</div>
    ${pastClassesHtml(s)}
    <div class="row-btns" style="margin-top:11px">
      <button class="btn ghost small" onclick="openStudentSheet(${s.id})">수정</button>
      <button class="btn ghost small" onclick="toggleMngCal(${s.id})">${mngCal.open===s.id?'달력 닫기':'달력 보기'}</button>
      <button class="btn pay small" onclick="openNoticeSheet(${s.id})">안내문</button>
      <button class="btn ghost small" onclick="askDeleteStudent(${s.id})">삭제</button>
    </div>
    ${mngCal.open===s.id ? buildCalendar(s, mngCal, `mngCalNav(${s.id},-1)`, `mngCalNav(${s.id},1)`) : ''}
    </div>`;
}
/* 목록(검색결과)만 만들기 — 입력창은 다시 그리지 않아 한글 조합이 깨지지 않음 */
function manageListHtml(){
  const byName=(a,b)=>a.name.localeCompare(b.name,'ko');
  const pool=students.filter(x=>matchStu(x, mngQuery));
  const grpH=(t,n)=>`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:20px 2px 9px;padding-bottom:5px;border-bottom:1px solid var(--line)">
    <span style="font-size:12.5px;font-weight:700;color:var(--ink)">${t}</span>
    ${n!=null?`<span style="font-size:12px;color:var(--muted)">${n}명</span>`:''}</div>`;
  const count=`전체 <b style="color:var(--ink)">${students.length}명</b>${mngQuery?` · 검색 결과 <b style="color:var(--amber)">${pool.length}명</b>`:''}`;

  let body='';
  if(manageSort==='name'){
    body = pool.slice().sort(byName).map(s=>manageCard(s)).join('');
  } else if(manageSort==='grade'){
    const groups={}; pool.forEach(s=>{ const k=s.grade||'none'; (groups[k]=groups[k]||[]).push(s); });
    const order=[...GRADES.map(g=>g[0]),'none'];
    body = order.filter(k=>groups[k]&&groups[k].length).map(k=>{
      const label = k==='none' ? '학년 미입력' : gradeLabel(k);
      return grpH(label, groups[k].length) + groups[k].sort(byName).map(s=>manageCard(s)).join('');
    }).join('');
  } else { // 요일별
    const dayOrder=[1,2,3,4,5];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    const cntOf=(d)=>pool.filter(s=>s.days.includes(d)).length;
    const dtab=(v,label,n)=>`<button onclick="setMngDay(${v})" style="padding:8px 12px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${mngDayFilter===v?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}<span style="opacity:.7;font-weight:500"> ${n}</span></button>`;
    const tabBar=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${dtab(null,'전체',pool.length)}${dayOrder.map(d=>dtab(d,WD[d],cntOf(d))).join('')}</div>`;
    const shown=(mngDayFilter==null)?dayOrder:[mngDayFilter];
    const groups=shown.map(d=>{
      const list=pool.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일`, list.length); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=manageCard(s,d); });
      return html;
    }).join('');
    body = tabBar + (groups || '<div class="muted-card">해당 요일에 수업이 없어요.</div>');
  }
  if(!students.length) body='<div class="muted-card">아직 등록된 학생이 없어요. 위 ‘＋ 학생 추가’로 시작하세요.</div>';
  else if(!pool.length) body=`<div class="muted-card">검색 결과가 없어요.</div>`;
  return {count, body};
}
/* 검색 입력: 목록만 교체 (입력창은 그대로 → 한글 조합 정상) */
function renderManageList(){
  const r=manageListHtml();
  const c=document.getElementById('mngCount'); if(c) c.innerHTML=r.count;
  const l=document.getElementById('mngList'); if(l) l.innerHTML=r.body;
  const x=document.getElementById('mngClear'); if(x) x.style.display=mngQuery?'':'none';
}
function renderManage(){
  const el=document.getElementById('v-manage');
  const r=manageListHtml();
  const sortBtn=(m,label)=>`<button onclick="setManageSort('${m}')" style="flex:1;padding:9px 6px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${manageSort===m?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">학생 관리</h2>
    <p class="page-cap">학생을 추가·수정하고 회차·요일·시간과 보호자 정보를 설정해요.</p>
    <button class="btn start" style="margin-bottom:14px" onclick="openStudentSheet(null)">＋ 학생 추가</button>
    <div style="position:relative;margin-bottom:10px">
      <input id="mngSearch" value="${(mngQuery||'').replace(/"/g,'&quot;')}" placeholder="🔍 학생 이름 · 학교 · 보호자 · 전화번호 검색"
        oninput="setMngQuery(this.value)"
        style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:11px 38px 11px 12px;font-family:inherit;font-size:14px;background:#fff">
      <button id="mngClear" onclick="clearMngQuery()" style="display:${mngQuery?'':'none'};position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:#EDEBE4;border-radius:50%;width:22px;height:22px;cursor:pointer;color:var(--muted);font-size:13px;line-height:1">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">${sortBtn('name','전체 (가나다)')}${sortBtn('day','요일별')}${sortBtn('grade','학년별')}</div>
    <div id="mngCount" style="font-size:13px;color:var(--muted);margin:0 2px 12px">${r.count}</div>
    <div id="mngList">${r.body}</div>`;
}
/* ===== 달력 클릭으로 기간(시작일~종료일) 고르기 ===== */
let _rp={start:null, end:null, y:0, m:0, open:false};
function rpInit(startMs, endMs){
  const base = startMs || dayKey(now.getTime());
  _rp={ start:startMs||null, end:endMs||null, y:new Date(base).getFullYear(), m:new Date(base).getMonth(), open:false };
}
function rpToggle(){ _rp.open=!_rp.open; rpRender(); }
function rpNav(d){ _rp.m+=d; if(_rp.m<0){_rp.m=11;_rp.y--;} if(_rp.m>11){_rp.m=0;_rp.y++;} rpRender(); }
function rpPick(ms){
  if(_rp.start==null || (_rp.start!=null && _rp.end!=null)){ _rp.start=ms; _rp.end=null; }   // 새로 시작
  else if(ms < _rp.start){ _rp.start=ms; }                                                    // 시작보다 앞이면 시작 교체
  else { _rp.end=ms; }
  rpRender();
}
function rpClear(){ _rp.start=null; _rp.end=null; rpRender(); }
function rpLabel(){
  if(!_rp.start) return '날짜를 고르세요 (자동 계산)';
  if(!_rp.end) return `${fmtMD(_rp.start)} ~ (종료일 선택)`;
  return `${fmtMD(_rp.start)} ~ ${fmtMD(_rp.end)}`;
}
function rpRender(){
  const box=document.getElementById('rpBox'); if(!box) return;
  const lab=document.getElementById('rpLabel'); if(lab) lab.textContent=rpLabel();
  if(!_rp.open){ box.innerHTML=''; return; }
  const sid=+(document.getElementById('sheet').dataset.rpSid||0);
  const s=sid?st(sid):null;
  const y=_rp.y, m=_rp.m;
  const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
  const todayK=dayKey(now.getTime());
  let grid='';
  ['일','월','화','수','목','금','토'].forEach(w=>grid+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++) grid+='<div></div>';
  for(let dd=1;dd<=dim;dd++){
    const t=new Date(y,m,dd).getTime();
    const isClass = s ? isClassDay(s,t) : false;
    let style='cursor:pointer;border-radius:7px;';
    if(_rp.start && _rp.end && t>_rp.start && t<_rp.end) style+='background:#FAEEDA;color:#854F0B;';
    if(t===_rp.start || t===_rp.end) style+='background:var(--amber);color:#fff;font-weight:700;';
    else if(isClass) style+='box-shadow:inset 0 0 0 1.5px #C9E4D3;';
    if(t===todayK) style+='outline:2px solid #E03131;outline-offset:-2px;';
    grid+=`<div class="cal-d" style="${style}" onclick="rpPick(${t})">${dd}</div>`;
  }
  box.innerHTML=`<div class="cal" style="margin-top:8px">
    <div class="cal-nav"><button type="button" onclick="rpNav(-1)">‹</button>
      <span>${y}년 ${m+1}월</span>
      <button type="button" onclick="rpNav(1)">›</button></div>
    <div class="cal-grid">${grid}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <span style="font-size:11.5px;color:var(--muted)">초록 테두리 = 이 학생 수업일 · 처음 클릭=시작일, 두 번째=종료일</span>
      <button type="button" class="btn ghost small" style="width:auto;padding:4px 9px;font-size:11.5px;margin:0" onclick="rpClear()">지우기</button>
    </div>
  </div>`;
}

function openStudentSheet(id){
  const s=id?st(id):{name:'',phone:'',plan:8,time:'16:00',days:[],guardians:[],startDate:null,dayTimes:null,dur:null};
  const gs=guardiansOf(s);
  const g1=gs[0]||{name:'',phone:'',kakao:true};
  const g2=gs[1]||null;
  const startVal = s.startDate ? new Date(s.startDate).toISOString().slice(0,10) : '';
  const curCycle = id ? (doneCountOf(s)+1) : 1;  // 진행 중인 회차 번호 = 완료+1 (표시와 동일 계산)
  const pkgList = Object.keys(packages).map(n=>+n).filter(n=>n>0).sort((a,b)=>a-b);
  const preset = pkgList.includes(s.plan);
  const dayBtns=WD.map((w,i)=>`<button type="button" class="day-btn ${s.days.includes(i)?'on':''}" data-d="${i}" onclick="this.classList.toggle('on');syncDayTimes();autoDurByDays()">${w}</button>`).join('');
  // 요일별 시간 입력(모든 요일 렌더, per 모드에서만 노출)
  const perOn = !!(s.dayTimes && Object.keys(s.dayTimes).length);
  const dayTimeRows=WD.map((w,i)=>`<div class="daytime-row" data-dt="${i}" style="display:none">
      <span>${w}요일</span><input type="time" class="note-select dt-inp" data-d="${i}" value="${s.dayTimes&&s.dayTimes[i]?s.dayTimes[i]:(s.time||'16:00')}"></div>`).join('');
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${id?'학생 수정':'학생 추가'}</h3>
    <div class="fld"><label>학생 이름</label><input id="stName" class="note-select" value="${s.name}" placeholder="학생 이름"></div>
    <div class="fld"><label>학년</label>
      <select id="stGrade" class="note-select">
        <option value="">선택 안 함</option>
        ${GRADES.map(g=>`<option value="${g[0]}" ${s.grade===g[0]?'selected':''}>${g[1]}</option>`).join('')}
      </select></div>
    <div class="fld"><label>학교</label><input id="stSchool" class="note-select" value="${s.school||''}" placeholder="○○초등학교 (선택)"></div>
    <div class="fld"><label>학생 전화번호</label><input id="stPhone" class="note-select" value="${s.phone||''}" placeholder="010-0000-0000 (선택)"></div>
    <div class="fld"><label>학원 수업 시작일 <span class="hint">첫 수업일 · 모르면 비워두세요</span></label>
      <input type="date" id="stStart" class="note-select" value="${startVal}"></div>
    <div class="fld"><label>클래스 회차 <span class="hint">이 회차를 다 채우면 정산</span></label>
      <div id="planBtns" style="display:flex;flex-wrap:wrap;gap:8px">
        ${pkgList.map(n=>`<button type="button" class="pl-btn" data-p="${n}" onclick="pickPlan(${n})" style="flex:1;min-width:64px;padding:10px;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid ${s.plan===n?'var(--ink)':'var(--line)'};background:${s.plan===n?'var(--ink)':'#F7F6F1'};color:${s.plan===n?'#fff':'var(--ink)'}">${n}회</button>`).join('')}
      </div>
      <input type="number" id="stPlanCustom" class="note-select" min="1" style="margin-top:8px" placeholder="직접 입력 (그 외 회차)" value="${preset?'':s.plan}" oninput="pickPlan(null)"></div>
    <div class="fld"><label>현재 회차 <span class="hint">이 클래스에서 지금 몇 회차 진행 중인지 (1 = 첫 수업)</span></label>
      <input type="number" id="stCycle" class="note-select" min="1" value="${curCycle}" placeholder="1"></div>
    <div class="fld"><label>이번 회차 기간 <span class="hint">달력에서 시작일·종료일을 누르세요 (비워두면 자동)</span></label>
      <button type="button" onclick="rpToggle()" style="width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-family:inherit;font-size:14px;color:var(--ink);cursor:pointer">
        📅 <span id="rpLabel">${s.cycleStart?(s.cycleEnd?`${fmtMD(s.cycleStart)} ~ ${fmtMD(s.cycleEnd)}`:`${fmtMD(s.cycleStart)} ~ (종료일 선택)`):'날짜를 고르세요 (자동 계산)'}</span>
      </button>
      <div id="rpBox"></div></div>
    <div class="fld"><label>요일</label><div class="day-row" id="dayRow">${dayBtns}</div></div>
    <div class="fld"><label>수업 시간 <span class="hint">주3회는 1시간 · 주2회는 1시간 30분</span></label>
      <div class="seg2" id="durRow">
        ${DUR_OPTS.map(([m,label])=>`<button type="button" class="${durOf(s)===m?'on':''}" data-dur="${m}" onclick="pickDur(${m})">${label}</button>`).join('')}
      </div></div>
    <div class="fld"><label>시간 <span class="hint">시작 시각</span></label><input type="time" id="stTime" class="note-select" value="${s.time||'16:00'}" oninput="syncDayTimes()">
      <label class="chk"><input type="checkbox" id="perDayChk" ${perOn?'checked':''} onchange="togglePerDay()"> 요일마다 시간 다르게</label>
      <div id="dayTimes" style="${perOn?'':'display:none'}">${dayTimeRows}</div></div>
    <div class="fld"><label>보호자 1</label>
      <input id="g1name" class="note-select" value="${g1.name||''}" placeholder="보호자 이름">
      <input id="g1phone" class="note-select" style="margin-top:8px" value="${g1.phone||''}" placeholder="010-0000-0000">
      <div class="seg2" style="margin-top:8px"><button type="button" id="g1kkO" class="${g1.kakao!==false?'on':''}" onclick="pickGK(1,true)">카톡 (없으면 문자 자동)</button>
        <button type="button" id="g1kkX" class="${g1.kakao===false?'on':''}" onclick="pickGK(1,false)">문자만</button></div></div>
    <div class="fld" id="g2wrap" style="${g2?'':'display:none'}"><label>보호자 2 <button type="button" class="mini-x" onclick="removeG2()">제거</button></label>
      <input id="g2name" class="note-select" value="${g2?g2.name||'':''}" placeholder="보호자 이름">
      <input id="g2phone" class="note-select" style="margin-top:8px" value="${g2?g2.phone||'':''}" placeholder="010-0000-0000">
      <div class="seg2" style="margin-top:8px"><button type="button" id="g2kkO" class="${g2&&g2.kakao!==false?'on':''}" onclick="pickGK(2,true)">카톡 (없으면 문자 자동)</button>
        <button type="button" id="g2kkX" class="${g2&&g2.kakao===false?'on':''}" onclick="pickGK(2,false)">문자만</button></div></div>
    <button type="button" id="addG2" class="btn ghost small" style="${g2?'display:none':''};margin-bottom:14px" onclick="addG2()">＋ 보호자 2 추가</button>
    <div class="sheet-btns" style="margin-top:6px">
      <button class="btn start" onclick="saveStudent(${id||'null'})">저장</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  sheet.dataset.plan=s.plan;
  sheet.dataset.rpSid=id||'';
  sheet.dataset.g1kakao=(g1.kakao!==false)?'1':'0';
  sheet.dataset.g2kakao=(g2&&g2.kakao===false)?'0':'1';
  rpInit(s.cycleStart||null, s.cycleEnd||null);   // 달력 기간 선택기 초기화
  sheet.dataset.dur=String(durOf(s));
  syncDayTimes();
  document.getElementById('scrim').classList.add('show');
}
function stylePlBtn(b,on){ b.style.background=on?'var(--ink)':'#F7F6F1'; b.style.color=on?'#fff':'var(--ink)'; b.style.borderColor=on?'var(--ink)':'var(--line)'; }
function pickPlan(p){
  const sheet=document.getElementById('sheet');
  const btns=[...document.querySelectorAll('#planBtns .pl-btn')];
  if(p===null){ const v=+document.getElementById('stPlanCustom').value||0; sheet.dataset.plan=v;
    btns.forEach(b=>stylePlBtn(b,false)); return; }
  sheet.dataset.plan=p; const ci=document.getElementById('stPlanCustom'); if(ci)ci.value='';
  btns.forEach(b=>stylePlBtn(b, +b.dataset.p===p));
}
function pickGK(n,v){const sheet=document.getElementById('sheet');sheet.dataset['g'+n+'kakao']=v?'1':'0';
  document.getElementById('g'+n+'kkO').classList.toggle('on',v);
  document.getElementById('g'+n+'kkX').classList.toggle('on',!v);}
function togglePerDay(){const on=document.getElementById('perDayChk').checked;
  document.getElementById('dayTimes').style.display=on?'':'none'; syncDayTimes();}
function pickDur(m){
  const sheet=document.getElementById('sheet'); sheet.dataset.dur=String(m); sheet.dataset.durTouched='1';
  document.querySelectorAll('#durRow button').forEach(b=>b.classList.toggle('on', +b.dataset.dur===+m));
}
/* 요일을 바꾸면 아직 직접 고르지 않은 경우 기본값(3회=1시간/2회=1시간30분) 자동 반영 */
function autoDurByDays(){
  const sheet=document.getElementById('sheet');
  if(sheet.dataset.durTouched==='1') return;
  const days=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  pickDur(defaultDur(days));
}
function syncDayTimes(){ // per-day 행을 선택된 요일만 노출, 공통시간을 기본값으로
  const on=document.getElementById('perDayChk')&&document.getElementById('perDayChk').checked;
  const sel=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  document.querySelectorAll('.daytime-row').forEach(r=>{
    const d=+r.dataset.dt; r.style.display=(on&&sel.includes(d))?'flex':'none';});
}
function addG2(){document.getElementById('g2wrap').style.display='';document.getElementById('addG2').style.display='none';}
function removeG2(){document.getElementById('g2wrap').style.display='none';document.getElementById('addG2').style.display='';
  document.getElementById('g2name').value='';document.getElementById('g2phone').value='';}
function saveStudent(id){
  const name=document.getElementById('stName').value.trim();
  if(!name){showToast('학생 이름을 입력해주세요');return;}
  const sheet=document.getElementById('sheet');
  const days=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  let plan=+sheet.dataset.plan||0; if(plan<1){showToast('클래스 회차를 정해주세요');return;}
  const commonTime=document.getElementById('stTime').value||'16:00';
  const dur = +sheet.dataset.dur || defaultDur(days);      // 수업 시간(길이)
  // 요일별 시간
  let dayTimes=null;
  if(document.getElementById('perDayChk').checked){
    dayTimes={}; days.forEach(d=>{ const inp=document.querySelector(`.dt-inp[data-d="${d}"]`); dayTimes[d]=inp?inp.value||commonTime:commonTime; });
  }
  // 보호자
  const guardians=[{name:document.getElementById('g1name').value.trim()||name+' 보호자',
    phone:document.getElementById('g1phone').value.trim(), kakao:sheet.dataset.g1kakao==='1'}];
  if(document.getElementById('g2wrap').style.display!=='none'){
    const n2=document.getElementById('g2name').value.trim();
    if(n2) guardians.push({name:n2, phone:document.getElementById('g2phone').value.trim(), kakao:sheet.dataset.g2kakao==='1'});
  }
  const startRaw=document.getElementById('stStart').value;
  const startDate=startRaw?new Date(startRaw+'T00:00:00').getTime():null;
  const cycleStart=_rp.start||null;      // 달력에서 고른 시작일
  const cycleEnd=_rp.end||null;          // 달력에서 고른 종료일
  const curCycleInput=+document.getElementById('stCycle').value||1;
  const curDone=Math.max(0, curCycleInput-1);  // N회차 진행 중 = N-1회 완료
  const data={name, phone:document.getElementById('stPhone').value.trim(),
    grade:document.getElementById('stGrade').value, school:document.getElementById('stSchool').value.trim(),
    plan, days, time:commonTime, dayTimes, startDate, cycleStart, cycleEnd, guardians,
    // 호환용 대표(보호자1) 미러
    guardian:guardians[0].name, kakao:guardians[0].kakao, dur};
  data.phone_guardian=guardians[0].phone; // 참고용
  if(id){ Object.assign(st(id),data); cycleDone[id]=curDone; }
  else { const nid=++nextId; students.push({id:nid,...data}); cycleDone[nid]=curDone; }
  saveData(); closeSheet(); renderManage(); showToast(`${name} ${id?'수정됨':'추가됨'}`);
}
/* ===== 등원 / 하원 / 완료 확인 시트 — 시·분 드래그 휠 ===== */
let _sc={id:null, kind:'start', tab:'start', start:null, end:null};
const _hm=(ms)=> ms? new Date(ms).toTimeString().slice(0,5) : '';
const SC_H=[]; for(let h=6;h<=23;h++) SC_H.push(h);
const SC_M=[]; for(let m=0;m<60;m++) SC_M.push(m);
const SC_ITEM=44;   // 탭하기 쉽게 넉넉히
function _mkT(h,m){ const d=new Date(_sc.date||dayKey(now.getTime())); d.setHours(h,m,0,0); return d.getTime(); }
function _round10(ms){ const d=new Date(ms); return _mkT(d.getHours(), d.getMinutes()); }

function openSendConfirm(id, kind, dateMs){
  const s=st(id);
  _sc={ id, kind, date: dayKey(dateMs||now.getTime()) };   // 기준 날짜(지난 날 확정 가능)
  const plan=_defaultStart(id);                    // 예정 수업 시각(임시/보강/요일표)
  const dmin=todayDurOf(s, _sc.date);              // 오늘 수업 시간(임시/보강/학생설정)
  const startMs = (kind==='end' && live[id]!=null) ? live[id] : plan;   // 하원인데 등원 기록 있으면 그 시각
  _sc={ id, kind, date: _sc.date, tab: kind==='both' ? 'start' : (kind==='start'?'start':'end'),
    start: startMs,
    end: (kind==='start') ? null : (startMs + dmin*60000) };
  buildSendConfirm();
  document.getElementById('scrim').classList.add('show');
}
function _defaultStart(id){
  const s=st(id); const k=_sc.date||dayKey(now.getTime());
  const t=todayTimeOf(s,k)||'16:00';     // 임시 추가 > 보강 > 요일표 (단일 소스)
  const [h,m]=t.split(':').map(Number); return _mkT(h, m);
}
/* 드래그 휠 한 줄 */
function _wheel(which){
  const ms=_sc[which]||Date.now(); const d=new Date(ms);
  const hIdx=Math.max(0, SC_H.indexOf(d.getHours()));
  const mIdx=Math.max(0, SC_M.indexOf(d.getMinutes()));
  const col=(items,label,idx,type)=>`<div class="sc-wheel" id="w_${which}_${type}" data-which="${which}" data-type="${type}"
      style="height:${SC_ITEM*3}px;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none;flex:1;text-align:center">
      <div style="height:${SC_ITEM}px"></div>
      ${items.map((v,i)=>`<div class="sc-op" data-v="${v}" style="height:${SC_ITEM}px;line-height:${SC_ITEM}px;scroll-snap-align:center;font-size:${i===idx?'20px':'15px'};font-weight:${i===idx?'600':'400'};color:${i===idx?'#633806':'#888780'}">${String(v).padStart(2,'0')}${label}</div>`).join('')}
      <div style="height:${SC_ITEM}px"></div>
    </div>`;
  return `<div style="position:relative;background:#F8F7F2;border:1px solid var(--line);border-radius:12px;overflow:hidden">
    <div style="position:absolute;left:8px;right:8px;top:50%;transform:translateY(-50%);height:${SC_ITEM}px;background:#FAEEDA;border-radius:9px;pointer-events:none"></div>
    <div style="position:relative;display:flex;gap:10px;padding:0 8px">${col(SC_H,'시',hIdx,'h')}${col(SC_M,'분',mIdx,'m')}</div>
  </div>`;
}
function buildSendConfirm(){
  const s=st(_sc.id), kind=_sc.kind;
  const title = kind==='start'?'등원' : kind==='end'?'하원' : '완료 (등원·하원)';
  const which = _sc.tab;
  let tabs='';
  if(kind==='both' || kind==='end'){
    const tb=(k,label,ms)=>`<button type="button" onclick="scTab('${k}')" style="flex:1;border-radius:9px;padding:9px 0;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;${_sc.tab===k?'background:var(--ink);color:#fff;border:none':'background:var(--card);color:var(--muted);border:1px solid var(--line)'}">${label} ${_hm(ms)}</button>`;
    tabs=`<div style="display:flex;gap:6px;margin-bottom:12px">${tb('start','등원',_sc.start)}${tb('end','하원',_sc.end)}</div>`;
  }
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} ${title}</h3>
    <div class="cap">시·분을 위아래로 드래그해서 맞추세요.</div>
    ${tabs}${_wheel(which)}
    <div id="scDur" style="font-size:11.5px;color:var(--muted);margin-top:8px;text-align:center"></div>
    <div style="font-size:12px;color:var(--muted);margin:14px 0 5px">보낼 내용</div>
    <div id="scPrev"></div>
    <button class="btn start" id="scGo" style="margin-top:14px" onclick="scSend()">설정하고 알림 보내기</button>
    <button class="btn ghost small" style="width:100%;margin-top:8px" onclick="scRecordOnly()">알림 없이 기록만</button>`;
  _wireWheel();
  scRefresh();
}
function scTab(k){ _sc.tab=k; buildSendConfirm(); }
/* 휠 스크롤 → 값 반영 */
function _wireWheel(){
  document.querySelectorAll('.sc-wheel').forEach(el=>{
    const items=[...el.querySelectorAll('.sc-op')];
    const type=el.dataset.type, which=el.dataset.which;
    const cur=new Date(_sc[which]||Date.now());
    const val = type==='h' ? cur.getHours() : cur.getMinutes();
    const idx=Math.max(0, items.findIndex(x=>+x.dataset.v===val));
    el.dataset.init='1';
    const put=()=>{ el.scrollTop = idx*SC_ITEM; };
    put(); requestAnimationFrame(put); setTimeout(()=>{ put(); el.dataset.init=''; }, 60);   // 시트가 그려진 뒤 확실히 맞춤
    items.forEach((it,j)=>{ it.style.cursor='pointer';
      it.addEventListener('click', ()=>{ el.scrollTo({top:j*SC_ITEM, behavior:'smooth'}); });
    });
    let t=null;
    el.addEventListener('scroll', ()=>{
      if(el.dataset.init==='1') return;      // 초기 위치 잡는 중이면 무시
      clearTimeout(t);
      t=setTimeout(()=>{
        const i=Math.round(el.scrollTop/SC_ITEM);
        const v=+(items[Math.max(0,Math.min(items.length-1,i))].dataset.v);
        const d=new Date(_sc[which]||Date.now());
        const h = type==='h' ? v : d.getHours();
        const m = type==='m' ? v : d.getMinutes();
        _sc[which]=_mkT(h,m);
        items.forEach((x,j)=>{ const on=j===i; x.style.fontSize=on?'20px':'15px'; x.style.fontWeight=on?'600':'400'; x.style.color=on?'#633806':'#888780'; });
        scRefresh();
      }, 140);   // 멈춘 뒤 확정 (휙 넘어감 방지)
    });
  });
}
/* 미리보기·수업분·탭라벨 갱신 (시트 재생성 없이) */
function scRefresh(){
  const s=st(_sc.id), kind=_sc.kind;
  const bad = (kind!=='start' && _sc.start && _sc.end && _sc.end<=_sc.start);
  const durMin=(_sc.start&&_sc.end)?Math.max(1,Math.round((_sc.end-_sc.start)/60000)):null;
  const dur=document.getElementById('scDur');
  if(dur) dur.innerHTML = kind==='start' ? '' :
    (bad?'<b style="color:var(--clay)">⚠ 하원이 등원보다 빨라요</b>':`수업 ${durMin}분 · 예정 ${durLabel(durOf(s))}`);
  const pv=document.getElementById('scPrev');
  if(pv){
    const one=(k,ms)=>`<div class="msg" style="white-space:pre-line">${buildNotifyTextAt(s,k,ms).replace(/</g,'&lt;')}</div>`;
    pv.innerHTML = kind==='start' ? one('start',_sc.start)
      : kind==='end' ? one('end',_sc.end)
      : one('start',_sc.start)+'<div style="height:6px"></div>'+one('end',_sc.end);
  }
  const go=document.getElementById('scGo'); if(go){ go.disabled=!!bad; go.style.opacity=bad?'.45':''; }
  document.querySelectorAll('.sc-wheel').forEach(()=>{});
  // 탭 라벨 시각 갱신
  const tabBtns=document.querySelectorAll('.sheet button[onclick^="scTab"]');
  if(tabBtns.length===2){ tabBtns[0].innerHTML=`등원 ${_hm(_sc.start)}`; tabBtns[1].innerHTML=`하원 ${_hm(_sc.end)}`; }
}
function scRecordOnly(){ const s=st(_sc.id), k=_sc.kind; _scApply(); closeSheet();
  showToast(`${s.name} ${k==='start'?'등원':'하원'} 기록 완료 (알림 없음)`); }
/* 설정하고 알림 보내기 — 카톡/문자는 학생 설정대로 자동 */
function scSend(){
  const id=_sc.id, kind=_sc.kind, s=st(id);
  _scApply();
  const g=guardiansOf(s)[0]||{};
  const kakao = g.kakao!==false;
  const kinds = kind==='start' ? ['start'] : kind==='end' ? ['end'] : ['start','end'];
  const on = kinds.filter(k=>sendOn(k));
  if(!on.length){ closeSheet(); showToast(`${s.name} 기록 완료 (알림 꺼짐)`); return; }
  const text = on.map(k=>buildNotifyTextAt(s,k, k==='start'?_sc.start:_sc.end)).join('\n');
  guardiansOf(s).forEach(gg=>logAdd(id, on[on.length-1], `${s.name} ${on.map(k=>k==='start'?'등원':'하원').join('+')} → ${gg.name}(${kakao?'카톡':'문자'})`));
  if((autoSend||autoSms) && fbFunctions){ closeSheet(); autoSendAll(id, on[on.length-1], text, guardiansOf(s)); return; }
  openMsgWith(id, text, kakao);
}
function _scApply(){
  const id=_sc.id;
  if(_sc.kind==='start'){ live[id]=_sc.start; ensureTicker(); }
  else {
    delete live[id]; complete(id, _sc.start, _sc.end);
    if(!Object.keys(live).length&&ticker){ clearInterval(ticker); ticker=null; }
    rolloverIfComplete(id);
  }
  saveData();
  refreshCurrentView();      // 지금 보고 있는 화면 갱신
}
function buildNotifyTextAt(s, kind, ms){
  const tpl=(msgTemplates[kind]&&msgTemplates[kind].sms)||'';
  const g=guardiansOf(s)[0]||{};
  const vars={ 학원명:academy.name||'', 원장명:academy.owner||'', 학생명:s.name,
    보호자명:g.name||'보호자', 시각:_hm(ms), 회차:String(doneCountOf(s)),
    금액:won(priceOf(s)).replace(/원$/,''), 내용:'' };
  const out=applyVars(tpl, vars).trim();
  return out || `[${academy.name||'On-study'}] ${s.name} 학생이 ${_hm(ms)}에 ${kind==='start'?'등원':'하원'}했습니다.`;
}

/* ===== 등원·하원 시간 수정 ===== */
function openTimeEdit(id){
  const s=st(id);
  const rec=sessions.find(x=>x.sid===id && dayKey(x.date)===dayKey(now.getTime()));
  const isLive=live[id]!=null;
  if(!rec && !isLive){ showToast('오늘 등원 기록이 없어요'); return; }
  const startMs = isLive ? live[id] : (rec&&rec.start);
  const endMs = rec&&rec.end;
  const v=(ms)=> ms? new Date(ms).toTimeString().slice(0,5) : '';
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 시간 수정</h3>
    <div class="cap">실제 등원·하원 시각으로 고칠 수 있어요. ${isLive?'아직 수업 중이라 등원 시각만 고칩니다.':''}</div>
    <div class="fld"><label>등원 시각</label>
      <input type="time" id="teStart" class="note-select" value="${v(startMs)}"></div>
    ${isLive?'':`<div class="fld"><label>하원 시각</label>
      <input type="time" id="teEnd" class="note-select" value="${v(endMs)}"></div>`}
    <div class="sheet-btns">
      <button class="btn start" onclick="saveTimeEdit(${id})">저장</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function saveTimeEdit(id){
  const s=st(id);
  const base=dayKey(now.getTime());
  const toMs=(hhmm)=>{ if(!hhmm) return null; const [h,m]=hhmm.split(':').map(Number);
    const d=new Date(base); d.setHours(h,m,0,0); return d.getTime(); };
  const sv=(document.getElementById('teStart')||{}).value||'';
  const evEl=document.getElementById('teEnd');
  const ev=evEl?evEl.value:'';
  if(!sv){ showToast('등원 시각을 입력해주세요'); return; }
  const startMs=toMs(sv), endMs=ev?toMs(ev):null;
  if(endMs && endMs<=startMs){ showToast('하원 시각이 등원 시각보다 빨라요'); return; }
  if(live[id]!=null) live[id]=startMs;                       // 수업 중이면 등원 시각만
  const rec=sessions.find(x=>x.sid===id && dayKey(x.date)===base);
  setSessionTimes(rec, startMs, endMs);      // 수업 분까지 함께 갱신(단일 함수)
  saveData(); closeSheet();
  refreshCurrentView();      // 지금 보고 있는 화면(출석부/전체일정/학생 등) 갱신
  showToast(`${s.name} 시간을 ${sv}${ev?'~'+ev:''}로 고쳤어요`);
}

/* ===== 안내문 보내기 (학생별 · 직접 작성) ===== */
function pickNoticeCh(kakao){
  const sheet=document.getElementById('sheet');
  sheet.dataset.ntKakao = kakao?'1':'0';
  const a=document.getElementById('ntKakao'), b=document.getElementById('ntSms');
  if(a) a.classList.toggle('on', kakao);
  if(b) b.classList.toggle('on', !kakao);
}
function insertNoticeVar(name){
  const ta=document.getElementById('noticeText'); if(!ta) return;
  const st_=ta.selectionStart||ta.value.length, en=ta.selectionEnd||st_;
  ta.value=ta.value.slice(0,st_)+'{'+name+'}'+ta.value.slice(en);
  ta.focus(); ta.selectionStart=ta.selectionEnd=st_+name.length+2;
}
function openNoticeSheet(id){
  const s=st(id);
  const gs=guardiansOf(s); const g=gs[0]||{};
  const kakaoDefault = g.kakao!==false;
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 안내문 보내기</h3>
    <div class="cap">보호자에게 보낼 내용을 직접 작성하세요. ${gs.length>1?`보호자 ${gs.length}명 모두에게 보냅니다.`:`받는 사람: <b>${g.name||'보호자'}</b> ${g.phone||''}`}</div>
    <div class="fld"><label>보내는 방법</label>
      <div class="seg2">
        <button type="button" id="ntKakao" class="${kakaoDefault?'on':''}" onclick="pickNoticeCh(true)">카카오톡</button>
        <button type="button" id="ntSms" class="${kakaoDefault?'':'on'}" onclick="pickNoticeCh(false)">문자</button>
      </div></div>
    <div class="fld"><label>내용</label>
      <textarea id="noticeText" rows="6" placeholder="예: 이번 주 금요일은 학원 사정으로 휴강합니다. 보강일은 개별 안내드리겠습니다."
        style="width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:11px;font-family:inherit;font-size:14px;line-height:1.6;background:#fff"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${['학생명','보호자명','학원명','원장명'].map(v=>`<button type="button" onclick="insertNoticeVar('${v}')" style="border:1px solid var(--line);background:#F7F6F1;border-radius:20px;padding:5px 10px;font-size:12px;color:var(--ink);cursor:pointer;font-family:inherit">＋ ${v}</button>`).join('')}
      </div></div>
    <div class="sheet-btns">
      <button class="btn start" onclick="sendNotice(${id})">보내기</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  sheet.dataset.ntKakao = kakaoDefault?'1':'0';
  document.getElementById('scrim').classList.add('show');
}
function sendNotice(id){
  const s=st(id);
  const sheet=document.getElementById('sheet');
  const raw=(document.getElementById('noticeText')||{}).value||'';
  if(!raw.trim()){ showToast('보낼 내용을 적어주세요'); return; }
  const kakao = sheet.dataset.ntKakao==='1';
  const g=guardiansOf(s)[0]||{};
  const text=applyVars(raw.trim(), {학생명:s.name, 보호자명:g.name||'보호자',
    학원명:academy.name||'', 원장명:academy.owner||''});
  logAdd(id,'pay',`${s.name} 안내문 (${kakao?'카톡':'문자'}) → ${g.name||'보호자'}`);
  // 자동 발송이 켜져 있으면 서버로, 아니면 메시지 앱 열기
  if((autoSend||autoSms) && fbFunctions){
    closeSheet();
    autoSendAll(id, 'guide', text, guardiansOf(s));
    return;
  }
  openMsgWith(id, text, kakao);
}

function askDeleteStudent(id){
  const s=st(id);
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 삭제</h3>
    <div class="cap">이 학생과 관련된 출결·정산 표시가 목록에서 사라집니다. 되돌릴 수 없어요.</div>
    <div class="sheet-btns"><button class="btn pay" onclick="deleteStudent(${id})">삭제</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function deleteStudent(id){
  const i=students.findIndex(s=>s.id===id); if(i>=0)students.splice(i,1);
  delete cycleDone[id];
  bills = bills.filter(b=>b.sid!==id);            // 정산 건 정리
  delete packHistory[id]; delete absentLog[id]; delete makeupLog[id]; delete skipLog[id];
  saveData(); closeSheet(); renderManage(); showToast('학생을 삭제했어요');
}

/* ===== 전체 일정 (모든 학생 스케줄) ===== */
let schedCur=null, schedSel=null;
// 특정 날짜(ms, 00:00)에 수업 예정인 학생들
// 그 날짜가 오늘이면 '오늘만 추가(임시)' 학생도 포함 → 출석부와 인원이 항상 같음
function isTempOn(s, ms){ return isMakeupDay(s, dayKey(ms)); }   // 호환용 별칭
function studentsOnDate(ms){
  const d=new Date(ms), dow=d.getDay(), k=dayKey(ms);
  return students.filter(s=> isClassDay(s,k) && !beforeStart(s,ms))
    .sort((a,b)=> (todayTimeOf(a,k)||'').localeCompare(todayTimeOf(b,k)||''));
}
function schedNav(delta){ schedCur.setMonth(schedCur.getMonth()+delta); schedSel=null; renderSchedule(); }
function pickSchedDay(ms){ schedSel=ms; renderSchedule(); }
function renderSchedule(){
  const el=document.getElementById('v-schedule');
  const todayMs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  if(!schedCur) schedCur=new Date(now.getFullYear(), now.getMonth(), 1);
  if(schedSel==null) schedSel=todayMs;   // 진입 시 오늘 자동 선택
  const y=schedCur.getFullYear(), m=schedCur.getMonth();
  const first=new Date(y,m,1), startDow=first.getDay(), dim=new Date(y,m+1,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+=`<div class="sc-cell empty"></div>`;
  for(let dd=1;dd<=dim;dd++){
    const ms=new Date(y,m,dd).getTime();
    const n=studentsOnDate(ms).length;
    const cls=[ms===todayMs?'today':'', ms===schedSel?'sel':'', n?'has':''].join(' ');
    cells+=`<div class="sc-cell ${cls}" onclick="pickSchedDay(${ms})">
      <span class="sc-d">${dd}</span>${n?`<span class="sc-n">${n}</span>`:''}</div>`;
  }
  const dows=['일','월','화','수','목','금','토'].map(w=>`<div class="sc-dow">${w}</div>`).join('');
  let listHtml='';
  if(schedSel!=null){
    const list=studentsOnDate(schedSel), sd=new Date(schedSel);
    const isToday = sd.toDateString()===now.toDateString();
    const dayTitle = `${sd.getMonth()+1}월 ${sd.getDate()}일 ${WD[sd.getDay()]}요일${isToday?' · 오늘':''}`;
    listHtml=`<div class="block"><div class="block-h"><span class="h">${dayTitle}</span>${list.length?`<span class="cnt">${list.length}</span>`:''}</div>`+
      (list.length? list.map(s=>{
        const t=timeFor(s,sd.getDay());
        const rec=sessions.find(x=>x.sid===s.id && new Date(x.date).toDateString()===sd.toDateString());
        const inTime = rec&&rec.start ? hm(rec.start) : (isToday && live[s.id]!=null ? hm(live[s.id]) : '');
        const outTime = rec&&rec.end ? hm(rec.end) : '';
        const abs=(absentLog[s.id]||[]).some(x=>new Date(x).toDateString()===sd.toDateString());
        const isLiveNow = isToday && live[s.id]!=null && !rec;
        let statusHtml, timeLine;
        if(abs){
          statusHtml=`<span style="color:#D9342B;border:1.6px solid #D9342B;border-radius:999px;padding:3px 12px;font-weight:800;font-size:12px">결석</span>`;
          timeLine='결석 처리됨';
        } else if(rec){
          statusHtml=`<span class="contract" style="color:var(--green);font-weight:700">하원 완료</span>`;
          timeLine=(inTime||outTime) ? `등원 ${inTime||'—'} · 하원 ${outTime||'—'}` : '수업 완료 (시각 기록 없음)';
        } else if(isLiveNow){
          statusHtml=`<span class="contract" style="color:var(--amber);font-weight:700">수업 중</span>`;
          timeLine=`등원 ${inTime||'—'} · 수업 중`;
        } else {
          statusHtml=`<span class="contract">예정 ${t}</span>`;
          timeLine=`예정 시간 ${t}`;
        }
        const gLine = guardiansOf(s).map(g=>`${g.name}${g.phone?' '+g.phone:''}`).join(', ');
        return `<div class="row" style="padding:12px 14px${abs?';border:1.6px solid #D9342B':''}">
          <div class="row-top"><span class="name">${s.name}${isMakeupDay(s,dayKey(schedSel))?' <span style="font-size:11px;font-weight:600;color:#fff;background:#6B4FBB;border-radius:6px;padding:2px 7px;vertical-align:middle">보강</span>':''}</span>${statusHtml}</div>
          <div class="mg-line">🕐 ${timeLine}</div>
          <div class="mg-line">👤 ${gLine} · ${s.plan}회 중 ${doneCountOf(s)}회</div>
          <div class="row-btns" style="margin-top:9px">
            <button class="btn ghost small" onclick="toggleSchedCal(${s.id})">${schedCal.open===s.id?'달력 닫기 ▲':'달력 보기 ▾'}</button>
            ${abs?`<button class="btn ghost small" onclick="clearAbsentFrom(${s.id},${schedSel})">결석 취소</button>`:''}
          </div>
          ${schedCal.open===s.id ? buildCalendar(s, schedCal, `schedCalNav(${s.id},-1)`, `schedCalNav(${s.id},1)`) : ''}
        </div>`;}).join('')
        : `<div class="muted-card">이 날은 예정된 수업이 없어요.</div>`)+`</div>`;
  }
  el.innerHTML=`<button class="back" onclick="goTab('home')">‹ 홈</button>
    <h2 class="page-h">전체 일정</h2>
    <p class="page-cap">오늘 와야 할 학생과 등원·하원 현황이에요. 날짜를 눌러 다른 날도 볼 수 있어요.</p>
    <div class="sc-cal">
      <div class="sc-head"><button onclick="schedNav(-1)">‹</button>
        <span>${y}년 ${m+1}월</span><button onclick="schedNav(1)">›</button></div>
      <div class="sc-grid">${dows}${cells}</div>
    </div>
    ${listHtml}
    ${schedMakeupBox(schedSel)}`;
}
/* 전체 일정: 그 날짜의 보강 목록 + 바로 등록 */
function schedMakeupBox(selMs){
  if(selMs==null) return '';
  const k=dayKey(selMs);
  const onDate=studentsOnDate(k);
  const mkList=students.filter(x=>makeupOn(x.id,k));
  const cand=students.filter(x=>!onDate.some(y=>y.id===x.id));
  const mkHtml = mkList.length ? mkList.map(x=>{ const mk=makeupOn(x.id,k)||{};
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#EAE3F7;border-radius:9px;padding:8px 10px;margin-bottom:6px">
        <span style="font-size:13px;color:#4A3690"><b>${x.name}</b> · ${mk.time||'-'}${mk.time?'~'+endTimeOf(mk.time, mk.dur||durOf(x)):''} · ${durLabel(mk.dur||durOf(x))}</span>
        <button onclick="askRemoveMakeup(${x.id},${k})" style="border:none;background:#fff;border-radius:7px;padding:4px 9px;font-size:12px;color:#A32D2D;cursor:pointer;font-family:inherit;font-weight:600">✕ 빼기</button>
      </div>`; }).join('') : '';
  return `<div class="add-wrap" style="margin-top:14px"><div class="add-title">${fmtMD(k)} 보강 추가</div>
    <div class="add-desc">이 날 하루만 오는 학생을 골라 넣어요. 정규 요일표는 그대로고, <b>회차·예상 종료일에 반영</b>돼요.</div>
    ${mkHtml?`<div style="margin-bottom:10px"><div style="font-size:12px;color:var(--muted);margin-bottom:6px">이 날 보강</div>${mkHtml}</div>`:''}
    ${cand.length?`<div class="chips">`+cand.map(x=>`<button class="chip" onclick="addTemp(${x.id},${k})">＋ ${x.name}</button>`).join('')+`</div>`
      :`<div class="add-desc" style="margin:0">추가할 수 있는 다른 학생이 없어요.</div>`}</div>`;
}

/* ===== 학원 관리 (기본 정보) ===== */
function renderAcademy(){
  const el=document.getElementById('v-academy');
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">학원 관리</h2>
    <p class="page-cap">학원 기본 정보를 입력하고 저장하세요.</p>
    <div class="set-sec">
      <div class="fld"><label>학원명</label><input id="acName" class="note-select" value="${academy.name||''}" placeholder="○○학원"></div>
      <div class="fld"><label>원장명</label><input id="acOwner" class="note-select" value="${academy.owner||''}" placeholder="원장 이름"></div>
      <div class="fld"><label>대표 전화</label><input id="acPhone" class="note-select" value="${academy.phone||''}" placeholder="010-0000-0000"></div>
      <button class="btn start" style="margin-top:6px" onclick="setAcademy()">저장</button>
    </div>
    <div class="set-sec">
      <h3>알림톡 자동 발송</h3>
      <div class="cap">켜면 <b>카카오 알림톡으로 자동 발송</b>합니다. 발송 서버·템플릿 승인이 완료돼야 실제로 나갑니다. 준비 전에는 꺼두세요.</div>
      <div class="seg2" style="margin-top:8px">
        <button type="button" class="${autoSend?'on':''}" onclick="setAutoSend(true)">알림톡 켜기</button>
        <button type="button" class="${!autoSend?'on':''}" onclick="setAutoSend(false)">끄기</button>
      </div>
    </div>
    <div class="set-sec">
      <h3>문자 자동 발송</h3>
      <div class="cap">켜면 <b>문자(SMS/LMS)로 자동 발송</b>합니다. 알림톡도 켜져 있으면 <b>알림톡 우선 → 실패 시 문자로 대체</b>됩니다. 발신번호 사전등록이 완료돼야 실제로 나갑니다.</div>
      <div class="seg2" style="margin-top:8px">
        <button type="button" class="${autoSms?'on':''}" onclick="setAutoSms(true)">문자 켜기</button>
        <button type="button" class="${!autoSms?'on':''}" onclick="setAutoSms(false)">끄기</button>
      </div>
      <div class="cap" style="margin-top:8px">${(!autoSend&&!autoSms)?'지금은 <b>둘 다 꺼짐</b> — 버튼을 누르면 기존처럼 문자/카톡 앱을 <b>열어드립니다</b>(원장님이 직접 전송).':''}</div>
    </div>
    <div class="set-sec">
      <h3>항목별 발송 켜기 / 끄기</h3>
      <div class="cap">보내고 싶은 알림만 켜두세요. <b>끈 항목은 자동 발송도, 메시지 열기도 하지 않습니다</b>(기록만 남아요).</div>
      ${MSG_KINDS.map(([k,label])=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)">
          <span style="font-size:14px;font-weight:600">${label}</span>
          <div class="seg2" style="width:auto;margin:0">
            <button type="button" class="${sendOn(k)?'on':''}" style="padding:6px 14px;font-size:13px" onclick="toggleSendKind('${k}')">켜짐</button>
            <button type="button" class="${!sendOn(k)?'on':''}" style="padding:6px 14px;font-size:13px" onclick="toggleSendKind('${k}')">꺼짐</button>
          </div>
        </div>`).join('')}
    </div>`;
}
function setAutoSend(v){ autoSend=!!v; saveData(); renderAcademy(); showToast(v?'알림톡 자동 발송 켜짐':'알림톡 자동 발송 꺼짐'); }
function setAutoSms(v){ autoSms=!!v; saveData(); renderAcademy(); showToast(v?'문자 자동 발송 켜짐':'문자 자동 발송 꺼짐'); }
function toggleSendKind(k){ sendKinds[k]=!sendOn(k); saveData(); renderAcademy();
  const label=(MSG_KINDS.find(x=>x[0]===k)||[])[1]||k;
  showToast(`${label} 알림 ${sendOn(k)?'켜짐':'꺼짐'}`); }
function setAcademy(){
  academy={
    name:(document.getElementById('acName')||{}).value?.trim()||'',
    owner:(document.getElementById('acOwner')||{}).value?.trim()||'',
    phone:(document.getElementById('acPhone')||{}).value?.trim()||''
  };
  saveData(); showToast('학원 정보를 저장했어요');
}

/* ===== 수업 관리 (휴일 등록) ===== */
let classCal=null;
function classCalNav(delta){ classCal.m+=delta; if(classCal.m<0){classCal.m=11;classCal.y--;} if(classCal.m>11){classCal.m=0;classCal.y++;} renderClassMgmt(); }
function clickHoliday(ms){ toggleHoliday(ms); renderClassMgmt(); }
function renderClassMgmt(){
  const el=document.getElementById('v-classmgmt');
  if(!classCal) classCal={y:now.getFullYear(), m:now.getMonth()};
  const y=classCal.y, m=classCal.m;
  const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
  const todayK=dayKey(now.getTime());
  const dows=['일','월','화','수','목','금','토'].map(w=>`<div class="sc-dow">${w}</div>`).join('');
  let cells='';
  for(let i=0;i<first;i++) cells+=`<div class="sc-cell empty"></div>`;
  for(let dd=1;dd<=dim;dd++){
    const ms=new Date(y,m,dd).getTime(), k=dayKey(ms);
    const hol=isHoliday(k), fname=fixedHolidayName(k), wk=!!workdaysExtra[k];
    const bg = hol ? 'background:#F6E3DE;' : (wk?'background:#E7F1EA;':'');
    cells+=`<div class="sc-cell${k===todayK?' today':''}" style="cursor:pointer;${bg}" onclick="clickHoliday(${ms})">
      <span class="sc-d" style="${hol?'color:var(--clay);font-weight:700':(wk?'color:var(--green);font-weight:700':'')}">${dd}</span>
      ${fname?`<span style="font-size:9px;line-height:1;color:var(--clay)">${fname}</span>`:''}
      ${wk?`<span style="font-size:9px;line-height:1;color:var(--green)">수업</span>`:''}</div>`;
  }
  const extraHolidays=Object.keys(holidaysExtra).map(Number).filter(k=>holidaysExtra[k]).sort((a,b)=>a-b);
  const extraTxt = extraHolidays.length
    ? extraHolidays.map(k=>{const d=new Date(k);return `${d.getMonth()+1}.${d.getDate()}`;}).join(', ')
    : '없음';
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">휴일 관리</h2>
    <p class="page-cap">날짜를 눌러 <b>휴일 ↔ 수업일</b>을 지정해요. 토·일·공휴일은 기본 휴일이고, 누르면 '수업일'로 바꿀 수 있어요.
      휴일은 <b>모든 학생 회차 계산에서 제외</b>돼 그날을 건너뛰고 종료일이 밀립니다.
      설날·추석·석가탄신일 등 음력 명절은 자동이 아니라 직접 휴일로 지정하세요.</p>
    <div class="sc-cal">
      <div class="sc-head"><button onclick="classCalNav(-1)">‹</button>
        <span>${y}년 ${m+1}월</span><button onclick="classCalNav(1)">›</button></div>
      <div class="sc-grid">${dows}${cells}</div>
    </div>
    <div class="cal-legend" style="margin-top:12px">
      <span><i class="lg" style="background:#F6E3DE"></i>휴일</span>
      <span><i class="lg" style="background:#E7F1EA"></i>수업일 지정(공휴일 해제)</span>
      <span><i class="lg tod"></i>오늘</span></div>
    <div class="cal-foot" style="margin-top:14px">
      <div class="cf-row"><span class="cf-k">직접 지정한 휴일</span><span class="cf-v">${extraTxt}</span></div>
    </div>`;
}

/* ===== 데이터 점검 — 잘못 만들어진 지난 클래스/정산 찾기 ===== */
/* 두 클래스의 종료일 사이에 실제 수업 가능일이 회차보다 적으면 = 있을 수 없는 기록 */
function findBadHistory(){
  const out=[];
  students.forEach(s=>{
    const hist=(packHistory[s.id]||[]).slice().sort((a,b)=>(a.end||0)-(b.end||0));
    for(let i=1;i<hist.length;i++){
      const prev=hist[i-1], cur=hist[i];
      if(!prev.end || !cur.end) continue;
      const need=cur.done||cur.plan||0;
      let can=0;
      for(let t=prev.end+86400000; t<=cur.end; t+=86400000){ if(isSessionDay(s, dayKey(t))) can++; }
      if(can < need){
        const bill=bills.find(b=>b.sid===s.id && dayKey(b.endDate)===dayKey(cur.end));
        out.push({sid:s.id, name:s.name, no:cur.no, prevEnd:prev.end, curEnd:cur.end,
          need, can, amount:cur.amount||(bill?bill.amount:0), billId:bill?bill.id:null, paid:bill?!!bill.paid:false});
      }
    }
  });
  return out;
}
/* 잘못된 차수 + (선택) 그 정산건 삭제 */
function fixBadHistory(sid, no, withBill){
  const s=st(sid);
  const hist=packHistory[sid]||[];
  const i=hist.findIndex(h=>h.no===no);
  if(i<0){ showToast('이미 정리된 기록이에요'); return; }
  const h=hist[i];
  if(withBill){
    const bi=bills.findIndex(b=>b.sid===sid && dayKey(b.endDate)===dayKey(h.end));
    if(bi>=0) bills.splice(bi,1);
    const pi=payments.findIndex(p=>p.sid===sid && p.date && dayKey(p.date)===dayKey(h.settledDate||h.end));
    if(pi>=0) payments.splice(pi,1);
  }
  hist.splice(i,1);
  hist.sort((a,b)=>(a.end||0)-(b.end||0)).forEach((x,j)=>x.no=j+1);   // 차수 다시 매기기
  saveData(); closeSheet(); renderDataCheck();
  showToast(`${s.name} ${no}차 기록을 정리했어요`);
}
function askFixBad(sid, no){
  const b=findBadHistory().find(x=>x.sid===sid && x.no===no);
  if(!b){ renderDataCheck(); return; }
  const s=st(sid);
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} ${no}차 기록 정리</h3>
    <div class="cap">이 기록은 <b>${fmtD(b.prevEnd)}</b>에 앞 클래스가 끝난 뒤
      <b>${fmtD(b.curEnd)}</b>까지 <b>${b.need}회</b>를 했다고 되어 있는데,
      그 사이 실제 수업 가능일은 <b>${b.can}일</b>뿐이라 있을 수 없는 기록이에요.</div>
    <div class="msg">정산 ${won(b.amount||0)} · ${b.paid?'<b>받음</b>으로 표시됨':'미납'}</div>
    <div class="cap" style="margin-top:10px">실제로 이 학생에게 <b>수업료를 한 번 더 받으셨나요?</b></div>
    <div class="sheet-btns" style="flex-direction:column;gap:8px">
      <button class="btn pay" style="width:100%" onclick="fixBadHistory(${sid},${no},true)">아니요 · 기록과 정산 모두 삭제</button>
      <button class="btn ghost" style="width:100%" onclick="fixBadHistory(${sid},${no},false)">받았어요 · 정산은 두고 기록만 삭제</button>
      <button class="btn sms" style="width:100%" onclick="closeSheet()">취소</button>
    </div>`;
  document.getElementById('scrim').classList.add('show');
}
function renderDataCheck(){
  const el=document.getElementById('v-datacheck');
  const bad=findBadHistory();
  const sum=bad.reduce((a,b)=>a+(b.amount||0),0);
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">데이터 점검</h2>
    <p class="page-cap">지난 클래스·정산 기록 중 <b>있을 수 없는 것</b>을 찾아드려요.
      예전 자동 넘김(롤오버) 오류나 등록 시 이전 기록이 부정확했던 경우 생깁니다.</p>
    ${bad.length? `<div class="sum" style="margin-bottom:14px">
        <div class="k">이상한 기록</div><div class="big num">${bad.length}건</div>
        <div class="split"><div><div class="k">관련 정산액</div><div class="v">${won(sum)}</div></div>
          <div><div class="k">확인 필요</div><div class="v" style="color:var(--clay)">원장님 판단</div></div></div>
      </div>`
      : `<div class="muted-card" style="border-color:var(--green)">✅ 이상한 기록이 없어요. 데이터가 깨끗합니다.</div>`}
    ${bad.map(b=>`<div class="row" style="border:1.6px solid var(--clay)">
      <div class="row-top"><span class="name">${b.name} · ${b.no}차</span>
        <span class="amt">${won(b.amount||0)}</span></div>
      <div class="mg-line">📅 앞 클래스 종료 <b>${fmtD(b.prevEnd)}</b> → 이 클래스 종료 <b>${fmtD(b.curEnd)}</b></div>
      <div class="mg-line" style="color:var(--clay)">⚠ ${b.need}회가 필요한데 그 사이 수업 가능일은 <b>${b.can}일</b>뿐</div>
      <div class="mg-line">💰 정산 ${b.paid?'<b style="color:var(--green)">받음</b>':'미납'}</div>
      <div class="row-btns" style="margin-top:11px">
        <button class="btn settle small" onclick="askFixBad(${b.sid},${b.no})">정리하기</button>
        <button class="btn ghost small" onclick="goTab('manage')">학생 수정</button>
      </div></div>`).join('')}
    <div class="set-sec" style="margin-top:20px">
      <h3>회차가 실제와 다르면</h3>
      <div class="cap">학생 관리 → 해당 학생 <b>수정</b> → <b>현재 회차</b>에 오늘 기준 실제 회차를 넣으세요.
        그 값이 기준이 되고, 이후에는 등원을 누른 만큼만 올라갑니다.
        <b>이번 회차 시작일</b>도 함께 넣으면 기간이 정확해져요.</div>
      <button class="btn ghost" onclick="goTab('manage')">학생 관리로 가기</button>
    </div>`;
}

function renderPayhist(){
  const el=document.getElementById('v-payhist');
  const all=payments.slice().sort((a,b)=>b.date-a.date);
  const total=all.reduce((a,p)=>a+p.amount,0);
  const yr=now.getFullYear();
  const yearSum=all.filter(p=>p.date.getFullYear()===yr).reduce((a,p)=>a+p.amount,0);
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">정산 내역</h2>
    <div class="sum"><div class="k">${yr}년 정산 합계</div><div class="big num">${won(yearSum)}</div>
      <div class="split"><div><div class="k">전체 누적</div><div class="v">${won(total)}</div></div>
        <div><div class="k">건수</div><div class="v">${all.length}건</div></div></div></div>
    ${all.length? all.map(p=>{const s=st(p.sid);
      return `<div class="row"><div class="row-top">
        <span class="name">${s?s.name:'(삭제된 학생)'}</span>
        <span class="amt">${won(p.amount)}</span></div>
        <div class="mg-line">${p.date.getFullYear()}.${p.date.getMonth()+1}.${p.date.getDate()} · ${p.plan}회권 정산</div>
      </div>`;}).join('')
     : `<div class="muted-card">아직 정산 내역이 없어요.</div>`}`;
}

/* 알림 문구 화면: 항목별 접이식(아코디언) */
let guideOpen=new Set(), guideAdv=new Set();
function toggleGuide(k){ if(guideOpen.has(k))guideOpen.delete(k); else guideOpen.add(k); renderGuide(); }
function toggleGuideAdv(k){ if(guideAdv.has(k))guideAdv.delete(k); else guideAdv.add(k); renderGuide(); }
function guideVars(k){
  const base=['학원명','원장명','학생명','보호자명'];
  if(k==='start'||k==='end') return [...base,'시각'];
  if(k==='absent') return [...base,'시각'];
  if(k==='settle') return [...base,'완료안내','기간','시작일','종료일','회차','금액'];
  return [...base,'내용','회차'];
}
function insertVar(k,name){
  const ta=document.getElementById('tpl_'+k); if(!ta) return;
  const st_=ta.selectionStart||ta.value.length, en=ta.selectionEnd||st_;
  ta.value=ta.value.slice(0,st_)+'{'+name+'}'+ta.value.slice(en);
  ta.focus(); ta.selectionStart=ta.selectionEnd=st_+name.length+2;
  livePreview(k);
}
function livePreview(k){
  const ta=document.getElementById('tpl_'+k); if(!ta) return;
  const vars=Object.assign({}, VAR_EXAMPLE, {학원명:academy.name||VAR_EXAMPLE.학원명, 원장명:academy.owner||VAR_EXAMPLE.원장명});
  const pv=document.getElementById('pv_'+k); if(pv) pv.textContent=applyVars(ta.value, vars);
  const kk=document.getElementById('kk_'+k); if(kk) kk.textContent=toKakaoTemplate(ta.value);
}
function renderGuide(){
  const el=document.getElementById('v-guide');
  const vars=(k)=>Object.assign({}, VAR_EXAMPLE, {학원명:academy.name||VAR_EXAMPLE.학원명, 원장명:academy.owner||VAR_EXAMPLE.원장명});
  const cards = MSG_KINDS.map(([k,label])=>{
    const sms=(msgTemplates[k]&&msgTemplates[k].sms)||'';
    const code=(msgTemplates[k]&&msgTemplates[k].code)||'';
    const open=guideOpen.has(k), adv=guideAdv.has(k);
    const on=sendOn(k);
    const oneLine=applyVars(sms, vars(k)).split('\n')[0].slice(0,42)+(sms.length>42?'…':'');
    const head=`<button onclick="toggleGuide('${k}')" style="width:100%;display:flex;align-items:center;gap:10px;background:none;border:none;padding:14px 16px;cursor:pointer;font-family:inherit;text-align:left">
      <span style="font-size:15px;font-weight:700;color:var(--ink);white-space:nowrap">${label}</span>
      <span style="font-size:11px;font-weight:600;border-radius:6px;padding:2px 7px;${on?'background:#E7F1EA;color:#2F7A4F':'background:#F1EFE8;color:#9A988F'}">${on?'보냄':'끔'}</span>
      <span style="flex:1;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${oneLine||'문구 없음'}</span>
      <span style="color:var(--muted);font-size:13px">${open?'▲':'▾'}</span>
    </button>`;
    const body = open ? `<div style="padding:0 16px 16px">
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:6px">보낼 내용 — 아래 <b>＋ 버튼</b>을 눌러 학생 이름 같은 값을 넣을 수 있어요.</div>
      <textarea id="tpl_${k}" rows="5" style="width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:11px;font-family:inherit;font-size:14px;line-height:1.6;background:#fff"
        oninput="livePreview('${k}')" onchange="setMsgTemplate('${k}')">${sms.replace(/</g,'&lt;')}</textarea>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${guideVars(k).map(v=>`<button onclick="insertVar('${k}','${v}')" style="border:1px solid var(--line);background:#F7F6F1;border-radius:20px;padding:5px 10px;font-size:12px;color:var(--ink);cursor:pointer;font-family:inherit">＋ ${v}</button>`).join('')}
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin:12px 0 5px">이렇게 나가요 (예시)</div>
      <div id="pv_${k}" style="background:#F7F6F1;border-radius:10px;padding:11px 13px;font-size:13.5px;line-height:1.65;white-space:pre-line;color:var(--ink)">${applyVars(sms, vars(k)).replace(/</g,'&lt;')}</div>
      <button onclick="toggleGuideAdv('${k}')" style="margin-top:10px;background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;font-family:inherit;padding:4px 0">${adv?'▲ 카카오 알림톡 설정 접기':'▾ 카카오 알림톡 설정 (나중에)'}</button>
      ${adv?`<div style="border-top:1px dashed var(--line);margin-top:8px;padding-top:10px">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:5px">카카오에 심사 신청할 때 아래 문구를 그대로 제출하세요.</div>
        <div id="kk_${k}" style="background:#FAF7EE;border-radius:10px;padding:10px 12px;font-size:12.5px;white-space:pre-line;color:#6B5A32">${toKakaoTemplate(sms).replace(/</g,'&lt;')}</div>
        <button class="btn ghost small" style="width:auto;margin-top:7px;padding:7px 12px;font-size:12px" onclick="copyKakaoTpl('${k}')">문구 복사</button>
        <div style="margin-top:9px"><label style="font-size:12.5px;color:var(--muted)">심사 통과 후 받은 템플릿 코드</label>
          <input id="code_${k}" value="${code}" placeholder="예: ONSTUDY_${k.toUpperCase()}" onchange="setMsgTemplate('${k}')"
            style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:10px;font-family:inherit;font-size:13px;margin-top:4px;background:#fff"></div>
      </div>`:''}
    </div>` : '';
    return `<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:9px;overflow:hidden">${head}${body}</div>`;
  }).join('');

  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">알림 문구</h2>
    <p class="page-cap">학부모에게 나가는 문구를 정해요. 항목을 눌러 펼치고 고치면 <b>바로 반영</b>됩니다.
      보낼지 말지는 <b>학원 관리 → 항목별 발송</b>에서 켜고 끕니다.</p>
    <div style="max-width:640px">${cards}</div>
    <div class="block-h" style="margin-top:26px"><span class="h">학습 안내(결과지) 보내기</span></div>
    <p class="page-cap" style="margin-top:-4px">학생별로 이번 회차·이번 주 학습 내용을 정리해 보냅니다.</p>
    <div style="max-width:640px">
    ${students.map(s=>{
      const cnt=monthCount(s.id);
      return `<div class="row">
        <div class="row-top"><span class="name">${s.name}</span>
          <span class="contract">${cnt}회 · ${s.plan}회권</span></div>
        <div class="row-btns" style="margin-top:11px">
          <button class="btn start small" onclick="openGuide(${s.id},'pack')">이번 회차 결과지</button>
          <button class="btn ghost small" onclick="openGuide(${s.id},'week')">이번 주</button>
        </div></div>`;
    }).join('')}
    </div>`;
}
function setMsgTemplate(k){
  const cur=msgTemplates[k]||{sms:'',code:''};
  const taEl=document.getElementById('tpl_'+k);
  const codeEl=document.getElementById('code_'+k);
  const sms = taEl ? taEl.value : cur.sms;        // 입력칸이 없으면(접힘) 기존 값 유지
  const code = codeEl ? codeEl.value : cur.code;
  msgTemplates[k]={ sms:String(sms).trim(), code:String(code).trim() };
  const kk=document.getElementById('kk_'+k); if(kk) kk.textContent=toKakaoTemplate(sms);
  saveData(); showToast('문구를 저장했어요');
}
function copyKakaoTpl(k){
  const txt=toKakaoTemplate((msgTemplates[k]&&msgTemplates[k].sms)||'');
  if(navigator.clipboard) navigator.clipboard.writeText(txt).then(()=>showToast('카톡 템플릿을 복사했어요')).catch(()=>showToast('복사 실패 — 길게 눌러 복사하세요'));
  else showToast('복사 미지원 — 길게 눌러 복사하세요');
}
function composeGuide(sid,mode){
  const s=st(sid);
  const inWk=(d)=>d>=weekStart();
  const ls=lessons.filter(l=>l.sid===sid && (mode==='week'?inWk(l.date):true)).sort((a,b)=>a.date-b.date);
  const period = mode==='week' ? '이번 주' : `이번 회차 (${s.plan}회)`;
  const cnt = mode==='week' ? ls.length : monthCount(sid);
  let body=`[On-study 학습 안내]\n${s.name} 학생 · ${period}\n\n○ 출석 ${cnt}회`;
  if(ls.length){ body+=`\n\n○ 학습 내용`;
    ls.forEach(l=>{ body+=`\n· ${l.date.getMonth()+1}.${l.date.getDate()}${l.mood?` [${l.mood}]`:''} ${l.text}`; }); }
  const mks=(makeupLog[sid]||[]).filter(m=>!m.done);
  if(mks.length){ body+=`\n\n○ 보강 예정 ${mks.map(m=>{const d=new Date(m.t);return `${d.getMonth()+1}.${d.getDate()}${m.time?' '+m.time:''}`;}).join(', ')}`; }
  if(mode==='pack' && needSettle(s)){ body+=`\n\n○ ${s.plan}회 수업이 마무리되어 다음 회차(${won(priceOf(s))}) 안내드립니다.`; }
  body+=`\n\n늘 관심 가져주셔서 감사합니다.`;
  return body;
}
function openGuide(sid,mode){
  const s=st(sid); const text=composeGuide(sid,mode);
  _msgCtx={id:sid, text};
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 학습 안내</h3>
    <div class="cap">${s.kakao?'카톡 또는 문자로 보낼 수 있어요.':'이 학부모는 카톡이 없어 문자로 보냅니다.'} 내용은 수정 후 보내도 돼요.</div>
    <div class="msg">${text.replace(/</g,'&lt;')}</div>
    <div class="sheet-btns">
      ${s.kakao?`<button class="btn kakao" onclick="sendGuide('카카오톡',${sid})">카톡으로 보내기</button>`:''}
      <button class="btn sms" onclick="sendGuide('문자',${sid})">문자로 보내기</button>
    </div>`;
  document.getElementById('scrim').classList.add('show');
}
function sendGuide(ch,id){
  const s=st(id); const text=(_msgCtx&&_msgCtx.id===id)?_msgCtx.text:'';
  logAdd(id,'pay',`${s.name} 학습 안내 (${ch}) → ${s.guardian}`);
  if((autoSend||autoSms) && fbFunctions && sendOn('guide')){ closeSheet(); autoSendAll(id, 'guide', text, guardiansOf(s)); return; }
  openMsgWith(id, text, ch==='카카오톡');
}

function renderSend(){
  const el=document.getElementById('v-send');
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">발송 · 상담</h2>
    <p class="page-cap">학생별로 보호자에게 카톡/문자를 열고, 상담 내용을 기록해요.</p>
    ${students.map(s=>{
      const myNotes=notes.filter(n=>n.sid===s.id).sort((a,b)=>b.date-a.date);
      return `<div class="row">
        <div class="row-top"><span class="name">${s.name}</span>
          <span class="contract">${s.kakao?'카톡 O':'문자만'}</span></div>
        <div class="mg-line">👤 ${s.guardian} · ${s.phone}</div>
        <div class="row-btns" style="margin-top:11px">
          <button class="btn ghost small" onclick="openKakao(${s.id})">${s.kakao?'카톡 열기':'문자 열기'}</button>
          <button class="btn ghost small" onclick="openNoteSheet(${s.id})">＋ 상담 메모</button>
        </div>
        ${myNotes.length?`<div class="send-notes">`+myNotes.map(n=>`<div class="sn"><span class="sn-d">${n.date.getMonth()+1}.${n.date.getDate()}</span><span class="sn-t">${n.text}</span></div>`).join('')+`</div>`:''}
      </div>`;
    }).join('')}`;
}

function renderCounsel(){
  const el=document.getElementById('v-counsel');
  const sorted=[...notes].sort((a,b)=>b.date-a.date);
  el.innerHTML=`
    <button class="back" onclick="goTab('home')">‹ 홈</button>
    <h2 class="page-h">학부모 상담</h2>
    <p class="page-cap">상담 내용을 직접 남겨 학생별로 모아 봐요. 카톡 대화는 자동으로 가져올 수 없어, 요점을 적어두는 방식이에요.</p>
    <button class="btn start" style="margin-bottom:16px" onclick="openNoteSheet()">＋ 상담 메모 남기기</button>
    ${sorted.length? sorted.map(n=>{const s=st(n.sid);return `
      <div class="row">
        <div class="row-top"><span class="name">${s.name}</span>
          <span class="contract num">${n.date.getMonth()+1}.${n.date.getDate()}</span></div>
        <div class="note-tx">${n.text}</div>
        <div class="resend" style="border-top:1px solid var(--line);margin-top:11px">
          <button onclick="openKakao(${s.id})">💬 ${s.name} ${s.kakao?'카톡 열기':'문자 열기'}</button>
        </div>
      </div>`;}).join('')
     : `<div class="muted-card">아직 상담 메모가 없어요.</div>`}`;
}
function openNoteSheet(preId){
  const opts=students.map(s=>`<option value="${s.id}" ${preId===s.id?'selected':''}>${s.name}</option>`).join('');
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>상담 메모</h3>
    <div class="cap">학생을 고르고, 상담 내용을 적어주세요.</div>
    <select id="noteStu" class="note-select">${opts}</select>
    <textarea id="noteText" class="note-area" placeholder="예: 수학 진도 상담. 도형 파트 보충 안내."></textarea>
    <div class="sheet-btns"><button class="btn start" onclick="saveNote()">저장</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function saveNote(){
  const sid=+document.getElementById('noteStu').value;
  const text=document.getElementById('noteText').value.trim();
  if(!text){showToast('상담 내용을 적어주세요');return;}
  notes.push({sid,date:new Date(),text}); saveData(); closeSheet();
  if(document.getElementById('v-send').classList.contains('active'))renderSend();
  else renderCounsel();
  showToast('상담 메모를 저장했어요');
}
function openKakao(id){const s=st(id); const gs=guardiansOf(s);
  _notifyCtx={gs, text:`[On-study] ${s.name} 학생 관련 안내드립니다.`};
  if(gs.length===1){ openMsgTo(0); return; }
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 보호자에게 열기</h3>
    <div class="cap">카톡은 복사 후 붙여넣기, 문자는 자동 작성됩니다.</div>
    ${gs.map((g,i)=>`<button class="btn ${g.kakao?'kakao':'sms'}" style="margin-bottom:8px" onclick="openMsgTo(${i})">${g.name} · ${g.kakao?'카톡 복사 + 열기':'문자 열기'}</button>`).join('')}
    <div class="sheet-btns"><button class="btn ghost" onclick="closeSheet()">닫기</button></div>`;
  document.getElementById('scrim').classList.add('show');}

/* ===== 결산 (월별 매출) ===== */
function renderReport(){
  const el=document.getElementById('v-report');
  const Y=now.getFullYear();
  // 최근 6개월 매출 집계
  const months=[];
  for(let i=5;i>=0;i--){const d=new Date(Y,now.getMonth()-i,1);
    const sum=payments.filter(p=>p.date.getMonth()===d.getMonth()&&p.date.getFullYear()===d.getFullYear())
      .reduce((a,p)=>a+p.amount,0);
    const cls=payments.filter(p=>p.date.getMonth()===d.getMonth()&&p.date.getFullYear()===d.getFullYear())
      .reduce((a,p)=>a+p.plan,0);
    months.push({label:(d.getMonth()+1)+'월',sum,cls});}
  const max=Math.max(1,...months.map(m=>m.sum));
  const thisM=months[months.length-1];
  const monthClasses=students.reduce((a,s)=>a+monthCount(s.id),0);
  const waiting=bills.filter(b=>!b.paid).reduce((a,b)=>a+b.amount,0);

  el.innerHTML=`
    <button class="back" onclick="goTab('home')">‹ 홈</button>
    <h2 class="page-h">결산</h2>
    <div class="sum"><div class="k">${thisM.label} 매출</div><div class="big num">${won(thisM.sum)}</div>
      <div class="split">
        <div><div class="k">이번 달 수업</div><div class="v">${monthClasses}회</div></div>
        <div><div class="k">정산 대기</div><div class="v">${won(waiting)}</div></div>
      </div></div>
    <div class="block-h" style="margin-top:4px"><span class="h">최근 6개월 매출</span></div>
    <div class="chart">
      ${months.map(m=>`<div class="col">
        <div class="cbar"><i style="height:${Math.round(m.sum/max*100)}%"></i></div>
        <div class="cval num">${m.sum?Math.round(m.sum/10000)+'만':'-'}</div>
        <div class="clabel">${m.label}</div></div>`).join('')}
    </div>
    <div class="block-h" style="margin-top:22px"><span class="h">학생별 이번 달</span></div>
    ${students.map(s=>`<div class="row">
      <div class="row-top"><span class="name">${s.name}</span>
        <span class="contract">${monthCount(s.id)}회 · ${s.plan}회권</span></div>
    </div>`).join('')}`;
}


function goTab(v){
  saveData();   // 바뀐 게 있을 때만 실제 저장됨(writeNow에서 변경 확인)
  if(v==='today') attnDate=null;   // 출석부는 항상 오늘부터
  if(v==='settle') settleYM=null;  // 정산은 항상 이번 달부터
  document.querySelectorAll('.bt').forEach(t=>t.classList.toggle('active',t.dataset.v===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.getElementById('v-'+v).classList.add('active');
  const dateStr=`${WD[todayIdx]}요일 ${now.getMonth()+1}월 ${now.getDate()}일`;
  const labels={home:'', today:'출석부', students:'학생', settle:'정산',
    counsel:'학부모 상담', report:'결산', admin:'설정', manage:'학생 관리', send:'발송 · 상담', guide:'알림 문구', payhist:'정산 내역', datacheck:'데이터 점검', schedule:'전체 일정', classmgmt:'휴일 관리', academy:'학원 관리'};
  const tl=document.getElementById('todayLine');
  tl.textContent=labels[v]||''; tl.style.display=labels[v]?'block':'none';
  ({home:renderHome,today:renderToday,students:renderStudents,settle:renderSettle,
    counsel:renderCounsel,report:renderReport,admin:renderAdmin,manage:renderManage,send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule,classmgmt:renderClassMgmt,academy:renderAcademy,datacheck:renderDataCheck}[v])();
  window.scrollTo(0,0);
}
document.querySelectorAll('.bt').forEach(t=>t.addEventListener('click',()=>goTab(t.dataset.v)));

let toastTimer=null;
function showToast(msg, action, actionLabel){
  const t=document.getElementById('toast');
  if(action){ t.innerHTML=`${msg} &nbsp;<u style="cursor:pointer" id="toastAct">${actionLabel||'열기'}</u>`;
    t.classList.add('show');
    document.getElementById('toastAct').onclick=()=>{action();};
  } else { t.textContent=msg; t.classList.add('show'); }
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), action?4200:2600);
}

let currentUser=null;

/* ===== 상태 스냅샷 / 반영 (Firestore state/app 문서와 연결) ===== */
function snapshot(){
  return {
    packages, cycleDone, closeTime, nextId,
    students, sessions, payments, notes, lessons,
    absentLog, makeupLog, packHistory, bills, billSeq, holidaysExtra, workdaysExtra, skipLog, academy, autoSend, autoSms, sendKinds, msgTemplates,
    live, logbook, seedUntil,   // 등원중 · 오늘 알림 · 확정 기준일 (보강은 makeupLog로 통합)
  };
}
function reviveDates(arr){ arr.forEach(o=>{ if(o&&o.date) o.date=new Date(o.date); }); return arr; }
function applyState(d){
  if(!d) return;
  if(d.packages)packages=d.packages;
  if(d.cycleDone)cycleDone=d.cycleDone;
  if(d.closeTime)closeTime=d.closeTime;
  if(typeof d.nextId==='number')nextId=d.nextId;
  if(Array.isArray(d.students))students.splice(0,students.length,...d.students);
  if(Array.isArray(d.sessions))sessions=reviveDates(d.sessions);
  if(Array.isArray(d.payments))payments=reviveDates(d.payments);
  if(Array.isArray(d.notes))notes=reviveDates(d.notes);
  if(Array.isArray(d.lessons))lessons=reviveDates(d.lessons);
  if(d.absentLog)absentLog=d.absentLog;
  if(d.makeupLog)makeupLog=d.makeupLog;
  if(d.packHistory){ for(const k in d.packHistory){ (d.packHistory[k]||[]).forEach(p=>{if(p.settledDate)p.settledDate=new Date(p.settledDate); if(typeof p.start==='string')p.start=new Date(p.start).getTime();}); } packHistory=d.packHistory; }
  if(Array.isArray(d.bills)) bills=d.bills;
  if(typeof d.billSeq==='number') billSeq=d.billSeq;
  if(d.holidaysExtra) holidaysExtra=d.holidaysExtra;
  if(d.workdaysExtra) workdaysExtra=d.workdaysExtra;
  if(d.skipLog) skipLog=d.skipLog;
  if(d.academy) academy=Object.assign({name:'',owner:'',phone:''}, d.academy);
  if(typeof d.autoSend==='boolean') autoSend=d.autoSend;
  if(typeof d.autoSms==='boolean') autoSms=d.autoSms;
  if(d.sendKinds && typeof d.sendKinds==='object') sendKinds=Object.assign({start:true,end:true,absent:true,settle:true,guide:true}, d.sendKinds);
  if(d.msgTemplates) for(const k in d.msgTemplates){ if(msgTemplates[k]) msgTemplates[k]=Object.assign({sms:'',code:''}, d.msgTemplates[k]); }
  // 정산 문구가 옛 기본값이거나 비어 있으면 새 기본 문구로 자동 갱신(원장님이 고친 문구는 그대로 둠)
  if(msgTemplates.settle && (!msgTemplates.settle.sms || msgTemplates.settle.sms===OLD_SETTLE_TPL)) msgTemplates.settle.sms=DEFAULT_SETTLE_TPL;
  // 등원 중 상태: 오늘 것만 복원(어제 것이 남아 '수업 중'으로 보이지 않게)
  if(d.live && typeof d.live==='object'){
    const t=dayKey(now.getTime()); const nl={};
    for(const k in d.live){ const v=d.live[k]; if(typeof v==='number' && dayKey(v)===t) nl[k]=v; }
    live=nl;
  }
  // '오늘만 추가'는 그날 하루만 유효 — 다른 날짜면 비움
  tempDay = (typeof d.tempDay==='number') ? d.tempDay : null;
  seedUntil = (typeof d.seedUntil==='number') ? d.seedUntil : null;
  tempToday = (Array.isArray(d.tempToday) && tempDay===dayKey(now.getTime())) ? new Set(d.tempToday) : new Set();
  tempTimes = (d.tempTimes && tempDay===dayKey(now.getTime())) ? d.tempTimes : {};
  if(Array.isArray(d.logbook)) logbook=d.logbook.filter(l=>l && (l.d==null || l.d===dayKey(now.getTime())));
}

/* 로그인 성공 후 auth.js가 호출 */
function initApp(){
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='flex';
  const dl=document.getElementById('todayLine');
  dl.textContent=`오늘 · ${WD[todayIdx]}요일 ${now.getMonth()+1}월 ${now.getDate()}일`;
  dl.style.display='none';
  autoRolloverAll();   // 완주한 클래스 자동으로 다음 클래스로 넘김
  if(Object.keys(live).length) ensureTicker();   // 복원된 '수업 중' 타이머 재시작
  // 데스크탑 관리자(admin.html)는 설정 화면부터, 모바일 앱은 홈부터
  if(document.body.dataset.mode==='admin'){ goTab('admin'); }
  else { renderHome(); }
}
/* 원격 변경(다른 기기)이 들어오면 auth/store가 호출 → 현재 화면 다시 그림 */
function refreshCurrentView(){
  const active=document.querySelector('.bt.active');
  const v=active?active.dataset.v:'home';
  const map={home:renderHome,today:renderToday,students:renderStudents,settle:renderSettle,
    counsel:renderCounsel,report:renderReport,admin:renderAdmin,manage:renderManage,
    send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule,classmgmt:renderClassMgmt,
    academy:renderAcademy,datacheck:renderDataCheck};
  (map[v]||renderHome)();
}
