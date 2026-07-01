/**
 * 🧪 SyncBadgeWiringTests (Fase 3.2 — cableado UI)
 *
 * Contract tests: verifican que el cableado del badge dentro de la app
 * no se rompa por refactors. La lógica del componente está cubierta
 * exhaustivamente en SyncStatusBadgeTests; aquí solo aseguramos que:
 *   - Header invoca window.renderSyncStatusBadgeForHeader.
 *   - app.js registra ese global.
 *   - app.js conecta attachLiveBadge en boot.
 *   - app.js suscribe listeners de online/offline para refrescar.
 *   - Los puntos de escritura crítica (saveFullState, EmployeeRepo.saveOne)
 *     invocan SyncStatus.markSynced tras éxito.
 */

import fs from 'fs';
import path from 'path';

const APP    = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const HEADER = fs.readFileSync(path.resolve(__dirname, '../modules/ui/Header.js'), 'utf8');
const FB     = fs.readFileSync(path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8');
const REPO   = fs.readFileSync(path.resolve(__dirname, '../modules/services/EmployeeRepository.js'), 'utf8');
const PERSISTENCE = fs.readFileSync(path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8');

testRunner.addSuite("SyncBadgeWiring — Header (Fase 3.2)", {

    "Header invoca window.renderSyncStatusBadgeForHeader"() {
        testRunner.assert(
            /window\.renderSyncStatusBadgeForHeader/.test(HEADER),
            "Header.js debe llamar a window.renderSyncStatusBadgeForHeader"
        );
    },

    "Header no renderiza el indicador legacy duplicado"() {
        testRunner.assert(
            !/\$\{SyncIndicator\s*\?/.test(HEADER),
            "Header.js no debe mostrar SyncIndicator junto al badge nuevo"
        );
    }

});

testRunner.addSuite("SyncBadgeWiring — app.js (Fase 3.2)", {

    "app.js importa renderSyncStatusBadge y attachLiveBadge"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/ui\/SyncStatusBadge\.js['"]/.test(APP),
            "Debe importar de SyncStatusBadge.js"
        );
    },

    "app.js importa SyncStatus"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/SyncStatus\.js['"]/.test(APP),
            "Debe importar SyncStatus.js"
        );
    },

    "app.js define window.renderSyncStatusBadgeForHeader"() {
        testRunner.assert(
            /window\.renderSyncStatusBadgeForHeader\s*=/.test(APP),
            "Debe exponer el global que el Header invoca"
        );
        testRunner.assert(
            /openSyncCenterModal/.test(APP),
            "El badge del header debe abrir el centro de sincronización"
        );
    },

    "app.js invoca attachLiveBadge"() {
        testRunner.assert(
            /attachLiveBadge\s*\(/.test(APP),
            "Debe arrancar el live updater al cargar el módulo"
        );
    },

    "app.js suscribe listeners de online/offline"() {
        testRunner.assert(
            /addEventListener\(['"]online['"]/.test(APP),
            "Debe escuchar el evento 'online'"
        );
        testRunner.assert(
            /addEventListener\(['"]offline['"]/.test(APP),
            "Debe escuchar el evento 'offline'"
        );
    }

});

testRunner.addSuite("SyncBadgeWiring — markSynced en escrituras (Fase 3.2)", {

    "FirebaseService.saveFullState llama SyncStatus.markSynced tras éxito"() {
        // El markSynced debe estar dentro de saveFullState, después del setDoc
        // exitoso, antes del catch.
        const block = FB.match(/async\s+saveFullState[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "saveFullState localizable");
        testRunner.assert(
            /SyncStatus\.markSynced/.test(block[0]),
            "saveFullState debe invocar SyncStatus.markSynced"
        );
    },

    "EmployeeRepository.saveOne llama SyncStatus.markSynced tras éxito"() {
        const block = REPO.match(/async\s+saveOne[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "saveOne localizable");
        testRunner.assert(
            /SyncStatus\.markSynced/.test(block[0]),
            "saveOne debe invocar SyncStatus.markSynced"
        );
    },

    "FirebaseService importa SyncStatus"() {
        testRunner.assert(
            /from\s+['"]\.\/SyncStatus\.js['"]/.test(FB),
            "FirebaseService debe importar SyncStatus"
        );
    },

    "EmployeeRepository importa SyncStatus"() {
        testRunner.assert(
            /from\s+['"]\.\/SyncStatus\.js['"]/.test(REPO),
            "EmployeeRepository debe importar SyncStatus"
        );
    }

});

testRunner.addSuite("SyncBadgeWiring — onCloudResult limpia el error (Judgment Day #3)", {

    "_mainSyncGuards().onCloudResult llama a SyncStatus.clearError() en CUALQUIER éxito"() {
        // clearError() existía en SyncStatus.js pero nadie lo llamaba desde
        // producción: deleteOne() y saveDailyAttendance() NUNCA invocan
        // markSynced() (sólo saveFullState/saveOne lo hacen), así que un
        // borrado o una asistencia granular que drenaba bien tras un fallo
        // previo dejaba el badge en rojo para siempre — el usuario no tenía
        // forma de saber que la nube ya estaba al día de nuevo.
        const block = PERSISTENCE.match(/onCloudResult\s*:\s*\([\s\S]*?\n\s{8}\}/);
        testRunner.assert(!!block, 'debe existir el guard onCloudResult en _mainSyncGuards');
        testRunner.assert(
            /SyncStatus\.clearError\s*\(\s*\)/.test(block[0]),
            'onCloudResult debe llamar a SyncStatus.clearError() para apagar el badge rojo tras cualquier éxito (mirror/daily/delete)'
        );
    },

    "clearError() se llama en la rama de ÉXITO, no en la de fallo"() {
        const block = PERSISTENCE.match(/onCloudResult\s*:\s*\([\s\S]*?\n\s{8}\}/);
        testRunner.assert(!!block, 'debe existir el guard onCloudResult en _mainSyncGuards');
        // La llamada a clearError debe aparecer ANTES del chequeo `if (!ok`
        // que dispara _notifySyncError — si apareciera después o dentro de
        // ese if, se ejecutaría exactamente al revés de lo que hace falta.
        const clearIdx = block[0].search(/SyncStatus\.clearError\s*\(\s*\)/);
        const failIdx = block[0].search(/if\s*\(\s*!ok/);
        testRunner.assert(clearIdx !== -1 && failIdx !== -1 && clearIdx < failIdx,
            'clearError() debe ejecutarse en la rama de éxito, antes del chequeo de fallo');
    }

});

console.log('🧪 SyncBadgeWiring contract tests cargados.');
