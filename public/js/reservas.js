// js/reservas.js - VERSIÓN INTEGRAL: PRODUCCIÓN + AUDITORÍA COMPLETA (TRAZABILIDAD)
import { db, functions, reservasSearchIndex } from './firebase-config.js';
import { hideMapContextMenu, getModalMarkerCoords } from './mapa.js';


document.addEventListener('DOMContentLoaded', () => {
     conectarSeleccionMultiple(); 
});

// --- NUEVA FUNCIÓN REUTILIZABLE ---
export function poblarSelectDeMoviles(caches) {
    const movilSelect = document.getElementById('asignar_movil');
    if (!movilSelect) return;

    const valorActual = movilSelect.value;
    movilSelect.innerHTML = '<option value="">No asignar móvil aún</option>';

    if (caches.moviles) {
        caches.moviles.forEach(movil => {
            const choferAsignado = caches.choferes.find(c => c.movil_actual_id === movil.id);
            const choferInfo = choferAsignado ? ` - ${choferAsignado.nombre}` : ' - (Sin chofer)';
            const option = document.createElement('option');
            option.value = movil.id;
            option.textContent = `Móvil ${movil.numero}${choferInfo}`;
            movilSelect.appendChild(option);
        });
    }
    movilSelect.value = valorActual;
}

