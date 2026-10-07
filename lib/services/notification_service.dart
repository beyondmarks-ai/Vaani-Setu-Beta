import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'azure_auth_service.dart';
import 'call_event_service.dart';
import 'call_service.dart';
import 'history_service.dart';
import 'incoming_call_presenter.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  DartPluginRegistrant.ensureInitialized();
  if (message.data['type'] == 'incoming_call') return;
  await NotificationService.instance.handleRemoteMessage(
    message,
    showNotification: true,
  );
}

class NotificationService with WidgetsBindingObserver {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  static const _nativeIncomingCallChannel = MethodChannel(
    'vaani_setu/incoming_call',
  );

  static const _bridgeUrl = String.fromEnvironment(
    'BRIDGE_URL',
    defaultValue:
        'https://vaani-setu-bridge.happycoast-2d2c0fea.centralindia.azurecontainerapps.io',
  );

  GlobalKey<NavigatorState>? _navigatorKey;
  IncomingCallPresenter? _incomingPresenter;
  String? _currentUid;
  bool _initialized = false;
  bool _signalStopped = true;
  VaaniCall? _pendingCall;
  WebSocket? _signalSocket;
  Timer? _signalReconnectTimer;
  bool _signalConnecting = false;
  int _signalGeneration = 0;
  StreamSubscription<String>? _tokenRefreshSubscription;

