// Monorepo-aware Metro config with NativeWind.
// Watches the workspace root so the @casacontrol/shared package resolves.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Use THIS app dir as Metro's server root (not the Yarn-workspace root). Newer
// Expo defaults the release bundler (`expo export:embed`) to the workspace root,
// which then resolves the entry file and expo-router's `app/` folder against the
// wrong base in a monorepo (white screen / "No routes found"). This matches dev.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

// Load the monorepo-root .env. Expo only auto-loads `<app>/.env`, but our env
// lives at the workspace root — without this, no EXPO_PUBLIC_* vars get inlined.
// This runs in the Metro process before transform workers fork, so the workers
// inherit the vars and babel-preset-expo can inline them. (Restart with --clear
// after changing .env: values are baked in at transform time and cached.)
require('dotenv').config({ path: path.resolve(workspaceRoot, '.env') });

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
