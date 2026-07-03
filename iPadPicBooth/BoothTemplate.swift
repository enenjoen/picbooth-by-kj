import Foundation
import UIKit

struct BoothTemplate: Identifiable, Codable, Hashable {
    var id: String
    var name: String
    var background: String
    var width: CGFloat = 1800
    var height: CGFloat = 1200
    var layers: [BoothLayer]

    var photoCount: Int {
        max(1, (layers.compactMap { $0.type == .photo ? ($0.photoIndex ?? 0) + 1 : nil }.max() ?? 0))
    }

    static let builtIn: [BoothTemplate] = {
        guard let url = Bundle.main.url(
            forResource: "templates",
            withExtension: "json",
            subdirectory: "TemplateAssets"
        ),
        let data = try? Data(contentsOf: url),
        let templates = try? JSONDecoder().decode([BoothTemplate].self, from: data),
        !templates.isEmpty else {
            return fallbackBuiltIn
        }
        return templates
    }()

    private static let fallbackBuiltIn: [BoothTemplate] = [
        BoothTemplate(
            id: "classic",
            name: "粉色爱语",
            background: "#FFF2F6",
            layers: [
                .photo(id: "photo-1", index: 0, x: 55, y: 55, width: 1280, height: 1090, radius: 0, border: "#FFFFFF", borderWidth: 12),
                .text(id: "title", value: "{event}", x: 1564, y: 197, size: 80, color: "#9F4F6B", align: "center", font: "script"),
                .text(id: "message", value: "{text}", x: 1560, y: 610, size: 34, color: "#A9687E", align: "center", font: "handwritten"),
                .text(id: "date", value: "{date}", x: 1560, y: 1050, size: 34, color: "#BA7890", align: "center", font: "elegant"),
                .heart(id: "heart", x: 1535, y: 1100, width: 50, height: 45, color: "#D86D93")
            ]
        ),
        BoothTemplate(
            id: "editorial",
            name: "玫瑰杂志",
            background: "#8E3F5C",
            layers: [
                .text(id: "kicker", value: "CELEBRATE THE MOMENT", x: 80, y: 105, size: 28, color: "#F2C5D4", align: "left", font: "elegant"),
                .text(id: "title", value: "{event}", x: 80, y: 240, size: 82, color: "#FFF7FA", align: "left", font: "script"),
                .text(id: "message", value: "{text}", x: 80, y: 440, size: 34, color: "#F4D7E1", align: "left", font: "handwritten"),
                .text(id: "date", value: "{date}", x: 80, y: 1040, size: 34, color: "#F2C5D4", align: "left", font: "elegant"),
                .photo(id: "photo-1", index: 0, x: 590, y: 55, width: 1155, height: 1090, radius: 18, border: "#FFDCE8", borderWidth: 6)
            ]
        ),
        BoothTemplate(
            id: "triple",
            name: "甜心三连拍",
            background: "#FFF7FA",
            layers: [
                .photo(id: "photo-1", index: 0, x: 45, y: 45, width: 540, height: 865, radius: 25),
                .photo(id: "photo-2", index: 1, x: 630, y: 45, width: 540, height: 865, radius: 25),
                .photo(id: "photo-3", index: 2, x: 1215, y: 45, width: 540, height: 865, radius: 25),
                .text(id: "title", value: "{event}", x: 900, y: 1000, size: 68, color: "#A64F6C", align: "center", font: "script"),
                .text(id: "date", value: "{date}", x: 900, y: 1110, size: 32, color: "#D36F92", align: "center", font: "elegant")
            ]
        ),
        BoothTemplate(
            id: "four-grid",
            name: "爱心四格",
            background: "#F8DFE8",
            layers: [
                .photo(id: "photo-1", index: 0, x: 40, y: 40, width: 700, height: 520, radius: 24),
                .photo(id: "photo-2", index: 1, x: 780, y: 40, width: 700, height: 520, radius: 24),
                .photo(id: "photo-3", index: 2, x: 40, y: 600, width: 700, height: 520, radius: 24),
                .photo(id: "photo-4", index: 3, x: 780, y: 600, width: 700, height: 520, radius: 24),
                .heart(id: "heart", x: 1565, y: 95, width: 140, height: 125, color: "#B95778", opacity: 0.9),
                .text(id: "title", value: "{event}", x: 1630, y: 490, size: 38, color: "#97455F", align: "center", font: "script"),
                .text(id: "date", value: "{date}", x: 1630, y: 1010, size: 30, color: "#A95872", align: "center", font: "elegant")
            ]
        )
    ]
}

struct BoothLayer: Identifiable, Codable, Hashable {
    enum LayerType: String, Codable { case photo, text, image, heart }

    var id: String
    var type: LayerType
    var photoIndex: Int?
    var x: CGFloat
    var y: CGFloat
    var w: CGFloat?
    var h: CGFloat?
    var radius: CGFloat?
    var borderColor: String?
    var borderWidth: CGFloat?
    var text: String?
    var fontSize: CGFloat?
    var color: String?
    var align: String?
    var font: String?
    var src: String?
    var opacity: CGFloat?

    static func photo(
        id: String,
        index: Int,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat,
        radius: CGFloat,
        border: String = "#FFFFFF",
        borderWidth: CGFloat = 8
    ) -> BoothLayer {
        BoothLayer(id: id, type: .photo, photoIndex: index, x: x, y: y, w: width, h: height,
                   radius: radius, borderColor: border, borderWidth: borderWidth)
    }

    static func text(
        id: String,
        value: String,
        x: CGFloat,
        y: CGFloat,
        size: CGFloat,
        color: String,
        align: String = "center",
        font: String = "sans"
    ) -> BoothLayer {
        BoothLayer(id: id, type: .text, x: x, y: y, text: value, fontSize: size,
                   color: color, align: align, font: font)
    }

    static func heart(
        id: String,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat,
        color: String,
        opacity: CGFloat = 1
    ) -> BoothLayer {
        BoothLayer(id: id, type: .heart, x: x, y: y, w: width, h: height, color: color, opacity: opacity)
    }
}

extension UIColor {
    convenience init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let red = CGFloat((value >> 16) & 0xFF) / 255
        let green = CGFloat((value >> 8) & 0xFF) / 255
        let blue = CGFloat(value & 0xFF) / 255
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}
