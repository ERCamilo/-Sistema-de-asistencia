// Release logic: pure data and injected IO, without browser globals.
const APP_VERSION = '1.7.114';
const CHANGELOG = [
    { version: '1.7.114', date: '2026-10-27', title: 'Actualiza cuando estés listo', items: ['La nueva versión se prepara en segundo plano y espera tu confirmación para guardar y reiniciar.', 'Si la descarga se interrumpe, puedes reintentar o recargar sin quedar esperando indefinidamente.', 'Reparar interfaz renueva los archivos de la aplicación y conserva tus datos, fotos y comprobantes.'] },
    { version: '1.7.111', date: '2026-10-27', title: 'Tu audio, sin perder el hilo', items: ['Voz avisa cuando detecta silencio o volumen muy bajo y permite escuchar, repetir o enviar de todos modos.', 'Vuelve a Voz con Atrás después de abrir préstamos o registrar un gasto, conservando el estado de la operación.', 'Al regresar, las operaciones completadas se muestran como registradas y no vuelven a enviarse.'] },
    { version: '1.7.110', date: '2026-10-26', title: 'Tu espacio de Voz', items: ['Abre el nuevo modal de Voz desde General para configurar reconocimiento y captura.', 'Consulta, agrega, edita y elimina pronunciaciones de cada empleado.', 'Escucha y gestiona las grabaciones de esta obra sin modificar sus préstamos.'] },
    { version: '1.7.109', date: '2026-10-24', title: 'Sincronización de obras más segura', items: ['Evita mezclar obras al cambiar de cuenta o cerrar sesión.', 'Protege las horas editadas y los ajustes de nómina frente a respuestas atrasadas.', 'Mantiene la selección de obra y bloquea la sincronización durante una restauración pendiente.', 'Evita que una escritura antigua sobrescriba cambios más recientes de otro dispositivo.'] },
    { version: '1.7.108', date: '2026-10-24', title: 'Puestos semanales y reportes por empleado', items: ['Cambiar el puesto desde la vista semanal asigna las horas del día al puesto elegido y elimina el desglose anterior.', 'El cambio se guarda para la fecha editada y actualiza los cálculos de asistencia y nómina.', 'Marca «Solo empleados seleccionados» para consultar y exportar el sueldo de una o varias personas con los filtros de líder y puestos.', 'Para corregir un día guardado con un desglose anterior, vuelve a elegir su puesto y actualiza la vista previa de Nómina.'] },
    { version: '1.7.107', date: '2026-10-24', title: 'Cobros rápidos de préstamos en Nómina', items: ['Aplica a todos el máximo que permite su sueldo disponible o un cobro recomendado de hasta el 30 %, sin dejar sueldos negativos por estos cobros.', 'Los cobros respetan la obra y el líder seleccionados, cubren cuotas pendientes y conservan la deuda que no se puede cobrar.', 'Los avisos con SVG muestran cuántos empleados siguen con deuda y cuántos quedan con el sueldo en cero después del cobro.'] },
    { version: '1.7.106', date: '2026-10-24', title: 'Selector móvil y descuentos sincronizados', items: ['Selecciona empleados sin filas recortadas y conserva visibles el buscador y los botones, también en pantallas bajas.', 'Reconoce con iconos y avisos breves los saldos insuficientes, los pagos pausados y el personal fuera de nómina.', 'El monto y el porcentaje se sincronizan al elegir Todo, Solo interés, escribir una cantidad o mover una barra más compacta; el descuento se actualiza al soltarla.'] },
    { version: '1.7.105', date: '2026-10-24', title: 'Los colores de tu personal en Voz', items: ['El círculo del empleado usa el color de su posición principal, también al seleccionarlo.', 'Solo los empleados desactivados muestran la etiqueta Pausado.'] },
    { version: '1.7.104', date: '2026-10-24', title: 'Empleados más claros en Voz', items: ['Identifica al empleado por el icono de su posición principal y su estado activo o desactivado.', 'El selector de empleados abre sin enfocar el buscador; toca el campo cuando quieras escribir.'] },
    { version: '1.7.103', date: '2026-10-24', title: 'Selección más rápida y descuentos por porcentaje', items: ['Seleccionar empleados en descuentos y bonificaciones abre más rápido y conserva la lista al marcar personas.', 'En préstamos puedes usar el sueldo disponible o elegir un porcentaje con una barra y un campo numérico; la sugerencia inicial es 30 %.', 'Antes de aplicar el porcentaje ves cuánto se descuenta y cuánto sueldo queda; la deuda no cobrada sigue pendiente.'] },
    { version: '1.7.102', date: '2026-10-24', title: 'Importes y cálculos seguros en Nómina', items: ['Otro monto acepta coma decimal y conserva el descuento elegido cuando el campo está vacío o tiene un error.', 'Nómina avisa si cambian asistencias, tarifas o configuración y pide actualizar la vista previa antes de exportar o confirmar.', 'Actualizar el cálculo conserva la selección de préstamos y evita recuperar resultados anteriores al recibir cambios de otra instancia.'] },
    { version: '1.7.101', date: '2026-10-23', title: 'Equipos completos en Nómina', items: ['Cambia entre líderes o vuelve a Todos sin que desaparezcan empleados de la nómina.', 'Al activar préstamos se conserva el salario calculado de los equipos que no estaban visibles.'] },
{ version: '1.7.100', date: '2026-10-22', title: 'Preparación para detectar obras repetidas', items: ['Prepara la comparación del personal y de la asistencia de tus obras para reconocer cuando dos obras son en realidad la misma, y para recordar las que descartes.', 'Prepara una pantalla para revisar obras repetidas. Todavía no se muestra: la revisión y la fusión llegarán en una próxima versión.'] },
    { version: '1.7.99', date: '2026-10-22', title: 'Voz aprende cómo los llamas', items: ['Al elegir un empleado, decide si quieres recordar la nueva forma de llamarlo.', 'Elige la precisión de las coincidencias automáticas desde la configuración actual de Voz.', 'Las coincidencias cercanas siguen pidiendo selección; revisa el préstamo antes de registrarlo.'] },
    { version: '1.7.98', date: '2026-10-22', title: 'Préstamos abre más rápido', items: ['La pantalla de préstamos calcula los sueldos de riesgo sin copiar repetidamente toda la asistencia.', 'Los avisos de riesgo se actualizan al editar asistencias, tarifas o la configuración de nómina.', 'El resumen mensual y el historial comparten sus cálculos para evitar trabajo repetido al abrir la pantalla.'] },
    { version: '1.7.97', date: '2026-10-21', title: 'Préstamos más claros y actualización de la aplicación', items: ['Consulta los gráficos de préstamos por mes y por período también en móvil, y elige el acumulado de todo el historial.', 'Actualizar ahora renueva los archivos de la aplicación y reinicia conservando tus datos. En caso de error puedes reintentar.', 'Consulta en la ficha de préstamos cuánto lleva ganado cada empleado en el período actual, según su asistencia hasta hoy.', 'Distingue el bruto acumulado de la estimación del período completo y consulta las fechas correspondientes.'] },
    { version: '1.7.96', date: '2026-10-21', title: 'Asociaciones de Mini que se recuerdan', items: ['El aviso de personal recibido en Transferencias directas muestra completo su resumen, también en pantallas pequeñas.', 'Las asociaciones hechas al revisar personal de Mini ahora se recuerdan también cuando solo cambia el nombre, y en los empleados repetidos de otros orígenes, para no pedirlas de nuevo al importar asistencia.', 'Si en SA hay un empleado activo con el mismo número y un nombre parecido, la lista ofrece «Asociar con…» sin abrir el asistente.'] },
    { version: '1.7.95', date: '2026-10-21', title: 'Revisión de Mini unificada', items: ['Elige en General la revisión guiada o la comparación con SA, tanto para texto pegado como para Mini conectados.', 'Resuelve identidades, duplicados y distribuciones por cargo en la revisión individual sin perder el reporte original.', 'Los selectores y las acciones de vincular o registrar personal se acomodan al espacio disponible en escritorio y móvil.'] },
    { version: '1.7.94', date: '2026-10-21', title: 'Tus obras, de un vistazo', items: ['Abre el menú de obras desde su nombre en el encabezado.', 'Consulta empleados, posiciones, préstamos y otros registros por obra.', 'Borra obras vacías con confirmación y comprobación de datos antes de guardar.'] },
    { version: '1.7.93', date: '2026-10-21', title: 'Personal de Mini paso a paso', items: ['Resuelve cada empleado de Mini en pasos: primero qué hacer y luego sólo lo que hace falta.', 'Al asociar, ves primero los empleados parecidos y debajo la lista completa por ficha, con pausados.', 'Al crear, eliges el puesto con el mismo selector de Personal y puedes usar el sueldo del puesto.', 'Recuerda las asociaciones a otra ficha para próximas importaciones de asistencia.', 'Cada integración de personal queda como una sola actividad con el número de empleados.', 'Todo el personal por revisar aparece en un solo aviso, dividido por Mini y por texto pegado.', 'Si resuelves a un empleado repetido en otro Mini o en el texto, también queda resuelto allí.', 'Un empleado recordado que ya no existe en SA se puede volver a crear.'] },
    { version: '1.7.92', date: '2026-10-21', title: 'Obras con nombres claros', items: ['Evita nombres repetidos al crear o renombrar obras.', 'Resuelve coincidencias recibidas de la nube sin cambiar los datos de los empleados.', 'Retoma los nombres pendientes desde Ajustes → Proyectos.'] },
    {"version": "1.7.91", "date": "2026-10-21", "title": "Actualizaciones y novedades confiables", "items": ["Vuelve a recibir avisos de actualización y consultar las novedades de cada entrega.", "Importa empleados y salarios diarios desde los reportes de Mini y WhatsApp.", "Mejoras en el historial de préstamos y al restaurar respaldos en otro dispositivo."]},
    { version: '1.7.90', date: '2026-10-20', title: 'Novedades y actualizaciones a tu ritmo', items: ['Consulta las mejoras de cada versión desde Ajustes.', 'Elige cuándo actualizar sin interrumpir tu trabajo.', 'Busca actualizaciones y revisa sus novedades antes de instalarlas.'] },
    { version: '1.7.89', date: '2026-10-20', title: 'Exportaciones a SplitX más completas', items: ['Exporta empresa, período, días y tarifas por puesto.', 'Consulta abonos de préstamos y saldos proyectados por separado.'] }
];
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
function validVersion(value) {
    return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
        && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}
