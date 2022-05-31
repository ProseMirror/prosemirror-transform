import ist from "ist"
import {Mapping, StepMap} from "prosemirror-transform"

function testMapping(mapping: Mapping, ...cases: [number, number, number?, boolean?][]) {
  let inverted = mapping.invert()
  for (let i = 0; i < cases.length; i++) {
    let [from, to, bias = 1, lossy] = cases[i]
    ist(mapping.map(from, bias), to)
    if (!lossy) ist(inverted.map(to, bias), from)
  }
}

function testDel(mapping: Mapping, pos: number, side: number, flags: string) {
  let r = mapping.mapResult(pos, side), found = ""
  if (r.deleted) found += "d"
  if (r.deletedBefore) found += "b"
  if (r.deletedAfter) found += "a"
  if (r.deletedAcross) found += "x"
  ist(found, flags)
}

function mk(...args: (number[] | {[from: number]: number})[]) {
  let mapping = new Mapping
  args.forEach(arg => {
    if (Array.isArray(arg)) mapping.appendMap(new StepMap(arg))
    else for (let from in arg) mapping.setMirror(+from, arg[from])
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

  it("assigns the correct deleted flags when deletions happen before", () => {
    testDel(mk([0, 2, 0]), 2, -1, "db")
    testDel(mk([0, 2, 0]), 2, 1, "b")
    testDel(mk([0, 2, 2]), 2, -1, "db")
    testDel(mk([0, 1, 0], [0, 1, 0]), 2, -1, "db")
    testDel(mk([0, 1, 0]), 2, -1, "")
  })

  it("assigns the correct deleted flags when deletions happen after", () => {
    testDel(mk([2, 2, 0]), 2, -1, "a")
    testDel(mk([2, 2, 0]), 2, 1, "da")
    testDel(mk([2, 2, 2]), 2, 1, "da")
    testDel(mk([2, 1, 0], [2, 1, 0]), 2, 1, "da")
    testDel(mk([3, 2, 0]), 2, -1, "")
  })

  it("assigns the correct deleted flags when deletions happen across", () => {
    testDel(mk([0, 4, 0]), 2, -1, "dbax")
    testDel(mk([0, 4, 0]), 2, 1, "dbax")
    testDel(mk([0, 4, 0]), 2, 1, "dbax")
    testDel(mk([0, 1, 0], [4, 1, 0], [0, 3, 0]), 2, 1, "dbax")
  })

  it("assigns the correct deleted flags when deletions happen around", () => {
    testDel(mk([4, 1, 0], [0, 1, 0]), 2, -1, "")
    testDel(mk([2, 1, 0], [0, 2, 0]), 2, -1, "dba")
    testDel(mk([2, 1, 0], [0, 1, 0]), 2, -1, "a")
    testDel(mk([3, 1, 0], [0, 2, 0]), 2, -1, "db")
  })
})
