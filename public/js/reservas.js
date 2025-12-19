// js/reservas.js

import { db, functions, reservasSearchIndex } from './firebase-config.js';
import { hideMapContextMenu, getModalMarkerCoords } from './mapa.js';

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

// --- RENDERIZADO DE FILAS (CORREGIDO DESPLAZAMIENTO) ---
function renderFilaReserva(tbody, reserva, caches) {
    const cliente = caches.clientes[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    row.dataset.id = reserva.id;

    // Detectar en qué tabla estamos para ajustar columnas
    const isRev = (tbody.closest('#reservas-importadas') !== null);
    const isAsig = (tbody.closest('#reservas-asignados') !== null);

    const e = (typeof reserva.estado === 'object') ? reserva.estado.principal : reserva.estado;
    const det = (typeof reserva.estado === 'object') ? reserva.estado.detalle : '';
    
    // Colores de estado
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

    // Selección
    row.addEventListener('click', (ev) => {
        if (!window.isTableMultiSelectMode) return;
        if (!ev.target.closest('button') && !ev.target.closest('select') && !ev.target.closest('input') && !ev.target.closest('a')) {
            window.app.toggleTableSelection(reserva.id, row);
        }
    });

    const fT = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const checkHTML = isRev ? `<td style="text-align:center;"><input type="checkbox" class="check-reserva-revision" value="${reserva.id}"></td>` : '';
    
    // HTML Estado + Móvil
    let estHTML = `<strong>${e}</strong><br><small>${det}</small>`;
    if (reserva.movil_asignado_id) {
        const m = caches.moviles.find(mo => mo.id === reserva.movil_asignado_id);
        if(m) estHTML += `<br><small>Móvil ${m.numero}</small>`;
    }

    // Menú de Acciones
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

    // --- CONSTRUCCIÓN DEL HTML DE LA FILA ---
    // AQUI ESTABA EL ERROR: Si es revisión, NO agregamos las celdas de edición (Pickup y Zona)
    // para que coincida con el encabezado.
    
    let filaHTML = `
        ${checkHTML}
        <td>${reserva.autorizacion || ''}</td>
        <td>${reserva.siniestro || ''}</td>
        <td>${fT}</td>
        <td>${reserva.hora_turno || ''}</td>
    `;

    // Solo agregar columna Pickup editable si NO es revisión
    if (!isRev) {
        filaHTML += `<td class="editable-cell pickup-cell"></td>`;
    }

    filaHTML += `
        <td>${reserva.nombre_pasajero || ''}</td>
        <td>${reserva.origen || ''}</td>
        <td>${reserva.destino || ''}</td>
        <td>${reserva.cantidad_pasajeros || 1}</td>
    `;

    // Solo agregar columna Zona editable si NO es revisión
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

    // Lógica para celdas editables (Solo si existen)
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
        // En modo lectura o revisión, si la celda existe en HTML (caso raro), poner texto plano
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


// --- FUNCIÓN DE GUARDADO (COMPLETA Y CORREGIDA) ---
export async function handleSaveReserva(e, caches) {
    e.preventDefault();
    const f = e.target; 
    const submitBtn = f.querySelector('button[type="submit"]');    
    
    const estadoActual = document.getElementById('reserva-estado-principal')?.value || '';
    if (estadoActual !== 'Revision' && !f.fecha_turno.value) {
        alert("Atención Javi: La fecha es obligatoria para confirmar la reserva.");
        return; 
    }

    // --- Lógica de Orígenes ---
    const inputsOrigen = document.querySelectorAll('.origen-input');
    let origenesArray = [];
    inputsOrigen.forEach(input => {
        if (input.value && input.value.trim() !== "") {
            origenesArray.push(input.value.trim());
        }
    });

    const origenFinal = origenesArray.join(' + ');
    if (!origenFinal) {
        alert("Debes ingresar al menos una dirección de origen.");
        return;
    }

    const distanciaInput = document.getElementById('distancia_total_input');
    const distanciaTotal = distanciaInput ? distanciaInput.value : '';

    let datosParaRegreso = null;
    const generarRegreso = f.tiene_regreso ? f.tiene_regreso.checked : false;

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Guardando...';
        }
        
        const rId = f['reserva-id'].value;
        const movilIdParaAsignar = f.asignar_movil.value;
        const esX = f.viaje_exclusivo.checked;
        const cP = esX ? '4' : f.cantidad_pasajeros.value;
        
        // Obtener coordenadas limpias desde mapa.js
        let coords = { origen: null, destino: null };
        if (window.app && typeof window.app.getModalMarkerCoords === 'function') {
        coords = window.app.getModalMarkerCoords(); // Usa window.app para evitar errores de referencia
        } else if (typeof getModalMarkerCoords === 'function') {
        coords = getModalMarkerCoords();
        }   

        const d = {
            cliente: f.cliente.value,
            siniestro: f.siniestro.value,
            autorizacion: f.autorizacion.value,
            dni_pasajero: f.dni_pasajero.value.trim(),
            nombre_pasajero: f.nombre_pasajero.value,
            telefono_pasajero: f.telefono_pasajero.value,
            fecha_turno: f.fecha_turno.value || "", // Permite vacío si es Revision
            hora_turno: f.hora_turno.value || "",   // Opcional siempre
            hora_pickup: f.hora_pickup.value || "", // Opcional siempre
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

        if (!rId) {
            d.estado = { principal: 'Pendiente', detalle: 'Recién creada', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() };
            d.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        }

        let reservaGuardadaId = rId;
        if (rId) {
            await db.collection('reservas').doc(rId).update(d);
        } else {
            const nuevaReservaRef = await db.collection('reservas').add(d);
            reservaGuardadaId = nuevaReservaRef.id;
        }

        // Asignación automática de móvil si se seleccionó en el modal
        if (movilIdParaAsignar && reservaGuardadaId) {
            await asignarMovil(reservaGuardadaId, movilIdParaAsignar, caches);
        }

        // Guardar/Actualizar pasajero
        if (d.dni_pasajero && origenesArray.length > 0) {
            const pRef = db.collection('pasajeros').doc(d.dni_pasajero);
            const pData = {
                nombre_apellido: d.nombre_pasajero,
                telefono: d.telefono_pasajero,
                domicilios: firebase.firestore.FieldValue.arrayUnion(origenesArray[0])
            };
            await pRef.set(pData, { merge: true });
        }
        
        // Preparar datos si se solicita viaje de regreso
        if (generarRegreso) {
            datosParaRegreso = {
                cliente: d.cliente,
                siniestro: d.siniestro,
                autorizacion: d.autorizacion,
                dni_pasajero: d.dni_pasajero,
                nombre_pasajero: d.nombre_pasajero,
                telefono_pasajero: d.telefono_pasajero,
                origen: d.destino, 
                destino: d.origen
            };
        }

        document.getElementById('reserva-modal').style.display = 'none';

    } catch (error) {
        console.error("Error saving:", error);
        alert("Error al guardar: " + error.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Guardar Reserva';
        }
    }

    return datosParaRegreso;
}
export async function handleConfirmarDesdeModal(e, caches) {
    e.preventDefault();
    const f = document.getElementById('reserva-form');
    
    if (!f.checkValidity()) {
        f.reportValidity();
        return;
    }

    const btn = document.getElementById('btn-confirmar-modal');
    try {
        btn.disabled = true; btn.textContent = 'Procesando...';
        
        const rId = f['reserva-id'].value;
        const movilId = f.asignar_movil.value;
        const esX = f.viaje_exclusivo.checked;
        const cP = esX ? '4' : f.cantidad_pasajeros.value;
        
        const inputsOrigen = document.querySelectorAll('.origen-input');
        let origenes = []; inputsOrigen.forEach(i => { if(i.value.trim()) origenes.push(i.value.trim()); });
        const origenFinal = origenes.join(' + ');
        
        const distanciaTotal = document.getElementById('distancia_total_input').value;

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
            origen: origenFinal,
            destino: f.destino.value,
            cantidad_pasajeros: cP,
            zona: f.zona.value,
            observaciones: f.observaciones.value,
            es_exclusivo: esX,
            distancia: distanciaTotal,
            estado: { principal: 'Pendiente', detalle: 'Confirmado por operador', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() }
        };

        if (rId) await db.collection('reservas').doc(rId).update(d);
        else { d.creadoEn = firebase.firestore.FieldValue.serverTimestamp(); await db.collection('reservas').add(d); }
        
        if (movilId && rId) await asignarMovil(rId, movilId, caches);
        document.getElementById('reserva-modal').style.display = 'none';
    } catch(err) { alert(err.message); }
    finally { btn.disabled = false; btn.textContent = '✅ Confirmar e Importar'; }
}

