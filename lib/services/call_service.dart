import 'call_event_service.dart';
import 'azure_auth_service.dart';

class VaaniCall {
  const VaaniCall({
    required this.id,
    required this.callerUid,
    required this.calleeUid,
    required this.callerNumber,
    required this.calleeNumber,
    required this.status,
    required this.callerLanguage,
    required this.calleeLanguage,
    this.createdAt = '',
    this.expiresAt = '',
  });

  final String id;
  final String callerUid;
  final String calleeUid;
  final String callerNumber;
  final String calleeNumber;
  final String status;
  final String callerLanguage;
  final String calleeLanguage;
  final String createdAt;
  final String expiresAt;

  bool get isEnded =>
      status == 'ended' || status == 'failed' || status == 'rejected';

  factory VaaniCall.fromMap(String id, Map<String, dynamic> data) {
    return VaaniCall(
      id: id,
      callerUid: data['callerUid'] as String? ?? '',
      calleeUid: data['calleeUid'] as String? ?? '',
      callerNumber: data['callerNumber'] as String? ?? '',
      calleeNumber: data['calleeNumber'] as String? ?? '',
      status: data['status'] as String? ?? 'unknown',
      callerLanguage: data['callerLanguage'] as String? ?? 'en',
      calleeLanguage: data['calleeLanguage'] as String? ?? 'en',
      createdAt: data['createdAt'] as String? ?? '',
      expiresAt: data['expiresAt'] as String? ?? '',
    );
  }
}

class BridgeToken {
  const BridgeToken({required this.token, required this.role});

  final String token;
  final String role;
}

class LiveKitJoinInfo {
  const LiveKitJoinInfo({
    required this.url,
    required this.token,
    required this.roomName,
    required this.identity,
    required this.role,
  });

  final String url;
  final String token;
  final String roomName;
  final String identity;
  final String role;

  factory LiveKitJoinInfo.fromMap(Map<String, dynamic> data) {
    return LiveKitJoinInfo(
      url: data['url'] as String? ?? '',
      token: data['token'] as String? ?? '',
      roomName: data['roomName'] as String? ?? '',
      identity: data['identity'] as String? ?? '',
      role: data['role'] as String? ?? '',
    );
  }
}

class CallService {
  CallService({AzureAuthService? auth, CallEventService? events})
    : _auth = auth ?? AzureAuthService.instance,
      _events = events ?? CallEventService.instance;

  final AzureAuthService _auth;
  final CallEventService _events;

  String? get currentUid => _auth.profile?.uid;

  Stream<List<VaaniCall>> watchIncomingCalls() {
    return const Stream<List<VaaniCall>>.empty();
  }

  Stream<VaaniCall?> watchCall(String callId) {
    _loadCall(callId);
    return _events.watchCall(callId);
  }

  Future<LiveKitJoinInfo> createCall(String targetSuffix) async {
    final body = await _auth.authorizedPost('/api/calls', {
      'targetSuffix': targetSuffix,
    });
    return LiveKitJoinInfo.fromMap(body['livekit'] as Map<String, dynamic>);
  }

  Future<LiveKitJoinInfo> acceptCall(String callId) async {
    final body = await _auth.authorizedPost(
      '/api/calls/$callId/accept',
      const {},
    );
    return LiveKitJoinInfo.fromMap(body['livekit'] as Map<String, dynamic>);
  }

  Future<void> endCall(String callId, {String reason = 'ended'}) async {
    await _auth.authorizedPost('/api/calls/$callId/end', {'reason': reason});
  }

  Future<LiveKitJoinInfo> createLiveKitJoinInfo(String callId) async {
    final body = await _auth.authorizedPost(
      '/api/calls/$callId/livekit-token',
      const {},
    );
    return LiveKitJoinInfo.fromMap(body);
  }

  Future<void> _loadCall(String callId) async {
    try {
      final body = await _auth.authorizedGet('/api/calls/$callId');
      final call = VaaniCall.fromMap(
        callId,
        body['call'] as Map<String, dynamic>? ?? <String, dynamic>{},
      );
      _events.emit(call);
    } catch (_) {
      // The websocket path will still deliver updates for active calls.
    }
  }
}
