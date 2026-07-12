import 'package:flutter/material.dart';

import '../services/call_service.dart';
import '../services/notification_service.dart';
import 'call_screen.dart';

class IncomingCallScreen extends StatefulWidget {
  const IncomingCallScreen({super.key, required this.call});

  final VaaniCall call;

  @override
  State<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends State<IncomingCallScreen> {
  final _callService = CallService();
  bool _busy = false;

  Future<void> _accept() async {
    if (_busy) return;
    setState(() => _busy = true);

    try {
      await NotificationService.instance.cancelIncomingCall(widget.call.id);
      final joinInfo = await _callService.acceptCall(widget.call.id);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => CallScreen(
            callId: widget.call.id,
            remoteNumber: widget.call.callerNumber,
            joinInfo: joinInfo,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _reject() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await NotificationService.instance.cancelIncomingCall(widget.call.id);
      await _callService.endCall(widget.call.id, reason: 'rejected');
    } finally {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1F1C),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              const CircleAvatar(
                radius: 54,
                backgroundColor: Color(0xFFD8EFE9),
                child: Icon(
                  Icons.call_received,
                  size: 42,
                  color: Color(0xFF0F766E),
                ),
              ),
              const SizedBox(height: 22),
              const Text(
                'Incoming call',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                widget.call.callerNumber,
                style: const TextStyle(
                  color: Color(0xFFD8EFE9),
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Tap accept to join the room',
                style: const TextStyle(
                  color: Color(0xFFB5C7C1),
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  SizedBox.square(
                    dimension: 74,
                    child: FilledButton(
                      onPressed: _busy ? null : _reject,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFFDC2626),
                        shape: const CircleBorder(),
                      ),
                      child: const Icon(Icons.call_end, size: 32),
                    ),
                  ),
                  SizedBox.square(
                    dimension: 88,
                    child: FilledButton(
                      onPressed: _busy ? null : _accept,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF12834C),
                        shape: const CircleBorder(),
                      ),
                      child: _busy
                          ? const SizedBox.square(
                              dimension: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.call, size: 36),
                    ),
                  ),
                ],
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}
