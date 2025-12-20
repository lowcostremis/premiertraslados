// functions/index.js

// ===================================================================================
// 1. IMPORTACIONES Y CONFIGURACIÓN
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

admin.initializeApp();
const db = admin.firestore();

// --- INICIALIZACIÓN DIFERIDA ---
let algoliaClient, mapsClient;
let pasajerosIndex, historicoIndex, reservasIndex, choferesIndex;
const GEOCODING_API_KEY = process.env.GEOCODING_API_KEY;

function getMapsClient() {
    if (!mapsClient) mapsClient = new Client({});
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
// 2. FUNCIONES DE GESTIÓN DE CHOFERES
// ===================================================================================
exports.crearChoferConAcceso = onCall(async (request) => {
    const { dni, nombre, email, password, domicilio, telefono, movil_actual_id } = request.data;
    if (!dni || !nombre || !email || !password) throw new HttpsError('invalid-argument', 'Faltan datos.');
    try {
        const userRecord = await admin.auth().createUser({ email, password, displayName: nombre });
        await db.collection('choferes').doc(dni).set({
            auth_uid: userRecord.uid, nombre, email, dni,
            domicilio: domicilio || '', telefono: telefono || '', movil_actual_id: movil_actual_id || null,
            creadoEn: admin.firestore.FieldValue.serverTimestamp()
        });
        return { message: `Chofer ${nombre} creado con éxito.` };
    } catch (e) { throw new HttpsError('internal', e.message); }
});

exports.resetearPasswordChofer = onCall(async (request) => {
    const { auth_uid, nuevaPassword } = request.data;
    if (!auth_uid || !nuevaPassword) throw new HttpsError('invalid-argument', 'Faltan datos.');
    try { await admin.auth().updateUser(auth_uid, { password: nuevaPassword }); return { message: "Contraseña actualizada." }; }
    catch (e) { throw new HttpsError('internal', e.message); }
});

exports.borrarChofer = onCall(async (request) => {
    const { dni, auth_uid } = request.data;
    try {
        await admin.auth().deleteUser(auth_uid);
        await db.collection('choferes').doc(dni).delete();
        return { message: "Chofer borrado." };
    } catch (e) {
        if (e.code === 'auth/user-not-found') { await db.collection('choferes').doc(dni).delete(); return { message: "Borrado de DB." }; }
        throw new HttpsError('internal', e.message);
    }
});

// ===================================================================================
// 3. TRIGGERS DE FIRESTORE (GEOCODIFICACIÓN Y ALGOLIA)
// ===================================================================================

exports.geocodeAddress = onDocumentWritten("reservas/{reservaId}", async (event) => {
    if (!event.data.after.exists) return null;
    const client = getMapsClient();
    const after = event.data.after.data();
    
    // TRIPLE PLAN: Si no tiene duración o distancia, la pedimos automáticamente
    if (!after.duracion_estimada_minutos || !after.distancia) {
        try {
            const res = await client.distancematrix({
                params: {
                    origins: [after.origen],
                    destinations: [after.destino],
                    key: GEOCODING_API_KEY
                }
            });

            const element = res.data.rows[0].elements[0];
            if (element.status === 'OK') {
                const duration = Math.ceil(element.duration.value / 60);
                const distance = (element.distance.value / 1000).toFixed(1) + " km";
                
                // Actualizamos el documento automáticamente con los datos de Google
                await event.data.after.ref.update({
                    duracion_estimada_minutos: duration,
                    distancia: distance
                });
                console.log(`✅ Triple Plan: Datos enriquecidos para ${after.nombre_pasajero}`);
            }
        } catch (e) { console.error("Error en Triple Plan (Background):", e.message); }
    }
    return null;
});

exports.sincronizarConAlgolia = onDocumentWritten("pasajeros/{id}", (e) => {
    const { pasajerosIndex } = getAlgoliaIndices();
    return !e.data.after.exists ? pasajerosIndex.deleteObject(e.params.id) : pasajerosIndex.saveObject({ objectID: e.params.id, ...e.data.after.data() });
});

exports.sincronizarHistoricoConAlgolia = onDocumentWritten("historico/{id}", (e) => {
    const { historicoIndex } = getAlgoliaIndices();
    return !e.data.after.exists ? historicoIndex.deleteObject(e.params.id) : historicoIndex.saveObject({ objectID: e.params.id, ...e.data.after.data() });
});

exports.sincronizarReservasConAlgolia = onDocumentWritten("reservas/{id}", (e) => {
    const { reservasIndex } = getAlgoliaIndices();
    return !e.data.after.exists ? reservasIndex.deleteObject(e.params.id) : reservasIndex.saveObject({ objectID: e.params.id, ...e.data.after.data() });
});

exports.sincronizarChoferesConAlgolia = onDocumentWritten("choferes/{id}", async (e) => {
    const { choferesIndex } = getAlgoliaIndices();
    if (!e.data.after.exists) return choferesIndex.deleteObject(e.params.id);
    const data = e.data.after.data();
    if (data.movil_actual_id) {
        try {
            const movil = await db.collection('moviles').doc(data.movil_actual_id).get();
            if (movil.exists) data.numero_movil = movil.data().numero;
        } catch(err) { console.error(err); }
    }
    return choferesIndex.saveObject({ objectID: e.params.id, ...data });
});

exports.agregarNombreClienteAReserva = onDocumentWritten("reservas/{id}", async (e) => {
    if (!e.data.after.exists) return null;
    const d = e.data.after.data();
    if (d.cliente_nombre || !d.cliente) return null;
    try {
        const c = await db.collection("clientes").doc(d.cliente).get();
        return e.data.after.ref.update({ cliente_nombre: c.exists ? (c.data().nombre || "N/A") : "N/A" });
    } catch(err) { console.error(err); return null; }
});

// ===================================================================================
// 4. ADMIN USUARIOS Y EXPORTACIÓN
// ===================================================================================
exports.crearUsuario = onCall(async (r) => {
    const { email, password, nombre } = r.data;
    const user = await admin.auth().createUser({ email, password, displayName: nombre });
    await db.collection('users').doc(user.uid).set({ nombre, email, rol: 'operador' });
    return { result: "OK" };
});
exports.listUsers = onCall(async () => {
    const s = await db.collection('users').get();
    return { users: s.docs.map(d => ({ uid: d.id, ...d.data() })) };
});
exports.exportarHistorico = onCall(async (r) => {
    const { fechaDesde, fechaHasta, clienteId } = r.data;
    const inicio = admin.firestore.Timestamp.fromDate(new Date(fechaDesde + 'T00:00:00Z'));
    const fin = admin.firestore.Timestamp.fromDate(new Date(fechaHasta + 'T23:59:59Z'));
    let q = db.collection('historico').where('archivadoEn', '>=', inicio).where('archivadoEn', '<=', fin);
    if (clienteId) q = q.where('cliente', '==', clienteId);
    const s = await q.get();
    let csv = "\uFEFFFecha Turno;Hora Turno;Hora PickUp;Pasajero;Cliente;Chofer;Origen;Destino;Estado;Siniestro;Autorizacion;Espera Total;Espera Sin Cargo\n";
    
    s.forEach(d => {
        const v = d.data();
        const esc = (f) => `"${(f||'').toString().replace(/"/g, '""')}"`;
        
        // NUEVO: Agregamos los valores al final de la fila
        csv += `${v.fecha_turno||'N/A'};${v.hora_turno||'N/A'};${v.hora_pickup||'N/A'};${esc(v.nombre_pasajero)};${esc(v.clienteNombre)};${esc(v.choferNombre)};${esc(v.origen)};${esc(v.destino)};${(typeof v.estado==='object'?v.estado.principal:v.estado)||'N/A'};${v.siniestro||'N/A'};${v.autorizacion||'N/A'};${v.espera_total||0};${v.espera_sin_cargo||0}\n`;
    });
    return { csvData: csv };
});

// ===================================================================================
// 5. APP CHOFERES
// ===================================================================================
exports.finalizarViajeDesdeApp = onCall(async (r) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Login.');
    const { reservaId } = r.data;
    const ref = db.collection('reservas').doc(reservaId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No existe.');
    const data = snap.data();
    await db.runTransaction(async (t) => {
        data.estado = { principal: 'Finalizado', detalle: 'App Chofer', actualizado_en: admin.firestore.FieldValue.serverTimestamp() };
        data.archivadoEn = admin.firestore.FieldValue.serverTimestamp();
        if (data.chofer_asignado_id) {
            t.update(db.collection('choferes').doc(data.chofer_asignado_id), { viajes_activos: admin.firestore.FieldValue.arrayRemove(reservaId) });
        }
        t.set(db.collection('historico').doc(reservaId), data);
        t.delete(ref);
    });
    return { message: 'Finalizado' };
});
exports.gestionarRechazoDesdeApp = onCall(async (r) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Login.');
    const { reservaId, esNegativo } = r.data;
    const ref = db.collection('reservas').doc(reservaId);
    await db.runTransaction(async (t) => {
        const doc = await t.get(ref);
        if (!doc.exists) return;
        const d = doc.data();
        const ch = d.chofer_asignado_id;
        if (ch) {
            t.update(ref, {
                estado: { principal: 'En Curso', detalle: esNegativo ? 'Negativo' : 'Rechazado', actualizado_en: admin.firestore.FieldValue.serverTimestamp() },
                chofer_asignado_id: admin.firestore.FieldValue.delete(), movil_asignado_id: admin.firestore.FieldValue.delete()
            });
            t.update(db.collection('choferes').doc(ch), { viajes_activos: admin.firestore.FieldValue.arrayRemove(reservaId) });
        }
    });
    return { message: 'Actualizado' };
});

