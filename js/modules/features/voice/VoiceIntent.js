export function voiceFacts(result) {
    const e = result?.extracted || {}, cash = result?.pettyCash || {}, loan = result?.loan || {}, payment = result?.payment || {}, note = result?.note || {};
    return { amount: e.amount ?? payment.amount ?? loan.principal ?? cash.amount ?? null,
        spokenName: e.spokenName ?? result?.employee?.spokenName ?? null,
        spokenNumber: e.spokenNumber ?? result?.employee?.spokenNumber ?? null,
        concept: e.concept ?? cash.concept ?? '', note: e.note ?? payment.note ?? note.text ?? cash.note ?? loan.concept ?? '',
        date: e.date ?? payment.date ?? note.date ?? cash.date ?? null, paidTo: e.paidTo ?? cash.paidTo ?? '',
        spokenCategory: e.spokenCategory ?? cash.spokenCategory ?? null };
}
export const isVoiceIntentUnclear = result => result?.intent === 'desconocida' || !!result?.issues?.some(issue => /^(UNCLEAR|UNKNOWN|AMBIGUOUS)_INTENT$/.test(issue.code));
export function suggestedVoiceIntent(result, preference = 'loan') {
    if (['crear_nota', 'registrar_abono'].includes(result?.intent)) return result.intent;
    const facts = voiceFacts(result), named = !!(facts.spokenName || facts.spokenNumber);
    if (named && facts.amount == null) return 'buscar_empleado';
    if (preference === 'ask') return null;
    if (facts.amount != null && preference === 'cash') return 'registrar_gasto_caja_chica';
    if (named && facts.amount != null) return 'crear_prestamo';
    return null;
}
