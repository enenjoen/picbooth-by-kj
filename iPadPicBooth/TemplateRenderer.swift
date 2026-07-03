import UIKit

enum TemplateRenderer {
    static func render(
        template: BoothTemplate,
        photos: [UIImage],
        event: String,
        date: String,
        message: String
    ) -> UIImage {
        let outputSize = CGSize(width: template.width, height: template.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: outputSize, format: format)

        return renderer.image { context in
            UIColor(hex: template.background).setFill()
            context.fill(CGRect(origin: .zero, size: outputSize))

            for layer in template.layers {
                switch layer.type {
                case .photo:
                    drawPhoto(photo(for: layer, photos: photos), layer: layer, context: context.cgContext)
                case .text:
                    drawText(layer, event: event, date: date, message: message, canvasWidth: outputSize.width)
                case .heart:
                    drawHeart(layer)
                case .image:
                    drawImage(layer)
                }
            }
        }
    }

    private static func photo(for layer: BoothLayer, photos: [UIImage]) -> UIImage {
        guard !photos.isEmpty else { return placeholderPhoto(index: (layer.photoIndex ?? 0) + 1) }
        let index = min(max(0, layer.photoIndex ?? 0), photos.count - 1)
        return photos[index]
    }

    private static func drawPhoto(_ image: UIImage, layer: BoothLayer, context: CGContext) {
        let rect = CGRect(x: layer.x, y: layer.y, width: layer.w ?? 400, height: layer.h ?? 600)
        let path = UIBezierPath(roundedRect: rect, cornerRadius: layer.radius ?? 0)

        context.saveGState()
        path.addClip()
        image.draw(in: aspectFillRect(image.size, inside: rect))
        context.restoreGState()

        if (layer.borderWidth ?? 0) > 0 {
            UIColor(hex: layer.borderColor ?? "#FFFFFF").setStroke()
            path.lineWidth = layer.borderWidth ?? 0
            path.stroke()
        }
    }

    private static func drawText(_ layer: BoothLayer, event: String, date: String, message: String, canvasWidth: CGFloat) {
        let value = (layer.text ?? "")
            .replacingOccurrences(of: "{event}", with: event)
            .replacingOccurrences(of: "{date}", with: date)
            .replacingOccurrences(of: "{text}", with: message)

        let size = layer.fontSize ?? 42
        let font = font(named: layer.font ?? "sans", size: size)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = layer.align == "left" ? .left : layer.align == "right" ? .right : .center
        paragraph.lineBreakMode = .byWordWrapping

        let width = layer.align == "center" ? min(canvasWidth - 80, 1100) : min(canvasWidth - layer.x - 60, 1020)
        let originX = layer.align == "center" ? layer.x - width / 2 : layer.x
        let rect = CGRect(x: originX, y: layer.y - size, width: width, height: size * 3.2)

        value.draw(in: rect, withAttributes: [
            .font: font,
            .foregroundColor: UIColor(hex: layer.color ?? "#333333"),
            .paragraphStyle: paragraph
        ])
    }

    private static func drawHeart(_ layer: BoothLayer) {
        let rect = CGRect(x: layer.x, y: layer.y, width: layer.w ?? 80, height: layer.h ?? 72)
        let fontSize = min(rect.width, rect.height) * 1.15
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .bold),
            .foregroundColor: UIColor(hex: layer.color ?? "#D86D93").withAlphaComponent(layer.opacity ?? 1),
            .paragraphStyle: paragraph
        ]
        "♡".draw(in: rect, withAttributes: attributes)
    }

    private static func drawImage(_ layer: BoothLayer) {
        guard let source = layer.src, let image = image(from: source) else { return }
        let rect = CGRect(
            x: layer.x,
            y: layer.y,
            width: layer.w ?? image.size.width,
            height: layer.h ?? image.size.height
        )
        image.draw(in: rect, blendMode: .normal, alpha: layer.opacity ?? 1)
    }

    private static func image(from source: String) -> UIImage? {
        if FileManager.default.fileExists(atPath: source) {
            return UIImage(contentsOfFile: source)
        }

        let filename = URL(fileURLWithPath: source).lastPathComponent
        if let url = Bundle.main.url(
            forResource: filename,
            withExtension: nil,
            subdirectory: "TemplateAssets"
        ) {
            return UIImage(contentsOfFile: url.path)
        }

        return UIImage(named: filename)
    }

    private static func font(named name: String, size: CGFloat) -> UIFont {
        switch name {
        case "script":
            return UIFont(name: "SnellRoundhand-Bold", size: size) ?? UIFont(name: "Zapfino", size: size * 0.72) ?? .italicSystemFont(ofSize: size)
        case "handwritten":
            return UIFont(name: "BradleyHandITCTT-Bold", size: size) ?? .italicSystemFont(ofSize: size)
        case "elegant", "serif":
            return UIFont(name: "HoeflerText-Regular", size: size) ?? UIFont(name: "TimesNewRomanPSMT", size: size) ?? .serifFont(ofSize: size)
        default:
            return UIFont.systemFont(ofSize: size, weight: .regular)
        }
    }

    private static func placeholderPhoto(index: Int) -> UIImage {
        let size = CGSize(width: 1200, height: 800)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            UIColor(hex: "#F7C8D8").setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.withAlphaComponent(0.45).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: -140, y: -120, width: 520, height: 520))
            UIColor(hex: "#D86D93").withAlphaComponent(0.55).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 760, y: 430, width: 560, height: 560))
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            "PHOTO \(index)".draw(
                in: CGRect(x: 0, y: 345, width: size.width, height: 90),
                withAttributes: [
                    .font: UIFont.systemFont(ofSize: 62, weight: .bold),
                    .foregroundColor: UIColor.white,
                    .paragraphStyle: paragraph
                ]
            )
        }
    }

    private static func aspectFillRect(_ imageSize: CGSize, inside rect: CGRect) -> CGRect {
        let scale = max(rect.width / imageSize.width, rect.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height)
    }
}

private extension UIFont {
    static func serifFont(ofSize size: CGFloat) -> UIFont {
        UIFont(name: "HoeflerText-Regular", size: size) ?? UIFont(name: "TimesNewRomanPSMT", size: size) ?? .systemFont(ofSize: size)
    }
}
