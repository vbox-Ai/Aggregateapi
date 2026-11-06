# 交接文档 · Agent2API iOS（越狱 deb / 插件 / CI）

> 面向"下一个人/下一个会话"：读完这份 + `docs/IOS-LAYOUTS.md`，就能接着干活，
> 不用再从头踩一遍。最后更新：2026-11-06（`18464f4`）。

---

## 0. 现状（已验证）

| 项 | 状态 |
|---|---|
| 越狱 deb（RootHide，`iphoneos-arm64e`，rootful 变体） | ✅ 装上能进面板 |
| 网关 daemon | ✅ launchd 自动拉起，SQLite 正常（`/var/mobile/Library/agent2api`） |
| 预置插件 | ✅ providers 3.4.4（34 家）+ web 3.4.4（4 家），装完即"已启用" |
| 面板内安装插件 | ✅ 走自己的 Release 通道能装（签名门槛已按自建包放开） |
| 机器人校验（ALTCHA） | 默认关闭；打开后链路也是通的（0005 修了密钥漂移） |

设备参考：iPhone15,2 / iOS 17.0 / **Relaxin（RootHide 结构，无 `/var/jb`）**。

---

## 1. 仓库与上游

- 本仓库 `vbox-Ai/Aggregateapi` **不 vendoring** 上游代码：
  构建时 `git clone` 上游 `aimod-cc/Agent2API` 并 checkout **最新 `v*` tag**，
  再打本仓库的 5 个补丁（`agent2api-universal/patches/*.diff`）。
- 本仓库自己的一层：`agent2api-ios/`（Swift 壳 + `ios-ffi` daemon）、
  `agent2api-universal/`（host.js 等）、`scripts/`（打包/发布）、`plugins/`（插件清单）、`index.json`（插件索引）。
- **上游升级怎么办**：什么都不用改，构建会自动跟最新 tag；但要跑
  `scripts/align-plugin-version.py`（CI 已内置），把插件包版本抬到 **≥ 网关版本**。

---

## 2. 一次构建产出什么

`workflow_dispatch` 输入：

| 输入 | 取值 | 说明 |
|---|---|---|
| `only` | `all` / `ios` / `plugins` / `store` / `macos` / `windows` / `linux` / `android` / `web` | `store` = 只跑 `plugins` + `ios` + 发布 |
| `publish` | `true` / 默认 `false` | **只有 `true` 才会写 Release**；push 触发的构建不发布 |

产物（`out/`）：

```
out/ios/Agent2API-<ver>-{rootless,rootful}-iphoneos-{arm64,arm64e}.deb   # 4 只，各 ~22 MB
out/ios/Agent2API-client.ipa  /  Agent2API-standalone.ipa                 # 只在 Actions artifact 里
out/packs/agent2api-providers-3.4.4-aarch64-unknown-linux-gnu.zip
out/packs/agent2api-web-providers-3.4.4-aarch64-unknown-linux-gnu.zip
```

命名与路径是**契约**，改动前先看 `update.rs` 的 `asset_name()`：

- 资产名 = `{pack_id}-{version}-{target}.zip`，iOS 上 `target` 恒为 `aarch64-unknown-linux-gnu`（网关的 `target_triple()` 对非 win/mac 都返回它）；
- 插件通道 tag：`v{version}`（providers）、`web-v{version}`（web）。

---

## 3. 发布流程

```
Actions → build → Run workflow
  only = store
  publish = true
```

会依次：`plugins`（编两个 iOS 插件包）→ `ios`（deb + IPA，预置插件）→
`release`（发快照 tag `ios-YYYYMMDD-b<run>` + 覆盖 `v{版本}` / `web-v{版本}` 两个插件通道）。

> **`make_latest` 只能给一个**：快照 `ios-*` 必须是 `false`，`v{version}` 必须是 `true`。
> 否则网关 stable 通道查 `/releases/latest` 解析不到 `v{version}`，
> 面板显示「当前网关平台暂无插件包」。

---

## 4. 版本规则（最容易错）

| 版本 | 来源 | 用途 |
|---|---|---|
| 上游 tag（当前 `v3.4.2`） | `aimod-cc/Agent2API` | 代码基线；每次构建自动取最新 |
| **`CURRENT_VERSION`** | 上游 `agent2api-server` 的 `CARGO_PKG_VERSION` | 网关自己的版本；**插件包版本必须 ≥ 它**，否则整包不加载、也装不上 |
| deb/App 的 `3.4.<run>` | 插件清单 `major.minor` + GitHub run_number | **只是构建戳**，与兼容性无关 |
| App 顶栏括号里的 sha | 本仓库提交 | 定位构建来源 |

