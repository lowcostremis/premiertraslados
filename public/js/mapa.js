// js/mapa.js
// VERSIÓN CORREGIDA: Fuerza la obtención de coordenadas antes de calcular la ruta

import { db } from './firebase-config.js';

// --- VARIABLES ---
let map, mapaModal;
let directionsService, directionsRenderer; 
let geocoder;

// Cache para guardar las coordenadas exactas
let coordenadasInputs = new Map(); 

// Marcadores del Dashboard Principal
let marcadoresReservas = {};
let marcadoresChoferes = {};
let infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;
let filtroMapaActual = 'Todos', filtroHorasMapa = null, filtroChoferMapaId = null;
let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;

// Variables Selección Múltiple
let isMultiSelectMode = false;
let selectedReservas = new Map();

// Variables del Modal (Rutas)
let marcadoresRuta = []; 

// --- INICIALIZACIÓN ---
export function initMapa(caches, getLatestSnapshot) {
    cachesRef = caches;
    lastReservasSnapshotRef = getLatestSnapshot;
    mapContextMenu = document.getElementById('map-context-menu');
    mapContextMenuItems = document.getElementById('map-context-menu-items');
    
    document.getElementById('filtro-chofer-mapa').addEventListener('change', (e) => filtrarMapaPorChofer(e.target.value));
    document.getElementById('toggle-choferes').addEventListener('change', (e) => toggleChoferesVisibility(e.target.checked));

    initMapInstance();
    escucharUbicacionChoferes();
}

export async function initMapInstance() {
    const c = document.getElementById("map-container");
    if (c && !map) {
        // Carga dinámica de librerías
        const { Map } = await google.maps.importLibrary("maps");
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        
        geocoder = new Geocoder();
        map = new Map(c, { center: { lat: -32.9566, lng: -60.6577 }, zoom: 12 });
        
        map.addListener('click', hideMapContextMenu);
        map.addListener('rightclick', (event) => {
            event.domEvent.preventDefault();
            hideMapContextMenu(); 
        });
        
        await google.maps.importLibrary("routes");

        if (typeof lastReservasSnapshotRef === 'function' && lastReservasSnapshotRef()) {
            cargarMarcadoresDeReservas();
        }
    }
}

// =========================================================
//  LÓGICA DEL MAPA MODAL (RUTAS + MARCADORES)
// =========================================================

export async function initMapaModal(origenCoords, destinoCoords) {
    const c = document.getElementById("mapa-modal-container");
    if (!c) return;
    
    limpiarMarcadoresRuta();
    coordenadasInputs.clear();

    const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
    const { Map } = await google.maps.importLibrary("maps");
    
    // Aseguramos geocoder
    if (!geocoder) {
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        geocoder = new Geocoder();
    }

    if (!directionsService) directionsService = new DirectionsService();
    if (!directionsRenderer) {
        directionsRenderer = new DirectionsRenderer({
            draggable: true, 
            map: null, 
            suppressMarkers: true, 
            preserveViewport: false,
            polylineOptions: {
                strokeColor: "#1877f2", // Azul clásico de Google
                strokeWeight: 5
            }
        });
        
        directionsRenderer.addListener('directions_changed', () => {
            const result = directionsRenderer.getDirections();
            if (result) procesarResultadosRuta(result);
        });
    }

    if (!mapaModal) {
        mapaModal = new Map(c, { center: { lat: -32.95, lng: -60.65 }, zoom: 13 });
    }
    
    directionsRenderer.setMap(null);
    
    // Intentamos calcular ruta si hay datos cargados
    setTimeout(calcularYMostrarRuta, 500);
}

function limpiarMarcadoresRuta() {
    if (marcadoresRuta && marcadoresRuta.length > 0) {
        marcadoresRuta.forEach(m => m.setMap(null));
    }
    marcadoresRuta = [];
}

// --- FUNCIÓN PRINCIPAL: CALCULAR RUTA ---
// REEMPLAZA SOLO LA FUNCIÓN calcularYMostrarRuta EN js/mapa.js

