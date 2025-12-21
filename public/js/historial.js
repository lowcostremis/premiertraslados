// js/historial.js

import { db, historicoSearchIndex } from './firebase-config.js';
import { functions } from './firebase-config.js'; 

export function poblarFiltroClientes(clientes) {
    const clienteSelect = document.getElementById('filtro-cliente-historial');
    if (!clienteSelect) return;

    const valorSeleccionado = clienteSelect.value;
    clienteSelect.innerHTML = '<option value="">Todos los clientes</option>';
    
    for (const clienteId in clientes) {
        const cliente = clientes[clienteId];
        clienteSelect.innerHTML += `<option value="${clienteId}">${cliente.nombre}</option>`;
    }
    clienteSelect.value = valorSeleccionado;
}

let historialBody, btnAnterior, btnSiguiente, indicadorPagina;
const registrosPorPagina = 100;
let ultimoDocVisible = null;
let historialDePaginas = [null];
let paginaActual = 0;

export function initHistorial(caches) {
    historialBody = document.getElementById('body-historico');
    btnAnterior = document.getElementById('btn-anterior');
    btnSiguiente = document.getElementById('btn-siguiente');
    indicadorPagina = document.getElementById('indicador-pagina');

    const btnExportar = document.getElementById('btn-exportar-excel-hist');
    
    if (btnExportar) {
        btnExportar.onclick = async () => {
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
    
                if (result.data && result.data.data) {
                    const ws = XLSX.utils.json_to_sheet(result.data.data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Historial");
                    XLSX.writeFile(wb, `historico_${fechaDesde}_al_${fechaHasta}.xlsx`);
                } else {
                    alert('No se encontraron datos para exportar.');
                }
            } catch (error) {
                console.error("Error al exportar:", error);
                alert("Error al generar el reporte: " + error.message);
            } finally {
                btnExportar.textContent = 'Exportar a Excel';
                btnExportar.disabled = false;
            }
        }; 
    }

    if (btnSiguiente) {
        btnSiguiente.onclick = () => {
            if (paginaActual === historialDePaginas.length - 1) {
                historialDePaginas.push(ultimoDocVisible);
            }
            paginaActual++;
            cargarHistorial();
        };
    }
    if (btnAnterior) {
        btnAnterior.onclick = () => {
            if (paginaActual > 0) {
                paginaActual--;
                cargarHistorial();
            }
        };
    }
    
    const searchInput = document.getElementById('search-historial-input');
    if (searchInput) {
        searchInput.oninput = (e) => buscarEnHistorial(e.target.value);
    }
}

export async function cargarHistorial() {
    if (!historialBody) return;
    try {
        historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px;">Cargando historial...</td></tr>';
        
        let query = db.collection('historico').orderBy('archivadoEn', 'desc');
        const cursor = historialDePaginas[paginaActual];
        if (cursor) query = query.startAfter(cursor);
        
        query = query.limit(registrosPorPagina);
        
        const querySnapshot = await query.get();
        const documentos = querySnapshot.docs;

        if (documentos.length === 0 && paginaActual === 0) {
            historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px;">No hay viajes en el historial.</td></tr>';
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
        historialBody.innerHTML = '<tr><td colspan="10" style="color:red; text-align:center;">Error al cargar los datos.</td></tr>';
    }
}

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
        historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Buscando...</td></tr>';
        const { hits } = await historicoSearchIndex.search(texto);
        const documentosFormateados = hits.map(hit => ({ ...hit, id: hit.objectID }));
        mostrarDatosHistorialEnTabla(documentosFormateados);
    } catch (error) {
        console.error("Error buscando en Algolia: ", error);
        historialBody.innerHTML = '<tr><td colspan="10">Error al realizar la búsqueda.</td></tr>';
    }
}

function mostrarDatosHistorialEnTabla(documentos) {
    if (!historialBody) return;
    historialBody.innerHTML = ''; 

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        const estado = (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A';
        const estadoClassName = estado.toLowerCase().replace(/\s+/g, '-');
        
        // CORRECCIÓN: Fallback para nombres de cliente y chofer según tus triggers 
        const cNombre = viaje.cliente_nombre || viaje.clienteNombre || 'N/A';
        const chNombre = viaje.choferNombre || 'N/A';

        const filaHTML = `
            <tr>
                <td colspan="10">
                    <div class="historial-card" style="margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: white;">
                        <div class="card-header" style="background: #f8f9fa; padding: 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee;">
                            <div class="card-fecha">
                                <span style="margin-right: 15px;">📅 ${viaje.fecha_turno || 'Sin fecha'}</span>
                                <span>🕒 ${viaje.hora_turno || '--:--'}</span>
                            </div>
                            <div class="card-pasajero"><strong>Pasajero:</strong> ${viaje.nombre_pasajero || 'N/A'}</div>
                            <div class="estado-tag estado-${estadoClassName}" style="padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; background: #e9ecef;">${estado}</div>
                        </div>
                        
                        <div class="card-body" style="padding: 10px;">
                            <div class="card-details-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 13px;">
                                <div class="card-detail-item"><strong>Cliente:</strong> ${cNombre}</div>
                                <div class="card-detail-item"><strong>Chofer:</strong> ${chNombre}</div>
                                <div class="card-detail-item"><strong>Siniestro:</strong> ${viaje.siniestro || '-'}</div>
                                <div class="card-detail-item"><strong>Aut.:</strong> ${viaje.autorizacion || '-'}</div>
                                <div class="card-detail-item"><strong>KM:</strong> ${viaje.distancia || '--'}</div>
                            </div>
                        </div>

                        <div class="card-locations" style="padding: 10px; background: #fdfdfd; font-size: 12px; display: flex; align-items: center; gap: 10px; border-top: 1px dashed #eee;">
                            <div style="flex: 1;"><span style="color: #666; display: block; font-size: 10px;">ORIGEN</span>${viaje.origen || 'N/A'}</div>
                            <div style="color: #ccc;">➔</div>
                            <div style="flex: 1;"><span style="color: #666; display: block; font-size: 10px;">DESTINO</span>${viaje.destino || 'N/A'}</div>
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