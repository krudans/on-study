/* ONSTUDY-BUILD: 2026-07-29ad-btnname3 */
/* ★ 회차·기간 단일 소스 규칙 (2026-07-27)
     시작일 + 학생정보(요일·휴일·휴강·결석·보강) → classOf() 하나로만 계산한다.
       · 이번 클래스 : currentClassInfo(s) → cycleStartOf / cycleEndOf
       · 지난 클래스 : histClassOf(s,h)
       · 정산 건     : billClassOf(b)
     여기 말고 다른 곳에서 시작일·종료일·회차 날짜를 새로 만들지 말 것.
     '종료일을 오늘로 자르는' 보정도 넣지 말 것 (앱 연 날짜에 따라 값이 달라짐). */
/* ===== 상태 (실제 데이터는 Firestore에서 로드) ===== */
const WD=['일','월','화','수','목','금','토'];
const now=new Date();
const todayIdx=now.getDay();

// 클래스 금액 (설정에서 수정 가능)
/* ★ 요금표의 유일한 출처는 관리자 > 수업 기본 설정(저장 키: packages).
     코드에는 어떤 금액도 두지 않는다. 값이 없으면 화면에 '미설정'으로 보이고 발송이 막힌다.
     (예전에 여기 8:100000, 12:200000 이 박혀 있어서, 저장값이 아직 안 들어온 시점에
      만들어진 정산 건에 200,000원이 굳어 버리는 사고가 있었다.) */
let packages={};

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
/* ★ 2026-07-27h: 알림 문구를 코드에 박아 두지 않는다.
     문구는 '설정 > 알림 문구'에서 원장님이 적은 값(msgTemplates)만 쓴다.
     비어 있으면 코드가 문장을 만들어 내지 않고 발송을 막는다(홈 '챙길 일'에도 뜬다). */
let msgTemplates={
  start:  { sms:'', code:'' },
  end:    { sms:'', code:'' },
  absent: { sms:'', code:'' },
  settle: { sms:'', code:'' },
  guide:  { sms:'', code:'' }
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

/* ===== 수업 내용 갈래 · 문제 수 · 정답률 ===== 2026-07-28v
   원장님 지시 — "등록한 정보에 따라 교육부 수학 학습 카테고리를 알약으로, 기타는 직접 쓰게.
                 문제풀이는 10단위로 몇 문제, 정답률도 10단위로."
   ★ 갈래 이름을 적어 두는 곳은 여기 하나뿐이다(단일 소스). 화면도 셈도 그래프도 이 표만 본다.
   ★ 2022 개정 교육과정은 초등·중학교 모두 영역이 넷으로 같다
     — 수와 연산 / 변화와 관계 / 도형과 측정 / 자료와 가능성.
     아래 열 갈래는 그 넷을 공부방에서 쓰기 좋게 나눈 것이고, 갈래마다 속한 영역 번호(a)를
     같이 적어 두어 영역별로 묶어 셀 때 다시 정하지 않게 했다.
   ★ 초등 이전은 교육부 수학 교육과정에 단원이 없다(누리과정 '자연탐구').
     그래서 공부방에서 실제 하는 활동 이름으로 따로 둔다 — 없는 단원을 지어내지 않는다.
   ★ 저장되는 값은 k(영문 열쇠말)다. 보이는 이름(n)을 나중에 고쳐도 쌓인 기록이 깨지지 않는다. */
const CAT_AREAS=['수와 연산','변화와 관계','도형과 측정','자료와 가능성'];
const CATS_ELEM=[
  {k:'e-num',   a:0, n:'수'},
  {k:'e-add',   a:0, n:'덧셈과 뺄셈'},
  {k:'e-mul',   a:0, n:'곱셈과 나눗셈'},
  {k:'e-frac',  a:0, n:'분수'},
  {k:'e-dec',   a:0, n:'소수'},
  {k:'e-rule',  a:1, n:'규칙과 대응'},
  {k:'e-ratio', a:1, n:'비와 비율'},
  {k:'e-shape', a:2, n:'도형'},
  {k:'e-meas',  a:2, n:'측정'},
  {k:'e-data',  a:3, n:'자료와 그래프'}
];
const CATS_MID=[
  {k:'m-num',   a:0, n:'수와 연산'},
  {k:'m-expr',  a:1, n:'문자와 식'},
  {k:'m-eq',    a:1, n:'방정식'},
  {k:'m-ineq',  a:1, n:'부등식'},
  {k:'m-func',  a:1, n:'함수'},
  {k:'m-basic', a:2, n:'기본 도형과 작도'},
  {k:'m-solid', a:2, n:'평면도형과 입체도형'},
  {k:'m-prop',  a:2, n:'삼각형과 사각형의 성질'},
  {k:'m-sim',   a:2, n:'닮음·피타고라스·삼각비'},
  {k:'m-prob',  a:3, n:'확률과 통계'}
];
const CATS_PRE=[
  {k:'p-count', a:0, n:'수 세기'},
  {k:'p-split', a:0, n:'모으기와 가르기'},
  {k:'p-comp',  a:2, n:'크기·양 비교'},
  {k:'p-shape', a:2, n:'모양'},
  {k:'p-rule',  a:1, n:'규칙'},
  {k:'p-sort',  a:3, n:'분류하기'}
];
const CAT_ETC={k:'etc', a:-1, n:'기타'};
const CATSETS={ pre:{n:'초등 이전', list:CATS_PRE}, elem:{n:'초등 과정', list:CATS_ELEM}, mid:{n:'중등 과정', list:CATS_MID} };
/* 학년(students[].grade) → 어느 과정을 보여 줄지. 학년이 없으면 빈값 — 지어내지 않는다. */
function catsetForGrade(g){
  if(g==='pre') return 'pre';
  if(g==='m1'||g==='m2'||g==='m3'||g==='post') return 'mid';
  if(g && g.charAt(0)==='g') return 'elem';
  return '';
}
/* 열쇠말(k) 하나로 갈래를 찾는다 — 세 과정 어디에 있든 */
function catInfo(k){
  if(k===CAT_ETC.k) return CAT_ETC;
  for(const sname in CATSETS){ const f=CATSETS[sname].list.find(c=>c.k===k); if(f) return f; }
  return null;
}
function catName(k){ const c=catInfo(k); return c?c.n:''; }
/* 열쇠말 첫 글자로 어느 과정인지 되짚는다(e-=초등, m-=중등, p-=초등 이전) */
function catsetOfKeys(keys){
  const k=(keys||[]).find(x=>x&&x!=='etc');
  if(!k) return '';
  return k.charAt(0)==='e' ? 'elem' : (k.charAt(0)==='m' ? 'mid' : 'pre');
}
/* ★ 2026-07-29 원장님 지시 — "과제 : 해옴 / 안해옴 / 일부해옴"
   과제 값·이름·색을 만드는 곳은 여기 한 곳뿐이다. 화면·저장·분석이 모두 이것만 본다.
   저장되는 값은 열쇠말(k)이고, 사람이 읽는 말(n)은 여기서만 만든다.
   화면 차례는 해옴 → 일부 해옴 → 안 해옴(정도순)으로 둔다.
   c 는 색만 정한다 — g 초록(해옴) / a 주황(일부) / w 붉은색(안 해옴). */
const HWS=[{k:'done',n:'해옴',c:'g'},{k:'part',n:'일부 해옴',c:'a'},{k:'none',n:'안 해옴',c:'w'}];
function hwInfo(k){ return HWS.find(h=>h.k===k)||null; }
function hwName(k){ const h=hwInfo(k); return h?h.n:''; }
function hwCls(k){ const h=hwInfo(k); return h?h.c:'n'; }
const QN_STEPS=[10,20,30,40,50,60,70,80,90,100];      // 문제 수 — 10단위
const ACC_STEPS=[0,10,20,30,40,50,60,70,80,90,100];   // 정답률 — 10단위
/* ★ 2026-07-29 원장님 지시 — "학습내용을 전일에도 기록할 수 있게 해줘"(이전 출석부 날짜)
   그날 기록을 찾는 곳은 여기 한 곳뿐이다. 오늘도 지난 날도 이 함수를 쓴다. */
function lessonOn(sid, ms){ const k=dayKey(ms); return lessons.find(l=>l && l.sid===sid && l.date && dayKey(l.date.getTime())===k); }
function todayLesson(sid){ return lessonOn(sid, now.getTime()); }
/* 날짜 글자를 만드는 곳은 여기 한 곳뿐이다 — 시트 날짜 줄·기록 목록·저장 알림이 모두 이것만 쓴다 */
function lsnDateFull(ms){ const d=new Date(dayKey(ms));
  return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()}. (${WD[d.getDay()]})`; }
/* 저장 알림처럼 짧게 부를 때 — 오늘이면 '오늘', 아니면 위와 같은 날짜 글자 */
function lsnDayLabel(ms){ const k=dayKey(ms);
  return (k===dayKey(now.getTime())) ? '오늘' : lsnDateFull(k); }
/* ★ 2026-07-29z 원장님 지시 — "학습 버튼이 왜 2개임? 그냥 하나로 학습 이라고 하고"
   "모든 학습메모 기능을 기능이 같음"
   학습 단추(글자·색·눌렀을 때 여는 곳)를 만드는 곳은 여기 한 곳뿐이다.
   출석부 오늘 카드·지난 날 카드·학생 탭이 모두 이 함수만 쓴다 — 문을 여럿 만들지 않는다.
   ms 를 안 주시면 오늘이다. 적어 두신 날은 「학습 ✓」(초록), 아직 안 적은 날은 「학습」(주황 점선). */
/* ★ 2026-07-29ab 원장님 지시 — "학습 -> 학습기록하기 로 바꿔줘 제목이 너무 모호해"
   단추 글자를 만드는 곳은 여전히 여기 한 곳뿐이다. 자리에 따라 긴 이름/짧은 이름만 고른다.
   2026-07-29ad 원장님 지시 — "출석부도 학습+로 할 수 있죠?"
   → 자리마다 다른 이름을 두지 않는다. 학생 탭·출석부 오늘 줄·출석부 지난 날 줄 모두 같은 글자다.
     아직 안 적은 날 「학습+」(적으러 가기) · 적어 둔 날 「학습 ✓」(적어 둠).
     「학습+」는 짧아서 출석부 4칸(칸 77.5px)에 그대로 들어간다. */
function lsnBtn(sid, ms, cls){
  const has = lessonOn(sid, ms==null ? now.getTime() : ms);
  const tx = has ? '학습 ✓' : '학습+';
  return `<button class="btn ${has?'lsdone':'lsnew'}${cls?' '+cls:''}" onclick="openLessonSheet(${sid}${ms==null?'':','+ms})">${tx}</button>`;
}

// 보호자 목록 (신규 모델 guardians[] 우선, 없으면 구 필드에서 구성)
function guardiansOf(s){
  if(Array.isArray(s.guardians)&&s.guardians.length) return s.guardians;
  /* ★ 2026-07-27h2: 보호자 배열이 없는 옛 형태를 옮겨 담을 때도 코드가 '카톡'을 골라 주지 않는다.
       예전엔 kakao 값이 아예 없어도 s.kakao!==false 라서 무조건 카톡으로 잡혔다.
       값이 없으면 null(미설정) — 발송하는 쪽에서 막고 어디서 고치는지 알려 준다. */
  return [{name:s.guardian||'', phone:s.phone||'', kakao:(s.kakao===true?true:(s.kakao===false?false:null))}];
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
      .sc-cell.today{outline:2px solid #E03131;outline-offset:-2px}
      .sc-wheel::-webkit-scrollbar{display:none}
    `;
    (document.head||document.documentElement).appendChild(st);
  }catch(e){}
})();

/* 수업 시간(길이) — 화면에서 '고를 수 있는 목록'이다. 기본값이 아니다.
   ★ 2026-07-27g: defaultDur() 삭제. 코드가 60분/90분을 미리 골라 주지 않는다.
     원장님이 직접 고르지 않으면 saveStudent 의 필수값 검사에서 저장이 막힌다. */
