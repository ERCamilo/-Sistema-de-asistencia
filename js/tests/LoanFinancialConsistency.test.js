import { createLoan, refinanceLoan, getBalance, getInterestAmount, getIndividualLoanRecords, getEmployeesWithOnlyInactiveLoans } from '../modules/features/loans/LoansService.js';
import { replayLoan, buildTimeline, getRemainingCapital } from '../modules/features/loans/LoanTimeline.js';
import { computePortfolioSummary } from '../modules/features/loans/LoanPortfolio.js';
import { getAccountSummary, getAccountMovements, recordDirectPayment, voidAccountMovement, VOID_MODE } from '../modules/features/loans/LoanAccount.js';
import { readLoanEmployee } from '../modules/features/loans/LoanChronology.js';
import { buildFlowBuckets, computeLoanFlows } from '../modules/features/loans/LoanFlowChart.js';
import { buildLoanExport } from '../modules/features/loans/LoanExport.js';

const base = extra => ({ id:'L', principal:1000, interestRate:0, startDate:'2026-01-01', status:'active', payments:[], refinancings:[], ...extra });
const employee = loan => ({id:'E',loans:[loan]});

test('un reemplazo sobre capital conserva el total pactado en contrato, cuenta y gráfica', () => {
    const emp = {id:'E',loans:[]};
    const loan = createLoan(emp,{principal:1000,interestRate:20,startDate:'2026-01-01'});
    const ref = refinanceLoan(emp,loan.id,{date:'2026-02-01',basis:'capital',interestRate:10,installmentCount:2,installmentFrequencyWeeks:2},{projectScope:{enabled:false}});
    expect(ref.replacementTerms.totalDue).toBe(1300);
    expect(getBalance(loan)).toBe(1300);
    expect(getInterestAmount(loan)).toBe(100);
    expect(replayLoan(loan).balance).toBe(1300);
    expect(getAccountSummary(emp).balance).toBe(1300);
    expect(ref.replacementTerms.installments.reduce((s,i)=>s+i.scheduledAmount,0)).toBe(1300);
});

test.each([0,50,150])('el crédito consumido (%s) se aplica sin duplicar dinero recibido', charge => {
    const loan = base({payments:[{id:'P',date:'2026-01-02',amount:1100}],refinancings:charge?[{id:'R',date:'2026-01-03',interestAmount:charge}]:[]});
    const replay = replayLoan(loan), summary = computePortfolioSummary([employee(loan)]);
    expect(replay.credit).toBe(Math.max(0,100-charge));
    expect(replay.collected).toEqual({capital:1000,interest:Math.min(100,charge)});
    expect(summary.cobrado.total).toBe(1100);
    expect(summary.cobrado.capital+summary.cobrado.interest+summary.cobrado.excess).toBe(1100);
    expect(replay.balance).toBe(Math.max(0,charge-100));
});

test.each([500,1300])('retirar interés ya cobrado reclasifica el pago de %s sin interés negativo', amount => {
    const loan = base({payments:[{id:'P',date:'2026-01-03',amount}],refinancings:[{id:'R',date:'2026-01-02',interestAmount:300},{id:'A',date:'2026-01-04',interestAmount:-300,adjustment:{ofId:'R',ofKind:'refinancing'}}]});
    const replay = replayLoan(loan), emp = employee(loan), s = computePortfolioSummary([emp]);
    expect(replay).toMatchObject({capital:Math.max(0,1000-amount),interest:0,credit:Math.max(0,amount-1000)});
    expect(replay.collected).toEqual({capital:Math.min(amount,1000),interest:0});
    expect(getAccountSummary(emp).capital).toBe(replay.capital);
    expect(s.cobrado.capital+s.cobrado.interest+s.cobrado.excess).toBe(amount);
});

test('un cierre sin fecha no inventa pagos ni fecha y declara el hueco histórico', () => {
    const loan = base({status:'paid'});
    const r = replayLoan(loan), timeline = buildTimeline([{employeeId:'E',loan}]);
    expect(r).toMatchObject({balance:0,closure:{capital:1000,interest:0,undated:true},collected:{capital:0,interest:0}});
    expect(getRemainingCapital(loan)).toBe(0);
    expect(timeline.days).toEqual([]);
    expect(timeline.undatedClosures).toHaveLength(1);
    expect(timeline.totals.balance).toBe(0);
    expect(getIndividualLoanRecords({employees:[employee(loan)]},'settled')[0].totalBalance).toBe(0);
    expect(getEmployeesWithOnlyInactiveLoans({employees:[employee(loan)]})[0].totalBalance).toBe(0);
});

test('la conversión recupera la hora efectiva sin escribir el original ni imponer su allocation', () => {
    const original = base({id:'source',status:'written-off',refinancings:[{id:'original',date:'2026-01-02',interestAmount:100,createdAt:100}]});
    const loan = base({payments:[{id:'P',date:'2026-01-02',amount:200,recordedAt:200,allocation:{capital:200,interest:0}}],refinancings:[{id:'copy',date:'2026-01-02',interestAmount:100,createdAt:900,convertedFrom:{loanId:'source',refinancingId:'original'}}]});
    const emp = {id:'E',loans:[original,loan]}, snapshot=JSON.stringify(emp);
    const read = readLoanEmployee(emp);
    expect(read.loans[1].refinancings[0].effectiveAt).toBe(100);
    expect(getAccountSummary(emp)).toMatchObject({capital:900,interest:0});
    const movement = getAccountMovements(emp).find(m=>m.kind==='payment');
    expect(movement.parts[0]).toMatchObject({capital:100,interest:100,recordedAllocation:{capital:200,interest:0}});
    expect(computePortfolioSummary([emp]).cobrado).toMatchObject({capital:100,interest:100,total:200});
    const timeline=buildTimeline(emp.loans.map(loan=>({employeeId:emp.id,loan})), {financialOnly:true});
    expect(timeline.totals).toEqual({capital:900,interest:0,balance:900});
    const buckets=buildFlowBuckets('month',{from:'2026-01-01',to:'2026-01-31'});
    expect(computeLoanFlows(emp.loans,buckets).get('2026-01').end).toBe(900);
    expect(JSON.stringify(emp)).toBe(snapshot);
});

