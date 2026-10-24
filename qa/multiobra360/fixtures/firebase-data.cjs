/**
 * Mock de js/modules/data/firebase.js
 * Sustituye la inicialización real de Firebase para que los tests no
 * necesiten credenciales ni conexión de red.
 */

const noop = jest.fn();
const asyncNoop = jest.fn().mockResolvedValue(undefined);

// Auth
export const auth = {};
export const googleProvider = {};
export const signInWithPopup = asyncNoop;
export const signOut = asyncNoop;
export const onAuthStateChanged = jest.fn((auth, cb) => { cb(null); return noop; });

// Firestore
export const db = {};
export const storage = {};
export const doc = jest.fn(() => ({}));
export const getDoc = jest.fn().mockResolvedValue({ exists: () => false, data: () => null });
export const setDoc = asyncNoop;
export const updateDoc = asyncNoop;
export const deleteDoc = asyncNoop;
export const collection = jest.fn(() => ({}));
export const serverTimestamp = jest.fn(() => null);
export const query = jest.fn(() => ({}));
export const orderBy = jest.fn(() => ({}));
export const limit = jest.fn(() => ({}));
export const getDocs = jest.fn().mockResolvedValue({ forEach: () => {}, docs: [] });
export const onSnapshot = jest.fn(() => noop);
export const where = jest.fn(() => ({}));
export const documentId = jest.fn(() => ({}));
export const writeBatch = jest.fn(() => ({
    set: noop,
    update: noop,
    delete: noop,
    commit: asyncNoop
}));
export const runTransaction = jest.fn(async (_db, operation) => operation({
    get: jest.fn(async () => ({ exists: () => false, data: () => null })),
    set: noop
}));
export const startAfter = jest.fn(() => ({}));
export const getBlob = asyncNoop;

// Storage
export const ref = jest.fn(() => ({}));
export const uploadString = asyncNoop;
export const getDownloadURL = jest.fn().mockResolvedValue('');
export const deleteObject = asyncNoop;