// --- BARRA DE PROGRESO (UI) ---
function actualizarProgreso(mensaje, porcentaje) {
    let progressContainer = document.getElementById('import-progress-container');
    
    if (!progressContainer) {
        const panelImportar = document.getElementById('panel-importar');
        const targetContainer = panelImportar || document.querySelector('#reservas-importadas');
        
        if (targetContainer) {
            progressContainer = document.createElement('div');
            progressContainer.id = 'import-progress-container';
            progressContainer.style.cssText = "margin: 15px 0; padding: 15px; background: #f0f8ff; border-radius: 8px; border: 1px solid #1877f2; box-shadow: 0 2px 5px rgba(0,0,0,0.1);";
            progressContainer.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold; color: #1877f2; font-family: sans-serif;" id="import-status-text">Iniciando...</div>
                <div style="width: 100%; background-color: #e9ecef; border-radius: 10px; height: 20px; overflow: hidden;">
                    <div id="import-progress-bar" style="width: 0%; height: 100%; background-color: #1877f2; border-radius: 10px; transition: width 0.5s ease-in-out; background-image: linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent); background-size: 1rem 1rem;"></div>
                </div>
            `;
            targetContainer.insertBefore(progressContainer, targetContainer.firstChild);
        }
    }
    
    if (progressContainer) {
        document.getElementById('import-status-text').textContent = mensaje;
        document.getElementById('import-progress-bar').style.width = `${porcentaje}%`;
        progressContainer.style.display = 'block';
    }
}

function ocultarProgreso() {
    const p = document.getElementById('import-progress-container');
    if (p) {
        p.style.display = 'none';
        document.getElementById('import-progress-bar').style.width = '0%';
    }
}


// --- FUNCIONES EXPUESTAS (EXPORTADAS) ---

export function listenToReservas(onUpdate) {
    return db.collection('reservas').orderBy("creadoEn", "desc").onSnapshot(onUpdate, err => {
        console.error("Error escuchando reservas:", err);
    });
}

export function renderAllReservas(snapshot, caches, filtroChoferAsignadosId, filtroHoras) {
    const bodies = {
        'tabla-en-curso': document.querySelector('#tabla-en-curso tbody'),
        'tabla-pendientes': document.querySelector('#tabla-pendientes tbody'),
        'tabla-asignados': document.querySelector('#tabla-asignados tbody'),
        'tabla-importadas': document.querySelector('#tabla-importadas tbody'),
    };
    Object.values(bodies).forEach(body => { if (body) body.innerHTML = ''; });
    
    let reservas = [];
    snapshot.forEach(doc => {
        reservas.push({ id: doc.id, ...doc.data() });
    });

    reservas.sort((a, b) => {
        const fechaA = a.fecha_turno || '9999-12-31';
        const fechaB = b.fecha_turno || '9999-12-31';
        const horaA = (a.hora_pickup && a.hora_pickup.trim()) ? a.hora_pickup : (a.hora_turno || '23:59');
        const horaB = (b.hora_pickup && b.hora_pickup.trim()) ? b.hora_pickup : (b.hora_turno || '23:59');
        const timeA = `${fechaA} ${horaA}`;
        const timeB = `${fechaB} ${horaB}`;
        return timeA.localeCompare(timeB);
    });
    
    const ahora = new Date();
    const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

    reservas.forEach(reserva => {
        try {
            let targetTableId = '';
            const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
            const estadoPrincipal = typeof reserva.estado === 'object' ? reserva.estado.principal : reserva.estado;

            if (estadoPrincipal === 'Finalizado' || estadoPrincipal === 'Anulado') {
                 return;
            } 
            else if (estadoPrincipal === 'Revision') {
                targetTableId = 'tabla-importadas';
            }
            else if (estadoPrincipal === 'Asignado' || estadoPrincipal === 'En Origen' || estadoPrincipal === 'Viaje Iniciado') {
                   targetTableId = 'tabla-asignados';
                   if (filtroChoferAsignadosId && reserva.chofer_asignado_id !== filtroChoferAsignadosId) return;
            } else if (estadoPrincipal === 'Pendiente') {
                targetTableId = (fechaTurno && fechaTurno > limite24hs) ? 'tabla-pendientes' : 'tabla-en-curso';
            } else {
                targetTableId = 'tabla-en-curso';
            }

            if (targetTableId === 'tabla-en-curso' && filtroHoras !== null) {
                const horaReferencia = reserva.hora_pickup || reserva.hora_turno;
                if (!reserva.fecha_turno || !horaReferencia) return;
                const fechaHoraReserva = new Date(`${reserva.fecha_turno}T${horaReferencia}`);
                const horasDiferencia = (fechaHoraReserva.getTime() - ahora.getTime()) / (1000 * 60 * 60);
                if (horasDiferencia > filtroHoras) return;
            }

            if (targetTableId && bodies[targetTableId]) {
                renderFilaReserva(bodies[targetTableId], reserva, caches);
            }
        } catch (error) {
            console.error("Error renderizando una reserva:", reserva.id, error);
        }
    });
}

function renderFilaReserva(tbody, reserva, caches) {
    const cliente = caches.clientes[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    row.dataset.id = reserva.id;

    const isRev = (tbody.closest('#reservas-importadas') !== null);
    const isAsig = (tbody.closest('#reservas-asignados') !== null);

    const e = (typeof reserva.estado === 'object') ? reserva.estado.principal : reserva.estado;
    const det = (typeof reserva.estado === 'object') ? reserva.estado.detalle : '';
    
    if (reserva.es_exclusivo) row.style.backgroundColor = '#51ED8D';
    else if (e === 'Negativo') row.style.backgroundColor = '#FFDE59';
    else if (det.startsWith('Rechazado')) row.style.backgroundColor = '#f8d7da';
    else if (e === 'Anulado') row.className = 'estado-anulado';
    else if (cliente.color && cliente.color !== '#ffffff') {
        row.style.backgroundColor = cliente.color;
        const hex = cliente.color.replace('#','');
        const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
        row.style.color = ((r*299 + g*587 + b*114)/1000 >= 128) ? 'black' : 'white';
    }

    row.addEventListener('click', (ev) => {
        if (!window.isTableMultiSelectMode) return;
        if (!ev.target.closest('button') && !ev.target.closest('select') && !ev.target.closest('input') && !ev.target.closest('a')) {
            window.app.toggleTableSelection(reserva.id, row);
        }
    });

    const fT = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const checkHTML = isRev ? `<td style="text-align:center;"><input type="checkbox" class="check-reserva-revision" value="${reserva.id}"></td>` : '';
    
    let estHTML = `<strong>${e}</strong> <span onclick="alert(this.dataset.log)" data-log="${reserva.log || 'Sin registros'}" style="cursor:pointer; color:#1877f2; font-size:14px; font-weight:bold;">ⓘ</span><br><small>${det}</small>`;
    if (reserva.movil_asignado_id) {
        const m = caches.moviles.find(mo => mo.id === reserva.movil_asignado_id);
        if(m) estHTML += `<br><small>Móvil ${m.numero}</small>`;
    }

    let menuItems = `<a onclick="window.app.openEditReservaModal('${reserva.id}')">Editar</a>`;
    if(isRev) {
        menuItems += `<hr><a style="color:green" onclick="window.app.confirmarReservaImportada('${reserva.id}')">Confirmar</a><a style="color:red" onclick="window.app.changeReservaState('${reserva.id}','Anulado')">Descartar</a>`;
    } else if (isAsig) {
        menuItems += `<a onclick="window.app.finalizarReserva('${reserva.id}')">Finalizar</a><a onclick="window.app.quitarAsignacion('${reserva.id}')">Quitar Móvil</a><a onclick="window.app.changeReservaState('${reserva.id}','Negativo')">Negativo</a><a onclick="window.app.changeReservaState('${reserva.id}','Anulado')">Anular</a>`;
    } else {
        let opts = caches.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('');
        menuItems += `<select onchange="window.app.asignarMovil('${reserva.id}',this.value)"><option value="">Asignar...</option>${opts}</select>`;
        menuItems += `<a onclick="window.app.changeReservaState('${reserva.id}','Negativo')">Negativo</a><a onclick="window.app.changeReservaState('${reserva.id}','Anulado')">Anular</a>`;
    }

    let filaHTML = `
        ${checkHTML}
        <td>${reserva.autorizacion || ''}</td>
        <td>${reserva.siniestro || ''}</td>
        <td>${fT}</td>
        <td>${reserva.hora_turno || ''}</td>
    `;

    if (!isRev) {
        filaHTML += `<td class="editable-cell pickup-cell"></td>`;
    }

    filaHTML += `
        <td>${reserva.nombre_pasajero || ''}</td>
        <td>${reserva.origen || ''}</td>
        <td>${reserva.destino || ''}</td>
        <td>${reserva.cantidad_pasajeros || 1}</td>
    `;

    if (!isRev) {
        filaHTML += `<td class="editable-cell zona-cell"></td>`;
    }

    filaHTML += `
        <td style="font-weight:bold; color:#1877f2;">${reserva.distancia || '--'}</td>
        <td>${cliente.nombre}</td>
        <td>${estHTML}</td>
        <td class="acciones"><div class="acciones-dropdown"><button class="icono-tres-puntos" onclick="window.app.toggleMenu(event)">⋮</button><div class="menu-contenido">${menuItems}</div></div></td>
    `;

    row.innerHTML = filaHTML;

    if (!isRev && e !== 'Finalizado') {
        const pC = row.querySelector('.pickup-cell');
        const zC = row.querySelector('.zona-cell');
        if (pC) pC.innerHTML = `<input type="time" value="${reserva.hora_pickup || ''}" onchange="window.app.updateHoraPickup(event,'${reserva.id}')">`;
        if (zC) {
            let zS = `<select onchange="window.app.updateZona(event,'${reserva.id}')"><option value="">..</option>`;
            caches.zonas.forEach(z => zS += `<option value="${z.descripcion}" ${reserva.zona === z.descripcion ? 'selected' : ''}>${z.descripcion}</option>`);
            zC.innerHTML = zS + `</select>`;
        }
    } else {
        const pC = row.querySelector('.pickup-cell');
        const zC = row.querySelector('.zona-cell');
        if(pC) pC.textContent = reserva.hora_pickup || '';
        if(zC) zC.textContent = reserva.zona || '';
    }
}

export async function buscarEnReservas(texto, caches) {
    const resultadosContainer = document.getElementById('resultados-busqueda-reservas');
    const resultadosTbody = document.querySelector('#tabla-resultados-busqueda tbody');
    const subNav = document.querySelector('#Reservas .sub-nav');
    const containersOriginales = document.querySelectorAll('#Reservas .reservas-container');

    if (!texto) {
        resultadosContainer.style.display = 'none';
        subNav.style.display = 'flex';
        const tabBtnActiva = document.querySelector('#Reservas .sub-tab-btn.active');
        const tabActiva = tabBtnActiva ? tabBtnActiva.dataset.tab : 'en-curso';
        containersOriginales.forEach(c => c.style.display = 'none');
        const targetDiv = document.getElementById(`reservas-${tabActiva}`);
        if(targetDiv) targetDiv.style.display = 'block';
        return;
    }

    try {
        subNav.style.display = 'none';
        containersOriginales.forEach(c => c.style.display = 'none');
        resultadosContainer.style.display = 'block';
        resultadosTbody.innerHTML = '<tr><td colspan="13">Buscando...</td></tr>';
        const { hits } = await reservasSearchIndex.search(texto);
        resultadosTbody.innerHTML = '';

        if (hits.length === 0) {
            resultadosTbody.innerHTML = '<tr><td colspan="13">No se encontraron reservas.</td></tr>';
            return;
        }
        hits.forEach(reserva => {
            renderFilaReserva(resultadosTbody, {id: reserva.objectID, ...reserva}, caches);
        });
    } catch (error) {
        console.error("Error buscando reservas:", error);
        resultadosTbody.innerHTML = '<tr><td colspan="13">Error al realizar la búsqueda.</td></tr>';
    }
}

export async function handleSaveReserva(e, caches) {
   e.preventDefault();
    const f = e.target; 
    const submitBtn = f.querySelector('button[type="submit"]');    
    const operador = window.currentUserEmail || 'Sistema';
    const ahora = new Date().toLocaleString('es-AR');
    
    // 1. Validaciones Previas
    const estadoActual = document.getElementById('reserva-estado-principal')?.value || '';
    if (estadoActual !== 'Revision' && !f.fecha_turno.value) {
        alert("Atención!!: La fecha es obligatoria para confirmar la reserva.");
        return; 
    }

    const inputsOrigen = document.querySelectorAll('.origen-input');
    let origenesArray = [];
    inputsOrigen.forEach(input => {
        if (input.value?.trim()) origenesArray.push(input.value.trim());
    });

    const origenFinal = origenesArray.join(' + ');
    if (!origenFinal) return alert("Debes ingresar al menos una dirección de origen.");

    const rId = f['reserva-id'].value;
    const distanciaTotal = document.getElementById('distancia_total_input')?.value || '';
    const esX = f.viaje_exclusivo.checked;
    const cP = esX ? '4' : f.cantidad_pasajeros.value;
    
    let coords = (typeof getModalMarkerCoords === 'function') ? getModalMarkerCoords() : { origen: null, destino: null };

    const datosBase = {
        cliente: f.cliente.value,
        siniestro: f.siniestro.value,
        autorizacion: f.autorizacion.value,
        dni_pasajero: f.dni_pasajero.value.trim(),
        nombre_pasajero: f.nombre_pasajero.value,
        telefono_pasajero: f.telefono_pasajero.value,
        fecha_turno: f.fecha_turno.value || "",
        hora_turno: f.hora_turno.value || "",
        hora_pickup: f.hora_pickup.value || "",
        origen: origenFinal,  
        destino: f.destino.value,
        origen_coords: coords.origen,
        destino_coords: coords.destino,
        cantidad_pasajeros: cP,
        zona: f.zona.value,
        observaciones: f.observaciones.value,
        es_exclusivo: esX,
        distancia: distanciaTotal
    };

    try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }

        let reservaGuardadaId = rId;

        // --- LÓGICA DE TRANSACCIÓN PARA EDITAR ---
        if (rId) {
            const docRef = db.collection('reservas').doc(rId);
            await db.runTransaction(async (transaction) => {
                const docSnap = await transaction.get(docRef);
                if (!docSnap.exists) throw "La reserva no existe.";
                
                const logPrevio = docSnap.data().log || '';
                const nuevoLog = logPrevio + `\n📝 Editado por: ${operador}, (${ahora})`;
                
                transaction.update(docRef, { ...datosBase, log: nuevoLog });
            });
        } else {
            // --- CREACIÓN SIMPLE ---
            const dNueva = {
                ...datosBase,
                log: `✅ Creado por: ${operador}, via manual, (${ahora})`,
                estado: { principal: 'Pendiente', detalle: 'Recién creada', actualizado_en: new Date() },
                creadoEn: new Date() // Usar Date() si serverTimestamp te da problemas de consistencia inmediata
            };
            const nuevaRef = await db.collection('reservas').add(dNueva);
            reservaGuardadaId = nuevaRef.id;
        }

        // 2. Acciones Post-Guardado (Fuera de la transacción por performance)
        if (f.asignar_movil.value && reservaGuardadaId) {
            await asignarMovil(reservaGuardadaId, f.asignar_movil.value, caches);
        }

        if (datosBase.dni_pasajero && origenesArray.length > 0) {
            await db.collection('pasajeros').doc(datosBase.dni_pasajero).set({
                nombre_apellido: datosBase.nombre_pasajero,
                telefono: datosBase.telefono_pasajero,
                domicilios: db.app.firebase_.firestore.FieldValue.arrayUnion(origenesArray[0])  
            }, { merge: true });
        }

        document.getElementById('reserva-modal').style.display = 'none';
        return f.tiene_regreso?.checked ? { ...datosBase, origen: datosBase.destino, destino: datosBase.origen } : null;

    } catch (error) {
        console.error("Error saving:", error);
        alert("Error: " + error);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Reserva'; }
    }
}

export async function handleConfirmarDesdeModal(e, caches) {
    e.preventDefault();
    const f = document.getElementById('reserva-form');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const btn = document.getElementById('btn-confirmar-modal');
    try {
        btn.disabled = true; btn.textContent = 'Procesando...';
        const rId = f['reserva-id'].value;
        const movilId = f.asignar_movil.value;
        const inputsOrigen = document.querySelectorAll('.origen-input');
        let origenes = []; inputsOrigen.forEach(i => { if(i.value.trim()) origenes.push(i.value.trim()); });
        const d = {
            cliente: f.cliente.value,
            siniestro: f.siniestro.value,
            autorizacion: f.autorizacion.value,
            dni_pasajero: f.dni_pasajero.value,
            nombre_pasajero: f.nombre_pasajero.value,
            telefono_pasajero: f.telefono_pasajero.value,
            fecha_turno: f.fecha_turno.value,
            hora_turno: f.hora_turno.value,
            hora_pickup: f.hora_pickup.value,
            origen: origenes.join(' + '),
            destino: f.destino.value,
            cantidad_pasajeros: f.viaje_exclusivo.checked ? '4' : f.cantidad_pasajeros.value,
            zona: f.zona.value,
            observaciones: f.observaciones.value,
            es_exclusivo: f.viaje_exclusivo.checked,
            distancia: document.getElementById('distancia_total_input').value,
            estado: { principal: 'Pendiente', detalle: 'Confirmado por operador', actualizado_en: new Date() }
        };
        if (rId) await db.collection('reservas').doc(rId).update(d);
        else { d.creadoEn = new Date(); await db.collection('reservas').add(d); }
        if (movilId && rId) await asignarMovil(rId, movilId, caches);
        document.getElementById('reserva-modal').style.display = 'none';
    } catch(err) { alert(err.message); }
    finally { btn.disabled = false; btn.textContent = '✅ Confirmar e Importar'; }
}

export async function openEditReservaModal(reservaId, caches, initMapaModalCallback) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    const data = doc.data();
    const form = document.getElementById('reserva-form');
    form.reset();
    poblarSelectDeMoviles(caches);
    const inputEstado = document.getElementById('reserva-estado-principal');
    if (inputEstado) inputEstado.value = data.estado?.principal || data.estado || '';
    
    form.viaje_exclusivo.checked = data.es_exclusivo || false;
    form.cantidad_pasajeros.disabled = data.es_exclusivo || false;
    form.cliente.value = data.cliente || 'Default';
    form.siniestro.value = data.siniestro || '';
    form.autorizacion.value = data.autorizacion || '';
    form.dni_pasajero.value = data.dni_pasajero || '';
    form.nombre_pasajero.value = data.nombre_pasajero || '';
    form.telefono_pasajero.value = data.telefono_pasajero || '';
    form.fecha_turno.value = data.fecha_turno || '';
    form.hora_turno.value = data.hora_turno || '';
    form.hora_pickup.value = data.hora_pickup || '';
    form.destino.value = data.destino || '';
    form.cantidad_pasajeros.value = data.cantidad_pasajeros || '1';
    form.zona.value = data.zona || '';
    form.observaciones.value = data.observaciones || '';
    form.asignar_movil.value = data.movil_asignado_id || '';
    
    const distInput = document.getElementById('distancia_total_input');
    if (distInput) distInput.value = data.distancia || '';

    const container = document.getElementById('origenes-container');
    container.innerHTML = `<div class=\"input-group-origen\" style=\"display: flex; gap: 5px;\"><input type=\"text\" name=\"origen_dinamico\" class=\"origen-input\" placeholder=\"Origen Principal\" required style=\"flex: 1;\"><div style=\"width: 30px;\"></div></div>`;
    
    const partesOrigen = (data.origen || "").split(' + ');
    const primerInput = container.querySelector('.origen-input');
    if (primerInput) {
        primerInput.value = partesOrigen[0] || "";
        if (window.app && window.app.activarAutocomplete) window.app.activarAutocomplete(primerInput);
    }

    for (let i = 1; i < partesOrigen.length; i++) {
        const div = document.createElement('div');
        div.className = 'input-group-origen';
        div.style.cssText = "display: flex; gap: 5px; align-items: center;";
        div.innerHTML = `<span style=\"font-size:18px;color:#6c757d;\">↳</span><input type=\"text\" class=\"origen-input\" value=\"${partesOrigen[i]}\" style=\"flex:1;\"><button type=\"button\" class=\"btn-remove-origen\" style=\"color:red;border:none;background:none;font-weight:bold;cursor:pointer;\">✕</button>`;
        div.querySelector('.btn-remove-origen').addEventListener('click', () => { div.remove(); if(window.app.calcularYMostrarRuta) window.app.calcularYMostrarRuta(); });
        container.appendChild(div);
        const inputNuevo = div.querySelector('input');
        if (window.app && window.app.activarAutocomplete) window.app.activarAutocomplete(inputNuevo);
    }
    
    document.getElementById('reserva-id').value = reservaId;
    document.getElementById('modal-title').textContent = 'Editar Reserva';
    const btnConfirmar = document.getElementById('btn-confirmar-modal');
    if (btnConfirmar) btnConfirmar.style.display = (data.estado?.principal === 'Revision') ? 'block' : 'none';
    document.getElementById('reserva-modal').style.display = 'block';
    if(initMapaModalCallback) setTimeout(() => initMapaModalCallback(data.origen_coords, data.destino_coords), 100);
}

export async function confirmarReservaImportada(reservaId) {
    try { await db.collection('reservas').doc(reservaId).update({ estado: { principal: 'Pendiente', detalle: 'Confirmado por operador', actualizado_en: new Date() } }); }
    catch (e) { alert("Error: " + e.message); }
}

export async function asignarMovil(id, movilId, caches) {
    if (!movilId) return;
    const operador = window.currentUserEmail || 'Operador';
    const ahora = new Date().toLocaleString('es-AR');
    try {
        const chofer = caches.choferes.find(c => c.movil_actual_id === movilId);
        // BUSCAMOS EL MÓVIL PARA OBTENER EL NÚMERO
        const movil = caches.moviles.find(m => m.id === movilId); 
        
        if (!chofer) { alert("Error: Móvil sin chofer."); return; }
        
        const ref = db.collection('reservas').doc(id);
        const snap = await ref.get();
        const logActual = snap.data().log || '';
        const esReasig = snap.data().movil_asignado_id ? 'Reasignado' : 'Asignado';
        
        const numMovil = movil ? movil.numero : 'S/N'; // Obtenemos el número real
        
        const b = db.batch();
        b.update(ref, { 
            movil_asignado_id: movilId, 
            chofer_asignado_id: chofer.id, 
            // ACTUALIZAMOS EL LOG CON NOMBRE Y NÚMERO
            log: logActual + `\n🚖 ${esReasig} por: ${operador} (Móvil ${numMovil} - ${chofer.nombre}) (${ahora})`,
            estado: { principal: 'Asignado', detalle: 'Enviada', actualizado_en: new Date() } 
        });
        b.update(db.collection('choferes').doc(chofer.id), { viajes_activos: db.app.firebase_.firestore.FieldValue.arrayUnion(id) });
        await b.commit();
        hideMapContextMenu(); if(window.app) window.app.hideTableMenus();
    } catch(e) { alert(e.message); }
}
export async function changeReservaState(id, st, caches) { 
    if(['Anulado','Negativo'].includes(st) && confirm(`¿Seguro que desea marcar como ${st}?`)) {
        const operador = window.currentUserEmail || 'Operador';
        const ahora = new Date().toLocaleString('es-AR');
        const ref = db.collection('reservas').doc(id);
        const snap = await ref.get();
        const logActual = snap.exists ? (snap.data().log || '') : '';
        if (st === 'Anulado') {
            await moverReservaAHistorico(id, st, caches, logActual + `\n🚫 Anulado por: ${operador} (${ahora})`);
        } else {
            await ref.update({ 
                "estado.principal": st, "estado.actualizado_en": new Date(),
                log: logActual + `\n⚠️ Marcado como ${st} por: ${operador} (${ahora})`
            });
        }
    }
}

export async function finalizarReserva(id, caches) { 
    if(confirm("¿Finalizar?")) {
        const operador = window.currentUserEmail || 'Operador';
        const ahora = new Date().toLocaleString('es-AR');
        const snap = await db.collection('reservas').doc(id).get();
        const finalLog = (snap.data().log || '') + `\n🏁 Finalizado manualmente por: ${operador} (${ahora})`;
        await moverReservaAHistorico(id, 'Finalizado', caches, finalLog); 
    }
}

export async function quitarAsignacion(id) { 
    if(!confirm("¿Quitar asignación?")) return;
    const doc = await db.collection('reservas').doc(id).get();
    const chId = doc.data().chofer_asignado_id;
    const b = db.batch();
    b.update(db.collection('reservas').doc(id), { 
        chofer_asignado_id: db.app.firebase_.firestore.FieldValue.delete(), 
        movil_asignado_id: db.app.firebase_.firestore.FieldValue.delete(),
        log: (doc.data().log || '') + `\n🔄 Movil retirado por: ${window.currentUserEmail} (${new Date().toLocaleString()})`,
        estado: { principal: 'En Curso', detalle: 'Desasignado', actualizado_en: new Date() } 
    });
    if(chId) b.update(db.collection('choferes').doc(chId), { viajes_activos: db.app.firebase_.firestore.FieldValue.arrayRemove(id) });
    await b.commit();
    hideMapContextMenu(); if(window.app) window.app.hideTableMenus();
}

export async function updateHoraPickup(e, id) { await db.collection('reservas').doc(id).update({ hora_pickup: e.target.value }); }
export async function updateZona(e, id) { await db.collection('reservas').doc(id).update({ zona: e.target.value }); }

export async function handleDniBlur(e) { 
    const dni = e.target.value; if(!dni) return;
    const d = await db.collection('pasajeros').doc(dni).get();
    if(d.exists) { 
        const p = d.data(); 
        const f = document.getElementById('reserva-form');
        f.nombre_pasajero.value = p.nombre_apellido || '';
        f.telefono_pasajero.value = p.telefono || '';
        if(p.domicilios?.length) document.querySelector('.origen-input').value = p.domicilios[p.domicilios.length-1];
    }
}

export async function asignarMultiplesReservas(ids, mId, caches) {
    if(!mId || !ids.length) return alert("Seleccione móvil y reservas");
    const operador = window.currentUserEmail || 'Operador';
    const ahora = new Date().toLocaleString('es-AR');
    
    const ch = caches.choferes.find(c => c.movil_actual_id === mId);
    // BUSCAMOS EL MÓVIL PARA EL LOG MASIVO
    const mov = caches.moviles.find(m => m.id === mId); 
    
    if(!ch) return alert("Móvil sin chofer");

    const numMovil = mov ? mov.numero : 'S/N';

    try {
        await Promise.all(ids.map(async (id) => {
            const ref = db.collection('reservas').doc(id);
            await db.runTransaction(async (transaction) => {
                const docSnap = await transaction.get(ref);
                if (!docSnap.exists) return;

                const logPrevio = docSnap.data().log || '';
                // LOG CORREGIDO: SE VE EL MÓVIL Y EL NOMBRE DEL CHOFER
                const nuevoLog = logPrevio + `\n🚖 Asignado por: ${operador} (Móvil ${numMovil} - ${ch.nombre}) (${ahora})`;

                transaction.update(ref, { 
                    movil_asignado_id: mId, 
                    chofer_asignado_id: ch.id, 
                    log: nuevoLog,
                    estado: { principal: 'Asignado', detalle: 'Enviada', actualizado_en: new Date() } 
                });
            });
        }));

         await db.collection('choferes').doc(ch.id).update({
            viajes_activos: db.app.firebase_.firestore.FieldValue.arrayUnion(...ids)
        });
        return true;
    } catch (error) {
        console.error("Error en asignación múltiple:", error);
        alert("Hubo un error al asignar algunas reservas.");
        return false;
    }
}

async function moverReservaAHistorico(id, st, caches, logFinal = '') {
    const ref = db.collection('reservas').doc(id);
    const hist = db.collection('historico').doc(id);
    await db.runTransaction(async t => {
        const d = (await t.get(ref)).data();
        d.estado = { principal: st, detalle: 'Archivado', actualizado_en: new Date() };
        d.archivadoEn = new Date(); if (logFinal) d.log = logFinal;
        if(d.chofer_asignado_id) t.update(db.collection('choferes').doc(d.chofer_asignado_id), { viajes_activos: db.app.firebase_.firestore.FieldValue.arrayRemove(id) });
        t.set(hist, d); t.delete(ref);
    });
}

export async function manejarImportacionExcel(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
            if (!fecha) return;
            actualizarProgreso(`Analizando ${jsonData.length} filas...`, 5);
            const BATCH_SIZE = 15;
            let todasLasReservas = [];
            for (let i = 0; i < jsonData.length; i += BATCH_SIZE) {
                const lote = jsonData.slice(i, i + BATCH_SIZE);
                // CORRECCIÓN: Usar 'functions' directo
                const res = await functions.httpsCallable('interpretarExcelIA')({ datosCrudos: lote, fechaSeleccionada: fecha });
                if (res.data.reservas) todasLasReservas = [...todasLasReservas, ...res.data.reservas];
            }
            if (todasLasReservas.length > 0) await guardarReservasEnLote(todasLasReservas);
            ocultarProgreso();
        } catch (error) { alert(error.message); ocultarProgreso(); }
    };
    reader.readAsArrayBuffer(file);
}

