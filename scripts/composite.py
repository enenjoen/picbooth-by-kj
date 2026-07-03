#!/usr/bin/env python3
import argparse
import json
import math
import os
from datetime import datetime
from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps

SIZE = (1800, 1200)

def font(size, family="sans"):
    families = {
        "script": [
            "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc",
            "/System/Library/Fonts/Supplemental/Apple Chancery.ttf",
        ],
        "elegant": [
            "/System/Library/Fonts/Supplemental/Didot.ttc",
            "/System/Library/Fonts/Supplemental/Baskerville.ttc",
        ],
        "handwritten": [
            "/System/Library/Fonts/Supplemental/Songti.ttc",
            "/System/Library/Fonts/Noteworthy.ttc",
        ],
        "display": [
            "/System/Library/Fonts/Supplemental/Zapfino.ttf",
            "/System/Library/Fonts/Supplemental/Didot.ttc",
        ],
        "serif": [
            "/System/Library/Fonts/Supplemental/Baskerville.ttc",
            "/System/Library/Fonts/Supplemental/Songti.ttc",
        ],
        "sans": [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/Helvetica.ttc",
        ],
    }
    candidates = families.get(family, families["sans"]) + families["sans"]
    for candidate in candidates:
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                pass
    return ImageFont.load_default()

def cover(image, size):
    return ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

