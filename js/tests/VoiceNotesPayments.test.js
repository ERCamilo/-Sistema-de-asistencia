import fs from 'fs';
import path from 'path';
import { readVoiceResponse, voiceHardBlocked } from '../modules/features/voice/VoiceCore.js';
import { voiceActionDraft } from '../modules/features/voice/VoiceActionDrafts.js';
import { suggestedVoiceIntent } from '../modules/features/voice/VoiceIntent.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';

const response = (intent = 'registrar_abono') => ({ok:true,schemaVersion:1,requestId:'r1',result:{
    transcript: intent === 'crear_nota' ? 'Anota que Carlos no vino' : 'Carlos abonó 500',intent,
    employee:{spokenName:'Carlos',spokenNumber:null},loan:null,pettyCash:null,extracted:null,
    note:intent === 'crear_nota' ? {text:'no vino',date:null} : null,
    payment:intent === 'registrar_abono' ? {amount:500,date:null,note:null,spokenLoanNumber:null,channel:null,payrollDate:null} : null,
    needsReview:true,issues:[],evidence:{employee:'Carlos',principal:null,interestRate:null,installmentCount:null,installmentFrequencyWeeks:null}
}});
function fixture(intent) {
    const store = {put:jest.fn(async()=>{}),remove:jest.fn(async()=>{}),aliases:async()=>[]};
    const adapter = {getUser:()=>({uid:'u'}),getScope:()=>({enabled:false}),getEmployees:()=>[{id:'a',name:'Carlos',number:'001'}],getSettings:()=>({}),
        onNoteDraft:jest.fn(async()=>{}),onPaymentDraft:jest.fn(async()=>{}),onLoan:jest.fn(),onAttendance:jest.fn()};
    const ui = new VoiceMvpUI(adapter,{store}); ui.close=jest.fn();ui.render=jest.fn();ui.dialog={open:false,showModal:jest.fn()};
    ui.record={uid:'u',projectKey:'legacy',requestId:'r1',audio:new Blob(['audio'])};ui.applyResult(readVoiceResponse(response(intent),'r1'));
    return {ui,adapter,store};
}

test.each(['crear_nota','registrar_abono'])('new explicit action %s survives extraction and uncertainty without becoming a loan', async intent=>{
    const {ui,adapter}=fixture(intent);await ui.refreshMatches();await ui.routeResult();
    const open=intent==='crear_nota'?adapter.onNoteDraft:adapter.onPaymentDraft;
    expect(open).toHaveBeenCalledTimes(1);expect(open.mock.calls[0][0]).toBe('a');
    expect(adapter.onLoan).not.toHaveBeenCalled();expect(adapter.onAttendance).not.toHaveBeenCalled();
    expect(suggestedVoiceIntent({...ui.record.result,issues:[{code:'AMBIGUOUS_INTENT'}]})).toBe(intent);
    expect(ui.record.dirty).toBe(true);
});
test('missing channel stays pending and note date defaults locally only',()=>{
    const result=readVoiceResponse(response(),'r1');expect(result.payment.channel).toBeNull();
    expect(voiceActionDraft(result,'registrar_abono','2026-11-16')).toMatchObject({amount:500,channel:'',date:'2026-11-16'});
    expect(result.payment.date).toBeNull();
});
test.each([
    r=>{r.payment.amount='500';},r=>{r.payment.date='2026-02-30';},r=>{r.payment.channel='automatic';},
    r=>{r.payment.employeeId='a';},r=>{r.payment=null;},r=>{r.note=[];}
])('invalid structured action cannot enter the form',mutate=>{const data=response();mutate(data.result);expect(()=>readVoiceResponse(data,'r1')).toThrow();});
test('negation never opens a form or bypasses the manual chooser',async()=>{
    const {ui,adapter}=fixture('registrar_abono');ui.record.result.issues=[{code:'NEGATED_ACTION',field:null,message:'No registrar'}];
    await ui.routeResult();expect(ui.view).toBe('audio');expect(adapter.onPaymentDraft).not.toHaveBeenCalled();
    await expect(ui.chooseIntent('crear_nota')).rejects.toThrow('negación');
});
test('manual corrections persist, changing employee keeps fields, completed audio cannot be reused',async()=>{
    const {ui,adapter,store}=fixture('registrar_abono');await ui.refreshMatches();await ui.routeResult();
    const context=adapter.onPaymentDraft.mock.calls[0][1];context.onChange({amount:650,note:'Manual',channel:'cash',date:'2026-11-15',target:'account'});
    await ui.actionDraftSave;
    expect(ui.record.actionDrafts.registrar_abono).toMatchObject({amount:650,note:'Manual'});
    context.changeEmployee();await Promise.resolve();expect(ui.record.selectedEmployeeId).toBeNull();
    ui.record.selectedEmployeeId='a';await ui.openActionForm();
    const next=adapter.onPaymentDraft.mock.calls.at(-1)[1];expect(next.draft).toMatchObject({amount:650,target:'account'});
    next.onSaved();await ui.actionDraftSave;await new Promise(resolve=>setTimeout(resolve,0));
    expect(store.remove).toHaveBeenCalledWith('u','r1');expect(ui.record).toBeNull();
});
test('a late form cannot write after account, employee or action changes',async()=>{
    const {ui,adapter}=fixture('crear_nota');await ui.refreshMatches();await ui.routeResult();
    const context=adapter.onNoteDraft.mock.calls[0][1];adapter.getUser=()=>({uid:'other'});
    expect(()=>context.guard()).toThrow();
    adapter.getUser=()=>({uid:'u'});ui.record.selectedEmployeeId=null;expect(()=>context.guard()).toThrow();
});

