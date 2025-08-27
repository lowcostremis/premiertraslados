// CONFIGURACIÓN DE FIREBASE
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

// VARIABLES GLOBALES
let map;
let autocompleteOrigen, autocompleteDestino;
let clientesCache = {};
let choferesCache = [];
let zonasCache = [];
let movilesCache = [];
let unsubscribeReservas;
let adminListeners = [];
let lastReservasSnapshot = null;

// -- NUEVAS VARIABLES GLOBALES PARA EL MAPA --
let marcadoresOrigen = {}; 
let marcadorDestinoActivo = null; 
let infoWindowActiva = null; 
let mapaModal;
let marcadorOrigenModal = null;
let marcadorDestinoModal = null;
let geocoder;


// LÓGICA DE AUTENTICACIÓN
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
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, password)
        .catch(error => alert("Error de autenticación: " + error.message));
});

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

// INICIALIZACIÓN DE LA APP
function initApp() {
    loadAuxData();
    attachEventListeners();
    listenToReservas();
    initializeAdminLists();
}

// CARGA DE DATOS AUXILIARES
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
        movilSelect.innerHTML = '<option value="">Asignar Móvil...</option>';
        snapshot.forEach(doc => {
            const movil = { id: doc.id, ...doc.data() };
            movilesCache.push(movil);
            movilSelect.innerHTML += `<option value="${movil.id}">N° ${movil.numero} (${movil.patente})</option>`;
        });
    });
}

// LÓGICA DE RESERVAS Y EDICIÓN DIRECTA
function listenToReservas() {
    if (unsubscribeReservas) unsubscribeReservas();
    unsubscribeReservas = db.collection('reservas').orderBy("creadoEn", "desc").onSnapshot(snapshot => {
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot);
    }, err => console.error("Error escuchando reservas:", err));
}

function renderAllReservas(snapshot) {
    const bodies = {
        'tabla-en-curso': document.querySelector('#tabla-en-curso tbody'),
        'tabla-pendientes': document.querySelector('#tabla-pendientes tbody'),
        'tabla-asignados': document.querySelector('#tabla-asignados tbody'),
        'tabla-historico': document.querySelector('#tabla-historico tbody'),
    };
    Object.values(bodies).forEach(body => { if(body) body.innerHTML = ''; });
    const ahora = new Date();
    const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));
    snapshot.forEach(doc => {
        const reserva = { id: doc.id, ...doc.data() };
        const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
        let targetTableId = '';
        if (['Finalizado', 'Anulado', 'Negativo'].includes(reserva.estado)) targetTableId = 'tabla-historico';
        else if (reserva.chofer_asignado_id) targetTableId = 'tabla-asignados';
        else if (fechaTurno && fechaTurno > limite24hs) targetTableId = 'tabla-pendientes';
        else targetTableId = 'tabla-en-curso';
        if (targetTableId && bodies[targetTableId]) renderFilaReserva(bodies[targetTableId], reserva);
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
            const r = parseInt(color.substr(1, 2), 16), g = parseInt(color.substr(3, 2), 16), b = parseInt(color.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            row.style.color = (yiq >= 128) ? '#333' : '#f0f0f0';
        }
    }

    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';
    const isEditable = ['tabla-en-curso', 'tabla-pendientes'].includes(tbody.parentElement.id);
    const isAsignado = tbody.parentElement.id === 'tabla-asignados';
    const isHistorico = tbody.parentElement.id === 'tabla-historico';

    let accionesHTML = '';
    if (isHistorico) {
        const choferAsignado = choferesCache.find(c => c.id === reserva.chofer_asignado_id);
        accionesHTML = choferAsignado ? choferAsignado.nombre : 'No asignado';
    } else {
        let acciones = `<button onclick="openEditReservaModal('${reserva.id}')">Editar</button>`;
        if (isEditable) { // Pendientes y En Curso
            acciones += `<select onchange="asignarChofer('${reserva.id}', this.value)"><option value="">Asignar...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select>`;
            acciones += `<button class="btn-warning" onclick="changeReservaState('${reserva.id}', 'Anulado')">Anular</button>`;
        } else if (isAsignado) {
            acciones += `<select onchange="asignarChofer('${reserva.id}', this.value)"><option value="">Reasignar...</option>${choferesCache.map(c => `<option value="${c.id}">${c.nombre || c.dni}</option>`).join('')}</select>`;
            acciones += `<button onclick="finalizarReserva('${reserva.id}')">Finalizar</button>`;
            acciones += `<button class="btn-danger" onclick="changeReservaState('${reserva.id}', 'Negativo')">Negativo</button>`;
        }
        accionesHTML = acciones;
    }

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
        <td class="acciones">${isHistorico ? '' : accionesHTML}</td>
        ${isHistorico ? `<td>${accionesHTML}</td>` : ''}
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

    // --> MODIFICADO: Pasamos las coordenadas existentes al mapa del modal
    setTimeout(() => initMapaModal(data.origen_coords, data.destino_coords), 100);
}

