/**
 * 🧾 SaMiniRosterExport — Productor paralelo del roster SA→Mini v1 (F3.5).
 *
 * Contrato direccional (sólo lectura, sin migración, sin Firebase):
 *   envelope: { schema: "sa-roster/v1", version: 1, saProjectId, generatedAt?, employees: [...] }
 *   fila:     { saEmployeeId, number, name, position?, sueldo?, paused? } (sólo campos allowlist)
 *
 * Reglas:
 * - Identidad autoritativa: tupla (saProjectId, saEmployeeId). `number` NUNCA es identidad.
 * - saEmployeeId = employee.id exacto tras trim/validación. number/name no vacíos.
 * - Fail-closed de toda la exportación ante: IDs malformados/ausentes, números
 *   malformados/no numéricos, identidades SA duplicadas o colisiones de número
 *   normalizado. Nunca se salta filas: o todo el envelope es válido o se lanza.
 * - Alcance: sólo empleados no eliminados del proyecto activo (ver
 *   resolveSaMiniRosterScope / selectSaMiniRosterEmployees). Este módulo NUNCA
 *   llama a ensureDefaultProject ni lee localStorage: recibe el scope ya
 *   resuelto vía getEntityScope() desde el controller.
 * - Privacidad salarial: includeSalary=false por defecto. Con opt-in explícito
 *   (=== true) el `sueldo` se deriva REUTILIZANDO buildMiniExportPayload
 *   (lógica salarial vigente, sin matemática nueva) para garantizar paridad.
 * - Semántica Mini de opcionales: se omite position si no hay/está vacía;
 *   paused:true sólo cuando active === false (nunca se emite false);
 *   sueldo sólo con opt-in. Se prefiere omisión sobre null/undefined.
 * - Nunca se emiten préstamos, adelantos, fotos, customSalary,
 *   positionSalaries, deletedAt ni ningún extra económico/privado: cada fila
 *   se construye campo por campo desde la allowlist.
 *
 * El legacy buildMiniExportPayload queda intacto (compatibilidad hacia atrás).
 */

import { buildMiniExportPayload } from './ExportMenuService.js';
import { entityInScope, effectiveProjectId } from '../projects/ProjectContext.js';

export const SA_MINI_ROSTER_SCHEMA = 'sa-roster/v1';
export const SA_MINI_ROSTER_VERSION = 1;

export const SA_MINI_ROSTER_ENVELOPE_KEYS = Object.freeze([
    'schema',
    'version',
    'saProjectId',
    'generatedAt',
    'employees'
]);

export const SA_MINI_ROSTER_ROW_KEYS = Object.freeze([
    'saEmployeeId',
    'number',
    'name',
    'position',
    'sueldo',
    'paused'
]);

const REQUIRED_ROW_KEYS = Object.freeze(['saEmployeeId', 'number', 'name']);

/** Error fail-closed del export v1. `code` permite aserciones en tests. */
export class SaMiniRosterExportError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SaMiniRosterExportError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new SaMiniRosterExportError(code, message);
}

/**
 * Normaliza un número de ficha a su clave canónica Mini:
 * Number(texto recortado). La emisión conserva el texto recortado original;
 * la validez y las colisiones se juzgan sobre esta clave numérica para
 * paridad exacta con Mini (01 vs 1, "1.0" vs 1, "1e2" vs 100, colisiones
 * por redondeo de grandes enteros). Devuelve NaN ante null/undefined,
 * vacío/recortado-vacío o no-finito (Infinity, NaN, no numérico).
 */
export function normalizeRosterNumber(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value !== 'string' && typeof value !== 'number') return NaN;
    const text = String(value).trim();
    if (!text) return NaN;
    return Number(text);
}

/**
 * Normalizador compartido de identificadores SA→Mini (saProjectId y
 * saEmployeeId). Regla Mini: string, trim no vacío, máx 128 caracteres,
 * sin blancos internos ni caracteres de control. Devuelve el ID recortado
 * para emisión, o '' si es inválido (el llamador falla con su code
 * específico: bad-sa-project-id / bad-employee-id). Los duplicados se
 * juzgan sobre este valor normalizado.
 */
export const SA_MINI_ID_MAX_LENGTH = 128;