const DUR_OPTS=[[60,'1시간'],[90,'1시간 30분']];
/* ★ 학생에게 저장된 수업 시간이 없으면 0(미설정)을 돌려준다. 코드 값으로 채우지 않는다. */
function durOf(s){ return (s&&+s.dur>0) ? +s.dur : 0; }
function durLabel(m){ const f=DUR_OPTS.find(o=>o[0]===+m); return f?f[1]:(m+'분'); }
/* 이름 옆 회차 뱃지 — 모든 화면 공통 표기 (2/12 형식, 7/27 지시) */
function cycBadge(s){ return `<span style="font-size:12.5px;font-weight:600;color:var(--muted);margin-left:7px;vertical-align:1px">${doneCountOf(s)}/${s.plan}</span>`; }
function endTimeOf(t, dur){ if(!t || !(+dur>0)) return '';   // ★ 시각·수업시간이 없으면 빈값(60분으로 가정하지 않는다)
  const [h,mi]=String(t).split(':').map(Number);
  const d=new Date(2000,0,1,h,mi+(+dur));
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
/* 12시간제 표기 — "15:00" → "오후 3:00" (출석부 표시용 단일 함수) */
function hm12(t){ if(!t) return ''; const p=String(t).split(':'); const h=+p[0], mi=+(p[1]||0);
  if(isNaN(h)) return t; const ap=h<12?'오전':'오후'; let hh=h%12; if(hh===0) hh=12;
  return `${ap} ${hh}:${String(mi).padStart(2,'0')}`; }
function rng12(a,b){ if(!a) return ''; if(!b) return hm12(a);
  const sameAp=(+String(a).split(':')[0]<12)===(+String(b).split(':')[0]<12);
  return hm12(a)+'~'+(sameAp? hm12(b).replace(/^오[전후] /,'') : hm12(b)); }

/* ===== 시각 고르개 (오전/오후 · 시 · 분) — 만드는 곳은 여기 하나뿐 ===== 2026-07-28s
   원장님 지시 — "둥근 시계판은 오전 오후가 헷갈려 다른 것으로 해달라고", 분은 "1분단위".
   휴대폰의 <input type="time"> 은 둥근 시계판(다이얼)을 띄운다. 오전/오후가 작게 붙어 있어
   실제로 권미진 학생 시각이 새벽 2:30 으로 저장되는 일이 있었다.
   대신 목록 세 개(오전/오후 · 1~12시 · 0~59분)로 받는다 - 휴대폰에서 위아래로 훑어 고르는 방식이다.

   ★ 저장되는 값의 모양은 예전과 똑같은 'HH:MM'(24시간) 글자다.
     진짜 값은 숨은 칸 하나(.ts-val)에만 있고, 목록 세 개는 그 값을 고치는 손잡이일 뿐이다(단일 소스).
     숨은 칸에 예전 <input type="time"> 과 똑같은 id·class·data-* 를 그대로 달아 두었기 때문에
     값을 읽어 가던 코드(document.getElementById('stTime').value 등)는 한 곳도 고칠 필요가 없다.
   ★ 값이 없으면 세 목록 모두 빈 상태로 뜬다 - 코드가 임의의 시각을 채워 넣지 않는다.
     세 개를 다 고르기 전까지 숨은 칸은 빈 글자이고, 저장은 기존 필수값 검사에서 그대로 막힌다. */
function tsParse(v){                      // 'HH:MM' → {ap,h,m} / 비었거나 이상하면 null
  if(!v) return null;
  const p=String(v).split(':'); const H=+p[0], M=+p[1];
  if(!Number.isFinite(H)||!Number.isFinite(M)) return null;
  return {ap: H<12?'AM':'PM', h: (H%12)||12, m: M};
}
function tsBuild(ap,h,m){                 // 세 목록 값 → 'HH:MM' / 하나라도 비면 빈 글자
  if(ap===''||h===''||m==='') return '';
  let H=(+h)%12; if(ap==='PM') H+=12;
  return `${String(H).padStart(2,'0')}:${String(+m).padStart(2,'0')}`;
}
/* ★ 2026-07-28t 원장님이 고르신 방식(시안 ㉮) ★
     평소엔 「오후 2:30」 한 줄 단추만 보이고, 누르면 아래에서 시트가 올라와
     오전/오후 · 시 · 분을 큰 글씨로 고른 뒤 [확인]을 누른다.
     빌드 s 의 목록 세 개는 한 줄을 세 칸이나 먹고 세 번을 눌러야 해서 원장님이 물리셨다.
   ★ 저장되는 값의 모양은 예전 그대로 'HH:MM'(24시간) 글자다.
     진짜 값은 여전히 숨은 칸 하나(.ts-val)에만 있다(단일 소스). 단추는 그 값을 보여 주는 껍데기다.
     숨은 칸에 예전 <input type="time"> 과 똑같은 id·class·data-* 가 그대로 달려 있으므로
     값을 읽어 가던 코드(document.getElementById('stTime').value 등)는 한 곳도 고칠 필요가 없다.
   ★ 값이 없으면 단추에 '고르지 않음'이라고 뜬다 - 코드가 임의의 시각을 채워 넣지 않는다.
     세 가지를 다 고르기 전에는 [확인]이 눌리지 않고 숨은 칸은 빈 글자로 남는다.
     그래서 저장은 기존 필수값 검사에서 그대로 막힌다.
   o.id / o.cls / o.data 는 숨은 칸에 그대로 붙는다.
   o.on 은 [확인]을 눌러 값이 갖춰졌을 때만 불린다(중간 상태로 저장하거나 경고하지 않는다). */
function tsLabel(v){ return v ? hm12(v) : '고르지 않음'; }
function timeSel(val, o){
  o=o||{};
  const v=val||'';
  const idA=o.id?` id="${o.id}"`:'', clsA=o.cls?` ${o.cls}`:'', dataA=o.data?` ${o.data}`:'';
  return `<span class="tsel"${o.on?` onchange="${o.on}"`:''}>`
    + `<button type="button" class="tsbtn${v?'':' empty'}" onclick="tsOpen(this)">`
    +   `<span class="tsb-v">${tsLabel(v)}</span><span class="tsb-c">고르기 ▾</span></button>`
    + `<input type="hidden"${idA} class="ts-val${clsA}"${dataA} value="${v}"></span>`;
}
/* 고르는 시트는 앱에 하나뿐이다 - 만드는 곳도 여기 하나뿐이다(단일 소스).
   학생 수정 시트(#scrim, z-index 50)가 이미 열린 위에 겹쳐 떠야 하므로 z-index 를 그보다 높게 준다. */
let tsWrap=null, tsAp='', tsH='', tsM='';
function tsEnsure(){
  let el=document.getElementById('tsScrim');
  if(el) return el;
  el=document.createElement('div');
  el.className='ts-scrim'; el.id='tsScrim';
  el.innerHTML=`<div class="ts-sheet">
      <h3>시각 고르기</h3>
      <div class="ts-now none" id="tsNow"></div>
      <div class="ts-cols">
        <div class="ts-col" id="tsColA"></div>
        <div class="ts-col" id="tsColH"></div>
        <div class="ts-col" id="tsColM"></div></div>
      <div class="ts-hint" id="tsHint"></div>
      <div class="sheet-btns">
        <button class="btn sms" type="button" onclick="tsClose()">취소</button>
        <button class="btn hawon" type="button" id="tsOk" onclick="tsConfirm()">확인</button></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e=>{ if(e.target.id==='tsScrim') tsClose(); });
  tsFill();
  return el;
}
function tsFill(){                        // 고를 거리를 한 번만 만들어 둔다
  const col=(id,items,k)=>{
    const c=document.getElementById(id); if(!c) return;
    c.innerHTML=items.map(it=>`<button type="button" data-v="${it.v}" onclick="tsSet('${k}','${it.v}')">${it.t}</button>`).join('');
  };
  const hs=[]; for(let i=1;i<=12;i++) hs.push({v:i,t:`${i}시`});
  const ms=[]; for(let i=0;i<60;i++) ms.push({v:i,t:`${String(i).padStart(2,'0')}분`});   // ★ 1분 단위 60개(원장님 지시)
  col('tsColA',[{v:'AM',t:'오전'},{v:'PM',t:'오후'}],'ap');
  col('tsColH',hs,'h');
  col('tsColM',ms,'m');
}
function tsOpen(btn){
  const w=btn.closest('.tsel'); if(!w) return;
  tsWrap=w;
  const t=tsParse(tsVal(w));
  tsAp=t?t.ap:''; tsH=t?t.h:''; tsM=t?t.m:'';    // ★ 값이 없으면 아무것도 고르지 않은 채로 연다
  tsEnsure().classList.add('show');
  tsMark(); tsPreview(); tsScroll();
}
function tsClose(){
  const el=document.getElementById('tsScrim'); if(el) el.classList.remove('show');
  tsWrap=null;
}
function tsSet(k,v){                      // 고른 것만 표시를 바꾼다(다시 그리지 않아 자리가 튀지 않는다)
  if(k==='ap') tsAp=v; else if(k==='h') tsH=+v; else tsM=+v;
  tsMark(); tsPreview();
}
function tsMark(){
  [['tsColA',String(tsAp)],['tsColH',String(tsH)],['tsColM',String(tsM)]].forEach(pair=>{
    const c=document.getElementById(pair[0]); if(!c) return;
    c.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.v===pair[1]));
  });
}
function tsScroll(){                      // 지금 값이 가운데 보이게 굴려 둔다
  ['tsColA','tsColH','tsColM'].forEach(id=>{
    const c=document.getElementById(id); if(!c) return;
    const on=c.querySelector('button.on');
    c.scrollTop = on ? (on.offsetTop - c.clientHeight/2 + on.offsetHeight/2) : 0;
  });
}
function tsPreview(){
  const v=tsBuild(tsAp,tsH,tsM);
  const now=document.getElementById('tsNow'), hint=document.getElementById('tsHint'), ok=document.getElementById('tsOk');
  /* 아직 다 못 골랐으면 고른 것만 보여 주고 나머지 자리는 빈 자리로 둔다 - 코드가 채워 넣지 않는다 */
  const part = (tsAp==='AM'?'오전 ':tsAp==='PM'?'오후 ':'')
             + (tsH!==''?tsH:'□') + ':' + (tsM!==''?String(tsM).padStart(2,'0'):'□□');
  if(now){ now.textContent = v ? hm12(v) : part; now.className = 'ts-now' + (v?'':' none'); }
  if(hint) hint.textContent = v ? '' : '오전/오후 · 시 · 분 세 가지를 모두 골라 주세요';
  if(ok)   ok.disabled      = !v;         // ★ 다 고르기 전에는 [확인]이 눌리지 않는다
}
function tsConfirm(){
  const v=tsBuild(tsAp,tsH,tsM);
  if(!v||!tsWrap) return;                 // 하나라도 안 골랐으면 아무 일도 하지 않는다
  const w=tsWrap, inp=w.querySelector('.ts-val');
  if(!inp) return;
  inp.value=v;                            // ★ 진짜 값을 쓰는 곳은 여기 하나뿐이다
  const b=w.querySelector('.tsbtn'), bv=w.querySelector('.tsb-v');
  if(bv) bv.textContent=hm12(v);
  if(b)  b.classList.remove('empty');
  tsClose();
  /* 예전 <select> 가 올려 주던 change 를 그대로 흉내 낸다 -
     timeSel(...,{on:'...'}) 로 걸어 둔 코드가 고친 곳 없이 그대로 불린다. */
  inp.dispatchEvent(new Event('change',{bubbles:true}));
}
function tsVal(w){ const v=w&&w.querySelector?w.querySelector('.ts-val'):null; return v?v.value:''; }
function tsDone(w,fn){ const v=tsVal(w); if(v) fn(v); }   // 값이 갖춰졌을 때만 부른다

/* 이 학생이 '요일마다 시간 다르게'인가 — 판단하는 곳은 여기 하나뿐이다(단일 소스). 2026-07-28s */
function perDayOn(s){ return !!(s && s.dayTimes && Object.keys(s.dayTimes).length); }
/* 이 학생의 그 요일 수업 시작 시각 — 시각을 정하는 곳은 여기 하나뿐이다.
   ★ 2026-07-28s 원장님 지시 — "요일마다 다르게면 공통 시각은 안 쓰는 값이다".
     그래서 요일마다 다르게인 학생은 공통 s.time 으로 떨어지지 않는다.
     그 요일 값이 없으면 빈값이다 — 코드가 다른 시각을 대신 넣지 않는다. */
function timeFor(s,dayIdx){
  if(perDayOn(s)) return s.dayTimes[dayIdx]||'';
  return s.time||'';        // ★ 없으면 빈값 — '16:00' 같은 임의 시각을 넣지 않는다
}
// 시작일 이전 날짜인지 (시작일 null이면 항상 false=제한 없음)
/* 학생의 '학원 등록일' — 출석부 명단 경계 전용.
   ★ 2026-07-27 무결성 통일: '이번 클래스 시작일'(cycleStartOf)과는 다른 항목이다.
     예전엔 cycleStart를 먼저 봐서 두 항목이 뒤섞였고, 화면마다 시작일이 달라졌다. */
function enrollStartMs(s){
  if(!s) return null;
  if(s.startDate) return dayKey(s.startDate);
  /* ★ 2026-07-27k: 지난 계약 이력(packHistory)까지 훑어서 '가장 이른 시작일'을 학원 등록일로 본다.
     예전에는 이번 계약 시작일만 봐서, 2차 계약으로 넘어간 학생은 등록일이 뒤로 밀려 보였다.
     2026-07-28 확인: 정도연·한지우·홍성재 3명 — 실제 첫 수업일 6.25 / 6.21 / 6.21 인데
     화면에는 이번 계약 시작일 7.27 / 7.22 / 7.21 이 뜨고 있었다. */
  const cands=[];
  (packHistory[s.id]||[]).forEach(h=>{ if(h && h.start!=null) cands.push(dayKey(h.start)); });
  if(s.cycleStart!=null) cands.push(dayKey(s.cycleStart));
  return cands.length ? Math.min.apply(null, cands) : null;
}
function beforeStart(s,ms){
  const k=dayKey(ms);
  if(isMakeupDay(s,k)) return false;   // 보강일은 클래스 시작 전이어도 수업하는 날 (명단 포함)
  const stt=enrollStartMs(s); return stt!=null ? k < stt : false;
}

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
/* ★ 2026-07-28q ★ 날짜칸(<input type="date">)에 넣을 글자를 만드는 단 하나의 자리.
   toISOString() 을 쓰면 안 된다 - 그것은 세계표준시(UTC) 기준이라 한국(+9시간)에서는
   그 날 0시가 전날 오후 3시로 계산되어 날짜칸에 '하루 전'이 찍힌다.
   (실제로 보강 날짜 칸의 기본값이 어제로 떠 있었다 - 이번에 같이 고쳤다.) */
function dateInputValue(ms){ if(!ms) return '';
  const d=new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
/* ★ 2026-07-27i 회차 단일 소스 ★
   완료 회차는 '달력이 초록으로 칠하는 그 날짜 목록'(currentClassInfo().sessions) 하나에서만 나온다.
   예전에는 저장된 카운터(cycleDone)와 달력이 각자 세서 두 숫자가 갈라졌다.
   2026-07-28 전수조사: 17명 중 11명이 어긋남 (이로엘 출석부 1/8회 · 달력 초록 3칸).
   이제 화면에 뜨는 숫자 = 달력 초록칸 수 — 구조적으로 다를 수가 없다.
   오늘 날짜는 [등원]을 눌렀을 때만 회차로 센다(안 눌렀으면 아직 안 한 수업). */
function pastSessionsOf(s, info){
  if(!s || !s.plan || !s.days || !s.days.length) return [];
  const todayK=dayKey(now.getTime());
  const list=(info||currentClassInfo(s)).sessions;
  return list.filter(k=> k<todayK || (k===todayK && hasRecordOn(s.id,k)));
}
// 이번 클래스의 '현재 회차'(오늘까지 완료된 수업 수) — 모든 화면이 이 함수 하나만 사용
function doneCountOf(s){ return pastSessionsOf(s).length; }
/* 2026-07-28l: 회차 숫자로 시작일을 역산하던 startForDone 을 삭제했다.
   같은 답을 주는 시작일이 여러 개라 값이 흔들렸고, 기록 없는 지난 수업일은 회차로 세지 않아
   종료일이 밀렸다. 이제는 역산하지 않고 실제로 수업한 날을 달력에서 켠다(rpTogglePast). */
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

/* ★★★ 회차·기간 단일 계산기 (2026-07-27 무결성 통일) ★★★
   시작일 + 학생정보(요일·휴일·휴강·결석·보강)만으로 회차 날짜를 앞으로 계산한다.
   이번 클래스·지난 클래스·정산 건 — 셋 다 반드시 이 함수 하나를 통과한다.
   ※ 여기 말고 다른 곳에서 회차 날짜나 종료일을 만들지 말 것. 화면마다 값이 달라진 원인이었음.
   opts.cutoff : 이 날짜 이전의 지난 수업일은 등원 기록이 없어도 '확정'으로 인정
                 진행 중 클래스 = seedUntil, 이미 끝난 클래스 = Infinity
   ※ '오늘'에 의존하는 부분은 missed 규칙 하나뿐이고, cutoff:Infinity면 완전히 결정적이다. */
function classOf(s, startMs, plan, opts){
  const info={start:null, end:null, sessions:[], absents:[], makeups:[], skips:[], missed:[], windowDates:new Set()};
  if(!s || !plan || !s.days || !s.days.length || startMs==null) return info;
  const cutoff=(opts && opts.cutoff!=null) ? opts.cutoff : 0;
  const start=dayKey(startMs);
  const todayK=dayKey(now.getTime());
  const absentSet=new Set((absentLog[s.id]||[]).map(dayKey));
  const skipSet=new Set((skipLog[s.id]||[]).map(dayKey));
  info.start=start;
  let count=0;
  for(let i=0;i<900 && count<plan;i++){
    const dd=new Date(start); dd.setDate(dd.getDate()+i);
    const k=dayKey(dd.getTime());
    // 결석·휴강 = 수업일이었지만 회차 아님 → 달력에만 표시하고 종료일이 뒤로 밀림
    if(s.days.includes(dd.getDay()) && !isMakeupDay(s,k)){
      if(absentSet.has(k)){ info.absents.push(k); info.windowDates.add(k); continue; }
      if(skipSet.has(k)){ info.skips.push(k); info.windowDates.add(k); continue; }
    }
    if(!isSessionDay(s,k)) continue;               // 수업일 판정도 단일 함수
    // 지난 수업일인데 등원 기록이 없으면(버튼 미입력) 회차로 세지 않고 종료일이 뒤로 밀림
    if(k < todayK && k >= cutoff && !hasRecordOn(s.id,k)){
      info.missed.push(k); info.windowDates.add(k); continue;
    }
    info.sessions.push(k);
    if(isMakeupDay(s,k)) info.makeups.push(k);
    info.windowDates.add(k);
    count++; if(count===plan) info.end=k;
  }
  return info;
}
/* 이번(진행 중) 클래스 — 시작일만 정하고 계산은 classOf에 맡긴다 */
function currentClassInfo(s){
  if(!s || !s.plan || !s.days || !s.days.length) return classOf(null,null,0);
  const plan=s.plan;
  const todayK=dayKey(now.getTime());
  let start=null;
  if(s.cycleStart){ start=dayKey(s.cycleStart); }
  else {
    const done=Math.min(cycleDone[s.id]||0, plan);
    if(done<=0){
      // 첫 수업일 = 오늘 포함 이후 첫 수업일
      for(let i=0;i<400;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()+i);
        const k=dayKey(dd.getTime()); if(isSessionDay(s,k)){ start=k; break; } }
    } else {
      const found=[];
      for(let i=0;i<900 && found.length<done;i++){ const dd=new Date(todayK); dd.setDate(dd.getDate()-i);
        const k=dayKey(dd.getTime()); if(isSessionDay(s,k)) found.push(k); }
      start = found.length ? found[found.length-1] : todayK;
    }
    if(start==null) start=todayK;
  }
  /* ★ 이번 클래스는 이미 끝난(확정·입금 완료) 지난 클래스 위로 겹칠 수 없다.
       학생정보에서 시작일을 최초 등록일로 되돌려 저장하면 지난 클래스와 같은 기간이 되던 문제. */
  const _se=settledHistEnd(s.id);
  if(_se!=null && start!=null && start<=_se) start=nextSessionAfter(s,_se);
  const info=classOf(s, start, plan, {cutoff: seedUntil||0});
  /* ★ 2026-07-28n ★ 원장님 신고 — "15일 이후도 출첵했는데 반영 안됨" (윤지호)
     예전에 학생별로 저장해 두던 종료일(s.cycleEnd)로 회차를 잘라내던 덮어쓰기를 삭제한다.
     빌드 m 에서 화면의 종료일 입력칸을 없앴으므로, 이 값은 원장님이 고칠 방법이 없는데도
     계산을 계속 이기고 있었다 — 종료 예정일의 출처가 둘이 되어 단일 소스 규칙에 어긋난다.
     이제 종료 예정일은 언제나 '수업 시작일 + 요일 + 계약 회차' 하나로만 계산된다.
     저장돼 있던 값은 지우지 않는다. 아무도 읽지 않는 값으로 남을 뿐이다. */
  return info;
}
/* ★ 지난 클래스 한 건의 기간·회차 날짜 — 저장값이 아니라 이 함수 하나로 결정한다.
   원장님이 확정(confirmed)한 기록만 저장된 날짜를 그대로 쓰고 절대 다시 계산하지 않는다. */
function histClassOf(s, h){
  const empty={start:null, end:null, sessions:[], confirmed:false};
  if(!h) return empty;
  const cnt=h.done||h.plan||0;
  if(h.confirmed && Array.isArray(h.sessions) && h.sessions.length){
    const l=h.sessions.slice().sort((a,b)=>a-b);
    return {start:l[0], end:l[l.length-1], sessions:l, confirmed:true};
  }
  let start = (h.start!=null) ? dayKey(h.start)
            : (Array.isArray(h.sessions)&&h.sessions.length ? dayKey(Math.min.apply(null,h.sessions)) : null);
  if(s && start!=null && cnt){
    const c=classOf(s, start, cnt, {cutoff: seedUntil||0});     // ★ 진행 중 화면과 똑같은 규칙(등원 미입력도 같게 취급)
    if(c.sessions.length) return {start:c.start, end:c.end||c.sessions[c.sessions.length-1], sessions:c.sessions, confirmed:false};
  }
  const en = (h.end!=null) ? dayKey(h.end) : (h.settledDate ? dayKey(new Date(h.settledDate).getTime()) : null);
  return {start, end:en, sessions:(Array.isArray(h.sessions)?h.sessions.slice():[]), confirmed:false};
}
/* ★ 정산 건 한 건의 기간·회차 날짜 — 지난 클래스와 똑같은 규칙 */
function billClassOf(b){
  const empty={start:null, end:null, sessions:[], confirmed:false};
  if(!b) return empty;
  if(b.confirmed && Array.isArray(b.sessions) && b.sessions.length){
    const l=b.sessions.slice().sort((x,y)=>x-y);
    return {start:l[0], end:l[l.length-1], sessions:l, confirmed:true};
  }
  const s=st(b.sid);
  let start = (b.startDate!=null) ? dayKey(b.startDate)
            : (Array.isArray(b.sessions)&&b.sessions.length ? dayKey(Math.min.apply(null,b.sessions)) : null);
  if(s && start!=null && b.plan){
    const c=classOf(s, start, b.plan, {cutoff: seedUntil||0});  // ★ 지난 클래스·이번 클래스와 같은 규칙
    if(c.sessions.length) return {start:c.start, end:c.end||c.sessions[c.sessions.length-1], sessions:c.sessions, confirmed:false};
  }
  const en = (b.endDate!=null) ? dayKey(b.endDate) : null;
  return {start, end:en, sessions:(Array.isArray(b.sessions)?b.sessions.slice():[]), confirmed:false};
}
/* ★ 지난 클래스 한 건과 짝이 되는 정산 건을 같은 날짜로 맞춘다.
     같은 기간이 packHistory 와 bills 두 곳에 따로 저장돼 서로 어긋나던 것을 막는다.
     (정산 카드 헤더 6.26~7.24 / 펼친 12회차 7.27 처럼 갈라지던 문제) */
function syncBillsOfHist(sid, h, oldEnd){
  if(!h) return;
  const keys=[];
  if(oldEnd!=null) keys.push(dayKey(oldEnd));
  if(h.end!=null) keys.push(dayKey(h.end));
  bills.forEach(b=>{
    if(b.sid!==sid) return;
    const match = (b.endDate!=null && keys.indexOf(dayKey(b.endDate))>=0)
               || (b.startDate!=null && h.start!=null && dayKey(b.startDate)===dayKey(h.start));
    if(!match) return;
    if(h.start!=null) b.startDate=h.start;
    if(h.end!=null) b.endDate=h.end;
    if(Array.isArray(h.sessions) && h.sessions.length) b.sessions=h.sessions.slice();
    if(h.confirmed){ b.confirmed=true; if(h.confirmedBy) b.confirmedBy=h.confirmedBy; }
  });
}
/* ★ 학생정보(요일·회차·시작일 등)가 바뀌면 지난 클래스·정산 건 날짜를 즉시 다시 계산한다.
     원장님이 직접 확정/수정한 기록(confirmedBy==='owner')은 건드리지 않는다.
     "학생정보에서 고치면 전체가 다 반영되어야 한다"는 원칙을 지키는 지점. */
function recalcStudentDates(sid){
  const s=st(sid); if(!s) return;
  resolveClassOverlap(sid);   // ★ 이번 클래스와 지난 클래스가 겹치면 먼저 정리한다
  (packHistory[sid]||[]).forEach(h=>{
    if(h.confirmed && h.confirmedBy==='owner') return;
    if(h.start==null){ const bf=backfillHistStart(s,h); if(bf!=null) h.start=bf; }
    const c=histClassOf(s,h);
    if(c.start!=null) h.start=c.start;
    if(c.end!=null) h.end=c.end;
    if(c.sessions.length) h.sessions=c.sessions.slice();
    syncBillsOfHist(sid, h);
  });
  bills.forEach(b=>{
    if(b.sid!==sid) return;
    if(b.confirmed && b.confirmedBy==='owner') return;
    const c=billClassOf(b);
    if(c.start!=null) b.startDate=c.start;
    if(c.end!=null) b.endDate=c.end;
    if(c.sessions.length) b.sessions=c.sessions.slice();
  });
}
// 이번 회차 시작일 — 모든 화면 공통 (앱·관리자·달력·알림톡)
/* ★ 이미 '끝난 것이 확실한' 지난 클래스의 마지막 종료일.
     확정([확정] 누름)했거나 정산이 입금 완료된 기록만 인정한다.
     이번 클래스는 이 날짜보다 뒤에서 시작해야 한다. */
function settledHistEnd(sid){
  let e=null;
  (packHistory[sid]||[]).forEach(h=>{
    if(h.end==null) return;
    const paid = bills.some(b=>b.sid===sid && b.paid &&
      ((b.endDate!=null && dayKey(b.endDate)===dayKey(h.end)) ||
       (h.start!=null && b.startDate!=null && dayKey(b.startDate)===dayKey(h.start))));
    if(h.confirmed || paid){ if(e==null || h.end>e) e=h.end; }
  });
  return e;
}

/* ★ 이번 클래스와 지난 클래스는 절대 같은 기간을 쓸 수 없다.
     겹치면 둘 중 하나다.
       · 지난 클래스가 진짜(확정 또는 입금 완료)  → 이번 클래스 시작일을 그 다음 수업일로 민다.
       · 지난 클래스가 완주 전에 성급히 만들어진 것(미확정·미납) → 되돌려서 다시 '진행 중'으로 만든다.
     되돌릴 때도 출결·결석·보강 기록은 손대지 않는다. 지운 적 없는 그 클래스가 진행 중으로 살아날 뿐이고,
     마지막 수업에 [등원]을 누르면 완주 처리가 정상적으로 다시 만들어 준다.
     (2026-07-27 정도연·한지우 겹침 사고 재발 방지) */
function resolveClassOverlap(sid){
  const s=st(sid); if(!s) return false;
  let ch=false;
  const se=settledHistEnd(sid);
  if(se!=null && s.cycleStart!=null && dayKey(s.cycleStart)<=se){
    s.cycleStart=nextSessionAfter(s,se); ch=true;      // 저장값도 화면값과 같게 맞춘다
  }
  const cs=cycleStartOf(s);
  if(cs==null) return ch;
  const hist=packHistory[sid]||[];
  const keep=[];
  hist.forEach(h=>{
    if(h.end==null || h.end<cs){ keep.push(h); return; }              // 안 겹침
    const paid = bills.some(b=>b.sid===sid && b.paid &&
      ((b.endDate!=null && dayKey(b.endDate)===dayKey(h.end)) ||
       (h.start!=null && b.startDate!=null && dayKey(b.startDate)===dayKey(h.start))));
    if(h.confirmed || paid){ keep.push(h); return; }                   // 진짜 지난 클래스 → 위에서 시작일을 밀었다
    for(let i=bills.length-1;i>=0;i--){                                // 짝이 되는 미납·미확정 정산 건도 같이 되돌린다
      const b=bills[i];
      if(b.sid!==sid || b.paid || b.confirmed) continue;
      const same=(b.endDate!=null && dayKey(b.endDate)===dayKey(h.end))
              || (h.start!=null && b.startDate!=null && dayKey(b.startDate)===dayKey(h.start));
      if(same) bills.splice(i,1);
    }
    ch=true;                                                           // h 는 keep 에 넣지 않는다 = 되돌림
  });
  if(ch){ keep.forEach((h,i)=>{ h.no=i+1; }); packHistory[sid]=keep; }
  return ch;
}

function cycleStartOf(s){ return currentClassInfo(s).start; }
// 이번 회차 종료일 — 모든 화면 공통 (수동 고정값도 currentClassInfo 안에서 반영됨)
function cycleEndOf(s){ return currentClassInfo(s).end; }
function fmtD(ms){ return ms? new Date(ms).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}) : '—'; }

// 학년 (정렬·표시용)
const GRADES=[['pre','초등 이전'],['g1','초1'],['g2','초2'],['g3','초3'],['g4','초4'],['g5','초5'],['g6','초6'],['m1','중1'],['m2','중2'],['m3','중3'],['post','초등 이후']];
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

/* ===== 비어 있는 값 알림 (2026-07-27f) =====
   원칙: 값이 비어 있으면 코드 값으로 채우지 않고 비워 두고, 무엇이 비었는지 홈 '챙길 일'에 알린다.
   각 항목은 '읽는 함수 / 저장 키'가 하나뿐이며, 그 저장 키가 비었을 때만 나타난다. */
function missingSettings(){
  const out=[];
  if(!academy.name)  out.push({tx:'학원 이름이 비어 있어요', v:'academy'});
  if(!academy.owner) out.push({tx:'원장님 이름이 비어 있어요', v:'academy'});
  if(!closeTime)     out.push({tx:'마감 시각이 비어 있어요 (설정 > 수업 기본 설정)', v:'admin'});
  [...new Set(students.map(s=>s.plan).filter(p=>+p>0))].sort((a,b)=>a-b)
    .forEach(p=>{ if(priceOfPlan(p)==null) out.push({tx:`${p}회 수업료가 비어 있어요 (설정 > 수업 기본 설정)`, v:'admin'}); });
  /* ★ 2026-07-27h: 켜 둔 알림의 문구가 비면 알린다 — 발송도 같은 규칙으로 막힌다 */
  MSG_KINDS.forEach(([k,label])=>{ if(sendOn(k) && !String((msgTemplates[k]&&msgTemplates[k].sms)||'').trim())
    out.push({tx:`${label} 문구가 비어 있어요 (설정 > 알림 문구)`, v:'send'}); });
  students.forEach(s=>{
    /* ★ 2026-07-28s: 공통 s.time 을 따로 보지 않는다(timeFor 하나만 본다).
       요일마다 다르게인 학생은 수업 요일 중 한 칸이라도 비면 알린다. */
    const _dchk=(s.days&&s.days.length)?s.days:[todayIdx];
    if(_dchk.some(d=>!timeFor(s,d))) out.push({tx:`${s.name} 수업 시각이 비어 있어요`, v:'manage'});
    if(!durOf(s))                        out.push({tx:`${s.name} 수업 시간이 비어 있어요`, v:'manage'});
    const g=guardiansOf(s)[0]||{};
    if(!g.name)  out.push({tx:`${s.name} 보호자 이름이 비어 있어요`, v:'manage'});
    /* ★ 2026-07-27h2: 발송 방법(카톡/문자만)이 정해지지 않은 보호자를 알린다 — 발송도 같은 규칙으로 막힌다 */
    if(g.kakao!==true && g.kakao!==false) out.push({tx:`${s.name} 보호자 발송 방법(카톡/문자만)이 정해지지 않았어요`, v:'manage'});
    /* 보호자 연락처는 알리지 않는다 — 일부러 비워 두는 값(오발송 방지). 발송 시점에만 막는다. */
  });
  return out;
}
/* ===== 유틸 ===== */
const won=(n)=>(typeof n==='number'&&isFinite(n))?n.toLocaleString('ko-KR')+'원':'미설정';
const hm=(d)=>new Date(d).toTimeString().slice(0,5);
const fmtDur=(min)=>{const h=Math.floor(min/60),m=Math.round(min%60);
  return h?(m?`${h}시간 ${m}분`:`${h}시간`):`${m}분`;};
/* ===== 금액 단일 소스 =====
   priceOfPlan(회차) : 요금표(packages)에서만 읽는다. 없으면 null(미설정). 0원으로 대체하지 않는다.
   billAmount(정산건): 입금 완료 건만 '그때 실제로 받은 금액'을 보존하고, 미납 건은 항상 요금표를 다시 읽는다.
   histAmount(지난클래스): 짝이 되는 입금 완료 정산 건이 있으면 그 금액, 없으면 요금표.
   → 정산 건·지난 클래스에 금액을 굳혀 두지 않으므로, 요금표를 고치면 미납·미입금 건이 전부 따라온다. */
const priceOfPlan=(plan)=>{ const v=packages[plan]; return (typeof v==='number'&&isFinite(v)&&v>0)?v:null; };
const priceOf=(st)=> st?priceOfPlan(st.plan):null;
const billAmount=(b)=>{ if(!b) return null;
  if(b.paid && typeof b.amount==='number' && b.amount>0) return b.amount;   // 입금 완료 = 실제 입금액 보존
  return priceOfPlan(b.plan); };                                            // 미납 = 요금표 참조
const histAmount=(sid,h)=>{ if(!h) return null;
  const pb=bills.find(b=>b.sid===sid && b.endDate===h.end && b.paid && typeof b.amount==='number' && b.amount>0);
  return pb?pb.amount:priceOfPlan(h.plan); };
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
let histFixV=0;          // 지난 기록 정리 버전 (1 = 2026-07-27 회차·기간 단일화 정리 완료)
let tempTimes={};        // 오늘만 추가한 학생의 시각·수업시간 {id:{time:'15:00',dur:60}}
/* 오늘 이 학생의 시각 (임시 추가 > 보강 > 요일표) — 단일 소스 */
function todayTimeOf(s, k){
  const kk = k || dayKey(now.getTime());
  const mk=makeupOn(s.id, kk);
  if(mk && mk.time) return mk.time;
  return timeFor(s, new Date(kk).getDay());   // ★ 2026-07-28s: 공통 s.time 대체 삭제 — timeFor 하나만 본다
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
const isTodayStudent=(x)=>{ const k=dayKey(now.getTime());
  return (isClassDay(x,k) && !beforeStart(x,k)) || hasRecordOn(x.id,k); };   // ★ 마지막 회차 하원 직후에도(다음 클래스가 미래로 잡혀도) 오늘 기록 있으면 명단 유지
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
/* 날짜 이동 바 — 홈·출석부 공용. 버튼 위치가 절대 움직이지 않도록 고정 폭 */
function dateNavBar(ms, prevFn, nextFn, todayFn, goFn){
  const d=new Date(ms), isToday = dayKey(ms)===dayKey(now.getTime());
  const btn='width:34px;height:34px;flex:0 0 34px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;padding:0';
  return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0 12px">
    <button onclick="${prevFn}" aria-label="전날" style="${btn}">‹</button>
    <span class="dn-pick" style="flex:1;min-width:0;text-align:center">
      <span class="dn-txt">${d.getMonth()+1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일${isToday?' · 오늘':''}</span>
      <input type="date" aria-label="날짜 선택" value="${dateInputValue(ms)}"
        onclick="try{this.showPicker()}catch(e){}" onchange="${goFn}(this.value)"></span>
    <button onclick="${nextFn}" aria-label="다음날" style="${btn}">›</button>
    <button onclick="${todayFn}" style="flex:0 0 44px;width:44px;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;cursor:pointer;font-family:inherit;padding:0;${isToday?'visibility:hidden':''}">오늘</button>
  </div>`;
}
let homeDate=null;
function homeBaseMs(){ return homeDate ? homeDate.getTime() : dayKey(now.getTime()); }
function homeNav(d){ const b=new Date(homeBaseMs()); b.setDate(b.getDate()+d); homeDate=new Date(b.getFullYear(),b.getMonth(),b.getDate()); renderHome(); }
function homeToday(){ homeDate=null; renderHome(); }
/* ★ 2026-07-28q ★ 원장님 지시 — "날짜 클릭하면 바로 날짜 선택해서 해당일로 갈 수 있게도 해줘"
   고른 날이 오늘이면 homeDate 를 비운다 - '오늘'을 나타내는 방법을 둘로 만들지 않기 위해서다. */
function homeGo(v){ const ms=dayFromInput(v); if(ms==null) return;
  homeDate = ms===dayKey(now.getTime()) ? null : new Date(ms); renderHome(); }

/* 출석부 기준 날짜 (기본 오늘, ‹ › 로 이동) */
let attnDate=null;
function attnBaseMs(){ return attnDate ? attnDate.getTime() : dayKey(now.getTime()); }
function attnNav(d){ const b=new Date(attnBaseMs()); b.setDate(b.getDate()+d); attnDate=new Date(b.getFullYear(),b.getMonth(),b.getDate()); renderToday(); }
function attnToday(){ attnDate=null; renderToday(); }
/* ★ 2026-07-28q ★ 날짜 글씨를 눌러 고른 날로 바로 이동 (홈의 homeGo 와 같은 방식) */
function attnGo(v){ const ms=dayFromInput(v); if(ms==null) return;
  attnDate = ms===dayKey(now.getTime()) ? null : new Date(ms); renderToday(); }
/* 날짜칸에서 읽어 온 글자(YYYY-MM-DD)를 그 날 0시로 바꾸는 단 하나의 자리 (dateInputValue 의 반대) */
function dayFromInput(v){ if(!v) return null;
  const p=String(v).split('-').map(Number);
  if(p.length!==3 || p.some(n=>!Number.isFinite(n))) return null;
  return new Date(p[0], p[1]-1, p[2]).getTime(); }
/* 홈에서 보고 있던 날짜를 그대로 출석부로 인계 (2026-07-24 원장님 지시) */
function goAttnFromHome(){ attnDate = homeDate ? new Date(homeDate.getTime()) : null; goTab('today', true); }

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
  unpaidBills.forEach(b=>{ const bs=st(b.sid); todos.push({ic:'clay',tx:`${bs?bs.name:'학생'} ${billMonthTxt(b)} 정산 필요 (${won(billAmount(b))})`,v:'settle'}); });
  missingSettings().forEach(m=>todos.push({ic:'clay',tx:`⚠ ${m.tx} — 채워주세요`, v:m.v}));

  const navBtn='width:30px;height:30px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  el.innerHTML=`
    <div class="greet"><div class="hi">안녕하세요, 원장님</div></div>
    ${dateNavBar(hDate.getTime(), 'homeNav(-1)', 'homeNav(1)', 'homeToday()', 'homeGo')}
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
      <button class="act" onclick="goTab('settle')"><div class="t">정산</div><div class="d">회차·수업료 정리</div></button>
      <button class="act primary" onclick="goAttnFromHome()"><div class="t">출석체크</div><div class="d">${isToday?`오늘 ${todayRemain}명 남음`:`${hDate.getMonth()+1}/${hDate.getDate()} ${remain}명 예정`}</div></button>
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
          <span class="tx">${l.text}</span><span class="tm">${hm12(l.time)}</span></div>`;}).join('')+`</div>`
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
    .sort((a,b)=>timeFor(a,dowA).localeCompare(timeFor(b,dowA)));   // ★ 2026-07-28s: 공통 time 대체 삭제
  // 날짜 이동
  const navBtn='width:30px;height:30px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
  const dateNav=dateNavBar(aMs, 'attnNav(-1)', 'attnNav(1)', 'attnToday()', 'attnGo');   // 홈과 동일한 공용 바
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
      else if(done){ stx = done.start ? `하원 완료 · ${rng12(hm(done.start),hm(done.end))}` : '수업 완료'; sc='var(--green)';
        btns=`<button class="btn ghost small" onclick="undoOn(${s.id},${aMs})">완료 취소</button>`; }
      else if(isPast){ stx = `미확정 · 예정 ${hm12(timeFor(s,dowA))}`; sc='var(--amber)';
        btns=`<button class="btn start small" onclick="openSendConfirm(${s.id},'both',${aMs})">수업함 확정</button>
              <button class="btn absentbtn small" onclick="markAbsentOn(${s.id},${aMs})">결석</button>`; }
      /* ★ 2026-07-29 원장님 지시 — 지난 날 출석부에서도 학습내용을 적을 수 있어야 한다.
         결석이든 완료든 미확정이든 그날이 이미 지났으면 붙인다. 아직 오지 않은 날은 적을 것이 없으니 안 붙인다.
         여는 곳은 오늘 카드와 똑같은 한 곳(openLessonSheet)이고, 날짜만 그날(aMs)로 넘긴다. */
      if(isPast){ btns += lsnBtn(s.id, aMs, 'small'); }
      let inlineBtn='';
      if(!abs && !done && !isPast){ stx = `예정 ${hm12(timeFor(s,dowA))}`; sc='var(--muted)';   // 회차는 cycBadge로 이름 옆 표기
        inlineBtn=`<button class="btn absentbtn small" style="width:auto;flex:none;padding:7px 16px;margin:0" onclick="markAbsentOn(${s.id},${aMs})">결석</button>`; }   // ★ 미래 날짜 사전 결석 — 한 줄 표기 (회차·종료일·전체 일정 자동 반영)
      return `<div class="card" style="${abs?'border:1.6px solid var(--clay)':(!done&&isPast?'border:1.6px solid var(--amber)':'')}">
        <div class="card-top" style="align-items:center">
          <div class="who" style="${inlineBtn?'display:flex;align-items:baseline;gap:9px;min-width:0':''}">
            <div class="name" style="${inlineBtn?'white-space:nowrap':''}">${s.name}${cycBadge(s)}</div>
            <div class="plan" style="color:${sc};${inlineBtn?'white-space:nowrap;overflow:hidden;text-overflow:ellipsis':''}">${stx}</div>
          </div>${inlineBtn}
        </div>
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
    if(done){ statusText = done.start ? `하원 완료 · ${tBtn(rng12(hm(done.start),hm(done.end)))}` : `하원 완료 · ${tBtn('시간 입력')}`; statusColor='var(--green)'; }
    else if(isLive){ const outT=endTimeOf(hm(live[s.id]), todayDurOf(s,aMs));   // 뒤 시각 = 하원 예정(등원+수업시간)
      statusText = `수업 중 · ${tBtn(rng12(hm(live[s.id]),outT))}`; statusColor='var(--amber)'; }
    else if(isAbsent){ statusText = '결석 처리됨'; statusColor='var(--clay)'; }
    else { const tt=todayTimeOf(s,aMs);           // 임시 추가 > 보강 > 요일표 (그룹 헤더와 동일)
      const dd=todayDurOf(s,aMs);
      const rng=tt?rng12(tt, endTimeOf(tt,dd)):'';
      statusText = `${isMk?'보강 '+rng:'예정 '+rng}`; statusColor='var(--muted)'; }

    /* ★ 2026-07-28p ★ 원장님 지시 — "여기다 넣어주세요"
       오늘 학습내용 단추를 카드 위쪽(자세히 펼침 속)에서 [수정] 오른쪽 네 번째 자리로 옮겼다.
       · 2026-07-29z 부터 단추 글자·색은 lsnBtn 한 곳에서만 만든다 —
         아직 안 적은 날은 「학습」(주황 점선), 적어 둔 날은 「학습 ✓」(초록)이다.
         눌렀을 때 여는 곳도 전과 똑같은 한 곳(openLessonSheet)이다 — 문을 둘로 만들지 않았다.
       · 하원 완료·결석 카드에도 같은 단추를 붙인다. 학습내용은 수업이 끝난 뒤에 적는 것이니
         '오늘 완료 취소'만 있던 줄에서 적을 길이 막히면 안 된다.
       · 글자 크기·칸 나누기는 styles.css 의 .attn-btns.four / .btn.lsnew / .btn.lsdone 한 곳에서만 정한다. */
    const lsBtn = lsnBtn(s.id);
    // 액션 버튼 (등원↔하원 토글 + 결석 + 완료 + 학습내용)
    let action;
    if(done){
      action=`<div class="row-btns">
        <button class="btn ghost" onclick="undoToday(${s.id})">오늘 완료 취소</button>
        ${lsBtn}
      </div>`;
    } else if(isAbsent){
      action=`<div class="row-btns">
        <button class="btn ghost" onclick="clearAbsent(${s.id})">결석 취소</button>
        ${lsBtn}
      </div>`;
    } else {
      const first = isLive
        ? `<button class="btn stop" onclick="quickSend(${s.id},'end')">하원</button>`
        : `<button class="btn start" onclick="quickSend(${s.id},'start')">등원</button>`;
      action=`<div class="attn-btns four">
        ${first}
        <button class="btn absentbtn" onclick="markAbsent(${s.id})">결석</button>
        <button class="btn ghost" onclick="openSendConfirm(${s.id},'${isLive?'end':'start'}')">수정</button>
        ${lsBtn}
      </div>`;
    }

    // 전체보기 상세 (자세히 ▾ 펼침 시에만)
    const detail = expanded ? `
      <div class="cal-slot" id="cal-${s.id}"></div>
      ${(()=>{const ls=todayLesson(s.id);
        /* ★ 2026-07-28p: 작성 단추는 아래 단추 줄 네 번째 자리로 옮겼다.
           여기에는 적어 둔 내용을 읽는 자리만 남긴다 — 아직 안 적은 날은 아무것도 안 보인다. */
        return ls
        ? `<button class="lesson filled" onclick="openLessonSheet(${s.id})">
             <div class="ls-top"><span class="ls-label">오늘 학습내용</span>
               ${ls.mood?`<span class="ls-mood">${ls.mood}</span>`:''}</div>
             <div class="ls-tx">${ls.text}</div></button>`
        : '';})()}
      ${progBar(s)}
      <div class="clock ${isLive?'show':''}"><span class="dot"></span>
        <span class="time num" data-clock="${s.id}">00:00:00</span>
        <span class="since">${isLive?'등원 '+hm12(hm(live[s.id])):''}</span></div>
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
          <div class="name">${s.name}${cycBadge(s)}${isMk?' <span style="font-size:11px;font-weight:700;color:#fff;background:#6B4FBB;border-radius:6px;padding:2px 7px;vertical-align:middle">보강</span>':''}</div>
          <div class="plan" style="color:${statusColor}">${statusText}</div>
        </div>
        ${(isMk&&isToday)?`<button onclick="askRemoveMakeup(${s.id},${aMs})" title="보강 빼기" style="background:#FBEAEA;border:none;border-radius:20px;padding:5px 11px;font-size:12px;color:#A32D2D;cursor:pointer;font-family:inherit;white-space:nowrap;font-weight:600;margin-right:6px">✕ 빼기</button>`:''}
        ${toggleBtn}
      </div>
      ${detail}
      ${action}
    </div>`;
  };
  // 시간대가 바뀌는 지점에 연한 구분선만 (주황 알약 탭 제거 — 2026-07-27 원장님 지시)
  const hourOf=(s)=>{ const t=(isToday? todayTimeOf(s,aMs) : timeFor(s,dowA)); return t?t.slice(0,2)+':00':'시간 미정'; };
  let cards='', _lastHour=null, _first=true;
  list.forEach(s=>{
    const hour=hourOf(s);
    if(hour!==_lastHour){
      _lastHour=hour;
      if(!_first) cards+=`<div style="border-top:2px solid #C9C2B2;border-radius:2px;margin:15px 4px"></div>`;   // 시간대 구분선 (연하되 보이게)
    }
    _first=false;
    cards+=cardOf(s);
  });
  const empty=list.length?'':`<div class="empty">이 날은 예정된 학생이 없어요. 아래에서 보강을 넣을 수 있어요.</div>`;
  const cand=students.filter(x=>!list.some(y=>y.id===x.id))       // 그 날 명단에 없는 학생
    .slice().sort((a,b)=>a.name.localeCompare(b.name,'ko'));      // 가나다순
  const added=students.filter(x=>makeupOn(x.id, aMs));            // 그 날 보강인 학생 (단일 소스)
  const addedBox = added.length ? `<div style="margin-bottom:10px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${isToday?'오늘':fmtMD(aMs)} 보강</div>
      ${added.map(x=>{ const ti=makeupOn(x.id, aMs)||{};
        return `<div style="display:flex;justify-content:space-between;align-items:center;background:#FAEEDA;border-radius:9px;padding:8px 10px;margin-bottom:6px">
          <span style="font-size:13px;color:#633806"><b>${x.name}</b> · ${ti.time?rng12(ti.time, endTimeOf(ti.time, ti.dur||durOf(x))):'-'} · ${durLabel(ti.dur||durOf(x))}</span>
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
    /* ★ 2026-07-27i: 오늘은 [등원]을 눌러야 초록(완료)이 된다 — 출석부 숫자와 달력 초록칸이 항상 같도록 */
    else if(sets.session.has(t)) c+=((t<todayT || (t===todayT && hasRecordOn(sid,t))) ? ' att' : ' up');
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
  const todayT=dayKey(now.getTime());
  // 이미 수업한 보강일은 보라(예정)가 아니라 출석(초록)으로 표시
  const makeupSet=new Set(info.makeups.filter(k=>!(k<=todayT && hasRecordOn(s.id,k))));
  const skipSet=new Set(info.skips);
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
          ${mk.time?` ${rng12(mk.time, endTimeOf(mk.time, mk.dur||durOf(s)))}`:''} · ${durLabel(mk.dur||durOf(s))}${mk.done?' ✓ 완료':''}</span>
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
function openLessonSheet(id, ms){
  /* 날짜를 안 주시면 오늘이다 — 학생 탭 등 다른 곳에서 부르던 방식이 그대로 살아 있어야 한다 */
  const dMs = dayKey(ms==null ? now.getTime() : ms);
  const dLb = lsnDayLabel(dMs), isTd = (dLb==='오늘');
  const s=st(id); const ls=lessonOn(id, dMs);
  const chips=MOODS.map(m=>`<button type="button" class="mood-chip ${ls&&ls.mood===m?'on':''}" data-m="${m}" onclick="pickMood(this)">${m}</button>`).join('');
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} · 학습</h3>
    <div class="lsd">
      <button type="button" class="lsd-btn" onclick="lsnCalToggle()">${lsnDateFull(dMs)}${isTd?' · 오늘':''}<span class="lsd-ar">▾</span></button>
      <span class="lsd-s ${ls?'on':''}">${ls?'적어 두셨어요':'아직 안 적었어요'}</span>
    </div>
    <div class="lsd-cal" id="lsnCal"></div>
    <div class="cap">아이의 수업·태도·주의사항을 간단히 남겨요. 알림장에 쌓여요.<br>날짜를 누르면 달력에서 다른 날을 고를 수 있어요. <b>${dLb}</b> 기록으로 저장됩니다.</div>
    <div class="mood-row" id="moodRow"><span class="mood-k">태도</span>${chips}</div>
    <div class="lsc" id="hwBox"></div>
    <div class="lsc" id="catBox"></div>
    <div class="lsc" id="qnBox"></div>
    <div class="lsc" id="accBox"></div>
    <textarea id="lessonText" class="note-area" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="예: 분수 나눗셈 완료. 응용문제 어려워함. 다음 시간 지난 프린트 챙겨오기.">${ls?ls.text:''}</textarea>
    <div class="lsc"><div class="lsc-k">안내사항</div>
      <input id="lsnInfo" class="note-select" autocomplete="off" autocorrect="off" spellcheck="false" value="${ls?lsnAttr(ls.info||''):''}" placeholder="예: 교재 안내 했음"></div>
    <div class="sheet-btns"><button class="btn start" onclick="saveLesson(${id},${dMs})">저장</button>
      ${ls?`<button class="btn sms" onclick="deleteLesson(${id},${dMs})">삭제</button>`:`<button class="btn sms" onclick="closeSheet()">취소</button>`}</div>`;
  sheet.dataset.mood = ls&&ls.mood?ls.mood:'';
  /* ★ 고르신 값은 시트가 열려 있는 동안만 여기(dataset)에 둔다. [저장]을 눌러야 기록에 들어간다. */
  sheet.dataset.cats  = (ls&&Array.isArray(ls.cats))?ls.cats.join(','):'';
  sheet.dataset.etc   = (ls&&ls.catEtc)?ls.catEtc:'';
  sheet.dataset.hw    = (ls&&hwInfo(ls.hw))?ls.hw:'';   // 모르는 값이 들어 있으면 안 고른 것으로 둔다
  sheet.dataset.qn    = (ls&&ls.qn>0)?String(ls.qn):'';
  sheet.dataset.acc   = (ls&&typeof ls.acc==='number')?String(ls.acc):'';   // 0%도 값이므로 빈칸과 구분한다
  sheet.dataset.grade = s.grade||'';
  /* 이미 적어 둔 기록이 있으면 그 기록의 과정을, 없으면 학년으로 정한다 */
  sheet.dataset.catset = catsetOfKeys((sheet.dataset.cats||'').split(',')) || catsetForGrade(s.grade||'');
  sheet.dataset.pick = '';
  /* ★ 지금 보고 있는 학생·날짜와 달력이 펼쳐진 달 — 시트가 열려 있는 동안만 여기 둔다(서버에 저장하지 않는다) */
  sheet.dataset.lsid  = String(id);
  sheet.dataset.lsms  = String(dMs);
  sheet.dataset.caly  = String(new Date(dMs).getFullYear());
  sheet.dataset.calm  = String(new Date(dMs).getMonth());
  sheet.dataset.calopen = '';
  lsnDrawCal(); lsnDrawHw(); lsnDrawCats(); lsnDrawQn(); lsnDrawAcc();
  /* ★ 2026-07-29 원장님 지시 — "디폴트 값이 산만함으로 들어가 있으면 안됨"
     앱이 넣은 값이 아니었다. 브라우저가 예전에 이 칸에 치셨던 글을 되살려 넣는 일이 있다
     (폼 값 복원·입력 자동완성). 그러면 저장된 글 대신 엉뚱한 글이 보이고,
     그대로 [저장]을 누르면 원래 글이 지워진다.
     그리기가 끝난 뒤 저장된 값을 한 번 더 넣어 브라우저 쪽 값을 확실히 이긴다.
     넣는 값은 위에서 쓰던 것과 같은 한 곳(ls / sheet.dataset)에서만 온다. */
  lsnFixVals(ls);
  document.getElementById('scrim').classList.add('show');
  /* 시트가 길어졌다 — 열 때마다 맨 위 날짜 줄부터 보여야 한다.
     숨어 있는 동안에는 자리를 옮겨도 먹지 않으므로 화면에 띄운 바로 뒤에 되돌린다. */
  sheet.scrollTop = 0;
}
/* ★ 2026-07-29z 원장님 지시 — "기본은 오늘날짜가 뜨고, 아닌 것은 그 날짜 클릭하면 달력이 나오게"
   시트 맨 위 날짜를 누르면 여기 달력이 열린다. 여닫기·달 넘기기·날짜 고르기가 모두 이 세 함수뿐이다.
   보고 있는 달은 시트가 열려 있는 동안만 sheet.dataset 에 둔다 — 서버에 저장하지 않는다. */
function lsnCalToggle(){
  const sh=document.getElementById('sheet'); if(!sh) return;
  sh.dataset.calopen = (sh.dataset.calopen==='1') ? '' : '1';
  lsnDrawCal();
}
function lsnCalNav(step){
  const sh=document.getElementById('sheet'); if(!sh) return;
  let y=+sh.dataset.caly, m=+sh.dataset.calm+step;
  if(m<0){ m=11; y--; } if(m>11){ m=0; y++; }
  sh.dataset.caly=String(y); sh.dataset.calm=String(m);
  lsnDrawCal();
}
function lsnDrawCal(){
  const sh=document.getElementById('sheet'), box=document.getElementById('lsnCal');
  if(!sh||!box) return;
  if(sh.dataset.calopen!=='1'){ box.innerHTML=''; box.classList.remove('open'); return; }
  box.classList.add('open');
  const sid=+sh.dataset.lsid, sel=+sh.dataset.lsms;
  const y=+sh.dataset.caly, m=+sh.dataset.calm, todayT=dayKey(now.getTime());
  const first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate();
  let g='';
  WD.forEach(w=>g+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++) g+='<div></div>';
  for(let dd=1;dd<=days;dd++){
    const t=dayKey(new Date(y,m,dd).getTime());
    /* 아직 오지 않은 날은 적어 둘 것이 없으니 고를 수 없다 */
    const off = t>todayT;
    const c='cal-d lsd-d'+(lessonOn(sid,t)?' has':'')+(t===sel?' sel':'')+(t===todayT?' tod':'')+(off?' off':'');
    g+=`<div class="${c}" ${off?'':`onclick="lsnPickDate(${t})"`}>${dd}</div>`;
  }
  /* 다음 달에 오늘까지의 날이 하나도 없으면 앞으로 넘기지 않는다 */
  const canNext = new Date(y,m+1,1).getTime() <= todayT;
  box.innerHTML=`<div class="lsd-nav">
      <button type="button" class="lsn-nav-b" onclick="lsnCalNav(-1)" aria-label="이전 달">‹</button>
      <span class="lsn-nav-t">${y}년 ${m+1}월</span>
      ${canNext?`<button type="button" class="lsn-nav-b" onclick="lsnCalNav(1)" aria-label="다음 달">›</button>`
               :`<span class="lsn-nav-b off">›</span>`}
    </div>
    <div class="cal-grid">${g}</div>
    <div class="lsd-lg"><span><i class="lg has"></i>적어 둔 날</span><span><i class="lg tod"></i>오늘</span></div>`;
}
/* 날짜를 고르면 그 날 기록으로 시트를 다시 연다 — 여는 곳은 여전히 한 곳(openLessonSheet)이다 */
function lsnPickDate(ms){
  const sh=document.getElementById('sheet'); if(!sh) return;
  openLessonSheet(+sh.dataset.lsid, ms);
}
/* 시트 안 글칸의 값을 저장된 값으로 되돌려 놓는 곳 — 여기 한 곳뿐이다 */
function lsnFixVals(ls){
  const sheet=document.getElementById('sheet'); if(!sheet) return;
  const ta=document.getElementById('lessonText');
  if(ta){ const v = (ls&&ls.text) ? ls.text : ''; if(ta.value!==v) ta.value=v; }
  const et=document.getElementById('lsnEtc');
  if(et){ const v = sheet.dataset.etc||''; if(et.value!==v) et.value=v; }
  const inf=document.getElementById('lsnInfo');
  if(inf){ const v = (ls&&ls.info) ? ls.info : ''; if(inf.value!==v) inf.value=v; }
}
/* 큰따옴표까지 막아야 값이 칸 밖으로 새지 않는다 */
function lsnAttr(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function lsnDrawCats(){
  const sheet=document.getElementById('sheet'), box=document.getElementById('catBox');
  if(!sheet||!box) return;
  const set=sheet.dataset.catset||'', g=sheet.dataset.grade||'';
  const sel=(sheet.dataset.cats||'').split(',').filter(Boolean);
  const showPick = (sheet.dataset.pick==='1') || !set;
  const head = set
    ? `<span class="lsc-src">${gradeLabel(g)?gradeLabel(g)+' · ':''}${CATSETS[set].n}</span><button type="button" class="lsc-sw" onclick="lsnPickToggle()">과정 바꾸기</button>`
    : `<span class="lsc-src warn">학년이 없어 갈래를 자동으로 못 골랐어요 — 아래 [기타]에 직접 적으시거나, 과정을 고르시면 됩니다</span>`;
  /* ★ 학년이 없어도 [기타]는 늘 있어야 한다 — 자동으로 못 골랐다고 적을 방법까지 막으면 안 된다 */
  const list = set ? CATSETS[set].list.concat([CAT_ETC]) : [CAT_ETC];
  const chips = list.map(c=>`<button type="button" class="lsc-chip ${sel.indexOf(c.k)>=0?'on':''}" onclick="pickCat(this,'${c.k}')">${c.n}</button>`).join('');
  const pick = showPick
    ? `<div class="lsc-pick">${Object.keys(CATSETS).map(k=>`<button type="button" class="lsc-chip sw ${k===set?'on':''}" onclick="lsnSetCatset('${k}')">${CATSETS[k].n}</button>`).join('')}</div>`
    : '';
  /* 다른 과정에서 골라 둔 것이 있으면 알려 드린다 — 안 보인다고 사라진 게 아니다 */
  const hid = sel.filter(k=>k!=='etc' && !(set && CATSETS[set].list.some(c=>c.k===k)));
  const hidHtml = hid.length ? `<div class="lsc-hid">다른 과정에서 고르신 것도 함께 저장됩니다 — ${hid.map(k=>lsnEsc(catName(k)||k)).join(' · ')}</div>` : '';
  /* ★ 2026-07-29 원장님 지시 — 고른 게 눈에 안 보인다고 하셨다.
     알약 색(.lsc-chip.on)만으로는 CSS 가 늦게 오면 아무 표시가 안 난다.
     문제 수·정답률과 똑같이 글자로도 몇 개 골랐는지 적는다. 복수 선택 + 기타 함께 고르기가 원래 동작이다. */
  const cnt = `<span class="lsc-v">${sel.length?sel.length+'개 고름':'안 고름'}</span>`;
  box.innerHTML = `<div class="lsc-k">수업 내용 ${cnt} ${head}</div>${pick}<div class="lsc-chips">${chips}</div>${hidHtml}
    <input id="lsnEtc" class="note-select lsc-etc" autocomplete="off" autocorrect="off" spellcheck="false" style="display:${sel.indexOf('etc')>=0?'block':'none'}" value="${lsnAttr(sheet.dataset.etc||'')}" placeholder="직접 적기 (예: 도형 심화 프린트)">`;
}
function lsnPickToggle(){ const sheet=document.getElementById('sheet'); lsnKeepEtc(); sheet.dataset.pick = sheet.dataset.pick==='1'?'':'1'; lsnDrawCats(); }
function lsnSetCatset(v){ const sheet=document.getElementById('sheet'); lsnKeepEtc(); sheet.dataset.catset=v; sheet.dataset.pick=''; lsnDrawCats(); }
/* 화면을 다시 그리기 전에, 직접 적으신 글이 날아가지 않게 챙겨 둔다 */
function lsnKeepEtc(){ const e=document.getElementById('lsnEtc'); if(e) document.getElementById('sheet').dataset.etc=e.value; }
function pickCat(btn,k){
  const sheet=document.getElementById('sheet');
  const sel=(sheet.dataset.cats||'').split(',').filter(Boolean);
  const i=sel.indexOf(k);
  if(i>=0) sel.splice(i,1); else sel.push(k);
  sheet.dataset.cats=sel.join(',');
  btn.classList.toggle('on');
  /* 알약만 켜고 끄므로 '몇 개 고름' 글자는 여기서 같이 고친다 — 다시 그리면 적으신 글이 날아간다 */
  const cv=document.querySelector('#catBox .lsc-v');
  if(cv) cv.textContent = sel.length ? sel.length+'개 고름' : '안 고름';
  if(k==='etc'){ const e=document.getElementById('lsnEtc'); if(e) e.style.display = sel.indexOf('etc')>=0?'block':'none'; }
}
/* 과제 — 고른 값이 글자로도 보이게 한다(알약 색만으로는 CSS 가 늦게 오면 표시가 안 난다) */
function lsnDrawHw(){
  const sheet=document.getElementById('sheet'), box=document.getElementById('hwBox');
  if(!sheet||!box) return;
  const v=sheet.dataset.hw||'';
  box.innerHTML=`<div class="lsc-k">과제 <span class="lsc-v">${v?hwName(v):'안 고름'}</span></div>
    <div class="lsc-chips">${HWS.map(h=>`<button type="button" class="lsc-chip hwc-${h.c} ${h.k===v?'on':''}" onclick="pickHw('${h.k}')">${h.n}</button>`).join('')}</div>`;
}
/* 같은 것을 다시 누르면 '안 고름'으로 돌아간다 — 잘못 누르셨을 때 지울 방법이 있어야 한다 */
function pickHw(k){ const sheet=document.getElementById('sheet'); sheet.dataset.hw = (sheet.dataset.hw===k)?'':k; lsnDrawHw(); }
function lsnDrawQn(){
  const sheet=document.getElementById('sheet'), box=document.getElementById('qnBox');
  if(!sheet||!box) return;
  const v=sheet.dataset.qn||'';
  box.innerHTML=`<div class="lsc-k">문제 수 <span class="lsc-v">${v?v+'문제':'안 고름'}</span></div>
    <div class="lsc-chips sm">${QN_STEPS.map(n=>`<button type="button" class="lsc-chip ${String(n)===v?'on':''}" onclick="pickQn(${n})">${n}</button>`).join('')}</div>`;
}
function lsnDrawAcc(){
  const sheet=document.getElementById('sheet'), box=document.getElementById('accBox');
  if(!sheet||!box) return;
  const v=sheet.dataset.acc||'';
  box.innerHTML=`<div class="lsc-k">정답률 <span class="lsc-v">${v===''?'안 고름':v+'%'}</span></div>
    <div class="lsc-chips sm">${ACC_STEPS.map(n=>`<button type="button" class="lsc-chip ${String(n)===v?'on':''}" onclick="pickAcc(${n})">${n}</button>`).join('')}</div>`;
}
/* 같은 것을 다시 누르면 '안 고름'으로 돌아간다 — 잘못 누르셨을 때 지울 방법이 있어야 한다 */
function pickQn(n){ const sheet=document.getElementById('sheet'); sheet.dataset.qn = (sheet.dataset.qn===String(n))?'':String(n); lsnDrawQn(); }
function pickAcc(n){ const sheet=document.getElementById('sheet'); sheet.dataset.acc = (sheet.dataset.acc===String(n))?'':String(n); lsnDrawAcc(); }
function pickMood(btn){
  const sel=btn.dataset.m; const cur=document.getElementById('sheet').dataset.mood;
  document.querySelectorAll('#moodRow .mood-chip').forEach(c=>c.classList.remove('on'));
  if(cur===sel){document.getElementById('sheet').dataset.mood='';}
  else{btn.classList.add('on');document.getElementById('sheet').dataset.mood=sel;}
}
function saveLesson(id, ms){
  const dMs = dayKey(ms==null ? now.getTime() : ms);
  const dLb = lsnDayLabel(dMs);
  const sheet=document.getElementById('sheet');
  const text=document.getElementById('lessonText').value.trim();
  const mood=sheet.dataset.mood||'';
  const cats=(sheet.dataset.cats||'').split(',').filter(Boolean);
  const etcEl=document.getElementById('lsnEtc');
  const catEtc=(cats.indexOf('etc')>=0 && etcEl) ? etcEl.value.trim() : '';
  const infoEl=document.getElementById('lsnInfo');
  const info=infoEl?infoEl.value.trim():'';        // ★ 안내사항 — 미리 정한 보기 없이 그때그때 적으신 대로 받는다
  const hw = hwInfo(sheet.dataset.hw||'') ? sheet.dataset.hw : '';   // 아는 값일 때만 받는다
  const qn = sheet.dataset.qn==='' ? null : +sheet.dataset.qn;
  const acc = sheet.dataset.acc==='' ? null : +sheet.dataset.acc;   // 0%와 '안 고름'은 다른 값이다
  if(!text && !info && !mood && !hw && !cats.length && qn===null && acc===null){
    showToast('내용·안내사항을 적거나 태도·과제·수업 내용·문제 수·정답률 중 하나를 골라주세요'); return;
  }
  const ex=lessonOn(id, dMs);
  /* 오늘이면 지금 시각까지 남기고, 지난 날이면 그날 0시로 둔다 — 없는 시각을 지어내지 않는다 */
  const rec = ex || {sid:id, date: (dLb==='오늘') ? new Date() : new Date(dMs)};
  rec.mood=mood; rec.text=text;
  /* ★ 안 고른 것은 넣지 않고 지운다 — 빈 값을 임의의 숫자로 채우지 않는다(미설정은 미설정으로 남는다) */
  if(info) rec.info=info; else delete rec.info;
  if(hw) rec.hw=hw; else delete rec.hw;
  if(cats.length) rec.cats=cats; else delete rec.cats;
  if(catEtc) rec.catEtc=catEtc; else delete rec.catEtc;
  if(qn!==null) rec.qn=qn; else delete rec.qn;
  if(acc!==null) rec.acc=acc; else delete rec.acc;
  if(!ex) lessons.push(rec);
  saveData(); closeSheet(); renderToday();
  lsnRefreshStuList();
  showToast(`${st(id).name} ${dLb} 학습내용 저장됨`);
}
function deleteLesson(id, ms){
  const dMs = dayKey(ms==null ? now.getTime() : ms), dLb = lsnDayLabel(dMs);
  const i=lessons.findIndex(l=>l && l.sid===id && l.date && dayKey(l.date.getTime())===dMs);
  if(i>=0)lessons.splice(i,1);
  saveData(); closeSheet(); renderToday();
  lsnRefreshStuList();
  showToast(`${dLb} 학습내용을 삭제했어요`);
}

/* 학습내용을 저장·삭제한 뒤 학생 탭 목록을 다시 그리는 곳 — 여기 한 곳뿐이다.
   단추 글자(학습 ↔ 학습 ✓)가 저장한 결과와 달라 보이면 안 된다.
   목록 칸만 다시 그린다 — 검색칸까지 다시 만들면 치고 계시던 글자가 날아간다. */
function lsnRefreshStuList(){ if(document.getElementById('stuList')) renderStudentsList(); }

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
      <div class="fld"><label>보강 시간</label>${timeSel(timeFor(s, new Date(dayKey(ms)).getDay()), {id:'mkTime2'})}</div>
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
    <div class="fld"><label>날짜</label><input type="date" id="mkDate" class="note-select" value="${dateInputValue(dayKey(now.getTime()))}"></div>
    <div class="fld"><label>시작 시각</label>${timeSel(timeFor(s, new Date().getDay()), {id:'mkTime'})}</div>
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
  saveData(); refreshCurrentView();   // 출석부·전체 일정 어디서 취소해도 그 화면 그대로 갱신
  showToast(`${st(sid).name} 결석 취소`);
}
/* 오늘만 추가 — 시작 시각·수업 시간을 정해서 넣기 */
function openTempSheet(id, dateMs){
  const s=st(id);
  const k=dayKey(dateMs||now.getTime());
  const dow=new Date(k).getDay();
  const defT = timeFor(s,dow);     // ★ 없으면 빈칸 — 원장님이 직접 넣으신다 (2026-07-28s: 공통 time 대체 삭제)
  const defD = durOf(s);
  const sheet=document.getElementById('sheet');
  sheet.dataset.tpDate=String(k);
  sheet.innerHTML=`<h3>${s.name} ${dayKey(now.getTime())===k?'오늘':fmtMD(k)} 보강</h3>
    <div class="cap"><b>${fmtMD(k)}</b> 하루만 오는 수업이에요. <b>시작 시각과 수업 시간</b>을 정해주세요. 정규 요일표는 그대로고, <b>회차·예상 종료일에 반영</b>됩니다.</div>
    <div class="fld"><label>시작 시각</label>
      ${timeSel(defT, {id:'tpTime'})}</div>
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
  /* ★ 2026-07-27h: 수업 시간이 비면 저장하지 않는다(학생 설정도 비어 있는 경우). */
  if(!(dur>0)){ showToast('수업 시간을 골라주세요 — 비우면 저장되지 않아요'); return; }
  const k=+sheet.dataset.tpDate || dayKey(now.getTime());     // 보고 있던 날짜
  const mks=(makeupLog[id]=makeupLog[id]||[]);                // 보강 = 단일 소스
  const ex=mks.find(x=>dayKey(x.t)===k);
  if(ex){ ex.time=t; ex.dur=dur; } else mks.push({t:k, time:t, dur, done:false});
  saveData(); closeSheet(); refreshCurrentView();     // 출석부·전체 일정 등 현재 화면 갱신
  showToast(`${st(id).name} ${fmtMD(k)} 보강 ${rng12(t,endTimeOf(t,dur))} 추가됨`);
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
      if(bi>=0){
        bills.splice(bi,1);
        const h=packHistory[id]; const popped=(h&&h.length)?h.pop():null;
        /* ★ 회차 카운터를 임의 값(plan-1)으로 되돌리지 않는다.
             되살린 클래스의 시작일로 돌아가서 실제 출결 기록 수로 다시 센다. */
        if(popped && popped.start!=null) s.cycleStart=dayKey(popped.start);
        s.cycleEnd=null;
        const cs=(s.cycleStart!=null)?dayKey(s.cycleStart):null;
        cycleDone[id]=sessions.filter(r=>r.sid===id && (cs==null || dayKey(r.date)>=cs)).length;
      }
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
/* 등원/하원 즉시 발송 — 시간 화면 없이 '지금' 시각으로 기록 + 알림 발송 (원장님 규칙)
   시각을 고쳐 보내려면 [수정] 버튼(openSendConfirm)을 사용 */
