import { Capacitor } from "@capacitor/core";
import packageJson from "../../package.json";

export type SmartClipPlatform = "Android (Capacitor)" | "Browser";

export function getPlatform(): SmartClipPlatform {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
    ? "Android (Capacitor)"
    : "Browser";
}

export const appVersion = packageJson.version;
