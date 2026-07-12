import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'user_profile.dart';

class AzureAuthState {
  const AzureAuthState({required this.loading, this.token, this.profile});

  final bool loading;
  final String? token;
  final UserNumberProfile? profile;

  bool get signedIn => token != null && profile != null;
}

class AzureAuthService {
  AzureAuthService._();

  static final AzureAuthService instance = AzureAuthService._();

  static const _bridgeUrl = String.fromEnvironment(
    'BRIDGE_URL',
    defaultValue:
        'https://vaani-setu-bridge.wonderfulplant-f827f144.southindia.azurecontainerapps.io',
  );

  final StreamController<AzureAuthState> _stateController =
      StreamController<AzureAuthState>.broadcast();

  AzureAuthState _state = const AzureAuthState(loading: true);
  SharedPreferences? _prefs;

  Stream<AzureAuthState> get authState async* {
    yield _state;
    yield* _stateController.stream;
  }

  AzureAuthState get state => _state;
  String? get token => _state.token;
  UserNumberProfile? get profile => _state.profile;

  Future<void> initialize() async {
    _prefs = await SharedPreferences.getInstance();
    final token = _prefs?.getString('azure_auth_token');
    final profileJson = _prefs?.getString('azure_auth_profile');

    if (token == null || profileJson == null) {
      _setState(const AzureAuthState(loading: false));
      return;
    }

    try {
      final profile = await _fetchProfile(token);
      await _saveSession(token, profile);
      _setState(AzureAuthState(loading: false, token: token, profile: profile));
    } catch (error) {
      debugPrint('Stored Azure session invalid: $error');
      await signOut();
    }
  }

  Future<void> register({required String email, required String password}) {
    return _authenticate(
      '/api/auth/register',
      email: email,
      password: password,
    );
  }

  Future<void> login({required String email, required String password}) {
    return _authenticate('/api/auth/login', email: email, password: password);
  }

  Future<void> signOut() async {
    await _prefs?.remove('azure_auth_token');
    await _prefs?.remove('azure_auth_profile');
    _setState(const AzureAuthState(loading: false));
  }

  Future<Map<String, dynamic>> authorizedGet(String path) async {
    final token = _requireToken();
    final response = await http.get(
      Uri.parse('$_bridgeUrl$path'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return _decodeResponse(response);
  }

  Future<Map<String, dynamic>> authorizedPost(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final token = _requireToken();
    final response = await http.post(
      Uri.parse('$_bridgeUrl$path'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    return _decodeResponse(response);
  }

  Future<void> _authenticate(
    String path, {
    required String email,
    required String password,
  }) async {
    final response = await http.post(
      Uri.parse('$_bridgeUrl$path'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final body = _decodeResponse(response);
    final token = body['token'] as String? ?? '';
    final profileMap = body['profile'] as Map<String, dynamic>?;
    if (token.isEmpty || profileMap == null) {
      throw StateError('Invalid auth response from Azure backend.');
    }

    final profile = UserNumberProfile.fromMap(profileMap);
    await _saveSession(token, profile);
    _setState(AzureAuthState(loading: false, token: token, profile: profile));
  }

  Future<UserNumberProfile> _fetchProfile(String token) async {
    final response = await http.get(
      Uri.parse('$_bridgeUrl/api/me'),
      headers: {'Authorization': 'Bearer $token'},
    );
    final body = _decodeResponse(response);
    return UserNumberProfile.fromMap(body['profile'] as Map<String, dynamic>);
  }

  Future<void> _saveSession(String token, UserNumberProfile profile) async {
    await _prefs?.setString('azure_auth_token', token);
    await _prefs?.setString('azure_auth_profile', jsonEncode(profile.toMap()));
  }

  String _requireToken() {
    final value = token;
    if (value == null || value.isEmpty) {
      throw StateError('Sign in before continuing.');
    }
    return value;
  }

  Map<String, dynamic> _decodeResponse(http.Response response) {
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        body['error'] as String? ?? 'Azure backend request failed.',
      );
    }
    return body;
  }

  void _setState(AzureAuthState state) {
    _state = state;
    _stateController.add(state);
  }
}
