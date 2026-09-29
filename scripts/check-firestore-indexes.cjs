#!/usr/bin/env node
/**
 * Verifica que los índices compuestos de firestore.indexes.json estén
 * desplegados y listos. NO despliega ni escribe nada: compara el archivo del
 * repositorio con un listado de solo lectura que obtiene quien opera. Para
 * saber si están LISTOS hace falta un listado con estado de construcción:
 *
 *   gcloud firestore indexes composite list --project <id> --format=json > deployed.json
 *   # o la API de administración (GET .../databases/(default)/collectionGroups/-/indexes)
 *
 *   node scripts/check-firestore-indexes.cjs --deployed deployed.json
 *
 * `firebase firestore:indexes` NO incluye el estado: con ese listado solo se
 * confirma que existen y el resultado es UNVERIFIED (código 3), nunca READY,
 * porque un índice recién desplegado sigue en CREATING varios minutos.
 *
 * Salida: 0 si todos los índices del repo existen y están READY; 2 si falta
 * alguno o sigue construyéndose; 3 si existen pero el listado no trae su
 * estado; 1 ante un archivo inválido. Sin --deployed solo valida el archivo
 * del repositorio y muestra los comandos.
 *
 * Mientras un índice falte, la app degrada sola: el historial de cierres
 * muestra los cierres locales con aviso (PAYROLL_CLOSURE_INDEX_MISSING).
 */
const fs = require('fs');
const path = require('path');

const REPO_INDEXES = path.resolve(__dirname, '../firestore.indexes.json');

function normalizeFields(fields) {
    const list = (fields || [])
        .filter(field => field && field.fieldPath)
        .map(field => [String(field.fieldPath), String(field.order || field.arrayConfig || 'ASCENDING').toUpperCase()]);
    // Firestore añade __name__ implícito con la dirección del último campo; la
    // CLI de firebase lo omite y gcloud lo lista. Se compara sin él.
    const last = list[list.length - 1];
    const previous = list[list.length - 2];
    if (last && last[0] === '__name__' && (!previous || previous[1] === last[1])) list.pop();
    return list;
}

function collectionGroupOf(index) {
    if (index.collectionGroup) return String(index.collectionGroup);
    const match = /collectionGroups\/([^/]+)\/indexes/.exec(String(index.name || ''));
    return match ? match[1] : '';
}

function indexKey(index) {
    return JSON.stringify([
        collectionGroupOf(index),
        String(index.queryScope || 'COLLECTION').toUpperCase(),
        normalizeFields(index.fields)
    ]);
}

function parseIndexFile(json) {
    if (Array.isArray(json)) return json;                    // gcloud --format=json
    if (json && Array.isArray(json.indexes)) return json.indexes;  // firebase CLI / repo
    throw new Error('Formato de índices no reconocido: se esperaba {indexes: [...]} o una lista de gcloud');
}

function validateRepoIndexes(indexes) {
    const problems = [];
    const seen = new Set();
    indexes.forEach((index, position) => {
        const label = `#${position + 1} (${collectionGroupOf(index) || 'sin colección'})`;
        if (!collectionGroupOf(index)) problems.push(`${label}: falta collectionGroup`);
        if (normalizeFields(index.fields).length < 2) problems.push(`${label}: un índice compuesto necesita al menos dos campos`);
        const key = indexKey(index);
        if (seen.has(key)) problems.push(`${label}: duplicado`);
        seen.add(key);
    });
    return problems;
}

function compareIndexes(repoIndexes, deployedIndexes) {
    const deployed = new Map();
    for (const index of deployedIndexes) {
        deployed.set(indexKey(index), index.state ? String(index.state).toUpperCase() : 'UNKNOWN');
    }
    return repoIndexes.map(index => {
        const state = deployed.get(indexKey(index));
        return {
            collectionGroup: collectionGroupOf(index),
            fields: normalizeFields(index.fields).map(([field, order]) => `${field} ${order}`).join(', '),
            status: !state ? 'MISSING'
                : state === 'READY' ? 'READY'
                : state === 'UNKNOWN' ? 'UNVERIFIED'
                : 'BUILDING'
        };
    });
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv = process.argv.slice(2), out = console) {
    const deployedArg = argv.indexOf('--deployed');
    let repoIndexes;
    try {
        repoIndexes = parseIndexFile(readJson(REPO_INDEXES));
    } catch (error) {
        out.error(`firestore.indexes.json inválido: ${error.message}`);
        return 1;
    }
    const problems = validateRepoIndexes(repoIndexes);
    if (problems.length) {
        problems.forEach(problem => out.error(`Repo: ${problem}`));
        return 1;
    }
    if (deployedArg === -1 || !argv[deployedArg + 1]) {
        out.log(`firestore.indexes.json: ${repoIndexes.length} índices compuestos válidos.`);
        out.log('Para comparar con el proyecto (solo lectura, con estado de construcción):');
        out.log('  gcloud firestore indexes composite list --project <id> --format=json > deployed.json');
        out.log('  node scripts/check-firestore-indexes.cjs --deployed deployed.json');
        return 0;
    }
    let deployed;
    try {
        deployed = parseIndexFile(readJson(path.resolve(argv[deployedArg + 1])));
    } catch (error) {
        out.error(`Listado desplegado inválido: ${error.message}`);
        return 1;
    }
    const report = compareIndexes(repoIndexes, deployed);
    for (const row of report) out.log(`${row.status.padEnd(8)} ${row.collectionGroup}: ${row.fields}`);
    const pending = report.filter(row => row.status === 'MISSING' || row.status === 'BUILDING');
    if (pending.length) {
        out.log(`${pending.length} índice(s) sin desplegar o en construcción. Despliegue (requiere autorización): firebase deploy --only firestore:indexes`);
        return 2;
    }
    if (report.some(row => row.status === 'UNVERIFIED')) {
        out.log('Los índices existen, pero este listado no trae su estado de construcción (firebase CLI).');
        out.log('Para confirmar que están READY: gcloud firestore indexes composite list --project <id> --format=json');
        return 3;
    }
    out.log('Todos los índices del repositorio están desplegados y listos.');
    return 0;
}

module.exports = { normalizeFields, indexKey, parseIndexFile, validateRepoIndexes, compareIndexes, main };

if (require.main === module) process.exitCode = main();
