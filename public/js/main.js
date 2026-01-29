import { auth, db } from './firebase-config.js';
import { openTab, showReservasTab, openAdminTab } from './tabs.js';

// --- IMPORTACIÓN UNIFICADA: HISTORIAL ---
import { 
    initHistorial, 
    cargarHistorial, 
    poblarFiltroClientes,
    abrirModalEditarHistorico, 
    guardarEdicionHistorico,
    recalcularDistanciaHistorico 
} from './historial.js';

// --- IMPORTACIÓN UNIFICADA: PASAJEROS, ADMIN Y FACTURAS ---
import { initPasajeros, cargarPasajeros } from './pasajeros.js';
import { initAdmin, editItem, deleteItem, openResetPasswordModal } from './admin.js';
import { initFacturacion, cargarFacturasEmitidas, verFactura, anularFactura, exportarExcelFactura } from './facturas.js';

// --- IMPORTACIÓN UNIFICADA: MAPA ---
import { 
    initMapa, 
    initMapInstance, 
    initMapaModal, 
    cargarMarcadoresDeReservas, 
    filtrarMapa, 
    filtrarMapaPorHoras, 
    filtrarMapaPorChofer, 
    escucharUbicacionChoferes,
    toggleMultiSelectMode, 
    getSelectedReservasIds,
    activarAutocomplete,    
    calcularYMostrarRuta,
    actualizarMarcadorMapa    
} from './mapa.js';

// --- IMPORTACIÓN UNIFICADA: RESERVAS ---
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
    handleDniBlur,
    confirmarReservaImportada,
    ejecutarAccionMasiva,
    handleConfirmarDesdeModal,
    generarInformeProductividad,
    postularChofer,
    despacharPostulados
} from './reservas.js';


// 2. ESTADO GLOBAL Y VARIABLES
let caches = {
    clientes: {},
    choferes: [],
    zonas: [],
    moviles: []
};
window.appCaches = caches;

let lastReservasSnapshot = null;
let appInitialized = false; 
let filtroChoferAsignadosId = null;
let filtroHoras = 24;

window.isTableMultiSelectMode = false;
let selectedTableIds = new Set();

window.filtroPostuladosActivo = false;


// 3. LÓGICA DE AUTENTICACIÓN
auth.onAuthStateChanged(user => {
    const authSection = document.getElementById('auth-section');
    const appContent = document.getElementById('app-content');

    if (user) {
        
        window.currentUserEmail = user.email; 

        authSection.style.display = 'none';
        appContent.style.display = 'block';
        
        const userDisplay = document.getElementById('user-email-display');
        if (userDisplay) userDisplay.textContent = user.email;
        
        initApp(); 
    } else {
        window.currentUserEmail = null;
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

// --- EVENTOS DE REVISIÓN MASIVA ---
document.getElementById('btn-limpiar-revision')?.addEventListener('click', () => {
    if (confirm("¿Querés borrar TODAS las reservas en revisión?")) {
        const todos = Array.from(document.querySelectorAll('#tabla-importadas tbody tr'))
                           .map(tr => tr.dataset.id);
        ejecutarAccionMasiva('borrar', todos);
    }
});

document.getElementById('check-all-revision')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.check-reserva-revision').forEach(chk => chk.checked = checked);
    actualizarPanelLote();
});

document.getElementById('btn-borrar-lote')?.addEventListener('click', () => {
    const ids = Array.from(document.querySelectorAll('.check-reserva-revision:checked')).map(c => c.value);
    ejecutarAccionMasiva('borrar', ids);
});

document.getElementById('btn-confirmar-lote')?.addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('.check-reserva-revision:checked')).map(c => c.value);
    for (let id of ids) {
        await confirmarReservaImportada(id);
    }
    alert("Proceso de confirmación terminado.");
});


// 4. FUNCIONES PRINCIPALES

