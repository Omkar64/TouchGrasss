package com.touchgrass.touchgrass

import android.content.ComponentName
import android.content.Intent
import android.app.Activity
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject

/** React Native Promise API for VPN, Accessibility, grants, and local focus timing. */
class TouchGrassAndroidModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {
    private var vpnPromise: Promise? = null
    private val handler = Handler(Looper.getMainLooper())
    init { context.addActivityEventListener(this) }
    override fun getName() = "TouchGrassAndroid"

    // VPN status is process state owned by DnsVpnService.
    @ReactMethod fun status(promise: Promise) = promise.resolve(DnsVpnService.isActive)
    @ReactMethod fun start(promise: Promise) {
        if (vpnPromise != null) return promise.reject("request_in_progress", "A VPN permission request is already open.")
        val activity = context.currentActivity ?: return promise.reject("activity_unavailable", "TouchGrass needs an open screen to request VPN permission.")
        vpnPromise = promise
        // Android requires the user to approve VPN use before the service can start.
        val intent = VpnService.prepare(context)
        if (intent == null) beginVpn() else activity.startActivityForResult(intent, VPN_REQUEST)
    }
    @ReactMethod fun stop(promise: Promise) {
        // Stop the service and update its persisted flag so the next launch shows the right state.
        val intent = Intent(context, DnsVpnService::class.java).setAction(DnsVpnService.ACTION_STOP)
        context.startService(intent)
        context.getSharedPreferences(DnsVpnService.PREFS, 0).edit().putBoolean(DnsVpnService.KEY_RUNNING, false).apply()
        DnsVpnService.isActive = false; promise.resolve(false)
    }
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != VPN_REQUEST) return
        if (resultCode == Activity.RESULT_OK) beginVpn() else { vpnPromise?.resolve(false); vpnPromise = null }
    }
    override fun onNewIntent(intent: Intent) = Unit
    private fun beginVpn() {
        try {
            val intent = Intent(context, DnsVpnService::class.java).setAction(DnsVpnService.ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            waitForVpn(40)
        } catch (e: Exception) { vpnPromise?.reject("vpn_start_failed", e.message, e); vpnPromise = null }
    }
    private fun waitForVpn(remaining: Int) {
        // Resolve the JS Promise only after the service reports active; fail after about four seconds.
        if (DnsVpnService.isActive) { vpnPromise?.resolve(true); vpnPromise = null }
        else if (remaining <= 0) { vpnPromise?.reject("vpn_start_timeout", "Grounded Mode did not start. Try again."); vpnPromise = null }
        else handler.postDelayed({ waitForVpn(remaining - 1) }, 100)
    }

    // Accessibility permission is owned by Android Settings; this reports permission and app toggle separately.
    @ReactMethod fun appBlockingStatus(promise: Promise) {
        val enabledServices = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val cmp = ComponentName(context, AppBlockingAccessibilityService::class.java)
        val access = enabledServices.split(':').any { it.equals(cmp.flattenToString(), true) || it.equals(cmp.flattenToShortString(), true) }
        val on = context.getSharedPreferences(DnsVpnService.PREFS, 0).getBoolean(AppBlockingAccessibilityService.KEY_APP_BLOCKING_ENABLED, false)
        promise.resolve(Arguments.createMap().apply { putBoolean("accessibilityEnabled", access); putBoolean("blockingEnabled", access && on) })
    }
    @ReactMethod fun openAppBlockingSettings(promise: Promise) { try { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(true) } catch (e: Exception) { promise.reject("settings_unavailable", e.message, e) } }
    // Never persist the enabled flag until Android confirms the user granted Accessibility access.
    @ReactMethod fun setAppBlockingEnabled(enabled: Boolean, promise: Promise) {
        val services = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val cmp = ComponentName(context, AppBlockingAccessibilityService::class.java)
        val access = services.split(':').any { it.equals(cmp.flattenToString(), true) || it.equals(cmp.flattenToShortString(), true) }
        if (enabled && !access) return promise.reject("accessibility_permission_required", "Enable TouchGrass app blocking in Android Accessibility settings first.")
        context.getSharedPreferences(DnsVpnService.PREFS, 0).edit().putBoolean(AppBlockingAccessibilityService.KEY_APP_BLOCKING_ENABLED, enabled).apply(); promise.resolve(enabled)
    }

    /**
     * Stores the per-app windows used by the VPN/accessibility services, plus a
     * short history of grant windows. The history lets a focus session subtract
     * every approved pass interval, even after the grant has expired or the app
     * was closed while the pass was running.
     */
    // Persist active grant windows for enforcement and retain recent history for focus-time accounting.
    @ReactMethod fun setUnlockGrants(grants: ReadableArray, promise: Promise) {
        val prefs = context.getSharedPreferences(DnsVpnService.PREFS, 0)
        val editor = prefs.edit()
        TARGETS.forEach { editor.remove("grant_$it") }
        val now = System.currentTimeMillis()
        val cutoff = now - GRANT_HISTORY_MILLIS
        val merged = JSONArray()
        val seen = mutableSetOf<String>()
        fun remember(target: String, usable: Long, expires: Long) {
            // Ignore invalid/old windows and avoid counting the same approved pass twice.
            if (expires <= usable || expires <= cutoff) return
            val id = "$target:$usable:$expires"
            if (!seen.add(id)) return
            merged.put(JSONObject().put("targetKey", target).put("usableAtMillis", usable).put("expiresAtMillis", expires))
        }
        prefs.getString(GRANT_HISTORY_KEY, null)?.let { raw ->
            try {
                val previous = JSONArray(raw)
                for (i in 0 until previous.length()) {
                    val item = previous.optJSONObject(i) ?: continue
                    remember(item.optString("targetKey"), item.optLong("usableAtMillis"), item.optLong("expiresAtMillis"))
                }
            } catch (_: Exception) { /* Ignore a corrupt history and rebuild it. */ }
        }
        // Store future/current windows by app for enforcement, and merge valid windows into history.
        for (i in 0 until grants.size()) {
            val grant = grants.getMap(i) ?: continue
            val key = grant.getString("targetKey") ?: continue
            if (key !in TARGETS) continue
            val usable = grant.getDouble("usableAtMillis").toLong()
            val expires = grant.getDouble("expiresAtMillis").toLong()
            if (expires > now) editor.putString("grant_$key", "$usable:$expires")
            remember(key, usable, expires)
        }
        editor.putString(GRANT_HISTORY_KEY, merged.toString()).apply()
        promise.resolve(true)
    }

    // Focus timing is stored on-device per account so an Android process restart does not lose the timer.
    @ReactMethod fun focusProgress(userId: String, promise: Promise) = promise.resolve(progress(userId))
    @ReactMethod fun startFocus(userId: String, durationMinutes: Int, promise: Promise) {
        if (durationMinutes !in 1..1440) return promise.reject("invalid_duration", "Choose a focus duration between 1 and 1,440 minutes.")
        // A focus session may start only when the VPN or Accessibility blocker is active.
        val blockingPrefs = context.getSharedPreferences(DnsVpnService.PREFS, 0)
        val enabledServices = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val component = ComponentName(context, AppBlockingAccessibilityService::class.java)
        val accessibility = enabledServices.split(':').any { it.equals(component.flattenToString(), true) || it.equals(component.flattenToShortString(), true) }
        val blocking = accessibility && blockingPrefs.getBoolean(AppBlockingAccessibilityService.KEY_APP_BLOCKING_ENABLED, false)
        if (!DnsVpnService.isActive && !blocking) return promise.reject("blocking_required", "Turn on Grounded Mode or app blocking before starting focus.")
        val focusPrefs = focusPrefs(userId)
        if (focusPrefs.getLong("focus_start_millis", 0L) == 0L) {
            val start = System.currentTimeMillis()
            focusPrefs.edit().putLong("focus_start_millis", start)
                .putLong("focus_duration_millis", durationMinutes * 60_000L)
                .putLong("focus_target_millis", start + durationMinutes * 60_000L).apply()
        }
        promise.resolve(progress(userId))
    }
    @ReactMethod fun stopFocus(userId: String, complete: Boolean, promise: Promise) {
        val prefs = focusPrefs(userId)
        val start = prefs.getLong("focus_start_millis", 0L)
        val duration = durationMillis(prefs)
        val now = System.currentTimeMillis()
        var elapsed = 0L
        // Approved pass intervals pause the focus clock; only reaching the adjusted target earns credit.
        val completed = start > 0L && duration > 0L && complete && (now - start - pausedMillis(start, now)) >= duration
        if (start > 0) {
            elapsed = ((now - start - pausedMillis(start, now)) / 1000L).coerceIn(0L, 86400L)
            prefs.edit().remove("focus_start_millis").remove("focus_duration_millis").remove("focus_target_millis").apply()
        }
        promise.resolve(Arguments.createMap().apply { putDouble("durationSeconds", elapsed.toDouble()); putBoolean("completed", completed) })
    }
    // Keep each account's local timer isolated in its own preference file.
    private fun focusPrefs(userId: String) = context.getSharedPreferences("focus_session_$userId", 0)
    private fun durationMillis(prefs: android.content.SharedPreferences): Long {
        val stored = prefs.getLong("focus_duration_millis", 0L)
        if (stored > 0L) return stored
        val start = prefs.getLong("focus_start_millis", 0L)
        val target = prefs.getLong("focus_target_millis", 0L)
        return if (start > 0L && target > start) target - start else 0L
    }
    private fun grantWindows(): List<Pair<Long, Long>> {
        // Convert the JSON history into validated [usable, expires) time intervals.
        val prefs = context.getSharedPreferences(DnsVpnService.PREFS, 0)
        val raw = prefs.getString(GRANT_HISTORY_KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { i ->
                val item = array.optJSONObject(i) ?: return@mapNotNull null
                val usable = item.optLong("usableAtMillis", 0L)
                val expires = item.optLong("expiresAtMillis", 0L)
                if (expires > usable) usable to expires else null
            }
        } catch (_: Exception) { emptyList() }
    }
    /** Total approved-pass time that overlapped [start, now], merging overlaps. */
    private fun pausedMillis(start: Long, now: Long): Long {
        // Clip each grant to the session range, sort them, then merge overlaps before summing.
        val clipped = grantWindows()
            .map { (usable, expires) -> maxOf(start, usable) to minOf(now, expires) }
            .filter { it.second > it.first }
            .sortedBy { it.first }
        var total = 0L
        var currentStart = -1L
        var currentEnd = -1L
        for ((from, until) in clipped) {
            if (currentEnd < from) {
                if (currentEnd > currentStart) total += currentEnd - currentStart
                currentStart = from
                currentEnd = until
            } else if (until > currentEnd) {
                currentEnd = until
            }
        }
        if (currentEnd > currentStart) total += currentEnd - currentStart
        return total
    }
    private fun progress(userId: String): WritableMap {
        // Convert wall-clock time into elapsed/remaining values after subtracting approved-pass time.
        val prefs = focusPrefs(userId)
        val start = prefs.getLong("focus_start_millis", 0L)
        val duration = durationMillis(prefs)
        val active = start > 0L && duration > 0L
        val now = System.currentTimeMillis()
        val paused = if (active) pausedMillis(start, now) else 0L
        val effective = if (active) now - start - paused else 0L
        val elapsed = if (active) (effective / 1000L).coerceIn(0L, 86400L) else 0L
        val remaining = if (active) (((duration - effective) + 999L) / 1000L).coerceAtLeast(0L) else 0L
        val target = if (active) start + duration + paused else 0L
        val activeWindow = if (active) grantWindows().firstOrNull { now >= it.first && now < it.second } else null
        return Arguments.createMap().apply {
            putDouble("sessionStartMillis", start.toDouble())
            putDouble("sessionTargetMillis", target.toDouble())
            putBoolean("sessionActive", active)
            putDouble("elapsedSeconds", elapsed.toDouble())
            putDouble("remainingSeconds", remaining.toDouble())
            putDouble("pausedMillis", paused.toDouble())
            putDouble("pausedUntilMillis", (activeWindow?.second ?: 0L).toDouble())
        }
    }
    companion object {
        // Shared constants must match the request code, grant-history key, and app keys used by JS/services.
        private const val VPN_REQUEST = 7124
        private const val GRANT_HISTORY_KEY = "grant_windows"
        private const val GRANT_HISTORY_MILLIS = 24L * 60L * 60L * 1000L
        private val TARGETS = listOf("instagram", "tiktok", "x", "reddit", "snapchat", "facebook", "youtube")
    }
}
