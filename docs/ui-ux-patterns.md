# UI/UX 通用经验手册

> 最后更新：2026-07-01（Phase 1000 Batch 27 — 日期 header 补充）
> 从 GlassMind 和其他项目的 UI 打磨中提取。每条按两层组织：
> **① 问题与思路**（框架无关，自然语言）→ **② 实现速写**（多范式，含关键代码）。
> 不写教程，只写"遇到这类问题往哪个方向想，关键代码怎么写"。

---

## 新读者先看这 3 个

如果只有 5 分钟，读这三个收益最高的模式：

| 优先级 | 模式 | 为什么先看 |
|--------|------|-----------|
| 1 | **模式 3 — 单一数据源** | 解决"改一个值忘了联动方"这个最高频 UI bug 的根因。含变更前 grep 操作流程 |
| 2 | **模式 7 — UI 状态全覆盖** | 每个数据依赖组件都该处理 loading/empty/error/success 四种状态。最容易防、忘了代价最高 |
| 3 | **模式 10 — 打磨优先级** | 给你一个不会吵的排优先级语言。P0-P3 四档，跨所有 UI 项目通用 |

剩下 7 个按需查阅——附录的框架能力速查表可以帮你 10 秒定位对应工具。

---

## 如何使用

翻到与你当前问题匹配的模式 → 读"问题与思路"确认匹配 → 看"实现速写"中与你技术栈最接近的范式 → 根据"自查"确认改完。

每种技术栈用简写标注：**Web CSS**（原生 CSS/SCSS）、**Web JS**（React/Vue/Solid 等组件框架）、**Mobile**（Flutter/SwiftUI/Compose）、**Desktop**（Qt/Electron）。

---

## 模式 1 — 深度叠放：多界面层的显式分层

### 问题与思路

页面上同时存在 header、sidebar、footer、浮动按钮、tooltip、modal overlay 等多个悬浮元素。z-index（或等价物）靠"试一个值→不行再加"堆出来，最终出现 10001、10002 这种无意义的大数。新加一个层不知道该放多少，只好继续往上加。

**❌ 常见错误**：按"创建顺序"分配深度值——先写的给 10，后写的给 20，再后来给 30。很快值就失去了语义，不知道 30 和 40 谁应该在谁上面。

**核心思路**：在设计阶段就建一个深度分层表，按"离用户视觉距离"从远到近排布。每层预留间隔（≥100），新元素按功能归入已有层。

```
背景层      — 页面底色、装饰元素
内容层      — 正文、卡片、列表（正常文档流）
悬浮层      — footer、FAB（浮动操作按钮）、底部固定元素
导航层      — header、top nav、sidebar drawer
遮罩层      — modal backdrop、drawer overlay
弹窗层      — dialog、popover、dropdown
通知层      — tooltip、toast、snackbar（必须覆盖一切）
```

**原则**：
- 同一层的元素用相邻值（如 100/101/102），视觉上一眼看出一组
- 预留间隔 ≥100，避免"插一个新层就要全局重新编号"
- 如果某个元素需要在两个语境下处于不同层级，优先重新审视设计而非用动态 z-index

### 实现速写

**Web CSS**：
```css
/* 分层常量 — 全局唯一真相源 */
:root {
  --z-content:  0;
  --z-float:  100;   /* footer, FAB */
  --z-nav:    200;   /* header, sidebar */
  --z-overlay: 300;   /* modal backdrop */
  --z-modal:  400;   /* dialog, popover */
  --z-notify: 500;   /* tooltip, toast */
}
/* 同层内相邻值表示同组 */
.gm-header  { z-index: var(--z-nav); }        /* 200 */
.gm-sidebar { z-index: calc(var(--z-nav) + 1); } /* 201 */
```

**Flutter**：`Material` 的 `elevation`（0-24 范围）或 `Stack` 的绘制顺序。`Overlay`/`showDialog` 自动管理最高层——不要手动创建竞争。

**SwiftUI**：`zIndex` modifier。`sheet`/`popover`/`alert` 自动在最高层级，自定义 overlay 用 `ZStack`。

**通用检测**：项目里最大和最小的深度值相差 >1000？有没有一个值是"试了几次才找到的"？如果是，你需要分层表。

### 自查

- [ ] 全部悬浮元素的深度值按功能分层，不按创建顺序
- [ ] 相邻层之间有 ≥100 的间隔
- [ ] 任意两个元素的叠放关系可以凭值直接判断，不需要脑内模拟

---

## 模式 2 — 边缘感知定位：弹出层的边界检测

### 问题与思路

tooltip、popover、dropdown 等弹出层，默认居中对齐触发元素。当触发元素靠近 viewport 边缘时，弹出层溢出屏幕被裁切或不可见。

**这是跨框架通用问题**——任何"附着在触发元素上的浮层"都需要判断自己是否越界。浏览器原生 `title` 属性自动处理了这一点，但不可定制样式。一旦自建浮层，边界检测就是必答题。

**❌ 常见错误**：浮层只有一种展开方向（如始终向上），viewport 顶部元素触发时浮层溢出屏幕上方。或居中定位 (`left: 50%; transform: translateX(-50%)`) 在 viewport 左右边缘处溢出。

**核心思路**：浮层位置不是"居中 + 偏移"，而是"先算理想位置 → 检测四方向越界 → 选择不越界的展开方向"。优先级：首选下方，下方不够则上方，上下都不够选溢出最少的方向。

**方案选择**：
- 浮层 ≤5 个且触发元素位置固定 → 静态锚定（按元素 viewport 位置预定义 2-4 个展开方向 modifier）
- 浮层多、内容动态、或位置可变 → 运行时位置计算

**先查框架是否已内置**——Floating UI（React）、`Tooltip` widget（Flutter）、`popover` modifier（SwiftUI）、`Overlay`（Angular CDK）。如果框架有，直接用。手写的维护成本远高于用库。

### 实现速写

**Web CSS（静态锚定，适合 ≤5 个位置固定的浮层）**：
```css
/* 默认居中 */
.tip::after { left: 50%; transform: translateX(-50%); }
/* 靠左边缘时锚定左边界 */
.tip--edge-left::after  { left: 0; transform: none; }
/* 靠右边缘时锚定右边界 */
.tip--edge-right::after { left: auto; right: 0; transform: none; }
```

**Web JS（动态检测）**：推荐 Floating UI (`@floating-ui/dom`, 12KB)，已处理 flip/shift/autoPlacement 和 scroll 跟随。手写的话用 `getBoundingClientRect()` 获取触发元素四边坐标 → 比较浮层理论位置与 viewport 尺寸 → 调整 `top/left`。

**Flutter**：
```dart
// Tooltip widget 自带边界检测 — 直接用
Tooltip(message: '收起侧边栏', child: Icon(Icons.arrow_left))

// 自建浮层：RenderBox.localToGlobal + MediaQuery.size
final offset = renderBox.localToGlobal(Offset.zero);
final screenSize = MediaQuery.of(context).size;
final left = (offset.dx + popupWidth > screenSize.width)
    ? screenSize.width - popupWidth - 8  // 靠右
    : offset.dx;                          // 正常
```

