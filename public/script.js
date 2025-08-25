// ===========================================================================
// IMPORTACIONES Y CONFIGURACIÓN DE FIREBASE (Sintaxis Moderna v9+)
// ===========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
    getFirestore,
    collection,
    onSnapshot,
    orderBy,
    addDoc,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    GeoPoint,
    query,
    where,
    limit,
    deleteField
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
    getFunctions,
    httpsCallable
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";

// --- CONFIGURACIÓN DE FIREBASE ACTUALIZADA ---
const firebaseConfig = {
    apiKey: "AIzaSyA5c2-7JR_bPXYu2FPg-ZVMsq-7NZrSSBk",
    authDomain: "premiertraslados-3f8e2.firebaseapp.com",
    projectId: "premiertraslados-3f8e2",
    storageBucket: "premiertraslados-3f8e2.appspot.com",
    messagingSenderId: "398178691975",
    appId: "1:398178691975:web:a4b2c8c19b998177ccce52"
};

// ===========================================================================
// INICIALIZACIÓN DE SERVICIOS
// ===========================================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// ===========================================================================
// VARIABLES GLOBALES
// ===========================================================================
let currentUserPermissions = [];
let listaDeMovilesCache = [];
let listaDeClientesCache = [];
let listaDeChoferesCache = [];
let listaDeZonasCache = [];
let listaDeSucursalesCache = [];
let listaDePasajerosCache = [];
let listaDeUsuariosCache = [];

let docsPendientesCache = [],
    docsParaAsignarCache = [],
    docsAsignadosCache = [];

let firestoreListeners = [];
let appInitialized = false;

let map;
let editMap = null;
let editMarker = null;
let newReservaMap = null;
let newReservaMarker = null;
let currentMarkers = [];
let destinationMarker = null;
let infoWindow;
let activeMapTab = 'reservas-para-asignar';

// ===========================================================================
// FUNCIÓN PRINCIPAL DE INICIO
// ===========================================================================
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, handleAuthStateChange);
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegistration);
    document.getElementById('show-register-link').addEventListener('click', (e) => {
        e.preventDefault();
        const registerForm = document.getElementById('register-form');
        registerForm.style.display = registerForm.style.display === 'none' ? 'block' : 'none';
    });
});


// ===========================================================================
// MANEJO DE AUTENTICACIÓN Y ESTADO DE LA APLICACIÓN
// ===========================================================================
async function handleAuthStateChange(user) {
    const authSection = document.getElementById('auth-section');
    const appContent = document.getElementById('app-content');

    if (user) {
        authSection.style.display = 'none';
        appContent.style.display = 'block';
        document.getElementById('user-email-display').textContent = user.email;
        
        await handleUserProfile(user.uid);
        
        if (!appInitialized) {
            attachAppEventListeners();
            iniciarListenersAdmin();
            appInitialized = true;
        }
        
        const primeraPestanaVisible = currentUserPermissions.length > 0 ? currentUserPermissions[0].replace('ver_tab_', '') : 'reservas';
        openTab(null, primeraPestanaVisible);

    } else {
        authSection.style.display = 'block';
        appContent.style.display = 'none';
        detachAllListeners();
        resetAppState();
    }
}

async function handleUserProfile(uid) {
    try {
        const userDocRef = doc(db, 'users', uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            currentUserPermissions = userDocSnap.data().permisos || [];
            console.log(`Permisos cargados para ${uid}:`, currentUserPermissions);
        } else {
            // Es normal que no exista inmediatamente después del registro. La Cloud Function lo creará.
            console.warn("Documento de perfil de usuario aún no existe, reintentando en 2 segundos...");
            setTimeout(() => handleUserProfile(uid), 2000); // Reintentamos por si la función tarda
        }
    } catch (error) {
        console.error("Error al obtener el perfil del usuario:", error);
        currentUserPermissions = [];
    }
    aplicarPermisos();
}

function resetAppState() {
    currentUserPermissions = [];
    listaDeMovilesCache = [];
    listaDeClientesCache = [];
    listaDeChoferesCache = [];
    listaDeZonasCache = [];
    listaDeSucursalesCache = [];
    listaDePasajerosCache = [];
    listaDeUsuariosCache = [];
    appInitialized = false;
}

function detachAllListeners() {
    console.log(`Desconectando ${firestoreListeners.length} listeners de Firestore...`);
    firestoreListeners.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    });
    firestoreListeners = [];
}

// ===========================================================================
// LISTENERS DE DATOS EN TIEMPO REAL
// ===========================================================================
function iniciarListenersAdmin() {
    const colecciones = [
        { nombre: 'clientes', fields: ['nombre', 'cuit', 'color'], headers: ['Nombre', 'CUIT', 'Color'] },
        { nombre: 'pasajeros', fields: ['apellido_y_nombre', 'id', 'telefono', 'domicilio'], headers: ['Nombre y Apellido', 'DNI', 'Teléfono', 'Último Domicilio'] },
        { nombre: 'moviles', fields: ['numero', 'patente', 'marca', 'modelo', 'capacidad_pasajeros'], headers: ['Número', 'Patente', 'Marca', 'Modelo', 'Capacidad'] },
        { nombre: 'choferes', fields: ['nombre', 'dni', 'telefono', 'telegram_chat_id', 'movil_actual_id'], headers: ['Nombre', 'DNI', 'Teléfono', 'Telegram ID', 'Móvil Asignado'] },
        { nombre: 'sucursales', fields: ['numero', 'nombre'], headers: ['Número', 'Nombre'] },
        { nombre: 'zonas', fields: ['numero', 'nombre'], headers: ['Número', 'Nombre'] },
        { nombre: 'users', fields: ['nombre', 'email', 'estado'], headers: ['Nombre', 'Email', 'Estado'] }
    ];

    colecciones.forEach(col => {
        const collectionRef = collection(db, col.nombre);
        const q = query(collectionRef, orderBy(col.fields[0]));
        const unsubscribe = onSnapshot(q, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            switch(col.nombre) {
                case 'clientes': listaDeClientesCache = data; break;
                case 'pasajeros': listaDePasajerosCache = data; break;
                case 'moviles': listaDeMovilesCache = data; break;
                case 'choferes': listaDeChoferesCache = data; break;
                case 'sucursales': listaDeSucursalesCache = data; break;
                case 'zonas': listaDeZonasCache = data; break;
                case 'users': listaDeUsuariosCache = data; break;
            }

            renderizarLista(col.nombre, `lista${col.nombre.charAt(0).toUpperCase() + col.nombre.slice(1)}`, col.fields, col.headers);
        }, error => {
            console.error(`Error al escuchar la colección ${col.nombre}:`, error);
        });
        firestoreListeners.push(unsubscribe);
    });

    const reservasRef = collection(db, 'reservas');
    const qReservas = query(reservasRef, orderBy('timestamp_creacion', 'desc'));
    const unsubReservas = onSnapshot(qReservas, snapshot => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        distribuirYRenderizarReservas(docs);
    }, error => console.error("Error al obtener reservas:", error));
    firestoreListeners.push(unsubReservas);
}


function populateAllSelects() {
    populateSelectWithOptions('reservaCliente', listaDeClientesCache, 'clientes');
    populateSelectWithOptions('movilChofer', listaDeMovilesCache, 'moviles');
    populateSelectWithOptions('reservaChofer', listaDeChoferesCache, 'choferes');
    populateSelectWithOptions('reservaZona', listaDeZonasCache, 'zonas');
    populateSelectWithOptions('reservaBase', listaDeSucursalesCache, 'sucursales');
}

