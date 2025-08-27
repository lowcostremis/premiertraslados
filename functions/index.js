// Importaciones 100% de la v2
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
// const {defineSecret} = require("firebase-functions/v2/params"); // <-- LÍNEA PROBLEMÁTICA ELIMINADA
const admin = require("firebase-admin");
const {Client} = require("@googlemaps/google-maps-services-js");

admin.initializeApp();
const mapsClient = new Client({});

// !! SOLUCIÓN TEMPORAL: API Key directamente en el código !!
const GEOCODING_API_KEY = "AIzaSyD8j5-iicaVEFqeBpCEdFbUXVhkDwsUkwA"; 

// --- FUNCIÓN DE GEOCODIFICACIÓN (v2) ---
exports.geocodeAddress = onDocumentWritten(
  {
    document: "reservas/{reservaId}",
    // secrets: [googleApiKey], // <-- LÍNEA ELIMINADA
  },
  async (event) => {
    // Si no hay datos después del evento (ej: un borrado), no hacemos nada.
    if (!event.data.after.exists) {
      return null;
    }
    const afterData = event.data.after.data();
    const beforeData = event.data.before.exists ? event.data.before.data() : null;

    // Geocodificar Origen
    if (afterData.origen && (!beforeData || afterData.origen !== beforeData.origen)) {
      try {
        const response = await mapsClient.geocode({
          params: { address: `${afterData.origen}, Argentina`, key: GEOCODING_API_KEY },
        });
        if (response.data.results && response.data.results.length > 0) {
          const location = response.data.results[0].geometry.location;
          const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
          await event.data.after.ref.update({origen_coords: coords});
        }
      } catch (error) {
        console.error("Error geocodificando origen:", error.message);
      }
    }

    // Geocodificar Destino
    if (afterData.destino && (!beforeData || afterData.destino !== beforeData.destino)) {
      try {
        const response = await mapsClient.geocode({
          params: { address: `${afterData.destino}, Argentina`, key: GEOCODING_API_KEY },
        });
        if (response.data.results && response.data.results.length > 0) {
          const location = response.data.results[0].geometry.location;
          const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
          await event.data.after.ref.update({destino_coords: coords});
        }
      } catch (error) {
        console.error("Error geocodificando destino:", error.message);
      }
    }
    return null;
  }
);

// --- FUNCIÓN PARA CREAR USUARIOS (v2) ---
exports.crearUsuario = onCall(async (request) => {
  const {email, password, nombre} = request.data;
  if (!email || !password || !nombre) {
    throw new HttpsError('invalid-argument', 'Faltan datos (email, password, nombre).');
  }
  try {
    const userRecord = await admin.auth().createUser({ email: email, password: password, displayName: nombre });
    await admin.firestore().collection('users').doc(userRecord.uid).set({ nombre: nombre, email: email, rol: 'operador' });
    return {result: `Usuario ${nombre} creado con éxito.`};
  } catch (error) {
    console.error("Error al crear usuario:", error);
    throw new HttpsError('internal', 'No se pudo crear el usuario.', error);
  }
});

// --- FUNCIÓN PARA LISTAR USUARIOS (v2) ---
exports.listUsers = onCall(async (request) => {
  try {
    const listUsersResult = await admin.auth().listUsers(1000);
    const users = listUsersResult.users.map((userRecord) => {
      const user = userRecord.toJSON();
      return { uid: user.uid, email: user.email, nombre: user.displayName };
    });
    return { users };
  } catch (error) {
    console.error("Error listando usuarios:", error);
    throw new HttpsError('internal', 'No se pudo listar los usuarios.', error);
  }
});