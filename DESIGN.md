# DESIGN.md — 电池守护 (Battery Guard)

> Windows 桌面电池守护工具的设计规范
> 风格混搭：Linear（深色表面与边框精度）× Raycast（效率工具质感）× Apple（排版与语义色）

---

## 1. Visual Theme & Atmosphere

**设计哲学**：系统级工具的克制感。界面不该抢戏，用户一瞥就要看懂"电量多少、是否在充、电池是否健康"。所有装饰服务于信息密度与可读性。

**视觉基调**：深色沉浸、低饱和表面、语义色点亮状态、精密边框。

**核心特征关键词**：
- Precision（精密）：1px 分隔、克制圆角、对齐严格
- Calm（克制）：低饱和背景，仅状态色饱和
- Legible（清晰）：数字用等宽表格数字，层级靠字重与色彩而非线条
- Native（原生）：贴合 Windows 11 深色观感，不引入 Web 化的浮夸阴影
- Instrument-like（仪表感）：主视觉是一块仪表盘，而非普通卡片堆叠

**光影与质感**：纯扁平 + 极浅内描边（inset highlight 1px rgba(255,255,255,0.04)），禁用大面积投影。仅浮层（toast）使用单层投影。

---

## 2. Color Palette & Roles

### Primary / Brand
| 角色 | HEX | CSS 变量 | 场景 |
|---|---|---|---|
| Accent | `#5E6AD2` | `--color-accent` | 滑块、开关开启、聚焦环、链接 |
| Accent Hover | `#6E79DB` | `--color-accent-hover` | 交互悬停 |
| Accent Subtle | `rgba(94,106,210,0.14)` | `--color-accent-subtle` | 选中态底色 |

### Surface & Borders（Linear 式分层）
| 角色 | HEX | CSS 变量 | 场景 |
|---|---|---|---|
| Background | `#0B0C0E` | `--color-bg` | 应用底层背景 |
| Surface | `#131418` | `--color-surface` | 卡片、面板 |
| Surface Elevated | `#1A1C21` | `--color-surface-elevated` | 统计块、输入框、悬停态 |
| Border | `rgba(255,255,255,0.07)` | `--color-border` | 卡片描边、分隔线 |
| Border Strong | `rgba(255,255,255,0.12)` | `--color-border-strong` | 悬停、聚焦边框 |

### Text
| 角色 | HEX | CSS 变量 | 场景 |
|---|---|---|---|
| Text Primary | `#EDEEF0` | `--color-text` | 标题、关键数值 |
| Text Secondary | `#9CA0AA` | `--color-text-secondary` | 正文、说明 |
| Text Tertiary | `#6B6F79` | `--color-text-tertiary` | 标签、时间戳 |

### Semantic（Apple 系统色）
| 角色 | HEX | CSS 变量 | 场景 |
|---|---|---|---|
| Success / 健康 | `#30D158` | `--color-success` | 电量 ≥50%、健康度良好 |
| Info / 充电 | `#0A84FF` | `--color-info` | 充电中状态 |
| Warning | `#FF9F0A` | `--color-warning` | 电量 20–49%、提示条 |
| Danger | `#FF453A` | `--color-danger` | 电量 <20%、严重告警 |

### Shadow
| 层级 | 值 | CSS 变量 |
|---|---|---|
| shadow-sm | `0 1px 2px rgba(0,0,0,0.30)` | `--shadow-sm` |
| shadow-md | `0 4px 12px rgba(0,0,0,0.35)` | `--shadow-md` |
| shadow-lg | `0 12px 32px rgba(0,0,0,0.45)` | `--shadow-lg` |
| Inner Highlight | `inset 0 1px 0 rgba(255,255,255,0.04)` | `--inner-highlight` |

---

## 3. Typography Rules

**Font Family**
```css
--font-sans: 'Inter', 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
--font-num: 'Inter', 'Segoe UI', system-ui, sans-serif; /* tabular-nums */
```

**Type Scale**

| 级别 | Size | Weight | Line Height | Letter Spacing | 用途 |
|---|---|---|---|---|---|
| Display | 44px | 500 | 1 | -0.02em | 电量主数字 |
| H1 | 20px | 600 | 1.3 | -0.01em | 应用标题 |
| H2 | 13px | 600 | 1.4 | 0.02em | 卡片分区标题（全大写） |
| Body | 13px | 400 | 1.6 | 0 | 正文、设置项 |
| Body Small | 12px | 400 | 1.5 | 0 | 说明文字 |
| Label | 11px | 500 | 1.4 | 0.04em | 统计项标签（全大写） |
| Metric | 20px | 500 | 1.2 | -0.01em | 统计数值 |
| Caption | 11px | 400 | 1.4 | 0 | 单位、脚注 |

