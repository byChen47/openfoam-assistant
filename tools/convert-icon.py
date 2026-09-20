from pathlib import Path
from PIL import Image
import sys


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert-icon.py <source.ico> <target.png>")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    image = Image.open(source).convert("RGBA")

    canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    x = (canvas.width - image.width) // 2
    y = (canvas.height - image.height) // 2
    canvas.paste(image, (x, y), image)
    canvas.save(target, "PNG")


if __name__ == "__main__":
    main()