`scripts/align-plugin-version.py` 在三处作业里跑（plugins / ios / release），保证清单版本不低于上游 tag。

---

## 5. 越狱布局（详见 `docs/IOS-LAYOUTS.md`）

三种根，**任何写死的绝对路径都会在某种布局上翻车**：

| 布局 | 包根 | App 落在 |
|---|---|---|
| rootful | `/` | `/Applications/…` |
| rootless | `/var/jb` | `/var/jb/Applications/…` |
| **RootHide** | `/private/var/containers/Bundle/Application/.jbroot-<随机>/` | `.jbroot-*/Applications/…` |

`postinst` 在安装期解根：① `$0` 里的 `/var/lib/dpkg` 前缀 ② 扫 `.jbroot-*`；
命中后把 `PREFIX` 切成 jbroot，并把 plist 里的 `/usr/local/…` 改写成 `<jbroot>/usr/local/…`。

---

## 6. 运行时布局（重要）

```
程序（跟着 root 走）
  <root>/Applications/Agent2API.app
  <root>/usr/local/bin/agent2api-server          ← daemon，root 运行
  <root>/Library/LaunchDaemons/com.chiyu.agent2api.plist
  <root>/usr/local/share/agent2api/{ui,packs}

数据（固定，不跟 root）
  /var/mobile/Library/agent2api/                 ← AGENT2API_PROXY_HOME / HOME
      agent2api.db  server.log  plugins/
```

要点：

- **daemon 以 root 运行**（plist 不设 `UserName`）；签名用 `plugin-entitlements.plist`
  （`platform-application` + `no-sandbox` + `get-task-allow` + `skip-library-validation`）。
  曾经设 `mobile` → RootHide 上建不了库，日志是 `[Storage] 数据库不可用`。
- **数据放 `/var/mobile`**：`.jbroot-*` 由 root 布局且名字随机，放里面既读不动、重装还丢。
- **插件预置**：deb 里带 `usr/local/share/agent2api/packs/{id}/{version}/` + `plugins.json`，
  `postinst` 拷进 `$DATA/plugins/` 并写注册表（注册表是网关判断"装了什么"的唯一来源，
  它不会自己扫目录）。`scripts/stage-plugin-packs.py` 负责生成这两样。
- **机器人校验默认关**（`AGENT2API_CAPTCHA_ENABLED=0`）；面板只监听 127.0.0.1，真门槛是账号口令。

---

## 7. 五个补丁各做什么

| 补丁 | 目标 | 一句话 |
|---|---|---|
| `0001-plugin-host-ios-exec-gate` | `plugin_host` | iOS 上允许 spawn 插件进程（闸门） |
| `0002-host-capabilities-endpoint` | `api/host.rs` 等 | 面板拿宿主能力表 |
| `0003-plugin-index-own-repo-and-no-rollback` | `update.rs`/`packages.rs` | 索引指向本仓库；失败不回滚只记日志 |
| `0004-plugin-store-own-repo-unsigned` | `update.rs`/`compatibility.rs`/`policy.rs` | 签名要求改为读文档字段；release 一律列全量；镜像通道不再强制验签；补齐路径放行未签名包 |
| `0005-altcha-secret-stable` | `altcha.rs` | 把 HMAC 密钥固定为进程内唯一（修"前端验证成功、服务端说无效"） |

打补丁是 `git apply --3way`，失败会 **fail loudly**（上游改了这几个文件就要重新生成补丁）。

---

## 8. 这一轮踩过的坑（按顺序，都能复现）

