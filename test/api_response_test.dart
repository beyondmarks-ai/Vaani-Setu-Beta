import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:vaani_setu/services/api_response.dart';

void main() {
  test(
    'HTML messaging 404 produces an actionable error, not FormatException',
    () {
      expect(
        () => decodeApiResponse(
          http.Response(
            '<!DOCTYPE html><p>Cannot GET /api/messages/02</p>',
            404,
          ),
        ),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            contains('unavailable on the server'),
          ),
        ),
      );
    },
  );

  test('HTML gateway failure does not expose the response body', () {
    expect(
      () => decodeApiResponse(
        http.Response('<html>proxy error details</html>', 502),
      ),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          'The server is temporarily unavailable. Please try again.',
        ),
      ),
    );
  });

  test('valid JSON API errors retain their useful message', () {
    expect(
      () => decodeApiResponse(
        http.Response('{"error":"No user has that Vaani number yet."}', 404),
      ),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          'No user has that Vaani number yet.',
        ),
      ),
    );
  });

  test('success responses must contain a JSON object', () {
    for (final invalid in ['<!DOCTYPE html>', '[]', 'null', '']) {
      expect(
        () => decodeApiResponse(http.Response(invalid, 200)),
        throwsStateError,
      );
    }
    expect(decodeApiResponse(http.Response('{"items":[]}', 200)), {
      'items': [],
    });
    expect(decodeApiResponse(http.Response('', 204)), isEmpty);
  });

  test(
    'invalid error fields and unauthorized HTML cannot crash the decoder',
    () {
      expect(
        () => decodeApiResponse(http.Response('{"error":{}}', 500)),
        throwsStateError,
      );
      expect(
        () =>
            decodeApiResponse(http.Response('<html>Unauthorized</html>', 401)),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            contains('sign in again'),
          ),
        ),
      );
    },
  );
}
