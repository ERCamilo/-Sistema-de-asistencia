/**
 * ⏱️ LoanTimelineEngine — Pure mathematical engine for historical loan timeline reconstruction.
 *
 * Implements:
 *  - Strict interest-first payment allocation waterfall:
 *      Payment -> 1° Pending Accrued Interest (must reach 0.00) -> 2° Principal Amortization
 *  - Unpaid interest recapitalization on refinancing
 *  - Deterministic timeline milestone generation (Antes -> Cambios -> Después)
 *  - Scoped support for individual employee or aggregated project/obra
 *
 * Fully pure and idempotent with respect to input models.
 */

/** Round to 2 decimal places to avoid floating point drift. */
export function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Normalizes and extracts all chronological financial events from one or more employees.
 * Supported event types:
 *   - 'loan': disbursement of principal + initial interest
 *   - 'payment': payment/abono via payroll or manual
 *   - 'refinance': loan refinancing adding interest
 */
export function extractLoanEvents(empOrList) {
    const list = Array.isArray(empOrList) ? empOrList : [empOrList].filter(Boolean);
    const events = [];

    for (const emp of list) {
        const empId = emp?.id || 'unknown';
        const empName = emp?.name || 'Empleado';
        const loans = Array.isArray(emp?.loans) ? emp.loans : [];

        loans.forEach((loan, loanIdx) => {
            const loanId = loan.id;
            const loanSeq = Number.isFinite(loan.seq) ? loan.seq : (loanIdx + 1);
            const loanConcept = (loan.concept || 'Préstamo').trim();
            const loanPrincipal = round2(loan.principal || 0);
            const loanInterestRate = Number(loan.interestRate || 0);
            const loanInitialInterest = round2(loanPrincipal * loanInterestRate / 100);
            const loanStartDate = loan.startDate || (loan.createdAt ? new Date(loan.createdAt).toISOString().slice(0, 10) : '1970-01-01');

            // 1. Initial disbursement event
            events.push({
                type: 'loan',
                id: `orig-${loanId}`,
                loanId,
                loanSeq,
                employeeId: empId,
                employeeName: empName,
                date: loanStartDate,
                orderPriority: 10, // loans processed first on same day
                amount: loanPrincipal,
                interestRate: loanInterestRate,
                initialInterest: loanInitialInterest,
                totalDue: round2(loanPrincipal + loanInitialInterest),
                concept: loanConcept,
                note: `Desembolso ${loanConcept}`
            });

            // 2. Refinancing events (skip voided)
            const refinancings = Array.isArray(loan.refinancings) ? loan.refinancings : [];
            for (const ref of refinancings) {
                if (ref.voided) continue;
                const refDate = ref.date || (ref.createdAt ? new Date(ref.createdAt).toISOString().slice(0, 10) : loanStartDate);
                const interestAmount = round2(ref.interestAmount || 0);
                const baseAmount = round2(ref.baseAmount || 0);

                events.push({
                    type: 'refinance',
                    id: ref.id || `ref-${loanId}-${refDate}`,
                    loanId,
                    loanSeq,
                    employeeId: empId,
                    employeeName: empName,
                    date: refDate,
                    orderPriority: 20, // refinancings processed after loans
                    basis: ref.basis || 'balance',
                    baseAmount,
                    interestRate: Number(ref.interestRate || 0),
                    interestAmount,
                    amount: interestAmount, // increase to debt
                    note: (ref.note || '').trim() || 'Refinanciamiento'
                });
            }

            // 3. Payment events (skip voided)
            const payments = Array.isArray(loan.payments) ? loan.payments : [];
            for (const pay of payments) {
                if (pay.voided) continue;
                const payDate = pay.date || (pay.recordedAt ? new Date(pay.recordedAt).toISOString().slice(0, 10) : loanStartDate);
                const payAmount = round2(pay.amount || 0);

                events.push({
                    type: 'payment',
                    id: pay.id || `pay-${loanId}-${payDate}`,
                    loanId,
                    loanSeq,
                    employeeId: empId,
                    employeeName: empName,
                    date: payDate,
                    orderPriority: 30, // payments processed after charges on same day
                    amount: payAmount,
                    source: pay.source || (pay.payrollClosureId ? 'payroll' : 'manual'),
                    note: (pay.note || '').trim() || (pay.payrollClosureId ? 'Deducción de nómina' : 'Abono a préstamo')
                });
            }
        });
    }

    // Sort chronologically: by date ascending, then by orderPriority (loans -> refinances -> payments)
    events.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.orderPriority || 50) - (b.orderPriority || 50);
    });

    return events;
}

