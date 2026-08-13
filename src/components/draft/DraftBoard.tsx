import { memo } from 'react';
import { ChampionArt, championStyle } from '../ChampionArt.tsx';
import { TeamLogo } from '../TeamLogo.tsx';
import { ROLE_SHORT, type GamePrompt, type Side, type TeamSide } from '../../domain/types.ts';
import { formatSeriesFormat } from '../../lib/format.ts';

/** Pro drafts have five bans a side; pad short ban lists so the row stays even. */
const BAN_SLOTS = 5;

interface DraftBoardProps {
  /** Winner-free view of the game — the type makes leaking the answer impossible. */
  game: GamePrompt;
  /** Set only after the user has answered. */
  winner?: Side | null;
  compact?: boolean;
}

export const DraftBoard = memo(function DraftBoard({
  game,
  winner = null,
  compact = false,
}: DraftBoardProps) {
  return (
    <section
      className={`draft${compact ? ' is-compact' : ''}`}
      data-winner={winner ?? undefined}
      aria-label={`Draft: ${game.blue.teamName} versus ${game.red.teamName}`}
    >
      <DraftSide team={game.blue} isWinner={winner === 'blue'} />

      <div className="draft-center">
        <div className="draft-center-tags">
          <TeamLogo teamName={game.blue.teamName} tag={game.blue.tag} size="sm" />
          <span className="dim">/</span>
          <TeamLogo teamName={game.red.teamName} tag={game.red.tag} size="sm" />
        </div>
        <div className="draft-vs">VS</div>
        <div className="draft-center-meta">
          <span className="badge badge-strong">Game {game.gameNumber}</span>
          <span className="badge" title={game.seriesFormatInferred ? 'Inferred from series length' : undefined}>
            {formatSeriesFormat(game.seriesFormat)}
            {game.seriesFormatInferred && game.seriesFormat !== 'UNKNOWN' ? '*' : ''}
          </span>
          {game.stage.elimination && <span className="badge badge-elim">Elimination</span>}
        </div>
      </div>

      <DraftSide team={game.red} isWinner={winner === 'red'} />
    </section>
  );
});

function DraftSide({ team, isWinner }: { team: TeamSide; isWinner: boolean }) {
  const sideLabel = team.side === 'blue' ? 'Blue Side' : 'Red Side';
  return (
    <div className={`draft-side draft-side--${team.side}`}>
      <header className="side-head">
        <BanRow bans={team.bans} side={team.side} />
        <div className="side-id">
          <span className="side-label">
            {sideLabel}
            {isWinner && <span className="winner-stamp">Winner</span>}
          </span>
          <span className="side-team" title={team.teamName}>
            {team.teamName}
          </span>
        </div>
        <TeamLogo teamName={team.teamName} tag={team.tag} size="lg" className="side-tag" />
      </header>

      <div className="picks">
        {team.players.map((slot, index) => (
          <article
            key={slot.role}
            className="pick"
            style={{ ...championStyle(slot.champion), ['--pick-index' as string]: String(index) }}
          >
            <div className="pick-art">
              <ChampionArt champion={slot.champion} variant="portrait" />
            </div>
            <span className="pick-role">{ROLE_SHORT[slot.role]}</span>
            <div className="pick-info">
              <span className="pick-player" title={slot.playerName}>
                {slot.playerName}
              </span>
              <span className="pick-champ" title={slot.champion.name}>
                {slot.champion.name}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BanRow({ bans, side }: { bans: TeamSide['bans']; side: Side }) {
  const slots = Array.from({ length: Math.max(BAN_SLOTS, bans.length) }, (_, i) => bans[i] ?? null);
  return (
    <div className="bans" role="list" aria-label={`${side === 'blue' ? 'Blue' : 'Red'} side bans`}>
      <span className="bans-label" aria-hidden="true">
        Bans
      </span>
      {slots.map((champion, index) =>
        champion ? (
          <div
            className="ban"
            role="listitem"
            key={`${champion.id}-${index}`}
            title={`Banned: ${champion.name}`}
          >
            <ChampionArt champion={champion} variant="icon" />
          </div>
        ) : (
          <div className="ban ban-empty" role="listitem" key={`empty-${index}`} title="No ban">
            –
          </div>
        ),
      )}
    </div>
  );
}
