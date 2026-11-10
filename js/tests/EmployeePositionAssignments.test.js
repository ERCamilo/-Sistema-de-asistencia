import { buildSplitXExport } from '../modules/features/payroll/PayrollSplitXExport.js';
import { prepareRestoredState } from '../modules/services/RestorePrepare.js';
import { redactSensitiveBackup } from '../modules/services/BackupRedaction.js';
import { getPayrollEmployeesForPeriod } from '../modules/features/payroll/PayrollPeriod.js';
import { filterHistoricalPayrollByPayer } from '../modules/features/payroll/PayrollHistoricalIdentity.js';
import { prepareEmployeePositionAssignments, captureAttendancePositionAssignments, resolveEmployeePositionTerms } from '../modules/features/employees/EmployeePositionAssignments.js';
import { PayrollService, calculateEmployeePayrollWithContext } from '../modules/features/payroll/PayrollService.js';
import { filterPayrollRowsByLeader } from '../modules/features/payroll/PayrollPreview.js';
import { buildPayrollLeaderAdjustments, canonicalLeaderAdjustments, renderPayrollLeaderAdjustments } from '../modules/features/payroll/PayrollLeaderAdjustments.js';
import { buildPayrollClosureDraft } from '../modules/features/payroll/PayrollClosureWorkflow.js';
import { validatePayrollClosureForScopedWrite, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

const NOW = new Date('2026-11-09T09:00:00').getTime();
function fixture() {
    return {
        settings: { regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, restDayFactor: 1.5, holidays: [] },
        leaders: [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }],
        positions: [{ id: 'p1', name: 'Albañil', leaderId: 'L1', hourlyRate: 112.5, workingDays: [1,2,3,4,5,6] },
            { id: 'p2', name: 'Electricista', leaderId: 'L2', hourlyRate: 112.5, workingDays: [1,2,3,4,5,6] },
            { id: 'p3', name: 'Ayudante', leaderId: 'L2', hourlyRate: 62.5, workingDays: [1,2,3,4,5,6] }],
        employees: [{ id: 'juan', name: 'Juan', number: '113', positions: ['p1','p2'] }, { id: 'rosa', name: 'Rosa', number: '24', positions: ['p3'] }],
        attendance: {}, exportConfig: {}
    };
}
function configure(state, values = { workLeaderId: 'L2', isLoanPosition: true, payerLeaderId: 'L1' }, time = NOW) {
    const employee = state.employees[0];
    employee.positionAssignments = prepareEmployeePositionAssignments(employee, { p2: values }, state, time);
}
function attend(state, employeeId, pos, date = '2026-11-09', extra = {}) {
    const record = captureAttendancePositionAssignments({ employeeId, date, present: true, selectedPosition: pos, hoursWorked: 8, overtimeHours: 0, ...extra }, state, NOW + 1000);
    state.attendance[`${employeeId}-${date}`] = record;
    return record;
}
function rows(state, start = '2026-11-09', end = start) {
    const service = new PayrollService(state);
    return state.employees.map(employee => {
        const payroll = service.calculateEmployeePayroll(employee.id, start, end, [], [], []);
        return { _employeeId: employee.id, _employeeName: employee.name, _number: employee.number, _brutoOriginal: payroll.brutoOriginal,
            _bonuses: payroll.bonuses, _deductions: payroll.deductions, _loans: 0, monto: payroll.neto, _positionBreakdown: payroll.breakdown };
    }).filter(row => row.monto > 0);
}
function groups(state, salaryRows = rows(state), selections = {}) {
    return buildPayrollLeaderAdjustments(salaryRows, { projectId: 'obra', periodStart: '2026-11-09', periodEnd: '2026-11-09', positions: state.positions, employees: state.employees, selections });
}

