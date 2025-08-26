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
let unsubscribeReservas;
let adminListeners = []; // Para manejar los listeners de las listas de admin

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
        adminListeners.forEach(unsubscribe => unsubscribe()); // Detiene los listeners de admin al salir
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

// CARGA DE DATOS AUXILIARES PARA FORMULARIOS
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
    });
    db.collection('zonas').orderBy('numero').onSnapshot(snapshot => {
        const zonaSelect = document.getElementById('zona');
        zonaSelect.innerHTML = '<option value="">Seleccionar Zona...</option>';
        zonasCache = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            zonasCache.push({ id: doc.id, ...data });
            zonaSelect.innerHTML += `<option value="${doc.id}">${data.numero} - ${data.descripcion}</option>`;
        });
    });
}

// LÓGICA DE RESERVAS
function listenToReservas() {
    if (unsubscribeReservas) unsubscribeReservas();

    unsubscribeReservas = db.collection('reservas').orderBy("creadoEn", "desc").onSnapshot(snapshot => {
        const bodies = document.querySelectorAll('#tabla-en-curso tbody, #tabla-pendientes tbody, #tabla-asignados tbody, #tabla-historico tbody');
        bodies.forEach(body => body.innerHTML = '');

        const ahora = new Date();
        const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

        snapshot.forEach(doc => {
            const reserva = { id: doc.id, ...doc.data() };
            const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
            let targetTableId = '';

            if (['Finalizado', 'Anulado', 'Negativo'].includes(reserva.estado)) {
                targetTableId = 'tabla-historico';
            } else if (reserva.chofer_asignado_id) {
                targetTableId = 'tabla-asignados';
            } else if (fechaTurno && fechaTurno > limite24hs) {
                targetTableId = 'tabla-pendientes';
            } else {
                targetTableId = 'tabla-en-curso';
            }
            
            if (targetTableId) {
                renderFilaReserva(document.querySelector(`#${targetTableId} tbody`), reserva);
            }
        });
    }, err => console.error("Error escuchando reservas:", err));
}

function renderFilaReserva(tbody, reserva) {
    const cliente = clientesCache[reserva.cliente] || { nombre: 'Default', color: '#ffffff' };
    const row = tbody.insertRow();
    
    if (reserva.estado === 'Negativo') {
        row.className = 'estado-negativo';
    } else if (reserva.estado === 'Anulado') {
        row.className = 'estado-anulado';
    } else if (cliente.color) {
        row.style.backgroundColor = cliente.color;
        const color = cliente.color;
        if (color && color.startsWith('#')) {
            const r = parseInt(color.substr(1, 2), 16);
            const g = parseInt(color.substr(3, 2), 16);
            const b = parseInt(color.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            row.style.color = (yiq >= 128) ? '#333' : '#f0f0f0';
        }
    }

    const fechaFormateada = reserva.fecha_turno ? new Date(reserva.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR') : '';

    row.innerHTML = `
        <td>${reserva.siniestro || ''}</td>
        <td>${reserva.autorizacion || ''}</td>
        <td>${cliente.nombre}</td>
        <td>${fechaFormateada}</td>
        <td>${reserva.hora_turno || ''}</td>
        <td>${reserva.hora_pickup || ''}</td>
        <td>${reserva.origen || ''}</td>
        <td>${reserva.destino || ''}</td>
        <td>${reserva.nombre_pasajero || ''}</td>
        <td>${reserva.telefono_pasajero || ''}</td>
        <td>${reserva.cantidad_pasajeros || 1}</td>
        <td>${zonasCache.find(z => z.id === reserva.zona)?.descripcion || ''}</td>
        <td>${reserva.estado || 'Pendiente'}</td>
        <td class="acciones"></td>
    `;
    
    const accionesCell = row.cells[row.cells.length - 1];
    if (!['Finalizado', 'Anulado', 'Negativo'].includes(reserva.estado)) {
        if (!reserva.chofer_asignado_id && ['tabla-en-curso', 'tabla-pendientes'].includes(tbody.parentElement.id)) {
             const selectChofer = document.createElement('select');
             selectChofer.innerHTML = `<option value="">Asignar chofer...</option>`;
             choferesCache.forEach(chofer => {
                 selectChofer.innerHTML += `<option value="${chofer.id}">${chofer.nombre || chofer.dni}</option>`;
             });
             selectChofer.onchange = () => asignarChofer(reserva.id, selectChofer.value);
             accionesCell.appendChild(selectChofer);
        } else if (reserva.chofer_asignado_id) { 
            const choferAsignado = choferesCache.find(c => c.id === reserva.chofer_asignado_id);
            const p = document.createElement('p');
            p.textContent = `Asignado a: ${choferAsignado?.nombre || 'Desconocido'}`;
            const btn = document.createElement('button');
            btn.textContent = 'Finalizar';
            btn.onclick = () => finalizarReserva(reserva.id);
            accionesCell.appendChild(p);
            accionesCell.appendChild(btn);
        }
    }
}

async function asignarChofer(reservaId, choferId) {
    if (!choferId) return;
    await db.collection('reservas').doc(reservaId).update({
        chofer_asignado_id: choferId,
        estado: 'Asignado'
    }).catch(err => alert("Error al asignar: " + err.message));
}

async function finalizarReserva(reservaId) {
    if (confirm("¿Marcar esta reserva como finalizada?")) {
        await db.collection('reservas').doc(reservaId).update({ estado: 'Finalizado' })
        .catch(err => alert("Error al finalizar: " + err.message));
    }
}

// MANEJO DE EVENTOS
function attachEventListeners() {
    const modal = document.getElementById('reserva-modal');
    const closeBtn = document.querySelector('.close-btn');
    
    document.getElementById('btn-nueva-reserva').addEventListener('click', () => {
        document.getElementById('reserva-form').reset();
        document.getElementById('modal-title').textContent = 'Nueva Reserva';
        document.getElementById('reserva-id').value = '';
        modal.style.display = 'block';
    });

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = 'none';
    }

    document.getElementById('reserva-form').addEventListener('submit', handleSaveReserva);
    document.getElementById('form-clientes').addEventListener('submit', handleSaveCliente);
    document.getElementById('form-pasajeros').addEventListener('submit', handleSavePasajero);
    document.getElementById('form-choferes').addEventListener('submit', handleSaveChofer);
    document.getElementById('form-moviles').addEventListener('submit', handleSaveMovil);
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);
}

