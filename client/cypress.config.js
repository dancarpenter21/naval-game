/**
 * Cypress config — used by `cypress/included` in Docker (no local Cypress install required).
 * Must be ESM: client package.json has "type": "module".
 * @type {import('cypress').Config}
 */
export default {
  e2e: {
    baseUrl: process.env.CYPRESS_baseUrl || 'http://localhost:8080',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'cypress/e2e/**/*.cy.js',
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 20000,
  },
};
