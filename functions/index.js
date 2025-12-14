// ===================================================================================
// IMPORTACIONES
// ===================================================================================
const functions = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { Client } = require("@googlemaps/google-maps-services-js");
const algoliasearch = require("algoliasearch");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { google } = require("googleapis"); 
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===================================================================================
// INICIALIZACIÓN DE SERVICIOS
// ===================================================================================
admin.initializeApp();
const db = admin.firestore();

// --- INICIALIZACIÓN DIFERIDA (LAZY INITIALIZATION) ---
let algoliaClient;
let mapsClient;
let pasajerosIndex, historicoIndex, reservasIndex, choferesIndex;

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
        choferesIndex = algoliaClient.initIndex('choferes');
    }
    return { pasajerosIndex, historicoIndex, reservasIndex, choferesIndex };
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

exports.sincronizarChoferesConAlgolia = onDocumentWritten("choferes/{choferId}", async (event) => {
     const { choferesIndex } = getAlgoliaIndices();
    const choferId = event.params.choferId;

    if (!event.data.after.exists) {
        return choferesIndex.deleteObject(choferId);
    }

    const choferData = event.data.after.data();

    if (choferData.movil_actual_id) {
        try {
            const movilDoc = await db.collection('moviles').doc(choferData.movil_actual_id).get();
            if (movilDoc.exists) {
                choferData.numero_movil = movilDoc.data().numero;
            }
        } catch (error) {
            console.error(`Error al buscar móvil ${choferData.movil_actual_id} para el chofer ${choferId}:`, error);
        }
    }

    const record = { objectID: choferId, ...choferData };
    return choferesIndex.saveObject(record);
});

exports.agregarNombreClienteAReserva = onDocumentWritten("reservas/{reservaId}", async (event) => {
    if (!event.data.after.exists) {
        return null;
    }
    const datosReserva = event.data.after.data();
    if (datosReserva.cliente_nombre) {
        return null;
    }
    const clienteId = datosReserva.cliente;
    if (!clienteId) {
        return null;
    }
    try {
        const clienteSnap = await db.collection("clientes").doc(clienteId).get();
        let nombreCliente = "N/A";
        if (clienteSnap.exists) {
            nombreCliente = clienteSnap.data().nombre || "N/A";
        }
        return event.data.after.ref.update({
            cliente_nombre: nombreCliente,
        });
    } catch (error) {
        console.error("Error al buscar o actualizar el cliente:", error);
        return null;
    }
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
        const usersSnapshot = await db.collection('users').get();
        if (usersSnapshot.empty) {
            return { users: [] };
        }
        const users = usersSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                uid: doc.id,
                email: data.email || 'N/A',
                nombre: data.nombre || 'N/A'
            };
        });
        return { users };
    } catch (error) {
        console.error("Error al listar usuarios:", error);
        throw new HttpsError('internal', 'Ocurrió un error al listar los usuarios.');
    }
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
            return { csvData: null, message: "No se encontraron registros." };
        }
        
        // 1. MODIFICACIÓN: Añadir BOM para UTF-8 (acentos)
        let csvContent = "\uFEFF"; 
        
        // 2. MODIFICACIÓN: Usar punto y coma (;) en encabezados (ya incluye "Chofer")
        csvContent += "Fecha Turno;Hora Turno;Hora PickUp;Pasajero;Cliente;Chofer;Origen;Destino;Estado;Siniestro;Autorizacion\n";
        
        snapshot.forEach(doc => {
            const viaje = doc.data();
            const escapeCSV = (field) => `"${(field || '').toString().replace(/"/g, '""')}"`;
            
            // 3. MODIFICACIÓN: Usar punto y coma (;) para unir los datos
            const fila = [
                viaje.fecha_turno || 'N/A',
                viaje.hora_turno || 'N/A',
                viaje.hora_pickup || 'N/A',
                escapeCSV(viaje.nombre_pasajero),
                escapeCSV(viaje.clienteNombre),
                escapeCSV(viaje.choferNombre), // <-- Este campo ya estaba
                escapeCSV(viaje.origen),
                escapeCSV(viaje.destino),
                (typeof viaje.estado === 'object' ? viaje.estado.principal : viaje.estado) || 'N/A',
                viaje.siniestro || 'N/A',
                viaje.autorizacion || 'N/A'
            ].join(';'); // <-- CAMBIO CLAVE
            csvContent += fila + "\n";
        });
        return { csvData: csvContent };
    } catch (error) {
        console.error("Error al generar el histórico:", error);
        throw new HttpsError('internal', 'Error al generar el archivo.', error.message);
    }
});

