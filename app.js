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
let autoSend=false;
// 발송 문구: 종류별 문자 문구(sms) + 알림톡 템플릿 코드(code). 문자문구를 #{} 형태로 변환해 카카오 심사 신청에 사용.
let msgTemplates={
  start:  { sms:'[{학원명}] {학생명} 학생이 {시각}에 등원했습니다.', code:'' },
  end:    { sms:'[{학원명}] {학생명} 학생이 {시각}에 하원했습니다. 오늘도 수고하셨습니다.', code:'' },
  absent: { sms:'[{학원명}] {학생명} 학생이 오늘 수업에 결석 처리되었습니다.', code:'' },
  settle: { sms:'[{학원명}] {학생명} 학생 {회차}회 수업이 마무리되었습니다. 수업료 {금액}원 안내드립니다.', code:'' },
  guide:  { sms:'[{학원명}] {학생명} 학생 학습 안내입니다.\n{내용}', code:'' }
};
const MSG_KINDS=[['start','등원'],['end','하원'],['absent','결석'],['settle','정산 요청'],['guide','학습 안내']];
const VAR_EXAMPLE={학원명:'온스터디', 학생명:'김철수', 시각:'16:00', 회차:'8', 금액:'100,000', 내용:'덧셈 연습 30문제 중 28점'};
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
function doneCountOf(s){ if(!s) return 0; return currentClassInfo(s).sessions.filter(t=>t<=dayKey(now.getTime())).length; }

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
  const info={start:null, end:null, sessions:[], absents:[], makeups:[], skips:[], windowDates:new Set()};
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

