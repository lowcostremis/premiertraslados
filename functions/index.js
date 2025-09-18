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
const db = admin.firestore();

// --- INICIALIZACIÓN DIFERIDA (LAZY INITIALIZATION) ---
let algoliaClient;
let mapsClient;
let pasajerosIndex, historicoIndex, reservasIndex;

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

// ===================================================================================
// FUNCIONES DE GESTIÓN DE CHOFERES
// ===================================================================================
exports.crearChoferConAcceso = onCall(async (request) => {
    const { dni, nombre, email, password, domicilio, telefono, movil_actual_id } = request.data;
    if (!dni || !nombre || !email || !password) {
        throw new HttpsError('invalid-argument', 'DNI, Nombre, Email y Contraseña son obligatorios.');
    }
    try {
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: nombre,
        });

        await db.collection('choferes').doc(dni).set({
            auth_uid: userRecord.uid,
            nombre: nombre,
            email: email,
            dni: dni,
            domicilio: domicilio || '',
            telefono: telefono || '',
            movil_actual_id: movil_actual_id || null,
            creadoEn: admin.firestore.FieldValue.serverTimestamp()
        });

        return { message: `Chofer ${nombre} creado con éxito.` };
    } catch (error) {
        console.error("Error al crear chofer:", error);
        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'El correo electrónico ya está en uso.');
        }
        throw new HttpsError('internal', 'Ocurrió un error interno al crear el chofer.');
    }
});

exports.resetearPasswordChofer = onCall(async (request) => {
    const { auth_uid, nuevaPassword } = request.data;
    if (!auth_uid || !nuevaPassword) {
        throw new HttpsError('invalid-argument', 'Faltan datos para resetear la contraseña.');
    }
    try {
        await admin.auth().updateUser(auth_uid, { password: nuevaPassword });
        return { message: "Contraseña actualizada con éxito." };
    } catch (error) {
        console.error("Error al resetear contraseña:", error);
        throw new HttpsError('internal', 'Ocurrió un error al actualizar la contraseña.');
    }
});

exports.borrarChofer = onCall(async (request) => {
    const { dni, auth_uid } = request.data;
    if (!dni || !auth_uid) {
        throw new HttpsError('invalid-argument', 'Faltan datos para borrar el chofer.');
    }
    try {
        await admin.auth().deleteUser(auth_uid);
        await db.collection('choferes').doc(dni).delete();
        return { message: "Chofer borrado exitosamente." };
    } catch (error) {
        console.error("Error al borrar chofer:", error);
        if (error.code === 'auth/user-not-found') {
            await db.collection('choferes').doc(dni).delete();
            return { message: "Chofer borrado de la base de datos (no en autenticación)." };
        }
        throw new HttpsError('internal', 'Ocurrió un error al borrar el chofer.');
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


// ===================================================================================
// NUEVA FUNCIÓN PARA FINALIZAR VIAJE DESDE LA APP
// ===================================================================================
exports.finalizarViajeDesdeApp = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'El usuario no está autenticado.');
    }

    const { reservaId } = request.data;
    if (!reservaId) {
        throw new HttpsError('invalid-argument', 'Falta el ID de la reserva.');
    }

    const reservaRef = db.collection('reservas').doc(reservaId);
    const historicoRef = db.collection('historico').doc(reservaId);

    try {
        // --- CORRECCIÓN INICIA ---
        // 1. Leer los datos necesarios ANTES de la transacción
        const doc = await reservaRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'No se encontró la reserva para archivar.');
        }

        const reservaData = doc.data();

        // 2. Asegurarse de que el chofer que llama es el asignado (seguridad extra)
        if (reservaData.chofer_asignado_id) {
            const choferDoc = await db.collection('choferes').doc(reservaData.chofer_asignado_id).get();
            if (choferDoc.exists && choferDoc.data().auth_uid !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'No tienes permiso para finalizar este viaje.');
            }
        }

        // 3. Obtener el nombre del cliente (si es posible) ANTES de la transacción
        if (reservaData.cliente) {
            const clienteDoc = await db.collection('clientes').doc(reservaData.cliente).get();
            if (clienteDoc.exists) {
                reservaData.clienteNombre = clienteDoc.data().nombre || 'Default';
            } else {
                reservaData.clienteNombre = 'Default';
            }
        }

        // 4. Ahora, ejecutar la transacción solo para escrituras
        await db.runTransaction(async (transaction) => {
            // Actualizar datos de la reserva para el histórico
            reservaData.estado = {
                principal: 'Finalizado',
                detalle: 'Traslado Concluido (desde App)',
                actualizado_en: admin.firestore.FieldValue.serverTimestamp()
            };
            reservaData.archivadoEn = admin.firestore.FieldValue.serverTimestamp();

            // Actualizar el documento del chofer
            if (reservaData.chofer_asignado_id) {
                const choferRef = db.collection('choferes').doc(reservaData.chofer_asignado_id);
                transaction.update(choferRef, {
                    viajes_activos: admin.firestore.FieldValue.arrayRemove(reservaId)
                });
            }

            // Mover la reserva
            transaction.set(historicoRef, reservaData);
            transaction.delete(reservaRef);
        });
        // --- CORRECCIÓN TERMINA ---

        return { message: 'Viaje finalizado y archivado con éxito.' };
    } catch (error) {
        console.error("Error al finalizar viaje desde app:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Ocurrió un error al procesar la solicitud.', error.message);
    }
});