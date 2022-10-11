import {InterfaceDeclaration, PropertySignature, SourceFile, SyntaxKind, Type} from "ts-morph";
import {Config} from "./config";
import path from "path";

export function generateProtoAndSetupFile(
  source: SourceFile,
  config: Config,
): {
  protoFileContent: string;
  staticInjector: (content: string) => string;
} {
  const lines: string[] = ["syntax = \"proto3\";", ""];
  const collectedNodes = new Set<string>();
  const collectedInterfaces: string[] = [];
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

  function getUnionFieldToOptionTranslatorVar(name: string, field: string) {
    return `union_opt_${name}_${field}`;
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
  function createOrCollectUnion(types: Type[], prefix: string): string {
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
      collectedInterfaces.push(name);

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
                ...(fieldType === "optional " ? [undefined] : []),
                ...requiredUnionTypes.flatMap((child) => child.isStringLiteral() ? [<string> child.getLiteralValue()] : []),
              ];

              if (!(name in interfaceLiteralFields)) {
                interfaceLiteralFields[name] = [];
              }

              interfaceLiteralFields[name].push([getEscapedFieldName(member), literalKey]);
              literalEnumDefinitions[literalKey] = literalValues;

              if (literalValues.length > 1) {
                callbacks.push(
                  () => createLiteralEnum(literalKey, literalValues),
                );
              } else {
                return;
              }

              fieldType = literalKey;
            } else if (requiredUnionTypes.length === 1) {
              memberType = requiredUnionTypes[0];
            } else {

              if (!(name in interfaceUnionFields)) {
                interfaceUnionFields[name] = [];
              }

              fieldType = createOrCollectUnion(
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

  const staticInjector = (content: string) => {
    function makeInterfaceFieldUnionInterfaceNameGetter(key: string, dataExpression: string) {
      const makeGetter = config.unionInterfaceNameGetter?.[key];

      if (!makeGetter) {
        throw new Error(`Config is missing union interface name getter for entry ${key}`);
      } else {
        return makeGetter(dataExpression);
      }
    }

    function getUnionToOptionKey(type: Type) {
      const scalarType = getScalar(type);

      if (scalarType) {
        return scalarType;
      } else if (type.isInterface()) {
        return type.getSymbolOrThrow().getName();
      } else {
        throw new Error('Unexpected Union Type');
      }
    }

    function getRootInjection() {
      return [
        ...Object.entries(literalEnumDefinitions).map(([key, values]) => `const ${getLiteralToEnumTranslatorVar(key)} = {${values.flatMap((value, idx) => value === undefined ? [] : [JSON.stringify(value) + ': ' + idx.toString()]).join(", ")}};`),
        '',
        ...Object.entries(literalEnumDefinitions).map(([key, values]) => `const ${getEnumToLiteralTranslatorVar(key)} = [${values.map((value) => value === undefined ? 'undefined' : JSON.stringify(value)).join(", ")}];`),
        '',
        ...source.getEnums().map(enumDec => `const ${getTypescriptEnumToEnumTranslatorVar(enumDec.getName())} = {${enumDec.getMembers().flatMap((mem, idx) => [JSON.stringify(mem.getValue()) + ': ' + (idx + 1).toString()]).join(", ")}};`),
        '',
        ...source.getEnums().map(enumDec => `const ${getEnumToTypescriptEnumTranslatorVar(enumDec.getName())} = [undefined, ${enumDec.getMembers().map((mem) => JSON.stringify(mem.getValue())).join(", ")}];`),
        '',
        ...Object.entries(interfaceUnionFields).flatMap(([name, unionFields]) => unionFields.map(
          ([fieldName, types]) => `const ${getUnionFieldToOptionTranslatorVar(name, fieldName)} = {${types.map((type, idx) => `${getUnionToOptionKey(type)}: "option${idx + 1}"`).join(", ")}};`,
        )),
        '',
      ]
    }

    function getInterfaceInjections(
      intDec: InterfaceDeclaration,
    ): { fromObject: string[]; toObject: string[]; } {
      const name = intDec.getName();
      const unionFields = interfaceUnionFields[name] ?? [];
      const enumFields = interfaceEnumFields[name] ?? [];
      const nullFields = interfaceNullFields[name] ?? [];
      const escapedFields = interfaceEscapedFieldTranslation[name] ?? [];
      const literalFields = interfaceLiteralFields[name] ?? [];

      const fieldExpression = (fieldName: string) => `object[${JSON.stringify(fieldName)}]`;

      const fromObject = [
        ...escapedFields.flatMap(([fieldName, fieldOriginalName]) => [
          `${fieldExpression(fieldName)} = ${fieldExpression(fieldOriginalName)};`,
          `delete ${fieldExpression(fieldOriginalName)};`,
        ]),
        ...unionFields.flatMap(([fieldName, fieldTypes, fieldUnionName, isArray]) => {
          const dataExpression = fieldExpression(fieldName) + (isArray ? "[idx]" : "");

          const nonScalarFieldTypes = fieldTypes.filter(child => !getScalar(child));

          const hasInterfaceType = nonScalarFieldTypes.length > 0;
          const hasNullType = fieldTypes.some(child => child.isNull());

          const uniqueNonNullScalar = fieldTypes.find(child => getScalar(child) && !child.isNull());
          let typeExpression = uniqueNonNullScalar ? JSON.stringify(getScalar(uniqueNonNullScalar)) : `typeof ${dataExpression}`;

          if (hasInterfaceType) {
            const objectTypeExpression = nonScalarFieldTypes.length === 1 ? JSON.stringify(nonScalarFieldTypes[0].getSymbolOrThrow().getName()) : makeInterfaceFieldUnionInterfaceNameGetter(
              fieldUnionName ?? (intDec.getName() + "." + fieldName),
              dataExpression,
            );

            typeExpression = `typeof ${dataExpression} === 'object' ? (${objectTypeExpression}) : (${typeExpression})`;
          }

          if (hasNullType) {
            typeExpression = `${dataExpression} === null ? "null" : (${typeExpression})`;
          }

          return [
            '',
            `if (${fieldExpression(fieldName)} !== undefined) {`,
            ...(isArray ? [
              `\t${fieldExpression(fieldName)}.forEach((_, idx) => {`,
            ] : []),
            ...[
              `${dataExpression} = { [${getUnionFieldToOptionTranslatorVar(name, fieldName)}[${typeExpression}]]: ${dataExpression} };`,
            ].map(line => isArray ? `\t\t${line}` : `\t${line}`),
            ...(isArray ? [
              '\t});',
            ] : []),
            `}`,
            '',
          ];
        }),
        ...(enumFields.flatMap(([fieldName, enumName]) => [
          `${fieldExpression(fieldName)} = ${getTypescriptEnumToEnumTranslatorVar(enumName)}[${fieldExpression(fieldName)}];`,
        ])),
        ...(nullFields.flatMap(([fieldName, isArray]) => [
          `${fieldExpression(fieldName)} = ${fieldExpression(fieldName)} !== undefined ? ${(isArray ? `${fieldExpression(fieldName)}.map(() => 0)` : `0`)} : undefined;`,
        ])),
        ...(literalFields.flatMap(([fieldName, literalKey]) => literalEnumDefinitions[literalKey].length === 1 ? [] : [
          `${fieldExpression(fieldName)} = ${getLiteralToEnumTranslatorVar(literalKey)}[${fieldExpression(fieldName)}];`,
        ])),
      ];

      const toObject = [
        ...(unionFields.flatMap(([fieldName, fieldTypes, fieldUnionName, isArray]) => {
          const dataExpression = fieldExpression(fieldName) + (isArray ? "[idx]" : "");
          const nullOptionIndex = fieldTypes.findIndex(child => getScalar(child) === "null");

          const assignmentCollectExpression = fieldTypes.flatMap(
            (_, idx) => idx !== nullOptionIndex ? [`${dataExpression}.option${idx + 1}`] : []
          ).join(' ?? ');
          const assignmentLineExpression = nullOptionIndex !== -1 ? (
            `${dataExpression}.option${nullOptionIndex + 1} === 0 ? null : (${assignmentCollectExpression})`
          ) : assignmentCollectExpression;

          return isArray ? [
            `if (${fieldExpression(fieldName)} !== undefined) {`,
            `\t${fieldExpression(fieldName)}.forEach((_, idx) => {`,
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
        })),
        ...(enumFields.flatMap(([fieldName, enumName]) => [
          `${fieldExpression(fieldName)} = ${getEnumToTypescriptEnumTranslatorVar(enumName)}[${fieldExpression(fieldName)} ?? 0];`,
        ])),
        ...(nullFields.flatMap(([fieldName, isArray]) => [
          `${fieldExpression(fieldName)} = ${fieldExpression(fieldName)} !== undefined ? ${(isArray ? `${fieldExpression(fieldName)}.map(() => null)` : `null`)} : undefined;`,
        ])),
        ...(literalFields.flatMap(([fieldName, literalKey]) => literalEnumDefinitions[literalKey].length === 1 ? [
          `${fieldExpression(fieldName)} = ${JSON.stringify(literalEnumDefinitions[literalKey][0])};`,
        ] : [
          `${fieldExpression(fieldName)} = ${getEnumToLiteralTranslatorVar(literalKey)}[${fieldExpression(fieldName)} ?? 0];`,
        ])),
        ...escapedFields.flatMap(([fieldName, fieldOriginalName]) => [
          `${fieldExpression(fieldOriginalName)} = ${fieldExpression(fieldName)};`,
          `delete ${fieldExpression(fieldName)};`,
        ]),
      ];

      return {
        fromObject, toObject,
      };
    }

    const contentLines = content.split("\n");

    const compiledFunctionRootLine = contentLines.findIndex(
      line => line.startsWith(`"use strict";`),
    );

    if (compiledFunctionRootLine === -1) {
      throw new Error('Failed to compile');
    } else {
      contentLines.splice(compiledFunctionRootLine + 2, 0, ...getRootInjection());
    }

    collectedInterfaces.forEach((name) => {
      const intDec = source.getInterfaceOrThrow(name);
      const { fromObject, toObject } = getInterfaceInjections(intDec);

      const fromObjectLine = contentLines.findIndex(line => line.trim() === `${name}.fromObject = function fromObject(object) {`);

      if (fromObjectLine === -1) {
        throw new Error('Failed to compile');
      } else {
        contentLines.splice(
          fromObjectLine + 3,
          0,
          ...['', '/** FromObject Injection START **/', ...fromObject, '/** FromObject Injection END **/', ''].map(line => `\t\t${line}`)
        );
      }

      const toObjectLine = contentLines.findIndex(
        (line, idx) => line.trim() === "};" && contentLines.some(
          (priorLine, jdx) => jdx < idx && priorLine.trim() === `${name}.toObject = function toObject(message, options) {`
        ),
      );

      if (toObjectLine === -1) {
        throw new Error('Failed to compile');
      } else {
        contentLines.splice(
          toObjectLine - 1,
          0,
          ...['', '/** ToObject Injection START **/', ...toObject, '/** ToObject Injection END **/', ''].map(line => `\t\t${line}`)
        );
      }
    });

    return contentLines.join("\n");
  }

  return {
    staticInjector,
    protoFileContent,
  };
}
