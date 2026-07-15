/* Firebase 초기화 (compat SDK) — config는 공개돼도 되는 값(비밀키 아님) */
const firebaseConfig = {
  apiKey: "AIzaSyC9GsoNtjXfghbQbZGElzIh6UWKze5cSPY",
  authDomain: "on-study-dacbc.firebaseapp.com",
  projectId: "on-study-dacbc",
  storageBucket: "on-study-dacbc.firebasestorage.app",
  messagingSenderId: "703506618799",
  appId: "1:703506618799:web:b78d31c1ae570d3b5c375a"
};
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
// 로그인 유지: 이 기기에서 한 번 로그인하면 계속 유지(브라우저 닫아도 유지)
try{ fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){}
const fbDb = firebase.firestore();
// 알림톡 발송 서버(Functions) — 배포 후 사용. 미배포 시 호출은 실패하고 앱이 '열어주기'로 폴백.
let fbFunctions=null;
try{ if(firebase.functions) fbFunctions=firebase.app().functions('asia-northeast3'); }catch(e){}
