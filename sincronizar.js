// Importar las librerías necesarias
const admin = require('firebase-admin');
const algoliasearch = require('algoliasearch');

// --- CONFIGURACIÓN ---
// Clave de Firebase (debe estar en la misma carpeta que este script)
const serviceAccount = require('./firebase-service-account.json');

// Claves de Algolia (las mismas que usas en tus functions)
const ALGOLIA_APP_ID = "GOATTC1A5K";
const ALGOLIA_ADMIN_KEY = "980aa5608e1d597cbae8f94c96ed0487"; // Tu Admin API Key

// --- INICIALIZACIÓN ---
// Conectar a Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Conectar a Algolia
const algoliaClient = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY);

// --- FUNCIÓN PRINCIPAL ---
async function sincronizarColeccion(nombreColeccion, nombreIndice) {
    const indice = algoliaClient.initIndex(nombreIndice);
    console.log(`\nIniciando sincronización para la colección: ${nombreColeccion}...`);

    const snapshot = await db.collection(nombreColeccion).get();

    if (snapshot.empty) {
        console.log(`No se encontraron documentos en ${nombreColeccion}.`);
        return;
    }

    const records = snapshot.docs.map(doc => ({
        objectID: doc.id,
        ...doc.data()
    }));

    await indice.saveObjects(records);
    console.log(`✅ ¡Éxito! Se enviaron ${records.length} registros de '${nombreColeccion}' al índice '${nombreIndice}'.`);
}

// --- EJECUCIÓN ---
async function main() {
    try {
        // Llama a la función para cada colección que quieras sincronizar
        await sincronizarColeccion('pasajeros', 'pasajeros');
        await sincronizarColeccion('historico', 'historico');
        await sincronizarColeccion('reservas', 'reservas');
        await sincronizarColeccion('clientes', 'clientes');
        await sincronizarColeccion('choferes', 'choferes');
        console.log('\nTodas las colecciones han sido sincronizadas.');
    } catch (error) {
        console.error('\n❌ Ocurrió un error durante la sincronización:', error);
    }
}

main();