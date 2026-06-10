/**
 * 🧪 StorageRulesTests (Auditoría 2026-06-09, hallazgo M7)
 *
 * Los snapshots grandes (JSON de nómina completo) se suben a Firebase Storage
 * en users/{uid}/snapshots/*. Pero el repo NO versionaba storage.rules ni lo
 * desplegaba: la seguridad del bucket quedaba fuera de control de versiones.
 *
 * Fix: storage.rules owner-only (igual que firestore.rules) + default-deny,
 * cableado en firebase.json para que `firebase deploy` lo publique.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => {
    try { return fs.readFileSync(path.resolve(ROOT, rel), 'utf8'); } catch { return null; }
};

testRunner.addSuite("Storage rules — owner-only + default-deny (M7)", {

    "existe storage.rules en el repo"() {
        const src = read('storage.rules');
        testRunner.assert(!!src, 'debe existir storage.rules versionado en el repo');
    },

    "storage.rules es owner-only sobre users/{userId}/**"() {
        const src = read('storage.rules') || '';
        testRunner.assert(/service\s+firebase\.storage/.test(src),
            'debe declarar service firebase.storage');
        testRunner.assert(/match\s*\/users\/\{userId\}/.test(src),
            'debe acotar el acceso a users/{userId}/**');
        testRunner.assert(/request\.auth\.uid\s*==\s*userId/.test(src),
            'sólo el dueño (request.auth.uid == userId) puede leer/escribir');
    },

    "storage.rules deniega todo lo demás por defecto"() {
        const src = read('storage.rules') || '';
        testRunner.assert(/allow\s+read,\s*write:\s*if\s+false/.test(src),
            'debe haber un default-deny (allow read, write: if false)');
    },

    "firebase.json despliega storage.rules"() {
        const cfg = read('firebase.json') || '';
        testRunner.assert(/"storage"/.test(cfg), 'firebase.json debe tener una sección storage');
        testRunner.assert(/storage\.rules/.test(cfg),
            'firebase.json debe apuntar a storage.rules para desplegarlo');
    }

});
