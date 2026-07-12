import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;

import 'call_service.dart';

class RealtimeBridgeClient {
  RealtimeBridgeClient({String? bridgeUrl})
    : bridgeUrl = bridgeUrl ?? const String.fromEnvironment('BRIDGE_URL');

  final String bridgeUrl;
  RTCPeerConnection? _peer;

  bool get isConfigured => bridgeUrl.isNotEmpty;

  Future<void> connect({
    required String callId,
    required BridgeToken bridgeToken,
    required MediaStream localStream,
  }) async {
    if (bridgeUrl.isEmpty) {
      throw StateError(
        'BRIDGE_URL is not configured. Deploy the Cloud Run bridge and run Flutter with --dart-define=BRIDGE_URL=<url>.',
      );
    }

    final peer = await createPeerConnection({
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
      ],
    });
    _peer = peer;

    for (final track in localStream.getAudioTracks()) {
      await peer.addTrack(track, localStream);
    }

    final offer = await peer.createOffer({
      'offerToReceiveAudio': true,
      'offerToReceiveVideo': false,
    });
    await peer.setLocalDescription(offer);
    await _waitForIceGathering(peer);

    final localDescription = await peer.getLocalDescription();
    final response = await http.post(
      Uri.parse('$bridgeUrl/webrtc/offer'),
      headers: {
        'Authorization': 'Bearer ${bridgeToken.token}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'callId': callId,
        'type': localDescription?.type,
        'sdp': localDescription?.sdp,
      }),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Bridge connection failed: ${response.body}');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    await peer.setRemoteDescription(
      RTCSessionDescription(body['sdp'] as String, body['type'] as String),
    );
  }

  Future<void> close() async {
    await _peer?.close();
    _peer = null;
  }

  Future<void> _waitForIceGathering(RTCPeerConnection peer) async {
    for (var i = 0; i < 25; i++) {
      final state = await peer.getIceGatheringState();
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete) {
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
  }
}
