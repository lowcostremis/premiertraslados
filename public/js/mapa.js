// js/mapa.js

import { db } from './firebase-config.js';

// --- VARIABLES INTERNAS DEL MÓDULO ---
let map, mapaModal, autocompleteOrigen, autocompleteDestino, geocoder;
let marcadoresReservas = {};
let marcadoresChoferes = {};
let marcadorOrigenModal, marcadorDestinoModal, infoWindowActiva = null;
let mapContextMenu, mapContextMenuItems;
let filtroMapaActual = 'Todos', filtroHorasMapa = null, filtroChoferMapaId = null;
let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;

// --- NUEVAS VARIABLES PARA SELECCIÓN MÚLTIPLE ---
let isMultiSelectMode = false;
let selectedReservas = new Map(); // Usamos un Map para guardar el ID y los datos de la reserva.

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

// --- FUNCIONES EXPUESTAS ---
export function initMapInstance() {
    const c = document.getElementById("map-container");
    if (c && !map) {
        map = new google.maps.Map(c, { center: { lat: -32.9566, lng: -60.6577 }, zoom: 12 });
        map.addListener('click', hideMapContextMenu);
        
        map.addListener('rightclick', (event) => {
            event.domEvent.preventDefault();
            hideMapContextMenu(); 
        });

        if (lastReservasSnapshotRef()) cargarMarcadoresDeReservas();
    }
}

export function initMapaModal(origenCoords, destinoCoords) {
    const c = document.getElementById("mapa-modal-container");
    if (!c) return;
    const centro = { lat: -32.95, lng: -60.65 };
    if (!mapaModal) {
        mapaModal = new google.maps.Map(c, { center: centro, zoom: 13 });
        initAutocomplete();
    }
    if (marcadorOrigenModal) marcadorOrigenModal.setMap(null);
    if (marcadorDestinoModal) marcadorDestinoModal.setMap(null);

    const pO = (origenCoords && origenCoords.latitude) ? { lat: origenCoords.latitude, lng: origenCoords.longitude } : centro;
    marcadorOrigenModal = new google.maps.Marker({ position: pO, map: mapaModal, draggable: true });
    const pD = (destinoCoords && destinoCoords.latitude) ? { lat: destinoCoords.latitude, lng: destinoCoords.longitude } : centro;
    marcadorDestinoModal = new google.maps.Marker({ position: pD, map: mapaModal, draggable: true });

    if (origenCoords && origenCoords.latitude) {
        mapaModal.setCenter(pO);
        mapaModal.setZoom(15);
    }
    marcadorOrigenModal.addListener('dragend', (event) => actualizarInputDesdeCoordenadas(event.latLng, 'origen'));
    marcadorDestinoModal.addListener('dragend', (event) => actualizarInputDesdeCoordenadas(event.latLng, 'destino'));
}

