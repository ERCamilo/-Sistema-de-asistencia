import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import { employeePhotoService } from '../modules/services/EmployeePhotoService.js';
import { Modal } from '../modules/components/Modal.js';
import { eventBus } from '../modules/core/Events.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';

let host, modal, persist, confirm;
beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(employeePhotoService, 'getEmployeePhoto').mockResolvedValue(null);
    confirm = jest.spyOn(Modal, 'confirm').mockResolvedValue(false);
    window.showAlert = jest.fn();
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    window.render = jest.fn();
    resetEntityScope();
    Object.assign(stateManager.getState(), {
        employees: [{ id: 'e1', key: 'e1', number: '001', name: 'Ana', phone: '111',
            active: true, positions: ['p1'], hireDate: '2026-01-01', positionsUpdatedAt: 123 }],
        positions: [{ id: 'p1', name: 'Puesto', hourlyRate: 100, active: true },
            { id: 'p2', name: 'Otro', hourlyRate: 200, active: true }],
        leaders: [], attendance: {},
        settings: { regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2, holidays: [], payPeriod: {} }
    });
    persist = jest.fn();
    EmployeesUI.init({ state, saveToLocalStorage: persist, render: jest.fn(), services: {} });
    document.body.innerHTML = '<aside id="employee-editor-panel"></aside>';
    host = document.getElementById('employee-editor-panel');
});
afterEach(() => {
    document.body.innerHTML = '';
    eventBus.emit('render:complete');
    resetEntityScope();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
});
function open() { modal = EmployeeModal.open('e1', { inlineHost: host }); return modal; }
function value(id, text) { host.querySelector(`#${id}`).value = text; }
function save() { EmployeeModal.save(modal, { id: 'e1' }); }
async function settle() { await Promise.resolve(); await Promise.resolve(); }

test('merges a local name with a remote phone and preserves non-form fields', () => {
    open();
    value('empName', 'Borrador');
    state.employees[0].phone = '222';
    state.employees[0].active = false;
    state.employees[0].photo = { revision: 'remote' };
    save();
    expect(confirm).not.toHaveBeenCalled();
    expect(state.employees[0].name).toBe('Borrador');
    expect(state.employees[0].phone).toBe('222');
    expect(state.employees[0].active).toBe(false);
    expect(state.employees[0].photo.revision).toBe('remote');
    expect(state.employees[0].positionsUpdatedAt).toBe(123);
    expect(persist).toHaveBeenCalledTimes(1);
});

test('saving an untouched field preserves a remotely changed assignment', () => {
    open();
    value('empNotes', 'Local');
    state.employees[0].positions = ['p2'];
    state.employees[0].positionSalaries = { p2: 250 };
    state.employees[0].positionSalaryModes = { p2: 'daily' };
    state.employees[0].positionsUpdatedAt = 456;
    save();
    expect(state.employees[0].positions).toEqual(['p2']);
    expect(state.employees[0].positionSalaries).toEqual({ p2: 250 });
    expect(state.employees[0].positionsUpdatedAt).toBe(456);
    expect(state.employees[0].notes).toBe('Local');
    expect(confirm).not.toHaveBeenCalled();
});

test('canceling a conflict keeps the draft and does not write', async () => {
    open();
    value('empName', 'Local');
    state.employees[0].name = 'Remoto';
    save();
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Cambios en los mismos campos', message: expect.stringContaining('Nombre')
    }));
    expect(persist).not.toHaveBeenCalled();
    expect(state.employees[0].name).toBe('Remoto');
    expect(host.querySelector('#empName').value).toBe('Local');
});

test('explicit conflict confirmation replaces only locally edited fields', async () => {
    confirm.mockResolvedValue(true);
    open();
    value('empName', 'Local');
    state.employees[0].name = 'Remoto';
    state.employees[0].email = 'remote@example.com';
    save();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(state.employees[0].name).toBe('Local');
    expect(state.employees[0].email).toBe('remote@example.com');
    expect(persist).toHaveBeenCalledTimes(1);
});

test('a remote value already equal to the draft needs no conflict confirmation', () => {
    open();
    value('empName', 'Convergente');
    state.employees[0].name = 'Convergente';
    save();
    expect(confirm).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
});

