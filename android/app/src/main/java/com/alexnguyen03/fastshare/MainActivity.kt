package com.alexnguyen03.fastshare

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    currentInstance = this
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
