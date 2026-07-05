import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

import 'call_screen.dart';

class DialerScreen extends StatefulWidget {
  const DialerScreen({super.key});

  @override
  State<DialerScreen> createState() => _DialerScreenState();
}

class _DialerScreenState extends State<DialerScreen> {
  String _number = '';
  String _status = 'Ready';
  MediaStream? _localStream;

  Future<MediaStream?> _prepareAudio() async {
    final microphone = await Permission.microphone.request();
    final camera = await Permission.camera.request();
    await Permission.contacts.request();

    if (!microphone.isGranted) {
      setState(() => _status = 'Microphone permission required');
      return null;
    }

    if (_localStream != null) {
      return _localStream;
    }

    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': camera.isGranted,
    });

    return _localStream;
  }

  Future<void> _startCall() async {
    if (_number.isEmpty) {
      setState(() => _status = 'Enter a number first');
      return;
    }

    try {
      setState(() => _status = 'Preparing audio...');
      final stream = await _prepareAudio();

      if (!mounted || stream == null) {
        return;
      }

      setState(() {
        _status = 'Opening call screen';
      });

      final callNumber = _number;
      _localStream = null;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => CallScreen(number: callNumber, localStream: stream),
        ),
      );

      if (mounted) {
        setState(() => _status = 'Ready');
      }
    } catch (_) {
      setState(() => _status = 'Could not start local audio');
    }
  }

  void _addDigit(String digit) {
    setState(() {
      _number += digit;
      _status = 'Ready';
    });
  }

  void _deleteDigit() {
    if (_number.isEmpty) {
      return;
    }

    setState(() {
      _number = _number.substring(0, _number.length - 1);
      _status = 'Ready';
    });
  }

  void _clearNumber() {
    setState(() {
      _number = '';
      _status = 'Ready';
    });
  }

  @override
  void dispose() {
    _localStream?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vaani Setu')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
          child: Column(
            children: [
              _NumberDisplay(number: _number, status: _status),
              const SizedBox(height: 22),
              Expanded(child: _DialPad(onDigitPressed: _addDigit)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _ActionButton(
                    icon: Icons.close,
                    tooltip: 'Clear',
                    onPressed: _number.isEmpty ? null : _clearNumber,
                  ),
                  const SizedBox(width: 20),
                  SizedBox.square(
                    dimension: 72,
                    child: FilledButton(
                      onPressed: _startCall,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF12834C),
                        shape: const CircleBorder(),
                      ),
                      child: const Icon(Icons.call, size: 30),
                    ),
                  ),
                  const SizedBox(width: 20),
                  _ActionButton(
                    icon: Icons.backspace_outlined,
                    tooltip: 'Delete',
                    onPressed: _number.isEmpty ? null : _deleteDigit,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NumberDisplay extends StatelessWidget {
  const _NumberDisplay({required this.number, required this.status});

  final String number;
  final String status;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE0E5DF)),
      ),
      child: Column(
        children: [
          Text(
            number.isEmpty ? 'Enter phone number' : number,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: number.isEmpty
                  ? const Color(0xFF77817D)
                  : const Color(0xFF12332F),
              fontSize: number.length > 14 ? 24 : 30,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            status,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF687570),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _DialPad extends StatelessWidget {
  const _DialPad({required this.onDigitPressed});

  final ValueChanged<String> onDigitPressed;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final boardWidth = constraints.maxWidth > 340
            ? 340.0
            : constraints.maxWidth;
        final keyByWidth = (boardWidth - 36) / 3;
        final keyByHeight = (constraints.maxHeight - 36) / 4;
        final keySize = (keyByWidth < keyByHeight ? keyByWidth : keyByHeight)
            .clamp(52.0, 94.0)
            .toDouble();

        return Center(
          child: SizedBox(
            width: keySize * 3 + 36,
            height: keySize * 4 + 36,
            child: Column(
              children: [
                for (var row = 0; row < 4; row++) ...[
                  Row(
                    children: [
                      for (var column = 0; column < 3; column++) ...[
                        SizedBox.square(
                          dimension: keySize,
                          child: _DialKey(
                            data: _dialKeys[row * 3 + column],
                            onPressed: onDigitPressed,
                          ),
                        ),
                        if (column < 2) const SizedBox(width: 18),
                      ],
                    ],
                  ),
                  if (row < 3) const SizedBox(height: 12),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DialKey extends StatelessWidget {
  const _DialKey({required this.data, required this.onPressed});

  final _DialKeyData data;
  final ValueChanged<String> onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      elevation: 2,
      shadowColor: const Color(0x18000000),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: () => onPressed(data.value),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                data.value,
                style: const TextStyle(
                  color: Color(0xFF12332F),
                  fontSize: 28,
                  height: 1,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                data.letters,
                style: const TextStyle(
                  color: Color(0xFF6D7975),
                  fontSize: 10,
                  height: 1,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 56,
      child: IconButton.outlined(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: Icon(icon),
      ),
    );
  }
}

class _DialKeyData {
  const _DialKeyData(this.value, this.letters);

  final String value;
  final String letters;
}

const _dialKeys = [
  _DialKeyData('1', ''),
  _DialKeyData('2', 'ABC'),
  _DialKeyData('3', 'DEF'),
  _DialKeyData('4', 'GHI'),
  _DialKeyData('5', 'JKL'),
  _DialKeyData('6', 'MNO'),
  _DialKeyData('7', 'PQRS'),
  _DialKeyData('8', 'TUV'),
  _DialKeyData('9', 'WXYZ'),
  _DialKeyData('*', ''),
  _DialKeyData('0', '+'),
  _DialKeyData('#', ''),
];
