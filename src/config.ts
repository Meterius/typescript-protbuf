import * as RT from "runtypes";

const NumberEncoding = RT.Union(RT.Literal("int32"), RT.Literal("float"));

export const ConfigRT = RT.Record({
  sourceFile: RT.String,
  outputBasename: RT.String,
  types: RT.Array(RT.String).optional(),
  unionInterfaceNameGetter: RT.Dictionary(RT.Function).optional(),
  numberEncoding: RT.Record({
    default: NumberEncoding,
    overrides: RT.Dictionary(NumberEncoding, RT.String).optional(),
  }).optional(),
});

export type Config = RT.Static<typeof ConfigRT>;