**通用检测**：把触发元素放到 viewport 四个角附近，浮层是否完整可见？任一角溢出 = 边界检测不完整。

### 自查

- [ ] 全部浮层在 viewport 四个角和四个边缘都能完整显示
- [ ] 内容长度可变的浮层有最大宽度限制
- [ ] 静态锚定还是动态检测，选择有明确理由

---

## 模式 3 — 布局尺寸的单一数据源 + 变更影响传播

### 问题与思路

UI 中有一个会变的尺寸（header 高度切换、sidebar 宽度可拖拽、字体基准可缩放），被 N 个元素引用。每次变化只改了定义处，忘了引用处——代码不报错但视觉断裂。这是"不报错的 bug"，最危险的一类。

**❌ 反模式**：
```
header:        88px              ← 定义
content-pad:   96px              ← 88+8，人工算的，不会跟着 header 变
sidebar-pad:   88px              ← 同上
toggle-top:    96px              ← 同上
// header 变成 48px 后 → 后面三个全错，但没人/没事会告诉你
```

**✅ 正确模式**：
```
header:        var(--h)          ← 唯一真相源
content-pad:   calc(var(--h) + 8)  ← 声明关系，不存结果
sidebar-pad:   calc(var(--h) - 6)
toggle-top:    calc(var(--h) + 8)
// header 变成 48px → 改一个值，全部自动跟进
```

**这是通用设计原则，跟 CSS 变量无关**。Flutter 里等价于一个 `ValueNotifier` 驱动多个 `AnimatedBuilder`，React 里等价于一个 context state 驱动多个组件 props，后端等价于一个配置中心被多个服务引用。

### 变更流程：改之前先找联动方

**操作顺序（不能反）**：
1. **搜索**当前值在所有文件中的出现（grep / IDE 全局搜索）
2. **区分**定义和引用——改定义，逐一确认每个引用方是否需要同步
3. **如果引用方 ≥3** → 在改值之前先把值提取为变量/常量/token
4. **改完后再次搜索**旧值，确认残留为零

**根因治理**：同一个值出现在 ≥3 处 = 应该提取为变量。不是在"偷懒"，是在消除"会忘"的可能。

### 实现速写

**Web CSS**：
```css
:root { --header-h: 88px; }
.header  { height: var(--header-h); }
.content { padding-top: calc(var(--header-h) + 8px); }
.toggle  { top: calc(var(--header-h) + 8px); }
/* JS 只更新一个变量，所有引用方通过 transition 平滑联动 */
```

**React**：
```jsx
// 一个 context 持有尺寸 → 多个组件通过 hook 读取 → 各自 useMemo 算偏移
const { headerH } = useLayout();
const contentPad = useMemo(() => headerH + 8, [headerH]);
// 纪律：组件不缓存"源值+偏移"的结果，每次渲染重算
```

**Flutter**：
```dart
final headerH = ValueNotifier<double>(88.0);
// 依赖方用 ValueListenableBuilder 重建，不存中间结果
ValueListenableBuilder<double>(
  valueListenable: headerH,
  builder: (_, h, __) => Padding(padding: EdgeInsets.only(top: h + 8), ...),
);
```

**通用检测**：改一个尺寸值，需要在几个文件里同步改数字？>2 = 反模式信号。

### 自查

- [ ] 同一尺寸值出现在 ≥3 处，是否已提取为变量/常量/store
- [ ] 新增依赖元素时，是否只需引用变量 + 声明偏移，不改已有代码
- [ ] 改共享值之前，是否先 grep 找到全部引用方
- [ ] 改完后是否搜索旧值确认无残留

---

## 模式 4 — 固定区域协同：多固定面板的几何建模

### 问题与思路

页面同时有固定 header（顶部）、固定 sidebar（左侧）、固定 footer（底部）。三者各自占据 viewport 一片区域，但彼此关系没有显式建模。后果：footer 被 sidebar 挤偏、sidebar 底部被 footer 遮挡、主内容区 padding 与 header 脱节。

**优先判断**：很多框架的 `Scaffold`/`Grid`/`flexbox` 已经解决了这个布局。如果你在用 `position: fixed` 手动拼，先问自己：能不能用框架内置的布局方案代替？

**核心思路**：如果确实需要手动 fixed 布局，把这组几何关系显式建模为一组变量——不是写在注释里，而是让代码中的偏移量直接引用同组变量。

```
Header 占：  y=0,         h=H, x=0,       w=viewport-w
Sidebar 占： y=H,         h=V-H-F, x=0,   w=S
Content 占： y=H,         h=V-H-F, x=S,   w=viewport-w-S
Footer 占：  y=V-F,       h=F,   x=S,     w=viewport-w-S
```
其中 H/S/F 是变量，V = viewport 高度。页面级差异（某页无 sidebar）通过将 S 设为 0 表达，不写死另外一套布局。

### 实现速写

**Web CSS**：
```css
:root { --header-h: 88px; --sidebar-w: 21rem; --footer-h: 30px; }
.content  { padding: calc(var(--header-h) + 8px) 0 calc(var(--footer-h) + 8px) 0; }
.footer   { left: var(--sidebar-w); }  /* 不是 left: 0 */
/* 无 sidebar 页：变量覆盖而非选择器硬编码另一套值 */
[data-page="profile"] { --sidebar-w: 0px; }
```

**Flutter**：`Scaffold(appBar:, drawer:, bottomNavigationBar:)` 自动处理三区域几何关系。绝大多数场景不需要手写。手写场景用 `Stack` + `Positioned`，坐标参数统一从同一个 `MediaQuery` 推导。

**React**：
```css
/* grid 全视口布局 — 浏览器替你算，不要手动 fixed */
.layout {
  display: grid;
  grid-template-areas: "header header" "sidebar content" "footer footer";
  grid-template-columns: var(--sidebar-w) 1fr;
  grid-template-rows: var(--header-h) 1fr var(--footer-h);
}
```
**如果有页面不需要 sidebar**：改 grid 模板列定义，不是重新写一套 CSS。

### 自查

- [ ] 是否优先考虑了框架内置布局（Scaffold/Grid/flexbox）代替手动 fixed
- [ ] 三面板的尺寸和偏移量是否使用同一组变量表达
- [ ] "无 sidebar"页面是否通过变量覆盖而非硬编码另一套布局

---

## 模式 5 — 框架默认样式的覆盖策略

### 问题与思路

在第三方 UI 框架上做深度定制时，自定义样式被框架默认样式覆盖。典型场景：品牌按钮用渐变背景 + 白色文字，但框架的 `<a>` 颜色覆盖了白色，渐变背景上显示深色文字。

**核心判断**：你是在空白画布上画，还是在别人的画上改？后者需要一套覆盖策略。

**由优到劣的四级策略**：

