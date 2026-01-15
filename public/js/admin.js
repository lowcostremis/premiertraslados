import { db, functions, choferesSearchIndex } from './firebase-config.js';


let cachesRef = {};
let adminListeners = [];

/**
 * Inicializa el módulo de administración.
 * @param {Object} caches - Objeto con los caches de la aplicación.
 * @param {string} selectId - El ID del elemento <select> que se va a rellenar.
 * @param {string|null} selectedId - El ID del móvil que debe aparecer preseleccionado.
 
 */
export function initAdmin(caches) {
    cachesRef = caches; 
    
    attachFormListeners();
    initializeAdminLists();

    
    poblarSelectDeMovilesAdmin('chofer-movil-select');

    const choferesSearchInput = document.getElementById('busqueda-choferes');
    if (choferesSearchInput) {
        choferesSearchInput.addEventListener('input', (e) => buscarEnChoferes(e.target.value));
    }
}

export async function editItem(collection, id) {
    let doc;
    // 1. Obtención del documento (Usuario vs Colección normal)
    if (collection === 'users') {
        const userDoc = await db.collection('users').doc(id).get();
        if (!userDoc.exists) { alert("Error: Usuario no encontrado."); return; }
        doc = { id: id, exists: true, data: () => ({ ...userDoc.data(), uid: id }) };
    } else {
        doc = await db.collection(collection).doc(id).get();
    }
    
    if (!doc.exists) { alert("Error: Item no encontrado."); return; }
    
    const data = doc.data();
    const form = document.getElementById('edit-form');
    form.innerHTML = '';
    form.dataset.collection = collection;
    form.dataset.id = id;

    // 2. Definimos campos obligatorios de facturación (incluyendo los nuevos)
    const camposFacturacion = [
        'paga_peaje', 'paga_negativos', 
        'precio_km', 'km_minimo', 'precio_minimo', 
        'espera_cortesia', 'espera_valor_hora', 'espera_fraccion', 
        'bajada_bandera'
    ];

    let fieldsToEdit = Object.keys(data);
    if (collection === 'clientes') {
        fieldsToEdit = [...new Set([...fieldsToEdit, ...camposFacturacion])];
    }

    // 3. ORDENAMIENTO VISUAL
    const ordenPreferido = [
        // Identidad (Nombre siempre primero)
        'nombre', 'email', 'dni', 'color',
        // Tarifas
        'bajada_bandera', 'precio_km', 'km_minimo', 'precio_minimo',
        // Esperas (Valor hora primero)
        'espera_valor_hora', 'espera_cortesia', 'espera_fraccion',
        // Configuración Extra
        'paga_peaje', 'paga_negativos',
        // Datos de Vehículo (si es chofer/movil)
        'movil_actual_id', 'marca', 'modelo', 'patente', 'numero'
    ];

    fieldsToEdit.sort((a, b) => {
        let indexA = ordenPreferido.indexOf(a);
        let indexB = ordenPreferido.indexOf(b);
        if (indexA === -1) indexA = 999; // Lo que no esté en la lista, va al fondo
        if (indexB === -1) indexB = 999;
        return indexA - indexB;
    });

    // 4. GENERACIÓN DE INPUTS
    fieldsToEdit.forEach(field => {
        // A. Filtros Globales (Campos técnicos que nunca se tocan)
        if (['creadoEn', 'auth_uid', 'coordenadas', 'fcm_token', 'uid', 'id', 'tarifas_fijas', 'espera_precio_min'].includes(field)) return;

        // B. FILTRO EXCLUSIVO CLIENTES: Ocultamos datos de contacto innecesarios
        if (collection === 'clientes' && ['cuit', 'domicilio', 'telefono'].includes(field)) return;

        // C. Creación del Label
        const label = document.createElement('label');
        if (field === 'espera_valor_hora') {
            label.textContent = "Valor Hora Espera ($)";
        } else {
            label.textContent = field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
        }
        form.appendChild(label);

        // D. Lógica de Inputs Específicos
        
        // --- Selectores Booleanos (Peaje y Negativos) ---
        if (field === 'paga_peaje') {
            const select = document.createElement('select');
            select.name = field;
            select.innerHTML = `
                <option value="false" ${data[field] === false ? 'selected' : ''}>NO (No paga)</option>
                <option value="true" ${data[field] === true ? 'selected' : ''}>SI (Paga Peajes)</option>
            `;
            form.appendChild(select);
        }
        else if (field === 'paga_negativos') {
            const select = document.createElement('select');
            select.name = field;
            select.innerHTML = `
                <option value="false" ${data[field] === false ? 'selected' : ''}>NO (No paga Negativos)</option>
                <option value="true" ${data[field] === true ? 'selected' : ''}>SI (Paga Negativos)</option>
            `;
            form.appendChild(select);
        }

        // --- Selector de Móviles (Solo Choferes) ---
        else if (field === 'movil_actual_id' && collection === 'choferes') {
            const select = document.createElement('select');
            select.name = field;
            select.id = 'edit-chofer-movil-select'; 
            form.appendChild(select);
            if (typeof poblarSelectDeMovilesAdmin === 'function') {
                poblarSelectDeMovilesAdmin('edit-chofer-movil-select', data[field]);
            }
        } 

        // --- Campos Numéricos (Precios y Facturación) ---
        else if (['precio_km', 'km_minimo', 'precio_minimo', 'espera_cortesia', 'espera_valor_hora', 'espera_fraccion', 'bajada_bandera'].includes(field)) {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = "0.01";
            input.name = field;
            input.value = data[field] !== undefined ? data[field] : 0;
            input.placeholder = "0.00";
            form.appendChild(input);
        }
        
        // --- Selector de Color ---
        else if (field === 'color') {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.name = field;
            colorInput.value = data[field] || '#ffffff';
            form.appendChild(colorInput);
        }
        
        // --- Texto General (Nombre, Email, etc) ---
        else {
            const input = document.createElement('input');
            input.name = field;
            input.value = Array.isArray(data[field]) ? data[field].join(', ') : (data[field] || '');
            if (['email', 'dni'].includes(field)) input.disabled = true; // Protegemos campos clave
            form.appendChild(input);
        }
    });

    // 5. BOTÓN ESPECIAL: GESTIÓN DE TARIFAS FIJAS (Solo Clientes)
    if (collection === 'clientes') {
        const btnTarifas = document.createElement('button');
        btnTarifas.type = 'button';
        btnTarifas.innerHTML = '💰 Gestionar Tarifas Fijas por Ruta';
        btnTarifas.style.cssText = "width:100%; margin-top:15px; margin-bottom:10px; background-color:#17a2b8; color:white; padding:10px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;";
        
        btnTarifas.onclick = async () => {
            const textoOriginal = btnTarifas.innerHTML;
            btnTarifas.textContent = '⏳ Cargando...';
            btnTarifas.disabled = true;
            try {
                // Leemos fresco de la DB para evitar caché vieja
                const docFresca = await db.collection('clientes').doc(id).get();
                const listaFresca = docFresca.data().tarifas_fijas || [];
                window.abrirModalTarifasFijas(id, data.nombre, listaFresca);
            } catch (e) {
                console.error(e);
                alert("Error al cargar tarifas.");
            } finally {
                btnTarifas.innerHTML = textoOriginal;
                btnTarifas.disabled = false;
            }
        };
        form.appendChild(btnTarifas);
    }

    // 6. Botón de Guardar
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Guardar Cambios';
    submitBtn.style.marginTop = '15px';
    submitBtn.style.backgroundColor = '#28a745';
    submitBtn.style.color = 'white';
    form.appendChild(submitBtn);
    
    document.getElementById('edit-modal-title').textContent = `Editar ${collection.slice(0, -1)}`;
    document.getElementById('edit-modal').style.display = 'block';
}

