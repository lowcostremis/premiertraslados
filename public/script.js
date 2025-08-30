// ===================================================================================
// CONFIGURACIÓN DE FIREBASE
// ===================================================================================
const firebaseConfig = {
    apiKey: "AIzaSyA5c2-7JR_bPXYu2FPg-ZVMsq-7NZrSSBk",
    authDomain: "premiertraslados-31ee2.firebaseapp.com",
    projectId: "premiertraslados-31ee2",
    storageBucket: "premiertraslados-31ee2.appspot.com",
    messagingSenderId: "398176651975",
    appId: "1:398176651975:web:ab2bc9ab16da98c77ccce2"
};

// INICIALIZACIÓN DE SERVICIOS
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// --- INICIALIZACIÓN DE ALGOLIA ---
const searchClient = algoliasearch('GOATTC1A5K', 'c2d6dbf6e25ca6507079dc12c95ddc69');
const pasajerosSearchIndex = searchClient.initIndex('pasajeros');
const historicoSearchIndex = searchClient.initIndex('historico');
const reservasSearchIndex = searchClient.initIndex('reservas');
// --- FIN INICIALIZACIÓN DE ALGOLIA ---


// ===================================================================================
// LÓGICA PARA HISTÓRICO
// ===================================================================================
let historialBody, btnAnterior, btnSiguiente, indicadorPagina;
const registrosPorPagina = 100;
let ultimoDocVisible = null;
let historialDePaginas = [null];
let paginaActual = 0;

async function cargarHistorial() {
    if (!historialBody) return;
    try {
        historialBody.innerHTML = '<tr><td colspan="11">Cargando historial...</td></tr>';
        btnAnterior.disabled = true;
        btnSiguiente.disabled = true;
        let query = db.collection('historico').orderBy('archivadoEn', 'desc');
        const cursor = historialDePaginas[paginaActual];
        if (cursor) {
            query = query.startAfter(cursor);
        }
        query = query.limit(registrosPorPagina);
        const querySnapshot = await query.get();
        const documentos = querySnapshot.docs;
        if (documentos.length === 0 && paginaActual === 0) {
            historialBody.innerHTML = '<tr><td colspan="11">No hay viajes en el historial.</td></tr>';
            actualizarEstadoBotonesPaginacion(0);
            return;
        }
        if (documentos.length > 0) {
            ultimoDocVisible = documentos[documentos.length - 1];
        }
        mostrarDatosHistorialEnTabla(documentos);
        actualizarEstadoBotonesPaginacion(documentos.length);
    } catch (error) {
        console.error("Error al cargar el historial: ", error);
        historialBody.innerHTML = '<tr><td colspan="11">Error al cargar los datos.</td></tr>';
    }
}

function mostrarDatosHistorialEnTabla(documentos) {
    if (!historialBody) return;
    historialBody.innerHTML = '';

    if (documentos.length === 0) {
        historialBody.innerHTML = '<tr><td colspan="11">No se encontraron viajes con ese criterio.</td></tr>';
        return;
    }

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        
        const fecha = viaje.fecha_turno ? new Date(viaje.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR', { timeZone: 'UTC' }) : 'N/A';

        let nombreChofer = 'N/A';
        if (viaje.chofer_asignado_id && choferesCache.length > 0) {
            const chofer = choferesCache.find(c => c.id === viaje.chofer_asignado_id);
            if (chofer) {
                nombreChofer = chofer.nombre;
            }
        }

        let estiloFila = '';
        if (viaje.estado === 'Negativo') {
            estiloFila = 'style="background-color: #FFDE59; color: #333;"';
        } else if (viaje.estado === 'Anulado') {
            estiloFila = 'style="text-decoration: line-through;"';
        }

        const fila = `
            <tr class="border-b border-gray-700 hover:bg-gray-800" ${estiloFila}>
                <td>${fecha}</td>
                <td>${viaje.hora_turno || 'N/A'}</td>
                <td>${viaje.hora_pickup || 'N/A'}</td>
                <td>${viaje.nombre_pasajero || 'N/A'}</td>
                <td>${viaje.autorizacion || 'N/A'}</td>
                <td>${viaje.siniestro || 'N/A'}</td>
                <td>${viaje.clienteNombre || 'N/A'}</td>
                <td>${viaje.origen || 'N/A'}</td>
                <td>${viaje.destino || 'N/A'}</td>
                <td>${nombreChofer}</td>
                <td>${viaje.estado || 'N/A'}</td>
            </tr>
        `;
        historialBody.innerHTML += fila;
    });
}


function actualizarEstadoBotonesPaginacion(cantidadDocsRecibidos) {
    btnAnterior.disabled = (paginaActual === 0);
    btnSiguiente.disabled = (cantidadDocsRecibidos < registrosPorPagina);
    if (indicadorPagina) {
        indicadorPagina.textContent = `Página ${paginaActual + 1}`;
    }
}

async function buscarEnHistorial(texto) {
    const paginacionContainer = document.getElementById('paginacion-historico');
    if (!texto) {
        if (paginacionContainer) paginacionContainer.style.display = 'block';
        paginaActual = 0;
        historialDePaginas = [null];
        cargarHistorial();
        return;
    }
    try {
        if (paginacionContainer) paginacionContainer.style.display = 'none';
        historialBody.innerHTML = '<tr><td colspan="11">Buscando...</td></tr>';
        const { hits } = await historicoSearchIndex.search(texto);
        mostrarDatosHistorialEnTabla(hits);
    } catch (error) {
        console.error("Error buscando en Algolia: ", error);
        historialBody.innerHTML = '<tr><td colspan="11">Error al realizar la búsqueda.</td></tr>';
        if (paginacionContainer) paginacionContainer.style.display = 'block';
    }
}

// ===================================================================================
// LÓGICA PARA PASAJEROS
// ===================================================================================
let pasajerosBody, pasajerosBtnAnterior, pasajerosBtnSiguiente, pasajerosIndicadorPagina;
const pasajerosPorPagina = 100;
let pasajerosUltimoDocVisible = null;
let pasajerosHistorialDePaginas = [null];
let pasajerosPaginaActual = 0;