// FUNCIONES PARA GUARDAR DATOS (HANDLERS)
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
        observaciones: form.observaciones.value,
        estado: 'Pendiente',
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        if (reservaId) {
            await db.collection('reservas').doc(reservaId).update(reservaData);
        } else {
            await db.collection('reservas').add(reservaData);
        }
        
        if (reservaData.dni_pasajero) {
            const pasajeroRef = db.collection('pasajeros').doc(reservaData.dni_pasajero);
            const pasajeroData = {
                nombre_apellido: reservaData.nombre_pasajero,
                telefono: reservaData.telefono_pasajero,
                domicilios: firebase.firestore.FieldValue.arrayUnion(reservaData.origen)
            };
            await pasajeroRef.set(pasajeroData, { merge: true });
        }
        document.getElementById('reserva-modal').style.display = 'none';
    } catch (error) {
        alert("Error al guardar reserva: " + error.message);
    }
}

async function handleSaveCliente(e) {
    e.preventDefault();
    const form = e.target;
    const clienteData = {
        nombre: form.nombre.value,
        cuit: form.cuit.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        color: form.color.value,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!clienteData.nombre) {
        alert("El nombre de la empresa es obligatorio.");
        return;
    }
    try {
        await db.collection('clientes').add(clienteData);
        alert("Cliente guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar cliente:", error);
        alert("Error al guardar el cliente: " + error.message);
    }
}

async function handleSavePasajero(e) {
    e.preventDefault();
    const form = e.target;
    const dni = form.dni.value.trim();
    if (!dni) {
        alert("El DNI del pasajero es obligatorio.");
        return;
    }
    const pasajeroData = {
        nombre_apellido: form.nombre_apellido.value,
        telefono: form.telefono.value,
        domicilios: firebase.firestore.FieldValue.arrayUnion(form.domicilio.value)
    };
    try {
        const pasajeroRef = db.collection('pasajeros').doc(dni);
        await pasajeroRef.set(pasajeroData, { merge: true });
        alert("Pasajero guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar pasajero:", error);
        alert("Error al guardar el pasajero: " + error.message);
    }
}

async function handleSaveChofer(e) {
    e.preventDefault();
    const form = e.target;
    const choferData = {
        dni: form.dni.value,
        nombre: form.nombre.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        movil_actual_id: form.movil_actual_id.value || null
    };
    if (!choferData.dni) {
        alert("El DNI del chofer es obligatorio.");
        return;
    }
    try {
        await db.collection('choferes').add(choferData);
        alert("Chofer guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar chofer:", error);
        alert("Error al guardar el chofer: " + error.message);
    }
}

