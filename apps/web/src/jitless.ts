import { z } from "zod";

// Zod compiles its fast parsers with `new Function`, which the Content Security Policy forbids.
// Chrome logs the refused attempt as a console error on every page load, so the app opts out first.
z.config({ jitless: true });
