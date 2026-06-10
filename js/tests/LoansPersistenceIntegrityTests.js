/**
 * 🧪 LoansPersistenceIntegrityTests (Auditoría préstamos 2026-06-10)
 *
 * Cubre los 4 hallazgos del guardado de préstamos/adelantos:
 *
 * P1 — RESURRECCIÓN AL BORRAR: removeAdvance/removeBonus/removeDeduction
 *      hacían splice + sync, pero el merge con la nube (unionById) re-agregaba
 *      el item borrado desde la copia remota → "no se puede borrar" /
 *      registros fantasma. Fix: tombstones (deletedItemIds) que el merge
 *      respeta y propaga.
 *
 * P2 — ANULACIÓN DE ABONOS PERDIDA: los payments no tenían updatedAt, así
 *      que en colisión de merge ganaba siempre el lado "local" — una copia
 *      vieja sin anular pisaba la anulación del otro dispositivo y el saldo
 *      quedaba mal. Fix: recordPayment/voidPayment estampan updatedAt.
 *
 * P3 — DUPLICACIÓN ENTRE DISPOSITIVOS: items legacy sin id recibían un UUID
 *      ALEATORIO por dispositivo (backfill) o por lado (unionById) → el mismo
 *      préstamo terminaba duplicado con dos ids distintos. Fix: ids
 *      deterministas por huella de contenido (fingerprintId) — mismo
 *      contenido → mismo id en cualquier dispositivo.
 *
 * P4 — COLISIÓN DE IDs ENTRE DISPOSITIVOS: genId era timestamp+contador
 *      (contador reinicia en cada carga) — dos dispositivos en el mismo
 *      milisegundo generaban el MISMO id y el merge fusionaba préstamos
 *      distintos. Fix: sufijo aleatorio.
 */

import fs from 'fs';
import path from 'path';
import { mergeEmployees, unionById } from '../modules/services/EmployeeMerge.js';
import { recordPayment, voidPayment, createLoan } from '../modules/features/loans/LoansService.js';
import { backfillNestedIds } from '../modules/services/LoanIdBackfill.js';
import { fingerprintId } from '../modules/services/RecordKey.js';
import {
    recordNestedTombstone, mergeTombstoneMaps, MAX_TOMBSTONES_PER_FIELD
} from '../modules/services/NestedTombstones.js';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const BRIDGE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/loans/LegacyAdvancesBridge.js'), 'utf8'
);
const PROFILE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/profile/ProfileController.js'), 'utf8'
);
const LOANS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/loans/LoansService.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Anulación de abonos sobrevive el merge
// ─────────────────────────────────────────────────────────────────────────────

