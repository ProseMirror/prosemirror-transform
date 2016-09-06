const {Schema, Block, Text, MarkType, Attribute, Slice} = require("prosemirror-model")
const {canSplit, liftTarget, findWrapping, Transform} = require("../src")
const {sameDoc} = require("prosemirror-model/test/build")
const ist = require("ist")

const schema = new Schema({
  nodes: {
    doc: {type: Block, content: "head? block* sect* closing?"},
    para: {type: Block, content: "text<_>*", group: "block"},
    head: {type: Block, content: "text*"},
    figure: {type: Block, content: "caption figureimage", group: "block"},
    quote: {type: Block, content: "block+", group: "block"},
    figureimage: {type: Block},
    caption: {type: Block, content: "text*"},
    sect: {type: Block, content: "head block* sect*"},
    closing: {type: Block, content: "text<_>*"},
    tcell: {type: Block, content: "text<_>*"},
    trow: {type: class extends Block {
      get attrs() { return {columns: new Attribute({default: 1})} }
    }, content: "tcell{.columns}"},
    table: {type: class extends Block {
      get attrs() { return {columns: new Attribute({default: 1})} }
    }, content: "trow[columns=.columns]+", group: "block"},
    text: {type: Text},

    fixed: {type: Block, content: "head para closing", group: "block"}
  },
  marks: {
    em: MarkType
  }
})

function n(name, ...content) { return schema.nodes[name].create(null, content) }
function n_(name, attrs, ...content) { return schema.nodes[name].create(attrs, content) }
function t(str, em) { return schema.text(str, em ? [schema.mark("em")] : null) }

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
                n("para", t("Yes")), // 91
                n_("table", {columns: 2}, // 92
                   n("trow", n("tcell", t("a")), n("tcell", t("b"))), // 100
                   n("trow", n("tcell", t("c")), n("tcell", t("d"))))), // 110
              n("closing", t("fin"))) // 115

function range(pos, end) {
  return doc.resolve(pos).blockRange(end == null ? undefined : doc.resolve(end))
}

describe("canSplit", () => {
  function yes(pos, depth, after) {
    return () => ist(canSplit(doc, pos, depth, after && schema.nodes[after]))
  }
  function no(pos, depth, after) {
    return () => ist(!canSplit(doc, pos, depth, after && schema.nodes[after]))
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
  it("can't at the start of a table cell", no(94))
  it("can't at the end of a table cell", no(96))
  it("can between table rows", yes(100))
  it("can't at the end of the document", no(115))
})

describe("liftTarget", () => {
  function yes(pos) {
    return () => { let r = range(pos); ist(r && liftTarget(r)) }
  }
  function no(pos) {
    return () => { let r = range(pos); ist(!(r && liftTarget(r))) }
  }

  it("can't at the start of the doc", no(0))
  it("can't in the heading", no(3))
  it("can't in a subsection para", no(52))
  it("can't in a figure caption", no(70))
  it("can from a quote", yes(76))
  it("can't in a section head", no(86))
  it("can't in a table", no(94))
})

describe("findWrapping", () => {
  function yes(pos, end, type) {
    return () => { let r = range(pos, end); ist(findWrapping(r, schema.nodes[type])) }
  }
  function no(pos, end, type) {
    return () => { let r = range(pos, end); ist(!findWrapping(r, schema.nodes[type])) }
  }

  it("can wrap the whole doc in a section", yes(0, 110, "sect"))
  it("can't wrap a head before a para in a section", no(4, 4, "sect"))
  it("can wrap a top paragraph in a quote", yes(8, 8, "quote"))
  it("can't wrap a section head in a quote", no(18, 18, "quote"))
  it("can wrap a figure in a quote", yes(55, 74, "quote"))
  it("can't wrap a head in a figure", no(90, 90, "figure"))
  it("can wrap a table in a quote", yes(91, 109, "quote"))
  it("can't wrap a closing block in a quote", no(113, 113, "quote"))
})

describe("Transform", () => {
  describe("replace", () => {
    function repl(doc, from, to, content, openLeft, openRight, result) {
      return () => {
        let slice = content ? new Slice(content.content, openLeft, openRight) : Slice.empty
        let tr = new Transform(doc).replace(from, to, slice)
        ist(tr.doc, result, sameDoc)
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

    function table2(...args) { return n_("table", {columns: 2}, ...args) }
    function trow2(...args) { return n_("trow", {columns: 2}, ...args) }

    it("balances a table on delete",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b"))))),
            2, 5, null, 0, 0,
            n("doc", table2(trow2(n("tcell"), n("tcell", t("b")))))))

    it("balances table on insertion at the start",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b"))))),
            2, 2, trow2(n("tcell", t("c"))), 0, 0,
            n("doc", n_("table", {columns: 2},
                        trow2(n("tcell", t("c")), n("tcell")),
                        trow2(n("tcell", t("a")), n("tcell", t("b")))))))

    it("balances a table on insertion in the middle",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b"))))),
            5, 5, trow2(n("tcell", t("c"))), 0, 0,
            n("doc", n_("table", {columns: 2},
                        trow2(n("tcell", t("a")), n("tcell", t("c"))),
                        trow2(n("tcell"), n("tcell", t("b")))))))

    it("balances a table when deleting across cells",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b"))))),
            4, 6, null, 0, 0,
            n("doc", table2(trow2(n("tcell", t("ab")), n("tcell"))))))

    it("can join tables",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b")))),
              table2(trow2(n("tcell", t("c")), n("tcell", t("d"))))),
            9, 15, null, 0, 0,
            n("doc", n_("table", {columns: 2},
                        trow2(n("tcell", t("a")), n("tcell", t("b"))),
                        trow2(n("tcell"), n("tcell", t("d")))))))

    it("can join table cells",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b")))),
              table2(trow2(n("tcell", t("c")), n("tcell", t("d"))))),
            7, 16, null, 0, 0,
            n("doc", n_("table", {columns: 2},
                        trow2(n("tcell", t("a")), n("tcell", t("bd")))))))

    it("adds a row when inserting a cell",
       repl(n("doc", table2(trow2(n("tcell", t("a")), n("tcell", t("b"))))),
            2, 2, trow2(n("tcell", t("c"))), 0, 0,
            n("doc", table2(trow2(n("tcell", t("c")), n("tcell")),
                            trow2(n("tcell", t("a")), n("tcell", t("b")))))))

    it("will create missing required nodes",
       repl(n("doc", n("fixed", n("head", t("foo")), n("para", t("bar")), n("closing", t("abc")))),
            4, 8, null, 0, 0,
            n("doc", n("fixed", n("head", t("foar")), n("para"), n("closing", t("abc"))))))
  })
})
