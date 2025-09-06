// ===================================================================================
// IMPORTACIONES
// ===================================================================================
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { Client } = require("@googlemaps/google-maps-services-js");
const algoliasearch = require("algoliasearch");

// ===================================================================================
// INICIALIZACIÓN DE SERVICIOS
// ===================================================================================
admin.initializeApp();

// --- INICIALIZACIÓN DIFERIDA (LAZY INITIALIZATION) ---
let algoliaClient;
let mapsClient;
let pasajerosIndex, historicoIndex, reservasIndex;

// Asegúrate de configurar estas variables en tu entorno de Firebase
// firebase functions:config:set geocoding.key="TU_API_KEY_DE_GOOGLE_MAPS"
// firebase functions:config:set algolia.app_id="TU_APP_ID" algolia.api_key="TU_API_KEY"
const GEOCODING_API_KEY = process.env.GEOCODING_API_KEY;

function getMapsClient() {
    if (!mapsClient) {
        mapsClient = new Client({});
    }
    return mapsClient;
}

function getAlgoliaIndices() {
    if (!algoliaClient) {
        algoliaClient = algoliasearch(process.env.ALGOLIA_APP_ID, process.env.ALGOLIA_API_KEY);
        pasajerosIndex = algoliaClient.initIndex('pasajeros');
        historicoIndex = algoliaClient.initIndex('historico');
        reservasIndex = algoliaClient.initIndex('reservas');
    }
    return { pasajerosIndex, historicoIndex, reservasIndex };
}
// --- FIN DE LA INICIALIZACIÓN DIFERIDA ---

// ===================================================================================
// FUNCIONES PARA GESTIÓN DE CHOFERES (ESTADO Y UBICACIÓN)
// ===================================================================================

exports.actualizarEstadoViaje = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'El usuario debe estar autenticado.');
    }

    const { reservaId, nuevoEstado } = request.data;
    
    if (!reservaId || !nuevoEstado || typeof nuevoEstado !== 'object' || !nuevoEstado.principal) {
        throw new HttpsError('invalid-argument', 'Faltan datos o el formato del nuevo estado es incorrecto.');
    }

    const authUid = request.auth.uid;
    const db = admin.firestore();

    try {
        const choferQuery = await db.collection('choferes').where('auth_uid', '==', authUid).limit(1).get();
        if (choferQuery.empty) {
            throw new HttpsError('not-found', 'No se encontró el perfil del chofer.');
        }
        const choferId = choferQuery.docs[0].id;

        const reservaRef = db.collection('reservas').doc(reservaId);
        const reservaDoc = await reservaRef.get();

        if (!reservaDoc.exists || reservaDoc.data().chofer_asignado_id !== choferId) {
            throw new HttpsError('permission-denied', 'No tienes permiso para modificar este viaje.');
        }

        const estadosFinales = ['Finalizado', 'Negativo', 'Anulado'];
        if (estadosFinales.includes(nuevoEstado.principal)) {
            const reservaData = reservaDoc.data();
            
            reservaData.estado = nuevoEstado; 
            reservaData.archivadoEn = admin.firestore.FieldValue.serverTimestamp();

            if (reservaData.cliente) {
                const clienteDoc = await db.collection('clientes').doc(reservaData.cliente).get();
                if (clienteDoc.exists) {
                    reservaData.clienteNombre = clienteDoc.data().nombre;
                }
            }
            const historicoRef = db.collection('historico').doc(reservaId);
            await db.runTransaction(async (transaction) => {
                transaction.set(historicoRef, reservaData);
                transaction.delete(reservaRef);
            });
            return { status: 'success', message: 'Viaje finalizado y archivado.' };
        } else {
            await reservaRef.update({ estado: nuevoEstado });
            return { status: 'success', message: `El estado del viaje se actualizó a ${nuevoEstado.principal}.` };
        }
    } catch (error) {
        console.error("Error al actualizar estado del viaje:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Ocurrió un error al actualizar el viaje.');
    }
});

exports.actualizarUbicacionChofer = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'El usuario debe estar autenticado para actualizar su ubicación.');
    }
    const { latitud, longitud } = request.data;
    if (typeof latitud !== 'number' || typeof longitud !== 'number') {
        throw new HttpsError('invalid-argument', 'Las coordenadas (latitud y longitud) deben ser números.');
    }
    const authUid = request.auth.uid;
    try {
        const choferesRef = admin.firestore().collection('choferes');
        const q = choferesRef.where('auth_uid', '==', authUid).limit(1);
        const snapshot = await q.get();
        if (snapshot.empty) {
            throw new HttpsError('not-found', 'No se encontró un perfil de chofer para este usuario.');
        }
        const choferDoc = snapshot.docs[0];
        await choferDoc.ref.update({
            coordenadas: new admin.firestore.GeoPoint(latitud, longitud),
            ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp()
        });
        return { status: 'success', message: 'Ubicación actualizada correctamente.' };
    } catch (error) {
        console.error("Error al actualizar ubicación:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Ocurrió un error al guardar la ubicación.');
    }
});

