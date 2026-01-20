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
const { onDocumentWritten, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { google } = require("googleapis"); 
const { GoogleGenerativeAI } = require("@google/generative-ai");
const XLSX = require("xlsx");
const { PDFDocument } = require("pdf-lib");

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
    // 1. Si el documento fue eliminado, salir.
    if (!event.data.after.exists) return null;

    const before = event.data.before.exists ? event.data.before.data() : {};
    const after = event.data.after.data();

    // 2. FILTRO ANTIBUCLE Y OPTIMIZACIÓN
    // Solo actuamos si cambiaron las direcciones O si faltan los cálculos.
    // Si la distancia ya existe, no volvemos a preguntar a Google.
    const cambioDireccion = (before.origen !== after.origen) || (before.destino !== after.destino);
    const faltanDatos = !after.distancia || !after.duracion_estimada_minutos;

    if (!cambioDireccion && !faltanDatos) {
        return null; // Detiene la ejecución aquí y evita el bucle
    }

    // 3. Verificación de seguridad para no procesar "Revision" o "Anulado" si no es necesario
    if (after.estado?.principal === 'Anulado') return null;

    try {
        const mapsClient = getMapsClient(); // Usamos la función auxiliar definida arriba
        const res = await mapsClient.distancematrix({
            params: {
                origins: [after.origen],
                destinations: [after.destino],
                key: GEOCODING_API_KEY
            }
        });

        const element = res.data.rows[0].elements[0];
        
        if (element && element.status === 'OK') {
            const duration = Math.ceil(element.duration.value / 60);
            const distance = (element.distance.value / 1000).toFixed(1) + " km";
            
            // 4. ACTUALIZACIÓN ATÓMICA
            console.log(`✨ Enriqueciendo datos para reserva ${event.params.reservaId}`);
            return event.data.after.ref.update({
                duracion_estimada_minutos: duration,
                distancia: distance
            });
        } else {
            console.warn(`⚠️ Google Maps no encontró ruta para reserva ${event.params.reservaId}: ${element?.status}`);
        }
    } catch (e) {
        console.error("❌ Error en geocodeAddress:", e.message);
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

exports.exportarHistorico = onCall({ cors: true, timeoutSeconds: 300, memory: "1GiB" }, async (r) => {
    const { fechaDesde, fechaHasta, clienteId } = r.data;
    
    if (!fechaDesde || !fechaHasta) {
        throw new HttpsError('invalid-argument', 'Fechas no proporcionadas.');
    }

    // Filtramos por 'fecha_turno' (la fecha real del viaje)
    // Usamos string comparison que es rápido y compatible con tus datos actuales
    let q = db.collection('historico')
              .where('fecha_turno', '>=', fechaDesde)
              .where('fecha_turno', '<=', fechaHasta);
    
    if (clienteId) {
        q = q.where('cliente', '==', clienteId);
    }
    
    const s = await q.get();

    if (s.empty) {
        return { data: null, message: "No se encontraron viajes en este período." };
    }

    const registros = [];

    s.forEach(d => {
        const v = d.data();
        
        // Limpieza de datos para el Excel
        const estadoStr = (typeof v.estado === 'object' && v.estado.principal) ? v.estado.principal : (v.estado || 'N/A');
        // Extraer solo el número de los KM
        const kmNumerico = parseFloat((v.distancia || "0").replace(/[^0-9.]/g, "")) || 0;

        registros.push({
            "ID Reserva": d.id,
            "Fecha Turno": v.fecha_turno || 'S/D',
            "Hora Turno": v.hora_turno || 'S/D',
            "Hora PickUp": v.hora_pickup || '-',
            "Pasajero": v.nombre_pasajero || 'S/D',
            "Cliente": v.cliente_nombre || 'S/D',
            "Origen": v.origen || 'S/D',
            "Destino": v.destino || 'S/D',
            "Chofer": v.chofer_nombre || v.choferNombre || 'Sin Chofer',
            "Móvil": v.movil_numero || '-',
            "KM": kmNumerico,
            "Peaje ($)": parseFloat(v.peaje_manual) || 0,
            "Espera (hs)": parseFloat(v.espera_total) || 0,
            "Estado": estadoStr,
            "Usuario": v.creado_por || 'Sistema',
            "Observaciones": v.observaciones || ''
        });
    });

    // Generamos el Excel AQUÍ en el servidor (más rápido y seguro)
    const worksheet = XLSX.utils.json_to_sheet(registros);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Historial");

    // Lo convertimos a un texto Base64 para enviarlo al navegador
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const base64String = excelBuffer.toString('base64');

    return { 
        data: base64String, 
        count: registros.length
    };
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
exports.gestionarNotificacionesDeReservas = onDocumentUpdated("reservas/{id}", async (event) => {
    // En v2, 'change' y 'context' se reemplazan por 'event'
    const before = event.data.before.data();
    const after = event.data.after.data();
    const reservaId = event.params.id; // El ID viene aquí
    
    let title = '', body = '', choferId = '';

    if (!before.chofer_asignado_id && after.chofer_asignado_id) {
        choferId = after.chofer_asignado_id; 
        title = '¡Nuevo Viaje!'; 
        body = `Origen: ${after.origen}`;
    } else if (before.chofer_asignado_id && !after.chofer_asignado_id) {
        choferId = before.chofer_asignado_id; 
        title = 'Viaje Retirado'; 
        body = 'El viaje ya no está asignado.';
    } else if (after.chofer_asignado_id && (after.origen !== before.origen || after.fecha_turno !== before.fecha_turno)) {
        choferId = after.chofer_asignado_id; 
        title = 'Reserva Actualizada'; 
        body = 'Detalles modificados.';
    }

    if (title && choferId) {
        try {
            const ch = await db.collection('choferes').doc(choferId).get();
            if (ch.exists && ch.data().fcm_token) {
                await admin.messaging().send({
                    token: ch.data().fcm_token,
                    notification: { title, body },
                    android: { notification: { channel_id: 'high_importance_channel' } },
                    apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
                    // En v2 data debe ser string key-value, reservationId es reservaId
                    data: { title, body, reservaId: reservaId, click_action: "FLUTTER_NOTIFICATION_CLICK", tipo: "actualizacion" }
                });
            }
        } catch (error) {
            console.error("Error enviando notificación:", error);
        }
    }
});

exports.notificarCancelacionDeReserva = onDocumentDeleted("reservas/{id}", async (event) => {
    const reservaId = event.params.id;
    
    // Verificamos si existe en histórico para no notificar movimientos administrativos
    const hist = await db.collection('historico').doc(reservaId).get();
    if (hist.exists) return null; 

    const d = event.data.data(); // En onDelete, event.data es el snapshot del documento borrado
    
    if (d && d.chofer_asignado_id) {
        try {
            const ch = await db.collection('choferes').doc(d.chofer_asignado_id).get();
            if (ch.exists && ch.data().fcm_token) {
                await admin.messaging().send({
                    token: ch.data().fcm_token,
                    notification: { title: 'Viaje Cancelado', body: `Cancelado: ${d.origen}` },
                    android: { notification: { channel_id: 'high_importance_channel' } },
                    apns: { payload: { aps: { sound: 'reserva_sound.aiff' } } },
                    data: { title: 'Viaje Cancelado', body: `Cancelado: ${d.origen}`, reservaId: reservaId, click_action: "FLUTTER_NOTIFICATION_CLICK", tipo: "cancelacion" }
                });
            }
        } catch (error) {
            console.error("Error al notificar cancelación:", error);
        }
    }
});

// ===================================================================================
// 7. INTELIGENCIA ARTIFICIAL (MOTOR CENTRAL ESTANDARIZADO)
// ===================================================================================

// ===================================================================================
// FUNCIONES AUXILIARES (Pega esto al final de index.js)
// ===================================================================================

// 1. Extraer texto limpio del cuerpo del correo
function extractBody(payload) {
    if (!payload) return "";
    let body = "";
    if (payload.body && payload.body.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain') {
                if (part.body && part.body.data) {
                    body += Buffer.from(part.body.data, 'base64').toString('utf-8');
                }
            } else if (part.mimeType === 'multipart/alternative') {
                body += extractBody(part);
            }
        }
    }
    return body;
}

// 2. Descargar adjuntos (PDF/Excel)
async function obtenerAdjuntos(gmail, msgId, payload) {
    let adjuntos = [];
    if (!payload.parts) return adjuntos;
    
    // Función recursiva para buscar adjuntos en partes anidadas
    async function buscarEnPartes(partes) {
        for (const part of partes) {
            if (part.filename && part.body && part.body.attachmentId) {
                const esPDF = part.mimeType === 'application/pdf';
                const esExcel = part.mimeType.includes('sheet') || part.mimeType.includes('excel');
                
                if (esPDF || esExcel) {
                    try {
                        const att = await gmail.users.messages.attachments.get({
                            userId: 'me',
                            messageId: msgId,
                            id: part.body.attachmentId
                        });
                        
                        if(att.data.data) {
                            adjuntos.push({
                                inlineData: {
                                    data: att.data.data,
                                    mimeType: part.mimeType
                                }
                            });
                        }
                    } catch (e) {
                        console.error("Error bajando adjunto:", part.filename, e);
                    }
                }
            }
            // Si tiene sub-partes, buscar ahí también
            if (part.parts) {
                await buscarEnPartes(part.parts);
            }
        }
    }

    await buscarEnPartes(payload.parts);
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
// --- PROMPT MAESTRO MEJORADO CON SOPORTE DE FRAGMENTACIÓN PDF ---
async function analizarCorreoConGemini(asunto, cuerpo, adjuntos) {
    console.log(`🤖 Analizando con IA: ${asunto}`);

    // Configuración del Modelo
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const PROMPT_BASE = `
        Actúa como un experto en logística y auditoría de traslados médicos (ART). 
        Tu misión es extraer datos de viajes y devolverlos en JSON estricto.
        
        INPUT: 
        - Contexto: "${asunto}"
        - Fecha Referencia: ${new Date().toISOString().split('T')[0]}

        REGLAS DE EXTRACCIÓN (CRÍTICO):
        1. **DNI**: Busca números de 7-8 dígitos cerca del nombre del pasajero.
        2. **Siniestro**: Número de 7 dígitos (ej: 2940055). Vital.
        3. **Autorización**: Formato numérico con barra (ej: 4786594/15).
        
        4. **Teléfono Principal**: 
           - Busca el teléfono "oficial" del paciente (generalmente en encabezados o junto al DNI) y ponlo en 'telefono_pasajero'.
        
        5. **Observaciones (NO TOCAR CONTEXTO)**: 
           - Busca palabras clave: "Muletas", "Bota", "Silla de ruedas", "FKT", "Fisiokinesio", "Solicita paciente".
           - **REGLA DE PROTECCIÓN**: Si encuentras un número de teléfono AQUÍ mezclado con texto, **DÉJALO ESCRITO EN OBSERVACIONES**. No lo muevas ni lo borres.

        6. **REGLA DE ORO (Descarte)**: Todo dato útil sobrante va a observaciones.

        7. **Empresa/Cliente (DISTINCIÓN OBLIGATORIA)**: 
           - Identifica la aseguradora y diferencia geográficamente:
           - **CASO SAN NICOLAS**: Si detectas las siglas "SN", "S.N." o la mención "San Nicolas", el nombre DEBE ser:
             * "Prevencion ART San Nicolas"
             * "La Segunda San Nicolas"
           - **CASO GENERAL**: Si NO existe ninguna mención a San Nicolas, usa el nombre estándar:
             * "Prevencion ART"
             * "La Segunda"
           - Si el texto es ambiguo, prioriza el contexto del remitente o las direcciones de origen/destino para decidir.

       

        SALIDA JSON OBLIGATORIA:
        { "reservas": [ 
            {
                "fecha_turno": "YYYY-MM-DD",
                "hora_turno": "HH:MM",
                "nombre_pasajero": "Texto",
                "dni_pasajero": "Solo números",
                "telefono_pasajero": "Texto", 
                "origen": "Dirección completa",
                "destino": "Dirección completa",
                "siniestro": "Texto",
                "autorizacion": "Texto",
                "cliente_nombre_ia": "Nombre normalizado (ej: Prevencion ART San Nicolas)",
                "observaciones": "Texto completo"
            } 
        ] }
    `;

    // 1. ESTRATEGIA DE FRAGMENTACIÓN DE PDF (Backend)
    // Si detectamos un PDF grande, lo dividimos y llamamos a la IA varias veces.
    let todasLasReservas = [];
    const archivoPDF = adjuntos ? adjuntos.find(a => a.inlineData.mimeType === 'application/pdf') : null;

    if (archivoPDF) {
        try {
            // Convertimos base64 a Buffer y cargamos con pdf-lib
            const pdfBuffer = Buffer.from(archivoPDF.inlineData.data, 'base64');
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const totalPaginas = pdfDoc.getPageCount();
            
            console.log(`📄 PDF detectado con ${totalPaginas} páginas.`);

            if (totalPaginas > 5) {
                console.log("✂️ PDF grande: Iniciando fragmentación en lotes de 5...");
                const TAMANO_LOTE = 5;

                for (let i = 0; i < totalPaginas; i += TAMANO_LOTE) {
                    // Crear sub-documento
                    const subPdf = await PDFDocument.create();
                    const indices = [];
                    for (let j = 0; j < TAMANO_LOTE && (i + j) < totalPaginas; j++) {
                        indices.push(i + j);
                    }
                    const copiedPages = await subPdf.copyPages(pdfDoc, indices);
                    copiedPages.forEach(page => subPdf.addPage(page));
                    
                    const subBase64 = await subPdf.saveAsBase64();
                    
                    // Llamar a Gemini con este fragmento
                    const fragmentPart = { inlineData: { data: subBase64, mimeType: "application/pdf" } };
                    const result = await model.generateContent([PROMPT_BASE, fragmentPart]);
                    const jsonRes = parsearRespuestaGemini(result.response.text());
                    
                    if (jsonRes.reservas) {
                        todasLasReservas = [...todasLasReservas, ...jsonRes.reservas];
                    }
                }
                
                // Retornamos el acumulado de todos los fragmentos
                return { reservas: todasLasReservas };

            } 
            // Si es corto (<= 5 páginas), procesamos normal abajo...
        } catch (e) {
            console.error("⚠️ Error manipulando PDF en backend:", e);
            // Si falla la fragmentación, intentamos procesarlo entero como fallback
        }
    }

    // 2. PROCESAMIENTO ESTÁNDAR (Sin PDF o PDF corto)
    const parts = [PROMPT_BASE];
    if (cuerpo) parts.push(`Contenido Email: ${cuerpo.substring(0, 8000)}`);
    if (adjuntos && adjuntos.length > 0) parts.push(...adjuntos);

    try {
        const res = await model.generateContent(parts);
        return parsearRespuestaGemini(res.response.text());
    } catch (error) {
        console.error("❌ Error Generando Contenido IA:", error);
        return { reservas: [] }; 
    }
}


// ===================================================================================
// OPTIMIZACIÓN GMAIL: MOTOR UNIFICADO (REEMPLAZA A TUS 3 FUNCIONES ANTERIORES)
// ===================================================================================

// 1. Helper de Conexión (Para no repetir credenciales)
function getGmailClient() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth: oauth2Client });
}