test('a second remote change while confirming aborts the old save', async () => {
    let resolve;
    confirm.mockImplementation(() => new Promise(done => { resolve = done; }));
    open();
    value('empName', 'Local');
    state.employees[0].name = 'Primero';
    save();
    state.employees[0].name = 'Segundo';
    resolve(true);
    await settle();
    expect(state.employees[0].name).toBe('Segundo');
    expect(persist).not.toHaveBeenCalled();
    expect(window.showAlert).toHaveBeenCalledWith(expect.stringContaining('más cambios'), 'warning');
});

test('daily rate conversion keeps its original hours after an explicit confirmation', async () => {
    confirm.mockResolvedValue(true);
    open();
    host.querySelector('[data-salary-mode="daily"]').click();
    const rate = host.querySelector('.custom-salary-input');
    rate.value = '1200';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    state.settings.regularHoursPerDay = 6;
    save();
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('8 horas') }));
    expect(state.employees[0].positionSalaries.p1).toBe(150);
    expect(state.employees[0].positionSalaryModes.p1).toBe('daily');
    expect(persist).toHaveBeenCalledTimes(1);
});

test('an unchanged daily rate does not get converted with a new workday', () => {
    state.employees[0].positionSalaries = { p1: 150 };
    state.employees[0].positionSalaryModes = { p1: 'daily' };
    open();
    value('empName', 'Local');
    state.settings.regularHoursPerDay = 6;
    save();
    expect(state.employees[0].positionSalaries.p1).toBe(150);
    expect(confirm).not.toHaveBeenCalled();
});

test.each(['deleted', 'merged', 'scope'])('blocks saving after the employee context is %s', kind => {
    open();
    value('empName', 'Local');
    if (kind === 'deleted') state.employees = [];
    if (kind === 'merged') state.employees[0].mergedIntoId = 'other';
    if (kind === 'scope') replaceEntityScope({ enabled: true, projectId: 'other', defaultProjectId: 'default' });
    eventBus.emit('render:complete');
    save();
    expect(persist).not.toHaveBeenCalled();
    expect(window.showAlert).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(host.querySelector('[data-employee-draft-notice]').hidden).toBe(false);
    expect(host.querySelector('[data-employee-draft-notice] button').disabled).toBe(true);
});

test('requires confirmation before reloading a dirty form', async () => {
    open();
    const input = host.querySelector('#empName');
    input.value = 'Local';
    state.employees[0].name = 'Remoto';
    eventBus.emit('render:complete');
    host.querySelector('[data-employee-draft-notice] button').click();
    await settle();
    expect(host.querySelector('#empName')).toBe(input);
    expect(input.value).toBe('Local');
    confirm.mockResolvedValue(true);
    host.querySelector('[data-employee-draft-notice] button').click();
    await settle();
    expect(host.querySelector('#empName')).not.toBe(input);
    expect(host.querySelector('#empName').value).toBe('Remoto');
    expect(host.querySelector('[data-employee-draft-notice]').hidden).toBe(true);
    expect(persist).not.toHaveBeenCalled();
});

test('mobile modal shows the same external-change notice and merge behavior', () => {
    modal = EmployeeModal.open('e1');
    modal.element.querySelector('#empName').value = 'Móvil';
    state.employees[0].phone = '222';
    eventBus.emit('render:complete');
    expect(modal.element.querySelector('[data-employee-draft-notice]').hidden).toBe(false);
    save();
    expect(state.employees[0].name).toBe('Móvil');
    expect(state.employees[0].phone).toBe('222');
    expect(persist).toHaveBeenCalledTimes(1);
});

test('remote changes during the attendance-impact dialog do not apply old decisions', () => {
    state.employees[0].positions = ['p1', 'p2'];
    state.attendance['e1-2026-10-09'] = { employeeId: 'e1', date: '2026-10-09', selectedPosition: 'p2', present: true, hoursWorked: 8 };
    open();
    host.querySelector('[data-position-assignment="p2"] [data-remove-position]').click();
    let decide;
    jest.spyOn(EmployeeModal, '_showPositionRemovalImpact').mockImplementation(options => { decide = options.onDecide; });
    save();
    expect(decide).toEqual(expect.any(Function));
    state.employees[0].phone = '222';
    decide([{ fromId: 'p2', toId: 'p1' }]);
    expect(persist).not.toHaveBeenCalled();
    expect(state.employees[0].positions).toEqual(['p1', 'p2']);
    expect(state.attendance['e1-2026-10-09'].selectedPosition).toBe('p2');
});

