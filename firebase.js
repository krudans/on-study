/* Firebase 초기화 (compat SDK) — config는 공개돼도 되는 값(비밀키 아님) */
const firebaseConfig = {
  apiKey: "AIzaSyBGb5fGAyC-pRcRU6MUHb__b_vKha71HRE",
  authDomain: "on-study-dacbc.firebaseapp.com",
  projectId: "on-study-dacbc",
  storageBucket: "on-study-dacbc.firebasestorage.app",
  messagingSenderId: "703506618799",
  appId: "1:703506618799:web:b78d31c1ae570d3b5c375a"
};
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
