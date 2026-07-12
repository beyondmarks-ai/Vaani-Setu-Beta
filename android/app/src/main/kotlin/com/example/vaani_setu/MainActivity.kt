package com.example.vaani_setu

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val incomingCallChannel = "vaani_setu/incoming_call"
    private var channel: MethodChannel? = null
    private var latestIncomingCall: Map<String, String>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, incomingCallChannel)
        channel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "getInitialIncomingCall" -> {
                    result.success(latestIncomingCall ?: incomingCallFromIntent(intent))
                    latestIncomingCall = null
                }
                else -> result.notImplemented()
            }
        }
        latestIncomingCall = incomingCallFromIntent(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        latestIncomingCall = incomingCallFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        latestIncomingCall = incomingCallFromIntent(intent)
        latestIncomingCall?.let { channel?.invokeMethod("incomingCall", it) }
    }

    private fun cancelIncomingCall(callId: String) {
        if (callId.isEmpty()) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(callId.hashCode())
    }

    private fun incomingCallFromIntent(intent: Intent?): Map<String, String>? {
        val extras = intent?.extras ?: return null
        val type = extras.getString("type") ?: return null
        if (type != "incoming_call") return null

        val data = mutableMapOf<String, String>()
        for (key in extras.keySet()) {
            extras.get(key)?.let { data[key] = it.toString() }
        }
        return data
    }
}
