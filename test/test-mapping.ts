const ist = require("ist")
const {Mapping, StepMap} = require("..")

function testMapping(mapping, ...cases) {
  let inverted = mapping.invert()
  for (let i = 0; i < cases.length; i++) {
    let [from, to, bias = 1, lossy] = cases[i]
    ist(mapping.map(from, bias), to)
    if (!lossy) ist(inverted.map(to, bias), from)
  }
}

function mk(...args) {
  let mapping = new Mapping
  args.forEach(arg => {
    if (Array.isArray(arg)) mapping.appendMap(new StepMap(arg))
    else for (let from in arg) mapping.setMirror(from, arg[from])
  })
  return mapping
}

describe("Mapping", () => {
  it("can map through a single insertion", () => {
    testMapping(mk([2, 0, 4]), [0, 0], [2, 6], [2, 2, -1], [3, 7])
  })

  it("can map through a single deletion", () => {
    testMapping(mk([2, 4, 0]), [0, 0], [2, 2, -1], [3, 2, 1, true], [6, 2, 1], [6, 2, -1, true], [7, 3])
  })

  it("can map through a single replace", () => {
    testMapping(mk([2, 4, 4]), [0, 0], [2, 2, 1], [4, 6, 1, true], [4, 2, -1, true], [6, 6, -1], [8, 8])
  })

  it("can map through a mirrorred delete-insert", () => {
    testMapping(mk([2, 4, 0], [2, 0, 4], {0: 1}), [0, 0], [2, 2], [4, 4], [6, 6], [7, 7])
  })

  it("cap map through a mirrorred insert-delete", () => {
    testMapping(mk([2, 0, 4], [2, 4, 0], {0: 1}), [0, 0], [2, 2], [3, 3])
  })

  it("can map through an delete-insert with an insert in between", () => {
    testMapping(mk([2, 4, 0], [1, 0, 1], [3, 0, 4], {0: 2}), [0, 0], [1, 2], [4, 5], [6, 7], [7, 8])
  })
})
