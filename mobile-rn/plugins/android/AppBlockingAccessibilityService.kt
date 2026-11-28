package com.touchgrass.touchgrassrn
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/** Detects selected foreground packages only; it never retrieves the app's view tree. */
class AppBlockingAccessibilityService : AccessibilityService() {
    companion object {
        const val KEY_APP_BLOCKING_ENABLED = "app_blocking_enabled"
        private val blockedPackages = mapOf(
            "com.instagram.android" to "Instagram",
            "com.zhiliaoapp.musically" to "TikTok",
            "com.reddit.frontpage" to "Reddit",
            "com.twitter.android" to "X",
            "com.snapchat.android" to "Snapchat",
            "com.facebook.katana" to "Facebook",
            "com.google.android.youtube" to "YouTube",
        )
    }

    private var overlay: View? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val dismissOverlay = Runnable { removeOverlay() }
    private val windowManager by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }

    override fun onServiceConnected() {
        // Subscribe only to foreground-window changes; the service does not inspect window contents.
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 120
            flags = 0
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val foregroundPackage = event?.packageName?.toString() ?: return
        // Adding the accessibility overlay can itself generate window events for
        // TouchGrass/system UI. Ignore our own events so they do not tear it down.
        if (foregroundPackage == packageName) return
        if (!appBlockingEnabled()) {
            mainHandler.removeCallbacks(dismissOverlay)
            removeOverlay()
            return
        }

        // Only package names in this allowlist trigger the full-screen blocking overlay.
        val appName = blockedPackages[foregroundPackage]
        if (appName != null) {
            mainHandler.removeCallbacks(dismissOverlay)
            if (hasActivePass(foregroundPackage)) removeOverlay() else showOverlay(appName)
        } else {
            // Android/OEM launch transitions can briefly report launcher or
            // System UI while the blocked app is still opening. Wait for a
            // stable non-blocked window before dismissing the blocker.
            mainHandler.removeCallbacks(dismissOverlay)
            mainHandler.postDelayed(dismissOverlay, 700)
        }
    }

    override fun onInterrupt() {
        mainHandler.removeCallbacks(dismissOverlay)
        removeOverlay()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        mainHandler.removeCallbacks(dismissOverlay)
        removeOverlay()
        return super.onUnbind(intent)
    }

    private fun appBlockingEnabled(): Boolean = getSharedPreferences(DnsVpnService.PREFS, MODE_PRIVATE)
        .getBoolean(KEY_APP_BLOCKING_ENABLED, false)

    private fun hasActivePass(app: String): Boolean {
        // Translate Android package names to the grant keys shared with the VPN and React Native code.
        val key = when (app) {
            "com.instagram.android" -> "instagram"
            "com.zhiliaoapp.musically" -> "tiktok"
            "com.reddit.frontpage" -> "reddit"
            "com.twitter.android" -> "x"
            "com.snapchat.android" -> "snapchat"
            "com.facebook.katana" -> "facebook"
            "com.google.android.youtube" -> "youtube"
            else -> return false
        }
        val limits = getSharedPreferences(DnsVpnService.PREFS, MODE_PRIVATE).getString("grant_$key", null)?.split(":") ?: return false
        if (limits.size != 2) return false
        val now = System.currentTimeMillis()
        val usable = limits[0].toLongOrNull() ?: return false
        val expires = limits[1].toLongOrNull() ?: return false
        return now >= usable && now < expires
    }

    private fun showOverlay(appName: String) {
        // Build a system-level accessibility overlay; if unavailable, send the user to Home instead.
        if (overlay != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(18, 43, 32))
            isClickable = true
            isFocusable = true
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
        }
        val leaf = TextView(this).apply {
            text = "🌿"
            textSize = 42f
            gravity = Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = "A moment for you."
            textSize = 27f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(8))
        }
        val detail = TextView(this).apply {
            text = "$appName is paused while app blocking is on. Open TouchGrass if you want to ask your gatekeeper for a pass."
            textSize = 15f
            setTextColor(Color.rgb(218, 231, 218))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(24))
        }
        val passButton = Button(this).apply {
            text = "Open TouchGrass"
            setTextColor(Color.rgb(24, 58, 43))
            background = roundedBackground(Color.rgb(217, 237, 201))
            setOnClickListener { openTouchGrass() }
        }
        val homeButton = Button(this).apply {
            text = "Back to focus"
            setTextColor(Color.WHITE)
            background = roundedBackground(Color.rgb(43, 80, 61))
            setOnClickListener { performGlobalAction(GLOBAL_ACTION_HOME) }
        }
        content.addView(leaf, centeredParams())
        content.addView(title, centeredParams())
        content.addView(detail, centeredParams())
        content.addView(passButton, buttonParams())
        content.addView(homeButton, buttonParams())
        root.addView(content, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))

        // Accessibility overlays are permitted without drawing over other apps permission.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        }
        val params = WindowManager.LayoutParams(
            -1,
            -1,
            type,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            android.graphics.PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }

        try {
            windowManager.addView(root, params)
            overlay = root
        } catch (_: Exception) {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    private fun openTouchGrass() {
        // Remove the blocker before bringing the main app forward so it can request a Gatekeeper pass.
        removeOverlay()
        packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(intent)
        }
    }

    private fun removeOverlay() {
        // This can be called from several lifecycle paths, so removal is intentionally idempotent.
        overlay?.let { view ->
            try { windowManager.removeView(view) } catch (_: Exception) { }
        }
        overlay = null
    }

    private fun centeredParams() = LinearLayout.LayoutParams(-1, -2).apply {
        gravity = Gravity.CENTER
    }

    private fun buttonParams() = LinearLayout.LayoutParams(-1, -2).apply {
        gravity = Gravity.CENTER
        setMargins(0, dp(5), 0, dp(5))
    }

    private fun roundedBackground(color: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(16).toFloat()
    }

    // Convert density-independent layout values into the device's actual pixel units.
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
