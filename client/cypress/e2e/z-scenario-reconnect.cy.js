/**
 * Regression: after stop_session (socket reconnect), scenario list must load again
 * when opening "Start a New Session" a second time.
 */
describe('Scenario list after stop game', () => {
  it('populates scenarios on second cycle (create → stop → pick scenario again)', () => {
    cy.visit('/');
    cy.openScenarioPicker();
    cy.initializeOperation();
    cy.expectInGame();

    cy.stopGameFromMenu();
    cy.expectSessionGate();

    // Second cycle — previously failed with perpetual "Loading scenarios…"
    cy.get('[data-testid="session-start-new"]').click();
    cy.contains('h2', 'Select scenario', { timeout: 60000 }).should('be.visible');
    cy.waitForScenarioList();
    cy.get('[data-testid="scenario-initialize"]').should('not.be.disabled');
  });
});
