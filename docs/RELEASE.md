# 构建与发布

## 本地构建

使用 Node.js 22.12.0+，在项目根目录先运行：

```sh
npm ci
npm test
npm run icons
```

Mac 上执行：

```sh
npm run dist:mac
```

这会生成 `dist/Hop-mac-arm64.dmg` 和 `dist/Hop-mac-x64.dmg`。Mac 构建需要 Apple 硬件与 macOS；支持在同一 Mac 构建两个架构，但每个架构仍应在对应机器验证启动。若只构建当前目标：

```sh
npx electron-builder --mac dmg --arm64 --publish never
npx electron-builder --mac dmg --x64 --publish never
```

Windows 上执行：

```sh
npm run dist:win
```

生成 `dist/Hop-windows-x64.exe`。`npm run pack` 只输出未封装的应用目录，适合检查资源与调试启动。

配置位于 `electron-builder.cjs`；应用没有前端编译步骤。图标生成脚本产出 1024 px PNG、macOS ICNS 与 Windows ICO。

## GitHub Actions

把 **Hop 目录里的内容**作为 GitHub 仓库根目录提交，保留 `package-lock.json` 与 `.github/workflows/release.yml`。不要把外层 `outputs/` 目录作为仓库根目录。

工作流使用三个独立构建任务：

| runner | 架构 | 产物 |
| --- | --- | --- |
| `macos-15` | Apple silicon arm64 | `Hop-mac-arm64.dmg` |
| `macos-15-intel` | Intel x64 | `Hop-mac-x64.dmg` |
| `windows-2022` | x64 | `Hop-windows-x64.exe` |

两个 macOS 任务均使用 GitHub 的 Apple 硬件 runner，不在 Linux 模拟或交叉制作 DMG。runner 标签依据 [GitHub 官方列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

每个任务执行 `npm ci`、`npm test`、图标生成与平台打包，并上传安装包。独立 Release 任务依赖整个构建矩阵成功，检查三个文件齐全后生成 `SHA256SUMS.txt`，将三个安装包和校验文件一起发布。

首次发布：

```sh
git add .
git commit -m "Build Hop local file sharing app"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

版本标签必须严格等于 `v` 加 `package.json` 的版本号，例如 `1.0.1` 对应 `v1.0.1`；不一致会在打包前失败。后续发布先用 `npm version` 更新版本与 lockfile，再推送提交和标签。工作流本身只在 `v*` 标签推送时运行，不会在日常分支提交时发布。

GitHub 仓库需要启用 Actions，并允许工作流写入 Releases。只有 Release job 获得 `contents: write`；构建 job 使用只读权限。重新运行已有标签的工作流会更新同名 Release 资产。

## 可选的正式签名

没有证书时仍可构建安装包，但接收机器可能出现 Gatekeeper / SmartScreen 提示。代码中不会自动接受系统提示。开发、安装与两机验证步骤见 [INSTALL.md](INSTALL.md)。

签名与公证使用 electron-builder 的正常流程；为 GitHub 仓库配置这些 Actions secrets：

| Secret | 用途 |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application 的 `.p12` 内容（base64）或构建环境可获取的证书地址 |
| `MAC_CSC_KEY_PASSWORD` | 上述证书密码 |
| `APPLE_ID` | 用于 Apple 公证的账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的 app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `WIN_CSC_LINK` | Windows 代码签名证书的 `.p12/.pfx` 内容（base64）或地址 |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 |

Mac 的三个 Apple 环境变量配合有效 Developer ID 证书启用 builder 的公证流程。Windows 的证书类型和密钥存储方式可能要求不同的签名工具；如果使用云签名或硬件令牌，需要按证书服务提供商的流程调整签名配置。不要把证书、私钥或密码提交到仓库。[electron-builder v26 macOS 文档](https://www.electron.build/v26/docs/mac/)

Windows 即使签名，新文件也可能因下载信誉不足出现 SmartScreen 提示；不能以“已签名”保证永远没有弹窗。[Microsoft SmartScreen 文档](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

## 平台配置

- `NSLocalNetworkUsageDescription` 说明发现与直接传输用途；使用原始 UDP / HTTP，没有声明 Bonjour 服务。[Apple 说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription)
- 默认接收目录使用系统 Downloads 路径；`NSDownloadsFolderUsageDescription` 提供保存用途说明。
- macOS 最低为 13，与 Electron 45 对系统版本的要求一致。[Electron Breaking Changes](https://www.electronjs.org/docs/latest/breaking-changes)
- macOS 使用 vibrancy；Windows 11 22H2+ 支持 acrylic，较旧系统使用背景回退。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

## 发布前在真实设备确认

自动化网络测试与构建不能证明真实路由器、防火墙及首次权限已通过。至少在一台 Mac 和一台 Windows 上安装产物，按 [INSTALL.md](INSTALL.md) 完成双向文件夹 + 3 MiB 哈希测试，并测试关闭窗口后的接收、信任持久化与同名文件处理。使用签名证书时，另外检查下载后的安装包签名、公证与首次启动表现。
