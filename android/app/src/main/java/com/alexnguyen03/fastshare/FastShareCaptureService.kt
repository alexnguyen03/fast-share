package com.alexnguyen03.fastshare

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentUris
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class FastShareCaptureService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var scheduler: ScheduledExecutorService? = null
  private var observer: ContentObserver? = null
  @Volatile private var lastScreenshotId: Long = -1L
  @Volatile private var lastFileTimestamp: Long = 0L

  override fun onCreate() {
    super.onCreate()
    instance = this
    startWatcherForeground()
    val exec = Executors.newSingleThreadScheduledExecutor()
    scheduler = exec
    exec.execute {
      lastScreenshotId = queryLatestScreenshotId()
      lastFileTimestamp = latestScreenshotFile()?.lastModified() ?: System.currentTimeMillis()
    }
    registerMediaObserver()
    exec.scheduleWithFixedDelay({
      checkForNewScreenshot()
    }, 800, 700, TimeUnit.MILLISECONDS)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "com.alexnguyen03.fastshare.CAPTURE_NOW") {
      FastShareOverlayService.instance?.captureNow()
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    observer?.let { contentResolver.unregisterContentObserver(it) }
    observer = null
    scheduler?.shutdownNow()
    scheduler = null
    if (instance === this) {
      instance = null
    }
    super.onDestroy()
  }

  private fun startWatcherForeground() {
    val channelId = "fast_share_capture_watcher"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      val channel = NotificationChannel(
        channelId,
        "Fast Share Screenshot Watcher",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Opens the Fast Share send panel when you take a screenshot"
        setShowBadge(false)
      }
      nm?.createNotificationChannel(channel)
    }
    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification: Notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(android.R.drawable.ic_menu_share)
      .setContentTitle("Fast Share ready")
      .setContentText("Take a screenshot to open the send panel")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .build()

    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        4765,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
    } else {
      startForeground(4765, notification)
    }
  }

  private fun registerMediaObserver() {
    val contentObserver = object : ContentObserver(mainHandler) {
      override fun onChange(selfChange: Boolean, uri: Uri?) {
        super.onChange(selfChange, uri)
        scheduler?.execute { checkForNewScreenshot() }
      }
    }
    contentResolver.registerContentObserver(
      MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
      true,
      contentObserver
    )
    observer = contentObserver
  }

  private fun queryLatestScreenshotId(): Long {
    return try {
      val projection = arrayOf(
        MediaStore.Images.Media._ID,
        MediaStore.Images.Media.DISPLAY_NAME,
        MediaStore.Images.Media.RELATIVE_PATH,
        MediaStore.Images.Media.IS_PENDING
      )
      contentResolver.query(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        projection,
        null,
        null,
        "${MediaStore.Images.Media._ID} DESC"
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val id = cursor.getLong(0)
          val name = cursor.getString(1) ?: ""
          val rel = cursor.getString(2) ?: ""
          val pending = cursor.getInt(3)
          if (
            pending == 0 &&
            (name.contains("Screenshot", ignoreCase = true) || rel.contains("Screenshots", ignoreCase = true))
          ) {
            return id
          }
        }
        -1L
      } ?: -1L
    } catch (_: Exception) {
      -1L
    }
  }

  private fun latestScreenshotFile(): File? {
    return try {
      val dirs = listOf(
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Screenshots"),
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Screenshots")
      )
      dirs
        .filter { it.exists() && it.isDirectory }
        .flatMap { dir ->
          dir.listFiles()?.filter { file ->
            file.isFile &&
              !file.name.startsWith(".") &&
              file.length() > 1024 &&
              (file.name.endsWith(".png", true) || file.name.endsWith(".jpg", true) || file.name.endsWith(".jpeg", true))
          } ?: emptyList()
        }
        .maxByOrNull { it.lastModified() }
    } catch (_: Exception) {
      null
    }
  }

  @Synchronized
  private fun checkForNewScreenshot() {
    val latestId = queryLatestScreenshotId()
    if (latestId > 0L && latestId != lastScreenshotId) {
      lastScreenshotId = latestId
      val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, latestId)
      if (writeUriToInbox(uri)) {
        lastFileTimestamp = latestScreenshotFile()?.lastModified() ?: System.currentTimeMillis()
        openSendPanel()
        return
      }
    }

    val newestFile = latestScreenshotFile()
    if (newestFile != null && newestFile.lastModified() > lastFileTimestamp) {
      lastFileTimestamp = newestFile.lastModified()
      if (writeFileToInbox(newestFile)) {
        lastScreenshotId = queryLatestScreenshotId().coerceAtLeast(lastScreenshotId)
        openSendPanel()
      }
    }
  }

  private fun writeUriToInbox(uri: Uri): Boolean {
    return try {
      contentResolver.openInputStream(uri)?.use { input ->
        val bitmap = BitmapFactory.decodeStream(input) ?: return false
        val ok = saveBitmapToInbox(bitmap)
        bitmap.recycle()
        ok
      } ?: false
    } catch (_: Exception) {
      false
    }
  }

  private fun writeFileToInbox(file: File): Boolean {
    return try {
      val bitmap = BitmapFactory.decodeFile(file.absolutePath) ?: return false
      val ok = saveBitmapToInbox(bitmap)
      bitmap.recycle()
      ok
    } catch (_: Exception) {
      false
    }
  }

  private fun saveBitmapToInbox(bitmap: Bitmap): Boolean = Inbox.write(dataDir, listOf(bitmap))

  /** Panel action: send the newest screenshot already in the gallery. */
  fun sendLatest() {
    scheduler?.execute {
      val id = queryLatestScreenshotId()
      val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
      if (id > 0L && writeUriToInbox(uri)) openSendPanel()
    }
  }

  fun pollBurst() {
    val exec = scheduler ?: return
    for (delayMs in listOf(250L, 550L, 900L, 1400L, 2000L)) {
      exec.schedule({ checkForNewScreenshot() }, delayMs, TimeUnit.MILLISECONDS)
    }
  }

  fun openSendPanel() {
    MainActivity.onExternalInboxWritten()
    mainHandler.post {
      try {
        val intent = Intent(this, MainActivity::class.java).apply {
          action = MainActivity.ACTION_OPEN_INBOX
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
              Intent.FLAG_ACTIVITY_SINGLE_TOP
          )
        }
        if (Build.VERSION.SDK_INT >= 34) {
          val options = ActivityOptions.makeBasic().apply {
            setPendingIntentBackgroundActivityStartMode(
              ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
            )
          }
          startActivity(intent, options.toBundle())
        } else {
          startActivity(intent)
        }
      } catch (_: Exception) {
      }
      MainActivity.dispatchInboxIfManifestExists(dataDir)
    }
  }

  companion object {
    @Volatile var instance: FastShareCaptureService? = null
  }
}
