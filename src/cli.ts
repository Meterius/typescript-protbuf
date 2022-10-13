import path from "path";
import {getRequiredProtocolBufferModules, loadSourceFile} from "./index";
import { main as pbjsMain } from "protobufjs-cli/pbjs";
import { writeFileSync, readFileSync, writeFile } from "fs";
import { ConfigRT } from "./config";
import { generateProtoAndLibInjection } from "./generator";
// @ts-ignore
import protobuf from "protocol-buffers";

export async function main() {
  switch(process.argv[2]) {
    case "generate": {
      const configPath = path.join(process.cwd(), process.argv[3]);
      const config = ConfigRT.check((await import(configPath)).default);

      const protoOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto");
      const libOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.js");
      const libPbOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.pb.js");
      const libPbjsOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.pbjs.js");
      const libDsOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.d.ts");

      const {
        protoFileContent, libFileContent, libDeclarationFileContent,
      } = generateProtoAndLibInjection(
        await loadSourceFile(config.sourceFile), config, libOutputFilePath, libPbjsOutputFilePath, libPbOutputFilePath,
      );

      writeFileSync(protoOutputFilePath, protoFileContent);

      await Promise.all([...getRequiredProtocolBufferModules(config).map(module => (async () => {
          switch(module) {
            default:
              break;

            case "protobufjs":
              await (new Promise<void>((resolve, reject) => {
                pbjsMain(["-t", "static-module", "--no-create", "-w", "commonjs", "-o", libPbjsOutputFilePath, protoOutputFilePath], (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve();
                  }
                });
              }));
              break;

            case "protocol-buffers":
              await (new Promise<void>((resolve, reject) => {
                writeFile(libPbOutputFilePath, protobuf.toJS(null, {
                  filename: protoOutputFilePath,
                  resolveImport: (filePath: string) => readFileSync(filePath),
                }), (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve();
                  }
                });
              }));
              break;
          }
        })()),
        new Promise<void>((resolve, reject) => {
          writeFile(libOutputFilePath, libFileContent, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }),
        new Promise<void>((resolve, reject) => {
          writeFile(libDsOutputFilePath, libDeclarationFileContent, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }),
      ]);
    }
    break;

    default:
      throw new Error(`Unexpected command "${process.argv[2]}"`);
  }
}
