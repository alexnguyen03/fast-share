package com.alexnguyen03.fastshare

import android.graphics.Bitmap
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/** Hands images to the Rust side: `incoming/<names>.jpg` plus `manifest.json` (see take_inbox). */
object Inbox {
  fun write(dataDir: File, bitmaps: List<Bitmap>): Boolean {
    if (bitmaps.isEmpty()) return false
    return try {
      val inbox = File(dataDir, "incoming").apply { mkdirs() }
      // Unique names: two quick captures must not overwrite each other.
      val stamp = System.currentTimeMillis()
      val names = JSONArray()
      bitmaps.forEachIndexed { index, bitmap ->
        val name = "shared-$stamp-$index.jpg"
        FileOutputStream(File(inbox, name)).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }
        names.put(name)
      }
      // Rust must never see a half-written manifest.
      val tmp = File(inbox, "manifest.json.tmp")
      tmp.writeText(JSONObject().put("images", names).toString())
      tmp.renameTo(File(inbox, "manifest.json"))
    } catch (_: Exception) {
      false
    }
  }
}
