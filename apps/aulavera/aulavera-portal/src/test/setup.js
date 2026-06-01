import '@testing-library/jest-dom'

// jsdom no implementa estas APIs que algunas vistas usan al navegar/scroll.
window.HTMLElement.prototype.scrollIntoView = () => {}
window.scrollTo = () => {}