export async function deleteItem(collection, id, auth_uid = null) {
    const docName = collection.slice(0, -1);
    
    if (confirm(`¿Seguro que quieres borrar este ${docName}? Esta acción no se puede deshacer.`)) {
        try {
            if (collection === 'users') {
                alert("Borrar usuarios debe hacerse con una Cloud Function.");
                return;
            }

            if (collection === 'choferes' && auth_uid) {
                const borrarChofer = functions.httpsCallable('borrarChofer');
                const result = await borrarChofer({ dni: id, auth_uid: auth_uid });
                alert(result.data.message);
            } else {
                await db.collection(collection).doc(id).delete();
                alert(`${docName.charAt(0).toUpperCase() + docName.slice(1)} borrado.`);
            }
        } catch (error) {
            console.error(`Error al borrar:`, error);
            alert(`Error: ${error.message}`);
        }
    }
}

export function openResetPasswordModal(authUid, nombreChofer) {
    const modal = document.getElementById('reset-password-modal');
    document.getElementById('reset-chofer-uid').value = authUid;
    document.getElementById('reset-chofer-nombre').textContent = nombreChofer;
    document.getElementById('nueva-password').value = '';
    modal.style.display = 'block';
}

function poblarSelectDeMovilesAdmin(selectId, selectedId = null) {
     const selectElement = document.getElementById(selectId);
    if (!selectElement) {
        console.error(`No se encontró el elemento select con ID: ${selectId}`);
        return;
    }

    let optionsHTML = '<option value="">(Opcional) Asignar Móvil</option>';
    
    cachesRef.moviles.forEach(movil => {
        const isSelected = movil.id === selectedId ? 'selected' : '';
        
        optionsHTML += `<option value="${movil.id}" ${isSelected}>N° ${movil.numero} (${movil.patente || 'Sin Patente'})</option>`;
    });

    selectElement.innerHTML = optionsHTML;
}

