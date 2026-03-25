import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, query, orderBy, limit, getDocs, Timestamp, onSnapshot, where, documentId } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA",
    authDomain: "phoenix-asistencia-ab641.firebaseapp.com",
    projectId: "phoenix-asistencia-ab641",
    storageBucket: "phoenix-asistencia-ab641.firebasestorage.app",
    messagingSenderId: "538815178313",
    appId: "1:538815178313:web:f6403d517dc805a94e0198",
    measurementId: "G-16NDJX46YN"
};

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
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, query, orderBy, limit, getDocs, Timestamp, onSnapshot, where, documentId,
    // Storage functions
    ref, uploadString, getDownloadURL
};