test('a non-loan employee can change team without changing catalogue, rate or another employee', () => {
    const state = fixture(); configure(state, { workLeaderId: 'L1', isLoanPosition: false, payerLeaderId: 'L2' });
    attend(state,'juan','p2');
    const salaryRows = rows(state);
    expect(salaryRows[0].monto).toBe(900);
    expect(filterPayrollRowsByLeader(salaryRows, { leaderId:'L1', ...state })).toHaveLength(1);
    expect(filterPayrollRowsByLeader(salaryRows, { leaderId:'L2', ...state })).toHaveLength(0);
    expect(groups(state)).toEqual([]);
    expect(state.positions[1].leaderId).toBe('L2');
    expect(state.employees[1].positionAssignments).toBeUndefined();
});

test('salary paid once; borrowed group deducts 900 from 500 without creating an employee row', () => {
    const state = fixture(); configure(state); attend(state,'juan','p2'); attend(state,'rosa','p3');
    const salaryRows = rows(state), group = groups(state)[0];
    expect(group).toMatchObject({ amount:900, subtotal:500, balance:-400, enabled:true });
    expect(salaryRows.map(row => row.monto)).toEqual([900,500]);
    expect(filterPayrollRowsByLeader(salaryRows, { ...state, leaderId:'L2' }).map(row => row._employeeId)).toEqual(['rosa']);
    expect(groups(state, salaryRows, { [group.key]:false })[0]).toMatchObject({ amount:900, subtotal:500, balance:500 });
    const root = document.createElement('div');root.innerHTML=renderPayrollLeaderAdjustments([group]);
    expect(root.querySelectorAll('input')).toHaveLength(1);
    expect(root.querySelectorAll('[data-employee-id], [data-loan-id]')).toHaveLength(0);
    expect(()=>canonicalLeaderAdjustments([group,group])).toThrow(/duplicado/);
});

test.each([[4,0,false,450],[8,0,true,1800],[8,2,false,1203.75]])('partial/holiday/overtime stay on existing formulas (%s/%s/%s)',(hours, extra, holiday, amount)=>{
    const state=fixture();configure(state);attend(state,'juan','p2','2026-11-09',{hoursWorked:hours,overtimeHours:extra,isHoliday:holiday});
    expect(rows(state)[0].monto).toBe(amount);expect(groups(state)[0].amount).toBe(amount);
    const ctx={...state,projectId:'obra',getAttendance:(emp,date)=>state.attendance[`${emp}-${date}`]};
    expect(calculateEmployeePayrollWithContext(ctx,state.settings,'juan','2026-11-09','2026-11-09',[],[],[]).neto).toBe(amount);
});

test('same leader does not create a self-adjustment',()=>{
    const state=fixture();configure(state,{workLeaderId:'L2',payerLeaderId:'L2',isLoanPosition:true});attend(state,'juan','p2');
    expect(groups(state)).toEqual([]);expect(rows(state)[0].monto).toBe(900);
});

test('captured team and payer survive later edits, while the open period follows the current rate',()=>{
    const state=fixture();configure(state);const record=attend(state,'juan','p2');
    configure(state,{workLeaderId:'L1',payerLeaderId:'L2',isLoanPosition:false},NOW+3000);
    state.positions[1].hourlyRate=500;state.positions[1].leaderId='L1';state.settings.overtimeFactor=9;
    expect(rows(state)[0]._positionBreakdown[0]).toMatchObject({hourlyRate:500,workLeaderId:'L2',payerLeaderId:'L1',subtotal:4000});
    expect(captureAttendancePositionAssignments({...record,notes:'Editada'},state,NOW+5000).positionAssignments).toEqual(record.positionAssignments);
});

test('unsnapshotted work from before first assignment retains legacy team, including same-day attendance',()=>{
    const state=fixture();
    state.attendance['juan-2026-11-09']={employeeId:'juan',date:'2026-11-09',present:true,selectedPosition:'p2',hoursWorked:8,updatedAt:NOW-1000};
    configure(state);
    expect(rows(state)[0]._positionBreakdown[0]).toMatchObject({workLeaderId:'L2',payerLeaderId:'L2',isLoanPosition:false,subtotal:900});
    expect(groups(state)).toEqual([]);
});