**设计哲学**：数字一律 `font-variant-numeric: tabular-nums`，避免电量跳变时宽度抖动。层级主要靠字重（400/500/600 三级）与色彩明度区分，不靠加大字号。

---

## 4. Component Stylings

### Buttons
```css
/* Primary */
background: var(--color-accent); color: #FFFFFF;
border: none; border-radius: 8px; padding: 8px 16px;
font-size: 13px; font-weight: 500;
transition: background 120ms ease, transform 120ms ease;
hover: background #6E79DB; active: transform scale(0.98);

/* Secondary */
background: var(--color-surface-elevated);
color: var(--color-text);
border: 1px solid var(--color-border);
border-radius: 8px; padding: 8px 16px;
hover: background #22242A; border-color: var(--color-border-strong);

/* Ghost */
background: transparent; color: var(--color-text-secondary);
border-radius: 8px; padding: 8px 12px;
hover: background rgba(255,255,255,0.05); color: var(--color-text);
```

### Cards
```css
background: var(--color-surface);
border: 1px solid var(--color-border);
border-radius: 14px;
padding: 16px;              /* 单屏约束下的压缩值 */
box-shadow: var(--inner-highlight);
display: flex;
flex-direction: column;     /* 配合 flex:1 撑满可用高度 */
min-height: 0;
```

### Stat Block（统计块）
```css
background: var(--color-surface-elevated);
border: 1px solid var(--color-border);
border-radius: 10px;
padding: 12px 14px;
/* 标签 11px/500 uppercase text-tertiary；数值 20px/500 tabular-nums */
```

### Inputs / Slider
```css
/* Range */
track: height 4px; background rgba(255,255,255,0.10); border-radius: 999px;
thumb: 14px circle; background #FFFFFF; border 3px solid var(--color-accent);
box-shadow 0 1px 3px rgba(0,0,0,0.4);
focus: thumb 外圈 6px var(--color-accent-subtle);

/* Select */
background: var(--color-surface-elevated);
border: 1px solid var(--color-border);
border-radius: 8px; padding: 6px 10px; font-size: 12px;
```

### Switch
```css
off: background rgba(255,255,255,0.14); width 36px; height 21px; radius 999px;
on:  background var(--color-accent);
knob: 15px circle #FFFFFF; offset 3px; translateX 15px; transition transform 140ms ease;
```

### Badge / Status Pill
```css
background: var(--color-surface-elevated);
border: 1px solid var(--color-border);
border-radius: 999px; padding: 5px 12px; font-size: 12px;
/* 状态点 7px 圆点，颜色取语义色 */
```

### Gauge（电量仪表）
```css
/* 外圈轨道 stroke rgba(255,255,255,0.07) width 12；
   进度 stroke 语义色 width 12 linecap round，末端加 8% 透明度光晕 */
中心数字 44px/500；下方状态标签 12px text-secondary
```

### Toast
```css
background: var(--color-surface-elevated);
border: 1px solid var(--color-border);
border-left: 3px solid var(--color-warning);
border-radius: 12px; padding: 12px 16px;
box-shadow: var(--shadow-lg);
animation: slide-in 180ms cubic-bezier(0.16,1,0.3,1);
```

---

## 5. Layout Principles

- **Spacing System**：基准 4px，使用 4 / 8 / 9 / 12 / 14 / 16 / 20 / 24
- **Grid（单屏约束）**：主区三列 `236px + minmax(0,1fr) + 300px`，gap 14px
  - 列 1 仪表 / 列 2 状态 + 统计（纵向 2 张卡）/ 列 3 阈值设置
- **Container**：`padding: 20px 24px 16px`，`display: flex; flex-direction: column; gap: 14px`
  - 外层 `overflow: hidden`，`.layout { flex: 1; min-height: 0 }` —— 内容区吃掉剩余高度，不产生滚动
- **Section Spacing**：卡片之间 14px，卡片内标题与内容 12px，卡片 padding 16px
- **设置项压缩策略**：6 个开关改两列网格（3 行 × 2 列），行 padding `7px 0`，说明文字单行省略号截断
- **提示条外置**：长说明不放在卡片内，改为底部横跨全宽的 footnote（高约 36px）
- **留白哲学**：靠留白分组而非分割线。仅设置项行间使用 1px border 分隔，最后一行去掉。
- **单屏目标尺寸**：窗口 1000 × 630（客户区 986 × 594），内容实测高度 594 = 视口高度，无溢出

