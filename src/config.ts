import * as RT from "runtypes";

export const ConfigRT = RT.Record({
  sourceFile: RT.String,
  outputBasename: RT.String,
  types: RT.Array(RT.String).optional(),
});

export type Config = RT.Static<typeof ConfigRT>;

