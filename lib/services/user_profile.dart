class UserNumberProfile {
  const UserNumberProfile({
    required this.uid,
    required this.email,
    required this.suffix,
    required this.number,
    required this.spokenLanguage,
    required this.listenLanguage,
  });

  final String uid;
  final String email;
  final String suffix;
  final String number;
  final String spokenLanguage;
  final String listenLanguage;

  factory UserNumberProfile.fromMap(Map<String, dynamic> data) {
    return UserNumberProfile(
      uid: data['uid'] as String? ?? '',
      email: data['email'] as String? ?? '',
      suffix: data['suffix'] as String? ?? '',
      number: data['number'] as String? ?? '',
      spokenLanguage: data['spokenLanguage'] as String? ?? 'en',
      listenLanguage: data['listenLanguage'] as String? ?? 'en',
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
    };
  }
}
