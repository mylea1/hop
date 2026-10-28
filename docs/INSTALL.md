# 安装与两台电脑测试

## 从源码启动

1. 在两台电脑安装 Node.js **22.12.0+**，确认 `node --version`。
2. 将完整 Hop 项目复制或克隆到两台电脑。两台电脑各自安装依赖，不要跨系统复制 `node_modules`。
3. 在各自的项目目录运行：

```sh
npm ci
npm test
npm start
```

`npm ci` 需要联网下载依赖与 Electron。后续启动和文件传输只使用局域网。源码模式中系统提示的应用名称可能是 **Electron**；打包安装后显示 **Hop**。

## macOS 安装包

要求 macOS 13 或更新版本。

1. Apple silicon（M 系列）选择 `Hop-mac-arm64.dmg`；Intel Mac 选择 `Hop-mac-x64.dmg`。
2. 双击 DMG，把 Hop 拖到 Applications / 应用程序，弹出磁盘映像。
3. 从“应用程序”打开 Hop。
4. 首次提示访问本地网络时选择允许；如提示访问下载文件夹，允许 Hop 保存接收文件。
5. 如果使用自己构建、尚未签名或公证的版本，系统可能阻止首次打开。先尝试启动，再到 **系统设置 → 隐私与安全性**，在系统提供该选项时为 Hop 点击 **仍要打开 / Open Anyway**，确认应用名称后继续。此选项是否出现取决于系统版本和管理策略。[Apple 官方安装说明](https://support.apple.com/en-gb/102445)

如果此前拒绝了局域网权限，到 **系统设置 → 隐私与安全性 → 本地网络** 开启 Hop，然后重新打开应用。macOS 从第一次本地网络访问开始记录权限；从终端启动的命令行程序及其子进程可能适用不同规则，因此最终应从 Finder 测试打包应用。[Apple 本地网络权限说明](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

关闭窗口会保留 Dock 中的 Hop，并继续监听。点击 Dock 图标重新打开；使用 **Hop → Quit Hop** 完全退出。

## Windows 安装包

选择 `Hop-windows-x64.exe`。推荐 Windows 11 22H2+；较早的受支持 Windows 版本使用普通背景，不提供原生 acrylic 效果。

1. 双击安装程序，选择当前用户的安装目录并完成安装。
2. 自己构建的未签名版本可能显示“Windows 已保护你的电脑”。确认这是自己的构建或可信来源后，点击 **更多信息 / More info → 仍要运行 / Run anyway**。企业策略或 Smart App Control 可能不提供继续选项；此时需要签名构建或管理员处理。签名后的新版本也可能在建立下载信誉前出现提示。[Microsoft SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
3. 启动 Hop。出现 Windows 防火墙提示时，允许 Hop 在当前的**专用网络**通信。
4. 如果曾拒绝：打开 **Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙 → 更改设置 → 允许其他应用**，选择已安装的 `Hop.exe` 并勾选专用网络。源码开发时对应 Electron 可执行文件。[Microsoft 防火墙操作说明](https://support.microsoft.com/en-us/windows/security/firewall/risks-of-allowing-apps-through-windows-firewall)

关闭窗口后 Hop 留在系统托盘，可能位于隐藏图标区域。点击托盘图标或菜单的 **Open Hop** 重新打开；**Quit Hop** 才会停止接收。

## 第一次互传

1. 两台电脑连接同一路由器的 Wi-Fi 或有线 LAN，并同时打开 Hop。无须公网连接。
2. 等待几秒，确认雷达中出现另一台电脑。通过设备名和 Mac / Windows 图标辨认。
3. 在 A 机把一个文件拖到 B 机设备节点。B 机应出现包含文件名与大小的请求卡片。
4. B 机点击 **Accept**，检查进度环和完成提示，打开 `Downloads/Hop` 查看文件。
5. 再从 B 向 A 发送一个文件，确认反向连接正常。

点击设备也可以选取文件；选取文件夹时使用界面的文件夹选项。Windows 的系统选择器无法在一次对话框里同时选择文件与文件夹，可分别选取，或直接将两者一起拖拽到目标设备。

## 文件夹与 3 MiB 文件哈希测试

项目的 `scripts/fixtures.js` 可创建一组测试数据及 SHA-256 清单，并核对接收结果。先在 A 机项目目录运行：

```sh
node scripts/fixtures.js create ./hop-fixture
```

将脚本生成的三个项目 **`Hop Test Folder` 文件夹、`hop-3MiB.bin`、`hop-sha256.json`** 一起拖到 B 机。B 机接受并等待完成，然后对保存目录运行：

```sh
node scripts/fixtures.js verify "/实际的接收目录"
```

例如 macOS 的接收目录通常为 `/Users/你的用户名/Downloads/Hop`，Windows 通常为 `C:\Users\你的用户名\Downloads\Hop`。目录可能被系统重定向，以 Hop 窗口底部显示的位置为准。脚本验证普通文件、嵌套文件与 3 MiB 文件的 SHA-256，并检查空目录保留，成功后再交换 A/B 方向重复一次。

为避免重名测试影响哈希路径，第一次使用空的接收文件夹，或在 Hop 底部选择一个新的测试接收目录。第二次发送同一批数据时，已有文件与目录应保留，新内容使用编号命名；核对文件数、大小以及实际重命名的文件即可。

单独核对文件 SHA-256 也可使用系统命令，两端输出应一致：

macOS：

```sh
shasum -a 256 "/实际路径/文件名"
```

Windows PowerShell：

```powershell
Get-FileHash -Algorithm SHA256 "C:\实际路径\文件名"
```

## 功能验收清单

| 操作 | 预期结果 |
| --- | --- |
| 发送嵌套文件夹、空目录与零字节文件 | 层级、内容和空目录保留 |
| 接收方选择 Decline | 发送方得到拒绝提示，未开始写入文件 |
| 再次发送同名文件 | 原文件不变，新文件带编号 |
| 勾选 Always accept 后重启接收方 | 来自该设备的下一次请求自动接收 |
| 清空信任列表后再次发送 | 重新出现 Accept / Decline 卡片 |
| 修改底部接收目录 | 后续接收保存到新目录 |
| 关闭接收方窗口后发送 | 应用仍运行；未信任请求会唤起窗口，受信任请求自动接收 |
| 退出另一台设备 | 最后 beacon 约 10 秒后从列表移除 |
| Light / Dark / Auto 切换 | 主题更新；Auto 跟随操作系统 |
| 断开正在传输的网络 | 显示失败，清理未完成文件；恢复后可重新发送 |

## 找不到设备或传输失败

按顺序检查：

1. 两台应用都在运行，电脑未睡眠，并连接到同一可相互通信的局域网。
2. 避免路由器访客 Wi-Fi、AP / 客户端隔离、相互隔离的 VLAN；这些网络可允许上网但阻止设备互访。
3. 查看 Local Network 与防火墙权限。Hop 使用 **UDP 47800** 做发现，使用**每次启动随机分配的 TCP 端口**做 HTTP 传输；只开放 47800 不够，应允许 Hop 应用的入站局域网通信。
4. VPN 或虚拟网卡可能改变路由。暂时断开 VPN 后比较，或查看启动日志中的广播地址与 HTTP 端口。
5. 检查接收目录存在且可写、磁盘空间足够，以及源文件在传输过程中没有被删除或修改。
6. 从应用中打开日志位置并查看 `startup.log`。默认位置是 macOS 的 `~/Library/Application Support/Hop/logs/startup.log`，或 Windows 的 `%APPDATA%\Hop\logs\startup.log`。若启动异常，窗口会主动显示错误；重新从终端 `npm start` 运行也能看到日志。开发环境设置 `HOP_PROFILE_DIR` 时，设置与日志位于该目录。

没有设置固定传输端口，无须配置路由器公网端口映射。防火墙、本地网络权限、SmartScreen 和 Gatekeeper 提示由系统管理，应用无法自动代替用户接受。
