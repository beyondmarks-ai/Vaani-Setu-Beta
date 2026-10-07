import 'package:flutter_test/flutter_test.dart';

import 'package:flutter/material.dart';
import 'package:vaani_setu/screens/login_screen.dart';

void main() {
  testWidgets('login screen switches to account creation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));

    expect(find.text('Vaani Setu'), findsOneWidget);
    expect(find.text('Sign in to continue'), findsOneWidget);

    await tester.tap(find.text('New user? Create account'));
    await tester.pump();

    expect(find.text('Create your account'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
  });
}
