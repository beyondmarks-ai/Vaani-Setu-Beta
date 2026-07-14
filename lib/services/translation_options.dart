class TranslationLanguage {
  const TranslationLanguage({required this.code, required this.name});

  final String code;
  final String name;

  factory TranslationLanguage.fromMap(Map<String, dynamic> data) {
    return TranslationLanguage(
      code: data['code'] as String? ?? 'en',
      name: data['name'] as String? ?? 'English',
    );
  }
}

class TranslationVoice {
  const TranslationVoice({required this.id, required this.name});

  final String id;
  final String name;

  factory TranslationVoice.fromMap(Map<String, dynamic> data) {
    return TranslationVoice(
      id: data['id'] as String? ?? 'alloy',
      name: data['name'] as String? ?? 'Alloy',
    );
  }
}

class TranslationOptions {
  const TranslationOptions({
    required this.languages,
    required this.voices,
    required this.defaultVoice,
  });

  final List<TranslationLanguage> languages;
  final List<TranslationVoice> voices;
  final String defaultVoice;

  factory TranslationOptions.fromMap(Map<String, dynamic> data) {
    return TranslationOptions(
      languages: (data['languages'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TranslationLanguage.fromMap)
          .toList(),
      voices: (data['voices'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TranslationVoice.fromMap)
          .toList(),
      defaultVoice: data['defaultVoice'] as String? ?? 'alloy',
    );
  }
}

const fallbackTranslationOptions = TranslationOptions(
  defaultVoice: 'alloy',
  voices: [
    TranslationVoice(id: 'alloy', name: 'Alloy'),
    TranslationVoice(id: 'echo', name: 'Echo'),
    TranslationVoice(id: 'shimmer', name: 'Shimmer'),
  ],
  languages: [
    TranslationLanguage(code: 'en', name: 'English'),
    TranslationLanguage(code: 'hi', name: 'Hindi'),
    TranslationLanguage(code: 'te', name: 'Telugu'),
    TranslationLanguage(code: 'ta', name: 'Tamil'),
    TranslationLanguage(code: 'kn', name: 'Kannada'),
    TranslationLanguage(code: 'ml', name: 'Malayalam'),
    TranslationLanguage(code: 'mr', name: 'Marathi'),
    TranslationLanguage(code: 'bn', name: 'Bengali'),
    TranslationLanguage(code: 'gu', name: 'Gujarati'),
    TranslationLanguage(code: 'pa', name: 'Punjabi'),
    TranslationLanguage(code: 'ur', name: 'Urdu'),
  ],
);

String languageName(
  String code, [
  TranslationOptions options = fallbackTranslationOptions,
]) {
  for (final language in options.languages) {
    if (language.code == code) return language.name;
  }
  return code.toUpperCase();
}

String voiceName(
  String id, [
  TranslationOptions options = fallbackTranslationOptions,
]) {
  for (final voice in options.voices) {
    if (voice.id == id) return voice.name;
  }
  return id;
}
