package expo.modules.mediacontrols

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * A tiny foreground service whose only job is to keep the phone's process at
 * foreground priority while a media notification is showing, so transport taps
 * are handled immediately even when the app has been backgrounded for a while.
 * The notification itself is built by MediaControlsModule and passed in.
 */
class MediaControlsService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification: Notification? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent?.getParcelableExtra(EXTRA_NOTIFICATION, Notification::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent?.getParcelableExtra(EXTRA_NOTIFICATION)
      }
    if (notification == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notification)
    }
    return START_NOT_STICKY
  }

  // If the user swipes the app away, tear the notification + service down.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  companion object {
    const val EXTRA_NOTIFICATION = "notification"
    const val NOTIF_ID = 4231
  }
}
