import path from "path";
import {generateProtoAndSetupFile, generateProtoJsonFile, loadSourceFile} from "./index";
import { writeFileSync } from "fs";
import { ConfigRT } from "./config";

async function main() {
  switch(process.argv[2]) {
    case "generate": {
      const config = ConfigRT.check((await import(
        path.join(process.cwd(), process.argv[3])
      )).default);
      const protoOutputFilePath = config.outputBasename + ".proto";
      const jsonOutputFilePath = config.outputBasename + ".proto.json";
      const tsOutputFilePath = config.outputBasename + ".proto.lib.ts";

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