async function handleSaveMovil(e) {
    e.preventDefault();
    const form = e.target;
    const movilData = {
        numero: form.numero.value,
        patente: form.patente.value,
        marca: form.marca.value,
        modelo: form.modelo.value,
        capacidad_pasajeros: form.capacidad_pasajeros.value,
        titular_nombre: form.titular_nombre.value,
        titular_domicilio: form.titular_domicilio.value,
        titular_telefono: form.titular_telefono.value
    };
    if (!movilData.numero || !movilData.patente) {
        alert("El número de móvil y la patente son obligatorios.");
        return;
    }
    try {
        await db.collection('moviles').add(movilData);
        alert("Móvil guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar móvil:", error);
        alert("Error al guardar el móvil: " + error.message);
    }
}

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
    } catch (error) {
        console.error("Error al buscar pasajero por DNI:", error);
    }
}

// RENDERIZADO DE LISTAS DE ADMIN
function initializeAdminLists() {
    renderAdminList(
        'clientes', 
        'lista-clientes', 
        ['nombre', 'cuit', 'telefono', 'domicilio'], 
        ['Nombre', 'CUIT', 'Teléfono', 'Domicilio']
    );
    renderAdminList(
        'pasajeros', 
        'lista-pasajeros', 
        ['nombre_apellido', 'telefono', 'domicilios'], 
        ['Nombre y Apellido', 'Teléfono', 'Domicilios Conocidos'],
        true // Indica que el ID es el DNI
    );
    renderAdminList(
        'choferes', 
        'lista-choferes', 
        ['dni', 'nombre', 'telefono', 'domicilio'], 
        ['DNI', 'Nombre', 'Teléfono', 'Domicilio']
    );
    renderAdminList(
        'moviles', 
        'lista-moviles', 
        ['numero', 'patente', 'marca', 'modelo', 'capacidad_pasajeros'], 
        ['N° Móvil', 'Patente', 'Marca', 'Modelo', 'Capacidad']
    );
}

function renderAdminList(collectionName, containerId, fields, headers, useDocIdAsField = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const unsubscribe = db.collection(collectionName).onSnapshot(snapshot => {
        if (snapshot.empty) {
            container.innerHTML = '<p>No hay datos para mostrar.</p>';
            return;
        }

        let tableHTML = `<div class="table-wrapper"><table><thead><tr>`;
        if (useDocIdAsField) {
            headers.unshift("DNI"); // Agrega DNI como primer encabezado
        }
        headers.forEach(header => tableHTML += `<th>${header}</th>`);
        tableHTML += `<th>Acciones</th></tr></thead><tbody>`;

        snapshot.forEach(doc => {
            const item = doc.data();
            tableHTML += `<tr>`;
            if (useDocIdAsField) {
                tableHTML += `<td>${doc.id}</td>`; // Usa el ID del documento (DNI) como primer dato
            }
            fields.forEach(field => {
                const value = item[field];
                const displayValue = Array.isArray(value) ? value.join(', ') : (value || '-');
                tableHTML += `<td>${displayValue}</td>`;
            });
            tableHTML += `
                <td class="acciones">
                    <button onclick="editItem('${collectionName}', '${doc.id}')">Editar</button>
                    <button class="btn-danger" onclick="deleteItem('${collectionName}', '${doc.id}')">Borrar</button>
                </td>
            </tr>`;
        });

        tableHTML += `</tbody></table></div>`;
        container.innerHTML = tableHTML;

    }, err => {
        console.error(`Error cargando la lista de ${collectionName}:`, err);
        container.innerHTML = `<p style="color:red;">Error al cargar la lista.</p>`;
    });

    adminListeners.push(unsubscribe);
}

function editItem(collection, id) {
    alert(`Funcionalidad "Editar" para ${collection} (ID: ${id}) aún no implementada.`);
}

async function deleteItem(collection, id) {
    const docName = collection.slice(0, -1);
    if (confirm(`¿Estás seguro de que quieres borrar este ${docName}?`)) {
        try {
            await db.collection(collection).doc(id).delete();
            alert(`${docName.charAt(0).toUpperCase() + docName.slice(1)} borrado con éxito.`);
        } catch (error) {
            console.error(`Error al borrar ${docName}:`, error);
            alert(`Error al borrar: ${error.message}`);
        }
    }
}

// NAVEGACIÓN Y MAPS
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

function initMap() {
    if (map) return;
    map = new google.maps.Map(document.getElementById("map-container"), {
        center: { lat: -34.6037, lng: -58.3816 }, // Buenos Aires
        zoom: 12,
    });
    initAutocomplete();
}

