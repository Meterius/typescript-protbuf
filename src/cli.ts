import path from "path";
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
      const libOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.ts");

      const {
        protoFileContent, libFileContent,
      } = generateProtoAndSetupFile(
        await loadSourceFile(config.sourceFile), config, jsonOutputFilePath, libOutputFilePath,
      );

      writeFileSync(protoOutputFilePath, protoFileContent);
      const jsonContent = generateProtoJsonFile(protoOutputFilePath);
      writeFileSync(jsonOutputFilePath, jsonContent);
      writeFileSync(libOutputFilePath, libFileContent);
    }
    break;

    default:
      throw new Error(`Unexpected command "${process.argv[2]}"`);
  }
}
