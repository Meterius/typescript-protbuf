import {generateProtoAndSetupFile, generateProtoJsonFile, loadSourceFile} from "./index";
import { writeFileSync } from "fs";

async function main() {
  switch(process.argv[2]) {
    case "generate": {
      const [protoContent, tsContent] = generateProtoAndSetupFile(
        await loadSourceFile(process.argv[3]), undefined, process.argv[5], process.argv[6],
      );
      writeFileSync(process.argv[4], protoContent);
      const jsonContent = generateProtoJsonFile(process.argv[4]);
      writeFileSync(process.argv[5], jsonContent);
      writeFileSync(process.argv[6], tsContent);
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