export function cargarMarcadoresDeReservas() {
    if (!map || !lastReservasSnapshotRef()) return;

    const idsDeReservasActivas = new Set();
    const ahora = new Date();
    const lim = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

    if (infoWindowActiva) {
        infoWindowActiva.close();
        infoWindowActiva = null;
    }

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
        
        // Lógica de filtrado (se mantiene igual)
        // ... (Tu lógica de filtros 'Pendientes', 'Asignados', 'En Curso', y por horas)
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

        // --- LÓGICA DE ICONOS Y POSICIÓN (MODIFICADA PARA REUTILIZACIÓN) ---
        if (['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords && r.destino_coords.latitude) {
            posicion = { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude };
            const movil = cachesRef.moviles.find(mov => mov.id === r.movil_asignado_id);
            const numeroMovil = movil ? movil.numero.toString() : '?';
            icono = crearIconoDePin('#27DAF5', numeroMovil);
            titulo = `DESTINO: ${r.destino}`;
        } else if (r.origen_coords && r.origen_coords.latitude) {
            posicion = { lat: r.origen_coords.latitude, lng: r.origen_coords.longitude };
            let colorFondo, textoIcono = '';
            
            switch (e) {
                case 'En Curso': colorFondo = '#F54927'; textoIcono = (r.hora_pickup || r.hora_turno || '').substring(0, 5); break;
                case 'Asignado':
                    const detalleEstado = r.estado?.detalle;
                    colorFondo = (detalleEstado === 'Aceptada') ? '#4DF527' : '#F5A623';
                    const movilAsignado = cachesRef.moviles.find(mov => mov.id === r.movil_asignado_id);
                    if (movilAsignado) textoIcono = movilAsignado.numero.toString();
                    break;
                case 'Pendiente': colorFondo = '#C15DE8'; textoIcono = (r.hora_pickup || r.hora_turno || '').substring(0, 5); break;
                default: colorFondo = '#808080'; textoIcono = '•'; break;
            }
            icono = crearIconoDePin(colorFondo, textoIcono);
            titulo = `Origen: ${r.origen} (${e})`;
        } else {
             if (marcadorExistente) {
                marcadorExistente.setMap(null);
                delete marcadoresReservas[r.id];
            }
            return; // Si no hay coordenadas, no continuamos
        }

        // --- INICIO DE LA ADAPTACIÓN PARA SELECCIÓN MÚLTIPLE ---
        // Si el marcador está en la lista de seleccionados, sobreescribimos su icono
        if (selectedReservas.has(r.id)) {
            icono = crearIconoDePin('#007BFF', '✓'); // Icono especial de selección
        }
        // --- FIN DE LA ADAPTACIÓN ---

        if (marcadorExistente) {
            marcadorExistente.setPosition(posicion);
            marcadorExistente.setIcon(icono);
            marcadorExistente.setTitle(titulo);
            google.maps.event.clearInstanceListeners(marcadorExistente);
        } else {
            marcadoresReservas[r.id] = new google.maps.Marker({ position: posicion, map: map, title: titulo, icon: icono });
        }
        
        const marcadorActual = marcadoresReservas[r.id];

        // --- LÓGICA DE LISTENERS MODIFICADA ---
        marcadorActual.addListener('click', () => {
            if (isMultiSelectMode) {
                handleMarkerSelection(r);
            } else {
                // Comportamiento de click normal (si lo hay)
                if (infoWindowActiva) infoWindowActiva.close();
                const contenido = `<strong>Pasajero:</strong> ${r.nombre_pasajero}<br><strong>Origen:</strong> ${r.origen}<br><strong>Destino:</strong> ${r.destino}<br><strong>Hora Turno:</strong> ${r.hora_turno}`;
                infoWindowActiva = new google.maps.InfoWindow({ content: contenido });
                infoWindowActiva.open(map, marcadorActual);
            }
        });

        marcadorActual.addListener('dblclick', () => {
            if (!isMultiSelectMode) window.app.openEditReservaModal(r.id);
        });
        marcadorActual.addListener('rightclick', (event) => {
            if (!isMultiSelectMode) mostrarMenuContextualReserva(event, r, e);
        });
    });

    Object.keys(marcadoresReservas).forEach(id => {
        if (!idsDeReservasActivas.has(id)) {
            marcadoresReservas[id].setMap(null);
            delete marcadoresReservas[id];
        }
    });
}


export function filtrarMapa(estado) {
    filtroMapaActual = estado;
    document.querySelectorAll('.map-filters .map-filter-btn').forEach(btn => btn.classList.remove('active'));
    const btnActivo = [...document.querySelectorAll('.map-filters .map-filter-btn')].find(b => b.textContent.trim() === estado);
    if(btnActivo) btnActivo.classList.add('active');
    cargarMarcadoresDeReservas();
}

export function filtrarMapaPorHoras(horas) {
    filtroHorasMapa = horas;
    document.querySelectorAll('.time-filters-map .map-filter-btn').forEach(btn => btn.classList.remove('active'));
    const textoBoton = horas === null ? '24hs' : `${horas}hs`;
    const btnActivo = [...document.querySelectorAll('.time-filters-map .map-filter-btn')].find(b => b.textContent.trim() === textoBoton);
    if(btnActivo) btnActivo.classList.add('active');
    cargarMarcadoresDeReservas();
}

export function filtrarMapaPorChofer(choferId) {
    filtroChoferMapaId = choferId || null;
    toggleChoferesVisibility(document.getElementById('toggle-choferes').checked);
}

