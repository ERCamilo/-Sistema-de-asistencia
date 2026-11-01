/**
 * Sustituto de js/modules/data/firebase.js para las pruebas contra el emulador
 * de Firestore (jest.emulator.config.cjs). Reexporta el SDK modular real que la
 * prueba deja en globalThis.__SA_FIRESTORE_SDK__, así cada "dispositivo" aislado
 * con jest.isolateModules comparte el mismo SDK pero tiene su propio db/auth.
 *
 * `__hooks.afterTransactionGet` permite pausar una transacción real después de
 * una lectura para forzar entrelazados (ambos clientes leen antes de confirmar).
 */
const sdk = () => {
    const value = globalThis.__SA_FIRESTORE_SDK__;
    if (!value) throw new Error('Emulator shim: falta globalThis.__SA_FIRESTORE_SDK__');
    return value;
};

export let db = null;
export const auth = { currentUser: null };
export const storage = {};
export const __hooks = { afterTransactionGet: null };

export function __useDevice({ firestore, uid }) {
    db = firestore;
    auth.currentUser = uid ? { uid } : null;
}

export const doc = (...args) => sdk().doc(...args);
export const collection = (...args) => sdk().collection(...args);
export const getDoc = (...args) => sdk().getDoc(...args);
export const getDocs = (...args) => sdk().getDocs(...args);
export const setDoc = (...args) => sdk().setDoc(...args);
export const updateDoc = (...args) => sdk().updateDoc(...args);
export const deleteDoc = (...args) => sdk().deleteDoc(...args);
export const query = (...args) => sdk().query(...args);
export const where = (...args) => sdk().where(...args);
export const orderBy = (...args) => sdk().orderBy(...args);
export const limit = (...args) => sdk().limit(...args);
export const startAfter = (...args) => sdk().startAfter(...args);
export const documentId = (...args) => sdk().documentId(...args);
export const onSnapshot = (...args) => sdk().onSnapshot(...args);
export const writeBatch = (...args) => sdk().writeBatch(...args);
export const serverTimestamp = (...args) => sdk().serverTimestamp(...args);

export function runTransaction(database, operation, options) {
    let attempt = 0;
    return sdk().runTransaction(database, async transaction => {
        attempt += 1;
        const current = attempt;
        const wrapped = {
            async get(ref) {
                const snapshot = await transaction.get(ref);
                const hook = __hooks.afterTransactionGet;
                if (hook) await hook({ path: ref.path, attempt: current });
                return snapshot;
            },
            set(...args) { transaction.set(...args); return wrapped; },
            update(...args) { transaction.update(...args); return wrapped; },
            delete(...args) { transaction.delete(...args); return wrapped; }
        };
        return operation(wrapped);
    }, options);
}