function loadAuxData() {
    // 1. Clientes
    db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
        caches.clientes = {};
        const clienteSelect = document.getElementById('cliente');
        if (clienteSelect) clienteSelect.innerHTML = '<option value="null">-- Seleccionar Cliente --</option>';
        
        snapshot.forEach(doc => {
            caches.clientes[doc.id] = doc.data();
            if (clienteSelect) clienteSelect.innerHTML += `<option value="${doc.id}">${doc.data().nombre}</option>`;
        });
        actualizarFiltrosDeMoviles();
        poblarFiltroClientes(caches.clientes);
    });

    // 2. Móviles (Con ordenación numérica corregida)
    db.collection('moviles').orderBy('numero').onSnapshot(snapshot => {
        caches.moviles = [];
        snapshot.forEach(doc => caches.moviles.push({ id: doc.id, ...doc.data() }));
        
        // Orden numérico: 1, 2, 10... en lugar de 1, 10, 2
        caches.moviles.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
        actualizarFiltrosDeMoviles();
    });

    // 3. Choferes (Unificado y ordenado por Móvil)
    db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
        caches.choferes = [];
        snapshot.forEach(doc => caches.choferes.push({ id: doc.id, ...doc.data() }));
        
        caches.choferes.sort((a, b) => {
            const movA = caches.moviles.find(m => m.id === a.movil_actual_id);
            const movB = caches.moviles.find(m => m.id === b.movil_actual_id);
            return (movA ? parseInt(movA.numero) : 999) - (movB ? parseInt(movB.numero) : 999);
        });
        actualizarFiltrosDeMoviles();
    });

    // 4. Zonas
    db.collection('zonas').orderBy('numero').onSnapshot(snapshot => {
        caches.zonas = [];
        snapshot.forEach(doc => caches.zonas.push({ id: doc.id, ...doc.data() }));
    });
}



// --- Ordenar Móviles Numéricamente ---
db.collection('moviles').orderBy('numero').onSnapshot(snapshot => {
    caches.moviles = [];
    snapshot.forEach(doc => caches.moviles.push({ id: doc.id, ...doc.data() }));
    
    // ORDENACIÓN NUMÉRICA EXPLICITA
    caches.moviles.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
    
    actualizarFiltrosDeMoviles();
});

// --- Ordenar Choferes por número de Móvil ---
db.collection('choferes').orderBy('nombre').onSnapshot(snapshot => {
    caches.choferes = [];
    snapshot.forEach(doc => caches.choferes.push({ id: doc.id, ...doc.data() }));
    
    // OPCIONAL: Si querés que los choferes también sigan el orden del móvil asignado
    caches.choferes.sort((a, b) => {
        const movilA = caches.moviles.find(m => m.id === a.movil_actual_id);
        const movilB = caches.moviles.find(m => m.id === b.movil_actual_id);
        const numA = movilA ? parseInt(movilA.numero) : 999;
        const numB = movilB ? parseInt(movilB.numero) : 999;
        return numA - numB;
    });
    
    actualizarFiltrosDeMoviles();
});

function hideTableMenus() {
    document.querySelectorAll('.menu-contenido.visible').forEach(menu => menu.classList.remove('visible'));
}

function toggleMenu(event) {
    event.stopPropagation();
    document.querySelectorAll('.menu-contenido.visible').forEach(menu => {
        if (menu !== event.currentTarget.nextElementSibling) menu.classList.remove('visible');
    });
    event.currentTarget.nextElementSibling.classList.toggle('visible');
}

function updateTablePanelVisibility() {
    const panel = document.getElementById('multi-select-panel');
    const contador = document.getElementById('contador-seleccion');
    const lista = document.getElementById('multi-select-list');
    const selectMovil = document.getElementById('select-movil-multi');
    const btnAsignar = document.getElementById('btn-assign-multi');

    if (selectedTableIds.size > 0) {
        panel.style.display = 'block';
        if(contador) contador.textContent = selectedTableIds.size;
        
        
        lista.innerHTML = '';
        selectedTableIds.forEach(id => {
            const li = document.createElement('li');
            li.dataset.id = id; 
            li.style.display = 'none'; 
            lista.appendChild(li);
        });

        const mensaje = document.createElement('li');
        mensaje.style.padding = '10px';
        mensaje.textContent = `Has seleccionado ${selectedTableIds.size} viajes de la lista.`;
        lista.appendChild(mensaje);
        

        if (selectMovil.options.length <= 1 && caches.moviles) {
             let opts = '<option value="">Seleccionar móvil...</option>';
             caches.moviles.forEach(m => {
                 const ch = caches.choferes.find(c => c.movil_actual_id === m.id);
                 const nm = ch ? `(${ch.nombre})` : '';
                 opts += `<option value="${m.id}">Móvil ${m.numero} ${nm}</option>`;
             });
             selectMovil.innerHTML = opts;
        }
        btnAsignar.disabled = false;
    } else {
        panel.style.display = 'none';
    }
}