// ===================================================================================
// 6. TRIGGERS NOTIFICACIONES
// ===================================================================================
exports.gestionarNotificacionesDeReservas = functions.firestore.document("reservas/{id}").onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    let title = '', body = '', choferId = '';

    if (!before.chofer_asignado_id && after.chofer_asignado_id) {
        choferId = after.chofer_asignado_id; title = '¡Nuevo Viaje!'; body = `Origen: ${after.origen}`;
    } else if (before.chofer_asignado_id && !after.chofer_asignado_id) {
        choferId = before.chofer_asignado_id; title = 'Viaje Retirado'; body = 'El viaje ya no está asignado.';
    } else if (after.chofer_asignado_id && (after.origen !== before.origen || after.fecha_turno !== before.fecha_turno)) {
        choferId = after.chofer_asignado_id; title = 'Reserva Actualizada'; body = 'Detalles modificados.';
    }

    if (title && choferId) {
        const ch = await db.collection('choferes').doc(choferId).get();
        if (ch.exists && ch.data().fcm_token) {
            await admin.messaging().send({
                token: ch.data().fcm_token,
                notification: { title, body },
                android: { notification: { channel_id: 'high_importance_channel' } },
                apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
                data: { title, body, reservaId: context.params.id, click_action: "FLUTTER_NOTIFICATION_CLICK", tipo: "actualizacion" }
            });
        }
    }
});

