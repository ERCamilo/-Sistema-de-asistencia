/**
 * 🧪 LocalBackupCompletenessTests (Auditoría 2026-06-09, hallazgo M3)
 *
 * El backup local (window.exportData → archivo JSON) NO incluía la caja
 * chica: un usuario que confiara en el respaldo perdía proyectos, periodos
 * y movimientos al restaurar.
 *
 * Además, tras el fix H2 (clearAll borra TODOS los stores), el camino de
 * restauración (saveState con clearFirst:true) habría borrado la caja chica
 * local al restaurar un backup viejo que no la trae. clearFirst ahora limpia
 * SOLO los stores que saveState reescribe; el borrado total sigue siendo
 * clearAll() (usado por "Borrar Información Local").
 *
 * Contratos:
 *   - window.exportData incluye pettyCash (leída de PettyCashStore, no del
 *     state de UI) y saneada (sin fotos/form).
 *   - applyBackupData restaura pettyCash vía PettyCashStore.applyRemote.
 *   - saveState({clearFirst}) no toca los stores de caja chica.
 *   - exportDB (dump completo de IndexedDB) incluye los stores de caja chica.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const IDB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'), 'utf8'
);

testRunner.addSuite("Backups locales — caja chica incluida (M3)", {

    "window.exportData incluye pettyCash en el payload del backup"() {
        const block = APP_SRC.match(/window\.exportData\s*=\s*async\s*function[\s\S]{0,2500}?\n\};/);
        testRunner.assert(!!block, 'window.exportData (async) debe existir');
        testRunner.assert(
            /pettyCash/.test(block[0]),
            'el backup debe incluir la caja chica — antes se perdía al restaurar'
        );
    },

    "exportData lee la caja chica de PettyCashStore (verdad durable), no del state de UI"() {
        const block = APP_SRC.match(/window\.exportData\s*=\s*async\s*function[\s\S]{0,2500}?\n\};/);
        testRunner.assert(!!block, 'window.exportData debe existir');
        testRunner.assert(
            /PettyCashStore\.loadLocal/.test(block[0]),
            'debe leer de PettyCashStore.loadLocal() — state.pettyCash puede no estar cargado si nunca se abrió la pestaña'
        );
    },

    "applyBackupData restaura la caja chica cuando el backup la trae"() {
        const block = APP_SRC.match(/async function applyBackupData[\s\S]{0,5000}?\n\}/);
        testRunner.assert(!!block, 'applyBackupData debe existir');
        testRunner.assert(
            /PettyCashStore\.applyRemote/.test(block[0]),
            'debe escribir los stores de caja chica vía PettyCashStore.applyRemote'
        );
    },

    "saveState({clearFirst}) limpia SOLO los stores que reescribe (no caja chica)"() {
        const block = IDB_SRC.match(/async\s+saveState\s*\([\s\S]{0,2500}/);
        testRunner.assert(!!block, 'saveState debe existir');
        testRunner.assert(
            !/clearFirst\)?\s*\{[\s\S]{0,1200}?this\.clearAll\s*\(/.test(block[0]),
            'clearFirst NO debe llamar this.clearAll() — borraría caja chica y comprobantes que el backup viejo no puede restaurar'
        );
        testRunner.assert(
            /clearFirst\)?\s*\{[\s\S]{0,1200}?this\.clear\s*\(/.test(block[0]),
            'clearFirst debe limpiar los stores propios vía this.clear(store)'
        );
    },

    // 🐛 Judgment Day Fase 2A Ronda 3: el canal de guardado se unificó a
    // options.dateKeys (array). saveState decidía "granular vs completo" y el
    // filtro incremental de asistencia SOLO con options.dateKey singular — con
    // dateKeys degradaba a guardado completo (deduplicación + reescritura de
    // todos los stores en cada purge multi-fecha).
    "saveState reconoce options.dateKeys como guardado granular multi-fecha"() {
        const block = IDB_SRC.match(/async\s+saveState\s*\([\s\S]{0,5200}/);
        testRunner.assert(!!block, 'saveState debe existir');
        testRunner.assert(/options\.dateKeys/.test(block[0]),
            'saveState debe reconocer options.dateKeys (no solo dateKey singular)');
        testRunner.assert(/\.some\(/.test(block[0]),
            'el filtro incremental de asistencia debe aceptar los sufijos de TODAS las fechas del lote');
    },

    "exportDB incluye los stores de caja chica"() {
        const block = IDB_SRC.match(/async\s+exportDB\s*\([\s\S]{0,1200}?\n\s{4}\}/);
        testRunner.assert(!!block, 'exportDB debe existir');
        ['pettyCashProjects', 'pettyCashPeriods', 'pettyCashMovements'].forEach(store => {
            testRunner.assert(
                new RegExp(store).test(block[0]),
                `exportDB debe incluir ${store}`
            );
        });
    }

});