| 优先级 | 策略 | 各框架等价手段 |
|--------|------|--------------|
| 1（最优） | 框架的主题系统 | MUI `theme` / AntD `ConfigProvider` / Tailwind `config` / Flutter `ThemeData` / SwiftUI `tint` |
| 2（次优） | 自己的 Design Token 覆盖框架默认值 | CSS 变量挂在 `:root`，特异性 ≥ 框架即可 |
| 3（再次） | 选择器特异性升级 | 双类名、属性选择器、`[data-testid]` 选择器 |
| 4（最后） | `!important` 定点突破 | **只在被覆盖的具体属性上加，不加整个规则块** |

**❌ 常见错误**：上来就用 `!important`，然后另一个样式也被覆盖，再加 `!important` → 最终全文件都是 `!important`，回到起点。

**纪律**：同一组件内 `!important` >3 处 → 回到方案 1 或 2。每处 `!important` 加注释说明被哪个框架规则覆盖。

### 实现速写

**Web CSS — 覆盖 `<a>` 的颜色（最经典的框架冲突）**：
```css
/* ❌ 这样会被框架的 a { color: ... } 覆盖 */
.brand-btn { background: var(--brand-gradient); color: white; }

/* ✅ 锚定具体选择器 + !important 仅在被覆盖的属性上 */
a.brand-btn,
a.brand-btn:link,
a.brand-btn:visited { color: white !important; /* 覆盖 Streamlit a 默认色 */ }

/* ✅✅ 更优：用 token 统一管理，不用 per-component 覆盖 */
:root { --text-on-brand: white; }
.brand-btn { color: var(--text-on-brand) !important; }
```

**Flutter**：
```dart
// Flutter 没有 CSS 级联，所以不需要"优先级战争"
// 但同一个模式出现在被 ThemeData 默认值覆盖的场景：
ElevatedButton(
  style: ElevatedButton.styleFrom(
    backgroundColor: brandColor,  // 显式覆盖 ThemeData 默认色
    foregroundColor: Colors.white,
  ),
  child: Text('回聊天'),
)
```

**React Native**：
```jsx
// StyleSheet 组合：后面的覆盖前面的。框架默认值通常在组件库 theme prop
<Button color={brandColor} textColor="white">  {/* 显式声明 */}
```

### 自查

- [ ] 自定义样式是否优先使用了框架的主题系统
- [ ] 每个强制覆盖（`!important` 或等价）是否标注了被什么覆盖
- [ ] 同一组件强制覆盖 >3 处 → 是否回到主题层面解决

---

## 模式 6 — 动态背景上的文字对比度：双主题下的翻车现场

### 问题与思路

有色背景（品牌渐变、语义色块）上的文字，在亮色模式下正常，切换到暗色模式后文字被框架/浏览器的默认颜色替换，变得"黑乎乎"或"白花花"，对比度不足。

**典型翻车现场**：

```
亮色模式 ✅                          暗色模式 ❌
┌─────────────────┐                 ┌─────────────────┐
│ ■■■■■■■■■■■■■■ │                 │ ■■■■■■■■■■■■■■ │
│ ■  回聊天  ■■■ │ <- 白字紫底 OK   │ ■  回聊天  ■■■ │ <- 文字变深蓝，紫底上看不清
│ ■■■■■■■■■■■■■■ │                 │ ■■■■■■■■■■■■■■ │
└─────────────────┘                 └─────────────────┘
```

**根因**：框架通常给 `<a>` 和 `<button>` 绑定了一个"链接色/主题色"，这个颜色在暗色模式下变浅蓝，在亮色模式下变深蓝。当这些元素被放在自定义有色背景上时，框架的默认色和背景冲突。CSS 的 `color: white` 如果没有足够特异性，会被框架覆盖。

**核心思路**：有色背景上的文字，**背景色和文字色一起声明**，不拆开。两条规则：
- 深色背景（含品牌渐变）→ 白色/浅色文字，声明优先级必须高于框架
- 浅色背景 → 深色文字，用主题变量自动适配

**永远在两种主题下都肉眼确认**。如果只在一种主题下看，没资格说"做好了"。

**快速参考——安全组合**：

