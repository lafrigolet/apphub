import '@testing-library/jest-dom'

window.HTMLElement.prototype.scrollIntoView = () => {}
window.scrollTo = () => {}
