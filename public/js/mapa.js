// js/mapa.js - VERSIÓN FINAL CORREGIDA PARA FILTROS Y MÓVILES
import { db } from './firebase-config.js';

let map, mapaModal, directionsService, directionsRenderer, geocoder;
let coordenadasInputs = new Map(); 
let marcadoresReservas = {}, marcadoresChoferes = {}, infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;

// VARIABLES DE ESTADO PARA FILTROS
let filtroMapaActual = 'Todos'; 
let filtroHorasMapa = null; 
let filtroChoferMapaId = null;

let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;
let isMultiSelectMode = false, selectedReservas = new Map(), marcadoresRuta = []; 

export function initMapa(caches, getLatestSnapshot) {
    cachesRef = caches; 
    lastReservasSnapshotRef = getLatestSnapshot;
    mapContextMenu = document.getElementById('map-context-menu');
    mapContextMenuItems = document.getElementById('map-context-menu-items');
    
    document.getElementById('filtro-chofer-mapa')?.addEventListener('change', (e) => {
        filtrarMapaPorChofer(e.target.value);
    });

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
        if (typeof lastReservasSnapshotRef === 'function' && lastReservasSnapshotRef()) cargarMarcadoresDeReservas();
    }
}

export async function initMapaModal(origenCoords, destinoCoords) {
    const c = document.getElementById("mapa-modal-container");
    if (!c) return;
    limpiarMarcadoresRuta(); coordenadasInputs.clear();
    const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
    const { Map } = await google.maps.importLibrary("maps");
    if (!geocoder) { const { Geocoder } = await google.maps.importLibrary("geocoding"); geocoder = new Geocoder(); }
    if (!directionsService) directionsService = new DirectionsService();
    if (!directionsRenderer) {
        directionsRenderer = new DirectionsRenderer({
            draggable: true, map: null, suppressMarkers: true, preserveViewport: false,
            polylineOptions: { strokeColor: "#1877f2", strokeWeight: 5 }
        });
        directionsRenderer.addListener('directions_changed', () => {
            const result = directionsRenderer.getDirections();
            if (result) procesarResultadosRuta(result);
        });
    }
    if (!mapaModal) mapaModal = new Map(c, { center: { lat: -32.95, lng: -60.65 }, zoom: 13 });
    const inputDestino = document.getElementById('destino');
    if (inputDestino) activarAutocomplete(inputDestino);
    directionsRenderer.setMap(null); setTimeout(calcularYMostrarRuta, 500);
}

function limpiarMarcadoresRuta() { if (marcadoresRuta) marcadoresRuta.forEach(m => m.setMap(null)); marcadoresRuta = []; }

export async function calcularYMostrarRuta() {
    if (!directionsService || !mapaModal) return;
    const inputsOrigen = Array.from(document.querySelectorAll('.origen-input'));
    const inputDestino = document.getElementById('destino');
    let todosLosInputs = [...inputsOrigen]; if (inputDestino) todosLosInputs.push(inputDestino);
    let puntosValidos = [];
    for (const input of todosLosInputs) {
        if (input.value.trim().length > 0) {
            let loc = coordenadasInputs.get(input);
            if (!loc) {
                const res = await geocodificar(input.value);
                if (res && res[0]) { loc = res[0].geometry.location; coordenadasInputs.set(input, loc); }
            }
            if (loc) puntosValidos.push({ location: loc });
        }
    }
    if (puntosValidos.length < 2) { if (directionsRenderer) directionsRenderer.setMap(null); return; }
    directionsRenderer.setMap(mapaModal);
    const request = {
        
        origin: puntosValidos[0].location,
        destination: puntosValidos[puntosValidos.length - 1].location,
        waypoints: puntosValidos.slice(1, -1).map(p => ({ location: p.location, stopover: true })),
        travelMode: 'DRIVING'
    };

    // 2. Llamada al servicio de rutas
    directionsService.route(request, (response, status) => {
        if (status === 'OK') {
            directionsRenderer.setDirections(response);

            // --- LÓGICA CORREGIDA: Suma de todos los tramos ---
            let totalDistanciaMetros = 0;
            let totalDuracionSegundos = 0;
            const ruta = response.routes[0];

            // Recorremos todos los tramos (legs) del viaje
            for (let i = 0; i < ruta.legs.length; i++) {
                totalDistanciaMetros += ruta.legs[i].distance.value;
                totalDuracionSegundos += ruta.legs[i].duration.value;
            }

            const duracionEnMinutos = Math.ceil(totalDuracionSegundos / 60);
            const distanciaKm = (totalDistanciaMetros / 1000).toFixed(2);

            // Actualizamos los campos del formulario
            if (document.getElementById('duracion_estimada_minutos')) {
                document.getElementById('duracion_estimada_minutos').value = duracionEnMinutos;
            }
            if (document.getElementById('distancia_total_input')) {
                document.getElementById('distancia_total_input').value = distanciaKm + " km";
            }
            if (document.getElementById('tiempo_total_input')) {
                document.getElementById('tiempo_total_input').value = duracionEnMinutos + " min";
            }

        } else {
            console.error("Error al calcular ruta: " + status);
        }
    }); // Cierre del directionsService.route
}   // Cierre de la función calcularYMostrarRuta