  Future<void> initialize(GlobalKey<NavigatorState> navigatorKey) async {
    _navigatorKey = navigatorKey;
    _incomingPresenter ??= IncomingCallPresenter(
      navigatorKey,
      () => _currentUid,
    );
    if (_initialized) return;
    _initialized = true;
    WidgetsBinding.instance.addObserver(this);

    await _messaging.requestPermission(alert: true, badge: true, sound: true);
    await _initializeLocalNotifications();
    _nativeIncomingCallChannel.setMethodCallHandler(_handleNativeIncomingCall);
    await _consumeInitialNativeIncomingCall();

    FirebaseMessaging.onMessage.listen(
      (message) => handleRemoteMessage(message, showNotification: false),
    );
    FirebaseMessaging.onMessageOpenedApp.listen(
      (message) => handleRemoteMessage(message, showNotification: false),
    );

    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      await handleRemoteMessage(initialMessage, showNotification: false);
    }
  }

  Future<void> attachUser(String uid) async {
    if (_currentUid == uid) {
      _startRealtimeSignal();
      unawaited(_syncTokenSafely());
      await _flushPendingCall();
      return;
    }

    if (_currentUid != null) await detachUser();
    _currentUid = uid;
    _startRealtimeSignal();
    unawaited(_syncTokenSafely());
    await _flushPendingCall();
  }

  Future<void> cancelIncomingCall(String callId) async {
    if (callId.isEmpty) return;
    await _localNotifications.cancel(id: callId.hashCode);
    try {
      await _nativeIncomingCallChannel.invokeMethod<void>(
        'cancelIncomingCall',
        {'callId': callId},
      );
    } catch (error) {
      debugPrint('Native call notification cancel failed: $error');
    }
  }

  Future<void> detachUser() async {
    _currentUid = null;
    _pendingCall = null;
    _signalStopped = true;
    _signalGeneration++;
    _signalConnecting = false;
    _signalReconnectTimer?.cancel();
    _signalReconnectTimer = null;
    await _signalSocket?.close();
    _signalSocket = null;
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;
  }

  Future<dynamic> _handleNativeIncomingCall(MethodCall call) async {
    if (call.method != 'incomingCall') return null;
    final arguments = call.arguments;
    if (arguments is Map) {
      await _handleIncomingCallData(Map<String, dynamic>.from(arguments));
    }
    return null;
  }

  Future<void> _consumeInitialNativeIncomingCall() async {
    final data = await _nativeIncomingCallChannel
        .invokeMapMethod<String, dynamic>('getInitialIncomingCall');
    if (data == null) return;
    await _handleIncomingCallData(data);
  }

  Future<void> _handleIncomingCallData(Map<String, dynamic> data) async {
    if (_isExpired(data)) return;
    final call = _callFromData(data);
    if (call == null || call.isEnded) return;
    if (_currentUid != null && call.calleeUid != _currentUid) return;
    CallEventService.instance.emit(call);
    _pendingCall = call;
    await _showIncomingCall(call);
  }

  Future<void> handleRemoteMessage(
    RemoteMessage message, {
    required bool showNotification,
  }) async {
    if (_isExpired(message.data)) return;

    final call = _callFromData(message.data);
    if (call == null) return;
    if (_currentUid != null && call.calleeUid != _currentUid) return;

    CallEventService.instance.emit(call);
    if (call.isEnded) return;

    _pendingCall = call;
    if (showNotification) {
      await _showIncomingCallNotification(call);
      return;
    }

    await _showIncomingCall(call);
  }

  Future<void> _initializeLocalNotifications() async {
    if (!Platform.isAndroid) return;

    const androidSettings = AndroidInitializationSettings(
      '@drawable/ic_launcher',
    );
    await _localNotifications.initialize(
      settings: const InitializationSettings(android: androidSettings),
      onDidReceiveNotificationResponse: (response) async {
        final payload = response.payload;
        if (payload == null || payload.isEmpty) return;

        final data = jsonDecode(payload) as Map<String, dynamic>;
        if (_isExpired(data)) return;

        final call = _callFromData(data);
        if (call == null) return;
        await _showIncomingCall(call);
      },
    );

    const channel = AndroidNotificationChannel(
      'incoming_calls',
      'Incoming calls',
      description: 'Incoming call alerts for Vaani Setu',
      importance: Importance.max,
    );
    final androidPlugin = _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    await androidPlugin?.createNotificationChannel(channel);
  }

  Future<void> _syncTokenSafely() async {
    try {
      await _syncToken();
    } catch (error) {
      debugPrint('Push token sync failed: $error');
    }
  }

  Future<void> _syncToken() async {
    final uid = _currentUid;
    if (uid == null) return;
    final token = await _messaging.getToken().timeout(
      const Duration(seconds: 10),
    );
    if (_currentUid != uid) return;
    if (token == null || token.isEmpty) return;
    await _writePushToken(token);

    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = _messaging.onTokenRefresh.listen((
      freshToken,
    ) async {
      try {
        if (_currentUid != uid) return;
        await _writePushToken(freshToken);
      } catch (error) {
        debugPrint('Push token refresh failed: $error');
      }
    });
  }

  Future<void> _writePushToken(String token) {
    return AzureAuthService.instance.authorizedPost('/api/push-tokens', {
      'token': token,
      'platform': 'android',
    });
  }

  void _startRealtimeSignal() {
    if (_bridgeUrl.isEmpty || _signalSocket != null) return;
    _signalStopped = false;
    unawaited(_connectRealtimeSignal());
  }

  Future<void> _connectRealtimeSignal() async {
    if (_signalStopped || _signalSocket != null || _signalConnecting) return;
    _signalConnecting = true;
    final generation = _signalGeneration;

    try {
      final tokenBody = await AzureAuthService.instance.authorizedPost(
        '/api/realtime-token',
        const {},
      );
      final socketUrl = tokenBody['url'] as String? ?? '';
      if (socketUrl.isEmpty) throw StateError('Realtime token missing.');
      if (_signalStopped || generation != _signalGeneration) return;

      final socket = await WebSocket.connect(socketUrl);
      if (_signalStopped || generation != _signalGeneration) {
        await socket.close();
        return;
      }
      socket.pingInterval = const Duration(seconds: 20);
      _signalSocket = socket;
      socket.listen(
        _handleSignalMessage,
        onDone: () {
          if (identical(_signalSocket, socket)) _handleSignalClosed();
        },
        onError: (_) {
          if (identical(_signalSocket, socket)) _handleSignalClosed();
        },
        cancelOnError: true,
      );
    } catch (error) {
      debugPrint('Call signal connection failed: $error');
      if (generation == _signalGeneration) _handleSignalClosed();
    } finally {
      if (generation == _signalGeneration) _signalConnecting = false;
    }
  }

  void _handleSignalMessage(dynamic message) {
    if (message is! String) return;

    Map<String, dynamic>? data;
    try {
      data = _signalDataFromDecoded(jsonDecode(message));
    } on FormatException {
      return;
    }
    if (data == null || data['type'] == 'ready') return;

    if (_isExpired(data)) return;

    final call = _callFromData(data);
    if (call == null) return;
    CallEventService.instance.emit(call);
    if (call.status != 'ringing') unawaited(cancelIncomingCall(call.id));
    if (call.isEnded) return;
    if (data['type'] == 'incoming_call') {
      if (_currentUid != null && call.calleeUid != _currentUid) return;
      unawaited(_showIncomingCall(call));
    }
  }

  Map<String, dynamic>? _signalDataFromDecoded(dynamic decoded) {
    if (decoded is! Map<String, dynamic>) return null;
    if (decoded['type'] == 'system') return null;

    final data = decoded['data'];
    if (decoded['type'] == 'message' && data is Map) {
      return Map<String, dynamic>.from(data);
    }
    if (decoded['type'] == 'message' && data is String) {
      final nested = jsonDecode(data);
      return nested is Map ? Map<String, dynamic>.from(nested) : null;
    }
    return decoded;
  }

  void _handleSignalClosed() {
    _signalSocket = null;
    if (_signalStopped || _currentUid == null) return;
    _signalReconnectTimer?.cancel();
    _signalReconnectTimer = Timer(
      const Duration(seconds: 2),
      () => unawaited(_connectRealtimeSignal()),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _currentUid != null) {
      _startRealtimeSignal();
      unawaited(_flushPendingCall());
    }
  }

  VaaniCall? _callFromData(Map<String, dynamic> data) {
    final type = data['type'];
    if (type == 'new_message' || type == 'call_update') {
      HistoryService.changes.add(null);
    }
    if (type != 'incoming_call' && type != 'call_update') return null;
    final callId = data['callId'] as String? ?? '';
    if (callId.isEmpty) return null;
    return VaaniCall.fromMap(callId, data);
  }

  bool _isExpired(Map<String, dynamic> data) {
    final rawExpiresAt = data['expiresAt'] as String? ?? '';
    if (rawExpiresAt.isEmpty) return false;
    final expiresAt = DateTime.tryParse(rawExpiresAt);
    return expiresAt != null &&
        DateTime.now().toUtc().isAfter(expiresAt.toUtc());
  }

  Future<void> _showIncomingCallNotification(VaaniCall call) async {
    if (!Platform.isAndroid) return;

    final payload = jsonEncode({
      'type': 'incoming_call',
      'callId': call.id,
      'callerUid': call.callerUid,
      'calleeUid': call.calleeUid,
      'callerNumber': call.callerNumber,
      'calleeNumber': call.calleeNumber,
      'status': call.status,
      'callerLanguage': call.callerLanguage,
      'calleeLanguage': call.calleeLanguage,
      'expiresAt': call.expiresAt,
    });

    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'incoming_calls',
        'Incoming calls',
        channelDescription: 'Incoming call alerts for Vaani Setu',
        importance: Importance.max,
        priority: Priority.max,
        category: AndroidNotificationCategory.call,
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: true,
        visibility: NotificationVisibility.public,
      ),
    );

    await _localNotifications.show(
      id: call.id.hashCode,
      title: 'Incoming call',
      body: 'Call from ${call.callerNumber}',
      notificationDetails: details,
      payload: payload,
    );
  }

  Future<void> _flushPendingCall() async {
    final call = _pendingCall;
    if (call == null) return;
    _pendingCall = null;
    await _showIncomingCall(call);
  }

  Future<void> _showIncomingCall(VaaniCall call) async {
    if (call.status != 'ringing' || _isExpired({'expiresAt': call.expiresAt})) {
      return;
    }
    if (_currentUid == null || _navigatorKey?.currentState == null) {
      _pendingCall = call;
      return;
    }
    _incomingPresenter?.show(call);
  }
}
