import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(
  packageRoot,
  "../../crates/synapse-protocol/schema/openapi.json",
);
const generatedDirectory = resolve(packageRoot, "src/generated");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const schemas = schema.components.schemas;

function typeFor(schema) {
  if (schema.$ref) {
    return schema.$ref.split("/").at(-1);
  }
  if (Object.hasOwn(schema, "const")) {
    return JSON.stringify(schema.const);
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => typeFor({ ...schema, type })).join(" | ");
  }
  if (schema.type === "array") {
    return `${typeFor(schema.items)}[]`;
  }
  if (schema.type === "null") {
    return "null";
  }
  if (
    schema.type === "integer" ||
    schema.type === "number" ||
    schema.minimum !== undefined
  ) {
    return "number";
  }
  if (schema.type === "string" || schema.format || schema.pattern) {
    return "string";
  }
  return "unknown";
}

function renderTypes() {
  const declarations = Object.entries(schemas).map(([name, schema]) => {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(
      ([property, propertySchema]) =>
        `  ${property}${required.has(property) ? "" : "?"}: ${typeFor(propertySchema)};`,
    );

    return [`export interface ${name} {`, ...properties, "}"].join("\n");
  });

  return [
    "// Generated from crates/synapse-protocol/schema/openapi.json. DO NOT EDIT.",
    "",
    ...declarations,
    "",
  ].join("\n");
}

function renderClient() {
  return [
    "// Generated from crates/synapse-protocol/schema/openapi.json. DO NOT EDIT.",
    'import type { EncryptedPushOperation } from "./types";',
    "",
    "export function serializeEncryptedPushOperation(",
    "  operation: EncryptedPushOperation,",
    "): string {",
    "  return JSON.stringify(operation);",
    "}",
    "",
  ].join("\n");
}

function renderIndex() {
  return [
    "// Generated from crates/synapse-protocol/schema/openapi.json. DO NOT EDIT.",
    'export * from "./client";',
    'export * from "./types";',
    "",
  ].join("\n");
}

await Promise.all([
  writeFile(resolve(generatedDirectory, "types.ts"), renderTypes()),
  writeFile(resolve(generatedDirectory, "client.ts"), renderClient()),
  writeFile(resolve(generatedDirectory, "index.ts"), renderIndex()),
]);
