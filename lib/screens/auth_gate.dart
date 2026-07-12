import 'dart:async';

import 'package:flutter/material.dart';

import '../services/azure_auth_service.dart';
import '../services/notification_service.dart';
import 'dialer.dart';
import 'login_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  String? _notificationUid;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AzureAuthState>(
      stream: AzureAuthService.instance.authState,
      builder: (context, snapshot) {
        final state = snapshot.data ?? AzureAuthService.instance.state;
        if (state.loading) {
          return const _LoadingScreen();
        }

        final profile = state.profile;
        if (!state.signedIn || profile == null) {
          _notificationUid = null;
          unawaited(NotificationService.instance.detachUser());
          return const LoginScreen();
        }

        if (_notificationUid != profile.uid) {
          _notificationUid = profile.uid;
          unawaited(NotificationService.instance.attachUser(profile.uid));
        }

        return DialerScreen(profile: profile);
      },
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            const Text(
              'Loading...',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}
