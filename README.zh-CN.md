# Page to Markdown

[English](./README.md)

一个面向 API 文档页面的 Chrome 扩展。它可以提取当前标签页内容并转换为 Markdown，尽量过滤导航、侧边栏、菜单等无关内容，随后打开预览页并下载为 `.md` 文件。

## 功能

- 将当前 `http` 或 `https` 页面转换为 Markdown。
- 优先提取 API 文档主体内容，并过滤常见导航、侧边栏和菜单噪音。
- 识别 Swagger UI、Redoc、Apifox、YApi、Postman Docs、Temu Partner 和 TikTok Shop Partner，并在未知平台使用通用回退。
- 当自动提取不够准确时，可回退到手动选择文档区域。
- 保留代码示例的缩进、空格和换行，并为 JSON、PHP、Python 和 cURL 推断语言。
- 将 `aaa.bbb.ccc` 形式的多级参数视为绝对路径，兼容视觉缩进、属性深度、数组和中文路径。
- 在实时分栏预览中查看和编辑 Markdown，支持复制、自动保存和重新提取。
- 每次导出使用独立会话 ID，多个预览页面不会互相覆盖。
- 将编辑后的内容下载为 Markdown 文件。

## 项目结构

- `manifest.json`：Manifest V3 配置。
- `background.js`：后台工作流协调，负责自动提取与手动选择流程。
- `content-script.js`：页面内提取逻辑、平台识别和手动选择浮层。
- `popup.html`、`popup.css`、`popup.js`：扩展弹窗和操作入口。
- `preview.html`、`preview.css`、`preview.js`：Markdown 预览与下载页面。

## 加载方式

1. 打开 `chrome://extensions`。
2. 启用 **Developer mode**。
3. 点击 **Load unpacked**。
4. 选择本项目目录：`/mnt/d/project/page_to_markdown`。

扩展运行不需要安装依赖；预览使用的第三方脚本已经保存在 `vendor/`。如需运行测试：

```bash
npm install
npm test
```

## 使用方式

1. 打开任意 `http` 或 `https` 的 API 文档页面。
2. 点击扩展图标。
3. 点击 **Auto Extract API Docs**。
4. 如果结果里仍然带有导航噪音，可改用 **Select Doc Area Manually**，然后在页面中点击实际的文档主体区域。
5. 在预览页中检查生成的 Markdown。
6. 如有需要可调整文件名，然后点击 **Download Markdown** 下载。

## 当前限制

- 提取逻辑仍然基于启发式规则和平台特定选择器；对于高度定制的文档门户，可能仍然需要手动选择。
- 平台适配仍基于页面 DOM；平台升级或高度定制后可能需要更新 adapter 夹具。
- 图片只会保留 URL 引用，不会下载或嵌入图片资源。
- 不支持 `chrome://` 这类浏览器内部页面。

## 测试

运行 `npm test` 可执行转换、字段路径、平台 adapter、存储、预览安全和内容脚本集成测试。Chrome 手动检查项见 [MANUAL_TEST.md](./MANUAL_TEST.md)。
