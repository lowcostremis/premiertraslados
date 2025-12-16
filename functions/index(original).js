// ===================================================================================
// IMPORTACIONES
// ===================================================================================
const functions = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { Client } = require("@googlemaps/google-maps-services-js");
const algoliasearch = require("algoliasearch");
const { google } = require("googleapis"); 
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = admin.firestore();

// --- INICIALIZACIÓN DIFERIDA ---
let algoliaClient, mapsClient;
const GEOCODING_API_KEY = process.env.GEOCODING_API_KEY;

function getMapsClient() {
    if (!mapsClient) mapsClient = new Client({});
    return mapsClient;
}

function getAlgoliaIndices() {
    if (!algoliaClient) {
        algoliaClient = algoliasearch(process.env.ALGOLIA_APP_ID, process.env.ALGOLIA_API_KEY);
    }
    return { }; 
}

// ===================================================================================
// FUNCIONES AUXILIARES (PARA LEER TEXTO Y ADJUNTOS)
// ===================================================================================

// 1. Extraer cuerpo del correo (Texto/HTML)
function extractBody(payload) {
    if (!payload) return "";
    let encodedBody = '';
    if (payload.body && payload.body.data) {
        encodedBody = payload.body.data;
    } else if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain') || 
                     payload.parts.find(p => p.mimeType === 'text/html') ||
                     payload.parts[0]; 
        if (part && part.body && part.body.data) {
            encodedBody = part.body.data;
        }
    }
    if (!encodedBody) return "";
    const buff = Buffer.from(encodedBody, 'base64url');
    return buff.toString('utf-8');
}

// 2. Extraer Adjuntos (PDF/Excel) para Gemini
async function obtenerAdjuntos(gmail, messageId, payload) {
    const adjuntos = [];
    if (!payload.parts) return adjuntos;

    const buscarPartes = async (partes) => {
        for (const part of partes) {
            if (part.filename && part.body && part.body.attachmentId) {
                const mimeType = part.mimeType;
                // Filtramos solo PDFs y Excels/CSV
                if (mimeType === 'application/pdf' || 
                    mimeType.includes('spreadsheet') || 
                    mimeType.includes('excel') ||
                    mimeType.includes('csv')) {
                    
                    try {
                        const attach = await gmail.users.messages.attachments.get({
                            userId: 'me',
                            messageId: messageId,
                            id: part.body.attachmentId
                        });

                        if (attach.data.data) {
                            adjuntos.push({
                                inlineData: {
                                    data: attach.data.data, // Base64Url
                                    mimeType: mimeType
                                }
                            });
                            console.log(`📎 Adjunto encontrado: ${part.filename}`);
                        }
                    } catch (err) {
                        console.error(`Error bajando adjunto ${part.filename}:`, err);
                    }
                }
            }
            if (part.parts) await buscarPartes(part.parts);
        }
    };

    await buscarPartes(payload.parts);
    return adjuntos;
}

// 3. Lógica Central de Análisis IA (Texto + Adjuntos)
async function analizarCorreoConGemini(model, asunto, cuerpo, adjuntos) {
    const promptTexto = `
        Actúa como un experto operador de logística. Analiza este correo y sus adjuntos.
        
        ASUNTO: "${asunto}"
        CUERPO: "${cuerpo.substring(0, 5000)}"
        FECHA HOY: ${new Date().toISOString().split('T')[0]}

        TU TAREA:
        1. Si hay adjuntos (PDF/Excel), lee la tabla completa. Cada fila es un viaje.
        2. Si no hay adjuntos, busca los datos en el cuerpo del texto.
        3. Si el cuerpo dice "Todos los viajes son para tal fecha", aplícalo a las filas del adjunto si no tienen fecha.

        SALIDA:
        Un JSON con un objeto raíz {"reservas": [...]}. Es un ARRAY.
        
        Campos por reserva:
        - fecha_turno (YYYY-MM-DD)
        - hora_turno (HH:MM)
        - nombre_pasajero
        - telefono_pasajero
        - origen (Si dice "VGG" es Villa Gobernador Gálvez. Si es calle, agrega ciudad)
        - destino
        - cliente (Deduce la empresa por el correo o logo. Default: "PARTICULARES")
        - observaciones
        - siniestro
        - autorizacion
        - es_exclusivo (boolean)

        Si no hay datos, devuelve {"reservas": []}.
        Solo JSON puro.
    `;

    const partesParaGemini = [promptTexto];
    
    // Inyectamos los archivos adjuntos (si existen)
    if (adjuntos && adjuntos.length > 0) {
        partesParaGemini.push(...adjuntos);
    }

    const result = await model.generateContent(partesParaGemini);
    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(responseText);
}

