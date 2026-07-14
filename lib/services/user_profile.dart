class UserNumberProfile {
  const UserNumberProfile({
    required this.uid,
    required this.email,
    required this.suffix,
    required this.number,
    required this.spokenLanguage,
    required this.listenLanguage,
    required this.preferredVoice,
  });

  final String uid;
  final String email;
  final String suffix;
  final String number;
  final String spokenLanguage;
  final String listenLanguage;
  final String preferredVoice;

  factory UserNumberProfile.fromMap(Map<String, dynamic> data) {
    return UserNumberProfile(
      uid: data['uid'] as String? ?? '',
      email: data['email'] as String? ?? '',
      suffix: data['suffix'] as String? ?? '',
      number: data['number'] as String? ?? '',
      spokenLanguage: data['spokenLanguage'] as String? ?? 'en',
      listenLanguage: data['listenLanguage'] as String? ?? 'en',
      preferredVoice: data['preferredVoice'] as String? ?? 'en-IN-NeerjaNeural',
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
    };
  }

  UserNumberProfile copyWith({
    String? spokenLanguage,
    String? listenLanguage,
    String? preferredVoice,
  }) {
    return UserNumberProfile(
      uid: uid,
      email: email,
      suffix: suffix,
      number: number,
      spokenLanguage: spokenLanguage ?? this.spokenLanguage,
      listenLanguage: listenLanguage ?? this.listenLanguage,
      preferredVoice: preferredVoice ?? this.preferredVoice,
    );
  }
}
