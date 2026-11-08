# 手机端 UI 设计体系分析

> 分析对象：`desktop-tauri/mobile/`（React + Vite + Capacitor PWA，入口 `ui/m.html`）
> 依赖关系：`mobile` 以**源码**方式消费 `ui-kit/`（令牌与组件）与 `ui-shared/`（业务共享件），
> 不走 npm 包：tsconfig `paths` 把 `@ui` 指向 `../ui-kit/src/index.ts`，vite 把 `@ui` 指向 `../ui-kit/src`。
> 本文用于指导「设置补全」系列开发的界面实现，避免每个页面各写一套观感。

---

## 1. 五层结构

```
① 令牌层   ui-kit/styles/theme.css      --ui-*      颜色 / 字体 / 半径 / 阴影（随 data-theme 切深浅）
② 映射层   mobile/src/styles/mobile.css --m-*       把桌面令牌映射成移动端语义 + 补移动端尺寸令牌
③ 骨架层   ui-kit/styles/mobile.css                 .m-page / .m-card / .m-row / .m-tabbar …（@layer components）
④ 组件层   ui-kit/src/*.tsx                         shadcn 对齐的标准件（Button/Input/Switch/Sheet/Select…）
⑤ 页面层   mobile/src/pages/*.tsx                   用 ③④ 拼页面；共用件在 mobile/src/components/
```

**关键约束**：手机端样式**不引用**桌面端的 `ui/css/*`。`mobile.css` 自己 `@source` 了
`ui-kit/src`、`ui-shared`、以及本工程源码，Tailwind 只生成这些目录里出现的类名。

---

## 2. 令牌层：`--ui-*`（ui-kit/styles/theme.css）

三套主题并存：`:root`（浅色）、`:root[data-theme='dark']`、`@media (prefers-color-scheme: dark)`。
另有 `@custom-variant dark` 供 Tailwind 使用。

### 颜色语义（项目级约定，必须遵守）

| 语义 | 令牌 | 用途 |
|---|---|---|
| 正常 / 成功 | `--ui-success` + `-soft` / `-bd` | 账号可用、网关运行中 |
| 警告 / 限流 | `--ui-warning` + `-soft` / `-bd` | 限流中、告警 |
| 危险 / 失效 | `--ui-destructive` + `-soft` / `-bd` | 凭证失效、删除操作 |
| 主色 | `--ui-primary` + `-soft` / `-bd` / `-fg` / `-on` / `-hover` / `-tint` | 选中态、链接、主按钮 |
| 信息 | `--ui-info` + `-soft` / `-bd` | 提示条 |
| 敏感 | `--ui-sensitive` + `-soft` / `-bd` | 凭证类字段 |
| 国际化 | `--ui-intl` + `-soft` / `-bd` | 跨境/代理商相关标记 |

### 结构令牌

- 表面三档：`--ui-background`（页面底）、`--ui-surface`（卡片）、`--ui-surface-2`（内嵌块/行激活）、`--ui-surface-3`
- 文字三档：`--ui-foreground`、`--ui-text-2`、`--ui-muted-foreground`
- 描边两档：`--ui-border`、`--ui-border-strong`
- 阴影三档：`--ui-shadow-1`（卡片）、`--ui-shadow-2`、`--ui-shadow-3`（浮层/胶囊）
- 控件态：`--ui-control-bg` / `-border` / `-border-hover` / `-hover`、`--ui-focus-ring`、`--ui-ring`
- 字体：`--ui-font-sans`、`--ui-font-mono`
- 半径基准：`--ui-radius`（其余半径都是它的倍数）

---

## 3. 映射层：`--m-*`（mobile.css）

把 `--ui-*` 起别名成语义更短的 `--m-*`，并**补一组移动端尺寸令牌**：

| 令牌 | 值 | 说明 |
|---|---|---|
| `--m-r-xs/sm/md/lg/xl` | `--ui-radius` × .5/.6/.8/1/1.4 | 卡片用 `lg`，内嵌块用 `sm/md` |
| `--m-tabbar-h` | `60px` | 底部标签栏内容高度（安全区另加） |
| `--m-safe-b` / `--m-safe-t` | `env(safe-area-inset-bottom/top, 0px)` | 刘海与home条 |
| `--m-font` / `--m-mono` | 同 `--ui-font-*` | `.m-mono` 另加 `tabular-nums`（数字列对齐） |

