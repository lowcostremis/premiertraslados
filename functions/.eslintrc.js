module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "quotes": ["error", "double"],
    // AVISO: Las siguientes reglas se han desactivado para facilitar el desarrollo.
    "max-len": "off", // Desactiva la regla del largo máximo de línea.
    "indent": "off",  // Desactiva la regla de indentación estricta.
    "no-unused-vars": "warn", // Solo advierte sobre variables no usadas, no da error.
  },
};