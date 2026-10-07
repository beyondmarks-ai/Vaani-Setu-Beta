import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/azure_auth_service.dart';
import '../services/history_service.dart';
import '../services/user_profile.dart';
import 'chat_screen.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({
    super.key,
    required this.profile,
    this.service,
    this.showCalls = false,
  });
  final UserNumberProfile profile;
  final HistoryService? service;
  final bool showCalls;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen>
    with WidgetsBindingObserver {
  late final HistoryService _service = widget.service ?? HistoryService();
  List<HistoryItem> _items = [];
  String? _cursor;
  String? _error;
  bool _loading = true;
  bool _fetching = false;
  Timer? _timer;
  StreamSubscription<void>? _changes;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
    _changes = HistoryService.changes.stream.listen((_) => _load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load({bool older = false}) async {
    if (_fetching || !mounted) return;
    _fetching = true;
    try {
      final page = widget.showCalls
          ? await _service.calls(before: older ? _cursor : null)
          : null;
      final items = page?.items ?? await _service.conversations();
      if (!mounted) return;
      setState(() {
        if (widget.showCalls && !_loading) {
          final merged = {
            for (final item in _items) item['callId']: item,
            for (final item in items) item['callId']: item,
          };
          _items = merged.values.toList()
            ..sort(
              (a, b) => '${b['createdAt']}|${b['callId']}'.compareTo(
                '${a['createdAt']}|${a['callId']}',
              ),
            );
        } else {
          _items = items;
        }
        if (older || _loading || _cursor == null) _cursor = page?.nextCursor;
        _error = null;
        _loading = false;
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

  Future<void> _openChat(String number) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatScreen(
          profile: AzureAuthService.instance.profile ?? widget.profile,
          remoteNumber: number,
          service: _service,
        ),
      ),
    );
    if (mounted) _load();
  }

  Future<void> _newMessage() async {
    final controller = TextEditingController();
    final form = GlobalKey<FormState>();
    final number = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New message'),
        content: Form(
          key: form,
          child: TextFormField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Vaani number',
              hintText: 'Last 2 digits or 0209XX',
            ),
            validator: (value) {
              final text = value ?? '';
              final normalized = text.length == 2 ? '0209$text' : text;
              if (!RegExp(r'^0209\d{2}$').hasMatch(normalized)) {
                return 'Enter 2 digits or the full Vaani number';
              }
              if (normalized == widget.profile.number) {
                return 'Enter another user’s number';
              }
              return null;
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState!.validate()) {
                final text = controller.text;
                Navigator.pop(context, text.length == 2 ? '0209$text' : text);
              }
            },
            child: const Text('Open chat'),
          ),
        ],
      ),
    );
    // Wait for the dialog route's reverse animation before disposing its field.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    controller.dispose();
    if (number != null && mounted) await _openChat(number);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _changes?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.showCalls ? 'Call history' : 'Messages'),
      actions: [
        IconButton(
          tooltip: 'Refresh',
          onPressed: _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    floatingActionButton: widget.showCalls
        ? null
        : FloatingActionButton.extended(
            onPressed: _newMessage,
            icon: const Icon(Icons.edit_outlined),
            label: const Text('New message'),
          ),
    body: Column(
      children: [
        if (_error != null)
          MaterialBanner(
            content: Text(_error!),
            actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
          ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _items.isEmpty
              ? Center(
                  child: Text(
                    widget.showCalls ? 'No calls yet' : 'No messages yet',
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: 96),
                    itemCount: _items.length + (_cursor == null ? 0 : 1),
                    itemBuilder: (context, index) {
                      if (index == _items.length) {
                        return TextButton(
                          onPressed: () => _load(older: true),
                          child: const Text('Load older calls'),
                        );
                      }
                      final item = _items[index];
                      final number = item['remoteNumber'] as String;
                      if (widget.showCalls) {
                        final incoming = item['direction'] == 'incoming';
                        final seconds = item['durationSeconds'] as int;
                        final duration =
                            '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
                        return ListTile(
                          leading: Icon(
                            item['outcome'] == 'missed'
                                ? Icons.call_missed
                                : incoming
                                ? Icons.call_received
                                : Icons.call_made,
                            color: item['outcome'] == 'missed'
                                ? Colors.red
                                : null,
                          ),
                          title: Text(number),
                          subtitle: Text(
                            '${incoming ? 'Incoming' : 'Outgoing'} · ${item['outcome']}\n${historyTime(item['createdAt'])}'
                            '${item['outcome'] == 'completed' ? ' · $duration' : ''}',
                          ),
                          isThreeLine: true,
                          trailing: IconButton(
                            tooltip: 'Message $number',
                            icon: const Icon(Icons.chat_bubble_outline),
                            onPressed: () => _openChat(number),
                          ),
                        );
                      }
                      final message = item['message'] as HistoryItem;
                      return ListTile(
                        leading: const CircleAvatar(
                          child: Icon(Icons.person_outline),
                        ),
                        title: Text(number),
                        subtitle: Text(
                          messageText(message, widget.profile.uid),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Text(historyTime(message['createdAt'])),
                        onTap: () => _openChat(number),
                      );
                    },
                  ),
                ),
        ),
      ],
    ),
  );
}