export function escucharUbicacionChoferes() {
    // Esta función se mantiene sin cambios
    if (unsubscribeChoferes) unsubscribeChoferes();

    unsubscribeChoferes = db.collection('choferes').onSnapshot(snapshot => {
        const mostrar = document.getElementById('toggle-choferes').checked;

        snapshot.docChanges().forEach(change => {
            const choferData = change.doc.data();
            const choferId = change.doc.id;

            if (change.type === 'removed' || !choferData.coordenadas || typeof choferData.coordenadas.latitude !== 'number') {
                if (marcadoresChoferes[choferId]) {
                    marcadoresChoferes[choferId].setMap(null);
                    delete marcadoresChoferes[choferId];
                }
                return;
            }

            let colorFondo = choferData.estadoViaje === 'pasajero_a_bordo' ? '#F5A623' : (choferData.esta_en_linea ? '#23477b' : '#808080');
            const nuevaPos = new google.maps.LatLng(choferData.coordenadas.latitude, choferData.coordenadas.longitude);
            const movilAsignado = cachesRef.moviles.find(m => m.id === choferData.movil_actual_id);
            const numeroMovil = movilAsignado ? movilAsignado.numero.toString() : 'S/A';
            const iconoChofer = crearIconoDeChofer(colorFondo, numeroMovil);
            const titulo = `Chofer: ${choferData.nombre || 'N/A'}\nMóvil: ${numeroMovil}`;
            
            const marcador = marcadoresChoferes[choferId];

            if (marcador) {
                marcador.setPosition(nuevaPos);
                marcador.setIcon(iconoChofer);
                marcador.setTitle(titulo);
            } else {
                marcadoresChoferes[choferId] = new google.maps.Marker({
                    position: nuevaPos, map: map, title: titulo, icon: iconoChofer, zIndex: 101
                });
            }
            
            const esVisible = mostrar && (!filtroChoferMapaId || choferId === filtroChoferMapaId);
            marcadoresChoferes[choferId].setVisible(esVisible);
        });
    });
}


// --- INICIO: NUEVAS FUNCIONES PARA SELECCIÓN MÚLTIPLE ---

export function toggleMultiSelectMode() {
    isMultiSelectMode = !isMultiSelectMode;
    const btn = document.getElementById('btn-multi-select');
    const panel = document.getElementById('multi-select-panel');

    if (isMultiSelectMode) {
        btn.classList.add('active');
        panel.style.display = 'block';
        poblarSelectMovilesPanel();
        hideMapContextMenu();
        if (infoWindowActiva) infoWindowActiva.close();
    } else {
        btn.classList.remove('active');
        panel.style.display = 'none';
        selectedReservas.clear();
        actualizarPanelMultiSelect();
        cargarMarcadoresDeReservas(); // Redibuja para quitar estilos de selección
    }
}

export function getSelectedReservasIds() {
    return Array.from(selectedReservas.keys());
}

function handleMarkerSelection(reserva) {
    const marcador = marcadoresReservas[reserva.id];
    if (!marcador) return;

    if (selectedReservas.has(reserva.id)) {
        // Deseleccionar
        selectedReservas.delete(reserva.id);
        // El icono se restaurará con la llamada a cargarMarcadoresDeReservas,
        // pero para una respuesta visual instantánea, lo recalculamos aquí.
        // (Esta parte es una simplificación, cargarMarcadores es más seguro)
        cargarMarcadoresDeReservas(); 
    } else {
        // Seleccionar
        selectedReservas.set(reserva.id, reserva);
        marcador.setIcon(crearIconoDePin('#007BFF', '✓')); // Icono azul de selección
    }
    actualizarPanelMultiSelect();
}

function actualizarPanelMultiSelect() {
    const panelList = document.getElementById('multi-select-list');
    const contador = document.getElementById('contador-seleccion');
    const btnAsignar = document.getElementById('btn-assign-multi');

    if (!panelList || !contador || !btnAsignar) return;

    panelList.innerHTML = '';
    selectedReservas.forEach(reserva => {
        const li = document.createElement('li');
        li.textContent = `Pas: ${reserva.nombre_pasajero || 'N/A'} (Turno: ${reserva.hora_turno || 'S/H'})`;
        panelList.appendChild(li);
    });

    contador.textContent = selectedReservas.size;
    btnAsignar.disabled = selectedReservas.size === 0;
}

