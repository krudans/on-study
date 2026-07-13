/* ============================================================
   롯데이노베이트 L메시지 알림톡 어댑터
   ------------------------------------------------------------
   ★ 이 파일이 "나중에 규격/키만 채우면 되는" 교체 지점입니다.
   회사 L메시지 API 문서를 받으면 아래 3곳만 채우면 작동해요:
     (1) CONFIG  : 엔드포인트·인증키·발신프로필키·발신번호
     (2) getToken(): 토큰 발급이 필요한 방식이면 구현 (아니면 그대로 둠)
     (3) sendAlimtalk(): 실제 발송 요청 본문(payload) 형식 맞추기
   키는 코드에 직접 쓰지 말고 Functions 환경설정(secret)으로 주입합니다.
   ============================================================ */

// (1) 설정값 — 실제 값은 환경변수에서 읽어옴 (배포 시 firebase functions:config 또는 secret)
const CONFIG = {
  baseUrl:     process.env.LMSG_BASE_URL     || '',   // 예: https://xxx.lotte.net
  apiKey:      process.env.LMSG_API_KEY      || '',   // 발급받은 API 키
  apiSecret:   process.env.LMSG_API_SECRET   || '',   // (있으면) 시크릿
  senderKey:   process.env.LMSG_SENDER_KEY   || '',   // 발신 프로필 키(카카오 채널)
  smsFrom:     process.env.LMSG_SMS_FROM     || '',   // 대체문자 발신번호
};

/* (2) 토큰 발급이 필요한 방식이면 여기서 access_token을 받아옴.
   API 키만으로 바로 발송하는 방식이면 이 함수는 그대로 두고 sendAlimtalk에서 안 써도 됨. */
async function getToken(){
  // TODO: 회사 문서에 토큰 발급 API가 있으면 구현
  // 예시(형태만): const res = await fetch(`${CONFIG.baseUrl}/oauth/token`, {...});
  //              return (await res.json()).access_token;
  return null;
}

/* (3) 알림톡 1건 발송.
   params = {
     to,            // 수신 전화번호 (숫자만, 예: '01012345678')
     templateCode,  // 카카오 승인된 템플릿 코드
     text,          // 치환 완료된 메시지 본문 (템플릿과 일치해야 함)
     fallbackSms    // true면 카톡 실패 시 대체문자(SMS/LMS) 자동전환
   }
   반환: { ok:boolean, channel:'kakao'|'sms'|'fail', raw:any }
*/
async function sendAlimtalk({ to, templateCode, text, fallbackSms = true }){
  // 설정이 비어 있으면(아직 규격 미입력) 실제 발송 대신 "미설정" 반환
  if(!CONFIG.baseUrl || !CONFIG.apiKey || !CONFIG.senderKey){
    return { ok:false, channel:'unconfigured',
      raw:'L메시지 설정(LMSG_*)이 아직 없습니다. lotte-adapter.js CONFIG 및 환경변수를 채워주세요.' };
  }

  const digits = String(to || '').replace(/[^0-9]/g, '');
  if(!digits) return { ok:false, channel:'fail', raw:'수신번호 없음' };

  // ── 아래 요청 형식은 회사 L메시지 문서에 맞게 조정하세요 (딜러사마다 필드명이 다름) ──
  // 흔한 카카오 비즈메시지 형식 예시(참고용). 실제 필드명/경로는 문서 기준으로 교체.
  const token = await getToken(); // 토큰 방식 아니면 null
  const url = `${CONFIG.baseUrl}/v2/send/kakao`; // TODO: 실제 발송 경로로 교체
  const headers = { 'Content-Type': 'application/json', 'accept': '*/*' };
  if(token) headers['authorization'] = `Bearer ${token}`;
  else { headers['x-api-key'] = CONFIG.apiKey; }  // TODO: 회사 인증 헤더 방식으로 교체

  const body = {
    message_type: 'AT',                 // 알림톡
    sender_key:  CONFIG.senderKey,
    template_code: templateCode,
    phone_number: digits,
    message: text,
    fall_back_yn: !!fallbackSms,        // 카톡 실패 시 대체문자
    // 대체문자로 전환될 때의 발신번호/내용 (문서에 맞게)
    sender_no: CONFIG.smsFrom,
    fall_back_message: text,
  };

  try{
    const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
    const raw = await res.json().catch(()=> ({}));
    // TODO: 회사 응답 형식에 맞게 성공/채널 판정 (아래는 예시)
    const ok = res.ok && (raw.code === '0000' || raw.result === 'success' || raw.success === true);
    const channel = ok ? (raw.sent_type === 'SMS' || raw.channel === 'sms' ? 'sms' : 'kakao') : 'fail';
    return { ok, channel, raw };
  }catch(e){
    return { ok:false, channel:'fail', raw:String(e) };
  }
}

module.exports = { sendAlimtalk, getToken, CONFIG };