export async function calcularYMostrarRuta() {
    if (!directionsService || !mapaModal) return;

    // 1. RECOLECTAR TODOS LOS INPUTS EN ORDEN VISUAL
    // Tomamos todos los orígenes (inputs dinámicos) y al final agregamos el input de destino fijo
    const inputsOrigen = Array.from(document.querySelectorAll('.origen-input'));
    const inputDestino = document.getElementById('destino');
    
    // Creamos una lista única ordenada: [Origen 1, Origen 2, ..., Destino]
    let todosLosInputs = [...inputsOrigen];
    if (inputDestino) todosLosInputs.push(inputDestino);
    
    // Lista para guardar las coordenadas validadas en orden
    let puntosValidos = [];

    // --- FUNCIÓN AUXILIAR DE GEOCODIFICACIÓN ---
    const obtenerCoordenadaSegura = async (input) => {
        const val = input.value.trim();
        if (!val) return null;

        // A. Si ya tenemos la coordenada exacta en caché (del Autocomplete)
        if (coordenadasInputs.has(input)) {
            return { location: coordenadasInputs.get(input) };
        }

        // B. Si es texto nuevo, lo convertimos a coordenadas YA MISMO (Geocoding)
        // Esto evita que la API de Rutas falle por no entender el texto
        try {
            const results = await geocodificar(val);
            if (results && results[0] && results[0].geometry) {
                const loc = results[0].geometry.location;
                coordenadasInputs.set(input, loc); // Guardamos para no repetir
                return { location: loc };
            }
        } catch (e) {
            console.log("Geocoding interno falló para:", val);
        }
        
        // C. Si todo falla, devolvemos null (no usamos texto crudo para evitar errores de ruta)
        return null;
    };

    // 2. PROCESAR CADA INPUT SECUENCIALMENTE
    for (const input of todosLosInputs) {
        // Solo procesamos si el input tiene texto escrito
        if (input.value.trim().length > 0) {
            const coord = await obtenerCoordenadaSegura(input);
            if (coord) {
                puntosValidos.push(coord);
            }
        }
    }

    // 3. VALIDACIÓN DE CANTIDAD DE PUNTOS
    // Si hay menos de 2 puntos válidos, no podemos trazar una línea (necesitamos al menos A y B)
    if (puntosValidos.length < 2) {
        if (directionsRenderer) directionsRenderer.setMap(null);
        
        // Borramos los cálculos de km y tiempo
        const inputDist = document.getElementById('distancia_total_input');
        const inputTime = document.getElementById('tiempo_total_input');
        if (inputDist) inputDist.value = '';
        if (inputTime) inputTime.value = '';

        // Dibujamos el único punto que haya (si hay uno) como marcador suelto
        let unicoPunto = puntosValidos.length > 0 ? puntosValidos[0].location : null;
        dibujarPuntosSueltos(unicoPunto, [], null);
        return; 
    }

    // 4. ARMADO DE LA RUTA
    // La lógica mágica: El primero es Origen, el último es Destino, los del medio son Waypoints
    
    const finalOrigin = puntosValidos[0].location; // El primero de la lista
    const finalDest = puntosValidos[puntosValidos.length - 1].location; // El último de la lista (sea cual sea el input)
    
    // Los waypoints son todos los puntos entre el primero y el último
    // .slice(1, -1) corta el array excluyendo el primero y el último
    const waypointsData = puntosValidos.slice(1, -1).map(p => ({
        location: p.location,
        stopover: true // Indica que es una parada real (el chofer se detiene)
    }));

    // 5. LLAMADA A LA API DE GOOGLE
    directionsRenderer.setMap(mapaModal);

    const request = {
        origin: finalOrigin,
        destination: finalDest,
        waypoints: waypointsData,
        optimizeWaypoints: false, // False para respetar estrictamente el orden que pusiste
        travelMode: 'DRIVING'
    };

    directionsService.route(request, (response, status) => {
        if (status === "OK") {
            directionsRenderer.setDirections(response);
            procesarResultadosRuta(response); // Esto calcula los km totales y el tiempo
        } else {
            console.warn("No se pudo calcular la ruta:", status);
            directionsRenderer.setMap(null);
            dibujarPuntosSueltos(finalOrigin, waypointsData, finalDest);
        }
    });
}

