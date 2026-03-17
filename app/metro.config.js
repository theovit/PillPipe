const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .wasm files (needed for expo-sqlite web via wa-sqlite)
config.resolver.assetExts.push('wasm');

module.exports = withNativeWind(config, { input: './global.css' });
