import {PropertySignature, SourceFile, SyntaxKind, Type} from "ts-morph";
import {Config} from "./config";
import path from "path";

export function generateProtoAndLibInjection(
  source: SourceFile,
  config: Config,
  libFilePath: string,
  pbjsLibFilePath: string,
  pbLibFilePath: string,
): {
  protoFileContent: string;
  libFileContent: string;
} {
  const lines: string[] = ["syntax = \"proto3\";", ""];
  const collectedNodes = new Set<string>();
  const collectedInterfaces = new Set<string>();

  const interfaceComplexFields: Record<string, [string, string, boolean][]> = {};
  const interfaceEscapedFieldTranslation: Record<string, [string, string][]> = {};

  const enumDefinitions: Record<string, unknown[]> = {};
  const unionDefinitions: Record<string, Type[]> = {};

  let indentLevel = 0;

  const NullEnum = "SpecialNullSubstitute";

  function registerComplexField(interfaceName: string, member: PropertySignature, complexName: string, isArray: boolean) {
    const memberInterfaceName = member.getParentOrThrow().getSymbolOrThrow().getName();

    if (!(memberInterfaceName in interfaceComplexFields)) {
      interfaceComplexFields[memberInterfaceName] = [];
    }

    if (interfaceComplexFields[memberInterfaceName].every(item => item[0] !== getEscapedFieldName(member))) {
      interfaceComplexFields[memberInterfaceName].push([getEscapedFieldName(member), complexName, isArray]);
    }
  }

  function getEscapedFieldName(member: PropertySignature) {
    return member.getName().replaceAll('_', '').toLocaleLowerCase();
  }

  function getValueToEnumTranslatorVar(key: string) {
    return `val_enum_${key}`;
  }

  function getEnumToValueTranslatorVar(key: string) {
    return `enum_val_${key}`;
  }

  function getUnionToOptionTranslatorVar(key: string) {
    return `translate_union_opt_${key}`;
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

  function getNumberEncoding(member?: PropertySignature) {
    return config.numberEncoding && member ? (
      config.numberEncoding.overrides?.[
        member.getParentOrThrow().getSymbolOrThrow().getName() + "." + member.getName()
      ] ?? config.numberEncoding.default
    ) : "float";
  }

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
        number: getNumberEncoding(member),
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
        collectEnum(effTypeName);

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
  function createOrCollectUnion(types: Type[], member: PropertySignature): string {
    const typeName = lookupUnion(types);
    const unionName = typeName ?? `Union_${unionId}_${member.getParentOrThrow().getSymbolOrThrow().getName()}_${getEscapedFieldName(member)}`;

    if (!typeName) {
      unionId += 1;
    }

    if (!collectedNodes.has(unionName)) {
      collectedNodes.add(unionName);

      // TODO: check multiple members using common union with different number encoding

      callbacks.push(() => {
        writeLine(`message ${unionName} {`);

        withIndent(() => {
          writeLine(`oneof options {`);
          withIndent(() => {
            types.forEach((type, idx) => {
              const parsed = parseType(type, member);
              writeLine(`${parsed?.[1] ?? 'undefined'} option${idx + 1} = ${idx + 2};`);
            });
          });
          writeLine(`}`);
        });

        writeLine('}');
        writeLine();
      });

      unionDefinitions[unionName] = types;
    }

    return unionName;
  }

  function createLiteralEnum(key: string, values: unknown[]) {
    const optionalValues = [undefined, ...values];

    callbacks.push(() => {
      writeLine(`enum ${key} {`);

      withIndent(() => {
        optionalValues.forEach((value, idx) => {
          writeLine(`${key}_${idx} = ${idx};`);
        });
      });

      writeLine('}');
      writeLine();
    });

    enumDefinitions[key] = optionalValues;
  }

  function collectEnum(name: string) {
    const node = source.getEnumOrThrow(name);

    if (!collectedNodes.has(name)) {
      collectedNodes.add(name);

      callbacks.push(() => {
        writeLine(`enum ${name} {`);

        withIndent(() => {
          (new Array(node.getMembers().length + 1)).fill(null).forEach((_, idx) => {
            writeLine(`${name.toUpperCase()}_${idx} = ${idx};`);
          });
        });

        writeLine(`}`);
        writeLine();
      });

      enumDefinitions[name] = [undefined, ...node.getMembers().map(mem => mem.getValue())];
    }
  }

  createLiteralEnum(NullEnum, [null]);

  function collectInterface(name: string) {
    const node = source.getInterfaceOrThrow(name);

    if (!collectedNodes.has(name)) {
      collectedNodes.add(name);
      collectedInterfaces.add(name);

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
              const literalValues = requiredUnionTypes.flatMap((child) => child.isStringLiteral() ? [<string> child.getLiteralValue()] : []);

              createLiteralEnum(literalKey, literalValues);

              fieldType = literalKey;
            } else if (requiredUnionTypes.length === 1) {
              memberType = requiredUnionTypes[0];
            } else {
              fieldType = createOrCollectUnion(
                requiredUnionTypes,
                member,
              );
            }
          }

          if (!fieldType) {
            fieldType = parseType(memberType, member)?.[1];
          }

          if (!fieldType) {
            throw new Error(`Could not determine field type of ${name}.${member.getName()}`);
          }

          if (fieldType in enumDefinitions || fieldType in unionDefinitions || collectedInterfaces.has(fieldType)) {
            registerComplexField(name, member, fieldType, fieldRule === 'repeated ');
          }

          writeLine(`${fieldRule}${fieldType} ${getEscapedFieldName(member)} = ${idx + 1};`);
        });
      });

      writeLine('}');
      writeLine();
    }
  }

  while (callbacks.length > 0) {
    callbacks.splice(0, 1)[0]();
  }

  const protoFileContent = lines.join('\n');

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

  const fieldExpression = (fieldName: string) => `object[${JSON.stringify(fieldName)}]`;

  const makeFunctionDecl = (
    complexName: string, functionName: string, args: string, content: string[], functionNameOverride?: string,
  ) => {
    return [
      `${complexName}.${functionName} = function ${functionNameOverride ?? functionName}(${args}) {`,
      ...content.map(line => `\t${line}`),
      `};`,
    ]
  };

  const makeIfElseChain = (items: [string, string[]][], elseContent?: string[]) => {
    return (items.map(item => `if (${item[0]}) {\n${item[1].map(line => `\t${line}`).join("\n")}\n}`).join(" else ") + (
      elseContent ? `else {\n` + elseContent.map(line => `\t${line}`).join("\n") + "}" : ''
    )).split("\n");
  };

  function makeUnionInterfaceNameGetter(key: string, dataExpression: string) {
    const makeGetter = config.unionInterfaceNameGetter?.[key];

    if (!makeGetter) {
      throw new Error(`Config is missing union interface name getter for entry ${key}`);
    } else {
      return makeGetter(dataExpression);
    }
  }

  function makeObjectTranslator(objectExpression: string, type: Type, target: "translateTo" | "translateFrom") {
    return type.isInterface() || type.isEnum() ? `${type.getSymbolOrThrow().getName()}.${target}(${objectExpression})` : objectExpression;
  }

  const moduleTranslation = {
    "protobufjs": "lib_pbjs",
    "protocol-buffers": "lib_pb",
  };

  const encoderModule = config.encodingModule ?? "protocol-buffers";
  const decoderModule = config.decodingModule ?? "protocol-buffers";

  function getDecoderEncoderFunctionExpression(type: "encode" | "decode", complexName: string, dataExpression: string) {
    const module = {
      encode: encoderModule,
      decode: decoderModule,
    }[type];

    const dataPrepExpression = {
      "protobufjs": type === "encode" ? `${moduleTranslation[module]}.${complexName}.fromObject(${dataExpression})` : dataExpression,
      "protocol-buffers": dataExpression,
    }[module];

    const dataProcExpression = `${moduleTranslation[module]}.${complexName}.${type}(${dataPrepExpression})${encoderModule === "protobufjs" && type === "encode" ? ".finish()" : ""}`;

    return {
      "protobufjs": type === "decode" ? `${moduleTranslation[module]}.${complexName}.toObject(${dataProcExpression})` : dataProcExpression,
      "protocol-buffers": dataProcExpression,
    }[module];
  }

  const complexObjects = [
    ...collectedInterfaces,
    ...Object.keys(enumDefinitions),
    ...Object.keys(unionDefinitions),
  ];

  const libFileContent = [
    `const lib_pbjs = require(${JSON.stringify("./" + path.relative(path.dirname(libFilePath), pbjsLibFilePath))});`,
    `const lib_pb = require(${JSON.stringify("./" + path.relative(path.dirname(libFilePath), pbLibFilePath))});`,

    '',

    ...complexObjects.flatMap((complexName) => [
      `const ${complexName} = {};`
    ]),

    '',

    ...[
      '/** Translation Variables **/',

      '',

      ...Object.entries(enumDefinitions).flatMap(([enumName, enumValues]) => [
        `const ${getValueToEnumTranslatorVar(enumName)} = {${enumValues.flatMap((value, idx) => value === undefined ? [] : [JSON.stringify(value) + ': ' + idx.toString()]).join(", ")}};`,
        `const ${getEnumToValueTranslatorVar(enumName)} = [${enumValues.map((value) => value === undefined ? 'undefined' : JSON.stringify(value)).join(", ")}];`,
      ]),

      ...Object.entries(unionDefinitions).flatMap(([unionName, unionTypes]) => [
        `const ${getUnionToOptionTranslatorVar(unionName)} = {`,
        ...unionTypes.map((type, idx) => `\t${getUnionToOptionKey(type)}: (object) => ({ "option${idx + 1}": ${makeObjectTranslator('object', type, 'translateTo')} }),`),
        '};',
      ]),

      '',
    ],
    ...[
      '/** translateTo Converters **/',

      '',

      ...Object.entries(enumDefinitions).flatMap(([enumName, enumValues]) => makeFunctionDecl(enumName, "translateTo", 'object', [
        enumValues.length === 1 ? 'return undefined;' : `return ${getValueToEnumTranslatorVar(enumName)}[object];`,
      ])),

      '',

      ...[...collectedInterfaces].flatMap((intName) => makeFunctionDecl(intName, "translateTo", 'object', [
        ...(interfaceEscapedFieldTranslation[intName] ?? []).flatMap(([fieldName, fieldOriginalName]) => [
          `${fieldExpression(fieldName)} = ${fieldExpression(fieldOriginalName)};`,
          `delete ${fieldExpression(fieldOriginalName)};`,
        ]),
        '',
        ...(interfaceComplexFields[intName] ?? []).flatMap(([fieldName, complexName, isArray]) => [
          `if (${fieldExpression(fieldName)} !== undefined) {`,
          ...[
            ...(isArray ? [
              `${fieldExpression(fieldName)}.forEach((_, idx) => {`,
              `\t${fieldExpression(fieldName)}[idx] = ${complexName}.translateTo(${fieldExpression(fieldName)}[idx]);`,
              `});`,
            ] : [
              `${fieldExpression(fieldName)} = ${complexName}.translateTo(${fieldExpression(fieldName)});`,
            ]),
          ].map(line => `\t${line}`),
          `}`,
        ]),
        '',
        'return object;',
      ])),

      '',

      ...Object.entries(unionDefinitions).flatMap(([unionName, unionTypes]) => makeFunctionDecl(unionName, "translateTo", 'object', (() => {
        const nonScalarFieldTypes = unionTypes.filter(child => !getScalar(child));

        const hasInterfaceType = nonScalarFieldTypes.length > 0;
        const hasNullType = unionTypes.some(child => child.isNull());

        const uniqueNonNullScalar = unionTypes.find(child => getScalar(child) && !child.isNull());
        let typeExpression = uniqueNonNullScalar ? JSON.stringify(getScalar(uniqueNonNullScalar)) : `typeof object`;

        if (hasInterfaceType) {
          const objectTypeExpression = nonScalarFieldTypes.length === 1 ? JSON.stringify(nonScalarFieldTypes[0].getSymbolOrThrow().getName()) : makeUnionInterfaceNameGetter(unionName, 'object');
          typeExpression = `typeof object === 'object' ? (${objectTypeExpression}) : (${typeExpression})`;
        }

        if (hasNullType) {
          typeExpression = `object === null ? "null" : (${typeExpression})`;
        }

        return [
          `return ${getUnionToOptionTranslatorVar(unionName)}[${typeExpression}](object);`
        ];
      })())),

      '',
    ],
    ...[
      '/** TranslateFrom Converters **/',
      '',

      ...Object.entries(enumDefinitions).flatMap(([enumName]) => makeFunctionDecl(enumName, "translateFrom", 'object', [
        `return ${getEnumToValueTranslatorVar(enumName)}[object || 0];`,
      ])),

      '',

      '',

      ...[...collectedInterfaces].flatMap((intName) => makeFunctionDecl(intName, "translateFrom", 'object', [
        ...source.getInterfaceOrThrow(intName).getChildrenOfKind(SyntaxKind.PropertySignature).flatMap((mem) => [
          `object.${getEscapedFieldName(mem)} = object.${getEscapedFieldName(mem)} === null ? undefined : object.${getEscapedFieldName(mem)};`
        ]),
        '',
        ...(interfaceComplexFields[intName] ?? []).flatMap(([fieldName, complexName, isArray]) => [
          `if (${fieldExpression(fieldName)} !== undefined) {`,
          ...[
            ...(isArray ? [
              `${fieldExpression(fieldName)}.forEach((_, idx) => {`,
              `\t${fieldExpression(fieldName)}[idx] = ${complexName}.translateFrom(${fieldExpression(fieldName)}[idx]);`,
              `});`,
            ] : [
              `${fieldExpression(fieldName)} = ${complexName}.translateFrom(${fieldExpression(fieldName)});`,
            ]),
          ].map(line => `\t${line}`),
          `}`,
          '',
        ]),
        '',
        ...(interfaceEscapedFieldTranslation[intName] ?? []).flatMap(([fieldName, fieldOriginalName]) => [
          `${fieldExpression(fieldOriginalName)} = ${fieldExpression(fieldName)};`,
          `delete ${fieldExpression(fieldName)};`,
        ]),
        '',
        'return object;',
      ])),

      ...Object.entries(unionDefinitions).flatMap(([unionName, unionTypes]) => makeFunctionDecl(unionName, "translateFrom", 'object', [
        ...makeIfElseChain(
          unionTypes.map(
            (type, idx) => [
              `object.option${idx + 1} !== undefined && object.option${idx + 1} !== null`, [
              `const data = ${makeObjectTranslator(`object.option${idx + 1}`, type, "translateFrom")};`,
              `delete object.option${idx + 1};`,
              `return data;`
            ],
          ]),
        ),
      ])),

      '',
    ],
    ...[
      '/** Encode/Decode Wrappers **/',

      '',

      ...[...collectedInterfaces, ...Object.keys(unionDefinitions)].flatMap((complexName) => [
        ...makeFunctionDecl(complexName, "encode", "object", [
          `const data = ${complexName}.translateTo(object);`,
          `return ${getDecoderEncoderFunctionExpression("encode", complexName, "data")};`
        ]),
        ...makeFunctionDecl(complexName, "decode", "buffer", [
          `const data = ${getDecoderEncoderFunctionExpression("decode", complexName, "buffer")};`,
          `return ${complexName}.translateFrom(data);`
        ]),
      ]),

      '',
    ],
    ...[
      '/** Module Exports **/',

      '',

      `module.exports = {`,

      ...complexObjects.flatMap((complexName) => [
        `${complexName}: ${complexName},`,
      ]).map(line => `\t${line}`),

      '};',

      '',
    ]
  ].join('\n');

  return {
    libFileContent,
    protoFileContent,
  };
}