// ===========================================================================
// MANEJO DE EVENTOS DE LA UI
// ===========================================================================
function attachAppEventListeners() {
    console.log("Asignando listeners de eventos de la aplicación...");

    const safeAddEventListener = (id, event, handler) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Elemento con ID '${id}' no encontrado. No se pudo asignar el listener.`);
        }
    };

    safeAddEventListener('logout-btn', 'click', () => signOut(auth));
    safeAddEventListener('btn-nueva-reserva', 'click', openReservaModal);

    safeAddEventListener('crearReservaForm', 'submit', handleCrearReserva);
    safeAddEventListener('crearClienteForm', 'submit', handleCrearCliente);
    safeAddEventListener('crearPasajeroForm', 'submit', handleCrearPasajero);
    safeAddEventListener('crearMovilForm', 'submit', handleCrearMovil);
    safeAddEventListener('crearChoferForm', 'submit', handleCrearChofer);
    safeAddEventListener('crearSucursalForm', 'submit', handleCrearSucursal);
    safeAddEventListener('crearZonaForm', 'submit', handleCrearZona);
    safeAddEventListener('crearUsuarioForm', 'submit', handleCrearUsuario);

    safeAddEventListener('editForm', 'submit', handleEditFormSubmit);
    safeAddEventListener('asignarChoferForm', 'submit', handleAsignarChoferSubmit);
    
    safeAddEventListener('btn-nuevo-cliente', 'click', () => toggleForm('crearClienteContainer'));
    safeAddEventListener('btn-nuevo-pasajero', 'click', () => toggleForm('crearPasajeroContainer'));
    safeAddEventListener('btn-nuevo-movil', 'click', () => toggleForm('crearMovilContainer'));
    safeAddEventListener('btn-nuevo-chofer', 'click', () => toggleForm('crearChoferContainer'));
    safeAddEventListener('btn-nuevo-usuario', 'click', () => toggleForm('crearUsuarioContainer'));

    const dniInputCrear = document.querySelector('#crearReservaForm [name="dni"]');
    if (dniInputCrear) dniInputCrear.addEventListener('input', handleDniAutofill);

    const mapTabButtons = {
        'reservas-para-asignar': 'btn-map-en-curso',
        'pendientes': 'btn-map-pendientes',
        'asignados': 'btn-map-asignados'
    };
    Object.keys(mapTabButtons).forEach(tab => {
        safeAddEventListener(mapTabButtons[tab], 'click', () => {
            activeMapTab = tab;
            drawMarkersOnMap(tab);
            document.querySelectorAll('.map-tabs .sub-tab-btn').forEach(btn => btn.classList.remove('active'));
            const clickedButton = document.getElementById(mapTabButtons[tab]);
            if(clickedButton) clickedButton.classList.add('active');
        });
    });

    safeAddEventListener('close-edit-modal', 'click', () => closeModal('editModal'));
    safeAddEventListener('close-reserva-modal', 'click', () => closeModal('crearReservaModal'));
    safeAddEventListener('close-asignar-modal', 'click', () => closeModal('asignarChoferModal'));
    safeAddEventListener('cancelar-asignacion-btn', 'click', () => closeModal('asignarChoferModal'));
    
    setupPasajerosLogic('checkAcompanante', 'acompanantes-select-container', 'checkExclusivo');

    window.addEventListener('click', function(event) {
        if (!event.target.matches('.kebab-btn')) {
            document.querySelectorAll('.kebab-dropdown.show').forEach(openDropdown => openDropdown.classList.remove('show'));
        }
        if (!event.target.closest('.map-context-menu')) {
            closeContextMenu();
        }
        const modals = ['editModal', 'crearReservaModal', 'asignarChoferModal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (modal && event.target == modal) closeModal(modalId);
        });
    });

    Object.assign(window, {
        editarElemento, eliminarElemento, marcarComoNegativo, abrirModalAsignacion,
        devolverAAgendado, finalizarReserva, redespacharReserva, toggleKebabMenu,
        closeContextMenu, actualizarHoraPickup, actualizarCampoReserva, openTab, mostrarReservas
    });

    const crearReservaForm = document.getElementById('crearReservaForm');
    if (crearReservaForm) {
        crearReservaForm.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.tagName.toLowerCase() !== 'textarea' && event.target.type !== 'submit') {
                event.preventDefault();
            }
        });
    }
}

function aplicarPermisos() {
    const permisosTabs = {
        'ver_tab_reservas': 'btn-reservas',
        'ver_tab_mapa': 'btn-mapa',
        'ver_tab_clientes': 'btn-clientes',
        'ver_tab_pasajeros': 'btn-pasajeros',
        'ver_tab_moviles': 'btn-moviles',
        'ver_tab_choferes': 'btn-choferes',
        'ver_tab_sucursales': 'btn-sucursales',
        'ver_tab_zonas': 'btn-zonas',
        'ver_tab_usuarios': 'btn-usuarios'
    };

    Object.values(permisosTabs).forEach(btnId => {
        const boton = document.getElementById(btnId);
        if (boton) boton.style.display = 'none';
    });
    
    currentUserPermissions.forEach(permiso => {
        const btnId = permisosTabs[permiso];
        if (btnId) {
            const boton = document.getElementById(btnId);
            if (boton) boton.style.display = 'inline-block';
        }
    });
}


async function openReservaModal() {
    const modal = document.getElementById('crearReservaModal');
    if (!modal) {
        alert("Error: No se encontró el modal para crear reservas (id='crearReservaModal'). Revisa tu archivo HTML.");
        return;
    }
    populateAllSelects();
    modal.style.display = 'block';
    
    const mapContainer = document.getElementById('crearReservaMapContainer');
    if (!mapContainer) {
        console.error("El contenedor del mapa 'crearReservaMapContainer' no se encontró en el HTML del modal de nueva reserva.");
        return;
    }
    mapContainer.style.display = 'block';

    setTimeout(async () => {
        try {
            const { Map } = await google.maps.importLibrary("maps");
            const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
            const initialCoords = { lat: -32.95, lng: -60.65 };
            
            if (!newReservaMap) {
                newReservaMap = new Map(mapContainer, { center: initialCoords, zoom: 13, mapId: 'NEW_RESERVA_MAP' });
            }
            
            google.maps.event.trigger(newReservaMap, 'resize');
            newReservaMap.setCenter(initialCoords);

            if (newReservaMarker) newReservaMarker.setMap(null);
            newReservaMarker = new AdvancedMarkerElement({ map: newReservaMap, position: initialCoords, gmpDraggable: true, title: "Arrastra para fijar la ubicación" });

            const form = document.getElementById('crearReservaForm');
            const latInput = form.querySelector('[name="origen_lat"]') || document.createElement('input');
            latInput.type = 'hidden';
            latInput.name = 'origen_lat';
            latInput.value = initialCoords.lat;
            form.appendChild(latInput);

            const lngInput = form.querySelector('[name="origen_lng"]') || document.createElement('input');
            lngInput.type = 'hidden';
            lngInput.name = 'origen_lng';
            lngInput.value = initialCoords.lng;
            form.appendChild(lngInput);
            
            google.maps.event.clearListeners(newReservaMarker, 'dragend');
            newReservaMarker.addListener('dragend', (event) => {
                const newPosition = event.latLng.toJSON();
                latInput.value = newPosition.lat;
                lngInput.value = newPosition.lng;
            });
            
            setupAutocomplete(false);
        } catch(e) {
            console.error("Error al cargar el mapa de nueva reserva:", e);
            mapContainer.innerHTML = "No se pudo cargar el mapa. Verifique la API Key y que las librerías 'maps' y 'marker' estén habilitadas.";
        }
    }, 200);
}

// ===========================================================================
// LÓGICA DE PASAJEROS Y USUARIOS
// ===========================================================================
async function handleCrearPasajero(e) {
    e.preventDefault();
    const form = e.target;
    const dni = form.dni.value.trim();
    if (!dni) {
        alert("El DNI es obligatorio.");
        return;
    }
    const datos = {
        apellido_y_nombre: form.apellido_y_nombre.value,
        telefono: form.telefono.value,
        domicilio: form.domicilio.value
    };
    await crearElemento('pasajeros', datos, 'mensajePasajero', form, dni);
}

async function handleCrearUsuario(e) {
    e.preventDefault();
    const form = e.target;
    const mensajeUsuario = document.getElementById('mensajeUsuario');
    
    const nombre = form.nombre.value;
    const email = form.email.value;
    const password = form.password.value;
    
    const permisosSeleccionados = [];
    form.querySelectorAll('input[name="permisos"]:checked').forEach(checkbox => {
        permisosSeleccionados.push(checkbox.value);
    });

    if (!nombre || !email || !password) {
        mensajeUsuario.textContent = 'Nombre, email y contraseña son obligatorios.';
        return;
    }

    mensajeUsuario.textContent = 'Creando usuario...';

    try {
        const createUser = httpsCallable(functions, 'createUserWithPermissions');
        const result = await createUser({
            nombre: nombre,
            email: email,
            password: password,
            permisos: permisosSeleccionados
        });

        if (result.data.success) {
            mensajeUsuario.textContent = '¡Usuario creado con éxito!';
            form.reset();
            setTimeout(() => {
                mensajeUsuario.textContent = '';
                toggleForm('crearUsuarioContainer');
            }, 2000);
        } else {
            throw new Error(result.data.message || 'Ocurrió un error desconocido.');
        }
    } catch (error) {
        console.error("Error al crear usuario:", error);
        mensajeUsuario.textContent = `Error: ${error.message}`;
    }
}


async function handleDniAutofill(event) {
    const dni = event.target.value.trim();
    const form = document.getElementById('crearReservaForm');
    if (dni.length < 7) return;
    try {
        const docSnap = await getDoc(doc(db, 'pasajeros', dni));
        if (docSnap.exists()) {
            const data = docSnap.data();
            form.apellido_y_nombre.value = data.apellido_y_nombre || '';
            form.telefono.value = data.telefono || '';
            if (form.direccion_origen) form.direccion_origen.value = data.domicilio || '';
        }
    } catch (e) { console.error("Error buscando pasajero por DNI: ", e); }
}

async function guardarPasajeroFrecuente(dni, data) {
    if (!dni || !data.apellido_y_nombre) return;
    const pasajeroRef = doc(db, 'pasajeros', dni);
    try {
        await setDoc(pasajeroRef, {
            apellido_y_nombre: data.apellido_y_nombre,
            telefono: data.telefono,
            domicilio: data.direccion_origen,
            ultima_actualizacion: serverTimestamp()
        }, { merge: true });
    } catch (error) { console.error("Error al guardar pasajero frecuente:", error); }
}

// ===========================================================================
// FUNCIONES CRUD GENÉRICAS
// ===========================================================================
async function handleCrearReserva(e) {
    e.preventDefault();
    const form = e.target;
    const mensajeReserva = document.getElementById('mensajeReserva');
    if (!form.fecha.value || !form.hora.value) {
        alert('La Fecha y la Hora del Turno son obligatorios.');
        return;
    }
    try {
        const reservaData = {
            n_siniestro: form.n_siniestro.value,
            n_autorizacion: form.n_autorizacion.value,
            cliente: form.cliente.value,
            apellido_y_nombre: form.apellido_y_nombre.value,
            dni: form.dni.value,
            telefono: form.telefono.value,
            fecha: form.fecha.value,
            hora: form.hora.value,
            hora_pickup: form.hora_pickup.value,
            direccion_origen: form.direccion_origen.value,
            direccion_destino: form.direccion_destino.value,
            zona: form.zona.value,
            base: form.base.value,
            chofer_asignado_id: form.chofer_asignado_id.value || null,
            observaciones: form.observaciones.value,
            estado: 'AGENDADO',
            cantidad_pasajeros: 1,
            timestamp_creacion: serverTimestamp(),
            creadoPor: auth.currentUser.email
        };
        if(form.origen_lat.value && form.origen_lng.value){
            reservaData.origen_coords = new GeoPoint(parseFloat(form.origen_lat.value), parseFloat(form.origen_lng.value));
        }

        await addDoc(collection(db, 'reservas'), reservaData);
        if (form.guardar_pasajero.checked && form.dni.value.trim()) {
            await guardarPasajeroFrecuente(form.dni.value.trim(), reservaData);
        }
        mensajeReserva.textContent = 'Reserva creada con éxito.';
        form.reset();
        setTimeout(() => {
            closeModal('crearReservaModal');
            mensajeReserva.textContent = '';
        }, 1500);
    } catch (error) {
        mensajeReserva.textContent = `Error: ${error.message}`;
        console.error("Error al crear reserva:", error);
    }
}

async function crearElemento(coleccionName, datos, idMensaje, form, docId = null) {
    const elementoMensaje = document.getElementById(idMensaje);
    try {
        const collectionRef = collection(db, coleccionName);
        if (docId) {
            await setDoc(doc(collectionRef, docId), datos, { merge: true });
        } else {
            await addDoc(collectionRef, datos);
        }
        elementoMensaje.textContent = `Agregado con éxito.`;
        form.reset();
        setTimeout(() => elementoMensaje.textContent = '', 2000);
    } catch (error) {
        elementoMensaje.textContent = `Error: ${error.message}`;
    }
}

async function handleEditFormSubmit(event) {
    event.preventDefault();
    const modalForm = event.target;
    const collectionName = modalForm.getAttribute('data-collection');
    const id = modalForm.getAttribute('data-id');
    if (!collectionName || !id) return;

    try {
        const updatedData = {};
        const formData = new FormData(modalForm);
        for (let [key, value] of formData.entries()) {
             if (key === 'origen_lat' && value) {
                const lng = formData.get('origen_lng');
                updatedData['origen_coords'] = new GeoPoint(parseFloat(value), parseFloat(lng));
            } else if (key === 'destino_lat' && value) {
                const lng = formData.get('destino_lng');
                updatedData['destino_coords'] = new GeoPoint(parseFloat(value), parseFloat(lng));
            } else if (!key.endsWith('_lat') && !key.endsWith('_lng')) {
                updatedData[key] = value;
            }
        }
         if (collectionName === 'reservas') {
            if (updatedData.hora_pickup && updatedData.hora && updatedData.hora_pickup < updatedData.hora) {
                alert("Error: La hora de Pick Up no puede ser anterior a la hora del turno.");
                return;
            }
            const checkExclusivo = document.getElementById('edit_checkExclusivo');
            const checkAcompanante = document.getElementById('edit_checkAcompanante');
            const selectAcompanantes = document.getElementById('edit_selectAcompanantes');
            let cantidad_pasajeros = 1;
            if (checkExclusivo && checkExclusivo.checked) {
                cantidad_pasajeros = 4;
            } else if (checkAcompanante && checkAcompanante.checked && selectAcompanantes) {
                cantidad_pasajeros = 1 + parseInt(selectAcompanantes.value, 10);
            }
            updatedData.cantidad_pasajeros = cantidad_pasajeros;
        }
        await updateDoc(doc(db, collectionName, id), updatedData);
        alert('Cambios guardados con éxito.');
        closeModal('editModal');
    } catch (error) {
        console.error("Error al actualizar:", error);
        alert("Error al guardar los cambios: " + error.message);
    }
}

// ===========================================================================
// INICIALIZACIÓN DE GOOGLE MAPS Y OTRAS FUNCIONES
// ===========================================================================
window.initMap = async function() {
    console.log("Google Maps API cargada.");
    try {
        const { Map } = await google.maps.importLibrary("maps");
        if (document.getElementById("map-container")) {
            map = new Map(document.getElementById("map-container"), {
                center: { lat: -32.959053, lng: -60.657232 },
                zoom: 12,
                mapId: 'CENTRAL_RESERVAS_MAP'
            });
            infoWindow = new google.maps.InfoWindow();
        }
    } catch (error) {
        console.error("Error al inicializar Google Maps:", error);
        alert("No se pudo cargar el mapa. Verifica la clave de API y la conexión.");
    }
};

function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) {
        alert("Por favor, ingresa correo y contraseña.");
        return;
    }
    signInWithEmailAndPassword(auth, email, password)
        .catch(error => alert("Error al iniciar sesión: " + error.message));
}

// --- FUNCIÓN DE REGISTRO SIMPLIFICADA ---
function handleRegistration(e) {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const registerMessage = document.getElementById('register-message');

    registerMessage.textContent = 'Registrando...';

    // Solo crea el usuario en Authentication. La Cloud Function se encargará del resto.
    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            registerMessage.textContent = '¡Registro exitoso! Ahora puedes iniciar sesión.';
            document.getElementById('register-form').reset();
            // No cerramos sesión, dejamos que el usuario entre directamente.
        })
        .catch(error => {
            registerMessage.textContent = 'Error al registrar: ' + error.message;
            alert('Error al registrar: ' + error.message);
        });
}


function formatearFecha(fechaString) {
    if (!fechaString || !/^\d{4}-\d{2}-\d{2}$/.test(fechaString)) return fechaString || '';
    const [year, month, day] = fechaString.split('-');
    return `${day}/${month}/${year.slice(-2)}`;
}

function toggleKebabMenu(event) {
    event.stopPropagation();
    document.querySelectorAll('.kebab-dropdown.show').forEach(openDropdown => {
        if (openDropdown !== event.target.nextElementSibling) {
            openDropdown.classList.remove('show');
        }
    });
    event.target.nextElementSibling.classList.toggle('show');
}

function closeContextMenu() {
    const existingMenu = document.getElementById('map-context-menu');
    if (existingMenu) existingMenu.remove();
}

function abrirModalAsignacion(reservaId) {
    const modal = document.getElementById('asignarChoferModal');
    if (!modal) {
        alert("Error: No se encontró el modal para asignar chofer (id='asignarChoferModal'). Revisa tu archivo HTML.");
        return;
    }
    const form = document.getElementById('asignarChoferForm');
    const select = document.getElementById('asignarChoferSelect');
    
    form.dataset.reservaId = reservaId;
    select.innerHTML = '<option value="">Seleccionar chofer...</option>';
    
    let choferesOrdenados = [...listaDeChoferesCache].sort((a, b) => {
        const movilA = listaDeMovilesCache.find(m => m.id === a.movil_actual_id);
        const movilB = listaDeMovilesCache.find(m => m.id === b.movil_actual_id);
        const numMovilA = movilA ? parseInt(movilA.numero, 10) : Infinity;
        const numMovilB = movilB ? parseInt(movilB.numero, 10) : Infinity;
        if (numMovilA !== numMovilB) return numMovilA - numMovilB;
        return a.nombre.localeCompare(b.nombre);
    });

    choferesOrdenados.forEach(chofer => {
        const movilAsignado = listaDeMovilesCache.find(m => m.id === chofer.movil_actual_id);
        const textoOpcion = movilAsignado 
            ? `Móvil #${movilAsignado.numero} (${chofer.nombre})`
            : `${chofer.nombre} (Sin móvil asignado)`;
        select.innerHTML += `<option value="${chofer.id}">${textoOpcion}</option>`;
    });
    
    modal.style.display = 'block';
}

