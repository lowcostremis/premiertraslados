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

const GEOCODING_API_KEY = process.env.GEOCODING_API_KEY;
if (!GEOCODING_API_KEY) {
    // Esta advertencia aparecerá durante el deploy, es normal.
    console.log("Advertencia: La variable de entorno GEOCODING_API_KEY no está configurada para el análisis local, pero se cargará desde Secret Manager en producción.");
}

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
// TRIGGERS DE FIRESTORE
// ===================================================================================
// CORRECCIÓN: Se añade { secrets: ["GEOCODING_API_KEY"] } para dar acceso al secreto
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
          await event.data.after.ref.update({origen_coords: coords});
        }
      } catch (error) { console.error("Error geocodificando origen:", error.response?.data?.error_message || error.message); }
    }
    if (afterData.destino && (!beforeData || afterData.destino !== beforeData.destino)) {
      try {
        const response = await client.geocode({ params: { address: `${afterData.destino}, Argentina`, key: GEOCODING_API_KEY } });
        if (response.data.results && response.data.results.length > 0) {
          const location = response.data.results[0].geometry.location;
          const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
          await event.data.after.ref.update({destino_coords: coords});
        }
      } catch (error) { console.error("Error geocodificando destino:", error.response?.data?.error_message || error.message); }
    }
    return null;
});

// ... El resto de tus funciones no cambian ...

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

exports.crearUsuario = onCall(async (request) => {
  const {email, password, nombre} = request.data;
  if (!email || !password || !nombre) { throw new HttpsError('invalid-argument', 'Faltan datos.'); }
  try {
    const userRecord = await admin.auth().createUser({ email: email, password: password, displayName: nombre });
    await admin.firestore().collection('users').doc(userRecord.uid).set({ nombre: nombre, email: email, rol: 'operador' });
    return {result: `Usuario ${nombre} creado con éxito.`};
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

        let query = admin.firestore().collection('historico')
                         .where('archivadoEn', '>=', fechaInicio)
                         .where('archivadoEn', '<=', fechaFin);

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
                viaje.estado || 'N/A',
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