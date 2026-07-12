import 'azure_auth_service.dart';
import 'user_profile.dart';

export 'user_profile.dart';

class NumberAssignmentService {
  NumberAssignmentService({AzureAuthService? auth})
    : _auth = auth ?? AzureAuthService.instance;

  static const prefix = '0209';

  final AzureAuthService _auth;

  Stream<UserNumberProfile?> watchProfile(String uid) {
    return _auth.authState.map((state) => state.profile);
  }

  Future<UserNumberProfile> ensureAssignedNumber([Object? _]) async {
    final profile = _auth.profile;
    if (profile == null) throw StateError('Sign in before continuing.');
    return profile;
  }

  Future<UserNumberProfile?> findBySuffix(String suffix) async {
    if (!RegExp(r'^\d{2}$').hasMatch(suffix)) return null;

    try {
      final body = await _auth.authorizedGet('/api/numbers/$suffix');
      return UserNumberProfile.fromMap(body['profile'] as Map<String, dynamic>);
    } catch (error) {
      if (error.toString().contains('No user has')) return null;
      rethrow;
    }
  }
}
