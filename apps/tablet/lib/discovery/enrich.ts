/**
 * Turns a raw discovered device into a friendlier one: a smart display name,
 * vendor/model (from mDNS TXT records, which the scanner would otherwise throw
 * away), and a list of suggested actions. Some actions are directly runnable via
 * the hub (e.g. wake a PS5); others are suggestions that need setup we don't have
 * yet (e.g. HDMI-CEC / ADB on an Android TV), surfaced as hints.
 */
import type { Device, DeviceAction } from '@casacontrol/shared';

export interface DiscoveryContext {
  serviceType?: string;
  txt?: Record<string, unknown> | null;
}

function txtStr(txt: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const v = txt?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/** True when a Cast/AirPlay model string looks like a TV rather than a speaker. */
function looksLikeTv(model: string): boolean {
  const m = model.toLowerCase();
  return /shield|android tv|google tv|appletv|apple tv|bravia|\btv\b/.test(m);
}

interface VendorModel {
  vendor?: string;
  model?: string;
  isAndroidTv?: boolean;
  isAppleTv?: boolean;
}

/** Pull vendor/model from TXT records + hostname for the given service type. */
function vendorModel(ctx: DiscoveryContext, hostname: string | null): VendorModel {
  const type = (ctx.serviceType ?? '').toLowerCase();
  const host = (hostname ?? '').toLowerCase();

  if (type.includes('googlecast')) {
    const model = txtStr(ctx.txt, 'md'); // e.g. "SHIELD Android TV", "Chromecast", "Nest Hub"
    const m = (model ?? '').toLowerCase();
    if (m.includes('shield')) return { vendor: 'NVIDIA', model, isAndroidTv: true };
    if (m.includes('android tv') || m.includes('google tv'))
      return { vendor: 'Google', model, isAndroidTv: true };
    return { vendor: 'Google', model };
  }
  if (type.includes('airplay') || type.includes('raop')) {
    const model = txtStr(ctx.txt, 'model') ?? txtStr(ctx.txt, 'am');
    const isAppleTv = (model ?? '').toLowerCase().startsWith('appletv');
    return { vendor: 'Apple', model, isAppleTv };
  }
  if (type.includes('ipp')) {
    const ty = txtStr(ctx.txt, 'ty'); // "HP OfficeJet Pro 9010"
    const vendor = ty?.split(/\s+/)[0];
    return { vendor, model: ty };
  }
  // Hostname fallbacks for ping-swept / generic hosts.
  if (host.includes('shield')) return { vendor: 'NVIDIA', model: 'SHIELD Android TV', isAndroidTv: true };
  if (host.includes('appletv') || host.includes('apple-tv')) return { vendor: 'Apple', isAppleTv: true };
  return {};
}

/** Choose the nicest available display name. */
function smartName(base: Device, ctx: DiscoveryContext, vm: VendorModel): string {
  const type = (ctx.serviceType ?? '').toLowerCase();
  const fromTxt = type.includes('googlecast')
    ? txtStr(ctx.txt, 'fn') // Cast friendly name, e.g. "Living Room TV"
    : type.includes('ipp')
      ? txtStr(ctx.txt, 'ty')
      : undefined;

  const candidate =
    fromTxt ??
    (base.name && base.name !== base.ip ? base.name : undefined) ??
    vm.model ??
    (base.hostname && base.hostname !== base.ip
      ? base.hostname.replace(/\.local\.?$/i, '')
      : undefined) ??
    base.ip;

  // mDNS instance names are often "Name._service._tcp" — keep just the label.
  return candidate.replace(/\._.*$/, '').trim() || base.ip;
}

/** Suggested actions for a device, given its kind + detected model. */
function suggestActions(device: Device, vm: VendorModel): DeviceAction[] {
  const actions: DeviceAction[] = [];

  if (device.kind === 'ps5' || device.kind === 'ps4') {
    actions.push({
      id: 'ps5.wake',
      label: 'Wake console',
      icon: 'game-controller',
      command: { action: 'ps5.wake' },
    });
    actions.push({
      id: 'ps5.status',
      label: 'Check status',
      icon: 'information-circle',
      command: { action: 'ps5.status' },
    });
    return actions;
  }

  if (vm.isAndroidTv || vm.isAppleTv || looksLikeTv(vm.model ?? device.name)) {
    actions.push({
      id: 'tv.power',
      label: 'Turn on TV',
      icon: 'tv',
      hint: vm.isAndroidTv
        ? 'Enable network ADB (port 5555) on the Android TV, then it can power the TV on via HDMI-CEC. Wiring pending.'
        : 'This device can power the TV on over HDMI-CEC. Wiring pending.',
    });
    if (vm.isAndroidTv) {
      actions.push({
        id: 'app.launch',
        label: 'Open an app',
        icon: 'apps',
        hint: 'Launch a streaming app on the Android TV (needs network ADB). Wiring pending.',
      });
    }
    return actions;
  }

  if (device.kind === 'chromecast' || device.kind === 'airplay') {
    actions.push({
      id: 'cast',
      label: 'Cast media',
      icon: 'play-circle',
      hint: 'Cast audio or video to this device. Wiring pending.',
    });
    return actions;
  }

  if (device.kind === 'printer') {
    actions.push({
      id: 'printer.print',
      label: 'Print a document',
      icon: 'print',
      hint: 'Pick a file on the phone to print to this printer.',
    });
    return actions;
  }

  if (device.kind === 'spotify') {
    actions.push({
      id: 'spotify.playhere',
      label: 'Play music here',
      icon: 'musical-notes',
      hint: 'Start Spotify from the Music tab; this device shows up as a target.',
    });
  }

  return actions;
}

/** Enrich a freshly-discovered device in place-returning a new object. */
export function enrichDevice(base: Device, ctx: DiscoveryContext = {}): Device {
  const vm = vendorModel(ctx, base.hostname);
  const name = smartName(base, ctx, vm);
  const enriched: Device = {
    ...base,
    name,
    ...(vm.vendor ? { vendor: vm.vendor } : {}),
    ...(vm.model ? { model: vm.model } : {}),
  };
  const actions = suggestActions(enriched, vm);
  if (actions.length) enriched.suggestedActions = actions;
  return enriched;
}