// Dibuja marcadores individuales si no hay ruta (Backup Plan)
async function dibujarPuntosSueltos(origin, waypoints, destination) {
    limpiarMarcadoresRuta();
    
    // Aseguramos carga de Geocoder
    if (!geocoder) {
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        geocoder = new Geocoder();
    }

    const reservaId = document.getElementById('reserva-id').value;
    const color = determinarColorReservaActual(reservaId);
    
    let puntos = [];
    
    const pushPunto = (ubicacion, label, title) => {
        if (!ubicacion) return;
        if (typeof ubicacion === 'object' && (ubicacion.lat || ubicacion.location)) {
             puntos.push({ location: ubicacion, label, title, esCoordenada: true });
        } else {
             let textoLimpio = ubicacion;
             if (textoLimpio.includes("CFV,")) textoLimpio = textoLimpio.replace("CFV,", "").trim();
             puntos.push({ address: textoLimpio, label, title, esCoordenada: false });
        }
    };

    if (origin) pushPunto(origin, "A", "Origen");
    
    if (waypoints) {
        waypoints.forEach((wp, idx) => {
            const charCode = origin ? 66 + idx : 65 + idx;
            pushPunto(wp.location, String.fromCharCode(charCode), "Parada");
        });
    }

    if (destination) {
        const charCode = 65 + puntos.length; 
        pushPunto(destination, String.fromCharCode(charCode), "Destino");
    }

    const bounds = new google.maps.LatLngBounds();

    for (const pt of puntos) {
        try {
            let location = null;
            if (pt.esCoordenada) {
                location = pt.location;
            } else {
                const results = await geocodificar(pt.address);
                if (results && results[0]) location = results[0].geometry.location;
            }

            if (location) {
                crearMarcadorManual(location, pt.label, pt.title, color);
                bounds.extend(location);
            }
        } catch (e) { console.log("Error dibujando punto:", e); }
    }

    if (!bounds.isEmpty()) {
        mapaModal.fitBounds(bounds);
        if (mapaModal.getZoom() > 15) mapaModal.setZoom(15);
    }
}

function geocodificar(address) {
    return new Promise((resolve) => {
        if(!geocoder) return resolve(null);
        geocoder.geocode({ 'address': address }, (results, status) => {
            if (status === 'OK') resolve(results);
            else {
                console.log("Geocode falló para:", address, status);
                resolve(null);
            }
        });
    });
}

function procesarResultadosRuta(response) {
    const route = response.routes[0];
    const legs = route.legs;
    let distanciaTotalMetros = 0;
    let tiempoTotalSegundos = 0;

    document.querySelectorAll('.distancia-info-tag').forEach(el => el.remove());
    limpiarMarcadoresRuta(); 

    const reservaId = document.getElementById('reserva-id').value;
    const colorEstado = determinarColorReservaActual(reservaId);

    const containerOrigenes = document.getElementById('origenes-container');
    const divGroups = containerOrigenes.querySelectorAll('.input-group-origen');

    // Inicio (A)
    crearMarcadorManual(legs[0].start_location, "A", "Origen: " + legs[0].start_address, colorEstado);

    legs.forEach((leg, index) => {
        distanciaTotalMetros += leg.distance.value;
        tiempoTotalSegundos += leg.duration.value;

        if (index < divGroups.length) {
            const targetDiv = divGroups[index];
            const infoDiv = document.createElement('div');
            infoDiv.className = 'distancia-info-tag';
            infoDiv.style.cssText = 'font-size: 11px; color: #1877f2; margin-left: 20px; font-weight: bold; margin-bottom: 5px;';
            infoDiv.innerHTML = `⬇ ${leg.distance.text} (${leg.duration.text})`;
            targetDiv.parentNode.insertBefore(infoDiv, targetDiv.nextSibling);
        }

        const letraMarcador = String.fromCharCode('B'.charCodeAt(0) + index);
        const esDestinoFinal = (index === legs.length - 1);
        const titulo = esDestinoFinal ? "Destino: " + leg.end_address : "Parada: " + leg.end_address;

        crearMarcadorManual(leg.end_location, letraMarcador, titulo, colorEstado);
    });

    const totalKm = (distanciaTotalMetros / 1000).toFixed(1) + ' km';
    const totalMin = Math.round(tiempoTotalSegundos / 60) + ' min';

    const inputDist = document.getElementById('distancia_total_input');
    const inputTime = document.getElementById('tiempo_total_input');
    
    if (inputDist) inputDist.value = totalKm;
    if (inputTime) inputTime.value = totalMin;
}

function determinarColorReservaActual(reservaId) {
    let color = '#C15DE8'; 
    if (reservaId && lastReservasSnapshotRef) {
        const snapshot = lastReservasSnapshotRef();
        if (snapshot && snapshot.docs) {
            const doc = snapshot.docs.find(d => d.id === reservaId);
            if (doc) {
                const data = doc.data();
                const estado = (typeof data.estado === 'object') ? data.estado.principal : data.estado;
                switch (estado) {
                    case 'En Curso': color = '#F54927'; break;
                    case 'Asignado': color = (data.estado.detalle === 'Aceptada') ? '#4DF527' : '#F5A623'; break;
                    case 'Finalizado': color = '#28a745'; break;
                    case 'Anulado': color = '#808080'; break;
                }
            }
        }
    }
    return color;
}

