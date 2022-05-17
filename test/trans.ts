const {Transform, Step, Mapping} = require("..")
const {eq} = require("prosemirror-test-builder")
const ist = require("ist")

function invert(transform) {
  let out = new Transform(transform.doc)
  for (let i = transform.steps.length - 1; i >= 0; i--)
    out.step(transform.steps[i].invert(transform.docs[i]))
  return out
}

function testMapping(mapping, pos, newPos) {
  let mapped = mapping.map(pos, 1)
  ist(mapped, newPos)

  let remap = new Mapping(mapping.maps.map(m => m.invert()))
  for (let i = mapping.maps.length - 1, mapFrom = mapping.maps.length; i >= 0; i--)
    remap.appendMap(mapping.maps[i], --mapFrom)
  ist(remap.map(pos, 1), pos)
}

function testStepJSON(tr) {
  let newTR = new Transform(tr.before)
  tr.steps.forEach(step => newTR.step(Step.fromJSON(tr.doc.type.schema, step.toJSON())))
  ist(tr.doc, newTR.doc, eq)
}

function testTransform(tr, expect) {
  ist(tr.doc, expect, eq)
  ist(invert(tr).doc, tr.before, eq)

  testStepJSON(tr)

  for (let tag in expect.tag)
    testMapping(tr.mapping, tr.before.tag[tag], expect.tag[tag])
}
exports.testTransform = testTransform
