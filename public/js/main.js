

import { auth, db } from './firebase-config.js';
import { openTab, showReservasTab, openAdminTab } from './tabs.js';
import { initHistorial, cargarHistorial, poblarFiltroClientes } from './historial.js';
import { initPasajeros, cargarPasajeros } from './pasajeros.js';
import { initAdmin, editItem, deleteItem, openResetPasswordModal } from './admin.js';

// 1. IMPORTAMOS LAS NUEVAS FUNCIONES DE MAPA (RUTAS Y AUTOCOMPLETE)
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
    calcularYMostrarRuta    
} from './mapa.js';

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
    handleConfirmarDesdeModal,
    generarInformeProductividad
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
let filtroHoras = null;

window.isTableMultiSelectMode = false;
let selectedTableIds = new Set();


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
document.getElementById('btn-limpiar-revision')?.addEventListener('click', async () => {
    if (confirm("⚠️ ¡PELIGRO!\n\nEstás a punto de borrar TODAS las reservas de la lista de revisión.\nEsta acción no se puede deshacer.\n\n¿Estás seguro?")) {
        const btn = document.getElementById('btn-limpiar-revision');
        btn.disabled = true;
        btn.textContent = "⏳ Borrando...";
        const { limpiarReservasDeRevision } = await import('./reservas.js');
        await limpiarReservasDeRevision();
        btn.disabled = false;
        btn.textContent = "🔥 Borrar TODAS las de Revisión";
    }
});

document.getElementById('check-all-revision')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.check-reserva-revision').forEach(chk => chk.checked = checked);
    actualizarPanelLote();
});

document.getElementById('tabla-importadas')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('check-reserva-revision')) actualizarPanelLote();
});

function actualizarPanelLote() {
    const checks = document.querySelectorAll('.check-reserva-revision:checked');
    const panel = document.getElementById('panel-acciones-lote');
    document.getElementById('contador-check-revision').textContent = checks.length;
    panel.style.display = checks.length > 0 ? 'flex' : 'none';
}

document.getElementById('btn-borrar-lote')?.addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('.check-reserva-revision:checked')).map(c => c.value);
    if (confirm(`¿Borrar estas ${ids.length} reservas?`)) {
        const { procesarLoteRevision } = await import('./reservas.js');
        await procesarLoteRevision('borrar', ids);
    }
});

document.getElementById('btn-confirmar-lote')?.addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('.check-reserva-revision:checked')).map(c => c.value);
    if (confirm(`¿Confirmar estas ${ids.length} reservas?`)) {
        const { procesarLoteRevision } = await import('./reservas.js');
        await procesarLoteRevision('confirmar', ids);
    }
});


// 4. FUNCIONES PRINCIPALES

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
    const selectMovil = document.getElementById('multi-select-movil');
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
        rowElement.classList.remove('selected-row');
    } else {
        selectedTableIds.add(reservaId);
        rowElement.classList.add('selected-row');
    }
    updateTablePanelVisibility();
}

function limpiarSeleccion() {
    selectedTableIds.clear();
    document.querySelectorAll('.selected-row').forEach(r => r.classList.remove('selected-row'));
    document.getElementById('multi-select-panel').style.display = 'none';
    if (window.isTableMultiSelectMode) document.getElementById('btn-toggle-select-table').click();
}


function filtrarReservasAsignadasPorChofer(choferId) {
    filtroChoferAsignadosId = choferId || null;
    if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
}

