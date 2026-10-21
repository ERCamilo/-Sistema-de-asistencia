/** Recover effective timestamps on read, keeping conversion/audit records intact. */
export function readLoanChronology(loans = []) {
    const byId = new Map(loans.map(loan => [String(loan.id), loan]));
    let changed = false;
    const result = loans.map(loan => {
        let loanChanged = false;
        const refinancings = (loan.refinancings || []).map(event => {
            if (event.effectiveAt != null || !event.convertedFrom?.refinancingId) return event;
            const source = byId.get(String(event.convertedFrom.loanId));
            const original = source?.refinancings?.find(item => String(item.id) === String(event.convertedFrom.refinancingId));
            const at = Number(original?.effectiveAt ?? original?.createdAt);
            if (!(at > 0)) return event;
            loanChanged = changed = true;
            return { ...event, effectiveAt: at };
        });
        return loanChanged ? { ...loan, refinancings } : loan;
    });
    return changed ? result : loans;
}

export function readLoanEmployee(employee) {
    const loans = readLoanChronology(employee?.loans || []);
    return loans === employee?.loans ? employee : { ...employee, loans };
}