function poblarSelectMovilesPanel() {
    const select = document.getElementById('multi-select-movil');
    if (!select || !cachesRef.moviles) return;

    select.innerHTML = '<option value="">Seleccionar móvil...</option>';
    const movilesOrdenados = [...cachesRef.moviles].sort((a,b) => a.numero - b.numero);

    movilesOrdenados.forEach(movil => {
        const chofer = cachesRef.choferes.find(c => c.movil_actual_id === movil.id);
        const infoChofer = chofer ? ` - ${chofer.nombre}` : ' - (Libre)';
        const option = document.createElement('option');
        option.value = movil.id;
        option.textContent = `Móvil ${movil.numero}${infoChofer}`;
        select.appendChild(option);
    });
}
// --- FIN: NUEVAS FUNCIONES PARA SELECCIÓN MÚLTIPLE ---


// --- FUNCIONES INTERNAS (SIN CAMBIOS O CON CAMBIOS MENORES) ---

function mostrarMenuContextualReserva(event, reserva, estado) {
    event.domEvent.preventDefault();
    hideMapContextMenu();
    let menuHTML = ''; 
    const rId = reserva.id;

    if (estado === 'En Curso' || estado === 'Pendiente') {
        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><select onchange="window.app.asignarMovil('${rId}', this.value);"><option value="">Asignar Móvil...</option>${cachesRef.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('')}</select></li><li><a onclick="window.app.changeReservaState('${rId}', 'Anulado');">Anular</a></li>`;
    } else if (estado === 'Asignado' || estado === 'En Origen' || estado === 'Viaje Iniciado') {
        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><a onclick="window.app.finalizarReserva('${rId}');">Finalizar</a></li><li><a onclick="window.app.quitarAsignacion('${rId}');">Quitar Móvil</a></li>`;
    }

    if (menuHTML) {
        mapContextMenuItems.innerHTML = menuHTML;
        mapContextMenu.style.left = `${event.domEvent.clientX}px`;
        mapContextMenu.style.top = `${event.domEvent.clientY}px`;
        mapContextMenu.style.display = 'block';
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

function toggleChoferesVisibility(mostrar) {
    for (const choferId in marcadoresChoferes) {
        const marcador = marcadoresChoferes[choferId];
        if (marcador) {
            const esVisible = mostrar && (!filtroChoferMapaId || choferId === filtroChoferMapaId);
            marcador.setVisible(esVisible);
        }
    }
}

function initAutocomplete() {
    // Sin cambios
    const o = document.getElementById('origen');
    const d = document.getElementById('destino');
    if (!o || !d) return;
    const opts = { componentRestrictions: { country: "ar" }, fields: ["formatted_address", "geometry", "name"] };
    autocompleteOrigen = new google.maps.places.Autocomplete(o, opts);
    autocompleteDestino = new google.maps.places.Autocomplete(d, opts);
    autocompleteOrigen.addListener('place_changed', () => {
        const p = autocompleteOrigen.getPlace();
        if (p.geometry?.location && mapaModal && marcadorOrigenModal) {
            mapaModal.setCenter(p.geometry.location);
            marcadorOrigenModal.setPosition(p.geometry.location);
            mapaModal.setZoom(15);
        }
    });
    autocompleteDestino.addListener('place_changed', () => {
        const p = autocompleteDestino.getPlace();
        if (p.geometry?.location && mapaModal && marcadorDestinoModal) {
            mapaModal.setCenter(p.geometry.location);
            marcadorDestinoModal.setPosition(p.geometry.location);
            mapaModal.setZoom(15);
        }
    });
}

function actualizarInputDesdeCoordenadas(latLng, tipo) {
    // Sin cambios
     if (!geocoder) geocoder = new google.maps.Geocoder();
    geocoder.geocode({ 'location': latLng }, (results, status) => {
        if (status === 'OK' && results[0]) {
            document.getElementById(tipo).value = results[0].formatted_address;
        } else {
            console.warn('Geocodificación falló: ' + status);
        }
    });
}

export function hideMapContextMenu() {
    if (mapContextMenu) mapContextMenu.style.display = 'none';
}

export function getModalMarkerCoords() {
    // Sin cambios
    let origen = null, destino = null;
    if (marcadorOrigenModal?.getPosition()) {
        const pos = marcadorOrigenModal.getPosition();
        origen = { latitude: pos.lat(), longitude: pos.lng() };
    }
    if (marcadorDestinoModal?.getPosition()) {
        const pos = marcadorDestinoModal.getPosition();
        destino = { latitude: pos.lat(), longitude: pos.lng() };
    }
    return { origen, destino };
}