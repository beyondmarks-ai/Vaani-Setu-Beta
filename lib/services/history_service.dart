import 'dart:async';
import 'dart:math';

import 'azure_auth_service.dart';
import 'user_profile.dart';

typedef HistoryItem = Map<String, dynamic>;

class HistoryPage {
  HistoryPage.fromMap(HistoryItem data)
    : items = (data['items'] as List).cast<HistoryItem>(),
      nextCursor = data['nextCursor'] as String?;

  final List<HistoryItem> items;
  final String? nextCursor;
}

class HistoryService {
  static final changes = StreamController<void>.broadcast();

  UserNumberProfile? get currentProfile => AzureAuthService.instance.profile;

  Future<List<HistoryItem>> conversations() async {
    final data = await AzureAuthService.instance.authorizedGet(
      '/api/conversations',
    );
    return (data['items'] as List).cast<HistoryItem>();
  }

  Future<HistoryPage> messages(String suffix, {String? before}) async {
    return _page('/api/messages/$suffix', before);
  }

  Future<HistoryPage> calls({String? before}) => _page('/api/calls', before);

  Future<HistoryPage> _page(String path, String? before) async {
    final query = before == null
        ? ''
        : '?before=${Uri.encodeQueryComponent(before)}';
    return HistoryPage.fromMap(
      await AzureAuthService.instance.authorizedGet('$path$query'),
    );
  }

  Future<HistoryItem> send({
    required String suffix,
    required String text,
    required String sourceLanguage,
    required String messageId,
  }) async {
    final data = await AzureAuthService.instance
        .authorizedPost('/api/messages', {
          'targetSuffix': suffix,
          'text': text,
          'sourceLanguage': sourceLanguage,
          'messageId': messageId,
        });
    changes.add(null);
    return data['message'] as HistoryItem;
  }

  Future<void> setReadingLanguage(String language) async {
    await AzureAuthService.instance.updateMessageLanguage(language);
  }

  Future<void> setTranslationStyle(String language, String style) async {
    await AzureAuthService.instance.updateMessageLanguage(
      language,
      translationStyle: style,
    );
  }

  static String newMessageId() {
    final random = Random.secure();
    return List.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }
}

String historyTime(dynamic value) {
  final time = DateTime.tryParse(value as String? ?? '')?.toLocal();
  if (time == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(time.day)}/${two(time.month)}/${time.year} ${two(time.hour)}:${two(time.minute)}';
}

String messageText(HistoryItem message, String uid) =>
    (message['senderUid'] == uid
            ? message['originalText']
            : message['translatedText'])
        as String;
