import { TradePlan } from '@/lib/trade-plans';

export function TradeMoves({
  plan,
  partnerName,
}: {
  plan: TradePlan;
  partnerName: string;
}) {
  return (
    <div className="trade-moves">
      {(
        [
          ['Your team', plan.mine],
          [partnerName, plan.partner],
        ] as const
      ).map(
        ([name, move]) =>
          (move.drop || move.pickup || move.openSpots > 0) && (
            <p key={name}>
              <strong>{name}:</strong>{' '}
              {move.drop && <>Drop {move.drop.name} to make room. </>}
              {move.pickup && (
                <>Add {move.pickup.name} from free agents (optional). </>
              )}
              {move.openSpots > 0 && (
                <>
                  {move.openSpots} open roster{' '}
                  {move.openSpots === 1 ? 'spot' : 'spots'}.
                </>
              )}
            </p>
          ),
      )}
      <small>
        {plan.mine.capacitySource === 'snapshot' ||
        plan.partner.capacitySource === 'snapshot'
          ? 'Roster limits are unavailable for at least one team; its current non-IR roster count is used as the capacity.'
          : 'Drop plans use imported roster capacity.'}{' '}
        Confirm roster limits and player locks in ESPN. Pickups depend on
        availability when the trade completes.
      </small>
    </div>
  );
}