export async function manejarImportacionPDF(event) {
    const file = event.target.files[0]; if(!file) return;
    const fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]); 
    if(!fecha) return;
    actualizarProgreso("Analizando PDF...", 20);
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // CORRECCIÓN: Usar 'functions' directo
            const res = await functions.httpsCallable('interpretarPDFIA')({ pdfBase64: e.target.result.split(',')[1], fechaSeleccionada: fecha });
            if(res.data.reservas) await guardarReservasEnLote(res.data.reservas);
            ocultarProgreso();
        } catch(err) { alert(err.message); ocultarProgreso(); }
    };
    reader.readAsDataURL(file);
}

async function guardarReservasEnLote(list) {
    const batchLimit = 400; 
    const clientsCache = window.appCaches.clientes || {};
    const operador = window.currentUserEmail || 'Sistema';
    const ahora = new Date().toLocaleString('es-AR');
    let batch = db.batch(), count = 0;
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        let cId = Object.keys(clientsCache).find(k => clientsCache[k].nombre?.toUpperCase() === r.cliente?.toUpperCase()) || 'Default';
        batch.set(db.collection('reservas').doc(), {
            ...r, cliente: cId, log: `📥 Importado por: ${operador}, via IA, (${ahora})`,
            estado: { principal: 'Revision', detalle: 'Importado IA', actualizado_en: new Date() },
            creadoEn: new Date(), cantidad_pasajeros: String(r.cantidad_pasajeros || '1'), es_exclusivo: false
        });
        if (++count >= batchLimit || i === list.length - 1) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    actualizarProgreso("¡Finalizado!", 100); setTimeout(ocultarProgreso, 3000);
}

