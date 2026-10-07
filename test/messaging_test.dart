import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vaani_setu/screens/chat_screen.dart';
import 'package:vaani_setu/screens/history_screen.dart';
import 'package:vaani_setu/services/history_service.dart';
import 'package:vaani_setu/services/user_profile.dart';

const profile = UserNumberProfile(
  uid: 'alice',
  email: 'alice@test.local',
  suffix: '00',
  number: '020900',
  spokenLanguage: 'hi',
  listenLanguage: 'hi',
  preferredVoice: 'simran',
  messageLanguage: 'hi',
);

HistoryItem incoming(String id) => {
  'messageId': id,
  'senderUid': 'bob',
  'recipientUid': 'alice',
  'senderNumber': '020901',
  'recipientNumber': '020900',
  'originalText': 'Hello $id',
  'translatedText': 'नमस्ते $id',
  'sourceLanguage': 'en',
  'targetLanguage': 'hi',
  'createdAt': '2026-10-07T12:00:00.000Z',
};

class FakeHistory extends HistoryService {
  final items = <HistoryItem>[];
  final attempts = <HistoryItem>[];
  bool failSend = false;
  bool failLoad = false;
  String? reading;
  String? style;
  bool failPreference = false;
  UserNumberProfile? savedProfile;

  @override
  UserNumberProfile? get currentProfile => savedProfile;
  String? cursor;
  List<HistoryItem> older = [];

  @override
  Future<HistoryPage> messages(String suffix, {String? before}) async {
    if (failLoad) throw StateError('Connection lost');
    return HistoryPage.fromMap({
      'items': before == null ? List.of(items) : older,
      'nextCursor': before == null ? cursor : null,
    });
  }

  @override
  Future<HistoryItem> send({
    required String suffix,
    required String text,
    required String sourceLanguage,
    required String messageId,
  }) async {
    attempts.add({
      'id': messageId,
      'text': text,
      'source': sourceLanguage,
      'suffix': suffix,
    });
    if (failSend) throw StateError('Translation unavailable. Please retry.');
    return {
      'messageId': messageId,
      'senderUid': 'alice',
      'recipientUid': 'bob',
      'originalText': text,
      'translatedText': 'Translated $text',
      'sourceLanguage': sourceLanguage,
      'targetLanguage': 'en',
      'createdAt': '2026-10-07T13:00:00.000Z',
    };
  }

  @override
  Future<void> setReadingLanguage(String language) async {
    reading = language;
  }

  @override
  Future<void> setTranslationStyle(String language, String value) async {
    if (failPreference) throw StateError('Could not save preference');
    reading = language;
    style = value;
  }

  @override
  Future<List<HistoryItem>> conversations() async => items.isEmpty
      ? []
      : [
          {'remoteNumber': '020901', 'message': items.last},
        ];

  @override
  Future<HistoryPage> calls({String? before}) async => HistoryPage.fromMap({
    'items': [
      {
        'callId': 'call-1',
        'remoteNumber': '020901',
        'direction': 'incoming',
        'outcome': 'missed',
        'durationSeconds': 0,
        'createdAt': '2026-10-07T12:00:00.000Z',
      },
      {
        'callId': 'call-2',
        'remoteNumber': '020902',
        'direction': 'outgoing',
        'outcome': 'completed',
        'durationSeconds': 65,
        'createdAt': '2026-10-07T11:00:00.000Z',
      },
    ],
    'nextCursor': null,
  });
}