function toggleTableSelection(reservaId, rowElement) {
    if (selectedTableIds.has(reservaId)) {
        selectedTableIds.delete(reservaId);
        if(rowElement) rowElement.classList.remove('selected-row');
    } else {
        selectedTableIds.add(reservaId);
        if(rowElement) rowElement.classList.add('selected-row');
    }
    
    // Sincronizar con el marcador del mapa si existe
    if (window.app.actualizarMarcadorMapa) {
        window.app.actualizarMarcadorMapa(reservaId, selectedTableIds.has(reservaId));
    }
    
    updateTablePanelVisibility();
}

function limpiarSeleccion() {
    // 1. Limpiar el Set de IDs de la tabla
    selectedTableIds.clear();
    
    // 2. Quitar el resaltado visual de las filas
    document.querySelectorAll('.selected-row').forEach(r => r.classList.remove('selected-row'));
    
    // 3. Resetear el modo de selección en el Mapa si estaba activo
    if (window.app.toggleMultiSelectMode && window.isMapMultiSelectActive) {
        // Esto limpia los marcadores del mapa internamente
        window.app.toggleMultiSelectMode(); 
    }

    // 4. Ocultar el panel y resetear botones
    document.getElementById('multi-select-panel').style.display = 'none';
    
    const btnTable = document.getElementById('btn-toggle-select-table');
    if (window.isTableMultiSelectMode && btnTable) {
        window.isTableMultiSelectMode = false;
        btnTable.textContent = 'Activar Selección Múltiple';
        btnTable.classList.remove('active');
    }
    
    // 5. Refrescar los marcadores del mapa para que vuelvan a su color original
    cargarMarcadoresDeReservas();
}


function filtrarReservasAsignadasPorChofer(choferId) {
    filtroChoferAsignadosId = choferId || null;
    if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
}

function filtrarPorHoras(horas, propagar = true) {
    filtroHoras = horas;
    
    // 1. Actualización visual de los botones de la TABLA
    document.querySelectorAll('.time-filters .map-filter-btn').forEach(btn => {
        const textoBuscado = (horas === null) ? 'Todas' : horas + 'hs';
        btn.classList.toggle('active', btn.innerText.trim().includes(textoBuscado));
    });

    // 2. Renderizado de la tabla
    if (lastReservasSnapshot) {
        renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
    }

    // 3. NUEVO: Si propagar es true, avisamos al MAPA
    if (propagar && window.app && window.app.filtrarMapaPorHoras) {
        window.app.filtrarMapaPorHoras(horas, false); 
    }
}

function openNuevaReservaConDatos(datos, initMapaModalCallback) {
    const form = document.getElementById('reserva-form');
    form.reset();
    form.cliente.value = datos.cliente || 'Default';
    form.dni_pasajero.value = datos.dni_pasajero || '';
    form.nombre_pasajero.value = datos.nombre_pasajero || '';
    form.telefono_pasajero.value = datos.telefono_pasajero || '';
    form.espera_total.value = '';
    form.espera_sin_cargo.value = '';
    form.siniestro.value = datos.siniestro || '';
    form.autorizacion.value = datos.autorizacion || '';
    const duracionOculta = document.getElementById('duracion_estimada_minutos');
    if (duracionOculta) duracionOculta.value = '';
    
    // Configurar orígenes (simple para regreso)
    const container = document.getElementById('origenes-container');
    const inputOrigen = container.querySelector('.origen-input');
    if(inputOrigen) {
        inputOrigen.value = datos.origen || '';
        activarAutocomplete(inputOrigen); 
    }
    
    const inputDestino = document.getElementById('destino');
    if(inputDestino) {
        inputDestino.value = datos.destino || '';
        activarAutocomplete(inputDestino);
    }
    

    document.getElementById('reserva-id').value = '';
    document.getElementById('modal-title').textContent = 'Nueva Reserva (Regreso)';
    document.getElementById('reserva-modal').style.display = 'block';
    

    if(initMapaModalCallback) {
        
        setTimeout(() => {
            initMapaModalCallback(null, null);
            calcularYMostrarRuta(); 
        }, 100);
    }
}