let tempToday=new Set();
let absentToday=new Set();   // (호환용) markAbsent/clearAbsent에서 갱신
// 오늘 결석 여부 = 영구 기록(absentLog) 기준. 새로고침·다른 기기에서도 일치
function isAbsentToday(sid){ const t=dayKey(now.getTime()); return (absentLog[sid]||[]).some(x=>dayKey(x)===t); }
const isTodayStudent=(x)=> tempToday.has(x.id) || (x.days.includes(todayIdx) && !beforeStart(x, dayKey(now.getTime())));
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
      // 다른 날 = 보기 전용 (그날 출결 현황)
      const done=doneOn(s.id), abs=isAbsentOn(s.id);
      let stx, sc;
      if(abs){ stx='결석'; sc='var(--clay)'; }
      else if(done){ stx = done.start ? `하원 완료 · ${hm(done.start)}~${hm(done.end)}` : '수업 완료'; sc='var(--green)'; }
      else { stx = `예정 ${timeFor(s,dowA)||s.time||''}`; sc='var(--muted)'; }
      return `<div class="card" style="${abs?'border:1.6px solid var(--clay)':''}">
        <div class="card-top"><div class="who">
          <div class="name">${s.name}</div>
          <div class="plan" style="color:${sc}">${stx}</div>
        </div></div>
        ${abs?`<div class="row-btns" style="margin-top:8px"><button class="btn ghost small" onclick="clearAbsentFrom(${s.id},${aMs})">결석 취소</button></div>`:''}
      </div>`;
    }
    const isLive=live[s.id]!=null;
    const isTemp=tempToday.has(s.id)&&!s.days.includes(todayIdx);
    const isAbsent=isAbsentToday(s.id);
    const done=doneToday(s.id);
    const shownDay=doneCountOf(s);
    const expanded=cardExpanded.has(s.id);

    // 헤더 상태 텍스트/색
    let statusText, statusColor;
    if(done){ statusText = done.start ? `하원 완료 · ${hm(done.start)}~${hm(done.end)}` : '하원 완료'; statusColor='var(--green)'; }
    else if(isLive){ statusText = `수업 중 · 등원 ${new Date(live[s.id]).toTimeString().slice(0,5)}`; statusColor='var(--amber)'; }
    else if(isAbsent){ statusText = '결석 처리됨'; statusColor='var(--clay)'; }
    else { statusText = `${isTemp?'오늘 임시':'예정 '+s.time} · ${shownDay}/${s.plan}회`; statusColor='var(--muted)'; }

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
        <button class="btn ghost" onclick="manualComplete(${s.id})">완료</button>
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
        ${isTemp?`<button class="btn ghost small" onclick="removeTemp(${s.id})">오늘 빼기</button>`:''}
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
          <div class="name">${s.name}</div>
          <div class="plan" style="color:${statusColor}">${statusText}</div>
        </div>
        ${toggleBtn}
      </div>
      ${detail}
      ${action}
    </div>`;
  };
  // 1시간 단위로 묶어 시간대 헤더(주황 알약) + 학생 카드
  const hourOf=(s)=>{ const t=(timeFor(s,dowA)||s.time||''); return t?t.slice(0,2)+':00':'시간 미정'; };
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
  const empty=list.length?'':`<div class="empty">${isToday?'오늘 예정된 학생이 없어요. 아래에서 추가할 수 있어요.':'이 날은 예정된 학생이 없어요.'}</div>`;
  const cand=students.filter(x=>!isTodayStudent(x));
  const addBox=`<div class="add-wrap"><div class="add-title">오늘만 추가하기</div>
    <div class="add-desc">보강·대체 등 오늘만 오는 학생을 골라 출석부에 넣어요. 정규 요일표는 바뀌지 않아요.</div>
    ${cand.length?`<div class="chips">`+cand.map(x=>`<button class="chip" onclick="addTemp(${x.id})">＋ ${x.name}</button>`).join('')+`</div>`
      :`<div class="add-desc" style="margin:0">추가할 수 있는 다른 학생이 없어요.</div>`}</div>`;
  el.innerHTML=dateNav+summary+empty+cards+(isToday?addBox:'');
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

function buildCalendar(s, cal, prevClick, nextClick){
  cal = cal || calCur;
  const info=currentClassInfo(s);
  const sessionSet=new Set(info.sessions);
  const absentSet=new Set(info.absents);
  const makeupSet=new Set(info.makeups);
  const skipSet=new Set(info.skips);
  const todayT=dayKey(now.getTime());
  const y=cal.y, m=cal.m;
  const first=new Date(y,m,1).getDay();
  const days=new Date(y,m+1,0).getDate();

  let grid='';
  ['일','월','화','수','목','금','토'].forEach(w=>grid+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++)grid+='<div></div>';
  for(let dd=1;dd<=days;dd++){
    const t=new Date(y,m,dd).getTime();
    let c='cal-d', style='';
    if(skipSet.has(t)){ style+='background:#EDEDED;color:#B0ADA6;text-decoration:line-through;'; }
    else if(makeupSet.has(t)){ style+='background:#EAE3F7;color:#6B4FBB;font-weight:700;'; }
    else if(absentSet.has(t)) c+=' absent';
    else if(sessionSet.has(t)) c+=(t<=todayT?' att':' up');
    if(t===todayT && !absentSet.has(t) && !skipSet.has(t))c+=' tod';
    const editable = document.body.dataset.mode==='admin';
    const clickable = editable && t>=todayT;
    if(clickable) style+='cursor:pointer;';
    const onclick = clickable ? `onclick="calDayClick(${s.id},${t})"` : '';
    grid+=`<div class="${c}" style="${style}" ${onclick}>${dd}</div>`;
  }

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
  const mkText=mks.length? mks.map(mk=>{const d=new Date(mk.t);
    return `${d.getMonth()+1}.${d.getDate()}${mk.time?' '+mk.time:''}${mk.done?' ✓':''}`;}).join(', ') : '없음';
  const mkLine=`<div class="cf-row"><span class="cf-k">보강일</span>
    <span class="cf-v">${mkText} ${document.body.dataset.mode==='admin'?`<button class="cf-more" onclick="openMakeupSheet(${s.id})">＋ 지정</button>`:''}</span></div>`;

  // 이번 회차 요약(시작~종료)
  const rangeLine=`<div class="cf-row"><span class="cf-k">이번 회차</span>
    <span class="cf-v">${fmtD(info.start)} ~ ${fmtD(info.end)} · ${doneCountOf(s)}/${s.plan}회</span></div>`;

  return `<div class="cal">
    <div class="cal-nav"><button onclick="${prevClick||`calNav(${s.id},-1)`}" aria-label="이전 달">‹</button>
      <span>${y}년 ${m+1}월</span>
      <button onclick="${nextClick||`calNav(${s.id},1)`}" aria-label="다음 달">›</button></div>
    <div class="cal-grid">${grid}</div>
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
  sheet.innerHTML=`<h3>${s.name} 보강일 지정</h3>
    <div class="cap">보강 날짜와 시간을 선택하세요. 달력 아래 보강일 줄에 표시돼요.</div>
    <input type="date" id="mkDate" class="note-select">
    <input type="time" id="mkTime" class="note-select" style="margin-top:8px">
    <div class="sheet-btns"><button class="btn start" onclick="saveMakeup(${id})">추가</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function saveMakeup(id){
  const v=document.getElementById('mkDate').value;
  const tm=document.getElementById('mkTime').value;
  if(!v){showToast('날짜를 골라주세요');return;}
  const d=new Date(v+'T00:00:00');
  (makeupLog[id]=makeupLog[id]||[]).push({t:d.getTime(), time:tm||'', done:false});
  saveData(); closeSheet();
  if(openCal===id)document.getElementById('cal-'+id).innerHTML=buildCalendar(st(id));
  showToast(`${st(id).name} 보강 ${d.getMonth()+1}.${d.getDate()}${tm?' '+tm:''} 추가됨`);
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
function clearAbsentFrom(sid, dayMs){
  const k=dayKey(dayMs);
  if(absentLog[sid]) absentLog[sid]=absentLog[sid].filter(x=>dayKey(x)!==k);
  if(dayKey(now.getTime())===k) absentToday.delete(sid);
  saveData(); renderSchedule();
  showToast(`${st(sid).name} 결석 취소`);
}
function addTemp(id){tempToday.add(id);saveData();renderToday();}
function removeTemp(id){tempToday.delete(id);saveData();renderToday();}

/* 완료 처리(1회 차감). start/end 있으면 시각·소요시간 함께 기록 */
function complete(id, start, end){
  const rec={sid:id, date:new Date()};
  if(start&&end){ rec.start=start; rec.end=end; rec.min=Math.max(1,Math.round((end-start)/60000)); }
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

function startSession(id){
  live[id]=Date.now(); renderToday(); ensureTicker();
  const s=st(id);
  showToast(`${s.name} 등원 기록 · 보호자에게 알림을 엽니다`);
  saveData();
  openNotify(id,'start');
}
function stopSession(id){
  const start=live[id], end=Date.now();
  delete live[id]; complete(id,start,end); renderToday();
  const s=st(id);
  if(!Object.keys(live).length&&ticker){clearInterval(ticker);ticker=null;}
  showToast(`${s.name} 하원 기록 · ${doneCountOf(s)}/${s.plan}회 · 보호자에게 알림을 엽니다`);
  openNotify(id,'end');
  rolloverIfComplete(id); saveData(); renderToday();
}
function resend(id,kind){ openNotify(id,kind); }
/* 실제 발송: 문자는 sms:로 문자앱이 내용 채워 열림, 카톡은 (특정 대화방 자동입력 불가라)
   메시지를 복사한 뒤 카톡 앱을 열어 붙여넣기. 데스크탑에선 문자앱이 없어 열리지 않을 수 있어요(모바일 앱에서 사용). */
let _notifyCtx=null;
/* 알림톡 서버 발송 (Functions). 실패/미배포면 {ok:false} 반환 → 앱이 열어주기로 폴백 */
async function serverSend(to, kind, text){
  try{
    if(!fbFunctions) return {ok:false, channel:'no-server'};
    const call=fbFunctions.httpsCallable('sendNotify');
    const r=await call({to, kind, text, fallbackSms:true});
    return r.data || {ok:false};
  }catch(e){ return {ok:false, channel:'error', message:String(e)}; }
}
/* 자동발송: 보호자 전원에게 알림톡. 하나라도 실패하면 열어주기로 폴백 */
async function autoSendAll(sid, kind, text, gs){
  const s=st(sid);
  showToast(`${s.name} 알림톡 발송 중…`);
  let fail=0;
  for(const g of gs){ const r=await serverSend(g.phone, kind, text); if(!r||!r.ok) fail++; }
  if(fail===0){ showToast(`${s.name} 보호자에게 알림톡 발송 완료`); return; }
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
  gs.forEach(g=>logAdd(id,kind==='absent'?'absent':kind,`${s.name} ${word} → ${g.name}(${g.kakao?'카톡':'문자'})`));
  if(autoSend && fbFunctions){ autoSendAll(id, kind, text, gs); return; }
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
  const schedLine = `<div class="mg-line">📅 정기 수업일 ${schedText(s)}</div>`;
  const rangeLine = `<div class="mg-line">🔄 이번 클래스 ${ci.start?fmtD(ci.start):'-'} ~ ${ci.end?fmtD(ci.end):'-'} (예상 종료)</div>`;
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
function renderStudents(){
  const el=document.getElementById('v-students');
  const byName=(a,b)=>a.name.localeCompare(b.name,'ko');
  const sortBtn=(m,label)=>`<button onclick="setStudentSort('${m}')" style="flex:1;padding:9px 6px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${studentSort===m?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
  const sortBar=`<div style="display:flex;gap:8px;margin-bottom:16px">
    ${sortBtn('name','전체 (가나다)')}${sortBtn('day','요일별')}${sortBtn('grade','학년별')}</div>`;
  const grpH=(t)=>`<div style="font-size:12.5px;font-weight:700;color:var(--ink);margin:20px 2px 9px;padding-bottom:5px;border-bottom:1px solid var(--line)">${t}</div>`;

  let body='';
  if(studentSort==='name'){
    body = students.slice().sort(byName).map(s=>studentCard(s)).join('');
  } else if(studentSort==='grade'){
    const groups={}; students.forEach(s=>{ const k=s.grade||'none'; (groups[k]=groups[k]||[]).push(s); });
    const order=[...GRADES.map(g=>g[0]),'none'];
    body = order.filter(k=>groups[k]&&groups[k].length).map(k=>{
      const label = k==='none' ? '학년 미입력' : gradeLabel(k);
      return grpH(label) + groups[k].sort(byName).map(s=>studentCard(s)).join('');
    }).join('');
  } else { // 요일별: 전체/월~금 탭 + 시간대 소제목
    const dayOrder=[1,2,3,4,5];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    const dtab=(v,label)=>`<button onclick="setStuDay(${v})" style="padding:8px 14px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${stuDayFilter===v?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
    const tabBar=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${dtab(null,'전체')}${dayOrder.map(d=>dtab(d,WD[d])).join('')}</div>`;
    const shown=(stuDayFilter==null)?dayOrder:[stuDayFilter];
    const groups=shown.map(d=>{
      const list=students.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일 (${list.length}명)`); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=studentCard(s,d); });
      return html;
    }).join('');
    body = tabBar + (groups || '<div class="muted-card">해당 요일에 수업이 없어요.</div>');
  }
  if(!students.length) body='<div class="empty">등록된 학생이 없어요.</div>';
  el.innerHTML=sortBar+body;
}

/* ===== 정산 ===== */
/* 어떤 날짜가 그 학생의 수업일인지 (회차 계산과 동일 규칙) */
function isSessionDay(s, k){
  if(!s || !s.days) return false;
  if((makeupLog[s.id]||[]).some(mk=>dayKey(mk.t)===k)) return true;   // 보강일
  const d=new Date(k);
  if(!s.days.includes(d.getDay())) return false;
  if((absentLog[s.id]||[]).some(t=>dayKey(t)===k)) return false;      // 결석 제외
  if((skipLog[s.id]||[]).some(t=>dayKey(t)===k)) return false;        // 휴강 제외
  if(isHoliday(k)) return false;                                      // 휴일 제외
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
let histAllOpen=new Set(), histRowOpen=new Set();
function toggleHistAll(sid){ if(histAllOpen.has(sid))histAllOpen.delete(sid); else histAllOpen.add(sid); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
function toggleHistRow(key){ if(histRowOpen.has(key))histRowOpen.delete(key); else histRowOpen.add(key); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
/* 지난 회차 블록 HTML (최근 3개, 나머지는 '전체 보기') */
function pastClassesHtml(s){
  const all=(packHistory[s.id]||[]).slice().sort((a,b)=>(b.end||0)-(a.end||0));
  if(!all.length) return `<div class="mg-line" style="color:var(--muted)">📚 지난 클래스 : 아직 없어요</div>`;
  const openAll=histAllOpen.has(s.id);
  const show=openAll?all:all.slice(0,3);
  const rows=show.map(h=>{
    const key=s.id+'-'+h.no;
    const cnt=h.done||h.plan||0;
    // 종료일: 저장값 → 정산일 순
    const en = h.end || (h.settledDate? dayKey(new Date(h.settledDate).getTime()) : null);
    // 회차 목록: 저장된 게 온전하면 사용, 아니면 종료일부터 거꾸로 복원(정산 건과 동일 규칙)
    let list = (Array.isArray(h.sessions) && h.sessions.length>=cnt) ? h.sessions
             : (en ? sessionDaysBack(s, en, cnt) : []);
    // 시작일: 회차 목록의 첫날. 저장된 start가 종료일보다 뒤면(옛 데이터 오류) 무시
    let st_ = list.length ? list[0] : ((h.start && en && h.start<=en) ? h.start : null);
    const period=(st_&&en)?`${fmtMD(st_)} ~ ${fmtMD(en)}`:(en?`~ ${fmtMD(en)}`:'기간 미상');
    const open=histRowOpen.has(key);
    const detail=open?`<div style="background:var(--bg);border-radius:9px;padding:9px 11px;margin-top:7px">
      ${list.length?list.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0">
          <span style="color:var(--muted)">${i+1}회차</span><span>${fmtMD(t)}</span></div>`).join('')
        :'<div style="font-size:12.5px;color:var(--muted)">회차별 날짜 기록이 없어요.</div>'}
    </div>`:'';
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:7px;background:var(--card)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-weight:600;font-size:13.5px">${h.no}차 · ${h.done||h.plan}/${h.plan}회</span>
        <span style="font-size:12.5px;color:var(--muted)">${h.amount?won(h.amount):''}</span></div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">📅 ${period}</div>
      <button class="btn ghost small" style="margin-top:7px;width:auto;padding:5px 10px;font-size:12px" onclick="toggleHistRow('${key}')">${open?'접기 ▲':'회차 보기 ▾'}</button>
      ${detail}</div>`;
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
          <button class="btn pay small" onclick="openSettleMsg(${b.sid})">납입 요청 메시지</button>
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
function normalizeHistory(){
  let ch=false; const today=dayKey(now.getTime());
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
function openSettleMsg(id){
  const s=st(id); const mL=(now.getMonth()+1)+'월';
  const text=`안녕하세요, ${s.guardian}님.
${s.name} 학생이 ${s.plan}회 수업을 모두 마쳤습니다.

· 이번 ${mL} 수업 ${monthCount(s.id)}회
· 다음 ${s.plan}회권 수업료 : ${won(priceOf(s))}

결제 안내드립니다. 감사합니다.`;
  _msgCtx={id, text};
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} 납입 요청</h3>
    <div class="cap">${s.kakao?'카카오톡 또는 문자로 보낼 수 있어요.':'이 학부모는 카톡이 없어 문자로 보냅니다.'}</div>
    <div class="msg">${text}</div>
    <div class="sheet-btns">
      ${s.kakao?`<button class="btn kakao" onclick="sendVia('카카오톡',${id})">카톡으로 보내기</button>`:''}
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
  if(autoSend && fbFunctions){ closeSheet(); autoSendAll(id, 'settle', text, guardiansOf(s)); return; }
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
    {k:'guide',t:'결과지 · 알림폼',d:'학습 안내 양식 만들고 발송',ready:true},
    {k:'payhist',t:'정산 내역',d:'차수별 결제 이력',ready:true},
    {k:'people',t:'관리자 등록',d:'로그인 권한이 있는 사람 관리',ready:true},
    {k:'basic',t:'수업 기본 설정',d:'클래스 금액 · 마감 알림 시각',ready:true},
  ];
  el.innerHTML=`
    <div class="acct">
      <div class="acct-av">${(currentUser?currentUser.name:'원')[0]}</div>
      <div class="acct-info"><div class="acct-name">${currentUser?currentUser.name:'원장님'}</div>
        <div class="acct-mail">${currentUser?currentUser.email:OWNER_EMAIL}</div></div>
      <button class="acct-out" onclick="logout()">로그아웃</button>
    </div>
    <div class="admin-menu">
      ${menu.map(m=>`<button class="am-item" onclick="${m.k==='students'?`goTab('manage')`:m.k==='classmgmt'?`goTab('classmgmt')`:m.k==='academy'?`goTab('academy')`:m.k==='basic'?`openAdmin('basic')`:m.k==='people'?`openAdmin('people')`:m.k==='send'?`goTab('send')`:m.k==='guide'?`goTab('guide')`:m.k==='payhist'?`goTab('payhist')`:`comingSoon('${m.t}')`}">
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
  const dayTime = (forDay!=null) ? `<div class="mg-line">⏰ ${WD[forDay]} ${timeFor(s,forDay)}</div>` : '';
  return `<div class="row" id="mng-${s.id}">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${eduLine}${dayTime}
    <div class="mg-line">🗓 ${days}요일 · ${timeTxt}</div>
    <div class="mg-line">🏫 학원 수업 시작일 : ${startTxt}</div>
    <div class="mg-line">🔄 이번 회차 : ${fmtD(cycleStartOf(s))} ~ ${fmtD(cycleEndOf(s))} · 현재 ${doneCountOf(s)}/${s.plan}회차</div>
    <div class="mg-line">${gLines}</div>
    ${pastClassesHtml(s)}
    <div class="row-btns" style="margin-top:11px">
      <button class="btn ghost small" onclick="openStudentSheet(${s.id})">수정</button>
      <button class="btn ghost small" onclick="toggleMngCal(${s.id})">${mngCal.open===s.id?'달력 닫기':'달력 보기'}</button>
      <button class="btn ghost small" onclick="askDeleteStudent(${s.id})">삭제</button>
    </div>
    ${mngCal.open===s.id ? buildCalendar(s, mngCal, `mngCalNav(${s.id},-1)`, `mngCalNav(${s.id},1)`) : ''}
    </div>`;
}
function renderManage(){
  const el=document.getElementById('v-manage');
  const byName=(a,b)=>a.name.localeCompare(b.name,'ko');
  const sortBtn=(m,label)=>`<button onclick="setManageSort('${m}')" style="flex:1;padding:9px 6px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${manageSort===m?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
  const sortBar=`<div style="display:flex;gap:8px;margin-bottom:16px">
    ${sortBtn('name','전체 (가나다)')}${sortBtn('day','요일별')}${sortBtn('grade','학년별')}</div>`;
  const grpH=(t)=>`<div style="font-size:12.5px;font-weight:700;color:var(--ink);margin:20px 2px 9px;padding-bottom:5px;border-bottom:1px solid var(--line)">${t}</div>`;

  let body='';
  if(manageSort==='name'){
    body = students.slice().sort(byName).map(s=>manageCard(s)).join('');
  } else if(manageSort==='grade'){
    const groups={}; students.forEach(s=>{ const k=s.grade||'none'; (groups[k]=groups[k]||[]).push(s); });
    const order=[...GRADES.map(g=>g[0]),'none'];
    body = order.filter(k=>groups[k]&&groups[k].length).map(k=>{
      const label = k==='none' ? '학년 미입력' : gradeLabel(k);
      return grpH(label) + groups[k].sort(byName).map(s=>manageCard(s)).join('');
    }).join('');
  } else { // 요일별: 전체/월~금 탭 + 시간대 소제목
    const dayOrder=[1,2,3,4,5];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    const dtab=(v,label)=>`<button onclick="setMngDay(${v})" style="padding:8px 14px;border-radius:9px;border:1px solid var(--line);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;${mngDayFilter===v?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--card);color:var(--muted)'}">${label}</button>`;
    const tabBar=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${dtab(null,'전체')}${dayOrder.map(d=>dtab(d,WD[d])).join('')}</div>`;
    const shown=(mngDayFilter==null)?dayOrder:[mngDayFilter];
    const groups=shown.map(d=>{
      const list=students.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일 (${list.length}명)`); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=manageCard(s,d); });
      return html;
    }).join('');
    body = tabBar + (groups || '<div class="muted-card">해당 요일에 수업이 없어요.</div>');
  }
  if(!students.length) body='<div class="muted-card">아직 등록된 학생이 없어요. 위 ‘＋ 학생 추가’로 시작하세요.</div>';

  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">학생 관리</h2>
    <p class="page-cap">학생을 추가·수정하고 회차·요일·시간과 보호자 정보를 설정해요.</p>
    <button class="btn start" style="margin-bottom:14px" onclick="openStudentSheet(null)">＋ 학생 추가</button>
    ${sortBar}${body}`;
}
function openStudentSheet(id){
  const s=id?st(id):{name:'',phone:'',plan:8,time:'16:00',days:[],guardians:[],startDate:null,dayTimes:null};
  const gs=guardiansOf(s);
  const g1=gs[0]||{name:'',phone:'',kakao:true};
  const g2=gs[1]||null;
  const startVal = s.startDate ? new Date(s.startDate).toISOString().slice(0,10) : '';
  const curCycle = id ? (doneCountOf(s)+1) : 1;  // 진행 중인 회차 번호 = 완료+1 (표시와 동일 계산)
  const pkgList = Object.keys(packages).map(n=>+n).filter(n=>n>0).sort((a,b)=>a-b);
  const preset = pkgList.includes(s.plan);
  const dayBtns=WD.map((w,i)=>`<button type="button" class="day-btn ${s.days.includes(i)?'on':''}" data-d="${i}" onclick="this.classList.toggle('on');syncDayTimes()">${w}</button>`).join('');
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
    <div class="fld"><label>이번 회차 시작일 <span class="hint">비워두면 자동</span></label>
      <input type="date" id="stCycStart" class="note-select" value="${s.cycleStart?new Date(s.cycleStart).toISOString().slice(0,10):''}"></div>
    <div class="fld"><label>예상 종료일 <span class="hint">비워두면 자동(남은 회차·요일로 계산)</span></label>
      <input type="date" id="stCycEnd" class="note-select" value="${s.cycleEnd?new Date(s.cycleEnd).toISOString().slice(0,10):''}"></div>
    <div class="fld"><label>요일</label><div class="day-row" id="dayRow">${dayBtns}</div></div>
    <div class="fld"><label>시간</label><input type="time" id="stTime" class="note-select" value="${s.time||'16:00'}" oninput="syncDayTimes()">
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
  sheet.dataset.g1kakao=(g1.kakao!==false)?'1':'0';
  sheet.dataset.g2kakao=(g2&&g2.kakao===false)?'0':'1';
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
  const cycStartRaw=document.getElementById('stCycStart').value;
  const cycleStart=cycStartRaw?new Date(cycStartRaw+'T00:00:00').getTime():null;
  const cycEndRaw=document.getElementById('stCycEnd').value;
  const cycleEnd=cycEndRaw?new Date(cycEndRaw+'T00:00:00').getTime():null;
  const curCycleInput=+document.getElementById('stCycle').value||1;
  const curDone=Math.max(0, curCycleInput-1);  // N회차 진행 중 = N-1회 완료
  const data={name, phone:document.getElementById('stPhone').value.trim(),
    grade:document.getElementById('stGrade').value, school:document.getElementById('stSchool').value.trim(),
    plan, days, time:commonTime, dayTimes, startDate, cycleStart, cycleEnd, guardians,
    // 호환용 대표(보호자1) 미러
    guardian:guardians[0].name, kakao:guardians[0].kakao};
  data.phone_guardian=guardians[0].phone; // 참고용
  if(id){ Object.assign(st(id),data); cycleDone[id]=curDone; }
  else { const nid=++nextId; students.push({id:nid,...data}); cycleDone[nid]=curDone; }
  saveData(); closeSheet(); renderManage(); showToast(`${name} ${id?'수정됨':'추가됨'}`);
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
function studentsOnDate(ms){
  const d=new Date(ms), dow=d.getDay();
  return students.filter(s=>s.days.includes(dow) && !beforeStart(s,ms))
    .sort((a,b)=> (timeFor(a,dow)||'').localeCompare(timeFor(b,dow)||''));
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
          <div class="row-top"><span class="name">${s.name}</span>${statusHtml}</div>
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
    ${listHtml}`;
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
      <div class="cap">켜면 등원·하원·정산·안내를 <b>카카오 알림톡으로 자동 발송</b>합니다(카톡 실패 시 문자 자동전환). 발송 서버·템플릿 승인이 완료돼야 실제로 나갑니다. 준비 전에는 꺼두세요(끄면 기존 '메시지 열어주기'로 동작).</div>
      <div class="seg2" style="margin-top:8px">
        <button type="button" class="${autoSend?'on':''}" onclick="setAutoSend(true)">자동 발송 켜기</button>
        <button type="button" class="${!autoSend?'on':''}" onclick="setAutoSend(false)">끄기 (열어주기)</button>
      </div>
    </div>`;
}
function setAutoSend(v){ autoSend=!!v; saveData(); renderAcademy(); showToast(v?'알림톡 자동 발송 켜짐':'자동 발송 꺼짐 (열어주기)'); }
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

function renderGuide(){
  const el=document.getElementById('v-guide');
  const tplCards = MSG_KINDS.map(([k,label])=>{
    const sms = (msgTemplates[k]&&msgTemplates[k].sms)||'';
    const code = (msgTemplates[k]&&msgTemplates[k].code)||'';
    const preview = applyVars(sms, Object.assign({}, VAR_EXAMPLE, {학원명: academy.name||VAR_EXAMPLE.학원명}));
    const kakao = toKakaoTemplate(sms);
    return `<div class="set-sec">
      <h3>${label} 알림</h3>
      <div class="fld"><label>문자 문구 <span class="hint">변수: {학원명} {학생명} {시각} {회차} {금액} {내용}</span></label>
        <textarea id="tpl_${k}" class="note-select" rows="3" style="width:100%;resize:vertical" onchange="setMsgTemplate('${k}')">${sms.replace(/</g,'&lt;')}</textarea></div>
      <div class="cap" style="margin-top:2px">문자 미리보기</div>
      <div class="msg" style="margin-top:4px">${preview.replace(/</g,'&lt;')}</div>
      <div class="cap" style="margin-top:8px">카톡(알림톡) 템플릿 — 카카오 심사 신청에 그대로 사용</div>
      <div class="msg" id="kk_${k}" style="margin-top:4px">${kakao.replace(/</g,'&lt;')}</div>
      <button class="btn ghost small" style="width:auto;margin-top:6px;padding:8px 14px" onclick="copyKakaoTpl('${k}')">카톡 템플릿 복사</button>
      <div class="fld" style="margin-top:10px"><label>알림톡 템플릿 코드 <span class="hint">심사 통과 후 받은 코드</span></label>
        <input id="code_${k}" class="note-select" value="${code}" placeholder="예: ONSTUDY_${k.toUpperCase()}" onchange="setMsgTemplate('${k}')"></div>
    </div>`;
  }).join('');

  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">결과지 · 알림폼</h2>
    <p class="page-cap">발송 문구를 한 번 작성하면 문자로는 그대로, 카톡은 심사받은 템플릿 코드로 나갑니다. 카톡 템플릿 문구는 아래에서 복사해 카카오(롯데이노베이트) 심사에 신청하세요.</p>
    <div class="block-h"><span class="h">발송 문구 관리</span></div>
    ${tplCards}
    <div class="block-h" style="margin-top:22px"><span class="h">학생별 학습 안내(결과지) 보내기</span></div>
    ${students.map(s=>{
      const cnt=monthCount(s.id);
      return `<div class="row">
        <div class="row-top"><span class="name">${s.name}</span>
          <span class="contract">${cnt}회 · ${s.plan}회권</span></div>
        <div class="row-btns" style="margin-top:11px">
          <button class="btn start small" onclick="openGuide(${s.id},'pack')">이번 회차 결과지</button>
          <button class="btn ghost small" onclick="openGuide(${s.id},'week')">이번 주</button>
        </div></div>`;
    }).join('')}`;
}
function setMsgTemplate(k){
  const sms=(document.getElementById('tpl_'+k)||{}).value||'';
  const code=(document.getElementById('code_'+k)||{}).value||'';
  msgTemplates[k]={ sms:sms.trim(), code:code.trim() };
  // 미리보기·카톡템플릿 갱신
  const kk=document.getElementById('kk_'+k); if(kk) kk.textContent=toKakaoTemplate(sms);
  saveData();
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
  if(autoSend && fbFunctions){ closeSheet(); autoSendAll(id, 'guide', text, guardiansOf(s)); return; }
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
    counsel:'학부모 상담', report:'결산', admin:'설정', manage:'학생 관리', send:'발송 · 상담', guide:'결과지 · 알림폼', payhist:'정산 내역', schedule:'전체 일정', classmgmt:'휴일 관리', academy:'학원 관리'};
  const tl=document.getElementById('todayLine');
  tl.textContent=labels[v]||''; tl.style.display=labels[v]?'block':'none';
  ({home:renderHome,today:renderToday,students:renderStudents,settle:renderSettle,
    counsel:renderCounsel,report:renderReport,admin:renderAdmin,manage:renderManage,send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule,classmgmt:renderClassMgmt,academy:renderAcademy}[v])();
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
    absentLog, makeupLog, packHistory, bills, billSeq, holidaysExtra, workdaysExtra, skipLog, academy, autoSend, msgTemplates,
    live, tempToday:[...tempToday], logbook,   // 등원중 상태 · 오늘만 추가 · 오늘 알림
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
  if(d.msgTemplates) for(const k in d.msgTemplates){ if(msgTemplates[k]) msgTemplates[k]=Object.assign({sms:'',code:''}, d.msgTemplates[k]); }
  // 등원 중 상태: 오늘 것만 복원(어제 것이 남아 '수업 중'으로 보이지 않게)
  if(d.live && typeof d.live==='object'){
    const t=dayKey(now.getTime()); const nl={};
    for(const k in d.live){ const v=d.live[k]; if(typeof v==='number' && dayKey(v)===t) nl[k]=v; }
    live=nl;
  }
  if(Array.isArray(d.tempToday)) tempToday=new Set(d.tempToday);
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
    send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule,classmgmt:renderClassMgmt,academy:renderAcademy};
  (map[v]||renderHome)();
}