function quickSend(id, kind){
  const s=st(id); if(!s) return;
  const k=dayKey(Date.now());
  _sc={ id, kind, date:k };                       // _mkT 기준 날짜 설정
  const dmin=todayDurOf(s, k);
  const nowMs=_round10(Date.now());
  const startMs = (kind==='end' && live[id]!=null) ? live[id]      // 등원해 둔 시각 유지
                : (kind==='start') ? nowMs : (nowMs - dmin*60000); // 하원인데 등원기록 없으면 지금-수업시간
  _sc={ id, kind, date:k, tab: kind==='start'?'start':'end',
    start: startMs, end: (kind==='start') ? null : nowMs };
  scSend();                                        // 기록 + 발송 (기존 단일 경로 재사용)
}
function resend(id,kind){ openNotify(id,kind); }
/* 실제 발송: 문자는 sms:로 문자앱이 내용 채워 열림, 카톡은 (특정 대화방 자동입력 불가라)
   메시지를 복사한 뒤 카톡 앱을 열어 붙여넣기. 데스크탑에선 문자앱이 없어 열리지 않을 수 있어요(모바일 앱에서 사용). */
let _notifyCtx=null;
/* 문자 발송 서버 (구글 앱스 스크립트 + 솔라피). 실패면 {ok:false} 반환 → 앱이 열어주기로 폴백 */
const NOTIFY_URL='https://script.google.com/macros/s/AKfycbx7lHQWk41x2ZtrZb9wl51iWDYEMV4hTT5HZpN7PSEsmTirfIA6mbnpCjBDabvGsIv_/exec';
async function serverSend(to, kind, text, opt){
  try{
    if(!NOTIFY_URL) return {ok:false, channel:'no-server'};
    const o=opt||{alimtalk:autoSend, sms:autoSms};
    const u=firebase.auth().currentUser;
    const idToken=u ? await u.getIdToken() : null;   // 서버가 관리자 로그인인지 검증
    const res=await fetch(NOTIFY_URL, {method:'POST', body:JSON.stringify({to, kind, text,
      tplCode: (msgTemplates[kind]&&String(msgTemplates[kind].code||'').trim())||null,   // 알림 문구 화면에 입력한 승인 템플릿 코드 — 있으면 최우선 사용
      useAlimtalk: !!o.alimtalk,          // 알림톡 발송 여부 (채널 승인 후 지원)
      useSms: !!o.sms,                    // 문자 발송 여부
      fallbackSms: !!(o.alimtalk && o.sms), // 알림톡 실패 시 문자 대체
      vars: o.vars||null,                   // 알림톡 변수 #{}
      idToken
    })});
    const r=await res.json();
    return r || {ok:false};
  }catch(e){ return {ok:false, channel:'error', message:String(e)}; }
}
/* 알림톡 변수(#{}) 자동 생성 */
function notifyVarsFor(id, kind){
  const s=st(id); if(!s) return {};
  const g=guardiansOf(s)[0]||{};
  /* ★ 변수 뜻을 하나로 고정 (2026-07-27):
       #{회차}  = 지금까지 진행한 회차 (doneCountOf)
       #{총회차} = 계약 총 회차 (s.plan)
     예전엔 발송 경로마다 #{회차}에 다른 숫자가 들어가 보호자에게 다르게 나갔다. */
  const base={ 학원명:academy.name||'', 원장명:academy.owner||'', 학생명:s.name,
    보호자명:g.name||'', 시각:hm12(nowHM()),
    회차:String(doneCountOf(s)), 총회차:String(s.plan||0),
    금액:won(priceOf(s)).replace(/원$/,''), 내용:'' };
  if(kind==='settle'){
    const ci=currentClassInfo(s);
    const fD=(ms)=>{ if(!ms) return '-'; const d=new Date(ms); return `${d.getMonth()+1}.${d.getDate()}(${WD[d.getDay()]})`; };
    const cnt=s.plan, done=doneCountOf(s);
    base.시작일=fD(ci.start); base.종료일=fD(ci.end); base.기간=`${fD(ci.start)} ~ ${fD(ci.end)}`;
    base.완료안내 = done>=cnt ? `${s.name} 학생의 이번 회차 수업을 모두 마쳤습니다.`
                             : `${s.name} 학생의 이번 회차 수업이 ${fD(ci.end)} 완료 예정입니다.`;
  }
  return base;
}
/* 자동발송: 보호자 전원에게 알림톡. 하나라도 실패하면 열어주기로 폴백 */
async function autoSendAll(sid, kind, text, gs, vars){
  const s=st(sid);
  const chan = autoSend ? (autoSms?'알림톡':'알림톡') : '문자';
  showToast(`${s.name} ${chan} 발송 중…`);
  const _v = vars || notifyVarsFor(sid, kind);
  if(kind==='guide' && !_v.내용) _v.내용 = text;
  /* ★ 2026-07-27g: 연락처가 비어 있으면 발송하지 않는다.
       (원장님이 시험 중 오발송을 막으려고 일부러 비워 두신 값 — 저장은 막지 않고 발송만 막는다) */
  const _dg=(g)=>String(g.phone||'').replace(/[^0-9]/g,'');
  const _tgt=gs.filter(g=>_dg(g)), _skip=gs.filter(g=>!_dg(g));
  if(!_tgt.length){ showToast(`${s.name} 보호자 연락처가 비어 있어 발송하지 않았어요`); return; }
  let fail=0;
  for(const g of _tgt){
    const gv = Object.assign({}, _v, {보호자명: g.name||_v.보호자명||''});
    const r=await serverSend(g.phone, kind, text, {alimtalk:autoSend, sms:autoSms, vars: gv});
    if(!r||!r.ok) fail++;
  }
  const _sx=_skip.length?` · 연락처 없는 보호자 ${_skip.length}명은 건너뜀`:'';
  if(fail===0){ showToast(`${s.name} 보호자에게 ${chan} 발송 완료${(autoSend&&autoSms)?' (실패 시 문자 대체)':''}${_sx}`); return; }
  showToast('자동 발송이 안 돼 메시지 열기로 전환합니다');
  _notifyCtx={gs, text}; openMsgTo(0);   // ★ 수동 폴백은 전원 그대로 — 카톡 붙여넣기는 번호가 필요 없다
}
function buildNotifyText(s,kind){
  const t=hm12(nowHM());
  const vars={학원명:academy.name||'', 학생명:s.name, 시각:t,
    회차:String(doneCountOf(s)), 총회차:String(s.plan||0),   // ★ notifyVarsFor 와 같은 뜻
    금액:won(priceOf(s)).replace(/원$/,''), 내용:''};
  const tpl=(msgTemplates[kind]&&msgTemplates[kind].sms)||'';
  /* ★ 2026-07-27h: 문구가 비면 빈값을 돌려준다. 코드가 문장을 지어내지 않는다.
     부르는 쪽(openNotify)이 빈값이면 발송을 막는다. */
  return applyVars(tpl, vars).trim();
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
  /* ★ 2026-07-27h: 문구가 비어 있으면 보내지 않는다. 기록은 이미 남았고 데이터는 건드리지 않는다. */
  if(!text){ showToast(`${word} 문구가 비어 있어요 — 설정 > 알림 문구에서 먼저 채워주세요`); return; }
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
  return perDayOn(s)
    ? s.days.slice().sort((a,b)=>a-b).map(d=>`${WD[d]} ${hm12(timeFor(s,d))}`).join(' / ')
    : `${s.days.slice().sort((a,b)=>a-b).map(d=>WD[d]).join('·')} · ${hm12(s.time)||'시각 미설정'}`;
}
/* ===== 학습 기록 보기 · 학습 분석 ===== 2026-07-28u
   원장님 지시 — "달력 옆에 '학습기록' 버튼 만들고 누르면 날짜별로 볼 수 있게.
                 그것을 바탕으로 AI 학습 분석 결과도 볼 수 있게".
   ★ 자료를 새로 만들지 않는다. 출석부 [학습]에서 쌓아 온 lessons 배열이 유일한 원본이다.
     lessons 한 줄 = {sid:학생 번호, date:적은 날, mood:태도(MOODS 중 하나 또는 빈값), text:적은 글}
     저장되는 곳 = 파이어베이스 state/app 문서의 lessons 칸.
     올리는 곳은 snapshot(), 내려받는 곳은 applyState() 하나씩뿐이다(단일 소스).
   ★ 분석은 앱이 이 기록만 세어서 만든다. 바깥으로 아무것도 보내지 않고 요금도 들지 않는다.
     기록이 없으면 아무 말도 지어내지 않고 '아직 없어요'라고만 한다. */