// --- LÓGICA PDF ---
    const btnImportarPDF = document.getElementById('btn-importar-pdf');
    const inputPDF = document.getElementById('input-pdf');
    if (btnImportarPDF && inputPDF) {
        btnImportarPDF.addEventListener('click', () => {
            // VALIDACIÓN DE SEGURIDAD
            const clienteId = document.getElementById('select-cliente-importacion').value;
            if (!clienteId) return alert("⚠️ ATENCIÓN: Primero seleccioná el CLIENTE en el menú desplegable al lado del botón.");
            
            inputPDF.click();
        });

        inputPDF.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const clienteId = document.getElementById('select-cliente-importacion').value; // Capturamos el ID
                const { manejarImportacionPDF } = await import('./reservas.js');
                // Pasamos el clienteId como segundo parámetro
                manejarImportacionPDF(e, clienteId);
            }
        });
    } 


    initFacturacion();

    // --- LÓGICA MULTI-ORIGEN CONECTADA AL MAPA ---
    function initMultiOrigenLogic() {
        const container = document.getElementById('origenes-container');
        const btnAdd = document.getElementById('btn-add-origen');
        
        if (!container || !btnAdd) return;

        // 1. Activar en el input inicial
        const primerInput = container.querySelector('.origen-input');
        if (primerInput) {
            activarAutocomplete(primerInput);
            primerInput.addEventListener('change', calcularYMostrarRuta);
        }

        const MAX_ORIGENES = 4;
        btnAdd.addEventListener('click', () => {
            const inputsActuales = container.querySelectorAll('.origen-input').length;
            if (inputsActuales >= MAX_ORIGENES) return alert("Máximo de 4 orígenes.");

            const div = document.createElement('div');
            div.className = 'input-group-origen';
            div.style.cssText = "display: flex; gap: 5px; align-items: center;";
            div.innerHTML = `
                <span style="font-size: 18px; color: #6c757d;">↳</span>
                <input type="text" name="origen_dinamico" class="origen-input" placeholder="Parada adicional..." style="flex: 1;">
                <button type="button" class="btn-remove-origen" style="background: none; border: none; color: red; font-weight: bold; cursor: pointer; width: 30px;">✕</button>
            `;
            container.appendChild(div);

            // 2. Activar Autocomplete y Ruta en el NUEVO input
            const nuevoInput = div.querySelector('input');
            activarAutocomplete(nuevoInput);
            nuevoInput.addEventListener('change', calcularYMostrarRuta);

            div.querySelector('.btn-remove-origen').addEventListener('click', () => {
                div.remove();
                calcularYMostrarRuta(); 
            });
        });
    }

    initMultiOrigenLogic();

    // Activar Destino
    const inputDestino = document.getElementById('destino');
    if (inputDestino) {
        activarAutocomplete(inputDestino);
        inputDestino.addEventListener('change', calcularYMostrarRuta);
    }

    // Imports Gmail/PDF
    document.getElementById('btn-importar-gmail')?.addEventListener('click', async () => {
        if (!confirm("¿Buscar viajes en Gmail?")) return;
        const btn = document.getElementById('btn-importar-gmail');
        try {
            btn.disabled = true; btn.textContent = '⏳ Buscando...';
            const procesar = firebase.functions().httpsCallable('escanearCorreosGmail');
            const res = await procesar();
            alert(res.data.message);
            document.querySelector('button[data-tab="importadas"]')?.click();
        } catch (e) { alert("Error Gmail: " + e.message); } 
        finally { btn.textContent = '✉️ Importar Gmail'; btn.disabled = false; }
    });

    

    document.getElementById('btn-nueva-reserva')?.addEventListener('click', () => {
        document.getElementById('reserva-form').reset();
        poblarSelectDeMoviles(caches);
        document.getElementById('modal-title').textContent = 'Nueva Reserva';
        document.getElementById('reserva-id').value = '';
        
        
        const container = document.getElementById('origenes-container');
        container.innerHTML = `<div class="input-group-origen" style="display: flex; gap: 5px;"><input type="text" name="origen_dinamico" class="origen-input" placeholder="Origen Principal" required style="flex: 1;"><div style="width: 30px;"></div></div>`;
        const inp = container.querySelector('.origen-input');
        activarAutocomplete(inp);
        inp.addEventListener('change', calcularYMostrarRuta);

        document.getElementById('reserva-modal').style.display = 'block';
        initMapaModal(null, null); 
    });
    
    document.getElementById('btn-toggle-select-table')?.addEventListener('click', function() {
        window.isTableMultiSelectMode = !window.isTableMultiSelectMode;
        if (window.isTableMultiSelectMode) {
            this.textContent = 'Cancelar Selección';
            this.classList.add('active');
            window.app.hideTableMenus(); 
        } else {
            this.textContent = 'Activar Selección Múltiple';
            this.classList.remove('active');
            selectedTableIds.clear();
            document.querySelectorAll('.selected-row').forEach(r => r.classList.remove('selected-row'));
            document.getElementById('multi-select-panel').style.display = 'none';
        }
    });

    const closeModal = (id) => { const m = document.getElementById(id); if(m) m.style.display = 'none'; };
    document.querySelector('.close-btn')?.addEventListener('click', () => closeModal('reserva-modal'));
    document.querySelector('.close-edit-btn')?.addEventListener('click', () => closeModal('edit-modal'));
    
    document.getElementById('busqueda-reservas')?.addEventListener('input', (e) => buscarEnReservas(e.target.value, caches));
    
    document.getElementById('btn-assign-multi')?.addEventListener('click', async () => {
    const movilId = document.getElementById('select-movil-multi').value;
    if (!movilId) return alert('Selecciona un móvil.');

    // Obtenemos los IDs sin importar si vienen de la tabla o del mapa
    let ids = window.app.getSelectedReservasIds();
    
    if (ids.length === 0) return alert("No hay viajes seleccionados.");

    if (await asignarMultiplesReservas(ids, movilId, caches)) {
        // --- LA CLAVE: LIMPIEZA TOTAL ---
        limpiarSeleccion(); 
        document.getElementById('select-movil-multi').value = "";
        alert(`Éxito: Se asignaron ${ids.length} viajes.`);
    }
});