function renderPasajerosTable(documentos) {
    if (!pasajerosBody) return;
    if (documentos.length === 0) {
        pasajerosBody.innerHTML = '<p>No se encontraron pasajeros.</p>';
        return;
    }
    let tableHTML = `<div class="table-wrapper"><table><thead><tr><th>DNI</th><th>Nombre y Apellido</th><th>Teléfono</th><th>Domicilios</th><th>Acciones</th></tr></thead><tbody>`;
    documentos.forEach(doc => {
        const item = typeof doc.data === 'function' ? doc.data() : doc;
        const id = typeof doc.data === 'function' ? doc.id : doc.objectID;
        const domicilios = Array.isArray(item.domicilios) ? item.domicilios.join(', ') : (item.domicilios || '-');
        tableHTML += `<tr>
            <td>${id}</td>
            <td>${item.nombre_apellido || '-'}</td>
            <td>${item.telefono || '-'}</td>
            <td>${domicilios}</td>
            <td class="acciones">
               <button onclick="editItem('pasajeros', '${id}')">Editar</button>
               <button class="btn-danger" onclick="deleteItem('pasajeros', '${id}')">Borrar</button>
            </td>
        </tr>`;
    });
    tableHTML += `</tbody></table></div>`;
    pasajerosBody.innerHTML = tableHTML;
}

async function cargarPasajeros() {
    if (!pasajerosBody) return;
    try {
        pasajerosBody.innerHTML = '<p>Cargando pasajeros...</p>';
        pasajerosBtnAnterior.disabled = true;
        pasajerosBtnSiguiente.disabled = true;
        let query = db.collection('pasajeros').orderBy(firebase.firestore.FieldPath.documentId());
        const cursor = pasajerosHistorialDePaginas[pasajerosPaginaActual];
        if (cursor) {
            query = query.startAfter(cursor);
        }
        query = query.limit(pasajerosPorPagina);
        const querySnapshot = await query.get();
        const documentos = querySnapshot.docs;
        if (documentos.length > 0) {
            pasajerosUltimoDocVisible = documentos[documentos.length - 1];
        }
        renderPasajerosTable(documentos);
        pasajerosBtnAnterior.disabled = (pasajerosPaginaActual === 0);
        pasajerosBtnSiguiente.disabled = (documentos.length < pasajerosPorPagina);
        if (pasajerosIndicadorPagina) {
            pasajerosIndicadorPagina.textContent = `Página ${pasajerosPaginaActual + 1}`;
        }
    } catch (error) {
        console.error("Error al cargar los pasajeros: ", error);
        pasajerosBody.innerHTML = '<p style="color:red;">Error al cargar los datos.</p>';
    }
}

async function buscarEnPasajeros(texto) {
    const paginacionContainer = document.getElementById('paginacion-pasajeros');
    if (!texto) {
        if (paginacionContainer) paginacionContainer.style.display = 'block';
        pasajerosPaginaActual = 0;
        pasajerosHistorialDePaginas = [null];
        cargarPasajeros();
        return;
    }
    try {
        if (paginacionContainer) paginacionContainer.style.display = 'none';
        pasajerosBody.innerHTML = '<p>Buscando...</p>';
        const { hits } = await pasajerosSearchIndex.search(texto);
        renderPasajerosTable(hits);
    } catch (error) {
        console.error("Error buscando pasajeros en Algolia: ", error);
        pasajerosBody.innerHTML = '<p style="color:red;">Error al realizar la búsqueda.</p>';
    }
}


// ===================================================================================
// LÓGICA PARA RESERVAS Y MAPA
// ===================================================================================
let map;
let autocompleteOrigen, autocompleteDestino;
let clientesCache = {};
let choferesCache = [];
let zonasCache = [];
let movilesCache = [];
let unsubscribeReservas;
let adminListeners = [];
let lastReservasSnapshot = null;
let mapaModal, marcadorOrigenModal, marcadorDestinoModal, geocoder;
let filtroMapaActual = 'Todos';
let refrescoAutomaticoIntervalo;
let marcadoresOrigen = {};
let marcadorDestinoActivo = null;
let infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;

/**
 * Función auxiliar para ocultar el menú contextual del mapa.
 */
function hideMapContextMenu() {
    if (mapContextMenu) {
        mapContextMenu.style.display = 'none';
    }
}

function listenToReservas() {
    if (unsubscribeReservas) unsubscribeReservas();
    unsubscribeReservas = db.collection('reservas').orderBy("creadoEn", "desc").onSnapshot(snapshot => {
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot);
        if (map) cargarMarcadoresDeReservas();
    }, err => console.error("Error escuchando reservas:", err));
}

function renderAllReservas(snapshot) {
    const bodies = {
        'tabla-en-curso': document.querySelector('#tabla-en-curso tbody'),
        'tabla-pendientes': document.querySelector('#tabla-pendientes tbody'),
        'tabla-asignados': document.querySelector('#tabla-asignados tbody'),
    };
    Object.values(bodies).forEach(body => { if (body) body.innerHTML = ''; });
    const ahora = new Date();
    const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));
    snapshot.forEach(doc => {
        const reserva = { id: doc.id, ...doc.data() };
        const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
        let targetTableId = '';
        if (['Finalizado', 'Anulado', 'Negativo'].includes(reserva.estado)) {} else if (reserva.chofer_asignado_id) {
            targetTableId = 'tabla-asignados';
        } else if (fechaTurno && fechaTurno > limite24hs) {
            targetTableId = 'tabla-pendientes';
        } else {
            targetTableId = 'tabla-en-curso';
        }
        if (targetTableId && bodies[targetTableId]) {
            renderFilaReserva(bodies[targetTableId], reserva);
        }
    });
}

