// ===========================================================================
// IMPORTACIONES Y CONFIGURACIÓN MÍNIMA
// ===========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// Tu configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA5c2-7JR_bPXYu2FPg-ZVMsq-7NZrSSBk",
    authDomain: "premiertraslados-3f8e2.firebaseapp.com",
    projectId: "premiertraslados-3f8e2",
    storageBucket: "premiertraslados-3f8e2.appspot.com",
    messagingSenderId: "398178691975",
    appId: "1:398178691975:web:a4b2c8c19b998177ccce52"
};

// Inicialización
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const messageEl = document.getElementById('message');

// ===========================================================================
// LÓGICA DE LA PRUEBA
// ===========================================================================

// Registrar
document.getElementById('register-btn').addEventListener('click', () => {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    messageEl.textContent = 'Registrando...';
    createUserWithEmailAndPassword(auth, email, password)
        .then(userCredential => {
            messageEl.textContent = '¡Usuario registrado con éxito! Ahora intenta iniciar sesión.';
            console.log("Registro exitoso", userCredential);
        })
        .catch(error => {
            messageEl.textContent = 'Error de registro: ' + error.message;
            console.error("Error de registro", error);
        });
});

// Iniciar Sesión
document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    messageEl.textContent = 'Iniciando sesión...';
    signInWithEmailAndPassword(auth, email, password)
        .then(userCredential => {
            messageEl.textContent = '¡Login exitoso! Bienvenido ' + userCredential.user.email;
            console.log("Login exitoso", userCredential);
        })
        .catch(error => {
            messageEl.textContent = 'Error de login: ' + error.message;
            console.error("Error de login", error);
        });
});
