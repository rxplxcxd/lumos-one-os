// Third-party controller knowledge shared by the input system, hints and settings.
const VENDORS = {
  '045e': 'xbox', // Microsoft
  '054c': 'playstation', // Sony
  '057e': 'nintendo', // Nintendo
  '2dc8': 'nintendo', // 8BitDo (Nintendo-style labels on most models)
  '0f0d': 'nintendo', // Hori (mostly Switch-licensed)
  '0e6f': 'xbox', // PDP
  '24c6': 'xbox', // PowerA
  '046d': 'xbox', // Logitech F310/F710
  '1532': 'xbox', // Razer
  '0738': 'xbox', // Mad Catz
  '28de': 'xbox', // Valve (Steam Controller / Deck)
  '3537': 'xbox', // GameSir
  '20d6': 'nintendo', // PowerA (Switch)
  '0079': 'generic', // DragonRise
  '0810': 'playstation', // generic PS-style USB pads
};

export function vendorOf(id = '') {
  const m = /Vendor:\s*([0-9a-f]{4})/i.exec(id) || /([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id);
  return m ? m[1].toLowerCase() : null;
}

/** 'xbox' | 'playstation' | 'nintendo' | 'lumos' | 'generic' from a Gamepad.id or device name */
export function padFamily(id = '') {
  const s = id.toLowerCase();
  if (/lumos/.test(s)) return 'lumos';
  const byVendor = VENDORS[vendorOf(id)];
  if (byVendor && byVendor !== 'generic') return byVendor; // the USB vendor id is the most reliable signal
  if (/xbox|x-box|xinput|microsoft/.test(s)) return 'xbox';
  if (/pro controller|joy-con|nintendo|switch|8bitdo|hori/.test(s)) return 'nintendo';
  if (/dualsense|dualshock|playstation|ps[345]|^wireless controller/.test(s)) return 'playstation';
  return byVendor || 'generic';
}

export const FAMILY_LABEL = { xbox: 'Xbox-Layout', playstation: 'PlayStation-Layout', nintendo: 'Nintendo-Layout', lumos: 'Lumos Joy', generic: 'Generischer Controller' };

// Labels of the physical button at each *position* (a = bottom, b = right, x = left, y = top)
const GLYPHS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: '≡', select: '⧉', home: '◉' },
  lumos: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', start: '+', select: '−', home: '◉' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: '≡', select: '⧉', home: 'PS' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', start: '+', select: '−', home: '⌂' },
  generic: { a: '1', b: '2', x: '3', y: '4', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Start', select: 'Select', home: '◉' },
};

export function glyphFor(action, family = 'lumos') {
  return (GLYPHS[family] || GLYPHS.lumos)[action] || action;
}
