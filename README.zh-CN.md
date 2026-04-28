# Page to Markdown

[English](./README.md)

一个面向 API 文档页面的 Chrome 扩展。它可以提取当前标签页内容并转换为 Markdown，尽量过滤导航、侧边栏、菜单等无关内容，随后打开预览页并下载为 `.md` 文件。

## 功能

- 将当前 `http` 或 `https` 页面转换为 Markdown。
- 优先提取 API 文档主体内容，并过滤常见导航、侧边栏和菜单噪音。
- 识别常见 API 文档平台，例如 Swagger UI 和 Redoc。
- 当自动提取不够准确时，可回退到手动选择文档区域。
- 尽量将代码示例保留为 fenced code block，并为常见示例推断语言，例如 JSON、PHP、Python 和 cURL。
- 在预览页面中查看和编辑生成的 Markdown。
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
4. 选择当前目录：`/mnt/d/project/markdown`。

## 使用方式

1. 打开任意 `http` 或 `https` 的 API 文档页面。
2. 点击扩展图标。
3. 点击 **Auto Extract API Docs**。
4. 如果结果里仍然带有导航噪音，可改用 **Select Doc Area Manually**，然后在页面中点击实际的文档主体区域。
5. 在预览页中检查生成的 Markdown。
6. 如有需要可调整文件名，然后点击 **Download Markdown** 下载。

## 当前限制

- 提取逻辑仍然基于启发式规则和平台特定选择器；对于高度定制的文档门户，可能仍然需要手动选择。
- 当前仅对 Swagger UI 和 Redoc 做了定向适配。
- 图片只会保留 URL 引用，不会下载或嵌入图片资源。
- 不支持 `chrome://` 这类浏览器内部页面。

## 后续建议

- 增加更多平台适配，例如 Apifox、YApi、Stoplight 和 Postman Docs。
- 在通用回退场景中引入 Mozilla Readability，以提升正文提取效果。
- 用 Turndown 替换当前内置的 HTML 转 Markdown 逻辑。
- 增加渲染后的 Markdown 预览视图。
