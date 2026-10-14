import { buildEmployeeIntakePlan, intakeSuggestions } from '../modules/features/p2p/MiniEmployeeIntake.js';
const proposal={schema:'mini-roster-proposal/v1',proposalId:'p-1',requestId:'r-1',saProjectId:'P-1',salaryPeriod:'daily',currency:'DOP',generatedAt:'2026-10-14T12:00:00.000Z',employees:[{miniLocalId:'m-1',number:'001',name:'Ana',position:'Ayudante',dailySalary:1500,phone:'8095550100',email:''}]};
const scope={enabled:true,projectId:'P-1',defaultProjectId:'P-1'};
const context={scope,employees:[],positions:[],hoursPerDay:8,now:123,createId:(kind)=>kind+'-new'};
test('alta requiere decisión, convierte diario y devuelve vínculo estable',()=>{
 const plan=buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create'}],context);
 expect(plan.employees[0].projectId).toBe('P-1'); expect(plan.employees[0].positionSalaries['pos-new']).toBe(187.5);
 expect(plan.employees[0].phone).toBe('8095550100'); expect(plan.mappings[0].saEmployeeId).toBe('emp-new');
 expect(proposal.employees[0]).not.toHaveProperty('saEmployeeId');
});
test('ficha ocupada y nombre duplicado requieren resolver antes de crear',()=>{
 const other={id:'emp-old',number:'1',name:'Otra persona',positions:['pos-1'],projectId:'P-1'};
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create'}],{...context,employees:[other]})).toThrow(/ficha/i);
 const homonym={...other,number:'9',name:'Ana'};
 expect(intakeSuggestions(proposal.employees[0],[homonym],scope)).toHaveLength(1);
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create'}],{...context,employees:[homonym]})).toThrow(/misma persona|duplicado/i);
});
test('vincular preserva salario/contactos existentes y dejar pendiente no crea',()=>{
 const existing={id:'emp-old',number:'2',name:'Ana SA',positions:['pos-1'],positionSalaries:{'pos-1':200},phone:'555',projectId:'P-1',active:true};
 const plan=buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'link',employeeId:'emp-old'}],{...context,employees:[existing],positions:[{id:'pos-1',name:'Ayudante',hourlyRate:100,projectId:'P-1'}]});
 expect(plan.employees).toEqual([]);expect(plan.mappings[0].dailySalary).toBe(1600);expect(plan.mappings[0].phone).toBe('555');
 expect(buildEmployeeIntakePlan(proposal,[],context).employees).toEqual([]);
});
test('no permite altas en otra obra o referencias a otro proyecto',()=>{
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create'}],{...context,scope:{...scope,projectId:'P-2'}})).toThrow(/obra/i);
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'link',employeeId:'otro'}],{...context,employees:[{id:'otro',projectId:'P-2'}]})).toThrow();
});
test('fecha de ingreso revisada e historial se conservan para asistencia anterior al alta',()=>{
 const now=new Date(2026,9,14,12).getTime();
 const plan=buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create',hireDate:'2026-10-01'}],{...context,now});
 expect(plan.employees[0].hireDate).toBe('2026-10-01');
 expect(plan.employees[0].statusHistory).toEqual([{date:'2026-10-01',active:true,timestamp:now}]);
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create',hireDate:'2026-02-30'}],{...context,now})).toThrow(/fecha/i);
});
test('reactivar agrega un cambio de estado y conserva el historial del empleado',()=>{
 const old={id:'emp-old',number:'2',name:'Ana',projectId:'P-1',active:false,hireDate:'2026-01-01',statusHistory:[{date:'2026-10-10',active:false,timestamp:123}]};
 const now=new Date(2026,9,14,12).getTime(),plan=buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'link',employeeId:old.id,reactivate:true}],{...context,employees:[old],now});
 expect(plan.employees[0].statusHistory).toEqual([...old.statusHistory,{date:'2026-10-14',active:true,timestamp:now}]);
 expect(old.statusHistory).toHaveLength(1);
});
test('un alta no asigna silenciosamente un puesto pausado',()=>{
 const positions=[{id:'pos-paused',name:'Ayudante',hourlyRate:187.5,active:false,projectId:'P-1'}];
 expect(()=>buildEmployeeIntakePlan(proposal,[{miniLocalId:'m-1',action:'create'}],{...context,positions})).toThrow(/puesto.*pausado/i);
});
