import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
async function check(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await check(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node): void {
      if (
        node.kind === ts.SyntaxKind.AnyKeyword ||
        node.kind === ts.SyntaxKind.UnknownKeyword
      ) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        throw new Error(`Unrestricted type in ${path}:${line}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const directory of ["src", "scripts", "tests"]) await check(directory);