/**
 * Builds the complete chronological timeline with historical snapshots for each active date.
 * Enforces strict interest-first amortization.
 *
 * @param {object|object[]} empOrList - An employee or list of employees in scope
 * @returns {object} The reconstructed timeline structure
 */
export function buildLoanTimeline(empOrList) {
    const rawEvents = extractLoanEvents(empOrList);

    if (rawEvents.length === 0) {
        return {
            hasHistory: false,
            milestones: [],
            totalCurrentBalance: 0,
            cumulativePrincipal: 0,
            cumulativeInterest: 0,
            cumulativePaid: 0
        };
    }

    // Group events by date to form milestones
    const eventsByDate = new Map();
    for (const ev of rawEvents) {
        if (!eventsByDate.has(ev.date)) {
            eventsByDate.set(ev.date, []);
        }
        eventsByDate.get(ev.date).push(ev);
    }

    const uniqueDates = Array.from(eventsByDate.keys()).sort();

    // Accumulators for simulation
    let currentPrincipal = 0;
    let currentInterest = 0;
    let cumulativePrincipal = 0;
    let cumulativeInterest = 0;
    let cumulativePaid = 0;

    let previousMilestoneDate = null;
    let previousMilestoneBalance = 0;

    const milestones = [];

    for (let i = 0; i < uniqueDates.length; i++) {
        const date = uniqueDates[i];
        const dayEvents = eventsByDate.get(date);

        const beforeBalance = round2(currentPrincipal + currentInterest);
        const milestoneChanges = [];

        for (const ev of dayEvents) {
            if (ev.type === 'loan') {
                currentPrincipal = round2(currentPrincipal + ev.amount);
                currentInterest = round2(currentInterest + ev.initialInterest);
                cumulativePrincipal = round2(cumulativePrincipal + ev.amount);
                cumulativeInterest = round2(cumulativeInterest + ev.initialInterest);

                milestoneChanges.push({
                    type: 'loan',
                    id: ev.id,
                    loanId: ev.loanId,
                    loanSeq: ev.loanSeq,
                    employeeName: ev.employeeName,
                    amount: ev.totalDue,
                    principalPart: ev.amount,
                    interestPart: ev.initialInterest,
                    interestRate: ev.interestRate,
                    concept: ev.concept,
                    sign: '+',
                    isPositiveChange: true,
                    label: ev.concept || 'Nuevo préstamo',
                    description: ev.initialInterest > 0
                        ? `Capital: RD$ ${ev.amount.toLocaleString()} · Interés: RD$ ${ev.initialInterest.toLocaleString()}`
                        : 'Desembolso a capital'
                });
            } else if (ev.type === 'refinance') {
                currentInterest = round2(currentInterest + ev.amount);
                cumulativeInterest = round2(cumulativeInterest + ev.amount);

                milestoneChanges.push({
                    type: 'refinance',
                    id: ev.id,
                    loanId: ev.loanId,
                    loanSeq: ev.loanSeq,
                    employeeName: ev.employeeName,
                    amount: ev.amount,
                    baseAmount: ev.baseAmount,
                    interestRate: ev.interestRate,
                    sign: '+',
                    isPositiveChange: true,
                    label: 'Refinanciamiento',
                    description: `Interés adicional al ${ev.interestRate}% sobre saldo refinanciado de RD$ ${ev.baseAmount.toLocaleString()}`,
                    note: ev.note
                });
            } else if (ev.type === 'payment') {
                cumulativePaid = round2(cumulativePaid + ev.amount);

                // ⚡ WATERFALL DE PRELACIÓN: Interés primero hasta 0.00
                const paymentAmount = ev.amount;
                const interestCovered = Math.min(currentInterest, paymentAmount);
                currentInterest = round2(currentInterest - interestCovered);

                const remainingPayment = round2(paymentAmount - interestCovered);
                const principalCovered = Math.min(currentPrincipal, remainingPayment);
                currentPrincipal = round2(currentPrincipal - principalCovered);

                milestoneChanges.push({
                    type: 'payment',
                    id: ev.id,
                    loanId: ev.loanId,
                    loanSeq: ev.loanSeq,
                    employeeName: ev.employeeName,
                    amount: paymentAmount,
                    interestCovered,
                    principalCovered,
                    sign: '−',
                    isPositiveChange: false,
                    label: ev.note || 'Abono a préstamo',
                    description: interestCovered > 0
                        ? `Interés liquidado: RD$ ${interestCovered.toLocaleString()} · Capital amortizado: RD$ ${principalCovered.toLocaleString()}`
                        : `Amortización directa a capital: RD$ ${principalCovered.toLocaleString()}`
                });
            }
        }

        const afterBalance = round2(currentPrincipal + currentInterest);
        const delta = round2(afterBalance - beforeBalance);
        const deltaPercent = beforeBalance > 0
            ? round2(((afterBalance - beforeBalance) / beforeBalance) * 100)
            : (afterBalance > 0 ? 100 : 0);

        const loansList = milestoneChanges.filter(c => c.type === 'loan');
        const paymentsList = milestoneChanges.filter(c => c.type === 'payment');
        const refinancingsList = milestoneChanges.filter(c => c.type === 'refinance');

        const totalLoansDue = round2(loansList.reduce((s, l) => s + l.amount, 0));
        const totalLoansPrincipal = round2(loansList.reduce((s, l) => s + l.principalPart, 0));
        const totalLoansInterest = round2(loansList.reduce((s, l) => s + l.interestPart, 0));

        const totalPayments = round2(paymentsList.reduce((s, p) => s + p.amount, 0));
        const totalPaymentsInterest = round2(paymentsList.reduce((s, p) => s + p.interestCovered, 0));
        const totalPaymentsPrincipal = round2(paymentsList.reduce((s, p) => s + p.principalCovered, 0));

        const totalRefinanceInterest = round2(refinancingsList.reduce((s, r) => s + r.amount, 0));
        const totalBaseRefinanced = round2(refinancingsList.reduce((s, r) => s + (r.baseAmount || 0), 0));

        const totalSumas = round2(totalLoansDue + totalRefinanceInterest);
        const totalRestas = round2(totalPayments);

        const milestone = {
            index: i,
            date,
            previousDate: previousMilestoneDate || date,
            beforeBalance,
            changes: milestoneChanges,
            summary: {
                totalSumas,
                totalRestas,
                netChange: round2(totalSumas - totalRestas),
                loans: {
                    items: loansList,
                    count: loansList.length,
                    totalDue: totalLoansDue,
                    principal: totalLoansPrincipal,
                    interest: totalLoansInterest
                },
                payments: {
                    items: paymentsList,
                    count: paymentsList.length,
                    total: totalPayments,
                    interestCovered: totalPaymentsInterest,
                    principalCovered: totalPaymentsPrincipal
                },
                refinancings: {
                    items: refinancingsList,
                    count: refinancingsList.length,
                    totalInterest: totalRefinanceInterest,
                    totalBaseRefinanced: totalBaseRefinanced
                }
            },
            afterBalance,
            delta,
            deltaPercent,
            components: {
                principal: currentPrincipal,
                interest: currentInterest
            },
            cumulative: {
                principal: cumulativePrincipal,
                interest: cumulativeInterest,
                paid: cumulativePaid
            },
            isPaidOff: afterBalance <= 0.01
        };

        milestones.push(milestone);
        previousMilestoneDate = date;
        previousMilestoneBalance = afterBalance;
    }

    return {
        hasHistory: true,
        milestones,
        totalCurrentBalance: round2(currentPrincipal + currentInterest),
        cumulativePrincipal,
        cumulativeInterest,
        cumulativePaid
    };
}

/**
 * Returns the exact snapshot for a given target date or the closest previous milestone.
 */
export function getTimelineSnapshotAtDate(timeline, targetDate) {
    if (!timeline || !timeline.hasHistory || !timeline.milestones.length) {
        return null;
    }

    const milestones = timeline.milestones;
    if (targetDate <= milestones[0].date) {
        return milestones[0];
    }
    if (targetDate >= milestones[milestones.length - 1].date) {
        return milestones[milestones.length - 1];
    }

    // Find the latest milestone that occurred on or before targetDate
    let chosen = milestones[0];
    for (const m of milestones) {
        if (m.date <= targetDate) {
            chosen = m;
        } else {
            break;
        }
    }
    return chosen;
}