test('removing a catalog position blocks saving a changed assignment', () => {
    open();
    const rate = host.querySelector('.custom-salary-input');
    rate.value = '150';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    state.positions = [];
    save();
    expect(persist).not.toHaveBeenCalled();
    expect(window.showAlert).toHaveBeenCalledWith(expect.stringContaining('puesto'), 'error');
});

test('swapping after replacement uses the newest previous number', async () => {
    const original = state.employees[0];
    open();
    value('empNumber', '003');
    state.employees = [{...state.employees[0], number:'002'},
       {id:'e2', key:'e2', number:'003', name:'Otro', positions:['p1'], active:true}];
    confirm.mockResolvedValue(true);
    EmployeeModal.save(modal, original);
    await settle();
    const swap = [...document.querySelectorAll('.modal-btn')].find(button=>button.textContent.includes('Intercambiar'));
    expect(swap).toBeTruthy();
    swap.click();
    expect(state.employees.find(e=>e.id==='e1').number).toBe('003');
    expect(state.employees.find(e=>e.id==='e2').number).toBe('002');
});

test('new employee daily rate asks before saving against changed workday', () => {
    open();
    const card = host.querySelector('[data-position-assignment]').outerHTML;
    modal = EmployeeModal.open(null, { inlineHost: host });
    value('empName','Nuevo');
    host.querySelector('[data-assigned-position-list]').innerHTML=card;
    host.querySelector('[data-position-assignment]').dataset.salarySource='custom';
    host.querySelector('.custom-salary-input').value='1200';
    host.querySelector('.custom-salary-mode').value='daily';
    state.settings.regularHoursPerDay=6;
    EmployeeModal.save(modal,null);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('8 horas')}));
    expect(persist).not.toHaveBeenCalled();
});

test('new employee refuses an assignment removed from catalog while drafting', () => {
    open();
    const card = host.querySelector('[data-position-assignment]').outerHTML;
    modal = EmployeeModal.open(null, { inlineHost: host });
    value('empName','Nuevo');
    host.querySelector('[data-assigned-position-list]').innerHTML=card;
    state.positions=[];
    EmployeeModal.save(modal,null);
    expect(persist).not.toHaveBeenCalled();
    expect(window.showAlert).toHaveBeenCalledWith(expect.stringContaining('puesto'),'error');
});

test('editing the draft while confirming invalidates that confirmation', async () => {
    let resolve;
    confirm.mockImplementation(() => new Promise(done=>{resolve=done;}));
    open(); value('empName','Local'); state.employees[0].name='Remoto';
    save(); value('empName','Otra edición'); resolve(true); await settle();
    expect(persist).not.toHaveBeenCalled();
    expect(state.employees[0].name).toBe('Remoto');
});

test('old attendance changed during impact cannot be overwritten', () => {
    state.employees[0].positions=['p1','p2'];
    state.attendance['e1-2020-01-01']={employeeId:'e1',date:'2020-01-01',selectedPosition:'p2',present:true,hoursWorked:8};
    open();host.querySelector('[data-position-assignment="p2"] [data-remove-position]').click();
    let decide;jest.spyOn(EmployeeModal,'_showPositionRemovalImpact').mockImplementation(options=>{decide=options.onDecide;});
    save();state.attendance['e1-2020-01-01'].hoursWorked=12;decide([{fromId:'p2',toId:'p1'}]);
    expect(persist).not.toHaveBeenCalled();expect(state.attendance['e1-2020-01-01'].selectedPosition).toBe('p2');
});

test.each(['Intercambiar','fusionar'])('remote changes during number conflict abort %s', action => {
    state.employees.push({id:'e2',key:'e2',number:'003',name:'Otro',positions:['p1'],active:true});
    const original=state.employees[0];open();value('empNumber','003');EmployeeModal.save(modal,original);
    state.employees[1].number='004';
    [...document.querySelectorAll('.modal-btn')].find(button=>button.textContent.includes(action)).click();
    expect(persist).not.toHaveBeenCalled();expect(state.employees[0].number).toBe('001');expect(state.employees).toHaveLength(2);
});


test('removing a detached editor subscription does not skip the mobile notice', () => {
    open();
    host.replaceChildren();
    modal = EmployeeModal.open('e1');
    modal.element.querySelector('#empName').value = 'Móvil';
    state.employees[0].phone = '222';
    eventBus.emit('render:complete');
    expect(modal.element.querySelector('[data-employee-draft-notice]').hidden).toBe(false);
});
