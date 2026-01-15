import { db } from './firebase-config.js';
import { obtenerValorPeaje } from './tarifas.js';

let reservasEnPrevia = []; 

export function initFacturacion() {
    const btnBuscar = document.getElementById('btn-buscar-facturar');
    const btnEmitir = document.getElementById('btn-emitir-factura');

    if (btnBuscar) btnBuscar.onclick = () => buscarReservasParaFacturar();
    if (btnEmitir) btnEmitir.onclick = () => emitirFactura();
}

async function buscarReservasParaFacturar() {
    const clienteId = document.getElementById('fact-cliente-select').value;
    const desde = document.getElementById('fact-fecha-desde').value;
    const hasta = document.getElementById('fact-fecha-hasta').value;

    if (!clienteId || !desde || !hasta) {
        return alert("Por favor, seleccioná cliente y rango de fechas.");
    }

    const tbody = document.querySelector('#tabla-previa-factura tbody');
    const resumenCard = document.getElementById('resumen-factura-card');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Calculando liquidación...</td></tr>';

    try {
        const clienteConfig = window.appCaches.clientes[clienteId];
        
        if (!clienteConfig) {
            tbody.innerHTML = '<tr><td colspan="8" style="color:red;">Error: No se encontró la configuración del cliente.</td></tr>';
            return;
        }

        const snapshot = await db.collection('historico')
            .where('cliente', '==', clienteId)
            .where('fecha_turno', '>=', desde)
            .where('fecha_turno', '<=', hasta)
            .get();

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">No hay viajes para facturar en este período.</td></tr>';
            resumenCard.style.display = 'none';
            return;
        }

        reservasEnPrevia = [];
        let html = '';
        let acumuladoFinal = 0;

        snapshot.forEach(doc => {
            const viaje = doc.data();
            const calculo = calcularTotalesViaje(viaje, clienteConfig);
            
            acumuladoFinal += calculo.totalViaje;
            
            reservasEnPrevia.push({ id: doc.id, ...viaje, ...calculo });

            let celdaTotal = '';
            if (calculo.totalViaje === 0 && calculo.totalTeorico > 0) {
                const motivo = calculo.estadoNormalizado === 'Negativo' ? 'Negativo' : 
                               calculo.estadoNormalizado === 'Debitado' ? 'Debitado' : 'Anulado';
                
                celdaTotal = `
                    <div style="font-size: 11px; color: #999; text-decoration: line-through;">
                        $ ${calculo.totalTeorico.toLocaleString('es-AR', {minimumFractionDigits: 2})}
                    </div>
                    <div style="color: #dc3545; font-weight: bold;">
                        $ 0,00 <span style="font-size: 10px;">(${motivo})</span>
                    </div>
                `;
            } else {
                const color = calculo.estadoNormalizado === 'Negativo' ? '#dc3545' : '#1e3a8a';
                celdaTotal = `<span style="font-weight:bold; color: ${color};">$ ${calculo.totalViaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>`;
            }

            html += `
                <tr>
                    <td>${viaje.fecha_turno}</td>
                    <td>${viaje.nombre_pasajero}</td>
                    <td>${viaje.origen} ➔ ${viaje.destino}</td>
                    <td style="text-align:center;">${viaje.distancia || '0'}</td>
                    <td>$ ${calculo.base.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td>$ ${calculo.espera.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td>${calculo.tienePeaje ? '✅ SI ($' + calculo.montoPeaje + ')' : 'NO'}</td>
                    <td style="vertical-align: middle;">${celdaTotal}</td>
                </tr>`;
        });

        tbody.innerHTML = html;
        
        const totalDisplay = document.getElementById('fact-total-final');
        if (totalDisplay) totalDisplay.textContent = `$ ${acumuladoFinal.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        resumenCard.style.display = 'block';

    } catch (error) {
        console.error("Error al procesar facturación:", error);
        tbody.innerHTML = '<tr><td colspan="8" style="color:red;">Error al procesar los datos del historial.</td></tr>';
    }
}

function calcularTotalesViaje(viaje, config) {
    const km = parseFloat(viaje.distancia?.replace(/[^0-9.]/g, '')) || 0;
    let costoBase = 0;
    let esTarifaFija = false;
    let peajeFijoConfigurado = 0; // Variable para guardar el peaje de la ruta fija si existe
    const costoBajada = parseFloat(config.bajada_bandera) || 0;

    // 1. Detección de Tarifa Fija
    if (config.tarifas_fijas && config.tarifas_fijas.length > 0) {
        const normalizar = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const origenViaje = normalizar(viaje.origen);
        const destinoViaje = normalizar(viaje.destino);

        const tarifaEncontrada = config.tarifas_fijas.find(t => {
            const oFijo = normalizar(t.origen);
            const dFijo = normalizar(t.destino);
            return (origenViaje.includes(oFijo) && destinoViaje.includes(dFijo)) ||
                   (origenViaje.includes(dFijo) && destinoViaje.includes(oFijo));
        });

        if (tarifaEncontrada) {
            costoBase = parseFloat(tarifaEncontrada.precio);
            peajeFijoConfigurado = parseFloat(tarifaEncontrada.peaje || 0); // Capturamos el peaje fijo
            esTarifaFija = true;
        }
    }

    // 2. Si no es fija, calcular por KM
    if (!esTarifaFija) {
        const umbralKm = (config.km_minimo !== undefined && config.km_minimo !== null) ? parseFloat(config.km_minimo) : 25;
        let subtotalDistancia = 0;
        
        if (km < umbralKm) {
            subtotalDistancia = parseFloat(config.precio_minimo || 0);
        } else {
            subtotalDistancia = km * parseFloat(config.precio_km || 0);
        }
        costoBase = subtotalDistancia + costoBajada;
    }

    // 3. Lógica de Peajes Mejorada
    let montoPeaje = 0;   
    let tienePeaje = false;
    
    // Solo procesamos peajes si el cliente paga peajes
    if (config.paga_peaje === true) {
        
        // PRIORIDAD 1: Peaje Manual (El rey absoluta: lo que puso el operador en el viaje)
        if (viaje.peaje_manual !== undefined && viaje.peaje_manual !== null && !isNaN(viaje.peaje_manual)) {
            montoPeaje = parseFloat(viaje.peaje_manual);
        }
        
        // PRIORIDAD 2: Peaje de Tarifa Fija (Si la ruta es fija, USAMOS SU DATO, sea cual sea)
        else if (esTarifaFija) {
            // CORRECCIÓN: Si es tarifa fija, usamos el peaje configurado (incluso si es 0).
            // NUNCA dejamos que pase a la calculadora automática vieja.
            montoPeaje = peajeFijoConfigurado; 
        }
        
        // PRIORIDAD 3: Cálculo Automático Viejo (Solo para viajes normales por KM)
        else {
            // Solo llegamos aquí si NO es tarifa fija y NO hay manual.
            // Aquí es donde salían los $4500 mágicos.
            montoPeaje = obtenerValorPeaje(viaje.origen, viaje.destino);
        }

        if (montoPeaje > 0) tienePeaje = true;
    }

    // 4. Esperas (Cálculo siempre)
    let costoEspera = 0;
    const esperaHoras = parseFloat(viaje.espera_total) || 0; 
    const esperaMins = esperaHoras * 60;
    const minsACobrar = esperaMins - (parseFloat(config.espera_cortesia) || 0);

    if (minsACobrar > 0) {
        const fraccion = parseFloat(config.espera_fraccion) || 15;
        const bloques = Math.ceil(minsACobrar / fraccion);
        const valorHora = parseFloat(config.espera_valor_hora) || 0;
        const precioMinuto = valorHora / 60;
        costoEspera = bloques * fraccion * precioMinuto;
    }

    // --- NUEVA LÓGICA DE TOTALES ---
    const totalTeorico = costoBase + costoEspera + montoPeaje;
    
    const estadoRaw = (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || '';
    const estadoNormalizado = estadoRaw.charAt(0).toUpperCase() + estadoRaw.slice(1).toLowerCase();

    let precioEfectivo = totalTeorico;

    if (estadoNormalizado === 'Anulado' || estadoNormalizado === 'Debitado') {
        precioEfectivo = 0;
    }
    else if (estadoNormalizado === 'Negativo') {
        if (config.paga_negativos !== true) { 
            precioEfectivo = 0;
        }
    }

    return {
        base: costoBase, 
        espera: costoEspera,
        montoPeaje: montoPeaje,
        tienePeaje: tienePeaje,
        esFija: esTarifaFija,
        totalTeorico: totalTeorico, 
        totalViaje: precioEfectivo, 
        estadoNormalizado: estadoNormalizado 
    };
}

async function emitirFactura() {
    if (reservasEnPrevia.length === 0) return alert("No hay viajes cargados para emitir.");
    
    if (!confirm(`¿Confirmar emisión de factura para ${window.appCaches.clientes[document.getElementById('fact-cliente-select').value].nombre}?`)) return;

    const clienteId = document.getElementById('fact-cliente-select').value;
    const factura = {
        cliente_id: clienteId,
        cliente_nombre: window.appCaches.clientes[clienteId].nombre,
        fecha_emision: new Date().toISOString().split('T')[0],
        periodo: {
            desde: document.getElementById('fact-fecha-desde').value,
            hasta: document.getElementById('fact-fecha-hasta').value
        },
        items: reservasEnPrevia,
        total_final: reservasEnPrevia.reduce((sum, r) => sum + r.totalViaje, 0),
        estado: 'Emitida', // NUEVO: Estado de la factura
        creado_por: window.currentUserEmail || 'Sistema',
        creado_en: new Date()
    };

    try {
        await db.collection('facturas').add(factura);
        alert("Factura guardada con éxito en el Historial Administrativo.");
        
        reservasEnPrevia = [];
        document.querySelector('#tabla-previa-factura tbody').innerHTML = '';
        document.getElementById('resumen-factura-card').style.display = 'none';
        
        // Refrescar lista de emitidas
        window.app.mostrarSubTabFact('emitidas');

    } catch (e) {
        console.error("Error al guardar factura:", e);
        alert("Error al intentar guardar la factura en la base de datos.");
    }
}

// --- NUEVA LÓGICA DE REFACTURACIÓN ---
export async function anularFactura(facturaId, clienteId, fechaDesde, fechaHasta) {
    const motivo = prompt("Por favor, ingrese el motivo de la anulación (Ej: 'Corrección de viaje', 'Error de fecha'):");
    if (!motivo) return;

    if (!confirm("⚠️ ATENCIÓN: Esta acción ANULARÁ la factura actual y te llevará a generar una nueva con los datos actualizados. ¿Continuar?")) return;

    try {
        const operador = window.currentUserEmail || 'Sistema';
        await db.collection('facturas').doc(facturaId).update({
            estado: 'Anulada',
            anulada_por: operador,
            motivo_anulacion: motivo,
            anulada_en: new Date()
        });

        alert("Factura anulada correctamente. Redirigiendo para generar la nueva...");

        // 1. Cambiar a la pestaña de generación
        window.app.mostrarSubTabFact('generar');

        // 2. Pre-cargar los datos
        document.getElementById('fact-cliente-select').value = clienteId;
        document.getElementById('fact-fecha-desde').value = fechaDesde;
        document.getElementById('fact-fecha-hasta').value = fechaHasta;

        // 3. Ejecutar la búsqueda automáticamente para traer los datos nuevos
        setTimeout(() => {
            buscarReservasParaFacturar();
        }, 500);

    } catch (e) {
        console.error("Error al anular:", e);
        alert("Error al anular la factura: " + e.message);
    }
}


export async function cargarFacturasEmitidas() {
    const container = document.getElementById('lista-facturas-emitidas');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;">Cargando historial...</p>';

    try {
        const snapshot = await db.collection('facturas').orderBy('creado_en', 'desc').limit(50).get();
        if (snapshot.empty) {
            container.innerHTML = '<p>No se registran facturas emitidas anteriormente.</p>';
            return;
        }

        let html = '<div class="table-wrapper"><table><thead><tr><th>Cliente</th><th>Período</th><th>Emisión</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead><tbody>';

        snapshot.forEach(doc => {
            const f = doc.data();
            const esAnulada = f.estado === 'Anulada';
            
            // Estilos según estado
            const estiloEstado = esAnulada 
                ? 'background:#ffebee; color:#c62828; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:bold;' 
                : 'background:#e8f5e9; color:#2e7d32; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:bold;';
            
            const estiloFila = esAnulada ? 'opacity: 0.6; background-color: #f9f9f9;' : '';
            const textoTotal = esAnulada 
                ? `<span style="text-decoration:line-through;">$ ${f.total_final.toLocaleString('es-AR', {minimumFractionDigits: 2})}</span>` 
                : `$ ${f.total_final.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

            // Botones de acción
            let botones = `<button class="btn-primary" onclick="window.app.verFactura('${doc.id}')" style="padding: 4px 8px; font-size: 11px;">🖨️ Ver</button>`;
            
            if (!esAnulada) {
                // Botón REFACTURAR (Anular y Regenerar)
                botones += ` <button onclick="window.app.anularFactura('${doc.id}', '${f.cliente_id}', '${f.periodo.desde}', '${f.periodo.hasta}')" 
                             style="background-color: #ff9800; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-left:5px;" 
                             title="Anular esta factura y generar una nueva con datos corregidos">
                             ♻️ Refacturar
                             </button>`;
            } else {
                botones += ` <span style="font-size:10px; color:red; margin-left:5px;" title="${f.motivo_anulacion || ''}">(Anulada)</span>`;
            }

            html += `
                <tr style="${estiloFila}">
                    <td>${f.cliente_nombre}</td>
                    <td>${f.periodo.desde} <br> ${f.periodo.hasta}</td>
                    <td>${f.fecha_emision}</td>
                    <td><span style="${estiloEstado}">${f.estado || 'Emitida'}</span></td>
                    <td style="font-weight:bold;">${textoTotal}</td>
                    <td class="acciones">
                        ${botones}
                    </td>
                </tr>`;
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error("Error al cargar emitidas:", error);
        container.innerHTML = '<p style="color:red;">Error al conectar con el historial de facturas.</p>';
    }
}

