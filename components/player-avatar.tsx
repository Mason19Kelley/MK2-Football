'use client';
import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Player } from '@/lib/types';
export default function Avatar({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`player-avatar ${player.position.toLowerCase().replace('/', '')}`}
    >
      {player.id > 0 && player.position !== 'D/ST' && !failed ? (
        <img
          src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>
          {player.position === 'D/ST' ? (
            <Shield size={19} />
          ) : (
            player.name
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0])
              .join('')
          )}
        </span>
      )}
    </span>
  );
}