> **写代码时只用 `--m-*`**；只有在 `--m-*` 没覆盖时才直接用 `--ui-*`。**不要写死色值。**

---

## 4. 骨架层：可用类清单

### 4.1 应用壳与滚动

| 类 | 作用 |
|---|---|
| `.m-app` | 整屏纵向 flex；`data-offline='true'` 时压缩页头（离线条已吃掉安全区） |
| `.m-scroll` | 正文滚动区（隐藏滚动条、`overscroll-behavior: contain`） |
| `.m-page` | 页面根；`position: relative`（下拉刷新指示器的定位基准）+ 进场动画 `m-fade` |
| `.m-page.m-fixed` | **固定头部 + 独立滚动列表**用：根变 flex 纵向、`.m-scroll` 改 `overflow:hidden`（靠 `:has()` 自动切换，不用 JS） |
| `.m-sticky` | `.m-fixed` 页里的不滚动头（页头+搜索+筛选收在一个容器里，避免各自 sticky 互相盖住） |
| `.m-body` | `.m-fixed` 页里自己滚的正文 |

**选型规则**：设置/表单页用 `.m-page`（整页一起滚）；长列表或带筛选条的页用 `.m-page.m-fixed`。

### 4.2 头部

| 类 | 作用 |
|---|---|
| `.m-head` | 一级页大标题区（h1 26px/700，负字距），自己补 `--m-safe-t` |
| `.m-head .m-sub` | 副标题 12.5px 三级色 |
| `.m-head-actions` | 右侧动作区（保存按钮等） |
| `.m-navbar` | 二级页返回栏：`sticky`、毛玻璃（`backdrop-filter: blur(18px)`）、自带安全区 |
| `.m-navbar-title` | 居中标题 15.5px/600 |
| `.m-navbar-slot` | 右侧占位 34px（左右对称，标题才居中） |
| `.m-assistant-head` | 助手页专用紧凑页头（自己补安全区；离线时退回 10px） |

### 4.3 区块与卡片

| 类 | 作用 |
|---|---|
| `.m-section` | 左右 16px 内边距 + 上边距 16px（区块分隔） |
| `.m-section-head` | 区块标题行（h2 13.5px/600 二级色 + 右侧 `.m-link` 文字按钮） |
| `.m-card` | 卡片：`--m-surface` 底 + 1px 描边 + `--m-r-lg` + `--ui-shadow-1` + `overflow:hidden`；相邻卡片自动 10px 间距 |
| `.m-card-pad` | 卡片内边距 14/15px（**表单**用这个，列表用默认不带 padding 让 `.m-row` 自己撑满） |

### 4.4 行与列表

| 类 | 说明 |
|---|---|
| `.m-row` | 标准行：`min-height: 52px`、下边框、`:active` 变 `--m-surface-2`；按钮行直接给它 `className='m-row ...'` |
| `.m-row .m-grow` | 弹性正文容器（`min-width: 0`，防长文本撑破） |
| `.m-row .m-t1` / `.m-t2` | 主文案 14px / 次文案 12px 三级色 |
| `.m-row .m-chev` | 右侧箭头（16px） |
| `.m-row .m-val` | 右侧值文本 13px 二级色 |
| `.m-logo` | 左侧 34×34 图标块（圆角 10px，`--m-surface-2` 底）；`.m-lg` 变 40×40 |
| `.m-rows` | **紧凑只读键值组**（圆角 12px、`--m-surface-2` 底）；配 `.m-k` / `.m-v`；行高收到 44px |
| `.m-kv` / `.m-kv-cell` | 两列信息格（`.k` 标签 / `.v` 值），统计摘要用 |
| `.m-empty` | 空状态文案块 |
| `.m-chips` | 横向滚动筛选条（隐藏滚动条、左右 16px） |

### 4.5 导航栏与浮层