async function handleAsignarChoferSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const reservaId = form.dataset.reservaId;
    const choferId = document.getElementById('asignarChoferSelect').value;
    const mensajeAsignacion = document.getElementById('mensajeAsignacion');

    if (!reservaId || !choferId) {
        mensajeAsignacion.textContent = 'Error: No se seleccionó reserva o chofer.';
        return;
    }

    mensajeAsignacion.textContent = 'Asignando...';
    try {
        await asignarChofer(reservaId, choferId);
        mensajeAsignacion.textContent = 'Chofer asignado con éxito.';
        setTimeout(() => {
            closeModal('asignarChoferModal');
            mensajeAsignacion.textContent = '';
        }, 1500);
    } catch (error) {
        mensajeAsignacion.textContent = `Error: ${error.message}`;
    }
}

function setupAutocomplete(isEdit = false) {
    if (typeof google === 'undefined' || typeof google.maps.places === 'undefined') {
        console.error("La librería 'places' de Google Maps no está cargada. Asegúrate de incluir '&libraries=places,marker' en la URL del script de la API de Google Maps en tu archivo HTML.");
        return;
    }

    const suffix = isEdit ? 'edit_' : '';
    const origenInput = document.getElementById(`${suffix}direccion_origen_input`);
    const destinoInput = document.getElementById(`${suffix}direccion_destino_input`);

    if (!origenInput) return;

    const options = {
        componentRestrictions: {
            country: "ar"
        },
        fields: ["formatted_address", "geometry", "name"],
        strictBounds: false
    };
    new google.maps.places.Autocomplete(origenInput, options);
    if (destinoInput) new google.maps.places.Autocomplete(destinoInput, options);
}

