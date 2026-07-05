import 'package:flutter/material.dart';

import 'screens/dialer.dart';

void main() {
  runApp(const VaaniSetuApp());
}

class VaaniSetuApp extends StatelessWidget {
  const VaaniSetuApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Vaani Setu',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F766E),
        ),
        useMaterial3: true,
      ),
      home: const DialerScreen(),
    );
  }
}
