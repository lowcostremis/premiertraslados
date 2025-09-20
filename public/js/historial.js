// js/historial.js

import { db, historicoSearchIndex } from './firebase-config.js';

// Variables propias del módulo de historial
let historialBody, btnAnterior, btnSiguiente, indicadorPagina;
const registrosPorPagina = 100;
let ultimoDocVisible = null;
let historialDePaginas = [null];
let paginaActual = 0;
let choferesCacheRef; // Referencia al cache de choferes

/**
 * Inicializa el módulo, obteniendo los elementos del DOM y configurando los listeners.
 * @param {Object} caches - Referencia a los caches globales de la app.
 */
export function initHistorial(caches) {
    historialBody = document.getElementById('historial-body');
    btnAnterior = document.getElementById('btn-anterior');
    btnSiguiente = document.getElementById('btn-siguiente');
    indicadorPagina = document.getElementById('indicador-pagina');
    choferesCacheRef = caches.choferes; // Guardamos la referencia

    if (btnSiguiente) {
        btnSiguiente.addEventListener('click', () => {
            if (paginaActual === historialDePaginas.length - 1) {
                historialDePaginas.push(ultimoDocVisible);
            }
            paginaActual++;
            cargarHistorial();
        });
    }
    if (btnAnterior) {
        btnAnterior.addEventListener('click', () => {
            if (paginaActual > 0) {
                paginaActual--;
                cargarHistorial();
            }
        });
    }
    
    const searchInput = document.getElementById('search-historial-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => buscarEnHistorial(e.target.value));
    }
}

/**
 * Carga una página de datos del historial desde Firestore.
 */
export async function cargarHistorial() {
    if (!historialBody) return;
    try {
        historialBody.innerHTML = '<tr><td colspan="11">Cargando historial...</td></tr>';
        btnAnterior.disabled = true;
        btnSiguiente.disabled = true;

        let query = db.collection('historico').orderBy('archivadoEn', 'desc');
        const cursor = historialDePaginas[paginaActual];
        if (cursor) {
            query = query.startAfter(cursor);
        }
        query = query.limit(registrosPorPagina);
        
        const querySnapshot = await query.get();
        const documentos = querySnapshot.docs;

        if (documentos.length === 0 && paginaActual === 0) {
            historialBody.innerHTML = '<tr><td colspan="11">No hay viajes en el historial.</td></tr>';
            actualizarEstadoBotonesPaginacion(0);
            return;
        }

        if (documentos.length > 0) {
            ultimoDocVisible = documentos[documentos.length - 1];
        }

        mostrarDatosHistorialEnTabla(documentos);
        actualizarEstadoBotonesPaginacion(documentos.length);

    } catch (error) {
        console.error("Error al cargar el historial: ", error);
        historialBody.innerHTML = '<tr><td colspan="11">Error al cargar los datos.</td></tr>';
    }
}

/**
 * Realiza una búsqueda en el historial usando Algolia.
 * @param {string} texto - El término de búsqueda.
 */
export async function buscarEnHistorial(texto) {
    const paginacionContainer = document.getElementById('paginacion-historico');
    if (!texto) {
        if (paginacionContainer) paginacionContainer.style.display = 'flex';
        paginaActual = 0;
        historialDePaginas = [null];
        cargarHistorial();
        return;
    }
    try {
        if (paginacionContainer) paginacionContainer.style.display = 'none';
        historialBody.innerHTML = '<tr><td colspan="11">Buscando...</td></tr>';
        const { hits } = await historicoSearchIndex.search(texto);
        mostrarDatosHistorialEnTabla(hits);
    } catch (error) {
        console.error("Error buscando en Algolia: ", error);
        historialBody.innerHTML = '<tr><td colspan="11">Error al realizar la búsqueda.</td></tr>';
        if (paginacionContainer) paginacionContainer.style.display = 'flex';
    }
}

// --- Funciones Internas (no necesitan 'export') ---

function mostrarDatosHistorialEnTabla(documentos) {
    if (!historialBody) return;
    historialBody.innerHTML = '';

    if (documentos.length === 0) {
        historialBody.innerHTML = '<tr><td colspan="11">No se encontraron viajes con ese criterio.</td></tr>';
        return;
    }

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        const fecha = viaje.fecha_turno ? new Date(viaje.fecha_turno + 'T00:00:00').toLocaleDateString('es-AR', { timeZone: 'UTC' }) : 'N/A';
        
        let nombreChofer = 'N/A';
        if (viaje.chofer_asignado_id && choferesCacheRef.length > 0) {
            const chofer = choferesCacheRef.find(c => c.id === viaje.chofer_asignado_id);
            if (chofer) {
                nombreChofer = chofer.nombre;
            }
        }

        let estiloFila = '';
        if (viaje.estado?.principal === 'Negativo') {
            estiloFila = 'style="background-color: #FFDE59; color: #333;"';
        } else if (viaje.estado?.principal === 'Anulado') {
            estiloFila = 'style="text-decoration: line-through;"';
        }

        const fila = `
            <tr class="border-b border-gray-700 hover:bg-gray-800" ${estiloFila}>
                <td>${fecha}</td>
                <td>${viaje.hora_turno || 'N/A'}</td>
                <td>${viaje.hora_pickup || 'N/A'}</td>
                <td>${viaje.nombre_pasajero || 'N/A'}</td>
                <td>${viaje.autorizacion || 'N/A'}</td>
                <td>${viaje.siniestro || 'N/A'}</td>
                <td>${viaje.clienteNombre || 'N/A'}</td>
                <td>${viaje.origen || 'N/A'}</td>
                <td>${viaje.destino || 'N/A'}</td>
                <td>${nombreChofer}</td>
                <td>${viaje.estado?.principal || viaje.estado || 'N/A'}</td>
            </tr>
        `;
        historialBody.innerHTML += fila;
    });
}

function actualizarEstadoBotonesPaginacion(cantidadDocsRecibidos) {
    if (!btnAnterior || !btnSiguiente) return;
    btnAnterior.disabled = (paginaActual === 0);
    btnSiguiente.disabled = (cantidadDocsRecibidos < registrosPorPagina);
    if (indicadorPagina) {
        indicadorPagina.textContent = `Página ${paginaActual + 1}`;
    }
}