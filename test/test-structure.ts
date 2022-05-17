import {Schema, Slice, Node} from "prosemirror-model"
import {canSplit, liftTarget, findWrapping, Transform} from "prosemirror-transform"
import {eq, schema as baseSchema} from "prosemirror-test-builder"
import ist from "ist"

const schema = new Schema({
  nodes: {
    doc: {content: "head? block* sect* closing?"},
    para: {content: "text*", group: "block"},
    head: {content: "text*", marks: ""},
    figure: {content: "caption figureimage", group: "block"},
    quote: {content: "block+", group: "block"},
    figureimage: {},
    caption: {content: "text*", marks: ""},
    sect: {content: "head block* sect*"},
    closing: {content: "text*"},
    text: baseSchema.spec.nodes.get("text")!,

    fixed: {content: "head para closing", group: "block"}
  },
  marks: {
    em: {}
  }
})

function n(name: string, ...content: Node[]) { return schema.nodes[name].create(null, content) }
function t(str: string, em = false) { return schema.text(str, em ? [schema.mark("em")] : null) }

const doc = n("doc", // 0
              n("head", t("Head")), // 6
              n("para", t("Intro")), // 13
              n("sect", // 14
                n("head", t("Section head")), // 28
                n("sect", // 29
                  n("head", t("Subsection head")), // 46
                  n("para", t("Subtext")), // 55
                  n("figure", // 56
                    n("caption", t("Figure caption")), // 72
                    n("figureimage")), // 74
                  n("quote", n("para", t("!"))))), // 81
              n("sect", // 82
                n("head", t("S2")), // 86
                n("para", t("Yes"))), // 92
              n("closing", t("fin"))) // 97

function range(pos: number, end?: number) {
  return doc.resolve(pos).blockRange(end == null ? undefined : doc.resolve(end))
}

describe("canSplit", () => {
  function yes(pos: number, depth?: number, after?: string) {
    return () => ist(canSplit(doc, pos, depth, after == null ? undefined : [{type: schema.nodes[after]}]))
  }
  function no(pos: number, depth?: number, after?: string) {
    return () => ist(!canSplit(doc, pos, depth, after == null ? undefined : [{type: schema.nodes[after]}]))
  }

  it("can't at start", no(0))
  it("can't in head", no(3))
  it("can by making head a para", yes(3, 1, "para"))
  it("can't on top level", no(6))
  it("can in regular para", yes(8))
  it("can't at start of section", no(14))
  it("can't in section head", no(17))
  it("can if also splitting the section", yes(17, 2))
  it("can if making the remaining head a para", yes(18, 1, "para"))
  it("can't after the section head", no(46))
  it("can in the first section para", yes(48))
  it("can't in the figure caption", no(60))
  it("can't if it also splits the figure", no(62, 2))
  it("can't after the figure caption", no(72))
  it("can in the first para in a quote", yes(76))
  it("can if it also splits the quote", yes(77, 2))
  it("can't at the end of the document", no(97))

  it("doesn't return true when the split-off content doesn't fit in the given node type", () => {
    let s = new Schema({nodes: schema.spec.nodes.addBefore("heading", "title", {content: "text*"})
                        .addToEnd("chapter", {content: "title scene+"})
                        .addToEnd("scene", {content: "para+"})
                        .update("doc", {content: "chapter+"})})
    ist(!canSplit(s.node("doc", null, s.node("chapter", null, [
      s.node("title", null, s.text("title")),
      s.node("scene", null, s.node("para", null, s.text("scene")))
    ])), 4, 1, [{type: s.nodes.scene}]))
  })
})

describe("liftTarget", () => {
  function yes(pos: number) {
    return () => { let r = range(pos); ist(r && liftTarget(r)) }
  }
  function no(pos: number) {
    return () => { let r = range(pos); ist(!(r && liftTarget(r))) }
  }

  it("can't at the start of the doc", no(0))
  it("can't in the heading", no(3))
  it("can't in a subsection para", no(52))
  it("can't in a figure caption", no(70))
  it("can from a quote", yes(76))
  it("can't in a section head", no(86))
})

describe("findWrapping", () => {
  function yes(pos: number, end: number, type: string) {
    return () => { let r = range(pos, end); ist(r && findWrapping(r, schema.nodes[type])) }
  }
  function no(pos: number, end: number, type: string) {
    return () => { let r = range(pos, end); ist(!r || !findWrapping(r, schema.nodes[type])) }
  }

  it("can wrap the whole doc in a section", yes(0, 92, "sect"))
  it("can't wrap a head before a para in a section", no(4, 4, "sect"))
  it("can wrap a top paragraph in a quote", yes(8, 8, "quote"))
  it("can't wrap a section head in a quote", no(18, 18, "quote"))
  it("can wrap a figure in a quote", yes(55, 74, "quote"))
  it("can't wrap a head in a figure", no(90, 90, "figure"))
})

describe("Transform", () => {
  describe("replace", () => {
    function repl(doc: Node, from: number, to: number, content: Node | null, openStart: number, openEnd: number, result: Node) {
      return () => {
        let slice = content ? new Slice(content.content, openStart, openEnd) : Slice.empty
        let tr = new Transform(doc).replace(from, to, slice)
        ist(tr.doc, result, eq)
      }
    }

    it("automatically adds a heading to a section",
       repl(n("doc", n("sect", n("head", t("foo")), n("para", t("bar")))),
            6, 6, n("doc", n("sect"), n("sect")), 1, 1,
            n("doc", n("sect", n("head", t("foo"))), n("sect", n("head"), n("para", t("bar"))))))

    it("suppresses impossible inputs",
       repl(n("doc", n("para", t("a")), n("para", t("b"))),
            3, 3, n("doc", n("closing", t("."))), 0, 0,
            n("doc", n("para", t("a")), n("para", t("b")))))

    it("adds necessary nodes to the left",
       repl(n("doc", n("sect", n("head", t("foo")), n("para", t("bar")))),
            1, 3, n("doc", n("sect"), n("sect", n("head", t("hi")))), 1, 2,
            n("doc", n("sect", n("head")), n("sect", n("head", t("hioo")), n("para", t("bar"))))))

    it("adds a caption to a figure",
       repl(n("doc"),
            0, 0, n("doc", n("figure", n("figureimage"))), 1, 0,
            n("doc", n("figure", n("caption"), n("figureimage")))))

    it("adds an image to a figure",
       repl(n("doc"),
            0, 0, n("doc", n("figure", n("caption"))), 0, 1,
            n("doc", n("figure", n("caption"), n("figureimage")))))

    it("can join figures",
       repl(n("doc", n("figure", n("caption"), n("figureimage")), n("figure", n("caption"), n("figureimage"))),
            3, 8, null, 0, 0,
            n("doc", n("figure", n("caption"), n("figureimage")))))

    it("adds necessary nodes to a parent node",
       repl(n("doc", n("sect", n("head"), n("figure", n("caption"), n("figureimage")))),
            7, 9, n("doc", n("para", t("hi"))), 0, 0,
            n("doc", n("sect", n("head"), n("figure", n("caption"), n("figureimage")), n("para", t("hi"))))))
  })
})
