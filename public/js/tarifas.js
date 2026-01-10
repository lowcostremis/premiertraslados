// js/tarifas.js

/**
 * 1. CATEGORÍAS DE PEAJE (Valores Globales)
 * Centralizamos los precios aquí. Si aumenta un peaje, solo lo cambiás en esta lista.
 */
export const CAT_PEAJES = {
    "PEAJE_BSAS": 4500.00,
    "PEAJE_STA_FE": 1200.00,
    "PEAJE_CORDOBA": 3500.00,
    "PEAJE_ENTRE_RIOS": 1800.00,
    "SIN_PEAJE": 0
};

/**
 * 2. RUTAS MAESTRAS (Asociación)
 * Vinculamos tramos comunes con su categoría de peaje.
 * Usamos nombres de localidades para facilitar la búsqueda.
 */
export const RUTAS_MAESTRAS = [
    { origen: "Rosario", destino: "Ezeiza", categoria: "PEAJE_BSAS" },
    { origen: "Rosario", destino: "Buenos Aires", categoria: "PEAJE_BSAS" },
    { origen: "Ezeiza", destino: "Rosario", categoria: "PEAJE_BSAS" },
    { origen: "Rosario", destino: "Santa Fe", categoria: "PEAJE_STA_FE" },
    { origen: "Santa Fe", destino: "Rosario", categoria: "PEAJE_STA_FE" },
    { origen: "Rosario", destino: "Córdoba", categoria: "PEAJE_CORDOBA" }
];

/**
 * 3. FUNCIÓN AUXILIAR DE BÚSQUEDA
 * Busca si un viaje específico tiene peaje configurado.
 * @param {string} origen - Localidad de salida
 * @param {string} destino - Localidad de llegada
 * @returns {number} - Retorna el valor del peaje según la categoría
 */
export function obtenerValorPeaje(origen, destino) {
    const o = origen.toLowerCase();
    const d = destino.toLowerCase();

    // Buscamos coincidencia en la tabla de rutas maestras
    const rutaEncontrada = RUTAS_MAESTRAS.find(ruta => 
        (o.includes(ruta.origen.toLowerCase()) && d.includes(ruta.destino.toLowerCase())) ||
        (o.includes(ruta.destino.toLowerCase()) && d.includes(ruta.origen.toLowerCase()))
    );

    if (rutaEncontrada) {
        return CAT_PEAJES[rutaEncontrada.categoria] || 0;
    }

    return 0; // Si no está en la tabla, asumimos 0 o carga manual
}