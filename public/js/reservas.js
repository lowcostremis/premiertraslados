// js/reservas.js

import { db, functions, reservasSearchIndex } from './firebase-config.js';

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
                // No mostrar
            } else if (estadoPrincipal === 'Asignado' || estadoPrincipal === 'En Origen' || estadoPrincipal === 'Viaje Iniciado') {
                targetTableId = 'tabla-asignados';
            } else if (fechaTurno && fechaTurno > limite24hs && estadoPrincipal !== 'Negativo') {
                targetTableId = 'tabla-pendientes';
            } else {
                targetTableId = 'tabla-en-curso';
            }

            if (targetTableId === 'tabla-asignados' && filtroChoferAsignadosId && reserva.chofer_asignado_id !== filtroChoferAsignadosId) {
                return;
            }

            if (targetTableId === 'tabla-en-curso' && filtroHoras !== null) {
                const horaReferencia = reserva.hora_pickup || reserva.hora_turno;
                if (!reserva.fecha_turno || !horaReferencia) return;
                const fechaHoraReserva = new Date(`${reserva.fecha_turno}T${horaReferencia}`);
                const ahoraLocal = new Date();
                const diferenciaMilisegundos = fechaHoraReserva.getTime() - ahoraLocal.getTime();
                const horasDiferencia = diferenciaMilisegundos / (1000 * 60 * 60);
                if (horasDiferencia < 0 || horasDiferencia > filtroHoras) return;
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
        const tabActiva = document.querySelector('#Reservas .sub-tab-btn.active').dataset.tab;
        containersOriginales.forEach(c => c.style.display = 'none');
        document.getElementById(`reservas-${tabActiva}`).style.display = 'block';
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
    const rId = f['reserva-id'].value;
    const movilIdParaAsignar = f.asignar_movil.value;
    const esX = f.viaje_exclusivo.checked;
    const cP = esX ? '4' : f.cantidad_pasajeros.value;
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
        cantidad_pasajeros: cP,
        zona: f.zona.value,
        observaciones: f.observaciones.value,
        es_exclusivo: esX
    };
    if (!rId) {
        d.estado = { principal: 'Pendiente', detalle: 'Recién creada', actualizado_en: firebase.firestore.FieldValue.serverTimestamp() };
        d.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
    }
    try {
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
        document.getElementById('reserva-modal').style.display = 'none';
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
}

export async function openEditReservaModal(reservaId, initMapaModalCallback) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    const data = doc.data();
    const form = document.getElementById('reserva-form');
    form.reset();
    form.viaje_exclusivo.checked = false;
    form.cantidad_pasajeros.disabled = false;
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
    if (data.es_exclusivo) {
        form.viaje_exclusivo.checked = true;
        form.cantidad_pasajeros.value = '4';
        form.cantidad_pasajeros.disabled = true;
    }
    document.getElementById('reserva-id').value = reservaId;
    document.getElementById('modal-title').textContent = 'Editar Reserva';
    document.getElementById('reserva-modal').style.display = 'block';
    if(initMapaModalCallback) {
        setTimeout(() => initMapaModalCallback(data.origen_coords, data.destino_coords), 100);
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
    } catch (err) {
        console.error("Error al asignar móvil:", err);
        alert("Error al asignar el móvil: " + err.message);
    }
}

export async function changeReservaState(reservaId, newState, caches) {
    if (['Anulado', 'Negativo'].includes(newState)) {
        if (confirm(`¿Estás seguro de que quieres marcar esta reserva como "${newState}"?`)) {
            await moverReservaAHistorico(reservaId, newState, caches);
        }
    }
}

