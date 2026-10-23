import { ChampionArt } from './ChampionArt.tsx';

/** A champion's icon and name, for tables and lists. */
export function ChampionLabel({ id, name }: { id: string; name: string }) {
  return (
    <span className="team-stat-champ">
      <span className="team-stat-icon">
        <ChampionArt champion={{ id, name }} variant="icon" />
      </span>
      {name}
    </span>
  );
}