const SA_MINI_ID_FORBIDDEN_RE = /[\s\x00-\x1F\x7F]/;

export function normalizeSaMiniId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length > SA_MINI_ID_MAX_LENGTH) return '';
    if (SA_MINI_ID_FORBIDDEN_RE.test(trimmed)) return '';
    return trimmed;
}

/**
 * Valida el scope ya resuelto por getEntityScope(). No resuelve nada por sí
 * mismo: si Proyectos está OFF o falta el proyecto activo/default, falla con
 * un mensaje accionable y no se copia nada.
 *
 * @param {object} scope - resultado de getEntityScope()
 * @returns {string} saProjectId exacto (scope.projectId)
 */
export function resolveSaMiniRosterScope(scope) {
    if (!scope || typeof scope !== 'object') {
        fail(
            'scope-unavailable',
            'Activa Proyectos y selecciona un proyecto para exportar el roster SA→Mini (MINI v1). Sin proyecto activo no se copió nada.'
        );
    }
    if (scope.enabled !== true) {
        fail(
            'scope-unavailable',
            'Activa Proyectos y selecciona un proyecto para exportar el roster SA→Mini (MINI v1). Sin proyecto activo no se copió nada.'
        );
    }
    const projectId = normalizeSaMiniId(scope.projectId);
    if (!projectId) {
        fail(
            'scope-unavailable',
            'Selecciona un proyecto activo para exportar el roster SA→Mini (MINI v1). Sin proyecto activo no se copió nada.'
        );
    }
    const defaultProjectId = normalizeSaMiniId(scope.defaultProjectId);
    if (!defaultProjectId) {
        fail(
            'scope-unavailable',
            'No se pudo resolver el proyecto de referencia. Reabre la app y selecciona un proyecto antes de exportar (MINI v1). No se copió nada.'
        );
    }
    return projectId;
}

/**
 * Filtra empleados al alcance v1: no eliminados, dentro del scope y cuyo
 * proyecto efectivo es exactamente el saProjectId seleccionado. Nunca mezcla
 * proyectos. Sólo lectura: devuelve un arreglo nuevo sin mutar nada.
 *
 * @param {Array<object>} employees
 * @param {object} scope - scope ya resuelto (se valida con resolveSaMiniRosterScope)
 * @returns {Array<object>}
 */
export function selectSaMiniRosterEmployees(employees, scope) {
    const saProjectId = resolveSaMiniRosterScope(scope);
    return (employees || [])
        .filter(emp => !!emp && !emp.deletedAt)
        .filter(emp => entityInScope(emp, scope) && effectiveProjectId(emp, scope) === saProjectId);
}

function findPositionName(employee, positions) {
    const posId = Array.isArray(employee.positions) && employee.positions.length
        ? employee.positions[0]
        : null;
    if (!posId) return '';
    const pos = (positions || []).find(p => p && p.id === posId);
    return pos && typeof pos.name === 'string' ? pos.name.trim() : '';
}

/**
 * Filtra puestos al proyecto activo capturado. Sin scope (o scope no
 * habilitado) devuelve los puestos tal cual (compatibilidad hacia atrás
 * para llamadas directas sin scope). Con scope habilitado, sólo conserva
 * los puestos cuyo proyecto efectivo es exactamente saProjectId, de modo
 * que ni el nombre ni el sueldo puedan filtrarse desde otro proyecto.
 * Respeta la semántica legacy-default: projectId ausente ⇒ default.
 */
function scopeSaMiniPositions(positions, scope, saProjectId) {
    if (!scope || scope.enabled !== true || !saProjectId) return positions || [];
    return (positions || []).filter(
        pos => !!pos && effectiveProjectId(pos, scope) === saProjectId
    );
}

/**
 * Fail-closed ante referencia cruzada: si un empleado en alcance referencia
 * un puesto que existe pero cuyo proyecto efectivo NO es el activo, aborta
 * toda la exportación antes del portapapeles. Puesto desconocido (id no
 * encontrado) mantiene el legacy: se omite, no falla.
 */