function setupPasajerosLogic(acompananteCheckId, selectContainerId, exclusivoCheckId) {
    const checkAcompanante = document.getElementById(acompananteCheckId);
    const selectContainer = document.getElementById(selectContainerId);
    const checkExclusivo = document.getElementById(exclusivoCheckId);

    if (!checkAcompanante || !selectContainer || !checkExclusivo) return;

    const updateControls = (changedElement) => {
        if (changedElement === 'acompanante') {
            selectContainer.style.display = checkAcompanante.checked ? 'block' : 'none';
            if (checkAcompanante.checked) {
                checkExclusivo.checked = false;
                checkExclusivo.disabled = true;
            } else {
                checkExclusivo.disabled = false;
            }
        } else if (changedElement === 'exclusivo') {
            if (checkExclusivo.checked) {
                checkAcompanante.checked = false;
                checkAcompanante.disabled = true;
                selectContainer.style.display = 'none';
            } else {
                checkAcompanante.disabled = false;
            }
        }
    };
    checkAcompanante.addEventListener('change', () => updateControls('acompanante'));
    checkExclusivo.addEventListener('change', () => updateControls('exclusivo'));
}

async function drawMarkersOnMap(type) {
    if (!map) return;

    currentMarkers.forEach(marker => marker.setMap(null));
    currentMarkers = [];
    if (destinationMarker) {
        destinationMarker.setMap(null);
        destinationMarker = null;
    }

    let dataCache;
    if (type === 'pendientes') dataCache = docsPendientesCache;
    else if (type === 'reservas-para-asignar') dataCache = docsParaAsignarCache;
    else if (type === 'asignados') dataCache = docsAsignadosCache;
    else return;

    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    const colores = {
        origen: '#F54927',
        destino: '#27B7F5',
        asignado: '#27F568'
    };

    dataCache.forEach(reserva => {
        if (reserva.origen_coords && reserva.origen_coords.latitude) {
            let colorMarcador, textoMarcador;
            if (type === 'asignados' && reserva.chofer_asignado_id) {
                const chofer = listaDeChoferesCache.find(c => c.id === reserva.chofer_asignado_id);
                const movil = chofer ? listaDeMovilesCache.find(m => m.id === chofer.movil_actual_id) : null;
                textoMarcador = movil ? movil.numero : 'Asig';
                colorMarcador = colores.asignado;
            } else {
                colorMarcador = colores.origen;
                textoMarcador = reserva.hora ? reserva.hora.substring(0, 5) : '??';
            }
            const markerElement = document.createElement('div');
            markerElement.className = 'custom-marker';
            markerElement.style.backgroundColor = colorMarcador;
            const textElement = document.createElement('span');
            textElement.className = 'marker-text';
            textElement.textContent = textoMarcador;
            markerElement.appendChild(textElement);
            const origenMarker = new AdvancedMarkerElement({
                position: {
                    lat: reserva.origen_coords.latitude,
                    lng: reserva.origen_coords.longitude
                },
                map: map,
                content: markerElement,
                title: `Origen Reserva #${reserva.contador_viaje}`
            });
            currentMarkers.push(origenMarker);

            origenMarker.addListener('click', async () => {
                if (destinationMarker) {
                    destinationMarker.setMap(null);
                    destinationMarker = null;
                }

                if (reserva.destino_coords && reserva.destino_coords.latitude) {
                    const destMarkerElement = document.createElement('div');
                    destMarkerElement.className = 'custom-marker';
                    destMarkerElement.style.backgroundColor = colores.destino;
                    const destTextElement = document.createElement('span');
                    destTextElement.className = 'marker-text';
                    destTextElement.textContent = 'Dest';
                    destMarkerElement.appendChild(destTextElement);
                    
                    destinationMarker = new AdvancedMarkerElement({
                        position: {
                            lat: reserva.destino_coords.latitude,
                            lng: reserva.destino_coords.longitude
                        },
                        map: map,
                        content: destMarkerElement,
                        title: `Destino Reserva #${reserva.contador_viaje}`
                    });
                }

                let asignadoTexto = 'Ninguno';
                if (reserva.chofer_asignado_id) {
                    const chofer = listaDeChoferesCache.find(c => c.id === reserva.chofer_asignado_id);
                    if (chofer) {
                        const movil = listaDeMovilesCache.find(m => m.id === chofer.movil_actual_id);
                        const movilNum = movil ? `Móvil #${movil.numero}` : 'Sin móvil';
                        asignadoTexto = `${chofer.nombre} (${movilNum})`;
                    }
                }
                const domicilioOrigen = reserva.direccion_origen || `${reserva.calle_origen || ''} ${reserva.numero_origen || ''}`;
                const domicilioDestino = reserva.direccion_destino || `${reserva.calle_destino || ''} ${reserva.numero_destino || ''}`;
                const contentString = `<div class="map-infowindow-content">
                    <h4>Reserva #${reserva.contador_viaje || 'N/A'}</h4>
                    <p><strong>Autorización:</strong> ${reserva.n_autorizacion || '-'}</p>
                    <p><strong>Siniestro:</strong> ${reserva.n_siniestro || '-'}</p>
                    <p><strong>Cliente:</strong> ${reserva.cliente || 'N/A'}</p>
                    <p><strong>Pasajero:</strong> ${reserva.apellido_y_nombre || 'N/A'}</p>
                    <p><strong>Origen:</strong> ${domicilioOrigen}</p>
                    <p><strong>Destino:</strong> ${domicilioDestino}</p>
                    <p><strong>Turno:</strong> ${formatearFecha(reserva.fecha)} ${reserva.hora}</p>
                    <p><strong>Asignado a:</strong> ${asignadoTexto}</p>
                </div>`;
                infoWindow.setContent(contentString);
                infoWindow.open(map, origenMarker);
            });

            origenMarker.content.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                closeContextMenu();

                const contextMenu = document.createElement('div');
                contextMenu.className = 'map-context-menu';
                contextMenu.id = 'map-context-menu';

                let menuItems = `<a href="#" onclick="window.editarElemento('reservas', '${reserva.id}'); window.closeContextMenu();">✏️ Editar</a>`;
                if (!['FINALIZADO', 'CANCELADO', 'ANULADO', 'NEGATIVO', 'DESPACHADO'].includes(reserva.estado)) {
                    if (reserva.chofer_asignado_id) {
                        menuItems += `<a href="#" class="danger" onclick="window.marcarComoNegativo('${reserva.id}'); window.closeContextMenu();">⚠️ Traslado Negativo</a>`;
                        menuItems += `<a href="#" onclick="window.abrirModalAsignacion('${reserva.id}'); window.closeContextMenu();">🔄 Reasignar Chofer</a>`;
                        menuItems += `<a href="#" onclick="window.devolverAAgendado('${reserva.id}'); window.closeContextMenu();">↪️ Quitar Chofer</a>`;
                    } else {
                        menuItems += `<a href="#" onclick="window.abrirModalAsignacion('${reserva.id}'); window.closeContextMenu();">👤 Asignar Chofer</a>`;
                    }
                    menuItems += `<a href="#" class="danger" onclick="window.eliminarElemento('reservas', '${reserva.id}'); window.closeContextMenu();">❌ Anular</a>`;
                }

                contextMenu.innerHTML = menuItems;
                document.body.appendChild(contextMenu);

                contextMenu.style.left = `${e.clientX}px`;
                contextMenu.style.top = `${e.clientY}px`;
            });
        }
    });
}