// ===================================================================================
// 1. PROCESAR GMAIL (MANUAL) - VERSIÓN MULTIMODAL CORRECTA
// ===================================================================================
exports.procesarReservasGmail = onCall({ cors: true, timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes estar logueado.');
    
    if (!process.env.GMAIL_CLIENT_ID) throw new HttpsError('internal', 'Faltan credenciales.');

    const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const apiKey = process.env.GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const messages = res.data.messages;

        if (!messages || messages.length === 0) return { message: "No hay correos nuevos." };

        let totalReservasCreadas = 0;
        let batch = db.batch();
        let contadorBatch = 0;

        const filtroFlexible = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
        const filtroNegativo = /Alerta de seguridad|Security Alert|Google|Verificación/i; 

        for (const message of messages) {
            const msgData = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
            const asunto = msgData.data.payload.headers.find(h => h.name === 'Subject')?.value || '';

            if (!filtroFlexible.test(asunto) || filtroNegativo.test(asunto)) continue;

            const cuerpoCompleto = extractBody(msgData.data.payload);
            const snippet = msgData.data.snippet || '';
            const adjuntos = await obtenerAdjuntos(gmail, message.id, msgData.data.payload);

            if (!cuerpoCompleto.trim() && !snippet.trim() && adjuntos.length === 0) continue;

            try {
                // ANÁLISIS MULTIMODAL
                const dataIA = await analizarCorreoConGemini(model, asunto, cuerpoCompleto, adjuntos);
                const reservas = dataIA.reservas || [];

                for (const reserva of reservas) {
                    const docRef = db.collection('reservas').doc();
                    batch.set(docRef, {
                        ...reserva,
                        origen_dato: 'Gmail Multimodal',
                        email_id: message.id,
                        estado: { 
                            principal: 'Revision', 
                            detalle: `Importado: ${asunto} ${adjuntos.length > 0 ? '(Con Adjuntos)' : ''}`, 
                            actualizado_en: new Date()
                        },
                        creadoEn: new Date()
                    });
                    totalReservasCreadas++;
                    contadorBatch++;
                }

                await gmail.users.messages.modify({ userId: 'me', id: message.id, requestBody: { removeLabelIds: ['UNREAD'] } });

                if (contadorBatch >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    contadorBatch = 0;
                }

            } catch (e) {
                console.error(`Error procesando mensaje ${message.id}:`, e);
            }
        }

        if (contadorBatch > 0) await batch.commit();

        return { message: `Procesados. Se encontraron ${totalReservasCreadas} reservas.` };

    } catch (error) {
        console.error("Error Gmail:", error);
        throw new HttpsError('internal', error.message);
    }
});

