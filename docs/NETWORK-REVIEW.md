# Network review

Independent review performed on 2026-10-28, after the first discovery/transfer integration suite passed and before release packaging. Scope: `src/discovery`, `src/transfer`, `src/main/settings` and their Node tests. The reviewer did not author the original transfer implementation.

## Findings resolved

| Finding | Reproduction | Resolution |
| --- | --- | --- |
| HTTP startup could not recover after an occupied port | Bind a separate HTTP server, attempt Hop startup on that port, free it, then retry. The retry returned `null` without listening. | Reset the failed server and port before rethrowing the bind error. A regression test now starts the service successfully on the freed port and calls `/health`. |
| An accepted offer ID was briefly reusable | Pause destination allocation after acceptance, submit a second offer with the same ID. Both returned 200 and created duplicate directories; one session token replaced the other. | Reserve IDs through both confirmation and directory allocation. The second request now receives 409, and only one directory is created. |
| Settings updates could partially modify memory before validation failed | Submit a valid name alongside an invalid theme. | The main implementation was updated during review to validate a copy, save it, then commit it. The settings test verifies the original name survives a rejected update. |
| Graceful shutdown returned before an aborted file was removed | Interrupt an active upload with `await server.close()`: the partial file still existed immediately afterward and was removed on a later event-loop turn. | Track active request handlers and await their pipeline cleanup before resolving `close()`. The regression checks the destination immediately after shutdown. |

## Verification

`npm test` passed **23 tests, 0 failures, 0 skipped** on macOS arm64 with Node.js 22.23.3 at this review checkpoint.

The suite includes real UDP sockets for discovery and real HTTP streaming in one process. The end-to-end test discovers the receiver, offers a nested folder plus a 3 MiB binary file, preserves an empty folder, and compares SHA-256 hashes for every received file.

Additional checks cover:

- Multi-interface IPv4 subnet calculations, malformed/self beacons, and the 10-second peer lifetime.
- Declined offers, empty files, empty folders, whole-folder collision renaming, and concurrent same-name transfers.
- Relative-path validation, Windows path aliases, traversal attempts, symbolic-link sources and a replaced destination parent.
- Declared-length mismatch, interrupted-stream removal, pending-offer shutdown, source-size changes while awaiting acceptance, and rejection of completed session reuse.
- Persisted identity, destination, theme and trust-list clearing.

No unresolved blocking defect was found in the reviewed behavior. These local tests do not claim a successful transfer between two physical computers or validate Windows firewall/macOS permission dialogs; the two-machine checklist in the README remains the acceptance test for those environments.

## Transfer behavior on interruption

A failed active file is removed. Files already received successfully and directories already created remain in the destination; the transfer is not an all-or-nothing folder transaction. Retrying preserves those files and allocates new collision names. There is no resume protocol. Offers expire after two minutes, stalled streams after two minutes without activity, and abandoned accepted sessions after ten minutes.

Cross-platform path rules intentionally reject names Windows cannot represent. Symbolic links are not followed when building a manifest. Files and directories are copied; platform-specific metadata and extended attributes are not transferred.

The selected directory is resolved to its real filesystem location. Destination parents are checked before opening files, and files are created exclusively so existing files are never replaced. The checks target incoming network paths and ordinary filesystem conflicts; they are not a kernel-level defense against a separate local process racing filesystem mutations.

Discovery sends to every computed IPv4 subnet broadcast address every 1.5 seconds. The deterministic integration test uses two loopback UDP endpoints so it does not depend on the host's Wi-Fi configuration. Router client isolation, VPN routing and OS permission behavior require the physical-machine checks.
