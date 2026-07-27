/**
 * Everyday Summariser — Shared Retro Theme Module
 * 
 * Manages dark/light theme switching across all extension surfaces.
 * Uses a retro 8-bit pixel art aesthetic with NES-inspired palettes.
 */

const THEME_STORAGE_KEY = 'es_theme';

// NES-inspired color palettes
const THEMES = {
  dark: {
    '--bg-primary': '#0f0f23',
    '--bg-secondary': '#1a1a2e',
    '--bg-card': '#16213e',
    '--bg-card-hover': '#1c2a4a',
    '--bg-input': '#0a0a1a',
    '--border-primary': '#3a3a5c',
    '--border-accent': '#7c3aed',
    '--border-pixel': '#4a4a6a',
    '--text-primary': '#e0e0ff',
    '--text-secondary': '#8888aa',
    '--text-muted': '#5a5a7a',
    '--accent-primary': '#7c3aed',
    '--accent-secondary': '#00d4aa',
    '--accent-warning': '#ffaa00',
    '--accent-danger': '#ff4444',
    '--accent-success': '#00ff88',
    '--accent-info': '#00aaff',
    '--pixel-green': '#00ff88',
    '--pixel-cyan': '#00d4ff',
    '--pixel-magenta': '#ff44aa',
    '--pixel-yellow': '#ffdd00',
    '--pixel-orange': '#ff8800',
    '--scanline-opacity': '0.03',
    '--glow-color': 'rgba(124, 58, 237, 0.3)',
  },
  light: {
    '--bg-primary': '#f0f0e8',
    '--bg-secondary': '#e8e8d8',
    '--bg-card': '#ffffff',
    '--bg-card-hover': '#f8f8f0',
    '--bg-input': '#ffffff',
    '--border-primary': '#c0c0a8',
    '--border-accent': '#6b21a8',
    '--border-pixel': '#a0a088',
    '--text-primary': '#1a1a2e',
    '--text-secondary': '#4a4a6a',
    '--text-muted': '#8888aa',
    '--accent-primary': '#6b21a8',
    '--accent-secondary': '#008866',
    '--accent-warning': '#cc8800',
    '--accent-danger': '#cc2222',
    '--accent-success': '#008844',
    '--accent-info': '#0066cc',
    '--pixel-green': '#008844',
    '--pixel-cyan': '#006688',
    '--pixel-magenta': '#cc2288',
    '--pixel-yellow': '#aa8800',
    '--pixel-orange': '#cc6600',
    '--scanline-opacity': '0.01',
    '--glow-color': 'rgba(107, 33, 168, 0.15)',
  }
};

/**
 * Apply the given theme to the document root.
 */
function applyTheme(themeName) {
  const theme = THEMES[themeName] || THEMES.dark;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme)) {
    root.style.setProperty(prop, value);
  }
  document.body.setAttribute('data-theme', themeName);
}

/**
 * Load and apply the saved theme (or default to dark).
 */
function initTheme() {
  chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
    const theme = result[THEME_STORAGE_KEY] || 'dark';
    applyTheme(theme);
  });
}

/**
 * Toggle between dark and light themes.
 * Returns the new theme name.
 */
function toggleTheme() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
      const current = result[THEME_STORAGE_KEY] || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      chrome.storage.sync.set({ [THEME_STORAGE_KEY]: next }, () => {
        applyTheme(next);
        resolve(next);
      });
    });
  });
}

/**
 * Get the current theme name.
 */
function getCurrentTheme() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
      resolve(result[THEME_STORAGE_KEY] || 'dark');
    });
  });
}
