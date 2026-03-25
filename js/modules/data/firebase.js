import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, query, orderBy, limit, getDocs, Timestamp, onSnapshot, where, documentId, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { firebaseConfig } from '../config/Config.js';

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const storage = getStorage(app);


export { 
    app, db, auth, storage, googleProvider,
    // Auth functions
    signInWithPopup, signOut, onAuthStateChanged,
    // Firestore functions
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, query, orderBy, limit, getDocs, Timestamp, onSnapshot, where, documentId, writeBatch,
    // Storage functions
    ref, uploadString, getDownloadURL
};