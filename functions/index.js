const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const {Client} = require("@googlemaps/google-maps-services-js");
const functions = require("firebase-functions"); // Se necesita para leer la config

// Inicialización de servicios
admin.initializeApp();
const mapsClient = new Client({});

// La estructura completa del trigger es la misma
exports.geocodeAddress = onDocumentWritten("reservas/{reservaId}", async (event) => {
  // CAMBIO CRÍTICO: Movemos la lectura de la API Key aquí dentro.
  // Se lee solo cuando la función se ejecuta, no cuando arranca.
  const GEOCODING_API_KEY = functions.config().google.apikey;

  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  // Geocodificar Origen
  if (afterData.origen && (!beforeData || afterData.origen !== beforeData.origen)) {
    try {
      const response = await mapsClient.geocode({
        params: {
          address: `${afterData.origen}, Argentina`,
          key: GEOCODING_API_KEY,
        },
      });
      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
        await event.data.after.ref.update({origen_coords: coords});
      }
    } catch (error) {
      console.error("Error geocodificando origen:", error);
    }
  }

  // Geocodificar Destino
  if (afterData.destino && (!beforeData || afterData.destino !== beforeData.destino)) {
    try {
      const response = await mapsClient.geocode({
        params: {
          address: `${afterData.destino}, Argentina`,
          key: GEOCODING_API_KEY,
        },
      });
      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        const coords = new admin.firestore.GeoPoint(location.lat, location.lng);
        await event.data.after.ref.update({destino_coords: coords});
      }
    } catch (error) {
      console.error("Error geocodificando destino:", error);
    }
  }

  return null;
});