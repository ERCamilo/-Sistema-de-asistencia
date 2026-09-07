/**
 * 🧪 SaMiniRosterExportTests — Contrato F3.5 del productor paralelo SA→Mini v1.
 *
 * Cubre: literal de envelope/versión, IDs exactos, salario apagado por defecto
 * + paridad con opt-in explícito, scope fail-closed, filtrado por proyecto
 * activo, IDs/números malformados, duplicados (identidad SA y número
 * normalizado), omisión de opcionales, allowlist sin extras y no-mutación.
 * El legacy buildMiniExportPayload se fija (default incluye sueldo) para
 * garantizar que esta unidad no cambia su comportamiento.
 */

import {
    SA_MINI_ROSTER_SCHEMA,
    SA_MINI_ROSTER_VERSION,
    SaMiniRosterExportError,
    normalizeRosterNumber,
    normalizeSaMiniId,
    resolveSaMiniRosterScope,
    selectSaMiniRosterEmployees,
    buildSaMiniRosterPayload,
    buildSaMiniRosterJson
} from '../modules/features/export/SaMiniRosterExport.js';
import { buildMiniExportPayload } from '../modules/features/export/ExportMenuService.js';

const PRJ_A = 'PRJ-A-000000';
const PRJ_B = 'PRJ-B-000000';
const PRJ_DEFAULT = 'PRJ-DEFAULT-0000';

function scopeA() {
    return { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
}

function basePositions() {
    return [
        { id: 'pos-1', name: 'Oficial Albañil', hourlyRate: 312.5 },
        { id: 'pos-2', name: 'Ayudante', hourlyRate: 225 }
    ];
}

function baseSettings() {
    return { regularHoursPerDay: 8 };
}

function emp(overrides = {}) {
    return {
        id: 'e-1',
        number: '1',
        name: 'Ana García',
        positions: ['pos-1'],
        active: true,
        projectId: PRJ_A,
        ...overrides
    };
}

/** Espera que fn lance SaMiniRosterExportError (opcionalmente con ese code). */
function expectRosterError(fn, code, why) {
    let error = null;
    try {
        fn();
    } catch (e) {
        error = e;
    }
    testRunner.assert(!!error, `${why}: debía lanzar (fail-closed)`);
    testRunner.assert(
        error instanceof SaMiniRosterExportError,
        `${why}: debía ser SaMiniRosterExportError, fue ${error && error.name}`
    );
    if (code) {
        testRunner.assertEquals(error.code, code, `${why}: code esperado ${code}`);
    }
}

testRunner.addSuite("SaMiniRosterExport — envelope e identidad", {

    "envelope: literales exactos schema/version + saProjectId + generatedAt"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp()],
            positions: basePositions(),
            settings: baseSettings(),
            generatedAt: '2026-09-07T00:00:00.000Z'
        });

        testRunner.assertEquals(payload.schema, 'sa-roster/v1', "schema literal");
        testRunner.assertEquals(payload.schema, SA_MINI_ROSTER_SCHEMA, "constante de schema");
        testRunner.assertEquals(payload.version, 1, "version literal");
        testRunner.assertEquals(payload.version, SA_MINI_ROSTER_VERSION, "constante de versión");
        testRunner.assertEquals(payload.saProjectId, PRJ_A, "saProjectId exacto");
        testRunner.assertEquals(payload.generatedAt, '2026-09-07T00:00:00.000Z', "generatedAt explícito");
        testRunner.assert(Array.isArray(payload.employees), "employees es arreglo");
        testRunner.assertEquals(payload.employees.length, 1, "1 fila");
    },

    "generatedAt: por defecto se genera ISO sin pedirlo"() {
        const payload = buildSaMiniRosterPayload({ saProjectId: PRJ_A, employees: [] });
        testRunner.assertEquals(typeof payload.generatedAt, 'string', "generatedAt es string");
        testRunner.assert(
            new Date(payload.generatedAt).toISOString() === payload.generatedAt,
            "generatedAt por defecto es ISO-8601"
        );
        testRunner.assertEquals(payload.employees.length, 0, "envelope vacío válido");
    },

    "identidad: saEmployeeId es el id exacto (trim), number/name strings no vacíos"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ id: '  EMP-42  ', number: '7', name: '  Juan  ' })],
            positions: [],
            settings: {}
        });
        const row = payload.employees[0];
        testRunner.assertEquals(row.saEmployeeId, 'EMP-42', "id exacto tras trim");
        testRunner.assertEquals(row.number, '7', "number string no vacío");
        testRunner.assertEquals(row.name, 'Juan', "name recortado no vacío");
    },

    "tupla: cada fila conserva su propia identidad SA (number no es identidad)"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ id: 'e-1', number: '1' }), emp({ id: 'e-2', number: '2', name: 'Luis' })],
            positions: [],
            settings: {}
        });
        testRunner.assertEquals(payload.employees[0].saEmployeeId, 'e-1', "primera identidad");
        testRunner.assertEquals(payload.employees[1].saEmployeeId, 'e-2', "segunda identidad");
    },

    "saProjectId ausente o vacío: falla cerrado"() {
        expectRosterError(
            () => buildSaMiniRosterPayload({ employees: [] }),
            'bad-sa-project-id',
            "sin saProjectId"
        );
        expectRosterError(
            () => buildSaMiniRosterPayload({ saProjectId: '   ', employees: [] }),
            'bad-sa-project-id',
            "saProjectId en blanco"
        );
    },

    "no muta las entradas (sólo lectura)"() {
        const employees = [emp()];
        const positions = basePositions();
        const before = JSON.stringify({ employees, positions });
        buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees,
            positions,
            settings: baseSettings(),
            includeSalary: true
        });
        testRunner.assertEquals(
            JSON.stringify({ employees, positions }),
            before,
            "empleados y puestos intactos tras exportar"
        );
    }
});

