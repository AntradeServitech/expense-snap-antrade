"""Genera un ticket de prueba sintético para probar el pipeline sin un ticket real."""
from PIL import Image, ImageDraw, ImageFont

img = Image.new('RGB', (600, 800), 'white')
draw = ImageDraw.Draw(img)

try:
    font_big = ImageFont.truetype('arial.ttf', 28)
    font = ImageFont.truetype('arial.ttf', 20)
except Exception:
    font_big = ImageFont.load_default()
    font = ImageFont.load_default()

lines = [
    ('Restaurante La Marina', font_big),
    ('CIF B12345678', font),
    ('Calle Mayor 10, Vigo', font),
    ('', font),
    ('Fecha: 20/06/2026', font),
    ('Ticket #00231', font),
    ('', font),
    ('1x Menu del dia        12,50', font),
    ('1x Cafe                 1,50', font),
    ('1x Agua                 2,00', font),
    ('', font),
    ('TOTAL:           16,00 EUR', font_big),
    ('', font),
    ('Gracias por su visita', font),
]

y = 40
for text, f in lines:
    draw.text((40, y), text, fill='black', font=f)
    y += 36

img.save('test-assets/sample-receipt.jpg', quality=90)
print('OK test-assets/sample-receipt.jpg')
