import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vaani_setu/screens/incoming_call_screen.dart';
import 'package:vaani_setu/services/call_service.dart';
import 'package:vaani_setu/services/incoming_call_presenter.dart';

VaaniCall invitation({String recipient = 'receiver', bool expired = false}) =>
    VaaniCall(
      id: 'incoming-test',
      callerUid: 'caller',
      calleeUid: recipient,
      callerNumber: '020900',
      calleeNumber: '020902',
      status: 'ringing',
      callerLanguage: 'en',
      calleeLanguage: 'hi',
      expiresAt: DateTime.now()
          .add(Duration(minutes: expired ? -1 : 1))
          .toIso8601String(),
    );

void main() {
  testWidgets(
    'an incoming call schedules a frame on an idle screen and deduplicates delivery',
    (tester) async {
      final key = GlobalKey<NavigatorState>();
      final presenter = IncomingCallPresenter(key, () => 'receiver');
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: key,
          home: const Scaffold(body: Text('Dialer')),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.binding.hasScheduledFrame, isFalse);
      final call = invitation();
      expect(presenter.show(call), isTrue);
      expect(tester.binding.hasScheduledFrame, isTrue);
      expect(presenter.show(call), isTrue);
      await tester.pumpAndSettle();
      expect(find.byType(IncomingCallScreen), findsOneWidget);
      expect(find.text('020900'), findsOneWidget);
      key.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.text('Dialer'), findsOneWidget);
      expect(find.byType(IncomingCallScreen), findsNothing);
    },
  );

  testWidgets(
    'expired, wrong-recipient and signed-out invitations are not presented',
    (tester) async {
      final key = GlobalKey<NavigatorState>();
      String? uid = 'receiver';
      final presenter = IncomingCallPresenter(key, () => uid);
      await tester.pumpWidget(
        MaterialApp(navigatorKey: key, home: const Scaffold()),
      );
      await tester.pumpAndSettle();
      expect(presenter.show(invitation(expired: true)), isFalse);
      expect(presenter.show(invitation(recipient: 'someone-else')), isFalse);
      expect(presenter.show(invitation()), isTrue);
      uid = null; // Sign-out between the socket event and navigation frame.
      await tester.pumpAndSettle();
      expect(find.byType(IncomingCallScreen), findsNothing);
      expect(presenter.show(invitation()), isFalse);
    },
  );
}