testRunner.addSuite("Préstamos P2 — voidPayment sobrevive el merge (behavioral)", {

    "recordPayment estampa updatedAt en el payment"() {
        const emp = { id: 'e1', loans: [] };
        const loan = createLoan(emp, { principal: 1000, startDate: '2026-06-01' });
        const pay = recordPayment(emp, loan.id, { amount: 100, date: '2026-06-05' });
        testRunner.assert(
            typeof pay.updatedAt === 'number' && pay.updatedAt > 0,
            'el payment recién creado debe llevar updatedAt'
        );
    },

    "voidPayment refresca updatedAt del payment"() {
        const emp = { id: 'e1', loans: [] };
        const loan = createLoan(emp, { principal: 1000, startDate: '2026-06-01' });
        const pay = recordPayment(emp, loan.id, { amount: 100, date: '2026-06-05' });
        pay.updatedAt = 1000; // simular abono viejo
        voidPayment(emp, loan.id, pay.id);
        testRunner.assert(
            typeof pay.updatedAt === 'number' && pay.updatedAt > 1000,
            'voidPayment debe subir updatedAt para que la anulación gane el merge'
        );
    },

    "la anulación gana cuando la copia anulada está del lado SERVER"() {
        // Dispositivo A anuló (server). Dispositivo B aún tiene la copia vieja (local).
        const server = {
            id: 'e1', updatedAt: 100,
            loans: [{ id: 'L1', updatedAt: 300, payments: [
                { id: 'P1', amount: 100, voided: true, voidedAt: 5000, updatedAt: 5000 }
            ]}]
        };
        const local = {
            id: 'e1', updatedAt: 200,
            loans: [{ id: 'L1', updatedAt: 200, payments: [
                { id: 'P1', amount: 100, voided: false, updatedAt: 1000 }
            ]}]
        };
        const out = mergeEmployees(server, local);
        const p1 = out.loans[0].payments.find(p => p.id === 'P1');
        testRunner.assert(p1 && p1.voided === true,
            'la copia anulada (updatedAt mayor) debe ganar el merge');
    },

    "la anulación gana cuando la copia anulada está del lado LOCAL"() {
        const server = {
            id: 'e1', updatedAt: 300,
            loans: [{ id: 'L1', updatedAt: 300, payments: [
                { id: 'P1', amount: 100, voided: false, updatedAt: 1000 }
            ]}]
        };
        const local = {
            id: 'e1', updatedAt: 200,
            loans: [{ id: 'L1', updatedAt: 200, payments: [
                { id: 'P1', amount: 100, voided: true, voidedAt: 5000, updatedAt: 5000 }
            ]}]
        };
        const out = mergeEmployees(server, local);
        const p1 = out.loans[0].payments.find(p => p.id === 'P1');
        testRunner.assert(p1 && p1.voided === true,
            'aunque el loan remoto sea "más nuevo", el payment anulado con updatedAt mayor debe ganar');
    },

    "copia vieja SIN updatedAt nunca pisa una anulación con updatedAt"() {
        const server = {
            id: 'e1', updatedAt: 100,
            loans: [{ id: 'L1', updatedAt: 100, payments: [
                { id: 'P1', amount: 100, voided: true, voidedAt: 5000, updatedAt: 5000 }
            ]}]
        };
        const local = {
            id: 'e1', updatedAt: 200,
            loans: [{ id: 'L1', updatedAt: 200, payments: [
                { id: 'P1', amount: 100, voided: false } // legacy: sin updatedAt
            ]}]
        };
        const out = mergeEmployees(server, local);
        const p1 = out.loans[0].payments.find(p => p.id === 'P1');
        testRunner.assert(p1 && p1.voided === true,
            'el lado con updatedAt debe ganar sobre el lado sin timestamp');
    }

});

// ─────────────────────────────────────────────────────────────────────────────
// P1 — Tombstones: borrar adelantos/bonos/deducciones se respeta en el merge
// ─────────────────────────────────────────────────────────────────────────────

