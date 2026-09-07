/**
 * F3.1/F3.2 — Contrato congelado del fixture canónico sa-roster/v1.
 *
 * Solo lectura: valida `docs/fase-3/fixtures/sa-roster-v1.example.json`
 * contra las constantes/funciones del productor existente
 * (`SaMiniRosterExport.js`) y prueba que el productor regenera las mismas
 * filas (paridad de ida). No cambia runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    SA_MINI_ROSTER_SCHEMA,
    SA_MINI_ROSTER_VERSION,
    SA_MINI_ROSTER_ENVELOPE_KEYS,
    SA_MINI_ROSTER_ROW_KEYS,
    normalizeRosterNumber,
    normalizeSaMiniId,
    buildSaMiniRosterPayload
} from '../modules/features/export/SaMiniRosterExport.js';

const FIXTURE_PATH = path.resolve(
    __dirname,
    '../../docs/fase-3/fixtures/sa-roster-v1.example.json'
);

// Claves que nunca deben viajar en Employee v1 (privadas/económicas/F3.3).
const BANNED_ROW_KEYS = [
    'loans', 'advances', 'photo', 'customSalary', 'positionSalaries',
    'deletedAt', 'phone', 'email', 'groupId', 'leaderId', 'group', 'leader'
];

function loadFixture() {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

describe('sa-roster/v1 fixture — contrato congelado F3.1/F3.2', () => {
    test('envelope: literales y claves exactas del productor', () => {
        const fixture = loadFixture();

        expect(fixture.schema).toBe(SA_MINI_ROSTER_SCHEMA);
        expect(fixture.schema).toBe('sa-roster/v1');
        expect(fixture.version).toBe(SA_MINI_ROSTER_VERSION);
        expect(fixture.version).toBe(1);
        expect([...Object.keys(fixture)].sort()).toEqual(
            [...SA_MINI_ROSTER_ENVELOPE_KEYS].sort()
        );
        expect(normalizeSaMiniId(fixture.saProjectId)).toBe(fixture.saProjectId);
        expect(new Date(fixture.generatedAt).toISOString()).toBe(fixture.generatedAt);
        expect(Array.isArray(fixture.employees)).toBe(true);
        expect(fixture.employees.length).toBeGreaterThan(0);
    });

    test('filas: allowlist, requeridas, sin extras privados ni Group/Leader', () => {
        const fixture = loadFixture();

        for (const row of fixture.employees) {
            for (const key of Object.keys(row)) {
                expect(SA_MINI_ROSTER_ROW_KEYS).toContain(key);
            }
            for (const key of ['saEmployeeId', 'number', 'name']) {
                expect(row[key]).toBeDefined();
            }
            for (const banned of BANNED_ROW_KEYS) {
                expect(row).not.toHaveProperty(banned);
            }
            if ('paused' in row) expect(row.paused).toBe(true);
            if ('position' in row) expect(row.position.trim()).not.toBe('');
            if ('sueldo' in row) expect(typeof row.sueldo).toBe('string');
        }
        // El fixture ilustra opcionales: una fila full opt-in, una en pausa y
        // una mínima solo con requeridas.
        expect(fixture.employees.some(r => 'sueldo' in r && 'position' in r)).toBe(true);
        expect(fixture.employees.some(r => r.paused === true)).toBe(true);
        expect(
            fixture.employees.some(r => Object.keys(r).sort().join(',') === 'name,number,saEmployeeId')
        ).toBe(true);
    });

    test('identidad: (saProjectId, saEmployeeId) única; number juzgado por Number()', () => {
        const fixture = loadFixture();
        const seenIds = new Set();
        const seenNumbers = new Map();

        for (const row of fixture.employees) {
            expect(normalizeSaMiniId(row.saEmployeeId)).toBe(row.saEmployeeId);
            expect(seenIds.has(row.saEmployeeId)).toBe(false);
            seenIds.add(row.saEmployeeId);

            expect(typeof row.name === 'string' && row.name.trim()).toBeTruthy();
            const key = normalizeRosterNumber(row.number);
            expect(Number.isFinite(key)).toBe(true);
            expect(seenNumbers.has(key)).toBe(false);
            seenNumbers.set(key, row.number);
        }
    });

    test('paridad: el productor regenera las filas del fixture sin cambiar runtime', () => {
        const fixture = loadFixture();
        const scope = {
            enabled: true,
            projectId: fixture.saProjectId,
            defaultProjectId: 'PRJ-DEFAULT-0000'
        };
        const positions = [{
            id: 'pos-1',
            name: 'Oficial Albañil',
            hourlyRate: 312.5,
            projectId: fixture.saProjectId
        }];
        const employees = [
            {
                id: 'EMP-001', number: '1', name: 'Ana García',
                positions: ['pos-1'], active: true, projectId: fixture.saProjectId
            },
            {
                id: 'EMP-002', number: '2', name: 'Luis Pérez',
                positions: [], active: false, projectId: fixture.saProjectId
            },
            {
                id: 'EMP-003', number: '3', name: 'María López',
                positions: [], active: true, projectId: fixture.saProjectId
            }
        ];

        const payload = buildSaMiniRosterPayload({
            saProjectId: fixture.saProjectId,
            employees,
            positions,
            settings: { regularHoursPerDay: 8 },
            includeSalary: true,
            generatedAt: fixture.generatedAt,
            scope
        });

        expect(payload.employees).toEqual(fixture.employees);
        expect(JSON.parse(JSON.stringify(payload)).employees).toEqual(fixture.employees);
    });
});
