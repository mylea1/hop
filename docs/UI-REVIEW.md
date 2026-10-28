# UI and desktop lifecycle review

Independent review on 2026-10-28 covered `src/main/main.js`, `src/main/preload.js`, the four renderer files, the Electron smoke harness, its recorded results and captured screenshots. This review was separate from the renderer implementation and from the network review.

## Findings resolved during review

| Finding | Change verified in source |
| --- | --- |
| Windows native caption buttons and custom controls competed for the same titlebar space. | Keep native caption controls, hide the duplicate controls and reserve 150 px on the right. |
| An opaque page background hid the configured vibrancy/acrylic material. | Apply a translucent theme tint while retaining opaque-enough controls and dialogs. |
| Rebuilding every activity card on each progress event restarted its arrival animation. | Reuse cards by transfer ID and update their content in place. |
| Activity order could reverse after settings/state hydration. | Sort by `updatedAt`, independently of the incoming array order. |
| The settings field allowed 128 characters while persistence limited names to 64; the UI could display a different name from the beacon. | Match the field limit to 64 and display the canonical settings returned over IPC. |
| `backgroundThrottling: false` prevented the wave's `document.hidden` guard from working after the window was hidden. | Restore Electron's default background throttling. Network processing remains in the Node main process. |
| Quitting could terminate the process before an interrupted receive removed its partial file. | Main now waits for shutdown, and the receiver waits for active request handlers to finish cleanup. A Node regression checks immediate post-shutdown contents. |
| A transient broadcast failure permanently changed the connection status to a warning. | Keep per-interface errors in logs/toasts without permanently replacing the service state. |

Windows notifications now set the AppUserModelID matching the package configuration. The shader uses defined `smoothstep` edge ordering, and native Help-menu events open the connection dialog.

## Runtime evidence inspected

The final `npm run test:ui` run passed all **10 recorded scenarios** under Electron 45.1.0 on macOS. WebGL was active initially, and the forced-context-loss check successfully switched to Canvas. The harness launches the actual desktop application with an isolated profile and validates:

1. A visible startup window, working preload bridge, local HTTP server and first-launch guide.
2. Three fixture devices in the radar, a progress ring and activity cards.
3. Light, Dark and Auto settings and device-name changes through IPC.
4. An actual HTTP folder plus 3 MiB file accepted using the renderer checkbox and Accept button, with identical SHA-256 hashes and persisted trust.
5. Closing the window sets `document.hidden` while a trusted transfer still succeeds; an untrusted offer brings the window forward, and Decline rejects the transfer.
6. Clicking a device and sending through the file-picker route. The test supplies the picker selection; it does not claim to operate the native chooser dialog.
7. A disk-backed Chromium File crossing the real preload `webUtils.getPathForFile` bridge and transferring with matching hash.
8. Changing the destination through the UI and receiving the next trusted transfer in that new directory.
9. Clearing trust, opening Help from the native-menu event and maintaining document bounds at the 930 × 700 minimum window size.
10. Forcing the WebGL context-loss handler and verifying a working Canvas fallback.

The harness reported no renderer errors or unhandled promise rejections. Synthetic radar fixtures are used only in smoke mode; the actual application's nearby devices come from UDP discovery.

## Visual inspection

The reviewer inspected `test-results/nearby-light.png`, `nearby-dark.png`, `incoming-offer.png`, `first-launch.png`, `minimum-window.png` and the final `canvas-fallback.png`. The radar remained centered, platform marks were recognizable, the accept/decline card remained readable, footer controls stayed inside the window and the activity panel scrolled within its allocated region. Light and dark palettes kept the same hierarchy. The captures also showed the file chips on their curved flight path and the device progress ring. The Canvas fallback screenshot retained the translucent colored background and intact layout.

Source inspection confirmed keyboard-focus styles, real button elements for nearby devices, native dialog focus handling, reduced-motion handling, and a Canvas replacement when WebGL initialization or the context fails.

## Scope

No remaining blocking UI defect was found in the inspected state. The screenshots are macOS renderer captures, not proof of native Windows caption, tray, acrylic or firewall behavior. Windows installation and physical two-computer discovery remain in the manual acceptance checklist. The final runtime results and forced Canvas capture were independently inspected after the review fixes.

Electron's documented visibility behavior supports the background-throttling correction: [BrowserWindow — Page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility).

## v1.0.1 runtime follow-up — 2026-10-29

Replaced the subtle background with a radial iridescent wave centered on the measured `.self-face` bounds. Both paths use a 2.4-second expansion (1.5× the prior 3.6-second duration). The updated smoke run passed 12 checks: captured pixel changes reach all four horizontal regions and the activity sidebar, and the mean distance of the visible light from the self icon increases in both WebGL and forced Canvas fallback. Actual renderer recordings are in `docs/images/radial-wave.gif` and `radial-wave-canvas.gif`. This follow-up records implementation validation, separately from the original independent review above.
