/**
 * 🧪 MirrorFlushSettingsTests (Auditoría 2026-06-09, hallazgos M9 y M10)
 *
 * M10 — El mirror a Firestore se hace con un debounce de 2s. Si el usuario
 * cerraba la pestaña dentro de esa ventana, el timer moría con la pestaña: el
 * último cambio llegaba a IndexedDB pero NO a la nube hasta la próxima sesión.
 * Fix: syncFirebaseMirrorDebounced expone .flush() para disparar de inmediato
 * el guardado pendiente; flushPendingSave (pagehide/visibilitychange) lo llama.
 *
 * M9 — saveFullState escribía con merge:true, así que una clave de settings
 * BORRADA localmente sobrevivía en la nube y reaparecía en la próxima lectura
 * completa (drift de configuración). Fix: settings se escribe COMO MAPA
 * COMPLETO (updateDoc reemplaza el campo entero), no campo-a-campo.
 */

import fs from 'fs';
import path from 'path';
import { syncFirebaseMirrorDebounced } from '../modules/services/PersistenceService.js';
import FirebaseService from '../modules/services/FirebaseService.js';

const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

testRunner.addSuite("Mirror — flush del debounce pendiente (M10)", {

    "syncFirebaseMirrorDebounced expone .flush()"() {
        testRunner.assert(typeof syncFirebaseMirrorDebounced.flush === 'function',
            'debe existir syncFirebaseMirrorDebounced.flush() para vaciar el mirror antes de cerrar la pestaña');
    },

    async "flush() dispara saveFullState de inmediato sin esperar los 2s"() {
        FirebaseService.saveFullState.mockClear();
        const prevUser = globalThis.currentUser;
        const prevApplying = globalThis._isApplyingRemoteData;
        globalThis.currentUser = { uid: 'm10' };
        globalThis._isApplyingRemoteData = false;
        try {
            const st = { settings: { theme: 'dark' } };
            syncFirebaseMirrorDebounced(st);      // agenda el timer de 2s
            testRunner.assertEquals(FirebaseService.saveFullState.mock.calls.length, 0,
                'todavía no debe haber guardado (sigue en debounce)');
            syncFirebaseMirrorDebounced.flush();  // pagehide → vaciar ya
            testRunner.assert(FirebaseService.saveFullState.mock.calls.length >= 1,
                'flush() debe disparar saveFullState inmediatamente');
        } finally {
            globalThis.currentUser = prevUser;
            globalThis._isApplyingRemoteData = prevApplying;
        }
    },

    async "flush() sin nada pendiente no hace nada (no peta)"() {
        FirebaseService.saveFullState.mockClear();
        syncFirebaseMirrorDebounced.flush();
        testRunner.assertEquals(FirebaseService.saveFullState.mock.calls.length, 0,
            'sin guardado pendiente, flush() es no-op');
    },

    "flushPendingSave vacía también el mirror (no sólo el debounce local)"() {
        const PS_SRC = fs.readFileSync(
            path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
        );
        const block = PS_SRC.match(/export function flushPendingSave[\s\S]{0,900}?\n\}/);
        testRunner.assert(!!block, 'flushPendingSave debe existir');
        testRunner.assert(/syncFirebaseMirrorDebounced\.flush\s*\(/.test(block[0]),
            'flushPendingSave debe llamar a syncFirebaseMirrorDebounced.flush() (M10)');
    }

});

testRunner.addSuite("Mirror — settings como mapa completo, sin drift (M9)", {

    "saveFullState reemplaza settings como mapa completo (updateDoc), no merge campo-a-campo"() {
        const block = FB_SRC.match(/async saveFullState\s*\([\s\S]{0,5200}?\n    \}/);
        testRunner.assert(!!block, 'saveFullState debe existir');
        testRunner.assert(/updateDoc\s*\(/.test(block[0]),
            'saveFullState debe usar updateDoc para escribir settings como mapa completo (M9)');
        testRunner.assert(/settings/.test(block[0]),
            'la escritura wholesale debe referirse a settings');
    },

    "el updateDoc de settings ocurre DESPUÉS del setDoc (para no romper el watermark)"() {
        const block = FB_SRC.match(/async saveFullState\s*\([\s\S]{0,5200}?\n    \}/);
        testRunner.assert(!!block, 'saveFullState debe existir');
        const setDocIdx = block[0].indexOf('setDoc(');
        const updateIdx = block[0].indexOf('updateDoc(');
        testRunner.assert(setDocIdx >= 0 && updateIdx >= 0, 'deben existir setDoc y updateDoc');
        testRunner.assert(updateIdx > setDocIdx,
            'el updateDoc(settings) wholesale debe ir DESPUÉS del setDoc(merge) — así el primer snapshot lleva el localUpdatedAt correcto y el watermark del otro dispositivo no descarta el cambio');
    },

    "settings se captura del cleanState para reescribirse wholesale"() {
        const block = FB_SRC.match(/async saveFullState\s*\([\s\S]{0,5200}?\n    \}/);
        testRunner.assert(!!block, 'saveFullState debe existir');
        testRunner.assert(/settingsMap\s*=\s*cleanState\.settings/.test(block[0]),
            'debe capturarse settingsMap = cleanState.settings para el updateDoc wholesale');
    }

});
