#!/usr/bin/env node
/**
 * Valida las migraciones de comprobantes con el motor real de PostgreSQL
 * compilado a WASM (PGlite). NO es Supabase: el esquema `storage` y los roles
 * anon/authenticated/service_role se simulan, y no se ejecutan PostgREST,
 * supabase-js, Storage ni la Edge Function. Solo prueba el SQL.
 *
 *   SA_PGLITE_MODULE=/ruta/node_modules/@electric-sql/pglite/dist/index.js \
 *   node scripts/check-supabase-receipt-migration.mjs
 *
 * Comprueba: las migraciones aplican en orden y la de M3 es re-ejecutable; las
 * filas existentes siguen válidas; el CAS de borrado/restauración que usa el
 * adaptador (uploaded_at + deleted_at) actualiza una sola vez; las
 * restricciones rechazan estados incoherentes; una subida nueva reactiva el
 * comprobante; el archivo de versiones ignora duplicados; anon/authenticated
 * no pueden leer las tablas.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.SA_PGLITE_MODULE;
if (!modulePath) {
    console.error('Falta SA_PGLITE_MODULE (ruta a @electric-sql/pglite/dist/index.js).');
    process.exit(1);
}
const { PGlite } = await import(pathToFileURL(modulePath).href);

const MIGRATIONS = [
    '202607290001_create_petty_cash_receipts.sql',
    '20260729105101_allow_pdf_petty_cash_receipts.sql',
    '202609280001_petty_cash_receipt_soft_delete.sql'
].map(name => [name, fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8')]);

const results = [];
const pass = label => { results.push(label); console.log('PASS ' + label); };

const db = new PGlite();
await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]);
`);

// Las dos primeras migraciones con una fila anterior a M3.
await db.exec(MIGRATIONS[0][1]);
await db.exec(MIGRATIONS[1][1]);
await db.query(`insert into public.petty_cash_receipts
    (firebase_uid, transaction_id, storage_path, mime_type, file_size_bytes, status, uploaded_at)
    values ('uid-1', 'mov-legacy', 'uid-1/mov-legacy', 'image/jpeg', 5, 'confirmed', '2026-09-01T10:00:00.123Z')`);
await db.exec(MIGRATIONS[2][1]);
await db.exec(MIGRATIONS[2][1]);   // re-ejecución
pass('las tres migraciones aplican en orden y la de M3 es re-ejecutable');

const legacy = (await db.query(`select status, deleted_at, upload_token from public.petty_cash_receipts where transaction_id = 'mov-legacy'`)).rows[0];
assert.deepEqual(legacy, { status: 'confirmed', deleted_at: null, upload_token: null });
pass('las filas existentes quedan activas y válidas');

// Mismo SQL que genera el adaptador (update … eq … is null … returning).
const markDeleted = (tx, version, at) => db.query(`update public.petty_cash_receipts
    set status = 'deleted', deleted_at = $3, updated_at = $3
    where firebase_uid = 'uid-1' and transaction_id = $1 and uploaded_at = $2 and deleted_at is null
    returning transaction_id, deleted_at`, [tx, version, at]);
const markRestored = (tx, version, at) => db.query(`update public.petty_cash_receipts
    set status = 'confirmed', deleted_at = null, updated_at = $3
    where firebase_uid = 'uid-1' and transaction_id = $1 and uploaded_at = $2 and deleted_at is not null
    returning transaction_id`, [tx, version, at]);

assert.equal((await markDeleted('mov-legacy', '2026-09-01T10:00:00.999Z', '2026-09-28T00:00:00Z')).rows.length, 0);
const deleted = await markDeleted('mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:00Z');
assert.equal(deleted.rows.length, 1);
assert.equal((await markDeleted('mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:01Z')).rows.length, 0);
pass('CAS de borrado: otra versión no borra; la versión exacta borra una sola vez');

assert.equal((await markRestored('mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:02Z')).rows.length, 1);
assert.equal((await markRestored('mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:03Z')).rows.length, 0);
pass('restauración reversible e idempotente');

for (const [label, sql] of [
    ['deleted sin deleted_at', `update public.petty_cash_receipts set status = 'deleted' where transaction_id = 'mov-legacy'`],
    ['deleted_at con estado activo', `update public.petty_cash_receipts set deleted_at = now() where transaction_id = 'mov-legacy'`],
    ['token con separador de ruta', `update public.petty_cash_receipts set upload_token = '../x' where transaction_id = 'mov-legacy'`],
    ['estado desconocido', `update public.petty_cash_receipts set status = 'purged' where transaction_id = 'mov-legacy'`]
]) {
    await assert.rejects(db.query(sql), /violates check constraint/, label);
}
pass('las restricciones rechazan estados incoherentes y tokens inválidos');

// Subida nueva sobre un comprobante borrado: el upsert lo reactiva.
await markDeleted('mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:04Z');
await db.query(`insert into public.petty_cash_receipt_versions
    (firebase_uid, transaction_id, storage_bucket, storage_path, uploaded_at, deleted_at)
    values ('uid-1', 'mov-legacy', 'petty-cash-receipts', 'uid-1/mov-legacy', '2026-09-01T10:00:00.123Z', '2026-09-28T00:00:04Z')
    on conflict (storage_bucket, storage_path) do nothing`);
await db.query(`insert into public.petty_cash_receipt_versions
    (firebase_uid, transaction_id, storage_bucket, storage_path)
    values ('uid-1', 'mov-legacy', 'petty-cash-receipts', 'uid-1/mov-legacy')
    on conflict (storage_bucket, storage_path) do nothing`);
await db.query(`insert into public.petty_cash_receipts
    (firebase_uid, transaction_id, storage_bucket, storage_path, mime_type, file_size_bytes, status, upload_token, deleted_at, uploaded_at, updated_at)
    values ('uid-1', 'mov-legacy', 'petty-cash-receipts', 'uid-1/mov-legacy/v2-8', 'image/png', 8, 'confirmed', 'v2-8', null, '2026-09-28T01:00:00Z', now())
    on conflict (firebase_uid, transaction_id) do update set
        storage_path = excluded.storage_path, mime_type = excluded.mime_type, status = excluded.status,
        upload_token = excluded.upload_token, deleted_at = excluded.deleted_at, uploaded_at = excluded.uploaded_at`);
const revived = (await db.query(`select status, deleted_at, storage_path from public.petty_cash_receipts where transaction_id = 'mov-legacy'`)).rows[0];
assert.deepEqual(revived, { status: 'confirmed', deleted_at: null, storage_path: 'uid-1/mov-legacy/v2-8' });
assert.equal((await db.query(`select count(*)::int as n from public.petty_cash_receipt_versions`)).rows[0].n, 1);
pass('una subida nueva reactiva el comprobante y la versión anterior queda archivada una vez');

for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['petty_cash_receipts', 'petty_cash_receipt_versions']) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/, `${role} ${table}`);
    }
    await db.exec('reset role');
}
pass('anon y authenticated no tienen acceso a comprobantes ni versiones');

await db.close();
console.log(`OK ${results.length} verificaciones (PGlite, sin Supabase)`);
