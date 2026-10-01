import { findWaiverPickups } from './waiver-finder';
import { League } from './types';

self.onmessage = (event: MessageEvent<{ league: League; teamId: number }>) => {
  try {
    self.postMessage({
      result: findWaiverPickups(event.data.league, event.data.teamId),
    });
  } catch (cause) {
    self.postMessage({
      error: cause instanceof Error ? cause.message : 'Unable to find pickups.',
    });
  }
};