const directory=path.join(process.cwd(),'docs/voice/n8n-notes-payments');
function validateProvider(data) {
    const code=fs.readFileSync(path.join(directory,'validate-response.js'),'utf8');
    return new Function('$input','$',code)({first:()=>({json:{body:{candidates:[{content:{parts:[{text:JSON.stringify(data)}]}}]}}})},()=>({first:()=>({json:{requestId:'r1'}})}))[0].json;
}
test.each(['crear_nota','registrar_abono'])('actual n8n validator and SA agree on %s',intent=>{
    const result=validateProvider(response(intent).result);expect(result.valid).toBe(true);
    expect(readVoiceResponse(result.body,'r1').intent).toBe(intent);
});
test('n8n validates keys rather than rejecting note content mentioning saldo/IDs',()=>{
    const data=response('crear_nota').result;data.note.text='Saldo pendiente; revisar employeeId en el reporte';
    expect(validateProvider(data).valid).toBe(true);
    data.note.employeeId='a';expect(validateProvider(data).valid).toBe(false);
});
test('n8n rejects multiple payloads and invalid dates but preserves legitimate negative note content',()=>{
    const data=response('crear_nota').result;expect(validateProvider(data).valid).toBe(true);expect(voiceHardBlocked(data)).toBe(false);
    data.note.date='2026-02-30';expect(validateProvider(data).valid).toBe(false);
    data.note.date=null;data.payment={...response().result.payment};expect(validateProvider(data).valid).toBe(false);
});
test('Gemini request has the extended JSON schema and audio, without the Firebase token or employee catalog',()=>{
    const code=fs.readFileSync(path.join(directory,'prepare-request.js'),'utf8');
    const json={requestId:'r1',uid:'u',idToken:'do-not-forward',fileBase64:'YXVkaW8=',mimeType:'audio/webm',context:{localDate:'2026-11-16'},GeminiPromp:fs.readFileSync(path.join(directory,'prompt.txt'),'utf8')};
    const result=new Function('$input',code)({first:()=>({json})})[0].json;
    const schema=result.geminiBody.generationConfig.responseJsonSchema;
    expect(schema.properties.intent.enum).toEqual(expect.arrayContaining(['crear_nota','registrar_abono']));
    expect(JSON.stringify(result.geminiBody)).not.toMatch(/do-not-forward|"employees"|"uid"/);
});