testRunner.addSuite("Préstamos P1 — tombstones de borrado (behavioral)", {

    "recordNestedTombstone registra el id y sube emp.updatedAt"() {
        const emp = { id: 'e1', updatedAt: 1 };
        const ok = recordNestedTombstone(emp, 'advances', 'ADV-1');
        testRunner.assert(ok, 'debe registrar');
        testRunner.assert(
            emp.deletedItemIds.advances.includes('ADV-1'),
            'el id borrado debe quedar en deletedItemIds.advances'
        );
        testRunner.assert(emp.updatedAt > 1, 'debe subir updatedAt');
    },

    "recordNestedTombstone ignora campos desconocidos e ids falsy"() {
        const emp = { id: 'e1' };
        testRunner.assert(!recordNestedTombstone(emp, 'attendance', 'X'), 'campo no soportado');
        testRunner.assert(!recordNestedTombstone(emp, 'advances', ''), 'id vacío');
        testRunner.assert(!emp.deletedItemIds, 'no debe crear estructura en vano');
    },

    "merge: un advance borrado localmente NO resucita desde la nube"() {
        // El caso reportado: usuario borra un adelanto → la copia remota lo
        // re-agregaba en el siguiente sync.
        const server = {
            id: 'e1', updatedAt: 100,
            advances: [{ id: 'ADV-1', amount: 500 }, { id: 'ADV-2', amount: 700 }]
        };
        const local = {
            id: 'e1', updatedAt: 200,
            advances: [{ id: 'ADV-2', amount: 700 }],
            deletedItemIds: { advances: ['ADV-1'] }
        };
        const out = mergeEmployees(server, local);
        testRunner.assert(
            !out.advances.some(a => a.id === 'ADV-1'),
            'ADV-1 fue borrado → no debe volver del lado server'
        );
        testRunner.assert(
            out.advances.some(a => a.id === 'ADV-2'),
            'ADV-2 sigue vivo'
        );
        testRunner.assert(
            out.deletedItemIds.advances.includes('ADV-1'),
            'el tombstone debe propagarse en el resultado para proteger futuros merges'
        );
    },

    "merge: el tombstone que viene de la NUBE también aplica sobre lo local"() {
        // Dispositivo A borró; dispositivo B aún tiene el item.
        const server = {
            id: 'e1', updatedAt: 300,
            bonuses: [],
            deletedItemIds: { bonuses: ['BON-9'] }
        };
        const local = {
            id: 'e1', updatedAt: 100,
            bonuses: [{ id: 'BON-9', value: 50 }]
        };
        const out = mergeEmployees(server, local);
        testRunner.assert(
            !out.bonuses.some(b => b.id === 'BON-9'),
            'el borrado hecho en otro dispositivo debe aplicar aquí'
        );
    },

    "merge: tombstones de ambos lados se unen"() {
        const server = { id: 'e1', deductions: [], deletedItemIds: { deductions: ['D1'] } };
        const local  = { id: 'e1', deductions: [], deletedItemIds: { deductions: ['D2'] } };
        const out = mergeEmployees(server, local);
        testRunner.assert(
            out.deletedItemIds.deductions.includes('D1') && out.deletedItemIds.deductions.includes('D2'),
            'la unión de tombstones debe conservar ambos'
        );
    },

    "tombstones tienen tope (no crecen sin límite)"() {
        const a = { advances: Array.from({ length: MAX_TOMBSTONES_PER_FIELD + 50 }, (_, i) => `A${i}`) };
        const merged = mergeTombstoneMaps(a, { advances: ['Z1'] });
        testRunner.assert(
            merged.advances.length <= MAX_TOMBSTONES_PER_FIELD,
            `la lista debe quedar capada a ${MAX_TOMBSTONES_PER_FIELD}`
        );
        testRunner.assert(
            merged.advances.includes('Z1'),
            'el tombstone más reciente debe sobrevivir al cap'
        );
    },

    "préstamos: un loan tombstoneado tampoco resucita"() {
        const server = { id: 'e1', loans: [{ id: 'L1', principal: 100, updatedAt: 1 }] };
        const local  = { id: 'e1', loans: [], deletedItemIds: { loans: ['L1'] } };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.loans.length, 0, 'L1 no debe volver');
    }

});

testRunner.addSuite("Préstamos P1 — wiring de tombstones en la UI (contratos)", {

    "app.js: removeAdvance/removeBonus/removeDeduction registran tombstone"() {
        ['removeAdvance', 'removeBonus', 'removeDeduction'].forEach(fn => {
            const block = APP_SRC.match(new RegExp(`window\\.${fn}\\s*=\\s*\\([\\s\\S]{0,600}?\\};`));
            testRunner.assert(!!block, `${fn} debe existir en app.js`);
            testRunner.assert(
                /recordNestedTombstone/.test(block[0]),
                `${fn} debe registrar el tombstone del item borrado antes del splice`
            );
        });
    },

    "LegacyAdvancesBridge.removeAdvanceAt registra tombstone"() {
        testRunner.assert(
            /recordNestedTombstone/.test(BRIDGE_SRC),
            'removeAdvanceAt debe registrar el tombstone en el scratch'
        );
    },

    "syncProfileToMaster propaga deletedItemIds y sube emp.updatedAt"() {
        const block = PROFILE_SRC.match(/export function syncProfileToMaster[\s\S]{0,2500}?\n\}/);
        testRunner.assert(!!block, 'syncProfileToMaster debe existir');
        testRunner.assert(
            /deletedItemIds/.test(block[0]),
            'debe copiar/fusionar los tombstones del scratch al empleado maestro'
        );
        testRunner.assert(
            /emp\.updatedAt\s*=\s*Date\.now\(\)/.test(block[0]),
            'debe subir emp.updatedAt — sin esto el merge escalar trata la edición como vieja'
        );
    }

});

// ─────────────────────────────────────────────────────────────────────────────
// P3 — IDs deterministas para items legacy sin id
// ─────────────────────────────────────────────────────────────────────────────

