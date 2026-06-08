/**
 * 🧪 PettyCashCalcTests (Caja chica — Fase 1, Paso 1)
 *
 * Helpers PUROS de cálculo de saldo de caja chica.
 *
 * Modelo: Proyecto → Periodo de caja → Movimientos.
 * Un movimiento es { type: 'gasto' | 'reposicion', amount }.
 *   - reposicion: entra dinero al fondo (SUMA).
 *   - gasto: sale dinero (RESTA).
 *
 * Reglas:
 *   - Saldo del periodo = Σ reposiciones − Σ gastos.
 *   - Soporta modo SIN presupuesto: sin reposiciones el saldo va NEGATIVO
 *     (rojo). Al cerrar, "monto a reembolsar" = |saldo negativo|.
 *   - round2 para todo lo financiero (mismo criterio que préstamos).
 *   - Montos inválidos (null, undefined, NaN, "N/A") cuentan como 0.
 *   - Montos string con comas de miles ("1,500.50") se parsean.
 *   - Tipos desconocidos se ignoran (defensivo).
 *   - Saldo del proyecto = Σ saldos de sus periodos.
 */

import {
    round2,
    totalGastos,
    totalReposiciones,
    saldoPeriodo,
    resumenPeriodo,
    saldoProyecto,
    periodsOfProject,
    movementsOfPeriod,
    movementsOfProject,
    saldoPeriodoFlat,
    saldoProyectoFlat
} from '../modules/features/pettycash/PettyCashCalc.js';

const gasto = (amount) => ({ type: 'gasto', amount });
const repo = (amount) => ({ type: 'reposicion', amount });

testRunner.addSuite("PettyCashCalc — round2", {

    "redondea a 2 decimales"() {
        testRunner.assertEquals(round2(3.14159), 3.14);
        testRunner.assertEquals(round2(2.005), 2.01);
    },

    "absorbe el error de punto flotante (0.1 + 0.2)"() {
        testRunner.assertEquals(round2(0.1 + 0.2), 0.3);
    },

    "maneja negativos"() {
        testRunner.assertEquals(round2(-4699.999), -4700);
    },

    "null / undefined / NaN → 0"() {
        testRunner.assertEquals(round2(null), 0);
        testRunner.assertEquals(round2(undefined), 0);
        testRunner.assertEquals(round2(NaN), 0);
    }
});

testRunner.addSuite("PettyCashCalc — totales y parseo", {

    "totalGastos suma solo gastos"() {
        const movs = [gasto(3500), repo(10000), gasto(1200), gasto(800)];
        testRunner.assertEquals(totalGastos(movs), 5500);
    },

    "totalReposiciones suma solo reposiciones"() {
        const movs = [gasto(3500), repo(10000), repo(5500)];
        testRunner.assertEquals(totalReposiciones(movs), 15500);
    },

    "parsea strings con comas de miles"() {
        const movs = [gasto("1,500.50"), gasto("2,000")];
        testRunner.assertEquals(totalGastos(movs), 3500.5);
    },

    "montos inválidos cuentan como 0"() {
        const movs = [gasto(null), gasto(undefined), gasto("N/A"), gasto(500)];
        testRunner.assertEquals(totalGastos(movs), 500);
    },

    "ignora tipos desconocidos"() {
        const movs = [gasto(500), { type: 'otro', amount: 9999 }, repo(1000)];
        testRunner.assertEquals(totalGastos(movs), 500);
        testRunner.assertEquals(totalReposiciones(movs), 1000);
    },

    "arreglo vacío / no-arreglo → 0"() {
        testRunner.assertEquals(totalGastos([]), 0);
        testRunner.assertEquals(totalGastos(null), 0);
        testRunner.assertEquals(totalReposiciones(undefined), 0);
    }
});

testRunner.addSuite("PettyCashCalc — saldoPeriodo", {

    "periodo vacío = 0"() {
        testRunner.assertEquals(saldoPeriodo([]), 0);
    },

    "modo fondo: apertura + gastos da saldo positivo"() {
        const movs = [repo(10000), gasto(3500), gasto(1200), gasto(800)];
        testRunner.assertEquals(saldoPeriodo(movs), 4500);
    },

    "fondo con reposición intermedia (ejemplo del doc)"() {
        const movs = [
            repo(10000), gasto(3500), gasto(1200), gasto(800),
            repo(5500), gasto(7000)
        ];
        testRunner.assertEquals(saldoPeriodo(movs), 3000);
    },

    "modo SIN presupuesto: solo gastos → saldo negativo (rojo)"() {
        const movs = [gasto(3500), gasto(1200)];
        testRunner.assertEquals(saldoPeriodo(movs), -4700);
    },

    "reposición que cubre exactamente los gastos → 0"() {
        const movs = [gasto(3500), gasto(1200), repo(4700)];
        testRunner.assertEquals(saldoPeriodo(movs), 0);
    }
});