// ===================================================================================
// FUNCIONES LLAMADAS DESDE LA APP DEL CHOFER
// ===================================================================================

exports.finalizarViajeDesdeApp = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'No autenticado.');
    }
    const { reservaId } = request.data;
    if (!reservaId) {
        throw new HttpsError('invalid-argument', 'Falta ID de reserva.');
    }
    const reservaRef = db.collection('reservas').doc(reservaId);
    const historicoRef = db.collection('historico').doc(reservaId);
    try {
        const doc = await reservaRef.get();
        if (!doc.exists) {
            throw new HttpsError('not-found', 'No se encontró la reserva.');
        }
        const reservaData = doc.data();
        if (reservaData.chofer_asignado_id) {
            const choferDoc = await db.collection('choferes').doc(reservaData.chofer_asignado_id).get();
            if (choferDoc.exists && choferDoc.data().auth_uid !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'No tienes permiso.');
            }
        }
        if (reservaData.cliente) {
            const clienteDoc = await db.collection('clientes').doc(reservaData.cliente).get();
            reservaData.clienteNombre = clienteDoc.exists ? (clienteDoc.data().nombre || 'Default') : 'Default';
        }
        if (reservaData.chofer_asignado_id) {
            const choferDoc = await db.collection('choferes').doc(reservaData.chofer_asignado_id).get();
            if (choferDoc.exists) {
                reservaData.choferNombre = choferDoc.data().nombre || 'N/A';
            }
        }
        
        await db.runTransaction(async (transaction) => {
            reservaData.estado = {
                principal: 'Finalizado',
                detalle: 'Traslado Concluido (desde App)',
                actualizado_en: admin.firestore.FieldValue.serverTimestamp()
            };
            reservaData.archivadoEn = admin.firestore.FieldValue.serverTimestamp();
            if (reservaData.chofer_asignado_id) {
                const choferRef = db.collection('choferes').doc(reservaData.chofer_asignado_id);
                transaction.update(choferRef, {
                    viajes_activos: admin.firestore.FieldValue.arrayRemove(reservaId)
                });
            }
            transaction.set(historicoRef, reservaData);
            transaction.delete(reservaRef);
        });
        return { message: 'Viaje finalizado.' };
    } catch (error) {
        console.error("Error al finalizar viaje:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Error al procesar.', error.message);
    }
});

exports.gestionarRechazoDesdeApp = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'No autenticado.');
    }
    const { reservaId, esNegativo } = request.data;
    if (!reservaId) {
        throw new HttpsError('invalid-argument', 'Falta ID de reserva.');
    }
    const reservaRef = db.collection('reservas').doc(reservaId);
    try {
        await db.runTransaction(async (transaction) => {
            const reservaDoc = await transaction.get(reservaRef);
            if (!reservaDoc.exists) {
                return;
            }
            const reservaData = reservaDoc.data();
            const choferAsignadoId = reservaData.chofer_asignado_id;

            if (choferAsignadoId) {
                const choferDoc = await db.collection('choferes').doc(choferAsignadoId).get();
                if (!choferDoc.exists || choferDoc.data().auth_uid !== request.auth.uid) {
                    throw new HttpsError('permission-denied', 'No tienes permiso.');
                }
                
                const choferDocData = choferDoc.data();
                const nombreChofer = choferDocData.nombre || 'Desconocido';
                const nuevoDetalle = esNegativo 
                    ? `Traslado negativo (Chofer: ${nombreChofer})` 
                    : `Rechazado por ${nombreChofer}`;

                transaction.update(reservaRef, {
                    estado: {
                        principal: 'En Curso',
                        detalle: nuevoDetalle,
                        actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
                    },
                    chofer_asignado_id: admin.firestore.FieldValue.delete(),
                    movil_asignado_id: admin.firestore.FieldValue.delete(),
                });
            } else {
                 throw new HttpsError('failed-precondition', 'La reserva ya no tiene chofer.');
            }
            const choferRef = db.collection('choferes').doc(choferAsignadoId);
            transaction.update(choferRef, {
                viajes_activos: admin.firestore.FieldValue.arrayRemove(reservaId)
            });
        });
        return { message: 'Reserva actualizada.' };
    } catch (error) {
        console.error("Error al gestionar rechazo:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Error al procesar.', error.message);
    }
});