function attachFormListeners() {
    const safeAddEventListener = (id, event, handler) => {
        const element = document.getElementById(id);
        if (element) { element.addEventListener(event, handler); }
    };
    
    safeAddEventListener('edit-form', 'submit', handleUpdateItem);
    safeAddEventListener('form-clientes', 'submit', handleSaveCliente);
    safeAddEventListener('form-pasajeros', 'submit', handleSavePasajero);
    safeAddEventListener('form-choferes', 'submit', handleSaveChofer);
    safeAddEventListener('form-moviles', 'submit', handleSaveMovil);
    safeAddEventListener('form-usuarios', 'submit', handleSaveUsuario);
    safeAddEventListener('form-zonas', 'submit', handleSaveZona);
    safeAddEventListener('reset-password-form', 'submit', handleResetPassword);
}

function initializeAdminLists() {
    renderAdminList('clientes', 'lista-clientes', ['nombre', 'cuit', 'telefono'], ['Nombre', 'CUIT', 'Teléfono']);
    renderAdminList('choferes', 'lista-choferes', ['dni', 'nombre', 'movil_actual_id', 'telefono', 'email', 'app_version'], ['DNI', 'Nombre', 'Móvil Asignado', 'Teléfono', 'Email de Acceso', 'Versión App']);
    renderAdminList('moviles', 'lista-moviles', ['numero', 'patente', 'marca', 'modelo'], ['N° Móvil', 'Patente', 'Marca', 'Modelo']);
    renderAdminList('zonas', 'lista-zonas', ['numero', 'descripcion'], ['Número', 'Descripción']);
    renderUsersList();
}