test('la diaria no confunde IDs de préstamo iguales de empleados distintos', () => {
    expect(buildTimeline([{employeeId:'A',loan:base({principal:100})},{employeeId:'B',loan:base({principal:300})}]).totals.balance).toBe(400);
});

test('el saldo anterior por periodo incluye también los ajustes de interés', () => {
    const loan=base({payments:[{id:'P',date:'2026-01-03',amount:500}],refinancings:[
        {id:'R',date:'2026-01-02',interestAmount:300},
        {id:'A',date:'2026-02-04',interestAmount:-300,adjustment:{ofKind:'refinancing',ofId:'R'}}
    ]});
    const buckets=buildFlowBuckets('month',{from:'2026-02-01',to:'2026-02-28'});
    expect(computeLoanFlows([loan],buckets).get('2026-02')).toMatchObject({open:800,adjustDown:300,end:500,missing:500});
});

test.each([
    [500, 'refinancing', 0], [500, 'payment', 0], [1300, 'refinancing', 0], [1300, 'payment', 0],
    [500, 'refinancing', 20], [500, 'payment', 20], [1500, 'refinancing', 20], [1500, 'payment', 20]
])('revertir interés y abono de %s, empezando por %s y con %s % inicial, conserva el cierre y no deja interés negativo', (amount, first, initialRate) => {
    const scope = { projectScope: { enabled: false } };
    const emp = { id: 'fictional-adjustments', loans: [] };
    const loan = createLoan(emp, { principal: 1000, interestRate: initialRate, startDate: '2026-01-01' }, scope);
    const ref = refinanceLoan(emp, loan.id, { basis: 'principal', interestRate: 30, date: '2026-01-02' }, scope);
    ref.payrollClosureId = 'fictional-closure';
    const payment = recordDirectPayment(emp, loan.id, {
        amount, date: '2026-01-03', source: 'payroll', payrollClosureId: 'fictional-closure'
    }, scope);
    const allocation = { ...payment.allocation };
    const targets = {
        refinancing: { loanId: loan.id, refinancingId: ref.id },
        payment: { loanId: loan.id, paymentId: payment.id }
    };
    const order = first === 'refinancing' ? ['refinancing', 'payment'] : ['payment', 'refinancing'];
    order.forEach((kind, index) => voidAccountMovement(emp, targets[kind], {
        ...scope, mode: VOID_MODE.ADJUST, date: `2026-01-0${index + 4}`, at: 1000 + index, reason: 'Prueba ficticia'
    }));
    const initialInterest = 1000 * initialRate / 100;
    const expectedBalance = 1000 + initialInterest;
    const replay = replayLoan(loan), summary = computePortfolioSummary([emp]);
    expect(replay).toMatchObject({ capital: 1000, interest: initialInterest, credit: 0, collected: { capital: 0, interest: 0 } });
    expect(summary.cobrado).toMatchObject({ total: 0, capital: 0, interest: 0, excess: 0 });
    expect(getAccountSummary(emp)).toMatchObject({ capital: 1000, interest: initialInterest, balance: expectedBalance });
    expect(buildTimeline([{ employeeId: emp.id, loan }]).totals).toEqual({ capital: 1000, interest: initialInterest, balance: expectedBalance });
    expect(getBalance(loan)).toBe(expectedBalance);
    expect(payment.allocation).toEqual(allocation);
    expect(payment.voided).toBe(false);
    expect(ref.voided).toBe(false);
    expect(payment.payrollClosureId).toBe('fictional-closure');
    const out = buildLoanExport([emp], { range: { from: '2026-01-01', to: '2026-01-31' }, today: '2026-01-31' });
    expect(out.preview).toMatchObject({ end: expectedBalance, received: 0 });
    if (first === 'refinancing' && amount === 1300) {
        const row = out.sheets.movimientos.find(row => row[0] === '05/01/2026' && row[4] === 'Ajuste de nómina cerrada');
        expect(row[5]).toBe(1300);
        expect(row[6]).toBe(1000);
        expect(row[7]).toBe(0);
        expect(row[15]).toBe(300);
    }
});

test('un ajuste antiguo sin allocation conserva el crédito que no devolvió y lo aplica a la deuda restaurada', () => {
    const scope = { projectScope: { enabled: false } };
    const emp = { id: 'fictional-credit', loans: [] };
    const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' }, scope);
    // A legacy imported record: current validation correctly rejects overpayment.
    const payment = { id: 'legacy-payment', amount: 1100, date: '2026-01-02', source: 'payroll', payrollClosureId: 'fictional-closure' };
    loan.payments.push(payment);
    loan.status = 'paid';
    voidAccountMovement(emp, { loanId: loan.id, paymentId: payment.id }, {
        ...scope, mode: VOID_MODE.ADJUST, date: '2026-01-03', at: 1000
    });
    expect(loan.payments.at(-1).amount).toBe(-1000);
    expect(replayLoan(loan)).toMatchObject({ capital: 900, interest: 0, credit: 0, collected: { capital: 100, interest: 0 } });
    expect(getBalance(loan)).toBe(900);
    expect(computePortfolioSummary([emp]).cobrado).toMatchObject({ total: 100, capital: 100, interest: 0, excess: 0 });
    expect(replayLoan(loan).steps.at(-1).creditUsed).toBe(100);
});
