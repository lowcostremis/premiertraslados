import { db, historicoSearchIndex, functions } from './firebase-config.js';
import { activarAutocomplete } from './mapa.js';
import { calcularKilometrosEntrePuntos } from './reservas.js';


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
    
                // VERIFICAR SI RECIBIMOS EL ARCHIVO (BASE64)
                if (result.data && result.data.data) {
                    
                    // Convertir Base64 a Blob (Archivo binario)
                    const byteCharacters = atob(result.data.data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                    
                    // Crear enlace invisible para descargar
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `Reporte_${fechaDesde}_al_${fechaHasta}.xlsx`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    alert(`✅ Se exportaron ${result.data.count} viajes correctamente.`);
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
    // --- INICIO DE LA CORRECCIÓN ---
    // Si la variable historialBody está vacía (bug de carga), la buscamos de nuevo manualmente.
    if (!historialBody) {
        historialBody = document.getElementById('body-historico');
        // Si acabamos de encontrarla, reconectamos también los botones para prevenir otros errores
        if (!btnAnterior) btnAnterior = document.getElementById('btn-anterior');
        if (!btnSiguiente) btnSiguiente = document.getElementById('btn-siguiente');
        if (!indicadorPagina) indicadorPagina = document.getElementById('indicador-pagina');
    }
    
    // Si AÚN ASÍ no existe (ej: estamos en otra pestaña), entonces sí salimos.
    if (!historialBody) return console.warn("No se encontró la tabla de histórico (DOM no listo).");
    // --- FIN DE LA CORRECCIÓN ---

    const clienteId = document.getElementById('filtro-cliente-historial')?.value;
    const fechaDesde = document.getElementById('fecha-desde-historial')?.value;
    const fechaHasta = document.getElementById('fecha-hasta-historial')?.value;

    try {
        historialBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Filtrando...</td></tr>';
        
        let query = db.collection('historico').orderBy('fecha_turno', 'desc');

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
        historialBody.innerHTML = '<tr><td colspan="10" style="color:red;">Error de índice o conexión.</td></tr>';
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

// 1. MODIFICAR: Función mostrarDatosHistorialEnTabla para agregar el botón
function mostrarDatosHistorialEnTabla(documentos) {
    const historialBody = document.getElementById('body-historico');
    if (!historialBody) return;
    historialBody.innerHTML = ''; 

    documentos.forEach(item => {
        const viaje = typeof item.data === 'function' ? item.data() : item;
        const id = item.id || (typeof item.data === 'function' ? item.ref.id : item.objectID); // Asegurar ID
        const estado = (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A';
        const estadoStr = estado.toUpperCase();
        let colorEstado = '#003cff'; // Azul por defecto (Finalizado)
        if (estadoStr === 'ANULADO' || estadoStr === 'NEGATIVO') {
            colorEstado = 'red';
        } else if (estadoStr === 'DEBITADO') {
            colorEstado = '#6f42c1'; // Púrpura para coincidir con CSS
        }
        const clienteObj = window.appCaches?.clientes?.[viaje.cliente] || { nombre: viaje.cliente_nombre || 'N/A' };
        const choferObj = window.appCaches?.choferes?.find(c => c.id === (viaje.chofer_asignado_id || viaje.asignado_a)) || { nombre: 'N/A' };
        const logLimpio = viaje.log ? viaje.log.replace(/\n/g, '\\n').replace(/"/g, '&quot;') : 'Sin registros';

        const filaHTML = `
            <tr>
                <td style="font-size: 12px; vertical-align: middle;">${viaje.autorizacion || '---'}</td>
                
                <td style="font-size: 12px; vertical-align: middle;">${viaje.siniestro || '---'}</td>
                
                <td style="vertical-align: middle;">${viaje.fecha_turno || '--/--'}</td>
                
                <td style="vertical-align: middle;">${viaje.hora_turno || '--:--'}</td>
                
                <td style="vertical-align: middle;">
                    <div style="font-weight:bold; font-size: 13px;">${viaje.nombre_pasajero || 'N/A'}</div>
                    <div style="font-size: 11px; color: #1877f2; margin-top:2px;">🏢 ${clienteObj.nombre || 'Sin cliente'}</div>
                </td>
                
                <td style="font-size: 11px; vertical-align: middle; max-width: 150px; overflow:hidden; text-overflow:ellipsis;" title="${viaje.origen}">
                    ${viaje.origen || 'N/A'}
                </td>
                
                <td style="font-size: 11px; vertical-align: middle; max-width: 150px; overflow:hidden; text-overflow:ellipsis;" title="${viaje.destino}">
                    ${viaje.destino || 'N/A'}
                </td>
                
                <td style="text-align: center; vertical-align: middle;">
                    <div style="font-weight:bold;">${viaje.distancia || '--'}</div>
                    ${viaje.espera_total && viaje.espera_total != '0' 
                        ? `<div style="font-size: 10px; color: #d63384; margin-top:2px;">⏳ ${viaje.espera_total}hs</div>` 
                        : ''}
                </td>
                
                <td style="font-size: 12px; vertical-align: middle;">${choferObj.nombre}</td>
                
                <td style="text-align: center; vertical-align: middle;">
                    <span style="font-size: 10px; font-weight: bold; color: ${colorEstado}; display:block; margin-bottom:5px;">
                        ${estadoStr}
                    </span>
                    
                    <div style="display: flex; gap: 5px; justify-content: center;">
                        <button onclick="window.app.abrirModalEditarHistorico('${id}')" 
                                title="Editar"
                                style="background: #ffc107; color: black; border: none; padding: 5px 8px; border-radius: 4px; cursor: pointer;">
                            ✏️
                        </button>
                        <button onclick="alert(\`${logLimpio}\`)" 
                                title="Ver Log"
                                style="background: #6c757d; color: white; border: none; padding: 5px 8px; border-radius: 4px; cursor: pointer;">
                            📜
                        </button>
                    </div>
                </td>
            </tr>`;
        
        historialBody.innerHTML += filaHTML;
    });
}

// 2. NUEVA: Función para abrir el modal
export async function abrirModalEditarHistorico(id) {
    try {
        const doc = await db.collection('historico').doc(id).get();
        if (!doc.exists) return alert("El viaje no se encuentra.");
        const data = doc.data();

        // Llenar inputs existentes
        document.getElementById('hist-id').value = id;
        document.getElementById('hist-cliente').value = data.cliente || '';
        document.getElementById('hist-pasajero').value = data.nombre_pasajero || '';
        document.getElementById('hist-origen').value = data.origen || '';
        document.getElementById('hist-destino').value = data.destino || '';
        document.getElementById('hist-distancia').value = data.distancia || '';
        document.getElementById('hist-espera').value = data.espera_total || 0;
        document.getElementById('hist-peaje').value = (data.peaje_manual !== undefined && data.peaje_manual !== null) ? data.peaje_manual : ''; 
        document.getElementById('hist-obs').value = data.observaciones || '';

        // --- NUEVO: CARGAR ESTADO ACTUAL ---
        const selectEstado = document.getElementById('hist-estado');
        if (selectEstado) {
            // Detectamos si el estado viene como objeto o string
            const estadoActual = (typeof data.estado === 'object' ? data.estado.principal : data.estado) || 'Finalizado';
            
            // Normalizamos para que coincida con los values del select (Primera mayúscula)
            const estadoNormalizado = estadoActual.charAt(0).toUpperCase() + estadoActual.slice(1).toLowerCase();
            selectEstado.value = estadoNormalizado;
        }
        

        // Poblar Select de Clientes (sin cambios)
        const selectCliente = document.getElementById('hist-cliente');
        selectCliente.innerHTML = '';
        if (window.appCaches && window.appCaches.clientes) {
            Object.entries(window.appCaches.clientes).forEach(([cid, cdata]) => {
                const opt = document.createElement('option');
                opt.value = cid;
                opt.textContent = cdata.nombre;
                if (cid === data.cliente) opt.selected = true;
                selectCliente.appendChild(opt);
            });
        }
        
        // Activar autocompletado si existe la función
        if (typeof activarAutocomplete === 'function') {
            activarAutocomplete(document.getElementById('hist-origen'));
            activarAutocomplete(document.getElementById('hist-destino'));
        }

        document.getElementById('modal-editar-historico').style.display = 'block';

    } catch (e) {
        console.error(e);
        alert("Error al cargar datos: " + e.message);
    }
}

export async function guardarEdicionHistorico() {
    const id = document.getElementById('hist-id').value;
    const btn = document.querySelector('#form-editar-historico button');
    
    // Recopilar datos básicos
    const updates = {
        cliente: document.getElementById('hist-cliente').value,
        nombre_pasajero: document.getElementById('hist-pasajero').value,
        origen: document.getElementById('hist-origen').value,
        destino: document.getElementById('hist-destino').value,
        distancia: document.getElementById('hist-distancia').value,
        espera_total: parseFloat(document.getElementById('hist-espera').value) || 0,
        peaje_manual: document.getElementById('hist-peaje').value ? parseFloat(document.getElementById('hist-peaje').value) : null,
        observaciones: document.getElementById('hist-obs').value
    };

    // --- NUEVO: CAPTURAR EL NUEVO ESTADO ---
    const nuevoEstado = document.getElementById('hist-estado').value;
    
    try {
        btn.disabled = true; btn.textContent = "Guardando...";
        
        const docRef = db.collection('historico').doc(id);
        
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) throw "El documento no existe";
            
            const dataActual = doc.data();
            const logPrevio = dataActual.log || '';
            const operador = window.currentUserEmail || 'Admin';
            const ahora = new Date().toLocaleString();

            // Lógica para actualizar el objeto estado
            let estadoObj = dataActual.estado;
            const estadoAnterior = (typeof estadoObj === 'object' ? estadoObj.principal : estadoObj) || 'Desconocido';

            // Si el estado cambió, lo registramos y actualizamos el objeto
            let logCambioEstado = '';
            if (estadoAnterior !== nuevoEstado) {
                logCambioEstado = ` (Cambio de estado: ${estadoAnterior} ➔ ${nuevoEstado})`;
                
                // Actualizamos la estructura del estado
                if (typeof estadoObj === 'object') {
                    estadoObj.principal = nuevoEstado;
                    estadoObj.actualizado_en = new Date();
                    estadoObj.detalle = 'Editado desde Histórico';
                } else {
                    estadoObj = { 
                        principal: nuevoEstado, 
                        detalle: 'Editado desde Histórico', 
                        actualizado_en: new Date() 
                    };
                }
                updates.estado = estadoObj; // Agregamos el estado actualizado a los updates
            }

            const nuevoLog = logPrevio + `\n✏️ Editado Histórico${logCambioEstado} por: ${operador} (${ahora})`;
            
            t.update(docRef, { ...updates, log: nuevoLog });
        });

        alert("¡Viaje corregido con éxito!");
        document.getElementById('modal-editar-historico').style.display = 'none';
        
        // Refrescar tabla si existe la función
        if (window.app.cargarHistorial) window.app.cargarHistorial();

    } catch (e) {
        alert("Error al guardar: " + e.message);
        console.error(e);
    } finally {
        btn.disabled = false; btn.textContent = "💾 Guardar Corrección";
    }
}
// 3. NUEVA FUNCIÓN: RECALCULAR
export async function recalcularDistanciaHistorico() {
    // Obtenemos los valores de los inputs del modal
    const origen = document.getElementById('hist-origen').value;
    const destino = document.getElementById('hist-destino').value;
    const inputDistancia = document.getElementById('hist-distancia');

    // Validación básica
    if (!origen || !destino) {
        return alert("Por favor, completá los campos Origen y Destino para poder calcular.");
    }

    // Feedback visual para el usuario
    const valorOriginal = inputDistancia.value;
    inputDistancia.value = "Calculando...";
    inputDistancia.disabled = true;

    try {
        // Llamamos a la función corregida de reservas.js
        const resultado = await calcularKilometrosEntrePuntos(origen, destino);
        
        if (resultado && resultado.distancia > 0) {
            // ¡ÉXITO! Actualizamos el input
            inputDistancia.value = resultado.distancia.toFixed(2) + " km";
        } else {
            alert("Google Maps no pudo encontrar una ruta entre estas direcciones. Verificá que estén bien escritas.");
            inputDistancia.value = valorOriginal; 
        }
    } catch (e) {
        console.error(e);
        alert("Ocurrió un error de conexión con el mapa.");
        inputDistancia.value = valorOriginal;
    } finally {
        inputDistancia.disabled = false;
    }
}


function actualizarEstadoBotonesPaginacion(cantidadDocsRecibidos) {
    if (!btnAnterior || !btnSiguiente) return;
    btnAnterior.disabled = (paginaActual === 0);
    btnSiguiente.disabled = (cantidadDocsRecibidos < registrosPorPagina);
    if (indicadorPagina) {
        indicadorPagina.textContent = `Página ${paginaActual + 1}`;
    }
}