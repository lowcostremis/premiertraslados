// js/reservas.js

import { db, functions, reservasSearchIndex } from './firebase-config.js';
import { hideMapContextMenu, getModalMarkerCoords } from './mapa.js';

// --- NUEVA FUNCIÓN REUTILIZABLE ---
export function poblarSelectDeMoviles(caches) {
    const movilSelect = document.getElementById('asignar_movil');
    if (!movilSelect) return;

    const valorActual = movilSelect.value;
    movilSelect.innerHTML = '<option value="">No asignar móvil aún</option>';

    caches.moviles.forEach(movil => {
        const choferAsignado = caches.choferes.find(c => c.movil_actual_id === movil.id);
        const choferInfo = choferAsignado ? ` - ${choferAsignado.nombre}` : ' - (Sin chofer)';
        const option = document.createElement('option');
        option.value = movil.id;
        option.textContent = `Móvil ${movil.numero}${choferInfo}`;
        movilSelect.appendChild(option);
    });

    movilSelect.value = valorActual;
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
        const horaA = (a.hora_pickup && a.hora_pickup.trim() !== '') ? a.hora_pickup : (a.hora_turno || '23:59');
        const dateTimeA = new Date(`${fechaA}T${horaA}`);
        const fechaB = b.fecha_turno || '9999-12-31';
        const horaB = (b.hora_pickup && b.hora_pickup.trim() !== '') ? b.hora_pickup : (b.hora_turno || '23:59');
        const dateTimeB = new Date(`${fechaB}T${horaB}`);
        return dateTimeA - dateTimeB; 
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
                   if (filtroChoferAsignadosId) {
                        if (reserva.chofer_asignado_id !== filtroChoferAsignadosId) return;
                    }

            } else if (estadoPrincipal === 'Pendiente') {
                if (fechaTurno && fechaTurno > limite24hs) {
                    targetTableId = 'tabla-pendientes';
                } else {
                    targetTableId = 'tabla-en-curso';
              }
            } else {
                    targetTableId = 'tabla-en-curso';
            }

            if (targetTableId === 'tabla-en-curso' && filtroHoras !== null) {
                const horaReferencia = reserva.hora_pickup || reserva.hora_turno;
                if (!reserva.fecha_turno || !horaReferencia) return;
                const fechaHoraReserva = new Date(`${reserva.fecha_turno}T${horaReferencia}`);
                const ahoraLocal = new Date();
                const diferenciaMilisegundos = fechaHoraReserva.getTime() - ahoraLocal.getTime();
                const horasDiferencia = diferenciaMilisegundos / (1000 * 60 * 60);
                
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
    
    const generarRegreso = f.tiene_regreso.checked;
    if (generarRegreso) {
        f.tiene_regreso.checked = false;
    }

    let datosParaRegreso = null;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
        
        const rId = f['reserva-id'].value;
        const movilIdParaAsignar = f.asignar_movil.value;
        const esX = f.viaje_exclusivo.checked;
        const cP = esX ? '4' : f.cantidad_pasajeros.value;
        
        const coords = getModalMarkerCoords(); 

        const d = {
            cliente: f.cliente.value,
            siniestro: f.siniestro.value,
            autorizacion: f.autorizacion.value,
            dni_pasajero: f.dni_pasajero.value.trim(),
            nombre_pasajero: f.nombre_pasajero.value,
            telefono_pasajero: f.telefono_pasajero.value,
            fecha_turno: f.fecha_turno.value,
            hora_turno: f.hora_turno.value,
            hora_pickup: f.hora_pickup.value,
            origen: f.origen.value,
            destino: f.destino.value,
            origen_coords: coords.origen,
            destino_coords: coords.destino,
            cantidad_pasajeros: cP,
            zona: f.zona.value,
            observaciones: f.observaciones.value,
            es_exclusivo: esX
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

        if (movilIdParaAsignar && reservaGuardadaId) {
            const reservaDoc = await db.collection('reservas').doc(reservaGuardadaId).get();
            if (reservaDoc.exists && reservaDoc.data().movil_asignado_id !== movilIdParaAsignar) {
                await asignarMovil(reservaGuardadaId, movilIdParaAsignar, caches);
            }
        }

        if (d.dni_pasajero && d.origen) {
            const pRef = db.collection('pasajeros').doc(d.dni_pasajero);
            const pData = {
                nombre_apellido: d.nombre_pasajero,
                telefono: d.telefono_pasajero,
                domicilios: firebase.firestore.FieldValue.arrayUnion(d.origen)
            };
            await pRef.set(pData, { merge: true });
        }
        
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
        alert("Error al guardar: " + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar Reserva';
    }

    return datosParaRegreso;
}

// --- NUEVA FUNCIÓN: CONFIRMAR DIRECTAMENTE DESDE EL MODAL ---
export async function handleConfirmarDesdeModal(e, caches) {
    e.preventDefault();
    const f = document.getElementById('reserva-form');
    
    // Validar formulario manualmente porque es un botón type="button"
    if (!f.checkValidity()) {
        f.reportValidity();
        return;
    }

    const btn = document.getElementById('btn-confirmar-modal');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Procesando...';
        
        const rId = f['reserva-id'].value;
        const movilIdParaAsignar = f.asignar_movil.value;
        const esX = f.viaje_exclusivo.checked;
        const cP = esX ? '4' : f.cantidad_pasajeros.value;
        const coords = getModalMarkerCoords(); 

        const d = {
            cliente: f.cliente.value,
            siniestro: f.siniestro.value,
            autorizacion: f.autorizacion.value,
            dni_pasajero: f.dni_pasajero.value.trim(),
            nombre_pasajero: f.nombre_pasajero.value,
            telefono_pasajero: f.telefono_pasajero.value,
            fecha_turno: f.fecha_turno.value,
            hora_turno: f.hora_turno.value,
            hora_pickup: f.hora_pickup.value,
            origen: f.origen.value,
            destino: f.destino.value,
            origen_coords: coords.origen,
            destino_coords: coords.destino,
            cantidad_pasajeros: cP,
            zona: f.zona.value,
            observaciones: f.observaciones.value,
            es_exclusivo: esX,
            // AQUÍ FORZAMOS EL CAMBIO DE ESTADO:
            estado: { 
                principal: 'Pendiente', 
                detalle: 'Confirmado por operador desde edición',
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp() 
            }
        };

        if (rId) {
            await db.collection('reservas').doc(rId).update(d);
        } else {
            // Raro caso de crear y confirmar a la vez, pero soportado
            d.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('reservas').add(d);
        }

        // Si asignaron móvil, procesarlo también
        if (movilIdParaAsignar && rId) {
             if (movilIdParaAsignar) {
                 await asignarMovil(rId, movilIdParaAsignar, caches);
             }
        }

        document.getElementById('reserva-modal').style.display = 'none';

    } catch (error) {
        alert("Error al confirmar: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Confirmar e Importar';
    }
}

export async function openEditReservaModal(reservaId, caches, initMapaModalCallback) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    const data = doc.data();
    const form = document.getElementById('reserva-form');
    form.reset();
    
    poblarSelectDeMoviles(caches);

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
    form.origen.value = data.origen || '';
    form.destino.value = data.destino || '';
    form.cantidad_pasajeros.value = data.cantidad_pasajeros || '1';
    form.zona.value = data.zona || '';
    form.observaciones.value = data.observaciones || '';
    form.asignar_movil.value = data.movil_asignado_id || '';
    
    document.getElementById('reserva-id').value = reservaId;
    document.getElementById('modal-title').textContent = 'Editar Reserva';
    
    // --- LÓGICA DEL BOTÓN DE CONFIRMACIÓN ---
    const btnConfirmar = document.getElementById('btn-confirmar-modal');
    // Verificar si el estado es 'Revision' (puede ser string u objeto)
    const estadoActual = (typeof data.estado === 'object' && data.estado.principal) ? data.estado.principal : data.estado;
    
    if (btnConfirmar) {
        if (estadoActual === 'Revision') {
            btnConfirmar.style.display = 'block';
        } else {
            btnConfirmar.style.display = 'none';
        }
    }
    // ----------------------------------------

    document.getElementById('reserva-modal').style.display = 'block';
    if(initMapaModalCallback) {
        setTimeout(() => initMapaModalCallback(data.origen_coords, data.destino_coords), 100);
    }
}