testRunner.addSuite("PettyCashCalc — resumenPeriodo", {

    "desglosa gastos, reposiciones, saldo y reembolso"() {
        const movs = [repo(10000), gasto(3500), gasto(1200)];
        const r = resumenPeriodo(movs);
        testRunner.assertEquals(r.gastos, 4700);
        testRunner.assertEquals(r.reposiciones, 10000);
        testRunner.assertEquals(r.saldo, 5300);
        testRunner.assertEquals(r.reembolso, 0);
    },

    "modo reembolso: saldo negativo → reembolso = |saldo|"() {
        const movs = [gasto(3500), gasto(1200)];
        const r = resumenPeriodo(movs);
        testRunner.assertEquals(r.saldo, -4700);
        testRunner.assertEquals(r.reembolso, 4700);
    },

    "saldo positivo → reembolso 0"() {
        const r = resumenPeriodo([repo(5000), gasto(1000)]);
        testRunner.assertEquals(r.reembolso, 0);
    }
});

testRunner.addSuite("PettyCashCalc — saldoProyecto", {

    "proyecto vacío = 0"() {
        testRunner.assertEquals(saldoProyecto([]), 0);
        testRunner.assertEquals(saldoProyecto(null), 0);
    },

    "suma los saldos de todos los periodos"() {
        const periodos = [
            { movimientos: [repo(10000), gasto(4000)] },  // 6000
            { movimientos: [repo(5000), gasto(1500)] },   // 3500
            { movimientos: [gasto(2000)] }                // -2000 (sin presupuesto)
        ];
        testRunner.assertEquals(saldoProyecto(periodos), 7500);
    },

    "periodo sin movimientos no rompe la suma"() {
        const periodos = [
            { movimientos: [repo(1000)] },  // 1000
            {},                             // 0 (sin movimientos)
            { movimientos: null }           // 0
        ];
        testRunner.assertEquals(saldoProyecto(periodos), 1000);
    }
});

testRunner.addSuite("PettyCashCalc — selectores del state plano", {

    "periodsOfProject filtra por projectId"() {
        const periods = [
            { id: 'per1', projectId: 'p1' },
            { id: 'per2', projectId: 'p2' },
            { id: 'per3', projectId: 'p1' }
        ];
        const r = periodsOfProject(periods, 'p1');
        testRunner.assertEquals(r.length, 2);
        testRunner.assertEquals(r.map(p => p.id).join(','), 'per1,per3');
    },

    "movementsOfPeriod filtra por periodId"() {
        const movs = [
            { id: 'm1', periodId: 'per1', type: 'gasto', amount: 100 },
            { id: 'm2', periodId: 'per2', type: 'gasto', amount: 200 },
            { id: 'm3', periodId: 'per1', type: 'reposicion', amount: 500 }
        ];
        testRunner.assertEquals(movementsOfPeriod(movs, 'per1').length, 2);
    },

    "movementsOfProject filtra por projectId"() {
        const movs = [
            { id: 'm1', projectId: 'p1', type: 'gasto', amount: 100 },
            { id: 'm2', projectId: 'p2', type: 'gasto', amount: 200 }
        ];
        testRunner.assertEquals(movementsOfProject(movs, 'p1').length, 1);
    },

    "saldoPeriodoFlat: reposicion − gastos del periodo"() {
        const movs = [
            { periodId: 'per1', type: 'reposicion', amount: 10000 },
            { periodId: 'per1', type: 'gasto', amount: 3500 },
            { periodId: 'per2', type: 'gasto', amount: 9999 }
        ];
        testRunner.assertEquals(saldoPeriodoFlat(movs, 'per1'), 6500);
    },

    "saldoProyectoFlat: suma de todos los movimientos del proyecto"() {
        const movs = [
            { projectId: 'p1', type: 'reposicion', amount: 10000 },
            { projectId: 'p1', type: 'gasto', amount: 4000 },
            { projectId: 'p1', type: 'gasto', amount: 1500 },
            { projectId: 'p2', type: 'gasto', amount: 9999 }
        ];
        testRunner.assertEquals(saldoProyectoFlat(movs, 'p1'), 4500);
    },

    "selectores toleran null / no-arreglo"() {
        testRunner.assertEquals(periodsOfProject(null, 'p1').length, 0);
        testRunner.assertEquals(movementsOfPeriod(undefined, 'per1').length, 0);
        testRunner.assertEquals(saldoProyectoFlat(null, 'p1'), 0);
    }

});
