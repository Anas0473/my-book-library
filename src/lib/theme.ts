type RGB = readonly [number, number, number];

function rgb(hex: string): RGB {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid theme color: ${hex}`);
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function hex(color: RGB) {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mix(first: RGB, second: RGB, weight: number): RGB {
  return [
    Math.round(first[0] + (second[0] - first[0]) * weight),
    Math.round(first[1] + (second[1] - first[1]) * weight),
    Math.round(first[2] + (second[2] - first[2]) * weight),
  ];
}

function luminance(color: RGB) {
  return color.reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(first: RGB, second: RGB) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableColor(preferred: RGB, foreground: RGB, surfaces: RGB[], ratio: number) {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(preferred, foreground, step / 100);
    if (surfaces.every((surface) => contrast(candidate, surface) >= ratio)) return hex(candidate);
  }
  return hex(foreground);
}

export function createTheme(background: string) {
  const base = rgb(background);
  const black: RGB = [0, 0, 0];
  const white: RGB = [255, 255, 255];
  const dark = contrast(white, base) > contrast(black, base);
  const foreground = dark ? white : black;
  const neutral = dark ? rgb('#34363b') : rgb('#e3e6eb');
  const panel = mix(base, neutral, 0.22);
  const fill = mix(base, neutral, 0.42);
  const selected = mix(base, neutral, 0.64);
  const surfaces = [base, panel, fill, selected];
  return {
    colorScheme: dark ? 'dark' : 'light',
    variables: {
      '--page-foreground': hex(foreground),
      '--muted': readableColor(mix(base, foreground, 0.64), foreground, surfaces, 4.5),
      '--faint': readableColor(mix(base, foreground, 0.44), foreground, surfaces, 4.5),
      '--line': hex(mix(base, foreground, 0.3)),
      '--panel': hex(panel),
      '--fill': hex(fill),
      '--fill-strong': hex(selected),
      '--page-accent-text': readableColor(rgb('#f3b94d'), foreground, surfaces, 4.5),
      '--page-focus': readableColor(rgb('#f3b94d'), foreground, surfaces, 3),
    },
  };
}