function assertNoCrossProjectPosition(employee, positions, scopedPositions, scope, saProjectId, index, saEmployeeId) {
    const posId = Array.isArray(employee.positions) && employee.positions.length
        ? employee.positions[0]
        : null;
    if (!posId) return;
    if (!scope || scope.enabled !== true) return;
    const inScoped = (scopedPositions || []).some(p => p && p.id === posId);
    if (inScoped) return;
    const raw = (positions || []).find(p => p && p.id === posId);
    if (!raw) return; // desconocido ⇒ omitir (legacy)
    const effective = effectiveProjectId(raw, scope);
    if (effective !== saProjectId) {
        fail(
            'cross-project-position',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") referencia el puesto "${posId}" del proyecto "${effective ?? 'desconocido'}", fuera del proyecto activo "${saProjectId}". Corrige el puesto y reintenta; no se copió nada.`
        );
    }
}

/**
 * Deriva el sueldo diario REUTILIZANDO la lógica salarial vigente del legacy
 * (buildMiniExportPayload): misma prioridad positionSalaries → customSalary →
 * hourlyRate → salaryConfig legacy, mismo redondeo. Sin matemática nueva.
 *
 * @returns {string|undefined} sueldo como string, o undefined si no hay tasa válida
 */
function deriveSueldoViaLegacy(employee, positions, settings) {
    const legacyRow = buildMiniExportPayload([employee], positions, settings, { includeSalary: true })[0];
    const sueldo = legacyRow ? legacyRow.sueldo : undefined;
    return typeof sueldo === 'string' && sueldo.trim() ? sueldo : undefined;
}

function validateRowIdentity(employee, index, seenIds, seenNumbers) {
    const saEmployeeId = normalizeSaMiniId(employee.id);
    if (!saEmployeeId) {
        fail(
            'bad-employee-id',
            `MINI v1: la fila ${index + 1} no tiene un identificador de empleado válido (string no vacío, máx 128, sin blancos ni controles). Corrige el registro y reintenta; no se copió nada.`
        );
    }
    if (seenIds.has(saEmployeeId)) {
        fail(
            'duplicate-employee-id',
            `MINI v1: el identificador "${saEmployeeId}" está duplicado. La identidad SA→Mini debe ser única por (proyecto, empleado); no se copió nada.`
        );
    }
    seenIds.add(saEmployeeId);

    const rawNumber = employee.number;
    if (rawNumber === null || rawNumber === undefined) {
        fail(
            'bad-number',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") tiene un número de ficha inválido (nulo o ausente). Debe ser convertible a número finito y no vacío; no se copió nada.`
        );
    }
    if (typeof rawNumber !== 'string' && typeof rawNumber !== 'number') {
        fail(
            'bad-number',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") tiene un número de ficha inválido. Debe ser texto o número convertible a finito; no se copió nada.`
        );
    }
    const number = String(rawNumber).trim();
    if (!number) {
        fail(
            'bad-number',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") tiene un número de ficha vacío. Debe ser no vacío y finito; no se copió nada.`
        );
    }
    const normalized = normalizeRosterNumber(number);
    if (!Number.isFinite(normalized)) {
        fail(
            'bad-number',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") tiene un número de ficha inválido ("${number}"). Debe ser convertible a número finito (Number); no se copió nada.`
        );
    }
    if (seenNumbers.has(normalized)) {
        fail(
            'duplicate-number',
            `MINI v1: el número de ficha "${number}" colisiona con "${seenNumbers.get(normalized)}" (misma clave Number(${String(normalized)})). Resuelve el duplicado y reintenta; no se copió nada.`
        );
    }
    seenNumbers.set(normalized, number);

    const name = typeof employee.name === 'string' ? employee.name.trim() : '';
    if (!name) {
        fail(
            'bad-name',
            `MINI v1: la fila ${index + 1} ("${saEmployeeId}") no tiene nombre. Debe ser un texto no vacío; no se copió nada.`
        );
    }

    return { saEmployeeId, number, name };
}

