import {Node, Schema, NodeSpec, MarkSpec} from "prosemirror-model"
import {Transform, Mapping, Step} from "prosemirror-transform"
import {eq} from "prosemirror-test-builder"
import ist from "ist"

function invert(transform: Transform) {
  let out = new Transform(transform.doc)
  for (let i = transform.steps.length - 1; i >= 0; i--)
    out.step(transform.steps[i].invert(transform.docs[i]))
  return out
}

function testMapping(mapping: Mapping, pos: number, newPos: number) {
  let mapped = mapping.map(pos, 1)
  ist(mapped, newPos)

  let remap = new Mapping(mapping.maps.map(m => m.invert()))
  for (let i = mapping.maps.length - 1, mapFrom = mapping.maps.length; i >= 0; i--)
    remap.appendMap(mapping.maps[i], --mapFrom)
  ist(remap.map(pos, 1), pos)
}

function testStepJSON(tr: Transform) {
  let newTR = new Transform(tr.before)
  tr.steps.forEach(step => newTR.step(Step.fromJSON(tr.doc.type.schema, step.toJSON())))
  ist(tr.doc, newTR.doc, eq)
}

export function testTransform(tr: Transform, expect: Node) {
  outputTransform(tr, expect)
  ist(tr.doc, expect, eq)
  ist(invert(tr).doc, tr.before, eq)

  testStepJSON(tr)

  for (let tag in (expect as any).tag)
    testMapping(tr.mapping, (tr.before as any).tag[tag], (expect as any).tag[tag])
}

// Dumping tested transforms as JSON

declare const process: any

const outputFile = typeof process == "undefined" ? undefined : process.env["EMIT_JSON"]

let output: {
  schemas: Schema[],
  tests: {schema: number, start: any, steps: any[], result: any, mapping: [number, number][]}[]
} | null = outputFile ? {schemas: [], tests: []} : null

function outputTransform(tr: Transform, expected: Node) {
  if (output && tr.steps.length) {
    let mapping: [number, number][] = []
    for (let tag in (expected as any).tag)
      mapping.push([(tr.before as any).tag[tag], (expected as any).tag[tag]])
    output.tests.push({
      schema: storeSchema(tr.doc.type.schema),
      start: tr.before.toJSON(),
      steps: tr.steps.map(s => s.toJSON()),
      result: expected.toJSON(),
      mapping
    })
  }
}

function storeSchema(schema: Schema) {
  let known = output!.schemas.indexOf(schema)
  if (known > -1) return known
  return output!.schemas.push(schema) - 1
}

function schemaToJSON(schema: Schema) {
  let nodes: {[name: string]: NodeSpec} = {}, marks: {[name: string]: MarkSpec} = {}
  schema.spec.nodes.forEach((key, value) => nodes[key] = value)
  schema.spec.marks.forEach((key, value) => marks[key] = value)
  return {topNode: schema.topNodeType.name, nodes, marks}
}

if (output) {
  let writeFileSync: any
  import("fs" as any).then(fs => ({writeFileSync} = fs))
  process.on("exit", () => {
    writeFileSync(outputFile, JSON.stringify({
      schemas: output!.schemas.map(schemaToJSON),
      tests: output!.tests
    }, null, 2))
  })
}
