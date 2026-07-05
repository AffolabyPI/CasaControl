package expo.modules.hubwakelock

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Holds a PARTIAL_WAKE_LOCK so the CPU keeps running while the screen is off or
 * the device is locked. The app already declares android.permission.WAKE_LOCK.
 */
class HubWakeLockModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  private fun ensureLock(): PowerManager.WakeLock? {
    val context: Context = appContext.reactContext ?: return null
    val existing = wakeLock
    if (existing != null) return existing
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val created = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CasaControl::HubWakeLock")
    wakeLock = created
    return created
  }

  override fun definition() = ModuleDefinition {
    Name("HubWakeLock")

    Function("acquire") {
      val lock = ensureLock()
      if (lock != null && !lock.isHeld) {
        lock.acquire()
      }
    }

    Function("release") {
      val lock = wakeLock
      if (lock != null && lock.isHeld) {
        lock.release()
      }
    }

    OnDestroy {
      val lock = wakeLock
      if (lock != null && lock.isHeld) {
        lock.release()
      }
    }
  }
}