/* ★ 2026-07-29aa — 원장님 지시로 학생 카드의 [학습 기록 ▾] 를 되살렸다.
   기록을 보는 곳은 학생 카드 한 곳뿐이다(시트 안에는 넣지 않는다).
   펼쳐 둔 학생 번호는 달력(stuCal)과 같은 방식으로 화면에서만 든다 — 서버에 저장하지 않는다. */
let stuLog={open:null};                 // 지금 펼쳐 둔 학생 번호
function toggleStuLog(id){ stuLog.open = (stuLog.open===id) ? null : id; renderStudents(); }
function lessonsOf(sid){ return lessons.filter(l=>l && l.sid===sid && l.date).slice().sort((a,b)=>b.date-a.date); }
/* ★ 2026-07-29w — 학습 결과를 주 / 달 / 해 / 전체로 나눠 본다.
     원장님 지시 — "결과를 주단위 / 월단위 / 년 / 전체 로 볼수 있는 기능도 넣어줘
     (당연히 주, 월, 년 선택할 수 있어야 겠지요?"
   ★ 고른 기간은 화면에서만 쓰고 서버에 저장하지 않는다(창을 닫으면 '전체'로 돌아온다).
   ★ 주는 앱 달력과 같은 규칙으로 일요일에 시작한다 — 화면마다 다른 규칙을 두지 않는다.
   ★ ref 는 지금 보고 있는 기간 안의 아무 날(밀리초). 이 값 하나로 주·달·해를 모두 옮긴다. */
let lsnRange={mode:'all', ref:null};
const LSN_MODES=[['w','주'],['m','달'],['y','해'],['all','전체']];
function lsnRangeRef(){ return lsnRange.ref===null ? dayKey(now.getTime()) : lsnRange.ref; }
/* 지금 고른 기간의 시작·끝(둘 다 그 날 0시). 전체면 null 을 돌려준다 — 없는 경계를 지어내지 않는다. */
function lsnRangeBounds(){
  if(lsnRange.mode==='all') return null;
  const d=new Date(lsnRangeRef()), y=d.getFullYear(), m=d.getMonth();
  if(lsnRange.mode==='w'){
    const s0=new Date(y,m,d.getDate()-d.getDay());
    return {from:dayKey(s0.getTime()), to:dayKey(new Date(y,m,d.getDate()-d.getDay()+6).getTime())};
  }
  if(lsnRange.mode==='m') return {from:dayKey(new Date(y,m,1).getTime()), to:dayKey(new Date(y,m+1,0).getTime())};
  return {from:dayKey(new Date(y,0,1).getTime()), to:dayKey(new Date(y,11,31).getTime())};
}
function lsnRangeLabel(){
  const b=lsnRangeBounds();
  if(!b) return '전체 기간';
  const f=new Date(b.from), t=new Date(b.to);
  if(lsnRange.mode==='w') return `${f.getFullYear()}. ${f.getMonth()+1}. ${f.getDate()}. ~ ${t.getMonth()+1}. ${t.getDate()}.`;
  if(lsnRange.mode==='m') return `${f.getFullYear()}년 ${f.getMonth()+1}월`;
  return `${f.getFullYear()}년`;
}
/* 그 기간에 든 기록만 남긴다. 전체면 그대로 둔다. */
function lsnInRange(ls){
  const b=lsnRangeBounds();
  if(!b) return ls;
  return ls.filter(l=>{ const k=dayKey(l.date.getTime()); return k>=b.from && k<=b.to; });
}
/* 날짜 밀리초 목록을 같은 기준으로 거른다 — 결석·보강도 기간에 맞춰 센다 */
function lsnMsInRange(list){
  const b=lsnRangeBounds();
  if(!b) return list;
  return list.filter(ms=>{ const k=dayKey(ms); return k>=b.from && k<=b.to; });
}
/* 오늘이 든 기간보다 앞으로는 가지 않는다 — 아직 오지 않은 주·달·해를 보여 줄 이유가 없다 */
/* 지금 보고 있는 기간 안에 오늘이 들어 있나 — [오늘] 단추를 보일지 정하는 데 쓴다.
   ★ 2026-07-29 고침: 예전엔 끝날짜만 견줘서 지난 기간도 '오늘'로 쳤고,
   그 바람에 지난 기간에서 [오늘] 단추가 안 보이고 앞으로 넘기는 것도 안 막혔다. */
