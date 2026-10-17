// Expo config plugin:
// 1. lets the main screen appear over the lock screen and wake the display (like a real call)
// 2. adds notifee's local maven repo
// 3. copies the ringtone into res/raw so the notification channel can loop it
const { withAndroidManifest, withProjectBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withCallScreen(config) {
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    const main = (app.activity || []).find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    }
    return c;
  });

  config = withProjectBuildGradle(config, (c) => {
    const repo = 'maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }';
    if (!c.modResults.contents.includes('@notifee/react-native/android/libs')) {
      c.modResults.contents = c.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (m) => `${m}\n        ${repo}`
      );
    }
    return c;
  });

  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/raw');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(
        path.join(c.modRequest.projectRoot, 'assets/ringtone.wav'),
        path.join(dir, 'ringtone.wav')
      );
      return c;
    },
  ]);

  return config;
};
