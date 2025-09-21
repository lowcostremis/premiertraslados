// js/historial.js

import { db, historicoSearchIndex } from './firebase-config.js';
import { functions } from './firebase-config.js'; 

export function poblarFiltroClientes(clientes) {
    const clienteSelect = document.getElementById('filtro-cliente-historial');
    if (!clienteSelect) return;

    // Guardamos el valor que estaba seleccionado, si había uno
    const valorSeleccionado = clienteSelect.value;

    clienteSelect.innerHTML = '<option value="">Todos los clientes</option>';
    for (const clienteId in clientes) {
        const cliente = clientes[clienteId];
        clienteSelect.innerHTML += `<option value="${clienteId}">${cliente.nombre}</option>`;
    }

    // Volvemos a establecer el valor que estaba seleccionado
    clienteSelect.value = valorSeleccionado;
}

// Variables propias del módulo de historial
let historialBody, btnAnterior, btnSiguiente, indicadorPagina;
const registrosPorPagina = 100;
let ultimoDocVisible = null;
let historialDePaginas = [null];
let paginaActual = 0;

/**
 * Inicializa el módulo, obteniendo los elementos del DOM y configurando los listeners.
 * @param {Object} caches - Referencia a los caches globales de la app (no se usa directamente aquí pero es buena práctica mantenerlo).
 */
export function initHistorial(caches) {
    historialBody = document.getElementById('historial-body');
    btnAnterior = document.getElementById('btn-anterior');
    btnSiguiente = document.getElementById('btn-siguiente');
    indicadorPagina = document.getElementById('indicador-pagina');

     
    const btnExportar = document.getElementById('btn-exportar-excel');
    if (btnExportar) {
        btnExportar.addEventListener('click', async () => {
            const fechaDesde = document.getElementById('fecha-desde-historial').value;
            const fechaHasta = document.getElementById('fecha-hasta-historial').value;
            const clienteId = document.getElementById('filtro-cliente-historial').value;

            if (!fechaDesde || !fechaHasta) {
                alert('Por favor, selecciona una fecha de inicio y de fin.');
                return;
            }

            btnExportar.textContent = 'Generando...';
            btnExportar.disabled = true;

            try {
                const exportarHistorico = functions.httpsCallable('exportarHistorico');
                const result = await exportarHistorico({ fechaDesde, fechaHasta, clienteId });
                
                if (result.data.csvData) {
                    const blob = new Blob([result.data.csvData], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.setAttribute("href", url);
                    link.setAttribute("download", `historico_${fechaDesde}_al_${fechaHasta}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    alert(result.data.message || 'No se encontraron datos para exportar.');
                }
            } catch (error) {
                console.error("Error al exportar:", error);
                alert("Error al generar el reporte: " + error.message);
            } finally {
                btnExportar.textContent = 'Exportar a Excel';
                btnExportar.disabled = false;
            }
        });
    }

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
        historialBody.innerHTML = '<tr><td colspan="1">Cargando historial...</td></tr>';
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
            historialBody.innerHTML = '<tr><td colspan="1">No hay viajes en el historial.</td></tr>';
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
        historialBody.innerHTML = '<tr><td colspan="1">Error al cargar los datos.</td></tr>';
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
        historialBody.innerHTML = '<tr><td colspan="1">Buscando...</td></tr>';
        const { hits } = await historicoSearchIndex.search(texto);
        // Algolia devuelve los datos directamente, no necesitamos llamar a .data()
        const documentosFormateados = hits.map(hit => ({ ...hit, id: hit.objectID }));
        mostrarDatosHistorialEnTabla(documentosFormateados);
    } catch (error) {
        console.error("Error buscando en Algolia: ", error);
        historialBody.innerHTML = '<tr><td colspan="1">Error al realizar la búsqueda.</td></tr>';
        if (paginacionContainer) paginacionContainer.style.display = 'flex';
    }
}


// --- Funciones Internas ---
function mostrarDatosHistorialEnTabla(documentos) {
    if (!historialBody) return;
    historialBody.innerHTML = ''; 

    if (documentos.length === 0) {
        historialBody.innerHTML = '<tr><td colspan="1">No se encontraron viajes con ese criterio.</td></tr>';
        return;
    }

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        const estado = (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A';
        const estadoClassName = estado.toLowerCase().replace(/\s+/g, '-');
        
        const filaHTML = `
            <tr>
                <td colspan="12">
                    <div class="historial-card">
                        <div class="card-header">
                            <div class="card-fecha">
                                <span>📅 ${viaje.fecha_turno || 'Sin fecha'}</span>
                                <span>🕒 ${viaje.hora_turno || '--:--'}</span>
                            </div>
                            <div class="card-pasajero"><strong>Pasajero:</strong> ${viaje.nombre_pasajero || 'N/A'}</div>
                            <div class="estado-tag estado-${estadoClassName}">${estado}</div>
                        </div>
                        
                        <div class="card-body">
                            <div class="card-details-grid">
                                <div class="card-detail-item"><strong>Cliente:</strong> ${viaje.clienteNombre || 'N/A'}</div>
                                <div class="card-detail-item"><strong>Chofer:</strong> ${viaje.choferNombre || 'N/A'}</div>
                                <div class="card-detail-item"><strong>Siniestro:</strong> ${viaje.siniestro || 'N/A'}</div>
                                <div class="card-detail-item"><strong>Autorización:</strong> ${viaje.autorizacion || 'N/A'}</div>
                                <div class="card-detail-item"><strong>Tel. Pasajero:</strong> ${viaje.telefono_pasajero || 'N/A'}</div>
                            </div>
                        </div>

                        <div class="card-locations">
                            <div class="location-group">
                                <span class="location-label">Origen</span>
                                <div class="location-address">${viaje.origen || 'N/A'}</div>
                            </div>
                            <div class="location-arrow">→</div>
                            <div class="location-group">
                                <span class="location-label">Destino</span>
                                <div class="location-address">${viaje.destino || 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        historialBody.innerHTML += filaHTML;
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