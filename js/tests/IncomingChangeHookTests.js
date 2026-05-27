/**
 * 🧪 IncomingChangeHookTests (Tarea #28)
 *
 * Contract tests sobre el cableado del pre-apply hook en
 * subscribeToChanges. Aseguran que las refactorizaciones futuras no
 * eliminen accidentalmente este chequeo de seguridad.
 */

import fs from 'fs';
import path from 'path';

const APP = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("Pre-apply hook — cableado en subscribeToChanges (Tarea #28)", {

    "app.js importa detectIncomingChanges"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/IncomingChangeDetector\.js['"]/.test(APP),
            'Debe importar IncomingChangeDetector'
        );
    },

    "app.js importa IncomingChangeModal"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/ui\/IncomingChangeModal\.js['"]/.test(APP),
            'Debe importar IncomingChangeModal'
        );
    },

    "el hook llama a detectIncomingChanges dentro del subscribeToChanges"() {
        // Buscamos el bloque del subscribe y verificamos la llamada.
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(!!subBlock, 'Bloque de subscribeToChanges localizable');
        testRunner.assert(
            /detectIncomingChanges\s*\(/.test(subBlock[0]),
            'Debe llamar detectIncomingChanges en el callback'
        );
    },

    "abre IncomingChangeModal cuando hay cambios significant"() {
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(
            /IncomingChangeModal\.show\s*\(/.test(subBlock[0]),
            'Debe invocar IncomingChangeModal.show'
        );
    },

    "el modal pasa onApply y onReject"() {
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(/onApply\s*:/.test(subBlock[0]),
            'Debe pasar onApply');
        testRunner.assert(/onReject\s*:/.test(subBlock[0]),
            'Debe pasar onReject');
    },

    "el hook respeta isInitialLoad (no molesta en la carga inicial)"() {
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(/!isInitialLoad/.test(subBlock[0]),
            'Debe gatekeep el hook con isInitialLoad para no molestar en boot');
    },

    "el hook respeta _pendingIncomingReview (no abre dos modales)"() {
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(/_pendingIncomingReview/.test(subBlock[0]),
            'Debe trackear un flag para evitar modales simultáneos');
    },

    "onReject fuerza re-subir el estado local (saveApplicationData force)"() {
        const subBlock = APP.match(/subscribeToChanges\(async[\s\S]{0,5000}\}\);/);
        testRunner.assert(
            /saveApplicationData\s*\(\s*\{\s*force\s*:\s*true/.test(subBlock[0]),
            'onReject debe forzar re-subir el local con saveApplicationData({force:true})'
        );
    }

});

console.log('🧪 Pre-apply hook contract tests cargados.');