function renderFilaReserva(tbody, reserva) {
    const cliente = clientesCache[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    if (reserva.estado === 'Negativo') row.className = 'estado-negativo';
    else if (reserva.estado === 'Anulado') row.className = 'estado-anulado';
    else if (cliente.color) {
        row.style.backgroundColor = cliente.color;
        const color = cliente.color;
        if (color && color.startsWith('#')) {
            const r = parseInt(color.substr(1, 2), 16),
                g = parseInt(color.substr(3, 2), 16),
                b = parseInt(color.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            row.style.color = (yiq >= 128) ? '#333' : '#f0f0f0';
        }
    }
    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    
    const isSpecialTable = tbody.parentElement.id === 'tabla-en-curso' || tbody.parentElement.id === 'tabla-pendientes' || tbody.parentElement.id === 'tabla-asignados';
    const isEditable = isSpecialTable && (tbody.parentElement.id === 'tabla-en-curso' || tbody.parentElement.id === 'tabla-pendientes');
    const isAsignado = isSpecialTable && tbody.parentElement.id === 'tabla-asignados';

    let menuItems = `<a href="#" onclick="openEditReservaModal('${reserva.id || reserva.objectID}'); return false;">Editar</a>`;
    if (isEditable) {
        menuItems += `<select onchange="asignarChofer('${reserva.id}', this.value)"><option value="">Asignar Chofer...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Anulado'); return false;">Anular</a>`;
    } else if (isAsignado) {
        menuItems += `<a href="#" onclick="finalizarReserva('${reserva.id}'); return false;">Finalizar</a>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Negativo'); return false;">Marcar Negativo</a>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Anulado'); return false;">Anular Viaje</a>`;
        menuItems += `<a href="#" onclick="quitarAsignacion('${reserva.id}'); return false;">Quitar Móvil</a>`;
        menuItems += `<select onchange="asignarChofer('${reserva.id}', this.value)"><option value="">Reasignar...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select>`;
    }
    const accionesHTML = `
        <td class="acciones">
            <div class="acciones-dropdown">
                <button class="icono-tres-puntos" onclick="toggleMenu(event)">⋮</button>
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
        <td>${cliente.nombre}</td>
        <td>${reserva.estado || 'Pendiente'}</td>
        ${accionesHTML}
    `;
    const pickupCell = row.querySelector('.pickup-cell');
    const zonaCell = row.querySelector('.zona-cell');
    if (isEditable) {
        pickupCell.innerHTML = `<input type="time" value="${reserva.hora_pickup || ''}" onchange="updateHoraPickup(event, '${reserva.id}', '${reserva.hora_turno}')">`;
        let zonaSelectHTML = `<select onchange="updateZona(event, '${reserva.id}')"><option value="">Seleccionar...</option>`;
        zonasCache.forEach(zona => {
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

async function buscarEnReservas(texto) {
    const resultadosContainer = document.getElementById('resultados-busqueda-reservas');
    const resultadosTbody = document.querySelector('#tabla-resultados-busqueda tbody');
    const subNav = document.querySelector('.sub-nav');
    const containersOriginales = document.querySelectorAll('.reservas-container');
    if (!texto) {
        resultadosContainer.style.display = 'none';
        subNav.style.display = 'flex';
        containersOriginales.forEach(c => {
            const isActive = document.querySelector(`.sub-tab-btn[data-tab="${c.id.replace('reservas-','')}"].active`);
            c.style.display = isActive ? 'block' : 'none';
        });
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
            reserva.id = reserva.objectID;
            renderFilaReserva(resultadosTbody, reserva);
        });
    } catch (error) {
        console.error("Error buscando reservas en Algolia: ", error);
        resultadosTbody.innerHTML = '<tr><td colspan="13">Error al realizar la búsqueda.</td></tr>';
    }
}

// ===================================================================================
// LÓGICA PRINCIPAL Y DE UTILIDADES
// ===================================================================================

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
        if (unsubscribeReservas) unsubscribeReservas();
        adminListeners.forEach(unsubscribe => unsubscribe());
        adminListeners = [];
        if (refrescoAutomaticoIntervalo) clearInterval(refrescoAutomaticoIntervalo);
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => alert("Error de autenticación: " + error.message));
});

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

function initApp() {
    if (!geocoder) geocoder = new google.maps.Geocoder();
    loadAuxData();
    attachEventListeners();
    listenToReservas();
    initializeAdminLists();
    initMap(); 
    
    // Inicialización del menú contextual
    mapContextMenu = document.getElementById('map-context-menu');
    mapContextMenuItems = document.getElementById('map-context-menu-items');

    // Listener para ocultar el menú al hacer clic en el mapa
    if (map) {
        map.addListener('click', hideMapContextMenu);
    }
    
    if (refrescoAutomaticoIntervalo) clearInterval(refrescoAutomaticoIntervalo);
    refrescoAutomaticoIntervalo = setInterval(() => {
        if (lastReservasSnapshot) {
            renderAllReservas(lastReservasSnapshot);
        }
    }, 60000);

    openTab(null, 'Reservas');
    showReservasTab('en-curso');
}

function loadAuxData() {
    db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
        const clienteSelect = document.getElementById('cliente');
        clienteSelect.innerHTML = '<option value="Default">Default</option>';
        clientesCache = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            clientesCache[doc.id] = data;
            clienteSelect.innerHTML += `<option value="${doc.id}">${data.nombre}</option>`;
        });
    });

    db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
        choferesCache = [];
        snapshot.forEach(doc => choferesCache.push({ id: doc.id, ...doc.data() }));
        if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
    });

    db.collection('zonas').orderBy('numero').onSnapshot(snapshot => {
        const zonaSelect = document.getElementById('zona');
        zonaSelect.innerHTML = '<option value="">Seleccionar Zona...</option>';
        zonasCache = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            zonasCache.push({ id: doc.id, ...data });
            zonaSelect.innerHTML += `<option value="${data.descripcion}">${data.numero} - ${data.descripcion}</option>`;
        });
        if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
    });

    db.collection('moviles').orderBy('numero').onSnapshot(snapshot => {
        movilesCache = [];
        const movilSelect = document.querySelector("#form-choferes select[name='movil_actual_id']");
        
        if (movilSelect) {
            movilSelect.innerHTML = '<option value="">Asignar Móvil...</option>';
            snapshot.forEach(doc => {
                const movil = { id: doc.id, ...doc.data() };
                movilesCache.push(movil);
                movilSelect.innerHTML += `<option value="${movil.id}">N° ${movil.numero} (${movil.patente})</option>`;
            });
        } else {
            console.error("No se encontró el <select> de móviles en el formulario de choferes.");
        }
    });
}

async function openEditReservaModal(reservaId) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    const data = doc.data();
    const form = document.getElementById('reserva-form');
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
    document.getElementById('reserva-id').value = reservaId;
    document.getElementById('modal-title').textContent = 'Editar Reserva';
    document.getElementById('reserva-modal').style.display = 'block';
    setTimeout(() => initMapaModal(data.origen_coords, data.destino_coords), 100);
}

