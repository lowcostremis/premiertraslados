// js/mapa.js

import { db } from './firebase-config.js';

// --- VARIABLES INTERNAS DEL MÓDULO ---
let map, mapaModal, autocompleteOrigen, autocompleteDestino, geocoder;
let marcadoresOrigen = {}, marcadoresChoferes = {};
let marcadorOrigenModal, marcadorDestinoModal, infoWindowActiva = null, marcadorDestinoActivo = null;
let mapContextMenu, mapContextMenuItems;
let filtroMapaActual = 'Todos', filtroHorasMapa = null, filtroChoferMapaId = null;
let cachesRef = {}, lastReservasSnapshotRef = null, unsubscribeChoferes = null;

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
    
    Object.values(marcadoresOrigen).forEach(m => m.setMap(null));
    marcadoresOrigen = {};

    if (marcadorDestinoActivo) {
        marcadorDestinoActivo.setMap(null);
        marcadorDestinoActivo = null;
    }
    if (infoWindowActiva) {
        infoWindowActiva.close();
        infoWindowActiva = null;
    }

    const idsDeReservasEnMapa = new Set(Object.keys(marcadoresOrigen));
    const idsDeReservasProcesadas = new Set();
    const ahora = new Date();
    const lim = new Date(ahora.getTime() + (24 * 60 * 60 * 1000));

    lastReservasSnapshotRef().forEach(doc => {
        const r = { id: doc.id, ...doc.data() };
        let e = (typeof r.estado === 'object') ? r.estado.principal : r.estado;
        const estValidos = ['En Curso', 'Asignado', 'Pendiente', 'En Origen', 'Viaje Iniciado'];
        if (!estValidos.includes(e)) return;
        if (!r.chofer_asignado_id && e === 'Pendiente') {
            const fT = r.fecha_turno ? new Date(`${r.fecha_turno}T${r.hora_turno || '00:00'}`) : null;
            if (fT && fT <= lim) e = 'En Curso';
        }
        if (filtroMapaActual !== 'Todos' && e !== filtroMapaActual) return;
        
        if (filtroHorasMapa !== null) {
            const horaReferencia = r.hora_pickup || r.hora_turno;
            if (!r.fecha_turno || !horaReferencia) return;
            const fechaHoraReserva = new Date(`${r.fecha_turno}T${horaReferencia}`);
            const diferenciaMilisegundos = fechaHoraReserva.getTime() - ahora.getTime();
            const horasDiferencia = diferenciaMilisegundos / (1000 * 60 * 60);
            if (horasDiferencia < 0 || horasDiferencia > filtroHorasMapa) return;
        }

        let posicionMarcador, iconoMarcador, tituloMarcador;

        if ((e === 'Viaje Iniciado' || e === 'En Origen') && r.destino_coords && r.destino_coords.latitude) {
            posicionMarcador = { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude };
            const movil = cachesRef.moviles.find(mov => mov.id === r.movil_asignado_id);
            const numeroMovil = movil ? movil.numero.toString() : '?';
            iconoMarcador = crearIconoDePin('#27DAF5', numeroMovil);
            tituloMarcador = `DESTINO: ${r.destino} (Móvil ${numeroMovil})`;
        } else if (r.origen_coords && r.origen_coords.latitude) {
            posicionMarcador = { lat: r.origen_coords.latitude, lng: r.origen_coords.longitude };
            let colorFondo, textoIcono = '';
            
            switch (e) {
                case 'En Curso': 
                case 'En Origen':
                    colorFondo = '#F54927'; textoIcono = (r.hora_pickup || r.hora_turno || '').substring(0, 5); break;
                case 'Asignado':
                    colorFondo = '#4DF527'; const m = cachesRef.moviles.find(mov => mov.id === r.movil_asignado_id); if (m) textoIcono = m.numero.toString(); break;
                case 'Pendiente': 
                    colorFondo = '#C15DE8'; break;
                default:
                    colorFondo = '#808080';
                    textoIcono = '•';
                    break;
            }

            iconoMarcador = crearIconoDePin(colorFondo, textoIcono);
            tituloMarcador = `Origen: ${r.origen} (${e})`;
        }

        if (posicionMarcador) {
            idsDeReservasProcesadas.add(r.id);
            if (marcadoresOrigen[r.id]) {
                marcadoresOrigen[r.id].setPosition(posicionMarcador);
                marcadoresOrigen[r.id].setIcon(iconoMarcador);
                marcadoresOrigen[r.id].setTitle(tituloMarcador);
            } else {
                const marker = new google.maps.Marker({ position: posicionMarcador, map: map, title: tituloMarcador, icon: iconoMarcador });
                marcadoresOrigen[r.id] = marker;
                marker.addListener('dblclick', () => {
                    window.app.openEditReservaModal(r.id);
                });
                marker.addListener('click', () => {
                    if (infoWindowActiva) infoWindowActiva.close();
                    if (marcadorDestinoActivo) marcadorDestinoActivo.setMap(null);
                    const cli = cachesRef.clientes[r.cliente] || { nombre: 'N/A' };
                    const cho = cachesRef.choferes.find(c => c.id === r.chofer_asignado_id) || { nombre: 'No asignado' };
                    let obs = r.observaciones ? `<p style="background-color:#fffbe6;border-left:4px solid #ffc107;padding:8px;margin-top:5px;"><strong>Obs:</strong> ${r.observaciones}</p>` : '';
                    const cont = `<div class="info-window"><h4>Reserva de: ${cli.nombre}</h4><p><strong>Pasajero:</strong> ${r.nombre_pasajero||'N/A'}</p><p><strong>Origen:</strong> ${r.origen}</p><p><strong>Destino:</strong> ${r.destino}</p><p><strong>Turno:</strong> ${new Date(r.fecha_turno + 'T' + (r.hora_turno||'00:00')).toLocaleString('es-AR')}</p><p><strong>Chofer:</strong> ${cho.nombre}</p>${obs}</div>`;
                    infoWindowActiva = new google.maps.InfoWindow({ content: cont });
                    infoWindowActiva.open(map, marker);
                    
                    if (!['Viaje Iniciado', 'En Origen'].includes(e) && r.destino_coords && r.destino_coords.latitude) {
                        const iD = crearIconoDePin('#27DAF5', 'D');
                        marcadorDestinoActivo = new google.maps.Marker({ position: { lat: r.destino_coords.latitude, lng: r.destino_coords.longitude }, map: map, title: `Destino: ${r.destino}`, icon: iD });
                    }
                    infoWindowActiva.addListener('closeclick', () => { if (marcadorDestinoActivo) marcadorDestinoActivo.setMap(null); });
                });
                marker.addListener('rightclick', (event) => {
                    event.domEvent.preventDefault();
                    hideMapContextMenu();
                    let menuHTML = ''; const rId = r.id;
                    if (e === 'En Curso' || e === 'Pendiente') {
                        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><select onchange="window.app.asignarMovil('${rId}', this.value);"><option value="">Asignar Móvil...</option>${cachesRef.moviles.map(m => `<option value="${m.id}">N°${m.numero}</option>`).join('')}</select></li><li><a onclick="window.app.changeReservaState('${rId}', 'Anulado');">Anular</a></li>`;
                    } else if (e === 'Asignado' || e === 'En Origen' || e === 'Viaje Iniciado') {
                        menuHTML = `<li><a onclick="window.app.openEditReservaModal('${rId}');">Editar</a></li><li><a onclick="window.app.finalizarReserva('${rId}');">Finalizar</a></li><li><a onclick="window.app.quitarAsignacion('${rId}');">Quitar Móvil</a></li>`;
                    }
                    if (menuHTML) {
                        mapContextMenuItems.innerHTML = menuHTML;
                        mapContextMenu.style.left = `${event.domEvent.clientX}px`;
                        mapContextMenu.style.top = `${event.domEvent.clientY}px`;
                        mapContextMenu.style.display = 'block';
                    }
                });
            }
        }
    });

    idsDeReservasEnMapa.forEach(id => {
        if (!idsDeReservasProcesadas.has(id)) {
            marcadoresOrigen[id].setMap(null);
            delete marcadoresOrigen[id];
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
    if (unsubscribeChoferes) unsubscribeChoferes();
    unsubscribeChoferes = db.collection('choferes').onSnapshot(snapshot => {
        const mostrar = document.getElementById('toggle-choferes').checked;
        const ahora = new Date();
        snapshot.docChanges().forEach(change => {
            const chofer = { id: change.doc.id, ...change.doc.data() };
            const marcadorExistente = marcadoresChoferes[chofer.id];
            if (change.type === 'removed' || !chofer.coordenadas) {
                if (marcadorExistente) {
                    marcadorExistente.setMap(null);
                    delete marcadoresChoferes[chofer.id];
                }
                return;
            }
            
            let reportadoEnLinea = false;
            if (chofer.esta_en_linea && chofer.ultima_actualizacion) {
                const diferenciaMinutos = (ahora.getTime() - chofer.ultima_actualizacion.toDate().getTime()) / 60000;
                if (diferenciaMinutos < 5) {
                    reportadoEnLinea = true;
                }
            }
            
            const tieneViajeActivo = Array.isArray(chofer.viajes_activos) && chofer.viajes_activos.length > 0;
            const isOnline = reportadoEnLinea || tieneViajeActivo;
            const colorFondo = isOnline ? '#23477b' : '#808080';

            const nuevaPos = new google.maps.LatLng(chofer.coordenadas.latitude, chofer.coordenadas.longitude);
            const movilAsignado = cachesRef.moviles.find(m => m.id === chofer.movil_actual_id);
            const numeroMovil = movilAsignado ? movilAsignado.numero.toString() : 'N/A';
            const iconoChofer = crearIconoDeChofer(colorFondo, numeroMovil);
            const titulo = `Chofer: ${chofer.nombre || 'N/A'}\nMóvil: ${numeroMovil}`;
            
            if (marcadorExistente) {
                marcadorExistente.setPosition(nuevaPos);
                marcadorExistente.setIcon(iconoChofer);
                marcadorExistente.setTitle(titulo);
            } else {
                const marcador = new google.maps.Marker({ position: nuevaPos, map: map, title: titulo, icon: iconoChofer, zIndex: 101 });
                const esVisible = mostrar && (!filtroChoferMapaId || chofer.id === filtroChoferMapaId);
                marcador.setVisible(esVisible);
                marcadoresChoferes[chofer.id] = marcador;
            }
        });
    });
}

// --- FUNCIONES INTERNAS ---
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
    const o = document.getElementById('origen');
    const d = document.getElementById('destino');
    if (!o || !d) return;
    const opts = { componentRestrictions: { country: "ar" }, fields: ["formatted_address", "geometry", "name"] };
    autocompleteOrigen = new google.maps.places.Autocomplete(o, opts);
    autocompleteDestino = new google.maps.places.Autocomplete(d, opts);
    autocompleteOrigen.addListener('place_changed', () => {
        const p = autocompleteOrigen.getPlace();
        if (p.geometry && p.geometry.location && mapaModal && marcadorOrigenModal) {
            mapaModal.setCenter(p.geometry.location);
            marcadorOrigenModal.setPosition(p.geometry.location);
            mapaModal.setZoom(15);
        }
    });
    autocompleteDestino.addListener('place_changed', () => {
        const p = autocompleteDestino.getPlace();
        if (p.geometry && p.geometry.location && mapaModal && marcadorDestinoModal) {
            mapaModal.setCenter(p.geometry.location);
            marcadorDestinoModal.setPosition(p.geometry.location);
            mapaModal.setZoom(15);
        }
    });
}

function actualizarInputDesdeCoordenadas(latLng, tipo) {
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
    let origen = null;
    let destino = null;

    if (marcadorOrigenModal && marcadorOrigenModal.getPosition()) {
        const pos = marcadorOrigenModal.getPosition();
        origen = { latitude: pos.lat(), longitude: pos.lng() };
    }
    if (marcadorDestinoModal && marcadorDestinoModal.getPosition()) {
        const pos = marcadorDestinoModal.getPosition();
        destino = { latitude: pos.lat(), longitude: pos.lng() };
    }
    
    return { origen, destino };
}