function crearMarcadorManual(posicion, etiqueta, titulo, color) {
    const iconoSvg = crearIconoDePin(color, etiqueta);
    const marker = new google.maps.Marker({
        position: posicion,
        map: mapaModal,
        icon: iconoSvg,
        title: titulo,
        animation: google.maps.Animation.DROP 
    });
    marcadoresRuta.push(marker);
}

// --- AUTOCOMPLETE HÍBRIDO ---
// Intenta usar Google Places, pero captura cambios manuales
export async function activarAutocomplete(inputElement) {
    // Importamos librerías
    const { Autocomplete } = await google.maps.importLibrary("places");
    // Aseguramos geocoder disponible
    if (!geocoder) {
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        geocoder = new Geocoder();
    }

    try {
        const autocomplete = new Autocomplete(inputElement, {
            fields: ["formatted_address", "geometry", "name"],
            componentRestrictions: { country: "ar" },
            strictBounds: false,
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place && place.geometry && place.geometry.location) {
                // Si el autocompletado funcionó bien, guardamos la coordenada
                if (typeof coordenadasInputs !== 'undefined') {
                    coordenadasInputs.set(inputElement, place.geometry.location);
                }
            } 
            calcularYMostrarRuta();
        });

    } catch (e) {
        console.warn("Error iniciando Autocomplete:", e);
    }
    
    // Escucha cambios manuales o selecciones que no dispararon 'place_changed' correctamente
    inputElement.addEventListener('change', () => {
        calcularYMostrarRuta();
    });
}


// =========================================================
//  LÓGICA DEL DASHBOARD PRINCIPAL (MAPA GRANDE)
// =========================================================

export function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshotRef()) return;
    const idsDeReservasActivas = new Set();
    const ahora = new Date();
    const lim = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));
    if (infoWindowActiva) { infoWindowActiva.close(); infoWindowActiva = null; }

    lastReservasSnapshotRef().forEach(doc => {
        const r = { id: doc.id, ...doc.data() };
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        const estValidos = ['En Curso', 'Asignado', 'Pendiente', 'En Origen', 'Viaje Iniciado'];
        if (!estValidos.includes(e)) return;
        
        const estadoOriginal = e;
        if (!r.chofer_asignado_id && e === 'Pendiente') {
            const fT = r.fecha_turno ? new Date(`${r.fecha_turno}T${r.hora_turno || '00:00'}`) : null;
            if (fT && fT <= lim) e = 'En Curso';
        }
        
        const esPendienteDeFuturo = (estadoOriginal === 'Pendiente' && e === 'Pendiente');
        if (filtroMapaActual !== 'Todos') {
            if (filtroMapaActual === 'Pendientes') { if (!esPendienteDeFuturo) return; } 
            else {
                let estadosVisibles = [];
                if (filtroMapaActual === 'Asignados') estadosVisibles = ['Asignado', 'En Origen', 'Viaje Iniciado'];
                else if (filtroMapaActual === 'En Curso') estadosVisibles = ['En Curso', 'En Origen', 'Viaje Iniciado'];
                else estadosVisibles = [filtroMapaActual];
                if (!estadosVisibles.includes(e)) return;
            }
        }
        if (filtroHorasMapa !== null && !esPendienteDeFuturo) {
            const horaReferencia = r.hora_pickup || r.hora_turno;
            if (!r.fecha_turno || !horaReferencia) return;
            const fechaHoraReserva = new Date(`${r.fecha_turno}T${horaReferencia}`);
            const horasDiferencia = (fechaHoraReserva.getTime() - ahora.getTime()) / 3600000;
            if (horasDiferencia > filtroHorasMapa) return;
        }

        idsDeReservasActivas.add(r.id);
        const marcadorExistente = marcadoresReservas[r.id];
        let posicion, icono, titulo;
        icono = _getIconoParaReserva(r, e);

        if (['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords && r.destino_coords.latitude) {
            posicion = { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude }; 
            titulo = `DESTINO: ${r.destino}`;
        } else if (r.origen_coords && r.origen_coords.latitude) {
            posicion = { lat: r.origen_coords.latitude, lng: r.origen_coords.longitude };
            let fechaFormateada = 'Sin Fecha';
            if (r.fecha_turno) { const [year, month, day] = r.fecha_turno.split('-'); fechaFormateada = `${day}/${month}/${year}`; }
            titulo = `Origen: ${r.origen}\nFecha: ${fechaFormateada}\nHora: ${r.hora_turno || 'S/H'}\nEstado: ${e}`;
        } else { 
            if (marcadorExistente) { marcadorExistente.setMap(null); delete marcadoresReservas[r.id]; } 
            return; 
        }

        if (selectedReservas.has(r.id)) { icono = crearIconoDePin('#007BFF', '✓'); }

        if (marcadorExistente) { 
            marcadorExistente.setPosition(posicion); marcadorExistente.setIcon(icono); marcadorExistente.setTitle(titulo); 
        } else {
            marcadoresReservas[r.id] = new google.maps.Marker({ position: posicion, map: map, title: titulo, icon: icono });
            marcadoresReservas[r.id].addListener('click', () => {
                if (isMultiSelectMode) handleMarkerSelection(r);
                else {
                    if (infoWindowActiva) infoWindowActiva.close();
                    const contenido = `<strong>Pasajero:</strong> ${r.nombre_pasajero}<br><strong>Origen:</strong> ${r.origen}<br><strong>Destino:</strong> ${r.destino}<br><strong>Distancia:</strong> ${r.distancia || '--'}`;
                    infoWindowActiva = new google.maps.InfoWindow({ content: contenido });
                    infoWindowActiva.open(map, marcadoresReservas[r.id]);
                }
            });
            marcadoresReservas[r.id].addListener('dblclick', () => { if (!isMultiSelectMode) window.app.openEditReservaModal(r.id); });
            marcadoresReservas[r.id].addListener('rightclick', (event) => { if (!isMultiSelectMode) mostrarMenuContextualReserva(event, r, e); });
        }
    });
    Object.keys(marcadoresReservas).forEach(id => { if (!idsDeReservasActivas.has(id)) { marcadoresReservas[id].setMap(null); delete marcadoresReservas[id]; } });
}

