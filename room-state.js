// Keep player references as IDs. Telegram queues, sockets and timer handles are process-local.
function packRoom(g) {
  const { timer, ticker, liveTimer, liveQ, liveSig, liveAt, players, voteCandidates,
    eliminated, votes, roundRevealed, ready, firstTally, fx, ...room } = g;
  return structuredClone({
    ...room, players, eliminated: eliminated.map(p => p.id),
    voteCandidates: voteCandidates?.map(p => p.id),
    votes: [...votes], roundRevealed: [...roundRevealed], ready: [...(ready || [])],
    firstTally: firstTally && [...firstTally],
    fx: fx && { ...fx, dbl: [...fx.dbl], shield: [...fx.shield], veto: [...fx.veto] }
  });
}

function unpackRoom(saved) {
  const g = structuredClone(saved);
  const players = new Map(g.players.map(p => [p.id, p]));
  g.eliminated = g.eliminated.map(id => players.get(id));
  g.voteCandidates = g.voteCandidates?.map(id => players.get(id));
  g.votes = new Map(g.votes);
  g.roundRevealed = new Set(g.roundRevealed);
  g.ready = new Set(g.ready);
  if (g.firstTally) g.firstTally = new Map(g.firstTally);
  if (g.fx) for (const key of ['dbl', 'shield', 'veto']) g.fx[key] = new Set(g.fx[key]);
  return g;
}

module.exports = { packRoom, unpackRoom };
