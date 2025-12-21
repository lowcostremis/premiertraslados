// js/informes.js
import { db } from './firebase-config.js';

// --- 1. EXPORTACIÓN A EXCEL ---
document.getElementById('btn-excel-reporte')?.addEventListener('click', () => {
    const tablas = document.querySelectorAll('#reporte-body-print table');
    if (tablas.length === 0) return alert("No hay datos para exportar.");
    const wb = XLSX.utils.book_new();
    let ws;
    tablas.forEach((tabla, index) => {
        if (index === 0) {
            ws = XLSX.utils.table_to_sheet(tabla);
            XLSX.utils.book_append_sheet(wb, ws, "Reporte Completo");
        } else {
            XLSX.utils.sheet_add_dom(ws, tabla, { origin: -1 });
        }
    });
    XLSX.writeFile(wb, `Reporte_Premier_${new Date().toISOString().slice(0,10)}.xlsx`);
});

// --- 2. REPORTE DE EMPRESA (Liquidación) ---
window.ejecutarReporteEmpresa = async () => {
    const empresaId = document.getElementById('rep-empresa-select').value;
    const desde = document.getElementById('rep-empresa-desde').value;
    const hasta = document.getElementById('rep-empresa-hasta').value;

    if (!empresaId || !desde || !hasta) return alert("Completa los filtros.");

    try {
        const [snapReservas, snapHistorico] = await Promise.all([
            db.collection('reservas').where('cliente', '==', empresaId).where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('cliente', '==', empresaId).where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        const todosLosViajes = [...snapReservas.docs, ...snapHistorico.docs];
        if (todosLosViajes.length === 0) return alert("Sin datos.");

        let dias = {};
        todosLosViajes.forEach(doc => {
            const v = doc.data();
            const f = v.fecha_turno || 'S/F';
            if (!dias[f]) dias[f] = { viajes: [], kmOcupado: 0 };
            dias[f].viajes.push(v);
        });

        let html = '';
        const diasOrdenados = Object.keys(dias).sort();

        for (const f of diasOrdenados) {
            const dia = dias[f];
            dia.viajes.sort((a, b) => (a.hora_pickup || a.hora_turno || '00:00').localeCompare(b.hora_pickup || b.hora_turno || '00:00'));

            html += `<div style="background: #f8f9fa; padding: 10px; border-left: 5px solid #007bff; margin-top: 20px; font-weight: bold; font-family: sans-serif;">
                        📅 Fecha: ${new Date(f + 'T00:00:00').toLocaleDateString('es-AR')}
                     </div>
                     <table style="width:100%; border-collapse: collapse; font-size: 9px; font-family: sans-serif;">
                        <thead><tr style="background: #eee; border-bottom: 2px solid #007bff;">
                            <th>Fecha</th><th>Hora</th><th>Pasajero</th><th>Origen</th><th>Destino</th><th>Aut.</th><th>Sin.</th><th>KM</th><th>Estado</th>
                        </tr></thead><tbody>`;

            for (let v of dia.viajes) {
                const estado = (v.estado?.principal || v.estado || 'FINALIZADO').toUpperCase();
                if (estado === 'PENDIENTE' || estado === 'EN CURSO') continue;

                let km = parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;
                if (km === 0 && (estado === 'FINALIZADO' || estado === 'ASIGNADO')) {
                    const rep = await calcularKilometrosEntrePuntos(v.origen, v.destino);
                    km = rep.distancia;
                }

                if (estado !== 'ANULADO' && estado !== 'NEGATIVO') dia.kmOcupado += km;
                html += `<tr style="border-bottom: 1px solid #eee;">
                    <td>${f}</td><td>${v.hora_pickup || v.hora_turno || '--:--'}</td><td><strong>${v.nombre_pasajero}</strong></td><td>${v.origen}</td><td>${v.destino}</td><td>${v.nro_autorizacion || '-'}</td><td>${v.nro_siniestro || '-'}</td><td style="text-align:center;">${km.toFixed(1)}</td><td style="color:${estado === 'ANULADO' ? 'red' : '#007bff'};">${estado}</td>
                </tr>`;
            }
            html += `</tbody></table><div style="text-align:right; font-weight:bold; padding:10px;">Total: ${dia.kmOcupado.toFixed(1)} km</div>`;
        }
        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('reporte-modal').style.display = 'block';
    } catch (e) { console.error(e); }
};

// --- 3. REPORTE DE CHOFER (Jornada Real) ---
window.ejecutarReporteChofer = async () => {
    const desde = document.getElementById('rep-chofer-desde').value;
    const hasta = document.getElementById('rep-chofer-hasta').value;
    const choferId = document.getElementById('rep-chofer-select').value;
    if (!desde || !hasta) return alert("Selecciona fechas.");

    try {
        const [snapR, snapH] = await Promise.all([
            db.collection('reservas').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        let datosChoferes = {};
        [...snapR.docs, ...snapH.docs].forEach(doc => {
            const v = doc.data();
            const idCh = v.chofer_asignado_id || v.asignado_a;
            // CORREGIDO: idCh !== choferId
            if (!idCh || (choferId && idCh !== choferId)) return;
            const fecha = v.fecha_turno || 'S/F';
            if (!datosChoferes[idCh]) {
                const info = window.appCaches.choferes.find(c => c.id === idCh);
                datosChoferes[idCh] = { nombre: info?.nombre || "Desconocido", dias: {} };
            }
            if (!datosChoferes[idCh].dias[fecha]) datosChoferes[idCh].dias[fecha] = { viajes: [], kmOcupado: 0, kmVacio: 0 };
            datosChoferes[idCh].dias[fecha].viajes.push(v);
        });

        let html = '';
        for (const idCh in datosChoferes) {
            const chofer = datosChoferes[idCh];
            html += `<h2 style="background:#6f42c1; color:white; padding:10px;">Chofer: ${chofer.nombre}</h2>`;
            const diasOrd = Object.keys(chofer.dias).sort();

            for (const f of diasOrd) {
                const dia = chofer.dias[f];
                for (let v of dia.viajes) {
                    const estado = (v.estado?.principal || 'FINALIZADO').toUpperCase();
                    let dMin = parseInt(v.duracion_estimada_minutos) || 0;
                    let dist = parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;

                    const tiempoGracia = v.hora_pickup ? 30 : 15; 
                    const hBase = v.hora_pickup || v.hora_turno;

                    if (hBase && hBase !== "--") {
                        const [h, m] = hBase.split(':').map(Number);
                        const calc = new Date();
                        calc.setHours(h, m + (dMin > 0 ? dMin : tiempoGracia));
                        v.h_fin = `${calc.getHours().toString().padStart(2,'0')}:${calc.getMinutes().toString().padStart(2,'0')}`;
                    } else v.h_fin = "--:--";
                    v.dist_n = dist;
                    if (estado !== 'ANULADO' && estado !== 'NEGATIVO') dia.kmOcupado += dist;
                }

                const viajesConHora = dia.viajes.filter(v => (v.hora_pickup || v.hora_turno) && v.hora_pickup !== '--');
                viajesConHora.sort((a, b) => (a.hora_pickup || a.hora_turno || "00:00").localeCompare(b.hora_pickup || b.hora_turno || "00:00"));
                const hIni = viajesConHora.length > 0 ? (viajesConHora[0].hora_pickup || viajesConHora[0].hora_turno) : null;
                const hFinU = viajesConHora.length > 0 ? viajesConHora[viajesConHora.length - 1].h_fin : "--:--";

                html += `<table style="width:100%; border-collapse:collapse; font-size:10px;">
                    <thead><tr style="background:#eee;">
                        <th>Fecha</th><th>H. Turno</th><th>H. Pickup</th><th>Pasajero</th><th>Origen</th><th>Destino</th><th>KM Ocup.</th><th>KM Despl.</th><th>Hora Fin</th>
                    </tr></thead><tbody>`;

                for (const [idx, v] of dia.viajes.entries()) {
                    if (idx > 0) {
                        const resV = await calcularKilometrosEntrePuntos(dia.viajes[idx-1].destino, v.origen);
                        dia.kmVacio += resV.distancia;
                        html += `<tr style="color:#777; font-style:italic;"><td>${f}</td><td>-</td><td>-</td><td>-</td><td>🚗 Desplazamiento</td><td>-</td><td>-</td><td>${resV.distancia.toFixed(2)}</td><td>-</td></tr>`;
                    }
                    html += `<tr><td>${f}</td><td>${v.hora_turno}</td><td>${v.hora_pickup}</td><td>${v.nombre_pasajero}</td><td>${v.origen}</td><td>${v.destino}</td><td>${v.dist_n.toFixed(1)}</td><td>-</td><td>${v.h_fin}</td></tr>`;
                }

                let jText = "--:--";
                if (hIni && hFinU !== "--:--") {
                    const [h1, m1] = hIni.split(':').map(Number);
                    const [h2, m2] = hFinU.split(':').map(Number);
                    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                    if (diff < 0) diff += 1440;
                    jText = `${Math.floor(diff/60)}h ${diff%60}m`;
                }
                html += `</tbody></table><div style="background:#eef2ff; padding:10px; font-weight:bold;">KM Ocup: ${dia.kmOcupado.toFixed(1)} | KM Vacío: ${dia.kmVacio.toFixed(1)} | Jornada: ${jText}</div>`;
            }
        }
        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('reporte-modal').style.display = 'block';
    } catch (e) { console.error(e); }
};

// --- 4. RANKING DE CLIENTES (ACTUALIZADO CON TOTALES Y FINALIZADOS) ---
window.ejecutarRankingClientes = async () => {
    const desde = document.getElementById('rep-kpi-desde').value;
    const hasta = document.getElementById('rep-kpi-hasta').value;
    if (!desde || !hasta) return alert("Selecciona fechas.");

    try {
        const [snapR, snapH] = await Promise.all([
            db.collection('reservas').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        let stats = {};
        [...snapR.docs, ...snapH.docs].forEach(doc => {
            const v = doc.data();
            let infoC = Array.isArray(window.appCaches?.clientes) 
                ? window.appCaches.clientes.find(c => c.id === v.cliente) 
                : window.appCaches?.clientes?.[v.cliente];
            
            let cliente = v.nombre_cliente || infoC?.nombre || v.cliente || "Sin Nombre";
            const estado = (v.estado?.principal || v.estado || 'FINALIZADO').toUpperCase();

            if (!stats[cliente]) stats[cliente] = { total: 0, finalizadas: 0, km: 0, anulados: 0, negativos: 0, esperaSin: 0 };

            stats[cliente].total++;

            if (estado === 'ANULADO') stats[cliente].anulados++;
            else if (estado === 'NEGATIVO') stats[cliente].negativos++;
            else {
                if (estado === 'FINALIZADO') stats[cliente].finalizadas++;
                if (estado !== 'PENDIENTE' && estado !== 'EN CURSO') {
                    stats[cliente].km += parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;
                    stats[cliente].esperaSin += parseFloat(v.espera_sin_cargo) || 0;
                }
            }
        });

        const ranking = Object.entries(stats).sort((a, b) => b[1].km - a[1].km);

        let html = `<h3>📊 Ranking de Clientes (Auditoría Integral)</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:11px; font-family: sans-serif;">
                        <thead>
                            <tr style="background:#007bff; color:white;">
                                <th style="padding:10px; text-align:left;">Cliente</th>
                                <th>Total</th>
                                <th>Finaliz.</th>
                                <th>% Efec.</th>
                                <th>KM Fact.</th>
                                <th>Anulados</th>
                                <th>Negativos</th>
                                <th>Esp. S/C</th>
                            </tr>
                        </thead>
                        <tbody>`;

        ranking.forEach(([name, data]) => {
            // Cálculo de efectividad: Finalizados / Total
            const efec = data.total > 0 ? ((data.finalizadas / data.total) * 100).toFixed(1) : 0;
            const colorEfec = efec > 80 ? 'green' : (efec > 50 ? '#f6c23e' : 'red');

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px; font-weight:500;">${name}</td>
                <td style="text-align:center;">${data.total}</td>
                <td style="text-align:center; color:green; font-weight:bold;">${data.finalizadas}</td>
                <td style="text-align:center; font-weight:bold; color:${colorEfec};">${efec}%</td>
                <td style="font-weight:bold; text-align:center; background:#f9f9f9;">${data.km.toFixed(1)}</td>
                <td style="text-align:center; color:red;">${data.anulados}</td>
                <td style="text-align:center; color:#dc3545;">${data.negativos}</td>
                <td style="text-align:center; color:${data.esperaSin > 5 ? 'red' : '#666'}">${data.esperaSin}</td>
            </tr>`;
        });
        document.getElementById('reporte-body-print').innerHTML = html + "</tbody></table>";
        document.getElementById('reporte-modal').style.display = 'block';
    } catch (e) { console.error(e); }
};

// --- 5. RANKING DE CHOFERES (Con Barra de Carga) ---
window.ejecutarRankingChoferes = async () => {
    const desde = document.getElementById('rep-kpi-desde').value;
    const hasta = document.getElementById('rep-kpi-hasta').value;
    if (!desde || !hasta) return alert("Selecciona fechas.");

    const container = document.getElementById('loading-bar-container');
    const fill = document.getElementById('loading-bar-fill');
    const text = document.getElementById('loading-text');
    container.style.display = 'flex';
    fill.style.width = '0%';

    try {
        const [snapR, snapH] = await Promise.all([
            db.collection('reservas').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        let stats = {};
        let viajesPorChoferYDia = {};
        const todos = [...snapR.docs, ...snapH.docs];

        todos.forEach(doc => {
            const v = doc.data();
            const idCh = v.chofer_asignado_id || v.asignado_a;
            if (!idCh) return;
            const fecha = v.fecha_turno || 'S/F';
            const key = `${idCh}_${fecha}`;
            if (!viajesPorChoferYDia[key]) viajesPorChoferYDia[key] = [];
            viajesPorChoferYDia[key].push(v);
        });

        const totalClaves = Object.keys(viajesPorChoferYDia).length;
        let procesados = 0;

        for (const key in viajesPorChoferYDia) {
            const [idCh] = key.split('_');
            const viajes = viajesPorChoferYDia[key];

            viajes.sort((a, b) => 
                (a.hora_pickup || a.hora_turno || "00:00")
                .localeCompare(b.hora_pickup || b.hora_turno || "00:00")
            );

            if (!stats[idCh]) {
                const info = window.appCaches?.choferes?.find(c => c.id === idCh);
                stats[idCh] = { nombre: info?.nombre || "Desconocido", kmOcupado: 0, kmVacio: 0 };
            }

            for (let i = 0; i < viajes.length; i++) {
                const v = viajes[i];
                const estado = (v.estado?.principal || 'FINALIZADO').toUpperCase();
                if (estado !== 'ANULADO' && estado !== 'NEGATIVO') {
                    stats[idCh].kmOcupado += parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;
                    if (i > 0) {
                        const resV = await calcularKilometrosEntrePuntos(viajes[i-1].destino, v.origen);
                        stats[idCh].kmVacio += resV.distancia;
                    }
                }
            }
            
            procesados++;
            const porc = Math.round((procesados / totalClaves) * 100);
            fill.style.width = porc + '%';
            text.innerText = `Calculando: ${porc}% (${procesados} de ${totalClaves} días)`;
        }

        const ranking = Object.entries(stats).sort((a, b) => b[1].kmOcupado - a[1].kmOcupado);
        let html = `<h3>🥇 Ranking de Choferes (Vaciado)</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tr style="background:#6f42c1; color:white;">
                            <th style="padding:10px;">Chofer</th><th>KM Ocup.</th><th>KM Vacío</th><th>Ratio (%)</th>
                        </tr>`;
        ranking.forEach(([id, data]) => {
            const ratio = (data.kmOcupado + data.kmVacio) > 0 ? (data.kmVacio / (data.kmOcupado + data.kmVacio) * 100).toFixed(1) : 0;
            html += `<tr style="border-bottom:1px solid #ddd;">
                <td style="padding:10px;">${data.nombre}</td>
                <td style="text-align:center; font-weight:bold;">${data.kmOcupado.toFixed(1)}</td>
                <td style="text-align:center;">${data.kmVacio.toFixed(1)}</td>
                <td style="text-align:center; color:${ratio > 30 ? 'red' : 'green'}; font-weight:bold;">${ratio}%</td>
            </tr>`;
        });

        document.getElementById('reporte-body-print').innerHTML = html + "</table>";
        document.getElementById('reporte-modal').style.display = 'block';
        
    } catch (e) { 
        console.error(e); 
        alert("Error al generar ranking."); 
    } finally {
        container.style.display = 'none';
    }
};

// --- 6. FUNCIÓN AUXILIAR MAPS ---
async function calcularKilometrosEntrePuntos(origen, destino) {
    if (!origen || !destino) return { distancia: 0, duracion: 0 };
    const service = new google.maps.DistanceMatrixService();
    return new Promise(resolve => {
        service.getDistanceMatrix({ origins: [origen], destinations: [destino], travelMode: 'DRIVING' }, (res, status) => {
            if (status === "OK" && res.rows[0].elements[0].status === "OK") {
                const el = res.rows[0].elements[0];
                resolve({ distancia: el.distance.value / 1000, duracion: Math.ceil(el.duration.value / 60) });
            } else resolve({ distancia: 0, duracion: 0 });
        });
    });
}