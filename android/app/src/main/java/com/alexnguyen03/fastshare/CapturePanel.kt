package com.alexnguyen03.fastshare

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.animation.AnimationUtils
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout

/** Small vertical card that slides out from the handle. Icon-only; every button has a TalkBack label. */
class CapturePanel(
  private val service: AccessibilityService,
  private val onCapture: () -> Unit,
  private val onLatest: () -> Unit,
  private val onSendClipboard: () -> Unit,
  private val onOpenApp: () -> Unit,
) {
  private val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private val density = service.resources.displayMetrics.density
  private val handler = Handler(Looper.getMainLooper())
  private var view: LinearLayout? = null
  private var scrim: View? = null
  private val autoClose = Runnable { dismiss() }

  val isShowing get() = view != null

  private fun animated() =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()

  fun show(handle: EdgeHandle) {
    if (view != null) return
    val palette = Palette(service) // re-read each time, so the app theme is always current
    val dp = { v: Int -> (v * density).toInt() }
    val root = LinearLayout(service).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(6), dp(6), dp(6), dp(6))
      background = GradientDrawable().apply {
        cornerRadius = 18 * density
        setColor(palette.surface)
      }
      elevation = 4 * density
      alpha = 0f
    }
    // Screenshot actions need AccessibilityService.takeScreenshot or the system action (API 28+).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      root.addView(item(palette, R.drawable.ic_camera, R.string.panel_capture, onCapture))
      root.addView(item(palette, R.drawable.ic_image, R.string.panel_latest, onLatest))
    }
    root.addView(item(palette, R.drawable.ic_clipboard, R.string.panel_send_clipboard, onSendClipboard))
    root.addView(item(palette, R.drawable.ic_smartphone, R.string.panel_open_app, onOpenApp))
    root.setOnTouchListener { _, _ ->
      restartTimer()
      false
    }

    // Full-screen layer under the panel: a tap outside closes the panel instead of hitting the app below.
    val dim = View(service).apply {
      // Invisible on purpose: it only swallows taps.
      setOnTouchListener { _, event ->
        if (event.actionMasked == MotionEvent.ACTION_DOWN) dismiss()
        true
      }
    }
    val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    val type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      flags,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or if (handle.isRight) Gravity.END else Gravity.START
      x = dp(16)
      y = handle.y
    }
    try {
      wm.addView(
        dim,
        WindowManager.LayoutParams(
          WindowManager.LayoutParams.MATCH_PARENT,
          WindowManager.LayoutParams.MATCH_PARENT,
          type,
          flags,
          PixelFormat.TRANSLUCENT,
        ),
      )
      wm.addView(root, params)
    } catch (_: Exception) {
      runCatching { wm.removeView(dim) }
      return
    }
    view = root
    scrim = dim
    zoomIn(root, handle.isRight)
    restartTimer()
  }

  fun dismiss(animate: Boolean = true) {
    handler.removeCallbacks(autoClose)
    val root = view ?: return
    val dim = scrim
    view = null
    scrim = null
    val remove = Runnable {
      // The animation runs on the render thread, so the view can still hold its OPEN state (alpha 1,
      // scale 1). removeView() is deferred a frame: without pinning the final state first, that
      // frame draws the panel again, which showed as a flash after the close animation.
      root.animate().cancel()
      root.alpha = 0f
      root.visibility = View.INVISIBLE
      runCatching { wm.removeViewImmediate(root) }
      dim?.let { runCatching { wm.removeViewImmediate(it) } }
    }
    if (!animate || !animated()) {
      remove.run()
      return
    }
    root.animate().alpha(0f).scaleX(ZOOM_FROM).scaleY(ZOOM_FROM).setDuration(ZOOM_OUT_MS)
      .setInterpolator(AnimationUtils.loadInterpolator(service, android.R.interpolator.fast_out_linear_in))
      .withEndAction(remove).start()
  }

  private fun restartTimer() {
    handler.removeCallbacks(autoClose)
    handler.postDelayed(autoClose, 4000)
  }

  // Zoom out of the screen edge the handle sits on, and back into it on close.
  private fun zoomIn(root: View, fromRight: Boolean) {
    if (!animated()) {
      root.alpha = 1f
      return
    }
    root.post {
      root.pivotX = if (fromRight) root.width.toFloat() else 0f
      root.pivotY = root.height / 2f
      root.scaleX = ZOOM_FROM
      root.scaleY = ZOOM_FROM
      // GPU layer for the scale/fade. Kept after opening: building it on the first closing frame was the hitch.
      root.setLayerType(View.LAYER_TYPE_HARDWARE, null)
      root.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(ZOOM_IN_MS)
        .setInterpolator(AnimationUtils.loadInterpolator(service, android.R.interpolator.fast_out_slow_in))
        .start()
    }
  }

  private fun item(palette: Palette, icon: Int, label: Int, action: () -> Unit): ImageView {
    val size = (48 * density).toInt()
    val pad = (12 * density).toInt()
    return ImageView(service).apply {
      layoutParams = LinearLayout.LayoutParams(size, size)
      setPadding(pad, pad, pad, pad)
      setImageResource(icon)
      setColorFilter(palette.accent)
      contentDescription = service.getString(label)
      background = RippleDrawable(
        ColorStateList.valueOf((palette.accent and 0x00FFFFFF) or 0x33000000),
        null,
        GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(-1) },
      )
      setOnClickListener {
        dismiss(animate = false) // the screenshot must not catch the panel mid-animation
        action()
      }
    }
  }

  companion object {
    private const val ZOOM_IN_MS = 320L
    private const val ZOOM_OUT_MS = 240L
    private const val ZOOM_FROM = 0.4f
  }
}