// ===================================================================================
// 2. CRON JOB (AUTOMÁTICO) - VERSIÓN MULTIMODAL CORREGIDA
// ===================================================================================
exports.chequearCorreosCron = onSchedule("every 15 minutes", async (event) => {
    console.log("⏰ Iniciando chequeo automático Multimodal...");

    if (!process.env.GMAIL_CLIENT_ID) return;

    const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const apiKey = process.env.GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
        const messages = res.data.messages;

        if (!messages || messages.length === 0) return;

        let totalReservas = 0;
        let batch = admin.firestore().batch();
        let contadorBatch = 0;
        
        const filtroFlexible = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
        const filtroNegativo = /Alerta de seguridad|Security Alert|Google|Verificación/i; 

        for (const message of messages) {
            const msgData = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
            const asunto = msgData.data.payload.headers.find(h => h.name === 'Subject')?.value || '';

            if (!filtroFlexible.test(asunto) || filtroNegativo.test(asunto)) continue;

            // 1. Extraer Texto
            const cuerpoCompleto = extractBody(msgData.data.payload);
            
            // 2. Extraer Adjuntos (ESTO FALTABA)
            const adjuntos = await obtenerAdjuntos(gmail, message.id, msgData.data.payload);

            if (!cuerpoCompleto.trim() && adjuntos.length === 0) continue;

            try {
                // 3. Análisis Multimodal (ESTO FALTABA)
                const dataIA = await analizarCorreoConGemini(model, asunto, cuerpoCompleto, adjuntos);
                const reservas = dataIA.reservas || [];

                for (const reserva of reservas) {
                    const docRef = db.collection('reservas').doc();
                    batch.set(docRef, {
                        ...reserva,
                        origen_dato: 'Gmail Cron',
                        email_id: message.id,
                        estado: { 
                            principal: 'Revision', 
                            detalle: `Auto Import: ${asunto} ${adjuntos.length > 0 ? '(Adj)' : ''}`, 
                            actualizado_en: new Date()
                        },
                        creadoEn: new Date()
                    });
                    totalReservas++;
                    contadorBatch++;
                }

                await gmail.users.messages.modify({ userId: 'me', id: message.id, requestBody: { removeLabelIds: ['UNREAD'] } });

                if (contadorBatch >= 400) {
                    await batch.commit();
                    batch = admin.firestore().batch();
                    contadorBatch = 0;
                }
            } catch (e) {
                console.error(`Error procesando ${message.id}`, e);
            }
        }

        if (contadorBatch > 0) await batch.commit();
        console.log(`🚀 Éxito Cron: ${totalReservas} reservas creadas.`);

    } catch (error) {
        console.error("🔥 Error Cron:", error);
    }
});

// ===================================================================================
// INTERPRETACIÓN MANUAL DE EXCEL/PDF (Para carga desde botón "Importar Excel/PDF")
// ===================================================================================

exports.interpretarExcelIA = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes estar logueado.');

    const { datosCrudos, fechaSeleccionada } = request.data; 
    if (!datosCrudos || datosCrudos.length === 0) return { reservas: [] };

    try {
        const apiKey = process.env.GEMINI_API_KEY; 
        if (!apiKey) throw new HttpsError('internal', "Falta API Key Gemini");
        
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
            Actúa como un operador de logística.
            Analiza esta lista de viajes y conviértela en JSON.
            Fecha Ref: ${fechaSeleccionada}.
            
            Reglas:
            - Devuelve SOLO un array JSON válido bajo la clave "reservas".
            - Datos a procesar: ${JSON.stringify(datosCrudos)}
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResponse = JSON.parse(text);
        
        return { reservas: jsonResponse.reservas || (Array.isArray(jsonResponse) ? jsonResponse : []) };

    } catch (error) {
        throw new HttpsError('internal', 'Error IA: ' + error.message);
    }
});

exports.interpretarPDFIA = onCall({ cors: true, timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Logueate primero.');

    const { pdfBase64, fechaSeleccionada } = request.data;
    if (!pdfBase64) throw new HttpsError('invalid-argument', 'Falta el PDF.');

    try {
        const apiKey = process.env.GEMINI_API_KEY; 
        if (!apiKey) throw new HttpsError('internal', "Falta API Key");
        
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
            Actúa como experto en logística. Analiza este PDF adjunto.
            Fecha Ref: ${fechaSeleccionada}.
            Extrae CADA viaje y devuélvelo en JSON bajo la clave "reservas".
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: pdfBase64, mimeType: "application/pdf" } }
        ]);

        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResponse = JSON.parse(text);

        return { reservas: jsonResponse.reservas || jsonResponse };

    } catch (error) {
        throw new HttpsError('internal', 'Error IA PDF: ' + error.message);
    }
});

