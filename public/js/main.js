// js/main.js

// 1. IMPORTACIONES DE TODOS LOS MÓDulos
import { auth, db } from './firebase-config.js';
import { openTab, showReservasTab, openAdminTab } from './tabs.js';
import { initHistorial, cargarHistorial, poblarFiltroClientes } from './historial.js';
import { initPasajeros, cargarPasajeros } from './pasajeros.js';
import { initAdmin, editItem, deleteItem, openResetPasswordModal } from './admin.js';
import { initMapa, initMapInstance, initMapaModal, cargarMarcadoresDeReservas, filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer, escucharUbicacionChoferes } from './mapa.js';
import { 
    listenToReservas,
    renderAllReservas,
    buscarEnReservas,
    handleSaveReserva,
    openEditReservaModal,
    poblarSelectDeMoviles,
    asignarMovil,
    changeReservaState,
    finalizarReserva,
    quitarAsignacion,
    updateHoraPickup,
    updateZona,
    handleDniBlur
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
        
        poblarFiltroClientes(caches.clientes);
    });

    db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
        caches.choferes = [];
       snapshot.forEach(doc => caches.choferes.push({ id: doc.id, ...doc.data() }));
       actualizarFiltrosDeMoviles();
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
        actualizarFiltrosDeMoviles(); 
    });
}

function hideTableMenus() {
    document.querySelectorAll('.menu-contenido.visible').forEach(menu => {
        menu.classList.remove('visible');
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

function actualizarFiltrosDeMoviles() {
    const selectReservas = document.getElementById('filtro-chofer-asignados');
    const selectMapa = document.getElementById('filtro-chofer-mapa');
    const selects = [selectReservas, selectMapa].filter(s => s !== null);

    if (selects.length === 0) return;

    let optionsHTML = '<option value="">Ver todos los móviles</option>';
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
        optionsHTML += `<option value="${item.choferId}">${numeroMovil} - ${item.choferNombre}</option>`;
    });

    selects.forEach(select => {
        const valorSeleccionado = select.value;
        select.innerHTML = optionsHTML;
        select.value = valorSeleccionado;
    });
}

function filtrarReservasAsignadasPorChofer(choferId) {
    filtroChoferAsignadosId = choferId || null;
    if (lastReservasSnapshot) {
        renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
    }
}

function filtrarPorHoras(horas) {
    filtroHoras = horas;
    document.querySelectorAll('.time-filters .map-filter-btn').forEach(btn => btn.classList.remove('active'));
    let btnActivo;
    if (horas === null) {
        btnActivo = document.querySelector('.time-filters button:nth-child(1)');
    } else {
        btnActivo = document.querySelector(`.time-filters .map-filter-btn[onclick="window.app.filtrarPorHoras(${horas})"]`);
    }
    if (btnActivo) btnActivo.classList.add('active');
    if (lastReservasSnapshot) {
        renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
    }
}

function openNuevaReservaConDatos(datos, initMapaModalCallback) {
    const form = document.getElementById('reserva-form');
    form.reset();

    form.cliente.value = datos.cliente || 'Default';
    form.siniestro.value = datos.siniestro || '';
    form.autorizacion.value = datos.autorizacion || '';
    form.dni_pasajero.value = datos.dni_pasajero || '';
    form.nombre_pasajero.value = datos.nombre_pasajero || '';
    form.telefono_pasajero.value = datos.telefono_pasajero || '';
    form.origen.value = datos.origen || '';
    form.destino.value = datos.destino || '';

    document.getElementById('reserva-id').value = '';
    document.getElementById('modal-title').textContent = 'Nueva Reserva (Regreso)';
    document.getElementById('reserva-modal').style.display = 'block';

    if(initMapaModalCallback) {
        setTimeout(() => initMapaModalCallback(null, null), 100);
    }
}

function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    console.log("Aplicación Inicializada y Módulos Conectados");
    
    const nuevaReservaBtn = document.getElementById('btn-nueva-reserva');
    if (nuevaReservaBtn) {
        nuevaReservaBtn.addEventListener('click', () => {
            document.getElementById('reserva-form').reset();
            poblarSelectDeMoviles(caches);
            document.getElementById('modal-title').textContent = 'Nueva Reserva';
            document.getElementById('reserva-id').value = '';
            document.getElementById('reserva-modal').style.display = 'block';
            initMapaModal(null, null);
        });
    }

    const closeModal = (modalId) => { 
        const modal = document.getElementById(modalId);
        if(modal) modal.style.display = 'none';
     };
    document.querySelector('.close-btn')?.addEventListener('click', () => closeModal('reserva-modal'));
    document.querySelector('.close-edit-btn')?.addEventListener('click', () => closeModal('edit-modal'));
    document.querySelector('.close-reset-password-btn')?.addEventListener('click', () => closeModal('reset-password-modal'));

    const busquedaReservasInput = document.getElementById('busqueda-reservas');
    if (busquedaReservasInput) {
        busquedaReservasInput.addEventListener('input', (e) => {
            buscarEnReservas(e.target.value, caches);
        });
    }

    window.app = {
        editItem, deleteItem, openResetPasswordModal,
        openEditReservaModal: (reservaId) => openEditReservaModal(reservaId, caches, initMapaModal),
        asignarMovil: (reservaId, movilId) => asignarMovil(reservaId, movilId, caches),
        changeReservaState: (reservaId, newState) => changeReservaState(reservaId, newState, caches),
        finalizarReserva: (reservaId) => finalizarReserva(reservaId, caches),
        quitarAsignacion, updateHoraPickup, updateZona,
        toggleMenu,
        hideTableMenus, 
        filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer,
        filtrarReservasAsignadasPorChofer,
        filtrarPorHoras
    };
    
    window.openTab = (event, tabName) => openTab(event, tabName, { initMapInstance, escucharUbicacionChoferes, cargarMarcadoresDeReservas, cargarHistorial, cargarPasajeros });
    window.showReservasTab = showReservasTab;
    window.openAdminTab = openAdminTab;
    
    document.getElementById('reserva-form').addEventListener('submit', async (e) => {
        const datosParaRegreso = await handleSaveReserva(e, caches);
        if (datosParaRegreso) {
            openNuevaReservaConDatos(datosParaRegreso, initMapaModal);
        }
    });
    
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);

    loadAuxData();
    initHistorial(caches);
    initPasajeros();
    initAdmin(caches);
    initMapa(caches, () => lastReservasSnapshot);

    listenToReservas(snapshot => {
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot, caches, filtroChoferAsignadosId, filtroHoras);
        
        const searchResultsContainer = document.getElementById('resultados-busqueda-reservas');
        if (searchResultsContainer && searchResultsContainer.style.display === 'block') {
            const searchInput = document.getElementById('busqueda-reservas');
            if (searchInput.value) {
                console.log("Refrescando búsqueda por cambio en los datos...");
                buscarEnReservas(searchInput.value, caches);
            }
        }
       
        cargarMarcadoresDeReservas();
       
    });

    openTab(null, 'Reservas');
}