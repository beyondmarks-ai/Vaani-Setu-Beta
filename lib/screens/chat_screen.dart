import 'dart:async';

import 'package:flutter/material.dart';

import '../services/history_service.dart';
import '../services/translation_options.dart';
import '../services/user_profile.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.profile,
    required this.remoteNumber,
    this.service,
  });

  final UserNumberProfile profile;
  final String remoteNumber;
  final HistoryService? service;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  late final HistoryService _service = widget.service ?? HistoryService();
  final _text = TextEditingController();
  final Map<String, HistoryItem> _messages = {};
  late String _source = widget.profile.spokenLanguage;
  late String _reading =
      _service.currentProfile?.messageLanguage ??
      widget.profile.messageLanguage;
  late String _style =
      _service.currentProfile?.messageTranslationStyle ??
      widget.profile.messageTranslationStyle;
  String? _cursor;
  String? _error;
  String? _pendingId;
  String? _pendingContent;
  bool _loading = true;
  bool _fetching = false;
  bool _sending = false;
  bool _savingLanguage = false;
  Timer? _timer;
  StreamSubscription<void>? _changes;

  String get _suffix => widget.remoteNumber.substring(4);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
    _changes = HistoryService.changes.stream.listen((_) => _refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh({bool older = false}) async {
    if (_fetching || !mounted) return;
    _fetching = true;
    try {
      var page = await _service.messages(
        _suffix,
        before: older ? _cursor : null,
      );
      final fetched = [...page.items];
      // Catch up across multiple pages after a long disconnection.
      if (!older && _messages.isNotEmpty) {
        while (page.nextCursor != null &&
            page.items.every(
              (item) => !_messages.containsKey(item['messageId']),
            )) {
          page = await _service.messages(_suffix, before: page.nextCursor);
          fetched.addAll(page.items);
        }
      }
      if (!mounted) return;
      setState(() {
        for (final item in fetched) {
          _messages[item['messageId'] as String] = item;
        }
        if (older || _loading || _cursor == null) _cursor = page.nextCursor;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Bad state: ', '');
          _loading = false;
        });
      }
    } finally {
      _fetching = false;
    }
  }

  Future<void> _send() async {
    final text = _text.text.trim();
    if (text.isEmpty || text.length > 1000 || _sending) return;
    final content = '$_source:$text';
    if (_pendingContent != content) {
      _pendingId = HistoryService.newMessageId();
      _pendingContent = content;
    }
    setState(() {
      _sending = true;
    });
    try {
      final message = await _service.send(
        suffix: _suffix,
        text: text,
        sourceLanguage: _source,
        messageId: _pendingId!,
      );
      if (!mounted) return;
      setState(() {
        _messages[message['messageId'] as String] = message;
        _text.clear();
        _pendingId = null;
        _pendingContent = null;
      });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', '')),
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  Future<void> _setReading(String? language) async {
    if (language == null) return;
    setState(() {
      _savingLanguage = true;
    });
    try {
      await _service.setReadingLanguage(language);
      if (mounted) {
        setState(() {
          _reading = language;
        });
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) {
        setState(() {
          _savingLanguage = false;
        });
      }
    }
  }

  Future<void> _setStyle(Set<String> selection) async {
    final style = selection.single;
    if (_savingLanguage || style == _style) return;
    setState(() => _savingLanguage = true);
    try {
      await _service.setTranslationStyle(_reading, style);
      if (mounted) setState(() => _style = style);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', '')),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _savingLanguage = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _changes?.cancel();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = _messages.values.toList()
      ..sort(
        (a, b) => '${b['createdAt']}|${b['messageId']}'.compareTo(
          '${a['createdAt']}|${a['messageId']}',
        ),
      );
    return Scaffold(
      appBar: AppBar(title: Text(widget.remoteNumber)),
      body: SafeArea(
        child: Column(
          children: [
            if (MediaQuery.viewInsetsOf(context).bottom == 0)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    LanguageSelector(
                      label: 'Read new messages in',
                      value: _reading,
                      onChanged: _savingLanguage ? null : _setReading,
                    ),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(
                          value: 'pure',
                          label: Text('Pure language'),
                        ),
                        ButtonSegment(
                          value: 'mixed',
                          label: Text('Mixed + English'),
                        ),
                      ],
                      selected: {_reading == 'en' ? 'pure' : _style},
                      onSelectionChanged: _savingLanguage || _reading == 'en'
                          ? null
                          : _setStyle,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _savingLanguage
                          ? 'Saving…'
                          : _reading == 'en'
                          ? 'English messages use English only.'
                          : 'Applies to new incoming messages in all chats.',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
            if (_error != null)
              MaterialBanner(
                content: Text(_error!),
                actions: [
                  TextButton(onPressed: _refresh, child: const Text('Retry')),
                ],
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : items.isEmpty
                  ? const Center(
                      child: Text('Send a message to start the conversation.'),
                    )
                  : ListView.builder(
                      reverse: true,
                      padding: const EdgeInsets.all(12),
                      itemCount: items.length + (_cursor == null ? 0 : 1),
                      itemBuilder: (context, index) {
                        if (index == items.length) {
                          return TextButton(
                            onPressed: () => _refresh(older: true),
                            child: const Text('Load older messages'),
                          );
                        }
                        final item = items[index];
                        final mine = item['senderUid'] == widget.profile.uid;
                        return Align(
                          alignment: mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          key: ValueKey(item['messageId']),
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 480),
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: mine
                                  ? const Color(0xFFE7F4F0)
                                  : const Color(0xFFF0F0F0),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SelectableText(
                                  messageText(item, widget.profile.uid),
                                ),
                                if (item['sourceLanguage'] !=
                                        item['targetLanguage'] ||
                                    item['originalText'] !=
                                        item['translatedText']) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    mine
                                        ? 'Translated to ${languageName(item['targetLanguage'] as String)}'
                                        : 'Translated from ${languageName(item['sourceLanguage'] as String)}',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.labelSmall,
                                  ),
                                  if (item['translationStyle'] != null)
                                    Text(
                                      item['translationStyle'] == 'mixed'
                                          ? 'Mixed + English'
                                          : 'Pure language',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.labelSmall,
                                    ),
                                  Material(
                                    type: MaterialType.transparency,
                                    child: ExpansionTile(
                                      tilePadding: EdgeInsets.zero,
                                      dense: true,
                                      title: Text(
                                        mine
                                            ? 'View translation'
                                            : 'View original',
                                      ),
                                      children: [
                                        SelectableText(
                                          (mine
                                                  ? item['translatedText']
                                                  : item['originalText'])
                                              as String,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                                Text(
                                  historyTime(item['createdAt']),
                                  style: Theme.of(context).textTheme.labelSmall,
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: LanguageSelector(
                label: 'I am writing in',
                value: _source,
                onChanged: _sending
                    ? null
                    : (value) => setState(() {
                        _source = value!;
                      }),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      enabled: !_sending,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 1000,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        errorText: _text.text.trim().length > 1000
                            ? 'Message is too long'
                            : null,
                        labelText: 'Message',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: 'Send message',
                    onPressed:
                        _sending ||
                            _text.text.trim().isEmpty ||
                            _text.text.trim().length > 1000
                        ? null
                        : _send,
                    icon: _sending
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class LanguageSelector extends StatelessWidget {
  const LanguageSelector({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
  });
  final String label;
  final String value;
  final ValueChanged<String?>? onChanged;

  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
    key: ValueKey('$label:$value'),
    initialValue: value,
    isExpanded: true,
    decoration: InputDecoration(
      labelText: label,
      border: const OutlineInputBorder(),
    ),
    items: fallbackTranslationOptions.languages
        .map(
          (language) => DropdownMenuItem(
            value: language.code,
            child: Text(language.name),
          ),
        )
        .toList(),
    onChanged: onChanged,
  );
}