| 类 | 说明 |
|---|---|
| `.m-tabbar` | 底部标签栏：毛玻璃 + 上边框 + 高度 `60px + safe-b` |
| `.m-tab` | 单个标签（图标 23px + 10.5px 文字）；选中态看 `aria-current='page'`；红点用 `.m-dot` |
| `.m-ptr` / `.m-ptr-inner` / `.m-ptr-spin` | 下拉刷新指示器（绝对定位于 `.m-page` 顶部） |
| `.m-notice-top` | 离线提示条（自己吃安全区，页头随之退让） |
| `.m-notice-update` | 「有新版本」浮动胶囊（`bottom = tabbar + safe-b + 12`，拇指可达），进场 `m-rise` |

### 4.6 Sheet / Dialog 内部

`[data-slot='sheet-body'] > *` 与 `[data-slot='dialog-body'] > *` 被设为 `flex-shrink: 0` ——
抽屉内正文保持自然高度，避免带 overflow 的卡片被 flex 压扁。抽屉里的 `.m-kv` 会被覆盖成**两列**，
`.m-rows` 在抽屉里改成「k 左 v 右」的对齐变体。

---

## 5. 组件层：ui-kit 可用件（shadcn 对齐）

> 组件库自己的注释写明：**形态、props 命名、组合方式一律对齐 shadcn/ui（Base UI 支线）**；
> 加新组件先看 shadcn 有没有标准件，有就照搬 API，**不要自造 prop**（历史上 Input 上那个自造的 `icon` 已被标准 `InputGroup` 取代）。

| 类别 | 组件 |
|---|---|
| 动作 | `Button`（`variant`/`size`）、`Toggle`、`IconButton`（mobile 自有）、`confirmDialog` |
| 输入 | `Input`、`Textarea`、`InputGroup*`、`Label`、`Switch`、`Checkbox`、`RadioGroup*`、`Select*`、`MultiSelect`、`SegmentedControl`、`Verification` |
| 反馈 | `Alert`、`Empty`、`Skeleton`、`Spinner`、`StatusDot`、`Progress*`、`Meter`、`Toast`/`toastManager` |
| 容器 | `Card*`、`Item*`、`Field*`、`Collapsible`、`Sheet*`、`Dialog*`、`AlertDialog*`、`Popover*`、`ResponsiveSheet` |
| 数据 | `Table*`、`Pager`、`MetricCard`/`MetricGrid`、`HtmlContent` |
| 布局 | `AppFrame`、`PageHeader`/`PageTitle`/`PageDescription`、`BottomNavigation*`、`Sidebar*`（桌面用）、`NavList` |

**手机端自有共用件**（`mobile/src/components/`）：
`PageHead`、`PageIntro`、`IconButton`、`SectionHead`、`Badge`、`Empty`、`ErrorNote`、`SkeletonList`、`StatCard`、`Icon`、`PullToRefresh`/`PullIndicator`、`Shell`（含 TabBar）、`SystemInfoSheet` 等。

---

## 6. 页面模式（照抄这几套）

### 6.1 列表页

```
.m-page.m-fixed
 ├ .m-sticky  → PageHead / 搜索框 / .m-chips 筛选条 / 分段控件
 └ .m-body    → .m-card 列表（每项一行）或 .m-rows 紧凑组
                + SkeletonList（首屏）/ Empty（空）/ ErrorNote（错误）
```
配 `usePullToRefresh` + `PullIndicator`；分页用 `Pager`；筛选状态存路由参数或 store。

### 6.2 表单/设置页（本系列开发的主要形态）

```
.m-page
 ├ PageHead        title + subtitle + actions={保存按钮}
 ├ .m-section      SectionHead + Card.m-card-pad
 │                 Label + Input / Switch 行 / SegmentedControl / MultiSelect
 │                 + 范围/说明文字（11.5px，--m-text-3）
 └ .m-section      （下一个区块，带自己的保存按钮）
```

### 6.3 设置行（开关 / 跳转）