function geocodificar(address) { 
    let fullAddress = address;
    // Evita duplicar "Argentina" si ya viene del Autocomplete
    if (!address.includes("Argentina")) {
        fullAddress += ", Santa Fe, Argentina";
    }
    return new Promise((resolve) => { 
        geocoder.geocode({ 'address': fullAddress }, (results, status) => { 
            if (status === 'OK') resolve(results);
            else resolve(null);
        }); 
    }); 
}


function procesarResultadosRuta(response) {
    const legs = response.routes[0].legs; let dist = 0, time = 0; limpiarMarcadoresRuta();
    crearMarcadorManual(legs[0].start_location, "A", "Origen", "#1877f2");
    legs.forEach((leg, i) => { dist += leg.distance.value; time += leg.duration.value; crearMarcadorManual(leg.end_location, String.fromCharCode(66 + i), i === legs.length - 1 ? "Destino" : "Parada", "#1877f2"); });
    const inputDist = document.getElementById('distancia_total_input'), inputTime = document.getElementById('tiempo_total_input');
    const inputMinutosOculto = document.getElementById('duracion_estimada_minutos');
    if (inputDist) inputDist.value = (dist / 1000).toFixed(1) + ' km'; if (inputTime) inputTime.value = Math.round(time / 60) + ' min';
    if (inputMinutosOculto) inputMinutosOculto.value = Math.round(time / 60);
}

function crearMarcadorManual(posicion, etiqueta, titulo, color) { const marker = new google.maps.Marker({ position: posicion, map: mapaModal, icon: crearIconoDePin(color, etiqueta), title: titulo }); marcadoresRuta.push(marker); }

export async function activarAutocomplete(inputElement) {
    if (!inputElement) return; const { Autocomplete } = await google.maps.importLibrary("places");
    const autocomplete = new Autocomplete(inputElement, { fields: ["formatted_address", "geometry"], componentRestrictions: { country: "ar" } });
    autocomplete.addListener('place_changed', () => { const place = autocomplete.getPlace(); if (place && place.geometry) { coordenadasInputs.set(inputElement, place.geometry.location); calcularYMostrarRuta(); } });
}

export async function openEditReservaModal(reservaId, caches, initMapaModalCallback) {
    const inputDestino = document.getElementById('destino'); if (inputDestino) activarAutocomplete(inputDestino);
    const primerInputOrigen = document.querySelector('.origen-input'); if (primerInputOrigen) activarAutocomplete(primerInputOrigen);
}

export function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshotRef()) return;
    const idsDeReservasActivas = new Set();
    const ahora = new Date();
    
    lastReservasSnapshotRef().forEach(doc => {
        const r = { id: doc.id, ...doc.data() };
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        if (e === 'Anulado' || e === 'Finalizado' || e === 'Cancelado') return;
        
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
                if (diffHoras < 0 || diffHoras > filtroHorasMapa) return;
            }
        }

        idsDeReservasActivas.add(r.id);
        let posicion = (['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords?.latitude) ? { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude } : { lat: r.origen_coords?.latitude, lng: r.origen_coords?.longitude };
        if (!posicion.lat) return;
        const idsSeleccionados = window.app.getSelectedReservasIds();
        let icono = idsSeleccionados.includes(r.id) ? crearIconoDePin('#007BFF', '✓') : _getIconoParaReserva(r, e);
        
        if (marcadoresReservas[r.id]) { 
            marcadoresReservas[r.id].setPosition(posicion); 
            marcadoresReservas[r.id].setIcon(icono); 
        } else {
            marcadoresReservas[r.id] = new google.maps.Marker({ position: posicion, map: map, icon: icono });
            marcadoresReservas[r.id].addListener('click', () => { if (isMultiSelectMode) handleMarkerSelection(r); else { if (infoWindowActiva) infoWindowActiva.close(); infoWindowActiva = new google.maps.InfoWindow({ content: `<strong>${r.nombre_pasajero}</strong><br>${r.origen}` }); infoWindowActiva.open(map, marcadoresReservas[r.id]); } });
            marcadoresReservas[r.id].addListener('dblclick', () => { if (!isMultiSelectMode) window.app.openEditReservaModal(r.id); });
            marcadoresReservas[r.id].addListener('rightclick', (event) => { if (!isMultiSelectMode) mostrarMenuContextualReserva(event, r, e); });
        }
    });
    Object.keys(marcadoresReservas).forEach(id => { if (!idsDeReservasActivas.has(id)) { marcadoresReservas[id].setMap(null); delete marcadoresReservas[id]; } });
}

