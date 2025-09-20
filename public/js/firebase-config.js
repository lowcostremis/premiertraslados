// js/firebase-config.js

// 1. CONFIGURACIÓN DE FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyA5c2-7JR_bPXYu2FPg-ZVMsq-7NZrSSBk",
    authDomain: "premiertraslados-31ee2.firebaseapp.com",
    projectId: "premiertraslados-31ee2",
    storageBucket: "premiertraslados-31ee2.appspot.com",
    messagingSenderId: "398176651975",
    appId: "1:398176651975:web:ab2bc9ab16da98c77ccce2"
};

// 2. INICIALIZACIÓN DE SERVICIOS
firebase.initializeApp(firebaseConfig);

// 3. EXPORTACIÓN DE CONSTANTES
export const auth = firebase.auth();
export const db = firebase.firestore();
export const functions = firebase.functions();

// 4. INICIALIZACIÓN Y EXPORTACIÓN DE ALGOLIA
export const searchClient = algoliasearch('GOATTC1A5K', 'c2d6dbf6e25ca6507079dc12c95ddc69');
export const pasajerosSearchIndex = searchClient.initIndex('pasajeros');
export const historicoSearchIndex = searchClient.initIndex('historico');
export const reservasSearchIndex = searchClient.initIndex('reservas');
export const choferesSearchIndex = searchClient.initIndex('choferes');