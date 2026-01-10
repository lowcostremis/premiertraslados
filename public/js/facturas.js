import { db } from './firebase-config.js';
import { obtenerValorPeaje } from './tarifas.js';

let reservasEnPrevia = []; // Almacena los viajes calculados temporalmente antes de emitir

export function initFacturacion() {
    const btnBuscar = document.getElementById('btn-buscar-facturar');
    const btnEmitir = document.getElementById('btn-emitir-factura');

    if (btnBuscar) {
        btnBuscar.onclick = () => buscarReservasParaFacturar();
    }

    if (btnEmitir) {
        btnEmitir.onclick = () => emitirFactura();
    }
    
    
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
        // 1. Obtener configuración del cliente desde el caché global
        const clienteConfig = window.appCaches.clientes[clienteId];
        
        if (!clienteConfig) {
            tbody.innerHTML = '<tr><td colspan="8" style="color:red;">Error: No se encontró la configuración del cliente.</td></tr>';
            return;
        }

        // 2. Traer viajes del histórico filtrados por cliente y fecha
        const snapshot = await db.collection('historico')
            .where('cliente', '==', clienteId)
            .where('fecha_turno', '>=', desde)
            .where('fecha_turno', '<=', hasta)
            .get();

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">No hay viajes finalizados para facturar en este período.</td></tr>';
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

            html += `
                <tr>
                    <td>${viaje.fecha_turno}</td>
                    <td>${viaje.nombre_pasajero}</td>
                    <td>${viaje.origen} ➔ ${viaje.destino}</td>
                    <td style="text-align:center;">${viaje.distancia || '0'}</td>
                    <td>$ ${calculo.base.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td>$ ${calculo.espera.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td>${calculo.tienePeaje ? '✅ SI ($' + calculo.montoPeaje + ')' : 'NO'}</td>
                    <td style="font-weight:bold; color: #1e3a8a;">$ ${calculo.totalViaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                </tr>`;
        });

        tbody.innerHTML = html;
        
        // Actualizar el resumen visual
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
    const costoBajada = parseFloat(config.bajada_bandera) || 0;

    if (config.tarifas_fijas && config.tarifas_fijas.length > 0) {
        
        const normalizar = (str) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
            esTarifaFija = true;
            
        }
    }

    // 2. SI NO HAY FIJA, CALCULAR POR KM + BAJADA (Prioridad 2)
    if (!esTarifaFija) {
        const umbralKm = (config.km_minimo !== undefined && config.km_minimo !== null) ? parseFloat(config.km_minimo) : 25;
        
        let subtotalDistancia = 0;
        if (km < umbralKm) {
            subtotalDistancia = parseFloat(config.precio_minimo || 0);
        } else {
            subtotalDistancia = km * parseFloat(config.precio_km || 0);
        }

        // Aquí sumamos la bajada de bandera al costo de movimiento
        costoBase = subtotalDistancia + costoBajada;
    }

    // 3. PEAJES
    let montoPeaje = 0;   
    let tienePeaje = false;
    
    if (config.paga_peaje === true) {
        // PRIORIDAD: Si hay peaje manual editado en histórico, usar ese.
        if (viaje.peaje_manual !== undefined && viaje.peaje_manual !== null && !isNaN(viaje.peaje_manual)) {
            montoPeaje = parseFloat(viaje.peaje_manual);
        } else {
            // Si no, calcular automático
            montoPeaje = obtenerValorPeaje(viaje.origen, viaje.destino);
        }
        
        if (montoPeaje > 0) tienePeaje = true;
    }

    // 4. ESPERAS
    let costoEspera = 0;
    const esperaHoras = parseFloat(viaje.espera_total) || 0; 
    const esperaMins = esperaHoras * 60;
    const minsACobrar = esperaMins - (parseFloat(config.espera_cortesia) || 0);

    if (minsACobrar > 0) {
        const fraccion = parseFloat(config.espera_fraccion) || 15;
        const bloques = Math.ceil(minsACobrar / fraccion);
        
        // AQUÍ ESTÁ EL CAMBIO CLAVE:
        const valorHora = parseFloat(config.espera_valor_hora) || 0;
        const precioMinuto = valorHora / 60; // Dividimos la hora por 60 para obtener el precio del minuto

        // Fórmula: Bloques * MinutosPorBloque * PrecioMinuto
        costoEspera = bloques * fraccion * precioMinuto;
    }

    if (viaje.estado === 'Negativo' && config.paga_negativos !== true) {
        costoBase = 0;
        costoEspera = 0;
        montoPeaje = 0;
        tienePeaje = false;
    }

    return {
        base: costoBase, 
        espera: costoEspera,
        montoPeaje: montoPeaje,
        tienePeaje: tienePeaje,
        esFija: esTarifaFija,
        totalViaje: costoBase + costoEspera + montoPeaje
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
        creado_por: window.currentUserEmail || 'Sistema'
    };

    try {
        await db.collection('facturas').add(factura);
        alert("Factura guardada con éxito en el Historial Administrativo.");
        
        // Limpiar vista
        reservasEnPrevia = [];
        document.querySelector('#tabla-previa-factura tbody').innerHTML = '';
        document.getElementById('resumen-factura-card').style.display = 'none';
        
    } catch (e) {
        console.error("Error al guardar factura:", e);
        alert("Error al intentar guardar la factura en la base de datos.");
    }
}