function _getIconoParaReserva(reserva, e) {
    let colorFondo, textoIcono = '';
    if (['Viaje Iniciado', 'En Origen'].includes(e)) {
        const movil = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id);
        const numeroMovil = movil ? movil.numero.toString() : '?';
        return crearIconoDePin('#27DAF5', numeroMovil);
    }
    switch (e) {
        case 'En Curso': colorFondo = '#F54927'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        case 'Asignado': 
            colorFondo = (reserva.estado?.detalle === 'Aceptada') ? '#4DF527' : '#F5A623';
            const movilAsignado = cachesRef.moviles.find(mov => mov.id === reserva.movil_asignado_id);
            if (movilAsignado) textoIcono = movilAsignado.numero.toString();
            break;
        case 'Pendiente': colorFondo = '#C15DE8'; textoIcono = (reserva.hora_pickup || reserva.hora_turno || '').substring(0, 5); break;
        default: colorFondo = '#808080'; textoIcono = '•'; break;
    }
    return crearIconoDePin(colorFondo, textoIcono);
}

function handleMarkerSelection(reserva) {
    const marcador = marcadoresReservas[reserva.id];
    if (!marcador) return;
    if (selectedReservas.has(reserva.id)) {
        selectedReservas.delete(reserva.id);
        const e = (typeof reserva.estado === 'object') ? reserva.estado.principal : reserva.estado;
        marcador.setIcon(_getIconoParaReserva(reserva, e));
    } else { selectedReservas.set(reserva.id, reserva); marcador.setIcon(crearIconoDePin('#007BFF', '✓')); }
    actualizarPanelMultiSelect();
}

function actualizarPanelMultiSelect() {
    const panelList = document.getElementById('multi-select-list');
    const contador = document.getElementById('contador-seleccion');
    const btnAsignar = document.getElementById('btn-assign-multi');
    if (!panelList) return;
    panelList.innerHTML = '';
    selectedReservas.forEach(reserva => { const li = document.createElement('li'); li.textContent = `Pas: ${reserva.nombre_pasajero} (${reserva.distancia || ''})`; panelList.appendChild(li); });
    contador.textContent = selectedReservas.size;
    btnAsignar.disabled = selectedReservas.size === 0;
}

