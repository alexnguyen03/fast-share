package com.alexnguyen03.fastshare

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build

/** Overlay colors: the app theme once the app has run, else Material You (Android 12+) or emerald. */
class Palette(ctx: Context) {
  val surface: Int
  val accent: Int
  val handle: Int

  init {
    val night = ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
      Configuration.UI_MODE_NIGHT_YES
    val theme = OverlayPrefs.theme(ctx)?.let { (bg, primary) ->
      runCatching { Color.parseColor(bg) to Color.parseColor(primary) }.getOrNull()
    }
    if (theme != null) {
      surface = theme.first
      accent = theme.second
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      surface = ctx.getColor(if (night) android.R.color.system_neutral1_800 else android.R.color.system_neutral1_50)
      accent = ctx.getColor(if (night) android.R.color.system_accent1_200 else android.R.color.system_accent1_600)
    } else {
      surface = Color.parseColor(if (night) "#1E1E2E" else "#FBFDF8")
      accent = Color.parseColor(if (night) "#6FD3A8" else "#0B7A55")
    }
    handle = accent
  }
}