export async function finalizarReserva(reservaId, caches) {
    if (confirm("¿Marcar esta reserva como finalizada?")) {
        await moverReservaAHistorico(reservaId, 'Finalizado', caches);
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

// --- FUNCIONES INTERNAS (NO EXPORTADAS) ---

function renderFilaReserva(tbody, reserva, caches) {
    const cliente = caches.clientes[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    
    const estadoPrincipal = (typeof reserva.estado === 'object' && reserva.estado.principal) ? reserva.estado.principal : reserva.estado;
    const estadoDetalle = (typeof reserva.estado === 'object' && reserva.estado.detalle) ? reserva.estado.detalle : '---';

    // Estilos de fila
    if (reserva.es_exclusivo) {
        row.style.backgroundColor = '#51ED8D'; row.style.color = '#333';
    } else if (estadoPrincipal === 'Negativo' || estadoDetalle === 'Traslado negativo') {
        row.style.backgroundColor = '#FFDE59'; row.style.color = '#333';
    } else if (estadoDetalle.startsWith('Rechazado por')) {
        row.style.backgroundColor = '#f8d7da'; row.style.color = '#721c24';
    } else if (estadoPrincipal === 'Anulado') {
        row.className = 'estado-anulado';
    } else if (cliente.color) {
        row.style.backgroundColor = cliente.color;
        const color = cliente.color;
        if (color && color.startsWith('#')) {
            const r = parseInt(color.substr(1, 2), 16), g = parseInt(color.substr(3, 2), 16), b = parseInt(color.substr(5, 2), 16);
            row.style.color = (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#333' : '#f0f0f0';
        }
    }
    
    // Texto del móvil asignado
    let movilAsignadoTexto = '';
    if (reserva.movil_asignado_id) {
        const movilAsignado = caches.moviles.find(m => m.id === reserva.movil_asignado_id);
        const choferAsignado = caches.choferes.find(c => c.id === reserva.chofer_asignado_id);
        const textoMovil = movilAsignado ? `Móvil ${movilAsignado.numero}` : 'Móvil no encontrado';
        const textoChofer = choferAsignado ? ` (${choferAsignado.nombre})` : '';
        movilAsignadoTexto = textoMovil + textoChofer;
    }
    
    // HTML para la celda de estado
    let estadoCombinadoHTML = `<strong>${estadoPrincipal || 'Pendiente'}</strong>`;
    if (estadoDetalle !== '---' && estadoDetalle !== `Estado cambiado a ${estadoPrincipal}`) {
        estadoCombinadoHTML += `<br><small style="color: #777;">${estadoDetalle}</small>`;
    }
    if (movilAsignadoTexto) {
         estadoCombinadoHTML += `<br><small style="color: #555;">${movilAsignadoTexto}</small>`;
    }
    
    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const containerId = tbody.closest('.reservas-container')?.id || '';
    const isAsignable = ['reservas-en-curso', 'reservas-pendientes', 'resultados-busqueda-reservas'].includes(containerId);
    const isAsignado = containerId === 'reservas-asignados';
    
    // Construcción del menú de acciones
    let menuItems = `<a href="#" onclick="window.app.openEditReservaModal('${reserva.id || reserva.objectID}')">Editar</a>`;
    if (isAsignable) {
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

    // Llenado de la fila
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
        <td>${cliente.nombre}</td>
        <td>${estadoCombinadoHTML}</td>
        ${accionesHTML}
    `;

    // Celdas editables
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
            const doc = await transaction.get(reservaRef);
            if (!doc.exists) throw "No se encontró la reserva para archivar.";

            const reservaData = doc.data();
            reservaData.estado = {
                principal: estadoFinal,
                detalle: `Viaje marcado como ${estadoFinal}`,
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
            };
            reservaData.archivadoEn = firebase.firestore.FieldValue.serverTimestamp();
            
            if (caches.clientes[reservaData.cliente]) {
                reservaData.clienteNombre = caches.clientes[reservaData.cliente].nombre;
            } else {
                reservaData.clienteNombre = 'Default';
            }

            if (reservaData.chofer_asignado_id) {
                const choferRef = db.collection('choferes').doc(reservaData.chofer_asignado_id);
                transaction.update(choferRef, {
                    viajes_activos: firebase.firestore.FieldValue.arrayRemove(reservaId)
                });
            }

            transaction.set(historicoRef, reservaData);
            transaction.delete(reservaRef);
        });
    } catch (error) {
        console.error("Error al mover reserva a histórico:", error);
        alert("Error al archivar la reserva.");
    }
}

// js/main.js

// 1. IMPORTACIONES DE TODOS LOS MÓDULOS
import { auth, db } from './firebase-config.js';
import { openTab, showReservasTab, openAdminTab } from './tabs.js';
import { initHistorial, cargarHistorial } from './historial.js';
import { initPasajeros, cargarPasajeros } from './pasajeros.js';
import { initAdmin, editItem, deleteItem, openResetPasswordModal } from './admin.js';
import { initMapa, initMapInstance, initMapaModal, cargarMarcadoresDeReservas, filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer, escucharUbicacionChoferes } from './mapa.js';
import { 
    listenToReservas,
    renderAllReservas,
    handleSaveReserva,
    openEditReservaModal,
    asignarMovil,
    changeReservaState,
    finalizarReserva,
    quitarAsignacion,
    updateHoraPickup,
    updateZona,
    handleDniBlur,
    filtrarPorHoras // <-- AÑADIR ESTA LÍNEA
} from './reservas.js';


// 2. ESTADO GLOBAL Y VARIABLES
let caches = {
    clientes: {},
    choferes: [],
    zonas: [],
    moviles: []
};
let lastReservasSnapshot = null;
let appInitialized = false;
let filtroChoferAsignadosId = null;
let filtroHoras = null;

// 3. LÓGICA DE AUTENTICACIÓN
auth.onAuthStateChanged(user => {
    const authSection = document.getElementById('auth-section');
    const appContent = document.getElementById('app-content');
    if (user) {
        authSection.style.display = 'none';
        appContent.style.display = 'block';
        document.getElementById('user-email-display').textContent = user.email;
        initApp();
    } else {
        authSection.style.display = 'flex';
        appContent.style.display = 'none';
        appInitialized = false;
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => alert("Error de autenticación: " + error.message));
});

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());


// 4. FUNCIONES PRINCIPALES Y DE UTILIDAD
function loadAuxData() {
    db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
        const clienteSelect = document.getElementById('cliente');
        caches.clientes = {};
        if (clienteSelect) clienteSelect.innerHTML = '<option value="Default">Default</option>';
        snapshot.forEach(doc => {
            const data = doc.data();
            caches.clientes[doc.id] = data;
            if (clienteSelect) clienteSelect.innerHTML += `<option value="${doc.id}">${data.nombre}</option>`;
        });
        setupExportControls();
    });

    db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
        caches.choferes = [];
        snapshot.forEach(doc => caches.choferes.push({ id: doc.id, ...doc.data() }));
        actualizarFiltroChoferesAsignados();
    });

    db.collection('zonas').orderBy('numero').onSnapshot(snapshot => {
        const zonaSelect = document.getElementById('zona');
        caches.zonas = [];
        if (zonaSelect) zonaSelect.innerHTML = '<option value="">Seleccionar Zona...</option>';
        snapshot.forEach(doc => {
            const data = doc.data();
            caches.zonas.push({ id: doc.id, ...data });
            if (zonaSelect) zonaSelect.innerHTML += `<option value="${data.descripcion}">${data.numero} - ${data.descripcion}</option>`;
        });
    });

    db.collection('moviles').orderBy('numero').onSnapshot(snapshot => {
        caches.moviles = [];
        snapshot.forEach(doc => caches.moviles.push({ id: doc.id, ...doc.data() }));
        actualizarFiltroChoferesAsignados();
    });
}

function toggleMenu(event) {
    event.stopPropagation();
    document.querySelectorAll('.menu-contenido.visible').forEach(menu => {
        if (menu !== event.currentTarget.nextElementSibling) {
            menu.classList.remove('visible');
        }
    });
    event.currentTarget.nextElementSibling.classList.toggle('visible');
}

function actualizarFiltroChoferesAsignados() {
    const choferSelect = document.getElementById('filtro-chofer-asignados');
    if (!choferSelect) return;

    const valorSeleccionado = choferSelect.value;
    choferSelect.innerHTML = '<option value="">Ver todos los móviles</option>';

    const movilesConChofer = caches.choferes
        .map(chofer => {
            if (chofer.movil_actual_id) {
                const movilAsignado = caches.moviles.find(m => m.id === chofer.movil_actual_id);
                if (movilAsignado) {
                    return { choferId: chofer.id, choferNombre: chofer.nombre, movilNumero: movilAsignado.numero };
                }
            }
            return null;
        })
        .filter(item => item !== null)
        .sort((a, b) => a.movilNumero - b.movilNumero);

    movilesConChofer.forEach(item => {
        const numeroMovil = `Móvil ${item.movilNumero}`;
        const optionHTML = `<option value="${item.choferId}">${numeroMovil} - ${item.choferNombre}</option>`;
        choferSelect.innerHTML += optionHTML;
    });

    choferSelect.value = valorSeleccionado;
}

function filtrarReservasAsignadasPorChofer(choferId) {
    filtroChoferAsignadosId = choferId || null;
    if (lastReservasSnapshot) {
        renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
    }
}

function setupExportControls() { /* ... Lógica de exportación ... */ }

// 5. FUNCIÓN DE INICIALIZACIÓN PRINCIPAL
function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    console.log("Aplicación Inicializada y Módulos Conectados");
    
    // Listeners de botones y modales
    const nuevaReservaBtn = document.getElementById('btn-nueva-reserva');
    if (nuevaReservaBtn) {
        nuevaReservaBtn.addEventListener('click', () => { /* ... código para abrir modal ... */ });
    }
    const closeModal = (modalId) => { 
        const modal = document.getElementById(modalId);
        if(modal) modal.style.display = 'none';
     };
    document.querySelector('.close-btn')?.addEventListener('click', () => closeModal('reserva-modal'));
    document.querySelector('.close-edit-btn')?.addEventListener('click', () => closeModal('edit-modal'));
    document.querySelector('.close-reset-password-btn')?.addEventListener('click', () => closeModal('reset-password-modal'));


    window.app = {
        editItem, deleteItem, openResetPasswordModal,
        openEditReservaModal: (reservaId) => openEditReservaModal(reservaId, initMapaModal),
        asignarMovil: (reservaId, movilId) => asignarMovil(reservaId, movilId, caches),
        changeReservaState, finalizarReserva, quitarAsignacion, updateHoraPickup, updateZona,
        toggleMenu,
        filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer,
        filtrarReservasAsignadasPorChofer,
        filtrarPorHoras // <-- FUNCIÓN EXPUESTA
    };
    
    window.openTab = (event, tabName) => openTab(event, tabName, { initMapInstance, escucharUbicacionChoferes, cargarMarcadoresDeReservas, cargarHistorial, cargarPasajeros });
    window.showReservasTab = showReservasTab;
    window.openAdminTab = openAdminTab;
    
    document.getElementById('reserva-form').addEventListener('submit', (e) => handleSaveReserva(e, caches));
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);

    loadAuxData();
    initHistorial(caches);
    initPasajeros();
    initAdmin(caches);
    initMapa(caches, () => lastReservasSnapshot);

    listenToReservas(snapshot => {
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot, caches, filtroChoferAsignadosId, filtroHoras);
        if (document.getElementById('Mapa').style.display === 'block') {
            cargarMarcadoresDeReservas();
        }
    });

    openTab(null, 'Reservas');
}
