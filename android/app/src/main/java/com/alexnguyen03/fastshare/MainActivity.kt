package com.alexnguyen03.fastshare

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class MainActivity : TauriActivity() {
  private val ioExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var webViewRef: WebView? = null
  // Set by the edge panel's "Send clipboard"; the page takes it when it mounts (cold start) or on the event (warm).
  @Volatile private var clipboardRequested = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    currentInstance = this
    clipboardRequested = intent?.action == ACTION_SEND_CLIPBOARD
    applySystemBars(true, "#FBFDF8")
    ensurePermissionsAndStartService()
    ioExecutor.execute {
      handleShareIntent(intent)
    }
  }

  fun applySystemBars(isLightTheme: Boolean, bgHex: String) {
    val parsedColor = try {
      android.graphics.Color.parseColor(bgHex)
    } catch (_: Exception) {
      if (isLightTheme) android.graphics.Color.parseColor("#FBFDF8")
      else android.graphics.Color.parseColor("#1E1E2E")
    }
    window.decorView.setBackgroundColor(parsedColor)
    @Suppress("DEPRECATION")
    window.statusBarColor = android.graphics.Color.TRANSPARENT
    @Suppress("DEPRECATION")
    window.navigationBarColor = android.graphics.Color.TRANSPARENT
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = isLightTheme
      isAppearanceLightNavigationBars = isLightTheme
    }
  }

  inner class SystemUiBridge {
    @JavascriptInterface
    fun setSystemBars(isLightTheme: Boolean, bgHex: String) {
      mainHandler.post {
        applySystemBars(isLightTheme, bgHex)
      }
    }

    @JavascriptInterface
    fun setOverlayTheme(bgHex: String, primaryHex: String) {
      OverlayPrefs.saveTheme(this@MainActivity, bgHex, primaryHex)
      mainHandler.post { FastShareOverlayService.instance?.refresh() }
    }

    @JavascriptInterface
    fun getOverlayState(): String = JSONObject()
      .put("enabled", OverlayPrefs.enabled(this@MainActivity))
      .put("side", OverlayPrefs.side(this@MainActivity))
      .put("openOnScreenshot", OverlayPrefs.openOnScreenshot(this@MainActivity))
      .put("accessibility", FastShareOverlayService.isEnabled(this@MainActivity))
      // Enabled in system settings is not the same as running: HyperOS can leave the service stopped.
      .put("connected", FastShareOverlayService.instance != null)
      .put("xiaomi", Build.MANUFACTURER.lowercase() in listOf("xiaomi", "redmi", "poco"))
      .toString()

    @JavascriptInterface
    fun setOverlay(enabled: Boolean, side: String) {
      OverlayPrefs.save(this@MainActivity, enabled, side)
      mainHandler.post { FastShareOverlayService.instance?.refresh() }
    }

    @JavascriptInterface
    fun setOpenOnScreenshot(open: Boolean) {
      OverlayPrefs.saveOpenOnScreenshot(this@MainActivity, open)
    }

    @JavascriptInterface
    fun openAccessibilitySettings() {
      startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    // Xiaomi/HyperOS: without Autostart the system cannot rebind the service after the app is swiped away.
    // The haptics plugin's pattern is two 40 ms pulses at amplitude 50-60 of 255, with no usage set:
    // too faint to feel and dropped in silent mode on some phones. Use a firm pattern marked as touch feedback.
    @JavascriptInterface
    fun vibrateSuccess() {
      val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      if (!vibrator.hasVibrator()) return
      val timings = longArrayOf(0, 60, 80, 60)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val effect = VibrationEffect.createWaveform(timings, intArrayOf(0, 220, 0, 220), -1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(
            effect,
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
        }
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(timings, -1)
      }
    }

    // Android 10+ only lets the focused app read the clipboard; the page calls this from the foreground.
    @JavascriptInterface
    fun readClipboardText(): String {
      val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = clipboard.primaryClip ?: return ""
      if (clip.itemCount == 0) return ""
      return clip.getItemAt(0).coerceToText(this@MainActivity)?.toString() ?: ""
    }

    // Android names the Wi-Fi only to apps with location permission; "" when unknown.
    @JavascriptInterface
    fun wifiName(): String {
      if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION)
        != PackageManager.PERMISSION_GRANTED
      ) {
        return ""
      }
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return ""
      @Suppress("DEPRECATION")
      val ssid = wifi.connectionInfo?.ssid ?: return ""
      return if (ssid == "<unknown ssid>") "" else ssid.trim('"')
    }

    @JavascriptInterface
    fun requestLocationForWifi() {
      runOnUiThread {
        ActivityCompat.requestPermissions(
          this@MainActivity,
          arrayOf(Manifest.permission.ACCESS_FINE_LOCATION),
          1002,
        )
      }
    }

    @JavascriptInterface
    fun takeClipboardRequest(): Boolean {
      val requested = clipboardRequested
      clipboardRequested = false
      return requested
    }

    @JavascriptInterface
    fun openAutostart() {
      val miui = Intent().setClassName(
        "com.miui.securitycenter",
        "com.miui.permcenter.autostart.AutoStartManagementActivity",
      )
      try {
        startActivity(miui)
      } catch (_: Exception) {
        openAppInfo()
      }
    }

    @JavascriptInterface
    fun openAppInfo() {
      startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
      )
    }
  }

  override fun onResume() {
    super.onResume()
    currentInstance = this
    isForeground = true
    FastShareOverlayService.instance?.onAppForeground(true)
    if (externalInboxReady || hasManifest(dataDir)) {
      externalInboxReady = false
      mainHandler.postDelayed({
        if (hasManifest(dataDir)) {
          webViewRef?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('fast-share-inbox'))",
            null
          )
        }
      }, 100)
    }
  }

  override fun onPause() {
    isForeground = false
    FastShareOverlayService.instance?.onAppForeground(false)
    super.onPause()
  }

  override fun onStop() {
    isForeground = false
    FastShareOverlayService.instance?.onAppForeground(false)
    super.onStop()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.action == ACTION_SEND_CLIPBOARD) {
      clipboardRequested = true
      // Wait a moment so the window has focus: the clipboard is unreadable before that.
      mainHandler.postDelayed({
        webViewRef?.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('fast-share-clipboard'))",
          null
        )
      }, 300)
      return
    }
    if (intent.action == ACTION_OPEN_INBOX) {
      externalInboxReady = false
      mainHandler.postDelayed({
        if (hasManifest(dataDir)) {
          webViewRef?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('fast-share-inbox'))",
            null
          )
        }
      }, 100)
      return
    }
    ioExecutor.execute {
      handleShareIntent(intent)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(SystemUiBridge(), "__FAST_SHARE_ANDROID__")
  }

  override fun onDestroy() {
    if (currentInstance === this) {
      currentInstance = null
    }
    ioExecutor.shutdownNow()
    super.onDestroy()
  }

  private fun ensurePermissionsAndStartService() {
    val needed = mutableListOf<String>()
    val mediaPerm = if (Build.VERSION.SDK_INT >= 33) {
      Manifest.permission.READ_MEDIA_IMAGES
    } else {
      Manifest.permission.READ_EXTERNAL_STORAGE
    }
    if (ContextCompat.checkSelfPermission(this, mediaPerm) != PackageManager.PERMISSION_GRANTED) {
      needed.add(mediaPerm)
    }
    if (Build.VERSION.SDK_INT >= 33) {
      val notifPerm = Manifest.permission.POST_NOTIFICATIONS
      if (ContextCompat.checkSelfPermission(this, notifPerm) != PackageManager.PERMISSION_GRANTED) {
        needed.add(notifPerm)
      }
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      needed.add(Manifest.permission.CAMERA)
    }
    if (needed.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1001)
    }
    try {
      val svcIntent = Intent(this, FastShareCaptureService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(svcIntent)
      } else {
        startService(svcIntent)
      }
    } catch (_: Exception) {
    }
  }

  private fun handleShareIntent(intent: Intent?) {
    if (intent == null) return
    val uris = mutableListOf<Uri>()
    when (intent.action) {
      Intent.ACTION_SEND -> {
        @Suppress("DEPRECATION")
        val single = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (single != null) uris.add(single)
      }
      Intent.ACTION_SEND_MULTIPLE -> {
        @Suppress("DEPRECATION")
        val list = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        if (list != null) uris.addAll(list)
      }
    }
    if (uris.isEmpty()) return
    intent.action = Intent.ACTION_MAIN
    if (writeUrisToInbox(uris)) {
      onExternalInboxWritten()
      dispatchInboxIfManifestExists(dataDir)
    }
  }

  private fun writeUrisToInbox(uris: List<Uri>): Boolean {
    val bitmaps = uris.mapNotNull { uri ->
      try {
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
      } catch (_: Exception) {
        null
      }
    }
    val ok = Inbox.write(dataDir, bitmaps)
    bitmaps.forEach { it.recycle() }
    return ok
  }

  companion object {
    const val ACTION_OPEN_INBOX = "com.alexnguyen03.fastshare.OPEN_INBOX"
    const val ACTION_SEND_CLIPBOARD = "com.alexnguyen03.fastshare.SEND_CLIPBOARD"
    @Volatile var externalInboxReady: Boolean = false
    @Volatile var isForeground: Boolean = false
    @Volatile var currentInstance: MainActivity? = null

    fun onExternalInboxWritten() {
      externalInboxReady = true
    }

    fun hasManifest(dataDir: File): Boolean {
      return File(File(dataDir, "incoming"), "manifest.json").exists()
    }

    fun dispatchInboxIfManifestExists(dataDir: File) {
      val act = currentInstance ?: return
      act.mainHandler.postDelayed({
        if (hasManifest(dataDir)) {
          act.webViewRef?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('fast-share-inbox'))",
            null
          )
        }
      }, 80)
    }
  }
}
