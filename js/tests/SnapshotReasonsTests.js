/**
 * 🧪 SnapshotReasonsTests — catálogo de razones de snapshot
 *
 * Verifica:
 *   - Cada razón conocida tiene label, icon, type y color.
 *   - getReasonInfo() devuelve la info correcta cuando la razón existe.
 *   - getReasonInfo() cae al fallback por type cuando la razón no existe
 *     (snapshots viejos sin reason).
 *   - getReasonInfo() cae a 'auto' como último fallback si tampoco hay type.
 *   - defaultReasonForType() mapea los types legacy a una razón sensata.
 *   - Las razones marcadas como protegidas tienen el flag protected=true.
 */

import { SNAPSHOT_REASONS, getReasonInfo, defaultReasonForType } from '../modules/services/SnapshotReasons.js';

testRunner.addSuite("SnapshotReasons — Catálogo de razones", {

    "catálogo: cada razón tiene los campos requeridos"() {
        Object.entries(SNAPSHOT_REASONS).forEach(([code, info]) => {
            testRunner.assert(typeof info.label === 'string' && info.label.length > 0, `${code} debe tener label`);
            testRunner.assert(typeof info.icon === 'string' && info.icon.length > 0, `${code} debe tener icon`);
            testRunner.assert(typeof info.type === 'string', `${code} debe tener type`);
            testRunner.assert(typeof info.color === 'string' && info.color.startsWith('#'), `${code} debe tener color hex`);
        });
    },

    "catálogo: contiene las razones críticas usadas por el sistema"() {
        const required = [
            'manual', 'daily-auto', 'pre-restore',
            'pre-migration-v2', 'pre-bulk-delete', 'pre-import',
            'pre-mantenimiento-auto', 'pre-loan-change'
        ];
        required.forEach(code => {
            testRunner.assert(!!SNAPSHOT_REASONS[code], `Falta razón requerida: ${code}`);
        });
    },

    "getReasonInfo: devuelve info correcta cuando la razón existe"() {
        const info = getReasonInfo('pre-migration-v2', 'pre-restore');
        testRunner.assertEquals(info.label, 'Antes de migrar al sistema multi-dispositivo');
        testRunner.assertEquals(info.icon, '🔄');
        testRunner.assertEquals(info.protected, true);
    },

    "getReasonInfo: cae al fallback por type cuando la razón es desconocida"() {
        const info = getReasonInfo('razon-inventada-que-no-existe', 'auto');
        testRunner.assertEquals(info.label, 'Backup automático');
        testRunner.assertEquals(info.icon, '⚙️');
    },

    "getReasonInfo: cae al fallback por type cuando la razón es null (snapshot viejo)"() {
        const info = getReasonInfo(null, 'manual');
        testRunner.assertEquals(info.label, 'Backup manual');
    },

    "getReasonInfo: type pre-restore sin razón → etiqueta 'Punto protegido'"() {
        const info = getReasonInfo(null, 'pre-restore');
        testRunner.assertEquals(info.label, 'Punto protegido');
        testRunner.assertEquals(info.protected, true);
    },

    "getReasonInfo: sin razón ni type conocido cae a auto (último fallback)"() {
        const info = getReasonInfo(null, 'tipo-raro');
        testRunner.assert(!!info.label, 'Debe devolver algún label aunque sea genérico');
    },

    "defaultReasonForType: manual → manual"() {
        testRunner.assertEquals(defaultReasonForType('manual'), 'manual');
    },

    "defaultReasonForType: auto → daily-auto"() {
        testRunner.assertEquals(defaultReasonForType('auto'), 'daily-auto');
    },

    "defaultReasonForType: pre-restore → pre-restore"() {
        testRunner.assertEquals(defaultReasonForType('pre-restore'), 'pre-restore');
    },

    "defaultReasonForType: si el caller pasó un código de razón directo, se respeta"() {
        // Compat: callers viejos como MaintenanceUI pasaban 'pre-mantenimiento-auto' como type
        // El default debe pasarlo tal cual para que se resuelva contra el catálogo.
        testRunner.assertEquals(defaultReasonForType('pre-mantenimiento-auto'), 'pre-mantenimiento-auto');
    },

    "razones que deben ser protegidas tienen el flag protected=true"() {
        const protectedReasons = [
            'pre-restore', 'pre-migration-v2', 'pre-bulk-delete',
            'pre-import', 'pre-mantenimiento-auto', 'pre-loan-change'
        ];
        protectedReasons.forEach(code => {
            testRunner.assertEquals(SNAPSHOT_REASONS[code].protected, true, `${code} debe estar marcada como protegida`);
        });
    },

    "razones NO protegidas: manual y daily-auto"() {
        testRunner.assert(!SNAPSHOT_REASONS['manual'].protected, 'manual no debe ser protegido');
        testRunner.assert(!SNAPSHOT_REASONS['daily-auto'].protected, 'daily-auto no debe ser protegido');
    }

});