// ===================================================================================
// 2. CRON JOB: CHEQUEO AUTOMÁTICO (CORREGIDO CON FILTRO FLEXIBLE)
// ===================================================================================
exports.chequearCorreosCron = onSchedule("every 15 minutes", async (event) => {
    console.log("⏰ Iniciando chequeo automático de Gmail...");

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

    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) return;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        // CAMBIO: Pedimos todo lo no leído
        const res = await gmail.users.messages.list({
            userId: 'me', 
            q: 'is:unread' 
        });

        const messages = res.data.messages;
        if (!messages || messages.length === 0) {
            console.log("✅ Chequeo finalizado: No hay correos nuevos.");
            return;
        }

        console.log(`📬 Se encontraron ${messages.length} correos. Filtrando...`);

        let procesados = 0;
        let batch = admin.firestore().batch();
        let contadorBatch = 0;
        const batchLimit = 400;
        
        // Mismos filtros que en la función manual
        const filtroFlexible = /R[eé]+s[eé]*r|V[ia]+je|P[eé]did|S[oó]lic|Aut[oó]ri|Traslad|RDT/i;
        const filtroNegativo = /Alerta de seguridad|Security Alert|Google|Verificación/i; 

        for (const message of messages) {
            const msgData = await gmail.users.messages.get({ 
                userId: 'me', 
                id: message.id,
                format: 'full' 
            });
            
            const asunto = msgData.data.payload.headers.find(h => h.name === 'Subject')?.value || '';

            // APLICAR FILTRO
            if (!filtroFlexible.test(asunto) || filtroNegativo.test(asunto)) {
                // Opcional: Console log para depurar si ignora algo que no debe
                // console.log(`Ignorando (Cron): ${asunto}`);
                continue; 
            }

            const cuerpoCompleto = extractBody(msgData.data.payload);
            const snippet = msgData.data.snippet || ''; 
            
            if (!cuerpoCompleto.trim() && !snippet.trim()) continue;

            const textoParaIA = `ASUNTO: ${asunto}\n\nCUERPO:\n${cuerpoCompleto.substring(0, 8000)}`;
            const prompt = `
                Actúa como operador de logística. Extrae datos de:
                """${textoParaIA}"""
                Fecha Ref: ${new Date().toISOString().split('T')[0]}
                Reglas: Devuelve JSON puro (fecha_turno, hora_turno, nombre_pasajero, telefono_pasajero, origen, destino, cliente, observaciones, siniestro, autorizacion).
            `;

            try {
                const result = await model.generateContent(prompt);
                const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                let reservaData = JSON.parse(responseText);
                if (Array.isArray(reservaData)) reservaData = reservaData[0];

                const docRef = db.collection('reservas').doc();
                batch.set(docRef, {
                    ...reservaData,
                    origen_dato: 'Gmail Automático',
                    email_id: message.id,
                    estado: { 
                        principal: 'Revision', 
                        detalle: `Importado Automático: ${asunto}`, 
                        actualizado_en: new Date()
                    },
                    creadoEn: new Date()
                });

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
            } catch (e) {
                console.error(`Error procesando mail ${message.id}`, e);
            }
        }

        if (contadorBatch > 0) await batch.commit();

        console.log(`🚀 Éxito: ${procesados} reservas importadas.`);

    } catch (error) {
        console.error("🔥 Error crítico en Cron Gmail:", error);
    }
});

// ===================================================================================
// 3. FUNCIÓN AUXILIAR (Debe estar al final del archivo)
// ===================================================================================
function extractBody(payload) {
    if (!payload) return "";
    let encodedBody = '';
    if (payload.body && payload.body.data) {
        encodedBody = payload.body.data;
    } else if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain') || 
                     payload.parts.find(p => p.mimeType === 'text/html') ||
                     payload.parts[0]; 
        if (part && part.body && part.body.data) {
            encodedBody = part.body.data;
        }
    }
    if (!encodedBody) return "";
    const buff = Buffer.from(encodedBody, 'base64url');
    return buff.toString('utf-8');
}