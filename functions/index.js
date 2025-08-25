// SDK de Firebase para Cloud Functions (v2) y Firebase Admin
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onUserCreate } = require("firebase-functions/v2/auth");
const admin = require("firebase-admin");

const axios = require("axios");
const { Client } = require("@googlemaps/google-maps-services-js");
const { GeoPoint } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

// --- CLAVES DE API ACTUALIZADAS ---
const apiKey = "AIzaSyD8j5-iicaVEFqeBpCEdFbUXVhkDwsUkwA"; // Clave para Geocoding API
const botToken = "8281321788:AAEQxw7zojI06HpSuh45TTqGC2j2buGDJJs";
const mapsClient = new Client({});

// ===========================================================================
// TRIGGERS DE FIRESTORE (Sintaxis v2)
// ===========================================================================

exports.setTripCounterOnReserveCreate = onDocumentCreated("reservas/{reservaId}", async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("No data associated with the event");
        return;
    }
    const contadorRef = db.collection('config').doc('reserva_counter');
    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(contadorRef);
            const count = (doc.exists && doc.data().count) ? doc.data().count + 1 : 1;
            const nuevoNumeroContador = String(count).padStart(6, '0');

            transaction.set(contadorRef, { count }, { merge: true });
            transaction.update(snap.ref, { contador_viaje: nuevoNumeroContador });
        });
    } catch (error) {
        console.error("Error en la transacción del contador de viajes:", error);
    }
});

exports.geocodeAddressOnReserveWrite = onDocumentWritten("reservas/{reservaId}", async (event) => {
    const data = event.data.after.data();
    const oldData = event.data.before ? event.data.before.data() : {};

    if (!data) return;

    const updatePayload = {};

    const originAddressChanged = data.direccion_origen && data.direccion_origen !== oldData.direccion_origen;
    if (originAddressChanged || (data.direccion_origen && !data.origen_coords)) {
        try {
            const response = await mapsClient.geocode({
                params: {
                    address: data.direccion_origen,
                    components: { country: 'AR' },
                    key: apiKey
                }
            });
            if (response.data.results && response.data.results.length > 0) {
                const location = response.data.results[0].geometry.location;
                updatePayload.origen_coords = new GeoPoint(location.lat, location.lng);
            }
        } catch (error) {
            console.error("Error de Geocodificación (Origen):", error.response ? error.response.data : error.message);
        }
    }

    const destinationAddressChanged = data.direccion_destino !== oldData.direccion_destino;
    if (data.direccion_destino && (destinationAddressChanged || !data.destino_coords)) {
        try {
            const response = await mapsClient.geocode({
                params: {
                    address: data.direccion_destino,
                    components: { country: 'AR' },
                    key: apiKey
                }
            });
            if (response.data.results && response.data.results.length > 0) {
                const location = response.data.results[0].geometry.location;
                updatePayload.destino_coords = new GeoPoint(location.lat, location.lng);
            }
        } catch (error) {
            console.error("Error de Geocodificación (Destino):", error.response ? error.response.data : error.message);
        }
    } else if (destinationAddressChanged && !data.direccion_destino) {
        updatePayload.destino_coords = admin.firestore.FieldValue.delete();
    }

    if (Object.keys(updatePayload).length > 0) {
        return event.data.after.ref.update(updatePayload);
    }
    return;
});

