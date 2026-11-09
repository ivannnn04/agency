import type { CapacitorConfig } from '@capacitor/cli'

// Native shells for the App Store / Google Play: the app is a thin wrapper
// that loads the live platform, so every web deploy updates the apps too.
const config: CapacitorConfig = {
  appId: 'com.gudrix.coworkspace',
  appName: 'Gudrix',
  webDir: 'capacitor-shell',
  server: {
    url: 'https://agency-omega-topaz.vercel.app/start',
    allowNavigation: ['agency-omega-topaz.vercel.app'],
  },
  backgroundColor: '#00140c',
  ios: {
    contentInset: 'automatic',
  },
}

export default config