function compareVersions(a, b) {
    if (!validVersion(a) || !validVersion(b))
        return 0;
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++)
        if (left[i] !== right[i])
            return left[i] > right[i] ? 1 : -1;
    return 0;
}
function getUnseenReleases(lastSeen, changelog = CHANGELOG) {
    if (!validVersion(lastSeen))
        return [];
    return changelog.filter(release => compareVersions(release.version, lastSeen) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}
function shouldPromptForUpdate(input) {
    return input.hasController && validVersion(input.currentVersion) && validVersion(input.availableVersion)
        && compareVersions(input.availableVersion, input.currentVersion) > 0
        && (!validVersion(input.lastPromptedVersion) || compareVersions(input.availableVersion, input.lastPromptedVersion) > 0);
}
function shouldCheckForUpdate(input) {
    return input.online !== false && Number.isFinite(input.now)
        && (!Number.isFinite(input.lastCheckedAt) || input.lastCheckedAt <= 0 || input.now < input.lastCheckedAt || input.now - input.lastCheckedAt >= CHECK_INTERVAL_MS);
}
function isReleaseManifest(value) {
    var _a;
    if (!value || typeof value !== 'object')
        return false;
    const data = value;
    return validVersion(data.version) && Array.isArray(data.changelog) && data.changelog.length > 0 && data.changelog.length <= 100
        && ((_a = data.changelog[0]) === null || _a === void 0 ? void 0 : _a.version) === data.version && data.changelog.every((entry, index) => validVersion(entry === null || entry === void 0 ? void 0 : entry.version) && (index === 0 || compareVersions(data.changelog[index - 1].version, entry.version) > 0)
        && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && typeof entry.title === 'string' && entry.title.length > 0 && entry.title.length <= 200
        && Array.isArray(entry.items) && entry.items.length > 0 && entry.items.length <= 30
        && entry.items.every(item => typeof item === 'string' && item.length > 0 && item.length <= 500));
}

function getReleaseErrors(previous, current, runtimeChanged) {
    if (!isReleaseManifest(current) || !current.changelog.every(entry => entry.title.trim() && entry.items.every(item => item.trim())))
        return ['El catálogo debe contener una versión válida y novedades con título e ítems no vacíos.'];
    if (!runtimeChanged || previous === null) return [];
    if (!isReleaseManifest(previous)) return ['No se pudo validar el catálogo de la versión base.'];
    const errors = [];
    if (compareVersions(current.version, previous.version) <= 0)
        errors.push(`Los cambios de la aplicación requieren una versión mayor que ${previous.version}.`);
    if (JSON.stringify(current.changelog[0].items.map(item => item.trim())) === JSON.stringify(previous.changelog[0].items.map(item => item.trim())))
        errors.push('Añade novedades propias de esta entrega; no reutilices las de la versión anterior.');
    if (previous.changelog.some(entry => !current.changelog.some(saved => saved.version === entry.version && JSON.stringify(saved) === JSON.stringify(entry))))
        errors.push('Conserva el historial publicado y añade las novedades arriba.');
    return errors;
}

export { getReleaseErrors, APP_VERSION, CHANGELOG, CHECK_INTERVAL_MS, compareVersions, getUnseenReleases, shouldPromptForUpdate, shouldCheckForUpdate, isReleaseManifest };
