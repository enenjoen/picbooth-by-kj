# PicBooth by KJ — iPad

PicBooth iPad 版是原生 SwiftUI Photo Booth，可用于婚礼、生日会、毕业典礼、公司活动及其他 event。

连接方式：

```text
Canon EOS 600D → USB-C OTG 数据线 → iPad → AirPrint → 打印机
```

## 当前功能

- 通过 ImageCaptureCore 发现 USB/PTP 相机。
- 使用 Canon EOS 专用 PTP 指令控制 600D。
- Canon EOS Live View 实时预览。
- 倒数拍摄与多张模板拍摄。
- 只下载本次拍摄的新照片。
- 6 寸横版及竖版模板。
- 创建并保存多套自定义模板。
- 导入 PNG/JPEG 图片图层。
- 修改照片框、文字、艺术字体、颜色、位置、圆角与透明度。
- 保存到 iPad 照片图库。
- 系统分享、AirDrop 与 AirPrint。

## 打开与安装

1. 在 Mac 安装 Xcode。
2. 打开 `PicBooth.xcodeproj`。
3. 在项目的 Signing & Capabilities 中选择自己的 Apple Development Team。
4. 用 USB 连接 iPad，并在 Xcode 顶部选择该 iPad。
5. 点击 Run。
6. 首次运行时，根据 iPad 提示信任开发者。

App 显示名称为 `PicBooth by KJ`，Bundle Identifier 为：

```text
com.joenkv.picbooth
```

## Canon 600D 设置

- 相机模式使用 `M` 或 `P`。
- 图片格式建议设为 JPEG。
- 为提高连续拍摄稳定性，建议镜头使用 MF。
- 关闭相机自动关机。
- SD 卡保持足够空间，并先备份重要照片。

每次连接时，iPadOS 会先建立 SD 卡内容目录。相机红色存储卡指示灯可能亮起，App 会显示初始化百分比；等红灯熄灭并显示“Canon EOS 遥控已就绪”后再开始拍摄。SD 卡中的照片越少，初始化通常越快。

## 模板设计

- 左侧模板栏可选择 Mac 版同步过来的模板。
- 点击“设计当前模板”可修改现有模板。
- 点击“新建空白模板”可创建新模板。
- 在设计器内点击“导入 PNG / JPEG 图片”添加装饰图层。
- 自定义模板保存在 iPad App 内。

内置模板和图片资源位于：

```text
TemplateAssets/
```

## 打印

iPad 使用系统 AirPrint。打印前请确保 iPad 与打印机连接同一个 Wi‑Fi，并先用实际 6 寸相纸测试边缘裁切和方向。