exports.notificarCancelacionDeReserva = functions.firestore.document('reservas/{id}').onDelete(async (snap, context) => {
    const hist = await db.collection('historico').doc(context.params.id).get();
    if (hist.exists) return null; 

    const d = snap.data();
    if (d.chofer_asignado_id) {
        const ch = await db.collection('choferes').doc(d.chofer_asignado_id).get();
        if (ch.exists && ch.data().fcm_token) {
            await admin.messaging().send({
                token: ch.data().fcm_token,
                notification: { title: 'Viaje Cancelado', body: `Cancelado: ${d.origen}` },
                android: { notification: { channel_id: 'high_importance_channel' } },
                apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
                data: { title: 'Viaje Cancelado', body: `Cancelado: ${d.origen}`, reservaId: context.params.id, click_action: "FLUTTER_NOTIFICATION_CLICK", tipo: "cancelacion" }
            });
        }
    }
});

// ===================================================================================
// 7. INTELIGENCIA ARTIFICIAL (MOTOR CENTRAL ESTANDARIZADO)
// ===================================================================================

function extractBody(payload) {
    if (!payload) return "";
    let encodedBody = '';
    if (payload.body && payload.body.data) encodedBody = payload.body.data;
    else if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain') || payload.parts.find(p => p.mimeType === 'text/html') || payload.parts[0];
        if (part && part.body && part.body.data) encodedBody = part.body.data;
    }
    return encodedBody ? Buffer.from(encodedBody, 'base64url').toString('utf-8') : "";
}

async function obtenerAdjuntos(gmail, messageId, payload) {
    const adjuntos = [];
    if (!payload.parts) return adjuntos;
    const buscar = async (partes) => {
        for (const p of partes) {
            if (p.filename && p.body && p.body.attachmentId) {
                if (p.mimeType === 'application/pdf' || p.mimeType.includes('spreadsheet') || p.mimeType.includes('excel') || p.mimeType.includes('csv')) {
                    try {
                        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: p.body.attachmentId });
                        if (att.data.data) adjuntos.push({ inlineData: { data: att.data.data, mimeType: p.mimeType } });
                        console.log(`📎 Adjunto: ${p.filename}`);
                    } catch (e) { console.error(`Err adjunto ${p.filename}`, e); }
                }
            }
            if (p.parts) await buscar(p.parts);
        }
    };
    await buscar(payload.parts);
    return adjuntos;
}