async function changeReservaState(reservaId, newState) {
    const finalStates = ['Anulado', 'Negativo'];
    if (finalStates.includes(newState)) {
        if (confirm(`¿Estás seguro de que quieres marcar esta reserva como "${newState}"?`)) {
            await moverReservaAHistorico(reservaId, newState);
        }
    } else {
        try {
            await db.collection('reservas').doc(reservaId).update({ estado: newState });
        } catch (error) {
            console.error(`Error al cambiar estado a ${newState}:`, error);
            alert("Hubo un error al actualizar la reserva.");
        }
    }
}

async function updateHoraPickup(event, reservaId, horaTurno) {
    const nuevaHora = event.target.value;
    if (horaTurno && nuevaHora) {
        const horaTurnoDT = new Date(`1970-01-01T${horaTurno}`);
        const nuevaHoraDT = new Date(`1970-01-01T${nuevaHora}`);
        const limiteMs = horaTurnoDT.getTime() - (30 * 60 * 1000);
        if (nuevaHoraDT.getTime() > limiteMs) {
            alert("La Hora de Pickup debe ser al menos 30 minutos antes de la Hora del Turno.");
            const doc = await db.collection('reservas').doc(reservaId).get();
            event.target.value = doc.data().hora_pickup || '';
            return;
        }
    }
    try { await db.collection('reservas').doc(reservaId).update({ hora_pickup: nuevaHora }); } catch (error) { console.error("Error:", error); }
}

async function updateZona(event, reservaId) {
    const nuevaZona = event.target.value;
    try { await db.collection('reservas').doc(reservaId).update({ zona: nuevaZona }); } catch (error) { console.error("Error:", error); }
}

async function asignarChofer(reservaId, choferId) {
    if (!choferId) return;
    await db.collection('reservas').doc(reservaId).update({ chofer_asignado_id: choferId, estado: 'Asignado' }).catch(err => alert("Error: " + err.message));
}

async function finalizarReserva(reservaId) {
    if (confirm("¿Marcar esta reserva como finalizada?")) {
        await moverReservaAHistorico(reservaId, 'Finalizado');
    }
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

window.onclick = function(event) {
    if (!event.target.closest('.acciones-dropdown')) {
        document.querySelectorAll('.menu-contenido.visible').forEach(menu => {
            menu.classList.remove('visible');
        });
    }
}

async function quitarAsignacion(reservaId) {
     if (confirm("¿Estás seguro de que quieres quitar la asignación de este móvil y devolver la reserva a 'En Curso'?")) {
        try {
            const reservaRef = db.collection('reservas').doc(reservaId);
            await reservaRef.update({
                estado: 'En Curso',
                chofer_asignado_id: firebase.firestore.FieldValue.delete()
            });
            console.log(`Reserva ${reservaId} devuelta a 'En Curso'.`);
        } catch (error) {
            console.error("Error al quitar asignación:", error);
            alert("Hubo un error al actualizar la reserva.");
        }
    }
}

async function moverReservaAHistorico(reservaId, estadoFinal) {
    const reservaRef = db.collection('reservas').doc(reservaId);
    const historicoRef = db.collection('historico').doc(reservaId);
    try {
        const doc = await reservaRef.get();
        if (!doc.exists) {
            console.error("No se encontró la reserva para archivar.");
            return;
        }
        const reservaData = doc.data();
        reservaData.estado = estadoFinal;
        reservaData.archivadoEn = firebase.firestore.FieldValue.serverTimestamp();
        if (clientesCache[reservaData.cliente]) {
            reservaData.clienteNombre = clientesCache[reservaData.cliente].nombre;
        } else {
            reservaData.clienteNombre = 'Default';
        }
        await db.runTransaction(async (transaction) => {
            transaction.set(historicoRef, reservaData);
            transaction.delete(reservaRef);
        });
    } catch (error) {
        console.error("Error al mover reserva a histórico:", error);
        alert("Error al archivar la reserva.");
    }
}

function attachEventListeners() {
    const safeAddEventListener = (id, event, handler) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.error(`Error de inicialización: No se encontró el elemento con ID: #${id}`);
        }
    };
    const modal = document.getElementById('reserva-modal');
    const closeBtn = document.querySelector('.close-btn');
    if (modal && closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }
    const editModal = document.getElementById('edit-modal');
    const closeEditBtn = document.querySelector('.close-edit-btn');
    if (editModal && closeEditBtn) {
        closeEditBtn.onclick = () => editModal.style.display = 'none';
    }
    safeAddEventListener('btn-nueva-reserva', 'click', () => {
        document.getElementById('reserva-form').reset();
        document.getElementById('modal-title').textContent = 'Nueva Reserva';
        document.getElementById('reserva-id').value = '';
        if (modal) modal.style.display = 'block';
        setTimeout(() => initMapaModal(null, null), 100);
    });
    safeAddEventListener('edit-form', 'submit', handleUpdateItem);
    safeAddEventListener('reserva-form', 'submit', handleSaveReserva);
    safeAddEventListener('form-clientes', 'submit', handleSaveCliente);
    safeAddEventListener('form-pasajeros', 'submit', handleSavePasajero);
    safeAddEventListener('form-choferes', 'submit', handleSaveChofer);
    safeAddEventListener('form-moviles', 'submit', handleSaveMovil);
    safeAddEventListener('form-usuarios', 'submit', handleSaveUsuario);
    safeAddEventListener('form-zonas', 'submit', handleSaveZona);
    safeAddEventListener('dni_pasajero', 'blur', handleDniBlur);
}

async function handleSaveReserva(e) {
    e.preventDefault();
    const form = e.target;
    const reservaId = form['reserva-id'].value;
    const reservaData = {
        cliente: form.cliente.value,
        siniestro: form.siniestro.value,
        autorizacion: form.autorizacion.value,
        dni_pasajero: form.dni_pasajero.value.trim(),
        nombre_pasajero: form.nombre_pasajero.value,
        telefono_pasajero: form.telefono_pasajero.value,
        fecha_turno: form.fecha_turno.value,
        hora_turno: form.hora_turno.value,
        hora_pickup: form.hora_pickup.value,
        origen: form.origen.value,
        destino: form.destino.value,
        cantidad_pasajeros: form.cantidad_pasajeros.value,
        zona: form.zona.value,
        observaciones: form.observaciones.value
    };
    if (!reservaId) {
        reservaData.estado = 'Pendiente';
        reservaData.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
    }
    try {
        if (reservaId) { await db.collection('reservas').doc(reservaId).update(reservaData); } else { await db.collection('reservas').add(reservaData); }
        if (reservaData.dni_pasajero && reservaData.origen) {
            const pasajeroRef = db.collection('pasajeros').doc(reservaData.dni_pasajero);
            const pasajeroData = {
                nombre_apellido: reservaData.nombre_pasajero,
                telefono: reservaData.telefono_pasajero,
                domicilios: firebase.firestore.FieldValue.arrayUnion(reservaData.origen)
            };
            await pasajeroRef.set(pasajeroData, { merge: true });
        }
        document.getElementById('reserva-modal').style.display = 'none';
    } catch (error) { alert("Error al guardar reserva: " + error.message); }
}

