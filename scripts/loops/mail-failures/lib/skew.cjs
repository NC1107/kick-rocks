// Preloaded into a server process to put its clock ahead without touching the host clock.
const offset = Number(process.env.KR_SKEW_MS || 0);
if (offset) {
  const RealDate = Date;
  class SkewedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = SkewedDate;
}
