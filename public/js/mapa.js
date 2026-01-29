import { db } from './firebase-config.js';

let map, mapaModal, directionsService, directionsRenderer, geocoder;
let coordenadasInputs = new Map(); 
let marcadoresReservas = {}, marcadoresChoferes = {}, infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;
let sessionToken = null;
let autocompleteService = null;
let placesService = null;

// VARIABLES DE ESTADO PARA FILTROS
let filtroMapaActual = 'Todos'; 
let filtroHorasMapa = 24; 
let filtroChoferMapaId = null;

let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;
let isMultiSelectMode = false;
let selectedReservas = new Map(); 
let marcadoresRuta = []; 

// --- 1. INICIALIZACIÓN ---
export function initMapa(caches, getLatestSnapshot) {
    cachesRef = caches; 
    lastReservasSnapshotRef = getLatestSnapshot;
    mapContextMenu = document.getElementById('map-context-menu');
    mapContextMenuItems = document.getElementById('map-context-menu-items');
    
    initMapInstance(); 
    escucharUbicacionChoferes();
}    

export async function initMapInstance() {
    const c = document.getElementById("map-container");
    if (c && !map) {
        const { Map } = await google.maps.importLibrary("maps");
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        geocoder = new Geocoder();
        map = new Map(c, { center: { lat: -32.9566, lng: -60.6577 }, zoom: 12 });
        map.addListener('click', hideMapContextMenu);
        await google.maps.importLibrary("routes");
        if (typeof lastReservasSnapshotRef === 'function' && lastReservasSnapshotRef()) {
            cargarMarcadoresDeReservas();
        }
    }
}

// --- 2. LÓGICA DE FILTRADO ---

export function filtrarMapa(estado) { 
    // NORMALIZACIÓN: Aseguramos que el filtro coincida con la lógica de cargarMarcadoresDeReservas
    if (estado === 'Asignado' || estado === 'Asignados') {
        filtroMapaActual = 'Asignados';
    } else if (estado === 'Pendiente' || estado === 'Pendientes') {
        filtroMapaActual = 'Pendientes';
    } else if (estado === 'En Curso') {
        filtroMapaActual = 'En Curso';
    } else {
        filtroMapaActual = estado; 
    }

    // Actualizar visualmente los botones
    document.querySelectorAll('.map-filters .map-filter-btn').forEach(btn => {
        // Usamos includes para que "Pendientes" sea active si el estado es "Pendiente"
        btn.classList.toggle('active', btn.innerText.includes(estado));
    });

    cargarMarcadoresDeReservas(); 
}

export function filtrarMapaPorHoras(horas, propagar = true) { 
    filtroHorasMapa = horas; 
    
    // 1. Actualización visual de botones en el Mapa
    document.querySelectorAll('.time-filters-map .map-filter-btn').forEach(btn => {
        const textoBuscado = (horas === null) ? 'Todas' : horas + 'hs'; 
        btn.classList.toggle('active', btn.innerText.trim().includes(textoBuscado));
    });

    // 2. Refrescar pines
    cargarMarcadoresDeReservas();

    // 3. SINCRONIZACIÓN: Avisar a la tabla si es necesario
    if (propagar && window.app && window.app.filtrarPorHoras) {
        window.app.filtrarPorHoras(horas, false); 
    }
}

export function filtrarMapaPorChofer(choferId) {
    filtroChoferMapaId = choferId || null;
    cargarMarcadoresDeReservas();
    toggleChoferesVisibility(document.getElementById('toggle-choferes')?.checked);
}

export function toggleChoferesVisibility(mostrar) { 
    Object.entries(marcadoresChoferes).forEach(([id, mark]) => {
        const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
        mark.setVisible(mostrar && coincideFiltro);
    });
}

// --- 3. RENDERIZADO DE MARCADORES (RESERVAS) ---