export async function verFactura(facturaId) {
    try {
        const doc = await db.collection('facturas').doc(facturaId).get();
        if (!doc.exists) return alert("Error: La factura no existe.");
        
        const f = doc.data();
        const items = f.items || [];
        
        // Marca de agua si está anulada
        const watermark = f.estado === 'Anulada' 
            ? `<div style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:100px; color:rgba(255,0,0,0.1); font-weight:bold; z-index:9999; pointer-events:none;">ANULADA</div>` 
            : '';

        const totalEsperas = items.reduce((sum, item) => sum + (item.espera || 0), 0);
        const totalPeajes = items.reduce((sum, item) => sum + (item.montoPeaje || 0), 0);

        let htmlContent = `
        <html>
        <head>
            <title>Factura - ${f.cliente_nombre}</title>
            <style>
                body { font-family: 'Helvetica', sans-serif; padding: 20px; color: #333; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #6f42c1; padding-bottom: 10px; margin-bottom: 20px; }
                .logo { font-size: 22px; font-weight: bold; color: #6f42c1; }
                .info-factura { text-align: right; font-size: 12px; }
                .cliente-box { background: #f8f9fa; padding: 10px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
                th { background: #6f42c1; color: white; padding: 6px; text-align: left; }
                td { border-bottom: 1px solid #ddd; padding: 5px; vertical-align: middle; }
                .total-row { font-size: 14px; font-weight: bold; background: #eef2ff; }
                .text-right { text-align: right; }
                .footer { margin-top: 30px; font-size: 10px; color: #777; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
                .estado-negativo { color: #dc3545; font-weight: bold; }
                .estado-neutro { color: #6c757d; font-style: italic; }
            </style>
        </head>
        <body>
            ${watermark}
            <div class="header">
                <div class="logo">Premier Traslados</div>
                <div class="info-factura">
                    <strong>Liquidación de Servicios</strong><br>
                    Estado: <strong>${f.estado || 'Emitida'}</strong><br>
                    Fecha Emisión: ${f.fecha_emision}<br>
                    Período: ${f.periodo.desde} al ${f.periodo.hasta}<br>
                    ID Ref: ${doc.id.slice(0, 8)}...
                </div>
            </div>

            <div class="cliente-box">
                <strong>Cliente:</strong> ${f.cliente_nombre}<br>
            </div>

            <h3>Detalle de Viajes</h3>
            <table>
                <thead>
                    <tr>
                        <th style="width: 70px;">Fecha</th>
                        <th>Pasajero</th>
                        <th>Siniestro</th> <th>Auth.</th>     <th>Ruta</th>
                        <th>KM</th>
                        <th>Estado</th>    <th class="text-right">Base</th>
                        <th class="text-right">Espera</th>
                        <th class="text-right">Peaje</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
        `;

        items.forEach(item => {
            const rutaCorta = `${item.origen.split(',')[0]} ➔ ${item.destino.split(',')[0]}`;
            const est = item.estadoNormalizado || (typeof item.estado === 'object' ? item.estado.principal : item.estado);
            
            let claseEstado = '';
            let textoTotal = `$ ${item.totalViaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

            if (item.totalViaje === 0 && item.totalTeorico > 0) {
                claseEstado = 'estado-neutro'; 
                textoTotal = `<span style="text-decoration:line-through; font-size:9px;">$${item.totalTeorico}</span><br>$ 0.00`;
                if (est === 'Negativo') claseEstado = 'estado-negativo'; 
            }

            htmlContent += `
                <tr>
                    <td>${item.fecha_turno}</td>
                    <td>${item.nombre_pasajero}</td>
                    <td>${item.siniestro || '-'}</td>       <td>${item.autorizacion || '-'}</td>    <td>${rutaCorta}</td>
                    <td>${item.distancia}</td>
                    <td class="${claseEstado}">${est}</td> 
                    <td class="text-right">$ ${item.base.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right">$ ${item.espera.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right">$ ${item.montoPeaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right" style="font-weight:bold;">${textoTotal}</td>
                </tr>
            `;
        });

        htmlContent += `
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="10" class="text-right" style="padding: 10px;">TOTAL LIQUIDACIÓN:</td>
                        <td class="text-right" style="padding: 10px; color: #1e3a8a;">$ ${f.total_final.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="footer">
                Documento generado electrónicamente por Sistema Premier Traslados - ${new Date().toLocaleString()}
                ${f.estado === 'Anulada' ? `<br><strong style="color:red">DOCUMENTO ANULADO: ${f.motivo_anulacion || ''}</strong>` : ''}
            </div>

            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>
        `;

        const ventana = window.open('', '_blank', 'width=1100,height=700');
        ventana.document.write(htmlContent);
        ventana.document.close();

    } catch (e) {
        console.error(e);
        alert("Error al generar la impresión.");
    }
}