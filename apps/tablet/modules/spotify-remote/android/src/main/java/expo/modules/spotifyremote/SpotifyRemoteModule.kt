package expo.modules.spotifyremote

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpotifyRemoteException(message: String) : CodedException(message)

/**
 * Thin wrapper over the Spotify App Remote SDK. It binds to the *local* Spotify
 * app on the tablet, so playback can be started from cold with the screen
 * off/locked — something the Web API can't do (it needs an already-registered
 * device). Connection is app-to-app and, once authorized, silent thereafter.
 */
class SpotifyRemoteModule : Module() {
  private var appRemote: SpotifyAppRemote? = null
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("SpotifyRemote")

    AsyncFunction("connect") { clientId: String, redirectUri: String, promise: Promise ->
      ensureConnected(clientId, redirectUri, promise) { promise.resolve(true) }
    }

    AsyncFunction("play") { clientId: String, redirectUri: String, uri: String, promise: Promise ->
      ensureConnected(clientId, redirectUri, promise) { remote ->
        remote.playerApi.play(uri)
          .setResultCallback { promise.resolve(true) }
          .setErrorCallback { err -> promise.reject(SpotifyRemoteException("play failed: ${err.message}")) }
      }
    }

    AsyncFunction("resume") { promise: Promise ->
      withConnected(promise) { remote ->
        remote.playerApi.resume()
          .setResultCallback { promise.resolve(true) }
          .setErrorCallback { err -> promise.reject(SpotifyRemoteException("resume failed: ${err.message}")) }
      }
    }

    AsyncFunction("pause") { promise: Promise ->
      withConnected(promise) { remote ->
        remote.playerApi.pause()
          .setResultCallback { promise.resolve(true) }
          .setErrorCallback { err -> promise.reject(SpotifyRemoteException("pause failed: ${err.message}")) }
      }
    }

    Function("isConnected") {
      appRemote?.isConnected == true
    }

    Function("disconnect") {
      teardown()
    }

    OnDestroy {
      teardown()
    }
  }

  private fun teardown() {
    appRemote?.let { SpotifyAppRemote.disconnect(it) }
    appRemote = null
  }

  private fun withConnected(promise: Promise, action: (SpotifyAppRemote) -> Unit) {
    val remote = appRemote
    if (remote != null && remote.isConnected) {
      action(remote)
    } else {
      promise.reject(SpotifyRemoteException("Spotify not connected"))
    }
  }

  private fun ensureConnected(
    clientId: String,
    redirectUri: String,
    promise: Promise,
    onReady: (SpotifyAppRemote) -> Unit,
  ) {
    val existing = appRemote
    if (existing != null && existing.isConnected) {
      onReady(existing)
      return
    }
    // Prefer the current Activity: the first-time authorization makes Spotify
    // launch its SSO screen, which Android only allows from a foreground Activity
    // (an app/service context gets BAL-blocked). Once authorized, later connects
    // need no UI, so the app context is fine when locked with no Activity.
    val context: Context = appContext.currentActivity ?: appContext.reactContext ?: run {
      promise.reject(SpotifyRemoteException("no android context"))
      return
    }
    val params = ConnectionParams.Builder(clientId)
      .setRedirectUri(redirectUri)
      .showAuthView(true)
      .build()
    // App Remote's connect + callbacks expect the main thread.
    main.post {
      // The SDK reuses this listener for BOTH the initial connect result and
      // every later disconnection (Spotify closed/killed). Guard so we settle the
      // promise exactly once — a second reject on a settled promise hard-crashes.
      var handled = false
      SpotifyAppRemote.connect(
        context,
        params,
        object : Connector.ConnectionListener {
          override fun onConnected(remote: SpotifyAppRemote) {
            appRemote = remote
            if (!handled) {
              handled = true
              onReady(remote)
            }
          }

          override fun onFailure(throwable: Throwable) {
            // Fires on initial failure AND on later disconnects — always clear
            // the handle so isConnected is accurate, but only reject once.
            appRemote = null
            if (!handled) {
              handled = true
              promise.reject(SpotifyRemoteException("connect failed: ${throwable.message}"))
            }
          }
        },
      )
    }
  }
}
