/**
 * Centralized EXPO_PUBLIC_* access + startup diagnostic for the phone app.
 * Values are inlined at transform time (loaded from the monorepo-root .env via
 * metro.config.js), so a .env edit needs `expo start --clear` to take effect.
 */
import { createLogger, maskSecret } from '@casacontrol/shared';

const log = createLogger('env');

export const ENV = {
  spotifyClientId: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '',
  anthropicApiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '',
  hubLocalIp: process.env.EXPO_PUBLIC_HUB_LOCAL_IP ?? '',
  hubTailscaleIp: process.env.EXPO_PUBLIC_HUB_TAILSCALE_IP ?? '',
} as const;

export function logEnvStatus(): void {
  log.info('EXPO_PUBLIC_* values inlined into this bundle:');
  log.info(`  SPOTIFY_CLIENT_ID = ${maskSecret(ENV.spotifyClientId)}`);
  log.info(`  ANTHROPIC_API_KEY = ${maskSecret(ENV.anthropicApiKey)}`);
  log.info(`  HUB_LOCAL_IP      = ${ENV.hubLocalIp || '<empty>'}`);
  log.info(`  HUB_TAILSCALE_IP  = ${ENV.hubTailscaleIp || '<empty>'}`);
  if (!ENV.spotifyClientId) {
    log.warn(
      'SPOTIFY_CLIENT_ID is empty in this bundle. If set in .env, restart Metro ' +
        'with: expo start --clear',
    );
  }
}