| 背景 | 亮色模式文字 | 暗色模式文字 | 需要 !important？ |
|------|------------|------------|------------------|
| 品牌渐变 (#4f46e5→#818cf8) | `white` | `white` | 是（框架 `<a>` 覆盖） |
| 成功/绿色 `#059669` | `white` | `white` | 是 |
| 警告/橙色 `#d97706` | `white` | `white` | 是 |
| 浅灰表面 `#fafbfc` | `--text` | `--text` | 否（变量自动适配） |
| 透明/继承 | `--text` | `--text` | 否 |

### 实现速写

**Web CSS**：
```css
/* 定义一个 token：品牌色背景上的文字色 — 双主题通用 */
:root { --text-on-brand: white; }
[data-theme="dark"] { --text-on-brand: white; }  /* 暗色下也是白色 */

/* 所有品牌色按钮/链接引用这个 token */
.gm-float-back {
  background: var(--brand-gradient);
  color: var(--text-on-brand) !important; /* 必须 !important 因为 <a> 被框架覆盖 */
}
```

**Flutter**：
```dart
// ThemeData 中定义品牌色上的文字色
ThemeData(
  textTheme: TextTheme(
    labelLarge: TextStyle(color: Colors.white), // 品牌按钮文字
  ),
)
// Flutter 无 CSS 级联问题，显式声明即可，不需 !important
```

**SwiftUI**：
```swift
// @Environment(\.colorScheme) 做双主题适配
Link(destination: ...) {
    Label("回聊天", systemImage: "message.fill")
}
.foregroundColor(.white) // 显式声明，不受系统 tint 影响
.background(brandGradient)
```

**通用检测**：亮/暗双主题下，所有品牌色背景上的文字是否能一眼看清？找一个不熟悉的组件，看看有没有"颜色好像不太对"的犹豫感——有就是对比度问题。

### 自查

- [ ] 全部有色背景上的文字，在两种主题下都肉眼确认过
- [ ] 使用了统一的"品牌色背景文字色" token 而非逐个硬编码
- [ ] `<a>` 和 `<button>` 上的自定义颜色确认了优先级高于框架默认值

---

## 模式 7 — UI 状态全覆盖：不只有"数据正常时"

### 问题与思路

只画了"数据正常加载后"的状态。但任何依赖外部数据的 UI 组件至少有 4 种状态：加载中、空数据、出错、正常。忽视了前三者 = 用户面对空白页或静默崩溃。

**❌ 常见错误**：写完正常态就算"做完了"——因为正常态最复杂、最有趣，自然而然只 focus 在它上面。加载/空/错误态"等会再加"，然后就忘了。

**核心思路**：**先写非正常态，正常态最后写**。正常态最复杂，放最后写能防止它吸走全部注意力。

```
状态矩阵（以用户列表为例）：
┌──────────┬───────────────────────┬──────────────────────┐
│ 状态     │ 用户看到的             │ 必须有的元素          │
├──────────┼───────────────────────┼──────────────────────┤
│ 加载中   │ 骨架屏 / spinner      │ 内容区域的占位形状     │
│ 空数据   │ "暂无数据" + 下一步   │ 引导用户做什么        │
│ 出错     │ 错误描述 + 重试入口   │ 重试按钮              │
│ 正常     │ 数据展示              │ —                    │
│ 边界     │ 1条数据不显示"共1页"  │ 分页控件不误导        │
└──────────┴───────────────────────┴──────────────────────┘
```

**空状态不要只写"暂无数据"**——告诉用户下一步做什么。如"还没有聊天记录，发送第一条消息开始吧"比"暂无数据"有用 10 倍。

### 实现速写

**React**：
```jsx
// 早期 return 模式 — 正常态在最后
if (loading)  return <Skeleton />;
if (error)    return <ErrorCard message={error.message} onRetry={refetch} />;
if (!data.length) return <EmptyState action="发送第一条消息" />;
return <DataView data={data} />;
// Suspense + ErrorBoundary 是更结构化的替代方案
```

**Flutter**：
```dart
FutureBuilder(
  future: loadData(),
  builder: (_, snapshot) => switch (snapshot.connectionState) {
    ConnectionState.waiting => const Skeleton(),
    ConnectionState.done when snapshot.hasError =>
      ErrorCard(message: snapshot.error.toString(), onRetry: () => refetch()),
    ConnectionState.done when !snapshot.hasData =>
      const EmptyState(action: '发送第一条消息'),
    _ => DataView(data: snapshot.data!),
  },
)
```

**SwiftUI**：
```swift
// @State 枚举 + switch
enum LoadState { case loading, loaded([Item]), error(Error), empty }
// ...
switch state {
case .loading: ProgressView()
case .error(let e): ErrorView(error: e, retry: load)
case .empty: EmptyStateView(action: "发送第一条消息")
case .loaded(let items): DataView(data: items)
}
```

### 自查

- [ ] 每个从外部数据源读取的组件，至少处理了加载/空/错误三种状态
- [ ] 空状态是否引导了"下一步做什么"
- [ ] 错误状态是否提供了重试入口

---

## 模式 8 — 渐进式信息披露：不把所有选项堆在第一屏

### 问题与思路

界面控件线性增长，用户面对满屏按钮、滑块、输入框，不知道从哪开始。"功能暴露 = 可用性"是误区——暴露越多，理解越难。

**❌ 常见错误**：把所有配置项平铺在主界面。结果是新手被吓退，老手也找不到常用项在哪。

**核心思路**：按使用频率分层，不是按"功能是否重要"（所有功能都重要，但不是所有功能都需要在第一屏）。

- **始终可见**：高频操作（每次会话都用）+ 关键状态指标
- **按需展开**：低频配置 + 详细数据（默认折叠，有明确展开提示）
- **隐藏**：仅开发者/调试用途（URL 参数或开关开启）

**判断标准（可操作的，不是凭感觉）**：
- 控件在 80% 的会话中不被操作 → 放进折叠
- <50% 的用户需要看某信息 → 放进展开/详情

**❌ 折叠常见错误**：
- 折叠标题写"更多"或"高级"——用户不知道里面有什么。应该写"记忆设置"、"通知偏好"
- 折叠后内容太多（>10 个控件），打开后页面大幅跳动 → 折叠内容应控制在合理数量
- 折叠后忘了给展开提示（小箭头/加号图标），用户不知道可以点

### 实现速写

每个框架都有折叠组件（`Accordion`/`ExpansionPanel`/`Disclosure`/`Collapse`），API 大同小异。**关键不是怎么实现折叠，而是把什么放进折叠**——频率判断 > 视觉设计。

### 自查

- [ ] 主界面控件数是否在"初次用户不感到压迫"的水平（参考 7±2）
- [ ] 折叠区域标题是否传达了"里面有什么"（而非"更多"/"高级"）
- [ ] 折叠后展开的内容不会导致剧烈页面跳动

---

## 模式 9 — 反馈延迟：操作后多快必须有响应

### 问题与思路

用户点击按钮后没有即时反馈，页面"卡住"了 500ms 才开始加载动画。用户不确定点到了没有——于是再点一次，触发重复操作。

**这是 UX 领域最成熟的认知规律之一（Nielsen, 1993）**：

| 延迟 | 用户感知 | 需要的反馈 |
|------|---------|-----------|
| <100ms | 即时的 | 按钮变色、图标翻转、微小的视觉变化 |
| 100ms-1s | 注意到延迟但思维不中断 | skeleton、spinner 出现 |
| 1s-10s | 需要进度指示 | 进度条、剩余时间估计、步骤说明 |
| >10s | 可以去做别的事了 | 后台执行 + 完成通知（toast/推送） |

**❌ 常见错误**：开发者认为"异步操作完成后再展示结果"就够了。但用户在等待期间不知道自己点了没有——于是重复点击（触发重复请求），或者以为系统坏了离开（触发放弃）。

**核心思路**：操作响应分两步——**确认收到**（<100ms，即时）+ **展示结果**（异步完成时）。确认收到是最容易漏的环节。

**通用四步状态机**（跨所有平台）：
```
操作触发 → [1] 按钮立刻 disabled + loading icon
         → [2] 展示进度（有百分比更好，没有则 indeterminate）
         → [3a] 成功 → 按钮恢复 + toast (1-2s 自动消失)
         → [3b] 失败 → 按钮恢复 + 错误信息 + 重试入口
```

### 实现速写

这段状态机在任何框架中实现逻辑完全一致，只有 widget 不同：

**Web JS**：`button.disabled = true` + `button.innerHTML = spinner` → `fetch()` → `toast.success()` 或 `toast.error()`。React 19 的 `useActionState` 和 `useOptimistic` 提供了声明式 API。

**Flutter**：`ElevatedButton(onPressed: isLoading ? null : handler, child: isLoading ? CircularProgressIndicator() : Text('提交'))` + `ScaffoldMessenger.showSnackBar()`。

**SwiftUI**：`.disabled(isLoading)` + `ProgressView()` + `@State` 枚举驱动按钮样式。

### 自查

- [ ] 每个触发异步操作的按钮，点击后 <100ms 内给出视觉反馈
- [ ] 防止了等待期间的重复点击（disabled 或 debounce）
- [ ] 操作失败后有明确的重试路径

---

## 模式 10 — UI 打磨优先级分诊：P0-P3

### 问题与思路

UI 改进会膨胀——从一个按钮颜色发散到整个设计系统重构。没有优先级分层，P2 细节耗一天，P0 问题没人修。

**核心思路**：分级处理，不同级别不同节奏。

| 级 | 定义 | 判断标准 | 策略 |
|----|------|---------|------|
| **P0** | 功能阻断 | 用户无法完成操作（按钮不可点、文字不可见、内容被遮挡） | 立刻单独修 |
| **P1** | 视觉不一致 | 能完成但有断点（间距不统一、对齐偏移、颜色不协调） | 批量修，一个 PR |
| **P2** | 打磨增强 | 能用一致但不精致（动画不流畅、hover 缺效果、阴影层次差） | 排期，攒够一批 |
| **P3** | 主观偏好 | "我觉得更好看"，无客观标准 | 除非用户提否则不动 |

**纪律**：**一个 commit 只做一个级别**。P1 的间距统一和 P2 的动画重写混在一起 → 回滚成本翻倍 → 大概率俩都通不过。

**这套语言的价值**：团队讨论时说"这是 P1 对齐问题"比"这里看着不太对"精确得多。排优先级时不需要吵——先对标 P 级定义。

### 自查

- [ ] 当前 UI 改进任务明确了 P 级别
- [ ] 上一个 UI commit 只做了一个 P 级别的事
- [ ] P3 级别的改动已停止自己做主

---

## 快速审计清单

以下不依赖任何技术栈。每次 UI 改动后 5 分钟走一遍：

- [ ] **双主题**：亮/暗各一遍，受影响组件肉眼确认
- [ ] **多尺寸**：窄(320px) / 中(768px) / 宽(1440px)各一遍，无溢出或断裂
- [ ] **叠放**：fixed/sticky/floating 遮挡关系正确——footer 不挡正文、tooltip 在最上面
- [ ] **状态**：空/加载/错误态都展示过，不是只看过正常态
- [ ] **反馈**：每个异步按钮点击后立即有视觉响应
- [ ] **联动**：改共享值后搜索确认旧值无残留
- [ ] **对比度**：有色背景上的文字双主题下都能看清
- [ ] **优先级**：本次改动属于 P0/P1/P2/P3 哪一级，投入时间是否匹配

---

## 附录：框架能力速查

| 你要做什么 | Web CSS 原生 | React 生态 | Flutter | SwiftUI |
|-----------|-------------|-----------|---------|---------|
| 深度叠放 | `z-index` + CSS 变量常量 | 同左，或用 portal | `elevation` / `Stack` | `zIndex` |
| 浮层边界检测 | 手写 CSS 或 Floating UI | Floating UI / Radix / MUI | `Tooltip` widget 自动 | `popover` 自动 |
| 布局尺寸联动 | CSS custom properties | Context / zustand | `ValueNotifier` | `@State` + `@Binding` |
| 固定区域协同 | Grid / flexbox **优于** fixed | 同左 | `Scaffold` 自动 | `NavigationSplitView` |
| 框架样式覆盖 | 主题变量 > 特异性 > `!important` | 组件库 theme prop | `ThemeData` | `@Environment` |
| 动态背景对比度 | `--text-on-brand` token + `!important` | 同左，或 CSS-in-JS theme | 显式声明 `Color`，无级联 | `.foregroundColor(.white)` |
| 状态全覆盖 | —（不管逻辑） | 早期 return / Suspense | `FutureBuilder` | `switch` + `@State` |
| 渐进披露 | `details`/`summary` 或 JS | Accordion / Disclosure | `ExpansionTile` | `DisclosureGroup` |
| 反馈延迟 | CSS transition + JS 状态机 | `useTransition` / loading state | `CircularProgressIndicator` | `ProgressView` |

---

### 2026-06-19 — 筛选工具栏：bordered container 视觉分组

**问题**：多个筛选控件（下拉框、输入框、按钮）水平排列时，天然呈现为"散落的一堆独立组件"而非"一个工具栏"。用户需要视觉线索来理解"这些控件属于同一功能组"。

**解法**：用带边框的容器包裹所有筛选控件。边框提供 Gestalt 闭合——大脑自动将边框内的元素归类为同一组。

**各框架实现**：
- **CSS/Web**：`border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--surface)` — 一个 div 搞定
- **Streamlit**：`st.container(border=True)` — 1.35+ 内置支持
- **React**：`<fieldset>` 或 `<Card>` 或 `<Box border={1} borderRadius={2}>`
- **Flutter**：`Container(decoration: BoxDecoration(border: Border.all(...), borderRadius: ...))`

**适用场景**：2-6 个筛选项的过滤栏。控件超过 6 个考虑分组或折叠。

### 2026-06-19 — Segmented Control：≤5 选项时替代 Dropdown

**问题**：Dropdown（下拉框）隐藏选项——用户必须先点击才能看到有哪些选择。当选項数 ≤5 且选项稳定时，这种隐藏是纯粹的认知负担。

**解法**：Segmented Control（分段控制器/药丸选择器）将所有选项平铺展示，当前选中项高亮。用户一眼看到全部可用选项，无需额外点击。

**何时用**：
- 选项数 2-5 个 ✅ — 再多会溢出或换行
- 选项标签简短（≤4 字） ✅ — 长标签用 dropdown
- 所有选项同等重要 ✅ — 有主次之分用 tabs

**何时不用**：
- 选项数 >5 ❌ — 用 dropdown 或 searchable select
- 选项动态变化 ❌ — segmented control 的固定宽度不支持动态新增
- 空间极度受限 ❌ — 平铺展示比 dropdown 更占空间

**各框架实现**：
- **Streamlit**：`st.segmented_control("label", ["A","B","C"], default="A")` — 1.43+
- **CSS/Web**：Radio group styled as pills — `input[type=radio]:checked + label { background: brand; }`
- **React**：Mantine `SegmentedControl`, Radix `ToggleGroup`, Ant Design `Segmented`
- **Flutter**：`CupertinoSegmentedControl` 或 `SegmentedButton`
- **SwiftUI**：`Picker("", selection: $sel) { ... }.pickerStyle(.segmented)`

### 2026-06-19 — 紧贴式清除按钮：搜索框的 inline clear

**问题**：搜索框右侧的清除按钮放在独立列/容器中时，与输入框之间出现间隙、高度不一致，视觉上"断开"。

**解法**：清除按钮与输入框放在同一父容器内，按钮紧贴输入框右侧。按钮使用 `tertiary`/`ghost`/`text` 样式弱化视觉权重，只保留功能存在感。

**CSS**：
```css
.search-group { display: flex; align-items: stretch; }
.search-group input { flex: 1; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.search-group .clear-btn { border-top-left-radius: 0; border-bottom-left-radius: 0; }
```

**Streamlit**：同一 `st.columns([10, 0.8])` 内放置 text_input + button(type="tertiary")，两控件共享父列 caption，button 不加独立 spacer。

---

### 2026-06-20 — CSS-only hover tooltip：零 JS 的行内术语提示

**问题**：正文中有术语需要解释，但点击跳转到术语表会打断阅读流。用 JS tooltip 库（如 Tippy.js）需要额外依赖和初始化代码。

**解法**：纯 CSS `::after` 伪元素实现 hover 弹出定义。触发元素用虚线下划线标记（区别于链接的实线），hover 时 `::after` 从 `display: none` 变为 `display: block`，展示术语定义。

**适用条件**：
- 术语定义简短（≤2 行） ✅ — 超过用侧边栏或 drawer 更合适
- 术语数 ≤30 个 ✅ — 每个术语需要一条 CSS 规则，过多会膨胀
- 不需要富文本（纯文本定义） ✅ — `::after` content 只能放纯文本
- 需要交互（点击、链接） ❌ — 用 JS tooltip 或 popover

**CSS**：
```css
.gm-glossary-tooltip {
  border-bottom: 1px dashed var(--text-muted);
  cursor: help;
  position: relative;
}
.gm-glossary-tooltip::after {
  content: attr(data-tip);
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-inverse);
  color: var(--text-on-inverse);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 0.8rem;
  white-space: nowrap;
  max-width: 280px;
  z-index: var(--z-notify);
}
.gm-glossary-tooltip:hover::after { display: block; }
```

**各框架实现**：
- **CSS/Web**：上述 `::after` + `data-tip` 属性。降级方案：未知 key 显示"定义待补充"而非空白
- **Streamlit**：`st.html(f'<span class="gm-glossary-tooltip" data-tip="{定义}">{术语}</span>')` — 纯 HTML 注入，不走 Streamlit widget
- **React**：同样可用 CSS `::after`，或 `<Tooltip>` 组件（Mantine/Radix/MUI），后者支持富文本和交互
- **Flutter**：`Tooltip(message: '定义', child: Text('术语', style: dashedUnderline))`

**自查**：
- [ ] 所有术语 tooltip 在 viewport 边缘处不溢出（`::after` 左/右锚定）
- [ ] 未知 key 有降级显示而非空白 tooltip
- [ ] 定义文本长度 ≤2 行，超过考虑改用侧边栏展开

### 2026-06-20 — 纯 HTML 指标条：高性能摘要卡片替代 Streamlit widget

**问题**：Streamlit 的 `st.metric()` 每列至少 1 个 widget，4 列指标条 = 4 个 st.metric → 4 次 Python→JS 往返。在聊天页这种高频重渲染场景中，widget 开销不可忽视。

**解法**：用 `st.html()` 一次性注入完整 HTML 指标条——4 个指标列在单个 HTML 字符串中渲染，1 次 Python→JS 往返。每个指标包含颜色编码的圆点 + 标签 + 数值 + 迷你描述。空状态安全（数据缺失时显示 "—" 而非报错）。

**何时用**：
- 指标数固定（≤6 个）且不需要交互 ✅ — 纯展示类
- 高频重渲染页面（聊天、实时 dashboard） ✅ — 减少 widget 开销
- 需要自定义布局 widget 不支持 ✅ — 如不等宽列、渐变背景、圆角分组
- 需要交互（点击展开、hover tooltip） ❌ — 必须用 widget 或 JS

**Streamlit 实现速写**：
```python
def render_metric_strip(metrics: list[dict]) -> None:
    """4 列指标条 — 1 次 st.html() 替代 4 次 st.metric()."""
    cells = []
    for m in metrics:
        value = m.get("value", "—")  # 空状态安全
        cells.append(f"""
        <div class="gm-metric-cell">
          <span class="gm-metric-dot" style="background:{m['color']}"></span>
          <span class="gm-metric-label">{m['label']}</span>
          <span class="gm-metric-value">{value}</span>
          <span class="gm-metric-hint">{m.get('hint', '')}</span>
        </div>
        """)
    st.html(f'<div class="gm-metric-strip">{"".join(cells)}</div>')
```

**CSS**：
```css
.gm-metric-strip {
  display: flex; gap: 1px;  /* 1px 分隔线 */
  background: var(--border);
  border-radius: 10px; overflow: hidden;
}
.gm-metric-cell {
  flex: 1; background: var(--surface);
  padding: 10px 14px; text-align: center;
}
.gm-metric-value { font-size: 1.3rem; font-weight: 700; }
```

**React**：`<dl>` 语义标签 + CSS Grid，纯 HTML 无 JS 交互。

**自查**：
- [ ] 所有指标值有空状态降级（"—" 而非空白/报错）
- [ ] 指标数 ≤6，超过考虑折叠或分页
- [ ] 颜色编码有语义（绿=好/蓝=信息/琥珀=警告），不是纯装饰

### 2026-06-20 — FIFO 快照历史：内存列表 + 反向迷你卡片

**问题**：用户想回顾之前的操作历史（如"刚才那次搜索召回了多少条"），但数据库查询需要 SQL 往返、解析开销大。对"最近的 N 条"这种高频访问、只有插入和读取的场景，数据库不是最优解。

**解法**：内存列表 + FIFO 上限（50 条）。每完成一个操作在管线末端轻量快照（只存摘要字段，不存完整数据）。展示时反向排列（最新在前），每条显示问题摘要 + 关键指标行 + 状态标记。

**适用条件**：
- 只读历史，不需要编辑/删除 ✅
- 上限明确（<100 条） ✅ — 内存安全
- 会话内数据，不需要跨会话持久化 ✅ — 页面刷新清空是可接受的
- 需要跨会话持久化 ❌ — 必须用数据库或 localStorage

**通用状态机**：
```
操作完成 → take_snapshot(摘要字段)
         → 追加到内存列表
         → if len > MAX: pop(0)  # FIFO
展示 → 反向遍历 → 生成迷你卡片
```

**Streamlit 实现速写**：
```python
MAX_SNAPSHOTS = 50

def take_journey_snapshot(prompt: str, metrics: dict) -> None:
    snap = {"prompt": prompt[:80], "time": datetime.now().isoformat(), **metrics}
    st.session_state.setdefault("snapshots", []).append(snap)
    if len(st.session_state["snapshots"]) > MAX_SNAPSHOTS:
        st.session_state["snapshots"].pop(0)

def render_history() -> None:
    snaps = st.session_state.get("snapshots", [])
    if not snaps:
        return st.caption("暂无历史记录")
    with st.expander(f"会话历史 ({len(snaps)})"):
        for s in reversed(snaps):  # 最新在前
            st.html(f"""<div class="gm-mini-journey">
              <strong>{s['prompt']}</strong>
              <span>召回 {s['recall']} · 上下文 {s['ctx_usage']}% · Token {s['tokens']}</span>
            </div>""")

def reset_history() -> None:
    st.session_state["snapshots"] = []
```

**React**：
```jsx
const [snapshots, setSnapshots] = useState([]);
const takeSnapshot = (s) => setSnapshots(prev =>
  [...prev, s].slice(-MAX_SNAPSHOTS)  // slice 替代 pop(0), O(n) 但 n≤50 可忽略
);
```

**自查**：
- [ ] FIFO 上限明确且低于 100
- [ ] 空状态有"暂无历史"提示而非空白
- [ ] 快照字段够轻量（摘要级别，不存完整数据）

---

> 最后更新：2026-06-25 (Phase 32 Batch 1 — 7 组件文档追加)

---

## CollapsibleSection — 统一折叠展开组件

**场景**：8 个组件各自实现了 collapse/expand 逻辑，存在三种模式（`<details>`、`useState`+button、CSS max-height 动画）。

**方案**：提取为 `CollapsibleSection` 共享组件，支持三种视觉变体、受控/非受控双模式、A11 完备。

**变体选择指南**：

| 场景 | variant | 说明 |
|------|---------|------|
| 侧边栏轻量折叠 | `ghost` | 无容器边框，header hover 背景 |
| 内容区域分组 | `bordered` | border + 分隔线，适合信息密度中等的区域 |
| 强调型卡片段落 | `card` | border + shadow + bg，适合独立内容块（如 ProcessDrawer Section） |

**关键 API**：
- `rightAccessory` — header 右侧操作按钮（复制、badge 等），点击不触发折叠
- `animated` — CSS max-height 过渡动画（替代瞬时显示/隐藏）
- `headerClassName` / `contentClassName` — 消费者可注入自有 CSS 类（如 AnswerCard L2/L3 颜色）

**A11**：
- toggle button 设置 `aria-expanded`
- 折叠箭头设置 `aria-hidden="true"`
- 内容始终在 DOM 中（`hidden` 属性控制），保证测试可查询

**文件**：`frontend/src/components/ui/CollapsibleSection.tsx`

---

## Drawer — 通用抽屉外壳

**场景**：3 个 Drawer（ProcessDrawer/ProjectMapDrawer/TagDetailDrawer）各自实现了相同的动画状态机和 backdrop 渲染，仅时长不一致（600/500/420ms）。

**方案**：提取为 `Drawer` 共享外壳组件，统一动画状态机（entering→open→exiting + double rAF）+ backdrop + panel shell + body scroll lock。

**变体选择指南**：

| 场景 | width token | 说明 |
|------|------------|------|
| 流程详情（ProcessDrawer） | `max-w-[520px]` | 展示 API 调用完整档案 |
| 项目地图（ProjectMapDrawer） | `max-w-[480px]` | 全屏模式 + TOC |
| 标签溯源（TagDetailDrawer） | `max-w-[480px]` | 事实/对话/置信度日志 |

**关键 API**：
- `isOpen` / `onClose` — 父组件控制开闭，子组件零动画代码
- `width` — 内置 480/520 两种宽度 + 自定义 `className`
- `title` / `description` — header 区自动渲染
- body scroll lock — 引用计数锁 `<html>`+`<body>` overflow + 滚动条宽度补偿

**A11**：
- Escape 键关闭（`onKeyDown` 守卫）
- `aria-hidden` 在关闭时设置
- focus trap（开时自动聚焦 close button）

**文件**：`frontend/src/components/ui/Drawer.tsx`

---

## ErrorDisplay — 统一报错组件

**场景**：~20 处报错点各自为政——英文技术串直出、`<details>` 暴露原始代码、无错误分类/无重试按钮。

**方案**：提取 `ErrorDisplay` + `categorizeError` 工具，统一 5 分类（network/server/llm/render/unknown）全中文 userMessage + 3 variant（card/inline/fullscreen）+ 重试按钮。

**变体选择指南**：

| 场景 | variant | 说明 |
|------|---------|------|
| 卡片内报错（ChatPanel/lab panel） | `card` | 带边框卡片，含重试按钮 |
| 行内提示（Sidebar 衰减/重置） | `inline` | 紧凑文本 + 重试链接 |
| 全页错误（Next.js Error Boundary） | `fullscreen` | 居中大卡片，无重试（需刷新） |

**关键 API**：
- 接受 `Error | string | null` — 自动分类，无需调用方手动 categorize
- `onRetry` — 可选重试回调，仅在提供时显示重试按钮
- `className` — 消费者可注入额外样式

**文件**：`frontend/src/components/ui/ErrorDisplay.tsx` + `frontend/src/lib/errorCategories.ts`

---

## KVRow — Key-Value 行组件

**场景**：ProcessDrawer 和 ModelInferencePanel 各自实现了相同的 key-value 行布局（左标签右值），仅 error 样式略有差异。

**方案**：提取为 `KVRow` 共享组件，支持 left label + right value + error 高亮 + className/data-testid。

**关键 API**：
- `label` — 左侧标签文本
- `value` — 右侧值文本（`ReactNode`，支持 JSX）
- `error` — 可选 error 标记，触发红色高亮
- `className` / `data-testid` — 测试友好

**文件**：`frontend/src/components/ui/KVRow.tsx`

---

## DataState — 三态统一包装

**场景**：16 个 lab panel 各自复制 loading/empty/error 三态 if-else 渲染结构，每个文件 ~20 行重复 JSX。

**方案**：提取 `DataState` 包装组件，统一 loading（spinner + 文本）/ empty（图标 + 消息）/ error（ErrorDisplay card）三态渲染。

**关键 API**：
- `state: "loading" | "empty" | "error"` — 驱动三态
- `loadingMessage` / `emptyMessage` — 自定义消息
- `emptyIcon` — 可选空态图标
- `error` / `onRetry` — error 态透传 ErrorDisplay
- `children` — success 态直接渲染 children

**文件**：`frontend/src/components/ui/DataState.tsx`

---

## CopyButton — 复制到剪贴板

**场景**：ModelInferencePanel 和 GhostPromptView 各自实现了相同的"复制"按钮（clipboard API + 2s "已复制"反馈）。

**方案**：提取为 `CopyButton` 共享组件。

**关键 API**：
- `text` — 要复制的文本
- `size: "sm" | "xs"` — 按钮尺寸
- `className` — 消费者样式注入
- 自动 2s "已复制"→"复制" 文本回切 + `RiFileCopyLine` / `RiCheckLine` 图标切换

**文件**：`frontend/src/components/ui/CopyButton.tsx`

---

## RefreshButton — 刷新按钮

**场景**：12 处组件各自实现了相同的刷新按钮（`RiRefreshLine` + `onClick` + loading spin）。

**方案**：提取为 `RefreshButton` 共享组件，支持 ghost/bordered 双 variant。

**变体选择指南**：

| 场景 | variant | 说明 |
|------|---------|------|
| 浏览器/查看器头部 | `ghost` | 透明背景，hover 显示 |
| Lab panel 卡片内 | `bordered` | 带边框 pill 样式 |

**关键 API**：
- `onClick` — 刷新回调
- `loading` — 是否加载中（触发 spin 动画 + disabled）
- `variant: "ghost" | "bordered"`
- `ariaLabel` — 无障碍标签
- `className` — 消费者样式注入

**文件**：`frontend/src/components/ui/RefreshButton.tsx`

---

## TabBar — 统一 Tab 导航栏

**场景**：3 个组件（LabShell/ObserveShell/MemoryBrowserPanel）各自实现了相同的 `border-b` + `aria-selected` + `text-brand` 标签栏。

**方案**：提取为 `TabBar` 受控组件，支持 brand/info activeColor + sm/xs size + icon 支持 + ARIA tablist/tab/aria-selected。

**关键 API**：
- `tabs: { key, label, icon? }[]` — tab 定义
- `activeKey` / `onChange` — 受控模式
- `activeColor: "brand" | "info"` — 激活态颜色
- `size: "sm" | "xs"` — 尺寸
- `ariaLabel` — 无障碍标签（`<nav>` 的 aria-label）

**文件**：`frontend/src/components/ui/TabBar.tsx`

---

---

## Typography-First Blockquote 变体 — 粗体标签双用途模式

**场景**：文档类页面中 blockquote 需要区分语义（洞察/警告/总结/笔记/配置/防护），传统做法是用 emoji 前缀（💡⚠️🏆📝⚙️🛡️）做视觉标记 + CSS variant 选择器。但 emoji 在正文中产生"AI 写的"气味，读者反馈不自然。

**① 问题与思路**

Blockquote 的语义区分需要两层信号：对读者的视觉扫读标记 + 对渲染管线的 CSS variant 选择器。Emoji 同时服务这两层但引入了装饰噪音。替代方案：用 **markdown 粗体标签**（`> **关键洞察**：text`）——粗体文字对读者是自然的扫读锚点，`<strong>` DOM 节点对渲染管线是可匹配的 variant 选择器。一个语法服务两层，排版三要素（字重/颜色/间距）完成全部信息架构工作。

**② 实现速写**

```typescript
// ── 1. 粗体标签 → CSS variant 映射 ──
// 在 renderMarkdown() 的 blockquote 处理阶段（bold → <strong> 已转换完成后）：
const BQ_LABEL: Record<string, string> = {
  "关键洞察": "insight",
  "防护": "guard",
  "注意": "warning",
  "配置": "config",
  "笔记": "note",
  "总结": "summary",
};

// ── 2. 在 blockquote 替换回调中匹配 ──
const firstContent = lines[0].replace(/^&gt; /, "");
const labelMatch = firstContent.match(/^<strong>(.+?)<\/strong>[:：]?\s*/);
if (labelMatch && BQ_LABEL[labelMatch[1]]) {
  variant = ` answer-bq--${BQ_LABEL[labelMatch[1]]}`;
}
// 粗体标签保留在输出中 → 读者看到粗体"关键洞察"作为扫读锚点
// variant class 添加到 <blockquote> → CSS 左边框颜色承载语义
```

```css
/* ── 3. CSS：左边框颜色是主要语义信号 ── */
.answer-bq {
  border-left: 3px solid var(--gm-border);
  padding: var(--gm-space-2) var(--gm-space-4);
  background: var(--gm-bg-subtle);
  /* 字号/间距/圆角由排版体系统一管理 */
}
.answer-bq--insight  { border-left-color: var(--gm-brand); }
.answer-bq--guard    { border-left-color: var(--gm-info); }
.answer-bq--warning  { border-left-color: var(--gm-warning); }
.answer-bq--summary  { border-left-color: var(--gm-success); }
/* config/note 用 muted/secondary 色 —— 视觉层级低于 insight/warning */
```

```markdown
<!-- ── 4. 内容作者视角：写法自然 ── -->
> **关键洞察**：GlassCortex 将对话意图分为 5 类...
> **注意**：解析时对 confidence 做 clamp...
> **总结**：没有银弹，只有取舍。
> 普通引用 —— 无标签前缀，默认样式。
```

**关键约束**：
- 粗体标签必须是 blockquote 的第一个元素（`^<strong>...` 匹配），否则不触发 variant
- 冒号（中英文）可选 —— `**关键洞察**：` 和 `**关键洞察**` 都匹配
- 无标签前缀的 blockquote 渲染为默认样式，不报错不降级
- 标签文本就是 variant key —— 不需要额外维护 emoji→label 的翻译层

**适用边界**：文档/博客/知识库等文本密集型页面。不适用于消息气泡/聊天界面（blockquote 变体在聊天场景中通常不需要语义分类）。

**文件**：`frontend/src/components/learn/AnswerCard.tsx` (renderMarkdown + BQ_LABEL), `frontend/src/app/globals.css` (.answer-bq--*)

---

---

## 独立双滚动面板 — CSS Grid 固定高度 + 高度链向下传递

**场景**：左右两栏布局（侧边栏 + 主内容）共用页面滚动条——长答案读到一半左侧导航滚出屏幕。需要左右两栏各自独立滚动。

**① 问题与思路**

传统布局用 `min-h-screen`（`min-height: 100vh`）给页面设地板——内容短时填满视口，内容长时页面随内容变高。问题在于：没有天花板，`overflow-y: auto` 不生效——子元素高度无限增长，永远不会溢出。

正确做法：给容器固定高度（`h-dvh` = `height: 100dvh`），让 `1fr` 行和子元素都得到确定 px 值，在子元素上设 `overflow-y: auto`。**关键容易被忽略的一步**：CSS Grid 子元素默认 `min-height: auto`——即使 grid 行有固定高度，子元素也可以撑破它。必须加 `min-height: 0` 让 grid 的约束真正生效。

**② 实现速写**

```tsx
// ── 1. Grid 容器：固定高度 + 溢出截断 ──
<div className="grid h-dvh overflow-hidden
                grid-cols-1 lg:grid-cols-[auto_1fr]
                grid-rows-[auto_1fr_auto]">
  <Header />                              {/* row 1: auto */}

  {/* ── 2. 侧边栏容器：填满行 + 允许约束 ── */}
  <div className="hidden lg:block h-full min-h-0 row-start-2 col-start-1">
    {/* 3. 侧边栏内容：h-full → flex-col → 内部滚动 */}
    <aside className="flex flex-col h-full overflow-y-auto">
      <div class="shrink-0">固定头部</div>
      <div class="flex-1 overflow-y-auto">可滚动内容</div>
    </aside>
  </div>

  {/* ── 4. 主内容：填满行 + 允许约束 + 内部滚动 ── */}
  <main className="overflow-y-auto min-h-0 col-start-1 lg:col-start-2">
    {children}
  </main>

  <Footer />                              {/* row 3: auto */}
</div>
```

```css
/* ── 5. 高度链中间环：CSS 补充 ── */
.sidebar-panel {
  width: 280px;
  height: 100%;       /* ← 关键：把 grid 固定高度向下传递 */
  overflow: hidden;   /* 动画折叠需要，滚动由内部元素处理 */
}
```

**四层固定**：
1. **Grid 层**：`h-dvh overflow-hidden` — 视口天花板
2. **高度链层**：grid cell → sidebar container (`h-full`) → sidebar panel (`height: 100%`) → sidebar aside (`h-full`) — 每一步 `h-full`/`height: 100%` 把固定高度向下传
3. **约束层**：`min-h-0` 覆盖 CSS Grid 默认 `min-height: auto` — 让 grid 子元素接受被约束
4. **滚动层**：`overflow-y: auto` — 内容超出时创建内部滚动条

**关键约束**：
- `overflow: hidden` 在 **grid 容器**上（阻断 body 滚动），不在 sidebar/main 容器上（它们要内部滚动）
- `min-h-0` 必须加在所有 `1fr` grid 行的子元素上——漏一个就有一条路径能撑破 grid
- `h-dvh` vs `h-screen`：`dvh` 排除移动地址栏，更准确。Tailwind 不支持时用 `h-[100dvh]`
- Footer 如果也在 grid 内，放在独立 `auto` 行（不在 `1fr` 行内）

**适用边界**：所有左右/上下分栏布局的应用壳（App Shell）。不适用于文档/博客类随内容自然滚动的页面。

**文件**：`AppShell.tsx` (grid + sidebar container), `Sidebar.tsx` (chat sidebar aside), `globals.css` (.sidebar-panel)

---

> 最后更新：2026-06-27 (B3 文档交叉引用补齐；Phase 37: ProcessDrawer DAG 图 + ChatMessage ContextualLens 模式属项目特定实现，不放此处)
> 维护规则：发现新的跨框架通用模式 → 追加。仅在本项目技术栈（Python/Streamlit/CSS）内有效的经验 → 放 `pitfalls.md`，不放大这里。
