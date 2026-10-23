// Jedno miejsce wyboru silnika: na iPhonie natywny plugin (BLE, głos w tle, zapis),
// w przeglądarce webowy zamiennik z symulowanymi czujnikami.
import { Capacitor } from '@capacitor/core';
import { RideEngine, type RideEnginePlugin } from './ride-engine';
import { WebRideEngine } from './web-ride-engine';

let web: WebRideEngine | undefined;

export function isNativeRide(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('RideEngine');
}

export function getRideEngine(): RideEnginePlugin {
  if (isNativeRide()) return RideEngine;
  web ??= new WebRideEngine();
  return web;
}

/** Tylko w przeglądarce: przyspieszenie symulacji (1, 10, 30). */
export function setWebSimSpeed(x: number) {
  if (!isNativeRide()) (getRideEngine() as WebRideEngine).setSpeed(x);
}
