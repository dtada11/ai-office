import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';
import { readJson, writeJsonAtomic } from './jsonFile.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  lastSeenVersion: string;
  alwaysShowLabels: boolean;
  watchAllSessions: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  onboardingDone: boolean;
}

/** All keys in AdapterSettings. Used by adapters to map `pixel-agents.foo` → `foo`. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'lastSeenVersion',
  'alwaysShowLabels',
  'watchAllSessions',
  'hooksEnabled',
  'hooksInfoShown',
  'onboardingDone',
] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

/** Namespaces = adapter identities sharing the same config.json file. */
export type ConfigNamespace = 'vscode' | 'standalone';

export interface PixelAgentsConfig {
  vscode: AdapterSettings;
  standalone: AdapterSettings;
  externalAssetDirectories: string[];
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  soundEnabled: true,
  lastSeenVersion: '',
  alwaysShowLabels: false,
  watchAllSessions: false,
  hooksEnabled: true,
  hooksInfoShown: false,
  onboardingDone: false,
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/** Coerce a loose object into a valid AdapterSettings with defaults for missing/wrong-typed fields. */
function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_ADAPTER_SETTINGS.soundEnabled,
    lastSeenVersion:
      typeof obj.lastSeenVersion === 'string'
        ? obj.lastSeenVersion
        : DEFAULT_ADAPTER_SETTINGS.lastSeenVersion,
    alwaysShowLabels:
      typeof obj.alwaysShowLabels === 'boolean'
        ? obj.alwaysShowLabels
        : DEFAULT_ADAPTER_SETTINGS.alwaysShowLabels,
    watchAllSessions:
      typeof obj.watchAllSessions === 'boolean'
        ? obj.watchAllSessions
        : DEFAULT_ADAPTER_SETTINGS.watchAllSessions,
    hooksEnabled:
      typeof obj.hooksEnabled === 'boolean'
        ? obj.hooksEnabled
        : DEFAULT_ADAPTER_SETTINGS.hooksEnabled,
    hooksInfoShown:
      typeof obj.hooksInfoShown === 'boolean'
        ? obj.hooksInfoShown
        : DEFAULT_ADAPTER_SETTINGS.hooksInfoShown,
    onboardingDone:
      typeof obj.onboardingDone === 'boolean'
        ? obj.onboardingDone
        : DEFAULT_ADAPTER_SETTINGS.onboardingDone,
  };
}

export function readConfig(): PixelAgentsConfig {
  const parsed = readJson(getConfigFilePath(), 'config file') as Partial<PixelAgentsConfig> | null;
  return {
    vscode: parseAdapterSettings(parsed?.vscode),
    standalone: parseAdapterSettings(parsed?.standalone),
    externalAssetDirectories: Array.isArray(parsed?.externalAssetDirectories)
      ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
      : [],
  };
}

export function writeConfig(config: PixelAgentsConfig): void {
  writeJsonAtomic(getConfigFilePath(), config);
}
