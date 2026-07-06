/**
 * 🧪 LoansLedgerU4WiringTests (Fase 2, U4)
 *
 * Contract tests (source-level) del cableado UI de U4 en LoansLedger.js:
 * banner de posibles duplicados (detector post-merge) + badge "pendiente
 * de subir" (EntitiesSyncStamp). La lógica pura está cubierta
 * behavioralmente en LoanDuplicateDetectorTests y EntitiesSyncStampTests.
 */

import fs from 'fs';
import path from 'path';

const LEDGER_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/loans/LoansLedger.js'), 'utf8');

testRunner.addSuite("LoansLedger — cableado del detector de duplicados (Fase 2, U4)", {

    "importa detectLoanDuplicateCandidates de LoanDuplicateDetector.js"() {
        testRunner.assert(
            /import\s*\{[^}]*detectLoanDuplicateCandidates[^}]*\}\s*from\s+['"]\.\/LoanDuplicateDetector\.js['"]/.test(LEDGER_SRC),
            "LoansLedger debe importar el detector"
        );
    },

    "EmployeeLoansDetail invoca el detector con el empleado del drilldown"() {
        testRunner.assert(
            /detectLoanDuplicateCandidates\s*\(\s*emp\s*\)/.test(LEDGER_SRC),
            "el detalle del empleado debe correr el detector sobre sus préstamos"
        );
    },

    "el banner de duplicados solo se muestra si hay candidatos"() {
        testRunner.assert(
            /duplicateCandidates\.length\s*>\s*0\s*\?/.test(LEDGER_SRC),
            "el banner debe ser condicional a que el detector encuentre algo"
        );
        testRunner.assert(
            /Posibles préstamos duplicados/.test(LEDGER_SRC),
            "debe existir el texto del banner"
        );
    }

});

testRunner.addSuite("LoansLedger — cableado del badge pendiente de subir (Fase 2, U4)", {

    "importa isPendingUpload de EntitiesSyncStamp.js"() {
        testRunner.assert(
            /import\s*\{[^}]*isPendingUpload[^}]*\}\s*from\s+['"]\.\.\/\.\.\/services\/EntitiesSyncStamp\.js['"]/.test(LEDGER_SRC),
            "LoansLedger debe importar isPendingUpload"
        );
    },

    "LoanCard evalúa isPendingUpload(loan.updatedAt) gateado por sesión"() {
        testRunner.assert(
            /hasSession\s*&&\s*isPendingUpload\s*\(\s*loan\.updatedAt\s*\)/.test(LEDGER_SRC),
            "el badge debe evaluarse solo con sesión activa (sin cuenta, 'pendiente de subir' es ruido)"
        );
        testRunner.assert(
            /window\.currentUser/.test(LEDGER_SRC),
            "el gate de sesión debe leer window.currentUser"
        );
    },

    "el badge tiene el texto 'Pendiente de subir' y se renderiza junto a los otros badges"() {
        testRunner.assert(
            /Pendiente de subir/.test(LEDGER_SRC),
            "debe existir el texto del badge"
        );
        testRunner.assert(
            /\$\{statusBadge\}[\s\S]{0,80}\$\{pendingUploadBadge\}/.test(LEDGER_SRC),
            "el badge debe renderizarse en la misma columna que statusBadge/refinBadge"
        );
    }

});

const CONTROLLER_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/loans/LoansController.js'), 'utf8');

testRunner.addSuite("LoansLedger — cableado del resolutor de duplicados (Fase 2, U5)", {

    "el banner tiene el botón 'Eliminar este' por préstamo (resolveDupDeleteLoan con data-arg)"() {
        testRunner.assert(
            /data-app-fn="resolveDupDeleteLoan"\s+data-arg=/.test(LEDGER_SRC),
            "cada préstamo del par debe tener su botón de eliminar con el id como data-arg"
        );
    },

    "el banner tiene el botón 'conservar ambos' (resolveDupKeepBoth con data-arg y data-arg2)"() {
        testRunner.assert(
            /data-app-fn="resolveDupKeepBoth"\s+data-arg=[\s\S]{0,60}data-arg2=/.test(LEDGER_SRC),
            "el par debe tener el botón de 'son distintos' con ambos ids"
        );
    },

    "el banner muestra el monto abonado de cada préstamo (elección informada)"() {
        testRunner.assert(
            /getPaidAmount\s*\(\s*l\s*\)/.test(LEDGER_SRC),
            "el usuario debe ver cuánto se abonó a cada uno antes de decidir cuál eliminar"
        );
    },

    "registerLegacyGlobals expone resolveDupKeepBoth y resolveDupDeleteLoan en window"() {
        testRunner.assert(
            /window\.resolveDupKeepBoth\s*=\s*resolveDupKeepBoth/.test(CONTROLLER_SRC),
            "resolveDupKeepBoth debe registrarse para el dispatcher data-app-fn"
        );
        testRunner.assert(
            /window\.resolveDupDeleteLoan\s*=\s*resolveDupDeleteLoan/.test(CONTROLLER_SRC),
            "resolveDupDeleteLoan debe registrarse para el dispatcher data-app-fn"
        );
    }

});

console.log('🧪 LoansLedgerU4Wiring contract tests cargados.');