testRunner.addSuite("SaMiniRosterExport — privacidad salarial", {

    "por defecto (sin opt-in) se omite sueldo"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp()],
            positions: basePositions(),
            settings: baseSettings()
        });
        testRunner.assertEquals(payload.employees[0].sueldo, undefined, "sueldo omitido por defecto");
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(payload.employees[0], 'sueldo'),
            "clave sueldo ausente, no undefined explícito"
        );
    },

    "includeSalary=false o truthy-no-true también omite (sólo === true incluye)"() {
        for (const includeSalary of [false, 0, 1, 'yes', null]) {
            const payload = buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [emp()],
                positions: basePositions(),
                settings: baseSettings(),
                includeSalary
            });
            testRunner.assertEquals(
                payload.employees[0].sueldo,
                undefined,
                `sueldo omitido con includeSalary=${String(includeSalary)}`
            );
        }
    },

    "opt-in explícito: paridad exacta con el legacy fila por fila"() {
        const employees = [
            emp({ id: 'e-1', number: '1', positions: ['pos-1'] }),
            emp({ id: 'e-2', number: '2', name: 'Carlos', positions: ['pos-2'], active: false }),
            emp({ id: 'e-3', number: '3', name: 'Pedro', positions: ['pos-1'], positionSalaries: { 'pos-1': 500 } })
        ];
        const positions = basePositions();
        const settings = baseSettings();

        const v1 = buildSaMiniRosterPayload({
            saProjectId: PRJ_A, employees, positions, settings, includeSalary: true
        });
        const legacy = buildMiniExportPayload(employees, positions, settings, { includeSalary: true });

        testRunner.assertEquals(v1.employees.length, legacy.length, "mismas filas");
        v1.employees.forEach((row, i) => {
            testRunner.assertEquals(row.sueldo, legacy[i].sueldo, `paridad de sueldo fila ${i}`);
        });
        testRunner.assertEquals(v1.employees[0].sueldo, '2500', "312.5 * 8 = 2500");
    },

    "legacy intacto: su default sigue incluyendo sueldo (no lo cambiamos)"() {
        const legacy = buildMiniExportPayload([emp()], basePositions(), baseSettings());
        testRunner.assertEquals(legacy[0].sueldo, '2500', "legacy default con sueldo");
    }
});

