/* ============================================================
   On-study 알림톡 발송 서버 (Firebase Cloud Functions)
   - 앱(관리자)에서 호출 → 롯데이노베이트 L메시지로 알림톡 발송
   - API 키는 브라우저에 노출되지 않고 여기(서버)에서만 사용
   ============================================================ */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const { sendAlimtalk } = require('./lotte-adapter');

/* 승인된 템플릿 코드 매핑 — 카카오 심사 통과 후 받은 코드로 채우세요.
   앱에서는 kind('start'|'end'|'absent'|'settle'|'guide')만 넘기고,
   여기서 템플릿 코드로 변환합니다. */
const TEMPLATES = {
  start:  process.env.TPL_START  || 'ONSTUDY_START',   // 등원 알림
  end:    process.env.TPL_END    || 'ONSTUDY_END',     // 하원 알림
  absent: process.env.TPL_ABSENT || 'ONSTUDY_ABSENT',  // 결석 알림(선택)
  settle: process.env.TPL_SETTLE || 'ONSTUDY_SETTLE',  // 정산 요청
  guide:  process.env.TPL_GUIDE  || 'ONSTUDY_GUIDE',   // 학습 안내
};

/* 관리자(로그인 사용자)가 admins 컬렉션에 있는지 확인 */
async function assertAdmin(auth){
  if(!auth || !auth.token || !auth.token.email)
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const email = auth.token.email;
  const doc = await admin.firestore().collection('admins').doc(email).get();
  if(!doc.exists)
    throw new HttpsError('permission-denied', '관리자만 발송할 수 있습니다.');
  return email;
}

/* 발송 호출 (앱에서 httpsCallable('sendNotify')로 호출)
   data = {
     to,           // 수신 전화번호
     kind,         // 'start'|'end'|'absent'|'settle'|'guide'
     text,         // 최종 메시지 본문 (템플릿과 일치)
     fallbackSms   // 카톡 실패 시 문자 전환 (기본 true)
   }
*/
exports.sendNotify = onCall({ region: 'asia-northeast3' }, async (request) => {
  const email = await assertAdmin(request.auth);
  const { to, kind, text, fallbackSms = true } = request.data || {};

  if(!to || !kind || !text)
    throw new HttpsError('invalid-argument', 'to, kind, text가 필요합니다.');
  const templateCode = TEMPLATES[kind];
  if(!templateCode)
    throw new HttpsError('invalid-argument', `알 수 없는 종류: ${kind}`);

  const result = await sendAlimtalk({ to, templateCode, text, fallbackSms });

  // 발송 로그 저장 (선택) — 실패 원인 추적용
  try{
    await admin.firestore().collection('sendLogs').add({
      to: String(to).replace(/[^0-9]/g,''), kind, channel: result.channel,
      ok: result.ok, by: email, at: admin.firestore.FieldValue.serverTimestamp(),
      raw: typeof result.raw === 'string' ? result.raw : JSON.stringify(result.raw).slice(0, 500),
    });
  }catch(e){ /* 로그 실패는 무시 */ }

  if(!result.ok){
    // unconfigured(설정 전)면 앱이 '열어주기'로 폴백하도록 신호
    return { ok:false, channel: result.channel, message: result.raw };
  }
  return { ok:true, channel: result.channel };
});