void main() {
  testWidgets(
    'new conversation validates own number and accepts two-digit suffix',
    (tester) async {
      final service = FakeHistory();
      await tester.pumpWidget(
        MaterialApp(
          home: HistoryScreen(profile: profile, service: service),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('New message'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), '00');
      await tester.tap(find.text('Open chat'));
      await tester.pumpAndSettle();
      expect(find.text('Enter another user’s number'), findsOneWidget);
      await tester.enterText(find.byType(TextFormField), '01');
      await tester.tap(find.text('Open chat'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.byType(ChatScreen), findsOneWidget);
      expect(find.text('020901'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'incoming translation, original, and automatic refresh are visible',
    (tester) async {
      final service = FakeHistory()..items.add(incoming('one'));
      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            profile: profile,
            remoteNumber: '020901',
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('नमस्ते one'), findsOneWidget);
      await tester.tap(find.text('View original'));
      await tester.pumpAndSettle();
      expect(find.text('Hello one'), findsOneWidget);
      service.items.add(incoming('two'));
      HistoryService.changes.add(null);
      await tester.pumpAndSettle();
      expect(find.text('नमस्ते two'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'send preserves failed draft and retries with same id, then clears it',
    (tester) async {
      final service = FakeHistory()..failSend = true;
      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            profile: profile,
            remoteNumber: '020901',
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (widget) =>
                    widget is IconButton && widget.tooltip == 'Send message',
              ),
            )
            .onPressed,
        isNull,
      );
      await tester.enterText(find.byType(TextField), 'नमस्ते');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(
        find.text('Translation unavailable. Please retry.'),
        findsOneWidget,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'नमस्ते',
      );
      service.failSend = false;
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(service.attempts.length, 2);
      expect(service.attempts[0]['id'], service.attempts[1]['id']);
      expect(service.attempts.last['source'], 'hi');
      expect(service.attempts.last['suffix'], '01');
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '',
      );
      expect(find.text('Translated to English (India)'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('user can select writing and reading languages independently', (
    tester,
  ) async {
    final service = FakeHistory();
    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          profile: profile,
          remoteNumber: '020901',
          service: service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('English (India)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('English (India)').last);
    await tester.pumpAndSettle();
    expect(service.reading, 'en');
    await tester.tap(find.byType(DropdownButtonFormField<String>).last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Bengali').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bengali').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'হ্যালো');
    await tester.pump();
    await tester.tap(find.byTooltip('Send message'));
    await tester.pumpAndSettle();
    expect(service.attempts.last['source'], 'bn');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('chat loads older history and recovers a failed history request', (
    tester,
  ) async {
    final service = FakeHistory()
      ..failLoad = true
      ..cursor = 'older'
      ..older = [incoming('old')];
    await tester.pumpWidget(
      MaterialApp(
        home: ChatScreen(
          profile: profile,
          remoteNumber: '020901',
          service: service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connection lost'), findsOneWidget);
    service.failLoad = false;
    service.items.add(incoming('new'));
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    // A successful retry must expose older history even after the first load failed.
    expect(find.text('Load older messages'), findsOneWidget);
    await tester.tap(find.text('Load older messages'));
    await tester.pumpAndSettle();
    expect(find.text('नमस्ते old'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('message history opens saved conversation', (tester) async {
    final service = FakeHistory()..items.add(incoming('saved'));
    await tester.pumpWidget(
      MaterialApp(
        home: HistoryScreen(profile: profile, service: service),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('नमस्ते saved'), findsOneWidget);
    await tester.tap(find.text('020901'));
    await tester.pumpAndSettle();
    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.text('नमस्ते saved'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('call history shows direction, missed outcome, and duration', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HistoryScreen(
          profile: profile,
          service: FakeHistory(),
          showCalls: true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Call history'), findsOneWidget);
    expect(find.textContaining('Incoming · missed'), findsOneWidget);
    expect(find.textContaining('Outgoing · completed'), findsOneWidget);
    expect(find.textContaining('1:05'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  test('profile preserves reading preference across session serialization', () {
    final restored = UserNumberProfile.fromMap(
      profile
          .copyWith(messageLanguage: 'te', messageTranslationStyle: 'mixed')
          .toMap(),
    );
    expect(restored.messageLanguage, 'te');
    expect(restored.spokenLanguage, 'hi');
    expect(restored.messageTranslationStyle, 'mixed');
  });

  testWidgets(
    'reopening uses saved style and the composer fits a small phone with keyboard',
    (tester) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final service = FakeHistory()
        ..savedProfile = profile.copyWith(messageTranslationStyle: 'mixed');
      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            profile: profile,
            remoteNumber: '020901',
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<SegmentedButton<String>>(
              find.byType(SegmentedButton<String>),
            )
            .selected,
        {'mixed'},
      );
      expect(tester.takeException(), isNull);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Send message'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'translation style saves independently and failed saves keep the previous selection',
    (tester) async {
      final service = FakeHistory()..items.add(incoming('saved'));
      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            profile: profile,
            remoteNumber: '020901',
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<SegmentedButton<String>>(
              find.byType(SegmentedButton<String>),
            )
            .selected,
        {'pure'},
      );
      await tester.tap(find.text('Mixed + English'));
      await tester.pumpAndSettle();
      expect(service.style, 'mixed');
      expect(service.reading, 'hi');
      expect(find.text('नमस्ते saved'), findsOneWidget);
      expect(
        tester
            .widget<SegmentedButton<String>>(
              find.byType(SegmentedButton<String>),
            )
            .selected,
        {'mixed'},
      );
      service.failPreference = true;
      await tester.tap(find.text('Pure language'));
      await tester.pumpAndSettle();
      expect(find.text('Could not save preference'), findsOneWidget);
      expect(
        tester
            .widget<SegmentedButton<String>>(
              find.byType(SegmentedButton<String>),
            )
            .selected,
        {'mixed'},
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'English disables mixing and same-language rewritten messages retain the original',
    (tester) async {
      final service = FakeHistory()
        ..items.add({
          ...incoming('mixed'),
          'sourceLanguage': 'hi',
          'translatedText': 'कृपया meeting join करें।',
          'translationStyle': 'mixed',
        });
      await tester.pumpWidget(
        MaterialApp(
          home: ChatScreen(
            profile: profile.copyWith(
              messageLanguage: 'en',
              messageTranslationStyle: 'mixed',
            ),
            remoteNumber: '020901',
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final toggle = tester.widget<SegmentedButton<String>>(
        find.byType(SegmentedButton<String>),
      );
      expect(toggle.selected, {'pure'});
      expect(toggle.onSelectionChanged, isNull);
      expect(find.text('कृपया meeting join करें।'), findsOneWidget);
      await tester.tap(find.text('View original'));
      await tester.pumpAndSettle();
      expect(find.text('Hello mixed'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