function initAutocomplete() {
    const origenInput = document.getElementById('origen');
    const destinoInput = document.getElementById('destino');
    const options = {
        componentRestrictions: { country: "ar" },
        fields: ["formatted_address", "geometry", "name"],
    };
    autocompleteOrigen = new google.maps.places.Autocomplete(origenInput, options);
    autocompleteDestino = new google.maps.places.Autocomplete(destinoInput, options);
}

// Copia las funciones que faltaban
// LÓGICA DE RESERVAS (SIN CAMBIOS)
function listenToReservas() {
    if (unsubscribeReservas) unsubscribeReservas();

    unsubscribeReservas = db.collection('reservas').orderBy("creadoEn", "desc").onSnapshot(snapshot => {
        const bodies = document.querySelectorAll('#tabla-en-curso tbody, #tabla-pendientes tbody, #tabla-asignados tbody, #tabla-historico tbody');
        bodies.forEach(body => body.innerHTML = '');

        const ahora = new Date();
        const limite24hs = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

        snapshot.forEach(doc => {
            const reserva = { id: doc.id, ...doc.data() };
            const fechaTurno = reserva.fecha_turno ? new Date(`${reserva.fecha_turno}T${reserva.hora_turno || '00:00'}`) : null;
            let targetTableId = '';

            if (['Finalizado', 'Anulado', 'Negativo'].includes(reserva.estado)) {
                targetTableId = 'tabla-historico';
            } else if (reserva.chofer_asignado_id) {
                targetTableId = 'tabla-asignados';
            } else if (fechaTurno && fechaTurno > limite24hs) {
                targetTableId = 'tabla-pendientes';
            } else {
                targetTableId = 'tabla-en-curso';
            }
            
            if (targetTableId) {
                renderFilaReserva(document.querySelector(`#${targetTableId} tbody`), reserva);
            }
        });
    }, err => console.error("Error escuchando reservas:", err));
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
        observaciones: form.observaciones.value,
        estado: 'Pendiente',
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        if (reservaId) {
            await db.collection('reservas').doc(reservaId).update(reservaData);
        } else {
            await db.collection('reservas').add(reservaData);
        }
        
        if (reservaData.dni_pasajero) {
            const pasajeroRef = db.collection('pasajeros').doc(reservaData.dni_pasajero);
            const pasajeroData = {
                nombre_apellido: reservaData.nombre_pasajero,
                telefono: reservaData.telefono_pasajero,
                domicilios: firebase.firestore.FieldValue.arrayUnion(reservaData.origen)
            };
            await pasajeroRef.set(pasajeroData, { merge: true });
        }
        document.getElementById('reserva-modal').style.display = 'none';
    } catch (error) {
        alert("Error al guardar reserva: " + error.message);
    }
}
async function handleSaveCliente(e) {
    e.preventDefault();
    const form = e.target;
    const clienteData = {
        nombre: form.nombre.value,
        cuit: form.cuit.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        color: form.color.value,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!clienteData.nombre) {
        alert("El nombre de la empresa es obligatorio.");
        return;
    }
    try {
        await db.collection('clientes').add(clienteData);
        alert("Cliente guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar cliente:", error);
        alert("Error al guardar el cliente: " + error.message);
    }
}
async function handleSaveChofer(e) {
    e.preventDefault();
    const form = e.target;
    const choferData = {
        dni: form.dni.value,
        nombre: form.nombre.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        movil_actual_id: form.movil_actual_id.value || null
    };
    if (!choferData.dni) {
        alert("El DNI del chofer es obligatorio.");
        return;
    }
    try {
        await db.collection('choferes').add(choferData);
        alert("Chofer guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar chofer:", error);
        alert("Error al guardar el chofer: " + error.message);
    }
}
async function handleSaveMovil(e) {
    e.preventDefault();
    const form = e.target;
    const movilData = {
        numero: form.numero.value,
        patente: form.patente.value,
        marca: form.marca.value,
        modelo: form.modelo.value,
        capacidad_pasajeros: form.capacidad_pasajeros.value,
        titular_nombre: form.titular_nombre.value,
        titular_domicilio: form.titular_domicilio.value,
        titular_telefono: form.titular_telefono.value
    };
    if (!movilData.numero || !movilData.patente) {
        alert("El número de móvil y la patente son obligatorios.");
        return;
    }
    try {
        await db.collection('moviles').add(movilData);
        alert("Móvil guardado con éxito.");
        form.reset();
    } catch (error) {
        console.error("Error al guardar móvil:", error);
        alert("Error al guardar el móvil: " + error.message);
    }
}

// NAVEGACIÓN Y MAPS
function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none");
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
    document.getElementById(tabName).style.display = "block";
    if (evt) evt.currentTarget.classList.add('active');
}