// 2. Motor Lógico Central (Hace todo el trabajo sucio)

async function procesarBandejaEntrada(origen) {
    const gmail = getGmailClient();
    
    // 1. OBTENER LISTA DE CLIENTES REALES PARA COMPARAR
    const clientesSnapshot = await db.collection('clientes').get();
    const mapaClientes = {};
    
    clientesSnapshot.forEach(doc => {
        const d = doc.data();
        if (d.nombre) {
            // Guardamos el nombre en minúsculas y sin espacios para un match perfecto
            const nombreNormalizado = d.nombre.toLowerCase().trim();
            mapaClientes[nombreNormalizado] = doc.id;
        }
    });
    
    const list = await gmail.users.messages.list({ 
        userId: 'me', 
        q: 'is:unread', 
        maxResults: 10 
    });
    
    const msgs = list.data.messages || [];
    if (msgs.length === 0) return { procesados: 0, mensaje: "Sin correos nuevos." };

    let count = 0;
    let batch = db.batch();
    
    const filtro = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
    const negativo = /Alerta|Security|Google|Verificación/i;

    for (const m of msgs) {
        try {
            const d = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
            const subj = d.data.payload.headers.find(h => h.name === 'Subject')?.value || '';

            if (!filtro.test(subj) || negativo.test(subj)) {
                await gmail.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['UNREAD'] } });
                continue;
            }

            const body = extractBody(d.data.payload);
            const adjs = await obtenerAdjuntos(gmail, m.id, d.data.payload);

            if (!body.trim() && adjs.length === 0) continue;

            const ia = await analizarCorreoConGemini(subj, body, adjs);
            
            if (ia.reservas && ia.reservas.length > 0) {
                ia.reservas.forEach(res => {
                    const docRef = db.collection('reservas').doc();
                    
                    // 2. LÓGICA DE MATCH (EL "CEREBRO")
                    let clienteIdFinal = null;
                    if (res.cliente_nombre_ia) {
                        const buscado = res.cliente_nombre_ia.toLowerCase().trim();
                        // Si el nombre normalizado que dio la IA coincide con uno de la DB, asignamos el ID
                        if (mapaClientes[buscado]) {
                            clienteIdFinal = mapaClientes[buscado];
                        }
                    }

                    batch.set(docRef, {
                        ...res,
                        cliente: clienteIdFinal, // Aquí se guarda el ID de Firebase (ej: ABC123xyz)
                        origen_dato: `Gmail (${origen})`,
                        email_id: m.id,
                        estado: { 
                            principal: 'Revision', 
                            detalle: `Importado: ${subj}`, 
                            actualizado_en: new Date() 
                        },
                        creadoEn: new Date()
                    });
                    count++;
                });
            }

            await gmail.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['UNREAD'] } });

        } catch (e) {
            console.error(`Error procesando mensaje ${m.id}:`, e);
        }
    }

    if (count > 0) await batch.commit();
    return { procesados: count, mensaje: `Se importaron ${count} reservas con asignación automática.` };
}

// 3. Trigger MANUAL (Para tu botón en la web)
// IMPORTANTE: Asegúrate de que tu botón en el frontend llame a 'escanearCorreosGmail'
exports.escanearCorreosGmail = onCall({ timeoutSeconds: 540, memory: "1GiB" }, async (request) => {
    try {
        console.log("👆 Escaneo Manual Iniciado...");
        const resultado = await procesarBandejaEntrada("Manual");
        return resultado;
    } catch (error) {
        console.error("Error Manual:", error);
        throw new HttpsError('internal', error.message);
    }
});

// 4. Trigger AUTOMÁTICO (Cada 15 min)
exports.chequearCorreosCron = onSchedule("every 15 minutes", async (event) => {
    if (!process.env.GMAIL_CLIENT_ID) return;
    console.log("⏰ Cron Gmail Iniciado...");
    await procesarBandejaEntrada("Auto");
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