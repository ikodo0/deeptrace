/** Millisecond clock used by gateway primitives. Inject in tests. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
