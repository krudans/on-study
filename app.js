/* ===== 상태 (실제 데이터는 Firestore에서 로드) ===== */
const WD=['일','월','화','수','목','금','토'];
const now=new Date();
const todayIdx=now.getDay();

// 패키지 금액 (설정에서 수정 가능)
let packages={8:100000, 12:200000};

// 학생: 계약 회차(plan) + 요일/시간
const students=[];

// 현재 패키지에서 완료한 횟수 (정산하면 0으로 리셋)
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
// 지난 차수(팩) 이력. {no,plan,done,settledDate}
let packHistory={};
// 학생의 전체 차수 목록(지난 + 현재)
function allPacks(st){
  const past=packHistory[st.id]||[];
  const cur={no:past.length+1, plan:st.plan, done:Math.min(cycleDone[st.id]||0,st.plan), current:true};
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
function beforeStart(s,ms){ return s.startDate ? ms < s.startDate : false; }

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

// 이번 클래스(현재 회차 묶음) 정보: 시작·종료·세션/결석/보강 날짜
// 규칙: 출석(정규수업)+보강 = 회차로 카운트, 결석은 카운트 제외(그만큼 밀림)
function currentClassInfo(s){
  const plan=s.plan||0;
  const info={start:null, end:null, sessions:[], absents:[], makeups:[], windowDates:new Set()};
  if(!plan || !s.days || !s.days.length) return info;
  const absentSet=new Set((absentLog[s.id]||[]).map(dayKey));
  const makeupSet=new Set((makeupLog[s.id]||[]).map(mk=>dayKey(mk.t)));
  const done=Math.min(cycleDone[s.id]||0, plan);
  const todayK=dayKey(now.getTime());
  const isSession=(d)=>{ const k=dayKey(d.getTime());
    if(makeupSet.has(k)) return true;
    if(s.days.includes(d.getDay()) && !absentSet.has(k)) return true;
    return false; };
  // 1) 이번 클래스 시작일: 수동값 우선, 없으면 오늘 기준 완료 회차만큼 뒤로 세기
  let start=null;
  if(s.cycleStart){ start=dayKey(s.cycleStart); }
  else if(done<=0){
    for(let i=0;i<400;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()+i); if(isSession(dd)){ start=dayKey(dd.getTime()); break; } }
  } else {
    const found=[];
    for(let i=0;i<800 && found.length<done;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()-i); if(isSession(dd)) found.push(dayKey(dd.getTime())); }
    start = found.length ? found[found.length-1] : todayK;
  }
  if(start==null) start=todayK;
  info.start=start;
  // 2) 시작부터 앞으로 plan개 세션 수집 (결석은 표시만, 카운트 제외 → 밀림)
  let count=0;
  for(let i=0;i<800 && count<plan;i++){
    const dd=new Date(start); dd.setDate(dd.getDate()+i);
    const k=dayKey(dd.getTime());
    if(s.days.includes(dd.getDay()) && absentSet.has(k) && !makeupSet.has(k)){ info.absents.push(k); info.windowDates.add(k); continue; }
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

const live={};       // sid -> 시작 epoch(ms)
let ticker=null;
let logbook=[];      // 오늘 보낸 알림 {sid,kind,text,time}
const nowHM=()=>new Date().toTimeString().slice(0,5);
function logAdd(sid,kind,text){logbook.unshift({sid,kind,text,time:nowHM()});
  if(document.getElementById('v-home').classList.contains('active'))renderHome();}

/* ===== 유틸 ===== */
const won=(n)=>n.toLocaleString('ko-KR')+'원';
const hm=(d)=>new Date(d).toTimeString().slice(0,5);
const fmtDur=(min)=>{const h=Math.floor(min/60),m=Math.round(min%60);
  return h?(m?`${h}시간 ${m}분`:`${h}시간`):`${m}분`;};
const priceOf=(st)=>packages[st.plan]||0;
const remainOf=(st)=>Math.max(0, st.plan-(cycleDone[st.id]||0));
const needSettle=(st)=>(cycleDone[st.id]||0)>=st.plan;
const doneToday=(sid)=>sessions.find(s=>s.sid===sid && s.date.toDateString()===now.toDateString());
function monthCount(sid){return sessions.filter(s=>s.sid===sid &&
  s.date.getMonth()===now.getMonth() && s.date.getFullYear()===now.getFullYear()).length;}
const st=(id)=>students.find(s=>s.id===id);

let tempToday=new Set();
let absentToday=new Set();   // 오늘 결석 처리한 학생 id
const isTodayStudent=(x)=>x.days.includes(todayIdx)||tempToday.has(x.id);
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

/* ===== 홈 ===== */
function renderHome(){
  const el=document.getElementById('v-home');
  const roster=todayRoster();
  const absentN=roster.filter(x=>absentToday.has(x.id)).length;
  const total=roster.length - absentN;
  const liveN=Object.keys(live).length;
  const doneN=roster.filter(x=>doneToday(x.id)&&live[x.id]==null).length;
  const remain=Math.max(0,total-doneN-liveN);
  const monthDone=students.reduce((a,x)=>a+monthCount(x.id),0);
  const needList=students.filter(needSettle);
  const openList=Object.keys(live).map(id=>st(+id));

  const pct=total?doneN/total:0, C=2*Math.PI*42, off=C*(1-pct);
  const ringColor=(total&&doneN===total)?'var(--green)':'var(--amber)';

  let todos=[];
  openList.forEach(x=>todos.push({ic:'amber',tx:`${x.name} 수업 진행 중 — 끝나면 종료를 눌러주세요`,v:'today'}));
  needList.forEach(x=>todos.push({ic:'clay',tx:`${x.name} ${x.plan}회 모두 완료 — 정산할 때가 됐어요`,v:'settle'}));

  el.innerHTML=`
    <div class="greet"><div class="hi">안녕하세요, 원장님</div>
      <div class="dt">${now.getMonth()+1}월 ${now.getDate()}일 ${WD[todayIdx]}요일</div></div>
    <div class="hero">
      <div class="ring">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="42" fill="none" stroke="#EAE8E1" stroke-width="8"/>
          <circle cx="48" cy="48" r="42" fill="none" stroke="${ringColor}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg>
        <div class="center"><div class="n">${doneN}</div><div class="l">/ ${total} 완료</div></div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><span class="k">오늘 남은 수업</span><span class="v">${remain}명${liveN?` · <span class="live">${liveN} 진행</span>`:''}</span></div>
        <div class="hstat"><span class="k">이번 달 수업</span><span class="v">${monthDone}회</span></div>
        <div class="hstat"><span class="k">정산 필요</span><span class="v ${needList.length?'warn':''}">${needList.length}명</span></div>
      </div>
    </div>
    <div class="actions">
      <button class="act primary" onclick="goTab('today')"><div class="t">출석체크</div><div class="d">오늘 ${remain}명 남음</div></button>
      <button class="act" onclick="goTab('settle')"><div class="t">정산</div><div class="d">회차·수업료 정리</div></button>
    </div>
    <div class="actions" style="margin-top:-12px">
      <button class="act" onclick="goTab('counsel')"><div class="t">학부모 상담</div><div class="d">상담 메모·카톡</div></button>
      <button class="act" onclick="goTab('report')"><div class="t">결산</div><div class="d">월별 매출 정리</div></button>
    </div>
    <div class="actions" style="margin-top:-12px">
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
  const list=todayRoster();
  // 상단 요약
  const total=list.length;
  const absentN=list.filter(s=>absentToday.has(s.id)).length;
  const attendN=list.filter(s=>live[s.id]!=null||doneToday(s.id)).length; // 등원=온 아이(하원 포함)
  const summary=`<div class="attn-sum">
    <div class="as-item"><div class="as-v num">${total}</div><div class="as-k">오늘 총원</div></div>
    <div class="as-item"><div class="as-v num" style="color:var(--green)">${attendN}</div><div class="as-k">등원</div></div>
    <div class="as-item"><div class="as-v num" style="color:var(--clay)">${absentN}</div><div class="as-k">결석</div></div>
  </div>`;

  const cards=list.map(s=>{
    const isLive=live[s.id]!=null;
    const isTemp=tempToday.has(s.id)&&!s.days.includes(todayIdx);
    const isAbsent=absentToday.has(s.id);
    const done=doneToday(s.id);
    const dayNo=Math.min((cycleDone[s.id]||0)+((isLive||done)?0:0), s.plan); // 현재 회차 진행
    const shownDay=Math.min(cycleDone[s.id]||0, s.plan);

    let pill='<span class="pill wait">대기</span>';
    if(isLive)pill='<span class="pill live">수업 중</span>';
    else if(done)pill='<span class="pill done">하원 완료</span>';
    else if(isAbsent)pill='<span class="pill absent">결석</span>';
    else if(isTemp)pill='<span class="pill temp">임시</span>';

    const timeLine=(done&&done.start)
      ? `<div class="timeline-done"><span class="rng">${hm(done.start)} ~ ${hm(done.end)}</span><span class="dur">${fmtDur(done.min)} 수업</span></div>`
      : (done?`<div class="timeline-done"><span class="rng">오늘 수업 완료</span><span class="dur">시각 기록 없음</span></div>`:'');

    let action='';
    if(done){
      action=`<button class="btn ghost" onclick="undoToday(${s.id})">오늘 완료 취소</button>`;
    } else if(isAbsent){
      action=`<button class="btn ghost" onclick="clearAbsent(${s.id})">결석 취소</button>`;
    } else {
      // 등원 / 하원 / 결석 항상 표시. 수업 중이면 하원 강조.
      action=`<div class="attn-btns four">
        <button class="btn ${isLive?'ghost':'start'}" onclick="startSession(${s.id})">등원</button>
        <button class="btn ${isLive?'stop':'hawon'}" onclick="stopSession(${s.id})">하원</button>
        <button class="btn absentbtn" onclick="markAbsent(${s.id})">결석</button>
        <button class="btn makeupbtn" onclick="openMakeupSheet(${s.id})">보강</button>
      </div>
      <div class="row-btns">
        <button class="btn ghost small" onclick="manualComplete(${s.id})">바로 완료</button>
        ${isTemp?`<button class="btn ghost small" onclick="removeTemp(${s.id})">오늘 빼기</button>`:''}
      </div>`;
    }
    const cardStyle = done ? 'opacity:.5;border-color:var(--line)'
      : (!isAbsent && !isLive) ? 'border:1.6px solid var(--ink);box-shadow:0 2px 8px rgba(30,25,15,.07)'
      : '';
    return `<div class="card" style="${cardStyle}">
      <div class="card-top"><div class="who">
        <div class="name">${s.name}
          <button class="daychip" onclick="toggleCal(${s.id})">${shownDay}/${s.plan}회 ▾</button></div>
        <div class="plan">${isTemp?'오늘 임시 추가':'예정 '+s.time}</div></div>${pill}</div>
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
      ${timeLine}
      ${action}
      <div class="resend">
        <button onclick="resend(${s.id},'start')">↩ 등원 알림</button><span class="sep">·</span>
        <button onclick="resend(${s.id},'end')">↩ 하원 알림</button>
      </div>
    </div>`;
  }).join('');
  const empty=list.length?'':'<div class="empty">오늘 예정된 학생이 없어요. 아래에서 추가할 수 있어요.</div>';
  const cand=students.filter(x=>!isTodayStudent(x));
  const addBox=`<div class="add-wrap"><div class="add-title">오늘만 추가하기</div>
    <div class="add-desc">보강·대체 등 오늘만 오는 학생을 골라 출석부에 넣어요. 정규 요일표는 바뀌지 않아요.</div>
    ${cand.length?`<div class="chips">`+cand.map(x=>`<button class="chip" onclick="addTemp(${x.id})">＋ ${x.name}</button>`).join('')+`</div>`
      :`<div class="add-desc" style="margin:0">추가할 수 있는 다른 학생이 없어요.</div>`}</div>`;
  el.innerHTML=summary+empty+cards+addBox;
  updateLiveCount();
}
let openCal=null, calCur=null, payHistOpen=false;
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

function buildCalendar(s){
  const info=currentClassInfo(s);
  const sessionSet=new Set(info.sessions);
  const absentSet=new Set(info.absents);
  const makeupSet=new Set(info.makeups);
  const todayT=dayKey(now.getTime());
  const y=calCur.y, m=calCur.m;
  const first=new Date(y,m,1).getDay();
  const days=new Date(y,m+1,0).getDate();

  let grid='';
  ['일','월','화','수','목','금','토'].forEach(w=>grid+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++)grid+='<div></div>';
  for(let dd=1;dd<=days;dd++){
    const t=new Date(y,m,dd).getTime();
    let c='cal-d', mk='';
    if(absentSet.has(t)) c+=' absent';
    else if(sessionSet.has(t)){
      if(makeupSet.has(t)){ c+=(t<=todayT?' att':' up'); mk='style="outline:2px solid var(--amber);outline-offset:-2px"'; }
      else c+=(t<=todayT?' att':' up');
    }
    if(t===todayT)c+=' tod';
    grid+=`<div class="${c}" ${mk}>${dd}</div>`;
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
    <span class="cf-v">${mkText} <button class="cf-more" onclick="openMakeupSheet(${s.id})">＋ 지정</button></span></div>`;

  // 이번 회차 요약(시작~종료)
  const rangeLine=`<div class="cf-row"><span class="cf-k">이번 회차</span>
    <span class="cf-v">${fmtD(info.start)} ~ ${fmtD(info.end)} · ${info.sessions.filter(t=>t<=todayT).length}/${s.plan}회</span></div>`;

  return `<div class="cal">
    <div class="cal-nav"><button onclick="calNav(${s.id},-1)" aria-label="이전 달">‹</button>
      <span>${y}년 ${m+1}월</span>
      <button onclick="calNav(${s.id},1)" aria-label="다음 달">›</button></div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend"><span><i class="lg att"></i>출석</span><span><i class="lg up"></i>예정</span>
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
  closeSheet(); renderToday();
  showToast(`${st(id).name} 오늘 학습내용 저장됨`);
}
function deleteLesson(id){
  const i=lessons.findIndex(l=>l.sid===id && l.date.toDateString()===now.toDateString());
  if(i>=0)lessons.splice(i,1);
  closeSheet(); renderToday(); showToast('오늘 학습내용을 삭제했어요');
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
  closeSheet();
  if(openCal===id)document.getElementById('cal-'+id).innerHTML=buildCalendar(st(id));
  showToast(`${st(id).name} 보강 ${d.getMonth()+1}.${d.getDate()}${tm?' '+tm:''} 추가됨`);
}
function markAbsent(id){ absentToday.add(id);
  const t=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  (absentLog[id]=absentLog[id]||[]); if(!absentLog[id].includes(t))absentLog[id].push(t);
  renderToday();
  const s=st(id); showToast(`${s.name} 결석 처리 (회차 차감 없음)`, ()=>openNotify(id,'absent'), s.kakao?'결석 알림':'문자'); }
function clearAbsent(id){ absentToday.delete(id);
  const t=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  if(absentLog[id])absentLog[id]=absentLog[id].filter(x=>x!==t);
  renderToday(); }
function addTemp(id){tempToday.add(id);renderToday();}
function removeTemp(id){tempToday.delete(id);renderToday();}

/* 완료 처리(1회 차감). start/end 있으면 시각·소요시간 함께 기록 */
function complete(id, start, end){
  const rec={sid:id, date:new Date()};
  if(start&&end){ rec.start=start; rec.end=end; rec.min=Math.max(1,Math.round((end-start)/60000)); }
  sessions.push(rec); cycleDone[id]=(cycleDone[id]||0)+1;
}
function undoToday(id){
  const i=sessions.findIndex(s=>s.sid===id && s.date.toDateString()===now.toDateString());
  if(i>=0){sessions.splice(i,1); cycleDone[id]=Math.max(0,(cycleDone[id]||0)-1);}
  renderToday();
  showToast(`${st(id).name} 오늘 완료를 취소했어요 (1회 되돌림)`);
}
function manualComplete(id){
  complete(id); renderToday();
  const s=st(id);
  showToast(`${s.name} 완료로 체크됨 · ${cycleDone[id]}/${s.plan}회`, ()=>openNotify(id,'end'), s.kakao?'종료 알림':'문자');
}

function startSession(id){
  live[id]=Date.now(); renderToday(); ensureTicker();
  const s=st(id);
  showToast(`${s.name} 수업 시작 · ${s.guardian}에게 시작 알림`, ()=>openNotify(id,'start'), s.kakao?'카톡 열기':'문자 열기');
}
function stopSession(id){
  const start=live[id], end=Date.now();
  delete live[id]; complete(id,start,end); renderToday();
  const s=st(id);
  if(!Object.keys(live).length&&ticker){clearInterval(ticker);ticker=null;}
  showToast(`${s.name} 수업 완료 · ${cycleDone[id]}/${s.plan}회`, ()=>openNotify(id,'end'), s.kakao?'종료 알림':'문자');
}
function resend(id,kind){ openNotify(id,kind); }
/* 실제 발송: 문자는 sms:로 문자앱이 내용 채워 열림, 카톡은 (특정 대화방 자동입력 불가라)
   메시지를 복사한 뒤 카톡 앱을 열어 붙여넣기. 데스크탑에선 문자앱이 없어 열리지 않을 수 있어요(모바일 앱에서 사용). */
let _notifyCtx=null;
function buildNotifyText(s,kind){
  const word=kind==='start'?'등원했습니다':kind==='absent'?'결석 처리되었습니다':'하원했습니다';
  const t=new Date().toTimeString().slice(0,5);
  return `[On-study] ${s.name} 학생이 ${t}에 ${word}.`;
}
function openMsgTo(i){
  const g=_notifyCtx.gs[i], text=_notifyCtx.text;
  const digits=(g.phone||'').replace(/[^0-9]/g,'');
  if(g.kakao){
    if(navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
    showToast(`${g.name} 카톡: 메시지를 복사했어요 · 카톡에서 붙여넣기 하세요`);
    setTimeout(()=>{ try{ location.href='kakaotalk://'; }catch(e){} }, 400);
  } else {
    if(!digits){ showToast(`${g.name} 연락처가 없어 문자를 열 수 없어요`); return; }
    const sep = /iphone|ipad|ipod|mac/i.test(navigator.userAgent) ? '&' : '?';
    location.href = `sms:${digits}${sep}body=${encodeURIComponent(text)}`;
  }
}
function openNotify(id,kind){
  const s=st(id);
  const word=kind==='start'?'등원':kind==='absent'?'결석':'하원';
  const gs=guardiansOf(s);
  const text=buildNotifyText(s,kind);
  gs.forEach(g=>logAdd(id,kind==='absent'?'absent':kind,`${s.name} ${word} → ${g.name}(${g.kakao?'카톡':'문자'})`));
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
let studentSort='name';
function setStudentSort(m){ studentSort=m; renderStudents(); }
function studentCard(s, forDay){
  const done=cycleDone[s.id]||0, need=needSettle(s);
  const eduTxt=[s.grade?gradeLabel(s.grade):'', s.school||''].filter(Boolean).join(' · ');
  const dayTime=(forDay!=null)?`⏰ ${WD[forDay]} ${timeFor(s,forDay)}`:'';
  const infoLine = (eduTxt||dayTime) ? `<div class="mg-line">${[eduTxt?'🎓 '+eduTxt:'', dayTime].filter(Boolean).join(' · ')}</div>` : '';
  return `<div class="row">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${infoLine}
    <div class="stats">
      <div class="stat"><div class="k">이번 패키지</div><div class="v">${Math.min(done,s.plan)}/${s.plan}회</div></div>
      <div class="stat"><div class="k">남은 횟수</div><div class="v">${remainOf(s)}회</div></div>
      <div class="stat"><div class="k">이번 달</div><div class="v">${monthCount(s.id)}회</div></div>
    </div>
    <span class="flag ${need?'need':'ok'}">${need?'정산 필요':'진행 중'}</span>
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
  } else { // 요일별 + 시간대 소제목
    const dayOrder=[1,2,3,4,5,6,0];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    body = dayOrder.map(d=>{
      const list=students.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일 (${list.length}명)`); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=studentCard(s,d); });
      return html;
    }).join('');
  }
  if(!students.length) body='<div class="empty">등록된 학생이 없어요.</div>';
  el.innerHTML=sortBar+body;
}

/* ===== 정산 ===== */
function renderSettle(){
  const el=document.getElementById('v-settle');
  const monthPaid=payments.filter(p=>p.date.getMonth()===now.getMonth()&&p.date.getFullYear()===now.getFullYear())
    .reduce((a,p)=>a+p.amount,0);
  const waiting=students.filter(needSettle).reduce((a,s)=>a+priceOf(s),0);
  const needN=students.filter(needSettle).length;
  const mL=(now.getMonth()+1)+'월';
  el.innerHTML=`
    <div class="sum"><div class="k">${mL} 정산 완료</div><div class="big num">${won(monthPaid)}</div>
      <div class="split">
        <div><div class="k">정산 대기</div><div class="v">${won(waiting)}</div></div>
        <div><div class="k">정산 필요</div><div class="v">${needN}명</div></div>
      </div></div>`+
    students.map(s=>{
      const done=cycleDone[s.id]||0, need=needSettle(s);
      let action = need
        ? `<div class="row-btns">
             <button class="btn pay small" onclick="openSettleMsg(${s.id})">납입 요청 메시지</button>
             <button class="btn settle small" onclick="markSettled(${s.id})">정산 완료 처리</button>
           </div>`
        : '';
      return `<div class="row">
        <div class="row-top"><span class="name">${s.name}</span><span class="amt">${won(priceOf(s))}</span></div>
        <div class="stats">
          <div class="stat"><div class="k">계약</div><div class="v">${s.plan}회</div></div>
          <div class="stat"><div class="k">진행</div><div class="v">${Math.min(done,s.plan)}/${s.plan}</div></div>
          <div class="stat"><div class="k">상태</div><div class="v" style="color:${need?'var(--clay)':'var(--green)'}">${need?'정산 필요':'진행 중'}</div></div>
        </div>${action}</div>`;
    }).join('');
}
function markSettled(id){
  const s=st(id);
  const hist=packHistory[id]||(packHistory[id]=[]);
  hist.push({no:hist.length+1, plan:s.plan, done:cycleDone[id]||0,
    start:cycleStartOf(s)||null, settledDate:new Date()});
  payments.push({sid:id,date:new Date(),plan:s.plan,amount:priceOf(s)});
  cycleDone[id]=0;              // 새 패키지 시작
  s.cycleStart=null; s.cycleEnd=null;  // 새 회차는 자동 계산(과거는 packHistory에 보존)
  saveData(); renderSettle();
  showToast(`${s.name} ${s.plan}회 정산 완료 · 새 패키지 시작`);
}
function openSettleMsg(id){
  const s=st(id); const mL=(now.getMonth()+1)+'월';
  const text=`안녕하세요, ${s.guardian}님.
${s.name} 학생이 ${s.plan}회 수업을 모두 마쳤습니다.

· 이번 ${mL} 수업 ${monthCount(s.id)}회
· 다음 ${s.plan}회권 수업료 : ${won(priceOf(s))}

결제 안내드립니다. 감사합니다.`;
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
function sendVia(ch,id){
  closeSheet(); const s=st(id);
  logAdd(id,'pay',`${s.name} 납입 요청 (${ch}) → ${s.guardian}`);
  showToast(`${ch} 앱이 열리고 메시지가 채워집니다 · 전송은 원장님이 확인 후`);
}
function closeSheet(){document.getElementById('scrim').classList.remove('show');}
document.getElementById('scrim').addEventListener('click',e=>{if(e.target.id==='scrim')closeSheet();});

/* ===== 설정 (관리자) ===== */
const OWNER_EMAIL='mhstory@gmail.com';
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
    {k:'send',t:'발송 · 상담',d:'카톡/문자 발송, 상담 기록',ready:true},
    {k:'guide',t:'결과지 · 알림폼',d:'학습 안내 양식 만들고 발송',ready:true},
    {k:'payhist',t:'정산 내역',d:'차수별 결제 이력',ready:true},
    {k:'people',t:'관리자 등록',d:'로그인 권한이 있는 사람 관리',ready:true},
    {k:'basic',t:'수업 기본 설정',d:'패키지 금액 · 마감 알림 시각',ready:true},
  ];
  el.innerHTML=`
    <div class="acct">
      <div class="acct-av">${(currentUser?currentUser.name:'원')[0]}</div>
      <div class="acct-info"><div class="acct-name">${currentUser?currentUser.name:'원장님'}</div>
        <div class="acct-mail">${currentUser?currentUser.email:OWNER_EMAIL}</div></div>
      <button class="acct-out" onclick="logout()">로그아웃</button>
    </div>
    <div class="admin-menu">
      ${menu.map(m=>`<button class="am-item" onclick="${m.k==='students'?`goTab('manage')`:m.k==='basic'?`openAdmin('basic')`:m.k==='people'?`openAdmin('people')`:m.k==='send'?`goTab('send')`:m.k==='guide'?`goTab('guide')`:m.k==='payhist'?`goTab('payhist')`:`comingSoon('${m.t}')`}">
        <div class="am-tx"><div class="am-t">${m.t}</div><div class="am-d">${m.d}</div></div>
        <div class="am-go">${m.ready?'›':'준비 중'}</div></button>`).join('')}
    </div>`;
}
function adminBasic(){
  return `<button class="back" onclick="openAdmin(null)">‹ 설정</button>
    <h2 class="page-h">수업 기본 설정</h2>
    <div class="set-sec">
      <h3>패키지 금액</h3>
      <div class="cap">회차별 수업료를 정해요. 정산 금액이 여기 값으로 자동 계산됩니다.</div>
      <div class="price-row"><label>8회</label>
        <div class="price-in"><input type="number" value="${packages[8]}" onchange="setPrice(8,this.value)"><span>원</span></div></div>
      <div class="price-row"><label>12회</label>
        <div class="price-in"><input type="number" value="${packages[12]}" onchange="setPrice(12,this.value)"><span>원</span></div></div>
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
function logout(){ adminSection=null; doLogout(); }  // doLogout: auth.js
let closeTime='20:00';
function setCloseTime(v){ closeTime=v; saveData(); }
function resetData(){ location.reload(); }
function setPrice(plan,val){ packages[plan]=parseInt(val||0,10)||0; }
function setPlan(id,plan){ st(id).plan=plan; }

let nextId=100;
function manageCard(s, forDay){
  const days=s.days.slice().sort((a,b)=>a-b).map(d=>WD[d]).join('·');
  const timeTxt = (s.dayTimes&&Object.keys(s.dayTimes).length)
    ? s.days.slice().sort((a,b)=>a-b).map(d=>`${WD[d]} ${timeFor(s,d)}`).join(' / ')
    : (s.time||'-');
  const gLines = guardiansOf(s).map(g=>`👤 ${g.name} · ${g.phone||'-'} · ${g.kakao?'카톡':'문자'}`).join('<br>');
  const startTxt = s.startDate ? new Date(s.startDate).toLocaleDateString('ko-KR') : '미입력';
  const eduTxt = [s.grade?gradeLabel(s.grade):'', s.school||''].filter(Boolean).join(' · ');
  const eduLine = eduTxt ? `<div class="mg-line">🎓 ${eduTxt}</div>` : '';
  const dayTime = (forDay!=null) ? `<div class="mg-line">⏰ ${WD[forDay]} ${timeFor(s,forDay)}</div>` : '';
  return `<div class="row">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${eduLine}${dayTime}
    <div class="mg-line">🗓 ${days}요일 · ${timeTxt}</div>
    <div class="mg-line">📅 시작일 ${startTxt} · 현재 ${cycleDone[s.id]||0}/${s.plan}회</div>
    <div class="mg-line">🔄 이번 회차 ${fmtD(cycleStartOf(s))} ~ ${fmtD(cycleEndOf(s))} (예상)</div>
    <div class="mg-line">${gLines}</div>
    <div class="row-btns" style="margin-top:11px">
      <button class="btn ghost small" onclick="openStudentSheet(${s.id})">수정</button>
      <button class="btn ghost small" onclick="askDeleteStudent(${s.id})">삭제</button>
    </div></div>`;
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
  } else { // day: 월~일, 각 요일 안에서 시간대별 소제목 + 시간순
    const dayOrder=[1,2,3,4,5,6,0];
    const timeH=(t)=>`<div style="font-size:12px;font-weight:600;color:var(--amber);margin:12px 2px 6px 4px">${t}</div>`;
    body = dayOrder.map(d=>{
      const list=students.filter(s=>s.days.includes(d))
        .sort((a,b)=>(timeFor(a,d)||'').localeCompare(timeFor(b,d)||'') || byName(a,b));
      if(!list.length) return '';
      let html=grpH(`${WD[d]}요일 (${list.length}명)`); let curT=null;
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(t); } html+=manageCard(s,d); });
      return html;
    }).join('');
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
  const curCycle = id ? ((cycleDone[id]||0)+1) : 1;  // 진행 중인 회차 번호 = 완료+1
  const preset = (s.plan===8||s.plan===12);
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
    <div class="fld"><label>시작일 <span class="hint">모르면 비워두세요</span></label>
      <input type="date" id="stStart" class="note-select" value="${startVal}"></div>
    <div class="fld"><label>패키지 회차 <span class="hint">이 회차를 다 채우면 정산</span></label>
      <div class="seg2"><button type="button" id="pl8" class="${s.plan===8?'on':''}" onclick="pickPlan(8)">8회</button>
        <button type="button" id="pl12" class="${s.plan===12?'on':''}" onclick="pickPlan(12)">12회</button></div>
      <input type="number" id="stPlanCustom" class="note-select" min="1" style="margin-top:8px" placeholder="직접 입력 (예: 10, 16, 20)" value="${preset?'':s.plan}" oninput="pickPlan(null)"></div>
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
function pickPlan(p){const sheet=document.getElementById('sheet');
  if(p===null){ const v=+document.getElementById('stPlanCustom').value||0; sheet.dataset.plan=v;
    document.getElementById('pl8').classList.remove('on'); document.getElementById('pl12').classList.remove('on'); return; }
  sheet.dataset.plan=p; document.getElementById('stPlanCustom').value='';
  document.getElementById('pl8').classList.toggle('on',p===8);
  document.getElementById('pl12').classList.toggle('on',p===12);}
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
  let plan=+sheet.dataset.plan||0; if(plan<1){showToast('패키지 회차를 정해주세요');return;}
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
  if(!schedCur) schedCur=new Date(now.getFullYear(), now.getMonth(), 1);
  const y=schedCur.getFullYear(), m=schedCur.getMonth();
  const first=new Date(y,m,1), startDow=first.getDay(), dim=new Date(y,m+1,0).getDate();
  const todayMs=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
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
    listHtml=`<div class="block"><div class="block-h"><span class="h">${sd.getMonth()+1}월 ${sd.getDate()}일 ${WD[sd.getDay()]}요일</span>${list.length?`<span class="cnt">${list.length}</span>`:''}</div>`+
      (list.length? list.map(s=>{
        const t=timeFor(s,sd.getDay());
        const abs=(absentLog[s.id]||[]).some(x=>new Date(x).toDateString()===sd.toDateString());
        return `<div class="row" style="padding:12px 14px">
          <div class="row-top"><span class="name">${s.name}</span><span class="contract">${t}${abs?' · 결석':''}</span></div>
          <div class="mg-line">${guardiansOf(s).map(g=>g.name).join(', ')} · ${s.plan}회 중 ${cycleDone[s.id]||0}회</div>
        </div>`;}).join('')
        : `<div class="muted-card">이 날은 예정된 수업이 없어요.</div>`)+`</div>`;
  } else {
    listHtml=`<div class="muted-card" style="margin-top:14px">날짜를 누르면 그날 수업 예정 학생이 나와요.</div>`;
  }
  el.innerHTML=`<button class="back" onclick="goTab('home')">‹ 홈</button>
    <h2 class="page-h">전체 일정</h2>
    <p class="page-cap">등록된 학생들의 요일 스케줄이 자동으로 정리돼요. 날짜를 눌러 확인하세요.</p>
    <div class="sc-cal">
      <div class="sc-head"><button onclick="schedNav(-1)">‹</button>
        <span>${y}년 ${m+1}월</span><button onclick="schedNav(1)">›</button></div>
      <div class="sc-grid">${dows}${cells}</div>
    </div>
    ${listHtml}`;
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
  el.innerHTML=`<button class="back" onclick="goTab('admin')">‹ 설정</button>
    <h2 class="page-h">결과지 · 알림폼</h2>
    <p class="page-cap">학생별 학습내용·출결을 모아 학부모 학습 안내를 만들어요. 기본은 정산 시점, 원하면 이번 주·임시로 보낼 수 있어요.</p>
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
  closeSheet(); const s=st(id);
  logAdd(id,'pay',`${s.name} 학습 안내 (${ch}) → ${s.guardian}`);
  showToast(`${ch} 앱이 열리고 학습 안내가 채워집니다 · 전송은 원장님이 확인 후`);
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
  notes.push({sid,date:new Date(),text}); closeSheet();
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
  const waiting=students.filter(needSettle).reduce((a,s)=>a+priceOf(s),0);

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
  saveData();
  document.querySelectorAll('.bt').forEach(t=>t.classList.toggle('active',t.dataset.v===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.getElementById('v-'+v).classList.add('active');
  const dateStr=`${WD[todayIdx]}요일 ${now.getMonth()+1}월 ${now.getDate()}일`;
  const labels={home:'', today:'출석부 · '+dateStr, students:'학생', settle:'정산',
    counsel:'학부모 상담', report:'결산', admin:'설정', manage:'학생 관리', send:'발송 · 상담', guide:'결과지 · 알림폼', payhist:'정산 내역', schedule:'전체 일정'};
  const tl=document.getElementById('todayLine');
  tl.textContent=labels[v]||''; tl.style.display=labels[v]?'block':'none';
  ({home:renderHome,today:renderToday,students:renderStudents,settle:renderSettle,
    counsel:renderCounsel,report:renderReport,admin:renderAdmin,manage:renderManage,send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule}[v])();
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
    absentLog, makeupLog, packHistory,
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
}

/* 로그인 성공 후 auth.js가 호출 */
function initApp(){
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='flex';
  const dl=document.getElementById('todayLine');
  dl.textContent=`오늘 · ${WD[todayIdx]}요일 ${now.getMonth()+1}월 ${now.getDate()}일`;
  dl.style.display='none';
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
    send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule};
  (map[v]||renderHome)();
}
