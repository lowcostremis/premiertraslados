// js/admin.js

import { db, functions, choferesSearchIndex } from './firebase-config.js';

// Guardamos una referencia al objeto de caches completo.
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

    if (collection === 'pasajeros') {
        const dniLabel = document.createElement('label');
        dniLabel.textContent = 'DNI';
        form.appendChild(dniLabel);

        const dniInput = document.createElement('input');
        dniInput.name = 'dni';
        dniInput.value = id; 
        dniInput.disabled = true; 
        form.appendChild(dniInput);
    }   

    const fieldsToEdit = Object.keys(data);
    fieldsToEdit.forEach(field => {
        // ▼▼▼ ¡AQUÍ ESTÁ LA MODIFICACIÓN! ▼▼▼
        if (['creadoEn', 'auth_uid', 'coordenadas', 'fcm_token'].includes(field)) return;
        
        const label = document.createElement('label');
        label.textContent = field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
        form.appendChild(label);

       if (field === 'movil_actual_id' && collection === 'choferes') {
            const select = document.createElement('select');
            select.name = field;
            select.id = 'edit-chofer-movil-select'; 
            form.appendChild(select);
            poblarSelectDeMovilesAdmin('edit-chofer-movil-select', data[field]);
        } 
        else if (field === 'color' && data.color !== undefined) {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.name = field;
            colorInput.value = data[field];
            form.appendChild(colorInput);
        } else {
            const input = document.createElement('input');
            input.name = field;
            
            input.value = Array.isArray(data[field]) ? data[field].join(', ') : (data[field] || '');
            if (['uid', 'email'].includes(field)) {
                input.disabled = true;
            }
            form.appendChild(input);
        }
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Guardar Cambios';
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
        // CORREGIDO: Se cambió 'patente' por 'patente'
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
    const d = { nombre_apellido: f.nombre_apellido.value, telefono: f.telefono.value, domicilios: firebase.firestore.FieldValue.arrayUnion(f.domicilio.value) };
    try {
        const pRef = db.collection('pasajeros').doc(dni);
        await pRef.set(d, { merge: true });
        alert("Pasajero guardado.");
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
            
            // ▼▼▼ LÓGICA MODIFICADA ▼▼▼
            fields.forEach(field => {
                // Si el campo es 'movil_actual_id', buscamos el móvil en la caché para mostrar su número.
                if (field === 'movil_actual_id' && collectionName === 'choferes') {
                    const movilId = item[field];
                    let movilDisplay = '-'; // Valor por defecto si no tiene móvil
                    if (movilId && cachesRef.moviles) {
                        const movilAsignado = cachesRef.moviles.find(m => m.id === movilId);
                        if (movilAsignado) {
                            movilDisplay = `N° ${movilAsignado.numero}`;
                        }
                    }
                    tableHTML += `<td>${movilDisplay}</td>`;
                } 
                // Para todos los demás campos, usamos la lógica que ya existía.
                else if (field !== 'auth_uid') {
                    tableHTML += `<td>${item[field] || '-'}</td>`;
                }
            });
            // ▲▲▲ FIN DE LA MODIFICACIÓN ▲▲▲

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
    // ...
}

async function buscarEnChoferes(texto) {
    // ...
}

async function handleUpdateItem(e) {
   e.preventDefault();
    const form = e.target;
    const collection = form.dataset.collection;
    const originalId = form.dataset.id; // El DNI original
    const updatedData = {};
    const formData = new FormData(form);

    for (let [key, value] of formData.entries()) {
        if (form.querySelector(`[name="${key}"]`) && form.querySelector(`[name="${key}"]`).disabled) continue;
        
        if (key === 'domicilios') {
            updatedData[key] = value.split(',').map(domicilio => domicilio.trim());
        } else {
            updatedData[key] = value;
        }
    }

    try {
        // --- INICIO DE LA LÓGICA MEJORADA ---
        
        // Caso especial: se está editando un chofer y el DNI (ID) ha cambiado.
        if (collection === 'choferes' && updatedData.dni && updatedData.dni !== originalId) {
            const nuevoDni = updatedData.dni;
            
            // Usamos una transacción para asegurar que la operación sea atómica
            await db.runTransaction(async (transaction) => {
                const oldDocRef = db.collection('choferes').doc(originalId);
                const oldDoc = await transaction.get(oldDocRef);

                if (!oldDoc.exists) {
                    throw "El chofer original no fue encontrado.";
                }

                // Creamos una copia de los datos viejos y los mezclamos con los nuevos
                const newData = { ...oldDoc.data(), ...updatedData };

                const newDocRef = db.collection('choferes').doc(nuevoDni);
                transaction.set(newDocRef, newData); // 1. Crea el nuevo documento
                transaction.delete(oldDocRef);      // 2. Borra el antiguo
            });

        } else if (collection === 'choferes' && updatedData.movil_actual_id !== undefined) {
            // Lógica para reasignar móviles si solo cambia el móvil pero no el DNI
            const batch = db.batch();
            const choferRef = db.collection('choferes').doc(originalId);

            const nuevoMovilId = updatedData.movil_actual_id || null;
            if (nuevoMovilId) {
                const q = db.collection('choferes').where('movil_actual_id', '==', nuevoMovilId);
                const snapshot = await q.get();
                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        if (doc.id !== originalId) {
                            const otroChoferRef = db.collection('choferes').doc(doc.id);
                            batch.update(otroChoferRef, { movil_actual_id: null });
                        }
                    });
                }
            }
            batch.update(choferRef, updatedData);
            await batch.commit();
        } else {
            // Para todas las demás colecciones, o si el DNI del chofer no cambió
            await db.collection(collection).doc(originalId).update(updatedData);
        }
        // --- FIN DE LA LÓGICA MEJORADA ---
        
        alert("Item actualizado.");
        document.getElementById('edit-modal').style.display = 'none';
    } catch (error) {
        console.error("Error al actualizar:", error);
        alert("Error al guardar: " + error.message);
    }
}