function _getIconoParaReserva(reserva, e) {
    if (['Viaje Iniciado', 'En Origen'].includes(e)) { const movil = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id); return crearIconoDePin('#27DAF5', movil ? movil.numero.toString() : '?'); }
    let colorFondo, textoIcono = '';
    switch (e) {
        case 'En Curso': colorFondo = '#F54927'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        case 'Asignado': colorFondo = (reserva.estado?.detalle === 'Aceptada') ? '#4DF527' : '#F5A623'; const movilA = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id); textoIcono = movilA ? movilA.numero.toString() : '?'; break;
        case 'Pendiente': colorFondo = '#C15DE8'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        default: colorFondo = '#808080'; textoIcono = '•'; break;
    }
    return crearIconoDePin(colorFondo, textoIcono);
}

function handleMarkerSelection(reserva) {
    // Buscamos si la fila de este viaje está visible en alguna tabla
    const fila = document.querySelector(`tr[data-id="${reserva.id}"]`);
    
    // Llamamos a la función de main.js para que agregue el ID al Set global
    // y resalte la fila si la encontró
    window.app.toggleTableSelection(reserva.id, fila);
    
    // Refrescamos visualmente los marcadores del mapa
    cargarMarcadoresDeReservas();
    
    // Actualizamos el panel (contador, etc)
    const contador = document.getElementById('contador-seleccion');
    if (contador) contador.textContent = window.app.getSelectedReservasIds().length;
}

function actualizarPanelMultiSelect() {
    const panelList = document.getElementById('multi-select-list');
    const contador = document.getElementById('contador-seleccion');
    const btnAsignar = document.getElementById('btn-assign-multi');
    const btnAnular = document.getElementById('btn-anular-multi');

    if (panelList) {
        panelList.innerHTML = ''; 
        selectedReservas.forEach(r => { 
            const li = document.createElement('li'); 
            li.dataset.id = r.id; // Correcto: ahora el ID viaja en el HTML
            li.textContent = `Pas: ${r.nombre_pasajero}`; 
            panelList.appendChild(li); 
        }); 
    }

    if (contador) contador.textContent = selectedReservas.size;
    const haySeleccion = selectedReservas.size > 0;
    if (btnAsignar) btnAsignar.disabled = !haySeleccion;
    if (btnAnular) btnAnular.disabled = !haySeleccion;
}