function lsnRangeAtNow(){
  const b=lsnRangeBounds();
  if(!b) return true;
  const k=dayKey(now.getTime());
  return k>=b.from && k<=b.to;
}
function lsnRangeSet(m){
  lsnRange.mode=m;
  lsnRange.ref = (m==='all') ? null : dayKey(now.getTime());   // 고를 때마다 오늘이 든 기간부터 본다
  renderStudents();
}
function lsnRangeNav(step){
  if(lsnRange.mode==='all') return;
  const d=new Date(lsnRangeRef());
  const nd = lsnRange.mode==='w' ? new Date(d.getFullYear(),d.getMonth(),d.getDate()+7*step)
           : lsnRange.mode==='m' ? new Date(d.getFullYear(),d.getMonth()+step,1)
           : new Date(d.getFullYear()+step,0,1);
  const save=lsnRange.ref; lsnRange.ref=dayKey(nd.getTime());
  /* 앞으로는 오늘이 든 기간까지만 — 오늘보다 뒤에서 시작하는 기간이면 되돌린다 */
  if(step>0 && dayKey(now.getTime())<lsnRangeBounds().from){
    lsnRange.ref=save; showToast('아직 오지 않은 기간이에요'); return;   // 앞으로는 오늘이 든 기간까지만
  }
  renderStudents();
}
function lsnRangeToNow(){ if(lsnRange.mode!=='all'){ lsnRange.ref=dayKey(now.getTime()); renderStudents(); } }
function lsnRangeBar(){
  const tabs=LSN_MODES.map(m=>`<button type="button" class="lsc-chip ${lsnRange.mode===m[0]?'on':''}" onclick="lsnRangeSet('${m[0]}')">${m[1]}</button>`).join('');
  const nav = lsnRange.mode==='all' ? '' : `<div class="lsn-nav">
      <button type="button" class="lsn-nav-b" onclick="lsnRangeNav(-1)" aria-label="이전">‹</button>
      <span class="lsn-nav-t">${lsnRangeLabel()}</span>
      <button type="button" class="lsn-nav-b" onclick="lsnRangeNav(1)" aria-label="다음">›</button>
      ${lsnRangeAtNow()?'':`<button type="button" class="lsc-sw" onclick="lsnRangeToNow()">오늘</button>`}
    </div>`;
  return `<div class="lsn-rg"><div class="lsc-chips sm">${tabs}</div>${nav}</div>`;
}
function lsnEsc(t){ return String(t==null?'':t).replace(/</g,'&lt;'); }
/* 셈에서 빼는 흔한 말 — 이게 위로 올라오면 아무 도움이 안 된다 */
const LSN_STOP=['그리고','하지만','오늘','다음','조금','정도','계속','아주','너무','매우','에서','으로','하고','했어요','합니다','같아요','같음','수업','학생','시간','부분','조금씩'];
function lsnWords(ls){
  const cnt={};
  ls.forEach(l=>{ String(l.text||'').split(/[^가-힣A-Za-z0-9]+/).forEach(w=>{
    if(w.length<2 || LSN_STOP.indexOf(w)>=0) return;
    cnt[w]=(cnt[w]||0)+1; }); });
  return Object.keys(cnt).filter(w=>cnt[w]>=2)
    .sort((a,b)=>cnt[b]-cnt[a]||a.localeCompare(b,'ko')).slice(0,6).map(w=>({w:w,n:cnt[w]}));
}
const LSN_GOOD=['집중','열의'];         // '좋은 편'으로 세는 태도 (MOODS 안의 값)
const LSN_WATCH=['산만','피곤'];        // '살펴볼 편'으로 세는 태도 (MOODS 안의 값)
/* 배지 색만 정한다 - 값 자체는 바꾸지 않는다 */
function lsnMoodCls(m){ return LSN_GOOD.indexOf(m)>=0 ? 'g' : (LSN_WATCH.indexOf(m)>=0 ? 'w' : 'n'); }
function lsnGoodRate(ls){
  const m=ls.filter(l=>l.mood);
  if(!m.length) return null;
  return Math.round(m.filter(l=>LSN_GOOD.indexOf(l.mood)>=0).length*100/m.length);
}
/* 갈래별 셈 — 횟수 · 정답률 평균 · 푼 문제 수. 화면과 그래프가 같은 곳을 본다. */
function lsnCatStats(ls){
  const m={};
  ls.forEach(l=>{ (Array.isArray(l.cats)?l.cats:[]).forEach(k=>{
    const o = m[k] || (m[k]={k:k, n:(k==='etc' ? (l.catEtc||'기타') : (catName(k)||k)), cnt:0, accN:0, accSum:0, qn:0});
    o.cnt++;
    if(typeof l.acc==='number'){ o.accN++; o.accSum+=l.acc; }
    if(l.qn>0) o.qn+=l.qn;
  }); });
  return Object.keys(m).map(k=>{ const o=m[k]; o.avg = o.accN ? Math.round(o.accSum/o.accN) : null; return o; })
    .sort((a,b)=>b.cnt-a.cnt || a.n.localeCompare(b.n,'ko'));
}
function lessonAnalysis(s, lsIn){
  /* ★ 목록·그래프·분석이 모두 같은 목록을 본다 — 거르는 규칙을 두 곳에 두지 않는다 */
  const ls = lsIn || lsnInRange(lessonsOf(s.id));   // 최신순
  if(!ls.length){
    const all=lessonsOf(s.id).length;
    if(!all) return '<div class="lsn-ai none">아직 학습 기록이 없어요. 출석부에서 그 학생 [학습]을 눌러 적으면 여기에 쌓입니다.</div>';
    return `<div class="lsn-ai none">${lsnEsc(lsnRangeLabel())}에는 적어 두신 기록이 없어요. 전체로는 ${all}건 있습니다.</div>`;
  }
  const old=ls.slice().reverse();                 // 오래된 순
  const lines=[];
  const md=(d)=>`${d.getMonth()+1}월 ${d.getDate()}일`;
  lines.push(`${md(old[0].date)}부터 ${md(old[old.length-1].date)}까지 <b>${ls.length}번</b> 적으셨어요.`);
  // ① 태도 세기 — MOODS 순서 그대로
  const mc={}; MOODS.forEach(m=>{mc[m]=0;});
  let moodN=0;
  ls.forEach(l=>{ if(l.mood && mc[l.mood]!==undefined){ mc[l.mood]++; moodN++; } });
  if(moodN){
    const txt=MOODS.filter(m=>mc[m]>0).sort((a,b)=>mc[b]-mc[a]).map(m=>`${m} ${mc[m]}번`).join(' · ');
    lines.push(`태도는 ${txt} 입니다.`);
    /* 태도를 고른 것만 먼저 추린 뒤 가까운 다섯 번 — 먼저 자르면 빈 것 때문에 개수가 모자란다 */
    const recent=old.filter(l=>l.mood).slice(-5);
    if(recent.length>=2) lines.push(`가까운 순서대로 태도는 ${recent.map(l=>l.mood).join(' → ')} 이었어요.`);
    // 앞쪽 절반과 뒤쪽 절반 견주기 — 기록이 6개 이상일 때만(적으면 견줄 값이 못 된다)
    if(moodN>=6){
      const half=Math.floor(old.length/2);
      const a=lsnGoodRate(old.slice(0,half)), b=lsnGoodRate(old.slice(half));
      if(a!==null && b!==null){
        const d=b-a;
        lines.push(d>=10 ? `앞쪽 절반보다 뒤쪽 절반에서 '집중·열의'가 ${a}%→${b}%로 <b>늘었어요.</b>`
                 : d<=-10 ? `앞쪽 절반보다 뒤쪽 절반에서 '집중·열의'가 ${a}%→${b}%로 <b>줄었어요.</b> 한 번 살펴보시면 좋겠어요.`
                 : `'집중·열의' 비율은 ${a}%→${b}%로 비슷하게 이어지고 있어요.`);
      }
    }
  } else {
    lines.push('태도를 고르신 기록이 아직 없어요. 태도를 같이 고르시면 흐름을 볼 수 있어요.');
  }
  /* ★ 과제 — 고르신 기록만 센다. 0번인 항목은 적지 않는다(없는 말을 적지 않는다).
     세는 값·이름은 HWS 한 곳에서만 온다. */
  const hc={}; let hwN=0;
  ls.forEach(l=>{ if(hwInfo(l.hw)){ hc[l.hw]=(hc[l.hw]||0)+1; hwN++; } });
  if(hwN){
    lines.push(`과제는 ${HWS.filter(h=>hc[h.k]>0).map(h=>`${h.n} ${hc[h.k]}번`).join(' · ')} 입니다.`);
  }
  // ② 수업 내용 갈래 — 고르신 기록만 센다
  const cs=lsnCatStats(ls);
  if(cs.length){
    lines.push(`수업 내용은 ${cs.slice(0,3).map(o=>`<b>${lsnEsc(o.n)}</b> ${o.cnt}번`).join(' · ')} 순으로 많았어요.`);
  }
  // ③ 문제 수 · 정답률
  const accs=ls.filter(l=>typeof l.acc==='number');
  const qns=ls.filter(l=>l.qn>0);
  if(qns.length){
    const tot=qns.reduce((a,l)=>a+l.qn,0);
    lines.push(`푼 문제는 ${qns.length}번에 걸쳐 모두 <b>${tot}문제</b>예요.`);
  }
  if(accs.length){
    const avg=Math.round(accs.reduce((a,l)=>a+l.acc,0)/accs.length);
    lines.push(`정답률을 적으신 ${accs.length}번의 평균은 <b>${avg}%</b>입니다.`);
    if(accs.length>=4){
      const oa=accs.slice().sort((a,b)=>a.date-b.date);
      const h=Math.floor(oa.length/2);
      const a1=Math.round(oa.slice(0,h).reduce((a,l)=>a+l.acc,0)/h);
      const a2=Math.round(oa.slice(h).reduce((a,l)=>a+l.acc,0)/(oa.length-h));
      const d=a2-a1;
      lines.push(d>=10 ? `정답률이 앞쪽 ${a1}% → 뒤쪽 ${a2}%로 <b>올랐어요.</b>`
               : d<=-10 ? `정답률이 앞쪽 ${a1}% → 뒤쪽 ${a2}%로 <b>떨어졌어요.</b> 한 번 살펴보시면 좋겠어요.`
               : `정답률은 앞쪽 ${a1}% → 뒤쪽 ${a2}%로 비슷하게 이어지고 있어요.`);
    }
    /* 갈래별로 견주는 것은 각 갈래에 정답률 기록이 2번 이상 있을 때만 — 한 번 값으로는 잘 하고 못 하고를 말할 수 없다 */
    const per=cs.filter(o=>o.accN>=2);
    if(per.length>=2){
      const hi=per.slice().sort((a,b)=>b.avg-a.avg)[0], lo=per.slice().sort((a,b)=>a.avg-b.avg)[0];
      if(hi.k!==lo.k) lines.push(`갈래로 보면 <b>${lsnEsc(hi.n)}</b> ${hi.avg}%가 가장 높고, <b>${lsnEsc(lo.n)}</b> ${lo.avg}%가 가장 낮아요.`);
    }
  }
  // ④ 결석·보강 — absentLog / makeupLog 에서 직접 센다
  const ab=lsnMsInRange(absentLog[s.id]||[]).length;
  const mk=lsnMsInRange((makeupLog[s.id]||[]).map(x=>x&&x.t).filter(x=>x)).length;
  /* ★ 2026-07-29 — 0번은 적지 않는다. 기간을 좁히면 한쪽만 0 이 되는데
     '보강 0번이 남아 있어요'는 없는 말을 적는 것과 같다. 있는 것만 적는다. */
  if(ab||mk){
    const pt=[]; if(ab) pt.push(`결석 ${ab}번`); if(mk) pt.push(`보강 ${mk}번`);
    lines.push(`${lsnRange.mode==='all'?'지금까지 기록으로는':lsnEsc(lsnRangeLabel())+'에는'} ${pt.join(', ')}이 남아 있어요.`);
  }
  // ⑤ 마지막으로 적은 지 얼마나 됐나 — 기간을 좁혀 놓으면 뜻이 달라지므로 '전체'일 때만 말한다
  if(lsnRange.mode==='all'){
    const gap=Math.round((dayKey(now.getTime())-dayKey(ls[0].date.getTime()))/86400000);
    if(gap>=7) lines.push(`마지막으로 적으신 지 <b>${gap}일</b> 됐어요.`);
  }
  return `<div class="lsn-ai"><div class="lsn-ai-h">학습 분석</div>`
    + lines.map(t=>`<div class="lsn-ai-l">· ${t}</div>`).join('')
    /* ★ 2026-07-29 원장님 지시 — 이 아래에 있던 안내 문구를 뺐다.
       이 화면을 그대로 부모님께 학습알림장으로 보낼 수 있어서, 안에서만 쓰는 말이 들어가면 안 된다. */
    + `</div>`;
}
/* 정답률 흐름 — 그림은 앱이 직접 그린다(바깥 그림 도구를 불러오지 않는다).
   정답률을 적어 두신 기록만, 오래된 것부터 최근 12번까지. 두 번은 있어야 선이 된다. */
function lsnAccChart(ls){
  const pts=ls.filter(l=>typeof l.acc==='number').slice().sort((a,b)=>a.date-b.date).slice(-12);
  if(pts.length<2) return '';
  const W=320,H=140,L=30,R=10,T=12,B=26, iw=W-L-R, ih=H-T-B;
  const x=i=>L+iw*i/(pts.length-1), y=v=>T+ih*(100-v)/100;
  const path=pts.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`).join(' ');
  const grid=[0,50,100].map(v=>`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W-R}" y2="${y(v).toFixed(1)}" class="lsn-g"/>`
    +`<text x="${L-6}" y="${(y(v)+3.5).toFixed(1)}" class="lsn-yl">${v}</text>`).join('');
  const dots=pts.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.acc).toFixed(1)}" r="3.2" class="lsn-dot"/>`).join('');
  const dl=(p)=>`${p.date.getMonth()+1}/${p.date.getDate()}`;
  const xl=`<text x="${L}" y="${H-7}" class="lsn-xl" text-anchor="start">${dl(pts[0])}</text>`
        +`<text x="${W-R}" y="${H-7}" class="lsn-xl" text-anchor="end">${dl(pts[pts.length-1])}</text>`;
  return `<div class="lsn-ch"><div class="lsn-ch-h">정답률 흐름 <span>최근 ${pts.length}번 · 마지막 ${pts[pts.length-1].acc}%</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="lsn-svg" role="img" aria-label="정답률 흐름 그래프">${grid}<path d="${path}" class="lsn-line"/>${dots}${xl}</svg></div>`;
}
/* 수업 내용 갈래 막대 — 많이 한 순서 여섯 개까지. 정답률은 그 갈래에 적어 두신 것만 평균낸다. */
function lsnCatChart(ls){
  const cs=lsnCatStats(ls).slice(0,6);
  if(!cs.length) return '';
  const max=cs[0].cnt||1;
  return `<div class="lsn-ch"><div class="lsn-ch-h">수업 내용 <span>많이 한 순서</span></div>`
    + cs.map(o=>`<div class="lsn-bar"><div class="lsn-bar-n">${lsnEsc(o.n)}</div>
        <div class="lsn-bar-t"><i style="width:${Math.round(o.cnt*100/max)}%"></i></div>
        <div class="lsn-bar-v">${o.cnt}번${o.avg!==null?` · ${o.avg}%`:''}</div></div>`).join('')
    + `</div>`;
}
function lessonLogHtml(s){
  const all=lessonsOf(s.id);
  const ls=lsnInRange(all);              // 최신 날짜가 위로
  const rows = ls.map(l=>{
    const d=l.date;
    const cats=(Array.isArray(l.cats)?l.cats:[]).map(k=> k==='etc' ? lsnEsc(l.catEtc||'기타') : lsnEsc(catName(k)||k));
    const catHtml = cats.length ? `<div class="lsn-cats">${cats.map(n=>`<span class="lsn-cat">${n}</span>`).join('')}</div>` : '';
    /* ★ 2026-07-29 원장님 지시 — "문제수와 정답률은 그래프로 그려줘. 100문제를 최대로,
       100점을 만점으로, 화면의 비율로 그려주면 됨."
       칸 너비를 100 으로 보고 그 비율만큼 채운다. 100 이 넘어도 칸을 넘지 않게 100 에서 멈춘다.
       숫자도 같이 적는다 — 막대만 있으면 정확한 값을 못 읽는다.
       고르지 않은 값은 막대를 그리지 않는다(0 으로 지어내지 않는다). */
    const meter=(k,v,txt,cls)=>`<div class="lsn-mt ${cls}">
        <span class="lsn-mt-k">${k}</span>
        <span class="lsn-mt-bar"><i style="width:${Math.max(0,Math.min(100,v))}%"></i></span>
        <span class="lsn-mt-v">${txt}</span></div>`;
    const num=[];
    if(l.qn>0) num.push(meter('문제 수', l.qn, `${l.qn}문제`, 'q'));
    if(typeof l.acc==='number') num.push(meter('정답률', l.acc, `${l.acc}%`, 'a'));
    const numHtml = num.length ? `<div class="lsn-num">${num.join('')}</div>` : '';
    /* ★ 안내사항 — 적어 두신 날만 한 줄로 보인다(없으면 줄 자체가 없다) */
    const infoHtml = l.info ? `<div class="lsn-i"><span class="lsn-i-k">안내사항</span>${lsnEsc(l.info)}</div>` : '';
    /* 과제·안내사항만 남기신 날도 '비어 있어요'가 뜨면 안 된다 — 적어 두신 것이 있는 날이다 */
    const body = lsnEsc(l.text) || (catHtml||numHtml||infoHtml||l.mood||hwInfo(l.hw) ? '' : '<span class="lsn-none">비어 있어요</span>');
    return `<div class="lsn-row">
      <div class="lsn-d">${lsnDateFull(d.getTime())}${l.mood?` <span class="lsn-m ${lsnMoodCls(l.mood)}">${lsnEsc(l.mood)}</span>`:''}${hwInfo(l.hw)?` <span class="lsn-m ${hwCls(l.hw)}">과제 ${hwName(l.hw)}</span>`:''}</div>
      ${catHtml}${numHtml}
      ${body?`<div class="lsn-t">${body}</div>`:''}${infoHtml}</div>`;
  }).join('');
  return `<div class="lsn-wrap">
    ${lsnRangeBar()}
    ${lessonAnalysis(s, ls)}
    ${lsnAccChart(ls)}
    ${lsnCatChart(ls)}
    <div class="lsn-h">날짜별 기록 ${ls.length?`<span class="lsn-n">${ls.length}건</span>`:''}${lsnRange.mode!=='all'?`<span class="lsn-n">전체 ${all.length}건</span>`:''}</div>
    ${rows || `<div class="lsn-empty">${all.length? lsnEsc(lsnRangeLabel())+'에는 적어 두신 기록이 없어요.' : '아직 적어 두신 기록이 없어요.'}</div>`}
  </div>`;
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
  const dayTime=(forDay!=null)?`⏰ ${WD[forDay]} ${hm12(timeFor(s,forDay))}`:'';
  const infoLine = (eduTxt||dayTime) ? `<div class="mg-line">${[eduTxt?'🎓 '+eduTxt:'', dayTime].filter(Boolean).join(' · ')}</div>` : '';
  const schedLine = `<div class="mg-line">📅 정기 수업일 ${schedText(s)} · <b>${durLabel(durOf(s))}</b></div>`;
  const rangeLine = `<div class="mg-line">🔄 이번 클래스 ${ci.start?fmtD(ci.start):'-'} ~ ${ci.end?fmtD(ci.end):'-'} (예상 종료)</div>`;
  const pastHtml = pastClassesHtml(s);
  /* ★ 2026-07-29aa 원장님 지시 — "학습메모를 메뉴를 넣어달라는 거고,
     기존에 있던 학습기록은 있어야 할 것 아니냐"
     → 적는 곳([학습])과 보는 곳([학습 기록 ▾])을 다시 나눔다.
     앞서 줄인 것은 오늘용·지난날용 학습 단추 둘이며, 그것은 그대로 하나(lsnBtn)로 둔다.
     단추 글자·색을 만드는 곳은 lsnBtn 한 곳뿐이다. */
  const calBtn = `<div class="row-btns">
      <button class="btn ghost small" onclick="toggleStuCal(${s.id})">${stuCal.open===s.id?'달력 닫기 ▲':'달력 보기 ▾'}</button>
      <button class="btn ghost small" onclick="toggleStuLog(${s.id})">${stuLog.open===s.id?'학습통계 닫기 ▲':'학습통계 ▾'}</button>
      ${lsnBtn(s.id, null, 'small')}
    </div>`;
  const calHtml = (stuCal.open===s.id ? buildCalendar(s, stuCal, `stuCalNav(${s.id},-1)`, `stuCalNav(${s.id},1)`) : '')
                + (stuLog.open===s.id ? lessonLogHtml(s) : '');
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
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(hm12(t)); } html+=studentCard(s,d); });
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
/* [폐기] 종료일부터 거꾸로 세는 역산 — 2026-07-27 무결성 통일로 사용 중지.
   '앞으로 계산(classOf)'과 '뒤로 역산' 두 방향이 공존해서 화면마다 값이 달라졌다.
   지금은 시작일에서 앞으로 계산하는 classOf 한 방향만 쓴다.
   ※ 시작일이 아예 없는 옛 기록을 되살릴 때만 남겨 둔 보조 함수. */
function sessionDaysBack(s, endMs, count){
  const out=[], base=dayKey(endMs);
  for(let i=0;i<900 && out.length<count;i++){
    const d=new Date(base); d.setDate(d.getDate()-i); const k=dayKey(d.getTime());
    if(isSessionDay(s,k)) out.push(k);
  }
  return out.reverse();
}
/* 옛 기록에 시작일이 없을 때만 1회 복구 — 종료일에서 역산해 시작일을 만들어 준다 */
function backfillHistStart(s, h){
  if(!s || !h) return null;
  if(h.start!=null) return dayKey(h.start);
  if(Array.isArray(h.sessions) && h.sessions.length) return dayKey(Math.min.apply(null,h.sessions));
  const en = (h.end!=null) ? dayKey(h.end) : (h.settledDate ? dayKey(new Date(h.settledDate).getTime()) : null);
  if(en==null) return null;
  const l=sessionDaysBack(s, en, h.done||h.plan||0);
  return l.length ? l[0] : null;
}

/* 지난 회차(클래스) 이력 표시 상태 */
let histAllOpen=new Set(), histRowOpen=new Set(), histCalOpen=new Set();
function toggleHistCal(key){ if(histCalOpen.has(key))histCalOpen.delete(key); else histCalOpen.add(key);
  renderStudents(); if(document.getElementById('v-manage')) renderManage(); }
/* 지난 클래스 달력 — 그 기간이 걸친 달을 모두 표시, 그 회차 날짜를 출석으로 색칠 */
function histCalendar(s, h, list){
  const c_=histClassOf(s,h);                                                   // ★ 카드 기간과 반드시 같은 계산기를 쓴다
  const st_=c_.start||(list&&list[0]), en=c_.end||(list&&list[list.length-1]);
  const inRange=(k)=>st_!=null && en!=null && k>=st_ && k<=en;
  const sets={ session:new Set(list||[]), absent:new Set((absentLog[s.id]||[]).map(dayKey).filter(inRange)),
    makeup:new Set((makeupLog[s.id]||[]).map(mk=>dayKey(mk.t)).filter(inRange)),
    skip:new Set((skipLog[s.id]||[]).map(dayKey).filter(inRange)) };
  const ms=monthsBetween(st_, en);
  const grids=ms.map(x=>monthGrid(s.id, x.y, x.m, sets, {readonly:true})).join('<div style="height:10px"></div>');
  return `<div class="cal" style="margin-top:8px">${grids}
    <div class="cal-legend"><span><i class="lg att"></i>수업</span><span><i class="lg" style="background:#EAE3F7"></i>보강</span>
      <span><i class="lg ab"></i>결석</span></div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:4px">이 달력은 ${h.no}차 기간만 표시해요. 이번 회차 일정은 카드 아래 [달력 보기]에 있어요.</div></div>`;
}
function toggleHistAll(sid){ if(histAllOpen.has(sid))histAllOpen.delete(sid); else histAllOpen.add(sid); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
function toggleHistRow(key){ if(histRowOpen.has(key))histRowOpen.delete(key); else histRowOpen.add(key); renderStudents(); if(typeof renderManage==='function' && document.getElementById('v-manage')) renderManage(); }
/* 지난 회차 블록 HTML (최근 3개, 나머지는 '전체 보기') */
/* ===== 지난 클래스 확정 — 이미 끝난 클래스의 날짜를 고정한다 (이번 클래스와 무관) ===== */
/* 지난 클래스: 계산된 회차 날짜를 확정(고정)해서 다시 계산되지 않게 함 */
function askConfirmHist(sid, no){
  const s=st(sid);
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h){ showToast('기록을 찾을 수 없어요'); return; }
  const cnt=h.done||h.plan||0;
  const list=histClassOf(s,h).sessions;               // ★ 단일 계산기 경유
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
  const list=histClassOf(s,h).sessions;               // ★ 단일 계산기 경유
  if(!list.length){ showToast('계산된 날짜가 없어 확정할 수 없어요'); return; }
  h.sessions=list.slice(); h.start=list[0]; h.end=list[list.length-1];
  h.confirmed=true; h.confirmedBy='owner';            // ★ 원장님이 직접 확정한 기록 표시
  syncBillsOfHist(sid, h);                            // 정산 건도 같은 날짜로
  saveData(); closeSheet(); refreshCurrentView();
  showToast(`${s.name} ${no}차 확정 (${fmtMD(h.start)} ~ ${fmtMD(h.end)})`);
}
function unconfirmHist(sid, no){
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h) return;
  h.confirmed=false; saveData(); refreshCurrentView();
  showToast('확정을 해제했어요 (다시 계산됨)');
}

