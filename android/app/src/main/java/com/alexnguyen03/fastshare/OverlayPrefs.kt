package com.alexnguyen03.fastshare

import android.content.Context

object OverlayPrefs {
  private fun prefs(ctx: Context) = ctx.getSharedPreferences("overlay", Context.MODE_PRIVATE)

  fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", true)

  fun side(ctx: Context): String = if (prefs(ctx).getString("side", "right") == "left") "left" else "right"

  /** Vertical position as a fraction of the screen height, so rotation and resizing keep it sane. */
  fun y(ctx: Context) = prefs(ctx).getFloat("y", 0.4f)

  fun save(ctx: Context, enabled: Boolean, side: String) {
    prefs(ctx).edit().putBoolean("enabled", enabled).putString("side", if (side == "left") "left" else "right").apply()
  }

  /** App theme colors (#rrggbb), pushed from the web UI so the overlay matches even when the app is closed. */
  fun theme(ctx: Context): Pair<String, String>? {
    val p = prefs(ctx)
    val bg = p.getString("themeBg", null) ?: return null
    return bg to (p.getString("themePrimary", null) ?: return null)
  }

  fun saveTheme(ctx: Context, bg: String, primary: String) {
    prefs(ctx).edit().putString("themeBg", bg).putString("themePrimary", primary).apply()
  }

  fun saveY(ctx: Context, y: Float) {
    prefs(ctx).edit().putFloat("y", y).apply()
  }
}
