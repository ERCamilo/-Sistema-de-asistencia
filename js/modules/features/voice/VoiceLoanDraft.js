import { getDateKey } from '../../utils/DateUtils.js';

export function previousVoiceInterest(employee) {
    const loan = [...(employee?.loans || [])].filter(item => !item.voided && item.status !== 'written-off' && item.interestRate !== null && item.interestRate !== undefined && item.interestRate !== '' && Number.isFinite(Number(item.interestRate)) && Number(item.interestRate) >= 0)
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0];
    const rate = Number(loan?.interestRate);
    return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

// Client defaults are separate from provider extraction; an amount remains required.
export function completeVoiceLoanDraft(extracted = {}, { periods = [], today = getDateKey(new Date()), previousRate = null, usePrevious = false } = {}) {
    const next = periods.find(period => period.payDate > today);
    return { ...extracted, principal: extracted.principal ?? null,
        interestRate: extracted.interestRate ?? (usePrevious && previousRate !== null ? previousRate : 20),
        interestIncluded: extracted.interestIncluded ?? false, installmentMode: extracted.installmentMode ?? (Number(extracted.installmentCount) > 1 ? 'installments' : 'lump'),
        installmentCount: extracted.installmentCount ?? (extracted.installmentMode === 'installments' ? null : 1), installmentFrequencyWeeks: extracted.installmentFrequencyWeeks ?? 2,
        startDate: extracted.startDate || today, dueDate: extracted.dueDate || next?.payDate || null, concept: extracted.concept || '' };
}

export function voiceLoanNote(record, concept = '') {
    const date = new Date(record.createdAt);
    if (!Number.isFinite(date.getTime())) throw Error('No se pudo recuperar la fecha de la grabación.');
    const opts = { timeZone: record.context?.timeZone || 'America/Santo_Domingo' };
    const day = date.toLocaleDateString('es-DO', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = date.toLocaleTimeString('es-DO', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false });
    return `voice - el ${day} a las ${time}${String(concept || '').trim() ? ` - ${String(concept).trim()}` : ''}`;
}
