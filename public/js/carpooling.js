// js/carpooling.js

/**
 * Calcula el horario de PickUp sugerido.
 * @param {string} horaTurno - Formato "HH:mm"
 * @param {string|number} duracionMins - Minutos de viaje (vienen de Google Maps)
 * @returns {string} - "HH:mm" sugerido
 */
export function calcularSugerenciaPickUp(horaTurno, duracionMins) {
    if (!horaTurno || !duracionMins) return "";

    const [hrs, mins] = horaTurno.split(':').map(Number);
    const duracion = parseInt(duracionMins);
    
    const fecha = new Date();
    fecha.setHours(hrs, mins);
    
    // Restamos duración del viaje + 5 minutos de buffer
    fecha.setMinutes(fecha.getMinutes() - (duracion + 5));

    const hSugerida = fecha.getHours().toString().padStart(2, '0');
    const mSugerida = fecha.getMinutes().toString().padStart(2, '0');
    
    return `${hSugerida}:${mSugerida}`;
}
/**
 * Busca viajes compatibles basándose en tiempo, destino y cercanía.
 */
export function buscarCompatibles(reservaBase, listaReservas) {
    const VENTANA_MINUTOS = 45; // Máxima diferencia de Hora Turno
    const RADIO_KM = 5; // Radio de búsqueda en kilómetros

    if (!reservaBase.hora_turno || !reservaBase.origen_coords) return [];

    return listaReservas
        .filter(r => {
            // Filtros básicos: no es la misma, debe estar pendiente y tener coords
            if (r.id === reservaBase.id) return false;
            if (r.estado?.principal !== 'Pendiente' && r.estado !== 'Pendiente') return false;
            if (!r.origen_coords || !r.hora_turno) return false;

            // 1. Filtro de Tiempo (Ventana de Turno)
            const diff = calcularDiferenciaMinutos(reservaBase.hora_turno, r.hora_turno);
            if (Math.abs(diff) > VENTANA_MINUTOS) return false;

            return true;
        })
        .map(r => {
            let score = 0;

            // 2. Prioridad: Mismo Destino (Exacto)
            if (r.destino.toLowerCase().trim() === reservaBase.destino.toLowerCase().trim()) {
                score += 100;
            }

            // 3. Prioridad: San Nicolás (Keywords)
            const esSN = (texto) => texto.toLowerCase().includes("san nicolas");
            if (esSN(r.origen) || esSN(r.destino)) score += 50;

            // 4. Score por Proximidad Geográfica
            // Usamos la distancia euclidiana aproximada:
            // $distancia \approx \sqrt{(\Delta lat)^2 + (\Delta lng)^2} \times 111$
            const dist = calcularDistancia(reservaBase.origen_coords, r.origen_coords);
            if (dist <= RADIO_KM) {
                score += (RADIO_KM - dist) * 10; // Más cerca, más puntaje
            } else if (score < 50) {
                // Si no es SN ni mismo destino y está lejos, lo descartamos
                return null;
            }

            return { ...r, matchScore: score, distanciaAprox: dist.toFixed(1) };
        })
        .filter(r => r !== null)
        .sort((a, b) => b.matchScore - a.matchScore);
}

function calcularDiferenciaMinutos(h1, h2) {
    const [hrs1, mins1] = h1.split(':').map(Number);
    const [hrs2, mins2] = h2.split(':').map(Number);
    return (hrs1 * 60 + mins1) - (hrs2 * 60 + mins2);
}

function calcularDistancia(c1, c2) {
    const lat1 = c1.latitude || c1.lat;
    const lng1 = c1.longitude || c1.lng;
    const lat2 = c2.latitude || c2.lat;
    const lng2 = c2.longitude || c2.lng;
    
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    // Aproximación simple para distancias cortas (1 grado ~ 111.32 km)
    return Math.sqrt(dLat * dLat + dLng * dLng) * 111.32;
}

/**
 * Calcula la holgura y devuelve el color del semáforo.
 * @param {string} horaTurno 
 * @param {string} horaLlegadaEstimada 
 * @returns {object} { color: string, texto: string, minutos: number }
 */
export function validarHolgura(horaTurno, horaLlegadaEstimada) {
    if (!horaTurno || !horaLlegadaEstimada) return { color: '#ccc', texto: 'N/A', minutos: 0 };

    const diff = calcularDiferenciaMinutos(horaTurno, horaLlegadaEstimada);
    
    // Si la diferencia es positiva, llega antes del turno.
    if (diff >= 20) {
        return { color: '#28a745', texto: 'Óptimo', minutos: diff }; // Verde
    } else if (diff >= 10) {
        return { color: '#ffc107', texto: 'Aceptable', minutos: diff }; // Amarillo
    } else {
        return { color: '#dc3545', texto: 'Crítico', minutos: diff }; // Rojo
    }
}