export async function cargarFacturasEmitidas() {
    const container = document.getElementById('lista-facturas-emitidas');
    if (!container) return;

    container.innerHTML = '<p style="text-align:center;">Cargando historial...</p>';

    try {
        const snapshot = await db.collection('facturas').orderBy('fecha_emision', 'desc').limit(50).get();
        
        if (snapshot.empty) {
            container.innerHTML = '<p>No se registran facturas emitidas anteriormente.</p>';
            return;
        }

        let html = '<div class="table-wrapper"><table><thead><tr><th>Cliente</th><th>Período</th><th>Emisión</th><th>Total Liquidado</th><th>Acciones</th></tr></thead><tbody>';

        snapshot.forEach(doc => {
            const f = doc.data();
            html += `
                <tr>
                    <td>${f.cliente_nombre}</td>
                    <td>${f.periodo.desde} al ${f.periodo.hasta}</td>
                    <td>${f.fecha_emision}</td>
                    <td style="font-weight:bold;">$ ${f.total_final.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="acciones">
                        <button class="btn-primary" onclick="window.app.verFactura('${doc.id}')">🖨️ Ver Detalle / Imprimir</button>
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

// --- NUEVA FUNCIÓN PARA GENERAR EL PDF/VISTA DE IMPRESIÓN ---

export async function verFactura(facturaId) {
    try {
        const doc = await db.collection('facturas').doc(facturaId).get();
        if (!doc.exists) return alert("Error: La factura no existe.");
        
        const f = doc.data();
        const items = f.items || [];

        // Calculamos totales auxiliares para el reporte
        const totalKM = items.reduce((sum, item) => sum + (parseFloat(item.distancia) || 0), 0);
        const totalEsperas = items.reduce((sum, item) => sum + (item.espera || 0), 0);
        const totalPeajes = items.reduce((sum, item) => sum + (item.montoPeaje || 0), 0);

        // Diseñamos el HTML de la factura con MÁS DETALLES
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
                
                /* Ajustamos la tabla para que entren las nuevas columnas */
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
                th { background: #6f42c1; color: white; padding: 6px; text-align: left; }
                td { border-bottom: 1px solid #ddd; padding: 5px; vertical-align: middle; }
                
                .total-row { font-size: 14px; font-weight: bold; background: #eef2ff; }
                .text-right { text-align: right; }
                .footer { margin-top: 30px; font-size: 10px; color: #777; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
                
                /* Colores para estados */
                .estado-negativo { color: red; font-weight: bold; }
                .estado-finalizado { color: green; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">Premier Traslados</div>
                <div class="info-factura">
                    <strong>Liquidación de Servicios</strong><br>
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
            // Formateo de ruta corto
            const rutaCorta = `${item.origen.split(',')[0]} ➔ ${item.destino.split(',')[0]}`;
            
            // Lógica de visualización del estado
            let estadoRaw = (typeof item.estado === 'object' ? item.estado.principal : item.estado) || '';
            let claseEstado = '';
            if (estadoRaw === 'Negativo') claseEstado = 'estado-negativo';
            if (estadoRaw === 'Finalizado') claseEstado = 'estado-finalizado';

            htmlContent += `
                <tr>
                    <td>${item.fecha_turno}</td>
                    <td>${item.nombre_pasajero}</td>
                    <td>${item.siniestro || '-'}</td>       <td>${item.autorizacion || '-'}</td>    <td>${rutaCorta}</td>
                    <td>${item.distancia}</td>
                    <td class="${claseEstado}">${estadoRaw}</td> <td class="text-right">$ ${item.base.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right">$ ${item.espera.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right">$ ${item.montoPeaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    <td class="text-right" style="font-weight:bold;">$ ${item.totalViaje.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                </tr>
            `;
        });

        // NOTA: El colspan ahora es 10 porque tenemos 11 columnas en total (11 - 1 del total = 10)
        htmlContent += `
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="10" class="text-right" style="padding-top: 15px;"><strong>Subtotal Peajes:</strong></td>
                        <td class="text-right" style="padding-top: 15px;">$ ${totalPeajes.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    </tr>
                    <tr>
                        <td colspan="10" class="text-right"><strong>Subtotal Esperas:</strong></td>
                        <td class="text-right">$ ${totalEsperas.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    </tr>
                    <tr class="total-row">
                        <td colspan="10" class="text-right" style="padding: 10px;">TOTAL FINAL:</td>
                        <td class="text-right" style="padding: 10px; color: #1e3a8a;">$ ${f.total_final.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="footer">
                Documento generado electrónicamente por Sistema Premier Traslados - ${new Date().toLocaleString()}
            </div>

            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
        `;

        // Abrir ventana y escribir el contenido
        const ventana = window.open('', '_blank', 'width=1100,height=700');
        ventana.document.write(htmlContent);
        ventana.document.close();

    } catch (e) {
        console.error(e);
        alert("Error al generar la impresión.");
    }
}