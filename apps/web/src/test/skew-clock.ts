import type { MockApp } from "../../mock/app.js";

/** Moves the mock's clock, so a check ends without the test waiting out its real duration. */
export function skewClock(mock: MockApp) {
  let offset = 0;
  mock.store.clock.now = () => new Date(Date.now() + offset);
  return (ms: number) => {
    offset += ms;
  };
}
