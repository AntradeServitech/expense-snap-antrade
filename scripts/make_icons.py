"""Genera los iconos PNG de la PWA a partir del isotipo real de Antrade
(recortado de PresentationMaker/assets/slide1_antrade-logotipo-blanco-horizontal.png.png),
compuesto sobre el navy corporativo."""
from PIL import Image

NAVY = (46, 58, 71, 255)
MARK_PATH = 'scripts/antrade-mark.png'


def make_icon(size: int, maskable: bool, path: str):
    bg = Image.new('RGBA', (size, size), NAVY)
    mark = Image.open(MARK_PATH).convert('RGBA')

    pad_ratio = 0.30 if maskable else 0.18
    target_w = int(size * (1 - 2 * pad_ratio))
    scale = target_w / mark.width
    target_h = int(mark.height * scale)
    mark = mark.resize((target_w, target_h), Image.LANCZOS)

    x = (size - target_w) // 2
    y = (size - target_h) // 2
    bg.alpha_composite(mark, (x, y))
    bg.save(path)
    print('OK', path)


if __name__ == '__main__':
    base = 'public/icons'
    make_icon(192, False, f'{base}/icon-192.png')
    make_icon(512, False, f'{base}/icon-512.png')
    make_icon(512, True, f'{base}/icon-maskable-512.png')
