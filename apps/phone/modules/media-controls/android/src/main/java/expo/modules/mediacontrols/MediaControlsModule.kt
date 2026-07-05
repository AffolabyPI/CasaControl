package expo.modules.mediacontrols

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.URL
import java.util.concurrent.Executors

class NowPlaying : Record {
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val album: String = ""
  @Field val artworkUrl: String? = null
  @Field val isPlaying: Boolean = false
  @Field val durationMs: Double = 0.0
  @Field val positionMs: Double = 0.0
}

/**
 * Hosts a MediaSessionCompat and posts a MediaStyle notification so the phone
 * can show + control the hub's Spotify from the shade and lock screen. Taps are
 * forwarded to JS via the `onCommand` event; there is no local audio playback.
 */
class MediaControlsModule : Module() {
  private var session: MediaSessionCompat? = null
  private var receiver: BroadcastReceiver? = null
  private var lastArtUrl: String? = null
  private var lastArt: Bitmap? = null
  private var fgsStarted = false
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No Android context" }

  companion object {
    private const val CHANNEL_ID = "casacontrol_media"
    private const val NOTIF_ID = 4231
    private const val ACTION = "expo.modules.mediacontrols.ACTION"
    private const val EXTRA_CMD = "cmd"
  }

  override fun definition() = ModuleDefinition {
    Name("MediaControls")
    Events("onCommand")

    AsyncFunction("setNowPlaying") { info: NowPlaying, promise: Promise ->
      main.post {
        try {
          showOrUpdate(info)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_MEDIA", e.message ?: "media notification failed", e)
        }
      }
    }

    Function("clear") {
      main.post { clearNotification() }
    }

    OnDestroy {
      main.post { clearNotification() }
      io.shutdownNow()
    }
  }

  // --- session + receiver setup ---------------------------------------------

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    // Low importance: a media notification shouldn't buzz or make sound.
    val channel = NotificationChannel(CHANNEL_ID, "Now playing", NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    channel.setSound(null, null)
    mgr.createNotificationChannel(channel)
  }

  private fun ensureReceiver() {
    if (receiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        val cmd = intent?.getStringExtra(EXTRA_CMD) ?: return
        emit(cmd)
      }
    }
    val filter = IntentFilter(ACTION)
    ContextCompat.registerReceiver(context, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    receiver = r
  }

  private fun ensureSession(): MediaSessionCompat {
    session?.let { return it }
    val s = MediaSessionCompat(context, "CasaControlMedia")
    s.setCallback(object : MediaSessionCompat.Callback() {
      override fun onPlay() = emit("play")
      override fun onPause() = emit("pause")
      override fun onSkipToNext() = emit("next")
      override fun onSkipToPrevious() = emit("previous")
      override fun onStop() = emit("stop")
    })
    s.isActive = true
    session = s
    return s
  }

  private fun emit(command: String) {
    sendEvent("onCommand", mapOf("command" to command))
  }

  // --- notification ----------------------------------------------------------

  private fun pending(cmd: String): PendingIntent {
    val intent = Intent(ACTION).setPackage(context.packageName).putExtra(EXTRA_CMD, cmd)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_IMMUTABLE
    // Distinct request codes so extras don't get collapsed across actions.
    return PendingIntent.getBroadcast(context, cmd.hashCode(), intent, flags)
  }

  private fun showOrUpdate(info: NowPlaying) {
    ensureChannel()
    ensureReceiver()
    val s = ensureSession()

    val duration = info.durationMs.toLong()
    val position = info.positionMs.toLong()

    // Metadata drives the lock-screen title/artist/art + seekbar length.
    val meta = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, info.title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, info.artist)
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, info.album)
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
    lastArt?.let { meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
    s.setMetadata(meta.build())

    val stateActions = PlaybackStateCompat.ACTION_PLAY or
      PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
      PlaybackStateCompat.ACTION_STOP
    val playState = if (info.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    s.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(stateActions)
        .setState(playState, position, 1f)
        .build(),
    )

    postNotification(info, s)
    maybeLoadArt(info)
  }

  private fun postNotification(info: NowPlaying, s: MediaSessionCompat) {
    val playPauseIcon =
      if (info.isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
    val playPauseCmd = if (info.isPlaying) "pause" else "play"
    val playPauseLabel = if (info.isPlaying) "Pause" else "Play"

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(info.title.ifEmpty { "Nothing playing" })
      .setContentText(info.artist)
      .setSubText(info.album.ifEmpty { null })
      .setLargeIcon(lastArt)
      .setOnlyAlertOnce(true)
      .setOngoing(info.isPlaying)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDeleteIntent(pending("stop"))
      .addAction(android.R.drawable.ic_media_previous, "Previous", pending("previous"))
      .addAction(playPauseIcon, playPauseLabel, pending(playPauseCmd))
      .addAction(android.R.drawable.ic_media_next, "Next", pending("next"))
      .setStyle(
        MediaStyle()
          .setMediaSession(s.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )

    show(builder.build())
  }

  /**
   * Post/update the media notification. The first post starts a foreground
   * service (so the process stays warm and taps work when backgrounded);
   * subsequent posts just update the notification. If starting the FGS isn't
   * allowed (app in the background on Android 12+), degrade to a plain
   * notification rather than crashing.
   */
  private fun show(notification: android.app.Notification) {
    if (!fgsStarted) {
      try {
        val intent = Intent(context, MediaControlsService::class.java)
          .putExtra(MediaControlsService.EXTRA_NOTIFICATION, notification)
        ContextCompat.startForegroundService(context, intent)
        fgsStarted = true
        return
      } catch (_: Exception) {
        // Background FGS start not permitted — fall through to a plain notify.
      }
    }
    val nm = NotificationManagerCompat.from(context)
    if (nm.areNotificationsEnabled()) {
      try {
        nm.notify(NOTIF_ID, notification)
      } catch (_: SecurityException) {
        // POST_NOTIFICATIONS not granted yet — the JS layer requests it.
      }
    }
  }

  private fun maybeLoadArt(info: NowPlaying) {
    val url = info.artworkUrl
    if (url.isNullOrEmpty()) {
      lastArt = null
      lastArtUrl = null
      return
    }
    if (url == lastArtUrl && lastArt != null) return
    io.execute {
      try {
        val bmp = URL(url).openStream().use { BitmapFactory.decodeStream(it) } ?: return@execute
        main.post {
          lastArt = bmp
          lastArtUrl = url
          // Re-render with the artwork now available.
          val s = session ?: return@post
          val meta = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, info.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, info.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, info.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, info.durationMs.toLong())
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
            .build()
          s.setMetadata(meta)
          postNotification(info, s)
        }
      } catch (_: Exception) {
        // Network/decoding failure — just show the notification without art.
      }
    }
  }

  private fun clearNotification() {
    if (fgsStarted) {
      // Stopping the service removes its foreground notification too.
      context.stopService(Intent(context, MediaControlsService::class.java))
      fgsStarted = false
    }
    NotificationManagerCompat.from(context).cancel(NOTIF_ID)
    session?.let {
      it.isActive = false
      it.release()
    }
    session = null
    receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (_: IllegalArgumentException) {
        /* already unregistered */
      }
    }
    receiver = null
    lastArt = null
    lastArtUrl = null
  }
}
