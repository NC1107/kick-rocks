import { measureCoverage } from "../../../apps/server/src/test-utils/coverage-measure.js";

console.log(JSON.stringify(measureCoverage(), null, 2));