export async function openEditReservaModal(reservaId, caches, initMapaModalCallback) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    
    const data = doc.data(); // Definida una sola vez aquí
    const form = document.getElementById('reserva-form');
    form.reset();
    
    poblarSelectDeMoviles(caches);

    // --- NUEVO: ASIGNAR EL ESTADO AL CAMPO OCULTO ---
    // Esto es lo que permite que luego el guardado sepa si exigir fecha o no
    const inputEstado = document.getElementById('reserva-estado-principal');
    if (inputEstado) {
        inputEstado.value = data.estado?.principal || data.estado || '';
    }
    // -----------------------------------------------

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
    container.innerHTML = `<div class="input-group-origen" style="display: flex; gap: 5px;"><input type="text" name="origen_dinamico" class="origen-input" placeholder="Origen Principal" required style="flex: 1;"><div style="width: 30px;"></div></div>`;
    
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
        div.innerHTML = `<span style="font-size:18px;color:#6c757d;">↳</span><input type="text" class="origen-input" value="${partesOrigen[i]}" style="flex:1;"><button type="button" class="btn-remove-origen" style="color:red;border:none;background:none;font-weight:bold;cursor:pointer;">✕</button>`;
        div.querySelector('.btn-remove-origen').addEventListener('click', () => { div.remove(); if(window.app.calcularYMostrarRuta) window.app.calcularYMostrarRuta(); });
        container.appendChild(div);
        const inputNuevo = div.querySelector('input');
        if (window.app && window.app.activarAutocomplete) window.app.activarAutocomplete(inputNuevo);
    }
    
    document.getElementById('reserva-id').value = reservaId;
    document.getElementById('modal-title').textContent = 'Editar Reserva';
    
    const btnConfirmar = document.getElementById('btn-confirmar-modal');
    const estadoActual = (typeof data.estado === 'object' && data.estado.principal) ? data.estado.principal : data.estado;
    if (btnConfirmar) btnConfirmar.style.display = (estadoActual === 'Revision') ? 'block' : 'none';

    document.getElementById('reserva-modal').style.display = 'block';
    
    if(initMapaModalCallback) setTimeout(() => initMapaModalCallback(data.origen_coords, data.destino_coords), 100);
}

