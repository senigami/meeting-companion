import { applyViewerSettings } from './view.js';

export function saveViewerSettings(ctx) {
  applyViewerSettings(ctx);
  localStorage.setItem('fontSize', String(ctx.state.fontSize));
  localStorage.setItem('displayMargin', String(ctx.state.displayMargin));
}
