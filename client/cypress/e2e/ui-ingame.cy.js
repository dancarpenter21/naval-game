/**
 * In-game UI: main tabs and session panel (requires an active session).
 */
describe('In-game UI buttons', () => {
  it('covers main tabs, hamburger menu, and session chat panel', () => {
    cy.visit('/');
    cy.openScenarioPicker();
    cy.initializeOperation();
    cy.expectInGame();

    cy.get('[data-testid="tab-map"]').click();
    cy.get('[data-testid="tab-sync-matrix"]').click();
    cy.get('[data-testid="tab-system-view"]').click();
    cy.get('[data-testid="tab-plan-comparison"]').click();
    cy.get('[data-testid="tab-map"]').click();

    cy.get('[data-testid="hamburger-menu"]').click();
    cy.get('[data-testid="menu-stop-game"]').should('be.visible');
    cy.get('[data-testid="menu-leave-game"]').should('be.visible');
    cy.get('[data-testid="menu-backdrop"]').click({ force: true });

    cy.get('[data-testid="chat-tab-players"]').click();
    cy.get('[data-testid="chat-tab-chat"]').click();
    cy.get('[data-testid="chat-send"]').should('be.disabled');
    cy.get('[data-testid="chat-message-input"]').type('hello e2e');
    cy.get('[data-testid="chat-send"]').should('not.be.disabled');
    cy.get('[data-testid="chat-panel-minimize"]').click();
    cy.get('[data-testid="chat-panel-expand"]').click();
  });
});
