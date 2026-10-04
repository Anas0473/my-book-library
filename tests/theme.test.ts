import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTheme } from '../src/lib/theme';

function luminance(hex: string) {
  return [1, 3, 5].reduce((sum, offset, index) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('custom palettes maintain readable text and distinct surfaces', () => {
  const colors = ['#ff0000', '#d52f2f', '#00e000', '#1c1c1c', '#ffffff', '#000000'];
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        colors.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
      }
    }
  }
  for (const background of colors) {
    const { variables } = createTheme(background);
    const surfaces = [background, variables['--panel'], variables['--fill'], variables['--fill-strong']];
    for (const text of ['--page-foreground', '--muted', '--faint', '--page-accent-text'] as const) {
      for (const surface of surfaces) {
        assert.ok(contrast(variables[text], surface) >= 4.5, `${background}: ${text} on ${surface}`);
      }
    }
    for (const surface of surfaces) {
      assert.ok(contrast(variables['--page-focus'], surface) >= 3);
    }
    assert.notEqual(variables['--panel'], variables['--fill']);
    assert.notEqual(variables['--fill'], variables['--fill-strong']);
  }
});

test('invalid colors are rejected', () => {
  assert.throws(() => createTheme('red'), /Invalid theme color/);
});
