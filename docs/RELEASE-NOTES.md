Hop lets Mac and Windows computers share files and folders directly over the same Wi-Fi or LAN.

- **Apple silicon Mac:** `Hop-mac-arm64.dmg`
- **Intel Mac:** `Hop-mac-x64.dmg`
- **Windows x64:** `Hop-windows-x64.exe`

macOS 13 or newer is required. Windows 11 22H2 or newer provides the acrylic backdrop; older supported Windows versions use a visual fallback. Installed applications include their own Electron / Node runtime.

On first launch, allow local network access and allow Hop through the firewall on your private network. Downloads go to `Downloads/Hop` unless changed in the app. Close the window to keep receiving in the background; use the app or tray menu to quit completely.

Builds without configured signing credentials may show macOS Gatekeeper or Windows SmartScreen prompts. See `docs/INSTALL.md` in the source repository for installation and two-computer verification steps. `SHA256SUMS.txt` contains installer checksums.