async function changeReservaState(reservaId, newState) {
    if (confirm(`¿Estás seguro de que quieres marcar esta reserva como "${newState}"?`)) {
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
        await db.collection('reservas').doc(reservaId).update({ estado: 'Finalizado' }).catch(err => alert("Error: " + err.message));
    }
}

// MANEJO DE EVENTOS
function attachEventListeners() {
    const modal = document.getElementById('reserva-modal');
    const closeBtn = document.querySelector('.close-btn');
    
    // --> MODIFICADO: El listener que abre el modal de NUEVA reserva
    document.getElementById('btn-nueva-reserva').addEventListener('click', () => {
        document.getElementById('reserva-form').reset();
        document.getElementById('modal-title').textContent = 'Nueva Reserva';
        document.getElementById('reserva-id').value = '';
        modal.style.display = 'block';
        // Usamos un setTimeout para asegurar que el div del mapa sea visible antes de inicializarlo
        setTimeout(initMapaModal, 100); 
    });

    closeBtn.onclick = () => modal.style.display = 'none';
    // Elimina o comenta esta línea:
    window.onclick = (event) => { if (event.target == modal) modal.style.display = 'none'; }
    
    document.getElementById('edit-form').addEventListener('submit', handleUpdateItem);
    const closeEditBtn = document.querySelector('.close-edit-btn');
    closeEditBtn.onclick = () => document.getElementById('edit-modal').style.display = 'none';

    document.getElementById('reserva-form').addEventListener('submit', handleSaveReserva);
    document.getElementById('form-clientes').addEventListener('submit', handleSaveCliente);
    document.getElementById('form-pasajeros').addEventListener('submit', handleSavePasajero);
    document.getElementById('form-choferes').addEventListener('submit', handleSaveChofer);
    document.getElementById('form-moviles').addEventListener('submit', handleSaveMovil);
    document.getElementById('form-usuarios').addEventListener('submit', handleSaveUsuario);
    document.getElementById('form-zonas').addEventListener('submit', handleSaveZona);
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);
}

