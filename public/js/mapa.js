import { db } from './firebase-config.js';

let map, mapaModal, directionsService, directionsRenderer, geocoder;
let coordenadasInputs = new Map(); 
let marcadoresReservas = {}, marcadoresChoferes = {}, infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;
let marcadoresRutaModal = [];
let filtroMapaActual = 'Todos'; 
let filtroHorasMapa = 24; 
let filtroChoferMapaId = null;

let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;
let isMultiSelectMode = false;
let selectedReservas = new Map(); 

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
        await google.maps.importLibrary("marker"); 
        
        geocoder = new Geocoder();
        
        map = new Map(c, { 
            center: { lat: -32.9566, lng: -60.6577 }, 
            zoom: 12,
            mapId: "DEMO_MAP_ID" 
        });
        
        map.addListener('click', hideMapContextMenu);
        await google.maps.importLibrary("routes");
        
        if (typeof lastReservasSnapshotRef === 'function' && lastReservasSnapshotRef()) {
            cargarMarcadoresDeReservas();
        }
    }
}

// --- 2. FILTRADO ---
export function filtrarMapa(estado) { 
    if (estado === 'Asignado' || estado === 'Asignados') filtroMapaActual = 'Asignados';
    else if (estado === 'Pendiente' || estado === 'Pendientes') filtroMapaActual = 'Pendientes';
    else if (estado === 'En Curso') filtroMapaActual = 'En Curso';
    else filtroMapaActual = estado; 

    document.querySelectorAll('.map-filters .map-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.includes(estado));
    });
    cargarMarcadoresDeReservas(); 
}

export function filtrarMapaPorHoras(horas, propagar = true) { 
    filtroHorasMapa = horas; 
    document.querySelectorAll('.time-filters-map .map-filter-btn').forEach(btn => {
        const textoBuscado = (horas === null) ? 'Todas' : horas + 'hs'; 
        btn.classList.toggle('active', btn.innerText.trim().includes(textoBuscado));
    });
    cargarMarcadoresDeReservas();
    if (propagar && window.app && window.app.filtrarPorHoras) window.app.filtrarPorHoras(horas, false); 
}

export function filtrarMapaPorChofer(choferId) {
    filtroChoferMapaId = choferId || null;
    cargarMarcadoresDeReservas();
    toggleChoferesVisibility(document.getElementById('toggle-choferes')?.checked);
}

export function toggleChoferesVisibility(mostrar) { 
    Object.entries(marcadoresChoferes).forEach(([id, mark]) => {
        const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
        mark.content.style.display = (mostrar && coincideFiltro) ? 'block' : 'none';
    });
}

