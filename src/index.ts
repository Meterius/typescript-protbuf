import {
  EnumDeclaration,
  InterfaceDeclaration,
  ModuleKind,
  Project,
  PropertySignature,
  ScriptTarget,
  SourceFile,
  SyntaxKind,
  Type
} from "ts-morph";
import protobuf from "protobufjs";
import path from "path";
import {Config} from "./config";

export function loadSourceFile(
  sourceFilePath: string,
): SourceFile {
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ES2018,
      module: ModuleKind.CommonJS,
      strict: true,
    },
  });
  return project.addSourceFileAtPath(sourceFilePath);
}

export * from "./config";