// FUNCIONES PARA GUARDAR DATOS (HANDLERS)
async function handleSaveReserva(e) {
    e.preventDefault();
    const form = e.target;
    const reservaId = form['reserva-id'].value;
    const reservaData = { cliente: form.cliente.value, siniestro: form.siniestro.value, autorizacion: form.autorizacion.value, dni_pasajero: form.dni_pasajero.value.trim(), nombre_pasajero: form.nombre_pasajero.value, telefono_pasajero: form.telefono_pasajero.value, fecha_turno: form.fecha_turno.value, hora_turno: form.hora_turno.value, hora_pickup: form.hora_pickup.value, origen: form.origen.value, destino: form.destino.value, cantidad_pasajeros: form.cantidad_pasajeros.value, zona: form.zona.value, observaciones: form.observaciones.value };
    if(!reservaId) {
        reservaData.estado = 'Pendiente';
        reservaData.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
    }
    try {
        if (reservaId) { await db.collection('reservas').doc(reservaId).update(reservaData); } else { await db.collection('reservas').add(reservaData); }
        if (reservaData.dni_pasajero) {
            const pasajeroRef = db.collection('pasajeros').doc(reservaData.dni_pasajero);
            const pasajeroData = { nombre_apellido: reservaData.nombre_pasajero, telefono: reservaData.telefono_pasajero, domicilios: firebase.firestore.FieldValue.arrayUnion(reservaData.origen) };
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

// FUNCIÓN DE AUTOCOMPLETADO
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

// RENDERIZADO Y GESTIÓN DE LISTAS DE ADMIN
function initializeAdminLists() {
    renderAdminList('clientes', 'lista-clientes', ['nombre', 'cuit', 'telefono', 'domicilio'], ['Nombre', 'CUIT', 'Teléfono', 'Domicilio']);
    renderAdminList('pasajeros', 'lista-pasajeros', ['nombre_apellido', 'telefono', 'domicilios'], ['Nombre y Apellido', 'Teléfono', 'Domicilios'], true);
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
    } catch (error) {
        console.error("Error al llamar a la Cloud Function 'listUsers':", error);
        container.innerHTML = `<p style="color:red;">Error al cargar la lista de usuarios.</p>`;
    }
}

function renderAdminList(collectionName, containerId, fields, headers, useDocIdAsField = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const orderByField = useDocIdAsField ? firebase.firestore.FieldPath.documentId() : fields[0];
    const unsubscribe = db.collection(collectionName).orderBy(orderByField).onSnapshot(snapshot => {
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
        doc = { id: id, data: () => ({ ...userDoc.data(), uid: id }) };
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
        const input = document.createElement('input');
        input.name = field;
        input.value = data[field];
        if (field === 'uid' || field === 'email' || field === 'creadoEn') input.disabled = true;
        form.appendChild(label);
        form.appendChild(input);
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
        if(form.querySelector(`[name="${key}"]`) && form.querySelector(`[name="${key}"]`).disabled) continue;
        updatedData[key] = value;
    }
    try {
        await db.collection(collection).doc(id).update(updatedData);
        alert("Item actualizado con éxito.");
        document.getElementById('edit-modal').style.display = 'none';
    } catch (error) {
        console.error("Error al actualizar:", error);
        alert("Error al guardar los cambios.");
    }
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
        } catch (error) {
            console.error(`Error al borrar ${docName}:`, error);
            alert(`Error al borrar: ${error.message}`);
        }
    }
}

// NAVEGACIÓN
function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none");
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
    document.getElementById(tabName).style.display = "block";
    if (evt) evt.currentTarget.classList.add('active');
}