export async function confirmarReservaImportada(reservaId) {
    try {
        await db.collection('reservas').doc(reservaId).update({
            estado: { 
                principal: 'Pendiente', 
                detalle: 'Confirmado por operador',
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
            }
        });
    } catch (error) {
        console.error("Error al confirmar:", error);
        alert("Error: " + error.message);
    }
}

export async function asignarMovil(reservaId, movilId, caches) {
    if (!movilId) return;
    try {
        const choferAsignado = caches.choferes.find(c => c.movil_actual_id === movilId);
        if (!choferAsignado) {
            alert("Error: Este móvil no tiene un chofer vinculado actualmente.");
            return;
        }

        const batch = db.batch();
        const reservaRef = db.collection('reservas').doc(reservaId);
        const choferRef = db.collection('choferes').doc(choferAsignado.id);

        batch.update(reservaRef, {
            movil_asignado_id: movilId,
            chofer_asignado_id: choferAsignado.id,
            estado: { principal: 'Asignado', detalle: 'Enviada al chofer', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() }
        });
        batch.update(choferRef, { viajes_activos: firebase.firestore.FieldValue.arrayUnion(reservaId) });
        await batch.commit();
        hideMapContextMenu();
        window.app.hideTableMenus();
    } catch (err) {
        console.error("Error al asignar móvil:", err);
        alert("Error al asignar el móvil: " + err.message);
    }
}