exports.sendTelegramNotificationOnAssign = onDocumentUpdated("reservas/{reservaId}", async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();

    if (oldData && !oldData.chofer_asignado_id && newData.chofer_asignado_id) {
        const choferDoc = await db.collection('choferes').doc(newData.chofer_asignado_id).get();
        if (!choferDoc.exists) return;

        const choferData = choferDoc.data();
        const chatId = choferData.telegram_chat_id;
        if (!chatId) return;

        const mensaje = `*Nuevo Viaje Asignado*\n\n*Cliente:* ${newData.cliente}\n*Pasajero:* ${newData.apellido_y_nombre}\n*Fecha:* ${newData.fecha}\n*Hora Pick Up:* ${newData.hora_pickup || newData.hora}\n\n*Origen:* ${newData.direccion_origen || 'No especificado'}\n*Destino:* ${newData.direccion_destino || 'No especificado'}\n\n*Observaciones:* ${newData.observaciones || 'Ninguna'}`;
        try {
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            await axios.post(url, {
                chat_id: chatId,
                text: mensaje,
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error("Error al enviar notificación de Telegram:", error.response ? error.response.data : error.message);
        }
    }
});

// ===========================================================================
// FUNCIONES DE AUTENTICACIÓN (Sintaxis v2)
// ===========================================================================

exports.crearPerfilUsuario = onUserCreate(async (user) => {
    const usersCollectionRef = db.collection('users');
    const userSnapshot = await usersCollectionRef.limit(1).get();
    let permisosAsignados = ['ver_tab_reservas'];
    if (userSnapshot.empty) { // Si es el primer usuario, darle todos los permisos
        permisosAsignados = ['ver_tab_reservas', 'ver_tab_usuarios', 'ver_tab_clientes', 'ver_tab_moviles', 'ver_tab_choferes', 'ver_tab_sucursales', 'ver_tab_zonas', 'ver_tab_mapa'];
    }
    return usersCollectionRef.doc(user.uid).set({
        nombre: user.email.split('@')[0],
        email: user.email,
        estado: 'activo',
        permisos: permisosAsignados
    });
});

// ===========================================================================
// FUNCIONES HTTPS (Sintaxis v2)
// ===========================================================================

async function tienePermisoDeGestionarUsuarios(uid) {
    if (!uid) return false;
    try {
        const userDoc = await db.collection('users').doc(uid).get();
        return userDoc.exists && userDoc.data().permisos?.includes('ver_tab_usuarios');
    } catch (error) {
        console.error("Error verificando permisos:", error);
        return false;
    }
}

exports.getUserProfile = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'La función requiere autenticación.');
    }
    try {
        const userDoc = await db.collection('users').doc(request.auth.uid).get();
        if (!userDoc.exists) {
            return { data: null };
        }
        return { data: userDoc.data() };
    } catch (error) {
        console.error("Error en getUserProfile:", error);
        throw new HttpsError('internal', 'Error al obtener el perfil de usuario.');
    }
});

exports.listAllUsers = onCall(async (request) => {
    if (!request.auth || !(await tienePermisoDeGestionarUsuarios(request.auth.uid))) {
        throw new HttpsError('permission-denied', 'No tienes permiso para esta acción.');
    }
    const listUsersResult = await admin.auth().listUsers(1000);
    const usersPromises = listUsersResult.users.map(async (userRecord) => {
        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        return {
            uid: userRecord.uid,
            email: userRecord.email,
            nombre: userData.nombre || userRecord.email,
            disabled: userRecord.disabled,
            permisos: userData.permisos || []
        };
    });
    return {
        users: await Promise.all(usersPromises)
    };
});

exports.createUserWithPermissions = onCall(async (request) => {
    if (!request.auth || !(await tienePermisoDeGestionarUsuarios(request.auth.uid))) {
        throw new HttpsError('permission-denied', 'No tienes permiso para esta acción.');
    }
    const { email, password, nombre, permisos } = request.data;
    const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: nombre
    });
    await db.collection('users').doc(userRecord.uid).set({
        nombre,
        email,
        estado: 'activo',
        permisos
    });
    return {
        success: true,
        message: `Usuario ${email} creado.`
    };
});

exports.updateUserPermissions = onCall(async (request) => {
    if (!request.auth || !(await tienePermisoDeGestionarUsuarios(request.auth.uid))) {
        throw new HttpsError('permission-denied', 'No tienes permiso para esta acción.');
    }
    const { uid, permisos, nombre } = request.data;
    await db.collection('users').doc(uid).update({
        permisos,
        nombre
    });
    return {
        success: true,
        message: `Permisos actualizados.`
    };
});

exports.toggleUserStatus = onCall(async (request) => {
    if (!request.auth || !(await tienePermisoDeGestionarUsuarios(request.auth.uid))) {
        throw new HttpsError('permission-denied', 'No tienes permiso para esta acción.');
    }
    const { uid, disabled } = request.data;
    await admin.auth().updateUser(uid, {
        disabled
    });
    await db.collection('users').doc(uid).update({
        estado: disabled ? 'suspendido' : 'activo'
    });
    return {
        success: true,
        message: `El estado del usuario ha sido actualizado.`
    };
});
