import { completeVoiceLoanDraft, previousVoiceInterest, voiceLoanNote } from '../modules/features/voice/VoiceLoanDraft.js';
import { buildPayPeriods } from '../modules/features/loans/LoanPayPeriods.js';

const periods = buildPayPeriods({ periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' }, '2026-10-03');
test('voice defaults use one payment, 20 percent and the next payroll strictly after today', () => {
    const draft = completeVoiceLoanDraft({}, { today: '2026-10-03', periods });
    expect(draft).toMatchObject({ principal: null, interestRate: 20, installmentMode: 'lump', installmentCount: 1, startDate: '2026-10-03', dueDate: '2026-10-24', concept: '' });
    expect(completeVoiceLoanDraft({}, { today: '2026-10-03', periods: [] }).dueDate).toBeNull();
    expect(completeVoiceLoanDraft({ installmentCount: 3 }).installmentMode).toBe('installments');
    expect(completeVoiceLoanDraft({ installmentMode: 'installments' }).installmentCount).toBeNull();
});
test('previous rate is optional and never overrides an explicit rate, including zero', () => {
    expect(completeVoiceLoanDraft({}, { previousRate: 15, usePrevious: true }).interestRate).toBe(15);
    expect(completeVoiceLoanDraft({}, { previousRate: 15, usePrevious: false }).interestRate).toBe(20);
    expect(completeVoiceLoanDraft({ interestRate: 0 }, { previousRate: 15, usePrevious: true }).interestRate).toBe(0);
    expect(completeVoiceLoanDraft({}, { previousRate: null, usePrevious: true }).interestRate).toBe(20);
    expect(previousVoiceInterest({ loans: [{ interestRate: 15, createdAt: 1 }, { interestRate: 0, createdAt: 2 }, { interestRate: null, createdAt: 3 }, { interestRate: 50, createdAt: 4, voided: true }] })).toBe(0);
});
test('voice note retains the recording date and timezone through retries with an optional concept', () => {
    const record = { createdAt: Date.UTC(2026, 9, 10, 1, 30), context: { timeZone: 'America/Santo_Domingo' } };
    expect(voiceLoanNote(record)).toBe('voice - el 09/10/2026 a las 21:30');
    expect(voiceLoanNote(record, ' Herramientas ')).toBe('voice - el 09/10/2026 a las 21:30 - Herramientas');
});
