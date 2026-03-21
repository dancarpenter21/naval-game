/**
 * Session gate / modal navigation (no full game lifecycle).
 */
describe('Session modal', () => {
  it('shows gate heading and disables actions until username is valid', () => {
    cy.visit('/');
    cy.contains('h2', 'Naval Game', { timeout: 120000 });
    cy.get('[data-testid="session-username-input"]').should('be.visible').clear();
    cy.get('[data-testid="session-start-new"]').should('be.disabled');
    cy.get('[data-testid="session-join"]').should('be.disabled');
    cy.get('[data-testid="session-username-input"]').type('AB');
    cy.get('[data-testid="session-start-new"]').should('not.be.disabled');
    cy.get('[data-testid="session-join"]').should('not.be.disabled');
  });

  it('navigates Start new → scenario list → back → Join → back', () => {
    cy.visit('/');
    cy.enterValidUsername();
    cy.get('[data-testid="session-start-new"]').click();
    cy.contains('h2', 'Select scenario').should('be.visible');
    cy.waitForScenarioList();
    cy.get('[data-testid="scenario-session-name-input"]').should('be.visible');
    cy.get('[data-testid="session-back-from-scenario"]').click();
    cy.contains('h2', 'Naval Game').should('be.visible');

    cy.get('[data-testid="session-join"]').click();
    cy.contains('h2', 'Ongoing Sessions').should('be.visible');
    cy.get('[data-testid="session-back-from-join"]').click();
    cy.contains('h2', 'Naval Game').should('be.visible');
  });

  it('exposes help link with expected rel', () => {
    cy.visit('/');
    cy.get('[data-testid="session-help-link"]')
      .should('have.attr', 'target', '_blank')
      .and('have.attr', 'rel', 'noopener noreferrer');
  });
});