test('changing payer mid-period keeps two historical parts for the same position',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');
    const tomorrow = new Date('2026-11-10T09:00:00').getTime();configure(state,{workLeaderId:'L2',payerLeaderId:'L2',isLoanPosition:false},tomorrow);
    attend(state,'juan','p2','2026-11-10',{createdAt:tomorrow+1000});
    const salaryRows=rows(state,'2026-11-09','2026-11-10');
    expect(salaryRows[0]._positionBreakdown).toHaveLength(2);expect(salaryRows[0].monto).toBe(1800);
    expect(filterPayrollRowsByLeader(salaryRows,{...state,leaderId:'L1'})[0].monto).toBe(900);
    expect(filterPayrollRowsByLeader(salaryRows,{...state,leaderId:'L2'})[0].monto).toBe(900);
});

test('closure freezes separate signed leader balances and checkbox in fingerprint; no salary is negative',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');attend(state,'rosa','p3');
    const salaryRows=rows(state),adjustments=groups(state);
    const build = leaderAdjustments=>buildPayrollClosureDraft({employees:state.employees,rows:salaryRows,leaderAdjustments,projectId:'obra',periodStart:'2026-11-09',periodEnd:'2026-11-09'}).closure;
    const closure=build(adjustments);
    expect(closure.totals.net).toBe(1400);expect(closure.leaderAdjustments[0].balance).toBe(-400);
    expect(validatePayrollClosureForScopedWrite(closure,'obra')).toEqual(closure);
    expect(build([{...adjustments[0],enabled:false}]).fingerprint).not.toBe(closure.fingerprint);
    expect(voidPayrollClosure(closure,{projectId:'obra'}).leaderAdjustments).toEqual(closure.leaderAdjustments);
});

test('an older client without assignment fields cannot erase them during sync',()=>{
    const state=fixture();configure(state);const employee={...state.employees[0],positionsUpdatedAt:NOW,updatedAt:NOW};
    const older={...employee,updatedAt:NOW+2000,positionsUpdatedAt:NOW+2000,phone:'123'};delete older.positionAssignments;
    expect(mergeEmployees(employee,older).positionAssignments).toEqual(employee.positionAssignments);
});

test('fixed personal charges are collected once; leader percentages stay with their actual payer',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');
    const tomorrow=new Date('2026-11-10T09:00:00').getTime();configure(state,{workLeaderId:'L2',payerLeaderId:'L2',isLoanPosition:false},tomorrow);
    attend(state,'juan','p2','2026-11-10',{createdAt:tomorrow+1000});
    const row=rows(state,'2026-11-09','2026-11-10')[0];
    Object.assign(row,{monto:1620,_deductions:80,_deductionDetails:[{type:'fixed',amount:80,scope:'employee'}],_loans:100,_loanDetails:[{loanId:'loan',selectedAmount:100}]});
    const a=filterPayrollRowsByLeader([row],{...state,leaderId:'L1'})[0];
    const b=filterPayrollRowsByLeader([row],{...state,leaderId:'L2'})[0];
    expect([a.monto,b.monto]).toEqual([720,900]);expect(a._loans+b._loans).toBe(100);expect(a._deductions+b._deductions).toBe(80);
    row._bonuses=90;row._bonusDetails=[{type:'percentage',value:10,amount:90,appliedTo:900,scope:'leader',targetId:'L2'}];row.monto+=90;
    const withBonusA=filterPayrollRowsByLeader([row],{...state,leaderId:'L1'})[0];
    const withBonusB=filterPayrollRowsByLeader([row],{...state,leaderId:'L2'})[0];
    expect(withBonusA._bonuses).toBe(0);expect(withBonusB._bonuses).toBe(90);
    expect(withBonusA.monto+withBonusB.monto).toBe(row.monto);
});