window.printReport = () => {
    const contenido = document.getElementById('reporte-body-print').innerHTML;
    const ventanaPrenta = window.open('', '', 'height=600,width=800');
    ventanaPrenta.document.write('<html><head><title>Informe</title></head><body>');
    ventanaPrenta.document.write(contenido);
    ventanaPrenta.document.write('</body></html>');
    ventanaPrenta.document.close();
    ventanaPrenta.print();
};


function actualizarFiltrosDeMoviles() {
    const selectReservas = document.getElementById('filtro-chofer-asignados');
    const selectMapa = document.getElementById('filtro-chofer-mapa');
    const selectAdmin = document.getElementById('chofer-movil-select');

    if (selectReservas || selectMapa) {
        let optionsHTMLFiltro = '<option value="">Todos los choferes</option>';
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
                const valorActual = select.value;
                select.innerHTML = optionsHTMLFiltro;
                select.value = valorActual;
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
        selectAdmin.innerHTML = optionsHTMLAdmin;
    }

    // Actualizar selectores de reportes
   const repEmpresaSelect = document.getElementById('rep-empresa-select');
    if (repEmpresaSelect && window.appCaches.clientes) {
        const valorActual = repEmpresaSelect.value; // Guardar selección
        let opts = '<option value="">Seleccionar Empresa...</option>';
        Object.entries(window.appCaches.clientes).forEach(([id, data]) => {
            opts += `<option value="${id}">${data.nombre}</option>`;
        });
        repEmpresaSelect.innerHTML = opts;
        repEmpresaSelect.value = valorActual; // Restaurar selección
    }

    // Actualizar selectores de reportes (Chofer)
    const repChoferSelect = document.getElementById('rep-chofer-select');
    if (repChoferSelect && window.appCaches.choferes) {
        const valorActualChofer = repChoferSelect.value; // Guardar selección
        let optsChofer = '<option value="">Todos los móviles</option>';
        window.appCaches.choferes.forEach(ch => {
            const movil = window.appCaches.moviles.find(m => m.id === ch.movil_actual_id);
            if (movil) {
                optsChofer += `<option value="${ch.id}">Móvil ${movil.numero} - ${ch.nombre}</option>`;
            }
        });
        repChoferSelect.innerHTML = optsChofer;
        repChoferSelect.value = valorActualChofer; 
        }
    
}