function parsearRespuestaGemini(textoCrudo) {
    console.log("🤖 Texto crudo de Gemini:", textoCrudo.substring(0, 500)); 
    try {
        let limpio = textoCrudo.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(limpio);
    } catch (e) {
        console.error("❌ Falló JSON.parse incluso en modo nativo. Texto:", textoCrudo);
        throw new Error("Formato inválido de IA");
    }
}

// PROMPT MAESTRO: Estandariza todo (Gmail, Excel, PDF)
async function analizarCorreoConGemini(asunto, cuerpo, adjuntos) {
    const prompt = `
        Actúa como operador logístico experto. Extrae datos de viajes y devuélvelos en JSON estricto.
        
        INPUT: 
        - Contexto/Asunto: "${asunto}"
        - Contenido: "${cuerpo.substring(0, 8000)}"
        - Fecha de Hoy: ${new Date().toISOString().split('T')[0]}

        REGLAS OBLIGATORIAS DE SALIDA:
        1. Devuelve SOLAMENTE un objeto JSON con la estructura: { "reservas": [ ... ] }
        2. Mapea los datos a estas claves EXACTAS (no uses nombres de columnas originales):
           - "fecha_turno": Formato YYYY-MM-DD. Si no hay año, usa el actual.
           - "hora_turno": Formato HH:MM (24hs).
           - "hora_pickup": Formato HH:MM (24hs). Si no existe, usa la hora_turno.
           - "nombre_pasajero": Nombre completo del pasajero.
           - "telefono_pasajero": Solo números (ej: 341...).
           - "origen": Dirección de partida completa (Calle, Número, Localidad). Si hay múltiples, únelos con " + ".
           - "destino": Dirección de destino completa.
           - "cliente": Nombre de la empresa, obra social o "PARTICULARES".
           - "observaciones": Notas relevantes, acompañantes, tipo de vehículo solicitado.
           - "siniestro": Número de siniestro (si aplica).
           - "autorizacion": Número de autorización (si aplica).
           - "cantidad_pasajeros": Número entero (default 1).
           - "es_exclusivo": true/false (default false).
           "- 'espera_total': Número (horas de espera si figuran en el documento)."
           "- 'espera_sin_cargo': Número (horas sin cargo si figuran)."
           "- 'duracion_estimada_minutos': Número entero (si el documento indica duración del viaje)."
        
        3. Limpieza:
           - Si el teléfono tiene guiones, quítalos.
           - Si la localidad no está explícita pero es obvia (ej: Rosario), agrégala.
           - Ignora filas totalmente vacías o encabezados de tabla.
    `;
    
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const parts = [prompt];
    if (adjuntos && adjuntos.length > 0) parts.push(...adjuntos);
    
    const res = await model.generateContent(parts);
    return parsearRespuestaGemini(res.response.text());
}
    
// --- GMAIL MANUAL ---
exports.procesarReservasGmail = onCall({ cors: true, timeoutSeconds: 300, memory: "1GiB" }, async (r) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Login.');
    if (!process.env.GMAIL_CLIENT_ID) throw new HttpsError('internal', 'Credenciales.');

    const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth });

    try {
        const list = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const msgs = list.data.messages || [];
        if (msgs.length === 0) return { message: "Sin correos." };

        let total = 0, batch = db.batch(), count = 0;
        const filtro = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
        const negativo = /Alerta|Security|Google|Verificación/i;

        for (const m of msgs) {
            const d = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
            const subj = d.data.payload.headers.find(h => h.name === 'Subject')?.value || '';
            
            if (!filtro.test(subj) || negativo.test(subj)) continue;

            const body = extractBody(d.data.payload);
            const adjs = await obtenerAdjuntos(gmail, m.id, d.data.payload);
            
            if (!body.trim() && adjs.length === 0) continue;

            try {
                const ia = await analizarCorreoConGemini(subj, body, adjs);
                const list = ia.reservas || [];
                for (const item of list) {
                    batch.set(db.collection('reservas').doc(), { ...item, origen_dato: 'Gmail Manual', email_id: m.id, estado: { principal: 'Revision', detalle: `Importado: ${subj}`, actualizado_en: new Date() }, creadoEn: new Date() });
                    total++; count++;
                }
                await gmail.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['UNREAD'] } });
                if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
            } catch (e) { console.error(`Error procesando email ${m.id}:`, e); }
        }
        if (count > 0) await batch.commit();
        return { message: `Procesados. Reservas: ${total}` };
    } catch (e) { throw new HttpsError('internal', e.message); }
});