async function handleSaveCliente(e) { e.preventDefault(); const form = e.target; const clienteData = { nombre: form.nombre.value, cuit: form.cuit.value, domicilio: form.domicilio.value, telefono: form.telefono.value, color: form.color.value, creadoEn: firebase.firestore.FieldValue.serverTimestamp() }; if (!clienteData.nombre) { alert("El nombre es obligatorio."); return; } try { await db.collection('clientes').add(clienteData); alert("Cliente guardado."); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }
async function handleSavePasajero(e) { e.preventDefault(); const form = e.target; const dni = form.dni.value.trim(); if (!dni) { alert("El DNI es obligatorio."); return; } const pasajeroData = { nombre_apellido: form.nombre_apellido.value, telefono: form.telefono.value, domicilios: firebase.firestore.FieldValue.arrayUnion(form.domicilio.value) }; try { const pasajeroRef = db.collection('pasajeros').doc(dni); await pasajeroRef.set(pasajeroData, { merge: true }); alert("Pasajero guardado."); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }
async function handleSaveChofer(e) { e.preventDefault(); const form = e.target; const choferData = { dni: form.dni.value, nombre: form.nombre.value, domicilio: form.domicilio.value, telefono: form.telefono.value, movil_actual_id: form.movil_actual_id.value || null }; if (!choferData.dni) { alert("El DNI es obligatorio."); return; } try { await db.collection('choferes').add(choferData); alert("Chofer guardado."); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }
async function handleSaveMovil(e) { e.preventDefault(); const form = e.target; const movilData = { numero: form.numero.value, patente: form.patente.value, marca: form.marca.value, modelo: form.modelo.value, capacidad_pasajeros: form.capacidad_pasajeros.value, titular_nombre: form.titular_nombre.value, titular_domicilio: form.titular_domicilio.value, titular_telefono: form.titular_telefono.value }; if (!movilData.numero || !movilData.patente) { alert("N° de móvil y patente son obligatorios."); return; } try { await db.collection('moviles').add(movilData); alert("Móvil guardado."); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }
async function handleSaveUsuario(e) { e.preventDefault(); const form = e.target; const nombre = form.nombre.value, email = form.email.value, password = form.password.value; if (!email || !password || !nombre) { alert("Todos los campos son obligatorios."); return; } try { const crearUsuarioCloudFunction = functions.httpsCallable('crearUsuario'); const result = await crearUsuarioCloudFunction({ nombre, email, password }); alert(result.data.result); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }
async function handleSaveZona(e) { e.preventDefault(); const form = e.target; const zonaData = { numero: form.numero.value, descripcion: form.descripcion.value }; if (!zonaData.numero || !zonaData.descripcion) { alert("Número y descripción son obligatorios."); return; } try { await db.collection('zonas').add(zonaData); alert("Zona guardada."); form.reset(); } catch (error) { console.error("Error:", error); alert("Error: " + error.message); } }

async function handleDniBlur(e) {
    const dni = e.target.value.trim();
    if (!dni) return;
    try {
        const pasajeroDoc = await db.collection('pasajeros').doc(dni).get();
        if (pasajeroDoc.exists) {
            const pasajero = pasajeroDoc.data();
            const form = document.getElementById('reserva-form');
            form.nombre_pasajero.value = pasajero.nombre_apellido || '';
            form.telefono_pasajero.value = pasajero.telefono || '';
            if (pasajero.domicilios && pasajero.domicilios.length > 0) {
                form.origen.value = pasajero.domicilios[pasajero.domicilios.length - 1];
            }
        }
    } catch (error) { console.error("Error al buscar pasajero por DNI:", error); }
}

function initializeAdminLists() {
    renderAdminList('clientes', 'lista-clientes', ['nombre', 'cuit', 'telefono', 'domicilio'], ['Nombre', 'CUIT', 'Teléfono', 'Domicilio']);
    renderAdminList('choferes', 'lista-choferes', ['dni', 'nombre', 'telefono', 'domicilio'], ['DNI', 'Nombre', 'Teléfono', 'Domicilio']);
    renderAdminList('moviles', 'lista-moviles', ['numero', 'patente', 'marca', 'modelo', 'capacidad_pasajeros'], ['N° Móvil', 'Patente', 'Marca', 'Modelo', 'Capacidad']);
    renderAdminList('zonas', 'lista-zonas', ['numero', 'descripcion'], ['Número', 'Descripción']);
    renderUsersList();
}

async function renderUsersList() {
    const container = document.getElementById('lista-usuarios');
    if (!container) return;
    try {
        const listUsersCloudFunction = functions.httpsCallable('listUsers');
        const result = await listUsersCloudFunction();
        const users = result.data.users;
        if (!users || users.length === 0) { container.innerHTML = '<p>No hay usuarios para mostrar.</p>'; return; }
        let tableHTML = `<div class="table-wrapper"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Acciones</th></tr></thead><tbody>`;
        const userRolesPromises = users.map(user => db.collection('users').doc(user.uid).get());
        const userRolesSnapshots = await Promise.all(userRolesPromises);
        const userRoles = {};
        userRolesSnapshots.forEach(doc => { if (doc.exists) { userRoles[doc.id] = doc.data().rol || 'operador'; } });
        users.forEach(user => {
            tableHTML += `<tr><td>${user.nombre || '-'}</td><td>${user.email || '-'}</td><td>${userRoles[user.uid] || 'N/A'}</td><td class="acciones"><button onclick="editItem('users', '${user.uid}')">Editar</button><button class="btn-danger" onclick="deleteItem('users', '${user.uid}')">Borrar</button></td></tr>`;
        });
        tableHTML += `</tbody></table></div>`;
        container.innerHTML = tableHTML;
    } catch (error) { console.error("Error al llamar a la Cloud Function 'listUsers':", error); container.innerHTML = `<p style="color:red;">Error al cargar la lista de usuarios.</p>`; }
}

function renderAdminList(collectionName, containerId, fields, headers, useDocIdAsField = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const orderByField = useDocIdAsField ? firebase.firestore.FieldPath.documentId() : fields[0];
    const unsubscribe = db.collection(collectionName).onSnapshot(snapshot => {
        if (snapshot.empty) { container.innerHTML = '<p>No hay datos para mostrar.</p>'; return; }
        let tableHTML = `<div class="table-wrapper"><table><thead><tr>`;
        if (useDocIdAsField) headers.unshift("DNI");
        headers.forEach(header => tableHTML += `<th>${header}</th>`);
        tableHTML += `<th>Acciones</th></tr></thead><tbody>`;
        snapshot.forEach(doc => {
            const item = doc.data();
            tableHTML += `<tr>`;
            if (useDocIdAsField) tableHTML += `<td>${doc.id}</td>`;
            fields.forEach(field => {
                const value = item[field];
                const displayValue = Array.isArray(value) ? value.join(', ') : (value || '-');
                tableHTML += `<td>${displayValue}</td>`;
            });
            tableHTML += `<td class="acciones"><button onclick="editItem('${collectionName}', '${doc.id}')">Editar</button><button class="btn-danger" onclick="deleteItem('${collectionName}', '${doc.id}')">Borrar</button></td></tr>`;
        });
        tableHTML += `</tbody></table></div>`;
        container.innerHTML = tableHTML;
    }, err => console.error(`Error cargando ${collectionName}:`, err));
    adminListeners.push(unsubscribe);
}

async function editItem(collection, id) {
    let doc;
    if (collection === 'users') {
        const userDoc = await db.collection('users').doc(id).get();
        if (!userDoc.exists) { alert("Error: No se encontró el usuario en Firestore."); return; }
        doc = { id: id, exists: true, data: () => ({ ...userDoc.data(), uid: id }) };
    } else {
        doc = await db.collection(collection).doc(id).get();
    }
    if (!doc.exists) { alert("Error: No se encontró el item."); return; }
    const data = doc.data();
    const form = document.getElementById('edit-form');
    form.innerHTML = '';
    form.dataset.collection = collection;
    form.dataset.id = id;
    const fieldsToEdit = Object.keys(data);
    fieldsToEdit.forEach(field => {
        const label = document.createElement('label');
        label.textContent = field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
        form.appendChild(label);
        if (field === 'movil_actual_id' && collection === 'choferes') {
            const select = document.createElement('select');
            select.name = field;
            let optionsHTML = '<option value="">Desasignar Móvil</option>';
            movilesCache.forEach(movil => {
                const selected = movil.id === data[field] ? 'selected' : '';
                optionsHTML += `<option value="${movil.id}" ${selected}>N° ${movil.numero} (${movil.patente})</option>`;
            });
            select.innerHTML = optionsHTML;
            form.appendChild(select);
        } else if (field === 'color' && data.color !== undefined) {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.name = field;
            colorInput.value = data[field];
            form.appendChild(colorInput);
        } else {
            const input = document.createElement('input');
            input.name = field;
            input.value = data[field];
            if (field === 'uid' || field === 'email' || field === 'creadoEn') {
                input.disabled = true;
            }
            form.appendChild(input);
        }
    });
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Guardar Cambios';
    form.appendChild(submitBtn);
    document.getElementById('edit-modal-title').textContent = `Editar ${collection.slice(0, -1)}`;
    document.getElementById('edit-modal').style.display = 'block';
}

async function handleUpdateItem(e) {
    e.preventDefault();
    const form = e.target;
    const collection = form.dataset.collection;
    const id = form.dataset.id;
    const updatedData = {};
    const formData = new FormData(form);
    for (let [key, value] of formData.entries()) {
        if (form.querySelector(`[name="${key}"]`) && form.querySelector(`[name="${key}"]`).disabled) continue;
        updatedData[key] = value;
    }
    try {
        await db.collection(collection).doc(id).update(updatedData);
        alert("Item actualizado con éxito.");
        document.getElementById('edit-modal').style.display = 'none';
    } catch (error) { console.error("Error al actualizar:", error); alert("Error al guardar los cambios."); }
}

async function deleteItem(collection, id) {
    const docName = collection.slice(0, -1);
    if (confirm(`¿Estás seguro de que quieres borrar este ${docName}?`)) {
        try {
            if (collection === 'users') {
                alert("La funcionalidad para borrar usuarios debe implementarse con una Cloud Function por seguridad.");
                return;
            }
            await db.collection(collection).doc(id).delete();
            alert(`${docName.charAt(0).toUpperCase() + docName.slice(1)} borrado con éxito.`);
            if (collection === 'pasajeros') {
                cargarPasajeros();
            }
        } catch (error) {
            console.error(`Error al borrar ${docName}:`, error);
            alert(`Error al borrar: ${error.message}`);
        }
    }
}

function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none");
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
    document.getElementById(tabName).style.display = "block";
    if (evt) evt.currentTarget.classList.add('active');
    if (tabName === 'Mapa' && !map) {
        initMap();
    }
    if (tabName === 'Historico') {
        paginaActual = 0;
        historialDePaginas = [null];
        cargarHistorial();
    }
    if (tabName === 'Pasajeros' && !document.getElementById('lista-pasajeros').hasChildNodes()) {
        pasajerosPaginaActual = 0;
        pasajerosHistorialDePaginas = [null];
        cargarPasajeros();
    }
}

function showReservasTab(tabName) {
    document.querySelectorAll('.reservas-container').forEach(c => c.style.display = 'none');
    document.getElementById(`reservas-${tabName}`).style.display = 'block';
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.sub-tab-btn[data-tab="${tabName}"]`).classList.add('active');
}

function initAutocomplete() {
    const origenInput = document.getElementById('origen');
    const destinoInput = document.getElementById('destino');
    const options = { componentRestrictions: { country: "ar" }, fields: ["formatted_address", "geometry", "name"] };
    autocompleteOrigen = new google.maps.places.Autocomplete(origenInput, options);
    autocompleteDestino = new google.maps.places.Autocomplete(destinoInput, options);
    autocompleteOrigen.addListener('place_changed', () => {
        const place = autocompleteOrigen.getPlace();
        if (place.geometry && place.geometry.location) {
            if (mapaModal && marcadorOrigenModal) {
                mapaModal.setCenter(place.geometry.location);
                marcadorOrigenModal.setPosition(place.geometry.location);
                mapaModal.setZoom(15);
            }
        }
    });
    autocompleteDestino.addListener('place_changed', () => {
        const place = autocompleteDestino.getPlace();
        if (place.geometry && place.geometry.location) {
            if (mapaModal && marcadorDestinoModal) {
                mapaModal.setCenter(place.geometry.location);
                marcadorDestinoModal.setPosition(place.geometry.location);
                mapaModal.setZoom(15);
            }
        }
    });
}
/**
 * Crea un icono de marcador SVG personalizado.
 * @param {string} color - El color de fondo del marcador (ej. '#FF0000').
 * @param {string} texto - El texto que se mostrará dentro del marcador (ej. '4' o '10:30').
 * @returns {object} - Un objeto de icono para la API de Google Maps.
 */
function crearIconoDeMarcador(color, texto) {
    const svg = `
        <svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 48C18 48 36 33.375 36 18C36 8.05887 27.9411 0 18 0C8.05887 0 0 8.05887 0 18C0 33.375 18 48 18 48Z" fill="${color}"/>
            <text x="18" y="21" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">${texto}</text>
        </svg>
    `;

    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(36, 48),
        anchor: new google.maps.Point(18, 48) // La punta del marcador
    };
}
function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshot) return;

    Object.values(marcadoresOrigen).forEach(marker => marker.setMap(null));
    marcadoresOrigen = {};

    const ahora = new Date();
    const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

    lastReservasSnapshot.forEach(doc => {
        const reserva = { id: doc.id, ...doc.data() };
        
        let estadoEfectivo = reserva.estado;
        const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;

        if (!reserva.chofer_asignado_id && reserva.estado === 'Pendiente') {
            if (fechaTurno && fechaTurno <= limite24hs) {
                estadoEfectivo = 'En Curso';
            }
        }
        
        const estadosActivos = ['En Curso', 'Asignado', 'Pendiente'];
        if (!estadosActivos.includes(estadoEfectivo)) return;
        if (filtroMapaActual !== 'Todos' && estadoEfectivo !== filtroMapaActual) return;

        if (reserva.origen_coords && reserva.origen_coords.latitude) {
            
            let colorMarcador, textoMarcador = '';

            switch (estadoEfectivo) {
                case 'En Curso':
                    colorMarcador = '#F54927';
                    const hora = reserva.hora_pickup || reserva.hora_turno;
                    if (hora) { textoMarcador = hora.substring(0, 5); }
                    break;
                case 'Asignado':
                    colorMarcador = '#4DF527';
                    const chofer = choferesCache.find(c => c.id === reserva.chofer_asignado_id);
                    if (chofer && chofer.movil_actual_id) {
                        const movil = movilesCache.find(m => m.id === chofer.movil_actual_id);
                        if (movil && movil.numero) { textoMarcador = movil.numero.toString(); }
                    }
                    break;
                case 'Pendiente':
                    colorMarcador = '#C456F0';
                    break;
            }

            const iconoPersonalizado = crearIconoDeMarcador(colorMarcador, textoMarcador);

            const marker = new google.maps.Marker({
                position: { lat: reserva.origen_coords.latitude, lng: reserva.origen_coords.longitude },
                map: map,
                title: `Origen: ${reserva.origen} (${estadoEfectivo})`,
                icon: iconoPersonalizado
            });
            marcadoresOrigen[reserva.id] = marker;

            marker.addListener('click', () => {
                if (infoWindowActiva) infoWindowActiva.close();
                if (marcadorDestinoActivo) marcadorDestinoActivo.setMap(null);

                const cliente = clientesCache[reserva.cliente] || { nombre: 'N/A' };
                const choferInfo = choferesCache.find(c => c.id === reserva.chofer_asignado_id) || { nombre: 'No asignado' };
                const contenido = `<div class="info-window"><h4>Reserva de: ${cliente.nombre}</h4><p><strong>Pasajero:</strong> ${reserva.nombre_pasajero || 'N/A'}</p><p><strong>Origen:</strong> ${reserva.origen}</p><p><strong>Destino:</strong> ${reserva.destino}</p><p><strong>Turno:</strong> ${new Date(reserva.fecha_turno + 'T' + (reserva.hora_turno || '00:00')).toLocaleString('es-AR')}</p><p><strong>Chofer:</strong> ${choferInfo.nombre}</p></div>`;
                
                infoWindowActiva = new google.maps.InfoWindow({ content: contenido });
                infoWindowActiva.open(map, marker);

                if (reserva.destino_coords && reserva.destino_coords.latitude) {
                    const iconoDestino = crearIconoDeMarcador('#27DAF5', '');
                    marcadorDestinoActivo = new google.maps.Marker({
                        position: { lat: reserva.destino_coords.latitude, lng: reserva.destino_coords.longitude },
                        map: map,
                        title: `Destino: ${reserva.destino}`,
                        icon: iconoDestino
                    });
                }

                infoWindowActiva.addListener('closeclick', () => {
                    if (marcadorDestinoActivo) {
                        marcadorDestinoActivo.setMap(null);
                        marcadorDestinoActivo = null;
                    }
                });
            });
            
            marker.addListener('rightclick', (event) => {
                event.domEvent.preventDefault();
                hideMapContextMenu();

                let menuHTML = '';
                const reservaId = reserva.id;

                if (estadoEfectivo === 'En Curso' || estadoEfectivo === 'Pendiente') {
                    menuHTML = `
                        <li><a onclick="openEditReservaModal('${reservaId}'); hideMapContextMenu()">Editar</a></li>
                        <li><select onchange="asignarChofer('${reservaId}', this.value); hideMapContextMenu()"><option value="">Asignar Chofer...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select></li>
                        <li><a onclick="changeReservaState('${reservaId}', 'Anulado'); hideMapContextMenu()">Anular</a></li>
                    `;
                } else if (estadoEfectivo === 'Asignado') {
                    menuHTML = `
                        <li><a onclick="openEditReservaModal('${reservaId}'); hideMapContextMenu()">Editar</a></li>
                        <li><a onclick="finalizarReserva('${reservaId}'); hideMapContextMenu()">Finalizar</a></li>
                        <li><a onclick="changeReservaState('${reservaId}', 'Negativo'); hideMapContextMenu()">Marcar Negativo</a></li>
                        <li><a onclick="quitarAsignacion('${reservaId}'); hideMapContextMenu()">Quitar Móvil</a></li>
                        <li><a onclick="changeReservaState('${reservaId}', 'Anulado'); hideMapContextMenu()">Anular Viaje</a></li>
                        <li><select onchange="asignarChofer('${reservaId}', this.value); hideMapContextMenu()"><option value="">Reasignar...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select></li>
                    `;
                }

                if (menuHTML) {
                    mapContextMenuItems.innerHTML = menuHTML;
                    mapContextMenu.style.left = `${event.domEvent.clientX}px`;
                    mapContextMenu.style.top = `${event.domEvent.clientY}px`;
                    mapContextMenu.style.display = 'block';
                }
            });
        }
    });
}
function filtrarMapa(estado) {
    filtroMapaActual = estado;
    document.querySelectorAll('.map-filter-btn').forEach(btn => btn.classList.remove('active'));
    const botonActivo = Array.from(document.querySelectorAll('.map-filter-btn')).find(btn => btn.textContent.includes(estado));
    if (botonActivo) botonActivo.classList.add('active');
    cargarMarcadoresDeReservas();
}

function initMapaModal(origenCoords, destinoCoords) {
    const mapaContainer = document.getElementById("mapa-modal-container");
    if (!mapaContainer) return;
    if (!mapaModal) {
        mapaModal = new google.maps.Map(mapaContainer, {
            center: { lat: -32.95, lng: -60.65 },
            zoom: 13
        });
        initAutocomplete();
    }
    if (marcadorOrigenModal) marcadorOrigenModal.setMap(null);
    if (marcadorDestinoModal) marcadorDestinoModal.setMap(null);
    const centroPorDefecto = { lat: -32.95, lng: -60.65 };
    const posOrigen = (origenCoords && origenCoords.latitude) ?
        { lat: origenCoords.latitude, lng: origenCoords.longitude } :
        centroPorDefecto;
    marcadorOrigenModal = new google.maps.Marker({
        position: posOrigen,
        map: mapaModal,
        draggable: true,
        icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
    });
    const posDestino = (destinoCoords && destinoCoords.latitude) ?
        { lat: destinoCoords.latitude, lng: destinoCoords.longitude } :
        centroPorDefecto;
    marcadorDestinoModal = new google.maps.Marker({
        position: posDestino,
        map: mapaModal,
        draggable: true,
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });
    if (origenCoords && destinoCoords) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(posOrigen);
        bounds.extend(posDestino);
        mapaModal.fitBounds(bounds);
    } else {
        mapaModal.setCenter(posOrigen);
    }
    marcadorOrigenModal.addListener('dragend', (event) => {
        actualizarInputDesdeCoordenadas(event.latLng, 'origen');
    });
    marcadorDestinoModal.addListener('dragend', (event) => {
        actualizarInputDesdeCoordenadas(event.latLng, 'destino');
    });
}

function actualizarInputDesdeCoordenadas(latLng, tipoInput) {
    if (!geocoder) { console.error("Geocoder no inicializado."); return; }
    geocoder.geocode({ 'location': latLng }, (results, status) => {
        if (status === 'OK') {
            if (results[0]) {
                document.getElementById(tipoInput).value = results[0].formatted_address;
            } else {
                window.alert('No se encontraron resultados para las coordenadas.');
            }
        } else {
            window.alert('El servicio de geocodificación falló debido a: ' + status);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Conexión para Búsqueda en Historial
    const searchInput = document.getElementById('search-historial-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            buscarEnHistorial(e.target.value);
        });
    }

    // Conexión para Búsqueda en Pasajeros
    const pasajerosSearchInput = document.getElementById('busqueda-pasajeros');
    if(pasajerosSearchInput) {
        pasajerosSearchInput.addEventListener('input', (e) => {
            buscarEnPasajeros(e.target.value);
        });
    }

    // Conexión para Búsqueda en Reservas
    const reservasSearchInput = document.getElementById('busqueda-reservas');
    if (reservasSearchInput) {
        reservasSearchInput.addEventListener('input', (e) => {
            buscarEnReservas(e.target.value);
        });
    }

    // Historial
    historialBody = document.getElementById('historial-body');
    btnAnterior = document.getElementById('btn-anterior');
    btnSiguiente = document.getElementById('btn-siguiente');
    indicadorPagina = document.getElementById('indicador-pagina');
    if (btnSiguiente) {
        btnSiguiente.addEventListener('click', () => {
            if (paginaActual === historialDePaginas.length - 1) {
                historialDePaginas.push(ultimoDocVisible);
            }
            paginaActual++;
            cargarHistorial();
        });
    }
    if (btnAnterior) {
        btnAnterior.addEventListener('click', () => {
            if (paginaActual > 0) {
                paginaActual--;
                cargarHistorial();
            }
        });
    }
    
    // Pasajeros
    pasajerosBody = document.getElementById('lista-pasajeros');
    pasajerosBtnAnterior = document.getElementById('pasajeros-btn-anterior');
    pasajerosBtnSiguiente = document.getElementById('pasajeros-btn-siguiente');
    pasajerosIndicadorPagina = document.getElementById('pasajeros-indicador-pagina');
    if (pasajerosBtnSiguiente) {
        pasajerosBtnSiguiente.addEventListener('click', () => {
            if (pasajerosPaginaActual === pasajerosHistorialDePaginas.length - 1) {
                pasajerosHistorialDePaginas.push(pasajerosUltimoDocVisible);
            }
            pasajerosPaginaActual++;
            cargarPasajeros();
        });
    }
    if (pasajerosBtnAnterior) {
        pasajerosBtnAnterior.addEventListener('click', () => {
            if (pasajerosPaginaActual > 0) {
                pasajerosPaginaActual--;
                cargarPasajeros();
            }
        });
    }
});

function initMap() {
    if (document.getElementById("map-container")) {
        map = new google.maps.Map(document.getElementById("map-container"), {
            center: { lat: -32.9566, lng: -60.6577 },
            zoom: 12
        });
    }
}