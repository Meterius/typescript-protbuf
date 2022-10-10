import path from "path";
import {generateProtoAndSetupFile, generateProtoJsonFile, loadSourceFile} from "./index";
import { writeFileSync } from "fs";
import { ConfigRT } from "./config";

export async function main() {
  switch(process.argv[2]) {
    case "generate": {
      const configPath = path.join(process.cwd(), process.argv[3]);
      const config = ConfigRT.check((await import(configPath)).default);

      const protoOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto");
      const jsonOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.json");
      const tsOutputFilePath = path.join(process.cwd(), config.outputBasename + ".proto.lib.ts");

      const [protoContent, tsContent] = generateProtoAndSetupFile(
        await loadSourceFile(config.sourceFile), config, jsonOutputFilePath, tsOutputFilePath,
      );

      writeFileSync(protoOutputFilePath, protoContent);
      const jsonContent = generateProtoJsonFile(protoOutputFilePath);
      writeFileSync(jsonOutputFilePath, jsonContent);
      writeFileSync(tsOutputFilePath, tsContent);
    }
    break;

    default:
      throw new Error(`Unexpected command "${process.argv[2]}"`);
  }
}
