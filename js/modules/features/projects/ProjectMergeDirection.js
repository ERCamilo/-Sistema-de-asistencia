const trimId = value => String(value ?? '').trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Qué obra conviene conservar al fusionar dos: la inicial (no se puede retirar), luego
 * la que tiene más personal y más asistencia (menos registros que reescribir), luego la
 * más antigua y por último el id menor. Es una sugerencia: el usuario puede invertirla.
 * Recibe los resúmenes de ProjectDuplicateReview ({ id, people, days, createdAt }).
 */
export function suggestMergeDirection(a, b, { defaultProjectId = '' } = {}) {
    const fixed = trimId(defaultProjectId);
    const keep = (() => {
        if (fixed && trimId(a.id) === fixed) return a;
        if (fixed && trimId(b.id) === fixed) return b;
        const order = cmp(Number(b.people) || 0, Number(a.people) || 0)
            || cmp(Number(b.days) || 0, Number(a.days) || 0)
            || cmp(Number(a.createdAt) || Infinity, Number(b.createdAt) || Infinity)
            || cmp(trimId(a.id), trimId(b.id));
        return order <= 0 ? a : b;
    })();
    const retire = keep === a ? b : a;
    return { keepId: trimId(keep.id), retireId: trimId(retire.id) };
}

export default { suggestMergeDirection };