function toggleForm(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const isHidden = container.style.display === 'none' || container.style.display === '';
        container.style.display = isHidden ? 'block' : 'none';
    }
}

function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none");
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active'));
    const tabElement = document.getElementById(tabName);
    const buttonElement = document.getElementById(`btn-${tabName}`);
    if (tabElement) tabElement.style.display = "block";
    if (buttonElement) buttonElement.classList.add('active');
    if (tabName === 'mapa') {
        if (typeof google !== 'undefined' && map) {
            setTimeout(() => {
                google.maps.event.trigger(map, 'resize');
                const btnEnCurso = document.getElementById('btn-map-en-curso');
                if (btnEnCurso) btnEnCurso.click();
            }, 100);
        }
    }
}

function mostrarReservas(tabName) {
    document.querySelectorAll('.reservas-container').forEach(container => container.style.display = 'none');
    document.querySelectorAll('.reservas-nav .sub-tab-btn').forEach(btn => btn.classList.remove('active'));

    const containerIdMap = {
        'reservas-para-asignar': 'reservasParaAsignarContainer',
        'pendientes': 'reservasPendientesContainer',
        'asignados': 'reservasAsignadasContainer',
        'historicas': 'reservasHistoricasContainer'
    };
    const activeContainer = document.getElementById(containerIdMap[tabName]);
    if (activeContainer) activeContainer.style.display = 'block';

    const activeButton = document.querySelector(`.sub-tab-btn[data-tab="${tabName}"]`);
    if (activeButton) activeButton.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
    const editMapContainer = document.getElementById('editMapContainer');
    if (editMapContainer && modalId === 'editModal') {
        editMapContainer.style.display = 'none';
    }
    const newReservaMapContainer = document.getElementById('crearReservaMapContainer');
    if (newReservaMapContainer && modalId === 'crearReservaModal') {
        newReservaMapContainer.style.display = 'none';
    }
}

function populateSelectWithOptions(selectElement, items, type, selectedValue) {
    const select = (typeof selectElement === 'string') ? document.getElementById(selectElement) : selectElement;
    if (!select) return;

    const configs = {
        clientes: { default: '<option value="">Seleccionar Cliente</option>', getValue: d => d.nombre, getText: d => d.nombre },
        moviles: { default: '<option value="">(Ninguno)</option>', getValue: d => d.id, getText: d => `Móvil #${d.numero} (${d.patente})` },
        choferes: { default: '<option value="">Asignar después...</option>', getValue: d => d.id, getText: d => d.nombre },
        zonas: { default: '<option value="">Seleccionar Zona</option>', getValue: d => d.nombre, getText: d => `${d.numero} - ${d.nombre}` },
        sucursales: { default: '<option value="">Seleccionar Base</option>', getValue: d => d.nombre, getText: d => `${d.numero} - ${d.nombre}` }
    };

    const config = configs[type];
    if (!config) return;
    
    const currentValue = select.value;
    select.innerHTML = config.default;

    items.forEach(item => {
        if (!item) return;
        select.innerHTML += `<option value="${config.getValue(item)}">${config.getText(item)}</option>`;
    });

    if (selectedValue) {
        select.value = selectedValue;
    } else {
        select.value = currentValue;
    }
}

