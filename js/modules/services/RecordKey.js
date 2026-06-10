/**
 * 🔑 RecordKey.js (Auditoría 2026-06-09, hallazgo H1)
 *
 * Clave de deduplicación para empleados/líderes en el guardado local.
 *
 * Antes, saveState deduplicaba SOLO por `number` y descartaba en silencio
 * cualquier registro sin número (`if (!num) return;`): el empleado existía
 * en memoria y en la nube, pero nunca se escribía en IndexedDB — tras un
 * F5 offline, desaparecía.
 *
 * Regla: number (preferido, detecta duplicados de ficha) → id (fallback,
 * garantiza que el registro se persista) → null (sin nada que lo
 * identifique, único caso descartable).
 *
 * Módulo puro, sin IO — testeable de verdad (IndexedDBService está
 * mockeado en Jest).
 */

/**
 * @param {object|null|undefined} record - empleado o líder
 * @returns {string|null} clave de dedup con prefijo de espacio de nombres,
 *   o null si el registro no tiene ni number ni id.
 */
export function dedupKeyForRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const num = String(record.number ?? '').trim();
    if (num) return `num:${num}`;
    const id = String(record.id ?? '').trim();
    if (id) return `id:${id}`;
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🫆 fingerprintId — id sintético DETERMINISTA por contenido (hallazgo P3)
//
// Para items legacy sin id (préstamos/adelantos/pagos viejos), un UUID
// aleatorio por dispositivo hacía que el MISMO item recibiera ids distintos
// en cada lado y el merge lo duplicara. La huella de contenido garantiza:
// mismo contenido → mismo id, en cualquier dispositivo.
//
// Usado por LoanIdBackfill (al cargar) y EmployeeMerge.unionById (al
// fusionar), de modo que ambos caminos asignan el MISMO id al mismo item.
// ─────────────────────────────────────────────────────────────────────────────

/** Hash FNV-1a de 32 bits → base36. Determinista y suficiente para huellas. */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/**
 * Huella determinista del contenido de un item. Ignora el campo `id`.
 * Solo considera valores primitivos (los arreglos/objetos anidados aportan
 * su tamaño) — suficiente para distinguir items legacy reales.
 *
 * @param {object|null|undefined} item
 * @returns {string|null} 'fp-<hash>' o null si no es un objeto
 */
export function fingerprintId(item) {
    if (!item || typeof item !== 'object') return null;
    const keys = Object.keys(item).filter(k => k !== 'id').sort();
    const parts = keys.map(k => {
        const v = item[k];
        if (v === null || v === undefined) return `${k}:~`;
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') return `${k}:${String(v)}`;
        if (Array.isArray(v)) return `${k}:[${v.length}]`;
        return `${k}:{}`;
    });
    return `fp-${fnv1a(parts.join('|'))}`;
}

export default { dedupKeyForRecord, fingerprintId };