export async function changeReservaState(reservaId, newState, caches) {
    if (['Anulado', 'Negativo'].includes(newState)) {
        if (confirm(`¿Estás seguro de que quieres marcar esta reserva como "${newState}"?`)) {
            await moverReservaAHistorico(reservaId, newState, caches);
            hideMapContextMenu();
            window.app.hideTableMenus();
        }
    }
}

export async function finalizarReserva(reservaId, caches) {
    if (confirm("¿Marcar esta reserva como finalizada?")) {
        await moverReservaAHistorico(reservaId, 'Finalizado', caches);
        hideMapContextMenu();
        window.app.hideTableMenus();
    }
}

export async function quitarAsignacion(reservaId) {
       if (confirm("¿Quitar la asignación de este móvil y devolver la reserva a 'En Curso'?")) {
      const reservaRef = db.collection('reservas').doc(reservaId);
      try {
          const doc = await reservaRef.get();
          if(!doc.exists) return;
          
          const choferId = doc.data().chofer_asignado_id;
          
          const batch = db.batch();
          batch.update(reservaRef, {
              estado: { principal: 'En Curso', detalle: 'Móvil des-asignado', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() },
              chofer_asignado_id: firebase.firestore.FieldValue.delete(),
              movil_asignado_id: firebase.firestore.FieldValue.delete()
          });

          if (choferId) {
              const choferRef = db.collection('choferes').doc(choferId);
              batch.update(choferRef, { viajes_activos: firebase.firestore.FieldValue.arrayRemove(reservaId) });
          }

          await batch.commit();
          hideMapContextMenu();
          window.app.hideTableMenus();
      } catch (error) {
          console.error("Error al quitar asignación:", error);
          alert("Hubo un error al actualizar la reserva.");
      }
  }
}

export async function updateHoraPickup(event, reservaId, horaTurno) {
    const nuevaHora = event.target.value;
    if (horaTurno && nuevaHora) {
        const horaTurnoDT = new Date(`1970-01-01T${horaTurno}`);
        const nuevaHoraDT = new Date(`1970-01-01T${nuevaHora}`);
        if (nuevaHoraDT.getTime() > horaTurnoDT.getTime() - (30 * 60 * 1000)) {
            alert("La Hora de Pickup debe ser al menos 30 minutos antes de la Hora del Turno.");
            const doc = await db.collection('reservas').doc(reservaId).get();
            event.target.value = doc.data().hora_pickup || '';
            return;
        }
    }
    try { await db.collection('reservas').doc(reservaId).update({ hora_pickup: nuevaHora }); } catch (error) { console.error("Error al actualizar Hora Pickup:", error); }
}

export async function updateZona(event, reservaId) {
    const nuevaZona = event.target.value;
    try { await db.collection('reservas').doc(reservaId).update({ zona: nuevaZona }); } catch (error) { console.error("Error al actualizar Zona:", error); }
}