// ===================================================================================
// TRIGGERS DE NOTIFICACIONES
// ===================================================================================

/**
 * Trigger que se activa cuando una reserva existente es modificada.
 * Maneja los escenarios de: nueva asignación, des-asignación y edición de detalles.
 */
exports.gestionarNotificacionesDeReservas = functions.firestore
    .document("reservas/{reservaId}")
    .onUpdate(async (change, context) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const reservaId = context.params.reservaId;

        let choferId;
        let notificationTitle = '';
        let notificationBody = '';

        // Escenario 1: NUEVA ASIGNACIÓN
        if (!beforeData.chofer_asignado_id && afterData.chofer_asignado_id) {
            choferId = afterData.chofer_asignado_id;
            notificationTitle = '¡Nuevo Viaje Asignado!';
            notificationBody = `Origen: ${afterData.origen || 'N/A'}. Tienes una nueva reserva pendiente.`;
        }
        // Escenario 2: DES-ASIGNACIÓN (se le quita al chofer)
        else if (beforeData.chofer_asignado_id && !afterData.chofer_asignado_id) {
            choferId = beforeData.chofer_asignado_id; // El chofer que fue quitado
            notificationTitle = 'Viaje Reasignado';
            notificationBody = `El viaje desde ${afterData.origen || 'origen'} ya no está en tu lista.`;
        }
        // Escenario 3: EDICIÓN (el viaje ya estaba asignado y cambia un dato clave)
        else if (afterData.chofer_asignado_id && (
                 afterData.origen !== beforeData.origen ||
                 afterData.destino !== beforeData.destino ||
                 afterData.fecha_turno !== beforeData.fecha_turno ||
                 afterData.hora_turno !== beforeData.hora_turno ||
                 afterData.hora_pickup !== beforeData.hora_pickup)) {
            choferId = afterData.chofer_asignado_id;
            notificationTitle = 'Reserva Actualizada';
            notificationBody = `El viaje a ${afterData.origen || 'origen'} ha sido modificado. Revisa los detalles.`;
        }

        // Si no hay nada que notificar en esta actualización, salimos.
        if (!notificationTitle || !choferId) {
            return null;
        }

        // --- Lógica común para enviar la notificación ---
        const choferDoc = await db.collection('choferes').doc(choferId).get();
        if (!choferDoc.exists || !choferDoc.data().fcm_token) {
            console.log(`El chofer ${choferId} no tiene token, no se puede notificar.`);
            return null;
        }

        const fcmToken = choferDoc.data().fcm_token;
        const message = {
            notification: { title: notificationTitle, body: notificationBody },
            android: {
                 notification: {
                   channel_id: 'high_importance_channel'
                }
           },
            apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
            token: fcmToken,
            data: { // ▼▼▼ ESTE ES EL CAMBIO CLAVE ▼▼▼
        // Replicamos la información aquí para que nuestro código la procese
                "title": notificationTitle,
                "body": notificationBody,
                "reservaId": reservaId, // El ID ya estaba, lo mantenemos
                "click_action": "FLUTTER_NOTIFICATION_CLICK",
        // Podemos añadir un tipo para saber qué hacer
                "tipo": "actualizacion_reserva"
            },
        };

        try {
            await admin.messaging().send(message);
            console.log(`Notificación de tipo "${notificationTitle}" enviada con éxito al chofer ${choferId}`);
        } catch (error) {
            console.error(`Error al enviar notificación al chofer ${choferId}:`, error);
        }
        return null;
    });