test('editing hours of a legacy day does not silently replace its pre-assignment terms',()=>{
    const state=fixture();const previous={employeeId:'juan',date:'2026-11-09',present:true,selectedPosition:'p2',hoursWorked:8,updatedAt:NOW-1000};
    state.attendance['juan-2026-11-09']=previous;configure(state);
    const next=captureAttendancePositionAssignments({...previous,hoursWorked:4,updatedAt:NOW+2000},state,NOW+2000);
    expect(next.positionAssignments.p2).toMatchObject({workLeaderId:'L2',payerLeaderId:'L2',isLoanPosition:false});
});


test('restoring a backup freezes pre-assignment work before refreshing sync timestamps',()=>{
    const state=fixture();state.attendance['juan-2026-11-09']={employeeId:'juan',date:'2026-11-09',present:true,selectedPosition:'p2',hoursWorked:8,updatedAt:NOW-1000};configure(state);
    const restored=prepareRestoredState(state,{now:NOW+10000});
    expect(restored.attendance['juan-2026-11-09'].positionAssignments.p2).toMatchObject({payerLeaderId:'L2',isLoanPosition:false});
    const redacted=redactSensitiveBackup({...state,attendance:restored.attendance});
    expect(redacted.employees[0].positionAssignments).toBeUndefined();
    expect(redacted.attendance['juan-2026-11-09'].positionAssignments).toBeUndefined();
});

test('payroll employee eligibility follows the actual payer, not the catalogue team',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');attend(state,'rosa','p3');
    state.exportConfig.leaderFilter='L2';expect(getPayrollEmployeesForPeriod(state,'2026-11-09','2026-11-09').map(employee=>employee.id)).toEqual(['rosa']);
    state.exportConfig.leaderFilter='L1';expect(getPayrollEmployeesForPeriod(state,'2026-11-09','2026-11-09').map(employee=>employee.id)).toEqual(['juan']);
});

test('historical payer filters use captured parts and charge personal adjustments only on their owner',()=>{
    const row={employeeId:'juan',employeeName:'Juan',gross:1800,net:1620,bonuses:0,deductions:80,loans:100,
        personalAdjustmentPayerId:'L1',deductionDetails:[{type:'fixed',amount:80,scope:'employee'}],loanDetails:[{loanId:'loan',selectedAmount:100}],
        positionBreakdown:[{positionId:'p2',assignmentSchemaVersion:1,payerLeaderId:'L1',subtotal:900,regularHours:8},
            {positionId:'p2',assignmentSchemaVersion:1,payerLeaderId:'L2',subtotal:900,regularHours:8}]};
    expect(filterHistoricalPayrollByPayer([row],'L1')[0]).toMatchObject({gross:900,deductions:80,loans:100,net:720});
    expect(filterHistoricalPayrollByPayer([row],'L2')[0]).toMatchObject({gross:900,deductions:0,loans:0,net:900});
});


test('SplitX references the actual payer even when the position catalogue belongs to another leader',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');
    const exported=buildSplitXExport(rows(state),{...state,regularHoursPerDay:8,period:{start:'2026-11-09',end:'2026-11-09'}});
    expect(exported.employees[0].positions[0].leaderId).toBe('L1');
    expect(exported.employees[0].leaders.map(leader=>leader.id)).toEqual(['L1']);
});


