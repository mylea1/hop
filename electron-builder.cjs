/** Shared packaging config; no frontend build step and no runtime dependencies. */
module.exports = {
  appId: 'com.hop.desktop',
  productName: 'Hop',
  asar: true,
  directories: { output: 'dist', buildResources: 'assets' },
  files: ['src/**/*', 'assets/icon.png', 'assets/icon.ico', 'assets/tray*', 'package.json'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    artifactName: 'Hop-mac-${arch}.${ext}',
    icon: 'assets/icon.icns',
    category: 'public.app-category.utilities',
    minimumSystemVersion: '13.0.0',
    darkModeSupport: true,
    extendInfo: {
      NSLocalNetworkUsageDescription: 'Hop uses your local network to discover nearby computers and transfer files directly between them.',
      NSDownloadsFolderUsageDescription: 'Hop saves the files you accept into your chosen Downloads folder.'
    }
  },
  dmg: {
    title: 'Hop',
    contents: [
      { x: 140, y: 180, type: 'file' },
      { x: 420, y: 180, type: 'link', path: '/Applications' }
    ],
    window: { width: 560, height: 360 }
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Hop-windows-${arch}.${ext}',
    icon: 'assets/icon.ico'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Hop',
    uninstallDisplayName: 'Hop',
    deleteAppDataOnUninstall: false
  }
};