// ... (Helpers) ...
export async function confirmarReservaImportada(reservaId) {
    try { await db.collection('reservas').doc(reservaId).update({ estado: { principal: 'Pendiente', detalle: 'Confirmado por operador', actualizado_en: new Date() } }); }
    catch (e) { alert("Error: " + e.message); }
}
export async function asignarMovil(id, movilId, caches) {
    if (!movilId) return;
    try {
        const chofer = caches.choferes.find(c => c.movil_actual_id === movilId);
        if (!chofer) { alert("Error: Móvil sin chofer."); return; }
        const b = db.batch();
        b.update(db.collection('reservas').doc(id), { movil_asignado_id: movilId, chofer_asignado_id: chofer.id, estado: { principal: 'Asignado', detalle: 'Enviada', actualizado_en: new Date() } });
        b.update(db.collection('choferes').doc(chofer.id), { viajes_activos: firebase.firestore.FieldValue.arrayUnion(id) });
        await b.commit();
        hideMapContextMenu(); if(window.app) window.app.hideTableMenus();
    } catch(e) { alert(e.message); }
}
export async function changeReservaState(id, st, caches) { if(['Anulado','Negativo'].includes(st) && confirm("¿Seguro?")) await moverReservaAHistorico(id, st, caches); }
export async function finalizarReserva(id, caches) { if(confirm("¿Finalizar?")) await moverReservaAHistorico(id, 'Finalizado', caches); }
export async function quitarAsignacion(id) { 
    if(!confirm("¿Quitar asignación?")) return;
    const doc = await db.collection('reservas').doc(id).get();
    const chId = doc.data().chofer_asignado_id;
    const b = db.batch();
    b.update(db.collection('reservas').doc(id), { chofer_asignado_id: firebase.firestore.FieldValue.delete(), movil_asignado_id: firebase.firestore.FieldValue.delete(), estado: { principal: 'En Curso', detalle: 'Desasignado', actualizado_en: new Date() } });
    if(chId) b.update(db.collection('choferes').doc(chId), { viajes_activos: firebase.firestore.FieldValue.arrayRemove(id) });
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
    const ch = caches.choferes.find(c => c.movil_actual_id === mId);
    if(!ch) return alert("Móvil sin chofer");
    const b = db.batch();
    ids.forEach(id => b.update(db.collection('reservas').doc(id), { movil_asignado_id: mId, chofer_asignado_id: ch.id, estado: { principal: 'Asignado', detalle: 'Enviada', actualizado_en: new Date() } }));
    b.update(db.collection('choferes').doc(ch.id), { viajes_activos: firebase.firestore.FieldValue.arrayUnion(...ids) });
    await b.commit();
    return true;
}