test('several borrowed employees produce one leader group and one optional discount',()=>{
    const state=fixture();configure(state);attend(state,'juan','p2');attend(state,'rosa','p3');
    state.positions.push({id:'p4',name:'Ayudante de electricidad',leaderId:'L2',hourlyRate:100,workingDays:[0,1,2,3,4,5,6]});
    const employee={id:'pedro',name:'Pedro',number:'114',positions:['p4']};state.employees.push(employee);
    employee.positionAssignments=prepareEmployeePositionAssignments(employee,{p4:{workLeaderId:'L2',payerLeaderId:'L1',isLoanPosition:true}},state,NOW);
    attend(state,'pedro','p4','2026-11-09',{hoursWorked:4});
    const adjustments=groups(state);
    expect(adjustments).toHaveLength(1);expect(adjustments[0]).toMatchObject({amount:1300,subtotal:500,balance:-800});
    expect(adjustments[0].entries.map(entry=>entry.employeeId)).toEqual(['juan','pedro']);
    const closure=buildPayrollClosureDraft({employees:state.employees,rows:rows(state),leaderAdjustments:adjustments,projectId:'obra',periodStart:'2026-11-09',periodEnd:'2026-11-09'}).closure;
    expect(validatePayrollClosureForScopedWrite(closure,'obra')).toEqual(closure);
    const reordered={...closure,leaderAdjustments:closure.leaderAdjustments.map(group=>({...group,entries:group.entries.map(entry=>Object.fromEntries(Object.entries(entry).reverse()))}))};
    expect(validatePayrollClosureForScopedWrite(reordered,'obra')).toEqual(reordered);
});


test('retained assignment history of a deleted catalogue job does not block unrelated employee edits',()=>{
    const state=fixture();configure(state);const employee=state.employees[0];
    const accepted=JSON.parse(JSON.stringify(employee.positionAssignments));
    employee.positions=['p1'];state.positions=state.positions.filter(position=>position.id!=='p2');
    expect(prepareEmployeePositionAssignments(employee,accepted,state,NOW+10000)).toEqual(accepted);
});

test('an individual leader does not change the rest-day factor of work that carries no captured terms', () => {
    // The project payroll config has no restDayFactor; it lives in the general settings.
    const config = { projectId: 'P', regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, holidays: [] };
    const sunday = '2026-11-15';
    const state = fixture();
    state.settings.restDayFactor = 2;
    state.employees = [{ id: 'plain', number: '1', name: 'Sin líder propio', positions: ['p3'] },
        { id: 'own', number: '2', name: 'Con líder propio', positions: ['p3'] }];
    state.employees[1].positionAssignments = prepareEmployeePositionAssignments(
        state.employees[1], { p3: { workLeaderId: 'L1' } }, state, NOW);
    // Recorded after the assignment by a client that does not capture terms (older app, reader, import).
    const later = new Date(`${sunday}T18:00:00`).getTime();
    for (const id of ['plain', 'own']) state.attendance[`${id}-${sunday}`] = { employeeId: id, date: sunday, present: true,
        selectedPosition: 'p3', hoursWorked: 8, overtimeHours: 0, createdAt: later, updatedAt: later };
    const ctx = { ...state, projectId: 'P', getAttendance: (id, date) => state.attendance[`${id}-${date}`] };
    const gross = id => calculateEmployeePayrollWithContext(ctx, config, id, sunday, sunday, [], [], [], []).brutoOriginal;
    expect(gross('plain')).toBe(8 * 62.5 * 2);
    expect(gross('own')).toBe(gross('plain'));
});