function distribuirYRenderizarReservas(reservas) {
    docsPendientesCache = [], docsParaAsignarCache = [], docsAsignadosCache = [];
    let docsAsignadosTabla = [],
        docsHistoricos = [];
    const limite24hs = new Date();
    limite24hs.setHours(limite24hs.getHours() + 24);

    reservas.forEach(reserva => {
        const tieneChofer = !!reserva.chofer_asignado_id;
        const fechaHoraViaje = reserva.fecha && reserva.hora ? new Date(`${reserva.fecha}T${reserva.hora}`) : null;
        if (['FINALIZADO', 'CANCELADO', 'ANULADO', 'NEGATIVO', 'DESPACHADO'].includes(reserva.estado)) {
            docsHistoricos.push(reserva);
        } else if (tieneChofer) {
            docsAsignadosTabla.push(reserva);
            docsAsignadosCache.push(reserva);
        } else if (fechaHoraViaje && fechaHoraViaje > limite24hs) {
            docsPendientesCache.push(reserva);
        } else {
            docsParaAsignarCache.push(reserva);
        }
    });

    const sortLogic = (a, b) => {
        const timeA = a.hora_pickup || a.hora;
        const timeB = b.hora_pickup || b.hora;
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA.localeCompare(timeB);
    };

    renderizarTablaReservas('tabla-pendientes', docsPendientesCache.sort(sortLogic));
    renderizarTablaReservas('tabla-reservas-para-asignar', docsParaAsignarCache.sort(sortLogic));
    renderizarTablaReservas('tabla-asignados', docsAsignadosTabla.sort(sortLogic));
    renderizarTablaReservas('tabla-historicas', docsHistoricos.sort((a, b) => (b.timestamp_creacion?.toMillis() || 0) - (a.timestamp_creacion?.toMillis() || 0)));

    if (map) drawMarkersOnMap(activeMapTab);
}

function renderizarTablaReservas(tableId, reservas) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    let html = '';
    const colspan = 14;

    if (reservas.length === 0) {
        html = `<tr><td colspan="${colspan}" style="text-align: center;">No hay reservas en esta categoría.</td></tr>`;
    } else {
        reservas.forEach(reserva => {
            const clienteNombre = reserva.cliente || 'Default';
            let filaColor = listaDeClientesCache.find(c => c.nombre === clienteNombre)?.color || '#1e1e1e';
            
            if (reserva.estado === 'NEGATIVO') {
                filaColor = '#FFF085';
            } else if (reserva.estado === 'ANULADO') {
                filaColor = '#FF6467';
            }

            const colorTexto = isColorDark(filaColor) ? '#f0f0f0' : '#000000';

            const domicilioOrigen = reserva.direccion_origen || `${reserva.calle_origen || ''} ${reserva.numero_origen || ''}`.trim();
            const domicilioDestino = reserva.direccion_destino || `${reserva.calle_destino || ''} ${reserva.numero_destino || ''}`.trim();
            const cantidadPasajeros = reserva.cantidad_pasajeros || 1;

            let menuItems = `<a href="#" onclick="window.editarElemento('reservas', '${reserva.id}')">✏️ Editar</a>`;
            if (!['FINALIZADO', 'CANCELADO', 'ANULADO', 'DESPACHADO', 'NEGATIVO'].includes(reserva.estado)) {
                if (reserva.chofer_asignado_id) {
                    menuItems += `<a href="#" class="danger" onclick="window.marcarComoNegativo('${reserva.id}')">⚠️ Traslado Negativo</a>`;
                    menuItems += `<a href="#" onclick="window.abrirModalAsignacion('${reserva.id}')">🔄 Reasignar Chofer</a>`;
                    menuItems += `<a href="#" onclick="window.devolverAAgendado('${reserva.id}')">↪️ Quitar Chofer</a>`;
                    menuItems += `<a href="#" class="success" onclick="window.finalizarReserva('${reserva.id}')">✅ Finalizar</a>`;
                } else {
                    menuItems += `<a href="#" onclick="window.abrirModalAsignacion('${reserva.id}')">👤 Asignar Chofer</a>`;
                }
                menuItems += `<a href="#" class="danger" onclick="window.eliminarElemento('reservas', '${reserva.id}')">❌ Anular</a>`;
            } else {
                menuItems += `<a href="#" class="info" onclick="window.redespacharReserva('${reserva.id}')">🔄 Reactivar</a>`;
            }
            const accionesHtml = `<div class="kebab-menu"><button class="kebab-btn" onclick="window.toggleKebabMenu(event)">⋮</button><div class="kebab-dropdown">${menuItems}</div></div>`;

            let pickupHtml = `<input type="time" value="${reserva.hora_pickup || ''}" onchange="window.actualizarHoraPickup(event, '${reserva.id}')">`;

            let zonasOptions = '<option value="">-</option>';
            if (listaDeZonasCache) {
                zonasOptions += listaDeZonasCache.map(z => `<option value="${z.nombre}" ${reserva.zona === z.nombre ? 'selected' : ''}>${z.numero} - ${z.nombre}</option>`).join('');
            }
            const zonaHtml = `<select onchange="window.actualizarCampoReserva('${reserva.id}', 'zona', this.value)">${zonasOptions}</select>`;

            let basesOptions = '<option value="">-</option>';
            if (listaDeSucursalesCache) {
                basesOptions += listaDeSucursalesCache.map(s => `<option value="${s.nombre}" ${reserva.base === s.nombre ? 'selected' : ''}>${s.numero} - ${s.nombre}</option>`).join('');
            }
            const baseHtml = `<select onchange="window.actualizarCampoReserva('${reserva.id}', 'base', this.value)">${basesOptions}</select>`;
            
            let estadoCellHtml = reserva.estado || 'AGENDADO';
            if (tableId === 'tabla-asignados' && reserva.chofer_asignado_id) {
                const chofer = listaDeChoferesCache.find(c => c.id === reserva.chofer_asignado_id);
                estadoCellHtml = chofer ? chofer.nombre : 'Asignado';
            }

            html += `<tr style="background-color:${filaColor}; color:${colorTexto};">
                <td>${reserva.n_autorizacion || '-'}</td>
                <td>${reserva.n_siniestro || '-'}</td>
                <td>${formatearFecha(reserva.fecha)}</td>
                <td>${reserva.hora || '--:--'}</td>
                <td>${pickupHtml}</td>
                <td>${clienteNombre}</td>
                <td>${domicilioOrigen}</td>
                <td>${domicilioDestino}</td>
                <td>${reserva.telefono || '-'}</td>
                <td>${reserva.apellido_y_nombre || ''}</td>
                <td>${cantidadPasajeros}</td>
                <td>${zonaHtml}</td>
                <td>${estadoCellHtml}</td>
                <td>${accionesHtml}</td>
            </tr>`;
        });
    }
    tbody.innerHTML = html;
}

