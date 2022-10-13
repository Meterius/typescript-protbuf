import * as RT from "runtypes";

const NumberEncodingRT = RT.Union(RT.Literal("int32"), RT.Literal("float"));

const PbModuleRT = RT.Union(RT.Literal("protocol-buffers"), RT.Literal("protobufjs"));

export type PbModule = RT.Static<typeof PbModuleRT>;

export const ConfigRT = RT.Record({
  sourceFile: RT.String,
  outputBasename: RT.String,
  types: RT.Array(RT.String).optional(),
  unionInterfaceNameGetter: RT.Dictionary(RT.Function).optional(),
  numberEncoding: RT.Record({
    default: NumberEncodingRT,
    overrides: RT.Dictionary(NumberEncodingRT, RT.String).optional(),
  }).optional(),
  encodingModule: PbModuleRT.optional(),
  decodingModule: PbModuleRT.optional(),
});

export const defaultEncodingModule: PbModule = "protocol-buffers";
export const defaultDecodingModule: PbModule = "protocol-buffers";

export type Config = RT.Static<typeof ConfigRT>;

export function getRequiredProtocolBufferModules(config: Config): PbModule[] {
  return [...new Set([
    config.encodingModule ?? defaultEncodingModule,
    config.decodingModule ?? defaultDecodingModule,
  ])];
}