def rounded_photo(photo, layer):
    size = (max(1, int(layer["w"])), max(1, int(layer["h"])))
    border = max(0, int(layer.get("borderWidth", 0)))
    radius = max(0, int(layer.get("radius", 0)))
    result = Image.new("RGBA", size, layer.get("borderColor", "#ffffff"))
    inner_size = (max(1, size[0] - border * 2), max(1, size[1] - border * 2))
    fitted = cover(photo, inner_size).convert("RGBA")
    result.alpha_composite(fitted, (border, border))
    if radius:
        mask = Image.new("L", size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
        result.putalpha(mask)
    return result

def token_text(value, args):
    return (value or "").replace("{event}", args.event).replace("{date}", args.date).replace("{text}", args.text)

def heart_layer(layer):
    width = max(1, int(layer.get("w", 120)))
    height = max(1, int(layer.get("h", 110)))
    opacity = max(0, min(1, float(layer.get("opacity", 1))))
    color = ImageColor.getrgb(layer.get("color", "#dc789d")) + (int(255 * opacity),)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    points = []
    for step in range(181):
        t = math.pi * 2 * step / 180
        px = 16 * math.sin(t) ** 3
        py = 13 * math.cos(t) - 5 * math.cos(2*t) - 2 * math.cos(3*t) - math.cos(4*t)
        points.append((width * (.5 + px / 34), height * (.53 - py / 34)))
    ImageDraw.Draw(image).polygon(points, fill=color)
    return image

def compose_design(args, photos, design):
    design_size = (
        max(1, int(design.get("width", SIZE[0]))),
        max(1, int(design.get("height", SIZE[1])))
    )
    image = Image.new("RGBA", design_size, design.get("background", "#ffffff"))
    for layer in design.get("layers", []):
        kind = layer.get("type")
        if kind == "photo" and photos:
            index = min(max(0, int(layer.get("photoIndex", 0))), len(photos) - 1)
            rendered = rounded_photo(photos[index], layer)
            image.alpha_composite(rendered, (int(layer.get("x", 0)), int(layer.get("y", 0))))
        elif kind == "image":
            src = layer.get("src", "")
            if src.startswith("/data/"):
                data_root = os.path.dirname(os.path.dirname(os.path.dirname(args.output)))
                src = os.path.join(data_root, src[6:])
            if src and os.path.exists(src):
                item = Image.open(src).convert("RGBA")
                item = item.resize((int(layer.get("w", item.width)), int(layer.get("h", item.height))), Image.Resampling.LANCZOS)
                if "opacity" in layer:
                    alpha = item.getchannel("A").point(lambda p: int(p * float(layer["opacity"])))
                    item.putalpha(alpha)
                image.alpha_composite(item, (int(layer.get("x", 0)), int(layer.get("y", 0))))
        elif kind == "heart":
            item = heart_layer(layer)
            image.alpha_composite(item, (int(layer.get("x", 0)), int(layer.get("y", 0))))
        elif kind == "text":
            draw = ImageDraw.Draw(image)
            alignment = layer.get("align", "center")
            anchor = {"left": "lm", "center": "mm", "right": "rm"}.get(alignment, "mm")
            text_font = font(int(layer.get("fontSize", 42)), layer.get("font", "sans"))
            draw.multiline_text(
                (int(layer.get("x", design_size[0] // 2)), int(layer.get("y", design_size[1] // 2))),
                token_text(layer.get("text", ""), args),
                anchor=anchor,
                font=text_font,
                fill=layer.get("color", "#333333"),
                spacing=max(4, int(layer.get("fontSize", 42) * .25)),
                align=alignment
            )
    return image

def demo_photo(path):
    image = Image.new("RGB", SIZE, "#e9ded4")
    draw = ImageDraw.Draw(image)
    for y in range(SIZE[1]):
        t = y / SIZE[1]
        color = (int(242 - 35*t), int(226 - 20*t), int(216 + 12*t))
        draw.line((0, y, SIZE[0], y), fill=color)
    draw.ellipse((650, 210, 1150, 710), fill="#e7a8bd")
    draw.text((SIZE[0]//2, 830), "PHOTO BOOTH", anchor="mm", font=font(82, "elegant"), fill="#934e67")
    draw.text((SIZE[0]//2, 940), "♡  测试照片  ♡", anchor="mm", font=font(48, "handwritten"), fill="#b86481")
    image.save(path, quality=94, subsampling=0)

def layout(photos):
    canvas = Image.new("RGB", SIZE, "white")
    if len(photos) <= 1:
        return cover(photos[0], SIZE)
    margin, gap = 50, 24
    if len(photos) == 3:
        cell = ((SIZE[0] - margin*2 - gap*2)//3, SIZE[1] - margin*2)
        for index, photo in enumerate(photos):
            canvas.paste(cover(photo, cell), (margin + index*(cell[0]+gap), margin))
    else:
        cell = ((SIZE[0] - margin*2-gap)//2, (SIZE[1] - margin*2-gap)//2)
        for index, photo in enumerate(photos[:4]):
            x = margin + (index % 2)*(cell[0]+gap)
            y = margin + (index // 2)*(cell[1]+gap)
            canvas.paste(cover(photo, cell), (x, y))
    return canvas

def compose(args):
    photos = [Image.open(item) for item in args.photo]
    if not photos:
        raise ValueError("没有可合成的照片")
    if args.design:
        image = compose_design(args, photos, json.loads(args.design))
    else:
        image = layout(photos).convert("RGBA")
    if not args.design and args.template and os.path.exists(args.template):
        overlay = Image.open(args.template).convert("RGBA").resize(SIZE, Image.Resampling.LANCZOS)
        image = Image.alpha_composite(image, overlay)
    draw = ImageDraw.Draw(image)
    if not args.design and (args.event or args.text or args.date):
        panel_top = 900
        draw.rounded_rectangle((90, panel_top, 1710, 1160), radius=34, fill=(255, 255, 255, 218))
        if args.event:
            draw.text((900, 955), args.event, anchor="mm", font=font(56, "script"), fill="#3f342f")
        if args.text:
            draw.text((900, 1040), args.text, anchor="mm", font=font(34, "handwritten"), fill="#5d4d46")
        if args.date:
            draw.text((900, 1110), args.date, anchor="mm", font=font(30, "elegant"), fill="#8a6f63")
    image.convert("RGB").save(args.output, quality=96, subsampling=0, dpi=(300, 300))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--photo", action="append", default=[])
    parser.add_argument("--output")
    parser.add_argument("--template", default="")
    parser.add_argument("--design", default="")
    parser.add_argument("--event", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--text", default="")
    parser.add_argument("--demo-photo")
    args = parser.parse_args()
    if args.demo_photo:
        demo_photo(args.demo_photo)
    else:
        compose(args)