export function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshotRef()) return;
    
    const idsDeReservasActivas = new Set();
    const ahora = new Date();
    const idsSeleccionados = window.app?.getSelectedReservasIds() || [];

    lastReservasSnapshotRef().forEach(doc => {
        const r = { id: doc.id, ...doc.data() };
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        
        if (['Anulado', 'Finalizado', 'Cancelado', 'Debitado', 'Negativo'].includes(e)) return;
        if (filtroChoferMapaId && r.chofer_asignado_id !== filtroChoferMapaId) return;

        if (filtroMapaActual !== 'Todos') {
    
         if (filtroMapaActual === 'Pendientes' && e !== 'Pendiente') return;
    
   
         if (filtroMapaActual === 'Asignados' && !['Asignado', 'En Origen', 'Viaje Iniciado'].includes(e)) return;
    
         if (filtroMapaActual === 'En Curso' && e !== 'En Curso') return;
        }

        if (filtroHorasMapa !== null) {
            const horaRef = r.hora_pickup || r.hora_turno;
            if (r.fecha_turno && horaRef) {
                const fechaReserva = new Date(`${r.fecha_turno}T${horaRef}`);
                const diffHoras = (fechaReserva - ahora) / (1000 * 60 * 60);
                if (diffHoras < -1 || diffHoras > filtroHorasMapa) return;
            }
        }

        idsDeReservasActivas.add(r.id);
        let posicion = (['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords?.latitude) 
            ? { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude } 
            : { lat: r.origen_coords?.latitude, lng: r.origen_coords?.longitude };

        if (!posicion.lat) return;

        let icono = idsSeleccionados.includes(r.id) 
            ? crearIconoDePin('#007BFF', '✓') 
            : _getIconoParaReserva(r, e);
        
        if (marcadoresReservas[r.id]) { 
            marcadoresReservas[r.id].setPosition(posicion); 
            marcadoresReservas[r.id].setIcon(icono); 
        } else {
            const m = new google.maps.Marker({ position: posicion, map: map, icon: icono });
            m.addListener('click', () => isMultiSelectMode ? handleMarkerSelection(r) : mostrarMenuContextualReserva({domEvent: {preventDefault:()=>{}, clientX: 0, clientY: 0}}, r, e));
            marcadoresReservas[r.id] = m;
        }
    });

    Object.keys(marcadoresReservas).forEach(id => { 
        if (!idsDeReservasActivas.has(id)) { 
            marcadoresReservas[id].setMap(null); 
            delete marcadoresReservas[id]; 
        } 
    });
}

// --- 4. UBICACIÓN DE CHOFERES ---

export function escucharUbicacionChoferes() {
    if (unsubscribeChoferes) unsubscribeChoferes();
    unsubscribeChoferes = db.collection('choferes').onSnapshot(snap => {
        const mostrar = document.getElementById('toggle-choferes')?.checked;
        snap.docChanges().forEach(change => {
            const d = change.doc.data(), id = change.doc.id;
            if (change.type === 'removed' || (!d.coordenadas && !d.posicion)) {
                if(marcadoresChoferes[id]) { marcadoresChoferes[id].setMap(null); delete marcadoresChoferes[id]; }
                return;
            }
            const coords = d.coordenadas || d.posicion;
            const pos = { lat: coords.latitude, lng: coords.longitude };
            const movil = cachesRef.moviles.find(m => m.id === d.movil_actual_id);
            const n = movil ? movil.numero : '?';
            
            const icon = { 
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="22" r="21" fill="${d.esta_en_linea ? '#23477b' : '#808080'}" stroke="white" stroke-width="2"/><text x="22" y="28" font-family="Arial" font-size="17px" font-weight="bold" fill="white" text-anchor="middle">${n}</text></svg>`), 
                scaledSize: new google.maps.Size(44, 44), 
                anchor: new google.maps.Point(22, 22) 
            };
            
            if (marcadoresChoferes[id]) { 
                marcadoresChoferes[id].setPosition(pos);
                marcadoresChoferes[id].setIcon(icon);
            } else { 
                marcadoresChoferes[id] = new google.maps.Marker({ position: pos, map: map, icon: icon }); 
            }
            const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
            marcadoresChoferes[id].setVisible(mostrar && coincideFiltro);
        });
    });
}

// --- 5. SELECCIÓN MÚLTIPLE ---

export function toggleMultiSelectMode() {
    isMultiSelectMode = !isMultiSelectMode;
    const panel = document.getElementById('multi-select-panel');
    if (panel) panel.style.display = isMultiSelectMode ? 'block' : 'none';
    if (!isMultiSelectMode) {
        selectedReservas.clear();
        window.app?.limpiarSeleccion();
    }
    cargarMarcadoresDeReservas();
}

export function getSelectedReservasIds() {
    return Array.from(selectedReservas.keys());
}

export function actualizarMarcadorMapa(id, isSelected) {
    cargarMarcadoresDeReservas();
}

function handleMarkerSelection(reserva) {
    const fila = document.querySelector(`tr[data-id="${reserva.id}"]`);
    window.app.toggleTableSelection(reserva.id, fila);
}

// --- 6. AUTOCOMPLETE Y RUTAS (UTILIZADO POR HISTORIAL Y MODAL) ---

export async function activarAutocomplete(inputElement) {
    if (!inputElement) return;
    if (!autocompleteService) {
        const { AutocompleteService } = await google.maps.importLibrary("places");
        autocompleteService = new AutocompleteService();
    }
    if (!placesService) {
        const { PlacesService } = await google.maps.importLibrary("places");
        placesService = new PlacesService(map || document.createElement('div'));
    }
    if (!sessionToken) {
        const { AutocompleteSessionToken } = await google.maps.importLibrary("places");
        sessionToken = new AutocompleteSessionToken();
    }

    let lista = document.createElement('ul');
    lista.className = "autocomplete-results";
    lista.style.cssText = "position:absolute; background:white; list-style:none; padding:0; margin:0; border:1px solid #ccc; z-index:9999; width:100%; max-height:200px; overflow-y:auto; display:none; border-radius:4px; box-shadow:0 4px 6px rgba(0,0,0,0.1);";
    
    if(inputElement.parentNode) {
        inputElement.parentNode.style.position = "relative";
        inputElement.parentNode.appendChild(lista);
    }

    inputElement.addEventListener('input', debounce(async (e) => {
        const valor = e.target.value;
        if (valor.length < 3) { lista.style.display = 'none'; return; }

        autocompleteService.getPlacePredictions({
            input: valor,
            sessionToken: sessionToken,
            componentRestrictions: { country: 'ar' },
            types: ['geocode', 'establishment']
        }, (predictions, status) => {
            lista.innerHTML = '';
            if (status === 'OK' && predictions) {
                lista.style.display = 'block';
                predictions.forEach(p => {
                    const li = document.createElement('li');
                    li.textContent = p.description;
                    li.style.cssText = "padding:10px; cursor:pointer; border-bottom:1px solid #eee; font-size:13px;";
                    li.onclick = () => {
                        inputElement.value = p.description;
                        lista.style.display = 'none';
                        placesService.getDetails({ placeId: p.place_id, fields: ['geometry'], sessionToken }, (place, statusDet) => {
                            if (statusDet === 'OK' && place.geometry) {
                                coordenadasInputs.set(inputElement, place.geometry.location);
                                calcularYMostrarRuta();
                                sessionToken = new google.maps.AutocompleteSessionToken();
                            }
                        });
                    };
                    lista.appendChild(li);
                });
            } else { lista.style.display = 'none'; }
        });
    }, 500)); 
}

export async function initMapaModal() {
    const c = document.getElementById("mapa-modal-container");
    if (!c) return;
    const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
    if (!directionsService) directionsService = new DirectionsService();
    if (!directionsRenderer) directionsRenderer = new DirectionsRenderer({ draggable: true, map: null, suppressMarkers: true, polylineOptions: { strokeColor: "#1877f2", strokeWeight: 5 } });
    if (!mapaModal) {
        const { Map } = await google.maps.importLibrary("maps");
        mapaModal = new Map(c, { center: { lat: -32.95, lng: -60.65 }, zoom: 13 });
    }
    directionsRenderer.setMap(null); 
    setTimeout(calcularYMostrarRuta, 500);
}

export async function calcularYMostrarRuta() {
    if (!directionsService || !mapaModal) return;
    const inputsOrigen = Array.from(document.querySelectorAll('.origen-input'));
    const inputDestino = document.getElementById('destino');
    let todosLosInputs = [...inputsOrigen]; if (inputDestino) todosLosInputs.push(inputDestino);
    let puntosValidos = [];
    
    for (const input of todosLosInputs) {
        if (input.value.trim().length > 3) {
            const res = await geocodificar(input.value);
            if (res && res[0]) {
                const loc = res[0].geometry.location;
                coordenadasInputs.set(input, loc);
                puntosValidos.push({ location: loc });
            }
        }
    }
    
    if (puntosValidos.length < 2) return;
    directionsRenderer.setMap(mapaModal);
    directionsService.route({
        origin: puntosValidos[0].location,
        destination: puntosValidos[puntosValidos.length - 1].location,
        waypoints: puntosValidos.slice(1, -1).map(p => ({ location: p.location, stopover: true })),
        travelMode: 'DRIVING'
    }, (response, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(response);
            let dist = 0, dur = 0;
            response.routes[0].legs.forEach(leg => { dist += leg.distance.value; dur += leg.duration.value; });
            document.getElementById('distancia_total_input').value = (dist / 1000).toFixed(2) + " km";
            document.getElementById('tiempo_total_input').value = Math.ceil(dur / 60) + " min";
            document.getElementById('duracion_estimada_minutos').value = Math.ceil(dur / 60);
        }
    });
}

// --- 7. UTILIDADES ---

export function getModalMarkerCoords() { 
    const inputs = Array.from(document.querySelectorAll('.origen-input')); 
    const inputDestino = document.getElementById('destino');
    const limpiar = (i) => {
        const c = coordenadasInputs.get(i);
        if (!c) return null;
        return { latitude: typeof c.lat === 'function' ? c.lat() : c.lat, longitude: typeof c.lng === 'function' ? c.lng() : c.lng };
    };
    return { origen: limpiar(inputs[0]), destino: limpiar(inputDestino) }; 
}

export function hideMapContextMenu() { 
    const menu = document.getElementById('map-context-menu');
    if (menu) menu.style.display = 'none'; 
}

function mostrarMenuContextualReserva(event, reserva, estado) {
    const menu = document.getElementById('map-context-menu');
    const items = document.getElementById('map-context-menu-items');
    if (!menu || !items) return;
    menu.style.display = 'block';
    menu.style.left = `${event.domEvent?.clientX || 0}px`;
    menu.style.top = `${event.domEvent?.clientY || 0}px`;
    items.innerHTML = `<li><strong>${reserva.nombre_pasajero}</strong></li><hr><li><button onclick="window.app.openEditReservaModal('${reserva.id}')">✏️ Editar</button></li>`;
}

export function crearIconoDePin(color, texto) {
    const svgIcon = `<svg width="42" height="56" viewBox="0 0 42 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 0C11.64 0 4 7.64 4 18c0 14 17 38 17 38s17-24 17-38C38 7.64 30.36 0 21 0Z" fill="${color}"/><circle cx="21" cy="18" r="15" fill="white"/><text x="21" y="24" font-family="Arial" font-size="15px" font-weight="bold" fill="#333" text-anchor="middle">${texto}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon), scaledSize: new google.maps.Size(42, 56), anchor: new google.maps.Point(21, 56) };
}

function _getIconoParaReserva(reserva, e) {
    if (['Viaje Iniciado', 'En Origen'].includes(e)) { 
        const movil = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id); 
        return crearIconoDePin('#27DAF5', movil ? movil.numero.toString() : '?'); 
    }
    let colorFondo, textoIcono = '';
    switch (e) {
        case 'En Curso': colorFondo = '#F54927'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        case 'Asignado': colorFondo = (reserva.estado?.detalle === 'Aceptada') ? '#4DF527' : '#F5A623'; const movilA = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id); textoIcono = movilA ? movilA.numero.toString() : '?'; break;
        case 'Pendiente': colorFondo = '#C15DE8'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        default: colorFondo = '#808080'; textoIcono = '•'; break;
    }
    return crearIconoDePin(colorFondo, textoIcono);
}

function geocodificar(address) {
    if (!geocoder) return null;
    let full = address.includes("Argentina") ? address : address + ", Santa Fe, Argentina";
    return new Promise(resolve => geocoder.geocode({ address: full }, (res, status) => resolve(status === 'OK' ? res : null)));
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}