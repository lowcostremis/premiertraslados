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
        montoPeaje = obtenerValorPeaje(viaje.origen, viaje.destino);
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
                        <button class="btn-primary" onclick="alert('Funcionalidad de impresión en desarrollo para el ID: ${doc.id}')">Ver Detalle / Imprimir</button>
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