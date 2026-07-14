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
      id: data['id'] as String? ?? 'en-IN-NeerjaNeural',
      name: data['name'] as String? ?? 'English - Neerja',
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
      defaultVoice: data['defaultVoice'] as String? ?? 'en-IN-NeerjaNeural',
    );
  }
}

const fallbackTranslationOptions = TranslationOptions(
  defaultVoice: 'en-IN-NeerjaNeural',
  voices: [
    TranslationVoice(
      id: 'en-IN-NeerjaNeural',
      name: 'English - Neerja',
      languageCode: 'en',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'en-IN-PrabhatNeural',
      name: 'English - Prabhat',
      languageCode: 'en',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'as-IN-YashicaNeural',
      name: 'Assamese - Yashica',
      languageCode: 'as',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'as-IN-PriyomNeural',
      name: 'Assamese - Priyom',
      languageCode: 'as',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'bn-IN-TanishaaNeural',
      name: 'Bengali - Tanishaa',
      languageCode: 'bn',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'bn-IN-BashkarNeural',
      name: 'Bengali - Bashkar',
      languageCode: 'bn',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'gu-IN-DhwaniNeural',
      name: 'Gujarati - Dhwani',
      languageCode: 'gu',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'gu-IN-NiranjanNeural',
      name: 'Gujarati - Niranjan',
      languageCode: 'gu',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'hi-IN-SwaraNeural',
      name: 'Hindi - Swara',
      languageCode: 'hi',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'hi-IN-MadhurNeural',
      name: 'Hindi - Madhur',
      languageCode: 'hi',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'kn-IN-SapnaNeural',
      name: 'Kannada - Sapna',
      languageCode: 'kn',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'kn-IN-GaganNeural',
      name: 'Kannada - Gagan',
      languageCode: 'kn',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'ml-IN-SobhanaNeural',
      name: 'Malayalam - Sobhana',
      languageCode: 'ml',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'ml-IN-MidhunNeural',
      name: 'Malayalam - Midhun',
      languageCode: 'ml',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'mr-IN-AarohiNeural',
      name: 'Marathi - Aarohi',
      languageCode: 'mr',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'mr-IN-ManoharNeural',
      name: 'Marathi - Manohar',
      languageCode: 'mr',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'or-IN-SubhasiniNeural',
      name: 'Odia - Subhasini',
      languageCode: 'or',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'or-IN-SukantNeural',
      name: 'Odia - Sukant',
      languageCode: 'or',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'pa-IN-VaaniNeural',
      name: 'Punjabi - Vaani',
      languageCode: 'pa',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'pa-IN-OjasNeural',
      name: 'Punjabi - Ojas',
      languageCode: 'pa',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'ta-IN-PallaviNeural',
      name: 'Tamil - Pallavi',
      languageCode: 'ta',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'ta-IN-ValluvarNeural',
      name: 'Tamil - Valluvar',
      languageCode: 'ta',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'te-IN-ShrutiNeural',
      name: 'Telugu - Shruti',
      languageCode: 'te',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'te-IN-MohanNeural',
      name: 'Telugu - Mohan',
      languageCode: 'te',
      gender: 'Male',
    ),
    TranslationVoice(
      id: 'ur-IN-GulNeural',
      name: 'Urdu - Gul',
      languageCode: 'ur',
      gender: 'Female',
    ),
    TranslationVoice(
      id: 'ur-IN-SalmanNeural',
      name: 'Urdu - Salman',
      languageCode: 'ur',
      gender: 'Male',
    ),
  ],
  languages: [
    TranslationLanguage(code: 'en', name: 'English (India)'),
    TranslationLanguage(code: 'as', name: 'Assamese'),
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
    TranslationLanguage(code: 'ur', name: 'Urdu'),
  ],
);

List<TranslationVoice> voicesForLanguage(
  String languageCode, [
  TranslationOptions options = fallbackTranslationOptions,
]) {
  final voices = options.voices
      .where((voice) => voice.languageCode == languageCode)
      .toList();
  return voices.isEmpty ? options.voices : voices;
}

String defaultVoiceForLanguage(
  String languageCode, [
  TranslationOptions options = fallbackTranslationOptions,
]) {
  final voices = voicesForLanguage(languageCode, options);
  return voices.isEmpty ? options.defaultVoice : voices.first.id;
}

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
  if (id == 'alloy' || id == 'echo' || id == 'shimmer') return 'Default voice';
  return id;
}