// --- ACCIONES MASIVAS (BORRAR O ANULAR) ---
export async function ejecutarAccionMasiva(accion, ids) {
    if (!ids || ids.length === 0) return alert("No seleccionaste nada.");
    
    const confirmacion = confirm(`¿Estás seguro de que querés ${accion === 'borrar' ? 'ELIMINAR' : 'ANULAR'} estas ${ids.length} reservas?`);
    if (!confirmacion) return;

    const batch = db.batch();
    const operador = window.currentUserEmail || 'Operador';
    const ahora = new Date().toLocaleString('es-AR');

    ids.forEach(id => {
        const ref = db.collection('reservas').doc(id);
        if (accion === 'borrar') {
            batch.delete(ref);
        } else if (accion === 'anular') {
            batch.update(ref, {
                "estado.principal": "Anulado",
                "estado.detalle": "Anulación Masiva",
                "estado.actualizado_en": new Date(),
                log: `🚫 Anulación Masiva por: ${operador} (${ahora})`
            });
        }
    });

    try {
        await batch.commit();
        alert(`Éxito: ${ids.length} reservas procesadas.`);
        if (window.app && window.app.limpiarSeleccion) window.app.limpiarSeleccion();
    } catch (error) {
        console.error("Error en lote:", error);
        alert("Falló la operación masiva.");
    }
}

