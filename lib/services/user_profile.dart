class UserNumberProfile {
  const UserNumberProfile({
    required this.uid,
    required this.email,
    required this.suffix,
    required this.number,
    required this.spokenLanguage,
    required this.listenLanguage,
    required this.preferredVoice,
    this.protectedTerms = const [],
  });

  final String uid;
  final String email;
  final String suffix;
  final String number;
  final String spokenLanguage;
  final String listenLanguage;
  final String preferredVoice;
  final List<String> protectedTerms;

  factory UserNumberProfile.fromMap(Map<String, dynamic> data) {
    return UserNumberProfile(
      uid: data['uid'] as String? ?? '',
      email: data['email'] as String? ?? '',
      suffix: data['suffix'] as String? ?? '',
      number: data['number'] as String? ?? '',
      spokenLanguage: data['spokenLanguage'] as String? ?? 'en',
      listenLanguage: data['listenLanguage'] as String? ?? 'en',
      preferredVoice: data['preferredVoice'] as String? ?? 'simran',
      protectedTerms: (data['protectedTerms'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(growable: false),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'email': email,
      'suffix': suffix,
      'number': number,
      'spokenLanguage': spokenLanguage,
      'listenLanguage': listenLanguage,
      'preferredVoice': preferredVoice,
      'protectedTerms': protectedTerms,
    };
  }

  UserNumberProfile copyWith({
    String? spokenLanguage,
    String? listenLanguage,
    String? preferredVoice,
    List<String>? protectedTerms,
  }) {
    return UserNumberProfile(
      uid: uid,
      email: email,
      suffix: suffix,
      number: number,
      spokenLanguage: spokenLanguage ?? this.spokenLanguage,
      listenLanguage: listenLanguage ?? this.listenLanguage,
      preferredVoice: preferredVoice ?? this.preferredVoice,
      protectedTerms: protectedTerms ?? this.protectedTerms,
    );
  }
}