testRunner.addSuite("SaMiniRosterExport — scope fail-closed y filtrado", {

    "resolve: scope válido devuelve el projectId exacto"() {
        testRunner.assertEquals(resolveSaMiniRosterScope(scopeA()), PRJ_A, "saProjectId = scope.projectId");
    },

    "resolve: falla sin Proyectos ON o sin proyecto/default (y no copia nada)"() {
        const bad = [
            ['scope nulo', null],
            ['scope no objeto', 'PRJ-A'],
            ['flag OFF', { enabled: false, projectId: null, defaultProjectId: null }],
            ['sin projectId', { enabled: true, projectId: null, defaultProjectId: PRJ_DEFAULT }],
            ['projectId vacío', { enabled: true, projectId: '  ', defaultProjectId: PRJ_DEFAULT }],
            ['sin default', { enabled: true, projectId: PRJ_A, defaultProjectId: null }]
        ];
        for (const [label, scope] of bad) {
            expectRosterError(() => resolveSaMiniRosterScope(scope), 'scope-unavailable', label);
            expectRosterError(
                () => selectSaMiniRosterEmployees([emp()], scope),
                'scope-unavailable',
                `select fail-closed con ${label}`
            );
        }
    },

    "select: sólo no-eliminados del proyecto activo exacto (sin mezclar)"() {
        const employees = [
            emp({ id: 'e-a1', number: '1', name: 'De A', projectId: PRJ_A }),
            emp({ id: 'e-b1', number: '2', name: 'De B', projectId: PRJ_B }),
            emp({ id: 'e-del', number: '3', name: 'Borrado', projectId: PRJ_A, deletedAt: Date.now() }),
            // Sin projectId ⇒ proyecto efectivo = default (≠ A activo) ⇒ fuera.
            { id: 'e-nostamp', number: '4', name: 'Sin sello', positions: [], active: true }
        ];
        const selected = selectSaMiniRosterEmployees(employees, scopeA());
        testRunner.assertEquals(selected.length, 1, "sólo 1 del proyecto A");
        testRunner.assertEquals(selected[0].id, 'e-a1', "el del proyecto activo");
    },

    "select: sin sello pertenece al default cuando el default está activo"() {
        const employees = [
            { id: 'e-nostamp', number: '4', name: 'Sin sello', positions: [], active: true }
        ];
        const scopeDefault = { enabled: true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT };
        const selected = selectSaMiniRosterEmployees(employees, scopeDefault);
        testRunner.assertEquals(selected.length, 1, "sin sello entra con default activo");
    }
});

