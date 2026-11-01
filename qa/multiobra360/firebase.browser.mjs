
import {initializeApp} from 'firebase/app';
import * as sdk from 'firebase/firestore';
// Only the external account boundary is synthetic. Every Firestore operation
// uses the genuine SDK against the loopback emulator; production keys are never loaded.
const options=JSON.parse(document.querySelector('#audit-options').textContent);
let n=0;
export let db;
export const auth={currentUser:null};
export const app=null,storage={},googleProvider={};
export function useAuditUser(uid){
  auth.currentUser=uid?{uid,email:uid+'@audit.invalid'}:null;
  if(uid){
    const app=initializeApp({projectId:options.projectId,apiKey:'emulator-only'},'audit-'+(++n));
    db=sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db,'127.0.0.1',options.firestorePort,{mockUserToken:{sub:uid,user_id:uid}});
  }
}
useAuditUser(options.uid);
export const {doc,getDoc,updateDoc,deleteDoc,collection,serverTimestamp,query,orderBy,limit,Timestamp,where,documentId,writeBatch,runTransaction,startAfter}=sdk;
export const getDocs=(...args)=>sdk.getDocs(...args);
export const setDoc=(...args)=>sdk.setDoc(...args);
export const onSnapshot=(...args)=>sdk.onSnapshot(...args);
export const rawSDK=sdk;
export const onAuthStateChanged=(_auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return()=>{};};
export const signOut=async()=>useAuditUser(null);
export const signInWithPopup=async()=>{throw Error('External OAuth is outside this scoped E2E harness');};
const forbidden=()=>{throw Error('Storage is outside the multiobra360 test scope');};
export const ref=forbidden,uploadString=forbidden,getDownloadURL=forbidden,deleteObject=forbidden,getBlob=forbidden;
