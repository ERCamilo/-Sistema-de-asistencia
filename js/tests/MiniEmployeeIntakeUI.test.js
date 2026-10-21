import { renderEmployeeIntakeReview } from '../modules/features/p2p/MiniEmployeeIntakeUI.js';
const payload={schema:'mini-roster-proposal/v1',proposalId:'p-1',requestId:'r-1',saProjectId:'P-1',salaryPeriod:'daily',currency:'DOP',generatedAt:'2026-10-14T12:00:00.000Z',employees:[{miniLocalId:'m-1',number:'1',name:'Ana',position:'Ayudante',dailySalary:1500,phone:'',email:''}]};
let host,model,store,entry;
const scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);model={employees:[],positions:[],settings:{regularHoursPerDay:8}};entry={id:'entry-1',peerId:'mini-1',peerName:'Mini',payload,mappings:[],status:'pending'};store={linksFor:async()=>({}),accept:jest.fn()};});
afterEach(()=>{document.body.innerHTML='';});
const open=()=>renderEmployeeIntakeReview(host,entry,{store,readState:()=>model,resolveScope:async()=>scope,readOwner:()=> 'owner-1',sendResult:()=>true});
test('editar contactos no escribe hasta aceptar y un fallo mantiene el borrador',async()=>{
 await open();const phone=host.querySelector('[data-intake-field="phone"]');phone.value='8095550100';phone.dispatchEvent(new Event('input',{bubbles:true}));expect(store.accept).not.toHaveBeenCalled();
 store.accept.mockRejectedValue(new Error('Disco lleno'));host.querySelector('[data-intake-accept]').click();await new Promise(r=>setTimeout(r,0));
 expect(host.querySelector('[role="status"]').textContent).toContain('Disco lleno');expect(phone.value).toBe('8095550100');
 expect(store.accept.mock.calls[0][1][0].fields.phone).toBe('8095550100');
});
test('duplicado queda pendiente; vincular muestra y conserva los datos de SA',async()=>{
 model.employees=[{id:'e-1',number:'1',name:'Ana SA',phone:'555',positions:['p-1'],positionSalaries:{'p-1':200},projectId:'P-1'}];model.positions=[{id:'p-1',name:'Ayudante',projectId:'P-1'}];
 await open();expect(host.querySelector('[data-intake-action]').value).toBe('pending');
 const action=host.querySelector('[data-intake-action]');action.value='link';action.dispatchEvent(new Event('change',{bubbles:true}));
 const target=host.querySelector('[data-intake-target]');target.value='e-1';target.dispatchEvent(new Event('change',{bubbles:true}));
 expect(host.querySelector('[data-intake-field="phone"]').value).toBe('555');expect(host.querySelector('[data-intake-field="phone"]').disabled).toBe(true);
 expect(host.querySelector('[data-intake-field="dailySalary"]').value).toBe('1600');
});
test('no expone el personal si cambia la cuenta durante la lectura',async()=>{
 let owner='A';store.linksFor=async()=>{owner='B';return {};};
 await expect(renderEmployeeIntakeReview(host,entry,{store,readState:()=>model,resolveScope:async()=>scope,readOwner:()=>owner})).rejects.toThrow(/cuenta/);
 expect(host.textContent).toBe('');
});
test('un cambio de selector conserva la tarjeta, su apertura y el borrador',async()=>{
 await open();const card=host.querySelector('[data-intake-row]');card.open=true;
 const phone=host.querySelector('[data-intake-field="phone"]');phone.value='555';phone.dispatchEvent(new Event('input',{bubbles:true}));
 const position=host.querySelector('[data-intake-position]');position.value='new';position.dispatchEvent(new Event('change',{bubbles:true}));
 expect(host.querySelector('[data-intake-row]')).toBe(card);expect(card.open).toBe(true);expect(host.querySelector('[data-intake-field="phone"]').value).toBe('555');
});
test('una propuesta aceptada muestra el resultado y ofrece volver a conexiones',async()=>{
 model.employees=[{id:'e-1',number:'1',name:'Ana',projectId:'P-1'}];entry.status='resolved';entry.mappings=[{miniLocalId:'m-1',saEmployeeId:'e-1'}];
 await open();expect(host.querySelector('[data-intake-accept]')).toBeNull();expect(host.querySelector('[data-intake-discard]')).toBeNull();
 expect(host.querySelector('[data-intake-done]').textContent).toContain('Volver');expect(host.querySelector('[data-intake-message]').textContent).toContain('aceptado');
});
test('una propuesta local acepta sin enviar nada a Mini y ofrece volver a la asistencia',async()=>{
 entry.local=true;const sendResult=jest.fn(()=>true);
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-9'}]}});
 await renderEmployeeIntakeReview(host,entry,{store,readState:()=>model,resolveScope:async()=>scope,readOwner:()=> 'owner-1',sendResult});
 host.querySelector('[data-intake-accept]').click();await new Promise(r=>setTimeout(r,0));
 expect(sendResult).not.toHaveBeenCalled();
 const message=host.querySelector('[data-intake-message]').textContent;
 expect(message).toContain('1 empleados aceptados');expect(message).toContain('asistencia');expect(message).not.toContain('Vuelve a enviar');
 expect(host.querySelector('[data-intake-done]').textContent).toContain('asistencia');
});
