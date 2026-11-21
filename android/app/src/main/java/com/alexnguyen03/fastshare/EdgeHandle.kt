package com.alexnguyen03.fastshare

import android.annotation.SuppressLint
import android.accessibilityservice.AccessibilityService
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import kotlin.math.abs

/**
 * Slim pill on a screen edge. Tap or swipe inward opens the panel; long-press then drag moves it.
 * The touch strip is wider than the pill so it is easy to hit, and it is excluded from the
 * system Back gesture.
 */
class EdgeHandle(
  private val service: AccessibilityService,
  private val onOpen: (handle: EdgeHandle) -> Unit,
) {
  private val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private val density = service.resources.displayMetrics.density
  private val handler = Handler(Looper.getMainLooper())
  private val onRight = OverlayPrefs.side(service) == "right"
  private val stripW = (24 * density).toInt()
  private val stripH = (96 * density).toInt()
  private var view: FrameLayout? = null
  private val params = WindowManager.LayoutParams(
    stripW,
    stripH,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or if (onRight) Gravity.END else Gravity.START
    this.y = clampY((OverlayPrefs.y(service) * service.resources.displayMetrics.heightPixels).toInt())
  }

  val isRight get() = onRight
  val y: Int get() = params.y
  val height get() = stripH

  @SuppressLint("ClickableViewAccessibility")
  fun show() {
    if (view != null) return
    val pill = View(service).apply {
      background = GradientDrawable().apply {
        cornerRadius = 2 * density
        setColor(Palette(service).handle)
      }
    }
    val root = FrameLayout(service).apply {
      alpha = IDLE_ALPHA
      contentDescription = service.getString(R.string.handle_description)
      addView(
        pill,
        FrameLayout.LayoutParams((4 * density).toInt(), (56 * density).toInt()).apply {
          gravity = Gravity.CENTER_VERTICAL or if (onRight) Gravity.END else Gravity.START
          // Small gap so the pill does not sit flush against the screen edge.
          if (onRight) marginEnd = (5 * density).toInt() else marginStart = (5 * density).toInt()
        },
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
          v.systemGestureExclusionRects = listOf(Rect(0, 0, v.width, v.height))
        }
      }
    }

    var startY = 0
    var downX = 0f
    var downY = 0f
    var dragging = false
    var opened = false
    val slop = ViewConfiguration.get(service).scaledTouchSlop
    val longPress = Runnable {
      dragging = true
      root.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    }

    root.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startY = params.y
          downX = event.rawX
          downY = event.rawY
          dragging = false
          opened = false
          root.alpha = 1f
          handler.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (dragging) {
            params.y = clampY(startY + dy.toInt())
            update()
          } else if (abs(dx) > slop || abs(dy) > slop) {
            handler.removeCallbacks(longPress)
            // Swipe inward = toward the middle of the screen.
            if (!opened && (if (onRight) -dx else dx) > 16 * density) {
              opened = true
              open()
            }
          }
        }
        MotionEvent.ACTION_UP -> {
          handler.removeCallbacks(longPress)
          root.alpha = IDLE_ALPHA
          if (dragging) {
            OverlayPrefs.saveY(service, params.y.toFloat() / service.resources.displayMetrics.heightPixels)
          } else if (!opened && abs(event.rawX - downX) <= slop && abs(event.rawY - downY) <= slop) {
            open()
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          handler.removeCallbacks(longPress)
          root.alpha = IDLE_ALPHA
        }
      }
      true
    }

    try {
      wm.addView(root, params)
      view = root
    } catch (e: Exception) {
      Log.w("FastShareOverlay", "could not add the edge handle", e)
    }
  }

  fun setVisible(visible: Boolean) {
    view?.visibility = if (visible) View.VISIBLE else View.INVISIBLE
  }

  fun remove() {
    handler.removeCallbacksAndMessages(null)
    view?.let { runCatching { wm.removeView(it) } }
    view = null
  }

  private fun open() {
    view?.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
    onOpen(this)
  }

  private fun update() {
    view?.let { runCatching { wm.updateViewLayout(it, params) } }
  }

  private fun clampY(y: Int): Int {
    val max = service.resources.displayMetrics.heightPixels - stripH - (48 * density).toInt()
    return y.coerceIn((48 * density).toInt(), max.coerceAtLeast((48 * density).toInt()))
  }

  companion object {
    private const val IDLE_ALPHA = 0.35f
  }
}