async function handleSaveCliente(e) {
    e.preventDefault();
    const f = e.target;
    const d = { nombre: f.nombre.value, cuit: f.cuit.value, domicilio: f.domicilio.value, telefono: f.telefono.value, color: f.color.value, creadoEn: firebase.firestore.FieldValue.serverTimestamp() };
    if (!d.nombre) { alert("Nombre es obligatorio."); return; }
    try {
        await db.collection('clientes').add(d);
        alert("Cliente guardado.");
        f.reset();
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

async function handleSavePasajero(e) {
    e.preventDefault();
    const f = e.target;
    const dni = f.dni.value.trim();
    if (!dni) { alert("DNI es obligatorio."); return; }

    // CAMBIO AQUI: En lugar de arrayUnion (sumar), creamos un array nuevo [valor].
    // Esto borra la lista "interminable" anterior y deja solo este domicilio como definitivo.
    const nuevoDomicilio = f.domicilio.value.trim();
    
    const d = { 
        nombre_apellido: f.nombre_apellido.value, 
        telefono: f.telefono.value, 
        // Si puso algo, lo guardamos como ÚNICO domicilio. Si no, array vacío.
        domicilios: nuevoDomicilio ? [nuevoDomicilio] : [] 
    };

    try {
        const pRef = db.collection('pasajeros').doc(dni);
        // Usamos set con merge: true para actualizar nombre/tel y pisar domicilios
        await pRef.set(d, { merge: true });
        alert("Pasajero guardado (Domicilio actualizado y limpiado).");
        f.reset();
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

async function handleSaveMovil(e) {
    e.preventDefault();
    const f = e.target;
    const d = {
        numero: parseInt(f.numero.value, 10),
        patente: f.patente.value,
        marca: f.marca.value,
        modelo: f.modelo.value,
        capacidad_pasajeros: f.capacidad_pasajeros.value,
        titular_nombre: f.titular_nombre.value,
        titular_domicilio: f.titular_domicilio.value,
        titular_telefono: f.titular_telefono.value
    };
    if (!d.numero || !d.patente) { alert("N° y patente son obligatorios."); return; }
    try {
        await db.collection('moviles').add(d);
        alert("Móvil guardado.");
        f.reset();
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

async function handleSaveUsuario(e) {
    e.preventDefault();
    const f = e.target;
    const n = f.nombre.value, em = f.email.value, p = f.password.value;
    if (!em || !p || !n) { alert("Todos los campos son obligatorios."); return; }
    try {
        const cuf = functions.httpsCallable('crearUsuario');
        const res = await cuf({ nombre: n, email: em, password: p });
        alert(res.data.result);
        f.reset();
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

async function handleSaveZona(e) {
    e.preventDefault();
    const f = e.target;
    const d = { numero: f.numero.value, descripcion: f.descripcion.value };
    if (!d.numero || !d.descripcion) { alert("Número y descripción son obligatorios."); return; }
    try {
        await db.collection('zonas').add(d);
        alert("Zona guardada.");
        f.reset();
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

async function handleSaveChofer(e) {
    e.preventDefault();
    const form = e.target;
    const choferData = {
        dni: form.dni.value,
        nombre: form.nombre.value,
        email: form.email.value,
        password: form.password.value,
        domicilio: form.domicilio.value,
        telefono: form.telefono.value,
        movil_actual_id: form.movil_actual_id.value || null
    };
    if (!choferData.dni || !choferData.nombre || !choferData.email || !choferData.password) {
        alert("DNI, Nombre, Email y Contraseña son obligatorios.");
        return;
    }
    if (choferData.password.length < 6) {
        alert("La contraseña debe tener al menos 6 caracteres.");
        return;
    }
    try {
        const crearChoferConAcceso = functions.httpsCallable('crearChoferConAcceso');
        const result = await crearChoferConAcceso(choferData);
        alert(result.data.message);
        form.reset();
    } catch (error) {
        console.error("Error al crear chofer:", error);
        alert("Error: " + error.message);
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const form = e.target;
    const auth_uid = form['reset-chofer-uid'].value;
    const nuevaPassword = form['nueva-password'].value;

    if (nuevaPassword.length < 6) {
        alert("La nueva contraseña debe tener al menos 6 caracteres.");
        return;
    }
    try {
        const resetearPasswordChofer = functions.httpsCallable('resetearPasswordChofer');
        const result = await resetearPasswordChofer({ auth_uid, nuevaPassword });
        alert(result.data.message);
        document.getElementById('reset-password-modal').style.display = 'none';
    } catch (error) {
        console.error("Error al resetear contraseña:", error);
        alert("Error: " + error.message);
    }
}

async function renderUsersList() {
    const c = document.getElementById('lista-usuarios');
    if (!c) return;
    try {
        const l = functions.httpsCallable('listUsers');
        const res = await l();
        const u = res.data.users;
        if (!u || u.length === 0) {
            c.innerHTML = '<p>No hay usuarios.</p>';
            return;
        }
        let h = `<div class="table-wrapper"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Acciones</th></tr></thead><tbody>`;
        const p = u.map(user => db.collection('users').doc(user.uid).get());
        const s = await Promise.all(p);
        const r = {};
        s.forEach(doc => {
            if (doc.exists) {
                r[doc.id] = doc.data().rol || 'operador';
            }
        });
        u.forEach(user => {
            h += `<tr><td>${user.nombre || '-'}</td><td>${user.email || '-'}</td><td>${r[user.uid] || 'N/A'}</td><td class="acciones"><button onclick="window.app.editItem('users','${user.uid}')">Editar</button><button class="btn-danger" onclick="window.app.deleteItem('users','${user.uid}')">Borrar</button></td></tr>`;
        });
        h += `</tbody></table></div>`;
        c.innerHTML = h;
    } catch (error) {
        console.error("Error al listar:", error);
        c.innerHTML = `<p style="color:red;">Error al cargar.</p>`;
    }
}

function renderAdminList(collectionName, containerId, fields, headers) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const orderByField = fields[0];

    const unsubscribe = db.collection(collectionName).orderBy(orderByField).onSnapshot(snapshot => {
        if (snapshot.empty) { container.innerHTML = '<p>No hay datos para mostrar.</p>'; return; }
        let tableHTML = `<div class="table-wrapper"><table><thead><tr>`;
        headers.forEach(header => tableHTML += `<th>${header}</th>`);
        tableHTML += `<th>Acciones</th></tr></thead><tbody>`;

        snapshot.forEach(doc => {
            const item = doc.data();
            tableHTML += `<tr>`;
            
            
            fields.forEach(field => {
                
                if (field === 'movil_actual_id' && collectionName === 'choferes') {
                    const movilId = item[field];
                    let movilDisplay = '-'; 
                    if (movilId && cachesRef.moviles) {
                        const movilAsignado = cachesRef.moviles.find(m => m.id === movilId);
                        if (movilAsignado) {
                            movilDisplay = `N° ${movilAsignado.numero}`;
                        }
                    }
                    tableHTML += `<td>${movilDisplay}</td>`;
                } 
                
                else if (field !== 'auth_uid') {
                    tableHTML += `<td>${item[field] || '-'}</td>`;
                }
            });
            

            let accionesHTML = `<button onclick="window.app.editItem('${collectionName}', '${doc.id}')">Editar</button>`;
            if (collectionName === 'choferes' && item.auth_uid) {
                accionesHTML += `<button onclick="window.app.openResetPasswordModal('${item.auth_uid}', '${item.nombre}')">Resetear Contraseña</button>`;
                accionesHTML += `<button class="btn-danger" onclick="window.app.deleteItem('${collectionName}', '${doc.id}', '${item.auth_uid}')">Borrar</button>`;
            } else {
                accionesHTML += `<button class="btn-danger" onclick="window.app.deleteItem('${collectionName}', '${doc.id}')">Borrar</button>`;
            }
            tableHTML += `<td class="acciones">${accionesHTML}</td></tr>`;
        });
        tableHTML += `</tbody></table></div>`;
        container.innerHTML = tableHTML;
    }, err => console.error(`Error cargando ${collectionName}:`, err));
    adminListeners.push(unsubscribe);
}

function renderChoferesTable(documentos) {
 const container = document.getElementById('lista-choferes');
    if (!container) return;

    if (!documentos || documentos.length === 0) {
        container.innerHTML = '<p>No se encontraron choferes con ese criterio.</p>';
        return;
    }

    
    let tableHTML = `<div class="table-wrapper"><table><thead><tr>
        <th>DNI</th>
        <th>Nombre</th>
        <th>Móvil Asignado</th>
        <th>Teléfono</th>
        <th>Email de Acceso</th>
        <th>Versión App</th>
        <th>Acciones</th></tr></thead><tbody>`;

    documentos.forEach(item => {
        const movilId = item.movil_actual_id;
        let movilDisplay = '-';
        if (movilId && cachesRef.moviles) {
            const movilAsignado = cachesRef.moviles.find(m => m.id === movilId);
            if (movilAsignado) {
                movilDisplay = `N° ${movilAsignado.numero}`;
            }
        }

        tableHTML += `<tr>
            <td>${item.dni || '-'}</td>
            <td>${item.nombre || '-'}</td>
            <td>${movilDisplay}</td>
            <td>${item.telefono || '-'}</td>
            <td>${item.email || '-'}</td>
            <td>${item.app_version || '-'}</td>
            <td class="acciones">
                <button onclick="window.app.editItem('choferes', '${item.objectID}')">Editar</button>
                <button onclick="window.app.openResetPasswordModal('${item.auth_uid}', '${item.nombre}')">Resetear Contraseña</button>
                <button class="btn-danger" onclick="window.app.deleteItem('choferes', '${item.objectID}', '${item.auth_uid}')">Borrar</button>
            </td>
        </tr>`;
    });

    tableHTML += `</tbody></table></div>`;
    container.innerHTML = tableHTML;
}


async function buscarEnChoferes(texto) {
    
    if (!texto || texto.trim() === '') {
        
        adminListeners.forEach(unsubscribe => unsubscribe());
        adminListeners = [];
        
        renderAdminList('choferes', 'lista-choferes', ['dni', 'nombre', 'movil_actual_id', 'telefono', 'email', 'app_version'], ['DNI', 'Nombre', 'Móvil Asignado', 'Teléfono', 'Email de Acceso', 'Versión App']);
        return;
    }

     adminListeners.forEach(unsubscribe => unsubscribe());
    adminListeners = []; 

    try {
        
        const resultados = await choferesSearchIndex.search(texto);
        
        
        const documentos = resultados.hits.map(hit => ({ ...hit, id: hit.objectID }));

        
        renderChoferesTable(documentos);

    } catch (error) {
        console.error("Error al buscar en choferes:", error);
        const container = document.getElementById('lista-choferes');
        container.innerHTML = `<p style="color:red;">Error al realizar la búsqueda.</p>`;
    }
}


async function handleUpdateItem(e) {
   e.preventDefault();
    const form = e.target;
    const collection = form.dataset.collection;
    const originalId = form.dataset.id; 
    const updatedData = {};
    const formData = new FormData(form);

    for (let [key, value] of formData.entries()) {
        if (form.querySelector(`[name="${key}"]`) && form.querySelector(`[name="${key}"]`).disabled) continue;
        
        
        if (key === 'domicilios') {
            updatedData[key] = value.split(',').map(domicilio => domicilio.trim());
        } 

        else if (key === 'paga_peaje' || key === 'paga_negativos') {
            updatedData[key] = (value === 'true');
        }

        else if (['precio_km', 'km_minimo', 'precio_minimo', 'espera_cortesia', 'espera_valor_hora', 'espera_fraccion', 'bajada_bandera'].includes(key)) {
            updatedData[key] = parseFloat(value) || 0;
        }

        else {
            updatedData[key] = value;
        }
        
    }

    try {
        
        if (collection === 'choferes' && updatedData.dni && updatedData.dni !== originalId) {
            await db.runTransaction(async (transaction) => {
                const oldDocRef = db.collection('choferes').doc(originalId);
                const oldDoc = await transaction.get(oldDocRef);
                if (!oldDoc.exists) throw "El chofer original no fue encontrado.";
                const newData = { ...oldDoc.data(), ...updatedData };
                const newDocRef = db.collection('choferes').doc(updatedData.dni);
                transaction.set(newDocRef, newData); 
                transaction.delete(oldDocRef);
            });
        } else if (collection === 'choferes' && updatedData.movil_actual_id !== undefined) {
            const batch = db.batch();
            const choferRef = db.collection('choferes').doc(originalId);
            const nuevoMovilId = updatedData.movil_actual_id || null;
            
            if (nuevoMovilId) {
                const q = db.collection('choferes').where('movil_actual_id', '==', nuevoMovilId);
                const snapshot = await q.get();
                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        if (doc.id !== originalId) {
                            batch.update(db.collection('choferes').doc(doc.id), { movil_actual_id: null });
                        }
                    });
                }
            }
            batch.update(choferRef, updatedData);
            await batch.commit();
        } else {
            
            await db.collection(collection).doc(originalId).update(updatedData);
        }
        
        alert("Datos guardados correctamente.");
        document.getElementById('edit-modal').style.display = 'none';
    } catch (error) {
        console.error("Error al actualizar:", error);
        alert("Error al guardar: " + error.message);
    }
}


let clienteIdEditandoTarifas = null;
let indiceEdicion = -1;


window.abrirModalTarifasFijas = function(id, nombre, lista) {
    clienteIdEditandoTarifas = id;
    indiceEdicion = -1; // Reseteamos modo edición
    resetearFormularioTarifas();
    
    const titulo = document.getElementById('titulo-cliente-fijo');
    if (titulo) titulo.textContent = nombre;
    
    document.getElementById('modal-tarifas-fijas').style.display = 'block';
    renderizarTablaTarifas(lista);
}


// BUSCAR Y REEMPLAZAR ESTAS FUNCIONES:

function resetearFormularioTarifas() {
    document.getElementById('tf-origen').value = '';
    document.getElementById('tf-destino').value = '';
    document.getElementById('tf-precio').value = '';
    document.getElementById('tf-peaje').value = ''; // NUEVO: Resetear peaje
    
    const btn = document.querySelector('#modal-tarifas-fijas button[onclick*="window.agregarTarifaFija"]');
    if (btn) {
        btn.textContent = '➕';
        btn.style.backgroundColor = '#28a745'; 
    }
    indiceEdicion = -1;
}

function renderizarTablaTarifas(lista) {
    const tbody = document.getElementById('body-tarifas-fijas');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!lista || lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:10px;">Sin tarifas fijas asignadas.</td></tr>';
        return;
    }

    lista.forEach((item, index) => {
        const peajeValor = parseFloat(item.peaje || 0); // Leemos el peaje (0 si no existe)
        
        const row = `
            <tr>
                <td>${item.origen}</td>
                <td>${item.destino}</td>
                <td style="font-weight:bold; color:#28a745;">$ ${parseFloat(item.precio).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                <td style="font-weight:bold; color:#666;">$ ${peajeValor.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                <td>
                    <button onclick="window.prepararEdicionTarifa(${index})" style="background:#ffc107; color:black; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; margin-right:5px;" title="Editar">✏️</button>
                    <button onclick="window.borrarTarifaFija(${index})" style="background:#dc3545; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Borrar">🗑️</button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

window.prepararEdicionTarifa = async function(index) {
    try {
        const doc = await db.collection('clientes').doc(clienteIdEditandoTarifas).get();
        const lista = doc.data().tarifas_fijas || [];
        const item = lista[index];

        if (!item) return;

        document.getElementById('tf-origen').value = item.origen;
        document.getElementById('tf-destino').value = item.destino;
        document.getElementById('tf-precio').value = item.precio;
        document.getElementById('tf-peaje').value = item.peaje || 0; // Cargar peaje

        indiceEdicion = index;
        
        const btn = document.querySelector('#modal-tarifas-fijas button[onclick*="window.agregarTarifaFija"]');
        btn.textContent = '💾';
        btn.style.backgroundColor = '#007bff'; 
        document.getElementById('tf-precio').focus(); 

    } catch (e) { console.error(e); }
}

window.agregarTarifaFija = async function() {
    const origenInput = document.getElementById('tf-origen');
    const destinoInput = document.getElementById('tf-destino');
    const precioInput = document.getElementById('tf-precio');
    const peajeInput = document.getElementById('tf-peaje'); // NUEVO

    const origen = origenInput.value.trim();
    const destino = destinoInput.value.trim();
    const precio = parseFloat(precioInput.value);
    const peaje = parseFloat(peajeInput.value) || 0; // NUEVO: Valor por defecto 0

    if (!origen || !destino || isNaN(precio)) { // Validamos precio, peaje es opcional
        return alert("Por favor, completá Origen, Destino y Precio.");
    }

    try {
        const docRef = db.collection('clientes').doc(clienteIdEditandoTarifas);
        const docSnap = await docRef.get();
        let lista = docSnap.data().tarifas_fijas || [];

        const nuevoItem = { origen, destino, precio, peaje }; // Guardamos peaje

        if (indiceEdicion >= 0) {
            lista[indiceEdicion] = nuevoItem;
        } else {
            lista.push(nuevoItem);
        }

        await docRef.update({ tarifas_fijas: lista });
        resetearFormularioTarifas();
        renderizarTablaTarifas(lista);
        
    } catch (e) {
        console.error(e);
        alert("Error al guardar tarifa: " + e.message);
    }
}



// 3. Función de Borrado (Actualizada para lista completa)
window.borrarTarifaFija = async function(index) {
    if(!confirm("¿Borrar esta tarifa fija?")) return;
    
    try {
        const docRef = db.collection('clientes').doc(clienteIdEditandoTarifas);
        const docSnap = await docRef.get();
        let lista = docSnap.data().tarifas_fijas || [];
        
        // Eliminamos el elemento por su índice
        lista.splice(index, 1);
        
        // Guardamos el array actualizado
        await docRef.update({ tarifas_fijas: lista });
        
        // Si estábamos editando justo el que borramos, reseteamos form
        if (indiceEdicion === index) resetearFormularioTarifas();
        
        renderizarTablaTarifas(lista);
        
    } catch (e) {
        alert("Error al borrar: " + e.message);
    }
}