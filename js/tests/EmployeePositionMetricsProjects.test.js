import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setActivePayrollConfig, resetActivePayrollSettingsForTests } from '../modules/features/payroll/ActivePayrollSettings.js';
import * as configStore from '../modules/features/payroll/ProjectPayrollConfigStore.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';
import { buildEmployeePositionPeriodSnapshot, getPositionPeriodMetrics, getPositionTotalHours } from '../modules/features/employees/EmployeePositionMetrics.js';
import { renderEmployeePositionEditor, attachEmployeePositionEditor } from '../modules/features/employees/EmployeePositionEditor.js';

const config = { projectId:'P', updatedAt:1, regularHoursPerDay:8, overtimeFactor:1.5, holidayFactor:2,
    holidays:['2026-07-03'], payPeriod:{periodStart:'2026-07-01',periodLength:21} };
const records = () => ({
    'e1-2026-07-02':{employeeId:'e1',projectId:'P',date:'2026-07-02',present:true,selectedPosition:'p1',hoursWorked:8,overtimeHours:2},
    'e1-2026-07-03':{employeeId:'e1',projectId:'P',date:'2026-07-03',present:true,selectedPosition:'p1',hoursWorked:8,overtimeHours:0},
    'e1-2026-07-04':{employeeId:'e1',projectId:'P',date:'2026-07-04',present:true,multiPosition:true,positionHours:[{positionId:'p1',hours:4,overtimeHours:1},{positionId:'p2',hours:4,overtimeHours:0}]},
    'e1-2026-07-05':{employeeId:'e1',projectId:'Q',date:'2026-07-05',present:true,selectedPosition:'p1',hoursWorked:20,overtimeHours:2},
    'e1-2026-01-02':{employeeId:'e1',projectId:'P',date:'2026-01-02',present:true,selectedPosition:'p1',hoursWorked:20}
});
function fixture(attendance = records()) {
    return { settings:{regularHoursPerDay:8,overtimeFactor:9,holidayFactor:9,holidays:[],payPeriod:{periodStart:'2026-01-01',periodLength:15}},
        employees:[{id:'e1',projectId:'P',name:'Juan',positions:['p1','p2'],positionSalaries:{p2:200}}],
        positions:[{id:'p1',projectId:'P',name:'Operador',hourlyRate:100,leaderId:'L1',workingDays:[1,2,3,4,5]},
            {id:'p2',projectId:'P',name:'Capataz',hourlyRate:150,leaderId:'L2',workingDays:[1,2,3,4,5]}],
        leaders:[{id:'L1',projectId:'P',name:'Luis'},{id:'L2',projectId:'P',name:'Marcos'}],attendance };
}
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
function mount(state, ensureAttendanceRange) {
    const root=document.createElement('div');document.body.appendChild(root);
    root.innerHTML=renderEmployeePositionEditor(state,state.employees[0],8);
    const controller=attachEmployeePositionEditor({root,state,employee:state.employees[0],regularHours:8,ensureAttendanceRange});
    return {root,controller};
}
beforeEach(()=>{
    setProjectsEnabled(true);replaceEntityScope({enabled:true,projectId:'P',defaultProjectId:'P'});
    setActivePayrollConfig(config,{render:false});
    jest.spyOn(configStore,'getConfig').mockResolvedValue(config);
});
afterEach(()=>{
    jest.restoreAllMocks();resetActivePayrollSettingsForTests();resetEntityScope();setProjectsEnabled(false);document.body.replaceChildren();
});

test('uses actual work in the active project/period, including multiposition and overtime, without legacy payroll',()=>{
    const state=fixture();const legacy=jest.spyOn(PayrollService.prototype,'calculateEmployeePayroll');
    const snapshot=buildEmployeePositionPeriodSnapshot(state,state.employees[0]);
    expect(snapshot.period).toMatchObject({periodStart:'2026-07-01',periodEnd:'2026-07-21'});
    const operator=getPositionPeriodMetrics(snapshot,'p1'),foreman=getPositionPeriodMetrics(snapshot,'p2');
    expect(operator).toMatchObject({days:3,regularHours:8,holidayHours:8,restDayHours:4,overtimeHours:3});
    expect(getPositionTotalHours(operator)).toBe(23);expect(foreman.days).toBe(1);expect(getPositionTotalHours(foreman)).toBe(4);
    expect(legacy).not.toHaveBeenCalled();
});

