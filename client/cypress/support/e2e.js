// E2E support — custom commands and shared hooks.

beforeEach(() => {
  cy.clearAllCookies();
});

Cypress.Commands.add('enterValidUsername', () => {
  cy.get('[data-testid="session-username-input"]', { timeout: 120000 }).should('be.visible');
  cy.get('[data-testid="session-username-input"]').clear();
  cy.get('[data-testid="session-username-input"]').type('E2E Tester');
  cy.get('[data-testid="session-start-new"]').should('not.be.disabled');
});

Cypress.Commands.add('waitForScenarioList', () => {
  cy.get('[data-testid="scenario-option"]', { timeout: 120000 })
    .should('be.visible')
    .and(($els) => {
      expect($els.length, 'at least one scenario from server').to.be.greaterThan(0);
    });
});

Cypress.Commands.add('openScenarioPicker', () => {
  cy.enterValidUsername();
  cy.get('[data-testid="session-start-new"]').click();
  cy.contains('h2', 'Select scenario', { timeout: 60000 }).should('be.visible');
  cy.waitForScenarioList();
});

Cypress.Commands.add('initializeOperation', () => {
  cy.get('[data-testid="scenario-initialize"]').should('not.be.disabled');
  cy.get('[data-testid="scenario-initialize"]').click();
});

Cypress.Commands.add('expectInGame', () => {
  cy.get('[data-testid="session-start-new"]', { timeout: 120000 }).should('not.exist');
  cy.get('[data-testid="hamburger-menu"]').should('be.visible');
});

Cypress.Commands.add('stopGameFromMenu', () => {
  cy.get('[data-testid="hamburger-menu"]').click();
  cy.get('[data-testid="menu-stop-game"]').click();
});

Cypress.Commands.add('expectSessionGate', () => {
  cy.get('[data-testid="session-start-new"]', { timeout: 120000 }).should('be.visible');
});