| # | 现象 | 根因 | 修法 | commit |
|---|---|---|---|---|
| 1 | 面板「暂无插件包」 | `/releases/latest` 被 `ios-*` 快照占用，`v{version}` 解析失败 | 补丁 0004 改为一律列全量 + 快照 `make_latest:false` | `0e2ad29` |
| 2 | 下载完爆红「未通过官方签名校验」 | 镜像通道无条件验签 + 自建包无签名 | 0004 去掉该条件；`official/require_signed` 置 false | `0e2ad29` |
| 3 | 「需要补齐插件 / 已加载 0 家」 | 插件版本 < 网关 `CURRENT_VERSION` | `align-plugin-version.py` + 预置 3.4.4 | `0e2ad29` |
| 4 | CI 只有 Windows 红 | 上游自定义 NSIS 模板缺 `RestartManager` 宏 | 改 `cargo tauri build --bundles msi`，且打包 `continue-on-error` | `91cfe28` `7741b7a` |
| 5 | macOS 作业 1 秒被取消 | `macos-14` 标签被下线（`configuration ... not supported`） | 三个 macOS 作业改 `macos-15` | `c4fa030` |
| 6 | iOS 被插件作业带崩 | `needs: [plugins]` + 依赖被取消 → skipped | ios `if: always()` | `a885020` |
| 7 | 前端「验证成功」但服务端「无效」 | `altcha::secret()` 库不可用时每次随机 → 签发/验签密钥不同 | 0005 `OnceLock` + 幂等补写 | `cb67cd3` |
| 8 | 「网关未响应 3065」 | RootHide 上 plist 写死 `/usr/local/...`，launchd exec 不到 | postinst 解 jbroot 并改写 plist | `159ba11` |
| 9 | 「数据库不可用」 | 数据在 jbroot 里 + daemon 以 mobile 跑 | 数据固定 `/var/mobile`；daemon 改 root；删坏库 | `c0717be` `18464f4` |

---

## 9. 排障手册（不用 SSH）

**第一步永远看安装日志**（Sileo 安装详情）：`postinst` 会打印 jbroot、布局、
`launchctl bootstrap` 的原始报错、`launchctl print` 前 12 行、`ls -l $DATA`、`server.log` 末 60 行。

再不行用 Filza 看：

```
/var/mobile/Library/agent2api/server.log      ← daemon 自己的日志（首选）
<root>/Library/LaunchDaemons/com.chiyu.agent2api.plist   ← 检查 ProgramArguments
```

| 文案 | 含义 | 处置 |
|---|---|---|
| 网关未响应 127.0.0.1:3065 | daemon 没起 | 看安装日志里的 `bootstrap 失败：…` |
| 数据库不可用，无法保存管理员账号 | SQLite 打不开 | 确认 daemon 以 root 跑、`$DATA` 属主 root、库不是 0 字节 |
| 机器人校验无效 | 签名/台账对不上 | 默认已关；要用就确保 0005 在 |
| 当前网关平台暂无插件包 | release 解析不到资产 | 查 `make_latest` 与资产名 |
| 自动安装只接受通过官方签名校验的插件包 | 包未签名且走了自动/镜像路径 | 从文件安装，或确认 0004 在 |

`respring`（注销）**不会**重载 LaunchDaemon；要么重启、要么 `ldrestart`、要么 `launchctl kickstart`。

---

## 10. 已知遗留 / 下一步

1. **合并成一个 universal deb**：`postinst` 已能解根，下一步把 rootless/rootful 两份合成一份
   （payload 用无前缀路径 + 安装期解根改写），先加一只并存验证，再删其余。
2. **插件包签名**：目前是"未签名 + 构建期放行"。想回归正规语义，就生成自己的 ed25519 密钥，
   把公钥加进上游 `OFFICIAL_PUBKEYS` 并在 CI 里签 `pack.json`（0004 就可以撤掉）。
3. **IPA 不进 Release**：发布步骤只收 `*.deb` 和两个插件 zip。要发 IPA 加一行 `find artifacts -name '*.ipa'`。
4. **Windows 只出 exe + msi**：上游 NSIS 模板坏了（不是我们的问题），需要的话给上游提 issue。
5. **CI 里 `macos-14` 已不可用**，新作业一律用 `macos-15`；`sort -V` 在 macOS 不存在，
   用 `scripts/latest-tag.py`。
6. **PAT 安全**：本轮调试用过一枚 classic PAT，权限过大（`delete_repo`/`workflow`），
   交接后请确认已吊销，改用 fine-grained（仅 `Actions: Read` + `Contents: Read`）。

---

## 11. 常用入口

```
源码        https://github.com/vbox-Ai/Aggregateapi
Releases    https://github.com/vbox-Ai/Aggregateapi/releases
Actions     https://github.com/vbox-Ai/Aggregateapi/actions
插件索引    https://raw.githubusercontent.com/vbox-Ai/Aggregateapi/main/index.json
上游        https://github.com/aimod-cc/Agent2API（最新 tag v3.4.2）
```

本地脚本：

```bash
python3 scripts/align-plugin-version.py --min-version v3.4.2     # 插件版本对齐
python3 scripts/stage-plugin-packs.py --out out/stage-packs out/packs/*.zip
bash scripts/build-allinone-deb.sh --app … --binary … --plist … --ui … \
     --packs out/stage-packs --prefix "" --arch both --version 3.4.<run> --out out/ios
```