// --- GMAIL AUTOMÁTICO ---
exports.chequearCorreosCron = onSchedule("every 15 minutes", async (event) => {
    if (!process.env.GMAIL_CLIENT_ID) return;
    console.log("⏰ Cron Gmail Multimodal...");
    const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth });

    try {
        const list = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const msgs = list.data.messages || [];
        if (msgs.length === 0) return;

        let total = 0, batch = db.batch(), count = 0;
        const filtro = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
        const negativo = /Alerta|Security|Google|Verificación/i;

        for (const m of msgs) {
            const d = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
            const subj = d.data.payload.headers.find(h => h.name === 'Subject')?.value || '';
            
            if (!filtro.test(subj) || negativo.test(subj)) continue;

            const body = extractBody(d.data.payload);
            const adjs = await obtenerAdjuntos(gmail, m.id, d.data.payload);
            
            if (!body.trim() && adjs.length === 0) continue;

            try {
                const ia = await analizarCorreoConGemini(subj, body, adjs);
                const list = ia.reservas || [];
                for (const item of list) {
                    batch.set(db.collection('reservas').doc(), { ...item, origen_dato: 'Gmail Auto', email_id: m.id, estado: { principal: 'Revision', detalle: `Auto: ${subj}`, actualizado_en: new Date() }, creadoEn: new Date() });
                    total++; count++;
                }
                await gmail.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['UNREAD'] } });
                if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
            } catch (e) { console.error(`Error en cron email ${m.id}`, e); }
        }
        if (count > 0) await batch.commit();
        console.log(`🚀 Cron Fin: ${total} reservas.`);
    } catch (e) { console.error("Error Cron", e); }
});

// --- INTERPRETACIÓN EXCEL (ESTANDARIZADA) ---
exports.interpretarExcelIA = onCall({ cors: true, timeoutSeconds: 300 }, async (r) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Login.');
    const { datosCrudos, fechaSeleccionada } = r.data;
    
    // Reutilizamos la lógica del Prompt Maestro para que mapee las columnas del Excel 
    // a nuestras claves estándar (nombre_pasajero, origen, etc.)
    try {
        const jsonStr = JSON.stringify(datosCrudos);
        const ia = await analizarCorreoConGemini(
            "IMPORTACION EXCEL", 
            `Estos son los datos crudos del Excel. La fecha de referencia es ${fechaSeleccionada}. Procesa y mapea: ${jsonStr}`, 
            []
        );
        
        // Aseguramos que la fecha esté presente si el Excel no la traía
        if(ia.reservas) {
            ia.reservas.forEach(res => {
                if(!res.fecha_turno) res.fecha_turno = fechaSeleccionada;
            });
        }
        return { reservas: ia.reservas || ia };
    } catch (e) {
        console.error("Error interpretando Excel:", e);
        throw new HttpsError('internal', 'La IA no pudo leer el Excel.');
    }
});

// --- INTERPRETACIÓN PDF (ESTANDARIZADA) ---
exports.interpretarPDFIA = onCall({ cors: true, timeoutSeconds: 300, memory: "1GiB" }, async (r) => {
    if (!r.auth) throw new HttpsError('unauthenticated', 'Login.');
    const { pdfBase64, fechaSeleccionada } = r.data;
    
    try {
        // Creamos un objeto de adjunto compatible con la función analizarCorreoConGemini
        const adjuntoPDF = { inlineData: { data: pdfBase64, mimeType: "application/pdf" } };
        
        const ia = await analizarCorreoConGemini(
            "IMPORTACION PDF", 
            `Extrae los viajes de este PDF. La fecha de referencia es ${fechaSeleccionada}.`, 
            [adjuntoPDF]
        );
        
        if(ia.reservas) {
            ia.reservas.forEach(res => {
                if(!res.fecha_turno) res.fecha_turno = fechaSeleccionada;
            });
        }
        return { reservas: ia.reservas || ia };
    } catch (e) {
        console.error("Error interpretando PDF:", e);
        throw new HttpsError('internal', 'La IA no pudo leer el PDF.');
    }
});