testRunner.addSuite("SaMiniRosterExport — validación fail-closed (sin saltar filas)", {

    "IDs malformados o ausentes: falla toda la exportación"() {
        const badIds = [
            ['id ausente', { id: undefined }],
            ['id vacío', { id: '' }],
            ['id en blanco', { id: '   ' }],
            ['id no string', { id: 12345 }]
        ];
        for (const [label, override] of badIds) {
            expectRosterError(
                () => buildSaMiniRosterPayload({
                    saProjectId: PRJ_A,
                    employees: [emp(), emp({ id: 'e-2', number: '2', name: 'Luis', ...override })],
                    positions: []
                }),
                'bad-employee-id',
                label
            );
        }
    },

    "números malformados o no finitos: falla toda la exportación"() {
        // Paridad Mini: sólo se rechaza null/undefined/vacío-recortado y lo
        // no convertible a finito (Number.isFinite). '1.5' y '-3' SÍ son
        // válidos (finitos) y por eso no están en esta lista.
        const badNumbers = ['', '   ', 'ABC', '1A', 'A1', 'Infinity', '-Infinity', 'NaN', null, undefined];
        for (const number of badNumbers) {
            expectRosterError(
                () => buildSaMiniRosterPayload({
                    saProjectId: PRJ_A,
                    employees: [emp({ number })],
                    positions: []
                }),
                'bad-number',
                `number=${String(number)}`
            );
        }
    },

    "números finitos coercibles: válidos y se emite el texto recortado original"() {
        const cases = [
            ['entero con ceros', '001', '001'],
            ['con espacios', '  42  ', '42'],
            ['decimal finito', '1.5', '1.5'],
            ['negativo finito', '-3', '-3'],
            ['exponencial', '1e2', '1e2'],
            ['número JS', 7, '7']
        ];
        for (const [label, input, emitted] of cases) {
            const payload = buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [emp({ number: input })],
                positions: []
            });
            testRunner.assertEquals(payload.employees[0].number, emitted, `${label}: se preserva texto recortado`);
        }
    },

    "nombre vacío: falla toda la exportación"() {
        expectRosterError(
            () => buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [emp({ name: '   ' })],
                positions: []
            }),
            'bad-name',
            "nombre en blanco"
        );
    },

    "identidades SA duplicadas: falla (el number no rescata la identidad)"() {
        expectRosterError(
            () => buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [
                    emp({ id: 'dup', number: '1' }),
                    emp({ id: 'dup', number: '2', name: 'Otro' })
                ],
                positions: []
            }),
            'duplicate-employee-id',
            "mismo id con distinto number"
        );
    },

    "colisiones de número normalizado: falla (exactas y con ceros/espacios)"() {
        const cases = [
            ['duplicado exacto', '5', '5'],
            ['ceros a la izquierda (01 vs 1)', '01', '1'],
            ['ceros clásicos', '001', '1'],
            ['espacios', ' 2 ', '2'],
            ['decimal equivalente (1.0 vs 1)', '1.0', '1'],
            ['exponencial equivalente (1e2 vs 100)', '1e2', '100'],
            ['redondeo de grandes enteros', '9007199254740992', '9007199254740993']
        ];
        for (const [label, first, second] of cases) {
            expectRosterError(
                () => buildSaMiniRosterPayload({
                    saProjectId: PRJ_A,
                    employees: [
                        emp({ id: 'e-1', number: first }),
                        emp({ id: 'e-2', number: second, name: 'Luis' })
                    ],
                    positions: []
                }),
                'duplicate-number',
                label
            );
        }
    },

    "números distintos no colisionan (A/B: 1 vs 2 exporta bien)"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [
                emp({ id: 'e-1', number: '1' }),
                emp({ id: 'e-2', number: '2', name: 'Luis' })
            ],
            positions: []
        });
        testRunner.assertEquals(payload.employees.length, 2, "dos fichas distintas no colisionan");
        testRunner.assertEquals(payload.employees[0].number, '1', "se preserva '1'");
        testRunner.assertEquals(payload.employees[1].number, '2', "se preserva '2'");
    },

    "normalizeRosterNumber: paridad Mini con Number()"() {
        testRunner.assertEquals(normalizeRosterNumber('001'), 1, "001 → 1 (Number)");
        testRunner.assertEquals(normalizeRosterNumber('01'), 1, "01 → 1 (Number)");
        testRunner.assertEquals(normalizeRosterNumber(' 2 '), 2, "espacios fuera (Number)");
        testRunner.assertEquals(normalizeRosterNumber('10'), 10, "10 intacto");
        testRunner.assertEquals(normalizeRosterNumber('1.0'), 1, "1.0 → 1");
        testRunner.assertEquals(normalizeRosterNumber('1e2'), 100, "1e2 → 100");
        for (const bad of ['', '   ', 'ABC', 'Infinity', 'NaN', null, undefined]) {
            testRunner.assert(
                !Number.isFinite(normalizeRosterNumber(bad)),
                `normalizeRosterNumber(${String(bad)}) no es finito`
            );
        }
    },
});