async function marcarComoNegativo(reservaId) {
    if (confirm('¿Estás seguro de que quieres marcar este traslado como NEGATIVO? Se moverá al historial.')) {
        try {
            await updateDoc(doc(db, 'reservas', reservaId), {
                estado: 'NEGATIVO'
            });
        } catch (error) {
            console.error(`Error al marcar como negativo la reserva ${reservaId}:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

async function actualizarCampoReserva(reservaId, campo, valor) {
    if (!reservaId || !campo) return;
    const updateData = {};
    updateData[campo] = valor;
    try {
        await updateDoc(doc(db, 'reservas', reservaId), updateData);
    } catch (error) {
        console.error(`Error al actualizar ${campo} para la reserva ${reservaId}:`, error);
        alert(`No se pudo actualizar el campo: ${error.message}`);
    }
}


function isColorDark(hexcolor) {
    if (!hexcolor || hexcolor.length < 4) return false;
    let color = (hexcolor.charAt(0) === '#') ? hexcolor.substring(1) : hexcolor;
    if (color.length === 3) color = color.split('').map(char => char + char).join('');
    const r = parseInt(color.substring(0, 2), 16),
        g = parseInt(color.substring(2, 4), 16),
        b = parseInt(color.substring(4, 6), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 128;
}

function renderizarLista(collectionName, containerId, fields, headers) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let dataCache = [];
    switch (collectionName) {
        case 'clientes': dataCache = listaDeClientesCache; break;
        case 'moviles': dataCache = listaDeMovilesCache; break;
        case 'choferes': dataCache = listaDeChoferesCache; break;
        case 'pasajeros': dataCache = listaDePasajerosCache; break;
        case 'sucursales': dataCache = listaDeSucursalesCache; break;
        case 'zonas': dataCache = listaDeZonasCache; break;
        case 'users': dataCache = listaDeUsuariosCache; break;
        default: return;
    }

    let tableHTML = `<h3>Lista de ${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)}</h3><div class="table-responsive"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}<th>Acciones</th></tr></thead><tbody>`;
    if (!dataCache || dataCache.length === 0) {
        tableHTML += `<tr><td colspan="${headers.length + 1}">No hay registros.</td></tr>`;
    } else {
        dataCache.forEach(item => {
            let row = '<tr>';
            fields.forEach(field => {
                let cellValue = item[field] || '-';
                if (field === 'color') {
                    cellValue = `<span style="display: inline-block; width: 60px; height: 20px; background-color: ${cellValue}; border: 1px solid #555; border-radius: 4px;"></span>`;
                } else if (field === 'movil_actual_id' && cellValue !== '-') {
                    const movil = listaDeMovilesCache.find(m => m.id === cellValue);
                    cellValue = movil ? `Móvil #${movil.numero}` : 'Desconocido';
                }
                row += `<td>${cellValue}</td>`;
            });
            let actionButtons = `<button onclick="window.editarElemento('${collectionName}', '${item.id}')">Editar</button>`;
            actionButtons += `<button class="btn-danger" onclick="window.eliminarElemento('${collectionName}', '${item.id}')">Eliminar</button>`;
            row += `<td>${actionButtons}</td></tr>`;
        });
    }
    tableHTML += '</tbody></table></div>';
    container.innerHTML = tableHTML;
}

// --- MANEJO DE FORMULARIOS DE CREACIÓN (NO RESERVAS) ---

async function handleCrearMovil(e) {
    e.preventDefault();
    const datos = {
        numero: e.target.numero.value,
        patente: e.target.patente.value,
        marca: e.target.marca.value,
        modelo: e.target.modelo.value,
        capacidad_pasajeros: e.target.capacidad_pasajeros.value,
        titular: e.target.titular.value,
        domicilio_titular: e.target.domicilio_titular.value,
        dni_titular: e.target.dni_titular.value,
        aseguradora: e.target.aseguradora.value,
        poliza: e.target.poliza.value
    };
    await crearElemento('moviles', datos, 'mensajeMovil', e.target);
}

async function handleCrearChofer(e) {
    e.preventDefault();
    const datos = {
        nombre: e.target.nombre.value,
        dni: e.target.dni.value,
        telefono: e.target.telefono.value,
        licencia: e.target.licencia.value,
        domicilio: e.target.domicilio.value,
        telegram_chat_id: e.target.telegram_chat_id.value,
        movil_actual_id: e.target.movil_actual_id.value || null
    };
    await crearElemento('choferes', datos, 'mensajeChofer', e.target);
}
async function handleCrearCliente(e) {
    e.preventDefault();
    const datos = {
        nombre: e.target.nombre.value,
        cuit: e.target.cuit.value,
        color: e.target.color.value
    };
    await crearElemento('clientes', datos, 'mensajeCliente', e.target);
}
async function handleCrearSucursal(e) {
    e.preventDefault();
    const datos = {
        numero: parseInt(e.target.numero.value),
        nombre: e.target.nombre.value
    };
    await crearElemento('sucursales', datos, 'mensajeSucursal', e.target);
}
async function handleCrearZona(e) {
    e.preventDefault();
    const datos = {
        numero: parseInt(e.target.numero.value),
        nombre: e.target.nombre.value
    };
    await crearElemento('zonas', datos, 'mensajeZona', e.target);
}

