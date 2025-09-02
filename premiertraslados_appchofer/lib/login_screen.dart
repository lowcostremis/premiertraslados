import 'package:flutter/material.dart';

// 1. Convertimos la clase a un StatefulWidget
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  // 2. Creamos los "controladores" para leer el texto de los campos
  final _dniController = TextEditingController();
  final _movilController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inicio de Sesión - Choferes'),
        backgroundColor: Colors.blueGrey[900],
        foregroundColor: Colors.white,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Campo de texto para el DNI
            TextField(
              controller: _dniController, // 3. Asignamos el controlador
              decoration: InputDecoration(
                labelText: 'DNI del Chofer',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.person),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 20),

            // Campo de texto para el Móvil
            TextField(
              controller: _movilController, // 3. Asignamos el controlador
              decoration: InputDecoration(
                labelText: 'Número de Móvil',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.directions_car),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 30),

            // Botón de Ingresar
            ElevatedButton(
              onPressed: () {
                // 4. Ahora podemos leer el texto y mostrarlo en la consola
                final dni = _dniController.text;
                final movil = _movilController.text;

                print('DNI Ingresado: $dni');
                print('Móvil Ingresado: $movil');

                // TODO: Aquí irá la lógica para validar el login con Firebase
              },
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 50),
                backgroundColor: Colors.blueGrey[800],
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: const Text('Ingresar', style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
      ),
    );
  }
}
