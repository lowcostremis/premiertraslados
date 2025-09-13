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
                <td>${viaje.estado?.principal || viaje.estado || 'N/A'}</td>
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
        const item = typeof doc.data === 'function' ? doc.data() : item;
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
let auxDataListeners = [];
let lastReservasSnapshot = null;
let mapaModal, marcadorOrigenModal, marcadorDestinoModal, geocoder;
let filtroMapaActual = 'Todos';
let refrescoAutomaticoIntervalo;
let marcadoresOrigen = {};
let marcadoresChoferes = {};
let marcadorDestinoActivo = null;
let infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;

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
        if (map) {
            cargarMarcadoresDeReservas();
        }
    }, err => console.error("Error escuchando reservas:", err));
}

function renderAllReservas(snapshot) {
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

     // --- INICIO DE LA LÓGICA DE ORDENAMIENTO CORREGIDA ---
    reservas.sort((a, b) => {
        const fechaA = a.fecha_turno || '9999-12-31';
        // Prioriza hora_pickup, si no existe usa hora_turno
        const horaA = (a.hora_pickup && a.hora_pickup.trim() !== '') ? a.hora_pickup : (a.hora_turno || '23:59');
        const dateTimeA = new Date(`${fechaA}T${horaA}`);

        const fechaB = b.fecha_turno || '9999-12-31';
        // Prioriza hora_pickup, si no existe usa hora_turno
        const horaB = (b.hora_pickup && b.hora_pickup.trim() !== '') ? b.hora_pickup : (b.hora_turno || '23:59');
        const dateTimeB = new Date(`${fechaB}T${horaB}`);

        return dateTimeA - dateTimeB; 
    });
    // --- FIN DE LA LÓGICA DE ORDENAMIENTO ---
   

    const ahora = new Date();
    const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

    reservas.forEach(reserva => {
        const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
        const estadoPrincipal = typeof reserva.estado === 'object' ? reserva.estado.principal : reserva.estado;

        let targetTableId = '';
        if (['Finalizado', 'Anulado', 'Negativo'].includes(estadoPrincipal) && reserva.estado?.detalle !== 'Traslado negativo') {
            // No hacer nada
        } else if (estadoPrincipal === 'Asignado' || estadoPrincipal === 'En Origen' || estadoPrincipal === 'Viaje Iniciado') {
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
    
    const estadoPrincipal = (typeof reserva.estado === 'object' && reserva.estado.principal) ? reserva.estado.principal : reserva.estado;
    const estadoDetalle = (typeof reserva.estado === 'object' && reserva.estado.detalle) ? reserva.estado.detalle : '---';

    if (reserva.es_exclusivo) {
        row.style.backgroundColor = '#51ED8D';
        row.style.color = '#333';
    } else if (estadoPrincipal === 'Negativo' || estadoDetalle === 'Traslado negativo') {
        row.style.backgroundColor = '#FFDE59'; // Amarillo para negativos
        row.style.color = '#333';
    } else if (estadoDetalle.startsWith('Rechazado por')) { // <-- NUEVO: Identificador visual para rechazados
        row.style.backgroundColor = '#f8d7da'; // Un rojo claro para destacar
        row.style.color = '#721c24';
    } else if (estadoPrincipal === 'Anulado') {
        row.className = 'estado-anulado';
    } else if (cliente.color) {
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
    
    let movilAsignadoTexto = '';
    if (reserva.movil_asignado_id) {
        const movilAsignado = movilesCache.find(m => m.id === reserva.movil_asignado_id);
        const choferAsignado = choferesCache.find(c => c.id === reserva.chofer_asignado_id);
        const textoMovil = movilAsignado ? `Móvil ${movilAsignado.numero}` : 'Móvil no encontrado';
        const textoChofer = choferAsignado ? ` (${choferAsignado.nombre})` : '';
        movilAsignadoTexto = textoMovil + textoChofer;
    }
    
    let detalleFinalHTML = `<strong>${estadoDetalle}</strong>`;
    if (movilAsignadoTexto) {
        detalleFinalHTML += `<br><small style="color: #ccc;">${movilAsignadoTexto}</small>`;
    }
    
    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const isAsignable = tbody.parentElement.id === 'tabla-en-curso' || tbody.parentElement.id === 'tabla-pendientes';
    const isAsignado = tbody.parentElement.id === 'tabla-asignados';
    
    let menuItems = `<a href="#" onclick="openEditReservaModal('${reserva.id || reserva.objectID}'); return false;">Editar</a>`;
    if (isAsignable) {
        let movilesOptions = movilesCache.map(movil => {
            const choferDelMovil = choferesCache.find(c => c.movil_actual_id === movil.id);
            const nombreChofer = choferDelMovil ? ` (${choferDelMovil.nombre})` : ' (Sin chofer)';
            return `<option value="${movil.id}">N° ${movil.numero}${nombreChofer}</option>`;
        }).join('');
        menuItems += `<select onchange="asignarMovil('${reserva.id}', this.value)"><option value="">Asignar Móvil...</option>${movilesOptions}</select>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Anulado'); return false;">Anular</a>`;
    } else if (isAsignado) {
        menuItems += `<a href="#" onclick="finalizarReserva('${reserva.id}'); return false;">Finalizar</a>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Negativo'); return false;">Marcar Negativo</a>`;
        menuItems += `<a href="#" onclick="changeReservaState('${reserva.id}', 'Anulado'); return false;">Anular Viaje</a>`;
        menuItems += `<a href="#" onclick="quitarAsignacion('${reserva.id}'); return false;">Quitar Móvil</a>`;
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
        <td><strong>${estadoPrincipal || 'Pendiente'}</strong></td>
        <td>${detalleFinalHTML}</td>
        ${accionesHTML}
    `;

    const pickupCell = row.querySelector('.pickup-cell');
    const zonaCell = row.querySelector('.zona-cell');
    if (isAsignable) {
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
        resultadosTbody.innerHTML = '<tr><td colspan="14">Buscando...</td></tr>';
        const { hits } = await reservasSearchIndex.search(texto);
        resultadosTbody.innerHTML = '';
        if (hits.length === 0) {
            resultadosTbody.innerHTML = '<tr><td colspan="14">No se encontraron reservas.</td></tr>';
            return;
        }
        hits.forEach(reserva => {
            reserva.id = reserva.objectID;
            renderFilaReserva(resultadosTbody, reserva);
        });
    } catch (error) {
        console.error("Error buscando reservas en Algolia: ", error);
        resultadosTbody.innerHTML = '<tr><td colspan="14">Error al realizar la búsqueda.</td></tr>';
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
        auxDataListeners.forEach(unsubscribe => unsubscribe());
        auxDataListeners = [];
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
    loadAuxData();
    attachEventListeners();
    listenToReservas();
    initializeAdminLists();
    mapContextMenu = document.getElementById('map-context-menu');
    mapContextMenuItems = document.getElementById('map-context-menu-items');
    
    const toggleChoferes = document.getElementById('toggle-choferes');
    if (toggleChoferes) {
        toggleChoferes.addEventListener('change', (e) => {
            toggleChoferesVisibility(e.target.checked);
        });
    }
    escucharUbicacionChoferes();

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
    auxDataListeners.forEach(unsubscribe => unsubscribe());
    auxDataListeners = [];

    const clientesUnsubscribe = db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
        const clienteSelect = document.getElementById('cliente');
        if (!clienteSelect) return;
        clienteSelect.innerHTML = '<option value="Default">Default</option>';
        clientesCache = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            clientesCache[doc.id] = data;
            clienteSelect.innerHTML += `<option value="${doc.id}">${data.nombre}</option>`;
        });
        setupExportControls();
    }, err => console.error("Error cargando clientes:", err));
    auxDataListeners.push(clientesUnsubscribe);

    const choferesUnsubscribe = db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
        choferesCache = [];
        snapshot.forEach(doc => choferesCache.push({ id: doc.id, ...doc.data() }));
        if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
        if (map) cargarMarcadoresDeReservas();
    }, err => console.error("Error cargando choferes:", err));
    auxDataListeners.push(choferesUnsubscribe);

    const zonasUnsubscribe = db.collection('zonas').orderBy('numero').onSnapshot(snapshot => {
        const zonaSelect = document.getElementById('zona');
        if (!zonaSelect) return;
        zonaSelect.innerHTML = '<option value="">Seleccionar Zona...</option>';
        zonasCache = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            zonasCache.push({ id: doc.id, ...data });
            zonaSelect.innerHTML += `<option value="${data.descripcion}">${data.numero} - ${data.descripcion}</option>`;
        });
        if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
    }, err => console.error("Error cargando zonas:", err));
    auxDataListeners.push(zonasUnsubscribe);

    const movilesUnsubscribe = db.collection('moviles').orderBy('numero').onSnapshot(snapshot => {
        movilesCache = [];
        const movilSelect = document.querySelector("#form-choferes select[name='movil_actual_id']");
        if (movilSelect) {
            movilSelect.innerHTML = '<option value="">Asignar Móvil...</option>';
            snapshot.forEach(doc => {
                const movil = { id: doc.id, ...doc.data() };
                movilesCache.push(movil);
                movilSelect.innerHTML += `<option value="${movil.id}">N° ${movil.numero} (${movil.patente})</option>`;
            });
        }
        if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
        if (map) cargarMarcadoresDeReservas();
    }, err => console.error("Error cargando moviles:", err));
    auxDataListeners.push(movilesUnsubscribe);
}

async function openEditReservaModal(reservaId) {
    const doc = await db.collection('reservas').doc(reservaId).get();
    if (!doc.exists) { alert("Error: No se encontró la reserva."); return; }
    const data = doc.data();
    const form = document.getElementById('reserva-form');
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
    if (data.es_exclusivo) {
        form.viaje_exclusivo.checked = true;
        form.cantidad_pasajeros.value = '4';
        form.cantidad_pasajeros.disabled = true;
    }
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
            const updateData = {
                estado: {
                    principal: newState,
                    detalle: `Estado cambiado a ${newState}`,
                    actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
                }
            };
            await db.collection('reservas').doc(reservaId).update(updateData);
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

async function asignarMovil(reservaId, movilId) {
    if (!movilId) return;
    try {
        const choferAsignado = choferesCache.find(c => c.movil_actual_id === movilId);
        if (!choferAsignado) {
            alert("Error: Este móvil no tiene un chofer vinculado actualmente.");
            if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot);
            return;
        }
        const updateData = {
            movil_asignado_id: movilId,
            chofer_asignado_id: choferAsignado.id,
            estado: {
                principal: 'Asignado',
                detalle: 'Enviada al chofer', // <-- CAMBIO DE ESTADO
                actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
            }
        };
        await db.collection('reservas').doc(reservaId).update(updateData);

        // --- LÓGICA AGREGADA PARA LA NOTIFICACIÓN ---
        const choferRef = db.collection('choferes').doc(choferAsignado.id);
        await choferRef.update({
            viajes_activos: firebase.firestore.FieldValue.arrayUnion(reservaId)
        });
        // --- FIN DE LA LÓGICA AGREGADA ---

    } catch (err) {
        console.error("Error al asignar móvil:", err);
        alert("Error al asignar el móvil: " + err.message);
    }
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
    if (mapContextMenu && !event.target.closest('#map-context-menu')) {
        hideMapContextMenu();
    }
};

async function quitarAsignacion(reservaId) {
      if (confirm("¿Estás seguro de que quieres quitar la asignación de este móvil y devolver la reserva a 'En Curso'?")) {
        try {
            const reservaRef = db.collection('reservas').doc(reservaId);
            const reservaDoc = await reservaRef.get();
            
            // Si la reserva no existe, no se puede hacer nada
            if (!reservaDoc.exists) {
                console.warn("La reserva ya no existe, no se puede quitar la asignación.");
                return;
            }

            const choferAsignadoId = reservaDoc.data().chofer_asignado_id;

            // LÓGICA DE ACTUALIZACIÓN - Solo si existe un chofer asignado
            const batch = db.batch();

            batch.update(reservaRef, {
                estado: {
                    principal: 'En Curso',
                    detalle: 'Móvil des-asignado por operador',
                    actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
                },
                chofer_asignado_id: firebase.firestore.FieldValue.delete(),
                movil_asignado_id: firebase.firestore.FieldValue.delete()
            });

            // Verificar si hay un chofer asignado antes de intentar actualizar su documento
            if (choferAsignadoId) {
                const choferRef = db.collection('choferes').doc(choferAsignadoId);
                const choferDoc = await choferRef.get();

                // Solo si el documento del chofer existe, lo actualizamos.
                if (choferDoc.exists) {
                     batch.update(choferRef, {
                        viajes_activos: firebase.firestore.FieldValue.arrayRemove(reservaId)
                    });
                } else {
                    console.warn(`El chofer con ID ${choferAsignadoId} no existe. No se puede actualizar su lista de viajes.`);
                }
            }

            await batch.commit();

            console.log("Asignación de reserva quitada exitosamente.");
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
        reservaData.estado = {
            principal: estadoFinal,
            detalle: `Viaje marcado como ${estadoFinal}`,
            actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
        };
        reservaData.archivadoEn = firebase.firestore.FieldValue.serverTimestamp();
        
        if (clientesCache[reservaData.cliente]) {
            reservaData.clienteNombre = clientesCache[reservaData.cliente].nombre;
        } else {
            reservaData.clienteNombre = 'Default';
        }

        // --- LÓGICA AGREGADA PARA LA NOTIFICACIÓN ---
        if (reservaData.chofer_asignado_id) {
            const choferRef = db.collection('choferes').doc(reservaData.chofer_asignado_id);
            await choferRef.update({
                viajes_activos: firebase.firestore.FieldValue.arrayRemove(reservaId)
            });
        }
        // --- FIN DE LA LÓGICA AGREGADA ---

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
    const safeAddEventListener = (id, event, handler) => { const element = document.getElementById(id); if (element) { element.addEventListener(event, handler); } else { console.error(`Elemento no encontrado: #${id}`); } };
    
    const modal = document.getElementById('reserva-modal');
    const closeBtn = document.querySelector('.close-btn');
    if (modal && closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    const editModal = document.getElementById('edit-modal');
    const closeEditBtn = document.querySelector('.close-edit-btn');
    if (editModal && closeEditBtn) closeEditBtn.onclick = () => editModal.style.display = 'none';
    
    const resetModal = document.getElementById('reset-password-modal');
    const closeResetBtn = document.querySelector('.close-reset-password-btn');
    if(resetModal && closeResetBtn) closeResetBtn.onclick = () => resetModal.style.display = 'none';

    safeAddEventListener('btn-nueva-reserva', 'click', () => { 
        document.getElementById('reserva-form').reset(); 
        document.getElementById('viaje_exclusivo').checked = false; 
        const p = document.getElementById('cantidad_pasajeros'); p.value = '1'; p.disabled = false; 
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
    safeAddEventListener('reset-password-form', 'submit', handleResetPassword);
    
    setupExclusiveCheckboxListener();
}

function setupExclusiveCheckboxListener() { 
    const e = document.getElementById('viaje_exclusivo');
    const p = document.getElementById('cantidad_pasajeros'); 
    if (e && p) { 
        e.addEventListener('change', (evt) => { 
            if (evt.target.checked) { 
                p.value = '4'; 
                p.disabled = true; 
            } else { 
                p.disabled = false; 
                p.value = '1'; 
            } 
        });
    } 
}

function setupExportControls() { 
    const b = document.getElementById('btn-exportar-excel'); 
    const s = document.getElementById('export-cliente');
    if (s) { 
        s.innerHTML = '<option value="">Todos los Clientes</option>'; 
        for (const id in clientesCache) { 
            s.innerHTML += `<option value="${id}">${clientesCache[id].nombre}</option>`;
        } 
    } 
    if (b) { 
        b.addEventListener('click', async () => { 
            const fD = document.getElementById('export-fecha-desde').value; 
            const fH = document.getElementById('export-fecha-hasta').value; 
            const cId = document.getElementById('export-cliente').value; 
            if (!fD || !fH) { 
                alert("Selecciona un rango de fechas."); 
                return; 
            } 
            b.textContent = "Generando..."; 
            b.disabled = true; 
            try { 
                const exp = functions.httpsCallable('exportarHistorico'); 
                const res = await exp({ fechaDesde: fD, fechaHasta: fH, clienteId: cId }); 
                if (res.data.csvData) { 
                    const blob = new Blob(["\ufeff" + res.data.csvData], { type: 'text/csv;charset=utf-8;' }); 
                    const link = document.createElement("a"); 
                    const url = URL.createObjectURL(blob); 
                    link.setAttribute("href", url); 
                    link.setAttribute("download", `historico_${fD}_a_${fH}.csv`); 
                    document.body.appendChild(link); 
                    link.click(); 
                    document.body.removeChild(link); 
                } else { 
                    alert(res.data.message || "No se encontraron datos."); 
                } 
            } catch (error) { 
                console.error("Error al exportar:", error); 
                alert("Error al generar el archivo."); 
            } finally { 
                b.textContent = "Exportar a Excel";
                b.disabled = false; 
            } 
        }); 
    } 
}

async function handleSaveReserva(e) { 
    e.preventDefault(); 
    const f = e.target; 
    const rId = f['reserva-id'].value;
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
        d.estado = {
            principal: 'Pendiente',
            detalle: 'Recién creada',
            actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
        };
        d.creadoEn = firebase.firestore.FieldValue.serverTimestamp(); 
    } 
    try { 
        if (rId) { 
            await db.collection('reservas').doc(rId).update(d);
        } else { 
            await db.collection('reservas').add(d); 
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

async function handleSaveCliente(e) { 
    e.preventDefault(); 
    const f=e.target; 
    const d={nombre:f.nombre.value,cuit:f.cuit.value,domicilio:f.domicilio.value,telefono:f.telefono.value,color:f.color.value,creadoEn:firebase.firestore.FieldValue.serverTimestamp()}; 
    if(!d.nombre){alert("Nombre es obligatorio.");return} 
    try{
        await db.collection('clientes').add(d);
        alert("Cliente guardado.");
        f.reset()
    }catch(error){
        console.error("Error:",error);
        alert("Error: "+error.message)
    } 
}

async function handleSavePasajero(e) { 
    e.preventDefault(); 
    const f=e.target; 
    const dni=f.dni.value.trim();
    if(!dni){alert("DNI es obligatorio.");return} 
    const d={nombre_apellido:f.nombre_apellido.value,telefono:f.telefono.value,domicilios:firebase.firestore.FieldValue.arrayUnion(f.domicilio.value)}; 
    try{
        const pRef=db.collection('pasajeros').doc(dni);
        await pRef.set(d,{merge:true});
        alert("Pasajero guardado.");
        f.reset()
    }catch(error){
        console.error("Error:",error);
        alert("Error: "+error.message)
    } 
}

async function handleSaveMovil(e) { 
    e.preventDefault(); 
    const f=e.target; 
    const d={numero:f.numero.value,patente:f.patente.value,marca:f.marca.value,modelo:f.modelo.value,capacidad_pasajeros:f.capacidad_pasajeros.value,titular_nombre:f.titular_nombre.value,titular_domicilio:f.titular_domicilio.value,titular_telefono:f.titular_telefono.value};
    if(!d.numero||!d.patente){alert("N° y patente son obligatorios.");return} 
    try{
        await db.collection('moviles').add(d);
        alert("Móvil guardado.");
        f.reset()
    } catch(error) {
        console.error("Error:",error);
        alert("Error: "+error.message)
    } 
}

async function handleSaveUsuario(e) { 
    e.preventDefault(); 
    const f=e.target; 
    const n=f.nombre.value,em=f.email.value,p=f.password.value;
    if(!em||!p||!n){alert("Todos los campos son obligatorios.");return} 
    try{
        const cuf=functions.httpsCallable('crearUsuario');
        const res=await cuf({nombre:n,email:em,password:p});
        alert(res.data.result);
        f.reset()
    }catch(error){
        console.error("Error:",error);
        alert("Error: "+error.message)
    } 
}

async function handleSaveZona(e) { 
    e.preventDefault(); 
    const f=e.target; 
    const d={numero:f.numero.value,descripcion:f.descripcion.value};
    if(!d.numero||!d.descripcion){alert("Número y descripción son obligatorios.");return} 
    try{
        await db.collection('zonas').add(d);
        alert("Zona guardada.");
        f.reset()
    }catch(error){
        console.error("Error:",error);
        alert("Error: "+error.message)
    } 
}

async function handleDniBlur(e) { 
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

async function handleSaveChofer(e) {
    e.preventDefault();
    const form = e.target;
    const choferData = {
        dni: form.dni.value,
        nombre: form.nombre.value,
        email: form.email.value,
        password: form.password.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        movil_actual_id: form.movil_actual_id.value || null
    };
    if (!choferData.dni || !choferData.nombre || !choferData.email || !choferData.password) {
        alert("DNI, Nombre, Email y Contraseña son obligatorios.");
        return;
    }
    if (choferData.password.length < 6) {
        alert("La contraseña debe tener al menos 6 caracteres.");
        return;
    }
    try {
        const crearChoferConAcceso = functions.httpsCallable('crearChoferConAcceso');
        const result = await crearChoferConAcceso(choferData);
        alert(result.data.message);
        form.reset();
    } catch (error) {
        console.error("Error al crear chofer:", error);
        alert("Error: " + error.message);
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const form = e.target;
    const auth_uid = form['reset-chofer-uid'].value;
    const nuevaPassword = form['nueva-password'].value;

    if (nuevaPassword.length < 6) {
        alert("La nueva contraseña debe tener al menos 6 caracteres.");
        return;
    }
    try {
        const resetearPasswordChofer = functions.httpsCallable('resetearPasswordChofer');
        const result = await resetearPasswordChofer({ auth_uid, nuevaPassword });
        alert(result.data.message);
        document.getElementById('reset-password-modal').style.display = 'none';
    } catch (error) {
        console.error("Error al resetear contraseña:", error);
        alert("Error: " + error.message);
    }
}

function openResetPasswordModal(authUid, nombreChofer) {
    const modal = document.getElementById('reset-password-modal');
    document.getElementById('reset-chofer-uid').value = authUid;
    document.getElementById('reset-chofer-nombre').textContent = nombreChofer;
    document.getElementById('nueva-password').value = '';
    modal.style.display = 'block';
}

function initializeAdminLists() {
    renderAdminList('clientes', 'lista-clientes', ['nombre', 'cuit', 'telefono'], ['Nombre', 'CUIT', 'Teléfono']);
    renderAdminList('choferes', 'lista-choferes', ['dni', 'nombre', 'email'], ['DNI', 'Nombre', 'Email de Acceso']);
    renderAdminList('moviles', 'lista-moviles', ['numero', 'patente', 'marca', 'modelo'], ['N° Móvil', 'Patente', 'Marca', 'Modelo']);
    renderAdminList('zonas', 'lista-zonas', ['numero', 'descripcion'], ['Número', 'Descripción']);
    renderUsersList();
}

async function renderUsersList() { 
    const c = document.getElementById('lista-usuarios'); 
    if (!c) return; 
    try { 
        const l = functions.httpsCallable('listUsers');
        const res = await l(); 
        const u = res.data.users; 
        if (!u || u.length === 0) { 
            c.innerHTML = '<p>No hay usuarios.</p>';
            return; 
        } 
        let h = `<div class="table-wrapper"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Acciones</th></tr></thead><tbody>`; 
        const p = u.map(user => db.collection('users').doc(user.uid).get()); 
        const s = await Promise.all(p);
        const r = {}; 
        s.forEach(doc => { 
            if (doc.exists) { 
                r[doc.id] = doc.data().rol || 'operador'; 
            } 
        });
        u.forEach(user => { 
            h += `<tr><td>${user.nombre||'-'}</td><td>${user.email||'-'}</td><td>${r[user.uid]||'N/A'}</td><td class="acciones"><button onclick="editItem('users','${user.uid}')">Editar</button><button class="btn-danger" onclick="deleteItem('users','${user.uid}')">Borrar</button></td></tr>`; 
        }); 
        h += `</tbody></table></div>`; 
        c.innerHTML = h;
    } catch (error) { 
        console.error("Error al listar:", error); 
        c.innerHTML = `<p style="color:red;">Error al cargar.</p>`;
    } 
}

function renderAdminList(collectionName, containerId, fields, headers) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const orderByField = fields[0]; 

    const unsubscribe = db.collection(collectionName).orderBy(orderByField).onSnapshot(snapshot => {
        if (snapshot.empty) { container.innerHTML = '<p>No hay datos para mostrar.</p>'; return; }
        let tableHTML = `<div class="table-wrapper"><table><thead><tr>`;
        headers.forEach(header => tableHTML += `<th>${header}</th>`);
        tableHTML += `<th>Acciones</th></tr></thead><tbody>`;
        
        snapshot.forEach(doc => {
            const item = doc.data();
            tableHTML += `<tr>`;
            fields.forEach(field => {
                if (field !== 'auth_uid') {
                    tableHTML += `<td>${item[field] || '-'}</td>`;
                }
            });

            let accionesHTML = `<button onclick="editItem('${collectionName}', '${doc.id}')">Editar</button>`;
            if (collectionName === 'choferes' && item.auth_uid) {
                accionesHTML += `<button onclick="openResetPasswordModal('${item.auth_uid}', '${item.nombre}')">Resetear Contraseña</button>`;
                accionesHTML += `<button class="btn-danger" onclick="deleteItem('${collectionName}', '${doc.id}', '${item.auth_uid}')">Borrar</button>`;
            } else {
                 accionesHTML += `<button class="btn-danger" onclick="deleteItem('${collectionName}', '${doc.id}')">Borrar</button>`;
            }
            tableHTML += `<td class="acciones">${accionesHTML}</td></tr>`;
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
        if (!userDoc.exists) { alert("Error: Usuario no encontrado."); return; } 
        doc = { id: id, exists: true, data: () => ({ ...userDoc.data(), uid: id }) };
    } else { 
        doc = await db.collection(collection).doc(id).get(); 
    } 
    if (!doc.exists) { alert("Error: Item no encontrado."); return; } 
    const data = doc.data(); 
    const form = document.getElementById('edit-form'); 
    form.innerHTML = ''; 
    form.dataset.collection = collection; 
    form.dataset.id = id;
    const fieldsToEdit = Object.keys(data); 
    fieldsToEdit.forEach(field => { 
        if (field === 'creadoEn' || field === 'auth_uid') return; 
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
            if (field === 'uid' || field === 'email' || field === 'dni') { 
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
        alert("Item actualizado."); 
        document.getElementById('edit-modal').style.display = 'none';
    } catch (error) { 
        console.error("Error al actualizar:", error); 
        alert("Error al guardar.");
    } 
}

async function deleteItem(collection, id, auth_uid = null) { 
    const docName = collection.slice(0, -1);
    
    if (confirm(`¿Seguro que quieres borrar este ${docName}? Esta acción no se puede deshacer.`)) {
        try {
            if (collection === 'users') {
                alert("Borrar usuarios debe hacerse con una Cloud Function."); 
                return;
            }

            if (collection === 'choferes') {
                if (!auth_uid) {
                    await db.collection(collection).doc(id).delete();
                    alert(`${docName.charAt(0).toUpperCase() + docName.slice(1)} borrado.`);
                } else {
                    const borrarChofer = functions.httpsCallable('borrarChofer');
                    const result = await borrarChofer({ dni: id, auth_uid: auth_uid });
                    alert(result.data.message);
                }
            } else {
                await db.collection(collection).doc(id).delete();
                alert(`${docName.charAt(0).toUpperCase() + docName.slice(1)} borrado.`);
            }
            if (collection === 'pasajeros') {
                cargarPasajeros();
            }
        } catch (error) {
            console.error(`Error al borrar:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

function openTab(evt, tabName) { 
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none"); 
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active')); 
    document.getElementById(tabName).style.display = "block";
    const activeLink = evt ? evt.currentTarget : document.querySelector(`.tab-link[onclick*="'${tabName}'"]`); 
    if(activeLink) activeLink.classList.add('active'); 
    if (tabName === 'Mapa' && !map) { 
        initMap();
    } else if (tabName === 'Mapa' && map) { 
        cargarMarcadoresDeReservas(); 
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

function initMap() { 
    const c = document.getElementById("map-container"); 
    if (c && !map) { 
        map = new google.maps.Map(c, { center: { lat: -32.9566, lng: -60.6577 }, zoom: 12 });
        map.addListener('click', hideMapContextMenu); 
        if (lastReservasSnapshot) { 
            cargarMarcadoresDeReservas(); 
        } 
    } 
}

function showReservasTab(tabName) { 
    document.querySelectorAll('.reservas-container').forEach(c => c.style.display = 'none'); 
    document.getElementById(`reservas-${tabName}`).style.display = 'block';
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active')); 
    document.querySelector(`.sub-tab-btn[data-tab="${tabName}"]`).classList.add('active'); 
}

function initAutocomplete() { 
    const o = document.getElementById('origen'); 
    const d = document.getElementById('destino'); 
    if (!o || !d) return;
    const opts = { componentRestrictions: { country: "ar" }, fields: ["formatted_address", "geometry", "name"] }; 
    autocompleteOrigen = new google.maps.places.Autocomplete(o, opts);
    autocompleteDestino = new google.maps.places.Autocomplete(d, opts); 
    autocompleteOrigen.addListener('place_changed', () => { 
        const p = autocompleteOrigen.getPlace(); 
        if (p.geometry && p.geometry.location) { 
            if (mapaModal && marcadorOrigenModal) { 
                mapaModal.setCenter(p.geometry.location); 
                marcadorOrigenModal.setPosition(p.geometry.location); 
                mapaModal.setZoom(15); 
            } 
        } 
    });
    autocompleteDestino.addListener('place_changed', () => { 
        const p = autocompleteDestino.getPlace(); 
        if (p.geometry && p.geometry.location) { 
            if (mapaModal && marcadorDestinoModal) { 
                mapaModal.setCenter(p.geometry.location); 
                marcadorDestinoModal.setPosition(p.geometry.location); 
                mapaModal.setZoom(15); 
            } 
        } 
    });
}

// Asegúrate de que tu función crearIconoDeMarcador pueda manejar un texto principal y un emoji.
// Ejemplo de cómo podría ser tu función (ajusta si es necesario):
function crearIconoDeMarcador(colorFondo, textoPrincipal, emoji = '') {
    const svgIcon = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="40" rx="10" fill="${colorFondo}"/>
        <text x="20" y="26" font-family="Arial" font-size="16" fill="#fff" text-anchor="middle">${textoPrincipal}</text>
        ${emoji ? `<text x="10" y="26" font-family="Arial" font-size="16" fill="#fff" text-anchor="middle">${emoji}</text>` : ''}
    </svg>`;
    
    // Si necesitas el emoji a la derecha, ajusta la posición x del textoPrincipal y del emoji.
    // Ejemplo para emoji a la izquierda y número de móvil a la derecha
    const svgIconConEmojiYNumero = `<svg width="50" height="40" viewBox="0 0 50 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="50" height="40" rx="10" fill="${colorFondo}"/>
        ${emoji ? `<text x="15" y="26" font-family="Arial" font-size="16" fill="#fff" text-anchor="middle">${emoji}</text>` : ''}
        <text x="35" y="26" font-family="Arial" font-size="16" fill="#fff" text-anchor="middle">${textoPrincipal}</text>
    </svg>`;


    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIconConEmojiYNumero),
        scaledSize: new google.maps.Size(50, 40) // Ajusta el tamaño según sea necesario
    };
}

function toggleChoferesVisibility(mostrar) {
    for (const choferId in marcadoresChoferes) {
        marcadoresChoferes[choferId].setVisible(mostrar);
    }
}

function escucharUbicacionChoferes() {
    db.collection('choferes').onSnapshot(snapshot => {
        if (!map) return;
        const mostrar = document.getElementById('toggle-choferes').checked;
        snapshot.docChanges().forEach(change => {
            const chofer = { id: change.doc.id, ...change.doc.data() };
            const marcadorExistente = marcadoresChoferes[chofer.id];

            if (change.type === 'removed' || !chofer.coordenadas) {
                if (marcadorExistente) {
                    marcadorExistente.setMap(null);
                    delete marcadoresChoferes[chofer.id];
                }
                return;
            }

            const nuevaPos = new google.maps.LatLng(chofer.coordenadas.latitude, chofer.coordenadas.longitude);
            const movilAsignado = movilesCache.find(m => m.id === chofer.movil_actual_id);
            const numeroMovil = movilAsignado ? movilAsignado.numero.toString() : 'N/A'; // Asegúrate que sea string

            // Creamos un ícono personalizado para el chofer con el número de móvil y un emoji
            const iconoChofer = crearIconoDeMarcador('#1D7BFF', numeroMovil, '🚕'); // Color azul, número y taxi

            if (marcadorExistente) {
                // Actualiza la posición y el ícono si es necesario
                marcadorExistente.setPosition(nuevaPos);
                marcadorExistente.setIcon(iconoChofer);
                marcadorExistente.setLabel(null); // No necesitamos etiqueta adicional
                marcadorExistente.setTitle(`Chofer: ${chofer.nombre || 'N/A'}\nMóvil: ${numeroMovil}`);
            } else {
                const marcador = new google.maps.Marker({
                    position: nuevaPos,
                    map: map,
                    title: `Chofer: ${chofer.nombre || 'N/A'}\nMóvil: ${numeroMovil}`,
                    icon: iconoChofer, // Usamos el ícono personalizado con el número de móvil
                    zIndex: 101 // Asegura que los choferes estén por encima de otras cosas
                });
                
                marcador.setVisible(mostrar);
                marcadoresChoferes[chofer.id] = marcador;
            }
        });
    });
}


function cargarMarcadoresDeReservas() { 
    if (!map || !lastReservasSnapshot) return; 
    Object.values(marcadoresOrigen).forEach(m => m.setMap(null)); 
    marcadoresOrigen = {}; 
    const ahora = new Date();
    const lim = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));
    
    lastReservasSnapshot.forEach(doc => { 
        const r = { id: doc.id, ...doc.data() }; 
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        
        const est = ['En Curso', 'Asignado', 'Pendiente', 'En Origen', 'Viaje Iniciado']; 
        if (!est.includes(e)) return; 

        if (!r.chofer_asignado_id && e === 'Pendiente') { 
            const fT = r.fecha_turno ? new Date(`${r.fecha_turno}T${r.hora_turno || '00:00'}`) : null; 
            if (fT && fT <= lim) { 
                e = 'En Curso'; 
            } 
        } 
        
        if (filtroMapaActual !== 'Todos' && e !== filtroMapaActual) return; 
        if (r.origen_coords && r.origen_coords.latitude) { 
            let cM, tM = ''; 
            switch (e) { 
                case 'En Curso': 
                case 'En Origen':
                case 'Viaje Iniciado':
                    cM = '#F54927'; 
                    const h = r.hora_pickup || r.hora_turno; 
                    if (h) { tM = h.substring(0, 5); } 
                    break; 
                case 'Asignado': 
                    cM = '#4DF527'; 
                    const m = movilesCache.find(mov => mov.id === r.movil_asignado_id); 
                    if(m && m.numero) { tM = m.numero.toString(); } 
                    break; 
                case 'Pendiente': 
                    cM = '#C15DE8'; 
                    break; 
            } 
            const i = crearIconoDeMarcador(cM, tM); 
            const marker = new google.maps.Marker({ position: { lat: r.origen_coords.latitude, lng: r.origen_coords.longitude }, map: map, title: `Origen: ${r.origen} (${e})`, icon: i });
            marcadoresOrigen[r.id] = marker; 
            
            marker.addListener('click', () => { 
                if (infoWindowActiva) infoWindowActiva.close(); 
                if (marcadorDestinoActivo) marcadorDestinoActivo.setMap(null); 
                const cli = clientesCache[r.cliente] || { nombre: 'N/A' }; 
                const cho = choferesCache.find(c => c.id === r.chofer_asignado_id) || { nombre: 'No asignado' }; 
                let obs = ''; 
                if (r.observaciones) { 
                    obs = `<p style="background-color:#fffbe6;border-left:4px solid #ffc107;padding:8px;margin-top:5px;"><strong>Obs:</strong> ${r.observaciones}</p>`; 
                } 
                const cont = `<div class="info-window"><h4>Reserva de: ${cli.nombre}</h4><p><strong>Pasajero:</strong> ${r.nombre_pasajero||'N/A'}</p><p><strong>Origen:</strong> ${r.origen}</p><p><strong>Destino:</strong> ${r.destino}</p><p><strong>Turno:</strong> ${new Date(r.fecha_turno + 'T' + (r.hora_turno||'00:00')).toLocaleString('es-AR')}</p><p><strong>Chofer:</strong> ${cho.nombre}</p>${obs}</div>`; 
                infoWindowActiva = new google.maps.InfoWindow({ content: cont }); 
                infoWindowActiva.open(map, marker); 
                if (r.destino_coords && r.destino_coords.latitude) { 
                    const iD = crearIconoDeMarcador('#27DAF5', '');
                    marcadorDestinoActivo = new google.maps.Marker({ position: { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude }, map: map, title: `Destino: ${r.destino}`, icon: iD });
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
                const rId = r.id; 
                if (e === 'En Curso' || e === 'Pendiente') { 
                    menuHTML = `<li><a onclick="openEditReservaModal('${rId}'); hideMapContextMenu()">Editar</a></li><li><select onchange="asignarMovil('${rId}', this.value); hideMapContextMenu()"><option value="">Asignar Móvil...</option>${movilesCache.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('')}</select></li><li><a onclick="changeReservaState('${rId}', 'Anulado'); return false;">Anular</a></li>`; 
                } else if (e === 'Asignado' || e === 'En Origen' || e === 'Viaje Iniciado') { 
                    menuHTML = `<li><a onclick="openEditReservaModal('${rId}'); hideMapContextMenu()">Editar</a></li><li><a onclick="finalizarReserva('${rId}'); hideMapContextMenu()">Finalizar</a></li><li><a onclick="quitarAsignacion('${rId}'); hideMapContextMenu()">Quitar Móvil</a></li>`; 
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
    const c = document.getElementById("mapa-modal-container");
    if (!c) return; 
    const centro = { lat: -32.95, lng: -60.65 };
    if (!mapaModal) { 
        mapaModal = new google.maps.Map(c, { center: centro, zoom: 13 }); 
        initAutocomplete(); 
    } 
    if (marcadorOrigenModal) marcadorOrigenModal.setMap(null);
    if (marcadorDestinoModal) marcadorDestinoModal.setMap(null); 
    
    const pO = (origenCoords && origenCoords.latitude) ? { lat: origenCoords.latitude, lng: origenCoords.longitude } : centro;
    marcadorOrigenModal = new google.maps.Marker({ position: pO, map: mapaModal, draggable: true }); 
    
    const pD = (destinoCoords && destinoCoords.latitude) ? { lat: destinoCoords.latitude, lng: destinoCoords.longitude } : centro; 
    marcadorDestinoModal = new google.maps.Marker({ position: pD, map: mapaModal, draggable: true });
    
    if (origenCoords && origenCoords.latitude && destinoCoords && destinoCoords.latitude) { 
        const b = new google.maps.LatLngBounds(); 
        b.extend(pO); 
        b.extend(pD); 
        mapaModal.fitBounds(b);
    } else if (origenCoords && origenCoords.latitude) { 
        mapaModal.setCenter(pO); 
        mapaModal.setZoom(15); 
    } else { 
        mapaModal.setCenter(centro); 
        mapaModal.setZoom(13);
    } 
    
    marcadorOrigenModal.addListener('dragend', (event) => { 
        actualizarInputDesdeCoordenadas(event.latLng, 'origen'); 
    }); 
    marcadorDestinoModal.addListener('dragend', (event) => { 
        actualizarInputDesdeCoordenadas(event.latLng, 'destino'); 
    });
}

function actualizarInputDesdeCoordenadas(latLng, tipo) { 
    if (!geocoder) geocoder = new google.maps.Geocoder();
    geocoder.geocode({ 'location': latLng }, (results, status) => { 
        if (status === 'OK') { 
            if (results[0]) { 
                document.getElementById(tipo).value = results[0].formatted_address; 
            } else { 
                window.alert('No se encontraron resultados.'); 
            } 
        } else { 
            window.alert('Geocodificación falló: ' + status); 
        } 
    });
}

// ===================================================================================
// INICIALIZACIÓN
// ===================================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Búsquedas
    const searchInput = document.getElementById('search-historial-input');
    if (searchInput) searchInput.addEventListener('input', (e) => buscarEnHistorial(e.target.value));

    const pasajerosSearchInput = document.getElementById('busqueda-pasajeros');
    if(pasajerosSearchInput) pasajerosSearchInput.addEventListener('input', (e) => buscarEnPasajeros(e.target.value));
    
    const reservasSearchInput = document.getElementById('busqueda-reservas');
    if (reservasSearchInput) reservasSearchInput.addEventListener('input', (e) => buscarEnReservas(e.target.value));

    // Paginación Históricos
    historialBody = document.getElementById('historial-body');
    btnAnterior = document.getElementById('btn-anterior');
    btnSiguiente = document.getElementById('btn-siguiente');
    indicadorPagina = document.getElementById('indicador-pagina');
    if (btnSiguiente) btnSiguiente.addEventListener('click', () => { if (paginaActual === historialDePaginas.length - 1) { historialDePaginas.push(ultimoDocVisible); } paginaActual++; cargarHistorial(); });
    if (btnAnterior) btnAnterior.addEventListener('click', () => { if (paginaActual > 0) { paginaActual--; cargarHistorial(); } });
    
    // Paginación Pasajeros
    pasajerosBody = document.getElementById('lista-pasajeros');
    pasajerosBtnAnterior = document.getElementById('pasajeros-btn-anterior');
    pasajerosBtnSiguiente = document.getElementById('pasajeros-btn-siguiente');
    pasajerosIndicadorPagina = document.getElementById('pasajeros-indicador-pagina');
    if (pasajerosBtnSiguiente) pasajerosBtnSiguiente.addEventListener('click', () => { if (pasajerosPaginaActual === pasajerosHistorialDePaginas.length - 1) { pasajerosHistorialDePaginas.push(pasajerosUltimoDocVisible); } pasajerosPaginaActual++; cargarPasajeros(); });
    if (pasajerosBtnAnterior) pasajerosBtnAnterior.addEventListener('click', () => { if (pasajerosPaginaActual > 0) { pasajerosPaginaActual--; cargarPasajeros(); } });
});