exports.notificarCancelacionDeReserva = functions.firestore
     .document('reservas/{reservaId}')
    .onDelete(async (snap, context) => {
        const reservaId = context.params.reservaId;
        
        // =======================================================================
        // ▼▼▼ INICIO DE LA CORRECCIÓN ▼▼▼
        // =======================================================================
        // 1. Antes de hacer nada, verificamos si el viaje fue archivado en 'historico'.
        const historicoDocRef = db.collection('historico').doc(reservaId);
        const historicoDoc = await historicoDocRef.get();

        // 2. Si el documento existe en 'historico', significa que se finalizó y no se canceló.
        //    Por lo tanto, salimos de la función para no enviar la notificación.
        if (historicoDoc.exists) {
            console.log(`El viaje ${reservaId} fue finalizado y archivado. No se enviará notificación de cancelación.`);
            return null; 
        }
        // =======================================================================
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
        // =======================================================================

        // Si el código llega hasta aquí, significa que fue una cancelación real.
        console.log(`El viaje ${reservaId} fue realmente cancelado. Preparando notificación.`);

        const reservaBorrada = snap.data();
        const choferId = reservaBorrada.chofer_asignado_id;

        if (!choferId) { return null; }

        const choferDoc = await db.collection('choferes').doc(choferId).get();
        if (!choferDoc.exists || !choferDoc.data().fcm_token) {
            console.log(`Chofer ${choferId} sin token para notificar cancelación.`);
            return null;
        }

        const notificationTitle = 'Viaje Cancelado';
        const notificationBody = `El viaje desde ${reservaBorrada.origen || 'origen'} ha sido cancelado por el operador.`;

        const fcmToken = choferDoc.data().fcm_token;
        const message = {
            notification: {
                title: notificationTitle,
                body: notificationBody
            },
            android: {
              notification: {
                channel_id: 'high_importance_channel'
              }
            },
            apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
            token: fcmToken,
            data: {
                "title": notificationTitle,
                "body": notificationBody,
                "reservaId": context.params.reservaId,
                "click_action": 'FLUTTER_NOTIFICATION_CLICK',
                "tipo": "cancelacion_reserva"
            },
        };

        try {
            await admin.messaging().send(message);
            console.log(`Notificación de cancelación enviada con éxito al chofer ${choferId}`);
        } catch (error) {
            console.error(`Error al enviar notificación de cancelación al chofer ${choferId}:`, error);
        }
        return null;
    });

    // ===================================================================================
// IMPORTACIÓN DE IA (Asegúrate de haber instalado: npm install @google/generative-ai)
// ===================================================================================



