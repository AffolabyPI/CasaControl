/**
 * Phone-side Govee light control. All calls go through the hub (the tablet holds
 * the Govee API key); the phone never sees the key.
 */
import {
  rgbToInt,
  type GoveeDevice,
  type GoveeScene,
  type GoveeDiyScene,
  type GoveeLightState,
} from '@casacontrol/shared';
import { hubClient } from './connection';

export type { GoveeDevice, GoveeScene, GoveeDiyScene, GoveeLightState };

export function fetchGoveeDevices(): Promise<GoveeDevice[]> {
  return hubClient.getGoveeDevices();
}

export function fetchGoveeScenes(sku: string, device: string): Promise<GoveeScene[]> {
  return hubClient.getGoveeScenes(sku, device);
}

export function fetchGoveeDiyScenes(sku: string, device: string): Promise<GoveeDiyScene[]> {
  return hubClient.getGoveeDiyScenes(sku, device);
}

export function fetchGoveeState(sku: string, device: string): Promise<GoveeLightState> {
  return hubClient.getGoveeState(sku, device);
}

const target = (d: GoveeDevice) => ({ sku: d.sku, device: d.device });

export function setGoveePower(d: GoveeDevice, on: boolean): Promise<unknown> {
  return hubClient.sendCommand({ action: 'govee.power', on, ...target(d) });
}

export function setGoveeBrightness(d: GoveeDevice, value: number): Promise<unknown> {
  return hubClient.sendCommand({ action: 'govee.brightness', value, ...target(d) });
}

export function setGoveeColor(d: GoveeDevice, r: number, g: number, b: number): Promise<unknown> {
  return hubClient.sendCommand({ action: 'govee.color', rgb: rgbToInt(r, g, b), ...target(d) });
}

export function setGoveeScene(d: GoveeDevice, scene: GoveeScene): Promise<unknown> {
  return hubClient.sendCommand({
    action: 'govee.scene',
    sceneId: scene.id,
    paramId: scene.paramId,
    ...target(d),
  });
}

export function setGoveeDiyScene(d: GoveeDevice, scene: GoveeDiyScene): Promise<unknown> {
  return hubClient.sendCommand({ action: 'govee.diyScene', value: scene.value, ...target(d) });
}

/** A small palette of quick-pick colours for the light card. */
export const COLOR_PRESETS: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: 'Red', rgb: [255, 0, 0] },
  { name: 'Orange', rgb: [255, 120, 0] },
  { name: 'Yellow', rgb: [255, 220, 0] },
  { name: 'Green', rgb: [0, 200, 60] },
  { name: 'Cyan', rgb: [0, 200, 220] },
  { name: 'Blue', rgb: [0, 80, 255] },
  { name: 'Purple', rgb: [150, 0, 255] },
  { name: 'Pink', rgb: [255, 60, 180] },
  { name: 'White', rgb: [255, 240, 220] },
];