async function moverReservaAHistorico(id, st, caches) {
    const ref = db.collection('reservas').doc(id);
    const hist = db.collection('historico').doc(id);
    await db.runTransaction(async t => {
        const d = (await t.get(ref)).data();
        d.estado = { principal: st, detalle: 'Archivado', actualizado_en: new Date() };
        d.archivadoEn = new Date();
        if(d.chofer_asignado_id) t.update(db.collection('choferes').doc(d.chofer_asignado_id), { viajes_activos: firebase.firestore.FieldValue.arrayRemove(id) });
        t.set(hist, d); t.delete(ref);
    });
}

// --- IMPORTACIÓN EXCEL (Lógica por Lotes con Barra de Progreso) ---
export async function manejarImportacionExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Resetear input para permitir subir el mismo archivo si falla
    const inputElement = event.target;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) { alert("El Excel está vacío."); return; }

            let fechaSeleccionada = document.getElementById('fecha-reserva')?.value;
            if (!fechaSeleccionada) {
                 fechaSeleccionada = prompt("Fecha para estas reservas (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
            }
            if (!fechaSeleccionada) return;

            // --- LÓGICA DE LOTES ---
            const BATCH_SIZE = 15;
            let todasLasReservas = [];
            const totalBatches = Math.ceil(jsonData.length / BATCH_SIZE);

            // Mostrar Barra Inicial
            actualizarProgreso(`Iniciando análisis de ${jsonData.length} filas...`, 5);

            for (let i = 0; i < jsonData.length; i += BATCH_SIZE) {
                const lote = jsonData.slice(i, i + BATCH_SIZE);
                const currentBatch = Math.floor(i/BATCH_SIZE) + 1;
                const porcentaje = Math.round((currentBatch / totalBatches) * 80); // Hasta el 80% es análisis IA
                
                actualizarProgreso(`IA Analizando Lote ${currentBatch} de ${totalBatches}...`, 5 + porcentaje);
                
                try {
                    const result = await firebase.functions().httpsCallable('interpretarExcelIA')({ 
                        datosCrudos: lote, 
                        fechaSeleccionada 
                    });
                    
                    if (result.data.reservas) {
                        todasLasReservas = [...todasLasReservas, ...result.data.reservas];
                    }
                } catch (batchError) {
                    console.error(`Error en lote ${currentBatch}:`, batchError);
                    // Seguimos con el siguiente lote aunque este falle
                }
            }

            actualizarProgreso(`Guardando ${todasLasReservas.length} reservas en base de datos...`, 90);
            
            if (todasLasReservas.length > 0) {
                 await guardarReservasEnLote(todasLasReservas);
            } else {
                alert("No se pudieron interpretar reservas.");
                ocultarProgreso();
            }

        } catch (error) {
            console.error("❌ Error importando:", error);
            alert("Error crítico en la importación: " + error.message);
            ocultarProgreso();
        } finally {
            inputElement.value = ''; // Limpiar input
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- IMPORTACIÓN PDF ---
export async function manejarImportacionPDF(event) {
    const file = event.target.files[0]; if(!file) return;
    if(file.size > 5*1024*1024) return alert("PDF muy grande (>5MB)");
    
    const fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]); 
    if(!fecha) { event.target.value=''; return; }
    
    actualizarProgreso("Subiendo documento a la IA...", 20);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const b64 = e.target.result.split(',')[1];
            
            actualizarProgreso("Inteligencia Artificial analizando PDF...", 50);
            
            const res = await firebase.functions().httpsCallable('interpretarPDFIA')({ pdfBase64: b64, fechaSeleccionada: fecha });
            const list = res.data.reservas;
            
            if(list?.length) {
                actualizarProgreso(`Guardando ${list.length} reservas...`, 80);
                await guardarReservasEnLote(list);
            } else {
                alert("No se encontraron reservas claras en el PDF.");
                ocultarProgreso();
            }
        } catch(err) { 
            alert("Error: " + err.message); 
            ocultarProgreso();
        }
        finally { event.target.value=''; }
    };
    reader.readAsDataURL(file);
}