exports.interpretarExcelIA = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes estar logueado.');
    }

    const { datosCrudos, fechaSeleccionada } = request.data; 

    if (!datosCrudos || datosCrudos.length === 0) {
        return { reservas: [] };
    }

    try {
        
    // --- CORRECCIÓN: USAR LA CLAVE DEL .ENV UNIFICADA ---
    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        throw new HttpsError('internal', "Falta API Key Gemini (GEMINI_API_KEY) en .env");
    }
         const genAI = new GoogleGenerativeAI(apiKey);

         const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

         const prompt = `
            Actúa como un operador de logística experto en Rosario, Argentina.
            Analiza esta lista de viajes y conviértela en JSON limpio para Firebase.
            
            Fecha de referencia (Default): ${fechaSeleccionada} (YYYY-MM-DD).
            
            Reglas de interpretación CRÍTICAS:
            
            1. **FECHA DEL VIAJE (Prioridad):**
               - Si la celda "FECHA" tiene datos (ej: "10-dic", "10/12"), ÚSALA. Usa el año de la "Fecha de referencia" (${fechaSeleccionada}) para completarla.
               - Si está vacía, usa la "Fecha de referencia".
               - Salida: YYYY-MM-DD.

            2. **Hora:** Columna "HORARIO". Si vacía, usar "TURNO". Formato HH:mm.
            3. **Pasajero:** Columna "APELLIDO Y NOMBRE".
            4. **Teléfono:** Columna "N° DE TELEFONO".
            5. **Origen:** Columna "ORIGEN". Si es "VGG" -> "Villa Gobernador Gálvez". Si es calle sola -> agregar ", Rosario, Santa Fe".
            6. **Destino:** Columna "DESTINO". Misma lógica que Origen.

            7. **Cliente (TRADUCCIÓN):**
               - "SPA" -> "PREVENCION ART"
               - "SPI" -> "La Segunda ART"
               - "RDT" -> "RED DE TRASLADOS"
               - "INTEGRO" -> "INTEGRO ART"
               - "ASOCIART" -> "ASOCIART"
               - "LLT" -> "LLT"
               - Otro -> Valor original.

            8. **Siniestro:** Columna "SINIESTRO".
            9. **Autorización:** Columna "AUTORIZACIÓN".
            
            10. **Observaciones:** Mapea directamente el contenido de la columna "OBSERVACIONES".

            11. **VIAJE EXCLUSIVO (Detección):**
               - Revisa TODAS las columnas (especialmente Observaciones o Tipo de Viaje).
               - Si encuentras palabras como "Exclusivo", "Movil Completo", "Exc", devuelve el campo "es_exclusivo": true.
               - De lo contrario, "es_exclusivo": false.

            IMPORTANTE: Devuelve SOLO un array JSON válido bajo la clave "reservas".
            Claves JSON: fecha_turno, hora_turno, nombre_pasajero, telefono_pasajero, origen, destino, cliente, siniestro, autorizacion, observaciones, es_exclusivo.

            Datos a procesar: ${JSON.stringify(datosCrudos)}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResponse = JSON.parse(text);
        const reservasFinales = Array.isArray(jsonResponse) ? jsonResponse : jsonResponse.reservas;

        return { reservas: reservasFinales || [] };

    } catch (error) {
        console.error("Error IA:", error);
        throw new HttpsError('internal', 'Error al procesar con IA: ' + error.message);
    }
});

// ===================================================================================
// INTEGRACIÓN GMAIL + IA
// ===================================================================================

exports.procesarReservasGmail = onCall(async (request) => {
    // 1. Verificar autenticación
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes estar logueado como operador.');
    }
    
    // --- VALIDACIÓN (Solo process.env) ---
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        throw new HttpsError('internal', 'Faltan credenciales de Gmail en el archivo .env');
    }

    // 2. Inicializar Cliente OAuth
    const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    );
    
    oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    // 3. Inicializar Servicios
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    if (!process.env.GOOGLE_GEMINI_KEY) {
         throw new HttpsError('internal', "Falta la API Key de Gemini en el archivo .env");
    }
    
  
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_KEY);
    
    // MODELO: Asegúrate de usar 'gemini-2.0-flash' o 'gemini-1.5-flash'
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        // 2. Buscar correos NO LEÍDOS
        const res = await gmail.users.messages.list({
            userId: 'me', 
            q: 'is:unread subject:(Reserva OR Viaje OR Pedido OR RDT OR Autorizaciones)' 
        });

        const messages = res.data.messages;
        if (!messages || messages.length === 0) {
            return { message: "No hay correos nuevos de reservas que coincidan con la búsqueda." };
        }

        
        let procesados = 0;
        let batch = db.batch();
        let contadorBatch = 0;
        const batchLimit = 400;

        // 3. Iterar sobre los correos encontrados
        for (const message of messages) {
            const msgData = await gmail.users.messages.get({
                userId: 'me',
                id: message.id
            });

            const snippet = msgData.data.snippet || ''; 
            
            if (!snippet.trim()) continue;

            // 4. Procesar con Gemini
            const prompt = `
                Actúa como operador de logística. Extrae los datos de esta reserva para un traslado en Rosario, Argentina:
                Texto del correo: "${snippet}"
                Fecha Referencia: ${new Date().toISOString().split('T')[0]}
                
                Reglas:
                - Devuelve un JSON con: fecha_turno, hora_turno, nombre_pasajero, telefono_pasajero, origen, destino, cliente, observaciones, siniestro, autorizacion.
                - Si falta un dato, pon la cadena vacía ("") o intenta deducirlo.
                - Cliente: Si menciona una empresa, ponla. Si no, "PARTICULARES".
                - Formato JSON puro sin markdown (ej: sin \`\`\`json).
            `;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            let reservaData;
            try {
                reservaData = JSON.parse(responseText);
                if (Array.isArray(reservaData)) reservaData = reservaData[0];
            } catch (e) {
                console.error("Error parseando JSON de IA para mail " + message.id, e);
                continue; 
            }

            // 5. Preparar guardado
            const docRef = db.collection('reservas').doc();
            batch.set(docRef, {
                ...reservaData,
                origen_dato: 'Gmail',
                email_id: message.id,
                estado: { 
                    principal: 'Revision', 
                    detalle: 'Importado desde Gmail para revisión', 
                    actualizado_en: new Date() // <--- ✅ SOLUCIÓN: Fecha simple
                },
                creadoEn: new Date() // <--- ✅ SOLUCIÓN: Fecha simple
            });

            // 6. Marcar correo como LEÍDO
            await gmail.users.messages.modify({
                userId: 'me',
                id: message.id,
                requestBody: { removeLabelIds: ['UNREAD'] }
            });

            procesados++;
            contadorBatch++;
            
            if (contadorBatch >= batchLimit) {
                await batch.commit();
                batch = db.batch();
                contadorBatch = 0;
            }
        }

        if (contadorBatch > 0) await batch.commit();

        return { message: `Procesados ${procesados} correos correctamente. Se guardaron en la pestaña de revisión.` };

    } catch (error) {
        console.error("Error procesando Gmail:", error);
        throw new HttpsError('internal', 'Error al leer y procesar Gmail: ' + error.message);
    }
});

