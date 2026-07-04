/**
 * Keeps the tablet hub process alive when the device is idle / screen-off.
 *
 * Android suspends normal apps in Doze (verified: the hub's TCP server becomes
 * unreachable within seconds of idle). A foreground service with an ongoing
 * notification is the only reliable way to keep the process — and therefore the
 * hub server and Spotify polling — running. On Android 14 the service must
 * declare a `foregroundServiceType` (handled by ./plugins/withHubForegroundService).
 */
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from '@notifee/react-native';
import { createLogger } from '@casacontrol/shared';

const log = createLogger('fgservice');
const CHANNEL_ID = 'casacontrol-hub';
const NOTIFICATION_ID = 'casacontrol-hub-fgs';

let registered = false;
let running = false;

/** The FGS task stays pending for the lifetime of the service (standard notifee pattern). */
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  notifee.registerForegroundService(() => new Promise<void>(() => {}));
}

/** Start the persistent foreground service that keeps the hub reachable. */
export async function startHubForegroundService(): Promise<void> {
  if (running) return;
  try {
    ensureRegistered();
    await notifee.requestPermission(); // POST_NOTIFICATIONS on Android 13+
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'CasaControl Hub',
      importance: AndroidImportance.LOW,
    });
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: 'CasaControl hub running',
      body: 'Keeping your devices reachable from the phone.',
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        ],
        ongoing: true,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
      },
    });
    running = true;
    log.info('foreground service started — hub will survive Doze/idle');
  } catch (e) {
    log.error('failed to start foreground service', String(e));
  }
}

export async function stopHubForegroundService(): Promise<void> {
  if (!running) return;
  running = false;
  try {
    await notifee.stopForegroundService();
    log.info('foreground service stopped');
  } catch (e) {
    log.error('failed to stop foreground service', String(e));
  }
}

/**
 * On top of the FGS, exempt the app from battery optimization so it also keeps
 * network access during Doze. Opens the system settings once if not exempt.
 */
export async function ensureBatteryExemption(): Promise<void> {
  try {
    if (await notifee.isBatteryOptimizationEnabled()) {
      log.warn('battery optimization ON — opening settings so the app can be exempted');
      await notifee.openBatteryOptimizationSettings();
    } else {
      log.info('battery optimization already disabled for this app');
    }
  } catch (e) {
    log.error('battery optimization check failed', String(e));
  }
}
