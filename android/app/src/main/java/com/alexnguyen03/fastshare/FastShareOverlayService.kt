package com.alexnguyen03.fastshare

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import java.util.concurrent.Executors

/** Hosts the edge handle and its panel, and turns "capture" into an inbox image + the editor. */
class FastShareOverlayService : AccessibilityService() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val ioExecutor = Executors.newSingleThreadExecutor()
  private var handle: EdgeHandle? = null
  private var panel: CapturePanel? = null
  private var appForeground = false
  private var imeShown = false
  private var capturing = false

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) = evaluate()
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    appForeground = MainActivity.isForeground
    registerReceiver(
      screenReceiver,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      },
    )
    refresh()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return
    val shown = windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
    if (shown != imeShown) {
      imeShown = shown
      evaluate()
    }
  }

  override fun onInterrupt() {}

  // Rotation or a size change: rebuild so the handle is clamped to the new screen.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    refresh()
  }

  override fun onDestroy() {
    runCatching { unregisterReceiver(screenReceiver) }
    removeUi()
    ioExecutor.shutdownNow()
    if (instance === this) instance = null
    super.onDestroy()
  }

  /** Rebuild from preferences (setting changed, rotation, service start). */
  fun refresh() {
    mainHandler.post {
      removeUi()
      if (!OverlayPrefs.enabled(this)) return@post
      val p = CapturePanel(this, ::captureNow, ::sendLatest, ::openApp)
      panel = p
      handle = EdgeHandle(this) { p.show(it) }.also { it.show() }
      evaluate()
    }
  }

  fun onAppForeground(foreground: Boolean) {
    appForeground = foreground
    mainHandler.post { evaluate() }
  }

  private fun removeUi() {
    panel?.dismiss()
    handle?.remove()
    panel = null
    handle = null
  }

  private fun evaluate() {
    val visible = !appForeground && !imeShown && !capturing
    handle?.setVisible(visible)
    if (!visible) panel?.dismiss()
  }

  fun captureNow() {
    Log.i(TAG, "captureNow triggered")
    capturing = true
    mainHandler.post { evaluate() }
    // If nothing opens the app, bring the handle back instead of leaving it hidden.
    mainHandler.postDelayed({
      capturing = false
      evaluate()
    }, 2500)
    mainHandler.postDelayed({
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        takeScreenshot(
          Display.DEFAULT_DISPLAY,
          ioExecutor,
          object : TakeScreenshotCallback {
            override fun onSuccess(screenshot: ScreenshotResult) {
              val hwBitmap = Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
              screenshot.hardwareBuffer.close()
              val soft = hwBitmap?.copy(Bitmap.Config.ARGB_8888, false)
              hwBitmap?.recycle()
              if (soft != null && Inbox.write(dataDir, listOf(soft))) {
                soft.recycle()
                launchMainActivityWithInbox()
                return
              }
              Log.w(TAG, "Screenshot copy failed, falling back")
              fallbackSystemScreenshot()
            }

            override fun onFailure(errorCode: Int) {
              Log.w(TAG, "takeScreenshot onFailure errorCode=$errorCode, falling back")
              fallbackSystemScreenshot()
            }
          },
        )
      } else {
        fallbackSystemScreenshot()
      }
    }, 120)
  }

  private fun sendLatest() {
    FastShareCaptureService.instance?.sendLatest()
  }

  private fun openApp() {
    startActivity(
      Intent(this, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
      ),
    )
  }

  private fun fallbackSystemScreenshot() {
    mainHandler.post {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
        FastShareCaptureService.instance?.pollBurst()
      }
    }
  }

  private fun launchMainActivityWithInbox() {
    MainActivity.onExternalInboxWritten()
    mainHandler.post {
      startActivity(
        Intent(this, MainActivity::class.java).apply {
          action = MainActivity.ACTION_OPEN_INBOX
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
              Intent.FLAG_ACTIVITY_SINGLE_TOP,
          )
        },
      )
      MainActivity.dispatchInboxIfManifestExists(dataDir)
    }
  }

  companion object {
    private const val TAG = "FastShareOverlay"
    @Volatile var instance: FastShareOverlayService? = null

    fun isEnabled(ctx: Context): Boolean {
      val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      val name = ComponentName(ctx, FastShareOverlayService::class.java)
      return list.split(':').any {
        it.equals(name.flattenToString(), true) || it.equals(name.flattenToShortString(), true)
      }
    }
  }
}