export function conectarSeleccionMultiple() {
    const btnBorrarTodo = document.querySelector('.btn-danger'); // Botón rojo pestaña Revisión
    const btnAnularPanel = document.getElementById('btn-anular-multi'); // Botón del panel lateral

    // 1. Lógica para pestaña REVISIÓN (Checkboxes)
    if (btnBorrarTodo) {
        btnBorrarTodo.onclick = () => {
            const seleccionados = Array.from(document.querySelectorAll('.check-reserva-revision:checked'))
                                       .map(cb => cb.value);

            if (seleccionados.length > 0) {
                const accion = confirm("¿Desea ANULAR las seleccionadas? (Aceptar para ANULAR, Cancelar para ELIMINAR)") ? 'anular' : 'borrar';
                ejecutarAccionMasiva(accion, seleccionados);
            } else {
                if(confirm("¿Querés limpiar TODA la pestaña de Revisión?")) {
                    const todos = Array.from(document.querySelectorAll('#tabla-importadas tbody tr'))
                                       .map(tr => tr.dataset.id);
                    ejecutarAccionMasiva('borrar', todos);
                }
            }
        };
    }

    
   
   if (btnAnularPanel) {
        btnAnularPanel.onclick = () => {
            let ids = typeof window.app?.getSelectedReservasIds === 'function' 
                      ? window.app.getSelectedReservasIds() : [];

            if (ids.length === 0) {
                ids = Array.from(document.querySelectorAll('#multi-select-list li'))
                           .map(li => li.getAttribute('data-id') || li.dataset.id)
                           .filter(id => id); 
            }

            if (ids.length === 0) {
                return alert("NO se detectaron IDs. Por favor, desmarcá y volvé a marcar los viajes.");
            }
            ejecutarAccionMasiva('anular', ids);
        }; 
    } 
}