/**
 * Construye el envelope sa-roster/v1. Puro y de sólo lectura: no muta
 * empleados, puestos, settings ni storage. Lanza SaMiniRosterExportError ante
 * cualquier fila inválida (fail-closed de toda la exportación).
 *
 * Paridad Mini:
 * - number: se rechaza null/undefined/vacío; clave canónica Number(texto).
 *   La emisión conserva el texto recortado original.
 * - IDs: trim para emisión, máx 128, sin blancos internos ni controles.
 * - generatedAt: se conserva (Mini lo permite y lo valida como ISO-8601).
 * - positions: con `scope` capturado se filtran al proyecto activo y toda
 *   referencia cruzada falla cerrada antes del portapapeles.
 *
 * @param {object} args
 * @param {string} args.saProjectId - scope.projectId exacto (requerido)
 * @param {Array<object>} [args.employees] - ya filtrados al proyecto activo
 * @param {Array<object>} [args.positions]
 * @param {object} [args.settings]
 * @param {boolean} [args.includeSalary=false] - sólo === true incluye sueldo
 * @param {string} [args.generatedAt] - ISO; por defecto ahora mismo
 * @param {object} [args.scope] - scope capturado (getEntityScope) para filtrar puestos
 * @returns {{schema:string, version:number, saProjectId:string, generatedAt:string, employees:Array<object>}}
 */
export function buildSaMiniRosterPayload({
    saProjectId,
    employees = [],
    positions = [],
    settings = {},
    includeSalary = false,
    generatedAt,
    scope = null
} = {}) {
    const normalizedProjectId = normalizeSaMiniId(saProjectId);
    if (!normalizedProjectId) {
        fail(
            'bad-sa-project-id',
            'MINI v1: el proyecto activo (saProjectId) es inválido (string no vacío, máx 128, sin blancos ni controles). Selecciona un proyecto y reintenta; no se copió nada.'
        );
    }
    saProjectId = normalizedProjectId;

    let stamp;
    if (generatedAt === undefined) {
        stamp = new Date().toISOString();
    } else if (typeof generatedAt === 'string' && generatedAt.trim()) {
        stamp = generatedAt.trim();
    } else {
        fail(
            'bad-generated-at',
            'MINI v1: la fecha de generación es inválida; no se copió nada.'
        );
    }

    // Opt-in salarial explícito: sólo `true` estricto incluye sueldo.
    const withSalary = includeSalary === true;

    // PASADA 1 — validación total + duplicados ANTES de construir nada.
    const seenIds = new Set();
    const seenNumbers = new Map();
    const validated = (employees || []).map((employee, index) => {
        if (!employee || typeof employee !== 'object') {
            fail(
                'bad-employee',
                `MINI v1: la fila ${index + 1} no es un registro de empleado válido; no se copió nada.`
            );
        }
        if (employee.deletedAt) return null; // defensa en profundidad (el scope ya filtra)
        return {
            employee,
            ...validateRowIdentity(employee, index, seenIds, seenNumbers)
        };
    }).filter(Boolean);

    // Puestos al alcance capturado: evita fuga entre proyectos tanto en
    // nombre como en sueldo derivado. Sin scope ⇒ legacy (sin filtrar).
    const scopedPositions = scopeSaMiniPositions(positions, scope, saProjectId);

    // PASADA 1b — referencias cruzadas puesto→proyecto ANTES de construir.
    validated.forEach(({ employee }, idx) => {
        const originalIndex = (employees || []).indexOf(employee);
        const saEmployeeId = normalizeSaMiniId(employee.id) || String(employee.id ?? '').trim();
        assertNoCrossProjectPosition(
            employee, positions, scopedPositions, scope, saProjectId,
            originalIndex >= 0 ? originalIndex : idx, saEmployeeId
        );
    });

    // PASADA 2 — construcción campo por campo (sólo allowlist, sin extras).
    const rows = validated.map(({ employee, saEmployeeId, number, name }) => {
        const row = { saEmployeeId, number, name };

        const position = findPositionName(employee, scopedPositions);
        if (position) row.position = position;

        if (withSalary) {
            const sueldo = deriveSueldoViaLegacy(employee, scopedPositions, settings);
            if (sueldo) row.sueldo = sueldo;
        }

        if (employee.active === false) row.paused = true;

        return row;
    });

    return {
        schema: SA_MINI_ROSTER_SCHEMA,
        version: SA_MINI_ROSTER_VERSION,
        saProjectId,
        generatedAt: stamp,
        employees: rows
    };
}

/** Atajo: envelope v1 serializado como JSON legible para el portapapeles. */
export function buildSaMiniRosterJson(args) {
    return JSON.stringify(buildSaMiniRosterPayload(args), null, 2);
}
