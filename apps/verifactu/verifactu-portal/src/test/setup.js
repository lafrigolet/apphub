import '@testing-library/jest-dom'

// jsdom no implementa scrollIntoView (lo usan Receptor/Sidebar al navegar).
window.HTMLElement.prototype.scrollIntoView = () => {}
