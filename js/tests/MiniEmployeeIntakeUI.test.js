import { renderEmployeeIntakeReview } from '../modules/features/p2p/MiniEmployeeIntakeUI.js';
const payload={schema:'mini-roster-proposal/v1',proposalId:'p-1',requestId:'r-1',saProjectId:'P-1',salaryPeriod:'daily',currency:'DOP',generatedAt:'2026-10-14T12:00:00.000Z',employees:[{miniLocalId:'m-1',number:'1',name:'Ana',position:'Ayudante',dailySalary:1500,phone:'',email:''}]};
let host,model,store,entry,aliasStore,picker;
const scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);model={employees:[],positions:[],settings:{regularHoursPerDay:8}};entry={id:'entry-1',peerId:'mini-1',peerName:'Mini',payload,mappings:[],status:'pending'};store={linksFor:async()=>({}),accept:jest.fn()};aliasStore={record:jest.fn().mockResolvedValue({})};picker=jest.fn();});
afterEach(()=>{document.body.innerHTML='';});
const open=(extra={})=>renderEmployeeIntakeReview(host,entry,{store,readState:()=>model,resolveScope:async()=>scope,readOwner:()=> 'owner-1',sendResult:()=>true,aliasStore,openPositionPicker:picker,...extra});
const click=selector=>{const el=host.querySelector(selector);if(!el)throw new Error(`missing ${selector}`);el.click();};
const type=(selector,value)=>{const el=host.querySelector(selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
const tick=()=>new Promise(r=>setTimeout(r,0));
const emp=(id,number,name,extra={})=>({id,number,name,projectId:'P-1',...extra});

test('la lista muestra un empleado sin resolver y al abrirlo pregunta primero qué hacer',async()=>{
 await open();expect(host.querySelector('[data-intake-summary]').textContent).toBe('Sin resolver');
 click('[data-intake-open="0"]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('action');
 expect(host.textContent).toContain('Asociar con un empleado de SA');expect(host.textContent).toContain('Agregar como empleado nuevo');expect(host.textContent).toContain('Dejar pendiente');
});

test('si hay un empleado parecido por nombre o número el primer paso lo indica',async()=>{
 model.employees=[emp('e-1','1','Otra Persona'),emp('e-2','7','Ana')];
 await open();click('[data-intake-open="0"]');
 const hint=host.querySelector('[data-intake-similar]').textContent;expect(hint).toContain('Otra Persona');expect(hint).toContain('mismo número');expect(hint).toContain('Ana');
});

test('asociar: dos secciones por ficha, mismo número marcado, pausados incluidos',async()=>{
 model.employees=[emp('e-9','9','Zeta'),emp('e-1','1','Uno Distinto'),emp('e-5','5','ana',{active:false}),emp('e-2','2','Ana')];
 await open();click('[data-intake-open="0"]');click('[data-intake-action="link"]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('target');
 const similar=[...host.querySelectorAll('[data-intake-similar-list] [data-intake-target]')].map(el=>el.dataset.intakeTarget);
 const all=[...host.querySelectorAll('[data-intake-all-list] [data-intake-target]')].map(el=>el.dataset.intakeTarget);
 expect(similar).toEqual(['e-1','e-2','e-5']);expect(all).toEqual(['e-1','e-2','e-5','e-9']);
 expect(host.querySelector('[data-intake-similar-list] [data-intake-target="e-1"] [data-intake-same-number]')).not.toBeNull();
 expect(host.querySelector('[data-intake-all-list] [data-intake-target="e-5"]').textContent).toContain('Pausado');
});

test('elegir un empleado pausado exige reactivarlo antes de continuar',async()=>{
 model.employees=[emp('e-5','5','Ana',{active:false})];
 await open();click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-5"]');
 expect(host.querySelector('[data-intake-paused]')).not.toBeNull();expect(host.querySelector('[data-intake-finish]').disabled).toBe(true);
 const reactivate=host.querySelector('[data-intake-reactivate]');reactivate.checked=true;reactivate.dispatchEvent(new Event('change',{bubbles:true}));
 expect(host.querySelector('[data-intake-finish]').disabled).toBe(false);
 click('[data-intake-finish]');expect(host.querySelector('[data-intake-summary]').textContent).toContain('Asociar con Ana');
});

test('al aceptar una asociación con otra ficha se recuerda como en la importación de asistencia',async()=>{
 model.employees=[emp('e-9','9','Ana M')];
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-9'}]}});
 await open();click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-9"]');
 expect(host.querySelector('[data-intake-remember]')).not.toBeNull();click('[data-intake-finish]');
 click('[data-intake-accept]');await tick();await tick();
 expect(store.accept.mock.calls[0][1][0]).toMatchObject({action:'link',employeeId:'e-9'});
 expect(aliasStore.record).toHaveBeenCalledWith({scope:{ownerUid:'owner-1',siteId:'P-1',sourceId:'peer:mini-1'},rawNumber:'1',rawName:'Ana',targetEmployeeId:'e-9',targetNumberSnapshot:'9',targetNameSnapshot:'Ana M'},{allowReplace:true,actorUid:'owner-1'});
});

test('nuevo: pregunta el puesto con el selector de Personal y ofrece el sueldo del puesto',async()=>{
 model.positions=[{id:'p-1',name:'Maestro',hourlyRate:200,projectId:'P-1'}];
 await open();click('[data-intake-open="0"]');click('[data-intake-action="create"]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('position');
 click('[data-intake-pick-position]');expect(picker).toHaveBeenCalledWith(expect.objectContaining({positions:model.positions,regularHours:8}));
 picker.mock.calls[0][0].onAdd(model.positions[0]);
 expect(host.querySelector('[data-intake-position-summary]').textContent).toContain('Maestro');
 click('[data-intake-next]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('salary');
 const modes=[...host.querySelectorAll('[data-intake-salary-mode]')].map(el=>el.dataset.intakeSalaryMode);
 expect(modes).toEqual(['position','mini','custom']);
 expect(host.querySelector('[data-intake-salary-mode="position"]').checked).toBe(true);
 expect(host.textContent).toContain('1,600');
 const custom=host.querySelector('[data-intake-salary-mode="custom"]');custom.checked=true;custom.dispatchEvent(new Event('change',{bubbles:true}));
 type('[data-intake-field="dailySalary"]','1800');click('[data-intake-next]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('details');
 click('[data-intake-finish]');expect(host.querySelector('[data-intake-summary]').textContent).toContain('Crear como nuevo · Maestro');
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-new'}]}});
 click('[data-intake-accept]');await tick();
 expect(store.accept.mock.calls[0][1][0]).toMatchObject({action:'create',positionId:'p-1',fields:expect.objectContaining({dailySalary:1800,position:'Maestro'})});
 expect(aliasStore.record).not.toHaveBeenCalled();
});

test('nuevo con coincidencia exige confirmar que son personas distintas',async()=>{
 model.employees=[emp('e-2','2','Ana')];
 await open();click('[data-intake-open="0"]');click('[data-intake-action="create"]');click('[data-intake-next]');click('[data-intake-next]');
 expect(host.querySelector('[data-intake-wizard]').dataset.intakeWizard).toBe('details');
 expect(host.querySelector('[data-intake-finish]').disabled).toBe(true);
 const different=host.querySelector('[data-intake-different]');different.checked=true;different.dispatchEvent(new Event('change',{bubbles:true}));
 expect(host.querySelector('[data-intake-finish]').disabled).toBe(false);
});

test('dejar pendiente vuelve a la lista y no habilita aceptar',async()=>{
 await open();click('[data-intake-open="0"]');click('[data-intake-action="pending"]');
 expect(host.querySelector('[data-intake-summary]').textContent).toBe('Pendiente');
 click('[data-intake-accept]');expect(store.accept).not.toHaveBeenCalled();expect(host.querySelector('[data-intake-message]').textContent).toContain('Resuelve al menos');
});

test('un fallo al aceptar conserva lo elegido',async()=>{
 model.employees=[emp('e-9','9','Ana M')];store.accept.mockRejectedValue(new Error('Disco lleno'));
 await open();click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-9"]');click('[data-intake-finish]');
 click('[data-intake-accept]');await tick();
 expect(host.querySelector('[role="status"]').textContent).toContain('Disco lleno');expect(host.querySelector('[data-intake-summary]').textContent).toContain('Asociar con Ana M');
});

test('no expone el personal si cambia la cuenta durante la lectura',async()=>{
 let owner='A';store.linksFor=async()=>{owner='B';return {};};
 await expect(renderEmployeeIntakeReview(host,entry,{store,readState:()=>model,resolveScope:async()=>scope,readOwner:()=>owner})).rejects.toThrow(/cuenta/);
 expect(host.textContent).toBe('');
});

test('una propuesta aceptada muestra el resultado y ofrece volver a conexiones',async()=>{
 model.employees=[emp('e-1','1','Ana')];entry.status='resolved';entry.mappings=[{miniLocalId:'m-1',saEmployeeId:'e-1'}];
 await open();expect(host.querySelector('[data-intake-accept]')).toBeNull();expect(host.querySelector('[data-intake-discard]')).toBeNull();
 expect(host.querySelector('[data-intake-done]').textContent).toContain('Volver');expect(host.querySelector('[data-intake-message]').textContent).toContain('aceptado');
});

test('una propuesta local acepta sin enviar nada a Mini y ofrece volver a la asistencia',async()=>{
 entry.local=true;const sendResult=jest.fn(()=>true);model.employees=[emp('e-9','9','Ana')];
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-9'}]}});
 await open({sendResult});click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-9"]');click('[data-intake-finish]');
 click('[data-intake-accept]');await tick();await tick();
 expect(sendResult).not.toHaveBeenCalled();
 const message=host.querySelector('[data-intake-message]').textContent;
 expect(message).toContain('1 empleados aceptados');expect(message).toContain('asistencia');expect(message).not.toContain('Vuelve a enviar');
 expect(host.querySelector('[data-intake-done]').textContent).toContain('asistencia');
});

test('al aceptar avisa de los repetidos resueltos en otros orígenes y responde a cada Mini',async()=>{
 model.employees=[emp('e-9','9','Ana')];const sendResult=jest.fn(()=>true);
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-9'}]},autoResolved:[
  {entry:{peerId:'mini-2',result:{proposalId:'x'},local:false},added:[{miniLocalId:'b1'}]},
  {entry:{peerId:'attendance:texto',result:{proposalId:'y'},local:true},added:[{miniLocalId:'t1'},{miniLocalId:'t2'}]}]});
 await open({sendResult});click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-9"]');click('[data-intake-finish]');
 click('[data-intake-accept]');await tick();await tick();
 expect(sendResult).toHaveBeenCalledWith('mini-1',expect.anything());expect(sendResult).toHaveBeenCalledWith('mini-2',{proposalId:'x'});expect(sendResult).not.toHaveBeenCalledWith('attendance:texto',expect.anything());
 expect(host.querySelector('[data-intake-message]').textContent).toContain('3 empleados repetidos en otros orígenes');
});

test('una propuesta local abierta desde SA P2P vuelve a esa pantalla y no habla de la asistencia',async()=>{
 entry.local=true;model.employees=[emp('e-9','9','Ana')];
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-9'}]}});
 await open({doneLabel:'Volver a personal por revisar'});click('[data-intake-open="0"]');click('[data-intake-action="link"]');click('[data-intake-all-list] [data-intake-target="e-9"]');click('[data-intake-finish]');
 click('[data-intake-accept]');await tick();await tick();
 expect(host.querySelector('[data-intake-done]').textContent).toContain('Volver a personal por revisar');
 expect(host.querySelector('[data-intake-message]').textContent).not.toContain('asistencia');
});

test('atajo: mismo número y nombre parecido se asocia desde la lista sin abrir el asistente',async()=>{
 model.employees=[emp('e-1','1','Ana Mora'),emp('e-2','2','Otra')];
 store.accept.mockResolvedValue({result:{mappings:[{miniLocalId:'m-1',saEmployeeId:'e-1'}]}});
 await open();
 expect(host.querySelector('[data-intake-quick="0"]').textContent).toContain('Ana Mora');
 click('[data-intake-quick="0"]');
 expect(host.querySelector('[data-intake-summary]').textContent).toContain('Asociar con Ana Mora');
 expect(host.querySelector('[data-intake-quick="0"]')).toBeNull();
 click('[data-intake-accept]');await tick();await tick();
 expect(store.accept.mock.calls[0][1][0]).toMatchObject({action:'link',employeeId:'e-1'});
 expect(aliasStore.record).toHaveBeenCalledWith(expect.objectContaining({rawNumber:'1',rawName:'Ana',targetEmployeeId:'e-1'}),{allowReplace:true,actorUid:'owner-1'});
});

test('sin atajo cuando el nombre no se parece',async()=>{
 model.employees=[emp('e-1','1','Luis Mora')];
 await open();expect(host.querySelector('[data-intake-quick="0"]')).toBeNull();
});
