// js/informes.js
import { db } from './firebase-config.js';

// --- 1. EXPORTACIÓN A EXCEL (9 columnas independientes) ---
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

// --- 2. REPORTE DE EMPRESA (Liquidación Detallada) ---
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
                            <th style="padding:8px;">Fecha</th>
                            <th style="padding:8px;">Hora</th>
                            <th style="padding:8px;">Pasajero</th>
                            <th style="padding:8px;">Domicilio Origen</th>
                            <th style="padding:8px;">Domicilio Destino</th>
                            <th style="padding:8px;">Autorización</th>
                            <th style="padding:8px;">Siniestro</th>
                            <th style="padding:8px; text-align:center;">KM</th>
                            <th style="padding:8px;">Estado</th>
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
                const autorizacion = v.nro_autorizacion || v.autorizacion || '-';
                const siniestro = v.nro_siniestro || v.siniestro || '-';

                html += `<tr style="border-bottom: 1px solid #eee;">
                    <td style="padding:8px;">${f}</td>
                    <td style="padding:8px;">${v.hora_pickup || v.hora_turno || '--:--'}</td>
                    <td style="padding:8px;"><strong>${v.nombre_pasajero}</strong></td>
                    <td style="padding:8px;">${v.origen}</td>
                    <td style="padding:8px;">${v.destino}</td>
                    <td style="padding:8px;">${autorizacion}</td>
                    <td style="padding:8px;">${siniestro}</td>
                    <td style="text-align:center; font-weight:bold;">${km.toFixed(1)}</td>
                    <td style="padding:8px; font-weight:bold; color:${estado === 'ANULADO' ? 'red' : '#007bff'};">${estado}</td>
                </tr>`;
            }
            html += `</tbody></table>
                     <div style="background: #e7f1ff; padding: 10px; font-weight: bold; text-align: right; border-bottom: 2px solid #007bff; font-family: sans-serif;">
                        Total Facturable del día: <span style="font-size:14px;">${dia.kmOcupado.toFixed(1)} km</span>
                     </div>`;
        }
        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('reporte-modal').style.display = 'block';
        document.getElementById('modal-param-empresa').style.display = 'none';
    } catch (e) { console.error(e); alert("Error en reporte de empresa."); }
};

