export async function startPayrollLiveSyncAfterOutboxDrain({drainOutbox,attemptLiveSync,warn=(...a)=>console.warn(...a),isCurrent=()=>true}){
    try{const d=await drainOutbox();if(!isCurrent())return false;if(d===false)warn('⚠️ Outbox no quedó vacío antes de iniciar Payroll LiveSync (drenado parcial); se intentará LiveSync de todos modos.');}
    catch(e){if(!isCurrent())return false;warn('⚠️ Error drenando outbox al iniciar sesión:',e);}
    if(!isCurrent())return false;
    try{attemptLiveSync();}catch(_){}
}
