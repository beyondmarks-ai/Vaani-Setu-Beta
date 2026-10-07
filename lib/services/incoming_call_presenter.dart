import 'package:flutter/material.dart';

import '../screens/incoming_call_screen.dart';
import 'call_service.dart';

/// Presents socket/push invitations even while Flutter has no frame scheduled.
class IncomingCallPresenter {
  IncomingCallPresenter(this.navigatorKey, this.currentUid);

  final GlobalKey<NavigatorState> navigatorKey;
  final String? Function() currentUid;
  final Set<String> _presented = {};

  bool _canPresent(VaaniCall call) {
    final expires = DateTime.tryParse(call.expiresAt);
    return currentUid() == call.calleeUid &&
        call.status == 'ringing' &&
        (expires == null || expires.isAfter(DateTime.now()));
  }

  bool show(VaaniCall call) {
    if (!_canPresent(call)) return false;
    if (_presented.contains(call.id)) return true;
    if (navigatorKey.currentState == null) return false;
    _presented.add(call.id);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final navigator = navigatorKey.currentState;
      if (navigator == null || !_canPresent(call)) {
        _presented.remove(call.id);
        return;
      }
      navigator
          .push(
            MaterialPageRoute<void>(
              builder: (_) => IncomingCallScreen(call: call),
            ),
          )
          .whenComplete(() => _presented.remove(call.id));
    });
    // Socket events don't mark a widget dirty. Without this, ringing waits
    // indefinitely for a tap or another event to cause the next frame.
    WidgetsBinding.instance.ensureVisualUpdate();
    return true;
  }
}
