# Chrome 手动验收清单

1. 在 `chrome://extensions` 开启开发者模式，加载本项目目录；代码更新后点击扩展卡片上的“重新加载”。
2. 在 Swagger UI、Redoc、Apifox、YApi 或 Postman Docs 页面执行自动提取，确认折叠文档会展开后恢复，且不会触发 Try it out/Execute。
3. 对自动结果不准确的页面使用手动选择，确认滚动和缩放后高亮框仍对齐。
4. 在包含以下字段表格的页面重点检查输出：

   - `aaa`、`aaa.bbb`、`aaa.bbb.ccc` 不应变成 `aaa.aaa.bbb`。
   - 视觉缩进或 `aria-level` 不应覆盖已经存在的点路径。
   - `data.items` 类型为数组时，后续 `data.items.id` 应输出为 `data.items[].id`。
   - `items[0].children[].id` 应保留显式数组下标。
   - `数据.用户.地址.城市` 应完整保留。

5. 检查 Python/YAML/JSON 代码块的空格、Tab、空行和换行未被压缩。
6. 同时创建两个导出预览，分别编辑文件名和 Markdown，刷新后确认内容没有互相覆盖。
7. 检查编辑/预览分栏、窄屏标签切换、复制、下载、自动保存和“Re-extract Source Tab”。
8. 在原始标签关闭后点击重新提取，应显示明确错误且不丢失当前编辑内容。

## Temu / TikTok Shop 多级参数

1. 打开 Temu 文档页 `https://partner-us.temu.com/documentation?menu_code=fb16b05f7a904765aac4af3a24b87d4a&sub_menu_code=8e8c5ca086834135bfa943405e66b18b`，保持参数树为任意展开状态后执行自动提取。
2. 确认 Temu 输出包含 `request.language`、`goodsBasic.externalGoodsId`、`goodsBasic.goodsName` 和 `goodsBasic.goodsCarouselImage[]`，且没有 `?.` 占位路径。
3. 打开 TikTok Shop 文档页 `https://partner.tiktokshop.com/docv2/page/get-package-detail-202309`，先折叠 `data`、`orders`、`skus` 再执行自动提取。
4. 确认 TikTok Shop 输出包含 `data.package_id`、`data.orders[].id` 和 `data.orders[].skus[].id`，导出完成后页面恢复到执行前的折叠状态。