test('counts one worked date even when the same job appears twice on that date',()=>{
    const state=fixture({'e1-2026-07-02':{employeeId:'e1',projectId:'P',date:'2026-07-02',present:true,positionHours:[{positionId:'p1',hours:4},{positionId:'p1',hours:4}]}});
    const metrics=getPositionPeriodMetrics(buildEmployeePositionPeriodSnapshot(state,state.employees[0]),'p1');
    expect(metrics.days).toBe(1);expect(getPositionTotalHours(metrics)).toBe(8);
});

test('missing project configuration displays unavailable metrics rather than false zeroes from global settings',()=>{
    resetActivePayrollSettingsForTests();const state=fixture();const snapshot=buildEmployeePositionPeriodSnapshot(state,state.employees[0]);
    expect(snapshot.metricsAvailable).toBe(false);expect(snapshot.period.source).toBe('pending');
    const root=document.createElement('div');root.innerHTML=renderEmployeePositionEditor(state,state.employees[0],8);
    expect(root.querySelector('[data-position-days]').textContent).toBe('—');
    expect(root.querySelector('[data-position-period-label]').textContent).not.toContain('2026-01');
});

test('loads the whole period and updates only metrics while preserving typed salary, leader, focus and input nodes',async()=>{
    const state=fixture({});let complete;
    const ensure=jest.fn(()=>new Promise(resolve=>{complete=()=>{state.attendance=records();resolve();};}));
    const {root,controller}=mount(state,ensure);await tick();
    expect(ensure).toHaveBeenCalledWith('2026-07-01','2026-07-21');
    expect(root.querySelector('[data-position-days]').textContent).toBe('—');
    const input=root.querySelector('.custom-salary-input'),leader=root.querySelector('[data-position-work-leader]');
    input.value='123';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
    leader.value='L2';leader.dispatchEvent(new Event('change',{bubbles:true}));
    complete();await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('3');
    expect(root.querySelector('[data-position-total-hours]').textContent).toBe('23h');
    expect(root.querySelector('.custom-salary-input')).toBe(input);expect(input.value).toBe('123');expect(document.activeElement).toBe(input);
    expect(leader.value).toBe('L2');expect(root.querySelector('[data-employee-position-editor]').getAttribute('aria-busy')).toBe('false');
});

test('an incomplete download keeps placeholders and permits retry without clearing edited fields',async()=>{
    const state=fixture({});const ensure=jest.fn().mockRejectedValueOnce(new Error('Sin conexión')).mockImplementationOnce(async()=>{state.attendance=records();});
    const {root,controller}=mount(state,ensure);const input=root.querySelector('.custom-salary-input');input.value='321';
    await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('—');expect(root.querySelector('[data-position-metrics-message]').textContent).toBe('Sin conexión');
    root.querySelector('[data-retry-position-metrics]').click();await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('3');expect(input.value).toBe('321');
    expect(root.querySelector('[data-position-metrics-notice]').hidden).toBe(true);
});

test('a late completion after changing project cannot paint another project into the open editor',async()=>{
    const state=fixture({});let complete;
    const {root,controller}=mount(state,()=>new Promise(resolve=>{complete=resolve;}));await tick();
    replaceEntityScope({enabled:true,projectId:'Q',defaultProjectId:'P'});complete();await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('—');
    expect(root.querySelector('[data-position-metrics-message]').textContent).toContain('Cambió la obra');
});

test('a period change during download requires retry rather than presenting an unloaded range as zero',async()=>{
    const state=fixture({});let complete;
    const {root,controller}=mount(state,()=>new Promise(resolve=>{complete=resolve;}));await tick();
    setActivePayrollConfig({...config,updatedAt:2,payPeriod:{periodStart:'2026-08-01',periodLength:15}},{render:false});
    complete();await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('—');
    expect(root.querySelector('[data-position-metrics-message]').textContent).toContain('Cambió el período');
});

test('a successfully loaded empty period is a real zero, not a pending placeholder',async()=>{
    const state=fixture({});const {root,controller}=mount(state,async()=>{});await controller.ready;
    expect(root.querySelector('[data-position-days]').textContent).toBe('0');
    expect(root.querySelector('[data-position-total-hours]').textContent).toBe('0h');
    expect(root.querySelector('[data-position-metrics-notice]').hidden).toBe(true);
});

test('quarter-hour work retains its precision in the displayed total',()=>{
    const state=fixture({'e1-2026-07-02':{employeeId:'e1',projectId:'P',date:'2026-07-02',present:true,selectedPosition:'p1',hoursWorked:7.25}});
    const root=document.createElement('div');root.innerHTML=renderEmployeePositionEditor(state,state.employees[0],8);
    expect(root.querySelector('[data-position-total-hours]').textContent).toBe('7.25h');
});
