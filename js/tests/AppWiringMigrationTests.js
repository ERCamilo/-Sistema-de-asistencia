/**
 * 🧪 AppWiringMigrationTests (Fase 4.1 paso 4c)
 *
 * Tests de contrato sobre app.js para asegurar que el cableado de la
 * migración no se rompa por refactors futuros. La lógica está probada
 * exhaustivamente en EmployeeLoaderTests; aquí solo verificamos que
 * app.js la conecte donde corresponde.
 */

import fs from 'fs';
import path from 'path';

const APP_PATH = path.resolve(__dirname, '../app.js');
const appSource = fs.readFileSync(APP_PATH, 'utf8');

testRunner.addSuite("app.js — Cableado de migración (Fase 4.1)", {

    "app.js importa drainMainSyncOutbox de PersistenceService (U8)"() {
        testRunner.assert(
            /import\s*\{[^}]*drainMainSyncOutbox[^}]*\}\s*from\s+['"]\.\/modules\/services\/PersistenceService\.js['"]/.test(appSource),
            "app.js debe importar drainMainSyncOutbox"
        );
    },

    "attachLiveBadge se cablea con onErrorClick que drena el outbox (U13)"() {
        const idx = appSource.indexOf('attachLiveBadge({');
        testRunner.assert(idx !== -1, 'debe existir la llamada a attachLiveBadge');
        const block = appSource.slice(idx, idx + 2200);
        testRunner.assert(/onErrorClick\s*:/.test(block),
            'attachLiveBadge debe recibir onErrorClick para que el badge de error sea accionable (U13)');
        testRunner.assert(/onErrorClick\s*:[\s\S]{0,200}?drainMainSyncOutbox\s*\(/.test(block),
            'onErrorClick debe llamar a drainMainSyncOutbox (mismo mecanismo que el botón Reintentar del toast, U12)');
    },

    "el login (onAuthStateChanged) drena el outbox después de claimLocalOwnership (U8)"() {
        // Cierra la pestaña antes de que una subida termine, luego reconectás
        // o volvés a entrar: el login es uno de los dos triggers documentados
        // (junto con 'online') para reanudar pendientes — no basta esperar a
        // que el usuario haga OTRO cambio cualquiera.
        // lastIndexOf: hay OTRA claimLocalOwnership en el flujo de wipe-and-reload
        // (handleLocalOwnerMismatch), que recarga la página 900ms después — ahí
        // drenar no tendría sentido (clearAll() ya vació también el outbox).
        const idx = appSource.lastIndexOf('claimLocalOwnership(user.uid);');
        testRunner.assert(idx !== -1, 'debe existir la llamada a claimLocalOwnership en el login');
        const after = appSource.slice(idx, idx + 400);
        testRunner.assert(/drainMainSyncOutbox\s*\(\s*\)/.test(after),
            'debe llamarse drainMainSyncOutbox() después de claimLocalOwnership al iniciar sesión');
    },

    "app.js importa loadAndMigrateEmployees"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/EmployeeLoader\.js['"]/.test(appSource),
            "app.js debe importar el EmployeeLoader"
        );
    },

    "el callback de subscribeToChanges es async (porque usa await)"() {
        testRunner.assert(
            /subscribeToChanges\s*\(\s*async\s*\(/.test(appSource),
            "El callback debe ser async para poder await loadAndMigrateEmployees"
        );
    },

    "subscribeToChanges invoca loadAndMigrateEmployees"() {
        testRunner.assert(
            /loadAndMigrateEmployees\s*\(/.test(appSource),
            "Debe invocar loadAndMigrateEmployees dentro del callback"
        );
    },

    "subscribeToChanges propaga isDemo desde state.usingDemoData"() {
        // Encontramos la llamada y verificamos que pasa usingDemoData.
        const match = appSource.match(/loadAndMigrateEmployees\s*\(\s*\{[\s\S]*?\}\s*\)/);
        testRunner.assert(!!match, "Debe encontrarse la llamada");
        testRunner.assert(
            /usingDemoData/.test(match[0]),
            "Debe propagar state.usingDemoData a isDemo"
        );
    },

    "subscribeToChanges marca state.settings.schemaVersion tras migrar"() {
        // Sin esta propagación, saveFullState no sabría tomar el camino granular.
        testRunner.assert(
            /state\.settings\.schemaVersion\s*=/.test(appSource),
            "Debe asignar state.settings.schemaVersion para que saveFullState use el camino granular"
        );
    },

    "subscribeToChanges usa loaderResult.employees en vez de remoteData.employees"() {
        // Buscamos el bloque cerca de "newEmployees = dedup(loaderResult"
        testRunner.assert(
            /loaderResult\.employees/.test(appSource),
            "state.employees debe poblarse con loaderResult.employees (no remoteData.employees directo)"
        );
    }

});

testRunner.addSuite("app.js — Cableado de live sync de empleados (Fase 2.1)", {

    "app.js importa EmployeesLiveSync"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/EmployeesLiveSync\.js['"]/.test(appSource),
            "app.js debe importar EmployeesLiveSync"
        );
    },

    "app.js importa EmployeeRepository para usar subscribe"() {
        testRunner.assert(
            /from\s+['"]\.\/modules\/services\/EmployeeRepository\.js['"]/.test(appSource),
            "app.js debe importar EmployeeRepository para conectar subscribe"
        );
    },

    "app.js invoca EmployeesLiveSync.start"() {
        testRunner.assert(
            /EmployeesLiveSync\.start\s*\(/.test(appSource),
            "Debe invocar EmployeesLiveSync.start en el flujo de carga"
        );
    },

    "el subscribe inyectado proviene de EmployeeRepository"() {
        // Verificamos que la llamada a start incluya EmployeeRepository.subscribe
        // (puede usar .bind o una arrow function)
        const match = appSource.match(/EmployeesLiveSync\.start\s*\(\s*\{[\s\S]*?\}\s*\)/);
        testRunner.assert(!!match, "Debe localizarse la llamada");
        testRunner.assert(
            /EmployeeRepository\.subscribe/.test(match[0]),
            "El subscribe inyectado debe ser EmployeeRepository.subscribe"
        );
    },

    "el onApply actualiza state.employees"() {
        const match = appSource.match(/EmployeesLiveSync\.start\s*\(\s*\{[\s\S]*?\}\s*\)/);
        testRunner.assert(
            /state\.employees\s*=/.test(match[0]) || /onApply[\s\S]*?state\.employees/.test(appSource),
            "El onApply debe actualizar state.employees con la nueva lista"
        );
    },

    "se inicia solo cuando schemaVersion >= 2 (no en cuentas legacy)"() {
        // El start no debe ejecutarse sin haber migrado.
        // Buscamos un guard cerca de la llamada.
        const match = appSource.match(/[\s\S]{0,400}EmployeesLiveSync\.start/);
        testRunner.assert(!!match, "Llamada localizable");
        testRunner.assert(
            /schemaVersion/.test(match[0]) || /migrated/.test(match[0]),
            "Debe haber un guard de schemaVersion / migrated antes de start"
        );
    }

});

console.log('🧪 App wiring migration contract tests cargados.');
