import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({
    super.key,
    required this.number,
    required this.localStream,
  });

  final String number;
  final MediaStream localStream;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  bool _muted = false;
  bool _speakerOn = true;

  void _toggleMute() {
    setState(() {
      _muted = !_muted;
      for (final track in widget.localStream.getAudioTracks()) {
        track.enabled = !_muted;
      }
    });
  }

  void _toggleSpeaker() {
    setState(() {
      _speakerOn = !_speakerOn;
    });
  }

  void _endCall() {
    widget.localStream.dispose();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
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
                  widget.number,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 30,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'Connecting through WebRTC signaling...',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFFB5C7C1),
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
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
                      icon: Icons.dialpad,
                      label: 'Keypad',
                      onPressed: () {},
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
      ),
    );
  }

  String get _avatarLabel {
    final trimmed = widget.number.trim();
    if (trimmed.isEmpty) {
      return 'V';
    }

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
