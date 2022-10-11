import {PropertySignature, SourceFile, SyntaxKind, Type} from "ts-morph";
import {Config} from "./config";
import path from "path";

export function generateProtoAndSetupFile(
  source: SourceFile,
  config: Config,
  jsonFilePath: string,
  tsFilePath: string,
): {
  protoFileContent: string;
  libFileContent: string;
} {
  const lines: string[] = ["syntax = \"proto3\";", "package compiled;", ""];
  const collectedNodes = new Set<string>();
  const interfaceUnionFields: Record<string, [string, Type[], string | null, boolean][]> = {};
  const interfaceEnumFields: Record<string, [string, string][]> = {};
  const interfaceNullFields: Record<string, [string, boolean][]> = {};
  const interfaceEscapedFieldTranslation: Record<string, [string, string][]> = {};
  const interfaceLiteralFields: Record<string, [string, string][]> = {};
  const literalEnumDefinitions: Record<string, unknown[]> = {};

  let indentLevel = 0;

  const NullEnum = "SpecialNullSubstitute";

  function getEscapedFieldName(member: PropertySignature) {
    return member.getName().replaceAll('_', '').toLocaleLowerCase();
  }

  function getLiteralToEnumTranslatorVar(key: string) {
    return `lit_enum_${key}`;
  }

  function getEnumToLiteralTranslatorVar(key: string) {
    return `enum_lit_${key}`;
  }

  function getTypescriptEnumToEnumTranslatorVar(key: string) {
    return `typ_enum_enum_${key}`;
  }

  function getEnumToTypescriptEnumTranslatorVar(key: string) {
    return `enum_typ_enum_${key}`;
  }

  function getUnionToOptionTranslatorVar(key: string) {
    return `union_opt_${key}`;
  }

  function getScalar(type: Type): "string" | "number" | "boolean" | "null" | null {
    if (type.isNumber()) {
      return "number";
    } else if (type.isString()) {
      return "string";
    } else if (type.isBoolean()) {
      return "boolean";
    } else if (type.isNull()) {
      return "null";
    } else {
      return null;
    }
  }

  function withIndent(func: () => void) {
    indentLevel += 1;
    func();
    indentLevel -= 1;
  }

  function writeLine(line: string = '') {
    lines.push(`${'\t'.repeat(indentLevel)}${line}`);
  }

  const callbacks: (() => void)[] = (config.types ?? [
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

  function parseType(type: Type, member?: PropertySignature): [string, string] | null {
    let rule = '';
    let effectiveType = type;

    if (effectiveType.isArray()) {
      rule = 'repeated ';
      effectiveType = effectiveType.getArrayElementTypeOrThrow();
    }

    const scalar = getScalar(effectiveType);

    if (scalar) {
      return [rule, {
        string: "string",
        number: "float",
        null: NullEnum,
        boolean: "bool",
      }[scalar]];
    } else {
      const effTypeName = effectiveType.getSymbol()?.getName() ?? '';

      if (source.getInterface(effTypeName)) {
        callbacks.push(() => {
          collectInterface(effTypeName);
        });
        return [rule, effTypeName];
      } else if (source.getEnum(effTypeName)) {
        if (
          member
          && member.getParent()?.isKind(SyntaxKind.InterfaceDeclaration)
        ) {
          const memberInterfaceName = member.getParentOrThrow().getSymbolOrThrow().getName();
          if (!(memberInterfaceName in interfaceEnumFields)) {
            interfaceEnumFields[memberInterfaceName] = [];
          }
          interfaceEnumFields[memberInterfaceName].push([getEscapedFieldName(member), effTypeName]);
        }

        callbacks.push(() => {
          collectEnum(effTypeName);
        });

        return [rule, effTypeName];
      }

      return null;
    }
  }

  function getUnionTypes(types: Type[]): Type[] {
    const literalTypes: Type[] = [];

    if (isLiteralUnionType(types)) {
      return types;
    }

    types.forEach((child) => {
      if (
        child.isLiteral()
        && !literalTypes.includes(child.getBaseTypeOfLiteralType())
      ) {
        literalTypes.push(child.getBaseTypeOfLiteralType());
      }
    });

    return [
      ...types.filter(type => !type.isLiteral()),
      ...literalTypes,
    ];
  }

  function isLiteralUnionType(types: Type[]): boolean {
    return types.every(type => !type.isEnumLiteral() && type.isStringLiteral() || type.isUndefined());
  }

  function lookupUnion(types: Type[]): string | undefined {
    return source.getTypeAliases().find(
      alias => {
        if (alias.getType().isUnion()) {
          const unionTypes = getUnionTypes(alias.getType().getUnionTypes());
          return unionTypes.every(type => types.includes(type)) && types.every(type => unionTypes.includes(type));
        } else {
          return false;
        }
      },
    )?.getName();
  }

  let unionId = 1;
  function addUnion(types: Type[], prefix: string): string {
    const typeName = lookupUnion(types);
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
              writeLine(`${parsed?.[1] ?? 'undefined'} option${idx + 1} = ${idx + 2};`);
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

  function createLiteralEnum(key: string, values: unknown[]) {
    writeLine(`enum ${key} {`);

    withIndent(() => {
      values.forEach((value, idx) => {
        writeLine(`${key}_${idx} = ${idx};`);
      });
    });

    writeLine('}');
    writeLine();

    literalEnumDefinitions[key] = values;
  }

  function collectEnum(name: string) {
    const node = source.getEnumOrThrow(name);

    if (!collectedNodes.has(name)) {
      collectedNodes.add(name);

      writeLine(`enum ${name} {`);

      withIndent(() => {
        node.getMembers().forEach((member, idx) => {
          writeLine(`${name.toUpperCase()}_${idx} = ${idx};`);
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

      const memberEscapedNames: string[] = [];
      node.getChildrenOfKind(SyntaxKind.PropertySignature).forEach((member) => {
          const escapedName = getEscapedFieldName(member);

          if (memberEscapedNames.includes(escapedName)) {
              throw new Error(`${name}.${member.getName()} is ambiguous when escaped`);
          } else {
            memberEscapedNames.push(escapedName);
          }

          if (escapedName !== member.getName()) {
            if (!(name in interfaceEscapedFieldTranslation)) {
              interfaceEscapedFieldTranslation[name] = [];
            }

            interfaceEscapedFieldTranslation[name].push([escapedName, member.getName()]);
          }
      });

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

          if (memberType.isUnion() || isLiteralUnionType([memberType])) {
            const rawUnionTypes = memberType.isUnion() ? memberType.getUnionTypes() : [memberType];

            if (
              rawUnionTypes.some(child => child.isArray())
              && rawUnionTypes.some(child => !child.isArray() && !child.isUndefined())
            ) {
              throw new Error(`Cannot handle union of arrays and non-arrays at ${name}.${member.getName()}`);
            }

            let requiredUnionTypes;
            if (rawUnionTypes.every(child => child.isArray() || child.isUndefined())) {
              requiredUnionTypes = getUnionTypes(rawUnionTypes
                .filter(child => !child.isUndefined()).flatMap(child => child.getArrayElementTypeOrThrow()));

              fieldRule = 'repeated ';
            } else {
              requiredUnionTypes = getUnionTypes(rawUnionTypes.filter(child => !child.isUndefined()));
            }

            if (rawUnionTypes.some(child => child.isUndefined())) {
              if (fieldRule === 'repeated ') {
                throw new Error(`Cannot handle optional array at ${name}.${member.getName()}`);
              }

              fieldRule = 'optional ';
            }

            if (isLiteralUnionType(requiredUnionTypes)) {
              const literalKey = `Literal_${name}_${getEscapedFieldName(member)}`;
              const literalValues = [
                undefined,
                ...requiredUnionTypes.flatMap((child) => child.isStringLiteral() ? [<string> child.getLiteralValue()] : []),
              ];

              if (!(name in interfaceLiteralFields)) {
                interfaceLiteralFields[name] = [];
              }

              interfaceLiteralFields[name].push([getEscapedFieldName(member), literalKey]);

              callbacks.push(
                () => createLiteralEnum(literalKey, literalValues),
              );

              fieldType = literalKey;
            } else if (requiredUnionTypes.length === 1) {
              memberType = requiredUnionTypes[0];
            } else {

              if (!(name in interfaceUnionFields)) {
                interfaceUnionFields[name] = [];
              }

              fieldType = addUnion(
                requiredUnionTypes,
                `${name}_${getEscapedFieldName(member)}`
              );

              interfaceUnionFields[name].push([
                getEscapedFieldName(member),
                requiredUnionTypes,
                source.getTypeAlias(fieldType) ? fieldType : null,
                fieldRule === 'repeated ',
              ]);
            }
          }

          if (!fieldType) {
            fieldType = parseType(memberType, member)?.[1];

            if (fieldType === NullEnum) {
              if (!(name in interfaceNullFields)) {
                interfaceNullFields[name] = [];
              }

              interfaceNullFields[name].push([getEscapedFieldName(member), fieldRule === 'repeated '])
            }
          }

          if (!fieldType) {
            throw new Error(`Could not determine field type of ${name}.${member.getName()}`);
          }

          writeLine(`${fieldRule}${fieldType} ${getEscapedFieldName(member)} = ${idx + 1};`);
        });
      });

      writeLine('}');
      writeLine();
    }
  }

  writeLine(`enum ${NullEnum} {`);
  writeLine('\tNullSubstitution_0 = 0;');
  writeLine('}');
  writeLine();

  while (callbacks.length > 0) {
    callbacks.splice(0, 1)[0]();
  }

  const protoFileContent = lines.join('\n');

  const schemaImportPath = path.relative(
    path.dirname(path.join(process.cwd(), tsFilePath)),
    path.join(process.cwd(), jsonFilePath),
  );

  function makeInterfaceFieldUnionInterfaceNameGetter(key: string, dataExpression: string) {
    const makeGetter = config.unionInterfaceNameGetter?.[key];

    if (!makeGetter) {
      throw new Error(`Config is missing union interface name getter for entry ${key}`);
    } else {
      return makeGetter(dataExpression);
    }
  }

  const libFileContent = [
    `import protobuf from "protobufjs/light";`,
    `import schema from "./${schemaImportPath}"`,
    '',
    'export function load() {',
    `\tconst root = protobuf.Root.fromJSON(schema);`,
    '',
    ...Object.entries(literalEnumDefinitions).map(([key, values]) => `\tconst ${getLiteralToEnumTranslatorVar(key)}: Record<any, number> = {${values.flatMap((value, idx) => value === undefined ? [] : [JSON.stringify(value) + ': ' + idx.toString()]).join(", ")}};`),
    '',
    ...Object.entries(literalEnumDefinitions).map(([key, values]) => `\tconst ${getEnumToLiteralTranslatorVar(key)} = [${values.map((value) => value === undefined ? 'undefined' : JSON.stringify(value)).join(", ")}];`),
    '',
    ...source.getEnums().map(enumDec => `\tconst ${getTypescriptEnumToEnumTranslatorVar(enumDec.getName())}: Record<any, number> = {${enumDec.getMembers().flatMap((mem, idx) => [JSON.stringify(mem.getValue()) + ': ' + (idx + 1).toString()]).join(", ")}};`),
    '',
    ...source.getEnums().map(enumDec => `\tconst ${getEnumToTypescriptEnumTranslatorVar(enumDec.getName())} = [undefined, ${enumDec.getMembers().map((mem) => JSON.stringify(mem.getValue())).join(", ")}];`),
    '',
    `\tconst unionInterfaceTypeToOptionTranslator: Record<string, Record<string, string>> = {`,
    ...source.getInterfaces().flatMap(intDec => {
      const nonOneObjectFields = (
        interfaceUnionFields[intDec.getName()] ?? []
      ).filter(fields => fields[1].filter(child => !getScalar(child)).length > 1);

      if (nonOneObjectFields.length > 0) {
        return [
          ...nonOneObjectFields.flatMap(
            ([fieldName, fieldTypes]) => [
              `\t${JSON.stringify(intDec.getName() + "." + fieldName)}: {`,
              ...fieldTypes.flatMap((fieldType, fieldIndex) => {
                if (getScalar(fieldType)) {
                  return [];
                } else {
                  return [
                    `\t\t${JSON.stringify(fieldType.getSymbolOrThrow().getName())}: "option${fieldIndex + 1}",`,
                  ];
                }
              }),
              `\t},`,
            ],
          ),
        ];
      } else {
        return [];
      }
    }).map(line => `\t${line}`),
    '\t};',
    '',
    ...source.getInterfaces().flatMap((intDec) => {
      const name = intDec.getName();
      const unionFields = interfaceUnionFields[name] ?? [];
      const enumFields = interfaceEnumFields[name] ?? [];
      const nullFields = interfaceNullFields[name] ?? [];
      const escapedFields = interfaceEscapedFieldTranslation[name] ?? [];
      const literalFields = interfaceLiteralFields[name] ?? [];

      return (
        unionFields.length > 0 || enumFields.length > 0
        || nullFields.length > 0 || literalFields.length > 0
        || escapedFields.length > 0
      ) ? [
        `protobuf.wrappers[".compiled.${name}"] = {`,
        `\tfromObject(this: any, data: Record<string, any>) {`,
        ...escapedFields.flatMap(([fieldName, fieldOriginalName]) => [
          `\tdata[${JSON.stringify(fieldName)}] = data[${JSON.stringify(fieldOriginalName)}];`,
        ]),
        ...unionFields.flatMap(([fieldName, fieldTypes, fieldUnionName, isArray]) => {
          const dataExpression = isArray ? `data[${JSON.stringify(fieldName)}][idx]` : `data[${JSON.stringify(fieldName)}]`;

          const buildCaseCatch = (typeofValue: string) => {
            const optionKey = `option${fieldTypes.findIndex(
              child => getScalar(child) === typeofValue
            ) + 1}`;

            return [
              `\tcase "${typeofValue}":`,
              `\t\t${dataExpression} = { ${optionKey}: ${dataExpression} };`,
              '\t\tbreak;',
              '',
            ]
          };

          const nullOptionIndex = fieldTypes.findIndex(child => getScalar(child) === "null");

          const objectCase: string[] = [];
          if (fieldTypes.some(child => !getScalar(child)) || nullOptionIndex !== -1) {
            objectCase.push(
              '\tcase "object":',
              ...(
                nullOptionIndex === -1 ? [
                  `\t\tif (${dataExpression} === null) {`,
                  `\t\t\tthrow new Error("Unsupported");`,
                  `\t\t} else {`,
                ] : [
                  `\t\tif (${dataExpression} === null) {`,
                  `\t\t\t${dataExpression} = { option${nullOptionIndex + 1}: 0 };`,
                  `\t\t} else {`,
                ]
              ),
            );

            const nonScalarFieldTypes = fieldTypes.filter(child => !getScalar(child));

            if (nonScalarFieldTypes.length === 0) {
              objectCase.push(
                `\t\t\tthrow new Error("Unsupported");`,
              );
            } else if (nonScalarFieldTypes.length === 1) {
              objectCase.push(
                `\t\t\t${dataExpression} = { option${
                  fieldTypes.findIndex(child => !getScalar(child)) + 1
                }: ${dataExpression} };`,
              );
            } else {
              objectCase.push(
                `\t\t\t${dataExpression} = {`,
                `\t\t\t\t[unionInterfaceTypeToOptionTranslator[${JSON.stringify(intDec.getName() + "." + fieldName)}][${
                  makeInterfaceFieldUnionInterfaceNameGetter(
                    fieldUnionName ?? (intDec.getName() + "." + fieldName),
                    dataExpression,
                  )
                }]]: ${dataExpression},`,
                `\t\t\t};`,
                '',
              );
            }

            objectCase.push(`\t\t}`);
            objectCase.push(`\t\tbreak;`);
            objectCase.push('');
          }

          return [
            ...(isArray ? [
              `if (data[${JSON.stringify(fieldName)}] !== undefined) {`,
              `\tdata[${JSON.stringify(fieldName)}].forEach((_: any, idx: number) => {`,
            ] : []),
            ...[
              `switch (typeof ${dataExpression}) {`,
              '\tcase "undefined":',
              '\t\tbreak;',
              '',
              ...objectCase,
              ...(fieldTypes.some(child => child.isNumber()) ? buildCaseCatch('number') : []),
              ...(fieldTypes.some(child => child.isString()) ? buildCaseCatch('string') : []),
              ...(fieldTypes.some(child => child.isBoolean()) ? buildCaseCatch('boolean') : []),
              '\tdefault:',
              '\t\tthrow new Error("Unsupported");',
              '}',
            ].map(line => isArray ? `\t\t${line}` : line),
            ...(isArray ? [
              '\t});',
              `}`,
            ] : []),
            '',
          ].map(line => `\t\t${line}`);
        }),
        ...(enumFields.flatMap(([fieldName, enumName]) => [
          `\t\tdata[${JSON.stringify(fieldName)}] = ${getTypescriptEnumToEnumTranslatorVar(enumName)}[data[${JSON.stringify(fieldName)}]];`,
        ])),
        ...(nullFields.flatMap(([fieldName, isArray]) => [
          `\t\tdata[${JSON.stringify(fieldName)}] = data[${JSON.stringify(fieldName)}] !== undefined ? ${(isArray ? `data[${JSON.stringify(fieldName)}].map(() => 0)` : `0`)} : undefined;`,
        ])),
        ...(literalFields.flatMap(([fieldName, literalKey]) => [
          `\t\tdata[${JSON.stringify(fieldName)}] = ${getLiteralToEnumTranslatorVar(literalKey)}[data[${JSON.stringify(fieldName)}]];`,
        ])),
        '',
        `\t\treturn this.fromObject(data);`,
        `\t},`,

        `\ttoObject(this: any, data: Record<string, any>, options: Record<string, any> | undefined) {`,
        `\t\tconst original = this.toObject(data, { ...options, defaults: true });`,
        '',
        ...(unionFields.flatMap(([fieldName, fieldTypes, fieldUnionName, isArray]) => {
          const dataExpression = isArray ? `original[${JSON.stringify(fieldName)}][idx]` : `original[${JSON.stringify(fieldName)}]`;
          const nullOptionIndex = fieldTypes.findIndex(child => getScalar(child) === "null");

          const assignmentCollectExpression = fieldTypes.flatMap(
            (_, idx) => idx !== nullOptionIndex ? [`${dataExpression}.option${idx + 1}`] : []
          ).join(' ?? ');
          const assignmentLineExpression = nullOptionIndex !== -1 ? (
            `${dataExpression}.option${nullOptionIndex + 1} === 0 ? null : (${assignmentCollectExpression})`
          ) : assignmentCollectExpression;

          return isArray ? [
            `if (original[${JSON.stringify(fieldName)}] !== undefined) {`,
            `\toriginal[${JSON.stringify(fieldName)}].forEach((_: any, idx: number) => {`,
            `\t\tif (${dataExpression} !== undefined) {`,
            `\t\t\t${dataExpression} = ${assignmentLineExpression};`,
            `\t\t}`,
            `\t});`,
            `}`,
            '',
          ] : [
            `if (${dataExpression} !== undefined) {`,
            `\t${dataExpression} = ${assignmentLineExpression};`,
            `}`,
            '',
          ];
        })).map(line => `\t\t${line}`),
        ...(enumFields.flatMap(([fieldName, enumName]) => [
          `\t\toriginal[${JSON.stringify(fieldName)}] = ${getEnumToTypescriptEnumTranslatorVar(enumName)}[original[${JSON.stringify(fieldName)}] ?? 0];`,
        ])),
        ...(nullFields.flatMap(([fieldName, isArray]) => [
          `\t\toriginal[${JSON.stringify(fieldName)}] = original[${JSON.stringify(fieldName)}] !== undefined ? ${(isArray ? `original[${JSON.stringify(fieldName)}].map(() => null)` : `null`)} : undefined;`,
        ])),
        ...(literalFields.flatMap(([fieldName, literalKey]) => [
          `\t\toriginal[${JSON.stringify(fieldName)}] = ${getEnumToLiteralTranslatorVar(literalKey)}[original[${JSON.stringify(fieldName)}] ?? 0];`,
        ])),
        ...escapedFields.flatMap(([fieldName, fieldOriginalName]) => [
          `\toriginal[${JSON.stringify(fieldOriginalName)}] = original[${JSON.stringify(fieldName)}];`,
          `\tdelete original[${JSON.stringify(fieldName)}];`,
        ]),
        '',
        `\t\treturn original`,
        `\t},`,
        `};`,
        '',
      ].map(line => `\t${line}`) : [];
    }),
    '',
    '\treturn root;',
    '}',
    '',
  ].join('\n');

  return {
    libFileContent,
    protoFileContent,
  };
}