async function editarElemento(collectionName, id) {
    const editModal = document.getElementById('editModal');
    if (!editModal) {
        alert("Error: No se encontró el modal de edición (id='editModal'). Revisa tu archivo HTML.");
        return;
    }

    const docSnap = await getDoc(doc(db, collectionName, id));
    if (!docSnap.exists()) {
        console.error("Documento no encontrado");
        return;
    }
    const data = docSnap.data();
    const modalForm = document.getElementById('editForm');
    modalForm.innerHTML = '';
    modalForm.setAttribute('data-collection', collectionName);
    modalForm.setAttribute('data-id', id);

    if (collectionName === 'reservas') {
        const formHtml = `
            <div class="edit-layout">
                <div class="form-column">
                    <div class="form-row">
                        <div class="form-group"><label>Cliente</label><select name="cliente" id="edit_cliente"></select></div>
                        <div class="form-group"><label>Nº Autorización</label><input type="text" name="n_autorizacion" value="${data.n_autorizacion || ''}"></div>
                        <div class="form-group"><label>Nº Siniestro</label><input type="text" name="n_siniestro" value="${data.n_siniestro || ''}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Apellido y Nombre</label><input type="text" name="apellido_y_nombre" value="${data.apellido_y_nombre || ''}"></div>
                        <div class="form-group"><label>DNI</label><input type="text" name="dni" value="${data.dni || ''}"></div>
                        <div class="form-group"><label>Teléfono</label><input type="text" name="telefono" value="${data.telefono || ''}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Fecha</label><input type="date" name="fecha" value="${data.fecha || ''}"></div>
                        <div class="form-group"><label>Hora Turno</label><input type="time" name="hora" value="${data.hora || ''}"></div>
                        <div class="form-group"><label>Hora Pick Up</label><input type="time" name="hora_pickup" value="${data.hora_pickup || ''}"></div>
                    </div>
                    <div class="form-group full-width"><label>Dirección de Origen</label><input type="text" name="direccion_origen" id="edit_direccion_origen_input" value="${data.direccion_origen || ''}"></div>
                    <div class="form-group full-width"><label>Dirección de Destino</label><input type="text" name="direccion_destino" id="edit_direccion_destino_input" value="${data.direccion_destino || ''}"></div>
                    <div class="form-group full-width" id="edit_pasajeros_container"></div>
                    <div class="form-row">
                         <div class="form-group"><label>Zona</label><select name="zona" id="edit_reservaZona"></select></div>
                         <div class="form-group"><label>Base</label><select name="base" id="edit_reservaBase"></select></div>
                         <div class="form-group"><label>Estado</label><select name="estado" id="edit_reservaEstado"></select></div>
                    </div>
                    <div class="form-group full-width"><label>Observaciones</label><textarea name="observaciones" rows="3">${data.observaciones || ''}</textarea></div>
                </div>
                <div class="map-column"><div id="editMapContainer" style="display:none; height: 400px; width: 100%;"></div></div>
            </div>
            <div class="form-group full-width" style="margin-top: 20px;"><button type="submit">Guardar Cambios</button></div>
        `;
        modalForm.innerHTML = formHtml;

        populateSelectWithOptions('edit_cliente', listaDeClientesCache, 'clientes', data.cliente);
        populateSelectWithOptions('edit_reservaZona', listaDeZonasCache, 'zonas', data.zona);
        populateSelectWithOptions('edit_reservaBase', listaDeSucursalesCache, 'sucursales', data.base);

        const estados = ["AGENDADO", "EN CURSO", "ASIGNADO", "FINALIZADO", "CANCELADO", "ANULADO", "NEGATIVO", "DESPACHADO"];
        const estadoSelect = document.getElementById('edit_reservaEstado');
        estados.forEach(opt => estadoSelect.innerHTML += `<option value="${opt}" ${data.estado === opt ? 'selected' : ''}>${opt}</option>`);

        const pasajerosContainer = document.getElementById('edit_pasajeros_container');
        const cantidad = data.cantidad_pasajeros || 1;
        const esExclusivo = cantidad === 4;
        const tieneAcompanantes = cantidad > 1 && cantidad < 4;
        const numAcompanantes = tieneAcompanantes ? cantidad - 1 : 1;
        pasajerosContainer.innerHTML = `<fieldset><legend>Pasajeros</legend><div class="form-row"><div class="checkbox-group"><label><input type="checkbox" id="edit_checkAcompanante" ${tieneAcompanantes ? 'checked' : ''}> Acompañante</label></div><div id="edit_acompanantes-select-container" style="display:${tieneAcompanantes ? 'block':'none'};"><label>Cant:</label><select id="edit_selectAcompanantes"><option value="1" ${numAcompanantes === 1 ? 'selected' : ''}>1</option><option value="2" ${numAcompanantes === 2 ? 'selected' : ''}>2</option><option value="3" ${numAcompanantes === 3 ? 'selected' : ''}>3</option></select></div><div class="checkbox-group"><label><input type="checkbox" id="edit_checkExclusivo" ${esExclusivo ? 'checked' : ''}> Exclusivo</label></div></div></fieldset>`;
        setupPasajerosLogic('edit_checkAcompanante', 'edit_acompanantes-select-container', 'edit_checkExclusivo');

        const editMapContainer = document.getElementById('editMapContainer');
        editMapContainer.style.display = 'block';

        setTimeout(async () => {
            try {
                const { Map } = await google.maps.importLibrary("maps");
                const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
                const coords = data.origen_coords ? { lat: data.origen_coords.latitude, lng: data.origen_coords.longitude } : { lat: -32.95, lng: -60.65 };
                
                if (!editMap) {
                    editMap = new Map(editMapContainer, { center: coords, zoom: 15, mapId: 'EDIT_MAP' });
                }
                
                google.maps.event.trigger(editMap, 'resize');
                editMap.setCenter(coords);

                if (editMarker) editMarker.setMap(null);
                editMarker = new AdvancedMarkerElement({ map: editMap, position: coords, gmpDraggable: true, title: "Arrastra para ajustar la ubicación" });

                const hiddenLat = document.createElement('input'); hiddenLat.type = 'hidden'; hiddenLat.name = 'origen_lat'; hiddenLat.value = coords.lat;
                modalForm.appendChild(hiddenLat);
                const hiddenLng = document.createElement('input'); hiddenLng.type = 'hidden'; hiddenLng.name = 'origen_lng'; hiddenLng.value = coords.lng;
                modalForm.appendChild(hiddenLng);
                
                google.maps.event.clearListeners(editMarker, 'dragend');
                editMarker.addListener('dragend', (event) => {
                    const newPosition = event.latLng.toJSON();
                    hiddenLat.value = newPosition.lat;
                    hiddenLng.value = newPosition.lng;
                });
                
                setupAutocomplete(true);
            } catch(e) {
                console.error("Error al cargar el mapa de edición:", e);
                editMapContainer.innerHTML = "No se pudo cargar el mapa.";
            }
        }, 150);
    } else {
        let fieldDefinitions = {
            clientes: ['nombre', 'cuit', 'color'],
            moviles: ['numero', 'patente', 'marca', 'modelo', 'capacidad_pasajeros'],
            choferes: ['nombre', 'dni', 'telefono', 'movil_actual_id'],
            pasajeros: ['id', 'apellido_y_nombre', 'telefono', 'domicilio'],
            users: ['nombre', 'email', 'estado']
        };
        const fields = fieldDefinitions[collectionName] || Object.keys(data);
        fields.forEach(key => {
            const groupWrapper = document.createElement('div');
            groupWrapper.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            let control;

            if (key === 'color') {
                control = document.createElement('input');
                control.type = 'color';
            } else if (key === 'movil_actual_id') {
                control = document.createElement('select');
                populateSelectWithOptions(control, listaDeMovilesCache, 'moviles', data[key]);
            } else if (key === 'estado' && collectionName === 'users') {
                control = document.createElement('select');
                control.name = 'estado';
                control.innerHTML = `<option value="activo" ${data.estado === 'activo' ? 'selected' : ''}>Activo</option>
                                     <option value="inactivo" ${data.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>`;
            } else {
                control = document.createElement('input');
                control.type = (key === 'email') ? 'email' : 'text';
                if (key === 'id') {
                    control.disabled = true;
                }
            }
            control.name = key;
            if (key === 'id') {
                control.value = id;
            } else {
                control.value = data[key] || '';
            }
            
            if(control.disabled) {
                control.name = ''; 
            }
            
            groupWrapper.appendChild(label);
            groupWrapper.appendChild(control);
            modalForm.appendChild(groupWrapper);
        });
        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.textContent = 'Guardar Cambios';
        modalForm.appendChild(saveBtn);
    }
    
    editModal.style.display = 'block';
}

async function eliminarElemento(coleccionName, id) {
    const confirmacionMsg = coleccionName === 'reservas' 
        ? '¿Estás seguro de que quieres ANULAR esta reserva?' 
        : `¿Estás seguro de que quieres ELIMINAR este elemento de ${collectionName}?`;
    if (confirm(confirmacionMsg)) {
        try {
            if (coleccionName === 'reservas') {
                await updateDoc(doc(db, 'reservas', id), { estado: 'ANULADO' });
                alert('Reserva anulada con éxito.');
            } else {
                await deleteDoc(doc(db, coleccionName, id));
                alert('Elemento eliminado con éxito.');
            }
        } catch (error) {
            console.error(`Error al eliminar/anular elemento de ${collectionName}:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

async function asignarChofer(reservaId, choferId) {
    if (!choferId || !reservaId) return;
    try {
        await updateDoc(doc(db, 'reservas', reservaId), {
            chofer_asignado_id: choferId,
            estado: 'ASIGNADO'
        });
    } catch (error) {
        console.error(`Error al asignar chofer a la reserva ${reservaId}:`, error);
        throw new Error(`Error al asignar el chofer: ${error.message}`);
    }
}

async function devolverAAgendado(reservaId) {
    if (confirm('¿Quitar la asignación de este chofer y devolver la reserva a "Para Asignar"?')) {
        try {
            await updateDoc(doc(db, 'reservas', reservaId), {
                chofer_asignado_id: deleteField(),
                estado: 'AGENDADO'
            });
        } catch (error) {
            console.error(`Error al devolver a agendado la reserva ${reservaId}:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

async function finalizarReserva(reservaId) {
    if (confirm('¿Marcar este traslado como finalizado?')) {
        try {
            await updateDoc(doc(db, 'reservas', reservaId), { estado: 'DESPACHADO' });
        } catch (error) {
            console.error(`Error al finalizar la reserva ${reservaId}:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

async function redespacharReserva(reservaId) {
    if (confirm('¿Reactivar esta reserva y moverla a "Para Asignar"?')) {
        try {
            await updateDoc(doc(db, 'reservas', reservaId), {
                estado: 'AGENDADO',
                chofer_asignado_id: null
            });
            alert('La reserva ha sido reactivada.');
        } catch (error) {
            console.error(`Error al redespachar la reserva ${reservaId}:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

async function actualizarHoraPickup(event, reservaId) {
    const nuevaHora = event.target.value;
    try {
        await updateDoc(doc(db, 'reservas', reservaId), { hora_pickup: nuevaHora });
        event.target.style.border = '1px solid #28a745';
        setTimeout(() => {
            event.target.style.border = '1px solid #555';
        }, 2000);
    } catch (error) {
        console.error(`Error al actualizar hora de pickup para la reserva ${reservaId}:`, error);
        event.target.style.border = '1px solid #dc3545';
    }
}
