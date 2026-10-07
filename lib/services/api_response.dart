import 'dart:convert';

import 'package:http/http.dart' as http;

/// Check the HTTP result before exposing a JSON payload to callers.
Map<String, dynamic> decodeApiResponse(http.Response response) {
  Map<String, dynamic>? body;
  if (response.body.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } on FormatException {
      // Proxies and older deployments can return HTML error pages.
    }
  }

  final status = response.statusCode;
  if (status < 200 || status >= 300) {
    final message = body?['error'];
    if (message is String && message.trim().isNotEmpty) {
      throw StateError(message);
    }
    if (status == 401 || status == 403) {
      throw StateError(
        'Your session could not be verified. Please sign in again.',
      );
    }
    if (status == 404) {
      throw StateError(
        'This feature is unavailable on the server. Please try again later.',
      );
    }
    if (status == 429) {
      throw StateError('Too many requests. Please wait a moment and retry.');
    }
    throw StateError(
      'The server is temporarily unavailable. Please try again.',
    );
  }

  if (body != null) return body;
  if (status == 204 && response.body.trim().isEmpty) return {};
  throw StateError(
    'The server returned an invalid response. Please try again.',
  );
}
