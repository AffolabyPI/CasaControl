/**
 * Centralized access to this app's EXPO_PUBLIC_* env vars, plus a startup
 * diagnostic. Because these are inlined into the JS bundle at *transform* time,
 * a `.env` edit only takes effect after `expo start --clear` — logEnvStatus()
 * prints exactly what made it into the running bundle so we can catch a stale
 * cache or an unloaded .env immediately.
 */
import { createLogger, maskSecret } from '@casacontrol/shared';

const log = createLogger('env');

export const ENV = {
  spotifyClientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '',
  anthropicApiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '',
  ps5Mac: process.env.EXPO_PUBLIC_PS5_MAC ?? '',
  ps5Ip: process.env.EXPO_PUBLIC_PS5_IP ?? '',
  lanBroadcast: process.env.EXPO_PUBLIC_LAN_BROADCAST ?? '',
  hubLocalIp: process.env.EXPO_PUBLIC_HUB_LOCAL_IP ?? '',
  hubTailscaleIp: process.env.EXPO_PUBLIC_HUB_TAILSCALE_IP ?? '',
  goveeApiKey: process.env.EXPO_PUBLIC_GOVEE_API_KEY ?? '',
  goveeSku: process.env.EXPO_PUBLIC_GOVEE_SKU ?? '',
  goveeDevice: process.env.EXPO_PUBLIC_GOVEE_DEVICE ?? '',
  shieldIp: process.env.EXPO_PUBLIC_SHIELD_IP ?? '',
} as const;

export function logEnvStatus(): void {
  log.info('EXPO_PUBLIC_* values inlined into this bundle:');
  log.info(`  SPOTIFY_CLIENT_ID = ${maskSecret(ENV.spotifyClientId)}`);
  log.info(`  ANTHROPIC_API_KEY = ${maskSecret(ENV.anthropicApiKey)}`);
  log.info(`  PS5_MAC           = ${ENV.ps5Mac || '<empty>'}`);
  log.info(`  PS5_IP            = ${ENV.ps5Ip || '<empty>'}`);
  log.info(`  LAN_BROADCAST     = ${ENV.lanBroadcast || '<empty>'}`);
  log.info(`  HUB_LOCAL_IP      = ${ENV.hubLocalIp || '<empty>'}`);
  log.info(`  HUB_TAILSCALE_IP  = ${ENV.hubTailscaleIp || '<empty>'}`);
  log.info(`  GOVEE_API_KEY     = ${maskSecret(ENV.goveeApiKey)}`);
  log.info(`  GOVEE_SKU         = ${ENV.goveeSku || '<empty>'}`);
  log.info(`  GOVEE_DEVICE      = ${ENV.goveeDevice || '<empty>'}`);
  log.info(`  SHIELD_IP         = ${ENV.shieldIp || '<empty>'}`);
  if (!ENV.spotifyClientId) {
    log.warn(
      'SPOTIFY_CLIENT_ID is empty in this bundle. If it IS set in .env, Metro ' +
        'served a cached transform — restart with: expo start --clear',
    );
  }
}
