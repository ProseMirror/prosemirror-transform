const {Transform, Step, Mapping, TransformError, liftTarget, findWrapping} = require("../src")
const {Node} = require("prosemirror-model")
const assert = require("assert")

function invert(transform) {
  let out = new Transform(transform.doc)
  for (let i = transform.steps.length - 1; i >= 0; i--)
    out.step(transform.steps[i].invert(transform.docs[i]))
  return out
}

function testMapping(mapping, pos, newPos, label) {
  let mapped = mapping.map(pos, 1)
  assert.equal(mapped, newPos, label)

  let remap = new Mapping(mapping.maps.map(m => m.invert()))
  for (let i = mapping.maps.length - 1, mapFrom = mapping.maps.length; i >= 0; i--)
    remap.appendMap(mapping.maps[i], --mapFrom)
  assert.equal(remap.map(pos, 1), pos, label + " round trip")
}

function testStepJSON(tr) {
  let newTR = new Transform(tr.before)
  tr.steps.forEach(step => newTR.step(Step.fromJSON(tr.doc.type.schema, step.toJSON())))
  assert(tr.doc.eq(newTR.doc), "survived JSON serialization")
}

function testTransform(tr, expect) {
  assert(tr.doc.eq(expect), "expected result")
  assert(invert(tr).doc.eq(tr.before), "inverted")

  testStepJSON(tr)

  for (let tag in expect.tag)
    testMapping(tr.mapping, tr.before.tag[tag], expect.tag[tag], tag)
}
exports.testTransform = testTransform