// --- HELPERS DE LOTES (BLINDADO CONTRA ERRORES) ---
async function guardarReservasEnLote(list) {
    const batchLimit = 400;
    // Protección: Si window.appCaches no existe o clientes es null, usar objeto vacío
    const clientsCache = (window.appCaches && window.appCaches.clientes) ? window.appCaches.clientes : {};
    
    let batch = db.batch(), count = 0;
    
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        
        // Estandarización de claves (Por si la IA falla un poco)
        const clienteNombre = r.cliente || r.empresa || "PARTICULARES";
        const origen = r.origen || r.calle_origen || r.origen_calle || "Origen desconocido";
        const destino = r.destino || r.calle_destino || r.destino_calle || "Destino desconocido";
        
        // Búsqueda de cliente SEGURA (sin error toUpperCase)
        let cId = null;
        try {
            cId = Object.keys(clientsCache).find(k => {
                const nombreCache = clientsCache[k].nombre || "";
                return String(nombreCache).toUpperCase() === String(clienteNombre).toUpperCase();
            });
        } catch (e) { console.warn("Error buscando cliente en cache (ignorado):", e); }

        if (!cId) {
            // Si no existe, creamos uno nuevo en Firestore
            try {
                // Usamos un ID temporal si es lote masivo para no saturar lecturas/escrituras de configuración
                // O creamos el documento real:
                const nc = await db.collection('clientes').add({ nombre: String(clienteNombre), creadoEn: new Date() });
                cId = nc.id; 
                clientsCache[cId] = { nombre: String(clienteNombre) }; // Actualizar cache local
            } catch (err) {
                console.error("Error creando cliente:", err);
                cId = "PARTICULARES_FALLBACK"; 
            }
        }

        const nuevaReserva = {
            ...r,
            cliente: cId,
            origen: origen,
            destino: destino,
            nombre_pasajero: r.nombre_pasajero || r.pasajero || "Pasajero",
            telefono_pasajero: r.telefono_pasajero || r.telefono || "",
            estado: { principal: 'Revision', detalle: 'Importado IA', actualizado_en: new Date() },
            creadoEn: new Date(),
            cantidad_pasajeros: String(r.cantidad_pasajeros || '1'),
            es_exclusivo: false
        };

        batch.set(db.collection('reservas').doc(), nuevaReserva);
        
        if (++count >= batchLimit || i === list.length - 1) { 
            await batch.commit(); 
            batch = db.batch(); 
            count = 0; 
        }
    }
    
    actualizarProgreso("¡Importación Finalizada!", 100);
    setTimeout(ocultarProgreso, 3000);
    alert(`Importación completada: ${list.length} reservas.`);
    
    // Cambiar a la pestaña de importadas si existe
    const tabBtn = document.querySelector('button[data-tab="importadas"]');
    if(tabBtn) tabBtn.click();
}

export async function limpiarReservasDeRevision() {
    if(!confirm("¿Borrar TODAS las reservas en revisión? Esta acción no se puede deshacer.")) return;
    const q = db.collection('reservas').where('estado.principal','==','Revision').limit(400);
    
    let borrados = 0;
    while(true) {
        const s = await q.get(); if(s.empty) break;
        const b = db.batch(); 
        s.forEach(d => { b.delete(d.ref); borrados++; }); 
        await b.commit();
    }
    alert(`Limpieza completada. Se borraron ${borrados} reservas.`);
}

export async function procesarLoteRevision(accion, ids) {
    if(ids.length === 0) return alert("No hay reservas seleccionadas.");
    const b = db.batch();
    ids.forEach(id => {
        const ref = db.collection('reservas').doc(id);
        if(accion==='borrar') b.delete(ref);
        else b.update(ref, { estado: { principal: 'Pendiente', detalle: 'Masivo', actualizado_en: new Date() } });
    });
    await b.commit();
    
    // Limpiar checks
    document.querySelectorAll('.check-reserva-revision:checked').forEach(c => c.checked=false);
    document.getElementById('panel-acciones-lote').style.display = 'none';
}