function filtrarPorHoras(horas) {
    filtroHoras = horas;
    document.querySelectorAll('.time-filters .map-filter-btn').forEach(btn => btn.classList.remove('active'));
    let btnActivo;
    if (horas === null) btnActivo = document.querySelector('.time-filters button:nth-child(1)');
    else btnActivo = document.querySelector(`.time-filters .map-filter-btn[onclick="window.app.filtrarPorHoras(${horas})"]`);
    if (btnActivo) btnActivo.classList.add('active');
    if (lastReservasSnapshot) renderAllReservas(lastReservasSnapshot, caches, filtroChoferAsignadosId, filtroHoras);
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


// 5. INICIALIZACIÓN CENTRAL
function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    
    const btnImportar = document.getElementById('btn-importar-excel');
    const inputExcel = document.getElementById('input-excel');

    if (btnImportar && inputExcel) {
        btnImportar.addEventListener('click', () => inputExcel.click());
        inputExcel.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                try {
                    const { manejarImportacionExcel } = await import('./reservas.js');
                    manejarImportacionExcel(e);
                } catch (err) { alert("Error al cargar módulo importación."); }
            }
        });
    }

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
            const procesar = firebase.functions().httpsCallable('procesarReservasGmail');
            const res = await procesar();
            alert(res.data.message);
            document.querySelector('button[data-tab="importadas"]')?.click();
        } catch (e) { alert("Error Gmail: " + e.message); } 
        finally { btn.textContent = '✉️ Importar Gmail'; btn.disabled = false; }
    });

    const btnImportarPDF = document.getElementById('btn-importar-pdf');
    const inputPDF = document.getElementById('input-pdf');
    if (btnImportarPDF && inputPDF) {
        btnImportarPDF.addEventListener('click', () => inputPDF.click());
        inputPDF.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const { manejarImportacionPDF } = await import('./reservas.js');
                manejarImportacionPDF(e);
            }
        });
    }

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
    document.getElementById('btn-multi-select')?.addEventListener('click', toggleMultiSelectMode);
    
    document.getElementById('btn-cancel-multi')?.addEventListener('click', () => {
        if (window.isTableMultiSelectMode) document.getElementById('btn-toggle-select-table').click();
        else toggleMultiSelectMode(); 
    });

    document.getElementById('btn-assign-multi')?.addEventListener('click', async () => {
        const movilId = document.getElementById('multi-select-movil').value;
        if (!movilId) return alert('Selecciona un móvil.');
        let ids = window.isTableMultiSelectMode ? Array.from(selectedTableIds) : window.app.getSelectedReservasIds();
        if (ids.length === 0) return alert("Sin selección.");
        if (await asignarMultiplesReservas(ids, movilId, caches)) {
            if (window.isTableMultiSelectMode) document.getElementById('btn-toggle-select-table').click();
            else toggleMultiSelectMode();
            document.getElementById('multi-select-movil').value = "";
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
        filtrarMapa, filtrarMapaPorHoras, filtrarMapaPorChofer,
        filtrarReservasAsignadasPorChofer, filtrarPorHoras,
        getSelectedReservasIds: () => {
            if (window.isTableMultiSelectMode) return Array.from(selectedTableIds);
            if (typeof getSelectedReservasIds === 'function') return getSelectedReservasIds();
            return [];
        },
        toggleTableSelection, handleConfirmarDesdeModal,
        activarAutocomplete,
        calcularYMostrarRuta,
        limpiarSeleccion,
        confirmarReservaImportada,
        generarInformeProductividad,
    }
    
    window.openTab = (e, n) => openTab(e, n, { initMapInstance, escucharUbicacionChoferes, cargarMarcadoresDeReservas, cargarHistorial, cargarPasajeros });
    window.showReservasTab = showReservasTab;
    window.openAdminTab = openAdminTab;
    
    document.getElementById('reserva-form').addEventListener('submit', async (e) => {
        const datosRegreso = await handleSaveReserva(e, caches);
        if (datosRegreso) openNuevaReservaConDatos(datosRegreso, initMapaModal);
    });
    
    document.getElementById('btn-confirmar-modal')?.addEventListener('click', (e) => handleConfirmarDesdeModal(e, caches));
    document.getElementById('dni_pasajero').addEventListener('blur', handleDniBlur);
    

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

    openTab(null, 'Reservas');
};


window.printReport = () => {
    const contenido = document.getElementById('reporte-body-print').innerHTML;
    const ventanaPrenta = window.open('', '', 'height=600,width=800');
    ventanaPrenta.document.write('<html><head><title>Informe de Productividad - Premier Traslados</title>');
    ventanaPrenta.document.write('<style>table { width: 100%; border-collapse: collapse; font-family: sans-serif; margin-bottom: 20px; } th, td { border: 1px solid #ccc; padding: 8px; text-align: left; } th { background: #eee; } h3 { background: #6f42c1; color: white; padding: 10px; }</style>');
    ventanaPrenta.document.write('</head><body>');
    ventanaPrenta.document.write('<h1>Premier Traslados - Informe de Productividad</h1>');
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
        let opts = '<option value="">Seleccionar Empresa...</option>';
        Object.entries(window.appCaches.clientes).forEach(([id, data]) => {
            opts += `<option value="${id}">${data.nombre}</option>`;
        });
        repEmpresaSelect.innerHTML = opts;
    }

    const repChoferSelect = document.getElementById('rep-chofer-select');
    if (repChoferSelect && window.appCaches.choferes) {
        let optsChofer = '<option value="">Todos los móviles</option>';
        window.appCaches.choferes.forEach(ch => {
            const movil = window.appCaches.moviles.find(m => m.id === ch.movil_actual_id);
            if (movil) optsChofer += `<option value="${ch.id}">Móvil ${movil.numero} - ${ch.nombre}</option>`;
        });
        repChoferSelect.innerHTML = optsChofer;
    }
}


