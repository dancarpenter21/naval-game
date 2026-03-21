describe('Naval Game smoke', () => {
  it('shows the session gate with username', () => {
    cy.visit('/');
    cy.contains('h2', 'Naval Game', { timeout: 120000 });
    cy.contains('label', 'Username');
  });
});
