import 'package:flutter/material.dart';
import 'package:premiertraslados_appchofer/login_screen.dart'; // Importamos nuestro nuevo archivo

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Premier Traslados Chofer',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home:
          const LoginScreen(), // Aquí le decimos que empiece en la pantalla de login
    );
  }
}