// --- 3. REPORTE DE CHOFER (Jornada Real y 9 Columnas) ---
window.ejecutarReporteChofer = async () => {
    const desde = document.getElementById('rep-chofer-desde').value;
    const hasta = document.getElementById('rep-chofer-hasta').value;
    const choferId = document.getElementById('rep-chofer-select').value;
    if (!desde || !hasta) return alert("Selecciona fechas.");

    try {
        const [snapReservas, snapHistorico] = await Promise.all([
            db.collection('reservas').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get(),
            db.collection('historico').where('fecha_turno', '>=', desde).where('fecha_turno', '<=', hasta).get()
        ]);

        const todosLosDocs = [...snapReservas.docs, ...snapHistorico.docs];
        let datosChoferes = {};
        todosLosDocs.forEach(doc => {
            const v = doc.data();
            const idCh = v.chofer_asignado_id || v.asignado_a;
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
            html += `<div style=\"margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; background: white;\">
                     <h2 style=\"background: #6f42c1; color: white; padding: 12px; margin: 0; border-radius: 4px; font-family: sans-serif;\">Chofer: ${chofer.nombre}</h2>`;

            const diasOrdenados = Object.keys(chofer.dias).sort();
            for (const f of diasOrdenados) {
                const dia = chofer.dias[f];
                for (let v of dia.viajes) {
                    const estado = (v.estado?.principal || 'FINALIZADO').toUpperCase();
                    let dMin = parseInt(v.duracion_estimada_minutos) || 0;
                    let dist = parseFloat(v.distancia?.replace(/[^0-9.]/g, '')) || 0;

                    if ((dist === 0 || dMin === 0) && (estado === 'FINALIZADO' || estado === 'ASIGNADO')) {
                        const rep = await calcularKilometrosEntrePuntos(v.origen, v.destino);
                        if (dist === 0) dist = rep.distancia;
                        if (dMin === 0) dMin = rep.duracion;
                    }
                    v.dist_n = dist;
                    if (estado !== 'ANULADO' && estado !== 'NEGATIVO' && estado !== 'PENDIENTE' && estado !== 'EN CURSO') dia.kmOcupado += dist;

                    const tiempoGracia = v.hora_pickup ? 30 : 15; 
                    const hBase = v.hora_pickup || v.hora_turno;

                    if (hBase && hBase !== "--" && hBase !== "--:--") {
                        const [h, m] = hBase.split(':').map(Number);
                        const calc = new Date();
                        if (dMin > 0) calc.setHours(h, m + dMin);
                        else calc.setHours(h, m + tiempoGracia);
                        v.h_fin = `${calc.getHours().toString().padStart(2,'0')}:${calc.getMinutes().toString().padStart(2,'0')}`;
                    } else v.h_fin = "--:--";
                }   

                // --- LÓGICA DE JORNADA REAL ---
                const viajesConHora = dia.viajes.filter(v => (v.hora_pickup || v.hora_turno) && (v.hora_pickup !== '--' && v.hora_turno !== '--'));
                viajesConHora.sort((a, b) => (a.hora_pickup || a.hora_turno).localeCompare(b.hora_pickup || b.hora_turno));

                const hIni = viajesConHora.length > 0 ? (viajesConHora[0].hora_pickup || viajesConHora[0].hora_turno) : null;
                const hFinU = viajesConHora.length > 0 ? viajesConHora[viajesConHora.length - 1].h_fin : "--:--";

                html += `<div style=\"background: #f8f9fa; padding: 5px; border-left: 5px solid #6f42c1; margin-top: 15px; font-family: sans-serif;\">📅 Fecha: ${f}</div>
                         <table style=\"width:100%; border-collapse: collapse; font-size: 10px; font-family: sans-serif;\">
                            <thead><tr style=\"background: #eee;\">
                                <th style="padding:5px;">Fecha</th><th style="padding:5px;">H. Turno</th><th style="padding:5px;">H. Pickup</th><th style="padding:5px;">Pasajero</th><th style="padding:5px;">Origen</th><th style="padding:5px;">Destino</th><th style="padding:5px;">KM Ocup.</th><th style="padding:5px;">KM Despl.</th><th style="padding:5px;">Hora Fin</th>
                            </tr></thead><tbody>`;

                for (const [idx, v] of dia.viajes.entries()) {
                    if (idx > 0) {
                        const resV = await calcularKilometrosEntrePuntos(dia.viajes[idx-1].destino, v.origen);
                        dia.kmVacio += resV.distancia;
                        html += `<tr style="color: #777; font-style: italic;"><td>${f}</td><td>--:--</td><td>--:--</td><td>-</td><td>🚗 Desplazamiento</td><td>-</td><td>-</td><td>${resV.distancia.toFixed(2)}</td><td>-</td></tr>`;
                    }
                    html += `<tr style="border-bottom: 1px solid #eee;">
                        <td>${f}</td><td>${v.hora_turno || '--:--'}</td><td>${v.hora_pickup || '--:--'}</td><td><strong>${v.nombre_pasajero}</strong></td><td>${v.origen}</td><td>${v.destino}</td><td style="text-align:center;">${v.dist_n.toFixed(1)}</td><td style="text-align:center;">-</td><td style="text-align:center;">${v.h_fin}</td>
                    </tr>`;
                }
                
                let jText = "--:--";
                if (hIni && hFinU !== "--:--") {
                    const [h1, m1] = hIni.split(':').map(Number);
                    const [h2, m2] = hFinU.split(':').map(Number);
                    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                    if (diff < 0) diff += 1440;
                    jText = `${Math.floor(diff/60)}h ${diff%60}m`;
                }

                html += `</tbody></table>
                         <div style=\"background: #eef2ff; padding: 10px; display: flex; justify-content: space-between; font-weight: bold; border-bottom: 2px solid #6f42c1;\">
                            <span>📏 KM Ocupados: ${dia.kmOcupado.toFixed(1)} km</span>
                            <span>🚗 KM Vacío: ${dia.kmVacio.toFixed(1)} km</span>
                            <span>⏳ Jornada: ${jText}</span>
                         </div>`;
            }
            html += `</div>`;
        }
        document.getElementById('reporte-body-print').innerHTML = html;
        document.getElementById('reporte-modal').style.display = 'block';
        document.getElementById('modal-param-chofer').style.display = 'none';
    } catch (e) { console.error(e); alert("Error en reporte de chofer."); }
};

// --- 4. FUNCIÓN AUXILIAR MAPS ---
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