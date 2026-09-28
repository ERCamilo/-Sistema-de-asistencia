/**
 * scripts/check-firestore-indexes.cjs: compara firestore.indexes.json con el
 * listado de solo lectura del proyecto (firebase CLI o gcloud) sin desplegar.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const check = require('../../scripts/check-firestore-indexes.cjs');

const REPO = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8'));

function run(deployed) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-'));
    const file = path.join(dir, 'deployed.json');
    fs.writeFileSync(file, JSON.stringify(deployed));
    const lines = [];
    const out = { log: line => lines.push(line), error: line => lines.push('ERR ' + line) };
    const code = check.main(['--deployed', file], out);
    fs.rmSync(dir, { recursive: true, force: true });
    return { code, lines };
}

// Forma de gcloud: nombre completo, __name__ explícito y estado de construcción.
function asGcloud(index, state = 'READY') {
    return {
        name: `projects/p/databases/(default)/collectionGroups/${index.collectionGroup}/indexes/x${Math.random()}`,
        queryScope: index.queryScope,
        state,
        fields: index.fields
    };
}

describe('verificación de índices desplegados', () => {
    test('el archivo del repositorio es válido y cubre el historial paginado por obra', () => {
        const lines = [];
        expect(check.main([], { log: l => lines.push(l), error: l => lines.push(l) })).toBe(0);
        expect(check.validateRepoIndexes(REPO.indexes)).toEqual([]);
        const keys = REPO.indexes.map(check.indexKey);
        expect(keys).toContain(check.indexKey({
            collectionGroup: 'payrollClosures', queryScope: 'COLLECTION',
            fields: [{ fieldPath: 'projectId', order: 'ASCENDING' }, { fieldPath: 'closedAt', order: 'DESCENDING' }]
        }));
    });

    test('todo desplegado (firebase CLI, sin __name__ implícito) → READY y código 0', () => {
        const deployed = {
            indexes: REPO.indexes.map(index => ({ ...index, fields: index.fields.filter(f => f.fieldPath !== '__name__') })),
            fieldOverrides: []
        };
        const result = run(deployed);
        expect(result.code).toBe(0);
        expect(result.lines.filter(line => line.startsWith('READY'))).toHaveLength(REPO.indexes.length);
    });

    test('falta el índice de projectId + closedAt (situación actual de producción) → MISSING y código 2', () => {
        const deployed = REPO.indexes.slice(1).map(index => asGcloud(index));
        const result = run(deployed);
        expect(result.code).toBe(2);
        expect(result.lines[0]).toMatch(/^MISSING\s+payrollClosures: projectId ASCENDING, closedAt DESCENDING/);
        expect(result.lines.join('\n')).toMatch(/firebase deploy --only firestore:indexes/);
    });

    test('índice en construcción → BUILDING y código 2; orden distinto no cuenta como desplegado', () => {
        const deployed = REPO.indexes.map((index, i) => asGcloud(index, i === 0 ? 'CREATING' : 'READY'));
        deployed[1] = asGcloud({ ...REPO.indexes[1], fields: [...REPO.indexes[1].fields].reverse() });
        const result = run(deployed);
        expect(result.code).toBe(2);
        expect(result.lines[0]).toMatch(/^BUILDING/);
        expect(result.lines[1]).toMatch(/^MISSING/);
    });

    test('un listado ilegible devuelve código 1 sin comparar', () => {
        const result = run({ unexpected: true });
        expect(result.code).toBe(1);
    });
});
