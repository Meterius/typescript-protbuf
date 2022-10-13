import * as RT from "runtypes";

const NumberEncoding = RT.Union(RT.Literal("int32"), RT.Literal("float"));

const PbModule = RT.Union(RT.Literal("protocol-buffers"), RT.Literal("protobufjs"));

export const ConfigRT = RT.Record({
  sourceFile: RT.String,
  outputBasename: RT.String,
  types: RT.Array(RT.String).optional(),
  unionInterfaceNameGetter: RT.Dictionary(RT.Function).optional(),
  numberEncoding: RT.Record({
    default: NumberEncoding,
    overrides: RT.Dictionary(NumberEncoding, RT.String).optional(),
  }).optional(),
  encodingModule: PbModule.optional(),
  decodingModule: PbModule.optional(),
});

export type Config = RT.Static<typeof ConfigRT>;