export async function handleDniBlur(e) {
    const dni = e.target.value.trim();
    if (!dni) return;
    try {
        const doc = await db.collection('pasajeros').doc(dni).get();
        if (doc.exists) {
            const p = doc.data();
            const f = document.getElementById('reserva-form');
            f.nombre_pasajero.value = p.nombre_apellido || '';
            f.telefono_pasajero.value = p.telefono || '';
            if (p.domicilios && p.domicilios.length > 0) {
                f.origen.value = p.domicilios[p.domicilios.length - 1];
            }
        }
    } catch (error) {
        console.error("Error al buscar DNI:", error);
    }
}

export async function asignarMultiplesReservas(reservaIds, movilId, caches) {
    if (!movilId || reservaIds.length === 0) {
        alert("Seleccione un móvil y al menos una reserva.");
        return false;
    }

    const choferAsignado = caches.choferes.find(c => c.movil_actual_id === movilId);
    if (!choferAsignado) {
        alert("Error: El móvil seleccionado no tiene un chofer vinculado.");
        return false;
    }

    try {
        const batch = db.batch();

        reservaIds.forEach(reservaId => {
            const reservaRef = db.collection('reservas').doc(reservaId);
            batch.update(reservaRef, {
                movil_asignado_id: movilId,
                chofer_asignado_id: choferAsignado.id,
                estado: { principal: 'Asignado', detalle: 'Enviada al chofer', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() }
            });
        });

        const choferRef = db.collection('choferes').doc(choferAsignado.id);
        batch.update(choferRef, { 
            viajes_activos: firebase.firestore.FieldValue.arrayUnion(...reservaIds) 
        });

        await batch.commit();
        alert(`${reservaIds.length} viajes asignados correctamente al móvil ${choferAsignado.nombre}.`);
        return true;

    } catch (error) {
        console.error("Error en asignación múltiple:", error);
        alert("Error al asignar los viajes: " + error.message);
        return false;
    }
}