```tsx
<Button size='default' variant='ghost' type='button'
  className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
  onClick={...}>
  <span className='m-logo'><Icon name='settings' /></span>
  <div className='m-grow'>
    <div className='m-t1'>{t('标题')}</div>
    <div className='m-t2'>{t('一句话说明')}</div>
  </div>
  <span className='m-chev'><Icon name='chev' /></span>
</Button>
```
开关行把 `.m-chev` 换成 `<Switch />`。

### 6.4 抽屉表单

`Sheet` + `SheetHeader`（`SheetTitle`）+ `SheetBody` + `SheetFooter`（取消/确认）；
`showCloseButton={!busy}`：**进行中不给关**（恢复、清空这类长操作）。

### 6.5 状态与反馈

| 场景 | 用什么 |
|---|---|
| 首屏加载 | `SkeletonList` 或 `Empty text='正在读取…'` |
| 空数据 | `Empty` |
| 请求失败 | `ErrorNote`（红字条） |
| 操作成功 | `store.toast(...)`（轻提示，不用弹窗） |
| 危险操作 | `confirmDialog`（删除、清空、数据保留裁剪） |
| 长时间操作 | `Progress` + 阶段文案（见备份恢复的 500ms 轮询） |

---

## 7. 交互与无障碍约定

- **触摸优化**：按钮与 `.m-row` 禁选中文字；`.m-row:active` 给背景反馈；`-webkit-tap-highlight-color: transparent`。
- **键盘让位**：`TabBar` 在软键盘弹起时**整条隐藏**（`visualViewport` 覆盖高度 > 120px 判定），把高度让给输入框。
- **安全区**：页头/导航栏/标签栏各自补 `--m-safe-t/b`；离线条出现时页头退回 10px（避免刘海机型多一条空白）。
- **返回**：二级页用 `.m-navbar` 的返回按钮 + Android 硬件返回（`store.handleHardwareBack`）+ hash 路由（`restoreFromHash`）。
- **无障碍**：当前标签用 `aria-current='page'`；图标按钮给 `aria-label`；标签栏给 `aria-label={t('主导航')}`。
- **动画克制**：页面进场 `m-fade` 0.18s、浮层 `m-rise` 0.24s、下拉刷新旋转 0.9s 线性；不做花哨过渡。

---

## 8. 本次「设置补全」必须遵守的实现守则

1. **页面骨架**：新页一律 `.m-page`（长列表才 `.m-fixed`）+ `.m-section` + `.m-card`；表单卡片加 `.m-card-pad`。
2. **设置行**：开关行/跳转行用 6.3 的模板（`.m-logo` + `.m-t1/.m-t2` + `Switch`/`.m-chev`），不自己发明行样式。
3. **数值表单**：`Label` + `Input inputMode='numeric'` + 下方 11.5px 范围说明；越界报错不静默改值。
4. **控件选型**：开关 `Switch`；二选一分段 `SegmentedControl`；多选 `MultiSelect`；枚举 `Select`；主按钮 `Button`（危险动作用 `variant='destructive'`）。
5. **颜色**：只用 `--m-*` / `--ui-*` 令牌；状态色按第 2 节的语义表选（绿=正常、黄=限流、红=失效）。
6. **数字**：金额/计数/耗时加 `m-mono`（等宽 + tabular-nums）。
7. **文案**：一律 `t()`；中文即键、缺译回落中文，新增文案不必改词典。
8. **每个区块独立保存按钮**（本系列约定）：一处校验失败不牵连其它区块。
9. **危险操作**：`confirmDialog` 二次确认，文案写明不可恢复。
10. **身份守卫**：异步回调里先 `serverIdentity() === identity` 再 `setState`（切服务器后旧响应不能覆盖新页面）。

---

## 9. 已知取舍

- 手机端图标集是**精简的**（24×24、currentColor、描边 1.8），只收手机端用到的那些，不搬桌面端 60+ 图标；新页面优先复用现有 `Icon` 名，缺了再补一条 path。
- 新增文案只有中文（词典是上游产物 `ui/i18n.js`），与现有手机端新增页面一致。
- `--m-*` 与 `--ui-*` 是两套名字，同一语义两处出现；新代码统一用 `--m-*`，不要新增第三套。
