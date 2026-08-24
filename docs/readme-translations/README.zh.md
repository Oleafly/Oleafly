<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly 徽标" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | **中文** | [العربية](README.ar.md)

<h2>为 AI 时代重新设计的一体化研究环境。</h2>

在一个工作区中完成写作、编译、校对、文献检索、引文管理、图表制作、PDF
审阅和 Git 变更追踪。你可以使用托管式 AI、自定义端点、本地 Ollama，也可以
完全不使用 AI。Oleafly 将项目保存在你电脑上的普通文件夹中。

[![待处理 Issue](https://img.shields.io/github/issues/Oleafly/Oleafly?label=Issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)
**[下载 Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[阅读产品文档](https://oleafly.com/docs/overview/) ·
[从源码构建](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly 正在使用 LaTeX 编辑 LLaMA 研究论文，同时显示源码树、文档大纲和编译后的 PDF" width="100%" />
</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

## 研究本身的环节已经够多了

一篇技术文档往往分散在编辑器、编译器、PDF 查看器、文献管理工具、
Git，以及一个看不到实际项目的 AI 聊天窗口之间。Oleafly 把这些工作
汇聚到一个桌面应用中，同时让源文件对其他编辑器和命令行工具
保持完全可读。

同一套项目视图，既适用于课程报告，也适用于期刊论文或
上百页的学位论文：

| 你的工作 | Oleafly 负责的部分 |
| --- | --- |
| 写作 | 源码与可视化编辑、自动补全、符号、引用、图片、表格，以及覆盖整个项目的代码智能 |
| 编译 | 内置的 LaTeX 与 Typst 引擎、通过 Pandoc 编译 Markdown、结构化的错误解析、日志，以及离线缓存构建 |
| 审阅 | 快速的 PDF 预览、页面与缩放控制、双页布局、颜色反转，以及双向 SyncTeX |
| 修订 | 自动保存、真正的 Git 历史、差异对比、版本恢复，以及 GitHub 同步 |
| 提交 | ATS（求职申请跟踪系统）与无障碍预检、引用检查、阅读视图提取，以及多种导出格式 |
| 获取帮助 | 可选的项目感知 AI 助手、本地 Ollama 模型、托管服务商，以及 MCP 客户端 |

如果你喜欢 Overleaf 边写边预览的工作方式，但希望编译、文件、Git
和模型选择都留在自己的机器上，Oleafly 正是为这种工作流而生。它也能
省去本地编辑器、TeX 工具链、PDF 查看器和 Git 客户端周边的
大部分配置工作。

Oleafly 目前不提供多人实时在线协作编辑，Git 和 GitHub
是当前的协作方式。

## 你可以用它做什么

### 写作时源码触手可及

- 支持 LaTeX、Typst 和 Markdown 项目，包括大型多文件文档、
  图片、包含文件和参考文献库。
- 在代码视图和可视化视图之间切换 LaTeX 与 Markdown。不受支持的富文本
  块会以可编辑源码的形式保留，而不是直接消失。
- 通过编辑器工具栏插入标题、列表、链接、引用、交叉引用、公式、
  分式、图片、表格和符号。
- 使用命令、引用、标签、文件和斜杠命令的自动补全。
- 查找和替换、折叠章节与环境、开启 Vim 键位，
  以及运行离线拼写和语法检查。
- 跳转到定义、查找引用、在整个项目范围内重命名标签或引用键，
  并在悬停时查看定义。

项目地图会索引项目中的每个章节、标签、引用键和环境，并以
`file:line` 的形式保持可寻址，因此导航和重命名能够跨越
整个多文件文档，而不是局限于单个缓冲区。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="Oleafly 的源码树与项目地图并列，列出各章节和标签及其所在文件和行号（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="Oleafly 的源码树与项目地图并列，列出各章节和标签及其所在文件和行号（浅色主题）" /></td>
  </tr>
</table>

</div>

引用选择器直接读取项目中的 `.bib` 文件，因此每个引用键都
附带作者、年份、标题及其定义所在的行号。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="从解析后的 BibTeX 条目中选择引用键，每条都显示作者、年份和源码行号（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="从解析后的 BibTeX 条目中选择引用键，每条都显示作者、年份和源码行号（浅色主题）" /></td>
  </tr>
</table>

</div>

理解 LaTeX 语法的字数统计会忽略标记，只统计读者实际看到的内容。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="字数统计弹窗显示当前文档的字数、字符数和行数（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="字数统计弹窗显示当前文档的字数、字符数和行数（浅色主题）" /></td>
  </tr>
</table>

</div>

### 无需离开项目即可编译和阅读

- 使用内置的 Tectonic 辅助进程编译 LaTeX，使用内置引擎编译 Typst。
  默认工作流不需要安装完整的 TeX 发行版。
- 编译失败会以编辑器诊断和易读的错误卡片呈现，
  无需在原始日志里翻找。
- 在源码旁边阅读 PDF：连续滚动、虚拟化页面渲染、
  单页或双页布局、适配控制、页面导航、全屏，
  以及可选的独立预览窗口。
- 双向使用 SyncTeX：从源码跳转到 PDF，或按住
  Cmd/Ctrl 点击 PDF 文本回到对应的源码位置。
- 将 PDF 保存到项目中，或将源码导出为便携归档。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="LaTeX 引擎设置页面，显示内置引擎及其选项（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="LaTeX 引擎设置页面，显示内置引擎及其选项（浅色主题）" /></td>
  </tr>
</table>

</div>

缩小视图即可一屏纵览整个文档，这通常是检查浮动体、图片
和表格是否落在预期位置的最快方式。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="三页文档在预览中完整铺开，每个图表都清晰可见（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="三页文档在预览中完整铺开，每个图表都清晰可见（浅色主题）" /></td>
  </tr>
</table>

</div>

### 保留一份可以随时查看的历史

每个项目都是一个真正的 Git 仓库。Oleafly 会在编译成功后和
编辑停顿期间自动提交，并在应用内展示这段历史中
有用的部分。

- 查看提交时间线和并排差异对比。
- 恢复某个文件的早期版本，而不影响项目的其余部分。
- 在源代码管理面板中暂存、丢弃、提交、推送和拉取。
- 将项目发布到 GitHub，或连接已有仓库。
- 继续在终端或其他编辑器中工作；这里没有需要解包的
  私有文档格式。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Oleafly Git 历史中的并排源码差异对比" width="84%" />
</div>

### 从有用的起点开始

项目模板库提供可编辑的起步模板，涵盖论文、学位论文、报告、
书籍、演示文稿、海报、作业、信函、参考文献库、简历和图表。
可按文档引擎、离线可用性或 ATS 适配性筛选。
可选的模板包和字体只在你选择时才会下载。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="Oleafly 可搜索的项目模板库，带实时缩略图、分类计数和引擎筛选（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="Oleafly 可搜索的项目模板库，带实时缩略图、分类计数和引擎筛选（浅色主题）" /></td>
  </tr>
</table>

</div>

### 在研究与发表任务之间自由切换

- 通过 DOI、arXiv 编号、URL 或标题搜索添加引用。Oleafly 会写入
  去重后的 BibTeX 条目，并在光标处插入引用。
- 在可视化画布上绘制图表，或直接编辑其 TikZ 代码，然后以矢量源码
  或图片的形式插入。保存的 TikZ 之后仍可重新打开编辑。
- 通过 Pandoc 导入 Word 文档、在本地从 PDF 重建可编辑的 LaTeX 项目，
  或用视觉模型转录公式图片。
- 导出 PDF 和源码归档；在文档引擎和项目类型支持时，还可导出
  Word、HTML、Markdown、纯文本、PowerPoint 或 EPUB。
- 浏览会议截稿日期，使用可选的文献查询，而不必把项目文件夹
  变成云端文档。

引用搜索会同时查询 arXiv、Semantic Scholar、Crossref、PubMed、OpenAlex
和 Google Scholar，自动合并重复记录，并把你保留的结果保存或
导出为 BibTeX。它还可以逐段扫描当前文档，为尚无引用支撑的
论断推荐合适的文献。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="引用搜索返回来自多个索引的去重结果，每条都带有保存和复制 BibTeX 操作（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="引用搜索返回来自多个索引的去重结果，每条都带有保存和复制 BibTeX 操作（浅色主题）" /></td>
  </tr>
</table>

</div>

图表编辑器在画布上作图，并在旁边实时编译 TikZ，因此你插入的
图片是真正可以继续编辑的矢量源码。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="图表编辑器画布上是一个 Transformer 架构图，旁边是其编译后的 TikZ 预览（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="图表编辑器画布上是一个 Transformer 架构图，旁边是其编译后的 TikZ 预览（浅色主题）" /></td>
  </tr>
</table>

</div>

### 在别人发现问题之前先自查文档

预检会同时检查源码和编译输出，能够发现失效引用、缺失资源、
重复标签、阅读顺序问题、缺失的元数据、不利于无障碍访问的
图片写法，以及难以被 ATS 解析的简历排版。

它还会展示解析器或屏幕阅读器能提取出的文本。这些检查是
实用的投稿前指导，而非正式的无障碍认证。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="预检报告显示无障碍评分以及针对源码和编译输出的具体发现（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="预检报告显示无障碍评分以及针对源码和编译输出的具体发现（浅色主题）" /></td>
  </tr>
</table>

</div>

参考文献和引用有专门的面板：文献库、文档中使用的每一条引用，
以及项目定义的符号。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="参考文献面板按引用键和年份列出文献条目，旁边是源码和编译后的 PDF（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="参考文献面板按引用键和年份列出文献条目，旁边是源码和编译后的 PDF（浅色主题）" /></td>
  </tr>
</table>

</div>

### 让 AI 参与项目——前提是你愿意

助手可以读取和编辑文件、搜索项目、执行编译、查看日志，
并提取 PDF 文本来核对自己的结果。它还能协助处理引用、
导入的文档以及可编辑的 TikZ 图表。

模型由你来选：

- 使用自己的 API 密钥连接受支持的托管服务商。
- 通过 Ollama 运行本地模型。
- 不配置 AI，照常使用应用的其余功能。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="助手面板提供的起始入口，例如查找可引用的论文、撰写文献综述和修复源码错误（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="助手面板提供的起始入口，例如查找可引用的论文、撰写文献综述和修复源码错误（浅色主题）" /></td>
  </tr>
</table>

</div>

文件改动会附带差异对比以及“批准”和“拒绝”控件。“始终允许”
可以在当前会话中自动批准普通的写入操作，而删除操作
仍会停下来等待确认。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="助手的文件改动以红绿差异对比呈现，附带拒绝、始终允许和批准控件" width="88%" />
</div>

批准后，修改会写入文件并重新编译文档。每条回复都保留
“将代码恢复到此回复之前”的操作。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="已批准的助手编辑应用到文档中，并反映在重新编译的 PDF 里" width="88%" />
</div>

服务商在设置中配置。密钥只保存在本机，而本地 Ollama 模型
则完全不需要密钥。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="AI 助手设置页面，已连接多个服务商并选中一个本地 Ollama 模型（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="AI 助手设置页面，已连接多个服务商并选中一个本地 Ollama 模型（浅色主题）" /></td>
  </tr>
</table>

</div>

Oleafly 还可以把自己的项目工具开放给 Claude Desktop、Claude Code、
Cursor 及其他 MCP 客户端。MCP 连接支持只读模式和
三种批准策略：逐一确认每次更改、自动批准写入但确认删除，
或信任客户端自身的批准机制。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="MCP 设置显示本地服务器、客户端配置说明以及可用的批准策略（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="MCP 设置显示本地服务器、客户端配置说明以及可用的批准策略（浅色主题）" /></td>
  </tr>
</table>

</div>

当前支持的服务商、工具和安全模型，请参阅[功能参考](../features.md)和
[MCP 配置](../mcp.md)。

一切都可以从同一个入口触达：全能搜索栏可搜索项目和文档，
输入 `/` 即可变身命令面板。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="全能搜索栏列出命令和最近更新的项目（深色主题）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="全能搜索栏列出命令和最近更新的项目（浅色主题）" /></td>
  </tr>
</table>

</div>

## 本地优先，网络边界清晰

无需账号，也没有任何遥测。核心项目数据始终留在你的
机器上。

| 在本地运行或保存 | 仅在你主动要求时才联网 |
| --- | --- |
| 项目文件与编辑器缓冲区 | 你自行连接的托管 AI 服务商 |
| Git 仓库与历史记录 | GitHub 发布、推送和拉取 |
| 使用缓存宏包的编译 | 首次编译所需的 TeX 宏包 |
| PDF 渲染与文本提取 | 可选的模板、字体、Pandoc 或 TinyTeX 下载 |
| 拼写、语法检查与预检 | 引用、文献、会议截稿日期和更新查询 |
| 通过 Ollama 的本地 AI |  |

API 密钥保存在本地。即使不再使用 Oleafly，纯文本文档文件
依然完全可用。

## 即将推出

路线图将继续保持 Oleafly 的开放、本地优先特性，并覆盖完整的研究工作流。

- **应用本地化。** 支持更多界面语言，让研究人员能在最自然的语言环境中使用 Oleafly。
- **智能体技能和插件。** 添加专注、可复用的 AI 工作流，减少重复上下文和 token 用量。
- **自主研究智能体。** 将研究问题和资料集转换为结构化的初稿，帮助研究快速起步。
- **实时协作和评论。** 为研究团队提供无限、自托管的协作环境。
- **Oleafly CLI。** 为不需要图形界面的研究工作流提供轻量、可安装的命令行工具包。
- **更完善的 Typst 和 Markdown 支持。** 让两种格式都能使用更多编辑、预览和发布功能。
- **更多研究集成。** 连接 Mendeley 以及其他参考文献、资源库和研究服务。
- **自托管云同步。** 在多台设备之间同步项目，并按需使用更完善的 GitHub 自动同步。

## 安装

从
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest) 下载最新构建。

| 平台 | 安装包 |
| --- | --- |
| macOS，Apple Silicon | `.dmg` |
| Windows，x86_64 | `.msi` 或 `-setup.exe` |
| Linux，x86_64 | `.AppImage`、`.deb` 或 `.rpm` |

首次编译 LaTeX 时可能会下载文档所需的宏包。
Tectonic 会缓存这些宏包供后续构建使用，而离线模式会将编译
限制在该缓存范围内。

从源码运行：

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
pnpm tauri dev
```

前置依赖、各平台环境搭建和生产构建，请参阅
[开发指南](../development.md)。

这些脚本会把当前平台所需且已锁定校验和的编译器辅助程序下载到
`src-tauri/binaries`。`all` 参数用于 CI 和发布打包，因为这些场景需要准备
所有受支持的平台。

本地运行时可以不安装 TexLab 和 Tinymist 提供的编辑器智能功能。需要时可运行
`pnpm language-servers:fetch` 下载这些语言服务器。有关完整性校验、许可证和
分发规则，请参阅[语言服务器工具链](../language-server-toolchain.md)。

### 命令行

`oleaflyc` 可以在不启动桌面应用的情况下管理 Oleafly 项目。目前它需要从本
仓库的源码构建，尚未作为独立软件包发布。

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

这些命令默认作用于当前目录。使用 `-C <path>` 可指定其他项目。运行
`oleaflyc --help` 可查看完整命令列表。

## 开发者文档

用户指南位于 [Oleafly 产品文档](https://oleafly.com/docs/overview/)。
以下资料面向贡献者、集成开发者和发布维护者。

| 参考文档 | 内容 |
| --- | --- |
| [产品工程目录](../README.md) | 功能清单与工程契约 |
| [功能参考](../features.md) | 产品功能面与支持的工作流 |
| [文档引擎](../document-engines.md) | LaTeX、Typst 和 Markdown 的能力 |
| [产品架构](../architecture.md) | 系统边界、包归属与扩展点 |
| [开发](../development.md) | 本地环境搭建、测试与贡献流程 |
| [语言服务器工具链](../language-server-toolchain.md) | 获取、完整性校验与分发策略 |
| [MCP 集成](../mcp.md) | 外部客户端、访问令牌与批准策略 |
| [发布流程](../releasing.md) | 发布工作流与产物检查 |
| [代码签名](../signing.md) | 各平台签名要求 |
| [自动更新](../updates.md) | 更新清单、签名与回滚 |

## 参与贡献

<table>
  <tr>
    <td width="38%" valign="top"><img src="../assets/oleafly-club.png" alt="Oleafly Club：一个共同庆祝初稿、修订、测试和成功投稿的开源研究社区" width="100%" /></td>
    <td width="62%" valign="top"><h3>研究者值得拥有可以审查、扩展并信赖的工具。</h3><p>Oleafly 由 <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> 和众多贡献者公开开发。欢迎提交错误报告、修复、模板、文档，以及经过深思的产品反馈。</p></td>
  </tr>
</table>

1. 阅读 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
2. 大的改动请先开 issue 讨论；小而聚焦的修复可以直接
   提交 pull request。
3. 提交前运行相关检查：

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

安全问题请按照
[SECURITY.md](../../SECURITY.md) 中的说明私下报告。参与本项目须遵守
[行为准则](../../CODE_OF_CONDUCT.md)。

## 社区与支持

- 在 [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions) 提问并分享想法。
- 在 [GitHub Issues](https://github.com/Oleafly/Oleafly/issues) 报告错误并提出功能建议。
- 🔔 关注 X 上的 [@OleaflyHQ](https://x.com/OleaflyHQ)，获取产品和版本更新。

⭐ 如果 Oleafly 对你有帮助，请考虑[为仓库加星](https://github.com/Oleafly/Oleafly)。
这个小小的点击能帮助更多研究人员发现项目，并支持持续开发。

## 星标趋势

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="GitHub 星标趋势图" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

## 致谢

Oleafly 构建于以下项目之上：
[Tauri](https://tauri.app/)、
[React](https://react.dev/)、
[CodeMirror](https://codemirror.net/)、
[Tectonic](https://tectonic-typesetting.github.io/)、
[Typst](https://typst.app/)、
[pdf.js](https://mozilla.github.io/pdf.js/)、
[Zustand](https://github.com/pmndrs/zustand)、
[Tailwind CSS](https://tailwindcss.com/)、
[Harper](https://writewithharper.com/) 和
[Hunspell](https://hunspell.github.io/)。

Oleafly 采用
[AGPL-3.0-or-later](../../LICENSE) 许可发布。第三方声明列于
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md)。