// ===================================================================================
// TRIGGERS DE FIRESTORE (GEOCODIFICACIÓN Y ALGOLIA)
// ===================================================================================
exports.geocodeAddress = onDocumentWritten("reservas/{reservaId}", async (event) => {
    if (!event.data.after.exists) return null;
    const client = getMapsClient();
    const afterData = event.data.after.data();
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    if (afterData.origen && (!beforeData || afterData.origen !== beforeData.origen)) {
        try {
            const response = await client.geocode({ params: { address: `${afterData.origen}, Argentina`, key: GEOCODING_API_KEY } });
            if (response.data.results && response.data.results.length > 0) {
                const location = response.data.results[0].geometry.location;
                const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
                await event.data.after.ref.update({ origen_coords: coords });
            }
        } catch (error) { console.error("Error geocodificando origen:", error.response?.data?.error_message || error.message); }
    }
    if (afterData.destino && (!beforeData || afterData.destino !== beforeData.destino)) {
        try {
            const response = await client.geocode({ params: { address: `${afterData.destino}, Argentina`, key: GEOCODING_API_KEY } });
            if (response.data.results && response.data.results.length > 0) {
                const location = response.data.results[0].geometry.location;
                const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
                await event.data.after.ref.update({ destino_coords: coords });
            }
        } catch (error) { console.error("Error geocodificando destino:", error.response?.data?.error_message || error.message); }
    }
    return null;
});

exports.sincronizarConAlgolia = onDocumentWritten("pasajeros/{pasajeroId}", (event) => {
    const { pasajerosIndex } = getAlgoliaIndices();
    const pasajeroId = event.params.pasajeroId;
    if (!event.data.after.exists) { return pasajerosIndex.deleteObject(pasajeroId); }
    const record = { objectID: pasajeroId, ...event.data.after.data() };
    return pasajerosIndex.saveObject(record);
});

exports.sincronizarHistoricoConAlgolia = onDocumentWritten("historico/{viajeId}", (event) => {
    const { historicoIndex } = getAlgoliaIndices();
    const viajeId = event.params.viajeId;
    if (!event.data.after.exists) { return historicoIndex.deleteObject(viajeId); }
    const record = { objectID: viajeId, ...event.data.after.data() };
    return historicoIndex.saveObject(record);
});

exports.sincronizarReservasConAlgolia = onDocumentWritten("reservas/{reservaId}", (event) => {
    const { reservasIndex } = getAlgoliaIndices();
    const reservaId = event.params.reservaId;
    if (!event.data.after.exists) { return reservasIndex.deleteObject(reservaId); }
    const record = { objectID: reservaId, ...event.data.after.data() };
    return reservasIndex.saveObject(record);
});

// ===================================================================================
// FUNCIONES DE ADMINISTRACIÓN (USUARIOS, EXPORTACIÓN)
// ===================================================================================
exports.crearUsuario = onCall(async (request) => {
    const { email, password, nombre } = request.data;
    if (!email || !password || !nombre) { throw new HttpsError('invalid-argument', 'Faltan datos.'); }
    try {
        const userRecord = await admin.auth().createUser({ email, password, displayName: nombre });
        await admin.firestore().collection('users').doc(userRecord.uid).set({ nombre, email, rol: 'operador' });
        return { result: `Usuario ${nombre} creado con éxito.` };
    } catch (error) { console.error("Error:", error); throw new HttpsError('internal', 'Error al crear.'); }
});

exports.listUsers = onCall(async (request) => {
    try {
        const listUsersResult = await admin.auth().listUsers(1000);
        const users = listUsersResult.users.map((userRecord) => {
            const user = userRecord.toJSON();
            return { uid: user.uid, email: user.email, nombre: user.displayName };
        });
        return { users };
    } catch (error) { console.error("Error:", error); throw new HttpsError('internal', 'Error al listar.'); }
});

exports.exportarHistorico = onCall(async (request) => {
    try {
        const { fechaDesde, fechaHasta, clienteId } = request.data;
        if (!fechaDesde || !fechaHasta) {
            return { csvData: null, message: "Las fechas 'desde' y 'hasta' son obligatorias." };
        }
        const fechaInicio = admin.firestore.Timestamp.fromDate(new Date(fechaDesde + 'T00:00:00Z'));
        const fechaFin = admin.firestore.Timestamp.fromDate(new Date(fechaHasta + 'T23:59:59Z'));
        let query = admin.firestore().collection('historico').where('archivadoEn', '>=', fechaInicio).where('archivadoEn', '<=', fechaFin);
        if (clienteId) {
            query = query.where('cliente', '==', clienteId);
        }
        const snapshot = await query.get();
        if (snapshot.empty) {
            return { csvData: null, message: "No se encontraron registros para los filtros aplicados." };
        }
        let csvContent = "Fecha Turno,Hora Turno,Hora PickUp,Pasajero,Cliente,Origen,Destino,Estado,Siniestro,Autorizacion\n";
        snapshot.forEach(doc => {
            const viaje = doc.data();
            const escapeCSV = (field) => `"${(field || '').toString().replace(/"/g, '""')}"`;
            const fila = [
                viaje.fecha_turno || 'N/A', 
                viaje.hora_turno || 'N/A', 
                viaje.hora_pickup || 'N/A', 
                escapeCSV(viaje.nombre_pasajero), 
                escapeCSV(viaje.clienteNombre), 
                escapeCSV(viaje.origen), 
                escapeCSV(viaje.destino), 
                (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A', 
                viaje.siniestro || 'N/A', 
                viaje.autorizacion || 'N/A'
            ].join(',');
            csvContent += fila + "\n";
        });
        return { csvData: csvContent };
    } catch (error) {
        console.error("Error crítico al generar el histórico:", error);
        throw new HttpsError('internal', 'Error interno del servidor al generar el archivo.', error.message);
    }
});