exports.interpretarPDFIA = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Logueate primero.');

    const { pdfBase64, fechaSeleccionada } = request.data;
    if (!pdfBase64) throw new HttpsError('invalid-argument', 'Falta el archivo PDF.');

    try {
        // ✅ CORRECCIÓN: Usamos la misma clave unificada que en Excel y Gmail
        const apiKey = process.env.GEMINI_API_KEY; 

        if (!apiKey) {
            throw new HttpsError('internal', "Falta API Key Gemini (GEMINI_API_KEY) en .env");
        }
        
        const genAI = new GoogleGenerativeAI(apiKey);
        // Usamos Flash porque es rápido y multimodal (lee documentos)
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // ✅ MODELO NUEVO

        const prompt = `
            Actúa como experto en logística. Analiza este documento PDF adjunto.
            Contiene una lista de solicitudes de traslados/viajes.
            
            Fecha Ref: ${fechaSeleccionada}.
            
            Extrae CADA viaje y devuélvelo en JSON.
            Campos requeridos: fecha_turno (YYYY-MM-DD), hora_turno (HH:MM), nombre_pasajero, telefono_pasajero, origen, destino, cliente, siniestro, autorizacion, observaciones, es_exclusivo (boolean).

            Reglas:
            1. Si la fecha en el doc es "12/05" usa el año de la Fecha Ref.
            2. Origen/Destino: Si dice solo calle, agrega ", Rosario". Si dice "VGG", es "Villa Gobernador Gálvez".
            3. Si detectas palabras como "Ida y vuelta", genera dos objetos JSON separados si es posible, o ponlo en observaciones.
            4. Cliente: Deduce el nombre de la empresa por el encabezado o logo si es texto.
            
            Salida: Un array JSON puro bajo la clave "reservas". Ejemplo: {"reservas": [...]}.
            Sin markdown.
        `;

        // Aquí está el truco: Enviamos Texto + Datos del PDF
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: pdfBase64,
                    mimeType: "application/pdf",
                },
            },
        ]);

        const responseText = result.response.text();
        // Limpieza de JSON habitual
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResponse = JSON.parse(jsonString);

        return { reservas: jsonResponse.reservas || jsonResponse };

    } catch (error) {
        console.error("Error interpretando PDF:", error);
        throw new HttpsError('internal', 'Error IA PDF: ' + error.message);
    }
});