testRunner.addSuite("SaMiniRosterExport — opcionales y allowlist", {

    "position: se omite si no hay, es desconocida o está vacía"() {
        const noPos = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ positions: [] })],
            positions: basePositions()
        });
        testRunner.assertEquals(noPos.employees[0].position, undefined, "sin puestos ⇒ omitida");

        const unknown = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ positions: ['pos-fantasma'] })],
            positions: basePositions()
        });
        testRunner.assertEquals(unknown.employees[0].position, undefined, "puesto desconocido ⇒ omitida");

        const emptyName = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ positions: ['pos-x'] })],
            positions: [{ id: 'pos-x', name: '   ' }]
        });
        testRunner.assertEquals(emptyName.employees[0].position, undefined, "nombre vacío ⇒ omitida");

        const ok = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp()],
            positions: basePositions()
        });
        testRunner.assertEquals(ok.employees[0].position, 'Oficial Albañil', "nombre válido presente");
    },

    "paused: sólo true cuando active === false (nunca false)"() {
        const active = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ active: true })],
            positions: []
        });
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(active.employees[0], 'paused'),
            "activo ⇒ sin clave paused"
        );

        const noFlag = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ active: undefined })],
            positions: []
        });
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(noFlag.employees[0], 'paused'),
            "sin flag ⇒ sin clave paused"
        );

        const paused = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ active: false })],
            positions: []
        });
        testRunner.assertEquals(paused.employees[0].paused, true, "inactivo ⇒ paused:true");
    },

    "allowlist: sin extras económicos/privados aunque el empleado los traiga"() {
        const loaded = emp({
            loans: [{ id: 'l-1', amount: 999 }],
            advances: [{ id: 'a-1', amount: 111 }],
            photo: { state: 'ready', revision: 'r:1', updatedAt: 1 },
            customSalary: 12345,
            positionSalaries: { 'pos-1': 777 },
            deletedAt: null,
            phone: '555',
            email: 'a@b.c'
        });
        // NOTE: deletedAt null ⇒ no eliminado; el resto debe filtrarse.
        delete loaded.deletedAt;
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [loaded],
            positions: basePositions(),
            settings: baseSettings(),
            includeSalary: true
        });
        const row = payload.employees[0];
        const rowKeys = Object.keys(row).sort();
        testRunner.assertEquals(
            JSON.stringify(rowKeys),
            JSON.stringify(['name', 'number', 'position', 'saEmployeeId', 'sueldo'].sort()),
            "fila sólo con claves permitidas"
        );
        const json = JSON.stringify(payload);
        for (const banned of ['loans', 'advances', 'photo', 'customSalary', 'positionSalaries', 'deletedAt', 'phone', 'email']) {
            testRunner.assert(!json.includes(`"${banned}"`), `sin fuga de "${banned}"`);
        }
    },

    "envelope: sólo claves del contrato"() {
        const payload = buildSaMiniRosterPayload({ saProjectId: PRJ_A, employees: [] });
        testRunner.assertEquals(
            JSON.stringify(Object.keys(payload).sort()),
            JSON.stringify(['employees', 'generatedAt', 'saProjectId', 'schema', 'version'].sort()),
            "envelope exacto"
        );
    },

    "buildSaMiniRosterJson: texto pretty compatible con el consumidor"() {
        const json = buildSaMiniRosterJson({
            saProjectId: PRJ_A,
            employees: [emp()],
            positions: basePositions(),
            settings: {},
            generatedAt: '2026-09-07T00:00:00.000Z'
        });
        testRunner.assert(json.includes('\n'), "legible (pretty)");
        const parsed = JSON.parse(json);
        testRunner.assertEquals(parsed.schema, 'sa-roster/v1', "re-parsea al contrato");
        testRunner.assertEquals(parsed.employees[0].saEmployeeId, 'e-1', "fila intacta");
    }
});

testRunner.addSuite("SaMiniRosterExport — normalizador compartido de IDs", {

    "normalizeSaMiniId: trim para emisión"() {
        testRunner.assertEquals(normalizeSaMiniId('  EMP-42  '), 'EMP-42', "trim");
        testRunner.assertEquals(normalizeSaMiniId(PRJ_A), PRJ_A, "id válido intacto");
    },

    "normalizeSaMiniId: rechaza vacío, largo >128 y blancos/controles internos"() {
        for (const bad of ['', '   ', null, undefined, 12345]) {
            testRunner.assertEquals(normalizeSaMiniId(bad), '', `rechaza ${String(bad)}`);
        }
        testRunner.assertEquals(normalizeSaMiniId('a'.repeat(129)), '', "rechaza >128");
        testRunner.assertEquals(normalizeSaMiniId('a'.repeat(128)).length, 128, "acepta 128");
        for (const bad of ['con espacio', 'con\ttab', 'con\nsalto', 'con\x00nulo', 'con\x7Fdel']) {
            testRunner.assertEquals(normalizeSaMiniId(bad), '', `rechaza interno ${JSON.stringify(bad)}`);
        }
    },

    "saEmployeeId: falla con blancos internos, controles o >128"() {
        for (const [label, id] of [
            ['blanco interno', 'EMP 42'],
            ['tab interno', 'EMP\t42'],
            ['control interno', 'EMP\x0142'],
            ['muy largo', 'e'.repeat(129)]
        ]) {
            expectRosterError(
                () => buildSaMiniRosterPayload({
                    saProjectId: PRJ_A,
                    employees: [emp({ id })],
                    positions: []
                }),
                'bad-employee-id',
                label
            );
        }
    },

    "saProjectId: trim para emisión y falla con blancos internos o >128"() {
        const payload = buildSaMiniRosterPayload({
            saProjectId: `  ${PRJ_A}  `,
            employees: [],
            positions: []
        });
        testRunner.assertEquals(payload.saProjectId, PRJ_A, "saProjectId recortado en emisión");
        for (const [label, saProjectId] of [
            ['blanco interno', 'PRJ A'],
            ['muy largo', 'p'.repeat(129)]
        ]) {
            expectRosterError(
                () => buildSaMiniRosterPayload({ saProjectId, employees: [] }),
                'bad-sa-project-id',
                label
            );
        }
    },

    "duplicados de ID usan el valor normalizado (trim)"() {
        expectRosterError(
            () => buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [
                    emp({ id: '  dup  ', number: '1' }),
                    emp({ id: 'dup', number: '2', name: 'Otro' })
                ],
                positions: []
            }),
            'duplicate-employee-id',
            "mismo id tras trim"
        );
    }
});

