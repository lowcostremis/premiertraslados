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

// 2. Cargar Historial con FILTROS REALES
export async function cargarHistorial() {
    if (!historialBody) return;
    
    const clienteId = document.getElementById('filtro-cliente-historial')?.value;
    const fechaDesde = document.getElementById('fecha-desde-historial')?.value;
    const fechaHasta = document.getElementById('fecha-hasta-historial')?.value;

    try {
        historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Filtrando...</td></tr>';
        
        let query = db.collection('historico').orderBy('fecha_turno', 'desc');

        // Aplicamos filtros de Firebase si existen
        if (clienteId) query = query.where('cliente', '==', clienteId);
        if (fechaDesde) query = query.where('fecha_turno', '>=', fechaDesde);
        if (fechaHasta) query = query.where('fecha_turno', '<=', fechaHasta);

        const cursor = historialDePaginas[paginaActual];
        if (cursor) query = query.startAfter(cursor);
        
        const querySnapshot = await query.limit(registrosPorPagina).get();
        const documentos = querySnapshot.docs;

        if (documentos.length === 0) {
            historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px;">No se encontraron viajes con estos filtros.</td></tr>';
            return;
        }

        ultimoDocVisible = documentos[documentos.length - 1];
        mostrarDatosHistorialEnTabla(documentos);
        actualizarEstadoBotonesPaginacion(documentos.length);

    } catch (error) {
        console.error("Error:", error);
        historialBody.innerHTML = '<tr><td colspan="10" style="color:red;">Error de índice: Asegurate de crear el índice en Firebase.</td></tr>';
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

// 1. Mejorar el renderizado para usar el Caché de Nombres
function mostrarDatosHistorialEnTabla(documentos) {
    if (!historialBody) return;
    historialBody.innerHTML = ''; 

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        const estado = (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A';
        const estadoStr = estado.toUpperCase();
        
        // --- CAMBIO DE COLOR: NEGATIVOS TAMBIÉN EN ROJO ---
        const colorEstado = (estadoStr === 'ANULADO' || estadoStr === 'NEGATIVO') ? 'red' : '#007bff';

        // Resolvemos nombres usando los caches globales del sistema
        const clienteObj = window.appCaches?.clientes?.[viaje.cliente] || { nombre: viaje.cliente_nombre || 'N/A' };
        const choferObj = window.appCaches?.choferes?.find(c => c.id === (viaje.chofer_asignado_id || viaje.asignado_a)) || { nombre: 'N/A' };

        // Formateamos el Log para que se vea bien en el alert
        const logLimpio = viaje.log ? viaje.log.replace(/\n/g, '\\n') : 'Sin registros de auditoría';

        // Buscamos autorizacion/siniestro en ambos campos posibles
        const auth = viaje.nro_autorizacion || viaje.autorizacion || '-';
        const sin = viaje.nro_siniestro || viaje.siniestro || '-';

        const filaHTML = `
            <tr>
                <td colspan="10">
                    <div class="historial-card" style="margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <div class="card-header" style="background: #f8f9fa; padding: 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee;">
                            <div style="font-size: 13px;">📅 ${viaje.fecha_turno || 'S/F'} 🕒 ${viaje.hora_turno || '--:--'}</div>
                            <div style="font-weight: bold; color: #333;">👤 ${viaje.nombre_pasajero || 'N/A'}</div>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button onclick="alert(\`${logLimpio}\`)" 
                                        style="background: #6c757d; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">
                                    📜 Ver Log
                                </button>
                                <span style="font-weight: bold; color: ${colorEstado}; font-size: 12px;">${estadoStr}</span>
                            </div>
                        </div>
                        <div class="card-body" style="padding: 10px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 13px;">
                            <div><strong>Cliente:</strong> ${clienteObj.nombre}</div>
                            <div><strong>Chofer:</strong> ${choferObj.nombre}</div>
                            <div><strong>KM:</strong> ${viaje.distancia || '--'}</div>
                            <div><strong>Sin:</strong> ${sin} | <strong>Aut:</strong> ${auth}</div>
                        </div>
                        <div style="padding: 10px; font-size: 12px; border-top: 1px dashed #eee; color: #555; background: #fffcf5;">
                            📍 ${viaje.origen || 'N/A'} <br>
                            🏁 ${viaje.destino || 'N/A'}
                        </div>
                    </div>
                </td>
            </tr>`;
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