// ===================================================================================
// CRON JOB: CHEQUEO AUTOMÁTICO DE GMAIL (CADA 15 MINUTOS)
// ===================================================================================

exports.chequearCorreosCron = onSchedule("every 15 minutes", async (event) => {
    console.log("⏰ Iniciando chequeo automático de Gmail...");

    // 1. Configuración de Credenciales (Igual que la función manual)
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
        console.error("❌ Faltan credenciales de Gmail en .env");
        return;
    }

    const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    );
    
    oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // 2. Configuración de IA
    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) {
        console.error("❌ Falta API Key Gemini");
        return;
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        // 3. Buscar correos NO LEÍDOS
        // Usamos 'me' porque el cliente OAuth ya está autenticado con tu cuenta
        const res = await gmail.users.messages.list({
            userId: 'me', 
            q: 'is:unread subject:(Reserva OR Viaje OR Pedido OR RDT OR Autorizaciones)' 
        });

        const messages = res.data.messages;
        if (!messages || messages.length === 0) {
            console.log("✅ Chequeo finalizado: No hay correos nuevos.");
            return;
        }

        console.log(`📬 Se encontraron ${messages.length} correos nuevos. Procesando...`);

        let procesados = 0;
        let batch = admin.firestore().batch(); // Usamos admin.firestore() directo aquí
        let contadorBatch = 0;
        const batchLimit = 400;

        for (const message of messages) {
            // Leer contenido del correo
            const msgData = await gmail.users.messages.get({ userId: 'me', id: message.id });
            const snippet = msgData.data.snippet || ''; 
            
            if (!snippet.trim()) continue;

            // Procesar con Gemini
            const prompt = `
                Actúa como operador de logística. Extrae los datos de esta reserva:
                Texto: "${snippet}"
                Fecha Ref: ${new Date().toISOString().split('T')[0]}
                Devuelve JSON puro con: fecha_turno, hora_turno, nombre_pasajero, telefono_pasajero, origen, destino, cliente, observaciones, siniestro, autorizacion.
                Si falta dato usa "". Cliente default "PARTICULARES".
            `;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            let reservaData;
            try {
                reservaData = JSON.parse(responseText);
                if (Array.isArray(reservaData)) reservaData = reservaData[0];
            } catch (e) {
                console.error(`Error JSON mail ${message.id}`, e);
                continue; 
            }

            // Guardar en Firestore
            const docRef = db.collection('reservas').doc();
            batch.set(docRef, {
                ...reservaData,
                origen_dato: 'Gmail Automático', // Marcamos que vino del Cron
                email_id: message.id,
                estado: { 
                    principal: 'Revision', 
                    detalle: 'Importado automáticamente (Cron)', 
                    actualizado_en: new Date()
                },
                creadoEn: new Date()
            });

            // Marcar como LEÍDO para que no se procese de nuevo en 15 min
            await gmail.users.messages.modify({
                userId: 'me',
                id: message.id,
                requestBody: { removeLabelIds: ['UNREAD'] }
            });

            procesados++;
            contadorBatch++;
            
            if (contadorBatch >= batchLimit) {
                await batch.commit();
                batch = admin.firestore().batch();
                contadorBatch = 0;
            }
        }

        if (contadorBatch > 0) await batch.commit();

        console.log(`🚀 Éxito: Se procesaron ${procesados} reservas automáticamente.`);

    } catch (error) {
        console.error("🔥 Error crítico en Cron Gmail:", error);
    }
});