document.getElementById('btn-excel-reporte')?.addEventListener('click', () => {
    const tablas = document.querySelectorAll('#reporte-body-print table');
    if (tablas.length === 0) return alert("No hay datos para exportar.");
    
    // 1. Creamos un libro de trabajo nuevo
    const wb = XLSX.utils.book_new();
    let ws;

    tablas.forEach((tabla, index) => {
        if (index === 0) {
           
            ws = XLSX.utils.table_to_sheet(tabla);
            XLSX.utils.book_append_sheet(wb, ws, "Reporte Completo");
        } else {
            
            XLSX.utils.sheet_add_dom(ws, tabla, { origin: -1 });
        }
    });
    
    const nombreArchivo = `Reporte_Premier_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, nombreArchivo);
});

// --- REPORTE DE EMPRESA (OPTIMIZADO PARA ADMINISTRACIÓN Y EXCEL) ---
window.ejecutarReporteEmpresa = async () => {
    const empresaId = document.getElementById('rep-empresa-select').value;
    const desde = document.getElementById('rep-empresa-desde').value;
    const hasta = document.getElementById('rep-empresa-hasta').value;

    if (!empresaId || !desde || !hasta) return alert("Completa todos los filtros.");

    try {
        const [snapReservas, snapHistorico] = await Promise.all([
            db.collection('reservas').where('cliente', '==', empresaId).where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('cliente', '==', empresaId).where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        const todosLosViajes = [...snapReservas.docs, ...snapHistorico.docs];
        if (todosLosViajes.length === 0) return alert("Sin datos para esta empresa.");

        let dias = {};
        todosLosViajes.forEach(doc => {
            const v = doc.data();
            const f = v.fecha_turno || 'S/F';
            if (!dias[f]) dias[f] = { viajes: [], kmOcupado: 0 };
            dias[f].viajes.push(v);
        });

        let html = '';
        const diasOrdenados = Object.keys(dias).sort();

        for (const f of diasOrdenados) {
            const dia = dias[f];
            dia.viajes.sort((a, b) => (a.hora_pickup || a.hora_turno || '00:00').localeCompare(b.hora_pickup || b.hora_turno || '00:00'));

            html += `<div style="background: #f8f9fa; padding: 10px; border-left: 5px solid #007bff; margin-top: 20px; font-weight: bold; font-family: sans-serif;">
                        📅 Fecha: ${new Date(f + 'T00:00:00').toLocaleDateString('es-AR')}
                     </div>
                     <table style="width:100%; border-collapse: collapse; font-size: 11px; font-family: sans-serif;">
                        <thead><tr style="background: #eee; border-bottom: 2px solid #007bff;">
                            <th style="padding:8px; text-align:left;">Fecha</th>
                            <th style="padding:8px; text-align:left;">Hora</th>
                            <th style="padding:8px; text-align:left;">Detalle / Pasajero</th>
                            <th style="padding:8px; text-align:center;">KM Ocup.</th>
                            <th style="padding:8px; text-align:left;">Estado</th>
                        </tr></thead><tbody>`;

            for (let v of dia.viajes) {
                const estado = (v.estado?.principal || v.estado || 'FINALIZADO').toUpperCase();
                
                // FILTRO DE INCLUSIÓN: Solo procesamos los que ya tienen acción (Asignado, Finalizado, etc)
                if (estado === 'PENDIENTE' || estado === 'EN CURSO') continue;

                let km = parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;
                
                // Triple Plan: Solo si está en un estado válido para cobro
                if (km === 0 && (estado === 'FINALIZADO' || estado === 'ASIGNADO')) {
                    const rep = await calcularKilometrosEntrePuntos(v.origen, v.destino);
                    km = rep.distancia;
                }

                // SUMATORIA CONDICIONAL: Solo sumamos si no es un viaje perdido para la empresa
                if (estado !== 'ANULADO' && estado !== 'NEGATIVO') {
                    dia.kmOcupado += km;
                }

                html += `<tr style="border-bottom: 1px solid #eee;">
                    <td style="padding:8px;">${f}</td>
                    <td style="padding:8px;">${v.hora_pickup || v.hora_turno || '--:--'}</td>
                    <td style="padding:8px;"><strong>${v.nombre_pasajero}</strong><br><small style="color:#666;">${v.origen} ➔ ${v.destino}</small></td>
                    <td style="text-align:center; font-weight:bold;">${km.toFixed(1)} km</td>
                    <td style="padding:8px; font-weight:bold; color:${estado === 'ANULADO' ? 'red' : '#007bff'};">${estado}</td>
                </tr>`;
            }
            html += `</tbody></table>
                     <div style="background: #e7f1ff; padding: 10px; font-weight: bold; text-align: right; border-bottom: 2px solid #007bff; font-family: sans-serif;">
                        Total Facturable del día: <span style="font-size:16px;">${dia.kmOcupado.toFixed(1)} km</span>
                     </div>`;
        }

        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('titulo-reporte-dinamico').textContent = `Auditoría de Cuenta Corriente: ${window.appCaches.clientes[empresaId]?.nombre || 'Cliente'}`;
        document.getElementById('reporte-modal').style.display = 'block';
        document.getElementById('modal-param-empresa').style.display = 'none';
    } catch (e) { console.error(e); alert("Error al generar reporte de empresa."); }
};

// --- REPORTE DE CHOFER (CAJAS DIARIAS CON COLUMNA DE FECHA PARA EXCEL) ---
window.ejecutarReporteChofer = async () => {
    const desde = document.getElementById('rep-chofer-desde').value;
    const hasta = document.getElementById('rep-chofer-hasta').value;
    const choferId = document.getElementById('rep-chofer-select').value;

    if (!desde || !hasta) return alert("Selecciona el rango de fechas.");

    try {
        const [snapReservas, snapHistorico] = await Promise.all([
            db.collection('reservas').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        const todosLosDocs = [...snapReservas.docs, ...snapHistorico.docs];
        if (todosLosDocs.length === 0) return alert("No se encontraron viajes.");

        let datosChoferes = {};
        todosLosDocs.forEach(doc => {
            const v = doc.data();
            const idCh = v.chofer_asignado_id || v.asignado_a;
            if (!idCh || (choferId && idCh !== choferId)) return;

            const fecha = v.fecha_turno || 'S/F';
            if (!datosChoferes[idCh]) {
                const choferInfo = window.appCaches.choferes.find(c => c.id === idCh);
                datosChoferes[idCh] = { nombre: choferInfo?.nombre || "Desconocido", dias: {} };
            }
            if (!datosChoferes[idCh].dias[fecha]) datosChoferes[idCh].dias[fecha] = { viajes: [], kmOcupado: 0, kmVacio: 0 };
            datosChoferes[idCh].dias[fecha].viajes.push(v);
        });

        let html = '';
        for (const idCh in datosChoferes) {
            const chofer = datosChoferes[idCh];
            html += `<div style="margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; background: white;">
                     <h2 style="background: #6f42c1; color: white; padding: 12px; margin: 0; border-radius: 4px; font-family: sans-serif;">Chofer: ${chofer.nombre}</h2>`;

            const diasOrdenados = Object.keys(chofer.dias).sort();
            for (const f of diasOrdenados) {
                const dia = chofer.dias[f];

                for (let v of dia.viajes) {
                    const estado = (v.estado?.principal || v.estado || 'FINALIZADO').toUpperCase();
                    const hBase = v.hora_pickup || v.hora_turno;
                    let distOcupado = parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;
                    let dMin = parseInt(v.duracion_estimada_minutos) || 0;

                    if ((distOcupado === 0 || dMin === 0) && (estado === 'FINALIZADO' || estado === 'ASIGNADO')) {
                        const rep = await calcularKilometrosEntrePuntos(v.origen, v.destino);
                        if (distOcupado === 0) distOcupado = rep.distancia;
                        if (dMin === 0) dMin = rep.duracion; 
                        v.distancia = distOcupado.toFixed(1) + " km";
                    }

                    // SOLO SUMAMOS SI ES PRODUCTIVO (No Anulado/Negativo/Pendiente)
                    if (estado !== 'ANULADO' && estado !== 'NEGATIVO' && estado !== 'PENDIENTE' && estado !== 'EN CURSO') {
                        dia.kmOcupado += distOcupado;
                    }

                    if (hBase && dMin > 0) {
                        const [h, m] = hBase.split(':').map(Number);
                        const calc = new Date(); calc.setHours(h, m + dMin);
                        v.hora_fin_calculada = `${calc.getHours().toString().padStart(2,'0')}:${calc.getMinutes().toString().padStart(2,'0')}`;
                    } else v.hora_fin_calculada = "--:--";
                }

                dia.viajes.sort((a, b) => (a.hora_pickup || a.hora_turno || '00:00').localeCompare(b.hora_pickup || b.hora_turno || '00:00'));

                html += `<div style="background: #f8f9fa; padding: 10px; border-left: 5px solid #6f42c1; margin-top: 20px; font-weight: bold; font-family: sans-serif;">
                             📅 Fecha: ${new Date(f + 'T00:00:00').toLocaleDateString('es-AR')}
                         </div>
                         <table style="width:100%; border-collapse: collapse; font-size: 11px; font-family: sans-serif;">
                            <thead><tr style="background: #eee; border-bottom: 2px solid #6f42c1;">
                                <th style="padding: 8px; text-align: left;">Fecha</th>
                                <th style="padding: 8px; text-align: left;">Hora</th>
                                <th style="padding: 8px; text-align: left;">Detalle del Traslado</th>
                                <th style="padding: 8px; text-align: center;">KM Ocup.</th>
                                <th style="padding: 8px; text-align: center;">KM Despl.</th>
                                <th style="padding: 8px; text-align: center;">Hora Fin</th>
                            </tr></thead><tbody>`;

                for (const [idx, v] of dia.viajes.entries()) {
                    if (idx > 0) {
                        const resV = await calcularKilometrosEntrePuntos(dia.viajes[idx-1].destino, v.origen);
                        dia.kmVacio += resV.distancia;
                        if (resV.distancia > 0) {
                            html += `<tr style="color: #777; font-style: italic; background: #fafafa; border-bottom: 1px dashed #ddd;">
                                <td style="padding: 5px;">${f}</td><td style="padding: 5px;">--:--</td>
                                <td style="padding: 5px 20px;">🚗 Desplazamiento</td><td style="text-align:center;">-</td>
                                <td style="text-align:center;">${resV.distancia.toFixed(2)} km</td><td style="text-align:center;">-</td></tr>`;
                        }
                    }
                    html += `<tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px;">${f}</td>
                        <td style="padding: 8px;">${v.hora_pickup || v.hora_turno || '--:--'}</td>
                        <td style="padding: 8px;"><strong>${v.nombre_pasajero}</strong><br><small style="color:#666;">${v.origen} ➔ ${v.destino}</small></td>
                        <td style="text-align: center; font-weight: bold;">${v.distancia}</td><td style="text-align: center;">-</td>
                        <td style="text-align: center;">${v.hora_fin_calculada}</td></tr>`;
                }

                const hIni = dia.viajes[0].hora_pickup || dia.viajes[0].hora_turno;
                const hFinU = dia.viajes[dia.viajes.length - 1].hora_fin_calculada;
                let jText = "--:--";
                if (hIni && hFinU !== "--:--") {
                    const [h1, m1] = hIni.split(':').map(Number);
                    const [h2, m2] = hFinU.split(':').map(Number);
                    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                    if (diff < 0) diff += 1440; 
                    jText = `${Math.floor(diff / 60)}h ${diff % 60}m`;
                }

                html += `</tbody></table>
                         <div style="background: #eef2ff; padding: 12px; border-bottom: 2px solid #6f42c1; display: flex; justify-content: space-between; font-weight: bold; font-family: sans-serif;">
                            <span>📏 KM Realizados: <span style="color:#6f42c1">${dia.kmOcupado.toFixed(1)} km</span></span>
                            <span>🚗 KM Vacío: <span style="color:#fd7e14">${dia.kmVacio.toFixed(1)} km</span></span>
                            <span>⏳ Jornada: <span style="color:#28a745">${jText}</span></span>
                         </div>`;
            }
            html += `</div>`;
        }
        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('reporte-modal').style.display = 'block';
        document.getElementById('modal-param-chofer').style.display = 'none';
    } catch (error) { console.error("Error:", error); alert("Error al generar el informe."); }
};

async function calcularKilometrosEntrePuntos(origen, destino) {
    if (!origen || !destino) return { distancia: 0, duracion: 0 };
    try {
        const service = new google.maps.DistanceMatrixService();
        return new Promise((resolve) => {
            service.getDistanceMatrix({
                origins: [origen],
                destinations: [destino],
                travelMode: 'DRIVING',
            }, (res, status) => {
                if (status === "OK" && res.rows[0].elements[0].status === "OK") {
                    const el = res.rows[0].elements[0];
                    resolve({
                        distancia: el.distance.value / 1000,
                        duracion: Math.ceil(el.duration.value / 60)
                    });
                } else resolve({ distancia: 0, duracion: 0 });
            });
        });
    } catch (e) {
            console.error("Error en Distance Matrix:", e);
            return { distancia: 0, duracion: 0 };
        }
    }