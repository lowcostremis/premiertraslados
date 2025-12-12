// test-ia.js (Diagnóstico de Modelos)
const API_KEY = "AIzaSyDM86eZFplsu9_NbdW5To_yy9NU7_4rru0"; // Tu clave nueva

async function verMenuDeGoogle() {
  console.log("📡 Preguntando a Google qué modelos me deja usar...");
  
  try {
    // Hacemos una petición directa sin usar la librería para evitar confusiones
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const data = await response.json();

    if (data.error) {
        console.error("❌ ERROR DE PERMISOS:", data.error.message);
        console.log("👉 SOLUCIÓN: Probablemente falte activar la API en la consola de Google.");
    } else if (data.models) {
        console.log("✅ ¡CONEXIÓN EXITOSA! Tu clave funciona.");
        console.log("📋 Estos son los modelos exactos que puedes usar (copia uno):");
        console.log("------------------------------------------------");
        data.models.forEach(m => {
            // Filtramos solo los 'gemini' para que sea legible
            if(m.name.includes('gemini')) {
                console.log(`🔹 ${m.name.replace('models/', '')}`);
            }
        });
        console.log("------------------------------------------------");
    } else {
        console.log("⚠️ Respuesta extraña:", data);
    }
  } catch (error) {
    console.error("❌ Error de conexión total:", error.message);
  }
}

verMenuDeGoogle();