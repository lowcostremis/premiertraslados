// js/tabs.js

export function openTab(evt, tabName, callbacks) { 
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = "none"); 
    document.querySelectorAll('.tab-link').forEach(link => link.classList.remove('active')); 
    
    const tabElement = document.getElementById(tabName);
    if(tabElement) tabElement.style.display = "block";

    const activeLink = evt ? evt.currentTarget : document.querySelector(`.tab-link[onclick*="'${tabName}'"]`); 
    if(activeLink) activeLink.classList.add('active'); 

    // --- NUEVA LÓGICA PARA EL PANEL DE ASIGNACIÓN ---
    const panel = document.getElementById('multi-select-panel');
    if (panel) {
        // Si entramos a Historico, Administración o Pasajeros, ocultamos y limpiamos
        if (tabName !== 'Reservas' && tabName !== 'Mapa') {
            panel.style.display = 'none';
            if (window.app && window.app.limpiarSeleccion) {
                window.app.limpiarSeleccion();
            }
        }
    }
    if (tabName === 'Mapa') {
        if(callbacks.initMapInstance) callbacks.initMapInstance();
        if(callbacks.escucharUbicacionChoferes) callbacks.escucharUbicacionChoferes();
        if(callbacks.cargarMarcadoresDeReservas) callbacks.cargarMarcadoresDeReservas();
    }
    if (tabName === 'Historico') { 
        if(callbacks.cargarHistorial) callbacks.cargarHistorial(); 
    } 
    if (tabName === 'Pasajeros') { 
        if(callbacks.cargarPasajeros) callbacks.cargarPasajeros();
    } 
}

export function showReservasTab(tabName) { 
    document.querySelectorAll('.reservas-container').forEach(c => c.style.display = 'none'); 
    const el = document.getElementById(`reservas-${tabName}`);
    if(el) el.style.display = 'block';

    document.querySelectorAll('#Reservas .sub-tab-btn').forEach(btn => btn.classList.remove('active')); 
    const activeBtn = document.querySelector(`#Reservas .sub-tab-btn[data-tab="${tabName}"]`);
    if(activeBtn) activeBtn.classList.add('active'); 
}

export function openAdminTab(evt, adminTabName) {
  document.querySelectorAll('.admin-tab-content').forEach(tab => {
    tab.style.display = 'none';
  });

  document.querySelectorAll('#Administracion .sub-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(adminTabName).style.display = 'block';
  evt.currentTarget.classList.add('active');
}