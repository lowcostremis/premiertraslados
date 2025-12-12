// js/main.js

// 1. IMPORTACIONES DE TODOS LOS MÓDULOS
import { auth, db } from './firebase-config.js';
import { openTab, showReservasTab, openAdminTab } from './tabs.js';
import { initHistorial, cargarHistorial, poblarFiltroClientes } from './historial.js';
import { initPasajeros, cargarPasajeros } from './pasajeros.js';
import { initAdmin, editItem, deleteItem, openResetPasswordModal } from './admin.js';
import { initMapa, initMapInstance, initMapaModal, cargarMarcadoresDeReservas, filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer, escucharUbicacionChoferes } from './mapa.js';
import { toggleMultiSelectMode, getSelectedReservasIds } from './mapa.js';
// Importamos asignarMultiplesReservas estáticamente para evitar problemas con import dinámico si no es necesario
import { 
    asignarMultiplesReservas,
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
// CORRECCIÓN 1: Asignación fuera del objeto
window.appCaches = caches;

let lastReservasSnapshot = null;
let appInitialized = false; 
let filtroChoferAsignadosId = null;
let filtroHoras = null;

// VARIABLES PARA SELECCIÓN MÚLTIPLE EN TABLA
window.isTableMultiSelectMode = false;
let selectedTableIds = new Set();


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

// CORRECCIÓN 2: Función auxiliar para selección múltiple integrada
function updateTablePanelVisibility() {
    const panel = document.getElementById('multi-select-panel');
    const contador = document.getElementById('contador-seleccion');
    const lista = document.getElementById('multi-select-list');
    const selectMovil = document.getElementById('multi-select-movil');
    const btnAsignar = document.getElementById('btn-assign-multi');

    if (selectedTableIds.size > 0) {
        panel.style.display = 'block';
        if(contador) contador.textContent = selectedTableIds.size;
        
        // Mostrar lista simple
        lista.innerHTML = `<li style="padding:10px">Has seleccionado ${selectedTableIds.size} viajes de la lista.</li>`;

        // Poblar select si está vacío
        if (selectMovil.options.length <= 1 && caches.moviles) {
             let opts = '<option value="">Seleccionar móvil...</option>';
             caches.moviles.forEach(m => {
                 const ch = caches.choferes.find(c => c.movil_actual_id === m.id);
                 const nm = ch ? `(${ch.nombre})` : '';
                 opts += `<option value="${m.id}">Móvil ${m.numero} ${nm}</option>`;
             });
             selectMovil.innerHTML = opts;
        }

        // Habilitamos el botón, pero NO tocamos sus eventos aquí
        btnAsignar.disabled = false;
        
    } else {
        panel.style.display = 'none';
    }
}

function toggleTableSelection(reservaId, rowElement) {
    if (selectedTableIds.has(reservaId)) {
        selectedTableIds.delete(reservaId);
        rowElement.classList.remove('selected-row');
    } else {
        selectedTableIds.add(reservaId);
        rowElement.classList.add('selected-row');
    }
    updateTablePanelVisibility();
}


function actualizarFiltrosDeMoviles() {
    const selectReservas = document.getElementById('filtro-chofer-asignados');
    const selectMapa = document.getElementById('filtro-chofer-mapa');
    const selectAdmin = document.getElementById('chofer-movil-select');

    if (selectReservas || selectMapa) {
        let optionsHTMLFiltro = '<option value="">Ver todos los móviles</option>';
        const movilesConChofer = caches.choferes
            .filter(chofer => chofer.movil_actual_id)
            .map(chofer => {
                const movilAsignado = caches.moviles.find(m => m.id === chofer.movil_actual_id);
                return movilAsignado ? { choferId: chofer.id, choferNombre: chofer.nombre, movilNumero: movilAsignado.numero } : null;
            })
            .filter(item => item !== null)
            .sort((a, b) => a.movilNumero - b.movilNumero);

        movilesConChofer.forEach(item => {
            optionsHTMLFiltro += `<option value="${item.choferId}">Móvil ${item.movilNumero} - ${item.choferNombre}</option>`;
        });

        [selectReservas, selectMapa].forEach(select => {
            if (select) {
                const valorSeleccionado = select.value;
                select.innerHTML = optionsHTMLFiltro;
                select.value = valorSeleccionado;
            }
        });
    }

    if (selectAdmin) {
        let optionsHTMLAdmin = '<option value="">(Opcional) Asignar Móvil</option>';
        caches.moviles.forEach(movil => {
            const choferAsignado = caches.choferes.find(c => c.movil_actual_id === movil.id);
            const infoChofer = choferAsignado ? `(Asignado a ${choferAsignado.nombre})` : '(Libre)';
            optionsHTMLAdmin += `<option value="${movil.id}">N° ${movil.numero} ${infoChofer}</option>`;
        });
        
        const valorSeleccionado = selectAdmin.value;
        selectAdmin.innerHTML = optionsHTMLAdmin;
        selectAdmin.value = valorSeleccionado;
    }
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

// 5. INICIALIZACIÓN CENTRAL DE LA APLICACIÓN
function initApp() {
    console.log("Intentando inicializar la aplicación en:", new Date().toLocaleTimeString());
    
    if (appInitialized) {
        console.warn("ADVERTENCIA: La aplicación ya estaba inicializada.");
        return;
    }
    appInitialized = true;
    console.log("Aplicación Inicializada y Módulos Conectados");
    // --- CÓDIGO PARA EL BOTÓN DE IMPORTAR EXCEL ---
    const btnImportar = document.getElementById('btn-importar-excel');
    const inputExcel = document.getElementById('input-excel');

    if (btnImportar && inputExcel) {
        // 1. Al hacer clic en el botón verde, abrimos el selector de archivos oculto
        btnImportar.addEventListener('click', () => {
            inputExcel.click();
        });

        // 2. Cuando el usuario elige un archivo, llamamos a la lógica de reservas.js
        inputExcel.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                console.log("Archivo detectado, iniciando importación...");
                try {
                    // Importamos la función dinámicamente
                    const { manejarImportacionExcel } = await import('./reservas.js');
                    manejarImportacionExcel(e);
                } catch (err) {
                    console.error("Error al importar el módulo:", err);
                    alert("Error al cargar el módulo de importación.");
                }
            }
        });
    }

    // --- EVENT LISTENERS DE ELEMENTOS GLOBALES ---
    document.getElementById('btn-nueva-reserva')?.addEventListener('click', () => {
        document.getElementById('reserva-form').reset();
        poblarSelectDeMoviles(caches);
        document.getElementById('modal-title').textContent = 'Nueva Reserva';
        document.getElementById('reserva-id').value = '';
        document.getElementById('reserva-modal').style.display = 'block';
        initMapaModal(null, null);
    });
    
    // CORRECCIÓN 3: Listener para activar selección múltiple en tabla (Integrado)
    document.getElementById('btn-toggle-select-table')?.addEventListener('click', function() {
        window.isTableMultiSelectMode = !window.isTableMultiSelectMode;
        const btn = this;
        
        if (window.isTableMultiSelectMode) {
            btn.textContent = 'Cancelar Selección';
            btn.classList.add('active');
            window.app.hideTableMenus(); 
        } else {
            btn.textContent = 'Activar Selección Múltiple';
            btn.classList.remove('active');
            selectedTableIds.clear();
            document.querySelectorAll('.selected-row').forEach(r => r.classList.remove('selected-row'));
            document.getElementById('multi-select-panel').style.display = 'none';
        }
    });

    const closeModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if(modal) modal.style.display = 'none';
    };
    document.querySelector('.close-btn')?.addEventListener('click', () => closeModal('reserva-modal'));
    document.querySelector('.close-edit-btn')?.addEventListener('click', () => closeModal('edit-modal'));
    document.querySelector('.close-reset-password-btn')?.addEventListener('click', () => closeModal('reset-password-modal'));
    
    document.getElementById('busqueda-reservas')?.addEventListener('input', (e) => {
        buscarEnReservas(e.target.value, caches);
    });

    // LISTENER PARA MAPA (SELECCIÓN MÚLTIPLE) - Lógica existente
    document.getElementById('btn-multi-select')?.addEventListener('click', toggleMultiSelectMode);
    
    document.getElementById('btn-cancel-multi')?.addEventListener('click', () => {
        // Comprobamos qué modo está activo para cancelar el correcto
        if (window.isTableMultiSelectMode) {
            document.getElementById('btn-toggle-select-table').click();
        } else {
            toggleMultiSelectMode(); 
        }
    });

    // LÓGICA DE ASIGNACIÓN (MAPA Y TABLA)
    document.getElementById('btn-assign-multi')?.addEventListener('click', async () => {
        const movilId = document.getElementById('multi-select-movil').value;
        
        if (!movilId) {
            alert('Por favor, selecciona un móvil para asignar.');
            return;
        }

        let reservaIds = [];
        let origenDeLaAccion = '';

        // Determinamos de dónde vienen los IDs según el modo activo
        if (window.isTableMultiSelectMode) {
            reservaIds = Array.from(selectedTableIds);
            origenDeLaAccion = 'tabla';
        } else {
            // Asumimos modo mapa
            reservaIds = window.app.getSelectedReservasIds(); 
            origenDeLaAccion = 'mapa';
        }

        if (reservaIds.length === 0) {
            alert("No hay viajes seleccionados.");
            return;
        }

        // Ejecutamos la asignación (importada de reservas.js)
        const exito = await asignarMultiplesReservas(reservaIds, movilId, caches);
        
        if (exito) {
            // Cerramos el modo correspondiente
            if (origenDeLaAccion === 'tabla') {
                document.getElementById('btn-toggle-select-table').click(); // Click para apagar modo tabla
            } else {
                toggleMultiSelectMode(); // Función importada para apagar modo mapa
            }
            // Limpiamos el selector para la próxima
            document.getElementById('multi-select-movil').value = "";
        }
    });

    // --- OBJETO GLOBAL PARA FUNCIONES ACCESIBLES DESDE HTML ---
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
        filtrarPorHoras,
        getSelectedReservasIds,
        // CORRECCIÓN 4: Agregamos la función de selección de tabla aquí
        toggleTableSelection
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

    // --- CARGA DE DATOS Y MÓDULOS ---
    loadAuxData();
    initHistorial(caches);
    initPasajeros();
    initAdmin(caches);
    initMapa(caches, () => lastReservasSnapshot);

    // --- LISTENER PRINCIPAL DE RESERVAS ---
    listenToReservas(snapshot => {
        console.log("Listener de 'reservas' activado con", snapshot.size, "documentos.");
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot, caches, filtroChoferAsignadosId, filtroHoras);
        
        const searchResultsContainer = document.getElementById('resultados-busqueda-reservas');
        if (searchResultsContainer && searchResultsContainer.style.display === 'block') {
            const searchInput = document.getElementById('busqueda-reservas');
            if (searchInput.value) {
                buscarEnReservas(searchInput.value, caches);
            }
        }
       
        cargarMarcadoresDeReservas();
    });

    openTab(null, 'Reservas');
}