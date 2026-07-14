import '../services/azure_auth_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/call_service.dart';
import '../services/number_assignment_service.dart';
import '../services/translation_options.dart';
import 'call_screen.dart';

class DialerScreen extends StatefulWidget {
  const DialerScreen({super.key, required this.profile});

  final UserNumberProfile profile;

  @override
  State<DialerScreen> createState() => _DialerScreenState();
}

class _DialerScreenState extends State<DialerScreen> {
  final _numberService = NumberAssignmentService();
  final _callService = CallService();

  String _targetSuffix = '';
  String _status = 'Enter the last 2 digits to call';
  bool _checkingNumber = false;
  bool _savingSettings = false;

  UserNumberProfile get _profile =>
      AzureAuthService.instance.profile ?? widget.profile;
  String get _targetNumber => '${NumberAssignmentService.prefix}$_targetSuffix';

  Future<void> _startCall() async {
    if (_targetSuffix.length != 2) {
      setState(
        () =>
            _status = 'Enter 2 digits after ${NumberAssignmentService.prefix}',
      );
      return;
    }

    if (_targetSuffix == _profile.suffix) {
      setState(() => _status = 'You cannot call your own number');
      return;
    }

    try {
      setState(() {
        _checkingNumber = true;
        _status = 'Checking $_targetNumber...';
      });

      final target = await _numberService.findBySuffix(_targetSuffix);
      if (!mounted) return;

      if (target == null) {
        setState(() {
          _checkingNumber = false;
          _status = 'No user has $_targetNumber yet';
        });
        return;
      }

      setState(() => _status = 'Calling $_targetNumber...');
      final joinInfo = await _callService.createCall(_targetSuffix);
      if (!mounted) return;

      setState(() {
        _checkingNumber = false;
        _status = 'Enter the last 2 digits to call';
      });

      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => CallScreen(
            callId: joinInfo.roomName,
            remoteNumber: target.number,
            joinInfo: joinInfo,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _checkingNumber = false;
          _status = _friendlyError(error);
        });
      }
    }
  }

  String _friendlyError(Object error) {
    final message = error.toString();
    if (message.contains('not-found')) return 'No user has $_targetNumber yet';
    if (message.contains('permission-denied')) return 'Call permission denied';
    return message.replaceFirst('Bad state: ', '');
  }

  void _addDigit(String digit) {
    if (_targetSuffix.length >= 2) {
      HapticFeedback.selectionClick();
      setState(() => _status = 'Only 2 digits are needed');
      return;
    }

    setState(() {
      _targetSuffix += digit;
      _status = _targetSuffix.length == 2
          ? 'Ready to call $_targetNumber'
          : 'Enter 1 more digit';
    });
  }

  void _deleteDigit() {
    if (_targetSuffix.isEmpty) return;

    setState(() {
      _targetSuffix = _targetSuffix.substring(0, _targetSuffix.length - 1);
      _status = _targetSuffix.isEmpty
          ? 'Enter the last 2 digits to call'
          : 'Enter 1 more digit';
    });
  }

  void _clearNumber() {
    setState(() {
      _targetSuffix = '';
      _status = 'Enter the last 2 digits to call';
    });
  }

  Future<void> _signOut() async {
    await AzureAuthService.instance.signOut();
  }

  Future<void> _openTranslationSettings() async {
    final options = await _loadTranslationOptions();
    if (!mounted) return;

    var spokenLanguage = _profile.spokenLanguage;
    var listenLanguage = _profile.listenLanguage;
    var preferredVoice = _profile.preferredVoice;
    final languageCodes = options.languages.map((item) => item.code).toSet();
    if (!languageCodes.contains(spokenLanguage)) spokenLanguage = 'en';
    if (!languageCodes.contains(listenLanguage)) listenLanguage = 'en';
    var languageVoices = voicesForLanguage(listenLanguage, options);
    var voiceIds = languageVoices.map((item) => item.id).toSet();
    if (!voiceIds.contains(preferredVoice)) {
      preferredVoice = defaultVoiceForLanguage(listenLanguage, options);
    }

    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> save() async {
              setSheetState(() => _savingSettings = true);
              try {
                await AzureAuthService.instance.updateProfile(
                  spokenLanguage: spokenLanguage,
                  listenLanguage: listenLanguage,
                  preferredVoice: preferredVoice,
                );
                if (context.mounted) Navigator.of(context).pop();
                if (mounted) {
                  setState(() => _status = 'Translation preferences saved');
                }
              } catch (error) {
                if (mounted) {
                  setState(() => _status = _friendlyError(error));
                }
              } finally {
                if (mounted) setState(() => _savingSettings = false);
              }
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  4,
                  20,
                  20 + MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Translation preferences',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF12332F),
                      ),
                    ),
                    const SizedBox(height: 16),
                    _OptionDropdown(
                      label: 'I speak',
                      icon: Icons.record_voice_over_outlined,
                      value: spokenLanguage,
                      items: options.languages
                          .map(
                            (item) => DropdownMenuItem(
                              value: item.code,
                              child: Text(item.name),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setSheetState(() => spokenLanguage = value);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _OptionDropdown(
                      label: 'I want to hear',
                      icon: Icons.hearing_outlined,
                      value: listenLanguage,
                      items: options.languages
                          .map(
                            (item) => DropdownMenuItem(
                              value: item.code,
                              child: Text(item.name),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setSheetState(() {
                            listenLanguage = value;
                            languageVoices = voicesForLanguage(
                              listenLanguage,
                              options,
                            );
                            voiceIds = languageVoices
                                .map((item) => item.id)
                                .toSet();
                            if (!voiceIds.contains(preferredVoice)) {
                              preferredVoice = defaultVoiceForLanguage(
                                listenLanguage,
                                options,
                              );
                            }
                          });
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _OptionDropdown(
                      label: 'Voice',
                      icon: Icons.graphic_eq,
                      value: preferredVoice,
                      items: languageVoices
                          .map(
                            (item) => DropdownMenuItem(
                              value: item.id,
                              child: Text(item.name),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setSheetState(() => preferredVoice = value);
                        }
                      },
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: _savingSettings ? null : save,
                      icon: _savingSettings
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: const Text('Save preferences'),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<TranslationOptions> _loadTranslationOptions() async {
    try {
      return await AzureAuthService.instance.fetchTranslationOptions();
    } catch (_) {
      return fallbackTranslationOptions;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vaani Setu'),
        actions: [
          IconButton(
            tooltip: 'Translation preferences',
            onPressed: _openTranslationSettings,
            icon: const Icon(Icons.tune),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: _signOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
          child: Column(
            children: [
              _OwnNumberCard(profile: _profile),
              const SizedBox(height: 12),
              _TranslationCard(profile: _profile),
              const SizedBox(height: 14),
              _NumberDisplay(
                prefix: NumberAssignmentService.prefix,
                suffix: _targetSuffix,
                status: _status,
              ),
              const SizedBox(height: 22),
              Expanded(child: _DialPad(onDigitPressed: _addDigit)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _ActionButton(
                    icon: Icons.close,
                    tooltip: 'Clear',
                    onPressed: _targetSuffix.isEmpty ? null : _clearNumber,
                  ),
                  const SizedBox(width: 20),
                  SizedBox.square(
                    dimension: 72,
                    child: FilledButton(
                      onPressed: _targetSuffix.length == 2 && !_checkingNumber
                          ? _startCall
                          : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF12834C),
                        disabledBackgroundColor: const Color(0xFFB9C7C2),
                        shape: const CircleBorder(),
                      ),
                      child: _checkingNumber
                          ? const SizedBox.square(
                              dimension: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.call, size: 30),
                    ),
                  ),
                  const SizedBox(width: 20),
                  _ActionButton(
                    icon: Icons.backspace_outlined,
                    tooltip: 'Delete',
                    onPressed: _targetSuffix.isEmpty ? null : _deleteDigit,
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

class _OwnNumberCard extends StatelessWidget {
  const _OwnNumberCard({required this.profile});

  final UserNumberProfile profile;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: const Color(0xFFE7F4F0),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFC2DDD6)),
      ),
      child: Row(
        children: [
          const Icon(Icons.badge_outlined, color: Color(0xFF0F766E)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Your number',
                  style: TextStyle(
                    color: Color(0xFF687570),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  profile.number,
                  style: const TextStyle(
                    color: Color(0xFF12332F),
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          if (profile.email.isNotEmpty)
            Flexible(
              child: Text(
                profile.email,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.right,
                style: const TextStyle(
                  color: Color(0xFF687570),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TranslationCard extends StatelessWidget {
  const _TranslationCard({required this.profile});

  final UserNumberProfile profile;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE0E5DF)),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF5EF),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(Icons.translate, color: Color(0xFF12834C)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${languageName(profile.spokenLanguage)} to ${languageName(profile.listenLanguage)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF12332F),
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Voice: ${voiceName(profile.preferredVoice)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF687570),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.tune, color: Color(0xFF687570)),
        ],
      ),
    );
  }
}

class _OptionDropdown extends StatelessWidget {
  const _OptionDropdown({
    required this.label,
    required this.icon,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final String value;
  final List<DropdownMenuItem<String>> items;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      items: items,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }
}

class _NumberDisplay extends StatelessWidget {
  const _NumberDisplay({
    required this.prefix,
    required this.suffix,
    required this.status,
  });

  final String prefix;
  final String suffix;
  final String status;

  @override
  Widget build(BuildContext context) {
    final missingDigits = 2 - suffix.length;

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
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: prefix),
                  TextSpan(
                    text: suffix,
                    style: const TextStyle(color: Color(0xFF12834C)),
                  ),
                  if (missingDigits > 0)
                    TextSpan(
                      text: '_' * missingDigits,
                      style: const TextStyle(color: Color(0xFF9AA6A1)),
                    ),
                ],
              ),
              maxLines: 1,
              style: const TextStyle(
                color: Color(0xFF12332F),
                fontSize: 34,
                fontWeight: FontWeight.w900,
                letterSpacing: 0,
              ),
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
      color: data.value.isEmpty ? Colors.transparent : Colors.white,
      elevation: data.value.isEmpty ? 0 : 2,
      shadowColor: const Color(0x18000000),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: data.value.isEmpty ? null : () => onPressed(data.value),
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
  _DialKeyData('', ''),
  _DialKeyData('0', '+'),
  _DialKeyData('', ''),
];
