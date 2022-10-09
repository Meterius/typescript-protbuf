import {ModuleKind, Project, PropertySignature, ScriptTarget, SourceFile, SyntaxKind, Type, UnionTypeNode} from "ts-morph";
import protobuf from "protobufjs";
import path from "path";

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

export function generateProtoAndSetupFile(
  source: SourceFile,
  types: string[] | undefined,
  jsonFilePath: string,
  setupFilePath: string,
): [string, string] {
  const lines: string[] = ["syntax = \"proto3\";", "package compiled;", ""];
  const collectedNodes = new Set<string>();
  const interfaceUnionFields: Record<string, [string, Type[]][]> = {};

  let indentLevel = 0;

  function withIndent(func: () => void) {
    indentLevel += 1;
    func();
    indentLevel -= 1;
  }

  function writeLine(line: string = '') {
    lines.push(`${'\t'.repeat(indentLevel)}${line}`);
  }

  const callbacks: (() => void)[] = (types ?? [
    ...source.getEnums().map(type => type.getSymbolOrThrow().getName()),
    ...source.getInterfaces().map(type => type.getSymbolOrThrow().getName()),
  ]).map(type => () => {
    if (source.getInterface(type)) {
      collectInterface(type);
    } else if(source.getEnum(type)) {
      if (source.getEnumOrThrow(type).getMembers().every(mem => typeof mem.getValue() !== "number")) {
        collectEnum(type);
      }
    } else {
      throw new Error(`Unknown type ${type}`);
    }
  });

  function parseType(type: Type): [string, string] | null {
    let rule = '';
    let effectiveType = type;

    if (effectiveType.isArray()) {
      rule = 'repeated ';
      effectiveType = effectiveType.getArrayElementTypeOrThrow();
    }

    if (effectiveType.isNumber()) {
      return [rule, 'float'];
    } else if (effectiveType.isBoolean()) {
      return [rule, 'bool'];
    } else if (effectiveType.isString()) {
      return [rule, 'string'];
    } else {
      const effTypeName = effectiveType.getSymbol()?.getName() ?? '';

      if (source.getInterface(effTypeName)) {
        callbacks.push(() => {
          collectInterface(effTypeName);
        });
        return [rule, effTypeName];
      } else if (source.getEnum(effTypeName)) {
        const enumDec = source.getEnumOrThrow(effTypeName);

        if (enumDec.getMembers().some(member => typeof member.getValue() === "number")) {
          return [rule, 'int32'];
        } else {
          callbacks.push(() => {
            collectEnum(effTypeName);
          });

          return [rule, effTypeName];
        }
      }

      return null;
    }
  }

  function getUnionTypes(types: Type[]): Type[] {
    const literalTypes: Type[] = [];

    types.forEach((child) => {
      if (child.isLiteral() && !literalTypes.includes(child.getBaseTypeOfLiteralType())) {
        literalTypes.push(child.getBaseTypeOfLiteralType());
      }
    })

    return [
      ...types.filter(type => !type.isLiteral()),
      ...literalTypes,
    ];
  }

  let unionId = 1;
  function addUnion(parent: Type | undefined, types: Type[], prefix: string): string {
    const typeName = parent?.getAliasSymbol()?.getName();
    const unionName = typeName ?? `Union_${unionId}_${prefix}`;

    if (!typeName) {
      unionId += 1;
    }

    if (!collectedNodes.has(unionName)) {
      collectedNodes.add(unionName);

      callbacks.push(() => {
        writeLine(`message ${unionName} {`);

        withIndent(() => {
          writeLine(`oneof options {`);
          withIndent(() => {
            types.forEach((type, idx) => {
              const parsed = parseType(type);
              writeLine(`${parsed?.[1] ?? 'undefined'} option${idx + 1} = ${idx + 1};`);
            });
          });
          writeLine(`}`);
        });

        writeLine('}');
        writeLine();
      });
    }

    return unionName;
  }

  function collectEnum(name: string) {
    const node = source.getEnumOrThrow(name);

    if (!collectedNodes.has(name)) {
      collectedNodes.add(name);

      writeLine(`enum ${name} {`);

      withIndent(() => {
        node.getMembers().forEach((member, idx) => {
          writeLine(`${member.getName()} = ${idx};`);
        });
      });

      writeLine(`}`);
      writeLine();
    }
  }

  function collectInterface(name: string) {
    const node = source.getInterfaceOrThrow(name);

    if (!collectedNodes.has(name)) {
      collectedNodes.add(name);

      writeLine(`message ${name} {`);

      withIndent(() => {
        node.getChildrenOfKind(SyntaxKind.PropertySignature).forEach((member, idx) => {
          let memberType: Type = member.getType();
          let fieldRule = '';
          let fieldType;

          if (memberType.isArray()) {
            fieldRule = 'repeated ';
            memberType = memberType.getArrayElementTypeOrThrow();
          }

          if (memberType.isUnion()) {
            let requiredUnionTypes;
            if (memberType.getUnionTypes().every(child => child.isArray() || child.isUndefined())) {
              requiredUnionTypes = getUnionTypes(memberType.getUnionTypes()
                .filter(child => !child.isUndefined()).flatMap(child => child.getArrayElementTypeOrThrow()));
            } else {
              requiredUnionTypes = getUnionTypes(memberType.getUnionTypes().filter(child => !child.isUndefined()));
            }

            if (memberType.getUnionTypes().some(child => child.isUndefined())) {
              if (fieldRule === 'repeated ') {
                throw new Error();
              }

              fieldRule = 'optional ';
            }

            if (requiredUnionTypes.length === 1) {
              memberType = requiredUnionTypes[0];
            } else {
              if (!(name in interfaceUnionFields)) {
                interfaceUnionFields[name] = [];
              }

              interfaceUnionFields[name].push([
                member.getSymbolOrThrow().getName(), requiredUnionTypes,
              ]);

              fieldType = addUnion(
                memberType,
                requiredUnionTypes,
                `${name}_${member.getSymbolOrThrow().getName()}`
              );
            }
          }

          if (!fieldType) {
            fieldType = parseType(memberType)?.[1] ?? 'undefined';
          }

          writeLine(`${fieldRule}${fieldType} ${member.getSymbolOrThrow().getName()} = ${idx + 1};`);
        });
      });

      writeLine('}');
      writeLine();
    }
  }

  while (callbacks.length > 0) {
    callbacks.splice(0, 1)[0]();
  }

  const protoContent = lines.join('\n');

  const schemaImportPath = path.relative(
    path.dirname(path.join(process.cwd(), setupFilePath)),
    path.join(process.cwd(), jsonFilePath),
  );

  const setupLines: string[] = [
    `import protobuf from "protobufjs";`,
    `import schema from "./${schemaImportPath}"`,
    '',
    'export function load() {',
    `\tconst root = protobuf.Root.fromJSON(schema);`,
    '',
    ...Object.entries(interfaceUnionFields).flatMap(([name, fields]) => {
      return [
        `protobuf.wrappers[".compiled.${name}"] = {`,
        `\tfromObject(this: any, data: Record<string, any>) {`,
        ...fields.flatMap(([fieldName, fieldTypes]) => {
          const buildCaseCatch = (typeofValue: string) => {
            const optionKey = `option${fieldTypes.findIndex(
              child => (
                (child.isNumber() && typeofValue === "number")
                || (child.isString() && typeofValue === "string")
                || (child.isBoolean() && typeofValue === "boolean")
              )
            ) + 1}`;

            return [
              `\tcase "${typeofValue}":`,
              `\t\tdata[${JSON.stringify(fieldName)}] = { ${optionKey}: data[${JSON.stringify(fieldName)}] };`,
              '\t\tbreak;',
              '',
            ]
          };

          return [
            `switch (typeof data[${JSON.stringify(fieldName)}]) {`,
            ...(fieldTypes.some(child => child.isNumber()) ? buildCaseCatch('number') : []),
            ...(fieldTypes.some(child => child.isString()) ? buildCaseCatch('string') : []),
            ...(fieldTypes.some(child => child.isBoolean()) ? buildCaseCatch('boolean') : []),
            '\tdefault:',
            '\t\tthrow new Error("Unsupported");',
            '}',
            '',
          ].map(line => `\t\t${line}`);
        }),
        `\t\treturn this.fromObject(data);`,
        `\t},`,
        `\ttoObject(this: any, data: Record<string, any>, options: Record<string, any> | undefined) {`,
        `\t\tconst original = this.toObject(data, options);`,
        '',
        ...(fields.flatMap(([fieldName, fieldTypes]) => [
          `\t\toriginal[${JSON.stringify(fieldName)}] = ${fieldTypes.map((_, idx) => `original[${JSON.stringify(fieldName)}].option${idx + 1}`).join(' ?? ')};`,
        ])),
        '',
        `\t\treturn original`,
        `\t},`,
        `};`,
        '',
      ].map(line => `\t${line}`);
    }),
    '',
    '\treturn root;',
    '}',
    '',
  ];

  /*protobuf.wrappers[".main.Star"] = {
    fromObject(this: any, data) {
      return this.fromObject(data);
    },
    toObject(this: any, data, options) {
      return this.toObject(data, options);
    }
  }*/

  return [protoContent, setupLines.join("\n")];
}

export function generateProtoJsonFile(protoFilePath: string): string {
  const reflection = protobuf.loadSync(protoFilePath);
  return JSON.stringify(reflection.toJSON(), undefined, " ");
}