function showReservasTab(tabName) {
    document.querySelectorAll('.reservas-container').forEach(c => c.style.display = 'none');
    document.getElementById(`reservas-${tabName}`).style.display = 'block';
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.sub-tab-btn[data-tab="${tabName}"]`).classList.add('active');
}

// --- FUNCIONES DEL MAPA ---

function initMap() {
    if (map) return;
    map = new google.maps.Map(document.getElementById("map-container"), { 
        center: { lat: -32.95661878212607, lng: -60.65773175011617 }, 
        zoom: 14 
    });
    initAutocomplete();
    
    // --> ¡NUEVO! Llamamos a la función para cargar las reservas en el mapa
    cargarMarcadoresDeReservas(); 
}

function initAutocomplete() {
     const origenInput = document.getElementById('origen');
    const destinoInput = document.getElementById('destino');
    const options = { componentRestrictions: { country: "ar" }, fields: ["formatted_address", "geometry", "name"] };
    
    autocompleteOrigen = new google.maps.places.Autocomplete(origenInput, options);
    autocompleteDestino = new google.maps.places.Autocomplete(destinoInput, options);

     // --- ¡NUEVO CÓDIGO AÑADIDO! ---
    // Listener para el campo de Origen
    autocompleteOrigen.addListener('place_changed', () => {
        const place = autocompleteOrigen.getPlace();
        // Verificamos que el lugar seleccionado tenga coordenadas
        if (place.geometry && place.geometry.location) {
            // Si el mapa del modal y su marcador existen, los movemos
            if (mapaModal && marcadorOrigenModal) {
                mapaModal.setCenter(place.geometry.location);
                marcadorOrigenModal.setPosition(place.geometry.location);
                mapaModal.setZoom(15); // Hacemos zoom en la nueva ubicación
            }
        }
    });

    // Listener para el campo de Destino
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


// --> ¡NUEVA! Función para cargar marcadores en la pestaña 'Mapa'
function cargarMarcadoresDeReservas() {
    Object.values(marcadoresOrigen).forEach(marker => marker.setMap(null));
    marcadoresOrigen = {};

    db.collection('reservas')
      .where('estado', 'in', ['En Curso', 'Asignado', 'Pendiente'])
      .onSnapshot(snapshot => {
        
        Object.values(marcadoresOrigen).forEach(marker => marker.setMap(null));
        marcadoresOrigen = {};

        snapshot.forEach(doc => {
            const reserva = { id: doc.id, ...doc.data() };

            if (reserva.origen_coords && reserva.origen_coords.latitude) {
                
                const marker = new google.maps.Marker({
                    position: { lat: reserva.origen_coords.latitude, lng: reserva.origen_coords.longitude },
                    map: map,
                    title: `Origen: ${reserva.origen}`,
                    icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
                });

                marcadoresOrigen[reserva.id] = marker;

                marker.addListener('click', () => {
                    if (infoWindowActiva) infoWindowActiva.close();
                    if (marcadorDestinoActivo) marcadorDestinoActivo.setMap(null);

                    const cliente = clientesCache[reserva.cliente] || { nombre: 'N/A' };
                    const chofer = choferesCache.find(c => c.id === reserva.chofer_asignado_id) || { nombre: 'No asignado' };

                    const contenido = `
                        <div class="info-window">
                            <h4>Reserva de: ${cliente.nombre}</h4>
                            <p><strong>Pasajero:</strong> ${reserva.nombre_pasajero || 'N/A'}</p>
                            <p><strong>Origen:</strong> ${reserva.origen}</p>
                            <p><strong>Destino:</strong> ${reserva.destino}</p>
                            <p><strong>Turno:</strong> ${new Date(reserva.fecha_turno + 'T' + reserva.hora_turno).toLocaleString('es-AR')}</p>
                            <p><strong>Chofer:</strong> ${chofer.nombre}</p>
                        </div>
                    `;
                    
                    infoWindowActiva = new google.maps.InfoWindow({ content: contenido });
                    infoWindowActiva.open(map, marker);

                    if (reserva.destino_coords && reserva.destino_coords.latitude) {
                        marcadorDestinoActivo = new google.maps.Marker({
                            position: { lat: reserva.destino_coords.latitude, lng: reserva.destino_coords.longitude },
                            map: map,
                            title: `Destino: ${reserva.destino}`,
                            icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
                        });
                    }
                    
                    infoWindowActiva.addListener('closeclick', () => {
                        if (marcadorDestinoActivo) {
                            marcadorDestinoActivo.setMap(null);
                            marcadorDestinoActivo = null;
                        }
                    });
                });
            }
        });
    });
}

// --> ¡NUEVA! Función para inicializar el mapa del modal
function initMapaModal(origenCoords, destinoCoords) {
    if (!geocoder) {
        geocoder = new google.maps.Geocoder();
    }

    if (!mapaModal) {
        mapaModal = new google.maps.Map(document.getElementById("mapa-modal-container"), { 
            center: { lat: -32.95, lng: -60.65 }, 
            zoom: 13 
        });
    }

    if (marcadorOrigenModal) marcadorOrigenModal.setMap(null);
    if (marcadorDestinoModal) marcadorDestinoModal.setMap(null);

    const posOrigen = (origenCoords && origenCoords.latitude) 
        ? { lat: origenCoords.latitude, lng: origenCoords.longitude }
        : mapaModal.getCenter();

    marcadorOrigenModal = new google.maps.Marker({
        position: posOrigen,
        map: mapaModal,
        draggable: true,
        icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
    });

    const posDestino = (destinoCoords && destinoCoords.latitude) 
        ? { lat: destinoCoords.latitude, lng: destinoCoords.longitude }
        : mapaModal.getCenter();

    marcadorDestinoModal = new google.maps.Marker({
        position: posDestino,
        map: mapaModal,
        draggable: true,
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });
    
    marcadorOrigenModal.addListener('dragend', (event) => {
        actualizarInputDesdeCoordenadas(event.latLng, 'origen');
    });

    marcadorDestinoModal.addListener('dragend', (event) => {
        actualizarInputDesdeCoordenadas(event.latLng, 'destino');
    });
}

// --> ¡NUEVA! Función para hacer geocodificación inversa
function actualizarInputDesdeCoordenadas(latLng, tipoInput) {
    geocoder.geocode({ 'location': latLng }, (results, status) => {
        if (status === 'OK') {
            if (results[0]) {
                document.getElementById(tipoInput).value = results[0].formatted_address;
            } else {
                window.alert('No se encontraron resultados');
            }
        } else {
            window.alert('Geocoder falló debido a: ' + status);
        }
    });
}