function crearIconoDePin(color, texto) {
    const svgIcon = `<svg width="42" height="56" viewBox="0 0 42 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 0C11.64 0 4 7.64 4 18c0 14 17 38 17 38s17-24 17-38C38 7.64 30.36 0 21 0Z" fill="${color}"/><circle cx="21" cy="18" r="15" fill="white"/><text x="21" y="24" font-family="Arial" font-size="15px" font-weight="bold" fill="#333" text-anchor="middle">${texto}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon), scaledSize: new google.maps.Size(42, 56), anchor: new google.maps.Point(21, 56) };
}

export function filtrarMapa(estado) { 
    // Corregimos: Si el HTML manda 'Asignado', lo tratamos como 'Asignados' para que coincida con cargarMarcadoresDeReservas
    filtroMapaActual = (estado === 'Asignado') ? 'Asignados' : estado; 
    
    // Actualizar clase activa en los botones
    document.querySelectorAll('.map-filters .map-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.includes(estado));
    });

    cargarMarcadoresDeReservas(); 
}

export function filtrarMapaPorHoras(horas) { 
    filtroHorasMapa = horas; 
    
    // Esta parte es la que faltaba en tu archivo cargado:
    document.querySelectorAll('.time-filters-map .map-filter-btn').forEach(btn => {
        const texto = (horas === null) ? '24hs' : horas + 'hs';
        btn.classList.toggle('active', btn.innerText.trim() === texto);
    });

    cargarMarcadoresDeReservas(); 
}

export function filtrarMapaPorChofer(choferId) { 
    filtroChoferMapaId = choferId || null; 
    const mostrarMoviles = document.getElementById('toggle-choferes')?.checked;
    toggleChoferesVisibility(mostrarMoviles); 
}

export function toggleChoferesVisibility(mostrar) { 
    Object.entries(marcadoresChoferes).forEach(([id, mark]) => {
        const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
        mark.setVisible(mostrar && coincideFiltro);
    });
}

export function escucharUbicacionChoferes() {
   if (unsubscribeChoferes) unsubscribeChoferes();
    unsubscribeChoferes = db.collection('choferes').onSnapshot(snap => {
        const mostrar = document.getElementById('toggle-choferes')?.checked;
        snap.docChanges().forEach(change => {
            const d = change.doc.data(), id = change.doc.id;
            if (change.type === 'removed' || !d.coordenadas) {
                if(marcadoresChoferes[id]) { marcadoresChoferes[id].setMap(null); delete marcadoresChoferes[id]; }
                return;
            }
            const pos = { lat: d.coordenadas.latitude, lng: d.coordenadas.longitude };
            const movil = cachesRef.moviles.find(m => m.id === d.movil_actual_id);
            const icon = { 
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="22" r="21" fill="${d.esta_en_linea ? '#23477b' : '#808080'}" stroke="white" stroke-width="2"/><text x="22" y="28" font-family="Arial" font-size="17px" font-weight="bold" fill="white" text-anchor="middle">${movil ? movil.numero : '?'}</text></svg>`), 
                scaledSize: new google.maps.Size(44, 44), 
                anchor: new google.maps.Point(22, 22) 
            };
            
            if (marcadoresChoferes[id]) { 
                marcadoresChoferes[id].setPosition(pos); // CORREGIDO: Usaba marcadoresReservas por error
                marcadoresChoferes[id].setIcon(icon);
            } else { 
                marcadoresChoferes[id] = new google.maps.Marker({ position: pos, map: map, icon: icon }); 
            }
            
            const coincideFiltro = !filtroChoferMapaId || id === filtroChoferMapaId;
            marcadoresChoferes[id].setVisible(mostrar && coincideFiltro);
        });
    });
}

export function hideMapContextMenu() { const menu = document.getElementById('map-context-menu'); if (menu) menu.style.display = 'none'; }

function mostrarMenuContextualReserva(event, reserva, estado) {
    event.domEvent.preventDefault(); hideMapContextMenu();
    let menuHTML = ''; const rId = reserva.id;
    if (['En Curso', 'Pendiente'].includes(estado)) menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}')">Editar</a></li><li><select onchange="window.app.asignarMovil('${rId}', this.value)"><option value="">Asignar...</option>${cachesRef.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('')}</select></li><li><a onclick="window.app.changeReservaState('${rId}', 'Anulado')">Anular</a></li>`;
    else menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}')">Editar</a></li><li><a onclick="window.app.finalizarReserva('${rId}')">Finalizar</a></li><li><a onclick="window.app.quitarAsignacion('${rId}')">Quitar Móvil</a></li>`;
    if (mapContextMenuItems) { mapContextMenuItems.innerHTML = menuHTML; mapContextMenu.style.left = `${event.domEvent.clientX}px`; mapContextMenu.style.top = `${event.domEvent.clientY}px`; mapContextMenu.style.display = 'block'; }
}

export function toggleMultiSelectMode() { 
    isMultiSelectMode = !isMultiSelectMode;
    const panel = document.getElementById('multi-select-panel');
    
    if (panel) {
        panel.style.display = isMultiSelectMode ? 'block' : 'none';
        
        // Poblamos el select del panel si se abre
        if (isMultiSelectMode) {
            const sel = document.getElementById('select-movil-multi');
            if (sel && cachesRef.moviles) {
                sel.innerHTML = '<option value="">Seleccionar móvil...</option>' + 
                    cachesRef.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('');
            }
        }
    }

    if (!isMultiSelectMode) {
        selectedReservas.clear();
        cargarMarcadoresDeReservas();
    }
}

export function getModalMarkerCoords() { 
    const inputs = Array.from(document.querySelectorAll('.origen-input')); const inputDestino = document.getElementById('destino');
    const limpiarCoordenada = (input) => {
        const coord = coordenadasInputs.get(input); if (!coord) return null;
        return { latitude: typeof coord.lat === 'function' ? coord.lat() : coord.lat, longitude: typeof coord.lng === 'function' ? coord.lng() : coord.lng };
    };
    return { origen: limpiarCoordenada(inputs[0]), destino: limpiarCoordenada(inputDestino) }; 
}

export function getSelectedReservasIds() {
    return Array.from(selectedReservas.keys());
}

export function actualizarMarcadorMapa(id, isSelected) {
    if (marcadoresReservas[id]) {
        const r = { id: id }; // Objeto mínimo para el icono
        // Forzamos el refresco del marcador
        cargarMarcadoresDeReservas(); 
    }
}