testRunner.addSuite("SaMiniRosterExport — fugas entre proyectos (A/B con scope)", {

    "A: puesto del proyecto activo se emite (nombre + sueldo con opt-in)"() {
        const scope = scopeA();
        const positions = [
            { id: 'pos-a', name: 'Oficial A', hourlyRate: 312.5, projectId: PRJ_A },
            { id: 'pos-b', name: 'Oficial B', hourlyRate: 999, projectId: PRJ_B }
        ];
        const payload = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ positions: ['pos-a'] })],
            positions,
            settings: baseSettings(),
            includeSalary: true,
            scope
        });
        testRunner.assertEquals(payload.employees[0].position, 'Oficial A', "nombre del proyecto activo");
        testRunner.assertEquals(payload.employees[0].sueldo, '2500', "sueldo del proyecto activo (312.5*8)");
    },

    "B: puesto de otro proyecto falla cerrado (sin scope filtrado no hay fuga)"() {
        const scope = scopeA();
        const positions = [
            { id: 'pos-a', name: 'Oficial A', hourlyRate: 312.5, projectId: PRJ_A },
            { id: 'pos-b', name: 'Oficial B', hourlyRate: 999, projectId: PRJ_B }
        ];
        expectRosterError(
            () => buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [emp({ positions: ['pos-b'] })],
                positions,
                settings: baseSettings(),
                includeSalary: true,
                scope
            }),
            'cross-project-position',
            "referencia cruzada puesto→proyecto"
        );
    },

    "legacy-default: puesto sin sello pertenece al default activo (A) y falla con otro activo (B)"() {
        const scopeDefault = { enabled: true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT };
        const ok = buildSaMiniRosterPayload({
            saProjectId: PRJ_DEFAULT,
            employees: [emp({ projectId: PRJ_DEFAULT, positions: ['pos-free'] })],
            positions: [{ id: 'pos-free', name: 'Libre', hourlyRate: 100 }],
            settings: baseSettings(),
            scope: scopeDefault
        });
        testRunner.assertEquals(ok.employees[0].position, 'Libre', "sin sello entra con default activo");

        expectRosterError(
            () => buildSaMiniRosterPayload({
                saProjectId: PRJ_A,
                employees: [emp({ projectId: PRJ_A, positions: ['pos-free'] })],
                positions: [{ id: 'pos-free', name: 'Libre', hourlyRate: 100 }],
                settings: baseSettings(),
                scope: scopeA()
            }),
            'cross-project-position',
            "sin sello es del default, no de A"
        );
    },

    "desconocido se omite (legacy), cruzado falla: A/B del lookup"() {
        const scope = scopeA();
        const unknown = buildSaMiniRosterPayload({
            saProjectId: PRJ_A,
            employees: [emp({ positions: ['pos-fantasma'] })],
            positions: [{ id: 'pos-a', name: 'Oficial A', projectId: PRJ_A }],
            settings: {},
            scope
        });
        testRunner.assertEquals(unknown.employees[0].position, undefined, "desconocido ⇒ omitida, no falla");
    }
});

console.log('🧪 SaMiniRosterExport tests cargados.');
