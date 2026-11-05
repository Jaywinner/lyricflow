import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jaywinner.lyricflow',
  appName: 'LyricFlow',
  webDir: 'www',
  server: {
    url: 'https://lyricflow-hth8.onrender.com',
    cleartext: false
  }
};

export default config;