testRunner.addSuite("Préstamos P3 — fingerprintId determinista (behavioral)", {

    "mismo contenido → mismo id (en cualquier dispositivo)"() {
        const a = { amount: 500, date: '2026-01-15', note: 'adelanto' };
        const b = { amount: 500, date: '2026-01-15', note: 'adelanto' };
        testRunner.assertEquals(fingerprintId(a), fingerprintId(b));
    },

    "contenido distinto → id distinto"() {
        const a = { amount: 500, date: '2026-01-15' };
        const b = { amount: 501, date: '2026-01-15' };
        testRunner.assert(fingerprintId(a) !== fingerprintId(b));
    },

    "ignora el campo id al calcular la huella"() {
        const a = { id: 'X', amount: 500 };
        const b = { id: 'Y', amount: 500 };
        testRunner.assertEquals(fingerprintId(a), fingerprintId(b));
    },

    "backfill: dos dispositivos asignan el MISMO id al mismo item legacy"() {
        // El mismo doc viejo de la nube cargado en dos dispositivos.
        const deviceA = [{ id: 'e1', loans: [{ principal: 900, startDate: '2025-12-01', createdAt: 111 }] }];
        const deviceB = [{ id: 'e1', loans: [{ principal: 900, startDate: '2025-12-01', createdAt: 111 }] }];
        backfillNestedIds(deviceA);
        backfillNestedIds(deviceB);
        testRunner.assertEquals(
            deviceA[0].loans[0].id, deviceB[0].loans[0].id,
            'mismo contenido debe producir el mismo id — antes cada dispositivo generaba un UUID distinto y el merge duplicaba el préstamo'
        );
    },

    "backfill: dos items idénticos en el MISMO arreglo conservan ids distintos"() {
        const emps = [{ id: 'e1', advances: [
            { amount: 100, date: '2026-01-01' },
            { amount: 100, date: '2026-01-01' }
        ]}];
        backfillNestedIds(emps);
        const [a, b] = emps[0].advances;
        testRunner.assert(a.id && b.id && a.id !== b.id,
            'dos adelantos legítimamente iguales no deben colapsar en uno');
    },

    "unionById: el mismo item sin id en AMBOS lados ya no se duplica"() {
        // Antes: cada lado recibía un UUID aleatorio → 2 copias.
        const server = [{ amount: 800, date: '2026-02-02', note: 'x' }];
        const local  = [{ amount: 800, date: '2026-02-02', note: 'x' }];
        const out = unionById(server, local);
        testRunner.assertEquals(out.length, 1,
            'el mismo item legacy en ambos lados debe fusionarse en uno');
    },

    "unionById: items sin id DISTINTOS en ambos lados se preservan todos"() {
        // Comportamiento histórico que debe mantenerse (no perder datos).
        const server = [{ amount: 100 }, { amount: 200 }];
        const local  = [{ amount: 300 }];
        const out = unionById(server, local);
        testRunner.assertEquals(out.length, 3);
        testRunner.assert(out.every(i => typeof i.id === 'string' && i.id.length > 0),
            'todos deben terminar con id');
    }

});

// ─────────────────────────────────────────────────────────────────────────────
// P4 — genId con componente aleatorio
// ─────────────────────────────────────────────────────────────────────────────

testRunner.addSuite("Préstamos P4 — genId resistente a colisiones entre dispositivos", {

    "genId incluye un componente aleatorio (contrato)"() {
        const block = LOANS_SRC.match(/function genId[\s\S]{0,900}?\n\}/);
        testRunner.assert(!!block, 'genId debe existir');
        testRunner.assert(
            /Math\.random|crypto/.test(block[0]),
            'genId debe incluir aleatoriedad — timestamp+contador colisiona entre dispositivos (el contador reinicia en cada carga de página)'
        );
    },

    "dos préstamos creados seguidos reciben ids distintos (behavioral)"() {
        const emp = { id: 'e1', loans: [] };
        const l1 = createLoan(emp, { principal: 100, startDate: '2026-06-01' });
        const l2 = createLoan(emp, { principal: 100, startDate: '2026-06-01' });
        testRunner.assert(l1.id !== l2.id);
    }

});
