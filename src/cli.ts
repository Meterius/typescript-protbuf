import path from "path";
import { main as pbjsMain } from "protobufjs-cli/pbjs";
import { main as pbtsMain } from "protobufjs-cli/pbts";
import { generateProtoJsonFile, loadSourceFile } from "./index";
import { writeFileSync } from "fs";
import { ConfigRT } from "./config";
import { generateProtoAndSetupFile } from "./generator";

export async function main() {
  switch(process.argv[2]) {
    case "generate": {
      const configPath = path.join(process.cwd(), process.argv[3]);
      const config = ConfigRT.check((await import(configPath)).default);

      const protoOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto");
      const jsonOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.json");
      const libOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.js");
      const libDsOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.d.ts");

      const {
        protoFileContent, staticInjector,
      } = generateProtoAndSetupFile(
        await loadSourceFile(config.sourceFile), config,
      );

      writeFileSync(protoOutputFilePath, protoFileContent);
      const jsonContent = generateProtoJsonFile(protoOutputFilePath);
      writeFileSync(jsonOutputFilePath, jsonContent);

      const staticFileContent = await (new Promise<string>((resolve, reject) => {
        pbjsMain(["-t", "static-module", "--no-create", "-w", "commonjs", "-o", libOutputFilePath, protoOutputFilePath], (err, output) => {
          if (err) {
            reject(err);
          } else {
            resolve(output ?? "");
          }
        });
      }));

      await (new Promise<void>((resolve, reject) => {
        pbtsMain(["-o", libDsOutputFilePath, libOutputFilePath], (err, output) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }));

      const injectedStaticFileContent = staticInjector(staticFileContent);
      writeFileSync(libOutputFilePath, injectedStaticFileContent);
    }
    break;

    default:
      throw new Error(`Unexpected command "${process.argv[2]}"`);
  }
}
