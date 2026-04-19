"""Generate VaultExport Chrome extension icons (16, 48, 128px PNGs)."""
import struct
import zlib
import math

def make_png(size):
    """Create a minimal valid PNG file with the VaultExport logo."""
    # Draw pixels: dark background with a purple download arrow
    pixels = []
    cx, cy = size / 2, size / 2

    for y in range(size):
        row = []
        for x in range(size):
            # Normalized coords
            nx = (x - cx) / (size / 2)
            ny = (y - cy) / (size / 2)

            # Background gradient (#0f0f17 → #1a0a2e)
            bg = [15, 15, 23, 255]

            # Rounded rect background
            r = 0.78
            corner = 0.22
            in_rect = (abs(nx) < r and abs(ny) < r)
            # Simple round corner check
            if abs(nx) > r - corner and abs(ny) > r - corner:
                dx = abs(nx) - (r - corner)
                dy = abs(ny) - (r - corner)
                in_rect = math.sqrt(dx*dx + dy*dy) < corner

            if in_rect:
                # Purple tint for background
                bg = [20, 10, 40, 255]

            # Draw a download arrow (↓ with a horizontal bar at bottom)
            t = 2.0 / size  # 1 pixel thickness in normalized coords

            # Vertical stem of arrow: x center, from top to 0.1
            stem_w = 0.12
            stem_top = -0.55
            stem_bot = 0.10

            # Arrow head: triangle pointing down, centered at (0, 0.10)
            # Arrowhead from y=0.10 to y=0.45, width from -0.30 to +0.30
            ah_top = 0.05
            ah_bot = 0.48
            ah_w_at_y = lambda yy: 0.35 * (yy - ah_top) / (ah_bot - ah_top)

            # Base bar: horizontal line at bottom, y=0.52
            bar_y = 0.55
            bar_h = 0.10
            bar_w = 0.58

            is_stem = (abs(nx) < stem_w and stem_top < ny < ah_top)
            is_head = (ah_top < ny < ah_bot and abs(nx) < ah_w_at_y(ny))
            is_bar  = (bar_y - bar_h/2 < ny < bar_y + bar_h/2 and abs(nx) < bar_w)

            if (is_stem or is_head or is_bar) and in_rect:
                # Purple arrow (#a78bfa → #7c3aed)
                t_blend = 0.5 + 0.5 * ny
                r_ch = int(167 - 45 * t_blend)
                g_ch = int(139 - 103 * t_blend)
                b_ch = int(250 - 27 * t_blend)
                row.extend([r_ch, g_ch, b_ch, 255])
            else:
                row.extend(bg)
        pixels.append(row)

    # Build PNG
    def write_chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    ihdr = write_chunk(b'IHDR', ihdr_data)

    # IDAT: raw pixel data with filter byte 0 per scanline
    raw = b''
    for row in pixels:
        raw += b'\x00' + bytes(row)
    compressed = zlib.compress(raw, 9)
    idat = write_chunk(b'IDAT', compressed)

    # IEND
    iend = write_chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


if __name__ == '__main__':
    import os
    out_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(out_dir, exist_ok=True)

    for size in [16, 48, 128]:
        path = os.path.join(out_dir, f'icon{size}.png')
        png_data = make_png(size)
        with open(path, 'wb') as f:
            f.write(png_data)
        print(f'Generated {path} ({len(png_data)} bytes)')

    print('Icons generated successfully.')
