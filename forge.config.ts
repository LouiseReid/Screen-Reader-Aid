import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency). Loads KEY=VALUE lines from a gitignored
// .env at the project root into process.env without overriding existing vars.
function loadDotEnv(): void {
  try {
    const file = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of file.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // No .env present — rely on the real environment (or build unsigned).
  }
}
loadDotEnv();

// Signing/notarization are opt-in via env so an unsigned build still works with
// zero credentials. Once a "Developer ID Application" cert is in the Keychain and
// the notarize vars are set (see .env.example), `npm run make` signs + notarizes.
const signIdentity = process.env.APPLE_IDENTITY;
const signEnabled = process.env.APPLE_SIGN === '1' || !!signIdentity;
const notarizeReady =
  !!process.env.APPLE_ID &&
  !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  !!process.env.APPLE_TEAM_ID;

const osxSign = signEnabled ? { identity: signIdentity } : undefined;
const osxNotarize =
  signEnabled && notarizeReady
    ? {
        appleId: process.env.APPLE_ID as string,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD as string,
        teamId: process.env.APPLE_TEAM_ID as string,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: './build/icon',
    appBundleId: 'com.louisereid.voiceovercompanion',
    appCategoryType: 'public.app-category.developer-tools',
    // Our custom native addon is not in node_modules and is excluded from the
    // asar, so ship it as a resource and load it from process.resourcesPath at
    // runtime (see src/main.ts). Must be built first via `npm run build:native`.
    extraResource: ['./native/build/Release/addon.node'],
    osxSign,
    osxNotarize,
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin']), new MakerDMG({ overwrite: true })],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