// --- 3. RENDERIZADO (RESERVAS) ---
export async function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshotRef()) return;
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    
    const idsDeReservasActivas = new Set();
    const ahora = new Date();
    const idsSeleccionados = window.app?.getSelectedReservasIds() || [];

    lastReservasSnapshotRef().forEach(doc => {
        const r = { id: doc.id, ...doc.data() };
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        
        if (['Anulado', 'Finalizado', 'Cancelado', 'Debitado', 'Negativo'].includes(e)) return;
        if (filtroChoferMapaId && r.chofer_asignado_id !== filtroChoferMapaId) return;

        // Lógica de filtros de estado y tiempo
        if (filtroMapaActual === 'Pendientes' && e !== 'Pendiente') return;
        if (filtroMapaActual === 'Asignados' && !['Asignado', 'En Origen', 'Viaje Iniciado'].includes(e)) return;
        if (filtroMapaActual === 'En Curso' && e !== 'En Curso') return;

        if (filtroHorasMapa !== null && r.fecha_turno) {
            const fechaReserva = new Date(`${r.fecha_turno}T${r.hora_pickup || r.hora_turno || '00:00'}`);
            const diffHoras = (fechaReserva - ahora) / (1000 * 60 * 60);
            if (diffHoras < -1 || diffHoras > filtroHorasMapa) return;
        }

        idsDeReservasActivas.add(r.id);
        let posicion = (['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords?.latitude) 
            ? { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude } 
            : { lat: r.origen_coords?.latitude, lng: r.origen_coords?.longitude };

        if (!posicion.lat) return;

        const icono = idsSeleccionados.includes(r.id) ? crearIconoDePin('#007BFF', '✓') : _getIconoParaReserva(r, e);
        
        if (marcadoresReservas[r.id]) { 
            marcadoresReservas[r.id].position = posicion; 
            marcadoresReservas[r.id].content = icono; 
        } else {
            const m = new AdvancedMarkerElement({ position: posicion, map: map, content: icono });
            m.addListener('click', (ev) => {
                isMultiSelectMode ? handleMarkerSelection(r) : mostrarMenuContextualReserva(ev, r, e);
            });
            marcadoresReservas[r.id] = m;
        }
    }); 

    Object.keys(marcadoresReservas).forEach(id => { 
        if (!idsDeReservasActivas.has(id)) { 
            marcadoresReservas[id].map = null; 
            delete marcadoresReservas[id]; 
        } 
    });
}

// --- 4. UBICACIÓN DE CHOFERES (ACTUALIZADO A ADVANCED MARKERS) ---
export async function escucharUbicacionChoferes() {
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    if (unsubscribeChoferes) unsubscribeChoferes();

    unsubscribeChoferes = db.collection('choferes').onSnapshot(snap => {
        const mostrar = document.getElementById('toggle-choferes')?.checked;
        snap.docChanges().forEach(change => {
            const d = change.doc.data(), id = change.doc.id;
            if (change.type === 'removed' || (!d.coordenadas && !d.posicion)) {
                if(marcadoresChoferes[id]) { marcadoresChoferes[id].map = null; delete marcadoresChoferes[id]; }
                return;
            }
            const coords = d.coordenadas || d.posicion;
            const pos = { lat: coords.latitude, lng: coords.longitude };
            const movil = cachesRef.moviles.find(m => m.id === d.movil_actual_id);
            const n = movil ? movil.numero : '?';
            
            const color = d.esta_en_linea ? '#23477b' : '#808080';
            const content = document.createElement('div');
            content.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="21" fill="${color}" stroke="white" stroke-width="2"/><text x="22" y="28" font-family="Arial" font-size="17px" font-weight="bold" fill="white" text-anchor="middle">${n}</text></svg>`;

            if (marcadoresChoferes[id]) { 
                marcadoresChoferes[id].position = pos;
                marcadoresChoferes[id].content = content;
            } else { 
                marcadoresChoferes[id] = new AdvancedMarkerElement({ position: pos, map: map, content: content }); 
            }
            const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
            marcadoresChoferes[id].content.style.display = (mostrar && coincideFiltro) ? 'block' : 'none';
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

export function getSelectedReservasIds() { return Array.from(selectedReservas.keys()); }
export function actualizarMarcadorMapa(id, isSelected) { cargarMarcadoresDeReservas(); }
function handleMarkerSelection(reserva) {
    const fila = document.querySelector(`tr[data-id="${reserva.id}"]`);
    window.app.toggleTableSelection(reserva.id, fila);
}

// --- 6. AUTOCOMPLETE (CORREGIDO) ---
export async function activarAutocomplete(inputElement) {
    if (!inputElement) return;
    const { Autocomplete } = await google.maps.importLibrary("places");
    
    const autocomplete = new Autocomplete(inputElement, {
        componentRestrictions: { country: "ar" },
        fields: ["geometry", "formatted_address"],
        //types: ["address"]
    });

    autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        coordenadasInputs.set(inputElement, place.geometry.location);
        if (window.app?.calcularYMostrarRuta) window.app.calcularYMostrarRuta();
        else calcularYMostrarRuta();
    });
}

// --- 7. MODAL Y RUTAS ---
export async function initMapaModal() {
    const c = document.getElementById("mapa-modal-container");
    if (!c) return;
    const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
    const { Map } = await google.maps.importLibrary("maps");
    
    if (!directionsService) directionsService = new DirectionsService();
    if (!directionsRenderer) directionsRenderer = new DirectionsRenderer({ draggable: true, map: null, suppressMarkers: true, polylineOptions: { strokeColor: "#1877f2", strokeWeight: 5 } });
    if (!mapaModal) mapaModal = new Map(c, { center: { lat: -32.95, lng: -60.65 }, zoom: 13, mapId: "MODAL_MAP_ID" });
    
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
            const loc = coordenadasInputs.get(input);
            if (loc) puntosValidos.push({ location: loc });
            else {
                const res = await geocodificar(input.value);
                if (res && res[0]) {
                    coordenadasInputs.set(input, res[0].geometry.location);
                    puntosValidos.push({ location: res[0].geometry.location });
                }
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
    
            // 🚀 CORRECCIÓN: Usamos solo puntosValidos y el flag esCarpooling en false
            renderizarPuntosRuta(puntosValidos, mapaModal, false); 

            let dist = 0, dur = 0;
            response.routes[0].legs.forEach(leg => { dist += leg.distance.value; dur += leg.duration.value; });
            const minutosCalculados = Math.ceil(dur / 60);
            document.getElementById('distancia_total_input').value = (dist / 1000).toFixed(2) + " km";
            document.getElementById('tiempo_total_input').value = minutosCalculados + " min";

            // 🚀 GUARDAMOS EL NÚMERO Y DISPARAMOS EL EVENTO
            const inputOculto = document.getElementById('duracion_estimada_minutos');
            if (inputOculto) {
                inputOculto.value = minutosCalculados; 
                inputOculto.dispatchEvent(new Event('change')); 
            }
        }
    });
}

// --- 8. UTILIDADES ---
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
    if (mapContextMenu) mapContextMenu.style.display = 'none'; 
}

function mostrarMenuContextualReserva(event, reserva, estado) {
    if (!mapContextMenu) return;
    mapContextMenu.style.display = 'block';
    mapContextMenu.style.left = `${event.domEvent?.clientX || 0}px`;
    mapContextMenu.style.top = `${event.domEvent?.clientY || 0}px`;
    mapContextMenuItems.innerHTML = `<li><strong>${reserva.nombre_pasajero}</strong></li><hr><li><button onclick="window.app.openEditReservaModal('${reserva.id}')">✏️ Editar</button></li>`;
}

export function crearIconoDePin(color, texto) {
    const div = document.createElement('div');
    div.innerHTML = `<svg width="42" height="56" viewBox="0 0 42 56"><path d="M21 0C11.64 0 4 7.64 4 18c0 14 17 38 17 38s17-24 17-38C38 7.64 30.36 0 21 0Z" fill="${color}"/><circle cx="21" cy="18" r="15" fill="white"/><text x="21" y="24" font-family="Arial" font-size="14px" font-weight="bold" fill="#333" text-anchor="middle">${texto}</text></svg>`;
    return div;
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

/**
 * Traza una ruta consolidada en el mapa del modal para múltiples viajes.
 * @param {Array} ids - Array de IDs de reservas seleccionadas
 */
export async function mostrarRutaConsolidada(ids) {
    if (!directionsService || !mapaModal || !ids || ids.length === 0) return;

    // 1. Obtener los datos completos de las reservas seleccionadas
    const snapshot = lastReservasSnapshotRef();
    const seleccionadas = ids.map(id => {
        const doc = snapshot.docs.find(d => d.id === id);
        return doc ? { id: doc.id, ...doc.data() } : null;
    }).filter(r => r && r.origen_coords && r.destino_coords);

    if (seleccionadas.length < 1) return;

    // 2. Organizar puntos: [Origen 1, Origen 2... Destino 1, Destino 2...]
    // Esto asegura que el chofer busque a todos antes de empezar las descargas.
    const puntosRuta = [];
    seleccionadas.forEach(r => puntosRuta.push(r.origen_coords));
    seleccionadas.forEach(r => puntosRuta.push(r.destino_coords));

    const origenRuta = new google.maps.LatLng(puntosRuta[0].latitude, puntosRuta[0].longitude);
    const destinoFinalRuta = new google.maps.LatLng(puntosRuta[puntosRuta.length - 1].latitude, puntosRuta[puntosRuta.length - 1].longitude);
    
    const waypoints = puntosRuta.slice(1, -1).map(p => ({
        location: new google.maps.LatLng(p.latitude, p.longitude),
        stopover: true
    }));

    // 3. Solicitar y renderizar la ruta
    directionsRenderer.setMap(mapaModal);
    directionsService.route({
        origin: origenRuta,
        destination: destinoFinalRuta,
        waypoints: waypoints,
        optimizeWaypoints: false, // Mantenemos NUESTRO orden (Pickups -> Drop-offs)
        travelMode: 'DRIVING'
    }, (response, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(response);
    
             // 🚀 AGREGAR ESTO: Convierte las coordenadas y dibuja los pines A,B (Verde) y 1,2 (Rojo)
            const puntosParaMarker = puntosRuta.map(p => ({ 
               location: { lat: p.latitude, lng: p.longitude } 
         }));
             renderizarPuntosRuta(puntosParaMarker, mapaModal, true);
            
            // Actualizamos los totales del panel para que el operador vea el impacto
            let distTotal = 0;
            let tiempoTotal = 0;
            response.routes[0].legs.forEach(leg => {
                distTotal += leg.distance.value;
                tiempoTotal += leg.duration.value;
            });

            const distInput = document.getElementById('distancia_total_input');
            const tiempoInput = document.getElementById('tiempo_total_input');
            const durTotalMinutos = Math.ceil(tiempoTotal / 60);

            if (distInput) distInput.value = (distTotal / 1000).toFixed(2) + " km";
            if (tiempoInput) tiempoInput.value = durTotalMinutos + " min";

            // 🚀 ACTUALIZAMOS EL CAMPO OCULTO AQUÍ TAMBIÉN
            const inputOculto = document.getElementById('duracion_estimada_minutos');
            if (inputOculto) {
                inputOculto.value = durTotalMinutos;
                inputOculto.dispatchEvent(new Event('change'));
            }
        }
    });
}

function limpiarMarcadoresRutaModal() {
    marcadoresRutaModal.forEach(m => m.map = null);
    marcadoresRutaModal = [];
}

async function renderizarPuntosRuta(puntos, mapa, esCarpooling = false) {
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    limpiarMarcadoresRutaModal();

    const letras = ['A', 'B', 'C', 'D'];
    const numOrigenes = esCarpooling ? puntos.length / 2 : puntos.length - 1;

    puntos.forEach((p, index) => {
        let color, texto;
        const pos = {
            lat: typeof p.location.lat === 'function' ? p.location.lat() : p.location.lat,
            lng: typeof p.location.lng === 'function' ? p.location.lng() : p.location.lng
        };

        if (index < numOrigenes) {
            color = '#28a745'; // 🟢 Verde para Orígenes
            texto = letras[index] || (index + 1).toString();
        } else {
            color = '#dc3545'; // 🔴 Rojo para Destinos
            texto = esCarpooling ? (index - numOrigenes + 1).toString() : '🏁';
        }

        const marker = new AdvancedMarkerElement({
            position: pos,
            map: mapa,
            content: crearIconoDePin(color, texto)
        });
        marcadoresRutaModal.push(marker);
    });
}