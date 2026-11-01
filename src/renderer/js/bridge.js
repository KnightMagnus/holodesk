// The preload exposes window.holodesk inside the app. In a plain browser (design
// previews, screenshots) a mock with sample data stands in. The mock is not
// shipped in packaged builds.
export const api = window.holodesk ?? (await import('./dev/mock-bridge.js')).createMockBridge();
export const isMock = !window.holodesk;
