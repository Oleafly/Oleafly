<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-app-icon-pastel-256.png" alt="Oleafly 标志" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | **中文** | [العربية](README.ar.md)

[![下载 macOS 版（Apple Silicon）](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![下载 Windows 版](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![下载 Linux 版](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest)

[![开放议题](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![下载量](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml) [![SonarQube 质量门禁](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Oleafly_Oleafly) [![代码覆盖率](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=coverage)](https://sonarcloud.io/component_measures?id=Oleafly_Oleafly&metric=coverage) [![开发状态：超活跃](https://img.shields.io/badge/status-ultra_active-22c55e)](https://github.com/Oleafly/Oleafly/pulse) [![最近提交日期](https://img.shields.io/github/last-commit/Oleafly/Oleafly?label=last%20commit&color=22c55e)](https://github.com/Oleafly/Oleafly/commits/main) [![许可证：AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE) [![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2Fkt9bcCjgkP%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=&color=5865F2&logo=discord&logoColor=white&cacheSeconds=600)](https://oleafly.com/discord) [![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**面向科研的 LaTeX、Typst 和 Markdown 实时协作编辑器。**

Oleafly 是一款功能强大的编辑器，用于以 LaTeX、Typst 和 Markdown 撰写研究论文和学位论文。一个项目的源文件、PDF、引文、图形、检查和 Git 历史都集中在一处。与合作者实时写作，让项目在多台电脑之间保持同步，并把 Claude Code、Codex 或你喜欢的任何模型带进项目。

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>免费下载</strong></a>
· <a href="https://oleafly.com/docs/">阅读指南</a> · <a href="https://github.com/Oleafly/oleafly-server">运行服务器</a> · <a href="../development.md">从源代码构建</a>
</p>


永久免费 · 开源 · 无需 Oleafly 账户 · 无跟踪

</div>

<div align="center">
  <img src="../assets/readme/hero-collab.png" alt="Oleafly 中打开的一篇 LaTeX 研究论文：左侧是文件树、大纲和结构，旁边是带有五位合作者光标和高亮评论的源文件，以及编译后的 PDF" width="100%" />
</div>

## 为什么选择 Oleafly

这里的一切都是免费的，包括其他编辑器留给付费方案的功能：与你邀请的任意数量合作者实时协作、完整的版本历史、Git 和 GitHub 同步、Zotero、语法检查和 AI。

- 在你的实验室用一条命令搭建的服务器上，与合作者实时写作，共享光标和评论。
- 专为长文档打造的编辑器：标签、引文和命令补全，实时错误检查，整个项目的大纲，Vim 和 Emacs 键位，可视化模式，以及包含 236 个 LaTeX 符号的可搜索面板。
- 在你自己的电脑上编译。Tectonic、Typst 和 Pandoc 已经内置，项目需要完整发行版时，由 TeX Live、MacTeX、MiKTeX 或 TinyTeX 接手。
- 在 PDF 中点击即可跳到源文件，也可以再跳回来。修复错误时，最后一次成功的 PDF 会一直留在屏幕上。
- 每个项目都是可以推送到 GitHub、GitLab、Gitea、Forgejo、Codeberg 或你自己的 Git 服务器的 Git 仓库，每次成功编译后，检查点都会保存一份快照。
- 输入时即可从 Zotero 文献库引用，不离开编辑器就能搜索 arXiv、Semantic Scholar、Crossref、PubMed 和 OpenAlex。
- 针对学术写作调校的拼写和语法检查在你的电脑上运行。
- 投稿之前，Preflight 会找出断裂的引用、缺失的图形、未嵌入的字体、无障碍缺陷，以及任何会破坏匿名评审的内容。
- 绘制的图形会保留为 TikZ、Typst 或 Mermaid 代码，你还可以从 1,700 多个论文、学位论文、幻灯片、海报和简历模板开始。
- 可从 Word、PDF、arXiv 源码、Git 仓库或在线 LaTeX 账户导入。
- `oleafly` 命令可以在任何终端或 CI 任务中构建、检查和同步你的项目，使用与应用相同的编译器和设置。
- 云同步让你的项目出现在你使用的每台电脑上，离线时也可以继续写作。
- Claude Code、Codex 和另外 12 个代理可以在你的项目中工作，你也可以连接任何模型，包括本地模型。AI 是可选的，它做出的每项更改都是可以审阅和撤销的 diff。
- 研究任务会在项目的独立副本中进行文献综述、证据审计或一轮修订，同时你可以继续写作，并自行选择保留哪些更改过的文件。它们是实验性功能，默认关闭；可在“设置 > 实验功能”中开启。

## 实时共同写作

将项目共享到你实验室的 Oleafly Server，所有人就能同时编辑相同的文件。你可以看到每个人的光标和选区、谁在线，以及你离开期间有哪些更改。点击某人的头像，即可跳到对方正在编辑的那一行。

<p align="center">
  <img src="../assets/readme/live-comments.png" alt="两位合作者在 Oleafly 中编辑同一个 LaTeX 文件，显示他们的光标、头像以及人员和活动面板" width="100%" />
</p>

- 在 LaTeX、Typst 或 Markdown 中对任意选区发表评论，然后回复、提及某人、标记为已解决或重新打开。被提及的合作者会收到一封邮件，也可以关闭这类邮件。
- 离线时所做的编辑会在重新连接后合并。如果与他人的编辑重叠，Oleafly 会把两者都展示给你，并在应用任何内容之前先询问你。
- AI 编辑、Zotero 引文、重命名、删除和图形也都会同步。如果两个人同时替换同一个图形，两个版本都会保留。
- 主文件、编译器、拼写检查语言和 Typst 选项是共享的，因此整个团队都以相同方式编译项目。
- 每个项目都有所有者、编辑者和查看者。通过邮件邀请的访客只能看到自己受邀加入的项目。

### 自己运行服务器

Oleafly Server 只需一条命令即可安装在 Linux 机器上，无论是实验室工作站、大学虚拟机还是小型云服务器：

```bash
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

它是一个使用 SQLite 的单一 Rust 二进制文件，可以把文件保存在磁盘或任何 S3 兼容存储中，配置后还能通过 SMTP 发送邮件。用户通过 GitHub 或任何 OpenID Connect 提供商登录，因此你所在大学的单点登录也能使用。服务器提供适用于 Docker Compose、Coolify、Render 和 systemd 的现成配置，以及 Railway、Cloudflare Tunnel 和大学证书的指南。

管理员可以在 Oleafly 中通过控制台管理人员、访问规则、项目、邮件和安全日志。每台设备都会为自己的更改签名，服务器根据这份签名历史构建每个快照，而不是信任上传的内容。

<p align="center">
  <img src="../assets/readme/server-admin.png" alt="Oleafly Server 管理控制台，显示人员、访问规则和安全日志" width="100%" />
</p>

阅读[服务器指南](https://github.com/Oleafly/oleafly-server)，了解安装设置、备份，以及谁能做什么的完整列表。

## 在多台电脑之间云同步

开启云同步后，你的项目库项目和应用设置会从一台电脑跟随你到另一台电脑。每次下载在替换文件之前都会与对应记录核对，你打开着且有未保存更改的文件永远不会被覆盖。

<p align="center">
  <img src="../assets/readme/cloud-sync-dropbox.png" alt="Oleafly 云同步设置，显示 Dropbox 卡片和同步内容列表" width="100%" />
</p>

- 两台电脑编辑同一个文件时，两个版本都会保留，并分别以写入它的电脑命名。
- 一次删除项目的大部分内容时，项目会先被挂起，等你确认，因此一次误操作不会把各处的项目都清空。
- 在另一台电脑上删除的文件会进入这台电脑的废纸篓，而不是直接消失。
- 在新电脑上，Oleafly 会询问一次：保留这台电脑的设置，还是使用同步的设置。

## 带上你的项目

正在从在线 LaTeX 编辑器迁移？在 Oleafly 中登录一次你的账户，选择想要的项目，它们就会连同文件、编译器和主文件一起迁移过来，可以直接编译。大学自己部署的服务器也同样适用。

有了该账户的 Git 令牌，Oleafly 可以让导入的项目双向保持同步，留在线上的合作者可以照常工作。双向同步使用该服务自己的 Git 集成，需要项目所有者的账户使用付费方案或大学方案。

<p align="center">
  <img src="../assets/readme/import-dialog.png" alt="Oleafly 导入项目对话框，提供本地文件、arXiv、GitHub 和在线 LaTeX 账户等选项" width="100%" />
</p>

你也可以从项目 ZIP、GitHub 仓库、Word 文档、arXiv 源码包，或由 Oleafly 重建为可编辑 LaTeX 的 PDF 开始。也可以直接在文件夹原来的位置打开它。

## 在项目中工作的 AI 代理

从目录中选择一个代理，它就会在你的项目中工作，源文件、PDF 和编译日志都触手可及。每个代理使用自己的账户登录，使用自己的模型。Oleafly 为它提供项目和周围的工具。

<p align="center">
  <img src="../assets/readme/ai-agents.png" alt="Oleafly 中的 AI 代理正在修改 LaTeX 论文的一个章节，建议的更改以 diff 显示" width="100%" />
</p>

<div align="center">
<table>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/claude-code.svg" alt="" width="40" height="40" /><br />Claude&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codex.svg" alt="" width="40" height="40" /><br />Codex&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/gemini-cli.svg" alt="" width="40" height="40" /><br />Gemini&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/pi.svg" alt="" width="40" height="40" /><br />Pi</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/opencode.svg" alt="" width="40" height="40" /><br />OpenCode</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/openclaw.svg" alt="" width="40" height="40" /><br />OpenClaw</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cline.svg" alt="" width="40" height="40" /><br />Cline</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/hermes-agent.svg" alt="" width="40" height="40" /><br />Hermes&nbsp;Agent</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codebuddy.svg" alt="" width="40" height="40" /><br />CodeBuddy</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/kimi-code.svg" alt="" width="40" height="40" /><br />Kimi&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/grok.svg" alt="" width="40" height="40" /><br />Grok&nbsp;Build</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cursor.svg" alt="" width="40" height="40" /><br />Cursor</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/deepseek-harness.png" alt="" width="40" height="40" /><br />DeepSeek Harness</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/qoder.svg" alt="" width="40" height="40" /><br />Qoder</td>
  </tr>
</table>
</div>

<p align="center"><sub>这些标志用于识别兼容工具，归其各自所有者所有，不表示任何背书。</sub></p>

更喜欢聊天助手？可以连接托管提供商、任何 OpenAI 兼容端点或本地 Ollama 模型。

- 每次文件更改都是一个 diff。你可以逐个批准，让助手自主工作，或按工具设置规则，也可以撤销单个文件或整轮更改。
- Plan 模式会在写入任何内容之前先绘制项目地图。
- 文献综述或修订可以在独立的 Git worktree 中运行，你可以继续写作。由你选择保留哪些更改过的文件。
- 应用随附 39 个研究技能，包括文献检索、相关工作、主张核查和审稿回复信。运行 `npx skills add Oleafly/Oleafly`，也可以把它们装进 Claude Code、Codex 等智能体。
- 本地 MCP 服务器让外部 AI 客户端可以使用相同的项目工具。它只监听 127.0.0.1。
- `oleafly mcp` 通过 stdio 为 Claude Code、Codex、Cursor 和 Gemini CLI 提供项目工具，无论应用是否打开。
- 每个版本都附带 `oleafly.mcpb`。打开它，Claude Desktop 就会把 Oleafly 安装为扩展。MCP Registry 中的名称是 `io.github.Oleafly/oleafly`。

AI 是可选的。关闭 AI 时，编辑器、编译器、PDF、引文、校对和检查都照常工作。

## LaTeX、Typst 和 Markdown，在你的电脑上编译

Tectonic、Typst 和 Pandoc 随应用提供，因此新项目无需安装任何东西即可编译。项目需要完整的 TeX 发行版时，可以将它切换到 latexmk，配合 TeX Live、MacTeX、MiKTeX 或由 Oleafly 为你安装的 TinyTeX 使用。

<p align="center">
  <img src="../assets/readme/editor-and-pdf.png" alt="Oleafly 源文件编辑器与编译后的 PDF 并排显示，一条编译诊断链接到对应的源文件行" width="100%" />
</p>

- 在 PDF 中点击可跳到源文件，也可以再跳回来。LaTeX 使用 SyncTeX，Typst 0.13 或更高版本使用 Tinymist。
- 编译错误会链接到导致错误的那一行，修复期间，最后一次成功的 PDF 会留在屏幕上。
- 可视化模式让你在类似页面的视图中编辑，源文件只需一次点击。
- 为整个项目中的标签、引文、命令、环境和文件路径提供补全和实时诊断。
- 拼写和语法检查在本地运行，并针对学术写作进行了调校。
- 支持 XeLaTeX、LuaLaTeX，以及用于日文文档的 upLaTeX 或 pLaTeX。

## 引文、图形、检查和模板

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/citations.png" alt="在 Oleafly 编辑器中输入 @ 引用 Zotero 条目" width="100%" />
      <h3>输入时即可从 Zotero 引用</h3>
      输入 <code>@</code> 以及作者、标题或年份的一部分，即可从你的 Zotero 文献库引用。Oleafly 只会把这一条目添加到项目的 <code>.bib</code>。引文搜索覆盖 arXiv、Semantic Scholar、Crossref、PubMed 和 OpenAlex。
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/diagrams.png" alt="Oleafly Diagram Composer，画布与 TikZ 代码并排显示" width="100%" />
      <h3>绘制保留为代码的图形</h3>
      Diagram Composer 在画布上绘图，并写出 TikZ、用于 Typst 的 fletcher 或 Mermaid。修改图形或代码，另一方会随之更新。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/preflight.png" alt="Oleafly Preflight 列出引用、图形和无障碍方面的发现" width="100%" />
      <h3>投稿前先检查</h3>
      Preflight 会找出断裂的引用、缺失的图形、未嵌入的字体、无障碍缺陷，以及任何会在匿名评审中暴露作者身份的内容。它提供适用于 arXiv、IEEE、ACM、期刊和学位论文的配置文件。
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/templates.png" alt="Oleafly 模板库，显示论文、学位论文和幻灯片的渲染预览" width="100%" />
      <h3>从 1,700 多个模板开始</h3>
      文章、学位论文、Beamer 演示、海报、简历和会议风格论文，每个模板在你创建项目之前都有渲染预览。
    </td>
  </tr>
</table>

## Git、历史和终端

每个项目都是一个普通文件夹，里面是一个普通的 Git 仓库。在 Source Control 面板中暂存、查看 diff、提交、推送、拉取并发布到 GitHub、GitLab、Gitea、Forgejo、Codeberg 或你自己的服务器，也可以使用你自己的终端，因为没有任何内容对它隐藏。每次成功编译后，检查点会保存一份本地快照，因此你无需提交也能回滚。

<p align="center">
  <img src="../assets/readme/git-history.png" alt="Oleafly Source Control 面板，显示 diff、分支图和提交控件" width="100%" />
</p>

编辑器下方有一个终端停靠栏，每个项目最多可以打开十个标签页。按住 Cmd 点击（Ctrl 点击）输出中的文件路径，即可在对应行打开该文件。

`oleafly` 命令可以在任何终端中处理同样的项目：构建、每次更改后重新构建、提交前检查、与在线 LaTeX 服务同步，或者不打开应用就运行 Oleafly 代理。每个命令都可以输出 JSON，并为脚本和 CI 提供稳定的退出码。详见[命令行指南](../cli.md)。

## 还有更多

<details>
<summary>40 多个转换、引文和数学工具</summary>

工具库处于 beta 阶段，默认关闭。可在“设置 > 实验功能 > LaTeX 工具”中开启。

#### 导入和格式转换

| 工具 | 用途 |
| --- | --- |
| PDF to LaTeX | 从 PDF 重建可编辑的 LaTeX，在来源允许时保留公式、图形和结构 |
| arXiv to LaTeX | 按 ID 下载 arXiv 源码包，或从磁盘解包已保存的归档 |
| Image to LaTeX | 将笔记、公式或表格图像转换为可编辑 LaTeX |
| Equation to LaTeX | 将输入的数学内容或公式图像转换为 LaTeX |
| Excel to LaTeX | 将 Excel、CSV 或 TSV 表格转换为经过转义的 LaTeX 表格 |
| HTML to LaTeX | 将粘贴的 HTML 转换为独立 LaTeX 文档 |
| Image to Typst | 将笔记、公式或表格图像转换为可编辑 Typst |
| LaTeX to HTML | 将 LaTeX 转换为带 MathML 公式的独立 HTML |
| LaTeX to Image | 渲染公式并导出 PNG 或 SVG |
| LaTeX to Markdown | 将 LaTeX 文档转换为可移植 Markdown |
| LaTeX to Typst | 将 LaTeX 转换为可以复制、保存或打开为项目的 Typst 源码 |
| LaTeX to Word | 创建 Word 文档，公式以原生 Word 数学公式保存 |
| Markdown to LaTeX | 将 Markdown 笔记转换为独立 LaTeX 文档 |
| Markdown to Typst | 将 Markdown 笔记转换为 Typst 源码 |
| Mermaid to LaTeX | 将 Mermaid 流程图转换为可编辑 TikZ 代码 |
| PDF to Markdown | 将 PDF 文本层、公式和图形提取到 Markdown |
| PDF to Typst | 将 PDF 文本层、公式和图形提取到 Typst |
| Table to LaTeX | 在可视化行列编辑器中创建 LaTeX 表格 |
| Typst Editor | 创建带源文件编辑、实时预览和 PDF 导出的 Typst 项目 |
| Visual Typst Editor | 在项目编辑器中启动带实时预览的 Typst 文档 |
| Typst to LaTeX | 将 Typst 标记转换为用于期刊和投稿的 LaTeX |
| arXiv to Typst | 将 arXiv 源码包转换为 Typst，并通过编译检查列出未能转换的内容 |
| CSV to Typst | 粘贴 CSV 或 TSV 行，生成经过转义的 Typst 表格 |
| Equation to Typst | 将输入的 LaTeX 数学内容或公式图像转换为 Typst 数学公式 |
| Excel to Typst | 将 Excel、CSV 或 TSV 表格转换为经过转义的 Typst 表格 |
| HTML to Typst | 将粘贴的 HTML 转换为独立 Typst 文档 |
| Mermaid to Typst | 将 Mermaid 流程图转换为可编辑的 fletcher 代码 |
| Typst to HTML | 将 Typst 标记转换为带 MathML 公式的独立 HTML |
| Typst to Markdown | 将 Typst 标记转换为可移植 Markdown |
| Typst to Word | 创建 Word 文档，公式以原生 Word 数学公式保存 |
| Word to Typst | 将 Word 文档转换为 Typst，并保留提取出的媒体文件 |
| Word to LaTeX | 将 Word 文档转换为 LaTeX，并保留提取出的媒体文件 |

#### 数学、表格、写作和验证

| 工具 | 用途 |
| --- | --- |
| BibTeX Validator | 检查 `.bib` 文件的语法错误、缺少的必填字段和重复键 |
| Statistics Calculators | 在本地计算 p 值、样本量和置信区间 |
| Writing Generators | 借助助手，根据打开的文档准备摘要、总结、改写或学位论文提纲 |
| Symbol Reference | 浏览 LaTeX 符号，并在光标处插入符号；在 Typst 文件中则插入其 Typst 名称 |

#### 文献、参考资料和研究

| 工具 | 用途 |
| --- | --- |
| Find Citations | 搜索学术索引，扫描草稿中缺少的支持，并导出 BibTeX |
| arXiv Citation Generator | 查找 arXiv 论文，并按八种格式生成引文 |
| Bibliography Generator | 根据结构化详情或 BibTeX 创建、验证、排序和导出书目 |
| Citation Generator | 将文章详情或学术标识符转换为格式化引文和 BibTeX |
| Citation Generators by Style | 在 APA、MLA、Chicago、IEEE、Harvard、Vancouver、AMA 和 ACS 格式之间比较同一条参考文献 |
| DOI to BibTeX | 获取 DOI 记录，检查字段，并导出 BibTeX |
| ISBN to BibTeX | 获取 ISBN 书籍元数据，修正后导出 BibTeX |
| PubMed to BibTeX | 根据 PMID 获取并检查 PubMed 记录，然后导出 BibTeX |
| URL to BibTeX | 识别 DOI、arXiv 和 PubMed 链接，或创建可编辑网页引文 |
| Lab Search | 在 OpenAlex 目录中查找研究机构 |
| Conference Deadlines | 筛选会议截止日期（大多属于计算机科学）并查看倒计时 |

</details>

<details>
<summary>Oleafly 随附的 39 个研究技能</summary>

技能是遵循 Agent Skills 结构的普通 `SKILL.md` 文件夹。你可以用斜杠命令运行技能，添加自己的技能，或与同一台电脑上兼容的 CLI 代理共享。

内置的 `research-core` 软件包包含 39 个技能。下面的名称是目录和项目设置中使用的 ID。

| 类别 | 技能 |
| --- | --- |
| 研究和文献 | `citation-management`, `exploratory-data-analysis`, `hypothesis-generation`, `literature-review`, `oleafly-experiment-loop`, `oleafly-literature-sweep`, `oleafly-research-loop`, `openresearch`, `paper-lookup`, `research-lookup`, `scientific-brainstorming`, `scientific-critical-thinking` |
| 手稿写作和分析 | `experimental-design`, `oleafly-data-analysis`, `oleafly-manuscript-scaffold`, `oleafly-related-work`, `scientific-writing`, `statistical-analysis`, `statistical-power`, `venue-templates` |
| 图形和可视化 | `oleafly-figure-prep`, `scientific-schematics`, `scientific-visualization` |
| 审阅和证据 | `oleafly-response-letter`, `oleafly-review-manuscript`, `oleafly-verify-claims`, `peer-review`, `scholar-evaluation` |
| 投稿 | `oleafly-pre-submission` |
| 交流 | `oleafly-slides-and-posters`, `pptx-posters`, `research-grants`, `scientific-slides` |
| 工具和自动化 | `desktop-apps`, `import-refine`, `oleafly-cli`, `oleafly-latex-build`, `pdf-to-latex`, `template-generate` |

</details>

<details>
<summary>编辑器细节</summary>

- 包含 236 个 LaTeX 符号的可搜索面板，在 Typst 文件中会插入 Typst 名称。
- Vim 和 Emacs 键位、多文件标签页、代码折叠、跨项目搜索和替换，以及字数统计。
- 重命名或移动文件时，Oleafly 会更新指向它的路径。
- 浅色和深色模式的主题、任何已安装的字体、可编辑的语法颜色，以及禅模式。
- 界面提供 21 种语言。
- 命令面板的快捷键是 Cmd+K（Ctrl+K），按 Cmd+Shift+F（Ctrl+Shift+F）则可在一个搜索框中查找项目、文档、设置和工具。

</details>

## 开始使用

1. 为你的电脑[下载 Oleafly](https://github.com/Oleafly/Oleafly/releases/latest)。
2. 从模板创建项目、导入项目，或打开你已有的文件夹。
3. 按 Cmd+Enter（Windows 和 Linux 上为 Ctrl+Enter）编译。
4. 要与他人一起写作，点击**共享**，将项目发送到你实验室的 Oleafly Server。

| 平台 | 软件包 | 下载 |
| --- | --- | --- |
| macOS · Apple Silicon | DMG | [![下载 macOS 版（Apple Silicon）](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | MSI 或 EXE | [![下载 Windows 版](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 | AppImage、DEB 或 RPM | [![下载 Linux 版（x86_64）](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · ARM64 | AppImage、DEB 或 RPM | [![下载 Linux 版（ARM64）](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |

在 x86_64 上，Linux 软件包需要 glibc 2.35 或更高版本（Ubuntu 22.04 或更高版本）。ARM64 软件包在 Ubuntu 24.04 上构建。发行版包含签名的更新产物，应用内更新器会在安装任何内容之前验证签名。

## 常见问题

<details>
<summary>我需要账户吗？</summary>

不需要 Oleafly 账户。你无需登录任何服务就能写作、编译和使用 Git。实时协作会通过 GitHub 或你所在大学的登录方式让你登录实验室的服务器，云同步则会登录你的云存储。

</details>

<details>
<summary>可以离线使用吗？</summary>

可以。写作、编译、PDF、校对、Preflight、Git 和检查点都在你的电脑上运行。内置引擎具备所需宏包后，LaTeX 可以离线构建，Typst 则在宏包缓存后可以离线构建。共享项目会保留你的编辑，并在重新连接后合并。

</details>

<details>
<summary>哪些内容会经过网络？</summary>

只有你请求的内容：与你的服务器共享、云同步、文献和 DOI 查询、GitHub、托管 AI 提供商、你连接的 MCP 服务器，以及可选的引擎、宏包和模板下载。发布版本还会在应用启动时检查更新。本地 Ollama 模型会让 AI 通信留在你的电脑上。

</details>

<details>
<summary>我的大学或公司可以托管服务器吗？</summary>

可以，这正是它的设计初衷。Oleafly Server 运行在你自己的机器或云账户上，通过 GitHub 或任何 OpenID Connect 提供商让用户登录，并将文件存储在磁盘或 S3 兼容存储中。[服务器指南](https://github.com/Oleafly/oleafly-server)介绍了安装、备份和角色。

</details>

## 了解更多

- [产品指南](https://oleafly.com/docs/)
- [Oleafly Server](https://github.com/Oleafly/oleafly-server)
- [功能地图](../features.md)
- [编辑器指南](../Editor.md)
- [PDF 预览](../PDFPreview.md)
- [引文和文献](../Citations.md)
- [工具库](../Tools.md)
- [Preflight 和无障碍检查](../Preflight.md)
- [模板](../Templates.md)
- [Diagram Composer](../DiagramComposer.md)
- [Git 和源代码管理](../SourceControl.md)
- [检查点](../Checkpoints.md)
- [AI Copilot](../AICopilot.md)
- [技能](../Skills.md)
- [MCP 集成](../mcp.md)
- [命令行工具](../cli.md)
- [开发设置](../development.md)
- [更新日志](../../CHANGELOG.md)

## 社区与支持

欢迎加入 [Discord 上的 Oleafly 社区](https://oleafly.com/discord)：提问、为难缠的编译问题寻求帮助、展示你正在写的内容，并为接下来要开发的功能投票。社区免费，向所有人开放。更习惯用 GitHub？可以在 [GitHub Issues](https://github.com/Oleafly/Oleafly/issues) 报告错误或请求功能。

Oleafly 由 [Prajwal Murthy](https://github.com/prajwal-svm) 和贡献者共同构建。代码、模板、文档和反馈方面的贡献都很欢迎。阅读[贡献指南](../../CONTRIBUTING.md)参与项目。

如果你使用 Oleafly，[在 GitHub 上点一颗星](https://github.com/Oleafly/Oleafly)可以帮助更多研究者发现它。

## 引用 Oleafly

<details>
<summary>复制 BibTeX 条目</summary>

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S. and {The Oleafly contributors}},
  title   = {Oleafly: a local-first workspace for research writing},
  year    = {2026},
  version = {0.4.8},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

</details>

[安全](../../SECURITY.md) · [行为准则](../../CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](../../LICENSE)

## Star 历史

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Star 历史图表" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
