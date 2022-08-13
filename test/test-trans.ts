import {schema, doc, blockquote, pre, h1, h2, p, li, ol, ul, em,
        strong, code, a, img, br, hr, eq, builders} from "prosemirror-test-builder"
import {testTransform} from "./trans.js"
import {Transform, liftTarget, findWrapping} from "prosemirror-transform"
import {Slice, Fragment, Schema, Node, Mark, MarkType, NodeType, Attrs} from "prosemirror-model"
import ist from "ist"

function tag(node: Node, tag: string): number {
  return (node as any).tag[tag]
}

describe("Transform", () => {
  describe("addMark", () => {
    function add(doc: Node, mark: Mark, expect: Node) {
      testTransform(new Transform(doc).addMark(tag(doc, "a"), tag(doc, "b"), mark), expect)
    }

    it("should add a mark", () =>
       add(doc(p("hello <a>there<b>!")),
           schema.mark("strong"),
           doc(p("hello ", strong("there"), "!"))))

    it("should only add a mark once", () =>
       add(doc(p("hello ", strong("<a>there"), "!<b>")),
           schema.mark("strong"),
           doc(p("hello ", strong("there!")))))

    it("should join overlapping marks", () =>
       add(doc(p("one <a>two ", em("three<b> four"))),
           schema.mark("strong"),
           doc(p("one ", strong("two ", em("three")), em(" four")))))

    it("should overwrite marks with different attributes", () =>
       add(doc(p("this is a ", a("<a>link<b>"))),
           schema.mark("link", {href: "bar"}),
           doc(p("this is a ", a({href: "bar"}, "link")))))

    it("can add a mark in a nested node", () =>
       add(doc(p("before"), blockquote(p("the variable is called <a>i<b>")), p("after")),
           schema.mark("code"),
           doc(p("before"), blockquote(p("the variable is called ", code("i"))), p("after"))))

    it("can add a mark across blocks", () =>
       add(doc(p("hi <a>this"), blockquote(p("is")), p("a docu<b>ment"), p("!")),
           schema.mark("em"),
           doc(p("hi ", em("this")), blockquote(p(em("is"))), p(em("a docu"), "ment"), p("!"))))

    it("does not remove non-excluded marks of the same type", () => {
      let schema = new Schema({
        nodes: {doc: {content: "text*"},
                text: {}},
        marks: {comment: {excludes: "", attrs: {id: {}}}}
      })
      let tr = new Transform(schema.node("doc", null, schema.text("hi", [schema.mark("comment", {id: 10})])))
      tr.addMark(0, 2, schema.mark("comment", {id: 20}))
      ist(tr.doc.firstChild!.marks.length, 2)
    })

    it("can remove multiple excluded marks", () => {
      let schema = new Schema({
        nodes: {doc: {content: "text*"},
                text: {}},
        marks: {big: {excludes: "small1 small2"},
                small1: {}, small2: {}}
      })
      let tr = new Transform(schema.node("doc", null, schema.text("hi", [schema.mark("small1"), schema.mark("small2")])))
      ist(tr.doc.firstChild!.marks.length, 2)
      tr.addMark(0, 2, schema.mark("big"))
      ist(tr.doc.firstChild!.marks.length, 1)
      ist(tr.doc.firstChild!.marks[0].type.name, "big")
    })
  })

  describe("removeMark", () => {
    function rem(doc: Node, mark: Mark | null, expect: Node) {
      testTransform(new Transform(doc).removeMark(tag(doc, "a"), tag(doc, "b"), mark), expect)
    }

    it("can cut a gap", () =>
       rem(doc(p(em("hello <a>world<b>!"))),
           schema.mark("em"),
           doc(p(em("hello "), "world", em("!")))))

    it("doesn't do anything when there's no mark", () =>
       rem(doc(p(em("hello"), " <a>world<b>!")),
           schema.mark("em"),
           doc(p(em("hello"), " <a>world<b>!"))))

    it("can remove marks from nested nodes", () =>
       rem(doc(p(em("one ", strong("<a>two<b>"), " three"))),
           schema.mark("strong"),
           doc(p(em("one two three")))))

    it("can remove a link", () =>
       rem(doc(p("<a>hello ", a("link<b>"))),
           schema.mark("link", {href: "foo"}),
           doc(p("hello link"))))

    it("doesn't remove a non-matching link", () =>
       rem(doc(p("hello ", a("link"))),
           schema.mark("link", {href: "bar"}),
           doc(p("hello ", a("link")))))

    it("can remove across blocks", () =>
       rem(doc(blockquote(p(em("much <a>em")), p(em("here too"))), p("between", em("...")), p(em("end<b>"))),
           schema.mark("em"),
           doc(blockquote(p(em("much "), "em"), p("here too")), p("between..."), p("end"))))

    it("can remove everything", () =>
       rem(doc(p("<a>hello, ", em("this is ", strong("much"), " ", a("markup<b>")))),
           null,
           doc(p("<a>hello, this is much markup"))))

    it("can remove more than one mark of the same type from a block", () => {
      let schema = new Schema({
         nodes: {doc: {content: "text*"},
               text: {}},
         marks: {comment: {excludes: "", attrs: {id: {}}}}
      })
      let tr = new Transform(schema.node("doc", null, schema.text("hi", [schema.mark("comment", {id: 1}), schema.mark("comment", {id: 2})])))
      ist(tr.doc.firstChild!.marks.length, 2)
      tr.removeMark(0, 2, schema.marks["comment"])
      ist(tr.doc.firstChild!.marks.length, 0)
    })
  })

  describe("insert", () => {
    function ins(doc: Node, nodes: Node | Node[], expect: Node) {
      testTransform(new Transform(doc).insert(tag(doc, "a"), nodes), expect)
    }

    it("can insert a break", () =>
       ins(doc(p("hello<a>there")),
           schema.node("hard_break"),
           doc(p("hello", br(), "<a>there"))))

    it("can insert an empty paragraph at the top", () =>
       ins(doc(p("one"), "<a>", p("two<2>")),
           schema.node("paragraph"),
           doc(p("one"), p(), "<a>", p("two<2>"))))

    it("can insert two block nodes", () =>
       ins(doc(p("one"), "<a>", p("two<2>")),
           [schema.node("paragraph", null, [schema.text("hi")]),
            schema.node("horizontal_rule")],
           doc(p("one"), p("hi"), hr(), "<a>", p("two<2>"))))

    it("can insert at the end of a blockquote", () =>
       ins(doc(blockquote(p("he<before>y"), "<a>"), p("after<after>")),
           schema.node("paragraph"),
           doc(blockquote(p("he<before>y"), p()), p("after<after>"))))

    it("can insert at the start of a blockquote", () =>
       ins(doc(blockquote("<a>", p("he<1>y")), p("after<2>")),
           schema.node("paragraph"),
           doc(blockquote(p(), "<a>", p("he<1>y")), p("after<2>"))))

    it("will wrap a node with the suitable parent", () =>
       ins(doc(p("foo<a>bar")),
           schema.nodes.list_item.createAndFill()!,
           doc(p("foo"), ol(li(p())), p("bar"))))
  })

  describe("delete", () => {
    function del(doc: Node, expect: Node) {
      testTransform(new Transform(doc).delete(tag(doc, "a"), tag(doc, "b")), expect)
    }

    it("can delete a word", () =>
       del(doc(p("<1>one"), "<a>", p("tw<2>o"), "<b>", p("<3>three")),
           doc(p("<1>one"), "<a><2>", p("<3>three"))))

    it("preserves content constraints", () =>
       del(doc(blockquote("<a>", p("hi"), "<b>"), p("x")),
           doc(blockquote(p()), p("x"))))

    it("preserves positions after the range", () =>
       del(doc(blockquote(p("a"), "<a>", p("b"), "<b>"), p("c<1>")),
           doc(blockquote(p("a")), p("c<1>"))))

    it("doesn't join incompatible nodes", () =>
       del(doc(pre("fo<a>o"), p("b<b>ar", img())),
           doc(pre("fo"), p("ar", img()))))

    it("doesn't join when marks are incompatible", () =>
       del(doc(pre("fo<a>o"), p(em("b<b>ar"))),
           doc(pre("fo"), p(em("ar")))))
  })

  describe("join", () => {
    function join(doc: Node, expect: Node) {
      testTransform(new Transform(doc).join(tag(doc, "a")), expect)
    }

    it("can join blocks", () =>
       join(doc(blockquote(p("<before>a")), "<a>", blockquote(p("b")), p("after<after>")),
            doc(blockquote(p("<before>a"), "<a>", p("b")), p("after<after>"))))

    it("can join compatible blocks", () =>
       join(doc(h1("foo"), "<a>", p("bar")),
            doc(h1("foobar"))))

    it("can join nested blocks", () =>
       join(doc(blockquote(blockquote(p("a"), p("b<before>")), "<a>", blockquote(p("c"), p("d<after>")))),
            doc(blockquote(blockquote(p("a"), p("b<before>"), "<a>", p("c"), p("d<after>"))))))

    it("can join lists", () =>
       join(doc(ol(li(p("one")), li(p("two"))), "<a>", ol(li(p("three")))),
            doc(ol(li(p("one")), li(p("two")), "<a>", li(p("three"))))))

    it("can join list items", () =>
       join(doc(ol(li(p("one")), li(p("two")), "<a>", li(p("three")))),
            doc(ol(li(p("one")), li(p("two"), "<a>", p("three"))))))

    it("can join textblocks", () =>
       join(doc(p("foo"), "<a>", p("bar")),
            doc(p("foo<a>bar"))))
  })

  describe("split", () => {
    function split(doc: Node, expect: Node | "fail", depth?: number,
                   typesAfter?: (null | {type: NodeType, attrs?: Attrs | null})[]) {
      if (expect == "fail")
        ist.throws(() => new Transform(doc).split(tag(doc, "a"), depth, typesAfter))
      else
        testTransform(new Transform(doc).split(tag(doc, "a"), depth, typesAfter), expect)
    }

    it("can split a textblock", () =>
       split(doc(p("foo<a>bar")),
             doc(p("foo"), p("<a>bar"))))

    it("correctly maps positions", () =>
       split(doc(p("<1>a"), p("<2>foo<a>bar<3>"), p("<4>b")),
             doc(p("<1>a"), p("<2>foo"), p("<a>bar<3>"), p("<4>b"))))

    it("can split two deep", () =>
       split(doc(blockquote(blockquote(p("foo<a>bar"))), p("after<1>")),
             doc(blockquote(blockquote(p("foo")), blockquote(p("<a>bar"))), p("after<1>")),
             2))

    it("can split three deep", () =>
       split(doc(blockquote(blockquote(p("foo<a>bar"))), p("after<1>")),
             doc(blockquote(blockquote(p("foo"))), blockquote(blockquote(p("<a>bar"))), p("after<1>")),
             3))

    it("can split at end", () =>
       split(doc(blockquote(p("hi<a>"))),
             doc(blockquote(p("hi"), p("<a>")))))

    it("can split at start", () =>
       split(doc(blockquote(p("<a>hi"))),
             doc(blockquote(p(), p("<a>hi")))))

    it("can split inside a list item", () =>
       split(doc(ol(li(p("one<1>")), li(p("two<a>three")), li(p("four<2>")))),
             doc(ol(li(p("one<1>")), li(p("two"), p("<a>three")), li(p("four<2>"))))))

    it("can split a list item", () =>
       split(doc(ol(li(p("one<1>")), li(p("two<a>three")), li(p("four<2>")))),
             doc(ol(li(p("one<1>")), li(p("two")), li(p("<a>three")), li(p("four<2>")))),
             2))

    it("respects the type param", () =>
       split(doc(h1("hell<a>o!")),
             doc(h1("hell"), p("<a>o!")),
             undefined, [{type: schema.nodes.paragraph}]))

    it("preserves content constraints before", () =>
       split(doc(blockquote("<a>", p("x"))), "fail"))

    it("preserves content constraints after", () =>
       split(doc(blockquote(p("x"), "<a>")), "fail"))
  })

  describe("lift", () => {
    function lift(doc: Node, expect: Node) {
      let range = doc.resolve(tag(doc, "a")).blockRange(doc.resolve(tag(doc, "b") || tag(doc, "a")))
      testTransform(new Transform(doc).lift(range!, liftTarget(range!)!), expect)
    }

    it("can lift a block out of the middle of its parent", () =>
       lift(doc(blockquote(p("<before>one"), p("<a>two"), p("<after>three"))),
            doc(blockquote(p("<before>one")), p("<a>two"), blockquote(p("<after>three")))))

    it("can lift a block from the start of its parent", () =>
       lift(doc(blockquote(p("<a>two"), p("<after>three"))),
            doc(p("<a>two"), blockquote(p("<after>three")))))

    it("can lift a block from the end of its parent", () =>
       lift(doc(blockquote(p("<before>one"), p("<a>two"))),
            doc(blockquote(p("<before>one")), p("<a>two"))))

    it("can lift a single child", () =>
       lift(doc(blockquote(p("<a>t<in>wo"))),
            doc(p("<a>t<in>wo"))))

    it("can lift multiple blocks", () =>
       lift(doc(blockquote(blockquote(p("on<a>e"), p("tw<b>o")), p("three"))),
            doc(blockquote(p("on<a>e"), p("tw<b>o"), p("three")))))

    it("finds a valid range from a lopsided selection", () =>
       lift(doc(p("start"), blockquote(blockquote(p("a"), p("<a>b")), p("<b>c"))),
            doc(p("start"), blockquote(p("a"), p("<a>b")), p("<b>c"))))

    it("can lift from a nested node", () =>
       lift(doc(blockquote(blockquote(p("<1>one"), p("<a>two"), p("<3>three"), p("<b>four"), p("<5>five")))),
            doc(blockquote(blockquote(p("<1>one")), p("<a>two"), p("<3>three"), p("<b>four"), blockquote(p("<5>five"))))))

    it("can lift from a list", () =>
       lift(doc(ul(li(p("one")), li(p("two<a>")), li(p("three")))),
            doc(ul(li(p("one"))), p("two<a>"), ul(li(p("three"))))))

    it("can lift from the end of a list", () =>
       lift(doc(ul(li(p("a")), li(p("b<a>")), "<1>")),
            doc(ul(li(p("a"))), p("b<a>"), "<1>")))
  })

  describe("wrap", () => {
    function wrap(doc: Node, expect: Node, type: string, attrs?: Attrs) {
      let range = doc.resolve(tag(doc, "a")).blockRange(doc.resolve(tag(doc, "b") || tag(doc, "a")))
      testTransform(new Transform(doc).wrap(range!, findWrapping(range!, schema.nodes[type], attrs)!), expect)
    }

    it("can wrap in a blockquote", () =>
       wrap(doc(p("one"), p("<a>two"), p("three")),
            doc(p("one"), blockquote(p("<a>two")), p("three")),
            "blockquote"))

    it("can wrap two paragraphs", () =>
       wrap(doc(p("one<1>"), p("<a>two"), p("<b>three"), p("four<4>")),
            doc(p("one<1>"), blockquote(p("<a>two"), p("three")), p("four<4>")),
            "blockquote"))

    it("can wrap in a list", () =>
       wrap(doc(p("<a>one"), p("<b>two")),
            doc(ol(li(p("<a>one"), p("<b>two")))),
            "ordered_list"))

    it("can wrap in a nested list", () =>
       wrap(doc(ol(li(p("<1>one")), li(p("..."), p("<a>two"), p("<b>three")), li(p("<4>four")))),
            doc(ol(li(p("<1>one")), li(p("..."), ol(li(p("<a>two"), p("<b>three")))), li(p("<4>four")))),
            "ordered_list"))

    it("includes half-covered parent nodes", () =>
       wrap(doc(blockquote(p("<1>one"), p("two<a>")), p("three<b>")),
            doc(blockquote(blockquote(p("<1>one"), p("two<a>")), p("three<b>"))),
            "blockquote"))
  })

  describe("setBlockType", () => {
    function type(doc: Node, expect: Node, nodeType: string, attrs?: Attrs) {
      testTransform(new Transform(doc).setBlockType(tag(doc, "a"), tag(doc, "b") || tag(doc, "a"), schema.nodes[nodeType], attrs),
                    expect)
    }

    it("can change a single textblock", () =>
       type(doc(p("am<a> i")),
            doc(h2("am i")),
            "heading", {level: 2}))

    it("can change multiple blocks", () =>
       type(doc(h1("<a>hello"), p("there"), p("<b>you"), p("end")),
            doc(pre("hello"), pre("there"), pre("you"), p("end")),
            "code_block"))

    it("can change a wrapped block", () =>
       type(doc(blockquote(p("one<a>"), p("two<b>"))),
            doc(blockquote(h1("one<a>"), h1("two<b>"))),
            "heading", {level: 1}))

    it("clears markup when necessary", () =>
       type(doc(p("hello<a> ", em("world"))),
            doc(pre("hello world")),
            "code_block"))

    it("only clears markup when needed", () =>
       type(doc(p("hello<a> ", em("world"))),
            doc(h1("hello<a> ", em("world"))),
            "heading", {level: 1}))

    it("works after another step", () => {
      let d = doc(p("f<x>oob<y>ar"), p("baz<a>"))
      let tr = new Transform(d).delete((d as any).tag.x, (d as any).tag.y), pos = tr.mapping.map((d as any).tag.a)
      tr.setBlockType(pos, pos, schema.nodes.heading, {level: 1})
      testTransform(tr, doc(p("f<x><y>ar"), h1("baz<a>")))
    })

    it("skips nodes that can't be changed due to constraints", () =>
       type(doc(p("<a>hello", img()), p("okay"), ul(li(p("foo<b>")))),
            doc(pre("<a>hello"), pre("okay"), ul(li(p("foo<b>")))),
            "code_block"))
  })

  describe("setNodeMarkup", () => {
    function markup(doc: Node, expect: Node, type: string, attrs?: Attrs) {
      testTransform(new Transform(doc).setNodeMarkup(tag(doc, "a"), schema.nodes[type], attrs), expect)
    }

    it("can change a textblock", () =>
       markup(doc("<a>", p("foo")),
              doc(h1("foo")),
              "heading", {level: 1}))

    it("can change an inline node", () =>
       markup(doc(p("foo<a>", img(), "bar")),
              doc(p("foo", img({src: "bar", alt: "y"}), "bar")),
              "image", {src: "bar", alt: "y"}))
  })

  describe("replace", () => {
    function repl(doc: Node, source: Node | Slice | null, expect: Node) {
      let slice = !source ? Slice.empty : source instanceof Slice ? source
        : source.slice((source as any).tag.a, (source as any).tag.b)
      testTransform(new Transform(doc).replace(tag(doc, "a"), tag(doc, "b") || tag(doc, "a"), slice), expect)
    }

    it("can delete text", () =>
       repl(doc(p("hell<a>o y<b>ou")),
            null,
            doc(p("hell<a><b>ou"))))

    it("can join blocks", () =>
       repl(doc(p("hell<a>o"), p("y<b>ou")),
            null,
            doc(p("hell<a><b>ou"))))

    it("can delete right-leaning lopsided regions", () =>
       repl(doc(blockquote(p("ab<a>c")), "<b>", p("def")),
            null,
            doc(blockquote(p("ab<a>")), "<b>", p("def"))))

    it("can delete left-leaning lopsided regions", () =>
       repl(doc(p("abc"), "<a>", blockquote(p("d<b>ef"))),
            null,
            doc(p("abc"), "<a>", blockquote(p("<b>ef")))))

    it("can overwrite text", () =>
       repl(doc(p("hell<a>o y<b>ou")),
            doc(p("<a>i k<b>")),
            doc(p("hell<a>i k<b>ou"))))

    it("can insert text", () =>
       repl(doc(p("hell<a><b>o")),
            doc(p("<a>i k<b>")),
            doc(p("helli k<a><b>o"))))

    it("can add a textblock", () =>
       repl(doc(p("hello<a>you")),
            doc("<a>", p("there"), "<b>"),
            doc(p("hello"), p("there"), p("<a>you"))))

    it("can insert while joining textblocks", () =>
       repl(doc(h1("he<a>llo"), p("arg<b>!")),
            doc(p("1<a>2<b>3")),
            doc(h1("he2!"))))

    it("will match open list items", () =>
       repl(doc(ol(li(p("one<a>")), li(p("three")))),
            doc(ol(li(p("<a>half")), li(p("two")), "<b>")),
            doc(ol(li(p("onehalf")), li(p("two")), li(p("three"))))))

    it("merges blocks across deleted content", () =>
       repl(doc(p("a<a>"), p("b"), p("<b>c")),
            null,
            doc(p("a<a><b>c"))))

    it("can merge text down from nested nodes", () =>
       repl(doc(h1("wo<a>ah"), blockquote(p("ah<b>ha"))),
            null,
            doc(h1("wo<a><b>ha"))))

    it("can merge text up into nested nodes", () =>
       repl(doc(blockquote(p("foo<a>bar")), p("middle"), h1("quux<b>baz")),
            null,
            doc(blockquote(p("foo<a><b>baz")))))

    it("will join multiple levels when possible", () =>
       repl(doc(blockquote(ul(li(p("a")), li(p("b<a>")), li(p("c")), li(p("<b>d")), li(p("e"))))),
            null,
            doc(blockquote(ul(li(p("a")), li(p("b<a><b>d")), li(p("e")))))))

    it("can replace a piece of text", () =>
       repl(doc(p("he<before>llo<a> w<after>orld")),
            doc(p("<a> big<b>")),
            doc(p("he<before>llo big w<after>orld"))))

    it("respects open empty nodes at the edges", () =>
       repl(doc(p("one<a>two")),
            doc(p("a<a>"), p("hello"), p("<b>b")),
            doc(p("one"), p("hello"), p("<a>two"))))

    it("can completely overwrite a paragraph", () =>
       repl(doc(p("one<a>"), p("t<inside>wo"), p("<b>three<end>")),
            doc(p("a<a>"), p("TWO"), p("<b>b")),
            doc(p("one<a>"), p("TWO"), p("<inside>three<end>"))))

    it("joins marks", () =>
       repl(doc(p("foo ", em("bar<a>baz"), "<b> quux")),
            doc(p("foo ", em("xy<a>zzy"), " foo<b>")),
            doc(p("foo ", em("barzzy"), " foo quux"))))

    it("can replace text with a break", () =>
       repl(doc(p("foo<a>b<inside>b<b>bar")),
            doc(p("<a>", br(), "<b>")),
            doc(p("foo", br(), "<inside>bar"))))

    it("can join different blocks", () =>
       repl(doc(h1("hell<a>o"), p("by<b>e")),
            null,
            doc(h1("helle"))))

    it("can restore a list parent", () =>
       repl(doc(h1("hell<a>o"), "<b>"),
            doc(ol(li(p("on<a>e")), li(p("tw<b>o")))),
            doc(h1("helle"), ol(li(p("tw"))))))

    it("can restore a list parent and join text after it", () =>
       repl(doc(h1("hell<a>o"), p("yo<b>u")),
            doc(ol(li(p("on<a>e")), li(p("tw<b>o")))),
            doc(h1("helle"), ol(li(p("twu"))))))

    it("can insert into an empty block", () =>
       repl(doc(p("a"), p("<a>"), p("b")),
            doc(p("x<a>y<b>z")),
            doc(p("a"), p("y<a>"), p("b"))))

    it("doesn't change the nesting of blocks after the selection", () =>
       repl(doc(p("one<a>"), p("two"), p("three")),
            doc(p("outside<a>"), blockquote(p("inside<b>"))),
            doc(p("one"), blockquote(p("inside")), p("two"), p("three"))))

    it("can close a parent node", () =>
       repl(doc(blockquote(p("b<a>c"), p("d<b>e"), p("f"))),
            doc(blockquote(p("x<a>y")), p("after"), "<b>"),
            doc(blockquote(p("b<a>y")), p("after"), blockquote(p("<b>e"), p("f")))))

    it("accepts lopsided regions", () =>
       repl(doc(blockquote(p("b<a>c"), p("d<b>e"), p("f"))),
            doc(blockquote(p("x<a>y")), p("z<b>")),
            doc(blockquote(p("b<a>y")), p("z<b>e"), blockquote(p("f")))))

    it("can close nested parent nodes", () =>
       repl(doc(blockquote(blockquote(p("one"), p("tw<a>o"), p("t<b>hree<3>"), p("four<4>")))),
            doc(ol(li(p("hello<a>world")), li(p("bye"))), p("ne<b>xt")),
            doc(blockquote(blockquote(p("one"), p("tw<a>world"), ol(li(p("bye"))), p("ne<b>hree<3>"), p("four<4>"))))))

    it("will close open nodes to the right", () =>
       repl(doc(p("x"), "<a>"),
            doc("<a>", ul(li(p("a")), li("<b>", p("b")))),
            doc(p("x"), ul(li(p("a")), li(p())), "<a>")))

    it("can delete the whole document", () =>
       repl(doc("<a>", h1("hi"), p("you"), "<b>"),
            null,
            doc(p())))

    it("preserves an empty parent to the left", () =>
       repl(doc(blockquote("<a>", p("hi")), p("b<b>x")),
            doc(p("<a>hi<b>")),
            doc(blockquote(p("hix")))))

    it("drops an empty parent to the right", () =>
       repl(doc(p("x<a>hi"), blockquote(p("yy"), "<b>"), p("c")),
            doc(p("<a>hi<b>")),
            doc(p("xhi"), p("c"))))

    it("drops an empty node at the start of the slice", () =>
       repl(doc(p("<a>x")),
            doc(blockquote(p("hi"), "<a>"), p("b<b>")),
            doc(p(), p("bx"))))

    it("drops an empty node at the end of the slice", () =>
       repl(doc(p("<a>x")),
            doc(p("b<a>"), blockquote("<b>", p("hi"))),
            doc(p(), blockquote(p()), p("x"))))

    it("does nothing when given an unfittable slice", () =>
       repl(p("<a>x"),
            new Slice(Fragment.from([blockquote(), hr()]), 0, 0),
            p("x")))

    it("doesn't drop content when things only fit at the top level", () =>
       repl(doc(p("foo"), "<a>", p("bar<b>")),
            ol(li(p("<a>a")), li(p("b<b>"))),
            doc(p("foo"), p("a"), ol(li(p("b"))))))

    it("preserves openEnd when top isn't placed", () =>
       repl(doc(ul(li(p("ab<a>cd")), li(p("ef<b>gh")))),
            doc(ul(li(p("ABCD")), li(p("EFGH")))).slice(5, 13, true),
            doc(ul(li(p("abCD")), li(p("EFgh"))))))

    it("will auto-close a list item when it fits in a list", () =>
       repl(doc(ul(li(p("foo")), "<a>", li(p("bar")))),
            ul(li(p("a<a>bc")), li(p("de<b>f"))),
            doc(ul(li(p("foo")), li(p("bc")), li(p("de")), li(p("bar"))))))

    it("finds the proper openEnd value when unwrapping a deep slice", () =>
       repl(doc("<a>", p(), "<b>"),
            doc(blockquote(blockquote(blockquote(p("hi"))))).slice(3, 6, true),
            doc(p("hi"))))

    // A schema that allows marks on top-level block nodes
    let ms = new Schema({
      nodes: schema.spec.nodes.update("doc", Object.assign({}, schema.spec.nodes.get("doc"), {marks: "_"})),
      marks: schema.spec.marks
    })

    it("preserves marks on block nodes", () => {
      let tr = new Transform(ms.node("doc", null, [
        ms.node("paragraph", null, [ms.text("hey")], [ms.mark("em")]),
        ms.node("paragraph", null, [ms.text("ok")], [ms.mark("strong")])
      ]))
      tr.replace(2, 7, tr.doc.slice(2, 7))
      ist(tr.doc, tr.before, eq)
    })

    it("preserves marks on open slice block nodes", () => {
      let tr = new Transform(ms.node("doc", null, [ms.node("paragraph", null, [ms.text("a")])]))
      tr.replace(3, 3, ms.node("doc", null, [
        ms.node("paragraph", null, [ms.text("b")], [ms.mark("em")])
      ]).slice(1, 3))
      ist(tr.doc.childCount, 2)
      ist(tr.doc.lastChild!.marks.length, 1)
    })

    // A schema that enforces a heading and a body at the top level
    let hbSchema = new Schema({
      nodes: schema.spec.nodes.append({
        doc: Object.assign({}, schema.spec.nodes.get("doc"), {content: "heading body"}),
        body: {content: "block+"}
      })
    })
    let hb = builders(hbSchema, {
      p: {nodeType: "paragraph"},
      b: {nodeType: "body"},
      h: {nodeType: "heading", level: 1},
    }) as any

    it("can unwrap a paragraph when replacing into a strict schema", () => {
      let tr = new Transform(hb.doc(hb.h("Head"), hb.b(hb.p("Content"))))
      tr.replace(0, tr.doc.content.size, tr.doc.slice(7, 16))
      ist(tr.doc, hb.doc(hb.h("Content"), hb.b(hb.p())), eq)
    })

    it("can unwrap a body after a placed node", () => {
      let tr = new Transform(hb.doc(hb.h("Head"), hb.b(hb.p("Content"))))
      tr.replace(7, 7, tr.doc.slice(0, tr.doc.content.size))
      ist(tr.doc, hb.doc(hb.h("Head"), hb.b(hb.h("Head"), hb.p("Content"), hb.p("Content"))), eq)
    })

    it("can wrap a paragraph in a body, even when it's not the first node", () => {
      let tr = new Transform(hb.doc(hb.h("Head"), hb.b(hb.p("One"), hb.p("Two"))))
      tr.replace(0, tr.doc.content.size, tr.doc.slice(8, 16))
      ist(tr.doc, hb.doc(hb.h("One"), hb.b(hb.p("Two"))), eq)
    })

    it("can split a fragment and place its children in different parents", () => {
      let tr = new Transform(hb.doc(hb.h("Head"), hb.b(hb.h("One"), hb.p("Two"))))
      tr.replace(0, tr.doc.content.size, tr.doc.slice(7, 17))
      ist(tr.doc, hb.doc(hb.h("One"), hb.b(hb.p("Two"))), eq)
    })

    it("will insert filler nodes before a node when necessary", () => {
      let tr = new Transform(hb.doc(hb.h("Head"), hb.b(hb.p("One"))))
      tr.replace(0, tr.doc.content.size, tr.doc.slice(6, tr.doc.content.size))
      ist(tr.doc, hb.doc(hb.h(), hb.b(hb.p("One"))), eq)
    })

    it("doesn't fail when moving text would solve an unsatisfied content constraint", () => {
      let s = new Schema({
        nodes: schema.spec.nodes.append({
          title: {content: "text*"},
          doc: {content: "title? block*"}
        })
      })
      let tr = new Transform(s.node("doc", null, s.node("title", null, s.text("hi"))))
      tr.replace(1, 1, s.node("bullet_list", null, [
        s.node("list_item", null, s.node("paragraph", null, s.text("one"))),
        s.node("list_item", null, s.node("paragraph", null, s.text("two")))
      ]).slice(2, 12))
      ist(tr.steps.length, 0, ">")
    })

    it("doesn't fail when pasting a half-open slice with a title and a code block into an empty title", () => {
      let s = new Schema({
        nodes: schema.spec.nodes.append({
          title: {content: "text*"},
          doc: {content: "title? block*"}
        })
      })
      let tr = new Transform(s.node("doc", null, [s.node("title", null, [])]))
      tr.replace(1, 1, s.node("doc", null, [
        s.node("title", null, s.text("title")),
        s.node("code_block", null, s.text("two")),
      ]).slice(1))
      ist(tr.steps.length, 0, ">")
    })

    it("doesn't fail when pasting a half-open slice with a heading and a code block into an empty title", () => {
      let s = new Schema({
        nodes: schema.spec.nodes.append({
          title: {content: "text*"},
          doc: {content: "title? block*"}
        })
      })
      let tr = new Transform(s.node("doc", null, [s.node("title")]))
      tr.replace(1, 1, s.node("doc", null, [
        s.node("heading", {level: 1}, [s.text("heading")]),
        s.node("code_block", null, [s.text("code")]),
      ]).slice(1))
      ist(tr.steps.length, 0, ">")
    })

    it("can handle replacing in nodes with fixed content", () => {
      let s = new Schema({
        nodes: {
          doc: {content: "block+"},
          a: {content: "inline*"},
          b: {content: "inline*"},
          block: {content: "a b"},
          text: {group: "inline"}
        }
      })

      let doc = s.node("doc", null, [
        s.node("block", null, [s.node("a", null, [s.text("aa")]), s.node("b", null, [s.text("bb")])])
      ])
      let from = 3, to = doc.content.size
      ist(new Transform(doc).replace(from, to, doc.slice(from, to)).doc, doc, eq)
    })
  })

  describe("replaceRange", () => {
    function repl(doc: Node, source: Node, expect: Node) {
      let slice = !source ? Slice.empty : source instanceof Slice ? source
        : source.slice((source as any).tag.a, (source as any).tag.b, true)
      testTransform(new Transform(doc).replaceRange(tag(doc, "a"), tag(doc, "b") || tag(doc, "a"), slice), expect)
    }

    it("replaces inline content", () =>
       repl(doc(p("foo<a>b<b>ar")), p("<a>xx<b>"), doc(p("foo<a>xx<b>ar"))))

    it("replaces an empty paragraph with a heading", () =>
       repl(doc(p("<a>")), doc(h1("<a>text<b>")), doc(h1("text"))))

    it("replaces a fully selected paragraph with a heading", () =>
       repl(doc(p("<a>abc<b>")), doc(h1("<a>text<b>")), doc(h1("text"))))

    it("recreates a list when overwriting a paragraph", () =>
       repl(doc(p("<a>")), doc(ul(li(p("<a>foobar<b>")))), doc(ul(li(p("foobar"))))))

    it("drops context when it doesn't fit", () =>
       repl(doc(ul(li(p("<a>")), li(p("b")))), doc(h1("<a>h<b>")), doc(ul(li(p("h<a>")), li(p("b"))))))

    it("can replace a node when endpoints are in different children", () =>
       repl(doc(p("a"), ul(li(p("<a>b")), li(p("c"), blockquote(p("d<b>")))), p("e")),
            doc(h1("<a>x<b>")),
            doc(p("a"), h1("x"), p("e"))))

    it("keeps defining context when inserting at the start of a textblock", () =>
       repl(doc(p("<a>foo")),
            doc(ul(li(p("<a>one")), li(p("two<b>")))),
            doc(ul(li(p("one")), li(p("twofoo"))))))

    it("drops defining context when it matches the parent structure", () =>
       repl(doc(blockquote(p("<a>"))),
            doc(blockquote(p("<a>one<b>"))),
            doc(blockquote(p("one")))))

    it("closes open nodes at the start", () =>
       repl(doc("<a>", p("abc"), "<b>"),
            doc(ul(li("<a>")), p("def"), "<b>"),
            doc(ul(li(p())), p("def"))))
  })

  describe("replaceRangeWith", () => {
    function repl(doc: Node, node: Node, expect: Node) {
      testTransform(new Transform(doc).replaceRangeWith(tag(doc, "a"), tag(doc, "b") || tag(doc, "a"), node), expect)
    }

    it("can insert an inline node", () =>
       repl(doc(p("fo<a>o")), img(), doc(p("fo", img(), "<a>o"))))

    it("can replace content with an inline node", () =>
       repl(doc(p("<a>fo<b>o")), img(), doc(p("<a>", img(), "o"))))

    it("can replace a block node with an inline node", () =>
       repl(doc("<a>", blockquote(p("a")), "<b>"), img(), doc(p(img))))

    it("can replace a block node with a block node", () =>
       repl(doc("<a>", blockquote(p("a")), "<b>"), hr(), doc(hr())))

    it("can insert a block quote in the middle of text", () =>
       repl(doc(p("foo<a>bar")), hr(), doc(p("foo"), hr(), p("bar"))))

    it("can replace empty parents with a block node", () =>
       repl(doc(blockquote(p("<a>"))), hr(), doc(blockquote(hr()))))

    it("can move an inserted block forward out of parent nodes", () =>
       repl(doc(h1("foo<a>")), hr(), doc(h1("foo"), hr())))

    it("can move an inserted block backward out of parent nodes", () =>
       repl(doc(p("a"), blockquote(p("<a>b"))), hr(), doc(p("a"), blockquote(hr, p("b")))))
  })

  describe("deleteRange", () => {
    function del(doc: Node, expect: Node) {
      testTransform(new Transform(doc).deleteRange(tag(doc, "a"), tag(doc, "b") || tag(doc, "a")), expect)
    }

    it("deletes the given range", () =>
       del(doc(p("fo<a>o"), p("b<b>ar")), doc(p("fo<a><b>ar"))))

    it("deletes empty parent nodes", () =>
       del(doc(blockquote(ul(li("<a>", p("foo"), "<b>")), p("x"))),
           doc(blockquote("<a><b>", p("x")))))

    it("doesn't delete parent nodes that can be empty", () =>
       del(doc(p("<a>foo<b>")), doc(p("<a><b>"))))

    it("is okay with deleting empty ranges", () =>
       del(doc(p("<a><b>")), doc(p("<a><b>"))))

    it("will delete a whole covered node even if selection ends are in different nodes", () =>
       del(doc(ul(li(p("<a>foo")), li(p("bar<b>"))), p("hi")), doc(p("hi"))))

    it("leaves wrapping textblock when deleting all text in it", () =>
       del(doc(p("a"), p("<a>b<b>")), doc(p("a"), p())))

    it("expands to cover the whole parent node", () =>
       del(doc(p("a"), blockquote(blockquote(p("<a>foo")), p("bar<b>")), p("b")),
           doc(p("a"), p("b"))))

    it("expands to cover the whole document", () =>
       del(doc(h1("<a>foo"), p("bar"), blockquote(p("baz<b>"))),
           doc(p())))

    it("doesn't expand beyond same-depth textblocks", () =>
       del(doc(h1("<a>foo"), p("bar"), p("baz<b>")),
           doc(h1())))

    it("deletes the open token when deleting from start to past end of block", () =>
       del(doc(h1("<a>foo"), p("b<b>ar")),
           doc(p("ar"))))

    it("doesn't delete the open token when the range end is at end of its own block", () =>
       del(doc(p("one"), h1("<a>two"), blockquote(p("three<b>")), p("four")),
           doc(p("one"), h1(), p("four"))))
  })

  describe("addNodeMark", () => {
    function add(doc: Node, mark: Mark, expect: Node) {
      testTransform(new Transform(doc).addNodeMark(tag(doc, "a"), mark), expect)
    }

    it("adds a mark", () =>
      add(doc(p("<a>", img())), schema.mark("em"), doc(p("<a>", em(img())))))

    it("doesn't duplicate a mark", () =>
      add(doc(p("<a>", em(img()))), schema.mark("em"), doc(p("<a>", em(img())))))

    it("replaces a mark", () =>
      add(doc(p("<a>", a(img()))), schema.mark("link", {href: "x"}), doc(p("<a>", a({href: "x"}, img())))))
  })

  describe("removeNodeMark", () => {
    function rm(doc: Node, mark: Mark | MarkType, expect: Node) {
      testTransform(new Transform(doc).removeNodeMark(tag(doc, "a"), mark), expect)
    }

    it("removes a mark", () =>
      rm(doc(p("<a>", em(img()))), schema.mark("em"), doc(p("<a>", img()))))

    it("doesn't do anything when there is no mark", () =>
      rm(doc(p("<a>", img())), schema.mark("em"), doc(p("<a>", img()))))

    it("can remove a mark from multiple marks", () =>
      rm(doc(p("<a>", em(a(img())))), schema.mark("em"), doc(p("<a>", a(img())))))
  })

  describe("setNodeAttribute", () => {
    function set(doc: Node, attr: string, value: any, expect: Node) {
      testTransform(new Transform(doc).setNodeAttribute(tag(doc, "a"), attr, value), expect)
    }

    it("sets an attribute", () =>
      set(doc("<a>", h1("a")), "level", 2, doc("<a>", h2("a"))))
  })
})
