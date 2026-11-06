# iOS 越狱布局差异（写代码前必读）

> 这份文档只为回答一件事：**同一个包/同一段代码，为什么在别人机器上好好的，
> 在这台机器上就"装了但网关起不来"**。
> 结论先给：越狱的"根"不是一个固定路径，**任何写死的绝对路径都会在某一种布局上翻车**。

## 1. 三种布局，三种根

| 布局 | 典型越狱 | 包根（dpkg 的 `/`） | 系统里能看到 `/var/jb` 吗 | App 落在哪 |
|---|---|---|---|---|
| rootful | checkra1n / unc0ver / 老 palera1n | `/`（真的是根） | 没有（也不需要） | `/Applications/…` |
| rootless | Dopamine / palera1n rootless | `/`，但越狱内容在 `/var/jb` | **有** | `/var/jb/Applications/…` |
| **RootHide / roothide** | Relaxin（本设备的形态） | `/private/var/containers/Bundle/Application/.jbroot-<随机串>/` | **没有** | `.jbroot-<随机串>/Applications/…` |

RootHide 的 jbroot 是**随机命名**的，例如：

```
/private/var/containers/Bundle/Application/.jbroot-031DF27F42DB3933/
├── Applications/Agent2API.app          ← dpkg 把 /Applications 下沉到这里
├── Library/LaunchDaemons/*.plist
└── usr/local/bin/agent2api-server
```

它的目的就是"让检测不到越狱"，所以**故意不提供 `/var/jb`**。

## 2. 铁律

1. **不要在 plist / 脚本 / Swift 里写死安装路径。**
   `ProgramArguments`、环境变量、日志路径、UI 目录，全都必须由安装期算出来。
   `launchd` 不会替你翻译 `/var/jb` 或 `/usr/local`。
2. **不要让数据目录跟着安装前缀走。**
   数据和程序是两种东西：
   - 程序 → 跟着 dpkg 根（rootless 是 `/var/jb`，RootHide 是 `.jbroot-*`）；
   - **数据 → 固定放 `/var/mobile/Library/agent2api`**。
   理由：① RootHide 下 `.jbroot-*` 由 root 布局，daemon 以 `mobile` 跑时常读不动，
   表现为登录页「数据库不可用，无法保存管理员账号」；
   ② jbroot 名字会随重建引导变化，路径一变账号/配置全丢。
3. **安装期解根，只有两条可靠判据**（见 `scripts/build-allinone-deb.sh` 的 postinst）：
   ① `$0` 形如 `<jbroot>/var/lib/dpkg/info/<pkg>.postinst` → 取 `/var/lib/dpkg` 之前的部分；
   ② 兜底扫 `/private/var/containers/Bundle/Application/.jbroot-*`（存在 `usr/local/bin` 才算）。
   命中后把 `PREFIX` 切成 jbroot，后续所有 `${PREFIX}/…` 自动跟随。
4. **plist 里已经落盘的绝对路径，安装后要就地改写**：
   `sed -e 's#/usr/local/#<jbroot>/usr/local/#g'`。
5. **RootHide 上 daemon 必须带 `platform-application` 签名**（`ldid -S platform.plist`），
   否则 launchd 拒绝 exec，日志里只有一句 `posix_spawn failed`。
6. **postinst 末尾的"兜底直启"是以 root 跑的**：它写出来的库/日志属主是 `root`，
   必须在收尾时 `chown -R mobile:mobile` 交回去，否则下次 launchd 以 mobile 起就读不动。
7. **`respring`（注销）不会重载 LaunchDaemon**。
   守护进程归 launchd 管，只有开机 / `ldrestart` / `launchctl bootstrap|kickstart` 才会重来。
   "装完注销一下"只对注入型 tweak 有效。

## 3. 新功能上线前的检查清单

- [ ] 代码里搜一遍 `/var/jb`、`/usr/local/var`、`/Applications`：是否都是"安装期拼出来的"？
- [ ] plist 里的每个 `<string>` 路径，在 RootHide 上是否还有效？
- [ ] 数据/日志/插件目录是否都在 `/var/mobile` 下（不随 jbroot 变）？
- [ ] postinst 是否在**所有退出路径**上都 `chown mobile` 过？
- [ ] 改完是否在 RootHide 真机上验证过（本设备即 RootHide，不能只看 rootless 模拟器）？

## 4. 已知坑速查

| 现象 | 原因 | 处置 |
|---|---|---|
| 面板「网关未响应 127.0.0.1:3065」 | plist 里 ProgramArguments 是错的绝对路径，launchd exec 失败 | 安装期解根并改写 plist |
| 面板「数据库不可用，无法保存管理员账号」 | 数据目录属主是 root（兜底直启留下），或落在 jbroot 里不可写 | 数据放 `/var/mobile`，postinst `chown -R mobile` |
| 注销后仍然没反应 | respring 不重载 daemon | 重启 / ldrestart / `launchctl kickstart` |
| 用户报"没有 `/var/jb` 这个目录" | 他是 RootHide | 不要争辩布局，直接按 `$0`/`.jbroot-*` 自适应 |
| 装完 App 在 `.jbroot-*/Applications`，但 `/usr/local` 不存在 | 正常，dpkg 根就是 jbroot | 同上 |
