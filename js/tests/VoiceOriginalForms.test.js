import { state } from '../modules/core/AppState.js';
import { resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { createLoan, getBalance } from '../modules/features/loans/LoansService.js';
import { openVoiceAccountPaymentDraft, laSave, laField, laFieldQuiet, laClose, laVoiceChangeEmployee } from '../modules/features/loans/LoanAccountController.js';
import { getAccountPayPeriods } from '../modules/features/loans/LoanAccountView.js';
import { openVoiceNoteDraft, saveNoteModal, setNoteModalText, setNoteModalDate, closeNoteModal, changeVoiceNoteEmployee } from '../modules/features/notes/NotesController.js';
import { NoteEditorModal } from '../modules/features/notes/NoteEditorModal.js';
import { clearNote } from '../modules/features/notes/NotesService.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
jest.mock('../modules/services/PersistenceService.js',()=>({saveApplicationData:jest.fn()}));
const context = (draft,requestId='r1')=>({employeeId:'a',uid:'u',requestId,draft,transcript:'Carlos dijo </textarea><img src=x onerror=alert(1)>',issues:[],needsReview:true,
    guard:jest.fn(),onChange:jest.fn(),onSaved:jest.fn(),changeEmployee:jest.fn()});
function addLoan(amount=1000,rate=20) {
    return createLoan(state.employees[0],{principal:amount,interestRate:rate,interestIncluded:false,installmentMode:'lump',startDate:'2026-10-01',dueDate:'2026-12-01'});
}
const savedLoan = loan => state.employees[0].loans.find(l => l.id === loan.id);
beforeEach(()=>{
    resetEntityScope();window.showNotification=jest.fn();window.showAlert=jest.fn();
    state.employees=[{id:'a',number:'001',name:'Carlos',loans:[],positions:['p']},{id:'b',name:'Otra',loans:[]}];
    state.attendance={};state.showNoteModal=false;state.noteModalVoice=null;
    state.settings={regularHoursPerDay:8,holidays:[],payPeriod:{periodStart:'2026-08-21',periodLength:21,payDay:'2026-09-12'}};
    state.loansLedger={selectedEmployeeId:'a',account:{tab:'loans',modal:null}};
    closeNoteModal();state.showNotesCenter=false;laClose();saveApplicationData.mockClear();
});
afterEach(()=>{closeNoteModal();laClose();});
test('repayment prefill never writes; original save uses the existing interest/capital allocation once',()=>{
    const loan=addLoan();const ctx=context({amount:500,date:'2026-11-16',note:'anticipo',channel:'cash',period:'',spokenLoanNumber:null});
    saveApplicationData.mockClear();openVoiceAccountPaymentDraft('a',ctx);
    expect(savedLoan(loan).payments).toHaveLength(0);expect(saveApplicationData).not.toHaveBeenCalled();
    laSave();expect(savedLoan(loan).payments).toHaveLength(1);expect(savedLoan(loan).payments[0]).toMatchObject({amount:500,note:'anticipo',channel:'cash',voiceRequestId:'r1',voiceActorUid:'u',allocation:{interest:200,capital:300}});
    expect(getBalance(savedLoan(loan))).toBe(700);expect(ctx.onSaved).toHaveBeenCalledTimes(1);
    openVoiceAccountPaymentDraft('a',ctx);laSave();expect(savedLoan(loan).payments).toHaveLength(1);expect(window.showAlert).toHaveBeenLastCalledWith(expect.stringContaining('ya se utilizó'),'error');
});
test('an account payment splits normally and all pieces retain the same source',()=>{
    const l1=addLoan(1000),l2=addLoan(500);const ctx=context({amount:500,date:'2026-11-16',channel:'cash',note:'parcial'});
    openVoiceAccountPaymentDraft('a',ctx);laSave();
    const payments=[...savedLoan(l1).payments,...savedLoan(l2).payments];expect(payments).toHaveLength(2);
    expect(payments.reduce((sum,p)=>sum+p.amount,0)).toBe(500);
    expect(new Set(payments.map(p=>p.accountTxId)).size).toBe(1);
    expect(payments.every(p=>p.voiceRequestId==='r1')).toBe(true);
});
test('specific loan number resolves locally; direct payment keeps its normal origin and no account transaction',()=>{
    const l1=addLoan(),l2=addLoan(500);const ctx=context({amount:100,date:'2026-11-16',channel:'transfer',spokenLoanNumber:'2'});
    openVoiceAccountPaymentDraft('a',ctx);expect(state.loansLedger.account.modal.target).toBe(l2.id);laSave();
    expect(savedLoan(l1).payments).toHaveLength(0);expect(savedLoan(l2).payments[0].origin).toBe('direct');expect(savedLoan(l2).payments[0].accountTxId).toBeUndefined();
});
test.each([
    {channel:''},{spokenLoanNumber:'999'}, {date:'2026-02-30'},{amount:9999},{channel:'payroll',period:''}
])('incomplete or invalid repayment cannot be committed: %j',overrides=>{
    const loan=addLoan();const ctx=context({amount:100,date:'2026-11-16',channel:'cash',...overrides});
    saveApplicationData.mockClear();openVoiceAccountPaymentDraft('a',ctx);laSave();
    expect(savedLoan(loan).payments).toHaveLength(0);expect(saveApplicationData).not.toHaveBeenCalled();expect(ctx.onSaved).not.toHaveBeenCalled();
});
test('payroll repayments use the selected existing payroll period',()=>{
    const loan=addLoan();const period=getAccountPayPeriods()[0];expect(period).toBeTruthy();
    openVoiceAccountPaymentDraft('a',context({amount:100,date:'2026-11-16',channel:'payroll',period:period.payDate}));laSave();
    expect(savedLoan(loan).payments[0]).toMatchObject({channel:'payroll',payrollPeriodStart:period.start,payrollPeriodEnd:period.end});
});
test('editing, cancellation and changing employee preserve the draft without paying',()=>{
    const loan=addLoan();const ctx=context({amount:100,date:'2026-11-16',channel:''});openVoiceAccountPaymentDraft('a',ctx);
    laField('amount','125');laFieldQuiet('note','editado');laVoiceChangeEmployee();
    expect(ctx.onChange).toHaveBeenLastCalledWith(expect.objectContaining({amount:'125',note:'editado'}));expect(ctx.changeEmployee).toHaveBeenCalled();expect(savedLoan(loan).payments).toHaveLength(0);
});
test('late session/scope/employee guards prevent a payment',()=>{
    const loan=addLoan();const ctx=context({amount:100,date:'2026-11-16',channel:'cash'});openVoiceAccountPaymentDraft('a',ctx);
    ctx.guard.mockImplementation(()=>{throw Error('Cambió la cuenta o proyecto');});laSave();expect(savedLoan(loan).payments).toHaveLength(0);
    ctx.guard.mockImplementation(()=>{});state.loansLedger.selectedEmployeeId='b';laSave();expect(savedLoan(loan).payments).toHaveLength(0);
});
test('dictation appends to the latest note only on save, preserves attendance and cannot replay even after clearing text',()=>{
    state.attendance['a-2026-11-16']={employeeId:'a',date:'2026-11-16',notes:'Anterior',hoursWorked:8,overtimeHours:2,present:true,selectedPosition:'p'};
    const ctx=context({text:'no vino',date:'2026-11-16'});openVoiceNoteDraft('a',ctx);
    expect(state.attendance['a-2026-11-16'].notes).toBe('Anterior');expect(saveApplicationData).not.toHaveBeenCalled();
    state.attendance['a-2026-11-16'].notes='Anterior\nNota sincronizada';setNoteModalText('no vino hoy');saveNoteModal();
    expect(state.attendance['a-2026-11-16']).toMatchObject({notes:'Anterior\nNota sincronizada\nno vino hoy',hoursWorked:8,overtimeHours:2,present:true});expect(ctx.onSaved).toHaveBeenCalledTimes(1);
    clearNote(state,'a','2026-11-16');openVoiceNoteDraft('a',ctx);saveNoteModal();expect(state.attendance['a-2026-11-16'].notes).toBe('');
    expect(window.showNotification).toHaveBeenLastCalledWith(expect.stringContaining('ya se utilizó'),'error');
});
test('note date is editable and a new note does not mark attendance present',()=>{
    const ctx=context({text:'trajo herramientas',date:'2026-11-16'});openVoiceNoteDraft('a',ctx);setNoteModalDate('2026-11-15');saveNoteModal();
    expect(state.attendance['a-2026-11-16']).toBeUndefined();expect(state.attendance['a-2026-11-15']).toMatchObject({present:false,hoursWorked:0,notes:'trajo herramientas'});
});
test('deleted attendance, invalid dates, stale context and empty notes cannot be written',()=>{
    const ctx=context({text:'nota',date:'2026-11-16'});state.attendance['a-2026-11-16']={deletedAt:1,employeeId:'a',date:'2026-11-16',notes:'borrado'};
    openVoiceNoteDraft('a',ctx);saveNoteModal();expect(state.attendance['a-2026-11-16'].notes).toBe('borrado');
    setNoteModalDate('2026-02-30');saveNoteModal();expect(saveApplicationData).not.toHaveBeenCalled();
    setNoteModalDate('2026-11-15');ctx.guard.mockImplementation(()=>{throw Error('Otra obra');});saveNoteModal();expect(state.attendance['a-2026-11-15']).toBeUndefined();
    ctx.guard.mockImplementation(()=>{});setNoteModalText('');saveNoteModal();expect(saveApplicationData).not.toHaveBeenCalled();
});
test('employee change retains editable note and transcript is rendered as literal text',()=>{
    const ctx=context({text:'</textarea><img src=x onerror=alert(1)>',date:'2026-11-16'});openVoiceNoteDraft('a',ctx);
    const el=document.createElement('div');el.innerHTML=NoteEditorModal();expect(el.querySelector('img')).toBeNull();expect(el.querySelector('textarea').value).toBe(ctx.draft.text);
    setNoteModalText('manual');changeVoiceNoteEmployee();expect(ctx.onChange).toHaveBeenLastCalledWith({text:'manual',date:'2026-11-16'});expect(ctx.changeEmployee).toHaveBeenCalled();expect(Object.keys(state.attendance)).toHaveLength(0);
});
