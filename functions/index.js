// const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onCall} = require("firebase-functions/v2/https");
// const {defineSecret} = require("firebase-functions/v2/params"); // Comentamos la línea problemática
const admin = require("firebase-admin");
// const {Client} = require("@googlemaps/google-maps-services-js");

admin.initializeApp();

// Dejamos solo una función simple para probar si el despliegue funciona.
exports.testFunction = onCall((request) => {
    console.log("La función de prueba se ejecutó!");
    return {message: "¡Hola desde Firebase!"};
});