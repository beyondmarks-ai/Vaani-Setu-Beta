import 'dart:async';

import 'call_service.dart';

class CallEventService {
  CallEventService._();

  static final CallEventService instance = CallEventService._();

  final Map<String, StreamController<VaaniCall?>> _controllers = {};
  final Map<String, VaaniCall> _latestCalls = {};

  Stream<VaaniCall?> watchCall(String callId) async* {
    yield _latestCalls[callId];
    yield* _controllerFor(callId).stream;
  }

  void emit(VaaniCall call) {
    _latestCalls[call.id] = call;
    _controllerFor(call.id).add(call);
  }

  StreamController<VaaniCall?> _controllerFor(String callId) {
    return _controllers.putIfAbsent(
      callId,
      () => StreamController<VaaniCall?>.broadcast(),
    );
  }
}
