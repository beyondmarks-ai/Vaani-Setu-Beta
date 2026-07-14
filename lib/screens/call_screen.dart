import 'dart:async';

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../services/call_service.dart';
import '../services/notification_service.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({
    super.key,
    required this.callId,
    required this.remoteNumber,
    this.joinInfo,
  });

  final String callId;
  final String remoteNumber;
  final LiveKitJoinInfo? joinInfo;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  final _callService = CallService();
  final Room _room = Room(
    roomOptions: const RoomOptions(
      adaptiveStream: true,
      dynacast: false,
      fastPublish: true,
      defaultAudioCaptureOptions: AudioCaptureOptions(
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      ),
      defaultAudioOutputOptions: AudioOutputOptions(speakerOn: false),
    ),
  );

  bool _muted = false;
  bool _speakerOn = false;
  bool _connectingRoom = false;
  bool _roomConnected = false;
  String _mediaStatus = 'Connecting call...';
  LiveKitJoinInfo? _joinInfo;
  StreamSubscription<VaaniCall?>? _callSubscription;
  CancelListenFunc? _roomEventSubscription;
  bool _leavingCall = false;
  bool _translatedTrackReady = false;

  @override
  void initState() {
    super.initState();
    unawaited(NotificationService.instance.cancelIncomingCall(widget.callId));
    _room.addListener(_onRoomChanged);
    _roomEventSubscription = _room.events.listen(_onRoomEvent);
    _callSubscription = _callService
        .watchCall(widget.callId)
        .listen(_onCallChanged);
    _joinInfo = widget.joinInfo;
    if (_joinInfo != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _connectRoom());
    }
  }

  void _onRoomChanged() {
    _applyTranslationSubscriptions();
    if (!mounted) return;
    setState(() {});
  }

  void _onRoomEvent(RoomEvent event) {
    if (event is ParticipantConnectedEvent ||
        event is TrackPublishedEvent ||
        event is TrackSubscribedEvent ||
        event is TrackUnsubscribedEvent) {
      _applyTranslationSubscriptions();
    }
  }

  void _onCallChanged(VaaniCall? call) {
    if (!mounted || call == null) return;
    if (call.status != 'ringing') {
      unawaited(NotificationService.instance.cancelIncomingCall(call.id));
    }
    if (call.isEnded) unawaited(_leaveCall(notifyBackend: false));
  }

  Future<void> _connectRoom() async {
    if (_roomConnected || _connectingRoom) return;

    setState(() {
      _connectingRoom = true;
      _mediaStatus = 'Preparing microphone...';
    });

    try {
      final microphone = await Permission.microphone.request();
      if (!microphone.isGranted) {
        setState(() => _mediaStatus = 'Microphone permission required');
        return;
      }

      _joinInfo ??= await _callService.createLiveKitJoinInfo(widget.callId);
      final joinInfo = _joinInfo!;

      setState(() => _mediaStatus = 'Connecting LiveKit room...');
      await _room.connect(joinInfo.url, joinInfo.token);
      _applyTranslationSubscriptions();

      await _room.localParticipant?.setMicrophoneEnabled(true);
      await Hardware.instance.setSpeakerphoneOn(false);

      if (mounted) {
        setState(() {
          _roomConnected = true;
          _muted = false;
          _speakerOn = false;
          _mediaStatus = _translatedTrackReady
              ? 'Translation connected'
              : 'Connected, preparing translation...';
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _mediaStatus = error.toString();
        });
      }
    } finally {
      if (mounted) {
        setState(() => _connectingRoom = false);
      }
    }
  }

  void _applyTranslationSubscriptions() {
    final identity = _joinInfo?.identity;
    if (identity == null || identity.isEmpty) return;

    final translatorIdentity = 'translator-${widget.callId}';
    final targetTrackName = 'translated-to-$identity';
    var hasTranslatedTrack = false;

    for (final participant in _room.remoteParticipants.values) {
      final isTranslator = participant.identity == translatorIdentity;
      for (final publication in participant.trackPublications.values) {
        if (publication.kind != TrackType.AUDIO) continue;

        if (isTranslator) {
          final shouldSubscribe = publication.name == targetTrackName;
          if (shouldSubscribe) hasTranslatedTrack = true;
          if (shouldSubscribe && !publication.subscribed) {
            unawaited(publication.subscribe());
          } else if (!shouldSubscribe && publication.subscribed) {
            unawaited(publication.unsubscribe());
          }
        } else if (participant.identity != identity && publication.subscribed) {
          unawaited(publication.unsubscribe());
        }
      }
    }

    if (hasTranslatedTrack != _translatedTrackReady) {
      _translatedTrackReady = hasTranslatedTrack;
      if (mounted) {
        setState(() {
          _mediaStatus = hasTranslatedTrack
              ? 'Translation connected'
              : 'Connected, preparing translation...';
        });
      }
    }
  }

  Future<void> _toggleMute() async {
    try {
      final nextMuted = !_muted;
      await _room.localParticipant?.setMicrophoneEnabled(!nextMuted);
      if (!mounted) return;
      setState(() => _muted = nextMuted);
    } catch (error) {
      if (mounted) {
        setState(() => _mediaStatus = error.toString());
      }
    }
  }

  Future<void> _toggleSpeaker() async {
    try {
      final nextSpeaker = !_speakerOn;
      await Hardware.instance.setSpeakerphoneOn(nextSpeaker);
      if (!mounted) return;
      setState(() => _speakerOn = nextSpeaker);
    } catch (error) {
      if (mounted) {
        setState(() => _mediaStatus = error.toString());
      }
    }
  }

  Future<void> _endCall() async {
    await _leaveCall(notifyBackend: true);
  }

  Future<void> _leaveCall({required bool notifyBackend}) async {
    if (_leavingCall) return;
    _leavingCall = true;

    if (mounted) {
      setState(() => _mediaStatus = 'Ending call...');
    }

    try {
      await NotificationService.instance.cancelIncomingCall(widget.callId);
      await _room.disconnect();
      _translatedTrackReady = false;
      if (notifyBackend) {
        await _callService.endCall(widget.callId);
      }
    } catch (error) {
      debugPrint('Call cleanup failed: $error');
    } finally {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  void dispose() {
    _callSubscription?.cancel();
    final cancelRoomEvents = _roomEventSubscription;
    if (cancelRoomEvents != null) unawaited(cancelRoomEvents());
    _room.removeListener(_onRoomChanged);
    _room.disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: StreamBuilder<VaaniCall?>(
        stream: _callService.watchCall(widget.callId),
        builder: (context, snapshot) {
          final call = snapshot.data;
          final status = call?.status ?? 'connecting';

          if (!_roomConnected && !_connectingRoom && _joinInfo != null) {
            WidgetsBinding.instance.addPostFrameCallback((_) => _connectRoom());
          }

          return Scaffold(
            backgroundColor: const Color(0xFF0D1F1C),
            body: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
                child: Column(
                  children: [
                    const Text(
                      'Vaani Setu',
                      style: TextStyle(
                        color: Color(0xFFD8EFE9),
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    CircleAvatar(
                      radius: 54,
                      backgroundColor: const Color(0xFFD8EFE9),
                      child: Text(
                        _avatarLabel,
                        style: const TextStyle(
                          color: Color(0xFF12332F),
                          fontSize: 38,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      widget.remoteNumber,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      status == 'ringing' ? 'Ringing...' : _mediaStatus,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Color(0xFFB5C7C1),
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Participants: ${_room.localParticipant == null ? 0 : 1 + _room.remoteParticipants.length}',
                      style: const TextStyle(
                        color: Color(0xFF8FB4AD),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _CallControl(
                          icon: _muted ? Icons.mic_off : Icons.mic,
                          label: _muted ? 'Unmute' : 'Mute',
                          active: _muted,
                          onPressed: _toggleMute,
                        ),
                        _CallControl(
                          icon: _speakerOn ? Icons.volume_up : Icons.volume_off,
                          label: 'Speaker',
                          active: _speakerOn,
                          onPressed: _toggleSpeaker,
                        ),
                        _CallControl(
                          icon: _roomConnected ? Icons.wifi : Icons.sync,
                          label: _roomConnected ? 'LiveKit' : 'Join',
                          active: _roomConnected,
                          onPressed: _connectingRoom ? () {} : _connectRoom,
                        ),
                      ],
                    ),
                    const SizedBox(height: 34),
                    SizedBox.square(
                      dimension: 76,
                      child: FilledButton(
                        onPressed: _endCall,
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFDC2626),
                          shape: const CircleBorder(),
                        ),
                        child: const Icon(Icons.call_end, size: 32),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  String get _avatarLabel {
    final trimmed = widget.remoteNumber.trim();
    if (trimmed.isEmpty) return 'V';
    return trimmed.characters.first;
  }
}

class _CallControl extends StatelessWidget {
  const _CallControl({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox.square(
          dimension: 62,
          child: IconButton.filled(
            onPressed: onPressed,
            style: IconButton.styleFrom(
              backgroundColor: active
                  ? const Color(0xFFD8EFE9)
                  : const Color(0xFF1F3934),
              foregroundColor: active ? const Color(0xFF12332F) : Colors.white,
            ),
            icon: Icon(icon),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFFD8EFE9),
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