function mostrarMenuContextualReserva(event, reserva, estado) {
    event.domEvent.preventDefault();
    hideMapContextMenu();
    let menuHTML = ''; const rId = reserva.id;
    if (estado === 'En Curso' || estado === 'Pendiente') {
        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><select onchange="window.app.asignarMovil('${rId}', this.value);"><option value="">Asignar Móvil...</option>${cachesRef.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('')}</select></li><li><a onclick="window.app.changeReservaState('${rId}', 'Anulado');">Anular</a></li>`;
    } else if (estado === 'Asignado' || estado === 'En Origen' || estado === 'Viaje Iniciado') {
        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><a onclick="window.app.finalizarReserva('${rId}');">Finalizar</a></li><li><a onclick="window.app.quitarAsignacion('${rId}');">Quitar Móvil</a></li>`;
    }
    if (menuHTML) {
        mapContextMenuItems.innerHTML = menuHTML;
        mapContextMenuItems.style.left = `${event.domEvent.clientX}px`;
        mapContextMenuItems.style.top = `${event.domEvent.clientY}px`;
        mapContextMenuItems.style.display = 'block';
    }
}

function crearIconoDePin(colorFondo, textoPrincipal) {
    const svgIcon = `<svg width="42" height="56" viewBox="0 0 42 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 0C11.64 0 4 7.64 4 18c0 14 17 38 17 38s17-24 17-38C38 7.64 30.36 0 21 0Z" fill="${colorFondo}"/><circle cx="21" cy="18" r="15" fill="white"/><text x="21" y="24" font-family="Arial, sans-serif" font-size="15px" font-weight="bold" fill="#333" text-anchor="middle">${textoPrincipal}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon), scaledSize: new google.maps.Size(42, 56), anchor: new google.maps.Point(21, 56) };
}

function crearIconoDeChofer(colorFondo, textoPrincipal) {
    const svgIcon = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="22" r="21" fill="${colorFondo}" stroke="white" stroke-width="2"/><text x="22" y="28" font-family="Arial, sans-serif" font-size="17px" font-weight="bold" fill="white" text-anchor="middle">${textoPrincipal}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon), scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 22) };
}

export function filtrarMapa(estado) { filtroMapaActual = estado; document.querySelectorAll('.map-filters .map-filter-btn').forEach(btn => btn.classList.remove('active')); cargarMarcadoresDeReservas(); }
export function filtrarMapaPorHoras(horas) { filtroHorasMapa = horas; cargarMarcadoresDeReservas(); }
export function filtrarMapaPorChofer(choferId) { filtroChoferMapaId = choferId || null; toggleChoferesVisibility(document.getElementById('toggle-choferes').checked); }
export function escucharUbicacionChoferes() {
    if (unsubscribeChoferes) unsubscribeChoferes();
    unsubscribeChoferes = db.collection('choferes').onSnapshot(snapshot => {
        const mostrar = document.getElementById('toggle-choferes').checked;
        snapshot.docChanges().forEach(change => {
            const d = change.doc.data(); const id = change.doc.id;
            if (change.type === 'removed' || !d.coordenadas) { if(marcadoresChoferes[id]) { marcadoresChoferes[id].setMap(null); delete marcadoresChoferes[id]; } return; }
            const pos = { lat: d.coordenadas.latitude, lng: d.coordenadas.longitude };
            const movil = cachesRef.moviles.find(m => m.id === d.movil_actual_id);
            const num = movil ? movil.numero : '?';
            const icon = crearIconoDeChofer(d.esta_en_linea ? '#23477b' : '#808080', num);
            if(marcadoresChoferes[id]) { marcadoresChoferes[id].setPosition(pos); marcadoresChoferes[id].setIcon(icon); }
            else marcadoresChoferes[id] = new google.maps.Marker({ position: pos, map: map, icon: icon });
            marcadoresChoferes[id].setVisible(mostrar && (!filtroChoferMapaId || id === filtroChoferMapaId));
        });
    });
}
export function toggleChoferesVisibility(mostrar) { for (const choferId in marcadoresChoferes) { const marcador = marcadoresChoferes[choferId]; if (marcador) { const esVisible = mostrar && (!filtroChoferMapaId || choferId === filtroChoferMapaId); marcador.setVisible(esVisible); } } }
export function hideMapContextMenu() { if (mapContextMenu) mapContextMenu.style.display = 'none'; }
export function toggleMultiSelectMode() { isMultiSelectMode = !isMultiSelectMode; document.getElementById('multi-select-panel').style.display = isMultiSelectMode ? 'block' : 'none'; if(!isMultiSelectMode) { selectedReservas.clear(); cargarMarcadoresDeReservas(); } }
export function getSelectedReservasIds() { return Array.from(selectedReservas.keys()); }
export function getModalMarkerCoords() { return { origen: null, destino: null }; }