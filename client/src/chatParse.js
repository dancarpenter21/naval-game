/** @typedef {'all' | 'team' | 'white_red' | 'white_blue' | 'team_white'} ChatChannel */

/**
 * Leading `/all`, `/team`, color aliases, and coordination commands: update the target channel,
 * then send the rest of the line (without the command) on that scope. Command-only lines switch
 * channel and do not emit a message.
 *
 * @param {string} text trimmed input
 * @param {string} playerTeam
 * @param {ChatChannel} defaultChannel current pill / default scope for non-command lines
 * @returns {{ channel: ChatChannel | null, scope: ChatChannel, body: string, emitMessage: boolean }}
 */
export function parseLeadingChatCommand(text, playerTeam, defaultChannel) {
  const isWhite = playerTeam === 'white';

  const isAllCmd = /^\/all(\s|$)/i.test(text);
  const isTeamCmd = /^\/team(\s|$)/i.test(text);
  const isWhiteCoordRed = isWhite && /^\/red(\s|$)/i.test(text);
  const isWhiteCoordBlue = isWhite && /^\/blue(\s|$)/i.test(text);
  const isRedBlueToWhite =
    (playerTeam === 'red' || playerTeam === 'blue') && /^\/white(\s|$)/i.test(text);
  const isOwnTeamColorAliasCmd =
    (playerTeam === 'blue' && /^\/blue(\s|$)/i.test(text)) ||
    (playerTeam === 'red' && /^\/red(\s|$)/i.test(text)) ||
    (playerTeam === 'white' && /^\/white(\s|$)/i.test(text));

  /** @type {ChatChannel | null} */
  let channel = null;
  /** @type {ChatChannel} */
  let scope = defaultChannel;
  let body = text;

  if (isAllCmd) {
    channel = 'all';
    scope = 'all';
    body = text.replace(/^\/all\s*/i, '').trim();
  } else if (isWhiteCoordRed) {
    channel = 'white_red';
    scope = 'white_red';
    body = text.replace(/^\/red\s*/i, '').trim();
  } else if (isWhiteCoordBlue) {
    channel = 'white_blue';
    scope = 'white_blue';
    body = text.replace(/^\/blue\s*/i, '').trim();
  } else if (isRedBlueToWhite) {
    channel = 'team_white';
    scope = 'team_white';
    body = text.replace(/^\/white\s*/i, '').trim();
  } else if (isTeamCmd || isOwnTeamColorAliasCmd) {
    channel = 'team';
    scope = 'team';
    body = text
      .replace(/^\/team\s*/i, '')
      .replace(/^\/blue\s*/i, '')
      .replace(/^\/red\s*/i, '')
      .replace(/^\/white\s*/i, '')
      .trim();
  } else {
    return { channel: null, scope: defaultChannel, body: text, emitMessage: true };
  }

  return { channel, scope, body, emitMessage: body.length > 0 };
}