function renderFilaReserva(tbody, reserva, caches) {
    const cliente = caches.clientes[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    row.dataset.id = reserva.id;

    row.addEventListener('click', (e) => {
        if (!window.isTableMultiSelectMode) return;
        if (e.target.closest('button') || 
            e.target.closest('select') || 
            e.target.closest('input') || 
            e.target.closest('a')) {
            return;
        }
        window.app.toggleTableSelection(reserva.id, row);
    });
    
    const estadoPrincipal = (typeof reserva.estado === 'object' && reserva.estado.principal) ? reserva.estado.principal : reserva.estado;
    const estadoDetalle = (typeof reserva.estado === 'object' && reserva.estado.detalle) ? reserva.estado.detalle : '---';

    if (reserva.es_exclusivo) {
        row.style.backgroundColor = '#51ED8D'; row.style.color = '#333';
    } else if (estadoPrincipal === 'Negativo' || estadoDetalle === 'Traslado negativo') {
        row.style.backgroundColor = '#FFDE59'; row.style.color = '#333';
    } else if (estadoDetalle.startsWith('Rechazado por')) {
        row.style.backgroundColor = '#f8d7da'; row.style.color = '#721c24';
    } else if (estadoPrincipal === 'Anulado') {
        row.className = 'estado-anulado';
    } else if (cliente && cliente.color) {
        row.style.backgroundColor = cliente.color;
        const color = cliente.color;
        if (color && color.startsWith('#')) {
            const r = parseInt(color.substr(1, 2), 16), g = parseInt(color.substr(3, 2), 16), b = parseInt(color.substr(5, 2), 16);
            row.style.color = (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#333' : '#f0f0f0';
        }
    }
    
    let movilAsignadoTexto = '';
    if (reserva.movil_asignado_id) {
        const movilAsignado = caches.moviles.find(m => m.id === reserva.movil_asignado_id);
        const choferAsignado = caches.choferes.find(c => c.id === reserva.chofer_asignado_id);
        const textoMovil = movilAsignado ? `Móvil ${movilAsignado.numero}` : 'Móvil no encontrado';
        const textoChofer = choferAsignado ? ` (${choferAsignado.nombre})` : '';
        movilAsignadoTexto = textoMovil + textoChofer;
    }
    
    let estadoCombinadoHTML = `<strong>${estadoPrincipal || 'Pendiente'}</strong>`;
    if (estadoDetalle !== '---' && estadoDetalle !== `Estado cambiado a ${estadoPrincipal}`) {
        estadoCombinadoHTML += `<br><small style="color: #777;">${estadoDetalle}</small>`;
    }
    if (movilAsignadoTexto) {
         estadoCombinadoHTML += `<br><small style="color: #555;">${movilAsignadoTexto}</small>`;
    }
    
    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const containerId = tbody.closest('.reservas-container')?.id || '';
    const isRevision = containerId === 'reservas-importadas';
    const isAsignable = ['reservas-en-curso', 'reservas-pendientes', 'resultados-busqueda-reservas'].includes(containerId);
    const isAsignado = containerId === 'reservas-asignados';
    
    let menuItems = `<a href="#" onclick="window.app.openEditReservaModal('${reserva.id || reserva.objectID}')">Editar</a>`;
    
    if (isRevision) {
        menuItems += `<hr>`;
        menuItems += `<a href="#" style="color: green; font-weight: bold;" onclick="window.app.confirmarReservaImportada('${reserva.id}')">✅ CONFIRMAR VIAJE</a>`;
        menuItems += `<a href="#" style="color: red;" onclick="window.app.changeReservaState('${reserva.id}', 'Anulado')">❌ Descartar</a>`;
    }
    else if (isAsignable) {
        let movilesOptions = caches.moviles.map(movil => {
            const choferDelMovil = caches.choferes.find(c => c.movil_actual_id === movil.id);
            const nombreChofer = choferDelMovil ? ` (${choferDelMovil.nombre})` : ' (Sin chofer)';
            return `<option value="${movil.id}">N° ${movil.numero}${nombreChofer}</option>`;
        }).join('');
        menuItems += `<select onchange="window.app.asignarMovil('${reserva.id}', this.value)"><option value="">Asignar Móvil...</option>${movilesOptions}</select>`;
        menuItems += `<a href="#" onclick="window.app.changeReservaState('${reserva.id}', 'Negativo')">Marcar Negativo</a>`;
        menuItems += `<a href="#" onclick="window.app.changeReservaState('${reserva.id}', 'Anulado')">Anular</a>`;
    } else if (isAsignado) {
        menuItems += `<a href="#" onclick="window.app.finalizarReserva('${reserva.id}')">Finalizar</a>`;
        menuItems += `<a href="#" onclick="window.app.changeReservaState('${reserva.id}', 'Negativo')">Marcar Negativo</a>`;
        menuItems += `<a href="#" onclick="window.app.changeReservaState('${reserva.id}', 'Anulado')">Anular Viaje</a>`;
        menuItems += `<a href="#" onclick="window.app.quitarAsignacion('${reserva.id}')">Quitar Móvil</a>`;
    }
    const accionesHTML = `
        <td class="acciones">
            <div class="acciones-dropdown">
                <button class="icono-tres-puntos" onclick="window.app.toggleMenu(event)">⋮</button>
                <div class="menu-contenido">${menuItems}</div>
            </div>
        </td>`;

    row.innerHTML = `
        <td>${reserva.autorizacion || ''}</td>
        <td>${reserva.siniestro || ''}</td>
        <td>${fechaFormateada}</td>
        <td>${reserva.hora_turno || ''}</td>
        <td class="editable-cell pickup-cell"></td>
        <td>${reserva.nombre_pasajero || ''}</td>
        <td>${reserva.origen || ''}</td>
        <td>${reserva.destino || ''}</td>
        <td>${reserva.cantidad_pasajeros || 1}</td>
        <td class="editable-cell zona-cell"></td>
        <td>${cliente ? cliente.nombre : 'Default'}</td>
        <td>${estadoCombinadoHTML}</td>
        ${accionesHTML}
    `;

    const pickupCell = row.querySelector('.pickup-cell');
    const zonaCell = row.querySelector('.zona-cell');
    
    if (isAsignable) {
        pickupCell.innerHTML = `<input type="time" value="${reserva.hora_pickup || ''}" onchange="window.app.updateHoraPickup(event, '${reserva.id}', '${reserva.hora_turno}')">`;
        let zonaSelectHTML = `<select onchange="window.app.updateZona(event, '${reserva.id}')"><option value="">Seleccionar...</option>`;
        caches.zonas.forEach(zona => {
            const zonaDesc = zona.descripcion || '';
            zonaSelectHTML += `<option value="${zonaDesc}" ${reserva.zona === zonaDesc ? 'selected' : ''}>${zonaDesc}</option>`;
        });
        zonaSelectHTML += `</select>`;
        zonaCell.innerHTML = zonaSelectHTML;
    } else {
        pickupCell.textContent = reserva.hora_pickup || '';
        zonaCell.textContent = reserva.zona || '';
    }
}
  
async function moverReservaAHistorico(reservaId, estadoFinal, caches) {
   const reservaRef = db.collection('reservas').doc(reservaId);
    const historicoRef = db.collection('historico').doc(reservaId);

    try {
        await db.runTransaction(async (transaction) => {
            const reservaDoc = await transaction.get(reservaRef);

            if (!reservaDoc.exists) {
                const historicoDoc = await transaction.get(historicoRef);
                if (historicoDoc.exists) {
                    return; 
                } else {
                    throw "No se encontró la reserva para archivar.";
                }
            }

            const reservaData = reservaDoc.data();
            reservaData.estado = {
                principal: estadoFinal,
                detalle: `Viaje marcado como ${estadoFinal}`,
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
            };
            reservaData.archivadoEn = firebase.firestore.FieldValue.serverTimestamp();
            
            if (caches.clientes[reservaData.cliente]) {
                reservaData.clienteNombre = caches.clientes[reservaData.cliente].nombre;
            }
            if (reservaData.chofer_asignado_id) {
                const chofer = caches.choferes.find(c => c.id === reservaData.chofer_asignado_id);
                if (chofer) reservaData.choferNombre = chofer.nombre;
            }

            if (reservaData.chofer_asignado_id) {
                const choferRef = db.collection('choferes').doc(reservaData.chofer_asignado_id);
                const choferDoc = await transaction.get(choferRef);

                if (choferDoc.exists) {
                    transaction.update(choferRef, {
                        viajes_activos: firebase.firestore.FieldValue.arrayRemove(reservaId)
                    });
                }
            }

            transaction.set(historicoRef, reservaData); 
            transaction.delete(reservaRef);
        });
        
    } catch (error) {
        console.error("Error al mover reserva a histórico:", error);
        alert("Error al archivar la reserva: " + error.message);
    }
    
  }

// ===================================================================================
// IMPORTACIÓN DE EXCEL CON IA (VERSIÓN BATCH - POR LOTES)
// ===================================================================================
export async function manejarImportacionExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fechaSeleccionada = prompt("Ingrese la fecha de estos viajes (Formato: YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
    
    if (!fechaSeleccionada) {
        alert("Importación cancelada: Se requiere una fecha.");
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const todosLosDatos = XLSX.utils.sheet_to_json(worksheet);
            
            // --- NUEVA LÓGICA DE LOTES (BATCHING) ---
            const btnImportar = document.getElementById('btn-importar-excel');
            if(btnImportar) {
                btnImportar.disabled = true;
            }

            const TAMANO_LOTE = 40; 
            const totalLotes = Math.ceil(todosLosDatos.length / TAMANO_LOTE);
            let reservasAcumuladas = [];
            let erroresAcumulados = 0;

            console.log(`Iniciando importación por lotes. Total filas: ${todosLosDatos.length}. Total lotes: ${totalLotes}`);

            for (let i = 0; i < todosLosDatos.length; i += TAMANO_LOTE) {
                const loteActual = Math.floor(i / TAMANO_LOTE) + 1;
                const datosLote = todosLosDatos.slice(i, i + TAMANO_LOTE);
                
                if(btnImportar) {
                    btnImportar.textContent = `⏳ Analizando lote ${loteActual}/${totalLotes}...`;
                }

                try {
                    const interpretarExcel = firebase.functions().httpsCallable('interpretarExcelIA');
                    const result = await interpretarExcel({ datosCrudos: datosLote, fechaSeleccionada });
                    
                    if (result.data && result.data.reservas) {
                        reservasAcumuladas = [...reservasAcumuladas, ...result.data.reservas];
                    }
                } catch (errLote) {
                    console.error(`Error en lote ${loteActual}:`, errLote);
                    erroresAcumulados++;
                }
            }

            const reservasProcesadas = reservasAcumuladas.map(r => ({
                ...r,
                fecha_turno: fechaSeleccionada
            }));

            if (reservasProcesadas.length > 0) {
                 let mensaje = `La IA procesó ${reservasProcesadas.length} reservas correctamente.`;
                 if (erroresAcumulados > 0) mensaje += `\n(Hubo error en ${erroresAcumulados} lotes).`;
                 mensaje += `\n\nSe guardarán en "Importadas (Revisión)" para que las verifiques.`;

                 if (confirm(mensaje)) {
                    if(btnImportar) btnImportar.textContent = "💾 Guardando...";
                    await guardarReservasEnLote(reservasProcesadas);
                 }
            } else {
                alert("No se pudieron procesar reservas. Revisa la consola o el formato del archivo.");
            }

        } catch (error) {
            console.error("Error importando:", error);
            alert("Hubo un error crítico al procesar: " + error.message);
        } finally {
            const btnImportar = document.getElementById('btn-importar-excel');
            if(btnImportar) {
                btnImportar.textContent = "📂 Importar Excel";
                btnImportar.disabled = false;
            }
            event.target.value = ''; 
        }
    };

    reader.readAsArrayBuffer(file);
}

async function guardarReservasEnLote(reservas) {
    const db = firebase.firestore();
    const batchLimit = 400; // Límite de Firestore batch es 500
    
    const clientesCache = window.appCaches ? window.appCaches.clientes : {};
    const clientesNuevosEnEsteLote = {}; 
    
    let operaciones = [];

    for (const reserva of reservas) {
        const docRef = db.collection('reservas').doc();
        
        let clienteIdFinal = null;
        const nombreClienteIA = (reserva.cliente || 'PARTICULARES').trim().toUpperCase();

        for (const [id, datos] of Object.entries(clientesCache)) {
            if (datos.nombre.toUpperCase().trim() === nombreClienteIA) {
                clienteIdFinal = id;
                break;
            }
        }

        if (!clienteIdFinal && clientesNuevosEnEsteLote[nombreClienteIA]) {
            clienteIdFinal = clientesNuevosEnEsteLote[nombreClienteIA];
        }

        if (!clienteIdFinal) {
            try {
                const nombreParaGuardar = (reserva.cliente || 'Nuevo Cliente').trim();
                const nuevoClienteRef = await db.collection('clientes').add({
                    nombre: nombreParaGuardar,
                    creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
                    origen_dato: 'Importación Automática Excel',
                    telefono: '', 
                    cuit: ''
                });
                clienteIdFinal = nuevoClienteRef.id;
                clientesNuevosEnEsteLote[nombreClienteIA] = clienteIdFinal;
            } catch (error) {
                console.error(`Error creando cliente ${nombreClienteIA}:`, error);
                clienteIdFinal = 'Default';
            }
        }

        const nuevaReserva = {
            ...reserva,
            cliente: clienteIdFinal,
            estado: { 
                principal: 'Revision', 
                detalle: 'Esperando confirmación de operador', 
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp() 
            },
            creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            cantidad_pasajeros: '1', 
            
           
            es_exclusivo: reserva.es_exclusivo || false
        };
        
        operaciones.push({ ref: docRef, data: nuevaReserva });
    }

    let batch = db.batch();
    let counter = 0;
    let totalGuardados = 0;

    for (let i = 0; i < operaciones.length; i++) {
        batch.set(operaciones[i].ref, operaciones[i].data);
        counter++;
        
        if (counter >= batchLimit || i === operaciones.length - 1) {
            await batch.commit();
            totalGuardados += counter;
            batch = db.batch();
            counter = 0;
        }
    }

    alert(`¡Éxito! Se cargaron ${totalGuardados} reservas en la pestaña "Importadas".`);
    const btnImportadas = document.querySelector('button[data-tab="importadas"]');
    if(btnImportadas) btnImportadas.click();
}