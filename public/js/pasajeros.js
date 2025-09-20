// js/pasajeros.js

import { db, pasajerosSearchIndex } from './firebase-config.js';

// Variables propias del módulo de pasajeros
let pasajerosBody, pasajerosBtnAnterior, pasajerosBtnSiguiente, pasajerosIndicadorPagina;
const pasajerosPorPagina = 100;
let pasajerosUltimoDocVisible = null;
let pasajerosHistorialDePaginas = [null];
let pasajerosPaginaActual = 0;

/**
 * Inicializa el módulo, obteniendo los elementos del DOM y configurando los listeners.
 */
export function initPasajeros() {
    pasajerosBody = document.getElementById('lista-pasajeros');
    pasajerosBtnAnterior = document.getElementById('pasajeros-btn-anterior');
    pasajerosBtnSiguiente = document.getElementById('pasajeros-btn-siguiente');
    pasajerosIndicadorPagina = document.getElementById('pasajeros-indicador-pagina');

    if (pasajerosBtnSiguiente) {
        pasajerosBtnSiguiente.addEventListener('click', () => {
            if (pasajerosPaginaActual === pasajerosHistorialDePaginas.length - 1) {
                pasajerosHistorialDePaginas.push(pasajerosUltimoDocVisible);
            }
            pasajerosPaginaActual++;
            cargarPasajeros();
        });
    }

    if (pasajerosBtnAnterior) {
        pasajerosBtnAnterior.addEventListener('click', () => {
            if (pasajerosPaginaActual > 0) {
                pasajerosPaginaActual--;
                cargarPasajeros();
            }
        });
    }

    const searchInput = document.getElementById('busqueda-pasajeros');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => buscarEnPasajeros(e.target.value));
    }
}

/**
 * Carga una página de datos de pasajeros desde Firestore.
 */
export async function cargarPasajeros() {
    if (!pasajerosBody) return;
    try {
        pasajerosBody.innerHTML = '<p>Cargando pasajeros...</p>';
        pasajerosBtnAnterior.disabled = true;
        pasajerosBtnSiguiente.disabled = true;

        let query = db.collection('pasajeros').orderBy(firebase.firestore.FieldPath.documentId());
        const cursor = pasajerosHistorialDePaginas[pasajerosPaginaActual];
        if (cursor) {
            query = query.startAfter(cursor);
        }
        query = query.limit(pasajerosPorPagina);

        const querySnapshot = await query.get();
        const documentos = querySnapshot.docs;

        if (documentos.length > 0) {
            pasajerosUltimoDocVisible = documentos[documentos.length - 1];
        }

        renderPasajerosTable(documentos);

        pasajerosBtnAnterior.disabled = (pasajerosPaginaActual === 0);
        pasajerosBtnSiguiente.disabled = (documentos.length < pasajerosPorPagina);
        if (pasajerosIndicadorPagina) {
            pasajerosIndicadorPagina.textContent = `Página ${pasajerosPaginaActual + 1}`;
        }
    } catch (error) {
        console.error("Error al cargar los pasajeros: ", error);
        pasajerosBody.innerHTML = '<p style="color:red;">Error al cargar los datos.</p>';
    }
}

/**
 * Realiza una búsqueda de pasajeros usando Algolia.
 * @param {string} texto - El término de búsqueda.
 */
export async function buscarEnPasajeros(texto) {
    const paginacionContainer = document.getElementById('paginacion-pasajeros');
    if (!texto) {
        if (paginacionContainer) paginacionContainer.style.display = 'flex';
        pasajerosPaginaActual = 0;
        pasajerosHistorialDePaginas = [null];
        cargarPasajeros();
        return;
    }
    try {
        if (paginacionContainer) paginacionContainer.style.display = 'none';
        pasajerosBody.innerHTML = '<p>Buscando...</p>';
        const { hits } = await pasajerosSearchIndex.search(texto);
        renderPasajerosTable(hits);
    } catch (error) {
        console.error("Error buscando pasajeros en Algolia: ", error);
        pasajerosBody.innerHTML = '<p style="color:red;">Error al realizar la búsqueda.</p>';
    }
}

// --- Funciones Internas ---

function renderPasajerosTable(documentos) {
    if (!pasajerosBody) return;
    if (documentos.length === 0) {
        pasajerosBody.innerHTML = '<p>No se encontraron pasajeros.</p>';
        return;
    }

    let tableHTML = `<div class="table-wrapper"><table><thead><tr><th>DNI</th><th>Nombre y Apellido</th><th>Teléfono</th><th>Domicilios</th><th>Acciones</th></tr></thead><tbody>`;
    documentos.forEach(doc => {
        const item = typeof doc.data === 'function' ? doc.data() : doc;
        const id = typeof doc.data === 'function' ? doc.id : doc.objectID;
        const domicilios = Array.isArray(item.domicilios) ? item.domicilios.join(', ') : (item.domicilios || '-');
        
        tableHTML += `<tr>
            <td>${id}</td>
            <td>${item.nombre_apellido || '-'}</td>
            <td>${item.telefono || '-'}</td>
            <td>${domicilios}</td>
            <td class="acciones">
               <button onclick="window.app.editItem('pasajeros', '${id}')">Editar</button>
               <button class="btn-danger" onclick="window.app.deleteItem('pasajeros', '${id}')">Borrar</button>
            </td>
        </tr>`;
    });
    tableHTML += `</tbody></table></div>`;
    pasajerosBody.innerHTML = tableHTML;
}