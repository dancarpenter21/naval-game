/**
 * Chat: parseLeadingChatCommand (same module as the UI via cy.task) + in-game white-cell host e2e.
 * Session host from create_session is always white cell (see server).
 */

const parse = (text, playerTeam, defaultChannel = 'all') =>
  cy.task('chatParseLeading', { text, playerTeam, defaultChannel });

describe('parseLeadingChatCommand (shared with app)', () => {
  it('plain text: no channel change, emits full body', () => {
    parse('hello world', 'white', 'team').then((r) => {
      expect(r.channel).to.be.null;
      expect(r.scope).to.eq('team');
      expect(r.body).to.eq('hello world');
      expect(r.emitMessage).to.be.true;
    });
  });

  it('does not treat /alliance as /all', () => {
    parse('/alliance pact', 'red', 'all').then((r) => {
      expect(r.channel).to.be.null;
      expect(r.body).to.eq('/alliance pact');
      expect(r.emitMessage).to.be.true;
    });
  });

  describe('/all', () => {
    it('command only: all channel, no emit', () => {
      parse('/all', 'white', 'team').then((r) => {
        expect(r.channel).to.eq('all');
        expect(r.scope).to.eq('all');
        expect(r.body).to.eq('');
        expect(r.emitMessage).to.be.false;
      });
    });

    it('with message strips prefix', () => {
      parse('/all everyone', 'blue', 'team').then((r) => {
        expect(r.channel).to.eq('all');
        expect(r.scope).to.eq('all');
        expect(r.body).to.eq('everyone');
        expect(r.emitMessage).to.be.true;
      });
    });
  });

  describe('/team and team color aliases', () => {
    it('/team only: team channel, no emit', () => {
      parse('/team', 'red', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.scope).to.eq('team');
        expect(r.emitMessage).to.be.false;
      });
    });

    it('/team with message', () => {
      parse('/team hi', 'red', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.body).to.eq('hi');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('red: /red is team alias', () => {
      parse('/red', 'red', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.emitMessage).to.be.false;
      });
      parse('/red msg', 'red', 'all').then((r) => {
        expect(r.body).to.eq('msg');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('blue: /blue is team alias', () => {
      parse('/blue', 'blue', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.emitMessage).to.be.false;
      });
      parse('/blue x', 'blue', 'all').then((r) => {
        expect(r.body).to.eq('x');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('white: /white is team alias (not coordination)', () => {
      parse('/white', 'white', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.emitMessage).to.be.false;
      });
      parse('/white y', 'white', 'all').then((r) => {
        expect(r.body).to.eq('y');
        expect(r.emitMessage).to.be.true;
      });
    });
  });

  describe('white cell coordination (white + /red or /blue)', () => {
    it('white: /red coordination, not team alias', () => {
      parse('/red', 'white', 'all').then((r) => {
        expect(r.channel).to.eq('white_red');
        expect(r.scope).to.eq('white_red');
        expect(r.emitMessage).to.be.false;
      });
      parse('/red to red', 'white', 'all').then((r) => {
        expect(r.channel).to.eq('white_red');
        expect(r.body).to.eq('to red');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('white: /blue coordination', () => {
      parse('/blue', 'white', 'all').then((r) => {
        expect(r.channel).to.eq('white_blue');
        expect(r.emitMessage).to.be.false;
      });
      parse('/blue to blue', 'white', 'team').then((r) => {
        expect(r.body).to.eq('to blue');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('red: /red is team, not white coordination', () => {
      parse('/red', 'red', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.scope).to.eq('team');
      });
    });
  });

  describe('red/blue: /white → team + white cell', () => {
    it('red: /white only', () => {
      parse('/white', 'red', 'all').then((r) => {
        expect(r.channel).to.eq('team_white');
        expect(r.scope).to.eq('team_white');
        expect(r.emitMessage).to.be.false;
      });
    });

    it('red: /white with message', () => {
      parse('/white reach', 'red', 'team').then((r) => {
        expect(r.channel).to.eq('team_white');
        expect(r.body).to.eq('reach');
        expect(r.emitMessage).to.be.true;
      });
    });

    it('blue: /white', () => {
      parse('/white', 'blue', 'all').then((r) => {
        expect(r.channel).to.eq('team_white');
        expect(r.emitMessage).to.be.false;
      });
    });

    it('white: /white is own team alias, not team_white', () => {
      parse('/white', 'white', 'all').then((r) => {
        expect(r.channel).to.eq('team');
        expect(r.scope).to.eq('team');
      });
    });
  });
});

describe('in-game chat (white host)', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.openScenarioPicker();
    cy.initializeOperation();
    cy.expectInGame();
  });

  it('shows Everyone pill initially; plain message uses [All]', () => {
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'all');
    cy.get('[data-testid="chat-message-input"]').type('plain hi{enter}');
    cy.get('[data-testid="chat-message"]').should('have.length', 1);
    cy.get('[data-testid="chat-message"]').first().should('contain.text', '[All]');
    cy.get('[data-testid="chat-message"]').first().should('contain.text', 'plain hi');
  });

  it('/team command only switches pill; no message row', () => {
    cy.get('[data-testid="chat-message-input"]').type('/team{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'team');
    cy.get('[data-testid="chat-messages"]').find('[data-testid="chat-message"]').should('not.exist');
  });

  it('/team hello sends [Team] without prefix', () => {
    cy.get('[data-testid="chat-message-input"]').type('/team hello{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'team');
    cy.get('[data-testid="chat-message"]').should('contain.text', '[Team]');
    cy.get('[data-testid="chat-message"]').should('contain.text', 'hello');
    cy.get('[data-testid="chat-message"]').should('not.contain.text', '/team');
  });

  it('/team then plain message uses team scope', () => {
    cy.get('[data-testid="chat-message-input"]').type('/team{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'team');
    cy.get('[data-testid="chat-message-input"]').type('after{enter}');
    cy.get('[data-testid="chat-message"]').should('have.length', 1);
    cy.get('[data-testid="chat-message"]').first().should('contain.text', '[Team]');
    cy.get('[data-testid="chat-message"]').first().should('contain.text', 'after');
  });

  it('/all and /white aliases for white cell', () => {
    cy.get('[data-testid="chat-message-input"]').type('/all broadcast{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'all');
    cy.get('[data-testid="chat-message"]').should('contain.text', '[All]');
    cy.get('[data-testid="chat-message"]').should('contain.text', 'broadcast');

    cy.get('[data-testid="chat-message-input"]').type('/white cell-only{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'team');
    cy.get('[data-testid="chat-message"]').should('contain.text', '[Team]');
    cy.get('[data-testid="chat-message"]').should('contain.text', 'cell-only');
  });

  it('white: /red and /blue coordination scopes', () => {
    cy.get('[data-testid="chat-message-input"]').type('/red to-red{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'white_red');
    cy.get('[data-testid="chat-message"]').should('contain.text', '[W+R]');
    cy.get('[data-testid="chat-message"]').should('contain.text', 'to-red');

    cy.get('[data-testid="chat-message-input"]').type('/blue to-blue{enter}');
    cy.get('[data-testid="chat-channel-pill"]').should('have.attr', 'data-chat-channel', 'white_blue');
    cy.get('[data-testid="chat-message"]').should('contain.text', '[W+B]');
    cy.get('[data-testid="chat-message"]').should('contain.text', 'to-blue');
  });
});
