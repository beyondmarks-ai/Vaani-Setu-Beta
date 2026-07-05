import 'package:flutter_test/flutter_test.dart';

import 'package:vaani_setu/main.dart';

void main() {
  testWidgets('dialer accepts digits', (WidgetTester tester) async {
    await tester.pumpWidget(const VaaniSetuApp());

    expect(find.text('Vaani Setu'), findsOneWidget);
    expect(find.text('Enter phone number'), findsOneWidget);

    await tester.tap(find.text('1'));
    await tester.tap(find.text('2'));
    await tester.tap(find.text('3'));
    await tester.pump();

    expect(find.text('123'), findsOneWidget);
  });
}