/* 지난 클래스 날짜 수정 — 회차별 날짜를 직접 고쳐서 저장 */
function editHistDates(sid, no){
  const s=st(sid);
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h){ showToast('기록을 찾을 수 없어요'); return; }
  const cnt=h.done||h.plan||0;
  const list=histClassOf(s,h).sessions.slice(0,cnt);  // ★ 단일 계산기 경유
  const rows=Array.from({length:cnt},(_,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:3px 0">
      <span style="font-size:13px;color:var(--muted);white-space:nowrap">${i+1}회차</span>
      <input type="date" class="note-select he-inp" data-i="${i}" value="${dateInputValue(list[i])}" style="flex:1;margin:0"></div>`).join('');
  const sheet=document.getElementById('sheet');
  sheet.innerHTML=`<h3>${s.name} ${no}차 날짜 수정</h3>
    <div class="cap">회차별 날짜를 고친 뒤 저장하세요. 기간·수업 기록·정산 기간이 함께 바뀝니다.</div>
    <div style="background:var(--bg);border-radius:10px;padding:10px 12px;max-height:260px;overflow-y:auto">${rows}</div>
    <div class="sheet-btns" style="margin-top:12px">
      <button class="btn settle" onclick="saveHistDates(${sid},${no})">저장</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  document.getElementById('scrim').classList.add('show');
}
function saveHistDates(sid, no){
  const s=st(sid);
  const h=(packHistory[sid]||[]).find(x=>x.no===no);
  if(!h) return;
  const vals=[...document.querySelectorAll('.he-inp')].map(el=>el.value);
  if(vals.some(v=>!v)){ showToast('비어 있는 날짜가 있어요'); return; }
  const newList=vals.map(v=>dayKey(new Date(v+'T00:00:00').getTime())).sort((a,b)=>a-b);
  if(new Set(newList).size!==newList.length){ showToast('같은 날짜가 두 번 들어갔어요'); return; }
  const oldList=(Array.isArray(h.sessions)?h.sessions.slice():[]).sort((a,b)=>a-b);
  // 이 클래스의 실제 수업 기록도 같은 순서로 날짜 이동 (시각은 유지)
  if(oldList.length===newList.length){
    for(let i=0;i<oldList.length;i++){
      const delta=newList[i]-oldList[i]; if(!delta) continue;
      sessions.forEach(r=>{ if(r.sid===sid && dayKey(r.date)===oldList[i]){
        r.date+=delta; if(r.start) r.start+=delta; if(r.end) r.end+=delta; } });
    }
  }
  // 이 클래스의 정산건 기간도 함께 이동 (종료일이 같은 건만)
  const oldEnd=h.end;
  h.sessions=newList.slice(); h.start=newList[0]; h.end=newList[newList.length-1];
  h.confirmed=true; h.confirmedBy='owner';            // ★ 원장님이 직접 고친 기록 표시
  syncBillsOfHist(sid, h, oldEnd);
  // 마지막(최신) 클래스의 종료일이 바뀌면, 이번 회차 시작일이 겹치지 않게 그 다음 수업일로 자동 이동
  let cycleMoved=false;
  const isLatest = !(packHistory[sid]||[]).some(x=>x.no>no);
  if(isLatest && s.cycleStart && dayKey(s.cycleStart) <= h.end){
    s.cycleStart = nextSessionAfter(s, h.end);
    s.cycleEnd = null;                      // 종료일은 회차·요일로 다시 자동 계산
    // 회차 카운터도 새 시작일 기준 실제 출결 기록 수로 재계산 (남은 카운트 이월 방지)
    const cs2=dayKey(s.cycleStart);
    cycleDone[sid]=sessions.filter(r=>r.sid===sid && dayKey(r.date)>=cs2).length;
    cycleMoved = true;
  }
  saveData(); closeSheet(); refreshCurrentView();
  showToast(`${s.name} ${no}차 날짜 수정됨 (${fmtMD(h.start)} ~ ${fmtMD(h.end)})${cycleMoved?` · 이번 회차는 ${fmtMD(s.cycleStart)}부터`:''}`);
}

/* ★ 2026-07-28o ★ 원장님 지시 — "소용이 있냐 판단하고, 없으면 없애야지"
   [회차 확정] 단추와 그 시트(askConfirmCurrent / confirmCurrent)를 삭제했다.
   이유 ① 하는 일이 학생 시트의 '지난에 수업한 날' 칩 목록(makePastRecs)과 똑같은데,
          칩 목록은 날짜를 하나씩 켜고 끌 수 있고 저장 확인 시트도 거친다 - 문이 둘일 이유가 없다.
        ② 시트 아래 [회차가 달라요 · 수업 시작일 고치기]가 실제로는 아무것도 못 고쳤다.
          이미 기록된 날은 학생 시트에서 잠겨 있기 때문이다.
        ③ 날짜를 하나씩 고를 수 없어서, 누르면 seedUntil(2026.7.21) 이전 날이 통째로 기록이 됐다.
   대신 쓰는 곳 - 지난 수업일을 기록으로 만들기 : 학생 시트의 날짜 칩 목록(makePastRecs).
                 잘못 찍힌 기록 지우기 : 출석부 탭 -> 그 날짜 -> [완료 취소](undoOn). */
function pastClassesHtml(s){
  // 1차 → 2차 순(오래된 것부터). 차수 우선, 없으면 종료일 순
  const all=(packHistory[s.id]||[]).slice().sort((a,b)=>((a.no||0)-(b.no||0)) || ((a.end||0)-(b.end||0)));
  if(!all.length) return `<div class="mg-line" style="color:var(--muted)">📚 지난 클래스 : 아직 없어요</div>`;
  const openAll=histAllOpen.has(s.id);
  const show=openAll?all:all.slice(0,3);
  const rows=show.map(h=>{
    const key=s.id+'-'+h.no;
    // ★ 기간·회차 날짜는 단일 계산기 하나만 통과 (달력·정산·확정 화면과 반드시 같은 값)
    const c_=histClassOf(s,h);
    const list=c_.sessions, st_=c_.start, en=c_.end;
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
        <span style="font-size:12.5px;color:var(--muted)">${won(histAmount(s.id,h))}</span></div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">📅 ${period}</div>
      <div style="display:flex;gap:6px;margin-top:7px">
        <button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="toggleHistRow('${key}')">${open?'접기 ▲':'회차 보기 ▾'}</button>
        <button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="toggleHistCal('${key}')">${calOpen?'달력 닫기 ▲':'달력 보기 ▾'}</button>
        ${(h.confirmed || (en && en < dayKey(now.getTime())))
          ? `<button class="btn ghost small" style="width:auto;padding:5px 10px;font-size:12px" onclick="editHistDates(${s.id},${h.no})">날짜 수정</button>`
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
/* 정산 건의 회차 날짜 — 반드시 단일 계산기(billClassOf)를 통과한다.
   예전엔 여기서 따로 역산해서, 카드 헤더 기간과 펼친 회차 날짜가 서로 달랐다. */
function billSessions(b){
  const c=billClassOf(b);
  if(c.sessions.length) return c.sessions;
  const mine = sessions.filter(x=>x.sid===b.sid && (b.endDate==null || dayKey(x.date)<=b.endDate))
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
  const monthPaidAmt = paidMonth.reduce((a,b)=>a+(billAmount(b)||0),0);
  const unpaidAmt = unpaid.reduce((a,b)=>a+(billAmount(b)||0),0);

  const billRow=(b)=>{
    const s=st(b.sid); const nm=s?s.name:'(삭제된 학생)';
    const c_=billClassOf(b);                       // ★ 헤더 기간과 펼친 회차 날짜를 같은 값으로
    const list=c_.sessions.length?c_.sessions:billSessions(b);
    const startMs = c_.start || (list.length?list[0]:null);
    const endMs_ = c_.end || (list.length?list[list.length-1]:b.endDate);
    const period = startMs ? `${fmtMD(startMs)} ~ ${fmtMD(endMs_)}` : (endMs_?`~ ${fmtMD(endMs_)}`:'기간 미상');
    const open = billOpen.has(b.id);
    const detail = open ? `<div style="background:var(--bg);border-radius:10px;padding:10px 12px;margin-top:9px">
        ${list.length ? list.map((t,i)=>`<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--ink)">
            <span style="color:var(--muted)">${i+1}회차</span><span>${fmtMD(t)}</span></div>`).join('')
          : '<div style="font-size:13px;color:var(--muted)">회차별 날짜 기록이 없어요.</div>'}
      </div>` : '';
    const head=`<div class="row-top"><span class="name">${nm}</span><span class="amt">${won(billAmount(b))}</span></div>
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
  /* ★ 금액을 저장하지 않는다(amount:null). 표시·발송은 billAmount(b)가 요금표에서 읽는다.
       입금 완료 처리(settleBill) 시점에만 '실제 받은 금액'으로 굳힌다. */
  bills.push({id:++billSeq, sid:s.id, plan:s.plan, amount:null,
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
  /* ★ 2026-07-27i 단일 소스: 완주 판정도 달력 하나로만 한다.
       예전엔 저장된 카운터로도 완주 처리돼서, 달력엔 회차가 남았는데 정산 건이 먼저 생길 수 있었다. */
  if(doneCountOf(s) < s.plan) return false;                 // 아직 계약 회차 안 참
  /* ★ 2026-07-27 무결성 통일:
       회차 목록·시작일·종료일을 여기서 따로 만들지 않는다. classOf 결과를 그대로 쓴다.
       예전에는 종료일만 '오늘'로 깎고 회차 목록은 안 깎아서, 저장되는 순간부터
       end 와 sessions 마지막 날짜가 서로 달랐다(정산 헤더 7.24 / 12회차 7.27). */
  let startMs = info.start;
  if(startMs==null){
    const mine = sessions.filter(x=>x.sid===id).map(x=>dayKey(x.date)).sort((a,b)=>a-b);
    startMs = mine.length ? mine[0] : dayKey(now.getTime());
  }
  const cls = classOf(s, startMs, s.plan, {cutoff: seedUntil||0});   // ★ 진행 중에 보이던 기간 그대로 굳힌다
  let sessList = cls.sessions.slice(0, s.plan);
  if(!sessList.length) sessList = info.sessions.slice(0, s.plan);
  const endMs = sessList.length ? sessList[sessList.length-1] : dayKey(now.getTime());
  // ※ '오늘로 자르기' 보정 삭제 — 앱을 연 날짜에 따라 저장값이 달라지던 원인.
  /* ★ 아직 끝나지 않은 클래스를 '지난 클래스'로 만들지 않는다 (2026-07-27).
       마지막 수업일이 아직 안 왔거나, 오늘이 마지막인데 [등원]을 안 눌렀으면 진행 중이다.
       예전엔 이 확인이 없어서 진행 중인 클래스가 지난 클래스·정산 건으로 미리 만들어졌다. */
  const _todayK=dayKey(now.getTime());
  if(endMs>_todayK) return false;
  if(endMs===_todayK && !hasRecordOn(id,_todayK)) return false;
  createBill(s, endMs, {startDate: sessList[0] || startMs, sessions: sessList});  // 이전 클래스 → 정산 필요(미납)
  const hist=packHistory[id]||(packHistory[id]=[]);
  if(hist.some(h=>h.end===endMs)){ cycleDone[id]=0; s.cycleStart=nextSessionAfter(s,endMs); s.cycleEnd=null; return true; }  // 같은 클래스 이력 중복 방지
  hist.push({no:hist.length+1, plan:s.plan, done:s.plan,
    start: sessList[0] || startMs, end: endMs,
    sessions: sessList, amount: null, settledDate:new Date(endMs)});   // 금액은 histAmount()가 요금표에서 읽는다
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
  if(!students.length) return false;                // ★ 빈 상태에선 절대 실행·저장 금지 (2026-07-21 사고 방지)
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
  let ch=false;
  if(confirmPastOnce()) ch=true;                    // 과거 일괄 확정(최초 1회)
  /* ★ [1회성] 2026-07-27 무결성 통일 정리
       예전 버전은 "오늘 이전에 끝난 클래스"를 원장님 확인 없이 자동으로 confirmed 로 바꿔
       그날 잘린 잘못된 종료일을 그대로 고정시켰다. 그 자동 확정만 풀어서 다시 계산되게 한다.
       원장님이 [확정]/[날짜 수정]으로 직접 정한 기록(confirmedBy==='owner')은 손대지 않는다.
       ※ 데이터는 지우지 않는다. confirmed 표시만 해제하고 날짜는 계산기가 다시 만든다. */
  if(histFixV < 1 && students.length){
    students.forEach(s=>{
      (packHistory[s.id]||[]).forEach(h=>{
        if(h.confirmed && h.confirmedBy!=='owner'){ h.confirmed=false; ch=true; }
      });
    });
    bills.forEach(b=>{ if(b.confirmed && b.confirmedBy!=='owner'){ b.confirmed=false; ch=true; } });
    histFixV=1; ch=true;
  }
  // [이전 버전 호환] 옛 '오늘만 추가'(tempToday) → 보강(makeupLog)으로 옮기고 폐기
  if(tempToday.size && tempDay){
    [...tempToday].forEach(id=>{
      const s0=st(id); if(!s0) return;
      const mks=(makeupLog[id]=makeupLog[id]||[]);
      if(!mks.some(x=>dayKey(x.t)===tempDay)){
        const ti=(tempTimes&&tempTimes[id])||{};
        const _t=ti.time||timeFor(s0, new Date(tempDay).getDay());   // ★ 2026-07-28s: 공통 time 대체 삭제
        const _d=+ti.dur||durOf(s0);
        if(!_t || !(_d>0)) return;      // ★ 시각·수업시간이 비어 있으면 만들지 않는다
        mks.push({t:tempDay, time:_t, dur:_d, done:false});
      }
    });
    tempToday=new Set(); tempTimes={}; tempDay=null; ch=true;
  }
  students.forEach(s=>{
    let hist=(packHistory[s.id]||[]);
    hist.forEach(h=>{
      /* ★ 저장값을 여기서 새로 만들지 않는다. 단일 계산기(histClassOf)가 낸 값을 그대로 반영만 한다.
           '미래 종료일 → 오늘로 자르기' 보정은 삭제했다. 앱을 연 날짜에 따라 값이 달라지던 원인. */
      if(h.start==null){ const bf=backfillHistStart(s,h); if(bf!=null){ h.start=bf; ch=true; } }
      const c=histClassOf(s,h);
      if(c.start!=null && h.start!==c.start){ h.start=c.start; ch=true; }
      if(c.end!=null && h.end!==c.end){ h.end=c.end; ch=true; }
      if(c.sessions.length){
        const cur=Array.isArray(h.sessions)?h.sessions:[];
        if(cur.length!==c.sessions.length || cur.some((v,i)=>v!==c.sessions[i])){ h.sessions=c.sessions.slice(); ch=true; }
      }
      /* 금액은 더 이상 지난 클래스에 굳혀 두지 않는다 — histAmount()가 요금표에서 읽는다 */
      syncBillsOfHist(s.id, h);                          // 정산 건 = 지난 클래스와 같은 날짜
    });
    /* 중복 제거는 '완전히 같은 기록'(시작·종료·회차수가 모두 같음)일 때만.
       ★ 종료일만 같다고 지우면 기록이 사라진다 — 데이터 삭제 금지 원칙. */
    const seen={}, out=[];
    hist.slice().sort((a,b)=>((a.start||a.end||0)-(b.start||b.end||0)) || ((a.end||0)-(b.end||0))).forEach(h=>{
      const key=[h.start==null?'':h.start, h.end==null?'':h.end, h.plan||0, h.done||0].join('|');
      if(h.end!=null && h.start!=null && seen[key]){ ch=true; return; }
      seen[key]=1;
      out.push(h);
    });
    out.forEach((h,i)=>{ if(h.no!==i+1){ h.no=i+1; ch=true; } });  // 차수 재부여
    packHistory[s.id]=out;
  });
  bills.forEach(b=>{
    const s2=st(b.sid); if(!s2) return;
    // ★ 정산 건도 같은 계산기 하나만 통과. '미래 종료일 → 오늘로 자르기' 보정 삭제.
    const c=billClassOf(b);
    if(c.start!=null && b.startDate!==c.start){ b.startDate=c.start; ch=true; }
    if(c.end!=null && b.endDate!==c.end){ b.endDate=c.end; ch=true; }
    if(c.sessions.length){
      const cur=Array.isArray(b.sessions)?b.sessions:[];
      if(cur.length!==c.sessions.length || cur.some((v,i)=>v!==c.sessions[i])){ b.sessions=c.sessions.slice(); ch=true; }
    }
  });
  /* ★ [1회성] 2026-07-27 겹침 정리 (histFixV 2) — 날짜 재계산이 모두 끝난 뒤 실행
       '이번 클래스'와 기간이 겹치는 지난 클래스 기록을 정리한다.
         · 확정·입금 완료 기록 → 그대로 두고, 이번 클래스 시작일을 그 다음 수업일로 민다.
         · 미확정·미납 기록    → 완주 전에 성급히 만들어진 것이므로 되돌려 '진행 중'으로 복원한다.
       출결·결석·보강 기록은 건드리지 않는다. */
  if(histFixV < 2 && students.length){
    students.forEach(s=>{ if(resolveClassOverlap(s.id)) ch=true; });
    histFixV=2; ch=true;
  }
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
  const amt=billAmount(b);
  if(amt==null){ showToast(`${b.plan}회 금액이 요금표에 없어요 — 설정 > 수업 기본 설정에서 먼저 넣어주세요`); return; }
  b.paid=true; b.paidDate=Date.now(); b.amount=amt;   // ★ 입금 완료 시점의 실제 금액만 굳힌다
  payments.push({sid:b.sid, date:new Date(b.paidDate), plan:b.plan, amount:amt, billId:bid});
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
  const _amt=priceOf(s);
  if(_amt==null){ showToast(`${s.plan}회 금액이 요금표에 없어요 — 설정 > 수업 기본 설정에서 먼저 넣어주세요`); return; }
  const hist=packHistory[id]||(packHistory[id]=[]);
  // ★ 여기서 날짜를 새로 만들지 않는다 — 이번 클래스 계산 결과를 그대로 넘긴다
  const _cnt=doneCountOf(s)||s.plan;
  const _ci=currentClassInfo(s);
  const _list=_ci.sessions.slice(0,_cnt);
  const _endMs=_list.length?_list[_list.length-1]:(cycleEndOf(s)||dayKey(now.getTime()));
  hist.push({no:hist.length+1, plan:s.plan, done:doneCountOf(s),
    start:_list[0]||_ci.start||null, end:_endMs,
    sessions:_list, amount:null, settledDate:new Date()});
  payments.push({sid:id,date:new Date(),plan:s.plan,amount:_amt});
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
    const bc=billClassOf(b);                 // ★ 정산 안내문도 같은 계산기
    list=bc.sessions.length?bc.sessions:billSessions(b);
    startMs=bc.start||list[0]||null; endMs=bc.end||b.endDate; cnt=b.plan; done=b.plan;
  } else {                                 // 진행 중(미리 안내)
    const ci=currentClassInfo(s);
    list=ci.sessions; startMs=ci.start; endMs=ci.end; cnt=s.plan; done=doneCountOf(s);
  }
  const finished = done>=cnt;
  const fD=(ms)=>{ if(!ms) return '-'; const d=new Date(ms); return `${d.getMonth()+1}.${d.getDate()}(${WD[d.getDay()]})`; };
  const amt = b ? billAmount(b) : priceOf(s);
  const vars={
    학원명: academy.name||'', 원장명: academy.owner||'',
    학생명: s.name, 보호자명: g.name||s.guardian||'',
    /* ★ #{회차} = '그 클래스에서 진행한 회차 수' 하나로 통일 (등하원·정산 모두 같은 뜻).
         완주한 정산 건은 done===plan 이라 값이 같고, 진행 중 미리 안내는 진행 회차가 나간다. */
    회차: String(done), 총회차: String(cnt), 금액: won(amt).replace(/원$/,''),
    시작일: fD(startMs), 종료일: fD(endMs), 기간: `${fD(startMs)} ~ ${fD(endMs)}`,
    시각: hm12(nowHM()), 내용:'',
    완료안내: finished ? `${s.name} 학생의 이번 회차 수업을 모두 마쳤습니다.`
                      : `${s.name} 학생의 이번 회차 수업이 ${fD(endMs)} 완료 예정입니다.`
  };
  const tpl=(msgTemplates.settle&&msgTemplates.settle.sms)||'';
  /* ★ 2026-07-27h: 문구가 비면 빈값. 부르는 쪽(openSettleMsg)이 발송을 막는다. */
  return applyVars(tpl, vars).trim();
}
function openSettleMsg(id, billId){
  const s=st(id);
  const g=(s.guardians&&s.guardians[0])||{};
  /* ★ 금액이 요금표에 없으면 발송을 막는다 — 임의의 숫자를 넣어 보내지 않는다 */
  const _b=billId?bills.find(x=>x.id===billId):null;
  const _amt=_b?billAmount(_b):priceOf(s);
  if(_amt==null){ showToast(`${(_b?_b.plan:s.plan)}회 금액이 요금표에 없어요 — 설정 > 수업 기본 설정에서 먼저 넣어주세요`); return; }
  const text=buildSettleText(id, billId);
  /* ★ 2026-07-27h: 정산 문구가 비어 있으면 보내지 않는다 */
  if(!text){ showToast('정산 요청 문구가 비어 있어요 — 설정 > 알림 문구에서 먼저 채워주세요'); return; }
  /* ★ 2026-07-27h2: 발송 방법이 정해져 있지 않으면 코드가 카톡으로 정하지 않는다. */
  if(g.kakao!==true && g.kakao!==false){
    showToast(`${s.name} 보호자의 발송 방법(카톡/문자만)이 정해지지 않았어요 — 설정 > 학생 관리에서 먼저 골라주세요`); return; }
  _msgCtx={id, text};
  const kakao = g.kakao===true;
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
function closeSheet(){document.getElementById('scrim').classList.remove('show');
  /* ★ 2026-07-27k: 입력 시트를 닫을 때 그 위의 저장 확인창도 같이 치운다 */
  if(typeof cancelSaveStudent==='function') cancelSaveStudent();}
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
          <div class="price-in"><input type="number" value="${(typeof packages[n]==='number')?packages[n]:''}" onchange="setPrice(${n},this.value)"><span>원</span></div>
          ${(n===8||n===12)?'':`<button class="btn ghost small" style="width:auto;margin:0 0 0 8px;padding:9px 12px" onclick="removePackage(${n})">삭제</button>`}
        </div>`).join('')}
      <button class="btn ghost small" style="width:auto;margin-top:8px;padding:10px 16px" onclick="openPackageSheet()">＋ 클래스 추가</button>
    </div>
    <div class="set-sec">
      <h3>메모 마감 알림</h3>
      <div class="cap">이 시각이 지나면 홈에서 '오늘 학습내용 미작성' 학생을 챙겨줘요. (실제 푸시 알림은 앱 출시 때 연결)</div>
      <div class="price-row"><label>마감 시각</label>
        ${timeSel(closeTime, {on:'tsDone(this, setCloseTime)'})}</div>
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
      <div class="mg-line">📞 ${a.phone||'미설정'}</div>
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
let closeTime='';      // ★ 코드 기본값 없음. 설정 > 수업 기본 설정에서만 정한다
function setCloseTime(v){ if(!v){ showToast('마감 시각이 비어 있어요. 채워야 저장됩니다'); openAdmin('basic'); return; } closeTime=v; saveData(); }
function resetData(){ location.reload(); }
function setPrice(plan,val){
  const v=parseInt(val,10);
  if(!isFinite(v)||v<=0){ showToast('금액을 0원보다 크게 넣어주세요'); openAdmin('basic'); return; }
  packages[plan]=v; saveData(); }
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
  const timeTxt = perDayOn(s)
    ? s.days.slice().sort((a,b)=>a-b).map(d=>`${WD[d]} ${hm12(timeFor(s,d))}`).join(' / ')
    : (hm12(s.time)||'시각 미설정');
  const gLines = guardiansOf(s).map((g,i)=>`👤 보호자 ${i+1} : ${g.name} · ${g.phone||'연락처 미설정'} · ${g.kakao?'카톡':'문자'}`).join('<br>');
  /* ★ 2026-07-27j: 입력칸을 없앴으므로 등록일도 단일 함수(enrollStartMs)가 정한 값을 보여 준다 */
  const _ems = enrollStartMs(s);
  const startTxt = _ems ? new Date(_ems).toLocaleDateString('ko-KR') : '미설정';
  const eduTxt = [s.grade?gradeLabel(s.grade):'', s.school||''].filter(Boolean).join(' · ');
  const eduLine = eduTxt ? `<div class="mg-line">🎓 ${eduTxt}</div>` : '';
  const dayTime = (forDay!=null) ? `<div class="mg-line">⏰ ${WD[forDay]} ${rng12(timeFor(s,forDay), endTimeOf(timeFor(s,forDay),durOf(s)))}</div>` : '';
  return `<div class="row" id="mng-${s.id}">
    <div class="row-top"><span class="name">${s.name}</span>
      <span class="contract">${s.plan}회 · ${won(priceOf(s))}</span></div>
    ${eduLine}${dayTime}
    <div class="mg-line">🗓 ${days}요일 · ${timeTxt} · <b>${durLabel(durOf(s))}</b></div>
    <div class="mg-line">🏫 학원 등록일(첫 수업일) : ${startTxt}</div>
    <div class="mg-line">🔄 이번 계약 : ${fmtD(cycleStartOf(s))} ~ ${fmtD(cycleEndOf(s))} · ${doneCountOf(s)}/${s.plan}회 끝남</div>
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
      list.forEach(s=>{ const t=timeFor(s,d); if(t!==curT){ curT=t; html+=timeH(hm12(t)); } html+=manageCard(s,d); });
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
/* ★ 2026-07-28m ★ 원장님 지시 — "종료일은 자동 계산 해주세요"
   달력은 '수업 시작일' 하나만 고른다. 종료 예정일은 고르는 칸이 아니라 계산 결과다(_rp.end 삭제).
   지난에 수업한 날은 달력이 아니라 그 아래 날짜 단추 목록에서 받는다.
   _rp.off = 그 목록에서 '이 날은 안 했다'고 끄신 날 (아직 저장 전). 처음 상태는 다 켜짐이다. */
let _rp={start:null, y:0, m:0, open:false, off:new Set()};
function rpInit(startMs){
  const base = startMs || dayKey(now.getTime());
  _rp={ start:startMs||null, y:new Date(base).getFullYear(), m:new Date(base).getMonth(), open:false, off:new Set() };
}
function rpToggle(){ _rp.open=!_rp.open; rpRender(); }
function rpNav(d){ _rp.m+=d; if(_rp.m<0){_rp.m=11;_rp.y--;} if(_rp.m>11){_rp.m=0;_rp.y++;} rpRender(); }
/* ★ 2026-07-28m: 달력 클릭은 뜻이 하나다 — 어느 날을 누르셔도 '수업 시작일'이다.
   빌드 l 까지는 같은 클릭이 다섯 가지 뜻(시작·시작교체·종료해제·지난수업켜기·종료지정)이라
   원장님이 "시작 일과 끝나는 날을 선택하는것이 좀 애매함"이라고 하셨다. */
function rpPick(ms){
  const before=_rp.start;
  _rp.start=ms;
  if(before!==ms) _rp.off.clear();   // 시작일이 바뀌면 지난 수업 목록이 통째로 달라진다 → 끈 표시 초기화
  rpRender();
}
function rpClear(){ _rp.start=null; _rp.off.clear(); rpRender(); }
/* ===== 2026-07-28l: 지난 수업을 달력에서 직접 켜기 =====
   원장님 지시 — "달력으로 시작일을 정하고, 과거일 경우 수업한 날을 클릭하게 하는 것은 어때?"
   회차를 숫자로 역산하지 않는다. 실제로 수업한 날을 켜면 그 개수가 곧 회차다.
   여기서 만드는 기록은 [등원]/[하원]이 만드는 것과 같은 모양의 세션 기록이고, 발송은 하지 않는다
   값이 없으면 만들지 않는다 - 시각·수업 시간이 비면 건너뛴다. */
function rpFormTmp(){
  const sheet=document.getElementById('sheet'); if(!sheet) return null;
  const days=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  const plan=+sheet.dataset.plan||0;
  const dur=+sheet.dataset.dur||0;
  const chk=document.getElementById('perDayChk');
  const tEl=document.getElementById('stTime');
  const commonTime=tEl?(tEl.value||''):'';
  let dayTimes=null;
  /* ★ 2026-07-28s: 빈 칸을 공통 시각으로 채우지 않는다 — 요일마다 다르게면 공통 값은 안 쓰는 값이다.
     비어 있으면 빈 채로 두고, 저장 필수값 검사가 '○요일 수업 시작 시각'이라고 막는다. */
  if(chk && chk.checked){ dayTimes={}; days.forEach(d=>{ const inp=document.querySelector(`.dt-inp[data-d="${d}"]`); dayTimes[d]=inp?(inp.value||''):''; }); }
  const sid=+(sheet.dataset.rpSid||0);
  const base=sid?st(sid):null;
  /* 실제 학생 정보(결석·보강·휴강) 위에 화면에서 고친 값만 얹는다 - 미리보기와 저장 후 값이 같아야 한다 */
  /* ★ 2026-07-28m: cycleEnd 는 얹지 않는다 — 화면에서 종료일을 고르지 않기 때문이다.
     ★ 2026-07-28n: 저장돼 있던 cycleEnd 는 base 에 남아 있어도 이제 아무도 읽지 않는다
        (currentClassInfo 의 덮어쓰기를 삭제했다). 값은 지우지 않는다. */
  return Object.assign({}, base||{}, {id: base?base.id:-1, days, plan, dur, time:commonTime, dayTimes,
    cycleStart:_rp.start});
}
/* 시작일부터 어제까지의 수업일 - 달력에 "이 날 수업했나요?"로 띄울 날들 */
function rpPastDays(tmp){
  const out=[]; if(!tmp || !_rp.start || !tmp.days || !tmp.days.length) return out;
  const todayK=dayKey(now.getTime());
  if(_rp.start>=todayK) return out;
  for(let i=0;i<900;i++){
    const dd=new Date(_rp.start); dd.setDate(dd.getDate()+i);
    const k=dayKey(dd.getTime());
    if(k>=todayK) break;
    if(isSessionDay(tmp,k)) out.push(k);
  }
  return out;
}
/* ★ 2026-07-28m: 처음 상태는 다 켜짐이다 — 끄신 날(_rp.off)만 뺀다.
   시작일은 1회차이므로 끌 수 없고, 이미 기록이 있는 날도 끌 수 없다(데이터 삭제 금지). */
function rpMarked(tmp){
  return rpPastDays(tmp).filter(k=> k===_rp.start || hasRecordOn(tmp.id,k) || !_rp.off.has(k));
}
/* 지난 수업 기록 만들기 - 저장 확인 · 실제 저장이 모두 이 함수 하나만 쓴다(단일 소스).
   이미 기록이 있는 날은 만들지 않고, 시각이나 수업 시간이 비면 만들지 않는다. */
function makePastRecs(s, days){
  const out=[];
  (days||[]).forEach(k=>{
    if(hasRecordOn(s.id,k)) return;
    const t=timeFor(s, new Date(k).getDay());
    const dm=durOf(s);
    if(!t || !(dm>0)) return;
    const [h,mi]=t.split(':').map(Number);
    const d=new Date(k); d.setHours(h,mi,0,0);
    const start=d.getTime();
    const rec={sid:s.id, date:new Date(start)};
    setSessionTimes(rec, start, start+dm*60000);
    out.push(rec);
  });
  return out;
}
/* 저장하면 어떻게 되는지 미리 계산 - 다른 화면과 같은 계산기(currentClassInfo)를 그대로 쓴다.
   기록을 임시로 얹었다가 finally 에서 반드시 되돌린다. 저장(saveData)은 하지 않는다. */
function rpPreview(tmp){
  if(!tmp || !tmp.plan || !tmp.days || !tmp.days.length || !_rp.start) return null;
  const recs=makePastRecs(tmp, rpMarked(tmp));
  const n0=sessions.length;
  try{
    recs.forEach(r=>sessions.push(r));
    const info=currentClassInfo(tmp);
    return {done: pastSessionsOf(tmp, info).length, end: info.end, add: recs.length};
  } finally { sessions.length=n0; }
}
/* 학생 시트의 "진행 상황" 줄 - 달력을 만질 때마다 다시 계산한다.
   빌드 k 까지는 시트를 열 때 한 번만 그려서, 시작일을 바꿔도 옛 숫자가 남아 있었다. */
function rpSyncProgress(pIn){
  const el=document.getElementById('stProgress'); if(!el) return;
  const tmp=rpFormTmp();
  const p=(pIn!==undefined)?pIn:(tmp?rpPreview(tmp):null);   // ★ 2026-07-28m: rpRender 가 이미 계산했으면 그대로 쓴다(같은 값 한 번만 계산)
  if(!p){ el.innerHTML='계약 회차 · 요일 · 수업 시작일을 고르면 여기에 회차가 나옵니다'; return; }
  el.innerHTML=`진행 상황 : <b>${p.done}회 끝남</b> · 다음은 ${p.done+1}번째 수업`
    +(tmp.plan>0?` (계약 ${tmp.plan}회 중 ${Math.max(0,tmp.plan-p.done)}회 남음)`:'')
    +(p.end?` · 종료 예정 ${fmtMD(p.end)}`:'')
    +(p.add?`<br>켜 두신 지난 수업 <b>${p.add}일</b>이 기록으로 함께 저장됩니다`:'');
}
/* ★ 2026-07-28m: 지난 수업일 단추 하나를 켜고 끈다(처음은 다 켜짐 → 안 한 날만 끈다).
   시작일과 이미 기록된 날은 끌 수 없다 - 기록을 지우는 일은 여기서 하지 않는다(데이터 삭제 금지). */
function rpTogglePast(k){
  const tmp=rpFormTmp();
  if(!tmp || !tmp.days || !tmp.days.length){ showToast('요일을 먼저 골라주세요'); return; }
  if(!isSessionDay(tmp,k)){ showToast(`${fmtMD(k)}은 이 학생의 수업일이 아니에요`); return; }
  if(k===_rp.start){ showToast(`${fmtMD(k)}은 수업 시작일이라 1회차예요 - 끌 수 없습니다`); return; }
  if(hasRecordOn(tmp.id,k)){ showToast(`${fmtMD(k)}은 이미 기록된 날이에요 - 여기서는 지울 수 없습니다`); return; }
  if(_rp.off.has(k)) _rp.off.delete(k); else _rp.off.add(k);
  rpRender();
}
/* 모두 켜기 / 모두 끄기 - 끌 수 없는 날(시작일 · 이미 기록된 날)은 건드리지 않는다 */
function rpAllOn(){ _rp.off.clear(); rpRender(); }
function rpAllOff(){
  const tmp=rpFormTmp(); if(!tmp) return;
  rpPastDays(tmp).forEach(k=>{ if(k!==_rp.start && !hasRecordOn(tmp.id,k)) _rp.off.add(k); });
  rpRender();
}
/* ★ 2026-07-28m: 지난에 수업한 날 목록 - 달력이 아니라 시작일 칸 바로 아래에 단추로 뜬다.
   여기 켜진 날의 개수가 곧 회차다(회차를 숫자로 역산하지 않는다 - 단일 소스). */
function rpRenderPast(tmp, p){
  const el=document.getElementById('rpPast'); if(!el) return;
  const days=tmp?rpPastDays(tmp):[];
  if(!days.length){ el.innerHTML=''; return; }
  const mark=new Set(rpMarked(tmp));
  const noTime=days.some(k=>{ const t=timeFor(tmp, new Date(k).getDay()); return !t || !(durOf(tmp)>0); });
  const chips=days.map(k=>{
    const on=mark.has(k);
    const fixed=(k===_rp.start)||hasRecordOn(tmp.id,k);
    const st_= on
      ? (fixed?'background:#DFF3E4;color:#1B6B33;border:1px solid #9FD6B0;'
             :'background:#2F9E44;color:#fff;border:1px solid #2F9E44;')
      : 'background:#F1F0EA;color:#A8A496;border:1px solid var(--line);text-decoration:line-through;';
    return `<button type="button" onclick="rpTogglePast(${k})" style="${st_}border-radius:8px;padding:6px 9px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:${fixed?'default':'pointer'}">${fmtMD(k)}${fixed?' 🔒':''}</button>`;
  }).join('');
  el.innerHTML=`<div style="margin-top:9px;padding:10px;border:1px solid var(--line);border-radius:10px;background:#FBFAF6">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
      <span style="font-size:12.5px;font-weight:700">지난에 수업한 날 <span style="color:var(--muted);font-weight:600">${days.length}일 중 ${mark.size}일 켜짐</span></span>
      <span style="display:flex;gap:6px">
        <button type="button" class="btn ghost small" style="width:auto;padding:4px 9px;font-size:11.5px;margin:0" onclick="rpAllOn()">모두 켜기</button>
        <button type="button" class="btn ghost small" style="width:auto;padding:4px 9px;font-size:11.5px;margin:0" onclick="rpAllOff()">모두 끄기</button>
      </span></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
    <div class="cap" style="margin-top:7px">수업을 <b>안 한 날만 눌러서 끄세요</b>. 끈 날은 회차로 세지 않고 종료 예정일이 그만큼 뒤로 밀립니다.<br>
      🔒 = 시작일(1회차) · 이미 기록이 있는 날 — 여기서는 끌 수 없습니다.
      ${noTime?'<br><b style="color:#B54708">수업 시작 시각과 수업 시간을 먼저 넣어주세요 — 없으면 그 날은 기록으로 만들 수 없습니다.</b>':''}
      ${(p&&p.add)?`<br>저장하면 <b>${p.add}일</b>이 기록으로 함께 만들어집니다.`:''}</div>
  </div>`;
}
/* ★ 2026-07-28m: 예상 종료일은 rpPreview(=currentClassInfo) 한 곳에서만 나온다.
   빌드 l 까지는 여기서 따로 계산해서, 지난 수업을 끄고 켤 때 달력의 종료일 표시와
   진행 상황 줄의 종료일이 서로 달랐다. 이제 같은 값 하나를 나눠 쓴다(단일 소스). */
function rpAutoEnd(p){
  if(!_rp.start) return null;
  const q=(p!==undefined)?p:(function(){ const t=rpFormTmp(); return t?rpPreview(t):null; })();
  return q?q.end:null;
}
function rpLabel(p){
  if(!_rp.start) return '날짜를 고르세요 (종료일 자동 계산)';
  const ae=rpAutoEnd(p);
  return ae? `${fmtMD(_rp.start)} ~ ${fmtMD(ae)} · 자동 계산` : `${fmtMD(_rp.start)} ~ 종료일 자동 계산`;
}
function rpRender(){
  const box=document.getElementById('rpBox'); if(!box) return;
  /* ★ 2026-07-28m: 한 번만 계산해서 라벨 · 진행 상황 줄 · 달력이 같은 값을 쓴다(단일 소스) */
  const tmpP=rpFormTmp();
  const p=tmpP?rpPreview(tmpP):null;
  const lab=document.getElementById('rpLabel'); if(lab) lab.textContent=rpLabel(p);
  rpSyncProgress(p);                                  // 달력을 만질 때마다 회차 줄을 다시 계산
  rpRenderPast(tmpP, p);                              // ★ 2026-07-28m: 지난 수업한 날 목록(달력 밖)
  if(!_rp.open){ box.innerHTML=''; return; }
  const sid=+(document.getElementById('sheet').dataset.rpSid||0);
  const s=sid?st(sid):null;
  const y=_rp.y, m=_rp.m;
  const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
  const todayK=dayKey(now.getTime());
  const autoEnd = rpAutoEnd(p);                       // 자동 계산된 예상 종료일 - 주황 테두리로 표시만 한다
  let grid='';
  ['일','월','화','수','목','금','토'].forEach(w=>grid+=`<div class="cal-wd">${w}</div>`);
  for(let i=0;i<first;i++) grid+='<div></div>';
  for(let dd=1;dd<=dim;dd++){
    const t=new Date(y,m,dd).getTime();
    const isClass = (tmpP && tmpP.days && tmpP.days.length) ? isClassDay(tmpP,t) : (s?isClassDay(s,t):false);
    let style='cursor:pointer;border-radius:7px;';
    if(_rp.start && autoEnd && t>_rp.start && t<autoEnd) style+='background:#FAEEDA;color:#854F0B;';
    if(t===_rp.start) style+='background:var(--amber);color:#fff;font-weight:700;';
    else if(autoEnd && t===autoEnd) style+='box-shadow:inset 0 0 0 2px var(--amber);font-weight:700;';
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
      <span style="font-size:11.5px;color:var(--muted)">누르시는 날 = <b>수업 시작일</b>(주황) · 종료 예정일은 자동 계산(주황 테두리)</span>
      <button type="button" class="btn ghost small" style="width:auto;padding:4px 9px;font-size:11.5px;margin:0" onclick="rpClear()">지우기</button>
    </div>
  </div>`;
}

function openStudentSheet(id){
  /* ★ 2026-07-27h2: plan 도 0을 박아 두지 않는다(null = 미설정).
       예전엔 신규 등록 화면 '클래스 회차' 직접입력칸에 0 이 찍혀 나왔다. */
  const s=id?st(id):{name:'',phone:'',plan:null,time:'',days:[],guardians:[],startDate:null,dayTimes:null,dur:null};   // ★ 신규 등록은 빈칸으로 시작
  const gs=guardiansOf(s);
  /* ★ 2026-07-27h: 새 보호자는 카톡/문자를 코드가 골라 주지 않는다(kakao:null = 미선택). */
  const g1=gs[0]||{name:'',phone:'',kakao:null};
  const g2=gs[1]||null;
  /* ★ 2026-07-27j: '현재 회차'는 더 이상 입력값이 아니다 — 시작일에서 달력이 세는 계산 결과다.
     입력칸을 없애고, 지금 몇 회차인지는 아래 '진행 상황' 줄에 결과로만 보여 준다. */
  const pkgList = Object.keys(packages).map(n=>+n).filter(n=>n>0).sort((a,b)=>a-b);
  const dayBtns=WD.map((w,i)=>`<button type="button" class="day-btn ${s.days.includes(i)?'on':''}" data-d="${i}" onclick="this.classList.toggle('on');syncDayTimes();rpRender()">${w}</button>`).join('');
  // 요일별 시간 입력(모든 요일 렌더, per 모드에서만 노출)
  const perOn = perDayOn(s);
  const dayTimeRows=WD.map((w,i)=>`<div class="daytime-row" data-dt="${i}" style="display:none">
      <span>${w}요일</span>${timeSel(timeFor(s,i), {cls:'dt-inp', data:`data-d="${i}"`})}</div>`).join('');
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
    <div class="fld"><label>계약 회차 <span class="hint">이 횟수를 다 채우면 정산 · 설정 &gt; 수업 기본 설정에서 추가</span></label>
      <div id="planBtns" style="display:flex;flex-wrap:wrap;gap:8px">
        ${pkgList.map(n=>`<button type="button" class="pl-btn" data-p="${n}" onclick="pickPlan(${n})" style="flex:1;min-width:64px;padding:10px;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid ${s.plan===n?'var(--ink)':'var(--line)'};background:${s.plan===n?'var(--ink)':'#F7F6F1'};color:${s.plan===n?'#fff':'var(--ink)'}">${n}회</button>`).join('')}
      </div></div>
    <div class="fld"><label>수업 시작일 <span class="hint">이 날부터 계약 회차만큼 셉니다 · 종료일은 고르지 않습니다(자동 계산)</span></label>
      <button type="button" onclick="rpToggle()" style="width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-family:inherit;font-size:14px;color:var(--ink);cursor:pointer">
        📅 <span id="rpLabel"></span>
      </button>
      <div id="rpBox"></div>
      <div class="cap" style="margin-top:6px">달력을 열어 <b>수업을 처음 한 날</b>을 누르세요 — 그 날이 <b>1회차</b>입니다.<br>
        <b>종료 예정일은 고르지 않습니다</b> — 요일·계약 회차로 자동 계산됩니다.</div>
      <div id="rpPast"></div>
      <div class="cap" id="stProgress" style="margin-top:7px"></div></div>
    <div class="fld"><label>요일</label><div class="day-row" id="dayRow">${dayBtns}</div></div>
    <div class="fld"><label>수업 시간 <span class="hint">직접 골라주세요 · 비우면 저장되지 않아요</span></label>
      <div class="seg2" id="durRow">
        ${DUR_OPTS.map(([m,label])=>`<button type="button" class="${durOf(s)===m?'on':''}" data-dur="${m}" onclick="pickDur(${m})">${label}</button>`).join('')}
      </div></div>
    <div class="fld">
      <div id="stTimeFld" style="${perOn?'display:none':''}"><label>수업 시작 시각 <span class="hint" id="stTimeHint">비우면 저장되지 않아요</span></label>${timeSel(s.time||'', {id:'stTime', on:'syncDayTimes()'})}</div>
      <label class="chk"><input type="checkbox" id="perDayChk" ${perOn?'checked':''} onchange="togglePerDay();syncTimeLock()"> 요일마다 시간 다르게</label>
      <div id="dayTimes" style="${perOn?'':'display:none'}">${dayTimeRows}</div></div>
    <div class="fld"><label>보호자 1</label>
      <input id="g1name" class="note-select" value="${g1.name||''}" placeholder="보호자 이름">
      <input id="g1phone" class="note-select" style="margin-top:8px" value="${g1.phone||''}" placeholder="010-0000-0000">
      <div class="seg2" style="margin-top:8px"><button type="button" id="g1kkO" class="${g1.kakao===true?'on':''}" onclick="pickGK(1,true)">카톡 (없으면 문자 자동)</button>
        <button type="button" id="g1kkX" class="${g1.kakao===false?'on':''}" onclick="pickGK(1,false)">문자만</button></div></div>
    <div class="fld" id="g2wrap" style="${g2?'':'display:none'}"><label>보호자 2 <button type="button" class="mini-x" onclick="removeG2()">제거</button></label>
      <input id="g2name" class="note-select" value="${g2?g2.name||'':''}" placeholder="보호자 이름">
      <input id="g2phone" class="note-select" style="margin-top:8px" value="${g2?g2.phone||'':''}" placeholder="010-0000-0000">
      <div class="seg2" style="margin-top:8px"><button type="button" id="g2kkO" class="${g2&&g2.kakao===true?'on':''}" onclick="pickGK(2,true)">카톡 (없으면 문자 자동)</button>
        <button type="button" id="g2kkX" class="${g2&&g2.kakao===false?'on':''}" onclick="pickGK(2,false)">문자만</button></div></div>
    <button type="button" id="addG2" class="btn ghost small" style="${g2?'display:none':''};margin-bottom:14px" onclick="addG2()">＋ 보호자 2 추가</button>
    <div class="sheet-btns" style="margin-top:6px">
      <button class="btn start" onclick="saveStudent(${id||'null'})">저장</button>
      <button class="btn sms" onclick="closeSheet()">취소</button></div>`;
  sheet.dataset.plan=s.plan;
  sheet.dataset.rpSid=id||'';
  /* ★ 2026-07-27h: 미선택은 빈 문자열. '1'=카톡 · '0'=문자만 · ''=아직 안 고름(저장 막힘) */
  sheet.dataset.g1kakao=(g1.kakao===true)?'1':(g1.kakao===false?'0':'');
  sheet.dataset.g2kakao=g2?((g2.kakao===true)?'1':(g2.kakao===false?'0':'')):'';
  cancelSaveStudent();                            // ★ 2026-07-27k: 남아 있던 저장 확인창 정리
  /* ★ 2026-07-28r ★ 원장님 신고 - "테스트 학생 수업 시간 수정하고 저장했으나 적용이 안됨"
     원인: 여기서만 s.cycleStart(저장된 원본 값)를 읽었다. 테스트 학생은 그 값이 없어서(옛 startDate 만 있음)
     _rp.start 가 비고 -> saveStudent() 의 필수값 검사에 걸려 저장 전체가 중단됐다.
     다른 화면은 모두 cycleStartOf(s) (= currentClassInfo(s).start) 를 쓰기 때문에 멀쩡해 보였다.
     -> 수정 화면도 다른 화면과 똑같은 값 하나만 보게 한다(단일 소스).
     새 학생 등록(id 없음)은 계산하지 않고 반드시 빈칸이다 - 코드가 날짜를 만들어 넣으면 안 된다. */
  rpInit(id ? (cycleStartOf(s)||null) : null);
  sheet.dataset.dur=String(durOf(s));
  syncDayTimes(); syncTimeLock();
  rpRender();                                   // ★ 2026-07-28l: 진행 상황 줄을 계산 결과로 채운다
  document.getElementById('scrim').classList.add('show');
}
function stylePlBtn(b,on){ b.style.background=on?'var(--ink)':'#F7F6F1'; b.style.color=on?'#fff':'var(--ink)'; b.style.borderColor=on?'var(--ink)':'var(--line)'; }
function pickPlan(p){
  /* ★ 2026-07-27j: '직접 입력' 칸을 없앴다. 계약 회차는 설정 > 수업 기본 설정의 목록에서만 고른다
       (그 목록에 수업료가 함께 있어서, 목록 밖 숫자를 넣으면 수업료가 비어 버렸다). */
  const sheet=document.getElementById('sheet');
  sheet.dataset.plan=p;
  [...document.querySelectorAll('#planBtns .pl-btn')].forEach(b=>stylePlBtn(b, +b.dataset.p===p));
  rpRender();
}
function pickGK(n,v){const sheet=document.getElementById('sheet');sheet.dataset['g'+n+'kakao']=v?'1':'0';
  document.getElementById('g'+n+'kkO').classList.toggle('on',v);
  document.getElementById('g'+n+'kkX').classList.toggle('on',!v);}
function togglePerDay(){const on=document.getElementById('perDayChk').checked;
  document.getElementById('dayTimes').style.display=on?'':'none'; syncDayTimes();}
/* ★ 2026-07-28s: 원장님 지시 — "안 쓰는 값이라 요일마다 다르게를 하면 화면에서 없애라".
     예전엔 잠그기(회색)만 해서 값이 그대로 보였고, 어느 쪽이 진짜 시각인지 헷갈렸다
     (권미진 학생 공통 칸의 '오전 02:30'이 그 경우다).
     -> 칸 전체를 화면에서 없앤다. 요소는 지우지 않고 감추기만 한다 —
        저장 코드가 document.getElementById('stTime').value 를 계속 읽어야 하기 때문이다.
        그 값은 저장은 되지만(지우지 않는다) 이제 어디서도 쓰이지 않는다 — timeFor() 가 보지 않는다. */
function syncTimeLock(){
  const chk=document.getElementById('perDayChk'), fld=document.getElementById('stTimeFld');
  if(!chk||!fld) return;
  fld.style.display = chk.checked ? 'none' : '';
}
function pickDur(m){
  const sheet=document.getElementById('sheet'); sheet.dataset.dur=String(m);
  document.querySelectorAll('#durRow button').forEach(b=>b.classList.toggle('on', +b.dataset.dur===+m));
  rpRender();                                   // ★ 2026-07-28l: 수업 시간이 없으면 지난 기록을 만들 수 없다 → 다시 계산
}
/* ★ 2026-07-27g: 요일을 바꿀 때 수업 시간을 자동으로 골라 주던 동작(autoDurByDays)을 삭제했다.
     원장님 지시 — 기본 설정값을 빼고, 비어 있으면 저장이 막히게. */
function syncDayTimes(){ // per-day 행을 선택된 요일만 노출, 공통시간을 기본값으로
  const on=document.getElementById('perDayChk')&&document.getElementById('perDayChk').checked;
  const sel=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  document.querySelectorAll('.daytime-row').forEach(r=>{
    const d=+r.dataset.dt; r.style.display=(on&&sel.includes(d))?'flex':'none';});
  rpRender();                                   // ★ 2026-07-28l: 시각이 바뀌면 회차 줄·달력을 다시 그린다
}
function addG2(){document.getElementById('g2wrap').style.display='';document.getElementById('addG2').style.display='none';}
function removeG2(){document.getElementById('g2wrap').style.display='none';document.getElementById('addG2').style.display='';
  document.getElementById('g2name').value='';document.getElementById('g2phone').value='';}
function saveStudent(id){
  const name=document.getElementById('stName').value.trim();
  if(!name){showToast('학생 이름을 입력해주세요');return;}
  const sheet=document.getElementById('sheet');
  const days=[...document.querySelectorAll('#dayRow .day-btn.on')].map(b=>+b.dataset.d);
  const plan=+sheet.dataset.plan||0;
  if(plan<1){showToast('계약 회차를 골라주세요 (설정 > 수업 기본 설정에 있는 횟수)');return;}
  const commonTime=document.getElementById('stTime').value||'';   // ★ 코드 기본값 없음. 비어 있으면 아래 필수값 검사에서 저장이 막힌다
  const dur = +sheet.dataset.dur||0;      // 수업 시간(길이) — 고르지 않으면 0 → 아래 필수값 검사에서 막힌다
  // 요일별 시간
  let dayTimes=null;
  if(document.getElementById('perDayChk').checked){
    /* ★ 2026-07-28s: 빈 칸을 공통 시각으로 채우지 않는다(rpFormTmp 와 같은 규칙) */
    dayTimes={}; days.forEach(d=>{ const inp=document.querySelector(`.dt-inp[data-d="${d}"]`); dayTimes[d]=inp?(inp.value||''):''; });
  }
  // 보호자
  /* ★ 2026-07-27g: 이름을 비우면 '○○ 보호자'로 자동 생성하던 것을 삭제. 비면 저장이 막힌다. */
  /* ★ 2026-07-27h: '1'=카톡 · '0'=문자만 · 그 밖(미선택)=null → 필수값 검사에서 막힌다 */
  const _gk=(n)=>{ const v=sheet.dataset['g'+n+'kakao']; return v==='1'?true:(v==='0'?false:null); };
  const guardians=[{name:document.getElementById('g1name').value.trim(),
    phone:document.getElementById('g1phone').value.trim(), kakao:_gk(1)}];
  if(document.getElementById('g2wrap').style.display!=='none'){
    const n2=document.getElementById('g2name').value.trim();
    const p2=document.getElementById('g2phone').value.trim();
    if(n2||p2) guardians.push({name:n2, phone:p2, kakao:_gk(2)});   // 넣었으면 이름은 필요(연락처는 비워도 저장됨 — 발송만 막힌다)
  }
  /* ===== 저장 필수값 검사 (2026-07-27g) =====
     원칙: 코드가 값을 만들어 넣지 않는다. 비어 있으면 저장을 막고, 무엇이 비었는지 알려준다.
     여기서 막는 항목 = 홈 '챙길 일'의 missingSettings() 가 비었다고 알려 주는 항목과 같다(같은 규칙 하나). */
  /* ★ 2026-07-27j: '현재 회차'는 입력받지 않는다(달력이 세는 계산 결과).
       대신 그 계산의 출발점인 '수업 시작일'을 반드시 받는다 — 없으면 회차를 셀 기준이 없다. */
  const _miss=[];
  if(!days.length) _miss.push('요일');
  if(!(dur>0))     _miss.push('수업 시간');
  if(!_rp.start)   _miss.push('수업 시작일');
  if(dayTimes){ const _bl=days.filter(d=>!dayTimes[d]); if(_bl.length) _miss.push(`${_bl.map(d=>WD[d]).join('·')}요일 수업 시작 시각`); }
  else if(!commonTime) _miss.push('수업 시작 시각');
  if(!guardians[0].name)  _miss.push('보호자 이름');
  if(guardians[0].kakao===null) _miss.push('보호자 발송 방법(카톡/문자만)');
  /* ★ 보호자 연락처는 저장을 막지 않는다 — 시험 중 오발송을 막기 위해 일부러 비워 두는 값(원장님 지시).
       대신 실제 발송(autoSendAll)에서 막는다. */
  if(guardians[1] && !guardians[1].name) _miss.push('보호자 2 이름');
  if(guardians[1] && guardians[1].kakao===null) _miss.push('보호자 2 발송 방법(카톡/문자만)');
  if(_miss.length){ showToast(`${_miss.join(', ')} — 비어 있어요. 채워야 저장됩니다`); return; }

  /* ★ 2026-07-27j: '학원 수업 시작일'(startDate) 입력칸을 없앴다.
       같은 뜻의 날짜를 두 칸에서 받아 서로 달라지던 항목이라 '수업 시작일' 하나로 합쳤다.
       예전 학생에게 저장돼 있던 startDate 값은 지우지 않는다(아래 data 에 넣지 않음 = 그대로 보존).
       startDate 가 없으면 enrollStartMs() 가 cycleStart 를 쓴다. */
  /* ★ 2026-07-28m: 원장님 지시 — "종료일은 자동 계산 해주세요".
       종료 예정일은 더 이상 입력값이 아니므로 data 에 cycleEnd 를 넣지 않는다.
       startDate 때와 같은 방식이다 — 넣지 않으면 예전 학생에게 저장돼 있던 값은 지워지지 않고 그대로 남는다. */
  const cycleStart=_rp.start||null;      // 달력에서 고른 수업 시작일 (필수)
  const data={name, phone:document.getElementById('stPhone').value.trim(),
    grade:document.getElementById('stGrade').value, school:document.getElementById('stSchool').value.trim(),
    plan, days, time:commonTime, dayTimes, cycleStart, guardians,
    // 호환용 대표(보호자1) 미러
    guardian:guardians[0].name, kakao:guardians[0].kakao, dur};
  data.phone_guardian=guardians[0].phone; // 참고용
  /* ★ 2026-07-27j 회차 단일 소스 ★
     회차 숫자는 어디에도 저장하지 않는다. 저장하는 것은 '수업 시작일' 하나뿐이고,
     현재 회차는 언제나 달력(currentClassInfo().sessions)이 센다.
     빌드 i 까지 있던 '회차 → 시작일 역산'도 입력칸이 사라져 더 필요 없어 삭제했다. */
  /* ★ 2026-07-27k: 바로 저장하지 않는다 — 입력값으로 계산된 결과(종료 예정일 · 진행 상황)를
       먼저 보여 드리고, 원장님이 [맞아요]를 누르셨을 때에만 저장한다.
       원장님 지시: "이게 맞는지 확인 과정을 거치면 되잖아" */
  /* ★ 2026-07-28l: 달력에서 초록으로 켜 두신 '지난에 수업한 날'을 같이 넘긴다.
       여기서 기록을 만들지는 않는다 — [맞아요]를 누르셨을 때 commitStudent 가 만든다. */
  const _tmpS = Object.assign({}, (id?st(id):null)||{}, data, {id: id||-1});
  const _pastDays = rpMarked(_tmpS).filter(k=>!hasRecordOn(_tmpS.id,k));
  askSaveStudent(id, data, _pastDays);
}
/* ===== 저장 확인 시트 (2026-07-27k) =====
   붙는 위치: document.body 에 따로 얹는 층(z-index 60) — 입력 시트(#sheet)를 지우지 않는다.
   그래서 [고칠래요]를 누르면 적어 넣은 값이 그대로 남아 있는 입력 화면으로 돌아간다.
   여기 표시되는 값은 전부 계산 함수(currentClassInfo · pastSessionsOf · priceOfPlan)의 결과이고,
   화면에 값을 직접 박아 넣지 않는다. */
let _pendStu=null;   // 저장 확인을 기다리는 입력값 {id, data, pastDays} — 여기 있는 동안은 아직 저장 전이다
function askSaveStudent(id, data, pastDays){
  _pendStu={id, data, pastDays:(pastDays||[]).slice()};
  const prev = id? st(id) : null;
  const tmp = Object.assign({}, prev||{}, data, {id: id||-1});
  /* ★ 2026-07-28l: 달력에서 켜 두신 지난 수업일을 임시로 얹어 계산한다 —
     저장한 뒤의 숫자와 이 화면의 숫자가 같아야 하기 때문이다.
     얹은 기록은 finally 에서 반드시 되돌리고, 여기서는 저장(saveData)하지 않는다. */
  const _recs = makePastRecs(tmp, _pendStu.pastDays);
  const _n0 = sessions.length;
  let info, done;
  try{
    _recs.forEach(r=>sessions.push(r));
    info = currentClassInfo(tmp);                     // 다른 화면과 같은 함수 하나로 계산
    done = pastSessionsOf(tmp, info).length;
  } finally { sessions.length=_n0; }
  const ds = data.days.slice().sort((a,b)=>a-b);
  const dayTxt = ds.map(d=>WD[d]).join('·')+'요일';
  const timeTxt = data.dayTimes ? ds.map(d=>`${WD[d]} ${hm12(data.dayTimes[d])}`).join(' / ') : hm12(data.time);
  const price = priceOfPlan(data.plan);
  const row=(k,v,warn)=>`<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
      <span style="width:88px;flex:none;font-size:12.5px;color:var(--muted)">${k}</span>
      <span style="font-size:13.5px;color:${warn?'var(--amber)':'var(--ink)'};font-weight:${warn?'700':'600'}">${v}</span></div>`;
  const box=document.createElement('div');
  box.id='saveConfirm';
  box.style.cssText='position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
  box.innerHTML=`<div style="background:var(--card);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:20px 20px 24px;max-height:92%;overflow:auto">
    <h3 style="margin:0 0 3px">이대로 저장할까요?</h3>
    <div class="cap" style="margin-bottom:12px">${data.name} · ${id?'수정':'새로 추가'}</div>
    ${row('수업 시작일', data.cycleStart?fmtMD(data.cycleStart):'—')}
    ${row('요일', dayTxt)}
    ${row('수업 시각', timeTxt||'미설정', !timeTxt)}
    ${row('수업 시간', durLabel(data.dur))}
    ${row('계약 회차', `${data.plan}회 · ${price!=null?won(price):'수업료 미설정'}`, price==null)}
    ${row('종료 예정일', info.end?`${fmtMD(info.end)} · 자동 계산`:'계산 안 됨', !info.end)}
    ${row('진행 상황', `오늘까지 ${done}회 끝남 · 다음은 ${done+1}번째`)}
    ${_recs.length?row('지난 수업', `${_recs.length}일을 기록으로 함께 저장<br><span style="font-weight:600;font-size:12.5px;color:var(--muted)">${_recs.map(r=>fmtMD(r.date.getTime())).join(' · ')}</span>`):''}
    ${row('보호자', data.guardians.map(g=>`${g.name} · ${g.phone||'연락처 없음'} · ${g.kakao?'카톡':'문자만'}`).join('<br>'))}
    <div class="cap" style="margin-top:10px">종료 예정일은 결석·휴강이 생기면 그만큼 뒤로 밀립니다. 회차는 이 시작일부터 달력이 셉니다.</div>
    <div class="sheet-btns" style="margin-top:14px">
      <button class="btn start" onclick="commitStudent()">맞아요 · 저장</button>
      <button class="btn sms" onclick="cancelSaveStudent()">고칠래요</button></div>
  </div>`;
  document.body.appendChild(box);
}
function cancelSaveStudent(){ _pendStu=null; const b=document.getElementById('saveConfirm'); if(b) b.remove(); }
function commitStudent(){
  if(!_pendStu){ cancelSaveStudent(); return; }
  const id=_pendStu.id, data=_pendStu.data;
  const pastDays=(_pendStu.pastDays||[]).slice();   // ★ 2026-07-28l: cancelSaveStudent 가 _pendStu 를 비우기 전에 받아 둔다
  let _sid=id;
  if(id){ Object.assign(st(id),data); }
  else { const nid=++nextId; students.push({id:nid,...data}); _sid=nid; }
  cancelSaveStudent();
  /* ★ 2026-07-28l: 달력에서 켜 두신 지난 수업일을 실제 기록으로 만든다.
     [등원]/[하원]이 만드는 것과 같은 모양이고 발송은 하지 않는다.
     회차 숫자(cycleDone)는 쓰지 않는다 — 회차는 언제나 달력이 센다(단일 소스).
     기록을 먼저 넣고 난 뒤에 날짜를 다시 계산해야 종료 예정일이 맞는다. */
  const _made = makePastRecs(st(_sid), pastDays);
  _made.forEach(r=>sessions.push(r));
  _rp.off.clear();
  recalcStudentDates(_sid);   // ★ 학생정보를 고치면 지난 클래스·정산 건 날짜도 즉시 같이 바뀐다
  saveData(); closeSheet(); renderManage();
  showToast(`${data.name} ${id?'수정됨':'추가됨'}${_made.length?` · 지난 수업 ${_made.length}일 기록됨`:''} · ${doneCountOf(st(_sid))}회 끝남 · 다음 ${doneCountOf(st(_sid))+1}번째`);
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
  // ★ 기본 시각 규칙: 오늘 누른 것이면 '지금(클릭한 시각)'이 기본, 지난 날 확정이면 예정 시각
  const isToday = _sc.date === dayKey(Date.now());
  const clickMs = isToday ? _round10(Date.now()) : null;
  const startMs = (kind!=='start' && live[id]!=null) ? live[id]        // 등원 기록이 있으면 그 시각 유지
                : (kind==='start' && clickMs) ? clickMs                // 등원 = 지금
                : (kind!=='start' && clickMs) ? (clickMs - dmin*60000) // 완료·하원인데 등원 기록 없음 = 지금-수업시간
                : plan;
  const endMs = (kind==='start') ? null
              : (clickMs || (startMs + dmin*60000));                   // 오늘=지금 시각 · 지난 날=등원+수업시간
  _sc={ id, kind, date: _sc.date, tab: kind==='both' ? 'start' : (kind==='start'?'start':'end'),
    start: startMs,
    end: endMs };
  buildSendConfirm();
  document.getElementById('scrim').classList.add('show');
}
function _defaultStart(id){
  const s=st(id); const k=_sc.date||dayKey(now.getTime());
  const t=todayTimeOf(s,k);              // 임시 추가 > 보강 > 요일표 (단일 소스)
  if(!t) return _mkT(now.getHours(), now.getMinutes());   // ★ 시각 미설정이면 임의 시각 대신 '지금'을 띄운다
  const [h,m]=t.split(':').map(Number); return _mkT(h, m);
}
/* 드래그 휠 한 줄 */
function _wheel(which){
  const ms=_sc[which]||Date.now(); const d=new Date(ms);
  const hIdx=Math.max(0, SC_H.indexOf(d.getHours()));
  const mIdx=Math.max(0, SC_M.indexOf(d.getMinutes()));
  /* 휠 표시도 12시간제 (값은 24시로 유지 — data-v) */
  const wLabel=(v,type)=> type==='h' ? `${v<12?'오전':'오후'} ${(v%12)||12}시` : `${String(v).padStart(2,'0')}분`;
  const col=(items,label,idx,type)=>`<div class="sc-wheel" id="w_${which}_${type}" data-which="${which}" data-type="${type}"
      style="height:${SC_ITEM*3}px;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:none;flex:1;text-align:center">
      <div style="height:${SC_ITEM}px"></div>
      ${items.map((v,i)=>`<div class="sc-op" data-v="${v}" style="height:${SC_ITEM}px;line-height:${SC_ITEM}px;scroll-snap-align:center;font-size:${i===idx?'20px':'15px'};font-weight:${i===idx?'600':'400'};color:${i===idx?'#633806':'#888780'}">${wLabel(v,type)}</div>`).join('')}
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
    const tb=(k,label,ms)=>`<button type="button" onclick="scTab('${k}')" style="flex:1;border-radius:9px;padding:9px 0;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;${_sc.tab===k?'background:var(--ink);color:#fff;border:none':'background:var(--card);color:var(--muted);border:1px solid var(--line)'}">${label} ${hm12(_hm(ms))}</button>`;
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
    const one=(k,ms)=>{ const _t=buildNotifyTextAt(s,k,ms);
      return `<div class="msg" style="white-space:pre-line">${_t?_t.replace(/</g,'&lt;'):'문구 미설정 — 설정 > 알림 문구에서 채워주세요'}</div>`; };
    pv.innerHTML = kind==='start' ? one('start',_sc.start)
      : kind==='end' ? one('end',_sc.end)
      : one('start',_sc.start)+'<div style="height:6px"></div>'+one('end',_sc.end);
  }
  const go=document.getElementById('scGo'); if(go){ go.disabled=!!bad; go.style.opacity=bad?'.45':''; }
  document.querySelectorAll('.sc-wheel').forEach(()=>{});
  // 탭 라벨 시각 갱신
  const tabBtns=document.querySelectorAll('.sheet button[onclick^="scTab"]');
  if(tabBtns.length===2){ tabBtns[0].innerHTML=`등원 ${hm12(_hm(_sc.start))}`; tabBtns[1].innerHTML=`하원 ${hm12(_hm(_sc.end))}`; }
}
function scRecordOnly(){ const s=st(_sc.id), k=_sc.kind; _scApply(); closeSheet();
  showToast(`${s.name} ${k==='start'?'등원':'하원'} 기록 완료 (알림 없음)`); }
/* 설정하고 알림 보내기 — 카톡/문자는 학생 설정대로 자동 */
function scSend(){
  const id=_sc.id, kind=_sc.kind, s=st(id);
  _scApply();
  const g=guardiansOf(s)[0]||{};
  /* ★ 2026-07-27h2: 발송 방법 미설정이면 코드가 카톡으로 정하지 않는다(시각 기록은 이미 저장됐다). */
  if(g.kakao!==true && g.kakao!==false){
    closeSheet(); showToast(`${s.name} 보호자의 발송 방법(카톡/문자만)이 정해지지 않았어요 — 설정 > 학생 관리에서 먼저 골라주세요`); return; }
  const kakao = g.kakao===true;
  const kinds = kind==='start' ? ['start'] : kind==='end' ? ['end'] : ['start','end'];
  const on = kinds.filter(k=>sendOn(k));
  if(!on.length){ closeSheet(); showToast(`${s.name} 기록 완료 (알림 꺼짐)`); return; }
  const text = on.map(k=>buildNotifyTextAt(s,k, k==='start'?_sc.start:_sc.end)).filter(Boolean).join('\n');
  /* ★ 2026-07-27h: 문구가 비어 있으면 보내지 않는다(시각 기록은 위에서 이미 저장됐다) */
  if(!text){ closeSheet(); showToast('알림 문구가 비어 있어요 — 설정 > 알림 문구에서 먼저 채워주세요'); return; }
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
    보호자명:g.name||'', 시각:hm12(_hm(ms)), 회차:String(doneCountOf(s)),
    금액:won(priceOf(s)).replace(/원$/,''), 내용:'' };
  /* ★ 2026-07-27h: 문구가 비면 빈값. 부르는 쪽(scSend)이 발송을 막는다. */
  return applyVars(tpl, vars).trim();
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
      ${timeSel(v(startMs), {id:'teStart'})}</div>
    ${isLive?'':`<div class="fld"><label>하원 시각</label>
      ${timeSel(v(endMs), {id:'teEnd'})}</div>`}
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
    <div class="cap">보호자에게 보낼 내용을 직접 작성하세요. ${gs.length>1?`보호자 ${gs.length}명 모두에게 보냅니다.`:`받는 사람: <b>${g.name||'(이름 미설정)'}</b> ${g.phone||''}`}</div>
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
  const text=applyVars(raw.trim(), {학생명:s.name, 보호자명:g.name||'',
    학원명:academy.name||'', 원장명:academy.owner||''});
  logAdd(id,'pay',`${s.name} 안내문 (${kakao?'카톡':'문자'}) → ${g.name||'(보호자 이름 미설정)'}`);
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
  const i=students.findIndex(s=>s.id===id); if(i>=0){ students.splice(i,1); if(typeof noteStudentDeleted==='function') noteStudentDeleted(); }  // 급감 가드 기준치 동기화
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
  return students.filter(s=> (isClassDay(s,k) && !beforeStart(s,ms)) || hasRecordOn(s.id,k))   // 기록 있는 날은 클래스 경계와 무관하게 표시
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
          timeLine=(inTime||outTime) ? `등원 ${hm12(inTime)||'—'} · 하원 ${hm12(outTime)||'—'}` : '수업 완료 (시각 기록 없음)';
        } else if(isLiveNow){
          statusHtml=`<span class="contract" style="color:var(--amber);font-weight:700">수업 중</span>`;
          timeLine=`등원 ${hm12(inTime)||'—'} · 하원 예정 ${inTime?hm12(endTimeOf(inTime, todayDurOf(s, dayKey(schedSel)))):'—'}`;
        } else {
          statusHtml=`<span class="contract">예정 ${hm12(t)}</span>`;
          timeLine=`예정 시간 ${rng12(t, endTimeOf(t, todayDurOf(s, dayKey(schedSel))))}`;
        }
        const gLine = guardiansOf(s).map(g=>`${g.name}${g.phone?' '+g.phone:''}`).join(', ');
        return `<div class="row" style="padding:12px 14px${abs?';border:1.6px solid #D9342B':''}">
          <div class="row-top"><span class="name">${s.name}${cycBadge(s)}${isMakeupDay(s,dayKey(schedSel))?' <span style="font-size:11px;font-weight:600;color:#fff;background:#6B4FBB;border-radius:6px;padding:2px 7px;vertical-align:middle">보강</span>':''}</span>${statusHtml}</div>
          <div class="mg-line">🕐 ${timeLine}</div>
          <div class="mg-line">👤 ${gLine}</div>
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
  const cand=students.filter(x=>!onDate.some(y=>y.id===x.id))
    .slice().sort((a,b)=>a.name.localeCompare(b.name,'ko'));      // 가나다순
  const mkHtml = mkList.length ? mkList.map(x=>{ const mk=makeupOn(x.id,k)||{};
      return `<div style="display:flex;justify-content:space-between;align-items:center;background:#EAE3F7;border-radius:9px;padding:8px 10px;margin-bottom:6px">
        <span style="font-size:13px;color:#4A3690"><b>${x.name}</b> · ${mk.time?rng12(mk.time, endTimeOf(mk.time, mk.dur||durOf(x))):'-'} · ${durLabel(mk.dur||durOf(x))}</span>
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
          need, can, amount:(bill?billAmount(bill):priceOfPlan(cur.plan)), billId:bill?bill.id:null, paid:bill?!!bill.paid:false});
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
    <div class="msg">정산 ${won(b.amount)} · ${b.paid?'<b>받음</b>으로 표시됨':'미납'}</div>
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
        <span class="amt">${won(b.amount)}</span></div>
      <div class="mg-line">📅 앞 클래스 종료 <b>${fmtD(b.prevEnd)}</b> → 이 클래스 종료 <b>${fmtD(b.curEnd)}</b></div>
      <div class="mg-line" style="color:var(--clay)">⚠ ${b.need}회가 필요한데 그 사이 수업 가능일은 <b>${b.can}일</b>뿐</div>
      <div class="mg-line">💰 정산 ${b.paid?'<b style="color:var(--green)">받음</b>':'미납'}</div>
      <div class="row-btns" style="margin-top:11px">
        <button class="btn settle small" onclick="askFixBad(${b.sid},${b.no})">정리하기</button>
        <button class="btn ghost small" onclick="goTab('manage')">학생 수정</button>
      </div></div>`).join('')}
    <div class="set-sec" style="margin-top:20px">
      <h3>회차가 실제와 다르면</h3>
      <div class="cap">학생 관리 → 해당 학생 <b>수정</b> → <b>수업 시작일</b>을 실제 첫 수업일로 고치세요.
        회차는 그 날부터 달력이 세기 때문에, 시작일만 맞으면 회차도 맞습니다.
        (회차 숫자를 직접 넣는 칸은 없앴습니다 — 두 군데서 세다가 숫자가 갈라졌던 원인이었어요.)</div>
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
        <div style="margin-top:9px"><label style="font-size:12.5px;color:var(--muted)">심사 통과 후 받은 템플릿 코드(ID)</label>
          <input id="code_${k}" value="${code}" placeholder="예: KA01TP... (솔라피 → 템플릿 ⋮ → 템플릿 ID 복사)" onchange="setMsgTemplate('${k}')"
            style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:10px;font-family:inherit;font-size:13px;margin-top:4px;background:#fff">
          <div style="font-size:12px;color:var(--muted);margin-top:5px">여기 코드를 넣으면 <b>그 템플릿으로</b> 알림톡이 나갑니다. 비워두면 발송 서버가 승인된 onstudy_${k} 템플릿을 자동으로 사용합니다.</div></div>
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
  if(mks.length){ body+=`\n\n○ 보강 예정 ${mks.map(m=>{const d=new Date(m.t);return `${d.getMonth()+1}.${d.getDate()}${m.time?' '+hm12(m.time):''}`;}).join(', ')}`; }
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
  /* ★ 2026-07-27h: 학원명을 코드에 박아 두지 않는다(예전엔 'On-study'가 나갔다).
     저장된 학원명(academy.name)만 쓰고, 없으면 머리말 없이 연다. */
  _notifyCtx={gs, text:`${academy.name?`[${academy.name}] `:''}${s.name} 학생 관련 안내드립니다.`};
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
  const waiting=bills.filter(b=>!b.paid).reduce((a,b)=>a+(billAmount(b)||0),0);

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


/* ===== 시스템 뒤로 가기(안드로이드 ‹) ===== 2026-07-28u
   원장님 지시 — "시스템 백. 누르면 앱에서 나오지 말고 전 메뉴로 가게 해줘".
   ★ 지금 보고 있는 화면을 아는 곳은 navView 하나뿐이다(단일 소스).
     예전에는 화면 이름을 아래 탭 단추의 active 표시(.bt.active)에서 되짚었는데,
     하위 화면(학생 관리·발송·알림 문구·데이터 점검 …)에서는 아래 탭이 하나도 안 켜져 있어
     언제나 '홈'으로 잘못 읽혔다. 그래서 refreshCurrentView(다른 기기에서 값이 바뀌었을 때
     지금 화면을 다시 그리는 함수)가 보이지도 않는 홈만 다시 그리고 있었다. 함께 고친다.
   ★ navView 를 바꾸는 곳은 goTab 과 로그인 직후 첫 화면(initApp) 둘뿐이다. 다른 데서 손대지 말 것.
   ★ navStack 은 '지나온 화면' 발자국이다. 뒤로 가는 중(navGoingBack)에는 쌓지 않는다.
   ★ 설정 안의 하위(수업 기본 설정·관리자 등록)는 adminSection 이 따로 갖고 있으므로
     발자국에도 {v,sec} 두 가지를 같이 적어 둔다. */
let navView='home';        // 지금 보고 있는 화면 (goTab 의 v 값과 같은 말)
let navStack=[];           // 지나온 화면 [{v, sec}]
let navGoingBack=false;    // true 인 동안에는 발자국을 쌓지 않는다
let navExitAsk=0;          // 뿌리에서 '한 번 더 누르면 닫혀요'를 띄운 시각(ms)

/* 뒤로 갈 곳이 있으면 한 칸 물러나고 true, 더 물러날 데가 없으면 false.
   순서 — ① 시각 고르개 시트 ② 입력 시트 ③ 설정 하위 ④ 지나온 화면 */
function navBack(){
  const ts=document.getElementById('tsScrim');
  if(ts && ts.classList.contains('show')){ tsClose(); return true; }
  const sc=document.getElementById('scrim');
  if(sc && sc.classList.contains('show')){ closeSheet(); return true; }
  if(navView==='admin' && adminSection){ openAdmin(null); return true; }
  if(navStack.length){
    const p=navStack.pop();
    navGoingBack=true;
    try{
      if(p.v==='admin'){ adminSection=p.sec||null; goTab('admin'); }
      else goTab(p.v);
    } finally { navGoingBack=false; }
    return true;
  }
  return false;
}
/* 브라우저 뒤로 가기가 앱 밖으로 나가 버리지 않게 지킴이 한 칸을 세워 둔다.
   안드로이드 ‹ 를 누르면 이 한 칸이 먼저 빠지면서 popstate 가 오고, 우리가 대신 처리한다. */
function navGuard(){ try{ history.pushState({onstudy:1},''); }catch(e){} }
function navPop(){
  if(navBack()){ navGuard(); return; }
  /* 뿌리(홈 첫 화면) — 물러날 데가 없다. 여기서 바로 닫아 버리면 실수로 앱이 꺼지므로
     한 번 알려 드리고, 2초 안에 다시 누르시면 그때 진짜 나간다. */
  const t=Date.now();
  if(navExitAsk && t-navExitAsk<2000){ navExitAsk=0; history.back(); return; }
  navExitAsk=t; showToast('한 번 더 누르면 앱이 닫혀요'); navGuard();
}
if(typeof history!=='undefined' && history.pushState){
  try{ history.replaceState({onstudy:0},''); }catch(e){}
  navGuard();
  window.addEventListener('popstate', navPop);
}

function goTab(v,keepDate){
  saveData();   // 바뀐 게 있을 때만 실제 저장됨(writeNow에서 변경 확인)
  /* ★ 화면을 옮기기 전에 지금 화면을 발자국으로 남긴다(뒤로 가는 중이면 남기지 않는다) */
  if(!navGoingBack && !(navView===v && adminSection===null)) navStack.push({v:navView, sec:adminSection});
  if(navStack.length>40) navStack.splice(0, navStack.length-40);   // 발자국이 끝없이 쌓이지 않게
  navView=v;
  if(v==='home') homeDate=null;    // 홈은 항상 오늘 (다른 화면 갔다 돌아오면 오늘로) — 2026-07-24 원장님 지시
  if(v==='today' && !keepDate) attnDate=null;   // 아래 탭으로 들어올 때만 오늘로 초기화
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
    live, logbook, seedUntil, histFixV,   // 등원중 · 오늘 알림 · 확정 기준일 · 지난기록 정리버전 (보강은 makeupLog로 통합)
  };
}
function reviveDates(arr){ arr.forEach(o=>{ if(o&&o.date) o.date=new Date(o.date); }); return arr; }
function applyState(d){
  if(!d) return;
  if(d.packages && typeof d.packages==='object') packages=d.packages;   // 없으면 {} 그대로 → 화면에 '미설정'
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
  /* ★ 2026-07-27h: 정산 문구를 코드 문구로 덮어쓰던 것을 삭제. 저장된 값만 쓴다. */
  // 등원 중 상태: 오늘 것만 복원(어제 것이 남아 '수업 중'으로 보이지 않게)
  if(d.live && typeof d.live==='object'){
    const t=dayKey(now.getTime()); const nl={};
    for(const k in d.live){ const v=d.live[k]; if(typeof v==='number' && dayKey(v)===t) nl[k]=v; }
    live=nl;
  }
  // '오늘만 추가'는 그날 하루만 유효 — 다른 날짜면 비움
  tempDay = (typeof d.tempDay==='number') ? d.tempDay : null;
  seedUntil = (typeof d.seedUntil==='number') ? d.seedUntil : null;
  histFixV = (typeof d.histFixV==='number') ? d.histFixV : 0;   // 없으면 0 = 아직 정리 안 됨
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
  if(document.body.dataset.mode==='admin'){
    /* 첫 화면이므로 뒤로 갈 발자국을 만들지 않는다(뒤로 누르면 없는 홈으로 가 버린다) */
    navGoingBack=true; try{ goTab('admin'); } finally { navGoingBack=false; }
  }
  else { navView='home'; renderHome(); }
  navStack=[];   // 첫 화면이 뿌리다
}
/* 원격 변경(다른 기기)이 들어오면 auth/store가 호출 → 현재 화면 다시 그림 */
function refreshCurrentView(){
  /* ★ 2026-07-28u: 아래 탭 표시(.bt.active)에서 되짚던 것을 navView 하나로 바꿨다.
     하위 화면에서는 아래 탭이 하나도 안 켜져 있어 늘 '홈'으로 잘못 읽히던 오류를 고친 것이다. */
  const v=navView;
  const map={home:renderHome,today:renderToday,students:renderStudents,settle:renderSettle,
    counsel:renderCounsel,report:renderReport,admin:renderAdmin,manage:renderManage,
    send:renderSend,guide:renderGuide,payhist:renderPayhist,schedule:renderSchedule,classmgmt:renderClassMgmt,
    academy:renderAcademy,datacheck:renderDataCheck};
  (map[v]||renderHome)();
}
