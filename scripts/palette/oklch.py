import math

def _srgb(c):
    return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4)) - 0.055

def _lin(c):
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4

def oklch_to_hex(L, C, h):
    a = C*math.cos(math.radians(h)); b = C*math.sin(math.radians(h))
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    out = []
    for v in (r, g, bb):
        v = _srgb(v)
        out.append(max(0, min(255, round(v*255))))
    return "#{:02X}{:02X}{:02X}".format(*out)

def hex_to_oklch(hx):
    hx = hx.lstrip('#')
    r, g, b = (_lin(int(hx[i:i+2],16)/255) for i in (0,2,4))
    l = (0.4122214708*r + 0.5363325363*g + 0.0514459929*b)**(1/3)
    m = (0.2119034982*r + 0.6806995451*g + 0.1073969566*b)**(1/3)
    s = (0.0883024619*r + 0.2817188376*g + 0.6299787005*b)**(1/3)
    L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s
    A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s
    B = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
    C = math.hypot(A, B); h = math.degrees(math.atan2(B, A)) % 360
    return L, C, h

def rel_lum(hx):
    hx = hx.lstrip('#')
    r, g, b = (_lin(int(hx[i:i+2],16)/255) for i in (0,2,4))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(f, b):
    a, c = rel_lum(f), rel_lum(b)
    hi, lo = max(a,c), min(a,c)
    return (hi+0.05)/(lo+0.05)
