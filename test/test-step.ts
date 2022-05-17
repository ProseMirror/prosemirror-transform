import {Slice, Fragment} from "prosemirror-model"
import {ReplaceStep, AddMarkStep, RemoveMarkStep} from "prosemirror-transform"
import ist from "ist"
import {eq, schema, doc, p} from "prosemirror-test-builder"

const testDoc = doc(p("foobar"))

function mkStep(from: number, to: number, val: string | null) {
  if (val == "+em")
    return new AddMarkStep(from, to, schema.marks.em.create())
  else if (val == "-em")
    return new RemoveMarkStep(from, to, schema.marks.em.create())
  else
    return new ReplaceStep(from, to, val == null ? Slice.empty : new Slice(Fragment.from(schema.text(val)), 0, 0))
}

describe("Step", () => {
  describe("merge", () => {
    function yes(from1: number, to1: number, val1: string | null, from2: number, to2: number, val2: string | null) {
      return () => {
        let step1 = mkStep(from1, to1, val1), step2 = mkStep(from2, to2, val2)
        let merged = step1.merge(step2)
        ist(merged)
        ist(merged!.apply(testDoc).doc, step2.apply(step1.apply(testDoc).doc!).doc, eq)
      }
    }
    function no(from1: number, to1: number, val1: string | null, from2: number, to2: number, val2: string | null) {
      return () => {
        let step1 = mkStep(from1, to1, val1), step2 = mkStep(from2, to2, val2)
        ist(!step1.merge(step2))
      }
    }

    it("merges typing changes", yes(2, 2, "a", 3, 3, "b"))

    it("merges inverse typing", yes(2, 2, "a", 2, 2, "b"))

    it("doesn't merge separated typing", no(2, 2, "a", 4, 4, "b"))

    it("doesn't merge inverted separated typing", no(3, 3, "a", 2, 2, "b"))

    it("merges adjacent backspaces", yes(3, 4, null, 2, 3, null))

    it("merges adjacent deletes", yes(2, 3, null, 2, 3, null))

    it("doesn't merge separate backspaces", no(1, 2, null, 2, 3, null))

    it("merges backspace and type", yes(2, 3, null, 2, 2, "x"))

    it("merges longer adjacent inserts", yes(2, 2, "quux", 6, 6, "baz"))

    it("merges inverted longer inserts", yes(2, 2, "quux", 2, 2, "baz"))

    it("merges longer deletes", yes(2, 5, null, 2, 4, null))

    it("merges inverted longer deletes", yes(4, 6, null, 2, 4, null))

    it("merges overwrites", yes(3, 4, "x", 4, 5, "y"))

    it("merges adding adjacent styles", yes(1, 2, "+em", 2, 4, "+em"))

    it("merges adding overlapping styles", yes(1, 3, "+em", 2, 4, "+em"))

    it("doesn't merge separate styles", no(1, 2, "+em", 3, 4, "+em"))

    it("merges removing adjacent styles", yes(1, 2, "-em", 2, 4, "-em"))

    it("merges removing overlapping styles", yes(1, 3, "-em", 2, 4, "-em"))

    it("doesn't merge removing separate styles", no(1, 2, "-em", 3, 4, "-em"))
  })
})