// Decisión del usuario (2026-11-10): quién trabajó para quién queda como se
// registró; lo que vale ese trabajo sigue la configuración vigente en todo el
// período abierto, igual para empleados con o sin líder individual.
describe('open-period pay follows the current configuration for everyone', () => {
    const DAY = '2026-11-09', SUNDAY = '2026-11-15';
    function pair() {
        const state = fixture();
        state.employees = [{ id: 'plain', number: '1', name: 'Pedro', positions: ['p3'] },
            { id: 'own', number: '2', name: 'Juan', positions: ['p3'] }];
        state.employees[1].positionAssignments = prepareEmployeePositionAssignments(
            state.employees[1], { p3: { workLeaderId: 'L1' } }, state, NOW);
        return state;
    }
    const both = (state, date, extra) => { attend(state, 'plain', 'p3', date, extra); attend(state, 'own', 'p3', date, extra); };
    const legacy = (state, id, date) => new PayrollService(state).calculateEmployeePayroll(id, date, date, [], [], []);
    const scoped = (state, id, date) => calculateEmployeePayrollWithContext(
        { ...state, projectId: 'obra', getAttendance: (emp, day) => state.attendance[`${emp}-${day}`] },
        { projectId: 'obra', regularHoursPerDay: state.settings.regularHoursPerDay, overtimeFactor: state.settings.overtimeFactor,
            holidayFactor: state.settings.holidayFactor, holidays: state.settings.holidays }, id, date, date, [], [], [], []);

    test.each([['legacy', legacy], ['scoped', scoped]])('a catalogue raise reaches days already recorded (%s)', (_name, pay) => {
        const state = pair(); both(state, DAY);
        expect(state.attendance[`own-${DAY}`].positionAssignments.p3.hourlyRate).toBe(62.5);
        state.positions[2].hourlyRate = 93.75;
        expect(pay(state, 'plain', DAY).brutoOriginal).toBe(750);
        expect(pay(state, 'own', DAY).brutoOriginal).toBe(750);
        expect(pay(state, 'own', DAY).breakdown[0]).toMatchObject({ hourlyRate: 93.75, workLeaderId: 'L1', payerLeaderId: 'L1' });
    });

    test.each([['legacy', legacy], ['scoped', scoped]])('a personal rate change reaches days already recorded (%s)', (_name, pay) => {
        const state = pair(); both(state, DAY);
        const juan = state.employees[1];
        juan.positionAssignments = prepareEmployeePositionAssignments(juan, { p3: { workLeaderId: 'L1' } }, state, NOW + 5000, { p3: 100 });
        juan.positionSalaries = { p3: 100 };
        expect(pay(state, 'own', DAY).breakdown).toHaveLength(1);
        expect(pay(state, 'own', DAY).brutoOriginal).toBe(800);
    });

    test.each([['legacy', legacy], ['scoped', scoped]])('overtime factor, calendar holidays and working days stay live (%s)', (_name, pay) => {
        const state = pair(); both(state, DAY, { overtimeHours: 2 });
        state.settings.overtimeFactor = 2;
        expect(pay(state, 'own', DAY).brutoOriginal).toBe(pay(state, 'plain', DAY).brutoOriginal);
        expect(pay(state, 'own', DAY).breakdown[0].overtimeAmount).toBe(2 * 62.5 * 2);
        state.settings.holidays = [DAY];
        expect(pay(state, 'plain', DAY).breakdown[0].holidayAmount).toBe(8 * 62.5 * 2);
        expect(pay(state, 'own', DAY).breakdown[0].holidayAmount).toBe(8 * 62.5 * 2);
    });

    test.each([['legacy', legacy], ['scoped', scoped]])('a rest day pays what the leader of that work pays (%s)', (_name, pay) => {
        const state = pair();
        state.leaders = [{ id: 'L1', name: 'Luis', restDayFactor: 3 }, { id: 'L2', name: 'Marcos', restDayFactor: 2 }];
        both(state, SUNDAY);
        expect(pay(state, 'plain', SUNDAY).brutoOriginal).toBe(8 * 62.5 * 2); // catalogue leader L2
        expect(pay(state, 'own', SUNDAY).brutoOriginal).toBe(8 * 62.5 * 3);   // individual leader L1
        state.leaders[0].restDayFactor = 4;                                    // the leader changes what he pays
        expect(pay(state, 'own', SUNDAY).brutoOriginal).toBe(8 * 62.5 * 4);
    });
});

test('salary estimates tolerate a job that is missing from the catalogue', () => {
    const service = new PayrollService({ ...fixture(), positions: [] });
    expect(service.calculateMonthlyEstimate({ id: 'e', positions: ['gone'] }).total).toBe(0);
    expect(() => service.getSalaryConfig({ id: 'e', positions: ['gone'], salaryConfig: { type: 'standard' } })).not.toThrow();
});