---

## 6. Depth & Elevation

| 层级 | 用途 | 表现 |
|---|---|---|
| L0 Background | 应用底 | `#0B0C0E` |
| L1 Surface | 卡片 | `#131418` + 1px border |
| L2 Elevated | 统计块、控件 | `#1A1C21` |
| L3 Overlay | Toast | `#1A1C21` + shadow-lg |

**Z-index**：base 0 / sticky header 10 / toast 100
**Backdrop**：不使用毛玻璃（桌面应用保持锐利可读）

---

## 7. Do's and Don'ts

**Do's**
1. 数字一律 tabular-nums，防止跳动
2. 状态只用语义色表达，同一状态全应用颜色一致
3. 卡片圆角统一 14px，内部块 10px，控件 8px
4. 交互反馈 120–180ms，无一例外
5. 说明文字用 tertiary 色，不与正文抢注意力
6. 深色背景保持低饱和，饱和度留给状态色
7. 每行设置项保持 52px 左右高度，视觉节奏一致

**Don'ts**
1. 不要大面积投影，会显得 Web 化、远离原生感
2. 不要超过三级字重（400/500/600）
3. 不要用渐变填充卡片背景
4. 不要给静态卡片加 hover 位移
5. 不要用小于 11px 的字号
6. 不要让强调色出现在非交互元素上
7. 不要混用多种圆角半径

---

## 8. Responsive Behavior

桌面应用窗口，断点按窗口宽度：

| 断点 | 宽度 | 行为 |
|---|---|---|
| Default（单屏） | ≥ 900px | 三列 `236px + 1fr + 300px`，`overflow: hidden`，不滚动 |
| Medium | 700–899px | 退化为两列（设置卡跨列置底），恢复滚动 |
| Compact | < 700px | 单列，开关网格与统计块均转单列，恢复滚动 |

- **Touch Targets**：滑块 thumb 14px（含 3px 描边共 20px）、开关 36×21、按钮最小高 30px
- **Font Scaling**：≥ 900px 用完整字号；< 900px 时统计数值 18px、正文保持 13px
- **单屏校验方式**：`app.scrollHeight === app.clientHeight` 视为通过（已实测 594 = 594）
- **断点陷阱**：媒体查询比对的是**客户区宽度**（窗口 1000 时客户区只有 986），
  断点不能设在窗口宽度附近，否则窗口边框就会误触发折行

---

## 9. Agent Prompt Guide

**Quick Reference**
```
深色桌面工具 / 背景 #0B0C0E / 卡片 #131418 / 边框 rgba(255,255,255,.07)
强调 #5E6AD2 / 语义 绿#30D158 蓝#0A84FF 橙#FF9F0A 红#FF453A
Inter / 字重 400·500·600 / 圆角 卡片14 内块10 控件8 / 间距基准4px
数字 tabular-nums / 无大投影 / 交互 120-180ms
```

**Component Prompts**
1. `按 DESIGN.md 生成一个 Stat 统计块，标签 11px uppercase tertiary，数值 20px tabular-nums`
2. `按 DESIGN.md 生成电量仪表环：轨道 rgba(255,255,255,.07)，进度取语义色，中心 44px 数字`
3. `按 DESIGN.md 生成设置行：左侧标题 13px + 说明 12px tertiary，右侧开关 38×22`
4. `按 DESIGN.md 生成 Toast：surface-elevated + 左侧 3px warning 边 + shadow-lg`
5. `按 DESIGN.md 生成滑块：轨道 4px，thumb 14px 白底 3px accent 描边`

**Iteration Guide**
1. 所有色值必须引用 CSS 变量，禁止硬编码
2. 新增组件先确认是否已有语义色可复用
3. 字号只能从 Type Scale 表中取
4. 间距只能是 4 的倍数
5. 深色背景下文字对比度不低于 4.5:1
6. 状态变化时只换颜色，不改布局尺寸
7. 动效统一 120–180ms，缓动 `cubic-bezier(0.16,1,0.3,1)`
8. 每张卡片只承载一类信息
9. 不确定时用留白替代分割线
10. 交付前检查：无渐变滥用、无超三级字重、圆角未混用
