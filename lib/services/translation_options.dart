class TranslationLanguage {
  const TranslationLanguage({required this.code, required this.name});

  final String code;
  final String name;

  factory TranslationLanguage.fromMap(Map<String, dynamic> data) {
    return TranslationLanguage(
      code: data['code'] as String? ?? 'en',
      name: data['name'] as String? ?? 'English (India)',
    );
  }
}

class TranslationVoice {
  const TranslationVoice({
    required this.id,
    required this.name,
    required this.languageCode,
    required this.gender,
  });

  final String id;
  final String name;
  final String languageCode;
  final String gender;

  factory TranslationVoice.fromMap(Map<String, dynamic> data) {
    return TranslationVoice(
      id: data['id'] as String? ?? 'simran',
      name: data['name'] as String? ?? 'Simran',
      languageCode: data['languageCode'] as String? ?? 'en',
      gender: data['gender'] as String? ?? '',
    );
  }
}

class TranslationOptions {
  const TranslationOptions({
    required this.languages,
    required this.voices,
    required this.defaultVoice,
    this.protectedTermsLimit = 25,
    this.protectedTermMaxLength = 40,
  });

  final List<TranslationLanguage> languages;
  final List<TranslationVoice> voices;
  final String defaultVoice;
  final int protectedTermsLimit;
  final int protectedTermMaxLength;

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
      defaultVoice: data['defaultVoice'] as String? ?? 'simran',
      protectedTermsLimit: data['protectedTermsLimit'] as int? ?? 25,
      protectedTermMaxLength: data['protectedTermMaxLength'] as int? ?? 40,
    );
  }
}

const _sarvamLanguages = [
  TranslationLanguage(code: 'en', name: 'English (India)'),
  TranslationLanguage(code: 'bn', name: 'Bengali'),
  TranslationLanguage(code: 'gu', name: 'Gujarati'),
  TranslationLanguage(code: 'hi', name: 'Hindi'),
  TranslationLanguage(code: 'kn', name: 'Kannada'),
  TranslationLanguage(code: 'ml', name: 'Malayalam'),
  TranslationLanguage(code: 'mr', name: 'Marathi'),
  TranslationLanguage(code: 'or', name: 'Odia'),
  TranslationLanguage(code: 'pa', name: 'Punjabi'),
  TranslationLanguage(code: 'ta', name: 'Tamil'),
  TranslationLanguage(code: 'te', name: 'Telugu'),
];

final fallbackTranslationOptions = TranslationOptions(
  defaultVoice: 'simran',
  languages: _sarvamLanguages,
  voices: [
    for (final language in _sarvamLanguages) ...[
      TranslationVoice(
        id: 'simran',
        name: '${language.name} - Simran',
        languageCode: language.code,
        gender: 'Female',
      ),
      TranslationVoice(
        id: 'aditya',
        name: '${language.name} - Aditya',
        languageCode: language.code,
        gender: 'Male',
      ),
    ],
  ],
);

List<TranslationVoice> voicesForLanguage(
  String languageCode, [
  TranslationOptions? options,
]) {
  final resolvedOptions = options ?? fallbackTranslationOptions;
  final voices = resolvedOptions.voices
      .where((voice) => voice.languageCode == languageCode)
      .toList();
  return voices.isEmpty ? resolvedOptions.voices : voices;
}

String defaultVoiceForLanguage(
  String languageCode, [
  TranslationOptions? options,
]) {
  final resolvedOptions = options ?? fallbackTranslationOptions;
  final voices = voicesForLanguage(languageCode, resolvedOptions);
  return voices.isEmpty ? resolvedOptions.defaultVoice : voices.first.id;
}

String languageName(String code, [TranslationOptions? options]) {
  final resolvedOptions = options ?? fallbackTranslationOptions;
  for (final language in resolvedOptions.languages) {
    if (language.code == code) return language.name;
  }
  return code.toUpperCase();
}

String voiceName(String id, [TranslationOptions? options]) {
  final resolvedOptions = options ?? fallbackTranslationOptions;
  for (final voice in resolvedOptions.voices) {
    if (voice.id == id) return voice.name;
  }
  return id;
}