// 5. INICIALIZACIÓN CENTRAL
function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    
    const btnImportar = document.getElementById('btn-importar-excel');
    const inputExcel = document.getElementById('input-excel');

   if (btnImportar && inputExcel) {
    btnImportar.addEventListener('click', () => {
        // VALIDACIÓN DE SEGURIDAD
        const clienteId = document.getElementById('select-cliente-importacion').value;
        if (!clienteId) return alert("⚠️ ATENCIÓN: Primero seleccioná el CLIENTE en el menú desplegable al lado del botón.");
        
        inputExcel.click(); // Recién ahora abrimos el archivo
    });

    inputExcel.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            try {
                const clienteId = document.getElementById('select-cliente-importacion').value; // Capturamos el ID
                const { manejarImportacionExcel } = await import('./reservas.js');
                // Pasamos el clienteId como segundo parámetro
                manejarImportacionExcel(e, clienteId); 
            } catch (err) { alert("Error al cargar módulo importación."); }
        }
    });

    
    // --- WINDOW.APP DEFINITIVO ---
    window.app = { 
        editItem, deleteItem, openResetPasswordModal,
        openEditReservaModal: (id) => openEditReservaModal(id, caches, initMapaModal),
        asignarMovil: (id, mId) => asignarMovil(id, mId, caches),
        changeReservaState: (id, st) => changeReservaState(id, st, caches),
        finalizarReserva: (id) => finalizarReserva(id, caches),
        quitarAsignacion, updateHoraPickup, updateZona,
        toggleMenu, hideTableMenus,
        toggleMultiSelectMode,
        filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer,
        filtrarReservasAsignadasPorChofer, filtrarPorHoras,
        getSelectedReservasIds: () => {
            return Array.from(selectedTableIds);
        },
        toggleTableSelection, handleConfirmarDesdeModal,
        activarAutocomplete,
        calcularYMostrarRuta,
        limpiarSeleccion,
        confirmarReservaImportada,
        generarInformeProductividad,
        postularChofer: (id, chId) => postularChofer(id, chId),
        despacharPostulados: () => despacharPostulados(),
        cargarHistorial,
        abrirModalEditarHistorico,
        guardarEdicionHistorico,
        recalcularDistanciaHistorico,
        cargarFacturasEmitidas,        
        verFactura,
        anularFactura,
        exportarExcelFactura,
        toggleFiltroPostulados: (val) => {
             window.filtroPostuladosActivo = val; 
            if (lastReservasSnapshot) {
                 renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
            }
        },  
        mostrarSubTabFact: (tipo, e) => {
             document.querySelectorAll('.fact-section').forEach(s => s.style.display = 'none');
             document.querySelectorAll('.sub-tab-fact').forEach(b => b.classList.remove('active'));
             if (e && e.currentTarget) e.currentTarget.classList.add('active');
        
            if (tipo === 'generar') {
                   document.getElementById('sub-fact-generar').style.display = 'block';
            } else {
                    document.getElementById('sub-fact-emitidas').style.display = 'block';
                    window.app.cargarFacturasEmitidas();
            }       
        }  
    };       
    

        
    
    window.openTab = (e, n) => openTab(e, n, { initMapInstance, escucharUbicacionChoferes, cargarMarcadoresDeReservas, cargarHistorial, cargarPasajeros });
    window.showReservasTab = showReservasTab;
    window.openAdminTab = openAdminTab;
    
    document.getElementById('reserva-form').addEventListener('submit', async (e) => {
        const datosRegreso = await handleSaveReserva(e, caches);
        if (datosRegreso) openNuevaReservaConDatos(datosRegreso, initMapaModal);
    });
    
    document.getElementById('btn-confirmar-modal')?.addEventListener('click', (e) => handleConfirmarDesdeModal(e, caches));
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        auth.signOut().then(() => {
            window.location.reload();
        });
    });

    // Cargar datos iniciales
    loadAuxData();
    initHistorial(caches);
    initPasajeros();
    initAdmin(caches);
    initMapa(caches, () => lastReservasSnapshot);
    listenToReservas(snapshot => {
        lastReservasSnapshot = snapshot;
        renderAllReservas(snapshot, caches, filtroChoferAsignadosId, filtroHoras);
        cargarMarcadoresDeReservas();
    });

    filtrarPorHoras(24);

    openTab(null, 'Reservas');

        
}

// Función para mostrar/ocultar el panel de confirmación masiva
window.actualizarPanelLote = function() {
    const checkboxes = document.querySelectorAll('.check-reserva-revision:checked');
    const panel = document.getElementById('panel-acciones-lote');
    const contador = document.getElementById('contador-check-revision');

    if (checkboxes.length > 0) {
        panel.style.display = 'inline-flex'; 
        if(contador) contador.textContent = checkboxes.length;
    } else {
        panel.style.display = 'none';
    }
};
}